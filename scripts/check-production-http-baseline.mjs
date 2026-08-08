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

const port = await freePort();
const output = [];
let gatewayAuthorized = true;
const gatewayServer = createServer((request, response) => {
  response.setHeader("Connection", "close");
  if (request.method === "GET" && request.url === "/v1/models") {
    if (!gatewayAuthorized || request.headers.authorization !== "Bearer model-key-at-least-32-characters") {
      response.statusCode = 401;
      response.end();
      return;
    }
    response.setHeader("Content-Type", "application/json");
    response.statusCode = 200;
    response.end(JSON.stringify({ data: [{ id: "test-model" }] }));
    return;
  }
  if (request.method === "HEAD" && request.url === "/v1/chat/completions") {
    response.statusCode = 405;
    response.end();
    return;
  }
  response.statusCode = 404;
  response.end();
});
await new Promise((resolve) => gatewayServer.listen(0, "127.0.0.1", resolve));
const gatewayAddress = gatewayServer.address();
assert.ok(gatewayAddress && typeof gatewayAddress === "object");
const gatewayOrigin = `http://127.0.0.1:${gatewayAddress.port}`;
let gatewayClosed = false;
const apiProcess = spawn(process.execPath, ["server/index.js"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    APP_ENV: "production",
    NODE_ENV: "production",
    APP_HOST: "127.0.0.1",
    LOCAL_API_PORT: String(port),
    DATABASE_URL: "mysql://word_app:a-strong-database-password@127.0.0.1:1/moling_word",
    INTERNAL_API_TOKEN: "internal-token-at-least-32-characters",
    MOLING_APP_ID: "15",
    MOLING_PRODUCT_ID: "73",
    MOLING_API_BASE_URL: "https://platform.example.test",
    LLM_API_URL: `${gatewayOrigin}/v1/chat/completions`,
    LLM_API_KEY: "model-key-at-least-32-characters",
    STORAGE_ENDPOINT: gatewayOrigin,
    STORAGE_ACCESS_KEY_ID: "storage-access-key",
    STORAGE_SECRET_ACCESS_KEY: "storage-secret-key-at-least-32-characters",
    SESSION_COOKIE_SECURE: "true",
    APP_BASE_URL: "https://word.example.test",
    BILLING_RECONCILIATION_OUTBOX: "D:\\moling-data\\billing-reconciliation-outbox.jsonl",
    REQUIRE_MOLING_SESSION: "true",
    LOCAL_MOLING_MOCK: "false",
    ALLOW_INSECURE_INTERNAL_HTTP: "true",
    TRUSTED_PROXY_HOPS: "0",
    RATE_LIMIT_WINDOW_MS: "60000",
    API_RATE_LIMIT_MAX: "100",
    AI_RATE_LIMIT_MAX: "2",
    ACCESS_LOG_ENABLED: "false"
  },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true
});
apiProcess.stdout.on("data", (chunk) => output.push(chunk.toString("utf8")));
apiProcess.stderr.on("data", (chunk) => output.push(chunk.toString("utf8")));

async function stopApi() {
  if (apiProcess.exitCode !== null) return;
  const exited = new Promise((resolve) => apiProcess.once("exit", resolve));
  apiProcess.kill();
  await exited;
}

async function stopGateway() {
  if (gatewayClosed) return;
  gatewayClosed = true;
  await new Promise((resolve) => gatewayServer.close(resolve));
}

try {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.ok) break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  const requestId = "release-check-1234";
  const healthResponse = await fetch(`http://127.0.0.1:${port}/api/health`, {
    headers: { "X-Request-Id": requestId }
  });
  assert.equal(healthResponse.status, 200, output.join(""));
  assert.match(healthResponse.headers.get("x-request-id") || "", /^[0-9a-f-]{36}$/i);
  assert.notEqual(healthResponse.headers.get("x-request-id"), requestId);

  const replacedRequestIdResponse = await fetch(`http://127.0.0.1:${port}/api/health`, {
    headers: { "X-Request-Id": "<script>invalid</script>" }
  });
  assert.match(replacedRequestIdResponse.headers.get("x-request-id") || "", /^[0-9a-f-]{36}$/i);

  const readyWithGatewayResponse = await fetch(`http://127.0.0.1:${port}/api/ready`);
  const readyWithGateway = await readyWithGatewayResponse.json();
  assert.equal(readyWithGateway.checks.gateway, true);
  gatewayAuthorized = false;
  const readyWithoutGatewayResponse = await fetch(`http://127.0.0.1:${port}/api/ready`);
  const readyWithoutGateway = await readyWithoutGatewayResponse.json();
  assert.equal(readyWithoutGateway.checks.gateway, false);

  const missingResponse = await fetch(`http://127.0.0.1:${port}/api/not-found`);
  assert.equal(missingResponse.status, 404);
  assert.match(missingResponse.headers.get("content-type") || "", /application\/json/);
  assert.match((await missingResponse.json()).message, /不存在/);

  const malformedResponse = await fetch(`http://127.0.0.1:${port}/api/molin/launch`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://word.example.test" },
    body: "{"
  });
  assert.equal(malformedResponse.status, 400);
  assert.match(malformedResponse.headers.get("content-type") || "", /application\/json/);
  assert.match((await malformedResponse.json()).message, /JSON|请求内容/);

  const statuses = [];
  for (let index = 0; index < 3; index += 1) {
    const response = await fetch(`http://127.0.0.1:${port}/api/ai/edit`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://word.example.test" },
      body: JSON.stringify({ action: "polish", content: `rate-limit-${index}` })
    });
    statuses.push(response.status);
    if (index === 2) {
      assert.equal(response.headers.get("retry-after"), "60");
      assert.equal(response.headers.get("ratelimit-limit"), "2");
      assert.equal(response.headers.get("ratelimit-remaining"), "0");
    }
  }
  assert.deepEqual(statuses, [401, 401, 429]);

  console.log("生产 HTTP 基线检查通过。", { requestId: "server-generated", gatewayReadiness: ["authorized", "unauthorized"], malformedJson: 400, missingRoute: 404, aiRateLimit: statuses });
} finally {
  await stopApi();
  await stopGateway();
}
