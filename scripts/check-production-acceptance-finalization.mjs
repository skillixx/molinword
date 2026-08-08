import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  finalizeProductionAcceptance,
  verifyLatestProductionAcceptanceApproval,
  verifyProductionAcceptanceApproval
} from "./finalize-production-acceptance.mjs";

const automaticCheckIds = [
  "site-entry", "site-cache-policy", "security-headers", "health-http", "health-production",
  "release-binding", "health-configuration", "ready-dependencies", "json-404",
  "unauthenticated-ai", "server-request-ids"
];
const manualCheckIds = [
  "moling-sso", "http-contracts", "agent-workflow", "points-ledger", "insufficient-points",
  "failure-reconciliation", "word-visual", "multi-device", "audit-correlation", "rollback-drill"
];
const releaseId = "abcdef123456-0123456789abcdef";
const collectedAt = "2026-08-08T14:00:00.000Z";
const approvedAt = "2026-08-08T15:00:00.000Z";
const now = new Date("2026-08-08T16:00:00.000Z");
const approvalKey = randomBytes(32);

function validAuthorization(overrides = {}) {
  return {
    schemaVersion: 1,
    kind: "molinword-production-acceptance-authorization",
    releaseId,
    approverId: "ops.approver@example.com",
    changeId: "CHG-20260808-001",
    authorizedAt: "2026-08-08T15:30:00.000Z",
    expiresAt: "2026-08-09T14:30:00.000Z",
    preflightSha256: "fixture-generated",
    manualSha256: "fixture-generated",
    ...overrides
  };
}

function validPreflight(overrides = {}) {
  return {
    schemaVersion: 1,
    kind: "molinword-production-acceptance-preflight",
    releaseId,
    targetOrigin: "https://word.example.com",
    collectedAt,
    automaticStatus: "passed",
    releaseDecision: "manual-approval-required",
    checks: automaticCheckIds.map((id) => ({ id, status: "passed", detailCode: "ok" })),
    observations: { health: { releaseId } },
    requestIds: Array.from({ length: 4 }, () => randomUUID()),
    manualChecks: manualCheckIds.map((id) => ({ id, title: id, evidenceRequired: "required", status: "pending" })),
    ...overrides
  };
}

function validManual(overrides = {}) {
  return {
    schemaVersion: 1,
    kind: "molinword-production-manual-acceptance",
    releaseId,
    approverId: "ops.approver@example.com",
    changeId: "CHG-20260808-001",
    approvedAt,
    preflightSha256: "fixture-generated",
    checks: manualCheckIds.map((id) => ({
      id,
      status: "passed",
      evidenceFiles: [{ file: `${releaseId}-evidence/${id}.txt`, sha256: "fixture-generated" }]
    })),
    ...overrides
  };
}

async function writeFixture(rootDir, { preflight = validPreflight(), manual = validManual() } = {}) {
  await mkdir(path.join(rootDir, `${releaseId}-evidence`), { recursive: true });
  const preparedManual = structuredClone(manual);
  for (const id of manualCheckIds) {
    const evidenceContent = `evidence-content-${id}\n`;
    await writeFile(path.join(rootDir, `${releaseId}-evidence`, `${id}.txt`), evidenceContent, "utf8");
    const manualCheck = preparedManual.checks?.find((check) => check.id === id);
    for (const evidence of manualCheck?.evidenceFiles || []) {
      if (evidence.sha256 === "fixture-generated") {
        evidence.sha256 = createHash("sha256").update(evidenceContent, "utf8").digest("hex");
      }
    }
  }
  const preflightContent = `${JSON.stringify(preflight, null, 2)}\n`;
  if (preparedManual.preflightSha256 === "fixture-generated") {
    preparedManual.preflightSha256 = createHash("sha256").update(preflightContent, "utf8").digest("hex");
  }
  await writeFile(
    path.join(rootDir, `${releaseId}-20260808T140000000Z-${randomUUID()}.json`),
    preflightContent,
    "utf8"
  );
  const manualContent = `${JSON.stringify(preparedManual, null, 2)}\n`;
  await writeFile(path.join(rootDir, `${releaseId}-manual.json`), manualContent, "utf8");
  return validAuthorization({
    preflightSha256: createHash("sha256").update(preflightContent, "utf8").digest("hex"),
    manualSha256: createHash("sha256").update(manualContent, "utf8").digest("hex")
  });
}

async function runFinalizerCli(argumentsList, environment = {}) {
  const child = spawn(process.execPath, ["scripts/finalize-production-acceptance.mjs", ...argumentsList], {
    cwd: process.cwd(),
    env: { ...process.env, ...environment },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  const output = [];
  child.stdout.on("data", (chunk) => output.push(chunk.toString("utf8")));
  child.stderr.on("data", (chunk) => output.push(chunk.toString("utf8")));
  const exitCode = await new Promise((resolve) => child.once("exit", resolve));
  return { exitCode, output: output.join("") };
}

const temporaryRoot = await mkdtemp(path.join(tmpdir(), "molinword-acceptance-finalization-"));

try {
  const successDirectory = path.join(temporaryRoot, "success");
  await mkdir(successDirectory);
  const successAuthorization = await writeFixture(successDirectory);

  const first = await finalizeProductionAcceptance({
    acceptanceDirectory: successDirectory,
    releaseId,
    approvalKey,
    authorizationGrant: successAuthorization,
    now
  });
  assert.equal(first.record.releaseDecision, "approved");
  assert.equal(first.record.releaseId, releaseId);
  assert.equal(first.record.manualApproval.approverId, "ops.approver@example.com");
  assert.equal(first.record.manualChecks.length, manualCheckIds.length);
  assert.ok(first.record.manualChecks.every((check) => check.status === "passed" && check.evidenceFiles.length === 1));
  assert.equal(verifyProductionAcceptanceApproval(first.record, approvalKey), true);

  const serialized = JSON.stringify(first.record);
  assert.ok(!serialized.includes(approvalKey.toString("hex")), "最终验收记录不得包含签名密钥");
  assert.ok(!serialized.includes("evidence-content-"), "最终验收记录只保存附件摘要，不能复制附件正文");
  assert.match(first.record.preflight.sha256, /^[0-9a-f]{64}$/);
  assert.ok(first.record.manualChecks.every((check) => /^[0-9a-f]{64}$/.test(check.evidenceFiles[0].sha256)));

  const tampered = structuredClone(first.record);
  tampered.releaseDecision = "blocked";
  assert.throws(() => verifyProductionAcceptanceApproval(tampered, approvalKey), /签名/);
  assert.throws(() => verifyProductionAcceptanceApproval(first.record, randomBytes(32)), /签名/);

  const second = await finalizeProductionAcceptance({
    acceptanceDirectory: successDirectory,
    releaseId,
    approvalKey,
    authorizationGrant: successAuthorization,
    now: new Date(now.getTime() + 1000)
  });
  assert.notEqual(first.outputPath, second.outputPath, "同一版本复核必须追加新记录，不能覆盖既有批准文件");
  assert.equal((await readdir(successDirectory)).filter((name) => name.includes("-approval-")).length, 2);
  const latestVerified = await verifyLatestProductionAcceptanceApproval({
    acceptanceDirectory: successDirectory,
    releaseId,
    approvalKey,
    now
  });
  assert.equal(latestVerified.record.approvalHmacSha256, second.record.approvalHmacSha256);

  const evidenceToTamper = path.join(successDirectory, `${releaseId}-evidence`, "moling-sso.txt");
  await writeFile(evidenceToTamper, "tampered-evidence\n", "utf8");
  await assert.rejects(
    () => verifyLatestProductionAcceptanceApproval({ acceptanceDirectory: successDirectory, releaseId, approvalKey, now }),
    /附件发生变化/
  );
  await writeFile(evidenceToTamper, "evidence-content-moling-sso\n", "utf8");

  const newerBlockedPreflight = validPreflight({
    collectedAt: "2026-08-08T15:30:00.000Z",
    automaticStatus: "failed",
    releaseDecision: "blocked"
  });
  await writeFile(
    path.join(successDirectory, `${releaseId}-20260808T153000000Z-${randomUUID()}.json`),
    `${JSON.stringify(newerBlockedPreflight, null, 2)}\n`,
    "utf8"
  );
  await assert.rejects(
    () => verifyLatestProductionAcceptanceApproval({ acceptanceDirectory: successDirectory, releaseId, approvalKey, now }),
    /最新一次自动预检未通过/
  );

  const supersededDirectory = path.join(temporaryRoot, "superseded");
  await mkdir(supersededDirectory);
  const supersededAuthorization = await writeFixture(supersededDirectory);
  await finalizeProductionAcceptance({
    acceptanceDirectory: supersededDirectory,
    releaseId,
    approvalKey,
    authorizationGrant: supersededAuthorization,
    now
  });
  const newerPassedPreflight = validPreflight({ collectedAt: "2026-08-08T15:30:00.000Z" });
  await writeFile(
    path.join(supersededDirectory, `${releaseId}-20260808T153000000Z-${randomUUID()}.json`),
    `${JSON.stringify(newerPassedPreflight, null, 2)}\n`,
    "utf8"
  );
  await assert.rejects(
    () => verifyLatestProductionAcceptanceApproval({ acceptanceDirectory: supersededDirectory, releaseId, approvalKey, now }),
    /未绑定当前最新自动预检/
  );

  const missingCheckDirectory = path.join(temporaryRoot, "missing-check");
  await mkdir(missingCheckDirectory);
  const missingCheckAuthorization = await writeFixture(missingCheckDirectory, { manual: validManual({ checks: validManual().checks.slice(1) }) });
  await assert.rejects(
    () => finalizeProductionAcceptance({ acceptanceDirectory: missingCheckDirectory, releaseId, approvalKey, authorizationGrant: missingCheckAuthorization, now }),
    /人工验收项/
  );

  const traversalDirectory = path.join(temporaryRoot, "traversal");
  await mkdir(traversalDirectory);
  const traversalManual = validManual();
  traversalManual.checks[0].evidenceFiles = [{ file: "../outside-secret.txt", sha256: "0".repeat(64) }];
  const traversalAuthorization = await writeFixture(traversalDirectory, { manual: traversalManual });
  await assert.rejects(
    () => finalizeProductionAcceptance({ acceptanceDirectory: traversalDirectory, releaseId, approvalKey, authorizationGrant: traversalAuthorization, now }),
    /附件路径/
  );

  const blockedDirectory = path.join(temporaryRoot, "blocked");
  await mkdir(blockedDirectory);
  const blockedAuthorization = await writeFixture(blockedDirectory, {
    preflight: validPreflight({ automaticStatus: "failed", releaseDecision: "blocked" })
  });
  await writeFile(
    path.join(blockedDirectory, `${releaseId}-20260808T130000000Z-${randomUUID()}.json`),
    `${JSON.stringify(validPreflight({ collectedAt: "2026-08-08T13:00:00.000Z" }), null, 2)}\n`,
    "utf8"
  );
  await assert.rejects(
    () => finalizeProductionAcceptance({ acceptanceDirectory: blockedDirectory, releaseId, approvalKey, authorizationGrant: blockedAuthorization, now }),
    /最新一次自动预检/
  );

  const unauthorizedDirectory = path.join(temporaryRoot, "unauthorized");
  await mkdir(unauthorizedDirectory);
  const unauthorizedAuthorization = await writeFixture(unauthorizedDirectory);
  await assert.rejects(
    () => finalizeProductionAcceptance({
      acceptanceDirectory: unauthorizedDirectory,
      releaseId,
      approvalKey,
      authorizationGrant: { ...unauthorizedAuthorization, approverId: "unapproved@example.com" },
      now
    }),
    /未精确绑定当前发布、审批人、变更单或已复核证据/
  );

  const excessivePreflightDirectory = path.join(temporaryRoot, "excessive-preflights");
  await mkdir(excessivePreflightDirectory);
  const excessivePreflightAuthorization = await writeFixture(excessivePreflightDirectory);
  for (let index = 0; index < 64; index += 1) {
    await writeFile(
      path.join(excessivePreflightDirectory, `${releaseId}-20260808T140000000Z-${randomUUID()}.json`),
      `${JSON.stringify(validPreflight(), null, 2)}\n`,
      "utf8"
    );
  }
  await assert.rejects(
    () => finalizeProductionAcceptance({
      acceptanceDirectory: excessivePreflightDirectory,
      releaseId,
      approvalKey,
      authorizationGrant: excessivePreflightAuthorization,
      now
    }),
    /自动预检记录数量超过安全上限/
  );
  await assert.rejects(
    () => finalizeProductionAcceptance({
      acceptanceDirectory: unauthorizedDirectory,
      releaseId,
      approvalKey,
      authorizationGrant: {
        ...unauthorizedAuthorization,
        authorizedAt: "2026-08-08T14:30:00.000Z",
        expiresAt: "2026-08-08T16:30:00.000Z"
      },
      now
    }),
    /必须晚于人工批准/
  );
  await assert.rejects(
    () => finalizeProductionAcceptance({
      acceptanceDirectory: unauthorizedDirectory,
      releaseId,
      approvalKey,
      authorizationGrant: {
        ...unauthorizedAuthorization,
        authorizedAt: approvedAt,
        expiresAt: "2026-08-08T16:30:00.000Z"
      },
      now
    }),
    /必须晚于人工批准/
  );
  await assert.rejects(
    () => finalizeProductionAcceptance({
      acceptanceDirectory: unauthorizedDirectory,
      releaseId,
      approvalKey,
      authorizationGrant: { ...unauthorizedAuthorization, expiresAt: "2026-08-08T15:30:00.000Z" },
      now
    }),
    /必须晚于人工批准/
  );

  const authorizationDigestDirectory = path.join(temporaryRoot, "authorization-digest");
  await mkdir(authorizationDigestDirectory);
  const evidenceBoundAuthorization = await writeFixture(authorizationDigestDirectory);
  const changedEvidenceContent = "evidence-replaced-after-authorization\n";
  await writeFile(
    path.join(authorizationDigestDirectory, `${releaseId}-evidence`, "moling-sso.txt"),
    changedEvidenceContent,
    "utf8"
  );
  const changedManualPath = path.join(authorizationDigestDirectory, `${releaseId}-manual.json`);
  const changedManual = JSON.parse(await readFile(changedManualPath, "utf8"));
  changedManual.checks.find((check) => check.id === "moling-sso").evidenceFiles[0].sha256 = createHash("sha256")
    .update(changedEvidenceContent, "utf8")
    .digest("hex");
  await writeFile(changedManualPath, `${JSON.stringify(changedManual, null, 2)}\n`, "utf8");
  await assert.rejects(
    () => finalizeProductionAcceptance({
      acceptanceDirectory: authorizationDigestDirectory,
      releaseId,
      approvalKey,
      authorizationGrant: evidenceBoundAuthorization,
      now
    }),
    /未精确绑定当前发布、审批人、变更单或已复核证据/
  );

  const equalApprovalTimeDirectory = path.join(temporaryRoot, "equal-approval-time");
  await mkdir(equalApprovalTimeDirectory);
  const equalApprovalAuthorization = await writeFixture(equalApprovalTimeDirectory, { manual: validManual({ approvedAt: collectedAt }) });
  await assert.rejects(
    () => finalizeProductionAcceptance({
      acceptanceDirectory: equalApprovalTimeDirectory,
      releaseId,
      approvalKey,
      authorizationGrant: equalApprovalAuthorization,
      now
    }),
    /必须晚于自动预检/
  );

  const cliDirectory = path.join(temporaryRoot, "cli");
  const credentialsDirectory = path.join(temporaryRoot, "credentials");
  await mkdir(cliDirectory);
  await mkdir(credentialsDirectory);
  const cliNow = Date.now();
  const cliCollectedAt = new Date(cliNow - 2 * 60 * 1000).toISOString();
  const cliApprovedAt = new Date(cliNow - 60 * 1000).toISOString();
  const cliAuthorizationBase = await writeFixture(cliDirectory, {
    preflight: validPreflight({ collectedAt: cliCollectedAt }),
    manual: validManual({ approvedAt: cliApprovedAt })
  });
  await writeFile(path.join(credentialsDirectory, "acceptance_approval_key"), approvalKey);
  const cliAuthorization = {
    ...cliAuthorizationBase,
    authorizedAt: new Date(cliNow - 30 * 1000).toISOString(),
    expiresAt: new Date(cliNow + 24 * 60 * 60 * 1000).toISOString()
  };
  await writeFile(
    path.join(credentialsDirectory, "acceptance_authorization"),
    `${JSON.stringify(cliAuthorization, null, 2)}\n`,
    "utf8"
  );
  const cliResult = await runFinalizerCli([
    `--release-id=${releaseId}`,
    `--acceptance-dir=${cliDirectory}`
  ], { CREDENTIALS_DIRECTORY: credentialsDirectory });
  assert.equal(cliResult.exitCode, 0, cliResult.output);
  assert.ok(!cliResult.output.includes(approvalKey.toString("hex")), "CLI 日志不得输出签名密钥");
  const cliApprovalName = (await readdir(cliDirectory)).find((name) => name.includes("-approval-"));
  assert.ok(cliApprovalName, "systemd credential 语义下必须生成批准记录");
  assert.equal(
    verifyProductionAcceptanceApproval(JSON.parse(await readFile(path.join(cliDirectory, cliApprovalName), "utf8")), approvalKey),
    true
  );
  const cliVerifyResult = await runFinalizerCli([
    `--release-id=${releaseId}`,
    `--acceptance-dir=${cliDirectory}`,
    "--verify-latest"
  ], { CREDENTIALS_DIRECTORY: credentialsDirectory });
  assert.equal(cliVerifyResult.exitCode, 0, cliVerifyResult.output);
  assert.match(cliVerifyResult.output, /完整性验证通过/);

  assert.deepEqual(JSON.parse(await readFile(first.outputPath, "utf8")), first.record);
  console.log("生产最终验收签名与附件完整性检查通过。", {
    automaticChecks: automaticCheckIds.length,
    manualChecks: manualCheckIds.length,
    appendOnly: true,
    signed: true
  });
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
