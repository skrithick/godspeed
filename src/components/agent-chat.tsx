"use client";

import { ArrowDown, ArrowUp, ArrowUpRight, Check, ChevronDown, FileText, Globe, ListTodo, Square, Terminal, Undo2 } from "lucide-react";
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import type { Context, Run, Source, Step } from "@/agent/types";
import type { ModelOption } from "@/agent/model-policy";
import { repo } from "@/workspace/repository";
import { publicWebLink } from "@/workspace/web-link";
import { Menu, MenuContent, MenuItem, MenuTrigger, Modal } from "./ui";
import { chatGPTUsage } from "./provider-settings";

const suggestions = ["What’s due this week?", "What do we have on launch?", "List my pages"];

export function ChatActions({ chatId, history, running, onSelect, onNew }: {
  chatId?: string; history: Run[]; running: boolean; onSelect: (id: string) => void; onNew: () => void;
}) {
  return <div className="chat-header-actions">
    {history.length > 0 && <Menu>
      <MenuTrigger asChild><button className="button subtle chat-header-button" aria-label="Recent chats" disabled={running}>History</button></MenuTrigger>
      <MenuContent className="chat-history-menu">{history.map((turn) => {
        const id = turn.threadId ?? turn.id;
        return <MenuItem key={id} onSelect={() => onSelect(id)}>
          <span className="chat-history-title" title={turn.prompt}>{turn.prompt}</span>{chatId === id && <Check size={14} aria-label="Current chat" />}
        </MenuItem>;
      })}</MenuContent>
    </Menu>}
    <button className="button subtle chat-header-button chat-new" onClick={onNew} disabled={running}>New chat</button>
  </div>;
}

export type ChatHandle = { prepareConversation: () => void };

export function AgentChat({ ref, chatId, turns, running, loading, usingPlan, picker, onSend, onStop, onSource, notify }: {
  ref?: Ref<ChatHandle>; chatId?: string; turns: Run[]; running: boolean; loading: boolean; usingPlan: boolean;
  picker: { enabled: boolean; selected?: string; label: string; options?: ModelOption[]; failed: boolean; load: () => void; choose: (slug: string) => void };
  onSend: (prompt: string, context?: Context) => boolean; onStop: () => void;
  onSource: (source: Source) => void; notify: (notice: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const [inspect, setInspect] = useState<Step | null>(null);
  const [canJump, setCanJump] = useState(false);
  const transcript = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const follow = useRef(true);
  useImperativeHandle(ref, () => ({
    prepareConversation() {
      setDraft(""); setInspect(null); setCanJump(false); follow.current = true;
      requestAnimationFrame(() => composer.current?.focus());
    },
  }), []);
  const last = turns.at(-1);
  const tail = last ? `${last.id}:${last.status}:${last.answer.length}:${last.steps.length}` : "";
  const latestChat = useRef(chatId);
  const scrollToEnd = () => {
    const node = transcript.current;
    if (node) node.scrollTop = node.scrollHeight;
  };
  useEffect(() => {
    if (latestChat.current !== chatId) {
      latestChat.current = chatId;
      follow.current = true;
    }
    if (follow.current) scrollToEnd();
  }, [chatId, tail]);
  const send = (prompt = draft, context?: Context) => {
    const message = prompt.trim();
    if (!message || running || loading || !onSend(message, context)) return;
    follow.current = true;
    setCanJump(false);
    setDraft("");
  };
  return <div className="chat-view">
    <div className="chat-scroll" role="region" aria-label="Chat transcript" tabIndex={0} ref={transcript} onScroll={(event) => {
      const { scrollHeight, scrollTop, clientHeight } = event.currentTarget;
      follow.current = scrollHeight - scrollTop - clientHeight < 72;
      setCanJump(!follow.current);
    }}>
      <div className={`chat-width chat-transcript ${!turns.length ? "chat-transcript-empty" : ""}`}>
        {!turns.length ? loading || running ? <div className="chat-progress" role="status"><span className="spinner" /> {loading ? "Opening chat…" : "Getting started…"}</div> :
          <section className="chat-welcome" aria-labelledby="chat-welcome-title">
            <h2 id="chat-welcome-title">What’s on your mind?</h2>
            <p>Ask about your notes, find what’s due, or draft a change to your workspace.</p>
            <div className="chat-suggestions">{suggestions.map((prompt) => <button key={prompt} onClick={() => send(prompt)}>{prompt}</button>)}</div>
          </section> :
          <ol className="chat-turns" aria-label="Conversation">
            {turns.map((turn) => <ChatTurn key={turn.id} turn={turn} active={running && last?.id === turn.id}
              onInspect={setInspect} onSource={onSource} onRetry={!running ? () => send(turn.prompt, turn.context) : undefined} notify={notify} />)}
          </ol>}
      </div>
    </div>
    <div className="chat-footer">
      <div className="chat-width chat-footer-inner">
        {canJump && <button className="button chat-jump" onClick={() => { follow.current = true; setCanJump(false); scrollToEnd(); }}><ArrowDown size={14} /> Latest message</button>}
        <form className="chat-composer field-surface" onSubmit={(event) => { event.preventDefault(); send(); }}>
          <textarea ref={composer} aria-label="Message Godspeed" placeholder="Ask about your workspace or the web…" value={draft}
            maxLength={2_000} rows={2} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => {
              if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
              event.preventDefault(); send();
            }} />
          <Menu onOpenChange={(open) => { if (open) picker.load(); }}>
            <MenuTrigger asChild><button type="button" className="button subtle chat-model-picker" aria-label={`Select model: ${picker.label}`}
              disabled={!picker.enabled || running || loading} title={picker.enabled ? "Choose the model for your next message" : "Enable an AI provider in Settings"}>
              <span>{picker.label}</span><ChevronDown size={14} />
            </button></MenuTrigger>
            <MenuContent side="top" align="end" className="chat-model-menu">
              <MenuItem onSelect={() => picker.choose("")}>{usingPlan ? "Auto · Budget" : "Server default"}{!picker.selected && <Check size={14} aria-label="Selected" />}</MenuItem>
              {picker.options?.map(({ slug, label }) => <MenuItem key={slug} onSelect={() => picker.choose(slug)}>
                <span>{label}</span>{picker.selected === slug && <Check size={14} aria-label="Selected" />}
              </MenuItem>)}
              {!picker.options && <MenuItem disabled onSelect={() => {}}>{picker.failed ? "Couldn’t load models. Reopen to retry." : "Loading models…"}</MenuItem>}
            </MenuContent>
          </Menu>
          {running ? <button type="button" className="chat-send chat-stop" aria-label="Stop response" title="Stop response" onClick={onStop}><Square size={15} /></button>
            : <button type="submit" className="chat-send" aria-label="Send message" title="Send message" disabled={!draft.trim() || loading}><ArrowUp size={19} /></button>}
        </form>
        <p className="chat-composer-note">{usingPlan ? <>Using ChatGPT plan · <a href={chatGPTUsage} target="_blank" rel="noreferrer">Manage usage</a></> : "Changes are only applied with your approval."}</p>
      </div>
    </div>
    {inspect && <Modal open onClose={() => setInspect(null)} title={inspect.summary} description={inspect.tool.replaceAll("_", ".")} className="inspect-dialog">
      <div className="inspect-body"><h3>Input</h3><pre>{JSON.stringify(inspect.input, null, 2)}</pre><h3>Output</h3><pre>{JSON.stringify(inspect.output, null, 2)}</pre>
        {inspect.sources.length > 0 && <><h3>Sources</h3><SourceList sources={inspect.sources} onSource={(source) => { setInspect(null); onSource(source); }} /></>}
      </div>
    </Modal>}
  </div>;
}

const sourceKey = (source: Source) => `${source.kind}:${source.id}:${source.blockId ?? ""}`;
function SourceList({ sources, onSource }: { sources: Source[]; onSource: (source: Source) => void }) {
  return <div className="source-list">{sources.map((source) => <button key={sourceKey(source)} className="source-pill" onClick={() => onSource(source)}>
    {source.kind === "page" ? <FileText size={14} /> : <ListTodo size={14} />}
    <span>{source.title}</span>{source.blockId && <small>Block</small>}<ArrowUpRight size={12} />
  </button>)}</div>;
}

function ChatTurn({ turn, active, onInspect, onSource, onRetry, notify }: {
  turn: Run; active: boolean; onInspect: (step: Step) => void; onSource: (source: Source) => void; onRetry?: () => void; notify: (notice: string) => void;
}) {
  const [pending, setPending] = useState<string | null>(null);
  const [confirmUndo, setConfirmUndo] = useState<string | null>(null);
  const sources = [...new Map(turn.steps.flatMap((step) => step.sources).map((source) => [sourceKey(source), source])).values()];
  const webSources = (turn.webCitations ?? []).flatMap(({ url, title }) => {
    const href = publicWebLink(url);
    return href ? [{ href, title }] : [];
  });
  const interrupted = turn.status === "running" && !active;
  const problem = interrupted || turn.status === "error" || turn.status === "cancelled";
  const apply = async (id: string, undo: boolean) => {
    if (pending) return;
    setPending(id);
    try {
      if (undo) { await repo.undo(turn.id, id); setConfirmUndo(null); notify("Change undone."); }
      else { await repo.commit(turn.id, id, true); notify("Change applied to your workspace."); }
    } catch (error) { notify(error instanceof Error ? error.message : "Couldn’t save this change."); }
    finally { setPending(null); }
  };
  return <li className="chat-turn">
    <div className="chat-user"><span className="sr-only">You: </span><p>{turn.prompt}</p></div>
    <article className="chat-reply" aria-label="Assistant response">
      {turn.model && <small className="chat-model">{turn.model}</small>}
      <div className="chat-reply-content">
        {interrupted ? <p className="chat-answer">This response was interrupted. No changes were applied.</p>
          : turn.answer && <p className="chat-answer">{turn.answer}</p>}
        {active && turn.status === "running" && <p className="chat-progress" role="status"><span className="spinner" />{turn.steps.length ? "Working in your workspace…" : turn.research ? "Researching the web…" : "Thinking…"}</p>}
        {turn.steps.length > 0 && <details className="chat-activity">
          <summary><Terminal size={14} aria-hidden="true" /> Workspace activity <span>{turn.steps.length}</span><ChevronDown size={14} aria-hidden="true" /></summary>
          <div>{turn.steps.map((step) => <button key={step.id} className="chat-tool" onClick={() => onInspect(step)}>
            <span><strong>{step.summary}</strong><small>{step.tool.replaceAll("_", ".")}</small></span><ArrowUpRight size={14} aria-hidden="true" />
          </button>)}</div>
        </details>}
        {sources.length > 0 && <section className="chat-reply-section"><h3>Sources</h3><SourceList sources={sources} onSource={onSource} /></section>}
        {webSources.length > 0 && <section className="chat-reply-section"><h3>Web sources</h3>
          <div className="source-list">{webSources.map(({ href, title }) => <a className="source-pill" href={href} key={href} target="_blank" rel="noreferrer">
            <Globe size={14} /><span>{title}</span><ArrowUpRight size={12} />
          </a>)}</div>
        </section>}
        {turn.research && turn.status === "complete" && !webSources.length && <p className="chat-research-note">No verified web citations were returned for this reply.</p>}
        {turn.proposals.length > 0 && <section className="chat-reply-section">
          <h3>Proposed changes</h3>
          {turn.proposals.map((proposal) => {
            const receipt = turn.receipts.find((item) => item.proposalId === proposal.id);
            const undone = turn.undone.includes(proposal.id);
            return <div className="proposal panel" key={proposal.id}>
              <div className="proposal-head"><strong>{proposal.label}</strong><span className={`chip ${receipt && !undone ? "tone-mint" : "tone-accent"}`}>{undone ? "Undone" : receipt ? "Applied" : turn.status === "complete" ? "Needs approval" : "Not applicable"}</span></div>
              {proposal.before && <pre className="diff before">{proposal.before}</pre>}<pre className="diff after">{proposal.after}</pre>
              <div className="proposal-footer">
                {receipt && !undone && <button className="text-button muted" onClick={() => confirmUndo === proposal.id ? void apply(proposal.id, true) : setConfirmUndo(proposal.id)} disabled={pending !== null}><Undo2 size={15} />{confirmUndo === proposal.id ? "Confirm undo" : "Undo change"}</button>}
                {!receipt && turn.status === "complete" && <button className="button primary" onClick={() => void apply(proposal.id, false)} disabled={pending !== null}><Check size={16} /> Approve & apply</button>}
                {receipt && !undone && <button className="text-button" onClick={() => onSource({ id: receipt.id, kind: receipt.type, title: proposal.label })}>Open result <ArrowUpRight size={14} /></button>}
              </div>
            </div>;
          })}
        </section>}
        {problem && turn.answer.includes("ChatGPT plan usage limit reached")
          ? <a className="text-button chat-retry" href={chatGPTUsage} target="_blank" rel="noreferrer">Manage usage in ChatGPT</a>
          : problem && onRetry && <button className="text-button chat-retry" onClick={onRetry}>Try again</button>}
      </div>
    </article>
  </li>;
}
