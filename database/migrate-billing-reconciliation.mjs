import "dotenv/config";
import mysql from "mysql2/promise";

if (!process.env.DATABASE_URL) {
  throw new Error("缺少 DATABASE_URL，无法创建积分结算对账表。");
}

const connection = await mysql.createConnection(process.env.DATABASE_URL);

try {
  // 中文注解：独立迁移供历史数据库安全补表；新数据库由 init-mysql.sql 创建相同结构。
  await connection.query(`
    CREATE TABLE IF NOT EXISTS billing_reconciliation_tasks (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '对账任务 ID',
      user_id VARCHAR(64) NOT NULL COMMENT '墨灵平台用户 ID',
      usage_type VARCHAR(60) NOT NULL COMMENT '计费动作类型',
      operation_type VARCHAR(20) NOT NULL DEFAULT 'settle' COMMENT '待确认操作：settle 结算，release 释放',
      hold_id VARCHAR(64) NOT NULL COMMENT '墨灵积分预占 hold_id',
      idempotency_key VARCHAR(191) NOT NULL COMMENT '原操作幂等键',
      actual_amount DECIMAL(18, 6) NOT NULL COMMENT '应结算积分，释放任务为 0',
      settlement_state VARCHAR(30) NOT NULL DEFAULT 'settlement_unknown' COMMENT '平台结算状态',
      status VARCHAR(30) NOT NULL DEFAULT 'pending' COMMENT '任务状态：pending、processing、retry、resolved、manual_review',
      claim_token VARCHAR(64) NULL COMMENT '对账进程租约令牌，防止超时进程覆盖新结果',
      attempt_count INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '对账重试次数',
      last_error TEXT NULL COMMENT '最近一次错误',
      next_retry_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '下次可重试时间',
      resolved_at DATETIME NULL COMMENT '确认结算时间',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
      PRIMARY KEY (id),
      UNIQUE KEY uk_billing_reconciliation_idempotency (idempotency_key),
      KEY idx_billing_reconciliation_status_retry (status, next_retry_at),
      KEY idx_billing_reconciliation_user_created (user_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='积分结算对账任务表'
  `);
  console.log("积分结算对账表迁移完成。");
} finally {
  await connection.end();
}
