/**
 * 统一处理上传文件名，避免 multipart 解析层的编码差异泄漏到业务数据。
 *
 * @param {string} fileName Multer 提供的原始文件名
 * @returns {string} 可安全用于标题与文件索引的文件名
 */
export function normalizeUploadedFileName(fileName = "") {
  const originalName = String(fileName);
  if (!originalName || [...originalName].some((character) => character.codePointAt(0) > 0xff)) {
    // 中文注解：文件名已经包含真正的 Unicode 字符时保持原样，避免把正常中文再次转换。
    return originalName;
  }

  const latin1Bytes = Buffer.from(originalName, "latin1");
  try {
    // 中文注解：仅当整段 Latin-1 字节构成合法 UTF-8 时才恢复，真实的 é 等单字节文件名会因校验失败而保持不变。
    const utf8Name = new TextDecoder("utf-8", { fatal: true }).decode(latin1Bytes);
    return Buffer.from(utf8Name, "utf8").equals(latin1Bytes) ? utf8Name : originalName;
  } catch {
    return originalName;
  }
}
