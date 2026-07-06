# 新增文档模板操作文档

本文说明如何在 AI Word 文档助手中新增一套文档模板。当前项目的模板由 MySQL 统一管理，封面图和 Word 样式文件存储在 MinIO，数据库只保存模板元数据和文件索引。

## 一、当前模板机制

模板相关数据分三层：

1. MySQL `document_templates`
   - 保存模板名称、分类、文档类型、默认主题、默认补充要求、示例大纲、排序和状态。

2. MySQL `files`
   - 保存模板素材索引。
   - `template_id` 关联 `document_templates.id`。
   - `document_id` 对模板素材保持为空。
   - `purpose` 用于区分素材类型。

3. MinIO
   - 保存真实文件内容，例如封面图、Word 样式文件、正文配图、附件。

前端模板库通过后端接口读取模板：

```text
GET /api/templates
GET /api/templates/{templateId}
GET /api/templates/{templateId}/cover
GET /api/templates/{templateId}/assets/{fileId}/download
```

## 二、模板字段说明

新增模板时，核心字段如下：

| 字段 | 说明 | 示例 |
| --- | --- | --- |
| `name` | 模板名称 | `周报模板` |
| `category` | 模板分类 | `办公通用` |
| `document_type` | 文档类型，需要前端支持 | `工作总结` |
| `topic` | 默认文档主题 | `个人周工作总结` |
| `requirement` | 默认补充要求 | `突出本周完成事项、风险问题和下周计划。` |
| `outline_json` | 示例大纲 JSON | `["一、本周工作回顾","二、问题与风险","三、下周计划"]` |
| `content` | 默认正文或正文占位 | 可为空 |
| `is_system` | 是否系统模板 | `1` |
| `status` | 模板状态 | `active` / `inactive` |
| `sort_order` | 排序值 | `70` |

注意：`document_type` 第一版应使用当前前端已有类型：

```text
工作总结、会议纪要、商业计划书、合同协议、论文材料、活动方案
```

如果要新增文档类型，需要同步修改 `src/templates/documentTemplates.ts` 中的 `DocumentType` 和 `documentTypes`。

## 三、MinIO 素材规范

模板素材建议使用以下 object key：

```text
templates/{templateId}/cover/{fileName}
templates/{templateId}/styles/{fileName}
templates/{templateId}/assets/{fileName}
templates/{templateId}/examples/{fileName}
```

第一版素材用途写入 `files.purpose`：

| purpose | 用途 |
| --- | --- |
| `template_cover` | 模板封面图 |
| `template_style` | Word 导出样式文件 |
| `template_asset` | 模板正文配图、附件等扩展素材 |

封面图推荐：

- 格式：`svg`、`png`、`jpg`
- 比例：`16:9`
- 建议尺寸：`960x540`

Word 样式文件当前使用 JSON，示例：

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

## 四、推荐新增方式：修改 seed 脚本

推荐第一版通过 `database/seed-document-templates.mjs` 添加模板，原因是：

- 可以一次性写入 MySQL 模板数据。
- 可以自动生成或上传模板封面。
- 可以自动写入 `files` 索引。
- 可以重复执行，适合本地和部署环境初始化。

操作步骤：

1. 打开 `database/seed-document-templates.mjs`。

2. 在 `templates` 数组中新增一项：

```js
{
  name: "周报模板",
  category: "办公通用",
  documentType: "工作总结",
  topic: "个人周工作总结",
  requirement: "突出本周完成事项、风险问题和下周计划。",
  outline: ["一、本周工作回顾", "二、重点成果", "三、问题与风险", "四、下周计划"],
  content: "",
  sortOrder: 70
}
```

3. 如果需要专属封面配色，在 `coverPalettes` 中增加一项。

4. 如果需要专属 Word 样式，在 `stylePresets` 中增加一项。

5. 确保新增模板、封面配色、样式配置的顺序一致。

6. 执行 seed：

```bash
npm run db:seed:templates
```

7. 重启后端：

```bash
npm run api
```

如果后端已在运行，需要先停止旧进程再启动。

## 五、手动 SQL 新增方式

如果只想先新增模板元数据，可以直接写 SQL：

```sql
INSERT INTO document_templates
  (name, category, document_type, topic, requirement, outline_json, content, is_system, status, sort_order)
VALUES
  (
    '周报模板',
    '办公通用',
    '工作总结',
    '个人周工作总结',
    '突出本周完成事项、风险问题和下周计划。',
    CAST('["一、本周工作回顾","二、重点成果","三、问题与风险","四、下周计划"]' AS JSON),
    '',
    1,
    'active',
    70
  );
```

这种方式只会新增模板，不会自动上传封面和 Word 样式。模板库仍能显示，但会提示无封面或无 Word 样式。

## 六、手动登记素材索引

如果封面或样式文件已经上传到 MinIO，需要在 `files` 表登记索引：

```sql
INSERT INTO files
  (user_id, document_id, template_id, original_name, file_name, file_type, mime_type, file_size, bucket, object_key, purpose)
VALUES
  (
    'system',
    NULL,
    7,
    '7-cover.svg',
    '7-cover.svg',
    'svg',
    'image/svg+xml',
    1024,
    'moling-word',
    'templates/7/cover/7-cover.svg',
    'template_cover'
  );
```

Word 样式文件示例：

```sql
INSERT INTO files
  (user_id, document_id, template_id, original_name, file_name, file_type, mime_type, file_size, bucket, object_key, purpose)
VALUES
  (
    'system',
    NULL,
    7,
    '7-word-style.json',
    '7-word-style.json',
    'json',
    'application/json',
    256,
    'moling-word',
    'templates/7/styles/7-word-style.json',
    'template_style'
  );
```

## 七、验证步骤

新增模板后按以下顺序验证：

1. 检查模板接口：

```bash
curl http://127.0.0.1:3001/api/templates
```

确认新增模板出现在 `templates` 列表中。

2. 检查模板详情：

```bash
curl http://127.0.0.1:3001/api/templates/{templateId}
```

确认：

- `hasCover` 是否符合预期。
- `hasStyle` 是否符合预期。
- `coverUrl` 是否存在。
- `assets` 是否包含素材列表。

3. 检查封面代理：

```bash
curl -I http://127.0.0.1:3001/api/templates/{templateId}/cover
```

确认返回 `200`，并且 `Content-Type` 是图片类型。

4. 打开前端：

```text
http://127.0.0.1:5188/
```

进入模板库，确认：

- 模板卡片显示。
- 封面图显示。
- 素材状态显示。
- 点击“使用模板”后能填充主题、类型、要求和示例大纲。

5. 导出 Word：

- 使用新模板创建文档。
- 进入编辑页。
- 点击导出 Word。
- 确认导出的 Word 文件成功生成。

## 八、停用模板

如果模板暂时不想展示，不要删除数据，改为停用：

```sql
UPDATE document_templates
SET status = 'inactive'
WHERE name = '周报模板';
```

前端刷新后，`GET /api/templates` 不会再返回该模板。

## 九、注意事项

- 不要把真实文件内容直接存入 MySQL。
- 不要在前端暴露 MinIO `bucket`、`object_key`、access key 或 secret key。
- 前端只使用后端返回的代理地址，例如 `/api/templates/{templateId}/cover`。
- 如果 `GET /api/templates` 失败，前端会使用本地兜底模板。
- 新增模板类型前，必须先确认前端 `DocumentType` 已支持该类型。
- 生产环境上传素材前，建议先确认 MinIO bucket 存在并且服务端账号具备读写权限。

