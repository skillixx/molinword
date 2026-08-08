import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createReleaseManifest, verifyReleaseManifest } from "../shared/release-manifest.js";

const rootDir = await mkdtemp(path.join(tmpdir(), "molinword-release-manifest-"));
try {
  for (const directory of [".agents", "database", "ops", "scripts", "server", "shared", "dist"]) {
    await mkdir(path.join(rootDir, directory), { recursive: true });
  }
  await writeFile(path.join(rootDir, ".agents", "registry.json"), "{}\n", "utf8");
  await writeFile(path.join(rootDir, "database", "migrate.mjs"), "export const migration = true;\n", "utf8");
  await writeFile(path.join(rootDir, "ops", "service.conf"), "service=true\n", "utf8");
  await writeFile(path.join(rootDir, "scripts", "acceptance.mjs"), "export const acceptance = true;\n", "utf8");
  await writeFile(path.join(rootDir, "server", "index.js"), "export const api = true;\n", "utf8");
  await writeFile(path.join(rootDir, "shared", "document-template.js"), "export const template = true;\n", "utf8");
  await writeFile(path.join(rootDir, "dist", "index.html"), "<!doctype html><title>AI Word</title>\n", "utf8");
  await writeFile(path.join(rootDir, "package.json"), JSON.stringify({ name: "fixture", version: "1.0.0" }), "utf8");
  await writeFile(path.join(rootDir, "package-lock.json"), JSON.stringify({ lockfileVersion: 3 }), "utf8");
  execFileSync("git", ["init"], { cwd: rootDir, stdio: "ignore", windowsHide: true });
  execFileSync("git", ["config", "user.name", "Molinword Release Test"], { cwd: rootDir, stdio: "ignore", windowsHide: true });
  execFileSync("git", ["config", "user.email", "release-test@example.invalid"], { cwd: rootDir, stdio: "ignore", windowsHide: true });
  execFileSync("git", ["add", "."], { cwd: rootDir, stdio: "ignore", windowsHide: true });
  execFileSync("git", ["commit", "-m", "fixture"], { cwd: rootDir, stdio: "ignore", windowsHide: true });

  await writeFile(path.join(rootDir, ".gitignore"), ".agents/hidden.json\n", "utf8");
  execFileSync("git", ["add", ".gitignore"], { cwd: rootDir, stdio: "ignore", windowsHide: true });
  execFileSync("git", ["commit", "-m", "ignore fixture"], { cwd: rootDir, stdio: "ignore", windowsHide: true });
  await writeFile(path.join(rootDir, ".agents", "hidden.json"), "{}\n", "utf8");
  assert.throws(() => createReleaseManifest({ rootDir }), /受控 Git 工作区/, "被 ignore 隐藏的未提交源码也不得归入旧提交清单");
  await rm(path.join(rootDir, ".agents", "hidden.json"), { force: true });

  execFileSync("git", ["update-index", "--skip-worktree", "server/index.js"], { cwd: rootDir, stdio: "ignore", windowsHide: true });
  await writeFile(path.join(rootDir, "server", "index.js"), "export const api = false;\n", "utf8");
  assert.throws(() => createReleaseManifest({ rootDir }), /受控 Git 工作区/, "skip-worktree 不得隐藏受覆盖源码改动");
  execFileSync("git", ["update-index", "--no-skip-worktree", "server/index.js"], { cwd: rootDir, stdio: "ignore", windowsHide: true });
  await writeFile(path.join(rootDir, "server", "index.js"), "export const api = true;\n", "utf8");

  execFileSync("git", ["update-index", "--assume-unchanged", "scripts/acceptance.mjs"], { cwd: rootDir, stdio: "ignore", windowsHide: true });
  await writeFile(path.join(rootDir, "scripts", "acceptance.mjs"), "export const acceptance = false;\n", "utf8");
  assert.throws(() => createReleaseManifest({ rootDir }), /受控 Git 工作区/, "assume-unchanged 不得隐藏受覆盖源码改动");
  execFileSync("git", ["update-index", "--no-assume-unchanged", "scripts/acceptance.mjs"], { cwd: rootDir, stdio: "ignore", windowsHide: true });
  await writeFile(path.join(rootDir, "scripts", "acceptance.mjs"), "export const acceptance = true;\n", "utf8");

  const manifest = createReleaseManifest({ rootDir });
  await writeFile(path.join(rootDir, "dist", "release-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  assert.deepEqual(verifyReleaseManifest({ rootDir, expectedReleaseId: manifest.releaseId }), manifest);
  assert.match(manifest.releaseId, /^[0-9a-f]{12}-[0-9a-f]{16}$/);

  await writeFile(path.join(rootDir, "server", "index.js"), "export const api = false;\n", "utf8");
  assert.throws(() => createReleaseManifest({ rootDir }), /受控 Git 工作区/, "受覆盖源码未提交时不得生成发布清单");
  assert.throws(() => verifyReleaseManifest({ rootDir }), /不一致/);
  assert.throws(() => verifyReleaseManifest({ rootDir, expectedReleaseId: "ffffffffffff-ffffffffffffffff" }), /不一致/);

  await writeFile(path.join(rootDir, "server", "index.js"), "export const api = true;\n", "utf8");
  const repairedManifest = createReleaseManifest({ rootDir });
  await writeFile(path.join(rootDir, "dist", "release-manifest.json"), `${JSON.stringify(repairedManifest, null, 2)}\n`, "utf8");
  await writeFile(path.join(rootDir, "scripts", "acceptance.mjs"), "export const acceptance = false;\n", "utf8");
  assert.throws(() => verifyReleaseManifest({ rootDir }), /不一致/, "验收脚本发生漂移时必须拒绝发布清单");

  await writeFile(path.join(rootDir, "scripts", "acceptance.mjs"), "export const acceptance = true;\n", "utf8");
  await writeFile(path.join(rootDir, "README.md"), "second commit\n", "utf8");
  execFileSync("git", ["add", "README.md"], { cwd: rootDir, stdio: "ignore", windowsHide: true });
  execFileSync("git", ["commit", "-m", "advance head"], { cwd: rootDir, stdio: "ignore", windowsHide: true });
  assert.throws(() => verifyReleaseManifest({ rootDir }), /Git HEAD/, "存在 Git 元数据时必须拒绝旧提交清单");

  console.log("生产发布制品清单契约检查通过。", {
    artifactBound: true,
    rollbackBound: true,
    tamperRejected: true
  });
} finally {
  await rm(rootDir, { recursive: true, force: true });
}
