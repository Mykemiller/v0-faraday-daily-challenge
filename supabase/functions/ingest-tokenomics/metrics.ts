// CC-INGEST-TOKENOMICS-SCOREBOARD-1.0 — pure metric helpers (no I/O; deno-testable).
// Shared shape between every adapter and the orchestrator. Group A/B/C/D are reused verbatim
// from the Tokenomics Scoreboard model; do not invent new categories here.

export type Category = "A" | "B" | "C" | "D";
export type PricingMode = "ondemand" | "reserved" | "committed" | "spot" | "list" | null;
export type Confidence = "verified" | "as-reported" | "unverified";

// One reading, in the canonical intermediate shape the orchestrator persists to tokenomics_metrics.
export type Metric = {
  metric_id: string;
  category: Category;
  subject: string | null;
  provider: string | null;
  region: string | null;
  sku: string | null;
  pricing_mode: PricingMode;
  value: number | null;      // null => status-only (futures) or a gated index (value withheld)
  unit: string;              // $/M-in, $/M-out, $/GPU-hr, index-level, tokens/sec, $/kWh, status, ...
  as_of: string;             // ISO date (YYYY-MM-DD)
  source: string;            // source_key in tokenomics_source_registry
  source_tier: 1 | 2 | 3;
  source_url: string | null;
  confidence: Confidence;
  display_allowed: boolean;  // false for licensed third-party indices (ingest-only)
  why_note: string | null;
};

// Build a stable metric_id slug. Lowercase, dot-delimited. Hyphens and underscores inside a segment
// are preserved (roster provider keys use underscores, e.g. together_ai, and must round-trip into
// the metric_id so the snapshot can map a metric back to its provider). Other runs of non-alphanum
// collapse to a single hyphen. e.g. buildMetricId("gpu","h100","ondemand","together_ai","us-east-1")
//   => "gpu.h100.ondemand.together_ai.us-east-1".
export function slugSeg(s: string): string {
  return String(s).trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
}
export function buildMetricId(...segments: (string | null | undefined)[]): string {
  return segments.filter((s): s is string => !!s && String(s).length > 0).map(slugSeg).join(".");
}

// Parse a money-ish or numeric field to a number, or null. Strips $ and commas.
export function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

// Normalize an ISO-ish date to YYYY-MM-DD, or null.
export function toDate(v: unknown): string | null {
  if (!v) return null;
  const s = String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

// Content hash basis: the fields whose change constitutes a NEW vintage. Deliberately excludes
// ingested_at, source_url, subject text and why_note — a re-fetch that only re-times or re-links
// the same reading is a no-op, but a changed value/unit/mode/confidence/gate is a new vintage.
export async function contentHash(m: Metric): Promise<string> {
  const basis = [
    m.metric_id, m.as_of, m.source,
    m.value === null ? "∅" : String(m.value),
    m.unit, m.pricing_mode ?? "", m.confidence, m.display_allowed ? "1" : "0",
  ].join("|");
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(basis));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Guardrail: a futures/status reading must carry unit='status' and value=null (never a price for a
// non-tradeable instrument). Returns a corrected copy — callers should route status through here.
export function asStatus(m: Omit<Metric, "value" | "unit"> & { status: string }): Metric {
  return { ...m, value: null, unit: "status", why_note: m.why_note ?? m.status };
}

// De-dup a batch on content_hash (dedup on the underlying figure, not the row: one canonical
// reading may arrive via multiple citations in a single run).
export async function dedupeByHash(metrics: Metric[]): Promise<{ rows: (Metric & { content_hash: string })[]; duped: number }> {
  const seen = new Set<string>();
  const rows: (Metric & { content_hash: string })[] = [];
  let duped = 0;
  for (const m of metrics) {
    const h = await contentHash(m);
    if (seen.has(h)) { duped++; continue; }
    seen.add(h);
    rows.push({ ...m, content_hash: h });
  }
  return { rows, duped };
}
