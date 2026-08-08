import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { chromium } from "playwright";
import JSZip from "jszip";
import { createDocxBuffer } from "../server/index.js";
import { playwrightLaunchOptions } from "./playwright-browser.mjs";

const distRoot = resolve("dist");
const templates = [
  {
    id: 11,
    name: "工作总结",
    category: "办公通用",
    documentType: "工作总结",
    topic: "季度工作总结",
    requirement: "突出目标、成果和后续计划。",
    outline: ["一、工作概况", "二、成果数据", "三、问题复盘", "四、后续计划"],
    hasCover: false,
    hasStyle: false,
    assets: []
  },
  {
    id: 12,
    name: "会议纪要",
    category: "办公通用",
    documentType: "会议纪要",
    topic: "项目推进会议纪要",
    requirement: "记录结论、行动项、责任人和完成期限。",
    outline: ["一、会议基本信息", "二、议题与讨论要点", "三、会议决议", "四、行动项与责任人"],
    hasCover: false,
    hasStyle: false,
    assets: []
  }
];

const plan = {
  recommendedTemplateId: 12,
  recommendedTemplateName: "会议纪要",
  title: "产品上线评审会议纪要",
  documentType: "会议纪要",
  tone: "正式",
  requirement: "记录会议结论、责任人、完成期限和待升级风险。",
  audience: "项目负责人和管理层",
  expectedPages: "3-6页",
  fitScore: 96,
  reason: "会议纪要模板与上线评审、决议留痕和行动项管理最匹配。",
  outline: ["一、会议基本信息", "二、评审议题与讨论要点", "三、会议决议", "四、行动项、责任人与期限"],
  qualityChecklist: ["参会人与议题信息完整", "会议决议明确可追溯", "行动项包含责任人和期限", "未决问题和升级路径已标明"],
  workflow: [
    { code: "brief_analyzer", name: "需求分析", status: "completed", summary: "已识别上线评审交付需求" },
    { code: "template_matcher", name: "模板匹配", status: "completed", summary: "会议纪要综合匹配度 96%" },
    { code: "structure_architect", name: "结构设计", status: "completed", summary: "已规划 4 个正式章节" },
    { code: "quality_reviewer", name: "质量审校", status: "completed", summary: "已生成 4 项质量门禁" }
  ]
};

let createdDocument = null;

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8"
};

function sendJson(response, value, statusCode = 200) {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", "http://127.0.0.1");
  if (request.method === "GET" && url.pathname === "/api/session") {
    sendJson(response, { user: { userId: "agent-ui-test", isMolingUser: false }, points: { enabled: false, remaining: null, entitlements: [] } });
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/templates") {
    sendJson(response, { templates });
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/documents") {
    sendJson(response, { documents: createdDocument ? [createdDocument] : [] });
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/ai/template-agent") {
    const input = await readJson(request);
    assert.match(input.brief, /会议纪要|评审|正式文档/);
    assert.equal(input.candidates.length, 2);
    sendJson(response, { plan });
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/documents") {
    const input = await readJson(request);
    createdDocument = {
      id: 701,
      userId: "agent-ui-test",
      title: input.title,
      documentType: input.documentType,
      tone: input.tone,
      templateId: input.templateId,
      outline: input.outline,
      content: input.content,
      pageLayout: input.pageLayout,
      status: "draft",
      wordCount: 0,
      updatedAt: new Date().toISOString()
    };
    sendJson(response, { document: createdDocument }, 201);
    return;
  }

  const requestedPath = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/, "");
  let filePath = resolve(distRoot, requestedPath);
  // 中文注解：测试静态服务器只允许访问 dist，避免路径穿越读取工作区文件。
  if (filePath !== distRoot && !filePath.startsWith(`${distRoot}${sep}`)) {
    response.writeHead(403).end();
    return;
  }
  try {
    if (!(await stat(filePath)).isFile()) filePath = resolve(distRoot, "index.html");
  } catch {
    filePath = resolve(distRoot, "index.html");
  }
  response.writeHead(200, { "Content-Type": mimeTypes[extname(filePath)] || "application/octet-stream" });
  response.end(await readFile(filePath));
});

await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
const address = server.address();
assert.ok(address && typeof address === "object");
const browser = await chromium.launch(playwrightLaunchOptions());

try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: "networkidle" });
  assert.equal(await page.getByText("企业文档助手", { exact: true }).count(), 1, "产品品牌区必须使用正式商业标识");
  assert.equal(await page.getByText("本地开发版", { exact: true }).count(), 0, "生产前端不能固定展示开发版标识");
  const mobileLicenseLink = page.getByRole("link", { name: "查看第三方开源许可证全文" });
  await mobileLicenseLink.waitFor();
  const mobileLicenseBox = await mobileLicenseLink.boundingBox();
  assert.ok(mobileLicenseBox && mobileLicenseBox.x >= 0 && mobileLicenseBox.x + mobileLicenseBox.width <= 390, "390px 窄屏下开源许可入口不能横向溢出");
  for (let index = 0; index < 8 && await page.evaluate(() => document.activeElement?.getAttribute("aria-label") !== "查看第三方开源许可证全文"); index += 1) {
    await page.keyboard.press("Tab");
  }
  const licenseFocusStyle = await mobileLicenseLink.evaluate((node) => {
    const style = getComputedStyle(node);
    return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth, outlineColor: style.outlineColor };
  });
  assert.deepEqual(licenseFocusStyle, { outlineStyle: "solid", outlineWidth: "2px", outlineColor: "rgb(47, 125, 112)" }, "键盘 Tab 聚焦开源许可时必须显示高对比双像素轮廓");
  await page.getByRole("button", { name: "模板库", exact: true }).click();
  const agentPanel = page.locator(".template-agent");
  await agentPanel.waitFor();
  const panelBox = await agentPanel.boundingBox();
  assert.ok(panelBox && panelBox.x >= 0 && panelBox.x + panelBox.width <= 390, "390px 窄屏下智能体面板不能横向溢出");
  await page.getByLabel("文档交付需求").fill("为产品上线评审会生成正式会议纪要，需要记录结论、责任人和完成期限。");
  await page.getByRole("button", { name: /运行智能体/ }).click();
  await page.getByText("产品上线评审会议纪要", { exact: true }).waitFor();
  assert.equal(await page.locator(".agent-workflow > div").count(), 4);
  assert.equal(await page.getByText("行动项包含责任人和期限", { exact: true }).count(), 1);
  if (process.env.TEMPLATE_AGENT_SCREENSHOT_PATH) {
    await page.screenshot({ path: resolve(process.env.TEMPLATE_AGENT_SCREENSHOT_PATH), fullPage: true });
  }
  const desktopPage = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await desktopPage.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: "networkidle" });
  const desktopLicenseLink = desktopPage.getByRole("link", { name: "查看第三方开源许可证全文" });
  await desktopLicenseLink.waitFor();
  const [licensePage] = await Promise.all([
    desktopPage.waitForEvent("popup"),
    desktopLicenseLink.click()
  ]);
  await licensePage.waitForLoadState("domcontentloaded");
  const licenseText = await licensePage.locator("body").innerText();
  assert.match(licenseText, /MOLINWORD THIRD-PARTY LICENSE BUNDLE/);
  assert.match(licenseText, /Package: react@\d+\.\d+\.\d+[\s\S]*?License: MIT/);
  assert.doesNotMatch(licenseText, /release-manifest|artifactSha256/i, "公开许可证全文不能混入内部发布清单");
  await licensePage.close();
  await desktopPage.getByRole("button", { name: "收起主导航" }).click();
  await desktopLicenseLink.waitFor();
  assert.equal(await desktopLicenseLink.getAttribute("href"), "/THIRD_PARTY_LICENSES.txt");
  await desktopPage.getByRole("button", { name: "模板库", exact: true }).click();
  await desktopPage.getByRole("button", { name: /运行智能体/ }).click();
  await desktopPage.getByText("产品上线评审会议纪要", { exact: true }).waitFor();
  const desktopPanelBox = await desktopPage.locator(".template-agent").boundingBox();
  assert.ok(desktopPanelBox && desktopPanelBox.x >= 0 && desktopPanelBox.x + desktopPanelBox.width <= 1440, "桌面宽度下智能体面板不能横向溢出");
  assert.equal(await desktopPage.locator(".agent-workflow > div").count(), 4);
  if (process.env.TEMPLATE_AGENT_DESKTOP_SCREENSHOT_PATH) {
    await desktopPage.screenshot({ path: resolve(process.env.TEMPLATE_AGENT_DESKTOP_SCREENSHOT_PATH), fullPage: true });
  }
  await desktopPage.close();
  await page.getByRole("button", { name: "采用方案并创建文档", exact: true }).click();
  await page.locator(".word-editor").waitFor();
  assert.equal(await page.locator(".editor-document-title").textContent(), "产品上线评审会议纪要");
  // 中文注解：Tiptap 会移除未注册的 data 属性，但用户可见的元数据表及内容必须保留。
  assert.equal(await page.locator(".word-editor table", { hasText: "V1.0" }).count(), 1);
  assert.equal(await page.locator(".word-editor h2", { hasText: "四、行动项、责任人与期限" }).count(), 1);
  assert.ok(createdDocument, "采用智能体方案后必须真实创建文档");
  assert.equal(createdDocument.templateId, 12);
  assert.equal(createdDocument.outline.length, 4);
  assert.match(createdDocument.content, /data-template-table="metadata"/);
  assert.match(createdDocument.content, /V1\.0/);
  const docxBuffer = await createDocxBuffer({ title: createdDocument.title, content: createdDocument.content });
  const archive = await JSZip.loadAsync(docxBuffer);
  const documentXml = await archive.file("word/document.xml")?.async("string") || "";
  const stylesXml = await archive.file("word/styles.xml")?.async("string") || "";
  assert.match(documentXml, /<w:tbl>/, "正式元数据表必须进入 Word 导出");
  assert.match(documentXml, /产品上线评审会议纪要/);
  assert.match(documentXml, /四、行动项、责任人与期限/);
  const heading2Styles = [...stylesXml.matchAll(/<w:style[^>]+w:styleId="([^"]+)"[^>]*>[\s\S]*?<\/w:style>/g)].filter((match) => match[1] === "Heading2");
  assert.equal(heading2Styles.length, 1, `Heading2 应只有一个样式定义，实际为 ${heading2Styles.length}`);
  const heading2Style = heading2Styles[0][0];
  const heading2Color = heading2Style.match(/<w:color w:val="([0-9A-Fa-f]{6})"\/>/)?.[1].toUpperCase();
  assert.ok(!heading2Color || heading2Color === "000000", `Word 标题样式不能回流强调色，实际为 ${heading2Color}`);
  console.log("模板智能体窄屏创建与 Word 导出工作流检查通过。", { documentId: createdDocument.id, templateId: createdDocument.templateId });
} finally {
  await browser.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}
