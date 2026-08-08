import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  realpathSync,
  writeFileSync
} from "node:fs";
import path from "node:path";

const manifestRelativePath = "dist/release-manifest.json";
const maximumManifestBytes = 256 * 1024;
const maximumPackageMetadataBytes = 256 * 1024;
const maximumArtifactFiles = 4096;
const maximumArtifactBytes = 128 * 1024 * 1024;
const maximumSingleFileBytes = 32 * 1024 * 1024;

// 中文注释：这些目录和文件会进入生产压缩包；只使用显式白名单，避免把项目根部的环境文件、日志和临时产物一起交付。
export const releaseArtifactRoots = Object.freeze([
  ".agents",
  "database",
  "ops",
  "scripts",
  "server",
  "shared",
  "dist",
  "package.json",
  "package-lock.json"
]);

// 中文注释：前端源码和构建配置虽然不需要部署到服务器，但它们决定 dist 的字节，必须保持已提交状态才能把制品可信地绑定到 Git HEAD。
export const releaseBuildInputRoots = Object.freeze([
  ...releaseArtifactRoots.filter((entry) => entry !== "dist"),
  "src",
  "public",
  "index.html",
  "vite.config.ts",
  "tsconfig.json"
]);

const releaseCleanRoots = Object.freeze([...new Set(releaseBuildInputRoots)]);
const forbiddenDirectoryNames = new Set([
  ".git",
  ".cache",
  ".aws",
  ".ssh",
  ".azure",
  ".kube",
  ".docker",
  ".codex",
  ".gnupg",
  ".terraform",
  ".playwright-cli",
  "node_modules",
  "playwright-report",
  "test-results",
  "coverage"
]);
const forbiddenExactFileNames = new Set([
  ".npmrc",
  ".yarnrc",
  ".pnpmrc",
  ".netrc",
  "_netrc",
  ".git-credentials",
  "credentials.json",
  "service-account.json",
  "id_rsa",
  "id_dsa",
  "id_ecdsa",
  "id_ed25519"
]);

function normalizedRelativePath(rootDir, filePath) {
  return path.relative(rootDir, filePath).replaceAll("\\", "/");
}

function isPathWithin(parentPath, childPath) {
  const relative = path.relative(parentPath, childPath);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function assertSafeRelativePath(relativePath) {
  const normalized = String(relativePath || "").replaceAll("\\", "/");
  if (!normalized || normalized.startsWith("/") || normalized.includes("\0")
    || normalized.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error("发布制品包含不安全的相对路径。");
  }
  return normalized;
}

function assertPublishablePath(relativePath) {
  const normalized = assertSafeRelativePath(relativePath);
  const segments = normalized.toLowerCase().split("/");
  const fileName = segments.at(-1);
  const hasForbiddenDirectory = segments.slice(0, -1).some((segment) => forbiddenDirectoryNames.has(segment));
  const isEnvironmentFile = fileName === ".env" || fileName.startsWith(".env.");
  const isSecretMaterial = forbiddenExactFileNames.has(fileName)
    || /\.(?:pem|key|p12|pfx)$/i.test(fileName)
    || /^(?:service-account|credentials|secrets?)(?:[._-].*)?\.(?:json|ya?ml)$/i.test(fileName);
  const isLocalArtifact = fileName.startsWith(".codex")
    || fileName.endsWith(".log")
    || fileName.includes("screenshot");
  if (hasForbiddenDirectory || forbiddenDirectoryNames.has(fileName)
    || isEnvironmentFile || isSecretMaterial || isLocalArtifact) {
    throw new Error(`发布制品包含禁止交付的敏感或本地文件：${normalized}`);
  }
  return normalized;
}

function sameFileIdentity(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs;
}

// 中文注释：安全读取先限制路径与大小，再用同一文件描述符流式计算摘要；前后身份复核用于拒绝检查期间的替换、增长和符号链接竞态。
export function readBoundedReleaseFileSync({
  rootDir,
  relativePath,
  maximumBytes,
  requireNonEmpty = false,
  enforcePublishablePath = true
}) {
  const normalizedRoot = realpathSync(path.resolve(rootDir));
  const normalizedPath = enforcePublishablePath
    ? assertPublishablePath(relativePath)
    : assertSafeRelativePath(relativePath);
  const absolutePath = path.resolve(normalizedRoot, ...normalizedPath.split("/"));
  if (!isPathWithin(normalizedRoot, absolutePath)) throw new Error("发布文件路径超出项目根目录。");

  const beforePath = lstatSync(absolutePath);
  if (beforePath.isSymbolicLink() || !beforePath.isFile()) throw new Error(`发布文件不是常规文件：${normalizedPath}`);
  if (beforePath.size > maximumBytes || (requireNonEmpty && beforePath.size === 0)) {
    throw new Error(`发布文件大小不符合安全限制：${normalizedPath}`);
  }
  const resolvedBefore = realpathSync(absolutePath);
  if (!isPathWithin(normalizedRoot, resolvedBefore)) throw new Error(`发布文件离开项目根目录：${normalizedPath}`);

  const noFollowFlag = fsConstants.O_NOFOLLOW || 0;
  let descriptor;
  try {
    descriptor = openSync(absolutePath, fsConstants.O_RDONLY | noFollowFlag);
    const beforeFd = fstatSync(descriptor);
    if (!beforeFd.isFile() || !sameFileIdentity(beforePath, beforeFd)) {
      throw new Error(`发布文件在打开前发生变化：${normalizedPath}`);
    }
    const chunks = [];
    const digest = crypto.createHash("sha256");
    const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, Math.max(1, maximumBytes)));
    let totalBytes = 0;
    while (true) {
      const bytesRead = readSync(descriptor, buffer, 0, buffer.byteLength, null);
      if (bytesRead === 0) break;
      totalBytes += bytesRead;
      if (totalBytes > maximumBytes) throw new Error(`发布文件读取时超过安全限制：${normalizedPath}`);
      const chunk = Buffer.from(buffer.subarray(0, bytesRead));
      chunks.push(chunk);
      digest.update(chunk);
    }
    const afterFd = fstatSync(descriptor);
    const afterPath = lstatSync(absolutePath);
    const resolvedAfter = realpathSync(absolutePath);
    if (!sameFileIdentity(beforeFd, afterFd)
      || !sameFileIdentity(beforeFd, afterPath)
      || resolvedAfter !== resolvedBefore
      || !isPathWithin(normalizedRoot, resolvedAfter)
      || totalBytes !== beforeFd.size
      || (requireNonEmpty && totalBytes === 0)) {
      throw new Error(`发布文件在读取期间发生变化：${normalizedPath}`);
    }
    return Object.freeze({
      path: normalizedPath,
      bytes: totalBytes,
      sha256: digest.digest("hex"),
      content: Buffer.concat(chunks, totalBytes)
    });
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

export function collectReleaseArtifactSnapshot(rootDir) {
  const normalizedRoot = realpathSync(path.resolve(rootDir));
  const entries = [];
  let totalBytes = 0;

  function visit(relativePath) {
    const normalizedPath = assertPublishablePath(relativePath.replaceAll("\\", "/"));
    const absolutePath = path.resolve(normalizedRoot, ...normalizedPath.split("/"));
    if (normalizedPath === manifestRelativePath) return;
    if (!isPathWithin(normalizedRoot, absolutePath)) throw new Error("发布制品路径超出项目根目录。");
    const metadata = lstatSync(absolutePath);
    if (metadata.isSymbolicLink()) throw new Error("发布制品包含不允许的符号链接。");
    if (metadata.isDirectory()) {
      for (const child of readdirSync(absolutePath).sort((left, right) => left.localeCompare(right, "en"))) {
        visit(`${normalizedPath}/${child}`);
      }
      return;
    }
    if (!metadata.isFile()) throw new Error("发布制品包含不支持的文件类型。");
    const descriptor = readBoundedReleaseFileSync({
      rootDir: normalizedRoot,
      relativePath: normalizedPath,
      maximumBytes: maximumSingleFileBytes
    });
    totalBytes += descriptor.bytes;
    if (totalBytes > maximumArtifactBytes) throw new Error("发布制品总体积超过校验上限。");
    if (entries.length >= maximumArtifactFiles) throw new Error("发布制品文件数量超过校验上限。");
    entries.push({ path: descriptor.path, bytes: descriptor.bytes, sha256: descriptor.sha256 });
  }

  for (const artifactRoot of releaseArtifactRoots) visit(artifactRoot);
  entries.sort((left, right) => left.path.localeCompare(right.path, "en"));
  const digest = crypto.createHash("sha256");
  for (const entry of entries) {
    digest.update(`${Buffer.byteLength(entry.path, "utf8")}:${entry.path}:${entry.bytes}:${entry.sha256}\n`, "utf8");
  }
  return Object.freeze({
    artifactSha256: digest.digest("hex"),
    fileCount: entries.length,
    totalBytes,
    entries: Object.freeze(entries.map((entry) => Object.freeze({ ...entry })))
  });
}

function resolveGitCommit(rootDir, { requireClean = false, optional = false } = {}) {
  try {
    const gitRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: rootDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true
    }).trim();
    if (path.resolve(gitRoot).toLowerCase() !== path.resolve(rootDir).toLowerCase()) throw new Error("unexpected-git-root");
    const commit = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: rootDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true
    }).trim();
    if (!/^[0-9a-f]{40}$/i.test(commit)) throw new Error("invalid-commit");
    if (requireClean) {
      const status = execFileSync("git", [
        "status", "--porcelain=v1", "--untracked-files=all", "--",
        ...releaseCleanRoots,
        `:(exclude)${manifestRelativePath}`
      ], {
        cwd: rootDir,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true
      }).trim();
      const ignoredUntrackedSources = execFileSync("git", [
        "ls-files", "--others", "--ignored", "--exclude-standard", "--", ...releaseCleanRoots
      ], {
        cwd: rootDir,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true
      }).trim();
      const indexedSources = execFileSync("git", ["ls-files", "-v", "-z", "--", ...releaseCleanRoots], {
        cwd: rootDir,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true
      }).split("\0").filter(Boolean);
      const hasHiddenIndexState = indexedSources.some((entry) => entry.startsWith("S ") || /^[a-z] /.test(entry));
      // 中文注释：status、ignored-untracked 与索引隐藏标记三层检查共同保证构建输入确实属于当前提交，不能借忽略规则或索引位把本地源码归到旧 HEAD。
      if (status || ignoredUntrackedSources || hasHiddenIndexState) throw new Error("dirty-artifact-sources");
    }
    return commit.toLowerCase();
  } catch {
    if (optional) return "";
    throw new Error("无法从受控 Git 工作区生成发布提交标识。");
  }
}

function expectedReleaseId(gitCommit, artifactSha256) {
  return `${gitCommit.slice(0, 12)}-${artifactSha256.slice(0, 16)}`;
}

function parsePackageVersion(rootDir) {
  const packageFile = readBoundedReleaseFileSync({
    rootDir,
    relativePath: "package.json",
    maximumBytes: maximumPackageMetadataBytes,
    requireNonEmpty: true
  });
  let packageMetadata;
  try {
    packageMetadata = JSON.parse(packageFile.content.toString("utf8"));
  } catch {
    throw new Error("package.json 不是有效 JSON。");
  }
  const version = String(packageMetadata?.version || "");
  if (!version || version.length > 128) throw new Error("package.json 版本字段无效。");
  return version;
}

export function createReleaseManifest({ rootDir = process.cwd(), gitCommit } = {}) {
  const resolvedCommit = gitCommit === undefined ? resolveGitCommit(rootDir, { requireClean: true }) : gitCommit;
  const normalizedCommit = String(resolvedCommit || "").trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(normalizedCommit)) throw new Error("发布提交标识必须是完整 Git SHA-1。");
  const snapshot = collectReleaseArtifactSnapshot(rootDir);
  return {
    schemaVersion: 1,
    releaseId: expectedReleaseId(normalizedCommit, snapshot.artifactSha256),
    gitCommit: normalizedCommit,
    packageVersion: parsePackageVersion(rootDir),
    artifactSha256: snapshot.artifactSha256,
    fileCount: snapshot.fileCount,
    totalBytes: snapshot.totalBytes
  };
}

export function writeReleaseManifest({ rootDir = process.cwd() } = {}) {
  const manifest = createReleaseManifest({ rootDir });
  const outputPath = path.join(rootDir, manifestRelativePath);
  // 中文注释：Vite 已在构建前清空 dist；最后写入清单可覆盖本次前后端制品，同时避免把清单自身纳入递归摘要。
  writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  return manifest;
}

export function verifyReleaseManifest({
  rootDir = process.cwd(),
  expectedReleaseId: requestedReleaseId = "",
  requireGit = false,
  requireClean = false,
  returnSnapshot = false
} = {}) {
  let manifest;
  let manifestFile;
  try {
    manifestFile = readBoundedReleaseFileSync({
      rootDir,
      relativePath: manifestRelativePath,
      maximumBytes: maximumManifestBytes,
      requireNonEmpty: true
    });
    manifest = JSON.parse(manifestFile.content.toString("utf8"));
  } catch {
    throw new Error("发布制品清单缺失、过大或不是有效 JSON。");
  }
  const exactKeys = ["artifactSha256", "fileCount", "gitCommit", "packageVersion", "releaseId", "schemaVersion", "totalBytes"];
  if (Object.keys(manifest || {}).sort().join(",") !== exactKeys.join(",")
    || manifest.schemaVersion !== 1
    || !/^[0-9a-f]{12}-[0-9a-f]{16}$/.test(String(manifest.releaseId || ""))
    || !/^[0-9a-f]{40}$/.test(String(manifest.gitCommit || ""))
    || !/^[0-9a-f]{64}$/.test(String(manifest.artifactSha256 || ""))
    || typeof manifest.packageVersion !== "string" || !manifest.packageVersion || manifest.packageVersion.length > 128
    || !Number.isSafeInteger(manifest.fileCount) || manifest.fileCount < 1 || manifest.fileCount > maximumArtifactFiles
    || !Number.isSafeInteger(manifest.totalBytes) || manifest.totalBytes < 1 || manifest.totalBytes > maximumArtifactBytes) {
    throw new Error("发布制品清单字段无效。");
  }
  const checkoutCommit = resolveGitCommit(rootDir, { optional: !requireGit, requireClean });
  if (checkoutCommit && checkoutCommit !== manifest.gitCommit) {
    throw new Error("发布制品清单提交号与当前 Git HEAD 不一致。");
  }
  const snapshot = collectReleaseArtifactSnapshot(rootDir);
  const derivedReleaseId = expectedReleaseId(manifest.gitCommit, snapshot.artifactSha256);
  if (manifest.artifactSha256 !== snapshot.artifactSha256
    || manifest.fileCount !== snapshot.fileCount
    || manifest.totalBytes !== snapshot.totalBytes
    || manifest.packageVersion !== parsePackageVersion(rootDir)
    || manifest.releaseId !== derivedReleaseId) {
    throw new Error("发布制品与构建清单不一致。");
  }
  if (requestedReleaseId && requestedReleaseId !== manifest.releaseId) {
    throw new Error("运行制品发布号与期望发布号不一致。");
  }
  if (requireClean) {
    const finalCheckoutCommit = resolveGitCommit(rootDir, { requireClean: true });
    if (finalCheckoutCommit !== manifest.gitCommit) throw new Error("发布制品清单提交号与最终 Git HEAD 不一致。");
  }
  const frozenManifest = Object.freeze({ ...manifest });
  const manifestDescriptor = Object.freeze({
    path: manifestFile.path,
    bytes: manifestFile.bytes,
    sha256: manifestFile.sha256
  });
  return returnSnapshot ? Object.freeze({ manifest: frozenManifest, snapshot, manifestDescriptor }) : frozenManifest;
}
