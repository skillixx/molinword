import { constants as fsConstants } from "node:fs";
import { lstat, open, rm } from "node:fs/promises";
import path from "node:path";
import {
  stageProductionReleaseInputs,
  verifyProductionReleaseArchive
} from "./create-production-release-bundle.mjs";

async function readPublicKey(filePath) {
  const absolutePath = path.resolve(String(filePath || ""));
  const beforePath = await lstat(absolutePath);
  if (beforePath.isSymbolicLink() || !beforePath.isFile() || beforePath.size <= 0 || beforePath.size > 64 * 1024) {
    throw Object.assign(new Error("生产发布签名公钥不是符合大小限制的常规文件。"), { detailCode: "invalid-signing-public-key" });
  }
  const handle = await open(absolutePath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0));
  try {
    const beforeFd = await handle.stat();
    const chunks = [];
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let totalBytes = 0;
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, null);
      if (bytesRead === 0) break;
      totalBytes += bytesRead;
      if (totalBytes > 64 * 1024) {
        throw Object.assign(new Error("生产发布签名公钥读取时超过大小限制。"), { detailCode: "invalid-signing-public-key" });
      }
      chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
    }
    const afterFd = await handle.stat();
    // 中文注释：公钥是服务器的发布信任根；必须从同一 FD 读取并复核身份，不能在检查与验签之间被链接或替换。
    if (!beforeFd.isFile()
      || beforeFd.dev !== beforePath.dev || beforeFd.ino !== beforePath.ino
      || beforeFd.size !== totalBytes
      || beforeFd.dev !== afterFd.dev || beforeFd.ino !== afterFd.ino
      || beforeFd.size !== afterFd.size || beforeFd.mtimeMs !== afterFd.mtimeMs || beforeFd.ctimeMs !== afterFd.ctimeMs) {
      throw Object.assign(new Error("生产发布签名公钥在读取期间发生变化。"), { detailCode: "invalid-signing-public-key" });
    }
    return Buffer.concat(chunks, totalBytes);
  } finally {
    await handle.close();
  }
}

function parseArguments() {
  const values = new Map();
  for (const argument of process.argv.slice(2)) {
    const match = argument.match(/^--(archive|checksum|signature|staged-output-dir|expected-release-id)=(.+)$/);
    if (!match || values.has(match[1])) throw new Error("归档复验参数无效或重复。");
    values.set(match[1], match[2]);
  }
  if (values.size !== 5) throw new Error("必须提供归档、摘要、签名、root-only 副本目录和期望发布号。");
  return values;
}

async function main() {
  let stagedDirectory = "";
  try {
    const values = parseArguments();
    const publicKeyPath = String(process.env.RELEASE_SIGNING_PUBLIC_KEY_FILE || "").trim();
    if (!publicKeyPath) throw Object.assign(new Error("缺少生产发布签名公钥路径。"), { detailCode: "missing-signing-public-key" });
    const staged = await stageProductionReleaseInputs({
      archivePath: values.get("archive"),
      checksumPath: values.get("checksum"),
      signaturePath: values.get("signature"),
      stagedOutputDirectory: values.get("staged-output-dir"),
      expectedReleaseId: values.get("expected-release-id")
    });
    stagedDirectory = staged.stagedDirectory;
    const result = await verifyProductionReleaseArchive({
      archivePath: staged.archivePath,
      checksumPath: staged.checksumPath,
      signaturePath: staged.signaturePath,
      signingPublicKey: await readPublicKey(publicKeyPath),
      expectedReleaseId: values.get("expected-release-id")
    });
    console.log("生产发布归档已复制到 root-only 新 inode，签名与条目复验通过。", result);
  } catch (error) {
    if (stagedDirectory) await rm(stagedDirectory, { recursive: true, force: true }).catch(() => {});
    console.error("生产发布归档复验失败。", { detailCode: error?.detailCode || "release-archive-verification-failed" });
    process.exitCode = 1;
  }
}

await main();
