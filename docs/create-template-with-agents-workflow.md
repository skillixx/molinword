# 使用 Agent 创建文档模板流程

本文说明如何使用项目中的模板 Agent，从一个模板需求开始，完成模板策划、内容生成、封面与样式设计、入库发布、视觉验收和远程提交。

## 一、适用场景

当需要新增一类 Word 文档模板时，使用本文流程。例如：

- 项目复盘报告模板
- 周报模板
- 投标方案模板
- 培训方案模板
- 政府申报材料模板
- 活动策划模板
- 合同协议模板
- 论文开题报告模板

## 二、前置条件

本地项目需要具备：

```bash
npm install
```

后端和前端可启动：

```bash
npm run api
npm run dev
```

模板 Agent 能正常列出：

```bash
npm run template-agent -- list
```

MySQL 和 MinIO 环境需要可用：

- `DATABASE_URL` 已配置。
- `STORAGE_ENDPOINT` 已配置。
- `STORAGE_BUCKET` 已配置。
- `STORAGE_ACCESS_KEY_ID` 已配置。
- `STORAGE_SECRET_ACCESS_KEY` 已配置。

## 三、Agent 工作流总览

推荐按以下顺序执行：

```text
template_planner_agent
  -> template_content_agent
  -> template_visual_asset_agent
  -> template_word_style_agent
  -> template_publish_agent
  -> template_visual_qa_agent
```

各 Agent 分工：

| 顺序 | Agent | 作用 | 是否联网 |
| --- | --- | --- | --- |
| 1 | `template_planner_agent` | 调研模板结构，确定模板定位 | 可以 |
| 2 | `template_content_agent` | 生成大纲、要求、正文占位 | 可选 |
| 3 | `template_visual_asset_agent` | 设计封面、缩略图、配色 | 可选 |
| 4 | `template_word_style_agent` | 生成 Word 样式 JSON | 不需要 |
| 5 | `template_publish_agent` | 更新 seed、写库、上传 MinIO、登记索引 | 不需要 |
| 6 | `template_visual_qa_agent` | 打开浏览器验收，合格后提交推送 | 不需要 |

## 四、第一步：准备模板需求输入

建议先创建一个临时输入文件：

```text
tmp/template-request.json
```

示例：

```json
{
  "templateNeed": "新增一个项目复盘报告模板",
  "targetUser": "项目经理、产品经理、交付负责人",
  "usageScene": "项目结束后做内部复盘和管理汇报",
  "industry": "软件项目管理",
  "stylePreference": "商务、简洁、专业、有数据复盘感"
}
```

如果没有 `tmp` 目录，可以直接新建。临时文件不建议提交。

## 五、第二步：调用模板策划 Agent

生成调用提示词：

```bash
npm run template-agent -- prompt template_planner_agent --input tmp/template-request.json
```

把输出提示词交给 AI 执行。

模板策划 Agent 应输出：

```json
{
  "name": "项目复盘报告模板",
  "category": "项目管理",
  "documentType": "工作总结",
  "topic": "项目复盘报告",
  "requirement": "突出项目目标、执行过程、成果数据、问题原因和后续改进计划。",
  "researchSummary": "项目复盘文档通常包含目标、过程、成果、问题、经验和改进。",
  "sources": [],
  "handoffNotes": "大纲需要兼顾管理汇报和复盘分析。"
}
```

注意：

- 策划 Agent 可以联网。
- 不允许复制网络模板全文。
- 输出只作为后续 Agent 的输入，不直接入库。

## 六、第三步：调用模板内容 Agent

将模板策划 Agent 的输出保存为：

```text
tmp/template-planner-output.json
```

生成调用提示词：

```bash
npm run template-agent -- prompt template_content_agent --input tmp/template-planner-output.json
```

模板内容 Agent 应输出：

```json
{
  "name": "项目复盘报告模板",
  "category": "项目管理",
  "documentType": "工作总结",
  "topic": "项目复盘报告",
  "requirement": "突出项目目标、执行过程、成果数据、问题原因、经验总结和后续改进计划。",
  "outline": [
    "一、项目背景与目标",
    "二、项目执行过程回顾",
    "三、关键成果与数据",
    "四、问题与原因分析",
    "五、经验总结",
    "六、后续改进计划"
  ],
  "content": "",
  "contentNotes": "正文由 AI 根据大纲生成，模板只保留占位。"
}
```

质量要求：

- 大纲建议 4 到 7 项。
- 章节标题要具体。
- 不要输出空泛章节，如“其他”“总结”等。

## 七、第四步：调用模板贴图生成 Agent

将模板内容结果保存为：

```text
tmp/template-content-output.json
```

生成调用提示词：

```bash
npm run template-agent -- prompt template_visual_asset_agent --input tmp/template-content-output.json
```

模板贴图生成 Agent 应输出：

```json
{
  "coverPrompt": "生成一张 16:9 商务风项目复盘报告封面，现代简洁，包含项目进度线、数据图表、复盘看板元素，不包含真实品牌 Logo。",
  "thumbnailPrompt": "生成一张适合模板库卡片展示的项目复盘缩略图，简洁清晰，突出数据复盘和改进计划。",
  "style": {
    "primaryColor": "#2f6f63",
    "accentColor": "#8dbdb2",
    "backgroundColor": "#eef7f4"
  },
  "assets": [
    {
      "name": "模板封面",
      "purpose": "template_cover",
      "fileName": "{templateId}-cover.png",
      "objectKey": "templates/{templateId}/cover/{templateId}-cover.png"
    }
  ],
  "visualNotes": "封面应体现项目复盘、数据分析和商务汇报感。"
}
```

注意：

- 默认生成原创视觉素材。
- 可以联网参考风格，但不能复制网络图片。
- 如果第一版不接真实图片生成，可以先使用 seed 脚本生成 SVG 封面。

## 八、第五步：调用模板 Word 样式 Agent

将视觉 Agent 输出保存为：

```text
tmp/template-visual-output.json
```

生成调用提示词：

```bash
npm run template-agent -- prompt template_word_style_agent --input tmp/template-visual-output.json
```

模板 Word 样式 Agent 应输出：

```json
{
  "fontFamily": "Microsoft YaHei",
  "titleColor": "2f6f63",
  "headingColor": "245f55",
  "accentColor": "8dbdb2",
  "titleSize": 36,
  "headingSize": 28,
  "bodySize": 22,
  "lineSpacing": 360
}
```

注意：

- 颜色值不要带 `#`。
- 输出必须是当前后端 `createDocxBuffer` 可识别的字段。

## 九、第六步：调用模板入库 Agent

将前面三个 Agent 的结果合并成一个发布输入：

```text
tmp/template-publish-input.json
```

示例：

```json
{
  "template": {
    "name": "项目复盘报告模板",
    "category": "项目管理",
    "documentType": "工作总结",
    "topic": "项目复盘报告",
    "requirement": "突出项目目标、执行过程、成果数据、问题原因、经验总结和后续改进计划。",
    "outline": [
      "一、项目背景与目标",
      "二、项目执行过程回顾",
      "三、关键成果与数据",
      "四、问题与原因分析",
      "五、经验总结",
      "六、后续改进计划"
    ],
    "content": "",
    "sortOrder": 70
  },
  "visualAssets": {
    "style": {
      "primaryColor": "#2f6f63",
      "accentColor": "#8dbdb2",
      "backgroundColor": "#eef7f4"
    },
    "assets": []
  },
  "wordStyle": {
    "fontFamily": "Microsoft YaHei",
    "titleColor": "2f6f63",
    "headingColor": "245f55",
    "accentColor": "8dbdb2",
    "titleSize": 36,
    "headingSize": 28,
    "bodySize": 22,
    "lineSpacing": 360
  }
}
```

生成调用提示词：

```bash
npm run template-agent -- prompt template_publish_agent --input tmp/template-publish-input.json
```

模板入库 Agent 应执行：

1. 更新 `database/seed-document-templates.mjs`。
2. 添加模板配置。
3. 添加封面配色。
4. 添加 Word 样式配置。
5. 执行：

```bash
npm run db:seed:templates
```

6. 必要时重启后端：

```bash
npm run api
```

7. 确认 MySQL 和 MinIO 写入成功。

发布 Agent 输出：

```json
{
  "templateId": 7,
  "mysqlUpdated": true,
  "minioUploaded": true,
  "filesIndexed": true,
  "seedUpdated": true,
  "coverUrl": "/api/templates/7/cover",
  "handoffNotes": "请验收模板库显示、封面质量和 Word 导出样式。"
}
```

## 十、第七步：调用模板视觉验收 Agent

准备验收输入：

```text
tmp/template-qa-input.json
```

示例：

```json
{
  "templateId": 7,
  "templateName": "项目复盘报告模板",
  "expectedChanges": [
    "新增项目复盘报告模板",
    "新增模板封面",
    "新增 Word 样式",
    "更新模板 seed 数据"
  ]
}
```

生成调用提示词：

```bash
npm run template-agent -- prompt template_visual_qa_agent --input tmp/template-qa-input.json
```

视觉验收 Agent 必须检查：

- 打开 `http://127.0.0.1:5188/`
- 进入模板库
- 查看模板封面是否美观
- 判断模板是否符合商业化质量
- 查看是否显示“已配置封面”
- 查看是否显示“已配置 Word 样式”
- 点击模板，确认主题、类型、要求、大纲填充
- 进入编辑页，确认当前模板样式提示
- 创建文档并导出 Word
- 确认接口不暴露 MinIO 密钥、`bucket`、`object_key`
- 运行构建：

```bash
npm run build
```

验收通过后，视觉验收 Agent 才能提交并推送：

```bash
git status --short --branch
git add ...
git commit -m "feat: add project review document template"
git push origin main
```

## 十一、不合格返工规则

如果验收不通过，根据问题交给对应 Agent：

| 问题 | 返工 Agent |
| --- | --- |
| 封面不美观、像测试图 | `template_visual_asset_agent` |
| 封面和模板主题不匹配 | `template_visual_asset_agent` |
| Word 样式太普通或颜色不协调 | `template_word_style_agent` |
| 大纲不专业、章节空泛 | `template_content_agent` |
| MySQL 没写入 | `template_publish_agent` |
| MinIO 没有素材文件 | `template_publish_agent` |
| 前端不显示封面或状态 | `template_publish_agent` 或开发 Agent |

返工后必须重新执行发布和视觉验收。

## 十二、最终交付物

一个新增模板完成后，应至少包含：

- `document_templates` 中的模板数据
- `files` 中的模板素材索引
- MinIO 中的封面文件
- MinIO 中的 Word 样式 JSON
- 前端模板库可见的模板卡片
- 可用的 Word 导出样式
- 通过视觉验收的商业化模板效果
- 远程仓库中的提交记录

## 十三、快速命令清单

```bash
npm run template-agent -- list
npm run template-agent -- workflow
npm run template-agent -- prompt template_planner_agent --input tmp/template-request.json
npm run template-agent -- prompt template_content_agent --input tmp/template-planner-output.json
npm run template-agent -- prompt template_visual_asset_agent --input tmp/template-content-output.json
npm run template-agent -- prompt template_word_style_agent --input tmp/template-visual-output.json
npm run template-agent -- prompt template_publish_agent --input tmp/template-publish-input.json
npm run template-agent -- prompt template_visual_qa_agent --input tmp/template-qa-input.json
npm run db:seed:templates
npm run build
```

## 十四、注意事项

- 不要提交 `tmp/` 里的临时输入输出文件。
- 不要把真实密钥写入 Agent 输入。
- 不要把 MinIO `bucket` 和 `object_key` 暴露给前端。
- 模板策划 Agent 可以联网，模板入库和验收 Agent 不建议联网。
- 视觉验收失败时，不允许提交代码。
- 新增文档类型前，要先修改前端 `DocumentType` 和 `documentTypes`。

