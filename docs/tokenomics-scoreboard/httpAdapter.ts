// CC-INGEST-TOKENOMICS-SCOREBOARD-1.0 — DROP-IN httpAdapter for the Tokenomics Scoreboard FRONT END.
// Copy this to the front-end project as `src/data/httpAdapter.ts`. It implements the FE's
// `ScoreboardAdapter` against the live Faraday backend built in faraday-daily-challenge. The backend
// returns the exact `ScoreboardSnapshot` shape, so this is a thin fetch — no mapping.
//
// Going live (per the FE prompt §6): set VITE_USE_MOCK=false and VITE_API_BASE to this app's origin
// (e.g. https://faraday-intelligence.ai). Route paths below are the ingest CC's REAL routes.
//
// import type { ScoreboardSnapshot, SubscriberPrefs, RegionId } from "./types";  // FE's own contract

// ── config ────────────────────────────────────────────────────────────────────
const API_BASE = (import.meta as { env?: Record<string, string> }).env?.VITE_API_BASE ?? "";
const SESSION_KEY = "dc_session"; // dc_sessions token, set at magic-link/OTP auth (matches the DC app)

function sessionToken(): string | null {
  try { return localStorage.getItem(SESSION_KEY); } catch { return null; }
}
function authHeaders(): Record<string, string> {
  const t = sessionToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

export class SchemaVersionError extends Error {
  constructor(public got: string) { super(`Unknown snapshot schemaVersion "${got}"`); }
}

// ── adapter ─────────────────────────────────────────────────────────────────────
export const httpAdapter /*: ScoreboardAdapter */ = {
  async getSnapshot(opts: { region?: string; signal?: AbortSignal }) /*: Promise<ScoreboardSnapshot>*/ {
    const qs = opts.region ? `?region=${encodeURIComponent(opts.region)}` : "";
    const r = await fetch(`${API_BASE}/api/v1/scoreboard/snapshot${qs}`, {
      signal: opts.signal, headers: { Accept: "application/json" },
    });
    if (!r.ok) throw new Error(`snapshot ${r.status}`);
    const snap = await r.json();
    // Unknown schema => let the caller keep the last good snapshot + show the amber banner (FE §6).
    if (snap?.schemaVersion !== "1.0") throw new SchemaVersionError(String(snap?.schemaVersion));
    return snap;
  },

  async getPrefs() /*: Promise<SubscriberPrefs>*/ {
    const r = await fetch(`${API_BASE}/api/v1/subscriber/prefs`, {
      headers: { Accept: "application/json", ...authHeaders() },
    });
    if (r.status === 401) {
      // Not signed in: return an anonymous prefs object so the 5th column shows awaiting_selection.
      return { subscriberId: "", pickedProviderId: null, selectedRegion: null, theme: "system" };
    }
    if (!r.ok) throw new Error(`prefs ${r.status}`);
    return r.json();
  },

  async setPrefs(patch: Record<string, unknown>) /*: Promise<SubscriberPrefs>*/ {
    const r = await fetch(`${API_BASE}/api/v1/subscriber/prefs`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Accept: "application/json", ...authHeaders() },
      body: JSON.stringify(patch),
    });
    if (!r.ok) throw new Error(`setPrefs ${r.status}`);
    return r.json();
  },

  // No SSE endpoint yet — poll on cadenceSec (FE §6). Leave subscribe undefined so the FE polls.
};
