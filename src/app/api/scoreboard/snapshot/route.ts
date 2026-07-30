// CC-INGEST-TOKENOMICS-SCOREBOARD-1.0 — GET /api/scoreboard/snapshot?region=<RegionId>
// Returns the front-end `ScoreboardSnapshot` contract verbatim (scoreboard-contract.ts §5). This is
// the seam the FE's httpAdapter fetches; flipping USE_MOCK=false changes zero layout.
//
// Region model: the snapshot carries powerPrice for ALL regions in `regions[]`, but the heavy
// tables + fusion panel are for the selected region — so a region change refetches (documented in
// DATA-MAP). Also served at /api/v1/scoreboard/snapshot (the FE's guessed path).
//
// Server-only; Supabase service role. Requires SUPABASE_SERVICE_ROLE_KEY (degrades to a valid empty
// snapshot when unset or before the migration is applied).

import { getSnapshot } from "@/lib/tokenomics/server";

export async function GET(request: Request) {
  const region = new URL(request.url).searchParams.get("region");
  const res = await getSnapshot(region);
  if (!res.ok) return Response.json({ error: res.error }, { status: res.status });
  return Response.json(res.snapshot, {
    headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=900" },
  });
}
