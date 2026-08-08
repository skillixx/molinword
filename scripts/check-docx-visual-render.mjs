import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import JSZip from "jszip";
import { chromium } from "playwright";
import { createDocxBuffer } from "../server/index.js";
import { buildFormalTemplateContent } from "../shared/document-template.js";

const maximumToolOutputBytes = 8 * 1024 * 1024;
const maximumRenderedPageBytes = 16 * 1024 * 1024;
const toolTimeoutMs = 120_000;
const expectedTextFragments = [
  "商业化评审报告",
  "文档信息",
  "执行摘要",
  "实施计划",
  "风险控制",
  "任务/交付物",
  "验收标准"
];

function visualError(message, detailCode = "docx-visual-render-failed") {
  return Object.assign(new Error(message), { detailCode });
}

function parseArguments(argumentsList) {
  const unsupported = argumentsList.filter((argument) => argument !== "--self-test" && !argument.startsWith("--output-dir="));
  const outputArguments = argumentsList.filter((argument) => argument.startsWith("--output-dir="));
  if (unsupported.length || outputArguments.length > 1 || argumentsList.filter((argument) => argument === "--self-test").length > 1) {
    throw visualError("仅支持 --self-test 与 --output-dir=<目录>。", "invalid-visual-render-arguments");
  }
  const outputDirectory = outputArguments[0]?.slice("--output-dir=".length);
  if (outputArguments.length && !outputDirectory) throw visualError("视觉验收输出目录不能为空。", "invalid-visual-render-arguments");
  return { selfTest: argumentsList.includes("--self-test"), outputDirectory };
}

function runExternal(command, argumentsList, { cwd } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, argumentsList, {
      cwd,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const stdout = [];
    const stderr = [];
    let outputBytes = 0;
    let finished = false;
    let timer;
    const fail = (error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      child.kill("SIGKILL");
      reject(error);
    };
    const collect = (target) => (chunk) => {
      outputBytes += chunk.byteLength;
      if (outputBytes > maximumToolOutputBytes) {
        fail(visualError("Office 渲染工具输出超过安全上限。", "visual-render-output-too-large"));
        return;
      }
      target.push(Buffer.from(chunk));
    };
    child.stdout.on("data", collect(stdout));
    child.stderr.on("data", collect(stderr));
    child.once("error", (error) => fail(visualError(
      error?.code === "ENOENT" ? `缺少视觉验收工具：${path.basename(command)}` : "无法启动视觉验收工具。",
      error?.code === "ENOENT" ? "visual-render-tool-missing" : "visual-render-tool-start-failed"
    )));
    child.once("close", (code, signal) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      const stdoutText = Buffer.concat(stdout).toString("utf8");
      const stderrText = Buffer.concat(stderr).toString("utf8");
      if (code !== 0) {
        reject(visualError(`视觉验收工具执行失败（exit=${code ?? "null"}, signal=${signal || "none"}）：${stderrText.slice(0, 500)}`, "visual-render-tool-failed"));
        return;
      }
      resolve({ stdout: stdoutText, stderr: stderrText });
    });
    timer = setTimeout(() => fail(visualError("视觉验收工具执行超时。", "visual-render-tool-timeout")), toolTimeoutMs);
  });
}

function buildVisualFixtureContent() {
  return buildFormalTemplateContent({
    name: "商业计划书",
    category: "商业经营",
    documentType: "商业计划书",
    topic: "商业化评审报告",
    requirement: "验证正式模板的标题、表格、分页、页边距和字体颜色。",
    outline: [
      "一、执行摘要",
      "二、市场机会",
      "三、商业模式",
      "四、实施计划",
      "五、里程碑安排",
      "六、预算与收益",
      "七、风险控制",
      "八、行动安排"
    ]
  });
}

async function createVisualFixtureBuffer() {
  return createDocxBuffer({
    title: "商业化评审报告",
    content: buildVisualFixtureContent(),
    // 中文注解：故意传入绿色模板强调色，渲染结果仍必须保持标题和章节为规范黑色，用于复现并防止历史绿色字体问题回归。
    templateStyle: {
      fontFamily: "Noto Sans CJK SC",
      accentColor: "#00A651",
      titleColor: "#00A651",
      headingColor: "#00A651",
      bodySize: 22,
      titleSize: 36,
      headingSize: 28,
      lineSpacing: 360
    },
    pageLayout: {
      headerText: "墨灵 Word · 商业计划书",
      headerStyle: { alignment: "right", fontFamily: "Noto Sans CJK SC", fontSizePt: 9, color: "#000000" },
      footerText: "内部评审",
      footerPageNumberTemplate: "第 {PAGE} 页 / 共 {NUMPAGES} 页",
      footerStyle: { alignment: "center", fontFamily: "Noto Sans CJK SC", fontSizePt: 9, color: "#000000" },
      pageNumberEnabled: true,
      // 中文注解：显式固定 Word 使用的 A4 DXA 尺寸，避免依赖默认值后发生页面几何漂移。
      paperSize: { width: 11906, height: 16838 }
    }
  });
}

async function inspectVisualFixtureStructure(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const documentXml = await zip.file("word/document.xml")?.async("string") || "";
  const stylesXml = await zip.file("word/styles.xml")?.async("string") || "";
  const titleStyle = stylesXml.match(/<w:style(?=[^>]+w:styleId="Title")[^>]*>[\s\S]*?<\/w:style>/)?.[0] || "";
  const headingStyles = stylesXml.match(/<w:style(?=[^>]+w:styleId="Heading[1-6]")[^>]*>[\s\S]*?<\/w:style>/g) || [];
  const titleColor = titleStyle.match(/<w:color w:val="([0-9A-Fa-f]{6})"\/>/)?.[1]?.toUpperCase() || "";
  assert.ok(buffer.byteLength > 10_000, "视觉验收夹具必须生成非空 DOCX");
  assert.equal(titleColor, "000000", "Title 样式必须固定为黑色");
  assert.equal(headingStyles.length, 6, "必须显式覆盖六级标题样式");
  assert.ok(headingStyles.every((style) => /<w:color w:val="000000"\/>/.test(style)), "所有标题样式必须固定为黑色");
  assert.doesNotMatch(`${documentXml}\n${stylesXml}`, /00A651/i, "绿色模板强调色不得进入正文或标题 OOXML");
  assert.match(documentXml, /<w:pgSz(?=[^>]*w:w="11906")(?=[^>]*w:h="16838")[^>]*\/>/, "视觉验收夹具必须显式使用 A4 页面尺寸");
  assert.ok((documentXml.match(/<w:tbl>/g) || []).length >= 4, "视觉验收夹具必须覆盖元数据表和多张行动表");
  for (const fragment of expectedTextFragments) assert.match(documentXml, new RegExp(fragment), `DOCX 必须包含 ${fragment}`);
  return { bytes: buffer.byteLength, titleColor, headingStyles: headingStyles.length };
}

async function runStructuralSelfTest() {
  const report = await inspectVisualFixtureStructure(await createVisualFixtureBuffer());
  console.log("DOCX 视觉渲染夹具自检通过。", report);
}

async function prepareOutputDirectory(requestedOutputDirectory) {
  if (!requestedOutputDirectory) return { directory: await mkdtemp(path.join(tmpdir(), "molinword-docx-visual-")), temporary: true };
  const directory = path.resolve(requestedOutputDirectory);
  // 中文注解：显式输出目录必须由本轮独占创建，禁止复用旧目录或符号链接造成视觉证据混淆。
  try {
    await mkdir(directory);
  } catch (error) {
    if (error?.code === "EEXIST") throw visualError("视觉验收输出目录必须不存在，避免旧产物造成假阳性。", "visual-render-output-already-exists");
    throw error;
  }
  return { directory, temporary: false };
}

async function inspectRenderedPng(page, pngPath) {
  const metadata = await stat(pngPath);
  if (!metadata.isFile() || metadata.size < 1_000 || metadata.size > maximumRenderedPageBytes) {
    throw visualError("渲染页 PNG 体积异常。", "invalid-rendered-page");
  }
  // 中文注解：先按文件元数据限制单页体积，再读入浏览器，避免异常渲染器产物耗尽门禁内存。
  const content = await readFile(pngPath);
  if (content.byteLength !== metadata.size || content.byteLength > maximumRenderedPageBytes) {
    throw visualError("渲染页 PNG 在读取期间发生变化。", "rendered-page-changed");
  }
  const dataUrl = `data:image/png;base64,${content.toString("base64")}`;
  return page.evaluate(async (source) => {
    const image = new Image();
    image.src = source;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let nonWhitePixels = 0;
    let greenPixels = 0;
    let edgePixels = 0;
    let minX = canvas.width;
    let minY = canvas.height;
    let maxX = -1;
    let maxY = -1;
    // 中文注解：248 以上视为纸张白底；绿色阈值同时要求 G 明显高于 R/B，以捕获绿色字体的抗锯齿像素并避免把灰黑文字误报为绿色。
    for (let y = 0; y < canvas.height; y += 1) {
      for (let x = 0; x < canvas.width; x += 1) {
        const offset = (y * canvas.width + x) * 4;
        const red = pixels[offset];
        const green = pixels[offset + 1];
        const blue = pixels[offset + 2];
        const alpha = pixels[offset + 3];
        if (alpha < 16 || (red >= 248 && green >= 248 && blue >= 248)) continue;
        nonWhitePixels += 1;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
        if (green >= 80 && green - red >= 35 && green - blue >= 20) greenPixels += 1;
        if (x < 4 || y < 4 || x >= canvas.width - 4 || y >= canvas.height - 4) edgePixels += 1;
      }
    }
    return { width: canvas.width, height: canvas.height, nonWhitePixels, greenPixels, edgePixels, minX, minY, maxX, maxY };
  }, dataUrl);
}

async function runVisualRender(outputDirectory) {
  const { directory, temporary } = await prepareOutputDirectory(outputDirectory);
  const docxPath = path.join(directory, "molinword-formal-template-visual-qa.docx");
  const pdfPath = path.join(directory, "molinword-formal-template-visual-qa.pdf");
  const pagePrefix = path.join(directory, "page");
  try {
    const docxBuffer = await createVisualFixtureBuffer();
    // 中文注解：真实渲染必须先复用结构门禁，保证报告中的标题颜色来自同一份待渲染 DOCX，而不是固定声明值。
    const structuralReport = await inspectVisualFixtureStructure(docxBuffer);
    await writeFile(docxPath, docxBuffer, { flag: "wx", mode: 0o600 });
    const profileDirectory = path.join(directory, ".libreoffice-profile");
    await mkdir(profileDirectory);
    await runExternal(process.env.SOFFICE_BIN || "soffice", [
      "--headless",
      `-env:UserInstallation=${pathToFileURL(profileDirectory).href}`,
      "--convert-to", "pdf",
      "--outdir", directory,
      docxPath
    ]);
    const pdfMetadata = await stat(pdfPath);
    if (!pdfMetadata.isFile() || pdfMetadata.size < 10_000) throw visualError("LibreOffice 未生成有效 PDF。", "invalid-rendered-pdf");

    const { stdout: pdfInfo } = await runExternal(process.env.PDFINFO_BIN || "pdfinfo", [pdfPath]);
    const pageCount = Number(pdfInfo.match(/^Pages:\s+(\d+)$/m)?.[1] || 0);
    const pageSize = pdfInfo.match(/^Page size:\s+([\d.]+) x ([\d.]+) pts/m);
    if (!Number.isInteger(pageCount) || pageCount < 2 || pageCount > 10) {
      throw visualError("正式模板渲染页数不在 2-10 页安全范围。", "invalid-rendered-page-count");
    }
    if (!pageSize || Math.abs(Number(pageSize[1]) - 595.3) > 3 || Math.abs(Number(pageSize[2]) - 841.9) > 3) {
      throw visualError("正式模板未渲染为 A4 页面。", "invalid-rendered-page-size");
    }

    const { stdout: extractedText } = await runExternal(process.env.PDFTOTEXT_BIN || "pdftotext", ["-layout", pdfPath, "-"]);
    for (const fragment of expectedTextFragments) {
      if (!extractedText.includes(fragment)) throw visualError(`渲染 PDF 缺少关键文字：${fragment}`, "rendered-text-missing");
    }
    await runExternal(process.env.PDFTOPPM_BIN || "pdftoppm", ["-png", "-r", "96", pdfPath, pagePrefix]);
    const pageFiles = (await readdir(directory))
      .filter((name) => /^page-\d+\.png$/.test(name))
      .sort((left, right) => Number(left.match(/\d+/)?.[0]) - Number(right.match(/\d+/)?.[0]));
    if (pageFiles.length !== pageCount) throw visualError("PNG 页数与 PDF 页数不一致。", "rendered-page-count-mismatch");

    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const pageReports = [];
    try {
      for (const pageFile of pageFiles) {
        const report = await inspectRenderedPng(page, path.join(directory, pageFile));
        const totalPixels = report.width * report.height;
        // 中文注解：低于页面 0.3% 的有效像素视为空白；绿色像素零容忍专门防止模板强调色污染标题；4%/2% 安全区用于拦截破表或页眉页脚贴边。
        if (report.nonWhitePixels < totalPixels * 0.003) throw visualError(`${pageFile} 疑似空白页。`, "rendered-page-blank");
        if (report.greenPixels > 0) throw visualError(`${pageFile} 出现绿色字体或图形像素。`, "rendered-green-color-detected");
        if (report.edgePixels > 0
          || report.minX < report.width * 0.04 || report.maxX > report.width * 0.96
          || report.minY < report.height * 0.02 || report.maxY > report.height * 0.98) {
          throw visualError(`${pageFile} 内容越过安全页边界。`, "rendered-content-outside-safe-area");
        }
        pageReports.push({ page: pageFile, ...report });
      }
    } finally {
      await browser.close();
    }

    const report = {
      schemaVersion: 1,
      kind: "molinword-docx-visual-render-report",
      pageCount,
      pageSizePt: { width: Number(pageSize[1]), height: Number(pageSize[2]) },
      titleColor: structuralReport.titleColor,
      greenPixels: pageReports.reduce((sum, pageReport) => sum + pageReport.greenPixels, 0),
      pages: pageReports
    };
    await writeFile(path.join(directory, "visual-render-report.json"), `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
    console.log("DOCX LibreOffice 视觉渲染检查通过。", { pageCount, titleColor: report.titleColor, greenPixels: report.greenPixels });
    return report;
  } finally {
    if (temporary) await rm(directory, { recursive: true, force: true });
  }
}

async function runCli() {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options.selfTest) await runStructuralSelfTest();
    else await runVisualRender(options.outputDirectory);
  } catch (error) {
    console.error("DOCX 视觉渲染检查失败。", { detailCode: error?.detailCode || "docx-visual-render-failed", message: error?.message || "未知错误" });
    process.exitCode = 1;
  }
}

const executedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (executedPath === import.meta.url) await runCli();

export { createVisualFixtureBuffer, inspectVisualFixtureStructure, runStructuralSelfTest, runVisualRender };
