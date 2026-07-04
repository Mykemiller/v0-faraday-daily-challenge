// League Office — shared constants (locked registries + status system).
//
// Client-safe: contains NO secrets and NO server-only imports, so both Server
// Components and the client shell can import it.

/** Single-Commissioner allowlist for the MVP. Structured as email→role so role
 *  tiers can be layered in later without touching call sites (README §0). */
export const STAFF: Record<string, "commissioner"> = {
  "mykemiller@gmail.com": "commissioner",
};

export function staffRole(email: string | null | undefined): "commissioner" | null {
  if (!email) return null;
  return STAFF[email.trim().toLowerCase()] ?? null;
}

/** The seven games — LOCKED order + neon identity dot (Brand Bible Ch.09b).
 *  `key` matches the live `dc_daily_attempts.game_type` / puzzle_type values. */
export const GAMES = [
  { key: "Rackl", neon: "#00ffc8" },
  { key: "Circuit", neon: "#00cfff" },
  { key: "Dark Fiber", neon: "#bf5fff" },
  { key: "Frequency", neon: "#ff6b00" },
  { key: "The Stack", neon: "#ffe600" },
  { key: "Signal Drop", neon: "#ff2d78" },
  { key: "The Brief", neon: "#b8ff00" },
] as const;

export type GameKey = (typeof GAMES)[number]["key"];

export const GAME_NEON: Record<string, string> = Object.fromEntries(
  GAMES.map((g) => [g.key.toLowerCase(), g.neon])
);

export function gameNeon(name: string): string {
  return GAME_NEON[name.trim().toLowerCase()] ?? "#b2a898";
}

/** The four-color status system — SAME four everywhere (README §0):
 *  green=active/healthy · amber=pending/attention · red=flagged/destructive ·
 *  gray=archived/closed. `tone` maps to the design-token utility set. */
export type StatusTone = "green" | "amber" | "red" | "gray";

const TONE_STYLE: Record<StatusTone, { bg: string; fg: string; border: string }> = {
  green: { bg: "rgba(79,107,77,.12)", fg: "#4f6b4d", border: "rgba(79,107,77,.28)" },
  amber: { bg: "rgba(148,86,10,.12)", fg: "#94560a", border: "rgba(148,86,10,.28)" },
  red: { bg: "rgba(156,59,46,.12)", fg: "#9c3b2e", border: "rgba(156,59,46,.30)" },
  gray: { bg: "rgba(107,98,87,.12)", fg: "#6b6257", border: "rgba(107,98,87,.26)" },
};

export function toneStyle(tone: StatusTone) {
  return TONE_STYLE[tone];
}

/** Map a free-text status/state string onto one of the four tones. */
export function statusToTone(status: string | null | undefined): StatusTone {
  const s = (status ?? "").toLowerCase();
  if (/(active|healthy|live|approved|published|champion|open)/.test(s)) return "green";
  if (/(pending|draft|attention|review|synced|upcoming|window)/.test(s)) return "amber";
  if (/(flag|banned|missing|danger|reject|dispute|error)/.test(s)) return "red";
  return "gray"; // paused / closed / archived / retired / unknown
}
