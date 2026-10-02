// Tests for the academy-ai output guards and meter.
//   run: deno test --allow-net supabase/functions/academy-ai/guards.test.ts
import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { RESPONSE_SCHEMA } from "./prompt.ts";
import {
  applyGuards,
  mermaidLooksValid,
  needsCite,
  normalizeUrl,
  scanCopy,
  verifySources,
  type ModelAnswer,
} from "./guards.ts";
import {
  chicagoDay,
  DAILY_LIMIT,
  decide,
  estimateCostUsd,
  ipPrefix,
  mintAnonId,
  nextChicagoMidnight,
  verifyAnonCookie,
} from "./meter.ts";

const SEARCH = [
  "https://www.ferc.gov/media/order-1920",
  "https://example.gov/report?x=1",
];

// ── copy guard ───────────────────────────────────────────────────────────────

Deno.test("copy guard catches taxonomy codes", () => {
  assertEquals(scanCopy("See D2.11 for more.", "p", false)[0].kind, "taxonomy_code");
  assertEquals(scanCopy("Tower T-001 covers it.", "p", false)[0].kind, "taxonomy_code");
  assertEquals(scanCopy("Domain D7 explains this.", "p", false)[0].kind, "taxonomy_code");
});

Deno.test("copy guard catches curriculum counts in several phrasings", () => {
  for (const text of [
    "There are 23 domains in the framework.",
    "All ninety-nine courses cover this.",
    "The curriculum spans twelve sub-domains.",
    "It has 116 sub-domains.",
  ]) {
    const hits = scanCopy(text, "p", false).filter((v) => v.kind === "curriculum_count");
    assert(hits.length > 0, `missed a count in: ${text}`);
  }
});

Deno.test("copy guard does not flag ordinary numbers as curriculum counts", () => {
  const hits = scanCopy("The plant drew 400 megawatts across 3 substations.", "p", false);
  assertEquals(hits.filter((v) => v.kind === "curriculum_count").length, 0);
});

Deno.test("prices are flagged during beta and allowed after", () => {
  assertEquals(scanCopy("It costs $4.99.", "p", false).some((v) => v.kind === "price"), true);
  assertEquals(scanCopy("It costs $4.99.", "p", true).some((v) => v.kind === "price"), false);
  assertEquals(scanCopy("Pay 9.99 USD.", "p", false).some((v) => v.kind === "price"), true);
});

Deno.test("banned phrases are caught case-insensitively", () => {
  for (const text of [
    "This is a cutting-edge approach.",
    "Great question!",
    "We're excited to announce the thing.",
    "Our approach is different.",
    "A truly revolutionary shift.",
    "Leveraging the data.",
  ]) {
    assert(scanCopy(text, "p", false).some((v) => v.kind === "banned_phrase"), `missed: ${text}`);
  }
});

// ── source verification ──────────────────────────────────────────────────────

Deno.test("urls normalize past scheme, www and trailing slash", () => {
  assertEquals(normalizeUrl("https://www.ferc.gov/media/order-1920/"), "ferc.gov/media/order-1920");
  assertEquals(normalizeUrl("http://ferc.gov/media/order-1920"), "ferc.gov/media/order-1920");
});

Deno.test("a source not in this call's search results is dropped", () => {
  const { kept, dropped, remap } = verifySources(
    [
      { title: "Invented", url: "https://nowhere.example/made-up" },
      { title: "Real", url: "https://ferc.gov/media/order-1920" },
    ],
    SEARCH,
  );
  assertEquals(kept.length, 1);
  assertEquals(dropped.length, 1);
  assertEquals(kept[0].title, "Real");
  // The surviving source was #2 and is renumbered to #1.
  assertEquals(remap.get(2), 1);
  assertEquals(remap.has(1), false);
});

// ── cite coverage ────────────────────────────────────────────────────────────

Deno.test("claims that must carry a cite are detected", () => {
  assertEquals(needsCite("Capacity rose 40 percent."), true);
  assertEquals(needsCite("The order issued in 2024."), true);
  assertEquals(needsCite('He called it "a hard limit".'), true);
  assertEquals(needsCite("Duke Energy filed it."), true);
  assertEquals(needsCite("cooling moves heat away from the rack"), false);
});

// ── mermaid ──────────────────────────────────────────────────────────────────

Deno.test("mermaid validation accepts real diagrams and rejects broken ones", () => {
  assert(mermaidLooksValid("flowchart TD\n  A[Load] --> B[Substation]"));
  assert(mermaidLooksValid("sequenceDiagram\n  A->>B: request"));
  assertEquals(mermaidLooksValid(""), false);
  assertEquals(mermaidLooksValid("just some prose"), false);
  assertEquals(mermaidLooksValid("flowchart TD\n  A[Load --> B"), false); // unbalanced
  assertEquals(mermaidLooksValid("```mermaid\nflowchart TD\n A-->B\n```"), false); // fenced
  assertEquals(mermaidLooksValid("flowchart TD"), false); // header only
});

// ── the pipeline ─────────────────────────────────────────────────────────────

function answer(over: Partial<ModelAnswer> = {}): ModelAnswer {
  return {
    kind: "answer",
    paragraphs: [{ text: "Capacity rose 40 percent in 2024.", cites: [1] }],
    sources: [{ title: "Order 1920", url: "https://ferc.gov/media/order-1920" }],
    ...over,
  };
}

Deno.test("a clean answer passes through intact", () => {
  const r = applyGuards(answer(), SEARCH, { allowPrices: false });
  assertEquals(r.refuse, false);
  assertEquals(r.needsRewrite, false);
  assertEquals(r.answer.paragraphs?.length, 1);
  assertEquals(r.answer.sources?.length, 1);
  assertEquals(r.notes.length, 0);
});

Deno.test("a paragraph loses its only source and goes with it", () => {
  const r = applyGuards(
    answer({ sources: [{ title: "Fake", url: "https://nowhere.example/x" }] }),
    SEARCH,
    { allowPrices: false },
  );
  assertEquals(r.answer.paragraphs?.length, 0);
  assertEquals(r.refuse, true);
  assert(r.notes.some((n) => n.includes("could not be verified")));
});

Deno.test("an uncited factual claim is removed", () => {
  const r = applyGuards(
    answer({ paragraphs: [{ text: "Capacity rose 40 percent in 2024.", cites: [] }] }),
    SEARCH,
    { allowPrices: false },
  );
  assertEquals(r.answer.paragraphs?.length, 0);
  assert(r.notes.some((n) => n.includes("lacking a usable citation")));
});

Deno.test("an uncited non-factual sentence survives", () => {
  const r = applyGuards(
    answer({ paragraphs: [{ text: "cooling moves heat away from the rack", cites: [] }] }),
    SEARCH,
    { allowPrices: false },
  );
  assertEquals(r.answer.paragraphs?.length, 1);
  assertEquals(r.refuse, false);
});

Deno.test("cites are renumbered onto the surviving sources", () => {
  const r = applyGuards(
    answer({
      paragraphs: [{ text: "It issued in 2024.", cites: [2] }],
      sources: [
        { title: "Fake", url: "https://nowhere.example/x" },
        { title: "Real", url: "https://example.gov/report?x=1" },
      ],
    }),
    SEARCH,
    { allowPrices: false },
  );
  assertEquals(r.answer.sources?.length, 1);
  assertEquals(r.answer.paragraphs?.[0].cites, [1]);
});

Deno.test("a broken diagram is dropped and the text is kept", () => {
  const r = applyGuards(
    answer({ diagram: { mermaid: "not a diagram", cites: [1] } }),
    SEARCH,
    { allowPrices: false },
  );
  assertEquals(r.answer.diagram, undefined);
  assertEquals(r.answer.paragraphs?.length, 1);
  assert(r.notes.some((n) => n.includes("did not parse")));
});

Deno.test("a valid diagram survives", () => {
  const r = applyGuards(
    answer({ diagram: { mermaid: "flowchart TD\n  A[Load] --> B[Rack]", cites: [1] } }),
    SEARCH,
    { allowPrices: false },
  );
  assertEquals(r.answer.diagram?.cites, [1]);
});

Deno.test("a chart with no verified source is dropped with a note", () => {
  const r = applyGuards(
    answer({ chart: { spec: JSON.stringify({ data: { values: [{ a: 1 }] } }), data_cites: [] } }),
    SEARCH,
    { allowPrices: false },
  );
  assertEquals(r.answer.chart, undefined);
  assert(r.notes.some((n) => n.includes("no verified source")));
});

Deno.test("a chart whose spec is not valid JSON is dropped, text kept", () => {
  const r = applyGuards(answer({ chart: { spec: "{not json", data_cites: [1] } }), SEARCH, { allowPrices: false });
  assertEquals(r.answer.chart, undefined);
  assertEquals(r.answer.paragraphs?.length, 1);
  assert(r.notes.some((n) => n.includes("did not parse")));
});

Deno.test("a valid chart spec is parsed into an object for the client", () => {
  const spec = { $schema: "https://vega.github.io/schema/vega-lite/v5.json", data: { values: [{ a: 1 }] } };
  const r = applyGuards(
    answer({ chart: { spec: JSON.stringify(spec), data_cites: [1] } }),
    SEARCH,
    { allowPrices: false },
  );
  // The model sends JSON text; the reader receives an object.
  assertEquals(typeof r.answer.chart?.spec, "object");
  assertEquals((r.answer.chart?.spec as Record<string, unknown>)["$schema"], spec.$schema);
  assertEquals(r.answer.chart?.data_cites, [1]);
});

Deno.test("the response schema contains no unsupported additionalProperties", () => {
  // Structured outputs reject `additionalProperties` set to anything but false.
  // chart.spec used to be `{type:"object", additionalProperties:true}`, which 400'd
  // every request — the whole panel was dead on arrival.
  const walk = (node: unknown, path: string): string[] => {
    if (!node || typeof node !== "object") return [];
    const o = node as Record<string, unknown>;
    const bad = "additionalProperties" in o && o["additionalProperties"] !== false ? [path] : [];
    return bad.concat(Object.entries(o).flatMap(([k, v]) => walk(v, `${path}.${k}`)));
  };
  assertEquals(walk(RESPONSE_SCHEMA, "schema"), []);
});

Deno.test("banned copy marks the answer for its one rewrite", () => {
  const r = applyGuards(
    answer({ paragraphs: [{ text: "A cutting-edge shift in 2024.", cites: [1] }] }),
    SEARCH,
    { allowPrices: false },
  );
  assertEquals(r.needsRewrite, true);
});

Deno.test("a refusal passes straight through", () => {
  const r = applyGuards({ kind: "refusal", refusal_reason: "no sources" }, SEARCH, { allowPrices: false });
  assertEquals(r.refuse, true);
  assertEquals(r.answer.kind, "refusal");
});

// ── meter ────────────────────────────────────────────────────────────────────

Deno.test("the day boundary is Chicago, not UTC", () => {
  // Chicago is UTC-5 in July, so midnight local is 05:00Z: 04:30Z is still 30 June.
  assertEquals(chicagoDay(new Date("2026-07-01T04:30:00Z")), "2026-06-30");
  assertEquals(chicagoDay(new Date("2026-07-01T05:30:00Z")), "2026-07-01");
  // In January it is UTC-6, so the same 05:30Z falls on the previous day.
  assertEquals(chicagoDay(new Date("2026-01-15T05:30:00Z")), "2026-01-14");
  assertEquals(chicagoDay(new Date("2026-01-15T06:30:00Z")), "2026-01-15");
});

Deno.test("the reset lands on the next Chicago midnight across both DST shifts", () => {
  for (const from of ["2026-03-07T20:00:00Z", "2026-11-01T02:00:00Z", "2026-07-04T18:00:00Z"]) {
    const now = new Date(from);
    const reset = nextChicagoMidnight(now);
    assert(reset.getTime() > now.getTime(), `reset not in the future for ${from}`);
    // The reset instant is the first moment of a later Chicago day.
    assert(chicagoDay(reset) !== chicagoDay(now), `reset did not cross the day for ${from}`);
    const justBefore = new Date(reset.getTime() - 60_000);
    assertEquals(chicagoDay(justBefore), chicagoDay(now));
  }
});

Deno.test("the allowance is five and runs out", () => {
  const now = new Date("2026-07-04T18:00:00Z");
  const base = { lastMinute: 1, lastHour: 1, turnstilePassed: false, spendCapReached: false, now };
  assertEquals(decide({ ...base, usedPrimary: 0, usedSecondary: 0 }).allow, true);
  const last = decide({ ...base, usedPrimary: DAILY_LIMIT - 1, usedSecondary: 0 });
  assertEquals(last.allow, true);
  assertEquals(last.allow === true ? last.remaining : -1, 1);
  const out = decide({ ...base, usedPrimary: DAILY_LIMIT, usedSecondary: 0 });
  assertEquals(out.allow, false);
  assertEquals(out.allow === false ? out.reason : "", "limit");
});

Deno.test("the higher of the two keys wins, so dropping a cookie gains nothing", () => {
  const now = new Date("2026-07-04T18:00:00Z");
  const d = decide({
    usedPrimary: 0, usedSecondary: DAILY_LIMIT,
    lastMinute: 1, lastHour: 1, turnstilePassed: false, spendCapReached: false, now,
  });
  assertEquals(d.allow, false);
  assertEquals(d.allow === false ? d.reason : "", "limit");
});

Deno.test("a burst asks for Turnstile, and passing it clears the way", () => {
  const now = new Date("2026-07-04T18:00:00Z");
  const base = { usedPrimary: 1, usedSecondary: 1, spendCapReached: false, now };
  const burst = decide({ ...base, lastMinute: 5, lastHour: 5, turnstilePassed: false });
  assertEquals(burst.allow === false ? burst.reason : "", "turnstile");
  assertEquals(decide({ ...base, lastMinute: 5, lastHour: 5, turnstilePassed: true }).allow, true);

  const hourly = decide({ ...base, lastMinute: 1, lastHour: 25, turnstilePassed: false });
  assertEquals(hourly.allow === false ? hourly.reason : "", "turnstile");
});

Deno.test("past forty an hour it is a hard throttle, Turnstile or not", () => {
  const now = new Date("2026-07-04T18:00:00Z");
  const d = decide({
    usedPrimary: 1, usedSecondary: 1, lastMinute: 1, lastHour: 41,
    turnstilePassed: true, spendCapReached: false, now,
  });
  assertEquals(d.allow === false ? d.reason : "", "throttled");
});

Deno.test("the global spend cap outranks every per-key check", () => {
  const now = new Date("2026-07-04T18:00:00Z");
  const d = decide({
    usedPrimary: 0, usedSecondary: 0, lastMinute: 1, lastHour: 1,
    turnstilePassed: true, spendCapReached: true, now,
  });
  assertEquals(d.allow === false ? d.reason : "", "spend_cap");
});

Deno.test("ip keys are prefixes, never whole addresses", () => {
  assertEquals(ipPrefix("203.0.113.42"), "203.0.113");
  assertEquals(ipPrefix("203.0.113.42, 70.1.2.3"), "203.0.113");
  assertEquals(ipPrefix("2001:db8:85a3:1234::1"), "2001:db8:85a3");
  assertEquals(ipPrefix(null), null);
  assertEquals(ipPrefix("garbage"), null);
});

Deno.test("an anonymous cookie verifies only under its own secret", async () => {
  const minted = await mintAnonId("secret-a");
  assertEquals(await verifyAnonCookie(minted.cookieValue, "secret-a"), minted.id);
  assertEquals(await verifyAnonCookie(minted.cookieValue, "secret-b"), null);
  assertEquals(await verifyAnonCookie(`${minted.id}.deadbeef`, "secret-a"), null);
  assertEquals(await verifyAnonCookie("no-dot", "secret-a"), null);
  assertEquals(await verifyAnonCookie(null, "secret-a"), null);
});

Deno.test("cost metering prices tokens and searches", () => {
  // 1M in + 1M out at the Opus 5 list rate, plus 10 searches at $10/1000.
  assertEquals(
    estimateCostUsd({ input_tokens: 1_000_000, output_tokens: 1_000_000, searches: 10 }),
    30.1,
  );
  assertEquals(estimateCostUsd({}), 0);
});
