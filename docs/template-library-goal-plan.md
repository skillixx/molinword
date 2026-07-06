# 模板库能力 Goal 规划

## 一、规划背景

当前 AI Word 文档助手的模板库还是前端静态模板，模板内容写在 `src/main.tsx` 中。随着模板数量增加、模板内容变长，以及后续可能出现 Word 样式、封面、图片等素材，需要把模板能力分阶段拆出来，避免主页面代码越来越臃肿。

本规划将模板库拆成三个阶段：

1. 第一阶段：拆成 `src/templates/*.ts` 或 `src/data/templates.ts`
2. 第二阶段：存到 MySQL 的 `document_templates` 表
3. 第三阶段：如果模板包含 Word 样式文件、封面、图片，再把附件放 MinIO，数据库只存索引

## 二、阶段目标总览

| 阶段 | 核心目标 | 存储方式 | 适用场景 |
|---|---|---|---|
| 第一阶段 | 从主页面代码中拆出模板数据 | 前端 TypeScript 文件 | 模板数量少、内容简单、暂不需要后台管理 |
| 第二阶段 | 模板进入数据库，支持动态读取 | MySQL `document_templates` 表 | 模板需要运营维护、后端统一管理 |
| 第三阶段 | 支持复杂模板素材和 Word 样式资源 | MySQL + MinIO | 模板包含封面、图片、Word 样式文件、附件 |

## 三、Goal 1：前端静态模板拆分

### 阶段目标

把模板数据从 `src/main.tsx` 中拆出来，降低主页面复杂度，让模板库可以独立维护。

### 推荐目录

第一版推荐使用一个集中模板文件：

```text
src/templates/documentTemplates.ts
```

模板数量超过 20 个，或者单个模板内容明显变长后，再拆成多个文件：

```text
src/templates/
  workSummary.ts
  meetingMinutes.ts
  businessPlan.ts
  activityPlan.ts
  contractAgreement.ts
  thesisMaterial.ts
  index.ts
```

### 主要任务

- 新建 `src/templates/documentTemplates.ts`
- 将 `DocumentType`、`TemplateItem`、`documentTemplates` 从 `src/main.tsx` 拆出
- `src/main.tsx` 改为从模板文件导入
- 保持现有模板库页面交互不变
- 保持点击模板后自动填充：
  - 文档类型
  - 默认主题
  - 默认补充要求
  - 示例大纲
- 保持 `npm run build` 通过

### 交付物

- 独立模板数据文件
- 主页面代码变薄
- 模板库功能保持可用

### 验收标准

- `src/main.tsx` 中不再直接维护大段模板数组
- 模板库页面能正常显示所有模板
- 点击模板后仍能填充主题、类型、要求和大纲
- `npm run build` 通过

## 四、Goal 2：模板存储迁移到 MySQL

### 阶段目标

把模板从前端静态文件迁移到 MySQL，使模板可以由后端接口统一读取，为后续运营配置和管理后台打基础。

### 数据表

使用当前已规划的 `document_templates` 表。

建议核心字段：

| 字段 | 说明 |
|---|---|
| `id` | 模板 ID |
| `name` | 模板名称 |
| `category` | 模板分类 |
| `document_type` | 文档类型 |
| `outline_json` | 示例大纲 JSON |
| `content` | 默认正文或正文占位 |
| `is_system` | 是否系统模板 |
| `status` | 状态：`active` / `inactive` |
| `sort_order` | 排序值 |
| `created_at` | 创建时间 |
| `updated_at` | 更新时间 |

### 主要任务

- 检查并完善 `document_templates` 表结构
- 编写模板初始化 SQL 或 seed 脚本
- 后端新增模板列表接口：

```text
GET /api/templates
```

- 后端只返回 `status=active` 的模板
- 前端模板库改为调用接口读取
- 前端保留本地静态模板作为接口失败时的兜底
- 增加模板读取 loading 和错误提示

### 交付物

- MySQL 模板数据
- 模板查询接口
- 前端动态模板库
- 接口异常时的本地兜底模板

### 验收标准

- `GET /api/templates` 能返回模板列表
- 前端模板库数据来自后端接口
- 数据库新增、停用模板后，前端刷新能体现变化
- 接口失败时页面不崩溃，有中文提示或兜底模板
- `npm run build` 通过

## 五、Goal 3：模板素材进入 MinIO

### 阶段目标

支持更复杂的模板资源，例如 Word 样式文件、封面图、正文配图、附件等。数据库只保存模板元数据和文件索引，真实文件存储在 MinIO。

### 推荐存储结构

MinIO object key 建议：

```text
templates/{templateId}/cover/{fileName}
templates/{templateId}/styles/{fileName}
templates/{templateId}/assets/{fileName}
templates/{templateId}/examples/{fileName}
```

### MySQL 关联方式

可以复用 `files` 表，也可以后续新增专门的模板素材表。

第一版建议复用 `files` 表：

| 字段 | 建议 |
|---|---|
| `document_id` | 模板素材可为空 |
| `purpose` | 增加 `template_cover`、`template_style`、`template_asset` |
| `object_key` | 保存 MinIO 路径 |
| `bucket` | 保存 bucket |

如果模板素材管理变复杂，再新增：

```text
template_assets
```

### 主要任务

- 设计模板素材上传规范
- 后端支持读取模板关联素材
- Word 导出时支持应用模板样式
- 模板库页面展示封面缩略图
- 模板详情中展示素材状态
- MinIO 不可用时给出中文提示
- 确保文件下载和读取不暴露 MinIO 密钥

### 交付物

- 模板封面图支持
- 模板 Word 样式文件支持
- 模板素材 MinIO 索引
- 模板详情接口返回素材信息

### 验收标准

- 模板可以展示封面
- 模板可以关联 Word 样式文件
- 导出 Word 时可以使用模板样式
- MinIO 中能找到模板素材文件
- 数据库只保存文件索引，不保存真实文件内容
- 前端和接口不暴露 MinIO 密钥

## 六、推荐执行顺序

1. 先做第一阶段：拆前端静态模板文件
2. 模板数量稳定后，做第二阶段：迁移到 MySQL
3. 需要封面、样式、图片后，再做第三阶段：MinIO 素材化

## 七、当前建议

当前项目还处于 AI Word 文档助手第一版产品体验完善阶段，建议马上执行第一阶段：

```text
src/templates/documentTemplates.ts
```

暂时不要直接上 MySQL 和 MinIO。这样可以最快降低代码耦合，同时不影响现有模板库功能。
