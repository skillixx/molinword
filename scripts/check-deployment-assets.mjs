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
  "User=molinword-acceptance",
  "Group=molinword-acceptance",
  "ExecStartPre=/usr/bin/node scripts/check-runtime-config.mjs --require-production",
  "ExecStart=/usr/bin/flock --exclusive /var/lib/molinword-acceptance/.acceptance.lock /usr/bin/node scripts/production-acceptance-evidence.mjs --release-id=%I --output-dir=/var/lib/molinword-acceptance",
  "NoNewPrivileges=true",
  "ProtectSystem=strict",
  "ReadWritePaths=/var/lib/molinword-acceptance"
]) {
  assert.ok(acceptanceService.includes(expected), `验收 systemd 模板缺少 ${expected}`);
}
const acceptanceFinalizeService = await readRequired("ops/systemd/molinword-acceptance-finalize@.service");
for (const expected of [
  "LoadCredential=acceptance_approval_key:/etc/molinword/acceptance-approval.key",
  "LoadCredential=acceptance_authorization:/etc/molinword/acceptance-authorization.json",
  "User=molinword-acceptance",
  "Group=molinword-acceptance",
  "ExecStartPre=/usr/bin/node scripts/check-release-manifest.mjs --expected-release-id=%I",
  "ExecStart=/usr/bin/flock --exclusive /var/lib/molinword-acceptance/.acceptance.lock /usr/bin/node scripts/finalize-production-acceptance.mjs --release-id=%I --acceptance-dir=/var/lib/molinword-acceptance",
  "NoNewPrivileges=true",
  "ProtectSystem=strict",
  "RestrictAddressFamilies=AF_UNIX",
  "ReadWritePaths=/var/lib/molinword-acceptance"
]) {
  assert.ok(acceptanceFinalizeService.includes(expected), `最终验收 systemd 模板缺少 ${expected}`);
}
assert.doesNotMatch(acceptanceFinalizeService, /EnvironmentFile=|SupplementaryGroups=molinword/, "最终签名单元不得继承 API 生产密钥读取权限");
const acceptanceVerifyService = await readRequired("ops/systemd/molinword-acceptance-verify@.service");
for (const expected of [
  "LoadCredential=acceptance_approval_key:/etc/molinword/acceptance-approval.key",
  "User=molinword-acceptance",
  "Group=molinword-acceptance",
  "ExecStart=/usr/bin/flock --shared /var/lib/molinword-acceptance/.acceptance.lock /usr/bin/node scripts/finalize-production-acceptance.mjs --verify-latest --release-id=%I --acceptance-dir=/var/lib/molinword-acceptance",
  "ProtectSystem=strict",
  "RestrictAddressFamilies=AF_UNIX",
  "ReadOnlyPaths=/var/lib/molinword-acceptance"
]) {
  assert.ok(acceptanceVerifyService.includes(expected), `验收复核 systemd 模板缺少 ${expected}`);
}
assert.doesNotMatch(acceptanceVerifyService, /EnvironmentFile=|SupplementaryGroups=molinword/, "最终复核单元不得继承 API 生产密钥读取权限");

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
assert.match(workflow, /libreoffice-writer[\s\S]*poppler-utils[\s\S]*fonts-noto-cjk/, "商业 CI 必须安装固定的 Office 渲染依赖");
assert.match(workflow, /npm run check:docx-visual-render -- --output-dir=docx-visual-artifacts/, "商业 CI 必须执行真实 DOCX 渲染门禁");
assert.match(workflow, /name: molinword-docx-visual-\$\{\{ github\.sha \}\}/, "商业 CI 必须保留按提交绑定的 Word 逐页视觉证据");
assert.doesNotMatch(workflow, /uses:\s+actions\/(?:checkout|setup-node)@v\d/, "CI 官方 Action 必须固定到确定提交");

const runtimeCheck = await readRequired("scripts/check-runtime-config.mjs");
assert.match(runtimeCheck, /validateProductionConfiguration\(process\.env\)/);
assert.match(runtimeCheck, /process\.argv\.includes\("--require-production"\)/);
assert.match(runtimeCheck, /APP_ENV 必须设置为 production/);
assert.match(runtimeCheck, /verifyReleaseManifest/, "生产运行配置预检必须同时校验实际制品清单");
const releaseManifestImplementation = await readRequired("shared/release-manifest.js");
for (const artifactRoot of [".agents", "database", "ops", "scripts", "server", "shared", "dist"]) {
  assert.match(releaseManifestImplementation, new RegExp(`releaseArtifactRoots[\\s\\S]*?"${artifactRoot.replace(".", "\\.")}"`), `发布清单必须覆盖 ${artifactRoot}`);
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
const acceptanceFinalizer = await readRequired("scripts/finalize-production-acceptance.mjs");
assert.match(acceptanceFinalizer, /createHmac\("sha256"/, "最终验收记录必须使用 HMAC-SHA256 绑定证据");
assert.match(acceptanceFinalizer, /timingSafeEqual/, "最终验收签名校验必须使用恒定时间比较");
assert.match(acceptanceFinalizer, /latest-preflight-blocked/, "最新自动预检失败时不得回退批准旧记录");
assert.match(acceptanceFinalizer, /approval-preflight-superseded/, "只读复核必须确认签名仍绑定当前最新预检");
assert.match(acceptanceFinalizer, /preflight-changed-during-finalization/, "最终签名写入前必须再次确认预检未变化");
assert.match(acceptanceFinalizer, /maximumPreflightCandidates\s*=\s*64/, "最终验收必须限制自动预检候选数量");
assert.match(acceptanceFinalizer, /O_NOFOLLOW/, "最终验收必须通过文件描述符拒绝符号链接竞态");
assert.match(acceptanceFinalizer, /authorization-grant-mismatch/, "最终验收必须把发布号、审批人和变更单绑定到独立授权凭据");
assert.match(acceptanceFinalizer, /preflight-digest-mismatch/, "人工清单必须绑定审批人复核过的最新预检摘要");
assert.match(acceptanceFinalizer, /evidence-digest-mismatch/, "人工清单中的附件摘要必须与实际文件一致");
assert.match(acceptanceFinalizer, /flag: "wx"/, "最终验收记录必须独占追加，不能覆盖旧批准");
assert.match(acceptanceFinalizer, /CREDENTIALS_DIRECTORY/, "最终验收密钥必须来自 systemd credential");
assert.match(acceptanceFinalizer, /approved-evidence-changed/, "验收复核必须重新校验原始附件完整性");
const productionReleaseBundle = await readRequired("scripts/create-production-release-bundle.mjs");
const docxVisualRender = await readRequired("scripts/check-docx-visual-render.mjs");
assert.match(docxVisualRender, /createDocxBuffer/, "视觉门禁必须使用真实导出函数生成 DOCX");
assert.match(docxVisualRender, /soffice/, "视觉门禁必须通过 LibreOffice 渲染 DOCX");
assert.match(docxVisualRender, /pdftoppm/, "视觉门禁必须把 PDF 逐页栅格化为 PNG");
assert.match(docxVisualRender, /rendered-green-color-detected/, "视觉门禁必须拒绝渲染结果中的绿色字体或图形像素");
assert.match(docxVisualRender, /rendered-content-outside-safe-area/, "视觉门禁必须拒绝越过安全页边界的内容");
assert.match(productionReleaseBundle, /verifyReleaseManifest/, "生产发布包必须先验证发布制品清单");
assert.match(productionReleaseBundle, /requireGit:\s*true/, "生产发布包必须绑定真实受控 Git 工作区");
assert.match(productionReleaseBundle, /requireClean:\s*true/, "生产发布包必须拒绝未提交的构建输入");
assert.match(productionReleaseBundle, /createGzip\(\{ level: 9, mtime: 0 \}\)/, "生产发布包压缩元数据必须可重复");
assert.match(productionReleaseBundle, /createWriteStream\(\)|archiveHandle\.createWriteStream\(\)/, "生产发布包必须通过独占文件句柄写入");
assert.match(productionReleaseBundle, /bundle-source-changed/, "生产发布包必须拒绝打包期间变化的源文件");
assert.match(productionReleaseBundle, /BUNDLE-MANIFEST\.json/, "生产发布包必须携带内部文件摘要清单");
assert.match(productionReleaseBundle, /O_NOFOLLOW/, "生产发布包必须通过文件描述符拒绝符号链接竞态");
assert.match(productionReleaseBundle, /missing-third-party-licenses/, "生产发布包必须硬性要求非空第三方许可证汇总");
assert.match(productionReleaseBundle, /createSign\("sha256"\)/, "发布包库的签名契约必须与隔离 OpenSSL signer 保持兼容");
assert.doesNotMatch(productionReleaseBundle, /RELEASE_SIGNING_PRIVATE_KEY_FILE/, "仓库 CLI 不得读取正式发布私钥路径");
assert.match(productionReleaseBundle, /!unsignedForCi \|\| process\.env\.GITHUB_ACTIONS !== "true"/, "仓库 CLI 必须只允许 GitHub Actions 无密钥打包模式");
assert.match(productionReleaseBundle, /verifyProductionReleaseArchive/, "生产发布工具必须在解压前严格复验归档类型和逐文件摘要");
assert.match(productionReleaseBundle, /verifyInstalledProductionReleaseBundle/, "生产发布工具必须在安装依赖前拒绝解压目录额外文件");
assert.match(productionReleaseBundle, /stageProductionReleaseInputs/, "可信发布工具必须先把不可信传入文件复制到新 root-only inode");
assert.match(productionReleaseBundle, /destinationHandle = await open\(destinationPath, "wx", 0o400\)/, "root-only 复验副本必须独占创建且不可覆盖");
const manualAcceptanceExample = JSON.parse(await readRequired("ops/acceptance/manual-acceptance.example.json"));
assert.equal(manualAcceptanceExample.kind, "molinword-production-manual-acceptance");
assert.deepEqual(manualAcceptanceExample.checks.map((check) => check.id), [
  "moling-sso", "http-contracts", "agent-workflow", "points-ledger", "insufficient-points",
  "failure-reconciliation", "word-visual", "multi-device", "audit-correlation", "rollback-drill"
]);
assert.equal(manualAcceptanceExample.preflightSha256, "replace-with-latest-preflight-sha256");
assert.ok(manualAcceptanceExample.checks.every((check) => check.evidenceFiles.every((evidence) => evidence.file && evidence.sha256)), "人工验收样例必须为每个附件提供路径与摘要字段");
const acceptanceAuthorizationExample = JSON.parse(await readRequired("ops/acceptance/authorization.example.json"));
assert.deepEqual(Object.keys(acceptanceAuthorizationExample).sort(), [
  "approverId", "authorizedAt", "changeId", "expiresAt", "kind", "manualSha256", "preflightSha256", "releaseId", "schemaVersion"
].sort(), "生产验收授权样例必须只包含固定字段");
assert.equal(acceptanceAuthorizationExample.kind, "molinword-production-acceptance-authorization");
assert.equal(acceptanceAuthorizationExample.preflightSha256, "replace-with-latest-preflight-sha256");
assert.equal(acceptanceAuthorizationExample.manualSha256, "replace-with-manual-json-sha256");
const packageJson = JSON.parse(await readRequired("package.json"));
const productionReleaseWorkflow = await readRequired(".github/workflows/production-release.yml");
assert.doesNotMatch(productionReleaseWorkflow, /uses:\s+actions\/[\w-]+@v\d/, "正式发布工作流的官方 Action 必须固定到确定提交");
assert.match(productionReleaseWorkflow, /workflow_dispatch:/, "正式签名发布必须只能由人工触发工作流启动");
assert.match(productionReleaseWorkflow, /environment:\s*production-release/, "正式签名发布必须使用受保护 Environment");
assert.match(productionReleaseWorkflow, /github\.ref == 'refs\/heads\/main'/, "正式签名发布只允许 main 提交");
assert.match(productionReleaseWorkflow, /secrets\.RELEASE_SIGNING_PRIVATE_KEY_PEM/, "CI 签名私钥必须来自 Environment secret");
assert.match(productionReleaseWorkflow, /printf[\s\S]*unset RELEASE_SIGNING_PRIVATE_KEY_PEM[\s\S]*openssl pkey/, "私钥落入临时文件后必须在启动外部验签进程前从环境删除");
assert.match(productionReleaseWorkflow, /npm run check:commercial-readiness[\s\S]*npm run release:bundle:unsigned-ci/, "无密钥打包前必须完整重跑商业门禁");
assert.match(productionReleaseWorkflow, /libreoffice-writer[\s\S]*npm run check:docx-visual-render -- --output-dir=docx-visual-artifacts[\s\S]*npm run release:bundle:unsigned-ci/, "正式发布必须在无密钥打包前完成真实 Word 渲染门禁");
assert.match(productionReleaseWorkflow, /name: molinword-docx-visual-\$\{\{ github\.sha \}\}/, "正式发布审批前必须上传按提交绑定的 Word 逐页视觉证据");
assert.match(productionReleaseWorkflow, /Upload Word visual evidence for approval\s+if: always\(\)/, "真实 Word 渲染失败时也必须保留已有诊断产物");
assert.match(productionReleaseWorkflow, /unsigned\/\*\.tar\.gz[\s\S]*unsigned\/\*\.tar\.gz\.sha256[\s\S]*unsigned\/\*\.tar\.gz\.sha256\.sig/, "隔离 signer job 必须上传归档、摘要和签名三件套");
const productionSignerJob = productionReleaseWorkflow.split("\n  sign:")[1] || "";
assert.match(productionSignerJob, /needs:\s*package/, "签名 job 必须只消费已通过门禁的无密钥 artifact");
assert.match(productionSignerJob, /actions\/download-artifact@[0-9a-f]{40}/, "签名 job 必须从固定版本 Action 下载待签二件套");
// 中文注解：只检查真正的 Action 引用和 shell 命令行，避免把“不得执行 npm”这类安全说明误判成命令。
const productionSignerExecutableLines = productionSignerJob
  .split(/\r?\n/)
  .filter((line) => !/^\s*#/.test(line))
  .join("\n");
assert.doesNotMatch(productionSignerExecutableLines, /uses:\s*actions\/checkout|^\s*(?:npm|npx|node|pnpm|yarn|playwright)\b/m, "持有私钥的全新 runner 不得 checkout 或执行 npm、浏览器及仓库代码");
assert.match(productionSignerJob, /grep -q '\^Modulus:'/, "RSA 签名分支必须显式识别模数字段，不能把同位数 DSA 误当成受支持算法");
assert.match(productionSignerJob, /openssl dgst -sha256 -sign/, "隔离 signer job 必须只用系统 OpenSSL 签名已校验摘要");
const viteConfig = await readRequired("vite.config.ts");
assert.match(viteConfig, /envDir:\s*false/, "前端构建必须禁用未受 Git 清单绑定的本地 .env 注入");
assert.equal(packageJson.scripts?.["check:runtime-config"], "node scripts/check-runtime-config.mjs");
assert.equal(packageJson.scripts?.["check:runtime-config:production"], "node scripts/check-runtime-config.mjs --require-production");
assert.equal(packageJson.scripts?.["check:production-acceptance"], "node scripts/check-production-acceptance-evidence.mjs");
assert.equal(packageJson.scripts?.["check:production-acceptance-finalization"], "node scripts/check-production-acceptance-finalization.mjs");
assert.equal(packageJson.scripts?.["production:collect-acceptance"], "node scripts/production-acceptance-evidence.mjs");
assert.equal(packageJson.scripts?.["production:finalize-acceptance"], "node scripts/finalize-production-acceptance.mjs");
assert.equal(packageJson.scripts?.["check:release-target"], "node scripts/check-release-target.mjs");
assert.equal(packageJson.scripts?.["check:release-target-contract"], "node scripts/check-release-target.mjs --self-test");
assert.equal(packageJson.scripts?.["check:release-manifest"], "node scripts/check-release-manifest.mjs");
assert.equal(packageJson.scripts?.["check:release-manifest-contract"], "node scripts/check-release-manifest-contract.mjs");
assert.equal(packageJson.scripts?.["check:production-release-bundle"], "node scripts/check-production-release-bundle.mjs");
assert.equal(packageJson.scripts?.["check:docx-visual-render"], "node scripts/check-docx-visual-render.mjs", "必须提供真实 Office 渲染的公开门禁命令");
assert.equal(packageJson.scripts?.["release:bundle"], undefined, "不得暴露可让仓库代码直接接触正式签名私钥的 npm 命令");
assert.equal(packageJson.scripts?.["release:bundle:unsigned-ci"], "node scripts/create-production-release-bundle.mjs --unsigned-for-ci");
assert.equal(packageJson.scripts?.["release:verify-archive"], "node scripts/verify-production-release-archive.mjs");
assert.equal(packageJson.scripts?.["release:verify-installed"], "node scripts/verify-production-release-bundle.mjs");
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
assert.match(packageJson.scripts?.["check:commercial-readiness"] ?? "", /check:production-acceptance-finalization/);
assert.match(packageJson.scripts?.["check:commercial-readiness"] ?? "", /check:release-manifest-contract/);
assert.match(packageJson.scripts?.["check:commercial-readiness"] ?? "", /check:release-manifest/);
assert.match(packageJson.scripts?.["check:commercial-readiness"] ?? "", /check:production-release-bundle/);
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
assert.match(runbook, /molinword-acceptance-finalize@<release-id>\.service/, "部署手册必须提供独立凭据保护的最终验收命令");
assert.match(runbook, /molinword-acceptance-verify@<release-id>\.service/, "部署手册必须提供最终验收附件复核命令");
assert.match(runbook, /acceptance-approval\.key/, "部署手册必须说明独立最终验收签名密钥");
assert.match(runbook, /acceptance-authorization\.json/, "部署手册必须说明按发布签发的 root-only 授权凭据");
assert.match(runbook, /有效期不超过七天/, "部署手册必须限制最终验收授权凭据的有效期");
assert.match(runbook, /独立验收用户/, "部署手册必须隔离 API 与验收目录的系统身份");
assert.match(runbook, /test "\$\(id -u molinword\)" != "\$\(id -u molinword-acceptance\)" \|\| \{[^\n]+exit 1; \}/, "部署手册必须失败中止 API 与验收用户复用 UID 的部署");
assert.match(runbook, /test "\$\(id -g molinword\)" != "\$\(id -g molinword-acceptance\)" \|\| \{[^\n]+exit 1; \}/, "部署手册必须失败中止 API 与验收用户复用主 GID 的部署");
assert.match(runbook, /完整人工清单摘要/, "部署手册必须让短期授权绑定人工清单的确定字节");
assert.match(runbook, /内核 `flock`/, "部署手册必须说明采集、签名与复核的并发锁边界");
assert.match(runbook, /gh workflow run production-release\.yml --ref main/, "部署手册必须只触发受保护双 runner 工作流生成正式三件套");
assert.match(runbook, /molinword-docx-visual-<git-sha>/, "部署手册必须要求审批人逐页复核与提交绑定的 Word 视觉证据");
assert.match(runbook, /100% 缩放逐页检查全部 PNG/, "人工签名审批必须按原始缩放逐页检查 Word 渲染证据");
assert.doesNotMatch(runbook, /RELEASE_SIGNING_PRIVATE_KEY_FILE|npm run release:bundle(?:\s|`)/, "部署手册不得指导仓库代码直接读取正式发布私钥");
assert.match(runbook, /RELEASE_SIGNING_PRIVATE_KEY_PEM/, "部署手册必须把正式私钥限定为受保护 signer Environment secret");
assert.match(runbook, /RELEASE_SIGNING_PUBLIC_KEY_FILE/, "部署手册必须从服务器预置公钥建立发布信任根");
assert.match(runbook, /verify-production-release-archive\.mjs/, "部署手册必须在解压前复验签名、摘要和归档条目");
assert.match(runbook, /VERIFIED_INCOMING=\/var\/lib\/molinword-release-incoming\/molinword-<release-id>-verified/, "验签前必须把传入制品复制到绑定发布号的 root-only 私有目录");
assert.match(runbook, /--staged-output-dir="\$VERIFIED_INCOMING"/, "可信预置工具必须限额复制到独立 inode 后再验签");
assert.match(runbook, /--strip-components=1/, "部署手册必须按固定顶层目录解压生产发布包");
assert.match(runbook, /--no-same-owner --same-permissions/, "已验证归档必须固定保留目录 0755 与文件 0644，不能受 root umask 漂移影响");
assert.match(runbook, /verify-production-release-bundle\.mjs --expected-release-id=<release-id>/, "部署手册必须在安装依赖前复验内部清单和完整文件集");
assert.match(runbook, /sudo -u molinword --chdir="\$STAGING_RELEASE"/, "解压后复验必须以运行用户身份进入 root 创建的 staging");
assert.doesNotMatch(runbook, /chown -R molinword:molinword "\$STAGING_RELEASE"/, "原子落位前不得把 staging 写权限授予长期运行 UID");
assert.match(runbook, /npm ci --prefix "\$STAGING_RELEASE" --omit=dev --ignore-scripts --no-audit --no-fund/, "生产依赖必须由 root 在只读源码 staging 中禁用生命周期脚本安装");
assert.match(runbook, /--expected-release-id=<release-id> --allow-node-modules/, "依赖安装后必须再次复验所有受控载荷且只忽略 root-owned node_modules 子树");
assert.match(runbook, /test ! -e "\$FINAL_RELEASE" && test ! -L "\$FINAL_RELEASE"/, "部署手册必须拒绝复用既有或符号链接发布目录");
assert.match(runbook, /mktemp -d \/opt\/molinword\/releases\//, "部署手册必须解压到全新 staging 目录");
assert.match(runbook, /RELEASE_LOCK=\/opt\/molinword\/releases\//, "同一发布号部署必须使用原子 mkdir 锁串行化");
assert.match(runbook, /sudo mv --no-target-directory -- "\$STAGING_RELEASE" "\$FINAL_RELEASE"/, "部署手册必须以 no-target-directory 在全部校验后原子落位");
assert.match(runbook, /rm -rf --one-file-system -- "\$VERIFIED_INCOMING"[\s\S]*rmdir -- "\$RELEASE_LOCK"/, "同发布号锁必须最后释放并覆盖 root-only 副本清理");
assert.match(runbook, /set -euo pipefail/, "部署命令块必须在任一安全门禁失败时立即停止");
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
