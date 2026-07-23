// POST /api/challenge/guess — server-side Signal Drop guess validation.
//
// Signal Drop's answer must never reach the browser before the puzzle is over
// (it used to ship in /api/challenge/today, one DevTools glance away). So the
// answer stays server-side and guesses are validated here: the client posts its
// ordered guess list, the server compares against the live answer and returns
// per-letter feedback — never the plaintext answer — until the game is over.
//
// Body: { gameType: "Signal Drop", publicId?: string, guesses: string[] }
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

import { getSignalDropAnswer } from "@/lib/airtable-puzzle-bank";
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
    answer = await getSignalDropAnswer({ publicId: body?.publicId });
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
