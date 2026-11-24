"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { ArrowDownRight, ArrowRight, CalendarDays, FileText, Folder, ListTodo, Search, Sparkles, X } from "lucide-react";
import { useId, useMemo, useRef, useState } from "react";
import type { Context, Source } from "@/agent/types";
import type { Page } from "@/workspace/model";
import type { createSearch } from "@/workspace/search";
import { mainLinks } from "./navigation";
import type { Destination } from "./ui";

export type PaletteState = { mode: "search" | "ask"; prompt?: string; context?: Context; scope?: "pages" };
type Choice = { key: string; title: string; detail?: string; icon: typeof Search } & ({ destination: Destination } | { source: Source });
const examples = ["Show my open tasks", "List my pages", "Create a page called Ideas"];
const pageLimit = 60;

export function Palette({ state, pages, search, onClose, onResult, onNavigate, run, running, modelEnabled }: {
  state: PaletteState; pages: Page[]; search: ReturnType<typeof createSearch>; onClose: () => void;
  onResult: (source: Source) => void; onNavigate: (to: Destination) => void;
  run: (prompt: string, context: Context) => void; running: boolean; modelEnabled: boolean;
}) {
  const [mode, setMode] = useState(state.mode);
  const [query, setQuery] = useState("");
  const [prompt, setPrompt] = useState(state.prompt ?? "");
  const [active, setActive] = useState(0);
  const [limit, setLimit] = useState(pageLimit);
  const field = useRef<HTMLInputElement>(null);
  const listId = useId();
  const isAsk = mode === "ask";
  const pagesOnly = state.scope === "pages";
  const input = isAsk ? prompt : query;
  const { destinations, records, more } = useMemo(() => {
    const text = query.trim();
    const byId = new Map(pages.map((page) => [page.id, page]));
    const pageChoices = (list: Page[]): Choice[] => list.map((p) => ({
      key: `page-${p.id}`, title: p.title, detail: byId.get(p.parentId ?? "")?.title ?? (p.kind === "folder" ? "Folder" : "Workspace"),
      icon: p.kind === "folder" ? Folder : FileText, source: { id: p.id, kind: "page", title: p.title },
    }));
    const found: Choice[] = text
      ? search(text, pagesOnly ? limit + 1 : 12, pagesOnly ? "page" : undefined).map((r) => ({
        key: `${r.kind}-${r.id}`, title: r.title, detail: r.detail, source: r,
        icon: r.kind === "task" ? ListTodo : byId.get(r.id)?.kind === "folder" ? Folder : FileText,
      }))
      : pageChoices(pagesOnly ? [...pages].sort((a, b) => a.title.localeCompare(b.title)).slice(0, limit + 1) : pages.filter((p) => p.kind === "page").slice(0, 5));
    const destinationResults: Choice[] = pagesOnly ? [] : mainLinks
      .filter(({ label, kind }) => !text || label.toLocaleLowerCase().includes(text.toLocaleLowerCase()) || (kind === "home" && text.toLowerCase() === "home"))
      .map(({ kind, label, icon }) => ({ key: kind, title: label, icon, destination: { kind } }));
    if (!pagesOnly && text && "calendar".includes(text.toLowerCase())) {
      destinationResults.push({ key: "tasks-calendar", title: "Calendar", detail: "My tasks", icon: CalendarDays, destination: { kind: "tasks", view: "calendar" } });
    }
    return { destinations: destinationResults, records: pagesOnly ? found.slice(0, limit) : found, more: pagesOnly && found.length > limit };
  }, [limit, pages, pagesOnly, query, search]);
  const results = [...destinations, ...records];
  const prompts = input.trim() ? [input] : examples;
  const max = isAsk ? prompts.length : results.length;
  const activeIndex = Math.min(active, Math.max(0, max - 1));
  const optionId = (index: number) => `${listId}-option-${index}`;
  const execute = (value: string) => { if (!running && value.trim()) run(value.trim(), state.context ?? {}); };
  const pick = (choice: Choice) => "destination" in choice ? onNavigate(choice.destination) : onResult(choice.source);
  const select = (index: number) => {
    setActive(index);
    document.getElementById(optionId(index))?.scrollIntoView({ block: "nearest" });
  };
  const renderChoice = (choice: Choice, i: number) => <button
    type="button" role="option" aria-selected={i === activeIndex} tabIndex={-1} key={choice.key} id={optionId(i)}
    className={`palette-option ${i === activeIndex ? "active" : ""}`} onPointerMove={() => setActive(i)}
    onMouseDown={(event) => event.preventDefault()} onClick={() => pick(choice)}>
    <choice.icon size={16} /><span>{choice.title}</span>{choice.detail && <small>{choice.detail}</small>}<ArrowRight className="option-arrow" size={14} />
  </button>;
  const searchLabel = pagesOnly ? "Browse pages" : "Search workspace";
  return <Dialog.Root open onOpenChange={(value) => { if (!value) onClose(); }}>
    <Dialog.Portal><Dialog.Overlay className="dialog-overlay palette-overlay" />
      <Dialog.Content className="palette panel" onOpenAutoFocus={(e) => { e.preventDefault(); field.current?.focus(); field.current?.select(); }}
        onCloseAutoFocus={(event) => event.preventDefault()}>
        <Dialog.Title className="sr-only">{isAsk ? "Ask Godspeed" : searchLabel}</Dialog.Title>
        <Dialog.Description className="sr-only">Find a page, open a workspace view, or run a command.</Dialog.Description>
        <div className="palette-tabs">{(["search", "ask"] as const).map((item) => <button key={item} className={mode === item ? "selected" : ""} aria-pressed={mode === item} onClick={() => {
          setMode(item); setActive(0); field.current?.focus();
        }}>
          {item === "search" ? <><Search size={15} /> {pagesOnly ? "Pages" : "Search"}</> : <><Sparkles size={15} /> Ask Godspeed</>}
        </button>)}<Dialog.Close className="icon-button palette-close" aria-label="Close"><X size={16} /></Dialog.Close></div>
        <div className="palette-input">{isAsk ? <Sparkles size={20} /> : <Search size={20} />}
          <input ref={field} value={input} maxLength={isAsk ? 2_000 : 250}
            {...(!isAsk && { role: "combobox", "aria-expanded": results.length > 0, "aria-autocomplete": "list" as const,
              "aria-controls": listId, "aria-activedescendant": results.length ? optionId(activeIndex) : undefined })}
            aria-label={isAsk ? "Workspace command" : pagesOnly ? "Filter pages" : "Search query"}
            placeholder={isAsk ? "What would you like to do?" : pagesOnly ? "Filter pages…" : "Search pages, tasks, or views…"}
            onChange={(e) => {
              if (isAsk) setPrompt(e.target.value);
              else { setQuery(e.target.value); setLimit(pageLimit); }
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                if (max) select((activeIndex + (e.key === "ArrowDown" ? 1 : -1) + max) % max);
              }
              if (e.key === "Enter") {
                e.preventDefault();
                if (isAsk) execute(prompts[activeIndex] ?? "");
                else if (results[activeIndex]) pick(results[activeIndex]);
              }
            }} />
        </div>
        {isAsk && (state.context?.selectedText || state.context?.taskId || state.context?.databaseId || state.context?.pageId) && <div className="palette-context">
          {state.context.taskId || state.context.databaseId ? <ListTodo size={14} /> : <FileText size={14} />}
          {state.context.selectedText ? `Using selected text · ${state.context.selectedText.length} characters` : state.context.taskId ? "Using this task" : state.context.databaseId ? "Using this database" : "Using this page"}
        </div>}
        <div className="palette-options">
          {isAsk ? <>
            <p className="palette-group-label">{input.trim() ? "Command" : "Suggestions"}</p>
            {prompts.map((choice, i) => <button disabled={running} id={optionId(i)} key={choice} className={`palette-option ${i === activeIndex ? "active" : ""}`} onPointerMove={() => setActive(i)} onClick={() => execute(choice)}>
              {input.trim() ? <Sparkles size={16} /> : <ArrowDownRight size={16} />}<span>{input.trim() ? `Run “${choice}”` : choice}</span><ArrowRight className="option-arrow" size={14} />
            </button>)}
            {running && <p className="palette-empty">A run is already in progress.</p>}
          </> : <>
            <div id={listId} role="listbox" aria-label={pagesOnly ? "Pages" : "Search results"} hidden={!results.length}>
              {destinations.length > 0 && <div role="group" aria-label="Views"><p className="palette-group-label" aria-hidden="true">Views</p>{destinations.map(renderChoice)}</div>}
              {records.length > 0 && <div role="group" aria-label={pagesOnly ? "Pages" : query.trim() ? "Pages and tasks" : "Recently edited"}>
                <p className="palette-group-label" aria-hidden="true">{pagesOnly ? "Pages" : query.trim() ? "Pages and tasks" : "Recently edited"}</p>{records.map((record, i) => renderChoice(record, destinations.length + i))}
              </div>}
            </div>
            {!results.length && <p className="palette-empty" role="status">{query.trim() ? "No results. Try a different title or keyword." : "No pages yet."}</p>}
            {more && <button className="text-button palette-more" onClick={() => {
              setActive(results.length);
              setLimit(limit + pageLimit);
              field.current?.focus();
              requestAnimationFrame(() => document.getElementById(optionId(results.length))?.scrollIntoView({ block: "nearest" }));
            }}>Show more pages</button>}
          </>}
        </div>
        <footer className="palette-footer"><span>{isAsk && modelEnabled ? "Model requests use OpenAI" : "On this device"}</span><span><kbd>↑ ↓</kbd> Navigate <kbd>↵</kbd> {isAsk ? "Run" : "Open"} <kbd>Esc</kbd> Close</span></footer>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
