import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GET, POST } from "./route";

const token = "test-key-only";
const host = "127.0.0.1:3000";
const upstream = () => new Response("data: [DONE]\n\n", { headers: { "Content-Type": "text/event-stream" } });
const request = (hostname = host, origin = `http://${hostname}`, extra?: Record<string, string>) => new Request(`${origin}/api/agent`, {
  method: "POST",
  headers: { host: hostname, origin, "content-type": "application/json", "sec-fetch-site": "same-origin", ...extra },
  body: JSON.stringify({ billing: "api", messages: [{ role: "user", content: "Which tasks are open?" }] }),
});

beforeEach(() => {
  vi.stubEnv("OPENAI_API_KEY", token);
  vi.stubEnv("GODSPEED_OPENAI_MODEL", "test-model");
  vi.stubEnv("GODSPEED_APP_ORIGIN", "");
  vi.stubEnv("GODSPEED_AI_INGRESS_SECRET", "");
  vi.stubEnv("ATLAS_OPENAI_MODEL", "");
  vi.stubEnv("ATLAS_APP_ORIGIN", "");
  vi.stubEnv("ATLAS_AI_INGRESS_SECRET", "");
  vi.stubGlobal("fetch", vi.fn().mockImplementation(upstream));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it("uses the server credential only on the fixed upstream and streams without caching", async () => {
  const res = await POST(request());
  expect(res.ok).toBe(true);
  expect(res.headers.get("cache-control")).toBe("no-store");
  expect(res.headers.get("x-godspeed-model")).toBe("test-model");
  expect(await res.text()).not.toContain(token);
  const fetchMock = vi.mocked(fetch);
  const [url, options] = fetchMock.mock.calls[0];
  expect(url).toBe("https://api.openai.com/v1/chat/completions");
  expect(options?.headers).toMatchObject({ Authorization: `Bearer ${token}` });
  expect(JSON.parse(String(options?.body))).toMatchObject({
    model: "test-model", stream: true, store: false,
    messages: expect.arrayContaining([expect.objectContaining({ role: "developer", content: expect.stringContaining("You are Godspeed") })]),
  });
  const info = await GET(new Request(`http://${host}/api/agent`, { headers: { host } }));
  expect(await info.json()).toMatchObject({ configured: true, provider: "openai", model: "test-model",
    models: expect.arrayContaining([{ slug: "gpt-6-luna", label: "GPT-6 Luna" }]),
  });
});

it("rejects cross-origin calls and requires authenticated ingress on a remote deployment", async () => {
  expect((await POST(request(host, "https://elsewhere.test"))).status).toBe(403);
  expect((await POST(request(host, `http://${host}`, { "sec-fetch-site": "cross-site" }))).status).toBe(403);
  expect((await POST(request("workspace.test", "https://workspace.test"))).status).toBe(403);
  const ingress = "not-a-real-secret-just-a-test-fixture";
  vi.stubEnv("GODSPEED_APP_ORIGIN", "https://workspace.test");
  vi.stubEnv("GODSPEED_AI_INGRESS_SECRET", ingress);
  expect((await POST(request())).status).toBe(403);
  expect((await POST(request("workspace.test", "https://workspace.test"))).status).toBe(403);
  expect(fetch).not.toHaveBeenCalled();
  expect((await POST(request("workspace.test", "https://workspace.test", { "x-atlas-ingress": ingress }))).status).toBe(403);
  expect((await POST(request("workspace.test", "https://workspace.test", { "x-godspeed-ingress": ingress }))).status).toBe(200);
});

it("keeps legacy deployments working without mixing old and new ingress settings", async () => {
  const origin = "https://workspace.test";
  const ingress = "not-a-real-secret-just-a-test-fixture";
  const make = () => request("workspace.test", origin, { "x-atlas-ingress": ingress, "x-godspeed-ingress": ingress });
  vi.stubEnv("ATLAS_APP_ORIGIN", origin);
  vi.stubEnv("ATLAS_AI_INGRESS_SECRET", ingress);
  vi.stubEnv("ATLAS_OPENAI_MODEL", "previous-model");
  vi.stubEnv("GODSPEED_OPENAI_MODEL", "");
  expect((await POST(make())).status).toBe(200);
  expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body)).model).toBe("previous-model");
  vi.stubEnv("GODSPEED_APP_ORIGIN", origin);
  expect((await POST(make())).status).toBe(403);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("never falls back to the server API key for an unauthenticated ChatGPT plan request", async () => {
  const req = new Request(`http://${host}/api/agent`, {
    method: "POST", headers: { host, origin: `http://${host}`, "content-type": "application/json" },
    body: JSON.stringify({ billing: "chatgpt", account: "oaiapp_fixture", messages: [{ role: "user", content: "What is due?" }] }),
  });
  expect((await POST(req)).status).toBe(401);
  expect(fetch).not.toHaveBeenCalled();
});

it("defaults the API-key model to Luna with tool-compatible reasoning disabled", async () => {
  vi.stubEnv("GODSPEED_OPENAI_MODEL", "");
  const result = await POST(request());
  expect(result.headers.get("x-godspeed-model")).toBe("gpt-6-luna");
  const [, options] = vi.mocked(fetch).mock.calls[0];
  expect(JSON.parse(String(options?.body))).toMatchObject({ model: "gpt-6-luna", reasoning: { effort: "none" } });
});

it("offers bounded web search by default and validates explicit API model selection", async () => {
  const chat = (model: string, webSearch?: boolean) => new Request(`http://${host}/api/agent`, {
    method: "POST", headers: { host, origin: `http://${host}`, "content-type": "application/json" },
    body: JSON.stringify({ billing: "api", model, webSearch, messages: [{ role: "user", content: "Check the latest guidance" }] }),
  });
  expect((await POST(chat("unlisted-model"))).status).toBe(409);
  expect(fetch).not.toHaveBeenCalled();
  expect((await POST(chat("gpt-5.6-luna"))).headers.get("x-godspeed-model")).toBe("gpt-5.6-luna");
  expect((await POST(chat("gpt-5.6-luna", false))).ok).toBe(true);
  const [[url, first], [, next]] = vi.mocked(fetch).mock.calls;
  expect(url).toBe("https://api.openai.com/v1/responses");
  expect(JSON.parse(String(first?.body))).toMatchObject({ max_tool_calls: 3, store: false, tools: expect.arrayContaining([
    { type: "web_search", search_context_size: "low" },
  ]) });
  expect(JSON.parse(String(next?.body)).tools.map((tool: { type: string }) => tool.type)).toEqual(["namespace"]);
});
