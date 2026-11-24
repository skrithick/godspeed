"use client";

import { Bold, CheckSquare, Code2, Heading1, Heading2, Italic, List, ListOrdered, Minus, Plus, Sparkles, Strikethrough, TextQuote, Type } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import type { JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import UniqueID from "@tiptap/extension-unique-id";
import { TableKit } from "@tiptap/extension-table";
import { uid, type Page } from "@/workspace/model";
import { markdownBlocks } from "@/workspace/markdown";
import { repo } from "@/workspace/repository";

const extensions = [
  StarterKit.configure({ link: { openOnClick: false, autolink: true } }),
  Placeholder.configure({ placeholder: ({ editor }) => editor.isEmpty ? "Start writing, or type / for blocks…" : "" }),
  TaskList, TaskItem.configure({ nested: true }),
  TableKit.configure({ table: { renderWrapper: true, resizable: false } }),
  UniqueID.configure({ types: ["paragraph", "heading", "blockquote", "bulletList", "orderedList", "taskList", "codeBlock", "horizontalRule", "table"] }),
];
const commands = [
  { label: "Text", icon: Type, hint: "Plain paragraph", run: (e: Editor) => e.chain().setParagraph().run() },
  { label: "Heading 1", icon: Heading1, hint: "Large section heading", run: (e: Editor) => e.chain().setHeading({ level: 1 }).run() },
  { label: "Heading 2", icon: Heading2, hint: "Small section heading", run: (e: Editor) => e.chain().setHeading({ level: 2 }).run() },
  { label: "Bullet list", icon: List, hint: "Unordered list", run: (e: Editor) => e.chain().toggleBulletList().run() },
  { label: "Numbered list", icon: ListOrdered, hint: "Ordered list", run: (e: Editor) => e.chain().toggleOrderedList().run() },
  { label: "Checklist", icon: CheckSquare, hint: "Checkable items", run: (e: Editor) => e.chain().toggleTaskList().run() },
  { label: "Quote", icon: TextQuote, hint: "Highlight a passage", run: (e: Editor) => e.chain().toggleBlockquote().run() },
  { label: "Code block", icon: Code2, hint: "Monospaced text", run: (e: Editor) => e.chain().toggleCodeBlock().run() },
  { label: "Divider", icon: Minus, hint: "Separate sections", run: (e: Editor) => e.chain().setHorizontalRule().run() },
];
type Slash = { from: number; to: number; query: string; y: number; x: number; active: number };
type Draft = { id: string; doc: JSONContent; revision: number };
const matches = (slash: Slash) => commands.filter((c) => c.label.toLowerCase().includes(slash.query.toLowerCase()));
function plainMarkdown(doc: JSONContent) {
  const blocks = doc.content ?? [];
  if (!blocks.length || blocks.some((node) => node.type !== "paragraph" ||
      node.content?.some((child) => child.type !== "text" || child.marks?.length))) return;
  const body = blocks.map((node) => node.content?.map((child) => child.text).join("") ?? "").join("\n");
  if (body.length <= 12_000 && /(?:^|\n)\s*(?:#{1,6}\s|```|>\s|[-*+]\s|\d+[.)]\s)|\*\*[^*\n]+\*\*|\[[^\]\n]+\]\([^\n)]+\)|\n\s*\|?[-:]+\s*\|/.test(body)) return body;
}

export function BlockEditor({ snapshot, blockId, onAsk }: {
  snapshot: { page: Page; workspaceId: string; doc: JSONContent };
  blockId?: string; onAsk: (selection: string) => void;
}) {
  const { page, workspaceId } = snapshot;
  const key = `godspeed-draft:${workspaceId}:${page.id}`;
  const previousKey = `atlas-draft:${workspaceId}:${page.id}`;
  const [status, setStatus] = useState<"saved" | "saving" | "error" | "recovery">("saved");
  const [slash, setSlash] = useState<Slash | null>(null);
  const slashRef = useRef<Slash | null>(null);
  const revision = useRef(page.contentRevision);
  const pending = useRef<Draft | null>(null);
  const writing = useRef(false);
  const failure = useRef(false);
  const liveEditor = useRef<Editor | null>(null);
  const [unsafeToClose, setUnsafeToClose] = useState(false);
  const [recoveryDoc, setRecoveryDoc] = useState<JSONContent | null>(null);
  const suppress = useRef(false);
  const host = useRef<HTMLDivElement>(null);

  function showSlash(value: Slash | null) { slashRef.current = value; setSlash(value); }
  function inspectSlash(e: Editor) {
    if (suppress.current || !e.isFocused) return;
    const { $from, empty } = e.state.selection;
    const match = empty && $from.parent.type.name === "paragraph" && $from.parent.textBetween(0, $from.parentOffset).match(/^\/([\w ]{0,32})$/);
    if (!match || !host.current) { if (slashRef.current) showSlash(null); return; }
    const coords = e.view.coordsAtPos($from.pos);
    const bounds = host.current.getBoundingClientRect();
    const active = slashRef.current?.query === match[1] ? slashRef.current.active : 0;
    showSlash({ from: $from.pos - match[0].length, to: $from.pos, query: match[1], active, y: coords.bottom - bounds.top + 7, x: Math.max(0, coords.left - bounds.left) });
  }
  function choose(e: Editor, command: typeof commands[number], current: Slash | null) {
    suppress.current = true;
    if (current) e.chain().focus().deleteRange({ from: current.from, to: current.to }).run();
    else e.commands.focus();
    command.run(e);
    showSlash(null);
    suppress.current = false;
  }
  function retain(draft: Draft) {
    try { sessionStorage.setItem(key, JSON.stringify(draft)); } catch { /* The editor keeps its in-memory draft. */ }
  }
  function clearDraft(id?: string) {
    try {
      for (const name of [key, previousKey]) {
        const value = sessionStorage.getItem(name);
        if (value && (!id || JSON.parse(value).id === id)) sessionStorage.removeItem(name);
      }
    } catch { /* Do not clear another editor’s recovery data. */ }
  }
  async function flush() {
    if (writing.current || failure.current) return;
    writing.current = true;
    while (pending.current) {
      const write = pending.current;
      try {
        revision.current = await repo.saveDocument(page.id, write.doc, revision.current, workspaceId);
        if (pending.current === write) { pending.current = null; clearDraft(write.id); }
        else if (pending.current) {
          pending.current.revision = revision.current;
          retain(pending.current);
        }
      } catch {
        failure.current = true;
        setStatus("error");
        writing.current = false;
        return;
      }
    }
    writing.current = false;
    setUnsafeToClose(false);
    setStatus("saved");
  }
  const editor = useEditor({
    immediatelyRender: false,
    extensions,
    content: snapshot.doc,
    editorProps: {
      attributes: { class: "prose-editor", "aria-label": "Page content", role: "textbox", "aria-multiline": "true" },
      handleKeyDown: (_view, event) => {
        const current = slashRef.current;
        if (!current) return false;
        if (event.key === "Escape") { showSlash(null); return true; }
        const list = matches(current);
        const editor = liveEditor.current;
        if (!list.length || !editor) return false;
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          showSlash({ ...current, active: (current.active + (event.key === "ArrowDown" ? 1 : -1) + list.length) % list.length });
          return true;
        }
        if (event.key === "Enter") { choose(editor, list[current.active], current); return true; }
        return false;
      },
    },
    onCreate: ({ editor }) => { liveEditor.current = editor; },
    onSelectionUpdate: ({ editor }) => inspectSlash(editor),
    onUpdate: ({ editor }) => {
      const draft = { id: uid(), doc: editor.getJSON(), revision: revision.current };
      pending.current = draft;
      retain(draft);
      setUnsafeToClose(true);
      if (!failure.current) { setStatus("saving"); void flush(); }
      inspectSlash(editor);
    },
    onBlur: () => showSlash(null),
  });

  useEffect(() => {
    if (!editor) return;
    const id = requestAnimationFrame(() => {
      try {
        const current = sessionStorage.getItem(key);
        const value = current ?? sessionStorage.getItem(previousKey);
        if (!value || pending.current) return;
        const draft = JSON.parse(value) as Draft;
        if (draft?.doc?.type !== "doc") return;
        if (current === null) {
          try {
            sessionStorage.setItem(key, value);
            sessionStorage.removeItem(previousKey);
          } catch { /* Keep the previous draft if it could not be copied. */ }
        }
        setRecoveryDoc(draft.doc);
        setStatus("recovery");
      } catch { /* An unreadable recovery record does not touch saved content. */ }
    });
    return () => cancelAnimationFrame(id);
  }, [editor, key, previousKey]);

  useEffect(() => {
    if (!editor || snapshot.page.contentRevision <= revision.current || pending.current || writing.current) return;
    revision.current = snapshot.page.contentRevision;
    editor.commands.setContent(snapshot.doc, { emitUpdate: false });
  }, [editor, snapshot]);
  useEffect(() => {
    if (!unsafeToClose) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsafeToClose]);
  useEffect(() => {
    if (!editor || !blockId) return;
    const frame = requestAnimationFrame(() => {
      const node = editor.view.dom.querySelector(`[data-id="${CSS.escape(blockId)}"]`);
      node?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "center" });
      node?.classList.add("cited-block");
    });
    return () => { cancelAnimationFrame(frame); editor.view.dom.querySelector(".cited-block")?.classList.remove("cited-block"); };
  }, [editor, blockId]);

  const exportDraft = (doc: JSONContent) => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "godspeed-page-draft.json"; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 5_000);
  };
  return <div className="editor-host" ref={host}>
    <div className="sr-only" role="status">{status === "saving" ? "Saving changes…" : status === "saved" ? "Saved locally" : status === "error" ? "Changes not saved" : "Recovered local draft"}</div>
    {status === "error" && <div className="workspace-warning"><span>Godspeed couldn’t save this edit. Your draft is still here.</span><button className="text-button" onClick={() => { failure.current = false; setStatus("saving"); void flush(); }}>Retry</button><button className="text-button" onClick={() => editor && exportDraft(editor.getJSON())}>Download draft</button></div>}
    {status === "recovery" && recoveryDoc && <div className="workspace-warning"><span>A previous draft wasn’t saved.</span>
      <button className="text-button" onClick={() => exportDraft(recoveryDoc)}>Download draft</button>
      <button className="text-button" onClick={() => {
        if (!window.confirm("Replace the saved page body with this recovered draft?")) return;
        revision.current = snapshot.page.contentRevision;
        setRecoveryDoc(null); editor?.commands.setContent(recoveryDoc, { emitUpdate: true });
      }}>Restore draft</button>
      <button className="text-button" onClick={() => {
        if (!window.confirm("Discard this recovered draft?")) return;
        clearDraft(); setRecoveryDoc(null); setStatus("saved");
      }}>Discard</button>
    </div>}
    {editor && <BubbleMenu editor={editor} options={{ placement: "top", offset: 9 }} className="bubble-menu">
      {([
        ["Bold", "bold", Bold, () => editor.chain().focus().toggleBold().run()],
        ["Italic", "italic", Italic, () => editor.chain().focus().toggleItalic().run()],
        ["Strike", "strike", Strikethrough, () => editor.chain().focus().toggleStrike().run()],
        ["Inline code", "code", Code2, () => editor.chain().focus().toggleCode().run()],
      ] as const).map(([label, name, Icon, run]) => <button key={name} aria-label={label} title={label} onMouseDown={(e) => e.preventDefault()} onClick={run} className={editor.isActive(name) ? "active" : ""}><Icon size={15} /></button>)}
      <button className="bubble-ai" onMouseDown={(e) => e.preventDefault()} onClick={() => {
        const { from, to } = editor.state.selection;
        const selected = editor.state.doc.textBetween(from, to, "\n");
        if (selected) onAsk(selected);
      }}><Sparkles size={15} /> Ask Godspeed</button>
    </BubbleMenu>}
    {editor && status === "saved" && plainMarkdown(snapshot.doc) && <button type="button" className="text-button muted format-markdown"
      onClick={() => {
        const body = plainMarkdown(editor.getJSON());
        if (!body) return;
        const content = markdownBlocks(body);
        if (content.length) editor.chain().focus().setContent({ type: "doc", content }).run();
      }}>Format Markdown</button>}
    <EditorContent editor={editor} />
    {editor && <button className="text-button muted add-block" onClick={() => {
      showSlash(null);
      editor.chain().focus("end").createParagraphNear().run();
      const { $from } = editor.state.selection;
      if ($from.parent.textContent) editor.chain().splitBlock().run();
      editor.chain().insertContent("/").run();
      inspectSlash(editor);
    }}><Plus size={15} /> Add a block</button>}
    {editor && slash && <div className="slash-menu panel" style={{ top: slash.y, left: Math.min(slash.x, 80) }} aria-label="Block commands">
      <p className="eyebrow">INSERT BLOCK</p>
      {!matches(slash).length && <p className="slash-empty">No matching blocks</p>}
      {matches(slash).map((command, i) => <button key={command.label} className={i === slash.active ? "active" : ""} onMouseDown={(e) => e.preventDefault()} onClick={() => choose(editor, command, slash)}>
        <span className="slash-icon"><command.icon size={17} /></span><span><strong>{command.label}</strong><small>{command.hint}</small></span>
      </button>)}
    </div>}
  </div>;
}
