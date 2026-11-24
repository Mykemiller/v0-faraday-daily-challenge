// Faraday Predicts — subscriber configurator (FDY-119, 26-43-v01). Pure helpers for
// /predicts/preferences: the API shape, verbatim copy, date formatting and the draft
// document. Deno-free and React-free so node --test can cover them.
//
// The predicts-preferences edge function is the ONLY validator: this file never re-checks a
// document, it only shapes what the page sends and shows the error strings that come back.

export type Horizon = "30d" | "60d" | "90d" | "6m" | "12m" | "24m";
export type Frequency = "daily" | "weekly" | "flash_only";
export type ChannelKey = "email" | "sms" | "slack" | "teams";

export interface Prefs {
  version?: number;
  sectors: string[];
  theaters: string[];
  threads: string[];
  key_players: string[];
  horizons: Horizon[];
  min_probability: number;
  include_bold: boolean;
  frequency: Frequency;
  weekly_dow: number;
  channels: Record<ChannelKey, boolean>;
  quiet_hours: { start: string; end: string } | null;
  tone_level: number | null;
  persona_key: string | null;
}

export interface Named { code: string; name: string }
export interface KeyPlayer { id: string; name: string }
export interface Options {
  theaters: (Named & { tagline: string | null })[];
  sectors: Named[];
  thread_groups: { sector_code: string; sector_name: string; threads: Named[] }[];
  key_players: KeyPlayer[];
  selected_key_players: KeyPlayer[];
  horizons: { key: Horizon; label: string }[];
  frequencies: { key: Frequency; label: string }[];
  weekdays: { key: number; label: string }[];
  channels: { key: ChannelKey; label: string; available: boolean }[];
  personas: { key: string; name: string }[];
}
export interface GetResponse { ok: true; release_tag: string | null; timezone: string | null; effective_preferences: Prefs; options: Options }
export interface PreviewItem { text: string; probability: number | null; bold: boolean; resolves_by: string | null; sector: string | null }
export interface Preview { frequency_sentence: string; sections: { horizon: Horizon; label: string; items: PreviewItem[] }[]; empty_message: string | null }

// ── Verbatim copy fixed by the FDY-119 decisions ──────────────────────────────
export const COPY = {
  invalidToken: "This link isn't recognised. Use the link from your latest Faraday Predicts email.",
  unavailable: "Preferences are unavailable right now - try again shortly.",
  emptyPreview: "Nothing would match these settings today. Widen a Sector or lower the minimum probability.",
  boldHelper: "Bold Calls can still appear below this",
  comingSoon: "Coming soon",
  save: "Save",
  reset: "Reset to house view",
} as const;

/** "2026-12-10" → "Dec 10, 2026" from the string parts. Never `new Date("YYYY-MM-DD")`,
 *  which parses as UTC midnight and shows the day before west of Greenwich (FDY-147). */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function formatDate(ymd: string | null | undefined): string | null {
  if (typeof ymd !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const [y, m, d] = ymd.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

/** A null probability renders as an em dash, never "0%" (FDY-147 Number(null) lesson). */
export function formatProbability(p: number | null | undefined): string {
  return typeof p === "number" && Number.isFinite(p) ? `${Math.round(p)}%` : "—";
}

/** Toggle a code in a list, keeping order stable. */
export function toggle<T>(list: readonly T[], v: T): T[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

/** Clamp a typed number into [lo, hi] as a whole number; non-numbers return null so the
 *  field can show the previous value instead of 0. */
export function clampInt(raw: string | number, lo: number, hi: number): number | null {
  const n = typeof raw === "number" ? raw : Number(String(raw).trim());
  if (String(raw).trim() === "" || !Number.isFinite(n)) return null;
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

/** The document the page sends. Every key is explicit so the saved row reads back as shown;
 *  channels that are not available yet are always sent as false. */
export function toDocument(p: Prefs): Record<string, unknown> {
  return {
    version: 1,
    sectors: [...p.sectors],
    theaters: [...p.theaters],
    threads: [...p.threads],
    key_players: [...p.key_players],
    horizons: [...p.horizons],
    min_probability: p.min_probability,
    include_bold: p.include_bold,
    frequency: p.frequency,
    weekly_dow: p.weekly_dow,
    channels: { email: p.channels.email, sms: false, slack: false, teams: false },
    quiet_hours: p.quiet_hours && p.quiet_hours.start && p.quiet_hours.end ? { ...p.quiet_hours } : null,
    tone_level: p.tone_level,
    persona_key: p.persona_key,
  };
}

/** Stable comparison for the unsaved-changes guard. */
export function sameDocument(a: Prefs, b: Prefs): boolean {
  return JSON.stringify(toDocument(a)) === JSON.stringify(toDocument(b));
}

/** IDF §06 guard used by the tests: no "<n> sectors/theaters/threads" anywhere. */
export const COUNT_PHRASE_RE = /\b\d+\s+(sectors|theaters|threads)\b/i;

/** The configurator endpoint sits beside predicts-public on the same functions origin. */
export function preferencesUrlFrom(publicApiUrl: string): string {
  return publicApiUrl.replace(/predicts-public\/?$/, "predicts-preferences");
}

/** Search filter for chip lists: case-insensitive substring on the name. */
export function filterNamed<T extends { name: string }>(items: readonly T[], q: string): T[] {
  const needle = q.trim().toLowerCase();
  return needle ? items.filter((i) => i.name.toLowerCase().includes(needle)) : [...items];
}
