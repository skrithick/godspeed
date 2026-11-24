import { NextResponse } from "next/server";
import { beginChatGPT, browserCookie, chatGPTAccess, chatGPTModels, chatGPTOrigin, chatGPTStatus, disconnectChatGPT, finishChatGPT, newBrowser, readBrowser } from "@/server/chatgpt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
const json = (value: object, status = 200) => NextResponse.json(value, { status, headers });
const trustedSite = (req: Request) => [null, "same-origin", "none"].includes(req.headers.get("sec-fetch-site"));

export async function GET(req: Request) {
  const origin = chatGPTOrigin(req);
  const query = new URL(req.url).searchParams;
  const browser = readBrowser(req);
  if (query.has("state") || query.has("code") || query.has("error")) {
    if (!origin) return json({ error: "This callback requires the local Godspeed preview." }, 403);
    const status = await finishChatGPT(origin, browser, query).catch(() => "failed");
    return NextResponse.redirect(`${origin}/?chatgpt=${status}`, { status: 303, headers });
  }
  if (!trustedSite(req)) return json({ error: "Sign-in must start in Godspeed." }, 403);
  if (query.has("models")) {
    const account = query.get("account");
    if (!origin || !browser || !account || account.length > 200) return json({ error: "Connect ChatGPT first." }, 401);
    try {
      const access = await chatGPTAccess(origin, browser, account);
      return access ? json({ models: await chatGPTModels(access, req.signal) }) : json({ error: "Reconnect ChatGPT to load models." }, 401);
    } catch { return json({ error: "Couldn’t load ChatGPT models." }, 503); }
  }
  if (!origin) return json({ available: false, configured: false, signedIn: false, profiles: [] });
  try { return json({ available: true, ...(await chatGPTStatus(origin, browser)) }); }
  catch { return json({ error: "Godspeed couldn't read the local ChatGPT connection." }, 503); }
}

export async function POST(req: Request) {
  const origin = chatGPTOrigin(req);
  if (!origin || !trustedSite(req) || req.headers.get("origin") !== origin) {
    return json({ error: "Use the Godspeed preview at http://127.0.0.1 to manage ChatGPT sign-in." }, 403);
  }
  const query = new URL(req.url).searchParams;
  const browser = readBrowser(req);
  try {
    if (query.get("action") === "disconnect") {
      return json({ revoked: browser ? await disconnectChatGPT(origin, browser) : true });
    }
    if (query.get("action") !== "connect") return json({ error: "Unknown account action." }, 400);
    const id = browser ?? newBrowser();
    const url = await beginChatGPT(origin, id, query.get("account") || undefined);
    const response = json({ url });
    response.cookies.set(browserCookie, id, { httpOnly: true, sameSite: "lax", path: "/api", maxAge: 365 * 24 * 3600 });
    return response;
  } catch {
    return json({ error: "Godspeed couldn't complete this ChatGPT account action. Try again." }, 503);
  }
}
