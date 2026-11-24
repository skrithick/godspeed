"use client";

import { Check, Database, Download, HardDrive, Moon, Sparkles, Sun, Trash2, Upload } from "lucide-react";
import { useId, useRef, useState, type ComponentProps } from "react";
import { clearSessionDrafts } from "@/workspace/identity";
import { glyphs, type Backup, type Page, validateBackup } from "@/workspace/model";
import { repo } from "@/workspace/repository";
import { Modal, PageIcon } from "./ui";
import { ChoiceSelect, noChoice, optionalChoice } from "./primitives/select";
import { ProviderSettings } from "./provider-settings";

export type Theme = "light" | "dark";

const categories = [
  { id: "appearance", label: "Appearance", icon: Sun },
  { id: "ai", label: "AI provider", icon: Sparkles },
  { id: "data", label: "Workspace data", icon: HardDrive },
] as const;

export function Settings({ close, theme, setTheme, provider, onDataReplaced, notify }: {
  close: () => void; theme: Theme; setTheme: (t: Theme) => void; provider: ComponentProps<typeof ProviderSettings>;
  onDataReplaced: (notice: string) => void; notify: (s: string) => void;
}) {
  const [restore, setRestore] = useState<Backup | null>(null);
  const [reset, setReset] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [category, setCategory] = useState<(typeof categories)[number]["id"]>(provider.notice ? "ai" : "appearance");
  const base = useId();
  const scrollPanel = useRef<HTMLDivElement>(null);
  const upload = useRef<HTMLInputElement>(null);
  const choose = (next: typeof category) => {
    setCategory(next);
    if (scrollPanel.current) scrollPanel.current.scrollTop = 0;
  };
  const panel = (id: typeof category) => ({
    id: `${base}-${id}-panel`, "aria-labelledby": `${base}-${id}-tab`, hidden: category !== id,
  });
  return <Modal open onClose={() => { if (!busy) close(); }} title="Workspace settings" description="Manage the look, AI access, and data for this workspace." className="settings-dialog">
    <div className="settings-body">
      <div className="settings-nav" role="tablist" aria-label="Settings categories" onKeyDown={(event) => {
        const index = categories.findIndex(({ id }) => id === category);
        const count = categories.length;
        const next = event.key === "Home" ? 0 : event.key === "End" ? count - 1 :
          event.key === "ArrowDown" || event.key === "ArrowRight" ? (index + 1) % count :
          event.key === "ArrowUp" || event.key === "ArrowLeft" ? (index + count - 1) % count : -1;
        if (next === -1) return;
        event.preventDefault();
        const id = categories[next].id;
        choose(id);
        document.getElementById(`${base}-${id}-tab`)?.focus();
      }}>
        {categories.map(({ id, label, icon: Icon }) => <button key={id} type="button" role="tab" id={`${base}-${id}-tab`}
          aria-controls={`${base}-${id}-panel`} aria-selected={category === id} tabIndex={category === id ? 0 : -1} onClick={() => choose(id)}>
          <Icon size={16} aria-hidden="true" /><span>{label}</span>
        </button>)}
      </div>
      <div className="settings-content" ref={scrollPanel}>
      <section className="settings-section" role="tabpanel" {...panel("appearance")}>
        <div className="settings-title"><h3>Appearance</h3><p>Choose a theme for this browser.</p></div>
        <div className="theme-previews" role="group" aria-label="Color theme">
          {(["light", "dark"] as const).map((choice) => {
            const Icon = choice === "light" ? Sun : Moon;
            return <button key={choice} className="theme-choice" data-preview={choice} aria-pressed={theme === choice} onClick={() => setTheme(choice)}>
              <span className="theme-preview" aria-hidden="true"><i /><i /></span>
              <span className="theme-choice-label"><Icon size={15} aria-hidden="true" />{choice === "light" ? "Light" : "Dark"}
                {theme === choice && <Check className="theme-choice-check" size={15} aria-hidden="true" />}</span>
            </button>;
          })}
        </div>
      </section>
      <section className="settings-section" role="tabpanel" {...panel("ai")}>
        <ProviderSettings {...provider} />
      </section>
      <section className="settings-section" role="tabpanel" {...panel("data")}>
        <div className="settings-title"><h3>Workspace data</h3><p>Back up or restore your pages, tasks, and databases.</p></div>
        <div className="settings-actions">
          <button className="button" disabled={busy} onClick={async () => {
            setBusy(true); setError("");
            try {
              const backup = await repo.backup();
              const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" }));
              const a = document.createElement("a"); a.href = url; a.download = `godspeed-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click();
              setTimeout(() => URL.revokeObjectURL(url), 5_000); notify("Backup downloaded.");
            } catch { setError("Could not export the workspace."); } finally { setBusy(false); }
          }}><Download size={16} /> Export backup</button>
          <button className="button" disabled={busy} onClick={() => upload.current?.click()}><Upload size={16} /> Restore backup</button>
          <input ref={upload} type="file" hidden accept=".json,application/json" aria-label="Select Godspeed backup file" onChange={async (e) => {
            const file = e.target.files?.[0]; e.target.value = "";
            if (!file) return;
            setError(""); setRestore(null); setReset(false); setConfirm(""); setBusy(true);
            try {
              if (file.size > 30_000_000) { setError("Backup exceeds the 30 MB restore limit."); return; }
              setRestore(validateBackup(JSON.parse(await file.text())));
            }
            catch { setError("This file isn't a valid Godspeed backup. No data was changed."); }
            finally { setBusy(false); }
          }} />
        </div>
        {restore && <div className="restore-confirm"><strong><Database size={15} /> Replace this workspace?</strong>
          <p>The backup has {restore.pages.length} pages and {restore.tasks.length} tasks. Restoring replaces current workspace data and clears chat history. Export a backup first if you want to keep your current work.</p>
          <label>Type RESTORE to continue<input aria-label="Restore confirmation" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></label>
          <div className="dialog-actions"><button className="button" onClick={() => setRestore(null)}>Cancel</button><button className="button danger" disabled={confirm !== "RESTORE" || busy} onClick={async () => {
            setBusy(true);
            try { await repo.restore(restore, true); onDataReplaced("Workspace restored."); }
            catch (err) { setError(err instanceof Error ? err.message : "Restore failed."); }
            finally { setBusy(false); }
          }}>Replace workspace</button></div>
        </div>}
        <div className="settings-reset">
          <div><h4>Clear workspace</h4><p>Delete the data stored in this browser.</p></div>
          <button className="button danger" disabled={busy} onClick={() => {
            setRestore(null); setConfirm(""); setError(""); setReset(true);
          }}><Trash2 size={16} /> Reset workspace</button>
        </div>
        {reset && <form className="restore-confirm" onSubmit={async (event) => {
          event.preventDefault();
          if (confirm !== "RESET" || busy) return;
          setBusy(true); setError("");
          try {
            await repo.reset(true);
            clearSessionDrafts();
            onDataReplaced("Workspace cleared.");
          } catch (err) { setError(err instanceof Error ? err.message : "Could not reset the workspace."); }
          finally { setBusy(false); }
        }}>
          <strong><Trash2 size={15} /> Permanently clear this workspace?</strong>
          <p>This deletes all pages, folders, tasks, custom databases, and chat history in this browser. Export a backup first if you want to keep your work.</p>
          <label>Type RESET to continue<input aria-label="Reset confirmation" value={confirm} disabled={busy} onChange={(e) => setConfirm(e.target.value)} /></label>
          <div className="dialog-actions"><button type="button" className="button" disabled={busy} onClick={() => setReset(false)}>Cancel</button><button className="button danger" disabled={confirm !== "RESET" || busy}>Clear all data</button></div>
        </form>}
        {error && <p className="form-error" role="alert">{error}</p>}
      </section>
      </div>
    </div>
  </Modal>;
}

const iconLabels: Record<Page["glyph"], string> = {
  file: "Document", folder: "Folder", layers: "Layers", book: "Book", compass: "Compass", pen: "Pen", flask: "Flask", flag: "Flag",
};

export function NewPage({ parentId, kind, pages, close, onCreated }: {
  parentId: string | null; kind: Page["kind"]; pages: Page[]; close: () => void; onCreated: (p: Page) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pageKind, setPageKind] = useState(kind);
  const [chosenGlyph, setChosenGlyph] = useState<Page["glyph"] | null>(null);
  const glyph = chosenGlyph ?? (pageKind === "folder" ? "folder" : "file");
  return <Modal open onClose={close} title="Create in workspace" description="Add a page for writing, or a folder to organize your work.">
    <form className="dialog-form" onSubmit={async (e) => {
      e.preventDefault();
      const values = new FormData(e.currentTarget);
      setBusy(true); setError("");
      try {
        onCreated(await repo.createPage({ title: String(values.get("title") ?? ""), kind: pageKind, glyph, parentId: optionalChoice(values.get("parent")) }));
      } catch (err) { setError(err instanceof Error ? err.message : "Couldn’t create the page."); }
      finally { setBusy(false); }
    }}>
      <label>Title<input autoFocus name="title" required maxLength={160} placeholder="Untitled idea…" /></label>
      <div className="form-grid"><label>Type<ChoiceSelect label="Type" value={pageKind} onValueChange={(value) => setPageKind(value === "folder" ? "folder" : "page")}
        options={[{ value: "page", label: "Page" }, { value: "folder", label: "Folder" }]} /></label>
        <label>Location<ChoiceSelect label="Location" name="parent" defaultValue={parentId ?? noChoice}
          options={[{ value: noChoice, label: "Workspace root" }, ...pages.map((p) => ({ value: p.id, label: p.title }))]} /></label></div>
      <fieldset className="page-icon-picker">
        <legend>Icon</legend>
        <div className="page-icon-choices">
          {glyphs.map((value) => <label className="page-icon-choice" key={value} title={iconLabels[value]}>
            <input type="radio" name="icon" value={value} checked={glyph === value} className="sr-only" onChange={() => setChosenGlyph(value)} />
            <span className="sr-only">{iconLabels[value]}</span>
            <PageIcon page={{ glyph: value }} />
          </label>)}
        </div>
        <p className="page-icon-label">{iconLabels[glyph]}</p>
      </fieldset>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="dialog-actions"><button type="button" className="button" onClick={close}>Cancel</button><button className="button primary" disabled={busy}>Create</button></div>
    </form>
  </Modal>;
}

export function Help({ close }: { close: () => void }) {
  return <Modal open onClose={close} title="Keyboard shortcuts" description="Move through your workspace without reaching for the mouse.">
    <dl className="shortcut-list">{[
      ["Search the workspace", "⌘ / Ctrl + K"], ["Open Ask Godspeed", "⌘ / Ctrl + J"], ["Navigate command results", "↑ / ↓"], ["Open result or run command", "Enter"],
      ["Insert a block from an empty line", "/"], ["Bold selected text", "⌘ / Ctrl + B"], ["Italicize selected text", "⌘ / Ctrl + I"],
      ["Undo an editor change", "⌘ / Ctrl + Z"], ["Open options for a focused page or task", "Shift + F10"], ["Close the current dialog", "Esc"],
    ].map(([label, key]) => <div key={label}><dt>{label}</dt><dd><kbd>{key}</kbd></dd></div>)}</dl>
  </Modal>;
}
