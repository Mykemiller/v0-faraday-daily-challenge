/* Faraday Predicts service worker — FDY-127 Phase 2 (26-47-v01), CC-PREDICTS-PWA-1.0 §3 (D2).
 *
 * Scope: /predicts (registered by src/app/predicts/PredictsPwa.tsx; next.config.ts sends
 * `Service-Worker-Allowed: /predicts` and `Cache-Control: no-cache` for this file). Plain JS, no
 * importScripts, no CDN, no Workbox: same-origin and dependency-free.
 *
 * Read-only offline (D2):
 *   · Navigations inside /predicts: network first; a good response is kept as the last-good copy of
 *     that URL; offline → that copy, else the cached /predicts shell.
 *   · predicts-public GETs (the public, anonymous forecast API): network first, last-good copy offline.
 *   · /_next/static, icons and the Google Fonts files: cache first (immutable / versioned).
 *   · NEVER cached or served from cache: anything that is not a GET; any URL carrying t= or token=;
 *     /predicts/preferences (the token page); the predicts-preferences and predicts-push-subscribe
 *     functions; React Server Component fetches. There are no offline writes and no queued writes.
 * Push (§5): `push` shows the notification from the payload alone (no fetch); `notificationclick`
 * opens only URLs inside /predicts on this origin; `pushsubscriptionchange` re-subscribes with the
 * settings the preferences page left when the subscriber switched alerts on.
 */
"use strict";

const VERSION = "fdy127-1";
const PREFIX = "predicts-";
const SHELL = `${PREFIX}shell-${VERSION}`;
const PAGES = `${PREFIX}pages-${VERSION}`;
const DATA = `${PREFIX}data-${VERSION}`;
const STATIC = `${PREFIX}static-${VERSION}`;
const CONFIG = `${PREFIX}push-config`; // not versioned: survives worker updates
const CONFIG_KEY = "/predicts/__push-config";
const CURRENT = [SHELL, PAGES, DATA, STATIC, CONFIG];
const STAMP = "x-predicts-cached-at";
const SCOPE = "/predicts";
const SHELL_URLS = ["/predicts", "/predicts/receipts", "/predicts/record", "/icon.svg", "/icon-192.png", "/icon-512.png"];
const DEFAULT_TITLE = "Faraday Predicts";

function inScope(url) {
  let u;
  try { u = new URL(url, self.location.origin); } catch { return false; }
  if (u.origin !== self.location.origin) return false;
  return u.pathname === SCOPE || u.pathname.startsWith(`${SCOPE}/`);
}

function hasCredential(u) {
  return u.searchParams.has("t") || u.searchParams.has("token");
}

/** "skip" | "page" | "data" | "static" — the whole caching policy in one function. */
function classify(request) {
  if (request.method !== "GET") return "skip";
  let u;
  try { u = new URL(request.url); } catch { return "skip"; }
  if (hasCredential(u)) return "skip";
  if (/predicts-(preferences|push-subscribe|push-send|vote)/.test(u.pathname)) return "skip";
  if (u.origin === self.location.origin) {
    if (u.pathname === "/predicts/preferences" || u.pathname.startsWith("/predicts/preferences/")) return "skip";
    if (u.pathname === "/predicts/sw.js" || u.pathname === "/predicts/manifest.webmanifest") return "skip";
    if (u.searchParams.has("_rsc") || (request.headers && request.headers.get("RSC") === "1")) return "skip";
    if (request.mode === "navigate") return inScope(u.href) ? "page" : "skip";
    if (u.pathname.startsWith("/_next/static/")) return "static";
    if (/^\/icon(-\d+)?\.(png|svg)$/.test(u.pathname)) return "static";
    return "skip";
  }
  if (u.protocol === "https:" && /\.supabase\.co$/.test(u.hostname) && /\/functions\/v1\/predicts-public\/?$/.test(u.pathname)) return "data";
  if (u.hostname === "fonts.googleapis.com" || u.hostname === "fonts.gstatic.com") return "static";
  return "skip";
}

async function stamped(response) {
  const headers = new Headers(response.headers);
  headers.set(STAMP, String(Date.now()));
  const body = await response.clone().arrayBuffer();
  return new Response(body, { status: response.status, statusText: response.statusText, headers });
}

function storable(response) {
  return !!response && response.status === 200 && (response.type === "basic" || response.type === "cors" || response.type === "default");
}

async function networkFirst(request, cacheName, fallbackUrl) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(request);
    if (storable(res)) await cache.put(request.url, await stamped(res));
    return res;
  } catch {
    const hit = await cache.match(request.url);
    if (hit) return hit;
    if (fallbackUrl) {
      const shell = await (await caches.open(SHELL)).match(fallbackUrl);
      if (shell) return shell;
    }
    return new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(STATIC);
  const hit = await cache.match(request.url);
  if (hit) return hit;
  const res = await fetch(request);
  if (storable(res) || res.type === "opaque") await cache.put(request.url, res.clone());
  return res;
}

async function precache() {
  const cache = await caches.open(SHELL);
  await Promise.all(SHELL_URLS.map(async (url) => {
    try {
      const res = await fetch(url, { cache: "no-store", credentials: "omit" });
      if (storable(res)) await cache.put(url, await stamped(res));
    } catch { /* one missing shell page must not fail the install */ }
  }));
}

async function cleanup() {
  const names = await caches.keys();
  await Promise.all(names.filter((n) => n.startsWith(PREFIX) && !CURRENT.includes(n)).map((n) => caches.delete(n)));
}

/** epoch ms the last-good copy of `url` was stored, or null. */
async function cachedAt(url) {
  for (const name of [PAGES, DATA, SHELL]) {
    const hit = await (await caches.open(name)).match(url);
    if (hit) {
      const n = Number(hit.headers.get(STAMP));
      return Number.isFinite(n) && n > 0 ? n : null;
    }
  }
  return null;
}

/** Build the notification from the payload alone, with every field checked. */
function notificationFrom(data) {
  const d = data && typeof data === "object" ? data : {};
  const title = typeof d.title === "string" && d.title.trim() ? d.title.trim().slice(0, 80) : DEFAULT_TITLE;
  const body = typeof d.body === "string" ? d.body.slice(0, 240) : "";
  const url = typeof d.url === "string" && inScope(d.url) ? new URL(d.url, self.location.origin).pathname : SCOPE;
  const tag = typeof d.tag === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(d.tag) ? d.tag : undefined;
  return { title, options: { body, tag, data: { url }, icon: "/icon-192.png", badge: "/icon-192.png" } };
}

function parsePushData(event) {
  if (!event.data) return null;
  try { return event.data.json(); } catch {
    try { return { body: event.data.text() }; } catch { return null; }
  }
}

async function openFromClick(url) {
  if (!inScope(url)) return; // anything outside /predicts on this origin is dropped
  const target = new URL(url, self.location.origin).href;
  const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const c of all) {
    if (inScope(c.url) && "focus" in c) {
      await c.focus();
      if ("navigate" in c && c.url !== target) await c.navigate(target);
      return;
    }
  }
  await self.clients.openWindow(target);
}

async function readPushConfig() {
  const res = await (await caches.open(CONFIG)).match(CONFIG_KEY);
  if (!res) return null;
  try {
    const c = await res.json();
    return c && typeof c.subscribeUrl === "string" && typeof c.token === "string" && typeof c.vapidKey === "string" ? c : null;
  } catch { return null; }
}

function keyBytes(b64url) {
  const t = String(b64url).replace(/=+$/, "").replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(t + "===".slice((t.length + 3) % 4));
  return Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
}

async function resubscribe(event) {
  const cfg = await readPushConfig();
  if (!cfg) return; // alerts were never switched on from this browser, or were switched off
  const post = (body) => fetch(cfg.subscribeUrl, {
    method: "POST", credentials: "omit", referrerPolicy: "no-referrer", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: cfg.token, ...body }),
  });
  if (event.oldSubscription) await post({ action: "unsubscribe", endpoint: event.oldSubscription.endpoint }).catch(() => {});
  const sub = event.newSubscription || await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(cfg.vapidKey) });
  await post({ action: "subscribe", consent: true, platform: cfg.platform || "unknown", subscription: sub.toJSON() }).catch(() => {});
}

self.addEventListener("install", (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(cleanup().then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  const kind = classify(event.request);
  if (kind === "page") event.respondWith(networkFirst(event.request, PAGES, SCOPE));
  else if (kind === "data") event.respondWith(networkFirst(event.request, DATA, null));
  else if (kind === "static") event.respondWith(cacheFirst(event.request));
  // "skip": not handled — the browser goes to the network exactly as without a worker.
});

self.addEventListener("message", (event) => {
  const msg = event.data || {};
  const port = event.ports && event.ports[0];
  if (msg.type === "cached-at" && port) {
    const url = typeof msg.url === "string" && inScope(msg.url) ? new URL(msg.url, self.location.origin).href : null;
    event.waitUntil((url ? cachedAt(url) : Promise.resolve(null)).then((at) => port.postMessage({ at })));
  } else if (msg.type === "push-config" && msg.config) {
    const c = msg.config;
    if (typeof c.subscribeUrl === "string" && /^https:\/\//.test(c.subscribeUrl) && typeof c.token === "string" && typeof c.vapidKey === "string") {
      event.waitUntil(caches.open(CONFIG).then((cache) => cache.put(CONFIG_KEY, new Response(JSON.stringify({
        subscribeUrl: c.subscribeUrl, token: c.token, vapidKey: c.vapidKey, platform: typeof c.platform === "string" ? c.platform : "unknown",
      }), { headers: { "Content-Type": "application/json" } }))));
    }
  } else if (msg.type === "push-config-clear") {
    event.waitUntil(caches.open(CONFIG).then((cache) => cache.delete(CONFIG_KEY)));
  }
});

self.addEventListener("push", (event) => {
  const n = notificationFrom(parsePushData(event));
  event.waitUntil(self.registration.showNotification(n.title, n.options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data && event.notification.data.url;
  event.waitUntil(openFromClick(typeof url === "string" ? url : SCOPE));
});

self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(resubscribe(event));
});

// Test hook: src/lib/predicts-sw.test.ts loads this file in a vm with a fake `self` that sets the flag.
if (self.__PREDICTS_SW_TEST__) {
  self.__predictsSw = { VERSION, SHELL, PAGES, DATA, STATIC, CONFIG, CONFIG_KEY, SHELL_URLS, classify, inScope, notificationFrom, networkFirst, cacheFirst, precache, cleanup, cachedAt, openFromClick, resubscribe, readPushConfig };
}
