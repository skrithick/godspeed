"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { CircleAlert, X } from "lucide-react";
import { Component, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { apiProvider, chatGPTProvider } from "@/agent/responses-provider";
import { modelLabel, validModelName, type ModelOption } from "@/agent/model-policy";
import { runAgent } from "@/agent/runtime";
import type { Context, Run, Source } from "@/agent/types";
import { chatConsentKey, migratePreferences, preferenceKeys } from "@/workspace/identity";
import { uid, type Page } from "@/workspace/model";
import { repo } from "@/workspace/repository";
import { createSearch } from "@/workspace/search";
import { AgentChat, ChatActions, type ChatHandle } from "./agent-chat";
import { clampSidebar, Sidebar, Topbar, useCompactNavigation } from "./navigation";
import { Overview } from "./overview";
import { PageActionDialog, type OnPageAction, type PageDialogKind } from "./page-actions";
import { PageView } from "./page-view";
import { Palette, type PaletteState } from "./palette";
import { RadialPattern } from "./radial-pattern";
import { Help, NewPage, Settings, type Theme } from "./settings";
import type { AccountNotice, APIConnection, PlanConnection, ProviderMode } from "./provider-settings";
import { TaskDialog, TaskView, type TaskSelection } from "./tasks";
import { destinationHash, readDestination, type Destination } from "./ui";

const home: Destination = { kind: "home" };
const sidebarPreference = "godspeed-sidebar-collapsed";
const billingPreference = "godspeed-ai-billing";
const planConsentPreference = "godspeed-plan-consent";
const localValue = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const writeLocal = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* Available this session. */ } };
function callbackNotice(): AccountNotice | null {
  const status = new URLSearchParams(location.search).get("chatgpt");
  return status === "welcome" || status === "connected" || status === "permission" || status === "cancelled" || status === "failed" ? status : null;
}
const sidebarWidthPreference = "godspeed-sidebar-width";
const message = (error: unknown) => error instanceof Error ? error.message : "Something went wrong.";

export function Workspace() {
  const [boot, setBoot] = useState<{ ready: boolean; error?: string }>({ ready: false });
  useEffect(() => {
    let active = true;
    repo.initialize().then(() => { if (active) setBoot({ ready: true }); }, (err) => {
      if (active) setBoot({ ready: false, error: message(err) });
    });
    return () => { active = false; };
  }, []);
  if (boot.error) return <WorkspaceFailure detail={boot.error} />;
  if (!boot.ready) return <div className="boot-screen"><span className="brand" aria-hidden="true">Godspeed</span><span className="spinner" /> Opening your workspace…</div>;
  return <WorkspaceBoundary><App /></WorkspaceBoundary>;
}

class WorkspaceBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null };
  static getDerivedStateFromError(error: unknown) { return { error: message(error) }; }
  render() { return this.state.error ? <WorkspaceFailure detail={this.state.error} /> : this.props.children; }
}
function WorkspaceFailure({ detail }: { detail: string }) {
  return <div className="boot-screen"><div className="failure panel"><span className="glyph tone-peach"><CircleAlert size={22} /></span><h1>Godspeed couldn’t open this workspace</h1><p>Check that this browser allows site storage, then try again. Existing workspace data hasn’t been reset.</p><p className="muted">{detail}</p><button className="button primary" onClick={() => location.reload()}>Try again</button></div></div>;
}

function App() {
  const pages = useLiveQuery(() => repo.pages(), [], []);
  const tasks = useLiveQuery(() => repo.allTasks(), [], []);
  const chats = useLiveQuery(() => repo.recentChats(), [], []);
  const [dest, setDest] = useState<Destination>(() => readDestination(location.hash));
  const [palette, setPalette] = useState<PaletteState | null>(null);
  const paletteOpen = Boolean(palette);
  const blocks = useLiveQuery(async () => paletteOpen ? await repo.allBlocks() : [], [paletteOpen], []);
  const search = useMemo(() => paletteOpen ? createSearch(pages, blocks, tasks) : () => [], [paletteOpen, pages, blocks, tasks]);
  const [accountNotice, setAccountNotice] = useState(callbackNotice);
  const [settings, setSettings] = useState(Boolean(accountNotice));
  const [help, setHelp] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return localStorage.getItem(sidebarPreference) === "true"; } catch { return false; }
  });
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(sidebarWidthPreference));
      if (Number.isFinite(saved) && saved > 0) return clampSidebar(saved);
    } catch { /* Use the default width. */ }
    return 236;
  });
  const compact = useCompactNavigation();
  const drawerOpen = compact && mobile;
  const [newPage, setNewPage] = useState<{ parentId: string | null; kind: Page["kind"] } | null>(null);
  const [pageDialog, setPageDialog] = useState<{ page: Page; kind: PageDialogKind } | null>(null);
  const [task, setTask] = useState<TaskSelection | null>(null);
  const [theme, setTheme] = useState<Theme>(() => document.documentElement.dataset.theme === "dark" ? "dark" : "light");
  const [mode, setMode] = useState<ProviderMode>(() => callbackNotice() || localValue(billingPreference) !== "api" ? "chatgpt" : "api");
  const [apiConsent, setApiConsent] = useState(() => localValue(chatConsentKey) === "true");
  const [planConsent, setPlanConsent] = useState(() => localValue(planConsentPreference) ?? "");
  const [connection, setConnection] = useState<APIConnection | null>(null);
  const [plan, setPlan] = useState<PlanConnection | null>(null);
  const [online, setOnline] = useState(navigator.onLine);
  const planAccount = plan?.selected;
  const usingChatGPT = mode === "chatgpt" && plan?.configured && planAccount && planConsent === planAccount ? planAccount : undefined;
  const usingApi = mode === "api" && apiConsent && connection?.configured;
  const modelKey = online && (usingChatGPT ? `godspeed-model:chatgpt:${usingChatGPT}` : usingApi ? "godspeed-model:api" : "");
  const [modelPreferences, setModelPreferences] = useState<Record<string, string>>({});
  const selectedModel = modelKey ? validModelName(modelPreferences[modelKey] ?? localValue(modelKey)) : undefined;
  const [catalog, setCatalog] = useState<{ account: string; options?: ModelOption[]; expires?: number; failed?: boolean } | null>(null);
  const planCatalog = catalog?.account === usingChatGPT ? catalog : null;
  const modelOptions = usingChatGPT ? planCatalog?.options : connection?.models;
  const loadModels = async () => {
    if (!usingChatGPT || (planCatalog && !planCatalog.failed && (planCatalog.expires ?? Infinity) > Date.now())) return;
    const account = usingChatGPT;
    setCatalog({ account });
    try {
      const query = new URLSearchParams({ models: "1", account });
      const res = await fetch(`/api/chatgpt?${query}`, { cache: "no-store", signal: AbortSignal.timeout(12_000) });
      if (!res.ok) throw new Error();
      const value = await res.json();
      if (!Array.isArray(value.models)) throw new Error();
      setCatalog((previous) => previous?.account === account ? { account, options: value.models, expires: Date.now() + 300_000 } : previous);
    } catch {
      setCatalog((previous) => previous?.account === account ? { account, failed: true } : previous);
    }
  };
  const changeModel = (slug: string) => {
    if (!modelKey) return;
    setModelPreferences((previous) => ({ ...previous, [modelKey]: slug }));
    writeLocal(modelKey, slug);
  };
  const [notification, setNotification] = useState("");
  const [activeRun, setActiveRun] = useState<Run | null>(null);
  const [selectedChat, setSelectedChat] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const latest = chats[0];
  const chatId = selectedChat ?? latest?.threadId ?? latest?.id;
  const savedTurns = useLiveQuery(async () => chatId ? { chatId, turns: await repo.chatRuns(chatId) } : undefined, [chatId]);
  const archived = savedTurns?.chatId === chatId ? savedTurns?.turns ?? [] : [];
  const turns = activeRun?.threadId === chatId && activeRun
    ? [...archived.filter((turn) => turn.id !== activeRun.id), activeRun] : archived;
  const controller = useRef<AbortController | null>(null);
  const main = useRef<HTMLElement>(null);
  const shell = useRef<HTMLDivElement>(null);
  const chat = useRef<ChatHandle>(null);
  const mobileTrigger = useRef<HTMLButtonElement>(null);
  const restoreDrawerFocus = useRef(true);
  const paletteInvoker = useRef<HTMLElement | null>(null);
  const utilityInvoker = useRef<HTMLElement | null>(null);
  const previous = useRef(dest);
  useEffect(() => {
    migratePreferences();
    const url = new URL(location.href);
    if (url.searchParams.has("chatgpt")) {
      url.searchParams.delete("chatgpt");
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
      writeLocal(billingPreference, "chatgpt");
    }
  }, []);
  useEffect(() => {
    if (!compact) return;
    shell.current?.removeAttribute("data-sidebar-resizing");
    shell.current?.style.removeProperty("--rail-preview");
  }, [compact]);

  const navigate = useCallback((to: Destination) => {
    const hash = destinationHash(to);
    restoreDrawerFocus.current = location.hash === hash;
    if (location.hash !== hash) window.history.pushState(null, "", `${location.pathname}${location.search}${hash}`);
    setMobile(false);
    setDest(to);
  }, []);
  const refresh = useCallback(async () => {
    const read = async (path: string) => {
      const response = await fetch(path, { cache: "no-store", signal: AbortSignal.timeout(4_000) });
      if (!response.ok) throw new Error();
      return response.json();
    };
    await Promise.all([
      read("/api/agent").then((value) => setConnection({ configured: value.configured === true, model: typeof value.model === "string" ? value.model : null,
        models: Array.isArray(value.models) ? value.models : [] }), () => setConnection(null)),
      read("/api/chatgpt").then((value: PlanConnection) => setPlan(value), () => setPlan(null)),
    ]);
  }, []);
  useEffect(() => {
    const changeRoute = () => { restoreDrawerFocus.current = false; setDest(readDestination(location.hash)); setMobile(false); };
    const changeOnline = () => { setOnline(navigator.onLine); if (navigator.onLine) void refresh(); };
    window.addEventListener("popstate", changeRoute); window.addEventListener("hashchange", changeRoute);
    window.addEventListener("online", changeOnline); window.addEventListener("offline", changeOnline);
    const timer = setTimeout(() => { if (navigator.onLine) void refresh(); }, 0);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("popstate", changeRoute); window.removeEventListener("hashchange", changeRoute);
      window.removeEventListener("online", changeOnline); window.removeEventListener("offline", changeOnline);
    };
  }, [refresh]);
  useEffect(() => {
    const old = previous.current;
    previous.current = dest;
    if (old.kind === dest.kind && (dest.kind !== "page" || (old.kind === "page" && old.id === dest.id))) return;
    window.scrollTo({ top: 0 });
    main.current?.focus({ preventScroll: true });
  }, [dest]);
  useEffect(() => {
    if (!notification) return;
    const timer = setTimeout(() => setNotification(""), 6_000);
    return () => clearTimeout(timer);
  }, [notification]);
  const updateTheme = (to: Theme) => {
    setTheme(to); document.documentElement.dataset.theme = to;
    try { localStorage.setItem(preferenceKeys.theme[0], to); } catch { /* Available this session. */ }
  };
  const updateEnabled = (to: boolean) => {
    if (mode === "api") { setApiConsent(to); writeLocal(chatConsentKey, String(to)); }
    else {
      const next = to ? planAccount ?? "" : "";
      setPlanConsent(next); writeLocal(planConsentPreference, next);
    }
  };
  const leaveDrawer = useCallback(() => {
    restoreDrawerFocus.current = false;
    setMobile(false);
  }, []);
  const showPalette = useCallback((state: PaletteState) => {
    const focused = document.activeElement;
    if (!paletteOpen) paletteInvoker.current = drawerOpen ? mobileTrigger.current : focused instanceof HTMLElement ? focused : null;
    if (drawerOpen) leaveDrawer();
    setPalette(state);
  }, [drawerOpen, leaveDrawer, paletteOpen]);
  const onAsk = useCallback((prompt?: string, selection?: string, extra?: Context) => {
    showPalette({ mode: "ask", prompt, context: { pageId: dest.kind === "page" ? dest.id : undefined, selectedText: selection?.slice(0, 4_000), ...extra } });
  }, [dest, showPalette]);
  const onSearch = useCallback(() => showPalette({ mode: "search" }), [showPalette]);
  useEffect(() => {
    const shortcuts = (e: KeyboardEvent) => {
      if (e.isComposing || !(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || settings || help || newPage || pageDialog || task) return;
      const key = e.key.toLowerCase();
      if (key === "k") { e.preventDefault(); onSearch(); }
      if (key === "j") { e.preventDefault(); onAsk(); }
    };
    window.addEventListener("keydown", shortcuts);
    return () => window.removeEventListener("keydown", shortcuts);
  }, [onAsk, onSearch, settings, help, newPage, pageDialog, task]);

  const openTask = (id: string) => {
    const record = tasks.find((t) => t.id === id);
    if (record) setTask({ id, databaseId: record.databaseId });
    else void repo.task(id).then((t) => t ? setTask({ id, databaseId: t.databaseId }) : setNotification("This task no longer exists.")).catch((e) => setNotification(message(e)));
  };
  const openSource = (source: Source) => {
    setPalette(null);
    if (source.kind === "page") navigate({ kind: "page", id: source.id, blockId: source.blockId });
    else openTask(source.id);
  };
  const startRun = (prompt: string, context: Context, threadId = uid()) => {
    if (controller.current || !prompt.trim()) return false;
    const abort = new AbortController();
    controller.current = abort; setRunning(true); setPalette(null);
    setSelectedChat(threadId);
    navigate({ kind: "canvas" });
    const provider = !online ? undefined : usingChatGPT ? chatGPTProvider(usingChatGPT, selectedModel) : usingApi ? apiProvider(selectedModel) : undefined;
    void runAgent({ repo, prompt, context, threadId, signal: abort.signal, provider,
      onUpdate: (run) => {
        if (controller.current !== abort) return;
        setActiveRun(run.status === "running" ? run : null);
      },
    }).catch((err) => { if (controller.current === abort) setNotification(message(err)); }).finally(() => {
      if (controller.current !== abort) return;
      controller.current = null; setRunning(false); setActiveRun(null);
    });
    return true;
  };
  const newAtRoot = () => { leaveDrawer(); setNewPage({ parentId: null, kind: "page" }); };
  const openUtility = (kind: "settings" | "help") => {
    const focused = document.activeElement;
    utilityInvoker.current = drawerOpen ? mobileTrigger.current : focused instanceof HTMLElement ? focused : null;
    leaveDrawer();
    if (kind === "settings") setSettings(true); else setHelp(true);
  };
  const closeUtility = (kind: "settings" | "help") => {
    if (kind === "settings") setSettings(false); else setHelp(false);
    const invoker = utilityInvoker.current;
    requestAnimationFrame(() => {
      const focused = document.activeElement;
      if (invoker?.isConnected && (!focused || focused === document.body || focused.closest("[role=dialog]"))) {
        invoker.focus({ preventScroll: true });
      }
    });
  };
  const changeSidebar = (collapsed: boolean) => {
    setSidebarCollapsed(collapsed);
    try { localStorage.setItem(sidebarPreference, String(collapsed)); } catch { /* Available this session. */ }
  };
  const selectChat = (id = uid()) => {
    setSelectedChat(id);
    chat.current?.prepareConversation();
  };
  const previewSidebarWidth = (width: number | null) => {
    const node = shell.current;
    if (!node) return;
    node.toggleAttribute("data-sidebar-resizing", width !== null);
    if (width === null) node.style.removeProperty("--rail-preview");
    else node.style.setProperty("--rail-preview", `${width}px`);
  };
  const commitSidebarWidth = (width: number) => {
    setSidebarWidth(width);
    try { localStorage.setItem(sidebarWidthPreference, String(width)); } catch { /* Available this session. */ }
  };
  const onPageAction: OnPageAction = (page, action) => {
    const to = { kind: "page" as const, id: page.id };
    switch (action) {
      case "open": navigate(to); return;
      case "copy-link":
        if (!navigator.clipboard) { setNotification("Clipboard access isn’t available in this browser."); return; }
        void navigator.clipboard.writeText(new URL(destinationHash(to), location.href).href)
          .then(() => setNotification("Link copied."), () => setNotification("Couldn’t copy the link."));
        return;
      case "favorite":
        void repo.patchPage(page.id, { favorite: !page.favorite }, page.revision)
          .then(() => setNotification(page.favorite ? "Removed from favorites." : "Added to favorites."), (err) => setNotification(message(err)));
        return;
      case "subpage": leaveDrawer(); setNewPage({ parentId: page.id, kind: "page" }); return;
      default: leaveDrawer(); setPageDialog({ page, kind: action });
    }
  };
  return <div ref={shell} className="workspace-shell" data-theme={theme} data-sidebar-collapsed={sidebarCollapsed || undefined} style={{ "--rail": `${sidebarWidth}px` } as CSSProperties}>
    <a href="#workspace-main" onClick={(e) => { e.preventDefault(); main.current?.focus(); }} className="skip-link">Skip to workspace</a>
    <Sidebar pages={pages} dest={dest} navigate={navigate} compact={compact} open={drawerOpen} onOpenChange={setMobile}
      collapsed={sidebarCollapsed} toggleCollapse={() => changeSidebar(!sidebarCollapsed)}
      width={sidebarWidth} previewWidth={previewSidebarWidth} commitWidth={commitSidebarWidth}
      onRestoreFocus={() => { if (restoreDrawerFocus.current) mobileTrigger.current?.focus(); }} onSearch={onSearch}
      onBrowsePages={() => showPalette({ mode: "search", scope: "pages" })} onNewPage={newAtRoot} onPageAction={onPageAction}
      onMove={(id, parentId) => { void repo.movePage(id, parentId).then(() => setNotification("Page moved."), (err) => setNotification(message(err))); }}
      onSettings={() => openUtility("settings")} onHelp={() => openUtility("help")} />
    <div className="workspace-body">
      <Topbar dest={dest} pages={pages} navigate={navigate} menuRef={mobileTrigger} menuOpen={drawerOpen}
        actions={dest.kind === "canvas" ? <ChatActions chatId={chatId} history={chats} running={running} onSelect={selectChat} onNew={() => selectChat()} /> : undefined}
        onMenu={() => { restoreDrawerFocus.current = true; setMobile(true); }} onSearch={onSearch} />
      <main id="workspace-main" tabIndex={-1} ref={main}>
        <RadialPattern />
        <div className="workspace-view" key={dest.kind === "page" ? `page:${dest.id}` : dest.kind}>
        {dest.kind === "home" && <Overview pages={pages} navigate={navigate} onNew={newAtRoot} onPageAction={onPageAction} />}
        {dest.kind === "page" && <PageView key={dest.id} id={dest.id} blockId={dest.blockId} pages={pages} navigate={navigate} onPageAction={onPageAction} onAsk={onAsk} onTask={openTask} notify={setNotification} />}
        {dest.kind === "tasks" && <TaskView view={dest.view ?? "table"} onViewChange={(view) => navigate({ kind: "tasks", view })} onEdit={setTask} notify={setNotification} />}
        {dest.kind === "canvas" && <AgentChat ref={chat} chatId={chatId} turns={turns} running={running} usingPlan={Boolean(online && usingChatGPT)} loading={Boolean(chatId && savedTurns?.chatId !== chatId && !activeRun)}
          picker={{ enabled: Boolean(modelKey), selected: selectedModel, options: modelOptions,
            label: selectedModel ? modelOptions?.find(({ slug }) => slug === selectedModel)?.label ?? modelLabel(selectedModel)
              : usingApi && connection.model ? modelLabel(connection.model) : "Auto · Budget",
            failed: Boolean(planCatalog?.failed), load: loadModels, choose: changeModel }}
          onSend={(prompt, context = {}) => startRun(prompt, context, chatId)}
          onStop={() => controller.current?.abort()} onSource={openSource} notify={setNotification} />}
        </div>
      </main>
    </div>
    {palette && <Palette key={`${palette.mode}:${palette.scope ?? ""}:${palette.prompt ?? ""}`} state={palette} pages={pages} search={search}
      onClose={() => {
        setPalette(null);
        const invoker = paletteInvoker.current;
        requestAnimationFrame(() => { if (invoker?.isConnected) invoker.focus({ preventScroll: true }); });
      }}
      onResult={openSource} onNavigate={(to) => { setPalette(null); navigate(to); if (destinationHash(to) === destinationHash(dest)) main.current?.focus({ preventScroll: true }); }}
      run={startRun} running={running} modelEnabled={Boolean(online && (usingChatGPT || usingApi))} />}
    {newPage && <NewPage {...newPage} pages={pages} close={() => setNewPage(null)} onCreated={(p) => { setNewPage(null); navigate({ kind: "page", id: p.id }); setNotification(`${p.kind === "page" ? "Page" : "Folder"} created.`); }} />}
    {pageDialog && <PageActionDialog key={`${pageDialog.page.id}:${pageDialog.kind}`} {...pageDialog} pages={pages} close={() => setPageDialog(null)}
      deleted={() => {
        const { page } = pageDialog;
        if (dest.kind === "page" && dest.id === page.id) navigate(page.parentId ? { kind: "page", id: page.parentId } : home);
        setNotification(page.kind === "folder" ? "Folder deleted." : "Page deleted.");
      }} />}
    {task && <TaskDialog selection={task} pages={pages} close={() => setTask(null)} ask={(record) => { setTask(null); onAsk("Show this task", undefined, { taskId: record.id, databaseId: record.databaseId, pageId: record.pageId ?? undefined }); }} />}
    {settings && <Settings close={() => { setAccountNotice(null); closeUtility("settings"); }} theme={theme} setTheme={updateTheme} notify={setNotification}
      provider={{ mode, setMode: (next) => { setMode(next); writeLocal(billingPreference, next); }, api: connection, plan,
        enabled: mode === "api" ? apiConsent : Boolean(planAccount && planConsent === planAccount), setEnabled: updateEnabled, refresh,
        onDisconnect: () => { controller.current?.abort(); setPlanConsent(""); writeLocal(planConsentPreference, ""); },
        notice: accountNotice, clearNotice: () => setAccountNotice(null) }}
      onDataReplaced={(notice) => { controller.current?.abort(); controller.current = null; setRunning(false); setActiveRun(null); setSelectedChat(null); setSettings(false); navigate(home); setNotification(notice); }} />}
    {help && <Help close={() => closeUtility("help")} />}
    {notification && <div className="toast panel" role="status"><span className="toast-pin" /><span>{notification}</span><button className="icon-button" onClick={() => setNotification("")} aria-label="Dismiss message"><X size={16} /></button></div>}
  </div>;
}
