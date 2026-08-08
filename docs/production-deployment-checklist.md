# AI Word 文档助手生产部署与验收清单

## 一、发布前门禁

```bash
npm ci
npm run check:commercial-readiness
```

要求 Node.js 满足 `package.json.engines`。禁止携带 `.env`、本地日志、截图、测试压缩包、`node_modules` 或 `dist` 历史目录进入源码提交。

## 二、生产配置

- `APP_ENV=production`。服务端会强制要求墨灵会话并关闭本地模拟。
- `SESSION_COOKIE_SECURE=true`，`APP_BASE_URL` 使用 HTTPS。
- 数据库、MinIO、墨灵内部 API、模型网关配置均不得使用占位值。
- `MOLING_API_BASE_URL`、`LLM_API_URL`、`STORAGE_ENDPOINT` 使用 HTTPS；只有受控内网链路才可显式设置 `ALLOW_INSECURE_INTERNAL_HTTP=true`。
- `BILLING_RECONCILIATION_OUTBOX` 使用持久卷绝对路径，并纳入容量、写入失败和积压告警。
- `TRUSTED_ORIGINS` 只填写额外可信前端 Origin，逗号分隔；默认信任 `APP_BASE_URL`。
- `AI_MAX_CONCURRENT_REQUESTS` 设置单实例模型请求上限；网关层仍需按用户和 IP 配置限流。

生产配置不完整时 `server/index.js` 会在监听端口前直接退出，错误只列缺失项，不打印密钥值。

## 三、数据库与模板

以下操作会修改目标数据库，必须由部署人员在确认备份、目标环境和回滚方案后执行：

```bash
npm run db:migrate:document-template
npm run db:migrate:document-page-layout
npm run db:migrate:billing-reconciliation
npm run db:seed:templates
```

执行后检查：

- `document_templates` 仅启用已审核模板，正文骨架包含元数据、编制说明、正式章节和行动表。
- `billing_reconciliation_tasks` 包含 `operation_type`、`claim_token` 和唯一幂等键。
- MinIO bucket 可读写，前端无法看到 bucket、object key 或访问密钥。

## 四、真实链路验收

必须使用专用测试用户和可核对的积分账户完成，区分“代码通过”和“平台真实验收”：

1. 从墨灵平台入口换取会话，直接访问生产 AI 接口应返回 401。
   同时确认 `/api/health` 返回 200，`/api/ready` 在数据库、MinIO 和模型网关均可用时返回 200。
2. 记录调用前积分，运行文档智能体，确认需求分析、启用模板匹配、结构生成、质量审校四阶段完成。
3. 确认成功调用只结算一次；同一幂等键重放不重复扣费。
4. 使用余额不足账户确认返回 402，且不返回大纲、正文、润色或模板规划结果。
5. 人为制造模型失败，确认返回 503、预占被释放；释放或结算响应不确定时生成对账任务。
6. 导入包含标题、表格、图片的 DOCX，编辑后导出；在 Microsoft Word 中确认标题与各级标题为规范黑色、正文与行内自定义颜色不被误改。
7. 在 390px、平板和桌面宽度检查模板库、智能体结果和编辑器，不应横向溢出，所有按钮均有明确反馈。

## 五、对账与回滚

```bash
npm run billing:reconcile:import-outbox
npm run billing:reconcile:list
npm run billing:reconcile:retry
```

- 先导入 outbox，再查看和重试；脚本使用原幂等键，租约令牌阻止过期进程覆盖新结果。
- 达到最大次数后进入 `manual_review`，禁止自动释放或手工修改额度表。
- 回滚应用版本不回滚用户文档或计费账本；数据库结构采用向后兼容新增表/列，回滚前先验证旧版本可忽略新结构。

完成以上真实链路并保存证据后，才能把该版本标记为生产可用。
