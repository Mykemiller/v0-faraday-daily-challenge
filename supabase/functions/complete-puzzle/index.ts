import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORE_PUZZLE_TYPES = ["Rackl", "The Stack", "Circuit", "Dark Fiber"];

// Leaderboard V2 §8: the Daily Challenge day resets at midnight America/Chicago,
// NOT UTC. Stamp completions on the Central calendar date so a play at 23:59 vs
// 00:01 Central lands on the correct day and streaks line up with the board.
const DC_TZ = "America/Chicago";

function centralDate(d: Date): string {
  // en-CA renders as YYYY-MM-DD; timeZone does the Central conversion.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: DC_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

// Previous calendar day, derived from the date STRING (not wall-clock math), so
// it stays correct across DST transitions where a day isn't 24h long.
function previousDay(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const prev = new Date(Date.UTC(y, m - 1, d) - 86400000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${prev.getUTCFullYear()}-${pad(prev.getUTCMonth() + 1)}-${pad(prev.getUTCDate())}`;
}

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Puzzle Bank V2: normalize the optional, FREE hint counter. Anything outside
// 0..3 (or non-integer / missing) collapses to 0. This value is analytics-only
// and is deliberately NEVER read by the scoring/streak/MW logic below.
function normalizeHintsUsed(v: unknown): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return 0;
  const n = Math.trunc(v);
  if (n < 0) return 0;
  if (n > 3) return 3;
  return n;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const body = await req.json();
    const { sessionToken, puzzleType, score } = body ?? {};
    if (typeof sessionToken !== "string" || !sessionToken) return json({ error: "Missing session" }, 401);
    if (typeof puzzleType !== "string" || !puzzleType) return json({ error: "Missing puzzleType" }, 400);
    if (typeof score !== "number" || score < 0) return json({ error: "Invalid score" }, 400);

    // Optional Puzzle Bank V2 metadata. Both are additive and analytics-only:
    //   hintsUsed  — highest hint tier the player revealed (0..3); hints are FREE.
    //   publicId   — the puzzle's public code (e.g. "CIRC-2026-245").
    // Neither is permitted to influence score or streaks.
    const hintsUsed = normalizeHintsUsed((body ?? {}).hintsUsed);
    const rawPublicId = (body ?? {}).publicId;
    const publicId = typeof rawPublicId === "string" && rawPublicId.trim() !== "" ? rawPublicId.trim() : null;

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: session, error: sessErr } = await sb
      .from("dc_sessions")
      .select("subscriber_id, expires_at")
      .eq("token", sessionToken)
      .maybeSingle();

    if (sessErr) { console.error(sessErr); return json({ error: "Session lookup failed" }, 500); }
    if (!session) return json({ error: "Invalid session" }, 401);
    if (new Date(session.expires_at) < new Date()) return json({ error: "Session expired" }, 401);

    // Central calendar date — the canonical Daily Challenge day boundary.
    const puzzleDate = centralDate(new Date());

    const { error: insErr } = await sb.from("dc_completions").insert({
      subscriber_id: session.subscriber_id,
      puzzle_type: puzzleType,
      puzzle_date: puzzleDate,
      score,
      // Analytics-only columns (Puzzle Bank V2). Never inputs to scoring.
      hints_used: hintsUsed,
      puzzle_public_id: publicId,
    });

    if (insErr) {
      const code = (insErr as { code?: string }).code;
      if (code === "23505") {
        return json({ ok: true, duplicate: true });
      }
      console.error("Insert completion failed:", insErr);
      return json({ error: insErr.message }, 500);
    }

    const { data: todayCompletions } = await sb
      .from("dc_completions")
      .select("puzzle_type")
      .eq("subscriber_id", session.subscriber_id)
      .eq("puzzle_date", puzzleDate);

    const coreCount = (todayCompletions ?? [])
      .filter((c: { puzzle_type: string }) => CORE_PUZZLE_TYPES.includes(c.puzzle_type))
      .length;
    const fullSetJustCompleted = coreCount === 4 && CORE_PUZZLE_TYPES.includes(puzzleType);

    const { data: sub, error: subErr } = await sb
      .from("dc_subscribers")
      .select("*")
      .eq("id", session.subscriber_id)
      .maybeSingle();

    if (subErr || !sub) { console.error(subErr); return json({ error: "Subscriber lookup failed" }, 500); }

    const yesterday = previousDay(puzzleDate);

    // NOTE: streak math below uses only puzzleDate and the subscriber's prior
    // streak state. hintsUsed/publicId are intentionally absent here — hints
    // are free and must not change scoring or ranking.
    const playIncrementingDay = sub.play_streak_last_day !== puzzleDate;
    const playContinues = sub.play_streak_last_day === yesterday || sub.play_streak === 0;
    const newPlayStreak = playIncrementingDay
      ? (playContinues ? sub.play_streak + 1 : 1)
      : sub.play_streak;

    let newFullSetStreak = sub.full_set_streak;
    if (fullSetJustCompleted) {
      const fsContinues = sub.full_set_last_day === yesterday || sub.full_set_streak === 0;
      newFullSetStreak = fsContinues ? sub.full_set_streak + 1 : 1;
    }

    const { error: updErr } = await sb.from("dc_subscribers").update({
      play_streak: newPlayStreak,
      play_streak_last_day: puzzleDate,
      full_set_streak: newFullSetStreak,
      full_set_last_day: fullSetJustCompleted ? puzzleDate : sub.full_set_last_day,
      last_seen_at: new Date().toISOString(),
    }).eq("id", session.subscriber_id);

    if (updErr) { console.error(updErr); return json({ error: "Update failed" }, 500); }

    // Award milestone badges (FAR-70) — idempotent, recognition-only, never affects
    // score/streaks. Streak badges from the new play streak; perfect_day on a full set.
    const { error: badgeErr } = await sb.rpc("fn_assign_badges", {
      p_subscriber: session.subscriber_id,
      p_play_streak: newPlayStreak,
      p_full_set: fullSetJustCompleted,
    });
    if (badgeErr) console.error("Badge assignment failed:", badgeErr);

    return json({
      ok: true,
      fullSetJustCompleted,
      playStreak: newPlayStreak,
      fullSetStreak: newFullSetStreak,
    });
  } catch (e) {
    console.error("Unhandled error:", e);
    return json({ error: "Server error" }, 500);
  }
});
