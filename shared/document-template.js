const templateProfiles = {
  工作总结: {
    audience: "直属负责人、部门管理者与协作团队",
    expectedPages: "3-6页",
    deliverables: ["目标完成情况", "量化成果", "问题复盘", "后续行动计划"],
    riskNote: "对外发布前请复核经营数据、客户信息和人员评价。",
    qualityChecklist: ["目标与结果逐项对应", "关键成果有数据依据", "问题说明包含原因与影响", "行动计划包含负责人和期限"]
  },
  会议纪要: {
    audience: "参会人员、项目负责人和决策管理者",
    expectedPages: "2-4页",
    deliverables: ["会议信息", "议题结论", "会议决议", "行动项清单"],
    riskNote: "发布前应由会议主持人确认决议、责任人和完成期限。",
    qualityChecklist: ["参会人与议题信息完整", "会议决议明确可追溯", "行动项包含责任人和期限", "未决问题和升级路径已标明"]
  },
  商业计划书: {
    audience: "企业决策者、项目评审人和潜在合作方",
    expectedPages: "8-15页",
    deliverables: ["机会判断", "实施方案", "预算收益", "里程碑与风险"],
    riskNote: "预测数据应标明口径、来源与假设，不应将未经验证的测算表述为事实。",
    qualityChecklist: ["结论有事实或数据依据", "预算与收益口径一致", "里程碑包含验收标准", "主要风险有触发条件和预案"]
  },
  合同协议: {
    audience: "合同双方、法务、财务和项目负责人",
    expectedPages: "6-12页",
    deliverables: ["主体信息", "服务与交付边界", "费用及验收", "权责与争议条款"],
    riskNote: "本模板不构成法律意见，正式签署前应由具备资质的法务人员审查。",
    qualityChecklist: ["合同主体信息准确", "服务范围和验收边界明确", "付款条件与交付节点一致", "保密、违约和争议条款完整"]
  },
  论文材料: {
    audience: "导师、评审专家和研究协作人员",
    expectedPages: "10-20页",
    deliverables: ["研究问题", "方法与过程", "分析结论", "参考文献"],
    riskNote: "引用、数据和图表必须标注真实来源，并遵守所在机构的学术规范。",
    qualityChecklist: ["研究问题与方法一致", "关键论断有可靠来源", "图表与引用格式统一", "创新点和研究局限清晰"]
  },
  活动方案: {
    audience: "活动负责人、执行团队和审批管理者",
    expectedPages: "5-10页",
    deliverables: ["活动目标", "执行流程", "资源预算", "风险与应急预案"],
    riskNote: "涉及场地、人员安全、肖像和个人信息时，应完成对应授权与合规审查。",
    qualityChecklist: ["活动目标可以量化验收", "流程包含负责人和时间点", "预算与资源清单完整", "安全风险有应急预案"]
  }
};

export function deriveTemplateProfile(template) {
  return templateProfiles[template.documentType] || templateProfiles.工作总结;
}

function escapeTemplateHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character] || character);
}

function formalSectionGuide(title = "", documentType = "工作总结") {
  if (/基本信息|背景|概述|现状/.test(title)) return "说明事项背景、适用范围、关键参与方和形成本文档的依据，避免使用无法核验的泛泛表述。";
  if (/目标|指标|成果|收益/.test(title)) return "按目标、衡量指标、当前值、目标值和数据来源展开，关键结论应能够复核。";
  if (/流程|方案|实施|计划|里程碑/.test(title)) return "按阶段说明任务、负责人、开始与完成时间、交付物和验收标准。";
  if (/风险|问题|不足|违约|争议/.test(title)) return "列明风险或问题、发生概率、影响范围、触发条件、责任人和应对措施。";
  if (/结论|决议|建议/.test(title)) return "使用明确、可执行的结论，区分已确认事项、待确认事项与需要升级决策的事项。";
  if (/行动|分工|责任|后续/.test(title)) return "每项行动必须明确责任人、协作方、完成期限、交付标准和当前状态。";
  if (/参考文献|研究现状/.test(title)) return "仅填写真实查阅的来源，并统一作者、题名、出版信息、年份和访问日期格式。";
  return documentType === "合同协议"
    ? "结合实际交易安排补充定义、权利义务、交付证据和例外情形，正式签署前提交法务审查。"
    : "围绕本节主题提供事实、数据、判断和可执行建议，必要时补充表格、附件或来源说明。";
}

// 中文注解：默认 A4 正文区宽 9026 DXA；表格 8880 DXA 加 120 DXA 缩进后仍留安全余量，避免挤入页边距。
const formalTableGeometry = `data-table-width-type="dxa" data-table-width-value="8880" data-table-grid-width="8880" data-table-layout="fixed" data-table-alignment="left" data-table-indent="120"`;
const formalTableBorders = `data-table-borders='{"top":{"style":"single","size":4,"color":"#A6A6A6"},"right":{"style":"single","size":4,"color":"#A6A6A6"},"bottom":{"style":"single","size":4,"color":"#A6A6A6"},"left":{"style":"single","size":4,"color":"#A6A6A6"},"insideHorizontal":{"style":"single","size":4,"color":"#A6A6A6"},"insideVertical":{"style":"single","size":4,"color":"#A6A6A6"}}'`;

function formalCellGeometry(width, { header = false } = {}) {
  const shading = header ? ` data-cell-shading="#F2F4F7"` : "";
  return `colwidth="${width}" data-cell-margins='{"top":80,"right":120,"bottom":80,"left":120}' data-cell-vertical-align="center"${shading}`;
}

function formalActionTable(title = "") {
  if (!/行动|分工|计划|任务|里程碑|实施/.test(title)) return "";
  return `<table data-template-table="action" ${formalTableGeometry} ${formalTableBorders} style="width: 100%; table-layout: fixed; border-collapse: collapse; margin: 0 0 12pt"><thead><tr data-row-repeat-header="true" data-row-cant-split="true"><th ${formalCellGeometry(228, { header: true })} style="border: 1px solid #A6A6A6; padding: 6pt; background: #F2F4F7">任务/交付物</th><th ${formalCellGeometry(114, { header: true })} style="border: 1px solid #A6A6A6; padding: 6pt; background: #F2F4F7">负责人</th><th ${formalCellGeometry(114, { header: true })} style="border: 1px solid #A6A6A6; padding: 6pt; background: #F2F4F7">完成期限</th><th ${formalCellGeometry(136, { header: true })} style="border: 1px solid #A6A6A6; padding: 6pt; background: #F2F4F7">验收标准</th></tr></thead><tbody><tr data-row-cant-split="true"><td ${formalCellGeometry(228)} style="border: 1px solid #A6A6A6; padding: 6pt">【请填写】</td><td ${formalCellGeometry(114)} style="border: 1px solid #A6A6A6; padding: 6pt">【请填写】</td><td ${formalCellGeometry(114)} style="border: 1px solid #A6A6A6; padding: 6pt">【YYYY-MM-DD】</td><td ${formalCellGeometry(136)} style="border: 1px solid #A6A6A6; padding: 6pt">【请填写】</td></tr></tbody></table>`;
}

export function buildFormalTemplateContent(template, options = {}) {
  const profile = deriveTemplateProfile(template);
  const title = escapeTemplateHtml(options.title?.trim() || template.topic || template.name);
  const audience = escapeTemplateHtml(options.audience?.trim() || profile.audience);
  const expectedPages = escapeTemplateHtml(options.expectedPages?.trim() || profile.expectedPages);
  const outline = (options.outline?.length ? options.outline : template.outline || []).filter(Boolean).slice(0, 10);
  const metadata = `<table data-template-table="metadata" ${formalTableGeometry} ${formalTableBorders} style="width: 100%; table-layout: fixed; border-collapse: collapse; margin: 0 0 14pt"><thead><tr data-row-repeat-header="true" data-row-cant-split="true"><th ${formalCellGeometry(90, { header: true })} style="border: 1px solid #A6A6A6; padding: 6pt; background: #F2F4F7">文档信息</th><th ${formalCellGeometry(206, { header: true })} style="border: 1px solid #A6A6A6; padding: 6pt; background: #F2F4F7">内容</th><th ${formalCellGeometry(90, { header: true })} style="border: 1px solid #A6A6A6; padding: 6pt; background: #F2F4F7">文档信息</th><th ${formalCellGeometry(206, { header: true })} style="border: 1px solid #A6A6A6; padding: 6pt; background: #F2F4F7">内容</th></tr></thead><tbody><tr data-row-cant-split="true"><th ${formalCellGeometry(90, { header: true })} style="border: 1px solid #A6A6A6; padding: 6pt; background: #F2F4F7">文档主题</th><td ${formalCellGeometry(206)} style="border: 1px solid #A6A6A6; padding: 6pt">${title}</td><th ${formalCellGeometry(90, { header: true })} style="border: 1px solid #A6A6A6; padding: 6pt; background: #F2F4F7">版本</th><td ${formalCellGeometry(206)} style="border: 1px solid #A6A6A6; padding: 6pt">V1.0</td></tr><tr data-row-cant-split="true"><th ${formalCellGeometry(90, { header: true })} style="border: 1px solid #A6A6A6; padding: 6pt; background: #F2F4F7">适用对象</th><td ${formalCellGeometry(206)} style="border: 1px solid #A6A6A6; padding: 6pt">${audience}</td><th ${formalCellGeometry(90, { header: true })} style="border: 1px solid #A6A6A6; padding: 6pt; background: #F2F4F7">建议篇幅</th><td ${formalCellGeometry(206)} style="border: 1px solid #A6A6A6; padding: 6pt">${expectedPages}</td></tr><tr data-row-cant-split="true"><th ${formalCellGeometry(90, { header: true })} style="border: 1px solid #A6A6A6; padding: 6pt; background: #F2F4F7">编制人/部门</th><td ${formalCellGeometry(206)} style="border: 1px solid #A6A6A6; padding: 6pt">【请填写】</td><th ${formalCellGeometry(90, { header: true })} style="border: 1px solid #A6A6A6; padding: 6pt; background: #F2F4F7">编制日期</th><td ${formalCellGeometry(206)} style="border: 1px solid #A6A6A6; padding: 6pt">【YYYY-MM-DD】</td></tr></tbody></table>`;
  const introduction = `<p data-widow-control="true" style="line-height: 1.5; text-align: justify; margin: 0 0 12pt"><span style="color: #000000; font-family: Microsoft YaHei; font-size: 11pt"><strong>编制说明：</strong>本模板面向${audience}，正式交付物包括${profile.deliverables.map(escapeTemplateHtml).join("、")}。${escapeTemplateHtml(profile.riskNote)}</span></p>`;
  const sections = outline.map((item) => {
    const safeTitle = escapeTemplateHtml(item);
    const guide = escapeTemplateHtml(formalSectionGuide(item, template.documentType));
    return `<h2 data-outline-level="1" data-keep-next="true" data-keep-lines="true" data-widow-control="true" style="margin-top: 12pt; margin-bottom: 6pt; line-height: 1.3"><span style="color: #000000; font-family: Microsoft YaHei; font-size: 16pt; font-weight: bold">${safeTitle}</span></h2><p data-indent="1" data-widow-control="true" style="line-height: 1.5; text-align: justify; margin: 0 0 6pt"><span style="color: #000000; font-family: Microsoft YaHei; font-size: 11pt">【填写提示】${guide}</span></p>${formalActionTable(item)}`;
  }).join("");
  return `${metadata}${introduction}${sections}` || "<p></p>";
}
