export type FormalDocumentType = "工作总结" | "会议纪要" | "商业计划书" | "合同协议" | "论文材料" | "活动方案";

export type FormalTemplateItem = {
  name: string;
  documentType: FormalDocumentType;
  topic: string;
  outline: string[];
};

export type TemplateProfile = {
  audience: string;
  expectedPages: string;
  deliverables: string[];
  riskNote: string;
  qualityChecklist: string[];
};

export type FormalTemplateOptions = {
  title?: string;
  audience?: string;
  expectedPages?: string;
  outline?: string[];
};

export function deriveTemplateProfile(template: Pick<FormalTemplateItem, "documentType">): TemplateProfile;
export function buildFormalTemplateContent(template: FormalTemplateItem, options?: FormalTemplateOptions): string;
