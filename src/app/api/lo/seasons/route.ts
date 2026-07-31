// GET  /api/lo/seasons — every season with scope, config summary and slate size.
// POST /api/lo/seasons — the New Season wizard's single submit (spec §2.2 step 4):
//   creates the season row, its scope rows, and its v1 draft config in one call.
//   Nothing is written before this point.

import { guard, missingReason, readJson, requireReason, respond } from "@/lib/league-office/api-guard";
import { listSeasonSummaries } from "@/lib/league-office/seasons";
import { createSeason, type CreateSeasonInput } from "@/lib/league-office/season-write";

export const dynamic = "force-dynamic";

export async function GET() {
  const g = await guard();
  if (!g.ok) return g.response;

  const seasons = await listSeasonSummaries(g.s);
  return Response.json({ ok: true, seasons });
}

export async function POST(request: Request) {
  const g = await guard();
  if (!g.ok) return g.response;

  const body = await readJson<Partial<CreateSeasonInput>>(request);
  const reason = requireReason(body);
  if (!reason) return missingReason();

  if (!body.name || !body.starts_on || !body.ends_on)
    return Response.json(
      { ok: false, message: "Name, start date and end date are required." },
      { status: 422 }
    );

  const result = await createSeason(g.s, g.email, {
    name: body.name,
    slug: body.slug,
    description: body.description,
    tz: body.tz,
    starts_on: body.starts_on,
    ends_on: body.ends_on,
    // free_agency_* are GENERATED ALWAYS on `seasons` (ends_on − 3 / − 7) and
    // are intentionally not forwarded, even if a client sends them.
    roster_lock_on: body.roster_lock_on ?? null,
    scope: body.scope ?? { mode: "platform" },
    startingPoint: body.startingPoint ?? { mode: "defaults" },
    reason,
  });

  return respond(result);
}
