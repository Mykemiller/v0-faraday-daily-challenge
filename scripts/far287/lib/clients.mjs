// FAR-287 — thin REST clients (raw fetch, matching the repo's script conventions;
// no SDKs). All are env-gated and throw a clear error when creds are absent, so the
// scripts fail loud rather than silently no-op.

const need = (name) => { const v = process.env[name]; if (!v) throw new Error(`env ${name} is required`); return v; };

// ── Supabase PostgREST ──────────────────────────────────────────────────────────
export function supabaseEnv() {
  return { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY };
}
async function sbFetch(path, init = {}) {
  const url = need("SUPABASE_URL"), key = need("SUPABASE_SERVICE_ROLE_KEY");
  const res = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`Supabase ${init.method || "GET"} ${path} failed ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.status === 204 ? null : res.json();
}
export const sbSelect = (table, query = "") => sbFetch(`${table}?${query}`);
export const sbInsert = (table, rows, opts = "") =>
  sbFetch(`${table}${opts ? "?" + opts : ""}`, { method: "POST", headers: { Prefer: "return=representation,resolution=merge-duplicates" }, body: JSON.stringify(rows) });
export const sbUpdate = (table, query, patch) =>
  sbFetch(`${table}?${query}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(patch) });
export const sbRpc = (fn, body) => sbFetch(`rpc/${fn}`, { method: "POST", body: JSON.stringify(body || {}) });

// ── Anthropic Messages ──────────────────────────────────────────────────────────
export const GEN_MODEL = process.env.FAR287_GEN_MODEL || "claude-sonnet-4-6";
export async function anthropicJson({ system, user, maxTokens = 4096, model = GEN_MODEL }) {
  const key = need("ANTHROPIC_API_KEY");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
}

// ── Airtable (READ-ONLY here; Phase-6 sync is the only writer and is dry-run by default)
const AT_BASE = "https://api.airtable.com/v0";
export async function airtableGet(baseId, tableId, params = {}) {
  const key = need("AIRTABLE_API_KEY");
  const url = new URL(`${AT_BASE}/${baseId}/${tableId}`);
  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) v.forEach((x) => url.searchParams.append(k, x));
    else if (v != null) url.searchParams.set(k, v);
  }
  const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
  if (!res.ok) throw new Error(`Airtable GET ${tableId} ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}
export async function airtablePatch(baseId, tableId, records) {
  const key = need("AIRTABLE_API_KEY");
  const res = await fetch(`${AT_BASE}/${baseId}/${tableId}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ typecast: true, records }),
  });
  if (!res.ok) throw new Error(`Airtable PATCH ${tableId} ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}
export async function airtableCreate(baseId, tableId, records) {
  const key = need("AIRTABLE_API_KEY");
  const res = await fetch(`${AT_BASE}/${baseId}/${tableId}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ typecast: true, records }),
  });
  if (!res.ok) throw new Error(`Airtable POST ${tableId} ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}
