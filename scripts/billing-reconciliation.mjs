import "dotenv/config";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import mysql from "mysql2/promise";

const mode = process.argv[2] || "list";
const supportedModes = new Set(["list", "retry", "import-outbox"]);
if (!supportedModes.has(mode)) {
  throw new Error("用法：node scripts/billing-reconciliation.mjs list|retry|import-outbox");
}
if (!process.env.DATABASE_URL) {
  throw new Error("缺少 DATABASE_URL，无法读取积分结算对账任务。");
}

const molingApiBaseUrl = process.env.MOLING_API_BASE_URL || "http://8.130.9.163:8080";
const internalApiToken = process.env.INTERNAL_API_TOKEN || "";
const batchSize = Math.min(100, Math.max(1, Number(process.env.BILLING_RECONCILIATION_BATCH_SIZE || 20)));
const maxAttempts = Math.min(20, Math.max(1, Number(process.env.BILLING_RECONCILIATION_MAX_ATTEMPTS || 5)));
const requestTimeoutMs = Math.min(60000, Math.max(1000, Number(process.env.BILLING_RECONCILIATION_TIMEOUT_MS || 10000)));
const outboxPath = process.env.BILLING_RECONCILIATION_OUTBOX || "./runtime-data/billing-reconciliation-outbox.jsonl";
const connection = await mysql.createConnection(process.env.DATABASE_URL);

async function listTasks() {
  const [rows] = await connection.query(
    `SELECT id, user_id, usage_type, operation_type, hold_id, actual_amount, settlement_state, status, attempt_count, last_error, next_retry_at, updated_at
     FROM billing_reconciliation_tasks
     WHERE status <> 'resolved'
     ORDER BY created_at ASC
     LIMIT ?`,
    [batchSize]
  );
  // 中文注解：列表不显示平台内部令牌，也不输出完整幂等键，便于值班人员安全查看待办。
  console.table(rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    usageType: row.usage_type,
    operation: row.operation_type,
    holdId: row.hold_id,
    amount: String(row.actual_amount),
    state: row.settlement_state,
    status: row.status,
    attempts: row.attempt_count,
    nextRetryAt: row.next_retry_at,
    error: String(row.last_error || "").slice(0, 120)
  })));
  return rows.length;
}

async function callBillingOperation(task) {
  const operationType = task.operation_type === "release" ? "release" : "settle";
  const response = await fetch(new URL(`/api/internal/entitlement-${operationType}`, molingApiBaseUrl), {
    method: "POST",
    signal: AbortSignal.timeout(requestTimeoutMs),
    headers: {
      "Content-Type": "application/json",
      "X-Internal-Token": internalApiToken
    },
    body: JSON.stringify({
      hold_id: task.hold_id,
      idempotency_key: task.idempotency_key,
      ...(operationType === "settle" ? { actual_amount: String(task.actual_amount) } : {})
    })
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || (result && typeof result === "object" && "code" in result && result.code !== 0)) {
    const error = new Error(result?.message || result?.error || `墨灵结算接口返回 ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return result?.data || result || {};
}

async function retryTasks() {
  if (!internalApiToken) {
    throw new Error("缺少 INTERNAL_API_TOKEN，禁止执行积分结算对账重试。");
  }
  const [tasks] = await connection.query(
    `SELECT *
     FROM billing_reconciliation_tasks
     WHERE (
       (status IN ('pending', 'retry') AND next_retry_at <= CURRENT_TIMESTAMP)
       OR (status = 'processing' AND updated_at < DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 10 MINUTE))
     )
     ORDER BY created_at ASC
     LIMIT ?`,
    [batchSize]
  );
  let resolved = 0;
  let deferred = 0;
  let superseded = 0;

  for (const task of tasks) {
    const claimToken = randomUUID();
    // 中文注解：先原子认领任务；多个值班进程同时运行时，只有一个进程会实际发起该次幂等结算。
    const [claim] = await connection.query(
      `UPDATE billing_reconciliation_tasks
       SET status = 'processing', claim_token = ?
       WHERE id = ? AND (
         (status IN ('pending', 'retry') AND next_retry_at <= CURRENT_TIMESTAMP)
         OR (status = 'processing' AND updated_at < DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 10 MINUTE))
       )`,
      [claimToken, task.id]
    );
    if (!claim.affectedRows) continue;

    try {
      const result = await callBillingOperation(task);
      const [resolution] = await connection.query(
        `UPDATE billing_reconciliation_tasks
         SET status = 'resolved', settlement_state = ?, resolved_at = CURRENT_TIMESTAMP, last_error = NULL, claim_token = NULL
         WHERE id = ? AND status = 'processing' AND claim_token = ?`,
        [String(result.status || (task.operation_type === "release" ? "released" : "settled")).slice(0, 30), task.id, claimToken]
      );
      if (resolution.affectedRows) resolved += 1;
      else superseded += 1;
    } catch (error) {
      const attemptCount = Number(task.attempt_count || 0) + 1;
      const nextStatus = attemptCount >= maxAttempts ? "manual_review" : "retry";
      const retryDelayMinutes = Math.min(60, 2 ** Math.min(attemptCount, 5));
      const [deferral] = await connection.query(
        `UPDATE billing_reconciliation_tasks
         SET status = ?, attempt_count = ?, last_error = ?, next_retry_at = DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ? MINUTE), claim_token = NULL
         WHERE id = ? AND status = 'processing' AND claim_token = ?`,
        [nextStatus, attemptCount, String(error?.message || "结算重试失败").slice(0, 1000), retryDelayMinutes, task.id, claimToken]
      );
      if (deferral.affectedRows) deferred += 1;
      else superseded += 1;
    }
  }

  console.log("积分结算对账批次完成。", { scanned: tasks.length, resolved, deferred, superseded });
}

async function importOutbox() {
  let source = "";
  try {
    source = await readFile(outboxPath, "utf8");
  } catch (error) {
    // 中文注解：新环境尚未产生降级记录属于正常空状态，不能阻断同一轮数据库待办重试。
    if (error?.code === "ENOENT") {
      console.log("计费对账 outbox 尚未创建，按零条记录处理。", { records: 0, imported: 0, invalid: 0 });
      return;
    }
    throw error;
  }
  const records = source.split(/\r?\n/).filter(Boolean);
  let imported = 0;
  let invalid = 0;
  for (const line of records) {
    try {
      const item = JSON.parse(line);
      if (!item.holdId || !item.idempotencyKey || !["settle", "release"].includes(item.operationType)) {
        invalid += 1;
        continue;
      }
      // 中文注解：outbox 可重复导入，唯一幂等键确保同一任务不会产生重复账务操作。
      await connection.query(
        `INSERT INTO billing_reconciliation_tasks
          (user_id, usage_type, operation_type, hold_id, idempotency_key, actual_amount, settlement_state, status, attempt_count, last_error, next_retry_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, CURRENT_TIMESTAMP)
         ON DUPLICATE KEY UPDATE
           operation_type = IF(status IN ('resolved', 'manual_review', 'processing'), operation_type, VALUES(operation_type)),
           actual_amount = IF(status IN ('resolved', 'manual_review', 'processing'), actual_amount, VALUES(actual_amount)),
           settlement_state = IF(status IN ('resolved', 'manual_review', 'processing'), settlement_state, VALUES(settlement_state)),
           last_error = IF(status IN ('resolved', 'manual_review', 'processing'), last_error, VALUES(last_error)),
           next_retry_at = IF(status IN ('resolved', 'manual_review', 'processing'), next_retry_at, CURRENT_TIMESTAMP),
           claim_token = IF(status IN ('resolved', 'manual_review', 'processing'), claim_token, NULL),
           status = IF(status IN ('resolved', 'manual_review', 'processing'), status, 'pending')`,
        [
          String(item.userId || "unknown").slice(0, 64),
          String(item.usageType || "unknown").slice(0, 60),
          item.operationType,
          String(item.holdId).slice(0, 64),
          String(item.idempotencyKey).slice(0, 191),
          String(item.actualAmount || 0),
          String(item.settlementState || `${item.operationType}_unknown`).slice(0, 30),
          String(item.lastError || item.databaseError || "outbox 导入").slice(0, 1000)
        ]
      );
      imported += 1;
    } catch {
      invalid += 1;
    }
  }
  console.log("计费对账 outbox 导入完成。", { records: records.length, imported, invalid, retainedSource: outboxPath });
}

try {
  if (mode === "list") {
    const count = await listTasks();
    console.log(`当前显示 ${count} 条未解决对账任务。`);
  } else if (mode === "retry") {
    await retryTasks();
  } else {
    await importOutbox();
  }
} finally {
  await connection.end();
}
