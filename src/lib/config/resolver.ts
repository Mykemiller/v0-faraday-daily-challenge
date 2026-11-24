/**
 * FDY-297 (ADM-2.4) — app settings as data, with a fail-closed env fallback.
 *
 * SERVER-ONLY. Never import this file from a client component: it reads the Faraday service-role key.
 * (In the browser the key env var is undefined, so every read would fail closed to the env value anyway.)
 *
 * Mirrors the reference resolver in Mykemiller/Faraday-Workbench api/_config.js (FDY-295, ADM-2.2):
 *   - reads public.v_effective_config (service_role SELECT only) for one app and scope;
 *   - cache: one entry per (app, scope), kept AT MOST 60 s; a failed read is never cached;
 *   - 4 s timeout; any failure, timeout or malformed row answers { ok: false, reason }.
 *
 * resolveSettings() then applies the D5 / FDY-252 D-05 rule, per setting:
 *   - the read failed, the key is unknown, or the value has the wrong type / is out of range  -> env value
 *   - nobody has set a value (source = 'default', is_default = true)                            -> env value
 *   - somebody set a value in the console (source = setting | version | inherited)             -> that value
 * Deferring a definition default to env means applying the migration or deploying this code can never change
 * behaviour on its own, even if a Vercel value differs from the code default recorded in app_setting_def.
 *
 * Logs carry the app code, reason code and setting keys only: never a key, URL credential or value.
 */

export const CACHE_MS = 60_000;
export const READ_TIMEOUT_MS = 4_000;
export const FARADAY_PROJECT_REF = "ycadmmngkdhvpcsrcuaq";
export const FARADAY_URL = `https://${FARADAY_PROJECT_REF}.supabase.co`;
export const SOURCES = ["version", "inherited", "setting", "default"] as const;
export type Source = (typeof SOURCES)[number];

const CODE_RE = /^[A-Z]{2}$/;
const SCOPE_RE = /^[a-z][a-z0-9_-]{0,31}$/;
const COLS = "app_code,scope,key,type,enforcement_status,value,source,is_default,default_value";

export interface ConfigRow {
  app_code: string;
  scope: string;
  key: string;
  type?: string;
  enforcement_status?: string;
  value: unknown;
  source: Source;
  is_default: boolean;
  default_value?: unknown;
}

export type ResolveResult =
  | { ok: true; app: string; scope: string; values: Readonly<Record<string, unknown>>; rows: ConfigRow[]; asOf: string }
  | { ok: false; reason: string };

/** fetch-like: only ok and json() are used. */
export interface ResponseLike {
  ok: boolean;
  json(): Promise<unknown>;
}
export type Client = (url: string, init: { method: string; headers: Record<string, string>; signal?: AbortSignal; cache?: string }) => Promise<ResponseLike>;

export interface ResolverOptions {
  /** fetch-like client; defaults to global fetch with cache: 'no-store'. */
  client?: Client;
  /** Supabase URL; defaults to env (see urlFromEnv) at call time. Must be the Faraday project. */
  url?: string | (() => string | undefined);
  /** service-role key; defaults to env (see keyFromEnv) at call time. */
  key?: string | (() => string | undefined);
  now?: () => number;
  /** Clamped to at most 60 s. */
  cacheMs?: number;
  timeoutMs?: number;
}

/** Names only — these are the env vars this module reads by default. */
export const URL_ENV_NAMES = ["FARADAY_SUPABASE_URL", "SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"] as const;
export const KEY_ENV_NAMES = ["FARADAY_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_ROLE_KEY"] as const;

function firstEnv(names: readonly string[]): string | undefined {
  for (const n of names) {
    const v = (typeof process !== "undefined" ? process.env[n] : undefined)?.trim();
    if (v) return v;
  }
  return undefined;
}
export const urlFromEnv = () => firstEnv(URL_ENV_NAMES) ?? FARADAY_URL;
export const keyFromEnv = () => firstEnv(KEY_ENV_NAMES);

/** One v_effective_config row is usable only if it has the shape the view promises. */
export function validRow(r: unknown, app: string, scope: string): r is ConfigRow {
  if (!r || typeof r !== "object") return false;
  const x = r as Record<string, unknown>;
  return x.app_code === app && x.scope === scope && typeof x.key === "string" && x.key !== ""
    && Object.prototype.hasOwnProperty.call(x, "value")
    && (SOURCES as readonly unknown[]).includes(x.source) && typeof x.is_default === "boolean"
    && x.is_default === (x.source === "default");
}

const defaultClient: Client = (url, init) => fetch(url, init as RequestInit) as Promise<ResponseLike>;
const pick = (v: string | (() => string | undefined) | undefined, dflt: () => string | undefined) =>
  v === undefined ? dflt() : typeof v === "function" ? v() : v;

export function createResolver(opts: ResolverOptions = {}) {
  const client = opts.client ?? defaultClient;
  const now = opts.now ?? Date.now;
  const cacheMs = Math.min(Number.isFinite(opts.cacheMs) ? (opts.cacheMs as number) : CACHE_MS, CACHE_MS);
  const timeoutMs = Number.isFinite(opts.timeoutMs) ? (opts.timeoutMs as number) : READ_TIMEOUT_MS;
  const cache = new Map<string, { at: number; result: ResolveResult }>();

  async function read(base: string, key: string, app: string, scope: string): Promise<{ ok: true; rows: ConfigRow[] } | { ok: false; reason: string }> {
    const ac = typeof AbortController === "function" ? new AbortController() : null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { ac?.abort(); reject(new Error("timeout")); }, timeoutMs);
    });
    try {
      const url = `${base.replace(/\/+$/, "")}/rest/v1/v_effective_config?select=${COLS}&app_code=eq.${app}&scope=eq.${scope}&order=key.asc&limit=1000`;
      const res = await Promise.race([
        client(url, {
          method: "GET",
          headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" },
          signal: ac?.signal,
          cache: "no-store",
        }),
        timeout,
      ]);
      if (!res || !res.ok) return { ok: false, reason: "read_failed" };
      const rows = await Promise.race([res.json(), timeout]);
      if (!Array.isArray(rows)) return { ok: false, reason: "bad_response" };
      if (!rows.every((r) => validRow(r, app, scope))) return { ok: false, reason: "bad_row" };
      return { ok: true, rows: rows as ConfigRow[] };
    } catch (e) {
      return { ok: false, reason: e instanceof Error && e.message === "timeout" ? "timeout" : "read_failed" };
    } finally {
      clearTimeout(timer);
    }
  }

  async function resolve(app: string, scope?: string): Promise<ResolveResult> {
    const a = String(app ?? "").trim().toUpperCase();
    const s = scope === undefined || scope === null || scope === "" ? "default" : String(scope);
    if (!CODE_RE.test(a)) return { ok: false, reason: "bad_app" };
    if (!SCOPE_RE.test(s)) return { ok: false, reason: "bad_scope" };
    const k = `${a}|${s}`;
    const t = now();
    const hit = cache.get(k);
    if (hit && t - hit.at < cacheMs) return hit.result;
    cache.delete(k); // an expired entry is gone even if the next read fails
    const base = pick(opts.url, urlFromEnv);
    if (!base || !base.includes(FARADAY_PROJECT_REF)) return { ok: false, reason: "wrong_project" };
    const key = pick(opts.key, keyFromEnv);
    if (!key) return { ok: false, reason: "no_service_key" };
    const got = await read(base, key, a, s);
    if (!got.ok) return got; // failures are never cached
    const values: Record<string, unknown> = {};
    for (const r of got.rows) values[r.key] = r.value;
    const result: ResolveResult = Object.freeze({
      ok: true as const, app: a, scope: s, values: Object.freeze(values), rows: got.rows, asOf: new Date(t).toISOString(),
    });
    cache.set(k, { at: t, result });
    return result;
  }

  return { resolve, clear: () => cache.clear(), CACHE_MS: cacheMs };
}
export type Resolver = ReturnType<typeof createResolver>;

// ---------------------------------------------------------------------------
// Settings with env fallback
// ---------------------------------------------------------------------------
export type SettingSpec =
  | { key: string; type: "boolean"; env: () => boolean }
  | { key: string; type: "integer"; min?: number; max?: number; env: () => number }
  | { key: string; type: "enum"; options: readonly string[]; env: () => string }
  | { key: string; type: "text"; env: () => string };

type ValueOf<S> = S extends { env: () => infer T } ? T : never;
export type SettingValues<M extends Record<string, SettingSpec>> = { [K in keyof M]: ValueOf<M[K]> };
export type SettingSources<M extends Record<string, SettingSpec>> = { [K in keyof M]: "data" | "env" };

function accept(spec: SettingSpec, v: unknown): boolean {
  switch (spec.type) {
    case "boolean": return typeof v === "boolean";
    case "integer":
      return typeof v === "number" && Number.isInteger(v)
        && (spec.min === undefined || v >= spec.min) && (spec.max === undefined || v <= spec.max);
    case "enum": return typeof v === "string" && spec.options.includes(v);
    case "text": return typeof v === "string";
  }
}

export type Logger = (line: string) => void;
const defaultLog: Logger = (line) => console.warn(line);

/**
 * Resolve each setting: a value set in the console wins; otherwise (or on any failure) the env value.
 * Never throws: a resolver that throws is treated as a failed read.
 */
export async function resolveSettings<M extends Record<string, SettingSpec>>(
  resolver: Pick<Resolver, "resolve">,
  app: string,
  specs: M,
  opts: { scope?: string; log?: Logger } = {},
): Promise<{ values: SettingValues<M>; sources: SettingSources<M>; reason: string | null }> {
  const log = opts.log ?? defaultLog;
  let r: ResolveResult;
  try {
    r = await resolver.resolve(app, opts.scope);
  } catch {
    r = { ok: false, reason: "read_failed" };
  }
  const values = {} as Record<string, unknown>;
  const sources = {} as Record<string, "data" | "env">;
  const rejected: string[] = [];
  for (const [name, spec] of Object.entries(specs)) {
    const row = r.ok ? r.rows.find((x) => x.key === spec.key) : undefined;
    if (row && !row.is_default && accept(spec, row.value)) {
      values[name] = row.value;
      sources[name] = "data";
    } else {
      if (row && !row.is_default) rejected.push(spec.key);
      values[name] = spec.env();
      sources[name] = "env";
    }
  }
  if (!r.ok) log(`[config] ${app}: settings read failed (${r.reason}); using env values for ${Object.values(specs).map((s) => s.key).join(", ")}`);
  else if (rejected.length) log(`[config] ${app}: ignored set values with the wrong type or range for ${rejected.join(", ")}; using env values`);
  return { values: values as SettingValues<M>, sources: sources as SettingSources<M>, reason: r.ok ? null : r.reason };
}
