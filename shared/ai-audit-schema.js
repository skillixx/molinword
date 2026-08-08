export const aiAuditRequiredColumnNames = Object.freeze([
  "request_id",
  "prompt_hmac_sha256",
  "response_hmac_sha256",
  "prompt_chars",
  "response_chars"
]);
export const aiAuditCreatedAtIndexName = "idx_ai_logs_created";
export const aiAuditCreatedAtIndexColumns = Object.freeze(["created_at"]);
export const aiHistoryIndexName = "idx_ai_logs_user_id";
export const aiHistoryIndexColumns = Object.freeze(["user_id", "id"]);

export function hasExactMysqlIndex(indexRows, indexName, expectedColumns) {
  // 中文注解：索引同名不代表结构正确；按 MySQL 序号重建列序后精确比较，防止错误索引绕过迁移与就绪门禁。
  const actualColumns = indexRows
    .filter((row) => String(row.INDEX_NAME || "") === indexName)
    .sort((left, right) => Number(left.SEQ_IN_INDEX) - Number(right.SEQ_IN_INDEX))
    .map((row) => row.SUB_PART == null ? String(row.COLUMN_NAME || "") : "");
  return actualColumns.length === expectedColumns.length
    && actualColumns.every((columnName, index) => columnName === expectedColumns[index]);
}

export async function inspectAiAuditSchema(connection) {
  const [columnRows] = await connection.query(
    `SELECT COLUMN_NAME
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_request_logs'`
  );
  const [indexRows] = await connection.query(
    `SELECT INDEX_NAME, SEQ_IN_INDEX, COLUMN_NAME, SUB_PART
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_request_logs'
       AND INDEX_NAME IN ('idx_ai_logs_created', 'idx_ai_logs_user_id')`
  );
  const existingColumns = new Set(columnRows.map((row) => String(row.COLUMN_NAME || "")));
  const missingColumns = aiAuditRequiredColumnNames.filter((columnName) => !existingColumns.has(columnName));
  const missingOrInvalidIndexes = [];
  if (!hasExactMysqlIndex(indexRows, aiAuditCreatedAtIndexName, aiAuditCreatedAtIndexColumns)) {
    missingOrInvalidIndexes.push(aiAuditCreatedAtIndexName);
  }
  if (!hasExactMysqlIndex(indexRows, aiHistoryIndexName, aiHistoryIndexColumns)) {
    missingOrInvalidIndexes.push(aiHistoryIndexName);
  }
  const rawIndexNames = new Set(indexRows.map((row) => String(row.INDEX_NAME || "")));
  const existingIndexNames = [aiAuditCreatedAtIndexName, aiHistoryIndexName].filter((indexName) => rawIndexNames.has(indexName));
  return {
    ready: columnRows.length > 0 && missingColumns.length === 0 && missingOrInvalidIndexes.length === 0,
    tableExists: columnRows.length > 0,
    missingColumns,
    missingOrInvalidIndexes,
    existingIndexNames
  };
}

export function formatAiAuditSchemaReport(report) {
  if (report.ready) return "AI 审计隐私结构检查通过。";
  const issues = [];
  if (!report.tableExists) issues.push("ai_request_logs 表不存在");
  else if (report.missingColumns.length) issues.push(`缺少字段：${report.missingColumns.join("、")}`);
  if (report.missingOrInvalidIndexes.length) {
    issues.push(`缺少或结构错误的索引：${report.missingOrInvalidIndexes.join("、")}`);
  }
  // 中文注解：报告仅使用受控结构名称，不拼接数据库名或连接异常，避免运维输出泄露连接信息与凭据。
  return `AI 审计隐私结构检查未通过：\n- ${issues.join("\n- ")}\n请由获授权的部署人员执行 npm run db:migrate:ai-audit-privacy。`;
}
