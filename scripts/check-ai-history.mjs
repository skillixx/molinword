import assert from "node:assert/strict";
import { createServer } from "node:http";
import express from "express";
import { checkDatabaseReadiness, createAiHistoryHandler } from "../server/index.js";

// 中文注解：测试数据故意携带正文、HMAC、模型和内部错误哨兵，用真实 HTTP 响应证明它们不会越过查询边界。
const records = [
  {
    id: "105",
    user_id: "user-a",
    document_id: "701",
    action_type: "template_agent_plan",
    model: "private-model-name",
    request_id: "request-user-a-new",
    prompt: "不得返回的用户需求",
    response: "不得返回的模型正文",
    prompt_hmac_sha256: "a".repeat(64),
    response_hmac_sha256: "b".repeat(64),
    prompt_chars: 120,
    response_chars: 360,
    status: "success",
    error_message: null,
    latency_ms: 1480,
    created_at: "2026-08-08T08:00:00.000Z"
  },
  {
    id: "104",
    user_id: "user-a",
    document_id: null,
    action_type: "generate_body",
    model: "private-model-name",
    request_id: "request-user-a-old",
    prompt: "另一段不得返回的正文",
    response: "",
    prompt_hmac_sha256: "c".repeat(64),
    response_hmac_sha256: "d".repeat(64),
    prompt_chars: 88,
    response_chars: 0,
    status: "failed",
    error_message: "包含内部地址和密钥的真实错误",
    latency_ms: 5020,
    created_at: "2026-08-08T07:30:00.000Z"
  },
  {
    id: "999",
    user_id: "user-b",
    document_id: "990",
    action_type: "polish",
    model: "other-private-model",
    request_id: "request-user-b-secret",
    prompt: "其他用户正文",
    response: "其他用户结果",
    prompt_chars: 12,
    response_chars: 18,
    status: "success",
    latency_ms: 800,
    created_at: "2026-08-08T09:00:00.000Z"
  }
];

let databaseCalls = 0;
const database = {
  async query(sql, params) {
    databaseCalls += 1;
    // 中文注解：假数据库既模拟游标分页，也直接约束生产 SQL 必须按当前用户过滤且不读取高敏列。
    assert.match(sql, /WHERE user_id = \?/i, "历史查询必须在数据库边界按当前用户过滤");
    assert.doesNotMatch(sql, /\bprompt\b|\bresponse\b|hmac|error_message|\bmodel\b|document_id/i, "查询不得读取正文、指纹、内部错误、模型或全局文档标识");
    const [userId] = params;
    const hasCursor = /id\s*<\s*CAST/i.test(sql);
    const beforeId = hasCursor ? BigInt(params[1]) : null;
    const fetchLimit = Number(params.at(-1));
    const rows = records
      .filter((record) => record.user_id === userId && (beforeId == null || BigInt(record.id) < beforeId))
      .sort((left, right) => Number(BigInt(right.id) - BigInt(left.id)))
      .slice(0, fetchLimit);
    return [rows];
  }
};

const authenticate = async (request) => {
  const userId = String(request.headers["x-test-user"] || "");
  if (!userId) {
    const error = new Error("测试会话缺失");
    error.httpStatus = 401;
    throw error;
  }
  return { userId };
};

const app = express();
app.get("/api/ai/history", createAiHistoryHandler({ authenticate, getDatabase: async () => database }));
app.get("/api/ai/history-legacy", createAiHistoryHandler({
  authenticate,
  getDatabase: async () => ({
    async query() {
      const error = new Error("Unknown column 'request_id' in field list; sql=secret-internal-schema");
      error.code = "ER_BAD_FIELD_ERROR";
      throw error;
    }
  })
}));
const server = createServer(app);
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
assert.ok(address && typeof address === "object");
const baseUrl = `http://127.0.0.1:${address.port}/api/ai/history`;

try {
  const firstResponse = await fetch(`${baseUrl}?limit=1`, { headers: { "X-Test-User": "user-a" } });
  assert.equal(firstResponse.status, 200);
  assert.equal(firstResponse.headers.get("cache-control"), "private, no-store");
  const firstPage = await firstResponse.json();
  assert.deepEqual(firstPage, {
    history: [{
      action: "template_agent_plan",
      actionLabel: "模板智能体规划",
      status: "success",
      requestId: "request-user-a-new",
      promptChars: 120,
      responseChars: 360,
      latencyMs: 1480,
      createdAt: "2026-08-08T08:00:00.000Z"
    }],
    nextBeforeId: "105"
  });
  const serialized = JSON.stringify(firstPage);
  assert.doesNotMatch(serialized, /不得返回|private-model|hmac|内部地址|其他用户/);

  const nextResponse = await fetch(`${baseUrl}?limit=10&beforeId=${firstPage.nextBeforeId}`, { headers: { "X-Test-User": "user-a" } });
  assert.equal(nextResponse.status, 200);
  const nextPage = await nextResponse.json();
  assert.equal(nextPage.history.length, 1);
  assert.equal(nextPage.history[0].action, "generate_body");
  assert.equal(nextPage.history[0].status, "failed");
  assert.equal(nextPage.nextBeforeId, null);

  const otherUserResponse = await fetch(baseUrl, { headers: { "X-Test-User": "user-b" } });
  assert.equal(otherUserResponse.status, 200);
  const otherUserPage = await otherUserResponse.json();
  assert.deepEqual(otherUserPage.history.map((item) => item.requestId), ["request-user-b-secret"]);
  assert.doesNotMatch(JSON.stringify(otherUserPage), /request-user-a/);

  const callsBeforeInvalidInput = databaseCalls;
  const expectedServerErrors = [];
  const originalConsoleError = console.error;
  console.error = (...args) => expectedServerErrors.push(args);
  try {
    for (const query of ["?limit=0", "?limit=51", "?beforeId=1%20OR%201=1", "?beforeId=18446744073709551616"]) {
      const invalidResponse = await fetch(`${baseUrl}${query}`, { headers: { "X-Test-User": "user-a" } });
      assert.equal(invalidResponse.status, 400);
      assert.equal(invalidResponse.headers.get("cache-control"), "private, no-store");
    }
    assert.equal(databaseCalls, callsBeforeInvalidInput, "无效分页参数不能进入数据库查询");

    const unauthorizedResponse = await fetch(baseUrl);
    assert.equal(unauthorizedResponse.status, 401);
    assert.equal(unauthorizedResponse.headers.get("cache-control"), "private, no-store");
    assert.doesNotMatch(await unauthorizedResponse.text(), /测试会话缺失/);
  } finally {
    console.error = originalConsoleError;
  }
  assert.equal(expectedServerErrors.length, 5, "四次参数拒绝与一次未登录拒绝都应保留服务端诊断");

  const legacyErrors = [];
  const originalLegacyConsoleError = console.error;
  console.error = (...args) => legacyErrors.push(args);
  try {
    const legacyResponse = await fetch(`${baseUrl}-legacy`, { headers: { "X-Test-User": "user-a" } });
    assert.equal(legacyResponse.status, 503);
    assert.equal(legacyResponse.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(await legacyResponse.json(), { message: "AI 操作记录尚未完成数据库升级，请联系管理员。" });
  } finally {
    console.error = originalLegacyConsoleError;
  }
  assert.equal(legacyErrors.length, 1, "旧审计表拒绝必须保留一条服务端诊断");

  let readinessSql = "";
  let readinessCalls = 0;
  const readinessColumns = ["request_id", "prompt_hmac_sha256", "response_hmac_sha256", "prompt_chars", "response_chars"]
    .map((COLUMN_NAME) => ({ COLUMN_NAME }));
  assert.equal(await checkDatabaseReadiness({
    async query(sql) {
      readinessCalls += 1;
      readinessSql += sql;
      if (/information_schema\.COLUMNS/i.test(sql)) return [readinessColumns];
      if (/information_schema\.STATISTICS/i.test(sql)) {
        return [[
          { INDEX_NAME: "idx_ai_logs_created", SEQ_IN_INDEX: 1, COLUMN_NAME: "created_at" },
          { INDEX_NAME: "idx_ai_logs_user_id", SEQ_IN_INDEX: 1, COLUMN_NAME: "user_id" },
          { INDEX_NAME: "idx_ai_logs_user_id", SEQ_IN_INDEX: 2, COLUMN_NAME: "id" }
        ]];
      }
      return [[]];
    }
  }), true);
  assert.equal(readinessCalls, 3);
  assert.match(readinessSql, /information_schema\.COLUMNS[\s\S]*information_schema\.STATISTICS[\s\S]*SELECT 1 FROM ai_request_logs LIMIT 0/i);
  assert.equal(await checkDatabaseReadiness({
    async query(sql) {
      if (/information_schema\.COLUMNS/i.test(sql)) return [readinessColumns];
      if (/information_schema\.STATISTICS/i.test(sql)) {
        return [[
          { INDEX_NAME: "idx_ai_logs_user_id", SEQ_IN_INDEX: 1, COLUMN_NAME: "user_id" },
          { INDEX_NAME: "idx_ai_logs_user_id", SEQ_IN_INDEX: 2, COLUMN_NAME: "id" }
        ]];
      }
      return [[]];
    }
  }), false, "缺少审计保留期索引时生产就绪必须失败");
  assert.equal(await checkDatabaseReadiness({
    async query(sql) {
      if (/information_schema\.COLUMNS/i.test(sql)) return [readinessColumns];
      if (/information_schema\.STATISTICS/i.test(sql)) {
        return [[{ INDEX_NAME: "idx_ai_logs_user_id", SEQ_IN_INDEX: 1, COLUMN_NAME: "created_at" }]];
      }
      return [[]];
    }
  }), false, "同名但列定义错误的历史索引不能绕过生产就绪门禁");
  assert.equal(await checkDatabaseReadiness({
    async query(sql) {
      if (/information_schema\.COLUMNS/i.test(sql)) return [readinessColumns];
      if (/information_schema\.STATISTICS/i.test(sql)) {
        return [[
          { INDEX_NAME: "idx_ai_logs_created", SEQ_IN_INDEX: 1, COLUMN_NAME: "created_at", SUB_PART: null },
          { INDEX_NAME: "idx_ai_logs_user_id", SEQ_IN_INDEX: 1, COLUMN_NAME: "user_id", SUB_PART: 8 },
          { INDEX_NAME: "idx_ai_logs_user_id", SEQ_IN_INDEX: 2, COLUMN_NAME: "id", SUB_PART: null }
        ]];
      }
      return [[]];
    }
  }), false, "用户字段的前缀索引不能冒充完整的历史分页索引");
  await assert.rejects(
    checkDatabaseReadiness({
      async query(sql) {
        if (/information_schema\.COLUMNS/i.test(sql)) return [readinessColumns];
        if (/information_schema\.STATISTICS/i.test(sql)) {
          return [[
            { INDEX_NAME: "idx_ai_logs_created", SEQ_IN_INDEX: 1, COLUMN_NAME: "created_at", SUB_PART: null },
            { INDEX_NAME: "idx_ai_logs_user_id", SEQ_IN_INDEX: 1, COLUMN_NAME: "user_id", SUB_PART: null },
            { INDEX_NAME: "idx_ai_logs_user_id", SEQ_IN_INDEX: 2, COLUMN_NAME: "id", SUB_PART: null }
          ]];
        }
        const error = new Error("table read denied");
        error.code = "ER_TABLEACCESS_DENIED_ERROR";
        throw error;
      }
    }),
    { code: "ER_TABLEACCESS_DENIED_ERROR" },
    "结构完整但运行账号不能读取真实审计表时不得判为就绪"
  );
  assert.equal(await checkDatabaseReadiness(null), false);
  await assert.rejects(
    checkDatabaseReadiness({
      async query() {
        const error = new Error("legacy audit schema");
        error.code = "ER_BAD_FIELD_ERROR";
        throw error;
      }
    }),
    { code: "ER_BAD_FIELD_ERROR" }
  );
  console.log("AI 操作历史用户隔离、脱敏与游标分页检查通过。", { databaseCalls, records: records.length });
} finally {
  await new Promise((resolve) => server.close(resolve));
}
