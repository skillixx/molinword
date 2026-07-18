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
const floatingBodyImage = {
  horizontal: { relative: "column", align: "right", offset: null },
  vertical: { relative: "paragraph", align: null, offset: 0 },
  wrap: { type: "square", side: "bothSides" },
  margins: { top: 0, right: 95250, bottom: 95250, left: 190500 },
  allowOverlap: true,
  behindDocument: false,
  lockAnchor: false,
  layoutInCell: true,
  zIndex: 5
};
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
  content: `<p><span style="font-size: 12pt; color: #ff0000">保留小号红字</span><span style="font-size: 18pt; color: #0000ff">保留大号蓝字</span></p><p>突出显示工具 上标工具 下标工具 字符间距工具 下划线样式工具 双删除线工具 字符边框工具 all Caps Format small Caps Format <mark data-highlight="yellow" style="background-color:#FFFF00">清除高亮工具</mark></p><p>悬挂缩进工具内容用于验证后续各行向右缩进并保持首行位置。</p><p>段落左右缩进工具内容用于验证正文可用行宽和分页位置。</p><p>RTL段落工具内容</p><p>特殊连字符工具</p><p>手动换行工具</p><p>大纲级别工具</p><ol><li>${listText}</li><li>第二个编号项，用于确认编号连续。</li></ol><table><tbody><tr><th>说明</th><th>标准</th></tr><tr><td><img src="${tinyPng}" style="width:32px;height:32px" /><p>${cellA}</p></td><td><p>${cellB}</p></td></tr><tr><td><p>下一行</p></td><td><p>保持结构</p></td></tr></tbody></table><table data-table-width-type="dxa" data-table-width-value="7200" data-table-grid-width="7200" data-table-layout="fixed" style="width:480px;table-layout:fixed"><tbody><tr><th colwidth="120">审批阶段</th><th colwidth="360">状态</th></tr><tr><td colwidth="120">商务评审</td><td colwidth="360">通过</td></tr><tr><td colwidth="120">归档确认</td><td colwidth="360">完成</td></tr></tbody></table><p>段落外观工具</p><p>分页控制前置段落</p><p>分页控制段落</p><p>分页控制后续段落</p><p data-tab-stops='[{"alignment":"left","position":1440},{"alignment":"right","position":5760}]'>Tab workflow<span class="docx-tab" data-docx-tab="true" data-tab-position="1440" data-tab-alignment="left"></span>Amount<span class="docx-tab" data-docx-tab="true" data-tab-position="5760" data-tab-alignment="right"></span>100.00</p><p>Tab keyboard</p><p>${widowText}</p>`,
  // 中文注解：模拟升级前数据库里的旧页面设置，确保真实历史文档开启高级页眉时不会崩溃。
  pageLayout: { headerText: "", footerText: "", pageNumberEnabled: false },
  status: "draft",
  wordCount: listText.length + cellA.length + cellB.length,
  updatedAt: new Date().toISOString()
};
// 中文注解：复用现有编辑器回归文档，同时加入链接和浮动图片，覆盖保存、分页与导出的真实节点持久化。
fixtureDocument.content = `<img src="${tinyPng}" alt="浮动审批标识" style="width:48px;height:48px" data-docx-floating='${JSON.stringify(floatingBodyImage)}' data-docx-wrap="square" data-docx-float-align="right" />${fixtureDocument.content.replace("下标工具", "下标工具 链接工具")}`;
fixtureDocument.content += "<p>脚注工具</p><p>尾注工具</p><p>批注工具</p><p>新增修订工具 删除修订工具 接受新增工具 拒绝删除工具</p>";
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
const generatedBodyHtml = '<h2 data-outline-level="1" data-keep-next="true" data-keep-lines="true" data-widow-control="true" style="margin-top:12pt;margin-bottom:6pt;line-height:1.3"><span style="color:#000000;font-weight:bold;font-family:Microsoft YaHei;font-size:16pt">AI 自动格式标题</span></h2><p data-indent="1" data-widow-control="true" style="line-height:1.5;text-align:justify;margin-top:0pt;margin-bottom:6pt"><span style="color:#000000;font-weight:600;font-family:Microsoft YaHei;font-size:11pt">AI 自动生成的正文段落。</span></p>';
let storedDocument = structuredClone(fixtureDocument);
let exportedDocxBuffer = null;
let manualSaveRequestCount = 0;
let activeSaveRequestCount = 0;
let maxConcurrentSaveRequestCount = 0;
let documentUpdatesFrozen = false;
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
    if (documentUpdatesFrozen) {
      // 中文注解：历史数据迁移场景会冻结测试存储，避免页面卸载前的自动保存覆盖手工注入的旧节点。
      sendJson(response, { document: storedDocument });
      return true;
    }
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
  if (request.method === "POST" && url.pathname === "/api/ai/generate-body") {
    const body = await readJsonBody(request);
    assert.equal(body.documentId, fixtureDocument.id);
    sendJson(response, { content: "AI 自动格式标题\nAI 自动生成的正文段落。", contentHtml: generatedBodyHtml });
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
  const formatBarGeometry = await page.locator(".format-bar").evaluate((bar) => ({
    height: bar.getBoundingClientRect().height,
    clientWidth: bar.clientWidth,
    scrollWidth: bar.scrollWidth,
    flexWrap: getComputedStyle(bar).flexWrap
  }));
  // 中文注解：WPS 风格功能区通过标签和分组消除横向滚动，窄内容区允许组内自动换行。
  assert.ok(formatBarGeometry.height <= 480, `功能区高度不应失控，实际为 ${formatBarGeometry.height}px`);
  assert.equal(formatBarGeometry.scrollWidth, formatBarGeometry.clientWidth, "功能区不应产生横向滚动");
  assert.deepEqual(await page.getByRole("tab").allTextContents(), ["开始", "格式", "插入", "布局", "审阅", "文档"]);
  assert.equal(await page.getByRole("tab", { name: "开始" }).getAttribute("aria-selected"), "true");
  for (const ribbonTab of ["开始", "格式", "插入", "布局", "审阅", "文档"]) {
    await page.getByRole("tab", { name: ribbonTab }).click();
    const geometry = await page.locator(".format-bar").evaluate((bar) => ({ height: bar.getBoundingClientRect().height, clientWidth: bar.clientWidth, scrollWidth: bar.scrollWidth }));
    assert.equal(geometry.scrollWidth, geometry.clientWidth, `${ribbonTab}功能区不应产生横向滚动`);
    assert.ok(geometry.height <= 340, `${ribbonTab}功能区高度不应挤压正文，实际为 ${geometry.height}px`);
  }
  assert.equal(await page.getByText("选择表格后显示编辑工具", { exact: true }).count(), 0, "离开插入页签后不应残留表格上下文提示");
  await page.getByRole("tab", { name: "开始" }).click();
  await editor.click();
  await editor.press("Control+A");
  await page.getByRole("tab", { name: "格式" }).click();
  await page.getByLabel("字体", { exact: true }).selectOption("SimSun");
  await page.getByRole("tab", { name: "开始" }).click();
  await page.getByTitle("斜体", { exact: true }).click();
  await page.getByRole("tab", { name: "格式" }).click();
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
  const placeEditorCursorAtTextEnd = async (target) => {
    await page.evaluate((text) => {
      const root = document.querySelector(".word-editor");
      const paragraph = Array.from(root?.querySelectorAll("p") || []).find((item) => item.textContent?.includes(text));
      if (!root || !paragraph) throw new Error(`找不到编辑器段落：${text}`);
      const range = document.createRange();
      range.selectNodeContents(paragraph);
      range.collapse(false);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      root.focus();
      // 中文注解：切换功能区后显式同步段尾光标，避免工具按钮沿用切换前的旧选区。
      document.dispatchEvent(new Event("selectionchange", { bubbles: true }));
    }, target);
    await page.waitForTimeout(50);
  };
  const formattedHtml = await editor.innerHTML();
  const floatingEditorImage = editor.locator('img[alt="浮动审批标识"]');
  assert.equal(await floatingEditorImage.getAttribute("data-docx-wrap"), "square");
  assert.equal(await floatingEditorImage.getAttribute("data-docx-float-align"), "right");
  assert.equal(await floatingEditorImage.evaluate((image) => getComputedStyle(image).float), "right");
  assert.match(formattedHtml, /font-family:\s*SimSun/);
  assert.match(formattedHtml, /font-size:\s*12pt/);
  assert.match(formattedHtml, /font-size:\s*18pt/);
  assert.match(formattedHtml, /color:\s*(?:#ff0000|rgb\(255, 0, 0\))/);
  assert.match(formattedHtml, /color:\s*(?:#0000ff|rgb\(0, 0, 255\))/);
  assert.match(formattedHtml, /<em>/);
  assert.match(formattedHtml, /<s>/);
  await page.getByRole("tab", { name: "开始" }).click();
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  assert.doesNotMatch(await editor.innerHTML(), /<s>/);
  await page.getByRole("button", { name: "重做", exact: true }).click();
  assert.match(await editor.innerHTML(), /<s>/);

  // 中文注解：真实选择三个独立文本并点击工具栏，证明高级字符格式可编辑，而不只是被动展示导入结果。
  await page.getByRole("tab", { name: "格式" }).click();
  await selectEditorText("突出显示工具");
  await page.getByRole("button", { name: "黄色突出显示", exact: true }).click();
  await selectEditorText("突出显示工具");
  await page.getByLabel("突出显示", { exact: true }).selectOption("darkCyan");
  await selectEditorText("清除高亮工具");
  await page.getByLabel("突出显示", { exact: true }).selectOption("none");
  await selectEditorText("上标工具");
  await page.getByRole("button", { name: "上标", exact: true }).click();
  await selectEditorText("下标工具");
  await page.getByRole("button", { name: "下标", exact: true }).click();
  await selectEditorText("字符间距工具");
  await page.getByLabel("字符间距", { exact: true }).selectOption("2pt");
  await page.getByLabel("文字位置", { exact: true }).selectOption("3pt");
  await page.getByRole("tab", { name: "开始" }).click();
  await selectEditorText("下划线样式工具");
  await page.getByLabel("下划线样式", { exact: true }).selectOption("double");
  await page.getByRole("tab", { name: "格式" }).click();
  await selectEditorText("双删除线工具");
  await page.getByLabel("删除线样式", { exact: true }).selectOption("double");
  await page.getByRole("tab", { name: "开始" }).click();
  await selectEditorText("字符边框工具");
  await page.getByLabel("字符边框", { exact: true }).selectOption("dashed");
  await page.getByRole("tab", { name: "布局" }).click();
  await selectEditorText("悬挂缩进工具");
  await page.getByLabel("悬挂缩进", { exact: true }).selectOption("28.35pt");
  await selectEditorText("段落左右缩进工具");
  await page.getByLabel("左缩进", { exact: true }).selectOption("28.35pt");
  await page.getByLabel("右缩进", { exact: true }).selectOption("14.17pt");
  await page.getByRole("tab", { name: "开始" }).click();
  await selectEditorText("第二个编号项");
  await page.getByLabel("编号格式", { exact: true }).selectOption("upperRoman");
  await page.getByLabel("编号起始值", { exact: true }).fill("4");
  await selectEditorText("大纲级别工具");
  await page.locator('label[title="设置当前段落的大纲级别"] select').selectOption("4");
  await page.getByRole("tab", { name: "格式" }).click();
  await selectEditorText("all Caps Format");
  await page.getByLabel("字母格式", { exact: true }).selectOption("uppercase");
  await selectEditorText("small Caps Format");
  await page.getByLabel("字母格式", { exact: true }).selectOption("small-caps");
  const advancedFormatHtml = await editor.innerHTML();
  assert.match(advancedFormatHtml, /<mark[^>]+data-highlight="darkCyan"[^>]*>突出显示工具<\/mark>/);
  assert.doesNotMatch(advancedFormatHtml, /<mark[^>]*>清除高亮工具<\/mark>/);
  assert.ok(advancedFormatHtml.includes("清除高亮工具"));
  assert.match(advancedFormatHtml, /<sup>上标工具<\/sup>/);
  assert.match(advancedFormatHtml, /<sub>下标工具<\/sub>/);
  assert.match(advancedFormatHtml, /<span[^>]+style="[^"]*letter-spacing:\s*2pt[^"]*vertical-align:\s*3pt[^"]*"[^>]*>字符间距工具<\/span>/);
  assert.match(advancedFormatHtml, /<span[^>]+style="[^"]*text-decoration-line:\s*underline[^"]*text-decoration-style:\s*double[^"]*--word-underline-type:\s*double[^"]*"[^>]*>下划线样式工具<\/span>/);
  assert.match(advancedFormatHtml, /<span[^>]+data-double-strike="true"[^>]+style="[^"]*text-decoration-line:\s*line-through[^"]*text-decoration-style:\s*double[^"]*"[^>]*>[\s\S]*?双删除线工具[\s\S]*?<\/span>/);
  // 中文注解：浏览器会把四边样式规范化为 border-width/style/color 简写，因此只校验语义和值，不依赖序列化形式。
  const textBorderHtml = advancedFormatHtml.match(/<span[^>]+style="([^"]*--word-text-border:\s*dashed,8,1F4E79,1[^"]*)"[^>]*>字符边框工具<\/span>/i)?.[1] || "";
  assert.match(textBorderHtml, /border-(?:top|width):\s*1\.33px/i);
  assert.match(textBorderHtml, /border-(?:top|style):\s*dashed/i);
  assert.match(textBorderHtml, /border-(?:top|color):\s*(?:#1F4E79|rgb\(31, 78, 121\))/i);
  assert.match(textBorderHtml, /padding(?:-top)?:\s*1\.33px/i);
  assert.match(advancedFormatHtml, /<p[^>]+style="[^"]*margin-left:\s*28\.35pt[^"]*text-indent:\s*-28\.35pt[^"]*"[^>]*>[\s\S]*?悬挂缩进工具内容[\s\S]*?<\/p>/);
  assert.match(advancedFormatHtml, /<p[^>]+style="[^"]*margin-left:\s*28\.35pt[^"]*margin-right:\s*14\.17pt[^"]*"[^>]*>[\s\S]*?段落左右缩进工具内容[\s\S]*?<\/p>/);
  assert.match(advancedFormatHtml, /<ol(?=[^>]*start="4")(?=[^>]*data-list-format="upperRoman")(?=[^>]*style="[^"]*list-style-type:\s*upper-roman)[^>]*>/);
  assert.match(advancedFormatHtml, /<h4[^>]+data-outline-level="3"[^>]*>[\s\S]*?大纲级别工具[\s\S]*?<\/h4>/);
  assert.match(advancedFormatHtml, /<span[^>]+style="[^"]*text-transform:\s*uppercase[^"]*"[^>]*>all Caps Format<\/span>/);
  assert.match(advancedFormatHtml, /<span[^>]+style="[^"]*font-variant-caps:\s*small-caps[^"]*"[^>]*>small Caps Format<\/span>/);
  await page.getByRole("tab", { name: "开始" }).click();
  await selectEditorText("链接工具");
  await page.getByRole("button", { name: "设置超链接", exact: true }).click();
  await page.getByLabel("超链接地址", { exact: true }).fill("https://example.com/office");
  await page.getByRole("button", { name: "确认超链接", exact: true }).click();
  const editorLink = editor.locator('a[href="https://example.com/office"]');
  assert.equal(await editorLink.textContent(), "链接工具");
  assert.equal(await editorLink.getAttribute("target"), "_blank");
  assert.equal(await editorLink.getAttribute("rel"), "noopener noreferrer");
  const tabKeyboardParagraph = editor.locator("p").filter({ hasText: "Tab keyboard" });
  await tabKeyboardParagraph.evaluate((paragraph) => {
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    (paragraph.closest(".word-editor"))?.focus();
    // 中文注解：显式通知 ProseMirror 同步浏览器光标，避免工具栏操作沿用上一段的文字选区。
    document.dispatchEvent(new Event("selectionchange", { bubbles: true }));
  });
  await page.waitForTimeout(50);
  await page.keyboard.press("Tab");
  await page.keyboard.type("Keyboard aligned");
  await page.locator('button[title="插入制表符"]').click();
  await page.keyboard.type("Toolbar aligned");
  assert.equal(await editor.locator('.docx-tab[data-docx-tab="true"]').count(), 4);
  const editorTabWidths = await editor.locator(".docx-tab").evaluateAll((tabs) => tabs.map((tab) => tab.getBoundingClientRect().width));
  assert.ok(editorTabWidths.every((width) => width >= 2), "编辑器中的制表位应获得稳定可见宽度");
  await page.getByRole("tab", { name: "布局" }).click();
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
  const rtlParagraph = editor.locator("p").filter({ hasText: "RTL段落工具内容" });
  await rtlParagraph.click();
  await page.getByRole("button", { name: "从右到左", exact: true }).click();
  assert.equal(await rtlParagraph.getAttribute("data-bidirectional"), "true");
  assert.equal(await rtlParagraph.evaluate((paragraph) => getComputedStyle(paragraph).direction), "rtl");
  await page.getByRole("tab", { name: "格式" }).click();
  const specialHyphenParagraph = editor.locator("p").filter({ hasText: "特殊连字符工具" });
  await specialHyphenParagraph.click();
  await specialHyphenParagraph.press("End");
  await editor.type(" inter");
  await page.getByLabel("特殊连字符", { exact: true }).selectOption("soft");
  await editor.type("national code");
  await page.getByLabel("特殊连字符", { exact: true }).selectOption("nonbreaking");
  await editor.type("2026");
  assert.equal(await specialHyphenParagraph.textContent(), "特殊连字符工具 inter\u00ADnational code\u20112026");

  const manualLineBreakParagraph = editor.locator("p").filter({ hasText: "手动换行工具" });
  await manualLineBreakParagraph.click();
  await manualLineBreakParagraph.press("End");
  await editor.type(" 第一行");
  await page.keyboard.press("Shift+Enter");
  await editor.type("第二行");
  assert.match(await manualLineBreakParagraph.innerHTML(), /第一行[\s\S]*?<br[^>]*>[\s\S]*?第二行/);

  await page.getByRole("tab", { name: "审阅" }).click();
  const footnoteParagraph = editor.locator("p").filter({ hasText: "脚注工具" });
  await placeEditorCursorAtTextEnd("脚注工具");
  await page.getByRole("button", { name: "插入或编辑脚注", exact: true }).click();
  await page.getByLabel("脚注内容", { exact: true }).fill("审批依据说明");
  await page.getByRole("button", { name: "确认脚注", exact: true }).click();
  const sourceFootnoteReference = editor.locator('.footnote-reference[data-footnote-id="1"]');
  await sourceFootnoteReference.waitFor();
  assert.equal(await sourceFootnoteReference.getAttribute("data-footnote-text"), "审批依据说明");
  assert.match(await sourceFootnoteReference.locator("xpath=ancestor::p[1]").textContent() || "", /脚注工具/);

  const endnoteParagraph = editor.locator("p").filter({ hasText: "尾注工具" });
  await placeEditorCursorAtTextEnd("尾注工具");
  await page.getByRole("button", { name: "插入或编辑尾注", exact: true }).click();
  await page.getByLabel("尾注内容", { exact: true }).fill("文末法规来源");
  await page.getByRole("button", { name: "确认尾注", exact: true }).click();
  const sourceEndnoteReference = editor.locator('.endnote-reference[data-endnote-id="1"]');
  await sourceEndnoteReference.waitFor();
  assert.equal(await sourceEndnoteReference.getAttribute("data-endnote-text"), "文末法规来源");
  assert.match(await sourceEndnoteReference.locator("xpath=ancestor::p[1]").textContent() || "", /尾注工具/);

  await selectEditorText("批注工具");
  await page.getByRole("button", { name: "添加或编辑批注", exact: true }).click();
  await page.getByLabel("批注内容", { exact: true }).fill("请补充审批依据");
  await page.getByRole("button", { name: "确认批注", exact: true }).click();
  const sourceCommentMark = editor.locator('.comment-mark[data-comment-id="1"]');
  await sourceCommentMark.waitFor();
  assert.equal(await sourceCommentMark.getAttribute("data-comment-text"), "请补充审批依据");
  assert.equal(await sourceCommentMark.getAttribute("data-comment-author"), "在线审阅者");
  const commentListItem = page.locator(".document-comment").filter({ hasText: "请补充审批依据" });
  await commentListItem.waitFor();
  await commentListItem.click();
  assert.equal(await page.evaluate(() => window.getSelection()?.toString() || ""), "批注工具");

  await selectEditorText("新增修订工具");
  await page.getByRole("button", { name: "标记新增修订", exact: true }).click();
  const sourceInsertRevision = editor.locator('.revision-insert[data-revision-id="1"]');
  await sourceInsertRevision.waitFor();
  assert.equal(await sourceInsertRevision.textContent(), "新增修订工具");
  assert.equal(await sourceInsertRevision.getAttribute("data-revision-author"), "在线审阅者");

  await selectEditorText("删除修订工具");
  await page.getByRole("button", { name: "标记删除修订", exact: true }).click();
  const sourceDeleteRevision = editor.locator('.revision-delete[data-revision-id="2"]');
  await sourceDeleteRevision.waitFor();
  assert.equal(await sourceDeleteRevision.textContent(), "删除修订工具");

  await selectEditorText("接受新增工具");
  await page.getByRole("button", { name: "标记新增修订", exact: true }).click();
  const acceptedRevisionItem = page.locator(".document-revision").filter({ hasText: "接受新增工具" });
  await acceptedRevisionItem.getByRole("button", { name: /^接受修订 / }).click();
  assert.equal(await editor.locator("p").filter({ hasText: "接受新增工具" }).count(), 1);
  assert.equal(await editor.locator('.revision-insert').filter({ hasText: "接受新增工具" }).count(), 0);

  await selectEditorText("拒绝删除工具");
  await page.getByRole("button", { name: "标记删除修订", exact: true }).click();
  const rejectedRevisionItem = page.locator(".document-revision").filter({ hasText: "拒绝删除工具" });
  await rejectedRevisionItem.getByRole("button", { name: /^拒绝修订 / }).click();
  assert.equal(await editor.locator("p").filter({ hasText: "拒绝删除工具" }).count(), 1);
  assert.equal(await editor.locator('.revision-delete').filter({ hasText: "拒绝删除工具" }).count(), 0);

  await page.getByRole("tab", { name: "布局" }).click();
  const paragraphAppearance = editor.locator("p").filter({ hasText: "段落外观工具" });
  await paragraphAppearance.click();
  // 中文注解：先让 ProseMirror 完成点击选区同步，再打开原生下拉框，模拟真实连续操作并消除事件循环竞态。
  await page.waitForTimeout(50);
  await page.locator('label[title="设置当前段落或选区的底纹"] select').selectOption("#DDEBF7");
  await page.waitForFunction(() => Array.from(document.querySelectorAll(".word-editor p")).find((paragraph) => paragraph.textContent?.includes("段落外观工具"))?.getAttribute("data-paragraph-shading")?.includes("DDEBF7"));
  await page.locator('label[title="设置当前段落或选区的边框"] select').selectOption("dashed");
  await page.waitForFunction(() => Array.from(document.querySelectorAll(".word-editor p")).find((paragraph) => paragraph.textContent?.includes("段落外观工具"))?.getAttribute("data-paragraph-borders")?.includes("dashed"));
  const sourceParagraphAppearance = await paragraphAppearance.evaluate((paragraph) => {
    const style = getComputedStyle(paragraph);
    return {
      shading: paragraph.getAttribute("data-paragraph-shading"),
      borders: paragraph.getAttribute("data-paragraph-borders"),
      backgroundColor: style.backgroundColor,
      borderTopStyle: style.borderTopStyle,
      borderTopWidth: style.borderTopWidth,
      borderTopColor: style.borderTopColor,
      paddingTop: style.paddingTop
    };
  });
  assert.deepEqual(JSON.parse(sourceParagraphAppearance.shading || "{}"), { fill: "#DDEBF7", color: "#000000", type: "clear" });
  assert.deepEqual(JSON.parse(sourceParagraphAppearance.borders || "{}"), Object.fromEntries(["top", "right", "bottom", "left"].map((side) => [side, { style: "dashed", size: 6, color: "#6B7280", space: 3 }])));
  assert.deepEqual({ ...sourceParagraphAppearance, shading: undefined, borders: undefined }, {
    shading: undefined,
    borders: undefined,
    backgroundColor: "rgb(221, 235, 247)",
    borderTopStyle: "dashed",
    borderTopWidth: "1px",
    borderTopColor: "rgb(107, 114, 128)",
    paddingTop: "4px"
  });

  await page.getByRole("tab", { name: "插入" }).click();
  const sourceTables = editor.locator("table");
  assert.equal(await sourceTables.count(), 2);
  const sourceGeometry = await sourceTables.last().evaluate((table) => ({
    width: Math.round(table.getBoundingClientRect().width),
    columns: Array.from(table.querySelectorAll("tr:first-child > th, tr:first-child > td")).map((cell) => Math.round(cell.getBoundingClientRect().width))
  }));
  assert.ok(sourceGeometry.width >= 480 && sourceGeometry.width <= 481);
  assert.deepEqual(sourceGeometry.columns, [120, 360]);
  const businessReviewCell = sourceTables.last().locator("td").filter({ hasText: "商务评审" });
  await businessReviewCell.click();
  await page.waitForTimeout(50);
  await page.locator('label[title="设置当前单元格垂直对齐"] select').selectOption("bottom");
  assert.equal(await businessReviewCell.getAttribute("data-cell-vertical-align"), "bottom");
  await page.locator('label[title="设置当前单元格文字方向"] select').selectOption("btLr");
  assert.equal(await businessReviewCell.getAttribute("data-cell-text-direction"), "btLr");
  await page.locator('label[title="设置当前单元格内边距"] select').selectOption("180");
  assert.equal(await businessReviewCell.getAttribute("data-cell-vertical-align"), "bottom");
  await page.locator('label[title="设置当前单元格底色"] select').selectOption("#FFF2CC");
  await page.locator('label[title="设置当前单元格边框"] select').selectOption("dashed");
  const sourceCellFormat = await businessReviewCell.evaluate((cell) => ({
    margins: cell.getAttribute("data-cell-margins"),
    verticalAlign: cell.getAttribute("data-cell-vertical-align"),
    textDirection: cell.getAttribute("data-cell-text-direction"),
    shading: cell.getAttribute("data-cell-shading"),
    borders: cell.getAttribute("data-cell-borders"),
    style: {
      paddingTop: getComputedStyle(cell).paddingTop,
      paddingRight: getComputedStyle(cell).paddingRight,
      paddingBottom: getComputedStyle(cell).paddingBottom,
      paddingLeft: getComputedStyle(cell).paddingLeft,
      verticalAlign: getComputedStyle(cell).verticalAlign,
      writingMode: getComputedStyle(cell).writingMode,
      backgroundColor: getComputedStyle(cell).backgroundColor,
      borderTopStyle: getComputedStyle(cell).borderTopStyle,
      borderTopWidth: getComputedStyle(cell).borderTopWidth,
      borderTopColor: getComputedStyle(cell).borderTopColor
    }
  }));
  // 中文注解：单元格语义属性负责 Word 导出，计算样式负责在线编辑和分页，两套结果必须同步。
  assert.deepEqual(JSON.parse(sourceCellFormat.margins || "{}"), { top: 180, right: 180, bottom: 180, left: 180 });
  assert.equal(sourceCellFormat.verticalAlign, "bottom");
  assert.equal(sourceCellFormat.textDirection, "btLr");
  assert.equal(sourceCellFormat.shading, "#FFF2CC");
  assert.deepEqual(JSON.parse(sourceCellFormat.borders || "{}"), Object.fromEntries(["top", "right", "bottom", "left"].map((side) => [side, { style: "dashed", size: 6, color: "#6B7280" }])));
  assert.deepEqual(sourceCellFormat.style, {
    paddingTop: "12px",
    paddingRight: "12px",
    paddingBottom: "12px",
    paddingLeft: "12px",
    verticalAlign: "bottom",
    writingMode: "sideways-lr",
    backgroundColor: "rgb(255, 242, 204)",
    borderTopStyle: "dashed",
    borderTopWidth: "1px",
    borderTopColor: "rgb(107, 114, 128)"
  });
  const firstTable = sourceTables.first();
  const headerCells = firstTable.locator("th");
  assert.equal(await headerCells.count(), 2);
  await headerCells.first().click();
  await page.waitForTimeout(50);
  await page.locator('label[title="设置当前表格行高度"] select').selectOption("850");
  await page.locator('label[title="设置当前表格行高度规则"] select').selectOption("exact");
  await page.getByRole("button", { name: "整行同页", exact: true }).click();
  await page.getByRole("button", { name: "重复标题", exact: true }).click();
  const sourceHeaderRow = firstTable.locator("tr").first();
  assert.deepEqual(await sourceHeaderRow.evaluate((row) => ({
    height: row.getAttribute("data-row-height"),
    rule: row.getAttribute("data-row-height-rule"),
    cantSplit: row.getAttribute("data-row-cant-split"),
    repeatHeader: row.getAttribute("data-row-repeat-header"),
    cssHeight: row.style.height
  })), { height: "850", rule: "exact", cantSplit: "true", repeatHeader: "true", cssHeight: "56.67px" });
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
  await page.locator('label[title="设置当前表格对齐方式"] select').selectOption("right");
  assert.deepEqual(await sourceTables.last().evaluate((table) => ({
    alignment: table.getAttribute("data-table-alignment"),
    marginLeft: table.style.marginLeft,
    marginRight: table.style.marginRight
  })), { alignment: "right", marginLeft: "auto", marginRight: "0px" });
  await page.locator('label[title="设置当前表格左缩进"] select').selectOption("567");
  assert.deepEqual(await sourceTables.last().evaluate((table) => ({
    alignment: table.getAttribute("data-table-alignment"),
    indent: table.getAttribute("data-table-indent"),
    marginLeft: table.style.marginLeft,
    marginRight: table.style.marginRight
  })), { alignment: "left", indent: "567", marginLeft: "37.8px", marginRight: "auto" });
  await page.locator('label[title="设置当前表格单元格间距"] select').selectOption("120");
  assert.deepEqual(await sourceTables.last().evaluate((table) => ({
    spacing: table.getAttribute("data-table-cell-spacing"),
    borderCollapse: getComputedStyle(table).borderCollapse,
    borderSpacing: getComputedStyle(table).borderSpacing
  })), { spacing: "120", borderCollapse: "separate", borderSpacing: "8px" });

  await page.evaluate(() => {
    const paragraph = document.querySelector(".word-editor p");
    if (!paragraph) throw new Error("未找到段落样式测试节点");
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    (paragraph.closest(".word-editor"))?.focus();
    document.dispatchEvent(new Event("selectionchange", { bubbles: true }));
  });
  await page.waitForTimeout(50);
  await page.getByRole("tab", { name: "开始" }).click();
  await page.locator('label[title="设置当前段落样式"] select').selectOption("heading-2");
  assert.match(await editor.innerHTML(), /<h2[^>]*>.*保留小号红字.*<\/h2>/);

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByRole("tab", { name: "文档" }).click();
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
  await page.getByLabel("关闭页面设置", { exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 900 });

  // 中文注解：页面设置已经通过关闭按钮收起，再聚焦文末；功能区换行时不依赖易被遮挡的坐标点击。
  await editor.evaluate((element) => element.click());
  await editor.focus();
  await editor.press("Control+End");
  await page.getByRole("button", { name: "分节符", exact: true }).evaluate((button) => button.click());
  await editor.type("第二节横向内容");
  await page.getByText("页面设置", { exact: true }).click();
  await page.getByText("第 2 节 / 共 2 节", { exact: true }).waitFor();
  await page.getByLabel("当前节纸张方向", { exact: true }).selectOption("landscape");
  await page.getByLabel("当前节纸张规格", { exact: true }).selectOption("legal");
  await page.getByLabel("当前节上边距", { exact: true }).fill("1.27");
  await page.getByLabel("当前节下边距", { exact: true }).fill("1.27");
  await page.getByLabel("当前节装订线", { exact: true }).fill("1");
  await page.getByLabel("当前节页眉距纸边", { exact: true }).fill("0.85");
  await page.getByLabel("当前节页脚距纸边", { exact: true }).fill("1.48");
  await page.getByLabel("当前节分栏数", { exact: true }).selectOption("2");
  await page.getByLabel("当前节栏间距", { exact: true }).fill("0.8");
  await page.getByLabel("当前节分栏布局", { exact: true }).selectOption("custom");
  await page.getByLabel("当前节第1栏宽度", { exact: true }).fill("5.29");
  await page.getByLabel("当前节第1栏后间距", { exact: true }).fill("0.8");
  await page.getByLabel("当前节第2栏宽度", { exact: true }).fill("18.53");
  await page.getByLabel("当前节分栏分隔线", { exact: true }).check();
  await page.getByLabel("当前节页面垂直对齐", { exact: true }).selectOption("center");
  await page.getByLabel("当前节页面边框样式", { exact: true }).selectOption("double");
  await page.getByLabel("当前节页面边框粗细", { exact: true }).selectOption("12");
  await page.getByLabel("当前节页面边框颜色", { exact: true }).fill("#1f4e79");
  await page.getByLabel("当前节页面边框距离", { exact: true }).fill("0.85");
  await page.getByLabel("当前节页面边框显示范围", { exact: true }).selectOption("firstPage");
  await page.getByLabel("当前节页码格式", { exact: true }).selectOption("upperRoman");
  await page.getByLabel("当前节起始页码", { exact: true }).fill("3");
  const secondSectionHeaderInput = page.getByLabel("默认页眉文字", { exact: true });
  await secondSectionHeaderInput.fill("第二节横向页眉");
  await secondSectionHeaderInput.press("Enter");
  await secondSectionHeaderInput.type("审批状态：已确认");
  await page.getByLabel("默认页脚文字", { exact: true }).fill("第二节横向页脚");
  await page.getByText("首页不同", { exact: true }).click();
  await page.getByText("奇偶页不同", { exact: true }).click();
  await page.getByLabel("关闭页面设置", { exact: true }).click();

  const secondSectionParagraph = editor.locator("p").filter({ hasText: "第二节横向内容" });
  await secondSectionParagraph.click();
  await secondSectionParagraph.press("End");
  await page.getByRole("button", { name: "分栏符", exact: true }).click();
  await editor.type("分栏符后内容");
  const editorColumnBreak = editor.locator('[data-column-break="true"]');
  assert.equal(await editorColumnBreak.count(), 1);
  assert.deepEqual(await editorColumnBreak.evaluate((marker) => ({ before: marker.previousElementSibling?.textContent || "", after: marker.nextElementSibling?.textContent || "" })), { before: "第二节横向内容", after: "分栏符后内容" });

  await page.getByRole("tab", { name: "插入" }).click();
  await floatingEditorImage.click();
  await page.getByLabel("选中图片宽度", { exact: true }).fill("56");
  await page.getByRole("button", { name: "上下型", exact: true }).click();
  assert.equal(await floatingEditorImage.getAttribute("data-docx-wrap"), "topAndBottom");
  assert.equal(await floatingEditorImage.evaluate((image) => getComputedStyle(image).clear), "both");
  await page.getByRole("button", { name: "嵌入", exact: true }).click();
  assert.equal(await floatingEditorImage.getAttribute("data-docx-floating"), null);
  await page.getByRole("button", { name: "左环绕", exact: true }).click();
  assert.equal(await floatingEditorImage.getAttribute("width"), "56");
  assert.equal(await floatingEditorImage.getAttribute("height"), "56");
  assert.equal(await floatingEditorImage.getAttribute("data-docx-float-align"), "left");
  assert.equal(await floatingEditorImage.evaluate((image) => getComputedStyle(image).float), "left");

  const manualSaveCountBeforeShortcut = manualSaveRequestCount;
  await page.keyboard.press("Control+S");
  await page.keyboard.press("Control+S");
  await page.waitForFunction(() => document.querySelector(".toolbar-actions button")?.hasAttribute("disabled") === true);
  await page.waitForFunction(() => document.querySelector(".save-status")?.textContent?.includes("已保存"));
  assert.equal(manualSaveRequestCount - manualSaveCountBeforeShortcut, 1);
  assert.match(storedDocument.content, /<h2[^>]*>.*保留小号红字.*<\/h2>/);
  assert.match(storedDocument.content, /font-family:\s*SimSun/);
  assert.match(storedDocument.content, /font-size:\s*12pt/);
  assert.match(storedDocument.content, /letter-spacing:\s*2pt/);
  assert.match(storedDocument.content, /vertical-align:\s*3pt/);
  assert.match(storedDocument.content, /text-decoration-style:\s*double/);
  assert.match(storedDocument.content, /--word-underline-type:\s*double/);
  assert.match(storedDocument.content, /--word-text-border:\s*dashed,8,1F4E79,1/i);
  assert.match(storedDocument.content, /border-(?:top|style):\s*dashed/i);
  assert.match(storedDocument.content, /border-(?:top|width):\s*1\.33px/i);
  assert.match(storedDocument.content, /padding(?:-top)?:\s*1\.33px/i);
  assert.match(storedDocument.content, /margin-left:\s*28\.35pt/);
  assert.match(storedDocument.content, /text-indent:\s*-28\.35pt/);
  assert.match(storedDocument.content, /margin-right:\s*14\.17pt/);
  assert.match(storedDocument.content, /data-list-format="upperRoman"/);
  assert.match(storedDocument.content, /<ol(?=[^>]*start="4")(?=[^>]*data-list-format="upperRoman")[^>]*>/);
  assert.match(storedDocument.content, /<h4[^>]+data-outline-level="3"[^>]*>[\s\S]*?大纲级别工具[\s\S]*?<\/h4>/);
  assert.match(storedDocument.content, /text-transform:\s*uppercase/);
  assert.match(storedDocument.content, /font-variant-caps:\s*small-caps/);
  assert.match(storedDocument.content, /data-highlight="darkCyan"/);
  assert.match(storedDocument.content, /data-double-strike="true"[^>]*>[\s\S]*?双删除线工具/);
  assert.ok(storedDocument.content.includes("特殊连字符工具") && storedDocument.content.includes("\u00AD") && storedDocument.content.includes("\u2011"));
  assert.match(storedDocument.content, /手动换行工具 第一行[\s\S]*?<br[^>]*>[\s\S]*?第二行/);
  assert.match(storedDocument.content, /脚注工具[\s\S]*?<span(?=[^>]*class="footnote-reference")(?=[^>]*data-footnote-id="1")(?=[^>]*data-footnote-text="审批依据说明")[^>]*>/);
  assert.match(storedDocument.content, /尾注工具[\s\S]*?<span(?=[^>]*class="endnote-reference")(?=[^>]*data-endnote-id="1")(?=[^>]*data-endnote-text="文末法规来源")[^>]*>/);
  assert.match(storedDocument.content, /<span(?=[^>]*class="comment-mark")(?=[^>]*data-comment-id="1")(?=[^>]*data-comment-text="请补充审批依据")(?=[^>]*data-comment-author="在线审阅者")[^>]*>[\s\S]*?批注工具[\s\S]*?<\/span>/);
  assert.match(storedDocument.content, /<span(?=[^>]*class="revision-insert")(?=[^>]*data-revision-type="insert")(?=[^>]*data-revision-id="1")(?=[^>]*data-revision-author="在线审阅者")[^>]*>新增修订工具<\/span>/);
  assert.match(storedDocument.content, /<span(?=[^>]*class="revision-delete")(?=[^>]*data-revision-type="delete")(?=[^>]*data-revision-id="2")(?=[^>]*data-revision-author="在线审阅者")[^>]*>删除修订工具<\/span>/);
  assert.doesNotMatch(storedDocument.content, /class="revision-(?:insert|delete)"[^>]*>接受新增工具|class="revision-(?:insert|delete)"[^>]*>拒绝删除工具/);
  assert.match(storedDocument.content, /<p[^>]+data-bidirectional="true"[^>]+style="[^"]*direction:\s*rtl[^"]*"[^>]*>[\s\S]*?RTL段落工具内容[\s\S]*?<\/p>/);
  assert.doesNotMatch(storedDocument.content, /<mark[^>]*>清除高亮工具<\/mark>/);
  assert.match(storedDocument.content, /<p[^>]+data-paragraph-shading="[^\"]*DDEBF7[^\"]*"[^>]+data-paragraph-borders="[^\"]*dashed[^\"]*"[^>]*>[\s\S]*?段落外观工具[\s\S]*?<\/p>/);
  assert.match(storedDocument.content, /data-section-break="nextPage"/);
  assert.match(storedDocument.content, /rowspan="2"/);
  assert.match(storedDocument.content, /<table(?=[^>]*data-table-alignment="left")(?=[^>]*data-table-indent="567")(?=[^>]*data-table-cell-spacing="120")(?=[^>]*style="[^"]*margin-left:\s*37\.8px)(?=[^>]*style="[^"]*margin-right:\s*auto)(?=[^>]*style="[^"]*border-spacing:\s*8px)[^>]*>[\s\S]*?商务评审/);
  assert.match(storedDocument.content, /第二节横向内容/);
  assert.match(storedDocument.content, /<div[^>]+data-column-break="true"[^>]*><\/div>/);
  assert.ok(storedDocument.content.indexOf("第二节横向内容") < storedDocument.content.indexOf('data-column-break="true"') && storedDocument.content.indexOf('data-column-break="true"') < storedDocument.content.indexOf("分栏符后内容"));
  assert.match(storedDocument.content, /第二节横向页眉/);
  const storedSectionLayoutText = storedDocument.content.match(/data-section-layout="([^"]+)"/)?.[1]
    .replaceAll("&quot;", '"')
    .replaceAll("&amp;", "&") || "";
  const storedSectionLayout = JSON.parse(storedSectionLayoutText);
  // 中文注解：直接验证节点负载，避免界面文本存在但连续设置被旧状态覆盖后仍误判为保存成功。
  assert.equal(storedSectionLayout.orientation, "landscape");
  assert.deepEqual(storedSectionLayout.paperSize, { width: 12240, height: 20160 });
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
  assert.equal(storedSectionLayout.gutter, 567);
  assert.deepEqual(storedSectionLayout.columns, {
    count: 2,
    space: 454,
    separate: true,
    equalWidth: false,
    items: [{ width: 2999, space: 454 }, { width: 10505, space: 0 }]
  });
  assert.equal(storedSectionLayout.verticalAlign, "center");
  assert.deepEqual(storedSectionLayout.pageBorders, {
    display: "firstPage",
    offsetFrom: "page",
    zOrder: "front",
    top: { style: "double", size: 12, color: "#1F4E79", space: 24 },
    right: { style: "double", size: 12, color: "#1F4E79", space: 24 },
    bottom: { style: "double", size: 12, color: "#1F4E79", space: 24 },
    left: { style: "double", size: 12, color: "#1F4E79", space: 24 }
  });
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
    paperSize: { width: 11906, height: 16838 },
    pageNumberFormat: "decimal",
    pageNumberStart: null,
    headerDistance: 708,
    footerDistance: 708,
    columns: { count: 1, space: 720, separate: false },
    verticalAlign: "top",
    pageBorders: null,
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
  assert.match(reopenedHtml, /data-double-strike="true"[^>]*>[\s\S]*?双删除线工具/);
  assert.match(reopenedHtml, /<img[^>]+alt="浮动审批标识"[^>]+data-docx-floating=/);
  const reopenedFloatingImage = editor.locator('img[alt="浮动审批标识"]');
  assert.equal(await reopenedFloatingImage.getAttribute("width"), "56");
  assert.equal(await reopenedFloatingImage.getAttribute("data-docx-float-align"), "left");
  assert.match(reopenedHtml, /<a[^>]+href="https:\/\/example\.com\/office"[^>]*>[\s\S]*链接工具[\s\S]*<\/a>/);
  assert.match(reopenedHtml, /<p[^>]+data-paragraph-shading="[^\"]*DDEBF7[^\"]*"[^>]+data-paragraph-borders="[^\"]*dashed[^\"]*"[^>]*>[\s\S]*?段落外观工具[\s\S]*?<\/p>/);
  assert.match(reopenedHtml, /<p[^>]+data-bidirectional="true"[^>]+style="[^"]*direction:\s*rtl[^"]*"[^>]*>[\s\S]*?RTL段落工具内容[\s\S]*?<\/p>/);
  assert.ok(reopenedHtml.includes("特殊连字符工具") && reopenedHtml.includes("\u00AD") && reopenedHtml.includes("\u2011"));
  assert.match(reopenedHtml, /手动换行工具 第一行[\s\S]*?<br[^>]*>[\s\S]*?第二行/);
  assert.match(reopenedHtml, /脚注工具[\s\S]*?<span(?=[^>]*class="footnote-reference")(?=[^>]*data-footnote-id="1")(?=[^>]*data-footnote-text="审批依据说明")[^>]*>/);
  assert.match(reopenedHtml, /尾注工具[\s\S]*?<span(?=[^>]*class="endnote-reference")(?=[^>]*data-endnote-id="1")(?=[^>]*data-endnote-text="文末法规来源")[^>]*>/);
  assert.match(reopenedHtml, /<span(?=[^>]*class="comment-mark")(?=[^>]*data-comment-id="1")(?=[^>]*data-comment-text="请补充审批依据")(?=[^>]*data-comment-author="在线审阅者")[^>]*>[\s\S]*?批注工具[\s\S]*?<\/span>/);
  assert.match(reopenedHtml, /<span(?=[^>]*class="revision-insert")(?=[^>]*data-revision-id="1")(?=[^>]*data-revision-author="在线审阅者")[^>]*>新增修订工具<\/span>/);
  assert.match(reopenedHtml, /<span(?=[^>]*class="revision-delete")(?=[^>]*data-revision-id="2")(?=[^>]*data-revision-author="在线审阅者")[^>]*>删除修订工具<\/span>/);
  assert.match(reopenedHtml, /data-section-break="nextPage"/);
  assert.match(reopenedHtml, /第二节横向内容/);
  assert.match(reopenedHtml, /<div[^>]+data-column-break="true"[^>]*><\/div>/);
  assert.ok(reopenedHtml.indexOf("第二节横向内容") < reopenedHtml.indexOf('data-column-break="true"') && reopenedHtml.indexOf('data-column-break="true"') < reopenedHtml.indexOf("分栏符后内容"));
  assert.equal((reopenedHtml.match(/data-docx-tab="true"/g) || []).length, 4);
  assert.match(reopenedHtml, /<td[^>]+data-cell-margins="[^"]*&quot;top&quot;:180[^"]*"[^>]+data-cell-vertical-align="bottom"[^>]+data-cell-text-direction="btLr"[^>]+data-cell-shading="#FFF2CC"[^>]*>.*商务评审/s);
  assert.match(reopenedHtml, /<td[^>]+data-cell-borders="[^"]*&quot;top&quot;[^"]*dashed[^"]*6B7280[^"]*"[^>]*>.*商务评审/s);
  assert.match(reopenedHtml, /<table(?=[^>]*data-table-alignment="left")(?=[^>]*data-table-indent="567")(?=[^>]*data-table-cell-spacing="120")(?=[^>]*style="[^"]*margin-left:\s*37\.8px)(?=[^>]*style="[^"]*margin-right:\s*auto)(?=[^>]*style="[^"]*border-spacing:\s*8px)[^>]*>[\s\S]*?商务评审/);
  assert.match(reopenedHtml, /<h4[^>]+data-outline-level="3"[^>]*>[\s\S]*?大纲级别工具[\s\S]*?<\/h4>/);
  const reopenedHeaderRow = reopenedHtml.match(/<tr[^>]+data-row-height="850"[^>]*>/)?.[0] || "";
  assert.match(reopenedHeaderRow, /data-row-height-rule="exact"/);
  assert.match(reopenedHeaderRow, /data-row-cant-split="true"/);
  assert.match(reopenedHeaderRow, /data-row-repeat-header="true"/);
  assert.match(reopenedHeaderRow, /style="height: 56\.67px;?"/);

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 Word", exact: true }).click();
  const download = await downloadPromise;
  await page.waitForFunction(() => document.body.textContent?.includes("Word 已生成"));
  const downloadedPath = await download.path();
  assert.ok(downloadedPath, "导出的 DOCX 应可下载");
  const downloadedBuffer = await readFile(downloadedPath);
  const archive = await JSZip.loadAsync(downloadedBuffer);
  const documentXml = await archive.file("word/document.xml")?.async("string");
  const documentRelationshipsXml = await archive.file("word/_rels/document.xml.rels")?.async("string") || "";
  const numberingXml = await archive.file("word/numbering.xml")?.async("string") || "";
  const settingsXml = await archive.file("word/settings.xml")?.async("string");
  const headerXmlParts = await Promise.all(archive.file(/^word\/header\d+\.xml$/).map((file) => file.async("string")));
  const footerXmlParts = await Promise.all(archive.file(/^word\/footer\d+\.xml$/).map((file) => file.async("string")));
  const footnotesXml = await archive.file("word/footnotes.xml")?.async("string") || "";
  const endnotesXml = await archive.file("word/endnotes.xml")?.async("string") || "";
  const commentsXml = await archive.file("word/comments.xml")?.async("string") || "";
  const headerMedia = archive.file(/^word\/media\/.+\.png$/);
  assert.ok(documentXml, "导出的 DOCX 应包含 document.xml");
  assert.equal(headerXmlParts.length, 5, "导出的 DOCX 应包含首节三类页眉和第二节默认/偶数页眉");
  assert.equal(footerXmlParts.length, 5, "导出的 DOCX 应包含首节三类页脚和第二节默认/偶数页脚");
  assert.ok(headerXmlParts.some((xml) => /<w:drawing>/.test(xml)) && headerMedia.length > 0, "在线页眉图片应进入导出的 DOCX 媒体部件");
  assert.equal((documentXml.match(/<w:sectPr(?:\s|>)/g) || []).length, 2);
  assert.match(documentXml, /<w:type w:val="nextPage"\/>/);
  assert.match(documentXml, /<w:br w:type="column"\/>/);
  assert.match(documentXml, /<w:pgSz[^>]+w:orient="landscape"/);
  assert.match(documentXml, /<w:pgMar[^>]+w:top="720"[^>]+w:right="1440"[^>]+w:bottom="720"[^>]+w:left="1440"/);
  assert.match(documentXml, /<w:pgMar[^>]+w:header="482"[^>]+w:footer="839"/);
  assert.match(documentXml, /<w:pgNumType[^>]+w:start="3"[^>]*w:fmt="upperRoman"/);
  const exportedLandscapeSection = (documentXml.match(/<w:sectPr>[\s\S]*?<\/w:sectPr>/g) || []).find((section) => /w:orient="landscape"/.test(section)) || "";
  assert.match(exportedLandscapeSection, /<w:pgSz[^>]+w:w="20160"[^>]+w:h="12240"[^>]+w:orient="landscape"/);
  assert.match(exportedLandscapeSection, /<w:pgMar[^>]+w:gutter="567"/);
  assert.match(exportedLandscapeSection, /<w:cols[^>]+w:num="2"[^>]+w:sep="true"[^>]+w:equalWidth="false"/);
  assert.match(exportedLandscapeSection, /<w:col w:w="2999" w:space="454"\/><w:col w:w="10505"\/>/);
  assert.match(exportedLandscapeSection, /<w:pgBorders[^>]+w:display="firstPage"[^>]+w:offsetFrom="page"[^>]+w:zOrder="front"/);
  assert.match(exportedLandscapeSection, /<w:top w:val="double" w:color="1F4E79" w:sz="12" w:space="24"\/>/);
  assert.match(exportedLandscapeSection, /<w:vAlign w:val="center"\/>/);
  assert.match(documentXml, /<w:titlePg\/>/);
  assert.match(settingsXml, /<w:evenAndOddHeaders\/>/);
  assert.match(documentXml, /<w:gridSpan w:val="2"\/>/);
  assert.match(documentXml, /<w:vMerge w:val="restart"\/>/);
  assert.match(documentXml, /<w:vMerge w:val="continue"\/>/);
  const geometryTable = (documentXml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/g) || []).find((table) => table.includes("商务评审")) || "";
  assert.match(geometryTable, /<w:tblW w:type="dxa" w:w="7200"\/>/);
  assert.match(geometryTable, /<w:tblLayout w:type="fixed"\/>/);
  assert.match(geometryTable, /<w:jc w:val="left"\/>/);
  assert.match(geometryTable, /<w:tblInd w:type="dxa" w:w="567"\/>/);
  assert.match(geometryTable, /<w:tblCellSpacing(?=[^>]+w:type="dxa")(?=[^>]+w:w="120")[^>]*\/>/);
  assert.match(geometryTable, /<w:tblGrid><w:gridCol w:w="1800"\/><w:gridCol w:w="5400"\/><\/w:tblGrid>/);
  const businessReviewCellXml = (geometryTable.match(/<w:tc>[\s\S]*?<\/w:tc>/g) || []).find((cell) => cell.includes("商务评审")) || "";
  const businessReviewMarginsXml = businessReviewCellXml.match(/<w:tcMar>[\s\S]*?<\/w:tcMar>/)?.[0] || "";
  // 中文注解：docx 库可能调整四边节点顺序，按边分别验证可避免把等价 XML 误判为失败。
  for (const side of ["top", "right", "bottom", "left"]) {
    assert.match(businessReviewMarginsXml, new RegExp(`<w:${side} w:type="dxa" w:w="180"\\/>`));
  }
  assert.match(businessReviewCellXml, /<w:shd w:fill="FFF2CC"\/>/);
  assert.match(businessReviewCellXml, /<w:vAlign w:val="bottom"\/>/);
  assert.match(businessReviewCellXml, /<w:textDirection w:val="btLr"\/>/);
  const businessReviewBordersXml = businessReviewCellXml.match(/<w:tcBorders>[\s\S]*?<\/w:tcBorders>/)?.[0] || "";
  for (const side of ["top", "right", "bottom", "left"]) {
    assert.match(businessReviewBordersXml, new RegExp(`<w:${side} w:val="dashed" w:color="6B7280" w:sz="6"\\/>`));
  }
  const longTable = (documentXml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/g) || []).find((table) => table.includes("左侧单元格包含大量业务说明")) || "";
  const longTableHeaderRow = longTable.match(/<w:tr>[\s\S]*?<\/w:tr>/)?.[0] || "";
  assert.match(longTableHeaderRow, /<w:tblHeader\/>/);
  assert.match(longTableHeaderRow, /<w:cantSplit\/>/);
  assert.match(longTableHeaderRow, /<w:trHeight w:val="850" w:hRule="exact"\/>/);
  const darkCyanHighlightRun = (documentXml.match(/<w:r(?:\s[^>]*)?>[\s\S]*?<\/w:r>/g) || []).find((run) => run.includes("突出显示工具")) || "";
  const clearedHighlightRun = (documentXml.match(/<w:r(?:\s[^>]*)?>[\s\S]*?<\/w:r>/g) || []).find((run) => run.includes("清除高亮工具")) || "";
  assert.match(darkCyanHighlightRun, /<w:highlight w:val="darkCyan"\/>/);
  assert.doesNotMatch(clearedHighlightRun, /<w:highlight/);
  assert.match(documentXml, /<w:vertAlign w:val="superscript"\/>/);
  assert.match(documentXml, /<w:vertAlign w:val="subscript"\/>/);
  const advancedCharacterRun = (documentXml.match(/<w:r(?:\s[^>]*)?>[\s\S]*?<\/w:r>/g) || []).find((run) => run.includes("字符间距工具")) || "";
  assert.match(advancedCharacterRun, /<w:spacing w:val="40"\/>/);
  assert.match(advancedCharacterRun, /<w:position w:val="6"\/>/);
  const advancedUnderlineRun = (documentXml.match(/<w:r(?:\s[^>]*)?>[\s\S]*?<\/w:r>/g) || []).find((run) => run.includes("下划线样式工具")) || "";
  assert.match(advancedUnderlineRun, /<w:u w:val="double"\/>/);
  const textBorderRun = (documentXml.match(/<w:r(?:\s[^>]*)?>[\s\S]*?<\/w:r>/g) || []).find((run) => run.includes("字符边框工具")) || "";
  assert.match(textBorderRun, /<w:bdr[^>]+w:val="dashed"[^>]+w:color="1F4E79"[^>]+w:sz="8"[^>]+w:space="1"\/>/);
  const hangingIndentParagraph = (documentXml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g) || []).find((paragraph) => paragraph.includes("悬挂缩进工具内容")) || "";
  assert.match(hangingIndentParagraph, /<w:ind(?=[^>]+w:left="567")(?=[^>]+w:hanging="567")[^>]*\/>/);
  const sideIndentsParagraph = (documentXml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g) || []).find((paragraph) => paragraph.includes("段落左右缩进工具内容")) || "";
  assert.match(sideIndentsParagraph, /<w:ind(?=[^>]+w:left="567")(?=[^>]+w:right="283")[^>]*\/>/);
  const romanListParagraph = (documentXml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g) || []).find((paragraph) => paragraph.includes("第二个编号项")) || "";
  const romanNumberId = romanListParagraph.match(/<w:numId w:val="(\d+)"\/>/)?.[1] || "";
  const romanNumberXml = [...numberingXml.matchAll(/<w:num w:numId="(\d+)">([\s\S]*?)<\/w:num>/g)].find((match) => match[1] === romanNumberId)?.[2] || "";
  const romanAbstractId = romanNumberXml.match(/<w:abstractNumId w:val="(\d+)"\/>/)?.[1] || "";
  const romanAbstractXml = [...numberingXml.matchAll(/<w:abstractNum w:abstractNumId="(\d+)"[^>]*>([\s\S]*?)<\/w:abstractNum>/g)].find((match) => match[1] === romanAbstractId)?.[2] || "";
  assert.match(romanAbstractXml, /<w:lvl[^>]+w:ilvl="0"[^>]*>[\s\S]*?<w:numFmt w:val="upperRoman"\/>/);
  assert.match(romanAbstractXml, /<w:lvl[^>]+w:ilvl="0"[^>]*>[\s\S]*?<w:start w:val="4"\/>/);
  const outlineHeadingParagraph = (documentXml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g) || []).find((paragraph) => paragraph.includes("大纲级别工具")) || "";
  assert.match(outlineHeadingParagraph, /<w:pStyle w:val="Heading4"\/>/);
  assert.match(outlineHeadingParagraph, /<w:outlineLvl w:val="3"\/>/);
  const allCapsRun = (documentXml.match(/<w:r(?:\s[^>]*)?>[\s\S]*?<\/w:r>/g) || []).find((run) => run.includes("all Caps Format")) || "";
  const smallCapsRun = (documentXml.match(/<w:r(?:\s[^>]*)?>[\s\S]*?<\/w:r>/g) || []).find((run) => run.includes("small Caps Format")) || "";
  assert.match(allCapsRun, /<w:caps\/>/);
  assert.match(smallCapsRun, /<w:smallCaps\/>/);
  const doubleStrikeRun = (documentXml.match(/<w:r(?:\s[^>]*)?>[\s\S]*?<\/w:r>/g) || []).find((run) => run.includes("双删除线工具")) || "";
  assert.match(doubleStrikeRun, /<w:dstrike\/>/);
  assert.doesNotMatch(doubleStrikeRun, /<w:strike(?:\s|\/|>)/);
  const floatingBodyDrawing = (documentXml.match(/<w:drawing>[\s\S]*?<\/w:drawing>/g) || []).find((drawing) => drawing.includes("浮动审批标识")) || "";
  assert.match(floatingBodyDrawing, /<wp:anchor/);
  assert.match(floatingBodyDrawing, /<wp:positionH relativeFrom="column"><wp:align>left<\/wp:align><\/wp:positionH>/);
  assert.match(floatingBodyDrawing, /<wp:extent cx="533400" cy="533400"\/>/);
  assert.match(floatingBodyDrawing, /<wp:wrapSquare wrapText="bothSides"/);
  assert.match(documentXml, /<w:hyperlink[^>]+r:id="[^"]+"[^>]*>[\s\S]*链接工具[\s\S]*<\/w:hyperlink>/);
  assert.match(documentRelationshipsXml, /Target="https:\/\/example\.com\/office" TargetMode="External"/);
  const tabWorkflowParagraph = (documentXml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g) || []).find((paragraph) => paragraph.includes("Tab workflow")) || "";
  assert.match(tabWorkflowParagraph, /<w:tabs><w:tab w:val="left" w:pos="1440"\/><w:tab w:val="right" w:pos="5760"\/><\/w:tabs>/);
  assert.equal((tabWorkflowParagraph.match(/<w:tab\/>/g) || []).length, 2);
  const paginationParagraph = (documentXml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g) || []).find((paragraph) => paragraph.includes("分页控制段落")) || "";
  assert.match(paginationParagraph, /<w:keepNext\/>/);
  assert.match(paginationParagraph, /<w:keepLines\/>/);
  assert.match(paginationParagraph, /<w:pageBreakBefore\/>/);
  assert.match(paginationParagraph, /<w:widowControl\/>/);
  const rtlExportParagraph = (documentXml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g) || []).find((paragraph) => paragraph.includes("RTL段落工具内容")) || "";
  assert.match(rtlExportParagraph, /<w:bidi\/>/);
  const specialHyphenExportParagraph = (documentXml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g) || []).find((paragraph) => paragraph.includes("特殊连字符工具") && paragraph.includes("2026")) || "";
  assert.match(specialHyphenExportParagraph, /inter[\s\S]*?<w:softHyphen\/>[\s\S]*?national code[\s\S]*?<w:noBreakHyphen\/>[\s\S]*?2026/);
  const manualLineBreakExportParagraph = (documentXml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g) || []).find((paragraph) => paragraph.includes("手动换行工具") && paragraph.includes("第二行")) || "";
  assert.match(manualLineBreakExportParagraph, /第一行[\s\S]*?<w:br\/>[\s\S]*?第二行/);
  assert.match(documentXml, /脚注工具[\s\S]*?<w:footnoteReference w:id="1"\/>/);
  assert.match(documentRelationshipsXml, /relationships\/footnotes" Target="footnotes\.xml"/);
  assert.match(footnotesXml, /<w:footnote w:id="1">[\s\S]*审批依据说明[\s\S]*<\/w:footnote>/);
  assert.match(documentXml, /尾注工具[\s\S]*?<w:endnoteReference w:id="1"\/>/);
  assert.match(documentRelationshipsXml, /relationships\/endnotes" Target="endnotes\.xml"/);
  assert.match(endnotesXml, /<w:endnote w:id="1">[\s\S]*文末法规来源[\s\S]*<\/w:endnote>/);
  assert.match(documentXml, /<w:commentRangeStart w:id="1"\/>[\s\S]*批注工具[\s\S]*<w:commentRangeEnd w:id="1"\/>[\s\S]*<w:commentReference w:id="1"\/>/);
  assert.match(documentRelationshipsXml, /relationships\/comments" Target="comments\.xml"/);
  assert.match(commentsXml, /<w:comment(?=[^>]+w:id="1")(?=[^>]+w:author="在线审阅者")(?=[^>]+w:initials="ZX")[^>]*>[\s\S]*请补充审批依据[\s\S]*<\/w:comment>/);
  assert.match(documentXml, /<w:ins(?=[^>]+w:id="1")(?=[^>]+w:author="在线审阅者")[^>]*>[\s\S]*<w:t[^>]*>新增修订工具<\/w:t>[\s\S]*<\/w:ins>/);
  assert.match(documentXml, /<w:del(?=[^>]+w:id="2")(?=[^>]+w:author="在线审阅者")[^>]*>[\s\S]*<w:delText[^>]*>删除修订工具<\/w:delText>[\s\S]*<\/w:del>/);
  const appearanceParagraph = (documentXml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g) || []).find((paragraph) => paragraph.includes("段落外观工具")) || "";
  assert.match(appearanceParagraph, /<w:shd[^>]+w:fill="DDEBF7"/);
  for (const side of ["top", "right", "bottom", "left"]) {
    assert.match(appearanceParagraph, new RegExp(`<w:${side} w:val="dashed" w:color="6B7280" w:sz="6" w:space="3"\\/>`));
  }
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

  await page.getByRole("tab", { name: "文档" }).click();
  await page.getByRole("button", { name: "分页", exact: true }).click();
  await page.locator(".page-sheet").first().waitFor();
  await page.waitForFunction(() => document.querySelectorAll(".page-sheet").length > 5);
  await page.waitForFunction(() => Array.from(document.querySelectorAll(".page-footnote")).some((footnote) => footnote.textContent?.includes("审批依据说明")));
  const footnotePreviewLayout = await page.evaluate(() => {
    const footnote = Array.from(document.querySelectorAll(".page-footnote")).find((item) => item.textContent?.includes("审批依据说明"));
    const sheet = footnote?.closest(".page-sheet");
    const body = sheet?.querySelector(".page-body");
    const reference = sheet?.querySelector('.footnote-reference[data-footnote-id="1"]');
    return footnote && sheet && body && reference ? {
      text: footnote.textContent || "",
      bodyBottom: body.getBoundingClientRect().bottom,
      footnoteTop: footnote.closest(".page-footnotes").getBoundingClientRect().top,
      samePage: true
    } : null;
  });
  assert.ok(footnotePreviewLayout?.text.includes("审批依据说明"), "分页预览应在引用所在页显示脚注正文");
  assert.ok(footnotePreviewLayout.bodyBottom <= footnotePreviewLayout.footnoteTop + 1, "分页正文应为页底脚注预留空间");
  await page.waitForFunction(() => {
    const pages = Array.from(document.querySelectorAll(".page-sheet"));
    const endnote = Array.from(document.querySelectorAll(".endnote-entry")).find((entry) => entry.textContent?.includes("文末法规来源"));
    return Boolean(endnote && endnote.closest(".page-sheet") === pages.at(-1));
  });
  const endnotePreview = page.locator('.page-sheet:last-child .endnote-entry[data-endnote-id="1"]');
  await endnotePreview.waitFor();
  assert.match(await endnotePreview.textContent() || "", /1文末法规来源/);
  const previewCommentMark = page.locator('.page-body .comment-mark[data-comment-id="1"]').first();
  await previewCommentMark.waitFor();
  assert.equal(await previewCommentMark.textContent(), "批注工具");
  assert.match(await previewCommentMark.evaluate((mark) => `${getComputedStyle(mark).backgroundColor} ${getComputedStyle(mark).borderBottomStyle}`), /rgb\(255, 244, 199\).*solid/);
  const previewInsertRevision = page.locator('.page-body .revision-insert[data-revision-id="1"]').first();
  await previewInsertRevision.waitFor();
  const previewInsertRevisionStyle = await page.locator('.page-body .revision-insert[data-revision-id="1"]').evaluateAll((marks) => marks.map((mark) => `${getComputedStyle(mark).color} ${getComputedStyle(mark).borderBottomStyle}`).find((value) => value.includes("rgb(23, 106, 72)")) || "");
  assert.match(previewInsertRevisionStyle, /rgb\(23, 106, 72\).*solid/);
  const previewDeleteRevision = page.locator('.page-body .revision-delete[data-revision-id="2"]').first();
  await previewDeleteRevision.waitFor();
  const previewDeleteRevisionStyle = await page.locator('.page-body .revision-delete[data-revision-id="2"]').evaluateAll((marks) => marks.map((mark) => `${getComputedStyle(mark).color} ${getComputedStyle(mark).textDecorationLine}`).find((value) => value.includes("rgb(180, 35, 44)")) || "");
  assert.match(previewDeleteRevisionStyle, /rgb\(180, 35, 44\).*line-through/);
  const previewLink = page.locator('.page-body a[href="https://example.com/office"]').first();
  await previewLink.waitFor();
  await page.waitForFunction(() => Array.from(document.querySelectorAll('.page-body a[href="https://example.com/office"]')).some((link) => getComputedStyle(link).textDecorationLine.includes("underline")));
  assert.match(await page.evaluate(() => Array.from(document.querySelectorAll('.page-body a[href="https://example.com/office"]')).map((link) => {
    const style = getComputedStyle(link);
    return `${style.textDecorationLine} ${style.textDecoration}`;
  }).find((value) => value.includes("underline")) || ""), /underline/);
  const previewFloatingImage = page.locator('.page-body img[alt="浮动审批标识"]').first();
  await previewFloatingImage.waitFor();
  await page.waitForFunction(() => Array.from(document.querySelectorAll('.page-body img[alt="浮动审批标识"]')).some((image) => getComputedStyle(image).float === "left"));
  // 中文注解：分页重排会短暂保留旧克隆，应从所有已连接节点中读取最终应用左浮动的图片。
  assert.equal(await page.evaluate(() => Array.from(document.querySelectorAll('.page-body img[alt="浮动审批标识"]')).map((image) => getComputedStyle(image).float).find((value) => value === "left") || ""), "left");
  const previewParagraphAppearance = page.locator('.page-body p[data-paragraph-shading][data-paragraph-borders]').filter({ hasText: "段落外观工具" }).first();
  await previewParagraphAppearance.waitFor();
  await page.waitForFunction(() => Array.from(document.querySelectorAll(".page-body p")).some((paragraph) => paragraph.textContent?.includes("段落外观工具") && getComputedStyle(paragraph).backgroundColor === "rgb(221, 235, 247)"));
  assert.deepEqual(await page.evaluate(() => {
    const paragraph = Array.from(document.querySelectorAll(".page-body p")).find((item) => item.textContent?.includes("段落外观工具") && getComputedStyle(item).backgroundColor === "rgb(221, 235, 247)");
    const style = paragraph ? getComputedStyle(paragraph) : null;
    return { backgroundColor: style?.backgroundColor || "", borderTopStyle: style?.borderTopStyle || "", borderTopWidth: style?.borderTopWidth || "", paddingTop: style?.paddingTop || "" };
  }), { backgroundColor: "rgb(221, 235, 247)", borderTopStyle: "dashed", borderTopWidth: "1px", paddingTop: "4px" });
  await page.waitForFunction(() => Array.from(document.querySelectorAll(".page-body p")).some((paragraph) => paragraph.textContent?.includes("RTL段落工具内容") && getComputedStyle(paragraph).direction === "rtl"));
  assert.equal(await page.evaluate(() => Array.from(document.querySelectorAll(".page-body p")).map((paragraph) => paragraph.textContent?.includes("RTL段落工具内容") ? getComputedStyle(paragraph).direction : "").find((direction) => direction === "rtl") || ""), "rtl");
  // 中文注解：分页预览重排期间可能短暂保留旧克隆，按格式属性定位最终稳定的字符节点。
  const previewAdvancedCharacter = page.locator('.page-body span[style*="letter-spacing"][style*="vertical-align"]').filter({ hasText: "字符间距工具" }).first();
  await previewAdvancedCharacter.waitFor();
  await page.waitForFunction(() => Array.from(document.querySelectorAll('.page-body span[style*="letter-spacing"][style*="vertical-align"]')).some((span) => {
    const style = getComputedStyle(span);
    return span.textContent?.includes("字符间距工具") && Math.abs(Number.parseFloat(style.letterSpacing) - (2 * 96 / 72)) < 0.05;
  }));
  const previewAdvancedStyle = await page.evaluate(() => {
    const span = Array.from(document.querySelectorAll('.page-body span[style*="letter-spacing"][style*="vertical-align"]')).find((item) => item.textContent?.includes("字符间距工具") && Number.parseFloat(getComputedStyle(item).letterSpacing) > 0);
    const style = span ? getComputedStyle(span) : null;
    return { letterSpacing: Number.parseFloat(style?.letterSpacing || ""), verticalAlign: Number.parseFloat(style?.verticalAlign || "") };
  });
  assert.ok(Math.abs(previewAdvancedStyle.letterSpacing - (2 * 96 / 72)) < 0.05);
  assert.ok(Math.abs(previewAdvancedStyle.verticalAlign - (3 * 96 / 72)) < 0.05);
  const previewAdvancedUnderline = page.locator(".page-body span").filter({ hasText: "下划线样式工具" }).first();
  await previewAdvancedUnderline.waitFor();
  await page.waitForFunction(() => Array.from(document.querySelectorAll(".page-body span")).some((span) => span.textContent?.includes("下划线样式工具") && getComputedStyle(span).textDecorationStyle === "double"));
  assert.deepEqual(await page.evaluate(() => {
    const span = Array.from(document.querySelectorAll(".page-body span")).find((item) => item.textContent?.includes("下划线样式工具") && getComputedStyle(item).textDecorationStyle === "double");
    const style = span ? getComputedStyle(span) : null;
    return { line: style?.textDecorationLine || "", style: style?.textDecorationStyle || "" };
  }), { line: "underline", style: "double" });
  const previewTextBorder = page.locator('.page-body span[style*="--word-text-border"]').filter({ hasText: "字符边框工具" }).first();
  await previewTextBorder.waitFor();
  await page.waitForFunction(() => Array.from(document.querySelectorAll('.page-body span[style*="--word-text-border"]')).some((span) => span.textContent?.includes("字符边框工具") && getComputedStyle(span).borderTopStyle === "dashed"));
  assert.deepEqual(await page.evaluate(() => {
    const span = Array.from(document.querySelectorAll('.page-body span[style*="--word-text-border"]')).find((item) => item.textContent?.includes("字符边框工具") && getComputedStyle(item).borderTopStyle === "dashed");
    const style = span ? getComputedStyle(span) : null;
    return { borderStyle: style?.borderTopStyle || "", borderWidth: style?.borderTopWidth || "", borderColor: style?.borderTopColor || "", paddingTop: style?.paddingTop || "" };
  }), { borderStyle: "dashed", borderWidth: "1px", borderColor: "rgb(31, 78, 121)", paddingTop: "1.33px" });
  const previewHangingIndent = page.locator('.page-body p[style*="text-indent"]').filter({ hasText: "悬挂缩进工具内容" }).first();
  await previewHangingIndent.waitFor();
  await page.waitForFunction(() => Array.from(document.querySelectorAll('.page-body p[style*="text-indent"]')).some((paragraph) => paragraph.textContent?.includes("悬挂缩进工具内容") && getComputedStyle(paragraph).textIndent === "-37.8px"));
  assert.deepEqual(await page.evaluate(() => {
    const paragraph = Array.from(document.querySelectorAll('.page-body p[style*="text-indent"]')).find((item) => item.textContent?.includes("悬挂缩进工具内容") && getComputedStyle(item).textIndent === "-37.8px");
    const style = paragraph ? getComputedStyle(paragraph) : null;
    return { marginLeft: style?.marginLeft || "", textIndent: style?.textIndent || "" };
  }), { marginLeft: "37.8px", textIndent: "-37.8px" });
  const previewSideIndents = page.locator('.page-body p[style*="margin-right"]').filter({ hasText: "段落左右缩进工具内容" }).first();
  await previewSideIndents.waitFor();
  await page.waitForFunction(() => Array.from(document.querySelectorAll('.page-body p[style*="margin-right"]')).some((paragraph) => paragraph.textContent?.includes("段落左右缩进工具内容") && Number.parseFloat(getComputedStyle(paragraph).marginLeft) > 0));
  const previewSideIndentStyle = await page.evaluate(() => {
    const paragraph = Array.from(document.querySelectorAll('.page-body p[style*="margin-right"]')).find((item) => item.textContent?.includes("段落左右缩进工具内容") && Number.parseFloat(getComputedStyle(item).marginLeft) > 0);
    const style = paragraph ? getComputedStyle(paragraph) : null;
    return { marginLeft: Number.parseFloat(style?.marginLeft || ""), marginRight: Number.parseFloat(style?.marginRight || "") };
  });
  assert.ok(Math.abs(previewSideIndentStyle.marginLeft - 37.8) < 0.05);
  assert.ok(Math.abs(previewSideIndentStyle.marginRight - (14.17 * 96 / 72)) < 0.05);
  const previewAllCaps = page.locator('.page-body span[style*="text-transform"]').filter({ hasText: "all Caps Format" }).first();
  const previewSmallCaps = page.locator('.page-body span[style*="font-variant-caps"]').filter({ hasText: "small Caps Format" }).first();
  await previewAllCaps.waitFor();
  await previewSmallCaps.waitFor();
  assert.match(await previewAllCaps.getAttribute("style") || "", /text-transform:\s*uppercase/i);
  assert.match(await previewSmallCaps.getAttribute("style") || "", /font-variant-caps:\s*small-caps/i);
  const previewDoubleStrike = page.locator('.page-body span[data-double-strike="true"]').filter({ hasText: "双删除线工具" }).first();
  await previewDoubleStrike.waitFor();
  assert.equal(await previewDoubleStrike.evaluate((span) => getComputedStyle(span).textDecorationLine), "line-through");
  assert.equal(await previewDoubleStrike.evaluate((span) => getComputedStyle(span).textDecorationStyle), "double");
  const previewDarkCyanHighlight = page.locator('.page-body mark[data-highlight="darkCyan"]').filter({ hasText: "突出显示工具" }).first();
  await previewDarkCyanHighlight.waitFor();
  // 中文注解：分页器可能在等待期间替换片段节点，从当前已连接节点中取样，避免读取到脱离文档后的空计算样式。
  await page.waitForFunction(() => Array.from(document.querySelectorAll('.page-body mark[data-highlight="darkCyan"]'))
    .some((mark) => mark.isConnected && mark.textContent?.includes("突出显示工具") && getComputedStyle(mark).backgroundColor === "rgb(0, 128, 128)"));
  const previewHighlightColor = await page.evaluate(() => Array.from(document.querySelectorAll('.page-body mark[data-highlight="darkCyan"]'))
    .find((mark) => mark.isConnected && mark.textContent?.includes("突出显示工具"))
    ? getComputedStyle(Array.from(document.querySelectorAll('.page-body mark[data-highlight="darkCyan"]')).find((mark) => mark.isConnected && mark.textContent?.includes("突出显示工具"))).backgroundColor
    : "");
  assert.equal(previewHighlightColor, "rgb(0, 128, 128)");

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
        const overflowingColumn = Array.from(body?.querySelectorAll(".page-column") || []).some((column) => column.scrollHeight > column.clientHeight + 1);
        return overflowingColumn ? index + 1 : null;
      }).filter(Boolean),
      sectionIndexes: pages.map((page) => Number(page.getAttribute("data-section-index") || 0)),
      pageSizes: pages.map((page) => ({ width: Math.round(page.getBoundingClientRect().width), height: Math.round(page.getBoundingClientRect().height) })),
      pageMarginLefts: pages.map((page) => Number.parseFloat(getComputedStyle(page).getPropertyValue("--page-margin-left"))),
      secondSectionColumns: (() => {
        const page = pages.find((item) => item.getAttribute("data-section-index") === "1");
        const body = page?.querySelector(".page-body");
        const columns = Array.from(body?.querySelectorAll(".page-column") || []);
        const separator = body?.querySelector(".page-column-separator");
        return body ? {
          widths: columns.map((column) => Math.round(column.getBoundingClientRect().width * 100) / 100),
          separatorStyle: separator ? getComputedStyle(separator).borderLeftStyle : "none",
          separatorLeft: separator ? Math.round(separator.getBoundingClientRect().left * 100) / 100 : 0
        } : null;
      })(),
      secondSectionPageFrame: (() => {
        const page = pages.find((item) => item.getAttribute("data-section-index") === "1");
        const body = page?.querySelector(".page-body");
        const frame = page ? getComputedStyle(page, "::after") : null;
        const bodyStyle = body ? getComputedStyle(body) : null;
        return frame && bodyStyle ? {
          borderStyle: frame.borderTopStyle,
          borderWidth: frame.borderTopWidth,
          borderColor: frame.borderTopColor,
          insetTop: frame.top,
          contentPaddingTop: Number.parseFloat(bodyStyle.paddingTop)
        } : null;
      })(),
      firstPageHasList: Boolean(pages[0]?.querySelector("ol")),
      firstPageText: pages[0]?.textContent || "",
      firstPageRemainingHeight: (() => {
        const page = pages[0];
        const body = page?.querySelector(".page-body");
        const available = page ? Number.parseFloat(getComputedStyle(page).getPropertyValue("--page-content-height")) : 0;
        return body ? Math.max(0, available - body.scrollHeight) : 0;
      })(),
      continuationMarkers: Array.from(document.querySelectorAll(".pagination-list-continuation > li")).map((item) => getComputedStyle(item).listStyleType),
      listMarginLeft: getComputedStyle(document.querySelector(".page-body ol")).marginLeft,
      sourceListItemMarginBottom: getComputedStyle(document.querySelector(".word-editor ol > li")).marginBottom,
      firstFragmentMarginBottom: getComputedStyle(document.querySelector(".page-body ol > li")).marginBottom,
      secondListStart: Array.from(document.querySelectorAll(".page-body ol")).find((list) => list.textContent?.includes("第二个编号项"))?.getAttribute("start") || "1",
      sourceOrderedListStyle: getComputedStyle(document.querySelector(".word-editor ol")).listStyleType,
      previewOrderedListStyle: getComputedStyle(Array.from(document.querySelectorAll(".page-body ol")).find((list) => list.textContent?.includes("第二个编号项"))).listStyleType,
      sourceListText: sourceListItems[0]?.textContent || "",
      previewListText: previewListItems.filter((item) => !item.textContent?.includes("第二个编号项")).map((item) => item.textContent || "").join(""),
      sourceCells,
      previewCells: [0, 1].map((cellIndex) => previewLongRows.map((row) => row.querySelectorAll("td, th")[cellIndex]?.textContent || "").join("")),
      tableContinuationCount: document.querySelectorAll(".pagination-table-continuation").length,
      sourceTableImageCount: document.querySelectorAll(".word-editor table img").length,
      previewTableImageCount: document.querySelectorAll(".page-body table img").length,
      previewRowSpanCount: document.querySelectorAll('.page-body td[rowspan="2"]').length,
      repeatedHeaderCount: document.querySelectorAll(".page-body .pagination-repeated-header").length,
      repeatedHeaderHeights: Array.from(document.querySelectorAll(".page-body .pagination-repeated-header")).map((row) => (row instanceof HTMLElement ? row.style.height : "")),
      sourceTabCount: document.querySelectorAll(".word-editor .docx-tab").length,
      previewTabCount: document.querySelectorAll(".page-body .docx-tab").length,
      previewTabWidths: Array.from(document.querySelectorAll(".page-body .docx-tab")).map((tab) => tab.getBoundingClientRect().width),
      tableGeometry: (() => {
        // 中文注解：分页拆表会产生多个等价克隆，选择右侧剩余空间最大的完整片段，避免续页片段的临时几何干扰对齐检查。
        const preview = Array.from(document.querySelectorAll(".page-body table"))
          .filter((table) => table.textContent?.includes("商务评审"))
          .sort((left, right) => Number.parseFloat(getComputedStyle(right).marginRight) - Number.parseFloat(getComputedStyle(left).marginRight))[0];
        const widths = (table) => table ? Array.from(table.querySelectorAll("tr:first-child > th, tr:first-child > td")).map((cell) => Math.round(cell.getBoundingClientRect().width)) : [];
        return {
          previewWidth: preview ? Math.round(preview.getBoundingClientRect().width) : 0,
          previewColumns: widths(preview),
          alignment: preview?.getAttribute("data-table-alignment") || "",
          indent: preview?.getAttribute("data-table-indent") || "",
          spacing: preview?.getAttribute("data-table-cell-spacing") || "",
          borderCollapse: preview ? getComputedStyle(preview).borderCollapse : "",
          borderSpacing: preview ? getComputedStyle(preview).borderSpacing : "",
          marginLeft: preview ? Number.parseFloat(getComputedStyle(preview).marginLeft) : 0,
          marginRight: preview ? Number.parseFloat(getComputedStyle(preview).marginRight) : 0
        };
      })(),
      previewBusinessCellFormat: (() => {
        const cell = Array.from(document.querySelectorAll(".page-body td, .page-body th")).find((item) => item.textContent?.includes("商务评审"));
        const style = cell ? getComputedStyle(cell) : null;
        return style ? {
          paddingTop: style.paddingTop,
          paddingRight: style.paddingRight,
          paddingBottom: style.paddingBottom,
          paddingLeft: style.paddingLeft,
          verticalAlign: style.verticalAlign,
          writingMode: style.writingMode,
          backgroundColor: style.backgroundColor,
          borderTopStyle: style.borderTopStyle,
          borderTopWidth: style.borderTopWidth,
          borderTopColor: style.borderTopColor
        } : null;
      })(),
      paginationControlStartsPage: Array.from(document.querySelectorAll(".page-sheet")).some((page) => {
        const blocks = Array.from(page.querySelectorAll(":scope > .page-body > .page-column > .page-block"));
        return blocks[0]?.textContent?.includes("分页控制段落") && !page.textContent?.includes("分页控制前置段落");
      }),
      paginationControlKeepsNext: Array.from(document.querySelectorAll(".page-sheet")).some((page) => page.textContent?.includes("分页控制段落") && page.textContent?.includes("分页控制后续段落")),
      columnBreakPlacement: (() => {
        const page = Array.from(document.querySelectorAll('.page-sheet[data-section-index="1"]')).find((item) => item.textContent?.includes("第二节横向内容"));
        const columns = page ? Array.from(page.querySelectorAll(".page-column")) : [];
        return {
          samePage: Boolean(page?.textContent?.includes("分栏符后内容")),
          beforeColumn: columns.findIndex((column) => column.textContent?.includes("第二节横向内容")),
          afterColumn: columns.findIndex((column) => column.textContent?.includes("分栏符后内容"))
        };
      })(),
      specialHyphenPreviewText: Array.from(document.querySelectorAll(".page-body p")).find((paragraph) => paragraph.textContent?.includes("特殊连字符工具"))?.textContent || "",
      manualLineBreakPreviewHtml: Array.from(document.querySelectorAll(".page-body p")).find((paragraph) => paragraph.textContent?.includes("手动换行工具"))?.innerHTML || "",
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
  assert.ok(result.firstPageHasList || result.firstPageRemainingHeight < 24, `第一页应开始编号列表或仅剩不足一行空间，剩余 ${result.firstPageRemainingHeight}px，实际内容：${result.firstPageText.slice(0, 120)}`);
  assert.ok(result.continuationMarkers.length > 0);
  assert.ok(result.continuationMarkers.every((marker) => marker === "none"));
  assert.equal(result.listMarginLeft, "48px");
  assert.equal(result.sourceListItemMarginBottom, "5.33px");
  assert.equal(result.firstFragmentMarginBottom, "0px");
  assert.equal(result.secondListStart, "5");
  assert.equal(result.sourceOrderedListStyle, "upper-roman");
  assert.equal(result.previewOrderedListStyle, "upper-roman");
  assert.equal(result.previewListText, result.sourceListText);
  assert.deepEqual(result.previewCells, result.sourceCells);
  assert.ok(result.tableContinuationCount > 0);
  assert.equal(result.sourceTableImageCount, 1);
  assert.equal(result.previewTableImageCount, 1);
  assert.ok(result.previewRowSpanCount > 0, "分页预览应保留纵向合并单元格");
  assert.ok(result.repeatedHeaderCount > 0, "跨页表格应在后续页面重复在线设置的标题行");
  assert.ok(result.repeatedHeaderHeights.every((height) => height === "56.67px"), "重复标题行应保留在线设置的固定行高");
  assert.equal(result.previewTabCount, result.sourceTabCount, "分页预览应完整保留在线编辑器中的制表位");
  assert.ok(result.previewTabWidths.every((width) => width >= 2), "分页预览中的制表位应按 Word 位置完成布局");
  // 中文注解：两列网格宽 480px，separate 模式还包含左右和列间共三个 8px 间距，外框应为 504px。
  assert.equal(result.tableGeometry.previewWidth, 504, `分页表格几何异常: ${JSON.stringify(result.tableGeometry)}`);
  assert.deepEqual(result.tableGeometry.previewColumns, [120, 360]);
  assert.equal(result.tableGeometry.alignment, "left");
  assert.equal(result.tableGeometry.indent, "567");
  assert.equal(result.tableGeometry.spacing, "120");
  assert.equal(result.tableGeometry.borderCollapse, "separate");
  assert.equal(result.tableGeometry.borderSpacing, "8px");
  assert.ok(Math.abs(result.tableGeometry.marginLeft - 37.8) < 0.2);
  assert.ok(result.tableGeometry.marginRight > 50);
  assert.deepEqual(result.previewBusinessCellFormat, {
    paddingTop: "12px",
    paddingRight: "12px",
    paddingBottom: "12px",
    paddingLeft: "12px",
    verticalAlign: "bottom",
    writingMode: "sideways-lr",
    backgroundColor: "rgb(255, 242, 204)",
    borderTopStyle: "dashed",
    borderTopWidth: "1px",
    borderTopColor: "rgb(107, 114, 128)"
  });
  assert.equal(result.paginationControlStartsPage, true, "段前分页段落应成为新页首段");
  assert.equal(result.paginationControlKeepsNext, true, "与下段同页应保留后续段落在同一页");
  assert.deepEqual(result.columnBreakPlacement, { samePage: true, beforeColumn: 0, afterColumn: 1 }, "分栏符应把后续内容推进到同页下一栏");
  assert.equal(result.specialHyphenPreviewText, "特殊连字符工具 inter\u00ADnational code\u20112026", "分页预览应保留两类特殊连字符的换行语义");
  assert.match(result.manualLineBreakPreviewHtml, /第一行[\s\S]*?<br[^>]*>[\s\S]*?第二行/, "分页预览应保留 Shift+Enter 手动换行");
  assert.ok(result.widowFragmentLineCounts.length > 1, "孤行控制夹具应跨越多个页面");
  assert.ok(result.widowFragmentLineCounts.every((lines) => lines >= 2), "孤行控制段落的每个分页片段都应至少保留两行");
  assert.equal(result.widowPreviewText, widowText);
  assert.equal(result.templateLabelVisible, true);
  assert.equal(result.fontVariable, '"SimSun"');
  assert.equal(result.lineVariable, "1.5833");
  const secondSectionFirstPage = result.sectionIndexes.indexOf(1);
  assert.ok(secondSectionFirstPage > 0);
  assert.deepEqual(result.pageSizes[secondSectionFirstPage], { width: 1344, height: 816 });
  assert.ok(Math.abs(result.pageMarginLefts[secondSectionFirstPage] - 133.8) < 0.1, "第二节有效左边距应包含 1 厘米装订线");
  assert.equal(result.secondSectionColumns?.widths.length, 2);
  assert.ok(Math.abs((result.secondSectionColumns?.widths[0] || 0) - 199.93) < 0.2);
  assert.ok(Math.abs((result.secondSectionColumns?.widths[1] || 0) - 700.33) < 0.2);
  assert.equal(result.secondSectionColumns?.separatorStyle, "solid");
  assert.deepEqual({
    borderStyle: result.secondSectionPageFrame?.borderStyle,
    borderWidth: result.secondSectionPageFrame?.borderWidth,
    borderColor: result.secondSectionPageFrame?.borderColor,
    insetTop: result.secondSectionPageFrame?.insetTop
  }, { borderStyle: "double", borderWidth: "2px", borderColor: "rgb(31, 78, 121)", insetTop: "32px" });
  assert.ok((result.secondSectionPageFrame?.contentPaddingTop || 0) > 100, "垂直居中的短节内容应在分页预览中下移");
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
  documentUpdatesFrozen = true;
  while (activeSaveRequestCount > 0) await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
  const legacySectionLayout = { ...storedSectionLayout, pageNumberEnabled: false, pageNumberPosition: "footer" };
  delete legacySectionLayout.headerPageNumberTemplate;
  delete legacySectionLayout.footerPageNumberTemplate;
  const encodedLegacyLayout = JSON.stringify(legacySectionLayout).replaceAll("&", "&amp;").replaceAll('"', "&quot;");
  storedDocument.content = storedDocument.content.replace(/data-section-layout="[^"]+"/, `data-section-layout="${encodedLegacyLayout}"`);
  await page.reload({ waitUntil: "networkidle" });
  await page.getByText(storedDocument.title, { exact: true }).click();
  await editor.waitFor();
  await page.getByRole("tab", { name: "文档" }).click();
  await page.getByRole("button", { name: "分页", exact: true }).click();
  await page.locator(".page-sheet").first().waitFor();
  await page.waitForFunction(() => Array.from(document.querySelectorAll(".page-sheet")).some((page) => page.getAttribute("data-section-index") === "1"));
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
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  for (const ribbonTab of ["开始", "格式", "插入", "布局", "审阅", "文档"]) {
    await page.getByRole("tab", { name: ribbonTab }).click();
    const geometry = await page.locator(".format-bar").evaluate((bar) => ({ clientWidth: bar.clientWidth, scrollWidth: bar.scrollWidth }));
    assert.equal(geometry.scrollWidth, geometry.clientWidth, `移动端${ribbonTab}功能区不应产生横向滚动`);
  }
  await page.getByRole("tab", { name: "文档" }).click();
  const mobile = await page.evaluate(() => {
    const scroll = document.querySelector(".editor-scroll");
    const ribbon = document.querySelector(".format-bar");
    const tabRows = new Set(Array.from(document.querySelectorAll(".ribbon-tabs [role='tab']")).map((tab) => Math.round(tab.getBoundingClientRect().top)));
    return {
      viewportWidth: document.documentElement.clientWidth,
      scrollClientWidth: scroll?.clientWidth || 0,
      scrollWidth: scroll?.scrollWidth || 0,
      ribbonClientWidth: ribbon?.clientWidth || 0,
      ribbonScrollWidth: ribbon?.scrollWidth || 0,
      tabRowCount: tabRows.size
    };
  });
  assert.equal(mobile.viewportWidth, 390);
  assert.ok(mobile.scrollClientWidth <= 390);
  assert.ok(mobile.scrollWidth > mobile.scrollClientWidth);
  assert.equal(mobile.ribbonScrollWidth, mobile.ribbonClientWidth, "移动端功能区不应产生横向滚动");
  assert.ok(mobile.tabRowCount <= 2, `移动端功能页签不应占用超过两行，实际为 ${mobile.tabRowCount} 行`);
  await page.getByText("页面设置", { exact: true }).click();
  const mobilePageSettings = await page.locator(".page-layout-popover").boundingBox();
  assert.ok(mobilePageSettings && mobilePageSettings.x >= 0 && mobilePageSettings.y >= 0);
  assert.ok(mobilePageSettings.x + mobilePageSettings.width <= 390 && mobilePageSettings.y + mobilePageSettings.height <= 844);
  await page.getByLabel("关闭页面设置", { exact: true }).click();
  assert.equal(await page.locator(".page-layout-popover").isVisible(), false);
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await editor.locator("td").first().click();
  const sectionCountBeforeNestedInsert = await editor.locator(":scope > .section-break-marker").count();
  await page.getByRole("button", { name: "分节符", exact: true }).evaluate((button) => button.click());
  // 中文注解：从表格单元格插入时也必须提升为正文顶层节点，否则预览和导出都无法拆节。
  assert.equal(await editor.locator(":scope > .section-break-marker").count(), sectionCountBeforeNestedInsert + 1);
  assert.equal(await editor.locator("table .section-break-marker, li .section-break-marker").count(), 0);
  documentUpdatesFrozen = false;
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "生成正文", exact: true }).click();
  await page.waitForFunction(() => document.querySelector(".word-editor")?.textContent?.includes("AI 自动生成的正文段落。"));
  while (!storedDocument.content.includes("AI 自动生成的正文段落。")) await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
  const generatedEditorHtml = await editor.innerHTML();
  // 中文注解：前端必须优先采用服务端结构化 HTML，并在保存后保留标题与正文排版，而不是再次降级成无样式纯文本。
  assert.match(generatedEditorHtml, /<h2[^>]+data-outline-level="1"[^>]+data-keep-next="true"[^>]*>[\s\S]*?AI 自动格式标题[\s\S]*?<\/h2>/);
  assert.match(generatedEditorHtml, /<p[^>]+data-indent="1"[^>]*>[\s\S]*?font-weight:\s*600[\s\S]*?AI 自动生成的正文段落。[\s\S]*?<\/p>/);
  assert.match(storedDocument.content, /data-indent="1"/);
  await page.reload({ waitUntil: "networkidle" });
  await page.getByText(storedDocument.title, { exact: true }).click();
  await editor.waitFor();
  assert.match(await editor.innerHTML(), /<p[^>]+data-indent="1"[^>]*>[\s\S]*?AI 自动生成的正文段落。[\s\S]*?<\/p>/);
  assert.deepEqual(browserErrors, []);

  console.log("Editor workflow browser check passed");
} finally {
  await browser.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}
