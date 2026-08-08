import assert from "node:assert/strict";
import { createTemplateAgentFallbackPlan, normalizeTemplateAgentPlan, normalizeTemplateAgentReview, normalizeTemplateBriefAnalysis } from "../server/index.js";

const candidates = [
  {
    id: 11,
    name: "工作总结",
    category: "办公通用",
    documentType: "工作总结",
    topic: "季度工作总结",
    requirement: "突出成果、问题复盘和下一步计划。",
    outline: ["一、工作概况", "二、成果数据", "三、问题复盘", "四、后续计划"]
  },
  {
    id: 12,
    name: "会议纪要",
    category: "办公通用",
    documentType: "会议纪要",
    topic: "项目推进会议纪要",
    requirement: "记录结论、行动项、责任人和完成期限。",
    outline: ["一、会议基本信息", "二、议题与讨论要点", "三、会议决议", "四、行动项与责任人"]
  }
];

const fallback = createTemplateAgentFallbackPlan({
  brief: "为产品上线评审会制作正式会议纪要，需要记录参会人、会议结论、责任人和完成期限。",
  audience: "项目负责人和管理层",
  expectedPages: "3-5页"
}, candidates);

// 中文注解：这是用户可观察的推荐结果，不能只检查内部评分函数。
assert.equal(fallback.recommendedTemplateId, 12);
assert.equal(fallback.recommendedTemplateName, "会议纪要");
assert.equal(fallback.documentType, "会议纪要");
assert.match(fallback.title, /会议纪要/);
assert.ok(fallback.fitScore >= 70 && fallback.fitScore <= 100);
assert.ok(fallback.outline.length >= 4);
assert.ok(fallback.qualityChecklist.some((item) => /责任人|期限/.test(item)));
assert.deepEqual(fallback.workflow.map((item) => item.code), [
  "brief_analyzer",
  "template_matcher",
  "structure_architect",
  "quality_reviewer"
]);
assert.ok(fallback.workflow.every((item) => item.status === "fallback"));

const normalized = normalizeTemplateAgentPlan(JSON.stringify({
  recommendedTemplateId: 999,
  recommendedTemplateName: "不存在的模板",
  title: "产品上线评审会议纪要",
  documentType: "未知类型",
  tone: "正式",
  requirement: "需要形成可执行行动项。",
  audience: "管理层",
  expectedPages: "999页",
  fitScore: 180,
  reason: "结构接近会议管理场景。",
  outline: ["只有一项"],
  qualityChecklist: ["只有一项"]
}), fallback, candidates);

// 中文注解：模型输出不可信，未知模板、越界分数和残缺结构必须回落到受控方案。
assert.equal(normalized.recommendedTemplateId, 12);
assert.equal(normalized.documentType, "会议纪要");
assert.equal(normalized.fitScore, 100);
assert.equal(normalized.expectedPages, fallback.expectedPages);
assert.deepEqual(normalized.outline, fallback.outline);
assert.deepEqual(normalized.qualityChecklist, fallback.qualityChecklist);

const analysis = normalizeTemplateBriefAnalysis(JSON.stringify({
  intent: "形成可追溯的上线评审会议纪要",
  audience: "项目负责人和管理层",
  priorities: ["记录会议决议", "明确责任人和期限", "标记待升级风险"],
  constraints: ["不编造参会信息"],
  summary: "已识别会议决策留痕和行动跟踪要求。"
}), { audience: "管理层" });
assert.ok(analysis);
assert.equal(analysis.priorities.length, 3);
assert.equal(normalizeTemplateBriefAnalysis("not-json", {}), null);

const review = normalizeTemplateAgentReview(JSON.stringify({
  approved: true,
  issues: [],
  qualityChecklist: ["会议信息完整", "决议可追溯", "行动项有责任人", "行动项有期限"],
  summary: "质量门禁通过。"
}), normalized);
assert.ok(review?.approved);
assert.equal(review.qualityChecklist.length, 4);
assert.equal(normalizeTemplateAgentReview(JSON.stringify({ approved: true, issues: [], qualityChecklist: ["不足四项"] }), normalized), null);

console.log("模板智能体规划与质量门禁检查通过。", {
  recommendedTemplate: normalized.recommendedTemplateName,
  workflowStages: normalized.workflow.length,
  outlineCount: normalized.outline.length
});
