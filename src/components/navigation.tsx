"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { ChevronRight, CircleHelp, Files, House, ListTodo, PanelLeft, PanelLeftClose, PanelLeftOpen, Plus, Search, Settings2, Sparkles, Star, X } from "lucide-react";
import { useMemo, useRef, useState, useSyncExternalStore, type DragEvent, type ReactNode, type Ref } from "react";
import type { Page } from "@/workspace/model";
import { PageContextMenu, type OnPageAction } from "./page-actions";
import { PageIcon, WorkspaceLink, type Destination } from "./ui";

export const mainLinks = [
  { kind: "home", label: "Overview", icon: House },
  { kind: "tasks", label: "My tasks", icon: ListTodo },
  { kind: "canvas", label: "Agent Chat", icon: Sparkles },
] as const;
const pageMime = "application/x-godspeed-page";
const compactQuery = "(max-width: 820px)";
type BranchState = { open: boolean; closedOn?: string };
const subscribeToCompact = (notify: () => void) => {
  const media = matchMedia(compactQuery);
  media.addEventListener("change", notify);
  return () => media.removeEventListener("change", notify);
};
export const useCompactNavigation = () => useSyncExternalStore(subscribeToCompact, () => matchMedia(compactQuery).matches, () => false);

export const sidebarMin = 208;
export const sidebarMax = 380;
export const clampSidebar = (width: number) => Math.round(Math.min(sidebarMax, Math.max(sidebarMin, width)));

function SidebarResize({ width, preview, commit }: { width: number; preview: (width: number | null) => void; commit: (width: number) => void }) {
  const drag = useRef<{ pointer: number; start: number; width: number; next: number; direction: number } | null>(null);
  return <div className="sidebar-resize" role="separator" tabIndex={0} aria-label="Sidebar width" aria-orientation="vertical"
    aria-controls="desktop-sidebar" aria-valuemin={sidebarMin} aria-valuemax={sidebarMax} aria-valuenow={width}
    onKeyDown={(event) => {
      const direction = getComputedStyle(event.currentTarget).direction === "rtl" ? -1 : 1;
      const step = event.shiftKey ? 32 : 8;
      const next = event.key === "Home" ? sidebarMin : event.key === "End" ? sidebarMax :
        event.key === "ArrowLeft" ? width - step * direction : event.key === "ArrowRight" ? width + step * direction : null;
      if (next === null) return;
      event.preventDefault(); commit(clampSidebar(next));
    }}
    onPointerDown={(event) => {
      if (!event.isPrimary || event.button !== 0) return;
      const direction = getComputedStyle(event.currentTarget).direction === "rtl" ? -1 : 1;
      drag.current = { pointer: event.pointerId, start: event.clientX, width, next: width, direction };
      event.currentTarget.setPointerCapture(event.pointerId);
      preview(width);
    }}
    onPointerMove={(event) => {
      const current = drag.current;
      if (!current || current.pointer !== event.pointerId) return;
      current.next = clampSidebar(current.width + (event.clientX - current.start) * current.direction);
      preview(current.next);
    }}
    onPointerUp={(event) => {
      const current = drag.current;
      if (!current || current.pointer !== event.pointerId) return;
      drag.current = null;
      commit(current.next);
      preview(null);
    }}
    onLostPointerCapture={() => { if (drag.current) { drag.current = null; preview(null); } }}
  />;
}

export function Sidebar({ pages, dest, navigate, compact, open, collapsed, toggleCollapse, width, previewWidth, commitWidth, onOpenChange, onRestoreFocus, onSearch, onBrowsePages, onNewPage, onMove, onPageAction, onSettings, onHelp }: {
  pages: Page[]; dest: Destination; navigate: (dest: Destination) => void; compact: boolean; open: boolean;
  collapsed: boolean; toggleCollapse: () => void;
  width: number; previewWidth: (width: number | null) => void; commitWidth: (width: number) => void;
  onOpenChange: (open: boolean) => void; onRestoreFocus: () => void;
  onSearch: () => void; onBrowsePages: () => void; onNewPage: () => void; onMove: (id: string, parentId: string | null) => void;
  onPageAction: OnPageAction;
  onSettings: () => void; onHelp: () => void;
}) {
  const [expanded, setExpanded] = useState<Map<string, BranchState>>(() => new Map());
  const [dragTarget, setDragTarget] = useState<string | null>(null);
  const branches = useMemo(() => {
    const byParent = new Map<string | null, Page[]>();
    for (const page of pages) {
      const branch = byParent.get(page.parentId) ?? [];
      branch.push(page);
      byParent.set(page.parentId, branch);
    }
    for (const branch of byParent.values()) branch.sort((a, b) => Number(b.kind === "folder") - Number(a.kind === "folder") || a.title.localeCompare(b.title));
    return byParent;
  }, [pages]);
  const roots = branches.get(null) ?? [];
  const favorites = pages.filter((p) => p.favorite);
  const currentPage = dest.kind === "page" ? dest.id : undefined;
  const ancestors = new Set<string>();
  if (dest.kind === "page") {
    const byId = new Map(pages.map((p) => [p.id, p]));
    for (let node = byId.get(dest.id)?.parentId; node && !ancestors.has(node); node = byId.get(node)?.parentId) ancestors.add(node);
  }
  const setBranch = (id: string, value: boolean) => setExpanded((current) => {
    const next = new Map(current);
    next.set(id, { open: value, closedOn: value ? undefined : currentPage });
    return next;
  });
  const drop = (e: DragEvent, parent: string | null) => {
    if (!e.dataTransfer.types.includes(pageMime)) return;
    e.stopPropagation(); e.preventDefault();
    setDragTarget(null);
    const id = e.dataTransfer.getData(pageMime);
    if (id && id !== parent) {
      onMove(id, parent);
      if (parent) setBranch(parent, true);
    }
  };
  const tree = (list: Page[], depth: number) => list.map((page) => {
    const children = branches.get(page.id) ?? [];
    const hasChildren = Boolean(children.length);
    const expansion = expanded.get(page.id);
    const explicitlyClosed = expansion?.open === false && expansion.closedOn === currentPage;
    const isExpanded = expansion?.open === true || (ancestors.has(page.id) && !explicitlyClosed);
    const active = dest.kind === "page" && dest.id === page.id;
    return <li key={page.id}>
      <div className={`tree-row ${active ? "active" : ""} ${dragTarget === page.id ? "drop-target" : ""}`} style={{ "--depth": Math.min(depth, 7) } as React.CSSProperties}
        onDragOver={(e) => { if (e.dataTransfer.types.includes(pageMime)) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setDragTarget(page.id); } }}
        onDragLeave={(e) => { if (!(e.relatedTarget instanceof Node) || !e.currentTarget.contains(e.relatedTarget)) setDragTarget(null); }} onDrop={(e) => drop(e, page.id)}>
        <button className={`tree-toggle ${!hasChildren ? "leaf" : ""}`} disabled={!hasChildren} tabIndex={hasChildren ? 0 : -1} aria-label={`${isExpanded ? "Collapse" : "Expand"} ${page.title}`} aria-expanded={hasChildren ? isExpanded : undefined} onClick={() => setBranch(page.id, !isExpanded)}>
          <ChevronRight size={13} className={isExpanded ? "rotated" : ""} />
        </button>
        <PageContextMenu page={page} onAction={onPageAction}>
          <WorkspaceLink className="tree-page" aria-current={active ? "page" : undefined} draggable
            onDragStart={(e) => { e.dataTransfer.setData(pageMime, page.id); e.dataTransfer.effectAllowed = "move"; }}
            onDragEnd={() => setDragTarget(null)} to={{ kind: "page", id: page.id }} navigate={navigate}>
            <PageIcon page={page} /><span>{page.title}</span>
          </WorkspaceLink>
        </PageContextMenu>
      </div>
      {isExpanded && hasChildren && depth < 200 && <ul>{tree(children, depth + 1)}</ul>}
    </li>;
  });
  const iconbar = !compact && collapsed;
  const showRootCreate = dest.kind !== "home";
  const content = <aside id={compact ? undefined : "desktop-sidebar"} className={`sidebar${iconbar ? " sidebar-iconbar" : ""}`} aria-label="Workspace navigation">
      <div className="sidebar-brand">
        <WorkspaceLink to={{ kind: "home" }} navigate={navigate} className="brand" aria-label="Godspeed overview" hidden={iconbar}>Godspeed</WorkspaceLink>
        {compact ? <Dialog.Close className="icon-button sidebar-close" aria-label="Close navigation"><X size={19} /></Dialog.Close>
          : <button className="icon-button sidebar-collapse" onClick={toggleCollapse} aria-expanded={!iconbar} aria-controls="desktop-sidebar"
            aria-label={iconbar ? "Expand sidebar" : "Collapse sidebar"} title={iconbar ? "Expand sidebar" : "Collapse sidebar"}>
            {iconbar ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </button>}
      </div>
      <div className="sidebar-scroll">
        <button className="nav-search" onClick={onSearch} aria-label="Search workspace" title={iconbar ? "Search workspace" : undefined}><Search size={16} /><span>Search workspace</span><kbd aria-hidden="true">{/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘ K" : "Ctrl K"}</kbd></button>
        <nav aria-label="Main">
          {mainLinks.map(({ kind, label, icon: Icon }) => <WorkspaceLink key={kind} className={`nav-link ${dest.kind === kind ? "active" : ""}`} aria-label={label}
            title={iconbar ? label : undefined} aria-current={dest.kind === kind ? "page" : undefined} to={{ kind }} navigate={navigate}><Icon size={17} /><span>{label}</span></WorkspaceLink>)}
        </nav>
        {!iconbar && favorites.length > 0 && <nav aria-label="Favorites" className="nav-favorites">
          <p className="nav-label">Favorites</p>
          {favorites.map((page) => <PageContextMenu key={page.id} page={page} onAction={onPageAction}>
            <WorkspaceLink className="nav-link favorite-link" to={{ kind: "page", id: page.id }} navigate={navigate}><Star size={16} /><span>{page.title}</span></WorkspaceLink>
          </PageContextMenu>)}
        </nav>}
        {iconbar ? <nav aria-label="Pages and folders" className="nav-pages">
          <button className={`nav-link${dest.kind === "page" ? " active" : ""}`} onClick={onBrowsePages} aria-label="Browse pages" title="Browse pages"><Files size={17} /></button>
          {showRootCreate && <button className="nav-link" onClick={onNewPage} aria-label="Add page or folder" title="Add page or folder"><Plus size={18} /></button>}
        </nav> : <nav aria-label="Pages and folders" className="nav-pages">
          <div className={`nav-label tree-label ${dragTarget === "root" ? "drop-target" : ""}`} onDragOver={(e) => {
            if (e.dataTransfer.types.includes(pageMime)) { e.preventDefault(); setDragTarget("root"); }
          }} onDragLeave={() => setDragTarget(null)} onDrop={(e) => drop(e, null)}>
            <button className="tree-browse" aria-label="Browse pages" title="Browse pages" onClick={onBrowsePages}>Pages</button>
            {showRootCreate && <button className="icon-button" aria-label="Add page or folder" title="Add page or folder" onClick={onNewPage}><Plus size={16} /></button>}
          </div>
          <ul className="tree">{tree(roots, 0)}</ul>
        </nav>}
      </div>
      <div className="sidebar-footer">
        <button className="nav-link" onClick={onSettings} aria-label="Settings" title={iconbar ? "Settings" : undefined}><Settings2 size={17} /><span>Settings</span></button>
        <button className="nav-link" onClick={onHelp} aria-label="Help & shortcuts" title={iconbar ? "Help & shortcuts" : undefined}><CircleHelp size={17} /><span>Help & shortcuts</span></button>
      </div>
    </aside>;
  if (!compact) return <div className="desktop-sidebar">
    {content}
    {!iconbar && <SidebarResize width={width} preview={previewWidth} commit={commitWidth} />}
  </div>;
  return <Dialog.Root open={open} onOpenChange={onOpenChange}>
    <Dialog.Portal>
      <Dialog.Overlay className="nav-overlay" />
      <Dialog.Content className="nav-drawer" onCloseAutoFocus={(event) => { event.preventDefault(); onRestoreFocus(); }}>
        <Dialog.Title className="sr-only">Workspace navigation</Dialog.Title>
        <Dialog.Description className="sr-only">Open a workspace view, page, or settings.</Dialog.Description>
        {content}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}

export function Topbar({ dest, pages, navigate, onMenu, menuRef, menuOpen, actions, onSearch }: {
  dest: Destination; pages: Page[]; navigate: (d: Destination) => void; onMenu: () => void; menuRef: Ref<HTMLButtonElement>;
  menuOpen: boolean; onSearch: () => void;
  actions?: ReactNode;
}) {
  const crumbs: Page[] = [];
  if (dest.kind === "page") {
    const byId = new Map(pages.map((p) => [p.id, p]));
    const visited = new Set<string>();
    for (let cursor: string | null = dest.id; cursor && !visited.has(cursor);) {
      visited.add(cursor);
      const page = byId.get(cursor);
      if (!page) break;
      crumbs.unshift(page);
      cursor = page.parentId;
    }
  }
  return <header className={`topbar${dest.kind === "canvas" ? " topbar-chat" : ""}`}>
    <div className="topbar-leading">
      <button ref={menuRef} className="icon-button mobile-toggle" onClick={onMenu} aria-label="Open navigation" aria-haspopup="dialog" aria-expanded={menuOpen}><PanelLeft size={20} /></button>
      <nav aria-label="Breadcrumb" className="breadcrumb"><ol>
        {dest.kind !== "home" && <li className="crumb-root">
          <WorkspaceLink to={{ kind: "home" }} navigate={navigate}>Workspace</WorkspaceLink><ChevronRight size={13} className="crumb-separator" aria-hidden="true" />
        </li>}
        {dest.kind === "page" && crumbs.slice(0, -1).map((page, index) => <li className={`crumb-parent ${index === crumbs.length - 2 ? "crumb-nearest" : ""}`} key={page.id}>
          <WorkspaceLink to={{ kind: "page", id: page.id }} navigate={navigate} title={page.title}>{page.title}</WorkspaceLink><ChevronRight size={13} className="crumb-separator" aria-hidden="true" />
        </li>)}
        <li className="crumb-current" aria-current="page">{dest.kind === "canvas" ? <h1>Agent Chat</h1> : dest.kind === "page" ? crumbs.at(-1)?.title ?? "Page" : mainLinks.find((item) => item.kind === dest.kind)?.label}</li>
      </ol></nav>
    </div>
    <div className="topbar-actions">
      {actions}
      <button className="icon-button mobile-search" onClick={onSearch} aria-label="Search workspace" title="Search workspace"><Search size={19} /></button>
    </div>
  </header>;
}
