# 模板添加 Agent 使用文档

本文说明本项目中用于新增文档模板的一组本地 Agent。

## 一、目录结构

Agent 定义文件位于：

```text
.agents/template/
```

本地调用脚本：

```text
scripts/template-agent.mjs
```

## 二、Agent 清单

| Agent | 名称 | 主要功能 |
| --- | --- | --- |
| `template_planner_agent` | 模板策划 Agent | 联网调研、确定模板定位、分类和文档类型 |
| `template_content_agent` | 模板内容 Agent | 生成大纲、默认要求和正文占位 |
| `template_visual_asset_agent` | 模板贴图生成 Agent | 设计封面、缩略图、配色和贴图素材 |
| `template_word_style_agent` | 模板 Word 样式 Agent | 生成 Word 导出样式 JSON |
| `template_publish_agent` | 模板入库 Agent | 更新 seed、写 MySQL、上传 MinIO、登记 `files` 索引 |
| `template_visual_qa_agent` | 模板视觉验收 Agent | 打开浏览器验收视觉效果、触发返工、构建、提交并推送 |

## 三、本地调用命令

列出全部 Agent：

```bash
npm run template-agent -- list
```

查看推荐工作流：

```bash
npm run template-agent -- workflow
```

查看某个 Agent 的完整定义：

```bash
npm run template-agent -- show template_planner_agent
```

生成某个 Agent 的调用提示词：

```bash
npm run template-agent -- prompt template_planner_agent --input tmp/template-request.json
```

如果不传 `--input`，默认使用空 JSON：

```bash
npm run template-agent -- prompt template_visual_qa_agent
```

## 四、推荐工作流

```text
template_planner_agent
  -> template_content_agent
  -> template_visual_asset_agent
  -> template_word_style_agent
  -> template_publish_agent
  -> template_visual_qa_agent
```

## 五、调用示例

准备输入文件：

```json
{
  "templateNeed": "新增一个项目复盘报告模板",
  "targetUser": "项目经理",
  "usageScene": "项目结束后做内部总结",
  "industry": "软件项目管理"
}
```

保存为：

```text
tmp/template-request.json
```

生成模板策划 Agent 调用提示词：

```bash
npm run template-agent -- prompt template_planner_agent --input tmp/template-request.json
```

然后把输出提示词交给当前 AI 执行，或复制到支持 Agent 的平台中创建对应 Agent。

## 六、重要边界

- `template_planner_agent` 可以联网，但不能入库、不能上传 MinIO。
- `template_publish_agent` 可以写项目和操作 MySQL/MinIO，但不负责视觉审美。
- `template_visual_qa_agent` 必须打开浏览器验收模板商业化效果，验收失败不能提交代码。
- 最终只有 `template_visual_qa_agent` 可以在验收通过后提交并推送远程仓库。

## 七、和模板新增文档的关系

新增模板的具体字段、SQL、MinIO 路径和验收步骤见：

```text
docs/add-document-template-guide.md
```

