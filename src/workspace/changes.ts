import { z } from "zod";
import { dateSchema, idSchema, priorities, statuses, titleSchema, type Block, type Page, type Task } from "./model";

const body = z.string().trim().min(1).max(12_000);
const input = [
  z.object({ kind: z.literal("create_page"), parentId: idSchema.nullable().default(null), title: titleSchema, text: body.optional() }),
  z.object({ kind: z.literal("append_page"), pageId: idSchema, text: body }),
  z.object({ kind: z.literal("rename_page"), pageId: idSchema, title: titleSchema }),
  z.object({ kind: z.literal("create_task"), title: titleSchema, due: dateSchema.optional(), pageId: idSchema.nullable().optional(), databaseId: idSchema.optional() }),
  z.object({ kind: z.literal("update_task"), taskId: idSchema, title: titleSchema.optional(), status: z.enum(statuses).optional(), priority: z.enum(priorities).optional(), due: dateSchema.or(z.literal("")).optional() }),
] as const;
export const actionSchema = z.discriminatedUnion("kind", input);
export type Action = z.infer<typeof actionSchema>;
export type Proposal = {
  id: string; action: Action; label: string; before: string; after: string; workspaceId: string; revision?: number;
};
export type Receipt = {
  proposalId: string; workspaceId: string; revision: number;
} & (
  | { type: "page"; id: string; before?: Page; blocks?: Block[] }
  | { type: "task"; id: string; before?: Task }
);
