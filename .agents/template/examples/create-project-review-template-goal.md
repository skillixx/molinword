# Goal 示例：自动创建项目复盘报告模板

复制下面这段 Goal，即可让模板 Agent 按完整流程自动创建一个文档模板。

```text
Goal：使用模板 Agent 自动创建一个【项目复盘报告】文档模板，适合项目经理、产品经理、交付负责人在项目结束后做内部复盘和管理汇报，风格要求商务、简洁、专业、有数据复盘感。

请按以下 Agent 流程执行：

template_planner_agent
  -> template_content_agent
  -> template_visual_asset_agent
  -> template_word_style_agent
  -> template_publish_agent
  -> template_visual_qa_agent

需要完成的内容：

1. 模板策划
   - 可以联网搜索公开资料，调研项目复盘报告的常见结构。
   - 总结行业常见章节和写作重点。
   - 不要复制网络模板全文。
   - 输出模板名称、分类、文档类型、默认主题、补充要求。

2. 模板内容
   - 生成专业、可用的大纲。
   - 大纲建议 4 到 7 项。
   - 生成默认正文占位或留空。
   - 确保点击模板后能填充主题、类型、要求和大纲。

3. 模板贴图
   - 设计模板封面和缩略图方案。
   - 封面比例优先 16:9。
   - 风格要商业化、清晰、专业。
   - 不使用真实品牌 Logo。
   - 不复制网络图片。

4. Word 样式
   - 生成当前后端可识别的 Word 样式 JSON。
   - 包含 fontFamily、titleColor、headingColor、accentColor、titleSize、headingSize、bodySize、lineSpacing。
   - 颜色使用 6 位十六进制，不带 #。

5. 入库发布
   - 更新 `database/seed-document-templates.mjs`。
   - 写入 MySQL `document_templates`。
   - 上传封面和 Word 样式到 MinIO。
   - 在 `files` 表写入模板素材索引。
   - MinIO object key 遵守：
     - `templates/{templateId}/cover/{fileName}`
     - `templates/{templateId}/styles/{fileName}`
     - `templates/{templateId}/assets/{fileName}`
     - `templates/{templateId}/examples/{fileName}`
   - 数据库只保存文件索引，不保存真实文件内容。

6. 视觉验收
   - 打开 `http://127.0.0.1:5188/`。
   - 进入模板库查看新增模板。
   - 检查封面是否美观、清晰、无错位、无文字重叠。
   - 判断模板是否符合商业化模板质量。
   - 检查是否显示“已配置封面”和“已配置 Word 样式”。
   - 点击模板，确认主题、类型、补充要求和大纲能正常填充。
   - 进入编辑页，确认当前模板样式提示正常。
   - 创建文档并导出 Word，确认导出成功并使用模板样式。

7. 安全检查
   - 前端和接口不能暴露 MinIO access key、secret key。
   - 前端和接口不能暴露 `bucket` 或 `object_key`。
   - 文件读取和下载必须走后端代理接口。

8. 构建和提交
   - 运行 `npm run build`。
   - 全部验收通过后，提交代码到远程仓库。
   - commit message 建议：
     `feat: add project review document template`
   - 最终输出提交哈希和修改摘要。

验收标准：

1. `GET /api/templates` 能返回新增模板。
2. `GET /api/templates/{templateId}` 能返回模板详情和素材状态。
3. `GET /api/templates/{templateId}/cover` 能返回封面图片。
4. 模板库能展示新增模板封面。
5. 点击模板能填充主题、类型、要求和大纲。
6. 导出 Word 能使用模板样式。
7. MinIO 中能找到模板封面和 Word 样式文件。
8. 数据库只保存模板元数据和文件索引，不保存真实文件内容。
9. 前端和接口不暴露 MinIO 密钥、bucket、object_key。
10. `npm run build` 通过。
11. 验收通过后提交并推送 `origin/main`。
```

## 可替换字段

如果要创建其他模板，只需要替换 Goal 第一段中的内容：

```text
【项目复盘报告】
项目经理、产品经理、交付负责人
项目结束后做内部复盘和管理汇报
商务、简洁、专业、有数据复盘感
```

例如：

```text
Goal：使用模板 Agent 自动创建一个【周报】文档模板，适合职场员工每周汇报工作进展，风格要求简洁、清晰、偏办公。
```

或者：

```text
Goal：使用模板 Agent 自动创建一个【培训方案】文档模板，适合企业培训负责人制定内部培训计划，风格要求专业、清爽、有组织感。
```

