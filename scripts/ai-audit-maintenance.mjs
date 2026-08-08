import "dotenv/config";
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
const connection = await mysql.createConnection(process.env.DATABASE_URL);

async function runBatches(operation) {
  let totalAffected = 0;
  let lastAffected = 0;
  for (let batch = 0; batch < maxBatches; batch += 1) {
    lastAffected = await operation();
    totalAffected += lastAffected;
    if (lastAffected < batchSize) break;
  }
  return { totalAffected, limitReached: lastAffected === batchSize };
}

async function cleanupExpiredLogs() {
  return runBatches(async () => {
    // 中文注解：两个数值均已通过严格整数边界校验，分批删除限制单次事务规模与锁持有时间。
    const [result] = await connection.query(
      `DELETE FROM ai_request_logs
       WHERE created_at < DATE_SUB(CURRENT_TIMESTAMP, INTERVAL ${retentionDays} DAY)
       ORDER BY created_at, id
       LIMIT ${batchSize}`
    );
    return Number(result.affectedRows || 0);
  });
}

async function redactExistingLogs() {
  return runBatches(async () => {
    // 中文注解：先在数据库内计算不可逆摘要和字符数，再清空历史正文；日志只输出数量，不输出客户内容。
    const [result] = await connection.query(
      `UPDATE ai_request_logs
       SET prompt_sha256 = COALESCE(prompt_sha256, SHA2(COALESCE(prompt, ''), 256)),
           response_sha256 = COALESCE(response_sha256, SHA2(COALESCE(response, ''), 256)),
           prompt_chars = COALESCE(prompt_chars, CHAR_LENGTH(COALESCE(prompt, ''))),
           response_chars = COALESCE(response_chars, CHAR_LENGTH(COALESCE(response, ''))),
           prompt = NULL,
           response = NULL
       WHERE prompt IS NOT NULL OR response IS NOT NULL
       ORDER BY id
       LIMIT ${batchSize}`
    );
    return Number(result.affectedRows || 0);
  });
}

try {
  const result = mode === "cleanup" ? await cleanupExpiredLogs() : await redactExistingLogs();
  console.log(mode === "cleanup" ? "AI 审计过期日志清理完成。" : "AI 审计历史正文脱敏完成。", {
    affectedRows: result.totalAffected,
    limitReached: result.limitReached
  });
} finally {
  await connection.end();
}
