import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";
import { dirname, extname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const maximumJsonBytes = 64 * 1024;
const defaultTimeoutMs = 10000;
const requestIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const loopbackHosts = new Set(["127.0.0.1", "localhost", "[::1]"]);
const safeInitializationFailureCodes = new Set(["dns-timeout", "dns-resolution-failed", "unsafe-dns-resolution"]);
const forbiddenAddressRanges = new BlockList();

for (const [network, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4]
]) forbiddenAddressRanges.addSubnet(network, prefix, "ipv4");

for (const [network, prefix] of [
  ["::", 128], ["::1", 128], ["64:ff9b::", 96], ["64:ff9b:1::", 48],
  ["100::", 64], ["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["3fff::", 20],
  ["5f00::", 16], ["fc00::", 7], ["fe80::", 10], ["fec0::", 10], ["ff00::", 8]
]) forbiddenAddressRanges.addSubnet(network, prefix, "ipv6");

const manualChecks = Object.freeze([
  { id: "moling-sso", title: "墨灵 SSO 与跨用户隔离", evidenceRequired: "平台入口截图、专用测试用户、会话 Cookie 属性和跨用户 401/403 记录" },
  { id: "http-contracts", title: "错误输入与限流契约", evidenceRequired: "无效 JSON 的 400、真实限流 429、Retry-After/RateLimit 响应头和中文提示截图" },
  { id: "agent-workflow", title: "四阶段文档智能体真实链路", evidenceRequired: "需求分析、MySQL active 白名单模板匹配、结构设计、质量审校四阶段记录及最终文档，不得使用 Mock" },
  { id: "points-ledger", title: "积分预占、结算与幂等", evidenceRequired: "调用前后积分、平台账本、幂等键和只结算一次的记录" },
  { id: "insufficient-points", title: "余额不足拒绝", evidenceRequired: "真实低余额账号、402 请求 ID、调用前后余额及模型未被调用的证据" },
  { id: "failure-reconciliation", title: "模型失败补偿与对账", evidenceRequired: "503 请求 ID、积分释放结果、原幂等键及待对账或人工复核记录" },
  { id: "word-visual", title: "Microsoft Word 导入导出视觉验收", evidenceRequired: "包含标题、表格、图片和自定义颜色的 Word 样例及逐页截图" },
  { id: "multi-device", title: "390px、平板和桌面端交互验收", evidenceRequired: "三种宽度截图、无横向溢出记录和按钮反馈清单" },
  { id: "audit-correlation", title: "请求日志与 AI 审计关联", evidenceRequired: "同一 X-Request-Id 的访问日志、脱敏 ai_request_logs 记录和无敏感正文证明" },
  { id: "rollback-drill", title: "版本回滚与在途请求演练", evidenceRequired: "前后 release id、systemd/Nginx 状态、ready 结果和回滚时间线" }
]);

function acceptanceFailure(message, detailCode) {
  return Object.assign(new Error(message), { detailCode });
}

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
  if (!insecureLoopbackAllowed) {
    const hostname = target.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
    if (isIP(hostname) || hostname === "localhost" || hostname.endsWith(".localhost")) {
      throw new Error("生产验收地址必须使用已批准的公网 DNS 域名，不能使用 IP、回环或 localhost 地址。");
    }
    if (target.port && target.port !== "443") throw new Error("生产验收地址必须使用标准 HTTPS 端口 443。");
  }
  return new URL(target.origin);
}

function isPublicAddress(address, family) {
  const detectedFamily = Number(family) || isIP(address);
  if (detectedFamily !== 4 && detectedFamily !== 6) return false;
  if (detectedFamily === 6) {
    const firstHextet = Number.parseInt(String(address).split(":", 1)[0] || "0", 16);
    if (firstHextet < 0x2000 || firstHextet > 0x3fff) return false;
  }
  return !forbiddenAddressRanges.check(address, detectedFamily === 4 ? "ipv4" : "ipv6");
}

export async function resolveAcceptanceAddresses(target, { lookup = dnsLookup, allowInsecureLoopback = false, timeoutMs = defaultTimeoutMs } = {}) {
  const insecureLoopbackAllowed = allowInsecureLoopback && target.protocol === "http:" && loopbackHosts.has(target.hostname);
  if (insecureLoopbackAllowed) {
    return target.hostname === "[::1]"
      ? [{ address: "::1", family: 6 }]
      : [{ address: "127.0.0.1", family: 4 }];
  }

  let resolved;
  let deadline;
  try {
    resolved = await Promise.race([
      lookup(target.hostname.replace(/\.$/, ""), { all: true, verbatim: true }),
      new Promise((_, reject) => {
        deadline = setTimeout(() => reject(Object.assign(new Error("dns-timeout"), { code: "ETIMEDOUT" })), timeoutMs);
      })
    ]);
  } catch (error) {
    if (error?.code === "ETIMEDOUT") throw acceptanceFailure("生产验收域名解析超时。", "dns-timeout");
    throw acceptanceFailure("生产验收域名解析失败。", "dns-resolution-failed");
  } finally {
    clearTimeout(deadline);
  }
  const addresses = (Array.isArray(resolved) ? resolved : [resolved])
    .map((entry) => ({ address: String(entry?.address || ""), family: Number(entry?.family) || isIP(entry?.address || "") }))
    .filter((entry) => entry.address && (entry.family === 4 || entry.family === 6));
  // 中文注解：任一解析结果落入私网、回环、链路本地或保留网段都整体拒绝，避免攻击者混入公网地址后再 DNS 重绑定。
  if (!addresses.length || addresses.some((entry) => !isPublicAddress(entry.address, entry.family))) {
    throw acceptanceFailure("生产验收域名必须仅解析到公网地址，不能指向私网、回环、链路本地或保留地址。", "unsafe-dns-resolution");
  }
  return addresses;
}

function assertApprovedProductionTarget(target, approvedBaseUrl, allowInsecureLoopback) {
  const insecureLoopbackAllowed = allowInsecureLoopback && target.protocol === "http:" && loopbackHosts.has(target.hostname);
  if (insecureLoopbackAllowed) return;
  if (!approvedBaseUrl) throw new Error("生产验收必须从受保护环境读取 APP_BASE_URL 作为批准站点。");
  const approvedTarget = validateAcceptanceTarget(approvedBaseUrl);
  if (target.origin !== approvedTarget.origin) throw new Error("生产验收地址必须与 APP_BASE_URL 完全一致。");
}

function normalizeTimeout(timeoutMs) {
  const value = Number(timeoutMs ?? defaultTimeoutMs);
  if (!Number.isInteger(value) || value < 100 || value > 30000) {
    throw new Error("单请求超时必须为 100 至 30000 毫秒的整数。");
  }
  return value;
}

async function readJsonWithLimit(response) {
  const declaredLength = Number(response.headers["content-length"] || 0);
  if (Number.isFinite(declaredLength) && declaredLength > maximumJsonBytes) {
    response.destroy();
    throw new Error("response-too-large");
  }
  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of response) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += value.length;
    if (totalBytes > maximumJsonBytes) {
      response.destroy();
      throw new Error("response-too-large");
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks, totalBytes).toString("utf8"));
  } catch {
    throw new Error("invalid-json");
  }
}

function createPinnedLookup(addresses) {
  return (_hostname, options, callback) => {
    const normalizedOptions = typeof options === "number" ? { family: options } : (options || {});
    const candidates = normalizedOptions.family
      ? addresses.filter((entry) => entry.family === normalizedOptions.family)
      : addresses;
    if (!candidates.length) {
      callback(Object.assign(new Error("address-family-unavailable"), { code: "ENOTFOUND" }));
      return;
    }
    if (normalizedOptions.all) callback(null, candidates.map((entry) => ({ ...entry })));
    else callback(null, candidates[0].address, candidates[0].family);
  };
}

function responseHeaders(rawHeaders) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(rawHeaders)) {
    if (Array.isArray(value)) value.forEach((item) => headers.append(name, item));
    else if (value !== undefined) headers.set(name, String(value));
  }
  return headers;
}

async function requestProbe(target, path, addresses, { method = "GET", body, readJson = true, timeoutMs } = {}) {
  try {
    const requestUrl = new URL(path, target);
    return await new Promise((resolveProbe, rejectProbe) => {
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        callback(value);
      };
      const transport = requestUrl.protocol === "https:" ? httpsRequest : httpRequest;
      const request = transport(requestUrl, {
        method,
        agent: false,
        lookup: createPinnedLookup(addresses),
        headers: {
          Accept: readJson ? "application/json" : "text/html,application/xhtml+xml",
          "X-Request-Id": "client-value-must-be-replaced",
          ...(body ? { "Content-Type": "application/json", Origin: target.origin } : {})
        }
      }, async (response) => {
        const headers = responseHeaders(response.headers);
        const result = {
          transportStatus: "received",
          status: response.statusCode || 0,
          contentType: headers.get("content-type") || "",
          requestId: headers.get("x-request-id") || "",
          headers,
          json: null
        };
        try {
          if (readJson) result.json = await readJsonWithLimit(response);
          else response.destroy();
          finish(resolveProbe, result);
        } catch (error) {
          finish(rejectProbe, error);
        }
      });
      const deadline = setTimeout(() => {
        request.destroy(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }));
      }, timeoutMs);
      request.once("error", (error) => finish(rejectProbe, error));
      if (body) request.write(body);
      request.end();
    });
  } catch (error) {
    // 中文注解：证据中只保存稳定错误码，不保存底层异常、响应正文或可能带环境信息的 URL。
    const timeout = error?.code === "ETIMEDOUT";
    return { transportStatus: timeout ? "timeout" : "request-failed", status: 0, contentType: "", requestId: "", headers: new Headers(), json: null };
  }
}

function booleanValue(value) {
  return value === true;
}

function addCheck(checks, id, passed, detailCode) {
  checks.push({ id, status: passed ? "passed" : "failed", detailCode: passed ? "ok" : detailCode });
}

export function createBlockedAcceptanceEvidence({ releaseId, error } = {}) {
  const normalizedReleaseId = assertReleaseId(releaseId);
  const detailCode = safeInitializationFailureCodes.has(error?.detailCode)
    ? error.detailCode
    : "collector-initialization-failed";
  return {
    schemaVersion: 1,
    kind: "molinword-production-acceptance-preflight",
    releaseId: normalizedReleaseId,
    // 中文注解：初始化失败时不回显尚未通过安全校验的 URL，只保存稳定错误码和待人工验收框架。
    targetOrigin: "",
    collectedAt: new Date().toISOString(),
    automaticStatus: "failed",
    releaseDecision: "blocked",
    checks: [{ id: "collector-initialization", status: "failed", detailCode }],
    observations: { initialization: { detailCode } },
    requestIds: [],
    manualChecks: manualChecks.map((check) => ({ ...check, status: "pending" }))
  };
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

export async function collectProductionAcceptanceEvidence({
  baseUrl,
  releaseId,
  allowInsecureLoopback = false,
  timeoutMs = defaultTimeoutMs,
  approvedBaseUrl = process.env.APP_BASE_URL,
  lookup = dnsLookup
} = {}) {
  const target = validateAcceptanceTarget(baseUrl, { allowInsecureLoopback });
  const normalizedReleaseId = assertReleaseId(releaseId);
  const normalizedTimeout = normalizeTimeout(timeoutMs);
  assertApprovedProductionTarget(target, approvedBaseUrl, allowInsecureLoopback);
  const addresses = await resolveAcceptanceAddresses(target, { lookup, allowInsecureLoopback, timeoutMs: normalizedTimeout });
  const checks = [];

  const rootProbe = await requestProbe(target, "/", addresses, { readJson: false, timeoutMs: normalizedTimeout });
  const rootSecurityHeaders = safeSecurityHeaders(rootProbe.headers);
  const rootContentTypeIsHtml = /text\/html/i.test(rootProbe.contentType);
  const rootCacheControl = rootProbe.headers.get("cache-control") || "";
  addCheck(checks, "site-entry", rootProbe.transportStatus === "received" && rootProbe.status === 200 && rootContentTypeIsHtml, rootProbe.transportStatus === "received" ? "unexpected-status-or-content-type" : rootProbe.transportStatus);
  addCheck(checks, "site-cache-policy", /(?:^|,)\s*no-store(?:\s*(?:,|$))/i.test(rootCacheControl), "entry-document-can-be-stale");
  addCheck(checks, "security-headers", hasRequiredSecurityHeaders(rootSecurityHeaders), "missing-or-weak-security-header");

  const healthProbe = await requestProbe(target, "/api/health", addresses, { timeoutMs: normalizedTimeout });
  const health = safeHealthObservation(healthProbe);
  addCheck(checks, "health-http", healthProbe.transportStatus === "received" && health.status === 200 && health.ok, healthProbe.transportStatus === "received" ? "unhealthy" : healthProbe.transportStatus);
  addCheck(checks, "health-production", health.environment === "production" && health.sessionRequired, "not-production-or-session-optional");
  addCheck(checks, "release-binding", health.releaseId === normalizedReleaseId, "deployed-release-mismatch");
  addCheck(checks, "health-configuration", health.gatewayConfigured && health.databaseConfigured && health.storageConfigured, "dependency-not-configured");

  const readyProbe = await requestProbe(target, "/api/ready", addresses, { timeoutMs: normalizedTimeout });
  const ready = safeReadyObservation(readyProbe);
  const allReady = ready.ready && Object.values(ready.checks).every(Boolean);
  addCheck(checks, "ready-dependencies", readyProbe.transportStatus === "received" && ready.status === 200 && allReady, readyProbe.transportStatus === "received" ? "dependency-not-ready" : readyProbe.transportStatus);

  const missingProbe = await requestProbe(target, "/api/__production_acceptance_missing__", addresses, { timeoutMs: normalizedTimeout });
  addCheck(checks, "json-404", missingProbe.transportStatus === "received" && missingProbe.status === 404 && /application\/json/i.test(missingProbe.contentType), missingProbe.transportStatus === "received" ? "invalid-404-contract" : missingProbe.transportStatus);

  // 中文注解：专用 GET 端点只验证与 AI 路由相同的会话边界，服务端不会连接模型、预占积分或处理客户正文。
  const authenticationProbeAllowed = health.environment === "production" && health.sessionRequired;
  const unauthorizedProbe = authenticationProbeAllowed
    ? await requestProbe(target, "/api/ai/auth-check", addresses, { timeoutMs: normalizedTimeout })
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

export async function writeAcceptanceEvidenceToDirectory(outputDirectory, evidence) {
  const timestamp = String(evidence?.collectedAt || new Date().toISOString()).replace(/[^0-9TZ]/g, "");
  const fileName = `${assertReleaseId(evidence?.releaseId)}-${timestamp}-${randomUUID()}.json`;
  // 中文注解：生产重试使用时间与随机值生成新文件，既不覆盖失败证据，也不阻断同一发布号再次采集。
  return writeAcceptanceEvidence(resolve(String(outputDirectory || ""), fileName), evidence);
}

function parseCliArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--allow-http-loopback") {
      values.allowInsecureLoopback = true;
      continue;
    }
    const match = argument.match(/^--(base-url|release-id|output|output-dir|timeout-ms)(?:=(.*))?$/);
    // 中文注解：未知参数可能误带 token，错误信息不得回显原始命令行内容。
    if (!match) throw new Error("包含不支持的命令参数。");
    const value = match[2] ?? argv[++index];
    if (!value || value.startsWith("--")) throw new Error(`参数 --${match[1]} 缺少值。`);
    values[match[1]] = value;
  }
  return {
    // 中文注解：生产任务默认只读取 systemd EnvironmentFile 中审核过的站点地址；--base-url 仅保留给显式本机自测。
    baseUrl: values["base-url"] || process.env.APP_BASE_URL,
    releaseId: values["release-id"],
    output: values.output,
    outputDirectory: values["output-dir"],
    timeoutMs: values["timeout-ms"],
    allowInsecureLoopback: values.allowInsecureLoopback === true
  };
}

async function runCli() {
  let options;
  try {
    options = parseCliArguments(process.argv.slice(2));
    if (!options.baseUrl || !options.releaseId || (!options.output && !options.outputDirectory) || (options.output && options.outputDirectory)) {
      throw new Error("必须通过 APP_BASE_URL（或本机自测的 --base-url）、--release-id，以及 --output/--output-dir 二选一提供验收参数。");
    }
    const evidence = await collectProductionAcceptanceEvidence(options);
    const outputPath = options.outputDirectory
      ? await writeAcceptanceEvidenceToDirectory(options.outputDirectory, evidence)
      : await writeAcceptanceEvidence(options.output, evidence);
    console.log("生产验收自动证据已保存。", {
      releaseId: evidence.releaseId,
      targetOrigin: evidence.targetOrigin,
      automaticStatus: evidence.automaticStatus,
      releaseDecision: evidence.releaseDecision,
      outputPath
    });
    if (evidence.automaticStatus !== "passed") process.exitCode = 1;
  } catch (error) {
    let blockedOutputPath = "";
    let detailCode = "collector-initialization-failed";
    try {
      if (options?.releaseId && (options.output || options.outputDirectory)) {
        const blockedEvidence = createBlockedAcceptanceEvidence({ releaseId: options.releaseId, error });
        detailCode = blockedEvidence.checks[0].detailCode;
        blockedOutputPath = options.outputDirectory
          ? await writeAcceptanceEvidenceToDirectory(options.outputDirectory, blockedEvidence)
          : await writeAcceptanceEvidence(options.output, blockedEvidence);
      }
    } catch {
      // 中文注解：证据路径或发布号本身无效时仍失败关闭，且不输出原始参数或底层文件系统异常。
    }
    console.error("生产验收证据采集失败。", { detailCode, blockedOutputPath });
    process.exitCode = 1;
  }
}

const executedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (executedPath === import.meta.url) await runCli();
