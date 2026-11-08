// Faraday Predicts — API endpoints (server-side read; passed to clients as props).
//
// ⚠️ Only NEXT_PUBLIC_* is inlined into browser bundles, so the configured
// VITE_PREDICTS_API_URL is read on the SERVER and handed down. The fallback is
// the live, anonymous function URL (verify_jwt=false; no secret in it).

import type { BrierPoint, CalibrationBand, Capabilities, Company, CompanyIndexEntry, HistoryPoint, HorizonTally, V3Row } from "./predicts-v3.ts";
import type { PredictsRecord } from "./predicts.ts";

export const PREDICTS_API_URL =
  process.env.VITE_PREDICTS_API_URL ||
  process.env.NEXT_PUBLIC_PREDICTS_API_URL ||
  "https://ycadmmngkdhvpcsrcuaq.supabase.co/functions/v1/predicts-public";

/** predicts-vote lives beside predicts-public on the same functions origin. */
export const PREDICTS_VOTE_URL = PREDICTS_API_URL.replace(/predicts-public\/?$/, "predicts-vote");

export type ApiEnvelope = {
  ok: boolean;
  release_tag: string | null;
  record: PredictsRecord | null;
  capabilities?: Capabilities;
};

export type OpenResponse = ApiEnvelope & { predictions: V3Row[]; theaters?: string[]; sectors?: string[]; horizon_counts?: Record<string, number> };
export type CompaniesResponse = ApiEnvelope & { companies: CompanyIndexEntry[] };
export type RecordResponse = ApiEnvelope & {
  graded_this_week?: V3Row[];
  calibration?: CalibrationBand[];
  by_horizon?: HorizonTally[];
  brier_history?: BrierPoint[];
  record_as_of?: string | null;
};
export type ReceiptsResponse = ApiEnvelope & {
  predictions: V3Row[];
  next_cursor: string | null;
  outcome_counts?: Record<string, number>;
};
export type OneResponse = ApiEnvelope & { prediction: V3Row & { history?: HistoryPoint[] }; related?: V3Row[] };
export type CompanyResponse = ApiEnvelope & {
  company: Company;
  open: V3Row[];
  graded: V3Row[];
  company_record: { graded: number; right: number; partly: number; missed: number };
};
export type MoversResponse = ApiEnvelope & { predictions: V3Row[] };

/** Server-side GET with the same 300s freshness the API advertises. Returns
 *  null on any failure — callers render their error/empty states, never throw. */
export async function predictsGet<T extends { ok: boolean }>(query: string): Promise<T | null> {
  try {
    const r = await fetch(`${PREDICTS_API_URL}?${query}`, { next: { revalidate: 300 } });
    if (!r.ok) return null;
    const data = (await r.json()) as T;
    return data?.ok ? data : null;
  } catch {
    return null;
  }
}
