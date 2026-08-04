// Legal document registry + loader (CC-TOS-PRICING-1.0).
//
// ONE COPY OF EVERY DOCUMENT, EVERYWHERE. The master Terms of Service is
// authored once, here, and published at ONE canonical URL. Every storefront
// incorporates it BY REFERENCE — a link, not a copy. Each storefront's Schedule
// is authored once, in the repository that owns that storefront, and published
// at that storefront's own domain.
//
// That is why this registry distinguishes `local` from `remote` entries: a
// remote Schedule (Jurisdiction Watch) is NOT vendored here. The hub links to
// it. If you ever find yourself pasting a Schedule body into a second repo,
// stop — that is the duplication this design exists to prevent, and
// `npm run test:legal` will fail on it.
//
// Server-only: reads from the filesystem at request/build time.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseLegalDoc, type LegalDoc } from "./markdown.ts";

/** Canonical URL of the master Terms. Every Schedule, in every repo, points here. */
export const MASTER_TERMS_URL = "https://faraday-intelligence.ai/terms";

export interface LegalEntry {
  /** URL segment under /terms/. */
  slug: string;
  /** Storefront display name. */
  storefront: string;
  /** Short schedule designation used in the master's Schedules index. */
  designation: string;
  /**
   * `local`  — the markdown lives in this repo and is rendered here.
   * `remote` — another repo owns and publishes it; we link, never vendor.
   */
  kind: "local" | "remote";
  /** Repo-relative markdown path, for local entries. */
  file?: string;
  /** Where the document is published. */
  url: string;
  /** One-line description for the index. */
  blurb: string;
}

export const MASTER_FILE = "content/legal/terms-of-service.md";

export const SCHEDULES: LegalEntry[] = [
  {
    slug: "jurisdiction-watch",
    storefront: "Jurisdiction Watch",
    designation: "Schedule JW",
    kind: "remote",
    url: "https://jurisdiction-watch.com/terms",
    blurb:
      "Posture labels and JPAS scores as relative assessments, refresh cadence and vintage, token unlocks.",
  },
  {
    slug: "daily-challenge",
    storefront: "Faraday Daily Challenge",
    designation: "Schedule DC",
    kind: "local",
    file: "content/legal/schedules/daily-challenge.md",
    url: "https://faradaydailychallenge.com/terms/daily-challenge",
    blurb:
      "Game rules, leaderboards and seasons, minimum age, and no-purchase-necessary reward terms.",
  },
  {
    slug: "signal-room",
    storefront: "Signal Room",
    designation: "Schedule SR",
    kind: "local",
    file: "content/legal/schedules/signal-room.md",
    url: "https://faraday-intelligence.ai/terms/signal-room",
    blurb: "Configurator output terms, signal provenance and review status, alert delivery.",
  },
  {
    slug: "briefing-library",
    storefront: "Briefing Library",
    designation: "Schedule BL",
    kind: "local",
    file: "content/legal/schedules/briefing-library.md",
    url: "https://faraday-intelligence.ai/terms/briefing-library",
    blurb: "Briefing access and the Faraday token terms that apply to tokens from every source.",
  },
  {
    slug: "faraday-academy",
    storefront: "Faraday Academy",
    designation: "Schedule FA",
    kind: "local",
    file: "content/legal/schedules/faraday-academy.md",
    url: "https://faraday-intelligence.ai/terms/faraday-academy",
    blurb:
      "Course access, refund policy placeholder, and certification terms. Also the paste source for the LearnWorlds copy.",
  },
];

export function findSchedule(slug: string): LegalEntry | undefined {
  return SCHEDULES.find((s) => s.slug === slug);
}

function read(relPath: string): LegalDoc {
  return parseLegalDoc(readFileSync(join(process.cwd(), relPath), "utf8"));
}

export function loadMaster(): LegalDoc {
  return read(MASTER_FILE);
}

export function loadSchedule(entry: LegalEntry): LegalDoc {
  if (entry.kind !== "local" || !entry.file) {
    throw new Error(`Schedule "${entry.slug}" is owned by another repository; link to ${entry.url}`);
  }
  return read(entry.file);
}

/**
 * A document is publishable only once counsel has cleared it and the effective
 * date is a real date. Until then every surface renders a draft notice — a
 * legal page that silently looks effective while carrying TODO placeholders is
 * worse than no page.
 */
export function isDraft(doc: LegalDoc): boolean {
  const status = (doc.meta.status ?? "").toUpperCase();
  if (status === "DRAFT") return true;
  return /TODO/i.test(doc.meta.effective ?? "");
}

export function effectiveLabel(doc: LegalDoc): string {
  return isDraft(doc) ? "Not yet effective — draft pending review" : doc.meta.effective;
}
