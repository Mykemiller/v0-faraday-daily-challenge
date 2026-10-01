"use client";
// Faraday Academy — editor-side helpers.
//
// Editor surfaces are gated on a Supabase Auth (GoTrue) session carrying
// app_metadata.role = "editor". The engine's own subscriber auth is a separate OTP
// system that issues no GoTrue token, so today no browser can reach these screens —
// they render their signed-out state. The seam is real and works the moment an
// editor is provisioned in Supabase Auth.

export type ProposalStatus =
  | "proposed"
  | "argus_review"
  | "myke_review"
  | "accepted"
  | "returned"
  | "rejected"
  | "merged"
  | "superseded";

export type Proposal = {
  id: string;
  course_id: string;
  module_id: string | null;
  lesson_id: string | null;
  target: "lesson_body" | "faradays_take";
  kind: string;
  base_hash: string;
  diff: { before_excerpt?: string; after_excerpt?: string } | null;
  proposed_text: string | null;
  sources: Array<{ title: string; url: string; published_on?: string }> | null;
  asset_spec: {
    diagram?: { mermaid: string; caption?: string };
    chart?: { spec: Record<string, unknown>; caption?: string };
  } | null;
  status: ProposalStatus;
  argus_verdict: Record<string, unknown> | null;
  review_note: string | null;
  proposed_by: string | null;
  created_at: string;
  updated_at: string;
  course: { title: string; slug: string | null } | null;
  is_mine: boolean;
};

/** GoTrue persists its session under sb-<ref>-auth-token. */
export function accessToken(): string | null {
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (!k || !/^sb-.*-auth-token$/.test(k)) continue;
      const raw = window.localStorage.getItem(k);
      if (!raw) continue;
      const token = JSON.parse(raw)?.access_token;
      if (typeof token === "string" && token.length > 0) return token;
    }
  } catch {
    return null;
  }
  return null;
}

export const PROPOSAL_KINDS = [
  { value: "add_references", label: "Add external references" },
  { value: "add_diagram", label: "Add a diagram" },
  { value: "add_chart", label: "Add a chart" },
  { value: "update_fact", label: "Update a stale fact" },
  { value: "tighten", label: "Tighten this passage" },
] as const;

/** Only these can still be withdrawn by their author. */
export const WITHDRAWABLE: ProposalStatus[] = ["proposed", "argus_review", "returned"];

export function statusLabel(s: ProposalStatus): string {
  switch (s) {
    case "proposed": return "Proposed";
    case "argus_review": return "With Argus";
    case "myke_review": return "With Myke";
    case "accepted": return "Accepted";
    case "returned": return "Returned";
    case "rejected": return "Rejected";
    case "merged": return "Merged";
    case "superseded": return "Withdrawn";
  }
}
