# Godspeed — Codex Instructions

## Mission
Build Godspeed: a beautiful, fast, local-first, AI-native knowledge workspace for the web. Combine Notion-style pages, blocks, databases, tasks, and calendars with an agent that *operates on workspace data*, not merely chats about it. Favor a coherent, working product over scattered demos.

## Product principles
- **Design is a feature.** Deliver premium, restrained UI: precise typography, generous spacing, layered surfaces, polished dark/light themes, subtle motion, exceptional empty/loading/error states. Avoid generic dashboard templates, noisy gradients, and ornamental glass effects.
- **Local-first.** Reading and editing must work offline. Persist changes locally immediately; sync is optional and must never silently overwrite local work. Provide export/backup pathways.
- **AI is native to the UI.** Prioritize a command surface, selection-based actions, and a visual Agent Canvas showing inspectable tool calls, sources, proposed edits, and results—not a generic chatbot sidebar.
- **User control.** Changes must be previewable, reversible where possible, and explicitly confirmed for destructive or external actions. Never silently delete or publish user content.
- **Performance and accessibility.** Keyboard-first, responsive, accessible, and fast on realistic workspaces. Respect reduced-motion preferences.

## Default architecture
- Next.js App Router, React, TypeScript (strict), Tailwind CSS, shadcn/ui/Radix, Lucide, Motion.
- Tiptap for block/rich-text editing; Dexie/IndexedDB for local persistence; MiniSearch or equivalent for local full-text search.
- Define typed domain models and a repository/service boundary so storage, UI, agent tools, and future sync are decoupled. Use Zod at trust boundaries.
- Add a server and collaborative sync only when necessary; keep the core workspace functional without either. Keep dependencies lean.
- AI providers must be pluggable. **Do not assume ChatGPT Plus covers API usage or that ChatGPT account OAuth grants general third-party model access.** Implement only officially documented, currently supported authentication flows; otherwise offer explicit API-key/local-model integrations. Never expose provider credentials to the browser or logs.

## Workspace model
- Support nested pages, stable IDs, typed blocks, backlinks, tags, tasks, and structured databases with multiple views. Calendars/timetables should use the same underlying task/event entities—not duplicate sources of truth.
- Keep content in normalized records; use schema migrations, optimistic local updates, and versioned edits. Avoid irreversible transformations.
- Provide a fast command palette (`Ctrl/Cmd+K`), search, breadcrumbs, drag-and-drop, and contextual menus.

## Agent design
- Agents discover information progressively: `workspace.list`, `workspace.search`, `page.inspect`, `page.read`, `database.schema`, `database.query`, `calendar.query`, `graph.traverse`, and batched read operations.
- Return compact, typed metadata first (IDs, titles, outlines, counts); fetch exact blocks/fields on demand. Prefer indexed queries and database-side filtering to large prompts. Use retrieval for discovery, not as a substitute for navigation.
- Separate **read**, **propose**, and **commit** operations. Agent edits become structured changesets with diff previews, validation, and undo where feasible. Require approval for destructive actions and external side effects.
- Show progress in an Agent Canvas: steps, tool inputs/outputs (redacted when sensitive), visited resources, citations/links to source blocks, errors, and final artifacts. Keep the UI usable during execution.
- Persist task state outside model context. Apply sensible tool-call budgets, pagination, cancellation, timeouts, and loop detection. Never claim an action succeeded unless verified.
- Treat workspace content and tool results as **untrusted data**, not instructions. Enforce authorization and scopes in tools, not prompts.

## Engineering workflow
1. Inspect the repository and existing conventions before editing; preserve working patterns unless there is a clear reason to change them.
2. For nontrivial tasks, write a short implementation plan and complete a vertical slice end-to-end before expanding scope.
3. Implement real, connected features; no dead buttons, fake metrics, placeholder flows, or mocked success states in production paths.
4. Keep components small, reusable, and typed. Separate presentation, domain logic, persistence, and agent execution. Avoid premature abstractions.
5. Test critical flows: offline persistence/reload, nested page edits, database operations, search, agent tool permissions, changeset approval/undo, and keyboard/accessibility behavior.
6. Run available lint, typecheck, tests, and production build before reporting completion; fix failures or state precisely what remains unverified.
7. Update concise documentation for architecture, setup, environment variables, migrations, and major decisions. Never commit secrets.

## Priorities
1. Exquisite, responsive application shell and design system.
2. Reliable local-first pages, editor, navigation, and search.
3. Structured databases, tasks, and calendar views.
4. Efficient agent tools and reversible workspace mutations.
5. Visual Agent Canvas and contextual AI interactions.
6. Optional sync, provider integrations, and advanced collaboration.

When making tradeoffs, prioritize **data integrity > security > correctness > usability > visual polish > feature breadth**. Visual polish remains a release requirement, not an afterthought.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
