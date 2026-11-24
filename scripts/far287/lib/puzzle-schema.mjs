// FAR-287 — Pure puzzle-content contract helpers (no I/O). The single source of
// truth the generator and validator share. Schemas are from docs/puzzle-schemas.md
// (reverse-engineered from the live game components + real bank records).
//
// extractAnswer() MIRRORS src/lib/day-content.ts so the Phase-5 round-trip test
// exercises the exact path /api/challenge/answers uses — a null result means the
// generated content would not parse for the consumer.

import { createHash } from "node:crypto";

// CC-DC-GAME-REGISTRY-1.0: the roster used to be listed here. The authoritative
// set is game_catalog (lifecycle_state='live'); callers pass in the types they
// want generated. The per-game SCHEMA/validator below is genuinely per-game code
// and stays — but it is a registry lookup, so an unknown type reports a clear
// "no schema" error instead of silently validating as OK.

const str = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);

// ── round-trip answer extraction (port of day-content.ts extractAnswer) ─────────
export function extractAnswer(puzzleType, content) {
  if (!content || typeof content !== "object") return null;
  if (puzzleType === "Rackl") {
    const groups = Array.isArray(content.groups) ? content.groups : [];
    const out = groups.filter((g) => g && g.label && Array.isArray(g.items))
      .map((g) => ({ label: String(g.label), items: g.items.map(String) }));
    return out.length ? { kind: "groups", groups: out } : null;
  }
  if (puzzleType === "Signal Drop") {
    const word = str(content.word);
    return word ? { kind: "word", word: word.toUpperCase(), clue: str(content.clue) } : null;
  }
  if (puzzleType === "The Stack") {
    const items = Array.isArray(content.items) ? content.items : null;
    const order = Array.isArray(content.correctOrder) ? content.correctOrder : null;
    if (!items || !order) return null;
    const ranked = order.map((idx, pos) => ({
      rank: pos + 1, item: items[idx] != null ? String(items[idx]) : null,
      value: Array.isArray(content.values) && content.values[idx] != null ? String(content.values[idx]) : null,
    })).filter((r) => r.item != null);
    return ranked.length ? { kind: "ranking", metric: str(content.metric), ranked } : null;
  }
  if (puzzleType === "Dark Fiber") {
    const pairs = Array.isArray(content.pairs) ? content.pairs : [];
    const out = pairs.filter((p) => p && p.term && p.def).map((p) => ({ term: String(p.term), def: String(p.def) }));
    return out.length ? { kind: "pairs", pairs: out } : null;
  }
  if (puzzleType === "Circuit" || puzzleType === "The Brief" || puzzleType === "Frequency") {
    const questions = Array.isArray(content.questions) ? content.questions : [];
    const out = questions.map((q) => {
      if (!q || !q.q) return null;
      let answer = null;
      if (typeof q.a === "boolean") answer = q.a ? "True" : "False";
      else if (Array.isArray(q.options) && typeof q.correct === "number" && q.options[q.correct] != null) answer = String(q.options[q.correct]);
      if (answer == null) return null;
      return { q: String(q.q), answer, explanation: str(q.explanation) };
    }).filter(Boolean);
    return out.length ? { kind: "questions", questions: out } : null;
  }
  return null;
}

// ── structural validation (generator guard + Phase-5 check #1) ──────────────────
const isNEStr = (v) => typeof v === "string" && v.trim().length > 0;
export function validateContent(type, c) {
  const e = [];
  if (!c || typeof c !== "object") return { ok: false, errors: ["content not an object"] };
  const q4 = (arr, label) => { if (!Array.isArray(arr) || !arr.length) e.push(`${label}: missing/empty`); };
  switch (type) {
    case "Rackl": {
      if (!Array.isArray(c.groups) || c.groups.length !== 4) e.push("Rackl: need exactly 4 groups");
      else c.groups.forEach((g, i) => {
        if (!isNEStr(g?.label)) e.push(`Rackl g${i}: label`);
        if (!isNEStr(g?.color) || !isNEStr(g?.textColor)) e.push(`Rackl g${i}: color/textColor`);
        if (!Array.isArray(g?.items) || g.items.length !== 4 || !g.items.every(isNEStr)) e.push(`Rackl g${i}: need 4 non-empty items`);
      });
      const all = (c.groups || []).flatMap((g) => (g?.items || []).map((x) => String(x).toLowerCase()));
      if (new Set(all).size !== all.length) e.push("Rackl: duplicate items across groups");
      break;
    }
    case "Signal Drop": {
      if (!isNEStr(c.word) || !/^[A-Za-z]{3,12}$/.test(c.word)) e.push("Signal Drop: word must be a single 3-12 letter A-Z token");
      if (!isNEStr(c.clue)) e.push("Signal Drop: clue");
      break;
    }
    case "The Stack": {
      q4(c.items, "The Stack items");
      if (!Array.isArray(c.correctOrder)) e.push("The Stack: correctOrder");
      else {
        const n = (c.items || []).length;
        const sorted = [...c.correctOrder].sort((a, b) => a - b);
        if (c.correctOrder.length !== n || sorted.some((v, i) => v !== i)) e.push("The Stack: correctOrder must be a permutation of item indices");
      }
      if (!isNEStr(c.metric)) e.push("The Stack: metric");
      if (c.values != null && (!Array.isArray(c.values) || c.values.length !== (c.items || []).length)) e.push("The Stack: values must align to items");
      break;
    }
    case "Circuit": {
      if (typeof c.timeLimit !== "number" || !(c.timeLimit > 0)) e.push("Circuit: timeLimit (positive number) required");
      q4(c.questions, "Circuit questions");
      (c.questions || []).forEach((q, i) => {
        if (!isNEStr(q?.q)) e.push(`Circuit q${i}: q`);
        if (typeof q?.a !== "boolean") e.push(`Circuit q${i}: a must be boolean`);
        if (!isNEStr(q?.explanation)) e.push(`Circuit q${i}: explanation`);
      });
      break;
    }
    case "The Brief": {
      if (typeof c.readTime !== "number" || !(c.readTime > 0)) e.push("The Brief: readTime required");
      if (!isNEStr(c.brief) || !c.brief.includes("\n\n")) e.push("The Brief: brief must be multi-paragraph (\\n\\n)");
      validateMCQ(c, "The Brief", e);
      break;
    }
    case "Frequency": { validateMCQ(c, "Frequency", e); break; }
    case "Dark Fiber": {
      if (!Array.isArray(c.pairs) || c.pairs.length < 4) e.push("Dark Fiber: need >=4 pairs");
      else c.pairs.forEach((p, i) => { if (!isNEStr(p?.term) || !isNEStr(p?.def)) e.push(`Dark Fiber p${i}: term/def`); });
      break;
    }
    default: e.push(`unknown type ${type}`);
  }
  // round-trip must yield a non-null structured answer
  if (!extractAnswer(type, c)) e.push(`${type}: round-trip extractAnswer -> null`);
  return { ok: e.length === 0, errors: e };
}
function validateMCQ(c, label, e) {
  if (!Array.isArray(c.questions) || !c.questions.length) { e.push(`${label}: questions`); return; }
  c.questions.forEach((q, i) => {
    if (!isNEStr(q?.q)) e.push(`${label} q${i}: q`);
    if (!Array.isArray(q?.options) || q.options.length < 3 || !q.options.every(isNEStr)) e.push(`${label} q${i}: >=3 options`);
    if (typeof q?.correct !== "number" || q.correct < 0 || q.correct >= (q?.options?.length || 0)) e.push(`${label} q${i}: correct index out of range`);
    if (!isNEStr(q?.explanation)) e.push(`${label} q${i}: explanation`);
  });
}

// ── canonical answer_key string (for the answer_key column) ─────────────────────
export function answerKeyFrom(type, c) {
  const a = extractAnswer(type, c);
  if (!a) return null;
  switch (a.kind) {
    case "word": return a.word;
    case "groups": return a.groups.map((g) => `${g.label}: ${g.items.join(", ")}`).join(" | ");
    case "ranking": return a.ranked.map((r) => `${r.rank}. ${r.item}${r.value ? ` (${r.value})` : ""}`).join(" | ");
    case "pairs": return a.pairs.map((p) => `${p.term} = ${p.def}`).join(" | ");
    case "questions": return a.questions.map((q, i) => `${i + 1}. ${q.answer}`).join(" | ");
    default: return null;
  }
}

// ── hint escalation (Phase-5 check #2): 3 non-empty, distinct, increasingly revealing
export function checkHints(h1, h2, h3, answerKey) {
  const e = [];
  const hs = [h1, h2, h3];
  if (!hs.every(isNEStr)) e.push("hints: all three required, non-empty");
  const norm = hs.map((h) => String(h || "").trim().toLowerCase());
  if (new Set(norm).size !== 3) e.push("hints: must be distinct");
  // heuristic monotonic reveal: hint3 should not be less specific than hint1.
  // proxy = longer or contains more of the answer tokens; soft check.
  if (isNEStr(answerKey)) {
    const ans = String(answerKey).toLowerCase();
    const leak1 = ans.length > 3 && norm[0].includes(ans);
    if (leak1) e.push("hints: hint 1 leaks the answer (should be a gentle reframe)");
  }
  return { ok: e.length === 0, errors: e };
}

// ── copy compliance (Phase-5 check #9) — count-agnostic, public labels only ─────
const COUNT_WORDS = /(^|\s)(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|\d+)\s+(theater|sector|thread)s?\b/i;
const BANNED_WORDS = /\b(theme|domain|sub-domain|subdomain)s?\b/i;
const ID_PAT = /\b(T-\d{3}|D\d{1,2}\.\d+)\b/;
export function copyViolations(text) {
  const t = String(text || ""); const v = [];
  if (COUNT_WORDS.test(t)) v.push("count phrase");
  if (BANNED_WORDS.test(t)) v.push("banned word (Theme/Domain/Sub-Domain)");
  if (ID_PAT.test(t)) v.push("raw ID (T-###/D#.#)");
  return v;
}

// ── CC-DC-GEN-DOMAIN-FIDELITY-1.0 — the model's domain-fit self-report ─────────
//
// prompts.js asks every generated element for two extra keys alongside
// `difficulty`: `domain_fit` ("on"|"adjacent"|"off") and a <=120-char
// `domain_fit_reason`. Both are ADVISORY. D2: a missing, misspelled or junk
// `domain_fit` is "unknown" and passes — a model that forgets to self-report
// must never cost a slot, because the slot is the expensive thing and the
// self-report is the cheap one. Only an explicit "off" changes anything, and
// what it changes is WHO LOOKS AT IT, never whether the row is written.
//
// `validateContent()` above is deliberately not touched: it checks the keys a
// game NEEDS and ignores every extra one, so a model that nests `domain_fit`
// inside the puzzle object still validates. `readDomainFit()` looks in both
// places for exactly that reason.

/** The three values the prompt offers. Anything else normalizes to "unknown". */
export const DOMAIN_FIT_VALUES = ["on", "adjacent", "off"];
/** The reason clamp the prompt asks for and this module enforces. */
export const DOMAIN_FIT_REASON_MAX = 120;
/** The validation_errors key an off-domain puzzle is flagged under. */
export const DOMAIN_FIT_OFF_KEY = "domain_fit_off";
/** Stand-in reason when the model's text could not be shown to be content-free. */
export const DOMAIN_FIT_REASON_WITHHELD = "reason withheld (could not be shown content-free)";

/**
 * "on" | "adjacent" | "off" | "unknown" — never throws, never a failure (D2).
 * @param {unknown} v
 * @returns {"on"|"adjacent"|"off"|"unknown"}
 */
export function normalizeDomainFit(v) {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  return DOMAIN_FIT_VALUES.includes(s) ? /** @type {"on"|"adjacent"|"off"} */ (s) : "unknown";
}

/**
 * One tidy line of at most DOMAIN_FIT_REASON_MAX characters, or null. The clamp
 * is ours, not the model's: the prompt asks for <=120 and this is what makes it
 * true of the stored row.
 * @param {unknown} v
 * @returns {string|null}
 */
export function clampFitReason(v) {
  const s = typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
  if (!s) return null;
  if (s.length <= DOMAIN_FIT_REASON_MAX) return s;
  return s.slice(0, DOMAIN_FIT_REASON_MAX - 1).trimEnd() + "…";
}

// Words too common to treat as an answer leak; without them almost every honest
// reason would be withheld for sharing a preposition with the answer key.
const REASON_STOPWORDS = new Set([
  "the", "and", "for", "with", "from", "that", "this", "into", "than", "then",
  "over", "under", "its", "are", "was", "were", "not", "but", "all", "any",
  "one", "two", "per", "via", "out", "off", "how", "why", "who", "new",
]);

/**
 * True when the reason repeats the answer key or any distinctive token of it.
 * Deliberately trigger-happy: a withheld reason costs the commissioner one
 * click, a leaked one puts an answer in a row that renders in the panel.
 * @param {unknown} reason
 * @param {unknown} answerKey
 * @returns {boolean}
 */
export function reasonLeaksAnswer(reason, answerKey) {
  const r = String(reason ?? "").toLowerCase();
  const key = String(answerKey ?? "").toLowerCase();
  if (!r || !key) return false;
  if (key.length > 3 && r.includes(key)) return true;
  const words = new Set(r.split(/[^a-z0-9]+/).filter(Boolean));
  return key
    .split(/[^a-z0-9]+/)
    .some((t) => t.length >= 3 && !REASON_STOPWORDS.has(t) && words.has(t));
}

/**
 * D3 — the whole decision, as one pure function the worker and the CLI both
 * call. "on" / "adjacent" / unknown are `passed`, exactly as before this rule
 * existed. "off" is `review` plus ONE structural validation_errors entry.
 *
 * The stored reason is the model's words, clamped and screened; it is never the
 * puzzle. When the screen cannot clear it the entry still exists (the flag is
 * the point) with the reason replaced.
 *
 * @param {{domain_fit?: unknown, reason?: unknown, domain_fit_reason?: unknown, answerKey?: unknown}} [input]
 * @returns {{fit: "on"|"adjacent"|"off"|"unknown", validation_status: "passed"|"review",
 *   validation_errors: {key: string, reason: string}[]|null}}
 */
export function deriveValidation(input) {
  const fit = normalizeDomainFit(input?.domain_fit);
  if (fit !== "off") return { fit, validation_status: "passed", validation_errors: null };
  const raw = input?.reason !== undefined ? input.reason : input?.domain_fit_reason;
  let reason = clampFitReason(raw);
  if (reason && reasonLeaksAnswer(reason, input?.answerKey)) reason = null;
  return {
    fit,
    validation_status: "review",
    validation_errors: [{ key: DOMAIN_FIT_OFF_KEY, reason: reason ?? DOMAIN_FIT_REASON_WITHHELD }],
  };
}

/**
 * The self-report as it arrives: on the array ELEMENT (where the prompt puts
 * it, next to `difficulty`) or nested inside `puzzle` (where a model sometimes
 * puts it anyway). Element wins.
 * @param {unknown} element
 * @returns {{domain_fit: unknown, domain_fit_reason: unknown}}
 */
export function readDomainFit(element) {
  const el = element && typeof element === "object" ? /** @type {Record<string, unknown>} */ (element) : {};
  const nested = el.puzzle && typeof el.puzzle === "object" ? /** @type {Record<string, unknown>} */ (el.puzzle) : {};
  return {
    domain_fit: el.domain_fit !== undefined ? el.domain_fit : nested.domain_fit,
    domain_fit_reason: el.domain_fit_reason !== undefined ? el.domain_fit_reason : nested.domain_fit_reason,
  };
}

// ── hashing / fingerprint ───────────────────────────────────────────────────────
const sha256 = (s) => createHash("sha256").update(s).digest("hex");
function stableStringify(v) {
  if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]";
  if (v && typeof v === "object") return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + stableStringify(v[k])).join(",") + "}";
  return JSON.stringify(v);
}
export function contentHash(content, answerKey) {
  return sha256(stableStringify(content) + " " + String(answerKey || ""));
}
// subject_fingerprint: normalized subject tokens per type, for the 90-day non-repeat gate.
export function subjectFingerprint(type, c) {
  let tokens = [];
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  switch (type) {
    case "Rackl": tokens = (c.groups || []).flatMap((g) => (g.items || [])).map(norm); break;
    case "Signal Drop": tokens = [norm(c.word)]; break;
    case "The Stack": tokens = (c.items || []).map(norm); break;
    case "Dark Fiber": tokens = (c.pairs || []).map((p) => norm(p.term)); break;
    default: tokens = (c.questions || []).map((q) => norm(q.q).split(" ").slice(0, 6).join(" ")); break;
  }
  return sha256([...new Set(tokens)].sort().join("|")).slice(0, 24);
}

// ── defensive model-JSON parse (strip fences, salvage first object) ─────────────
export function parseModelJson(raw) {
  if (typeof raw !== "string") return null;
  let s = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try { return JSON.parse(s); } catch { /* salvage */ }
  const start = s.indexOf("{"); if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; }
    else if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) { try { return JSON.parse(s.slice(start, i + 1)); } catch { return null; } } }
  }
  return null;
}
