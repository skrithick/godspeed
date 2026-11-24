import { z } from "zod";
import { modelHeader, validModelName } from "./model-policy";
import type { ReasoningItem } from "./responses-provider";
import type { WebCitation } from "./types";

export type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
export type Message = { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[]; reasoning?: ReasoningItem[] }
  | { role: "tool"; tool_call_id: string; content: string };
export interface Provider {
  complete(messages: Message[], signal: AbortSignal, onText: (text: string) => void, webSearch?: boolean): Promise<{
    text: string; calls: ToolCall[]; reasoning?: ReasoningItem[]; model?: string; webCitations?: WebCitation[]; searched?: boolean;
  }>;
}

const eventSchema = z.object({
  error: z.unknown().optional(),
  choices: z.array(z.object({
    finish_reason: z.string().nullable().optional(),
    delta: z.object({
      content: z.string().nullable().optional(),
      tool_calls: z.array(z.object({
        index: z.number().int().min(0).max(9), id: z.string().optional(),
        function: z.object({ name: z.string().optional(), arguments: z.string().optional() }).optional(),
      })).optional(),
    }),
  })).optional(),
});

export async function readChatCompletions(res: Response, onText: (text: string) => void) {
    if (!res.body) throw new Error("The provider is unavailable.");
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const calls = new Map<number, ToolCall>();
    let buffer = "", text = "", finished = false;
    let reason = "";
    try {
      while (!finished) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        if (buffer.length > 250_000) throw new Error("Provider event exceeded the size limit.");
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (data === "[DONE]") { finished = true; break; }
          const event = eventSchema.parse(JSON.parse(data));
          if (event.error) throw new Error("The provider stopped with an error.");
          const choice = event.choices?.[0];
          if (!choice) continue;
          reason = choice.finish_reason || reason;
          if (choice.delta.content) {
            text += choice.delta.content;
            if (text.length > 32_000) throw new Error("Provider output exceeded the size limit.");
            onText(text);
          }
          for (const call of choice.delta.tool_calls ?? []) {
            const current = calls.get(call.index) ?? { id: "", type: "function", function: { name: "", arguments: "" } };
            current.id += call.id ?? "";
            current.function.name += call.function?.name ?? "";
            current.function.arguments += call.function?.arguments ?? "";
            if (current.function.arguments.length > 24_000) throw new Error("Provider tool arguments exceeded the size limit.");
            calls.set(call.index, current);
          }
        }
      }
      if (!finished) throw new Error("The provider stream ended unexpectedly. Try again.");
      if (reason === "length" || reason === "content_filter") throw new Error("The provider could not finish this request. Try a narrower request.");
      const result = [...calls.entries()].sort(([a], [b]) => a - b).map(([, call]) => call);
      if (result.some((call) => !call.id || !call.function.name)) throw new Error("The provider sent an incomplete tool call.");
      return { text, calls: result, model: validModelName(res.headers.get(modelHeader)) };
    } finally {
      await reader.cancel().catch(() => {});
    }
}
