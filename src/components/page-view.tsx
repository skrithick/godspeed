"use client";

import { ChevronRight, MoreHorizontal, Plus, Sparkles, Star, Tags } from "lucide-react";
import { useLiveQuery } from "dexie-react-hooks";
import { useRef, useState } from "react";
import type { Page } from "@/workspace/model";
import { repo } from "@/workspace/repository";
import { BlockEditor } from "./editor";
import { PageContextMenu, PageMenuItems, type OnPageAction } from "./page-actions";
import { Menu, MenuContent, MenuItem, MenuTrigger, PageIcon, WorkspaceLink, type Destination } from "./ui";

export function PageView({ id, pages, blockId, navigate, onPageAction, onAsk, onTask, notify }: {
  id: string; pages: Page[]; blockId?: string; navigate: (d: Destination) => void;
  onPageAction: OnPageAction; onAsk: (prompt: string, selection?: string) => void;
  onTask: (id: string) => void; notify: (message: string) => void;
}) {
  const snapshot = useLiveQuery(() => repo.document(id), [id], null);
  const tasks = useLiveQuery(() => repo.relatedTasks(id), [id], []);
  const [draft, setDraft] = useState<string | null>(null);
  const titleRevision = useRef<number | null>(null);
  if (snapshot === null) return <div className="content-width loading-view"><span className="spinner" /> Opening page…</div>;
  if (!snapshot) return <div className="content-width empty standalone"><h1>Page not found</h1><p>It may have been removed or replaced by a backup.</p><button className="button" onClick={() => navigate({ kind: "home" })}>Back to overview</button></div>;
  const { page } = snapshot;
  const children = pages.filter((p) => p.parentId === id).sort((a, b) => a.title.localeCompare(b.title));
  const links = pages.filter((p) => page.links.includes(p.id));
  const backlinks = pages.filter((p) => p.links.includes(id));
  async function rename() {
    if (draft === null) return;
    const title = draft.trim();
    if (!title || title === page.title) { setDraft(null); titleRevision.current = null; return; }
    try {
      await repo.patchPage(id, { title }, titleRevision.current ?? page.revision);
      titleRevision.current = null; setDraft(null);
    } catch (error) { notify(error instanceof Error ? error.message : "Couldn’t rename the page."); }
  }
  return <div className="content-width page-view">
    <div className="page-actions">
      <span className="page-kind"><PageIcon page={page} />{page.kind === "folder" ? "Folder" : "Page"}</span>
      <div>
        <Menu><MenuTrigger asChild><button className="button subtle"><Sparkles size={16} /> Ask Godspeed</button></MenuTrigger><MenuContent>
          {page.kind === "page" && <MenuItem onSelect={() => onAsk("Outline this page")}>Outline this page</MenuItem>}
          <MenuItem onSelect={() => onAsk("Show related work")}>Show related work</MenuItem>
          <MenuItem onSelect={() => onAsk("Summarize this page and suggest next steps")}>Summarize and suggest next steps</MenuItem>
        </MenuContent></Menu>
        <button className={`icon-button ${page.favorite ? "is-favorite" : ""}`} aria-label={page.favorite ? "Remove from favorites" : "Add to favorites"} title={page.favorite ? "Remove from favorites" : "Add to favorites"} aria-pressed={page.favorite}
          onClick={() => onPageAction(page, "favorite")}><Star size={18} /></button>
        <Menu><MenuTrigger asChild><button className="icon-button" aria-label="Page options" title="Page options"><MoreHorizontal size={21} /></button></MenuTrigger><MenuContent>
          <PageMenuItems page={page} onAction={onPageAction} />
        </MenuContent></Menu>
      </div>
    </div>
    <div className="page-title-wrap">
      <h1 className="sr-only">{page.title}</h1>
      <input className="page-title" aria-label="Page title" spellCheck={false} value={draft ?? page.title} maxLength={160}
        onChange={(e) => { titleRevision.current ??= page.revision; setDraft(e.target.value); }} onBlur={() => void rename()}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") { setDraft(null); titleRevision.current = null; }
        }} />
      <div className="page-meta">
        {page.tags.map((tag) => <span className="chip tag-chip" key={tag}>{tag}</span>)}
        <button className="text-button muted" onClick={() => onPageAction(page, "details")}><Tags size={14} /> {page.tags.length ? "Edit details" : "Add tags or links"}</button>
      </div>
    </div>
    {page.kind === "page" && <BlockEditor key={`${snapshot.workspaceId}:${page.id}`} snapshot={snapshot} blockId={blockId} onAsk={(selection) => onAsk("Summarize the selected text", selection)} />}
    <div className="page-children">
      <div className="section-heading"><h2>{page.kind === "folder" ? "In this folder" : "Subpages"}</h2><button className="text-button" onClick={() => onPageAction(page, "subpage")}><Plus size={15} /> New page</button></div>
      {children.map((child) => <PageContextMenu key={child.id} page={child} onAction={onPageAction}>
        <WorkspaceLink className="recent-row child-row" to={{ kind: "page", id: child.id }} navigate={navigate}><span className="recent-name"><PageIcon page={child} /><span>{child.title}</span></span><ChevronRight size={15} /></WorkspaceLink>
      </PageContextMenu>)}
      {!children.length && <p className="empty compact">No pages here yet.</p>}
    </div>
    {Boolean(links.length || backlinks.length || tasks.length) && <div className="page-related">
      <div className="section-heading"><h2>Related work</h2></div>
      <div className="relation-grid">
        {links.map((p) => <PageContextMenu key={`out-${p.id}`} page={p} onAction={onPageAction}><WorkspaceLink className="relation-item" to={{ kind: "page", id: p.id }} navigate={navigate}><PageIcon page={p} /><span>{p.title}<small>Linked page</small></span><ChevronRight size={14} /></WorkspaceLink></PageContextMenu>)}
        {backlinks.map((p) => <PageContextMenu key={`in-${p.id}`} page={p} onAction={onPageAction}><WorkspaceLink className="relation-item" to={{ kind: "page", id: p.id }} navigate={navigate}><PageIcon page={p} /><span>{p.title}<small>Backlink</small></span><ChevronRight size={14} /></WorkspaceLink></PageContextMenu>)}
        {tasks.map((t) => <button className="relation-item" key={t.id} onClick={() => onTask(t.id)}><span className="status-dot" data-status={t.status} /><span>{t.title}<small>{t.status}</small></span><ChevronRight size={14} /></button>)}
      </div>
    </div>}
  </div>;
}
