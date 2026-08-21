// Factory-built game rows for tests (CC-DC-GAME-REGISTRY-1.0 D10).
//
// Tests must not carry their own hardcoded list of the seven live games — that
// is the same drift the CC removes from the app. They build the rows they need.
//
// `gameRow()` returns a complete, valid catalog row with neutral placeholder
// values. Override only the fields a test actually cares about, so a test never
// silently depends on a real game's accent, prefix, or par time.

let seq = 0;

/** @param {Partial<Record<string, any>>} [over] */
export function gameRow(over = {}) {
  seq += 1;
  const n = seq;
  const base = {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    game_key: `test_game_${n}`,
    display_name: `Test Game ${n}`,
    runtime_key: `Test Game ${n}`,
    short_code: `TG${n}`,
    public_id_prefix: `TG${String(n).padStart(2, "0")}`.slice(0, 4).toUpperCase(),
    lifecycle_state: "live",
    is_publishable: true,
    route_slug: `test-game-${n}`,
    accent_hex: "#48FF54",
    accent_deep_hex: "#38C742",
    accent_glow_rgba: "rgba(72,255,84,.28)",
    lobby_sort_order: n * 10,
    lobby_description: `Description ${n}`,
    lobby_time_estimate: "~2 min",
    lobby_format_chip: "Format",
    par_seconds: 90,
    take_voice: "Gilbert Faraday",
    grid_fit: "fluid",
    signal_enabled: false,
    is_core: false,
    share_epoch: "2026-06-24",
    sort_order: n * 10,
    description: `Catalog description ${n}`,
    name_is_answer: false,
    is_hero_cta: false,
  };
  return { ...base, ...over };
}

/** N distinct rows, in lobby order. */
export function gameRows(count, over = {}) {
  return Array.from({ length: count }, () => gameRow(over));
}

/** Reset the counter so ids/names are deterministic within a test file. */
export function resetGameRowSeq() {
  seq = 0;
}
