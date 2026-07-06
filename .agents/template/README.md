# 模板添加 Agent 总览

本目录定义 AI Word 文档助手新增文档模板时使用的本地 Agent。

## Agent 清单

| Agent | 名称 | 主要职责 |
| --- | --- | --- |
| `template_planner_agent` | 模板策划 Agent | 联网调研、确定模板定位、分类和文档类型 |
| `template_content_agent` | 模板内容 Agent | 生成大纲、默认要求和正文占位 |
| `template_visual_asset_agent` | 模板贴图生成 Agent | 设计封面、缩略图、配色和贴图素材 |
| `template_word_style_agent` | 模板 Word 样式 Agent | 生成 Word 导出样式 JSON |
| `template_publish_agent` | 模板入库 Agent | 更新 seed、写 MySQL、上传 MinIO、登记 files 索引 |
| `template_visual_qa_agent` | 模板视觉验收 Agent | 浏览器视觉验收、返工调度、构建、提交并推送 |

## 推荐调用顺序

```text
template_planner_agent
  -> template_content_agent
  -> template_visual_asset_agent
  -> template_word_style_agent
  -> template_publish_agent
  -> template_visual_qa_agent
```

## 本地调用

查看 Agent 列表：

```bash
npm run template-agent -- list
```

查看某个 Agent：

```bash
npm run template-agent -- show template_planner_agent
```

生成某个 Agent 的调用提示词：

```bash
npm run template-agent -- prompt template_planner_agent --input examples/template-request.json
```

