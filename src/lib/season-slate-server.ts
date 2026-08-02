// Season slate — server-side resolution of which games the active season serves.
//
// Reads: active season → its ACTIVE season_config → enabled season_games →
// game_catalog.runtime_key. That last hop matters: `runtime_key` is the join key
// the runtime actually uses (D3), while `game_key` is a snake_case slug nothing
// joins on. Keying off game_key here would silently match nothing and — via the
// fail-safe — look like "no slate configured" forever.
//
// NEVER THROWS. Every failure path returns null, which callers treat as "no
// slate" and therefore serve everything. See season-slate.ts for why.

const SUPABASE_URL =
  process.env.SUPABASE_URL || "https://ycadmmngkdhvpcsrcuaq.supabase.co";

/** Kill switch. Set DC_SLATE_ENFORCEMENT=off to restore pre-D4-retirement
 *  behaviour without a code change (still needs a redeploy — server env). */
function enforcementDisabled(): boolean {
  const v = (process.env.DC_SLATE_ENFORCEMENT || "").trim().toLowerCase();
  return v === "off" || v === "0" || v === "false";
}

function svcHeaders(): Record<string, string> | null {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return null;
  return { apikey: key, Authorization: `Bearer ${key}` };
}

async function rows<T>(headers: Record<string, string>, path: string): Promise<T[]> {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers, cache: "no-store" });
    if (!r.ok) return [];
    const j = await r.json().catch(() => null);
    return Array.isArray(j) ? (j as T[]) : [];
  } catch {
    return [];
  }
}

/**
 * The enabled `runtime_key` list for the active season, or null.
 *
 * null means "serve everything" and is returned for every one of:
 *   · enforcement killed by env
 *   · no service-role key
 *   · no active season
 *   · the season has no ACTIVE config (true for 3 of 6 seasons in prod today)
 *   · the config has no enabled games
 *   · any fetch/parse failure
 */
export async function resolveActiveSeasonSlate(): Promise<string[] | null> {
  if (enforcementDisabled()) return null;

  const h = svcHeaders();
  if (!h) return null;

  const season = (
    await rows<{ id: string }>(h, `seasons?status=eq.active&select=id&order=starts_on.desc&limit=1`)
  )[0];
  if (!season?.id) return null;

  // The config actually in force. `state=eq.active` is the same predicate the
  // League Office uses; a draft or scheduled version must NOT gate serving.
  const config = (
    await rows<{ id: string }>(
      h,
      `season_config?season_id=eq.${encodeURIComponent(season.id)}&state=eq.active&select=id&limit=1`
    )
  )[0];
  if (!config?.id) return null;

  const slate = await rows<{ game_catalog: { runtime_key: string | null } | null }>(
    h,
    `season_games?season_config_id=eq.${encodeURIComponent(config.id)}` +
      `&is_enabled=eq.true&select=game_catalog(runtime_key)`
  );

  const keys = slate
    .map((r) => r.game_catalog?.runtime_key)
    .filter((k): k is string => typeof k === "string" && k.length > 0);

  return keys.length > 0 ? keys : null;
}
