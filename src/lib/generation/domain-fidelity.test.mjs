// CC-DC-GEN-DOMAIN-FIDELITY-1.0 — a generated puzzle's displayed domain must
// describe what the puzzle is actually ABOUT, and a puzzle that drifts off its
// day's sector reaches the commissioner before approval rather than after.
// Run: npm run test:generation-domain
//
// What this guards, in the order the pipeline hits it:
//   1. the PROMPT states the subject must sit inside the given sector, and asks
//      for the two advisory keys — in BOTH copies, byte-for-byte identically;
//   2. puzzle-schema TOLERATES the self-report: missing, misspelled or nested,
//      it is "unknown" and the slot still passes (D2);
//   3. deriveValidation maps on/adjacent/off/unknown onto the row (D3), clamps
//      the reason, and withholds one that repeats the answer;
//   4. offDomainFlags turns those rows into the panel's list, from a projection
//      with no puzzle content in it at all (D4).
//
// Measured against the live Football season (02701ead-a03e-4489-adb9-24d3c6787eec)
// on 2026-10-06: 595 bank rows, 0 of them with `domain` differing from their
// day's `sector_code`, and `validation_status` carrying no CHECK — which is why
// 'review' is a legal new value and why no existing row needs rewriting.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { systemPrompt, userPrompt } from "./prompts.js";
import * as cliPrompts from "../../../scripts/far287/lib/prompts.mjs";
import {
  DOMAIN_FIT_OFF_KEY,
  DOMAIN_FIT_REASON_MAX,
  DOMAIN_FIT_REASON_WITHHELD,
  DOMAIN_FIT_VALUES,
  clampFitReason,
  deriveValidation,
  normalizeDomainFit,
  readDomainFit,
  reasonLeaksAnswer,
  validateContent,
  answerKeyFrom,
} from "./puzzle-schema.js";
import * as cliSchema from "../../../scripts/far287/lib/puzzle-schema.mjs";
import { offDomainFlags } from "../league-office/generation-logic.ts";
import { TYPE_BATCH_SIZE, DEFAULT_MAX_TOKENS, startingBatchSize } from "./batching.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..", "..");

// The day as the worker hands it to the prompt: sector NAME plus the day's
// one-line scope (dc_daily_theme.theme_blurb — there is no sector-definition
// column, and the blurb is the row's statement of what the sector covers).
const THEME = {
  theater_name: "The Thermal Reckoning",
  sector_name: "Industry Media & Analyst Coverage",
  sector_scope: "Today The Thermal Reckoning turns to the Industry Media & Analyst Coverage sector — tracking Industry Analysts.",
  thread_names: ["Industry Analysts", "Trade Press"],
  tier_name: "Operate",
};
const ITEM = {
  theme: THEME,
  subject: "Example subject line",
  difficulty: "practitioner",
  threadScope: "Industry Analysts; Trade Press",
};

// ═══════════════════════════════════════════════════════════════════════════
// 1 — the prompt
// ═══════════════════════════════════════════════════════════════════════════

test("the system prompt names the sector as a boundary and asks for both keys", () => {
  const sys = systemPrompt("Rackl");
  assert.match(sys, /PRIMARY subject must sit INSIDE the Sector/);
  assert.match(sys, /"domain_fit"/);
  assert.match(sys, /"domain_fit_reason"/);
  assert.ok(sys.includes("on"), "the three values are offered by name");
  for (const v of DOMAIN_FIT_VALUES) assert.ok(sys.includes(`"${v}`) || sys.includes(`${v}"`), v);
  assert.match(sys, /120 characters/, "the reason clamp is stated to the model");
  assert.match(sys, /NEVER include an answer/i, "the reason must never carry puzzle content");
});

test("the user prompt carries the sector's one-line scope per ITEM", () => {
  const user = userPrompt("Rackl", [ITEM]);
  assert.match(user, /Sector scope — the puzzle's PRIMARY subject must sit inside this:/);
  assert.ok(user.includes(THEME.sector_name), "the sector name is named");
  assert.ok(user.includes("tracking Industry Analysts"), "the one-line scope is carried");
  assert.match(user, /report where it landed in "domain_fit"\/"domain_fit_reason"/);
});

test("a day with no scope falls back to its Thread names rather than an empty line", () => {
  const user = userPrompt("Rackl", [{ ...ITEM, theme: { ...THEME, sector_scope: null } }]);
  assert.match(user, /Sector scope[^\n]*Industry Analysts, Trade Press/);
  assert.doesNotMatch(user, /must sit inside this: [^\n]* — \n/);
});

test("the scope is collapsed to ONE line and bounded", () => {
  const messy = `  ragged\n\n   multi-line   blurb  ${"x".repeat(400)}`;
  const user = userPrompt("Rackl", [{ ...ITEM, theme: { ...THEME, sector_scope: messy } }]);
  const line = user.split("\n").find((l) => l.startsWith("  Sector scope — "));
  assert.ok(line, "the ITEM's scope line exists (not the closing instruction, which also says `Sector scope`)");
  assert.ok(line.length < 420, `scope line is bounded, got ${line.length}`);
  assert.ok(line.includes("ragged multi-line blurb"), "whitespace collapsed, content kept");
});

test("CC-DC-GEN-DIFFICULTY-CANON-1.0 still holds — no prompt asks for easy|medium|hard", () => {
  for (const rel of ["src/lib/generation/prompts.js", "scripts/far287/lib/prompts.mjs"]) {
    const src = readFileSync(join(REPO, rel), "utf8");
    assert.ok(!src.includes("easy|medium|hard"), `${rel} still requests the legacy vocabulary`);
    assert.ok(src.includes('"difficulty": "foundational|practitioner|expert"'), `${rel} canonical bands`);
    assert.ok(src.includes('"domain_fit": "on|adjacent|off"'), `${rel} requests domain_fit`);
  }
});

test("the two prompt copies produce byte-identical output (twin rule)", () => {
  const items = [ITEM, { ...ITEM, difficulty: "expert", subject: "Another subject" }];
  for (const type of ["Rackl", "Signal Drop", "The Stack", "Circuit", "The Brief", "Dark Fiber", "Frequency"]) {
    assert.equal(cliPrompts.systemPrompt(type), systemPrompt(type), `systemPrompt(${type})`);
    assert.equal(cliPrompts.userPrompt(type, items), userPrompt(type, items), `userPrompt(${type})`);
  }
  assert.equal(cliPrompts.userPrompt("Nonexistent Game", items), userPrompt("Nonexistent Game", items));
  assert.equal(userPrompt("Nonexistent Game", items), null, "an unspecced game is still skipped, not prompted blank");
});

// ═══════════════════════════════════════════════════════════════════════════
// 2 — CC-DC-GEN-BATCH-HARDENING-1.0 is not disturbed by two more keys
// ═══════════════════════════════════════════════════════════════════════════

test("the two extra keys leave every starting batch far inside max_tokens", () => {
  // CC-DC-GEN-BATCH-HARDENING-1.0's own sizing, re-checked rather than assumed.
  // Its worst case is The Brief at ~662 OUTPUT tokens/puzzle, started at 5.
  // `domain_fit` plus a reason clamped to DOMAIN_FIT_REASON_MAX adds a FIXED
  // per-puzzle cost — the keys, the quoting and the value — and nothing else
  // about the response grows, so the delta is the same for every game.
  const WORST_TOKENS_PER_PUZZLE = 662;
  const KEY_OVERHEAD_CHARS = 40; // `"domain_fit":"adjacent","domain_fit_reason":""`
  const extraPerPuzzle = Math.ceil((DOMAIN_FIT_REASON_MAX + KEY_OVERHEAD_CHARS) / 4);
  assert.ok(extraPerPuzzle <= 40, `the two keys cost ${extraPerPuzzle} tokens/puzzle`);

  for (const [type, size] of Object.entries(TYPE_BATCH_SIZE)) {
    // every type is sized at or under The Brief's per-puzzle cost, so pricing
    // them all at the worst case is a ceiling, not an estimate
    const after = (WORST_TOKENS_PER_PUZZLE + extraPerPuzzle) * size;
    assert.ok(
      after < DEFAULT_MAX_TOKENS * 0.7,
      `${type} at ${size} ≈ ${after} tokens must stay under 70% of ${DEFAULT_MAX_TOKENS}`
    );
  }
  // The Brief, the type the cap once bit: 3,310 → 3,510 of 16,000 (20.7% → 21.9%).
  assert.equal((WORST_TOKENS_PER_PUZZLE + extraPerPuzzle) * TYPE_BATCH_SIZE["The Brief"], 3510);

  // and no starting size moved — this rule re-priced nothing
  assert.equal(startingBatchSize("The Brief", 12), 5);
  assert.equal(startingBatchSize("Signal Drop", 12), 10);
  assert.equal(startingBatchSize("Rackl", 12), 8);
});

// ═══════════════════════════════════════════════════════════════════════════
// 3 — puzzle-schema tolerates the self-report (D2)
// ═══════════════════════════════════════════════════════════════════════════

const RACKL = {
  name: "Grid & Interconnect",
  domain: "Grid & Regulatory",
  groups: [
    { label: "ISO/RTOs", color: "#1C3424", textColor: "#EEE6DA", items: ["PJM", "ERCOT", "MISO", "CAISO"] },
    { label: "FERC Actions", color: "#C4922A", textColor: "#141210", items: ["Order 2023", "Tariff filing", "Rate case", "Order 1920"] },
    { label: "Capacity Terms", color: "#2A5A3A", textColor: "#EEE6DA", items: ["Capacity market", "Demand", "Peak load", "Reserve margin"] },
    { label: "Reliability", color: "#5A4010", textColor: "#EEE6DA", items: ["NERC", "Contingency", "Frequency", "Black start"] },
  ],
};

test("a self-report nested in the content neither validates nor invalidates it", () => {
  assert.equal(validateContent("Rackl", RACKL).ok, true, "baseline");
  const withFit = { ...RACKL, domain_fit: "off", domain_fit_reason: "drifted to cooling" };
  assert.equal(validateContent("Rackl", withFit).ok, true, "an extra key is never a schema failure");
  const withJunk = { ...RACKL, domain_fit: 7, domain_fit_reason: { nope: true } };
  assert.equal(validateContent("Rackl", withJunk).ok, true, "junk in the extra keys is still not a failure");
});

test("normalizeDomainFit maps anything that is not one of the three to unknown", () => {
  assert.equal(normalizeDomainFit("on"), "on");
  assert.equal(normalizeDomainFit(" ADJACENT "), "adjacent");
  assert.equal(normalizeDomainFit("Off"), "off");
  for (const v of ["", "ON-DOMAIN", "yes", "true", null, undefined, 1, {}, [], "offish"])
    assert.equal(normalizeDomainFit(v), "unknown", `normalizeDomainFit(${JSON.stringify(v)})`);
});

test("readDomainFit finds the keys on the element, or nested in the puzzle", () => {
  assert.deepEqual(readDomainFit({ domain_fit: "off", domain_fit_reason: "r", puzzle: {} }),
    { domain_fit: "off", domain_fit_reason: "r" });
  assert.deepEqual(readDomainFit({ puzzle: { domain_fit: "adjacent", domain_fit_reason: "n" } }),
    { domain_fit: "adjacent", domain_fit_reason: "n" });
  // the element wins when both are present
  assert.deepEqual(readDomainFit({ domain_fit: "on", puzzle: { domain_fit: "off" } }).domain_fit, "on");
  assert.deepEqual(readDomainFit(undefined), { domain_fit: undefined, domain_fit_reason: undefined });
  assert.deepEqual(readDomainFit("not an object"), { domain_fit: undefined, domain_fit_reason: undefined });
});

test("clampFitReason returns one tidy line of at most 120 characters, or null", () => {
  assert.equal(clampFitReason("  subject is   chip packaging,\n sector is site power "),
    "subject is chip packaging, sector is site power");
  assert.equal(clampFitReason(""), null);
  assert.equal(clampFitReason("   "), null);
  assert.equal(clampFitReason(null), null);
  assert.equal(clampFitReason(42), null);
  const long = "y".repeat(500);
  const clamped = clampFitReason(long);
  assert.equal(clamped.length, DOMAIN_FIT_REASON_MAX, `clamped to ${DOMAIN_FIT_REASON_MAX}`);
  assert.ok(clamped.endsWith("…"), "an overlong reason is visibly truncated");
  const exact = "z".repeat(DOMAIN_FIT_REASON_MAX);
  assert.equal(clampFitReason(exact), exact, "exactly at the clamp is untouched");
});

// ═══════════════════════════════════════════════════════════════════════════
// 4 — deriveValidation (D3)
// ═══════════════════════════════════════════════════════════════════════════

test("on / adjacent / unknown all pass, exactly as before this rule existed", () => {
  for (const fit of ["on", "adjacent", undefined, null, "banana", 7, ""]) {
    const got = deriveValidation({ domain_fit: fit, reason: "whatever" });
    assert.equal(got.validation_status, "passed", `domain_fit ${JSON.stringify(fit)}`);
    assert.equal(got.validation_errors, null, "a passing row carries no note");
  }
  assert.equal(deriveValidation().validation_status, "passed", "no self-report at all still passes");
  assert.equal(deriveValidation({}).fit, "unknown");
});

test("off routes to review with ONE structural note", () => {
  const got = deriveValidation({ domain_fit: "off", reason: "subject is chip packaging, sector is site power" });
  assert.equal(got.fit, "off");
  assert.equal(got.validation_status, "review");
  assert.deepEqual(got.validation_errors, [
    { key: DOMAIN_FIT_OFF_KEY, reason: "subject is chip packaging, sector is site power" },
  ]);
});

test("the stored reason is clamped, and `domain_fit_reason` is accepted as the key name", () => {
  const got = deriveValidation({ domain_fit: "off", domain_fit_reason: "q".repeat(400) });
  assert.equal(got.validation_errors[0].reason.length, DOMAIN_FIT_REASON_MAX);
});

test("an off with no usable reason is still flagged — the flag is the point", () => {
  for (const reason of [undefined, null, "", "   ", 12]) {
    const got = deriveValidation({ domain_fit: "off", reason });
    assert.equal(got.validation_status, "review");
    assert.deepEqual(got.validation_errors, [{ key: DOMAIN_FIT_OFF_KEY, reason: DOMAIN_FIT_REASON_WITHHELD }]);
  }
});

test("a reason that repeats the answer is WITHHELD — validation_errors never carries content", () => {
  const answerKey = answerKeyFrom("Rackl", RACKL);
  assert.ok(answerKey.includes("PJM"), "fixture sanity");
  const leaky = deriveValidation({ domain_fit: "off", reason: "it became a PJM capacity-market puzzle", answerKey });
  assert.equal(leaky.validation_errors[0].reason, DOMAIN_FIT_REASON_WITHHELD);

  const word = answerKeyFrom("Signal Drop", { name: "SUBSTATION", word: "SUBSTATION", clue: "c" });
  assert.equal(
    deriveValidation({ domain_fit: "off", reason: "the word is a SUBSTATION term, not a media one", answerKey: word })
      .validation_errors[0].reason,
    DOMAIN_FIT_REASON_WITHHELD
  );
  // a genuinely content-free reason survives the screen
  assert.equal(
    deriveValidation({ domain_fit: "off", reason: "ended up mainly about cooling, not the day's sector", answerKey })
      .validation_errors[0].reason,
    "ended up mainly about cooling, not the day's sector"
  );
});

test("reasonLeaksAnswer ignores function words and needs a real answer key", () => {
  assert.equal(reasonLeaksAnswer("the subject and the sector are not the same", "The Stack: one two"), false);
  assert.equal(reasonLeaksAnswer("anything at all", ""), false);
  assert.equal(reasonLeaksAnswer("", "PJM"), false);
  assert.equal(reasonLeaksAnswer("about NERC reliability", "1. NERC | 2. PJM"), true);
});

test("deriveValidation is a pure function of its input — no clock, no order effects", () => {
  const input = { domain_fit: "off", reason: "drifted", answerKey: "ZZZZ" };
  assert.deepEqual(deriveValidation(input), deriveValidation(input));
  assert.deepEqual(input, { domain_fit: "off", reason: "drifted", answerKey: "ZZZZ" }, "input not mutated");
});

test("the CLI copy of the contract behaves identically (twin rule)", () => {
  assert.deepEqual(cliSchema.DOMAIN_FIT_VALUES, DOMAIN_FIT_VALUES);
  assert.equal(cliSchema.DOMAIN_FIT_REASON_MAX, DOMAIN_FIT_REASON_MAX);
  assert.equal(cliSchema.DOMAIN_FIT_OFF_KEY, DOMAIN_FIT_OFF_KEY);
  assert.equal(cliSchema.DOMAIN_FIT_REASON_WITHHELD, DOMAIN_FIT_REASON_WITHHELD);
  const fits = ["on", "adjacent", "off", "OFF", " on ", "", null, undefined, 7, "banana"];
  const reasons = [undefined, null, "", "short reason", "w".repeat(300), "about PJM capacity"];
  for (const f of fits) {
    assert.equal(cliSchema.normalizeDomainFit(f), normalizeDomainFit(f), `normalize(${JSON.stringify(f)})`);
    for (const r of reasons) {
      assert.deepEqual(
        cliSchema.deriveValidation({ domain_fit: f, reason: r, answerKey: "ISO/RTOs: PJM, ERCOT" }),
        deriveValidation({ domain_fit: f, reason: r, answerKey: "ISO/RTOs: PJM, ERCOT" }),
        `deriveValidation(${JSON.stringify(f)}, ${JSON.stringify(r)})`
      );
    }
  }
  for (const r of reasons) assert.equal(cliSchema.clampFitReason(r), clampFitReason(r));
  assert.deepEqual(cliSchema.readDomainFit({ puzzle: { domain_fit: "off" } }), readDomainFit({ puzzle: { domain_fit: "off" } }));
});

// ═══════════════════════════════════════════════════════════════════════════
// 5 — the panel's read side (D4)
// ═══════════════════════════════════════════════════════════════════════════

const flagged = (date, game, reason) => ({
  go_live_date: date,
  puzzle_type: game,
  validation_status: "review",
  validation_errors: [{ key: DOMAIN_FIT_OFF_KEY, reason }],
});

test("offDomainFlags lists only reviewed-off rows, in date then game order", () => {
  const rows = [
    flagged("2026-11-02", "signal", "drifted to cooling"),
    { go_live_date: "2026-10-05", puzzle_type: "grid", validation_status: "passed", validation_errors: null },
    flagged("2026-11-02", "brief", "subject is capital markets"),
    flagged("2026-10-30", "ladder", "about chips, sector is media"),
  ];
  assert.deepEqual(offDomainFlags(rows), [
    { date: "2026-10-30", game: "ladder", reason: "about chips, sector is media" },
    { date: "2026-11-02", game: "brief", reason: "subject is capital markets" },
    { date: "2026-11-02", game: "signal", reason: "drifted to cooling" },
  ]);
});

test("a review row flagged for some OTHER reason is not an off-domain flag", () => {
  const rows = [{
    go_live_date: "2026-10-30", puzzle_type: "grid", validation_status: "review",
    validation_errors: [{ key: "something_else", reason: "not this rule's business" }],
  }];
  assert.deepEqual(offDomainFlags(rows), []);
});

test("a malformed note still produces the FLAG, just without a reason", () => {
  const cases = [
    { ...flagged("2026-10-30", "grid", null), validation_errors: [{ key: DOMAIN_FIT_OFF_KEY }] },
    { ...flagged("2026-10-30", "grid", null), validation_errors: [{ key: DOMAIN_FIT_OFF_KEY, reason: 42 }] },
  ];
  for (const row of cases) {
    assert.deepEqual(offDomainFlags([row]), [{ date: "2026-10-30", game: "grid", reason: null }]);
  }
});

test("offDomainFlags never throws on the shapes PostgREST can actually return", () => {
  const junk = [
    { go_live_date: "2026-10-30", puzzle_type: "grid", validation_status: "review", validation_errors: null },
    { go_live_date: "2026-10-30", puzzle_type: "grid", validation_status: "review", validation_errors: "oops" },
    { go_live_date: "2026-10-30", puzzle_type: "grid", validation_status: "review", validation_errors: [null, 7, "x"] },
    { go_live_date: "2026-10-30", puzzle_type: "grid" },
    {},
  ];
  assert.deepEqual(offDomainFlags(junk), []);
  assert.deepEqual(offDomainFlags([]), []);
  assert.deepEqual(offDomainFlags(null), []);
});

test("the panel's reason is clamped a second time — a hand-written row cannot overflow it", () => {
  const [flag] = offDomainFlags([flagged("2026-10-30", "grid", "k".repeat(900))]);
  assert.ok(flag.reason.length <= 160, `panel clamp, got ${flag.reason.length}`);
});

// ═══════════════════════════════════════════════════════════════════════════
// 6 — source guards: the write path and the read path stay content-free
// ═══════════════════════════════════════════════════════════════════════════

test("both insert paths route validation through deriveValidation, not a literal", () => {
  for (const rel of ["src/lib/generation/worker.ts", "scripts/far287/generate-puzzles.mjs"]) {
    const src = readFileSync(join(REPO, rel), "utf8");
    assert.ok(src.includes("deriveValidation("), `${rel} must derive validation_status`);
    assert.ok(!/validation_status:\s*"passed"/.test(src), `${rel} must not hardcode passed`);
    // D3 — the day's sector is still what `domain` means
    assert.match(src, /domain:\s*(day|it\.day)\.sector_code/, `${rel} must file the row under the day's sector`);
  }
});

test("generation-status reads four content-free columns for the flag list (D4)", () => {
  const src = readFileSync(join(REPO, "src/lib/league-office/generation-status.ts"), "utf8");
  const select = src.match(/select=go_live_date,puzzle_type,validation_status,validation_errors/);
  assert.ok(select, "the draft projection names exactly the four allowed columns");
  const draftQuery = src.slice(src.indexOf("published=eq.Unpublished"), src.indexOf("published=eq.Unpublished") + 220);
  for (const banned of ["puzzle_content", "hint_1", "answer_key", "answer_explanation", "puzzle_name"])
    assert.ok(!draftQuery.includes(banned), `the draft projection must never select ${banned}`);
});
