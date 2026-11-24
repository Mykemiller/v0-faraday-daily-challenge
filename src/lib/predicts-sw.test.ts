// node --test src/lib/predicts-sw.test.ts  (FDY-127 Phase 2, CC-PREDICTS-PWA-1.0 §3 D2)
// Loads public/predicts/sw.js into a vm sandbox with a fake `self`, Cache Storage and fetch, then
// drives the real handlers. No browser, no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const SRC = readFileSync(new URL("../../public/predicts/sw.js", import.meta.url), "utf8");
const ORIGIN = "https://www.faraday-intelligence.ai";
const API = "https://ycadmmngkdhvpcsrcuaq.supabase.co/functions/v1/predicts-public";

type Listener = (e: unknown) => void;

function sandbox(fetchImpl: (req: Request | string, init?: RequestInit) => Promise<Response>) {
  const stores = new Map<string, Map<string, Response>>();
  const caches = {
    open: async (name: string) => {
      if (!stores.has(name)) stores.set(name, new Map());
      const m = stores.get(name)!;
      return {
        match: async (k: string) => m.get(k)?.clone(),
        put: async (k: string, r: Response) => { m.set(k, r); },
        delete: async (k: string) => m.delete(k),
      };
    },
    keys: async () => [...stores.keys()],
    delete: async (n: string) => stores.delete(n),
  };
  const listeners = new Map<string, Listener>();
  const shown: { title: string; options: Record<string, unknown> }[] = [];
  const opened: string[] = [];
  const fetchCalls: string[] = [];
  const self: Record<string, unknown> = {
    __PREDICTS_SW_TEST__: true,
    location: { origin: ORIGIN },
    addEventListener: (t: string, fn: Listener) => listeners.set(t, fn),
    skipWaiting: async () => {},
    registration: { showNotification: async (title: string, options: Record<string, unknown>) => { shown.push({ title, options }); }, pushManager: {} },
    clients: { claim: async () => {}, matchAll: async () => [], openWindow: async (u: string) => { opened.push(u); } },
  };
  const ctx = vm.createContext({
    self, caches, URL, Headers, Request, Response, atob, btoa, Uint8Array, JSON, Promise, Date, Number, String, Object, Array, Error,
    fetch: (r: Request | string, init?: RequestInit) => { fetchCalls.push(typeof r === "string" ? r : r.url); return fetchImpl(r, init); },
  });
  vm.runInContext(SRC, ctx, { filename: "sw.js" });
  const sw = self.__predictsSw as Record<string, (...a: unknown[]) => unknown> & { PAGES: string; DATA: string; SHELL: string; STATIC: string; CONFIG: string; CONFIG_KEY: string };
  return { sw, listeners, stores, shown, opened, fetchCalls, caches };
}

const req = (url: string, init: RequestInit & { mode?: string } = {}) => {
  const { mode, ...rest } = init;
  const r = new Request(url, rest);
  // Node's Request has no navigate mode; emulate a browser navigation.
  if (mode === "navigate") Object.defineProperty(r, "mode", { value: "navigate" });
  return r;
};

test("classify: the caching policy", () => {
  const { sw } = sandbox(async () => new Response("x"));
  const c = (r: Request) => sw.classify(r);
  assert.equal(c(req(`${ORIGIN}/predicts`, { mode: "navigate" })), "page");
  assert.equal(c(req(`${ORIGIN}/predicts/receipts?outcome=right`, { mode: "navigate" })), "page");
  assert.equal(c(req(`${ORIGIN}/challenge`, { mode: "navigate" })), "skip", "outside scope");
  assert.equal(c(req(`${ORIGIN}/predicts/preferences`, { mode: "navigate" })), "skip", "the token page is never cached");
  assert.equal(c(req(`${ORIGIN}/predicts/preferences?t=123e4567-e89b-42d3-a456-426614174000`, { mode: "navigate" })), "skip");
  assert.equal(c(req(`${ORIGIN}/predicts/following?token=abc`, { mode: "navigate" })), "skip", "any token-bearing URL");
  assert.equal(c(req(`${ORIGIN}/predicts?_rsc=1`)), "skip", "RSC payloads");
  assert.equal(c(req(`${ORIGIN}/predicts`, { headers: { RSC: "1" } })), "skip");
  assert.equal(c(req(`${ORIGIN}/predicts`, { method: "POST", body: "{}" })), "skip", "no writes, ever");
  assert.equal(c(req(`${ORIGIN}/_next/static/chunks/app.js`)), "static");
  assert.equal(c(req(`${ORIGIN}/icon-192.png`)), "static");
  assert.equal(c(req(`${API}?view=open&horizon=all`)), "data");
  assert.equal(c(req(`${API}?view=receipts&cursor=abc`)), "data");
  assert.equal(c(req(API.replace("predicts-public", "predicts-preferences") + "?t=x")), "skip");
  assert.equal(c(req(API.replace("predicts-public", "predicts-push-subscribe"), { method: "POST", body: "{}" })), "skip");
  assert.equal(c(req(API.replace("predicts-public", "predicts-push-subscribe"))), "skip");
  assert.equal(c(req("https://evil.example/functions/v1/predicts-public")), "skip", "only the Supabase functions origin");
  assert.equal(c(req(`${ORIGIN}/predicts/sw.js`)), "skip");
});

test("navigation: network first, last-good copy stored with a timestamp, served offline; shell as fallback", async () => {
  let online = true;
  const box = sandbox(async (r) => {
    if (!online) throw new TypeError("offline");
    const url = typeof r === "string" ? r : r.url;
    return new Response(`<html>${url}</html>`, { status: 200, headers: { "Content-Type": "text/html" } });
  });
  await box.sw.precache();
  assert.ok(box.stores.get(box.sw.SHELL)!.has("/predicts"));
  const page = `${ORIGIN}/predicts/receipts`;
  const first = (await box.sw.networkFirst(req(page, { mode: "navigate" }), box.sw.PAGES, "/predicts")) as Response;
  assert.equal(first.status, 200);
  const at = (await box.sw.cachedAt(page)) as number;
  assert.ok(at > 0, "stamped");
  online = false;
  const offline = (await box.sw.networkFirst(req(page, { mode: "navigate" }), box.sw.PAGES, "/predicts")) as Response;
  assert.equal(await offline.text(), `<html>${page}</html>`);
  const never = (await box.sw.networkFirst(req(`${ORIGIN}/predicts/record`, { mode: "navigate" }), box.sw.PAGES, "/predicts")) as Response;
  assert.equal(await never.text(), "<html>/predicts</html>", "unseen page offline → the cached shell");
  const dataMiss = (await box.sw.networkFirst(req(`${API}?view=open`), box.sw.DATA, null)) as Response;
  assert.equal(dataMiss.status, 503);
});

test("errors are not stored as last-good copies", async () => {
  const box = sandbox(async () => new Response("boom", { status: 500 }));
  await box.sw.networkFirst(req(`${ORIGIN}/predicts`, { mode: "navigate" }), box.sw.PAGES, "/predicts");
  assert.equal(box.stores.get(box.sw.PAGES)?.size ?? 0, 0);
});

test("fetch listener: skipped requests are left to the network untouched", () => {
  const box = sandbox(async () => new Response("x"));
  let responded = false;
  box.listeners.get("fetch")!({ request: req(`${ORIGIN}/predicts/preferences?t=x`, { mode: "navigate" }), respondWith: () => { responded = true; } });
  assert.equal(responded, false);
  box.listeners.get("fetch")!({ request: req(`${ORIGIN}/predicts`, { method: "POST", body: "{}" }), respondWith: () => { responded = true; } });
  assert.equal(responded, false);
});

test("activate: old predicts-* caches are deleted, other caches and the push config survive", async () => {
  const box = sandbox(async () => new Response("x"));
  for (const n of ["predicts-pages-old", "predicts-shell-fdy127-0", "someone-else", box.sw.CONFIG, box.sw.PAGES]) await box.caches.open(n);
  await box.sw.cleanup();
  assert.deepEqual([...box.stores.keys()].sort(), [box.sw.CONFIG, box.sw.PAGES, "someone-else"].sort());
});

test("push: notification built from the payload alone; out-of-scope URLs are dropped; no fetch", async () => {
  const box = sandbox(async () => { throw new Error("push must not fetch"); });
  let wait: Promise<unknown> = Promise.resolve();
  const data = (o: unknown) => ({ json: () => o, text: () => JSON.stringify(o) });
  box.listeners.get("push")!({ data: data({ title: "Faraday Predicts", body: "Headline", url: "/predicts/abc", tag: "flash-1", release: "26-46-v01" }), waitUntil: (p: Promise<unknown>) => { wait = p; } });
  await wait;
  assert.equal(box.shown[0].title, "Faraday Predicts");
  assert.equal(box.shown[0].options.body, "Headline");
  assert.equal(JSON.stringify(box.shown[0].options.data), JSON.stringify({ url: "/predicts/abc" }));
  box.listeners.get("push")!({ data: data({ url: "https://evil.example/phish", title: "" }), waitUntil: (p: Promise<unknown>) => { wait = p; } });
  await wait;
  assert.equal(JSON.stringify(box.shown[1].options.data), JSON.stringify({ url: "/predicts" }), "foreign URL replaced by the scope root");
  assert.equal(box.shown[1].title, "Faraday Predicts");
  assert.equal(box.fetchCalls.length, 0);
  const n = box.sw.notificationFrom({ tag: "bad tag with spaces", body: "x".repeat(1000) }) as { options: { tag?: string; body: string } };
  assert.equal(n.options.tag, undefined);
  assert.equal(n.options.body.length, 240);
});

test("notificationclick: opens only /predicts URLs on this origin", async () => {
  const box = sandbox(async () => new Response("x"));
  await box.sw.openFromClick("/predicts/abc");
  await box.sw.openFromClick("https://evil.example/x");
  await box.sw.openFromClick("/challenge");
  assert.deepEqual(box.opened, [`${ORIGIN}/predicts/abc`]);
});

test("cached-at message answers with the stamp of the page on screen; push-config is stored and cleared", async () => {
  const box = sandbox(async () => new Response("<html/>", { status: 200 }));
  await box.sw.networkFirst(req(`${ORIGIN}/predicts`, { mode: "navigate" }), box.sw.PAGES, "/predicts");
  let reply: unknown = null;
  let wait: Promise<unknown> = Promise.resolve();
  box.listeners.get("message")!({ data: { type: "cached-at", url: "/predicts" }, ports: [{ postMessage: (m: unknown) => { reply = m; } }], waitUntil: (p: Promise<unknown>) => { wait = p; } });
  await wait;
  assert.ok(typeof (reply as { at: number }).at === "number");
  box.listeners.get("message")!({ data: { type: "cached-at", url: "https://evil.example/x" }, ports: [{ postMessage: (m: unknown) => { reply = m; } }], waitUntil: (p: Promise<unknown>) => { wait = p; } });
  await wait;
  assert.equal(JSON.stringify(reply), JSON.stringify({ at: null }));

  const cfg = { subscribeUrl: `${API.replace("predicts-public", "predicts-push-subscribe")}`, token: "123e4567-e89b-42d3-a456-426614174000", vapidKey: "B" + "A".repeat(86), platform: "ios" };
  box.listeners.get("message")!({ data: { type: "push-config", config: cfg }, waitUntil: (p: Promise<unknown>) => { wait = p; } });
  await wait;
  assert.equal(JSON.stringify(await box.sw.readPushConfig()), JSON.stringify(cfg));
  box.listeners.get("message")!({ data: { type: "push-config", config: { ...cfg, subscribeUrl: "http://insecure" } }, waitUntil: (p: Promise<unknown>) => { wait = p; } });
  box.listeners.get("message")!({ data: { type: "push-config-clear" }, waitUntil: (p: Promise<unknown>) => { wait = p; } });
  await wait;
  assert.equal(await box.sw.readPushConfig(), null);
});

test("pushsubscriptionchange: re-subscribes through predicts-push-subscribe only when alerts were switched on", async () => {
  const posts: { url: string; body: Record<string, unknown> }[] = [];
  const box = sandbox(async (r, init) => {
    posts.push({ url: String(r), body: JSON.parse(String(init?.body ?? "{}")) });
    return new Response("{}", { status: 200 });
  });
  // Not switched on: nothing happens.
  await box.sw.resubscribe({ newSubscription: { toJSON: () => ({ endpoint: "https://fcm.googleapis.com/new" }) } });
  assert.equal(posts.length, 0);
  const sub = API.replace("predicts-public", "predicts-push-subscribe");
  const ctx = await box.caches.open(box.sw.CONFIG);
  await ctx.put(box.sw.CONFIG_KEY, new Response(JSON.stringify({ subscribeUrl: sub, token: "123e4567-e89b-42d3-a456-426614174000", vapidKey: "B" + "A".repeat(86), platform: "android" })));
  await box.sw.resubscribe({ oldSubscription: { endpoint: "https://fcm.googleapis.com/old" }, newSubscription: { toJSON: () => ({ endpoint: "https://fcm.googleapis.com/new", keys: {} }) } });
  assert.equal(posts.length, 2);
  assert.ok(posts.every((p) => p.url === sub), "only the subscribe endpoint is called");
  assert.deepEqual(posts.map((p) => p.body.action), ["unsubscribe", "subscribe"]);
  assert.equal(posts[0].body.endpoint, "https://fcm.googleapis.com/old");
  assert.equal(posts[1].body.consent, true);
  assert.equal(posts[1].body.platform, "android");
});

test("worker source: no importScripts, no CDN, no console, no eval", () => {
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.ok(!/importScripts|https:\/\/cdn|unpkg|jsdelivr|console\.|eval\(/.test(code));
});
