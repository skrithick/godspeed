"use client";

import { ArrowRight, FilePlus2, FolderSymlink, Link2, Pencil, Star, Tags, Trash2 } from "lucide-react";
import { useState, type ReactElement } from "react";
import { isDescendant, splitTags, type Page } from "@/workspace/model";
import { repo } from "@/workspace/repository";
import { ContextMenu, ContextMenuItem, ContextMenuSeparator, MenuItem, MenuSeparator, Modal } from "./ui";
import { ChoiceSelect, noChoice, optionalChoice } from "./primitives/select";

export type PageDialogKind = "rename" | "details" | "move" | "delete";
export type PageAction = PageDialogKind | "open" | "copy-link" | "favorite" | "subpage";
export type OnPageAction = (page: Page, action: PageAction) => void;

export function PageMenuItems({ page, onAction, contextual = false }: { page: Page; onAction: OnPageAction; contextual?: boolean }) {
  const Item = contextual ? ContextMenuItem : MenuItem;
  const Separator = contextual ? ContextMenuSeparator : MenuSeparator;
  return <>
    {contextual && <Item onSelect={() => onAction(page, "open")}><ArrowRight size={16} /> Open {page.kind}</Item>}
    <Item onSelect={() => onAction(page, "copy-link")}><Link2 size={16} /> Copy link</Item>
    {contextual && <>
      <Separator />
      <Item onSelect={() => onAction(page, "rename")}><Pencil size={16} /> Rename</Item>
      <Item onSelect={() => onAction(page, "favorite")}><Star size={16} /> {page.favorite ? "Remove from favorites" : "Add to favorites"}</Item>
      <Item onSelect={() => onAction(page, "details")}><Tags size={16} /> Tags and links</Item>
      <Item onSelect={() => onAction(page, "subpage")}><FilePlus2 size={16} /> Add inside…</Item>
    </>}
    <Item onSelect={() => onAction(page, "move")}><FolderSymlink size={16} /> Move to…</Item>
    <Separator />
    <Item destructive onSelect={() => onAction(page, "delete")}><Trash2 size={16} /> Delete {page.kind}…</Item>
  </>;
}

export function PageContextMenu({ page, onAction, children }: { page: Page; onAction: OnPageAction; children: ReactElement }) {
  return <ContextMenu label={`Options for ${page.title}`} items={<PageMenuItems page={page} onAction={onAction} contextual />}>{children}</ContextMenu>;
}

export function PageActionDialog({ kind, page, pages, close, deleted }: {
  kind: PageDialogKind; page: Page; pages: Page[]; close: () => void; deleted: () => void;
}) {
  const [revision] = useState(page.revision);
  const [links, setLinks] = useState(page.links);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const hasChildren = pages.some((child) => child.parentId === page.id);
  const candidates = pages.filter((p) => p.id !== page.id);
  const title = kind === "delete" ? `Delete ${page.kind}?` : kind === "move" ? `Move ${page.kind}` : kind === "rename" ? `Rename ${page.kind}` : "Page details";
  const description = kind === "delete" ? hasChildren
    ? "Move any child pages to another location before deleting this item."
    : `This permanently removes “${page.title}” and its blocks. Linked tasks are kept, but their links to this item are removed.`
    : kind === "move" ? "Choose where this item and its children belong."
      : kind === "rename" ? "The link to this item will stay the same." : "Tags make pages searchable. Links create backlinks automatically.";
  return <Modal open onClose={close} title={title} description={description}>
    <form className="dialog-form" onSubmit={async (event) => {
      event.preventDefault();
      if (busy || (kind === "delete" && hasChildren)) return;
      const form = new FormData(event.currentTarget);
      setBusy(true); setError("");
      try {
        switch (kind) {
          case "delete": await repo.deletePage(page.id, revision, true); deleted(); break;
          case "move": await repo.movePage(page.id, optionalChoice(form.get("parent"))); break;
          case "rename": await repo.patchPage(page.id, { title: String(form.get("title") ?? "") }, revision); break;
          case "details": await repo.patchPage(page.id, { tags: splitTags(String(form.get("tags") ?? "")), links }, revision); break;
        }
        close();
      } catch (err) { setError(err instanceof Error ? err.message : "Could not save."); }
      finally { setBusy(false); }
    }}>
      {kind === "delete" && !hasChildren && <p className="muted">Export a Godspeed backup from Settings first if you need a copy.</p>}
      {kind === "rename" && <label>Title<input name="title" defaultValue={page.title} maxLength={160} required autoFocus onFocus={(event) => event.currentTarget.select()} /></label>}
      {kind === "move" && <label>Destination<ChoiceSelect label="Destination" name="parent" defaultValue={page.parentId ?? noChoice}
        options={[{ value: noChoice, label: "Workspace root" }, ...candidates.filter((p) => !isDescendant(pages, p.id, page.id)).map((p) => ({ value: p.id, label: p.title }))]} /></label>}
      {kind === "details" && <>
        <label>Tags <input name="tags" defaultValue={page.tags.join(", ")} placeholder="Planning, Ideas" /><small>Separate tags with commas.</small></label>
        <fieldset><legend>Linked pages</legend><div className="relation-choices">{candidates.map((p) => <label key={p.id} className="check-label"><input type="checkbox" checked={links.includes(p.id)} onChange={(event) => setLinks(event.target.checked ? [...links, p.id] : links.filter((id) => id !== p.id))} />{p.title}</label>)}</div></fieldset>
      </>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="dialog-actions">
        <button type="button" className="button" onClick={close}>Cancel</button>
        <button className={`button ${kind === "delete" ? "danger" : "primary"}`} disabled={busy || (kind === "delete" && hasChildren)}>
          {kind === "move" ? `Move ${page.kind}` : kind === "delete" ? `Delete ${page.kind}` : kind === "rename" ? "Save name" : "Save details"}
        </button>
      </div>
    </form>
  </Modal>;
}
