import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { chromium } from "playwright";
import { playwrightLaunchOptions } from "./playwright-browser.mjs";
import JSZip from "jszip";
import { createDocxBuffer } from "../server/index.js";

const distRoot = resolve("dist");
const fixtureDocument = {
  id: 9101,
  title: "新增文本格式继承检查",
  documentType: "工作总结",
  tone: "正式",
  templateId: null,
  outline: [],
  // 中文注解：同时设置块级缩进与字符格式，确保回归能捕获任意一类上下文格式丢失。
  content: '<p data-indent="2" style="line-height: 1.8; text-align: justify; margin-left: 12pt"><span style="font-family: SimSun; font-size: 18pt; color: #C00000; font-weight: bold">已有格式文本</span></p>',
  pageLayout: null,
  status: "draft",
  wordCount: 6,
  updatedAt: new Date().toISOString()
};

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml"
};

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

const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", "http://127.0.0.1");
  if (request.method === "GET" && url.pathname === "/api/session") {
    sendJson(response, { user: { userId: "insert-format-test", isMolingUser: false }, points: { enabled: false, entitlements: [], remaining: null } });
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/documents") {
    sendJson(response, { documents: [fixtureDocument] });
    return;
  }
  if (request.method === "GET" && url.pathname === `/api/documents/${fixtureDocument.id}`) {
    sendJson(response, { document: fixtureDocument });
    return;
  }
  if (request.method === "PATCH" && url.pathname === `/api/documents/${fixtureDocument.id}`) {
    Object.assign(fixtureDocument, await readJsonBody(request), { updatedAt: new Date().toISOString() });
    sendJson(response, { document: fixtureDocument });
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/ai/edit") {
    const body = await readJsonBody(request);
    const content = body.action === "continue"
      ? "AI插入文本\nAI插入第二行"
      : body.action === "expand" ? "AI替换第一行\nAI替换第二行" : "AI替换文本";
    sendJson(response, { content });
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/templates") {
    sendJson(response, { templates: [] });
    return;
  }

  const requestedPath = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/, "");
  let filePath = resolve(distRoot, requestedPath);
  // 中文注解：测试服务器只允许读取构建目录，避免请求路径越界访问工作区文件。
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
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: "networkidle" });
  await page.getByText(fixtureDocument.title, { exact: true }).click();
  const editor = page.locator(".word-editor");
  await editor.waitFor();

  await page.evaluate(() => {
    const source = Array.from(document.querySelectorAll(".word-editor p")).find((node) => node.textContent === "已有格式文本");
    if (!source) throw new Error("找不到格式继承测试段落");
    const range = document.createRange();
    range.selectNodeContents(source);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    source.closest(".word-editor")?.focus();
    document.dispatchEvent(new Event("selectionchange", { bubbles: true }));
  });
  await page.keyboard.press("Enter");
  await page.keyboard.type("新插入文本");

  const insertedStyle = await page.evaluate(() => {
    const paragraph = Array.from(document.querySelectorAll(".word-editor p")).find((node) => node.textContent === "新插入文本");
    if (!paragraph) throw new Error("新插入文本没有生成独立段落");
    const textNode = Array.from(paragraph.querySelectorAll("span")).find((node) => node.textContent?.includes("新插入文本")) || paragraph;
    const computed = getComputedStyle(textNode);
    return {
      indent: paragraph.getAttribute("data-indent"),
      fontFamily: computed.fontFamily,
      fontSize: computed.fontSize,
      color: computed.color,
      fontWeight: computed.fontWeight,
      textAlign: getComputedStyle(paragraph).textAlign,
      marginLeft: getComputedStyle(paragraph).marginLeft,
      html: paragraph.outerHTML
    };
  });

  assert.equal(insertedStyle.indent, "2", `新段落应继承缩进，实际 HTML：${insertedStyle.html}`);
  assert.match(insertedStyle.fontFamily, /SimSun/i, `新文本应继承字体，实际 HTML：${insertedStyle.html}`);
  assert.equal(insertedStyle.fontSize, "24px", `新文本应继承 18pt 字号，实际 HTML：${insertedStyle.html}`);
  assert.equal(insertedStyle.color, "rgb(192, 0, 0)", `新文本应继承字体颜色，实际 HTML：${insertedStyle.html}`);
  assert.equal(insertedStyle.fontWeight, "700", `新文本应继承粗体，实际 HTML：${insertedStyle.html}`);
  assert.equal(insertedStyle.textAlign, "justify", `新段落应继承对齐方式，实际 HTML：${insertedStyle.html}`);
  assert.equal(insertedStyle.marginLeft, "16px", `新段落应继承左缩进，实际 HTML：${insertedStyle.html}`);
  assert.match(insertedStyle.html, /line-height:\s*1.8/i, `新段落应继承行距，实际 HTML：${insertedStyle.html}`);

  await page.evaluate(() => {
    const root = document.querySelector(".word-editor");
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node && !node.nodeValue?.includes("新插入文本")) node = walker.nextNode();
    if (!node) throw new Error("找不到 AI 插入测试选区");
    const start = node.nodeValue.indexOf("新插入文本");
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, start + "新插入文本".length);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    root?.focus();
    document.dispatchEvent(new Event("selectionchange", { bubbles: true }));
  });
  await page.getByRole("button", { name: "续写选中文本", exact: true }).click();
  await page.getByText("AI 处理结果", { exact: true }).waitFor();
  await page.getByRole("button", { name: "插入下方", exact: true }).click();

  const aiInsertedStyle = await page.evaluate(() => {
    const paragraph = Array.from(document.querySelectorAll(".word-editor p")).find((node) => node.textContent === "AI插入文本");
    if (!paragraph) throw new Error("AI 结果没有插入为独立段落");
    const textNode = Array.from(paragraph.querySelectorAll("span")).find((node) => node.textContent?.includes("AI插入文本")) || paragraph;
    const computed = getComputedStyle(textNode);
    return {
      indent: paragraph.getAttribute("data-indent"),
      fontFamily: computed.fontFamily,
      fontSize: computed.fontSize,
      color: computed.color,
      fontWeight: computed.fontWeight,
      textAlign: getComputedStyle(paragraph).textAlign,
      marginLeft: getComputedStyle(paragraph).marginLeft,
      html: paragraph.outerHTML
    };
  });
  assert.equal(aiInsertedStyle.indent, "2", `AI 插入段落应继承缩进，实际 HTML：${aiInsertedStyle.html}`);
  assert.match(aiInsertedStyle.fontFamily, /SimSun/i, `AI 插入文本应继承字体，实际 HTML：${aiInsertedStyle.html}`);
  assert.equal(aiInsertedStyle.fontSize, "24px", `AI 插入文本应继承 18pt 字号，实际 HTML：${aiInsertedStyle.html}`);
  assert.equal(aiInsertedStyle.color, "rgb(192, 0, 0)", `AI 插入文本应继承字体颜色，实际 HTML：${aiInsertedStyle.html}`);
  assert.equal(aiInsertedStyle.fontWeight, "700", `AI 插入文本应继承粗体，实际 HTML：${aiInsertedStyle.html}`);
  assert.equal(aiInsertedStyle.textAlign, "justify", `AI 插入段落应继承对齐方式，实际 HTML：${aiInsertedStyle.html}`);
  assert.equal(aiInsertedStyle.marginLeft, "16px", `AI 插入段落应继承左缩进，实际 HTML：${aiInsertedStyle.html}`);
  assert.match(aiInsertedStyle.html, /line-height:\s*1.8/i, `AI 插入段落应继承行距，实际 HTML：${aiInsertedStyle.html}`);
  const secondAiInsertedHtml = await page.locator(".word-editor p", { hasText: "AI插入第二行" }).evaluate((node) => node.outerHTML);
  assert.match(secondAiInsertedHtml, /data-indent="2"/, `AI 多行结果的每一段都应继承缩进：${secondAiInsertedHtml}`);
  assert.match(secondAiInsertedHtml, /font-family:\s*SimSun/i, `AI 多行结果的每一段都应继承字符格式：${secondAiInsertedHtml}`);

  await page.evaluate(() => {
    const root = document.querySelector(".word-editor");
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node && !node.nodeValue?.includes("已有格式文本")) node = walker.nextNode();
    if (!node) throw new Error("找不到 AI 替换测试选区");
    const range = document.createRange();
    range.setStart(node, 0);
    range.setEnd(node, node.nodeValue?.length || 0);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    root?.focus();
    document.dispatchEvent(new Event("selectionchange", { bubbles: true }));
  });
  await page.getByRole("button", { name: "润色选中文本", exact: true }).click();
  await page.getByText("AI 处理结果", { exact: true }).waitFor();
  await page.getByRole("button", { name: "替换原文", exact: true }).click();
  const replacedHtml = await page.locator(".word-editor p", { hasText: "AI替换文本" }).evaluate((node) => node.outerHTML);
  assert.match(replacedHtml, /data-indent="2"/, `AI 替换后应保留段落格式：${replacedHtml}`);
  assert.match(replacedHtml, /font-family:\s*SimSun/i, `AI 替换后应保留字体：${replacedHtml}`);
  assert.match(replacedHtml, /font-size:\s*18pt/i, `AI 替换后应保留字号：${replacedHtml}`);
  assert.match(replacedHtml, /color:\s*rgb\(192, 0, 0\)/i, `AI 替换后应保留颜色：${replacedHtml}`);

  const replacementParagraph = page.locator(".word-editor p", { hasText: "AI替换文本" });
  await replacementParagraph.click();
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+End");
  await page.getByRole("button", { name: "扩写选中文本", exact: true }).click();
  await page.getByText("AI 处理结果", { exact: true }).waitFor();
  await page.getByRole("button", { name: "替换原文", exact: true }).click();
  for (const line of ["AI替换第一行", "AI替换第二行"]) {
    const lineHtml = await page.locator(".word-editor p", { hasText: line }).evaluate((node) => node.outerHTML);
    assert.match(lineHtml, /data-indent="2"/, `AI 多行替换的每一段都应继承缩进：${lineHtml}`);
    assert.match(lineHtml, /font-family:\s*SimSun/i, `AI 多行替换的每一段都应继承字符格式：${lineHtml}`);
  }

  await page.evaluate(() => {
    const root = document.querySelector(".word-editor");
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node && !node.nodeValue?.includes("AI替换第一行")) node = walker.nextNode();
    if (!node) throw new Error("找不到粘贴格式测试位置");
    const range = document.createRange();
    range.selectNodeContents(node);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    root?.focus();
    document.dispatchEvent(new Event("selectionchange", { bubbles: true }));
  });
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: `http://127.0.0.1:${address.port}` });
  await page.evaluate(() => navigator.clipboard.writeText("粘贴文本"));
  await page.keyboard.press("Control+V");
  const pastedHtml = await page.locator(".word-editor p", { hasText: "AI替换第一行粘贴文本" }).evaluate((node) => node.outerHTML);
  assert.match(pastedHtml, /font-family:\s*SimSun/i, `纯文本粘贴应继承当前字体：${pastedHtml}`);
  assert.match(pastedHtml, /font-size:\s*18pt/i, `纯文本粘贴应继承当前字号：${pastedHtml}`);
  assert.match(pastedHtml, /color:\s*rgb\(192, 0, 0\)/i, `纯文本粘贴应继承当前颜色：${pastedHtml}`);

  const saveDeadline = Date.now() + 5000;
  while (!fixtureDocument.content.includes("粘贴文本") && Date.now() < saveDeadline) await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
  assert.ok(fixtureDocument.content.includes("粘贴文本"), "新增内容及继承格式应进入自动保存数据");
  await page.reload({ waitUntil: "networkidle" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByText(fixtureDocument.title, { exact: true }).click();
  await page.locator(".word-editor").waitFor();
  const reopenedHtml = await page.locator(".word-editor p", { hasText: "AI替换第一行粘贴文本" }).evaluate((node) => node.outerHTML);
  // 中文注解：窄屏重开使用真实保存 HTML，验证格式继承不依赖桌面端临时 DOM 或工具栏宽度。
  assert.match(reopenedHtml, /data-indent="2"/, `保存重开后应保留缩进：${reopenedHtml}`);
  assert.match(reopenedHtml, /font-family:\s*SimSun/i, `保存重开后应保留字符格式：${reopenedHtml}`);

  const docxBuffer = await createDocxBuffer({ title: fixtureDocument.title, content: fixtureDocument.content });
  const archive = await JSZip.loadAsync(docxBuffer);
  const documentXml = await archive.file("word/document.xml")?.async("string") || "";
  const aiParagraphXml = (documentXml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g) || []).find((paragraph) => paragraph.includes("AI插入文本")) || "";
  const aiRunXml = (aiParagraphXml.match(/<w:r(?:\s[^>]*)?>[\s\S]*?<\/w:r>/g) || []).find((run) => run.includes("AI插入文本")) || "";
  assert.match(aiParagraphXml, /<w:ind(?=[^>]+w:firstLine="880")(?=[^>]+w:left="240")[^>]*\/>/, "Word 导出应保留首行缩进和左缩进");
  assert.match(aiParagraphXml, /<w:jc w:val="both"\/>/, "Word 导出应保留两端对齐");
  assert.match(aiRunXml, /<w:rFonts[^>]+w:ascii="SimSun"/, "Word 导出应保留字体");
  assert.match(aiRunXml, /<w:sz w:val="36"\/>/, "Word 导出应保留 18pt 字号");
  assert.match(aiRunXml, /<w:color w:val="C00000"\/>/, "Word 导出应保留字体颜色");
  console.log("新增文本上下文格式继承检查通过。", insertedStyle);
} finally {
  await browser.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}
