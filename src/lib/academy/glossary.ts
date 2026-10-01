// Faraday Academy reader — glossary term linking.
//
// A glossary term links from the lesson text on its FIRST occurrence in that
// lesson, case-insensitive, whole words only. Later occurrences stay plain so a
// lesson does not turn into a field of links.
//
// Measured against the live content on 2026-09-30: 131 of 792 terms carry a
// parenthetical gloss — "DCIM (Data Center Infrastructure Management)",
// "N-minus-one (N-1)". The prose almost never repeats the parenthetical, so
// matching the full term alone linked 70% of terms (556/792). Matching the base
// term with the parenthetical stripped, plus the parenthetical itself as an
// alias, reaches 85% (676/792). The rest are defined but never used verbatim in
// the prose, and correctly stay unlinked.

import type { GlossaryEntry } from "./types";

export type TextSegment = { kind: "text"; text: string };
export type LinkSegment = { kind: "term"; text: string; anchor: string; term: string };
export type Segment = TextSegment | LinkSegment;

type Candidate = {
  /** The literal string to look for in the prose. */
  match: string;
  /** Anchor on the glossary page — always the slugified FULL term. */
  anchor: string;
  /** The canonical glossary term, for the link title. */
  term: string;
};

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** "DCIM (Data Center Infrastructure Management)" -> "DCIM" */
export function baseTerm(term: string): string {
  return term.replace(/\s*\([^)]*\)\s*$/, "").trim();
}

/** "N-minus-one (N-1)" -> "N-1"; no parenthetical -> null */
export function parentheticalAlias(term: string): string | null {
  const m = term.match(/\(([^)]*)\)\s*$/);
  const inner = m?.[1]?.trim();
  return inner && inner.length > 0 ? inner : null;
}

/**
 * Longest match first, so "building-management system" wins over "system" and a
 * term never gets shadowed by a shorter one nested inside it.
 */
export function buildCandidates(glossary: GlossaryEntry[]): Candidate[] {
  const out: Candidate[] = [];
  for (const g of glossary) {
    if (!g.term) continue;
    const seen = new Set<string>();
    const push = (match: string | null) => {
      if (!match) return;
      const key = match.toLowerCase();
      if (match.length < 2 || seen.has(key)) return;
      seen.add(key);
      out.push({ match, anchor: g.anchor, term: g.term });
    };
    push(baseTerm(g.term));
    push(parentheticalAlias(g.term));
  }
  return out.sort((a, b) => b.match.length - a.match.length);
}

// Whole-word boundaries via lookaround rather than \b, because terms legitimately
// end in non-word characters — "tech E&O" — where \b would sit in the wrong place.
function wholeWordRegExp(match: string): RegExp {
  return new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(match)}(?![A-Za-z0-9])`, "i");
}

/**
 * Splits one lesson's paragraphs into renderable segments, linking each term at
 * most once across the whole lesson.
 *
 * `linked` is carried across paragraphs by the caller so "first occurrence per
 * lesson" means per lesson, not per paragraph.
 */
export function linkParagraph(
  paragraph: string,
  candidates: Candidate[],
  linked: Set<string>,
): Segment[] {
  // Find the earliest unlinked candidate match in this paragraph, link it, then
  // recurse on the remaining tail. Candidates are longest-first, so at equal
  // position the longer term wins.
  let best: { index: number; length: number; c: Candidate } | null = null;
  for (const c of candidates) {
    if (linked.has(c.anchor)) continue;
    const m = wholeWordRegExp(c.match).exec(paragraph);
    if (!m) continue;
    if (
      best === null ||
      m.index < best.index ||
      (m.index === best.index && m[0].length > best.length)
    ) {
      best = { index: m.index, length: m[0].length, c };
    }
  }

  if (!best) return paragraph ? [{ kind: "text", text: paragraph }] : [];

  linked.add(best.c.anchor);
  const before = paragraph.slice(0, best.index);
  const hit = paragraph.slice(best.index, best.index + best.length);
  const after = paragraph.slice(best.index + best.length);

  const segments: Segment[] = [];
  if (before) segments.push({ kind: "text", text: before });
  // The matched casing from the prose is preserved; only the link target is canonical.
  segments.push({ kind: "term", text: hit, anchor: best.c.anchor, term: best.c.term });
  return segments.concat(linkParagraph(after, candidates, linked));
}

/** Links a whole lesson. Returns one segment list per paragraph. */
export function linkLesson(paragraphs: string[], glossary: GlossaryEntry[]): Segment[][] {
  const candidates = buildCandidates(glossary);
  const linked = new Set<string>();
  return paragraphs.map((p) => linkParagraph(p, candidates, linked));
}
