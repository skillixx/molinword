import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return address.port;
}

async function freePort() {
  const server = createServer();
  const port = await listen(server);
  await new Promise((resolve) => server.close(resolve));
  return port;
}

const pendingModelResponses = [];
let modelRequestCount = 0;
let notifyModelRequest = null;
const modelServer = createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
    response.statusCode = 404;
    response.end();
    return;
  }
  for await (const _chunk of request) {
    // 中文注解：完整读取请求体，确保测试覆盖真实 chat/completions 发送过程。
  }
  modelRequestCount += 1;
  notifyModelRequest?.();
  notifyModelRequest = null;
  if (modelRequestCount === 1 || modelRequestCount === 3) {
    pendingModelResponses.push(response);
    return;
  }
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify({ choices: [{ message: { content: "这是用于验证并发槽释放时机的模型返回内容。" } }] }));
});
const modelPort = await listen(modelServer);
const apiPort = await freePort();
const output = [];
const apiProcess = spawn(process.execPath, ["server/index.js"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    APP_ENV: "development",
    NODE_ENV: "test",
    APP_HOST: "127.0.0.1",
    LOCAL_API_PORT: String(apiPort),
    LOCAL_MOLING_MOCK: "true",
    REQUIRE_MOLING_SESSION: "false",
    DATABASE_URL: "",
    LLM_API_URL: `http://127.0.0.1:${modelPort}/v1/chat/completions`,
    LLM_API_KEY: "local-lifecycle-test-key",
    LLM_MAX_RETRIES: "0",
    LLM_TIMEOUT_MS: "5000",
    AI_MAX_CONCURRENT_REQUESTS: "1",
    AI_RATE_LIMIT_MAX: "20",
    ACCESS_LOG_ENABLED: "true",
    SHUTDOWN_TIMEOUT_MS: "5000"
  },
  stdio: ["ignore", "pipe", "pipe", "ipc"],
  windowsHide: true
});
apiProcess.stdout.on("data", (chunk) => output.push(chunk.toString("utf8")));
apiProcess.stderr.on("data", (chunk) => output.push(chunk.toString("utf8")));

async function waitForApi() {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${apiPort}/api/health`);
      if (response.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  assert.fail(`API 未按时启动：${output.join("")}`);
}

function waitForNextModelRequest() {
  return new Promise((resolve) => {
    notifyModelRequest = resolve;
  });
}

function callAi(content, signal) {
  return fetch(`http://127.0.0.1:${apiPort}/api/ai/edit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "polish", content }),
    signal
  });
}

function completePendingModelResponse() {
  const response = pendingModelResponses.shift();
  assert.ok(response, "缺少待完成的模型请求");
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify({ choices: [{ message: { content: "这是用于验证优雅退出的模型返回内容。" } }] }));
}

try {
  await waitForApi();

  const firstModelRequest = waitForNextModelRequest();
  const abortController = new AbortController();
  const firstRequest = callAi("客户端断连后仍需占用并发槽", abortController.signal).catch((error) => error);
  await firstModelRequest;
  abortController.abort();
  await firstRequest;

  const blockedResponse = await callAi("并发槽未释放前的新请求");
  assert.equal(blockedResponse.status, 429, "客户端断连不能提前释放仍在执行的 AI 并发槽");
  assert.equal(modelRequestCount, 1);
  completePendingModelResponse();
  await new Promise((resolve) => setTimeout(resolve, 100));
  const accessLogs = output
    .join("")
    .split(/\r?\n/)
    .map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    })
    .filter(Boolean);
  assert.ok(accessLogs.some((entry) => entry.type === "http_access" && entry.path === "/api/ai/edit" && entry.aborted === true), "客户端断连必须写入 aborted=true 的访问日志");

  const secondResponse = await callAi("前一请求完成后应恢复服务");
  assert.equal(secondResponse.status, 200);
  assert.equal(modelRequestCount, 2);

  const shutdownModelRequest = waitForNextModelRequest();
  const inFlightResponsePromise = callAi("收到 SIGTERM 时完成在途模型请求");
  await shutdownModelRequest;
  const exited = new Promise((resolve) => apiProcess.once("exit", (code) => resolve(code)));
  apiProcess.send({ type: "molingword:shutdown" });
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(apiProcess.exitCode, null, "在途请求完成前服务不应提前退出");
  completePendingModelResponse();
  const inFlightResponse = await inFlightResponsePromise;
  assert.equal(inFlightResponse.status, 200);
  assert.equal(await exited, 0);

  console.log("AI 并发槽与优雅退出检查通过。", { disconnectedClientHeldSlot: true, inFlightShutdownStatus: 200, exitCode: 0 });
} finally {
  if (apiProcess.exitCode === null) apiProcess.kill();
  for (const response of pendingModelResponses.splice(0)) response.destroy();
  await new Promise((resolve) => modelServer.close(resolve));
}
