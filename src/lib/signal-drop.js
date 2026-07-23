// Pure, dependency-free Signal Drop helpers shared by three call sites:
//   • the client game component (local/mock validation + tile/keyboard rendering)
//   • the server guess-validation route (/api/challenge/guess)
//   • the Puzzle Bank payload builder (getLivePuzzles) that strips the answer
//
// SAFE TO BUNDLE ON THE CLIENT: this module holds no answer data and no secrets.
// The answer only ever lives server-side (Airtable) and is compared there; this
// file just encodes the shared *shape* and the (historical) per-letter feedback
// rules so the client, server, and replay all agree.

// Signal Drop is a 6-guess Wordle. Shared so client and server never drift.
export const SIGNAL_MAX_GUESSES = 6;

// Fields in a Signal Drop puzzle-content record that ARE the answer, or mirror
// it, and therefore must never reach the browser before the puzzle is over.
// `word` is the answer; `name` mirrors it in the Puzzle Bank content convention
// (see the built-in mock: name === word === "BUSBAR"). `answer`/`solution` are
// defensive — future content shapes should still be stripped.
export const SIGNAL_ANSWER_FIELDS = ["word", "name", "answer", "solution"];

// Normalize a guess/word for comparison: string, trimmed, uppercased.
export function normalizeWord(s) {
  return (s == null ? "" : String(s)).trim().toUpperCase();
}

// Per-letter feedback for one guess against the answer. Mirrors the historical
// in-game logic EXACTLY (positional match first, then a simple membership test —
// deliberately NOT count-aware) so the game's feel and scoring are unchanged by
// the move to server-side validation. Returns one state per answer position:
//   "correct" | "present" | "absent" | "empty"
export function evaluateGuess(word, guess) {
  const w = normalizeWord(word);
  const g = normalizeWord(guess);
  const states = [];
  for (let i = 0; i < w.length; i++) {
    const letter = g[i];
    if (!letter) states.push("empty");
    else if (letter === w[i]) states.push("correct");
    else if (w.includes(letter)) states.push("present");
    else states.push("absent");
  }
  return { states, correct: g.length === w.length && g === w };
}

// Build the three gated hints for a Signal Drop puzzle. hint1/hint2 are
// curator-written; the third is derived (first letter + length). These are hint
// CONTENT — gated in the UI by the shared FAR-198 budget — not the answer, and
// (like hint1/hint2 already) are safe to ship in the payload.
export function buildSignalHints(content, max = 3) {
  const out = [];
  if (content?.hint1) out.push(String(content.hint1));
  if (content?.hint2) out.push(String(content.hint2));
  const w = normalizeWord(content?.word);
  if (w) out.push(`It starts with “${w[0]}” and is ${w.length} letters long.`);
  return out.filter(Boolean).slice(0, max);
}

// Transform a raw Signal Drop puzzle-content object into the CLIENT-SAFE shape:
// every answer-bearing field is removed, and only what the grid/keyboard need
// (wordLength) plus the pre-built gated hints are exposed. clue/domain/etc. pass
// through untouched. This is the single choke point that keeps the plaintext
// answer out of the /api/challenge/today payload.
export function toPublicSignalPuzzle(content) {
  const safe = { ...(content || {}) };
  for (const f of SIGNAL_ANSWER_FIELDS) delete safe[f];
  const w = normalizeWord(content?.word);
  safe.wordLength = w.length || Number(content?.wordLength) || 0;
  safe.hints = buildSignalHints(content);
  return safe;
}

// Given the ordered list of a player's submitted guesses and the answer, decide
// the terminal state and whether the answer may be revealed. Reveal is allowed
// ONLY once the game is over (solved, or all guesses spent) — this is the gate
// the server route applies before returning the plaintext answer.
export function resolveGuesses(word, guesses, max = SIGNAL_MAX_GUESSES) {
  const w = normalizeWord(word);
  const list = Array.isArray(guesses) ? guesses.map(normalizeWord) : [];
  const last = list[list.length - 1] || "";
  const { states, correct } = evaluateGuess(w, last);
  const solved = list.some((g) => g === w);
  const lost = !solved && list.length >= max;
  const done = solved || lost;
  return { states, correct, solved, lost, done, revealWord: done ? w : null };
}
