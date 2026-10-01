// Faraday Academy — on-demand revalidation.
//
// Called by the academy_courses status-change trigger through net.http_post. The
// shared secret lives in Vault on the database side and in the environment here.
// A timing-safe comparison, because a fast string compare on a shared secret is a
// free oracle.

import { revalidateTag } from "next/cache";
import { timingSafeEqual } from "node:crypto";
import { ACADEMY_TAG } from "@/lib/academy/api";

function secretMatches(given: string | null): boolean {
  const expected = process.env.ACADEMY_REVALIDATE_SECRET;
  if (!expected || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(request: Request): Promise<Response> {
  const given =
    request.headers.get("x-academy-revalidate-secret") ??
    request.headers.get("x-revalidate-secret");

  if (!secretMatches(given)) {
    // Same opaque response whether the secret is missing, wrong or unconfigured.
    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Next 16 requires the profile argument. "max" marks the tag stale and serves
  // stale-while-revalidate, which matches the edge function's own cache headers —
  // a status change does not need a blocking purge.
  revalidateTag(ACADEMY_TAG, "max");

  return new Response(JSON.stringify({ revalidated: true, tag: ACADEMY_TAG }), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
