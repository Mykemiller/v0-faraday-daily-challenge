// POST /api/challenge/guess — server-side Signal Drop guess validation.
//
// Signal Drop's answer must never reach the browser before the puzzle is over
// (it used to ship in /api/challenge/today, one DevTools glance away). So the
// answer stays server-side and guesses are validated here: the client posts its
// ordered guess list, the server compares against the live answer and returns
// per-letter feedback — never the plaintext answer — until the game is over.
//
// Body: { gameType: "Signal Drop", publicId?: string, guesses: string[], token?: string }
//   guesses = every guess the player has submitted so far, oldest → newest.
//
// Response: {
//   correct:   boolean,             // did the newest guess match?
//   states:    ("correct"|"present"|"absent"|"empty")[],  // feedback for it
//   done:      boolean,             // game over (solved or all guesses spent)?
//   wordLength: number,
//   answer:    string | null        // revealed ONLY when done — else null
// }
//
// Reveal gate: the answer is returned only once the game is over (solved, or the
// max guesses have been submitted). Score/streak/leaderboard are handled
// separately by /api/score and are out of scope here.

// DC_PUZZLE_SOURCE selects airtable (default) or supabase — see puzzle-bank.js.
import { getSignalDropAnswer } from "@/lib/puzzle-bank";
import { resolveSeasonFor } from "@/lib/seasons/resolve";

const GUESS_SUPABASE_URL =
  process.env.SUPABASE_URL || "https://ycadmmngkdhvpcsrcuaq.supabase.co";

// The caller's season (CC-LO-CONCURRENT-SEASONS-1.0) so a guess without a
// publicId is scored against THEIR Signal Drop, not an arbitrary live one.
// Token optional; any failure → anonymous → platform default season.
async function seasonIdForToken(token) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return null;
  const h = { apikey: key, Authorization: `Bearer ${key}` };
  let subscriberId = null;
  if (typeof token === "string" && token.trim()) {
    try {
      const r = await fetch(
        `${GUESS_SUPABASE_URL}/rest/v1/dc_sessions?token=eq.${encodeURIComponent(token.trim())}&select=subscriber_id,expires_at&limit=1`,
        { headers: h, cache: "no-store" }
      );
      const rows = r.ok ? await r.json().catch(() => null) : null;
      const row = Array.isArray(rows) ? rows[0] : null;
      if (row && !(row.expires_at && new Date(row.expires_at) < new Date())) subscriberId = row.subscriber_id ?? null;
    } catch {
      subscriberId = null;
    }
  }
  const season = await resolveSeasonFor(h, subscriberId);
  return season?.id ?? null;
}
import { resolveGuesses, normalizeWord, SIGNAL_MAX_GUESSES } from "@/lib/signal-drop";

export const dynamic = "force-dynamic";

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  if (body?.gameType !== "Signal Drop") {
    return Response.json({ error: "unsupported gameType" }, { status: 400 });
  }

  const guesses = Array.isArray(body?.guesses)
    ? body.guesses.map(normalizeWord).filter(Boolean)
    : [];
  if (guesses.length === 0) {
    return Response.json({ error: "no guesses provided" }, { status: 400 });
  }
  if (guesses.length > SIGNAL_MAX_GUESSES) {
    return Response.json({ error: "too many guesses" }, { status: 400 });
  }

  let answer;
  try {
    const seasonId = await seasonIdForToken(body?.token);
    answer = await getSignalDropAnswer({ publicId: body?.publicId, seasonId });
  } catch (err) {
    console.error("[/api/challenge/guess] answer lookup failed:", err);
    return Response.json({ error: "validation unavailable" }, { status: 502 });
  }
  if (!answer?.word) {
    return Response.json({ error: "no live Signal Drop puzzle" }, { status: 404 });
  }

  const { states, correct, done, revealWord } = resolveGuesses(
    answer.word,
    guesses,
    SIGNAL_MAX_GUESSES
  );

  return Response.json(
    {
      correct,
      states,
      done,
      wordLength: answer.word.length,
      // The plaintext answer crosses to the client ONLY after the game is over.
      answer: revealWord,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
