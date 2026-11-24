import type { Proposal, Receipt } from "../workspace/changes";

export type Source = { id: string; title: string; kind: "page" | "task"; blockId?: string };
export type WebCitation = { url: string; title: string };
export type Step = {
  id: string;
  tool: string;
  summary: string;
  input: unknown;
  output: unknown;
  sources: Source[];
  error?: boolean;
};
export type Run = {
  id: string;
  model?: string;
  research?: boolean;
  webCitations?: WebCitation[];
  threadId?: string;
  prompt: string;
  context?: Context;
  startedAt: number;
  status: "running" | "complete" | "error" | "cancelled";
  answer: string;
  steps: Step[];
  proposals: Proposal[];
  receipts: Receipt[];
  undone: string[];
};
export type Context = { pageId?: string; taskId?: string; databaseId?: string; selectedText?: string };
