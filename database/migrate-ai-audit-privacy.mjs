import "dotenv/config";
import mysql from "mysql2/promise";
import {
  aiAuditCreatedAtIndexName,
  aiAuditCreatedAtIndexColumns,
  aiHistoryIndexColumns,
  aiHistoryIndexName,
  inspectAiAuditSchema
} from "../shared/ai-audit-schema.js";

if (!process.env.DATABASE_URL) {
  throw new Error("缺少 DATABASE_URL，无法迁移 AI 审计隐私字段。");
}

const connection = await mysql.createConnection(process.env.DATABASE_URL);

// 中文注解：所有 DDL 名称和定义均由脚本内固定清单提供，不接受外部参数，避免动态 DDL 注入。
const auditColumnDefinitions = new Map([
  ["request_id", "VARCHAR(64) NULL COMMENT '服务端请求 ID，用于关联访问日志'"],
  ["prompt_hmac_sha256", "CHAR(64) NULL COMMENT '提示词 HMAC-SHA256 指纹'"],
  ["response_hmac_sha256", "CHAR(64) NULL COMMENT '模型回复 HMAC-SHA256 指纹'"],
  ["prompt_chars", "INT UNSIGNED NULL COMMENT '提示词 Unicode 字符数'"],
  ["response_chars", "INT UNSIGNED NULL COMMENT '模型回复 Unicode 字符数'"]
]);

async function currentDatabaseName() {
  const [[databaseRow]] = await connection.query("SELECT DATABASE() AS database_name");
  if (!databaseRow?.database_name) throw new Error("DATABASE_URL 未指定数据库名。");
  return databaseRow.database_name;
}

async function loadMissingOperations() {
  const report = await inspectAiAuditSchema(connection);
  if (!report.tableExists) throw new Error("ai_request_logs 表不存在，请先执行数据库初始化。");
  const existingIndexes = new Set(report.existingIndexNames);
  return {
    missingColumns: report.missingColumns.map((columnName) => [columnName, auditColumnDefinitions.get(columnName)]),
    createdAtIndexExists: existingIndexes.has(aiAuditCreatedAtIndexName),
    historyIndexExists: existingIndexes.has(aiHistoryIndexName),
    needsCreatedAtIndex: report.missingOrInvalidIndexes.includes(aiAuditCreatedAtIndexName),
    needsHistoryIndex: report.missingOrInvalidIndexes.includes(aiHistoryIndexName)
  };
}

async function ensureAuditStructure() {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { missingColumns, createdAtIndexExists, historyIndexExists, needsCreatedAtIndex, needsHistoryIndex } = await loadMissingOperations();
    if (!missingColumns.length && !needsCreatedAtIndex && !needsHistoryIndex) return;
    const alterClauses = missingColumns.map(([columnName, definition]) => `ADD COLUMN ${columnName} ${definition}`);
    if (needsCreatedAtIndex) {
      if (createdAtIndexExists) alterClauses.push(`DROP INDEX ${aiAuditCreatedAtIndexName}`);
      alterClauses.push(`ADD INDEX ${aiAuditCreatedAtIndexName} (${aiAuditCreatedAtIndexColumns.join(", ")})`);
    }
    if (needsHistoryIndex) {
      if (historyIndexExists) alterClauses.push(`DROP INDEX ${aiHistoryIndexName}`);
      alterClauses.push(`ADD INDEX ${aiHistoryIndexName} (${aiHistoryIndexColumns.join(", ")})`);
    }

    // 中文注解：缺失列和历史分页/保留期索引合并为一次 ALTER；旧版 MySQL 最多重建一次审计表，避免逐项迁移放大锁与 IO。
    const algorithms = needsCreatedAtIndex || needsHistoryIndex
      ? ["ALGORITHM=INPLACE, LOCK=NONE"]
      : ["ALGORITHM=INSTANT", "ALGORITHM=INPLACE, LOCK=NONE"];
    let shouldRetryForRace = false;
    for (const algorithm of algorithms) {
      try {
        await connection.query(`ALTER TABLE ai_request_logs ${alterClauses.join(", ")}, ${algorithm}`);
        return;
      } catch (error) {
        if (["ER_DUP_FIELDNAME", "ER_DUP_KEYNAME", "ER_CANT_DROP_FIELD_OR_KEY"].includes(error?.code)) {
          // 中文注解：并发部署可能先完成相同 DDL，重新读取结构后只补仍缺失的部分。
          shouldRetryForRace = true;
          break;
        }
        const canDowngrade = ["ER_ALTER_OPERATION_NOT_SUPPORTED_REASON", "ER_UNKNOWN_ALTER_ALGORITHM", "ER_PARSE_ERROR"]
          .includes(error?.code);
        if (algorithm === "ALGORITHM=INSTANT" && canDowngrade) continue;
        throw error;
      }
    }
    if (!shouldRetryForRace) break;
  }

  const remaining = await loadMissingOperations();
  if (remaining.missingColumns.length || remaining.needsCreatedAtIndex || remaining.needsHistoryIndex) {
    throw new Error("AI 审计隐私字段迁移未能收敛，请检查并发迁移状态。");
  }
}

try {
  await currentDatabaseName();
  await ensureAuditStructure();
  console.log("AI 审计隐私字段迁移完成。");
} finally {
  await connection.end();
}
