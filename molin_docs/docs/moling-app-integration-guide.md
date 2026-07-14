# 魔灵平台应用对接通用指南

> 本文总结 PPT AI 应用接入魔灵平台的实际联调方式，供后续其他应用复用。
>
> 适用场景：第三方或独立业务应用接入魔灵平台，实现「应用市场售卖、平台免登、购买开通、资产校验、积分/额度扣减、消费对账」。
>
> 安全说明：本文不记录任何真实 `INTERNAL_API_TOKEN`、用户密码、管理员密码或生产密钥。所有敏感值必须通过环境变量或密钥管理系统注入。

---

## 1. 总体分工

魔灵平台和应用的边界必须清楚：

| 角色 | 负责 |
|---|---|
| 魔灵平台 | 用户、登录、应用市场、商品、套餐、价格、购买、资产、权益额度、钱包、计费流水、SSO 票据 |
| 接入应用 | 业务功能本身、应用会话、用前校验、用时调用平台扣费/扣额度接口 |

一句话：

```text
平台负责卖和记账，应用负责功能和在正确时机调用平台接口。
```

---

## 2. 推荐接入架构

```text
用户
  ↓
魔灵平台应用市场
  ↓ 点击进入应用，平台签发一次性 ticket
接入应用 /enter?ticket=lt_xxx
  ↓ verify ticket
接入应用自己的 session
  ↓
业务功能
  ↓
调用魔灵内部接口扣额度/扣费
```

应用侧建议封装一个 `PlatformClient`，业务代码不要直接散落 HTTP 调用。

```text
PlatformClient
  ├─ verifyLaunchTicket
  ├─ getEntitlementBalance
  ├─ reserveEntitlement
  ├─ settleEntitlement
  ├─ releaseEntitlement
  └─ consumeEntitlement
```

---

## 3. 平台侧必须配置的内容

### 3.1 应用

在魔灵管理后台创建应用。

关键字段：

| 字段 | 说明 | 示例 |
|---|---|---|
| `code` | 应用编码，全局唯一 | `ppt-ai` |
| `name` | 应用名称 | `PPT AI 生成器` |
| `type` | 应用类型 | `application` |
| `access_url` | 用户点击进入应用时跳转地址 | `https://your-app.example.com/enter` |
| `status` | 必须为 active | `active` |

`access_url` 必须能接收：

```text
https://your-app.example.com/enter?ticket=lt_xxx
```

### 3.2 应用适配器

适配器用于登记应用对接能力和用量类型。

关键字段：

| 字段 | 说明 |
|---|---|
| `app_code` | 必须与应用 code 一致 |
| `app_name` | 应用名称 |
| `app_type` | 应用类型 |
| `adapter_type` | 外部应用通常填 `external` |
| `service_name` | 应用服务名 |
| `callback_url` | 应用入口或回调地址 |
| `supported_actions_json` | 支持动作，如 `["provision","cancel"]` |
| `usage_event_types_json` | 应用可能产生的用量类型 |
| `status` | 必须为 active |

注意：

- 字段值不要带前后空格，尤其是 `app_name`、`service_name`。
- prepaid 积分制不一定通过 usage event 扣钱，但仍建议登记 `usage_event_types_json`，方便统计和治理。

### 3.3 商品

要让应用可购买，必须把应用挂成商品。

关键字段：

| 字段 | 说明 |
|---|---|
| `product_type` | 通常填 `application` |
| `business_ref_id` | 指向应用 `app_id` |
| `product_code` | 商品编码 |
| `name` | 商品名称 |
| `status` | 必须为 active |

示例关系：

```text
applications.id = 15
products.product_type = application
products.business_ref_id = 15
```

### 3.4 套餐和价格

商品必须配置套餐和默认价格，否则用户可能看得到但买不了。

prepaid 积分/额度应用的套餐需要配置 `quota_json`。

示例：

```json
{
  "quota_unit": "credits",
  "valid_days": 365,
  "quota_total": 10,
  "entitlement_type": "ppt_ai_credits"
}
```

要求：

- 每个可购买套餐必须有默认价。
- `quota_unit`、`entitlement_type` 要稳定，不要随意改名。
- 套餐编码要和额度一致，例如 1000 积分不要命名成 `enterprise-100`。

### 3.5 访问权限

商品访问权限必须给目标用户角色打开：

```text
can_view = true
can_buy  = true
can_use  = true
```

常见问题：

- `can_view=false`：用户市场看不到。
- `can_buy=false`：用户能看到但不能买。
- `can_use=false`：用户买了但使用时应被拦截。

### 3.6 内部接口凭证和 IP 白名单

涉及内部扣费/扣额度接口时，平台方必须配置：

```text
INTERNAL_API_TOKEN
INTERNAL_ALLOWED_IPS
```

应用服务器出口 IP 必须在白名单内。

内部接口请求必须带：

```http
X-Internal-Token: <INTERNAL_API_TOKEN>
```

---

## 4. 应用侧需要的环境变量

建议每个接入应用都使用下面这些环境变量：

```bash
MOLING_API_BASE_URL=
INTERNAL_API_TOKEN=
APP_ID=
PRODUCT_ID=
DEFAULT_ENTITLEMENT_ID= # 仅联调可用，生产不建议固定
PORT=
```

要求：

- 不要把 token 写进代码、文档、仓库。
- 不要在日志中打印 token。
- token 泄露后必须轮换。

---

## 5. SSO 免登流程

用户从魔灵平台点击「进入应用」时，平台跳转：

```text
https://your-app.example.com/enter?ticket=lt_xxx
```

应用后端处理：

```text
1. 读取 ticket
2. 调魔灵内部接口 verify
3. 校验返回的 app_id/product_id 是否匹配当前应用
4. 建立应用自己的 session
5. 跳转应用 dashboard
```

接口：

```http
POST /api/internal/app-launch/verify
Content-Type: application/json
X-Internal-Token: <INTERNAL_API_TOKEN>

{
  "launch_ticket": "lt_xxx"
}
```

成功返回包含：

```json
{
  "user_id": 479,
  "app_id": 15,
  "product_id": 73
}
```

注意：

- ticket 一次性、短时有效。
- ticket 无效、过期或已使用时，不要重试同一张 ticket。
- 应用必须建立自己的 session，不要把 ticket 当长期凭证。

---

## 6. 用前校验

应用进入业务功能前，需要确认用户有权使用。

最低要求：

```text
verify ticket 返回 app_id/product_id 匹配当前应用
```

prepaid 积分制还需要确认用户有可用额度。

当前魔灵内部余额接口要求已知 `entitlement_id`：

```http
GET /api/internal/entitlement-balance?user_id={user_id}&entitlement_id={entitlement_id}
X-Internal-Token: <INTERNAL_API_TOKEN>
```

返回示例：

```json
{
  "entitlement_id": 62,
  "user_id": 479,
  "quota_total": "10",
  "quota_used": "0",
  "quota_reserved": "0",
  "remaining": "10",
  "status": "active",
  "usable": true
}
```

应用判断：

```text
usable == true
remaining >= 本次需要扣减的额度
```

重要限制：

当前接口不能按 `user_id + product_id` 列出 entitlement。生产建议平台补一个内部接口：

```text
GET /api/internal/entitlements?user_id={user_id}&product_id={product_id}
```

或者让 `app-launch/verify` 返回该用户当前可用的 entitlement 信息。

---

## 7. prepaid 积分/额度扣减方式

prepaid 应用使用额度接口，不走 `product-usage-events` 扣钱包。

### 7.1 贵操作：reserve -> settle/release

适合：

- AI 生成
- 长任务
- 可能失败的任务
- 成本较高的任务

流程：

```text
1. reserve 预占额度
2. 执行业务
3. 成功 settle
4. 失败 release
```

#### 预占

```http
POST /api/internal/entitlement-reserve
Content-Type: application/json
X-Internal-Token: <INTERNAL_API_TOKEN>

{
  "user_id": 479,
  "entitlement_id": 62,
  "amount": "6",
  "idempotency_key": "task_xxx:ppt_generate:reserve"
}
```

成功返回：

```json
{
  "hold_id": 120,
  "reserved": "6",
  "available": "4",
  "status": "holding"
}
```

#### 成功结算

```http
POST /api/internal/entitlement-settle
Content-Type: application/json
X-Internal-Token: <INTERNAL_API_TOKEN>

{
  "hold_id": 120,
  "actual_amount": "6"
}
```

#### 失败释放

```http
POST /api/internal/entitlement-release
Content-Type: application/json
X-Internal-Token: <INTERNAL_API_TOKEN>

{
  "hold_id": 120
}
```

### 7.2 轻操作：consume

适合：

- 修改单条记录
- 重新生成一张图片
- 已知用量且失败成本可接受的动作

```http
POST /api/internal/entitlement-consume
Content-Type: application/json
X-Internal-Token: <INTERNAL_API_TOKEN>

{
  "user_id": 479,
  "entitlement_id": 62,
  "amount": "2",
  "idempotency_key": "task_xxx:ppt_slide_edit"
}
```

---

## 8. 字段类型要求

魔灵内部额度接口对 JSON 字段类型敏感。

必须传数字：

```json
{
  "user_id": 479,
  "entitlement_id": 62,
  "hold_id": 120
}
```

不要传字符串：

```json
{
  "user_id": "479",
  "entitlement_id": "62",
  "hold_id": "120"
}
```

否则可能返回：

```json
{
  "code": 40000,
  "message": "请求参数错误"
}
```

应用侧应在 Platform Client 中统一做类型转换：

```text
userId -> positive integer
entitlementId -> positive integer
holdId -> positive integer
amount -> decimal string
```

金额和额度数量仍建议用字符串 decimal：

```json
{
  "amount": "6"
}
```

---

## 9. 幂等键规则

每次扣费或扣额度动作必须有稳定幂等键。

推荐格式：

```text
{业务任务ID}:{动作类型}
```

示例：

```text
task_abc:ppt_generate:reserve
task_abc:ppt_slide_edit
task_abc:ppt_image_generate
```

要求：

- 同一个业务动作重试时必须复用同一个幂等键。
- 不要每次重试都生成新的幂等键。
- 幂等键要落库，方便失败重试和对账。

---

## 10. 应用侧接口建议

每个接入应用可以参考以下接口设计。

### 10.1 进入应用

```http
GET /enter?ticket=lt_xxx
```

职责：

- verify ticket
- 建立 session
- 跳转 dashboard

### 10.2 当前用户

```http
GET /api/me
```

返回：

```json
{
  "user_id": 479,
  "app_id": 15,
  "product_id": 73
}
```

### 10.3 查询额度

```http
GET /api/entitlement-balance?entitlement_id=62
```

### 10.4 执行业务任务

```http
POST /api/tasks
```

内部流程：

```text
reserve
业务执行
settle 或 release
```

---

## 11. 错误处理规范

### 11.1 ticket 错误

平台返回：

```json
{
  "code": 40003,
  "message": "票据无效、已过期或已被使用"
}
```

应用处理：

```text
提示用户重新从魔灵平台进入应用
不要重试同一张 ticket
```

### 11.2 额度不足

平台返回：

```json
{
  "code": 60005,
  "message": "权益额度不足"
}
```

应用处理：

```text
提示用户购买积分包或升级套餐
不要执行业务任务
```

### 11.3 参数错误

平台返回：

```json
{
  "code": 40000,
  "message": "请求参数错误"
}
```

优先检查：

- `user_id` 是否为数字。
- `entitlement_id` 是否为数字。
- `hold_id` 是否为数字。
- `amount` 是否为正数。
- entitlement 是否属于当前 user。
- entitlement 状态是否 active。

### 11.4 失败后的补偿

如果业务任务失败：

```text
必须 release hold
```

如果 `release` 失败：

```text
记录任务状态为 release_failed
后台用同一个 hold_id 重试 release
```

如果业务成功但 `settle` 失败：

```text
记录任务状态为 settle_failed
后台用同一个 hold_id 重试 settle
暂不开放最终结果或标记需要对账
```

---

## 12. 验收流程

### 12.1 平台配置验收

检查：

```text
应用 active
适配器 active
商品 active
商品 product_type=application
商品 business_ref_id=app_id
套餐 active
套餐 quota_json 正确
默认价格已配置
目标角色 can_view/can_buy/can_use=true
INTERNAL_API_TOKEN 可用
应用服务器 IP 在 INTERNAL_ALLOWED_IPS
```

### 12.2 公网入口验收

访问：

```text
https://your-app.example.com/enter
```

预期：

```text
返回“缺少 ticket”
```

访问：

```text
https://your-app.example.com/api/me
```

预期：

```text
返回 401 unauthorized
```

访问：

```text
https://your-app.example.com/enter?ticket=lt_invalid_check_only
```

预期：

```text
返回“票据无效、已过期或已被使用”
```

如果以上返回，说明公网、Nginx、应用服务和内部 verify 调用都通。

### 12.3 端到端验收

用测试用户从魔灵平台点击进入应用：

```text
魔灵平台 -> /enter?ticket=lt_xxx -> 应用 dashboard
```

然后验证：

```text
显示 user_id/app_id/product_id
能查到积分余额
业务成功时 reserve -> settle
业务失败时 reserve -> release
余额变化符合预期
```

---

## 13. 部署方式

推荐部署：

```text
Nginx HTTPS
  ↓
127.0.0.1:{APP_PORT}
  ↓
接入应用 Node/Go/Python 服务
```

Nginx 关键配置：

```nginx
location / {
    proxy_pass http://127.0.0.1:5177;
    proxy_http_version 1.1;

    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

公网域名需要完成备案或使用不会被拦截的域名。若域名被云厂商备案拦截，请求不会到达应用服务。

---

## 14. 常见问题

### Q1：`/enter` 返回缺少 ticket 是不是错误？

不是。直接访问 `/enter` 没有平台 ticket，返回缺少 ticket 是正确行为。

### Q2：`/api/me` 返回 401 是不是错误？

不是。未通过 `/enter?ticket=...` 建立应用 session 前，返回 401 是正确行为。

### Q3：点击业务按钮返回“请求参数错误”怎么办？

优先检查字段类型。魔灵额度接口要求 `user_id`、`entitlement_id`、`hold_id` 是数字，不是字符串。

### Q4：为什么应用不能自己用 user_id 找 entitlement？

当前魔灵只提供按 `entitlement_id` 查询余额的内部接口。生产建议补充内部 entitlement 列表接口，或在 `app-launch/verify` 返回可用 entitlement。

### Q5：prepaid 需要配置 product_billing_rules 吗？

不一定。prepaid 扣额度走 `entitlement-*` 接口，不走 `product-usage-events`。但仍建议在应用适配器中登记 `usage_event_types_json`。

---

## 15. 后续平台建议

为提高其他应用接入效率，建议魔灵平台补充：

1. 内部查询用户应用权益接口：

```http
GET /api/internal/entitlements?user_id={user_id}&product_id={product_id}
```

2. 或在 launch verify 返回当前商品可用 entitlement：

```json
{
  "user_id": 479,
  "app_id": 15,
  "product_id": 73,
  "entitlements": [
    {
      "id": 62,
      "entitlement_type": "ppt_ai_credits",
      "remaining": "10",
      "quota_unit": "credits",
      "usable": true
    }
  ]
}
```

3. 后台表单对 `app_name`、`service_name` 自动 trim。

4. 后台对 `plan_code` 和 `quota_total` 做一致性提醒。

5. 内部接口参数错误时返回更具体的字段错误，例如：

```json
{
  "code": 40000,
  "message": "entitlement_id must be number"
}
```
