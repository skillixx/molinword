import path from "node:path";
import { verifyInstalledProductionReleaseBundle } from "./create-production-release-bundle.mjs";

async function main() {
  try {
    const argumentsList = process.argv.slice(2);
    const expectedArguments = argumentsList.filter((argument) => argument.startsWith("--expected-release-id="));
    const allowNodeModules = argumentsList.includes("--allow-node-modules");
    const unsupportedArguments = argumentsList.filter((argument) => argument !== "--allow-node-modules" && !argument.startsWith("--expected-release-id="));
    if (unsupportedArguments.length > 0
      || expectedArguments.length !== 1
      || argumentsList.filter((argument) => argument === "--allow-node-modules").length > 1) {
      throw Object.assign(new Error("仅支持 --expected-release-id=<发布号> 与 --allow-node-modules。"), { detailCode: "invalid-cli-arguments" });
    }
    const expectedReleaseId = expectedArguments[0].slice("--expected-release-id=".length);
    const result = await verifyInstalledProductionReleaseBundle({
      rootDir: path.resolve(process.cwd()),
      expectedReleaseId,
      allowNodeModules
    });
    console.log("生产发布包解压目录复验通过。", result);
  } catch (error) {
    console.error("生产发布包解压目录复验失败。", { detailCode: error?.detailCode || "release-bundle-verification-failed" });
    process.exitCode = 1;
  }
}

await main();
