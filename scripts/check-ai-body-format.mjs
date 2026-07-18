import assert from "node:assert/strict";
import JSZip from "jszip";
import { createDocxBuffer, formatGeneratedBodyHtml } from "../server/index.js";

const outline = ["一、项目背景与目标", "二、实施方案"];
const modelJson = JSON.stringify([
  { title: "模型自行改写的标题", paragraphs: ["第一段说明项目背景。", "第二段说明建设目标。"] },
  { title: "另一个模型标题", paragraphs: ["实施过程分为准备、执行和验收三个阶段。"] }
]);
const html = formatGeneratedBodyHtml(modelJson, outline, "智能文档项目");

// 中文注解：大纲是用户确认过的结构权威，模型改写标题不能覆盖文档标题节点。
assert.match(html, /<h2[^>]+data-outline-level="1"[^>]+data-keep-next="true"[^>]*>[\s\S]*?一、项目背景与目标[\s\S]*?<\/h2>/);
assert.match(html, /<h2[^>]+data-outline-level="1"[^>]+data-keep-next="true"[^>]*>[\s\S]*?二、实施方案[\s\S]*?<\/h2>/);
assert.doesNotMatch(html, /模型自行改写的标题|另一个模型标题/);

// 中文注解：标题和正文的格式必须进入持久化 HTML，编辑器重开及 Word 导出才能复用同一语义。
assert.match(html, /<h2[^>]*>[\s\S]*?<span[^>]+color:\s*#000000[^>]+font-weight:\s*bold[^>]*>/i);
assert.match(html, /<p[^>]+data-indent="1"[^>]+data-widow-control="true"[^>]+style="[^"]*line-height:\s*1\.5[^"]*text-align:\s*justify[^"]*"[^>]*>[\s\S]*?<span[^>]+color:\s*#000000[^>]+font-weight:\s*600[^>]*>第一段说明项目背景。<\/span><\/p>/i);
assert.doesNotMatch(html, /font-family:\s*"/i);
assert.equal((html.match(/<p\b/g) || []).length, 3);

const layeredOutline = [
  { title: "一、总体方案", level: 2 },
  { title: "1.1 实施步骤", level: 3 }
];
const layeredHtml = formatGeneratedBodyHtml(JSON.stringify([
  { paragraphs: ["总体方案正文。"] },
  { paragraphs: ["实施步骤正文。"] }
]), layeredOutline, "分层项目");
// 中文注解：正文排版必须保留用户大纲层级，二级、三级标题不能在生成后被扁平化。
assert.match(layeredHtml, /<h2[^>]+data-outline-level="1"[^>]*>[\s\S]*?一、总体方案[\s\S]*?<\/h2>/);
assert.match(layeredHtml, /<h3[^>]+data-outline-level="2"[^>]*>[\s\S]*?1\.1 实施步骤[\s\S]*?<\/h3>/);

const longOutline = Array.from({ length: 13 }, (_, index) => ({ title: `第${index + 1}节`, level: index % 2 ? 3 : 2 }));
const longHtml = formatGeneratedBodyHtml(JSON.stringify(longOutline.map((_, index) => ({ paragraphs: [`第${index + 1}节正文。`] }))), longOutline, "长大纲");
assert.equal((longHtml.match(/<h[1-6]\b/g) || []).length, 13);
assert.match(longHtml, /第13节正文。/);

const filteredOutlineHtml = formatGeneratedBodyHtml(JSON.stringify([
  { paragraphs: ["有效第一节正文。"] },
  { paragraphs: ["有效第二节正文。"] }
]), [{ title: "" }, { title: "第一节", level: 2 }, { title: "第二节", level: 3 }], "空项过滤");
assert.match(filteredOutlineHtml, /第一节[\s\S]*有效第一节正文。[\s\S]*第二节[\s\S]*有效第二节正文。/);

const plainTextHtml = formatGeneratedBodyHtml(`## 一、项目背景与目标\n项目围绕实际需求开展。\n\n2. 实施方案\n方案强调分阶段落地。`, outline, "智能文档项目");
assert.match(plainTextHtml, /一、项目背景与目标[\s\S]*项目围绕实际需求开展。/);
assert.match(plainTextHtml, /二、实施方案[\s\S]*方案强调分阶段落地。/);

const escapedHtml = formatGeneratedBodyHtml(JSON.stringify([{ paragraphs: ["正文<script>alert(1)</script>"] }]), ["标题<测试>"], "测试");
assert.match(escapedHtml, /标题&lt;测试&gt;/);
assert.match(escapedHtml, /正文&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
assert.doesNotMatch(escapedHtml, /<script>/);

const docxBuffer = await createDocxBuffer({ title: "自动排版验证", content: html });
const documentXml = await (await JSZip.loadAsync(docxBuffer)).file("word/document.xml").async("string");
const paragraphs = documentXml.match(/<w:p[\s\S]*?<\/w:p>/g) || [];
const headingXml = paragraphs.find((paragraph) => paragraph.includes("一、项目背景与目标")) || "";
const bodyXml = paragraphs.find((paragraph) => paragraph.includes("第一段说明项目背景")) || "";

// 中文注解：导出检查锁定 Word 原生段落与文字属性，避免编辑器看似正确但 DOCX 丢失自动排版。
assert.match(headingXml, /<w:pStyle w:val="Heading2"\/>/);
assert.match(headingXml, /<w:b\/>/);
assert.match(headingXml, /<w:color w:val="000000"\/>/);
assert.match(bodyXml, /<w:ind w:firstLine="440"\/>/);
assert.match(bodyXml, /<w:spacing[^>]+w:line="360"[^>]+w:lineRule="auto"\/>/);
assert.match(bodyXml, /<w:b\/>/);
assert.match(bodyXml, /<w:color w:val="000000"\/>/);

const layeredDocxBuffer = await createDocxBuffer({ title: "多级大纲验证", content: layeredHtml });
const layeredDocumentXml = await (await JSZip.loadAsync(layeredDocxBuffer)).file("word/document.xml").async("string");
const layeredHeadingXml = (layeredDocumentXml.match(/<w:p[\s\S]*?<\/w:p>/g) || []).find((paragraph) => paragraph.includes("1.1 实施步骤")) || "";
assert.match(layeredHeadingXml, /<w:pStyle w:val="Heading3"\/>/);

console.log("AI 正文自动排版检查通过。", { sectionCount: outline.length, paragraphCount: 3 });
