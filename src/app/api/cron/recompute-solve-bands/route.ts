// GET /api/cron/recompute-solve-bands — FAR-388 Market Reaction Speed bands.
//
// Recomputes the per-game-type solve-time percentile terciles (p33/p67 seconds)
// into dc_solve_time_bands from the persisted dc_completions.solve_seconds, via
// the fn_recompute_solve_time_bands() RPC. The client's Market Reaction band
// reads these (served through /api/challenge/today) and falls back to seed par
// times for any game type still below the sample floor.
//
// "A periodic recompute is fine" (FAR-388) — a daily cadence is ample; solve-time
// norms drift slowly and the band is presentation-only, never a scoring input.
// Idempotent: the RPC upserts by game_type and prunes stale rows, so re-running
// (e.g. a manual ?force run right after the scheduled one) is a safe no-op.
//
// Auth: CRON_SECRET Bearer (same pattern as /api/cron/sync-day-content).
// Requires SUPABASE_SERVICE_ROLE_KEY (the RPC is granted to service_role only).

export const dynamic = "force-dynamic";

const SUPABASE_URL =
  process.env.SUPABASE_URL || "https://ycadmmngkdhvpcsrcuaq.supabase.co";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return Response.json(
      { ok: false, error: "SUPABASE_SERVICE_ROLE_KEY not set" },
      { status: 500 }
    );
  }

  // Optional overrides (both bounded) for manual runs; defaults match the RPC.
  const params = new URL(request.url).searchParams;
  const minSample = clampInt(params.get("minSample"), 20, 1, 100000);
  const lookbackDays = clampInt(params.get("lookbackDays"), 30, 1, 3650);

  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/rpc/fn_recompute_solve_time_bands`,
      {
        method: "POST",
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          "Content-Type": "application/json",
        },
        cache: "no-store",
        body: JSON.stringify({
          p_min_sample: minSample,
          p_lookback_days: lookbackDays,
        }),
      }
    );

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error("[recompute-solve-bands] RPC failed:", res.status, detail);
      return Response.json(
        { ok: false, error: `RPC ${res.status}`, detail: detail.slice(0, 500) },
        { status: 502 }
      );
    }

    // The RPC returns the number of band rows written.
    const bandsWritten = await res.json().catch(() => null);
    return Response.json({
      ok: true,
      bandsWritten: typeof bandsWritten === "number" ? bandsWritten : null,
      minSample,
      lookbackDays,
    });
  } catch (err) {
    console.error("[recompute-solve-bands] error:", err);
    return Response.json({ ok: false, error: "Recompute failed" }, { status: 500 });
  }
}

function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
  const n = raw != null ? Number.parseInt(raw, 10) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
