import { type Backup, type Page, type Task, mainDatabaseId, paragraph, recordsFor, textNode, today } from "../../src/workspace/model";
import { workspaceNamespace } from "../../src/workspace/identity";

export function exampleWorkspace(now = Date.now()): Backup {
  const hour = 3_600_000;
  const make = (id: string, title: string, glyph: Page["glyph"], tone: Page["tone"], hours: number, extra: Partial<Page> = {}): Page => ({
    id, title, glyph, tone, parentId: null, kind: "page", tags: [], links: [], favorite: false,
    createdAt: now - hours * hour, updatedAt: now - hours * hour, revision: 0, contentRevision: 0, ...extra,
  });
  const pages = [
    make("projects", "Projects", "layers", "violet", 72, { kind: "folder", favorite: true }),
    make("knowledge", "Knowledge base", "book", "mint", 84, { kind: "folder" }),
    make("field-notes", "Field notes", "pen", "slate", 96, { kind: "folder" }),
    make("project-brief", "Project brief", "flag", "violet", 0.2, { parentId: "projects", tags: ["Planning"], links: ["design-research"] }),
    make("weekly-planning", "Weekly planning", "compass", "blue", 3, { parentId: "field-notes", tags: ["Notes"] }),
    make("design-research", "Design research", "flask", "peach", 25, { parentId: "knowledge", tags: ["Research"] }),
    make("meeting-notes", "Meeting notes", "file", "mint", 49, { parentId: "field-notes", tags: ["Notes"] }),
  ];
  const sections = {
    "project-brief": ["A starting point for the work ahead. Keep this brief short, specific, and easy to revisit.", "What we’re making", "A calmer place to collect ideas and take them from rough notes to decisions.", "What success looks like", "A first version that is easy to find, understand, and use. Link decisions and research here as the project takes shape."],
    "weekly-planning": ["Start with the work that matters most. Leave a little room for the unexpected.", "This week", "Review the project brief and pick one concrete next step.", "Looking ahead", "Set aside time to reflect on what worked and what should change."],
    "design-research": ["A place for observations, open questions, and ideas worth revisiting.", "Questions to explore", "What helps people return to an idea after time away?", "Notes", "Write down observations before deciding what they mean."],
    "meeting-notes": ["Keep notes, decisions, and follow-ups together.", "Agenda", "Review open questions and agree on the next milestone.", "Decisions", "Record decisions here with enough context to make them useful later."],
  };
  const blocks = Object.entries(sections).flatMap(([pageId, copy]) => recordsFor(pageId, {
    type: "doc",
    content: copy.map((line, i) => {
      const attrs = { id: `${pageId}-${i + 1}` };
      return i % 2 === 1 ? { type: "heading", attrs: { ...attrs, level: 2 }, content: [textNode(line)] } : { ...paragraph(line), attrs };
    }),
  }));
  const task = (id: string, title: string, status: Task["status"], priority: Task["priority"], due: number, pageId: string, tags: string[]): Task => ({
    id, title, status, priority, due: today(due, new Date(now)), pageId, tags, properties: {},
    databaseId: mainDatabaseId, createdAt: now, updatedAt: now, revision: 0,
  });
  return {
    format: workspaceNamespace, version: 1, pages, blocks,
    databases: [{ id: mainDatabaseId, name: "My tasks", properties: [] }],
    tasks: [
      task("review-brief", "Review the project brief", "In progress", "High", 0, "project-brief", ["Planning"]),
      task("gather-research", "Gather research references", "Todo", "Medium", 2, "design-research", ["Research"]),
      task("next-week", "Outline next week’s priorities", "Todo", "Medium", 4, "weekly-planning", ["Planning"]),
      task("capture-notes", "Capture kickoff notes", "Done", "Low", -1, "meeting-notes", ["Notes"]),
    ],
  };
}
