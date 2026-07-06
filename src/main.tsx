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
  List,
  ListOrdered,
  ListTree,
  PenLine,
  Plus,
  Save,
  Search,
  Sparkles,
  Wand2,
  XCircle
} from "lucide-react";
import "./styles.css";

type DocumentType = "Work Summary" | "Meeting Minutes" | "Business Plan" | "Contract" | "Paper Material" | "Event Plan";
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

const documentTypes: DocumentType[] = ["Work Summary", "Meeting Minutes", "Business Plan", "Contract", "Paper Material", "Event Plan"];

const defaultOutline: OutlineItem[] = [
  { id: 1, title: "1. Project background and goals" },
  { id: 2, title: "2. Core feature plan" },
  { id: 3, title: "3. User workflow" },
  { id: 4, title: "4. Technical implementation" },
  { id: 5, title: "5. Delivery roadmap" }
];

const defaultContent = `AI Word Assistant is a personal document writing tool. It helps users create outlines, draft body content, polish selected text, auto-save documents, and export Word files.

1. Project background and goals

The first version focuses on single-user daily use. Users can start from a topic, generate a clear outline, create body content, edit it online, and export the final document.

2. Core feature plan

The core features include AI outline generation, AI body generation, rich text editing, selected text polishing, auto-save, document management, and Word export.`;

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

function App() {
  const [selectedType, setSelectedType] = React.useState<DocumentType>("Work Summary");
  const [topic, setTopic] = React.useState("AI Word Assistant local development plan");
  const [tone, setTone] = React.useState("formal");
  const [outline, setOutline] = React.useState<OutlineItem[]>(defaultOutline);
  const [content, setContent] = React.useState(plainTextToHtml(defaultContent));
  const [currentDocumentId, setCurrentDocumentId] = React.useState<number | null>(null);
  const [currentTitle, setCurrentTitle] = React.useState("AI Word Assistant local development plan");
  const [recentDocuments, setRecentDocuments] = React.useState<RecentDocument[]>([]);
  const [activePanel, setActivePanel] = React.useState<"workspace" | "editor">("workspace");
  const [aiStatus, setAiStatus] = React.useState("Local fallback ready");
  const [aiLoading, setAiLoading] = React.useState<string | null>(null);
  const [aiError, setAiError] = React.useState("");
  const [saveStatus, setSaveStatus] = React.useState("Not saved");
  const [exportStatus, setExportStatus] = React.useState("");
  const [sessionUser, setSessionUser] = React.useState<SessionUser | null>(null);
  const [pointsSummary, setPointsSummary] = React.useState<PointsSummary | null>(null);
  const [launchStatus, setLaunchStatus] = React.useState("");

  const loadSession = React.useCallback(async () => {
    const response = await fetch("/api/session");
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "Read session failed");
    setSessionUser(result.user);
    setPointsSummary(result.points);
  }, []);

  const loadRecentDocuments = React.useCallback(async () => {
    try {
      const response = await fetch("/api/documents");
      const result = await response.json();
      const documents = (result.documents || []) as ApiDocument[];
      setRecentDocuments(documents.map(apiDocumentToRecent));
    } catch (error) {
      setAiError(error instanceof Error ? error.message : "Read recent documents failed");
    }
  }, []);

  React.useEffect(() => {
    const run = async () => {
      try {
        const url = new URL(window.location.href);
        if (url.pathname === "/molin/launch") {
          const ticket = url.searchParams.get("ticket");
          setLaunchStatus("Connecting Moling...");
          const response = await fetch("/api/molin/launch", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ticket })
          });
          const result = await response.json();
          if (!response.ok) throw new Error(result.message || "Moling launch failed");
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
        setAiError(error instanceof Error ? error.message : "Session init failed");
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
      const result = await response.json();
      setAiStatus(result.fallback ? "Local fallback" : "Real AI");
      if (result.message) setAiError(result.message);
      await loadSession().catch(() => undefined);
      return result as T;
    } catch (error) {
      setAiError(error instanceof Error ? error.message : "AI request failed");
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
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "Create document failed");
      return result.document as ApiDocument;
    } catch (error) {
      setAiError(error instanceof Error ? error.message : "Create document failed");
      return null;
    }
  };

  const generateOutline = async () => {
    const result = await callAi<{ outline: string[]; fallback?: boolean; message?: string }>("Generating outline", "/api/ai/generate-outline", {
      topic,
      documentType: selectedType,
      tone,
      documentId: currentDocumentId
    });
    if (!result?.outline?.length) return;
    setOutline(toOutlineItems(result.outline));
    const created = await createDocument({
      title: topic || "Untitled document",
      documentType: selectedType,
      tone,
      outline: result.outline,
      content: plainTextToHtml(defaultContent)
    });
    if (created) {
      setCurrentDocumentId(created.id);
      setCurrentTitle(created.title);
      setContent(created.content || plainTextToHtml(defaultContent));
      setSaveStatus("Created");
      await loadRecentDocuments();
    }
    setActivePanel("editor");
  };

  const saveDocument = React.useCallback(
    async (options: { content?: string; title?: string; saveVersion?: boolean; versionNote?: string } = {}) => {
      if (!currentDocumentId) return null;
      try {
        setSaveStatus("Saving");
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
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || "Save document failed");
        setSaveStatus("Saved");
        await loadRecentDocuments();
        return result.document as ApiDocument;
      } catch (error) {
        setSaveStatus("Save failed");
        setAiError(error instanceof Error ? error.message : "Save document failed");
        return null;
      }
    },
    [content, currentDocumentId, currentTitle, loadRecentDocuments, outline, selectedType, tone]
  );

  React.useEffect(() => {
    if (!currentDocumentId || activePanel !== "editor") return;
    setSaveStatus("Waiting auto-save");
    const timer = window.setTimeout(() => {
      void saveDocument({ saveVersion: false });
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [activePanel, content, currentDocumentId, outline, saveDocument]);

  const generateBody = async () => {
    const result = await callAi<{ content: string; fallback?: boolean; message?: string }>("Generating body", "/api/ai/generate-body", {
      topic,
      documentType: selectedType,
      tone,
      outline: outline.map((item) => item.title),
      documentId: currentDocumentId
    });
    if (result?.content) {
      const html = plainTextToHtml(result.content);
      setContent(html);
      await saveDocument({ content: html, versionNote: "AI generated body" });
    }
  };

  const editContent = async (action: AiAction, source: string) => {
    const labelMap: Record<AiAction, string> = {
      continue: "Continuing",
      expand: "Expanding",
      shorten: "Shortening",
      correct: "Correcting",
      polish: "Polishing"
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
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "Read document failed");
      const document = result.document as ApiDocument;
      setCurrentDocumentId(document.id);
      setCurrentTitle(document.title);
      setTopic(document.title);
      setSelectedType(document.documentType);
      setTone(document.tone);
      setOutline(toOutlineItems(document.outline || []));
      setContent(document.content || "<p></p>");
      setActivePanel("editor");
      setSaveStatus("Opened");
      await loadRecentDocuments();
    } catch (error) {
      setAiError(error instanceof Error ? error.message : "Read document failed");
    }
  };

  const renameDocument = async (documentId: number, currentName: string) => {
    const nextName = window.prompt("New document name", currentName);
    if (!nextName?.trim()) return;
    const response = await fetch(`/api/documents/${documentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: nextName.trim() })
    });
    const result = await response.json();
    if (!response.ok) {
      setAiError(result.message || "Rename failed");
      return;
    }
    if (documentId === currentDocumentId) {
      setCurrentTitle(result.document.title);
      setTopic(result.document.title);
    }
    await loadRecentDocuments();
  };

  const deleteDocument = async (documentId: number) => {
    if (!window.confirm("Delete this document?")) return;
    const response = await fetch(`/api/documents/${documentId}`, { method: "DELETE" });
    const result = await response.json();
    if (!response.ok) {
      setAiError(result.message || "Delete failed");
      return;
    }
    if (result.deleted && documentId === currentDocumentId) {
      setCurrentDocumentId(null);
      setCurrentTitle("AI Word Assistant local development plan");
      setContent(plainTextToHtml(defaultContent));
      setOutline(defaultOutline);
      setActivePanel("workspace");
    }
    await loadRecentDocuments();
  };

  const duplicateDocument = async (documentId: number) => {
    const response = await fetch(`/api/documents/${documentId}/duplicate`, { method: "POST" });
    const result = await response.json();
    if (!response.ok) {
      setAiError(result.message || "Duplicate failed");
      return;
    }
    await loadRecentDocuments();
    await openDocument(result.document.id);
  };

  const exportWord = async () => {
    if (!currentDocumentId) {
      setAiError("Create or open a document first");
      return;
    }
    try {
      setExportStatus("Exporting");
      await saveDocument({ saveVersion: true, versionNote: "Before Word export" });
      const response = await fetch(`/api/documents/${currentDocumentId}/export-docx`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "Export Word failed");
      const anchor = document.createElement("a");
      anchor.href = result.file.downloadUrl;
      anchor.download = result.file.fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setExportStatus("Exported Word");
      await loadSession().catch(() => undefined);
    } catch (error) {
      setExportStatus("Export failed");
      setAiError(error instanceof Error ? error.message : "Export Word failed");
    }
  };

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><FileText size={22} /></div>
          <div><strong>AI Word</strong><span>Local dev</span></div>
        </div>
        <nav className="side-nav" aria-label="Main navigation">
          <button className={activePanel === "workspace" ? "active" : ""} onClick={() => setActivePanel("workspace")}><FolderOpen size={18} />Workspace</button>
          <button className={activePanel === "editor" ? "active" : ""} onClick={() => setActivePanel("editor")}><PenLine size={18} />Editor</button>
          <button><LayoutTemplate size={18} />Templates</button>
        </nav>
        <div className="platform-box">
          <span>Moling Platform</span>
          <strong>{sessionUser?.isMolingUser ? `User ${sessionUser.userId}` : "Local dev user"}</strong>
          <small>{launchStatus || (sessionUser?.isMolingUser ? `Product ${sessionUser.productId} · Points ${pointsSummary?.remaining ?? "unknown"}` : "Open from Moling to enable SSO and points billing")}</small>
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
          generateOutline={generateOutline}
          aiLoading={aiLoading}
          recentDocuments={recentDocuments}
          openDocument={openDocument}
          renameDocument={renameDocument}
          deleteDocument={deleteDocument}
          duplicateDocument={duplicateDocument}
        />
      ) : (
        <Editor
          outline={outline}
          content={content}
          setContent={setContent}
          setOutline={setOutline}
          generateBody={generateBody}
          editContent={editContent}
          saveDocument={() => saveDocument({ saveVersion: true, versionNote: "Manual save" })}
          exportWord={exportWord}
          currentTitle={currentTitle}
          saveStatus={saveStatus}
          exportStatus={exportStatus}
          aiStatus={aiStatus}
          aiLoading={aiLoading}
          aiError={aiError}
        />
      )}
    </main>
  );
}

function Workspace(props: {
  selectedType: DocumentType;
  setSelectedType: (value: DocumentType) => void;
  topic: string;
  setTopic: (value: string) => void;
  tone: string;
  setTone: (value: string) => void;
  generateOutline: () => void;
  aiLoading: string | null;
  recentDocuments: RecentDocument[];
  openDocument: (documentId: number) => void;
  renameDocument: (documentId: number, currentName: string) => void;
  deleteDocument: (documentId: number) => void;
  duplicateDocument: (documentId: number) => void;
}) {
  return (
    <section className="workspace">
      <header className="topbar">
        <div><p>Personal document workspace</p><h1>AI Word Assistant</h1></div>
        <button className="primary-action" onClick={props.generateOutline} disabled={Boolean(props.aiLoading)}><Sparkles size={18} />{props.aiLoading || "Generate outline"}</button>
      </header>
      <div className="workspace-grid">
        <section className="creator-panel">
          <div className="section-title"><Plus size={18} /><h2>New AI document</h2></div>
          <label>Document topic<input value={props.topic} onChange={(event) => props.setTopic(event.target.value)} /></label>
          <div className="field-row">
            <label>Document type<select value={props.selectedType} onChange={(event) => props.setSelectedType(event.target.value as DocumentType)}>{documentTypes.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label>Tone<select value={props.tone} onChange={(event) => props.setTone(event.target.value)}><option>formal</option><option>business</option><option>academic</option><option>concise</option></select></label>
          </div>
          <label>Extra requirements<textarea defaultValue="Generate a clear outline first, then write body content by section." /></label>
          <button className="wide-action" onClick={props.generateOutline} disabled={Boolean(props.aiLoading)}><Wand2 size={18} />{props.aiLoading || "Start"}</button>
        </section>
        <section className="recent-panel">
          <div className="section-title spread"><div><FileText size={18} /><h2>Recent documents</h2></div><Search size={18} /></div>
          <div className="document-list">
            {props.recentDocuments.length === 0 ? <div className="empty-state">No documents yet.</div> : null}
            {props.recentDocuments.map((item) => (
              <div key={item.id} className="document-row">
                <button className="document-open" onClick={() => props.openDocument(item.id)}><div><strong>{item.title}</strong><span>{item.type} · {item.words} chars · {item.updatedAt}</span></div><ChevronRight size={18} /></button>
                <div className="document-actions"><button onClick={() => props.renameDocument(item.id, item.title)}>Rename</button><button onClick={() => props.duplicateDocument(item.id)}>Duplicate</button><button onClick={() => props.deleteDocument(item.id)}>Delete</button></div>
              </div>
            ))}
          </div>
        </section>
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
}) {
  const [aiResult, setAiResult] = React.useState<AiEditResult | null>(null);
  const [selectionHint, setSelectionHint] = React.useState("Select text before using local AI actions.");

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
      setSelectionHint(selectedText ? `Selected ${selectedText.length} chars` : "Select text before using local AI actions.");
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
      setSelectionHint("No text selected.");
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
        <div><p>Editing</p><h1>{props.currentTitle}</h1><span className="save-status">{props.saveStatus}</span>{props.exportStatus ? <span className="export-status">{props.exportStatus}</span> : null}</div>
        <div className="toolbar-actions"><button onClick={props.saveDocument}><Save size={17} />Save</button><button onClick={props.generateBody} disabled={Boolean(props.aiLoading)}><Sparkles size={17} />{props.aiLoading === "Generating body" ? "Generating" : "Generate body"}</button><button onClick={props.exportWord} disabled={props.exportStatus === "Exporting"}><Download size={17} />{props.exportStatus === "Exporting" ? "Exporting" : "Export Word"}</button></div>
      </header>
      <div className="editor-layout">
        <aside className="outline-panel"><div className="section-title"><ListTree size={18} /><h2>Outline</h2></div>{props.outline.map((item) => <button key={item.id} className={item.level === 3 ? "outline-child" : ""} onMouseDown={(event) => event.preventDefault()} onClick={() => jumpToOutline(item)}>{item.title}</button>)}</aside>
        <section className="paper-panel"><div className="format-bar"><button className={editor?.isActive("paragraph") ? "active-format" : ""} onClick={() => editor?.chain().focus().setParagraph().run()}><AlignLeft size={16} />Body</button><button className={editor?.isActive("heading", { level: 2 }) ? "active-format" : ""} onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}>Title</button><button className={editor?.isActive("bold") ? "active-format" : ""} onClick={() => editor?.chain().focus().toggleBold().run()}><Bold size={16} />Bold</button><button className={editor?.isActive("bulletList") ? "active-format" : ""} onClick={() => editor?.chain().focus().toggleBulletList().run()}><List size={16} />List</button><button className={editor?.isActive("orderedList") ? "active-format" : ""} onClick={() => editor?.chain().focus().toggleOrderedList().run()}><ListOrdered size={16} />Numbered</button></div><EditorContent editor={editor} /></section>
        <aside className="ai-panel"><div className="section-title"><Bot size={18} /><h2>AI Assistant</h2></div><div className="selection-hint">{selectionHint}</div><button onClick={() => runSelectionAi("polish")} disabled={Boolean(props.aiLoading)}><Sparkles size={17} />Polish selected text</button><button onClick={() => runSelectionAi("continue")} disabled={Boolean(props.aiLoading)}><Wand2 size={17} />Continue selected text</button><button onClick={() => runSelectionAi("expand")} disabled={Boolean(props.aiLoading)}><AlignLeft size={17} />Expand selected text</button><button onClick={() => runSelectionAi("shorten")} disabled={Boolean(props.aiLoading)}><AlignLeft size={17} />Shorten selected text</button><button onClick={() => runSelectionAi("correct")} disabled={Boolean(props.aiLoading)}><CheckCircle2 size={17} />Correct selected text</button><button onClick={props.generateBody} disabled={Boolean(props.aiLoading)}><ListTree size={17} />Generate body from outline</button>{props.aiLoading ? <div className="ai-message loading">{props.aiLoading}...</div> : null}{props.aiError ? <div className="ai-message error"><XCircle size={16} /><span>{props.aiError}</span></div> : null}{aiResult ? <div className="ai-result"><strong>AI result</strong><p>{aiResult.content}</p><div className="ai-result-actions"><button onClick={() => applyAiResult("replace")}>Replace</button><button onClick={() => applyAiResult("insert")}>Insert below</button><button onClick={copyAiResult}>Copy</button></div></div> : null}<div className="assistant-note"><strong>{props.aiStatus}</strong><span>AI keys stay on the server. Moling points are charged only after successful actions.</span></div></aside>
      </div>
    </section>
  );
}

createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
