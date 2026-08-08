export const productionAcceptanceSchemaVersion = 1;
export const productionAcceptancePreflightKind = "molinword-production-acceptance-preflight";
export const productionManualAcceptanceKind = "molinword-production-manual-acceptance";
export const productionAcceptanceApprovalKind = "molinword-production-acceptance-approval";
export const productionAcceptanceAuthorizationKind = "molinword-production-acceptance-authorization";

export const productionAcceptanceAutomaticCheckIds = Object.freeze([
  "site-entry",
  "site-cache-policy",
  "security-headers",
  "health-http",
  "health-production",
  "release-binding",
  "health-configuration",
  "ready-dependencies",
  "json-404",
  "unauthenticated-ai",
  "server-request-ids"
]);

export const productionAcceptanceManualChecks = Object.freeze([
  { id: "moling-sso", title: "墨灵 SSO 与跨用户隔离", evidenceRequired: "平台入口截图、专用测试用户、会话 Cookie 属性和跨用户 401/403 记录" },
  { id: "http-contracts", title: "错误输入与限流契约", evidenceRequired: "无效 JSON 的 400、真实限流 429、Retry-After/RateLimit 响应头和中文提示截图" },
  { id: "agent-workflow", title: "四阶段文档智能体真实链路", evidenceRequired: "需求分析、MySQL active 白名单模板匹配、结构设计、质量审校四阶段记录及最终文档，不得使用 Mock" },
  { id: "points-ledger", title: "积分预占、结算与幂等", evidenceRequired: "调用前后积分、平台账本、幂等键和只结算一次的记录" },
  { id: "insufficient-points", title: "余额不足拒绝", evidenceRequired: "真实低余额账号、402 请求 ID、调用前后余额及模型未被调用的证据" },
  { id: "failure-reconciliation", title: "模型失败补偿与对账", evidenceRequired: "503 请求 ID、积分释放结果、原幂等键及待对账或人工复核记录" },
  { id: "word-visual", title: "Microsoft Word 导入导出视觉验收", evidenceRequired: "包含标题、表格、图片和自定义颜色的 Word 样例及逐页截图" },
  { id: "multi-device", title: "390px、平板和桌面端交互验收", evidenceRequired: "三种宽度截图、无横向溢出记录和按钮反馈清单" },
  { id: "audit-correlation", title: "请求日志与 AI 审计关联", evidenceRequired: "同一 X-Request-Id 的访问日志、脱敏 ai_request_logs 记录和无敏感正文证明" },
  { id: "rollback-drill", title: "版本回滚与在途请求演练", evidenceRequired: "前后 release id、systemd/Nginx 状态、ready 结果和回滚时间线" }
].map((check) => Object.freeze(check)));

export function normalizeAcceptanceReleaseId(releaseId) {
  const normalized = String(releaseId || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(normalized)) {
    throw new Error("release id 必须为 1 至 80 位字母、数字、点、下划线或连字符。");
  }
  return normalized;
}

export function createPendingProductionManualChecks() {
  return productionAcceptanceManualChecks.map((check) => ({ ...check, status: "pending" }));
}
