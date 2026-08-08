import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import { buildAiAuditRecord, normalizeAiEditAction, validateProductionConfiguration } from "../server/index.js";

const prompt = "客户手机号 138****0000 与项目预算";
const responseText = "建议按已确认范围执行。";
const requestId = "request-12345678";
const metadataRecord = buildAiAuditRecord({
  requestId,
  actionType: "template_agent_plan",
  prompt,
  responseText,
  status: "failed",
  errorMessage: "LLM_API_KEY=secret-value 模型调用失败"
}, { APP_ENV: "production", AI_AUDIT_CONTENT_MODE: "metadata" });

assert.equal(metadataRecord.requestId, requestId);
assert.equal(metadataRecord.prompt, null, "生产元数据模式不得保存完整提示词");
assert.equal(metadataRecord.responseText, null, "生产元数据模式不得保存完整模型回复");
assert.equal(metadataRecord.promptSha256, crypto.createHash("sha256").update(prompt).digest("hex"));
assert.equal(metadataRecord.responseSha256, crypto.createHash("sha256").update(responseText).digest("hex"));
assert.equal(metadataRecord.promptChars, Array.from(prompt).length);
assert.equal(metadataRecord.responseChars, Array.from(responseText).length);
assert.doesNotMatch(metadataRecord.errorMessage, /secret-value/, "生产审计错误不得保存内部密钥或原始错误");

const developmentRecord = buildAiAuditRecord({ actionType: "polish", prompt, responseText }, { APP_ENV: "development" });
assert.equal(developmentRecord.prompt, prompt);
assert.equal(developmentRecord.responseText, responseText);
assert.equal(buildAiAuditRecord({ actionType: "polish", prompt, responseText }, { APP_ENV: "development", AI_AUDIT_CONTENT_MODE: "disabled" }), null);
for (const action of ["continue", "expand", "shorten", "correct", "format", "polish"]) {
  assert.equal(normalizeAiEditAction(action), action);
}
assert.equal(normalizeAiEditAction("客户机密正文"), "polish", "未知客户端动作不得进入 AI 审计和计费幂等字段");
assert.equal(normalizeAiEditAction({ action: "expand" }), "polish");

const productionBase = {
  APP_ENV: "production",
  DATABASE_URL: "mysql://word_app:a-strong-database-password@db.internal:3306/moling_word",
  INTERNAL_API_TOKEN: "internal-token-at-least-32-characters",
  MOLING_APP_ID: "15",
  MOLING_PRODUCT_ID: "73",
  MOLING_API_BASE_URL: "https://platform.example.com",
  LLM_API_URL: "https://gateway.example.com/v1/chat/completions",
  LLM_API_KEY: "model-key-at-least-32-characters",
  LLM_MODEL: "approved-model",
  STORAGE_ENDPOINT: "https://minio.example.com",
  STORAGE_ACCESS_KEY_ID: "storage-access-key",
  STORAGE_SECRET_ACCESS_KEY: "storage-secret-key-at-least-32-characters",
  SESSION_COOKIE_SECURE: "true",
  APP_BASE_URL: "https://word.example.com",
  BILLING_RECONCILIATION_OUTBOX: "D:\\moling-data\\billing-reconciliation-outbox.jsonl",
  LLM_TIMEOUT_MS: "30000",
  LLM_MAX_RETRIES: "1",
  MOLING_INTERNAL_TIMEOUT_MS: "10000",
  SHUTDOWN_TIMEOUT_MS: "420000"
};

for (const override of [
  {},
  { AI_AUDIT_CONTENT_MODE: "full", AI_AUDIT_RETENTION_DAYS: "30" },
  { AI_AUDIT_CONTENT_MODE: "metadata", AI_AUDIT_RETENTION_DAYS: "0" },
  { AI_AUDIT_CONTENT_MODE: "metadata", AI_AUDIT_RETENTION_DAYS: "366" },
  { AI_AUDIT_CONTENT_MODE: "metadata", AI_AUDIT_RETENTION_DAYS: "30", AI_AUDIT_CLEANUP_BATCH_SIZE: "0" },
  { AI_AUDIT_CONTENT_MODE: "metadata", AI_AUDIT_RETENTION_DAYS: "30", AI_AUDIT_CLEANUP_MAX_BATCHES: "101" }
]) {
  const errors = validateProductionConfiguration({ ...productionBase, ...override });
  assert.ok(errors.some((message) => /AI_AUDIT_/.test(message)), "生产配置必须拒绝缺失、完整内容或越界保留策略");
}

assert.deepEqual(validateProductionConfiguration({
  ...productionBase,
  AI_AUDIT_CONTENT_MODE: "metadata",
  AI_AUDIT_RETENTION_DAYS: "30"
}), []);

const serverSource = await readFile("server/index.js", "utf8");
assert.equal(
  (serverSource.match(/requestId: request\.requestId,/g) || []).length >= 10,
  true,
  "所有 AI 审计写入必须关联服务端请求 ID"
);
const schemaSource = await readFile("database/init-mysql.sql", "utf8");
for (const field of ["request_id", "prompt_sha256", "response_sha256", "prompt_chars", "response_chars", "idx_ai_logs_created"]) {
  assert.match(schemaSource, new RegExp(`\\b${field}\\b`), `新数据库 AI 审计表缺少 ${field}`);
}

console.log("AI 审计隐私与保留配置检查通过。", {
  productionRawContent: false,
  requestIdLinked: true,
  retentionDays: 30
});
