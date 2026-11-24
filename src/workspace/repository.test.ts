import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTools } from "../agent/tools";
import { runAgent } from "../agent/runtime";
import { legacyWorkspaceNamespace, workspaceNamespace } from "./identity";
import { nodeText, paragraph, today, uid } from "./model";
import { StaleEditError, WorkspaceRepository } from "./repository";
import { createSearch } from "./search";
import { exampleWorkspace } from "../../tests/fixtures/workspace";

let repo: WorkspaceRepository;
let name: string;
beforeEach(async () => { name = `test-godspeed-${uid()}`; repo = new WorkspaceRepository(name); await repo.initialize(); });
afterEach(async () => { await repo.db.delete(); });

describe("local workspace", () => {
  it("starts blank with only the empty task database and does not add records on reopen", async () => {
    const id = await repo.workspaceId();
    expect(id).toBeTruthy();
    expect(await repo.backup()).toMatchObject({ pages: [], blocks: [], tasks: [], databases: [{ id: "tasks", name: "My tasks", properties: [] }] });
    expect(await repo.recentRuns()).toEqual([]);
    repo.db.close();
    repo = new WorkspaceRepository(name);
    await repo.initialize();
    expect(await repo.workspaceId()).toBe(id);
    expect(await repo.pages()).toEqual([]);
  });

  it("validates and persists chosen icons, with defaults for pages and folders", async () => {
    const folder = await repo.createPage({ title: "Shelf", kind: "folder" });
    const page = await repo.createPage({ title: "Book notes", glyph: "book", parentId: folder.id });
    expect(folder.glyph).toBe("folder");
    expect((await repo.createPage({ title: "Plain page" })).glyph).toBe("file");
    await expect(repo.createPage({ title: "Invalid icon", glyph: "missing-icon" as "file" })).rejects.toThrow();
    repo.db.close();
    repo = new WorkspaceRepository(name);
    await repo.initialize();
    expect(await repo.page(page.id)).toMatchObject({ glyph: "book", parentId: folder.id });
    expect((await repo.pages()).map((record) => record.title)).not.toContain("Invalid icon");
  });

  it("clears content and run history on confirmed reset and invalidates old run writes", async () => {
    await repo.restore(exampleWorkspace(), true);
    const workspaceId = await repo.workspaceId();
    const run = await runAgent({ repo, prompt: "List my pages", context: {}, signal: new AbortController().signal, onUpdate: () => {} });
    expect(await repo.recentRuns()).toHaveLength(1);
    await expect(repo.reset(false)).rejects.toThrow("confirmation");
    expect(await repo.pages()).not.toHaveLength(0);
    await repo.reset(true);
    expect(await repo.backup()).toMatchObject({ pages: [], blocks: [], tasks: [], databases: [{ id: "tasks", properties: [] }] });
    expect(await repo.recentRuns()).toEqual([]);
    expect(await repo.workspaceId()).not.toBe(workspaceId);
    await expect(repo.saveRun(run, workspaceId)).rejects.toBeInstanceOf(StaleEditError);
  });

  it("persists nested pages and stable block IDs across database reopen", async () => {
    const parent = await repo.createPage({ title: "Trips", kind: "folder" });
    const page = await repo.createPage({ title: "Train routes", parentId: parent.id });
    const current = await repo.document(page.id);
    const block = { ...paragraph("Research overnight trains."), attrs: { id: "stable-block" } };
    await repo.saveDocument(page.id, { type: "doc", content: [block] }, 0, current!.workspaceId);
    await expect(repo.movePage(parent.id, page.id)).rejects.toThrow(/descendants/);
    repo.db.close();
    repo = new WorkspaceRepository(name);
    await repo.initialize();
    expect((await repo.children(parent.id)).map((p) => p.id)).toEqual([page.id]);
    expect((await repo.pageBlocks(page.id))[0]).toMatchObject({ id: "stable-block", node: block });
    const search = createSearch(await repo.pages(), await repo.allBlocks(), await repo.allTasks());
    expect(search("overnight")[0]).toMatchObject({ id: page.id, kind: "page" });
  });

  it("rejects concurrent or obsolete body changes", async () => {
    await repo.restore(exampleWorkspace(), true);
    const { workspaceId, page } = (await repo.document("project-brief"))!;
    await repo.saveDocument(page.id, { type: "doc", content: [paragraph("Saved in another tab.")] }, page.contentRevision, workspaceId);
    await expect(repo.saveDocument(page.id, { type: "doc", content: [paragraph("Obsolete content")] }, page.contentRevision, workspaceId)).rejects.toBeInstanceOf(StaleEditError);
    const backup = await repo.backup();
    await repo.restore(backup, true);
    await expect(repo.saveDocument(page.id, { type: "doc", content: [] }, page.contentRevision + 1, workspaceId)).rejects.toBeInstanceOf(StaleEditError);
    expect(nodeText((await repo.pageBlocks(page.id))[0].node)).toBe("Saved in another tab.");
  });

  it("queries one shared task record by status, date, and relation", async () => {
    await repo.restore(exampleWorkspace(), true);
    const property = await repo.addProperty("tasks", { name: "Hours", type: "number" });
    const task = await repo.saveTask({ title: "Book venue", due: today(), status: "Todo", pageId: "project-brief", properties: { [property.id]: 2.5 } });
    await expect(repo.saveTask({ properties: { [property.id]: "two" } }, "tasks", task.id, task.revision)).rejects.toThrow(/invalid/);
    expect(await repo.tasks("tasks", { from: today(), to: today(), status: "Todo" })).toContainEqual(task);
    expect(await repo.relatedTasks("project-brief")).toContainEqual(task);
    const moved = await repo.saveTask({ status: "Done" }, "tasks", task.id, task.revision);
    expect(await repo.tasks("tasks", { from: today(), to: today(), status: "Todo" })).not.toContainEqual(task);
    expect(await repo.tasks("tasks", { status: "Done" })).toContainEqual(moved);
  });

  it("rejects unsafe backup replacement and restores a valid snapshot atomically", async () => {
    await repo.restore(exampleWorkspace(), true);
    const backup = await repo.backup();
    const extra = await repo.createPage({ title: "New data" });
    await expect(repo.restore(backup, false)).rejects.toThrow(/confirmation/);
    const invalid = structuredClone(backup);
    invalid.pages[0].parentId = invalid.pages[0].id;
    await expect(repo.restore(invalid, true)).rejects.toThrow(/cycle/);
    const invalidBlock = structuredClone(backup);
    invalidBlock.blocks[0].node.content = [{ type: "heading" }];
    await expect(repo.restore(invalidBlock, true)).rejects.toThrow(/invalid page blocks/);
    expect(await repo.page(extra.id)).toBeDefined();
    await repo.restore({ ...backup, format: legacyWorkspaceNamespace }, true);
    expect(await repo.page(extra.id)).toBeUndefined();
    expect((await repo.backup()).format).toBe(workspaceNamespace);
    expect((await repo.backup()).blocks).toEqual(backup.blocks);
  });

  it("protects children and clears incoming links only on confirmed deletion", async () => {
    await repo.restore(exampleWorkspace(), true);
    await expect(repo.deletePage("projects", 0, true)).rejects.toThrow(/child pages/);
    await expect(repo.deletePage("design-research", 0, false)).rejects.toThrow(/confirmation/);
    await repo.deletePage("design-research", 0, true);
    expect(await repo.page("design-research")).toBeUndefined();
    expect(await repo.pageBlocks("design-research")).toEqual([]);
    expect((await repo.page("project-brief"))?.links).toEqual([]);
    expect((await repo.task("gather-research"))?.pageId).toBeNull();
  });
});

it("copies the old workspace once, including content, relations, metadata and undo history", async () => {
  const previousName = `${legacyWorkspaceNamespace}-${uid()}`;
  const old = new WorkspaceRepository(previousName);
  const upgraded = new WorkspaceRepository(`${workspaceNamespace}-${uid()}`, previousName);
  const otherTab = new WorkspaceRepository(upgraded.db.name, previousName);
  try {
    await old.initialize();
    await old.restore(exampleWorkspace(), true);
    const workspaceId = await old.workspaceId();
    const page = await old.createPage({ title: "A saved page", text: "Notes from before the rename.", parentId: "projects" });
    const task = await old.saveTask({ title: "Carry this over", pageId: page.id });
    const run = await runAgent({
      repo: old, prompt: "Create a page called A proposal", context: { pageId: "projects" },
      signal: new AbortController().signal, onUpdate: () => {},
    });
    const [proposal] = run.proposals;
    const receipt = await old.commit(run.id, proposal.id, true);
    const expectedHistory = await old.recentRuns();

    await Promise.all([upgraded.initialize(), otherTab.initialize()]);
    expect(await upgraded.workspaceId()).toBe(workspaceId);
    expect(await upgraded.page(page.id)).toEqual(page);
    expect(await upgraded.pageBlocks(page.id)).toEqual(await old.pageBlocks(page.id));
    expect(await upgraded.relatedTasks(page.id)).toEqual([task]);
    expect(await upgraded.recentRuns()).toEqual(expectedHistory);
    await upgraded.undo(run.id, proposal.id);
    expect(await upgraded.page(receipt.id)).toBeUndefined();
    expect(await old.page(receipt.id)).toBeDefined();
    await old.createPage({ title: "Added after the copy" });
    await upgraded.initialize();
    expect((await upgraded.pages()).map((p) => p.title)).not.toContain("Added after the copy");
  } finally {
    otherTab.db.close();
    await upgraded.db.delete();
    await old.db.delete();
  }
});

describe("agent permissions and changes", () => {
  beforeEach(() => repo.restore(exampleWorkspace(), true));
  const run = (prompt: string, pageId?: string) => runAgent({ repo, prompt, context: { pageId }, signal: new AbortController().signal, onUpdate: () => {} });
  it("limits block access to scoped IDs and prohibits writes in batch reads", async () => {
    const tool = createTools(repo);
    const result = await tool("page_read", { pageId: "project-brief", blockIds: ["meeting-notes-1", "project-brief-1"] });
    expect(result.sources).toHaveLength(1);
    expect(result.output).toMatchObject({ blocks: [{ id: "meeting-notes-1", error: expect.any(String) }, { id: "project-brief-1", text: expect.stringContaining("starting point") }] });
    await expect(tool("batch_read", { calls: [{ tool: "propose_change", args: {} }] })).rejects.toThrow();
    await expect(tool("propose_change", { action: { kind: "delete_page", pageId: "project-brief" } })).rejects.toThrow();
  });

  it("persists read steps and never writes a draft until explicit approval", async () => {
    const listing = await run("Show my open tasks");
    expect(listing.steps[0].tool).toBe("batch_read");
    const result = await run("Create a page called New Ideas", "projects");
    const [proposal] = result.proposals;
    expect(result.status).toBe("complete");
    expect((await repo.children("projects")).map((p) => p.title)).not.toContain("New Ideas");
    await expect(repo.commit(result.id, proposal.id, false)).rejects.toThrow(/approval/);
    const receipt = await repo.commit(result.id, proposal.id, true);
    expect(await repo.page(receipt.id)).toMatchObject({ parentId: "projects", title: "New Ideas" });
    await expect(repo.commit(result.id, proposal.id, true)).rejects.toThrow(/already applied/);
    await repo.undo(result.id, proposal.id);
    expect(await repo.page(receipt.id)).toBeUndefined();
  });

  it("streams through a pluggable provider and invalidates edits after a concurrent change", async () => {
    let round = 0;
    const result = await runAgent({
      repo, prompt: "Improve the workspace title", context: { pageId: "project-brief" },
      signal: new AbortController().signal, onUpdate: () => {},
      provider: { async complete(messages, _, onText) {
        if (!round++) return { text: "", calls: [{ id: "call1", type: "function", function: { name: "propose_change", arguments: JSON.stringify({ action: { kind: "rename_page", pageId: "project-brief", title: "Improved Brief" } }) } }] };
        expect(messages.at(-1)).toMatchObject({ role: "tool", tool_call_id: "call1", content: expect.stringContaining("awaiting_user_approval") });
        onText("Ready to review.");
        return { text: "Ready to review.", calls: [] };
      } },
    });
    expect(result.status).toBe("complete");
    expect(result.proposals[0]).toMatchObject({ before: "Project brief", after: "Improved Brief" });
    await repo.patchPage("project-brief", { title: "A newer title" });
    await expect(repo.commit(result.id, result.proposals[0].id, true)).rejects.toBeInstanceOf(StaleEditError);
    expect((await repo.page("project-brief"))?.title).toBe("A newer title");
  });

  it("keeps chat context scoped and continues to use the same search tool for model-led questions", async () => {
    const send = (prompt: string, threadId: string) => runAgent({
      repo, prompt, threadId, context: {}, signal: new AbortController().signal, onUpdate: () => {},
    });
    const threadId = uid();
    const unrelated = await send("Create a page called Unrelated private draft", uid());
    const previous = await send("What’s due today?", threadId);
    expect(previous.steps[0]).toMatchObject({ tool: "calendar_query", input: { from: today(), to: today() } });
    let round = 0;
    const result = await runAgent({ repo, threadId, prompt: "What should I read before I do that?", context: {},
      signal: new AbortController().signal, onUpdate: () => {}, provider: { async complete(messages) {
        expect(messages.slice(0, 2)).toEqual([
          { role: "user", content: previous.prompt },
          { role: "assistant", content: previous.answer },
        ]);
        expect(JSON.stringify(messages)).not.toContain(unrelated.prompt);
        if (!round++) return { text: "", calls: [{ id: "search", type: "function", function: { name: "workspace_search", arguments: '{"query":"Project brief"}' } }] };
        expect(messages.at(-1)).toMatchObject({ role: "tool", content: expect.stringContaining("project-brief") });
        return { text: "Start with the Project brief.", calls: [] };
      } },
    });
    expect(result.status).toBe("complete");
    expect((await repo.chatRuns(threadId)).map((turn) => turn.id)).toEqual([previous.id, result.id]);
    expect(await repo.recentChats()).toHaveLength(2);
  });

  it("makes only one recovery request after an empty answer and reports a retryable error if it stays empty", async () => {
    let rounds = 0;
    const run = (recover: boolean) => runAgent({ repo, prompt: "Tell me about cedar trees.", context: {},
      signal: new AbortController().signal, onUpdate: () => {}, provider: { async complete(messages, _signal, _onText, webSearch) {
        if (++rounds === 1) return { text: "  ", calls: [], searched: true };
        expect(webSearch).toBe(false);
        expect(messages.at(-1)?.content).toContain("answer the original request");
        return { text: recover ? "Cedar trees are evergreen." : "", calls: [] };
      } },
    });
    expect(await run(true)).toMatchObject({ status: "complete", answer: "Cedar trees are evergreen." });
    expect(rounds).toBe(2);
    rounds = 0;
    expect(await run(false)).toMatchObject({ status: "error", answer: expect.stringContaining("choose another model") });
    expect(rounds).toBe(2);
  });
});
