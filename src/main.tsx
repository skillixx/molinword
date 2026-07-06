import React from "react";
import { createRoot } from "react-dom/client";
import { EditorContent, useEditor, type Editor as TiptapEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  AlignLeft,
  Bold,
  Bot,
  CheckCircle2,
  ChevronRight,
  Download,
  FileText,
  FolderOpen,
  LayoutTemplate,
  LoaderCircle,
  List,
  ListOrdered,
  ListTree,
  PenLine,
  Plus,
  RefreshCw,
  Save,
  Search,
  Sparkles,
  Wand2,
  XCircle
} from "lucide-react";
import "./styles.css";

type DocumentType = "工作总结" | "会议纪要" | "商业计划书" | "合同协议" | "论文材料" | "活动方案";
type AiAction = "continue" | "expand" | "shorten" | "correct" | "polish";
type AiApplyMode = "replace" | "insert";

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
  outline: string[];
  content: string;
  wordCount: number;
  updatedAt: string;
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

type TemplateItem = {
  name: string;
  documentType: DocumentType;
  topic: string;
  requirement: string;
  outline: string[];
};

const documentTypes: DocumentType[] = ["工作总结", "会议纪要", "商业计划书", "合同协议", "论文材料", "活动方案"];
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
  "正在导出 Word": ["保存当前文档", "生成 Word 文件", "上传文件存储", "准备自动下载"]
};

const templates: TemplateItem[] = [
  { name: "工作总结", documentType: "工作总结", topic: "季度工作总结", requirement: "突出目标完成情况、关键成果、问题复盘和下阶段计划。", outline: ["一、整体工作回顾", "二、重点成果与数据", "三、问题与改进", "四、下阶段计划"] },
  { name: "会议纪要", documentType: "会议纪要", topic: "项目推进会议纪要", requirement: "记录会议结论、待办事项、责任人和时间节点。", outline: ["一、会议基本信息", "二、讨论要点", "三、形成结论", "四、后续行动"] },
  { name: "商业计划书", documentType: "商业计划书", topic: "AI Word 文档助手商业计划书", requirement: "覆盖市场机会、产品方案、商业模式、推广计划和风险控制。", outline: ["一、项目概述", "二、市场分析", "三、产品方案", "四、商业模式", "五、实施计划"] },
  { name: "活动方案", documentType: "活动方案", topic: "新品发布活动方案", requirement: "说明活动目标、流程安排、人员分工、预算和风险预案。", outline: ["一、活动目标", "二、活动流程", "三、资源与分工", "四、预算安排", "五、风险预案"] },
  { name: "合同协议", documentType: "合同协议", topic: "服务合作协议", requirement: "梳理合作范围、双方责任、交付标准、费用与违约条款。", outline: ["一、合作背景", "二、服务内容", "三、双方权责", "四、费用结算", "五、违约与终止"] },
  { name: "论文材料", documentType: "论文材料", topic: "智能写作工具应用研究", requirement: "强调研究背景、方法、分析过程、结论和参考方向。", outline: ["一、研究背景", "二、研究方法", "三、结果分析", "四、结论与展望"] }
];

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

function getSelectedText(editor: TiptapEditor | null) {
  if (!editor) return "";
  const { from, to } = editor.state.selection;
  return editor.state.doc.textBetween(from, to, "\n").trim();
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
  const [recentDocuments, setRecentDocuments] = React.useState<RecentDocument[]>([]);
  const [activePanel, setActivePanel] = React.useState<"workspace" | "editor" | "templates">("workspace");
  const [aiStatus, setAiStatus] = React.useState("本地兜底已就绪");
  const [aiLoading, setAiLoading] = React.useState<string | null>(null);
  const [aiError, setAiError] = React.useState("");
  const [saveStatus, setSaveStatus] = React.useState("未保存");
  const [exportStatus, setExportStatus] = React.useState("");
  const [sessionUser, setSessionUser] = React.useState<SessionUser | null>(null);
  const [pointsSummary, setPointsSummary] = React.useState<PointsSummary | null>(null);
  const [launchStatus, setLaunchStatus] = React.useState("");
  const [appInitializing, setAppInitializing] = React.useState(true);
  const [documentsLoading, setDocumentsLoading] = React.useState(false);
  const [pointsRefreshing, setPointsRefreshing] = React.useState(false);

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
        body: JSON.stringify(payload)
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
      setSaveStatus("已创建");
      await loadRecentDocuments();
    }
    setActivePanel("editor");
  };

  const saveDocument = React.useCallback(
    async (options: { content?: string; title?: string; saveVersion?: boolean; versionNote?: string } = {}) => {
      if (!currentDocumentId) return null;
      try {
        setSaveStatus("保存中");
        const response = await fetch(`/api/documents/${currentDocumentId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: options.title ?? currentTitle,
            documentType: selectedType,
            tone,
            outline: outline.map((item) => item.title),
            content: options.content ?? content,
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
    },
    [content, currentDocumentId, currentTitle, loadRecentDocuments, outline, selectedType, tone]
  );

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
      setCurrentDocumentId(document.id);
      setCurrentTitle(document.title);
      setTopic(document.title);
      setSelectedType(document.documentType);
      setTone(document.tone);
      setOutline(toOutlineItems(document.outline || []));
      setContent(document.content || "<p></p>");
      setActivePanel("editor");
      setSaveStatus("已打开");
      await loadRecentDocuments();
    } catch (error) {
      setAiError(error instanceof Error ? error.message : "读取文档失败");
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
      setOutline(defaultOutline);
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

  const exportWord = async () => {
    if (!currentDocumentId) {
      setAiError("请先创建或打开一个文档");
      return;
    }
    if (!hasEnoughPoints(usageCosts.exportDocx, "导出 Word")) return;
    try {
      setExportStatus("导出中");
      const saved = await saveDocument({ saveVersion: true, versionNote: "导出 Word 前保存" });
      if (!saved) throw new Error("导出前自动保存失败，请先确认文档已保存。");
      const response = await fetch(`/api/documents/${currentDocumentId}/export-docx`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content })
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

  const applyTemplate = (template: TemplateItem) => {
    setSelectedType(template.documentType);
    setTopic(template.topic);
    setTone("正式");
    setRequirement(template.requirement);
    setOutline(toOutlineItems(template.outline));
    setContent(plainTextToHtml(`${template.topic}\n\n${template.outline.map((item) => `${item}\n请在此补充内容。`).join("\n\n")}`));
    setCurrentTitle(template.topic);
    setCurrentDocumentId(null);
    setSaveStatus("未保存");
    setActivePanel("workspace");
  };

  return (
    <main className="app-shell">
      {appInitializing ? <div className="global-loading">正在初始化应用...</div> : null}
      {aiError ? <ErrorBanner message={aiError} onClose={() => setAiError("")} /> : null}
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><FileText size={22} /></div>
          <div><strong>AI Word</strong><span>本地开发版</span></div>
        </div>
        <nav className="side-nav" aria-label="主导航">
          <button className={activePanel === "workspace" ? "active" : ""} onClick={() => setActivePanel("workspace")}><FolderOpen size={18} />工作台</button>
          <button className={activePanel === "editor" ? "active" : ""} onClick={() => setActivePanel("editor")}><PenLine size={18} />文档编辑</button>
          <button className={activePanel === "templates" ? "active" : ""} onClick={() => setActivePanel("templates")}><LayoutTemplate size={18} />模板库</button>
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
        />
      ) : activePanel === "templates" ? (
        <TemplateLibrary applyTemplate={applyTemplate} />
      ) : (
        <Editor
          outline={outline}
          content={content}
          setContent={setContent}
          setOutline={setOutline}
          generateBody={generateBody}
          editContent={editContent}
          saveDocument={() => saveDocument({ saveVersion: true, versionNote: "手动保存" })}
          exportWord={exportWord}
          currentTitle={currentTitle}
          saveStatus={saveStatus}
          exportStatus={exportStatus}
          aiStatus={aiStatus}
          aiLoading={aiLoading}
          aiError={aiError}
          pointsRemaining={pointsSummary?.remaining ?? null}
          pointsEnabled={Boolean(pointsSummary?.enabled)}
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
}) {
  const [keyword, setKeyword] = React.useState("");
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
          <div className="section-title spread"><div><FileText size={18} /><h2>最近文档</h2></div></div>
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

function TemplateLibrary(props: { applyTemplate: (template: TemplateItem) => void }) {
  return (
    <section className="workspace">
      <header className="topbar">
        <div><p>模板库</p><h1>选择文档模板</h1></div>
      </header>
      <div className="template-grid">
        {templates.map((template) => (
          <article className="template-card" key={template.name}>
            <div>
              <strong>{template.name}</strong>
              <span>{template.documentType}</span>
            </div>
            <p>{template.requirement}</p>
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
  setContent: (value: string) => void;
  setOutline: (value: OutlineItem[]) => void;
  generateBody: () => void;
  editContent: (action: AiAction, source: string) => Promise<string>;
  saveDocument: () => void;
  exportWord: () => void;
  currentTitle: string;
  saveStatus: string;
  exportStatus: string;
  aiStatus: string;
  aiLoading: string | null;
  aiError: string;
  pointsRemaining: number | null;
  pointsEnabled: boolean;
}) {
  const [aiResult, setAiResult] = React.useState<AiEditResult | null>(null);
  const [selectionHint, setSelectionHint] = React.useState("请先选中文本，再使用局部 AI 操作。");
  const [hasSelection, setHasSelection] = React.useState(false);

  const updateOutlineFromEditor = React.useCallback((editor: TiptapEditor) => {
    const nextOutline: OutlineItem[] = [];
    editor.state.doc.descendants((node, position) => {
      if (node.type.name === "heading") {
        const title = node.textContent.trim();
        if (title) nextOutline.push({ id: nextOutline.length + 1, title, level: node.attrs.level, position });
      }
    });
    if (nextOutline.length) props.setOutline(nextOutline);
  }, [props]);

  const editor = useEditor({
    extensions: [StarterKit],
    content: props.content,
    editorProps: { attributes: { class: "word-editor" } },
    onCreate({ editor }) { updateOutlineFromEditor(editor); },
    onUpdate({ editor }) { props.setContent(editor.getHTML()); updateOutlineFromEditor(editor); },
    onSelectionUpdate({ editor }) {
      const selectedText = getSelectedText(editor);
      setHasSelection(Boolean(selectedText));
      setSelectionHint(selectedText ? `已选中 ${selectedText.length} 个字符` : "请先选中文本，再使用局部 AI 操作。");
    }
  });

  React.useEffect(() => {
    if (!editor || editor.getHTML() === props.content) return;
    editor.commands.setContent(props.content);
    updateOutlineFromEditor(editor);
  }, [editor, props.content, updateOutlineFromEditor]);

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

  const applyAiResult = (mode: AiApplyMode) => {
    if (!editor || !aiResult) return;
    if (mode === "replace") editor.chain().focus().setTextSelection({ from: aiResult.from, to: aiResult.to }).insertContent(aiResult.content).run();
    else editor.chain().focus().setTextSelection(aiResult.to).insertContent(textToParagraphHtml(aiResult.content)).run();
    setAiResult(null);
  };

  const copyAiResult = async () => {
    if (aiResult) await navigator.clipboard.writeText(aiResult.content);
  };

  const jumpToOutline = (item: OutlineItem) => {
    if (!editor || typeof item.position !== "number") return;
    editor.chain().focus().setTextSelection(item.position + 1).scrollIntoView().run();
  };

  return (
    <section className="editor-page">
      <header className="editor-toolbar">
        <div><p>正在编辑</p><h1>{props.currentTitle}</h1><span className="save-status">{props.saveStatus}</span>{props.exportStatus ? <span className="export-status">{props.exportStatus}</span> : null}</div>
        <div className="toolbar-actions"><button onClick={props.saveDocument}><Save size={17} />保存</button><button onClick={props.generateBody} disabled={Boolean(props.aiLoading)}>{props.aiLoading === "正在生成正文" ? <LoaderCircle className="spin-icon" size={17} /> : <Sparkles size={17} />}{props.aiLoading === "正在生成正文" ? "生成中" : "生成正文"}</button><button onClick={props.exportWord} disabled={props.exportStatus === "导出中"}>{props.exportStatus === "导出中" ? <LoaderCircle className="spin-icon" size={17} /> : <Download size={17} />}{props.exportStatus === "导出中" ? "导出中" : "导出 Word"}</button></div>
      </header>
      <div className="editor-layout">
        <aside className="outline-panel"><div className="section-title"><ListTree size={18} /><h2>文档大纲</h2></div>{props.outline.length === 0 ? <div className="empty-state">暂无大纲，请先生成或在正文中添加标题。</div> : props.outline.map((item) => <button key={item.id} className={item.level === 3 ? "outline-child" : ""} onMouseDown={(event) => event.preventDefault()} onClick={() => jumpToOutline(item)}>{item.title}</button>)}</aside>
        <section className="paper-panel"><div className="format-bar"><button className={editor?.isActive("paragraph") ? "active-format" : ""} onClick={() => editor?.chain().focus().setParagraph().run()}><AlignLeft size={16} />正文</button><button className={editor?.isActive("heading", { level: 2 }) ? "active-format" : ""} onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}>标题</button><button className={editor?.isActive("bold") ? "active-format" : ""} onClick={() => editor?.chain().focus().toggleBold().run()}><Bold size={16} />加粗</button><button className={editor?.isActive("bulletList") ? "active-format" : ""} onClick={() => editor?.chain().focus().toggleBulletList().run()}><List size={16} />列表</button><button className={editor?.isActive("orderedList") ? "active-format" : ""} onClick={() => editor?.chain().focus().toggleOrderedList().run()}><ListOrdered size={16} />编号</button></div>{props.aiLoading === "正在生成正文" ? <div className="paper-loading"><LoadingProcess label={props.aiLoading} /></div> : null}<EditorContent editor={editor} /></section>
        <aside className="ai-panel"><div className="section-title"><Bot size={18} /><h2>AI 助手</h2></div><div className="points-cost">生成大纲 {usageCosts.outline} 积分 · 生成正文 {usageCosts.body} 积分 · 局部编辑 {usageCosts.edit} 积分 · 导出 {usageCosts.exportDocx} 积分</div>{props.pointsEnabled ? <div className="selection-hint">当前剩余积分：{props.pointsRemaining ?? "未知"}</div> : null}<div className="selection-hint">{selectionHint}</div><button onClick={() => runSelectionAi("polish")} disabled={Boolean(props.aiLoading) || !hasSelection}><Sparkles size={17} />润色选中文本</button><button onClick={() => runSelectionAi("continue")} disabled={Boolean(props.aiLoading) || !hasSelection}><Wand2 size={17} />续写选中文本</button><button onClick={() => runSelectionAi("expand")} disabled={Boolean(props.aiLoading) || !hasSelection}><AlignLeft size={17} />扩写选中文本</button><button onClick={() => runSelectionAi("shorten")} disabled={Boolean(props.aiLoading) || !hasSelection}><AlignLeft size={17} />缩写选中文本</button><button onClick={() => runSelectionAi("correct")} disabled={Boolean(props.aiLoading) || !hasSelection}><CheckCircle2 size={17} />纠错选中文本</button><button onClick={props.generateBody} disabled={Boolean(props.aiLoading)}><ListTree size={17} />根据大纲生成正文</button>{props.aiLoading ? <LoadingProcess label={props.aiLoading} compact /> : null}{props.exportStatus === "导出中" ? <LoadingProcess label="正在导出 Word" compact /> : null}{props.aiError ? <div className="ai-message error"><XCircle size={16} /><span>{props.aiError}</span></div> : null}{aiResult ? <div className="ai-result"><strong>AI 处理结果</strong><p>{aiResult.content}</p><div className="ai-result-actions"><button onClick={() => applyAiResult("replace")}>替换原文</button><button onClick={() => applyAiResult("insert")}>插入下方</button><button onClick={copyAiResult}>复制结果</button><button onClick={() => setAiResult(null)}>取消结果</button></div></div> : null}<div className="assistant-note"><strong>{props.aiStatus}</strong><span>AI 密钥仅保存在服务端；墨灵积分只会在动作成功后扣减。</span></div></aside>
      </div>
    </section>
  );
}

// 中文注解：墨灵 launch ticket 是一次性票据；开发态 StrictMode 会重复执行初始化逻辑，容易二次消费同一张票据。
createRoot(document.getElementById("root")!).render(<App />);
