import type { Message } from "../agent/provider";
import { usesMinimalReasoning } from "../agent/model-policy";
import { toolDefinitions } from "../agent/tools";

export function responsesRequest(messages: readonly Message[], model: string, instructions: string, webSearch = false) {
  const input: unknown[] = [];
  const minimal = usesMinimalReasoning(model);
  for (const message of messages) {
    if (message.role === "tool") {
      input.push({ type: "function_call_output", call_id: message.tool_call_id, output: message.content });
    } else {
      if (!minimal && message.role === "assistant" && message.tool_calls) input.push(...(message.reasoning ?? []));
      if (message.content) input.push({ type: "message", role: message.role, content: message.content });
      if (message.role === "assistant") for (const call of message.tool_calls ?? []) {
        input.push({ type: "function_call", namespace: "workspace", call_id: call.id, name: call.function.name, arguments: call.function.arguments });
      }
    }
  }
  return {
    model, instructions, input, store: false, stream: true,
    ...(minimal ? { reasoning: { effort: "none" } } : { include: ["reasoning.encrypted_content"] }),
    tools: [{ type: "namespace", name: "workspace", description: "Read and propose local workspace changes.",
      tools: toolDefinitions.map(({ function: definition }) => ({ type: "function", ...definition })) },
      ...(webSearch ? [{ type: "web_search", search_context_size: "low" }] : [])],
  };
}
