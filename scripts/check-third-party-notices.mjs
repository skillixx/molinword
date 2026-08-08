import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildThirdPartyLicenseBundle } from "./third-party-license-bundle.mjs";

const result = await buildThirdPartyLicenseBundle({ rootDir: process.cwd() });
const repeatedResult = await buildThirdPartyLicenseBundle({ rootDir: process.cwd() });
const lock = JSON.parse(await readFile("package-lock.json", "utf8"));

assert.ok(result.entries.length >= 250, `许可证包覆盖依赖过少：${result.entries.length}`);
assert.equal(result.missing.length, 0, `以下生产依赖缺少可发布的许可证文本：\n${result.missing.join("\n")}`);
assert.equal(result.content, repeatedResult.content, "同一锁文件和依赖目录必须生成完全一致的许可证包");
assert.match(result.content, /^MOLINWORD THIRD-PARTY LICENSE BUNDLE/m);
assert.doesNotMatch(result.content, /D:\\|C:\\Users\\/i, "许可证包不能泄露构建机绝对路径");

for (const packageName of ["react", "minio", "caniuse-lite"]) {
  const lockedVersion = lock.packages?.[`node_modules/${packageName}`]?.version;
  assert.ok(lockedVersion, `package-lock.json 缺少核心依赖 ${packageName}`);
  const coordinate = `${packageName}@${lockedVersion}`;
  assert.ok(result.entries.some((entry) => `${entry.name}@${entry.version}` === coordinate), `许可证包缺少核心依赖 ${coordinate}`);
  assert.ok(result.content.includes(`Package: ${coordinate}`), `许可证正文缺少核心依赖标记 ${coordinate}`);
}

const fallbackEntry = result.entries.find((entry) => entry.name === "dingbat-to-unicode" && entry.version === "1.0.1");
assert.ok(fallbackEntry?.usedFallback, "没有许可证文件的依赖必须生成带署名的标准许可证文本");
assert.match(result.content, /Michael Williamson/);
assert.match(result.content, /Redistribution and use in source and binary forms/);

for (const entry of result.entries) {
  const marker = `Package: ${entry.name}@${entry.version}`;
  assert.equal(result.content.split(marker).length - 1, 1, `依赖 ${marker} 必须且只能登记一次`);
  assert.ok(entry.licenseSources.length > 0 && entry.licenseSources.every((source) => source.content.trim()), `${marker} 缺少许可证正文`);
}

console.log("第三方许可证发布包检查通过。", {
  packages: result.entries.length,
  fallbackPackages: result.entries.filter((entry) => entry.usedFallback).map((entry) => `${entry.name}@${entry.version}`),
  skippedOptionalPackages: result.skippedOptional.length,
  bytes: Buffer.byteLength(result.content)
});
