import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, createVerify, generateKeyPairSync } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  collectReleaseArtifactSnapshot,
  createReleaseManifest,
  releaseBuildInputRoots,
  releaseArtifactRoots
} from "../shared/release-manifest.js";
import {
  createProductionReleaseBundle,
  stageProductionReleaseInputs,
  validateProductionReleaseEntryBudget,
  verifyProductionReleaseArchive,
  verifyInstalledProductionReleaseBundle
} from "./create-production-release-bundle.mjs";

const { privateKey: signingPrivateKey, publicKey: signingPublicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const { privateKey: weakSigningPrivateKey, publicKey: weakSigningPublicKey } = generateKeyPairSync("rsa", { modulusLength: 1024 });
const { privateKey: unsupportedDsaPrivateKey } = generateKeyPairSync("dsa", { modulusLength: 2048, divisorLength: 256 });

function createSignedBundle(options) {
  return createProductionReleaseBundle({ ...options, signingPrivateKey });
}

function runGit(rootDir, argumentsList) {
  const result = spawnSync("git", argumentsList, { cwd: rootDir, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr || `git ${argumentsList.join(" ")} 执行失败`);
}

function parseTarArchive(compressed) {
  const tar = gunzipSync(compressed);
  const entries = [];
  let offset = 0;
  while (offset + 512 <= tar.byteLength) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const text = (start, length) => header.subarray(start, start + length).toString("utf8").replace(/\0.*$/s, "");
    const name = text(0, 100);
    const prefix = text(345, 155);
    const entryPath = prefix ? `${prefix}/${name}` : name;
    const size = Number.parseInt(text(124, 12).trim() || "0", 8);
    const mtime = Number.parseInt(text(136, 12).trim() || "0", 8);
    const type = text(156, 1) || "0";
    const bodyStart = offset + 512;
    entries.push({ path: entryPath, size, mtime, type, content: tar.subarray(bodyStart, bodyStart + size) });
    offset = bodyStart + Math.ceil(size / 512) * 512;
  }
  assert.ok(tar.subarray(offset, offset + 1024).every((byte) => byte === 0), "tar 末尾必须包含两个零块");
  return entries;
}

async function createFixture(rootDir, { initializeGit = true, includeLicense = true } = {}) {
  for (const artifactRoot of releaseArtifactRoots) {
    const absolute = path.join(rootDir, artifactRoot);
    if (path.extname(artifactRoot)) continue;
    await mkdir(absolute, { recursive: true });
    if (!new Set(["ops", "dist"]).has(artifactRoot)) {
      await writeFile(path.join(absolute, "fixture.txt"), `${artifactRoot}-fixture\n`, "utf8");
    }
  }
  await writeFile(path.join(rootDir, "package.json"), `${JSON.stringify({ name: "molinword", version: "1.2.3", private: true }, null, 2)}\n`, "utf8");
  await writeFile(path.join(rootDir, "package-lock.json"), `${JSON.stringify({ name: "molinword", version: "1.2.3", lockfileVersion: 3, packages: {} }, null, 2)}\n`, "utf8");
  await writeFile(path.join(rootDir, "ops", "release-target.json"), '{"os":"linux","cpu":"x64","libc":"glibc"}\n', "utf8");
  await writeFile(path.join(rootDir, "dist", "index.html"), "<!doctype html><title>Molinword</title>\n", "utf8");
  if (includeLicense) await writeFile(path.join(rootDir, "dist", "THIRD_PARTY_LICENSES.txt"), "fixture licenses\n", "utf8");
  await mkdir(path.join(rootDir, "src"), { recursive: true });
  await mkdir(path.join(rootDir, "public"), { recursive: true });
  await writeFile(path.join(rootDir, "src", "main.tsx"), "export const app = true;\n", "utf8");
  await writeFile(path.join(rootDir, "public", "favicon.svg"), "<svg/>\n", "utf8");
  await writeFile(path.join(rootDir, "index.html"), "<div id=\"root\"></div>\n", "utf8");
  await writeFile(path.join(rootDir, "vite.config.ts"), "export default {};\n", "utf8");
  await writeFile(path.join(rootDir, "tsconfig.json"), "{}\n", "utf8");
  if (!initializeGit) {
    const manifest = createReleaseManifest({ rootDir, gitCommit: "a".repeat(40) });
    await writeFile(path.join(rootDir, "dist", "release-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    return manifest;
  }
  runGit(rootDir, ["init", "--quiet"]);
  runGit(rootDir, ["config", "user.name", "Molinword Release Test"]);
  runGit(rootDir, ["config", "user.email", "release-test@example.invalid"]);
  runGit(rootDir, ["config", "core.autocrlf", "false"]);
  runGit(rootDir, ["add", "--", ...new Set([...releaseArtifactRoots, ...releaseBuildInputRoots])]);
  runGit(rootDir, ["commit", "--quiet", "-m", "test: release fixture"]);
  const manifest = createReleaseManifest({ rootDir });
  await writeFile(path.join(rootDir, "dist", "release-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifest;
}

const temporaryRoot = await mkdtemp(path.join(tmpdir(), "molinword-release-bundle-"));
try {
  const budgetFile = (index) => ({ path: `server/branch-${index}/leaf-${index}/file.txt`, bytes: 1, sha256: "0".repeat(64) });
  assert.doesNotThrow(() => validateProductionReleaseEntryBudget({
    topLevelDirectory: "molinword-aaaaaaaaaaaa-bbbbbbbbbbbbbbbb",
    files: Array.from({ length: 2000 }, (_, index) => budgetFile(index))
  }));
  assert.throws(() => validateProductionReleaseEntryBudget({
    topLevelDirectory: "molinword-aaaaaaaaaaaa-bbbbbbbbbbbbbbbb",
    files: Array.from({ length: 4096 }, (_, index) => budgetFile(index))
  }), /目录与文件总数超过安全上限/);

  const projectRoot = path.join(temporaryRoot, "project");
  const outputOne = path.join(temporaryRoot, "output-one");
  const outputTwo = path.join(temporaryRoot, "output-two");
  await mkdir(projectRoot);
  const manifest = await createFixture(projectRoot);
  await writeFile(path.join(projectRoot, ".env"), "SECRET=must-not-ship\n", "utf8");
  await writeFile(path.join(projectRoot, ".codex-local.log"), "must-not-ship\n", "utf8");
  await mkdir(path.join(projectRoot, "node_modules", "private-package"), { recursive: true });
  await writeFile(path.join(projectRoot, "node_modules", "private-package", "secret.txt"), "must-not-ship\n", "utf8");
  await writeFile(path.join(projectRoot, "local-screenshot.png"), "must-not-ship\n", "utf8");
  await writeFile(path.join(projectRoot, "molinword.tar.gz"), "must-not-ship\n", "utf8");

  await assert.rejects(
    () => createProductionReleaseBundle({ rootDir: projectRoot, outputDirectory: path.join(temporaryRoot, "unsigned") }),
    /CI 签名私钥/
  );
  const unsignedForCi = await createProductionReleaseBundle({
    rootDir: projectRoot,
    outputDirectory: path.join(temporaryRoot, "unsigned-ci"),
    unsignedForCi: true
  });
  assert.equal(unsignedForCi.signaturePath, null, "隔离签名流程的打包 job 不得接触或伪造签名字节");
  await access(unsignedForCi.archivePath);
  await access(unsignedForCi.checksumPath);
  await assert.rejects(
    () => createProductionReleaseBundle({ rootDir: projectRoot, outputDirectory: path.join(temporaryRoot, "weak-key"), signingPrivateKey: weakSigningPrivateKey }),
    /强度不得低于 2048 位/
  );
  await assert.rejects(
    () => createProductionReleaseBundle({ rootDir: projectRoot, outputDirectory: path.join(temporaryRoot, "dsa-key"), signingPrivateKey: unsupportedDsaPrivateKey }),
    /至少 2048 位 RSA\/RSA-PSS 或 P-256\/P-384\/P-521/
  );

  const first = await createSignedBundle({ rootDir: projectRoot, outputDirectory: outputOne });
  const second = await createSignedBundle({ rootDir: projectRoot, outputDirectory: outputTwo });
  assert.equal(first.releaseId, manifest.releaseId);
  assert.deepEqual(first.releaseTarget, { os: "linux", cpu: "x64", libc: "glibc" });
  assert.equal(first.archiveSha256, second.archiveSha256, "相同发布输入必须生成字节一致的压缩包");
  assert.deepEqual(await readFile(first.signaturePath), await readFile(second.signaturePath), "相同 RSA 签名输入必须生成相同签名字节");
  const trustedCopyParent = path.join(temporaryRoot, "trusted-copy-parent");
  await mkdir(trustedCopyParent);
  const trustedCopy = await stageProductionReleaseInputs({
    archivePath: second.archivePath,
    checksumPath: second.checksumPath,
    signaturePath: second.signaturePath,
    stagedOutputDirectory: path.join(trustedCopyParent, `molinword-${manifest.releaseId}-verified`),
    expectedReleaseId: manifest.releaseId
  });
  await writeFile(second.archivePath, "source inode changed after root-only copy\n", "utf8");
  const copiedArchiveVerification = await verifyProductionReleaseArchive({
    archivePath: trustedCopy.archivePath,
    checksumPath: trustedCopy.checksumPath,
    signaturePath: trustedCopy.signaturePath,
    signingPublicKey,
    expectedReleaseId: manifest.releaseId
  });
  assert.equal(copiedArchiveVerification.archiveSha256, first.archiveSha256, "旧写 FD 或原路径后续变化不得影响 root-only 复验副本");

  const archive = await readFile(first.archivePath);
  assert.equal(createHash("sha256").update(archive).digest("hex"), first.archiveSha256);
  const checksum = await readFile(first.checksumPath, "utf8");
  assert.equal(checksum, `${first.archiveSha256}  ${path.basename(first.archivePath)}\n`);
  const signatureVerifier = createVerify("sha256");
  signatureVerifier.update(checksum, "utf8");
  signatureVerifier.end();
  assert.equal(signatureVerifier.verify(signingPublicKey, await readFile(first.signaturePath)), true, "生产发布摘要必须带可信私钥签名");
  const archiveVerification = await verifyProductionReleaseArchive({
    archivePath: first.archivePath,
    checksumPath: first.checksumPath,
    signaturePath: first.signaturePath,
    signingPublicKey,
    expectedReleaseId: manifest.releaseId
  });
  assert.equal(archiveVerification.archiveSha256, first.archiveSha256);
  const invalidSignaturePath = path.join(temporaryRoot, "invalid-signature.sig");
  const invalidSignature = Buffer.from(await readFile(first.signaturePath));
  invalidSignature[0] ^= 0xff;
  await writeFile(invalidSignaturePath, invalidSignature);
  await assert.rejects(
    () => verifyProductionReleaseArchive({
      archivePath: first.archivePath,
      checksumPath: first.checksumPath,
      signaturePath: invalidSignaturePath,
      signingPublicKey,
      expectedReleaseId: manifest.releaseId
    }),
    /签名验证失败/
  );
  await assert.rejects(
    () => verifyProductionReleaseArchive({
      archivePath: first.archivePath,
      checksumPath: first.checksumPath,
      signaturePath: first.signaturePath,
      signingPublicKey: weakSigningPublicKey,
      expectedReleaseId: manifest.releaseId
    }),
    /强度不得低于 2048 位/
  );
  await assert.rejects(
    () => verifyProductionReleaseArchive({
      archivePath: first.archivePath,
      checksumPath: first.checksumPath,
      signaturePath: first.signaturePath,
      signingPublicKey: signingPrivateKey,
      expectedReleaseId: manifest.releaseId
    }),
    /禁止传入私钥/
  );

  const entries = parseTarArchive(archive);
  const topLevel = `molinword-${manifest.releaseId}`;
  assert.ok(entries.every((entry) => entry.path === `${topLevel}/` || entry.path.startsWith(`${topLevel}/`)));
  assert.ok(entries.every((entry) => !entry.path.includes("\\") && !entry.path.split("/").includes("..")));
  assert.ok(entries.every((entry) => entry.mtime === 0), "发布包 tar 元数据时间必须固定");
  assert.ok(!entries.some((entry) => entry.path.endsWith("/.env")
    || entry.path.includes(".codex")
    || entry.path.includes("node_modules")
    || entry.path.endsWith("local-screenshot.png")
    || entry.path.endsWith("molinword.tar.gz")));
  const systemTar = spawnSync("tar", ["-tzf", first.archivePath], { encoding: "utf8", windowsHide: true });
  assert.equal(systemTar.status, 0, systemTar.stderr || "系统 tar 必须能够读取生产发布包");
  assert.match(systemTar.stdout, new RegExp(`${topLevel}/BUNDLE-MANIFEST\\.json`));

  const bundleManifestEntry = entries.find((entry) => entry.path === `${topLevel}/BUNDLE-MANIFEST.json`);
  assert.ok(bundleManifestEntry, "发布包必须包含内部清单");
  const bundleManifest = JSON.parse(bundleManifestEntry.content.toString("utf8"));
  const snapshot = collectReleaseArtifactSnapshot(projectRoot);
  assert.equal(bundleManifest.releaseId, manifest.releaseId);
  assert.equal(bundleManifest.artifactSha256, snapshot.artifactSha256);
  assert.deepEqual(bundleManifest.releaseTarget, first.releaseTarget);
  assert.deepEqual(
    bundleManifest.files.map((entry) => entry.path),
    [...snapshot.entries.map((entry) => entry.path), "dist/release-manifest.json"].sort((left, right) => left.localeCompare(right, "en"))
  );

  const extractedRoot = path.join(temporaryRoot, "extracted");
  await mkdir(extractedRoot);
  const extractResult = spawnSync("tar", ["-xzf", first.archivePath, "--strip-components=1", "-C", extractedRoot], {
    encoding: "utf8",
    windowsHide: true
  });
  assert.equal(extractResult.status, 0, extractResult.stderr || "系统 tar 必须能够解压生产发布包");
  const installed = await verifyInstalledProductionReleaseBundle({ rootDir: extractedRoot, expectedReleaseId: manifest.releaseId });
  assert.equal(installed.releaseId, manifest.releaseId);
  await writeFile(path.join(extractedRoot, ".npmrc"), "registry=https://attacker.example/\n", "utf8");
  await assert.rejects(
    () => verifyInstalledProductionReleaseBundle({ rootDir: extractedRoot, expectedReleaseId: manifest.releaseId }),
    /未批准文件/
  );
  await rm(path.join(extractedRoot, ".npmrc"));
  await mkdir(path.join(extractedRoot, "node_modules", "fixture-package"), { recursive: true });
  await writeFile(path.join(extractedRoot, "node_modules", "fixture-package", "index.js"), "export {};\n", "utf8");
  await assert.rejects(
    () => verifyInstalledProductionReleaseBundle({ rootDir: extractedRoot, expectedReleaseId: manifest.releaseId }),
    /未批准文件/
  );
  const installedAfterDependencies = await verifyInstalledProductionReleaseBundle({
    rootDir: extractedRoot,
    expectedReleaseId: manifest.releaseId,
    allowNodeModules: true
  });
  assert.equal(installedAfterDependencies.releaseId, manifest.releaseId, "依赖安装后仅允许忽略根级 node_modules，发布源码仍需逐文件复验");
  await rm(path.join(extractedRoot, "node_modules"), { recursive: true, force: true });
  const originalBundleManifest = await readFile(path.join(extractedRoot, "BUNDLE-MANIFEST.json"), "utf8");
  const tamperedBundleManifest = JSON.parse(originalBundleManifest);
  tamperedBundleManifest.releaseId = "ffffffffffff-ffffffffffffffff";
  await writeFile(path.join(extractedRoot, "BUNDLE-MANIFEST.json"), `${JSON.stringify(tamperedBundleManifest)}\n`, "utf8");
  await assert.rejects(
    () => verifyInstalledProductionReleaseBundle({ rootDir: extractedRoot, expectedReleaseId: manifest.releaseId }),
    /内部清单与实际制品不一致/
  );

  await assert.rejects(
    () => createSignedBundle({ rootDir: projectRoot, outputDirectory: outputOne }),
    /已存在|拒绝覆盖/
  );
  assert.equal(createHash("sha256").update(await readFile(first.archivePath)).digest("hex"), first.archiveSha256, "拒绝覆盖时不能删除或改写原发布包");

  const unsafeOutput = path.join(projectRoot, "dist", "release");
  await assert.rejects(
    () => createSignedBundle({ rootDir: projectRoot, outputDirectory: unsafeOutput }),
    /不能位于发布清单覆盖目录内/
  );
  await assert.rejects(() => access(unsafeOutput), "拒绝不安全输出目录时不能污染发布清单覆盖目录");
  const unsafeBuildOutput = path.join(projectRoot, "src", "release");
  await assert.rejects(
    () => createSignedBundle({ rootDir: projectRoot, outputDirectory: unsafeBuildOutput }),
    /不能位于发布清单覆盖目录内/
  );
  await assert.rejects(() => access(unsafeBuildOutput), "拒绝构建输入目录内输出时不能污染前端源码");

  for (const sensitivePath of [
    "server/.aws/credentials",
    "server/.ssh/id_ecdsa",
    "server/.azure/accessTokens.json",
    "server/.kube/config",
    "server/.docker/config.json",
    "server/.codex/session.json",
    "server/.netrc",
    "server/.git-credentials",
    "server/service-account.yaml"
  ]) {
    const absoluteSensitivePath = path.join(projectRoot, ...sensitivePath.split("/"));
    await mkdir(path.dirname(absoluteSensitivePath), { recursive: true });
    await writeFile(absoluteSensitivePath, "must-not-ship\n", "utf8");
    assert.throws(() => collectReleaseArtifactSnapshot(projectRoot), /禁止交付的敏感或本地文件/, sensitivePath);
    await rm(absoluteSensitivePath);
  }

  const noGitRoot = path.join(temporaryRoot, "no-git");
  await mkdir(noGitRoot);
  await createFixture(noGitRoot, { initializeGit: false });
  await assert.rejects(
    () => createSignedBundle({ rootDir: noGitRoot, outputDirectory: path.join(temporaryRoot, "no-git-output") }),
    /受控 Git 工作区/
  );

  const advancedHeadRoot = path.join(temporaryRoot, "advanced-head");
  await mkdir(advancedHeadRoot);
  await createFixture(advancedHeadRoot);
  await writeFile(path.join(advancedHeadRoot, "CHANGELOG.md"), "advance head\n", "utf8");
  runGit(advancedHeadRoot, ["add", "CHANGELOG.md"]);
  runGit(advancedHeadRoot, ["commit", "--quiet", "-m", "test: advance head"]);
  await assert.rejects(
    () => createSignedBundle({ rootDir: advancedHeadRoot, outputDirectory: path.join(temporaryRoot, "advanced-output") }),
    /Git HEAD 不一致/
  );

  const dirtyBuildRoot = path.join(temporaryRoot, "dirty-build-input");
  await mkdir(dirtyBuildRoot);
  await createFixture(dirtyBuildRoot);
  await writeFile(path.join(dirtyBuildRoot, "src", "main.tsx"), "export const app = false;\n", "utf8");
  await assert.rejects(
    () => createSignedBundle({ rootDir: dirtyBuildRoot, outputDirectory: path.join(temporaryRoot, "dirty-build-output") }),
    /受控 Git 工作区/
  );

  const missingLicenseRoot = path.join(temporaryRoot, "missing-license");
  await mkdir(missingLicenseRoot);
  await createFixture(missingLicenseRoot, { includeLicense: false });
  await assert.rejects(
    () => createSignedBundle({ rootDir: missingLicenseRoot, outputDirectory: path.join(temporaryRoot, "missing-license-output") }),
    /第三方许可证汇总/
  );

  const deepSecretRoot = path.join(temporaryRoot, "deep-secret");
  await mkdir(deepSecretRoot);
  await createFixture(deepSecretRoot);
  await writeFile(path.join(deepSecretRoot, "server", ".env.production"), "TOKEN=must-not-ship\n", "utf8");
  runGit(deepSecretRoot, ["add", "-f", "server/.env.production"]);
  runGit(deepSecretRoot, ["commit", "--quiet", "-m", "test: committed secret must still fail"]);
  assert.throws(
    () => createReleaseManifest({ rootDir: deepSecretRoot }),
    /禁止交付的敏感或本地文件/
  );

  await writeFile(path.join(projectRoot, "server", "fixture.txt"), "tampered-after-manifest\n", "utf8");
  await assert.rejects(
    () => createSignedBundle({ rootDir: projectRoot, outputDirectory: path.join(temporaryRoot, "tampered") }),
    /发布制品与构建清单不一致|受控 Git 工作区/
  );

  console.log("生产发布压缩包契约检查通过。", {
    releaseId: first.releaseId,
    deterministic: true,
    entryCount: entries.length,
    secretsExcluded: true
  });
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
