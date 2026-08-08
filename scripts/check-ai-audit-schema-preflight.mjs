import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import {
  aiAuditCreatedAtIndexName,
  aiHistoryIndexName,
  formatAiAuditSchemaReport,
  inspectAiAuditSchema
} from "../shared/ai-audit-schema.js";
import { runAiAuditSchemaCheck } from "../database/check-ai-audit-privacy.mjs";

const requiredColumns = [
  "request_id",
  "prompt_hmac_sha256",
  "response_hmac_sha256",
  "prompt_chars",
  "response_chars"
];

function schemaConnection({ columns = requiredColumns, indexes = [] } = {}) {
  const queries = [];
  return {
    queries,
    async query(sql) {
      queries.push(String(sql));
      if (/information_schema\.COLUMNS/i.test(sql)) {
        return [columns.map((columnName) => ({ COLUMN_NAME: columnName }))];
      }
      if (/information_schema\.STATISTICS/i.test(sql)) return [indexes];
      throw new Error(`只读预检执行了未声明查询：${sql}`);
    }
  };
}

const readyConnection = schemaConnection({
  indexes: [
    { INDEX_NAME: aiAuditCreatedAtIndexName, SEQ_IN_INDEX: 1, COLUMN_NAME: "created_at", SUB_PART: null },
    { INDEX_NAME: aiHistoryIndexName, SEQ_IN_INDEX: 1, COLUMN_NAME: "user_id", SUB_PART: null },
    { INDEX_NAME: aiHistoryIndexName, SEQ_IN_INDEX: 2, COLUMN_NAME: "id", SUB_PART: null }
  ]
});
const readyReport = await inspectAiAuditSchema(readyConnection);
assert.deepEqual(readyReport, {
  ready: true,
  tableExists: true,
  missingColumns: [],
  missingOrInvalidIndexes: [],
  existingIndexNames: [aiAuditCreatedAtIndexName, aiHistoryIndexName]
});
assert.equal(readyConnection.queries.length, 2);
assert.ok(readyConnection.queries.every((sql) => /^\s*SELECT\b/i.test(sql)), "结构预检只能执行只读 SELECT");
assert.match(formatAiAuditSchemaReport(readyReport), /结构检查通过/);

const legacyConnection = schemaConnection({ columns: ["id", "user_id", "created_at"] });
const legacyReport = await inspectAiAuditSchema(legacyConnection);
assert.deepEqual(legacyReport, {
  ready: false,
  tableExists: true,
  missingColumns: requiredColumns,
  missingOrInvalidIndexes: [aiAuditCreatedAtIndexName, aiHistoryIndexName],
  existingIndexNames: []
});
const legacyMessage = formatAiAuditSchemaReport(legacyReport);
for (const name of [...requiredColumns, aiAuditCreatedAtIndexName, aiHistoryIndexName]) assert.match(legacyMessage, new RegExp(name));
assert.match(legacyMessage, /npm run db:migrate:ai-audit-privacy/);
assert.doesNotMatch(legacyMessage, /mysql:\/\/|DATABASE_URL|password|token/i, "预检报告不得包含连接串或凭据提示");

const missingTableReport = await inspectAiAuditSchema(schemaConnection({ columns: [] }));
assert.equal(missingTableReport.tableExists, false);
assert.match(formatAiAuditSchemaReport(missingTableReport), /ai_request_logs 表不存在/);

const malformedIndexReport = await inspectAiAuditSchema(schemaConnection({
  indexes: [
    { INDEX_NAME: aiAuditCreatedAtIndexName, SEQ_IN_INDEX: 1, COLUMN_NAME: "created_at", SUB_PART: 4 },
    { INDEX_NAME: aiHistoryIndexName, SEQ_IN_INDEX: 1, COLUMN_NAME: "id", SUB_PART: null },
    { INDEX_NAME: aiHistoryIndexName, SEQ_IN_INDEX: 2, COLUMN_NAME: "user_id", SUB_PART: null }
  ]
}));
assert.deepEqual(malformedIndexReport.missingOrInvalidIndexes, [aiAuditCreatedAtIndexName, aiHistoryIndexName]);
assert.deepEqual(malformedIndexReport.existingIndexNames, [aiAuditCreatedAtIndexName, aiHistoryIndexName]);

const readyMessages = [];
const readyCliConnection = schemaConnection({
  indexes: [
    { INDEX_NAME: aiAuditCreatedAtIndexName, SEQ_IN_INDEX: 1, COLUMN_NAME: "created_at", SUB_PART: null },
    { INDEX_NAME: aiHistoryIndexName, SEQ_IN_INDEX: 1, COLUMN_NAME: "user_id", SUB_PART: null },
    { INDEX_NAME: aiHistoryIndexName, SEQ_IN_INDEX: 2, COLUMN_NAME: "id", SUB_PART: null }
  ]
});
assert.equal(await runAiAuditSchemaCheck(readyCliConnection, {
  log: (message) => readyMessages.push(message),
  error: (message) => readyMessages.push(message)
}), 0);
assert.deepEqual(readyMessages, ["AI 审计隐私结构检查通过。"]);

const legacyMessages = [];
assert.equal(await runAiAuditSchemaCheck(schemaConnection({ columns: ["id", "user_id", "created_at"] }), {
  log: (message) => legacyMessages.push(message),
  error: (message) => legacyMessages.push(message)
}), 1);
assert.equal(legacyMessages.length, 1);
assert.match(legacyMessages[0], /缺少字段/);
assert.match(legacyMessages[0], /db:migrate:ai-audit-privacy/);

const missingConfiguration = spawnSync(process.execPath, [resolve("database/check-ai-audit-privacy.mjs")], {
  cwd: process.cwd(),
  encoding: "utf8",
  env: { ...process.env, DATABASE_URL: "" },
  timeout: 5000
});
assert.equal(missingConfiguration.status, 1);
assert.match(missingConfiguration.stderr, /缺少 DATABASE_URL/);

const secretFixture = "preflight-secret-must-not-leak";
const failedConnection = spawnSync(process.execPath, [resolve("database/check-ai-audit-privacy.mjs")], {
  cwd: process.cwd(),
  encoding: "utf8",
  env: { ...process.env, DATABASE_URL: `mysql://preflight-user:${secretFixture}@127.0.0.1:1/preflight` },
  timeout: 5000
});
assert.equal(failedConnection.status, 1);
assert.match(failedConnection.stderr, /数据库连接和权限/);
assert.doesNotMatch(`${failedConnection.stdout}\n${failedConnection.stderr}`, new RegExp(`${secretFixture}|preflight-user|127\\.0\\.0\\.1:1`), "连接失败不得输出账号、密码或目标地址");

console.log("AI 审计数据库结构只读预检契约通过。", {
  requiredColumns: requiredColumns.length,
  requiredIndexes: 2,
  readOnlyQueries: readyCliConnection.queries.length
});
