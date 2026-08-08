import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildThirdPartyLicenseBundle, hasValidSha512Integrity, isTrustedLockedArchive, sanitizePublicSource } from "./third-party-license-bundle.mjs";

// 测试侧独立声明敏感凭据特征，避免把生产实现的内部正则暴露成公共接口。
const publicCredentialPattern = /(?:gh[pousr]_|github_pat_|npm_|sk-|AKIA)[A-Za-z0-9_+/=-]{12,}/i;

const result = await buildThirdPartyLicenseBundle({ rootDir: process.cwd() });
const repeatedResult = await buildThirdPartyLicenseBundle({ rootDir: process.cwd() });
const lock = JSON.parse(await readFile("package-lock.json", "utf8"));

assert.ok(result.entries.length >= 250, `许可证包覆盖依赖过少：${result.entries.length}`);
assert.equal(result.missing.length, 0, `以下生产依赖缺少可发布的许可证文本：\n${result.missing.join("\n")}`);
assert.equal(result.content, repeatedResult.content, "同一锁文件和依赖目录必须生成完全一致的许可证包");
assert.deepEqual(result.releaseTarget, { os: "linux", cpu: "x64", libc: "glibc" }, "许可证包目标必须与生产部署基线一致");
assert.match(result.content, /^MOLINWORD THIRD-PARTY LICENSE BUNDLE/m);
assert.match(result.content, /^Release target: linux\/x64\/glibc$/m);
assert.doesNotMatch(result.content, /D:\\|C:\\Users\\/i, "许可证包不能泄露构建机绝对路径");
assert.equal(hasValidSha512Integrity("sha512-A="), false, "短伪 SRI 不能通过 SHA-512 完整性校验");
assert.equal(hasValidSha512Integrity(lock.packages["node_modules/@esbuild/linux-x64"].integrity), true);
assert.equal(isTrustedLockedArchive(lock.packages["node_modules/@esbuild/linux-x64"], "@esbuild/linux-x64", "0.28.1"), true);
assert.equal(isTrustedLockedArchive({ ...lock.packages["node_modules/@esbuild/linux-x64"], resolved: "https://attacker.example/@esbuild/linux-x64/-/linux-x64-0.28.1.tgz" }, "@esbuild/linux-x64", "0.28.1"), false, "未知归档主机不能复用可信主包许可证");
assert.equal(sanitizePublicSource("https://token@example.com/source?access_token=secret", "example", "1.0.0"), "https://www.npmjs.com/package/example/v/1.0.0");
assert.equal(sanitizePublicSource("file:///home/runner/private", "example", "1.0.0"), "https://www.npmjs.com/package/example/v/1.0.0");
assert.equal(sanitizePublicSource("https://github.com/example/ghp_12345678901234567890/artifact", "example", "1.0.0"), "https://www.npmjs.com/package/example/v/1.0.0", "URL 路径内凭据不能进入公开产物");

for (const packageName of ["react", "minio", "caniuse-lite"]) {
  const lockedVersion = lock.packages?.[`node_modules/${packageName}`]?.version;
  assert.ok(lockedVersion, `package-lock.json 缺少核心依赖 ${packageName}`);
  const coordinate = `${packageName}@${lockedVersion}`;
  assert.ok(result.entries.some((entry) => `${entry.name}@${entry.version}` === coordinate), `许可证包缺少核心依赖 ${coordinate}`);
  assert.ok(result.content.includes(`Package: ${coordinate}`), `许可证正文缺少核心依赖标记 ${coordinate}`);
}

const fallbackEntry = result.entries.find((entry) => entry.name === "dingbat-to-unicode" && entry.version === "1.0.1");
assert.ok(fallbackEntry?.usedFallback, "没有许可证文件的依赖必须生成带署名的标准许可证文本");
assert.ok(fallbackEntry.licenseSources.every((source) => source.name.startsWith("standard:")), "普通无许可证文件依赖不能复用其他包的许可证");
assert.match(result.content, /Michael Williamson/);
assert.match(result.content, /Redistribution and use in source and binary forms/);

for (const packagePrefix of ["@esbuild/", "@rollup/rollup-"]) {
  const nativeEntry = result.entries.find((entry) => entry.name.startsWith(packagePrefix));
  assert.ok(nativeEntry?.usedFallback, `${packagePrefix} 平台包必须登记共享上游许可证`);
  assert.ok(nativeEntry.licenseSources.every((source) => source.name.startsWith("shared-upstream:")), `${nativeEntry.name} 只能复用已校验的同版本上游许可证`);
}
for (const coordinate of ["@esbuild/linux-x64@0.28.1", "@rollup/rollup-linux-x64-gnu@4.62.2"]) {
  assert.ok(result.entries.some((entry) => `${entry.name}@${entry.version}` === coordinate), `许可证包缺少 Linux 目标依赖 ${coordinate}`);
}
assert.ok(!result.entries.some((entry) => entry.name.includes("win32") || entry.name.endsWith("-musl")), "Linux glibc 发布包不能混入 Windows 或 musl 平台依赖");

for (const entry of result.entries) {
  const marker = `Package: ${entry.name}@${entry.version}`;
  assert.equal(result.content.split(marker).length - 1, 1, `依赖 ${marker} 必须且只能登记一次`);
  assert.ok(entry.licenseSources.length > 0 && entry.licenseSources.every((source) => source.content.trim()), `${marker} 缺少许可证正文`);
  const publicSource = new URL(entry.source);
  assert.equal(publicSource.protocol, "https:", `${marker} 来源必须使用 HTTPS`);
  assert.ok(["github.com", "gitlab.com", "bitbucket.org", "www.npmjs.com", "registry.npmjs.org", "registry.npmmirror.com"].includes(publicSource.hostname), `${marker} 来源域名未经批准`);
  assert.equal(publicSource.username || publicSource.password || publicSource.search || publicSource.hash, "", `${marker} 来源不能携带凭据、查询串或片段`);
  assert.doesNotMatch(decodeURIComponent(publicSource.pathname), publicCredentialPattern, `${marker} 来源路径不能携带凭据`);
}

console.log("第三方许可证发布包检查通过。", {
  packages: result.entries.length,
  fallbackPackages: result.entries.filter((entry) => entry.usedFallback).map((entry) => `${entry.name}@${entry.version}`),
  skippedOptionalPackages: result.skippedOptional.length,
  bytes: Buffer.byteLength(result.content)
});
