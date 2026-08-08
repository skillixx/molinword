import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

export function validateReleaseTarget(target, runtime) {
  const errors = [];
  if (runtime.os !== target.os) errors.push(`操作系统不匹配：要求 ${target.os}，实际 ${runtime.os}`);
  if (runtime.cpu !== target.cpu) errors.push(`CPU 架构不匹配：要求 ${target.cpu}，实际 ${runtime.cpu}`);
  if (runtime.libc !== target.libc) errors.push(`C 运行库不匹配：要求 ${target.libc}，实际 ${runtime.libc}`);
  return errors;
}

export function detectReleaseRuntime() {
  const reportHeader = typeof process.report?.getReport === "function" ? process.report.getReport().header : {};
  // 中文注解：当前商业部署只批准 glibc；Linux 上取不到 glibc 版本时保持 unknown 并失败关闭，不能把 musl 猜成 glibc。
  const libc = process.platform === "linux" && reportHeader.glibcVersionRuntime ? "glibc" : "unknown";
  return { os: process.platform, cpu: process.arch, libc, glibcVersion: reportHeader.glibcVersionRuntime || "" };
}

const target = JSON.parse(await readFile("ops/release-target.json", "utf8"));
if (process.argv.includes("--self-test")) {
  assert.deepEqual(validateReleaseTarget(target, { os: "linux", cpu: "x64", libc: "glibc" }), []);
  assert.equal(validateReleaseTarget(target, { os: "win32", cpu: "x64", libc: "unknown" }).length, 2);
  assert.equal(validateReleaseTarget(target, { os: "linux", cpu: "arm64", libc: "glibc" }).length, 1);
  assert.equal(validateReleaseTarget(target, { os: "linux", cpu: "x64", libc: "musl" }).length, 1);
  console.log("生产发布目标预检契约通过。", { target });
} else {
  const runtime = detectReleaseRuntime();
  const errors = validateReleaseTarget(target, runtime);
  if (errors.length) throw new Error(`当前服务器不符合发布目标：\n${errors.join("\n")}`);
  console.log("生产服务器发布目标检查通过。", { target, runtime });
}
