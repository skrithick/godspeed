"use client";

import { useState } from "react";
import type { ModelOption } from "@/agent/model-policy";

export type ProviderMode = "chatgpt" | "api";
export type APIConnection = { configured: boolean; model: string | null; models?: ModelOption[] };
export type PlanConnection = { available: boolean; configured: boolean; signedIn: boolean; selected?: string; email?: string; profiles: { id: string; label: string }[] };
export type AccountNotice = "welcome" | "connected" | "permission" | "cancelled" | "failed";
export const chatGPTUsage = "https://chatgpt.com/settings/usage";

const noticeText: Record<AccountNotice, string> = {
  welcome: "Eligible Godspeed requests can now count toward your ChatGPT plan. You can review and manage usage in ChatGPT.",
  connected: "Your ChatGPT account is connected.",
  permission: "You signed in, but you haven’t authorized Godspeed to use your ChatGPT plan.",
  cancelled: "ChatGPT sign-in was cancelled. Your previous connection was not changed.",
  failed: "Godspeed couldn’t complete sign-in. Start again from Settings and keep this browser open during sign-in.",
};

export function ProviderSettings({ mode, setMode, api, plan, enabled, setEnabled, refresh, onDisconnect, notice, clearNotice }: {
  mode: ProviderMode; setMode: (mode: ProviderMode) => void; api: APIConnection | null; plan: PlanConnection | null;
  enabled: boolean; setEnabled: (enabled: boolean) => void; refresh: () => Promise<void>; onDisconnect: () => void;
  notice: AccountNotice | null; clearNotice: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const shownNotice = (notice === "welcome" || notice === "connected") && !plan?.configured ? null : notice;
  const action = async (kind: "connect" | "disconnect", account?: string) => {
    if (busy) return;
    setBusy(true); setError(""); clearNotice();
    try {
      const query = new URLSearchParams({ action: kind });
      if (account) query.set("account", account);
      const response = await fetch(`/api/chatgpt?${query}`, { method: "POST", cache: "no-store", signal: AbortSignal.timeout(15_000) });
      const data = await response.json();
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "ChatGPT account action failed.");
      if (kind === "connect") {
        const url = new URL(data.url);
        if (url.origin !== "https://auth.openai.com" || url.pathname !== "/api/accounts/authorize") throw new Error("Godspeed received an invalid sign-in address.");
        location.assign(url.href);
        return;
      }
      onDisconnect();
      await refresh();
      if (data.revoked !== true) setError("Signed out locally, but remote revocation could not be confirmed. You can disconnect Godspeed in ChatGPT settings.");
    } catch (err) { setError(err instanceof Error ? err.message : "ChatGPT account action failed."); }
    finally { setBusy(false); }
  };
  return <>
    <div className="settings-title"><h3>AI provider</h3><p>Local workspace commands work without a provider.</p></div>
    <div className="provider-picker" role="group" aria-label="AI billing mode">
      <button type="button" className="button" aria-pressed={mode === "chatgpt"} disabled={busy} onClick={() => { setMode("chatgpt"); setError(""); }}>ChatGPT plan</button>
      <button type="button" className="button" aria-pressed={mode === "api"} disabled={busy} onClick={() => { setMode("api"); setError(""); }}>OpenAI API key</button>
    </div>
    {mode === "chatgpt" ? <>
      <div className="provider-card">
        <h4>{shownNotice === "welcome" ? "You’re using your ChatGPT plan" : "Use your ChatGPT plan"}</h4>
        <p>{shownNotice ? noticeText[shownNotice] : "Eligible Plus and Pro accounts can use their plan allowance in Godspeed. No API key is needed."}</p>
        {shownNotice && <button type="button" className="text-button" onClick={clearNotice}>{shownNotice === "welcome" ? "Got it" : "Dismiss"}</button>}
        {plan?.available ? <>
          {plan.signedIn && <p className="provider-account"><strong>Connected as</strong> {plan.email ?? plan.profiles.find((profile) => profile.id === plan.selected)?.label ?? "ChatGPT account"}</p>}
          <div className="settings-actions">
            {plan.configured ? <button type="button" className="button" disabled={busy} onClick={() => void action("disconnect")}>Disconnect</button>
              : <button type="button" className="button primary" disabled={busy} onClick={() => void action("connect", plan.selected)}>Continue with ChatGPT</button>}
            {plan.selected && <button type="button" className="button subtle" disabled={busy} onClick={() => void action("connect")}>Use another account</button>}
          </div>
          {plan.signedIn && !plan.configured && <button type="button" className="text-button muted" disabled={busy} onClick={() => void action("disconnect")}>Disconnect</button>}
          {plan.profiles.filter(({ id }) => id !== plan.selected).map(({ id, label }) =>
            <button type="button" className="text-button provider-account-option" disabled={busy} key={id} onClick={() => void action("connect", id)}>Continue as {label}</button>)}
        </> : <p>{plan ? "Open the local preview at 127.0.0.1 to sign in. Hosted installs need their own approved integration." : "ChatGPT connection status is unavailable."}</p>}
        <a href={chatGPTUsage} target="_blank" rel="noreferrer">Manage usage in ChatGPT</a>
      </div>
    </> : <div className="provider-card">
      <h4>OpenAI API key</h4>
      <p>{api?.configured ? `Configured${api.model ? ` · ${api.model}` : ""}. API usage is billed separately by OpenAI.` :
        <>Set <code>OPENAI_API_KEY</code> on the server, restart Godspeed, then refresh. This option does not use your ChatGPT subscription.</>}</p>
    </div>}
    {(mode === "chatgpt" ? plan?.configured : api?.configured) && <label className="check-label consent">
      <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /> Allow model requests to send my prompt, selection, recent messages in this chat, and relevant workspace results to OpenAI.
    </label>}
    <p className="setting-help">Supported models may search the web automatically. Search can count toward your usage.</p>
    <button type="button" className="text-button muted" disabled={busy} onClick={async () => { setBusy(true); try { await refresh(); } finally { setBusy(false); } }}>Refresh connection</button>
    {error && <p className="form-error" role="alert">{error}</p>}
  </>;
}
