import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function readRequired(path) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    assert.fail(`缺少生产部署资产 ${path}：${error.message}`);
  }
}

const applicationHtml = await readRequired("index.html");
const applicationFavicon = await readRequired("public/favicon.svg");
assert.match(applicationHtml, /<link rel="icon" type="image\/svg\+xml" href="\/favicon\.svg"\s*\/>/);
assert.match(applicationFavicon, /<title>AI Word 文档助手<\/title>/);
assert.doesNotMatch(applicationFavicon, /<script|onload=|javascript:/i, "站点图标不能包含可执行内容");

const nginx = await readRequired("ops/nginx/molinword.conf.example");
assert.match(nginx, /limit_req_zone\s+\$binary_remote_addr\s+zone=molinword_api:/);
assert.match(nginx, /limit_req_zone\s+\$binary_remote_addr\s+zone=molinword_ai:/);
// 中文注解：通用路由文本是 AI 路由的前缀，因此必须比较完整 location 声明，避免契约测试误判。
assert.ok(nginx.indexOf("location ^~ /api/ai/ {") < nginx.indexOf("location ^~ /api/ {"), "AI 限流 location 必须优先于通用 API location");
assert.match(nginx, /client_max_body_size\s+20m;/);
assert.match(nginx, /http2\s+on;/);
assert.match(nginx, /gzip\s+on;/, "生产入口必须实际启用 gzip 才能兑现传输预算");
assert.match(nginx, /gzip_comp_level\s+6;/, "生产 gzip 级别必须与性能门禁一致");
const gzipTypes = nginx.match(/gzip_types\s+([^;]+);/)?.[1] ?? "";
for (const mimeType of ["application/javascript", "text/javascript", "text/css"]) {
  assert.match(gzipTypes, new RegExp(`(?:^|\\s)${mimeType.replace("/", "\\/")}(?:\\s|$)`), `生产 gzip 类型缺少 ${mimeType}`);
}
assert.match(nginx, /try_files\s+\$uri\s+\$uri\/\s+\/index\.html;/);
assert.match(nginx, /location = \/index\.html \{[\s\S]*?Cache-Control "no-store" always;/, "SPA 入口必须禁止缓存以发现新版本");
assert.match(nginx, /location \^~ \/assets\/ \{[\s\S]*?Cache-Control "public, max-age=31536000, immutable" always;/, "哈希静态资源必须启用长期不可变缓存");
assert.match(nginx, /location = \/release-manifest\.json \{[\s\S]*?return 404;/, "完整制品摘要不能由静态站点直接公开");
assert.match(nginx, /error_page\s+429\s+=\s+@molinword_ai_rate_limited;/);
assert.match(nginx, /error_page\s+429\s+=\s+@molinword_api_rate_limited;/);
for (const header of ["Retry-After", "RateLimit-Limit", "RateLimit-Remaining", "RateLimit-Reset"]) {
  assert.match(nginx, new RegExp(`add_header\\s+${header}\\s+`), `Nginx 自身限流响应缺少 ${header}`);
}
assert.equal((nginx.match(/return 429 '\{"message":/g) || []).length, 2, "Nginx 限流 JSON 必须使用前端可识别的 message 字段");
const securityHeadersInclude = "include /etc/nginx/snippets/molinword-security-headers.conf;";
assert.ok(nginx.split(securityHeadersInclude).length - 1 >= 5, "服务器、缓存与限流 location 必须统一加载安全响应头");
const securityHeaders = await readRequired("ops/nginx/molinword-security-headers.conf");
for (const header of ["Strict-Transport-Security", "X-Content-Type-Options", "X-Frame-Options", "Content-Security-Policy"]) {
  assert.match(securityHeaders, new RegExp(`add_header\\s+${header}\\s+`), `安全响应头片段缺少 ${header}`);
}
const proxyInclude = "include /etc/nginx/snippets/molinword-proxy.conf;";
assert.equal(nginx.split(proxyInclude).length - 1, 2, "AI 与通用 API location 必须复用同一反向代理片段");
const proxyConfiguration = await readRequired("ops/nginx/molinword-proxy.conf");
assert.match(proxyConfiguration, /proxy_pass\s+http:\/\/127\.0\.0\.1:3001;/);
assert.match(proxyConfiguration, /proxy_set_header\s+X-Forwarded-For\s+\$proxy_add_x_forwarded_for;/);
assert.match(proxyConfiguration, /proxy_read_timeout\s+900s;/);

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
assert.match(reconciliationWorker, /status IN \('resolved', 'manual_review', 'processing', 'retry'\)/, "重复导入 outbox 时必须保留已完成、人工复核、租约处理中和退避状态");
const auditRetentionService = await readRequired("ops/systemd/molinword-ai-audit-retention.service");
assert.match(auditRetentionService, /ExecStartPre=\/usr\/bin\/node scripts\/check-runtime-config\.mjs --require-production/);
assert.match(auditRetentionService, /ExecStart=\/usr\/bin\/node scripts\/ai-audit-maintenance\.mjs cleanup/);
assert.match(auditRetentionService, /NoNewPrivileges=true/);
assert.match(auditRetentionService, /ProtectSystem=strict/);
const auditRetentionTimer = await readRequired("ops/systemd/molinword-ai-audit-retention.timer");
assert.match(auditRetentionTimer, /OnCalendar=\*-\*-\* 03:15:00/);
assert.match(auditRetentionTimer, /RandomizedDelaySec=30m/);
assert.match(auditRetentionTimer, /Persistent=true/);
const auditMigration = await readRequired("database/migrate-ai-audit-privacy.mjs");
for (const column of ["request_id", "prompt_hmac_sha256", "response_hmac_sha256", "prompt_chars", "response_chars"]) {
  assert.match(auditMigration, new RegExp(`\\["${column}"`), `AI 审计迁移缺少 ${column}`);
}
assert.match(auditMigration, /idx_ai_logs_created/);
assert.match(auditMigration, /alterClauses\.join\(", "\)/, "AI 审计迁移必须合并缺失列和索引，避免逐列重建大表");
const auditMaintenance = await readRequired("scripts/ai-audit-maintenance.mjs");
assert.match(auditMaintenance, /DATE_SUB\(CURRENT_TIMESTAMP, INTERVAL \$\{retentionDays\} DAY\)/);
assert.match(auditMaintenance, /createHmac\("sha256", auditHashKey\)/);
assert.match(auditMaintenance, /SELECT id\s+FROM ai_request_logs[\s\S]*LIMIT \$\{redactionBatchSize\}/, "历史脱敏必须先读取小型 ID 批次");
assert.match(auditMaintenance, /SELECT id, prompt, response FROM ai_request_logs WHERE id = \?/, "历史正文必须逐条读取，不能批量缓冲 MEDIUMTEXT");
assert.match(auditMaintenance, /prompt = NULL/);
assert.match(auditMaintenance, /response = NULL/);
assert.match(auditMaintenance, /if \(result\.hasRemaining\)[\s\S]*throw new Error/, "达到单轮上限且仍有积压时必须失败告警");
assert.doesNotMatch(auditMaintenance, /console\.log\([^\n]*(?:prompt|response)/i, "AI 审计维护日志不得输出客户正文");
const maintenanceService = await readRequired("ops/systemd/molinword-maintenance@.service");
for (const expected of [
  "WorkingDirectory=/opt/molinword/candidate",
  "EnvironmentFile=/etc/molinword/molinword.env",
  "ExecStartPre=/usr/bin/node scripts/check-runtime-config.mjs --require-production",
  "ExecStart=/usr/bin/npm run %I",
  "NoNewPrivileges=true",
  "ProtectSystem=strict"
]) {
  assert.ok(maintenanceService.includes(expected), `维护 systemd 模板缺少 ${expected}`);
}
const acceptanceService = await readRequired("ops/systemd/molinword-acceptance@.service");
for (const expected of [
  "WorkingDirectory=/opt/molinword/current",
  "EnvironmentFile=/etc/molinword/molinword.env",
  "ExecStartPre=/usr/bin/node scripts/check-runtime-config.mjs --require-production",
  "ExecStart=/usr/bin/node scripts/production-acceptance-evidence.mjs --release-id=%I --output-dir=/var/lib/molinword/acceptance",
  "NoNewPrivileges=true",
  "ProtectSystem=strict",
  "ReadWritePaths=/var/lib/molinword"
]) {
  assert.ok(acceptanceService.includes(expected), `验收 systemd 模板缺少 ${expected}`);
}

const productionEnvironment = await readRequired("ops/env/molinword.production.env.example");
for (const expected of [
  "APP_ENV=production",
  "NODE_ENV=production",
  "APP_HOST=127.0.0.1",
  "TRUSTED_PROXY_HOPS=1",
  "SESSION_COOKIE_SECURE=true",
  "BILLING_RECONCILIATION_OUTBOX=/var/lib/molinword/billing-reconciliation-outbox.jsonl",
  "AI_AUDIT_CONTENT_MODE=metadata",
  "AI_AUDIT_HASH_KEY=replace-with-secret-manager-value",
  "AI_AUDIT_RETENTION_DAYS=30",
  "AI_AUDIT_CLEANUP_BATCH_SIZE=1000",
  "AI_AUDIT_CLEANUP_MAX_BATCHES=20",
  "AI_AUDIT_REDACTION_BATCH_SIZE=10"
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
assert.match(runtimeCheck, /verifyReleaseManifest/, "生产运行配置预检必须同时校验实际制品清单");
const releaseManifestImplementation = await readRequired("shared/release-manifest.js");
for (const artifactRoot of [".agents", "database", "ops", "scripts", "server", "shared", "dist"]) {
  assert.match(releaseManifestImplementation, new RegExp(`artifactRoots[\\s\\S]*?"${artifactRoot.replace(".", "\\.")}"`), `发布清单必须覆盖 ${artifactRoot}`);
}
assert.match(releaseManifestImplementation, /status", "--porcelain=v1"/, "构建发布清单前必须拒绝受覆盖源码未提交");
assert.match(releaseManifestImplementation, /"ls-files", "--others", "--ignored", "--exclude-standard"/, "构建发布清单前必须拒绝被 ignore 隐藏的未提交源码");
assert.match(releaseManifestImplementation, /"ls-files", "-v", "-z"/, "构建发布清单前必须拒绝 skip-worktree 与 assume-unchanged 隐藏源码改动");
assert.match(releaseManifestImplementation, /checkoutCommit && checkoutCommit !== manifest\.gitCommit/, "存在 Git 元数据时必须校验清单提交号与 HEAD 一致");
const productionAcceptanceCollector = await readRequired("scripts/production-acceptance-evidence.mjs");
assert.match(productionAcceptanceCollector, /target\.protocol !== "https:"/, "生产验收证据采集必须默认强制 HTTPS");
assert.match(productionAcceptanceCollector, /target\.username \|\| target\.password/, "生产验收地址必须拒绝 URL 凭据");
assert.match(productionAcceptanceCollector, /process\.env\.APP_BASE_URL/, "生产验收地址必须绑定受保护环境中的批准域名");
assert.match(productionAcceptanceCollector, /lookup: createPinnedLookup\(addresses\)/, "生产验收连接必须固定到已校验的 DNS 结果");
assert.match(productionAcceptanceCollector, /addresses\.some\(\(entry\) => !isPublicAddress/, "生产验收域名任一非公网解析都必须失败关闭");
assert.match(productionAcceptanceCollector, /createBlockedAcceptanceEvidence/, "生产验收初始化失败必须生成结构化 blocked 证据");
assert.match(productionAcceptanceCollector, /maximumJsonBytes\s*=\s*64 \* 1024/, "生产验收响应正文必须设置读取上限");
assert.match(productionAcceptanceCollector, /flag: "wx"/, "生产验收证据必须拒绝覆盖历史文件");
assert.match(productionAcceptanceCollector, /health\.releaseId === normalizedReleaseId/, "生产验收证据必须绑定运行服务的发布标识");
const packageJson = JSON.parse(await readRequired("package.json"));
assert.equal(packageJson.scripts?.["check:runtime-config"], "node scripts/check-runtime-config.mjs");
assert.equal(packageJson.scripts?.["check:runtime-config:production"], "node scripts/check-runtime-config.mjs --require-production");
assert.equal(packageJson.scripts?.["check:production-acceptance"], "node scripts/check-production-acceptance-evidence.mjs");
assert.equal(packageJson.scripts?.["production:collect-acceptance"], "node scripts/production-acceptance-evidence.mjs");
assert.equal(packageJson.scripts?.["check:release-target"], "node scripts/check-release-target.mjs");
assert.equal(packageJson.scripts?.["check:release-target-contract"], "node scripts/check-release-target.mjs --self-test");
assert.equal(packageJson.scripts?.["check:release-manifest"], "node scripts/check-release-manifest.mjs");
assert.equal(packageJson.scripts?.["check:release-manifest-contract"], "node scripts/check-release-manifest-contract.mjs");
assert.equal(packageJson.scripts?.["check:frontend-performance"], "npm run build && node scripts/check-frontend-performance-budget.mjs");
assert.equal(packageJson.scripts?.["check:third-party-notices"], "node scripts/check-third-party-notices.mjs");
assert.match(packageJson.scripts?.build ?? "", /vite build && node scripts\/generate-third-party-notices\.mjs && node scripts\/generate-release-manifest\.mjs$/);
assert.equal(packageJson.scripts?.["db:migrate:ai-audit-privacy"], "node database/migrate-ai-audit-privacy.mjs");
assert.equal(packageJson.scripts?.["ai-audit:cleanup"], "node scripts/ai-audit-maintenance.mjs cleanup");
assert.equal(packageJson.scripts?.["ai-audit:redact-existing"], "node scripts/ai-audit-maintenance.mjs redact-existing");
assert.match(packageJson.scripts?.["check:commercial-readiness"] ?? "", /check:deployment-assets/);
assert.match(packageJson.scripts?.["check:commercial-readiness"] ?? "", /check:frontend-performance/);
assert.match(packageJson.scripts?.["check:commercial-readiness"] ?? "", /check:third-party-notices/);
assert.match(packageJson.scripts?.["check:commercial-readiness"] ?? "", /check:release-target-contract/);
assert.match(packageJson.scripts?.["check:commercial-readiness"] ?? "", /check:production-acceptance/);
assert.match(packageJson.scripts?.["check:commercial-readiness"] ?? "", /check:release-manifest-contract/);
assert.match(packageJson.scripts?.["check:commercial-readiness"] ?? "", /check:release-manifest/);
const thirdPartyNoticeIndex = await readRequired("public/THIRD_PARTY_NOTICES.md");
assert.match(thirdPartyNoticeIndex, /THIRD_PARTY_LICENSES\.txt/);
const releaseTarget = JSON.parse(await readRequired("ops/release-target.json"));
assert.deepEqual(releaseTarget, { os: "linux", cpu: "x64", libc: "glibc" });
const releaseTargetCheck = await readRequired("scripts/check-release-target.mjs");
assert.match(releaseTargetCheck, /glibcVersionRuntime/);
assert.match(releaseTargetCheck, /process\.argv\.includes\("--self-test"\)/);
const thirdPartyNoticeGenerator = await readRequired("scripts/generate-third-party-notices.mjs");
assert.match(thirdPartyNoticeGenerator, /dist["'], ["']THIRD_PARTY_LICENSES\.txt/);
assert.match(thirdPartyNoticeGenerator, /writeFile\(outputPath, result\.content, "utf8"\)/);
const thirdPartyNoticeBundle = await readRequired("scripts/third-party-license-bundle.mjs");
assert.match(thirdPartyNoticeBundle, /lockMetadata\.dev === true/);
assert.match(thirdPartyNoticeBundle, /licenseFilePattern/);
assert.match(thirdPartyNoticeBundle, /standardLicenseFallbacks/);
assert.match(thirdPartyNoticeBundle, /sharedUpstreamLicenseFallbacks/);
assert.match(thirdPartyNoticeBundle, /packageMetadata\.version === upstreamMetadata\.version/);
assert.match(thirdPartyNoticeBundle, /matchesReleaseTarget/);
assert.match(thirdPartyNoticeBundle, /upstreamMetadata\.optionalDependencies/);
assert.match(thirdPartyNoticeBundle, /hasValidSha512Integrity/);
assert.match(thirdPartyNoticeBundle, /sanitizePublicSource/);
assert.match(thirdPartyNoticeBundle, /trustedPackageArchiveHosts/);
assert.match(thirdPartyNoticeBundle, /archive\.port === ""/);
assert.match(thirdPartyNoticeBundle, /archive\.pathname === expectedPath/);
assert.match(thirdPartyNoticeBundle, /hasValidSharedUpstreamMetadata/);
assert.match(thirdPartyNoticeBundle, /&& isTrustedLockedArchive\(lockMetadata, packageMetadata\.name, packageMetadata\.version\)/);
assert.match(thirdPartyNoticeBundle, /return npmPackageUrl\(packageName, version\)/);
assert.match(thirdPartyNoticeBundle, /for await \(const entry of await opendir\(packageDirectory\)\)/);
assert.match(thirdPartyNoticeBundle, /await stat\(filePath\)/);
assert.match(thirdPartyNoticeBundle, /maximumTotalLicenseSourceBytes/);
assert.match(thirdPartyNoticeBundle, /maximumBundleBytes/);
const viteConfiguration = await readRequired("vite.config.ts");
assert.match(viteConfiguration, /manifest:\s*true/);
assert.match(viteConfiguration, /onlyExplicitManualChunks:\s*true/);
for (const chunkName of ["vendor-react", "vendor-icons", "editor-tiptap", "editor-prosemirror"]) {
  assert.ok(viteConfiguration.includes(`return "${chunkName}"`), `Vite 商业缓存分块缺少 ${chunkName}`);
}
const frontendPerformanceCheck = await readRequired("scripts/check-frontend-performance-budget.mjs");
assert.match(frontendPerformanceCheck, /maximumInitialGzipBytes/);
assert.match(frontendPerformanceCheck, /maximumInitialCssGzipBytes/);
assert.equal(frontendPerformanceCheck.match(/gzipSync\(content, \{ level: 6 \}\)/g)?.length, 2, "JS 与 CSS 都必须按生产 gzip 级别计算");
assert.match(frontendPerformanceCheck, /initialRequestCount\s*=\s*chunkMetrics\.length\s*\+\s*cssMetrics\.length/);
assert.match(frontendPerformanceCheck, /collectInitialImports/);
const runbook = await readRequired("ops/README.md");
assert.doesNotMatch(runbook, /\/bin\/sh\s+-c|\bsource\s+\/etc\/molinword|\. \/etc\/molinword\/molinword\.env/, "运维命令不能用 shell 执行 EnvironmentFile 中的密钥值");
assert.match(runbook, /molinword-maintenance@check:runtime-config:production\.service/);
assert.match(runbook, /molinword-maintenance@billing:reconcile:list\.service/);
assert.match(runbook, /molinword-maintenance@db:migrate:ai-audit-privacy\.service/);
assert.match(runbook, /molinword-maintenance@ai-audit:redact-existing\.service/);
assert.match(runbook, /molinword-maintenance@check:release-target\.service/, "候选版本切换前必须验证服务器发布目标");
assert.match(runbook, /molinword-maintenance@check:release-manifest\.service/, "候选版本切换前必须验证实际发布制品清单");
assert.match(runbook, /test -s dist\/THIRD_PARTY_LICENSES\.txt/, "发布切换前必须确认完整第三方许可证包存在");
assert.match(runbook, /molinword-ai-audit-retention\.timer/);
assert.match(runbook, /\/etc\/nginx\/sites-enabled\/molinword\.conf/);
assert.ok(runbook.indexOf("/etc/nginx/sites-enabled/molinword.conf") < runbook.indexOf("sudo nginx -t"), "站点必须先启用再做 Nginx 全量语法检查");
assert.match(runbook, /sudo systemctl restart molinword-api\.service/, "切换版本后必须重启已运行的 API 服务");
assert.match(runbook, /molinword-acceptance@<release-id>\.service/, "部署手册必须通过受保护环境运行生产验收采集器");
assert.match(runbook, /manual-approval-required/, "部署手册必须说明自动预检后仍需人工批准");
assert.match(runbook, /Git 提交与实际前后端制品哈希共同生成/, "部署手册必须说明发布号由实际制品派生而非环境变量自报");
for (const heading of ["发布", "验收", "回滚", "对账", "证据边界"]) {
  assert.match(runbook, new RegExp(`## .*${heading}`), `部署手册缺少“${heading}”章节`);
}

console.log("生产部署资产契约检查通过。", {
  reverseProxy: true,
  serviceManager: true,
  reconciliationTimer: true,
  auditRetentionTimer: true,
  ciGate: true,
  rollbackRunbook: true
});
