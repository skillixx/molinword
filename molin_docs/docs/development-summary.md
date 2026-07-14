# Development Summary

## 本次开发任务

本轮开发围绕魔灵平台 AI PPT 应用的真实接入和上线前联调问题收敛，目标是让 `ppt-ai-app/` 从本地业务闭环进一步具备可部署、可验收、可排查的生产接入基础。

## 已完成内容

- AI provider 接入增强：支持 DeepSeek/OpenAI-compatible `chat/completions` payload，按操作补充严格 JSON 输出约束，并兼容模型返回数组、直接 slide 对象、`reasoning_content` 等常见响应形态。
- 魔灵 SSO 入口兼容：支持 `/?ticket=...`、`/enter?ticket=...`、`/auth/launch?ticket=...` 三种启动路径，匹配魔灵 `access_url` 自动追加 ticket 的行为。
- 用户权益解析增强：优先使用启动身份中的权益，其次查询魔灵用户权益接口，再使用临时 `MOLING_USER_ENTITLEMENT_MAP`，最后才回退到 `MOLING_DEFAULT_ENTITLEMENT_ID`。
- 魔灵配置校验：新增 `npm run validate:moling-config`，用于校验手工配置的 `user_id:entitlement_id` 映射是否能通过魔灵余额接口读取。
- 扣费与错误提示修复：生成前检查套餐可用性和余额，失败路径释放预占积分，用户侧错误信息包含权益、余额和所需积分等可操作信息。
- PPT 生成与导出修复：补齐 PPTX 所需的 slide layout、slide master、theme、relationship 等结构，导出文件更接近 Office 可打开的标准结构。
- 单页重生成体验修复：支持按页码或 `slide_id` 定位，重生成后保留原 slide 的 `id` 和 `sortOrder`，避免引用关系漂移。
- 验收脚本增强：本地和真实魔灵验收脚本覆盖 SSO、模板、余额、AI 大纲、整稿生成、单页重生成、预览、PPTX/PDF 导出、下载日志和最终余额扣减。
- 文档补齐：更新部署、魔灵集成、AI provider、计费、用户流程、README 和环境变量说明，明确生产配置与临时回退策略。

## 关键命令

```bash
cd ppt-ai-app
npm test
npm run validate:moling-config
npm run acceptance
npm run acceptance:moling
```

`npm run validate:moling-config` 需要真实魔灵环境变量和 `MOLING_USER_ENTITLEMENT_MAP`。没有配置映射时命令返回 `skipped`，不代表真实权益联调已完成。

## 当前限制与上线注意

- 多用户生产环境不应长期依赖 `MOLING_DEFAULT_ENTITLEMENT_ID`，该变量只适合受控单用户冒烟。
- `MOLING_USER_ENTITLEMENT_MAP` 是魔灵用户权益查询接口未部署时的临时回退，生产优先使用平台接口返回的真实权益。
- 真实联调验收必须使用一次性 `ACCEPTANCE_LAUNCH_TICKET`，旧 ticket 刷新或复用会返回魔灵票据错误。
- 直连 HTTP 测试环境需要 `SESSION_COOKIE_SECURE=false`；HTTPS 反代后再启用 `true`。
- 本地 mock 验收只能证明应用业务闭环，不等价于真实魔灵接口验收。
