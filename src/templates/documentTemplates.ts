export type DocumentType = "工作总结" | "会议纪要" | "商业计划书" | "合同协议" | "论文材料" | "活动方案";

export type TemplateItem = {
  id?: number;
  name: string;
  category: string;
  documentType: DocumentType;
  topic: string;
  requirement: string;
  outline: string[];
  content?: string;
  isSystem?: boolean;
  status?: "active" | "inactive";
  sortOrder?: number;
  coverUrl?: string;
  hasCover?: boolean;
  hasStyle?: boolean;
  assets?: TemplateAsset[];
};

export type TemplateAsset = {
  id: number;
  purpose: "template_cover" | "template_style" | "template_asset";
  fileName: string;
  fileType: string;
  mimeType?: string;
  fileSize: number;
  url: string;
};

export const documentTypes: DocumentType[] = ["工作总结", "会议纪要", "商业计划书", "合同协议", "论文材料", "活动方案"];

// 模板库第一阶段先集中维护静态数据，后续迁移 MySQL 时可直接替换为接口数据源。
export const documentTemplates: TemplateItem[] = [
  { name: "工作总结", category: "办公通用", documentType: "工作总结", topic: "季度工作总结", requirement: "突出目标完成情况、关键成果、问题复盘和下阶段计划。", outline: ["一、整体工作回顾", "二、重点成果与数据", "三、问题与改进", "四、下阶段计划"], sortOrder: 10 },
  { name: "个人周报", category: "办公通用", documentType: "工作总结", topic: "个人周工作总结", requirement: "围绕本周目标、重点任务、量化成果、问题风险和下周计划进行简洁汇报，突出结果导向。", outline: ["一、本周工作概览", "二、重点任务完成情况", "三、关键数据与成果", "四、问题风险与改进", "五、下周工作计划"], sortOrder: 15 },
  { name: "项目周报", category: "办公通用", documentType: "工作总结", topic: "项目周进展报告", requirement: "面向管理层汇报项目进展、里程碑完成情况、风险阻塞、资源需求和下周计划，表达要专业稳重、重点清晰。", outline: ["一、项目整体进展", "二、本周里程碑完成情况", "三、重点任务与交付成果", "四、风险问题与阻塞事项", "五、资源需求与协同事项", "六、下周工作计划"], sortOrder: 18 },
  { name: "述职报告", category: "办公通用", documentType: "工作总结", topic: "个人述职报告", requirement: "适用于转正、晋升、年度述职和阶段性汇报，突出岗位职责、关键成果、能力成长、问题复盘和后续规划，表达正式可信。", outline: ["一、岗位职责与述职周期", "二、阶段目标完成情况", "三、关键成果与业务贡献", "四、能力成长与经验沉淀", "五、问题不足与改进措施", "六、后续工作规划"], sortOrder: 19 },
  { name: "工作计划", category: "办公通用", documentType: "工作总结", topic: "月度工作计划", requirement: "适合个人、团队或部门制定月度/季度计划，突出目标拆解、重点任务、时间安排、资源需求和执行跟踪。", outline: ["一、计划周期与总体目标", "二、目标拆解与关键指标", "三、重点任务与执行安排", "四、时间节点与里程碑", "五、资源需求与协同事项", "六、风险预案与跟踪机制"], sortOrder: 20 },
  { name: "会议纪要", category: "办公通用", documentType: "会议纪要", topic: "项目推进会议纪要", requirement: "记录会议结论、待办事项、责任人和时间节点。", outline: ["一、会议基本信息", "二、讨论要点", "三、形成结论", "四、后续行动"], sortOrder: 25 },
  { name: "商业计划书", category: "商业经营", documentType: "商业计划书", topic: "AI Word 文档助手商业计划书", requirement: "覆盖市场机会、产品方案、商业模式、推广计划和风险控制。", outline: ["一、项目概述", "二、市场分析", "三、产品方案", "四、商业模式", "五、实施计划"], sortOrder: 30 },
  { name: "项目立项书", category: "商业经营", documentType: "商业计划书", topic: "项目立项申请书", requirement: "适合企业内部项目申请、项目评审和资源审批，突出项目背景、建设目标、可行性分析、预算资源、预期收益和风险评估。", outline: ["一、项目背景与立项必要性", "二、建设目标与范围", "三、需求分析与可行性论证", "四、实施方案与里程碑计划", "五、预算资源与组织保障", "六、预期收益与评估指标", "七、风险评估与应对措施"], sortOrder: 35 },
  { name: "活动方案", category: "市场活动", documentType: "活动方案", topic: "新品发布活动方案", requirement: "说明活动目标、流程安排、人员分工、预算和风险预案。", outline: ["一、活动目标", "二、活动流程", "三、资源与分工", "四、预算安排", "五、风险预案"], sortOrder: 40 },
  { name: "合同协议", category: "法务合同", documentType: "合同协议", topic: "服务合作协议", requirement: "梳理合作范围、双方责任、交付标准、费用与违约条款。", outline: ["一、合作背景", "二、服务内容", "三、双方权责", "四、费用结算", "五、违约与终止"], sortOrder: 50 },
  { name: "论文材料", category: "学术研究", documentType: "论文材料", topic: "智能写作工具应用研究", requirement: "强调研究背景、方法、分析过程、结论和参考方向。", outline: ["一、研究背景", "二、研究方法", "三、结果分析", "四、结论与展望"], sortOrder: 60 }
];
