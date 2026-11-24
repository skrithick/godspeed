/* Only the static Godspeed shell and its public build assets belong in this cache. */
const shellCache = "godspeed-shell-v1";
const assetsCache = "godspeed-assets-v1";
const root = new URL("/", self.location.origin).href;
const ownedCache = /^(godspeed|atlas)-(shell|assets|pages)-v\d+$/;
const maxAssets = 200;

function asset(url) {
  return url.origin === self.location.origin &&
    (url.pathname.startsWith("/_next/static/") || url.pathname === "/icon.svg") &&
    !url.searchParams.has("_rsc");
}

function cacheable(response) {
  return response.status === 200 && response.type === "basic" && !response.redirected &&
    !response.headers.get("vary")?.includes("*") && !response.headers.has("set-cookie") &&
    !/\b(no-store|private)\b/i.test(response.headers.get("cache-control") ?? "") &&
    Number(response.headers.get("content-length") ?? 0) <= 5_000_000;
}

async function putShell(response) {
  if (!cacheable(response) || !response.headers.get("content-type")?.startsWith("text/html")) return;
  try { await (await caches.open(shellCache)).put(root, response.clone()); }
  catch (error) { console.warn("[godspeed-offline] Could not cache the shell.", error); }
}

async function trimAssets(cache) {
  const keys = await cache.keys();
  await Promise.all(keys.slice(0, Math.max(0, keys.length - maxAssets)).map((key) => cache.delete(key)));
}

async function navigate(request) {
  try {
    const response = await fetch(request);
    await putShell(response);
    return response;
  } catch (error) {
    const cached = await (await caches.open(shellCache)).match(root);
    if (cached) return cached;
    throw error;
  }
}

async function loadAsset(request, immutable = true) {
  const cache = await caches.open(assetsCache).catch(() => null);
  if (immutable && cache) {
    const cached = await cache.match(request).catch(() => null);
    if (cached) return cached;
  }
  try {
    const response = await fetch(request);
    if (cache && cacheable(response)) {
      try { await cache.put(request, response.clone()); await trimAssets(cache); }
      catch (error) { console.warn("[godspeed-offline] Could not cache an asset.", error); }
    }
    return response;
  } catch (error) {
    const cached = await cache?.match(request);
    if (cached) return cached;
    throw error;
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    try { await putShell(await fetch(root, { cache: "reload" })); }
    catch (error) { console.warn("[godspeed-offline] The network was unavailable during setup.", error); }
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => ownedCache.test(key) && key !== shellCache && key !== assetsCache).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || request.headers.has("authorization") || request.headers.has("range") || request.cache === "only-if-cached") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.searchParams.has("_rsc")) return;
  if (url.pathname === "/" && request.mode === "navigate") event.respondWith(navigate(request));
  else if (asset(url) && request.cache !== "no-store") event.respondWith(loadAsset(request, url.pathname.startsWith("/_next/static/")));
});

self.addEventListener("message", (event) => {
  if (event.data?.type !== "GODSPEED_PRECACHE_ASSETS" || !Array.isArray(event.data.urls)) return;
  event.waitUntil((async () => {
    const urls = new Set();
    for (const value of event.data.urls.slice(0, maxAssets)) {
      if (typeof value !== "string") continue;
      try { const url = new URL(value); if (asset(url)) urls.add(url.href); } catch { /* Ignore malformed URLs. */ }
    }
    const failed = [];
    const list = [...urls];
    for (let offset = 0; offset < list.length; offset += 6) {
      await Promise.all(list.slice(offset, offset + 6).map(async (url) => {
        try { const response = await loadAsset(url); if (!response.ok) failed.push(url); }
        catch { failed.push(url); }
      }));
    }
    event.ports[0]?.postMessage({ type: "GODSPEED_PRECACHE_RESULT", failed });
  })());
});
