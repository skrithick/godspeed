import Dexie, { type Table } from "dexie";
import type { JSONContent } from "@tiptap/core";
import type { Run } from "../agent/types";
import { actionSchema, type Action, type Proposal, type Receipt } from "./changes";
import {
  dateSchema, idSchema, mainDatabaseId, pageSchema, paragraph, propertySchema, recordsFor, statuses, taskSchema, titleSchema, uid, validateBackup,
  type Backup, type Block, type Database, type Page, type Property, type Task,
} from "./model";
import { legacyWorkspaceNamespace, workspaceNamespace } from "./identity";
import { markdownBlocks } from "./markdown";

const emptyTaskDatabase = (): Database => ({ id: mainDatabaseId, name: "My tasks", properties: [] });

class WorkspaceDB extends Dexie {
  pages!: Table<Page, string>;
  blocks!: Table<Block, [string, string]>;
  databases!: Table<Database, string>;
  tasks!: Table<Task, string>;
  meta!: Table<{ key: string; value: string }, string>;
  runs!: Table<Run, string>;
  constructor(name: string) {
    super(name);
    this.version(1).stores({
      pages: "id, parentId, updatedAt",
      blocks: "[pageId+id], pageId, [pageId+position]",
      databases: "id",
      tasks: "id, databaseId, pageId, [databaseId+status], [databaseId+due]",
      meta: "key",
      runs: "id, startedAt",
    });
    this.version(2).stores({ runs: "id, startedAt, threadId" });
  }
}

async function readPreviousWorkspace(name: string) {
  if (!(await Dexie.exists(name))) return null;
  const db = new Dexie(name);
  try {
    await db.open();
    const pages = db.table<Page, string>("pages");
    const blocks = db.table<Block, [string, string]>("blocks");
    const databases = db.table<Database, string>("databases");
    const tasks = db.table<Task, string>("tasks");
    const metadata = db.table<{ key: string; value: string }, string>("meta");
    const runs = db.table<Run, string>("runs");
    return await db.transaction("r", [pages, blocks, databases, tasks, metadata, runs], async () => {
      const meta = await metadata.toArray();
      if (!meta.some((entry) => entry.key === "workspace" && entry.value)) return null;
      return {
        meta, runs: await runs.toArray(), pages: await pages.toArray(), blocks: await blocks.toArray(),
        databases: await databases.toArray(), tasks: await tasks.toArray(),
      };
    });
  } finally {
    db.close();
  }
}

export class StaleEditError extends Error {
  constructor() { super("This item changed after it was opened. Your edit was not applied."); }
}

type PagePatch = Partial<Pick<Page, "title" | "tags" | "favorite" | "links">>;
type TaskPatch = Partial<Pick<Task, "title" | "status" | "priority" | "due" | "tags" | "pageId" | "properties">>;
type TaskFilter = { status?: Task["status"]; from?: string; to?: string; offset?: number; limit?: number };

export class WorkspaceRepository {
  readonly db: WorkspaceDB;
  private readonly previousName?: string;
  constructor(name = workspaceNamespace, previousName = name === workspaceNamespace ? legacyWorkspaceNamespace : undefined) {
    this.db = new WorkspaceDB(name);
    this.previousName = previousName;
  }

  async initialize() {
    const { db } = this;
    if (await db.meta.get("workspace")) return;
    const previous = this.previousName ? await readPreviousWorkspace(this.previousName) : null;
    await db.transaction("rw", [db.pages, db.blocks, db.databases, db.tasks, db.meta, db.runs], async () => {
      // Another Godspeed tab may have initialized while we read the previous database.
      if (await db.meta.get("workspace")) return;
      if (previous) {
        await db.pages.bulkAdd(previous.pages);
        await db.blocks.bulkAdd(previous.blocks);
        await db.databases.bulkAdd(previous.databases);
        await db.tasks.bulkAdd(previous.tasks);
        await db.runs.bulkAdd(previous.runs);
        await db.meta.bulkAdd(previous.meta);
      } else {
        await db.databases.add(emptyTaskDatabase());
        await db.meta.add({ key: "workspace", value: uid() });
      }
    });
  }

  async workspaceId() { return (await this.db.meta.get("workspace"))?.value ?? ""; }
  pages() { return this.db.pages.orderBy("updatedAt").reverse().toArray(); }
  page(id: string) { return this.db.pages.get(id); }
  children(id: string | null) {
    return id === null ? this.db.pages.filter((p) => p.parentId === null).toArray() : this.db.pages.where("parentId").equals(id).toArray();
  }
  private blockQuery(id: string) { return this.db.blocks.where("[pageId+position]").between([id, 0], [id, Dexie.maxKey], true, true); }
  pageBlocks(id: string) { return this.blockQuery(id).toArray(); }
  blockOutline(id: string, offset: number, limit: number) {
    const { db } = this;
    return db.transaction("r", [db.pages, db.blocks], async () => ({
      page: await this.page(id), count: await this.blockQuery(id).count(), blocks: await this.blockQuery(id).offset(offset).limit(limit).toArray(),
    }));
  }
  allBlocks() { return this.db.blocks.toArray(); }
  async document(id: string) {
    return this.db.transaction("r", [this.db.pages, this.db.blocks, this.db.meta], async () => {
      const page = await this.page(id);
      return page ? { page, workspaceId: await this.workspaceId(), doc: { type: "doc", content: (await this.pageBlocks(id)).map((b) => b.node) } as JSONContent } : undefined;
    });
  }

  async createPage(input: { title: string; parentId?: string | null; kind?: Page["kind"]; glyph?: Page["glyph"]; text?: string; markdown?: boolean }) {
    const { db } = this;
    return db.transaction("rw", [db.pages, db.blocks], async () => {
      const parentId = input.parentId ?? null;
      if (parentId && !(await this.page(parentId))) throw new Error("Parent page no longer exists.");
      const kind = input.kind ?? "page";
      const now = Date.now();
      const page = pageSchema.parse({
        id: uid(), title: input.title, parentId, kind, glyph: input.glyph ?? (kind === "folder" ? "folder" : "file"), tone: "violet",
        favorite: false, tags: [], links: [], createdAt: now, updatedAt: now, revision: 0, contentRevision: 0,
      });
      await db.pages.add(page);
      if (kind === "page" && input.text) await db.blocks.bulkAdd(recordsFor(page.id, {
        type: "doc", content: input.markdown ? markdownBlocks(input.text) : lines(input.text),
      }));
      return page;
    });
  }

  async patchPage(id: string, patch: PagePatch, expectedRevision?: number) {
    const { db } = this;
    return db.transaction("rw", db.pages, async () => {
      const page = await this.mustPage(id);
      if (expectedRevision !== undefined && expectedRevision !== page.revision) throw new StaleEditError();
      if (patch.links?.length && (patch.links.includes(id) || (await db.pages.bulkGet(patch.links)).some((p) => !p))) {
        throw new Error("One of the linked pages is no longer available.");
      }
      const next = pageSchema.parse({ ...page, ...patch, revision: page.revision + 1, updatedAt: Date.now() });
      await db.pages.put(next);
      return next;
    });
  }

  async movePage(id: string, parentId: string | null) {
    const { db } = this;
    return db.transaction("rw", db.pages, async () => {
      const page = await this.mustPage(id);
      if (page.parentId === parentId) return page;
      const visited = new Set([id]);
      for (let cursor = parentId; cursor;) {
        if (visited.has(cursor)) throw new Error("A page can’t be moved into itself or one of its descendants.");
        visited.add(cursor);
        cursor = (await this.mustPage(cursor)).parentId;
      }
      const next = { ...page, parentId, updatedAt: Date.now(), revision: page.revision + 1 };
      await db.pages.put(next);
      return next;
    });
  }

  async deletePage(id: string, expectedRevision: number, confirmed: boolean) {
    if (!confirmed) throw new Error("Deleting a page requires confirmation.");
    const { db } = this;
    await db.transaction("rw", [db.pages, db.blocks, db.tasks], async () => {
      const page = await this.mustPage(id);
      if (page.revision !== expectedRevision) throw new StaleEditError();
      if (await db.pages.where("parentId").equals(id).first()) throw new Error("Move the child pages elsewhere before deleting this item.");
      const now = Date.now();
      await db.pages.filter((p) => p.links.includes(id)).modify((p) => {
        p.links = p.links.filter((link) => link !== id);
        p.revision += 1;
        p.updatedAt = now;
      });
      await db.tasks.where("pageId").equals(id).modify((t) => {
        t.pageId = null;
        t.revision += 1;
        t.updatedAt = now;
      });
      await db.blocks.where("pageId").equals(id).delete();
      await db.pages.delete(id);
    });
  }

  async saveDocument(id: string, doc: JSONContent, contentRevision: number, workspaceId: string) {
    const { db } = this;
    const blocks = recordsFor(id, doc);
    if (new Set(blocks.map((b) => b.id)).size !== blocks.length) throw new Error("Document contains duplicate block IDs.");
    return db.transaction("rw", [db.pages, db.blocks, db.meta], async () => {
      const page = await this.mustPage(id);
      if (page.kind !== "page" || contentRevision !== page.contentRevision || workspaceId !== await this.workspaceId()) throw new StaleEditError();
      const previous = new Map((await this.pageBlocks(id)).map((b) => [b.id, b]));
      const upserts = blocks.filter((b) => {
        const old = previous.get(b.id);
        previous.delete(b.id);
        return !old || old.position !== b.position || JSON.stringify(old.node) !== JSON.stringify(b.node);
      });
      if (!previous.size && !upserts.length) return page.contentRevision;
      if (previous.size) await db.blocks.bulkDelete([...previous.keys()].map((blockId) => [id, blockId]));
      if (upserts.length) await db.blocks.bulkPut(upserts);
      const next = { ...page, updatedAt: Date.now(), revision: page.revision + 1, contentRevision: page.contentRevision + 1 };
      await db.pages.put(next);
      return next.contentRevision;
    });
  }

  async databases() { return this.db.databases.toArray(); }
  database(id = mainDatabaseId) { return this.db.databases.get(id); }
  task(id: string) { return this.db.tasks.get(id); }
  allTasks() { return this.db.tasks.toArray(); }
  relatedTasks(pageId: string) { return this.db.tasks.where("pageId").equals(pageId).toArray(); }
  async tasks(databaseId = mainDatabaseId, filter: TaskFilter = {}) {
    const { from, to, status, offset = 0, limit } = filter;
    const table = this.db.tasks;
    let query = from || to
      ? table.where("[databaseId+due]").between([databaseId, from || "0000-01-01"], [databaseId, to || "9999-12-31"], true, true)
      : status ? table.where("[databaseId+status]").equals([databaseId, status]) : table.where("databaseId").equals(databaseId);
    if ((from || to) && status) query = query.and((task) => task.status === status);
    if (offset) query = query.offset(offset);
    if (limit !== undefined) query = query.limit(limit);
    return query.toArray();
  }

  async saveTask(input: TaskPatch, databaseId = mainDatabaseId, id?: string, expectedRevision?: number) {
    const { db } = this;
    return db.transaction("rw", [db.tasks, db.pages, db.databases], async () => {
      const database = await this.database(databaseId);
      if (!database) throw new Error("Database no longer exists.");
      const current = id ? await this.task(id) : undefined;
      if (id && (!current || current.databaseId !== databaseId || (expectedRevision !== undefined && current.revision !== expectedRevision))) throw new StaleEditError();
      const now = Date.now();
      const base = current ?? { id: uid(), databaseId, status: statuses[0], priority: "Medium", due: "", tags: [], pageId: null, properties: {}, createdAt: now, revision: -1 };
      const task = taskSchema.parse({ ...base, ...input, updatedAt: now, revision: base.revision + 1 });
      if (task.pageId && !(await this.page(task.pageId))) throw new Error("Linked page no longer exists.");
      const definitions = new Map(database.properties.map((prop) => [prop.id, prop.type]));
      for (const [key, value] of Object.entries(task.properties)) {
        const type = definitions.get(key);
        if (!(type === "text" ? typeof value === "string" : type === "number" ? typeof value === "number"
          : type === "checkbox" ? typeof value === "boolean" : type === "date" && dateSchema.safeParse(value).success)) {
          throw new Error("A custom property has an invalid value.");
        }
      }
      await db.tasks.put(task);
      return task;
    });
  }

  async createDatabase(name: string) {
    const database: Database = { id: uid(), name: titleSchema.parse(name), properties: [] };
    await this.db.databases.add(database);
    return database;
  }

  async addProperty(databaseId: string, input: Pick<Property, "name" | "type">) {
    const { db } = this;
    return db.transaction("rw", db.databases, async () => {
      const database = await this.database(databaseId);
      if (!database) throw new Error("Database no longer exists.");
      if (database.properties.length >= 24) throw new Error("This database already has 24 custom properties.");
      const property = propertySchema.parse({ id: uid(), ...input });
      if (database.properties.some((p) => p.name.toLowerCase() === property.name.toLowerCase())) throw new Error("A property with that name already exists.");
      await db.databases.put({ ...database, properties: [...database.properties, property] });
      return property;
    });
  }

  async removeTask(id: string, revision: number) {
    await this.db.transaction("rw", this.db.tasks, async () => {
      if ((await this.task(id))?.revision !== revision) throw new StaleEditError();
      await this.db.tasks.delete(id);
    });
  }

  async backup(): Promise<Backup> {
    const { db } = this;
    return db.transaction("r", [db.pages, db.blocks, db.databases, db.tasks], async () => ({
      format: workspaceNamespace, version: 1,
      pages: await this.pages(), blocks: await this.allBlocks(), databases: await this.databases(), tasks: await this.allTasks(),
    }));
  }

  async restore(input: unknown, confirmed: boolean) {
    if (!confirmed) throw new Error("Restoring requires confirmation.");
    const backup = validateBackup(input);
    const { db } = this;
    await db.transaction("rw", [db.pages, db.blocks, db.tasks, db.databases, db.meta, db.runs], async () => {
      const oldPages = await db.pages.bulkGet(backup.pages.map((page) => page.id));
      const oldTasks = await db.tasks.bulkGet(backup.tasks.map((task) => task.id));
      await Promise.all([db.pages.clear(), db.blocks.clear(), db.tasks.clear(), db.databases.clear(), db.runs.clear()]);
      await db.pages.bulkAdd(backup.pages.map((page, i) => oldPages[i]
        ? { ...page, revision: Math.max(page.revision, oldPages[i].revision) + 1, contentRevision: Math.max(page.contentRevision, oldPages[i].contentRevision) + 1 }
        : page));
      await db.blocks.bulkAdd(backup.blocks);
      await db.tasks.bulkAdd(backup.tasks.map((task, i) => oldTasks[i] ? { ...task, revision: Math.max(task.revision, oldTasks[i].revision) + 1 } : task));
      await db.databases.bulkAdd(backup.databases);
      await db.meta.put({ key: "workspace", value: uid() });
    });
  }

  async reset(confirmed: boolean) {
    if (!confirmed) throw new Error("Resetting requires confirmation.");
    await this.restore({
      format: workspaceNamespace, version: 1, pages: [], blocks: [], tasks: [], databases: [emptyTaskDatabase()],
    } satisfies Backup, true);
  }

  recentRuns() { return this.db.runs.orderBy("startedAt").reverse().limit(30).toArray(); }
  recentChats() {
    const seen = new Set<string>();
    return this.db.runs.orderBy("startedAt").reverse().filter((run) => {
      const key = run.threadId ?? run.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).limit(20).toArray();
  }

  async chatRuns(threadId: string) {
    const [turns, legacy] = await Promise.all([
      this.db.runs.where("threadId").equals(threadId).toArray(),
      this.db.runs.get(threadId),
    ]);
    if (legacy && !legacy.threadId) turns.push(legacy);
    return turns.sort((a, b) => a.startedAt - b.startedAt);
  }
  async saveRun(run: Run, workspaceId?: string) {
    const { db } = this;
    await db.transaction("rw", [db.runs, db.meta], async () => {
      if (workspaceId && workspaceId !== await this.workspaceId()) throw new StaleEditError();
      await db.runs.put(run);
    });
  }

  async propose(raw: Action): Promise<Proposal> {
    const action = actionSchema.parse(raw);
    const base = { id: uid(), workspaceId: await this.workspaceId(), action, before: "" };
    switch (action.kind) {
      case "create_page": {
        const parent = action.parentId ? (await this.mustPage(action.parentId)).title : "Workspace";
        return { ...base, label: `Create page in ${parent}`, after: [action.title, action.text].filter(Boolean).join("\n\n") };
      }
      case "create_task": {
        const page = action.pageId ? (await this.mustPage(action.pageId)).title : "";
        const database = await this.database(action.databaseId);
        if (!database) throw new Error("Database not found.");
        return { ...base, label: `Create task in ${database.name}`, after: [action.title, action.due && `Due: ${action.due}`, page && `Related page: ${page}`].filter(Boolean).join("\n") };
      }
      case "rename_page": {
        const page = await this.mustPage(action.pageId);
        return { ...base, label: "Rename page", before: page.title, after: action.title, revision: page.revision };
      }
      case "append_page": {
        const page = await this.mustPage(action.pageId);
        if (page.kind !== "page") throw new Error("Folders do not have editable blocks.");
        return { ...base, label: `Append to ${page.title}`, after: action.text, revision: page.revision };
      }
      case "update_task": {
        const task = await this.mustTask(action.taskId);
        const fields = fieldsFor(action);
        if (!fields.length) throw new Error("No task changes were specified.");
        return {
          ...base, label: `Edit ${task.title}`, revision: task.revision,
          before: fields.map((k) => `${k}: ${task[k] || "—"}`).join("\n"),
          after: fields.map((k) => `${k}: ${action[k] || "—"}`).join("\n"),
        };
      }
    }
  }

  async commit(runId: string, proposalId: string, confirmed: boolean): Promise<Receipt> {
    if (!confirmed) throw new Error("Changes require explicit approval.");
    const { db } = this;
    return db.transaction("rw", [db.pages, db.blocks, db.tasks, db.databases, db.meta, db.runs], async () => {
      const run = await db.runs.get(idSchema.parse(runId));
      const proposal = run?.proposals.find((p) => p.id === proposalId);
      if (!run || !proposal || run.status !== "complete") throw new Error("Only a completed proposal can be applied.");
      if (run.receipts.some((r) => r.proposalId === proposalId)) throw new Error("This proposal was already applied.");
      if (proposal.workspaceId !== await this.workspaceId()) throw new StaleEditError();
      const action = actionSchema.parse(proposal.action);
      const base = { proposalId, workspaceId: proposal.workspaceId };
      let receipt: Receipt;
      switch (action.kind) {
        case "create_page": {
          const page = await this.createPage({ title: action.title, text: action.text, parentId: action.parentId, markdown: true });
          receipt = { ...base, type: "page", id: page.id, revision: page.revision };
          break;
        }
        case "rename_page":
        case "append_page": {
          const before = await this.mustPage(action.pageId);
          if (before.revision !== proposal.revision) throw new StaleEditError();
          const blocks = action.kind === "append_page" ? await this.pageBlocks(before.id) : undefined;
          if (action.kind === "rename_page") await this.patchPage(before.id, { title: action.title }, before.revision);
          else if (blocks) await this.saveDocument(before.id, { type: "doc", content: [...blocks.map((b) => b.node), ...markdownBlocks(action.text)] }, before.contentRevision, proposal.workspaceId);
          receipt = { ...base, type: "page", id: before.id, revision: before.revision + 1, before, blocks };
          break;
        }
      case "create_task": {
          const task = await this.saveTask({ title: action.title, due: action.due ?? "", pageId: action.pageId ?? null }, action.databaseId);
          receipt = { ...base, type: "task", id: task.id, revision: task.revision };
          break;
        }
        case "update_task": {
          const before = await this.mustTask(action.taskId);
          const task = await this.saveTask(Object.fromEntries(fieldsFor(action).map((k) => [k, action[k]])), before.databaseId, before.id, proposal.revision);
          receipt = { ...base, type: "task", id: task.id, revision: task.revision, before };
          break;
        }
      }
      await db.runs.put({ ...run, receipts: [...run.receipts, receipt] });
      return receipt;
    });
  }

  async undo(runId: string, proposalId: string) {
    const { db } = this;
    await db.transaction("rw", [db.pages, db.blocks, db.tasks, db.meta, db.runs], async () => {
      const run = await db.runs.get(runId);
      const receipt = run?.receipts.find((r) => r.proposalId === proposalId);
      if (!run || !receipt || run.undone.includes(proposalId)) throw new Error("There is no committed change to undo.");
      if (receipt.workspaceId !== await this.workspaceId()) throw new StaleEditError();
      if (receipt.type === "task") {
        const task = await this.mustTask(receipt.id);
        if (task.revision !== receipt.revision) throw new StaleEditError();
        if (receipt.before) await db.tasks.put({ ...receipt.before, revision: task.revision + 1, updatedAt: Date.now() });
        else await db.tasks.delete(task.id);
      } else {
        const page = await this.mustPage(receipt.id);
        if (page.revision !== receipt.revision) throw new StaleEditError();
        if (receipt.before) {
          await db.pages.put({ ...receipt.before, revision: page.revision + 1, contentRevision: page.contentRevision + (receipt.blocks ? 1 : 0), updatedAt: Date.now() });
          if (receipt.blocks) {
            await db.blocks.where("pageId").equals(page.id).delete();
            await db.blocks.bulkAdd(receipt.blocks);
          }
        } else {
          if (await db.pages.where("parentId").equals(page.id).first()
            || await db.pages.filter((p) => p.links.includes(page.id)).first()
            || await db.tasks.where("pageId").equals(page.id).first()) throw new Error("This page has since been linked or given children.");
          await db.blocks.where("pageId").equals(page.id).delete();
          await db.pages.delete(page.id);
        }
      }
      await db.runs.put({ ...run, undone: [...run.undone, proposalId] });
    });
  }

  private async mustPage(id: string) {
    const page = await this.page(id);
    if (!page) throw new Error("Page not found.");
    return page;
  }
  private async mustTask(id: string) {
    const task = await this.task(id);
    if (!task) throw new Error("Task not found.");
    return task;
  }
}

const lines = (text: string) => text.split(/\r?\n/).map(paragraph);
const fieldsFor = (action: Extract<Action, { kind: "update_task" }>) =>
  (["title", "status", "priority", "due"] as const).filter((key) => action[key] !== undefined);
export const repo = new WorkspaceRepository();
