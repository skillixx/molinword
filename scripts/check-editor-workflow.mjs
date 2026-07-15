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
const tinyPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lT3g6wAAAABJRU5ErkJggg==";
const fixtureDocument = {
  id: 9001,
  title: "编辑器超长结构分页回归",
  documentType: "工作总结",
  tone: "正式",
  templateId: 3,
  outline: ["超长结构分页"],
  content: `<p><span style="font-size: 12pt; color: #ff0000">保留小号红字</span><span style="font-size: 18pt; color: #0000ff">保留大号蓝字</span></p><ol><li>${listText}</li><li>第二个编号项，用于确认编号连续。</li></ol><table><tbody><tr><th>说明</th><th>标准</th></tr><tr><td><img src="${tinyPng}" style="width:32px;height:32px" /><p>${cellA}</p></td><td><p>${cellB}</p></td></tr><tr><td><p>下一行</p></td><td><p>保持结构</p></td></tr></tbody></table>`,
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
  if (request.method === "POST" && url.pathname === `/api/documents/${fixtureDocument.id}/export-docx`) {
    const body = await readJsonBody(request);
    const content = typeof body.content === "string" ? body.content : storedDocument.content;
    exportedDocxBuffer = await createDocxBuffer({ title: storedDocument.title, content, templateStyle: fixtureWordStyle, pageLayout: storedDocument.pageLayout });
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

  await page.getByText("页面设置", { exact: true }).click();
  await page.getByLabel("页眉文字", { exact: true }).fill("西部教育资源云平台项目");
  await page.getByLabel("页脚文字", { exact: true }).fill("内部办公文档");
  await page.getByLabel("显示页码", { exact: true }).check();
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
  assert.deepEqual(storedDocument.pageLayout, { headerText: "西部教育资源云平台项目", footerText: "内部办公文档", pageNumberEnabled: true });

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

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 Word", exact: true }).click();
  const download = await downloadPromise;
  await page.waitForFunction(() => document.body.textContent?.includes("Word 已生成"));
  const downloadedPath = await download.path();
  assert.ok(downloadedPath, "导出的 DOCX 应可下载");
  const downloadedBuffer = await readFile(downloadedPath);
  const archive = await JSZip.loadAsync(downloadedBuffer);
  const documentXml = await archive.file("word/document.xml")?.async("string");
  const headerXml = await archive.file("word/header1.xml")?.async("string");
  const footerXml = await archive.file("word/footer1.xml")?.async("string");
  assert.ok(documentXml, "导出的 DOCX 应包含 document.xml");
  assert.ok(headerXml && footerXml, "导出的 DOCX 应包含页眉和页脚部件");
  assert.match(headerXml, /西部教育资源云平台项目/);
  assert.match(footerXml, /内部办公文档/);
  assert.match(footerXml, /<w:instrText[^>]*>PAGE<\/w:instrText>/);
  assert.match(footerXml, /<w:instrText[^>]*>NUMPAGES<\/w:instrText>/);
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
    const previewLongRows = Array.from(document.querySelectorAll(".page-body table tr")).filter((row) => {
      const text = row.textContent || "";
      return !text.includes("说明标准") && !text.includes("下一行保持结构");
    });
    return {
      pageCount: pages.length,
      overflowPages: pages.map((page, index) => {
        const body = page.querySelector(".page-body");
        return body && body.scrollHeight > 931 ? index + 1 : null;
      }).filter(Boolean),
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
      templateLabelVisible: document.body.textContent?.includes("模板样式：商业计划书") || false,
      fontVariable: getComputedStyle(document.querySelector(".editor-scroll")).getPropertyValue("--document-font-family").trim(),
      lineVariable: getComputedStyle(document.querySelector(".editor-scroll")).getPropertyValue("--document-line-height").trim(),
      headerTexts: Array.from(document.querySelectorAll(".page-header")).map((item) => item.textContent || ""),
      footerTexts: Array.from(document.querySelectorAll(".page-footer")).map((item) => item.textContent || "")
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
  assert.equal(result.templateLabelVisible, true);
  assert.equal(result.fontVariable, '"SimSun"');
  assert.equal(result.lineVariable, "1.5833");
  assert.equal(result.headerTexts.length, result.pageCount);
  assert.ok(result.headerTexts.every((text) => text === "西部教育资源云平台项目"));
  assert.equal(result.footerTexts.length, result.pageCount);
  assert.ok(result.footerTexts.every((text, index) => text.includes("内部办公文档") && text.includes(`第 ${index + 1} 页 / 共 ${result.pageCount} 页`)));
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

  await page.setViewportSize({ width: 390, height: 844 });
  const mobile = await page.evaluate(() => {
    const scroll = document.querySelector(".editor-scroll");
    return { viewportWidth: document.documentElement.clientWidth, scrollClientWidth: scroll?.clientWidth || 0, scrollWidth: scroll?.scrollWidth || 0 };
  });
  assert.equal(mobile.viewportWidth, 390);
  assert.ok(mobile.scrollClientWidth <= 390);
  assert.ok(mobile.scrollWidth > mobile.scrollClientWidth);
  assert.deepEqual(browserErrors, []);

  console.log("Editor workflow browser check passed");
} finally {
  await browser.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}
