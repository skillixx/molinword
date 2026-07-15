import "dotenv/config";
import mysql from "mysql2/promise";

if (!process.env.DATABASE_URL) {
  throw new Error("缺少 DATABASE_URL，无法迁移文档页面设置字段。");
}

const connection = await mysql.createConnection(process.env.DATABASE_URL);

async function ensureJsonColumn(tableName, columnName) {
  const [[databaseRow]] = await connection.query("SELECT DATABASE() AS database_name");
  const [[columnRow]] = await connection.query(
    `SELECT COUNT(*) AS count
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [databaseRow.database_name, tableName, columnName]
  );
  if (Number(columnRow.count)) return;
  // 中文注解：表名和列名来自脚本内固定参数，不接受外部输入，避免动态 DDL 注入。
  const addColumn = async (algorithmClause) => {
    try {
      await connection.query(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} JSON NULL, ${algorithmClause}`);
      return true;
    } catch (error) {
      // 中文注解：多个部署节点同时执行时，后完成的节点把“列已存在”视为迁移成功。
      if (error?.code === "ER_DUP_FIELDNAME") return true;
      const canDowngrade = ["ER_ALTER_OPERATION_NOT_SUPPORTED_REASON", "ER_UNKNOWN_ALTER_ALGORITHM", "ER_PARSE_ERROR"].includes(error?.code);
      if (algorithmClause === "ALGORITHM=INSTANT" && canDowngrade) return false;
      throw error;
    }
  };

  // 中文注解：新版 MySQL 优先瞬时加列；旧版降级到在线 INPLACE，LOCK=NONE 明确禁止锁表迁移。
  if (await addColumn("ALGORITHM=INSTANT")) return;
  await addColumn("ALGORITHM=INPLACE, LOCK=NONE");
}

try {
  await ensureJsonColumn("documents", "page_layout_json");
  await ensureJsonColumn("document_versions", "page_layout_json");
  console.log("文档页面设置字段迁移完成。");
} finally {
  await connection.end();
}
