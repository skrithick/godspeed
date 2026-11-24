import { z } from "zod";
import { modelHeader, protocolHeader, validModelName } from "./model-policy";
import { readChatCompletions, type Provider, type ToolCall } from "./provider";
import type { WebCitation } from "./types";
import { publicWebLink } from "../workspace/web-link";

export const reasoningItem = z.object({
  type: z.literal("reasoning"), id: z.string().min(1).max(200), encrypted_content: z.string().min(1).max(28_000),
  summary: z.array(z.object({ type: z.literal("summary_text"), text: z.string().max(2400) })).max(6).optional(),
});
export type ReasoningItem = z.infer<typeof reasoningItem>;

export function planError(code: string | undefined, status?: number) {
  if (code === "subscription_sharing_usage_limit_exceeded" || status === 429) return "ChatGPT plan usage limit reached. Review the applicable limit in ChatGPT Usage.";
  if (code === "subscription_sharing_user_not_eligible") return "This ChatGPT account or workspace is not eligible to share its plan.";
  if (code === "subscription_sharing_unsupported_capability") return "The selected ChatGPT model does not support this request.";
  if (status === 401 || code === "subscription_sharing_invalid_user") return "ChatGPT could not validate this connection. Reconnect in Settings.";
  if (status === 403) return "This ChatGPT account or workspace does not allow the request.";
  if (status === 503 || code === "subscription_sharing_usage_unavailable") return "ChatGPT plan usage is temporarily unavailable. Try again later.";
  return "ChatGPT could not complete this response. Try again or use a narrower request.";
}

const functionItem = z.object({
  type: z.literal("function_call"), call_id: z.string().min(1).max(200), name: z.string().min(1).max(80), arguments: z.string().max(24_000),
});
const responseEvent = z.object({
  type: z.string(), delta: z.string().optional(), text: z.string().optional(), refusal: z.string().optional(),
  output_index: z.number().int().min(0).max(99).optional(), content_index: z.number().int().min(0).max(49).optional(),
  item: z.unknown().optional(), part: z.unknown().optional(), code: z.string().nullish(),
  response: z.object({ error: z.object({ code: z.string().nullish() }).nullish(), output: z.array(z.unknown()).max(100).optional() }).optional(),
});

const citation = z.object({ type: z.literal("url_citation"), url: z.string().max(2048), title: z.string().max(500).optional() });
const outputMessage = z.object({ type: z.literal("message"), content: z.array(z.unknown()).max(50) });
const contentPart = z.object({ type: z.string(), text: z.string().nullish(), refusal: z.string().nullish(), annotations: z.array(z.unknown()).optional() });

function readPart(value: unknown) {
  const part = contentPart.safeParse(value).data;
  if (!part) return;
  if (part.type === "output_text") return { text: part.text ?? "", annotations: part.annotations ?? [] };
  if (part.type === "refusal") return { text: part.refusal ?? "", annotations: [] };
}

const responsesProvider = (billing: "chatgpt" | "api", account?: string, model?: string): Provider => ({
  async complete(messages, signal, onText, webSearch = true) {
    const reply = await fetch("/api/agent", { method: "POST", signal, cache: "no-store",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ billing, account, model, messages, webSearch }) });
    if (!reply.ok || !reply.body) {
      const data = await reply.json().catch(() => null);
      throw new Error(typeof data?.error === "string" ? data.error : planError(undefined, reply.status));
    }
    if (billing === "api" && reply.headers.get(protocolHeader) === "chat-completions") return readChatCompletions(reply, onText);
    const reader = reply.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "", text = "", received = 0;
    const finishedItems = new Map<number, unknown>();
    const parts = new Map<number, NonNullable<ReturnType<typeof readPart>>>();
    const recordPart = (key: number, part: ReturnType<typeof readPart>) => {
      if (!part) return;
      const prior = parts.get(key);
      parts.set(key, { text: part.text || prior?.text || "", annotations: part.annotations.length ? part.annotations : prior?.annotations ?? [] });
    };
    const recordMessage = (index: number, item: unknown) => {
      const message = outputMessage.safeParse(item).data;
      message?.content.forEach((part, i) => recordPart(index * 50 + i, readPart(part)));
    };
    try {
      while (true) {
        const { value, done } = await reader.read();
        received += value?.byteLength ?? 0;
        if (received > 4_000_000) throw new Error("ChatGPT response exceeded the size limit.");
        buffer += done ? decoder.decode() + "\n" : decoder.decode(value, { stream: true });
        if (buffer.length > 1_500_000) throw new Error("ChatGPT response exceeded the size limit.");
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (!data || data === "[DONE]") continue;
          const event = responseEvent.parse(JSON.parse(data));
          const partKey = (event.output_index ?? 0) * 50 + (event.content_index ?? 0);
          if ((event.type === "response.output_text.delta" || event.type === "response.refusal.delta") && event.delta) {
            text += event.delta;
            if (text.length > 32_000) throw new Error("ChatGPT response exceeded the size limit.");
            recordPart(partKey, { text: (parts.get(partKey)?.text ?? "") + event.delta, annotations: [] });
            onText(text);
          } else if (event.type === "response.output_text.done" || event.type === "response.refusal.done") {
            recordPart(partKey, { text: event.text ?? event.refusal ?? "", annotations: [] });
          } else if (event.type === "response.content_part.done") {
            recordPart(partKey, readPart(event.part));
          } else if (event.type === "response.output_item.done" && event.output_index !== undefined && event.item) {
            finishedItems.set(event.output_index, event.item);
            recordMessage(event.output_index, event.item);
          } else if (event.type === "response.completed") {
            const calls: ToolCall[] = [];
            const reasoning: ReasoningItem[] = [];
            const citations = new Map<string, WebCitation>();
            let searched = false;
            const items = new Map(finishedItems);
            event.response?.output?.forEach((item, index) => items.set(index, item));
            for (const [index, item] of items) {
              if (typeof item === "object" && item && "type" in item && item.type === "web_search_call") searched = true;
              recordMessage(index, item);
              const call = functionItem.safeParse(item);
              if (call.success) {
                const { call_id, name, arguments: args } = call.data;
                calls.push({ id: call_id, type: "function", function: { name: name.replace(/^workspace\./, ""), arguments: args } });
              } else {
                const thought = reasoningItem.safeParse(item);
                if (thought.success) reasoning.push(thought.data);
                else if (typeof item === "object" && item && "type" in item && item.type === "function_call") throw new Error("ChatGPT returned an invalid workspace tool call.");
              }
            }
            if (calls.length > 10) throw new Error("ChatGPT returned too many workspace calls.");
            const ordered = [...parts.entries()].sort(([a], [b]) => a - b);
            for (const [, part] of ordered) for (const raw of part.annotations.slice(0, 200)) {
              const parsed = citation.safeParse(raw);
              if (!parsed.success || citations.size >= 16) continue;
              const url = publicWebLink(parsed.data.url);
              if (url && !citations.has(url)) citations.set(url, { url, title: parsed.data.title?.trim() || new URL(url).hostname });
            }
            const completedText = ordered.map(([, part]) => part.text).filter((part) => part.trim()).join("\n\n").slice(0, 32_000);
            return { text: completedText || text, calls, reasoning: reasoning.slice(-2),
              model: validModelName(reply.headers.get(modelHeader)), webCitations: [...citations.values()], searched };
          } else if (["response.failed", "response.incomplete", "error"].includes(event.type)) {
            const code = event.response?.error?.code ?? event.code ?? undefined;
            if (billing === "api") throw new Error("OpenAI could not complete this response. Check the configured model, access, and usage limits.");
            throw new Error(webSearch && code === "subscription_sharing_unsupported_capability"
              ? "Web search is not available for this ChatGPT model or account." : planError(code));
          }
        }
        if (done) throw new Error("The ChatGPT stream ended before completing the response.");
      }
    } finally { await reader.cancel().catch(() => {}); }
  },
});

export const chatGPTProvider = (account: string, model?: string) => responsesProvider("chatgpt", account, model);
export const apiProvider = (model?: string) => responsesProvider("api", undefined, model);
