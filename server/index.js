import "dotenv/config";
import crypto from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import express from "express";
import { AlignmentType, BorderStyle, Column, ColumnBreak as DocxColumnBreak, CommentRangeEnd, CommentRangeStart, CommentReference, DeletedTextRun, Document, EndnoteReferenceRun, ExternalHyperlink, Footer, FootnoteReferenceRun, Header, HeadingLevel, HeightRule, ImageRun, InsertedTextRun, LevelFormat, LineRuleType, NoBreakHyphen, Packer, PageBreak as DocxPageBreak, PageOrientation, Paragraph, SectionType, SimpleField, SoftHyphen, Tab, Table, TableCell, TableLayoutType, TableRow, TextDirection, TextRun, TextWrappingSide, TextWrappingType, VerticalAlignTable, WidthType } from "docx";
import { parseDocument } from "htmlparser2";
import JSZip from "jszip";
import mammoth from "mammoth";
import { Client as MinioClient } from "minio";
import multer from "multer";
import { normalizeUploadedFileName } from "./upload-file-name.js";
import mysql from "mysql2/promise";
import sanitizeHtml from "sanitize-html";
const require = createRequire(import.meta.url);
const pdf = require("pdf-parse");
const WordExtractor = require("word-extractor");
const wordExtractor = new WordExtractor();
const docxPage = {
  // 中文注解：A4 是默认纸张；非 A4 节会在 pageSize 中保存自己的纵向基准宽高。
  widthTwip: 11906,
  heightTwip: 16838
};
const orderedListFormatDefinitions = [
  { format: "decimal", reference: "online-ordered-list-decimal", css: "decimal", docx: LevelFormat.DECIMAL },
  { format: "upperRoman", reference: "online-ordered-list-upper-roman", css: "upper-roman", docx: LevelFormat.UPPER_ROMAN },
  { format: "lowerRoman", reference: "online-ordered-list-lower-roman", css: "lower-roman", docx: LevelFormat.LOWER_ROMAN },
  { format: "upperLetter", reference: "online-ordered-list-upper-letter", css: "upper-alpha", docx: LevelFormat.UPPER_LETTER },
  { format: "lowerLetter", reference: "online-ordered-list-lower-letter", css: "lower-alpha", docx: LevelFormat.LOWER_LETTER }
];
function normalizeOrderedListFormat(value = "") {
  return orderedListFormatDefinitions.some((item) => item.format === value) ? value : "decimal";
}

function orderedListFormatDefinition(value = "") {
  const format = normalizeOrderedListFormat(value);
  return orderedListFormatDefinitions.find((item) => item.format === format) || orderedListFormatDefinitions[0];
}

function normalizeOrderedListStart(value) {
  const start = Number(value);
  return Number.isInteger(start) && start >= 1 && start <= 32767 ? start : 1;
}

function orderedListReference(format, start = 1) {
  const definition = orderedListFormatDefinition(format);
  const normalizedStart = normalizeOrderedListStart(start);
  return normalizedStart === 1 ? definition.reference : `${definition.reference}-start-${normalizedStart}`;
}
const defaultPageTextStyle = Object.freeze({ alignment: "center", fontFamily: "Microsoft YaHei", fontSizePt: 9, color: "#6B7280", bold: false, italic: false });
const defaultPageNumberTemplate = "第 {PAGE} 页 / 共 {NUMPAGES} 页";
const supportedPageImageMimeTypes = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const defaultPageVariant = Object.freeze({
  headerText: "",
  headerStyle: defaultPageTextStyle,
  headerImages: [],
  footerText: "",
  footerStyle: defaultPageTextStyle,
  footerImages: [],
  headerPageNumberTemplate: "",
  footerPageNumberTemplate: "",
  headerPageNumberSeparate: false,
  footerPageNumberSeparate: false,
  pageNumberEnabled: false,
  pageNumberPosition: "footer"
});
const defaultPageMargins = Object.freeze({ top: 1440, right: 1440, bottom: 1440, left: 1440 });
const defaultPageLayout = Object.freeze({
  ...defaultPageVariant,
  firstPageDifferent: false,
  firstPage: defaultPageVariant,
  oddEvenDifferent: false,
  evenPage: defaultPageVariant,
  orientation: "portrait",
  paperSize: Object.freeze({ width: docxPage.widthTwip, height: docxPage.heightTwip }),
  pageNumberFormat: "decimal",
  pageNumberStart: null,
  headerDistance: 708,
  footerDistance: 708,
  columns: Object.freeze({ count: 1, space: 720, separate: false }),
  verticalAlign: "top",
  pageBorders: null,
  margins: defaultPageMargins
});

function normalizePageText(value) {
  return String(value || "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .slice(0, 2000);
}

function normalizePageNumberTemplate(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 500);
}

function normalizePageTextStyle(value, fallback = defaultPageTextStyle) {
  const source = value && typeof value === "object" ? value : {};
  const base = fallback && typeof fallback === "object" ? fallback : defaultPageTextStyle;
  const fontSizePt = Number(source.fontSizePt ?? base.fontSizePt);
  const rawColor = String(source.color ?? base.color).trim();
  const fallbackColor = /^#?[0-9a-f]{6}$/i.test(String(base.color || "")) ? `#${String(base.color).replace("#", "").toUpperCase()}` : defaultPageTextStyle.color;
  const fallbackFontSize = Number.isFinite(Number(base.fontSizePt)) ? Math.max(6, Math.min(Math.round(Number(base.fontSizePt) * 2) / 2, 72)) : defaultPageTextStyle.fontSizePt;
  return {
    alignment: ["left", "center", "right"].includes(source.alignment) ? source.alignment : (["left", "center", "right"].includes(base.alignment) ? base.alignment : "center"),
    fontFamily: String(source.fontFamily ?? base.fontFamily ?? "Microsoft YaHei").replace(/["\\]/g, "").trim().slice(0, 100) || "Microsoft YaHei",
    fontSizePt: Number.isFinite(fontSizePt) ? Math.max(6, Math.min(Math.round(fontSizePt * 2) / 2, 72)) : fallbackFontSize,
    color: /^#?[0-9a-f]{6}$/i.test(rawColor) ? `#${rawColor.replace("#", "").toUpperCase()}` : fallbackColor,
    bold: source.bold === undefined ? Boolean(base.bold) : Boolean(source.bold),
    italic: source.italic === undefined ? Boolean(base.italic) : Boolean(source.italic)
  };
}

function normalizePageImages(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 10).map((item, index) => {
    const source = item && typeof item === "object" ? item : {};
    const fileId = Number(source.fileId);
    const rawSrc = String(source.src || "").trim();
    const src = /^data:image\/(?:png|jpeg|jpg|gif|webp);base64,/i.test(rawSrc) || /^\/api\/files\/\d+\/content$/i.test(rawSrc) ? rawSrc : "";
    const rawWidth = Number(source.widthPx);
    const rawHeight = Number(source.heightPx);
    const width = Number.isFinite(rawWidth) ? Math.max(1, rawWidth) : 120;
    const height = Number.isFinite(rawHeight) ? Math.max(1, rawHeight) : 60;
    const scale = Math.min(1, 602 / width, 400 / height);
    return {
      id: String(source.id || (Number.isSafeInteger(fileId) && fileId > 0 ? `file-${fileId}` : `page-image-${index + 1}`)).replace(/[^\w-]/g, "").slice(0, 80) || `page-image-${index + 1}`,
      fileId: Number.isSafeInteger(fileId) && fileId > 0 ? fileId : null,
      src,
      alt: String(source.alt || "页眉页脚图片").replace(/[<>]/g, "").trim().slice(0, 200),
      widthPx: Math.round(width * scale * 100) / 100,
      heightPx: Math.round(height * scale * 100) / 100,
      paragraphIndex: Math.max(0, Math.min(Math.round(Number(source.paragraphIndex) || 0), 49)),
      placement: source.placement === "beforeText" ? "beforeText" : "afterText",
      alignment: ["left", "center", "right"].includes(source.alignment) ? source.alignment : "center"
    };
  }).filter((item) => item.src || item.fileId);
}

function normalizePageVariant(value, fallback = defaultPageVariant) {
  const source = value && typeof value === "object" ? value : {};
  const base = fallback && typeof fallback === "object" ? fallback : defaultPageVariant;
  const hasHeaderTemplate = Object.prototype.hasOwnProperty.call(source, "headerPageNumberTemplate");
  const hasFooterTemplate = Object.prototype.hasOwnProperty.call(source, "footerPageNumberTemplate");
  let headerPageNumberTemplate = hasHeaderTemplate ? normalizePageNumberTemplate(source.headerPageNumberTemplate) : normalizePageNumberTemplate(base.headerPageNumberTemplate);
  let footerPageNumberTemplate = hasFooterTemplate ? normalizePageNumberTemplate(source.footerPageNumberTemplate) : normalizePageNumberTemplate(base.footerPageNumberTemplate);
  if (!hasHeaderTemplate && !hasFooterTemplate && source.pageNumberEnabled !== undefined) {
    headerPageNumberTemplate = source.pageNumberEnabled && source.pageNumberPosition === "header" ? defaultPageNumberTemplate : "";
    footerPageNumberTemplate = source.pageNumberEnabled && source.pageNumberPosition !== "header" ? defaultPageNumberTemplate : "";
  }
  const pageNumberEnabled = Boolean(headerPageNumberTemplate || footerPageNumberTemplate);
  return {
    headerText: normalizePageText(source.headerText ?? base.headerText),
    headerStyle: normalizePageTextStyle(source.headerStyle, base.headerStyle || defaultPageTextStyle),
    headerImages: normalizePageImages(source.headerImages === undefined ? base.headerImages : source.headerImages),
    footerText: normalizePageText(source.footerText ?? base.footerText),
    footerStyle: normalizePageTextStyle(source.footerStyle, base.footerStyle || defaultPageTextStyle),
    footerImages: normalizePageImages(source.footerImages === undefined ? base.footerImages : source.footerImages),
    headerPageNumberTemplate,
    footerPageNumberTemplate,
    headerPageNumberSeparate: Boolean(headerPageNumberTemplate) && (source.headerPageNumberSeparate === undefined ? Boolean(base.headerPageNumberSeparate) : Boolean(source.headerPageNumberSeparate)),
    footerPageNumberSeparate: Boolean(footerPageNumberTemplate) && (source.footerPageNumberSeparate === undefined ? Boolean(base.footerPageNumberSeparate) : Boolean(source.footerPageNumberSeparate)),
    pageNumberEnabled,
    pageNumberPosition: headerPageNumberTemplate && !footerPageNumberTemplate ? "header" : "footer"
  };
}

function normalizePageMargin(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(Math.round(number), 7200)) : fallback;
}

function normalizePaperSize(value, fallback = docxPage) {
  const source = value && typeof value === "object" ? value : {};
  const base = fallback && typeof fallback === "object" ? fallback : docxPage;
  const width = Math.max(1440, Math.min(50000, Math.round(Number(source.width ?? source.widthTwip ?? base.width ?? base.widthTwip) || docxPage.widthTwip)));
  const height = Math.max(1440, Math.min(50000, Math.round(Number(source.height ?? source.heightTwip ?? base.height ?? base.heightTwip) || docxPage.heightTwip)));
  // 中文注解：模型始终保存纵向基准尺寸，横向只在布局和导出时交换宽高。
  return { width: Math.min(width, height), height: Math.max(width, height) };
}

function normalizePageMargins(value, fallback = defaultPageMargins, orientation = "portrait", paperSize = docxPage) {
  const source = value && typeof value === "object" ? value : {};
  const base = fallback && typeof fallback === "object" ? fallback : defaultPageMargins;
  const margins = {
    top: normalizePageMargin(source.top, base.top),
    right: normalizePageMargin(source.right, base.right),
    bottom: normalizePageMargin(source.bottom, base.bottom),
    left: normalizePageMargin(source.left, base.left)
  };
  const normalizedPaperSize = normalizePaperSize(paperSize);
  const pageWidth = orientation === "landscape" ? normalizedPaperSize.height : normalizedPaperSize.width;
  const pageHeight = orientation === "landscape" ? normalizedPaperSize.width : normalizedPaperSize.height;
  const fitPair = (first, second, maximum) => {
    const total = first + second;
    if (total <= maximum || total <= 0) return [first, second];
    const ratio = maximum / total;
    return [Math.round(first * ratio), Math.round(second * ratio)];
  };
  // 中文注解：四边页距必须联合校验，始终为当前纸张正文保留至少 0.5 英寸。
  [margins.left, margins.right] = fitPair(margins.left, margins.right, pageWidth - 720);
  [margins.top, margins.bottom] = fitPair(margins.top, margins.bottom, pageHeight - 720);
  return margins;
}

function normalizePageColumns(value, fallback = defaultPageLayout.columns) {
  const source = value && typeof value === "object" ? value : {};
  const base = fallback && typeof fallback === "object" ? fallback : { count: 1, space: 720, separate: false };
  const count = Math.max(1, Math.min(8, Math.round(Number(source.count ?? base.count) || 1)));
  const space = Math.max(0, Math.min(7200, Math.round(Number(source.space ?? base.space) || 0)));
  const result = { count, space, separate: count > 1 && (source.separate === undefined ? Boolean(base.separate) : Boolean(source.separate)) };
  const rawItems = Array.isArray(source.items) ? source.items : (Array.isArray(base.items) ? base.items : []);
  const equalWidth = source.equalWidth === undefined ? base.equalWidth : source.equalWidth;
  if (count > 1 && equalWidth === false && rawItems.length >= count) {
    // 中文注解：自定义分栏逐栏保存宽度和栏后间距，最后一栏没有后续间距。
    result.equalWidth = false;
    result.items = rawItems.slice(0, count).map((item, index) => ({
      width: Math.max(1, Math.min(20000, Math.round(Number(item?.width) || 1))),
      space: index === count - 1 ? 0 : Math.max(0, Math.min(7200, Math.round(Number(item?.space) || 0)))
    }));
  }
  return result;
}

function normalizePageBorders(value, fallback = defaultPageLayout.pageBorders) {
  const source = value && typeof value === "object" ? value : null;
  if (!source) return fallback && typeof fallback === "object" ? normalizePageBorders(fallback, null) : null;
  const styles = new Set(["single", "dashed", "dashSmallGap", "dotted", "dotDash", "dotDotDash", "double", "thick", "none", "nil"]);
  const result = {
    display: ["allPages", "firstPage", "notFirstPage"].includes(source.display) ? source.display : "allPages",
    offsetFrom: source.offsetFrom === "text" ? "text" : "page",
    zOrder: source.zOrder === "back" ? "back" : "front"
  };
  let hasBorder = false;
  for (const side of ["top", "right", "bottom", "left"]) {
    const border = source[side];
    if (!border || !styles.has(String(border.style))) continue;
    const size = Math.max(0, Math.min(96, Math.round(Number(border.size) || 0)));
    const color = /^#[0-9a-f]{6}$/i.test(String(border.color || "")) ? String(border.color).toUpperCase() : "#000000";
    const space = Math.max(0, Math.min(31, Math.round(Number(border.space) || 0)));
    result[side] = { style: String(border.style), size, color, space };
    hasBorder = true;
  }
  return hasBorder ? result : null;
}

function normalizePageLayout(value, fallback = defaultPageLayout) {
  const source = value && typeof value === "object" ? value : {};
  const base = fallback && typeof fallback === "object" ? fallback : defaultPageLayout;
  const normalizedDefault = normalizePageVariant(source, base);
  const orientation = source.orientation === "landscape" ? "landscape" : (base.orientation === "landscape" ? "landscape" : "portrait");
  const pageNumberFormats = ["decimal", "upperRoman", "lowerRoman", "upperLetter", "lowerLetter"];
  const rawPageNumberStart = source.pageNumberStart === undefined ? base.pageNumberStart : source.pageNumberStart;
  const pageNumberStartValue = Number(rawPageNumberStart);
  const paperSize = normalizePaperSize(source.paperSize, normalizePaperSize(base.paperSize, docxPage));
  const margins = normalizePageMargins(source.margins, base.margins || defaultPageMargins, orientation, paperSize);
  const columns = normalizePageColumns(source.columns, base.columns);
  const pageWidth = orientation === "landscape" ? paperSize.height : paperSize.width;
  const rawGutter = normalizePageMargin(source.gutter, normalizePageMargin(base.gutter, 0));
  const gutter = Math.min(rawGutter, Math.max(0, pageWidth - margins.left - margins.right - 720));
  const availableWidth = Math.max(720, pageWidth - margins.left - margins.right - gutter);
  if (columns.equalWidth === false && Array.isArray(columns.items)) {
    const gapTotal = columns.items.slice(0, -1).reduce((total, item) => total + item.space, 0);
    const maximumGapTotal = Math.max(0, availableWidth - columns.count * 360);
    if (gapTotal > maximumGapTotal && gapTotal > 0) {
      const gapScale = maximumGapTotal / gapTotal;
      columns.items = columns.items.map((item, index) => ({ ...item, space: index === columns.count - 1 ? 0 : Math.round(item.space * gapScale) }));
    }
    const normalizedGapTotal = columns.items.slice(0, -1).reduce((total, item) => total + item.space, 0);
    const widthBudget = Math.max(columns.count, availableWidth - normalizedGapTotal);
    const widthTotal = columns.items.reduce((total, item) => total + item.width, 0);
    if (widthTotal > widthBudget) {
      const widthScale = widthBudget / widthTotal;
      columns.items = columns.items.map((item) => ({ ...item, width: Math.max(1, Math.round(item.width * widthScale)) }));
    }
    columns.space = columns.items[0]?.space || 0;
  } else {
    const maximumColumnSpace = columns.count > 1 ? Math.max(0, Math.floor((availableWidth - columns.count * 720) / (columns.count - 1))) : columns.space;
    columns.space = Math.min(columns.space, maximumColumnSpace);
  }
  return {
    ...normalizedDefault,
    firstPageDifferent: source.firstPageDifferent === undefined ? Boolean(base.firstPageDifferent) : Boolean(source.firstPageDifferent),
    firstPage: normalizePageVariant(source.firstPage, base.firstPage || defaultPageVariant),
    oddEvenDifferent: source.oddEvenDifferent === undefined ? Boolean(base.oddEvenDifferent) : Boolean(source.oddEvenDifferent),
    evenPage: normalizePageVariant(source.evenPage, base.evenPage || defaultPageVariant),
    orientation,
    paperSize,
    pageNumberFormat: pageNumberFormats.includes(source.pageNumberFormat) ? source.pageNumberFormat : (pageNumberFormats.includes(base.pageNumberFormat) ? base.pageNumberFormat : "decimal"),
    pageNumberStart: rawPageNumberStart === null || rawPageNumberStart === "" || !Number.isFinite(pageNumberStartValue) ? null : Math.max(0, Math.min(Math.round(pageNumberStartValue), 999999)),
    headerDistance: normalizePageMargin(source.headerDistance, normalizePageMargin(base.headerDistance, 708)),
    footerDistance: normalizePageMargin(source.footerDistance, normalizePageMargin(base.footerDistance, 708)),
    columns,
    verticalAlign: ["top", "center", "bottom", "both"].includes(source.verticalAlign) ? source.verticalAlign : (["top", "center", "bottom", "both"].includes(base.verticalAlign) ? base.verticalAlign : "top"),
    pageBorders: normalizePageBorders(source.pageBorders, base.pageBorders),
    ...(gutter > 0 ? { gutter } : {}),
    margins
  };
}

function readBoundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

function createFixedWindowRateLimiter({ maximumRequests, windowMs, message, excludedPaths = new Set() }) {
  const counters = new Map();
  let requestCount = 0;

  return (request, response, next) => {
    if (excludedPaths.has(request.path)) return next();

    const now = Date.now();
    requestCount += 1;
    // 中文注解：按固定窗口记录单实例 IP 访问量，并周期清理过期记录，避免公网流量导致内存无限增长。
    if (requestCount % 256 === 0) {
      for (const [key, value] of counters) {
        if (value.resetAt <= now) counters.delete(key);
      }
    }

    const clientKey = request.ip || request.socket?.remoteAddress || "unknown";
    let counter = counters.get(clientKey);
    if (!counter || counter.resetAt <= now) {
      if (!counters.has(clientKey) && counters.size >= 10000) {
        const oldestKey = counters.keys().next().value;
        if (oldestKey !== undefined) counters.delete(oldestKey);
      }
      counter = { count: 0, resetAt: now + windowMs };
      counters.set(clientKey, counter);
    }

    counter.count += 1;
    const remaining = Math.max(0, maximumRequests - counter.count);
    const resetAfterSeconds = Math.max(1, Math.ceil((counter.resetAt - now) / 1000));
    response.setHeader("RateLimit-Limit", String(maximumRequests));
    response.setHeader("RateLimit-Remaining", String(remaining));
    response.setHeader("RateLimit-Reset", String(resetAfterSeconds));

    if (counter.count > maximumRequests) {
      response.setHeader("Retry-After", String(resetAfterSeconds));
      response.status(429).json({ message });
      return;
    }
    next();
  };
}

const app = express();
const port = Number(process.env.LOCAL_API_PORT || process.env.APP_PORT || process.env.PORT || 3001);
const appHost = String(process.env.APP_HOST || "127.0.0.1").trim() || "127.0.0.1";
const localUserId = process.env.LOCAL_USER_ID || "local-dev-user";
const sessionCookieName = "moling_word_session";
const maximumConcurrentAiRequests = Math.min(100, Math.max(1, Number(process.env.AI_MAX_CONCURRENT_REQUESTS || 8) || 8));
const readinessTimeoutMs = Math.min(15000, Math.max(500, Number(process.env.READINESS_TIMEOUT_MS || 3000) || 3000));
const trustedProxyHops = readBoundedInteger(process.env.TRUSTED_PROXY_HOPS, 0, 0, 5);
const rateLimitWindowMs = readBoundedInteger(process.env.RATE_LIMIT_WINDOW_MS, 60000, 1000, 3600000);
const apiRateLimitMaximum = readBoundedInteger(process.env.API_RATE_LIMIT_MAX, 300, 1, 100000);
const aiRateLimitMaximum = readBoundedInteger(process.env.AI_RATE_LIMIT_MAX, 30, 1, 10000);
const llmTimeoutMs = readBoundedInteger(process.env.LLM_TIMEOUT_MS, 30000, 1000, 60000);
const llmMaxRetries = readBoundedInteger(process.env.LLM_MAX_RETRIES, 1, 0, 1);
const molingInternalTimeoutMs = readBoundedInteger(process.env.MOLING_INTERNAL_TIMEOUT_MS, 10000, 1000, 30000);
// 中文注解：智能体返修路径最多执行五段模型调用和五次平台调用，默认退出窗口覆盖全部超时与重试，再留出本地结算清理时间。
const inferredShutdownTimeoutMs = llmTimeoutMs * (llmMaxRetries + 1) * 5 + molingInternalTimeoutMs * 5 + 30000;
const shutdownTimeoutMs = readBoundedInteger(process.env.SHUTDOWN_TIMEOUT_MS, inferredShutdownTimeoutMs, inferredShutdownTimeoutMs, 1200000);
const accessLogEnabled = process.env.ACCESS_LOG_ENABLED === "true"
  || (process.env.ACCESS_LOG_ENABLED !== "false" && (process.env.APP_ENV === "production" || process.env.NODE_ENV === "production"));
let activeAiRequests = 0;

app.disable("x-powered-by");
app.set("trust proxy", trustedProxyHops);
app.use((request, response, next) => {
  // 中文注解：请求 ID 始终由本服务生成，避免公网客户端伪造相同标识污染审计链路。
  request.requestId = crypto.randomUUID();
  response.setHeader("X-Request-Id", request.requestId);
  next();
});
app.use((request, response, next) => {
  // 中文注解：API 默认使用收敛的浏览器安全头；具体文件下载路由仍可覆盖自己的缓存与内容类型。
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  response.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
  next();
});
app.use((request, response, next) => {
  if (!accessLogEnabled) return next();
  const startedAt = process.hrtime.bigint();
  let logged = false;
  const writeAccessLog = (aborted) => {
    if (logged) return;
    logged = true;
    // 中文注解：访问日志不记录查询串、Cookie 和请求体，只保留定位线上故障所需的最小字段。
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "info",
      type: "http_access",
      requestId: request.requestId,
      method: request.method,
      path: request.path,
      status: response.statusCode,
      aborted,
      durationMs: Number(process.hrtime.bigint() - startedAt) / 1e6
    }));
  };
  response.once("finish", () => writeAccessLog(false));
  // 中文注解：客户端提前断开时 finish 不会触发，仍需记录一次中断审计日志。
  response.once("close", () => writeAccessLog(!response.writableFinished));
  next();
});
app.use((request, response, next) => {
  if (!isProductionRuntime || ["GET", "HEAD", "OPTIONS"].includes(request.method)) return next();
  const origin = String(request.headers.origin || "").trim();
  if (!origin) return next();
  const trustedOrigins = new Set(
    [process.env.APP_BASE_URL, ...String(process.env.TRUSTED_ORIGINS || "").split(",")]
      .map((value) => {
        try { return new URL(String(value || "").trim()).origin; } catch { return ""; }
      })
      .filter(Boolean)
  );
  response.setHeader("Vary", "Origin");
  if (trustedOrigins.has(origin)) return next();
  // 中文注解：浏览器携带会话 cookie 的跨站写请求必须在进入业务和计费逻辑前被拒绝。
  response.status(403).json({ message: "请求来源不受信任，请从正式应用入口重试。" });
});
app.use("/api", createFixedWindowRateLimiter({
  maximumRequests: apiRateLimitMaximum,
  windowMs: rateLimitWindowMs,
  message: "请求过于频繁，请稍后重试。",
  excludedPaths: new Set(["/health", "/ready"])
}));
app.use("/api/ai", createFixedWindowRateLimiter({
  maximumRequests: aiRateLimitMaximum,
  windowMs: rateLimitWindowMs,
  message: "AI 请求过于频繁，请稍后重试。"
}));
// 中文注解：先完成来源与频率门禁再解析正文，畸形或超大 JSON 同样受限流保护。
app.use(express.json({ limit: "1mb" }));
app.use("/api/ai", (request, response, next) => {
  if (activeAiRequests >= maximumConcurrentAiRequests) {
    response.setHeader("Retry-After", "2");
    response.status(429).json({ message: "AI 服务当前请求较多，请稍后重试。" });
    return;
  }
  activeAiRequests += 1;
  let released = false;
  const releaseSlot = () => {
    if (released) return;
    released = true;
    activeAiRequests = Math.max(0, activeAiRequests - 1);
  };
  const originalEnd = response.end;
  response.end = function endWithAiSlotRelease(...args) {
    try {
      return originalEnd.apply(this, args);
    } finally {
      // 中文注解：即使客户端已断开，也要等业务处理真正结束并调用 end 后才释放槽位，避免绕过并发上限。
      releaseSlot();
    }
  };
  response.once("finish", releaseSlot);
  response.once("close", () => {
    if (response.writableEnded) releaseSlot();
  });
  next();
});

const documentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 1 }
});
const pageImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  fileFilter: (_request, file, callback) => callback(null, supportedPageImageMimeTypes.has(file.mimetype))
});

function receiveImportedDocument(request, response, next) {
  documentUpload.single("file")(request, response, (error) => {
    if (!error) {
      // 中文注解：在扩展名判断、标题生成和文件归档之前统一修正 multipart 文件名编码。
      if (request.file) request.file.originalname = normalizeUploadedFileName(request.file.originalname);
      return next();
    }
    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      response.status(400).json({ message: "文件不能超过 15MB。" });
      return;
    }
    response.status(400).json({ message: "文件上传失败，请重新选择文档。" });
  });
}

function receivePageImage(request, response, next) {
  pageImageUpload.single("file")(request, response, (error) => {
    if (!error) return next();
    const message = error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE"
      ? "图片不能超过 8MB。"
      : "仅支持 PNG、JPEG、GIF 和 WebP 图片。";
    response.status(400).json({ message });
  });
}

async function authenticateDocumentImport(request, response, next) {
  try {
    // 中文注解：先确认用户身份再接收文件，避免无效会话占用上传内存。
    request.importUser = await getCurrentUser(request);
    next();
  } catch (error) {
    sendError(response, error, error?.httpStatus || 401, "请重新进入应用后再导入文档。");
  }
}

const molingApiBaseUrl = process.env.MOLING_API_BASE_URL || "http://8.130.9.163:8080";
const gatewayBaseUrl = process.env.MOLIN_GATEWAY_BASE_URL || `${molingApiBaseUrl}/v1`;
const gatewayApiKey = process.env.MOLIN_GATEWAY_API_KEY || "";
const llmApiUrl = process.env.LLM_API_URL || `${gatewayBaseUrl}/chat/completions`;
const llmReadinessUrl = process.env.LLM_READINESS_URL
  || llmApiUrl.replace(/\/chat\/completions\/?(?:\?.*)?$/i, "/models");
const llmApiKey = process.env.LLM_API_KEY || gatewayApiKey;
const gatewayModel = process.env.LLM_MODEL || process.env.MOLIN_GATEWAY_MODEL || "deepseek-chat";
const storageBucket = process.env.STORAGE_BUCKET || "moling-word";
const internalApiToken = process.env.INTERNAL_API_TOKEN || "";
const molingAppId = process.env.MOLING_APP_ID || process.env.WORD_APP_ID || "";
const molingProductId = process.env.MOLING_PRODUCT_ID || process.env.WORD_PRODUCT_ID || "";
const sessionTtlSeconds = Number(process.env.SESSION_TTL_SECONDS || 86400);
const sessionCookieSecure = process.env.SESSION_COOKIE_SECURE === "true";
const configuredAppEnvironment = String(process.env.APP_ENV || "").trim().toLowerCase();
const configuredNodeEnvironment = String(process.env.NODE_ENV || "").trim().toLowerCase();
const isProductionRuntime = configuredAppEnvironment === "production" || configuredNodeEnvironment === "production";
const appEnvironment = isProductionRuntime ? "production" : (configuredAppEnvironment || configuredNodeEnvironment || "development");
// 中文注解：生产环境强制关闭本地身份模拟，即使部署变量误配也不能绕过登录和积分计费。
const localMolingMock = !isProductionRuntime && process.env.LOCAL_MOLING_MOCK === "true";
// 中文注解：生产环境默认且强制要求墨灵会话；开发环境可显式开启同等门禁做联调。
const requireMolingSession = isProductionRuntime || process.env.REQUIRE_MOLING_SESSION === "true";
const billingReconciliationOutboxPath = process.env.BILLING_RECONCILIATION_OUTBOX
  || path.join(process.cwd(), "runtime-data", "billing-reconciliation-outbox.jsonl");
const dbPool = process.env.DATABASE_URL
  ? mysql.createPool(process.env.DATABASE_URL)
  : null;
const minioClient = createMinioClient();

function validateProductionConfiguration(environment = {}) {
  const appRuntime = String(environment.APP_ENV || "").trim().toLowerCase();
  const nodeRuntime = String(environment.NODE_ENV || "").trim().toLowerCase();
  if (appRuntime !== "production" && nodeRuntime !== "production") return [];
  // 中文注解：与运行时保持同一兼容规则，让仍使用历史 WORD_* 变量名的合规部署可以平滑升级。
  const configuration = {
    ...environment,
    MOLING_APP_ID: environment.MOLING_APP_ID || environment.WORD_APP_ID,
    MOLING_PRODUCT_ID: environment.MOLING_PRODUCT_ID || environment.WORD_PRODUCT_ID,
    LLM_MODEL: environment.LLM_MODEL || environment.MOLIN_GATEWAY_MODEL
  };
  const errors = [];
  const allowInsecureInternalHttp = configuration.ALLOW_INSECURE_INTERNAL_HTTP === "true";
  const requiredValues = [
    "DATABASE_URL",
    "INTERNAL_API_TOKEN",
    "MOLING_APP_ID",
    "MOLING_PRODUCT_ID",
    "MOLING_API_BASE_URL",
    "LLM_API_URL",
    "LLM_API_KEY",
    "LLM_MODEL",
    "AI_AUDIT_CONTENT_MODE",
    "AI_AUDIT_HASH_KEY",
    "AI_AUDIT_RETENTION_DAYS",
    "STORAGE_ENDPOINT",
    "STORAGE_ACCESS_KEY_ID",
    "STORAGE_SECRET_ACCESS_KEY",
    "APP_BASE_URL",
    "BILLING_RECONCILIATION_OUTBOX"
  ];
  const isPlaceholder = (value) => !String(value || "").trim()
    || /replace-with|请替换|changeme|example-key|your[-_]/i.test(String(value));
  for (const key of requiredValues) {
    if (isPlaceholder(configuration[key])) errors.push(`${key} 未配置或仍为占位值`);
  }
  for (const key of ["INTERNAL_API_TOKEN", "LLM_API_KEY", "STORAGE_SECRET_ACCESS_KEY"]) {
    if (!isPlaceholder(configuration[key]) && String(configuration[key]).length < 16) errors.push(`${key} 长度不足 16 个字符`);
  }
  if (!isPlaceholder(configuration.AI_AUDIT_HASH_KEY) && String(configuration.AI_AUDIT_HASH_KEY).length < 32) {
    errors.push("AI_AUDIT_HASH_KEY 长度不足 32 个字符");
  }
  const auditHashKey = String(configuration.AI_AUDIT_HASH_KEY || "");
  for (const key of ["INTERNAL_API_TOKEN", "LLM_API_KEY", "STORAGE_SECRET_ACCESS_KEY"]) {
    if (!isPlaceholder(auditHashKey) && !isPlaceholder(configuration[key]) && auditHashKey === String(configuration[key])) {
      errors.push(`AI_AUDIT_HASH_KEY 必须使用独立密钥，不能与 ${key} 复用`);
    }
  }
  try {
    const databasePassword = decodeURIComponent(new URL(configuration.DATABASE_URL).password || "");
    if (!isPlaceholder(auditHashKey) && databasePassword && auditHashKey === databasePassword) {
      errors.push("AI_AUDIT_HASH_KEY 必须使用独立密钥，不能与 DATABASE_URL 数据库密码复用");
    }
  } catch {
    // DATABASE_URL 的格式与连接可用性由数据库初始化和就绪探测负责，此处只做可解析时的密钥复用检查。
  }
  const requireHttps = (key, allowInternalOverride = false) => {
    if (isPlaceholder(configuration[key])) return;
    try {
      const value = new URL(configuration[key]);
      if (value.protocol !== "https:" && !(allowInternalOverride && allowInsecureInternalHttp)) {
        errors.push(`${key} 生产环境必须使用 HTTPS${allowInternalOverride ? "；可信内网例外需显式设置 ALLOW_INSECURE_INTERNAL_HTTP=true" : ""}`);
      }
    } catch {
      errors.push(`${key} 不是有效 URL`);
    }
  };
  requireHttps("APP_BASE_URL");
  requireHttps("MOLING_API_BASE_URL", true);
  requireHttps("LLM_API_URL", true);
  requireHttps("LLM_READINESS_URL", true);
  requireHttps("STORAGE_ENDPOINT", true);
  if (configuration.SESSION_COOKIE_SECURE !== "true") errors.push("SESSION_COOKIE_SECURE 生产环境必须为 true");
  if (configuration.AI_AUDIT_CONTENT_MODE !== "metadata") {
    errors.push("AI_AUDIT_CONTENT_MODE 生产环境必须为 metadata，禁止保存完整提示词和模型回复");
  }
  if (!isPlaceholder(configuration.BILLING_RECONCILIATION_OUTBOX) && !path.isAbsolute(configuration.BILLING_RECONCILIATION_OUTBOX)) {
    errors.push("BILLING_RECONCILIATION_OUTBOX 生产环境必须指向持久卷绝对路径");
  }
  const validateIntegerSetting = (key, minimum, maximum) => {
    if (configuration[key] === undefined || configuration[key] === "") return;
    const value = Number(configuration[key]);
    if (!Number.isInteger(value) || value < minimum || value > maximum) {
      errors.push(`${key} 必须是 ${minimum} 到 ${maximum} 之间的整数`);
    }
  };
  validateIntegerSetting("TRUSTED_PROXY_HOPS", 0, 5);
  validateIntegerSetting("RATE_LIMIT_WINDOW_MS", 1000, 3600000);
  validateIntegerSetting("API_RATE_LIMIT_MAX", 1, 100000);
  validateIntegerSetting("AI_RATE_LIMIT_MAX", 1, 10000);
  validateIntegerSetting("LLM_TIMEOUT_MS", 1000, 60000);
  validateIntegerSetting("LLM_MAX_RETRIES", 0, 1);
  validateIntegerSetting("MOLING_INTERNAL_TIMEOUT_MS", 1000, 30000);
  validateIntegerSetting("SHUTDOWN_TIMEOUT_MS", 1000, 1200000);
  validateIntegerSetting("AI_AUDIT_RETENTION_DAYS", 1, 365);
  validateIntegerSetting("AI_AUDIT_CLEANUP_BATCH_SIZE", 1, 10000);
  validateIntegerSetting("AI_AUDIT_CLEANUP_MAX_BATCHES", 1, 100);
  validateIntegerSetting("AI_AUDIT_REDACTION_BATCH_SIZE", 1, 100);
  const productionLlmTimeoutMs = Number(configuration.LLM_TIMEOUT_MS || 30000);
  const productionLlmMaxRetries = Number(configuration.LLM_MAX_RETRIES || 1);
  const productionMolingInternalTimeoutMs = Number(configuration.MOLING_INTERNAL_TIMEOUT_MS || 10000);
  const productionShutdownTimeoutMs = Number(configuration.SHUTDOWN_TIMEOUT_MS || 0);
  if (Number.isInteger(productionLlmTimeoutMs) && productionLlmTimeoutMs >= 1000 && productionLlmTimeoutMs <= 60000
      && Number.isInteger(productionLlmMaxRetries) && productionLlmMaxRetries >= 0 && productionLlmMaxRetries <= 1
      && Number.isInteger(productionMolingInternalTimeoutMs) && productionMolingInternalTimeoutMs >= 1000 && productionMolingInternalTimeoutMs <= 30000
      && configuration.SHUTDOWN_TIMEOUT_MS !== undefined) {
    const minimumShutdownTimeoutMs = productionLlmTimeoutMs * (productionLlmMaxRetries + 1) * 5 + productionMolingInternalTimeoutMs * 5 + 30000;
    if (productionShutdownTimeoutMs < minimumShutdownTimeoutMs) {
      errors.push(`SHUTDOWN_TIMEOUT_MS 必须不少于当前模型配置最坏链路 ${minimumShutdownTimeoutMs} 毫秒`);
    }
  }
  if (configuration.ACCESS_LOG_ENABLED !== undefined && !["true", "false"].includes(configuration.ACCESS_LOG_ENABLED)) {
    errors.push("ACCESS_LOG_ENABLED 必须为 true 或 false");
  }
  return [...new Set(errors)];
}

const usageCosts = {
  word_template_agent: 2,
  word_outline_generate: 1,
  word_body_generate: 5,
  word_polish: 2,
  word_export_docx: 1
};

const publicErrorPatterns = [
  { pattern: /session expired|登录已过期|会话已过期/i, message: "墨灵登录已过期，请从墨灵平台重新进入。" },
  { pattern: /Missing Moling launch ticket|launch ticket/i, message: "请从墨灵平台重新进入应用。" },
  { pattern: /ticket app mismatch|ticket product mismatch/i, message: "墨灵入口信息与当前应用不匹配，请检查平台应用配置。" },
  { pattern: /insufficient|no usable plan|60005|quota|余额不足/i, message: "积分不足，请购买套餐后继续使用。" },
  { pattern: /DATABASE_URL|ECONNREFUSED|ER_ACCESS_DENIED|ER_BAD_DB_ERROR|mysql/i, message: "文档服务暂时不可用，请稍后重试。" },
  { pattern: /MinIO|S3|bucket|STORAGE_|getObject|putObject/i, message: "文件导出服务暂时不可用，请稍后重试。" },
  { pattern: /INTERNAL_API_TOKEN|Moling internal API|app-launch|user-entitlements/i, message: "墨灵平台连接暂时不可用，请稍后重试。" },
  { pattern: /LLM|AI request|chat\/completions|API key|401|403|429|timeout|aborted|fetch/i, message: "AI 服务暂时不可用，请稍后重试。" },
  { pattern: /Document not found|File not found/i, message: "资源不存在或已被删除。" }
];

function toPublicErrorMessage(error, fallback = "操作失败，请稍后重试。") {
  const rawMessage = error instanceof Error ? error.message : String(error || "");
  const matched = publicErrorPatterns.find((item) => item.pattern.test(rawMessage));
  return matched?.message || fallback;
}

function sendError(response, error, status = 500, fallback) {
  // 中文注解：接口只返回用户能理解的中文提示，真实错误保留在服务端日志里用于排查。
  console.error(error);
  response.status(error?.httpStatus || status).json({ message: toPublicErrorMessage(error, fallback) });
}

function createPublicError(message, httpStatus = 400) {
  const error = new Error(message);
  error.httpStatus = httpStatus;
  return error;
}

function createMinioClient() {
  if (!process.env.STORAGE_ENDPOINT || !process.env.STORAGE_ACCESS_KEY_ID || !process.env.STORAGE_SECRET_ACCESS_KEY) {
    return null;
  }

  const endpointUrl = new URL(process.env.STORAGE_ENDPOINT);

  return new MinioClient({
    endPoint: endpointUrl.hostname,
    port: Number(endpointUrl.port || (endpointUrl.protocol === "https:" ? 443 : 80)),
    useSSL: endpointUrl.protocol === "https:",
    accessKey: process.env.STORAGE_ACCESS_KEY_ID,
    secretKey: process.env.STORAGE_SECRET_ACCESS_KEY
  });
}

function jsonString(value) {
  return value == null ? null : JSON.stringify(value);
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function importedTextToHtml(value = "") {
  // 中文注解：PDF 通常只能提供文本流，这里按空行恢复段落，避免把整份文件塞进一个段落。
  return String(value)
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.split("\n").map((line) => line.trim()).filter(Boolean).join(" "))
    .filter(Boolean)
    .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
    .join("") || "<p></p>";
}

function sanitizeImportedHtml(value = "") {
  // 中文注解：导入内容只放行编辑器可承载的安全样式和受控外链，避免脚本与存储细节进入前端。
  return sanitizeHtml(String(value), {
    allowedTags: ["h1", "h2", "h3", "h4", "h5", "h6", "p", "span", "strong", "b", "em", "i", "u", "s", "mark", "sup", "sub", "a", "ul", "ol", "li", "blockquote", "br", "table", "tbody", "thead", "tr", "th", "td", "img", "div"],
    allowedAttributes: {
      h1: ["style", "data-outline-level", "data-indent", "data-bidirectional", "data-keep-next", "data-keep-lines", "data-page-break-before", "data-widow-control", "data-tab-stops", "data-paragraph-shading", "data-paragraph-borders"],
      h2: ["style", "data-outline-level", "data-indent", "data-bidirectional", "data-keep-next", "data-keep-lines", "data-page-break-before", "data-widow-control", "data-tab-stops", "data-paragraph-shading", "data-paragraph-borders"],
      h3: ["style", "data-outline-level", "data-indent", "data-bidirectional", "data-keep-next", "data-keep-lines", "data-page-break-before", "data-widow-control", "data-tab-stops", "data-paragraph-shading", "data-paragraph-borders"],
      h4: ["style", "data-outline-level", "data-indent", "data-bidirectional", "data-keep-next", "data-keep-lines", "data-page-break-before", "data-widow-control", "data-tab-stops", "data-paragraph-shading", "data-paragraph-borders"],
      h5: ["style", "data-outline-level", "data-indent", "data-bidirectional", "data-keep-next", "data-keep-lines", "data-page-break-before", "data-widow-control", "data-tab-stops", "data-paragraph-shading", "data-paragraph-borders"],
      h6: ["style", "data-outline-level", "data-indent", "data-bidirectional", "data-keep-next", "data-keep-lines", "data-page-break-before", "data-widow-control", "data-tab-stops", "data-paragraph-shading", "data-paragraph-borders"],
      p: ["style", "data-outline-level", "data-indent", "data-bidirectional", "data-keep-next", "data-keep-lines", "data-page-break-before", "data-widow-control", "data-tab-stops", "data-paragraph-shading", "data-paragraph-borders"],
      li: ["style", "data-indent", "data-keep-next", "data-keep-lines", "data-page-break-before", "data-widow-control", "data-tab-stops", "data-paragraph-shading", "data-paragraph-borders"],
      span: ["style", "class", "data-docx-tab", "data-tab-position", "data-tab-alignment", "data-double-strike", "data-footnote-id", "data-footnote-text", "data-endnote-id", "data-endnote-text", "data-comment-id", "data-comment-text", "data-comment-author", "data-comment-initials", "data-comment-date", "data-revision-type", "data-revision-id", "data-revision-author", "data-revision-date"],
      mark: ["data-highlight", "style"],
      a: ["href", "target", "rel"],
      ol: ["style", "data-list-format", "start"],
      table: ["style", "data-table-width-type", "data-table-width-value", "data-table-grid-width", "data-table-layout", "data-table-alignment", "data-table-indent", "data-table-cell-spacing", "data-table-borders"],
      tr: ["style", "data-row-height", "data-row-height-rule", "data-row-cant-split", "data-row-repeat-header"],
      th: ["style", "colspan", "rowspan", "colwidth", "data-docx-cell", "data-cell-margins", "data-cell-vertical-align", "data-cell-text-direction", "data-cell-shading", "data-cell-borders"],
      td: ["style", "colspan", "rowspan", "colwidth", "data-docx-cell", "data-cell-margins", "data-cell-vertical-align", "data-cell-text-direction", "data-cell-shading", "data-cell-borders"],
      img: ["src", "alt", "style", "width", "height", "data-docx-floating", "data-docx-wrap", "data-docx-float-align"],
      div: ["data-page-break", "data-column-break", "data-section-break", "data-section-layout", "class"]
    },
    allowedSchemes: ["data", "http", "https", "mailto"],
    allowedStyles: {
      "*": {
        color: [/^#[0-9a-f]{6}$/i, /^rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)$/i],
        "font-family": [/^[\w\s"',.-\u4e00-\u9fa5]+$/],
        "font-size": [/^\d+(?:\.\d+)?(?:px|pt|em|rem)$/],
        "font-weight": [/^(?:bold|[1-9]00)$/],
        "font-style": [/^italic$/],
        "font-variant-caps": [/^(?:normal|small-caps)$/],
        "text-transform": [/^(?:none|uppercase)$/],
        "list-style-type": [/^(?:decimal|upper-roman|lower-roman|upper-alpha|lower-alpha)$/],
        "letter-spacing": [/^normal$/, /^-?\d+(?:\.\d+)?pt$/],
        "vertical-align": [/^baseline$/, /^-?\d+(?:\.\d+)?pt$/],
        "text-decoration-line": [/^(?:underline|line-through)$/],
        "text-decoration-style": [/^(?:solid|double|dotted|dashed|wavy)$/],
        "text-decoration-color": [/^#[0-9a-f]{6}$/i],
        "--word-underline-type": [/^(?:single|words|double|thick|dotted|dottedHeavy|dash|dashedHeavy|dashLong|dashLongHeavy|dotDash|dashDotHeavy|dotDotDash|dashDotDotHeavy|wave|wavyHeavy|wavyDouble)$/],
        "--word-text-border": [/^(?:single|dashed|dashSmallGap|dotted|dotDash|dotDotDash|double|thick|none|nil),(?:0|[1-9]\d?),[0-9a-f]{6},(?:[0-9]|[12]\d|3[01])$/i],
        "background-color": [/^#[0-9a-f]{6}$/i],
        "text-align": [/^(?:left|center|right|justify)$/],
        direction: [/^(?:ltr|rtl)$/],
        "text-indent": [/^-?\d+(?:\.\d+)?(?:px|pt|em|rem)$/],
        "line-height": [/^\d+(?:\.\d+)?(?:px|pt|em|rem|%)?$/],
        "--word-line-rule": [/^(?:auto|exact|atLeast)$/],
        // 中文注解：表格居中和右对齐依赖受控的 auto 外边距，清洗时必须保留，否则导入后视觉位置会丢失。
        "margin-left": [/^auto$/, /^-?\d+(?:\.\d+)?(?:px|pt|em|rem)$/],
        "margin-right": [/^auto$/, /^\d+(?:\.\d+)?(?:px|pt|em|rem)$/],
        "margin-top": [/^\d+(?:\.\d+)?(?:px|pt|em|rem)$/],
        "margin-bottom": [/^\d+(?:\.\d+)?(?:px|pt|em|rem)$/],
        "padding-top": [/^\d+(?:\.\d+)?px$/],
        "padding-right": [/^\d+(?:\.\d+)?px$/],
        "padding-bottom": [/^\d+(?:\.\d+)?px$/],
        "padding-left": [/^\d+(?:\.\d+)?px$/],
        // 中文注解：浏览器会把四边相同的字符边框合并为简写，保存时必须保留这些安全值供分页预览使用。
        padding: [/^\d+(?:\.\d+)?px$/],
        "border-width": [/^\d+(?:\.\d+)?px$/],
        "border-style": [/^(?:solid|dashed|dotted|double)$/],
        "border-color": [/^#[0-9a-f]{6}$/i, /^rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)$/i],
        "border-top": [/^(?:none|\d+(?:\.\d+)?px (?:solid|dashed|dotted|double) #[0-9a-f]{6})$/i],
        "border-right": [/^(?:none|\d+(?:\.\d+)?px (?:solid|dashed|dotted|double) #[0-9a-f]{6})$/i],
        "border-bottom": [/^(?:none|\d+(?:\.\d+)?px (?:solid|dashed|dotted|double) #[0-9a-f]{6})$/i],
        "border-left": [/^(?:none|\d+(?:\.\d+)?px (?:solid|dashed|dotted|double) #[0-9a-f]{6})$/i]
      },
      img: {
        width: [/^\d+(?:\.\d+)?(?:px|%)$/],
        height: [/^auto$/, /^\d+(?:\.\d+)?px$/],
        "max-width": [/^100%$/],
        display: [/^block$/],
        margin: [/^0 auto$/],
        "margin-top": [/^\d+(?:\.\d+)?px$/],
        "margin-right": [/^\d+(?:\.\d+)?px$/],
        "margin-bottom": [/^\d+(?:\.\d+)?px$/],
        "margin-left": [/^\d+(?:\.\d+)?px$/],
        float: [/^(?:left|right)$/],
        clear: [/^(?:left|right|both)$/]
      },
      table: {
        width: [/^\d+(?:\.\d+)?(?:px|%)$/],
        "table-layout": [/^(?:fixed|auto)$/],
        "border-collapse": [/^(?:collapse|separate)$/],
        "border-spacing": [/^\d+(?:\.\d+)?px$/]
      },
      tr: {
        height: [/^\d+(?:\.\d+)?px$/]
      },
      th: {
        "padding-top": [/^\d+(?:\.\d+)?px$/],
        "padding-right": [/^\d+(?:\.\d+)?px$/],
        "padding-bottom": [/^\d+(?:\.\d+)?px$/],
        "padding-left": [/^\d+(?:\.\d+)?px$/],
        "vertical-align": [/^(?:top|middle|bottom)$/],
        "writing-mode": [/^(?:horizontal-tb|sideways-rl|sideways-lr)$/],
        "background-color": [/^#[0-9a-f]{6}$/i],
        "border-top": [/^(?:none|\d+(?:\.\d+)?px (?:solid|dashed|dotted|double) #[0-9a-f]{6})$/i],
        "border-right": [/^(?:none|\d+(?:\.\d+)?px (?:solid|dashed|dotted|double) #[0-9a-f]{6})$/i],
        "border-bottom": [/^(?:none|\d+(?:\.\d+)?px (?:solid|dashed|dotted|double) #[0-9a-f]{6})$/i],
        "border-left": [/^(?:none|\d+(?:\.\d+)?px (?:solid|dashed|dotted|double) #[0-9a-f]{6})$/i]
      },
      td: {
        "padding-top": [/^\d+(?:\.\d+)?px$/],
        "padding-right": [/^\d+(?:\.\d+)?px$/],
        "padding-bottom": [/^\d+(?:\.\d+)?px$/],
        "padding-left": [/^\d+(?:\.\d+)?px$/],
        "vertical-align": [/^(?:top|middle|bottom)$/],
        "writing-mode": [/^(?:horizontal-tb|sideways-rl|sideways-lr)$/],
        "background-color": [/^#[0-9a-f]{6}$/i],
        "border-top": [/^(?:none|\d+(?:\.\d+)?px (?:solid|dashed|dotted|double) #[0-9a-f]{6})$/i],
        "border-right": [/^(?:none|\d+(?:\.\d+)?px (?:solid|dashed|dotted|double) #[0-9a-f]{6})$/i],
        "border-bottom": [/^(?:none|\d+(?:\.\d+)?px (?:solid|dashed|dotted|double) #[0-9a-f]{6})$/i],
        "border-left": [/^(?:none|\d+(?:\.\d+)?px (?:solid|dashed|dotted|double) #[0-9a-f]{6})$/i]
      }
    }
  });
}

function firstValue(attributes = {}, names = []) {
  for (const name of names) {
    if (attributes[name] != null) return attributes[name];
  }
  return "";
}

function xmlChildren(node, name = "") {
  return (node?.children || []).filter((child) => child.type === "tag" && (!name || child.name === name));
}

function xmlChild(node, name) {
  return xmlChildren(node, name)[0] || null;
}

function xmlDescendants(node, name, result = []) {
  for (const child of node?.children || []) {
    if (child.type === "tag" && child.name === name) result.push(child);
    if (child.children?.length) xmlDescendants(child, name, result);
  }
  return result;
}

function xmlVal(node) {
  return firstValue(node?.attribs, ["w:val", "val"]);
}

function escapeCssString(value = "") {
  return String(value).replace(/[;"<>]/g, "").trim();
}

function wordColor(value = "") {
  if (!value || value === "auto") return "";
  return /^[0-9a-f]{6}$/i.test(value) ? `#${value}` : "";
}

function wordHalfPointToPt(value = "") {
  const size = Number.parseFloat(value);
  return Number.isFinite(size) && size > 0 ? `${size / 2}pt` : "";
}

function wordTwipToPt(value = "") {
  const twip = Number.parseFloat(value);
  return Number.isFinite(twip) && twip > 0 ? `${Math.round((twip / 20) * 10) / 10}pt` : "";
}

function wordSpacingToPt(value = "") {
  const twip = Number.parseFloat(value);
  return Number.isFinite(twip) && twip >= 0 ? `${Math.round((twip / 20) * 10) / 10}pt` : "";
}

function wordLineHeightToCss(spacingNode) {
  const line = Number.parseFloat(firstValue(spacingNode?.attribs, ["w:line", "line"]));
  if (!Number.isFinite(line) || line <= 0) return "";
  const lineRule = firstValue(spacingNode?.attribs, ["w:lineRule", "lineRule"]);
  // 中文注解：Word 的 auto 行距以 240 为单倍，固定值和最小值则使用 twip，转换后交给浏览器参与分页测量。
  if (!lineRule || lineRule === "auto") return String(Math.round((line / 240) * 100) / 100);
  return wordSpacingToPt(line);
}

function wordTwipToIndentLevel(value = "") {
  const twip = Number.parseFloat(value);
  return Number.isFinite(twip) && twip > 0 ? Math.max(1, Math.min(Math.round(twip / 240), 6)) : 0;
}

function cssText(styles = {}) {
  return Object.entries(styles)
    .filter(([name, value]) => !name.startsWith("$") && Boolean(value))
    .map(([name, value]) => `${name}: ${value}`)
    .join("; ");
}

function wordToggleEnabled(node) {
  if (!node) return false;
  return !["0", "false", "none", "off"].includes(String(xmlVal(node) || "").toLowerCase());
}

const docxHighlightCssColors = {
  black: "#000000",
  blue: "#0000FF",
  cyan: "#00FFFF",
  darkBlue: "#000080",
  darkCyan: "#008080",
  darkGray: "#808080",
  darkGreen: "#008000",
  darkMagenta: "#800080",
  darkRed: "#800000",
  darkYellow: "#808000",
  green: "#00FF00",
  lightGray: "#C0C0C0",
  magenta: "#FF00FF",
  red: "#FF0000",
  white: "#FFFFFF",
  yellow: "#FFFF00"
};

function normalizeDocxHighlight(value = "") {
  const name = String(value || "");
  return Object.prototype.hasOwnProperty.call(docxHighlightCssColors, name) ? name : "";
}

function parseDocxThemeFonts(themeXml = "") {
  if (!themeXml.trim()) return {};
  const document = parseDocument(themeXml, { xmlMode: true });
  const family = (name) => {
    const node = xmlDescendants(document, name)[0];
    const latin = firstValue(xmlChild(node, "a:latin")?.attribs, ["typeface", "a:typeface"]);
    const eastAsia = firstValue(xmlChild(node, "a:ea")?.attribs, ["typeface", "a:typeface"]);
    const scriptFonts = new Map(xmlChildren(node, "a:font").map((font) => [firstValue(font.attribs, ["script", "a:script"]), firstValue(font.attribs, ["typeface", "a:typeface"])]));
    return {
      latin,
      eastAsia: eastAsia || scriptFonts.get("Hans") || scriptFonts.get("Hant") || scriptFonts.get("Jpan") || scriptFonts.get("Hang") || latin,
      hans: scriptFonts.get("Hans") || eastAsia || latin,
      hant: scriptFonts.get("Hant") || eastAsia || scriptFonts.get("Hans") || latin,
      jpan: scriptFonts.get("Jpan") || eastAsia || latin,
      hang: scriptFonts.get("Hang") || eastAsia || latin
    };
  };
  const major = family("a:majorFont");
  const minor = family("a:minorFont");
  return {
    majorAscii: major.latin,
    majorHAnsi: major.latin,
    majorEastAsia: major.eastAsia,
    majorHans: major.hans,
    majorHant: major.hant,
    majorJpan: major.jpan,
    majorHang: major.hang,
    minorAscii: minor.latin,
    minorHAnsi: minor.latin,
    minorEastAsia: minor.eastAsia,
    minorHans: minor.hans,
    minorHant: minor.hant,
    minorJpan: minor.jpan,
    minorHang: minor.hang
  };
}

function parseDocxThemeColors(themeXml = "") {
  if (!themeXml.trim()) return {};
  const document = parseDocument(themeXml, { xmlMode: true });
  const scheme = xmlDescendants(document, "a:clrScheme")[0];
  const colors = {};
  for (const item of xmlChildren(scheme)) {
    const key = item.name.replace(/^a:/, "");
    const colorNode = xmlChildren(item)[0];
    const primary = firstValue(colorNode?.attribs, ["val", "a:val"]);
    const value = /^[0-9a-f]{6}$/i.test(String(primary || "")) ? primary : firstValue(colorNode?.attribs, ["lastClr", "a:lastClr"]);
    if (/^[0-9a-f]{6}$/i.test(String(value || ""))) colors[key] = `#${String(value).toUpperCase()}`;
  }
  return colors;
}

function transformDocxThemeColor(color, tintValue = "", shadeValue = "") {
  if (!/^#[0-9a-f]{6}$/i.test(String(color || ""))) return color;
  const tint = /^[0-9a-f]{2}$/i.test(String(tintValue || "")) ? Number.parseInt(tintValue, 16) / 255 : null;
  const shade = /^[0-9a-f]{2}$/i.test(String(shadeValue || "")) ? Number.parseInt(shadeValue, 16) / 255 : null;
  const channels = [1, 3, 5].map((start) => Number.parseInt(color.slice(start, start + 2), 16)).map((channel) => {
    let value = channel;
    if (shade !== null) value *= shade;
    if (tint !== null) value += (255 - value) * tint;
    return Math.max(0, Math.min(Math.round(value), 255));
  });
  return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

function parseRunProperties(rPr, themeFonts = {}, themeColors = {}) {
  const styles = {};
  if (!rPr) return styles;
  const fonts = xmlChild(rPr, "w:rFonts");
  const eastAsiaTheme = firstValue(fonts?.attribs, ["w:eastAsiaTheme", "eastAsiaTheme"]);
  const latinTheme = firstValue(fonts?.attribs, ["w:asciiTheme", "asciiTheme", "w:hAnsiTheme", "hAnsiTheme"]);
  const eastAsiaFont = escapeCssString(firstValue(fonts?.attribs, ["w:eastAsia", "eastAsia"]) || themeFonts[eastAsiaTheme]);
  const latinFont = escapeCssString(firstValue(fonts?.attribs, ["w:ascii", "ascii", "w:hAnsi", "hAnsi"]) || themeFonts[latinTheme]);
  const fontFamily = eastAsiaFont || latinFont;
  if (eastAsiaFont) styles.$fontEastAsia = eastAsiaFont;
  const themePrefix = String(eastAsiaTheme || "").startsWith("major") ? "major" : String(eastAsiaTheme || "").startsWith("minor") ? "minor" : "";
  if (themePrefix) {
    styles.$fontHans = themeFonts[`${themePrefix}Hans`] || eastAsiaFont;
    styles.$fontHant = themeFonts[`${themePrefix}Hant`] || eastAsiaFont;
    styles.$fontJpan = themeFonts[`${themePrefix}Jpan`] || eastAsiaFont;
    styles.$fontHang = themeFonts[`${themePrefix}Hang`] || eastAsiaFont;
  } else if (eastAsiaFont) {
    styles.$fontHans = eastAsiaFont;
    styles.$fontHant = eastAsiaFont;
    styles.$fontJpan = eastAsiaFont;
    styles.$fontHang = eastAsiaFont;
  }
  if (latinFont) styles.$fontLatin = latinFont;
  const language = firstValue(xmlChild(rPr, "w:lang")?.attribs, ["w:eastAsia", "eastAsia"]);
  if (language) styles.$eastAsiaLanguage = language;
  if (fontFamily) styles["font-family"] = `"${fontFamily}"`;
  const size = wordHalfPointToPt(xmlVal(xmlChild(rPr, "w:sz")));
  if (size) styles["font-size"] = size;
  const colorNode = xmlChild(rPr, "w:color");
  const themeColor = themeColors[firstValue(colorNode?.attribs, ["w:themeColor", "themeColor"])];
  const color = themeColor
    ? transformDocxThemeColor(themeColor, firstValue(colorNode?.attribs, ["w:themeTint", "themeTint"]), firstValue(colorNode?.attribs, ["w:themeShade", "themeShade"]))
    : wordColor(xmlVal(colorNode));
  if (color) styles.color = color;
  const bold = xmlChild(rPr, "w:b");
  const italic = xmlChild(rPr, "w:i");
  const allCaps = xmlChild(rPr, "w:caps");
  const smallCaps = xmlChild(rPr, "w:smallCaps");
  const underline = xmlChild(rPr, "w:u");
  const strike = xmlChild(rPr, "w:strike");
  const doubleStrike = xmlChild(rPr, "w:dstrike");
  const highlight = normalizeDocxHighlight(xmlVal(xmlChild(rPr, "w:highlight")));
  const verticalAlign = xmlVal(xmlChild(rPr, "w:vertAlign"));
  const characterSpacingNode = xmlChild(rPr, "w:spacing");
  const characterSpacing = Number(xmlVal(characterSpacingNode));
  if (characterSpacingNode && Number.isFinite(characterSpacing)) {
    // 中文注解：Word 字符间距使用二十分之一磅，转换为 CSS 磅值后浏览器换行宽度才能与导出接近。
    styles["letter-spacing"] = characterSpacing === 0 ? "normal" : `${characterSpacing / 20}pt`;
  }
  const positionNode = xmlChild(rPr, "w:position");
  const positionValue = String(xmlVal(positionNode) || "").trim();
  const positionPt = /^-?\d+(?:\.\d+)?pt$/i.test(positionValue) ? Number.parseFloat(positionValue) : Number(positionValue) / 2;
  if (positionNode && Number.isFinite(positionPt)) {
    // 中文注解：Word 的数字位置值以半磅计；正值上移、负值下移，与 CSS vertical-align 的方向一致。
    styles["vertical-align"] = positionPt === 0 ? "baseline" : `${positionPt}pt`;
  }
  const textBorder = parseDocxBorderElement(xmlChild(rPr, "w:bdr"), themeColors);
  if (textBorder) {
    const borderColor = String(textBorder.color || "#000000").replace("#", "").toUpperCase();
    const borderSpace = Number(textBorder.space) || 0;
    styles["--word-text-border"] = `${textBorder.style},${textBorder.size},${borderColor},${borderSpace}`;
    for (const side of ["top", "right", "bottom", "left"]) styles[`border-${side}`] = docxBorderCss(textBorder);
    if (borderSpace > 0) {
      const padding = `${Math.round(borderSpace * 96 / 72 * 100) / 100}px`;
      for (const side of ["top", "right", "bottom", "left"]) styles[`padding-${side}`] = padding;
    }
  }
  if (bold) {
    styles.$bold = wordToggleEnabled(bold) ? "1" : "0";
    if (styles.$bold === "1") styles["font-weight"] = "bold";
  }
  if (italic) {
    styles.$italic = wordToggleEnabled(italic) ? "1" : "0";
    if (styles.$italic === "1") styles["font-style"] = "italic";
  }
  if (allCaps) styles["text-transform"] = wordToggleEnabled(allCaps) ? "uppercase" : "none";
  if (smallCaps) styles["font-variant-caps"] = wordToggleEnabled(smallCaps) ? "small-caps" : "normal";
  if (underline) {
    const enabled = wordToggleEnabled(underline);
    const underlineType = String(xmlVal(underline) || "single");
    const underlineThemeColor = themeColors[firstValue(underline.attribs, ["w:themeColor", "themeColor"])];
    const underlineColor = underlineThemeColor
      ? transformDocxThemeColor(underlineThemeColor, firstValue(underline.attribs, ["w:themeTint", "themeTint"]), firstValue(underline.attribs, ["w:themeShade", "themeShade"]))
      : wordColor(firstValue(underline.attribs, ["w:color", "color"]));
    if (!enabled) {
      styles.$underline = "0";
    } else if (underlineType === "single" && !underlineColor) {
      styles.$underline = "1";
    } else {
      const cssUnderlineStyles = {
        double: "double",
        dotted: "dotted",
        dottedHeavy: "dotted",
        dotDash: "dotted",
        dashDotHeavy: "dotted",
        dotDotDash: "dotted",
        dashDotDotHeavy: "dotted",
        dash: "dashed",
        dashedHeavy: "dashed",
        dashLong: "dashed",
        dashLongHeavy: "dashed",
        wave: "wavy",
        wavyHeavy: "wavy",
        wavyDouble: "wavy"
      };
      // 中文注解：CSS 负责在线可见效果，自定义属性保留 Word 的精确下划线枚举供再次导出。
      styles.$underline = "style";
      styles["text-decoration-line"] = "underline";
      styles["text-decoration-style"] = cssUnderlineStyles[underlineType] || "solid";
      styles["--word-underline-type"] = underlineType;
      if (underlineColor) styles["text-decoration-color"] = underlineColor;
    }
  }
  if (strike) styles.$strike = wordToggleEnabled(strike) ? "1" : "0";
  if (doubleStrike) {
    styles.$doubleStrike = wordToggleEnabled(doubleStrike) ? "1" : "0";
    if (styles.$doubleStrike === "1") {
      // 中文注解：双删除线不能降级成 s 标签；受控 data 属性保存 Word 语义，CSS 提供编辑与分页视觉。
      styles["text-decoration-line"] = "line-through";
      styles["text-decoration-style"] = "double";
    }
  }
  if (highlight) styles.$highlight = highlight;
  if (["superscript", "subscript"].includes(verticalAlign)) styles.$verticalAlign = verticalAlign;
  return styles;
}

function wordScriptForText(text = "", styles = {}) {
  const value = String(text);
  const language = String(styles.$eastAsiaLanguage || "").toLowerCase();
  if (/^[\p{Script=Latin}\p{Number}]+$/u.test(value)) return "latin";
  if (/[\u3040-\u30ff]/u.test(value)) return "jpan";
  if (/[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/u.test(value)) return "hang";
  if (/[\u3400-\u9fff\uf900-\ufaff]/u.test(value)) {
    if (/^ja/.test(language)) return "jpan";
    if (/^ko/.test(language)) return "hang";
    if (/^(?:zh-(?:tw|hk|mo)|zh-hant)/.test(language) || /[測試標題體臺灣龍門學國書會來時萬與專業頁發後這還讓開關實現為]/u.test(value)) return "hant";
    return "hans";
  }
  return "latin";
}

function applyWordScriptFont(styles, text = "", explicitScript = "") {
  const script = explicitScript || wordScriptForText(text, styles);
  const fontFamily = script === "jpan" ? (styles.$fontJpan || styles.$fontEastAsia || styles.$fontLatin)
    : script === "hang" ? (styles.$fontHang || styles.$fontEastAsia || styles.$fontLatin)
      : script === "hant" ? (styles.$fontHant || styles.$fontEastAsia || styles.$fontLatin)
        : script === "hans" ? (styles.$fontHans || styles.$fontEastAsia || styles.$fontLatin)
          : (styles.$fontLatin || styles.$fontEastAsia);
  if (fontFamily) styles["font-family"] = `"${fontFamily}"`;
  return styles;
}

function splitWordTextByScript(text = "", styles = {}) {
  const segments = [];
  for (const character of Array.from(String(text))) {
    const isNeutral = /[\s\p{P}\p{S}]/u.test(character);
    const script = isNeutral && segments.length ? segments[segments.length - 1].script : wordScriptForText(character, styles);
    const current = segments[segments.length - 1];
    if (current?.script === script) current.text += character;
    else segments.push({ script, text: character });
  }
  return segments;
}

function parseParagraphProperties(pPr, themeColors = {}) {
  const styles = {};
  const rawOutlineLevel = xmlVal(xmlChild(pPr, "w:outlineLvl"));
  const outlineLevel = rawOutlineLevel === "" ? NaN : Number(rawOutlineLevel);
  if (Number.isInteger(outlineLevel) && outlineLevel >= 0 && outlineLevel <= 8) styles.$outlineLevel = String(outlineLevel);
  const align = xmlVal(xmlChild(pPr, "w:jc"));
  if (["left", "center", "right", "both", "justify"].includes(align)) styles["text-align"] = align === "both" ? "justify" : align;
  const indent = xmlChild(pPr, "w:ind");
  const firstLine = firstValue(indent?.attribs, ["w:firstLine", "firstLine"]);
  const hanging = firstValue(indent?.attribs, ["w:hanging", "hanging"]);
  const left = firstValue(indent?.attribs, ["w:left", "left", "w:start", "start"]);
  const right = firstValue(indent?.attribs, ["w:right", "right", "w:end", "end"]);
  // 中文注解：悬挂缩进必须用负首行缩进配合左边距，浏览器换行起点才与 Word 一致。
  if (Number(hanging) > 0) styles["text-indent"] = `-${wordTwipToPt(hanging)}`;
  else if (firstLine) styles["text-indent"] = wordTwipToPt(firstLine);
  if (left) styles["margin-left"] = wordTwipToPt(left);
  if (right) styles["margin-right"] = wordTwipToPt(right);
  const spacing = xmlChild(pPr, "w:spacing");
  const before = wordSpacingToPt(firstValue(spacing?.attribs, ["w:before", "before"]));
  const after = wordSpacingToPt(firstValue(spacing?.attribs, ["w:after", "after"]));
  const lineHeight = wordLineHeightToCss(spacing);
  const lineRule = firstValue(spacing?.attribs, ["w:lineRule", "lineRule"]);
  if (before) styles["margin-top"] = before;
  if (after) styles["margin-bottom"] = after;
  if (lineHeight) styles["line-height"] = lineHeight;
  if (["exact", "atLeast"].includes(lineRule)) styles["--word-line-rule"] = lineRule;
  const paginationProperties = [
    ["w:keepNext", "$keepNext"],
    ["w:keepLines", "$keepLines"],
    ["w:pageBreakBefore", "$pageBreakBefore"],
    ["w:widowControl", "$widowControl"]
  ];
  for (const [elementName, styleName] of paginationProperties) {
    const element = xmlChild(pPr, elementName);
    if (element) styles[styleName] = wordToggleEnabled(element) ? "1" : "0";
  }
  const bidirectional = xmlChild(pPr, "w:bidi");
  if (bidirectional) {
    const enabled = wordToggleEnabled(bidirectional);
    // 中文注解：同时保留 Word 的 bidi 语义和浏览器方向，确保导入后编辑、分页预览与再次导出一致。
    styles.$bidirectional = enabled ? "1" : "0";
    styles.direction = enabled ? "rtl" : "ltr";
  }
  const tabStops = xmlChildren(xmlChild(pPr, "w:tabs"), "w:tab").map((tab) => ({
    alignment: firstValue(tab.attribs, ["w:val", "val"]),
    position: Math.round(Number(firstValue(tab.attribs, ["w:pos", "pos"])))
  })).filter((tab) => ["left", "center", "right", "decimal", "bar"].includes(tab.alignment) && Number.isFinite(tab.position) && tab.position >= 0 && tab.position <= 31680);
  if (tabStops.length) styles.$tabStops = JSON.stringify(tabStops);
  const shading = parseDocxParagraphShading(xmlChild(pPr, "w:shd"), themeColors);
  const borders = parseDocxBorders(xmlChild(pPr, "w:pBdr"), themeColors, false);
  if (shading) styles.$paragraphShading = JSON.stringify(shading);
  if (Object.keys(borders).length) styles.$paragraphBorders = JSON.stringify(borders);
  // 中文注解：段落间距及行距规则都进入安全样式，后续编辑和再次导出才能保持同一分页语义。
  return styles;
}

function parseDocxStyles(stylesXml = "", themeXml = "") {
  const themeFonts = parseDocxThemeFonts(themeXml);
  const themeColors = parseDocxThemeColors(themeXml);
  const emptyContext = { styleMap: new Map(), defaultParagraphStyleId: "", defaultParagraphStyle: { paragraph: {}, run: {} }, themeFonts, themeColors };
  if (!stylesXml.trim()) return emptyContext;
  const document = parseDocument(stylesXml, { xmlMode: true });
  const docDefaults = xmlDescendants(document, "w:docDefaults")[0];
  const defaultParagraph = parseParagraphProperties(xmlChild(xmlChild(docDefaults, "w:pPrDefault"), "w:pPr"), themeColors);
  const defaultRun = parseRunProperties(xmlChild(xmlChild(docDefaults, "w:rPrDefault"), "w:rPr"), themeFonts, themeColors);
  const rawStyles = new Map();
  let defaultParagraphStyleId = "";

  for (const styleNode of xmlDescendants(document, "w:style")) {
    const styleId = firstValue(styleNode.attribs, ["w:styleId", "styleId"]);
    if (!styleId) continue;
    const pPr = xmlChild(styleNode, "w:pPr");
    const rPr = xmlChild(styleNode, "w:rPr");
    const type = firstValue(styleNode.attribs, ["w:type", "type"]);
    if (type === "paragraph" && firstValue(styleNode.attribs, ["w:default", "default"]) === "1") defaultParagraphStyleId = styleId;
    rawStyles.set(styleId, {
      type,
      name: xmlVal(xmlChild(styleNode, "w:name")) || styleId,
      basedOn: xmlVal(xmlChild(styleNode, "w:basedOn")),
      paragraph: parseParagraphProperties(pPr, themeColors),
      run: parseRunProperties(rPr, themeFonts, themeColors)
    });
  }

  if (!defaultParagraphStyleId && rawStyles.has("Normal")) defaultParagraphStyleId = "Normal";
  const styleMap = new Map();
  const resolveStyle = (styleId, ancestors = new Set()) => {
    if (styleMap.has(styleId)) return styleMap.get(styleId);
    const style = rawStyles.get(styleId);
    if (!style || ancestors.has(styleId)) return { paragraph: defaultParagraph, run: defaultRun };
    const nextAncestors = new Set(ancestors).add(styleId);
    const parent = style.basedOn ? resolveStyle(style.basedOn, nextAncestors) : { paragraph: defaultParagraph, run: defaultRun };
    const resolved = {
      ...style,
      paragraph: { ...defaultParagraph, ...(parent.paragraph || {}), ...style.paragraph },
      run: { ...defaultRun, ...(parent.run || {}), ...style.run }
    };
    styleMap.set(styleId, resolved);
    return resolved;
  };
  for (const styleId of rawStyles.keys()) resolveStyle(styleId);

  // 中文注解：Word 样式按 docDefaults、basedOn、当前样式逐层覆盖，普通段落再继承默认段落样式。
  const defaultParagraphStyle = defaultParagraphStyleId
    ? resolveStyle(defaultParagraphStyleId)
    : { paragraph: defaultParagraph, run: defaultRun };
  return { styleMap, defaultParagraphStyleId, defaultParagraphStyle, themeFonts, themeColors };
}

function parseDocxNumbering(numberingXml = "") {
  // 中文注解：先解析抽象编号层级，再绑定具体 numId，才能从段落编号反查有序或项目符号语义。
  const numbering = new Map();
  if (!numberingXml.trim()) return numbering;
  const document = parseDocument(numberingXml, { xmlMode: true });
  const abstractLevels = new Map();

  for (const abstractNode of xmlDescendants(document, "w:abstractNum")) {
    const abstractId = firstValue(abstractNode.attribs, ["w:abstractNumId", "abstractNumId"]);
    if (!abstractId) continue;
    const levels = new Map();
    for (const levelNode of xmlChildren(abstractNode, "w:lvl")) {
      const level = Number(firstValue(levelNode.attribs, ["w:ilvl", "ilvl"]) || 0);
      levels.set(level, {
        format: xmlVal(xmlChild(levelNode, "w:numFmt")) || "decimal",
        start: normalizeOrderedListStart(xmlVal(xmlChild(levelNode, "w:start")))
      });
    }
    abstractLevels.set(abstractId, levels);
  }

  for (const numberNode of xmlDescendants(document, "w:num")) {
    const numberId = firstValue(numberNode.attribs, ["w:numId", "numId"]);
    const abstractId = xmlVal(xmlChild(numberNode, "w:abstractNumId"));
    if (!numberId || !abstractLevels.has(abstractId)) continue;
    const levels = new Map(abstractLevels.get(abstractId));
    for (const overrideNode of xmlChildren(numberNode, "w:lvlOverride")) {
      const level = Number(firstValue(overrideNode.attribs, ["w:ilvl", "ilvl"]) || 0);
      const nestedLevel = xmlChild(overrideNode, "w:lvl");
      const current = levels.get(level) || { format: "decimal", start: 1 };
      const overrideFormat = xmlVal(xmlChild(nestedLevel, "w:numFmt"));
      const nestedStart = xmlVal(xmlChild(nestedLevel, "w:start"));
      const startOverride = xmlVal(xmlChild(overrideNode, "w:startOverride"));
      levels.set(level, {
        format: overrideFormat || current.format,
        // 中文注解：具体编号实例的 startOverride 优先级高于抽象层级和内嵌 lvl，保证续表、拆分章节的起始序号不被重置。
        start: normalizeOrderedListStart(startOverride || nestedStart || current.start)
      });
    }
    // 中文注解：真实 Word 文件可能通过 lvlOverride 改写某一级编号格式，具体 numId 必须优先采用覆盖值。
    numbering.set(numberId, levels);
  }
  return numbering;
}

function docxListInfo(pPr, style, numbering) {
  const numPr = xmlChild(pPr, "w:numPr");
  const styleText = `${style.name || ""} ${style.id || ""}`;
  if (!numPr && !/list|列表/i.test(styleText)) return null;
  const level = Math.max(0, Math.min(Number(xmlVal(xmlChild(numPr, "w:ilvl")) || 0), 5));
  const numberId = xmlVal(xmlChild(numPr, "w:numId"));
  const numberLevel = numbering.get(numberId)?.get(level);
  const numberFormat = numberLevel?.format;
  // 中文注解：Word 中除 bullet/none 外的编号格式都属于有序列表，包含中文数字、字母和罗马数字。
  const ordered = numberFormat ? !["bullet", "none"].includes(numberFormat) : /number|编号/i.test(styleText);
  return {
    level,
    ordered,
    numberId,
    numberFormat: ordered ? normalizeOrderedListFormat(numberFormat) : "bullet",
    numberStart: ordered ? normalizeOrderedListStart(numberLevel?.start) : 1
  };
}

function docxTextFromRun(runNode) {
  return (runNode.children || [])
    .map((child) => {
      if (child.type === "tag" && ["w:t", "w:delText"].includes(child.name)) return child.children?.map((textNode) => textNode.data || "").join("") || "";
      if (child.type === "tag" && child.name === "w:tab") return "\t";
      if (child.type === "tag" && child.name === "w:softHyphen") return "\u00AD";
      if (child.type === "tag" && child.name === "w:noBreakHyphen") return "\u2011";
      if (child.type === "tag" && child.name === "w:br" && !["page", "column"].includes(firstValue(child.attribs, ["w:type", "type"]))) return "\n";
      return "";
    })
    .join("");
}

function pageBreakHtml() {
  return '<div data-page-break="true" class="page-break-marker"></div>';
}

function columnBreakHtml() {
  return '<div data-column-break="true" class="column-break-marker"></div>';
}

function normalizeSectionBreakType(value) {
  // 中文注解：连续分节会改变同页内版式，当前在线分页器无法等价显示，因此导入和导出统一降级为下一页分节。
  return ["nextPage", "oddPage", "evenPage"].includes(value) ? value : "nextPage";
}

function sectionBreakHtml(pageLayout, breakType = "nextPage") {
  const encodedLayout = escapeHtml(JSON.stringify(normalizePageLayout(pageLayout)));
  return `<div data-section-break="${normalizeSectionBreakType(breakType)}" data-section-layout="${encodedLayout}" class="section-break-marker"></div>`;
}

function imageMimeFromPath(value = "") {
  const extension = String(value).toLowerCase().split(".").pop();
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "gif") return "image/gif";
  if (extension === "webp") return "image/webp";
  return "image/png";
}

function parseDocxRelationships(relsXml = "") {
  const relationships = new Map();
  if (!relsXml.trim()) return relationships;
  const document = parseDocument(relsXml, { xmlMode: true });
  for (const relationship of xmlDescendants(document, "Relationship")) {
    const id = relationship.attribs?.Id;
    const target = relationship.attribs?.Target;
    if (id && target) relationships.set(id, target);
  }
  return relationships;
}

function safeDocumentHyperlink(value = "") {
  const href = String(value).trim().slice(0, 2048);
  if (/^mailto:[^\s@]+@[^\s@]+$/i.test(href)) return href;
  try {
    const url = new URL(href);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

async function readDocxImageDataUrl(zip, relationships, embedId) {
  const target = relationships.get(embedId);
  if (!target) return "";
  const normalizedPath = target.startsWith("/") ? target.slice(1) : `word/${target.replace(/^\.?\//, "")}`;
  const file = zip.file(normalizedPath);
  if (!file) return "";
  const data = await file.async("base64");
  return `data:${imageMimeFromPath(normalizedPath)};base64,${data}`;
}

const docxHorizontalPositionRelativeValues = new Set(["character", "column", "insideMargin", "leftMargin", "margin", "outsideMargin", "page", "rightMargin"]);
const docxVerticalPositionRelativeValues = new Set(["bottomMargin", "insideMargin", "line", "margin", "outsideMargin", "page", "paragraph", "topMargin"]);
const docxHorizontalAlignValues = new Set(["center", "inside", "left", "outside", "right"]);
const docxVerticalAlignValues = new Set(["bottom", "center", "inside", "outside", "top"]);
const docxWrapTypes = new Set(["none", "square", "tight", "topAndBottom"]);
const docxWrapSides = new Set(["bothSides", "left", "right", "largest"]);

function boundedDocxNumber(value, minimum, maximum, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, Math.min(Math.round(number), maximum)) : fallback;
}

function normalizeDocxFloating(value) {
  let source = value;
  if (typeof source === "string") {
    try { source = JSON.parse(source); } catch { return null; }
  }
  if (!source || typeof source !== "object") return null;
  const normalizePosition = (position, relativeValues, alignValues, fallbackRelative) => {
    const relative = relativeValues.has(position?.relative) ? position.relative : fallbackRelative;
    const align = alignValues.has(position?.align) ? position.align : null;
    const hasOffset = Number.isFinite(Number(position?.offset));
    return align
      ? { relative, align, offset: null }
      : { relative, align: null, offset: hasOffset ? boundedDocxNumber(position.offset, -2147483648, 2147483647) : 0 };
  };
  const wrapType = docxWrapTypes.has(source.wrap?.type) ? source.wrap.type : "none";
  return {
    horizontal: normalizePosition(source.horizontal, docxHorizontalPositionRelativeValues, docxHorizontalAlignValues, "column"),
    vertical: normalizePosition(source.vertical, docxVerticalPositionRelativeValues, docxVerticalAlignValues, "paragraph"),
    wrap: {
      type: wrapType,
      side: docxWrapSides.has(source.wrap?.side) ? source.wrap.side : "bothSides"
    },
    margins: {
      top: boundedDocxNumber(source.margins?.top, 0, 9144000),
      right: boundedDocxNumber(source.margins?.right, 0, 9144000),
      bottom: boundedDocxNumber(source.margins?.bottom, 0, 9144000),
      left: boundedDocxNumber(source.margins?.left, 0, 9144000)
    },
    allowOverlap: source.allowOverlap !== false,
    behindDocument: source.behindDocument === true,
    lockAnchor: source.lockAnchor === true,
    layoutInCell: source.layoutInCell !== false,
    zIndex: boundedDocxNumber(source.zIndex, 0, 4294967295, 1)
  };
}

function docxPositionFromAnchor(anchor, name, relativeValues, alignValues, fallbackRelative) {
  const position = xmlDescendants(anchor, name)[0];
  const relative = firstValue(position?.attribs, ["relativeFrom"]);
  const alignText = collectText(xmlChild(position, "wp:align")).trim();
  const offsetText = collectText(xmlChild(position, "wp:posOffset")).trim();
  return {
    relative: relativeValues.has(relative) ? relative : fallbackRelative,
    align: alignValues.has(alignText) ? alignText : null,
    offset: alignValues.has(alignText) ? null : boundedDocxNumber(offsetText, -2147483648, 2147483647, 0)
  };
}

function docxFloatingFromDrawing(container) {
  const anchor = xmlDescendants(container, "wp:anchor")[0];
  if (!anchor) return null;
  const wrapNode = ["wp:wrapSquare", "wp:wrapTight", "wp:wrapTopAndBottom", "wp:wrapNone"]
    .map((name) => xmlDescendants(anchor, name)[0])
    .find(Boolean);
  const wrapTypeByName = { "wp:wrapSquare": "square", "wp:wrapTight": "tight", "wp:wrapTopAndBottom": "topAndBottom", "wp:wrapNone": "none" };
  return normalizeDocxFloating({
    horizontal: docxPositionFromAnchor(anchor, "wp:positionH", docxHorizontalPositionRelativeValues, docxHorizontalAlignValues, "column"),
    vertical: docxPositionFromAnchor(anchor, "wp:positionV", docxVerticalPositionRelativeValues, docxVerticalAlignValues, "paragraph"),
    wrap: { type: wrapTypeByName[wrapNode?.name] || "none", side: firstValue(wrapNode?.attribs, ["wrapText"]) || "bothSides" },
    margins: {
      top: firstValue(anchor.attribs, ["distT"]),
      right: firstValue(anchor.attribs, ["distR"]),
      bottom: firstValue(anchor.attribs, ["distB"]),
      left: firstValue(anchor.attribs, ["distL"])
    },
    allowOverlap: firstValue(anchor.attribs, ["allowOverlap"]) !== "0",
    behindDocument: firstValue(anchor.attribs, ["behindDoc"]) === "1",
    lockAnchor: firstValue(anchor.attribs, ["locked"]) === "1",
    layoutInCell: firstValue(anchor.attribs, ["layoutInCell"]) !== "0",
    zIndex: firstValue(anchor.attribs, ["relativeHeight"])
  });
}

function docxFloatingHtmlAttributes(floating) {
  if (!floating) return { attributes: "", style: "" };
  const horizontalAlign = floating.horizontal.align || "offset";
  const marginPx = Object.fromEntries(Object.entries(floating.margins).map(([side, value]) => [side, Math.round(Number(value) / 9525 * 100) / 100]));
  const styles = [];
  if (["square", "tight"].includes(floating.wrap.type) && ["left", "right"].includes(horizontalAlign)) styles.push(`float: ${horizontalAlign}`);
  if (floating.wrap.type === "topAndBottom") styles.push("clear: both");
  styles.push(`margin-top: ${marginPx.top}px`, `margin-right: ${marginPx.right}px`, `margin-bottom: ${marginPx.bottom}px`, `margin-left: ${marginPx.left}px`);
  return {
    attributes: ` data-docx-floating="${escapeHtml(JSON.stringify(floating))}" data-docx-wrap="${floating.wrap.type}" data-docx-float-align="${horizontalAlign}"`,
    style: styles.join("; ") + "; "
  };
}

function docxPartRelationshipsPath(partPath = "") {
  const normalized = String(partPath).replace(/\\/g, "/");
  const slash = normalized.lastIndexOf("/");
  const directory = slash >= 0 ? normalized.slice(0, slash + 1) : "";
  const fileName = slash >= 0 ? normalized.slice(slash + 1) : normalized;
  return `${directory}_rels/${fileName}.rels`;
}

function resolveDocxPartTarget(partPath = "", target = "") {
  if (target.startsWith("/")) return target.slice(1);
  const directory = String(partPath).replace(/\\/g, "/").replace(/[^/]+$/, "");
  const segments = `${directory}${target}`.split("/");
  const resolved = [];
  for (const segment of segments) {
    if (!segment || segment === ".") continue;
    if (segment === "..") resolved.pop();
    else resolved.push(segment);
  }
  return resolved.join("/");
}

async function parseDocxPartImages(zip, part) {
  if (!part?.present || !part.xml || !part.path) return [];
  const relsXml = await zip.file(docxPartRelationshipsPath(part.path))?.async("string") || "";
  const relationships = parseDocxRelationships(relsXml);
  const document = parseDocument(part.xml, { xmlMode: true });
  const paragraphs = xmlDescendants(document, "w:p");
  const images = [];
  for (const [paragraphIndex, paragraph] of paragraphs.entries()) {
    const alignment = ["left", "center", "right"].includes(xmlVal(xmlChild(xmlChild(paragraph, "w:pPr"), "w:jc")))
      ? xmlVal(xmlChild(xmlChild(paragraph, "w:pPr"), "w:jc"))
      : "center";
    const children = xmlChildren(paragraph);
    const firstTextIndex = children.findIndex((child) => child.name === "w:r" && xmlDescendants(child, "w:t").some((text) => (text.children || []).some((value) => String(value.data || "").trim())));
    for (const [childIndex, run] of children.entries()) {
      if (run.name !== "w:r") continue;
      for (const drawing of xmlDescendants(run, "w:drawing")) {
        const blip = xmlDescendants(drawing, "a:blip")[0];
        const embedId = firstValue(blip?.attribs, ["r:embed", "embed"]);
        const target = relationships.get(embedId);
        if (!target) continue;
        const imagePath = resolveDocxPartTarget(part.path, target);
        const imageFile = zip.file(imagePath);
        if (!imageFile) continue;
        const data = await imageFile.async("base64");
        const extent = xmlDescendants(drawing, "wp:extent")[0];
        const widthPx = Number(firstValue(extent?.attribs, ["cx"])) / 9525;
        const heightPx = Number(firstValue(extent?.attribs, ["cy"])) / 9525;
        const properties = xmlDescendants(drawing, "wp:docPr")[0];
        images.push({
          id: `imported-${images.length + 1}`,
          fileId: null,
          src: `data:${imageMimeFromPath(imagePath)};base64,${data}`,
          alt: firstValue(properties?.attribs, ["descr", "name"]) || "导入图片",
          widthPx: widthPx > 0 ? widthPx : 120,
          heightPx: heightPx > 0 ? heightPx : 60,
          paragraphIndex,
          placement: firstTextIndex >= 0 && childIndex < firstTextIndex ? "beforeText" : "afterText",
          alignment
        });
      }
    }
  }
  // 中文注解：页眉页脚图片的关系路径相对各自部件解析，不能复用 document.xml.rels。
  return normalizePageImages(images);
}

async function docxImagesFromRun(runNode, zip, relationships) {
  const images = [];
  const drawings = xmlDescendants(runNode, "w:drawing");
  const imageContainers = drawings.length ? drawings : [runNode];
  for (const container of imageContainers) {
    const blip = xmlDescendants(container, "a:blip")[0];
    if (!blip) continue;
    const embedId = firstValue(blip.attribs, ["r:embed", "embed"]);
    const dataUrl = await readDocxImageDataUrl(zip, relationships, embedId);
    const extent = xmlDescendants(container, "wp:extent")[0];
    const widthEmu = Number.parseFloat(firstValue(extent?.attribs, ["cx"]));
    const heightEmu = Number.parseFloat(firstValue(extent?.attribs, ["cy"]));
    let width = widthEmu / 9525;
    let height = heightEmu / 9525;
    const scale = width > 0 && height > 0 ? Math.min(1, 602 / width, 911 / height) : 1;
    width *= scale;
    height *= scale;
    const sizeStyle = width > 0 && height > 0
      ? `width: ${Math.round(width * 100) / 100}px; height: ${Math.round(height * 100) / 100}px; `
      : "";
    const properties = xmlDescendants(container, "wp:docPr")[0];
    const alt = firstValue(properties?.attribs, ["descr", "title", "name"]) || "导入图片";
    const floatingHtml = docxFloatingHtmlAttributes(docxFloatingFromDrawing(container));
    // 中文注解：Word 图片尺寸使用 EMU，导入时换算为 CSS 像素，在线分页才能按原图占位测量。
    if (dataUrl) images.push(`<img src="${dataUrl}" alt="${escapeHtml(alt)}"${floatingHtml.attributes} style="${sizeStyle}${floatingHtml.style}max-width: 100%;" />`);
  }
  return images;
}

function docxParagraphTag(style = {}, paragraphStyles = {}) {
  const outlineLevel = Number(paragraphStyles.$outlineLevel);
  if (Number.isInteger(outlineLevel) && outlineLevel >= 0 && outlineLevel <= 5) return `h${outlineLevel + 1}`;
  if (Number.isInteger(outlineLevel) && outlineLevel >= 6 && outlineLevel <= 8) return "p";
  const name = `${style.name || ""} ${style.id || ""}`.toLowerCase();
  if (name.includes("title") || name.includes("标题 1") || name.includes("heading 1")) return "h1";
  if (name.includes("标题 2") || name.includes("heading 2")) return "h2";
  if (name.includes("标题 3") || name.includes("heading 3")) return "h3";
  return "p";
}

function normalizeDocxTabStops(value) {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((tab) => ({
      alignment: ["left", "center", "right", "decimal", "bar"].includes(tab?.alignment) ? tab.alignment : "left",
      position: Math.max(0, Math.min(Math.round(Number(tab?.position) || 0), 31680))
    })).filter((tab) => tab.position > 0).slice(0, 50);
  } catch {
    return [];
  }
}

function docxTabHtml(tabState) {
  const index = tabState.index++;
  const stop = tabState.stops[index] || { alignment: "left", position: (index + 1) * 720 };
  return `<span class="docx-tab" data-docx-tab="true" data-tab-position="${stop.position}" data-tab-alignment="${stop.alignment}"></span>`;
}

function normalizeFootnoteId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 && id <= 32767 ? id : null;
}

function normalizeFootnoteText(value = "") {
  // 中文注解：脚注文本限制为常见办公文档可编辑规模，避免异常属性放大保存与导出负担。
  return String(value).replace(/\r\n?/g, "\n").trim().slice(0, 4000);
}

function parseDocxNotes(xml = "", noteName = "footnote") {
  const notes = new Map();
  if (!xml.trim()) return notes;
  const document = parseDocument(xml, { xmlMode: true });
  for (const note of xmlDescendants(document, `w:${noteName}`)) {
    const id = normalizeFootnoteId(firstValue(note.attribs, ["w:id", "id"]));
    if (!id) continue;
    const text = normalizeFootnoteText(xmlDescendants(note, "w:p").map((paragraph) => (
      xmlDescendants(paragraph, "w:t").map((textNode) => (textNode.children || []).map((child) => child.data || "").join("")).join("")
    )).join("\n"));
    if (text) notes.set(id, text);
  }
  return notes;
}

function normalizeCommentId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id >= 0 && id <= 2147483647 ? id : null;
}

function normalizeCommentField(value = "", limit = 200) {
  return String(value).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, limit);
}

function normalizeCommentDate(value = "") {
  const date = new Date(String(value || ""));
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function parseDocxComments(xml = "") {
  const comments = new Map();
  if (!xml.trim()) return comments;
  const document = parseDocument(xml, { xmlMode: true });
  for (const comment of xmlDescendants(document, "w:comment")) {
    const id = normalizeCommentId(firstValue(comment.attribs, ["w:id", "id"]));
    if (id === null) continue;
    const text = normalizeFootnoteText(xmlDescendants(comment, "w:p").map((paragraph) => (
      xmlDescendants(paragraph, "w:t").map((textNode) => (textNode.children || []).map((child) => child.data || "").join("")).join("")
    )).join("\n"));
    if (!text) continue;
    comments.set(id, {
      id,
      text,
      author: normalizeCommentField(firstValue(comment.attribs, ["w:author", "author"])) || "审阅者",
      initials: normalizeCommentField(firstValue(comment.attribs, ["w:initials", "initials"]), 20),
      date: normalizeCommentDate(firstValue(comment.attribs, ["w:date", "date"]))
    });
  }
  return comments;
}

function commentMarkStartHtml(comment) {
  if (!comment) return "";
  const dateAttribute = comment.date ? ` data-comment-date="${escapeHtml(comment.date)}"` : "";
  return `<span class="comment-mark" data-comment-id="${comment.id}" data-comment-text="${escapeHtml(comment.text)}" data-comment-author="${escapeHtml(comment.author)}" data-comment-initials="${escapeHtml(comment.initials)}"${dateAttribute}>`;
}

async function docxRevisionToHtml(revisionNode, revisionType, inheritedRunStyles, context, tabState) {
  const id = normalizeCommentId(firstValue(revisionNode.attribs, ["w:id", "id"]));
  const author = normalizeCommentField(firstValue(revisionNode.attribs, ["w:author", "author"])) || "审阅者";
  const date = normalizeCommentDate(firstValue(revisionNode.attribs, ["w:date", "date"]));
  if (id === null) return "";
  const parts = [];
  for (const child of revisionNode.children || []) {
    if (child.name === "w:r") parts.push(await docxRunToHtml(child, inheritedRunStyles, context, tabState));
    if (child.name === "w:hyperlink") {
      for (const run of xmlChildren(child, "w:r")) parts.push(await docxRunToHtml(run, inheritedRunStyles, context, tabState));
    }
  }
  const content = parts.join("");
  if (!content) return "";
  const className = revisionType === "delete" ? "revision-delete" : "revision-insert";
  const dateAttribute = date ? ` data-revision-date="${escapeHtml(date)}"` : "";
  return `<span class="${className}" data-revision-type="${revisionType}" data-revision-id="${id}" data-revision-author="${escapeHtml(author)}"${dateAttribute}>${content}</span>`;
}

async function docxRunToHtml(runNode, inheritedRunStyles = {}, context = {}, tabState = { stops: [], index: 0 }) {
  const { zip = null, relationships = new Map(), styleMap = new Map(), themeFonts = {}, themeColors = {}, footnotes = new Map(), endnotes = new Map() } = context;
  const text = docxTextFromRun(runNode);
  const imageHtml = zip ? (await docxImagesFromRun(runNode, zip, relationships)).join("") : "";
  const hasBreak = xmlChildren(runNode, "w:br").some((breakNode) => ["page", "column"].includes(firstValue(breakNode.attribs, ["w:type", "type"])));
  const hasFootnoteReference = xmlChildren(runNode, "w:footnoteReference").length > 0;
  const hasEndnoteReference = xmlChildren(runNode, "w:endnoteReference").length > 0;
  if (!text && !imageHtml && !hasBreak && !hasFootnoteReference && !hasEndnoteReference) return "";
  const runProperties = xmlChild(runNode, "w:rPr");
  const characterStyleId = xmlVal(xmlChild(runProperties, "w:rStyle"));
  const characterStyle = styleMap.get(characterStyleId) || { run: {} };
  const baseRunStyles = { ...inheritedRunStyles, ...(characterStyle.run || {}), ...parseRunProperties(runProperties, themeFonts, themeColors) };
  const renderText = (value) => splitWordTextByScript(value, baseRunStyles).map((segment) => {
    const runStyles = applyWordScriptFont({ ...baseRunStyles }, segment.text, segment.script);
    // 中文注解：同一个 Word run 可同时定义西文和东亚字体，按脚本拆成相邻 span 后在线显示和再次导出才能保留混排。
    if (runStyles.$bold === "0") delete runStyles["font-weight"];
    if (runStyles.$italic === "0") delete runStyles["font-style"];
    if (["0", "1"].includes(runStyles.$underline)) {
      // 中文注解：显式关闭或普通单线必须覆盖继承来的高级下划线 CSS，避免字符样式串色。
      delete runStyles["text-decoration-line"];
      delete runStyles["text-decoration-style"];
      delete runStyles["text-decoration-color"];
      delete runStyles["--word-underline-type"];
    }
    let html = escapeHtml(segment.text).replace(/\n/g, "<br>");
    if (runStyles.$underline === "1") html = `<u>${html}</u>`;
    if (runStyles.$italic === "1" || runStyles["font-style"] === "italic") html = `<em>${html}</em>`;
    if (runStyles.$bold === "1" || runStyles["font-weight"] === "bold") html = `<strong>${html}</strong>`;
    if (runStyles.$strike === "1" && runStyles.$doubleStrike !== "1") html = `<s>${html}</s>`;
    if (runStyles.$verticalAlign === "superscript") html = `<sup>${html}</sup>`;
    if (runStyles.$verticalAlign === "subscript") html = `<sub>${html}</sub>`;
    if (runStyles.$highlight) {
      const highlightColor = docxHighlightCssColors[runStyles.$highlight];
      // 中文注解：突出显示保留 Word 的颜色名称，同时写入浏览器颜色，在线显示和再次导出使用同一语义。
      html = `<mark data-highlight="${runStyles.$highlight}" style="background-color: ${highlightColor}">${html}</mark>`;
    }
    const style = cssText(runStyles);
    const doubleStrikeAttribute = runStyles.$doubleStrike === "1" ? ' data-double-strike="true"' : "";
    return style && html ? `<span${doubleStrikeAttribute} style="${escapeHtml(style)}">${html}</span>` : html;
  }).join("");
  // 中文注解：按 run 内真实子节点顺序输出文字、制表位与断点，避免同一 run 的分页符或分栏符被错误移动到文字末尾。
  const contentHtml = (runNode.children || []).map((child) => {
    if (child.type !== "tag") return "";
    if (["w:t", "w:delText"].includes(child.name)) return renderText(child.children?.map((textNode) => textNode.data || "").join("") || "");
    if (child.name === "w:tab") return docxTabHtml(tabState);
    if (child.name === "w:softHyphen") return renderText("\u00AD");
    if (child.name === "w:noBreakHyphen") return renderText("\u2011");
    if (child.name === "w:footnoteReference") {
      const id = normalizeFootnoteId(firstValue(child.attribs, ["w:id", "id"]));
      const footnoteText = id ? normalizeFootnoteText(footnotes.get(id)) : "";
      // 中文注解：在线 HTML 只保存受控编号和纯文本，既可编辑，也能在再次导出时恢复原生脚注关系。
      return id && footnoteText ? `<span class="footnote-reference" data-footnote-id="${id}" data-footnote-text="${escapeHtml(footnoteText)}">${id}</span>` : "";
    }
    if (child.name === "w:endnoteReference") {
      const id = normalizeFootnoteId(firstValue(child.attribs, ["w:id", "id"]));
      const endnoteText = id ? normalizeFootnoteText(endnotes.get(id)) : "";
      // 中文注解：尾注引用保留稳定编号和纯文本，分页预览集中在文末显示，再次导出恢复原生 endnotes 部件。
      return id && endnoteText ? `<span class="endnote-reference" data-endnote-id="${id}" data-endnote-text="${escapeHtml(endnoteText)}">${id}</span>` : "";
    }
    if (child.name !== "w:br") return "";
    const breakType = firstValue(child.attribs, ["w:type", "type"]);
    if (breakType === "page") return pageBreakHtml();
    if (breakType === "column") return columnBreakHtml();
    return renderText("\n");
  }).join("");
  return `${contentHtml}${imageHtml}`;
}

async function parseStyledDocxParagraph(paragraphNode, context) {
  const { styleMap, defaultParagraphStyleId, defaultParagraphStyle, numbering, zip, relationships } = context;
  const pPr = xmlChild(paragraphNode, "w:pPr");
  const styleId = xmlVal(xmlChild(pPr, "w:pStyle"));
  const effectiveStyleId = styleId || defaultParagraphStyleId;
  const style = { id: effectiveStyleId, ...(styleMap.get(effectiveStyleId) || defaultParagraphStyle) };
  const paragraphStyles = { ...(style.paragraph || {}), ...parseParagraphProperties(pPr, context.themeColors || {}) };
  const tag = docxParagraphTag(style, paragraphStyles);
  // 中文注解：Word 的“自动”字体色通常不写入 w:color，桌面端会按黑色显示；标题必须补齐该默认值，避免继承在线编辑器的墨绿色主题。显式源颜色随后覆盖此兜底值。
  const inheritedRunStyles = /^h[1-6]$/.test(tag) ? { color: "#000000", ...(style.run || {}) } : (style.run || {});
  const tabState = { stops: normalizeDocxTabStops(paragraphStyles.$tabStops), index: 0 };
  const activeCommentIds = context.activeCommentIds || (context.activeCommentIds = []);
  const bodyParts = activeCommentIds.map((id) => commentMarkStartHtml(context.comments?.get(id)));
  // 中文注解：按真实子节点顺序解析普通 run 与 hyperlink，链接容器中的文字不能被跳过或移动位置。
  for (const child of paragraphNode.children || []) {
    if (child.name === "w:commentRangeStart") {
      const commentId = normalizeCommentId(firstValue(child.attribs, ["w:id", "id"]));
      if (commentId !== null && context.comments?.has(commentId) && !activeCommentIds.includes(commentId)) {
        activeCommentIds.push(commentId);
        bodyParts.push(commentMarkStartHtml(context.comments.get(commentId)));
      }
      continue;
    }
    if (child.name === "w:commentRangeEnd") {
      const commentId = normalizeCommentId(firstValue(child.attribs, ["w:id", "id"]));
      const commentIndex = commentId === null ? -1 : activeCommentIds.lastIndexOf(commentId);
      if (commentIndex >= 0) {
        // 中文注解：HTML 不能表达交叉范围；关闭目标之后的标记再重开，可保留每个 Word 批注覆盖的文字集合。
        const reopenIds = activeCommentIds.slice(commentIndex + 1);
        for (let index = activeCommentIds.length - 1; index >= commentIndex; index -= 1) bodyParts.push("</span>");
        activeCommentIds.splice(commentIndex, 1);
        reopenIds.forEach((id) => bodyParts.push(commentMarkStartHtml(context.comments.get(id))));
      }
      continue;
    }
    if (child.name === "w:r") {
      bodyParts.push(await docxRunToHtml(child, inheritedRunStyles, context, tabState));
      continue;
    }
    if (["w:ins", "w:del"].includes(child.name)) {
      bodyParts.push(await docxRevisionToHtml(child, child.name === "w:del" ? "delete" : "insert", inheritedRunStyles, context, tabState));
      continue;
    }
    if (child.name !== "w:hyperlink") continue;
    const relationshipId = firstValue(child.attribs, ["r:id", "id"]);
    const href = safeDocumentHyperlink(relationships.get(relationshipId));
    const linkParts = [];
    for (const run of xmlChildren(child, "w:r")) linkParts.push(await docxRunToHtml(run, inheritedRunStyles, context, tabState));
    const linkHtml = linkParts.join("");
    bodyParts.push(href && linkHtml ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${linkHtml}</a>` : linkHtml);
  }
  // 中文注解：跨段批注在每个 HTML 块末尾闭合、下一段重新打开，保持合法 HTML 与连续审阅语义。
  for (let index = activeCommentIds.length - 1; index >= 0; index -= 1) bodyParts.push("</span>");
  const body = bodyParts.join("") || "<br>";
  const list = docxListInfo(pPr, style, numbering);
  const indentLevel = wordTwipToIndentLevel(firstValue(xmlChild(pPr, "w:ind")?.attribs, ["w:firstLine", "firstLine"]));
  const attrs = [];
  if (/^[0-8]$/.test(String(paragraphStyles.$outlineLevel || ""))) attrs.push(`data-outline-level="${paragraphStyles.$outlineLevel}"`);
  const appearanceStyle = paragraphAppearanceCss(paragraphStyles.$paragraphShading, paragraphStyles.$paragraphBorders);
  const styleText = [cssText(paragraphStyles), appearanceStyle].filter(Boolean).join("; ");
  if (styleText) attrs.push(`style="${escapeHtml(styleText)}"`);
  if (indentLevel) attrs.push(`data-indent="${indentLevel}"`);
  if (paragraphStyles.$bidirectional === "1") attrs.push('data-bidirectional="true"');
  if (paragraphStyles.$keepNext === "1") attrs.push('data-keep-next="true"');
  if (paragraphStyles.$keepLines === "1") attrs.push('data-keep-lines="true"');
  if (paragraphStyles.$pageBreakBefore === "1") attrs.push('data-page-break-before="true"');
  if (paragraphStyles.$widowControl) attrs.push(`data-widow-control="${paragraphStyles.$widowControl === "1" ? "true" : "false"}"`);
  if (tabState.stops.length) attrs.push(`data-tab-stops="${escapeHtml(JSON.stringify(tabState.stops))}"`);
  if (paragraphStyles.$paragraphShading) attrs.push(`data-paragraph-shading="${escapeHtml(paragraphStyles.$paragraphShading)}"`);
  if (paragraphStyles.$paragraphBorders) attrs.push(`data-paragraph-borders="${escapeHtml(paragraphStyles.$paragraphBorders)}"`);
  const blockBreakPattern = /(<div data-(?:page|column)-break="true" class="(?:page|column)-break-marker"><\/div>)/g;
  if (body.includes('data-page-break="true"') || body.includes('data-column-break="true"')) {
    // 中文注解：分页符和分栏符都是块级语义，导入时拆出段落外层，避免保存为非法的 p > div 结构。
    const html = body.split(blockBreakPattern)
      .map((chunk) => /data-(?:page|column)-break="true"/.test(chunk) ? chunk : chunk ? `<${tag}${attrs.length ? ` ${attrs.join(" ")}` : ""}>${chunk}</${tag}>` : "")
      .filter(Boolean)
      .join("");
    return { html: html || pageBreakHtml(), listItem: "", ordered: false, listLevel: 0 };
  }
  return {
    html: `<${tag}${attrs.length ? ` ${attrs.join(" ")}` : ""}>${body}</${tag}>`,
    listItem: list ? body : "",
    ordered: Boolean(list?.ordered),
    listLevel: list?.level || 0,
    listNumberId: list?.numberId || "",
    listFormat: list?.numberFormat || "decimal",
    listStart: list?.numberStart || 1
  };
}

async function parseStyledDocxTableCell(cellNode, context, tagName) {
  const tcPr = xmlChild(cellNode, "w:tcPr");
  const gridSpan = xmlVal(xmlChild(tcPr, "w:gridSpan"));
  const verticalMergeNode = xmlChild(tcPr, "w:vMerge");
  const verticalMerge = verticalMergeNode ? (xmlVal(verticalMergeNode) || "continue") : "";
  const columnSpan = Number(gridSpan) > 1 ? Math.min(Math.round(Number(gridSpan)), 50) : 1;
  const cellWidthNode = xmlChild(tcPr, "w:tcW");
  const cellWidth = firstValue(cellWidthNode?.attribs, ["w:type", "type"]) === "dxa"
    ? Math.max(0, Math.round(Number(firstValue(cellWidthNode?.attribs, ["w:w", "w"])) || 0))
    : 0;
  const cellMargins = { ...(context.tableCellMargins || {}), ...parseDocxCellMargins(xmlChild(tcPr, "w:tcMar")) };
  const rawVerticalAlign = xmlVal(xmlChild(tcPr, "w:vAlign"));
  const verticalAlign = ["top", "center", "bottom"].includes(rawVerticalAlign) ? rawVerticalAlign : "";
  const rawTextDirection = xmlVal(xmlChild(tcPr, "w:textDirection"));
  const textDirection = ["lrTb", "tbRl", "btLr"].includes(rawTextDirection) ? rawTextDirection : "";
  const shading = docxShadingColor(xmlChild(tcPr, "w:shd"), context.themeColors || {});
  const cellBorders = parseDocxBorders(xmlChild(tcPr, "w:tcBorders"), context.themeColors || {}, false);

  const parsedParagraphs = await Promise.all(xmlChildren(cellNode, "w:p")
    .map((paragraph) => parseStyledDocxParagraph(paragraph, context)));
  // 中文注解：单元格内同样可能包含连续编号段落，必须在表格结构内恢复 ol/ul，不能退化为普通 p。
  const paragraphs = renderDocxParagraphs(parsedParagraphs) || "<p><br></p>";
  return { tagName, paragraphs, columnSpan, rowSpan: 1, verticalMerge, cellWidth, columnWidths: [], cellMargins, verticalAlign, textDirection, shading, cellBorders, columnIndex: 0 };
}

function parseDocxCellMargins(container) {
  const margins = {};
  const names = { top: ["w:top"], right: ["w:right", "w:end"], bottom: ["w:bottom"], left: ["w:left", "w:start"] };
  for (const [side, elementNames] of Object.entries(names)) {
    const element = elementNames.map((name) => xmlChild(container, name)).find(Boolean);
    const type = firstValue(element?.attribs, ["w:type", "type"]);
    const width = Math.max(0, Math.round(Number(firstValue(element?.attribs, ["w:w", "w"])) || 0));
    if (element && (!type || type === "dxa")) margins[side] = width;
  }
  return margins;
}

function docxShadingColor(shadingNode, themeColors = {}) {
  if (!shadingNode) return "";
  const directFill = firstValue(shadingNode.attribs, ["w:fill", "fill"]);
  if (/^[0-9a-f]{6}$/i.test(directFill)) return `#${directFill.toUpperCase()}`;
  const themeFill = themeColors[firstValue(shadingNode.attribs, ["w:themeFill", "themeFill"])];
  if (!themeFill) return "";
  return transformDocxThemeColor(
    themeFill,
    firstValue(shadingNode.attribs, ["w:themeFillTint", "themeFillTint"]),
    firstValue(shadingNode.attribs, ["w:themeFillShade", "themeFillShade"])
  );
}

function parseDocxParagraphShading(shadingNode, themeColors = {}) {
  const fill = docxShadingColor(shadingNode, themeColors);
  if (!fill) return null;
  const rawColor = firstValue(shadingNode?.attribs, ["w:color", "color"]);
  const color = /^[0-9a-f]{6}$/i.test(rawColor) ? `#${rawColor.toUpperCase()}` : "#000000";
  const rawType = firstValue(shadingNode?.attribs, ["w:val", "val"]);
  const type = /^[A-Za-z0-9]+$/.test(rawType) ? rawType : "clear";
  return { fill, color, type };
}

const supportedDocxBorderStyles = new Set(["single", "dashed", "dashSmallGap", "dotted", "dotDash", "dotDotDash", "double", "thick", "none", "nil"]);

function parseDocxBorderElement(element, themeColors = {}) {
  if (!element) return null;
  const rawStyle = firstValue(element.attribs, ["w:val", "val"]);
  const style = supportedDocxBorderStyles.has(rawStyle) ? rawStyle : "single";
  const rawColor = firstValue(element.attribs, ["w:color", "color"]);
  const themeColor = themeColors[firstValue(element.attribs, ["w:themeColor", "themeColor"])];
  const color = /^[0-9a-f]{6}$/i.test(rawColor) ? `#${rawColor.toUpperCase()}` : (themeColor ? transformDocxThemeColor(themeColor, firstValue(element.attribs, ["w:themeTint", "themeTint"]), firstValue(element.attribs, ["w:themeShade", "themeShade"])) : "#000000");
  const rawSize = Number(firstValue(element.attribs, ["w:sz", "sz"]));
  const size = ["none", "nil"].includes(style) ? 0 : Math.max(1, Math.min(96, Number.isFinite(rawSize) && rawSize > 0 ? Math.round(rawSize) : 4));
  const rawSpace = firstValue(element.attribs, ["w:space", "space"]);
  const space = rawSpace === "" ? undefined : Math.max(0, Math.min(31, Math.round(Number(rawSpace) || 0)));
  return { style, size, color, ...(space === undefined ? {} : { space }) };
}

function parseDocxBorders(container, themeColors = {}, includeInside = true) {
  const borders = {};
  const names = {
    top: ["w:top"], right: ["w:right", "w:end"], bottom: ["w:bottom"], left: ["w:left", "w:start"],
    between: ["w:between"], insideHorizontal: ["w:insideH"], insideVertical: ["w:insideV"]
  };
  for (const [side, elementNames] of Object.entries(names)) {
    if (!includeInside && side.startsWith("inside")) continue;
    const element = elementNames.map((name) => xmlChild(container, name)).find(Boolean);
    if (!element) continue;
    borders[side] = parseDocxBorderElement(element, themeColors);
  }
  return borders;
}

function docxBorderCss(border) {
  if (!border || ["none", "nil"].includes(border.style) || border.size <= 0) return "none";
  const cssStyle = border.style === "double" ? "double" : border.style === "dotted" ? "dotted" : border.style.includes("dash") || border.style.startsWith("dot") ? "dashed" : "solid";
  return `${Math.round(border.size / 6 * 100) / 100}px ${cssStyle} ${border.color}`;
}

function paragraphAppearanceCss(shadingValue, bordersValue) {
  const styles = [];
  try {
    const shading = JSON.parse(String(shadingValue || ""));
    if (/^#[0-9a-f]{6}$/i.test(String(shading?.fill || ""))) styles.push(`background-color: ${String(shading.fill).toUpperCase()}`);
  } catch {
    // 中文注解：损坏的历史段落外观属性只忽略该项，正文仍可继续打开和编辑。
  }
  try {
    const borders = JSON.parse(String(bordersValue || ""));
    for (const side of ["top", "right", "bottom", "left"]) {
      const border = borders?.[side];
      if (!border) continue;
      styles.push(`border-${side}: ${docxBorderCss(border)}`);
      if (Number(border.space) > 0) styles.push(`padding-${side}: ${Math.round(Number(border.space) * 96 / 72 * 100) / 100}px`);
    }
  } catch {
    // 中文注解：边框 JSON 解析失败时不生成不受控 CSS，避免污染分页预览。
  }
  return styles.join("; ");
}

async function parseStyledDocxTable(tableNode, context) {
  const tableProperties = xmlChild(tableNode, "w:tblPr");
  const tableWidthNode = xmlChild(tableProperties, "w:tblW");
  const rawWidthType = firstValue(tableWidthNode?.attribs, ["w:type", "type"]);
  const tableWidthType = ["dxa", "pct", "auto"].includes(rawWidthType) ? rawWidthType : "auto";
  const tableWidthValue = Math.max(0, Math.round(Number(firstValue(tableWidthNode?.attribs, ["w:w", "w"])) || 0));
  const tableLayout = firstValue(xmlChild(tableProperties, "w:tblLayout")?.attribs, ["w:type", "type"]) === "fixed" ? "fixed" : "autofit";
  const rawTableAlignment = xmlVal(xmlChild(tableProperties, "w:jc"));
  const tableAlignment = rawTableAlignment === "center" ? "center" : ["right", "end"].includes(rawTableAlignment) ? "right" : "left";
  const tableIndentNode = xmlChild(tableProperties, "w:tblInd");
  const tableIndentType = firstValue(tableIndentNode?.attribs, ["w:type", "type"]);
  const tableIndent = tableIndentNode && (!tableIndentType || tableIndentType === "dxa")
    ? Math.max(-31680, Math.min(31680, Math.round(Number(firstValue(tableIndentNode.attribs, ["w:w", "w"])) || 0)))
    : 0;
  const tableCellSpacingNode = xmlChild(tableProperties, "w:tblCellSpacing");
  const tableCellSpacingType = firstValue(tableCellSpacingNode?.attribs, ["w:type", "type"]);
  const tableCellSpacing = tableCellSpacingNode && (!tableCellSpacingType || tableCellSpacingType === "dxa")
    ? Math.max(0, Math.min(31680, Math.round(Number(firstValue(tableCellSpacingNode.attribs, ["w:w", "w"])) || 0)))
    : 0;
  const tableCellMargins = parseDocxCellMargins(xmlChild(tableProperties, "w:tblCellMar"));
  const tableBorders = parseDocxBorders(xmlChild(tableProperties, "w:tblBorders"), context.themeColors || {});
  const gridWidths = xmlChildren(xmlChild(tableNode, "w:tblGrid"), "w:gridCol")
    .map((column) => Math.max(0, Math.round(Number(firstValue(column.attribs, ["w:w", "w"])) || 0)))
    .filter((width) => width > 0)
    .slice(0, 50);
  const gridWidth = gridWidths.reduce((total, width) => total + width, 0);
  const rows = [];
  let activeVerticalMerges = new Map();
  for (const [rowIndex, rowNode] of xmlChildren(tableNode, "w:tr").entries()) {
    const rowProperties = xmlChild(rowNode, "w:trPr");
    const rowHeightNode = xmlChild(rowProperties, "w:trHeight");
    const rowHeight = Math.max(0, Math.min(31680, Math.round(Number(firstValue(rowHeightNode?.attribs, ["w:val", "val"])) || 0)));
    const rawRowHeightRule = firstValue(rowHeightNode?.attribs, ["w:hRule", "hRule"]);
    // 中文注解：Word 省略 hRule 时按“最小值”解释；在线高度也必须使用同一规则参与分页测量。
    const rowHeightRule = rowHeight > 0 ? (["exact", "atLeast"].includes(rawRowHeightRule) ? rawRowHeightRule : "atLeast") : "auto";
    const cantSplit = wordToggleEnabled(xmlChild(rowProperties, "w:cantSplit"));
    const repeatHeader = wordToggleEnabled(xmlChild(rowProperties, "w:tblHeader"));
    const cellTag = rowIndex === 0 ? "th" : "td";
    const parsedCells = await Promise.all(xmlChildren(rowNode, "w:tc").map((cellNode) => parseStyledDocxTableCell(cellNode, { ...context, tableCellMargins }, cellTag)));
    const visibleCells = [];
    const nextVerticalMerges = new Map();
    let columnIndex = 0;
    for (const cell of parsedCells) {
      const gridSlice = gridWidths.slice(columnIndex, columnIndex + cell.columnSpan);
      if (gridSlice.length === cell.columnSpan) cell.columnWidths = gridSlice;
      else if (cell.cellWidth > 0) cell.columnWidths = Array.from({ length: cell.columnSpan }, () => Math.round(cell.cellWidth / cell.columnSpan));
      if (cell.verticalMerge === "continue") {
        const origin = activeVerticalMerges.get(columnIndex);
        if (origin) {
          origin.rowSpan += 1;
          if (cell.cellBorders.bottom) origin.cellBorders.bottom = cell.cellBorders.bottom;
          for (let offset = 0; offset < cell.columnSpan; offset += 1) nextVerticalMerges.set(columnIndex + offset, origin);
        } else {
          // 中文注解：损坏或裁剪过的 DOCX 可能只有 continue 没有 restart，此时保留为普通单元格，避免内容消失。
          visibleCells.push({ ...cell, verticalMerge: "" });
        }
      } else {
        cell.columnIndex = columnIndex;
        visibleCells.push(cell);
        if (cell.verticalMerge === "restart") {
          for (let offset = 0; offset < cell.columnSpan; offset += 1) nextVerticalMerges.set(columnIndex + offset, cell);
        }
      }
      columnIndex += cell.columnSpan;
    }
    rows.push({ cells: visibleCells, rowHeight, rowHeightRule, cantSplit, repeatHeader });
    activeVerticalMerges = nextVerticalMerges;
  }
  const totalColumns = gridWidths.length || Math.max(0, ...rows.map((row) => row.cells.reduce((total, cell) => total + cell.columnSpan, 0)));
  const renderedRows = rows.map((row, rowIndex) => {
    const cells = row.cells;
    const html = cells.map((cell) => {
      const attrs = [];
      if (cell.columnSpan > 1) attrs.push(`colspan="${cell.columnSpan}"`);
      if (cell.rowSpan > 1) attrs.push(`rowspan="${cell.rowSpan}"`);
      if (cell.columnWidths.length) attrs.push(`colwidth="${cell.columnWidths.map((width) => Math.max(25, Math.round(width * 96 / 1440))).join(",")}"`);
      attrs.push('data-docx-cell="true"');
      if (Object.keys(cell.cellMargins).length) attrs.push(`data-cell-margins="${escapeHtml(JSON.stringify(cell.cellMargins))}"`);
      if (cell.verticalAlign) attrs.push(`data-cell-vertical-align="${cell.verticalAlign}"`);
      if (cell.textDirection) attrs.push(`data-cell-text-direction="${cell.textDirection}"`);
      if (cell.shading) attrs.push(`data-cell-shading="${cell.shading}"`);
      const effectiveBorders = {
        top: cell.cellBorders.top || tableBorders[rowIndex === 0 ? "top" : "insideHorizontal"],
        right: cell.cellBorders.right || tableBorders[cell.columnIndex + cell.columnSpan >= totalColumns ? "right" : "insideVertical"],
        bottom: cell.cellBorders.bottom || tableBorders[rowIndex + cell.rowSpan >= rows.length ? "bottom" : "insideHorizontal"],
        left: cell.cellBorders.left || tableBorders[cell.columnIndex === 0 ? "left" : "insideVertical"]
      };
      if (Object.values(effectiveBorders).some(Boolean)) attrs.push(`data-cell-borders="${escapeHtml(JSON.stringify(effectiveBorders))}"`);
      const styles = [];
      for (const side of ["top", "right", "bottom", "left"]) {
        if (cell.cellMargins[side] !== undefined) styles.push(`padding-${side}: ${Math.round(cell.cellMargins[side] * 96 / 1440 * 100) / 100}px`);
      }
      if (cell.verticalAlign) styles.push(`vertical-align: ${cell.verticalAlign === "center" ? "middle" : cell.verticalAlign}`);
      if (cell.textDirection) styles.push(`writing-mode: ${{ lrTb: "horizontal-tb", tbRl: "sideways-rl", btLr: "sideways-lr" }[cell.textDirection]}`);
      if (cell.shading) styles.push(`background-color: ${cell.shading}`);
      for (const side of ["top", "right", "bottom", "left"]) {
        if (effectiveBorders[side]) styles.push(`border-${side}: ${docxBorderCss(effectiveBorders[side])}`);
      }
      if (styles.length) attrs.push(`style="${styles.join("; ")}"`);
      return `<${cell.tagName}${attrs.length ? ` ${attrs.join(" ")}` : ""}>${cell.paragraphs}</${cell.tagName}>`;
    }).join("");
    const rowAttrs = [];
    if (row.rowHeight > 0) {
      rowAttrs.push(`data-row-height="${row.rowHeight}"`);
      rowAttrs.push(`data-row-height-rule="${row.rowHeightRule}"`);
      rowAttrs.push(`style="height: ${Math.round(row.rowHeight * 96 / 1440 * 100) / 100}px"`);
    }
    if (row.cantSplit) rowAttrs.push('data-row-cant-split="true"');
    if (row.repeatHeader) rowAttrs.push('data-row-repeat-header="true"');
    return html ? `<tr${rowAttrs.length ? ` ${rowAttrs.join(" ")}` : ""}>${html}</tr>` : "";
  }).filter(Boolean);
  if (!renderedRows.length) return "";
  const widthStyle = tableWidthType === "pct" && tableWidthValue > 0
    ? `width: ${Math.min(100, Math.round(tableWidthValue / 50 * 100) / 100)}%`
    : (tableWidthType === "dxa" ? tableWidthValue : gridWidth) > 0
      ? `width: ${Math.round((tableWidthType === "dxa" ? tableWidthValue : gridWidth) * 96 / 1440 * 100) / 100}px`
      : "width: 100%";
  const alignmentStyle = tableAlignment === "center"
    ? "margin-left: auto; margin-right: auto"
    : tableAlignment === "right"
      ? "margin-left: auto; margin-right: 0px"
      : `margin-left: ${Math.round(tableIndent * 96 / 1440 * 100) / 100}px; margin-right: auto`;
  const cellSpacingStyle = tableCellSpacing > 0
    ? `border-collapse: separate; border-spacing: ${Math.round(tableCellSpacing * 96 / 1440 * 100) / 100}px`
    : "border-collapse: collapse; border-spacing: 0px";
  const attributes = [
    `data-table-width-type="${tableWidthType}"`,
    `data-table-width-value="${tableWidthValue}"`,
    `data-table-grid-width="${gridWidth}"`,
    `data-table-layout="${tableLayout}"`,
    `data-table-alignment="${tableAlignment}"`,
    `data-table-indent="${tableIndent}"`,
    `data-table-cell-spacing="${tableCellSpacing}"`,
    ...(Object.keys(tableBorders).length ? [`data-table-borders="${escapeHtml(JSON.stringify(tableBorders))}"`] : []),
    `style="${widthStyle}; ${alignmentStyle}; table-layout: ${tableLayout === "fixed" ? "fixed" : "auto"}; ${cellSpacingStyle}"`
  ];
  // 中文注解：tblGrid 是 Word 实际分页使用的列几何，转换为 colwidth 后由编辑器、分页器和再次导出共同使用。
  return `<table ${attributes.join(" ")}><tbody>${renderedRows.join("")}</tbody></table>`;
}

function renderDocxListItems(items) {
  // 中文注解：用栈把连续的 Word 列表段落恢复为合法嵌套 HTML，并在层级回退时依次闭合父列表项。
  let html = "";
  const openLists = [];

  const openingTag = (item) => {
    if (!item.ordered) return "<ul>";
    const definition = orderedListFormatDefinition(item.listFormat);
    const startAttribute = item.listStart === 1 ? "" : ` start="${item.listStart}"`;
    return `<ol${startAttribute} data-list-format="${definition.format}" style="list-style-type: ${definition.css}">`;
  };

  for (const item of items) {
    const tag = item.ordered ? "ol" : "ul";
    const level = Math.min(item.listLevel, openLists.length);
    if (!openLists.length || level === openLists.length) {
      html += `${openingTag(item)}<li>${item.listItem}`;
      openLists.push({ tag, numberId: item.listNumberId, format: item.listFormat, start: item.listStart });
      continue;
    }

    while (openLists.length - 1 > level) html += `</li></${openLists.pop().tag}>`;
    const currentList = openLists[openLists.length - 1];
    if (currentList.tag === tag && currentList.numberId === item.listNumberId && currentList.format === item.listFormat) {
      html += `</li><li>${item.listItem}`;
    } else {
      // 中文注解：相同类型但 numId 不同代表 Word 中的新编号实例，必须拆开列表以保留“重新从 1 开始”。
      html += `</li></${openLists.pop().tag}>${openingTag(item)}<li>${item.listItem}`;
      openLists.push({ tag, numberId: item.listNumberId, format: item.listFormat, start: item.listStart });
    }
  }

  while (openLists.length) html += `</li></${openLists.pop().tag}>`;
  return html;
}

function renderDocxParagraphs(parsedParagraphs) {
  // 中文注解：普通段落保持原顺序，连续列表段落统一交给列表栈渲染，供正文和表格单元格复用。
  const chunks = [];
  let listItems = [];
  const flushList = () => {
    if (!listItems.length) return;
    chunks.push(renderDocxListItems(listItems));
    listItems = [];
  };

  for (const paragraph of parsedParagraphs) {
    if (paragraph.listItem) listItems.push(paragraph);
    else {
      flushList();
      chunks.push(paragraph.html);
    }
  }
  flushList();
  return chunks.join("");
}

const DOCX_ARCHIVE_LIMITS = Object.freeze({
  maximumEntries: 2000,
  maximumEntryBytes: 20 * 1024 * 1024,
  maximumTotalBytes: 80 * 1024 * 1024,
  maximumPathLength: 512
});

async function loadSafeDocxArchive(buffer) {
  let zip;
  try {
    // 中文注解：JSZip 此时只读取中央目录，不展开每个文件；先校验声明体积，再允许正文、媒体和页眉页脚解压。
    zip = await JSZip.loadAsync(buffer);
  } catch {
    throw createPublicError("该 DOCX 文件已损坏或不是有效的 Word 文档。", 400);
  }
  const entries = Object.values(zip.files);
  if (entries.length > DOCX_ARCHIVE_LIMITS.maximumEntries) {
    throw createPublicError("该 DOCX 文件结构过大，包含的内部文件数量超过安全限制。", 400);
  }
  let totalBytes = 0;
  for (const entry of entries) {
    const originalPath = String(entry.unsafeOriginalName || entry.name || "");
    if (
      originalPath.length > DOCX_ARCHIVE_LIMITS.maximumPathLength
      || /(^|[\\/])\.\.([\\/]|$)|^[\\/]|^[A-Za-z]:|\\/.test(originalPath)
      || /[\u0000-\u001F\u007F]/.test(originalPath)
    ) {
      throw createPublicError("该 DOCX 文件包含不安全的内部路径，无法导入。", 400);
    }
    if (entry.dir) continue;
    const uncompressedBytes = Number(entry._data?.uncompressedSize);
    if (!Number.isSafeInteger(uncompressedBytes) || uncompressedBytes < 0) {
      throw createPublicError("该 DOCX 文件无法完成安全校验，可能已损坏。", 400);
    }
    if (uncompressedBytes > DOCX_ARCHIVE_LIMITS.maximumEntryBytes) {
      throw createPublicError("该 DOCX 文件结构过大，单个内部文件超过安全限制。", 400);
    }
    totalBytes += uncompressedBytes;
    if (totalBytes > DOCX_ARCHIVE_LIMITS.maximumTotalBytes) {
      throw createPublicError("该 DOCX 文件结构过大，解压后的总体积超过安全限制。", 400);
    }
  }
  return zip;
}

async function parseStyledDocxToHtml(buffer, sectionLayouts = [], sectionBreakTypes = [], archive = null) {
  const zip = archive || await loadSafeDocxArchive(buffer);
  const documentXml = await zip.file("word/document.xml")?.async("string");
  if (!documentXml) return "";
  const stylesXml = await zip.file("word/styles.xml")?.async("string");
  const themeXml = await zip.file("word/theme/theme1.xml")?.async("string");
  const numberingXml = await zip.file("word/numbering.xml")?.async("string");
  const relsXml = await zip.file("word/_rels/document.xml.rels")?.async("string");
  const footnotesXml = await zip.file("word/footnotes.xml")?.async("string");
  const endnotesXml = await zip.file("word/endnotes.xml")?.async("string");
  const commentsXml = await zip.file("word/comments.xml")?.async("string");
  const styleContext = parseDocxStyles(stylesXml || "", themeXml || "");
  const numbering = parseDocxNumbering(numberingXml || "");
  const relationships = parseDocxRelationships(relsXml || "");
  const footnotes = parseDocxNotes(footnotesXml || "", "footnote");
  const endnotes = parseDocxNotes(endnotesXml || "", "endnote");
  const comments = parseDocxComments(commentsXml || "");
  const context = { ...styleContext, numbering, zip, relationships, footnotes, endnotes, comments, activeCommentIds: [] };
  const document = parseDocument(documentXml, { xmlMode: true });
  const body = xmlDescendants(document, "w:body")[0];
  const chunks = [];
  let openList = [];
  let completedSectionCount = 0;
  const flushList = () => {
    if (!openList.length) return;
    chunks.push(renderDocxListItems(openList));
    openList = [];
  };

  for (const block of xmlChildren(body)) {
    if (block.name === "w:tbl") {
      flushList();
      const table = await parseStyledDocxTable(block, context);
      if (table) chunks.push(table);
      continue;
    }

    if (block.name === "w:p") {
      const parsed = await parseStyledDocxParagraph(block, context);
      if (parsed.listItem) {
        openList.push(parsed);
      } else {
        flushList();
        chunks.push(parsed.html);
      }
      if (xmlDescendants(block, "w:sectPr").length && sectionLayouts[completedSectionCount + 1]) {
        flushList();
        completedSectionCount += 1;
        // 中文注解：段落属性中的 sectPr 结束当前节，紧随其后的正文属于下一节，因此标记携带下一节页面设置。
        chunks.push(sectionBreakHtml(sectionLayouts[completedSectionCount], sectionBreakTypes[completedSectionCount - 1]));
      }
    }
  }
  flushList();
  return chunks.join("");
}

function docxPartTextTemplate(xml = "") {
  if (!xml.trim()) return "";
  const document = parseDocument(xml, { xmlMode: true });
  const textWithFields = (node, state = { fields: [] }) => {
    if (!node) return "";
    if (node.type === "tag" && node.name === "w:fldSimple") {
      const instruction = firstValue(node.attribs, ["w:instr", "instr"]);
      const placeholder = pageFieldPlaceholder(instruction);
      if (placeholder) return placeholder;
      return xmlDescendants(node, "w:t").map((textNode) => (textNode.children || []).map((child) => child.data || "").join("")).join("");
    }
    if (node.type === "tag" && node.name === "w:fldChar") {
      const type = firstValue(node.attribs, ["w:fldCharType", "fldCharType"]);
      if (type === "begin") state.fields.push({ instruction: "", phase: "code", emitted: false });
      if (type === "separate" && state.fields.length) {
        const field = state.fields[state.fields.length - 1];
        field.phase = "result";
        const placeholder = pageFieldPlaceholder(field.instruction);
        if (placeholder) {
          field.emitted = true;
          return placeholder;
        }
      }
      if (type === "end" && state.fields.length) {
        const field = state.fields.pop();
        const placeholder = pageFieldPlaceholder(field.instruction);
        if (!field.emitted && placeholder) return placeholder;
      }
      return "";
    }
    if (node.type === "tag" && node.name === "w:instrText") {
      if (state.fields.length) state.fields[state.fields.length - 1].instruction += (node.children || []).map((child) => child.data || "").join("");
      return "";
    }
    if (node.type === "tag" && node.name === "w:t") {
      const text = (node.children || []).map((child) => child.data || "").join("");
      if (!state.fields.length) return text;
      const field = state.fields[state.fields.length - 1];
      return field.phase === "result" && !isPageNumberFieldInstruction(field.instruction) ? text : "";
    }
    if (node.type === "tag" && node.name === "w:tab" && !state.fields.length) return "\t";
    return (node.children || []).map((child) => textWithFields(child, state)).join("");
  };
  return xmlDescendants(document, "w:p")
    // 中文注解：页码域转换为稳定占位符，其他动态域保留缓存显示值，避免旧页码与新页码叠加。
    .map((paragraph) => textWithFields(paragraph))
    .map(normalizePageNumberTemplate)
    // 中文注解：Word 页眉页脚中的每个 w:p 都是独立段落，使用换行进入页面模型，不能压成一行。
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

function docxPartPlainText(xml = "") {
  return normalizePageText(docxPartTextTemplate(xml).replace(/\{(?:PAGE|NUMPAGES)(?::(?:decimal|upperRoman|lowerRoman|upperLetter|lowerLetter))?\}/g, ""));
}

function resolvedDocxPageTextStyle(paragraph, run, styleContext, fallback = defaultPageTextStyle) {
  const context = styleContext || { styleMap: new Map(), defaultParagraphStyle: { paragraph: {}, run: {} }, themeFonts: {} };
  const paragraphStyleId = xmlVal(xmlChild(xmlChild(paragraph, "w:pPr"), "w:pStyle"));
  const paragraphStyle = context.styleMap.get(paragraphStyleId) || context.defaultParagraphStyle || { paragraph: {}, run: {} };
  const runStyleId = xmlVal(xmlChild(xmlChild(run, "w:rPr"), "w:rStyle"));
  const characterStyle = context.styleMap.get(runStyleId) || { paragraph: {}, run: {} };
  const paragraphProperties = {
    ...(paragraphStyle.paragraph || {}),
    ...parseParagraphProperties(xmlChild(paragraph, "w:pPr"))
  };
  const runProperties = {
    ...(paragraphStyle.run || {}),
    ...(characterStyle.run || {}),
    ...parseRunProperties(xmlChild(run, "w:rPr"), context.themeFonts || {}, context.themeColors || {})
  };
  applyWordScriptFont(runProperties, docxTextFromRun(run));
  const fontSizePt = Number.parseFloat(String(runProperties["font-size"] || ""));
  return normalizePageTextStyle({
    alignment: ["left", "center", "right"].includes(paragraphProperties["text-align"]) ? paragraphProperties["text-align"] : fallback.alignment,
    fontFamily: String(runProperties["font-family"] || fallback.fontFamily).replace(/["']/g, ""),
    fontSizePt: Number.isFinite(fontSizePt) ? fontSizePt : fallback.fontSizePt,
    color: runProperties.color || fallback.color,
    bold: runProperties.$bold === undefined ? fallback.bold : runProperties.$bold === "1",
    italic: runProperties.$italic === undefined ? fallback.italic : runProperties.$italic === "1"
  }, fallback);
}

function parseDocxPageTextStyle(xml = "", fallback = defaultPageTextStyle, styleContext = null) {
  if (!xml.trim()) return normalizePageTextStyle(fallback);
  const document = parseDocument(xml, { xmlMode: true });
  const paragraphs = xmlDescendants(document, "w:p");
  const paragraph = paragraphs.find((item) => xmlDescendants(item, "w:r").some((run) => docxTextFromRun(run).trim())) || paragraphs[0];
  const styledRun = xmlDescendants(paragraph, "w:r").find((run) => docxTextFromRun(run).trim()) || xmlDescendants(paragraph, "w:r")[0];
  return resolvedDocxPageTextStyle(paragraph, styledRun, styleContext, fallback);
}

function docxPartHasMixedTextStyles(xml = "", styleContext = null) {
  if (!xml.trim()) return false;
  const document = parseDocument(xml, { xmlMode: true });
  const signatures = new Set();
  for (const paragraph of xmlDescendants(document, "w:p")) {
    const alignment = firstValue(xmlChild(xmlChild(paragraph, "w:pPr"), "w:jc")?.attribs, ["w:val", "val"]) || "center";
    for (const run of xmlDescendants(paragraph, "w:r")) {
      if (!docxTextFromRun(run).trim()) continue;
      signatures.add(JSON.stringify(resolvedDocxPageTextStyle(paragraph, run, styleContext)));
    }
  }
  return signatures.size > 1;
}

function wordOnOffEnabled(node) {
  if (!node) return false;
  const value = String(firstValue(node.attribs, ["w:val", "val"]) || "true").toLowerCase();
  return !["0", "false", "off", "no"].includes(value);
}

function docxFieldInstructions(xml = "") {
  if (!String(xml).trim()) return [];
  const document = parseDocument(xml, { xmlMode: true });
  const instructions = [];
  const fields = [];
  const walk = (node) => {
    if (!node) return;
    if (node.type === "tag" && node.name === "w:fldSimple") {
      const instruction = firstValue(node.attribs, ["w:instr", "instr"]);
      if (instruction) instructions.push(instruction);
      return;
    }
    if (node.type === "tag" && node.name === "w:fldChar") {
      const type = firstValue(node.attribs, ["w:fldCharType", "fldCharType"]);
      if (type === "begin") fields.push({ instruction: "", emitted: false });
      if (type === "separate" && fields.length) {
        const field = fields[fields.length - 1];
        if (!field.emitted && field.instruction.trim()) instructions.push(field.instruction);
        field.emitted = true;
      }
      if (type === "end" && fields.length) {
        const field = fields.pop();
        if (!field.emitted && field.instruction.trim()) instructions.push(field.instruction);
      }
      return;
    }
    if (node.type === "tag" && node.name === "w:instrText") {
      const value = (node.children || []).map((child) => child.data || "").join("");
      if (fields.length) fields[fields.length - 1].instruction += value;
      else if (value.trim()) instructions.push(value);
      return;
    }
    for (const child of node.children || []) walk(child);
  };
  walk(document);
  return instructions;
}

function isPageNumberFieldInstruction(instruction = "") {
  const command = String(instruction).trim().split(/\s+/)[0]?.toUpperCase();
  return command === "PAGE" || command === "NUMPAGES";
}

function pageFieldPlaceholder(instruction = "") {
  if (!isPageNumberFieldInstruction(instruction)) return "";
  const command = String(instruction).trim().split(/\s+/)[0].toUpperCase();
  const switchValue = String(instruction).match(/\\\*\s+(ROMAN|roman|ALPHABETIC|alphabetic|Arabic)\b/)?.[1] || "";
  const formatMap = { ROMAN: "upperRoman", roman: "lowerRoman", ALPHABETIC: "upperLetter", alphabetic: "lowerLetter", Arabic: "decimal" };
  return `{${command}${switchValue ? `:${formatMap[switchValue]}` : ""}}`;
}

function parseDocxPageVariant(headerXml = "", footerXml = "", styleContext = null) {
  const headerPageNumberEnabled = docxFieldInstructions(headerXml).some(isPageNumberFieldInstruction);
  const footerPageNumberEnabled = docxFieldInstructions(footerXml).some(isPageNumberFieldInstruction);
  const headerTemplate = docxPartTextTemplate(headerXml);
  const footerTemplate = docxPartTextTemplate(footerXml);
  const splitGeneratedTemplate = (template, enabled) => {
    if (!enabled) return { text: template, pageTemplate: "", separate: false };
    const lines = String(template || "").split("\n");
    const fieldLineIndex = lines.findLastIndex((line) => /\{(?:PAGE|NUMPAGES)(?::(?:decimal|upperRoman|lowerRoman|upperLetter|lowerLetter))?\}/.test(line));
    if (fieldLineIndex < 0) return { text: template, pageTemplate: "", separate: false };
    const fieldLine = lines[fieldLineIndex];
    const separatorIndex = fieldLine.lastIndexOf(" · ");
    const pageTemplate = separatorIndex > 0 ? fieldLine.slice(separatorIndex + 3).trim() : fieldLine.trim();
    if (separatorIndex > 0) lines[fieldLineIndex] = fieldLine.slice(0, separatorIndex).trim();
    else lines.splice(fieldLineIndex, 1);
    const text = normalizePageText(lines.join("\n"));
    return { text, pageTemplate: normalizePageNumberTemplate(pageTemplate), separate: separatorIndex < 0 && Boolean(text) };
  };
  const headerParts = splitGeneratedTemplate(headerTemplate, headerPageNumberEnabled);
  const footerParts = splitGeneratedTemplate(footerTemplate, footerPageNumberEnabled);
  return normalizePageVariant({
    headerText: headerParts.text,
    headerStyle: parseDocxPageTextStyle(headerXml, defaultPageTextStyle, styleContext),
    footerText: footerParts.text,
    footerStyle: parseDocxPageTextStyle(footerXml, defaultPageTextStyle, styleContext),
    headerPageNumberTemplate: headerParts.pageTemplate,
    footerPageNumberTemplate: footerParts.pageTemplate,
    headerPageNumberSeparate: headerParts.separate,
    footerPageNumberSeparate: footerParts.separate
  });
}

function parseDocxPageVariantParts(headerPart, footerPart, fallback = defaultPageVariant, styleContext = null) {
  const parsed = parseDocxPageVariant(headerPart.xml || "", footerPart.xml || "", styleContext);
  return normalizePageVariant({
    headerText: headerPart.present ? parsed.headerText : fallback.headerText,
    headerStyle: headerPart.present ? parsed.headerStyle : fallback.headerStyle,
    headerImages: headerPart.present ? (headerPart.images || []) : fallback.headerImages,
    footerText: footerPart.present ? parsed.footerText : fallback.footerText,
    footerStyle: footerPart.present ? parsed.footerStyle : fallback.footerStyle,
    footerImages: footerPart.present ? (footerPart.images || []) : fallback.footerImages,
    headerPageNumberTemplate: headerPart.present ? parsed.headerPageNumberTemplate : fallback.headerPageNumberTemplate,
    footerPageNumberTemplate: footerPart.present ? parsed.footerPageNumberTemplate : fallback.footerPageNumberTemplate,
    headerPageNumberSeparate: headerPart.present ? parsed.headerPageNumberSeparate : fallback.headerPageNumberSeparate,
    footerPageNumberSeparate: footerPart.present ? parsed.footerPageNumberSeparate : fallback.footerPageNumberSeparate
  }, fallback);
}

function parseDocxPageGeometry(section, fallback = defaultPageLayout, themeColors = {}) {
  const pageSize = xmlChild(section, "w:pgSz");
  const pageMargin = xmlChild(section, "w:pgMar");
  const width = Number(firstValue(pageSize?.attribs, ["w:w", "w", "width"]));
  const height = Number(firstValue(pageSize?.attribs, ["w:h", "h", "height"]));
  const explicitOrientation = firstValue(pageSize?.attribs, ["w:orient", "orient"]);
  const pageNumberType = xmlChild(section, "w:pgNumType");
  const pageNumberFormat = firstValue(pageNumberType?.attribs, ["w:fmt", "fmt"]);
  const pageNumberStart = firstValue(pageNumberType?.attribs, ["w:start", "start"]);
  const columnsNode = xmlChild(section, "w:cols");
  const customColumns = xmlChildren(columnsNode, "w:col");
  const columnCountValue = firstValue(columnsNode?.attribs, ["w:num", "num"]);
  const columnSpaceValue = firstValue(columnsNode?.attribs, ["w:space", "space"]);
  const pageBordersNode = xmlChild(section, "w:pgBorders");
  const parsedPageBorders = parseDocxBorders(pageBordersNode, themeColors, false);
  const verticalAlign = xmlVal(xmlChild(section, "w:vAlign"));
  const orientation = explicitOrientation === "landscape" || (!explicitOrientation && width > height)
    ? "landscape"
    : (pageSize ? "portrait" : fallback.orientation);
  const marginValue = (name) => {
    const value = firstValue(pageMargin?.attribs, [`w:${name}`, name]);
    const fallbackValue = name === "gutter" ? (fallback.gutter || 0) : fallback.margins[name];
    return value === undefined || value === null || value === "" ? fallbackValue : value;
  };
  const fallbackPaperSize = normalizePaperSize(fallback.paperSize, docxPage);
  const parsedPaperSize = Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0
    ? normalizePaperSize({ width, height }, fallbackPaperSize)
    : fallbackPaperSize;
  return {
    orientation,
    paperSize: parsedPaperSize,
    pageNumberFormat: ["decimal", "upperRoman", "lowerRoman", "upperLetter", "lowerLetter"].includes(pageNumberFormat) ? pageNumberFormat : fallback.pageNumberFormat,
    pageNumberStart: pageNumberStart === "" ? null : Number(pageNumberStart),
    headerDistance: normalizePageMargin(marginValue("header"), fallback.headerDistance ?? 708),
    footerDistance: normalizePageMargin(marginValue("footer"), fallback.footerDistance ?? 708),
    columns: normalizePageColumns({
      count: columnCountValue === "" ? (customColumns.length || fallback.columns?.count) : Number(columnCountValue),
      space: columnSpaceValue === "" ? fallback.columns?.space : Number(columnSpaceValue),
      // 中文注解：w:cols 已出现但没有 w:col 子项时，OOXML 默认是等宽，不能继承前一节的自定义列。
      equalWidth: columnsNode ? customColumns.length === 0 : undefined,
      items: customColumns.map((column, index) => ({
        width: firstValue(column.attribs, ["w:w", "w", "width"]),
        space: index === customColumns.length - 1 ? 0 : firstValue(column.attribs, ["w:space", "space"])
      })),
      separate: columnsNode
        ? wordOnOffEnabled(firstValue(columnsNode.attribs, ["w:sep", "sep"]) !== "" ? { attribs: { "w:val": firstValue(columnsNode.attribs, ["w:sep", "sep"]) } } : null)
        : fallback.columns?.separate
    }, fallback.columns),
    verticalAlign: ["top", "center", "bottom", "both"].includes(verticalAlign) ? verticalAlign : fallback.verticalAlign,
    pageBorders: normalizePageBorders(pageBordersNode ? {
      display: firstValue(pageBordersNode.attribs, ["w:display", "display"]),
      offsetFrom: firstValue(pageBordersNode.attribs, ["w:offsetFrom", "offsetFrom"]),
      zOrder: firstValue(pageBordersNode.attribs, ["w:zOrder", "zOrder"]),
      ...parsedPageBorders
    } : null, fallback.pageBorders),
    gutter: normalizePageMargin(marginValue("gutter"), fallback.gutter || 0),
    margins: normalizePageMargins({
      top: marginValue("top"),
      right: marginValue("right"),
      bottom: marginValue("bottom"),
      left: marginValue("left")
    }, fallback.margins, orientation, parsedPaperSize)
  };
}

async function parseDocxPageLayout(buffer, archive = null) {
  const zip = archive || await loadSafeDocxArchive(buffer);
  const documentXml = await zip.file("word/document.xml")?.async("string");
  const relationshipsXml = await zip.file("word/_rels/document.xml.rels")?.async("string");
  if (!documentXml) return { pageLayout: normalizePageLayout(defaultPageLayout), sectionLayouts: [normalizePageLayout(defaultPageLayout)], sectionBreakTypes: [], warnings: [] };
  const relationships = parseDocxRelationships(relationshipsXml || "");
  const stylesXml = await zip.file("word/styles.xml")?.async("string") || "";
  const themeXml = await zip.file("word/theme/theme1.xml")?.async("string") || "";
  const styleContext = parseDocxStyles(stylesXml, themeXml);
  const document = parseDocument(documentXml, { xmlMode: true });
  const sections = xmlDescendants(document, "w:sectPr");
  const settingsXml = await zip.file("word/settings.xml")?.async("string") || "";
  const settings = settingsXml ? parseDocument(settingsXml, { xmlMode: true }) : null;
  const oddEvenDifferent = wordOnOffEnabled(settings ? xmlDescendants(settings, "w:evenAndOddHeaders")[0] : null);
  // 中文注解：w:type 属于目标节的 sectPr，描述该节如何开始，因此第 N 个边界读取第 N+1 节的类型。
  const rawSectionBreakTypes = sections.slice(1).map((section) => xmlVal(xmlChild(section, "w:type")) || "nextPage");
  const sectionBreakTypes = rawSectionBreakTypes.map(normalizeSectionBreakType);

  // 中文注解：页眉页脚通过节属性中的关系 ID 指向独立 XML 部件，且缺省引用表示“链接到前一节”。
  const readReferencedPart = async (section, referenceName, referenceType) => {
    const references = xmlChildren(section, referenceName);
    const reference = references.find((item) => (firstValue(item.attribs, ["w:type", "type"]) || "default") === referenceType);
    const relationshipId = firstValue(reference?.attribs, ["r:id", "id"]);
    const target = relationships.get(relationshipId);
    if (!reference || !target) return { present: false, xml: "", path: "", images: [] };
    const path = target.startsWith("/") ? target.slice(1) : `word/${target.replace(/^\.?\//, "")}`;
    return { present: true, path, xml: await zip.file(path)?.async("string") || "", images: [] };
  };

  const sectionLayouts = [];
  const pageParts = [];
  for (const section of sections.length ? sections : [null]) {
    const fallback = sectionLayouts[sectionLayouts.length - 1] || normalizePageLayout(defaultPageLayout);
    const [defaultHeader, defaultFooter, firstHeader, firstFooter, evenHeader, evenFooter] = section ? await Promise.all([
      readReferencedPart(section, "w:headerReference", "default"),
      readReferencedPart(section, "w:footerReference", "default"),
      readReferencedPart(section, "w:headerReference", "first"),
      readReferencedPart(section, "w:footerReference", "first"),
      readReferencedPart(section, "w:headerReference", "even"),
      readReferencedPart(section, "w:footerReference", "even")
    ]) : Array.from({ length: 6 }, () => ({ present: false, xml: "", path: "", images: [] }));
    await Promise.all([
      defaultHeader, defaultFooter, firstHeader, firstFooter, evenHeader, evenFooter
    ].map(async (part) => { part.images = await parseDocxPartImages(zip, part); }));
    pageParts.push(defaultHeader.xml, defaultFooter.xml, firstHeader.xml, firstFooter.xml, evenHeader.xml, evenFooter.xml);
    const geometry = section ? parseDocxPageGeometry(section, fallback, styleContext.themeColors || {}) : { orientation: fallback.orientation, paperSize: fallback.paperSize, pageNumberFormat: fallback.pageNumberFormat, pageNumberStart: fallback.pageNumberStart, headerDistance: fallback.headerDistance, footerDistance: fallback.footerDistance, columns: fallback.columns, verticalAlign: fallback.verticalAlign, pageBorders: fallback.pageBorders, gutter: fallback.gutter, margins: fallback.margins };
    sectionLayouts.push(normalizePageLayout({
      ...parseDocxPageVariantParts(defaultHeader, defaultFooter, fallback, styleContext),
      firstPageDifferent: section ? wordOnOffEnabled(xmlChild(section, "w:titlePg")) : fallback.firstPageDifferent,
      firstPage: parseDocxPageVariantParts(firstHeader, firstFooter, fallback.firstPage, styleContext),
      oddEvenDifferent,
      evenPage: parseDocxPageVariantParts(evenHeader, evenFooter, fallback.evenPage, styleContext),
      ...geometry
    }, fallback));
  }

  // 中文注解：当前页面模型只保存纯文本；只要发现字体、字号、颜色、对齐或其他富格式，就明确提示用户可能丢失样式。
  const hasUnsupportedHeaderFooter = /<w:(?:pict|tbl|shd|tabs|u|strike|vertAlign)\b|<wp:anchor\b/i.test(pageParts.join(""));
  const hasMixedHeaderFooterStyles = pageParts.some((xml) => docxPartHasMixedTextStyles(xml, styleContext));
  const dynamicFieldInstructions = pageParts.flatMap(docxFieldInstructions);
  const hasFlattenedDynamicFields = dynamicFieldInstructions.some((instruction) => !isPageNumberFieldInstruction(instruction));
  const warnings = [];
  if (rawSectionBreakTypes.some((type) => !["nextPage", "continuous", "oddPage", "evenPage"].includes(type))) {
    warnings.push("文档包含暂不支持的分栏分节符，已按下一页分节符恢复；其他分节类型已保留。");
  }
  if (rawSectionBreakTypes.includes("continuous")) {
    warnings.push("文档包含连续分节符；为确保在线分页与导出结果一致，已按下一页分节符恢复。");
  }
  if (hasUnsupportedHeaderFooter || hasMixedHeaderFooterStyles) warnings.push("页眉页脚中的浮动对象、表格、混合字符样式或高级格式暂未完整恢复；内联图片、多段落、基础字体、字号、颜色、加粗、斜体、对齐和页码已保留。");
  if (hasFlattenedDynamicFields) warnings.push("页眉页脚中的日期、文件名或其他动态域已按当前显示值恢复为普通文字，再次导出后不会自动更新。");
  // 中文注解：首节保存在文档页面设置中，后续节由正文分节节点携带，编辑、预览和再次导出共用同一顺序。
  return {
    pageLayout: sectionLayouts[0] || normalizePageLayout(defaultPageLayout),
    sectionLayouts,
    sectionBreakTypes,
    warnings
  };
}

function extractImportedOutline(html = "") {
  const headings = [...String(html).matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)]
    .map((match) => match[1].replace(/<[^>]+>/g, "").trim())
    .filter(Boolean);
  return headings.slice(0, 30);
}

function extractPlainTextOutline(value = "") {
  // 中文注解：旧版 DOC 没有可靠的 HTML 标题结构，按常见中文章节编号识别可用大纲。
  return String(value)
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^(?:[一二三四五六七八九十]+[、.]|第[一二三四五六七八九十]+[章节]|\d+[、.])/.test(line))
    .slice(0, 30);
}

function legacyDocTextToHtml(value = "") {
  // 中文注解：Word 97-2003 提取结果以换行表达结构，将章节行恢复成标题，其余内容保留为独立段落。
  return String(value)
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const tag = /^(?:[一二三四五六七八九十]+[、.]|第[一二三四五六七八九十]+[章节]|\d+[、.])/.test(line) ? "h2" : "p";
      const escapedLine = escapeHtml(line);
      // 中文注解：旧版 DOC 提取器不返回字体颜色；标题按 Word 默认黑色落库，避免继承在线编辑器的墨绿色模板色。
      return tag === "h2" ? `<h2><span style="color: #000000">${escapedLine}</span></h2>` : `<p>${escapedLine}</p>`;
    })
    .join("") || "<p></p>";
}

async function parseImportedDocument(file) {
  const extension = file.originalname.toLowerCase().split(".").pop();
  if (extension === "doc") {
    const document = await wordExtractor.extract(file.buffer);
    const text = document.getBody();
    if (!text?.trim()) {
      throw createPublicError("该 DOC 文件未识别到可编辑文字，文件可能为空、损坏或已加密。", 400);
    }
    return { content: legacyDocTextToHtml(text), outline: extractPlainTextOutline(text), documentType: "Word 文档", pageLayout: { ...defaultPageLayout }, warnings: [] };
  }
  if (extension === "docx") {
    // 中文注解：先在统一入口完成 ZIP 结构与声明解压体积校验，避免异常包进入任一解析回退路径。
    const archive = await loadSafeDocxArchive(file.buffer);
    const pageLayoutResult = await parseDocxPageLayout(file.buffer, archive).catch(() => ({
      pageLayout: normalizePageLayout(defaultPageLayout),
      sectionLayouts: [normalizePageLayout(defaultPageLayout)],
      sectionBreakTypes: [],
      warnings: ["页眉页脚结构未能识别，正文已正常导入。"]
    }));
    let rawHtml = "";
    try {
      rawHtml = await parseStyledDocxToHtml(file.buffer, pageLayoutResult.sectionLayouts, pageLayoutResult.sectionBreakTypes, archive);
    } catch (error) {
      // 中文注解：少数 DOCX 结构异常时回退 Mammoth，优先保证用户能导入并继续编辑。
      console.error("Styled DOCX import fallback to mammoth", error);
    }
    if (!rawHtml.trim()) {
      const result = await mammoth.convertToHtml({ buffer: file.buffer });
      rawHtml = result.value;
    }
    const content = sanitizeImportedHtml(rawHtml);
    return {
      content: content || "<p></p>",
      outline: extractImportedOutline(content),
      documentType: "Word 文档",
      pageLayout: pageLayoutResult.pageLayout,
      sectionLayouts: pageLayoutResult.sectionLayouts,
      warnings: pageLayoutResult.warnings
    };
  }
  if (extension === "pdf") {
    const result = await pdf(file.buffer);
    if (!result.text?.trim()) {
      throw createPublicError("该 PDF 未识别到可编辑文字，扫描件需要接入 OCR 后才能导入。", 400);
    }
    return { content: importedTextToHtml(result.text), outline: [], documentType: "PDF 导入", pageLayout: { ...defaultPageLayout }, warnings: [] };
  }
  throw createPublicError("仅支持导入 .docx 和文字型 .pdf 文件。", 400);
}

function parseJson(value, fallback = null) {
  if (value == null) return fallback;
  if (typeof value === "object") return value;

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function stripHtml(value = "") {
  return String(value)
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function countWords(value = "") {
  return stripHtml(value).replace(/\s+/g, "").length;
}

function safeFileName(value = "document") {
  return String(value)
    .trim()
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, "-")
    .slice(0, 80) || "document";
}

function collectText(node) {
  if (!node) return "";
  if (node.type === "text") return node.data || "";
  if (!node.children?.length) return "";
  return node.children.map(collectText).join("");
}

function normalizeDocxColor(value = "") {
  const hex = String(value).trim().replace("#", "");
  const rgb = String(value).match(/rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)/i);
  if (rgb) {
    return rgb.slice(1).map((part) => Math.max(0, Math.min(Number(part), 255)).toString(16).padStart(2, "0")).join("").toUpperCase();
  }
  return /^[0-9a-f]{6}$/i.test(hex) ? hex.toUpperCase() : "";
}

function cssSizeToHalfPoints(value = "") {
  const text = String(value).trim();
  const pt = text.match(/^([\d.]+)pt$/i);
  if (pt) return Math.round(Number(pt[1]) * 2);
  const px = text.match(/^([\d.]+)px$/i);
  if (px) return Math.round((Number(px[1]) * 72 / 96) * 2);
  return undefined;
}

function cssLengthToTwip(value = "") {
  const text = String(value).trim();
  const pt = text.match(/^([\d.]+)pt$/i);
  if (pt) return Math.round(Number(pt[1]) * 20);
  const px = text.match(/^([\d.]+)px$/i);
  if (px) return Math.round((Number(px[1]) * 72 / 96) * 20);
  const em = text.match(/^([\d.]+)em$/i);
  if (em) return Math.round(Number(em[1]) * 11 * 20);
  return undefined;
}

function cssSignedLengthToTwip(value = "") {
  const text = String(value).trim();
  const pt = text.match(/^(-?[\d.]+)pt$/i);
  if (pt) return Math.round(Number(pt[1]) * 20);
  const px = text.match(/^(-?[\d.]+)px$/i);
  if (px) return Math.round((Number(px[1]) * 72 / 96) * 20);
  return undefined;
}

function cssBaselinePositionToHalfPoints(value = "") {
  const text = String(value).trim();
  const pt = text.match(/^(-?[\d.]+)pt$/i);
  if (pt) return Math.round(Number(pt[1]) * 2);
  const px = text.match(/^(-?[\d.]+)px$/i);
  if (px) return Math.round((Number(px[1]) * 72 / 96) * 2);
  return undefined;
}

function fontFamilyFromCss(value = "") {
  return String(value).split(",")[0]?.replace(/^['"]|['"]$/g, "").trim() || "";
}

function textRunStyleFromNode(node) {
  const styles = parseStyleMap(node?.attribs?.style);
  const runStyle = {};
  const color = normalizeDocxColor(styles.color);
  const size = cssSizeToHalfPoints(styles["font-size"]);
  const font = fontFamilyFromCss(styles["font-family"]);
  const characterSpacing = styles["letter-spacing"] === "normal" ? 0 : cssSignedLengthToTwip(styles["letter-spacing"]);
  const position = styles["vertical-align"] === "baseline" ? 0 : cssBaselinePositionToHalfPoints(styles["vertical-align"]);
  const underlineTypeMap = { solid: "single", double: "double", dotted: "dotted", dashed: "dash", wavy: "wave" };
  const nativeUnderlineType = /^(?:single|words|double|thick|dotted|dottedHeavy|dash|dashedHeavy|dashLong|dashLongHeavy|dotDash|dashDotHeavy|dotDotDash|dashDotDotHeavy|wave|wavyHeavy|wavyDouble)$/.test(styles["--word-underline-type"] || "")
    ? styles["--word-underline-type"]
    : underlineTypeMap[styles["text-decoration-style"]] || "single";
  if (color) runStyle.color = color;
  if (size) runStyle.size = size;
  if (font) runStyle.font = font;
  if (styles["font-weight"] === "bold" || Number(styles["font-weight"]) >= 600) runStyle.bold = true;
  if (styles["font-style"] === "italic") runStyle.italics = true;
  const hasSmallCaps = ["normal", "small-caps"].includes(styles["font-variant-caps"]);
  const hasAllCaps = ["none", "uppercase"].includes(styles["text-transform"]);
  // 中文注解：异常文档可能同时携带两种互斥格式；启用值优先，全部大写再优先于小型大写。
  if (hasAllCaps && styles["text-transform"] === "uppercase") runStyle.allCaps = true;
  else if (hasSmallCaps && styles["font-variant-caps"] === "small-caps") runStyle.smallCaps = true;
  else if (hasAllCaps) runStyle.allCaps = false;
  else if (hasSmallCaps) runStyle.smallCaps = false;
  // 中文注解：零值也要进入扁平化标记，用于覆盖外层 span 的字距或基线设置；docx 会在最终文本运行中省略零值。
  if (characterSpacing !== undefined) runStyle.characterSpacing = characterSpacing;
  if (position !== undefined) runStyle.position = position;
  if (styles["text-decoration-line"] === "underline") {
    const underlineColor = normalizeDocxColor(styles["text-decoration-color"]);
    runStyle.underline = { type: nativeUnderlineType, ...(underlineColor ? { color: underlineColor } : {}) };
  }
  if (node?.attribs?.["data-double-strike"] === "true") runStyle.doubleStrike = true;
  const textBorder = docxRunBorderFromStyles(styles);
  if (textBorder) runStyle.border = textBorder;
  const highlight = normalizeDocxHighlight(node?.attribs?.["data-highlight"]);
  if (highlight) runStyle.highlight = highlight;
  return runStyle;
}

function docxParagraphShadingFromNode(node) {
  try {
    const source = JSON.parse(String(node?.attribs?.["data-paragraph-shading"] || ""));
    const fill = /^#[0-9a-f]{6}$/i.test(String(source?.fill || "")) ? String(source.fill).slice(1).toUpperCase() : "";
    if (!fill) return undefined;
    const color = /^#[0-9a-f]{6}$/i.test(String(source?.color || "")) ? String(source.color).slice(1).toUpperCase() : "000000";
    const type = /^[A-Za-z0-9]+$/.test(String(source?.type || "")) ? String(source.type) : "clear";
    return { fill, color, type };
  } catch {
    return undefined;
  }
}

function paragraphStyleFromNode(node) {
  const styles = parseStyleMap(node?.attribs?.style);
  const paragraphStyle = {};
  const tagOutlineLevel = /^h([1-6])$/.test(String(node?.name || "")) ? Number(String(node.name).slice(1)) - 1 : undefined;
  const attributeOutlineLevel = Number(node?.attribs?.["data-outline-level"]);
  const outlineLevel = Number.isInteger(attributeOutlineLevel) && attributeOutlineLevel >= 0 && attributeOutlineLevel <= 8 ? attributeOutlineLevel : tagOutlineLevel;
  if (outlineLevel !== undefined) paragraphStyle.outlineLevel = outlineLevel;
  const alignmentMap = {
    left: AlignmentType.LEFT,
    center: AlignmentType.CENTER,
    right: AlignmentType.RIGHT,
    justify: AlignmentType.JUSTIFIED
  };
  if (alignmentMap[styles["text-align"]]) paragraphStyle.alignment = alignmentMap[styles["text-align"]];
  const textIndent = cssSignedLengthToTwip(styles["text-indent"]);
  const left = cssLengthToTwip(styles["margin-left"]);
  const right = cssLengthToTwip(styles["margin-right"]);
  if (textIndent !== undefined || left !== undefined || right !== undefined) {
    // 中文注解：CSS 负 text-indent 对应 Word 的 hanging 正值；正值仍按 firstLine 导出。
    paragraphStyle.indent = {
      ...(textIndent && textIndent < 0 ? { hanging: Math.abs(textIndent) } : textIndent && textIndent > 0 ? { firstLine: textIndent } : {}),
      ...(left !== undefined ? { left } : {}),
      ...(right !== undefined ? { right } : {})
    };
  }
  const spacing = {};
  const before = cssLengthToTwip(styles["margin-top"]);
  const after = cssLengthToTwip(styles["margin-bottom"]);
  const unitlessLine = String(styles["line-height"] || "").match(/^([\d.]+)$/);
  const percentLine = String(styles["line-height"] || "").match(/^([\d.]+)%$/);
  const exactLine = cssLengthToTwip(styles["line-height"]);
  if (before !== undefined) spacing.before = before;
  if (after !== undefined) spacing.after = after;
  if (unitlessLine || percentLine) {
    const multiplier = unitlessLine ? Number(unitlessLine[1]) : Number(percentLine[1]) / 100;
    spacing.line = Math.round(multiplier * 240);
    spacing.lineRule = LineRuleType.AUTO;
  } else if (exactLine !== undefined) {
    spacing.line = exactLine;
    spacing.lineRule = styles["--word-line-rule"] === "atLeast" ? LineRuleType.AT_LEAST : LineRuleType.EXACT;
  }
  // 中文注解：只有 HTML 明确携带段落间距时才覆盖模板默认值，避免普通段落丢失既有样式。
  if (Object.keys(spacing).length) paragraphStyle.spacing = spacing;
  const shading = docxParagraphShadingFromNode(node);
  const border = docxBordersFromNode(node, "data-paragraph-borders", false, true);
  if (shading) paragraphStyle.shading = shading;
  if (border) paragraphStyle.border = border;
  if (node?.attribs?.["data-keep-next"] === "true") paragraphStyle.keepNext = true;
  if (node?.attribs?.["data-keep-lines"] === "true") paragraphStyle.keepLines = true;
  if (node?.attribs?.["data-page-break-before"] === "true") paragraphStyle.pageBreakBefore = true;
  if (node?.attribs?.["data-bidirectional"] === "true") paragraphStyle.bidirectional = true;
  if (["true", "false"].includes(node?.attribs?.["data-widow-control"])) paragraphStyle.widowControl = node.attribs["data-widow-control"] === "true";
  const attributeTabStops = normalizeDocxTabStops(node?.attribs?.["data-tab-stops"]);
  const inlineTabStops = [];
  const collectInlineTabs = (current) => {
    if (current?.attribs?.["data-docx-tab"] === "true") {
      inlineTabStops.push({ alignment: current.attribs["data-tab-alignment"], position: Number(current.attribs["data-tab-position"]) });
    }
    for (const child of current?.children || []) collectInlineTabs(child);
  };
  collectInlineTabs(node);
  const tabStops = attributeTabStops.length ? attributeTabStops : normalizeDocxTabStops(inlineTabStops);
  if (tabStops.length) paragraphStyle.tabStops = tabStops.map((tab) => ({ type: tab.alignment, position: tab.position }));
  // 中文注解：分页控制写入 Word 原生段落属性，不能用额外空段落或手动分页符模拟。
  return paragraphStyle;
}

function textRunOptionsFromMarks(text, marks = {}) {
  const specialHyphenChildren = /[\u00AD\u2011]/u.test(text)
    ? text.split(/([\u00AD\u2011])/u).filter(Boolean).map((part) => part === "\u00AD" ? new SoftHyphen() : part === "\u2011" ? new NoBreakHyphen() : part)
    : null;
  return {
    ...(specialHyphenChildren ? { children: specialHyphenChildren } : { text }),
    bold: marks.bold,
    italics: marks.italics,
    smallCaps: marks.allCaps !== undefined ? undefined : marks.smallCaps,
    allCaps: marks.allCaps,
    underline: marks.underline === true ? {} : marks.underline,
    border: marks.border,
    strike: marks.doubleStrike ? undefined : marks.strike,
    doubleStrike: marks.doubleStrike,
    color: marks.color,
    size: marks.size,
    font: marks.font,
    characterSpacing: marks.characterSpacing,
    position: marks.position,
    highlight: marks.highlight,
    superScript: marks.superScript,
    subScript: marks.subScript
  };
}

function textMarksFromNode(node, marks = {}) {
  const nodeRunStyle = textRunStyleFromNode(node);
  const nodeDoubleStrike = node?.attribs?.["data-double-strike"] === "true" || nodeRunStyle.doubleStrike === true;
  return {
    ...marks,
    ...nodeRunStyle,
    bold: marks.bold || nodeRunStyle.bold || ["strong", "b"].includes(node.name),
    italics: marks.italics || nodeRunStyle.italics || ["em", "i"].includes(node.name),
    underline: nodeRunStyle.underline ?? (node.name === "u" ? true : marks.underline),
    strike: nodeDoubleStrike ? false : (marks.strike || ["s", "strike", "del"].includes(node.name)),
    doubleStrike: nodeDoubleStrike || marks.doubleStrike,
    superScript: node.name === "sup" ? true : (node.name === "sub" ? false : marks.superScript),
    subScript: node.name === "sub" ? true : (node.name === "sup" ? false : marks.subScript)
  };
}

function revisionRunsFromNode(node, revision, marks = {}) {
  if (!node) return [];
  const RevisionRun = revision.type === "delete" ? DeletedTextRun : InsertedTextRun;
  const revisionOptions = { id: revision.id, author: revision.author, date: revision.date };
  if (node.type === "text") {
    const text = (node.data || "").replace(/\s+/g, " ");
    return text ? [new RevisionRun({ ...revisionOptions, ...textRunOptionsFromMarks(text, marks) })] : [];
  }
  if (node.name === "br") return [new RevisionRun({ ...revisionOptions, break: 1 })];
  if (node?.attribs?.["data-docx-tab"] === "true") return [new RevisionRun({ ...revisionOptions, children: [new Tab()] })];
  const nextMarks = textMarksFromNode(node, marks);
  return (node.children || []).flatMap((child) => revisionRunsFromNode(child, revision, nextMarks));
}

function textRunsFromNode(node, marks = {}) {
  if (!node) return [];
  const revisionType = node?.attribs?.["data-revision-type"];
  const revisionId = normalizeCommentId(node?.attribs?.["data-revision-id"]);
  if (["insert", "delete"].includes(revisionType) && revisionId !== null) {
    const revision = {
      type: revisionType,
      id: revisionId,
      author: normalizeCommentField(node.attribs?.["data-revision-author"]) || "在线审阅者",
      date: normalizeCommentDate(node.attribs?.["data-revision-date"]) || new Date(0).toISOString()
    };
    // 中文注解：修订范围内按实际字符样式拆成原生修订 run，新增和删除文字不会降级成普通格式。
    return (node.children || []).flatMap((child) => revisionRunsFromNode(child, revision, marks));
  }
  const commentId = normalizeCommentId(node?.attribs?.["data-comment-id"]);
  const commentText = normalizeFootnoteText(node?.attribs?.["data-comment-text"]);
  if (commentId !== null && commentText) {
    const children = (node.children || []).flatMap((child) => textRunsFromNode(child, marks));
    // 中文注解：批注必须包围真实文字范围，并在范围结束后写入引用标记，Word 才会显示审阅气泡。
    return [
      ...(node.attribs?.["data-comment-range-start"] !== "false" ? [new CommentRangeStart(commentId)] : []),
      ...children,
      ...(node.attribs?.["data-comment-range-end"] !== "false" ? [new CommentRangeEnd(commentId), new CommentReference(commentId)] : [])
    ];
  }
  const footnoteId = normalizeFootnoteId(node?.attribs?.["data-footnote-id"]);
  const footnoteText = normalizeFootnoteText(node?.attribs?.["data-footnote-text"]);
  if (footnoteId && footnoteText) {
    // 中文注解：脚注标记必须导出为原生 w:footnoteReference，显示编号由 Word 自动管理，不能写成普通上标文字。
    return [new FootnoteReferenceRun(footnoteId)];
  }
  const endnoteId = normalizeFootnoteId(node?.attribs?.["data-endnote-id"]);
  const endnoteText = normalizeFootnoteText(node?.attribs?.["data-endnote-text"]);
  if (endnoteId && endnoteText) {
    // 中文注解：尾注显示编号交给 Word 自动管理，在线节点只负责原生引用键和正文内容。
    return [new EndnoteReferenceRun(endnoteId)];
  }
  if (node?.attribs?.["data-docx-tab"] === "true") {
    // 中文注解：在线制表位导出为真正的 w:tab，不能降级为空格，否则后续文字无法按段落制表位对齐。
    return [new TextRun({ children: [new Tab()] })];
  }
  if (node.name === "br") {
    // 中文注解：Tiptap 的 Shift+Enter 会保存为 br；必须导出为同一段落内的 w:br，避免两行文字被拼接。
    return [new TextRun({ break: 1 })];
  }
  if (node.type === "text") {
    const text = (node.data || "").replace(/\s+/g, " ");
    // 中文注解：特殊连字符与字符格式由同一组选项构造，普通文字和修订文字保持一致。
    return text ? [new TextRun(textRunOptionsFromMarks(text, marks))] : [];
  }

  if (node.name === "img") {
    const imageRun = imageRunFromNode(node);
    // 中文注解：段落内图片必须作为 ParagraphChild 保留原位置，不能只在顶层节点导出，否则图片往返后会消失。
    return imageRun ? [imageRun] : [];
  }

  if (node.name === "a") {
    const href = safeDocumentHyperlink(node.attribs?.href);
    const linkMarks = { ...marks, color: marks.color || "0563C1", underline: marks.underline ?? true };
    const children = (node.children || []).flatMap((child) => textRunsFromNode(child, linkMarks));
    // 中文注解：只有安全 URL 才生成 DOCX 外部关系；无效地址降级为可读文字，避免导出危险链接。
    return href && children.length ? [new ExternalHyperlink({ link: href, children })] : children;
  }

  const nextMarks = textMarksFromNode(node, marks);

  return (node.children || []).flatMap((child) => textRunsFromNode(child, nextMarks));
}

function isHtmlListNode(node) {
  return ["ol", "ul"].includes(node?.name);
}

function textRunsFromListItem(node) {
  // 中文注解：父列表项只导出自身文字，嵌套列表由后续 Word 段落承载，避免父项重复包含子项文本。
  return (node.children || [])
    .filter((child) => !isHtmlListNode(child))
    .flatMap((child) => textRunsFromNode(child));
}

function parseStyleMap(style = "") {
  return String(style)
    .split(";")
    .map((item) => item.split(":").map((part) => part.trim()))
    .filter(([key, value]) => key && value)
    .reduce((styles, [key, value]) => ({ ...styles, [key.toLowerCase()]: value }), {});
}

function parseFirstLineIndentLevel(node) {
  const attrs = node.attribs || {};
  const dataIndent = Number(attrs["data-indent"] || 0);
  if (dataIndent > 0) return Math.min(dataIndent, 6);

  const styles = parseStyleMap(attrs.style);
  const cssLevel = Number(styles["--indent-level"] || 0);
  if (cssLevel > 0) return Math.min(cssLevel, 6);

  const textIndent = styles["text-indent"] || "";
  const emMatch = textIndent.match(/([\d.]+)em/i);
  if (emMatch) return Math.min(Math.round(Number(emMatch[1]) / 2), 6);

  const pxMatch = textIndent.match(/([\d.]+)px/i);
  if (pxMatch) return Math.min(Math.round(Number(pxMatch[1]) / 32), 6);

  return 0;
}

function paragraphIndentFromNode(node) {
  const level = parseFirstLineIndentLevel(node);
  if (!level) return {};

  // 中文注解：编辑器里 1 级首行缩进约等于 2 个中文字符，Word 使用 twip 单位表示。
  return { indent: { firstLine: level * 440 } };
}

function mergeParagraphOptions(...options) {
  return options.reduce((merged, option) => {
    if (!option) return merged;
    return {
      ...merged,
      ...option,
      indent: option.indent ? { ...(merged.indent || {}), ...option.indent } : merged.indent,
      spacing: option.spacing ? { ...(merged.spacing || {}), ...option.spacing } : merged.spacing
    };
  }, {});
}

function paragraphFromNode(node, listContext = null) {
  const tagName = node.name;
  const ownListText = tagName === "li"
    ? (node.children || []).filter((child) => !isHtmlListNode(child)).map(collectText).join("")
    : collectText(node);
  const text = ownListText.replace(/\s+/g, " ").trim();
  const hasImage = xmlDescendants(node, "img").length > 0;
  if (!text && !hasImage) return null;
  const paragraphStyle = mergeParagraphOptions(paragraphStyleFromNode(node), paragraphIndentFromNode(node));

  const headingLevel = ({
    h1: HeadingLevel.HEADING_1, h2: HeadingLevel.HEADING_2, h3: HeadingLevel.HEADING_3,
    h4: HeadingLevel.HEADING_4, h5: HeadingLevel.HEADING_5, h6: HeadingLevel.HEADING_6
  })[tagName];
  if (headingLevel) {
    const level = Number(tagName.slice(1));
    const spacing = level === 1 ? { after: 120 } : level === 2 ? { before: 180, after: 120 } : { before: 140, after: level === 3 ? 100 : 80 };
    return new Paragraph({ children: textRunsFromNode(node), heading: headingLevel, ...mergeParagraphOptions({ spacing }, paragraphStyle) });
  }

  if (tagName === "li") {
    const level = Math.max(0, Math.min(listContext?.level || 0, 5));
    const listOptions = listContext?.type === "ol"
      ? { numbering: { reference: orderedListReference(listContext.format, listContext.start), level, instance: listContext.instance } }
      : { bullet: { level } };
    // 中文注解：按 HTML 的 ol/ul 类型和嵌套深度写入 Word 原生列表，在线编号不会在导出后变成圆点。
    return new Paragraph({
      children: textRunsFromListItem(node),
      ...listOptions,
      ...mergeParagraphOptions({ spacing: { after: 80 } }, paragraphStyle)
    });
  }

  return new Paragraph({
    children: textRunsFromNode(node),
    ...mergeParagraphOptions({ spacing: { after: 120 } }, paragraphStyle)
  });
}

function tableCellChildrenFromNode(cellNode, listState) {
  const children = [];
  for (const child of cellNode.children || []) {
    if (["h1", "h2", "h3", "h4", "h5", "h6", "p", "li"].includes(child.name)) {
      const paragraph = paragraphFromNode(child);
      if (paragraph) children.push(paragraph);
    } else if (isHtmlListNode(child)) {
      appendListParagraphs(child, children, 0, listState.nextOrderedInstance++);
    } else if (child.name === "img") {
      const paragraph = imageParagraphFromNode(child);
      if (paragraph) children.push(paragraph);
    }
  }
  if (children.length) return children;
  return [new Paragraph({ children: textRunsFromNode(cellNode), spacing: { after: 0 } })];
}

function appendListParagraphs(listNode, blocks, level, orderedInstance) {
  // 中文注解：列表项和嵌套列表分别导出为 Word 段落，递归深度直接映射到 ilvl。
  const listType = listNode.name;
  const listFormat = listType === "ol" ? normalizeOrderedListFormat(listNode.attribs?.["data-list-format"]) : "bullet";
  const listStart = listType === "ol" ? normalizeOrderedListStart(listNode.attribs?.start) : 1;
  for (const listItem of (listNode.children || []).filter((child) => child.name === "li")) {
    const paragraph = paragraphFromNode(listItem, { type: listType, level, instance: orderedInstance, format: listFormat, start: listStart });
    if (paragraph) blocks.push(paragraph);
    for (const nestedList of (listItem.children || []).filter(isHtmlListNode)) {
      appendListParagraphs(nestedList, blocks, Math.min(level + 1, 5), orderedInstance);
    }
  }
}

function tableFromNode(tableNode, listState) {
  const rowNodes = (tableNode.children || []).flatMap((child) => child.name === "tbody" || child.name === "thead" ? child.children || [] : [child]).filter((child) => child.name === "tr");
  const firstRowColumnWidths = [];
  let firstRowHasCompleteWidths = true;
  const rows = rowNodes.map((rowNode) => {
    const cellNodes = (rowNode.children || []).filter((child) => ["td", "th"].includes(child.name));
    if (!cellNodes.length) return null;
    const rowHeight = Math.max(0, Math.min(31680, Math.round(Number(rowNode.attribs?.["data-row-height"]) || 0)));
    const rowHeightRule = rowNode.attribs?.["data-row-height-rule"];
    return new TableRow({
      height: rowHeight > 0 ? {
        value: rowHeight,
        rule: rowHeightRule === "exact" ? HeightRule.EXACT : HeightRule.ATLEAST
      } : undefined,
      cantSplit: rowNode.attribs?.["data-row-cant-split"] === "true" || undefined,
      tableHeader: rowNode.attribs?.["data-row-repeat-header"] === "true" || undefined,
      children: cellNodes.map((cellNode) => {
        const columnSpan = Math.max(1, Math.min(Math.round(Number(cellNode.attribs?.colspan) || 1), 50));
        const rowSpan = Math.max(1, Math.min(Math.round(Number(cellNode.attribs?.rowspan) || 1), 100));
        const pixelWidths = String(cellNode.attribs?.colwidth || "").split(",")
          .map((value) => Number.parseFloat(value))
          .filter((value) => Number.isFinite(value) && value > 0)
          .slice(0, columnSpan);
        const columnWidths = pixelWidths.length === columnSpan ? pixelWidths.map((width) => Math.max(1, Math.round(width * 1440 / 96))) : [];
        if (rowNode === rowNodes[0]) {
          if (columnWidths.length) firstRowColumnWidths.push(...columnWidths);
          else firstRowHasCompleteWidths = false;
        }
        return new TableCell({
          children: tableCellChildrenFromNode(cellNode, listState),
          columnSpan: columnSpan > 1 ? columnSpan : undefined,
          rowSpan: rowSpan > 1 ? rowSpan : undefined,
          width: columnWidths.length ? { size: columnWidths.reduce((total, width) => total + width, 0), type: WidthType.DXA } : undefined,
          margins: docxCellMarginsFromNode(cellNode),
          borders: docxBordersFromNode(cellNode, "data-cell-borders", false),
          verticalAlign: ({ top: VerticalAlignTable.TOP, center: VerticalAlignTable.CENTER, bottom: VerticalAlignTable.BOTTOM })[cellNode.attribs?.["data-cell-vertical-align"]],
          // 中文注解：使用 docx 原生枚举写回 OOXML，确保 Word 中的旋转方向与在线预览一致。
          textDirection: ({ lrTb: TextDirection.LEFT_TO_RIGHT_TOP_TO_BOTTOM, tbRl: TextDirection.TOP_TO_BOTTOM_RIGHT_TO_LEFT, btLr: TextDirection.BOTTOM_TO_TOP_LEFT_TO_RIGHT })[cellNode.attribs?.["data-cell-text-direction"]],
          shading: docxCellShadingFromNode(cellNode) || (cellNode.name === "th" && cellNode.attribs?.["data-docx-cell"] !== "true" ? { fill: "F3F6F8" } : undefined)
        });
      })
    });
  }).filter(Boolean);
  if (!rows.length) return null;

  const resolvedColumnWidths = firstRowHasCompleteWidths ? firstRowColumnWidths : [];
  const originalGridWidth = Math.max(0, Math.round(Number(tableNode.attribs?.["data-table-grid-width"]) || 0));
  const currentGridWidth = resolvedColumnWidths.reduce((total, width) => total + width, 0);
  const widthType = tableNode.attribs?.["data-table-width-type"];
  const widthValue = Math.max(0, Math.round(Number(tableNode.attribs?.["data-table-width-value"]) || 0));
  const columnsChanged = originalGridWidth > 0 && currentGridWidth > 0 && Math.abs(currentGridWidth - originalGridWidth) > 15;
  const width = columnsChanged || widthType === "dxa"
    ? { size: currentGridWidth || widthValue || originalGridWidth, type: WidthType.DXA }
    : widthType === "pct" && widthValue > 0
      ? { size: widthValue / 50, type: WidthType.PERCENTAGE }
      : currentGridWidth > 0
        ? { size: currentGridWidth, type: WidthType.DXA }
        : { size: 100, type: WidthType.PERCENTAGE };
  // 中文注解：拖拽后的 colwidth 优先写回 tblGrid；未编辑时则保留原表格宽度类型，兼顾可编辑性和 Word 语义。
  return new Table({
    width,
    columnWidths: resolvedColumnWidths.length ? resolvedColumnWidths : undefined,
    layout: tableNode.attribs?.["data-table-layout"] === "fixed" ? TableLayoutType.FIXED : TableLayoutType.AUTOFIT,
    alignment: ({ left: AlignmentType.LEFT, center: AlignmentType.CENTER, right: AlignmentType.RIGHT })[tableNode.attribs?.["data-table-alignment"]] || AlignmentType.LEFT,
    indent: Number(tableNode.attribs?.["data-table-indent"])
      ? { size: Math.max(-31680, Math.min(31680, Math.round(Number(tableNode.attribs["data-table-indent"])))), type: WidthType.DXA }
      : undefined,
    // 中文注解：单元格间距直接写入 tblCellSpacing，避免用单元格外边距模拟后造成 Word 表宽和分页偏差。
    cellSpacing: Number(tableNode.attribs?.["data-table-cell-spacing"]) > 0
      ? { value: Math.max(0, Math.min(31680, Math.round(Number(tableNode.attribs["data-table-cell-spacing"])))), type: WidthType.DXA }
      : undefined,
    borders: docxBordersFromNode(tableNode, "data-table-borders", true),
    rows
  });
}

function docxBordersFromNode(node, attributeName, includeInside, includeBetween = false) {
  try {
    const source = JSON.parse(String(node.attribs?.[attributeName] || ""));
    const names = includeInside
      ? ["top", "right", "bottom", "left", "insideHorizontal", "insideVertical"]
      : ["top", "right", "bottom", "left", ...(includeBetween ? ["between"] : [])];
    const borders = {};
    const styleMap = {
      single: BorderStyle.SINGLE, dashed: BorderStyle.DASHED, dashSmallGap: BorderStyle.DASH_SMALL_GAP,
      dotted: BorderStyle.DOTTED, dotDash: BorderStyle.DOT_DASH, dotDotDash: BorderStyle.DOT_DOT_DASH,
      double: BorderStyle.DOUBLE, thick: BorderStyle.THICK, none: BorderStyle.NONE, nil: BorderStyle.NIL
    };
    for (const side of names) {
      const border = source?.[side];
      if (!border || !styleMap[border.style]) continue;
      const size = Math.max(0, Math.min(96, Math.round(Number(border.size) || 0)));
      const color = /^#[0-9a-f]{6}$/i.test(String(border.color || "")) ? String(border.color).slice(1).toUpperCase() : "000000";
      const hasSpace = border.space !== undefined && border.space !== null && border.space !== "";
      const space = Math.max(0, Math.min(31, Math.round(Number(border.space) || 0)));
      borders[side] = { style: styleMap[border.style], size, color, ...(hasSpace ? { space } : {}) };
    }
    return Object.keys(borders).length ? borders : undefined;
  } catch {
    return undefined;
  }
}

function docxBorderStyleValue(style) {
  return {
    single: BorderStyle.SINGLE, dashed: BorderStyle.DASHED, dashSmallGap: BorderStyle.DASH_SMALL_GAP,
    dotted: BorderStyle.DOTTED, dotDash: BorderStyle.DOT_DASH, dotDotDash: BorderStyle.DOT_DOT_DASH,
    double: BorderStyle.DOUBLE, thick: BorderStyle.THICK, none: BorderStyle.NONE, nil: BorderStyle.NIL
  }[style];
}

function docxRunBorderFromStyles(styles = {}) {
  const match = String(styles["--word-text-border"] || "").match(/^(single|dashed|dashSmallGap|dotted|dotDash|dotDotDash|double|thick|none|nil),(\d{1,2}),([0-9a-f]{6}),(\d{1,2})$/i);
  if (!match) return undefined;
  const style = docxBorderStyleValue(match[1]);
  if (!style) return undefined;
  return { style, size: Math.max(0, Math.min(96, Number(match[2]))), color: match[3].toUpperCase(), space: Math.max(0, Math.min(31, Number(match[4]))) };
}

function docxCellMarginsFromNode(cellNode) {
  try {
    const value = JSON.parse(String(cellNode.attribs?.["data-cell-margins"] || ""));
    const margins = {};
    for (const side of ["top", "right", "bottom", "left"]) {
      const width = Number(value?.[side]);
      if (Number.isFinite(width) && width >= 0 && width <= 31680) margins[side] = Math.round(width);
    }
    return Object.keys(margins).length ? { ...margins, marginUnitType: WidthType.DXA } : undefined;
  } catch {
    return undefined;
  }
}

function docxCellShadingFromNode(cellNode) {
  const color = String(cellNode.attribs?.["data-cell-shading"] || "").trim();
  return /^#[0-9a-f]{6}$/i.test(color) ? { fill: color.slice(1).toUpperCase() } : undefined;
}

function dataUrlToImage(value = "") {
  const match = String(value).match(/^data:(image\/(?:png|jpeg|jpg|gif|webp));base64,([\s\S]+)$/i);
  if (!match) return null;
  const mimeType = match[1].toLowerCase().replace("image/jpg", "image/jpeg");
  const extension = mimeType.split("/")[1] === "jpeg" ? "jpg" : mimeType.split("/")[1];
  return { data: Buffer.from(match[2], "base64"), extension };
}

function cssLengthToPixel(value = "") {
  const text = String(value).trim();
  const px = text.match(/^([\d.]+)px$/i);
  if (px) return Number(px[1]);
  const pt = text.match(/^([\d.]+)pt$/i);
  if (pt) return Number(pt[1]) * 96 / 72;
  return undefined;
}

const maximumSafeImageDimension = 20000;
const maximumSafeImagePixels = 100000000;

function normalizeSafeImageDimensions(widthValue, heightValue) {
  const width = Number(widthValue);
  const height = Number(heightValue);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) return null;
  if (width > maximumSafeImageDimension || height > maximumSafeImageDimension || width * height > maximumSafeImagePixels) return null;
  return { width, height };
}

function readJpegDimensions(data) {
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) return null;
  // 中文注解：JPEG 仅在 SOF 段声明像素尺寸；跳过 APP、量化表等可变长段，拒绝越界或在扫描数据前仍找不到 SOF 的文件。
  const startOfFrameMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let offset = 2;
  while (offset + 4 <= data.length) {
    while (offset < data.length && data[offset] !== 0xff) offset += 1;
    while (offset < data.length && data[offset] === 0xff) offset += 1;
    if (offset >= data.length) return null;
    const marker = data[offset];
    offset += 1;
    if (marker === 0xd8 || marker === 0x01) continue;
    if (marker === 0xd9 || marker === 0xda || offset + 2 > data.length) return null;
    const segmentLength = data.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > data.length) return null;
    if (startOfFrameMarkers.has(marker)) {
      if (segmentLength < 7) return null;
      // 中文注解：SOF 载荷按“大端高度、宽度”排列，先交给统一像素上限校验再返回。
      return normalizeSafeImageDimensions(data.readUInt16BE(offset + 5), data.readUInt16BE(offset + 3));
    }
    offset += segmentLength;
  }
  return null;
}

function readWebpDimensions(data) {
  if (data.length < 30 || data.toString("ascii", 0, 4) !== "RIFF" || data.toString("ascii", 8, 12) !== "WEBP") return null;
  const chunkType = data.toString("ascii", 12, 16);
  // 中文注解：扩展、有损和无损 WebP 使用三套固定头布局；只读取首个规范图像头，不扫描或解码压缩像素数据。
  if (chunkType === "VP8X") {
    return normalizeSafeImageDimensions(data.readUIntLE(24, 3) + 1, data.readUIntLE(27, 3) + 1);
  }
  if (chunkType === "VP8 " && data.length >= 30 && data[23] === 0x9d && data[24] === 0x01 && data[25] === 0x2a) {
    return normalizeSafeImageDimensions(data.readUInt16LE(26) & 0x3fff, data.readUInt16LE(28) & 0x3fff);
  }
  if (chunkType === "VP8L" && data.length >= 25 && data[20] === 0x2f) {
    // 中文注解：VP8L 将宽高减一后交错打包进 4 字节，按规范位宽还原后仍执行统一尺寸与总像素限制。
    const width = 1 + data[21] + ((data[22] & 0x3f) << 8);
    const height = 1 + (data[22] >> 6) + (data[23] << 2) + ((data[24] & 0x0f) << 10);
    return normalizeSafeImageDimensions(width, height);
  }
  return null;
}

function readSafeImageDimensions(value, mimeType = "") {
  const data = Buffer.isBuffer(value) ? value : Buffer.from(value || []);
  const normalizedMimeType = String(mimeType).toLowerCase();
  if (normalizedMimeType === "image/png") {
    if (data.length < 24 || data.toString("hex", 0, 8) !== "89504e470d0a1a0a" || data.toString("ascii", 12, 16) !== "IHDR") return null;
    return normalizeSafeImageDimensions(data.readUInt32BE(16), data.readUInt32BE(20));
  }
  if (normalizedMimeType === "image/gif") {
    const signature = data.length >= 10 ? data.toString("ascii", 0, 6) : "";
    if (signature !== "GIF87a" && signature !== "GIF89a") return null;
    return normalizeSafeImageDimensions(data.readUInt16LE(6), data.readUInt16LE(8));
  }
  if (normalizedMimeType === "image/jpeg" || normalizedMimeType === "image/jpg") return readJpegDimensions(data);
  if (normalizedMimeType === "image/webp") return readWebpDimensions(data);
  return null;
}

function imageSizeFromNode(node, data, mimeType) {
  const styles = parseStyleMap(node?.attribs?.style);
  const intrinsic = readSafeImageDimensions(data, mimeType);
  if (!intrinsic) return null;
  const intrinsicWidth = Number(intrinsic.width) || 420;
  const intrinsicHeight = Number(intrinsic.height) || Math.round(intrinsicWidth * 0.62);
  let width = cssLengthToPixel(styles.width) || Number(node?.attribs?.width) || intrinsicWidth;
  let height = cssLengthToPixel(styles.height) || Number(node?.attribs?.height) || width * intrinsicHeight / intrinsicWidth;
  const scale = Math.min(1, 602 / width, 911 / height);
  width = Math.max(1, Math.round(width * scale));
  height = Math.max(1, Math.round(height * scale));
  // 中文注解：图片按真实宽高比缩放到 A4 内容区，在线预览和 Word 不再使用固定假比例。
  return { width, height };
}

function docxFloatingOptionsFromNode(node) {
  const floating = normalizeDocxFloating(node?.attribs?.["data-docx-floating"]);
  if (!floating) return undefined;
  const wrapTypeMap = {
    none: TextWrappingType.NONE,
    square: TextWrappingType.SQUARE,
    tight: TextWrappingType.TIGHT,
    topAndBottom: TextWrappingType.TOP_AND_BOTTOM
  };
  const wrapSideMap = {
    bothSides: TextWrappingSide.BOTH_SIDES,
    left: TextWrappingSide.LEFT,
    right: TextWrappingSide.RIGHT,
    largest: TextWrappingSide.LARGEST
  };
  const positionOptions = (position) => position.align
    ? { relative: position.relative, align: position.align }
    : { relative: position.relative, offset: position.offset };
  // 中文注解：浮动参数直接映射回 wp:anchor；在线模型保存的是 OOXML 原始 EMU，避免多次往返累积单位误差。
  return {
    horizontalPosition: positionOptions(floating.horizontal),
    verticalPosition: positionOptions(floating.vertical),
    allowOverlap: floating.allowOverlap,
    behindDocument: floating.behindDocument,
    lockAnchor: floating.lockAnchor,
    layoutInCell: floating.layoutInCell,
    margins: floating.margins,
    wrap: { type: wrapTypeMap[floating.wrap.type], side: wrapSideMap[floating.wrap.side] },
    zIndex: floating.zIndex
  };
}

function imageRunFromNode(node) {
  const image = dataUrlToImage(node?.attribs?.src);
  if (!image) return null;
  const mimeType = image.extension === "jpg" ? "image/jpeg" : `image/${image.extension}`;
  const transformation = imageSizeFromNode(node, image.data, mimeType);
  if (!transformation) return null;
  const alt = String(node?.attribs?.alt || "正文图片").trim().slice(0, 200) || "正文图片";
  return new ImageRun({
    data: image.data,
    type: image.extension,
    transformation,
    altText: { name: alt, description: alt, title: alt },
    floating: docxFloatingOptionsFromNode(node)
  });
}

function imageParagraphFromNode(node) {
  const imageRun = imageRunFromNode(node);
  if (!imageRun) return new Paragraph({ text: "[图片内容暂未导出]", spacing: { after: 120 } });
  // 中文注解：在线编辑里的 data URL 图片直接写入 DOCX，避免导出后出现空白占位。
  return new Paragraph({
    children: [imageRun],
    spacing: { after: 120 }
  });
}

function isPageBreakNode(node) {
  return node?.name === "div" && node.attribs?.["data-page-break"] === "true";
}

function isColumnBreakNode(node) {
  return node?.name === "div" && node.attribs?.["data-column-break"] === "true";
}

function isSectionBreakNode(node) {
  return node?.name === "div" && Boolean(node.attribs?.["data-section-break"]);
}

function pageLayoutFromSectionBreakNode(node, fallback) {
  try {
    return normalizePageLayout(JSON.parse(node?.attribs?.["data-section-layout"] || "{}"), fallback);
  } catch {
    return normalizePageLayout(fallback);
  }
}

function pageBreakParagraph() {
  // 中文注解：在线分页符导出为 Word 原生分页符，保证用户手动控制的换页位置不会漂移。
  return new Paragraph({ children: [new TextRun({ children: [new DocxPageBreak()] })] });
}

function columnBreakParagraph() {
  // 中文注解：分栏符使用 Word 原生 ColumnBreak；单栏节中 Word 会自然推进到下一页，多栏节中推进到下一栏。
  return new Paragraph({ children: [new DocxColumnBreak()] });
}

function extractDocxBlocksFromNodes(nodes = [], emptyText = "空白文档") {
  const blocks = [];
  // 中文注解：正文和每个表格单元格共用实例分配器，确保所有顶层编号列表都能独立从 1 开始。
  const listState = { nextOrderedInstance: 1 };

  function walk(node) {
    if (isPageBreakNode(node)) {
      blocks.push(pageBreakParagraph());
      return;
    }

    if (isColumnBreakNode(node)) {
      blocks.push(columnBreakParagraph());
      return;
    }

    if (node.name === "table") {
      const table = tableFromNode(node, listState);
      if (table) blocks.push(table);
      return;
    }

    if (node.name === "img") {
      blocks.push(imageParagraphFromNode(node));
      return;
    }

    if (isHtmlListNode(node)) {
      // 中文注解：每个顶层编号列表使用独立实例，确保新列表在 Word 中从 1 重新开始。
      const instance = listState.nextOrderedInstance++;
      appendListParagraphs(node, blocks, 0, instance);
      return;
    }

    if (["h1", "h2", "h3", "h4", "h5", "h6", "p", "li"].includes(node.name)) {
      const paragraph = paragraphFromNode(node);
      if (paragraph) blocks.push(paragraph);
      return;
    }

    for (const child of node.children || []) {
      walk(child);
    }
  }

  for (const child of nodes) {
    walk(child);
  }

  return blocks.length
    ? blocks
    : [new Paragraph({ text: emptyText, spacing: { after: 120 } })];
}

function extractDocxSectionsFromHtml(html = "", firstPageLayout = defaultPageLayout) {
  const parsed = parseDocument(html, { decodeEntities: true });
  const commentRanges = new Map();
  for (const node of xmlDescendants(parsed, "span")) {
    const commentId = normalizeCommentId(node.attribs?.["data-comment-id"]);
    if (commentId === null || !normalizeFootnoteText(node.attribs?.["data-comment-text"])) continue;
    if (!commentRanges.has(commentId)) commentRanges.set(commentId, []);
    commentRanges.get(commentId).push(node);
  }
  for (const nodes of commentRanges.values()) {
    // 中文注解：跨段批注在 HTML 中会拆成多个合法 span，导出前只让首片段开启、末片段关闭原生 Word 范围。
    nodes.forEach((node, index) => {
      node.attribs["data-comment-range-start"] = index === 0 ? "true" : "false";
      node.attribs["data-comment-range-end"] = index === nodes.length - 1 ? "true" : "false";
    });
  }
  const sections = [{ pageLayout: normalizePageLayout(firstPageLayout), breakType: "nextPage", nodes: [] }];
  for (const child of parsed.children || []) {
    if (isSectionBreakNode(child)) {
      const previousLayout = sections[sections.length - 1].pageLayout;
      sections.push({
        pageLayout: pageLayoutFromSectionBreakNode(child, previousLayout),
        breakType: normalizeSectionBreakType(child.attribs?.["data-section-break"]),
        nodes: []
      });
    } else {
      sections[sections.length - 1].nodes.push(child);
    }
  }
  // 中文注解：分节节点只决定边界和下一节设置，不导出为可见段落或普通分页符。
  return sections.map((section) => ({
    pageLayout: section.pageLayout,
    breakType: section.breakType,
    children: extractDocxBlocksFromNodes(section.nodes, "")
  }));
}

function createDocxStyles(templateStyle = {}) {
  const fontFamily = templateStyle.fontFamily || "Microsoft YaHei";
  const bodySize = Number(templateStyle.bodySize || 22);
  const titleSize = Number(templateStyle.titleSize || 36);
  const headingSize = Number(templateStyle.headingSize || 28);
  // 中文注解：模板强调色仅用于封面等视觉素材；Word 标题样式固定为黑色，避免历史模板把绿色字体带入正式文档。
  const titleColor = "000000";
  const headingColor = "000000";

  return {
    default: {
      document: {
        run: { font: fontFamily, size: bodySize },
        paragraph: { spacing: { line: Number(templateStyle.lineSpacing || 360) } }
      },
      // 中文注解：docx 会自动写入内置 Title/Heading 样式；必须通过 default 覆盖，追加同名 paragraphStyles 会产生重复 styleId，Word 可能采用前面的蓝色定义。
      title: {
        run: { font: fontFamily, size: titleSize, bold: true, color: titleColor },
        paragraph: { spacing: { after: 260 } }
      },
      heading1: {
        run: { font: fontFamily, size: headingSize, bold: true, color: headingColor },
        paragraph: { spacing: { before: 240, after: 120 } }
      },
      heading2: {
        run: { font: fontFamily, size: Math.max(headingSize - 2, bodySize), bold: true, color: headingColor },
        paragraph: { spacing: { before: 180, after: 100 } }
      },
      heading3: {
        run: { font: fontFamily, size: Math.max(headingSize - 4, bodySize), bold: true, color: headingColor },
        paragraph: { spacing: { before: 140, after: 100 } }
      },
      heading4: {
        run: { font: fontFamily, size: Math.max(headingSize - 6, bodySize), bold: true, italic: false, color: headingColor },
        paragraph: { spacing: { before: 120, after: 80 } }
      },
      heading5: {
        run: { font: fontFamily, size: bodySize, bold: true, color: headingColor },
        paragraph: { spacing: { before: 100, after: 80 } }
      },
      heading6: {
        run: { font: fontFamily, size: bodySize, bold: true, color: headingColor },
        paragraph: { spacing: { before: 100, after: 80 } }
      }
    }
  };
}

function collectHtmlNotes(content = "", noteName = "footnote") {
  const document = parseDocument(content, { decodeEntities: true });
  const notes = new Map();
  const idAttribute = `data-${noteName}-id`;
  const textAttribute = `data-${noteName}-text`;
  for (const node of xmlDescendants(document, "span")) {
    const id = normalizeFootnoteId(node.attribs?.[idAttribute]);
    const text = normalizeFootnoteText(node.attribs?.[textAttribute]);
    if (id && text && !notes.has(id)) notes.set(id, text);
  }
  const paragraphStyle = noteName === "endnote" ? "EndnoteText" : "FootnoteText";
  return Object.fromEntries(Array.from(notes, ([id, text]) => [String(id), {
    // 中文注解：每一行作为注释部件中的独立段落，保留在线输入的手动分段。
    children: text.split("\n").map((line) => new Paragraph({ text: line || " ", style: paragraphStyle, spacing: { after: 0 } }))
  }]));
}

function collectHtmlComments(content = "") {
  const document = parseDocument(content, { decodeEntities: true });
  const comments = new Map();
  for (const node of xmlDescendants(document, "span")) {
    const id = normalizeCommentId(node.attribs?.["data-comment-id"]);
    const text = normalizeFootnoteText(node.attribs?.["data-comment-text"]);
    if (id === null || !text || comments.has(id)) continue;
    const dateText = normalizeCommentDate(node.attribs?.["data-comment-date"]);
    comments.set(id, {
      id,
      text,
      author: normalizeCommentField(node.attribs?.["data-comment-author"]) || "在线审阅者",
      initials: normalizeCommentField(node.attribs?.["data-comment-initials"], 20),
      ...(dateText ? { date: new Date(dateText) } : {}),
      children: text.split("\n").map((line) => new Paragraph({ text: line || " " }))
    });
  }
  return Array.from(comments.values());
}

function createDocxHeaderFooter(pageLayout, templateStyle = {}, forceDefault = false, forceEven = false) {
  const layout = normalizePageLayout(pageLayout);
  const alignmentMap = { left: AlignmentType.LEFT, center: AlignmentType.CENTER, right: AlignmentType.RIGHT };
  const docxTextStyle = (style) => {
    const normalized = normalizePageTextStyle(style, { ...defaultPageTextStyle, fontFamily: templateStyle.fontFamily || defaultPageTextStyle.fontFamily });
    return {
      alignment: alignmentMap[normalized.alignment] || AlignmentType.CENTER,
      run: {
        font: normalized.fontFamily,
        size: Math.round(normalized.fontSizePt * 2),
        color: normalized.color.slice(1),
        bold: normalized.bold,
        italics: normalized.italic
      }
    };
  };
  const pageNumberChildren = (template, runStyle) => String(template || "").split(/(\{(?:PAGE|NUMPAGES)(?::(?:decimal|upperRoman|lowerRoman|upperLetter|lowerLetter))?\})/g).filter(Boolean).map((part) => {
    const field = part.match(/^\{(PAGE|NUMPAGES)(?::(decimal|upperRoman|lowerRoman|upperLetter|lowerLetter))?\}$/);
    if (field) {
      const switchMap = { decimal: "Arabic", upperRoman: "ROMAN", lowerRoman: "roman", upperLetter: "ALPHABETIC", lowerLetter: "alphabetic" };
      const simpleField = new SimpleField(`${field[1]}${field[2] ? ` \\* ${switchMap[field[2]]}` : ""}`);
      // 中文注解：字段必须与文本 run 同级；缓存 run 复用页眉页脚格式，确保 Word 更新域前后样式一致。
      simpleField.addChildElement(new TextRun({ text: "1", ...runStyle }));
      return simpleField;
    }
    return new TextRun({ text: part, ...runStyle });
  });
  const pageImageRun = (image) => {
    const source = dataUrlToImage(image.src);
    if (!source) return null;
    return new ImageRun({
      data: source.data,
      type: source.extension,
      transformation: { width: image.widthPx, height: image.heightPx }
    });
  };
  const createPartParagraphs = (text, images, pageNumberTemplate, pageNumberSeparate, style) => {
    const lines = String(text || "").split("\n");
    const normalizedImages = normalizePageImages(images);
    const lastImageParagraph = normalizedImages.reduce((maximum, image) => Math.max(maximum, image.paragraphIndex), -1);
    const paragraphCount = Math.max(text ? lines.length : 0, lastImageParagraph + 1);
    const paragraphs = Array.from({ length: paragraphCount }, (_, index) => {
        const line = text ? (lines[index] || "") : "";
        const paragraphImages = normalizedImages.filter((image) => image.paragraphIndex === index);
        const beforeImages = paragraphImages.filter((image) => image.placement === "beforeText").map(pageImageRun).filter(Boolean);
        const afterImages = paragraphImages.filter((image) => image.placement !== "beforeText").map(pageImageRun).filter(Boolean);
        const children = [...beforeImages, ...(line ? [new TextRun({ text: line, ...style.run })] : []), ...afterImages];
        if (index === lines.length - 1 && pageNumberTemplate && !pageNumberSeparate) {
          if (line) children.push(new TextRun({ text: " · ", ...style.run }));
          children.push(...pageNumberChildren(pageNumberTemplate, style.run));
        }
        const imageAlignment = paragraphImages[0]?.alignment;
        return new Paragraph({ alignment: alignmentMap[imageAlignment] || style.alignment, children });
      });
    // 中文注解：多段落文字与页码分段输出，保持常见 Word“说明行 + 独立页码行”的页面结构。
    if (pageNumberTemplate && (!text || pageNumberSeparate)) paragraphs.push(new Paragraph({ alignment: style.alignment, children: pageNumberChildren(pageNumberTemplate, style.run) }));
    return paragraphs;
  };
  const createHeader = (variant, force = false) => {
    const style = docxTextStyle(variant.headerStyle);
    const paragraphs = createPartParagraphs(variant.headerText, variant.headerImages, variant.headerPageNumberTemplate, variant.headerPageNumberSeparate, style);
    if (!force && !paragraphs.length) return undefined;
    return new Header({ children: paragraphs.length ? paragraphs : [new Paragraph({ alignment: style.alignment, children: [] })] });
  };
  const createFooter = (variant, force = false) => {
    const style = docxTextStyle(variant.footerStyle);
    const paragraphs = createPartParagraphs(variant.footerText, variant.footerImages, variant.footerPageNumberTemplate, variant.footerPageNumberSeparate, style);
    if (!force && !paragraphs.length) return undefined;
    return new Footer({ children: paragraphs.length ? paragraphs : [new Paragraph({ alignment: style.alignment, children: [] })] });
  };

  const headers = {
    default: createHeader(layout, forceDefault),
    first: layout.firstPageDifferent ? createHeader(layout.firstPage, true) : undefined,
    even: forceEven ? createHeader(layout.oddEvenDifferent ? layout.evenPage : layout, true) : undefined
  };
  const footers = {
    default: createFooter(layout, forceDefault),
    first: layout.firstPageDifferent ? createFooter(layout.firstPage, true) : undefined,
    even: forceEven ? createFooter(layout.oddEvenDifferent ? layout.evenPage : layout, true) : undefined
  };
  // 中文注解：显式创建空的首页或偶数页部件，避免 Word 回退到默认页眉页脚而与在线预览不一致。
  return {
    headers: Object.values(headers).some(Boolean) ? headers : undefined,
    footers: Object.values(footers).some(Boolean) ? footers : undefined,
    titlePage: layout.firstPageDifferent,
    evenAndOdd: layout.oddEvenDifferent
  };
}

function createDocxSectionProperties(pageLayout, isFirstSection, breakType = "nextPage") {
  const layout = normalizePageLayout(pageLayout);
  const paperSize = normalizePaperSize(layout.paperSize, docxPage);
  const sectionTypes = {
    nextPage: SectionType.NEXT_PAGE,
    oddPage: SectionType.ODD_PAGE,
    evenPage: SectionType.EVEN_PAGE
  };
  const pageBorderStyleMap = {
    single: BorderStyle.SINGLE, dashed: BorderStyle.DASHED, dashSmallGap: BorderStyle.DASH_SMALL_GAP,
    dotted: BorderStyle.DOTTED, dotDash: BorderStyle.DOT_DASH, dotDotDash: BorderStyle.DOT_DOT_DASH,
    double: BorderStyle.DOUBLE, thick: BorderStyle.THICK, none: BorderStyle.NONE, nil: BorderStyle.NIL
  };
  const pageBorders = layout.pageBorders ? {
    pageBorders: { display: layout.pageBorders.display, offsetFrom: layout.pageBorders.offsetFrom, zOrder: layout.pageBorders.zOrder },
    ...Object.fromEntries(["top", "right", "bottom", "left"].flatMap((side) => {
      const border = layout.pageBorders[side];
      if (!border || !pageBorderStyleMap[border.style]) return [];
      return [[`pageBorder${side[0].toUpperCase()}${side.slice(1)}`, {
        style: pageBorderStyleMap[border.style],
        size: border.size,
        color: border.color.slice(1),
        space: border.space
      }]];
    }))
  } : undefined;
  return {
    ...(!isFirstSection ? { type: sectionTypes[normalizeSectionBreakType(breakType)] } : {}),
    titlePage: layout.firstPageDifferent,
    column: layout.columns.equalWidth === false && Array.isArray(layout.columns.items)
      ? {
          count: layout.columns.count,
          separate: layout.columns.separate,
          equalWidth: false,
          children: layout.columns.items.map((item) => new Column({ width: item.width, ...(item.space ? { space: item.space } : {}) }))
        }
      : { count: layout.columns.count, space: layout.columns.space, separate: layout.columns.separate, equalWidth: true },
    verticalAlign: layout.verticalAlign,
    page: {
      size: {
        width: paperSize.width,
        height: paperSize.height,
        orientation: layout.orientation === "landscape" ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT
      },
      margin: { ...layout.margins, header: layout.headerDistance, footer: layout.footerDistance, ...(layout.gutter ? { gutter: layout.gutter } : {}) },
      pageNumbers: {
        ...(layout.pageNumberStart !== null ? { start: layout.pageNumberStart } : {}),
        formatType: layout.pageNumberFormat
      },
      borders: pageBorders
    }
  };
}

async function createDocxBuffer({ title, content, templateStyle = null, pageLayout = null }) {
  const contentSections = extractDocxSectionsFromHtml(content, pageLayout);
  const footnotes = collectHtmlNotes(content, "footnote");
  const endnotes = collectHtmlNotes(content, "endnote");
  const comments = collectHtmlComments(content);
  const orderedListStarts = new Map();
  const contentDocument = parseDocument(content || "", { decodeEntities: true });
  for (const listNode of xmlDescendants(contentDocument, "ol")) {
    const format = normalizeOrderedListFormat(listNode.attribs?.["data-list-format"]);
    const start = normalizeOrderedListStart(listNode.attribs?.start);
    orderedListStarts.set(`${format}:${start}`, { format, start });
  }
  // 中文注解：默认定义兼容新建列表，额外定义只按文档实际出现的起始值生成，避免编号配置无限膨胀。
  for (const definition of orderedListFormatDefinitions) {
    orderedListStarts.set(`${definition.format}:1`, { format: definition.format, start: 1 });
  }
  const evenAndOddHeadersEnabled = contentSections.some((section) => section.pageLayout.oddEvenDifferent);
  const documentSections = contentSections.map((section, index) => {
    // 中文注解：Word 的奇偶页开关是文档级；开启后每节都显式写偶数页部件，防止关闭差异的节继承前节偶数页内容。
    const headerFooter = createDocxHeaderFooter(section.pageLayout, templateStyle || {}, index > 0, evenAndOddHeadersEnabled);
    const children = index === 0 ? [
      new Paragraph({
        text: title || "未命名文档",
        heading: HeadingLevel.TITLE,
        spacing: { after: 260 }
      }),
      ...section.children
    ] : section.children;
    return {
      ...(headerFooter.headers ? { headers: headerFooter.headers } : {}),
      ...(headerFooter.footers ? { footers: headerFooter.footers } : {}),
      properties: createDocxSectionProperties(section.pageLayout, index === 0, section.breakType),
      children
    };
  });
  const document = new Document({
    evenAndOddHeaderAndFooters: evenAndOddHeadersEnabled,
    styles: createDocxStyles(templateStyle || {}),
    numbering: {
      config: [
        ...Array.from(orderedListStarts.values()).map(({ format, start }) => {
          const definition = orderedListFormatDefinition(format);
          return {
            reference: orderedListReference(format, start),
            // 中文注解：每种常用编号格式都预置六级定义，在线 ol 语义可直接恢复为原生 w:numFmt。
            levels: Array.from({ length: 6 }, (_, level) => ({
              level,
              format: definition.docx,
              text: `%${level + 1}.`,
              start,
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } }
            }))
          };
        })
      ]
    },
    ...(Object.keys(footnotes).length ? { footnotes } : {}),
    ...(Object.keys(endnotes).length ? { endnotes } : {}),
    ...(comments.length ? { comments: { children: comments } } : {}),
    sections: documentSections
  });

  return Packer.toBuffer(document);
}

async function ensureStorage() {
  if (!minioClient) {
    throw new Error("未配置 MinIO 存储环境变量");
  }

  const exists = await minioClient.bucketExists(storageBucket);
  if (!exists) {
    await minioClient.makeBucket(storageBucket);
  }

  return minioClient;
}

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function pageImageExtension(mimeType = "") {
  if (mimeType === "image/jpeg") return "jpg";
  return supportedPageImageMimeTypes.has(mimeType) ? mimeType.split("/")[1] : "png";
}

function mapPageLayoutImages(layout, mapper) {
  const normalized = normalizePageLayout(layout);
  const mapVariant = (variant) => normalizePageVariant({
    ...variant,
    headerImages: variant.headerImages.map(mapper),
    footerImages: variant.footerImages.map(mapper)
  }, variant);
  return normalizePageLayout({
    ...mapVariant(normalized),
    firstPage: mapVariant(normalized.firstPage),
    evenPage: mapVariant(normalized.evenPage)
  }, normalized);
}

function pageLayoutImageSources(layouts = []) {
  const sources = new Set();
  for (const layout of layouts) {
    const normalized = normalizePageLayout(layout);
    for (const variant of [normalized, normalized.firstPage, normalized.evenPage]) {
      for (const image of [...variant.headerImages, ...variant.footerImages]) {
        if (image.src) sources.add(image.src);
      }
    }
  }
  return [...sources];
}

async function persistImportedPageImages(pool, storage, userId, documentId, imported) {
  const layouts = imported.sectionLayouts?.length ? imported.sectionLayouts : [imported.pageLayout];
  const sources = pageLayoutImageSources(layouts).filter((src) => src.startsWith("data:"));
  if (!sources.length) return imported;
  const replacements = new Map();
  const storedAssets = [];
  try {
    for (const [index, src] of sources.entries()) {
      const image = dataUrlToImage(src);
      if (!image) continue;
      const mimeType = image.extension === "jpg" ? "image/jpeg" : `image/${image.extension}`;
      const fileName = `page-image-${index + 1}.${pageImageExtension(mimeType)}`;
      const objectKey = `documents/${documentId}/images/${crypto.randomUUID()}.${pageImageExtension(mimeType)}`;
      await storage.putObject(storageBucket, objectKey, image.data, image.data.length, { "Content-Type": mimeType });
      const storedAsset = { id: null, objectKey };
      storedAssets.push(storedAsset);
      const [result] = await pool.query(
        `INSERT INTO files
          (user_id, document_id, original_name, file_name, file_type, mime_type, file_size, bucket, object_key, purpose)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'image')`,
        [userId, documentId, fileName, fileName, pageImageExtension(mimeType), mimeType, image.data.length, storageBucket, objectKey]
      );
      storedAsset.id = result.insertId;
      replacements.set(src, { fileId: result.insertId, src: `/api/files/${result.insertId}/content` });
    }
  } catch (error) {
    const storedIds = storedAssets.map((asset) => asset.id).filter(Boolean);
    if (storedIds.length) await pool.query("DELETE FROM files WHERE id IN (?) AND user_id = ?", [storedIds, userId]).catch(() => undefined);
    await Promise.all(storedAssets.map((asset) => storage.removeObject(storageBucket, asset.objectKey).catch(() => undefined)));
    throw error;
  }
  const replaceImage = (image) => replacements.has(image.src) ? { ...image, ...replacements.get(image.src) } : image;
  const sectionLayouts = layouts.map((layout) => mapPageLayoutImages(layout, replaceImage));
  let content = imported.content;
  for (const [source, replacement] of replacements) content = content.split(source).join(replacement.src);
  // 中文注解：原始 data URL 只在解析阶段短暂存在，入库后统一替换为文件 ID，避免页面设置 JSON 膨胀。
  return { ...imported, content, pageLayout: sectionLayouts[0], sectionLayouts };
}

function stripTransientPageImages(imported) {
  const layouts = imported.sectionLayouts?.length ? imported.sectionLayouts : [imported.pageLayout];
  const sources = pageLayoutImageSources(layouts).filter((src) => src.startsWith("data:"));
  const stripImage = (image) => image.src.startsWith("data:") ? { ...image, src: "", fileId: null } : image;
  const sectionLayouts = layouts.map((layout) => mapPageLayoutImages(layout, stripImage));
  let content = imported.content;
  for (const source of sources) content = content.split(source).join("");
  return { ...imported, content, pageLayout: sectionLayouts[0], sectionLayouts };
}

async function hydratePageImagesForExport(pool, storage, userId, pageLayout, content) {
  const serialized = `${JSON.stringify(pageLayout)}\n${content}`;
  const ids = [...serialized.matchAll(/\/api\/files\/(\d+)\/content/g)].map((match) => Number(match[1]));
  const uniqueIds = [...new Set(ids.filter((id) => Number.isSafeInteger(id) && id > 0))];
  if (!uniqueIds.length) return { pageLayout, content };
  const [rows] = await pool.query(
    "SELECT id, bucket, object_key, mime_type FROM files WHERE id IN (?) AND user_id = ? AND purpose = 'image'",
    [uniqueIds, userId]
  );
  const replacements = new Map();
  for (const row of rows) {
    const stream = await storage.getObject(row.bucket, row.object_key);
    const buffer = await streamToBuffer(stream);
    replacements.set(`/api/files/${row.id}/content`, `data:${row.mime_type};base64,${buffer.toString("base64")}`);
  }
  const replaceImage = (image) => replacements.has(image.src) ? { ...image, src: replacements.get(image.src) } : image;
  let hydratedContent = content;
  for (const [source, dataUrl] of replacements) hydratedContent = hydratedContent.split(source).join(dataUrl);
  // 中文注解：DOCX 打包器需要真实字节，导出前才从 MinIO 临时水合，浏览器和数据库始终只保存受控 URL。
  return { pageLayout: mapPageLayoutImages(pageLayout, replaceImage), content: hydratedContent };
}

function toDocument(row) {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    documentType: row.document_type,
    tone: row.tone,
    templateId: row.template_id == null ? null : Number(row.template_id),
    outline: parseJson(row.outline_json, []),
    content: row.content || "",
    pageLayout: normalizePageLayout(parseJson(row.page_layout_json, defaultPageLayout)),
    status: row.status,
    wordCount: row.word_count,
    lastOpenedAt: row.last_opened_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toTemplateAsset(row, templateId) {
  return {
    id: row.id,
    purpose: row.purpose,
    fileName: row.file_name,
    fileType: row.file_type,
    mimeType: row.mime_type,
    fileSize: row.file_size,
    url: row.purpose === "template_cover" ? `/api/templates/${templateId}/cover` : `/api/templates/${templateId}/assets/${row.id}/download`
  };
}

function summarizeTemplateAssets(assets = []) {
  const cover = assets.find((item) => item.purpose === "template_cover");
  const style = assets.find((item) => item.purpose === "template_style");
  return {
    coverUrl: cover?.url || "",
    hasCover: Boolean(cover),
    hasStyle: Boolean(style),
    assets
  };
}

function toTemplate(row, assets = []) {
  const assetSummary = summarizeTemplateAssets(assets);
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    documentType: row.document_type,
    topic: row.topic || row.name,
    requirement: row.requirement || "",
    outline: parseJson(row.outline_json, []),
    content: row.content || "",
    isSystem: Boolean(row.is_system),
    status: row.status,
    sortOrder: row.sort_order,
    ...assetSummary,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function findTemplateAssets(pool, templateIds) {
  if (!templateIds.length) return new Map();

  const [rows] = await pool.query(
    `SELECT id, template_id, original_name, file_name, file_type, mime_type, file_size, purpose
     FROM files
     WHERE template_id IN (?) AND purpose IN ('template_cover', 'template_style', 'template_asset')
     ORDER BY template_id ASC, purpose ASC, id ASC`,
    [templateIds]
  );

  const grouped = new Map();
  for (const row of rows) {
    const items = grouped.get(row.template_id) || [];
    items.push(toTemplateAsset(row, row.template_id));
    grouped.set(row.template_id, items);
  }
  return grouped;
}

async function readTemplateStyle(pool, storage, templateId) {
  if (!templateId) return null;

  const [[templateRow]] = await pool.query("SELECT id FROM document_templates WHERE id = ? AND status = 'active'", [templateId]);
  if (!templateRow) return null;

  const [[styleRow]] = await pool.query(
    "SELECT bucket, object_key FROM files WHERE template_id = ? AND purpose = 'template_style' ORDER BY id DESC LIMIT 1",
    [templateId]
  );
  if (!styleRow) return null;

  // 中文注解：样式文件从 MinIO 读取，前端只传模板 ID，不接触 MinIO 密钥和 object key。
  const objectStream = await storage.getObject(styleRow.bucket, styleRow.object_key);
  const buffer = await streamToBuffer(objectStream);
  return parseJson(buffer.toString("utf8"), null);
}

async function normalizeActiveTemplateId(connection, templateId) {
  if (templateId == null || templateId === "") return null;
  const normalizedId = Number(templateId);
  if (!Number.isSafeInteger(normalizedId) || normalizedId <= 0) {
    throw createPublicError("文档模板参数无效。", 400);
  }

  const [[templateRow]] = await connection.query(
    "SELECT id FROM document_templates WHERE id = ? AND status = 'active'",
    [normalizedId]
  );
  if (!templateRow) throw createPublicError("所选模板不存在或已停用。", 400);
  return normalizedId;
}

async function ensureDb() {
  if (!dbPool) {
    throw new Error("未配置 DATABASE_URL");
  }
  return dbPool;
}

async function createDocumentVersion(connection, documentId, outline, content, pageLayout, versionNote = "手动保存") {
  const [[versionRow]] = await connection.query(
    "SELECT COALESCE(MAX(version_no), 0) + 1 AS next_version FROM document_versions WHERE document_id = ?",
    [documentId]
  );

  await connection.query(
    "INSERT INTO document_versions (document_id, version_no, outline_json, content, page_layout_json, version_note) VALUES (?, ?, ?, ?, ?, ?)",
    [documentId, versionRow.next_version, jsonString(outline || []), content || "", jsonString(normalizePageLayout(pageLayout)), versionNote]
  );
}

function resolveAiAuditContentMode(environment = {}) {
  const configuredMode = String(environment.AI_AUDIT_CONTENT_MODE || "").trim().toLowerCase();
  if (["full", "metadata", "disabled"].includes(configuredMode)) return configuredMode;
  const production = [environment.APP_ENV, environment.NODE_ENV]
    .some((value) => String(value || "").trim().toLowerCase() === "production");
  // 中文注解：即使生产配置门禁被错误绕过，运行时也默认元数据模式，绝不回退到完整内容日志。
  return production ? "metadata" : "full";
}

const aiAuditActionTypes = new Set([
  "template_agent_plan",
  "generate_outline",
  "generate_body",
  "continue",
  "expand",
  "shorten",
  "correct",
  "format",
  "polish",
  "polish_legacy"
]);

function buildAiAuditRecord({ requestId = null, actionType, prompt, responseText, status = "success", errorMessage = null, latencyMs = null }, environment = process.env) {
  const contentMode = resolveAiAuditContentMode(environment);
  if (contentMode === "disabled") return null;
  const promptValue = String(prompt || "");
  const responseValue = String(responseText || "");
  const hashKey = String(environment.AI_AUDIT_HASH_KEY || "");
  // 中文注解：无专用密钥时宁可不生成指纹，也不能退回可被字典反推的无密钥摘要。
  const fingerprint = (value) => hashKey
    ? crypto.createHmac("sha256", hashKey).update(value, "utf8").digest("hex")
    : null;
  const fullContent = contentMode === "full";
  const normalizedError = errorMessage == null
    ? null
    : (fullContent
        ? String(errorMessage).slice(0, 4000)
        : toPublicErrorMessage(new Error(String(errorMessage)), "AI 请求失败，请稍后重试。"));

  return {
    requestId: String(requestId || "").trim().slice(0, 64) || null,
    // 中文注解：审计动作同样在最终写库边界收敛，避免未来调用点误把客户输入当作动作保存。
    actionType: typeof actionType === "string" && aiAuditActionTypes.has(actionType) ? actionType : "unknown",
    prompt: fullContent ? promptValue.slice(0, 262144) : null,
    responseText: fullContent ? responseValue.slice(0, 262144) : null,
    promptHmacSha256: fingerprint(promptValue),
    responseHmacSha256: fingerprint(responseValue),
    promptChars: Array.from(promptValue).length,
    responseChars: Array.from(responseValue).length,
    status: status === "failed" ? "failed" : "success",
    errorMessage: normalizedError,
    latencyMs: Number.isInteger(latencyMs) && latencyMs >= 0 ? latencyMs : null
  };
}

const aiEditInstructions = Object.freeze({
  continue: "Continue writing based on the selected text.",
  expand: "Expand the selected text with more detail.",
  shorten: "Shorten the selected text while keeping key information.",
  correct: "Correct typos, grammar issues, and unnatural expressions.",
  format: "Optimize the selected text as a professional Word document section. Keep the original meaning, improve paragraph hierarchy, normalize section titles, split long paragraphs, convert obvious enumerations into clear numbered or bullet-style lines, and make the structure easier to read.",
  polish: "Polish the selected text to be more formal, clear, and suitable for an office Word document."
});

function normalizeAiEditAction(action) {
  // 中文注解：客户端动作只允许固定业务枚举；未知值按润色执行且不得进入审计、计费幂等键等持久字段。
  return typeof action === "string" && Object.prototype.hasOwnProperty.call(aiEditInstructions, action)
    ? action
    : "polish";
}

async function logAiRequest({ userId = localUserId, documentId = null, ...auditInput }) {
  if (!dbPool) return;
  const auditRecord = buildAiAuditRecord(auditInput);
  if (!auditRecord) return;

  try {
    await dbPool.query(
      `INSERT INTO ai_request_logs
        (user_id, document_id, action_type, model, request_id, prompt, response,
         prompt_hmac_sha256, response_hmac_sha256, prompt_chars, response_chars, status, error_message, latency_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        documentId,
        auditRecord.actionType,
        gatewayModel,
        auditRecord.requestId,
        auditRecord.prompt,
        auditRecord.responseText,
        auditRecord.promptHmacSha256,
        auditRecord.responseHmacSha256,
        auditRecord.promptChars,
        auditRecord.responseChars,
        auditRecord.status,
        auditRecord.errorMessage,
        auditRecord.latencyMs
      ]
    );
  } catch (error) {
    console.warn("AI request log write failed:", error.message);
  }
}

function hasGatewayConfig() {
  return Boolean(
    llmApiUrl &&
      llmApiKey &&
      !llmApiKey.includes("replace-with") &&
      !llmApiKey.includes("请替换")
  );
}

function normalizeModelText(result) {
  const message = result?.choices?.[0]?.message;
  const content = message?.content;

  if (typeof content === "string" && content.trim()) {
    return content.trim();
  }

  // 中文注解：部分推理模型可能把内容放在 reasoning_content，兜底提取，避免前端拿到空结果。
  if (typeof message?.reasoning_content === "string" && message.reasoning_content.trim()) {
    return message.reasoning_content.trim();
  }

  return "";
}

function extractJsonArray(text) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;

  try {
    const parsed = JSON.parse(candidate);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    const start = candidate.indexOf("[");
    const end = candidate.lastIndexOf("]");
    if (start >= 0 && end > start) {
      try {
        const parsed = JSON.parse(candidate.slice(start, end + 1));
        return Array.isArray(parsed) ? parsed : null;
      } catch {
        return null;
      }
    }
  }

  return null;
}

function parseCookies(request) {
  const header = request.headers.cookie || "";
  return Object.fromEntries(
    header
      .split(";")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => {
        const index = item.indexOf("=");
        return index > -1 ? [item.slice(0, index), decodeURIComponent(item.slice(index + 1))] : [item, ""];
      })
  );
}

function getSessionCookie(request) {
  return parseCookies(request)[sessionCookieName] || "";
}

function hashSessionToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function setSessionCookie(response, token, maxAgeSeconds = sessionTtlSeconds) {
  const cookieParts = [
    `${sessionCookieName}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`
  ];

  if (sessionCookieSecure) {
    cookieParts.push("Secure");
  }

  response.setHeader("Set-Cookie", cookieParts.join("; "));
}

function clearSessionCookie(response) {
  response.setHeader("Set-Cookie", `${sessionCookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function unwrapMolingData(result) {
  if (result && typeof result === "object" && "code" in result) {
    if (result.code !== 0) {
      const error = new Error(result.message || "墨灵平台接口调用失败");
      error.code = result.code;
      throw error;
    }

    return result.data;
  }

  return result;
}

async function callMolingInternal(path, options = {}) {
  if (!internalApiToken) {
    throw new Error("未配置 INTERNAL_API_TOKEN");
  }

  const url = new URL(path, molingApiBaseUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), molingInternalTimeoutMs);
  try {
    const response = await fetch(url, {
      method: options.method || "GET",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Token": internalApiToken,
        ...(options.headers || {})
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal
    });
    // 中文注解：超时覆盖响应正文读取，不能在仅收到响应头时提前撤销保护。
    const result = await response.json().catch((error) => {
      if (controller.signal.aborted) throw error;
      return null;
    });

    if (!response.ok) {
      const message = result?.message || result?.error || `墨灵平台接口调用失败：${response.status}`;
      const error = new Error(message);
      error.status = response.status;
      error.code = result?.code;
      throw error;
    }

    return unwrapMolingData(result);
  } finally {
    clearTimeout(timeout);
  }
}

async function verifyMolingLaunchTicket(ticket) {
  // Note: launch ticket is exchanged only on the server side.
  return callMolingInternal("/api/internal/app-launch/verify", {
    method: "POST",
    body: { launch_ticket: ticket }
  });
}

function normalizeMolingId(value) {
  return value == null ? "" : String(value);
}

function toMolingNumber(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : value;
}

async function createLocalSession({ userId, appId, productId }) {
  const pool = await ensureDb();
  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashSessionToken(token);
  const expiresAt = new Date(Date.now() + sessionTtlSeconds * 1000);

  await pool.query(
    `INSERT INTO molin_user_sessions
      (user_id, app_id, product_id, session_token_hash, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
    [normalizeMolingId(userId), normalizeMolingId(appId), normalizeMolingId(productId), tokenHash, expiresAt]
  );

  return { token, expiresAt };
}

async function getCurrentSession(request) {
  if (!dbPool) return null;

  const token = getSessionCookie(request);
  if (!token) return null;

  const tokenHash = hashSessionToken(token);
  const [[session]] = await dbPool.query(
    `SELECT user_id, app_id, product_id, expires_at
     FROM molin_user_sessions
     WHERE session_token_hash = ? AND expires_at > NOW()
     LIMIT 1`,
    [tokenHash]
  );

  return session || null;
}

async function getCurrentUser(request) {
  const token = getSessionCookie(request);
  const session = await getCurrentSession(request);
  if (session) {
    return {
      userId: normalizeMolingId(session.user_id),
      appId: normalizeMolingId(session.app_id),
      productId: normalizeMolingId(session.product_id || molingProductId),
      isMolingUser: true,
      expiresAt: session.expires_at
    };
  }

  if (token) {
    throw createPublicError("墨灵登录已过期，请从墨灵平台重新进入。", 401);
  }

  if (requireMolingSession && !localMolingMock) {
    throw createPublicError("请从墨灵平台进入应用后再继续操作。", 401);
  }

  // 中文注解：直接本地打开且没有墨灵 cookie 时，保留本地开发用户，方便单机调试。
  return {
    userId: localUserId,
    appId: normalizeMolingId(molingAppId),
    productId: normalizeMolingId(molingProductId),
    isMolingUser: false,
    expiresAt: null
  };
}

function serializeUserContext(user) {
  return {
    userId: user.userId,
    appId: user.appId,
    productId: user.productId,
    isMolingUser: user.isMolingUser,
    expiresAt: user.expiresAt
  };
}

async function getUserEntitlements(userId, productId) {
  const params = new URLSearchParams({ user_id: String(userId), product_id: String(productId) });
  const data = await callMolingInternal(`/api/internal/user-entitlements?${params.toString()}`);
  return data?.entitlements || [];
}

async function getPointsSummary(user) {
  if (!user.isMolingUser || localMolingMock || !user.productId) {
    return { enabled: false, entitlements: [], remaining: null };
  }

  const entitlements = await getUserEntitlements(user.userId, user.productId);
  const remainingValues = entitlements
    .filter((item) => item.usable)
    .map((item) => (item.remaining == null ? null : Number(item.remaining)))
    .filter((item) => item == null || Number.isFinite(item));

  return {
    enabled: true,
    entitlements,
    remaining: remainingValues.some((item) => item == null)
      ? null
      : remainingValues.reduce((sum, item) => sum + Number(item), 0)
  };
}

async function findUsableEntitlement(userId, productId) {
  const entitlements = await getUserEntitlements(userId, productId);
  const entitlement = entitlements.find((item) => item.usable);

  if (!entitlement) {
    const error = new Error("积分不足或没有可用套餐");
    error.code = 60005;
    throw error;
  }

  return entitlement;
}

async function reservePoints(user, usageType, amount, referenceId = "") {
  if (!user.isMolingUser || localMolingMock) return null;

  const entitlement = await findUsableEntitlement(user.userId, user.productId);
  // 中文注解：引用内容只参与摘要，避免把长文档标题或用户输入直接写入平台幂等键和账务表。
  const referenceDigest = crypto.createHash("sha256").update(String(referenceId || "none")).digest("hex").slice(0, 16);
  const idempotencyKey = `moling_word:${user.userId}:${usageType}:${referenceDigest}:${crypto.randomUUID()}`;
  const data = await callMolingInternal("/api/internal/entitlement-reserve", {
    method: "POST",
    body: {
      entitlement_id: entitlement.entitlement_id || entitlement.id,
      user_id: toMolingNumber(user.userId),
      amount: String(amount),
      idempotency_key: idempotencyKey
    }
  });

  if (!data?.hold_id) {
    throw new Error("墨灵积分预占未返回 hold_id");
  }

  return {
    holdId: data.hold_id,
    idempotencyKey,
    amount,
    state: "reserved",
    userId: String(user.userId),
    usageType
  };
}

function createBillingReconciliationPayload(hold, actualAmount, context = {}, error = null) {
  if (!hold?.holdId || !hold?.idempotencyKey) return null;
  return {
    userId: cleanTemplateAgentText(context.userId || localUserId, 64),
    usageType: cleanTemplateAgentText(context.usageType || "unknown", 60),
    holdId: String(hold.holdId).slice(0, 64),
    idempotencyKey: String(hold.idempotencyKey).slice(0, 191),
    actualAmount: String(actualAmount),
    operationType: context.operationType === "release" ? "release" : "settle",
    settlementState: context.operationType === "release" ? "release_unknown" : "settlement_unknown",
    lastError: cleanTemplateAgentText(error instanceof Error ? error.message : error, 1000) || "积分操作响应状态不确定"
  };
}

async function appendBillingReconciliationOutbox(payload, databaseError = null) {
  const record = {
    ...payload,
    databaseError: cleanTemplateAgentText(databaseError instanceof Error ? databaseError.message : databaseError, 1000),
    recordedAt: new Date().toISOString()
  };
  await mkdir(path.dirname(billingReconciliationOutboxPath), { recursive: true });
  await appendFile(billingReconciliationOutboxPath, `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });
}

async function persistBillingReconciliationTask(hold, actualAmount, context = {}, error = null, candidatePool = dbPool, outboxWriter = appendBillingReconciliationOutbox) {
  const payload = createBillingReconciliationPayload(hold, actualAmount, context, error);
  if (!payload) return false;
  if (!candidatePool) {
    // 中文注解：数据库不可用时写入独立 JSONL outbox；生产部署应把该路径放在持久卷并由值班流程导入对账表。
    await outboxWriter(payload, new Error("DATABASE_URL is missing"));
    return true;
  }

  try {
    await candidatePool.query(
      `INSERT INTO billing_reconciliation_tasks
        (user_id, usage_type, operation_type, hold_id, idempotency_key, actual_amount, settlement_state, status, attempt_count, last_error, next_retry_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, CURRENT_TIMESTAMP)
       ON DUPLICATE KEY UPDATE
         operation_type = IF(status = 'resolved', operation_type, VALUES(operation_type)),
         actual_amount = IF(status = 'resolved', actual_amount, VALUES(actual_amount)),
         settlement_state = IF(status = 'resolved', settlement_state, VALUES(settlement_state)),
         last_error = IF(status = 'resolved', last_error, VALUES(last_error)),
         next_retry_at = IF(status = 'resolved', next_retry_at, CURRENT_TIMESTAMP),
         claim_token = IF(status = 'resolved', claim_token, NULL),
         status = IF(status = 'resolved', status, 'pending')`,
      [
        payload.userId,
        payload.usageType,
        payload.operationType,
        payload.holdId,
        payload.idempotencyKey,
        payload.actualAmount,
        payload.settlementState,
        payload.lastError
      ]
    );
  } catch (databaseError) {
    await outboxWriter(payload, databaseError);
  }
  return true;
}

async function settlePoints(hold, actualAmount, context = {}) {
  if (!hold) return null;
  // 中文注解：结算使用同一个幂等键重试一次。若网络或 5xx 后仍无法确认结果，保留待对账状态，绝不盲目释放导致已结算额度被冲回。
  hold.state = "settling";
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = await callMolingInternal("/api/internal/entitlement-settle", {
        method: "POST",
        body: {
          hold_id: hold.holdId,
          idempotency_key: hold.idempotencyKey,
          actual_amount: String(actualAmount)
        }
      });
      hold.state = "settled";
      return result;
    } catch (error) {
      lastError = error;
    }
  }

  // 中文注解：HTTP 408/409/429 以及平台幂等冲突都可能发生在实际结算之后；没有明确的账本查询结果时统一等待对账。
  hold.state = "settlement_unknown";
  try {
    hold.reconciliationPersisted = await persistBillingReconciliationTask(hold, actualAmount, { ...context, operationType: "settle" }, lastError);
  } catch (reconciliationError) {
    hold.reconciliationPersisted = false;
    // 中文注解：数据库和 outbox 同时失败时仍输出结构化恢复依据，日志采集可据此补录对账任务。
    console.error("Billing settlement reconciliation persistence failed:", JSON.stringify({
      holdId: String(hold.holdId || ""),
      idempotencyKey: String(hold.idempotencyKey || ""),
      usageType: cleanTemplateAgentText(context.usageType || hold.usageType, 60),
      error: reconciliationError.message
    }));
  }
  throw lastError;
}

function shouldReleasePointHold(hold) {
  return Boolean(hold && hold.state === "reserved");
}

async function releasePoints(hold) {
  if (!shouldReleasePointHold(hold)) return null;
  hold.state = "releasing";
  try {
    const result = await callMolingInternal("/api/internal/entitlement-release", {
      method: "POST",
      body: {
        hold_id: hold.holdId,
        idempotency_key: hold.idempotencyKey
      }
    });
    hold.state = "released";
    return result;
  } catch (error) {
    // 中文注解：释放请求异常也可能导致预占额度长期冻结，必须持久化并使用原幂等键安全重试释放。
    hold.state = "release_unknown";
    try {
      hold.reconciliationPersisted = await persistBillingReconciliationTask(
        hold,
        0,
        { userId: hold.userId, usageType: hold.usageType, operationType: "release" },
        error
      );
    } catch (reconciliationError) {
      hold.reconciliationPersisted = false;
      // 中文注解：数据库和 outbox 同时失败时输出结构化依据，确保日志采集仍可恢复 hold 与幂等键。
      console.error("Billing release reconciliation persistence failed:", JSON.stringify({
        holdId: String(hold.holdId || ""),
        idempotencyKey: String(hold.idempotencyKey || ""),
        error: reconciliationError.message
      }));
    }
    throw error;
  }
}

function parseOutline(text, topic) {
  const jsonArray = extractJsonArray(text);
  const fromJson = jsonArray
    ?.map((item) => (typeof item === "string" ? item : item?.title))
    .filter((item) => typeof item === "string" && item.trim())
    .map((item) => item.trim());

  if (fromJson?.length) {
    return fromJson.slice(0, 8);
  }

  // 中文注解：模型没有按 JSON 返回时，尝试从普通编号文本中提取大纲。
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*\d.、\s]+/, "").trim())
    .filter(Boolean)
    .filter((line) => line.length <= 80);

  return lines.length ? lines.slice(0, 8) : fallbackOutline(topic);
}

function stripMarkdownHeadings(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^#{1,6}\s+/, "").trimEnd())
    .join("\n")
    .trim();
}

function hasGarbledText(text) {
  const questionMarks = (text.match(/\?/g) || []).length;
  return questionMarks >= 8 || /锟{2,}|�{2,}/.test(text);
}

function looksLikeMissingInput(text) {
  return /请提供|没有提供|未提供|无法.*处理|missing input/i.test(text);
}

function looksIrrelevantToWordEditor(text) {
  return /Backspace|Delete|分页符|编辑标记|show\/hide/i.test(text);
}

function validateAiText(text, options = {}) {
  const normalized = stripMarkdownHeadings(text || "");
  const minLength = options.minLength ?? 12;

  if (!normalized || normalized.length < minLength) {
    throw new Error("AI response is too short");
  }

  if (hasGarbledText(normalized)) {
    throw new Error("AI response looks garbled");
  }

  if (looksLikeMissingInput(normalized)) {
    throw new Error("AI did not handle the input correctly");
  }

  if (looksIrrelevantToWordEditor(normalized)) {
    throw new Error("AI response is unrelated to the current Word editing task");
  }

  return normalized;
}

function normalizeGeneratedBodyOutline(outline, topic = "AI Word 文档") {
  const items = Array.isArray(outline) ? outline : [];
  const normalized = items
    .map((item) => {
      const title = String(typeof item === "string" ? item : item?.title || "").replace(/\s+/g, " ").trim().slice(0, 200);
      const requestedLevel = Number(typeof item === "object" ? item?.level : 2);
      return { title, level: Number.isInteger(requestedLevel) ? Math.min(6, Math.max(1, requestedLevel)) : 2 };
    })
    .filter((item) => item.title);
  // 中文注解：不能静默截断用户大纲；提示词和格式化统一复用完整规范化结果，确保章节与正文按索引准确对应。
  return normalized.length ? normalized : [{ title: `一、${String(topic || "AI Word 文档").trim() || "AI Word 文档"}正文`, level: 2 }];
}

function cleanGeneratedBodyText(value, limit = 6000) {
  return String(value ?? "")
    .replace(/```(?:json)?/gi, "")
    .replace(/```/g, "")
    .replace(/^#{1,6}\s*/g, "")
    .replace(/^[-*+]\s+/, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

function generatedBodyHeadingKey(value) {
  return cleanGeneratedBodyText(value, 200)
    .replace(/^(?:第\s*[一二三四五六七八九十百千\d]+\s*[章节部分]|[一二三四五六七八九十百千]+|\d+)\s*[、.．)）:\-—]?\s*/u, "")
    .replace(/[\s、，。；：:,.．·\-—_（）()《》]/g, "")
    .toLowerCase();
}

function generatedBodyParagraphs(value) {
  const sources = Array.isArray(value) ? value : String(value ?? "").split(/\r?\n{2,}|\r?\n/);
  return sources.map((item) => cleanGeneratedBodyText(item)).filter(Boolean).slice(0, 8);
}

function parseGeneratedBodySections(text, outline, topic) {
  const normalizedOutline = normalizeGeneratedBodyOutline(outline, topic);
  const sections = normalizedOutline.map((item) => ({ ...item, paragraphs: [] }));
  const jsonSections = extractJsonArray(String(text || ""));

  if (jsonSections?.length) {
    jsonSections.slice(0, sections.length).forEach((item, index) => {
      const paragraphSource = typeof item === "string" ? item : item?.paragraphs ?? item?.content ?? item?.body ?? "";
      sections[index].paragraphs.push(...generatedBodyParagraphs(paragraphSource));
    });
  } else {
    let currentIndex = 0;
    let nextSequentialHeadingIndex = 0;
    const titleKeys = normalizedOutline.map((item) => generatedBodyHeadingKey(item.title));
    for (const rawLine of String(text || "").replace(/```(?:json)?/gi, "").replace(/```/g, "").split(/\r?\n/)) {
      const line = cleanGeneratedBodyText(rawLine);
      if (!line) continue;
      const key = generatedBodyHeadingKey(line);
      const matchedIndex = titleKeys.findIndex((titleKey) => titleKey && key === titleKey);
      const looksLikeHeading = /^#{1,6}\s+/.test(rawLine.trim())
        || /^(?:第\s*[一二三四五六七八九十百千\d]+\s*[章节部分]|[一二三四五六七八九十百千]+|\d+)\s*[、.．)）:\-—]\s*/u.test(line);
      if (matchedIndex >= 0) {
        currentIndex = matchedIndex;
        nextSequentialHeadingIndex = Math.max(nextSequentialHeadingIndex, matchedIndex + 1);
        continue;
      }
      if (looksLikeHeading && nextSequentialHeadingIndex < sections.length) {
        currentIndex = nextSequentialHeadingIndex;
        nextSequentialHeadingIndex += 1;
        continue;
      }
      sections[currentIndex].paragraphs.push(line);
    }
  }

  sections.forEach((section) => {
    if (section.paragraphs.length) return;
    // 中文注解：模型偶尔漏写某一节时仍保留用户确认的大纲结构，并提供可继续编辑的完整段落，而不是留下空标题。
    section.paragraphs.push(`本节围绕“${section.title}”展开，结合${String(topic || "文档主题").trim() || "文档主题"}说明相关背景、实施要点与预期成果。`);
  });
  return sections;
}

function formatGeneratedBodyHtml(text, outline = [], topic = "AI Word 文档") {
  const sections = parseGeneratedBodySections(text, outline, topic);
  const headingStyle = "margin-top: 12pt; margin-bottom: 6pt; line-height: 1.3";
  const headingTextStyle = "color: #000000; font-weight: bold; font-family: Microsoft YaHei; font-size: 16pt";
  const paragraphStyle = "line-height: 1.5; text-align: justify; margin-top: 0pt; margin-bottom: 6pt";
  const bodyTextStyle = "color: #000000; font-weight: 600; font-family: Microsoft YaHei; font-size: 11pt";

  // 中文注解：排版写入受控 HTML，而不是仅靠页面主题 CSS，确保保存重开和导出 Word 都保留标题、缩进、颜色与字重。
  return sections.map((section) => {
    const headingLevel = Math.min(6, Math.max(1, section.level));
    const heading = `<h${headingLevel} data-outline-level="${headingLevel - 1}" data-keep-next="true" data-keep-lines="true" data-widow-control="true" style="${headingStyle}"><span style="${headingTextStyle}">${escapeHtml(section.title)}</span></h${headingLevel}>`;
    const paragraphs = section.paragraphs.map((paragraph) => `<p data-indent="1" data-widow-control="true" style="${paragraphStyle}"><span style="${bodyTextStyle}">${escapeHtml(paragraph)}</span></p>`).join("");
    return `${heading}${paragraphs}`;
  }).join("") || "<p></p>";
}

async function callMolinChat(messages) {
  if (!hasGatewayConfig()) {
    throw new Error("未配置 AI 模型服务环境变量");
  }

  let lastError;

  for (let attempt = 0; attempt <= llmMaxRetries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), llmTimeoutMs);

    try {
      // 中文注解：这里兼容 OpenAI chat/completions 风格的 DeepSeek 或墨灵网关。
      const response = await fetch(llmApiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${llmApiKey}`
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: gatewayModel,
          messages,
          temperature: 0.4
        })
      });
      // 中文注解：模型超时必须覆盖响应正文读取，防止网关只返回响应头后无限挂起。
      const result = await response.json().catch((error) => {
        if (controller.signal.aborted) throw error;
        return null;
      });

      if (!response.ok) {
        const message = result?.message || result?.error?.message || "AI 网关请求失败";
        throw new Error(message);
      }

      const text = normalizeModelText(result);
      if (!text) {
        throw new Error("模型返回内容为空");
      }

      return text;
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("AI 请求失败");
}

function fallbackOutline(topic) {
  return [
    `一、${topic}概述`,
    "二、目标用户与使用场景",
    "三、核心功能模块",
    "四、本地开发与平台接入规划",
    "五、后续迭代计划"
  ];
}

const templateAgentIntentRules = [
  { input: /会议|例会|评审会|纪要|议题/, template: /会议纪要/ },
  { input: /周报|本周|下周/, template: /周报/ },
  { input: /述职|晋升|转正/, template: /述职/ },
  { input: /竞品/, template: /竞品/ },
  { input: /市场调研|用户调研/, template: /市场调研/ },
  { input: /立项|可行性|预算审批/, template: /立项/ },
  { input: /商业计划|融资|商业模式/, template: /商业计划/ },
  { input: /培训|课程/, template: /培训/ },
  { input: /活动|发布会/, template: /活动/ },
  { input: /合同|协议|甲方|乙方|违约/, template: /合同/ },
  { input: /开题|课题/, template: /开题/ },
  { input: /论文|研究报告/, template: /论文/ },
  { input: /计划|规划|里程碑/, template: /工作计划|立项|商业计划/ },
  { input: /总结|复盘|成果/, template: /工作总结|述职/ }
];

function cleanTemplateAgentText(value, maximum = 500) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maximum);
}

function normalizeTemplateAgentCandidates(value) {
  const candidates = Array.isArray(value) ? value : [];
  return candidates.slice(0, 50).map((item, index) => ({
    id: Number.isSafeInteger(Number(item?.id)) && Number(item.id) > 0 ? Number(item.id) : null,
    name: cleanTemplateAgentText(item?.name, 120) || `模板 ${index + 1}`,
    category: cleanTemplateAgentText(item?.category, 60),
    documentType: cleanTemplateAgentText(item?.documentType, 50) || "工作总结",
    topic: cleanTemplateAgentText(item?.topic, 255),
    requirement: cleanTemplateAgentText(item?.requirement, 800),
    outline: (Array.isArray(item?.outline) ? item.outline : [])
      .map((outlineItem) => cleanTemplateAgentText(outlineItem, 120))
      .filter(Boolean)
      .slice(0, 10)
  })).filter((item) => item.name);
}

async function loadTemplateAgentCandidates(clientValue, candidatePool = dbPool) {
  if (!candidatePool) return normalizeTemplateAgentCandidates(clientValue);
  const [rows] = await candidatePool.query(
    `SELECT id, name, category, document_type, topic, requirement, outline_json
     FROM document_templates
     WHERE status = 'active'
     ORDER BY sort_order ASC, id ASC
     LIMIT 100`
  );
  // 中文注解：商业环境以 MySQL 启用模板为唯一白名单，客户端候选仅用于没有数据库的本地开发模式。
  return normalizeTemplateAgentCandidates(rows.map((row) => ({
    id: row.id,
    name: row.name,
    category: row.category,
    documentType: row.document_type,
    topic: row.topic,
    requirement: row.requirement,
    outline: parseJson(row.outline_json, [])
  })));
}

function resolveTemplateAgentFailureStatus(error, currentUser, pointHold) {
  if (Number.isInteger(error?.httpStatus)) return error.httpStatus;
  // 中文注解：只有平台明确返回余额不足业务码时才响应 402，网络或配置故障不能伪装成余额不足。
  if (error?.code === 60005) return 402;
  return 503;
}

function resolveBillableFailureResponse(error, currentUser, pointHold, actionLabel = "计费操作") {
  if (!currentUser?.isMolingUser && !requireMolingSession) return null;
  const status = resolveTemplateAgentFailureStatus(error, currentUser, pointHold);
  const fallbackMessage = pointHold?.state === "settlement_unknown"
    ? `${actionLabel}已完成，但积分结算状态待平台对账，请勿重复提交并联系管理员。`
    : pointHold?.state === "release_unknown"
      ? `${actionLabel}失败，积分预占释放状态待平台对账，请勿重复提交并联系管理员。`
      : `${actionLabel}暂时不可用，本次未扣除积分，请稍后重试。`;
  // 中文注解：待对账状态必须使用确定文案，不能再被底层 fetch/timeout 的普通错误模式覆盖而诱导用户重试。
  const message = ["settlement_unknown", "release_unknown"].includes(pointHold?.state)
    ? fallbackMessage
    : toPublicErrorMessage(error, fallbackMessage);
  return { status, message };
}

function sendBillableActionError(response, error, currentUser, pointHold, actionLabel) {
  const failure = resolveBillableFailureResponse(error, currentUser, pointHold, actionLabel);
  if (!failure) return false;
  console.error(error);
  response.status(failure.status).json({ message: failure.message });
  return true;
}

function scoreTemplateAgentCandidate(brief, candidate) {
  const input = cleanTemplateAgentText(brief, 1200).toLowerCase();
  const searchable = `${candidate.name} ${candidate.category} ${candidate.documentType} ${candidate.topic} ${candidate.requirement}`.toLowerCase();
  let score = input.includes(candidate.name.toLowerCase()) ? 240 : 0;
  if (candidate.topic && input.includes(candidate.topic.toLowerCase())) score += 180;
  for (const rule of templateAgentIntentRules) {
    if (rule.input.test(input) && rule.template.test(searchable)) score += 120;
  }
  // 中文注解：短关键词只用于同分排序，核心意图仍由上面的业务规则决定，避免“项目”等通用词误导推荐。
  for (const token of input.split(/[，。；、,.!！?？：:\s]+/).filter((item) => item.length >= 2)) {
    if (searchable.includes(token)) score += Math.min(token.length * 2, 16);
  }
  return score;
}

function templateAgentQualityChecklist(documentType) {
  if (documentType === "会议纪要") {
    return ["会议时间、地点、参会人与议题信息完整", "每项会议决议表述明确且可追溯", "行动项均包含责任人和完成期限", "未决问题、依赖项和升级路径已标明"];
  }
  if (documentType === "合同协议") {
    return ["合同主体、服务范围和交付边界明确", "验收标准、付款条件和发票要求一致", "知识产权、保密和数据责任可执行", "违约、变更终止与争议解决条款完整"];
  }
  if (documentType === "商业计划书") {
    return ["关键结论有数据或事实依据", "目标、范围、预算和收益口径一致", "里程碑包含负责人和验收标准", "主要风险均给出触发条件和应对措施"];
  }
  if (documentType === "论文材料") {
    return ["研究问题、方法和结论前后一致", "关键论断标注可靠来源或参考文献", "数据、图表和引用格式统一", "创新点、局限性和后续研究边界清晰"];
  }
  return ["文档目标、适用对象和范围说明清晰", "关键结论有事实或数据支撑", "任务、负责人、时间节点和验收标准可执行", "敏感信息、风险提示和发布范围已复核"];
}

function validExpectedPages(value) {
  const text = cleanTemplateAgentText(value, 20).replace(/\s+/g, "");
  const matched = text.match(/^(\d{1,2})-(\d{1,2})页$/);
  if (!matched) return "";
  const minimum = Number(matched[1]);
  const maximum = Number(matched[2]);
  return minimum >= 1 && maximum >= minimum && maximum <= 30 ? `${minimum}-${maximum}页` : "";
}

function buildTemplateAgentWorkflow(plan, brief, stages = {}) {
  const stage = (code, fallbackSummary) => ({
    code,
    name: ({ brief_analyzer: "需求分析", template_matcher: "模板匹配", structure_architect: "结构设计", quality_reviewer: "质量审校" })[code],
    status: stages[code]?.status === "completed" ? "completed" : "fallback",
    summary: cleanTemplateAgentText(stages[code]?.summary, 240) || fallbackSummary
  });
  return [
    stage("brief_analyzer", `本地规则已识别${cleanTemplateAgentText(plan.audience, 60)}的${cleanTemplateAgentText(brief, 80)}`),
    stage("template_matcher", `本地规则推荐“${plan.recommendedTemplateName}”，综合匹配度 ${plan.fitScore}%`),
    stage("structure_architect", `已复用模板的 ${plan.outline.length} 个正式章节，建议篇幅 ${plan.expectedPages}`),
    stage("quality_reviewer", `已采用 ${plan.qualityChecklist.length} 项内置交付质量门禁`)
  ];
}

function createTemplateAgentFallbackPlan(input = {}, candidateValue = []) {
  const candidates = normalizeTemplateAgentCandidates(candidateValue);
  if (!candidates.length) throw createPublicError("当前没有可用模板，请先初始化模板库。", 400);
  const brief = cleanTemplateAgentText(input.brief, 1200);
  if (brief.length < 8) throw createPublicError("请至少输入 8 个字，说明文档用途和交付要求。", 400);
  const ranked = candidates
    .map((candidate, index) => ({ candidate, index, score: scoreTemplateAgentCandidate(brief, candidate) }))
    .sort((left, right) => right.score - left.score || left.index - right.index);
  const recommended = ranked[0].candidate;
  const audience = cleanTemplateAgentText(input.audience, 120) || "文档相关决策者与执行人员";
  const expectedPages = validExpectedPages(input.expectedPages) || (recommended.outline.length >= 6 ? "6-10页" : "3-6页");
  const outline = recommended.outline.length >= 4 ? recommended.outline : fallbackOutline(recommended.topic || recommended.name).slice(0, 6);
  const intentMatched = ranked[0].score >= 120;
  const plan = {
    recommendedTemplateId: recommended.id,
    recommendedTemplateName: recommended.name,
    title: recommended.topic || `${recommended.name}（正式版）`,
    documentType: recommended.documentType,
    tone: "正式",
    requirement: [recommended.requirement, `交付对象：${audience}。`, `用户需求：${brief}`].filter(Boolean).join(" ").slice(0, 1200),
    audience,
    expectedPages,
    fitScore: intentMatched ? Math.min(98, 82 + Math.floor(Math.min(ranked[0].score - 120, 80) / 10)) : 72,
    reason: `“${recommended.name}”与当前文档用途、交付对象和章节要求最接近，可直接复用其正式结构并继续生成正文。`,
    outline,
    qualityChecklist: templateAgentQualityChecklist(recommended.documentType)
  };
  return { ...plan, workflow: buildTemplateAgentWorkflow(plan, brief) };
}

function extractJsonObject(text) {
  const source = String(text || "").replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const value = JSON.parse(source.slice(start, end + 1));
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function normalizeTemplateAgentPlan(modelText, fallback, candidateValue = []) {
  const candidates = normalizeTemplateAgentCandidates(candidateValue);
  const source = typeof modelText === "string" ? extractJsonObject(modelText) : modelText;
  if (!source || typeof source !== "object") return fallback;
  const matched = candidates.find((item) => item.id && Number(source.recommendedTemplateId) === item.id)
    || candidates.find((item) => item.name === cleanTemplateAgentText(source.recommendedTemplateName, 120))
    || candidates.find((item) => item.id === fallback.recommendedTemplateId)
    || candidates.find((item) => item.name === fallback.recommendedTemplateName);
  if (!matched) return fallback;
  const outline = (Array.isArray(source.outline) ? source.outline : [])
    .map((item) => cleanTemplateAgentText(typeof item === "string" ? item : item?.title, 120))
    .filter(Boolean)
    .slice(0, 10);
  const qualityChecklist = (Array.isArray(source.qualityChecklist) ? source.qualityChecklist : [])
    .map((item) => cleanTemplateAgentText(item, 160))
    .filter(Boolean)
    .slice(0, 8);
  const fitScore = Number(source.fitScore);
  const plan = {
    recommendedTemplateId: matched.id,
    recommendedTemplateName: matched.name,
    title: cleanTemplateAgentText(source.title, 120) || fallback.title,
    documentType: matched.documentType,
    tone: ["正式", "商务", "学术", "简洁"].includes(source.tone) ? source.tone : fallback.tone,
    requirement: cleanTemplateAgentText(source.requirement, 1200) || fallback.requirement,
    audience: cleanTemplateAgentText(source.audience, 120) || fallback.audience,
    expectedPages: validExpectedPages(source.expectedPages) || fallback.expectedPages,
    fitScore: Number.isFinite(fitScore) ? Math.min(100, Math.max(0, Math.round(fitScore))) : fallback.fitScore,
    reason: cleanTemplateAgentText(source.reason, 500) || fallback.reason,
    outline: outline.length >= 4 ? outline : fallback.outline,
    qualityChecklist: qualityChecklist.length >= 4 ? qualityChecklist : fallback.qualityChecklist
  };
  return { ...plan, workflow: buildTemplateAgentWorkflow(plan, fallback.requirement) };
}

function normalizeTemplateBriefAnalysis(modelText, input = {}) {
  const source = extractJsonObject(modelText);
  if (!source) return null;
  const priorities = (Array.isArray(source.priorities) ? source.priorities : [])
    .map((item) => cleanTemplateAgentText(item, 120))
    .filter(Boolean)
    .slice(0, 8);
  const constraints = (Array.isArray(source.constraints) ? source.constraints : [])
    .map((item) => cleanTemplateAgentText(item, 120))
    .filter(Boolean)
    .slice(0, 8);
  const intent = cleanTemplateAgentText(source.intent, 160);
  if (!intent || priorities.length < 2) return null;
  return {
    intent,
    audience: cleanTemplateAgentText(source.audience, 120) || cleanTemplateAgentText(input.audience, 120) || "文档相关决策者与执行人员",
    priorities,
    constraints,
    summary: cleanTemplateAgentText(source.summary, 240) || `已识别“${intent}”及 ${priorities.length} 项关键要求`
  };
}

function normalizeTemplateAgentReview(modelText, plan) {
  const source = extractJsonObject(modelText);
  if (!source) return null;
  const qualityChecklist = (Array.isArray(source.qualityChecklist) ? source.qualityChecklist : [])
    .map((item) => cleanTemplateAgentText(item, 160))
    .filter(Boolean)
    .slice(0, 8);
  const issues = (Array.isArray(source.issues) ? source.issues : [])
    .map((item) => cleanTemplateAgentText(item, 180))
    .filter(Boolean)
    .slice(0, 6);
  if (qualityChecklist.length < 4) return null;
  const approved = source.approved === true && issues.length === 0;
  return {
    approved,
    issues,
    qualityChecklist,
    summary: cleanTemplateAgentText(source.summary, 240) || (approved ? `质量门禁通过，共 ${qualityChecklist.length} 项检查` : `发现 ${issues.length} 项结构问题`),
    plan: { ...plan, qualityChecklist }
  };
}

app.get("/api/health", (_request, response) => {
  response.json({
    ok: true,
    gatewayConfigured: hasGatewayConfig(),
    appName: process.env.APP_NAME || "moling_word",
    environment: appEnvironment,
    maximumConcurrentAiRequests,
    sessionRequired: requireMolingSession,
    databaseConfigured: Boolean(dbPool),
    storageConfigured: Boolean(minioClient)
  });
});

async function boundedReadinessCheck(check) {
  try {
    const result = await Promise.race([
      Promise.resolve().then(check),
      new Promise((_, reject) => setTimeout(() => reject(new Error("readiness timeout")), readinessTimeoutMs))
    ]);
    return Boolean(result);
  } catch {
    return false;
  }
}

async function consumeResponseBodyWithinLimit(response, maximumBytes) {
  if (!response.body) return true;
  const reader = response.body.getReader();
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return true;
      totalBytes += value?.byteLength || 0;
      if (totalBytes > maximumBytes) {
        await reader.cancel("readiness response too large");
        return false;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

async function checkGatewayReadiness() {
  if (!hasGatewayConfig()) return false;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), readinessTimeoutMs);
  try {
    // 中文注解：使用 OpenAI 兼容 models 接口验证网络与凭据，不产生模型用量；只接受成功响应，避免 405 假阳性。
    const response = await fetch(llmReadinessUrl, {
      method: "GET",
      headers: { Authorization: `Bearer ${llmApiKey}` },
      signal: controller.signal
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return false;
    }
    // 中文注解：完整消费并限制就绪响应体，挂起或异常超大的网关响应都必须失败并释放连接。
    return await consumeResponseBodyWithinLimit(response, 1024 * 1024);
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

app.get("/api/ready", async (_request, response) => {
  const [databaseReady, storageReady, gatewayReady] = await Promise.all([
    dbPool ? boundedReadinessCheck(async () => {
      await dbPool.query("SELECT 1");
      return true;
    }) : false,
    minioClient ? boundedReadinessCheck(() => minioClient.bucketExists(storageBucket)) : false,
    boundedReadinessCheck(checkGatewayReadiness)
  ]);
  const checks = {
    configuration: validateProductionConfiguration(process.env).length === 0,
    database: databaseReady,
    storage: storageReady,
    gateway: gatewayReady
  };
  const ready = Object.values(checks).every(Boolean);
  response.status(ready ? 200 : 503).json({ ready, checks });
});

app.post("/api/molin/launch", async (request, response) => {
  const { ticket } = request.body || {};

  if (!ticket && !localMolingMock) {
    response.status(400).json({ message: "请从墨灵平台重新进入应用。" });
    return;
  }

  try {
    const launchData = localMolingMock
      ? { user_id: localUserId, app_id: molingAppId, product_id: molingProductId }
      : await verifyMolingLaunchTicket(ticket);
    const userId = normalizeMolingId(launchData.user_id);
    const appId = normalizeMolingId(launchData.app_id || molingAppId);
    const productId = normalizeMolingId(launchData.product_id || molingProductId);

    if (molingAppId && appId && appId !== normalizeMolingId(molingAppId)) {
      response.status(403).json({ message: "墨灵入口信息与当前应用不匹配，请检查应用 ID。" });
      return;
    }

    if (molingProductId && productId && productId !== normalizeMolingId(molingProductId)) {
      response.status(403).json({ message: "墨灵入口信息与当前商品不匹配，请检查商品 ID。" });
      return;
    }

    const session = await createLocalSession({ userId, appId, productId });
    setSessionCookie(response, session.token);

    const user = { userId, appId, productId, isMolingUser: true, expiresAt: session.expiresAt };
    const points = await getPointsSummary(user).catch((error) => ({ enabled: true, error: toPublicErrorMessage(error, "积分读取失败，请稍后刷新。"), entitlements: [], remaining: null }));
    response.json({ user: serializeUserContext(user), points });
  } catch (error) {
    sendError(response, error, 401, "墨灵登录校验失败，请从墨灵平台重新进入。");
  }
});

app.get("/api/session", async (request, response) => {
  try {
    const user = await getCurrentUser(request);
    const points = await getPointsSummary(user).catch((error) => ({ enabled: user.isMolingUser, error: toPublicErrorMessage(error, "积分读取失败，请稍后刷新。"), entitlements: [], remaining: null }));
    response.json({ user: serializeUserContext(user), points });
  } catch (error) {
    sendError(response, error, 500, "读取登录状态失败，请刷新页面重试。");
  }
});

app.post("/api/logout", async (request, response) => {
  try {
    const token = parseCookies(request)[sessionCookieName];
    if (token && dbPool) {
      await dbPool.query("DELETE FROM molin_user_sessions WHERE session_token_hash = ?", [hashSessionToken(token)]);
    }

    clearSessionCookie(response);
    response.json({ ok: true });
  } catch (error) {
    sendError(response, error, 500, "退出登录失败，请稍后重试。");
  }
});

app.get("/api/billing/points", async (request, response) => {
  try {
    const user = await getCurrentUser(request);
    response.json({ points: await getPointsSummary(user) });
  } catch (error) {
    sendError(response, error, 500, "积分读取失败，请稍后刷新。");
  }
});

app.get("/api/templates", async (request, response) => {
  try {
    const pool = await ensureDb();
    const [rows] = await pool.query(
      `SELECT id, name, category, document_type, topic, requirement, outline_json,
        content, is_system, status, sort_order, created_at, updated_at
       FROM document_templates
       WHERE status = 'active'
       ORDER BY sort_order ASC, id ASC`
    );
    const assetsByTemplate = await findTemplateAssets(pool, rows.map((row) => row.id));

    // 中文注解：模板接口只暴露启用模板，停用模板留给后续管理后台维护。
    response.json({ templates: rows.map((row) => toTemplate(row, assetsByTemplate.get(row.id) || [])) });
  } catch (error) {
    sendError(response, error, 500, "读取模板库失败，请稍后重试。");
  }
});

app.get("/api/templates/:id", async (request, response) => {
  try {
    const pool = await ensureDb();
    const [[row]] = await pool.query(
      `SELECT id, name, category, document_type, topic, requirement, outline_json,
        content, is_system, status, sort_order, created_at, updated_at
       FROM document_templates
       WHERE id = ? AND status = 'active'`,
      [request.params.id]
    );

    if (!row) {
      response.status(404).json({ message: "模板不存在或已停用。" });
      return;
    }

    const assetsByTemplate = await findTemplateAssets(pool, [row.id]);
    response.json({ template: toTemplate(row, assetsByTemplate.get(row.id) || []) });
  } catch (error) {
    sendError(response, error, 500, "读取模板详情失败，请稍后重试。");
  }
});

app.get("/api/templates/:id/cover", async (request, response) => {
  try {
    const pool = await ensureDb();
    const storage = await ensureStorage();
    const [[fileRow]] = await pool.query(
      `SELECT f.bucket, f.object_key, f.mime_type, f.file_size
       FROM files f
       INNER JOIN document_templates t ON t.id = f.template_id
       WHERE f.template_id = ? AND f.purpose = 'template_cover' AND t.status = 'active'
       ORDER BY f.id DESC
       LIMIT 1`,
      [request.params.id]
    );

    if (!fileRow) {
      response.status(404).json({ message: "模板封面不存在。" });
      return;
    }

    const objectStream = await storage.getObject(fileRow.bucket, fileRow.object_key);
    response.setHeader("Content-Type", fileRow.mime_type || "application/octet-stream");
    if (fileRow.file_size) response.setHeader("Content-Length", String(fileRow.file_size));
    response.setHeader("Cache-Control", "private, max-age=300");
    objectStream.pipe(response);
  } catch (error) {
    sendError(response, error, 500, "模板封面读取失败，请稍后重试。");
  }
});

app.get("/api/templates/:templateId/assets/:fileId/download", async (request, response) => {
  try {
    const pool = await ensureDb();
    const storage = await ensureStorage();
    const [[fileRow]] = await pool.query(
      `SELECT f.original_name, f.bucket, f.object_key, f.mime_type, f.file_size
       FROM files f
       INNER JOIN document_templates t ON t.id = f.template_id
       WHERE f.id = ? AND f.template_id = ? AND f.purpose IN ('template_style', 'template_asset') AND t.status = 'active'`,
      [request.params.fileId, request.params.templateId]
    );

    if (!fileRow) {
      response.status(404).json({ message: "模板素材不存在。" });
      return;
    }

    const objectStream = await storage.getObject(fileRow.bucket, fileRow.object_key);
    response.setHeader("Content-Type", fileRow.mime_type || "application/octet-stream");
    if (fileRow.file_size) response.setHeader("Content-Length", String(fileRow.file_size));
    response.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(fileRow.original_name)}`);
    objectStream.pipe(response);
  } catch (error) {
    sendError(response, error, 500, "模板素材下载失败，请稍后重试。");
  }
});

app.get("/api/documents", async (request, response) => {
  try {
    const pool = await ensureDb();
    const currentUser = await getCurrentUser(request);
    const [rows] = await pool.query(
      `SELECT id, user_id, title, document_type, tone, template_id, outline_json, content, page_layout_json, status,
        word_count, last_opened_at, created_at, updated_at
       FROM documents
       WHERE user_id = ? AND status <> 'deleted'
       ORDER BY updated_at DESC
       LIMIT 50`,
      [currentUser.userId]
    );

    response.json({ documents: rows.map(toDocument) });
  } catch (error) {
    sendError(response, error, 500, "读取最近文档失败，请稍后重试。");
  }
});

app.post("/api/documents/import", authenticateDocumentImport, receiveImportedDocument, async (request, response) => {
  try {
    if (!request.file) throw createPublicError("请选择需要导入的文档。", 400);

    const pool = await ensureDb();
    const currentUser = request.importUser;
    let imported = await parseImportedDocument(request.file);
    const initialImported = stripTransientPageImages(imported);
    const title = request.file.originalname.replace(/\.(docx?|pdf)$/i, "").trim() || "导入文档";
    const [result] = await pool.query(
      `INSERT INTO documents
        (user_id, title, document_type, tone, outline_json, content, page_layout_json, status, word_count, last_opened_at)
       VALUES (?, ?, ?, '正式', ?, ?, ?, 'draft', ?, NOW())`,
      [currentUser.userId, title, imported.documentType, jsonString(imported.outline), initialImported.content, jsonString(initialImported.pageLayout), countWords(initialImported.content)]
    );

    if (pageLayoutImageSources(imported.sectionLayouts || [imported.pageLayout]).some((src) => src.startsWith("data:"))) {
      if (minioClient) {
        try {
          imported = await persistImportedPageImages(pool, await ensureStorage(), currentUser.userId, result.insertId, imported);
          await pool.query(
            "UPDATE documents SET content = ?, page_layout_json = ?, word_count = ? WHERE id = ? AND user_id = ?",
            [imported.content, jsonString(imported.pageLayout), countWords(imported.content), result.insertId, currentUser.userId]
          );
        } catch (storageError) {
          console.error("Imported page image storage failed", storageError);
          imported = stripTransientPageImages(imported);
          await pool.query(
            "UPDATE documents SET content = ?, page_layout_json = ?, word_count = ? WHERE id = ? AND user_id = ?",
            [imported.content, jsonString(imported.pageLayout), countWords(imported.content), result.insertId, currentUser.userId]
          );
          imported.warnings = [...(imported.warnings || []), "页眉页脚图片归档失败，本次导入已保留文字，请检查文件存储服务后重新导入。"];
        }
      } else {
        imported = stripTransientPageImages(imported);
        await pool.query(
          "UPDATE documents SET content = ?, page_layout_json = ?, word_count = ? WHERE id = ? AND user_id = ?",
          [imported.content, jsonString(imported.pageLayout), countWords(imported.content), result.insertId, currentUser.userId]
        );
        imported.warnings = [...(imported.warnings || []), "未配置文件存储服务，页眉页脚图片未入库；请配置后重新导入。"];
      }
    }

    let sourceStored = false;
    if (minioClient) {
      try {
        const extension = request.file.originalname.toLowerCase().split(".").pop();
        const objectKey = `documents/${result.insertId}/sources/${crypto.randomUUID()}.${extension}`;
        await minioClient.putObject(storageBucket, objectKey, request.file.buffer, request.file.size, {
          "Content-Type": request.file.mimetype || "application/octet-stream"
        });
        try {
          await pool.query(
            `INSERT INTO files
              (user_id, document_id, original_name, file_name, file_type, mime_type, file_size, bucket, object_key, purpose)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'upload')`,
            [currentUser.userId, result.insertId, request.file.originalname, request.file.originalname, extension, request.file.mimetype, request.file.size, storageBucket, objectKey]
          );
        } catch (indexError) {
          // 中文注解：索引失败时删除刚上传的对象，避免 MinIO 中遗留无法追踪的孤立文件。
          await minioClient.removeObject(storageBucket, objectKey).catch(() => undefined);
          throw indexError;
        }
        sourceStored = true;
      } catch (storageError) {
        // 中文注解：原文件归档失败不回滚已解析正文，用户仍可继续编辑，服务端日志保留失败原因。
        console.error("Imported source file storage failed", storageError);
      }
    }

    const [[row]] = await pool.query("SELECT * FROM documents WHERE id = ? AND user_id = ?", [result.insertId, currentUser.userId]);
    response.status(201).json({ document: toDocument(row), sourceStored, warnings: imported.warnings || [] });
  } catch (error) {
    sendError(response, error, error?.httpStatus || 500, "文档导入失败，请检查文件格式后重试。");
  }
});

app.post("/api/documents/:id/images", authenticateDocumentImport, receivePageImage, async (request, response) => {
  try {
    if (!request.file || !supportedPageImageMimeTypes.has(request.file.mimetype)) throw createPublicError("请选择 PNG、JPEG、GIF 或 WebP 图片。", 400);
    const dimensions = readSafeImageDimensions(request.file.buffer, request.file.mimetype);
    if (!dimensions) throw createPublicError("图片内容无效、尺寸过大或与文件类型不匹配。", 400);
    const pool = await ensureDb();
    const storage = await ensureStorage();
    const currentUser = request.importUser;
    const [[documentRow]] = await pool.query(
      "SELECT id FROM documents WHERE id = ? AND user_id = ? AND status <> 'deleted'",
      [request.params.id, currentUser.userId]
    );
    if (!documentRow) throw createPublicError("文档不存在或已被删除。", 404);
    const extension = pageImageExtension(request.file.mimetype);
    const fileName = `${safeFileName(request.file.originalname.replace(/\.[^.]+$/, "")) || "page-image"}.${extension}`;
    const objectKey = `documents/${documentRow.id}/images/${crypto.randomUUID()}.${extension}`;
    await storage.putObject(storageBucket, objectKey, request.file.buffer, request.file.size, { "Content-Type": request.file.mimetype });
    let result;
    try {
      [result] = await pool.query(
        `INSERT INTO files
          (user_id, document_id, original_name, file_name, file_type, mime_type, file_size, bucket, object_key, purpose)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'image')`,
        [currentUser.userId, documentRow.id, request.file.originalname, fileName, extension, request.file.mimetype, request.file.size, storageBucket, objectKey]
      );
    } catch (error) {
      await storage.removeObject(storageBucket, objectKey).catch(() => undefined);
      throw error;
    }
    response.status(201).json({
      image: {
        id: `file-${result.insertId}`,
        fileId: result.insertId,
        src: `/api/files/${result.insertId}/content`,
        alt: request.file.originalname.slice(0, 200),
        widthPx: Number(dimensions.width) || 120,
        heightPx: Number(dimensions.height) || 60,
        paragraphIndex: 0,
        placement: "afterText",
        alignment: "center"
      }
    });
  } catch (error) {
    sendError(response, error, error?.httpStatus || 500, "页面图片上传失败，请稍后重试。");
  }
});

app.post("/api/documents", async (request, response) => {
  const { title, documentType, tone, templateId, outline, content, pageLayout } = request.body;

  try {
    const pool = await ensureDb();
    const currentUser = await getCurrentUser(request);
    const normalizedTemplateId = await normalizeActiveTemplateId(pool, templateId);
    const [result] = await pool.query(
      `INSERT INTO documents
        (user_id, title, document_type, tone, template_id, outline_json, content, page_layout_json, status, word_count, last_opened_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, NOW())`,
      [
        currentUser.userId,
        title || "未命名文档",
        documentType || "Word 文档",
        tone || "正式",
        normalizedTemplateId,
        jsonString(outline || []),
        content || "",
        jsonString(normalizePageLayout(pageLayout)),
        countWords(content || "")
      ]
    );

    const documentId = result.insertId;
    const [[row]] = await pool.query("SELECT * FROM documents WHERE id = ? AND user_id = ?", [documentId, currentUser.userId]);
    response.status(201).json({ document: toDocument(row) });
  } catch (error) {
    sendError(response, error, error?.httpStatus || 500, "创建文档失败，请稍后重试。");
  }
});

app.get("/api/documents/:id", async (request, response) => {
  try {
    const pool = await ensureDb();
    const currentUser = await getCurrentUser(request);
    const [[row]] = await pool.query(
      "SELECT * FROM documents WHERE id = ? AND user_id = ? AND status <> 'deleted'",
      [request.params.id, currentUser.userId]
    );

    if (!row) {
      response.status(404).json({ message: "文档不存在或已被删除。" });
      return;
    }

    await pool.query("UPDATE documents SET last_opened_at = NOW() WHERE id = ? AND user_id = ?", [request.params.id, currentUser.userId]);
    response.json({ document: toDocument(row) });
  } catch (error) {
    sendError(response, error, 500, "读取文档失败，请稍后重试。");
  }
});

app.patch("/api/documents/:id", async (request, response) => {
  const { title, documentType, tone, templateId, outline, content, pageLayout, status, saveVersion, versionNote } = request.body;

  let connection;
  try {
    const pool = await ensureDb();
    const currentUser = await getCurrentUser(request);
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [[current]] = await connection.query(
      "SELECT * FROM documents WHERE id = ? AND user_id = ? AND status <> 'deleted' FOR UPDATE",
      [request.params.id, currentUser.userId]
    );

    if (!current) {
      await connection.rollback();
      response.status(404).json({ message: "文档不存在或已被删除。" });
      return;
    }

    const nextOutline = outline ?? parseJson(current.outline_json, []);
    const nextContent = content ?? current.content ?? "";
    const currentPageLayout = normalizePageLayout(parseJson(current.page_layout_json, defaultPageLayout));
    const nextPageLayout = pageLayout === undefined ? currentPageLayout : normalizePageLayout(pageLayout, currentPageLayout);
    // 中文注解：未传 templateId 时保留原绑定，显式传 null 时恢复默认版式。
    const nextTemplateId = templateId === undefined
      ? current.template_id
      : await normalizeActiveTemplateId(connection, templateId);

    await connection.query(
      `UPDATE documents
       SET title = ?, document_type = ?, tone = ?, template_id = ?, outline_json = ?, content = ?,
         page_layout_json = ?, status = ?, word_count = ?, updated_at = NOW()
       WHERE id = ? AND user_id = ?`,
      [
        title ?? current.title,
        documentType ?? current.document_type,
        tone ?? current.tone,
        nextTemplateId,
        jsonString(nextOutline),
        nextContent,
        jsonString(nextPageLayout),
        status ?? current.status,
        countWords(nextContent),
        request.params.id,
        currentUser.userId
      ]
    );

    if (saveVersion) {
      await createDocumentVersion(connection, request.params.id, nextOutline, nextContent, nextPageLayout, versionNote || "手动保存");
    }

    const [[row]] = await connection.query("SELECT * FROM documents WHERE id = ? AND user_id = ?", [request.params.id, currentUser.userId]);
    await connection.commit();
    response.json({ document: toDocument(row) });
  } catch (error) {
    if (connection) await connection.rollback();
    sendError(response, error, error?.httpStatus || 500, "保存文档失败，请稍后重试。");
  } finally {
    if (connection) connection.release();
  }
});

app.delete("/api/documents/:id", async (request, response) => {
  try {
    const pool = await ensureDb();
    const currentUser = await getCurrentUser(request);
    const [result] = await pool.query(
      "UPDATE documents SET status = 'deleted', updated_at = NOW() WHERE id = ? AND user_id = ?",
      [request.params.id, currentUser.userId]
    );

    response.json({ deleted: result.affectedRows > 0 });
  } catch (error) {
    sendError(response, error, 500, "删除文档失败，请稍后重试。");
  }
});

app.post("/api/documents/:id/duplicate", async (request, response) => {
  try {
    const pool = await ensureDb();
    const currentUser = await getCurrentUser(request);
    const [[source]] = await pool.query(
      "SELECT * FROM documents WHERE id = ? AND user_id = ? AND status <> 'deleted'",
      [request.params.id, currentUser.userId]
    );

    if (!source) {
      response.status(404).json({ message: "文档不存在或已被删除。" });
      return;
    }

    const [result] = await pool.query(
      `INSERT INTO documents
        (user_id, title, document_type, tone, template_id, outline_json, content, page_layout_json, status, word_count, last_opened_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, NOW())`,
      [
        currentUser.userId,
        `${source.title} 副本`,
        source.document_type,
        source.tone,
        source.template_id,
        // 中文注解：MySQL JSON 可能已经被解析成对象，复制前统一重新序列化。
        jsonString(parseJson(source.outline_json, [])),
        source.content,
        jsonString(normalizePageLayout(parseJson(source.page_layout_json, defaultPageLayout))),
        source.word_count
      ]
    );

    const [[row]] = await pool.query("SELECT * FROM documents WHERE id = ? AND user_id = ?", [result.insertId, currentUser.userId]);
    response.status(201).json({ document: toDocument(row) });
  } catch (error) {
    sendError(response, error, 500, "复制文档失败，请稍后重试。");
  }
});

app.post("/api/documents/:id/export-docx", async (request, response) => {
  const { content } = request.body;
  let currentUser = { userId: localUserId, appId: normalizeMolingId(molingAppId), productId: normalizeMolingId(molingProductId), isMolingUser: false };
  let pointHold = null;

  try {
    // 中文注解：计费导出先验登录，再连接数据库和存储；未登录必须稳定返回 401，不能被下游故障掩盖。
    currentUser = await getCurrentUser(request);
    const pool = await ensureDb();
    const storage = await ensureStorage();
    const [[documentRow]] = await pool.query(
      "SELECT * FROM documents WHERE id = ? AND user_id = ? AND status <> 'deleted'",
      [request.params.id, currentUser.userId]
    );

    if (!documentRow) {
      response.status(404).json({ message: "文档不存在" });
      return;
    }

    // 中文注解：Word 导出先预占 1 积分；文件真正写入成功后再结算，失败则释放预占。
    pointHold = await reservePoints(currentUser, "word_export_docx", 1, request.params.id);
    const exportContent = typeof content === "string" ? content : documentRow.content || "";
    // 中文注解：导出只读取文档已保存的模板绑定，防止浏览器状态与服务端版式不一致。
    const templateStyle = await readTemplateStyle(pool, storage, documentRow.template_id);
    const pageLayout = normalizePageLayout(parseJson(documentRow.page_layout_json, defaultPageLayout));
    const hydrated = await hydratePageImagesForExport(pool, storage, currentUser.userId, pageLayout, exportContent);
    const buffer = await createDocxBuffer({ title: documentRow.title, content: hydrated.content, templateStyle, pageLayout: hydrated.pageLayout });
    const exportedAt = new Date();
    const baseName = safeFileName(documentRow.title);
    const fileName = `${baseName}-${exportedAt.getTime()}.docx`;
    const objectKey = `documents/${documentRow.id}/exports/${fileName}`;
    const mimeType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

    await storage.putObject(storageBucket, objectKey, buffer, buffer.length, {
      "Content-Type": mimeType
    });

    const [result] = await pool.query(
      `INSERT INTO files
        (user_id, document_id, original_name, file_name, file_type, mime_type, file_size, bucket, object_key, purpose)
       VALUES (?, ?, ?, ?, 'docx', ?, ?, ?, ?, 'export')`,
      [
        currentUser.userId,
        documentRow.id,
        `${baseName}.docx`,
        fileName,
        mimeType,
        buffer.length,
        storageBucket,
        objectKey
      ]
    );

    await settlePoints(pointHold, 1, { userId: currentUser.userId, usageType: "word_export_docx" });
    response.status(201).json({
      file: {
        id: result.insertId,
        documentId: documentRow.id,
        fileName,
        fileType: "docx",
        mimeType,
        fileSize: buffer.length,
        downloadUrl: `/api/files/${result.insertId}/download`
      }
    });
  } catch (error) {
    await releasePoints(pointHold).catch((releaseError) => console.warn("Moling point release failed:", releaseError.message));
    if (sendBillableActionError(response, error, currentUser, pointHold, "Word 导出")) return;
    sendError(response, error, error?.httpStatus || 500, "导出 Word 失败，请稍后重试。");
  }
});
app.get("/api/files/:id/download", async (request, response) => {
  try {
    const pool = await ensureDb();
    const storage = await ensureStorage();
    const currentUser = await getCurrentUser(request);
    const [[fileRow]] = await pool.query(
      "SELECT * FROM files WHERE id = ? AND user_id = ?",
      [request.params.id, currentUser.userId]
    );

    if (!fileRow) {
      response.status(404).json({ message: "文件不存在或已被删除。" });
      return;
    }

    const objectStream = await storage.getObject(fileRow.bucket, fileRow.object_key);
    response.setHeader("Content-Type", fileRow.mime_type || "application/octet-stream");
    response.setHeader("Content-Length", String(fileRow.file_size || ""));
    response.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(fileRow.original_name)}`);
    objectStream.pipe(response);
  } catch (error) {
    sendError(response, error, 500, "下载文件失败，请稍后重试。");
  }
});

app.get("/api/files/:id/content", async (request, response) => {
  try {
    const pool = await ensureDb();
    const storage = await ensureStorage();
    const currentUser = await getCurrentUser(request);
    const [[fileRow]] = await pool.query(
      "SELECT * FROM files WHERE id = ? AND user_id = ? AND purpose = 'image'",
      [request.params.id, currentUser.userId]
    );
    if (!fileRow) {
      response.status(404).json({ message: "图片不存在或已被删除。" });
      return;
    }
    const objectStream = await storage.getObject(fileRow.bucket, fileRow.object_key);
    response.setHeader("Content-Type", fileRow.mime_type || "application/octet-stream");
    if (fileRow.file_size) response.setHeader("Content-Length", String(fileRow.file_size));
    response.setHeader("Cache-Control", "private, max-age=3600");
    response.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(fileRow.original_name)}`);
    objectStream.pipe(response);
  } catch (error) {
    sendError(response, error, 500, "读取图片失败，请稍后重试。");
  }
});

app.post("/api/ai/template-agent", async (request, response) => {
  const { brief, audience, expectedPages, candidates: candidateValue } = request.body || {};
  let currentUser = { userId: localUserId, appId: normalizeMolingId(molingAppId), productId: normalizeMolingId(molingProductId), isMolingUser: false };
  try {
    // 中文注解：先验登录再读取模板白名单，避免未认证请求触发数据库查询和模型准备工作。
    currentUser = await getCurrentUser(request);
  } catch (error) {
    sendError(response, error, error?.httpStatus || 401, "请从墨灵平台进入应用后再使用文档智能体。");
    return;
  }
  let candidates = [];
  let fallback;
  try {
    candidates = await loadTemplateAgentCandidates(candidateValue);
    fallback = createTemplateAgentFallbackPlan({ brief, audience, expectedPages }, candidates);
  } catch (error) {
    sendError(response, error, error?.httpStatus || 400, "模板智能体输入无效，请补充文档用途后重试。");
    return;
  }
  const startedAt = Date.now();
  let pointHold = null;
  let pointFinalized = false;
  const requestSummary = `用户需求：${cleanTemplateAgentText(brief, 1200)}\n交付对象：${cleanTemplateAgentText(audience, 120) || "未指定"}\n期望篇幅：${validExpectedPages(expectedPages) || "由智能体判断"}`;

  try {
    pointHold = await reservePoints(currentUser, "word_template_agent", usageCosts.word_template_agent, brief || "template-agent");
    const analysisPrompt = `${requestSummary}\n请只返回 JSON：{"intent":"文档交付意图","audience":"交付对象","priorities":["关键要求"],"constraints":["约束"],"summary":"分析摘要"}。priorities 至少 2 项，不得编造数据。`;
    const analysisText = await callMolinChat([
      {
        role: "system",
        content: "你是企业文档需求分析智能体，只分析用途、对象、要求和约束，返回严格 JSON。"
      },
      { role: "user", content: analysisPrompt }
    ]);
    const analysis = normalizeTemplateBriefAnalysis(analysisText, { audience });
    if (!analysis) throw new Error("AI brief analyzer returned invalid JSON");

    // 中文注解：模板匹配是受控工具阶段，只对 MySQL active 白名单评分；模型没有权限新增或启用模板。
    const matchedFallback = createTemplateAgentFallbackPlan({
      brief: `${brief} ${analysis.intent} ${analysis.priorities.join(" ")}`,
      audience: analysis.audience,
      expectedPages
    }, candidates);
    const recommendedCandidate = candidates.find((item) => (matchedFallback.recommendedTemplateId && item.id === matchedFallback.recommendedTemplateId) || item.name === matchedFallback.recommendedTemplateName);
    if (!recommendedCandidate) throw new Error("Template matcher did not return an active template");

    const architecturePrompt = `${requestSummary}\n需求分析：${JSON.stringify(analysis)}\n已匹配启用模板：${JSON.stringify(recommendedCandidate)}\n请只返回一个 JSON 对象，字段必须为：recommendedTemplateId、recommendedTemplateName、title、tone、requirement、audience、expectedPages、fitScore、reason、outline、qualityChecklist。必须保持已匹配模板；outline 为 4-10 个正式中文章节；qualityChecklist 为 4-8 条可执行检查；expectedPages 格式为“3-6页”；不得输出 Markdown。`;
    const architectureText = await callMolinChat([
      { role: "system", content: "你是企业 Word 文档架构智能体，基于已确认模板设计正式结构，返回严格 JSON，不编造来源、数据或法律结论。" },
      { role: "user", content: architecturePrompt }
    ]);
    if (!extractJsonObject(architectureText)) throw new Error("AI structure architect returned invalid JSON");
    // 中文注解：架构模型只能补全文档结构，不能改写确定性工具阶段锁定的模板。
    let plan = normalizeTemplateAgentPlan(architectureText, matchedFallback, [recommendedCandidate]);

    const reviewPlan = async (candidatePlan) => {
      const reviewText = await callMolinChat([
        { role: "system", content: "你是企业文档质量审校智能体。检查结构完整性、可执行性、事实边界和行业风险，只返回严格 JSON。" },
        { role: "user", content: `需求分析：${JSON.stringify(analysis)}\n待审方案：${JSON.stringify(candidatePlan)}\n返回：{"approved":true或false,"issues":["必须修复的问题"],"qualityChecklist":["交付检查"],"summary":"审校摘要"}。只有无必须修复问题时 approved 才能为 true，qualityChecklist 至少 4 项。` }
      ]);
      return normalizeTemplateAgentReview(reviewText, candidatePlan);
    };

    let review = await reviewPlan(plan);
    if (!review) throw new Error("AI quality reviewer returned invalid JSON");
    let repaired = false;
    if (!review.approved) {
      repaired = true;
      const repairText = await callMolinChat([
        { role: "system", content: "你是企业 Word 文档架构修订智能体。必须逐项修复审校问题并返回完整严格 JSON。" },
        { role: "user", content: `原方案：${JSON.stringify(plan)}\n必须修复：${JSON.stringify(review.issues)}\n保持原模板不变，返回与原方案相同字段的完整 JSON。` }
      ]);
      if (!extractJsonObject(repairText)) throw new Error("AI structure repair returned invalid JSON");
      plan = normalizeTemplateAgentPlan(repairText, matchedFallback, [recommendedCandidate]);
      review = await reviewPlan(plan);
      if (!review?.approved) throw new Error("AI quality gate rejected the repaired plan");
    }
    plan = {
      ...review.plan,
      workflow: buildTemplateAgentWorkflow(review.plan, brief, {
        brief_analyzer: { status: "completed", summary: analysis.summary },
        template_matcher: { status: "completed", summary: `已从 ${candidates.length} 个启用模板中匹配“${review.plan.recommendedTemplateName}”` },
        structure_architect: { status: "completed", summary: `已设计 ${review.plan.outline.length} 个正式章节${repaired ? "并完成审校返修" : ""}` },
        quality_reviewer: { status: "completed", summary: review.summary }
      })
    };
    await settlePoints(pointHold, usageCosts.word_template_agent, { userId: currentUser.userId, usageType: "word_template_agent" });
    pointFinalized = true;
    await logAiRequest({
      requestId: request.requestId,
      userId: currentUser.userId,
      actionType: "template_agent_plan",
      prompt: requestSummary,
      responseText: JSON.stringify(plan),
      latencyMs: Date.now() - startedAt
    }).catch((logError) => console.warn("Template agent audit log failed:", logError.message));
    response.json({ plan, agentMode: "model" });
  } catch (error) {
    if (!pointFinalized) await releasePoints(pointHold).catch((releaseError) => console.warn("Moling point release failed:", releaseError.message));
    await logAiRequest({
      requestId: request.requestId,
      userId: currentUser.userId,
      actionType: "template_agent_plan",
      prompt: requestSummary,
      responseText: JSON.stringify(fallback),
      status: "failed",
      errorMessage: error instanceof Error ? error.message : "模板智能体规划失败",
      latencyMs: Date.now() - startedAt
    });
    if (sendBillableActionError(response, error, currentUser, pointHold, "模板智能体")) return;
    response.json({
      plan: fallback,
      fallback: true,
      agentMode: "local-rules",
      message: toPublicErrorMessage(error, "AI 规划服务暂时不可用，已使用本地智能匹配方案。")
    });
  }
});

app.post("/api/ai/generate-outline", async (request, response) => {
  const { topic, documentType, tone, requirement, documentId } = request.body;
  const startedAt = Date.now();
  let currentUser = { userId: localUserId, appId: normalizeMolingId(molingAppId), productId: normalizeMolingId(molingProductId), isMolingUser: false };
  let pointHold = null;
  const prompt = `Generate 5 first-level outline items for a ${documentType || "Word"} document. Topic: ${topic || "AI Word document"}. Tone: ${tone || "formal"}. Extra requirement: ${requirement || "none"}. Return only a JSON string array. Use Simplified Chinese.`;

  try {
    currentUser = await getCurrentUser(request);
    pointHold = await reservePoints(currentUser, "word_outline_generate", 1, documentId || topic || "outline");
    const content = await callMolinChat([
      {
        role: "system",
        content: "You are a professional Simplified Chinese Word document writing assistant. Return only a JSON string array."
      },
      { role: "user", content: prompt }
    ]);

    const outline = parseOutline(content, topic || "AI Word document");
    await settlePoints(pointHold, 1, { userId: currentUser.userId, usageType: "word_outline_generate" });
    await logAiRequest({
      requestId: request.requestId,
      userId: currentUser.userId,
      documentId,
      actionType: "generate_outline",
      prompt,
      responseText: JSON.stringify(outline),
      latencyMs: Date.now() - startedAt
    });
    response.json({ outline });
  } catch (error) {
    await releasePoints(pointHold).catch((releaseError) => console.warn("Moling point release failed:", releaseError.message));
    await logAiRequest({
      requestId: request.requestId,
      userId: currentUser.userId,
      documentId,
      actionType: "generate_outline",
      prompt,
      responseText: "",
      status: "failed",
      errorMessage: error instanceof Error ? error.message : "大纲生成失败",
      latencyMs: Date.now() - startedAt
    });
    if (sendBillableActionError(response, error, currentUser, pointHold, "AI 大纲生成")) return;
    response.json({
      outline: fallbackOutline(topic || "AI Word document"),
      fallback: true,
      message: toPublicErrorMessage(error, "AI 大纲生成失败，已使用本地兜底大纲。")
    });
  }
});

app.post("/api/ai/generate-body", async (request, response) => {
  const { topic, documentType, tone, requirement, outline, documentId } = request.body;
  const normalizedOutline = normalizeGeneratedBodyOutline(outline, topic);
  const startedAt = Date.now();
  let currentUser = { userId: localUserId, appId: normalizeMolingId(molingAppId), productId: normalizeMolingId(molingProductId), isMolingUser: false };
  let pointHold = null;
  const prompt = `Write the main body for a ${documentType || "Word"} document in Simplified Chinese. Topic: ${topic || "AI Word document"}. Tone: ${tone || "formal"}. Extra requirement: ${requirement || "none"}.\nOutline:\n${normalizedOutline.map((item, index) => `${index + 1}. ${item.title}`).join("\n")}\nReturn only a JSON array with exactly ${normalizedOutline.length} objects in outline order. Each object must be {"paragraphs":["paragraph 1","paragraph 2"]}. Do not repeat or rewrite section titles. Each section needs 1-2 complete paragraphs suitable for Word export.`;

  try {
    currentUser = await getCurrentUser(request);
    pointHold = await reservePoints(currentUser, "word_body_generate", 5, documentId || topic || "body");
    const content = await callMolinChat([
      {
        role: "system",
        content: "You are a professional Simplified Chinese Word document writing assistant. Return structured JSON only. The user-confirmed outline is authoritative; write paragraph content without repeating section titles."
      },
      { role: "user", content: prompt }
    ]);

    const validContent = validateAiText(content, { minLength: 80 });
    await settlePoints(pointHold, 5, { userId: currentUser.userId, usageType: "word_body_generate" });
    await logAiRequest({
      requestId: request.requestId,
      userId: currentUser.userId,
      documentId,
      actionType: "generate_body",
      prompt,
      responseText: validContent,
      latencyMs: Date.now() - startedAt
    });
    response.json({ content: validContent, contentHtml: formatGeneratedBodyHtml(validContent, normalizedOutline, topic) });
  } catch (error) {
    await releasePoints(pointHold).catch((releaseError) => console.warn("Moling point release failed:", releaseError.message));
    await logAiRequest({
      requestId: request.requestId,
      userId: currentUser.userId,
      documentId,
      actionType: "generate_body",
      prompt,
      responseText: "",
      status: "failed",
      errorMessage: error instanceof Error ? error.message : "正文生成失败",
      latencyMs: Date.now() - startedAt
    });
    const fallbackContent = `${topic || "AI Word 文档"}\n\n当前 AI 服务暂时不可用，请检查模型配置或稍后重试。你可以先基于已有大纲继续手动编辑文档。`;
    if (sendBillableActionError(response, error, currentUser, pointHold, "AI 正文生成")) return;
    response.json({
      content: fallbackContent,
      contentHtml: formatGeneratedBodyHtml(fallbackContent, normalizedOutline, topic),
      fallback: true,
      message: toPublicErrorMessage(error, "AI 正文生成失败，已使用本地兜底内容。")
    });
  }
});

app.post("/api/ai/edit", async (request, response) => {
  const { action, content, documentId } = request.body;
  const sourceContent = typeof content === "string" ? content : "";
  const normalizedAction = normalizeAiEditAction(action);
  const startedAt = Date.now();
  let currentUser = { userId: localUserId, appId: normalizeMolingId(molingAppId), productId: normalizeMolingId(molingProductId), isMolingUser: false };
  let pointHold = null;
  const instruction = aiEditInstructions[normalizedAction];
  const prompt = `${instruction}\nReturn only the revised Simplified Chinese text.\n\n<<<TEXT_START\n${sourceContent}\nTEXT_END>>>`;

  try {
    currentUser = await getCurrentUser(request);
    pointHold = await reservePoints(currentUser, "word_polish", 2, documentId || normalizedAction);
    const result = await callMolinChat([
      {
        role: "system",
        content: "You are a professional Simplified Chinese Word document editor. Only return the processed text."
      },
      { role: "user", content: prompt }
    ]);

    const validContent = validateAiText(result, { minLength: normalizedAction === "shorten" ? 4 : 10 });
    await settlePoints(pointHold, 2, { userId: currentUser.userId, usageType: "word_polish" });
    await logAiRequest({
      requestId: request.requestId,
      userId: currentUser.userId,
      documentId,
      actionType: normalizedAction,
      prompt,
      responseText: validContent,
      latencyMs: Date.now() - startedAt
    });
    response.json({ content: validContent });
  } catch (error) {
    await releasePoints(pointHold).catch((releaseError) => console.warn("Moling point release failed:", releaseError.message));
    await logAiRequest({
      requestId: request.requestId,
      userId: currentUser.userId,
      documentId,
      actionType: normalizedAction,
      prompt,
      responseText: "",
      status: "failed",
      errorMessage: error instanceof Error ? error.message : "AI 编辑失败",
      latencyMs: Date.now() - startedAt
    });
    if (sendBillableActionError(response, error, currentUser, pointHold, "AI 编辑")) return;
    response.json({
      content: sourceContent,
      fallback: true,
      message: toPublicErrorMessage(error, "AI 编辑失败，已保留原文。")
    });
  }
});
app.post("/api/ai/polish", async (request, response) => {
  const { content, documentId } = request.body;
  const sourceContent = typeof content === "string" ? content : "";
  const startedAt = Date.now();
  let currentUser = { userId: localUserId, appId: normalizeMolingId(molingAppId), productId: normalizeMolingId(molingProductId), isMolingUser: false };
  let pointHold = null;
  const prompt = `Polish the following content in Simplified Chinese:\n\n${sourceContent}`;

  try {
    // 中文注解：兼容旧客户端的 polish 路由必须复用与新版编辑接口相同的登录、预占和结算边界，不能成为免费模型旁路。
    currentUser = await getCurrentUser(request);
    pointHold = await reservePoints(currentUser, "word_polish", usageCosts.word_polish, documentId || "legacy-polish");
    const polished = await callMolinChat([
      {
        role: "system",
        content: "You are a professional Simplified Chinese Word document polishing assistant. Keep the original meaning and return only the polished text."
      },
      {
        role: "user",
        content: prompt
      }
    ]);
    const validContent = validateAiText(polished, { minLength: 10 });
    await settlePoints(pointHold, usageCosts.word_polish, { userId: currentUser.userId, usageType: "word_polish" });
    await logAiRequest({
      requestId: request.requestId,
      userId: currentUser.userId,
      documentId,
      actionType: "polish_legacy",
      prompt,
      responseText: validContent,
      latencyMs: Date.now() - startedAt
    });
    response.json({ content: validContent });
  } catch (error) {
    await releasePoints(pointHold).catch((releaseError) => console.warn("Moling point release failed:", releaseError.message));
    await logAiRequest({
      requestId: request.requestId,
      userId: currentUser.userId,
      documentId,
      actionType: "polish_legacy",
      prompt,
      responseText: "",
      status: "failed",
      errorMessage: error instanceof Error ? error.message : "AI 润色失败",
      latencyMs: Date.now() - startedAt
    });
    if (sendBillableActionError(response, error, currentUser, pointHold, "AI 润色")) return;
    response.json({
      content: sourceContent,
      fallback: true,
      message: toPublicErrorMessage(error, "AI 润色失败，已保留原文。")
    });
  }
});
app.use("/api", (_request, response) => {
  response.status(404).json({ message: "请求的接口不存在。" });
});

app.use((error, _request, response, next) => {
  if (response.headersSent) return next(error);
  if (error?.type === "entity.parse.failed" || (error instanceof SyntaxError && Object.prototype.hasOwnProperty.call(error, "body"))) {
    response.status(400).json({ message: "请求内容不是有效的 JSON。" });
    return;
  }
  sendError(response, error, 500, "服务暂时不可用，请稍后重试。");
});

export { appendBillingReconciliationOutbox, buildAiAuditRecord, createBillingReconciliationPayload, createDocxBuffer, createTemplateAgentFallbackPlan, formatGeneratedBodyHtml, legacyDocTextToHtml, loadTemplateAgentCandidates, normalizeAiEditAction, normalizeTemplateAgentPlan, normalizeTemplateAgentReview, normalizeTemplateBriefAnalysis, parseImportedDocument, parseStyledDocxToHtml, persistBillingReconciliationTask, readSafeImageDimensions, resolveBillableFailureResponse, resolveTemplateAgentFailureStatus, sanitizeImportedHtml, shouldReleasePointHold, validateProductionConfiguration };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const productionConfigurationErrors = validateProductionConfiguration(process.env);
  if (productionConfigurationErrors.length) {
    throw new Error(`生产配置校验失败：\n- ${productionConfigurationErrors.join("\n- ")}`);
  }
  const server = app.listen(port, appHost, () => {
    console.log(`API server running at http://${appHost}:${port}`);
  });
  let shutdownStarted = false;
  const shutdown = (signal) => {
    if (shutdownStarted) return;
    shutdownStarted = true;
    console.log(JSON.stringify({ timestamp: new Date().toISOString(), level: "info", type: "shutdown", signal }));
    process.disconnect?.();
    const forceExitTimer = setTimeout(() => {
      console.error(`服务未能在 ${shutdownTimeoutMs}ms 内退出。`);
      process.exit(1);
    }, shutdownTimeoutMs);
    forceExitTimer.unref();

    // 中文注解：先停止接收新请求并关闭空闲连接，再释放数据库连接，给在途导出和计费结算留出完成时间。
    server.close(async (error) => {
      try {
        if (dbPool) await dbPool.end();
      } catch (closeError) {
        console.error("数据库连接池关闭失败：", closeError);
        error ||= closeError;
      } finally {
        clearTimeout(forceExitTimer);
        // 中文注解：设置退出码后让事件循环自然排空，避免 Windows 上刚写完响应就 process.exit 导致客户端收到 ECONNRESET。
        process.exitCode = error ? 1 : 0;
      }
    });
    server.closeIdleConnections?.();
  };
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));
  // 中文注解：Windows 自动化无法可靠发送 POSIX 信号，受控父进程可通过 IPC 复用同一优雅退出路径。
  process.on("message", (message) => {
    if (message?.type === "molingword:shutdown") shutdown("IPC");
  });
}



