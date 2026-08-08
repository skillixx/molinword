import "dotenv/config";
import crypto from "node:crypto";
import mysql from "mysql2/promise";

if (!process.env.DATABASE_URL) {
  throw new Error("缺少 DATABASE_URL，无法维护 AI 审计日志。");
}

const mode = process.argv[2];
if (!new Set(["cleanup", "redact-existing"]).has(mode)) {
  throw new Error("用法：node scripts/ai-audit-maintenance.mjs <cleanup|redact-existing>");
}

function parseBoundedInteger(name, fallback, minimum, maximum) {
  const rawValue = process.env[name] ?? String(fallback);
  const value = Number(rawValue);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} 必须是 ${minimum}-${maximum} 的整数。`);
  }
  return value;
}

const retentionDays = parseBoundedInteger("AI_AUDIT_RETENTION_DAYS", 30, 1, 365);
const batchSize = parseBoundedInteger("AI_AUDIT_CLEANUP_BATCH_SIZE", 1000, 1, 10000);
const maxBatches = parseBoundedInteger("AI_AUDIT_CLEANUP_MAX_BATCHES", 20, 1, 100);
const redactionBatchSize = parseBoundedInteger("AI_AUDIT_REDACTION_BATCH_SIZE", 10, 1, 100);
const auditHashKey = String(process.env.AI_AUDIT_HASH_KEY || "");
if (mode === "redact-existing" && auditHashKey.length < 32) {
  throw new Error("AI_AUDIT_HASH_KEY 至少需要 32 个字符，无法安全脱敏历史审计正文。");
}
const connection = await mysql.createConnection(process.env.DATABASE_URL);

async function runBatches(operation, operationBatchSize = batchSize) {
  let totalAffected = 0;
  let lastAffected = 0;
  for (let batch = 0; batch < maxBatches; batch += 1) {
    lastAffected = await operation();
    totalAffected += lastAffected;
    if (lastAffected < operationBatchSize) break;
  }
  return { totalAffected, batchLimitReached: lastAffected === operationBatchSize };
}

async function cleanupExpiredLogs() {
  const result = await runBatches(async () => {
    // 中文注解：两个数值均已通过严格整数边界校验，分批删除限制单次事务规模与锁持有时间。
    const [deleteResult] = await connection.query(
      `DELETE FROM ai_request_logs
       WHERE created_at < DATE_SUB(CURRENT_TIMESTAMP, INTERVAL ${retentionDays} DAY)
       ORDER BY created_at, id
       LIMIT ${batchSize}`
    );
    return Number(deleteResult.affectedRows || 0);
  });
  if (!result.batchLimitReached) return { ...result, hasRemaining: false };
  const [[remainingRow]] = await connection.query(
    `SELECT EXISTS(
       SELECT 1 FROM ai_request_logs
       WHERE created_at < DATE_SUB(CURRENT_TIMESTAMP, INTERVAL ${retentionDays} DAY)
       LIMIT 1
     ) AS has_remaining`
  );
  return { ...result, hasRemaining: Boolean(remainingRow.has_remaining) };
}

function createAuditFingerprint(value) {
  return crypto.createHmac("sha256", auditHashKey).update(String(value || ""), "utf8").digest("hex");
}

async function redactExistingLogs() {
  const result = await runBatches(async () => {
    const [idRows] = await connection.query(
      `SELECT id
       FROM ai_request_logs
       WHERE prompt IS NOT NULL OR response IS NOT NULL
       ORDER BY id
       LIMIT ${redactionBatchSize}`
    );
    // 中文注解：首个查询只缓冲小型 ID 列表；正文逐条读取并由单条 UPDATE 自动提交，避免 MEDIUMTEXT 批量驻留和长事务。
    for (const { id } of idRows) {
      const [[row]] = await connection.execute(
        "SELECT id, prompt, response FROM ai_request_logs WHERE id = ? AND (prompt IS NOT NULL OR response IS NOT NULL)",
        [id]
      );
      if (!row) continue;
      // 中文注解：专用 HMAC 密钥只在 Node 进程内使用；参数化更新不把客户正文或密钥拼入 SQL 与日志。
      await connection.execute(
        `UPDATE ai_request_logs
         SET prompt_hmac_sha256 = COALESCE(prompt_hmac_sha256, ?),
             response_hmac_sha256 = COALESCE(response_hmac_sha256, ?),
             prompt_chars = COALESCE(prompt_chars, ?),
             response_chars = COALESCE(response_chars, ?),
             prompt = NULL,
             response = NULL
         WHERE id = ?`,
        [
          createAuditFingerprint(row.prompt),
          createAuditFingerprint(row.response),
          Array.from(String(row.prompt || "")).length,
          Array.from(String(row.response || "")).length,
          row.id
        ]
      );
    }
    return idRows.length;
  }, redactionBatchSize);
  if (!result.batchLimitReached) return { ...result, hasRemaining: false };
  const [[remainingRow]] = await connection.query(
    "SELECT EXISTS(SELECT 1 FROM ai_request_logs WHERE prompt IS NOT NULL OR response IS NOT NULL LIMIT 1) AS has_remaining"
  );
  return { ...result, hasRemaining: Boolean(remainingRow.has_remaining) };
}

try {
  const result = mode === "cleanup" ? await cleanupExpiredLogs() : await redactExistingLogs();
  console.log(mode === "cleanup" ? "AI 审计过期日志清理完成。" : "AI 审计历史正文脱敏完成。", {
    affectedRows: result.totalAffected,
    hasRemaining: result.hasRemaining
  });
  if (result.hasRemaining) {
    // 中文注解：积压超过单轮上限时必须让 systemd 标记失败并触发告警，不能伪装成保留策略已满足。
    throw new Error("AI 审计维护达到单轮批次上限且仍有剩余记录，请检查积压并立即重试。");
  }
} finally {
  await connection.end();
}
