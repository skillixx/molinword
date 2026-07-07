import "dotenv/config";
import { Client as MinioClient } from "minio";
import mysql from "mysql2/promise";

const templates = [
  {
    name: "工作总结",
    category: "办公通用",
    documentType: "工作总结",
    topic: "季度工作总结",
    requirement: "突出目标完成情况、关键成果、问题复盘和下阶段计划。",
    outline: ["一、整体工作回顾", "二、重点成果与数据", "三、问题与改进", "四、下阶段计划"],
    content: "",
    sortOrder: 10
  },
  {
    name: "个人周报",
    category: "办公通用",
    documentType: "工作总结",
    topic: "个人周工作总结",
    requirement: "围绕本周目标、重点任务、量化成果、问题风险和下周计划进行简洁汇报，突出结果导向。",
    outline: ["一、本周工作概览", "二、重点任务完成情况", "三、关键数据与成果", "四、问题风险与改进", "五、下周工作计划"],
    content: "",
    sortOrder: 15
  },
  {
    name: "项目周报",
    category: "办公通用",
    documentType: "工作总结",
    topic: "项目周进展报告",
    requirement: "面向管理层汇报项目进展、里程碑完成情况、风险阻塞、资源需求和下周计划，表达要专业稳重、重点清晰。",
    outline: ["一、项目整体进展", "二、本周里程碑完成情况", "三、重点任务与交付成果", "四、风险问题与阻塞事项", "五、资源需求与协同事项", "六、下周工作计划"],
    content: "",
    sortOrder: 18
  },
  {
    name: "述职报告",
    category: "办公通用",
    documentType: "工作总结",
    topic: "个人述职报告",
    requirement: "适用于转正、晋升、年度述职和阶段性汇报，突出岗位职责、关键成果、能力成长、问题复盘和后续规划，表达正式可信。",
    outline: ["一、岗位职责与述职周期", "二、阶段目标完成情况", "三、关键成果与业务贡献", "四、能力成长与经验沉淀", "五、问题不足与改进措施", "六、后续工作规划"],
    content: "",
    sortOrder: 19
  },
  {
    name: "工作计划",
    category: "办公通用",
    documentType: "工作总结",
    topic: "月度工作计划",
    requirement: "适合个人、团队或部门制定月度/季度计划，突出目标拆解、重点任务、时间安排、资源需求和执行跟踪。",
    outline: ["一、计划周期与总体目标", "二、目标拆解与关键指标", "三、重点任务与执行安排", "四、时间节点与里程碑", "五、资源需求与协同事项", "六、风险预案与跟踪机制"],
    content: "",
    sortOrder: 20
  },
  {
    name: "会议纪要",
    category: "办公通用",
    documentType: "会议纪要",
    topic: "项目推进会议纪要",
    requirement: "记录会议结论、待办事项、责任人和时间节点。",
    outline: ["一、会议基本信息", "二、讨论要点", "三、形成结论", "四、后续行动"],
    content: "",
    sortOrder: 25
  },
  {
    name: "商业计划书",
    category: "商业经营",
    documentType: "商业计划书",
    topic: "AI Word 文档助手商业计划书",
    requirement: "覆盖市场机会、产品方案、商业模式、推广计划和风险控制。",
    outline: ["一、项目概述", "二、市场分析", "三、产品方案", "四、商业模式", "五、实施计划"],
    content: "",
    sortOrder: 30
  },
  {
    name: "项目立项书",
    category: "商业经营",
    documentType: "商业计划书",
    topic: "项目立项申请书",
    requirement: "适合企业内部项目申请、项目评审和资源审批，突出项目背景、建设目标、可行性分析、预算资源、预期收益和风险评估。",
    outline: ["一、项目背景与立项必要性", "二、建设目标与范围", "三、需求分析与可行性论证", "四、实施方案与里程碑计划", "五、预算资源与组织保障", "六、预期收益与评估指标", "七、风险评估与应对措施"],
    content: "",
    sortOrder: 35
  },
  {
    name: "市场调研报告",
    category: "商业经营",
    documentType: "商业计划书",
    topic: "目标市场调研报告",
    requirement: "适合产品、运营、市场团队分析目标市场、用户需求和竞争格局，突出数据支撑、洞察结论和策略建议。",
    outline: ["一、调研背景与目标", "二、市场规模与发展趋势", "三、目标用户画像与需求分析", "四、竞争格局与竞品观察", "五、机会点与风险判断", "六、结论建议与行动计划"],
    content: "",
    sortOrder: 37
  },
  {
    name: "竞品分析报告",
    category: "商业经营",
    documentType: "商业计划书",
    topic: "产品竞品分析报告",
    requirement: "适合产品经理、运营团队和创业项目分析竞品功能、商业模式与差异化机会，突出结构化对比、关键结论和行动建议。",
    outline: ["一、分析目标与竞品范围", "二、竞品概况与市场定位", "三、核心功能与用户体验对比", "四、商业模式与价格策略分析", "五、优势劣势与差异化机会", "六、产品策略与行动建议"],
    content: "",
    sortOrder: 38
  },
  {
    name: "活动方案",
    category: "市场活动",
    documentType: "活动方案",
    topic: "新品发布活动方案",
    requirement: "说明活动目标、流程安排、人员分工、预算和风险预案。",
    outline: ["一、活动目标", "二、活动流程", "三、资源与分工", "四、预算安排", "五、风险预案"],
    content: "",
    sortOrder: 40
  },
  {
    name: "培训方案",
    category: "市场活动",
    documentType: "活动方案",
    topic: "企业内部培训方案",
    requirement: "适合企业培训负责人制定内部培训计划，突出培训目标、对象需求、课程安排、讲师资源、实施计划和效果评估，表达专业清爽、有组织感。",
    outline: ["一、培训背景与目标", "二、培训对象与需求分析", "三、培训内容与课程安排", "四、讲师资源与实施计划", "五、效果评估与跟进机制", "六、风险预案与保障措施"],
    content: "",
    sortOrder: 45
  },
  {
    name: "合同协议",
    category: "法务合同",
    documentType: "合同协议",
    topic: "服务合作协议",
    requirement: "梳理合作范围、双方责任、交付标准、费用与违约条款。",
    outline: ["一、合作背景", "二、服务内容", "三、双方权责", "四、费用结算", "五、违约与终止"],
    content: "",
    sortOrder: 50
  },
  {
    name: "技术服务合同",
    category: "法务合同",
    documentType: "合同协议",
    topic: "企业技术服务合作合同",
    requirement: "适合软件开发、系统集成、技术外包和企业技术服务合作场景，重点明确服务范围、交付标准、验收方式、费用结算、知识产权、保密义务、违约责任和争议解决，表达正式规范、条款清晰。",
    outline: ["一、合同主体与合作背景", "二、技术服务范围与交付内容", "三、项目周期、里程碑与验收标准", "四、费用结算与付款安排", "五、知识产权与保密条款", "六、违约责任、变更终止与争议解决"],
    content: "",
    sortOrder: 55
  },
  {
    name: "开题报告",
    category: "学术研究",
    documentType: "论文材料",
    topic: "论文课题开题报告",
    requirement: "适合本科、硕士论文或课题研究前期立项说明，重点呈现研究背景与意义、国内外研究现状、研究内容与方法、创新点、进度安排和参考文献，表达学术严谨、结构完整。",
    outline: ["一、选题背景与研究意义", "二、国内外研究现状", "三、研究目标、内容与关键问题", "四、研究方法、技术路线与可行性分析", "五、创新点、预期成果与进度安排", "六、参考文献与研究基础"],
    content: "",
    sortOrder: 58
  },
  {
    name: "论文材料",
    category: "学术研究",
    documentType: "论文材料",
    topic: "智能写作工具应用研究",
    requirement: "强调研究背景、方法、分析过程、结论和参考方向。",
    outline: ["一、研究背景", "二、研究方法", "三、结果分析", "四、结论与展望"],
    content: "",
    sortOrder: 60
  }
];

const coverPalettes = [
  { bg: "#eef7f4", accent: "#2f6f63", text: "#173c35" },
  { bg: "#edf7fb", accent: "#1f7a8c", text: "#123844" },
  { bg: "#eef3f8", accent: "#315a7c", text: "#183247" },
  { bg: "#f8f1f4", accent: "#8a3f5f", text: "#3f1f2e" },
  { bg: "#eef8f6", accent: "#258575", text: "#143d38" },
  { bg: "#f2f5fb", accent: "#3f5f9f", text: "#1f3158" },
  { bg: "#fff7ed", accent: "#c76a2b", text: "#623714" },
  { bg: "#f7f5ef", accent: "#8b6f2f", text: "#3f3518" },
  { bg: "#f1f3ff", accent: "#4f5fb8", text: "#242b63" },
  { bg: "#eef6ff", accent: "#256a9b", text: "#163a54" },
  { bg: "#f6f4ff", accent: "#6953b8", text: "#332563" },
  { bg: "#eef8fb", accent: "#2d7f9f", text: "#183f52" },
  { bg: "#f4f7fb", accent: "#475569", text: "#17212b" },
  { bg: "#eef2f7", accent: "#334e68", text: "#152536" },
  { bg: "#eef6f7", accent: "#2f6f7e", text: "#143843" },
  { bg: "#f7f8ef", accent: "#6b7a2f", text: "#39410f" }
];

const stylePresets = [
  { fontFamily: "Microsoft YaHei", titleColor: "2f6f63", headingColor: "245f55", accentColor: "8dbdb2", titleSize: 36, headingSize: 28, bodySize: 22, lineSpacing: 360 },
  { fontFamily: "Microsoft YaHei", titleColor: "1f7a8c", headingColor: "155e75", accentColor: "8ecae6", titleSize: 36, headingSize: 28, bodySize: 22, lineSpacing: 360 },
  { fontFamily: "Microsoft YaHei", titleColor: "315a7c", headingColor: "254864", accentColor: "9eb6cb", titleSize: 36, headingSize: 28, bodySize: 22, lineSpacing: 360 },
  { fontFamily: "Microsoft YaHei", titleColor: "8a3f5f", headingColor: "6f314d", accentColor: "d8a7bc", titleSize: 36, headingSize: 28, bodySize: 22, lineSpacing: 360 },
  { fontFamily: "Microsoft YaHei", titleColor: "258575", headingColor: "1f6f62", accentColor: "9bd5cb", titleSize: 36, headingSize: 28, bodySize: 22, lineSpacing: 360 },
  { fontFamily: "Microsoft YaHei", titleColor: "3f5f9f", headingColor: "2f4778", accentColor: "91a7d8", titleSize: 36, headingSize: 28, bodySize: 22, lineSpacing: 360 },
  { fontFamily: "SimSun", titleColor: "9a4f18", headingColor: "7c3f12", accentColor: "e6b17f", titleSize: 38, headingSize: 29, bodySize: 22, lineSpacing: 380 },
  { fontFamily: "Microsoft YaHei", titleColor: "8b6f2f", headingColor: "6f5926", accentColor: "d6c389", titleSize: 36, headingSize: 28, bodySize: 22, lineSpacing: 360 },
  { fontFamily: "Microsoft YaHei", titleColor: "4f5fb8", headingColor: "3c478f", accentColor: "a8b1f0", titleSize: 36, headingSize: 28, bodySize: 22, lineSpacing: 360 },
  { fontFamily: "Microsoft YaHei", titleColor: "256a9b", headingColor: "1e567d", accentColor: "8ec5e6", titleSize: 36, headingSize: 28, bodySize: 22, lineSpacing: 360 },
  { fontFamily: "Microsoft YaHei", titleColor: "5b45a4", headingColor: "463487", accentColor: "b8a9ef", titleSize: 36, headingSize: 28, bodySize: 22, lineSpacing: 360 },
  { fontFamily: "Microsoft YaHei", titleColor: "2d7f9f", headingColor: "24677f", accentColor: "9bcfe0", titleSize: 36, headingSize: 28, bodySize: 22, lineSpacing: 360 },
  { fontFamily: "Microsoft YaHei", titleColor: "334155", headingColor: "475569", accentColor: "cbd5e1", titleSize: 34, headingSize: 27, bodySize: 22, lineSpacing: 360 },
  { fontFamily: "SimSun", titleColor: "334e68", headingColor: "263d54", accentColor: "9fb3c8", titleSize: 36, headingSize: 28, bodySize: 22, lineSpacing: 380 },
  { fontFamily: "SimSun", titleColor: "2f6f7e", headingColor: "245866", accentColor: "9bc8d1", titleSize: 38, headingSize: 29, bodySize: 22, lineSpacing: 400 },
  { fontFamily: "SimSun", titleColor: "5f6f24", headingColor: "4d5b1c", accentColor: "c5cd91", titleSize: 38, headingSize: 29, bodySize: 22, lineSpacing: 380 }
];

async function columnExists(connection, tableName, columnName) {
  const [rows] = await connection.query(
    `SELECT COUNT(*) AS total
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?`,
    [tableName, columnName]
  );
  return Number(rows[0]?.total || 0) > 0;
}

async function indexExists(connection, tableName, indexName) {
  const [rows] = await connection.query(
    `SELECT COUNT(*) AS total
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND INDEX_NAME = ?`,
    [tableName, indexName]
  );
  return Number(rows[0]?.total || 0) > 0;
}

async function ensureTemplateSchema(connection) {
  // 中文注解：兼容已经初始化过的旧库，seed 前先补齐模板表新增字段。
  if (!(await columnExists(connection, "document_templates", "topic"))) {
    await connection.query("ALTER TABLE document_templates ADD COLUMN topic VARCHAR(255) NOT NULL DEFAULT '' COMMENT '默认文档主题' AFTER document_type");
  }

  if (!(await columnExists(connection, "document_templates", "requirement"))) {
    await connection.query("ALTER TABLE document_templates ADD COLUMN requirement TEXT NULL COMMENT '默认补充要求' AFTER topic");
  }

  if (!(await indexExists(connection, "document_templates", "uk_templates_name"))) {
    await connection.query("ALTER TABLE document_templates ADD UNIQUE KEY uk_templates_name (name)");
  }
}

async function ensureFileSchema(connection) {
  // 中文注解：模板素材第一版复用 files 表，旧库需要补 template_id 作为模板素材索引。
  if (!(await columnExists(connection, "files", "template_id"))) {
    await connection.query("ALTER TABLE files ADD COLUMN template_id BIGINT UNSIGNED NULL COMMENT '关联模板 ID，模板素材使用' AFTER document_id");
  }

  if (!(await indexExists(connection, "files", "idx_files_template"))) {
    await connection.query("ALTER TABLE files ADD KEY idx_files_template (template_id, purpose)");
  }
}

function createMinioClient() {
  if (!process.env.STORAGE_ENDPOINT || !process.env.STORAGE_ACCESS_KEY_ID || !process.env.STORAGE_SECRET_ACCESS_KEY) {
    return null;
  }

  const endpointUrl = new URL(process.env.STORAGE_ENDPOINT);
  return new MinioClient({
    endPoint: endpointUrl.hostname,
    port: Number(endpointUrl.port || (endpointUrl.protocol === "https:" ? 443 : 80)),
    useSSL: endpointUrl.protocol === "https:",
    accessKey: process.env.STORAGE_ACCESS_KEY_ID,
    secretKey: process.env.STORAGE_SECRET_ACCESS_KEY
  });
}

function svgCover(template, palette) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540">
  <rect width="960" height="540" fill="${palette.bg}"/>
  <rect x="64" y="64" width="832" height="412" rx="28" fill="#ffffff" opacity="0.88"/>
  <rect x="64" y="64" width="18" height="412" rx="9" fill="${palette.accent}"/>
  <text x="118" y="180" font-family="Microsoft YaHei, Arial" font-size="56" font-weight="700" fill="${palette.text}">${template.name}</text>
  <text x="118" y="252" font-family="Microsoft YaHei, Arial" font-size="30" fill="${palette.accent}">${template.category}</text>
  <text x="118" y="338" font-family="Microsoft YaHei, Arial" font-size="24" fill="#64748b">${template.topic}</text>
  <circle cx="786" cy="170" r="74" fill="${palette.accent}" opacity="0.14"/>
  <circle cx="828" cy="212" r="38" fill="${palette.accent}" opacity="0.22"/>
</svg>`;
}

async function putTemplateAsset(storage, bucket, objectKey, buffer, mimeType) {
  await storage.putObject(bucket, objectKey, buffer, buffer.length, { "Content-Type": mimeType });
}

async function upsertTemplateAsset(connection, { templateId, fileName, fileType, mimeType, fileSize, bucket, objectKey, purpose }) {
  await connection.query(
    "DELETE FROM files WHERE template_id = ? AND purpose = ?",
    [templateId, purpose]
  );

  await connection.query(
    `INSERT INTO files
      (user_id, document_id, template_id, original_name, file_name, file_type, mime_type, file_size, bucket, object_key, purpose)
     VALUES ('system', NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [templateId, fileName, fileName, fileType, mimeType, fileSize, bucket, objectKey, purpose]
  );
}

async function seedTemplateAssets(connection) {
  const storage = createMinioClient();
  if (!storage) {
    console.warn("未配置 MinIO，已跳过模板素材上传。");
    return;
  }

  const bucket = process.env.STORAGE_BUCKET || "moling-word";
  if (!(await storage.bucketExists(bucket))) {
    await storage.makeBucket(bucket);
  }

  for (const [index, template] of templates.entries()) {
    const [[row]] = await connection.query("SELECT id FROM document_templates WHERE name = ?", [template.name]);
    if (!row?.id) continue;

    const coverName = `${row.id}-cover.svg`;
    const coverKey = `templates/${row.id}/cover/${coverName}`;
    const coverBuffer = Buffer.from(svgCover(template, coverPalettes[index]), "utf8");
    await putTemplateAsset(storage, bucket, coverKey, coverBuffer, "image/svg+xml");
    await upsertTemplateAsset(connection, {
      templateId: row.id,
      fileName: coverName,
      fileType: "svg",
      mimeType: "image/svg+xml",
      fileSize: coverBuffer.length,
      bucket,
      objectKey: coverKey,
      purpose: "template_cover"
    });

    const styleName = `${row.id}-word-style.json`;
    const styleKey = `templates/${row.id}/styles/${styleName}`;
    const styleBuffer = Buffer.from(JSON.stringify(stylePresets[index], null, 2), "utf8");
    await putTemplateAsset(storage, bucket, styleKey, styleBuffer, "application/json");
    await upsertTemplateAsset(connection, {
      templateId: row.id,
      fileName: styleName,
      fileType: "json",
      mimeType: "application/json",
      fileSize: styleBuffer.length,
      bucket,
      objectKey: styleKey,
      purpose: "template_style"
    });
  }

  console.log(`已上传 ${templates.length} 组模板封面和 Word 样式文件。`);
}

async function seedTemplates() {
  if (!process.env.DATABASE_URL) {
    throw new Error("未配置 DATABASE_URL，无法写入模板数据。");
  }

  const connection = await mysql.createConnection(process.env.DATABASE_URL);
  try {
    await ensureTemplateSchema(connection);
    await ensureFileSchema(connection);

    for (const template of templates) {
      await connection.query(
        `INSERT INTO document_templates
          (name, category, document_type, topic, requirement, outline_json, content, is_system, status, sort_order)
         VALUES (?, ?, ?, ?, ?, CAST(? AS JSON), ?, 1, 'active', ?)
         ON DUPLICATE KEY UPDATE
          category = VALUES(category),
          document_type = VALUES(document_type),
          topic = VALUES(topic),
          requirement = VALUES(requirement),
          outline_json = VALUES(outline_json),
          content = VALUES(content),
          is_system = VALUES(is_system),
          status = VALUES(status),
          sort_order = VALUES(sort_order),
          updated_at = NOW()`,
        [
          template.name,
          template.category,
          template.documentType,
          template.topic,
          template.requirement,
          JSON.stringify(template.outline),
          template.content,
          template.sortOrder
        ]
      );
    }

    console.log(`已写入 ${templates.length} 个系统模板。`);
    await seedTemplateAssets(connection);
  } finally {
    await connection.end();
  }
}

seedTemplates().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
