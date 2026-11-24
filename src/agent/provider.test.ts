import { afterEach, describe, expect, it, vi } from "vitest";
import { apiProvider } from "./responses-provider";

const openAIProvider = apiProvider();

const event = (delta: object, finish_reason: string | null = null) =>
  `data: ${JSON.stringify({ choices: [{ delta, finish_reason }] })}\r\n\r\n`;
const stream = (text: string) => {
  const bytes = new TextEncoder().encode(text);
  return new Response(new ReadableStream({
    start(controller) {
      for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7));
      controller.close();
    },
  }), { headers: { "Content-Type": "text/event-stream", "X-Godspeed-Protocol": "chat-completions" } });
};

describe("provider streaming", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("streams UTF-8 text and reassembles fragmented function arguments", async () => {
    const calls = (value: object) => ({ tool_calls: [{ index: 0, ...value }] });
    const mock = vi.fn().mockResolvedValue(stream(
      event({ content: "Looking…" }) +
      event(calls({ id: "call_1", function: { name: "workspace_search", arguments: "{\"que" } })) +
      event(calls({ function: { arguments: "ry\":\"brief\"}" } })) +
      event({}, "tool_calls") + "data: [DONE]\r\n\r\n",
    ));
    vi.stubGlobal("fetch", mock);
    const update = vi.fn();
    const result = await openAIProvider.complete([{ role: "user", content: "Find the project." }], new AbortController().signal, update);
    expect(update).toHaveBeenCalledWith("Looking…");
    expect(result).toEqual({
      text: "Looking…", calls: [{ id: "call_1", type: "function", function: { name: "workspace_search", arguments: '{"query":"brief"}' } }],
    });
    expect(mock.mock.calls[0][0]).toBe("/api/agent");
  });

  it("rejects an incomplete provider stream rather than reporting success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(stream(event({ content: "Partial" }))));
    await expect(openAIProvider.complete([{ role: "user", content: "Explain the brief" }], new AbortController().signal, () => {}))
      .rejects.toThrow(/stream ended unexpectedly/);
  });
});
