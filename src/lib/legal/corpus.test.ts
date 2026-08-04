// Compliance guard for the legal corpus (CC-TOS-PRICING-1.0).
//
// These are not style tests. Each assertion pins a clause the master Terms are
// REQUIRED to carry, or a STOP CONDITION the corpus must never violate. If one
// of these fails, a clause has been deleted or weakened — read the assertion
// message before "fixing" the test.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseLegalDoc, toPlainText } from "./markdown.ts";
import { MASTER_FILE, SCHEDULES, isDraft } from "./documents.ts";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

const masterSrc = read(MASTER_FILE);
const master = parseLegalDoc(masterSrc);
const masterText = toPlainText(master.blocks);

const localSchedules = SCHEDULES.filter((s) => s.kind === "local");
const scheduleDocs = new Map(
  localSchedules.map((s) => [s.slug, parseLegalDoc(read(s.file!))] as const),
);
const scheduleText = (slug: string) => toPlainText(scheduleDocs.get(slug)!.blocks);

/** Case-insensitive substring assertion with a reason attached. */
function has(haystack: string, needle: string, why: string) {
  assert.ok(
    haystack.toLowerCase().includes(needle.toLowerCase()),
    `${why} — expected to find: ${JSON.stringify(needle)}`,
  );
}

// ── (a) Auto-renewal disclosure ─────────────────────────────────────────────

test("(a) auto-renewal notice is conspicuous and sits above §1", () => {
  const notice = master.blocks.find((b) => b.t === "note");
  assert.ok(notice, "master must open with a blockquote notice (the conspicuous box)");

  const firstH2 = master.blocks.findIndex((b) => b.t === "h2");
  const noticeAt = master.blocks.indexOf(notice!);
  assert.ok(noticeAt < firstH2, "the auto-renewal notice must precede §1 The Services");

  const text = toPlainText([notice!]);
  // Conspicuousness: the operative sentences are upper-case.
  const caps = text.replace(/[^A-Za-z]/g, "");
  const upperRatio = caps.split("").filter((c) => c >= "A" && c <= "Z").length / caps.length;
  assert.ok(upperRatio > 0.7, `auto-renewal notice must be predominantly ALL CAPS (got ${upperRatio.toFixed(2)})`);

  has(text, "AUTOMATICALLY RENEW", "ROSCA: must disclose automatic renewal");
  has(text, "CANCEL", "ROSCA: must state how to cancel");
  has(text, "cancel@faraday-intelligence.ai", "must give a cancellation email address");
  has(text, "ACCOUNT", "must give an in-account cancel path");
  has(text, "PRO-RATA REFUND", "annual plans: pro-rata refund of the unused portion");
  has(text, "NO REFUND", "monthly plans: no refund");
});

// ── (b) Anti-scraping, AI/TDM ───────────────────────────────────────────────

test("(b) anti-scraping prohibits automated retrieval", () => {
  for (const term of ["spider", "robot", "crawler", "scraper", "automated means"]) {
    has(masterText, term, "must prohibit automated retrieval");
  }
  has(masterText, "under a written API license", "agent retrieval is allowed only via a licensed API");
});

test("(b) machine-learning prohibition names every restricted use", () => {
  for (const term of ["train", "fine-tune", "evaluat", "benchmark", "ground"]) {
    has(masterText, term, "ML prohibition must cover this use");
  }
  has(masterText, "large language model", "ML prohibition must reach LLMs explicitly");
});

test("(b) text-and-data-mining rights are expressly reserved (EU DSM Art. 4 opt-out)", () => {
  has(masterText, "text and data mining", "must reserve TDM rights");
  has(masterText, "Article 4(3)", "must cite the DSM Directive opt-out provision");
  has(masterText, "2019/790", "must cite the DSM Directive by number");
  has(masterText, "No text-and-data-mining exception applies", "the reservation must be explicit");
});

// ── (c) Named seat / no resale ──────────────────────────────────────────────

test("(c) access is a named seat, with no resale or firm-wide redistribution", () => {
  has(masterText, "licensed to one named individual", "named-seat licence");
  has(masterText, "resell", "no resale");
  has(masterText, "sublicense", "no sublicensing");
  has(masterText, "redistribute subscriber-facing artifacts", "no firm-wide internal redistribution");
  has(masterText, "team or seat license", "must point at the licensed alternative");
});

// ── (d) Attribution — and the persona STOP CONDITION ─────────────────────────

test("(d) attribution requires source line, institutional author, live link and vintage", () => {
  has(masterText, "source line naming the specific Faraday storefront", "(i) source line + domain");
  has(masterText, '"Faraday Intelligence"', "(ii) institutional author");
  has(masterText, "functioning hyperlink", "(iii) live hyperlink to the original URL");
  has(masterText, "publication date", "(iv) publication or vintage date");
  has(masterText, "No implied endorsement", "no-implied-endorsement clause");
  has(masterText, "No distortion or misattribution", "no-distortion / misattribution clause");
  has(masterText, "Third-party licensors", "third-party licensor carve-out");
});

test("STOP CONDITION (d): no clause requires third parties to cite a persona by name", () => {
  // Institutional attribution only. A persona byline must never be the required
  // credit for citable analysis. The names may appear elsewhere in the corpus
  // (e.g. disclosing that they are house voices) but never inside the
  // attribution section.
  const attribution = masterSrc.slice(
    masterSrc.indexOf("## 6. Permitted reuse"),
    masterSrc.indexOf("## 7. No advice"),
  );
  assert.ok(attribution.length > 0, "attribution section must exist");
  for (const persona of ["Gilbert Faraday", "Gil Faraday", "Mach Eigen"]) {
    assert.ok(
      !attribution.includes(persona),
      `STOP CONDITION violated: the attribution section must not require citing "${persona}". ` +
        `Attribution is institutional — "Faraday Intelligence" only.`,
    );
  }
});

// ── (e) No advice / no reliance ─────────────────────────────────────────────

test("(e) no advice, no fiduciary relationship, explicit no-reliance", () => {
  for (const term of ["investment", "legal", "engineering", "siting", "permitting"]) {
    has(masterText, term, "advice disclaimer must name this field");
  }
  has(masterText, "no fiduciary, advisory, agency", "no advisory relationship is created");
  has(masterText, "you will not rely", "explicit no-reliance");
  has(masterText, "allocating capital", "no-reliance must reach capital allocation");
});

// ── (f) Forecast / vintage ──────────────────────────────────────────────────

test("(f) forecast disclaimer matches the actual vintage data model", () => {
  has(masterText, "model estimates", "scores and forecasts are model estimates");
  has(masterText, "point in time", "vintages are point-in-time");
  has(masterText, "Revisions are expected", "revisions are expected");
  has(masterText, "does not restate historical", "historical values are not restated");
  has(masterText, "Methodology may change", "methodology may change");
  for (const table of [
    "forecast_sources",
    "forecast_vintages",
    "forecast_observations",
    "forecast_revisions",
  ]) {
    has(masterText, table, `disclaimer must reference the ${table} vintage concept`);
  }
});

// ── (g) Third-party data ────────────────────────────────────────────────────

test("(g) third-party pass-through names the real upstream sources", () => {
  for (const src of ["Energy Information Administration", "PJM", "Aqueduct", "FEMA", "Geological Survey", "Bureau of Labor Statistics", "GIS"]) {
    has(masterText, src, "third-party section must name this source family");
  }
  has(masterText, "pass through to you", "upstream licensor terms pass through");
});

// ── (h) AI disclosure ───────────────────────────────────────────────────────

test("(h) AI-assisted content is disclosed plainly, with the human review gate", () => {
  has(masterText, "automated intelligence pipeline", "must disclose the pipeline");
  has(masterText, "agent-drafted", "must disclose agent drafting");
  has(masterText, "human editorial review gate", "must state the human review gate");
});

// ── (i) Liability cap ───────────────────────────────────────────────────────

test("(i) liability is capped at six months of fees, or US $100", () => {
  has(masterText, "SIX (6) MONTHS", "cap window is six months");
  has(masterText, "ONE HUNDRED U.S. DOLLARS", "floor is US $100");
});

// ── (j) Feedback licence, not assignment ────────────────────────────────────

test("(j) feedback is licensed, never assigned", () => {
  has(masterText, "non-exclusive, perpetual", "feedback licence terms");
  has(masterText, "royalty-free", "feedback licence terms");
  has(masterText, "You keep ownership of your feedback", "must not assign subscriber ideas");
  has(masterText, "not an assignment", "must say plainly that it is not an assignment");
});

// ── (k) Standard clauses ────────────────────────────────────────────────────

test("(k) indemnity, termination, severability, assignment, entire agreement", () => {
  for (const clause of ["Indemnification", "termination", "Severability", "Assignment", "Entire agreement"]) {
    has(masterText, clause, `${clause} clause must be present`);
  }
});

// ── (l) Dispute resolution ──────────────────────────────────────────────────

test("(l) arbitration is mutual, with small-claims and injunctive carve-outs", () => {
  has(masterText, "binding individual arbitration", "arbitration clause");
  has(masterText, "This obligation is mutual", "arbitration must be mutual, not unilateral");
  has(masterText, "small-claims court", "small-claims carve-out");
  has(masterText, "injunctive", "injunctive-relief carve-out");
  has(masterText, "one (1) year", "one-year limitation on filing claims");
});

test("(l) governing law and venue are left as a TODO for counsel", () => {
  const disputes = masterSrc.slice(
    masterSrc.indexOf("## 16. Dispute resolution"),
    masterSrc.indexOf("## 17. Accessibility"),
  );
  has(disputes, "TODO(myke)", "governing law/venue must remain an explicit TODO placeholder");
  has(disputes, "Placeholder for review only", "the placeholder must be labelled as such");
});

// ── (m) Accessibility ───────────────────────────────────────────────────────

test("(m) accessibility statement targets WCAG 2.1 AA and gives an email contact", () => {
  has(masterText, "WCAG", "must name WCAG");
  has(masterText, "2.1", "must name the WCAG version");
  has(masterText, "Level AA", "must name the conformance level");
  has(masterText, "accessibility@faraday-intelligence.ai", "must give an accessibility email");
});

test("STOP CONDITION (m): no phone number and no 24/7 support commitment anywhere", () => {
  const phone = /\(?\b\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/;
  const all = [masterSrc, ...localSchedules.map((s) => read(s.file!))].join("\n");
  assert.ok(!phone.test(all), "the corpus must not publish a phone number");
  assert.ok(!/24\/7/.test(all), "the corpus must not commit to 24/7 support");
});

// ── Schedules ───────────────────────────────────────────────────────────────

test("five storefront schedules are registered", () => {
  assert.deepEqual(
    SCHEDULES.map((s) => s.slug).sort(),
    [
      "briefing-library",
      "daily-challenge",
      "faraday-academy",
      "jurisdiction-watch",
      "signal-room",
    ],
  );
});

test("every local schedule incorporates the master by reference", () => {
  for (const [slug, doc] of scheduleDocs) {
    const text = toPlainText(doc.blocks);
    has(text, "incorporated into this Schedule by reference", `${slug} must incorporate the master`);
    has(text, "Master Terms", `${slug} must name the Master Terms`);
    has(text, "this Schedule controls", `${slug} must state the conflict rule`);
  }
});

test("NO DUPLICATION: the master body exists in exactly one file", () => {
  // A distinctive sentence from the master. If it turns up in a Schedule, the
  // master has been copied instead of referenced — the failure this whole
  // design exists to prevent.
  const fingerprint = "No text-and-data-mining exception applies to the Services.";
  assert.ok(masterSrc.includes(fingerprint), "fingerprint sentence must be in the master");

  const dir = "content/legal/schedules";
  for (const file of readdirSync(join(process.cwd(), dir))) {
    const body = read(join(dir, file));
    assert.ok(
      !body.includes(fingerprint),
      `${file} contains master body text. Schedules must LINK to the master, never copy it.`,
    );
  }
});

test("NO DUPLICATION: the Jurisdiction Watch schedule is not vendored here", () => {
  const jw = SCHEDULES.find((s) => s.slug === "jurisdiction-watch")!;
  assert.equal(jw.kind, "remote", "JW's schedule is owned by the Jurisdiction Watch repo");
  assert.equal(jw.file, undefined, "JW's schedule must not have a local copy in this repo");
  const files = readdirSync(join(process.cwd(), "content/legal/schedules"));
  assert.ok(
    !files.some((f) => f.includes("jurisdiction-watch")),
    "found a local Jurisdiction Watch schedule — that is a second copy",
  );
});

test("Daily Challenge schedule: age gate, no-purchase-necessary, in-game mechanics have no cash value", () => {
  const t = scheduleText("daily-challenge");
  has(t, "at least 16 years old", "minimum-age eligibility statement");
  has(t, "NO PURCHASE OR PAYMENT OF ANY KIND IS NECESSARY", "no-purchase-necessary language");
  has(t, "no cash value", "in-game mechanics have no cash value");
  has(t, "not redeemable", "in-game mechanics are not redeemable");
  has(t, "not transferable", "in-game mechanics are not transferable");
  // The retired MW unit must be addressed, not silently dropped.
  has(t, '"MW"', "the retired MW mechanic must be addressed explicitly");
});

test("Signal Room schedule: configurator output terms, provenance and review status", () => {
  const t = scheduleText("signal-room");
  has(t, "configurator output", "configurator output terms");
  has(t, "provenance", "signal provenance");
  has(t, "review status", "review status");
  has(t, "Unreviewed", "unreviewed signals must be distinguished");
});

test("Briefing Library schedule: token terms, and the counsel-review block is intact", () => {
  const t = scheduleText("briefing-library");
  has(t, "limited, revocable licence to access", "tokens are a limited licence");
  has(t, "not stored value", "tokens are not stored value");
  has(t, "not a gift card", "tokens are not a gift card");
  has(t, "not redeemable", "tokens are not redeemable for cash");
  has(t, "not transferable", "tokens are non-transferable");
  has(t, "[COUNSEL REVIEW REQUIRED — EXPIRY/FORFEITURE TERMS PENDING]", "the counsel-review block must be present verbatim");
  has(t, "escheat", "unclaimed-property/escheat exposure must be named");
  has(t, "unhedged redemption liability", "the Academy token-grant conflict must be flagged");
});

test("STOP CONDITION: the corpus never invents an expiry and never promises tokens are permanent", () => {
  const all = [masterSrc, ...localSchedules.map((s) => read(s.file!))].join("\n");
  // An invented period, e.g. "tokens expire after 12 months".
  assert.ok(
    !/tokens?[^.]{0,60}expires? (after|in|within)\s+\d/i.test(all),
    "an expiry period was invented — BL-4 is open pending counsel",
  );
  // An affirmative never-expire promise. The phrase is permitted ONLY inside a
  // prohibition ("Do not publish an affirmative statement that tokens never
  // expire") — that sentence is BL-4 forbidding the promise, not making it.
  for (const m of all.matchAll(/tokens? never expires?/gi)) {
    const lead = all.slice(Math.max(0, (m.index ?? 0) - 120), m.index ?? 0);
    assert.ok(
      /do not publish|must not|never publish/i.test(lead),
      'the corpus must not assert "tokens never expire" — that is a durable representation ' +
        "about a prepaid balance that BL-4 is holding open for counsel. Context: " +
        JSON.stringify(lead.slice(-80)),
    );
  }
});

test("STOP CONDITION: no live UI surface promises tokens never expire", () => {
  // The corpus is only half of it. This promise was published on the storefront
  // homepage and, by default, on every product stub page — both were removed by
  // CC-TOS-PRICING-1.0. This guard keeps them from coming back.
  const offenders: string[] = [];
  const scan = (dir: string) => {
    for (const name of readdirSync(join(process.cwd(), dir), { withFileTypes: true })) {
      const rel = join(dir, name.name);
      if (name.isDirectory()) scan(rel);
      else if (/\.(tsx?|jsx?)$/.test(name.name) && !/\.test\./.test(name.name)) {
        const src = read(rel);
        for (const [i, line] of src.split("\n").entries()) {
          // Skip the explanatory comments that name the removed copy.
          if (/^\s*(\/\/|\*|\{?\/\*)/.test(line) || /used to read|Do NOT restore/.test(line)) continue;
          if (/tokens? never expires?/i.test(line)) offenders.push(`${rel}:${i + 1}`);
        }
      }
    }
  };
  scan("src/app");
  scan("src/components");
  assert.deepEqual(offenders, [], "a UI surface promises tokens never expire — see Schedule BL, BL-4");
});

test("Academy schedule: certification is not accredited, refunds are a placeholder", () => {
  const t = scheduleText("faraday-academy");
  has(t, "attests completion", "a certificate attests course completion only");
  has(t, "not an accredited professional credential", "certificate is not an accredited credential");
  has(t, "TODO(myke + counsel): set the Academy refund policy", "refund policy placeholder");
  has(t, "unhedged redemption liability", "the token-grant conflict must be flagged here too");
  has(t, "LearnWorlds", "must name the external LMS it is delivered on");
});

test("Academy schedule is a standalone paste source (no owning repo)", () => {
  const entry = SCHEDULES.find((s) => s.slug === "faraday-academy")!;
  const doc = scheduleDocs.get("faraday-academy")!;
  assert.match(doc.meta.owningRepo ?? "", /None/i);
  assert.equal(entry.kind, "local", "the hub hosts the Academy schedule since Academy has no repo");
});

// ── Draft posture ───────────────────────────────────────────────────────────

test("every document is DRAFT until counsel clears it, and says so", () => {
  for (const [slug, doc] of [["master", master] as const, ...scheduleDocs]) {
    assert.ok(isDraft(doc), `${slug} must be flagged draft while it carries TODO placeholders`);
    assert.match(
      doc.meta.effective ?? "",
      /TODO/i,
      `${slug} must not carry an effective date before counsel clearance`,
    );
  }
});

test("the master names the operating entity exactly", () => {
  has(masterText, "Faraday Intelligence LLC", "operating entity string");
  has(masterText, "Minnesota limited liability company", "entity form and state");
});

test("locked product names are used verbatim", () => {
  has(masterText, "Faraday Intelligent Alert", "locked product name — never renamed");
  has(masterText, "Jurisdiction Watch", "locked product name");
  has(masterText, "Faraday Daily Challenge", "locked product name");
});
