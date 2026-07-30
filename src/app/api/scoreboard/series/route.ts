// CC-INGEST-TOKENOMICS-SCOREBOARD-1.0 — GET /api/scoreboard/series?metric_id=<id>&window=<days>
// Sparkline history + 7/30/90d % change + annualized realized volatility for one metric_id, DERIVED
// at read time (never stored). Reads raw vintaged rows and computes via the tested pure module so a
// gated index is still refused here too (a metric whose latest reading is display_allowed=false
// returns no values).
//
// Server-only; Supabase service role via PostgREST (mirrors /api/account).

import { computeSeries } from "@/lib/tokenomics/series";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://ycadmmngkdhvpcsrcuaq.supabase.co";
const MAX_WINDOW = 365;

type Svc = { base: string; headers: Record<string, string> };
function svc(): Svc | null {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return null;
  return { base: `${SUPABASE_URL}/rest/v1`, headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" } };
}

export async function GET(request: Request) {
  const s = svc();
  if (!s) return Response.json({ error: "Scoreboard service not configured" }, { status: 500 });

  const params = new URL(request.url).searchParams;
  const metricId = (params.get("metric_id") || "").trim();
  if (!metricId) return Response.json({ error: "Missing metric_id" }, { status: 400 });
  const window = Math.min(MAX_WINDOW, Math.max(1, Number(params.get("window") || 90) || 90));

  const sinceISO = (() => { const d = new Date(); d.setUTCDate(d.getUTCDate() - window); return d.toISOString().slice(0, 10); })();

  // Raw vintaged rows in-window. display_allowed is respected: if the metric is gated, values are
  // withheld (we only compute over displayable readings).
  const url = `${s.base}/tokenomics_metrics`
    + `?metric_id=eq.${encodeURIComponent(metricId)}`
    + `&as_of=gte.${sinceISO}`
    + `&display_allowed=eq.true`
    + `&select=as_of,value,ingested_at&order=as_of.asc,ingested_at.asc`;
  const r = await fetch(url, { headers: s.headers, cache: "no-store" });
  if (!r.ok) return Response.json({ error: "Series lookup failed" }, { status: 500 });
  const rawRows = (await r.json().catch(() => [])) as { as_of: string; value: number | null; ingested_at: string }[];

  // Distinguish "gated" from "genuinely empty": peek at the latest row regardless of gate.
  if (rawRows.length === 0) {
    const chk = await fetch(
      `${s.base}/tokenomics_metrics?metric_id=eq.${encodeURIComponent(metricId)}&select=display_allowed,as_of,source&order=as_of.desc&limit=1`,
      { headers: s.headers, cache: "no-store" },
    );
    const latest = chk.ok ? ((await chk.json().catch(() => []))[0] as { display_allowed?: boolean; as_of?: string; source?: string } | undefined) : undefined;
    if (latest && latest.display_allowed === false) {
      return Response.json({ metric_id: metricId, window_days: window, display_allowed: false,
        placeholder: "licensed source — display pending", as_of: latest.as_of ?? null, source: latest.source ?? null });
    }
    return Response.json({ metric_id: metricId, window_days: window, points: [], latest: null,
      delta_7d: null, delta_30d: null, delta_90d: null, realized_vol: null, n: 0 });
  }

  const series = computeSeries(metricId, rawRows, window);
  return Response.json(series, { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=900" } });
}
