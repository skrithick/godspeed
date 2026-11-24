import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { expect, it, vi } from "vitest";
import { beginChatGPT, chatGPTAccess, chatGPTModel, chatGPTStatus, disconnectChatGPT, finishChatGPT, newBrowser, resource } from "./chatgpt";

it("binds the OAuth callback to its browser, verifies the identity, and refreshes and revokes server-side", async () => {
  const parent = process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "Temp", "opencode") : tmpdir();
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(join(parent, "godspeed-oauth-"));
  vi.stubEnv("LOCALAPPDATA", directory);
  try {
    const origin = "http://127.0.0.1:3147";
    const browser = newBrowser();
    const client = "oaiapp_fixture";
    const issuer = "https://auth.openai.com";
    const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
    const jwk = await exportJWK(publicKey);
    let nonce = "";
    let subject = "test-account";
    let rejectNonce = false;
    let refreshes = 0;
    let revocations = 0;
    let allowed = true;
    const tokenScopes = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
    const fakeFetch = vi.fn(async (url: string | URL | Request, options?: RequestInit) => {
      const endpoint = String(url);
      if (endpoint === `${issuer}/.well-known/jwks.json`) return Response.json({ keys: [{ ...jwk, kid: "fixture", alg: "RS256" }] });
      if (endpoint === `${issuer}/api/accounts/oauth/token`) {
        const body = options?.body as URLSearchParams;
        expect(body.get("client_id")).toBe(client);
        expect(body.get("resource")).toBe(resource);
        if (body.get("grant_type") === "refresh_token") {
          expect(body.get("refresh_token")).toBe("fake-refresh");
          refreshes++;
          return Response.json({ access_token: "fake-renewed", refresh_token: "fake-rotated", expires_in: 3600, token_type: "Bearer" });
        }
        expect(body.get("redirect_uri")).toBe(`${origin}/api/chatgpt`);
        expect(body.get("code_verifier")).toHaveLength(43);
        const id = await new SignJWT({ nonce: rejectNonce ? "wrong" : nonce, email: "demo@example.com" })
          .setProtectedHeader({ alg: "RS256", kid: "fixture" }).setIssuer(issuer).setAudience(client).setSubject(subject).setExpirationTime("5m").sign(privateKey);
        return Response.json({ id_token: id, access_token: "fake-access", refresh_token: "fake-refresh",
          expires_in: 30, token_type: "Bearer", scope: allowed ? tokenScopes : "openid profile email" });
      }
      if (endpoint === `${issuer}/api/accounts/oauth/revoke`) {
        expect((options?.body as URLSearchParams).get("token")).toMatch(/^fake-(rotated|refresh)$/);
        revocations++;
        return new Response(null, { status: 200 });
      }
      if (endpoint === `${resource}/models`) return Response.json({ models: [
        { slug: "gpt-6.2-sol", visibility: "list" }, { slug: "gpt-5.6-luna", visibility: "list" }, { slug: "gpt-6-luna", visibility: "list" },
      ] });
      throw new Error("Unexpected network request");
    });
    vi.stubGlobal("fetch", fakeFetch);
    const start = async (selected?: string) => {
      const url = new URL(await beginChatGPT(origin, browser, selected));
      nonce = url.searchParams.get("nonce")!;
      return { url, callback: new URLSearchParams({ state: url.searchParams.get("state")!, code: "test-code", ...(!selected ? { client_id: client } : {}) }) };
    };
    const first = await start();
    expect(first.url.searchParams.get("client_id")).toBe("dynamic_agent_client");
    expect(first.url.searchParams.get("scope")).toContain("chatgpt.tokens.use.direct");
    expect(first.url.searchParams.get("ext_agent_host_id")).toMatch(/^urn:uuid:/);
    const host = first.url.searchParams.get("ext_agent_host_id");
    expect(await finishChatGPT(origin, newBrowser(), first.callback)).toBe("failed");
    expect(fakeFetch).not.toHaveBeenCalled();
    rejectNonce = true;
    expect(await finishChatGPT(origin, browser, first.callback)).toBe("failed");
    expect((await chatGPTStatus(origin, browser)).configured).toBe(false);
    rejectNonce = false;
    const second = await start();
    expect(second.url.searchParams.get("ext_agent_host_id")).toBe(host);
    expect(await finishChatGPT(origin, browser, second.callback)).toBe("welcome");
    expect(await finishChatGPT(origin, browser, second.callback)).toBe("failed");
    const status = await chatGPTStatus(origin, browser);
    expect(status).toMatchObject({ configured: true, email: "demo@example.com", selected: client });
    expect(JSON.stringify(status)).not.toContain("fake-access");
    expect((await chatGPTStatus(origin, newBrowser())).configured).toBe(false);
    expect(await chatGPTAccess(origin, browser, "oaiapp_wrong")).toBeNull();
    const [access, concurrent] = await Promise.all([chatGPTAccess(origin, browser, client), chatGPTAccess(origin, browser, client)]);
    expect(access).toEqual(concurrent);
    expect(refreshes).toBe(1);
    expect(await chatGPTModel(access!, new AbortController().signal)).toBe("gpt-6-luna");
    expect(await chatGPTModel(access!, new AbortController().signal, "gpt-5.6-luna")).toBe("gpt-5.6-luna");
    expect(await chatGPTModel(access!, new AbortController().signal, "unlisted-model")).toBeNull();
    expect(await disconnectChatGPT(origin, browser)).toBe(true);
    expect(revocations).toBe(1);
    expect(await chatGPTAccess(origin, browser, client)).toBeNull();
    const returning = await start(client);
    expect(returning.url.searchParams.get("client_id")).toBe(client);
    expect(returning.url.searchParams.has("id_token_hint")).toBe(false);
    subject = "different-account";
    expect(await finishChatGPT(origin, browser, returning.callback)).toBe("failed");
    subject = "test-account";
    allowed = false;
    expect(await finishChatGPT(origin, browser, (await start(client)).callback)).toBe("permission");
    expect(await chatGPTAccess(origin, browser, client)).toBeNull();
    allowed = true;
    const consent = await start(client);
    expect(consent.url.searchParams.get("prompt")).toBe("consent");
    expect(await finishChatGPT(origin, browser, consent.callback)).toBe("connected");
  } finally {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  }
});
