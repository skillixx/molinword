import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import {
  createBillingReconciliationPayload,
  loadTemplateAgentCandidates,
  persistBillingReconciliationTask,
  resolveBillableFailureResponse,
  resolveTemplateAgentFailureStatus,
  shouldReleasePointHold
} from "../server/index.js";

async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  await new Promise((resolve) => server.close(resolve));
  return address.port;
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

async function startApi(environment, modelUrl) {
  const port = await freePort();
  const output = [];
  const processHandle = spawn(process.execPath, ["server/index.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATABASE_URL: "",
      LOCAL_API_PORT: String(port),
      LLM_API_URL: modelUrl,
      LLM_API_KEY: "commercial-gate-test-key",
      LLM_MODEL: "openai-compatible-gate-test-model",
      LLM_MAX_RETRIES: "0",
      LLM_TIMEOUT_MS: "3000",
      ...environment
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  processHandle.stdout.on("data", (chunk) => output.push(chunk.toString("utf8")));
  processHandle.stderr.on("data", (chunk) => output.push(chunk.toString("utf8")));

  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.ok) return { port, processHandle, output };
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error(`API 未在期限内启动：${output.join("")}`);
}

async function stopApi(api) {
  if (api.processHandle.exitCode !== null) return;
  const exited = new Promise((resolve) => api.processHandle.once("exit", resolve));
  api.processHandle.kill();
  await exited;
}

const candidates = [
  {
    id: 11,
    name: "工作总结",
    category: "办公通用",
    documentType: "工作总结",
    topic: "季度工作总结",
    requirement: "总结成果、复盘问题并制定下一步计划。",
    outline: ["一、工作概况", "二、主要成果", "三、问题复盘", "四、后续计划"]
  },
  {
    id: 12,
    name: "会议纪要",
    category: "办公通用",
    documentType: "会议纪要",
    topic: "项目上线评审会议纪要",
    requirement: "记录结论、行动项、责任人和完成期限。",
    outline: ["一、会议基本信息", "二、议题与讨论要点", "三、会议决议", "四、行动项与责任人"]
  }
];

let modelMode = "repair";
let reviewCount = 0;
const modelCalls = [];
const modelServer = createServer(async (request, response) => {
  const body = await readJson(request);
  modelCalls.push(body);
  if (modelMode === "slow") {
    await new Promise((resolve) => setTimeout(resolve, 500));
    response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ choices: [{ message: { content: "这是经过正式润色且符合交付要求的完整文本。" } }] }));
    return;
  }
  if (modelMode === "failure") {
    response.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ message: "模拟模型故障" }));
    return;
  }

  const system = String(body.messages?.[0]?.content || "");
  let content;
  if (system.includes("需求分析智能体")) {
    content = {
      intent: "形成可追溯的上线评审会议纪要",
      audience: "项目负责人和管理层",
      priorities: ["记录评审决议", "明确责任人和期限", "标记待升级风险"],
      constraints: ["不得编造参会信息"],
      summary: "已识别会议决策留痕和行动跟踪要求。"
    };
  } else if (system.includes("质量审校智能体")) {
    reviewCount += 1;
    content = reviewCount === 1
      ? {
          approved: false,
          issues: ["补充风险升级章节"],
          qualityChecklist: ["会议信息完整", "决议可追溯", "行动项有责任人", "行动项有期限"],
          summary: "首次审校要求补充风险升级章节。"
        }
      : {
          approved: true,
          issues: [],
          qualityChecklist: ["会议信息完整", "决议可追溯", "行动项有责任人", "行动项有期限"],
          summary: "返修后质量门禁通过。"
        };
  } else {
    // 中文注解：故意让模型尝试切换到工作总结，验证服务端始终锁定工具匹配出的会议纪要。
    content = {
      recommendedTemplateId: 11,
      recommendedTemplateName: "工作总结",
      title: "产品上线评审会议纪要",
      tone: "正式",
      requirement: "记录决议、责任人、期限和风险。",
      audience: "项目负责人和管理层",
      expectedPages: "3-6页",
      fitScore: 96,
      reason: "用于上线评审决策留痕。",
      outline: ["一、会议基本信息", "二、评审议题", "三、会议决议", "四、行动项", "五、风险升级"],
      qualityChecklist: ["会议信息完整", "决议可追溯", "行动项有责任人", "行动项有期限"]
    };
  }
  response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }));
});

await new Promise((resolve) => modelServer.listen(0, "127.0.0.1", resolve));
const modelAddress = modelServer.address();
assert.ok(modelAddress && typeof modelAddress === "object");
const modelUrl = `http://127.0.0.1:${modelAddress.port}/v1/chat/completions`;
const billableAiRequests = [
  { path: "/api/ai/template-agent", body: { brief: "生成上线评审会议纪要", candidates } },
  { path: "/api/ai/generate-outline", body: { topic: "上线评审", documentType: "会议纪要" } },
  { path: "/api/ai/generate-body", body: { topic: "上线评审", outline: ["一、会议结论"] } },
  { path: "/api/ai/edit", body: { action: "polish", content: "需要润色的正式内容。" } },
  { path: "/api/ai/polish", body: { content: "需要润色的正式内容。" } }
];

// 中文注解：结算状态未知必须覆盖底层网络错误文案，避免用户按普通失败提示重复提交并再次扣费。
const settlementUnknownResponse = resolveBillableFailureResponse(
  new Error("fetch timeout"),
  { isMolingUser: true },
  { state: "settlement_unknown" },
  "Word 导出"
);
assert.match(settlementUnknownResponse.message, /已完成.*待平台对账.*请勿重复提交/);
const insufficientPointsError = Object.assign(new Error("insufficient points"), { code: 60005 });
const insufficientExportResponse = resolveBillableFailureResponse(
  insufficientPointsError,
  { isMolingUser: true },
  { state: "failed" },
  "Word 导出"
);
assert.equal(insufficientExportResponse.status, 402);
assert.match(insufficientExportResponse.message, /积分不足/);
const releaseUnknownResponse = resolveBillableFailureResponse(
  new Error("release fetch timeout"),
  { isMolingUser: true },
  { state: "release_unknown" },
  "Word 导出"
);
assert.match(releaseUnknownResponse.message, /释放状态待平台对账.*请勿重复提交/);

try {
  // 中文注解：生产环境即使把两个安全变量误配为 false/true，也必须强制会话门禁并关闭本地身份模拟。
  const productionApi = await startApi({
    APP_ENV: "production",
    REQUIRE_MOLING_SESSION: "false",
    LOCAL_MOLING_MOCK: "true",
    DATABASE_URL: "mysql://word_app:a-strong-database-password@127.0.0.1:1/moling_word",
    INTERNAL_API_TOKEN: "internal-token-at-least-32-characters",
    MOLING_APP_ID: "15",
    MOLING_PRODUCT_ID: "73",
    MOLING_API_BASE_URL: "http://127.0.0.1:1",
    LLM_API_URL: modelUrl,
    LLM_API_KEY: "commercial-gate-test-key-at-least-32",
    AI_AUDIT_CONTENT_MODE: "metadata",
    AI_AUDIT_HASH_KEY: "audit-hmac-key-at-least-32-characters",
    AI_AUDIT_RETENTION_DAYS: "30",
    STORAGE_ENDPOINT: "http://127.0.0.1:1",
    STORAGE_ACCESS_KEY_ID: "storage-access-key",
    STORAGE_SECRET_ACCESS_KEY: "storage-secret-key-at-least-32-characters",
    SESSION_COOKIE_SECURE: "true",
    APP_BASE_URL: "https://word.example.test",
    BILLING_RECONCILIATION_OUTBOX: "D:\\moling-data\\billing-reconciliation-outbox.jsonl",
    ALLOW_INSECURE_INTERNAL_HTTP: "true"
  }, modelUrl);
  try {
    const healthResponse = await fetch(`http://127.0.0.1:${productionApi.port}/api/health`);
    assert.equal(healthResponse.headers.get("x-content-type-options"), "nosniff");
    assert.equal(healthResponse.headers.get("x-frame-options"), "DENY");
    assert.equal(healthResponse.headers.get("referrer-policy"), "no-referrer");
    const health = await healthResponse.json();
    assert.equal(health.environment, "production");
    assert.equal(health.sessionRequired, true);
    for (const forbiddenField of ["molingApiBaseUrl", "storageBucket", "model"]) {
      assert.equal(forbiddenField in health, false, `公开健康检查不得泄露 ${forbiddenField}`);
    }
    // 中文注解：会话和积分接口的未登录语义必须保持为 401，供前端跳转登录并让监控准确分类。
    for (const path of ["/api/session", "/api/billing/points"]) {
      const response = await fetch(`http://127.0.0.1:${productionApi.port}${path}`);
      assert.equal(response.status, 401, `${path} 未登录时必须返回 401`);
    }
    const crossOriginResponse = await fetch(`http://127.0.0.1:${productionApi.port}/api/ai/edit`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://evil.example" },
      body: JSON.stringify({ action: "polish", content: "跨站请求" })
    });
    assert.equal(crossOriginResponse.status, 403);
    for (const requestCase of billableAiRequests) {
      const before = modelCalls.length;
      const response = await fetch(`http://127.0.0.1:${productionApi.port}${requestCase.path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestCase.body)
      });
      assert.equal(response.status, 401, `${requestCase.path} 必须拒绝生产环境未登录请求`);
      assert.equal(modelCalls.length, before, `${requestCase.path} 未登录时不得调用模型`);
    }
    const exportResponse = await fetch(`http://127.0.0.1:${productionApi.port}/api/documents/1/export-docx`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "未登录导出" })
    });
    assert.equal(exportResponse.status, 401, "Word 导出必须先校验生产会话，不能被数据库或存储错误覆盖");
  } finally {
    await stopApi(productionApi);
  }

  // 中文注解：完整执行审校拒绝、架构返修和再次审校，并验证模型无法换掉已锁定模板。
  modelMode = "repair";
  reviewCount = 0;
  const repairApi = await startApi({
    APP_ENV: "development",
    REQUIRE_MOLING_SESSION: "false",
    LOCAL_MOLING_MOCK: "true"
  }, modelUrl);
  try {
    const response = await fetch(`http://127.0.0.1:${repairApi.port}/api/ai/template-agent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        brief: "为产品上线评审会生成正式会议纪要，需要记录结论、责任人和期限。",
        audience: "项目负责人和管理层",
        expectedPages: "3-6页",
        candidates
      })
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.agentMode, "model");
    assert.equal(result.plan.recommendedTemplateId, 12);
    assert.equal(result.plan.recommendedTemplateName, "会议纪要");
    assert.match(result.plan.workflow.find((item) => item.code === "structure_architect")?.summary || "", /返修/);
    assert.equal(reviewCount, 2);
  } finally {
    await stopApi(repairApi);
  }

  // 中文注解：强制会话模式下的模型故障必须返回 503，不能把本地完整兜底方案当成免费结果返回。
  modelMode = "failure";
  const failureApi = await startApi({
    APP_ENV: "development",
    REQUIRE_MOLING_SESSION: "true",
    LOCAL_MOLING_MOCK: "true"
  }, modelUrl);
  try {
    for (const requestCase of billableAiRequests) {
      const response = await fetch(`http://127.0.0.1:${failureApi.port}${requestCase.path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestCase.body)
      });
      assert.equal(response.status, 503, `${requestCase.path} 模型故障必须返回 503`);
      const result = await response.json();
      assert.equal(result.fallback, undefined, `${requestCase.path} 商业模式不得返回免费兜底`);
      assert.equal(result.plan, undefined, `${requestCase.path} 商业模式不得返回规划结果`);
      assert.equal(result.content, undefined, `${requestCase.path} 商业模式不得返回正文或润色结果`);
      assert.equal(result.outline, undefined, `${requestCase.path} 商业模式不得返回大纲`);
    }
    const exportResponse = await fetch(`http://127.0.0.1:${failureApi.port}/api/documents/1/export-docx`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "商业导出失败" })
    });
    assert.equal(exportResponse.status, 503, "商业导出依赖故障必须返回可重试的服务不可用状态");
  } finally {
    await stopApi(failureApi);
  }

  // 中文注解：单实例并发闸门保护模型和积分上游；达到上限时必须在调用模型前返回 429。
  modelMode = "slow";
  const concurrencyApi = await startApi({
    APP_ENV: "development",
    REQUIRE_MOLING_SESSION: "false",
    LOCAL_MOLING_MOCK: "true",
    AI_MAX_CONCURRENT_REQUESTS: "1"
  }, modelUrl);
  try {
    const firstRequest = fetch(`http://127.0.0.1:${concurrencyApi.port}/api/ai/polish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "第一条需要润色的文档内容。" })
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const secondResponse = await fetch(`http://127.0.0.1:${concurrencyApi.port}/api/ai/polish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "第二条并发文档内容。" })
    });
    assert.equal(secondResponse.status, 429);
    assert.equal((await firstRequest).status, 200);
  } finally {
    await stopApi(concurrencyApi);
  }

  let capturedSql = "";
  const activeCandidates = await loadTemplateAgentCandidates([{ id: 999, name: "客户端伪造模板" }], {
    async query(sql) {
      capturedSql = sql;
      return [[{
        id: 12,
        name: "会议纪要",
        category: "办公通用",
        document_type: "会议纪要",
        topic: "项目会议纪要",
        requirement: "记录决议和行动项。",
        outline_json: JSON.stringify(["一、会议基本信息", "二、讨论要点", "三、会议决议", "四、行动项"])
      }]];
    }
  });
  assert.match(capturedSql, /WHERE status = 'active'/);
  assert.deepEqual(activeCandidates.map((item) => item.id), [12]);

  assert.equal(resolveTemplateAgentFailureStatus({ code: 60005 }, { isMolingUser: true }, null), 402);
  assert.equal(resolveTemplateAgentFailureStatus(new Error("模型异常"), { isMolingUser: true }, { state: "reserved" }), 503);
  assert.equal(shouldReleasePointHold({ state: "reserved" }), true);
  assert.equal(shouldReleasePointHold({ state: "settled" }), false);
  assert.equal(shouldReleasePointHold({ state: "settlement_unknown" }), false);
  assert.equal(shouldReleasePointHold({ state: "release_unknown" }), false);

  const reconciliationHold = {
    holdId: "hold-120",
    idempotencyKey: "moling_word:user-8:word_template_agent:abc:request-1",
    state: "settlement_unknown"
  };
  const reconciliationPayload = createBillingReconciliationPayload(
    reconciliationHold,
    2,
    { userId: "user-8", usageType: "word_template_agent" },
    new Error("结算响应超时")
  );
  assert.equal(reconciliationPayload?.holdId, "hold-120");
  assert.equal(reconciliationPayload?.settlementState, "settlement_unknown");
  const reconciliationQueries = [];
  const persisted = await persistBillingReconciliationTask(
    reconciliationHold,
    2,
    { userId: "user-8", usageType: "word_template_agent" },
    new Error("结算响应超时"),
    {
      async query(sql, parameters) {
        reconciliationQueries.push({ sql, parameters });
        return [{ affectedRows: 1 }];
      }
    }
  );
  assert.equal(persisted, true);
  assert.match(reconciliationQueries[0].sql, /billing_reconciliation_tasks/);
  assert.match(reconciliationQueries[0].sql, /IF\(status = 'resolved', settlement_state/);
  assert.equal(reconciliationQueries[0].parameters[4], reconciliationHold.idempotencyKey);

  const outboxRecords = [];
  const releasePersisted = await persistBillingReconciliationTask(
    reconciliationHold,
    0,
    { userId: "user-8", usageType: "word_template_agent", operationType: "release" },
    new Error("释放响应超时"),
    {
      async query() {
        throw new Error("模拟数据库不可写");
      }
    },
    async (payload, databaseError) => outboxRecords.push({ payload, databaseError })
  );
  assert.equal(releasePersisted, true);
  assert.equal(outboxRecords[0].payload.operationType, "release");
  assert.equal(outboxRecords[0].payload.settlementState, "release_unknown");
  assert.match(outboxRecords[0].databaseError.message, /数据库不可写/);

  const reconciliationWorkerSource = await readFile("scripts/billing-reconciliation.mjs", "utf8");
  assert.match(reconciliationWorkerSource, /SET status = 'processing', claim_token = \?/);
  assert.match(reconciliationWorkerSource, /status = 'processing' AND claim_token = \?/);

  console.log("模板智能体商业门禁检查通过。", {
    productionAuth: 401,
    modelFailure: 503,
    insufficientPoints: 402,
    lockedTemplateId: 12,
    repairReviews: reviewCount,
    activeWhitelist: activeCandidates.length,
    reconciliationPersisted: persisted,
    releaseOutboxPersisted: releasePersisted
  });
} finally {
  await new Promise((resolve) => modelServer.close(resolve));
}
