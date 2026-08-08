import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";

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

const modelCalls = [];
const modelServer = createServer(async (request, response) => {
  if (request.method === "HEAD" && request.url === "/v1/chat/completions") {
    // 中文注解：就绪探针不调用模型、不计入生成次数；405 表示 chat 路径可达但仅接受 POST。
    response.writeHead(405);
    response.end();
    return;
  }
  const body = await readJson(request);
  modelCalls.push(body);
  const system = String(body.messages?.[0]?.content || "");
  let content;
  if (system.includes("需求分析")) {
    content = JSON.stringify({
      intent: "形成可追溯的上线评审会议纪要",
      audience: "项目负责人和管理层",
      priorities: ["记录会议决议", "明确责任人和期限", "标记待升级风险"],
      constraints: ["不编造参会信息"],
      summary: "已识别上线评审的决策留痕和行动跟踪要求。"
    });
  } else if (system.includes("质量审校")) {
    content = JSON.stringify({
      approved: true,
      issues: [],
      qualityChecklist: ["会议信息完整", "决议可追溯", "行动项有责任人", "行动项有完成期限"],
      summary: "结构、事实边界和行动项门禁均通过。"
    });
  } else {
    content = JSON.stringify({
      recommendedTemplateId: 12,
      recommendedTemplateName: "会议纪要",
      title: "产品上线评审会议纪要",
      tone: "正式",
      requirement: "记录决议、责任人、完成期限和待升级风险。",
      audience: "项目负责人和管理层",
      expectedPages: "3-6页",
      fitScore: 96,
      reason: "会议纪要与评审决策留痕场景匹配。",
      outline: ["一、会议基本信息", "二、评审议题与讨论要点", "三、会议决议", "四、行动项、责任人与期限"],
      qualityChecklist: ["会议信息完整", "决议可追溯", "行动项有责任人", "行动项有完成期限"]
    });
  }
  response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify({ choices: [{ message: { content } }] }));
});

await new Promise((resolve) => modelServer.listen(0, "127.0.0.1", resolve));
const modelAddress = modelServer.address();
assert.ok(modelAddress && typeof modelAddress === "object");
const apiPort = await freePort();
const serverOutput = [];
const apiProcess = spawn(process.execPath, ["server/index.js"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    LOCAL_API_PORT: String(apiPort),
    DATABASE_URL: "",
    STORAGE_ENDPOINT: "",
    STORAGE_ACCESS_KEY_ID: "",
    STORAGE_SECRET_ACCESS_KEY: "",
    LOCAL_MOLING_MOCK: "true",
    REQUIRE_MOLING_SESSION: "false",
    LLM_API_URL: `http://127.0.0.1:${modelAddress.port}/v1/chat/completions`,
    LLM_API_KEY: "template-agent-contract-test-key",
    LLM_MODEL: "openai-compatible-test-model",
    LLM_MAX_RETRIES: "0",
    LLM_TIMEOUT_MS: "5000"
  },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true
});
apiProcess.stdout.on("data", (chunk) => serverOutput.push(chunk.toString("utf8")));
apiProcess.stderr.on("data", (chunk) => serverOutput.push(chunk.toString("utf8")));

try {
  const deadline = Date.now() + 10000;
  let ready = false;
  while (!ready && Date.now() < deadline) {
    try {
      const health = await fetch(`http://127.0.0.1:${apiPort}/api/health`);
      ready = health.ok;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  assert.ok(ready, `API 未在期限内启动：${serverOutput.join("")}`);

  const readinessResponse = await fetch(`http://127.0.0.1:${apiPort}/api/ready`);
  assert.equal(readinessResponse.status, 503, "未配置数据库和存储时就绪检查必须失败");
  const readiness = await readinessResponse.json();
  assert.equal(readiness.ready, false);
  assert.equal(readiness.checks.database, false);
  assert.equal(readiness.checks.storage, false);
  assert.equal(readiness.checks.gateway, true);

  const response = await fetch(`http://127.0.0.1:${apiPort}/api/ai/template-agent`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      brief: "为产品上线评审会生成正式会议纪要，需要记录结论、责任人和完成期限。",
      audience: "项目负责人和管理层",
      expectedPages: "3-6页",
      candidates: [
        { id: 11, name: "工作总结", category: "办公通用", documentType: "工作总结", topic: "季度工作总结", requirement: "总结成果和计划。", outline: ["一、概况", "二、成果", "三、问题", "四、计划"] },
        { id: 12, name: "会议纪要", category: "办公通用", documentType: "会议纪要", topic: "项目推进会议纪要", requirement: "记录结论、责任人和期限。", outline: ["一、会议基本信息", "二、讨论要点", "三、会议决议", "四、行动项"] }
      ]
    })
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.agentMode, "model");
  assert.equal(result.plan.recommendedTemplateId, 12);
  assert.equal(result.plan.title, "产品上线评审会议纪要");
  assert.ok(result.plan.workflow.every((item) => item.status === "completed"));
  assert.equal(modelCalls.length, 3, "正常方案必须真实执行需求分析、结构设计和质量审校三次模型调用");
  assert.ok(modelCalls.every((call) => call.model === "openai-compatible-test-model"));
  console.log("模板智能体 OpenAI 兼容 API 三阶段模型调用与工具匹配检查通过。", { modelCalls: modelCalls.length, workflowStages: result.plan.workflow.length });
} finally {
  if (apiProcess.exitCode === null) {
    const exited = new Promise((resolve) => apiProcess.once("exit", resolve));
    apiProcess.kill();
    await exited;
  }
  await new Promise((resolve) => modelServer.close(resolve));
}
