# molinword 生产部署运行手册

本目录提供 Nginx、systemd、生产环境变量样例、计费对账和 AI 审计保留定时任务。它们是可审计的部署基线，不包含真实密钥，也不会替代目标环境的备份、域名、证书、数据库迁移或墨灵平台授权。

## 一、部署前提

- 与 `ops/release-target.json` 一致的 Linux x64 glibc 服务器已安装 Node.js 22、npm、Nginx 1.25.1 或更高版本和 systemd；其他架构或 musl 发行版必须先修改发布目标并重新构建、验证许可证包。
- 已创建无登录权限的 `molinword` 系统用户，代码目录为 `/opt/molinword`。
- MySQL、MinIO、墨灵内部 API 和模型网关已准备专用生产账号及最小权限。
- 域名与 TLS 证书已就绪，应用端口 `3001` 仅监听 `127.0.0.1`，不直接暴露公网。
- 发布前已在 CI 或受控构建机执行 `npm ci`、`npm run check:commercial-readiness` 和 `npm run build`。

## 二、发布

以下命令中的 `<release-id>`、域名和路径必须由部署人员替换。不要把 `.env`、本地日志、截图、测试压缩包或开发缓存复制到服务器。

```bash
sudo install -d -m 0755 /opt/molinword/releases
sudo install -d -m 0755 -o molinword -g molinword /opt/molinword/releases/<release-id>
sudo install -d -m 0750 -o root -g molinword /etc/molinword
sudo install -m 0640 -o root -g molinword ops/env/molinword.production.env.example /etc/molinword/molinword.env
sudo install -m 0644 ops/systemd/molinword-api.service /etc/systemd/system/molinword-api.service
sudo install -m 0644 ops/systemd/molinword-maintenance@.service /etc/systemd/system/molinword-maintenance@.service
sudo install -m 0644 ops/systemd/molinword-reconcile.service /etc/systemd/system/molinword-reconcile.service
sudo install -m 0644 ops/systemd/molinword-reconcile.timer /etc/systemd/system/molinword-reconcile.timer
sudo install -m 0644 ops/systemd/molinword-ai-audit-retention.service /etc/systemd/system/molinword-ai-audit-retention.service
sudo install -m 0644 ops/systemd/molinword-ai-audit-retention.timer /etc/systemd/system/molinword-ai-audit-retention.timer
sudo install -d -m 0755 /etc/nginx/snippets
sudo install -m 0644 ops/nginx/molinword-security-headers.conf /etc/nginx/snippets/molinword-security-headers.conf
sudo install -m 0644 ops/nginx/molinword-proxy.conf /etc/nginx/snippets/molinword-proxy.conf
sudo install -m 0644 ops/nginx/molinword.conf.example /etc/nginx/sites-available/molinword.conf
```

先编辑 `/etc/molinword/molinword.env`，按 systemd `EnvironmentFile` 语法通过密钥管理系统注入真实值；再编辑 Nginx 配置中的域名和证书路径。禁止把密钥直接写入命令历史。将已通过门禁且包含 `dist/` 的发布目录复制到 `/opt/molinword/releases/<release-id>`，确认文件归属 `molinword:molinword`，然后在服务器安装纯生产依赖。候选软链接让维护单元验证新版本，同时不影响当前服务：

```bash
cd /opt/molinword/releases/<release-id>
test -s dist/THIRD_PARTY_LICENSES.txt
sudo -u molinword npm ci --omit=dev
sudo ln -sfn /opt/molinword/releases/<release-id> /opt/molinword/candidate
sudo systemctl daemon-reload
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

随后逐项执行 `docs/production-deployment-checklist.md` 的真实链路验收，保存请求 ID、时间、测试账号、调用前后积分、对账任务、Word 样例和桌面/移动端截图。`/api/ready` 必须为 200；仅 `/api/health` 为 200 不能证明数据库、MinIO 或模型网关可用。

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
- 只有在目标环境完成真实 SSO、积分、MySQL、MinIO、模型、Word 打开和多设备视觉验收，才能标记为生产可用。
- 本手册不会创建生产账号、申请证书、修改防火墙、执行迁移或脱敏、启用定时器或发布真实流量；这些操作必须由部署人员按变更流程授权执行。
