# 文档智能体商业化使用说明

## 一、能力定位

文档智能体不是聊天演示，而是模板库中的可执行创建入口。用户输入交付需求后，服务端依次完成：

1. 需求分析模型：识别文档用途、交付对象、优先级和约束。
2. 模板匹配工具：从 MySQL `status='active'` 白名单评分选择，模型不能启用或编造模板。
3. 结构设计模型：生成 4 到 10 个正式章节和编制要求。
4. 质量审校模型：检查结构完整性、事实边界和行业风险；未通过时触发一次结构返修并重新审校。

用户点击“采用方案并创建文档”后，会真实写入 `documents` 表并进入编辑器，不是只在页面展示结果。

## 二、正式模板结构

系统模板正文包含：

- 文档主题、版本、适用对象、建议篇幅、编制人与日期元数据表。
- 编制说明和行业风险提示。
- 黑色规范标题、章节填写提示、首行缩进和分页控制。
- 计划、任务、行动项类章节的负责人、期限和验收字段。

模板封面可以使用行业配色，Word 文档标题和各级标题固定为黑色。手动设置的正文行内颜色仍会保留。

## 三、接口契约

运行智能体：

```text
POST /api/ai/template-agent
```

请求只包含用户需求和公开模板描述，不包含 MinIO 的 `bucket`、`object_key` 或任何密钥。主要字段：

```json
{
  "brief": "为产品上线评审会生成正式会议纪要，需要记录结论、责任人和完成期限。",
  "audience": "项目负责人和管理层",
  "expectedPages": "3-6页",
  "candidates": []
}
```

返回 `plan`，包含推荐模板、正式标题、章节结构、匹配度、质量清单和四阶段真实执行轨迹。模型返回会经过白名单、长度、数量、模板归属和分数边界校验。没有数据库的本地开发模式才使用浏览器候选模板；商业环境始终以 MySQL 启用模板为准。

## 四、模型与开源运行时

服务端复用 OpenAI `chat/completions` 兼容 HTTP 契约，不绑定特定厂商。可接入云端模型，也可以把 `LLM_API_URL` 指向企业自行部署的兼容网关或开源模型运行时。

```env
LLM_API_URL=http://your-model-gateway.example/v1/chat/completions
LLM_API_KEY=replace-with-server-side-key
LLM_MODEL=your-approved-model
```

候选运行时必须在上线前自行验证以下契约：

- 支持 `model`、`messages`、`temperature` 请求字段。
- 返回 OpenAI 兼容的文本响应。
- 能稳定输出严格 JSON 中文结构。
- 具备超时、并发、审计、数据留存和内容安全策略。

本项目不把模型密钥发送到浏览器，也不要求引入额外 Agent 框架。后续如接入开源编排框架，应保持现有 API 返回结构和积分预占/结算边界。

生产环境必须设置 `AI_AUDIT_CONTENT_MODE=metadata`。智能体审计只保存 `X-Request-Id` 对应请求 ID、固定动作枚举、模型、状态、耗时、Unicode 字符数和由专用 `AI_AUDIT_HASH_KEY` 生成的 HMAC-SHA256 指纹，不保存用户需求、文档正文或模型原文。保留期限由 `AI_AUDIT_RETENTION_DAYS` 配置，并通过 `molinword-ai-audit-retention.timer` 分批清理；历史正文脱敏属于不可逆维护操作，必须先备份并审批。

## 五、计费与降级

- 使用类型：`word_template_agent`
- 单次费用：2 积分
- 流程：预占积分 -> 规划成功 -> 使用同一幂等键结算；结算响应不确定时进入待对账状态，绝不盲目释放。
- 结算和释放响应不确定时都持久化在 `billing_reconciliation_tasks`；通过 `billing:reconcile:list` 查询，通过 `billing:reconcile:retry` 使用原幂等键重试对应操作，达到次数上限后转人工复核。
- 数据库暂时不可写时，任务降级追加到 `BILLING_RECONCILIATION_OUTBOX` JSONL 文件；生产必须把该路径放到持久卷并纳入告警与审计，可用 `billing:reconcile:import-outbox` 幂等导入后再重试。
- 本地开发用户未配置模型时，使用确定性模板匹配和正式结构生成，并把四阶段明确标记为“本地规则兜底”。
- 墨灵用户发生积分预占、模型或质量门禁失败时返回非 2xx，并释放预占积分，不返回免费完整方案。
- `APP_ENV=production` 时服务端强制要求墨灵会话并关闭本地身份模拟；仍应显式配置 `REQUIRE_MOLING_SESSION=true`，避免部署语义不清。

## 六、上线验收

```bash
npm run build
npm run check:template-agent
npm run check:template-agent-api
npm run check:template-agent-ui
npm run check:docx-export-format
npm run check:ai-audit-privacy
npm run check:production-acceptance
npm run check:production-acceptance-finalization
npm run db:seed:templates
```

`check:template-agent-api` 使用自包含的 OpenAI 兼容模型服务，验证需求分析、结构设计、质量审校三次真实模型调用和模板匹配工具阶段。`check:template-agent-ui` 同时在 1440px 桌面和 390px 窄屏执行完整流程：输入需求、查看四阶段结果、采用方案、创建文档、打开编辑器，并检查元数据表、正式章节和 Word 导出。`check:production-acceptance` 验证生产证据采集器的制品版本绑定、批准域名与公网 DNS 绑定、脱敏、超时、失败关闭和不可覆盖契约；`check:production-acceptance-finalization` 验证最新预检不可回退、十项人工证据附件哈希、按发布授权、独立 HMAC 签名、追加式批准和附件改动检测。目标环境仍须执行真实 SSO、HTTP 契约、四阶段智能体、积分、Word、多设备、审计和回滚验收，再通过最终验收 systemd 单元生成 `approved` 记录。数据库与 MinIO 的真实连接仍需在目标环境单独验收。
