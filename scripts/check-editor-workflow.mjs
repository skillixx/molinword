import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import JSZip from "jszip";
import { chromium } from "playwright";
import { createDocxBuffer } from "../server/index.js";

const listText = "这是一个需要跨页显示的超长编号列表项，必须保持同一个编号并在续页继续排版。".repeat(180);
const cellA = "左侧单元格包含大量业务说明，用于验证超高表格行可以跨页展示。".repeat(145);
const cellB = "右侧单元格包含对应的验收标准，分页后仍需保持两列结构。".repeat(120);
const widowText = "孤行控制验证段落需要在每个分页片段保留至少两行文字，避免页首或页尾出现单独一行。".repeat(120);
const tinyPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lT3g6wAAAABJRU5ErkJggg==";
const defaultPageTextStyle = { alignment: "center", fontFamily: "Microsoft YaHei", fontSizePt: 9, color: "#6B7280", bold: false, italic: false };
const styledHeader = { alignment: "left", fontFamily: "SimSun", fontSizePt: 12, color: "#C00000", bold: true, italic: false };
const styledFooter = { alignment: "right", fontFamily: "Arial", fontSizePt: 10.5, color: "#1F4E79", bold: false, italic: true };
const fixtureDocument = {
  id: 9001,
  title: "编辑器超长结构分页回归",
  documentType: "工作总结",
  tone: "正式",
  templateId: 3,
  outline: ["超长结构分页"],
  content: `<p><span style="font-size: 12pt; color: #ff0000">保留小号红字</span><span style="font-size: 18pt; color: #0000ff">保留大号蓝字</span></p><p>突出显示工具 上标工具 下标工具</p><ol><li>${listText}</li><li>第二个编号项，用于确认编号连续。</li></ol><table><tbody><tr><th>说明</th><th>标准</th></tr><tr><td><img src="${tinyPng}" style="width:32px;height:32px" /><p>${cellA}</p></td><td><p>${cellB}</p></td></tr><tr><td><p>下一行</p></td><td><p>保持结构</p></td></tr></tbody></table><table><tbody><tr><th>审批阶段</th><th>状态</th></tr><tr><td>商务评审</td><td>通过</td></tr><tr><td>归档确认</td><td>完成</td></tr></tbody></table><p>分页控制前置段落</p><p>分页控制段落</p><p>分页控制后续段落</p><p>${widowText}</p>`,
  // 中文注解：模拟升级前数据库里的旧页面设置，确保真实历史文档开启高级页眉时不会崩溃。
  pageLayout: { headerText: "", footerText: "", pageNumberEnabled: false },
  status: "draft",
  wordCount: listText.length + cellA.length + cellB.length,
  updatedAt: new Date().toISOString()
};
const fixtureTemplate = {
  id: 3,
  name: "商业计划书",
  category: "商业经营",
  documentType: "工作总结",
  topic: "分页回归",
  requirement: "",
  outline: [],
  status: "active",
  hasStyle: true,
  assets: [{ id: 1, purpose: "template_style", fileName: "style.json", fileType: "json", fileSize: 100, url: "/api/templates/3/assets/1/download" }]
};
const fixtureWordStyle = { fontFamily: "SimSun", titleSize: 38, headingSize: 28, bodySize: 22, lineSpacing: 380, titleColor: "1F4E79", headingColor: "245F55" };
let storedDocument = structuredClone(fixtureDocument);
let exportedDocxBuffer = null;
let manualSaveRequestCount = 0;
let activeSaveRequestCount = 0;
let maxConcurrentSaveRequestCount = 0;
const distRoot = resolve("dist");

function sendJson(response, value, status = 200) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

async function apiResponse(request, response) {
  const url = new URL(request.url || "/", "http://127.0.0.1");
  if (request.method === "GET" && url.pathname === "/api/session") {
    sendJson(response, { user: { userId: "pagination-test", appId: "test", productId: "test", isMolingUser: false, expiresAt: null }, points: { enabled: false, entitlements: [], remaining: null } });
    return true;
  }
  if (request.method === "GET" && url.pathname === "/api/documents") {
    sendJson(response, { documents: [storedDocument] });
    return true;
  }
  if (request.method === "GET" && url.pathname === `/api/documents/${fixtureDocument.id}`) {
    sendJson(response, { document: storedDocument });
    return true;
  }
  if (request.method === "PATCH" && url.pathname === `/api/documents/${fixtureDocument.id}`) {
    const update = await readJsonBody(request);
    if (update.saveVersion) manualSaveRequestCount += 1;
    activeSaveRequestCount += 1;
    maxConcurrentSaveRequestCount = Math.max(maxConcurrentSaveRequestCount, activeSaveRequestCount);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 80));
    // 中文注解：测试服务真实保存编辑器提交的 HTML，才能验证刷新重开后的格式没有丢失。
    storedDocument = { ...storedDocument, ...update, updatedAt: new Date().toISOString() };
    activeSaveRequestCount -= 1;
    sendJson(response, { document: storedDocument });
    return true;
  }
  if (request.method === "POST" && url.pathname === `/api/documents/${fixtureDocument.id}/images`) {
    for await (const _chunk of request) { /* 中文注解：消费 multipart 请求体，模拟真实上传接口。 */ }
    sendJson(response, { image: { id: "file-2", fileId: 2, src: "/api/files/2/content", alt: "header-logo.png", widthPx: 120, heightPx: 60, paragraphIndex: 0, placement: "afterText", alignment: "center" } }, 201);
    return true;
  }
  if (request.method === "POST" && url.pathname === `/api/documents/${fixtureDocument.id}/export-docx`) {
    const body = await readJsonBody(request);
    const content = typeof body.content === "string" ? body.content : storedDocument.content;
    const hydratedPageLayout = JSON.parse(JSON.stringify(storedDocument.pageLayout).replaceAll("/api/files/2/content", tinyPng));
    exportedDocxBuffer = await createDocxBuffer({ title: storedDocument.title, content, templateStyle: fixtureWordStyle, pageLayout: hydratedPageLayout });
    sendJson(response, { file: { id: 1, documentId: storedDocument.id, fileName: "editor-parity.docx", fileType: "docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", fileSize: exportedDocxBuffer.length, downloadUrl: "/api/files/1/download" } }, 201);
    return true;
  }
  if (request.method === "GET" && url.pathname === "/api/files/1/download" && exportedDocxBuffer) {
    response.writeHead(200, {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": 'attachment; filename="editor-parity.docx"'
    });
    response.end(exportedDocxBuffer);
    return true;
  }
  if (request.method === "GET" && url.pathname === "/api/files/2/content") {
    response.writeHead(200, { "Content-Type": "image/png" });
    response.end(Buffer.from(tinyPng.split(",")[1], "base64"));
    return true;
  }
  if (request.method === "GET" && url.pathname === "/api/templates") {
    sendJson(response, { templates: [fixtureTemplate] });
    return true;
  }
  if (request.method === "GET" && url.pathname === `/api/templates/${fixtureTemplate.id}`) {
    sendJson(response, { template: fixtureTemplate });
    return true;
  }
  if (request.method === "GET" && url.pathname === "/api/templates/3/assets/1/download") {
    sendJson(response, fixtureWordStyle);
    return true;
  }
  return false;
}

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml"
};

const server = createServer(async (request, response) => {
  try {
    if (await apiResponse(request, response)) return;
    const url = new URL(request.url || "/", "http://127.0.0.1");
    const requestedPath = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/, "");
    let filePath = resolve(distRoot, requestedPath);
    // 中文注解：测试服务器仅允许读取 dist，避免路径穿越误读工作区其他文件。
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
  } catch (error) {
    response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    response.end(error instanceof Error ? error.message : "测试服务器异常");
  }
});

await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
const address = server.address();
assert.ok(address && typeof address === "object");
const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const browserErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("pageerror", (error) => browserErrors.push(error.message));
  await page.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: "networkidle" });
  await page.getByText(fixtureDocument.title, { exact: true }).click();
  const editor = page.locator(".word-editor");
  await editor.waitFor();
  assert.equal(await editor.isEditable(), true);
  await editor.click();
  await editor.press("Control+A");
  await page.getByLabel("字体", { exact: true }).selectOption("SimSun");
  await page.getByTitle("斜体", { exact: true }).click();
  await page.getByTitle("删除线", { exact: true }).click();
  const selectEditorText = async (target) => {
    await page.evaluate((text) => {
      const root = document.querySelector(".word-editor");
      root.focus();
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node && !node.nodeValue?.includes(text)) node = walker.nextNode();
      if (!node) throw new Error(`找不到编辑器文字：${text}`);
      const start = node.nodeValue.indexOf(text);
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, start + text.length);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      // 中文注解：ProseMirror 监听 selectionchange 同步内部选区；只改浏览器 Range 会让后续工具仍作用于旧选区。
      document.dispatchEvent(new Event("selectionchange", { bubbles: true }));
    }, target);
    await page.waitForTimeout(50);
  };
  const formattedHtml = await editor.innerHTML();
  assert.match(formattedHtml, /font-family:\s*SimSun/);
  assert.match(formattedHtml, /font-size:\s*12pt/);
  assert.match(formattedHtml, /font-size:\s*18pt/);
  assert.match(formattedHtml, /color:\s*(?:#ff0000|rgb\(255, 0, 0\))/);
  assert.match(formattedHtml, /color:\s*(?:#0000ff|rgb\(0, 0, 255\))/);
  assert.match(formattedHtml, /<em>/);
  assert.match(formattedHtml, /<s>/);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  assert.doesNotMatch(await editor.innerHTML(), /<s>/);
  await page.getByRole("button", { name: "重做", exact: true }).click();
  assert.match(await editor.innerHTML(), /<s>/);

  // 中文注解：真实选择三个独立文本并点击工具栏，证明高级字符格式可编辑，而不只是被动展示导入结果。
  await selectEditorText("突出显示工具");
  await page.getByRole("button", { name: "黄色突出显示", exact: true }).click();
  await selectEditorText("上标工具");
  await page.getByRole("button", { name: "上标", exact: true }).click();
  await selectEditorText("下标工具");
  await page.getByRole("button", { name: "下标", exact: true }).click();
  const advancedFormatHtml = await editor.innerHTML();
  assert.match(advancedFormatHtml, /<mark[^>]+data-highlight="yellow"[^>]*>突出显示工具<\/mark>/);
  assert.match(advancedFormatHtml, /<sup>上标工具<\/sup>/);
  assert.match(advancedFormatHtml, /<sub>下标工具<\/sub>/);
  const paginationParagraphLocator = editor.locator("p").filter({ hasText: "分页控制段落" }).filter({ hasNotText: "前置" });
  await paginationParagraphLocator.click();
  await page.getByRole("button", { name: "与下段同页", exact: true }).click();
  await page.getByRole("button", { name: "段中不分页", exact: true }).click();
  await page.getByRole("button", { name: "段前分页", exact: true }).click();
  await page.getByRole("button", { name: "孤行控制", exact: true }).click();
  assert.match(await editor.innerHTML(), /data-widow-control="false"[^>]*>[\s\S]*?分页控制段落/);
  await page.getByRole("button", { name: "孤行控制", exact: true }).click();
  const paginationControlHtml = await editor.innerHTML();
  assert.match(paginationControlHtml, /<p[^>]+data-keep-next="true"[^>]+data-keep-lines="true"[^>]+data-page-break-before="true"[^>]+data-widow-control="true"[^>]*>[\s\S]*?分页控制段落[\s\S]*?<\/p>/);

  const sourceTables = editor.locator("table");
  assert.equal(await sourceTables.count(), 2);
  const firstTable = sourceTables.first();
  const headerCells = firstTable.locator("th");
  assert.equal(await headerCells.count(), 2);
  await headerCells.first().click();
  await headerCells.last().click({ modifiers: ["Shift"] });
  await page.getByRole("button", { name: "合并", exact: true }).click();
  assert.match(await editor.innerHTML(), /<th[^>]+colspan="2"/);
  await firstTable.locator("th").click();
  await page.getByRole("button", { name: "拆分", exact: true }).click();
  assert.equal(await firstTable.locator("th").count(), 2);
  await headerCells.first().click();
  await headerCells.last().click({ modifiers: ["Shift"] });
  await page.getByRole("button", { name: "合并", exact: true }).click();
  const approvalCells = sourceTables.last().locator("td");
  assert.equal(await approvalCells.count(), 4);
  await approvalCells.nth(0).click();
  await approvalCells.nth(2).click({ modifiers: ["Shift"] });
  await page.getByRole("button", { name: "合并", exact: true }).click();
  assert.match(await editor.innerHTML(), /<td[^>]+rowspan="2"[^>]*>.*商务评审.*归档确认/s);

  await page.evaluate(() => {
    const paragraph = document.querySelector(".word-editor p");
    if (!paragraph) throw new Error("未找到段落样式测试节点");
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  await page.locator('label[title="设置当前段落样式"] select').selectOption("heading-2");
  assert.match(await editor.innerHTML(), /<h2[^>]*>.*保留小号红字.*<\/h2>/);

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByText("页面设置", { exact: true }).click();
  const desktopPageSettings = await page.locator(".page-layout-popover").boundingBox();
  // 中文注解：常见 1280×720 办公窗口也必须完整容纳页面设置，长表单通过面板内部滚动访问。
  assert.ok(desktopPageSettings && desktopPageSettings.x >= 0 && desktopPageSettings.y >= 0);
  assert.ok(desktopPageSettings.x + desktopPageSettings.width <= 1280 && desktopPageSettings.y + desktopPageSettings.height <= 720);
  await page.getByLabel("默认页眉文字", { exact: true }).fill("奇数页项目页眉");
  await page.getByLabel("默认页眉字体", { exact: true }).selectOption("SimSun");
  await page.getByLabel("默认页眉字号", { exact: true }).fill("12");
  await page.getByLabel("默认页眉颜色", { exact: true }).fill("#c00000");
  await page.getByLabel("默认页眉加粗", { exact: true }).click();
  await page.getByLabel("默认页眉对齐", { exact: true }).selectOption("left");
  await page.locator(".page-image-settings").first().locator('input[type="file"]').setInputFiles({ name: "header-logo.png", mimeType: "image/png", buffer: Buffer.from(tinyPng.split(",")[1], "base64") });
  await page.getByLabel("默认页眉图片1对齐", { exact: true }).selectOption("left");
  await page.getByLabel("默认页脚文字", { exact: true }).fill("奇数页办公文档");
  await page.getByLabel("默认页脚字体", { exact: true }).selectOption("Arial");
  await page.getByLabel("默认页脚字号", { exact: true }).fill("10.5");
  await page.getByLabel("默认页脚颜色", { exact: true }).fill("#1f4e79");
  await page.getByLabel("默认页脚斜体", { exact: true }).click();
  await page.getByLabel("默认页脚对齐", { exact: true }).selectOption("right");
  await page.getByLabel("默认页脚页码", { exact: true }).check();
  await page.getByLabel("默认页脚页码独立一行", { exact: true }).check();
  await page.getByText("首页不同", { exact: true }).click();
  await page.getByLabel("首页页眉文字", { exact: true }).fill("首页项目封面");
  await page.getByLabel("首页页脚文字", { exact: true }).fill("首页保密标识");
  await page.getByText("奇偶页不同", { exact: true }).click();
  await page.getByLabel("偶数页页眉文字", { exact: true }).fill("偶数页项目页眉");
  await page.getByLabel("偶数页页脚文字", { exact: true }).fill("偶数页办公文档");
  await page.getByLabel("偶数页脚页码", { exact: true }).check();
  await page.getByText("页面设置", { exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 900 });

  await editor.click();
  await editor.press("Control+End");
  await page.getByRole("button", { name: "分节符", exact: true }).click();
  await editor.type("第二节横向内容");
  await page.getByText("页面设置", { exact: true }).click();
  await page.getByText("第 2 节 / 共 2 节", { exact: true }).waitFor();
  await page.getByLabel("当前节纸张方向", { exact: true }).selectOption("landscape");
  await page.getByLabel("当前节上边距", { exact: true }).fill("1.27");
  await page.getByLabel("当前节下边距", { exact: true }).fill("1.27");
  await page.getByLabel("当前节页眉距纸边", { exact: true }).fill("0.85");
  await page.getByLabel("当前节页脚距纸边", { exact: true }).fill("1.48");
  await page.getByLabel("当前节页码格式", { exact: true }).selectOption("upperRoman");
  await page.getByLabel("当前节起始页码", { exact: true }).fill("3");
  const secondSectionHeaderInput = page.getByLabel("默认页眉文字", { exact: true });
  await secondSectionHeaderInput.fill("第二节横向页眉");
  await secondSectionHeaderInput.press("Enter");
  await secondSectionHeaderInput.type("审批状态：已确认");
  await page.getByLabel("默认页脚文字", { exact: true }).fill("第二节横向页脚");
  await page.getByText("首页不同", { exact: true }).click();
  await page.getByText("奇偶页不同", { exact: true }).click();
  await page.getByText("页面设置", { exact: true }).click();

  const manualSaveCountBeforeShortcut = manualSaveRequestCount;
  await page.keyboard.press("Control+S");
  await page.keyboard.press("Control+S");
  await page.waitForFunction(() => document.querySelector(".toolbar-actions button")?.hasAttribute("disabled") === true);
  await page.waitForFunction(() => document.querySelector(".save-status")?.textContent?.includes("已保存"));
  assert.equal(manualSaveRequestCount - manualSaveCountBeforeShortcut, 1);
  assert.match(storedDocument.content, /<h2[^>]*>.*保留小号红字.*<\/h2>/);
  assert.match(storedDocument.content, /font-family:\s*SimSun/);
  assert.match(storedDocument.content, /font-size:\s*12pt/);
  assert.match(storedDocument.content, /data-section-break="nextPage"/);
  assert.match(storedDocument.content, /rowspan="2"/);
  assert.match(storedDocument.content, /第二节横向内容/);
  assert.match(storedDocument.content, /第二节横向页眉/);
  const storedSectionLayoutText = storedDocument.content.match(/data-section-layout="([^"]+)"/)?.[1]
    .replaceAll("&quot;", '"')
    .replaceAll("&amp;", "&") || "";
  const storedSectionLayout = JSON.parse(storedSectionLayoutText);
  // 中文注解：直接验证节点负载，避免界面文本存在但连续设置被旧状态覆盖后仍误判为保存成功。
  assert.equal(storedSectionLayout.orientation, "landscape");
  assert.equal(storedSectionLayout.headerText, "第二节横向页眉\n审批状态：已确认");
  assert.equal(storedSectionLayout.footerText, "第二节横向页脚");
  assert.deepEqual(storedSectionLayout.headerStyle, styledHeader);
  assert.deepEqual(storedSectionLayout.footerStyle, styledFooter);
  assert.equal(storedSectionLayout.firstPageDifferent, false);
  assert.equal(storedSectionLayout.oddEvenDifferent, false);
  assert.equal(storedSectionLayout.pageNumberPosition, "footer");
  assert.equal(storedSectionLayout.footerPageNumberTemplate, "第 {PAGE} 页 / 共 {NUMPAGES} 页");
  assert.equal(storedSectionLayout.footerPageNumberSeparate, true);
  assert.equal(storedSectionLayout.headerDistance, 482);
  assert.equal(storedSectionLayout.footerDistance, 839);
  assert.equal(storedSectionLayout.pageNumberFormat, "upperRoman");
  assert.equal(storedSectionLayout.pageNumberStart, 3);
  assert.deepEqual(storedSectionLayout.margins, { top: 720, right: 1440, bottom: 720, left: 1440 });
  assert.deepEqual(storedDocument.pageLayout, {
    headerText: "奇数页项目页眉",
    headerStyle: styledHeader,
    headerImages: [{ id: "file-2", fileId: 2, src: "/api/files/2/content", alt: "header-logo.png", widthPx: 120, heightPx: 60, paragraphIndex: 0, placement: "afterText", alignment: "left" }],
    footerText: "奇数页办公文档",
    footerStyle: styledFooter,
    footerImages: [],
    headerPageNumberTemplate: "",
    footerPageNumberTemplate: "第 {PAGE} 页 / 共 {NUMPAGES} 页",
    headerPageNumberSeparate: false,
    footerPageNumberSeparate: true,
    pageNumberEnabled: true,
    pageNumberPosition: "footer",
    firstPageDifferent: true,
    firstPage: { headerText: "首页项目封面", headerStyle: defaultPageTextStyle, headerImages: [], footerText: "首页保密标识", footerStyle: defaultPageTextStyle, footerImages: [], headerPageNumberTemplate: "", footerPageNumberTemplate: "", headerPageNumberSeparate: false, footerPageNumberSeparate: false, pageNumberEnabled: false, pageNumberPosition: "footer" },
    oddEvenDifferent: true,
    evenPage: { headerText: "偶数页项目页眉", headerStyle: defaultPageTextStyle, headerImages: [], footerText: "偶数页办公文档", footerStyle: defaultPageTextStyle, footerImages: [], headerPageNumberTemplate: "", footerPageNumberTemplate: "第 {PAGE} 页 / 共 {NUMPAGES} 页", headerPageNumberSeparate: false, footerPageNumberSeparate: false, pageNumberEnabled: true, pageNumberPosition: "footer" },
    orientation: "portrait",
    pageNumberFormat: "decimal",
    pageNumberStart: null,
    headerDistance: 708,
    footerDistance: 708,
    margins: { top: 1440, right: 1440, bottom: 1440, left: 1440 }
  });

  await page.reload({ waitUntil: "networkidle" });
  await page.getByText(storedDocument.title, { exact: true }).click();
  await editor.waitFor();
  const reopenedHtml = await editor.innerHTML();
  assert.match(reopenedHtml, /<h2[^>]*>.*保留小号红字.*<\/h2>/);
  assert.match(reopenedHtml, /font-family:\s*SimSun/);
  assert.match(reopenedHtml, /font-size:\s*12pt/);
  assert.match(reopenedHtml, /font-size:\s*18pt/);
  assert.match(reopenedHtml, /<em>/);
  assert.match(reopenedHtml, /<s>/);
  assert.match(reopenedHtml, /data-section-break="nextPage"/);
  assert.match(reopenedHtml, /第二节横向内容/);

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 Word", exact: true }).click();
  const download = await downloadPromise;
  await page.waitForFunction(() => document.body.textContent?.includes("Word 已生成"));
  const downloadedPath = await download.path();
  assert.ok(downloadedPath, "导出的 DOCX 应可下载");
  const downloadedBuffer = await readFile(downloadedPath);
  const archive = await JSZip.loadAsync(downloadedBuffer);
  const documentXml = await archive.file("word/document.xml")?.async("string");
  const settingsXml = await archive.file("word/settings.xml")?.async("string");
  const headerXmlParts = await Promise.all(archive.file(/^word\/header\d+\.xml$/).map((file) => file.async("string")));
  const footerXmlParts = await Promise.all(archive.file(/^word\/footer\d+\.xml$/).map((file) => file.async("string")));
  const headerMedia = archive.file(/^word\/media\/.+\.png$/);
  assert.ok(documentXml, "导出的 DOCX 应包含 document.xml");
  assert.equal(headerXmlParts.length, 5, "导出的 DOCX 应包含首节三类页眉和第二节默认/偶数页眉");
  assert.equal(footerXmlParts.length, 5, "导出的 DOCX 应包含首节三类页脚和第二节默认/偶数页脚");
  assert.ok(headerXmlParts.some((xml) => /<w:drawing>/.test(xml)) && headerMedia.length > 0, "在线页眉图片应进入导出的 DOCX 媒体部件");
  assert.equal((documentXml.match(/<w:sectPr(?:\s|>)/g) || []).length, 2);
  assert.match(documentXml, /<w:type w:val="nextPage"\/>/);
  assert.match(documentXml, /<w:pgSz[^>]+w:orient="landscape"/);
  assert.match(documentXml, /<w:pgMar[^>]+w:top="720"[^>]+w:right="1440"[^>]+w:bottom="720"[^>]+w:left="1440"/);
  assert.match(documentXml, /<w:pgMar[^>]+w:header="482"[^>]+w:footer="839"/);
  assert.match(documentXml, /<w:pgNumType[^>]+w:start="3"[^>]*w:fmt="upperRoman"/);
  assert.match(documentXml, /<w:titlePg\/>/);
  assert.match(settingsXml, /<w:evenAndOddHeaders\/>/);
  assert.match(documentXml, /<w:gridSpan w:val="2"\/>/);
  assert.match(documentXml, /<w:vMerge w:val="restart"\/>/);
  assert.match(documentXml, /<w:vMerge w:val="continue"\/>/);
  assert.match(documentXml, /<w:highlight w:val="yellow"\/>/);
  assert.match(documentXml, /<w:vertAlign w:val="superscript"\/>/);
  assert.match(documentXml, /<w:vertAlign w:val="subscript"\/>/);
  const paginationParagraph = (documentXml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g) || []).find((paragraph) => paragraph.includes("分页控制段落")) || "";
  assert.match(paginationParagraph, /<w:keepNext\/>/);
  assert.match(paginationParagraph, /<w:keepLines\/>/);
  assert.match(paginationParagraph, /<w:pageBreakBefore\/>/);
  assert.match(paginationParagraph, /<w:widowControl\/>/);
  assert.ok(headerXmlParts.some((xml) => xml.includes("首页项目封面")));
  assert.ok(headerXmlParts.some((xml) => xml.includes("奇数页项目页眉")));
  assert.ok(headerXmlParts.some((xml) => xml.includes("奇数页项目页眉") && /<w:jc w:val="left"\/>/.test(xml) && /<w:rFonts[^>]+SimSun/.test(xml) && /<w:sz w:val="24"\/>/.test(xml) && /<w:color w:val="C00000"\/>/.test(xml) && /<w:b\/>/.test(xml)));
  assert.ok(headerXmlParts.some((xml) => xml.includes("偶数页项目页眉")));
  assert.ok(headerXmlParts.some((xml) => xml.includes("第二节横向页眉")));
  assert.ok(headerXmlParts.some((xml) => xml.includes("第二节横向页眉") && xml.includes("审批状态：已确认") && (xml.match(/<w:p(?:\s|>)/g) || []).length === 2));
  assert.ok(footerXmlParts.some((xml) => xml.includes("第二节横向页脚")));
  assert.ok(footerXmlParts.some((xml) => xml.includes("第二节横向页脚") && /<w:fldSimple[^>]+w:instr="PAGE"/.test(xml) && (xml.match(/<w:p(?:\s|>)/g) || []).length === 2));
  assert.ok(footerXmlParts.some((xml) => xml.includes("奇数页办公文档") && /<w:jc w:val="right"\/>/.test(xml) && /<w:rFonts[^>]+Arial/.test(xml) && /<w:sz w:val="21"\/>/.test(xml) && /<w:color w:val="1F4E79"\/>/.test(xml) && /<w:i\/>/.test(xml)));
  assert.equal(headerXmlParts.filter((xml) => xml.includes("第二节横向页眉")).length, 2);
  assert.equal(footerXmlParts.filter((xml) => xml.includes("第二节横向页脚")).length, 2);
  assert.ok(footerXmlParts.some((xml) => xml.includes("首页保密标识")));
  assert.equal(footerXmlParts.filter((xml) => /<w:fldSimple[^>]+w:instr="PAGE"/.test(xml)).length, 4);
  // 中文注解：检查在线编辑后的具体文字，证明保存、重开和导出使用的是同一份格式数据。
  const paragraphs = documentXml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g) || [];
  const headingParagraph = paragraphs.find((paragraph) => paragraph.includes(">保留小号红字</w:t>"));
  assert.ok(headingParagraph, "导出的 DOCX 应包含在线设置的二级标题");
  assert.match(headingParagraph, /<w:pStyle w:val="Heading2"\/>/);
  const runs = headingParagraph.match(/<w:r(?:\s[^>]*)?>[\s\S]*?<\/w:r>/g) || [];
  const smallRun = runs.find((run) => run.includes(">保留小号红字</w:t>"));
  const largeRun = runs.find((run) => run.includes(">保留大号蓝字</w:t>"));
  assert.ok(smallRun && largeRun, "标题中的两段混合格式文字应分别导出");
  assert.match(smallRun, /<w:rFonts[^>]+SimSun/);
  assert.match(smallRun, /<w:sz w:val="24"\/>/);
  assert.match(smallRun, /<w:color w:val="FF0000"\/>/);
  assert.match(smallRun, /<w:i\/>/);
  assert.match(smallRun, /<w:strike\/>/);
  assert.match(largeRun, /<w:rFonts[^>]+SimSun/);
  assert.match(largeRun, /<w:sz w:val="36"\/>/);
  assert.match(largeRun, /<w:color w:val="0000FF"\/>/);

  await page.getByRole("button", { name: "分页", exact: true }).click();
  await page.locator(".page-sheet").first().waitFor();

  const result = await page.evaluate(() => {
    const pages = Array.from(document.querySelectorAll(".page-sheet"));
    const sourceListItems = Array.from(document.querySelectorAll(".word-editor > ol > li"));
    const previewListItems = Array.from(document.querySelectorAll(".page-body ol > li"));
    const sourceRows = Array.from(document.querySelectorAll(".word-editor table tr"));
    const sourceCells = sourceRows[1] ? Array.from(sourceRows[1].querySelectorAll("td, th")).map((cell) => cell.textContent || "") : [];
    const previewLongRows = Array.from(document.querySelectorAll(".page-body table"))
      .filter((table) => table.textContent?.includes("左侧单元格包含大量业务说明"))
      .flatMap((table) => Array.from(table.querySelectorAll("tr"))).filter((row) => {
      const text = row.textContent || "";
      return !text.includes("说明标准") && !text.includes("下一行保持结构");
    });
    return {
      pageCount: pages.length,
      overflowPages: pages.map((page, index) => {
        const body = page.querySelector(".page-body");
        const availableHeight = Number.parseFloat(getComputedStyle(page).getPropertyValue("--page-content-height"));
        return body && body.scrollHeight > availableHeight + 1 ? index + 1 : null;
      }).filter(Boolean),
      sectionIndexes: pages.map((page) => Number(page.getAttribute("data-section-index") || 0)),
      pageSizes: pages.map((page) => ({ width: Math.round(page.getBoundingClientRect().width), height: Math.round(page.getBoundingClientRect().height) })),
      firstPageHasList: Boolean(pages[0]?.querySelector("ol")),
      continuationMarkers: Array.from(document.querySelectorAll(".pagination-list-continuation > li")).map((item) => getComputedStyle(item).listStyleType),
      listMarginLeft: getComputedStyle(document.querySelector(".page-body ol")).marginLeft,
      sourceListItemMarginBottom: getComputedStyle(document.querySelector(".word-editor ol > li")).marginBottom,
      firstFragmentMarginBottom: getComputedStyle(document.querySelector(".page-body ol > li")).marginBottom,
      secondListStart: Array.from(document.querySelectorAll(".page-body ol")).find((list) => list.textContent?.includes("第二个编号项"))?.getAttribute("start") || "1",
      sourceListText: sourceListItems[0]?.textContent || "",
      previewListText: previewListItems.filter((item) => !item.textContent?.includes("第二个编号项")).map((item) => item.textContent || "").join(""),
      sourceCells,
      previewCells: [0, 1].map((cellIndex) => previewLongRows.map((row) => row.querySelectorAll("td, th")[cellIndex]?.textContent || "").join("")),
      tableContinuationCount: document.querySelectorAll(".pagination-table-continuation").length,
      sourceTableImageCount: document.querySelectorAll(".word-editor table img").length,
      previewTableImageCount: document.querySelectorAll(".page-body table img").length,
      previewRowSpanCount: document.querySelectorAll('.page-body td[rowspan="2"]').length,
      paginationControlStartsPage: Array.from(document.querySelectorAll(".page-sheet")).some((page) => {
        const blocks = Array.from(page.querySelectorAll(":scope > .page-body > .page-block"));
        return blocks[0]?.textContent?.includes("分页控制段落") && !page.textContent?.includes("分页控制前置段落");
      }),
      paginationControlKeepsNext: Array.from(document.querySelectorAll(".page-sheet")).some((page) => page.textContent?.includes("分页控制段落") && page.textContent?.includes("分页控制后续段落")),
      widowFragmentLineCounts: Array.from(document.querySelectorAll(".page-body p")).filter((paragraph) => paragraph.textContent?.includes("孤行控制验证段落")).map((paragraph) => {
        const range = document.createRange();
        range.selectNodeContents(paragraph);
        const tops = [];
        for (const rect of Array.from(range.getClientRects())) {
          if (rect.width > 0 && rect.height > 0 && !tops.some((top) => Math.abs(top - rect.top) < 1)) tops.push(rect.top);
        }
        return tops.length;
      }),
      widowPreviewText: Array.from(document.querySelectorAll(".page-body p")).filter((paragraph) => paragraph.textContent?.includes("孤行控制验证段落")).map((paragraph) => paragraph.textContent || "").join(""),
      templateLabelVisible: document.body.textContent?.includes("模板样式：商业计划书") || false,
      fontVariable: getComputedStyle(document.querySelector(".editor-scroll")).getPropertyValue("--document-font-family").trim(),
      lineVariable: getComputedStyle(document.querySelector(".editor-scroll")).getPropertyValue("--document-line-height").trim(),
      headerTexts: Array.from(document.querySelectorAll(".page-header")).map((item) => item.textContent || ""),
      headerImageCount: document.querySelectorAll(".page-header img").length,
      footerTexts: Array.from(document.querySelectorAll(".page-footer")).map((item) => item.textContent || ""),
      oddHeaderStyle: (() => {
        const item = Array.from(document.querySelectorAll(".page-header")).find((node) => node.textContent === "奇数页项目页眉");
        const style = item ? getComputedStyle(item) : null;
        return style ? { fontFamily: style.fontFamily, fontSize: style.fontSize, color: style.color, fontWeight: style.fontWeight, textAlign: style.textAlign } : null;
      })(),
      multilineHeaderCount: document.querySelectorAll('.page-header.multiline').length,
      oddFooterStyle: (() => {
        const item = Array.from(document.querySelectorAll(".page-footer")).find((node) => node.textContent?.includes("奇数页办公文档"));
        const style = item ? getComputedStyle(item) : null;
        return style ? { fontFamily: style.fontFamily, fontSize: style.fontSize, color: style.color, fontStyle: style.fontStyle, textAlign: style.textAlign } : null;
      })()
    };
  });

  // 中文注解：覆盖当前页空间利用、无溢出、编号延续、表格跨页和内容完整性五个分页契约。
  assert.ok(result.pageCount > 5, "fixture should create a multi-page document");
  assert.deepEqual(result.overflowPages, []);
  assert.equal(result.firstPageHasList, true);
  assert.ok(result.continuationMarkers.length > 0);
  assert.ok(result.continuationMarkers.every((marker) => marker === "none"));
  assert.equal(result.listMarginLeft, "48px");
  assert.equal(result.sourceListItemMarginBottom, "5.33px");
  assert.equal(result.firstFragmentMarginBottom, "0px");
  assert.equal(result.secondListStart, "2");
  assert.equal(result.previewListText, result.sourceListText);
  assert.deepEqual(result.previewCells, result.sourceCells);
  assert.ok(result.tableContinuationCount > 0);
  assert.equal(result.sourceTableImageCount, 1);
  assert.equal(result.previewTableImageCount, 1);
  assert.ok(result.previewRowSpanCount > 0, "分页预览应保留纵向合并单元格");
  assert.equal(result.paginationControlStartsPage, true, "段前分页段落应成为新页首段");
  assert.equal(result.paginationControlKeepsNext, true, "与下段同页应保留后续段落在同一页");
  assert.ok(result.widowFragmentLineCounts.length > 1, "孤行控制夹具应跨越多个页面");
  assert.ok(result.widowFragmentLineCounts.every((lines) => lines >= 2), "孤行控制段落的每个分页片段都应至少保留两行");
  assert.equal(result.widowPreviewText, widowText);
  assert.equal(result.templateLabelVisible, true);
  assert.equal(result.fontVariable, '"SimSun"');
  assert.equal(result.lineVariable, "1.5833");
  const secondSectionFirstPage = result.sectionIndexes.indexOf(1);
  assert.ok(secondSectionFirstPage > 0);
  assert.deepEqual(result.pageSizes[secondSectionFirstPage], { width: 1123, height: 794 });
  assert.equal(result.headerTexts.length, result.pageCount);
  assert.ok(result.headerImageCount > 0, "分页预览应显示在线设置的页眉图片");
  assert.equal(result.headerTexts[0], "首页项目封面");
  assert.ok(result.headerTexts.slice(1, secondSectionFirstPage).every((text, index) => (index + 2) % 2 === 0 ? text === "偶数页项目页眉" : text === "奇数页项目页眉"));
  assert.ok(result.headerTexts.slice(secondSectionFirstPage).every((text) => text.includes("第二节横向页眉") && text.includes("审批状态：已确认")));
  assert.ok(result.multilineHeaderCount > 0);
  assert.deepEqual(result.oddHeaderStyle, { fontFamily: 'SimSun, sans-serif', fontSize: "16px", color: "rgb(192, 0, 0)", fontWeight: "700", textAlign: "left" });
  assert.equal(result.footerTexts.length, result.pageCount);
  assert.equal(result.footerTexts[0], "首页保密标识");
  assert.ok(result.footerTexts.slice(1, secondSectionFirstPage).every((text, index) => {
    const pageNumber = index + 2;
    const expectedLabel = pageNumber % 2 === 0 ? "偶数页办公文档" : "奇数页办公文档";
    return text.includes(expectedLabel) && text.includes(`第 ${pageNumber} 页 / 共 ${result.pageCount} 页`);
  }));
  const toRoman = (value) => {
    const numerals = [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
    let number = value;
    let result = "";
    for (const [amount, numeral] of numerals) while (number >= amount) { result += numeral; number -= amount; }
    return result;
  };
  assert.ok(result.footerTexts.slice(secondSectionFirstPage).every((text, index) => text.includes("第二节横向页脚") && text.includes(`第 ${toRoman(index + 3)} 页 / 共 ${result.pageCount} 页`)));
  assert.deepEqual(result.oddFooterStyle, { fontFamily: 'Arial, sans-serif', fontSize: "14px", color: "rgb(31, 78, 121)", fontStyle: "italic", textAlign: "right" });
  assert.equal(maxConcurrentSaveRequestCount, 1);

  const desktopNavigation = await page.evaluate(() => {
    const scroll = document.querySelector(".editor-scroll");
    if (scroll) scroll.scrollTop = scroll.scrollHeight;
    const visible = (selector) => {
      const rect = document.querySelector(selector)?.getBoundingClientRect();
      return Boolean(rect && rect.bottom > 0 && rect.top < window.innerHeight);
    };
    return {
      documentScrollTop: window.scrollY,
      editorAtBottom: Boolean(scroll && scroll.scrollTop > 0),
      mainNavigationVisible: visible(".sidebar"),
      outlineVisible: visible(".outline-panel"),
      assistantVisible: visible(".ai-panel")
    };
  });
  // 中文注解：长文档只滚动纸张区域，主导航、大纲和 AI 助手不能随正文滚出视口。
  assert.equal(desktopNavigation.documentScrollTop, 0);
  assert.equal(desktopNavigation.editorAtBottom, true);
  assert.equal(desktopNavigation.mainNavigationVisible, true);
  assert.equal(desktopNavigation.outlineVisible, true);
  assert.equal(desktopNavigation.assistantVisible, true);

  // 中文注解：模拟历史分节节点。旧节点显式关闭页码时，不能继承前一节已经迁移出的新页码模板。
  const legacySectionLayout = { ...storedSectionLayout, pageNumberEnabled: false, pageNumberPosition: "footer" };
  delete legacySectionLayout.headerPageNumberTemplate;
  delete legacySectionLayout.footerPageNumberTemplate;
  const encodedLegacyLayout = JSON.stringify(legacySectionLayout).replaceAll("&", "&amp;").replaceAll('"', "&quot;");
  storedDocument.content = storedDocument.content.replace(/data-section-layout="[^"]+"/, `data-section-layout="${encodedLegacyLayout}"`);
  await page.reload({ waitUntil: "networkidle" });
  await page.getByText(storedDocument.title, { exact: true }).click();
  await editor.waitFor();
  await page.getByRole("button", { name: "分页", exact: true }).click();
  await page.locator(".page-sheet").first().waitFor();
  const legacySectionPreview = await page.evaluate(() => {
    const pages = Array.from(document.querySelectorAll(".page-sheet"));
    const secondSectionFirstPage = pages.findIndex((page) => page.getAttribute("data-section-index") === "1");
    return {
      secondSectionFirstPage,
      firstSectionFooters: Array.from(document.querySelectorAll(".page-footer")).slice(0, secondSectionFirstPage).map((node) => node.textContent || ""),
      secondSectionFooters: Array.from(document.querySelectorAll(".page-footer")).slice(secondSectionFirstPage).map((node) => node.textContent || "")
    };
  });
  assert.ok(legacySectionPreview.secondSectionFirstPage > 0);
  assert.ok(legacySectionPreview.firstSectionFooters.some((text) => text.includes("第 ")));
  assert.ok(
    legacySectionPreview.secondSectionFooters.every((text) => text.includes("第二节横向页脚") && !text.includes("第 ")),
    `历史分节关闭页码后的第二节页脚异常：${JSON.stringify(legacySectionPreview.secondSectionFooters)}`
  );

  await page.setViewportSize({ width: 390, height: 844 });
  const mobile = await page.evaluate(() => {
    const scroll = document.querySelector(".editor-scroll");
    return { viewportWidth: document.documentElement.clientWidth, scrollClientWidth: scroll?.clientWidth || 0, scrollWidth: scroll?.scrollWidth || 0 };
  });
  assert.equal(mobile.viewportWidth, 390);
  assert.ok(mobile.scrollClientWidth <= 390);
  assert.ok(mobile.scrollWidth > mobile.scrollClientWidth);
  await page.getByText("页面设置", { exact: true }).click();
  const mobilePageSettings = await page.locator(".page-layout-popover").boundingBox();
  assert.ok(mobilePageSettings && mobilePageSettings.x >= 0 && mobilePageSettings.y >= 0);
  assert.ok(mobilePageSettings.x + mobilePageSettings.width <= 390 && mobilePageSettings.y + mobilePageSettings.height <= 844);
  await page.getByLabel("关闭页面设置", { exact: true }).click();
  assert.equal(await page.locator(".page-layout-popover").isVisible(), false);
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await editor.locator("td").first().click();
  const sectionCountBeforeNestedInsert = await editor.locator(":scope > .section-break-marker").count();
  await page.getByRole("button", { name: "分节符", exact: true }).click();
  // 中文注解：从表格单元格插入时也必须提升为正文顶层节点，否则预览和导出都无法拆节。
  assert.equal(await editor.locator(":scope > .section-break-marker").count(), sectionCountBeforeNestedInsert + 1);
  assert.equal(await editor.locator("table .section-break-marker, li .section-break-marker").count(), 0);
  assert.deepEqual(browserErrors, []);

  console.log("Editor workflow browser check passed");
} finally {
  await browser.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}
