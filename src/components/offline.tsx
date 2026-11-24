'use client';

import { useEffect } from 'react';

/**
 * Registers the Godspeed service worker in production and warms it with the
 * asset URLs the current page actually loaded. Renders nothing.
 *
 * Exported as both a named and a default component so it can be mounted from
 * a layout or page as preferred.
 */

const SW_URL = '/sw.js';
const SW_SCOPE = '/';
const MAX_ASSETS = 200;

const ASSET_SELECTOR = [
  'script[src]',
  'link[rel="stylesheet"][href]',
  'link[rel="preload"][href]',
  'link[rel="modulepreload"][href]',
  'link[rel="icon"][href]',
  'link[rel="apple-touch-icon"][href]',
  'img[src]',
  'source[src]',
  'video[poster]',
].join(',');

// Resource-timing initiators that are data or media requests, not shell assets.
const SKIP_INITIATORS = new Set([
  'fetch',
  'xmlhttprequest',
  'beacon',
  'video',
  'audio',
  'track',
  'iframe',
]);

function normalizeAssetUrl(raw: string): string | null {
  try {
    const url = new URL(raw, window.location.href);

    if (url.origin !== window.location.origin) return null;
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return null;
    if (url.searchParams.has('_rsc')) return null;

    return url.href;
  } catch {
    return null;
  }
}

function collectAssetUrls(): string[] {
  const urls = new Set<string>();

  const add = (raw: string | null | undefined) => {
    if (!raw) return;
    const normalized = normalizeAssetUrl(raw);
    if (normalized) urls.add(normalized);
  };

  // Performance entries cover lazily loaded chunks, fonts, and images that
  // never appear as static markup. Treated defensively: this API is optional
  // and can be missing or restricted in some environments.
  try {
    if (typeof performance !== 'undefined' && typeof performance.getEntriesByType === 'function') {
      const entries = performance.getEntriesByType('resource');
      if (Array.isArray(entries)) {
        for (const entry of entries) {
          const initiator = (entry as PerformanceResourceTiming).initiatorType;
          if (initiator && SKIP_INITIATORS.has(initiator)) continue;
          add(entry.name);
        }
      }
    }
  } catch (error) {
    console.warn('[godspeed] could not read performance resource entries', error);
  }

  try {
    document.querySelectorAll(ASSET_SELECTOR).forEach((element) => {
      add(
        element.getAttribute('src') ??
          element.getAttribute('href') ??
          element.getAttribute('poster'),
      );
    });
  } catch (error) {
    console.warn('[godspeed] could not inspect document assets', error);
  }

  return Array.from(urls).slice(0, MAX_ASSETS);
}

function warmServiceWorker(worker: ServiceWorker) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;

  const urls = collectAssetUrls();
  if (urls.length === 0) return;

  try {
    const channel = new MessageChannel();

    channel.port1.onmessage = (event: MessageEvent) => {
      const data = event.data as { failed?: string[] } | null;
      const failed = data && Array.isArray(data.failed) ? data.failed : [];
      if (failed.length > 0) {
        console.warn('[godspeed] some assets could not be cached for offline use', failed.slice(0, 10));
      }
      channel.port1.close();
    };

    worker.postMessage({ type: 'GODSPEED_PRECACHE_ASSETS', urls }, [channel.port2]);
  } catch (error) {
    console.warn('[godspeed] could not send the asset list to the service worker', error);
  }
}

export function OfflineShell() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (typeof window === 'undefined' || typeof navigator === 'undefined') return;
    if (!('serviceWorker' in navigator) || !window.isSecureContext) return;

    let disposed = false;

    const register = async () => {
      try {
        const registration = await navigator.serviceWorker.register(SW_URL, {
          scope: SW_SCOPE,
        });
        if (disposed) return;

        const ready = await navigator.serviceWorker.ready;
        if (disposed) return;

        const worker =
          ready.active ?? registration.active ?? navigator.serviceWorker.controller;

        if (worker) {
          warmServiceWorker(worker);
        } else {
          console.warn('[godspeed] service worker is ready but no active worker is available');
        }

        // Assets that finish loading after `ready` still get warmed.
        if (document.readyState !== 'complete') {
          window.addEventListener(
            'load',
            () => {
              if (disposed) return;
              const current = navigator.serviceWorker.controller ?? ready.active;
              if (current) warmServiceWorker(current);
            },
            { once: true },
          );
        }
      } catch (error) {
        // Offline support is an enhancement; never break the workspace.
        console.warn('[godspeed] service worker registration failed; offline mode is unavailable', error);
      }
    };

    void register();

    // A newly activated worker has empty versioned caches; re-warm them.
    const handleControllerChange = () => {
      if (disposed) return;
      const worker = navigator.serviceWorker.controller;
      if (worker) warmServiceWorker(worker);
    };

    navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange);

    return () => {
      disposed = true;
      navigator.serviceWorker.removeEventListener('controllerchange', handleControllerChange);
    };
  }, []);

  return null;
}

export default OfflineShell;
