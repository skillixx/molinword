# AI Word 文档助手生产部署与验收清单

## 一、发布前门禁

```bash
npm ci
npm run check:commercial-readiness
```

要求 Node.js 满足 `package.json.engines`。禁止携带 `.env`、本地日志、截图、测试压缩包、`node_modules` 或 `dist` 历史目录进入源码提交。

仓库同时提供以下可审计部署基线：

- `ops/nginx/*`：HTTPS、统一安全响应头、反向代理、带重试头的限流与 SPA 回退。
- `ops/systemd/molinword-api.service`：运行配置预检、故障重启、优雅退出与最小写目录。
- `ops/systemd/molinword-reconcile.*`：待对账 outbox 导入和幂等重试定时任务。
- `ops/systemd/molinword-ai-audit-retention.*`：按批准保留期分批清理 AI 审计元数据。
- `ops/env/molinword.production.env.example`：不含真实密钥的生产变量清单。
- `.github/workflows/commercial-readiness.yml`：拉取请求与主分支商业门禁。

安装、验收和回滚命令见 `ops/README.md`。`npm run check:deployment-assets` 只验证这些资产的契约完整性，不证明它们已部署到目标服务器。

## 二、生产配置

- `APP_ENV=production`。服务端会强制要求墨灵会话并关闭本地模拟。
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
- `AI_AUDIT_CONTENT_MODE=metadata`，只保存请求关联、摘要和统计信息；生产门禁禁止完整提示词和模型回复落库。
- `AI_AUDIT_RETENTION_DAYS` 必须为 1 至 365 天并经业务、隐私与合规审批；`AI_AUDIT_CLEANUP_BATCH_SIZE`、`AI_AUDIT_CLEANUP_MAX_BATCHES` 控制单轮删除规模。

生产配置不完整时 `server/index.js` 会在监听端口前直接退出，错误只列缺失项，不打印密钥值。
发布目录切换前应在目标环境加载 `/etc/molinword/molinword.env` 后运行 `npm run check:runtime-config -- --require-production`，不得把变量值展开到命令行参数或日志。

## 三、数据库与模板

以下操作会修改目标数据库，必须由部署人员在确认备份、目标环境和回滚方案后执行：

目标服务器使用 `ops/README.md` 中加载 systemd `EnvironmentFile` 的维护单元逐项执行迁移和模板初始化，不要在 shell 中 `source` 密钥文件。

执行后检查：

- `document_templates` 仅启用已审核模板，正文骨架包含元数据、编制说明、正式章节和行动表。
- `billing_reconciliation_tasks` 包含 `operation_type`、`claim_token` 和唯一幂等键。
- `ai_request_logs` 包含请求 ID、SHA-256、字符数与创建时间索引；先执行 `db:migrate:ai-audit-privacy`，再经批准单独执行 `ai-audit:redact-existing` 清理历史原文。
- MinIO bucket 可读写，前端无法看到 bucket、object key 或访问密钥。

## 四、真实链路验收

必须使用专用测试用户和可核对的积分账户完成，区分“代码通过”和“平台真实验收”：

1. 从墨灵平台入口换取会话，直接访问生产 AI 接口应返回 401。
   同时确认 `/api/health` 返回 200，`/api/ready` 会实际探测数据库、MinIO 和模型网关且均可用时返回 200，并确认响应带服务端生成的合法 `X-Request-Id`。
2. 使用无效 JSON 和不存在的 `/api/*` 路由确认分别返回规范 JSON 400/404；连续超过 AI 限额时返回 429、`Retry-After` 和 `RateLimit-*` 响应头。
3. 记录调用前积分，运行文档智能体，确认需求分析、启用模板匹配、结构生成、质量审校四阶段完成。
4. 确认成功调用只结算一次；同一幂等键重放不重复扣费。
5. 使用余额不足账户确认返回 402，且不返回大纲、正文、润色或模板规划结果。
6. 人为制造模型失败，确认返回 503、预占被释放；释放或结算响应不确定时生成对账任务。
7. 导入包含标题、表格、图片的 DOCX，编辑后导出；在 Microsoft Word 中确认标题与各级标题为规范黑色、正文与行内自定义颜色不被误改。
8. 在 390px、平板和桌面宽度检查模板库、智能体结果和编辑器，不应横向溢出，所有按钮均有明确反馈。
9. 发起一次 AI 请求，使用 `X-Request-Id` 关联访问日志和 `ai_request_logs.request_id`；确认 `prompt`、`response` 为空，摘要和字符数存在，且日志不含密钥或客户正文。

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

完成以上真实链路并保存证据后，才能把该版本标记为生产可用。
