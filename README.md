# molinword

AI Word 文档助手，面向个人和企业正式文档场景，支持文档智能体规划、正式模板匹配、AI 生成大纲与正文、局部润色编辑、文档保存、Word 导出、MinIO 文件存储，以及墨灵平台 SSO 和积分计费。

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
- `REQUIRE_MOLING_SESSION`：默认设为 `true`；仅本地直连调试时改为 `false`。`APP_ENV=production` 时服务端会强制启用门禁。
- `APP_BASE_URL`：生产站点的 HTTPS 根地址，用于会话与来源校验。
- `TRUSTED_PROXY_HOPS`：可信反向代理层数；单层 Nginx 通常设为 `1`。
- `LLM_API_URL`：DeepSeek 或墨灵 token 网关的 chat/completions 地址。
- `LLM_READINESS_URL`：使用同一凭据且不产生模型用量的模型就绪探测地址；留空时按 OpenAI 兼容接口推导 `/models`。
- `LLM_API_KEY`：AI 模型密钥，只能放在服务端。
- `LLM_MODEL`：模型名称，例如 `deepseek-chat` 或平台网关支持的模型名。
- `MOLING_INTERNAL_TIMEOUT_MS`：墨灵内部接口（含响应正文读取）的超时时间。
- `BILLING_RECONCILIATION_OUTBOX`：数据库暂不可写时保存待对账记录的持久卷绝对路径。
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

脚本会创建数据库和业务表，但不会创建带默认密码的生产账号。请通过部署系统或 MySQL 管理员创建应用账号，并使用密钥管理服务保存强密码：

```sql
CREATE USER 'moling_word_app'@'应用服务器网段' IDENTIFIED BY '由密钥管理服务生成的强密码';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES
  ON moling_word.* TO 'moling_word_app'@'应用服务器网段';
```

核心业务表包括 `documents`、`document_versions`、`document_templates`、`files`、`ai_request_logs`、`billing_reconciliation_tasks` 和 `molin_user_sessions`。连接串只写入服务端 `.env`：

```env
DATABASE_URL=mysql://moling_word_app:replace-with-strong-password@127.0.0.1:3306/moling_word
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

- 文档智能体规划：`word_template_agent`，2 积分
- 生成大纲：`word_outline_generate`，1 积分
- 生成正文：`word_body_generate`，5 积分
- 局部润色/续写/扩写/缩写/纠错：`word_polish`，2 积分
- 导出 Word：`word_export_docx`，1 积分

服务端采用“预占积分 -> 动作成功 -> 结算积分”的流程；动作失败会释放预占积分。
若结算或释放请求已发出但平台响应状态不确定，服务端会把操作类型、`hold_id`、原幂等键和应结算金额写入 `billing_reconciliation_tasks`，不会盲目执行相反操作。数据库写入失败时会降级写入 `BILLING_RECONCILIATION_OUTBOX` 指向的 JSONL 持久卷。部署历史数据库后先执行：

```bash
npm run db:migrate:billing-reconciliation
```

值班人员可只读查看或使用原幂等键安全重试：

```bash
npm run billing:reconcile:list
npm run billing:reconcile:import-outbox
npm run billing:reconcile:retry
```

## 生产部署注意事项

- 不要提交 `.env`。
- AI 密钥、墨灵 `INTERNAL_API_TOKEN`、MinIO 密钥只能放在服务端。
- 前端不要硬编码真实密钥。
- 生产环境建议启用 HTTPS，并把 `SESSION_COOKIE_SECURE=true`。
- 生产环境设置 `APP_ENV=production` 后会强制要求墨灵会话并禁用 `LOCAL_MOLING_MOCK`；同时建议保留 `REQUIRE_MOLING_SESSION=true`，形成显式双重门禁。
- 后端接口错误只返回中文用户提示，真实错误保留在服务端日志。
- 生产 AI 审计强制使用 `AI_AUDIT_CONTENT_MODE=metadata`，仅保存请求 ID、专用密钥生成的 HMAC-SHA256 指纹、字符数、状态与耗时；保留期由 `AI_AUDIT_RETENTION_DAYS` 控制。
- 工作台的 AI 操作记录只通过 `GET /api/ai/history` 读取当前用户的动作、状态、字符数、耗时和请求号；不查询或返回提示词、模型回复、HMAC、内部错误及模型标识。
- 文档、导出文件下载都按当前用户校验，避免跨用户访问。
- 生产启动会执行 fail-fast 配置校验；完整步骤见 `docs/production-deployment-checklist.md`。
- 可审计的 Nginx、systemd、环境变量、计费对账定时器和回滚步骤见 `ops/README.md`；样例不能替代真实域名、证书、密钥和目标环境授权。
- 开源依赖商业使用边界和许可证门禁见 `docs/open-source-commercial-use.md`。

## 构建验证

```bash
npm run check:commercial-readiness
npm run check:frontend-performance
npm run check:deployment-assets
npm run check:third-party-notices
npm run check:dev-license-notice
npm run check:ai-history
npm run check:ai-audit-schema-preflight
npm run build
npm run check:template-agent
npm run check:template-agent-api
npm run check:template-agent-ui
npm run check:editor-workflow
npm run check:docx-export-format
npm run check:docx-import-format
npm run check:docx-visual-render -- --self-test
npm run db:migrate:document-page-layout
npm run db:check:ai-audit-privacy
npm run db:migrate:ai-audit-privacy
```

`check:editor-workflow` 会启动自包含的浏览器测试，验证常用格式编辑、页眉页脚页码、快捷键保存、防并发保存、刷新重开、DOCX 下载与格式一致性，以及 A4 分页、超长结构、模板样式、移动端宽度和长文档固定菜单。原 `check:editor-pagination` 命令保留为兼容别名。

`check:docx-visual-render -- --self-test` 在本地生成正式商业模板夹具并校验标题黑色、六级标题样式和表格结构；PR 与正式发布 CI 还会安装 LibreOffice、Poppler 和 Noto CJK 字体，执行不带 `--self-test` 的真实 DOCX → PDF → PNG 渲染，拒绝空白页、绿色像素、缺失关键文字、非 A4 页面或越过安全页边界的内容，并上传逐页图像供审批人复核。

`check:frontend-performance` 会先生成 Vite manifest，再沿入口静态依赖计算初始 JavaScript/CSS gzip 闭包、单块大小和资源请求总数；其压缩级别与生产 Nginx 基线一致。React、图标、Tiptap 与 ProseMirror 使用独立长期缓存块，业务代码变化不再生成 800KB 以上单文件。

`check:ai-history` 通过真实 HTTP 接口验证 AI 操作记录按当前用户隔离、使用有界游标分页，并在成功、参数错误、未登录及旧数据库结构响应上禁用缓存。隐私迁移缺失时接口明确返回 503，生产就绪检查也会失败，禁止降级读取旧审计正文。桌面与 390px 浏览器回归还会验证刷新、加载更多和隐私字段不可见。

模板套用、智能体创建、手动保存、导入、重命名、复制、删除和 Word 导出成功后都会显示全局可访问通知；通知可手动关闭，并在 4 秒后自动消失。自动保存保持静默，避免持续编辑时反复打扰。`check:template-agent-ui` 与 `check:editor-workflow` 会通过真实浏览器验证关键成功反馈、关闭交互及 390px 不溢出。

`check:third-party-notices` 会验证所有已安装生产依赖都能形成许可证正文；`npm run build` 还会生成随发布物交付的 `dist/THIRD_PARTY_LICENSES.txt`。`check:dev-license-notice` 会启动真实 Vite 开发服务，确认同一路径返回 UTF-8 纯文本、完整正文与正确的 GET/HEAD/405 契约，避免 SPA 回退造成“能打开但内容其实是首页”的假成功。产品侧栏的“开源许可”入口会打开当前构建的许可证全文，桌面、折叠侧栏和 390px 窄屏行为由浏览器回归覆盖。项目自身仍为 `private: true`，该文件只履行第三方依赖告知义务，不授予 molinword 源码许可证。

历史数据库首次升级到页面设置功能时运行 `db:migrate:document-page-layout`。AI 审计升级前先运行只读的 `db:check:ai-audit-privacy`：它只查询 `information_schema`，不会修改数据，也不会输出数据库名、连接串或驱动原始错误；结构不完整时以非零状态列出缺失字段和索引。确认备份、目标库与变更授权后再运行 `db:migrate:ai-audit-privacy`，迁移后必须重新执行只读预检并达到退出码 0。历史 AI 正文只能在备份和隐私审批后显式运行 `ai-audit:redact-existing`，生产日常清理由 systemd 定时器执行。新数据库由 `database/init-mysql.sql` 直接创建对应字段。
