-- 中文注解：本脚本用于初始化 AI Word 文档助手需要的 MySQL 数据库、应用账号和核心表。
-- 中文注解：root 连接示例：mysql -h172.16.10.151 -P13306 -uroot -p < database/init-mysql.sql

CREATE DATABASE IF NOT EXISTS moling_word
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;

-- 中文注解：生产账号和强密码必须由部署系统或密钥管理服务创建，本脚本不再写入可复用的默认口令。
-- 创建账号后仅授予 moling_word 所需权限，不要在仓库、命令历史或部署文档中记录真实密码。

USE moling_word;

-- 中文注解：文档主表，保存用户创建的 Word 文档主体信息。
CREATE TABLE IF NOT EXISTS documents (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '文档 ID',
  user_id VARCHAR(64) NOT NULL DEFAULT 'local-dev-user' COMMENT '用户 ID，本地开发使用 local-dev-user，墨灵进入后使用平台 user_id',
  title VARCHAR(255) NOT NULL COMMENT '文档标题',
  document_type VARCHAR(50) NOT NULL COMMENT '文档类型，例如工作总结、会议纪要、商业计划书',
  tone VARCHAR(50) NOT NULL DEFAULT '正式' COMMENT '写作语气',
  template_id BIGINT UNSIGNED NULL COMMENT '关联模板 ID，空值表示使用默认文档样式',
  outline_json JSON NULL COMMENT '文档大纲 JSON',
  content LONGTEXT NULL COMMENT '文档正文 HTML',
  page_layout_json JSON NULL COMMENT '页眉、页脚、页码及后续页面设置 JSON',
  status VARCHAR(30) NOT NULL DEFAULT 'draft' COMMENT '状态：draft 草稿，completed 已完成，deleted 已删除',
  word_count INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '字数统计',
  last_opened_at DATETIME NULL COMMENT '最近打开时间',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (id),
  KEY idx_documents_user_updated (user_id, updated_at),
  KEY idx_documents_user_status (user_id, status),
  KEY idx_documents_type (document_type),
  KEY idx_documents_template (template_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='文档主表';

-- 中文注解：文档版本表，用于保存手动保存、导出前保存等关键版本。
CREATE TABLE IF NOT EXISTS document_versions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '版本 ID',
  document_id BIGINT UNSIGNED NOT NULL COMMENT '文档 ID',
  version_no INT UNSIGNED NOT NULL COMMENT '版本号',
  outline_json JSON NULL COMMENT '版本大纲 JSON',
  content LONGTEXT NULL COMMENT '版本正文 HTML',
  page_layout_json JSON NULL COMMENT '版本对应的页面设置 JSON',
  version_note VARCHAR(255) NULL COMMENT '版本说明，例如手动保存、导出 Word 前保存、AI 生成正文',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (id),
  UNIQUE KEY uk_document_version (document_id, version_no),
  KEY idx_document_versions_document (document_id, created_at),
  CONSTRAINT fk_document_versions_document
    FOREIGN KEY (document_id) REFERENCES documents (id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='文档版本表';

-- 中文注解：模板表保存正式正文骨架；前端接口不可用时仍保留静态兜底模板。
CREATE TABLE IF NOT EXISTS document_templates (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '模板 ID',
  name VARCHAR(120) NOT NULL COMMENT '模板名称',
  category VARCHAR(60) NOT NULL COMMENT '模板分类',
  document_type VARCHAR(50) NOT NULL COMMENT '关联文档类型',
  topic VARCHAR(255) NOT NULL DEFAULT '' COMMENT '默认文档主题',
  requirement TEXT NULL COMMENT '默认补充要求',
  outline_json JSON NULL COMMENT '模板大纲 JSON',
  content LONGTEXT NULL COMMENT '模板正文 HTML',
  is_system TINYINT(1) NOT NULL DEFAULT 1 COMMENT '是否系统模板',
  status VARCHAR(30) NOT NULL DEFAULT 'active' COMMENT '状态：active 启用，inactive 停用',
  sort_order INT NOT NULL DEFAULT 0 COMMENT '排序值',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (id),
  UNIQUE KEY uk_templates_name (name),
  KEY idx_templates_category_status (category, status),
  KEY idx_templates_type_status (document_type, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='文档模板表';

-- 中文注解：文件索引表，真实文件保存在 MinIO，这里只记录文件元数据和 object key。
CREATE TABLE IF NOT EXISTS files (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '文件 ID',
  user_id VARCHAR(64) NOT NULL DEFAULT 'local-dev-user' COMMENT '用户 ID',
  document_id BIGINT UNSIGNED NULL COMMENT '关联文档 ID',
  template_id BIGINT UNSIGNED NULL COMMENT '关联模板 ID，模板素材使用',
  original_name VARCHAR(255) NOT NULL COMMENT '原始文件名',
  file_name VARCHAR(255) NOT NULL COMMENT '系统文件名',
  file_type VARCHAR(80) NOT NULL COMMENT '文件类型，例如 docx、png、pdf',
  mime_type VARCHAR(120) NULL COMMENT 'MIME 类型',
  file_size BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '文件大小，单位字节',
  bucket VARCHAR(80) NOT NULL COMMENT 'MinIO bucket 名称',
  object_key VARCHAR(512) NOT NULL COMMENT 'MinIO object key',
  purpose VARCHAR(50) NOT NULL COMMENT '用途：upload 上传，export 导出，image 图片，template_cover 模板封面，template_style 模板样式，template_asset 模板附件',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (id),
  KEY idx_files_user_created (user_id, created_at),
  KEY idx_files_document (document_id),
  KEY idx_files_template (template_id, purpose),
  KEY idx_files_purpose (purpose),
  CONSTRAINT fk_files_document
    FOREIGN KEY (document_id) REFERENCES documents (id)
    ON DELETE SET NULL,
  CONSTRAINT fk_files_template
    FOREIGN KEY (template_id) REFERENCES document_templates (id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='文件索引表';

-- 中文注解：AI 请求日志表，用于排查模型调用问题、统计功能消耗和后续计费对账。
CREATE TABLE IF NOT EXISTS ai_request_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'AI 请求 ID',
  user_id VARCHAR(64) NOT NULL DEFAULT 'local-dev-user' COMMENT '用户 ID',
  document_id BIGINT UNSIGNED NULL COMMENT '关联文档 ID',
  action_type VARCHAR(60) NOT NULL COMMENT '动作类型，例如 generate_outline、generate_body、polish',
  model VARCHAR(80) NOT NULL COMMENT '模型名称',
  request_id VARCHAR(64) NULL COMMENT '服务端请求 ID，用于关联访问日志',
  prompt MEDIUMTEXT NULL COMMENT '开发环境可选请求提示词；生产元数据模式固定为空',
  response MEDIUMTEXT NULL COMMENT '开发环境可选模型返回内容；生产元数据模式固定为空',
  prompt_hmac_sha256 CHAR(64) NULL COMMENT '提示词 HMAC-SHA256 指纹',
  response_hmac_sha256 CHAR(64) NULL COMMENT '模型回复 HMAC-SHA256 指纹',
  prompt_chars INT UNSIGNED NULL COMMENT '提示词 Unicode 字符数',
  response_chars INT UNSIGNED NULL COMMENT '模型回复 Unicode 字符数',
  status VARCHAR(30) NOT NULL DEFAULT 'success' COMMENT '状态：success 成功，failed 失败',
  error_message TEXT NULL COMMENT '错误信息',
  input_tokens INT UNSIGNED NULL COMMENT '输入 token 数',
  output_tokens INT UNSIGNED NULL COMMENT '输出 token 数',
  latency_ms INT UNSIGNED NULL COMMENT '请求耗时，单位毫秒',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (id),
  KEY idx_ai_logs_created (created_at),
  KEY idx_ai_logs_user_created (user_id, created_at),
  KEY idx_ai_logs_user_id (user_id, id),
  KEY idx_ai_logs_document (document_id),
  KEY idx_ai_logs_action (action_type),
  CONSTRAINT fk_ai_logs_document
    FOREIGN KEY (document_id) REFERENCES documents (id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='AI 请求日志表';

-- 中文注解：积分结算或释放响应不确定时写入持久化对账队列，使用原幂等键安全重试，禁止盲目执行相反操作。
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='积分结算对账任务表';

-- 中文注解：墨灵平台会话表，只保存本地 session token 哈希，不保存明文 token。
CREATE TABLE IF NOT EXISTS molin_user_sessions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '会话 ID',
  user_id VARCHAR(64) NOT NULL COMMENT '墨灵平台 user_id',
  app_id VARCHAR(64) NULL COMMENT '墨灵平台 app_id',
  product_id VARCHAR(64) NULL COMMENT '墨灵平台 product_id',
  session_token_hash VARCHAR(128) NOT NULL COMMENT '本地会话 token 哈希',
  expires_at DATETIME NOT NULL COMMENT '过期时间',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (id),
  UNIQUE KEY uk_session_token_hash (session_token_hash),
  KEY idx_molin_sessions_user (user_id),
  KEY idx_molin_sessions_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='墨灵平台会话表';
