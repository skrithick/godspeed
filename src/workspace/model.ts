import type { JSONContent } from "@tiptap/core";
import { z } from "zod";
import { legacyWorkspaceNamespace, workspaceNamespace } from "./identity";

export const glyphs = ["file", "folder", "layers", "book", "compass", "pen", "flask", "flag"] as const;
export const tones = ["violet", "peach", "mint", "blue", "slate"] as const;
export const statuses = ["Todo", "In progress", "Done"] as const;
export const priorities = ["Low", "Medium", "High"] as const;
export const idSchema = z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/);
export const titleSchema = z.string().trim().min(1).max(160);
export const dateSchema = z.iso.date();
const stamp = z.number().int().nonnegative();

export const pageSchema = z.object({
  id: idSchema, parentId: idSchema.nullable(), title: titleSchema, kind: z.enum(["page", "folder"]),
  glyph: z.enum(glyphs), tone: z.enum(tones), tags: z.array(z.string().trim().min(1).max(40)).max(20),
  links: z.array(idSchema).max(100), favorite: z.boolean(), createdAt: stamp, updatedAt: stamp,
  revision: stamp, contentRevision: stamp,
});
export type Page = z.infer<typeof pageSchema>;

const blockTypes = ["paragraph", "heading", "blockquote", "bulletList", "orderedList", "listItem", "taskList", "taskItem", "codeBlock", "horizontalRule", "table", "tableRow", "tableCell", "tableHeader", "hardBreak", "text"] as const;
const markTypes = ["bold", "italic", "strike", "code", "underline", "link"] as const;
const attrs = z.record(z.string().max(40), z.union([z.string().max(2048), z.number(), z.boolean(), z.null()]));
const nodeAttrs = z.record(z.string().max(40), z.union([z.string().max(2048), z.number(), z.boolean(), z.null(),
  z.array(z.number().int().min(0).max(10_000)).max(100)]));
export const nodeSchema: z.ZodType<JSONContent> = z.object({
  type: z.enum(blockTypes),
  text: z.string().min(1).max(250_000).optional(),
  attrs: nodeAttrs.optional(),
  marks: z.array(z.object({ type: z.enum(markTypes), attrs: attrs.optional() })).max(8).optional(),
  get content() { return z.array(nodeSchema).max(5_000).optional(); },
});
export const blockSchema = z.object({ id: idSchema, pageId: idSchema, position: stamp, node: nodeSchema });
export type Block = z.infer<typeof blockSchema>;
const topLevel = new Set(["paragraph", "heading", "blockquote", "bulletList", "orderedList", "taskList", "codeBlock", "horizontalRule", "table"]);

function validBlock(node: JSONContent, depth = 0): boolean {
  if (depth > 36 || !node.type) return false;
  const children = node.content ?? [];
  const every = (...types: string[]) => children.every((child) => !!child.type && types.includes(child.type));
  if (node.type !== "text" && (node.text !== undefined || node.marks?.length)) return false;
  if (Object.entries(node.attrs ?? {}).some(([key, value]) => Array.isArray(value) &&
      (key !== "colwidth" || !["tableCell", "tableHeader"].includes(node.type!)))) return false;
  switch (node.type) {
    case "paragraph":
    case "heading":
      if (!every("text", "hardBreak")) return false;
      if (node.type === "heading" && node.attrs?.level !== undefined &&
        (!Number.isInteger(node.attrs.level) || node.attrs.level < 1 || node.attrs.level > 6)) return false;
      break;
    case "text":
      return children.length === 0 && typeof node.text === "string" && !!node.text;
    case "horizontalRule":
    case "hardBreak":
      return children.length === 0;
    case "codeBlock":
      if (!every("text") || children.some((child) => child.marks?.length)) return false;
      break;
    case "blockquote":
      if (!children.length || !every(...topLevel)) return false;
      break;
    case "bulletList":
    case "orderedList":
      if (!children.length || !every("listItem")) return false;
      break;
    case "taskList":
      if (!children.length || !every("taskItem")) return false;
      break;
    case "table":
      if (!children.length || !every("tableRow")) return false;
      break;
    case "tableRow":
      if (!children.length || !every("tableCell", "tableHeader")) return false;
      break;
    case "tableCell":
    case "tableHeader":
      if (!children.length || !every(...topLevel)) return false;
      if (["colspan", "rowspan"].some((key) => {
        const size = node.attrs?.[key];
        return size !== undefined && (!Number.isInteger(size) || size < 1 || size > 100);
      })) return false;
      if (node.attrs?.colwidth != null && !Array.isArray(node.attrs.colwidth)) return false;
      break;
    case "listItem":
    case "taskItem":
      if (children[0]?.type !== "paragraph" || !every(...topLevel)) return false;
      if (node.type === "taskItem" && node.attrs?.checked !== undefined && typeof node.attrs.checked !== "boolean") return false;
      break;
    default: return false;
  }
  return children.every((child) => validBlock(child, depth + 1));
}

function hasValidBlockContent(node: JSONContent) {
  return !!node.type && topLevel.has(node.type) && validBlock(node);
}

export const propertySchema = z.object({ id: idSchema, name: titleSchema, type: z.enum(["text", "number", "checkbox", "date"]) });
export type Property = z.infer<typeof propertySchema>;
export const databaseSchema = z.object({ id: idSchema, name: titleSchema, properties: z.array(propertySchema).max(24) });
export type Database = z.infer<typeof databaseSchema>;
export const taskSchema = z.object({
  id: idSchema, databaseId: idSchema, title: titleSchema, status: z.enum(statuses), priority: z.enum(priorities),
  due: dateSchema.or(z.literal("")), tags: z.array(z.string().trim().min(1).max(40)).max(20),
  pageId: idSchema.nullable(), properties: z.record(idSchema, z.union([z.string().max(2_000), z.number(), z.boolean()])),
  createdAt: stamp, updatedAt: stamp, revision: stamp,
});
export type Task = z.infer<typeof taskSchema>;

export const backupSchema = z.object({
  format: z.enum([workspaceNamespace, legacyWorkspaceNamespace]).transform(() => workspaceNamespace), version: z.literal(1),
  pages: z.array(pageSchema).max(10_000), blocks: z.array(blockSchema).max(100_000),
  databases: z.array(databaseSchema).max(100), tasks: z.array(taskSchema).max(50_000),
});
export type Backup = z.infer<typeof backupSchema>;

export const mainDatabaseId = "tasks";
export const uid = () => crypto.randomUUID();
export const today = (offset = 0, now = new Date()) => {
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
export const asDate = (value: string) => new Date(`${value}T12:00:00`);
export const textNode = (text: string): JSONContent => ({ type: "text", text });
export const paragraph = (text: string): JSONContent => ({ type: "paragraph", content: text ? [textNode(text)] : [] });
export const nodeText = (node: JSONContent): string => node.text ?? (node.content ?? []).map(nodeText).join(node.type === "paragraph" || node.type === "heading" ? "" : " ");
export const splitTags = (value: string) => [...new Set(value.split(",").map((s) => s.trim().slice(0, 40)).filter(Boolean))].slice(0, 20);

export function recordsFor(pageId: string, doc: JSONContent): Block[] {
  if (doc.type !== "doc" || (doc.content?.length ?? 0) > 5_000) throw new Error("Invalid or oversized document.");
  return (doc.content ?? []).map((raw, position) => {
    const node = nodeSchema.parse(raw);
    if (!hasValidBlockContent(node)) throw new Error("This block has an invalid or excessively nested structure.");
    const nodeId = idSchema.safeParse(node.attrs?.id);
    const id = nodeId.success ? nodeId.data : uid();
    return { id, pageId, position, node: { ...node, attrs: { ...node.attrs, id } } };
  });
}

export function isDescendant(pages: Page[], childId: string, ancestorId: string) {
  const byId = new Map(pages.map((page) => [page.id, page]));
  return wouldCycle(byId, childId, ancestorId);
}

function wouldCycle(byId: Map<string, Page>, childId: string, ancestorId: string) {
  const visited = new Set<string>();
  for (let next: string | null = childId; next; next = byId.get(next)?.parentId ?? null) {
    if (next === ancestorId || visited.has(next)) return true;
    visited.add(next);
  }
  return false;
}

export function validateBackup(input: unknown): Backup {
  const backup = backupSchema.parse(input);
  const unique = <T>(items: T[], key: (item: T) => string) => {
    const keys = new Set(items.map(key));
    if (keys.size !== items.length) throw new Error("Backup contains duplicate records.");
    return keys;
  };
  const pages = unique(backup.pages, (p) => p.id);
  const dbs = unique(backup.databases, (d) => d.id);
  if (!dbs.has(mainDatabaseId)) throw new Error("Backup is missing the primary task database.");
  unique(backup.tasks, (t) => t.id);
  unique(backup.blocks, (b) => `${b.pageId}/${b.id}`);
  unique(backup.blocks, (b) => `${b.pageId}/${b.position}`);
  const byId = new Map(backup.pages.map((page) => [page.id, page]));
  const checked = new Set<string>();
  for (const page of backup.pages) {
    const chain = new Set<string>();
    let cursor: Page | undefined = page;
    while (cursor && !checked.has(cursor.id)) {
      if (chain.has(cursor.id)) throw new Error("Backup contains a page hierarchy cycle.");
      chain.add(cursor.id);
      cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
    }
    chain.forEach((id) => checked.add(id));
    if ((page.parentId && !pages.has(page.parentId)) || page.links.some((id) => !pages.has(id))) {
      throw new Error("Backup contains a missing page relationship.");
    }
  }
  if (backup.blocks.some((b) => byId.get(b.pageId)?.kind !== "page" || b.node.attrs?.id !== b.id || !hasValidBlockContent(b.node))) throw new Error("Backup contains invalid page blocks.");
  const properties = new Map(backup.databases.map((d) => {
    unique(d.properties, (p) => p.id);
    return [d.id, new Map(d.properties.map((p) => [p.id, p.type]))];
  }));
  for (const task of backup.tasks) {
    if (!dbs.has(task.databaseId) || (task.pageId && !pages.has(task.pageId))) throw new Error("Backup contains an orphaned task.");
    for (const [key, value] of Object.entries(task.properties)) {
      const type = properties.get(task.databaseId)?.get(key);
      if (!(type === "checkbox" ? typeof value === "boolean" : type === "number" ? typeof value === "number"
        : type === "text" ? typeof value === "string" : type === "date" && dateSchema.safeParse(value).success)) {
        throw new Error("Backup contains an invalid custom property value.");
      }
    }
  }
  return backup;
}
