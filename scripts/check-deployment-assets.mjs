import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function readRequired(path) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    assert.fail(`缺少生产部署资产 ${path}：${error.message}`);
  }
}

const nginx = await readRequired("ops/nginx/molinword.conf.example");
assert.match(nginx, /limit_req_zone\s+\$binary_remote_addr\s+zone=molinword_api:/);
assert.match(nginx, /limit_req_zone\s+\$binary_remote_addr\s+zone=molinword_ai:/);
// 中文注解：通用路由文本是 AI 路由的前缀，因此必须比较完整 location 声明，避免契约测试误判。
assert.ok(nginx.indexOf("location ^~ /api/ai/ {") < nginx.indexOf("location ^~ /api/ {"), "AI 限流 location 必须优先于通用 API location");
assert.match(nginx, /proxy_pass\s+http:\/\/127\.0\.0\.1:3001;/);
assert.match(nginx, /proxy_set_header\s+X-Forwarded-For\s+\$proxy_add_x_forwarded_for;/);
assert.match(nginx, /proxy_read_timeout\s+900s;/);
assert.match(nginx, /client_max_body_size\s+20m;/);
assert.match(nginx, /try_files\s+\$uri\s+\$uri\/\s+\/index\.html;/);

const apiService = await readRequired("ops/systemd/molinword-api.service");
for (const expected of [
  "EnvironmentFile=/etc/molinword/molinword.env",
  "ExecStartPre=/usr/bin/node scripts/check-runtime-config.mjs --require-production",
  "ExecStart=/usr/bin/node server/index.js",
  "Restart=on-failure",
  "KillSignal=SIGTERM",
  "TimeoutStopSec=1260",
  "NoNewPrivileges=true",
  "ProtectSystem=strict",
  "StateDirectory=molinword"
]) {
  assert.ok(apiService.includes(expected), `API systemd 单元缺少 ${expected}`);
}

const reconcileService = await readRequired("ops/systemd/molinword-reconcile.service");
assert.match(reconcileService, /ExecStartPre=\/usr\/bin\/node scripts\/check-runtime-config\.mjs --require-production/);
assert.match(reconcileService, /ExecStart=\/usr\/bin\/node scripts\/billing-reconciliation\.mjs import-outbox/);
assert.match(reconcileService, /ExecStart=\/usr\/bin\/node scripts\/billing-reconciliation\.mjs retry/);
assert.match(reconcileService, /StateDirectory=molinword/);
const reconcileTimer = await readRequired("ops/systemd/molinword-reconcile.timer");
assert.match(reconcileTimer, /OnUnitActiveSec=5m/);
assert.match(reconcileTimer, /Persistent=true/);
const reconciliationWorker = await readRequired("scripts/billing-reconciliation.mjs");
assert.match(reconciliationWorker, /error\?\.code === "ENOENT"/, "outbox 尚未创建时必须按零条记录处理，不能阻断数据库对账重试");

const productionEnvironment = await readRequired("ops/env/molinword.production.env.example");
for (const expected of [
  "APP_ENV=production",
  "NODE_ENV=production",
  "APP_HOST=127.0.0.1",
  "TRUSTED_PROXY_HOPS=1",
  "SESSION_COOKIE_SECURE=true",
  "BILLING_RECONCILIATION_OUTBOX=/var/lib/molinword/billing-reconciliation-outbox.jsonl"
]) {
  assert.ok(productionEnvironment.includes(expected), `生产环境样例缺少 ${expected}`);
}
assert.doesNotMatch(productionEnvironment, /(?:sk-|ghp_|AKIA)[A-Za-z0-9_-]{12,}/, "生产环境样例不能包含真实格式密钥");

const workflow = await readRequired(".github/workflows/commercial-readiness.yml");
assert.match(workflow, /permissions:\s*\n\s+contents:\s+read/);
assert.match(workflow, /npm ci/);
assert.match(workflow, /npx playwright install --with-deps chromium/);
assert.match(workflow, /npm run check:commercial-readiness/);
assert.doesNotMatch(workflow, /uses:\s+actions\/(?:checkout|setup-node)@v\d/, "CI 官方 Action 必须固定到确定提交");

const runtimeCheck = await readRequired("scripts/check-runtime-config.mjs");
assert.match(runtimeCheck, /validateProductionConfiguration\(process\.env\)/);
assert.match(runtimeCheck, /process\.argv\.includes\("--require-production"\)/);
assert.match(runtimeCheck, /APP_ENV 必须设置为 production/);
const packageJson = JSON.parse(await readRequired("package.json"));
assert.equal(packageJson.scripts?.["check:runtime-config"], "node scripts/check-runtime-config.mjs");
assert.match(packageJson.scripts?.["check:commercial-readiness"] ?? "", /check:deployment-assets/);
const runbook = await readRequired("ops/README.md");
for (const heading of ["发布", "验收", "回滚", "对账", "证据边界"]) {
  assert.match(runbook, new RegExp(`## .*${heading}`), `部署手册缺少“${heading}”章节`);
}

console.log("生产部署资产契约检查通过。", {
  reverseProxy: true,
  serviceManager: true,
  reconciliationTimer: true,
  ciGate: true,
  rollbackRunbook: true
});
