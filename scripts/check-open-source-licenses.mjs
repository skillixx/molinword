import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
const acceptedLicenses = new Set([
  "MIT",
  "Apache-2.0",
  "BSD",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "CC-BY-4.0",
  "BlueOak-1.0.0",
  "(MIT OR GPL-3.0-or-later)",
  "(MIT AND Zlib)"
]);
// 中文注解：这两个旧版 package.json 使用 licenses 数组，package-lock 未抄入 license；版本变化时必须重新人工复核。
const legacyLicenseOverrides = new Map([
  ["busboy@1.6.0", "MIT"],
  ["streamsearch@1.1.0", "MIT"]
]);

const inventory = [];
const violations = [];
for (const [packagePath, metadata] of Object.entries(lock.packages || {})) {
  if (!packagePath) continue;
  const name = packagePath.split("node_modules/").filter(Boolean).at(-1);
  const version = String(metadata.version || "");
  const overrideKey = `${name}@${version}`;
  const license = String(metadata.license || legacyLicenseOverrides.get(overrideKey) || "").trim();
  inventory.push({ name, version, license });
  if (!license) violations.push(`${overrideKey} 缺少许可证元数据`);
  else if (!acceptedLicenses.has(license)) violations.push(`${overrideKey} 使用未审核许可证 ${license}`);
}

assert.equal(violations.length, 0, `开源许可证门禁失败：\n${violations.join("\n")}`);
const counts = inventory.reduce((result, item) => {
  result[item.license] = (result[item.license] || 0) + 1;
  return result;
}, {});
const attributionPackages = inventory.filter((item) => ["Apache-2.0", "CC-BY-4.0"].includes(item.license));
const thirdPartyNotices = await readFile(new URL("../public/THIRD_PARTY_NOTICES.md", import.meta.url), "utf8").catch(() => "");
for (const item of attributionPackages) {
  // 中文注解：精确版本必须出现在随前端构建发布的署名文件中，依赖升级后遗漏更新会直接阻断发布。
  assert.ok(
    thirdPartyNotices.includes(`| ${item.name} | ${item.version} | ${item.license} |`),
    `THIRD_PARTY_NOTICES.md 缺少 ${item.name}@${item.version} 的许可证署名`
  );
}
assert.match(thirdPartyNotices, /Apache License, Version 2\.0/);
assert.match(thirdPartyNotices, /Creative Commons Attribution 4\.0 International/);

console.log("开源依赖许可证检查通过。", {
  packages: inventory.length,
  licenses: counts,
  attributionPackages: attributionPackages.map((item) => `${item.name}@${item.version}`)
});
