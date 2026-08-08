import { mkdir, writeFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const maximumJsonBytes = 64 * 1024;
const defaultTimeoutMs = 10000;
const requestIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const loopbackHosts = new Set(["127.0.0.1", "localhost", "[::1]"]);

const manualChecks = Object.freeze([
  { id: "moling-sso", title: "墨灵 SSO 与跨用户隔离", evidenceRequired: "平台入口截图、专用测试用户、会话 Cookie 属性和跨用户 401/403 记录" },
  { id: "points-ledger", title: "积分预占、结算与幂等", evidenceRequired: "调用前后积分、平台账本、幂等键和只结算一次的记录" },
  { id: "points-failure", title: "余额不足与模型失败补偿", evidenceRequired: "402/503 请求 ID、释放结果及待对账任务记录" },
  { id: "word-visual", title: "Microsoft Word 导入导出视觉验收", evidenceRequired: "包含标题、表格、图片和自定义颜色的 Word 样例及逐页截图" },
  { id: "multi-device", title: "390px、平板和桌面端交互验收", evidenceRequired: "三种宽度截图、无横向溢出记录和按钮反馈清单" },
  { id: "audit-correlation", title: "请求日志与 AI 审计关联", evidenceRequired: "同一 X-Request-Id 的访问日志、脱敏 ai_request_logs 记录和无敏感正文证明" },
  { id: "rollback-drill", title: "版本回滚与在途请求演练", evidenceRequired: "前后 release id、systemd/Nginx 状态、ready 结果和回滚时间线" }
]);

function assertReleaseId(releaseId) {
  const normalized = String(releaseId || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(normalized)) {
    throw new Error("release id 必须为 1 至 80 位字母、数字、点、下划线或连字符。");
  }
  return normalized;
}

export function validateAcceptanceTarget(baseUrl, { allowInsecureLoopback = false } = {}) {
  let target;
  try {
    target = new URL(String(baseUrl || ""));
  } catch {
    throw new Error("生产验收地址必须是合法 URL。");
  }
  if (target.username || target.password) throw new Error("生产验收地址不能包含用户名、密码或其他凭据。");
  if (target.search || target.hash) throw new Error("生产验收地址不能包含查询串或片段。");
  if (target.pathname !== "/") throw new Error("生产验收地址必须使用站点根路径。");
  const insecureLoopbackAllowed = allowInsecureLoopback && target.protocol === "http:" && loopbackHosts.has(target.hostname);
  if (target.protocol !== "https:" && !insecureLoopbackAllowed) {
    throw new Error("生产验收地址必须使用 HTTPS；HTTP 仅允许显式启用的本机自测。");
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") throw new Error("生产验收地址只允许 HTTP 或 HTTPS 协议。");
  return new URL(target.origin);
}

function normalizeTimeout(timeoutMs) {
  const value = Number(timeoutMs ?? defaultTimeoutMs);
  if (!Number.isInteger(value) || value < 100 || value > 30000) {
    throw new Error("单请求超时必须为 100 至 30000 毫秒的整数。");
  }
  return value;
}

async function readJsonWithLimit(response) {
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maximumJsonBytes) {
      await reader.cancel();
      throw new Error("response-too-large");
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(merged));
  } catch {
    throw new Error("invalid-json");
  }
}

async function requestProbe(target, path, { method = "GET", body, readJson = true, timeoutMs } = {}) {
  try {
    const response = await fetch(new URL(path, target), {
      method,
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        Accept: readJson ? "application/json" : "text/html,application/xhtml+xml",
        "X-Request-Id": "client-value-must-be-replaced",
        ...(body ? { "Content-Type": "application/json", Origin: target.origin } : {})
      },
      body
    });
    const headers = response.headers;
    const result = {
      transportStatus: "received",
      status: response.status,
      contentType: headers.get("content-type") || "",
      requestId: headers.get("x-request-id") || "",
      headers,
      json: null
    };
    if (readJson) result.json = await readJsonWithLimit(response);
    else await response.body?.cancel();
    return result;
  } catch (error) {
    // 中文注解：证据中只保存稳定错误码，不保存底层异常、响应正文或可能带环境信息的 URL。
    const timeout = error?.name === "TimeoutError" || error?.name === "AbortError";
    return { transportStatus: timeout ? "timeout" : "request-failed", status: 0, contentType: "", requestId: "", headers: new Headers(), json: null };
  }
}

function booleanValue(value) {
  return value === true;
}

function addCheck(checks, id, passed, detailCode) {
  checks.push({ id, status: passed ? "passed" : "failed", detailCode: passed ? "ok" : detailCode });
}

function safeSecurityHeaders(headers) {
  return {
    strictTransportSecurity: headers.get("strict-transport-security") || "",
    contentTypeOptions: headers.get("x-content-type-options") || "",
    frameOptions: headers.get("x-frame-options") || "",
    referrerPolicy: headers.get("referrer-policy") || "",
    permissionsPolicy: headers.get("permissions-policy") || "",
    contentSecurityPolicy: headers.get("content-security-policy") || ""
  };
}

function hasRequiredSecurityHeaders(headers) {
  const hsts = headers.strictTransportSecurity.match(/max-age=(\d+)/i);
  return Number(hsts?.[1] || 0) >= 31536000
    && headers.contentTypeOptions.toLowerCase() === "nosniff"
    && headers.frameOptions.toUpperCase() === "DENY"
    && headers.referrerPolicy.toLowerCase() === "no-referrer"
    && /camera=\(\)/i.test(headers.permissionsPolicy)
    && /microphone=\(\)/i.test(headers.permissionsPolicy)
    && /default-src/i.test(headers.contentSecurityPolicy)
    && /frame-ancestors\s+'none'/i.test(headers.contentSecurityPolicy);
}

function safeHealthObservation(probe) {
  const value = probe.json && typeof probe.json === "object" ? probe.json : {};
  const releaseId = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(String(value.releaseId || "")) ? String(value.releaseId) : "";
  return {
    status: probe.status,
    ok: booleanValue(value.ok),
    environment: typeof value.environment === "string" ? value.environment.slice(0, 32) : "",
    releaseId,
    sessionRequired: booleanValue(value.sessionRequired),
    gatewayConfigured: booleanValue(value.gatewayConfigured),
    databaseConfigured: booleanValue(value.databaseConfigured),
    storageConfigured: booleanValue(value.storageConfigured)
  };
}

function safeReadyObservation(probe) {
  const value = probe.json && typeof probe.json === "object" ? probe.json : {};
  const checks = value.checks && typeof value.checks === "object" ? value.checks : {};
  return {
    status: probe.status,
    ready: booleanValue(value.ready),
    checks: {
      configuration: booleanValue(checks.configuration),
      database: booleanValue(checks.database),
      storage: booleanValue(checks.storage),
      gateway: booleanValue(checks.gateway)
    }
  };
}

export async function collectProductionAcceptanceEvidence({ baseUrl, releaseId, allowInsecureLoopback = false, timeoutMs = defaultTimeoutMs } = {}) {
  const target = validateAcceptanceTarget(baseUrl, { allowInsecureLoopback });
  const normalizedReleaseId = assertReleaseId(releaseId);
  const normalizedTimeout = normalizeTimeout(timeoutMs);
  const checks = [];

  const rootProbe = await requestProbe(target, "/", { readJson: false, timeoutMs: normalizedTimeout });
  const rootSecurityHeaders = safeSecurityHeaders(rootProbe.headers);
  const rootContentTypeIsHtml = /text\/html/i.test(rootProbe.contentType);
  const rootCacheControl = rootProbe.headers.get("cache-control") || "";
  addCheck(checks, "site-entry", rootProbe.transportStatus === "received" && rootProbe.status === 200 && rootContentTypeIsHtml, rootProbe.transportStatus === "received" ? "unexpected-status-or-content-type" : rootProbe.transportStatus);
  addCheck(checks, "site-cache-policy", /(?:^|,)\s*no-store(?:\s*(?:,|$))/i.test(rootCacheControl), "entry-document-can-be-stale");
  addCheck(checks, "security-headers", hasRequiredSecurityHeaders(rootSecurityHeaders), "missing-or-weak-security-header");

  const healthProbe = await requestProbe(target, "/api/health", { timeoutMs: normalizedTimeout });
  const health = safeHealthObservation(healthProbe);
  addCheck(checks, "health-http", healthProbe.transportStatus === "received" && health.status === 200 && health.ok, healthProbe.transportStatus === "received" ? "unhealthy" : healthProbe.transportStatus);
  addCheck(checks, "health-production", health.environment === "production" && health.sessionRequired, "not-production-or-session-optional");
  addCheck(checks, "release-binding", health.releaseId === normalizedReleaseId, "deployed-release-mismatch");
  addCheck(checks, "health-configuration", health.gatewayConfigured && health.databaseConfigured && health.storageConfigured, "dependency-not-configured");

  const readyProbe = await requestProbe(target, "/api/ready", { timeoutMs: normalizedTimeout });
  const ready = safeReadyObservation(readyProbe);
  const allReady = ready.ready && Object.values(ready.checks).every(Boolean);
  addCheck(checks, "ready-dependencies", readyProbe.transportStatus === "received" && ready.status === 200 && allReady, readyProbe.transportStatus === "received" ? "dependency-not-ready" : readyProbe.transportStatus);

  const missingProbe = await requestProbe(target, "/api/__production_acceptance_missing__", { timeoutMs: normalizedTimeout });
  addCheck(checks, "json-404", missingProbe.transportStatus === "received" && missingProbe.status === 404 && /application\/json/i.test(missingProbe.contentType), missingProbe.transportStatus === "received" ? "invalid-404-contract" : missingProbe.transportStatus);

  // 中文注解：仅在服务自报生产且强制会话后发送空对象认证探针；即使认证层失效，空请求也会在动作校验处停止，不触发模型或计费。
  const authenticationProbeAllowed = health.environment === "production" && health.sessionRequired;
  const unauthorizedProbe = authenticationProbeAllowed
    ? await requestProbe(target, "/api/ai/edit", { method: "POST", body: "{}", timeoutMs: normalizedTimeout })
    : null;
  addCheck(
    checks,
    "unauthenticated-ai",
    unauthorizedProbe?.transportStatus === "received" && unauthorizedProbe.status === 401,
    authenticationProbeAllowed ? (unauthorizedProbe?.transportStatus === "received" ? "ai-route-not-protected" : unauthorizedProbe?.transportStatus || "request-failed") : "production-session-prerequisite-failed"
  );

  const apiProbes = [healthProbe, readyProbe, missingProbe, unauthorizedProbe].filter(Boolean);
  const requestIds = apiProbes.map((probe) => probe.requestId).filter((value) => requestIdPattern.test(value));
  const requestIdsValid = apiProbes.length >= 3 && requestIds.length === apiProbes.length && new Set(requestIds).size === requestIds.length;
  addCheck(checks, "server-request-ids", requestIdsValid, "missing-invalid-or-duplicated-request-id");

  const automaticStatus = checks.every((check) => check.status === "passed") ? "passed" : "failed";
  return {
    schemaVersion: 1,
    kind: "molinword-production-acceptance-preflight",
    releaseId: normalizedReleaseId,
    targetOrigin: target.origin,
    collectedAt: new Date().toISOString(),
    automaticStatus,
    releaseDecision: automaticStatus === "passed" ? "manual-approval-required" : "blocked",
    checks,
    observations: {
      site: { status: rootProbe.status, contentTypeIsHtml: rootContentTypeIsHtml, cacheControl: rootCacheControl, securityHeaders: rootSecurityHeaders },
      health,
      ready,
      json404: { status: missingProbe.status, contentTypeIsJson: /application\/json/i.test(missingProbe.contentType) },
      unauthenticatedAi: { status: unauthorizedProbe?.status || 0, skipped: !authenticationProbeAllowed }
    },
    requestIds,
    manualChecks: manualChecks.map((check) => ({ ...check, status: "pending" }))
  };
}

export async function writeAcceptanceEvidence(outputPath, evidence) {
  const normalizedOutput = resolve(String(outputPath || ""));
  if (extname(normalizedOutput).toLowerCase() !== ".json") throw new Error("证据输出路径必须使用 .json 扩展名。");
  await mkdir(dirname(normalizedOutput), { recursive: true, mode: 0o700 });
  try {
    // 中文注解：验收证据采用独占创建，防止重跑覆盖原始时间线；需要重试时应使用新的 release id 或文件名。
    await writeFile(normalizedOutput, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
  } catch (error) {
    if (error?.code === "EEXIST") throw new Error("证据文件已存在，拒绝覆盖。");
    throw error;
  }
  return normalizedOutput;
}

function parseCliArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--allow-http-loopback") {
      values.allowInsecureLoopback = true;
      continue;
    }
    const match = argument.match(/^--(base-url|release-id|output|timeout-ms)(?:=(.*))?$/);
    // 中文注解：未知参数可能误带 token，错误信息不得回显原始命令行内容。
    if (!match) throw new Error("包含不支持的命令参数。");
    const value = match[2] ?? argv[++index];
    if (!value || value.startsWith("--")) throw new Error(`参数 --${match[1]} 缺少值。`);
    values[match[1]] = value;
  }
  return {
    baseUrl: values["base-url"],
    releaseId: values["release-id"],
    output: values.output,
    timeoutMs: values["timeout-ms"],
    allowInsecureLoopback: values.allowInsecureLoopback === true
  };
}

async function runCli() {
  try {
    const options = parseCliArguments(process.argv.slice(2));
    if (!options.baseUrl || !options.releaseId || !options.output) {
      throw new Error("必须提供 --base-url、--release-id 和 --output。");
    }
    const evidence = await collectProductionAcceptanceEvidence(options);
    const outputPath = await writeAcceptanceEvidence(options.output, evidence);
    console.log("生产验收自动证据已保存。", {
      releaseId: evidence.releaseId,
      targetOrigin: evidence.targetOrigin,
      automaticStatus: evidence.automaticStatus,
      releaseDecision: evidence.releaseDecision,
      outputPath
    });
    if (evidence.automaticStatus !== "passed") process.exitCode = 1;
  } catch (error) {
    console.error(`生产验收证据采集失败：${error.message}`);
    process.exitCode = 1;
  }
}

const executedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (executedPath === import.meta.url) await runCli();
