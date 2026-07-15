# molinword

AI Word 文档助手，面向单人日常写作场景，支持 AI 生成大纲、生成正文、局部润色编辑、文档保存、Word 导出、MinIO 文件存储，以及墨灵平台 SSO 和积分计费。

## 本地启动

```bash
npm install
npm run api
npm run dev
```

默认访问地址：

- 前端：http://127.0.0.1:5188
- 后端：http://127.0.0.1:3001/api/health

## 环境变量

复制 `.env.example` 为 `.env`，然后按实际环境填写：

- `MOLING_API_BASE_URL`：墨灵平台接口地址。
- `INTERNAL_API_TOKEN`：墨灵平台内部接口 token，只能放在服务端。
- `APP_PORT`：应用端口，当前前端固定使用 `5188`。
- `LOCAL_API_PORT`：本地后端 API 端口，未配置时默认 `3001`。
- `MOLING_APP_ID`：墨灵平台应用 ID。
- `MOLING_PRODUCT_ID`：墨灵平台商品 ID。
- `LOCAL_MOLING_MOCK`：是否启用本地墨灵模拟模式。
- `LLM_API_URL`：DeepSeek 或墨灵 token 网关的 chat/completions 地址。
- `LLM_API_KEY`：AI 模型密钥，只能放在服务端。
- `LLM_MODEL`：模型名称，例如 `deepseek-chat` 或平台网关支持的模型名。
- `DATABASE_URL`：MySQL 连接串。
- `STORAGE_ENDPOINT`：MinIO 服务地址。
- `STORAGE_BUCKET`：MinIO bucket 名称。
- `STORAGE_ACCESS_KEY_ID`：MinIO access key。
- `STORAGE_SECRET_ACCESS_KEY`：MinIO secret key。

## MySQL 初始化

使用 root 执行初始化脚本：

```bash
mysql -h172.16.10.151 -P13306 -uroot -p < database/init-mysql.sql
```

脚本会创建：

- 数据库：`moling_word`
- 应用用户：`moling_word_app`
- 默认密码：`MolingWordApp_123`
- 核心业务表：`documents`、`document_versions`、`document_templates`、`files`、`ai_request_logs`、`molin_user_sessions`

对应连接串示例：

```env
DATABASE_URL=mysql://moling_word_app:MolingWordApp_123@172.16.10.151:13306/moling_word
```

初始化或更新系统模板：

```bash
npm run db:seed:templates
```

模板库前端默认从后端 `GET /api/templates` 读取启用模板；接口不可用时会使用本地兜底模板并显示中文提示。

模板素材初始化会上传封面和 Word 样式到 MinIO，并在 `files` 表中保存索引：

```text
templates/{templateId}/cover/{fileName}
templates/{templateId}/styles/{fileName}
templates/{templateId}/assets/{fileName}
templates/{templateId}/examples/{fileName}
```

第一版复用 `files` 表管理模板素材：

- `template_id`：关联 `document_templates.id`。
- `document_id`：模板素材为空。
- `purpose`：`template_cover`、`template_style`、`template_asset`。
- `bucket`、`object_key`：只保存在服务端数据库中，前端通过后端接口访问，不暴露 MinIO 密钥。

## MinIO 配置

需要准备一个可写 bucket，例如：

```env
STORAGE_ENDPOINT=http://172.16.10.151:19000
STORAGE_BUCKET=moling-word
STORAGE_ACCESS_KEY_ID=你的_access_key
STORAGE_SECRET_ACCESS_KEY=你的_secret_key
```

导出的 Word 文件会写入：

```text
documents/{documentId}/exports/{fileName}.docx
```

## 墨灵平台配置

应用建议配置：

- 应用代码：`ai_word_assistant`
- 应用名称：`AI Word 文档助手`
- 应用类型：`application`
- 适配器类型：`external`
- 回调地址：`http://8.130.9.163:5188/molin/launch`
- 支持动作：`["provision","cancel"]`

商品建议配置：

- 商品代码：`ai_word_assistant_points`
- 商品名称：`AI Word 文档助手积分包`
- 计费模式：积分预付费

## 积分计费规则

当前接口按动作扣减积分：

- 生成大纲：`word_outline_generate`，1 积分
- 生成正文：`word_body_generate`，5 积分
- 局部润色/续写/扩写/缩写/纠错：`word_polish`，2 积分
- 导出 Word：`word_export_docx`，1 积分

服务端采用“预占积分 -> 动作成功 -> 结算积分”的流程；动作失败会释放预占积分。

## 生产部署注意事项

- 不要提交 `.env`。
- AI 密钥、墨灵 `INTERNAL_API_TOKEN`、MinIO 密钥只能放在服务端。
- 前端不要硬编码真实密钥。
- 生产环境建议启用 HTTPS，并把 `SESSION_COOKIE_SECURE=true`。
- 后端接口错误只返回中文用户提示，真实错误保留在服务端日志。
- 文档、导出文件下载都按当前用户校验，避免跨用户访问。

## 构建验证

```bash
npm run build
npm run check:editor-pagination
npm run check:docx-export-format
npm run check:docx-import-format
```

`check:editor-pagination` 会启动自包含的浏览器测试，验证 A4 分页、超长列表项、超高表格行、图片单元格、模板样式恢复、移动端宽度以及长文档滚动时三侧菜单保持可见。
