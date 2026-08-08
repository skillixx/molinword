# molinword 生产部署运行手册

本目录提供 Nginx、systemd、生产环境变量样例、计费对账和 AI 审计保留定时任务。它们是可审计的部署基线，不包含真实密钥，也不会替代目标环境的备份、域名、证书、数据库迁移或墨灵平台授权。

## 一、部署前提

- 与 `ops/release-target.json` 一致的 Linux x64 glibc 服务器已安装 Node.js 22、npm、Nginx 1.25.1 或更高版本和 systemd；其他架构或 musl 发行版必须先修改发布目标并重新构建、验证许可证包。
- 已创建无登录权限的 `molinword` API 用户和独立的 `molinword-acceptance` 验收用户，代码目录为 `/opt/molinword`；两个用户不得复用 UID，验收用户的 0700 状态目录不能授予 API 用户访问权。
- MySQL、MinIO、墨灵内部 API 和模型网关已准备专用生产账号及最小权限。
- 域名与 TLS 证书已就绪，应用端口 `3001` 仅监听 `127.0.0.1`，不直接暴露公网。
- 发布前已在 CI 或受控构建机执行 `npm ci`、`npm run check:commercial-readiness` 和 `npm run build`；构建生成的 `dist/release-manifest.json` 已通过制品哈希校验。

## 二、发布

以下命令中的 `<release-id>` 必须使用 `npm run check:release-manifest` 输出的发布号，域名和路径由部署人员替换。发布号由 Git 提交与实际前后端制品哈希共同生成，不能手工指定。不要把 `.env`、本地日志、截图、测试压缩包或开发缓存复制到服务器。

```bash
sudo install -d -m 0755 /opt/molinword/releases
getent passwd molinword-acceptance >/dev/null || sudo useradd --system --user-group --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin molinword-acceptance
test "$(id -u molinword)" != "$(id -u molinword-acceptance)" || { echo "验收用户与 API 用户复用了 UID，停止部署" >&2; exit 1; }
test "$(id -g molinword)" != "$(id -g molinword-acceptance)" || { echo "验收用户与 API 用户复用了主 GID，停止部署" >&2; exit 1; }
sudo install -d -m 0755 -o molinword -g molinword /opt/molinword/releases/<release-id>
sudo install -d -m 0750 -o root -g molinword /etc/molinword
sudo install -m 0640 -o root -g molinword ops/env/molinword.production.env.example /etc/molinword/molinword.env
sudo install -m 0644 ops/systemd/molinword-api.service /etc/systemd/system/molinword-api.service
sudo install -m 0644 ops/systemd/molinword-maintenance@.service /etc/systemd/system/molinword-maintenance@.service
sudo install -m 0644 ops/systemd/molinword-acceptance@.service /etc/systemd/system/molinword-acceptance@.service
sudo install -m 0644 ops/systemd/molinword-acceptance-finalize@.service /etc/systemd/system/molinword-acceptance-finalize@.service
sudo install -m 0644 ops/systemd/molinword-acceptance-verify@.service /etc/systemd/system/molinword-acceptance-verify@.service
sudo install -m 0644 ops/systemd/molinword-reconcile.service /etc/systemd/system/molinword-reconcile.service
sudo install -m 0644 ops/systemd/molinword-reconcile.timer /etc/systemd/system/molinword-reconcile.timer
sudo install -m 0644 ops/systemd/molinword-ai-audit-retention.service /etc/systemd/system/molinword-ai-audit-retention.service
sudo install -m 0644 ops/systemd/molinword-ai-audit-retention.timer /etc/systemd/system/molinword-ai-audit-retention.timer
sudo install -d -m 0755 /etc/nginx/snippets
sudo install -m 0644 ops/nginx/molinword-security-headers.conf /etc/nginx/snippets/molinword-security-headers.conf
sudo install -m 0644 ops/nginx/molinword-proxy.conf /etc/nginx/snippets/molinword-proxy.conf
sudo install -m 0644 ops/nginx/molinword.conf.example /etc/nginx/sites-available/molinword.conf
```

先编辑 `/etc/molinword/molinword.env`，按 systemd `EnvironmentFile` 语法通过密钥管理系统注入真实值；再编辑 Nginx 配置中的域名和证书路径。最终验收签名另用独立、至少 32 字节的高熵凭据，通过安全来源写入 root-only 文件。该密钥不放进 API 的 `EnvironmentFile`，只由最终验收 systemd 单元临时加载：

```bash
sudo install -m 0400 -o root -g root /secure/approved/acceptance-approval.key /etc/molinword/acceptance-approval.key
```

禁止把任何密钥值直接写入命令历史，也不能复用数据库、模型、存储、会话或 AI 审计密钥。将已通过门禁且包含 `dist/` 的发布目录复制到与清单发布号同名的 `/opt/molinword/releases/<release-id>`，确认文件归属 `molinword:molinword`，然后在服务器安装纯生产依赖。候选软链接让维护单元验证新版本，同时不影响当前服务：

```bash
cd /opt/molinword/releases/<release-id>
test -s dist/THIRD_PARTY_LICENSES.txt
sudo -u molinword npm ci --omit=dev
sudo ln -sfn /opt/molinword/releases/<release-id> /opt/molinword/candidate
sudo systemctl daemon-reload
sudo systemctl start 'molinword-maintenance@check:release-target.service'
sudo systemctl start 'molinword-maintenance@check:release-manifest.service'
sudo systemctl start 'molinword-maintenance@check:runtime-config:production.service'
```

执行数据库操作前先核对目标库、备份与回滚方案。以下命令会修改真实数据库和模板存储，只能在获批变更窗口中逐条执行：

```bash
sudo systemctl start 'molinword-maintenance@db:migrate:document-template.service'
sudo systemctl start 'molinword-maintenance@db:migrate:document-page-layout.service'
sudo systemctl start 'molinword-maintenance@db:migrate:billing-reconciliation.service'
sudo systemctl start 'molinword-maintenance@db:migrate:ai-audit-privacy.service'
sudo systemctl start 'molinword-maintenance@db:seed:templates.service'
```

历史 `ai_request_logs` 可能仍含客户提示词和模型正文。完成备份、配置不与数据库及其他服务凭据复用的 `AI_AUDIT_HASH_KEY` 并取得隐私负责人批准后，才可执行以下不可逆脱敏；脚本按 `AI_AUDIT_REDACTION_BATCH_SIZE` 小批次逐条读取正文，补 HMAC-SHA256 指纹与字符数后立即清空原文，达到批次上限且仍有积压时会失败告警，需复核日志并再次执行：

```bash
sudo systemctl start 'molinword-maintenance@ai-audit:redact-existing.service'
journalctl -u 'molinword-maintenance@ai-audit:redact-existing.service' -n 100 --no-pager
```

迁移完成后先启用并验证 Nginx 站点；语法通过后再切换原子软链接，并明确重启 API，避免已运行服务继续使用旧版本：

```bash
sudo ln -sfn /etc/nginx/sites-available/molinword.conf /etc/nginx/sites-enabled/molinword.conf
sudo nginx -t
sudo ln -sfn /opt/molinword/releases/<release-id> /opt/molinword/current
sudo systemctl daemon-reload
sudo systemctl enable molinword-api.service
sudo systemctl restart molinword-api.service
sudo systemctl enable --now molinword-reconcile.timer
# 仅在 AI_AUDIT_RETENTION_DAYS 已通过业务与隐私审批后启用
sudo systemctl enable --now molinword-ai-audit-retention.timer
sudo systemctl reload nginx
```

## 三、验收

```bash
curl -fsS http://127.0.0.1:3001/api/health
curl -fsS https://word.example.com/api/health
curl -fsS https://word.example.com/api/ready
systemctl status molinword-api.service --no-pager
systemctl status molinword-reconcile.timer --no-pager
systemctl status molinword-ai-audit-retention.timer --no-pager
journalctl -u molinword-api.service -n 100 --no-pager
```

先运行只读、自动脱敏的生产预检。专用 systemd 单元只从受保护的 `EnvironmentFile` 读取批准过的 `APP_BASE_URL`，不会发送 Cookie、Authorization 或客户正文，只访问固定的首页、健康、就绪、404 和未登录认证探针；证据文件采用独占创建，禁止覆盖旧记录：

```bash
sudo install -d -m 0700 -o molinword-acceptance -g molinword-acceptance /var/lib/molinword-acceptance
sudo systemctl start 'molinword-acceptance@<release-id>.service'
sudo systemctl status 'molinword-acceptance@<release-id>.service' --no-pager
sudo ls -lt /var/lib/molinword-acceptance/<release-id>-*.json
```

采集器会要求运行服务重新校验制品后由 `/api/health` 返回的发布号与 systemd 实例中的发布号完全一致；生产域名必须与 `APP_BASE_URL` 完全一致，所有 DNS 结果都必须是公网地址，连接还会固定到已检查的地址以阻止 DNS 重绑定。每次运行都会以发布时间、采集时间和随机标识追加新证据，不覆盖同一版本的历史失败记录；域名解析超时、失败或出现非公网结果时也会写入不含目标 URL 的结构化 `blocked` 证据。自动检查通过时，证据中的 `automaticStatus` 为 `passed`，但 `releaseDecision` 固定为 `manual-approval-required`。随后仍须逐项执行 `docs/production-deployment-checklist.md` 的真实链路验收，填写证据中十项人工 `manualChecks`，保存测试账号、HTTP 契约、四阶段智能体、调用前后积分、对账任务、Word 样例、三端截图、审计关联和回滚演练记录。`/api/ready` 必须为 200；仅 `/api/health` 为 200 或自动预检通过都不能证明业务已获准上线。

十项真实验收完成后，由获批操作人准备人工清单与附件。附件目录和 JSON 中的附件路径必须使用相同发布号前缀；清单只允许固定字段，禁止把密码、Cookie、token 或客户正文写进文件名和 JSON：

```bash
sudo -u molinword-acceptance install -d -m 0700 /var/lib/molinword-acceptance/<release-id>-evidence
sudo -u molinword-acceptance install -m 0600 /opt/molinword/current/ops/acceptance/manual-acceptance.example.json \
  /var/lib/molinword-acceptance/<release-id>-manual.json
# 由获批操作人填写 releaseId、approverId、changeId、UTC approvedAt、最新预检摘要和每个脱敏附件摘要
```

使用服务器 `sha256sum` 计算最新预检和每个附件的 SHA-256，先把摘要填写到人工清单，再计算完整 `<release-id>-manual.json` 的 SHA-256。审批人在外部变更系统复核这些确定字节后，按 `ops/acceptance/authorization.example.json` 签发短期授权 JSON；它必须精确绑定发布号、审批人、变更单、最新预检摘要和完整人工清单摘要，`expiresAt` 晚于 `authorizedAt` 且有效期不超过七天。由安全来源安装 root-only 授权后再提交最终验收：

```bash
sudo install -m 0400 -o root -g root /secure/approved/acceptance-authorization.json /etc/molinword/acceptance-authorization.json
```

独立验收用户隔离了长期运行的 API 进程；API 不能读取、替换或删除 0700 验收目录中的预检、人工清单、附件和批准记录。采集、签名和只读复核单元还通过同一内核 `flock` 串行化，签名期间不能由受支持流程插入新预检。最终验收单元只采用时间上最新的一份预检；如果最新预检失败，不会回退批准更早的成功记录。它要求 root 管理的短期授权精确匹配已复核摘要，随后校验十项人工检查、审批时间和附件边界，重新计算并比对全部 SHA-256，再使用独立 systemd credential 对完整记录做 HMAC-SHA256 签名并独占追加。完成后立即用只读单元复核签名、当前最新预检及原始附件是否仍与摘要一致：

```bash
sudo systemctl start 'molinword-acceptance-finalize@<release-id>.service'
sudo systemctl status 'molinword-acceptance-finalize@<release-id>.service' --no-pager
sudo systemctl start 'molinword-acceptance-verify@<release-id>.service'
sudo systemctl status 'molinword-acceptance-verify@<release-id>.service' --no-pager
sudo ls -lt /var/lib/molinword-acceptance/<release-id>-approval-*.json
```

只有最新预检为 `passed`、签名记录为 `releaseDecision=approved`、只读复核通过且变更单中的授权人完成签字，才能关闭 `manual-approval-required`。修改预检、人工清单或任一附件后，旧签名复核会失败，必须重新验收并追加新批准记录。

## 四、对账

定时器每 5 分钟先导入持久卷 outbox，再使用原幂等键重试待对账任务。查看执行证据：

```bash
systemctl list-timers molinword-reconcile.timer
journalctl -u molinword-reconcile.service -n 100 --no-pager
sudo systemctl start 'molinword-maintenance@billing:reconcile:list.service'
journalctl -u 'molinword-maintenance@billing:reconcile:list.service' -n 100 --no-pager
```

进入 `manual_review` 的任务禁止直接修改额度表或盲目释放；应核对墨灵账本、原幂等键和平台响应后人工处理。

## 五、AI 审计保留

生产必须设置 `AI_AUDIT_CONTENT_MODE=metadata`，并由密钥系统注入独立、至少 32 字符的 `AI_AUDIT_HASH_KEY`。新请求只保存请求 ID、固定动作、模型、状态、耗时、字符数和 HMAC-SHA256 指纹，不保存提示词或模型正文。`AI_AUDIT_RETENTION_DAYS` 示例为 30 天，但必须按业务、合同和适用法规批准后确定。每日任务分批删除超过保留期的元数据；若单轮上限后仍有积压，任务以失败退出以触发监控：

```bash
systemctl list-timers molinword-ai-audit-retention.timer
journalctl -u molinword-ai-audit-retention.service -n 100 --no-pager
```

脱敏和过期删除都不可恢复；不得在未备份、未确认目标库或未获批时手工运行。运行日志只记录影响行数，不记录客户内容。

## 六、回滚

应用回滚只切换到上一份已验证发布，不删除新版本，也不自动回滚数据库或用户文档：

```bash
sudo ln -sfn /opt/molinword/releases/<previous-release-id> /opt/molinword/current
sudo ln -sfn /opt/molinword/releases/<previous-release-id> /opt/molinword/candidate
sudo systemctl restart molinword-api.service
curl -fsS http://127.0.0.1:3001/api/health
curl -fsS https://word.example.com/api/ready
```

AI 审计迁移只新增可空列与索引，旧版本可忽略；已经脱敏或按保留期删除的日志不会因应用回滚而恢复。如果其他新迁移与旧版本不兼容，停止回滚并按已批准的数据库恢复方案处理。禁止在没有备份和影响评估时执行破坏性 SQL。

## 七、证据边界

- 仓库门禁通过，只证明代码、构建、依赖许可证、自包含商业门禁和部署资产契约通过。
- systemd `active` 只证明进程运行；Nginx 200 只证明入口可访问。
- 只有在目标环境完成真实 SSO、积分、MySQL、MinIO、模型、Word 打开和多设备视觉验收，并生成、复核获批签名记录后，才能标记为生产可用。
- 本手册不会创建生产账号、申请证书、修改防火墙、执行迁移或脱敏、启用定时器或发布真实流量；这些操作必须由部署人员按变更流程授权执行。
