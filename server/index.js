import "dotenv/config";
import crypto from "node:crypto";
import express from "express";
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { parseDocument } from "htmlparser2";
import { Client as MinioClient } from "minio";
import mysql from "mysql2/promise";

const app = express();
const port = Number(process.env.LOCAL_API_PORT || process.env.APP_PORT || process.env.PORT || 3001);
const localUserId = process.env.LOCAL_USER_ID || "local-dev-user";
const sessionCookieName = "moling_word_session";

app.use(express.json({ limit: "1mb" }));

const molingApiBaseUrl = process.env.MOLING_API_BASE_URL || "http://8.130.9.163:8080";
const gatewayBaseUrl = process.env.MOLIN_GATEWAY_BASE_URL || `${molingApiBaseUrl}/v1`;
const gatewayApiKey = process.env.MOLIN_GATEWAY_API_KEY || "";
const llmApiUrl = process.env.LLM_API_URL || `${gatewayBaseUrl}/chat/completions`;
const llmApiKey = process.env.LLM_API_KEY || gatewayApiKey;
const gatewayModel = process.env.LLM_MODEL || process.env.MOLIN_GATEWAY_MODEL || "deepseek-chat";
const llmTimeoutMs = Number(process.env.LLM_TIMEOUT_MS || 30000);
const llmMaxRetries = Number(process.env.LLM_MAX_RETRIES || 1);
const storageBucket = process.env.STORAGE_BUCKET || "moling-word";
const internalApiToken = process.env.INTERNAL_API_TOKEN || "";
const molingAppId = process.env.MOLING_APP_ID || process.env.WORD_APP_ID || "";
const molingProductId = process.env.MOLING_PRODUCT_ID || process.env.WORD_PRODUCT_ID || "";
const sessionTtlSeconds = Number(process.env.SESSION_TTL_SECONDS || 86400);
const sessionCookieSecure = process.env.SESSION_COOKIE_SECURE === "true";
const localMolingMock = process.env.LOCAL_MOLING_MOCK === "true";
const dbPool = process.env.DATABASE_URL
  ? mysql.createPool(process.env.DATABASE_URL)
  : null;
const minioClient = createMinioClient();

const usageCosts = {
  word_outline_generate: 1,
  word_body_generate: 5,
  word_polish: 2,
  word_export_docx: 1
};

const publicErrorPatterns = [
  { pattern: /Missing Moling launch ticket|launch ticket/i, message: "请从墨灵平台重新进入应用。" },
  { pattern: /ticket app mismatch|ticket product mismatch/i, message: "墨灵入口信息与当前应用不匹配，请检查平台应用配置。" },
  { pattern: /insufficient|no usable plan|60005|quota|余额不足/i, message: "积分不足，请购买套餐后继续使用。" },
  { pattern: /DATABASE_URL|ECONNREFUSED|ER_ACCESS_DENIED|ER_BAD_DB_ERROR|mysql/i, message: "文档服务暂时不可用，请稍后重试。" },
  { pattern: /MinIO|S3|bucket|STORAGE_|getObject|putObject/i, message: "文件导出服务暂时不可用，请稍后重试。" },
  { pattern: /INTERNAL_API_TOKEN|Moling internal API|app-launch|user-entitlements/i, message: "墨灵平台连接暂时不可用，请稍后重试。" },
  { pattern: /LLM|AI request|chat\/completions|API key|401|403|429|timeout|aborted|fetch/i, message: "AI 服务暂时不可用，请稍后重试。" },
  { pattern: /Document not found|File not found/i, message: "资源不存在或已被删除。" }
];

function toPublicErrorMessage(error, fallback = "操作失败，请稍后重试。") {
  const rawMessage = error instanceof Error ? error.message : String(error || "");
  const matched = publicErrorPatterns.find((item) => item.pattern.test(rawMessage));
  return matched?.message || fallback;
}

function sendError(response, error, status = 500, fallback) {
  // 中文注解：接口只返回用户能理解的中文提示，真实错误保留在服务端日志里用于排查。
  console.error(error);
  response.status(status).json({ message: toPublicErrorMessage(error, fallback) });
}

function createMinioClient() {
  if (!process.env.STORAGE_ENDPOINT || !process.env.STORAGE_ACCESS_KEY_ID || !process.env.STORAGE_SECRET_ACCESS_KEY) {
    return null;
  }

  const endpointUrl = new URL(process.env.STORAGE_ENDPOINT);

  return new MinioClient({
    endPoint: endpointUrl.hostname,
    port: Number(endpointUrl.port || (endpointUrl.protocol === "https:" ? 443 : 80)),
    useSSL: endpointUrl.protocol === "https:",
    accessKey: process.env.STORAGE_ACCESS_KEY_ID,
    secretKey: process.env.STORAGE_SECRET_ACCESS_KEY
  });
}

function jsonString(value) {
  return value == null ? null : JSON.stringify(value);
}

function parseJson(value, fallback = null) {
  if (value == null) return fallback;
  if (typeof value === "object") return value;

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function stripHtml(value = "") {
  return String(value)
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function countWords(value = "") {
  return stripHtml(value).replace(/\s+/g, "").length;
}

function safeFileName(value = "document") {
  return String(value)
    .trim()
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, "-")
    .slice(0, 80) || "document";
}

function collectText(node) {
  if (!node) return "";
  if (node.type === "text") return node.data || "";
  if (!node.children?.length) return "";
  return node.children.map(collectText).join("");
}

function textRunsFromNode(node, marks = {}) {
  if (!node) return [];
  if (node.type === "text") {
    const text = (node.data || "").replace(/\s+/g, " ");
    return text ? [new TextRun({ text, bold: marks.bold, italics: marks.italics })] : [];
  }

  const nextMarks = {
    bold: marks.bold || ["strong", "b"].includes(node.name),
    italics: marks.italics || ["em", "i"].includes(node.name)
  };

  return (node.children || []).flatMap((child) => textRunsFromNode(child, nextMarks));
}

function paragraphFromNode(node) {
  const tagName = node.name;
  const text = collectText(node).replace(/\s+/g, " ").trim();
  if (!text) return null;

  if (tagName === "h1") {
    return new Paragraph({ text, heading: HeadingLevel.HEADING_1, spacing: { after: 160 } });
  }

  if (tagName === "h2") {
    return new Paragraph({ text, heading: HeadingLevel.HEADING_2, spacing: { before: 180, after: 120 } });
  }

  if (tagName === "h3") {
    return new Paragraph({ text, heading: HeadingLevel.HEADING_3, spacing: { before: 140, after: 100 } });
  }

  // 中文注解：列表先按普通项目符号导出，后续可以继续扩展多级编号和缩进样式。
  if (tagName === "li") {
    return new Paragraph({
      children: textRunsFromNode(node),
      bullet: { level: 0 },
      spacing: { after: 80 }
    });
  }

  return new Paragraph({
    children: textRunsFromNode(node),
    spacing: { after: 120 }
  });
}

function extractDocxParagraphsFromHtml(html = "") {
  const parsed = parseDocument(html, { decodeEntities: true });
  const paragraphs = [];

  function walk(node) {
    if (["h1", "h2", "h3", "p", "li"].includes(node.name)) {
      const paragraph = paragraphFromNode(node);
      if (paragraph) paragraphs.push(paragraph);
      return;
    }

    for (const child of node.children || []) {
      walk(child);
    }
  }

  for (const child of parsed.children || []) {
    walk(child);
  }

  return paragraphs.length
    ? paragraphs
    : [new Paragraph({ text: stripHtml(html) || "空白文档", spacing: { after: 120 } })];
}

async function createDocxBuffer({ title, content }) {
  const document = new Document({
    sections: [
      {
        properties: {},
        children: [
          new Paragraph({
            text: title || "未命名文档",
            heading: HeadingLevel.TITLE,
            spacing: { after: 260 }
          }),
          ...extractDocxParagraphsFromHtml(content)
        ]
      }
    ]
  });

  return Packer.toBuffer(document);
}

async function ensureStorage() {
  if (!minioClient) {
    throw new Error("未配置 MinIO 存储环境变量");
  }

  const exists = await minioClient.bucketExists(storageBucket);
  if (!exists) {
    await minioClient.makeBucket(storageBucket);
  }

  return minioClient;
}

function toDocument(row) {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    documentType: row.document_type,
    tone: row.tone,
    outline: parseJson(row.outline_json, []),
    content: row.content || "",
    status: row.status,
    wordCount: row.word_count,
    lastOpenedAt: row.last_opened_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function ensureDb() {
  if (!dbPool) {
    throw new Error("未配置 DATABASE_URL");
  }
  return dbPool;
}

async function createDocumentVersion(connection, documentId, outline, content, versionNote = "手动保存") {
  const [[versionRow]] = await connection.query(
    "SELECT COALESCE(MAX(version_no), 0) + 1 AS next_version FROM document_versions WHERE document_id = ?",
    [documentId]
  );

  await connection.query(
    "INSERT INTO document_versions (document_id, version_no, outline_json, content, version_note) VALUES (?, ?, ?, ?, ?)",
    [documentId, versionRow.next_version, jsonString(outline || []), content || "", versionNote]
  );
}

async function logAiRequest({ userId = localUserId, documentId = null, actionType, prompt, responseText, status = "success", errorMessage = null, latencyMs = null }) {
  if (!dbPool) return;

  try {
    await dbPool.query(
      `INSERT INTO ai_request_logs
        (user_id, document_id, action_type, model, prompt, response, status, error_message, latency_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        documentId,
        actionType,
        gatewayModel,
        prompt || "",
        responseText || "",
        status,
        errorMessage,
        latencyMs
      ]
    );
  } catch (error) {
    console.warn("AI request log write failed:", error.message);
  }
}

function hasGatewayConfig() {
  return Boolean(
    llmApiUrl &&
      llmApiKey &&
      !llmApiKey.includes("replace-with") &&
      !llmApiKey.includes("请替换")
  );
}

function normalizeModelText(result) {
  const message = result?.choices?.[0]?.message;
  const content = message?.content;

  if (typeof content === "string" && content.trim()) {
    return content.trim();
  }

  // 中文注解：部分推理模型可能把内容放在 reasoning_content，兜底提取，避免前端拿到空结果。
  if (typeof message?.reasoning_content === "string" && message.reasoning_content.trim()) {
    return message.reasoning_content.trim();
  }

  return "";
}

function extractJsonArray(text) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;

  try {
    const parsed = JSON.parse(candidate);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    const start = candidate.indexOf("[");
    const end = candidate.lastIndexOf("]");
    if (start >= 0 && end > start) {
      try {
        const parsed = JSON.parse(candidate.slice(start, end + 1));
        return Array.isArray(parsed) ? parsed : null;
      } catch {
        return null;
      }
    }
  }

  return null;
}

function parseCookies(request) {
  const header = request.headers.cookie || "";
  return Object.fromEntries(
    header
      .split(";")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => {
        const index = item.indexOf("=");
        return index > -1 ? [item.slice(0, index), decodeURIComponent(item.slice(index + 1))] : [item, ""];
      })
  );
}

function hashSessionToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function setSessionCookie(response, token, maxAgeSeconds = sessionTtlSeconds) {
  const cookieParts = [
    `${sessionCookieName}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`
  ];

  if (sessionCookieSecure) {
    cookieParts.push("Secure");
  }

  response.setHeader("Set-Cookie", cookieParts.join("; "));
}

function clearSessionCookie(response) {
  response.setHeader("Set-Cookie", `${sessionCookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function unwrapMolingData(result) {
  if (result && typeof result === "object" && "code" in result) {
    if (result.code !== 0) {
      const error = new Error(result.message || "墨灵平台接口调用失败");
      error.code = result.code;
      throw error;
    }

    return result.data;
  }

  return result;
}

async function callMolingInternal(path, options = {}) {
  if (!internalApiToken) {
    throw new Error("未配置 INTERNAL_API_TOKEN");
  }

  const url = new URL(path, molingApiBaseUrl);
  const response = await fetch(url, {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      "X-Internal-Token": internalApiToken,
      ...(options.headers || {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const result = await response.json().catch(() => null);

  if (!response.ok) {
    const message = result?.message || result?.error || `墨灵平台接口调用失败：${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.code = result?.code;
    throw error;
  }

  return unwrapMolingData(result);
}

async function verifyMolingLaunchTicket(ticket) {
  // Note: launch ticket is exchanged only on the server side.
  return callMolingInternal("/api/internal/app-launch/verify", {
    method: "POST",
    body: { launch_ticket: ticket }
  });
}

function normalizeMolingId(value) {
  return value == null ? "" : String(value);
}

function toMolingNumber(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : value;
}

async function createLocalSession({ userId, appId, productId }) {
  const pool = await ensureDb();
  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashSessionToken(token);
  const expiresAt = new Date(Date.now() + sessionTtlSeconds * 1000);

  await pool.query(
    `INSERT INTO molin_user_sessions
      (user_id, app_id, product_id, session_token_hash, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
    [normalizeMolingId(userId), normalizeMolingId(appId), normalizeMolingId(productId), tokenHash, expiresAt]
  );

  return { token, expiresAt };
}

async function getCurrentSession(request) {
  if (!dbPool) return null;

  const token = parseCookies(request)[sessionCookieName];
  if (!token) return null;

  const tokenHash = hashSessionToken(token);
  const [[session]] = await dbPool.query(
    `SELECT user_id, app_id, product_id, expires_at
     FROM molin_user_sessions
     WHERE session_token_hash = ? AND expires_at > NOW()
     LIMIT 1`,
    [tokenHash]
  );

  return session || null;
}

async function getCurrentUser(request) {
  const session = await getCurrentSession(request);
  if (session) {
    return {
      userId: normalizeMolingId(session.user_id),
      appId: normalizeMolingId(session.app_id),
      productId: normalizeMolingId(session.product_id || molingProductId),
      isMolingUser: true,
      expiresAt: session.expires_at
    };
  }

  // Note: keep a local development user when the app is opened directly.
  return {
    userId: localUserId,
    appId: normalizeMolingId(molingAppId),
    productId: normalizeMolingId(molingProductId),
    isMolingUser: false,
    expiresAt: null
  };
}

function serializeUserContext(user) {
  return {
    userId: user.userId,
    appId: user.appId,
    productId: user.productId,
    isMolingUser: user.isMolingUser,
    expiresAt: user.expiresAt
  };
}

async function getUserEntitlements(userId, productId) {
  const params = new URLSearchParams({ user_id: String(userId), product_id: String(productId) });
  const data = await callMolingInternal(`/api/internal/user-entitlements?${params.toString()}`);
  return data?.entitlements || [];
}

async function getPointsSummary(user) {
  if (!user.isMolingUser || localMolingMock || !user.productId) {
    return { enabled: false, entitlements: [], remaining: null };
  }

  const entitlements = await getUserEntitlements(user.userId, user.productId);
  const remainingValues = entitlements
    .filter((item) => item.usable)
    .map((item) => (item.remaining == null ? null : Number(item.remaining)))
    .filter((item) => item == null || Number.isFinite(item));

  return {
    enabled: true,
    entitlements,
    remaining: remainingValues.some((item) => item == null)
      ? null
      : remainingValues.reduce((sum, item) => sum + Number(item), 0)
  };
}

async function findUsableEntitlement(userId, productId) {
  const entitlements = await getUserEntitlements(userId, productId);
  const entitlement = entitlements.find((item) => item.usable);

  if (!entitlement) {
    const error = new Error("积分不足或没有可用套餐");
    error.code = 60005;
    throw error;
  }

  return entitlement;
}

async function reservePoints(user, usageType, amount, referenceId = "") {
  if (!user.isMolingUser || localMolingMock) return null;

  const entitlement = await findUsableEntitlement(user.userId, user.productId);
  const idempotencyKey = `moling_word:${user.userId}:${usageType}:${referenceId || "none"}:${crypto.randomUUID()}`;
  const data = await callMolingInternal("/api/internal/entitlement-reserve", {
    method: "POST",
    body: {
      entitlement_id: entitlement.entitlement_id || entitlement.id,
      user_id: toMolingNumber(user.userId),
      amount: String(amount),
      idempotency_key: idempotencyKey
    }
  });

  return { holdId: data?.hold_id, idempotencyKey, amount };
}

async function settlePoints(hold, actualAmount) {
  if (!hold) return null;
  return callMolingInternal("/api/internal/entitlement-settle", {
    method: "POST",
    body: {
      hold_id: hold.holdId,
      idempotency_key: hold.idempotencyKey,
      actual_amount: String(actualAmount)
    }
  });
}

async function releasePoints(hold) {
  if (!hold) return null;
  return callMolingInternal("/api/internal/entitlement-release", {
    method: "POST",
    body: {
      hold_id: hold.holdId,
      idempotency_key: hold.idempotencyKey
    }
  });
}

function parseOutline(text, topic) {
  const jsonArray = extractJsonArray(text);
  const fromJson = jsonArray
    ?.map((item) => (typeof item === "string" ? item : item?.title))
    .filter((item) => typeof item === "string" && item.trim())
    .map((item) => item.trim());

  if (fromJson?.length) {
    return fromJson.slice(0, 8);
  }

  // 中文注解：模型没有按 JSON 返回时，尝试从普通编号文本中提取大纲。
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*\d.、\s]+/, "").trim())
    .filter(Boolean)
    .filter((line) => line.length <= 80);

  return lines.length ? lines.slice(0, 8) : fallbackOutline(topic);
}

function stripMarkdownHeadings(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^#{1,6}\s+/, "").trimEnd())
    .join("\n")
    .trim();
}

function hasGarbledText(text) {
  const questionMarks = (text.match(/\?/g) || []).length;
  return questionMarks >= 8 || /锟{2,}|�{2,}/.test(text);
}

function looksLikeMissingInput(text) {
  return /请提供|没有提供|未提供|无法.*处理|missing input/i.test(text);
}

function looksIrrelevantToWordEditor(text) {
  return /Backspace|Delete|分页符|编辑标记|show\/hide/i.test(text);
}

function validateAiText(text, options = {}) {
  const normalized = stripMarkdownHeadings(text || "");
  const minLength = options.minLength ?? 12;

  if (!normalized || normalized.length < minLength) {
    throw new Error("AI response is too short");
  }

  if (hasGarbledText(normalized)) {
    throw new Error("AI response looks garbled");
  }

  if (looksLikeMissingInput(normalized)) {
    throw new Error("AI did not handle the input correctly");
  }

  if (looksIrrelevantToWordEditor(normalized)) {
    throw new Error("AI response is unrelated to the current Word editing task");
  }

  return normalized;
}

async function callMolinChat(messages) {
  if (!hasGatewayConfig()) {
    throw new Error("未配置 AI 模型服务环境变量");
  }

  let lastError;

  for (let attempt = 0; attempt <= llmMaxRetries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), llmTimeoutMs);

    try {
      // 中文注解：这里兼容 OpenAI chat/completions 风格的 DeepSeek 或墨灵网关。
      const response = await fetch(llmApiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${llmApiKey}`
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: gatewayModel,
          messages,
          temperature: 0.4
        })
      });
      clearTimeout(timeout);

      const result = await response.json().catch(() => null);

      if (!response.ok) {
        const message = result?.message || result?.error?.message || "AI 网关请求失败";
        throw new Error(message);
      }

      const text = normalizeModelText(result);
      if (!text) {
        throw new Error("模型返回内容为空");
      }

      return text;
    } catch (error) {
      clearTimeout(timeout);
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("AI 请求失败");
}

function fallbackOutline(topic) {
  return [
    `一、${topic}概述`,
    "二、目标用户与使用场景",
    "三、核心功能模块",
    "四、本地开发与平台接入规划",
    "五、后续迭代计划"
  ];
}

app.get("/api/health", (_request, response) => {
  response.json({
    ok: true,
    gatewayConfigured: hasGatewayConfig(),
    model: gatewayModel,
    appName: process.env.APP_NAME || "moling_word",
    molingApiBaseUrl,
    llmProvider: process.env.LLM_PROVIDER || "http",
    databaseConfigured: Boolean(dbPool),
    storageConfigured: Boolean(minioClient),
    storageBucket
  });
});

app.post("/api/molin/launch", async (request, response) => {
  const { ticket } = request.body || {};

  if (!ticket && !localMolingMock) {
    response.status(400).json({ message: "请从墨灵平台重新进入应用。" });
    return;
  }

  try {
    const launchData = localMolingMock
      ? { user_id: localUserId, app_id: molingAppId, product_id: molingProductId }
      : await verifyMolingLaunchTicket(ticket);
    const userId = normalizeMolingId(launchData.user_id);
    const appId = normalizeMolingId(launchData.app_id || molingAppId);
    const productId = normalizeMolingId(launchData.product_id || molingProductId);

    if (molingAppId && appId && appId !== normalizeMolingId(molingAppId)) {
      response.status(403).json({ message: "墨灵入口信息与当前应用不匹配，请检查应用 ID。" });
      return;
    }

    if (molingProductId && productId && productId !== normalizeMolingId(molingProductId)) {
      response.status(403).json({ message: "墨灵入口信息与当前商品不匹配，请检查商品 ID。" });
      return;
    }

    const session = await createLocalSession({ userId, appId, productId });
    setSessionCookie(response, session.token);

    const user = { userId, appId, productId, isMolingUser: true, expiresAt: session.expiresAt };
    const points = await getPointsSummary(user).catch((error) => ({ enabled: true, error: toPublicErrorMessage(error, "积分读取失败，请稍后刷新。"), entitlements: [], remaining: null }));
    response.json({ user: serializeUserContext(user), points });
  } catch (error) {
    sendError(response, error, 401, "墨灵登录校验失败，请从墨灵平台重新进入。");
  }
});

app.get("/api/session", async (request, response) => {
  try {
    const user = await getCurrentUser(request);
    const points = await getPointsSummary(user).catch((error) => ({ enabled: user.isMolingUser, error: toPublicErrorMessage(error, "积分读取失败，请稍后刷新。"), entitlements: [], remaining: null }));
    response.json({ user: serializeUserContext(user), points });
  } catch (error) {
    sendError(response, error, 500, "读取登录状态失败，请刷新页面重试。");
  }
});

app.post("/api/logout", async (request, response) => {
  try {
    const token = parseCookies(request)[sessionCookieName];
    if (token && dbPool) {
      await dbPool.query("DELETE FROM molin_user_sessions WHERE session_token_hash = ?", [hashSessionToken(token)]);
    }

    clearSessionCookie(response);
    response.json({ ok: true });
  } catch (error) {
    sendError(response, error, 500, "退出登录失败，请稍后重试。");
  }
});

app.get("/api/billing/points", async (request, response) => {
  try {
    const user = await getCurrentUser(request);
    response.json({ points: await getPointsSummary(user) });
  } catch (error) {
    sendError(response, error, 500, "积分读取失败，请稍后刷新。");
  }
});

app.get("/api/documents", async (request, response) => {
  try {
    const pool = await ensureDb();
    const currentUser = await getCurrentUser(request);
    const [rows] = await pool.query(
      `SELECT id, user_id, title, document_type, tone, outline_json, content, status,
        word_count, last_opened_at, created_at, updated_at
       FROM documents
       WHERE user_id = ? AND status <> 'deleted'
       ORDER BY updated_at DESC
       LIMIT 50`,
      [currentUser.userId]
    );

    response.json({ documents: rows.map(toDocument) });
  } catch (error) {
    sendError(response, error, 500, "读取最近文档失败，请稍后重试。");
  }
});

app.post("/api/documents", async (request, response) => {
  const { title, documentType, tone, outline, content } = request.body;

  try {
    const pool = await ensureDb();
    const currentUser = await getCurrentUser(request);
    const [result] = await pool.query(
      `INSERT INTO documents
        (user_id, title, document_type, tone, outline_json, content, status, word_count, last_opened_at)
       VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, NOW())`,
      [
        currentUser.userId,
        title || "未命名文档",
        documentType || "Word 文档",
        tone || "正式",
        jsonString(outline || []),
        content || "",
        countWords(content || "")
      ]
    );

    const documentId = result.insertId;
    const [[row]] = await pool.query("SELECT * FROM documents WHERE id = ? AND user_id = ?", [documentId, currentUser.userId]);
    response.status(201).json({ document: toDocument(row) });
  } catch (error) {
    sendError(response, error, 500, "创建文档失败，请稍后重试。");
  }
});

app.get("/api/documents/:id", async (request, response) => {
  try {
    const pool = await ensureDb();
    const currentUser = await getCurrentUser(request);
    const [[row]] = await pool.query(
      "SELECT * FROM documents WHERE id = ? AND user_id = ? AND status <> 'deleted'",
      [request.params.id, currentUser.userId]
    );

    if (!row) {
      response.status(404).json({ message: "文档不存在或已被删除。" });
      return;
    }

    await pool.query("UPDATE documents SET last_opened_at = NOW() WHERE id = ? AND user_id = ?", [request.params.id, currentUser.userId]);
    response.json({ document: toDocument(row) });
  } catch (error) {
    sendError(response, error, 500, "读取文档失败，请稍后重试。");
  }
});

app.patch("/api/documents/:id", async (request, response) => {
  const { title, documentType, tone, outline, content, status, saveVersion, versionNote } = request.body;

  let connection;
  try {
    const pool = await ensureDb();
    const currentUser = await getCurrentUser(request);
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [[current]] = await connection.query(
      "SELECT * FROM documents WHERE id = ? AND user_id = ? AND status <> 'deleted' FOR UPDATE",
      [request.params.id, currentUser.userId]
    );

    if (!current) {
      await connection.rollback();
      response.status(404).json({ message: "文档不存在或已被删除。" });
      return;
    }

    const nextOutline = outline ?? parseJson(current.outline_json, []);
    const nextContent = content ?? current.content ?? "";

    await connection.query(
      `UPDATE documents
       SET title = ?, document_type = ?, tone = ?, outline_json = ?, content = ?,
         status = ?, word_count = ?, updated_at = NOW()
       WHERE id = ? AND user_id = ?`,
      [
        title ?? current.title,
        documentType ?? current.document_type,
        tone ?? current.tone,
        jsonString(nextOutline),
        nextContent,
        status ?? current.status,
        countWords(nextContent),
        request.params.id,
        currentUser.userId
      ]
    );

    if (saveVersion) {
      await createDocumentVersion(connection, request.params.id, nextOutline, nextContent, versionNote || "手动保存");
    }

    const [[row]] = await connection.query("SELECT * FROM documents WHERE id = ? AND user_id = ?", [request.params.id, currentUser.userId]);
    await connection.commit();
    response.json({ document: toDocument(row) });
  } catch (error) {
    if (connection) await connection.rollback();
    sendError(response, error, 500, "保存文档失败，请稍后重试。");
  } finally {
    if (connection) connection.release();
  }
});

app.delete("/api/documents/:id", async (request, response) => {
  try {
    const pool = await ensureDb();
    const currentUser = await getCurrentUser(request);
    const [result] = await pool.query(
      "UPDATE documents SET status = 'deleted', updated_at = NOW() WHERE id = ? AND user_id = ?",
      [request.params.id, currentUser.userId]
    );

    response.json({ deleted: result.affectedRows > 0 });
  } catch (error) {
    sendError(response, error, 500, "删除文档失败，请稍后重试。");
  }
});

app.post("/api/documents/:id/duplicate", async (request, response) => {
  try {
    const pool = await ensureDb();
    const currentUser = await getCurrentUser(request);
    const [[source]] = await pool.query(
      "SELECT * FROM documents WHERE id = ? AND user_id = ? AND status <> 'deleted'",
      [request.params.id, currentUser.userId]
    );

    if (!source) {
      response.status(404).json({ message: "文档不存在或已被删除。" });
      return;
    }

    const [result] = await pool.query(
      `INSERT INTO documents
        (user_id, title, document_type, tone, outline_json, content, status, word_count, last_opened_at)
       VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, NOW())`,
      [
        currentUser.userId,
        `${source.title} 副本`,
        source.document_type,
        source.tone,
        // 中文注解：MySQL JSON 可能已经被解析成对象，复制前统一重新序列化。
        jsonString(parseJson(source.outline_json, [])),
        source.content,
        source.word_count
      ]
    );

    const [[row]] = await pool.query("SELECT * FROM documents WHERE id = ? AND user_id = ?", [result.insertId, currentUser.userId]);
    response.status(201).json({ document: toDocument(row) });
  } catch (error) {
    sendError(response, error, 500, "复制文档失败，请稍后重试。");
  }
});

app.post("/api/documents/:id/export-docx", async (request, response) => {
  const { content } = request.body;
  let pointHold = null;

  try {
    const pool = await ensureDb();
    const storage = await ensureStorage();
    const currentUser = await getCurrentUser(request);
    const [[documentRow]] = await pool.query(
      "SELECT * FROM documents WHERE id = ? AND user_id = ? AND status <> 'deleted'",
      [request.params.id, currentUser.userId]
    );

    if (!documentRow) {
      response.status(404).json({ message: "文档不存在" });
      return;
    }

    // 中文注解：Word 导出先预占 1 积分；文件真正写入成功后再结算，失败则释放预占。
    pointHold = await reservePoints(currentUser, "word_export_docx", 1, request.params.id);
    const exportContent = typeof content === "string" ? content : documentRow.content || "";
    const buffer = await createDocxBuffer({ title: documentRow.title, content: exportContent });
    const exportedAt = new Date();
    const baseName = safeFileName(documentRow.title);
    const fileName = `${baseName}-${exportedAt.getTime()}.docx`;
    const objectKey = `documents/${documentRow.id}/exports/${fileName}`;
    const mimeType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

    await storage.putObject(storageBucket, objectKey, buffer, buffer.length, {
      "Content-Type": mimeType
    });

    const [result] = await pool.query(
      `INSERT INTO files
        (user_id, document_id, original_name, file_name, file_type, mime_type, file_size, bucket, object_key, purpose)
       VALUES (?, ?, ?, ?, 'docx', ?, ?, ?, ?, 'export')`,
      [
        currentUser.userId,
        documentRow.id,
        `${baseName}.docx`,
        fileName,
        mimeType,
        buffer.length,
        storageBucket,
        objectKey
      ]
    );

    await settlePoints(pointHold, 1);
    response.status(201).json({
      file: {
        id: result.insertId,
        documentId: documentRow.id,
        fileName,
        fileType: "docx",
        mimeType,
        fileSize: buffer.length,
        bucket: storageBucket,
        objectKey,
        downloadUrl: `/api/files/${result.insertId}/download`
      }
    });
  } catch (error) {
    await releasePoints(pointHold).catch((releaseError) => console.warn("Moling point release failed:", releaseError.message));
    sendError(response, error, 500, "导出 Word 失败，请稍后重试。");
  }
});
app.get("/api/files/:id/download", async (request, response) => {
  try {
    const pool = await ensureDb();
    const storage = await ensureStorage();
    const currentUser = await getCurrentUser(request);
    const [[fileRow]] = await pool.query(
      "SELECT * FROM files WHERE id = ? AND user_id = ?",
      [request.params.id, currentUser.userId]
    );

    if (!fileRow) {
      response.status(404).json({ message: "文件不存在或已被删除。" });
      return;
    }

    const objectStream = await storage.getObject(fileRow.bucket, fileRow.object_key);
    response.setHeader("Content-Type", fileRow.mime_type || "application/octet-stream");
    response.setHeader("Content-Length", String(fileRow.file_size || ""));
    response.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(fileRow.original_name)}`);
    objectStream.pipe(response);
  } catch (error) {
    sendError(response, error, 500, "下载文件失败，请稍后重试。");
  }
});

app.post("/api/ai/generate-outline", async (request, response) => {
  const { topic, documentType, tone, requirement, documentId } = request.body;
  const startedAt = Date.now();
  let currentUser = { userId: localUserId, appId: normalizeMolingId(molingAppId), productId: normalizeMolingId(molingProductId), isMolingUser: false };
  let pointHold = null;
  const prompt = `Generate 5 first-level outline items for a ${documentType || "Word"} document. Topic: ${topic || "AI Word document"}. Tone: ${tone || "formal"}. Extra requirement: ${requirement || "none"}. Return only a JSON string array. Use Simplified Chinese.`;

  try {
    currentUser = await getCurrentUser(request);
    pointHold = await reservePoints(currentUser, "word_outline_generate", 1, documentId || topic || "outline");
    const content = await callMolinChat([
      {
        role: "system",
        content: "You are a professional Simplified Chinese Word document writing assistant. Return only a JSON string array."
      },
      { role: "user", content: prompt }
    ]);

    const outline = parseOutline(content, topic || "AI Word document");
    await settlePoints(pointHold, 1);
    await logAiRequest({
      userId: currentUser.userId,
      documentId,
      actionType: "generate_outline",
      prompt,
      responseText: JSON.stringify(outline),
      latencyMs: Date.now() - startedAt
    });
    response.json({ outline });
  } catch (error) {
    await releasePoints(pointHold).catch((releaseError) => console.warn("Moling point release failed:", releaseError.message));
    await logAiRequest({
      userId: currentUser.userId,
      documentId,
      actionType: "generate_outline",
      prompt,
      responseText: "",
      status: "failed",
      errorMessage: error instanceof Error ? error.message : "大纲生成失败",
      latencyMs: Date.now() - startedAt
    });
    response.json({
      outline: fallbackOutline(topic || "AI Word document"),
      fallback: true,
      message: toPublicErrorMessage(error, "AI 大纲生成失败，已使用本地兜底大纲。")
    });
  }
});

app.post("/api/ai/generate-body", async (request, response) => {
  const { topic, documentType, tone, requirement, outline, documentId } = request.body;
  const normalizedOutline = Array.isArray(outline) ? outline : [];
  const startedAt = Date.now();
  let currentUser = { userId: localUserId, appId: normalizeMolingId(molingAppId), productId: normalizeMolingId(molingProductId), isMolingUser: false };
  let pointHold = null;
  const prompt = `Write the main body for a ${documentType || "Word"} document in Simplified Chinese. Topic: ${topic || "AI Word document"}. Tone: ${tone || "formal"}. Extra requirement: ${requirement || "none"}.\nOutline:\n${normalizedOutline.map((item, index) => `${index + 1}. ${item}`).join("\n")}\nRequirement: each section should have 1-2 complete paragraphs, suitable for Word export.`;

  try {
    currentUser = await getCurrentUser(request);
    pointHold = await reservePoints(currentUser, "word_body_generate", 5, documentId || topic || "body");
    const content = await callMolinChat([
      {
        role: "system",
        content: "You are a professional Simplified Chinese Word document writing assistant. Output clear section titles and natural paragraphs, without Markdown code fences."
      },
      { role: "user", content: prompt }
    ]);

    const validContent = validateAiText(content, { minLength: 80 });
    await settlePoints(pointHold, 5);
    await logAiRequest({
      userId: currentUser.userId,
      documentId,
      actionType: "generate_body",
      prompt,
      responseText: validContent,
      latencyMs: Date.now() - startedAt
    });
    response.json({ content: validContent });
  } catch (error) {
    await releasePoints(pointHold).catch((releaseError) => console.warn("Moling point release failed:", releaseError.message));
    await logAiRequest({
      userId: currentUser.userId,
      documentId,
      actionType: "generate_body",
      prompt,
      responseText: "",
      status: "failed",
      errorMessage: error instanceof Error ? error.message : "正文生成失败",
      latencyMs: Date.now() - startedAt
    });
    response.json({
      content: `${topic || "AI Word 文档"}\n\n1. 项目概述\n\n当前 AI 服务暂时不可用，请检查模型配置或稍后重试。你可以先基于已有大纲继续手动编辑文档。`,
      fallback: true,
      message: toPublicErrorMessage(error, "AI 正文生成失败，已使用本地兜底内容。")
    });
  }
});

app.post("/api/ai/edit", async (request, response) => {
  const { action, content, documentId } = request.body;
  const sourceContent = typeof content === "string" ? content : "";
  const startedAt = Date.now();
  let currentUser = { userId: localUserId, appId: normalizeMolingId(molingAppId), productId: normalizeMolingId(molingProductId), isMolingUser: false };
  let pointHold = null;
  const actionMap = {
    continue: "Continue writing based on the selected text.",
    expand: "Expand the selected text with more detail.",
    shorten: "Shorten the selected text while keeping key information.",
    correct: "Correct typos, grammar issues, and unnatural expressions.",
    polish: "Polish the selected text to be more formal, clear, and suitable for an office Word document."
  };
  const instruction = actionMap[action] || actionMap.polish;
  const prompt = `${instruction}\nReturn only the revised Simplified Chinese text.\n\n<<<TEXT_START\n${sourceContent}\nTEXT_END>>>`;

  try {
    currentUser = await getCurrentUser(request);
    pointHold = await reservePoints(currentUser, "word_polish", 2, documentId || action || "edit");
    const result = await callMolinChat([
      {
        role: "system",
        content: "You are a professional Simplified Chinese Word document editor. Only return the processed text."
      },
      { role: "user", content: prompt }
    ]);

    const validContent = validateAiText(result, { minLength: action === "shorten" ? 4 : 10 });
    await settlePoints(pointHold, 2);
    await logAiRequest({
      userId: currentUser.userId,
      documentId,
      actionType: action || "polish",
      prompt,
      responseText: validContent,
      latencyMs: Date.now() - startedAt
    });
    response.json({ content: validContent });
  } catch (error) {
    await releasePoints(pointHold).catch((releaseError) => console.warn("Moling point release failed:", releaseError.message));
    await logAiRequest({
      userId: currentUser.userId,
      documentId,
      actionType: action || "polish",
      prompt,
      responseText: "",
      status: "failed",
      errorMessage: error instanceof Error ? error.message : "AI 编辑失败",
      latencyMs: Date.now() - startedAt
    });
    response.json({
      content: sourceContent,
      fallback: true,
      message: toPublicErrorMessage(error, "AI 编辑失败，已保留原文。")
    });
  }
});
app.post("/api/ai/polish", async (request, response) => {
  const { content } = request.body;
  const sourceContent = typeof content === "string" ? content : "";

  try {
    const polished = await callMolinChat([
      {
        role: "system",
        content: "You are a professional Simplified Chinese Word document polishing assistant. Keep the original meaning and return only the polished text."
      },
      {
        role: "user",
        content: `Polish the following content in Simplified Chinese:\n\n${sourceContent}`
      }
    ]);

    response.json({ content: validateAiText(polished, { minLength: 10 }) });
  } catch (error) {
    response.json({
      content: sourceContent,
      fallback: true,
      message: toPublicErrorMessage(error, "AI 润色失败，已保留原文。")
    });
  }
});
app.listen(port, "127.0.0.1", () => {
  console.log(`Local API server running at http://127.0.0.1:${port}`);
});



