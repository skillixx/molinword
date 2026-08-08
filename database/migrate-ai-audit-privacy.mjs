import "dotenv/config";
import mysql from "mysql2/promise";

if (!process.env.DATABASE_URL) {
  throw new Error("缺少 DATABASE_URL，无法迁移 AI 审计隐私字段。");
}

const connection = await mysql.createConnection(process.env.DATABASE_URL);

// 中文注解：所有 DDL 名称和定义均由脚本内固定清单提供，不接受外部参数，避免动态 DDL 注入。
const auditColumns = [
  ["request_id", "VARCHAR(64) NULL COMMENT '服务端请求 ID，用于关联访问日志' AFTER model"],
  ["prompt_sha256", "CHAR(64) NULL COMMENT '完整提示词 SHA-256' AFTER response"],
  ["response_sha256", "CHAR(64) NULL COMMENT '完整模型回复 SHA-256' AFTER prompt_sha256"],
  ["prompt_chars", "INT UNSIGNED NULL COMMENT '提示词 Unicode 字符数' AFTER response_sha256"],
  ["response_chars", "INT UNSIGNED NULL COMMENT '模型回复 Unicode 字符数' AFTER prompt_chars"]
];

async function currentDatabaseName() {
  const [[databaseRow]] = await connection.query("SELECT DATABASE() AS database_name");
  if (!databaseRow?.database_name) throw new Error("DATABASE_URL 未指定数据库名。");
  return databaseRow.database_name;
}

async function ensureColumn(databaseName, columnName, definition) {
  const [[columnRow]] = await connection.query(
    `SELECT COUNT(*) AS count
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'ai_request_logs' AND COLUMN_NAME = ?`,
    [databaseName, columnName]
  );
  if (Number(columnRow.count)) return;

  const addColumn = async (algorithmClause) => {
    try {
      await connection.query(`ALTER TABLE ai_request_logs ADD COLUMN ${columnName} ${definition}, ${algorithmClause}`);
      return true;
    } catch (error) {
      // 中文注解：多节点同时迁移时，后完成节点遇到重复字段可视为幂等成功。
      if (error?.code === "ER_DUP_FIELDNAME") return true;
      const canDowngrade = ["ER_ALTER_OPERATION_NOT_SUPPORTED_REASON", "ER_UNKNOWN_ALTER_ALGORITHM", "ER_PARSE_ERROR"]
        .includes(error?.code);
      if (algorithmClause === "ALGORITHM=INSTANT" && canDowngrade) return false;
      throw error;
    }
  };

  // 中文注解：新版 MySQL 优先瞬时加列；不支持时仅降级到明确无锁的在线迁移。
  if (await addColumn("ALGORITHM=INSTANT")) return;
  await addColumn("ALGORITHM=INPLACE, LOCK=NONE");
}

async function ensureCreatedAtIndex(databaseName) {
  const [[indexRow]] = await connection.query(
    `SELECT COUNT(*) AS count
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'ai_request_logs' AND INDEX_NAME = 'idx_ai_logs_created'`,
    [databaseName]
  );
  if (Number(indexRow.count)) return;
  try {
    // 中文注解：保留清理按创建时间定位历史记录，独立索引避免每日任务扫描整表。
    await connection.query(
      "ALTER TABLE ai_request_logs ADD INDEX idx_ai_logs_created (created_at), ALGORITHM=INPLACE, LOCK=NONE"
    );
  } catch (error) {
    if (error?.code !== "ER_DUP_KEYNAME") throw error;
  }
}

try {
  const databaseName = await currentDatabaseName();
  for (const [columnName, definition] of auditColumns) {
    await ensureColumn(databaseName, columnName, definition);
  }
  await ensureCreatedAtIndex(databaseName);
  console.log("AI 审计隐私字段迁移完成。");
} finally {
  await connection.end();
}
