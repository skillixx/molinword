import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const manifestRelativePath = "dist/release-manifest.json";
// 中文注解：除在线服务和前端产物外，还必须覆盖验收采集器、迁移及托管资产，避免证据或维护逻辑在生成清单后静默漂移。
const artifactRoots = Object.freeze([".agents", "database", "ops", "scripts", "server", "shared", "dist", "package.json", "package-lock.json"]);
const artifactSourceRoots = Object.freeze(artifactRoots.filter((entry) => entry !== "dist"));
const maximumArtifactFiles = 4096;
const maximumArtifactBytes = 128 * 1024 * 1024;
const maximumSingleFileBytes = 32 * 1024 * 1024;

function normalizedRelativePath(rootDir, filePath) {
  return path.relative(rootDir, filePath).replaceAll("\\", "/");
}

function collectArtifactSnapshot(rootDir) {
  const entries = [];
  let totalBytes = 0;

  function visit(relativePath) {
    const absolutePath = path.resolve(rootDir, relativePath);
    const normalizedPath = normalizedRelativePath(rootDir, absolutePath);
    if (normalizedPath === manifestRelativePath) return;
    const metadata = lstatSync(absolutePath);
    if (metadata.isSymbolicLink()) throw new Error("发布制品包含不允许的符号链接。");
    if (metadata.isDirectory()) {
      for (const child of readdirSync(absolutePath).sort((left, right) => left.localeCompare(right, "en"))) {
        visit(path.join(relativePath, child));
      }
      return;
    }
    if (!metadata.isFile()) throw new Error("发布制品包含不支持的文件类型。");
    if (metadata.size > maximumSingleFileBytes) throw new Error("发布制品包含超出上限的单个文件。");
    totalBytes += metadata.size;
    if (totalBytes > maximumArtifactBytes) throw new Error("发布制品总体积超过校验上限。");
    if (entries.length >= maximumArtifactFiles) throw new Error("发布制品文件数量超过校验上限。");
    const content = readFileSync(absolutePath);
    entries.push({
      path: normalizedPath,
      bytes: content.byteLength,
      sha256: crypto.createHash("sha256").update(content).digest("hex")
    });
  }

  for (const artifactRoot of artifactRoots) visit(artifactRoot);
  entries.sort((left, right) => left.path.localeCompare(right.path, "en"));
  const digest = crypto.createHash("sha256");
  for (const entry of entries) {
    digest.update(`${Buffer.byteLength(entry.path, "utf8")}:${entry.path}:${entry.bytes}:${entry.sha256}\n`, "utf8");
  }
  return { artifactSha256: digest.digest("hex"), fileCount: entries.length, totalBytes };
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
        ...artifactRoots,
        `:(exclude)${manifestRelativePath}`
      ], {
        cwd: rootDir,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true
      }).trim();
      const ignoredUntrackedSources = execFileSync("git", [
        "ls-files", "--others", "--ignored", "--exclude-standard", "--", ...artifactSourceRoots
      ], {
        cwd: rootDir,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true
      }).trim();
      const indexedSources = execFileSync("git", ["ls-files", "-v", "-z", "--", ...artifactSourceRoots], {
        cwd: rootDir,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true
      }).split("\0").filter(Boolean);
      const hasHiddenIndexState = indexedSources.some((entry) => entry.startsWith("S ") || /^[a-z] /.test(entry));
      // 中文注解：发布提交只在全部受覆盖输入已入库时生成，避免清单把未提交源码错误归到旧提交名下。
      // 中文注解：Git status 会隐藏被仓库、info/exclude 或全局规则忽略的新文件，因此还要单独拒绝源码根中的 ignored-untracked。
      // 中文注解：skip-worktree 与 assume-unchanged 同样会隐藏已跟踪改动，发布工作区不允许对受覆盖源码设置这些索引标记。
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

export function createReleaseManifest({ rootDir = process.cwd(), gitCommit } = {}) {
  const resolvedCommit = gitCommit === undefined ? resolveGitCommit(rootDir, { requireClean: true }) : gitCommit;
  const normalizedCommit = String(resolvedCommit || "").trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(normalizedCommit)) throw new Error("发布提交标识必须是完整 Git SHA-1。");
  const packageMetadata = JSON.parse(readFileSync(path.join(rootDir, "package.json"), "utf8"));
  const snapshot = collectArtifactSnapshot(rootDir);
  return {
    schemaVersion: 1,
    releaseId: expectedReleaseId(normalizedCommit, snapshot.artifactSha256),
    gitCommit: normalizedCommit,
    packageVersion: String(packageMetadata.version || ""),
    artifactSha256: snapshot.artifactSha256,
    fileCount: snapshot.fileCount,
    totalBytes: snapshot.totalBytes
  };
}

export function writeReleaseManifest({ rootDir = process.cwd() } = {}) {
  const manifest = createReleaseManifest({ rootDir });
  const outputPath = path.join(rootDir, manifestRelativePath);
  // 中文注解：Vite 已在构建前清空 dist；这里最后写入清单，使哈希覆盖同一发布中的全部前后端制品而不自引用。
  writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  return manifest;
}

export function verifyReleaseManifest({ rootDir = process.cwd(), expectedReleaseId: requestedReleaseId = "" } = {}) {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(path.join(rootDir, manifestRelativePath), "utf8"));
  } catch {
    throw new Error("发布制品清单缺失或不是有效 JSON。");
  }
  if (manifest?.schemaVersion !== 1
    || !/^[0-9a-f]{40}$/.test(String(manifest.gitCommit || ""))
    || !/^[0-9a-f]{64}$/.test(String(manifest.artifactSha256 || ""))) {
    throw new Error("发布制品清单字段无效。");
  }
  const checkoutCommit = resolveGitCommit(rootDir, { optional: true });
  if (checkoutCommit && checkoutCommit !== manifest.gitCommit) {
    throw new Error("发布制品清单提交号与当前 Git HEAD 不一致。");
  }
  const snapshot = collectArtifactSnapshot(rootDir);
  const derivedReleaseId = expectedReleaseId(manifest.gitCommit, snapshot.artifactSha256);
  if (manifest.artifactSha256 !== snapshot.artifactSha256
    || manifest.fileCount !== snapshot.fileCount
    || manifest.totalBytes !== snapshot.totalBytes
    || manifest.releaseId !== derivedReleaseId) {
    throw new Error("发布制品与构建清单不一致。");
  }
  if (requestedReleaseId && requestedReleaseId !== manifest.releaseId) {
    throw new Error("运行制品发布号与期望发布号不一致。");
  }
  return Object.freeze({ ...manifest });
}
