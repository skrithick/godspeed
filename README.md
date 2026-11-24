# Godspeed

Godspeed is a local-first workspace for notes, projects, and tasks. Pages, databases, and Agent Chat history live in the current browser profile. No account or AI provider is required.

## Run it

Use Node.js 22+ and npm.

```sh
npm ci
npm run dev
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). New workspaces start with no pages, folders, or tasks. Existing workspaces are left untouched. Press **Ctrl/Cmd+K** to search or **Ctrl/Cmd+J** to ask Godspeed. Type `/` on an empty line to insert a block.

To use the offline shell, start Godspeed in production mode and open it once while online:

```sh
npm run build
npm start
```

A service worker caches the static shell on loopback or HTTPS. Editing, search, task views, and supported local commands continue to work after a warm offline reload. AI network requests are never cached. Use a different port for development if a production service worker is already installed on the default origin.

## Workspace and data

The overview puts recently edited pages first. Select **Pages** in the sidebar to browse the folder and page index. Workspace search can jump straight to the Calendar view of **My tasks** or to **Agent Chat**. On narrow screens, search is available in the top bar, and **Escape** closes the navigation drawer and returns focus to its button.

- Pages and folders can be nested, favorited, tagged, and linked. Pick an icon in the creation dialog or keep the default for the item type. Drag a page onto another page or onto the sidebar’s **Pages** heading to move it to the root. The page menu offers a keyboard-accessible **Move to** alternative. A folder or page with children cannot be deleted until its children are moved.
- To clear an existing workspace in this browser, open **Settings → Workspace data → Reset workspace**, optionally export a backup, then type `RESET` and choose **Clear all data**. Appearance and AI preferences are kept.
- On desktop, use the button in the sidebar header to switch between the full sidebar and an icon rail. Drag the expanded sidebar’s right edge, or focus the resize handle and press the arrow keys, to change its width. Both preferences persist in this browser.
- **My tasks** brings Table, Board, and Calendar together with shared filters. Legacy `#calendar` links still open the Calendar view (`#tasks/calendar`). Each database supports text, number, date, and checkbox properties, plus built-in statuses, priorities, dates, tags, and page relations.
- Right-click a page, folder, or task to open its options, or focus it and press **Shift+F10**. Deleting still requires confirmation.
- **Settings → Export backup** creates a versioned Godspeed JSON file. **Restore backup** also accepts legacy Atlas backups, validates the file, and asks for explicit confirmation before atomically replacing the local workspace. Save your current backup first. Run history and AI settings are not exported; restoring clears run history.
- Browser data is origin-specific and can be removed by clearing site data, private browsing, or storage eviction. Export backups of important work. The editor reports save failures and can download an unsaved draft; tab-session draft recovery is separate from normal IndexedDB saves.

### Upgrading from Atlas

Save your changes and reload any tabs still running Atlas before editing in Godspeed. At the same address and in the same browser profile, Godspeed copies the existing IndexedDB workspace and run history on first launch, leaving the original database intact. It also carries over preferences and recoverable drafts from the current tab. If you change the address, port, or browser profile, use a backup to transfer your workspace instead.

## AI

Ask **What’s due today?** or **What do we have on launch?** in Agent Chat to query local workspace data. Chats persist locally, and each response can disclose its **Workspace activity** and sources. The existing `#canvas` link opens the chat; past runs remain available as individual conversations. Changes remain drafts until approved, and undo refuses to overwrite edits made after approval. Godspeed does not offer the model a direct write, delete, browser, or external-action tool.

### Use your ChatGPT plan (no API key)

1. Open the local Godspeed preview at `http://127.0.0.1:3000` (not `localhost`).
2. Open **Settings → AI provider → ChatGPT plan** and select **Continue with ChatGPT**.
3. Sign in with your eligible Plus or Pro account and authorize plan usage on OpenAI’s page. Back in Godspeed, opt in to sending relevant workspace context to OpenAI.

Godspeed uses OpenAI’s documented [Sign in with ChatGPT flow for local clients](https://developers.openai.com/siwc/token-sharing-open-source) and the public Responses API. It does not read your ChatGPT conversations or reuse ChatGPT browser cookies. Credentials stay in the local server’s per-user `Godspeed/chatgpt` configuration directory (under `%LOCALAPPDATA%` on Windows). The browser holds only an opaque, HttpOnly session handle. **Disconnect** clears local credentials and attempts to revoke the renewable session. See [ChatGPT Usage](https://chatgpt.com/settings/usage) for allowance and credits. Plan usage is local-only here, and Godspeed never falls back to API-key billing if a plan request fails.

Agent Chat prefers **GPT‑6 Luna**, then **GPT‑5.6 Luna**, in the signed-in account’s available model catalog. It uses no extra reasoning effort, displays the model on generated replies, and stops rather than automatically choosing a non-budget model. This order follows [OpenAI’s standard API text rates](https://developers.openai.com/api/docs/pricing), not a guarantee of how Plus measures plan allowance.

- Agent Chat searches automatically when the model needs current information or external verification, and shows citations when returned. Availability depends on model and account/workspace policy; Godspeed does not switch billing modes or models for search. Search can count against your allowance or add API charges. Use the composer’s model picker to override the default for your account.
- Approving an AI page draft converts Markdown to editable headings, lists, checklists, tables, and other blocks. For an older page still showing raw Markdown, open it and choose **Format Markdown** when offered. This edits the page locally and can be undone in the editor.

### Optional: use a separately billed API key

1. Copy `.env.example` to `.env.local`.
2. Set `OPENAI_API_KEY` on the server. GPT‑6 Luna is the default. Optionally set `GODSPEED_OPENAI_MODEL` to override it with another model that supports streaming function calls.
3. Restart Godspeed. In **Settings → AI provider**, select **OpenAI API key**, check configuration, and opt into sending model requests.

The API-key adapter uses Responses for models with web search and Chat Completions for other configured models. The API key is never sent to the browser. With either provider and with your opt-in, Godspeed sends the prompt, bounded selection and tool results, and at most one shortened previous exchange. Automated search uses low search context. No separate model call is spent classifying searches or compressing prompts. Other chats and workspace snapshots are not sent. `store: false` disables API-side storage for retrieval, but is not a promise about OpenAI’s data retention.

The default scripts bind to loopback. For remote deployment with the **API-key provider** enabled, set `GODSPEED_APP_ORIGIN` and a randomly generated `GODSPEED_AI_INGRESS_SECRET` of at least 32 characters. Put Godspeed behind an authenticating, rate-limiting HTTPS reverse proxy that strips caller-supplied `X-Godspeed-Ingress`, injects the secret only for authenticated requests, and preserves the public `Host`. Do not expose the application server directly. Existing `ATLAS_*` deployment settings remain a fallback; switch the origin, ingress secret, and proxy header together.

## Architecture and checks

- `src/workspace`: Zod models, versioned Dexie schema, normalized block and task records, search index, transactional changesets and undo. The Dexie version and the interchange format version are independent; add migrations rather than resetting storage.
- `src/components`: responsive Next.js application shell, Radix menus and dialogs, Tiptap editor, database views, command surface, and Agent Chat. CSS tokens cover both themes; fonts are bundled locally.
- `src/agent`: bounded, validated tool registry, provider interface, streaming parser, cancellation, and persisted run state. Model calls execute reads locally and can only draft writes. Approval and undo are separate repository transactions.
- `src/app/api/agent`: optional server-only OpenAI bridge. Incremental UI output comes from streaming text; task and proposal state are persisted after each step.

```sh
npm run lint
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

Godspeed does not yet include cross-device sync or collaboration, Notion/Markdown import, a local-model adapter, or arbitrary database schemas independent of the task record. Agent runs interrupted by reload can be inspected and rerun, not resumed mid-stream.

For the rationale and accessibility checks behind the interface, see [UI design notes](docs/ui-design.md).
