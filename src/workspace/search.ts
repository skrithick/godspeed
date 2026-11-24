import MiniSearch from "minisearch";
import { nodeText, type Block, type Page, type Task } from "./model";

export type SearchHit = { id: string; kind: "page" | "task"; title: string; detail: string; content: string; tags: string };

export function createSearch(pages: Page[], blocks: Block[], tasks: Task[]) {
  const groups = new Map<string, string[]>();
  for (const block of blocks) {
    const group = groups.get(block.pageId) ?? [];
    group.push(nodeText(block.node));
    groups.set(block.pageId, group);
  }
  const titles = new Map(pages.map((page) => [page.id, page.title]));
  const index = new MiniSearch<SearchHit>({
    idField: "id", fields: ["title", "content", "tags"], storeFields: ["title", "kind", "detail"],
    searchOptions: { boost: { title: 4, tags: 2 }, prefix: true, fuzzy: (term) => term.length > 4 ? 0.2 : false },
  });
  index.addAll([
    ...pages.map((p): SearchHit => ({
      id: `page:${p.id}`, kind: "page", title: p.title, tags: p.tags.join(" "),
      content: (groups.get(p.id) ?? []).join("\n").slice(0, 120_000),
      detail: (p.parentId && titles.get(p.parentId)) || (p.kind === "folder" ? "Folder" : "Workspace"),
    })),
    ...tasks.map((t): SearchHit => ({ id: `task:${t.id}`, kind: "task", title: t.title, content: t.status, tags: t.tags.join(" "), detail: t.status })),
  ]);
  return (query: string, limit = 12, kind?: SearchHit["kind"]) => index.search(query.trim().slice(0, 250),
    kind ? { filter: (result) => result.kind === kind } : undefined).slice(0, limit).map((r) => ({
    id: String(r.id).split(":")[1], title: String(r.title), detail: String(r.detail), kind: r.kind as SearchHit["kind"],
  }));
}
