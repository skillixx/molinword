# MySQL 数据库设计说明

## 一、推荐数据库和账号

建议创建一个独立数据库和一个专用应用账号。

### 数据库名

```text
moling_word
```

原因：

- 与应用名 `moling_word` 一致，容易识别。
- 后续部署、备份、迁移都比较清晰。
- 不和墨灵平台自身数据库混在一起。

### 用户名

```text
moling_word_app
```

原因：

- 这是应用专用账号。
- 不建议业务程序使用 MySQL `root`。
- 权限可以限制在 `moling_word.*` 范围内。

### 密码建议

不要使用简单密码，也不要把真实密码提交到代码仓库。

建议格式：

```text
Mw_2026_随机16位以上字符
```

示例占位：

```text
Mw_2026_ReplaceWithStrongPassword
```

你可以自己生成一个更强的，例如：

```text
Mw_2026@A7x9K2pQ8zL4nR6s
```

实际生产环境建议再更复杂一些，并通过 `.env` 保存。

## 二、创建数据库和用户

已提供初始化 SQL：

```text
database/init-mysql.sql
```

执行前请先把 SQL 里的：

```text
请替换为强密码
```

改成你的真实密码。

然后用 MySQL root 执行：

```powershell
mysql -u root -p < database/init-mysql.sql
```

## 三、应用连接字符串

后续接 Prisma 时，建议在 `.env` 中新增：

```env
DATABASE_URL="mysql://moling_word_app:你的真实密码@127.0.0.1:3306/moling_word"
```

如果 MySQL 不在本机，把 `127.0.0.1` 改成服务器 IP 或域名。

## 四、权限设计

给 `moling_word_app` 的权限建议为：

```sql
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES
ON moling_word.*
TO 'moling_word_app'@'localhost';

GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES
ON moling_word.*
TO 'moling_word_app'@'%';
```

说明：

- `SELECT/INSERT/UPDATE/DELETE`：业务读写需要。
- `CREATE/ALTER/INDEX/REFERENCES`：Prisma 迁移需要。
- 不给 `DROP`：避免应用账号误删整表。
- 不给全局权限：避免影响其他数据库。
- 同机部署可只用 `'moling_word_app'@'localhost'`。
- 应用和 MySQL 不在同一台机器时，需要 `'moling_word_app'@'%'` 或更精确的应用服务器 IP。

开发阶段如果你经常重建表，可以临时给 `DROP`，但不建议长期保留。

## 五、第一版核心表

当前设计了 6 张表。

### 1. documents

文档主表。

用于保存：

- 文档标题
- 文档类型
- 写作语气
- 大纲 JSON
- 正文内容
- 文档状态
- 字数
- 创建时间
- 更新时间

后续所有文档都通过 `user_id` 绑定用户。

本地开发阶段默认：

```text
local-dev-user
```

正式接入墨灵平台后改为墨灵 `user_id`。

### 2. document_versions

文档版本表。

用于保存：

- 自动保存版本
- 手动保存版本
- AI 生成后的版本
- 导出前版本

方便后续恢复文档历史。

### 3. document_templates

文档模板表。

用于保存：

- 工作总结模板
- 会议纪要模板
- 商业计划书模板
- 合同协议模板
- 论文材料模板

第一版可以先放系统模板，后续再做用户自定义模板。

### 4. files

文件索引表。

实际文件放在 MinIO，这张表只保存：

- 文件名
- 文件大小
- 文件类型
- bucket
- object key
- 文件用途

用途包括：

```text
upload
export
image
```

### 5. ai_request_logs

AI 请求日志表。

用于：

- 排查 AI 调用失败
- 统计用户使用情况
- 记录模型名称
- 记录输入输出 token
- 后续和墨灵平台计费对账

### 6. molin_user_sessions

墨灵用户会话表。

正式接入墨灵 SSO 后使用。

用于保存：

- 墨灵 user_id
- app_id
- product_id
- 本地 session token 哈希
- 过期时间

注意：不保存 session token 明文。

## 六、后续可能增加的表

等功能复杂后，可以再增加：

### 1. document_exports

如果导出记录越来越复杂，可以单独拆导出表。

保存：

- 导出格式
- 导出状态
- 导出文件 ID
- 导出耗时
- 错误信息

### 2. billing_events

如果需要在本应用内记录墨灵平台计费结果，可以增加计费事件表。

保存：

- usage_type
- idempotency_key
- billing_mode
- amount
- platform_record_id
- status

### 3. document_assets

如果后续文档内有大量图片、附件、表格资源，可以单独维护文档资源表。

## 七、当前建议

当前阶段建议先创建：

```text
数据库：moling_word
用户：moling_word_app
密码：你自己生成一个强密码
```

然后先使用以下表：

- documents
- document_versions
- document_templates
- files
- ai_request_logs
- molin_user_sessions

第一版不需要太复杂，先把“文档保存、AI 记录、文件索引”跑通即可。
