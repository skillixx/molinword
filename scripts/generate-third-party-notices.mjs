import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { buildThirdPartyLicenseBundle } from "./third-party-license-bundle.mjs";

const rootDir = process.cwd();
const outputPath = path.join(rootDir, "dist", "THIRD_PARTY_LICENSES.txt");
const result = await buildThirdPartyLicenseBundle({ rootDir });

if (result.missing.length) {
  throw new Error(`第三方许可证发布包生成失败：\n${result.missing.join("\n")}`);
}

// 中文注解：许可证正文属于发布产物而不是源码授权；每次构建都按锁文件重建，避免依赖升级后遗留旧清单。
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, result.content, "utf8");

console.log("第三方许可证发布包已生成。", {
  output: path.relative(rootDir, outputPath).replaceAll("\\", "/"),
  packages: result.entries.length,
  skippedOptionalPackages: result.skippedOptional.length,
  bytes: Buffer.byteLength(result.content)
});
