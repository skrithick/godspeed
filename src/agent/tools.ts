import { z } from "zod";
import { actionSchema } from "../workspace/changes";
import { dateSchema, idSchema, nodeText, statuses, today, type Page, type Task } from "../workspace/model";
import type { WorkspaceRepository } from "../workspace/repository";
import { createSearch } from "../workspace/search";
import type { Context, Source } from "./types";

const offset = z.number().int().min(0).max(5_000).default(0);
const status = z.enum(statuses).optional();
const database = idSchema.default("tasks");
const readSchemas = {
  workspace_list: z.object({ parentId: idSchema.nullable().default(null), offset }),
  workspace_search: z.object({ query: z.string().trim().min(1).max(250) }),
  page_inspect: z.object({ pageId: idSchema, offset }),
  page_read: z.object({ pageId: idSchema, blockIds: z.array(idSchema).min(1).max(10) }),
  task_inspect: z.object({ taskId: idSchema }),
  database_schema: z.object({ databaseId: idSchema.optional() }),
  database_query: z.object({ databaseId: database, status, offset }),
  calendar_query: z.object({ databaseId: database, from: dateSchema, to: dateSchema, status, offset }),
  graph_traverse: z.object({ pageId: idSchema, offset }),
};
type ReadName = keyof typeof readSchemas;
const readNames = Object.keys(readSchemas) as ReadName[];
const schemas = {
  ...readSchemas,
  batch_read: z.object({ calls: z.array(z.object({ tool: z.enum(readNames), args: z.record(z.string(), z.unknown()) })).min(1).max(5) }),
  propose_change: z.object({ action: actionSchema }),
};
export type ToolName = keyof typeof schemas;
export const descriptions: Record<ToolName, string> = {
  workspace_list: "List immediate children under a parent (null for root). Returns metadata and pagination only.",
  workspace_search: "Find relevant pages and tasks by title, body or tags. Returns compact hits with IDs.",
  page_inspect: "Get page metadata and a paginated block outline with IDs and short previews.",
  page_read: "Read exact blocks from one page by ID. Inspect the page first. Selected text is also available if provided by the user.",
  task_inspect: "Read one task by ID, including its page relation and custom property values.",
  database_schema: "List available databases, or get built-in fields and custom property definitions for one database.",
  database_query: "Query one database with optional indexed status filtering and pagination.",
  calendar_query: "Query dated tasks in a database between inclusive YYYY-MM-DD dates, with optional status filtering.",
  graph_traverse: "Discover linked pages, backlinks, and related tasks for a page.",
  batch_read: "Execute up to five independent read calls. No nested batching or writes.",
  propose_change: "Draft one user-reviewable change without writing anything. Deletion and external actions are not available.",
};
export const toolDefinitions = (Object.keys(schemas) as ToolName[]).map((name) => ({
  type: "function" as const,
  function: { name, description: descriptions[name], parameters: z.toJSONSchema(schemas[name], { io: "input" }), strict: false },
}));
export function isTool(name: string): name is ToolName { return Object.hasOwn(schemas, name); }

const pageMeta = (p: Page) => ({ id: p.id, title: p.title, kind: p.kind, tags: p.tags });
const taskMeta = (t: Task) => ({ id: t.id, title: t.title, status: t.status, priority: t.priority, due: t.due || null, tags: t.tags, pageId: t.pageId });
const sourcePage = (p: Pick<Page, "id" | "title">, blockId?: string): Source => ({ kind: "page", id: p.id, title: p.title, blockId });
const sourceTask = (t: Pick<Task, "id" | "title">): Source => ({ kind: "task", id: t.id, title: t.title });
const trim = (text: string, n: number) => text.length > n ? `${text.slice(0, n - 1)}…` : text;
type Result = { summary: string; output: unknown; sources: Source[]; proposal?: Awaited<ReturnType<WorkspaceRepository["propose"]>> };

export function createTools(repo: WorkspaceRepository) {
  let index: Promise<ReturnType<typeof createSearch>> | undefined;
  return async function execute(name: ToolName, args: unknown): Promise<Result> {
    switch (name) {
      case "workspace_list": {
        const input = schemas[name].parse(args);
        const children = (await repo.children(input.parentId)).sort((a, b) => a.title.localeCompare(b.title));
        const pages = children.slice(input.offset, input.offset + 20);
        return { summary: "Browse workspace", output: { pages: pages.map(pageMeta), nextOffset: children.length > input.offset + 20 ? input.offset + 20 : null }, sources: pages.map((p) => sourcePage(p)) };
      }
      case "workspace_search": {
        const { query } = schemas[name].parse(args);
        index ??= Promise.all([repo.pages(), repo.allBlocks(), repo.allTasks()]).then(([pages, blocks, tasks]) => createSearch(pages, blocks, tasks));
        const hits = (await index)(query, 8);
        return { summary: `Search for “${query}”`, output: { hits }, sources: hits.map((h) => ({ id: h.id, kind: h.kind, title: h.title })) };
      }
      case "page_inspect": {
        const { pageId, offset } = schemas[name].parse(args);
        const { page, blocks, count } = await repo.blockOutline(pageId, offset, 24);
        if (!page) throw new Error("Page not found.");
        const outline = blocks.map((b) => ({ id: b.id, type: b.node.type, heading: b.node.type === "heading" ? b.node.attrs?.level : undefined, preview: trim(nodeText(b.node), 120) }));
        return { summary: `Inspect ${page.title}`, output: { page: { ...pageMeta(page), parentId: page.parentId, links: page.links, blockCount: count }, outline, nextOffset: count > offset + 24 ? offset + 24 : null }, sources: [sourcePage(page)] };
      }
      case "page_read": {
        const { pageId, blockIds } = schemas[name].parse(args);
        const [page, blocks] = await Promise.all([repo.page(pageId), repo.db.blocks.bulkGet(blockIds.map((id) => [pageId, id]))]);
        if (!page) throw new Error("Page not found.");
        return {
          summary: `Read blocks in ${page.title}`,
          output: { page: pageMeta(page), blocks: blocks.map((b, i) => b ? { id: b.id, text: trim(nodeText(b.node), 1_200), type: b.node.type } : { id: blockIds[i], error: "Block not found on this page." }) },
          sources: blocks.flatMap((b) => b ? [sourcePage(page, b.id)] : []),
        };
      }
      case "task_inspect": {
        const { taskId } = schemas[name].parse(args);
        const task = await repo.task(taskId);
        if (!task) throw new Error("Task not found.");
        const page = task.pageId ? await repo.page(task.pageId) : undefined;
        const props = Object.fromEntries(Object.entries(task.properties).map(([id, value]) => [id, typeof value === "string" ? trim(value, 240) : value]));
        return { summary: `Inspect ${task.title}`, output: { ...taskMeta(task), databaseId: task.databaseId, properties: props }, sources: [sourceTask(task), ...(page ? [sourcePage(page)] : [])] };
      }
      case "database_schema": {
        const { databaseId } = schemas[name].parse(args);
        if (!databaseId) return { summary: "Discover databases", output: { databases: (await repo.databases()).slice(0, 30).map(({ id, name }) => ({ id, name })) }, sources: [] };
        const data = await repo.database(databaseId);
        if (!data) throw new Error("Database not found.");
        return { summary: `Inspect ${data.name} schema`, output: { ...data, fields: { status: statuses, priority: ["Low", "Medium", "High"], title: "text", due: "date", tags: "text[]", pageId: "page relation" } }, sources: [] };
      }
      case "database_query":
      case "calendar_query": {
        const dates = name === "calendar_query" ? schemas.calendar_query.parse(args) : null;
        const input = dates ?? schemas.database_query.parse(args);
        if (dates && dates.from > dates.to) throw new Error("Date range is reversed.");
        const data = await repo.database(input.databaseId);
        if (!data) throw new Error("Database not found.");
        const records = await repo.tasks(data.id, { ...input, limit: 13 });
        const tasks = records.slice(0, 12);
        return { summary: name === "calendar_query" ? `Check dates in ${data.name}` : `Query ${data.name}`, output: { tasks: tasks.map(taskMeta), nextOffset: records.length > 12 ? input.offset + 12 : null }, sources: tasks.map(sourceTask) };
      }
      case "graph_traverse": {
        const { pageId, offset } = schemas[name].parse(args);
        const [page, all, tasks] = await Promise.all([repo.page(pageId), repo.pages(), repo.relatedTasks(pageId)]);
        if (!page) throw new Error("Page not found.");
        const outgoing = all.filter((p) => page.links.includes(p.id));
        const incoming = all.filter((p) => p.links.includes(page.id));
        const bounded = <T>(list: T[]) => list.slice(offset, offset + 10);
        const links = bounded(outgoing), backlinks = bounded(incoming), related = bounded(tasks);
        return { summary: `Trace relationships for ${page.title}`, output: { links: links.map(pageMeta), backlinks: backlinks.map(pageMeta), tasks: related.map(taskMeta), nextOffset: Math.max(outgoing.length, incoming.length, tasks.length) > offset + 10 ? offset + 10 : null }, sources: [...links.map((p) => sourcePage(p)), ...backlinks.map((p) => sourcePage(p)), ...related.map(sourceTask)].slice(0, 20) };
      }
      case "batch_read": {
        const { calls } = schemas[name].parse(args);
        const results = await Promise.all(calls.map(async ({ tool, args }) => {
          try { return { tool, ...await execute(tool, args) }; }
          catch (error) { return { tool, summary: "Read failed", output: { error: error instanceof Error ? error.message : "Read failed." }, sources: [] }; }
        }));
        return { summary: `Read ${calls.length} workspace resources`, output: results.map(({ tool, output }) => ({ tool, output })), sources: results.flatMap((r) => r.sources).slice(0, 20) };
      }
      case "propose_change": {
        const { action } = schemas[name].parse(args);
        const proposal = await repo.propose(action);
        return { summary: proposal.label, output: { state: "awaiting_user_approval", proposalId: proposal.id, label: proposal.label }, sources: [], proposal };
      }
    }
  };
}

export function localRequest(prompt: string, context: Context, now = new Date()): { tool: ToolName; args: unknown } | null {
  const value = prompt.trim().replace(/[?]$/, "");
  if (/\b(?:search (?:the )?(?:web|internet)|(?:online|web) (?:search|research)|(?:find|look up|search for).*(?:\bonline\b|\bon the (?:web|internet)\b)|https?:\/\/)/i.test(value)) return null;
  let match: RegExpMatchArray | null;
  if (/^(list|browse|show) (my |the )?(workspace|pages)$/i.test(value)) return { tool: "workspace_list", args: {} };
  if ((match = value.match(/^(find|search(?: for)?)\s+(.+)$/i))) return { tool: "workspace_search", args: { query: match[2].slice(0, 250) } };
  const { databaseId } = context;
  const date = value.match(/^(?:what(?:['’]s| is) due|(?:which|what) tasks are due|do i have anything due) (today|tomorrow|this week)$/i)?.[1].toLowerCase();
  if (date) {
    const offset = date === "tomorrow" ? 1 : 0;
    return { tool: "calendar_query", args: { databaseId, from: today(offset, now),
      to: today(date === "this week" ? (7 - now.getDay()) % 7 : offset, now) } };
  }
  if (/^(show |list )?(my )?(tasks due this week|this week’s tasks|this week's tasks|upcoming tasks)$/i.test(value)) {
    const days = /week/i.test(value) ? (7 - now.getDay()) % 7 : 6;
    return { tool: "calendar_query", args: { databaseId, from: today(0, now), to: today(days, now) } };
  }
  if (/^(show |list )?(my )?(open )?tasks$/i.test(value)) return /\bopen\b/i.test(value)
    ? { tool: "batch_read", args: { calls: [{ tool: "database_query", args: { databaseId, status: "Todo" } }, { tool: "database_query", args: { databaseId, status: "In progress" } }] } }
    : { tool: "database_query", args: { databaseId } };
  if (context.taskId && /^(show|inspect) (this |the )?task$/i.test(value)) return { tool: "task_inspect", args: { taskId: context.taskId } };
  if (context.pageId && /^outline (this |the )?page$/i.test(value)) return { tool: "page_inspect", args: { pageId: context.pageId } };
  if (context.pageId && /^show related (work|tasks)$/i.test(value)) return { tool: "graph_traverse", args: { pageId: context.pageId } };
  if ((match = value.match(/^create (?:a )?(page|task)(?: (?:called|named)\s+|:\s*)([^\n]+)$/i))) {
    const title = match[2].replace(/^["“']|["”']$/g, "").trim();
    return match[1].toLowerCase() === "page"
      ? { tool: "propose_change", args: { action: { kind: "create_page", title, parentId: context.pageId ?? null } } }
      : { tool: "propose_change", args: { action: { kind: "create_task", title, databaseId, pageId: context.pageId ?? null } } };
  }
  return null;
}

export function inferLocalRequest(prompt: string, context: Context, now = new Date()): ReturnType<typeof localRequest> {
  const value = prompt.trim().replace(/[’‘]/g, "'").replace(/[?!.]+$/, "");
  if (/^(?:what|which) (?:are )?(?:my )?(?:open|unfinished) tasks(?: do i have)?$/i.test(value)) {
    return localRequest("Show my open tasks", context, now);
  }
  if (context.pageId && /^(?:outline|inspect) (?:it|that page)$/i.test(value)) {
    return { tool: "page_inspect", args: { pageId: context.pageId } };
  }
  if (context.taskId && /^(?:show|inspect) (?:it|that task)$/i.test(value)) {
    return { tool: "task_inspect", args: { taskId: context.taskId } };
  }
  const topic = value.match(/^(?:(?:what do (?:we|i) have|do (?:we|i) have (?:anything|notes|pages)|anything|tell me) (?:on|about)|(?:where (?:is|are|can i find)|(?:could|can) you (?:find|look up)|look up))\s+(?:the\s+)?(.+)$/i)?.[1];
  if (topic) return { tool: "workspace_search", args: { query: topic.slice(0, 250) } };
  return null;
}
