// CC-INGEST-TOKENOMICS-SCOREBOARD-1.0 — server-only data access for the scoreboard API. Gathers
// raw rows via the service role (PostgREST) and runs the pure transform (snapshot_v1) to emit the
// front-end `ScoreboardSnapshot`. Imported ONLY by route handlers — never by a client component.
//
// Degrades gracefully: if the tokenomics_metrics table / RPCs don't exist yet (migration un-applied)
// every fetch returns null -> the transform yields a VALID, all-"not_published" snapshot. So the FE
// can be wired and rendering the live shape before any data flows — the correct empty state.

import { assembleSnapshotV1, type FusionResult } from "./snapshot_v1";
import {
  type ScoreboardSnapshot, type SubscriberPrefs, type RegionId,
  REGION_MODEL, REGION_IDS, normalizeRegionId, isRegionId,
} from "./scoreboard-contract";
import type { RawMetricRow, SourceRegistryRow } from "./types";
import { isValidPick5, DEFAULT_PICK5 } from "./roster";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://ycadmmngkdhvpcsrcuaq.supabase.co";

type Svc = { base: string; headers: Record<string, string> };
export function svc(): Svc | null {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return null;
  return { base: `${SUPABASE_URL}/rest/v1`, headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" } };
}

async function rpc<T>(s: Svc, fn: string, args: Record<string, unknown>): Promise<T | null> {
  try {
    const r = await fetch(`${s.base}/rpc/${fn}`, { method: "POST", headers: s.headers, body: JSON.stringify(args), cache: "no-store" });
    if (!r.ok) return null;
    return (await r.json().catch(() => null)) as T | null;
  } catch { return null; }
}
async function getJson<T>(s: Svc, path: string): Promise<T | null> {
  try {
    const r = await fetch(`${s.base}/${path}`, { headers: s.headers, cache: "no-store" });
    if (!r.ok) return null;
    return (await r.json().catch(() => null)) as T | null;
  } catch { return null; }
}

// Build the full ScoreboardSnapshot for a region. Region filtering happens in the transform (rows
// carry ingested cloud-region strings; the transform buckets them into the FE RegionId enum), so we
// fetch freshest-per-metric across ALL regions in one call.
export async function getSnapshot(regionParam: string | null): Promise<{ ok: true; snapshot: ScoreboardSnapshot } | { ok: false; status: number; error: string }> {
  const s = svc();
  const selectedRegion = normalizeRegionId(regionParam);
  const generatedAt = new Date().toISOString();

  if (!s) {
    // No service role configured: still return a valid empty snapshot so the FE renders its states.
    const snapshot = assembleSnapshotV1({ rows: [], sourceRegistry: [], fusionByRegion: {}, selectedRegion, generatedAt });
    return { ok: true, snapshot };
  }

  const rows = (await rpc<RawMetricRow[]>(s, "fn_tokenomics_snapshot_rows", { p_category: null, p_region: null })) ?? [];
  const sourceRegistry = (await getJson<SourceRegistryRow[]>(
    s, "tokenomics_source_registry?select=source_key,label,tier,cadence,is_third_party_index,display_allowed,attribution",
  )) ?? [];

  // Fusion per US region (for regions[].powerPrice + the selected region's panel).
  const fusionByRegion: Partial<Record<RegionId, FusionResult>> = {};
  await Promise.all(REGION_IDS.map(async (id) => {
    const geo = REGION_MODEL[id];
    if (!geo.state_abbr) return; // non-US: no Faraday grid data
    const f = await rpc<FusionResult>(s, "fn_scoreboard_fusion", { p_state_abbr: geo.state_abbr, p_iso_rto: geo.iso_rto });
    if (f) fusionByRegion[id] = f;
  }));

  const snapshot = assembleSnapshotV1({ rows, sourceRegistry, fusionByRegion, selectedRegion, generatedAt });
  return { ok: true, snapshot };
}

// ── Subscriber prefs (FE SubscriberPrefs shape) ──────────────────────────────────
async function resolveSubscriber(s: Svc, token: string): Promise<string | null> {
  const rows = await getJson<{ subscriber_id?: string; expires_at?: string }[]>(
    s, `dc_sessions?token=eq.${encodeURIComponent(token)}&select=subscriber_id,expires_at`);
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) return null;
  if (row.expires_at && new Date(row.expires_at) < new Date()) return null;
  return row.subscriber_id ?? null;
}

function toPrefs(subscriberId: string, raw: Record<string, unknown>): SubscriberPrefs {
  const pick = typeof raw.pick5 === "string" && isValidPick5(raw.pick5) ? raw.pick5 : null;
  const region = typeof raw.region === "string" && isRegionId(raw.region) ? raw.region : null;
  const theme = raw.theme === "dark" || raw.theme === "light" || raw.theme === "system" ? raw.theme : "system";
  return { subscriberId, pickedProviderId: pick, selectedRegion: region, theme };
}

export async function getPrefs(token: string): Promise<{ ok: true; prefs: SubscriberPrefs } | { ok: false; status: number; error: string }> {
  const s = svc();
  if (!s) return { ok: false, status: 500, error: "Scoreboard service not configured" };
  const id = await resolveSubscriber(s, token);
  if (!id) return { ok: false, status: 401, error: "Invalid or expired session" };
  const rows = await getJson<{ scoreboard_prefs?: Record<string, unknown> }[]>(s, `dc_subscribers?id=eq.${id}&select=scoreboard_prefs`);
  const raw = (Array.isArray(rows) && rows[0]?.scoreboard_prefs && typeof rows[0].scoreboard_prefs === "object") ? rows[0].scoreboard_prefs! : {};
  return { ok: true, prefs: toPrefs(id, raw) };
}

// Accepts FE SubscriberPrefs field names (pickedProviderId, selectedRegion, theme). Stored as
// {pick5, region, theme} in dc_subscribers.scoreboard_prefs (matching the ingest migration's column).
export async function setPrefs(token: string, patch: Partial<SubscriberPrefs>):
  Promise<{ ok: true; prefs: SubscriberPrefs } | { ok: false; status: number; error: string }> {
  const s = svc();
  if (!s) return { ok: false, status: 500, error: "Scoreboard service not configured" };
  const id = await resolveSubscriber(s, token);
  if (!id) return { ok: false, status: 401, error: "Invalid or expired session" };

  const cur = await getJson<{ scoreboard_prefs?: Record<string, unknown> }[]>(s, `dc_subscribers?id=eq.${id}&select=scoreboard_prefs`);
  const next: Record<string, unknown> = { ...((Array.isArray(cur) && typeof cur[0]?.scoreboard_prefs === "object") ? cur[0].scoreboard_prefs! : {}) };

  if (patch.pickedProviderId !== undefined) {
    if (patch.pickedProviderId !== null && !isValidPick5(patch.pickedProviderId)) return { ok: false, status: 422, error: `Invalid provider "${patch.pickedProviderId}" — must be a NEOCLOUD_ROSTER candidate.` };
    next.pick5 = patch.pickedProviderId; // may be null to clear the pick
  }
  if (patch.selectedRegion !== undefined) {
    if (patch.selectedRegion !== null && !isRegionId(patch.selectedRegion)) return { ok: false, status: 422, error: `Unknown region "${patch.selectedRegion}".` };
    next.region = patch.selectedRegion;
  }
  if (patch.theme !== undefined) {
    if (!["light", "dark", "system"].includes(patch.theme)) return { ok: false, status: 422, error: `Invalid theme "${patch.theme}".` };
    next.theme = patch.theme;
  }

  try {
    const r = await fetch(`${s.base}/dc_subscribers?id=eq.${id}`, {
      method: "PATCH", headers: { ...s.headers, Prefer: "return=minimal" }, body: JSON.stringify({ scoreboard_prefs: next }),
    });
    if (!r.ok) return { ok: false, status: 500, error: "Could not save preferences" };
  } catch { return { ok: false, status: 500, error: "Could not save preferences" }; }
  return { ok: true, prefs: toPrefs(id, next) };
}

export { DEFAULT_PICK5 };
