import crypto from "node:crypto";
import { constants as fsConstants, createReadStream } from "node:fs";
import { lstat, mkdir, open, readdir, realpath, rm } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";
import { createGunzip, createGzip } from "node:zlib";
import {
  readBoundedReleaseFileSync,
  releaseArtifactRoots,
  releaseBuildInputRoots,
  verifyReleaseManifest
} from "../shared/release-manifest.js";

const tarBlockBytes = 512;
const maximumBundleManifestBytes = 4 * 1024 * 1024;
const maximumReleaseTargetBytes = 64 * 1024;
const maximumArchiveBytes = 256 * 1024 * 1024;
const maximumArchiveExpandedBytes = 160 * 1024 * 1024;
const maximumInstalledEntries = 8192;
const requiredLicensePath = "dist/THIRD_PARTY_LICENSES.txt";
const safeTargetValuePattern = /^[a-z0-9][a-z0-9_-]{0,31}$/;

function bundleError(message, detailCode = "release-bundle-failed") {
  return Object.assign(new Error(message), { detailCode });
}

async function readBoundedExternalFile(filePath, maximumBytes, label, detailCode = "invalid-external-file") {
  const absolutePath = path.resolve(String(filePath || ""));
  const beforePath = await lstat(absolutePath);
  if (beforePath.isSymbolicLink() || !beforePath.isFile() || beforePath.size <= 0 || beforePath.size > maximumBytes) {
    throw bundleError(`${label}不是符合大小限制的常规文件。`, detailCode);
  }
  const handle = await open(absolutePath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0));
  try {
    const beforeFd = await handle.stat();
    if (!beforeFd.isFile() || !sameFileIdentity(beforePath, beforeFd)) {
      throw bundleError(`${label}在打开前发生变化。`, detailCode);
    }
    const chunks = [];
    const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, maximumBytes));
    let totalBytes = 0;
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, null);
      if (bytesRead === 0) break;
      totalBytes += bytesRead;
      if (totalBytes > maximumBytes) throw bundleError(`${label}读取时超过大小限制。`, detailCode);
      chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
    }
    const afterFd = await handle.stat();
    const afterPath = await lstat(absolutePath);
    if (totalBytes !== beforeFd.size || !sameFileIdentity(beforeFd, afterFd) || !sameFileIdentity(beforeFd, afterPath)) {
      throw bundleError(`${label}在读取期间发生变化。`, detailCode);
    }
    return Buffer.concat(chunks, totalBytes);
  } finally {
    await handle.close();
  }
}

async function copyBoundedExternalFile({ sourcePath, destinationPath, maximumBytes, label }) {
  const absoluteSource = path.resolve(String(sourcePath || ""));
  const beforePath = await lstat(absoluteSource);
  if (beforePath.isSymbolicLink() || !beforePath.isFile() || beforePath.size <= 0 || beforePath.size > maximumBytes) {
    throw bundleError(`${label}不是符合大小限制的常规文件。`, "invalid-release-input");
  }
  const sourceHandle = await open(absoluteSource, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0));
  let destinationHandle;
  try {
    const beforeFd = await sourceHandle.stat();
    if (!beforeFd.isFile() || !sameFileIdentity(beforePath, beforeFd)) {
      throw bundleError(`${label}在打开前发生变化。`, "release-input-changed");
    }
    destinationHandle = await open(destinationPath, "wx", 0o400);
    const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, maximumBytes));
    let totalBytes = 0;
    while (true) {
      const { bytesRead } = await sourceHandle.read(buffer, 0, buffer.byteLength, null);
      if (bytesRead === 0) break;
      totalBytes += bytesRead;
      if (totalBytes > maximumBytes) throw bundleError(`${label}复制时超过大小限制。`, "release-input-too-large");
      let written = 0;
      while (written < bytesRead) {
        const result = await destinationHandle.write(buffer, written, bytesRead - written, null);
        if (result.bytesWritten <= 0) throw bundleError(`${label}无法完整写入 root-only 副本。`, "release-input-copy-failed");
        written += result.bytesWritten;
      }
    }
    const afterFd = await sourceHandle.stat();
    const afterPath = await lstat(absoluteSource);
    if (totalBytes !== beforeFd.size || !sameFileIdentity(beforeFd, afterFd) || !sameFileIdentity(beforeFd, afterPath)) {
      throw bundleError(`${label}在复制期间发生变化。`, "release-input-changed");
    }
    await destinationHandle.sync();
  } finally {
    await sourceHandle.close();
    await destinationHandle?.close().catch(() => {});
  }
}

// 中文注释：不可信传入文件先以 O_NOFOLLOW 和分块上限复制到新建的 root-only inode；后续验签与 tar 解压只读取该副本，旧写 FD 无法跨越信任边界。
export async function stageProductionReleaseInputs({
  archivePath,
  checksumPath,
  signaturePath,
  stagedOutputDirectory,
  expectedReleaseId
} = {}) {
  if (!/^[0-9a-f]{12}-[0-9a-f]{16}$/.test(String(expectedReleaseId || ""))) {
    throw bundleError("必须提供有效的期望发布号。", "invalid-expected-release-id");
  }
  const requestedOutput = path.resolve(String(stagedOutputDirectory || ""));
  const outputName = path.basename(requestedOutput);
  if (outputName !== `molinword-${expectedReleaseId}-verified`) {
    throw bundleError("root-only 复验目录必须使用绑定发布号的固定名称。", "invalid-verification-staging-path");
  }
  const requestedParent = path.dirname(requestedOutput);
  const parentMetadata = await lstat(requestedParent);
  if (parentMetadata.isSymbolicLink() || !parentMetadata.isDirectory()) {
    throw bundleError("root-only 复验父目录必须是常规目录。", "invalid-verification-staging-path");
  }
  const realParent = await realpath(requestedParent);
  if (requestedParent !== realParent || requestedOutput !== path.join(realParent, outputName)) {
    throw bundleError("root-only 复验目录不能经过符号链接。", "invalid-verification-staging-path");
  }
  if (process.platform !== "win32" && (parentMetadata.uid !== 0 || (parentMetadata.mode & 0o077) !== 0)) {
    throw bundleError("root-only 复验父目录必须由 root 独占。", "invalid-verification-staging-path");
  }
  const archiveName = path.basename(path.resolve(String(archivePath || "")));
  const checksumName = path.basename(path.resolve(String(checksumPath || "")));
  const signatureName = path.basename(path.resolve(String(signaturePath || "")));
  if (!new RegExp(`^molinword-${expectedReleaseId}-[a-z0-9_-]+-[a-z0-9_-]+-[a-z0-9_-]+\\.tar\\.gz$`).test(archiveName)
    || checksumName !== `${archiveName}.sha256`
    || signatureName !== `${checksumName}.sig`) {
    throw bundleError("传入三件套文件名与期望发布号不一致。", "invalid-release-input-name");
  }

  let outputCreated = false;
  try {
    await mkdir(requestedOutput, { recursive: false, mode: 0o700 });
    outputCreated = true;
    const stagedArchivePath = path.join(requestedOutput, archiveName);
    const stagedChecksumPath = path.join(requestedOutput, checksumName);
    const stagedSignaturePath = path.join(requestedOutput, signatureName);
    await copyBoundedExternalFile({ sourcePath: archivePath, destinationPath: stagedArchivePath, maximumBytes: maximumArchiveBytes, label: "生产发布归档" });
    await copyBoundedExternalFile({ sourcePath: checksumPath, destinationPath: stagedChecksumPath, maximumBytes: 4096, label: "生产发布摘要" });
    await copyBoundedExternalFile({ sourcePath: signaturePath, destinationPath: stagedSignaturePath, maximumBytes: 16 * 1024, label: "生产发布签名" });
    return Object.freeze({
      stagedDirectory: requestedOutput,
      archivePath: stagedArchivePath,
      checksumPath: stagedChecksumPath,
      signaturePath: stagedSignaturePath
    });
  } catch (error) {
    if (outputCreated) await rm(requestedOutput, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

function normalizeSigningPrivateKey(signingPrivateKey) {
  if (!signingPrivateKey) throw bundleError("生产发布包必须使用 CI 签名私钥。", "missing-release-signing-key");
  let key;
  try {
    key = signingPrivateKey.type === "private" ? signingPrivateKey : crypto.createPrivateKey(signingPrivateKey);
  } catch {
    throw bundleError("生产发布签名私钥无效。", "invalid-signing-key");
  }
  assertStrongSigningKey(key, "私钥");
  return key;
}

function assertStrongSigningKey(key, label) {
  const keyType = key.asymmetricKeyType;
  const details = key.asymmetricKeyDetails || {};
  if (new Set(["rsa", "rsa-pss"]).has(keyType)) {
    if (!Number.isSafeInteger(details.modulusLength) || details.modulusLength < 2048) {
      throw bundleError(`生产发布签名${label}的 RSA 强度不得低于 2048 位。`, "weak-signing-key");
    }
    return;
  }
  if (keyType === "ec" && new Set(["prime256v1", "secp384r1", "secp521r1"]).has(details.namedCurve)) return;
  throw bundleError(`生产发布签名${label}必须使用至少 2048 位 RSA/RSA-PSS 或 P-256/P-384/P-521。`, "unsupported-signing-key");
}

function normalizeSigningPublicKey(signingPublicKey) {
  if (!signingPublicKey) throw bundleError("生产发布签名公钥缺失。", "invalid-signing-public-key");
  if (signingPublicKey.type === "private") {
    throw bundleError("目标服务器只能部署发布公钥，禁止传入私钥。", "private-key-used-as-public-key");
  }
  let key;
  try {
    if (typeof signingPublicKey === "string" || Buffer.isBuffer(signingPublicKey)) {
      try {
        crypto.createPrivateKey(signingPublicKey);
        throw bundleError("目标服务器只能部署发布公钥，禁止传入私钥。", "private-key-used-as-public-key");
      } catch (error) {
        if (error?.detailCode === "private-key-used-as-public-key") throw error;
      }
    }
    key = signingPublicKey.type === "public" ? signingPublicKey : crypto.createPublicKey(signingPublicKey);
  } catch (error) {
    if (error?.detailCode === "private-key-used-as-public-key") throw error;
    throw bundleError("生产发布签名公钥无效。", "invalid-signing-public-key");
  }
  if (key.type !== "public") throw bundleError("生产发布验签必须使用公钥。", "invalid-signing-public-key");
  assertStrongSigningKey(key, "公钥");
  return key;
}

function isPathWithin(parentPath, childPath) {
  const relative = path.relative(parentPath, childPath);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function writeTarString(header, offset, length, value, label) {
  const content = Buffer.from(value, "utf8");
  if (content.byteLength > length) throw bundleError(`${label}超过 tar 字段长度。`, "unsupported-tar-path");
  content.copy(header, offset);
}

function writeTarOctal(header, offset, length, value, label) {
  const encoded = Math.trunc(value).toString(8).padStart(length - 1, "0");
  if (encoded.length > length - 1) throw bundleError(`${label}超过 tar 数值范围。`, "unsupported-tar-size");
  writeTarString(header, offset, length - 1, encoded, label);
  header[offset + length - 1] = 0;
}

// 中文注释：ustar 将长路径拆成 prefix/name 两段；这里只接受无反斜杠、无空段和无上跳段的相对路径，避免解压逃逸并保持 GNU tar 兼容。
function splitUstarPath(entryPath) {
  const directory = entryPath.endsWith("/");
  const normalized = directory ? entryPath.slice(0, -1) : entryPath;
  if (!normalized || normalized.includes("\0") || normalized.includes("\\")
    || normalized.startsWith("/") || normalized.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
    throw bundleError("发布包包含不安全的 tar 路径。", "unsafe-bundle-path");
  }
  const directName = directory ? `${normalized}/` : normalized;
  if (Buffer.byteLength(directName, "utf8") <= 100) return { name: directName, prefix: "" };

  const slashPositions = [];
  for (let index = normalized.indexOf("/"); index >= 0; index = normalized.indexOf("/", index + 1)) slashPositions.push(index);
  for (let index = slashPositions.length - 1; index >= 0; index -= 1) {
    const splitAt = slashPositions[index];
    const prefix = normalized.slice(0, splitAt);
    const leaf = `${normalized.slice(splitAt + 1)}${directory ? "/" : ""}`;
    if (Buffer.byteLength(prefix, "utf8") <= 155 && Buffer.byteLength(leaf, "utf8") <= 100) return { name: leaf, prefix };
  }
  throw bundleError("发布包路径超过 ustar 安全上限。", "unsupported-tar-path");
}

// 中文注释：归档头固定权限、属主编号与时间戳，既不携带构建机身份，也保证相同提交和制品生成完全相同的 tar 字节。
function createTarHeader({ entryPath, size, type }) {
  const header = Buffer.alloc(tarBlockBytes);
  const { name, prefix } = splitUstarPath(entryPath);
  writeTarString(header, 0, 100, name, "tar 文件名");
  writeTarOctal(header, 100, 8, type === "5" ? 0o755 : 0o644, "tar 权限");
  writeTarOctal(header, 108, 8, 0, "tar uid");
  writeTarOctal(header, 116, 8, 0, "tar gid");
  writeTarOctal(header, 124, 12, size, "tar 文件大小");
  writeTarOctal(header, 136, 12, 0, "tar 修改时间");
  header.fill(0x20, 148, 156);
  header[156] = type.charCodeAt(0);
  writeTarString(header, 257, 6, "ustar\0", "tar magic");
  writeTarString(header, 263, 2, "00", "tar version");
  writeTarString(header, 265, 32, "molinword", "tar owner");
  writeTarString(header, 297, 32, "molinword", "tar group");
  if (prefix) writeTarString(header, 345, 155, prefix, "tar 路径前缀");
  let checksum = 0;
  for (const byte of header) checksum += byte;
  writeTarString(header, 148, 6, checksum.toString(8).padStart(6, "0"), "tar checksum");
  header[154] = 0;
  header[155] = 0x20;
  return header;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function readReleaseTarget(rootDir) {
  let target;
  try {
    const targetFile = readBoundedReleaseFileSync({
      rootDir,
      relativePath: "ops/release-target.json",
      maximumBytes: maximumReleaseTargetBytes,
      requireNonEmpty: true
    });
    target = JSON.parse(targetFile.content.toString("utf8"));
  } catch {
    throw bundleError("生产发布目标缺失、过大或不是有效 JSON。", "invalid-release-target");
  }
  const keys = Object.keys(target || {}).sort();
  if (keys.join(",") !== "cpu,libc,os"
    || !safeTargetValuePattern.test(String(target.os || ""))
    || !safeTargetValuePattern.test(String(target.cpu || ""))
    || !safeTargetValuePattern.test(String(target.libc || ""))) {
    throw bundleError("生产发布目标字段无效。", "invalid-release-target");
  }
  return Object.freeze({ os: target.os, cpu: target.cpu, libc: target.libc });
}

function collectDirectoryEntries(topLevelDirectory, files) {
  const directories = new Set([`${topLevelDirectory}/`]);
  for (const file of files) {
    const parts = file.path.split("/");
    for (let index = 1; index < parts.length; index += 1) {
      directories.add(`${topLevelDirectory}/${parts.slice(0, index).join("/")}/`);
    }
  }
  return [...directories].sort((left, right) => {
    const depthDifference = left.split("/").length - right.split("/").length;
    return depthDifference || left.localeCompare(right, "en");
  });
}

// 中文注释：生成端与复验端共享 8192 条目上限；在创建输出文件前同时计算目录和文件，避免生成一个自身部署工具必然拒绝的签名包。
export function validateProductionReleaseEntryBudget({ topLevelDirectory, files }) {
  const directories = collectDirectoryEntries(topLevelDirectory, files);
  if (directories.length + files.length > maximumInstalledEntries) {
    throw bundleError("生产发布归档目录与文件总数超过安全上限。", "release-archive-too-many-entries");
  }
  return Object.freeze([...directories]);
}

function sameFileIdentity(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs;
}

// 中文注释：tar 正文始终从同一个 O_NOFOLLOW 文件描述符流出，并同时复算摘要；路径、FD 身份及读取前后元数据任一漂移都会中止且删除半成品。
async function* streamVerifiedFile(rootDir, file) {
  const absolutePath = path.resolve(rootDir, ...file.path.split("/"));
  const beforePath = await lstat(absolutePath);
  if (beforePath.isSymbolicLink() || !beforePath.isFile() || beforePath.size !== file.bytes) {
    throw bundleError(`发布包源文件 ${file.path} 在打包前发生变化。`, "bundle-source-changed");
  }
  const resolvedBefore = await realpath(absolutePath);
  if (!isPathWithin(rootDir, resolvedBefore)) throw bundleError(`发布包源文件 ${file.path} 离开项目根目录。`, "unsafe-bundle-source");

  const handle = await open(absolutePath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0));
  try {
    const beforeFd = await handle.stat();
    if (!beforeFd.isFile() || !sameFileIdentity(beforePath, beforeFd)) {
      throw bundleError(`发布包源文件 ${file.path} 在打开前发生变化。`, "bundle-source-changed");
    }
    const digest = crypto.createHash("sha256");
    let bytes = 0;
    for await (const chunk of handle.createReadStream({ autoClose: false })) {
      bytes += chunk.byteLength;
      if (bytes > file.bytes) throw bundleError(`发布包源文件 ${file.path} 在读取期间增长。`, "bundle-source-changed");
      digest.update(chunk);
      yield chunk;
    }
    const afterFd = await handle.stat();
    const afterPath = await lstat(absolutePath);
    const resolvedAfter = await realpath(absolutePath);
    if (bytes !== file.bytes
      || digest.digest("hex") !== file.sha256
      || !sameFileIdentity(beforeFd, afterFd)
      || !sameFileIdentity(beforeFd, afterPath)
      || resolvedAfter !== resolvedBefore
      || !isPathWithin(rootDir, resolvedAfter)) {
      throw bundleError(`发布包源文件 ${file.path} 在读取期间发生变化。`, "bundle-source-changed");
    }
  } finally {
    await handle.close();
  }
}

// 中文注释：目录先去重并按深度排序，文件再按稳定路径顺序流式写入；每个正文补齐 512 字节边界，末尾写两个零块，确保标准 tar 可读取。
async function* createTarStream({ rootDir, topLevelDirectory, payloadFiles, bundleManifestContent }) {
  const virtualManifestPath = "BUNDLE-MANIFEST.json";
  const allFiles = [...payloadFiles, {
    path: virtualManifestPath,
    bytes: bundleManifestContent.byteLength,
    sha256: crypto.createHash("sha256").update(bundleManifestContent).digest("hex"),
    virtualContent: bundleManifestContent
  }].sort((left, right) => left.path.localeCompare(right.path, "en"));

  for (const directory of validateProductionReleaseEntryBudget({ topLevelDirectory, files: allFiles })) {
    yield createTarHeader({ entryPath: directory, size: 0, type: "5" });
  }
  for (const file of allFiles) {
    const archivePath = `${topLevelDirectory}/${file.path}`;
    yield createTarHeader({ entryPath: archivePath, size: file.bytes, type: "0" });
    if (file.virtualContent) yield file.virtualContent;
    else yield* streamVerifiedFile(rootDir, file);
    const paddingBytes = (tarBlockBytes - (file.bytes % tarBlockBytes)) % tarBlockBytes;
    if (paddingBytes) yield Buffer.alloc(paddingBytes);
  }
  yield Buffer.alloc(tarBlockBytes * 2);
}

async function hashFile(filePath) {
  const digest = crypto.createHash("sha256");
  for await (const chunk of createReadStream(filePath)) digest.update(chunk);
  return digest.digest("hex");
}

// 中文注释：输出位置在创建前后各校验一次真实路径，禁止写进任何受摘要覆盖目录，避免输出文件反过来改变正在生成的发布清单。
async function validateOutputDirectory(rootDir, requestedOutputDirectory) {
  const outputDirectory = path.resolve(requestedOutputDirectory || path.join(rootDir, "release"));
  const rootRealPath = await realpath(rootDir);
  if (outputDirectory === rootRealPath) throw bundleError("发布包不能直接写入项目根目录。", "unsafe-bundle-output");
  for (const artifactRoot of new Set([...releaseArtifactRoots, ...releaseBuildInputRoots])) {
    if (isPathWithin(path.resolve(rootRealPath, artifactRoot), outputDirectory)) {
      throw bundleError("发布包输出目录不能位于发布清单覆盖目录内。", "unsafe-bundle-output");
    }
  }
  await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
  const metadata = await lstat(outputDirectory);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw bundleError("发布包输出目录必须是常规目录。", "invalid-bundle-output");
  }
  const outputRealPath = await realpath(outputDirectory);
  if (outputRealPath === rootRealPath) throw bundleError("发布包不能直接写入项目根目录。", "unsafe-bundle-output");
  for (const artifactRoot of new Set([...releaseArtifactRoots, ...releaseBuildInputRoots])) {
    if (isPathWithin(path.resolve(rootRealPath, artifactRoot), outputRealPath)) {
      throw bundleError("发布包输出目录不能位于发布清单覆盖目录内。", "unsafe-bundle-output");
    }
  }
  return outputRealPath;
}

function exactObjectKeys(value, expectedKeys) {
  return value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).sort().join(",") === [...expectedKeys].sort().join(",");
}

function validateBundleManifestShape(bundleManifest) {
  const manifestKeys = [
    "artifactSha256", "files", "gitCommit", "kind", "packageVersion", "releaseId",
    "releaseTarget", "schemaVersion", "topLevelDirectory"
  ];
  if (!exactObjectKeys(bundleManifest, manifestKeys)
    || bundleManifest.schemaVersion !== 1
    || bundleManifest.kind !== "molinword-production-release-bundle"
    || !/^[0-9a-f]{12}-[0-9a-f]{16}$/.test(String(bundleManifest.releaseId || ""))
    || !/^[0-9a-f]{40}$/.test(String(bundleManifest.gitCommit || ""))
    || !/^[0-9a-f]{64}$/.test(String(bundleManifest.artifactSha256 || ""))
    || typeof bundleManifest.packageVersion !== "string" || !bundleManifest.packageVersion
    || !exactObjectKeys(bundleManifest.releaseTarget, ["cpu", "libc", "os"])
    || !Object.values(bundleManifest.releaseTarget || {}).every((value) => safeTargetValuePattern.test(String(value || "")))
    || !Array.isArray(bundleManifest.files)
    || bundleManifest.files.length < 1
    || bundleManifest.files.length > maximumInstalledEntries) {
    throw bundleError("发布包内部清单结构无效。", "invalid-bundle-manifest");
  }
  const seenPaths = new Set();
  for (const file of bundleManifest.files) {
    if (!exactObjectKeys(file, ["bytes", "path", "sha256"])
      || typeof file.path !== "string" || !file.path
      || !Number.isSafeInteger(file.bytes) || file.bytes < 0
      || !/^[0-9a-f]{64}$/.test(String(file.sha256 || ""))) {
      throw bundleError("发布包内部文件摘要字段无效。", "invalid-bundle-manifest");
    }
    splitUstarPath(`molinword-placeholder/${file.path}`);
    if (file.path.endsWith("/") || seenPaths.has(file.path) || file.path === "BUNDLE-MANIFEST.json") {
      throw bundleError("发布包内部文件路径重复或无效。", "invalid-bundle-manifest");
    }
    seenPaths.add(file.path);
  }
}

async function collectInstalledTree(rootDir, { allowNodeModules = false } = {}) {
  const files = [];
  const directories = [];
  async function visit(relativeDirectory) {
    const absoluteDirectory = relativeDirectory
      ? path.join(rootDir, ...relativeDirectory.split("/"))
      : rootDir;
    for (const child of await readdir(absoluteDirectory)) {
      if (files.length + directories.length >= maximumInstalledEntries) {
        throw bundleError("解压目录条目数量超过安全上限。", "installed-tree-too-large");
      }
      const relativePath = relativeDirectory ? `${relativeDirectory}/${child}` : child;
      const absolutePath = path.join(absoluteDirectory, child);
      const metadata = await lstat(absolutePath);
      if (metadata.isSymbolicLink()) throw bundleError(`解压目录包含符号链接：${relativePath}`, "unsafe-installed-entry");
      const resolved = await realpath(absolutePath);
      if (!isPathWithin(rootDir, resolved)) throw bundleError(`解压条目离开发布目录：${relativePath}`, "unsafe-installed-entry");
      if (metadata.isDirectory()) {
        if (relativePath === "node_modules" && allowNodeModules) {
          directories.push(relativePath);
          continue;
        }
        if (process.platform !== "win32" && (metadata.mode & 0o777) !== 0o755) {
          throw bundleError(`解压目录权限必须为 0755：${relativePath}`, "unsafe-installed-mode");
        }
        directories.push(relativePath);
        await visit(relativePath);
      } else if (metadata.isFile()) {
        if (process.platform !== "win32" && (metadata.mode & 0o777) !== 0o644) {
          throw bundleError(`解压文件权限必须为 0644：${relativePath}`, "unsafe-installed-mode");
        }
        files.push(relativePath);
      }
      else throw bundleError(`解压目录包含不支持的文件类型：${relativePath}`, "unsafe-installed-entry");
    }
  }
  await visit("");
  return { files: files.sort((a, b) => a.localeCompare(b, "en")), directories };
}

function tarText(header, offset, length) {
  return header.subarray(offset, offset + length).toString("utf8").replace(/\0.*$/s, "");
}

function tarOctal(header, offset, length, label) {
  const text = header.subarray(offset, offset + length).toString("ascii").replace(/\0.*$/s, "").trim();
  if (!/^[0-7]+$/.test(text)) throw bundleError(`${label}不是有效八进制数。`, "invalid-release-archive");
  const value = Number.parseInt(text, 8);
  if (!Number.isSafeInteger(value) || value < 0) throw bundleError(`${label}超过安全范围。`, "invalid-release-archive");
  return value;
}

function parseTarHeader(header) {
  const storedChecksum = tarOctal(header, 148, 8, "tar checksum");
  const checksumHeader = Buffer.from(header);
  checksumHeader.fill(0x20, 148, 156);
  let computedChecksum = 0;
  for (const byte of checksumHeader) computedChecksum += byte;
  if (storedChecksum !== computedChecksum
    || tarText(header, 257, 6) !== "ustar"
    || tarText(header, 263, 2) !== "00") {
    throw bundleError("生产发布归档头或校验和无效。", "invalid-release-archive");
  }
  const name = tarText(header, 0, 100);
  const prefix = tarText(header, 345, 155);
  const entryPath = prefix ? `${prefix}/${name}` : name;
  const typeByte = header[156];
  const type = typeByte === 0 ? "0" : String.fromCharCode(typeByte);
  if (!new Set(["0", "5"]).has(type)) throw bundleError("生产发布归档包含不允许的条目类型。", "unsafe-release-archive-entry");
  const size = tarOctal(header, 124, 12, "tar 文件大小");
  const mode = tarOctal(header, 100, 8, "tar 权限");
  const mtime = tarOctal(header, 136, 12, "tar 修改时间");
  if (mtime !== 0 || mode !== (type === "5" ? 0o755 : 0o644) || (type === "5" && size !== 0)) {
    throw bundleError("生产发布归档元数据不符合确定性约束。", "invalid-release-archive");
  }
  splitUstarPath(entryPath);
  return { entryPath, type, size };
}

function validateArchiveEntryPath(entryPath, expectedTopLevel, type) {
  if (entryPath === `${expectedTopLevel}/`) {
    if (type !== "5") throw bundleError("生产发布归档顶层条目必须是目录。", "unsafe-release-archive-entry");
    return "";
  }
  if (!entryPath.startsWith(`${expectedTopLevel}/`)) {
    throw bundleError("生产发布归档必须只有一个受控顶层目录。", "unsafe-release-archive-entry");
  }
  const relativePath = entryPath.slice(expectedTopLevel.length + 1).replace(/\/$/, "");
  if (!relativePath || relativePath.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
    throw bundleError("生产发布归档条目路径无效。", "unsafe-release-archive-entry");
  }
  return relativePath;
}

// 中文注释：预解压检查在同一归档 FD 上同时完成压缩字节摘要、受限解压和 tar 状态机解析；只允许普通文件/目录、唯一顶层路径、无重复条目及清单精确文件集。
export async function verifyProductionReleaseArchive({
  archivePath,
  checksumPath,
  signaturePath,
  signingPublicKey,
  expectedReleaseId
} = {}) {
  if (!/^[0-9a-f]{12}-[0-9a-f]{16}$/.test(String(expectedReleaseId || ""))) {
    throw bundleError("必须提供有效的期望发布号。", "invalid-expected-release-id");
  }
  const publicKey = normalizeSigningPublicKey(signingPublicKey);

  const normalizedArchivePath = path.resolve(String(archivePath || ""));
  const archiveFileName = path.basename(normalizedArchivePath);
  if (!new RegExp(`^molinword-${expectedReleaseId}-[a-z0-9_-]+-[a-z0-9_-]+-[a-z0-9_-]+\\.tar\\.gz$`).test(archiveFileName)) {
    throw bundleError("生产发布归档文件名与期望发布号不一致。", "invalid-release-archive-name");
  }
  const checksumContent = await readBoundedExternalFile(checksumPath, 4096, "发布摘要文件", "invalid-release-checksum");
  const signature = await readBoundedExternalFile(signaturePath, 16 * 1024, "发布签名文件", "invalid-release-signature");
  const checksumText = checksumContent.toString("utf8");
  const checksumMatch = checksumText.match(/^([0-9a-f]{64})  ([^/\\\r\n]+)\n$/);
  if (!checksumMatch || checksumMatch[2] !== archiveFileName) {
    throw bundleError("发布摘要内容或文件名无效。", "invalid-release-checksum");
  }
  const verifier = crypto.createVerify("sha256");
  verifier.update(checksumContent);
  verifier.end();
  if (!verifier.verify(publicKey, signature)) {
    throw bundleError("生产发布摘要签名验证失败。", "invalid-release-signature");
  }

  const beforePath = await lstat(normalizedArchivePath);
  if (beforePath.isSymbolicLink() || !beforePath.isFile() || beforePath.size <= 0 || beforePath.size > maximumArchiveBytes) {
    throw bundleError("生产发布归档不是符合大小限制的常规文件。", "invalid-release-archive");
  }
  const resolvedBefore = await realpath(normalizedArchivePath);
  const handle = await open(normalizedArchivePath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0));
  const expectedTopLevel = `molinword-${expectedReleaseId}`;
  const seenEntries = new Set();
  const directories = [];
  const files = [];
  let bundleManifestChunks = [];
  let bundleManifestBytes = 0;
  let expandedBytes = 0;
  let pending = Buffer.alloc(0);
  let current = null;
  let zeroBlocks = 0;
  let archiveEnded = false;

  function finishCurrentFile() {
    if (!current) return;
    if (current.type === "0") {
      files.push({
        path: current.relativePath,
        bytes: current.size,
        sha256: current.digest.digest("hex")
      });
    }
    current = null;
  }

  try {
    const beforeFd = await handle.stat();
    if (!beforeFd.isFile() || !sameFileIdentity(beforePath, beforeFd)) {
      throw bundleError("生产发布归档在打开前发生变化。", "release-archive-changed");
    }
    const compressedDigest = crypto.createHash("sha256");
    const hashingStream = new Transform({
      transform(chunk, _encoding, callback) {
        compressedDigest.update(chunk);
        callback(null, chunk);
      }
    });
    const decompressed = handle.createReadStream({ autoClose: false }).pipe(hashingStream).pipe(createGunzip());
    for await (const chunk of decompressed) {
      expandedBytes += chunk.byteLength;
      if (expandedBytes > maximumArchiveExpandedBytes) {
        throw bundleError("生产发布归档解压体积超过安全上限。", "release-archive-too-large");
      }
      pending = pending.byteLength ? Buffer.concat([pending, chunk]) : chunk;
      while (pending.byteLength > 0) {
        if (archiveEnded) {
          if (!pending.every((byte) => byte === 0)) throw bundleError("生产发布归档结束块后包含额外数据。", "invalid-release-archive");
          pending = Buffer.alloc(0);
          break;
        }
        if (!current) {
          if (pending.byteLength < tarBlockBytes) break;
          const header = pending.subarray(0, tarBlockBytes);
          pending = pending.subarray(tarBlockBytes);
          if (header.every((byte) => byte === 0)) {
            zeroBlocks += 1;
            if (zeroBlocks === 2) archiveEnded = true;
            continue;
          }
          if (zeroBlocks > 0) throw bundleError("生产发布归档结束块不连续。", "invalid-release-archive");
          if (seenEntries.size >= maximumInstalledEntries) throw bundleError("生产发布归档条目数超过安全上限。", "release-archive-too-large");
          const parsed = parseTarHeader(header);
          if (seenEntries.has(parsed.entryPath)) throw bundleError("生产发布归档包含重复条目。", "unsafe-release-archive-entry");
          seenEntries.add(parsed.entryPath);
          const relativePath = validateArchiveEntryPath(parsed.entryPath, expectedTopLevel, parsed.type);
          if (parsed.type === "5") {
            directories.push(parsed.entryPath);
            continue;
          }
          const maximumEntryBytes = relativePath === "BUNDLE-MANIFEST.json" ? maximumBundleManifestBytes : 32 * 1024 * 1024;
          if (parsed.size > maximumEntryBytes) throw bundleError("生产发布归档单文件超过安全上限。", "release-archive-too-large");
          current = {
            ...parsed,
            relativePath,
            remaining: parsed.size,
            padding: (tarBlockBytes - (parsed.size % tarBlockBytes)) % tarBlockBytes,
            digest: crypto.createHash("sha256")
          };
          if (current.remaining === 0 && current.padding === 0) finishCurrentFile();
          continue;
        }
        if (current.remaining > 0) {
          const consumed = Math.min(current.remaining, pending.byteLength);
          if (consumed === 0) break;
          const body = pending.subarray(0, consumed);
          pending = pending.subarray(consumed);
          current.remaining -= consumed;
          current.digest.update(body);
          if (current.relativePath === "BUNDLE-MANIFEST.json") {
            bundleManifestBytes += consumed;
            if (bundleManifestBytes > maximumBundleManifestBytes) throw bundleError("发布包内部清单超过安全上限。", "invalid-bundle-manifest");
            bundleManifestChunks.push(Buffer.from(body));
          }
          continue;
        }
        if (current.padding > 0) {
          if (pending.byteLength < current.padding) break;
          if (!pending.subarray(0, current.padding).every((byte) => byte === 0)) {
            throw bundleError("生产发布归档正文填充不是零字节。", "invalid-release-archive");
          }
          pending = pending.subarray(current.padding);
          current.padding = 0;
        }
        finishCurrentFile();
      }
    }
    if (current || !archiveEnded || zeroBlocks < 2 || pending.byteLength > 0) {
      throw bundleError("生产发布归档被截断或缺少结束块。", "invalid-release-archive");
    }
    const afterFd = await handle.stat();
    const afterPath = await lstat(normalizedArchivePath);
    const resolvedAfter = await realpath(normalizedArchivePath);
    if (!sameFileIdentity(beforeFd, afterFd)
      || !sameFileIdentity(beforeFd, afterPath)
      || resolvedAfter !== resolvedBefore
      || compressedDigest.digest("hex") !== checksumMatch[1]) {
      throw bundleError("生产发布归档摘要不一致或读取期间发生变化。", "release-archive-changed");
    }
  } finally {
    await handle.close();
  }

  let bundleManifest;
  try {
    bundleManifest = JSON.parse(Buffer.concat(bundleManifestChunks, bundleManifestBytes).toString("utf8"));
  } catch {
    throw bundleError("发布包内部清单缺失或不是有效 JSON。", "invalid-bundle-manifest");
  } finally {
    bundleManifestChunks = [];
  }
  validateBundleManifestShape(bundleManifest);
  const actualPayloadFiles = files
    .filter((file) => file.path !== "BUNDLE-MANIFEST.json")
    .sort((left, right) => left.path.localeCompare(right.path, "en"));
  if (bundleManifest.releaseId !== expectedReleaseId
    || bundleManifest.topLevelDirectory !== expectedTopLevel
    || stableJson(bundleManifest.files) !== stableJson(actualPayloadFiles)) {
    throw bundleError("生产发布归档条目与内部清单不一致。", "bundle-manifest-mismatch");
  }
  const archiveTarget = `${bundleManifest.releaseTarget.os}-${bundleManifest.releaseTarget.cpu}-${bundleManifest.releaseTarget.libc}`;
  if (archiveFileName !== `molinword-${expectedReleaseId}-${archiveTarget}.tar.gz`) {
    throw bundleError("生产发布归档目标与内部清单不一致。", "bundle-manifest-mismatch");
  }
  const licenseFile = actualPayloadFiles.find((file) => file.path === requiredLicensePath);
  const releaseManifestFile = actualPayloadFiles.find((file) => file.path === "dist/release-manifest.json");
  if (!licenseFile || licenseFile.bytes <= 0 || !releaseManifestFile || releaseManifestFile.bytes <= 0) {
    throw bundleError("生产发布归档缺少许可证或发布清单。", "missing-required-release-file");
  }
  const expectedDirectories = collectDirectoryEntries(expectedTopLevel, files)
    .sort((left, right) => left.localeCompare(right, "en"));
  if (stableJson([...directories].sort((left, right) => left.localeCompare(right, "en"))) !== stableJson(expectedDirectories)) {
    throw bundleError("生产发布归档包含额外目录或缺少必要目录。", "unsafe-release-archive-entry");
  }
  return Object.freeze({
    releaseId: expectedReleaseId,
    releaseTarget: Object.freeze({ ...bundleManifest.releaseTarget }),
    fileCount: actualPayloadFiles.length,
    archiveSha256: checksumMatch[1]
  });
}

// 中文注释：该复验必须在 npm ci 之前对全目录执行；除内部清单列出的文件和必要目录外，任何旧 .npmrc、.env、缓存、链接或额外文件都会导致部署失败。
export async function verifyInstalledProductionReleaseBundle({
  rootDir = process.cwd(),
  expectedReleaseId = "",
  allowNodeModules = false
} = {}) {
  if (!/^[0-9a-f]{12}-[0-9a-f]{16}$/.test(String(expectedReleaseId || ""))) {
    throw bundleError("必须提供有效的期望发布号。", "invalid-expected-release-id");
  }
  const normalizedRoot = await realpath(path.resolve(rootDir));
  const { manifest, snapshot, manifestDescriptor } = verifyReleaseManifest({
    rootDir: normalizedRoot,
    expectedReleaseId,
    returnSnapshot: true
  });
  const releaseTarget = readReleaseTarget(normalizedRoot);
  const expectedFiles = [...snapshot.entries, manifestDescriptor]
    .sort((left, right) => left.path.localeCompare(right.path, "en"));

  let bundleManifest;
  try {
    const bundleFile = readBoundedReleaseFileSync({
      rootDir: normalizedRoot,
      relativePath: "BUNDLE-MANIFEST.json",
      maximumBytes: maximumBundleManifestBytes,
      requireNonEmpty: true
    });
    bundleManifest = JSON.parse(bundleFile.content.toString("utf8"));
  } catch {
    throw bundleError("发布包内部清单缺失、过大或不是有效 JSON。", "invalid-bundle-manifest");
  }
  validateBundleManifestShape(bundleManifest);
  const expectedTopLevel = `molinword-${manifest.releaseId}`;
  if (bundleManifest.releaseId !== manifest.releaseId
    || bundleManifest.gitCommit !== manifest.gitCommit
    || bundleManifest.packageVersion !== manifest.packageVersion
    || bundleManifest.artifactSha256 !== manifest.artifactSha256
    || stableJson(bundleManifest.releaseTarget) !== stableJson(releaseTarget)
    || bundleManifest.topLevelDirectory !== expectedTopLevel
    || stableJson(bundleManifest.files) !== stableJson(expectedFiles)) {
    throw bundleError("发布包内部清单与实际制品不一致。", "bundle-manifest-mismatch");
  }
  const installedTree = await collectInstalledTree(normalizedRoot, { allowNodeModules });
  const expectedFilePaths = [...expectedFiles.map((file) => file.path), "BUNDLE-MANIFEST.json"]
    .sort((left, right) => left.localeCompare(right, "en"));
  if (stableJson(installedTree.files) !== stableJson(expectedFilePaths)) {
    throw bundleError("解压目录包含未批准文件或缺少发布文件。", "installed-file-set-mismatch");
  }
  const expectedDirectories = new Set();
  for (const filePath of expectedFilePaths) {
    const parts = filePath.split("/");
    for (let index = 1; index < parts.length; index += 1) expectedDirectories.add(parts.slice(0, index).join("/"));
  }
  if (allowNodeModules) expectedDirectories.add("node_modules");
  const actualDirectories = [...installedTree.directories].sort((left, right) => left.localeCompare(right, "en"));
  const approvedDirectories = [...expectedDirectories].sort((left, right) => left.localeCompare(right, "en"));
  if (stableJson(actualDirectories) !== stableJson(approvedDirectories)) {
    throw bundleError("解压目录包含未批准目录或缺少发布目录。", "installed-directory-set-mismatch");
  }
  return Object.freeze({ releaseId: manifest.releaseId, releaseTarget, fileCount: expectedFiles.length });
}

export async function createProductionReleaseBundle({
  rootDir = process.cwd(),
  outputDirectory,
  signingPrivateKey,
  unsignedForCi = false
} = {}) {
  const normalizedRoot = await realpath(path.resolve(rootDir));
  if (unsignedForCi && signingPrivateKey) throw bundleError("无密钥 CI 打包阶段不能同时接收签名私钥。", "unexpected-signing-key");
  const normalizedSigningKey = unsignedForCi ? null : normalizeSigningPrivateKey(signingPrivateKey);
  // 中文注释：打包器强制要求真实 Git 根、HEAD 一致和全部构建输入干净；校验同时返回唯一制品快照，后续不再按路径重新枚举另一份可能漂移的清单。
  const { manifest, snapshot, manifestDescriptor } = verifyReleaseManifest({
    rootDir: normalizedRoot,
    requireGit: true,
    requireClean: true,
    returnSnapshot: true
  });
  const releaseTarget = readReleaseTarget(normalizedRoot);
  const licenseFile = snapshot.entries.find((entry) => entry.path === requiredLicensePath);
  if (!licenseFile || licenseFile.bytes <= 0) {
    throw bundleError("生产发布包必须包含非空第三方许可证汇总。", "missing-third-party-licenses");
  }
  const payloadFiles = [...snapshot.entries, manifestDescriptor]
    .sort((left, right) => left.path.localeCompare(right.path, "en"));
  const topLevelDirectory = `molinword-${manifest.releaseId}`;
  const bundleManifest = {
    schemaVersion: 1,
    kind: "molinword-production-release-bundle",
    releaseId: manifest.releaseId,
    gitCommit: manifest.gitCommit,
    packageVersion: manifest.packageVersion,
    artifactSha256: manifest.artifactSha256,
    releaseTarget,
    topLevelDirectory,
    files: payloadFiles.map((file) => ({ path: file.path, bytes: file.bytes, sha256: file.sha256 }))
  };
  // 中文注释：内部清单不记录构建时间或本机路径，使同一提交和制品在不同受控构建目录中得到相同归档字节。
  const bundleManifestContent = Buffer.from(`${stableJson(bundleManifest)}\n`, "utf8");
  if (bundleManifestContent.byteLength > maximumBundleManifestBytes) {
    throw bundleError("发布包内部清单超过安全上限。", "bundle-manifest-too-large");
  }
  validateProductionReleaseEntryBudget({
    topLevelDirectory,
    files: [...payloadFiles, { path: "BUNDLE-MANIFEST.json", bytes: bundleManifestContent.byteLength }]
  });

  const outputRealPath = await validateOutputDirectory(normalizedRoot, outputDirectory);
  const targetLabel = `${releaseTarget.os}-${releaseTarget.cpu}-${releaseTarget.libc}`;
  const archiveFileName = `molinword-${manifest.releaseId}-${targetLabel}.tar.gz`;
  const archivePath = path.join(outputRealPath, archiveFileName);
  const checksumPath = `${archivePath}.sha256`;
  const signaturePath = `${checksumPath}.sig`;
  let archiveCreated = false;
  let checksumCreated = false;
  let signatureCreated = false;
  let archiveHandle;
  let checksumHandle;
  let signatureHandle;
  try {
    // 中文注释：归档与摘要使用独占创建；同一发布号重跑必须显式更换目录，不能静默覆盖已经交付的制品。
    archiveHandle = await open(archivePath, "wx", 0o600);
    archiveCreated = true;
    await pipeline(
      Readable.from(createTarStream({ rootDir: normalizedRoot, topLevelDirectory, payloadFiles, bundleManifestContent })),
      createGzip({ level: 9, mtime: 0 }),
      archiveHandle.createWriteStream()
    );
    archiveHandle = undefined;
    const archiveSha256 = await hashFile(archivePath);
    const checksumContent = `${archiveSha256}  ${archiveFileName}\n`;
    checksumHandle = await open(checksumPath, "wx", 0o600);
    checksumCreated = true;
    await checksumHandle.writeFile(checksumContent, "utf8");
    await checksumHandle.close();
    checksumHandle = undefined;
    if (normalizedSigningKey) {
      // 中文注释：签名覆盖完整 checksum 行（摘要和文件名），服务器用预置公钥先验签再校验归档，阻止同渠道攻击者替换归档并重算摘要。
      const signer = crypto.createSign("sha256");
      signer.update(checksumContent, "utf8");
      signer.end();
      const signature = signer.sign(normalizedSigningKey);
      signatureHandle = await open(signaturePath, "wx", 0o600);
      signatureCreated = true;
      await signatureHandle.writeFile(signature);
      await signatureHandle.close();
      signatureHandle = undefined;
    }
    return Object.freeze({
      releaseId: manifest.releaseId,
      releaseTarget,
      archivePath,
      checksumPath,
      signaturePath: normalizedSigningKey ? signaturePath : null,
      archiveSha256,
      entryCount: payloadFiles.length + 1
    });
  } catch (error) {
    await archiveHandle?.close().catch(() => {});
    await checksumHandle?.close().catch(() => {});
    await signatureHandle?.close().catch(() => {});
    await Promise.all([
      archiveCreated ? rm(archivePath, { force: true }).catch(() => {}) : Promise.resolve(),
      checksumCreated ? rm(checksumPath, { force: true }).catch(() => {}) : Promise.resolve(),
      signatureCreated ? rm(signaturePath, { force: true }).catch(() => {}) : Promise.resolve()
    ]);
    if (error?.code === "EEXIST") throw bundleError("同名生产发布包已存在，拒绝覆盖。", "bundle-already-exists");
    throw error;
  }
}

async function runCli() {
  try {
    const argumentsList = process.argv.slice(2);
    const unsupported = argumentsList.filter((argument) => argument !== "--unsigned-for-ci" && !argument.startsWith("--output-dir="));
    if (unsupported.length > 0
      || argumentsList.filter((argument) => argument.startsWith("--output-dir=")).length > 1
      || argumentsList.filter((argument) => argument === "--unsigned-for-ci").length > 1) {
      throw bundleError("仅支持 --output-dir=<目录> 与 --unsigned-for-ci。", "invalid-cli-arguments");
    }
    const outputArgument = argumentsList.find((argument) => argument.startsWith("--output-dir="));
    const requestedOutput = outputArgument ? outputArgument.slice("--output-dir=".length) : undefined;
    if (outputArgument && !requestedOutput) throw bundleError("发布包输出目录不能为空。", "invalid-cli-arguments");
    const unsignedForCi = argumentsList.includes("--unsigned-for-ci");
    // 中文注释：正式私钥只能进入不执行仓库代码的隔离 signer；仓库 CLI 永远只负责无密钥打包，避免运维误用直签绕过 Environment 审批。
    if (!unsignedForCi || process.env.GITHUB_ACTIONS !== "true") {
      throw bundleError("无签名打包只允许在 GitHub Actions 的无密钥构建 job 中运行。", "unsigned-bundle-outside-ci");
    }
    const result = await createProductionReleaseBundle({
      rootDir: process.cwd(),
      outputDirectory: requestedOutput,
      unsignedForCi: true
    });
    console.log("无密钥 CI 发布归档与摘要已生成，等待隔离 signer job。", result);
  } catch (error) {
    console.error("生产发布压缩包生成失败。", { detailCode: error?.detailCode || "release-bundle-failed" });
    process.exitCode = 1;
  }
}

const executedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (executedPath === import.meta.url) await runCli();
