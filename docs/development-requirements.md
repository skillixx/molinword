# AI Word 文档助手开发需求整理

## 一、项目目标

本项目要开发一个本地可运行、后续可接入墨灵平台的 AI Word 文档助手。

第一阶段目标不是立即对接真实墨灵平台，而是先在本地完成产品主流程，让用户可以看到并体验：

- 工作台页面
- 新建 AI 文档
- 生成文档大纲
- 编辑正文内容
- 使用 AI 助手润色
- 后续导出 Word 的入口

后续再逐步接入：

- 墨灵 Token 网关
- 墨灵平台 SSO
- MySQL 数据库
- MinIO 文件存储
- Word 导出
- 平台计费

## 二、当前开发策略

当前采用“先本地产品原型，再平台接入”的开发路线。

原因：

- 可以先验证 AI Word 工具的产品体验。
- 不依赖真实墨灵平台也能快速开发和演示。
- 后续平台 SSO、计费、权限可以通过预留接口逐步接入。
- 避免一开始卡在平台配置、商品、资产、计费联调上。

当前阶段原则：

- 前端页面先可访问、可点击、可编辑。
- AI 先支持本地模拟，配置墨灵 Token 网关后再切换真实模型。
- 不在浏览器中暴露墨灵 `sk` 密钥。
- 所有 AI 请求必须通过本地后端代理。

## 三、技术选型

### 1. 前端

- Vite
- React
- TypeScript
- CSS
- lucide-react 图标

### 2. 本地后端代理

- Node.js
- Express
- dotenv

本地后端主要用于代理墨灵 Token 网关，避免前端暴露密钥。

### 3. AI 模型接入

优先使用墨灵 Token 网关。

网关接口采用 OpenAI 兼容格式：

```text
POST /v1/chat/completions
```

推荐模型：

```text
deepseek-chat
```

### 4. 后续数据库

后续使用：

- MySQL
- Prisma

### 5. 后续文件存储

后续使用：

- MinIO

用于存储：

- 上传的 Word 文档
- 文档图片
- 导出的 `.docx`
- 后续可能生成的 PDF

## 四、当前已完成内容

### 1. 本地前端工程

已完成 Vite + React + TypeScript 工程。

主要文件：

- `package.json`
- `index.html`
- `tsconfig.json`
- `vite.config.ts`
- `src/main.tsx`
- `src/styles.css`

### 2. 工作台页面

已实现：

- 左侧导航栏
- 本地模拟用户状态
- 新建 AI 文档入口
- 文档主题输入
- 文档类型选择
- 写作语气选择
- 补充要求输入
- 最近文档列表

### 3. 文档编辑页面

已实现三栏布局：

- 左侧：文档大纲
- 中间：正文编辑器
- 右侧：AI 助手

已实现按钮入口：

- 保存
- 导出 Word
- 润色当前内容
- 继续写下一段
- 优化大纲结构

### 4. 本地 AI 模拟

当前在未配置墨灵 Token 网关时，会自动使用本地模拟结果。

支持：

- 模拟生成大纲
- 模拟润色内容

### 5. 墨灵 Token 网关代理骨架

已新增本地 API 服务：

```text
server/index.js
```

已实现接口：

```text
GET /api/health
POST /api/ai/generate-outline
POST /api/ai/polish
```

前端通过 Vite 代理访问本地后端：

```text
/api -> http://127.0.0.1:3001
```

### 6. 环境变量示例

已新增：

```text
.env.example
```

配置项：

```env
MOLIN_GATEWAY_BASE_URL=http://8.130.9.163:8080/v1
MOLIN_GATEWAY_API_KEY=sk-molin-请替换成你的密钥
MOLIN_GATEWAY_MODEL=deepseek-chat
LOCAL_API_PORT=3001
```

## 五、当前启动方式

需要启动两个服务。

### 1. 启动本地 API 代理

```powershell
npm run api
```

默认地址：

```text
http://127.0.0.1:3001
```

健康检查：

```text
http://127.0.0.1:3001/api/health
```

### 2. 启动前端页面

```powershell
npm run dev
```

访问地址：

```text
http://127.0.0.1:5188
```

## 六、墨灵 Token 网关接入需求

### 1. 接入原则

墨灵 `sk` 密钥不能写在前端代码里，也不能暴露到浏览器。

正确流程：

```text
前端页面
  -> 请求本地 /api/ai/*
  -> 本地 Node 后端读取 .env
  -> 后端携带 sk 请求墨灵 Token 网关
  -> 返回 AI 结果给前端
```

### 2. 需要用户提供的信息

后续真实接入时，需要提供：

```text
MOLIN_GATEWAY_BASE_URL
MOLIN_GATEWAY_API_KEY
MOLIN_GATEWAY_MODEL
```

示例：

```env
MOLIN_GATEWAY_BASE_URL=http://8.130.9.163:8080/v1
MOLIN_GATEWAY_API_KEY=sk-molin-真实密钥
MOLIN_GATEWAY_MODEL=deepseek-chat
```

### 3. 当前支持的 AI 能力

当前已预留：

- 生成大纲
- 润色正文

后续需要扩展：

- 生成完整正文
- 继续写下一段
- 扩写
- 缩写
- 纠错
- 总结
- 优化大纲
- 生成小标题

## 七、墨灵平台正式接入需求

当前暂不对接真实墨灵平台。

后续正式接入时，需要实现以下能力。

### 1. SSO 入口

用户从墨灵平台点击进入应用后，跳转到本应用入口：

```text
/molin/launch?ticket=lt_xxx
```

本应用后端调用墨灵平台：

```text
POST /api/internal/app-launch/verify
```

换取：

```text
user_id
app_id
product_id
```

然后本应用建立自己的本地会话。

### 2. 用户数据归属

正式接入后，所有业务数据都需要绑定墨灵用户：

- 文档
- 文档版本
- 上传文件
- 导出文件
- AI 请求记录

### 3. 使用权校验

正式接入后，进入应用和调用核心功能前，需要校验用户是否有使用权。

校验依据：

- active 资产
- 商品使用权限
- 额度是否足够

### 4. 计费接入

建议先设计以下 `usage_type`：

```text
word_outline_generate
word_body_generate
word_polish
word_export_docx
```

可选计费方式：

- 后付钱包：`POST /api/internal/product-usage-events`
- 预付积分：`POST /api/internal/entitlement-consume`
- 高成本任务：`reserve -> settle / release`

## 八、后续数据库需求

后续接入 MySQL 后，建议设计以下数据表。

### 1. documents

用于保存文档主信息。

字段建议：

- id
- user_id
- title
- document_type
- tone
- outline_json
- content
- status
- created_at
- updated_at

### 2. document_versions

用于保存文档历史版本。

字段建议：

- id
- document_id
- content
- outline_json
- version_note
- created_at

### 3. files

用于保存 MinIO 文件索引。

字段建议：

- id
- user_id
- document_id
- file_name
- file_type
- file_size
- bucket
- object_key
- purpose
- created_at

### 4. ai_request_logs

用于记录 AI 调用日志。

字段建议：

- id
- user_id
- document_id
- action_type
- model
- prompt
- response
- status
- error_message
- created_at

## 九、后续 MinIO 需求

建议创建以下 bucket：

```text
molinword-uploads
molinword-exports
molinword-images
```

对象路径建议：

```text
documents/{documentId}/uploads/{fileName}
documents/{documentId}/exports/{fileName}
documents/{documentId}/images/{fileName}
```

## 十、Word 导出需求

后续需要实现 `.docx` 导出。

建议使用：

```text
docx
```

导出时需要保留：

- 标题层级
- 正文段落
- 列表
- 表格
- 图片
- 封面
- 目录

第一版导出目标：

- 能导出 `.docx`
- 标题和正文格式清晰
- 支持基础段落和换行
- 导出文件保存到 MinIO
- 前端返回下载链接

## 十一、页面功能需求

### 1. 工作台

需要支持：

- 新建文档
- 最近文档
- 文档搜索
- 文档继续编辑
- 文档删除
- 文档复制

当前已完成：

- 新建文档 UI
- 最近文档 UI

未完成：

- 数据库存储
- 搜索
- 删除
- 复制

### 2. 创建文档

需要支持：

- 选择文档类型
- 输入主题
- 选择语气
- 输入补充要求
- 生成大纲

当前已完成：

- 表单 UI
- 生成大纲入口
- AI 代理骨架

未完成：

- 正式 AI 生成质量优化
- 生成失败提示
- 加载状态

### 3. 编辑器

需要支持：

- 正文编辑
- 大纲展示
- 点击大纲定位章节
- 保存
- 导出 Word
- AI 助手

当前已完成：

- 三栏布局
- 文本编辑
- 大纲展示
- AI 助手入口

未完成：

- 富文本编辑器
- 自动保存
- 保存到 MySQL
- 导出 Word
- 选中文字后 AI 操作

### 4. AI 助手

需要支持：

- 润色
- 扩写
- 缩写
- 纠错
- 续写
- 优化大纲
- 生成正文

当前已完成：

- 润色接口入口
- 本地代理调用
- 未配置网关时降级模拟

未完成：

- 选中文本操作
- 流式输出
- 错误提示
- token 用量展示

## 十二、开发阶段规划

### 第一阶段：本地可视化原型

目标：本地能打开页面并体验主流程。

状态：已基本完成。

内容：

- 前端工程
- 工作台
- 编辑器
- 本地模拟 AI
- 本地 API 代理
- 墨灵 Token 网关配置预留

### 第二阶段：AI 能力接入

目标：配置墨灵 Token 网关后，真实生成内容。

内容：

- 真实生成大纲
- 真实润色
- 生成正文
- 续写
- 扩写
- 缩写
- 错误提示
- 加载状态

### 第三阶段：文档保存

目标：文档可以保存和继续编辑。

内容：

- MySQL
- Prisma
- documents 表
- document_versions 表
- 自动保存
- 历史文档列表

### 第四阶段：Word 导出

目标：能导出 `.docx`。

内容：

- docx 导出
- MinIO 存储
- files 表
- 下载链接
- 基础排版

### 第五阶段：墨灵平台正式接入

目标：平台用户可以从墨灵进入应用，并完成身份打通。

内容：

- `/molin/launch`
- ticket verify
- 本地 session
- user_id 绑定
- 使用权校验

### 第六阶段：平台计费

目标：核心 AI 功能可以按次或按积分计费。

内容：

- usage_type 设计
- 后付计费上报
- 预付积分扣减
- 幂等键
- 额度不足提示
- 消费日志

## 十三、验收标准

### 当前阶段验收

- 能访问 `http://127.0.0.1:5188`
- 能看到 AI Word 文档助手工作台
- 能填写主题、类型、语气
- 点击生成大纲后进入编辑器
- 编辑器能显示大纲和正文
- 点击润色能调用本地代理
- 未配置墨灵网关时可以降级为模拟 AI
- `npm run build` 构建通过

### AI 接入阶段验收

- `.env` 配置真实墨灵 `sk`
- `/api/health` 显示 `gatewayConfigured=true`
- 生成大纲返回真实模型结果
- 润色返回真实模型结果
- 浏览器中看不到 `sk` 密钥

### 平台接入阶段验收

- 能从墨灵平台进入本应用
- 应用能接收 `ticket`
- 后端能 verify 并获取 `user_id`
- 文档数据能绑定 `user_id`
- 无使用权用户不能使用核心功能

## 十四、近期下一步建议

建议下一步按以下顺序开发：

1. 增加 AI 调用加载状态和错误提示。
2. 完善墨灵 Token 网关真实调用调试。
3. 增加“生成正文”功能。
4. 接入富文本编辑器。
5. 接入 MySQL + Prisma。
6. 实现文档保存和最近文档。
7. 实现基础 Word 导出。
8. 接入 MinIO。
9. 最后再接墨灵 SSO 和计费。

## 十五、明确暂不做的内容

第一版暂不做：

- 多人协作
- 企业知识库
- 权限系统
- 复杂审批流程
- 在线支付
- 高级版本对比

这些能力后续可以根据产品验证情况再规划。
