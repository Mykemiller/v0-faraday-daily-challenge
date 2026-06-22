// GET /api/cron/rotate — AUTO-128 Daily Puzzle Rotator.
//
// Flips the Airtable Puzzle Bank serve state at midnight US Central:
//   Published (Go Live Date = today, America/Chicago) → Live
//   Live      (Go Live Date ≠ today)                  → Retired
//
// Vercel cron fires this at 05:00 and 06:00 UTC (vercel.json). Exactly one of
// those is 00:00 in America/Chicago depending on CST/CDT; the other run is a
// no-op via the midnight guard below. A manual run can bypass the guard with
// ?force=1 (still requires the secret when CRON_SECRET is set).
//
// Requires AIRTABLE_API_KEY (legacy FARADAY_AIRTABLE_API_KEY also honored) with
// write access to the Puzzle Bank.

import { rotateLiveSet } from "@/lib/airtable-puzzle-bank";

export const dynamic = "force-dynamic";

// Current date (YYYY-MM-DD) and hour in America/Chicago, DST-aware.
function chicagoNow() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    hour: Number(get("hour")),
  };
}

export async function GET(request) {
  // Vercel sends `Authorization: Bearer ${CRON_SECRET}` on cron invocations.
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const force = new URL(request.url).searchParams.get("force") === "1";
  const { date: today, hour } = chicagoNow();
  if (!force && hour !== 0) {
    return Response.json({ ok: true, skipped: true, reason: `Not midnight in America/Chicago (hour=${hour})` });
  }

  try {
    const result = await rotateLiveSet(today);
    if (result.missingTypes.length > 0) {
      console.error(`[AUTO-128] Bank gap for ${today}: no puzzle went live for ${result.missingTypes.join(", ")}`);
    }
    console.log(`[AUTO-128] Rotated for ${today}:`, JSON.stringify(result));
    return Response.json({ ok: true, today, ...result });
  } catch (err) {
    // Structured failure log: which step threw, the record ids it was acting
    // on, and the full upstream error — so the next failure is diagnosable from
    // the log alone rather than a truncated message.
    const failure = {
      today,
      step: err?.step ?? "unknown",
      recordIds: err?.recordIds ?? [],
      error: err?.message ? String(err.message) : String(err),
      cause: err?.cause?.message ? String(err.cause.message) : undefined,
    };
    console.error("[AUTO-128] Rotation failed:", JSON.stringify(failure));
    return Response.json({ ok: false, ...failure }, { status: 500 });
  }
}
