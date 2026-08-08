import crypto from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { lstat, open, opendir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  normalizeAcceptanceReleaseId,
  productionAcceptanceApprovalKind,
  productionAcceptanceAuthorizationKind,
  productionAcceptanceAutomaticCheckIds,
  productionAcceptanceManualChecks,
  productionAcceptancePreflightKind,
  productionAcceptanceSchemaVersion,
  productionManualAcceptanceKind
} from "../shared/production-acceptance-contract.js";

const maximumDirectoryEntries = 4096;
const maximumPreflightCandidates = 64;
const maximumTotalPreflightBytes = 8 * 1024 * 1024;
const maximumPreflightBytes = 256 * 1024;
const maximumManualManifestBytes = 256 * 1024;
const maximumApprovalRecordBytes = 512 * 1024;
const maximumAuthorizationCredentialBytes = 64 * 1024;
const maximumEvidenceFiles = 80;
const maximumEvidenceFilesPerCheck = 8;
const maximumEvidenceFileBytes = 32 * 1024 * 1024;
const maximumTotalEvidenceBytes = 256 * 1024 * 1024;
const requestIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function finalizationError(message, detailCode = "acceptance-finalization-failed") {
  return Object.assign(new Error(message), { detailCode });
}

// 中文注解：HMAC 必须对与属性插入顺序无关的确定字节签名，否则同一审批记录在不同 JSON 序列化顺序下会得到不同结果。
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function normalizeApprovalKey(value) {
  const key = Buffer.isBuffer(value) ? Buffer.from(value) : Buffer.from(value || "");
  if (key.byteLength < 32 || key.byteLength > 4096 || key.every((byte) => byte === key[0])) {
    throw finalizationError("生产验收签名密钥必须是 32 至 4096 字节的独立高熵凭据。", "invalid-approval-key");
  }
  return key;
}

function approvalSignature(unsignedRecord, approvalKey) {
  return crypto.createHmac("sha256", normalizeApprovalKey(approvalKey))
    .update("molinword-production-acceptance-v1\n", "utf8")
    .update(canonicalJson(unsignedRecord), "utf8")
    .digest("hex");
}

export function verifyProductionAcceptanceApproval(record, approvalKey) {
  if (!record || typeof record !== "object" || !/^[0-9a-f]{64}$/.test(String(record.approvalHmacSha256 || ""))) {
    throw finalizationError("生产最终验收记录缺少有效签名。", "invalid-approval-signature");
  }
  const { approvalHmacSha256, ...unsignedRecord } = record;
  const expected = approvalSignature(unsignedRecord, approvalKey);
  const actualBuffer = Buffer.from(approvalHmacSha256, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  if (actualBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) {
    throw finalizationError("生产最终验收记录签名不匹配。", "invalid-approval-signature");
  }
  return true;
}

function assertExactKeys(value, expectedKeys, label, detailCode = "invalid-manual-manifest") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw finalizationError(`${label}必须是对象。`, detailCode);
  }
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw finalizationError(`${label}字段不完整或包含未批准字段。`, detailCode);
  }
}

function parseTimestamp(value, label) {
  const text = String(value || "");
  const timestamp = Date.parse(text);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(text) || !Number.isFinite(timestamp)) {
    throw finalizationError(`${label}必须是 UTC ISO 时间。`, "invalid-acceptance-time");
  }
  return timestamp;
}

function assertExactCheckIds(checks, expectedIds, expectedStatus, label) {
  if (!Array.isArray(checks) || checks.length !== expectedIds.length) {
    throw finalizationError(`${label}数量不完整。`, "incomplete-acceptance-checks");
  }
  const ids = checks.map((check) => String(check?.id || ""));
  if (new Set(ids).size !== ids.length || expectedIds.some((id) => !ids.includes(id))) {
    throw finalizationError(`${label}标识不完整或重复。`, "incomplete-acceptance-checks");
  }
  if (checks.some((check) => check?.status !== expectedStatus)) {
    throw finalizationError(`${label}尚未全部通过。`, "incomplete-acceptance-checks");
  }
}

function assertSafeTargetOrigin(value) {
  let target;
  try {
    target = new URL(String(value || ""));
  } catch {
    throw finalizationError("自动预检目标地址无效。", "invalid-preflight");
  }
  if (target.protocol !== "https:" || target.username || target.password || target.pathname !== "/" || target.search || target.hash) {
    throw finalizationError("自动预检目标必须是无凭据的 HTTPS 站点根地址。", "invalid-preflight");
  }
  return target.origin;
}

function validatePassedPreflight(preflight, expectedReleaseId, nowMs) {
  if (!preflight || preflight.schemaVersion !== productionAcceptanceSchemaVersion
    || preflight.kind !== productionAcceptancePreflightKind
    || preflight.releaseId !== expectedReleaseId) {
    throw finalizationError("自动预检文件类型或发布号不匹配。", "invalid-preflight");
  }
  if (preflight.automaticStatus !== "passed" || preflight.releaseDecision !== "manual-approval-required") return null;
  assertExactCheckIds(preflight.checks, productionAcceptanceAutomaticCheckIds, "passed", "自动预检项");
  assertExactCheckIds(preflight.manualChecks, productionAcceptanceManualChecks.map((check) => check.id), "pending", "待人工验收项");
  const collectedAtMs = parseTimestamp(preflight.collectedAt, "自动预检采集时间");
  if (collectedAtMs > nowMs + 5 * 60 * 1000) {
    throw finalizationError("自动预检采集时间不能晚于当前时间。", "invalid-preflight");
  }
  if (preflight.observations?.health?.releaseId !== expectedReleaseId) {
    throw finalizationError("自动预检健康发布号与目标版本不一致。", "invalid-preflight");
  }
  const requestIds = Array.isArray(preflight.requestIds) ? preflight.requestIds : [];
  if (requestIds.length < 4 || requestIds.some((value) => !requestIdPattern.test(String(value))) || new Set(requestIds).size !== requestIds.length) {
    throw finalizationError("自动预检请求 ID 证据不完整。", "invalid-preflight");
  }
  return { collectedAtMs, targetOrigin: assertSafeTargetOrigin(preflight.targetOrigin) };
}

function isPathWithin(rootPath, candidatePath) {
  const relative = path.relative(rootPath, candidatePath);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function sameFileIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

async function openVerifiedFile(rootRealPath, absolutePath, maximumBytes, label) {
  const initial = await lstat(absolutePath);
  if (initial.isSymbolicLink() || !initial.isFile() || initial.size <= 0 || initial.size > maximumBytes) {
    throw finalizationError(`${label}不是受支持的常规文件。`, "invalid-acceptance-file");
  }
  const resolvedBeforeOpen = await realpath(absolutePath);
  if (!isPathWithin(rootRealPath, resolvedBeforeOpen)) {
    throw finalizationError(`${label}必须位于验收目录内。`, "unsafe-acceptance-path");
  }
  // 中文注解：生产目标 Linux 使用 O_NOFOLLOW 拒绝最终组件符号链接；随后再用 inode 与真实路径把已打开句柄绑定到检查过的目录项。
  const openFlags = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0);
  const fileHandle = await open(absolutePath, openFlags);
  try {
    const opened = await fileHandle.stat();
    const current = await lstat(absolutePath);
    const resolvedAfterOpen = await realpath(absolutePath);
    if (!opened.isFile()
      || opened.size <= 0
      || opened.size > maximumBytes
      || current.isSymbolicLink()
      || !sameFileIdentity(initial, opened)
      || !sameFileIdentity(current, opened)
      || !isPathWithin(rootRealPath, resolvedAfterOpen)) {
      throw finalizationError(`${label}在安全检查与打开之间发生变化。`, "acceptance-file-changed");
    }
    if (process.platform === "linux") {
      const openedPath = await realpath(`/proc/self/fd/${fileHandle.fd}`);
      if (!isPathWithin(rootRealPath, openedPath)) {
        throw finalizationError(`${label}打开后的真实目标离开验收目录。`, "unsafe-acceptance-path");
      }
    }
    return { fileHandle, before: opened };
  } catch (error) {
    await fileHandle.close();
    throw error;
  }
}

// 中文注解：先限制文件类型与体积，再确认真实路径仍在验收根目录内；读取后复核字节数，避免越界文件和读取期间替换进入签名链路。
async function readBoundedJson(rootRealPath, absolutePath, maximumBytes, label) {
  const { fileHandle, before } = await openVerifiedFile(rootRealPath, absolutePath, maximumBytes, label);
  const chunks = [];
  let bytes = 0;
  try {
    for await (const chunk of fileHandle.createReadStream({ autoClose: false })) {
      bytes += chunk.byteLength;
      if (bytes > maximumBytes) throw finalizationError(`${label}读取量超过安全上限。`, "invalid-acceptance-file");
      chunks.push(chunk);
    }
    const after = await fileHandle.stat();
    const current = await lstat(absolutePath);
    if (bytes !== before.size
      || after.size !== before.size
      || after.mtimeMs !== before.mtimeMs
      || after.ctimeMs !== before.ctimeMs
      || !sameFileIdentity(after, before)
      || !sameFileIdentity(current, before)) {
      throw finalizationError(`${label}读取期间发生变化。`, "acceptance-file-changed");
    }
  } finally {
    await fileHandle.close();
  }
  const content = Buffer.concat(chunks, bytes);
  let value;
  try {
    value = JSON.parse(content.toString("utf8"));
  } catch {
    throw finalizationError(`${label}不是有效 JSON。`, "invalid-acceptance-file");
  }
  return {
    value,
    bytes: content.byteLength,
    sha256: crypto.createHash("sha256").update(content).digest("hex")
  };
}

function escapedRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function preflightFilePattern(releaseId) {
  return new RegExp(`^${escapedRegExp(releaseId)}-\\d{8}T\\d{9}Z-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\.json$`, "i");
}

function approvalFilePattern(releaseId) {
  return new RegExp(`^${escapedRegExp(releaseId)}-approval-\\d{8}T\\d{9}Z-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\.json$`, "i");
}

async function selectLatestPassedPreflight(rootPath, rootRealPath, releaseId, nowMs) {
  const filePattern = preflightFilePattern(releaseId);
  let latest = null;
  let entryCount = 0;
  let candidateCount = 0;
  let totalCandidateBytes = 0;
  for await (const entry of await opendir(rootPath)) {
    entryCount += 1;
    if (entryCount > maximumDirectoryEntries) throw finalizationError("验收目录文件数量超过安全上限。", "acceptance-directory-too-large");
    if (!filePattern.test(entry.name)) continue;
    candidateCount += 1;
    if (candidateCount > maximumPreflightCandidates) {
      throw finalizationError("当前版本自动预检记录数量超过安全上限。", "too-many-preflight-candidates");
    }
    if (!entry.isFile()) throw finalizationError("自动预检候选必须是常规文件。", "invalid-preflight");
    const absolutePath = path.join(rootPath, entry.name);
    const parsed = await readBoundedJson(rootRealPath, absolutePath, maximumPreflightBytes, "自动预检文件");
    if (!parsed.value || parsed.value.schemaVersion !== productionAcceptanceSchemaVersion
      || parsed.value.kind !== productionAcceptancePreflightKind
      || parsed.value.releaseId !== releaseId) {
      throw finalizationError("自动预检文件类型或发布号不匹配。", "invalid-preflight");
    }
    totalCandidateBytes += parsed.bytes;
    if (totalCandidateBytes > maximumTotalPreflightBytes) {
      throw finalizationError("当前版本自动预检记录总体积超过安全上限。", "preflight-candidates-too-large");
    }
    const candidate = {
      file: entry.name,
      ...parsed,
      collectedAtMs: parseTimestamp(parsed.value.collectedAt, "自动预检采集时间")
    };
    // 中文注解：扫描时只保留当前最新记录，避免批量 JSON 对象同时驻留内存；同一时间戳再按文件名稳定决胜。
    if (!latest
      || candidate.collectedAtMs > latest.collectedAtMs
      || (candidate.collectedAtMs === latest.collectedAtMs && candidate.file.localeCompare(latest.file, "en") > 0)) {
      latest = candidate;
    }
  }
  if (!latest) throw finalizationError("当前版本没有自动预检，不能进入人工批准。", "preflight-not-found");
  // 中文注解：必须以时间上最新的一次预检为准，不能在新版预检失败后回退选择更早的通过记录。
  const validated = validatePassedPreflight(latest.value, releaseId, nowMs);
  if (!validated) throw finalizationError("当前版本最新一次自动预检未通过，不能进入人工批准。", "latest-preflight-blocked");
  return { ...latest, ...validated };
}

function validateManualManifest(manual, expectedReleaseId, preflight, nowMs) {
  assertExactKeys(manual, ["schemaVersion", "kind", "releaseId", "approverId", "changeId", "approvedAt", "preflightSha256", "checks"], "人工验收清单");
  if (manual.schemaVersion !== productionAcceptanceSchemaVersion
    || manual.kind !== productionManualAcceptanceKind
    || manual.releaseId !== expectedReleaseId) {
    throw finalizationError("人工验收清单类型或发布号不匹配。", "invalid-manual-manifest");
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._@-]{2,79}$/.test(String(manual.approverId || ""))) {
    throw finalizationError("人工验收审批人标识无效。", "invalid-manual-approver");
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,79}$/.test(String(manual.changeId || ""))) {
    throw finalizationError("人工验收变更单号无效。", "invalid-change-id");
  }
  const approvedAtMs = parseTimestamp(manual.approvedAt, "人工批准时间");
  if (approvedAtMs <= preflight.collectedAtMs || approvedAtMs > nowMs + 5 * 60 * 1000) {
    throw finalizationError("人工批准时间必须晚于自动预检且不能晚于当前时间。", "invalid-acceptance-time");
  }
  if (!/^[0-9a-f]{64}$/.test(String(manual.preflightSha256 || "")) || manual.preflightSha256 !== preflight.sha256) {
    throw finalizationError("人工验收清单未绑定最新自动预检摘要。", "preflight-digest-mismatch");
  }
  assertExactCheckIds(manual.checks, productionAcceptanceManualChecks.map((check) => check.id), "passed", "人工验收项");
  for (const check of manual.checks) {
    assertExactKeys(check, ["id", "status", "evidenceFiles"], `人工验收项 ${check.id}`);
    if (!Array.isArray(check.evidenceFiles)
      || check.evidenceFiles.length < 1
      || check.evidenceFiles.length > maximumEvidenceFilesPerCheck) {
      throw finalizationError(`人工验收项 ${check.id} 的附件数量无效。`, "invalid-evidence-files");
    }
    for (const evidence of check.evidenceFiles) {
      assertExactKeys(evidence, ["file", "sha256"], `人工验收项 ${check.id} 的附件`);
      if (!/^[0-9a-f]{64}$/.test(String(evidence.sha256 || ""))) {
        throw finalizationError(`人工验收项 ${check.id} 的附件摘要无效。`, "invalid-evidence-digest");
      }
    }
  }
  return approvedAtMs;
}

function validateAuthorizationGrant(grant, expectedReleaseId, preflight, manual, nowMs) {
  assertExactKeys(
    grant,
    ["schemaVersion", "kind", "releaseId", "approverId", "changeId", "authorizedAt", "expiresAt", "preflightSha256", "manualSha256"],
    "生产验收授权凭据",
    "invalid-authorization-grant"
  );
  if (grant.schemaVersion !== productionAcceptanceSchemaVersion
    || grant.kind !== productionAcceptanceAuthorizationKind
    || grant.releaseId !== expectedReleaseId
    || grant.approverId !== manual.approverId
    || grant.changeId !== manual.changeId
    || !/^[0-9a-f]{64}$/.test(String(grant.preflightSha256 || ""))
    || !/^[0-9a-f]{64}$/.test(String(grant.manualSha256 || ""))
    || grant.preflightSha256 !== preflight.sha256
    || grant.manualSha256 !== manual.sha256) {
    throw finalizationError("生产验收授权凭据未精确绑定当前发布、审批人、变更单或已复核证据。", "authorization-grant-mismatch");
  }
  const authorizedAtMs = parseTimestamp(grant.authorizedAt, "生产验收授权时间");
  const expiresAtMs = parseTimestamp(grant.expiresAt, "生产验收授权过期时间");
  const manualApprovedAtMs = parseTimestamp(manual.approvedAt, "人工批准时间");
  const maximumAuthorizationWindowMs = 7 * 24 * 60 * 60 * 1000;
  if (authorizedAtMs <= manualApprovedAtMs
    || authorizedAtMs > nowMs + 5 * 60 * 1000
    || expiresAtMs <= nowMs
    || expiresAtMs <= authorizedAtMs
    || expiresAtMs - authorizedAtMs > maximumAuthorizationWindowMs) {
    throw finalizationError("生产验收授权必须晚于人工批准，且不能过期、尚未生效或超过七天。", "invalid-authorization-time");
  }
  const normalized = {
    schemaVersion: grant.schemaVersion,
    kind: grant.kind,
    releaseId: grant.releaseId,
    approverId: grant.approverId,
    changeId: grant.changeId,
    authorizedAt: grant.authorizedAt,
    expiresAt: grant.expiresAt,
    preflightSha256: grant.preflightSha256,
    manualSha256: grant.manualSha256
  };
  return {
    ...normalized,
    sha256: crypto.createHash("sha256").update(canonicalJson(normalized), "utf8").digest("hex")
  };
}

function normalizeEvidenceRelativePath(value, releaseId) {
  const relativePath = String(value || "");
  const segments = relativePath.split("/");
  if (!relativePath.startsWith(`${releaseId}-evidence/`)
    || relativePath.length > 240
    || !/^[A-Za-z0-9._/-]+$/.test(relativePath)
    || relativePath.includes("\\")
    || path.isAbsolute(relativePath)
    || segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw finalizationError("人工验收附件路径必须位于当前版本证据目录且只能使用安全相对路径。", "unsafe-evidence-path");
  }
  return relativePath;
}

// 中文注解：附件通过已打开句柄流式计算摘要，前后复核大小和修改时间，既控制内存，也拒绝哈希过程中被并发改写的证据。
async function hashEvidenceFile(rootPath, rootRealPath, relativePath) {
  const absolutePath = path.resolve(rootPath, ...relativePath.split("/"));
  if (!isPathWithin(rootPath, absolutePath)) throw finalizationError("人工验收附件路径越界。", "unsafe-evidence-path");
  const { fileHandle, before } = await openVerifiedFile(
    rootRealPath,
    absolutePath,
    maximumEvidenceFileBytes,
    "人工验收附件"
  );
  try {
    const digest = crypto.createHash("sha256");
    let bytes = 0;
    for await (const chunk of fileHandle.createReadStream({ autoClose: false })) {
      bytes += chunk.byteLength;
      if (bytes > maximumEvidenceFileBytes) throw finalizationError("人工验收附件读取量超过 32 MiB。", "invalid-evidence-file");
      digest.update(chunk);
    }
    const after = await fileHandle.stat();
    const current = await lstat(absolutePath);
    if (bytes !== before.size
      || after.size !== before.size
      || after.mtimeMs !== before.mtimeMs
      || after.ctimeMs !== before.ctimeMs
      || !sameFileIdentity(after, before)
      || !sameFileIdentity(current, before)) {
      throw finalizationError("人工验收附件读取期间发生变化。", "evidence-file-changed");
    }
    return { file: relativePath, bytes, sha256: digest.digest("hex") };
  } finally {
    await fileHandle.close();
  }
}

async function buildManualCheckEvidence(rootPath, rootRealPath, releaseId, manualChecks) {
  const descriptors = new Map();
  let totalBytes = 0;
  for (const check of manualChecks) {
    for (const expectedEvidence of check.evidenceFiles) {
      const relativePath = normalizeEvidenceRelativePath(expectedEvidence.file, releaseId);
      if (!descriptors.has(relativePath)) {
        if (descriptors.size >= maximumEvidenceFiles) throw finalizationError("人工验收附件总数超过安全上限。", "too-many-evidence-files");
        const descriptor = await hashEvidenceFile(rootPath, rootRealPath, relativePath);
        totalBytes += descriptor.bytes;
        if (totalBytes > maximumTotalEvidenceBytes) throw finalizationError("人工验收附件总体积超过 256 MiB。", "evidence-bundle-too-large");
        descriptors.set(relativePath, descriptor);
      }
      if (descriptors.get(relativePath).sha256 !== expectedEvidence.sha256) {
        throw finalizationError(`人工验收项 ${check.id} 的附件摘要与文件不一致。`, "evidence-digest-mismatch");
      }
    }
  }
  return manualChecks.map((manualCheck) => {
    const contract = productionAcceptanceManualChecks.find((check) => check.id === manualCheck.id);
    return {
      id: manualCheck.id,
      title: contract.title,
      status: "passed",
      evidenceFiles: manualCheck.evidenceFiles.map((evidence) => ({
        ...descriptors.get(normalizeEvidenceRelativePath(evidence.file, releaseId))
      }))
    };
  });
}

async function validateAcceptanceRoot(acceptanceDirectory) {
  const rootPath = path.resolve(String(acceptanceDirectory || ""));
  const metadata = await lstat(rootPath);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw finalizationError("生产验收目录必须是现有常规目录。", "invalid-acceptance-directory");
  }
  return { rootPath, rootRealPath: await realpath(rootPath) };
}

export async function finalizeProductionAcceptance({ acceptanceDirectory, releaseId, approvalKey, authorizationGrant, now = new Date() } = {}) {
  const normalizedReleaseId = normalizeAcceptanceReleaseId(releaseId);
  const normalizedNow = now instanceof Date ? now : new Date(now);
  const nowMs = normalizedNow.getTime();
  if (!Number.isFinite(nowMs)) throw finalizationError("最终验收时间无效。", "invalid-acceptance-time");
  const key = normalizeApprovalKey(approvalKey);
  const { rootPath, rootRealPath } = await validateAcceptanceRoot(acceptanceDirectory);
  const preflight = await selectLatestPassedPreflight(rootPath, rootRealPath, normalizedReleaseId, nowMs);
  const manualFile = `${normalizedReleaseId}-manual.json`;
  const manual = await readBoundedJson(rootRealPath, path.join(rootPath, manualFile), maximumManualManifestBytes, "人工验收清单");
  validateManualManifest(manual.value, normalizedReleaseId, preflight, nowMs);
  // 中文注解：审批人和变更单必须与 root 管理的短期授权凭据完全一致，不能只依赖人工 JSON 中可自填的字符串。
  const authorization = validateAuthorizationGrant(authorizationGrant, normalizedReleaseId, preflight, { ...manual.value, sha256: manual.sha256 }, nowMs);
  const manualChecks = await buildManualCheckEvidence(rootPath, rootRealPath, normalizedReleaseId, manual.value.checks);

  const finalizedAt = normalizedNow.toISOString();
  const unsignedRecord = {
    schemaVersion: productionAcceptanceSchemaVersion,
    kind: productionAcceptanceApprovalKind,
    releaseId: normalizedReleaseId,
    releaseDecision: "approved",
    finalizedAt,
    signatureAlgorithm: "HMAC-SHA256",
    preflight: {
      file: preflight.file,
      sha256: preflight.sha256,
      bytes: preflight.bytes,
      collectedAt: preflight.value.collectedAt,
      targetOrigin: preflight.targetOrigin
    },
    manualApproval: {
      file: manualFile,
      sha256: manual.sha256,
      bytes: manual.bytes,
      approverId: manual.value.approverId,
      changeId: manual.value.changeId,
      approvedAt: manual.value.approvedAt
    },
    authorization,
    manualChecks
  };
  const record = { ...unsignedRecord, approvalHmacSha256: approvalSignature(unsignedRecord, key) };
  verifyProductionAcceptanceApproval(record, key);
  const latestBeforeWrite = await selectLatestPassedPreflight(rootPath, rootRealPath, normalizedReleaseId, nowMs);
  if (latestBeforeWrite.file !== preflight.file
    || latestBeforeWrite.sha256 !== preflight.sha256
    || latestBeforeWrite.bytes !== preflight.bytes) {
    throw finalizationError("最终签名前自动预检已发生变化。", "preflight-changed-during-finalization");
  }
  const timestamp = finalizedAt.replace(/[^0-9TZ]/g, "");
  const outputPath = path.join(rootPath, `${normalizedReleaseId}-approval-${timestamp}-${crypto.randomUUID()}.json`);
  // 中文注解：批准记录只追加、不覆盖；HMAC 绑定预检、人工清单与每个附件摘要，正文和签名密钥均不进入记录。
  await writeFile(outputPath, `${JSON.stringify(record, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
  return { record, outputPath };
}

async function selectLatestApprovalRecord(rootPath, rootRealPath, releaseId) {
  const filePattern = approvalFilePattern(releaseId);
  const candidates = [];
  let entryCount = 0;
  for await (const entry of await opendir(rootPath)) {
    entryCount += 1;
    if (entryCount > maximumDirectoryEntries) throw finalizationError("验收目录文件数量超过安全上限。", "acceptance-directory-too-large");
    if (!filePattern.test(entry.name)) continue;
    if (!entry.isFile()) throw finalizationError("最终验收记录必须是常规文件。", "invalid-approval-record");
    candidates.push(entry.name);
  }
  if (!candidates.length) throw finalizationError("当前版本没有最终验收记录。", "approval-record-not-found");
  // 中文注解：文件名时间戳使用固定 UTC 格式；只验证最新记录，防止新记录损坏后回退到旧批准。
  candidates.sort((left, right) => right.localeCompare(left, "en"));
  const file = candidates[0];
  return { file, ...(await readBoundedJson(rootRealPath, path.join(rootPath, file), maximumApprovalRecordBytes, "最终验收记录")) };
}

function assertApprovalRecordContract(record, releaseId) {
  if (!record || record.schemaVersion !== productionAcceptanceSchemaVersion
    || record.kind !== productionAcceptanceApprovalKind
    || record.releaseId !== releaseId
    || record.releaseDecision !== "approved"
    || record.signatureAlgorithm !== "HMAC-SHA256") {
    throw finalizationError("最终验收记录类型、版本或决定无效。", "invalid-approval-record");
  }
  assertExactCheckIds(record.manualChecks, productionAcceptanceManualChecks.map((check) => check.id), "passed", "最终人工验收项");
  if (!record.preflight || !preflightFilePattern(releaseId).test(String(record.preflight.file || ""))) {
    throw finalizationError("最终验收记录中的自动预检引用无效。", "invalid-approval-record");
  }
  if (!record.manualApproval || record.manualApproval.file !== `${releaseId}-manual.json`) {
    throw finalizationError("最终验收记录中的人工清单引用无效。", "invalid-approval-record");
  }
  assertExactKeys(
    record.authorization,
    ["schemaVersion", "kind", "releaseId", "approverId", "changeId", "authorizedAt", "expiresAt", "preflightSha256", "manualSha256", "sha256"],
    "最终验收授权记录",
    "invalid-approval-record"
  );
  const { sha256, ...authorizationGrant } = record.authorization;
  const authorizationDigest = crypto.createHash("sha256").update(canonicalJson(authorizationGrant), "utf8").digest("hex");
  if (record.authorization.schemaVersion !== productionAcceptanceSchemaVersion
    || record.authorization.kind !== productionAcceptanceAuthorizationKind
    || record.authorization.releaseId !== releaseId
    || record.authorization.approverId !== record.manualApproval.approverId
    || record.authorization.changeId !== record.manualApproval.changeId
    || record.authorization.preflightSha256 !== record.preflight.sha256
    || record.authorization.manualSha256 !== record.manualApproval.sha256
    || sha256 !== authorizationDigest) {
    throw finalizationError("最终验收授权记录未绑定当前发布、审批人和变更单。", "invalid-approval-record");
  }
}

async function verifyApprovalSourceFiles(rootPath, rootRealPath, releaseId, record) {
  const preflight = await readBoundedJson(
    rootRealPath,
    path.join(rootPath, record.preflight.file),
    maximumPreflightBytes,
    "已批准的自动预检文件"
  );
  if (preflight.sha256 !== record.preflight.sha256 || preflight.bytes !== record.preflight.bytes) {
    throw finalizationError("已批准的自动预检文件发生变化。", "approved-evidence-changed");
  }
  const manual = await readBoundedJson(
    rootRealPath,
    path.join(rootPath, record.manualApproval.file),
    maximumManualManifestBytes,
    "已批准的人工验收清单"
  );
  if (manual.sha256 !== record.manualApproval.sha256 || manual.bytes !== record.manualApproval.bytes) {
    throw finalizationError("已批准的人工验收清单发生变化。", "approved-evidence-changed");
  }

  const uniqueFiles = new Map();
  let totalBytes = 0;
  for (const check of record.manualChecks) {
    if (!Array.isArray(check.evidenceFiles)
      || check.evidenceFiles.length < 1
      || check.evidenceFiles.length > maximumEvidenceFilesPerCheck) {
      throw finalizationError("最终验收记录中的附件数量无效。", "invalid-approval-record");
    }
    for (const expected of check.evidenceFiles) {
      const relativePath = normalizeEvidenceRelativePath(expected?.file, releaseId);
      if (!uniqueFiles.has(relativePath)) {
        if (uniqueFiles.size >= maximumEvidenceFiles) throw finalizationError("最终验收记录中的附件总数超限。", "invalid-approval-record");
        const actual = await hashEvidenceFile(rootPath, rootRealPath, relativePath);
        totalBytes += actual.bytes;
        if (totalBytes > maximumTotalEvidenceBytes) throw finalizationError("最终验收附件总体积超过上限。", "evidence-bundle-too-large");
        uniqueFiles.set(relativePath, actual);
      }
      const actual = uniqueFiles.get(relativePath);
      if (actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256) {
        throw finalizationError("已批准的人工验收附件发生变化。", "approved-evidence-changed");
      }
    }
  }
}

export async function verifyLatestProductionAcceptanceApproval({ acceptanceDirectory, releaseId, approvalKey, now = new Date() } = {}) {
  const normalizedReleaseId = normalizeAcceptanceReleaseId(releaseId);
  const key = normalizeApprovalKey(approvalKey);
  const { rootPath, rootRealPath } = await validateAcceptanceRoot(acceptanceDirectory);
  const approval = await selectLatestApprovalRecord(rootPath, rootRealPath, normalizedReleaseId);
  assertApprovalRecordContract(approval.value, normalizedReleaseId);
  verifyProductionAcceptanceApproval(approval.value, key);
  const normalizedNow = now instanceof Date ? now : new Date(now);
  const nowMs = normalizedNow.getTime();
  if (!Number.isFinite(nowMs)) throw finalizationError("最终验收复核时间无效。", "invalid-acceptance-time");
  const latestPreflight = await selectLatestPassedPreflight(rootPath, rootRealPath, normalizedReleaseId, nowMs);
  if (latestPreflight.file !== approval.value.preflight.file
    || latestPreflight.sha256 !== approval.value.preflight.sha256
    || latestPreflight.bytes !== approval.value.preflight.bytes) {
    throw finalizationError("最终验收记录未绑定当前最新自动预检。", "approval-preflight-superseded");
  }
  await verifyApprovalSourceFiles(rootPath, rootRealPath, normalizedReleaseId, approval.value);
  return { record: approval.value, approvalFile: approval.file };
}

async function readCredentialFile(fileName, maximumBytes, missingDetailCode) {
  const credentialsDirectory = String(process.env.CREDENTIALS_DIRECTORY || "").trim();
  if (!credentialsDirectory) throw finalizationError("缺少 systemd 生产验收凭据目录。", missingDetailCode);
  const credentialPath = path.join(credentialsDirectory, fileName);
  const metadata = await lstat(credentialPath);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size <= 0 || metadata.size > maximumBytes) {
    throw finalizationError("systemd 生产验收凭据无效。", missingDetailCode);
  }
  return readFile(credentialPath);
}

async function readApprovalCredential() {
  const credential = await readCredentialFile("acceptance_approval_key", 4096, "approval-credential-missing");
  if (credential.byteLength < 32) throw finalizationError("systemd 生产验收签名凭据无效。", "invalid-approval-key");
  return credential;
}

async function readAuthorizationCredential() {
  const credential = await readCredentialFile(
    "acceptance_authorization",
    maximumAuthorizationCredentialBytes,
    "authorization-credential-missing"
  );
  try {
    return JSON.parse(credential.toString("utf8"));
  } catch {
    throw finalizationError("systemd 生产验收授权凭据不是有效 JSON。", "invalid-authorization-grant");
  }
}

function parseCliArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--verify-latest") {
      values.verifyLatest = true;
      continue;
    }
    const match = argv[index].match(/^--(release-id|acceptance-dir)(?:=(.*))?$/);
    if (!match) throw finalizationError("包含不支持的最终验收参数。", "invalid-cli-arguments");
    const value = match[2] ?? argv[++index];
    if (!value || value.startsWith("--")) throw finalizationError("最终验收参数缺少值。", "invalid-cli-arguments");
    values[match[1]] = value;
  }
  return {
    releaseId: values["release-id"],
    acceptanceDirectory: values["acceptance-dir"],
    verifyLatest: values.verifyLatest === true
  };
}

async function runCli() {
  try {
    const options = parseCliArguments(process.argv.slice(2));
    if (!options.releaseId || !options.acceptanceDirectory) throw finalizationError("必须提供发布号和验收目录。", "invalid-cli-arguments");
    const approvalKey = await readApprovalCredential();
    if (options.verifyLatest) {
      const result = await verifyLatestProductionAcceptanceApproval({ ...options, approvalKey });
      console.log("生产最终验收记录与附件完整性验证通过。", {
        releaseId: result.record.releaseId,
        releaseDecision: result.record.releaseDecision,
        approvalFile: result.approvalFile
      });
    } else {
      const authorizationGrant = await readAuthorizationCredential();
      const result = await finalizeProductionAcceptance({ ...options, approvalKey, authorizationGrant });
      console.log("生产最终验收记录已签名保存。", {
        releaseId: result.record.releaseId,
        releaseDecision: result.record.releaseDecision,
        outputPath: result.outputPath
      });
    }
  } catch (error) {
    // 中文注解：journal 只记录稳定错误码，不回显附件路径、清单正文、审批密钥或底层异常。
    console.error("生产最终验收失败。", { detailCode: error?.detailCode || "acceptance-finalization-failed" });
    process.exitCode = 1;
  }
}

const executedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (executedPath === import.meta.url) await runCli();
