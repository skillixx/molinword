import assert from "node:assert/strict";
import { validateProductionConfiguration } from "../server/index.js";

assert.deepEqual(validateProductionConfiguration({ APP_ENV: "development" }), []);
assert.ok(
  validateProductionConfiguration({ APP_ENV: "development", NODE_ENV: "production" }).length > 0,
  "NODE_ENV=production 时不能被 APP_ENV=development 绕过生产配置门禁"
);

const invalidErrors = validateProductionConfiguration({
  APP_ENV: "production",
  DATABASE_URL: "mysql://user:replace-with-password@127.0.0.1:3306/moling_word",
  SESSION_COOKIE_SECURE: "false",
  APP_BASE_URL: "http://word.example.com"
});
for (const expectedKey of [
  "DATABASE_URL",
  "INTERNAL_API_TOKEN",
  "MOLING_APP_ID",
  "MOLING_PRODUCT_ID",
  "LLM_API_URL",
  "LLM_API_KEY",
  "LLM_MODEL",
  "AI_AUDIT_CONTENT_MODE",
  "AI_AUDIT_HASH_KEY",
  "AI_AUDIT_RETENTION_DAYS",
  "STORAGE_ENDPOINT",
  "STORAGE_ACCESS_KEY_ID",
  "STORAGE_SECRET_ACCESS_KEY",
  "SESSION_COOKIE_SECURE",
  "APP_BASE_URL",
  "BILLING_RECONCILIATION_OUTBOX"
]) {
  assert.ok(invalidErrors.some((message) => message.includes(expectedKey)), `缺少 ${expectedKey} 的生产配置错误`);
}

const validProductionConfiguration = {
  APP_ENV: "production",
  DATABASE_URL: "mysql://word_app:a-strong-database-password@db.internal:3306/moling_word",
  INTERNAL_API_TOKEN: "internal-token-at-least-32-characters",
  MOLING_APP_ID: "15",
  MOLING_PRODUCT_ID: "73",
  MOLING_API_BASE_URL: "https://platform.example.com",
  LLM_API_URL: "https://gateway.example.com/v1/chat/completions",
  LLM_API_KEY: "model-key-at-least-32-characters",
  LLM_MODEL: "deepseek-chat",
  AI_AUDIT_CONTENT_MODE: "metadata",
  AI_AUDIT_HASH_KEY: "audit-hmac-key-at-least-32-characters",
  AI_AUDIT_RETENTION_DAYS: "30",
  STORAGE_ENDPOINT: "https://minio.example.com",
  STORAGE_ACCESS_KEY_ID: "storage-access-key",
  STORAGE_SECRET_ACCESS_KEY: "storage-secret-key-at-least-32-characters",
  SESSION_COOKIE_SECURE: "true",
  APP_BASE_URL: "https://word.example.com",
  BILLING_RECONCILIATION_OUTBOX: "D:\\moling-data\\billing-reconciliation-outbox.jsonl",
  TRUSTED_PROXY_HOPS: "1",
  RATE_LIMIT_WINDOW_MS: "60000",
  API_RATE_LIMIT_MAX: "300",
  AI_RATE_LIMIT_MAX: "30",
  LLM_TIMEOUT_MS: "30000",
  LLM_MAX_RETRIES: "1",
  MOLING_INTERNAL_TIMEOUT_MS: "10000",
  ACCESS_LOG_ENABLED: "true",
  SHUTDOWN_TIMEOUT_MS: "420000"
};
const validErrors = validateProductionConfiguration(validProductionConfiguration);
assert.deepEqual(validErrors, []);

const placeholderModelErrors = validateProductionConfiguration({
  ...validProductionConfiguration,
  LLM_MODEL: "replace-with-approved-model"
});
assert.ok(placeholderModelErrors.some((message) => message.includes("LLM_MODEL")), "生产模型名不能保留占位值");

for (const reusedKey of ["INTERNAL_API_TOKEN", "LLM_API_KEY", "STORAGE_SECRET_ACCESS_KEY"]) {
  const reusedAuditKeyErrors = validateProductionConfiguration({
    ...validProductionConfiguration,
    AI_AUDIT_HASH_KEY: validProductionConfiguration[reusedKey]
  });
  assert.ok(
    reusedAuditKeyErrors.some((message) => message.includes(`不能与 ${reusedKey} 复用`)),
    `AI 审计 HMAC 密钥不能与 ${reusedKey} 复用`
  );
}
const reusedDatabasePassword = "database-password%40at-least-32-characters";
const reusedDatabasePasswordErrors = validateProductionConfiguration({
  ...validProductionConfiguration,
  DATABASE_URL: `mysql://word_app:${reusedDatabasePassword}@db.internal:3306/moling_word`,
  AI_AUDIT_HASH_KEY: decodeURIComponent(reusedDatabasePassword)
});
assert.ok(
  reusedDatabasePasswordErrors.some((message) => message.includes("DATABASE_URL 数据库密码复用")),
  "AI 审计 HMAC 密钥不能与 URL 编码后的数据库密码复用"
);

// 中文注解：运行时仍兼容历史 WORD_* 命名，启动门禁必须采用相同解析规则，避免有效旧部署无法升级。
const legacyAliasErrors = validateProductionConfiguration({
  ...validProductionConfiguration,
  MOLING_APP_ID: undefined,
  MOLING_PRODUCT_ID: undefined,
  WORD_APP_ID: "15",
  WORD_PRODUCT_ID: "73"
});
assert.deepEqual(legacyAliasErrors, []);

const legacyModelAliasErrors = validateProductionConfiguration({
  ...validProductionConfiguration,
  LLM_MODEL: undefined,
  MOLIN_GATEWAY_MODEL: "deepseek-chat"
});
assert.deepEqual(legacyModelAliasErrors, []);

const invalidRuntimeBoundaryErrors = validateProductionConfiguration({
  ...validProductionConfiguration,
  TRUSTED_PROXY_HOPS: "many",
  RATE_LIMIT_WINDOW_MS: "999",
  API_RATE_LIMIT_MAX: "0",
  AI_RATE_LIMIT_MAX: "1.5",
  LLM_TIMEOUT_MS: "60001",
  LLM_MAX_RETRIES: "2",
  MOLING_INTERNAL_TIMEOUT_MS: "30001",
  ACCESS_LOG_ENABLED: "yes",
  SHUTDOWN_TIMEOUT_MS: "1200001"
});
for (const expectedKey of [
  "TRUSTED_PROXY_HOPS",
  "RATE_LIMIT_WINDOW_MS",
  "API_RATE_LIMIT_MAX",
  "AI_RATE_LIMIT_MAX",
  "LLM_TIMEOUT_MS",
  "LLM_MAX_RETRIES",
  "MOLING_INTERNAL_TIMEOUT_MS",
  "ACCESS_LOG_ENABLED",
  "SHUTDOWN_TIMEOUT_MS"
]) {
  assert.ok(invalidRuntimeBoundaryErrors.some((message) => message.includes(expectedKey)), `缺少 ${expectedKey} 的运行边界配置错误`);
}

const shortShutdownWindowErrors = validateProductionConfiguration({
  ...validProductionConfiguration,
  SHUTDOWN_TIMEOUT_MS: "379999"
});
assert.ok(shortShutdownWindowErrors.some((message) => message.includes("最坏链路 380000")), "退出窗口必须覆盖模型与平台调用及其重试");

const insecureInternalErrors = validateProductionConfiguration({
  APP_ENV: "production",
  DATABASE_URL: "mysql://word_app:a-strong-database-password@db.internal:3306/moling_word",
  INTERNAL_API_TOKEN: "internal-token-at-least-32-characters",
  MOLING_APP_ID: "15",
  MOLING_PRODUCT_ID: "73",
  MOLING_API_BASE_URL: "http://platform.internal:8080",
  LLM_API_URL: "http://gateway.internal:8080/v1/chat/completions",
  LLM_API_KEY: "model-key-at-least-32-characters",
  LLM_MODEL: "deepseek-chat",
  STORAGE_ENDPOINT: "http://minio.internal:9000",
  STORAGE_ACCESS_KEY_ID: "storage-access-key",
  STORAGE_SECRET_ACCESS_KEY: "storage-secret-key-at-least-32-characters",
  SESSION_COOKIE_SECURE: "true",
  APP_BASE_URL: "https://word.example.com",
  BILLING_RECONCILIATION_OUTBOX: "D:\\moling-data\\billing-reconciliation-outbox.jsonl"
});
assert.ok(insecureInternalErrors.some((message) => message.includes("ALLOW_INSECURE_INTERNAL_HTTP")));

console.log("生产配置 fail-fast 检查通过。", {
  invalidErrorCount: invalidErrors.length,
  validErrorCount: validErrors.length,
  insecureInternalErrorCount: insecureInternalErrors.length
});
