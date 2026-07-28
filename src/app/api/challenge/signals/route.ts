// GET /api/challenge/signals — "Faraday's Take" Top Signals of the day.
//
// A read-only funnel teaser for the paid Signal product, open to ALL players
// (including anonymous). public.signals has RLS enabled with NO policies
// (deny-all for the anon/authed keys), and it carries the full signal corpus
// across every conviction — so it is read here SERVER-SIDE with the service
// role and stripped to a public-safe shape, matching the /api/challenge/answers
// + /api/challenge/day-content posture. No anon SELECT policy is added.
//
// "Today" is computed in the ACTIVE SEASON's timezone (seasons.tz), never in
// UTC and never in the browser — a signal fired at 23:30 local counts for that
// local day; one fired at 00:30 the next local day does not.
//
// Selection (per ticket): today's High-conviction, fired_at DESC, cap 10; if
// fewer than 5 High, top up with Medium (same day, fired_at DESC) until 5. Hard
// cap 10. NEVER backfill from a prior day — zero signals today → empty state.

import { resolveDomainName } from "@/lib/idf-labels";

export const dynamic = "force-dynamic";

const SUPABASE_URL =
  process.env.SUPABASE_URL || "https://ycadmmngkdhvpcsrcuaq.supabase.co";

const FALLBACK_TZ = "America/Chicago";
const FLOOR = 5; // top up to at least this many with Medium
const CAP = 10; // never render more than this

// Calendar date (YYYY-MM-DD) for an instant in a given IANA timezone.
function zonedDate(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

// Offset (ms) of `timeZone` relative to UTC at instant `at`. DST-aware.
function tzOffsetMs(timeZone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
    .formatToParts(at)
    .reduce<Record<string, string>>((a, p) => ((a[p.type] = p.value), a), {});
  const hour = parts.hour === "24" ? "00" : parts.hour;
  const asUTC = Date.UTC(
    +parts.year,
    +parts.month - 1,
    +parts.day,
    +hour,
    +parts.minute,
    +parts.second
  );
  return asUTC - at.getTime();
}

// UTC instant of local midnight (00:00) for a YYYY-MM-DD calendar date in tz.
function zonedMidnightUtc(dateStr: string, timeZone: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d));
  return new Date(guess.getTime() - tzOffsetMs(timeZone, guess));
}

async function fetchActiveSeasonTz(key: string): Promise<string> {
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/seasons?status=eq.active&select=tz&limit=1`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` }, cache: "no-store" }
    );
    if (!r.ok) return FALLBACK_TZ;
    const rows = await r.json().catch(() => null);
    const tz = Array.isArray(rows) ? rows[0]?.tz : null;
    return typeof tz === "string" && tz.trim() ? tz.trim() : FALLBACK_TZ;
  } catch {
    return FALLBACK_TZ;
  }
}

// Resolve the jsonb domain_tags array into public-safe plain-language chip
// names. Unmapped codes (and anything that is not D1..D23) are dropped SILENTLY
// — a raw code, UUID, or count must never reach the DOM (IDF 4.0 governance).
function domainChips(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  const names: string[] = [];
  for (const t of tags) {
    if (typeof t !== "string") continue;
    const name = resolveDomainName(t);
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

interface SignalRow {
  conviction: string | null;
  byline: string | null;
  framing: string | null;
  faradays_take: string | null;
  domain_tags: unknown;
  fired_at: string;
}

interface PublicSignal {
  take: string;
  byline: string | null;
  conviction: "High" | "Medium";
  framing: string | null;
  domains: string[];
}

// Shape one raw row into the public-safe card, or null if it carries no
// renderable hero text. `faradays_take` is the hero; `framing` falls back in
// only when a top-up row lacks a take. The id/UUID is never selected, so it
// cannot leak.
function toPublicSignal(row: SignalRow): PublicSignal | null {
  const conviction = row.conviction === "High" ? "High" : "Medium";
  const takeRaw = (row.faradays_take ?? "").trim();
  const framingRaw = (row.framing ?? "").trim();
  const hero = takeRaw || framingRaw;
  if (!hero) return null;

  // Avoid a visibly duplicated secondary line when framing just echoes the take
  // (in the current corpus framing is often a prefix of the take).
  let framing: string | null = framingRaw || null;
  if (framing) {
    const a = framing.toLowerCase();
    const b = hero.toLowerCase();
    if (a === b || b.startsWith(a) || a.startsWith(b)) framing = null;
  }

  const byline = (row.byline ?? "").trim() || null;
  return { take: hero, byline, conviction, framing, domains: domainChips(row.domain_tags) };
}

export async function GET() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    return Response.json({ error: "Signals service not configured" }, { status: 500 });
  }

  const tz = await fetchActiveSeasonTz(key);
  const now = new Date();
  const today = zonedDate(now, tz);
  const start = zonedMidnightUtc(today, tz);
  // 26h after local midnight always lands inside the next local calendar day
  // (even a 25h fall-back DST day), so this yields tomorrow's date reliably.
  const tomorrow = zonedDate(new Date(start.getTime() + 26 * 3600 * 1000), tz);
  const end = zonedMidnightUtc(tomorrow, tz);

  // Window-filter in UTC (indexable), then re-verify each row's local date in JS
  // so the tz boundary is provably exact regardless of the offset math above.
  const params = new URLSearchParams({
    select: "conviction,byline,framing,faradays_take,domain_tags,fired_at",
    and: `(fired_at.gte.${start.toISOString()},fired_at.lt.${end.toISOString()})`,
    conviction: "in.(High,Medium)",
    order: "fired_at.desc",
    limit: "300",
  });

  const res = await fetch(`${SUPABASE_URL}/rest/v1/signals?${params.toString()}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    cache: "no-store",
  });

  if (!res.ok) {
    console.error("[challenge/signals] Supabase read failed:", res.status);
    // Degrade gracefully to the empty state rather than surfacing an error.
    return Response.json({ date: today, signals: [] });
  }

  const rows: SignalRow[] = (await res.json().catch(() => [])) as SignalRow[];
  const list = Array.isArray(rows) ? rows : [];

  // Exact local-day guard (belt-and-suspenders over the UTC window).
  const todays = list.filter((r) => {
    const d = new Date(r.fired_at);
    return !isNaN(d.getTime()) && zonedDate(d, tz) === today;
  });

  const highs: PublicSignal[] = [];
  const mediums: PublicSignal[] = [];
  for (const r of todays) {
    const s = toPublicSignal(r);
    if (!s) continue;
    (s.conviction === "High" ? highs : mediums).push(s);
  }

  // Primary set: High, fired_at DESC (already ordered), cap 10.
  const selected = highs.slice(0, CAP);
  // Floor rule: top up with Medium until at least 5, never exceeding the cap.
  if (selected.length < FLOOR) {
    for (const m of mediums) {
      if (selected.length >= FLOOR) break;
      selected.push(m);
    }
  }

  return Response.json(
    { date: today, signals: selected.slice(0, CAP) },
    // Same-for-everyone content that turns over once a day — cache briefly.
    { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600" } }
  );
}
