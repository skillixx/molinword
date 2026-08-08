import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import {
  collectProductionAcceptanceEvidence,
  createBlockedAcceptanceEvidence,
  resolveAcceptanceAddresses,
  validateAcceptanceTarget,
  writeAcceptanceEvidence,
  writeAcceptanceEvidenceToDirectory
} from "./production-acceptance-evidence.mjs";

const securityHeaders = {
  "Cache-Control": "no-store",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Content-Security-Policy": "default-src 'self'; frame-ancestors 'none'"
};

let environment = "production";
let deployedReleaseId = "release-20260808";
let readyHangs = false;
let oversizedHealth = false;
let includeSecurityHeaders = true;
let authenticationProbeRequests = 0;
const receivedSensitiveHeaders = [];
const hangingResponses = new Set();
const server = createServer(async (request, response) => {
  const requestId = randomUUID();
  response.setHeader("X-Request-Id", requestId);
  response.setHeader("Connection", "close");
  if (request.headers.authorization || request.headers.cookie) {
    receivedSensitiveHeaders.push({ authorization: request.headers.authorization, cookie: request.headers.cookie });
  }
  if (request.url === "/") {
    if (includeSecurityHeaders) {
      for (const [name, value] of Object.entries(securityHeaders)) response.setHeader(name, value);
    }
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end("<!doctype html><title>AI Word</title>");
    return;
  }
  if (request.url === "/api/health") {
    response.writeHead(200, { "Content-Type": "application/json" });
    if (oversizedHealth) {
      response.end(JSON.stringify({ ok: true, padding: "x".repeat(70 * 1024) }));
      return;
    }
    response.end(JSON.stringify({
      ok: true,
      environment,
      releaseId: deployedReleaseId,
      gatewayConfigured: true,
      databaseConfigured: true,
      storageConfigured: true,
      sessionRequired: true,
      internalSecret: "health-body-must-not-enter-evidence"
    }));
    return;
  }
  if (request.url === "/api/ready") {
    if (readyHangs) {
      hangingResponses.add(response);
      response.once("close", () => hangingResponses.delete(response));
      return;
    }
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({
      ready: true,
      checks: { configuration: true, database: true, storage: true, gateway: true },
      internalToken: "ready-body-must-not-enter-evidence"
    }));
    return;
  }
  if (request.url === "/api/__production_acceptance_missing__") {
    response.writeHead(404, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ message: "不存在", internalDetail: "missing-body-must-not-enter-evidence" }));
    return;
  }
  if (request.url === "/api/ai/auth-check" && request.method === "GET") {
    authenticationProbeRequests += 1;
    response.writeHead(401, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ message: "请先登录", internalDetail: "auth-body-must-not-enter-evidence" }));
    return;
  }
  response.writeHead(500, { "Content-Type": "application/json" });
  response.end(JSON.stringify({ message: "unexpected" }));
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
assert.ok(address && typeof address === "object");
const baseUrl = `http://127.0.0.1:${address.port}`;
const temporaryDirectory = await mkdtemp(join(tmpdir(), "molinword-acceptance-"));

async function runCollectorCli(argumentsList) {
  const child = spawn(process.execPath, ["scripts/production-acceptance-evidence.mjs", ...argumentsList], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  const output = [];
  child.stdout.on("data", (chunk) => output.push(chunk.toString("utf8")));
  child.stderr.on("data", (chunk) => output.push(chunk.toString("utf8")));
  const exitCode = await new Promise((resolve) => child.once("exit", resolve));
  return { exitCode, output: output.join("") };
}

try {
  assert.throws(() => validateAcceptanceTarget("http://example.com", { allowInsecureLoopback: true }), /HTTPS/);
  assert.throws(() => validateAcceptanceTarget("https://user:secret@example.com"), /凭据/);
  assert.throws(() => validateAcceptanceTarget("https://example.com/path?token=secret"), /根路径|查询/);
  assert.throws(() => validateAcceptanceTarget("https://169.254.169.254"), /公网 DNS/);
  assert.throws(() => validateAcceptanceTarget("https://localhost"), /公网 DNS/);
  assert.throws(() => validateAcceptanceTarget("https://word.example.com:444"), /443/);
  assert.equal(validateAcceptanceTarget(baseUrl, { allowInsecureLoopback: true }).origin, baseUrl);

  const publicTarget = validateAcceptanceTarget("https://word.example.com");
  const fakeLookup = (entries) => async () => entries;
  await assert.rejects(
    () => resolveAcceptanceAddresses(publicTarget, { lookup: fakeLookup([{ address: "10.0.0.1", family: 4 }]) }),
    /公网地址/
  );
  await assert.rejects(
    () => resolveAcceptanceAddresses(publicTarget, { lookup: fakeLookup([{ address: "169.254.169.254", family: 4 }]) }),
    /公网地址/
  );
  await assert.rejects(
    () => resolveAcceptanceAddresses(publicTarget, {
      lookup: fakeLookup([{ address: "93.184.216.34", family: 4 }, { address: "10.0.0.1", family: 4 }])
    }),
    /公网地址/
  );
  assert.deepEqual(
    await resolveAcceptanceAddresses(publicTarget, { lookup: fakeLookup([{ address: "93.184.216.34", family: 4 }]) }),
    [{ address: "93.184.216.34", family: 4 }]
  );
  await assert.rejects(
    () => resolveAcceptanceAddresses(publicTarget, { lookup: () => new Promise(() => {}), timeoutMs: 100 }),
    /解析超时/
  );
  let unsafeResolutionError;
  try {
    await resolveAcceptanceAddresses(publicTarget, { lookup: fakeLookup([{ address: "10.0.0.1", family: 4 }]) });
  } catch (error) {
    unsafeResolutionError = error;
  }
  const blockedResolutionEvidence = createBlockedAcceptanceEvidence({ releaseId: "release-unsafe-dns", error: unsafeResolutionError });
  assert.equal(blockedResolutionEvidence.releaseDecision, "blocked");
  assert.equal(blockedResolutionEvidence.checks[0].detailCode, "unsafe-dns-resolution");
  assert.equal(blockedResolutionEvidence.targetOrigin, "", "未通过安全校验的目标 URL 不得进入证据");
  await assert.rejects(
    () => collectProductionAcceptanceEvidence({ baseUrl: "https://word.example.com", releaseId: "release-mismatch", approvedBaseUrl: "https://other.example.com" }),
    /APP_BASE_URL/
  );

  const evidence = await collectProductionAcceptanceEvidence({
    baseUrl,
    releaseId: "release-20260808",
    allowInsecureLoopback: true,
    timeoutMs: 1000
  });
  assert.equal(evidence.automaticStatus, "passed");
  assert.equal(evidence.releaseDecision, "manual-approval-required");
  assert.equal(evidence.targetOrigin, baseUrl);
  assert.ok(evidence.checks.every((check) => check.status === "passed"));
  assert.equal(evidence.observations.health.environment, "production");
  assert.equal(evidence.observations.health.releaseId, "release-20260808");
  assert.equal(evidence.observations.health.sessionRequired, true);
  assert.deepEqual(evidence.observations.ready.checks, {
    configuration: true,
    database: true,
    storage: true,
    gateway: true
  });
  assert.equal(evidence.observations.site.contentTypeIsHtml, true);
  assert.equal(evidence.observations.site.cacheControl, "no-store");
  assert.ok(evidence.requestIds.length >= 4);
  assert.equal(new Set(evidence.requestIds).size, evidence.requestIds.length);
  assert.deepEqual(evidence.manualChecks.map((check) => check.id), [
    "moling-sso",
    "http-contracts",
    "agent-workflow",
    "points-ledger",
    "insufficient-points",
    "failure-reconciliation",
    "word-visual",
    "multi-device",
    "audit-correlation",
    "rollback-drill"
  ]);
  assert.ok(evidence.manualChecks.every((check) => check.status === "pending"));
  assert.equal(receivedSensitiveHeaders.length, 0, "自动证据采集不得发送 Cookie 或 Authorization");

  const serialized = JSON.stringify(evidence);
  for (const secret of ["health-body-must-not-enter-evidence", "ready-body-must-not-enter-evidence", "missing-body-must-not-enter-evidence", "auth-body-must-not-enter-evidence"]) {
    assert.ok(!serialized.includes(secret), `证据文件不能保存响应体中的非白名单字段：${secret}`);
  }

  const outputPath = join(temporaryDirectory, "acceptance.json");
  await writeAcceptanceEvidence(outputPath, evidence);
  assert.deepEqual(JSON.parse(await readFile(outputPath, "utf8")), evidence);
  await assert.rejects(() => writeAcceptanceEvidence(outputPath, evidence), /已存在/);
  const appendOnlyOutputA = await writeAcceptanceEvidenceToDirectory(temporaryDirectory, evidence);
  const appendOnlyOutputB = await writeAcceptanceEvidenceToDirectory(temporaryDirectory, evidence);
  assert.notEqual(appendOnlyOutputA, appendOnlyOutputB, "同一发布重试必须保留两份不同的证据文件");
  assert.deepEqual(JSON.parse(await readFile(appendOnlyOutputA, "utf8")), evidence);

  const cliOutputPath = join(temporaryDirectory, "acceptance-cli.json");
  deployedReleaseId = "release-cli";
  const cliResult = await runCollectorCli([
    `--base-url=${baseUrl}`,
    "--release-id=release-cli",
    `--output=${cliOutputPath}`,
    "--timeout-ms=1000",
    "--allow-http-loopback"
  ]);
  assert.equal(cliResult.exitCode, 0, cliResult.output);
  assert.equal(JSON.parse(await readFile(cliOutputPath, "utf8")).automaticStatus, "passed");
  deployedReleaseId = "release-20260808";

  const unknownArgumentResult = await runCollectorCli(["--token=command-line-secret"]);
  assert.equal(unknownArgumentResult.exitCode, 1);
  assert.ok(!unknownArgumentResult.output.includes("command-line-secret"), "未知参数错误不能回显可能误传的密钥");

  const blockedOutputDirectory = join(temporaryDirectory, "blocked-initialization");
  const unsafeTargetResult = await runCollectorCli([
    "--base-url=https://169.254.169.254",
    "--release-id=release-private-target",
    `--output-dir=${blockedOutputDirectory}`
  ]);
  assert.equal(unsafeTargetResult.exitCode, 1);
  const blockedFiles = await readdir(blockedOutputDirectory);
  assert.equal(blockedFiles.length, 1, "不安全目标被拒绝时仍必须追加一份 blocked 证据");
  const blockedTargetEvidence = JSON.parse(await readFile(join(blockedOutputDirectory, blockedFiles[0]), "utf8"));
  assert.equal(blockedTargetEvidence.releaseDecision, "blocked");
  assert.equal(blockedTargetEvidence.checks[0].detailCode, "collector-initialization-failed");
  assert.equal(blockedTargetEvidence.targetOrigin, "");

  const failedCliOutputPath = join(temporaryDirectory, "acceptance-cli-failed.json");
  const failedCliResult = await runCollectorCli([
    `--base-url=${baseUrl}`,
    "--release-id=release-cli-mismatch",
    `--output=${failedCliOutputPath}`,
    "--timeout-ms=1000",
    "--allow-http-loopback"
  ]);
  assert.equal(failedCliResult.exitCode, 1, failedCliResult.output);
  assert.equal(JSON.parse(await readFile(failedCliOutputPath, "utf8")).releaseDecision, "blocked");

  const mismatchedReleaseEvidence = await collectProductionAcceptanceEvidence({
    baseUrl,
    releaseId: "release-wrong",
    allowInsecureLoopback: true,
    timeoutMs: 1000
  });
  assert.equal(mismatchedReleaseEvidence.automaticStatus, "failed");
  assert.equal(mismatchedReleaseEvidence.checks.find((check) => check.id === "release-binding")?.status, "failed");

  environment = "development";
  const authenticationProbeCountBeforeDevelopment = authenticationProbeRequests;
  const developmentEvidence = await collectProductionAcceptanceEvidence({
    baseUrl,
    releaseId: "release-development-rejected",
    allowInsecureLoopback: true,
    timeoutMs: 1000
  });
  assert.equal(developmentEvidence.automaticStatus, "failed");
  assert.equal(developmentEvidence.releaseDecision, "blocked");
  assert.equal(developmentEvidence.checks.find((check) => check.id === "health-production")?.status, "failed");
  assert.equal(developmentEvidence.observations.unauthenticatedAi.skipped, true);
  assert.equal(authenticationProbeRequests, authenticationProbeCountBeforeDevelopment, "非生产或未强制会话时不能触发 AI 认证探针");
  environment = "production";

  includeSecurityHeaders = false;
  const weakHeaderEvidence = await collectProductionAcceptanceEvidence({
    baseUrl,
    releaseId: "release-weak-headers-rejected",
    allowInsecureLoopback: true,
    timeoutMs: 1000
  });
  assert.equal(weakHeaderEvidence.automaticStatus, "failed");
  assert.equal(weakHeaderEvidence.checks.find((check) => check.id === "security-headers")?.status, "failed");
  assert.equal(weakHeaderEvidence.checks.find((check) => check.id === "site-cache-policy")?.status, "failed");
  includeSecurityHeaders = true;

  oversizedHealth = true;
  const oversizedEvidence = await collectProductionAcceptanceEvidence({
    baseUrl,
    releaseId: "release-oversized-health-rejected",
    allowInsecureLoopback: true,
    timeoutMs: 1000
  });
  assert.equal(oversizedEvidence.automaticStatus, "failed");
  assert.equal(oversizedEvidence.checks.find((check) => check.id === "health-http")?.status, "failed");
  oversizedHealth = false;

  readyHangs = true;
  const timeoutEvidence = await collectProductionAcceptanceEvidence({
    baseUrl,
    releaseId: "release-timeout-rejected",
    allowInsecureLoopback: true,
    timeoutMs: 100
  });
  assert.equal(timeoutEvidence.automaticStatus, "failed");
  assert.equal(timeoutEvidence.checks.find((check) => check.id === "ready-dependencies")?.status, "failed");

  console.log("生产验收证据采集契约检查通过。", {
    automaticChecks: evidence.checks.length,
    manualChecks: evidence.manualChecks.length,
    redacted: true,
    failClosed: true
  });
} finally {
  for (const response of hangingResponses) response.destroy();
  await new Promise((resolve) => server.close(resolve));
  await rm(temporaryDirectory, { recursive: true, force: true });
}
