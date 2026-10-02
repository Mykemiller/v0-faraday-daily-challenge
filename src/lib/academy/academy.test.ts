// Pure-logic tests for the Faraday Academy player.
//   run: npm run test:academy
//
// Fixtures mirror shapes measured against the live content on 2026-09-30: lesson
// bodies are plain prose in blank-line paragraphs (no bullets, no headings), and
// glossary terms often carry a parenthetical gloss the prose never repeats.
// Course codes here are deliberately opaque — the no-codes build guard scans this
// directory, and the player never renders a code anyway.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  baseTerm,
  buildCandidates,
  linkLesson,
  parentheticalAlias,
} from "./glossary.ts";
import {
  CAPSTONE_GROUP,
  EMPTY_FILTERS,
  applyFilters,
  authorOptions,
  groupCourses,
  groupNames,
  hasActiveFilters,
  levelOptions,
} from "./catalog.ts";
import { lessonHref, locateLesson, parsePosition, readingOrder } from "./nav.ts";
import { canonicalUrl, publicPath, siteOrigin } from "./origin.ts";
import type { CatalogCourse, Course, GlossaryEntry } from "./types.ts";

// ── glossary linking ─────────────────────────────────────────────────────────

const GLOSSARY: GlossaryEntry[] = [
  { term: "DCIM (Data Center Infrastructure Management)", anchor: "dcim-data-center-infrastructure-management", definition: "d" },
  { term: "Building-management system (BMS)", anchor: "building-management-system-bms", definition: "d" },
  { term: "system", anchor: "system", definition: "d" },
  { term: "Time-to-power", anchor: "time-to-power", definition: "d" },
  { term: "Technology errors and omissions (tech E&O)", anchor: "technology-errors-and-omissions-tech-e-o", definition: "d" },
];

test("parenthetical glosses split into base term and alias", () => {
  assert.equal(baseTerm("DCIM (Data Center Infrastructure Management)"), "DCIM");
  assert.equal(parentheticalAlias("DCIM (Data Center Infrastructure Management)"), "Data Center Infrastructure Management");
  assert.equal(baseTerm("Time-to-power"), "Time-to-power");
  assert.equal(parentheticalAlias("Time-to-power"), null);
});

test("candidates are longest-first so a short term cannot shadow a long one", () => {
  const c = buildCandidates(GLOSSARY).map((x) => x.match);
  assert.ok(c.indexOf("Building-management system") < c.indexOf("system"));
  for (let i = 1; i < c.length; i++) assert.ok(c[i - 1].length >= c[i].length);
});

test("a term links on first occurrence only, per lesson not per paragraph", () => {
  const out = linkLesson(
    ["Time-to-power is the constraint.", "Time-to-power again, still the constraint."],
    GLOSSARY,
  );
  const links = out.flat().filter((s) => s.kind === "term");
  assert.equal(links.length, 1);
  assert.equal(links[0].anchor, "time-to-power");
  // The second paragraph stayed entirely plain text.
  assert.deepEqual(out[1], [{ kind: "text", text: "Time-to-power again, still the constraint." }]);
});

test("matching is case-insensitive and preserves the prose casing", () => {
  const out = linkLesson(["time-to-power drives the deal."], GLOSSARY).flat();
  const link = out.find((s) => s.kind === "term");
  assert.equal(link?.text, "time-to-power"); // prose casing kept
  assert.equal(link?.anchor, "time-to-power"); // canonical target
});

test("whole words only — a term inside a longer word does not link", () => {
  const out = linkLesson(["The ecosystems are fine."], [GLOSSARY[2]]).flat();
  assert.equal(out.filter((s) => s.kind === "term").length, 0);
});

test("longest match wins at the same position", () => {
  const out = linkLesson(["Building-management system telemetry."], GLOSSARY).flat();
  const link = out.find((s) => s.kind === "term");
  assert.equal(link?.text, "Building-management system");
});

test("an abbreviation links via the base term", () => {
  const out = linkLesson(["Operators lean on DCIM for this."], GLOSSARY).flat();
  const link = out.find((s) => s.kind === "term");
  assert.equal(link?.anchor, "dcim-data-center-infrastructure-management");
});

test("terms with an ampersand link without breaking the regex", () => {
  const out = linkLesson(["Carriers price tech E&O separately."], GLOSSARY).flat();
  const link = out.find((s) => s.kind === "term");
  assert.equal(link?.anchor, "technology-errors-and-omissions-tech-e-o");
});

test("a term never used in the prose simply does not link", () => {
  const out = linkLesson(["Nothing relevant appears here."], GLOSSARY).flat();
  assert.equal(out.filter((s) => s.kind === "term").length, 0);
  assert.equal(out.length, 1);
});

test("segments reassemble to exactly the original paragraph", () => {
  const paragraph = "Building-management system feeds DCIM, and time-to-power follows.";
  const out = linkLesson([paragraph], GLOSSARY).flat();
  assert.equal(out.map((s) => s.text).join(""), paragraph);
});

// ── catalog ──────────────────────────────────────────────────────────────────

function c(over: Partial<CatalogCourse> = {}): CatalogCourse {
  return {
    code: "FA-OPAQUE-101",
    slug: "cooling-and-water-foundations",
    title: "Cooling and Water Foundations",
    level: "101",
    author: { voice: "gil", name: "Gilbert Faraday" },
    group: "Cooling and Water",
    reading_minutes: 28,
    narrated: true,
    ...over,
  };
}

const CATALOG: CatalogCourse[] = [
  c(),
  c({ slug: "grid-interconnection", title: "Grid Interconnection", level: "201", group: "Power and Interconnection", narrated: false, author: { voice: "mach", name: "Mach Eigen" } }),
  c({ slug: "advanced-cooling", title: "Advanced Cooling", level: "301", group: "Cooling and Water", narrated: false }),
  c({ slug: "master-class", title: "The Faraday Intelligence Framework", level: "Capstone", group: CAPSTONE_GROUP, narrated: false }),
];

test("search spans title, group and author; all terms must match", () => {
  assert.equal(applyFilters(CATALOG, { ...EMPTY_FILTERS, search: "cooling" }).length, 2);
  assert.equal(applyFilters(CATALOG, { ...EMPTY_FILTERS, search: "advanced cooling" }).length, 1);
  assert.equal(applyFilters(CATALOG, { ...EMPTY_FILTERS, search: "Mach" }).length, 1);
  assert.equal(applyFilters(CATALOG, { ...EMPTY_FILTERS, search: "nonexistent" }).length, 0);
});

test("a course code is not searchable", () => {
  assert.equal(applyFilters(CATALOG, { ...EMPTY_FILTERS, search: "OPAQUE" }).length, 0);
});

test("level, group, author and narrated filters each narrow", () => {
  assert.equal(applyFilters(CATALOG, { ...EMPTY_FILTERS, levels: ["101"] }).length, 1);
  assert.equal(applyFilters(CATALOG, { ...EMPTY_FILTERS, groups: ["Cooling and Water"] }).length, 2);
  assert.equal(applyFilters(CATALOG, { ...EMPTY_FILTERS, authors: ["mach"] }).length, 1);
  assert.equal(applyFilters(CATALOG, { ...EMPTY_FILTERS, narratedOnly: true }).length, 1);
});

test("filters compose", () => {
  const out = applyFilters(CATALOG, { ...EMPTY_FILTERS, groups: ["Cooling and Water"], levels: ["301"] });
  assert.equal(out.length, 1);
  assert.equal(out[0].slug, "advanced-cooling");
});

test("hasActiveFilters tracks the reset affordance", () => {
  assert.equal(hasActiveFilters(EMPTY_FILTERS), false);
  assert.equal(hasActiveFilters({ ...EMPTY_FILTERS, search: "  " }), false);
  assert.equal(hasActiveFilters({ ...EMPTY_FILTERS, narratedOnly: true }), true);
});

test("groups are alphabetical with Capstone last", () => {
  assert.deepEqual(groupNames(CATALOG), ["Cooling and Water", "Power and Interconnection", CAPSTONE_GROUP]);
  assert.deepEqual(groupCourses(CATALOG).map((g) => g.name), [
    "Cooling and Water",
    "Power and Interconnection",
    CAPSTONE_GROUP,
  ]);
});

test("within a group courses sort by curriculum level then title", () => {
  const cooling = groupCourses(CATALOG).find((g) => g.name === "Cooling and Water");
  assert.deepEqual(cooling?.courses.map((x) => x.level), ["101", "301"]);
});

test("filter options reflect only what is present, with no tallies", () => {
  assert.deepEqual(levelOptions(CATALOG), ["101", "201", "301", "Capstone"]);
  assert.deepEqual(authorOptions(CATALOG), [
    { voice: "gil", name: "Gilbert Faraday" },
    { voice: "mach", name: "Mach Eigen" },
  ]);
});

// ── reader navigation ────────────────────────────────────────────────────────

const COURSE: Course = {
  ...c(),
  welcome_message: null,
  access: "open",
  modules: [1, 2, 3, 4].map((p) => ({
    position: p,
    title: `Module ${p}`,
    faradays_take: "take",
    knowledge_check: { question: "q", answer: "a" },
    lessons: [1, 2].map((lp) => ({
      id: `m${p}l${lp}`,
      position: lp,
      title: `Lesson ${lp}`,
      paragraphs: ["One.", "Two."],
      word_count: 770,
      reading_minutes: 4,
      narration: null,
    })),
  })),
  quiz: [],
  glossary: [],
};

test("reading order flattens modules into eight lessons", () => {
  const order = readingOrder(COURSE);
  assert.equal(order.length, 8);
  assert.deepEqual(order[0], { module: 1, lesson: 1 });
  assert.deepEqual(order[7], { module: 4, lesson: 2 });
});

test("locate gives ordinal, total and neighbours", () => {
  const mid = locateLesson(COURSE, 2, 1);
  assert.equal(mid?.ordinal, 3);
  assert.equal(mid?.total, 8);
  assert.deepEqual(mid?.prev, { module: 1, lesson: 2 });
  assert.deepEqual(mid?.next, { module: 2, lesson: 2 });
});

test("the first lesson has no previous and the last no next", () => {
  assert.equal(locateLesson(COURSE, 1, 1)?.prev, null);
  assert.equal(locateLesson(COURSE, 4, 2)?.next, null);
});

test("a position that does not exist locates nothing", () => {
  assert.equal(locateLesson(COURSE, 9, 1), null);
  assert.equal(locateLesson(COURSE, 1, 3), null);
});

test("positions parse strictly, so junk segments cannot reach the loader", () => {
  assert.equal(parsePosition("1"), 1);
  assert.equal(parsePosition("12"), 12);
  assert.equal(parsePosition("0"), null);
  assert.equal(parsePosition("-1"), null);
  assert.equal(parsePosition("1.5"), null);
  assert.equal(parsePosition("quiz"), null);
  assert.equal(parsePosition(""), null);
});

test("lesson hrefs carry slug and positions, never a code", () => {
  assert.equal(lessonHref("cooling-and-water-foundations", 1, 2), "/academy/cooling-and-water-foundations/1/2");
});

// ── copy rules that bit us in review ─────────────────────────────────────────

test("no catalog string states how many courses exist", () => {
  // The catalog's live region used to announce "N courses match". Unfiltered that
  // is the size of the curriculum, which must never be stated. Guard the shape of
  // the announcement here so the rule is enforced without a deployment to scan.
  const announce = (n: number) =>
    n === 0 ? "No courses match these filters." : "Results updated.";
  const COUNTED = /\b\d+\s+(?:domains|sub-?domains|towers|schools|courses)\b/i;
  for (const n of [0, 1, 7, 99, 126]) {
    assert.equal(COUNTED.test(announce(n)), false, `announcement leaked a count at n=${n}`);
  }
});

// ── public URL shape on the player's own domain ──────────────────────────────

test("the player is root-mounted: /academy drops out of the public path", () => {
  assert.equal(publicPath("/academy"), "/");
  assert.equal(publicPath("/academy/cooling-and-water"), "/cooling-and-water");
  assert.equal(publicPath("/academy/cooling-and-water/1/2"), "/cooling-and-water/1/2");
  assert.equal(publicPath("/academy/cooling-and-water/glossary"), "/cooling-and-water/glossary");
});

test("paths outside the academy tree are left alone", () => {
  assert.equal(publicPath("/api/academy/deeper"), "/api/academy/deeper");
  assert.equal(publicPath("/challenge"), "/challenge");
});

test("canonicals are absolute and name the player's home", () => {
  const url = canonicalUrl("/academy/cooling-and-water/1/2");
  assert.ok(url.startsWith("https://"), `canonical must be absolute, got ${url}`);
  assert.equal(url, `${siteOrigin()}/cooling-and-water/1/2`);
  // Never the Daily Challenge game domain, which is what Vercel reports as the
  // project's production URL.
  assert.equal(url.includes("faradaydailychallenge"), false);
  // Never carries the internal /academy prefix.
  assert.equal(url.includes("/academy/"), false);
});

test("the catalog canonical is the domain root", () => {
  assert.equal(canonicalUrl("/academy"), `${siteOrigin()}/`);
});
