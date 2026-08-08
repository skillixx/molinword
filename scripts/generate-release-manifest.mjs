import { writeReleaseManifest } from "../shared/release-manifest.js";

const manifest = writeReleaseManifest({ rootDir: process.cwd() });
console.log("生产发布制品清单已生成。", {
  releaseId: manifest.releaseId,
  gitCommit: manifest.gitCommit,
  artifactSha256: manifest.artifactSha256,
  fileCount: manifest.fileCount,
  totalBytes: manifest.totalBytes
});
