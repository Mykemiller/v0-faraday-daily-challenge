// Unit tests for the IDF 4.0 coverage-bridge scaffold (FAR IDF-4).
// Run with: deno test supabase/functions/faraday-crawl/coverage-bridge.test.ts
import { assert, assertEquals, assertThrows } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { TIER1_ACTIVATION, TIER2_ACTIVATION, D3_SUBDOMAIN_ACTIVATION, WAVE3_ACTIVATION, WHITESPACE_SCAFFOLDS, SOURCE_FIT_REPOINTS, mergeApproved } from "./coverage-bridge.ts";

const SUBDOMAIN_RE = /^D([1-9]|1[0-9]|2[0-3])\.\d{1,2}$/;

Deno.test("TIER1_ACTIVATION — every def is well-formed and uses a real AUTO-id", () => {
  for (const a of TIER1_ACTIVATION) {
    assert(/^AUTO-0\d\d$/.test(a.auto_id), `bad auto_id ${a.auto_id}`);
    assert(a.source_type.length > 0, `empty source_type for ${a.auto_id}`);
    assertEquals(a.ifs_domains.length, 1, `${a.auto_id} must tag exactly one sub-domain`);
    assert(SUBDOMAIN_RE.test(a.ifs_domains[0]), `${a.auto_id} tag ${a.ifs_domains[0]} not D#.#`);
    assert(a.queries.length >= 2, `${a.auto_id} needs >=2 queries`);
  }
});

Deno.test("TIER1_ACTIVATION — covers the 10 dormant dedicated crawlers AUTO-060..069", () => {
  const ids = TIER1_ACTIVATION.map((a) => a.auto_id).sort();
  const expected = ["AUTO-060","AUTO-061","AUTO-062","AUTO-063","AUTO-064","AUTO-065","AUTO-066","AUTO-067","AUTO-068","AUTO-069"];
  assertEquals(ids, expected);
});

Deno.test("TIER2_ACTIVATION — every def is well-formed and tags exactly one D11–D23 sub-domain", () => {
  for (const a of TIER2_ACTIVATION) {
    assert(/^AUTO-(0[7-9]\d|1[01]\d)$/.test(a.auto_id), `bad auto_id ${a.auto_id}`);
    assert(a.source_type.length > 0, `empty source_type for ${a.auto_id}`);
    assertEquals(a.ifs_domains.length, 1, `${a.auto_id} must tag exactly one sub-domain`);
    assert(SUBDOMAIN_RE.test(a.ifs_domains[0]), `${a.auto_id} tag ${a.ifs_domains[0]} not D#.#`);
    assert(a.queries.length >= 2, `${a.auto_id} needs >=2 queries`);
  }
});

Deno.test("TIER2_ACTIVATION — covers exactly the D11–D23 crawlers AUTO-070..119", () => {
  const ids = TIER2_ACTIVATION.map((a) => a.auto_id).sort();
  const expected = Array.from({ length: 50 }, (_, i) => `AUTO-${70 + i}`).sort();
  assertEquals(ids, expected, "must be the contiguous block AUTO-070..119");
});

Deno.test("TIER2_ACTIVATION — AUTO-118→D17.2, AUTO-119→D17.1 (bare D17 tag fixed)", () => {
  const by = Object.fromEntries(TIER2_ACTIVATION.map((a) => [a.auto_id, a.ifs_domains[0]]));
  assertEquals(by["AUTO-118"], "D17.2");
  assertEquals(by["AUTO-119"], "D17.1");
});

Deno.test("Full fleet merge (TIER1+TIER2+D3+WAVE3) has no duplicate auto_id", () => {
  const merged = mergeApproved(
    mergeApproved(mergeApproved(TIER1_ACTIVATION, TIER2_ACTIVATION), D3_SUBDOMAIN_ACTIVATION),
    WAVE3_ACTIVATION,
  );
  assertEquals(new Set(merged.map((a) => a.auto_id)).size, merged.length);
  assertEquals(merged.length, 80, "10 Tier-1 + 50 Tier-2 + 5 D3 + 15 Wave-3");
});

// ─── D3 Grid & Regulatory sub-domain feeds (merged from main, PR #84) ──────────
Deno.test("D3_SUBDOMAIN_ACTIVATION — well-formed, one D3.X tag each, covers D3.1..D3.5", () => {
  for (const a of D3_SUBDOMAIN_ACTIVATION) {
    assert(a.source_type.length > 0, `empty source_type for ${a.auto_id}`);
    assertEquals(a.ifs_domains.length, 1, `${a.auto_id} must tag exactly one sub-domain`);
    assert(/^D3\.[1-5]$/.test(a.ifs_domains[0]), `${a.auto_id} tag ${a.ifs_domains[0]} not D3.1..D3.5`);
    assert(a.queries.length >= 4, `${a.auto_id} needs >=4 queries`);
  }
  const tags = D3_SUBDOMAIN_ACTIVATION.map((a) => a.ifs_domains[0]).sort();
  assertEquals(tags, ["D3.1","D3.2","D3.3","D3.4","D3.5"], "must cover exactly D3.1..D3.5");
});

Deno.test("D3_SUBDOMAIN_ACTIVATION — id→sub-domain mapping matches the approved plan", () => {
  const by = Object.fromEntries(D3_SUBDOMAIN_ACTIVATION.map((a) => [a.auto_id, a.ifs_domains[0]]));
  assertEquals(by["AUTO-164"], "D3.1");
  assertEquals(by["AUTO-176"], "D3.2");
  assertEquals(by["AUTO-177"], "D3.3");
  assertEquals(by["AUTO-165"], "D3.4");
  assertEquals(by["AUTO-166"], "D3.5");
});

Deno.test("D3_SUBDOMAIN_ACTIVATION — D3.3 (PUC) uses the state_puc_filing source_type", () => {
  const d33 = D3_SUBDOMAIN_ACTIVATION.find((a) => a.ifs_domains[0] === "D3.3");
  assertEquals(d33?.source_type, "state_puc_filing");
});

// ─── FAR-319 Wave 3: priority whitespace activation ────────────────────────────
Deno.test("WAVE3_ACTIVATION — every def is well-formed, one D#.# tag, ≥4 query-sources", () => {
  for (const a of WAVE3_ACTIVATION) {
    assert(/^AUTO-1(3[8-9]|4\d|5[0-2])$/.test(a.auto_id), `${a.auto_id} not in AUTO-138..152`);
    assert(a.source_type.length > 0, `empty source_type for ${a.auto_id}`);
    assertEquals(a.ifs_domains.length, 1, `${a.auto_id} must tag exactly one sub-domain`);
    assert(SUBDOMAIN_RE.test(a.ifs_domains[0]), `${a.auto_id} tag ${a.ifs_domains[0]} not D#.#`);
    assert(a.queries.length >= 4, `${a.auto_id} needs >=4 query-sources (Wave-3 bar)`);
  }
});

Deno.test("WAVE3_ACTIVATION — exactly the contiguous block AUTO-138..152 covering the priority 15", () => {
  const ids = WAVE3_ACTIVATION.map((a) => a.auto_id).sort();
  assertEquals(ids, Array.from({ length: 15 }, (_, i) => `AUTO-${138 + i}`).sort());
  const subs = WAVE3_ACTIVATION.map((a) => a.ifs_domains[0]).sort();
  assertEquals(subs, ["D10.1","D10.2","D10.3","D10.5","D4.5","D4.6","D6.3","D7.1","D7.2","D7.3","D7.4","D9.1","D9.2","D9.3","D9.4"].sort());
});

Deno.test("WHITESPACE_SCAFFOLDS — well-formed; placeholder:true ONLY on the proposed AUTO-179..182 ids", () => {
  for (const s of WHITESPACE_SCAFFOLDS) {
    const proposed = /^AUTO-1(79|8[0-2])$/.test(s.auto_id);
    assertEquals(s.placeholder, proposed,
      `${s.auto_id}: placeholder must be true iff the id is a proposed (ungranted) AUTO-179..182 id`);
    assert(/^AUTO-1(3[7-9]|[4-6]\d|7[0-5]|79|8[0-2])$/.test(s.auto_id), `${s.auto_id} outside block + proposed range`);
    assert(SUBDOMAIN_RE.test(s.subdomain), `bad subdomain ${s.subdomain}`);
    assertEquals(s.ifs_domains[0], s.subdomain, `${s.auto_id} ifs_domains must equal its subdomain`);
    assert(s.cadence.length > 0 && s.postgres_insert.length > 0, `${s.auto_id} missing cadence/insert contract`);
    assert(["crawler","primary_source","cowork","claude_routine"].includes(s.mechanism), `bad mechanism ${s.mechanism}`);
  }
});

Deno.test("WHITESPACE_SCAFFOLDS — post-D3-reconciliation layout: AUTO-137 + 153..163 + 167..175 + proposed 179..182", () => {
  const ids = WHITESPACE_SCAFFOLDS.map((s) => s.auto_id).sort();
  assertEquals(new Set(ids).size, ids.length, "duplicate id");
  assertEquals(ids.length, 25, "expected 25 scaffolds (39 - 15 graduated + D18.1)");
  const expected = [
    "AUTO-137",
    ...Array.from({ length: 11 }, (_, i) => `AUTO-${153 + i}`), // 153..163
    ...Array.from({ length: 9 }, (_, i) => `AUTO-${167 + i}`),  // 167..175
    ...Array.from({ length: 4 }, (_, i) => `AUTO-${179 + i}`),  // proposed 179..182
  ].sort();
  assertEquals(ids, expected, "164/165/166/176/177 belong to the D3 feeds; 178 is the crawl healthcheck");
});

Deno.test("Block invariants — AUTO-137 = D18.1; D8.2 pinned to AUTO-168; no overlap with Wave-3 or D3 ids", () => {
  const byId = Object.fromEntries(WHITESPACE_SCAFFOLDS.map((s) => [s.auto_id, s.subdomain]));
  assertEquals(byId["AUTO-137"], "D18.1", "Myke 2026-07-05: Opposition Tracker is the first ID of the block");
  assertEquals(byId["AUTO-168"], "D8.2", "Industry Conferences annotations reference AUTO-168");
  const wave3Subs = new Set(WAVE3_ACTIVATION.map((a) => a.ifs_domains[0]));
  const activeIds = new Set([...WAVE3_ACTIVATION, ...D3_SUBDOMAIN_ACTIVATION].map((a) => a.auto_id));
  for (const s of WHITESPACE_SCAFFOLDS) {
    assert(!wave3Subs.has(s.subdomain), `${s.subdomain} is both scaffolded and Wave-3 activated`);
    assert(!activeIds.has(s.auto_id), `${s.auto_id} claimed by both a scaffold and an active crawler`);
  }
});

Deno.test("WHITESPACE_SCAFFOLDS — each scaffolded sub-domain is unique (no two routines own the same thread)", () => {
  const subs = WHITESPACE_SCAFFOLDS.map((s) => s.subdomain);
  assertEquals(new Set(subs).size, subs.length, "two routines target the same sub-domain");
});

Deno.test("Cadences are staggered — no two routines share an exact cadence slot", () => {
  const slots = WHITESPACE_SCAFFOLDS.map((s) => s.cadence);
  assertEquals(new Set(slots).size, slots.length, "two routines stacked on the same cadence window (§5 stagger)");
});

Deno.test("SOURCE_FIT_REPOINTS — well-formed and includes the five primary-source targets", () => {
  const subs = SOURCE_FIT_REPOINTS.map((r) => r.subdomain);
  for (const expect of ["D2.5","D3.4","D3.5","D1.8","D7.4"]) assert(subs.includes(expect), `missing re-point ${expect}`);
});

Deno.test("mergeApproved — appends approved defs", () => {
  const base = [{ auto_id: "AUTO-001", source_type: "web_news", ifs_domains: ["D1"], queries: ["q"] }];
  const merged = mergeApproved(base, [TIER1_ACTIVATION[0]]);
  assertEquals(merged.length, 2);
  assertEquals(merged[1].auto_id, "AUTO-060");
});

Deno.test("mergeApproved — is replay-safe / throws on duplicate auto_id (idempotency guard)", () => {
  const base = [TIER1_ACTIVATION[0]]; // AUTO-060 already present
  assertThrows(() => mergeApproved(base, [TIER1_ACTIVATION[0]]), Error, "duplicate auto_id AUTO-060");
});
