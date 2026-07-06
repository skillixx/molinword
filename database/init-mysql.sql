-- 中文注解：本文件用于初始化 AI Word 文档助手的 MySQL 数据库和第一版核心表。
-- 中文注解：请先把下面的占位密码替换为你自己的强密码，再用 MySQL root 账号执行。

CREATE DATABASE IF NOT EXISTS moling_word
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;

CREATE USER IF NOT EXISTS 'moling_word_app'@'localhost'
  IDENTIFIED BY '请替换为强密码';

CREATE USER IF NOT EXISTS 'moling_word_app'@'%'
  IDENTIFIED BY '请替换为强密码';

GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES
  ON moling_word.*
  TO 'moling_word_app'@'localhost';

GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES
  ON moling_word.*
  TO 'moling_word_app'@'%';

FLUSH PRIVILEGES;

USE moling_word;

-- 中文注解：文档主表，保存用户创建的 Word 文档主体信息。
CREATE TABLE IF NOT EXISTS documents (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '文档 ID',
  user_id VARCHAR(64) NOT NULL DEFAULT 'local-dev-user' COMMENT '用户 ID，本地开发先用模拟用户，后续绑定墨灵 user_id',
  title VARCHAR(255) NOT NULL COMMENT '文档标题',
  document_type VARCHAR(50) NOT NULL COMMENT '文档类型，例如工作总结、会议纪要、商业计划书',
  tone VARCHAR(50) NOT NULL DEFAULT '正式' COMMENT '写作语气',
  outline_json JSON NULL COMMENT '文档大纲 JSON',
  content LONGTEXT NULL COMMENT '文档正文内容',
  status VARCHAR(30) NOT NULL DEFAULT 'draft' COMMENT '状态：draft 草稿，completed 已完成，deleted 已删除',
  word_count INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '字数统计',
  last_opened_at DATETIME NULL COMMENT '最近打开时间',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (id),
  KEY idx_documents_user_updated (user_id, updated_at),
  KEY idx_documents_user_status (user_id, status),
  KEY idx_documents_type (document_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='文档主表';

-- 中文注解：文档版本表，用于保存自动保存或手动保存产生的历史版本。
CREATE TABLE IF NOT EXISTS document_versions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '版本 ID',
  document_id BIGINT UNSIGNED NOT NULL COMMENT '文档 ID',
  version_no INT UNSIGNED NOT NULL COMMENT '版本号',
  outline_json JSON NULL COMMENT '版本大纲 JSON',
  content LONGTEXT NULL COMMENT '版本正文内容',
  version_note VARCHAR(255) NULL COMMENT '版本说明，例如自动保存、手动保存、AI 生成正文',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (id),
  UNIQUE KEY uk_document_version (document_id, version_no),
  KEY idx_document_versions_document (document_id, created_at),
  CONSTRAINT fk_document_versions_document
    FOREIGN KEY (document_id) REFERENCES documents (id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='文档版本表';

-- 中文注解：模板表，用于保存系统内置模板和后续用户自定义模板。
CREATE TABLE IF NOT EXISTS document_templates (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '模板 ID',
  name VARCHAR(120) NOT NULL COMMENT '模板名称',
  category VARCHAR(60) NOT NULL COMMENT '模板分类',
  document_type VARCHAR(50) NOT NULL COMMENT '关联文档类型',
  outline_json JSON NULL COMMENT '模板大纲 JSON',
  content LONGTEXT NULL COMMENT '模板正文内容',
  is_system TINYINT(1) NOT NULL DEFAULT 1 COMMENT '是否系统模板',
  status VARCHAR(30) NOT NULL DEFAULT 'active' COMMENT '状态：active 启用，inactive 停用',
  sort_order INT NOT NULL DEFAULT 0 COMMENT '排序值',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (id),
  KEY idx_templates_category_status (category, status),
  KEY idx_templates_type_status (document_type, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='文档模板表';

-- 中文注解：文件索引表，实际文件保存在 MinIO，本表只保存文件元数据和 object key。
CREATE TABLE IF NOT EXISTS files (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '文件 ID',
  user_id VARCHAR(64) NOT NULL DEFAULT 'local-dev-user' COMMENT '用户 ID',
  document_id BIGINT UNSIGNED NULL COMMENT '关联文档 ID',
  original_name VARCHAR(255) NOT NULL COMMENT '原始文件名',
  file_name VARCHAR(255) NOT NULL COMMENT '系统文件名',
  file_type VARCHAR(80) NOT NULL COMMENT '文件类型，例如 docx、png、pdf',
  mime_type VARCHAR(120) NULL COMMENT 'MIME 类型',
  file_size BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '文件大小，单位字节',
  bucket VARCHAR(80) NOT NULL COMMENT 'MinIO bucket 名称',
  object_key VARCHAR(512) NOT NULL COMMENT 'MinIO object key',
  purpose VARCHAR(50) NOT NULL COMMENT '用途：upload 上传，export 导出，image 图片',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (id),
  KEY idx_files_user_created (user_id, created_at),
  KEY idx_files_document (document_id),
  KEY idx_files_purpose (purpose),
  CONSTRAINT fk_files_document
    FOREIGN KEY (document_id) REFERENCES documents (id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='文件索引表';

-- 中文注解：AI 请求日志表，用于排查模型调用问题、统计功能消耗和后续计费对账。
CREATE TABLE IF NOT EXISTS ai_request_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'AI 请求 ID',
  user_id VARCHAR(64) NOT NULL DEFAULT 'local-dev-user' COMMENT '用户 ID',
  document_id BIGINT UNSIGNED NULL COMMENT '关联文档 ID',
  action_type VARCHAR(60) NOT NULL COMMENT '动作类型，例如 generate_outline、generate_body、polish',
  model VARCHAR(80) NOT NULL COMMENT '模型名称',
  prompt MEDIUMTEXT NULL COMMENT '请求提示词',
  response MEDIUMTEXT NULL COMMENT '模型返回内容',
  status VARCHAR(30) NOT NULL DEFAULT 'success' COMMENT '状态：success 成功，failed 失败',
  error_message TEXT NULL COMMENT '错误信息',
  input_tokens INT UNSIGNED NULL COMMENT '输入 token 数',
  output_tokens INT UNSIGNED NULL COMMENT '输出 token 数',
  latency_ms INT UNSIGNED NULL COMMENT '请求耗时，单位毫秒',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (id),
  KEY idx_ai_logs_user_created (user_id, created_at),
  KEY idx_ai_logs_document (document_id),
  KEY idx_ai_logs_action (action_type),
  CONSTRAINT fk_ai_logs_document
    FOREIGN KEY (document_id) REFERENCES documents (id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='AI 请求日志表';

-- 中文注解：墨灵平台身份映射表，正式接入 SSO 后用于记录平台用户和本应用用户数据的绑定关系。
CREATE TABLE IF NOT EXISTS molin_user_sessions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '会话 ID',
  user_id VARCHAR(64) NOT NULL COMMENT '墨灵平台 user_id',
  app_id VARCHAR(64) NULL COMMENT '墨灵平台 app_id',
  product_id VARCHAR(64) NULL COMMENT '墨灵平台 product_id',
  session_token_hash VARCHAR(128) NOT NULL COMMENT '本地会话 token 哈希，不保存明文',
  expires_at DATETIME NOT NULL COMMENT '过期时间',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (id),
  UNIQUE KEY uk_session_token_hash (session_token_hash),
  KEY idx_molin_sessions_user (user_id),
  KEY idx_molin_sessions_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='墨灵平台会话表';
