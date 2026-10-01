// Faraday Academy player — server-side read path.
//
// Every read goes through the academy-public edge function. The anon key has no
// access to academy tables and the service role key lives only inside that
// function, so there is no direct-to-Postgres path here by design.
//
// Caching: ISR at 300s with the shared "academy" tag, so the /api/revalidate
// route (called by the academy_courses status trigger) can refresh the whole
// surface at once.

import { EDGE_FUNCTIONS_BASE } from "@/lib/supabase";
import type { Catalog, Course, ReadResult, Sitemap } from "./types";

export const ACADEMY_TAG = "academy";
export const ACADEMY_REVALIDATE_SECONDS = 300;

const BASE = `${EDGE_FUNCTIONS_BASE}/academy-public`;

async function read<T>(path: string): Promise<ReadResult<T>> {
  try {
    const res = await fetch(`${BASE}${path}`, {
      // No apikey header: the function is deployed with --no-verify-jwt and does
      // its own handler-level checks. Reads need no auth at all.
      headers: { Accept: "application/json" },
      next: { revalidate: ACADEMY_REVALIDATE_SECONDS, tags: [ACADEMY_TAG] },
    });
    if (res.status === 404) return { ok: false, reason: "missing" };
    if (!res.ok) return { ok: false, reason: "offline" };
    return { ok: true, data: (await res.json()) as T };
  } catch {
    // Network failure, DNS, or the function not yet deployed. The caller renders
    // the offline state rather than throwing a 500 at the reader.
    return { ok: false, reason: "offline" };
  }
}

export function getCatalog(): Promise<ReadResult<Catalog>> {
  return read<Catalog>("/catalog");
}

/** Unknown slug, non-servable status and failed validation all return "missing". */
export function getCourse(slug: string): Promise<ReadResult<Course>> {
  return read<Course>(`/course/${encodeURIComponent(slug)}`);
}

export function getSitemap(): Promise<ReadResult<Sitemap>> {
  return read<Sitemap>("/sitemap");
}
