// Unit tests for the IDF 4.0 coverage-bridge scaffold (FAR IDF-4).
// Run with: deno test supabase/functions/faraday-crawl/coverage-bridge.test.ts
import { assert, assertEquals, assertThrows } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { TIER1_ACTIVATION, TIER2_ACTIVATION, WHITESPACE_SCAFFOLDS, SOURCE_FIT_REPOINTS, mergeApproved } from "./coverage-bridge.ts";

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

Deno.test("Full fleet merge (BASE+TIER1+TIER2) has no duplicate auto_id", () => {
  const merged = mergeApproved(mergeApproved(TIER1_ACTIVATION, TIER2_ACTIVATION), []);
  assertEquals(new Set(merged.map((a) => a.auto_id)).size, merged.length);
  assertEquals(merged.length, 60, "10 Tier-1 + 50 Tier-2");
});

Deno.test("WHITESPACE_SCAFFOLDS — carry the granted block AUTO-137..175 (no placeholders left)", () => {
  for (const s of WHITESPACE_SCAFFOLDS) {
    assert(s.placeholder === false, `${s.auto_id} should no longer be a placeholder`);
    assert(/^AUTO-1(3[7-9]|[4-6]\d|7[0-5])$/.test(s.auto_id), `${s.auto_id} not in granted block AUTO-137..175`);
    assert(SUBDOMAIN_RE.test(s.subdomain), `bad subdomain ${s.subdomain}`);
    assertEquals(s.ifs_domains[0], s.subdomain, `${s.auto_id} ifs_domains must equal its subdomain`);
    assert(s.cadence.length > 0 && s.postgres_insert.length > 0, `${s.auto_id} missing cadence/insert contract`);
    assert(["crawler","primary_source","cowork","claude_routine"].includes(s.mechanism), `bad mechanism ${s.mechanism}`);
  }
});

Deno.test("WHITESPACE_SCAFFOLDS — ids are unique and exactly AUTO-137..175", () => {
  const ids = WHITESPACE_SCAFFOLDS.map((s) => s.auto_id).sort();
  assertEquals(new Set(ids).size, ids.length, "duplicate id");
  assertEquals(ids.length, 39, "expected 39 scaffolds");
  const expected = Array.from({ length: 39 }, (_, i) => `AUTO-${137 + i}`).sort();
  assertEquals(ids, expected, "ids must be the contiguous block AUTO-137..175");
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
