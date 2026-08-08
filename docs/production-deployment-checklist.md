# AI Word 文档助手生产部署与验收清单

## 一、发布前门禁

```bash
npm ci
npm run check:commercial-readiness
```

要求 Node.js 满足 `package.json.engines`。禁止携带 `.env`、本地日志、截图、测试压缩包、`node_modules` 或 `dist` 历史目录进入源码提交。

仓库同时提供以下可审计部署基线：

- `ops/nginx/*`：HTTPS、统一安全响应头、反向代理、带重试头的限流、SPA 回退与性能预算一致的 JS/CSS gzip。
- `ops/systemd/molinword-api.service`：运行配置预检、故障重启、优雅退出与最小写目录。
- `ops/systemd/molinword-reconcile.*`：待对账 outbox 导入和幂等重试定时任务。
- `ops/systemd/molinword-ai-audit-retention.*`：按批准保留期分批清理 AI 审计元数据。
- `ops/env/molinword.production.env.example`：不含真实密钥的生产变量清单。
- `.github/workflows/commercial-readiness.yml`：拉取请求与主分支商业门禁；在完整代码门禁后安装受控 LibreOffice/Poppler/Noto CJK 环境，将正式模板真实渲染为 PDF 和逐页 PNG，检查黑色标题、关键文字、A4 页面、非空页面、绿色像素和安全页边界，并上传短期视觉证据 artifact。
- `scripts/check-frontend-performance-budget.mjs`：基于 Vite manifest 校验初始 JS/CSS gzip 闭包、单块大小与资源请求总数，防止首屏资产无界增长。
- `ops/release-target.json` 与 `dist/THIRD_PARTY_LICENSES.txt`：显式绑定 Linux x64 glibc 发布目标，并按锁文件生成该目标生产依赖的许可证、版权和 NOTICE 全文；发布切换前必须确认目标一致且文件非空。
- 产品侧栏“开源许可”必须能打开当前版本 `/THIRD_PARTY_LICENSES.txt`；生产 Nginx 为该精确路径返回安全头、UTF-8 字符集和 `Cache-Control: no-store`，不得向用户返回乱码或长期缓存旧版声明。
- 受保护生产发布工作流：无密钥 `package` job 在完整商业门禁后生成固定顶层目录的生产 `tar.gz`、传输 SHA-256 与内部逐文件清单；隔离 `sign` job 经审批后只用系统 OpenSSL 生成独立签名。服务器必须用预置公钥做解压前归档复验，并在全新 staging 中做解压后完整文件集复验，拒绝 `.env`、`.npmrc`、日志、截图、`node_modules`、链接或开发缓存。
- `.github/workflows/production-release.yml`：仅允许从 main 手动启动；无密钥 `package` job 先重跑完整商业门禁和 LibreOffice Word 视觉门禁，上传逐页视觉证据及归档/摘要二件套；全新的 `sign` runner 随后进入受保护 `production-release` Environment，经批准后只下载同次运行的二件套并用系统 OpenSSL 签名，不 checkout 或执行仓库代码。required reviewer 必须在批准前下载 `molinword-docx-visual-<git-sha>` artifact，以 100% 缩放查看全部 PNG 页面和 JSON 报告；reviewer 与 Environment secret 是 GitHub 外部配置，首次正式发布前必须另行审计确认。
- `scripts/check-release-target.mjs`：候选版本切换前在目标服务器验证操作系统、CPU 架构与 glibc，避免许可证包和实际安装平台不一致。

安装、验收和回滚命令见 `ops/README.md`。`npm run check:deployment-assets` 只验证这些资产的契约完整性，不证明它们已部署到目标服务器。

## 二、生产配置

- `APP_ENV=production`。服务端会强制要求墨灵会话并关闭本地模拟。
- `npm run build` 生成 `dist/release-manifest.json`，发布号由 Git 提交与实际前后端制品哈希共同派生；目标目录名、验收命令和健康检查必须使用该发布号，不能通过环境变量手工覆盖。
- `SESSION_COOKIE_SECURE=true`，`APP_BASE_URL` 使用 HTTPS。
- 数据库、MinIO、墨灵内部 API、模型网关配置均不得使用占位值。
- `MOLING_API_BASE_URL`、`LLM_API_URL`、`STORAGE_ENDPOINT` 使用 HTTPS；只有受控内网链路才可显式设置 `ALLOW_INSECURE_INTERNAL_HTTP=true`。
- `BILLING_RECONCILIATION_OUTBOX` 使用持久卷绝对路径，并纳入容量、写入失败和积压告警。
- `TRUSTED_ORIGINS` 只填写额外可信前端 Origin，逗号分隔；默认信任 `APP_BASE_URL`。
- `APP_HOST` 默认监听 `127.0.0.1`；如需容器或独立网络监听，必须同步收紧安全组和反向代理入口。
- `TRUSTED_PROXY_HOPS` 必须与实际反向代理层数一致；无代理为 `0`，单层 Nginx 通常为 `1`，避免伪造客户端 IP 绕过限流。
- `RATE_LIMIT_WINDOW_MS`、`API_RATE_LIMIT_MAX` 和 `AI_RATE_LIMIT_MAX` 设置单实例 IP 限流；网关层仍需配置按用户、IP 和总量的多层限流。
- `AI_MAX_CONCURRENT_REQUESTS` 设置单实例模型并发上限；客户端断开不会提前释放仍在执行的模型槽位。
- `LLM_READINESS_URL` 留空时从 `LLM_API_URL` 推导 OpenAI 兼容 `/models` 地址；自定义时必须使用验证同一凭据且不产生模型用量的 HTTPS 接口。
- `LLM_MODEL` 必须填写模型网关实际允许的模型名，生产门禁会拒绝空值和占位值。
- `MOLING_INTERNAL_TIMEOUT_MS` 必须覆盖墨灵 SSO、预占、结算和释放的响应正文读取，避免平台仅返回响应头时永久挂起。
- `SHUTDOWN_TIMEOUT_MS` 应覆盖智能体最多五段模型调用、最多五次平台调用、模型重试与本地结算清理；生产配置门禁会按相关超时计算最小值。进程收到终止信号后先停止接收新请求，再等待在途请求完成。
- 生产环境默认启用最小化 JSON 访问日志，并通过 `X-Request-Id` 关联请求；日志不应采集 Cookie、查询串和请求体。
- `AI_AUDIT_CONTENT_MODE=metadata`，只保存请求关联、固定动作、HMAC 指纹和统计信息；`AI_AUDIT_HASH_KEY` 使用独立的至少 32 字符密钥并由密钥系统注入，生产门禁禁止完整提示词和模型回复落库。
- `AI_AUDIT_RETENTION_DAYS` 必须为 1 至 365 天并经业务、隐私与合规审批；`AI_AUDIT_CLEANUP_BATCH_SIZE`、`AI_AUDIT_CLEANUP_MAX_BATCHES` 控制单轮删除规模，`AI_AUDIT_REDACTION_BATCH_SIZE` 以独立小批次限制历史正文内存占用。

生产配置不完整时 `server/index.js` 会在监听端口前直接退出，错误只列缺失项，不打印密钥值。
发布目录切换前应在目标环境加载 `/etc/molinword/molinword.env` 后运行 `npm run check:runtime-config -- --require-production`，不得把变量值展开到命令行参数或日志。

## 三、数据库与模板

以下操作会修改目标数据库，必须由部署人员在确认备份、目标环境和回滚方案后执行：

目标服务器使用 `ops/README.md` 中加载 systemd `EnvironmentFile` 的维护单元逐项执行迁移和模板初始化，不要在 shell 中 `source` 密钥文件。

执行后检查：

- `document_templates` 仅启用已审核模板，正文骨架包含元数据、编制说明、正式章节和行动表。
- `billing_reconciliation_tasks` 包含 `operation_type`、`claim_token` 和唯一幂等键。
- `ai_request_logs` 包含请求 ID、HMAC-SHA256 指纹、字符数与创建时间索引；先执行 `db:migrate:ai-audit-privacy`，再经批准单独执行 `ai-audit:redact-existing` 清理历史原文。
- MinIO bucket 可读写，前端无法看到 bucket、object key 或访问密钥。

## 四、真实链路验收

必须使用专用测试用户和可核对的积分账户完成，区分“代码通过”和“平台真实验收”：

先采集不携带会话或业务正文的自动预检证据：

```bash
cd /opt/molinword/current
sudo systemctl start 'molinword-acceptance@<release-id>.service'
sudo systemctl status 'molinword-acceptance@<release-id>.service' --no-pager
sudo ls -lt /var/lib/molinword-acceptance/<release-id>-*.json
```

专用 systemd 单元从受保护的环境文件读取 `APP_BASE_URL`。采集器要求目标与该地址完全一致，拒绝 IP、私网、回环、链路本地、公私混合解析和 DNS 重绑定，并校验 HTTPS、HTML 入口及 `no-store` 缓存策略、安全响应头、`APP_ENV=production`、运行时制品清单发布号与实例发布号一致、强制会话、MySQL/MinIO/模型就绪、JSON 404、无副作用 AI 认证端点 401 和服务端请求 ID。它只保存白名单布尔值、状态码、安全响应头和请求 ID，单个 JSON 正文最多读取 64 KiB，超时、异常状态、制品不符或缺失头部都会失败关闭。自动通过只会得到 `releaseDecision=manual-approval-required`，不能替代以下真实账号、账本、Word 和人工签字验收。

1. 从墨灵平台入口换取会话，直接访问生产 AI 接口应返回 401。
   同时确认 `/api/health` 返回 200，`/api/ready` 会实际探测数据库、MinIO 和模型网关且均可用时返回 200，并确认响应带服务端生成的合法 `X-Request-Id`。
2. 使用无效 JSON 和不存在的 `/api/*` 路由确认分别返回规范 JSON 400/404；连续超过 AI 限额时返回 429、`Retry-After` 和 `RateLimit-*` 响应头。
3. 记录调用前积分，运行文档智能体，确认需求分析、MySQL `status='active'` 白名单模板匹配、结构设计、质量审校四阶段完成。
4. 确认成功调用只结算一次；同一幂等键重放不重复扣费。
5. 使用余额不足账户确认返回 402，且不返回大纲、正文、润色或模板规划结果。
6. 人为制造模型失败，确认返回 503、预占被释放；释放或结算响应不确定时生成对账任务。
7. 导入包含标题、表格、图片的 DOCX，编辑后导出；在 Microsoft Word 中确认标题与各级标题为规范黑色、正文与行内自定义颜色不被误改。
8. 在 390px、平板和桌面宽度检查模板库、智能体结果和编辑器，不应横向溢出，所有按钮均有明确反馈。
9. 发起一次 AI 请求，使用 `X-Request-Id` 关联访问日志和 `ai_request_logs.request_id`；确认 `prompt`、`response` 为空，摘要和字符数存在，且日志不含密钥或客户正文。
10. 切换到上一份制品并等待在途请求结束，确认 `/api/health` 自动回显上一制品清单中的发布号，随后恢复当前版本并保存时间线。

将十项脱敏证据放入独立验收用户专属的 `/var/lib/molinword-acceptance/<release-id>-evidence/`，按 `ops/acceptance/manual-acceptance.example.json` 生成 `<release-id>-manual.json`；长期运行的 API 用户不能访问这个 0700 目录。人工清单必须填写授权审批人、变更单号、晚于最新自动预检的 UTC 批准时间、最新预检 SHA-256 和每个附件 SHA-256；JSON 仅允许固定字段，附件必须为当前发布号目录内的非空常规文件。摘要应在审批人完成内容复核后用服务器 `sha256sum` 计算，避免路径相同但内容已被替换。最后计算整份人工清单 SHA-256，由变更流程按 `ops/acceptance/authorization.example.json` 签发 root-only 短期授权凭据，精确绑定同一发布号、审批人、变更单、预检摘要和人工清单摘要，有效期不得超过七天。

```bash
sudo systemctl start 'molinword-acceptance-finalize@<release-id>.service'
sudo systemctl start 'molinword-acceptance-verify@<release-id>.service'
sudo systemctl status 'molinword-acceptance-verify@<release-id>.service' --no-pager
```

最终验收会绑定最新成功预检、root 管理的短期授权、人工清单和每个附件的 SHA-256，并使用 API 无权读取的独立 systemd credential 生成 HMAC-SHA256。只读复核会重新选择当前最新预检并读取所有原始证据；任何文件被改动、批准后出现更新预检、最新预检失败、检查缺失、授权不匹配或签名不匹配都必须失败关闭。

## 五、对账与回滚

```bash
sudo systemctl start 'molinword-maintenance@billing:reconcile:import-outbox.service'
sudo systemctl start 'molinword-maintenance@billing:reconcile:list.service'
sudo systemctl start 'molinword-maintenance@billing:reconcile:retry.service'
```

- 先导入 outbox，再查看和重试；脚本使用原幂等键，租约令牌阻止过期进程覆盖新结果。
- 达到最大次数后进入 `manual_review`，禁止自动释放或手工修改额度表。
- 回滚应用版本不回滚用户文档或计费账本；数据库结构采用向后兼容新增表/列，回滚前先验证旧版本可忽略新结构。
- 历史 AI 正文脱敏和过期日志删除不可回滚；执行前必须确认备份、目标库、保留期限审批和影响范围。

完成以上真实链路、取得 `releaseDecision=approved` 的追加式签名记录、通过只读附件复核并由业务验收人在变更单签字后，才能把该版本标记为生产可用。
