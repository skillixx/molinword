import "dotenv/config";
import mysql from "mysql2/promise";

if (!process.env.DATABASE_URL) {
  throw new Error("缺少 DATABASE_URL，无法迁移文档模板绑定字段。");
}

const connection = await mysql.createConnection(process.env.DATABASE_URL);

try {
  const [[databaseRow]] = await connection.query("SELECT DATABASE() AS database_name");
  const databaseName = databaseRow.database_name;

  const [[columnRow]] = await connection.query(
    `SELECT COUNT(*) AS count
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'documents' AND COLUMN_NAME = 'template_id'`,
    [databaseName]
  );
  if (!Number(columnRow.count)) {
    // 中文注解：模板绑定允许为空，确保导入文档和历史文档继续使用默认版式。
    await connection.query("ALTER TABLE documents ADD COLUMN template_id BIGINT UNSIGNED NULL AFTER tone");
  }

  const [[indexRow]] = await connection.query(
    `SELECT COUNT(*) AS count
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'documents' AND INDEX_NAME = 'idx_documents_template'`,
    [databaseName]
  );
  if (!Number(indexRow.count)) {
    await connection.query("ALTER TABLE documents ADD INDEX idx_documents_template (template_id)");
  }

  const [[foreignKeyRow]] = await connection.query(
    `SELECT COUNT(*) AS count
     FROM information_schema.REFERENTIAL_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA = ? AND TABLE_NAME = 'documents' AND CONSTRAINT_NAME = 'fk_documents_template'`,
    [databaseName]
  );
  if (!Number(foreignKeyRow.count)) {
    // 中文注解：模板删除时仅解除绑定，不能影响用户已经创建的文档。
    await connection.query(
      `ALTER TABLE documents
       ADD CONSTRAINT fk_documents_template
       FOREIGN KEY (template_id) REFERENCES document_templates (id)
       ON DELETE SET NULL`
    );
  }

  console.log("文档模板绑定字段迁移完成。");
} finally {
  await connection.end();
}
