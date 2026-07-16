import assert from "node:assert/strict";
import { normalizeUploadedFileName } from "../server/upload-file-name.js";

const expectedChineseName = "中文导入测试.doc";
// 中文注解：Multer/Busboy 可能把 multipart 中的 UTF-8 文件名字节按 Latin-1 解释，复现浏览器上传后的真实错码形态。
const multerDecodedName = Buffer.from(expectedChineseName, "utf8").toString("latin1");

assert.equal(
  normalizeUploadedFileName(multerDecodedName),
  expectedChineseName,
  "中文上传文件名应从 Latin-1 错码恢复为 UTF-8"
);
assert.equal(normalizeUploadedFileName("quarterly-report.doc"), "quarterly-report.doc", "ASCII 文件名不应变化");
assert.equal(normalizeUploadedFileName("résumé.doc"), "résumé.doc", "真实 Latin-1 文件名不应被误修复");
assert.equal(normalizeUploadedFileName(expectedChineseName), expectedChineseName, "已经正确解码的中文文件名不应变化");

console.log("上传文件名编码检查通过。", { expectedChineseName, multerDecodedName });
