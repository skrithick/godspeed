import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { z } from "zod";
import { chooseBudgetModel, modelLabel, validModelName, type ModelOption } from "../agent/model-policy";

const issuer = "https://auth.openai.com";
export const resource = "https://api.openai.com/v1";
const tokenEndpoint = `${issuer}/api/accounts/oauth/token`;
const scope = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
export const browserCookie = "godspeed-chatgpt-session";
const opaque = /^[A-Za-z0-9_-]{43}$/;
const clientIdSchema = z.string().regex(/^oaiapp_[A-Za-z0-9_-]{1,180}$/);
const hostSchema = z.string().regex(/^urn:uuid:[0-9a-f-]{36}$/);
const secret = () => randomBytes(32).toString("base64url");
const folder = () => join(process.env.LOCALAPPDATA || process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "Godspeed", "chatgpt");
const maxProfiles = 12;
const jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
const credentialsSchema = z.object({
  access: z.string().min(1), refresh: z.string().min(1).optional(), idToken: z.string().min(1),
  expires: z.number().int(), scopes: z.array(z.string()),
});
const profileSchema = z.object({
  clientId: clientIdSchema, subject: z.string().min(1), email: z.string().max(320).optional(),
  credentials: credentialsSchema.optional(), welcomed: z.boolean().optional(),
});
const recordSchema = z.object({ selected: clientIdSchema.optional(), profiles: z.array(profileSchema).max(maxProfiles) });
type RecordFile = z.infer<typeof recordSchema>;
type Profile = z.infer<typeof profileSchema>;
type Attempt = { key: string; state: string; nonce: string; verifier: string; callback: string; expires: number; profile?: Profile };
const processState = globalThis as typeof globalThis & {
  godspeedChatGPT?: { attempts: Map<string, Attempt>; locks: Map<string, Promise<unknown>>; models: Map<string, { options: ModelOption[]; until: number }> };
};
const state: NonNullable<typeof processState.godspeedChatGPT> = processState.godspeedChatGPT ??= {
  attempts: new Map(), locks: new Map(), models: new Map(),
};

export function chatGPTOrigin(req: Request) {
  const host = req.headers.get("host") ?? "";
  if (!/^127\.0\.0\.1(?::\d{1,5})?$/.test(host)) return null;
  // Forwarded hosts/schemes must not turn the local account into a hosted service.
  if (req.headers.get("x-forwarded-proto") && req.headers.get("x-forwarded-proto") !== "http") return null;
  if (process.env.GODSPEED_APP_ORIGIN || process.env.ATLAS_APP_ORIGIN) return null;
  return `http://${host}`;
}

export function readBrowser(req: Request) {
  const value = req.headers.get("cookie")?.split(";").map((pair) => pair.trim()).find((pair) => pair.startsWith(`${browserCookie}=`))?.slice(browserCookie.length + 1);
  return value && opaque.test(value) ? value : null;
}

export const newBrowser = secret;
const keyFor = (origin: string, browser: string) => createHash("sha256").update(`${origin}:${browser}`).digest("hex");
const recordPath = (key: string) => join(folder(), `${key}.json`);
const notFound = (error: unknown) => (error as NodeJS.ErrnoException)?.code === "ENOENT";

async function hostId() {
  const directory = folder();
  const filename = join(directory, "host-id");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  try { return hostSchema.parse((await readFile(filename, "utf8")).trim()); }
  catch (error) { if (!notFound(error)) throw error; }
  const id = `urn:uuid:${randomUUID()}`;
  try { await writeFile(filename, id, { flag: "wx", mode: 0o600 }); return id; }
  catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "EEXIST") throw error;
    return hostSchema.parse((await readFile(filename, "utf8")).trim());
  }
}

async function readRecord(key: string): Promise<RecordFile> {
  try { return recordSchema.parse(JSON.parse(await readFile(recordPath(key), "utf8"))); }
  catch (error) { if (notFound(error)) return { profiles: [] }; throw error; }
}

async function saveRecord(key: string, value: RecordFile) {
  await mkdir(folder(), { recursive: true, mode: 0o700 });
  const path = recordPath(key);
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, JSON.stringify(recordSchema.parse(value)), { flag: "wx", mode: 0o600 });
    await rename(temp, path);
  } finally { await rm(temp, { force: true }).catch(() => {}); }
}

function serialize<T>(key: string, operation: () => Promise<T>) {
  const next = (state.locks.get(key) ?? Promise.resolve()).catch(() => {}).then(operation);
  state.locks.set(key, next);
  return next.finally(() => { if (state.locks.get(key) === next) state.locks.delete(key); });
}

const permitted = (scopes: string[]) => scopes.includes("resource.invoke") && scopes.includes("chatgpt.tokens.use.direct");

export function authorizationUrl(attempt: Pick<Attempt, "callback" | "state" | "nonce" | "verifier" | "profile">, host: string) {
  const url = new URL(`${issuer}/api/accounts/authorize`);
  url.search = new URLSearchParams({
    client_id: attempt.profile?.clientId ?? "dynamic_agent_client", ext_agent_host_id: host, response_type: "code",
    redirect_uri: attempt.callback, scope, resource, state: attempt.state, nonce: attempt.nonce,
    code_challenge_method: "S256", code_challenge: createHash("sha256").update(attempt.verifier).digest("base64url"),
  }).toString();
  if (!attempt.profile) url.searchParams.set("agent_name_hint", "Godspeed");
  else {
    if (attempt.profile.credentials && !permitted(attempt.profile.credentials.scopes)) url.searchParams.set("prompt", "consent");
  }
  return url.href;
}

export async function beginChatGPT(origin: string, browser: string, selected?: string) {
  const key = keyFor(origin, browser);
  const record = await readRecord(key);
  const profile = record.profiles.find((entry) => entry.clientId === selected);
  if ((selected && !profile) || (!profile && record.profiles.length >= maxProfiles)) throw new Error("Choose a saved ChatGPT account.");
  const now = Date.now();
  for (const [id, attempt] of state.attempts) {
    if (attempt.expires <= now || attempt.key === key) state.attempts.delete(id);
  }
  if (state.attempts.size >= 32) throw new Error("Too many sign-in attempts.");
  const host = await hostId();
  const attempt: Attempt = { key, profile, callback: `${origin}/api/chatgpt`, state: secret(), nonce: secret(), verifier: secret(), expires: now + 600_000 };
  state.attempts.set(attempt.state, attempt);
  return authorizationUrl(attempt, host);
}

const tokenSchema = z.object({
  access_token: z.string().min(1), id_token: z.string().min(1).optional(), refresh_token: z.string().min(1).optional(),
  expires_in: z.number().int().positive().max(31_536_000), scope: z.string().optional(), token_type: z.string().refine((value) => value.toLowerCase() === "bearer"),
});
class OAuthError extends Error { constructor(readonly code: string) { super("ChatGPT could not authorize this connection."); } }

async function requestTokens(fields: Record<string, string>) {
  const response = await fetch(tokenEndpoint, {
    method: "POST", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(12_000),
    body: new URLSearchParams({ ...fields, resource }),
  });
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new OAuthError(z.object({ error: z.string() }).safeParse(data).data?.error ?? "");
  return tokenSchema.parse(data);
}

export async function finishChatGPT(origin: string, browser: string | null, query: URLSearchParams) {
  const supplied = query.get("state") ?? "";
  const attempt = state.attempts.get(supplied);
  if (!browser || !attempt || attempt.key !== keyFor(origin, browser) || attempt.expires <= Date.now()) return "failed";
  state.attempts.delete(supplied);
  if (query.has("error")) return query.get("error") === "access_denied" ? "cancelled" : "failed";
  const code = query.get("code");
  const returnedId = query.get("client_id");
  if (!code || code.length > 4096 || (attempt.profile && returnedId && returnedId !== attempt.profile.clientId)) return "failed";
  const clientId = clientIdSchema.parse(attempt.profile?.clientId ?? returnedId);
  return serialize(attempt.key, async () => {
    const record = await readRecord(attempt.key);
    const token = await requestTokens({ grant_type: "authorization_code", client_id: clientId, code,
      code_verifier: attempt.verifier, redirect_uri: attempt.callback });
    if (!token.id_token) return "failed";
    const { payload } = await jwtVerify(token.id_token, jwks, {
      issuer, audience: clientId, algorithms: ["RS256"], requiredClaims: ["exp", "sub", "nonce"],
    });
    if (payload.nonce !== attempt.nonce || !payload.sub
      || (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== clientId)
      || (attempt.profile && payload.sub !== attempt.profile.subject)) return "failed";
    const previous = record.profiles.find((profile) => profile.clientId === clientId);
    if (previous && previous.subject !== payload.sub) return "failed";
    const scopes = token.scope?.split(/\s+/).filter(Boolean) ?? [];
    const canUse = permitted(scopes);
    const profile: Profile = { clientId, subject: payload.sub, email: z.email().max(320).safeParse(payload.email).data,
      welcomed: previous?.welcomed || canUse,
      credentials: { access: token.access_token, refresh: token.refresh_token, idToken: token.id_token, expires: Date.now() + token.expires_in * 1000, scopes } };
    await saveRecord(attempt.key, { selected: clientId, profiles: previous
      ? record.profiles.map((entry) => entry.clientId === clientId ? profile : entry) : [...record.profiles, profile] });
    state.models.delete(clientId);
    return canUse ? previous?.welcomed ? "connected" : "welcome" : "permission";
  });
}

function connection(record: RecordFile) {
  const selected = record.profiles.find((profile) => profile.clientId === record.selected);
  return {
    profiles: record.profiles.map((profile, index) => ({ id: profile.clientId, label: `${profile.email ?? "ChatGPT account"} · ${index + 1}` })),
    selected: selected?.clientId, email: selected?.email,
    signedIn: Boolean(selected?.credentials),
    configured: Boolean(selected?.credentials && permitted(selected.credentials.scopes)
      && (selected.credentials.expires > Date.now() || selected.credentials.refresh)),
  };
}

export async function chatGPTStatus(origin: string, browser: string | null) {
  return connection(browser ? await readRecord(keyFor(origin, browser)) : { profiles: [] });
}

export async function disconnectChatGPT(origin: string, browser: string) {
  const key = keyFor(origin, browser);
  for (const [id, attempt] of state.attempts) if (attempt.key === key) state.attempts.delete(id);
  return serialize(key, async () => {
    const record = await readRecord(key);
    const selected = record.profiles.find((entry) => entry.clientId === record.selected);
    if (!selected?.credentials) return true;
    let revoked = false;
    try {
      if (selected.credentials.refresh) {
        const result = await fetch(`${issuer}/api/accounts/oauth/revoke`, {
          method: "POST", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(6500),
          body: new URLSearchParams({ token: selected.credentials.refresh, token_type_hint: "refresh_token", client_id: selected.clientId }),
        });
        revoked = result.ok;
      }
    } catch { /* Clear the local session even when remote revocation cannot be confirmed. */ }
    state.models.delete(selected.clientId);
    selected.credentials = undefined;
    await saveRecord(key, record);
    return revoked;
  });
}

const invalidRefresh = new Set(["invalid_grant", "invalid_refresh_token", "token_expired", "refresh_token_expired", "refresh_token_invalidated", "refresh_token_reused"]);

export async function chatGPTAccess(origin: string, browser: string, account: string) {
  const key = keyFor(origin, browser);
  return serialize(key, async () => {
    const record = await readRecord(key);
    const profile = record.profiles.find((entry) => entry.clientId === record.selected && entry.clientId === account);
    const saved = profile?.credentials;
    if (!profile || !saved || !permitted(saved.scopes)) return null;
    if (saved.expires > Date.now() + 60_000 || !saved.refresh && saved.expires > Date.now()) return { token: saved.access, clientId: profile.clientId };
    if (!saved.refresh) return null;
    let token: z.infer<typeof tokenSchema>;
    try { token = await requestTokens({ grant_type: "refresh_token", client_id: profile.clientId, refresh_token: saved.refresh }); }
    catch (error) {
      if (!(error instanceof OAuthError) || !invalidRefresh.has(error.code)) throw error;
      profile.credentials = undefined;
      await saveRecord(key, record);
      return null;
    }
    const scopes = token.scope?.split(/\s+/).filter(Boolean) ?? saved.scopes;
    profile.credentials = { access: token.access_token, refresh: token.refresh_token ?? saved.refresh, idToken: saved.idToken,
      expires: Date.now() + token.expires_in * 1000, scopes };
    await saveRecord(key, record);
    return permitted(scopes) ? { token: token.access_token, clientId: profile.clientId } : null;
  });
}

export async function chatGPTModels(access: { token: string; clientId: string }, signal: AbortSignal): Promise<ModelOption[]> {
  const cached = state.models.get(access.clientId);
  if (cached?.options && cached.until > Date.now()) return cached.options;
  const response = await fetch(`${resource}/models`, { cache: "no-store", redirect: "error", signal: AbortSignal.any([signal, AbortSignal.timeout(8_000)]),
    headers: { Authorization: `Bearer ${access.token}` } });
  if (!response.ok) throw new Error("ChatGPT model access is unavailable.");
  const catalog = z.object({ models: z.array(z.object({
    slug: z.string(), visibility: z.string(), display_name: z.string().nullish(),
  })).max(500) }).parse(await response.json());
  const options = [...new Map(catalog.models.flatMap(({ slug, visibility, display_name }) => visibility === "list" && validModelName(slug)
    ? [[slug, { slug, label: display_name?.trim().slice(0, 100) || modelLabel(slug) }] as const] : [])).values()];
  if (state.models.size >= 32) state.models.clear();
  state.models.set(access.clientId, { options, until: Date.now() + 300_000 });
  return options;
}

export async function chatGPTModel(access: { token: string; clientId: string }, signal: AbortSignal, selected?: string) {
  const options = await chatGPTModels(access, signal);
  if (selected) return options.some(({ slug }) => slug === selected) ? selected : null;
  return chooseBudgetModel(options.map(({ slug }) => ({ slug, visibility: "list" }))) ?? null;
}
