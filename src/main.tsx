import React from "react";
import { createRoot } from "react-dom/client";
import { Extension, Mark, Node as TiptapNode, mergeAttributes, type CommandProps } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";
import { EditorContent, useEditor, type Editor as TiptapEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Table, TableView } from "@tiptap/extension-table";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { TableRow } from "@tiptap/extension-table-row";
import ImageExtension from "@tiptap/extension-image";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  Bot,
  Check,
  CheckCircle2,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Combine,
  Download,
  Eraser,
  FileText,
  FileUp,
  FolderOpen,
  Highlighter,
  Image as ImageIcon,
  Italic,
  IndentDecrease,
  IndentIncrease,
  LayoutTemplate,
  LoaderCircle,
  List,
  ListOrdered,
  ListTree,
  Link2,
  PenLine,
  PanelTop,
  Plus,
  RefreshCw,
  Rows3,
  Save,
  Search,
  Sparkles,
  Split,
  Strikethrough,
  Subscript,
  Superscript,
  Table as TableIcon,
  Trash2,
  Type,
  Underline as UnderlineIcon,
  Unlink,
  Undo2,
  Redo2,
  Wand2,
  X,
  XCircle
} from "lucide-react";
import "./styles.css";
import { documentTemplates as fallbackDocumentTemplates, documentTypes, type DocumentType, type TemplateItem, type TemplateWordStyle } from "./templates/documentTemplates";

type AiAction = "continue" | "expand" | "shorten" | "correct" | "polish" | "format";
type AiApplyMode = "replace" | "insert";
type TextCaseMode = "upper" | "lower" | "title";
type EditorViewMode = "edit" | "page";
type ParagraphSpacingProperty = "line-height" | "margin-top" | "margin-bottom" | "margin-left" | "margin-right" | "text-indent" | "--word-line-rule";
type ParagraphSpacingStyles = Partial<Record<ParagraphSpacingProperty, string>>;
type ParagraphPaginationAttribute = "keepNext" | "keepLines" | "pageBreakBefore" | "widowControl";
type ParagraphAppearancePatch = { shading?: string | null; borders?: string | null };

function imagePixelAttribute(element: HTMLElement, property: "width" | "height") {
  const styleValue = element.style[property];
  const value = Number.parseFloat(styleValue.endsWith("px") ? styleValue : element.getAttribute(property) || "");
  return Number.isFinite(value) && value > 0 ? Math.round(value * 100) / 100 : null;
}

function clientDocxFloatingValue(value: unknown) {
  try {
    const floating = typeof value === "string" ? JSON.parse(value) : value;
    return floating && typeof floating === "object" ? floating as Record<string, any> : null;
  } catch {
    return null;
  }
}

function clientFloatingImagePresentation(value: unknown) {
  try {
    const source = clientDocxFloatingValue(value);
    if (!source) return null;
    const wrap = ["none", "square", "tight", "topAndBottom"].includes(source.wrap?.type) ? source.wrap.type : "none";
    const align = ["left", "right", "center", "inside", "outside"].includes(source.horizontal?.align) ? source.horizontal.align : "offset";
    const margin = (side: string) => Math.max(0, Math.min(Number(source.margins?.[side]) || 0, 9144000)) / 9525;
    const styles = [
      `margin-top: ${margin("top")}px`,
      `margin-right: ${margin("right")}px`,
      `margin-bottom: ${margin("bottom")}px`,
      `margin-left: ${margin("left")}px`
    ];
    if (["square", "tight"].includes(wrap) && ["left", "right"].includes(align)) styles.push(`float: ${align}`);
    if (wrap === "topAndBottom") styles.push("clear: both");
    return { wrap, align, styles };
  } catch {
    return null;
  }
}

const DocumentImage = ImageExtension.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      widthPx: {
        default: null,
        parseHTML: (element) => imagePixelAttribute(element, "width"),
        renderHTML: () => ({})
      },
      heightPx: {
        default: null,
        parseHTML: (element) => imagePixelAttribute(element, "height"),
        renderHTML: () => ({})
      },
      docxFloating: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-docx-floating"),
        renderHTML: () => ({})
      }
    };
  },
  renderHTML({ node, HTMLAttributes }) {
    const width = Number(node.attrs.widthPx) > 0 ? Number(node.attrs.widthPx) : null;
    const height = Number(node.attrs.heightPx) > 0 ? Number(node.attrs.heightPx) : null;
    const floating = clientFloatingImagePresentation(node.attrs.docxFloating);
    const styles = [
      width ? `width: ${width}px` : "",
      height ? `height: ${height}px` : "",
      ...(floating?.styles || []),
      "max-width: 100%"
    ].filter(Boolean).join("; ");
    // 中文注解：图片尺寸和浮动语义由同一节点渲染，编辑、保存与分页预览不会各自推断一套布局。
    return ["img", mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
      width: width || undefined,
      height: height || undefined,
      style: styles,
      "data-docx-floating": node.attrs.docxFloating || undefined,
      "data-docx-wrap": floating?.wrap,
      "data-docx-float-align": floating?.align
    })];
  }
});

function normalizeSafeHyperlink(value: string) {
  const href = value.trim().slice(0, 2048);
  if (/^mailto:[^\s@]+@[^\s@]+$/i.test(href)) return href;
  try {
    const url = new URL(href);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}
type FormatSelectOption = { label: string; value: string };
type DocumentPageTextStyle = {
  alignment: "left" | "center" | "right";
  fontFamily: string;
  fontSizePt: number;
  color: string;
  bold: boolean;
  italic: boolean;
};
type DocumentPageImage = {
  id: string;
  fileId: number | null;
  src: string;
  alt: string;
  widthPx: number;
  heightPx: number;
  paragraphIndex: number;
  placement: "beforeText" | "afterText";
  alignment: "left" | "center" | "right";
};
type DocumentPageVariant = {
  headerText: string;
  headerStyle: DocumentPageTextStyle;
  headerImages: DocumentPageImage[];
  footerText: string;
  footerStyle: DocumentPageTextStyle;
  footerImages: DocumentPageImage[];
  headerPageNumberTemplate: string;
  footerPageNumberTemplate: string;
  headerPageNumberSeparate: boolean;
  footerPageNumberSeparate: boolean;
  pageNumberEnabled: boolean;
  pageNumberPosition: "header" | "footer";
};
type DocumentPageMargins = { top: number; right: number; bottom: number; left: number };
type DocumentPaperSize = { width: number; height: number };
type DocumentPageColumn = { width: number; space: number };
type DocumentPageColumns = { count: number; space: number; separate: boolean; equalWidth?: false; items?: DocumentPageColumn[] };
type DocumentPageBorderSide = { style: string; size: number; color: string; space: number };
type DocumentPageBorders = {
  display: "allPages" | "firstPage" | "notFirstPage";
  offsetFrom: "page" | "text";
  zOrder: "front" | "back";
  top?: DocumentPageBorderSide;
  right?: DocumentPageBorderSide;
  bottom?: DocumentPageBorderSide;
  left?: DocumentPageBorderSide;
};
type SectionBreakType = "nextPage" | "oddPage" | "evenPage";
type DocumentPageLayout = DocumentPageVariant & {
  firstPageDifferent: boolean;
  firstPage: DocumentPageVariant;
  oddEvenDifferent: boolean;
  evenPage: DocumentPageVariant;
  orientation: "portrait" | "landscape";
  paperSize: DocumentPaperSize;
  pageNumberFormat: "decimal" | "upperRoman" | "lowerRoman" | "upperLetter" | "lowerLetter";
  pageNumberStart: number | null;
  headerDistance: number;
  footerDistance: number;
  columns: DocumentPageColumns;
  verticalAlign: "top" | "center" | "bottom" | "both";
  pageBorders: DocumentPageBorders | null;
  margins: DocumentPageMargins;
};
const defaultDocumentPageTextStyle: DocumentPageTextStyle = { alignment: "center", fontFamily: "Microsoft YaHei", fontSizePt: 9, color: "#6B7280", bold: false, italic: false };
const defaultDocumentPageNumberTemplate = "第 {PAGE} 页 / 共 {NUMPAGES} 页";
const defaultDocumentPageVariant: DocumentPageVariant = {
  headerText: "",
  headerStyle: { ...defaultDocumentPageTextStyle },
  headerImages: [],
  footerText: "",
  footerStyle: { ...defaultDocumentPageTextStyle },
  footerImages: [],
  headerPageNumberTemplate: "",
  footerPageNumberTemplate: "",
  headerPageNumberSeparate: false,
  footerPageNumberSeparate: false,
  pageNumberEnabled: false,
  pageNumberPosition: "footer"
};
const defaultDocumentPageMargins: DocumentPageMargins = { top: 1440, right: 1440, bottom: 1440, left: 1440 };
const a4PageTwip = { width: 11906, height: 16838 };
const documentPaperSizes = [
  { value: "a4", label: "A4", width: 11906, height: 16838 },
  { value: "a3", label: "A3", width: 16838, height: 23811 },
  { value: "letter", label: "Letter", width: 12240, height: 15840 },
  { value: "legal", label: "Legal", width: 12240, height: 20160 },
  { value: "b5", label: "B5 (JIS)", width: 10318, height: 14570 }
] as const;
const defaultDocumentPageLayout: DocumentPageLayout = {
  ...defaultDocumentPageVariant,
  firstPageDifferent: false,
  firstPage: { ...defaultDocumentPageVariant },
  oddEvenDifferent: false,
  evenPage: { ...defaultDocumentPageVariant },
  orientation: "portrait",
  paperSize: { ...a4PageTwip },
  pageNumberFormat: "decimal",
  pageNumberStart: null,
  headerDistance: 708,
  footerDistance: 708,
  columns: { count: 1, space: 720, separate: false },
  verticalAlign: "top",
  pageBorders: null,
  margins: { ...defaultDocumentPageMargins }
};

function normalizeDocumentPageBorders(value: unknown): DocumentPageBorders | null {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : null;
  if (!source) return null;
  const result: DocumentPageBorders = {
    display: ["allPages", "firstPage", "notFirstPage"].includes(String(source.display)) ? source.display as DocumentPageBorders["display"] : "allPages",
    offsetFrom: source.offsetFrom === "text" ? "text" : "page",
    zOrder: source.zOrder === "back" ? "back" : "front"
  };
  const styles = new Set(["single", "dashed", "dashSmallGap", "dotted", "dotDash", "dotDotDash", "double", "thick", "none", "nil"]);
  let hasBorder = false;
  for (const side of ["top", "right", "bottom", "left"] as const) {
    const border = source[side] && typeof source[side] === "object" ? source[side] as Record<string, unknown> : null;
    if (!border || !styles.has(String(border.style))) continue;
    result[side] = {
      style: String(border.style),
      size: Math.max(0, Math.min(96, Math.round(Number(border.size) || 0))),
      color: /^#[0-9a-f]{6}$/i.test(String(border.color || "")) ? String(border.color).toUpperCase() : "#000000",
      space: Math.max(0, Math.min(31, Math.round(Number(border.space) || 0)))
    };
    hasBorder = true;
  }
  return hasBorder ? result : null;
}

function normalizeDocumentPageTextStyle(value: Partial<DocumentPageTextStyle> | null | undefined, fallback = defaultDocumentPageTextStyle): DocumentPageTextStyle {
  const fontSizePt = Number(value?.fontSizePt ?? fallback.fontSizePt);
  const color = String(value?.color ?? fallback.color);
  return {
    alignment: ["left", "center", "right"].includes(String(value?.alignment)) ? value!.alignment! : fallback.alignment,
    fontFamily: String(value?.fontFamily ?? fallback.fontFamily).replace(/["\\]/g, "").trim().slice(0, 100) || defaultDocumentPageTextStyle.fontFamily,
    fontSizePt: Number.isFinite(fontSizePt) ? Math.max(6, Math.min(Math.round(fontSizePt * 2) / 2, 72)) : fallback.fontSizePt,
    color: /^#?[0-9a-f]{6}$/i.test(color) ? `#${color.replace("#", "").toUpperCase()}` : fallback.color,
    bold: value?.bold === undefined ? fallback.bold : Boolean(value.bold),
    italic: value?.italic === undefined ? fallback.italic : Boolean(value.italic)
  };
}

function normalizeDocumentPageText(value: unknown) {
  // 中文注解：客户端处于逐键编辑态，只统一换行和长度；服务端保存时再做空白规范化，避免 Enter 或空格被即时吞掉。
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .slice(0, 2000);
}

function normalizeDocumentPageImages(value: unknown): DocumentPageImage[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 10).map((item, index) => {
    const source = (item && typeof item === "object" ? item : {}) as Partial<DocumentPageImage>;
    const rawWidth = Number(source.widthPx);
    const rawHeight = Number(source.heightPx);
    const width = Number.isFinite(rawWidth) ? Math.max(1, rawWidth) : 120;
    const height = Number.isFinite(rawHeight) ? Math.max(1, rawHeight) : 60;
    const scale = Math.min(1, 602 / width, 400 / height);
    return {
      id: String(source.id || (source.fileId ? `file-${source.fileId}` : `page-image-${index + 1}`)),
      fileId: Number.isSafeInteger(Number(source.fileId)) && Number(source.fileId) > 0 ? Number(source.fileId) : null,
      src: String(source.src || ""),
      alt: String(source.alt || "页眉页脚图片").slice(0, 200),
      widthPx: Math.round(width * scale * 100) / 100,
      heightPx: Math.round(height * scale * 100) / 100,
      paragraphIndex: Math.max(0, Math.min(Math.round(Number(source.paragraphIndex) || 0), 49)),
      placement: source.placement === "beforeText" ? ("beforeText" as const) : ("afterText" as const),
      alignment: ["left", "center", "right"].includes(String(source.alignment)) ? source.alignment! : "center"
    };
  }).filter((item) => Boolean(item.src));
}

function normalizeDocumentPageVariant(value: Partial<DocumentPageVariant> | null | undefined, fallback = defaultDocumentPageVariant): DocumentPageVariant {
  const source = value || {};
  const hasHeaderTemplate = Object.prototype.hasOwnProperty.call(source, "headerPageNumberTemplate");
  const hasFooterTemplate = Object.prototype.hasOwnProperty.call(source, "footerPageNumberTemplate");
  let headerPageNumberTemplate = hasHeaderTemplate ? String(source.headerPageNumberTemplate || "").replace(/\s+/g, " ").trim().slice(0, 500) : fallback.headerPageNumberTemplate;
  let footerPageNumberTemplate = hasFooterTemplate ? String(source.footerPageNumberTemplate || "").replace(/\s+/g, " ").trim().slice(0, 500) : fallback.footerPageNumberTemplate;
  if (!hasHeaderTemplate && !hasFooterTemplate && source.pageNumberEnabled !== undefined) {
    headerPageNumberTemplate = source.pageNumberEnabled && source.pageNumberPosition === "header" ? defaultDocumentPageNumberTemplate : "";
    footerPageNumberTemplate = source.pageNumberEnabled && source.pageNumberPosition !== "header" ? defaultDocumentPageNumberTemplate : "";
  }
  const pageNumberEnabled = Boolean(headerPageNumberTemplate || footerPageNumberTemplate);
  return {
    headerText: normalizeDocumentPageText(value?.headerText ?? fallback.headerText),
    headerStyle: normalizeDocumentPageTextStyle(value?.headerStyle, fallback.headerStyle),
    headerImages: normalizeDocumentPageImages(value?.headerImages === undefined ? fallback.headerImages : value.headerImages),
    footerText: normalizeDocumentPageText(value?.footerText ?? fallback.footerText),
    footerStyle: normalizeDocumentPageTextStyle(value?.footerStyle, fallback.footerStyle),
    footerImages: normalizeDocumentPageImages(value?.footerImages === undefined ? fallback.footerImages : value.footerImages),
    headerPageNumberTemplate,
    footerPageNumberTemplate,
    headerPageNumberSeparate: Boolean(headerPageNumberTemplate) && (value?.headerPageNumberSeparate === undefined ? fallback.headerPageNumberSeparate : Boolean(value.headerPageNumberSeparate)),
    footerPageNumberSeparate: Boolean(footerPageNumberTemplate) && (value?.footerPageNumberSeparate === undefined ? fallback.footerPageNumberSeparate : Boolean(value.footerPageNumberSeparate)),
    pageNumberEnabled,
    pageNumberPosition: headerPageNumberTemplate && !footerPageNumberTemplate ? "header" : "footer"
  };
}

function normalizeDocumentPageLayout(value: Partial<DocumentPageLayout> | null | undefined): DocumentPageLayout {
  const orientation = value?.orientation === "landscape" ? "landscape" : "portrait";
  const rawPaperWidth = Number(value?.paperSize?.width ?? a4PageTwip.width);
  const rawPaperHeight = Number(value?.paperSize?.height ?? a4PageTwip.height);
  const paperWidth = Math.max(1440, Math.min(50000, Math.round(Number.isFinite(rawPaperWidth) ? rawPaperWidth : a4PageTwip.width)));
  const paperHeight = Math.max(1440, Math.min(50000, Math.round(Number.isFinite(rawPaperHeight) ? rawPaperHeight : a4PageTwip.height)));
  const paperSize = { width: Math.min(paperWidth, paperHeight), height: Math.max(paperWidth, paperHeight) };
  const normalizeMargin = (side: keyof DocumentPageMargins) => {
    const number = Number(value?.margins?.[side]);
    return Number.isFinite(number) ? Math.max(0, Math.min(Math.round(number), 7200)) : defaultDocumentPageMargins[side];
  };
  const margins = { top: normalizeMargin("top"), right: normalizeMargin("right"), bottom: normalizeMargin("bottom"), left: normalizeMargin("left") };
  const pageNumberFormats: DocumentPageLayout["pageNumberFormat"][] = ["decimal", "upperRoman", "lowerRoman", "upperLetter", "lowerLetter"];
  const pageNumberStartValue = Number(value?.pageNumberStart);
  const pageWidth = orientation === "landscape" ? paperSize.height : paperSize.width;
  const pageHeight = orientation === "landscape" ? paperSize.width : paperSize.height;
  const columnCount = Math.max(1, Math.min(8, Math.round(Number(value?.columns?.count) || 1)));
  const columnSpaceValue = Number(value?.columns?.space ?? 720);
  const columnSpace = Math.max(0, Math.min(7200, Math.round(Number.isFinite(columnSpaceValue) ? columnSpaceValue : 720)));
  const fitPair = (first: number, second: number, maximum: number) => {
    const total = first + second;
    if (total <= maximum || total <= 0) return [first, second];
    const ratio = maximum / total;
    return [Math.round(first * ratio), Math.round(second * ratio)];
  };
  // 中文注解：前后端使用同一联合约束，为当前纸张正文保留至少 0.5 英寸。
  [margins.left, margins.right] = fitPair(margins.left, margins.right, pageWidth - 720);
  [margins.top, margins.bottom] = fitPair(margins.top, margins.bottom, pageHeight - 720);
  const availableWidth = Math.max(720, pageWidth - margins.left - margins.right);
  const rawColumnItems = Array.isArray(value?.columns?.items) ? value.columns.items : [];
  let columns: DocumentPageColumns;
  if (columnCount > 1 && value?.columns?.equalWidth === false && rawColumnItems.length >= columnCount) {
    const items = rawColumnItems.slice(0, columnCount).map((item, index) => ({
      width: Math.max(1, Math.min(20000, Math.round(Number(item?.width) || 1))),
      space: index === columnCount - 1 ? 0 : Math.max(0, Math.min(7200, Math.round(Number(item?.space) || 0)))
    }));
    const gapTotal = items.slice(0, -1).reduce((total, item) => total + item.space, 0);
    const maximumGapTotal = Math.max(0, availableWidth - columnCount * 360);
    if (gapTotal > maximumGapTotal && gapTotal > 0) {
      const gapScale = maximumGapTotal / gapTotal;
      items.forEach((item, index) => { item.space = index === columnCount - 1 ? 0 : Math.round(item.space * gapScale); });
    }
    const normalizedGapTotal = items.slice(0, -1).reduce((total, item) => total + item.space, 0);
    const widthBudget = Math.max(columnCount, availableWidth - normalizedGapTotal);
    const widthTotal = items.reduce((total, item) => total + item.width, 0);
    if (widthTotal > widthBudget) {
      const widthScale = widthBudget / widthTotal;
      items.forEach((item) => { item.width = Math.max(1, Math.round(item.width * widthScale)); });
    }
    columns = { count: columnCount, space: items[0]?.space || 0, separate: Boolean(value?.columns?.separate), equalWidth: false, items };
  } else {
    const maximumColumnSpace = columnCount > 1 ? Math.max(0, Math.floor((availableWidth - columnCount * 720) / (columnCount - 1))) : columnSpace;
    columns = { count: columnCount, space: Math.min(columnSpace, maximumColumnSpace), separate: columnCount > 1 && Boolean(value?.columns?.separate) };
  }
  const verticalAlignValues: DocumentPageLayout["verticalAlign"][] = ["top", "center", "bottom", "both"];
  return {
    ...normalizeDocumentPageVariant(value),
    firstPageDifferent: Boolean(value?.firstPageDifferent),
    firstPage: normalizeDocumentPageVariant(value?.firstPage),
    oddEvenDifferent: Boolean(value?.oddEvenDifferent),
    evenPage: normalizeDocumentPageVariant(value?.evenPage),
    orientation,
    paperSize,
    pageNumberFormat: pageNumberFormats.includes(value?.pageNumberFormat as DocumentPageLayout["pageNumberFormat"]) ? value!.pageNumberFormat! : "decimal",
    pageNumberStart: value?.pageNumberStart === null || value?.pageNumberStart === undefined || !Number.isFinite(pageNumberStartValue) ? null : Math.max(0, Math.min(Math.round(pageNumberStartValue), 999999)),
    headerDistance: Number.isFinite(Number(value?.headerDistance)) ? Math.max(0, Math.min(Math.round(Number(value?.headerDistance)), 7200)) : 708,
    footerDistance: Number.isFinite(Number(value?.footerDistance)) ? Math.max(0, Math.min(Math.round(Number(value?.footerDistance)), 7200)) : 708,
    columns,
    verticalAlign: verticalAlignValues.includes(value?.verticalAlign as DocumentPageLayout["verticalAlign"]) ? value!.verticalAlign! : "top",
    pageBorders: normalizeDocumentPageBorders(value?.pageBorders),
    margins
  };
}

function pageVariantForPage(layout: DocumentPageLayout, globalPageIndex: number, sectionPageIndex: number): DocumentPageVariant {
  if (sectionPageIndex === 0 && layout.firstPageDifferent) return layout.firstPage || defaultDocumentPageVariant;
  if ((globalPageIndex + 1) % 2 === 0 && layout.oddEvenDifferent) return layout.evenPage || defaultDocumentPageVariant;
  return layout;
}

function parseSectionPageLayout(value: unknown, fallback: DocumentPageLayout): DocumentPageLayout {
  try {
    const parsed = (typeof value === "string" ? JSON.parse(value) : value) as Partial<DocumentPageLayout> | null;
    const mergeLegacyVariant = (base: DocumentPageVariant, override: Partial<DocumentPageVariant> | null | undefined): DocumentPageVariant => {
      const merged: Partial<DocumentPageVariant> = {
        ...base,
        ...(override || {}),
        headerStyle: { ...base.headerStyle, ...(override?.headerStyle || {}) },
        footerStyle: { ...base.footerStyle, ...(override?.footerStyle || {}) }
      };
      // 中文注解：旧节节点只有 pageNumberEnabled/pageNumberPosition；显式旧开关必须先迁移，不能被前一节的新模板字段遮蔽。
      if (override && Object.prototype.hasOwnProperty.call(override, "pageNumberEnabled")
        && !Object.prototype.hasOwnProperty.call(override, "headerPageNumberTemplate")
        && !Object.prototype.hasOwnProperty.call(override, "footerPageNumberTemplate")) {
        merged.headerPageNumberTemplate = override.pageNumberEnabled && override.pageNumberPosition === "header" ? defaultDocumentPageNumberTemplate : "";
        merged.footerPageNumberTemplate = override.pageNumberEnabled && override.pageNumberPosition !== "header" ? defaultDocumentPageNumberTemplate : "";
      }
      return merged as DocumentPageVariant;
    };
    const mergedDefault = mergeLegacyVariant(fallback, parsed);
    return normalizeDocumentPageLayout({
      ...fallback,
      ...(parsed || {}),
      ...mergedDefault,
      firstPage: mergeLegacyVariant(fallback.firstPage, parsed?.firstPage),
      evenPage: mergeLegacyVariant(fallback.evenPage, parsed?.evenPage),
      margins: { ...fallback.margins, ...(parsed?.margins || {}) }
    });
  } catch {
    return normalizeDocumentPageLayout(fallback);
  }
}

function samePageLayout(left: DocumentPageLayout, right: DocumentPageLayout) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function normalizeSectionBreakType(value: unknown): SectionBreakType {
  // 中文注解：连续分节无法在当前分页画布中等价呈现，统一按下一页分节，确保在线预览与导出一致。
  return ["oddPage", "evenPage"].includes(String(value)) ? value as SectionBreakType : "nextPage";
}

type RecentDocument = {
  id: number;
  title: string;
  type: DocumentType;
  updatedAt: string;
  words: number;
};

type ApiDocument = {
  id: number;
  title: string;
  documentType: DocumentType;
  tone: string;
  templateId: number | null;
  outline: string[];
  content: string;
  pageLayout: DocumentPageLayout;
  wordCount: number;
  updatedAt: string;
};

type ApiTemplate = TemplateItem & {
  id: number;
  createdAt?: string;
  updatedAt?: string;
};

type OutlineItem = {
  id: number;
  title: string;
  level?: number;
  position?: number;
};

type AiEditResult = {
  action: AiAction;
  source: string;
  content: string;
  from: number;
  to: number;
};

type SessionUser = {
  userId: string;
  appId: string;
  productId: string;
  isMolingUser: boolean;
};

type PointsSummary = {
  enabled: boolean;
  remaining: number | null;
  error?: string;
};

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    paragraphIndent: {
      increaseIndent: () => ReturnType;
      decreaseIndent: () => ReturnType;
      setFirstLineIndent: (level: number) => ReturnType;
      setParagraphSpacing: (styles: ParagraphSpacingStyles) => ReturnType;
      setParagraphAppearance: (patch: ParagraphAppearancePatch) => ReturnType;
      toggleParagraphPagination: (attribute: ParagraphPaginationAttribute) => ReturnType;
    };
  }
}

const usageCosts = {
  outline: 1,
  body: 5,
  edit: 2,
  exportDocx: 1
};

const loadingStepMap: Record<string, string[]> = {
  正在生成大纲: ["理解文档主题", "整理章节结构", "生成大纲条目", "准备进入编辑"],
  正在生成正文: ["读取当前大纲", "组织段落内容", "润色表达语气", "写入正文编辑器"],
  正在润色: ["分析选中文本", "优化措辞语气", "保持原意一致", "生成处理结果"],
  正在续写: ["分析上下文", "延展后续内容", "保持行文连贯", "生成处理结果"],
  正在扩写: ["识别核心观点", "补充细节说明", "优化段落层次", "生成处理结果"],
  正在缩写: ["提取关键信息", "压缩重复表达", "保留核心结论", "生成处理结果"],
  正在纠错: ["检查错别字", "修正语病标点", "统一表达风格", "生成处理结果"],
  正在优化格式: ["识别段落层级", "统一标题和列表", "优化段落结构", "生成处理结果"],
  "正在导出 Word": ["保存当前文档", "生成 Word 文件", "上传文件存储", "准备自动下载"]
};

const defaultOutline: OutlineItem[] = [
  { id: 1, title: "一、项目背景与目标" },
  { id: 2, title: "二、核心功能规划" },
  { id: 3, title: "三、使用流程设计" },
  { id: 4, title: "四、技术实现方案" },
  { id: 5, title: "五、交付与迭代计划" }
];

const defaultContent = `AI Word 文档助手是一款面向个人用户的智能文档写作工具，可帮助用户生成大纲、撰写正文、润色选中文本、自动保存文档并导出 Word 文件。

一、项目背景与目标

第一版聚焦单人日常使用。用户可以从一个主题开始，快速生成清晰大纲，再生成正文内容，并在在线编辑器中继续修改和导出。

二、核心功能规划

核心功能包括 AI 大纲生成、AI 正文生成、富文本编辑、选中文本润色、自动保存、文档管理和 Word 导出。`;

const maxIndentLevel = 6;
const docxPagePreview = {
  twipToPx: 96 / 1440
};
type PreviewPage = { columns: string[][]; sectionIndex: number; sectionPageIndex: number; layout: DocumentPageLayout; usedHeight: number; usedHeights: number[] };

function pageGeometry(layout: DocumentPageLayout) {
  const landscape = layout.orientation === "landscape";
  const paperSize = layout.paperSize || a4PageTwip;
  const widthPx = (landscape ? paperSize.height : paperSize.width) * docxPagePreview.twipToPx;
  const heightPx = (landscape ? paperSize.width : paperSize.height) * docxPagePreview.twipToPx;
  const margins = {
    top: layout.margins.top * docxPagePreview.twipToPx,
    right: layout.margins.right * docxPagePreview.twipToPx,
    bottom: layout.margins.bottom * docxPagePreview.twipToPx,
    left: layout.margins.left * docxPagePreview.twipToPx
  };
  const contentWidthPx = Math.max(96, widthPx - margins.left - margins.right);
  const columnCount = Math.max(1, layout.columns.count);
  const customColumns = layout.columns.equalWidth === false && Array.isArray(layout.columns.items) && layout.columns.items.length >= columnCount;
  const equalColumnGapPx = layout.columns.space * docxPagePreview.twipToPx;
  const equalColumnWidthPx = Math.max(48, (contentWidthPx - equalColumnGapPx * (columnCount - 1)) / columnCount);
  const columnWidthsPx = customColumns
    ? layout.columns.items!.slice(0, columnCount).map((item) => item.width * docxPagePreview.twipToPx)
    : Array.from({ length: columnCount }, () => equalColumnWidthPx);
  const columnGapsPx = customColumns
    ? layout.columns.items!.slice(0, -1).map((item) => item.space * docxPagePreview.twipToPx)
    : Array.from({ length: Math.max(0, columnCount - 1) }, () => equalColumnGapPx);
  const columnTemplate = columnWidthsPx.flatMap((width, index) => index < columnGapsPx.length ? [`${width}px`, `${columnGapsPx[index]}px`] : [`${width}px`]).join(" ");
  return {
    widthPx,
    heightPx,
    margins,
    contentWidthPx,
    columnCount,
    columnGapPx: equalColumnGapPx,
    columnWidthPx: columnWidthsPx[0] || contentWidthPx,
    columnWidthsPx,
    columnGapsPx,
    columnTemplate,
    contentHeightPx: Math.max(96, heightPx - margins.top - margins.bottom)
  };
}

function createPreviewPage(layout: DocumentPageLayout, sectionIndex: number, sectionPageIndex: number): PreviewPage {
  const count = pageGeometry(layout).columnCount;
  return { columns: Array.from({ length: count }, () => []), sectionIndex, sectionPageIndex, layout, usedHeight: 0, usedHeights: Array.from({ length: count }, () => 0) };
}

function pageBorderCss(border: DocumentPageBorderSide | undefined) {
  if (!border || ["none", "nil"].includes(border.style) || border.size <= 0) return "none";
  const style = border.style === "double" ? "double" : border.style === "dotted" ? "dotted" : border.style.includes("dash") || border.style.startsWith("dot") ? "dashed" : "solid";
  return `${Math.round(border.size / 6 * 100) / 100}px ${style} ${border.color}`;
}

function pageGeometryStyle(layout: DocumentPageLayout, sectionPageIndex = 0, usedHeight = 0): React.CSSProperties {
  const geometry = pageGeometry(layout);
  const pageBorders = layout.pageBorders;
  const showPageBorder = Boolean(pageBorders) && (pageBorders?.display === "allPages" || (pageBorders?.display === "firstPage" && sectionPageIndex === 0) || (pageBorders?.display === "notFirstPage" && sectionPageIndex > 0));
  const borderInset = (side: keyof DocumentPageMargins) => {
    const border = pageBorders?.[side];
    const spacePx = (border?.space || 0) * 96 / 72;
    return pageBorders?.offsetFrom === "text" ? Math.max(0, geometry.margins[side] - spacePx) : spacePx;
  };
  const occupiedHeight = Math.min(geometry.contentHeightPx, Math.max(0, usedHeight));
  const remainingHeight = Math.max(0, geometry.contentHeightPx - occupiedHeight);
  const verticalOffset = layout.verticalAlign === "center" ? remainingHeight / 2 : layout.verticalAlign === "bottom" ? remainingHeight : 0;
  return {
    "--page-width": `${geometry.widthPx}px`,
    "--page-height": `${geometry.heightPx}px`,
    "--page-margin-top": `${geometry.margins.top}px`,
    "--page-margin-right": `${geometry.margins.right}px`,
    "--page-margin-bottom": `${geometry.margins.bottom}px`,
    "--page-margin-left": `${geometry.margins.left}px`,
    "--page-header-distance": `${layout.headerDistance * docxPagePreview.twipToPx}px`,
    "--page-footer-distance": `${layout.footerDistance * docxPagePreview.twipToPx}px`,
    "--page-content-width": `${geometry.contentWidthPx}px`,
    "--page-content-height": `${geometry.contentHeightPx}px`,
    "--page-column-count": String(geometry.columnCount),
    "--page-column-gap": `${geometry.columnGapPx}px`,
    "--page-column-template": geometry.columnTemplate,
    "--page-column-rule": layout.columns.separate && geometry.columnCount > 1 ? "1px solid #87929d" : "none",
    "--page-content-padding-top": `${Math.round(verticalOffset * 100) / 100}px`,
    "--page-border-top": showPageBorder ? pageBorderCss(pageBorders?.top) : "none",
    "--page-border-right": showPageBorder ? pageBorderCss(pageBorders?.right) : "none",
    "--page-border-bottom": showPageBorder ? pageBorderCss(pageBorders?.bottom) : "none",
    "--page-border-left": showPageBorder ? pageBorderCss(pageBorders?.left) : "none",
    "--page-border-inset-top": `${borderInset("top")}px`,
    "--page-border-inset-right": `${borderInset("right")}px`,
    "--page-border-inset-bottom": `${borderInset("bottom")}px`,
    "--page-border-inset-left": `${borderInset("left")}px`,
    "--page-border-z-index": pageBorders?.zOrder === "back" ? "0" : "4"
  } as React.CSSProperties;
}

function twipToCentimeter(value: number) {
  return Math.round((value * 2.54 / 1440) * 100) / 100;
}

function createCustomPageColumns(layout: DocumentPageLayout, count = layout.columns.count): DocumentPageColumns {
  const normalizedCount = Math.max(2, Math.min(8, Math.round(count)));
  const paperSize = layout.paperSize || a4PageTwip;
  const pageWidth = layout.orientation === "landscape" ? paperSize.height : paperSize.width;
  const availableWidth = Math.max(720, pageWidth - layout.margins.left - layout.margins.right);
  const gap = Math.min(layout.columns.space, Math.max(0, Math.floor((availableWidth - normalizedCount * 360) / (normalizedCount - 1))));
  const width = Math.max(1, Math.floor((availableWidth - gap * (normalizedCount - 1)) / normalizedCount));
  // 中文注解：切换到自定义分栏时从当前等宽结果起步，用户再逐栏微调，避免版式突然跳变。
  return {
    count: normalizedCount,
    space: gap,
    separate: layout.columns.separate,
    equalWidth: false,
    items: Array.from({ length: normalizedCount }, (_, index) => ({ width, space: index === normalizedCount - 1 ? 0 : gap }))
  };
}

function centimeterToTwip(value: string, fallback: number) {
  const centimeters = Number(value);
  return Number.isFinite(centimeters) ? Math.max(0, Math.min(Math.round(centimeters / 2.54 * 1440), 7200)) : fallback;
}

function columnWidthCentimeterToTwip(value: string, fallback: number) {
  const centimeters = Number(value);
  // 中文注解：横向 A4 的单栏可能超过 12.7 厘米，栏宽不能复用页边距的 7200 twip 上限。
  return Number.isFinite(centimeters) ? Math.max(1, Math.min(Math.round(centimeters / 2.54 * 1440), 20000)) : fallback;
}

function paperSizeCentimeterToTwip(value: string, fallback: number) {
  const centimeters = Number(value);
  return Number.isFinite(centimeters) ? Math.max(1440, Math.min(Math.round(centimeters / 2.54 * 1440), 50000)) : fallback;
}

function documentPaperSizeValue(layout: DocumentPageLayout) {
  const paperSize = layout.paperSize || a4PageTwip;
  return documentPaperSizes.find((item) => item.width === paperSize.width && item.height === paperSize.height)?.value || "custom";
}
const textColorOptions = [
  { label: "黑", value: "#17212B" },
  { label: "红", value: "#C00000" },
  { label: "蓝", value: "#1F4E79" },
  { label: "绿", value: "#245F55" }
];
const fontSizeOptions = [
  { label: "五号", value: "10.5pt" },
  { label: "小四", value: "12pt" },
  { label: "四号", value: "14pt" },
  { label: "小三", value: "15pt" },
  { label: "三号", value: "16pt" },
  { label: "二号", value: "22pt" },
  { label: "小初", value: "36pt" }
];
const fontFamilyOptions = [
  { label: "微软雅黑", value: "Microsoft YaHei" },
  { label: "宋体", value: "SimSun" },
  { label: "黑体", value: "SimHei" },
  { label: "仿宋", value: "FangSong" },
  { label: "楷体", value: "KaiTi" },
  { label: "Arial", value: "Arial" },
  { label: "Times New Roman", value: "Times New Roman" }
];
const characterSpacingOptions = [
  { label: "标准", value: "normal" },
  { label: "紧缩 1 磅", value: "-1pt" },
  { label: "紧缩 0.5 磅", value: "-0.5pt" },
  { label: "加宽 0.5 磅", value: "0.5pt" },
  { label: "加宽 1 磅", value: "1pt" },
  { label: "加宽 2 磅", value: "2pt" },
  { label: "加宽 3 磅", value: "3pt" }
];
const baselinePositionOptions = [
  { label: "标准", value: "baseline" },
  { label: "降低 3 磅", value: "-3pt" },
  { label: "降低 1.5 磅", value: "-1.5pt" },
  { label: "提升 1.5 磅", value: "1.5pt" },
  { label: "提升 3 磅", value: "3pt" }
];
const underlineStyleOptions = [
  { label: "单下划线", value: "single" },
  { label: "双下划线", value: "double" },
  { label: "点下划线", value: "dotted" },
  { label: "虚下划线", value: "dash" },
  { label: "波浪下划线", value: "wave" }
];
const underlineCssStyleByType: Record<string, string> = { single: "solid", double: "double", dotted: "dotted", dash: "dashed", wave: "wavy" };
const textBorderOptions = [
  { label: "无字符边框", value: "none" },
  { label: "细字符边框", value: "thin" },
  { label: "粗字符边框", value: "thick" },
  { label: "双字符边框", value: "double" },
  { label: "虚线字符边框", value: "dashed" }
];
const letterCaseFormatOptions = [
  { label: "标准字母", value: "normal" },
  { label: "全部大写", value: "uppercase" },
  { label: "小型大写", value: "small-caps" }
];
const paragraphStyleOptions = [
  { label: "正文", value: "paragraph" },
  { label: "标题 1", value: "heading-1" },
  { label: "标题 2", value: "heading-2" },
  { label: "标题 3", value: "heading-3" }
];
const importedInlineStyleNames = ["font-family", "font-size", "color", "font-weight", "font-style", "font-variant-caps", "text-transform", "letter-spacing", "vertical-align", "text-decoration-line", "text-decoration-style", "text-decoration-color", "--word-underline-type", "border-width", "border-style", "border-color", "border-top", "border-right", "border-bottom", "border-left", "padding", "padding-top", "padding-right", "padding-bottom", "padding-left", "--word-text-border"];
const importedBlockStyleNames = ["text-align", "text-indent", "margin-left", "margin-right", "line-height", "margin-top", "margin-bottom", "--word-line-rule"];
const lineSpacingOptions = [
  { label: "单倍", value: "1" },
  { label: "1.15 倍", value: "1.15" },
  { label: "1.5 倍", value: "1.5" },
  { label: "双倍", value: "2" }
];
const paragraphSpacingOptions = ["0pt", "6pt", "12pt", "18pt", "24pt"].map((value) => ({ label: value, value }));
const hangingIndentOptions = [
  { label: "无悬挂", value: "none" },
  { label: "0.5 厘米", value: "14.17pt" },
  { label: "1 厘米", value: "28.35pt" },
  { label: "1.5 厘米", value: "42.52pt" }
];
const paragraphSideIndentOptions = [
  { label: "0 厘米", value: "0pt" },
  { label: "0.5 厘米", value: "14.17pt" },
  { label: "1 厘米", value: "28.35pt" },
  { label: "1.5 厘米", value: "42.52pt" }
];
const orderedListFormatOptions = [
  { label: "1, 2, 3", value: "decimal" },
  { label: "I, II, III", value: "upperRoman" },
  { label: "i, ii, iii", value: "lowerRoman" },
  { label: "A, B, C", value: "upperLetter" },
  { label: "a, b, c", value: "lowerLetter" }
];
const orderedListCssTypes: Record<string, string> = {
  decimal: "decimal",
  upperRoman: "upper-roman",
  lowerRoman: "lower-roman",
  upperLetter: "upper-alpha",
  lowerLetter: "lower-alpha"
};
const tableCellVerticalAlignOptions = [
  { label: "顶部", value: "top" },
  { label: "居中", value: "center" },
  { label: "底部", value: "bottom" }
];
const tableCellPaddingOptions = [
  { label: "紧凑", value: "72" },
  { label: "标准", value: "108" },
  { label: "宽松", value: "180" }
];
const tableCellShadingOptions = [
  { label: "无底色", value: "none" },
  { label: "浅灰", value: "#F3F6F8" },
  { label: "浅绿", value: "#E8F3F0" },
  { label: "浅黄", value: "#FFF2CC" }
];
const tableCellBorderOptions = [
  { label: "默认边框", value: "default" },
  { label: "无边框", value: "none" },
  { label: "细实线", value: "thin" },
  { label: "粗实线", value: "thick" },
  { label: "虚线", value: "dashed" }
];
const paragraphShadingOptions = [
  { label: "无底纹", value: "none" },
  { label: "浅灰", value: "#F3F6F8" },
  { label: "浅绿", value: "#E8F3F0" },
  { label: "浅黄", value: "#FFF2CC" },
  { label: "浅蓝", value: "#DDEBF7" }
];
const paragraphBorderOptions = [
  { label: "无边框", value: "none" },
  { label: "细边框", value: "thin" },
  { label: "粗边框", value: "thick" },
  { label: "虚线边框", value: "dashed" },
  { label: "下边框", value: "bottom" }
];
const pageBorderStyleOptions = [
  { label: "无边框", value: "none" },
  { label: "细实线", value: "single" },
  { label: "粗实线", value: "thick" },
  { label: "双实线", value: "double" },
  { label: "虚线", value: "dashed" },
  { label: "点线", value: "dotted" }
];

function updateUniformPageBorders(current: DocumentPageBorders | null, patch: Partial<DocumentPageBorderSide> & Partial<Pick<DocumentPageBorders, "display" | "offsetFrom" | "zOrder">> & { remove?: boolean }) {
  if (patch.remove) return null;
  const normalized = normalizeDocumentPageBorders(current);
  const sample = normalized?.top || normalized?.right || normalized?.bottom || normalized?.left || { style: "single", size: 8, color: "#245F55", space: 24 };
  const border = {
    style: patch.style || sample.style,
    size: patch.size === undefined ? sample.size : patch.size,
    color: patch.color || sample.color,
    space: patch.space === undefined ? sample.space : patch.space
  };
  return normalizeDocumentPageBorders({
    display: patch.display || normalized?.display || "allPages",
    offsetFrom: patch.offsetFrom || normalized?.offsetFrom || "page",
    zOrder: patch.zOrder || normalized?.zOrder || "front",
    top: border,
    right: border,
    bottom: border,
    left: border
  });
}
const tableRowHeightOptions = [
  { label: "自动行高", value: "0" },
  { label: "0.8 cm", value: "454" },
  { label: "1.0 cm", value: "567" },
  { label: "1.5 cm", value: "850" }
];
const tableRowHeightRuleOptions = [
  { label: "最小值", value: "atLeast" },
  { label: "固定值", value: "exact" }
];

function pageTextCssStyle(style: DocumentPageTextStyle): React.CSSProperties {
  return {
    color: style.color,
    fontFamily: `"${style.fontFamily}", sans-serif`,
    fontSize: `${style.fontSizePt * 96 / 72}px`,
    fontWeight: style.bold ? 700 : 400,
    fontStyle: style.italic ? "italic" : "normal",
    textAlign: style.alignment,
    justifyContent: style.alignment === "left" ? "flex-start" : style.alignment === "right" ? "flex-end" : "center"
  };
}

function formatPageNumber(value: number, format: DocumentPageLayout["pageNumberFormat"] = "decimal") {
  // 中文注解：Word 允许分节页码从 0 开始；罗马和字母体系没有零，按 Word 可见数字保留为 0。
  if (value <= 0) return String(value);
  const alphabetic = (number: number) => {
    let result = "";
    for (let current = Math.max(1, number); current > 0; current = Math.floor((current - 1) / 26)) result = String.fromCharCode(65 + ((current - 1) % 26)) + result;
    return result;
  };
  const roman = (number: number) => {
    const values: Array<[number, string]> = [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
    let current = Math.max(1, number);
    let result = "";
    for (const [amount, label] of values) while (current >= amount) { result += label; current -= amount; }
    return result;
  };
  if (format === "upperRoman") return roman(value);
  if (format === "lowerRoman") return roman(value).toLowerCase();
  if (format === "upperLetter") return alphabetic(value);
  if (format === "lowerLetter") return alphabetic(value).toLowerCase();
  return String(value);
}

function pageNumberTemplateText(template: string, pageNumber: number, totalPages: number, defaultFormat: DocumentPageLayout["pageNumberFormat"]) {
  return String(template || "").replace(/\{(PAGE|NUMPAGES)(?::(decimal|upperRoman|lowerRoman|upperLetter|lowerLetter))?\}/g, (_match, field, explicitFormat) => {
    const value = field === "PAGE" ? pageNumber : totalPages;
    const format = explicitFormat || (field === "PAGE" ? defaultFormat : "decimal");
    return formatPageNumber(value, format);
  });
}

function PageTextFormatControls(props: {
  label: string;
  value: DocumentPageTextStyle;
  onChange: (value: DocumentPageTextStyle) => void;
}) {
  const update = (patch: Partial<DocumentPageTextStyle>) => props.onChange(normalizeDocumentPageTextStyle({ ...props.value, ...patch }));
  return <div className="page-text-format-controls" aria-label={`${props.label}格式`}>
    <select aria-label={`${props.label}字体`} value={props.value.fontFamily} onChange={(event) => update({ fontFamily: event.target.value })}>
      {!fontFamilyOptions.some((option) => option.value === props.value.fontFamily) ? <option value={props.value.fontFamily}>{props.value.fontFamily}</option> : null}
      {fontFamilyOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
    <label className="page-text-size"><span>字号</span><input type="number" aria-label={`${props.label}字号`} min="6" max="72" step="0.5" value={props.value.fontSizePt} onChange={(event) => update({ fontSizePt: Number(event.target.value) })} /></label>
    <label className="page-color-swatch" title={`${props.label}颜色`}><span>颜色</span><input type="color" aria-label={`${props.label}颜色`} value={props.value.color} onChange={(event) => update({ color: event.target.value })} /></label>
    <button type="button" className={props.value.bold ? "active-format" : ""} onClick={() => update({ bold: !props.value.bold })} title={`${props.label}加粗`} aria-label={`${props.label}加粗`}><Bold size={14} /></button>
    <button type="button" className={props.value.italic ? "active-format" : ""} onClick={() => update({ italic: !props.value.italic })} title={`${props.label}斜体`} aria-label={`${props.label}斜体`}><Italic size={14} /></button>
    <select aria-label={`${props.label}对齐`} value={props.value.alignment} onChange={(event) => update({ alignment: event.target.value as DocumentPageTextStyle["alignment"] })}>
      <option value="left">左对齐</option><option value="center">居中</option><option value="right">右对齐</option>
    </select>
  </div>;
}

function PageImageSettings(props: {
  label: string;
  images: DocumentPageImage[];
  text: string;
  onChange: (images: DocumentPageImage[]) => void;
  uploadPageImage: (file: File) => Promise<DocumentPageImage>;
}) {
  const updateImage = (id: string, patch: Partial<DocumentPageImage>) => props.onChange(props.images.map((image) => image.id === id ? { ...image, ...patch } : image));
  const upload = async (file: File | null) => {
    if (!file) return;
    const image = await props.uploadPageImage(file);
    props.onChange([...props.images, { ...image, paragraphIndex: Math.max(0, props.text.split("\n").length - 1) }]);
  };
  return <div className="page-image-settings">
    <div className="page-image-heading"><span>{props.label}图片</span><label className="page-image-upload" title={`上传${props.label}图片`}><ImageIcon size={14} />添加<input className="hidden-file-input" type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={(event) => { void upload(event.target.files?.[0] || null); event.currentTarget.value = ""; }} /></label></div>
    {props.images.map((image, index) => <div className="page-image-item" key={image.id}>
      <img src={image.src} alt={image.alt} />
      <div className="page-image-fields">
        <label>宽<input aria-label={`${props.label}图片${index + 1}宽度`} type="number" min="1" max="602" value={image.widthPx} onChange={(event) => updateImage(image.id, { widthPx: Math.max(1, Math.min(Number(event.target.value), 602)) })} /></label>
        <label>高<input aria-label={`${props.label}图片${index + 1}高度`} type="number" min="1" max="400" value={image.heightPx} onChange={(event) => updateImage(image.id, { heightPx: Math.max(1, Math.min(Number(event.target.value), 400)) })} /></label>
        <label>段落<input aria-label={`${props.label}图片${index + 1}段落`} type="number" min="1" max="50" value={image.paragraphIndex + 1} onChange={(event) => updateImage(image.id, { paragraphIndex: Math.max(0, Math.min(Math.round(Number(event.target.value)) - 1, 49)) })} /></label>
        <select aria-label={`${props.label}图片${index + 1}对齐`} value={image.alignment} onChange={(event) => updateImage(image.id, { alignment: event.target.value as DocumentPageImage["alignment"] })}><option value="left">左</option><option value="center">中</option><option value="right">右</option></select>
        <select aria-label={`${props.label}图片${index + 1}位置`} value={image.placement} onChange={(event) => updateImage(image.id, { placement: event.target.value as DocumentPageImage["placement"] })}><option value="beforeText">文字前</option><option value="afterText">文字后</option></select>
      </div>
      <button type="button" className="page-image-delete" title={`删除${props.label}图片`} aria-label={`删除${props.label}图片${index + 1}`} onClick={() => props.onChange(props.images.filter((item) => item.id !== image.id))}><Trash2 size={14} /></button>
    </div>)}
  </div>;
}

function PagePartContent(props: {
  text: string;
  images: DocumentPageImage[];
  pageNumberTemplate: string;
  pageNumberSeparate: boolean;
  pageNumber: number;
  pageCount: number;
  pageNumberFormat: DocumentPageLayout["pageNumberFormat"];
}) {
  const lines = props.text ? props.text.split("\n") : [];
  const lastImageParagraph = props.images.reduce((maximum, image) => Math.max(maximum, image.paragraphIndex), -1);
  const paragraphCount = Math.max(lines.length, lastImageParagraph + 1);
  const rows = Array.from({ length: paragraphCount }, (_, paragraphIndex) => ({
    text: lines[paragraphIndex] || "",
    images: props.images.filter((image) => image.paragraphIndex === paragraphIndex)
  }));
  const pageNumberText = pageNumberTemplateText(props.pageNumberTemplate, props.pageNumber, props.pageCount, props.pageNumberFormat);
  const renderImage = (image: DocumentPageImage) => <img key={image.id} src={image.src} alt={image.alt} style={{ width: `${image.widthPx}px`, height: `${image.heightPx}px` }} />;
  return <>
    {rows.map((row, index) => {
      const before = row.images.filter((image) => image.placement === "beforeText");
      const after = row.images.filter((image) => image.placement !== "beforeText");
      const alignment = row.images[0]?.alignment;
      const appendPageNumber = props.pageNumberTemplate && !props.pageNumberSeparate && index === rows.length - 1;
      return <div className="page-part-line" style={alignment ? { justifyContent: alignment === "left" ? "flex-start" : alignment === "right" ? "flex-end" : "center" } : undefined} key={index}>
        {before.map(renderImage)}{row.text ? <span>{row.text}</span> : null}{appendPageNumber && row.text ? <span aria-hidden="true">·</span> : null}{appendPageNumber ? <span>{pageNumberText}</span> : null}{after.map(renderImage)}
      </div>;
    })}
    {props.pageNumberTemplate && (props.pageNumberSeparate || !rows.length) ? <div className="page-part-line"><span>{pageNumberText}</span></div> : null}
  </>;
}

function PageVariantSettings(props: {
  title: string;
  variant: DocumentPageVariant;
  onChange: (variant: DocumentPageVariant) => void;
  uploadPageImage: (file: File) => Promise<DocumentPageImage>;
}) {
  const update = (patch: Partial<DocumentPageVariant>) => props.onChange(normalizeDocumentPageVariant({ ...props.variant, ...patch }, props.variant));
  const ariaPrefix = props.title === "默认页" ? "默认" : props.title;
  const pageNumberPrefix = props.title === "默认页" ? "默认" : props.title === "偶数页" ? "偶数" : props.title;
  return <>
    <strong>{props.title}</strong>
    <label>页眉<textarea aria-label={`${ariaPrefix}页眉文字`} maxLength={2000} rows={2} value={props.variant.headerText} onChange={(event) => props.onChange({ ...props.variant, headerText: event.target.value.slice(0, 2000) })} /></label>
    <PageTextFormatControls label={`${ariaPrefix}页眉`} value={props.variant.headerStyle} onChange={(headerStyle) => update({ headerStyle })} />
    <PageImageSettings label={`${ariaPrefix}页眉`} text={props.variant.headerText} images={props.variant.headerImages} onChange={(headerImages) => update({ headerImages })} uploadPageImage={props.uploadPageImage} />
    <label className="page-number-toggle"><input type="checkbox" aria-label={`${pageNumberPrefix}页眉页码`} checked={Boolean(props.variant.headerPageNumberTemplate)} onChange={(event) => update({ headerPageNumberTemplate: event.target.checked ? defaultDocumentPageNumberTemplate : "" })} />页眉页码</label>
    {props.variant.headerPageNumberTemplate ? <label>页眉页码格式<input type="text" aria-label={`${pageNumberPrefix}页眉页码格式`} maxLength={500} value={props.variant.headerPageNumberTemplate} onChange={(event) => update({ headerPageNumberTemplate: event.target.value })} /></label> : null}
    {props.variant.headerPageNumberTemplate && props.variant.headerText ? <label className="page-number-toggle"><input type="checkbox" aria-label={`${pageNumberPrefix}页眉页码独立一行`} checked={props.variant.headerPageNumberSeparate} onChange={(event) => update({ headerPageNumberSeparate: event.target.checked })} />页码独立一行</label> : null}
    <label>页脚<textarea aria-label={`${ariaPrefix}页脚文字`} maxLength={2000} rows={2} value={props.variant.footerText} onChange={(event) => props.onChange({ ...props.variant, footerText: event.target.value.slice(0, 2000) })} /></label>
    <PageTextFormatControls label={`${ariaPrefix}页脚`} value={props.variant.footerStyle} onChange={(footerStyle) => update({ footerStyle })} />
    <PageImageSettings label={`${ariaPrefix}页脚`} text={props.variant.footerText} images={props.variant.footerImages} onChange={(footerImages) => update({ footerImages })} uploadPageImage={props.uploadPageImage} />
    <label className="page-number-toggle"><input type="checkbox" aria-label={`${pageNumberPrefix}页脚页码`} checked={Boolean(props.variant.footerPageNumberTemplate)} onChange={(event) => update({ footerPageNumberTemplate: event.target.checked ? defaultDocumentPageNumberTemplate : "" })} />页脚页码</label>
    {props.variant.footerPageNumberTemplate ? <label>页脚页码格式<input type="text" aria-label={`${pageNumberPrefix}页脚页码格式`} maxLength={500} value={props.variant.footerPageNumberTemplate} onChange={(event) => update({ footerPageNumberTemplate: event.target.value })} /></label> : null}
    {props.variant.footerPageNumberTemplate && props.variant.footerText ? <label className="page-number-toggle"><input type="checkbox" aria-label={`${pageNumberPrefix}页脚页码独立一行`} checked={props.variant.footerPageNumberSeparate} onChange={(event) => update({ footerPageNumberSeparate: event.target.checked })} />页码独立一行</label> : null}
  </>;
}

function FormatSelect(props: {
  title: string;
  placeholder: string;
  options: FormatSelectOption[];
  icon?: React.ReactNode;
  disabled?: boolean;
  onSelect: (value: string, label: string) => void;
}) {
  return (
    <label className="format-select" title={props.title}>
      {props.icon}
      <select aria-label={props.placeholder} defaultValue="" disabled={props.disabled} onChange={(event) => {
        const value = event.target.value;
        const label = event.target.selectedOptions[0]?.text || value;
        if (value) props.onSelect(value, label);
        event.target.value = "";
      }}>
        <option value="">{props.placeholder}</option>
        {props.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

function pickImportedStyles(styleText: string | null, allowedNames: string[]) {
  const allowed = new Set(allowedNames);
  return String(styleText || "")
    .split(";")
    .map((item) => item.trim())
    .map((item) => {
      const separator = item.indexOf(":");
      if (separator === -1) return null;
      const name = item.slice(0, separator).trim().toLowerCase();
      const value = item.slice(separator + 1).trim().replace(/[;"<>]/g, "");
      return allowed.has(name) && value ? `${name}: ${value}` : null;
    })
    .filter(Boolean)
    .join("; ");
}

function mergeStyleText(styleText: string | null, nextStyles: Record<string, string | undefined>, allowedNames: string[]) {
  const styles = new Map<string, string>();
  pickImportedStyles(styleText, allowedNames).split(";").forEach((item) => {
    const separator = item.indexOf(":");
    if (separator === -1) return;
    const name = item.slice(0, separator).trim();
    const value = item.slice(separator + 1).trim();
    if (name && value) styles.set(name, value);
  });
  Object.entries(nextStyles).forEach(([name, value]) => {
    if (value) styles.set(name, value);
    else styles.delete(name);
  });
  return Array.from(styles.entries()).map(([name, value]) => `${name}: ${value}`).join("; ");
}

function textBorderStylePatch(value: string): Record<string, string | undefined> {
  const shorthandNames = ["border-width", "border-style", "border-color", "padding"];
  const names = [...shorthandNames, "border-top", "border-right", "border-bottom", "border-left", "padding-top", "padding-right", "padding-bottom", "padding-left", "--word-text-border"];
  if (value === "none") return Object.fromEntries(names.map((name) => [name, undefined]));
  const presets: Record<string, { type: string; size: number; css: string }> = {
    thin: { type: "single", size: 6, css: "1px solid #1F4E79" },
    thick: { type: "thick", size: 12, css: "2px solid #1F4E79" },
    double: { type: "double", size: 12, css: "2px double #1F4E79" },
    dashed: { type: "dashed", size: 8, css: "1.33px dashed #1F4E79" }
  };
  const preset = presets[value] || presets.thin;
  return {
    // 中文注解：先清除浏览器可能生成的简写，避免重新设置边框时旧样式继续覆盖四边长写法。
    ...Object.fromEntries(shorthandNames.map((name) => [name, undefined])),
    "border-top": preset.css, "border-right": preset.css, "border-bottom": preset.css, "border-left": preset.css,
    "padding-top": "1.33px", "padding-right": "1.33px", "padding-bottom": "1.33px", "padding-left": "1.33px",
    "--word-text-border": `${preset.type},${preset.size},1F4E79,1`
  };
}

function normalizeParagraphTabStops(value: unknown) {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    if (!Array.isArray(parsed)) return null;
    const stops = parsed.map((tab) => ({
      alignment: ["left", "center", "right", "decimal", "bar"].includes(String(tab?.alignment)) ? String(tab.alignment) : "left",
      position: Math.max(0, Math.min(Math.round(Number(tab?.position) || 0), 31680))
    })).filter((tab) => tab.position > 0).slice(0, 50);
    return stops.length ? JSON.stringify(stops) : null;
  } catch {
    return null;
  }
}

function normalizeDocumentTableStyle(value: unknown) {
  const declarations = String(value || "").split(";").map((item) => item.trim()).filter(Boolean);
  const styles: string[] = [];
  for (const declaration of declarations) {
    const separator = declaration.indexOf(":");
    if (separator === -1) continue;
    const name = declaration.slice(0, separator).trim().toLowerCase();
    const styleValue = declaration.slice(separator + 1).trim();
    if (name === "width" && /^\d+(?:\.\d+)?(?:px|%)$/.test(styleValue)) styles.push(`width: ${styleValue}`);
    if (name === "table-layout" && /^(?:fixed|auto)$/.test(styleValue)) styles.push(`table-layout: ${styleValue}`);
  }
  return styles.length ? styles.join("; ") : null;
}

function normalizeTableCellMargins(value: unknown) {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    const margins: Record<string, number> = {};
    for (const side of ["top", "right", "bottom", "left"]) {
      const width = Number(parsed?.[side]);
      if (Number.isFinite(width) && width >= 0 && width <= 31680) margins[side] = Math.round(width);
    }
    return Object.keys(margins).length ? JSON.stringify(margins) : null;
  } catch {
    return null;
  }
}

function normalizeTableCellStyle(value: unknown) {
  const declarations = String(value || "").split(";").map((item) => item.trim()).filter(Boolean);
  const styles: string[] = [];
  for (const declaration of declarations) {
    const separator = declaration.indexOf(":");
    if (separator === -1) continue;
    const name = declaration.slice(0, separator).trim().toLowerCase();
    const styleValue = declaration.slice(separator + 1).trim();
    if (/^padding-(?:top|right|bottom|left)$/.test(name) && /^\d+(?:\.\d+)?px$/.test(styleValue)) styles.push(`${name}: ${styleValue}`);
    if (name === "vertical-align" && /^(?:top|middle|bottom)$/.test(styleValue)) styles.push(`${name}: ${styleValue}`);
    if (name === "background-color" && /^#[0-9a-f]{6}$/i.test(styleValue)) styles.push(`${name}: ${styleValue.toUpperCase()}`);
    if (/^border-(?:top|right|bottom|left)$/.test(name) && /^(?:none|\d+(?:\.\d+)?px (?:solid|dashed|dotted|double) #[0-9a-f]{6})$/i.test(styleValue)) styles.push(`${name}: ${styleValue}`);
  }
  return styles.length ? styles.join("; ") : null;
}

function normalizeTableBorders(value: unknown, includeInside = false) {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    const result: Record<string, { style: string; size: number; color: string }> = {};
    const sides = includeInside ? ["top", "right", "bottom", "left", "insideHorizontal", "insideVertical"] : ["top", "right", "bottom", "left"];
    const styles = new Set(["single", "dashed", "dashSmallGap", "dotted", "dotDash", "dotDotDash", "double", "thick", "none", "nil"]);
    for (const side of sides) {
      const border = parsed?.[side];
      if (!border || !styles.has(String(border.style))) continue;
      const size = Math.max(0, Math.min(96, Math.round(Number(border.size) || 0)));
      const color = /^#[0-9a-f]{6}$/i.test(String(border.color || "")) ? String(border.color).toUpperCase() : "#000000";
      result[side] = { style: String(border.style), size, color };
    }
    return Object.keys(result).length ? JSON.stringify(result) : null;
  } catch {
    return null;
  }
}

function tableBorderPreset(value: string) {
  if (value === "default") return null;
  const border = value === "none"
    ? { style: "nil", size: 0, color: "#000000" }
    : value === "thick"
      ? { style: "single", size: 12, color: "#000000" }
      : value === "dashed"
        ? { style: "dashed", size: 6, color: "#6B7280" }
        : { style: "single", size: 4, color: "#000000" };
  return normalizeTableBorders(Object.fromEntries(["top", "right", "bottom", "left"].map((side) => [side, border])));
}

function tableCellStyle(cellMargins: string | null, verticalAlign: string, shading: string, cellBorders: string | null = null) {
  const styles: string[] = [];
  try {
    const margins = JSON.parse(cellMargins || "{}");
    for (const side of ["top", "right", "bottom", "left"]) {
      if (Number.isFinite(Number(margins[side]))) styles.push(`padding-${side}: ${Math.round(Number(margins[side]) * 96 / 1440 * 100) / 100}px`);
    }
  } catch {
    // 中文注解：损坏的历史属性不应阻断表格继续编辑，忽略后由用户重新设置。
  }
  if (["top", "center", "bottom"].includes(verticalAlign)) styles.push(`vertical-align: ${verticalAlign === "center" ? "middle" : verticalAlign}`);
  if (/^#[0-9a-f]{6}$/i.test(shading)) styles.push(`background-color: ${shading.toUpperCase()}`);
  try {
    const borders = JSON.parse(cellBorders || "{}");
    for (const side of ["top", "right", "bottom", "left"]) {
      const border = borders[side];
      if (!border) continue;
      if (["none", "nil"].includes(border.style) || border.size <= 0) styles.push(`border-${side}: none`);
      else {
        const cssStyle = border.style === "double" ? "double" : border.style === "dotted" ? "dotted" : border.style.includes("dash") || border.style.startsWith("dot") ? "dashed" : "solid";
        styles.push(`border-${side}: ${Math.round(Number(border.size) / 6 * 100) / 100}px ${cssStyle} ${border.color}`);
      }
    }
  } catch {
    // 中文注解：历史边框数据损坏时保留默认网格，不阻断文档编辑。
  }
  return styles.length ? styles.join("; ") : null;
}

function normalizeParagraphShading(value: unknown) {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    const fill = /^#[0-9a-f]{6}$/i.test(String(parsed?.fill || "")) ? String(parsed.fill).toUpperCase() : "";
    if (!fill) return null;
    const color = /^#[0-9a-f]{6}$/i.test(String(parsed?.color || "")) ? String(parsed.color).toUpperCase() : "#000000";
    const type = /^[A-Za-z0-9]+$/.test(String(parsed?.type || "")) ? String(parsed.type) : "clear";
    return JSON.stringify({ fill, color, type });
  } catch {
    return null;
  }
}

function normalizeParagraphBorders(value: unknown) {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    const result: Record<string, { style: string; size: number; color: string; space: number }> = {};
    const styles = new Set(["single", "dashed", "dashSmallGap", "dotted", "dotDash", "dotDotDash", "double", "thick", "none", "nil"]);
    for (const side of ["top", "right", "bottom", "left", "between"]) {
      const border = parsed?.[side];
      if (!border || !styles.has(String(border.style))) continue;
      const size = Math.max(0, Math.min(96, Math.round(Number(border.size) || 0)));
      const color = /^#[0-9a-f]{6}$/i.test(String(border.color || "")) ? String(border.color).toUpperCase() : "#000000";
      const space = Math.max(0, Math.min(31, Math.round(Number(border.space) || 0)));
      result[side] = { style: String(border.style), size, color, space };
    }
    return Object.keys(result).length ? JSON.stringify(result) : null;
  } catch {
    return null;
  }
}

function paragraphBorderPreset(value: string) {
  if (value === "none") return null;
  const border = value === "thick"
    ? { style: "single", size: 12, color: "#000000", space: 4 }
    : value === "dashed"
      ? { style: "dashed", size: 6, color: "#6B7280", space: 3 }
      : { style: "single", size: 4, color: "#000000", space: 3 };
  const sides = value === "bottom" ? ["bottom"] : ["top", "right", "bottom", "left"];
  return normalizeParagraphBorders(Object.fromEntries(sides.map((side) => [side, border])));
}

function paragraphAppearanceStyle(shadingValue: unknown, bordersValue: unknown) {
  const styles: string[] = [];
  try {
    const shading = JSON.parse(normalizeParagraphShading(shadingValue) || "{}");
    if (shading.fill) styles.push(`background-color: ${shading.fill}`);
  } catch {
    // 中文注解：历史底纹数据损坏时不渲染该属性，避免影响正文编辑。
  }
  try {
    const borders = JSON.parse(normalizeParagraphBorders(bordersValue) || "{}");
    for (const side of ["top", "right", "bottom", "left"]) {
      const border = borders[side];
      if (!border) continue;
      if (["none", "nil"].includes(border.style) || border.size <= 0) styles.push(`border-${side}: none`);
      else {
        const cssStyle = border.style === "double" ? "double" : border.style === "dotted" ? "dotted" : border.style.includes("dash") || border.style.startsWith("dot") ? "dashed" : "solid";
        styles.push(`border-${side}: ${Math.round(border.size / 6 * 100) / 100}px ${cssStyle} ${border.color}`);
      }
      if (border.space > 0) styles.push(`padding-${side}: ${Math.round(border.space * 96 / 72 * 100) / 100}px`);
    }
  } catch {
    // 中文注解：历史边框数据损坏时忽略外观，语义字段可由用户重新设置。
  }
  return styles.length ? styles.join("; ") : null;
}

const ImportedTextStyle = Mark.create({
  name: "importedTextStyle",
  addAttributes() {
    return {
      style: {
        default: null,
        parseHTML: (element) => pickImportedStyles(element.getAttribute("style"), importedInlineStyleNames) || null,
        renderHTML: (attributes) => {
          // 中文注解：只把导入文档的字体类样式写回 HTML，避免保存时夹带任意内联 CSS。
          const style = pickImportedStyles(attributes.style, importedInlineStyleNames);
          return style ? { style } : {};
        }
      }
    };
  },
  parseHTML() {
    return [{ tag: "span[style]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", HTMLAttributes, 0];
  }
});

const highlightColors: Record<string, string> = {
  yellow: "#FFFF00",
  green: "#00FF00",
  cyan: "#00FFFF",
  magenta: "#FF00FF",
  red: "#FF0000",
  blue: "#0000FF",
  darkYellow: "#808000",
  darkGreen: "#008000",
  darkCyan: "#008080",
  darkBlue: "#000080",
  darkMagenta: "#800080",
  darkRed: "#800000",
  lightGray: "#C0C0C0",
  darkGray: "#808080",
  black: "#000000",
  white: "#FFFFFF"
};
const highlightColorOptions = [
  { label: "清除高亮", value: "none" },
  { label: "黄色", value: "yellow" },
  { label: "绿色", value: "green" },
  { label: "青色", value: "cyan" },
  { label: "洋红", value: "magenta" },
  { label: "红色", value: "red" },
  { label: "蓝色", value: "blue" },
  { label: "深黄色", value: "darkYellow" },
  { label: "深绿色", value: "darkGreen" },
  { label: "深青色", value: "darkCyan" },
  { label: "深蓝色", value: "darkBlue" },
  { label: "深洋红", value: "darkMagenta" },
  { label: "深红色", value: "darkRed" },
  { label: "浅灰色", value: "lightGray" },
  { label: "深灰色", value: "darkGray" },
  { label: "黑色", value: "black" },
  { label: "白色", value: "white" }
];

const TextHighlight = Mark.create({
  name: "textHighlight",
  addAttributes() {
    return {
      color: {
        default: "yellow",
        parseHTML: (element) => Object.prototype.hasOwnProperty.call(highlightColors, element.getAttribute("data-highlight") || "") ? element.getAttribute("data-highlight") : "yellow",
        renderHTML: (attributes) => {
          const color = Object.prototype.hasOwnProperty.call(highlightColors, attributes.color) ? attributes.color : "yellow";
          return { "data-highlight": color, style: `background-color: ${highlightColors[color]}` };
        }
      }
    };
  },
  parseHTML() {
    return [{ tag: "mark[data-highlight]" }, { tag: "mark" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["mark", HTMLAttributes, 0];
  }
});

const SuperscriptText = Mark.create({
  name: "superscriptText",
  excludes: "subscriptText",
  parseHTML: () => [{ tag: "sup" }],
  renderHTML: () => ["sup", 0]
});

const SubscriptText = Mark.create({
  name: "subscriptText",
  excludes: "superscriptText",
  parseHTML: () => [{ tag: "sub" }],
  renderHTML: () => ["sub", 0]
});

const DocxTab = TiptapNode.create({
  name: "docxTab",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      positionTwip: {
        default: 720,
        parseHTML: (element) => Math.max(1, Math.min(Math.round(Number(element.getAttribute("data-tab-position")) || 720), 31680)),
        renderHTML: (attributes) => ({ "data-tab-position": Math.max(1, Math.min(Math.round(Number(attributes.positionTwip) || 720), 31680)) })
      },
      alignment: {
        default: "left",
        parseHTML: (element) => ["left", "center", "right", "decimal", "bar"].includes(element.getAttribute("data-tab-alignment") || "") ? element.getAttribute("data-tab-alignment") : "left",
        renderHTML: (attributes) => ({ "data-tab-alignment": ["left", "center", "right", "decimal", "bar"].includes(attributes.alignment) ? attributes.alignment : "left" })
      }
    };
  },
  parseHTML() {
    return [{ tag: 'span[data-docx-tab="true"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", { ...HTMLAttributes, "data-docx-tab": "true", class: "docx-tab" }];
  },
  addKeyboardShortcuts() {
    return {
      Tab: () => {
        // 中文注解：表格内的 Tab 继续交给表格扩展切换单元格，正文中才插入 Word 制表符。
        if (this.editor.isActive("table")) return false;
        return this.editor.commands.insertContent({ type: this.name, attrs: { positionTwip: 720, alignment: "left" } });
      }
    };
  }
});

class DocumentTableView extends TableView {
  constructor(node: ProseMirrorNode, cellMinWidth: number, view?: EditorView, HTMLAttributes: Record<string, unknown> = {}) {
    super(node, cellMinWidth, view, HTMLAttributes);
    this.applyDocumentGeometry(node);
  }

  update(node: ProseMirrorNode) {
    const updated = super.update(node);
    if (updated) this.applyDocumentGeometry(node);
    return updated;
  }

  private applyDocumentGeometry(node: ProseMirrorNode) {
    const style = normalizeDocumentTableStyle(node.attrs.style);
    if (!style) return;
    // 中文注解：Tiptap 的可调整列宽视图会重写 table.width，这里重新应用 Word 原表宽，确保编辑态和分页态一致。
    this.table.style.cssText = style;
  }
}

const DocumentTable = Table.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      style: {
        default: null,
        parseHTML: (element) => normalizeDocumentTableStyle(element.getAttribute("style")),
        renderHTML: (attributes) => {
          const style = normalizeDocumentTableStyle(attributes.style);
          return style ? { style } : {};
        }
      },
      tableWidthType: {
        default: "auto",
        parseHTML: (element) => ["dxa", "pct", "auto"].includes(element.getAttribute("data-table-width-type") || "") ? element.getAttribute("data-table-width-type") : "auto",
        renderHTML: (attributes) => ({ "data-table-width-type": ["dxa", "pct", "auto"].includes(attributes.tableWidthType) ? attributes.tableWidthType : "auto" })
      },
      tableWidthValue: {
        default: 0,
        parseHTML: (element) => Math.max(0, Math.round(Number(element.getAttribute("data-table-width-value")) || 0)),
        renderHTML: (attributes) => ({ "data-table-width-value": Math.max(0, Math.round(Number(attributes.tableWidthValue) || 0)) })
      },
      tableGridWidth: {
        default: 0,
        parseHTML: (element) => Math.max(0, Math.round(Number(element.getAttribute("data-table-grid-width")) || 0)),
        renderHTML: (attributes) => ({ "data-table-grid-width": Math.max(0, Math.round(Number(attributes.tableGridWidth) || 0)) })
      },
      tableLayout: {
        default: "autofit",
        parseHTML: (element) => element.getAttribute("data-table-layout") === "fixed" ? "fixed" : "autofit",
        renderHTML: (attributes) => ({ "data-table-layout": attributes.tableLayout === "fixed" ? "fixed" : "autofit" })
      },
      tableBorders: {
        default: null,
        parseHTML: (element) => normalizeTableBorders(element.getAttribute("data-table-borders"), true),
        renderHTML: (attributes) => {
          const borders = normalizeTableBorders(attributes.tableBorders, true);
          return borders ? { "data-table-borders": borders } : {};
        }
      }
    };
  }
}).configure({ resizable: true, View: DocumentTableView });

function documentTableCellAttributes() {
  return {
    importedCell: {
      default: false,
      parseHTML: (element: HTMLElement) => element.getAttribute("data-docx-cell") === "true",
      renderHTML: (attributes: Record<string, unknown>) => attributes.importedCell ? { "data-docx-cell": "true" } : {}
    },
    cellMargins: {
      default: null,
      parseHTML: (element: HTMLElement) => normalizeTableCellMargins(element.getAttribute("data-cell-margins")),
      renderHTML: (attributes: Record<string, unknown>) => {
        const margins = normalizeTableCellMargins(attributes.cellMargins);
        return margins ? { "data-cell-margins": margins } : {};
      }
    },
    cellVerticalAlign: {
      default: null,
      parseHTML: (element: HTMLElement) => ["top", "center", "bottom"].includes(element.getAttribute("data-cell-vertical-align") || "") ? element.getAttribute("data-cell-vertical-align") : null,
      renderHTML: (attributes: Record<string, unknown>) => ["top", "center", "bottom"].includes(String(attributes.cellVerticalAlign)) ? { "data-cell-vertical-align": attributes.cellVerticalAlign } : {}
    },
    cellShading: {
      default: null,
      parseHTML: (element: HTMLElement) => /^#[0-9a-f]{6}$/i.test(element.getAttribute("data-cell-shading") || "") ? element.getAttribute("data-cell-shading")?.toUpperCase() : null,
      renderHTML: (attributes: Record<string, unknown>) => /^#[0-9a-f]{6}$/i.test(String(attributes.cellShading || "")) ? { "data-cell-shading": String(attributes.cellShading).toUpperCase() } : {}
    },
    cellBorders: {
      default: null,
      parseHTML: (element: HTMLElement) => normalizeTableBorders(element.getAttribute("data-cell-borders")),
      renderHTML: (attributes: Record<string, unknown>) => {
        const borders = normalizeTableBorders(attributes.cellBorders);
        return borders ? { "data-cell-borders": borders } : {};
      }
    },
    style: {
      default: null,
      parseHTML: (element: HTMLElement) => normalizeTableCellStyle(element.getAttribute("style")),
      renderHTML: (attributes: Record<string, unknown>) => {
        const semanticStyle = tableCellStyle(
          normalizeTableCellMargins(attributes.cellMargins),
          String(attributes.cellVerticalAlign || ""),
          String(attributes.cellShading || ""),
          normalizeTableBorders(attributes.cellBorders)
        );
        // 中文注解：合并、拆分单元格后 Tiptap 可能重建通用 style，优先由 Word 语义属性还原完整视觉格式。
        const style = semanticStyle || normalizeTableCellStyle(attributes.style);
        return style ? { style } : {};
      }
    }
  };
}

const DocumentTableCell = TableCell.extend({
  addAttributes() {
    return { ...this.parent?.(), ...documentTableCellAttributes() };
  }
});

const DocumentTableHeader = TableHeader.extend({
  addAttributes() {
    return { ...this.parent?.(), ...documentTableCellAttributes() };
  }
});

const DocumentTableRow = TableRow.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      rowHeight: {
        default: 0,
        parseHTML: (element) => Math.max(0, Math.min(31680, Math.round(Number(element.getAttribute("data-row-height")) || 0))),
        renderHTML: (attributes) => {
          const height = Math.max(0, Math.min(31680, Math.round(Number(attributes.rowHeight) || 0)));
          return height ? { "data-row-height": height, style: `height: ${Math.round(height * 96 / 1440 * 100) / 100}px` } : {};
        }
      },
      rowHeightRule: {
        default: "auto",
        parseHTML: (element) => ["exact", "atLeast"].includes(element.getAttribute("data-row-height-rule") || "") ? element.getAttribute("data-row-height-rule") : "auto",
        renderHTML: (attributes) => ["exact", "atLeast"].includes(String(attributes.rowHeightRule)) ? { "data-row-height-rule": attributes.rowHeightRule } : {}
      },
      rowCantSplit: {
        default: false,
        parseHTML: (element) => element.getAttribute("data-row-cant-split") === "true",
        renderHTML: (attributes) => attributes.rowCantSplit ? { "data-row-cant-split": "true" } : {}
      },
      rowRepeatHeader: {
        default: false,
        parseHTML: (element) => element.getAttribute("data-row-repeat-header") === "true",
        renderHTML: (attributes) => attributes.rowRepeatHeader ? { "data-row-repeat-header": "true" } : {}
      }
    };
  }
});

const ListFormatAttributes = Extension.create({
  name: "listFormatAttributes",
  addGlobalAttributes() {
    return [{
      types: ["orderedList"],
      attributes: {
        listFormat: {
          default: "decimal",
          parseHTML: (element) => Object.hasOwn(orderedListCssTypes, element.getAttribute("data-list-format") || "") ? element.getAttribute("data-list-format") : "decimal",
          renderHTML: (attributes) => {
            const format = Object.hasOwn(orderedListCssTypes, attributes.listFormat) ? attributes.listFormat : "decimal";
            // 中文注解：受控语义值供 DOCX 导出使用，CSS list-style-type 负责编辑态和分页态的编号外观。
            return { "data-list-format": format, style: `list-style-type: ${orderedListCssTypes[format]}` };
          }
        }
      }
    }];
  }
});

const ParagraphIndent = Extension.create({
  name: "paragraphIndent",
  addGlobalAttributes() {
    return [
      {
        types: ["paragraph", "heading"],
        attributes: {
          importedStyle: {
            default: null,
            parseHTML: (element) => pickImportedStyles(element.getAttribute("style"), importedBlockStyleNames) || null,
            renderHTML: (attributes) => {
              // 中文注解：段落级样式用于恢复 Word 对齐、缩进和行距，不参与普通编辑按钮状态。
              const style = pickImportedStyles(attributes.importedStyle, importedBlockStyleNames);
              return style ? { style } : {};
            }
          },
          indent: {
            default: 0,
            parseHTML: (element) => {
              const dataIndent = Number(element.getAttribute("data-indent") || 0);
              const styleIndent = Number(element.style.getPropertyValue("--indent-level") || 0);
              const textIndent = element.style.textIndent || "";
              const emIndent = textIndent.endsWith("em") ? Math.round(Number.parseFloat(textIndent) / 2) : 0;
              // 中文注解：兼容旧数据里的内联样式，重新打开文档时尽量恢复首行缩进。
              return Math.max(0, Math.min(dataIndent || styleIndent || emIndent || 0, maxIndentLevel));
            },
            renderHTML: (attributes) => {
              const indent = Math.max(0, Math.min(Number(attributes.indent || 0), maxIndentLevel));
              return indent ? { "data-indent": indent, style: `--indent-level: ${indent};` } : {};
            }
          },
          keepNext: {
            default: false,
            parseHTML: (element) => element.getAttribute("data-keep-next") === "true",
            renderHTML: (attributes) => attributes.keepNext ? { "data-keep-next": "true" } : {}
          },
          keepLines: {
            default: false,
            parseHTML: (element) => element.getAttribute("data-keep-lines") === "true",
            renderHTML: (attributes) => attributes.keepLines ? { "data-keep-lines": "true" } : {}
          },
          pageBreakBefore: {
            default: false,
            parseHTML: (element) => element.getAttribute("data-page-break-before") === "true",
            renderHTML: (attributes) => attributes.pageBreakBefore ? { "data-page-break-before": "true" } : {}
          },
          widowControl: {
            default: true,
            parseHTML: (element) => element.getAttribute("data-widow-control") !== "false",
            // 中文注解：显式保存 true/false，导入文件关闭孤行控制时重新打开后不能被默认值覆盖。
            renderHTML: (attributes) => ({ "data-widow-control": attributes.widowControl === false ? "false" : "true" })
          },
          tabStops: {
            default: null,
            parseHTML: (element) => normalizeParagraphTabStops(element.getAttribute("data-tab-stops")),
            renderHTML: (attributes) => {
              const tabStops = normalizeParagraphTabStops(attributes.tabStops);
              return tabStops ? { "data-tab-stops": tabStops } : {};
            }
          },
          paragraphShading: {
            default: null,
            parseHTML: (element) => normalizeParagraphShading(element.getAttribute("data-paragraph-shading")),
            renderHTML: (attributes) => {
              const shading = normalizeParagraphShading(attributes.paragraphShading);
              const style = paragraphAppearanceStyle(shading, null);
              return shading ? { "data-paragraph-shading": shading, ...(style ? { style } : {}) } : {};
            }
          },
          paragraphBorders: {
            default: null,
            parseHTML: (element) => normalizeParagraphBorders(element.getAttribute("data-paragraph-borders")),
            renderHTML: (attributes) => {
              const borders = normalizeParagraphBorders(attributes.paragraphBorders);
              const style = paragraphAppearanceStyle(null, borders);
              // 中文注解：语义 JSON 供 DOCX 导出使用，CSS 供编辑视图和分页预览使用，两者同时更新。
              return borders ? { "data-paragraph-borders": borders, ...(style ? { style } : {}) } : {};
            }
          }
        }
      }
    ];
  },
  addCommands() {
    const updateSelectedTextblocks = (
      state: CommandProps["state"],
      tr: CommandProps["tr"],
      dispatch: CommandProps["dispatch"],
      updateAttributes: (node: ProseMirrorNode) => Record<string, unknown> | null
    ) => {
      let changed = false;
      const { from, to, empty, $from } = state.selection;
      const updateNode = (node: ProseMirrorNode, position: number) => {
        if (!["paragraph", "heading"].includes(node.type.name)) return;
        const nextAttributes = updateAttributes(node);
        if (!nextAttributes) return;
        tr.setNodeMarkup(position, undefined, { ...node.attrs, ...nextAttributes });
        changed = true;
      };

      state.doc.nodesBetween(from, to, updateNode);
      if (!changed && empty) {
        for (let depth = $from.depth; depth > 0; depth -= 1) {
          const node = $from.node(depth);
          if (!["paragraph", "heading"].includes(node.type.name)) continue;
          updateNode(node, $from.before(depth));
          break;
        }
      }

      if (changed && dispatch) dispatch(tr);
      return changed;
    };

    const updateSelectedParagraphIndent = (
      state: CommandProps["state"],
      tr: CommandProps["tr"],
      dispatch: CommandProps["dispatch"],
      resolveNext: (current: number) => number
    ) => {
      let changed = false;
      const { from, to, empty, $from } = state.selection;
      const updateNode = (node: ProseMirrorNode, position: number) => {
        if (node.type.name !== "paragraph") return;
        const current = Number(node.attrs.indent || 0);
        const next = Math.max(0, Math.min(resolveNext(current), maxIndentLevel));
        const currentImportedStyle = String(node.attrs.importedStyle || "");
        const importedStyle = mergeStyleText(currentImportedStyle, {
          "text-indent": undefined,
          // 中文注解：普通左缩进可以与首行缩进共存；只有从悬挂缩进切换时才成对清除左边距。
          ...(/(?:^|;)\s*text-indent\s*:\s*-/i.test(currentImportedStyle) ? { "margin-left": undefined } : {})
        }, importedBlockStyleNames);
        if (next === current && importedStyle === String(node.attrs.importedStyle || "")) return;
        // 中文注解：首行缩进与悬挂缩进互斥，使用首行按钮时同步清除悬挂缩进的负偏移和左边距。
        tr.setNodeMarkup(position, undefined, { ...node.attrs, indent: next, importedStyle });
        changed = true;
      };

      // 中文注解：选区内可能跨多个段落，首行缩进只应用到正文段落，不移动标题。
      state.doc.nodesBetween(from, to, updateNode);

      // 中文注解：光标没有选中文本时，主动回退到当前段落，方便像 Word 一样调试格式。
      if (!changed && empty) {
        for (let depth = $from.depth; depth > 0; depth -= 1) {
          const node = $from.node(depth);
          if (node.type.name !== "paragraph") continue;
          updateNode(node, $from.before(depth));
          break;
        }
      }

      if (changed && dispatch) dispatch(tr);
      return changed;
    };

    return {
      increaseIndent:
        () =>
        ({ state, tr, dispatch }) => updateSelectedParagraphIndent(state, tr, dispatch, (current) => current + 1),
      decreaseIndent:
        () =>
        ({ state, tr, dispatch }) => updateSelectedParagraphIndent(state, tr, dispatch, (current) => current - 1),
      setFirstLineIndent:
        (level = 1) =>
        ({ state, tr, dispatch }) => updateSelectedParagraphIndent(state, tr, dispatch, () => level),
      setParagraphAlignment:
        (alignment = "left") =>
        ({ state, tr, dispatch }: CommandProps) => updateSelectedTextblocks(state, tr, dispatch, (node) => {
          // 中文注解：对齐写入段落级安全样式，分页预览和 DOCX 导出会复用同一份格式。
          const importedStyle = mergeStyleText(String(node.attrs.importedStyle || ""), { "text-align": alignment }, importedBlockStyleNames);
          return { importedStyle };
        }),
      setParagraphSpacing:
        (styles) =>
        ({ state, tr, dispatch }: CommandProps) => updateSelectedTextblocks(state, tr, dispatch, (node) => {
          // 中文注解：行距、段前和段后统一保存在段落安全样式中，编辑视图、分页预览和导出共用同一数据源。
          const importedStyle = mergeStyleText(String(node.attrs.importedStyle || ""), styles, importedBlockStyleNames);
          // 中文注解：悬挂缩进使用显式 text-indent，应用时清除旧的 data-indent，避免导出同时出现 firstLine 与 hanging。
          return { importedStyle, ...(Object.hasOwn(styles, "text-indent") ? { indent: 0 } : {}) };
        }),
      setParagraphAppearance:
        (patch) =>
        ({ state, tr, dispatch }: CommandProps) => updateSelectedTextblocks(state, tr, dispatch, (node) => ({
          paragraphShading: patch.shading === undefined ? node.attrs.paragraphShading : normalizeParagraphShading(patch.shading),
          paragraphBorders: patch.borders === undefined ? node.attrs.paragraphBorders : normalizeParagraphBorders(patch.borders)
        })),
      toggleParagraphPagination:
        (attribute) =>
        ({ state, tr, dispatch }: CommandProps) => {
          const selectedValues: boolean[] = [];
          state.doc.nodesBetween(state.selection.from, state.selection.to, (node) => {
            if (["paragraph", "heading"].includes(node.type.name)) selectedValues.push(Boolean(node.attrs[attribute]));
          });
          if (!selectedValues.length && state.selection.empty) {
            for (let depth = state.selection.$from.depth; depth > 0; depth -= 1) {
              const node = state.selection.$from.node(depth);
              if (!["paragraph", "heading"].includes(node.type.name)) continue;
              selectedValues.push(Boolean(node.attrs[attribute]));
              break;
            }
          }
          const nextValue = !selectedValues.some(Boolean);
          // 中文注解：多段选区按 Word 的统一开关处理；只要选区内已有启用项，再次点击就统一关闭。
          return updateSelectedTextblocks(state, tr, dispatch, () => ({ [attribute]: nextValue }));
        }
    };
  }
});

const PageBreak = TiptapNode.create({
  name: "pageBreak",
  group: "block",
  atom: true,
  selectable: true,
  parseHTML() {
    return [{ tag: 'div[data-page-break="true"]' }];
  },
  renderHTML() {
    // 中文注解：分页符作为独立块保存，分页预览和后端 DOCX 导出都用同一个标记识别强制分页。
    return ["div", { "data-page-break": "true", class: "page-break-marker" }];
  }
});

const SectionBreak = TiptapNode.create({
  name: "sectionBreak",
  group: "block",
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      pageLayout: {
        default: JSON.stringify(defaultDocumentPageLayout),
        parseHTML: (element) => element.getAttribute("data-section-layout") || JSON.stringify(defaultDocumentPageLayout),
        renderHTML: (attributes) => ({ "data-section-layout": String(attributes.pageLayout || JSON.stringify(defaultDocumentPageLayout)) })
      },
      breakType: {
        default: "nextPage",
        parseHTML: (element) => normalizeSectionBreakType(element.getAttribute("data-section-break")),
        renderHTML: (attributes) => ({ "data-section-break": normalizeSectionBreakType(attributes.breakType) })
      }
    };
  },
  parseHTML() {
    return [{ tag: "div[data-section-break]" }];
  },
  renderHTML({ HTMLAttributes }) {
    // 中文注解：分节符携带下一节完整页面设置，保存、分页预览和 DOCX 导出都从同一节点读取。
    return ["div", { ...HTMLAttributes, class: "section-break-marker" }];
  }
});

function escapeHtml(text: string) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function stripHtml(value = "") {
  return value.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ");
}

function plainTextToHtml(text: string) {
  const html = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => (/^(\d+[.])/.test(line) ? `<h2>${escapeHtml(line)}</h2>` : `<p>${escapeHtml(line)}</p>`))
    .join("");
  return html || "<p></p>";
}

function textToParagraphHtml(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join("");
}

function aiResultToHtml(text: string) {
  // 中文注解：AI 常返回多行文本，应用到编辑器时必须转成段落，否则保存和导出会丢失段落结构。
  return text.includes("\n") ? textToParagraphHtml(text) : escapeHtml(text);
}

function buildExportPreviewHtml(title: string, content: string) {
  // 中文注解：后端导出会把文档标题作为 Word 标题段落写入，这里同步显示，避免预览少一段。
  return `<h1 class="export-title">${escapeHtml(title || "未命名文档")}</h1>${content || "<p></p>"}`;
}

function blockOuterHtml(element: Element) {
  return element.outerHTML || `<p>${escapeHtml(element.textContent || "")}</p>`;
}

function measuredBlockHeight(element: Element | null) {
  if (!(element instanceof HTMLElement)) return 0;
  const styles = window.getComputedStyle(element);
  return element.getBoundingClientRect().height
    + Number.parseFloat(styles.marginTop || "0")
    + Number.parseFloat(styles.marginBottom || "0");
}

function measureTabFollowingContent(tab: HTMLElement, paragraph: HTMLElement, nextTab?: HTMLElement) {
  const range = document.createRange();
  range.setStartAfter(tab);
  if (nextTab) range.setEndBefore(nextTab);
  else range.setEnd(paragraph, paragraph.childNodes.length);
  const probe = document.createElement("span");
  const style = window.getComputedStyle(tab);
  probe.style.position = "fixed";
  probe.style.left = "-10000px";
  probe.style.top = "0";
  probe.style.visibility = "hidden";
  probe.style.whiteSpace = "nowrap";
  probe.style.font = style.font;
  probe.style.letterSpacing = style.letterSpacing;
  probe.append(range.cloneContents());
  document.body.append(probe);
  const width = probe.getBoundingClientRect().width;
  const decimalText = (probe.textContent || "").split(/[.,]/)[0];
  probe.replaceChildren(document.createTextNode(decimalText));
  const decimalWidth = probe.getBoundingClientRect().width;
  probe.remove();
  return { width, decimalWidth };
}

function layoutDocxTabs(root: ParentNode) {
  const paragraphs = Array.from(root.querySelectorAll<HTMLElement>("p, h1, h2, h3, li")).filter((paragraph) => paragraph.querySelector(".docx-tab"));
  for (const paragraph of paragraphs) {
    const tabs = Array.from(paragraph.querySelectorAll<HTMLElement>(".docx-tab"));
    tabs.forEach((tab) => { tab.style.width = "0px"; });
    for (const [index, tab] of tabs.entries()) {
      const paragraphRect = paragraph.getBoundingClientRect();
      const tabRect = tab.getBoundingClientRect();
      const currentX = Math.max(0, tabRect.left - paragraphRect.left);
      const interval = 720 * 96 / 1440;
      let target = Math.max(interval, Number(tab.dataset.tabPosition || 720) * 96 / 1440);
      while (target <= currentX + 1) target += interval;
      const alignment = tab.dataset.tabAlignment || "left";
      // 中文注解：下一制表位必须按文档顺序确定；坐标比较在换行或两个零宽节点重叠时会选错目标。
      const following = measureTabFollowingContent(tab, paragraph, tabs[index + 1]);
      const alignmentOffset = alignment === "right" ? following.width
        : alignment === "center" ? following.width / 2
          : alignment === "decimal" ? following.decimalWidth
            : 0;
      let width = target - alignmentOffset - currentX;
      if (width < 2) width = target + interval - alignmentOffset - currentX;
      tab.style.width = `${Math.max(2, Math.round(width * 100) / 100)}px`;
    }
  }
}

function textBoundary(root: Element, targetOffset: number) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let consumed = 0;
  let current = walker.nextNode();
  let lastTextNode: Text | null = null;
  while (current) {
    const textNode = current as Text;
    const nextConsumed = consumed + textNode.data.length;
    if (targetOffset <= nextConsumed) return { node: textNode, offset: Math.max(0, targetOffset - consumed) };
    consumed = nextConsumed;
    lastTextNode = textNode;
    current = walker.nextNode();
  }
  return lastTextNode ? { node: lastTextNode, offset: lastTextNode.data.length } : null;
}

function textBlockFragmentHtml(element: Element, start: number, end: number, isContinuation: boolean, isFinal: boolean) {
  const startBoundary = textBoundary(element, start);
  const endBoundary = textBoundary(element, end);
  if (!startBoundary || !endBoundary) return "";
  const range = document.createRange();
  range.setStart(startBoundary.node, startBoundary.offset);
  range.setEnd(endBoundary.node, endBoundary.offset);
  const clone = element.cloneNode(false) as HTMLElement;
  clone.append(range.cloneContents());
  // 中文注解：同一段跨页时不能重复计算段前、段后间距，否则在线页码会比 Word 更早换页。
  if (isContinuation) clone.style.marginTop = "0px";
  if (!isFinal) clone.style.marginBottom = "0px";
  return clone.outerHTML;
}

function structuredBlockItemCount(element: Element) {
  if (element.matches("ol, ul")) return Array.from(element.children).filter((child) => child.matches("li")).length;
  if (element.matches("table")) return element.querySelectorAll("tr").length;
  return 0;
}

function prependRepeatingTableHeaderRows(sourceTable: Element, clonedTable: HTMLElement, firstSourceRowIndex: number) {
  if (!sourceTable.matches("table") || firstSourceRowIndex <= 0) return;
  const sourceRows = Array.from(sourceTable.querySelectorAll("tr"));
  const repeatingRows: Element[] = [];
  // 中文注解：Word 只重复表格顶部连续标记为 tblHeader 的行，中间断开后不能继续重复。
  for (const row of sourceRows) {
    if ((row as HTMLElement).dataset.rowRepeatHeader === "true") repeatingRows.push(row);
    else break;
  }
  if (!repeatingRows.length || firstSourceRowIndex < repeatingRows.length) return;
  const firstClonedRow = clonedTable.querySelector("tr");
  const parent = firstClonedRow?.parentElement;
  if (!firstClonedRow || !parent) return;
  for (const row of repeatingRows) {
    const repeatedRow = row.cloneNode(true) as HTMLElement;
    repeatedRow.classList.add("pagination-repeated-header");
    parent.insertBefore(repeatedRow, firstClonedRow);
  }
}

function structuredBlockFragmentHtml(element: Element, start: number, end: number, isFinal: boolean) {
  const clone = element.cloneNode(true) as HTMLElement;
  const items = clone.matches("ol, ul")
    ? Array.from(clone.children).filter((child) => child.matches("li"))
    : Array.from(clone.querySelectorAll("tr"));
  items.forEach((item, index) => {
    if (index < start || index >= end) item.remove();
  });
  clone.querySelectorAll("thead, tbody, tfoot").forEach((section) => {
    if (!section.querySelector("tr")) section.remove();
  });
  if (clone.matches("table")) prependRepeatingTableHeaderRows(element, clone, start);
  if (clone.matches("ol") && start > 0) {
    const originalStart = Number(element.getAttribute("start") || 1);
    clone.setAttribute("start", String(originalStart + start));
  }
  if (start > 0) clone.style.marginTop = "0px";
  if (!isFinal) clone.style.marginBottom = "0px";
  return clone.outerHTML;
}

function listItemFragmentHtml(element: Element, itemIndex: number, start: number, end: number, isContinuation: boolean, isFinal: boolean) {
  const sourceItem = Array.from(element.children).filter((child) => child.matches("li"))[itemIndex];
  if (!sourceItem) return "";
  const startBoundary = textBoundary(sourceItem, start);
  const endBoundary = textBoundary(sourceItem, end);
  if (!startBoundary || !endBoundary) return "";

  const range = document.createRange();
  range.setStart(startBoundary.node, startBoundary.offset);
  range.setEnd(endBoundary.node, endBoundary.offset);
  const listClone = element.cloneNode(false) as HTMLElement;
  const itemClone = sourceItem.cloneNode(false) as HTMLElement;
  itemClone.append(range.cloneContents());
  if (!isFinal) itemClone.style.marginBottom = "0px";
  listClone.append(itemClone);
  if (listClone.matches("ol")) {
    const originalStart = Number(element.getAttribute("start") || 1);
    listClone.setAttribute("start", String(originalStart + itemIndex));
  }
  if (isContinuation) listClone.classList.add("pagination-list-continuation");
  if (isContinuation) listClone.style.marginTop = "0px";
  if (!isFinal) listClone.style.marginBottom = "0px";
  return listClone.outerHTML;
}

function tableRowFragmentHtml(element: Element, rowIndex: number, starts: number[], ends: number[], isContinuation: boolean, isFinal: boolean) {
  const sourceRows = Array.from(element.querySelectorAll("tr"));
  const sourceRow = sourceRows[rowIndex];
  if (!sourceRow) return "";
  const clone = element.cloneNode(false) as HTMLElement;
  const sourceSection = sourceRow.parentElement?.matches("thead, tbody, tfoot") ? sourceRow.parentElement : null;
  const clonedSection = sourceSection?.cloneNode(false) as HTMLElement | undefined;
  const clonedRow = sourceRow.cloneNode(false) as HTMLElement;
  if (clonedSection) {
    clonedSection.append(clonedRow);
    clone.append(clonedSection);
  } else {
    clone.append(clonedRow);
  }
  const sourceCells = Array.from(sourceRow.querySelectorAll(":scope > th, :scope > td"));
  const clonedCells = sourceCells.map((cell) => cell.cloneNode(false) as HTMLElement);
  clonedRow.append(...clonedCells);
  // 中文注解：只克隆当前行的结构，再填入本页文本片段，避免每次二分测量都深拷贝整张超长表格。
  sourceCells.forEach((cell, index) => {
    const clonedCell = clonedCells[index];
    if (!clonedCell) return;
    const startBoundary = textBoundary(cell, starts[index] || 0);
    const endBoundary = textBoundary(cell, ends[index] || 0);
    if (!startBoundary || !endBoundary) {
      clonedCell.innerHTML = ends[index] > starts[index] ? cell.innerHTML : "<p>&nbsp;</p>";
      return;
    }
    const range = document.createRange();
    range.setStart(startBoundary.node, startBoundary.offset);
    range.setEnd(endBoundary.node, endBoundary.offset);
    const fragment = range.cloneContents();
    if ((starts[index] || 0) === 0) {
      // 中文注解：文本前的块级图片不属于 Range 文本边界，只在首个跨页片段补回一次。
      const leadingNodes: Node[] = [];
      Array.from(cell.childNodes).some((node) => {
        if (node.textContent?.length) return true;
        leadingNodes.push(node.cloneNode(true));
        return false;
      });
      fragment.prepend(...leadingNodes);
    }
    if ((ends[index] || 0) >= (cell.textContent || "").length) {
      const trailingNodes: Node[] = [];
      Array.from(cell.childNodes).reverse().some((node) => {
        if (node.textContent?.length) return true;
        trailingNodes.unshift(node.cloneNode(true));
        return false;
      });
      fragment.append(...trailingNodes);
    }
    clonedCell.replaceChildren(fragment);
    if (!clonedCell.textContent && !clonedCell.querySelector("img")) clonedCell.innerHTML = "<p>&nbsp;</p>";
  });
  prependRepeatingTableHeaderRows(element, clone, rowIndex);

  if (isContinuation) clone.classList.add("pagination-table-continuation");
  if (isContinuation) clone.style.marginTop = "0px";
  if (!isFinal) clone.style.marginBottom = "0px";
  return clone.outerHTML;
}

function preferredTextBreak(text: string, start: number, measuredEnd: number) {
  if (measuredEnd >= text.length) return text.length;
  const searchStart = Math.max(start + 1, measuredEnd - 24);
  const candidate = text.slice(searchStart, measuredEnd);
  const relativeBreak = Math.max(
    candidate.lastIndexOf(" "),
    candidate.lastIndexOf("\t"),
    candidate.lastIndexOf("，"),
    candidate.lastIndexOf("。"),
    candidate.lastIndexOf("；"),
    candidate.lastIndexOf("、")
  );
  return relativeBreak >= 0 ? searchStart + relativeBreak + 1 : measuredEnd;
}

function safeTemplateWordStyle(value: unknown): TemplateWordStyle | undefined {
  if (!value || typeof value !== "object") return undefined;
  const source = value as Record<string, unknown>;
  const numeric = (key: string, minimum: number, maximum: number) => {
    const number = Number(source[key]);
    return Number.isFinite(number) && number >= minimum && number <= maximum ? number : undefined;
  };
  const color = (key: string) => {
    const text = String(source[key] || "").replace(/^#/, "");
    return /^[0-9a-f]{6}$/i.test(text) ? `#${text}` : undefined;
  };
  const fontFamily = String(source.fontFamily || "").trim().slice(0, 80);
  return {
    fontFamily: fontFamily || undefined,
    titleColor: color("titleColor"),
    headingColor: color("headingColor"),
    titleSize: numeric("titleSize", 16, 96),
    headingSize: numeric("headingSize", 16, 72),
    bodySize: numeric("bodySize", 12, 48),
    lineSpacing: numeric("lineSpacing", 200, 720)
  };
}

function documentPreviewStyle(template: TemplateItem | null) {
  const style = template?.wordStyle;
  const bodyHalfPoints = style?.bodySize || 22;
  const headingHalfPoints = style?.headingSize || 28;
  const variables = {
    "--document-font-family": style?.fontFamily ? `"${style.fontFamily.replace(/["\\]/g, "")}"` : "Microsoft YaHei",
    "--document-body-size": `${Math.round(bodyHalfPoints * 2 / 3 * 100) / 100}px`,
    "--document-title-size": `${Math.round((style?.titleSize || 36) * 2 / 3 * 100) / 100}px`,
    "--document-heading-1-size": `${Math.round(headingHalfPoints * 2 / 3 * 100) / 100}px`,
    "--document-heading-2-size": `${Math.round(Math.max(headingHalfPoints - 2, bodyHalfPoints) * 2 / 3 * 100) / 100}px`,
    "--document-heading-3-size": `${Math.round(Math.max(headingHalfPoints - 4, bodyHalfPoints) * 2 / 3 * 100) / 100}px`,
    "--document-line-height": String(Math.round((style?.lineSpacing || 360) / 240 * 10000) / 10000),
    "--document-title-color": style?.titleColor || "#17212b",
    "--document-heading-color": style?.headingColor || "#245f55"
  };
  return variables as React.CSSProperties;
}

function getSelectedText(editor: TiptapEditor | null) {
  if (!editor) return "";
  const { from, to } = editor.state.selection;
  return editor.state.doc.textBetween(from, to, "\n").trim();
}

function transformTextCase(text: string, mode: TextCaseMode) {
  if (mode === "upper") return text.toUpperCase();
  if (mode === "lower") return text.toLowerCase();
  return text.toLowerCase().replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

function cleanDetectedTitle(text: string) {
  return text
    .trim()
    .replace(/^#{1,6}\s+/, "")
    .replace(/\s+/g, " ");
}

function inferHeadingLevel(text: string) {
  const title = cleanDetectedTitle(text);
  if (!title || title.length > 48) return null;
  if (/[。！？；;]$/.test(title)) return null;

  if (/^#{1,2}\s+/.test(text)) return 2;
  if (/^#{3,6}\s+/.test(text)) return 3;
  if (/^第[一二三四五六七八九十百千万\d]+[章节篇部分][：:、.\s-]?\S*/.test(title)) return 2;
  if (/^[0-9]+\.[0-9]+[、.．\s-]?\S+/.test(title)) return 3;
  if (/^[（(][一二三四五六七八九十百千万\d]+[）)]\s*\S+/.test(title)) return 3;
  if (/^[A-Za-z][).、]\s*\S+/.test(title)) return 3;
  if (/^([一二三四五六七八九十百千万]+|[0-9]+)[、.．]\s*\S+/.test(title)) return 2;

  return null;
}

function toOutlineItems(outline: string[]) {
  return outline.map((title, index) => ({ id: index + 1, title }));
}

function apiDocumentToRecent(document: ApiDocument): RecentDocument {
  return {
    id: document.id,
    title: document.title,
    type: document.documentType,
    updatedAt: new Date(document.updatedAt).toLocaleString(),
    words: document.wordCount || stripHtml(document.content).length
  };
}

async function readApiJson(response: Response) {
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result.message || "网络异常，请稍后重试。");
  }
  return result;
}

function App() {
  const [selectedType, setSelectedType] = React.useState<DocumentType>("工作总结");
  const [topic, setTopic] = React.useState("AI Word 文档助手本地开发方案");
  const [tone, setTone] = React.useState("正式");
  const [requirement, setRequirement] = React.useState("先生成清晰大纲，再按章节生成正文内容。");
  const [outline, setOutline] = React.useState<OutlineItem[]>(defaultOutline);
  const [content, setContent] = React.useState(plainTextToHtml(defaultContent));
  const [currentDocumentId, setCurrentDocumentId] = React.useState<number | null>(null);
  const [currentTitle, setCurrentTitle] = React.useState("AI Word 文档助手本地开发方案");
  const [selectedTemplate, setSelectedTemplate] = React.useState<TemplateItem | null>(null);
  const [recentDocuments, setRecentDocuments] = React.useState<RecentDocument[]>([]);
  const [activePanel, setActivePanel] = React.useState<"workspace" | "editor" | "templates">("workspace");
  const [aiStatus, setAiStatus] = React.useState("本地兜底已就绪");
  const [aiLoading, setAiLoading] = React.useState<string | null>(null);
  const [aiError, setAiError] = React.useState("");
  const [saveStatus, setSaveStatus] = React.useState("未保存");
  const [exportStatus, setExportStatus] = React.useState("");
  const [sessionUser, setSessionUser] = React.useState<SessionUser | null>(null);
  const [pointsSummary, setPointsSummary] = React.useState<PointsSummary | null>(null);
  const [templates, setTemplates] = React.useState<TemplateItem[]>(fallbackDocumentTemplates);
  const [templatesLoading, setTemplatesLoading] = React.useState(false);
  const [templatesError, setTemplatesError] = React.useState("");
  const [launchStatus, setLaunchStatus] = React.useState("");
  const [appInitializing, setAppInitializing] = React.useState(true);
  const [documentsLoading, setDocumentsLoading] = React.useState(false);
  const [documentImporting, setDocumentImporting] = React.useState(false);
  const [pointsRefreshing, setPointsRefreshing] = React.useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = React.useState(false);
  const [isOutlineCollapsed, setIsOutlineCollapsed] = React.useState(false);
  const [pageLayout, setPageLayout] = React.useState<DocumentPageLayout>({ ...defaultDocumentPageLayout });
  const saveQueueRef = React.useRef<Promise<unknown>>(Promise.resolve());

  const loadSession = React.useCallback(async () => {
    const response = await fetch("/api/session");
    const result = await readApiJson(response);
    setSessionUser(result.user);
    setPointsSummary(result.points);
  }, []);

  const loadRecentDocuments = React.useCallback(async () => {
    setDocumentsLoading(true);
    try {
      const response = await fetch("/api/documents");
      const result = await readApiJson(response);
      const documents = (result.documents || []) as ApiDocument[];
      setRecentDocuments(documents.map(apiDocumentToRecent));
    } catch (error) {
      setAiError(error instanceof Error ? error.message : "读取最近文档失败");
    } finally {
      setDocumentsLoading(false);
    }
  }, []);

  const loadTemplates = React.useCallback(async () => {
    setTemplatesLoading(true);
    try {
      const response = await fetch("/api/templates");
      const result = await readApiJson(response);
      const remoteTemplates = (result.templates || []) as ApiTemplate[];
      setTemplates(remoteTemplates.length ? remoteTemplates : fallbackDocumentTemplates);
      setTemplatesError(remoteTemplates.length ? "" : "模板接口暂无启用模板，已使用本地兜底模板。");
    } catch (error) {
      // 中文注解：模板库是低风险入口，接口异常时前端继续用本地模板，避免影响写作主流程。
      setTemplates(fallbackDocumentTemplates);
      setTemplatesError(error instanceof Error ? `${error.message} 已使用本地兜底模板。` : "模板接口暂时不可用，已使用本地兜底模板。");
    } finally {
      setTemplatesLoading(false);
    }
  }, []);

  const hydrateTemplateStyle = React.useCallback(async (template: TemplateItem, preserveIdOnFailure: boolean) => {
    const styleAsset = template.assets?.find((asset) => asset.purpose === "template_style");
    if (!styleAsset?.url) return template;

    try {
      const response = await fetch(styleAsset.url);
      const style = safeTemplateWordStyle(await readApiJson(response));
      if (!style) throw new Error("模板样式内容无效");
      return { ...template, wordStyle: style };
    } catch {
      // 中文注解：打开历史文档时保留绑定 ID，避免自动保存误清空；新套用模板失败则降级为默认版式。
      return preserveIdOnFailure
        ? { ...template, wordStyle: undefined }
        : { ...template, id: undefined, wordStyle: undefined };
    }
  }, []);

  const refreshPoints = React.useCallback(async () => {
    setPointsRefreshing(true);
    try {
      await loadSession();
      setAiError("");
    } catch (error) {
      setAiError(error instanceof Error ? error.message : "积分读取失败，请稍后刷新。");
    } finally {
      setPointsRefreshing(false);
    }
  }, [loadSession]);

  const hasEnoughPoints = React.useCallback((cost: number, label: string) => {
    if (!sessionUser?.isMolingUser || !pointsSummary?.enabled || pointsSummary.remaining == null) return true;
    if (pointsSummary.remaining >= cost) return true;
    setAiError(`积分不足，${label}需要 ${cost} 积分，请购买套餐后继续使用。`);
    return false;
  }, [pointsSummary, sessionUser]);

  React.useEffect(() => {
    const run = async () => {
      try {
        const url = new URL(window.location.href);
        if (url.pathname === "/molin/launch") {
          const ticket = url.searchParams.get("ticket");
          setLaunchStatus("正在通过墨灵平台进入应用");
          const response = await fetch("/api/molin/launch", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ticket })
          });
          const result = await readApiJson(response);
          setSessionUser(result.user);
          setPointsSummary(result.points);
          window.history.replaceState({}, "", "/");
          setLaunchStatus("");
        } else {
          await loadSession();
        }
        await loadRecentDocuments();
      } catch (error) {
        setLaunchStatus("");
        setAiError(error instanceof Error ? error.message : "初始化登录状态失败");
      } finally {
        setAppInitializing(false);
      }
    };
    void run();
  }, [loadRecentDocuments, loadSession]);

  React.useEffect(() => {
    void loadTemplates();
  }, [loadTemplates]);

  const callAi = async <T,>(label: string, url: string, body: unknown): Promise<T | null> => {
    setAiLoading(label);
    setAiError("");
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const result = await readApiJson(response);
      setAiStatus(result.fallback ? "本地兜底" : "真实 AI");
      if (result.message) setAiError(result.message);
      await loadSession().catch(() => undefined);
      return result as T;
    } catch (error) {
      setAiError(error instanceof Error ? error.message : "AI 请求失败");
      return null;
    } finally {
      setAiLoading(null);
    }
  };

  const createDocument = async (payload: { title: string; documentType: DocumentType; tone: string; outline: string[]; content: string }) => {
    try {
      const response = await fetch("/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, templateId: selectedTemplate?.id ?? null, pageLayout: defaultDocumentPageLayout })
      });
      const result = await readApiJson(response);
      return result.document as ApiDocument;
    } catch (error) {
      setAiError(error instanceof Error ? error.message : "创建文档失败");
      return null;
    }
  };

  const generateOutline = async () => {
    if (!hasEnoughPoints(usageCosts.outline, "生成大纲")) return;
    const result = await callAi<{ outline: string[]; fallback?: boolean; message?: string }>("正在生成大纲", "/api/ai/generate-outline", {
      topic,
      documentType: selectedType,
      tone,
      requirement,
      documentId: currentDocumentId
    });
    if (!result?.outline?.length) return;
    setOutline(toOutlineItems(result.outline));
    const created = await createDocument({
      title: topic || "未命名文档",
      documentType: selectedType,
      tone,
      outline: result.outline,
      content: plainTextToHtml(defaultContent)
    });
    if (created) {
      setCurrentDocumentId(created.id);
      setCurrentTitle(created.title);
      setContent(created.content || plainTextToHtml(defaultContent));
      setPageLayout(normalizeDocumentPageLayout(created.pageLayout));
      setSaveStatus("已创建");
      await loadRecentDocuments();
    }
    setActivePanel("editor");
  };

  const saveDocument = React.useCallback(
    (options: { content?: string; title?: string; saveVersion?: boolean; versionNote?: string } = {}) => {
      const documentId = currentDocumentId;
      if (!documentId) return Promise.resolve(null);
      const performSave = async () => {
        try {
          setSaveStatus("保存中");
          const response = await fetch(`/api/documents/${documentId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              title: options.title ?? currentTitle,
              documentType: selectedType,
              tone,
              templateId: selectedTemplate?.id ?? null,
              outline: outline.map((item) => item.title),
              content: options.content ?? content,
              pageLayout,
              saveVersion: options.saveVersion ?? false,
              versionNote: options.versionNote
            })
          });
          const result = await readApiJson(response);
          setSaveStatus("已保存");
          await loadRecentDocuments();
          return result.document as ApiDocument;
        } catch (error) {
          setSaveStatus("保存失败");
          setAiError(error instanceof Error ? error.message : "保存文档失败");
          return null;
        }
      };
      // 中文注解：所有自动、手动及导出前保存按顺序执行，防止旧请求晚返回后覆盖较新的正文。
      const request = saveQueueRef.current.then(performSave, performSave);
      saveQueueRef.current = request.then(() => undefined, () => undefined);
      return request;
    },
    [content, currentDocumentId, currentTitle, loadRecentDocuments, outline, pageLayout, selectedTemplate, selectedType, tone]
  );

  const uploadPageImage = React.useCallback(async (file: File) => {
    if (!currentDocumentId) throw new Error("请先创建或打开文档，再添加页眉页脚图片。");
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch(`/api/documents/${currentDocumentId}/images`, { method: "POST", body: formData });
      const result = await readApiJson(response);
      setAiError("");
      return result.image as DocumentPageImage;
    } catch (error) {
      const message = error instanceof Error ? error.message : "页面图片上传失败";
      setAiError(message);
      throw error;
    }
  }, [currentDocumentId]);

  React.useEffect(() => {
    if (!currentDocumentId || activePanel !== "editor") return;
    setSaveStatus("自动保存中");
    const timer = window.setTimeout(() => {
      void saveDocument({ saveVersion: false });
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [activePanel, content, currentDocumentId, outline, saveDocument]);

  const generateBody = async () => {
    if (!hasEnoughPoints(usageCosts.body, "生成正文")) return;
    const result = await callAi<{ content: string; fallback?: boolean; message?: string }>("正在生成正文", "/api/ai/generate-body", {
      topic,
      documentType: selectedType,
      tone,
      requirement,
      outline: outline.map((item) => item.title),
      documentId: currentDocumentId
    });
    if (result?.content) {
      const html = plainTextToHtml(result.content);
      setContent(html);
      await saveDocument({ content: html, versionNote: "AI 生成正文" });
    }
  };

  const editContent = async (action: AiAction, source: string) => {
    if (!hasEnoughPoints(usageCosts.edit, "局部 AI 编辑")) return "";
    const labelMap: Record<AiAction, string> = {
      continue: "正在续写",
      expand: "正在扩写",
      shorten: "正在缩写",
      correct: "正在纠错",
      format: "正在优化格式",
      polish: "正在润色"
    };
    const result = await callAi<{ content: string; fallback?: boolean; message?: string }>(labelMap[action], "/api/ai/edit", {
      action,
      content: source,
      documentId: currentDocumentId
    });
    return result?.content || "";
  };

  const openDocument = async (documentId: number) => {
    try {
      const response = await fetch(`/api/documents/${documentId}`);
      const result = await readApiJson(response);
      const document = result.document as ApiDocument;
      let documentTemplate: TemplateItem | null = null;
      if (document.templateId) {
        try {
          let template = templates.find((item) => item.id === document.templateId);
          if (!template) {
            const templateResponse = await fetch(`/api/templates/${document.templateId}`);
            const templateResult = await readApiJson(templateResponse);
            template = templateResult.template as ApiTemplate;
          }
          documentTemplate = await hydrateTemplateStyle(template, true);
          if (documentTemplate.hasStyle && !documentTemplate.wordStyle) {
            setAiError("文档模板样式加载失败，已保留模板绑定；请刷新后重试，当前暂不能导出 Word。");
          }
        } catch {
          // 中文注解：模板接口短暂异常时仍允许打开正文，同时用占位模板保留绑定并阻止错误导出。
          documentTemplate = {
            id: document.templateId,
            name: `模板 #${document.templateId}（样式待恢复）`,
            category: "已绑定模板",
            documentType: document.documentType,
            topic: document.title,
            requirement: "",
            outline: document.outline || [],
            hasStyle: true
          };
          setAiError("模板详情暂时无法读取，正文已正常打开；请刷新后恢复样式，当前暂不能导出 Word。");
        }
      }
      setCurrentDocumentId(document.id);
      setCurrentTitle(document.title);
      setTopic(document.title);
      setSelectedType(document.documentType);
      setTone(document.tone);
      setOutline(toOutlineItems(document.outline || []));
      setContent(document.content || "<p></p>");
      // 中文注解：历史文档只有默认页三项字段，打开时补齐首页和偶数页对象，避免启用高级页面设置时崩溃。
      setPageLayout(normalizeDocumentPageLayout(document.pageLayout));
      setSelectedTemplate(documentTemplate);
      setActivePanel("editor");
      setSaveStatus("已打开");
      await loadRecentDocuments();
      return true;
    } catch (error) {
      setAiError(error instanceof Error ? error.message : "读取文档失败");
      return false;
    }
  };

  const importDocument = async (file: File) => {
    setDocumentImporting(true);
    setAiError("");
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/documents/import", { method: "POST", body: formData });
      const result = await readApiJson(response);
      await loadRecentDocuments();
      const opened = await openDocument((result.document as ApiDocument).id);
      if (opened) {
        const messages = Array.isArray(result.warnings) ? result.warnings.filter(Boolean) : [];
        if (!result.sourceStored) messages.push("原文件暂未归档到 MinIO，不影响编辑。");
        if (messages.length) setAiError(messages.join(" "));
      }
    } catch (error) {
      setAiError(error instanceof Error ? error.message : "文档导入失败");
    } finally {
      setDocumentImporting(false);
    }
  };

  const renameDocument = async (documentId: number, currentName: string) => {
    const nextName = window.prompt("请输入新的文档名称", currentName);
    if (!nextName?.trim()) return;
    const response = await fetch(`/api/documents/${documentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: nextName.trim() })
    });
    const result = await readApiJson(response).catch((error) => {
      setAiError(error instanceof Error ? error.message : "重命名失败");
      return null;
    });
    if (!result) return;
    if (documentId === currentDocumentId) {
      setCurrentTitle(result.document.title);
      setTopic(result.document.title);
    }
    await loadRecentDocuments();
  };

  const deleteDocument = async (documentId: number) => {
    if (!window.confirm("确定删除这个文档吗？")) return;
    const response = await fetch(`/api/documents/${documentId}`, { method: "DELETE" });
    const result = await readApiJson(response).catch((error) => {
      setAiError(error instanceof Error ? error.message : "删除失败");
      return null;
    });
    if (!result) return;
    if (result.deleted && documentId === currentDocumentId) {
      setCurrentDocumentId(null);
      setCurrentTitle("AI Word 文档助手本地开发方案");
      setContent(plainTextToHtml(defaultContent));
      setPageLayout({ ...defaultDocumentPageLayout });
      setOutline(defaultOutline);
      setSelectedTemplate(null);
      setActivePanel("workspace");
    }
    await loadRecentDocuments();
  };

  const duplicateDocument = async (documentId: number) => {
    const response = await fetch(`/api/documents/${documentId}/duplicate`, { method: "POST" });
    const result = await readApiJson(response).catch((error) => {
      setAiError(error instanceof Error ? error.message : "复制失败");
      return null;
    });
    if (!result) return;
    await loadRecentDocuments();
    await openDocument(result.document.id);
  };

  const exportWord = async (contentOverride?: string) => {
    const exportContent = contentOverride ?? content;
    if (!currentDocumentId) {
      setAiError("请先创建或打开一个文档");
      return;
    }
    if (!hasEnoughPoints(usageCosts.exportDocx, "导出 Word")) return;
    if (selectedTemplate?.id && selectedTemplate.hasStyle && !selectedTemplate.wordStyle) {
      setAiError("模板样式尚未加载，暂不能导出 Word，请刷新页面后重试。");
      return;
    }
    try {
      setExportStatus("导出中");
      const saved = await saveDocument({ content: exportContent, saveVersion: true, versionNote: "导出 Word 前保存" });
      if (!saved) throw new Error("导出前自动保存失败，请先确认文档已保存。");
      const response = await fetch(`/api/documents/${currentDocumentId}/export-docx`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: exportContent })
      });
      const result = await readApiJson(response);
      const anchor = document.createElement("a");
      anchor.href = result.file.downloadUrl;
      anchor.download = result.file.fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setExportStatus("Word 已生成");
      await loadSession().catch(() => undefined);
    } catch (error) {
      setExportStatus("导出失败");
      setAiError(error instanceof Error ? error.message : "导出 Word 失败");
    }
  };

  const applyTemplate = async (template: TemplateItem) => {
    const templateWithStyle = await hydrateTemplateStyle(template, false);
    setSelectedTemplate(templateWithStyle);
    setSelectedType(template.documentType);
    setTopic(template.topic);
    setTone("正式");
    setRequirement(template.requirement);
    setOutline(toOutlineItems(template.outline));
    setContent(plainTextToHtml(`${template.topic}\n\n${template.outline.map((item) => `${item}\n请在此补充内容。`).join("\n\n")}`));
    setPageLayout({ ...defaultDocumentPageLayout });
    setCurrentTitle(template.topic);
    setCurrentDocumentId(null);
    setSaveStatus("未保存");
    setActivePanel("workspace");
  };

  return (
    <main className={`app-shell${isSidebarCollapsed ? " sidebar-collapsed" : ""}`}>
      {appInitializing ? <div className="global-loading">正在初始化应用...</div> : null}
      {aiError ? <ErrorBanner message={aiError} onClose={() => setAiError("")} /> : null}
      <aside className="sidebar">
        <div className="sidebar-head">
          <div className="brand">
            <div className="brand-mark"><FileText size={22} /></div>
            <div className="brand-copy"><strong>AI Word</strong><span>本地开发版</span></div>
          </div>
          <button className="collapse-button" onClick={() => setIsSidebarCollapsed((value) => !value)} title={isSidebarCollapsed ? "展开主导航" : "收起主导航"} aria-label={isSidebarCollapsed ? "展开主导航" : "收起主导航"}>
            {isSidebarCollapsed ? <ChevronsRight size={18} /> : <ChevronsLeft size={18} />}
          </button>
        </div>
        <nav className="side-nav" aria-label="主导航">
          <button className={activePanel === "workspace" ? "active" : ""} onClick={() => setActivePanel("workspace")} title="工作台"><FolderOpen size={18} /><span>工作台</span></button>
          <button className={activePanel === "editor" ? "active" : ""} onClick={() => setActivePanel("editor")} title="文档编辑"><PenLine size={18} /><span>文档编辑</span></button>
          <button className={activePanel === "templates" ? "active" : ""} onClick={() => setActivePanel("templates")} title="模板库"><LayoutTemplate size={18} /><span>模板库</span></button>
        </nav>
        <div className="platform-box">
          <span>墨灵平台</span>
          <strong>{sessionUser?.isMolingUser ? `用户 ${sessionUser.userId}` : "本地开发用户"}</strong>
          <small>{launchStatus || (sessionUser?.isMolingUser ? `商品 ${sessionUser.productId} · 剩余积分 ${pointsSummary?.remaining ?? "未知"}` : "从墨灵平台进入后启用免登和积分计费")}</small>
          {pointsSummary?.error ? <small className="platform-error">{pointsSummary.error}</small> : null}
          {sessionUser?.isMolingUser ? <button className="points-refresh" onClick={refreshPoints} disabled={pointsRefreshing}><RefreshCw size={14} />{pointsRefreshing ? "刷新中" : "刷新积分"}</button> : null}
        </div>
      </aside>

      {activePanel === "workspace" ? (
        <Workspace
          selectedType={selectedType}
          setSelectedType={setSelectedType}
          topic={topic}
          setTopic={setTopic}
          tone={tone}
          setTone={setTone}
          requirement={requirement}
          setRequirement={setRequirement}
          generateOutline={generateOutline}
          aiLoading={aiLoading}
          recentDocuments={recentDocuments}
          openDocument={openDocument}
          renameDocument={renameDocument}
          deleteDocument={deleteDocument}
          duplicateDocument={duplicateDocument}
          documentsLoading={documentsLoading}
          documentImporting={documentImporting}
          importDocument={importDocument}
        />
      ) : activePanel === "templates" ? (
        <TemplateLibrary applyTemplate={applyTemplate} templates={templates} templatesLoading={templatesLoading} templatesError={templatesError} />
      ) : (
        <Editor
          outline={outline}
          content={content}
          pageLayout={pageLayout}
          setPageLayout={setPageLayout}
          setContent={setContent}
          setOutline={setOutline}
          generateBody={generateBody}
          editContent={editContent}
          uploadPageImage={uploadPageImage}
          saveDocument={(latestContent) => saveDocument({ content: latestContent, saveVersion: true, versionNote: "手动保存" })}
          exportWord={exportWord}
          currentTitle={currentTitle}
          saveStatus={saveStatus}
          exportStatus={exportStatus}
          selectedTemplate={selectedTemplate}
          aiStatus={aiStatus}
          aiLoading={aiLoading}
          aiError={aiError}
          pointsRemaining={pointsSummary?.remaining ?? null}
          pointsEnabled={Boolean(pointsSummary?.enabled)}
          isOutlineCollapsed={isOutlineCollapsed}
          setIsOutlineCollapsed={setIsOutlineCollapsed}
        />
      )}
    </main>
  );
}

function ErrorBanner(props: { message: string; onClose: () => void }) {
  return (
    <div className="error-banner" role="alert">
      <XCircle size={17} />
      <span>{props.message}</span>
      <button onClick={props.onClose} aria-label="关闭提示">关闭</button>
    </div>
  );
}

function LoadingProcess(props: { label: string; compact?: boolean }) {
  const steps = loadingStepMap[props.label] || ["准备请求", "调用 AI 模型", "整理返回内容", "更新页面状态"];

  return (
    <div className={props.compact ? "generation-loader compact" : "generation-loader"} role="status" aria-live="polite">
      <div className="loader-head">
        <span className="loader-orbit"><LoaderCircle size={18} /></span>
        <strong>{props.label}</strong>
      </div>
      <div className="loader-progress"><span /></div>
      <div className="loader-steps">
        {steps.map((step, index) => <span key={step} style={{ animationDelay: `${index * 0.18}s` }}>{step}</span>)}
      </div>
    </div>
  );
}

function Workspace(props: {
  selectedType: DocumentType;
  setSelectedType: (value: DocumentType) => void;
  topic: string;
  setTopic: (value: string) => void;
  tone: string;
  setTone: (value: string) => void;
  requirement: string;
  setRequirement: (value: string) => void;
  generateOutline: () => void;
  aiLoading: string | null;
  recentDocuments: RecentDocument[];
  openDocument: (documentId: number) => void;
  renameDocument: (documentId: number, currentName: string) => void;
  deleteDocument: (documentId: number) => void;
  duplicateDocument: (documentId: number) => void;
  documentsLoading: boolean;
  documentImporting: boolean;
  importDocument: (file: File) => void;
}) {
  const [keyword, setKeyword] = React.useState("");
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const filteredDocuments = props.recentDocuments.filter((item) => {
    const text = `${item.title} ${item.type}`.toLowerCase();
    return text.includes(keyword.trim().toLowerCase());
  });

  return (
    <section className="workspace">
      <header className="topbar">
        <div><p>个人文档工作台</p><h1>AI Word 文档助手</h1></div>
        <button className="primary-action" onClick={props.generateOutline} disabled={Boolean(props.aiLoading)}>{props.aiLoading ? <LoaderCircle className="spin-icon" size={18} /> : <Sparkles size={18} />}{props.aiLoading || "生成大纲"}</button>
      </header>
      <div className="workspace-grid">
        <section className="creator-panel">
          <div className="section-title"><Plus size={18} /><h2>新建 AI 文档</h2></div>
          <label>文档主题<input value={props.topic} onChange={(event) => props.setTopic(event.target.value)} /></label>
          <div className="field-row">
            <label>文档类型<select value={props.selectedType} onChange={(event) => props.setSelectedType(event.target.value as DocumentType)}>{documentTypes.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label>写作语气<select value={props.tone} onChange={(event) => props.setTone(event.target.value)}><option>正式</option><option>商务</option><option>学术</option><option>简洁</option></select></label>
          </div>
          <label>补充要求<textarea value={props.requirement} onChange={(event) => props.setRequirement(event.target.value)} /></label>
          {props.aiLoading ? <LoadingProcess label={props.aiLoading} /> : null}
          <button className="wide-action" onClick={props.generateOutline} disabled={Boolean(props.aiLoading)}>{props.aiLoading ? <LoaderCircle className="spin-icon" size={18} /> : <Wand2 size={18} />}{props.aiLoading || "开始生成"}</button>
        </section>
        <section className="recent-panel">
          <div className="section-title spread">
            <div><FileText size={18} /><h2>最近文档</h2></div>
            <div className="import-document">
              <input
                ref={fileInputRef}
                type="file"
                accept=".doc,.docx,.pdf,application/msword,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) props.importDocument(file);
                  event.target.value = "";
                }}
              />
              <button onClick={() => fileInputRef.current?.click()} disabled={props.documentImporting} title="导入 DOC、DOCX 或文字型 PDF（最大 15MB）">
                {props.documentImporting ? <LoaderCircle className="spin-icon" size={16} /> : <FileUp size={16} />}
                {props.documentImporting ? "导入中" : "导入文档"}
              </button>
            </div>
          </div>
          {props.documentImporting ? <LoadingProcess label="正在导入文档" compact /> : null}
          <label className="search-box"><Search size={16} /><input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索标题或类型" /></label>
          <div className="document-list">
            {props.documentsLoading ? <div className="empty-state">正在读取最近文档...</div> : null}
            {!props.documentsLoading && props.recentDocuments.length === 0 ? <div className="empty-state">暂无文档，请先创建一份新文档。</div> : null}
            {!props.documentsLoading && props.recentDocuments.length > 0 && filteredDocuments.length === 0 ? <div className="empty-state">没有匹配的文档。</div> : null}
            {filteredDocuments.map((item) => (
              <div key={item.id} className="document-row">
                <button className="document-open" onClick={() => props.openDocument(item.id)}><div><strong>{item.title}</strong><span>{item.type} · {item.words} 字 · {item.updatedAt}</span></div><ChevronRight size={18} /></button>
                <div className="document-actions"><button onClick={() => props.renameDocument(item.id, item.title)}>重命名</button><button onClick={() => props.duplicateDocument(item.id)}>复制</button><button onClick={() => props.deleteDocument(item.id)}>删除</button></div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </section>
  );
}

function TemplateLibrary(props: { applyTemplate: (template: TemplateItem) => void; templates: TemplateItem[]; templatesLoading: boolean; templatesError: string }) {
  const [keyword, setKeyword] = React.useState("");
  const normalizedKeyword = keyword.trim().toLowerCase();
  const filteredTemplates = React.useMemo(() => {
    if (!normalizedKeyword) return props.templates;

    return props.templates.filter((template) => {
      const searchableText = [
        template.name,
        template.category,
        template.documentType,
        template.topic,
        template.requirement,
        ...template.outline
      ].join(" ").toLowerCase();

      return searchableText.includes(normalizedKeyword);
    });
  }, [normalizedKeyword, props.templates]);

  return (
    <section className="workspace">
      <header className="topbar">
        <div><p>模板库</p><h1>选择文档模板</h1></div>
      </header>
      {props.templatesLoading ? <div className="template-status">正在读取模板...</div> : null}
      {props.templatesError ? <div className="template-status warning">{props.templatesError}</div> : null}
      <div className="template-search-row">
        <label className="search-box"><Search size={16} /><input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索模板名称、类型、场景或大纲" /></label>
        <span>{props.templatesLoading ? "读取中" : `共 ${filteredTemplates.length} / ${props.templates.length} 个模板`}</span>
      </div>
      <div className="template-grid">
        {!props.templatesLoading && props.templates.length === 0 ? <div className="empty-state">暂无可用模板。</div> : null}
        {!props.templatesLoading && props.templates.length > 0 && filteredTemplates.length === 0 ? <div className="empty-state">没有匹配的模板。</div> : null}
        {filteredTemplates.map((template) => (
          <article className="template-card" key={template.id ?? template.name}>
            <div className="template-cover">
              {template.coverUrl ? <img src={template.coverUrl} alt={`${template.name}封面`} /> : <div className="template-cover-fallback"><LayoutTemplate size={28} /></div>}
            </div>
            <div>
              <strong>{template.name}</strong>
              <span>{template.category} · {template.documentType}</span>
            </div>
            <p>{template.requirement}</p>
            <div className="template-asset-row">
              <span className={template.hasCover ? "asset-ok" : "asset-missing"}>{template.hasCover ? "已配置封面" : "无封面"}</span>
              <span className={template.hasStyle ? "asset-ok" : "asset-missing"}>{template.hasStyle ? "已配置 Word 样式" : "无 Word 样式"}</span>
            </div>
            <ul>
              {template.outline.slice(0, 3).map((item) => <li key={item}>{item}</li>)}
            </ul>
            <button onClick={() => props.applyTemplate(template)}><LayoutTemplate size={17} />使用模板</button>
          </article>
        ))}
      </div>
    </section>
  );
}

function Editor(props: {
  outline: OutlineItem[];
  content: string;
  pageLayout: DocumentPageLayout;
  setPageLayout: React.Dispatch<React.SetStateAction<DocumentPageLayout>>;
  setContent: (value: string) => void;
  setOutline: (value: OutlineItem[]) => void;
  generateBody: () => void;
  editContent: (action: AiAction, source: string) => Promise<string>;
  uploadPageImage: (file: File) => Promise<DocumentPageImage>;
  saveDocument: (latestContent?: string) => Promise<ApiDocument | null>;
  exportWord: (latestContent?: string) => void;
  currentTitle: string;
  saveStatus: string;
  exportStatus: string;
  selectedTemplate: TemplateItem | null;
  aiStatus: string;
  aiLoading: string | null;
  aiError: string;
  pointsRemaining: number | null;
  pointsEnabled: boolean;
  isOutlineCollapsed: boolean;
  setIsOutlineCollapsed: (value: boolean) => void;
}) {
  const [aiResult, setAiResult] = React.useState<AiEditResult | null>(null);
  const [selectionHint, setSelectionHint] = React.useState("请先选中文本，再使用局部 AI 操作。");
  const [hasSelection, setHasSelection] = React.useState(false);
  const [manualSavePending, setManualSavePending] = React.useState(false);
  const [viewMode, setViewMode] = React.useState<EditorViewMode>("edit");
  const [previewPages, setPreviewPages] = React.useState<PreviewPage[]>(() => {
    const layout = normalizeDocumentPageLayout(props.pageLayout);
    const page = createPreviewPage(layout, 0, 0);
    page.columns[0].push(buildExportPreviewHtml(props.currentTitle, props.content));
    return [page];
  });
  const [activeSectionIndex, setActiveSectionIndex] = React.useState(0);
  const [activeSectionLayout, setActiveSectionLayout] = React.useState<DocumentPageLayout>(() => normalizeDocumentPageLayout(props.pageLayout));
  const [sectionCount, setSectionCount] = React.useState(1);
  const [paginationAssetVersion, setPaginationAssetVersion] = React.useState(0);
  const [paginationPending, setPaginationPending] = React.useState(false);
  const [linkEditorOpen, setLinkEditorOpen] = React.useState(false);
  const [linkUrl, setLinkUrl] = React.useState("https://");
  const [imageAspectLocked, setImageAspectLocked] = React.useState(true);
  const paginationMeasureRef = React.useRef<HTMLDivElement | null>(null);
  const imageInputRef = React.useRef<HTMLInputElement | null>(null);
  const manualSavePromiseRef = React.useRef<Promise<ApiDocument | null> | null>(null);
  const activeSectionIndexRef = React.useRef(0);
  const activeSectionLayoutRef = React.useRef<DocumentPageLayout>(normalizeDocumentPageLayout(props.pageLayout));
  const lastEditorSelectionRef = React.useRef<{ from: number; to: number } | null>(null);

  const updateOutlineFromEditor = React.useCallback((editor: TiptapEditor) => {
    const nextOutline: OutlineItem[] = [];
    editor.state.doc.descendants((node, position) => {
      if (node.type.name === "heading") {
        const title = node.textContent.trim();
        if (title) nextOutline.push({ id: nextOutline.length + 1, title, level: node.attrs.level, position });
      }
    });
    if (nextOutline.length) props.setOutline(nextOutline);
  }, [props.setOutline]);

  const syncActiveSectionFromEditor = React.useCallback((editor: TiptapEditor) => {
    const boundaries: Array<{ position: number; layout: DocumentPageLayout }> = [];
    let previousLayout = normalizeDocumentPageLayout(props.pageLayout);
    editor.state.doc.descendants((node, position) => {
      if (node.type.name !== "sectionBreak") return;
      const layout = parseSectionPageLayout(node.attrs.pageLayout, previousLayout);
      boundaries.push({ position, layout });
      previousLayout = layout;
    });
    const nextIndex = boundaries.filter((boundary) => editor.state.selection.from >= boundary.position).length;
    const nextLayout = nextIndex === 0 ? normalizeDocumentPageLayout(props.pageLayout) : boundaries[nextIndex - 1].layout;
    activeSectionIndexRef.current = nextIndex;
    activeSectionLayoutRef.current = nextLayout;
    setSectionCount(boundaries.length + 1);
    setActiveSectionIndex(nextIndex);
    // 中文注解：Tiptap 会在 React 更新选项时重复同步选区，等值页面设置必须复用旧对象以阻断更新循环。
    setActiveSectionLayout((current) => samePageLayout(current, nextLayout) ? current : nextLayout);
  }, [props.pageLayout]);

  const editor = useEditor({
    extensions: [StarterKit.configure({ link: { openOnClick: false, autolink: false, linkOnPaste: true, HTMLAttributes: { target: "_blank", rel: "noopener noreferrer" } } }), DocumentImage.configure({ inline: false, allowBase64: true }), ImportedTextStyle, TextHighlight, SuperscriptText, SubscriptText, DocxTab, ListFormatAttributes, ParagraphIndent, PageBreak, SectionBreak, DocumentTable, DocumentTableRow, DocumentTableHeader, DocumentTableCell],
    content: props.content,
    editorProps: { attributes: { class: "word-editor" } },
    onCreate({ editor }) {
      lastEditorSelectionRef.current = { from: editor.state.selection.from, to: editor.state.selection.to };
      updateOutlineFromEditor(editor);
      syncActiveSectionFromEditor(editor);
    },
    onUpdate({ editor }) { props.setContent(editor.getHTML()); updateOutlineFromEditor(editor); syncActiveSectionFromEditor(editor); },
    onSelectionUpdate({ editor }) {
      lastEditorSelectionRef.current = { from: editor.state.selection.from, to: editor.state.selection.to };
      const selectedText = getSelectedText(editor);
      setHasSelection(Boolean(selectedText));
      setSelectionHint(selectedText ? `已选中 ${selectedText.length} 个字符` : "请先选中文本，再使用局部 AI 操作。");
      syncActiveSectionFromEditor(editor);
    }
  });

  React.useEffect(() => {
    if (!editor || editor.getHTML() === props.content) return;
    editor.commands.setContent(props.content);
    updateOutlineFromEditor(editor);
  }, [editor, props.content, updateOutlineFromEditor]);

  React.useLayoutEffect(() => {
    if (!editor) return;
    const frame = window.requestAnimationFrame(() => layoutDocxTabs(editor.view.dom));
    return () => window.cancelAnimationFrame(frame);
  }, [editor, props.content, viewMode]);

  React.useEffect(() => {
    if (activeSectionIndex !== 0) return;
    const nextLayout = normalizeDocumentPageLayout(props.pageLayout);
    activeSectionLayoutRef.current = nextLayout;
    setActiveSectionLayout((current) => samePageLayout(current, nextLayout) ? current : nextLayout);
  }, [activeSectionIndex, props.pageLayout]);

  React.useEffect(() => {
    const measureElement = paginationMeasureRef.current;
    if (!measureElement || viewMode !== "page") {
      setPaginationPending(false);
      return;
    }
    setPaginationPending(true);
    // 中文注解：超长文档分页属于昂贵布局任务，只在分页视图绘制后计算，避免阻塞编辑和视图按钮反馈。
    let cleanupPendingImages = () => {};
    const paginationTimer = window.setTimeout(() => {

    const sourceHtml = buildExportPreviewHtml(props.currentTitle, props.content);
    let currentLayout = normalizeDocumentPageLayout(props.pageLayout);
    let currentGeometry = pageGeometry(currentLayout);
    measureElement.style.width = `${currentGeometry.columnWidthPx}px`;
    measureElement.innerHTML = sourceHtml;
    layoutDocxTabs(measureElement);
    const pendingImages = Array.from(measureElement.querySelectorAll("img")).filter((image) => !image.complete);
    if (pendingImages.length) {
      let requested = false;
      const requestRemeasure = () => {
        if (requested) return;
        requested = true;
        setPaginationAssetVersion((version) => version + 1);
      };
      // 中文注解：图片未解码时浏览器会报告零高度，等待首个资源落定后重新测量，避免页数闪动或图片越界。
      pendingImages.forEach((image) => {
        image.addEventListener("load", requestRemeasure, { once: true });
        image.addEventListener("error", requestRemeasure, { once: true });
      });
      cleanupPendingImages = () => pendingImages.forEach((image) => {
        image.removeEventListener("load", requestRemeasure);
        image.removeEventListener("error", requestRemeasure);
      });
      return;
    }
    const sourceBlocks = Array.from(measureElement.children).map((child) => child.cloneNode(true) as HTMLElement);
    let columnContentHeight = currentGeometry.contentHeightPx;
    let currentSectionIndex = 0;
    let currentSectionPageIndex = 0;
    const nextPages: PreviewPage[] = [createPreviewPage(currentLayout, 0, 0)];
    let currentColumnIndex = 0;
    let currentHeight = 0;

    const currentPageHasContent = () => nextPages[nextPages.length - 1].columns.some((column) => column.length > 0);
    const openNextPage = (preserveBlankPage = false) => {
      if (preserveBlankPage || currentPageHasContent()) {
        currentSectionPageIndex += 1;
        nextPages.push(createPreviewPage(currentLayout, currentSectionIndex, currentSectionPageIndex));
      }
      currentColumnIndex = 0;
      currentHeight = 0;
    };
    const advanceFlowSlot = () => {
      if (currentColumnIndex < currentGeometry.columnCount - 1) {
        currentColumnIndex += 1;
        currentHeight = 0;
      } else {
        openNextPage();
      }
    };
    const openNextSection = (layoutValue: string, breakTypeValue: string) => {
      const breakType = normalizeSectionBreakType(breakTypeValue);
      const nextPageNumber = nextPages.length + 1;
      if ((breakType === "oddPage" && nextPageNumber % 2 === 0) || (breakType === "evenPage" && nextPageNumber % 2 === 1)) {
        // 中文注解：奇数页/偶数页分节需要补一张空白页，在线打印预览与 Word 的起始页码保持一致。
        openNextPage(true);
      }
      currentLayout = parseSectionPageLayout(layoutValue, currentLayout);
      currentGeometry = pageGeometry(currentLayout);
      columnContentHeight = currentGeometry.contentHeightPx;
      currentSectionIndex += 1;
      currentSectionPageIndex = 0;
      nextPages.push(createPreviewPage(currentLayout, currentSectionIndex, 0));
      currentColumnIndex = 0;
      currentHeight = 0;
    };
    const measureHtml = (html: string) => {
      measureElement.style.width = `${currentGeometry.columnWidthsPx[currentColumnIndex] || currentGeometry.columnWidthPx}px`;
      measureElement.innerHTML = html;
      layoutDocxTabs(measureElement);
      return measuredBlockHeight(measureElement.firstElementChild);
    };
    const measureTextLineCount = (html: string) => {
      measureElement.style.width = `${currentGeometry.columnWidthsPx[currentColumnIndex] || currentGeometry.columnWidthPx}px`;
      measureElement.innerHTML = html;
      layoutDocxTabs(measureElement);
      const element = measureElement.firstElementChild;
      if (!element) return 0;
      const range = document.createRange();
      range.selectNodeContents(element);
      const lineTops: number[] = [];
      for (const rect of Array.from(range.getClientRects())) {
        if (rect.width <= 0 || rect.height <= 0) continue;
        if (!lineTops.some((top) => Math.abs(top - rect.top) < 1)) lineTops.push(rect.top);
      }
      return lineTops.length;
    };
    const appendHtml = (html: string, height = measureHtml(html)) => {
      const page = nextPages[nextPages.length - 1];
      page.columns[currentColumnIndex].push(html);
      currentHeight += height;
      page.usedHeights[currentColumnIndex] = currentHeight;
      page.usedHeight = Math.max(...page.usedHeights);
    };
    const appendOversizedListItem = (list: HTMLElement, itemIndex: number) => {
      const item = Array.from(list.children).filter((child) => child.matches("li"))[itemIndex];
      const text = item?.textContent || "";
      if (!item || text.length <= 1) return false;
      let textStart = 0;
      while (textStart < text.length) {
        const availableHeight = columnContentHeight - currentHeight;
        let low = textStart + 1;
        let high = text.length;
        let bestTextEnd = textStart;
        while (low <= high) {
          const middle = Math.floor((low + high) / 2);
          const candidateHtml = listItemFragmentHtml(list, itemIndex, textStart, middle, textStart > 0, middle === text.length);
          if (measureHtml(candidateHtml) <= availableHeight) {
            bestTextEnd = middle;
            low = middle + 1;
          } else {
            high = middle - 1;
          }
        }
        if (bestTextEnd === textStart) {
          if (currentHeight > 0) return false;
          bestTextEnd = Math.min(textStart + 1, text.length);
        }
        bestTextEnd = preferredTextBreak(text, textStart, bestTextEnd);
        const fragmentHtml = listItemFragmentHtml(list, itemIndex, textStart, bestTextEnd, textStart > 0, bestTextEnd === text.length);
        appendHtml(fragmentHtml);
        textStart = bestTextEnd;
        if (textStart < text.length) advanceFlowSlot();
      }
      return true;
    };
    const appendOversizedTableRow = (table: HTMLElement, rowIndex: number) => {
      const row = Array.from(table.querySelectorAll("tr"))[rowIndex];
      if (!row) return false;
      // 中文注解：禁止跨页断行的行宁可整体移到下一页，也不能被在线分页器拆成多个伪造行。
      if (row instanceof HTMLElement && row.dataset.rowCantSplit === "true") return false;
      const cells = Array.from(row.querySelectorAll(":scope > th, :scope > td"));
      // 中文注解：纯图片单元格使用对象占位字符参与一次分页，避免被当成空单元格永久丢弃。
      const texts = cells.map((cell) => cell.textContent || (cell.querySelector("img") ? "\uFFFC" : ""));
      if (!texts.some((text) => text.length > 1)) return false;
      let starts = texts.map(() => 0);

      while (starts.some((start, index) => start < texts[index].length)) {
        const availableHeight = columnContentHeight - currentHeight;
        let low = 1;
        let high = 1000;
        let bestEnds: number[] | null = null;
        while (low <= high) {
          const fraction = Math.floor((low + high) / 2);
          const candidateEnds = starts.map((start, index) => {
            const remaining = texts[index].length - start;
            return remaining > 0 ? start + Math.max(1, Math.floor(remaining * fraction / 1000)) : start;
          });
          const candidateHtml = tableRowFragmentHtml(table, rowIndex, starts, candidateEnds, starts.some((start) => start > 0), candidateEnds.every((end, index) => end >= texts[index].length));
          if (measureHtml(candidateHtml) <= availableHeight) {
            bestEnds = candidateEnds;
            low = fraction + 1;
          } else {
            high = fraction - 1;
          }
        }
        if (!bestEnds) {
          if (currentHeight > 0) return false;
          bestEnds = starts.map((start, index) => start < texts[index].length ? start + 1 : start);
        }
        bestEnds = bestEnds.map((end, index) => end > starts[index] ? preferredTextBreak(texts[index], starts[index], end) : end);
        const isFinal = bestEnds.every((end, index) => end >= texts[index].length);
        const fragmentHtml = tableRowFragmentHtml(table, rowIndex, starts, bestEnds, starts.some((start) => start > 0), isFinal);
        appendHtml(fragmentHtml);
        starts = bestEnds;
        if (!isFinal) advanceFlowSlot();
      }
      return true;
    };

    sourceBlocks.forEach((child, childIndex) => {
      if (child instanceof HTMLElement && child.dataset.sectionBreak) {
        // 中文注解：分节符总从下一页开始，并切换后续内容的纸张方向、页边距及页眉页脚。
        openNextSection(child.dataset.sectionLayout || "", child.dataset.sectionBreak);
        return;
      }
      if (child instanceof HTMLElement && child.dataset.pageBreak === "true") {
        // 中文注解：手动分页符直接强制开启新页，保证在线分页位置和 DOCX 导出的分页位置一致。
        openNextPage(true);
        return;
      }

      if (child instanceof HTMLElement && child.dataset.pageBreakBefore === "true" && currentPageHasContent()) {
        // 中文注解：段前分页只在当前页已有内容时换页，避免段落本来就在页首时额外制造空白页。
        openNextPage();
      }

      const blockHtml = blockOuterHtml(child);
      const blockHeight = measureHtml(blockHtml);
      if (child instanceof HTMLElement && child.dataset.keepNext === "true" && currentHeight > 0) {
        const nextBlock = sourceBlocks[childIndex + 1];
        const canKeepWithNext = nextBlock instanceof HTMLElement
          && !nextBlock.dataset.pageBreak
          && !nextBlock.dataset.sectionBreak
          && nextBlock.dataset.pageBreakBefore !== "true";
        if (canKeepWithNext) {
          const nextHeight = measureHtml(blockOuterHtml(nextBlock));
          const groupHeight = blockHeight + nextHeight;
          if (groupHeight <= columnContentHeight && currentHeight + groupHeight > columnContentHeight) advanceFlowSlot();
        }
      }
      if (currentHeight + blockHeight > columnContentHeight) {
        if (child instanceof HTMLElement && child.dataset.keepLines === "true" && blockHeight <= columnContentHeight) {
          // 中文注解：段中不分页优先把完整段落移到下一页；只有单段本身超过整页时才允许兜底拆分。
          advanceFlowSlot();
          appendHtml(blockHtml, blockHeight);
          return;
        }
        const itemCount = structuredBlockItemCount(child);
        if (itemCount > 1) {
          let start = 0;
          while (start < itemCount) {
            const availableHeight = columnContentHeight - currentHeight;
            let low = start + 1;
            let high = itemCount;
            let bestEnd = start;
            while (low <= high) {
              const middle = Math.floor((low + high) / 2);
              const candidateHtml = structuredBlockFragmentHtml(child, start, middle, middle === itemCount);
              if (measureHtml(candidateHtml) <= availableHeight) {
                bestEnd = middle;
                low = middle + 1;
              } else {
                high = middle - 1;
              }
            }
            if (bestEnd === start) {
              if (child.matches("ol, ul") && appendOversizedListItem(child, start)) {
                start += 1;
                if (start < itemCount) advanceFlowSlot();
                continue;
              }
              if (child.matches("table") && appendOversizedTableRow(child, start)) {
                start += 1;
                if (start < itemCount) advanceFlowSlot();
                continue;
              }
              if (currentHeight > 0) {
                advanceFlowSlot();
                continue;
              }
              bestEnd = start + 1;
            }
            const fragmentHtml = structuredBlockFragmentHtml(child, start, bestEnd, bestEnd === itemCount);
            appendHtml(fragmentHtml);
            start = bestEnd;
            if (start < itemCount) advanceFlowSlot();
          }
          return;
        }

        const splitChild = child.cloneNode(true) as HTMLElement;
        splitChild.querySelectorAll("br").forEach((breakNode) => breakNode.replaceWith(document.createTextNode("\n")));
        if (child.querySelector("br")) splitChild.style.whiteSpace = "pre-wrap";
        const isSplittableTextBlock = splitChild.matches("p") && !splitChild.querySelector("img, table");
        const text = splitChild.textContent || "";
        if (isSplittableTextBlock && text.length > 1) {
          let start = 0;
          while (start < text.length) {
            let availableHeight = columnContentHeight - currentHeight;
            if (availableHeight < 24 && currentHeight > 0) {
              advanceFlowSlot();
              availableHeight = columnContentHeight;
            }

            let low = start + 1;
            let high = text.length;
            let bestEnd = start;
            while (low <= high) {
              const middle = Math.floor((low + high) / 2);
              const candidateHtml = textBlockFragmentHtml(splitChild, start, middle, start > 0, middle === text.length);
              const candidateHeight = measureHtml(candidateHtml);
              if (candidateHeight <= availableHeight) {
                bestEnd = middle;
                low = middle + 1;
              } else {
                high = middle - 1;
              }
            }

            if (bestEnd === start) {
              if (currentHeight > 0) {
                advanceFlowSlot();
                continue;
              }
              bestEnd = Math.min(start + 1, text.length);
            }
            bestEnd = preferredTextBreak(text, start, bestEnd);
            const widowControlEnabled = splitChild.dataset.widowControl !== "false";
            if (widowControlEnabled && bestEnd < text.length) {
              let safeEnd = start;
              let safeLow = start + 1;
              let safeHigh = bestEnd;
              // 中文注解：寻找仍能让下一页至少保留两行的最晚断点，避免段落末行单独落到下一页。
              while (safeLow <= safeHigh) {
                const middle = Math.floor((safeLow + safeHigh) / 2);
                const remainingHtml = textBlockFragmentHtml(splitChild, middle, text.length, true, true);
                if (measureTextLineCount(remainingHtml) >= 2) {
                  safeEnd = middle;
                  safeLow = middle + 1;
                } else {
                  safeHigh = middle - 1;
                }
              }
              if (safeEnd > start && safeEnd < bestEnd) bestEnd = preferredTextBreak(text, start, safeEnd);
              const currentFragmentHtml = textBlockFragmentHtml(splitChild, start, bestEnd, start > 0, false);
              if (measureTextLineCount(currentFragmentHtml) < 2 && currentHeight > 0) {
                // 中文注解：页尾空间只能容纳一行时，把整个段落片段移到下一页，避免孤立首行。
                advanceFlowSlot();
                continue;
              }
            }
            const fragmentHtml = textBlockFragmentHtml(splitChild, start, bestEnd, start > 0, bestEnd === text.length);
            appendHtml(fragmentHtml);
            start = bestEnd;
            if (start < text.length) advanceFlowSlot();
          }
          return;
        }
        advanceFlowSlot();
      }
      appendHtml(blockHtml, blockHeight);
    });

    setPreviewPages(nextPages);
    setPaginationPending(false);
    }, 16);
    return () => {
      window.clearTimeout(paginationTimer);
      cleanupPendingImages();
    };
  }, [paginationAssetVersion, props.content, props.currentTitle, props.pageLayout, props.selectedTemplate, viewMode]);

  const runSelectionAi = async (action: AiAction) => {
    const selectedText = getSelectedText(editor);
    const selection = editor?.state.selection;
    if (!editor || !selectedText || !selection) {
      setSelectionHint("当前没有选中文本。");
      return;
    }
    const result = await props.editContent(action, selectedText);
    if (result) setAiResult({ action, source: selectedText, content: result, from: selection.from, to: selection.to });
  };

  const changeSelectedTextCase = (mode: TextCaseMode) => {
    if (!editor) return;
    const { from, to } = editor.state.selection;
    const selectedText = editor.state.doc.textBetween(from, to, "\n");
    if (!selectedText.trim()) {
      setSelectionHint("请先选中文本，再调整大小写。");
      return;
    }
    editor.chain().focus().insertContentAt({ from, to }, transformTextCase(selectedText, mode)).run();
  };

  const clearSelectionFormat = () => {
    if (!editor) return;
    // 中文注解：清除格式只作用于当前光标或选区，避免影响整篇文档的排版。
    editor.chain().focus().unsetAllMarks().clearNodes().run();
  };

  const applySelectedTextStyle = (styles: Record<string, string | undefined>, label: string) => {
    if (!editor) return;
    const lastSelection = lastEditorSelectionRef.current;
    // 中文注解：保留快捷键刚形成的当前选区；只有下拉框确实让选区折叠时，才恢复最后一次非空文字选区。
    if (editor.state.selection.empty && lastSelection && lastSelection.from !== lastSelection.to) editor.commands.setTextSelection(lastSelection);
    const { from, to, empty } = editor.state.selection;
    if (!empty) {
      const markType = editor.state.schema.marks.importedTextStyle;
      let transaction = editor.state.tr;
      // 中文注解：逐个文本节点合并样式，避免修改字体时覆盖选区内原有的字号和颜色。
      editor.state.doc.nodesBetween(from, to, (node, position) => {
        if (!node.isText) return;
        const start = Math.max(from, position);
        const end = Math.min(to, position + node.nodeSize);
        if (start >= end) return;
        const currentMark = node.marks.find((mark) => mark.type === markType);
        const style = mergeStyleText(String(currentMark?.attrs.style || ""), styles, importedInlineStyleNames);
        if (currentMark) transaction = transaction.removeMark(start, end, markType);
        if (style) transaction = transaction.addMark(start, end, markType.create({ style }));
      });
      editor.view.dispatch(transaction.scrollIntoView());
      editor.view.focus();
      setSelectionHint(`已应用${label}。`);
      return;
    }
    const currentStyle = String(editor.getAttributes("importedTextStyle").style || "");
    const style = mergeStyleText(currentStyle, styles, importedInlineStyleNames);
    const applied = editor.chain().focus().setMark("importedTextStyle", { style }).run();
    setSelectionHint(applied ? `已应用${label}。` : "请先选中文本，或把光标放到要继续输入的位置。");
  };

  const applyTextHighlight = (color: string, label: string) => {
    if (!editor) return;
    const lastSelection = lastEditorSelectionRef.current;
    const chain = editor.chain();
    // 中文注解：原生颜色下拉框会夺走焦点，仅在当前选区折叠时恢复用户最后选中的文字。
    if (editor.state.selection.empty && lastSelection && lastSelection.from !== lastSelection.to) chain.setTextSelection(lastSelection);
    const applied = color === "none"
      ? chain.focus().unsetMark("textHighlight").run()
      : chain.focus().setMark("textHighlight", { color }).run();
    setSelectionHint(applied ? `已${color === "none" ? "清除" : "设置"}${label}。` : "请先选中文本，或把光标放到要继续输入的位置。");
  };

  const applyDocumentTextStyle = (style: string) => {
    if (!editor) return;
    const chain = editor.chain().focus();
    const headingLevels: Record<string, 1 | 2 | 3> = { "heading-1": 1, "heading-2": 2, "heading-3": 3 };
    const level = headingLevels[style];
    if (style !== "paragraph" && !level) {
      setSelectionHint("不支持该段落样式。");
      return;
    }
    const applied = style === "paragraph" ? chain.setParagraph().run() : chain.setHeading({ level }).run();
    setSelectionHint(applied ? "已应用段落样式。" : "请把光标放到需要调整的段落中。");
  };

  const applyOrderedListFormat = (format: string, label: string) => {
    if (!editor?.isActive("orderedList") || !Object.hasOwn(orderedListCssTypes, format)) {
      setSelectionHint("请先把光标放到编号列表中。");
      return;
    }
    const applied = editor.chain().focus().updateAttributes("orderedList", { listFormat: format }).run();
    setSelectionHint(applied ? `已设置编号格式为${label}。` : "编号格式设置失败，请重新选择列表。");
  };

  const applyParagraphAlignment = (alignment: "left" | "center" | "right" | "justify", label: string) => {
    if (!editor) return;
    const applied = (editor.chain().focus() as unknown as { setParagraphAlignment: (value: string) => { run: () => boolean } }).setParagraphAlignment(alignment).run();
    setSelectionHint(applied ? `已设置${label}。` : "请把光标放到段落或标题中，再设置对齐方式。");
  };

  const applyParagraphSpacing = (styles: ParagraphSpacingStyles, label: string) => {
    if (!editor) return;
    const applied = (editor.chain().focus() as unknown as { setParagraphSpacing: (value: ParagraphSpacingStyles) => { run: () => boolean } }).setParagraphSpacing(styles).run();
    setSelectionHint(applied ? `已设置${label}。` : "请把光标放到段落或标题中，再设置段落间距。");
  };

  const applyHangingIndent = (value: string, label: string) => {
    const length = value === "none" ? "0pt" : value;
    // 中文注解：左边距与负首行缩进成对修改，确保首行留在原位、后续各行向右缩进。
    applyParagraphSpacing({ "margin-left": length, "text-indent": value === "none" ? "0pt" : `-${length}` }, label);
  };

  const applyParagraphAppearance = (patch: ParagraphAppearancePatch, label: string) => {
    if (!editor) return;
    const lastSelection = lastEditorSelectionRef.current;
    // 中文注解：原生下拉框会夺走焦点，格式命令必须恢复用户最后停留的编辑器选区。
    const chain = editor.chain();
    if (lastSelection) chain.setTextSelection(lastSelection);
    const applied = chain.focus().setParagraphAppearance(patch).run();
    setSelectionHint(applied ? `已设置${label}。` : "请把光标放到段落或标题中，再设置段落外观。");
  };

  const toggleParagraphPagination = (attribute: ParagraphPaginationAttribute, label: string) => {
    if (!editor) return;
    const applied = editor.chain().focus().toggleParagraphPagination(attribute).run();
    setSelectionHint(applied ? `已切换${label}。` : "请把光标放到段落或标题中，再设置分页控制。");
  };

  const updateCurrentTableCell = (patch: { margin?: number; verticalAlign?: string | null; shading?: string | null; borderPreset?: string }, label: string) => {
    if (!editor || !editor.isActive("table")) {
      setSelectionHint("请先把光标放到需要设置的表格单元格中。");
      return;
    }
    const nodeType = editor.isActive("tableHeader") ? "tableHeader" : "tableCell";
    const current = editor.getAttributes(nodeType);
    const margins = patch.margin === undefined
      ? normalizeTableCellMargins(current.cellMargins)
      : normalizeTableCellMargins({ top: patch.margin, right: patch.margin, bottom: patch.margin, left: patch.margin });
    const verticalAlign = patch.verticalAlign === undefined ? String(current.cellVerticalAlign || "") : String(patch.verticalAlign || "");
    const shading = patch.shading === undefined ? String(current.cellShading || "") : String(patch.shading || "");
    const borders = patch.borderPreset === undefined ? normalizeTableBorders(current.cellBorders) : tableBorderPreset(patch.borderPreset);
    const style = tableCellStyle(margins, verticalAlign, shading, borders);
    const applied = editor.chain().focus()
      .setCellAttribute("cellMargins", margins)
      .setCellAttribute("cellVerticalAlign", verticalAlign || null)
      .setCellAttribute("cellShading", shading || null)
      .setCellAttribute("cellBorders", borders)
      .setCellAttribute("style", style)
      .run();
    // 中文注解：语义属性用于 Word 导出，style 用于编辑器和分页预览，两者必须在同一事务中更新。
    setSelectionHint(applied ? `已设置${label}。` : "当前单元格无法应用该格式。");
  };

  const updateCurrentTableRow = (patch: { height?: number; heightRule?: string; cantSplit?: boolean; repeatHeader?: boolean }, label: string) => {
    if (!editor || !editor.isActive("table")) {
      setSelectionHint("请先把光标放到需要设置的表格行中。");
      return;
    }
    const { $from } = editor.state.selection;
    let rowDepth = $from.depth;
    while (rowDepth > 0 && $from.node(rowDepth).type.name !== "tableRow") rowDepth -= 1;
    if (rowDepth <= 0) {
      setSelectionHint("当前光标不在可设置的表格行中。");
      return;
    }
    const row = $from.node(rowDepth);
    let rowHeight = patch.height === undefined ? Math.max(0, Math.round(Number(row.attrs.rowHeight) || 0)) : Math.max(0, Math.round(patch.height));
    let rowHeightRule = patch.heightRule === undefined ? String(row.attrs.rowHeightRule || "auto") : patch.heightRule;
    if (patch.height === 0) rowHeightRule = "auto";
    if (patch.heightRule && rowHeight === 0) rowHeight = 454;
    const attrs = {
      ...row.attrs,
      rowHeight,
      rowHeightRule,
      rowCantSplit: patch.cantSplit === undefined ? Boolean(row.attrs.rowCantSplit) : patch.cantSplit,
      rowRepeatHeader: patch.repeatHeader === undefined ? Boolean(row.attrs.rowRepeatHeader) : patch.repeatHeader
    };
    const transaction = editor.state.tr.setNodeMarkup($from.before(rowDepth), undefined, attrs).scrollIntoView();
    editor.view.dispatch(transaction);
    editor.view.focus();
    // 中文注解：行属性直接写入 tableRow 节点，保存、分页预览和 Word 导出共享同一份语义数据。
    setSelectionHint(`已设置${label}。`);
  };

  const insertImageFile = (file: File | null) => {
    if (!editor || !file) return;
    if (!file.type.startsWith("image/")) {
      setSelectionHint("请选择 PNG、JPG、GIF 或 WebP 图片。");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const src = String(reader.result || "");
      if (!src.startsWith("data:image/")) {
        setSelectionHint("图片读取失败，请重新选择。");
        return;
      }
      const image = new window.Image();
      image.onload = () => {
        const width = Math.max(1, image.naturalWidth || 420);
        const height = Math.max(1, image.naturalHeight || Math.round(width * 0.62));
        const scale = Math.min(1, 602 / width, 911 / height);
        // 中文注解：插入时即记录等比缩放后的真实尺寸，在线分页、尺寸控件和 DOCX 导出共享同一几何数据。
        editor.chain().focus().insertContent({ type: "image", attrs: { src, alt: file.name, widthPx: Math.round(width * scale), heightPx: Math.round(height * scale) } }).run();
        setSelectionHint("已插入图片。");
      };
      image.onerror = () => setSelectionHint("图片解码失败，请重新选择。");
      image.src = src;
    };
    reader.readAsDataURL(file);
  };

  const insertManualPageBreak = () => {
    if (!editor) return;
    // 中文注解：分页符后立刻补一个空段落，用户继续输入时会落在下一页，而不是替换分页符本身。
    editor.chain().focus().insertContent([{ type: "pageBreak" }, { type: "paragraph" }]).run();
    setSelectionHint("已插入分页符。");
  };

  const updateCurrentSectionLayout = (updater: (current: DocumentPageLayout) => DocumentPageLayout) => {
    const currentSectionIndex = activeSectionIndexRef.current;
    const nextLayout = normalizeDocumentPageLayout(updater(activeSectionLayoutRef.current));
    activeSectionLayoutRef.current = nextLayout;
    setActiveSectionLayout(nextLayout);
    if (currentSectionIndex === 0) {
      props.setPageLayout(() => nextLayout);
      return;
    }
    if (!editor) return;
    let sectionIndex = 0;
    let targetPosition = -1;
    let targetNode: ProseMirrorNode | null = null;
    editor.state.doc.descendants((node, position) => {
      if (node.type.name !== "sectionBreak") return;
      sectionIndex += 1;
      if (sectionIndex === currentSectionIndex) {
        targetPosition = position;
        targetNode = node;
      }
    });
    if (targetPosition < 0 || !targetNode) return;
    // 中文注解：后续节设置写回它前面的分节节点，正文保存后即可随文档版本持久化。
    const transaction = editor.state.tr.setNodeMarkup(targetPosition, undefined, {
      ...(targetNode as ProseMirrorNode).attrs,
      pageLayout: JSON.stringify(nextLayout)
    });
    editor.view.dispatch(transaction);
  };

  const insertSectionBreak = () => {
    if (!editor) return;
    const inheritedLayout = normalizeDocumentPageLayout(activeSectionLayoutRef.current);
    const { $from } = editor.state.selection;
    const insertPosition = $from.depth >= 1 ? $from.after(1) : editor.state.selection.to;
    // 中文注解：无论光标位于表格、列表还是普通段落，分节符都提升到当前顶层块之后，保证预览和 DOCX 拆节能识别。
    editor.chain().focus().insertContentAt(insertPosition, [
      { type: "sectionBreak", attrs: { pageLayout: JSON.stringify(inheritedLayout), breakType: "nextPage" } },
      { type: "paragraph" }
    ], { updateSelection: true }).run();
    setSelectionHint("已插入分节符（下一页），新节继承当前节页面设置。");
  };

  const applyAiFirstLineIndent = (level: number) => {
    if (!editor) return;
    const applied = editor.chain().focus().setFirstLineIndent(level).run();
    setSelectionHint(applied ? (level > 0 ? "已为当前段落设置首行缩进。" : "已取消当前段落首行缩进。") : "请把光标放到正文段落中，再调整首行缩进。");
  };

  const optimizeTitleFormat = () => {
    if (!editor) return;
    const { state } = editor;
    const tr = state.tr;
    const candidates: Array<{ node: ProseMirrorNode; position: number; level: number; nextText: string; shouldUpdateText: boolean; shouldUpdateType: boolean }> = [];

    state.doc.descendants((node, position) => {
      if (!["paragraph", "heading"].includes(node.type.name)) return;
      const rawText = node.textContent.trim();
      const level = inferHeadingLevel(rawText);
      if (!level) return;

      const nextText = cleanDetectedTitle(rawText);
      const shouldUpdateText = nextText && nextText !== rawText;
      const shouldUpdateType = node.type.name !== "heading" || node.attrs.level !== level;
      if (!shouldUpdateText && !shouldUpdateType) return;

      candidates.push({ node, position, level, nextText, shouldUpdateText: Boolean(shouldUpdateText), shouldUpdateType });
    });

    if (!candidates.length) {
      setSelectionHint("没有识别到可优化的段落标题。");
      return;
    }

    candidates.reverse().forEach(({ node, position, level, nextText, shouldUpdateText, shouldUpdateType }) => {
      // 中文注解：倒序应用修改，避免前面标题文字长度变化导致后面节点位置偏移。
      if (shouldUpdateText) tr.insertText(nextText, position + 1, position + 1 + node.content.size);
      if (shouldUpdateType) tr.setNodeMarkup(position, state.schema.nodes.heading, { level });
    });

    editor.view.dispatch(tr);
    updateOutlineFromEditor(editor);
    setSelectionHint(`已自动识别并优化 ${candidates.length} 个标题格式。`);
  };

  const applyAiResult = (mode: AiApplyMode) => {
    if (!editor || !aiResult) return;
    if (mode === "replace") editor.chain().focus().setTextSelection({ from: aiResult.from, to: aiResult.to }).insertContent(aiResultToHtml(aiResult.content)).run();
    else editor.chain().focus().setTextSelection(aiResult.to).insertContent(textToParagraphHtml(aiResult.content)).run();
    setAiResult(null);
  };

  const copyAiResult = async () => {
    if (aiResult) await navigator.clipboard.writeText(aiResult.content);
  };

  const saveEditorDocument = React.useCallback(() => {
    if (manualSavePromiseRef.current) return manualSavePromiseRef.current;
    const latestContent = editor?.getHTML() ?? props.content;
    props.setContent(latestContent);
    setManualSavePending(true);
    const request = props.saveDocument(latestContent).finally(() => {
      if (manualSavePromiseRef.current === request) manualSavePromiseRef.current = null;
      setManualSavePending(false);
    });
    // 中文注解：同步记录手动保存 Promise，连续点击或快捷键不会在 React 重渲染前重复创建版本。
    manualSavePromiseRef.current = request;
    return request;
  }, [editor, props.content, props.saveDocument, props.setContent]);

  React.useEffect(() => {
    const handleSaveShortcut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "s") return;
      // 中文注解：接管浏览器保存快捷键，确保用户保存的是当前在线文档而不是网页文件。
      event.preventDefault();
      void saveEditorDocument();
    };
    window.addEventListener("keydown", handleSaveShortcut);
    return () => window.removeEventListener("keydown", handleSaveShortcut);
  }, [saveEditorDocument]);

  const exportEditorWord = () => {
    const latestContent = editor?.getHTML() ?? props.content;
    props.setContent(latestContent);
    props.exportWord(latestContent);
  };

  const openLinkEditor = () => {
    if (!editor || (editor.state.selection.empty && !editor.isActive("link"))) {
      setSelectionHint("请先选中文字，或把光标放到已有链接中。");
      return;
    }
    setLinkUrl(editor.getAttributes("link").href || "https://");
    setLinkEditorOpen(true);
  };

  const applyHyperlink = () => {
    if (!editor) return;
    const href = normalizeSafeHyperlink(linkUrl);
    if (!href) {
      setSelectionHint("链接地址仅支持 http、https 或 mailto。");
      return;
    }
    // 中文注解：扩展到完整链接标记后再更新，保证编辑已有链接时不会只改动光标附近的字符。
    editor.chain().focus().extendMarkRange("link").setLink({ href, target: "_blank", rel: "noopener noreferrer" }).run();
    setLinkEditorOpen(false);
    setSelectionHint("已设置超链接。");
  };

  const removeHyperlink = () => {
    if (!editor?.isActive("link")) return;
    editor.chain().focus().extendMarkRange("link").unsetLink().run();
    setLinkEditorOpen(false);
    setSelectionHint("已取消超链接。");
  };

  const updateSelectedImageLayout = (mode: "inline" | "wrapLeft" | "wrapRight" | "topAndBottom") => {
    if (!editor?.isActive("image")) return;
    if (mode === "inline") {
      editor.chain().focus().updateAttributes("image", { docxFloating: null }).run();
      setSelectionHint("图片已设为嵌入型。");
      return;
    }
    const current = clientDocxFloatingValue(editor.getAttributes("image").docxFloating) || {};
    const align = mode === "wrapLeft" ? "left" : mode === "wrapRight" ? "right" : "center";
    const floating = {
      ...current,
      horizontal: { relative: "column", align, offset: null },
      vertical: current.vertical || { relative: "paragraph", align: null, offset: 0 },
      wrap: { type: mode === "topAndBottom" ? "topAndBottom" : "square", side: "bothSides" },
      margins: current.margins || { top: 0, right: 95250, bottom: 95250, left: 95250 },
      allowOverlap: current.allowOverlap !== false,
      behindDocument: false,
      lockAnchor: current.lockAnchor === true,
      layoutInCell: current.layoutInCell !== false,
      zIndex: Number(current.zIndex) || 1
    };
    editor.chain().focus().updateAttributes("image", { docxFloating: JSON.stringify(floating) }).run();
    setSelectionHint(`图片已设为${mode === "wrapLeft" ? "左侧环绕" : mode === "wrapRight" ? "右侧环绕" : "上下型环绕"}。`);
  };

  const updateSelectedImageSize = (property: "widthPx" | "heightPx", rawValue: string) => {
    if (!editor?.isActive("image")) return;
    const value = Math.max(1, Math.min(Number(rawValue) || 1, property === "widthPx" ? 602 : 911));
    const attributes = editor.getAttributes("image");
    const currentWidth = Math.max(1, Number(attributes.widthPx) || value);
    const currentHeight = Math.max(1, Number(attributes.heightPx) || value);
    const patch: Record<string, number> = { [property]: Math.round(value * 100) / 100 };
    if (imageAspectLocked) {
      if (property === "widthPx") patch.heightPx = Math.round(value * currentHeight / currentWidth * 100) / 100;
      else patch.widthPx = Math.round(value * currentWidth / currentHeight * 100) / 100;
    }
    editor.chain().focus().updateAttributes("image", patch).run();
    setSelectionHint("已调整图片尺寸。");
  };

  const jumpToOutline = (item: OutlineItem) => {
    if (!editor || typeof item.position !== "number") return;
    editor.chain().focus().setTextSelection(item.position + 1).scrollIntoView().run();
  };

  const isSaving = manualSavePending || props.saveStatus === "保存中";
  const selectedImageAttributes = editor?.isActive("image") ? editor.getAttributes("image") : null;
  const selectedImagePresentation = clientFloatingImagePresentation(selectedImageAttributes?.docxFloating);
  const activePageBorder = activeSectionLayout.pageBorders;
  const activePageBorderSample = activePageBorder?.top || activePageBorder?.right || activePageBorder?.bottom || activePageBorder?.left || null;
  const activePaperSize = activeSectionLayout.paperSize || a4PageTwip;
  const activePaperWidth = activeSectionLayout.orientation === "landscape" ? activePaperSize.height : activePaperSize.width;
  const activePaperHeight = activeSectionLayout.orientation === "landscape" ? activePaperSize.width : activePaperSize.height;
  const updateActivePageBorders = (patch: Parameters<typeof updateUniformPageBorders>[1]) => {
    updateCurrentSectionLayout((current) => ({ ...current, pageBorders: updateUniformPageBorders(current.pageBorders, patch) }));
  };
  let currentDisplayPageNumber = 0;
  let previousDisplaySection = -1;
  const previewDisplayPageNumbers = previewPages.map((page) => {
    if (page.sectionIndex !== previousDisplaySection && page.layout.pageNumberStart !== null) currentDisplayPageNumber = page.layout.pageNumberStart;
    else currentDisplayPageNumber += 1;
    previousDisplaySection = page.sectionIndex;
    return currentDisplayPageNumber;
  });

  return (
    <section className="editor-page">
      <header className="editor-toolbar">
        <div><p>正在编辑</p><h1>{props.currentTitle}</h1><span className="save-status">{props.saveStatus}</span>{props.exportStatus ? <span className="export-status">{props.exportStatus}</span> : null}{props.selectedTemplate ? <span className="export-status">模板样式：{props.selectedTemplate.name}{props.selectedTemplate.hasStyle ? "" : "（无样式文件）"}</span> : null}</div>
        <div className="toolbar-actions"><button onClick={() => void saveEditorDocument()} disabled={isSaving} title="保存文档">{isSaving ? <LoaderCircle className="spin-icon" size={17} /> : <Save size={17} />}{isSaving ? "保存中" : "保存"}</button><button onClick={props.generateBody} disabled={Boolean(props.aiLoading)}>{props.aiLoading === "正在生成正文" ? <LoaderCircle className="spin-icon" size={17} /> : <Sparkles size={17} />}{props.aiLoading === "正在生成正文" ? "生成中" : "生成正文"}</button><button onClick={exportEditorWord} disabled={props.exportStatus === "导出中"}>{props.exportStatus === "导出中" ? <LoaderCircle className="spin-icon" size={17} /> : <Download size={17} />}{props.exportStatus === "导出中" ? "导出中" : "导出 Word"}</button></div>
      </header>
      <div className={`editor-layout${props.isOutlineCollapsed ? " outline-collapsed" : ""}`}>
        <aside className="outline-panel"><div className="section-title"><ListTree size={18} /><h2>文档大纲</h2><button className="panel-collapse-button" onClick={() => props.setIsOutlineCollapsed(!props.isOutlineCollapsed)} title={props.isOutlineCollapsed ? "展开文档大纲" : "收起文档大纲"} aria-label={props.isOutlineCollapsed ? "展开文档大纲" : "收起文档大纲"}>{props.isOutlineCollapsed ? <ChevronsRight size={17} /> : <ChevronsLeft size={17} />}</button></div><div className="outline-content">{props.outline.length === 0 ? <div className="empty-state">暂无大纲，请先生成或在正文中添加标题。</div> : props.outline.map((item) => <button key={item.id} className={item.level === 3 ? "outline-child" : ""} onMouseDown={(event) => event.preventDefault()} onClick={() => jumpToOutline(item)}>{item.title}</button>)}</div></aside>
        <section className="paper-panel">
          <div className={`format-bar${viewMode === "page" ? " preview-mode" : ""}`}>
            <div className="view-mode-control" aria-label="文档视图">
              <button className={viewMode === "edit" ? "active-format" : ""} onClick={() => setViewMode("edit")} title="切换到可编辑的 A4 视图">编辑</button>
              <button className={viewMode === "page" ? "active-format" : ""} onClick={() => setViewMode("page")} title="按导出 Word 的页面尺寸预览分页">分页</button>
            </div>
            <details className="page-layout-menu">
              <summary title="设置页眉、页脚和页码"><FileText size={16} />页面设置</summary>
              <div className="page-layout-popover">
                <button type="button" className="page-layout-close" aria-label="关闭页面设置" title="关闭页面设置" onClick={(event) => { const details = event.currentTarget.closest("details"); if (details) details.open = false; }}><XCircle size={17} /></button>
                <div className="page-layout-current-section">
                  <strong>第 {activeSectionIndex + 1} 节 / 共 {sectionCount} 节</strong>
                  <span>设置作用于光标所在节</span>
                </div>
                <div className="page-layout-section">
                  <strong>纸张</strong>
                  <div className="page-margin-grid">
                    <label>规格<select aria-label="当前节纸张规格" value={documentPaperSizeValue(activeSectionLayout)} onChange={(event) => updateCurrentSectionLayout((current) => {
                      const preset = documentPaperSizes.find((item) => item.value === event.target.value);
                      if (!preset) return current;
                      return { ...current, paperSize: { width: preset.width, height: preset.height } };
                    })}>{documentPaperSizes.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}<option value="custom">自定义</option></select></label>
                    <label>方向<select aria-label="当前节纸张方向" value={activeSectionLayout.orientation} onChange={(event) => updateCurrentSectionLayout((current) => ({ ...current, orientation: event.target.value === "landscape" ? "landscape" : "portrait" }))}><option value="portrait">纵向</option><option value="landscape">横向</option></select></label>
                  </div>
                  <div className="page-margin-grid">
                    <label>纸张宽度（厘米）<input type="number" aria-label="当前节纸张宽度" min="2.54" max="88.2" step="0.1" value={twipToCentimeter(activePaperWidth)} onChange={(event) => updateCurrentSectionLayout((current) => {
                      const paperSize = current.paperSize || a4PageTwip;
                      const width = paperSizeCentimeterToTwip(event.target.value, current.orientation === "landscape" ? paperSize.height : paperSize.width);
                      return { ...current, paperSize: current.orientation === "landscape" ? { width: paperSize.width, height: width } : { width, height: paperSize.height } };
                    })} /></label>
                    <label>纸张高度（厘米）<input type="number" aria-label="当前节纸张高度" min="2.54" max="88.2" step="0.1" value={twipToCentimeter(activePaperHeight)} onChange={(event) => updateCurrentSectionLayout((current) => {
                      const paperSize = current.paperSize || a4PageTwip;
                      const height = paperSizeCentimeterToTwip(event.target.value, current.orientation === "landscape" ? paperSize.width : paperSize.height);
                      return { ...current, paperSize: current.orientation === "landscape" ? { width: height, height: paperSize.height } : { width: paperSize.width, height } };
                    })} /></label>
                  </div>
                  <div className="page-margin-grid">
                    {(["top", "bottom", "left", "right"] as const).map((side) => {
                      const labels = { top: "上", bottom: "下", left: "左", right: "右" };
                      return <label key={side}>{labels[side]}边距（厘米）<input type="number" aria-label={`当前节${labels[side]}边距`} min="0" max="12.7" step="0.1" value={twipToCentimeter(activeSectionLayout.margins[side])} onChange={(event) => updateCurrentSectionLayout((current) => ({ ...current, margins: { ...current.margins, [side]: centimeterToTwip(event.target.value, current.margins[side]) } }))} /></label>;
                    })}
                  </div>
                  <div className="page-margin-grid">
                    <label>页眉距纸边（厘米）<input type="number" aria-label="当前节页眉距纸边" min="0" max="12.7" step="0.1" value={twipToCentimeter(activeSectionLayout.headerDistance)} onChange={(event) => updateCurrentSectionLayout((current) => ({ ...current, headerDistance: centimeterToTwip(event.target.value, current.headerDistance) }))} /></label>
                    <label>页脚距纸边（厘米）<input type="number" aria-label="当前节页脚距纸边" min="0" max="12.7" step="0.1" value={twipToCentimeter(activeSectionLayout.footerDistance)} onChange={(event) => updateCurrentSectionLayout((current) => ({ ...current, footerDistance: centimeterToTwip(event.target.value, current.footerDistance) }))} /></label>
                  </div>
                  <div className="page-margin-grid">
                    <label>分栏<select aria-label="当前节分栏数" value={activeSectionLayout.columns.count} onChange={(event) => updateCurrentSectionLayout((current) => {
                      const count = Number(event.target.value);
                      return { ...current, columns: current.columns.equalWidth === false && count > 1 ? createCustomPageColumns(current, count) : { count, space: current.columns.space, separate: current.columns.separate } };
                    })}>{Array.from({ length: 8 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1} 栏</option>)}</select></label>
                    <label>栏宽方式<select aria-label="当前节分栏布局" disabled={activeSectionLayout.columns.count <= 1} value={activeSectionLayout.columns.equalWidth === false ? "custom" : "equal"} onChange={(event) => updateCurrentSectionLayout((current) => ({
                      ...current,
                      columns: event.target.value === "custom" ? createCustomPageColumns(current) : { count: current.columns.count, space: current.columns.space, separate: current.columns.separate }
                    }))}><option value="equal">等宽</option><option value="custom">自定义</option></select></label>
                  </div>
                  {activeSectionLayout.columns.equalWidth === false && activeSectionLayout.columns.items ? <div className="custom-column-grid">
                    {activeSectionLayout.columns.items.map((item, index) => <React.Fragment key={index}>
                      <label>第 {index + 1} 栏宽度（厘米）<input type="number" aria-label={`当前节第${index + 1}栏宽度`} min="0.1" max="30" step="0.1" value={twipToCentimeter(item.width)} onChange={(event) => updateCurrentSectionLayout((current) => ({ ...current, columns: { ...current.columns, items: current.columns.items?.map((column, columnIndex) => columnIndex === index ? { ...column, width: columnWidthCentimeterToTwip(event.target.value, column.width) } : column) } }))} /></label>
                      {index < activeSectionLayout.columns.count - 1 ? <label>第 {index + 1} 栏后间距（厘米）<input type="number" aria-label={`当前节第${index + 1}栏后间距`} min="0" max="12.7" step="0.1" value={twipToCentimeter(item.space)} onChange={(event) => updateCurrentSectionLayout((current) => ({ ...current, columns: { ...current.columns, items: current.columns.items?.map((column, columnIndex) => columnIndex === index ? { ...column, space: centimeterToTwip(event.target.value, column.space) } : column) } }))} /></label> : <span />}
                    </React.Fragment>)}
                  </div> : <label>栏间距（厘米）<input type="number" aria-label="当前节栏间距" min="0" max="12.7" step="0.1" value={twipToCentimeter(activeSectionLayout.columns.space)} onChange={(event) => updateCurrentSectionLayout((current) => ({ ...current, columns: { ...current.columns, space: centimeterToTwip(event.target.value, current.columns.space) } }))} /></label>}
                  <label className="page-number-toggle"><input type="checkbox" aria-label="当前节分栏分隔线" checked={activeSectionLayout.columns.separate} disabled={activeSectionLayout.columns.count <= 1} onChange={(event) => updateCurrentSectionLayout((current) => ({ ...current, columns: { ...current.columns, separate: event.target.checked } }))} />分隔线</label>
                  <div className="page-margin-grid">
                    <label>页面垂直对齐<select aria-label="当前节页面垂直对齐" value={activeSectionLayout.verticalAlign} onChange={(event) => updateCurrentSectionLayout((current) => ({ ...current, verticalAlign: event.target.value as DocumentPageLayout["verticalAlign"] }))}><option value="top">顶端</option><option value="center">居中</option><option value="bottom">底端</option><option value="both" disabled={activeSectionLayout.columns.count > 1}>两端对齐</option></select></label>
                    <label>页面边框<select aria-label="当前节页面边框样式" value={activePageBorderSample?.style || "none"} onChange={(event) => updateActivePageBorders(event.target.value === "none" ? { remove: true } : { style: event.target.value })}>{pageBorderStyleOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
                  </div>
                  <div className="page-margin-grid">
                    <label>边框粗细<select aria-label="当前节页面边框粗细" disabled={!activePageBorderSample} value={activePageBorderSample?.size || 8} onChange={(event) => updateActivePageBorders({ size: Number(event.target.value) })}><option value="4">0.5 磅</option><option value="8">1 磅</option><option value="12">1.5 磅</option><option value="18">2.25 磅</option></select></label>
                    <label>边框颜色<input type="color" aria-label="当前节页面边框颜色" disabled={!activePageBorderSample} value={activePageBorderSample?.color || "#245F55"} onChange={(event) => updateActivePageBorders({ color: event.target.value })} /></label>
                  </div>
                  <div className="page-margin-grid">
                    <label>距参考线（厘米）<input type="number" aria-label="当前节页面边框距离" disabled={!activePageBorderSample} min="0" max="1.1" step="0.05" value={Math.round((activePageBorderSample?.space || 0) * 2.54 / 72 * 100) / 100} onChange={(event) => updateActivePageBorders({ space: Math.max(0, Math.min(31, Math.round(Number(event.target.value) / 2.54 * 72))) })} /></label>
                    <label>距离基准<select aria-label="当前节页面边框距离基准" disabled={!activePageBorderSample} value={activePageBorder?.offsetFrom || "page"} onChange={(event) => updateActivePageBorders({ offsetFrom: event.target.value as DocumentPageBorders["offsetFrom"] })}><option value="page">纸张边缘</option><option value="text">正文区域</option></select></label>
                  </div>
                  <div className="page-margin-grid">
                    <label>显示范围<select aria-label="当前节页面边框显示范围" disabled={!activePageBorderSample} value={activePageBorder?.display || "allPages"} onChange={(event) => updateActivePageBorders({ display: event.target.value as DocumentPageBorders["display"] })}><option value="allPages">本节所有页</option><option value="firstPage">仅本节首页</option><option value="notFirstPage">除本节首页</option></select></label>
                    <label>边框层级<select aria-label="当前节页面边框层级" disabled={!activePageBorderSample} value={activePageBorder?.zOrder || "front"} onChange={(event) => updateActivePageBorders({ zOrder: event.target.value as DocumentPageBorders["zOrder"] })}><option value="front">文字前方</option><option value="back">文字后方</option></select></label>
                  </div>
                  <div className="page-margin-grid">
                    <label>页码格式<select aria-label="当前节页码格式" value={activeSectionLayout.pageNumberFormat} onChange={(event) => updateCurrentSectionLayout((current) => ({ ...current, pageNumberFormat: event.target.value as DocumentPageLayout["pageNumberFormat"] }))}><option value="decimal">1, 2, 3</option><option value="upperRoman">I, II, III</option><option value="lowerRoman">i, ii, iii</option><option value="upperLetter">A, B, C</option><option value="lowerLetter">a, b, c</option></select></label>
                    <label>起始页码<input type="number" aria-label="当前节起始页码" min="0" max="999999" placeholder="续前节" value={activeSectionLayout.pageNumberStart ?? ""} onChange={(event) => updateCurrentSectionLayout((current) => ({ ...current, pageNumberStart: event.target.value === "" ? null : Math.max(0, Math.min(Math.round(Number(event.target.value)), 999999)) }))} /></label>
                  </div>
                </div>
                <div className="page-layout-section">
                  <PageVariantSettings title="默认页" variant={activeSectionLayout} uploadPageImage={props.uploadPageImage} onChange={(variant) => updateCurrentSectionLayout((current) => ({ ...current, ...variant }))} />
                </div>
                <label className="page-number-toggle page-layout-switch"><input type="checkbox" checked={activeSectionLayout.firstPageDifferent} onChange={(event) => updateCurrentSectionLayout((current) => ({ ...current, firstPageDifferent: event.target.checked }))} />首页不同</label>
                {activeSectionLayout.firstPageDifferent ? <div className="page-layout-section page-layout-variant">
                  <PageVariantSettings title="首页" variant={activeSectionLayout.firstPage} uploadPageImage={props.uploadPageImage} onChange={(firstPage) => updateCurrentSectionLayout((current) => ({ ...current, firstPage }))} />
                </div> : null}
                <label className="page-number-toggle page-layout-switch"><input type="checkbox" checked={activeSectionLayout.oddEvenDifferent} onChange={(event) => updateCurrentSectionLayout((current) => ({ ...current, oddEvenDifferent: event.target.checked }))} />奇偶页不同</label>
                {activeSectionLayout.oddEvenDifferent ? <div className="page-layout-section page-layout-variant">
                  <PageVariantSettings title="偶数页" variant={activeSectionLayout.evenPage} uploadPageImage={props.uploadPageImage} onChange={(evenPage) => updateCurrentSectionLayout((current) => ({ ...current, evenPage }))} />
                </div> : null}
              </div>
            </details>
            {viewMode === "edit" ? <>
            <button onClick={() => editor?.chain().focus().undo().run()} disabled={!editor?.can().undo()} title="撤销" aria-label="撤销"><Undo2 size={16} /></button>
            <button onClick={() => editor?.chain().focus().redo().run()} disabled={!editor?.can().redo()} title="重做" aria-label="重做"><Redo2 size={16} /></button>
            <button onClick={insertManualPageBreak} title="在当前位置插入分页符"><FileText size={16} />分页符</button>
            <button onClick={insertSectionBreak} title="从下一页开始新节并允许独立页面设置"><Rows3 size={16} />分节符</button>
            <span className="format-divider" />
            <FormatSelect title="设置当前段落样式" placeholder="段落样式" options={paragraphStyleOptions} onSelect={(value) => applyDocumentTextStyle(value)} />
            <button className={editor?.isActive("bold") ? "active-format" : ""} onClick={() => editor?.chain().focus().toggleBold().run()} title="加粗"><Bold size={16} />加粗</button>
            <button className={editor?.isActive("italic") ? "active-format" : ""} onClick={() => editor?.chain().focus().toggleItalic().run()} title="斜体"><Italic size={16} /></button>
            <button className={editor?.isActive("underline") ? "active-format" : ""} onClick={() => editor?.chain().focus().toggleUnderline().run()} title="下划线"><UnderlineIcon size={16} />下划线</button>
            <FormatSelect title="设置选中文字的下划线样式" placeholder="下划线样式" options={underlineStyleOptions} onSelect={(value, label) => applySelectedTextStyle({ "text-decoration-line": "underline", "text-decoration-style": underlineCssStyleByType[value] || "solid", "--word-underline-type": value }, label)} />
            <FormatSelect title="设置或清除选中文字的 Word 字符边框" placeholder="字符边框" options={textBorderOptions} onSelect={(value, label) => applySelectedTextStyle(textBorderStylePatch(value), label)} />
            <button aria-label="设置超链接" className={editor?.isActive("link") ? "active-format" : ""} onClick={openLinkEditor} title="设置超链接"><Link2 size={16} /></button>
            <button aria-label="取消超链接" onClick={removeHyperlink} disabled={!editor?.isActive("link")} title="取消超链接"><Unlink size={16} /></button>
            {linkEditorOpen ? <div className="link-editor">
              <input aria-label="超链接地址" autoFocus value={linkUrl} onChange={(event) => setLinkUrl(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") applyHyperlink(); if (event.key === "Escape") setLinkEditorOpen(false); }} />
              <button aria-label="确认超链接" onClick={applyHyperlink} title="确认超链接"><Check size={16} /></button>
              <button aria-label="关闭超链接编辑" onClick={() => setLinkEditorOpen(false)} title="关闭"><X size={16} /></button>
            </div> : null}
            <button className={editor?.isActive("strike") ? "active-format" : ""} onClick={() => editor?.chain().focus().toggleStrike().run()} title="删除线"><Strikethrough size={16} /></button>
            <button aria-label="黄色突出显示" className={editor?.isActive("textHighlight", { color: "yellow" }) ? "active-format" : ""} onClick={() => applyTextHighlight("yellow", "黄色突出显示")} title="黄色突出显示"><Highlighter size={16} /></button>
            <FormatSelect title="设置或清除选中文字的 Word 突出显示颜色" placeholder="突出显示" options={highlightColorOptions} onSelect={(value, label) => applyTextHighlight(value, label)} />
            <button aria-label="上标" className={editor?.isActive("superscriptText") ? "active-format" : ""} onClick={() => editor?.chain().focus().toggleMark("superscriptText").run()} title="上标"><Superscript size={16} /></button>
            <button aria-label="下标" className={editor?.isActive("subscriptText") ? "active-format" : ""} onClick={() => editor?.chain().focus().toggleMark("subscriptText").run()} title="下标"><Subscript size={16} /></button>
            <label className="format-select" title="设置选中文字字体">
              <Type size={16} />
              <select aria-label="字体" defaultValue="" onChange={(event) => { if (event.target.value) applySelectedTextStyle({ "font-family": event.target.value }, "字体"); event.target.value = ""; }}>
                <option value="">字体</option>
                {fontFamilyOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label className="format-select" title="设置选中文字字号">
              <Type size={16} />
              <select aria-label="字号" defaultValue="" onChange={(event) => { if (event.target.value) applySelectedTextStyle({ "font-size": event.target.value }, "字号"); event.target.value = ""; }}>
                <option value="">字号</option>
                {fontSizeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <FormatSelect title="设置选中文字的字符间距" placeholder="字符间距" options={characterSpacingOptions} onSelect={(value, label) => applySelectedTextStyle({ "letter-spacing": value === "normal" ? undefined : value }, `字符间距：${label}`)} />
            <FormatSelect title="设置选中文字相对基线的升降位置" placeholder="文字位置" options={baselinePositionOptions} onSelect={(value, label) => applySelectedTextStyle({ "vertical-align": value === "baseline" ? undefined : value }, `文字位置：${label}`)} />
            <FormatSelect title="设置选中文字的非破坏性字母大小写格式" placeholder="字母格式" options={letterCaseFormatOptions} onSelect={(value, label) => applySelectedTextStyle({ "text-transform": value === "uppercase" ? "uppercase" : undefined, "font-variant-caps": value === "small-caps" ? "small-caps" : undefined }, label)} />
            <label className="format-select" title="设置选中文字颜色">
              <Type size={16} />
              <select aria-label="文字颜色" defaultValue="" onChange={(event) => { if (event.target.value) applySelectedTextStyle({ color: event.target.value }, "颜色"); event.target.value = ""; }}>
                <option value="">颜色</option>
                {textColorOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <button className={editor?.isActive("bulletList") ? "active-format" : ""} onClick={() => editor?.chain().focus().toggleBulletList().run()} title="项目符号列表"><List size={16} />列表</button>
            <button className={editor?.isActive("orderedList") ? "active-format" : ""} onClick={() => editor?.chain().focus().toggleOrderedList().run()} title="编号列表"><ListOrdered size={16} />编号</button>
            <FormatSelect title="设置当前编号列表的编号格式" placeholder="编号格式" options={orderedListFormatOptions} icon={<ListOrdered size={16} />} disabled={!editor?.isActive("orderedList")} onSelect={(value, label) => applyOrderedListFormat(value, label)} />
            <button onClick={() => editor?.chain().focus().insertContent({ type: "docxTab", attrs: { positionTwip: 720, alignment: "left" } }).run()} title="插入制表符">制表位</button>
            <span className="format-divider" />
            <button onClick={() => editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} title="插入 3x3 表格"><TableIcon size={16} />表格</button>
            <button onClick={() => editor?.chain().focus().addRowAfter().run()} disabled={!editor?.isActive("table")} title="下方插入行">加行</button>
            <button onClick={() => editor?.chain().focus().addColumnAfter().run()} disabled={!editor?.isActive("table")} title="右侧插入列">加列</button>
            <button onClick={() => editor?.chain().focus().deleteRow().run()} disabled={!editor?.isActive("table")} title="删除当前行">删行</button>
            <button onClick={() => editor?.chain().focus().deleteColumn().run()} disabled={!editor?.isActive("table")} title="删除当前列">删列</button>
            <button onClick={() => editor?.chain().focus().deleteTable().run()} disabled={!editor?.isActive("table")} title="删除表格">删表</button>
            <button onClick={() => editor?.chain().focus().mergeCells().run()} disabled={!editor?.can().mergeCells()} title="合并选中的单元格"><Combine size={16} />合并</button>
            <button onClick={() => editor?.chain().focus().splitCell().run()} disabled={!editor?.can().splitCell()} title="拆分当前合并单元格"><Split size={16} />拆分</button>
            <button onClick={() => editor?.chain().focus().toggleHeaderCell().run()} disabled={!editor?.isActive("table")} title="切换当前单元格为表头"><PanelTop size={16} />表头</button>
            <FormatSelect title="设置当前表格行高度" placeholder="行高" options={tableRowHeightOptions} icon={<Rows3 size={16} />} disabled={!editor?.isActive("table")} onSelect={(value, label) => updateCurrentTableRow({ height: Number(value) }, label)} />
            <FormatSelect title="设置当前表格行高度规则" placeholder="行高规则" options={tableRowHeightRuleOptions} disabled={!editor?.isActive("table")} onSelect={(value, label) => updateCurrentTableRow({ heightRule: value }, `行高${label}`)} />
            <button className={editor?.getAttributes("tableRow").rowCantSplit ? "active-format" : ""} onClick={() => updateCurrentTableRow({ cantSplit: !editor?.getAttributes("tableRow").rowCantSplit }, "禁止跨页断行")} disabled={!editor?.isActive("table")} title="禁止当前表格行跨页拆分">整行同页</button>
            <button className={editor?.getAttributes("tableRow").rowRepeatHeader ? "active-format" : ""} onClick={() => updateCurrentTableRow({ repeatHeader: !editor?.getAttributes("tableRow").rowRepeatHeader }, "重复标题行")} disabled={!editor?.isActive("table")} title="在后续页面顶部重复当前标题行">重复标题</button>
            <FormatSelect title="设置当前单元格垂直对齐" placeholder="单元格对齐" options={tableCellVerticalAlignOptions} onSelect={(value, label) => updateCurrentTableCell({ verticalAlign: value }, `单元格${label}对齐`)} />
            <FormatSelect title="设置当前单元格内边距" placeholder="单元格边距" options={tableCellPaddingOptions} onSelect={(value, label) => updateCurrentTableCell({ margin: Number(value) }, `${label}单元格边距`)} />
            <FormatSelect title="设置当前单元格底色" placeholder="单元格底色" options={tableCellShadingOptions} onSelect={(value, label) => updateCurrentTableCell({ shading: value === "none" ? null : value }, `单元格${label}`)} />
            <FormatSelect title="设置当前单元格边框" placeholder="单元格边框" options={tableCellBorderOptions} onSelect={(value, label) => updateCurrentTableCell({ borderPreset: value }, `单元格${label}`)} />
            <button onClick={() => imageInputRef.current?.click()} title="插入图片"><ImageIcon size={16} />图片</button>
            {selectedImageAttributes ? <div className="image-format-control">
              <div className="image-layout-segments" aria-label="图片文字环绕方式">
                <button className={!selectedImagePresentation ? "active-format" : ""} onClick={() => updateSelectedImageLayout("inline")} title="图片作为字符参与正文排版">嵌入</button>
                <button className={selectedImagePresentation?.wrap === "square" && selectedImagePresentation.align === "left" ? "active-format" : ""} onClick={() => updateSelectedImageLayout("wrapLeft")} title="文字环绕在图片右侧">左环绕</button>
                <button className={selectedImagePresentation?.wrap === "square" && selectedImagePresentation.align === "right" ? "active-format" : ""} onClick={() => updateSelectedImageLayout("wrapRight")} title="文字环绕在图片左侧">右环绕</button>
                <button className={selectedImagePresentation?.wrap === "topAndBottom" ? "active-format" : ""} onClick={() => updateSelectedImageLayout("topAndBottom")} title="文字仅显示在图片上下方">上下型</button>
              </div>
              <label>宽<input aria-label="选中图片宽度" type="number" min="1" max="602" value={Math.round(Number(selectedImageAttributes.widthPx) || 1)} onChange={(event) => updateSelectedImageSize("widthPx", event.target.value)} /></label>
              <label>高<input aria-label="选中图片高度" type="number" min="1" max="911" value={Math.round(Number(selectedImageAttributes.heightPx) || 1)} onChange={(event) => updateSelectedImageSize("heightPx", event.target.value)} /></label>
              <label className="image-aspect-lock"><input aria-label="锁定图片纵横比" type="checkbox" checked={imageAspectLocked} onChange={(event) => setImageAspectLocked(event.target.checked)} />锁定比例</label>
            </div> : null}
            <input ref={imageInputRef} className="hidden-file-input" type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={(event) => { insertImageFile(event.target.files?.[0] || null); event.currentTarget.value = ""; }} />
            <span className="format-divider" />
            <button onClick={() => applyParagraphAlignment("left", "左对齐")} title="左对齐"><AlignLeft size={16} /></button>
            <button onClick={() => applyParagraphAlignment("center", "居中对齐")} title="居中对齐"><AlignCenter size={16} /></button>
            <button onClick={() => applyParagraphAlignment("right", "右对齐")} title="右对齐"><AlignRight size={16} /></button>
            <button onClick={() => applyParagraphAlignment("justify", "两端对齐")} title="两端对齐"><AlignJustify size={16} /></button>
            <span className="format-divider" />
            <FormatSelect title="设置当前段落或选区的行距" placeholder="行距" options={lineSpacingOptions} icon={<Rows3 size={16} />} onSelect={(value, label) => applyParagraphSpacing({ "line-height": value, "--word-line-rule": "auto" }, `${label}行距`)} />
            <FormatSelect title="设置当前段落或选区的段前间距" placeholder="段前" options={paragraphSpacingOptions} onSelect={(value) => applyParagraphSpacing({ "margin-top": value }, `段前 ${value}`)} />
            <FormatSelect title="设置当前段落或选区的段后间距" placeholder="段后" options={paragraphSpacingOptions} onSelect={(value) => applyParagraphSpacing({ "margin-bottom": value }, `段后 ${value}`)} />
            <FormatSelect title="设置当前段落或选区的悬挂缩进" placeholder="悬挂缩进" options={hangingIndentOptions} icon={<IndentIncrease size={16} />} onSelect={(value, label) => applyHangingIndent(value, `${label}悬挂缩进`)} />
            <FormatSelect title="设置当前段落或选区的左缩进" placeholder="左缩进" options={paragraphSideIndentOptions} icon={<IndentIncrease size={16} />} onSelect={(value, label) => applyParagraphSpacing({ "margin-left": value }, `${label}左缩进`)} />
            <FormatSelect title="设置当前段落或选区的右缩进" placeholder="右缩进" options={paragraphSideIndentOptions} icon={<IndentDecrease size={16} />} onSelect={(value, label) => applyParagraphSpacing({ "margin-right": value }, `${label}右缩进`)} />
            <FormatSelect title="设置当前段落或选区的底纹" placeholder="段落底纹" options={paragraphShadingOptions} onSelect={(value, label) => applyParagraphAppearance({ shading: value === "none" ? null : JSON.stringify({ fill: value, color: "#000000", type: "clear" }) }, `段落${label}`)} />
            <FormatSelect title="设置当前段落或选区的边框" placeholder="段落边框" options={paragraphBorderOptions} onSelect={(value, label) => applyParagraphAppearance({ borders: paragraphBorderPreset(value) }, `段落${label}`)} />
            <button className={editor?.getAttributes("paragraph").keepNext || editor?.getAttributes("heading").keepNext ? "active-format" : ""} onClick={() => toggleParagraphPagination("keepNext", "与下段同页")} title="保持当前段落与下一段在同一页">与下段同页</button>
            <button className={editor?.getAttributes("paragraph").keepLines || editor?.getAttributes("heading").keepLines ? "active-format" : ""} onClick={() => toggleParagraphPagination("keepLines", "段中不分页")} title="避免当前段落被拆到两页">段中不分页</button>
            <button className={editor?.getAttributes("paragraph").pageBreakBefore || editor?.getAttributes("heading").pageBreakBefore ? "active-format" : ""} onClick={() => toggleParagraphPagination("pageBreakBefore", "段前分页")} title="让当前段落从新页开始">段前分页</button>
            <button className={(editor?.getAttributes("paragraph").widowControl ?? editor?.getAttributes("heading").widowControl) !== false ? "active-format" : ""} onClick={() => toggleParagraphPagination("widowControl", "孤行控制")} title="避免段落首行或末行单独出现在一页">孤行控制</button>
            <span className="format-divider" />
            <button onClick={() => editor?.chain().focus().decreaseIndent().run()} title="减少首行缩进"><IndentDecrease size={16} />减少首行</button>
            <button onClick={() => editor?.chain().focus().increaseIndent().run()} title="增加首行缩进"><IndentIncrease size={16} />首行缩进</button>
            <span className="format-divider" />
            <button onClick={() => changeSelectedTextCase("upper")} title="将选中文字转为大写"><Type size={16} />大写</button>
            <button onClick={() => changeSelectedTextCase("lower")} title="将选中文字转为小写"><Type size={16} />小写</button>
            <button onClick={() => changeSelectedTextCase("title")} title="将选中英文转为首字母大写"><Type size={16} />首字母</button>
            <button onClick={clearSelectionFormat} title="清除当前选区格式"><Eraser size={16} />清除格式</button>
            </> : null}
          </div>
          {props.aiLoading === "正在生成正文" || paginationPending ? <div className="paper-loading"><LoadingProcess label={paginationPending ? "正在计算分页" : props.aiLoading || "正在处理"} /></div> : null}
          <div className="editor-scroll" style={documentPreviewStyle(props.selectedTemplate)}>
            <div className={viewMode === "edit" ? "editor-source" : "editor-source is-hidden"}>
              <div className="editor-paper">
                <h1 className="editor-document-title">{props.currentTitle || "未命名文档"}</h1>
                <EditorContent editor={editor} />
              </div>
            </div>
            {viewMode === "page" ? (
              <div className="paged-preview" aria-label="分页预览">
                {previewPages.map((page, index) => {
                  const pageVariant = pageVariantForPage(page.layout, index, page.sectionPageIndex);
                  return <article className="page-sheet" data-section-index={page.sectionIndex} data-section-page-index={page.sectionPageIndex} style={pageGeometryStyle(page.layout, page.sectionPageIndex, page.usedHeight)} key={index}>
                    {pageVariant.headerText || pageVariant.headerImages.length || pageVariant.headerPageNumberTemplate ? <div className="page-header multiline" style={pageTextCssStyle(pageVariant.headerStyle)}>
                      <PagePartContent text={pageVariant.headerText} images={pageVariant.headerImages} pageNumberTemplate={pageVariant.headerPageNumberTemplate} pageNumberSeparate={pageVariant.headerPageNumberSeparate} pageNumber={previewDisplayPageNumbers[index]} pageCount={previewPages.length} pageNumberFormat={page.layout.pageNumberFormat} />
                    </div> : null}
                    <div className={`page-body${page.layout.verticalAlign === "both" && page.layout.columns.count === 1 ? " page-vertical-both" : ""}`}>
                      {page.columns.flatMap((column, columnIndex) => [
                        <div className="page-column" data-column-index={columnIndex} style={{ gridColumn: columnIndex * 2 + 1 }} key={`column-${index}-${columnIndex}`}>
                          {column.map((html, blockIndex) => <div className="page-block" key={`${index}-${columnIndex}-${blockIndex}`} dangerouslySetInnerHTML={{ __html: html }} />)}
                        </div>,
                        ...(columnIndex < page.columns.length - 1 ? [<div className="page-column-separator" aria-hidden="true" style={{ gridColumn: columnIndex * 2 + 2 }} key={`separator-${index}-${columnIndex}`} />] : [])
                      ])}
                    </div>
                    {pageVariant.footerText || pageVariant.footerImages.length || pageVariant.footerPageNumberTemplate ? <div className="page-footer multiline" style={pageTextCssStyle(pageVariant.footerStyle)}>
                      <PagePartContent text={pageVariant.footerText} images={pageVariant.footerImages} pageNumberTemplate={pageVariant.footerPageNumberTemplate} pageNumberSeparate={pageVariant.footerPageNumberSeparate} pageNumber={previewDisplayPageNumbers[index]} pageCount={previewPages.length} pageNumberFormat={page.layout.pageNumberFormat} />
                    </div> : null}
                  </article>;
                })}
              </div>
            ) : null}
            <div className="pagination-measurer" ref={paginationMeasureRef} aria-hidden="true" />
          </div>
        </section>
        <aside className="ai-panel"><div className="section-title"><Bot size={18} /><h2>AI 助手</h2></div><div className="points-cost">生成大纲 {usageCosts.outline} 积分 · 生成正文 {usageCosts.body} 积分 · 局部编辑 {usageCosts.edit} 积分 · 导出 {usageCosts.exportDocx} 积分</div>{props.pointsEnabled ? <div className="selection-hint">当前剩余积分：{props.pointsRemaining ?? "未知"}</div> : null}<div className="selection-hint">{selectionHint}</div><button onClick={() => runSelectionAi("polish")} disabled={Boolean(props.aiLoading) || !hasSelection}><Sparkles size={17} />润色选中文本</button><button onClick={() => runSelectionAi("format")} disabled={Boolean(props.aiLoading) || !hasSelection}><ListTree size={17} />格式优化选中</button><button onClick={optimizeTitleFormat} disabled={Boolean(props.aiLoading)}><PenLine size={17} />AI标题优化</button><button onClick={() => applyAiFirstLineIndent(1)} disabled={Boolean(props.aiLoading)}><IndentIncrease size={17} />AI首行缩进</button><button onClick={() => applyAiFirstLineIndent(0)} disabled={Boolean(props.aiLoading)}><IndentDecrease size={17} />取消首行缩进</button><button onClick={() => runSelectionAi("continue")} disabled={Boolean(props.aiLoading) || !hasSelection}><Wand2 size={17} />续写选中文本</button><button onClick={() => runSelectionAi("expand")} disabled={Boolean(props.aiLoading) || !hasSelection}><AlignLeft size={17} />扩写选中文本</button><button onClick={() => runSelectionAi("shorten")} disabled={Boolean(props.aiLoading) || !hasSelection}><AlignLeft size={17} />缩写选中文本</button><button onClick={() => runSelectionAi("correct")} disabled={Boolean(props.aiLoading) || !hasSelection}><CheckCircle2 size={17} />纠错选中文本</button><button onClick={props.generateBody} disabled={Boolean(props.aiLoading)}><ListTree size={17} />根据大纲生成正文</button>{props.aiLoading ? <LoadingProcess label={props.aiLoading} compact /> : null}{props.exportStatus === "导出中" ? <LoadingProcess label="正在导出 Word" compact /> : null}{props.aiError ? <div className="ai-message error"><XCircle size={16} /><span>{props.aiError}</span></div> : null}{aiResult ? <div className="ai-result"><strong>AI 处理结果</strong><p>{aiResult.content}</p><div className="ai-result-actions"><button onClick={() => applyAiResult("replace")}>替换原文</button><button onClick={() => applyAiResult("insert")}>插入下方</button><button onClick={copyAiResult}>复制结果</button><button onClick={() => setAiResult(null)}>取消结果</button></div></div> : null}<div className="assistant-note"><strong>{props.aiStatus}</strong><span>AI 密钥仅保存在服务端；墨灵积分只会在动作成功后扣减。</span></div></aside>
      </div>
    </section>
  );
}

// 中文注解：墨灵 launch ticket 是一次性票据；开发态 StrictMode 会重复执行初始化逻辑，容易二次消费同一张票据。
createRoot(document.getElementById("root")!).render(<App />);
