# AGENTS.md

本文件是 AI Word 文档助手项目的协作说明。后续使用 Codex 或其他 Agent 处理本项目时，应优先阅读并遵守本文档。

## 一、项目概览

本项目是 `molinword`，一个 AI Word 文档助手。

当前核心能力：

- AI 生成大纲
- AI 生成正文
- 局部润色、续写、扩写、缩写、纠错
- 文档保存与版本记录
- Word 导出
- MySQL 文档与模板存储
- MinIO 文件与模板素材存储
- 墨灵平台 SSO 与积分计费
- 模板库动态读取与模板素材展示

## 二、技术栈

- 前端：Vite + React + TypeScript
- 富文本编辑：Tiptap
- 后端：Node.js + Express
- 数据库：MySQL，使用 `mysql2`
- 文件存储：MinIO
- Word 导出：`docx`
- AI 模型：DeepSeek 或兼容 OpenAI chat/completions 的 HTTP 接口

## 三、开发要求

- 编写代码时，需要使用中文注解说明关键逻辑。
- 注释应解释业务意图或复杂逻辑，不写无意义注释。
- 不要把真实密钥、token、数据库密码、MinIO 密钥写入代码或文档。
- 不要提交 `.env`、`node_modules/`、`dist/`、`*.tsbuildinfo`。
- 修改已有用户改动时，必须保留用户已有内容，不要无故回滚。
- 新增功能后，优先运行对应验证命令。

## 四、常用命令

本地前端：

```bash
npm run dev
```

本地后端：

```bash
npm run api
```

构建验证：

```bash
npm run build
```

初始化或更新系统模板：

```bash
npm run db:seed:templates
```

查看模板 Agent：

```bash
npm run template-agent -- list
npm run template-agent -- workflow
npm run template-agent -- show template_planner_agent
```

## 五、模板库相关规则

模板数据当前由 MySQL `document_templates` 表管理。

模板素材当前复用 MySQL `files` 表索引，真实文件存储在 MinIO。

模板素材路径规范：

```text
templates/{templateId}/cover/{fileName}
templates/{templateId}/styles/{fileName}
templates/{templateId}/assets/{fileName}
templates/{templateId}/examples/{fileName}
```

`files.purpose` 可用值：

```text
template_cover
template_style
template_asset
```

模板新增操作文档：

```text
docs/add-document-template-guide.md
```

模板 Agent 使用文档：

```text
docs/template-agents-guide.md
```

模板 Agent 定义目录：

```text
.agents/template/
```

## 六、模板 Agent 分工

新增文档模板时，推荐按以下顺序调用 Agent：

```text
template_planner_agent
  -> template_content_agent
  -> template_visual_asset_agent
  -> template_word_style_agent
  -> template_publish_agent
  -> template_visual_qa_agent
```

各 Agent 职责：

- `template_planner_agent`：联网调研，确定模板定位、分类、文档类型。
- `template_content_agent`：生成大纲、默认要求、正文占位。
- `template_visual_asset_agent`：设计封面、缩略图、配色和贴图素材。
- `template_word_style_agent`：生成 Word 导出样式 JSON。
- `template_publish_agent`：更新 seed、写 MySQL、上传 MinIO、登记 `files` 索引。
- `template_visual_qa_agent`：打开浏览器做视觉验收，检查商业化效果，验收通过后提交并推送。

## 七、接口与安全规则

模板接口：

```text
GET /api/templates
GET /api/templates/{templateId}
GET /api/templates/{templateId}/cover
GET /api/templates/{templateId}/assets/{fileId}/download
```

安全要求：

- 前端不能直接访问 MinIO。
- 前端不能展示 MinIO `bucket`、`object_key`、access key、secret key。
- 文件读取和下载必须走后端代理接口。
- 导出 Word 返回值不能包含 `bucket` 或 `objectKey`。
- 后端错误应返回用户可理解的中文提示，真实错误只保留在服务端日志。

## 八、验证清单

模板相关改动至少验证：

```bash
npm run build
npm run db:seed:templates
```

接口检查：

```text
GET http://127.0.0.1:3001/api/templates
GET http://127.0.0.1:3001/api/templates/{templateId}
GET http://127.0.0.1:3001/api/templates/{templateId}/cover
```

前端检查：

- 打开 `http://127.0.0.1:5188/`
- 进入模板库
- 检查模板卡片、封面、素材状态
- 点击模板，确认主题、类型、补充要求、大纲填充正常
- 创建文档并导出 Word，确认样式正常

## 九、提交规则

提交前应检查：

```bash
git status --short --branch
```

提交信息建议：

```text
feat: add xxx document template
docs: update template agent guide
fix: handle template asset fallback
```

如果用户要求提交远程仓库：

```bash
git add ...
git commit -m "..."
git push origin main
```

