import { verifyReleaseManifest } from "../shared/release-manifest.js";

const expectedArgument = process.argv.find((argument) => argument.startsWith("--expected-release-id="));
const expectedReleaseId = expectedArgument?.slice("--expected-release-id=".length) || "";

try {
  const manifest = verifyReleaseManifest({ rootDir: process.cwd(), expectedReleaseId });
  console.log("生产发布制品清单检查通过。", {
    releaseId: manifest.releaseId,
    gitCommit: manifest.gitCommit,
    artifactSha256: manifest.artifactSha256,
    fileCount: manifest.fileCount,
    totalBytes: manifest.totalBytes
  });
} catch (error) {
  console.error(`生产发布制品清单检查失败：${error.message}`);
  process.exitCode = 1;
}
