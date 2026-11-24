#!/usr/bin/env node
// FDY-433 (ADM-1.7h) — end-to-end smoke for the Predicts gate carve-out, run against a real
// `next start` of a finished `npm run build`. A local mock answers estate_entitled, so nothing
// touches Supabase and no gate mode changes anywhere.
//
//   npm run build && node scripts/faraday-gate-carveout-smoke.mjs
//
// For each mode it checks: mode "invite" + FARADAY_GATE_ENFORCE=1 → a stranger gets the gate on the
// Predicts board but HTTP 200 and the real page on /predicts/preferences; mode "open" → no gate anywhere.
import http from "node:http";
import { spawn } from "node:child_process";

const MOCK_PORT = 54399;
const APP_PORT = 3999;
let mode = "invite";

const mock = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    if (req.method === "POST" && req.url?.startsWith("/rest/v1/rpc/estate_entitled")) {
      const answer = mode === "open"
        ? { allowed: true, reason: "open", mode: "open" }
        : { allowed: false, reason: "no_grant", mode: "invite" };
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(answer));
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end("{}");
  });
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function startApp() {
  const env = {
    ...process.env,
    PORT: String(APP_PORT),
    SUPABASE_URL: `http://127.0.0.1:${MOCK_PORT}`,
    SUPABASE_SERVICE_ROLE_KEY: "smoke-test-not-a-key",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "smoke-test-not-a-key",
    FARADAY_GATE_ENFORCE: "1",
    // the mock is local: keep any outbound proxy away from it
    NO_PROXY: "127.0.0.1,localhost",
    no_proxy: "127.0.0.1,localhost",
  };
  try {
    await fetch(`http://127.0.0.1:${APP_PORT}/`);
    throw new Error(`port ${APP_PORT} is already in use; stop that server first`);
  } catch (e) {
    if (String(e?.message).includes("already in use")) throw e;
  }
  // Own process group, so stop() takes down next-server too (killing only the launcher leaves it running).
  const child = spawn("node_modules/.bin/next", ["start", "-p", String(APP_PORT)], { env, stdio: "ignore", detached: true });
  const stop = () => { try { process.kill(-child.pid, "SIGTERM"); } catch { /* already gone */ } };
  for (let i = 0; i < 60; i++) {
    try { await fetch(`http://127.0.0.1:${APP_PORT}/predicts/manifest.webmanifest`); return { stop }; } catch { await sleep(500); }
  }
  stop();
  throw new Error("next start did not come up");
}

const GATE_MARK = /Request demo access|Join the waitlist|data-faraday-gate/;
async function probe(path) {
  const r = await fetch(`http://127.0.0.1:${APP_PORT}${path}`, { redirect: "manual", headers: { Accept: "text/html" } });
  const text = await r.text();
  return { status: r.status, gated: GATE_MARK.test(text) };
}

let failures = 0;
function expect(label, cond, detail) {
  console.log(`${cond ? "ok  " : "FAIL"} ${label}${detail ? `  (${detail})` : ""}`);
  if (!cond) failures++;
}

await new Promise((r) => mock.listen(MOCK_PORT, "127.0.0.1", r));
try {
  // A fresh server per mode: the gate caches each answer for 60 s, so "invite" must not carry over.
  for (const m of ["invite", "open"]) {
    mode = m;
    const app = await startApp();
    try {
      const board = await probe("/predicts");
      const record = await probe("/predicts/record");
      const prefs = await probe("/predicts/preferences");
      if (m === "invite") {
        expect("invite: /predicts shows the gate", board.gated, `HTTP ${board.status}`);
        expect("invite: /predicts/record shows the gate", record.gated, `HTTP ${record.status}`);
        expect("invite: /predicts/preferences is 200 with no gate", prefs.status === 200 && !prefs.gated, `HTTP ${prefs.status}`);
      } else {
        expect("open: /predicts is 200 with no gate", board.status === 200 && !board.gated, `HTTP ${board.status}`);
        expect("open: /predicts/record is 200 with no gate", record.status === 200 && !record.gated, `HTTP ${record.status}`);
        expect("open: /predicts/preferences is 200 with no gate", prefs.status === 200 && !prefs.gated, `HTTP ${prefs.status}`);
      }
    } finally {
      app.stop();
      await sleep(1500);
    }
  }
} finally {
  mock.close();
}
console.log(failures ? `${failures} check(s) failed` : "all checks passed");
process.exit(failures ? 1 : 0);
