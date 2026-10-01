// Faraday Academy — server-side checks on model output.
//
// The system prompt states the rules; this file assumes the model will sometimes
// break them anyway. Nothing reaches a reader until it has been through here.
//
// Order matters. Source verification runs first (an unverifiable source takes its
// claim with it), then cite coverage, then assets, then the copy guard — because a
// rewrite triggered by the copy guard should be judged against text that has
// already had unsupported claims stripped.

export type Source = {
  title: string;
  url: string;
  publisher?: string;
  published_on?: string;
};

export type Paragraph = { text: string; cites: number[] };

export type Diagram = { mermaid: string; caption?: string; cites: number[] };

export type Chart = {
  spec: Record<string, unknown>;
  caption?: string;
  data_cites: number[];
};

export type ModelAnswer = {
  kind: "answer" | "refusal";
  refusal_reason?: string;
  paragraphs?: Paragraph[];
  sources?: Source[];
  diagram?: Diagram;
  chart?: Chart;
};

export type GuardNote = string;

export type GuardResult = {
  answer: ModelAnswer;
  notes: GuardNote[];
  /** True when the copy guard found something a rewrite must fix. */
  needsRewrite: boolean;
  /** True when nothing usable survived. */
  refuse: boolean;
};

// ── copy guard patterns ──────────────────────────────────────────────────────

// Domain, sub-domain and tower codes. Same shape the player's validator uses.
const CODE_PATTERNS: RegExp[] = [
  /\bD\d{1,2}(?:\.\d+)?\b/,
  /\bT-?\d{3}\b/,
];

// "23 domains", "ninety-nine courses", "116 sub-domains" — any count of the
// curriculum's own structure. The rule is never to state how many exist.
const COUNT_WORD = "(?:\\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|dozens|hundreds|thousands|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|[a-z]+-?(?:teen|ty))";
const COUNTED_NOUN = "(?:domains|sub-?domains|towers|schools|courses)";
const COUNT_PATTERNS: RegExp[] = [
  new RegExp(`\\b${COUNT_WORD}\\s+(?:active\\s+|total\\s+|distinct\\s+|different\\s+)?${COUNTED_NOUN}\\b`, "i"),
  new RegExp(`\\b${COUNTED_NOUN}\\b[^.]{0,20}\\bnumber(?:s|ing)?\\s+${COUNT_WORD}`, "i"),
  new RegExp(`\\b(?:all|every|each)\\s+${COUNT_WORD}\\s+${COUNTED_NOUN}\\b`, "i"),
];

// A price figure of any shape. During beta none may appear; the request-time
// commercial facts tell the model so, and this is the backstop.
const PRICE_PATTERNS: RegExp[] = [
  /\$\s?\d/,
  /\b\d+(?:\.\d{2})?\s*(?:dollars|usd)\b/i,
  /\b(?:costs?|priced at|price of|pay)\s+\$?\d/i,
];

// The banned list, verbatim from the prompt, plus the near-synonym hype it names.
const BANNED_PHRASES: string[] = [
  "empowering",
  "empower",
  "leveraging",
  "leverage",
  "unlocking potential",
  "unlock your potential",
  "cutting-edge",
  "cutting edge",
  "best-in-class",
  "best in class",
  "revolutionary",
  "revolutionize",
  "in today's fast-paced world",
  "in todays fast-paced world",
  "great question!",
  "i hope that helps",
  "we're excited to announce",
  "were excited to announce",
  "faraday's methodology",
  "faradays methodology",
  "our approach",
  "the faraday framework",
  // Near-synonym hype.
  "game-changing",
  "game changer",
  "paradigm shift",
  "state-of-the-art",
  "world-class",
  "next-generation",
  "seamlessly",
  "synergy",
  "supercharge",
  "turnkey solution",
  "robust solution",
  "transformative",
];

export type CopyViolation = { kind: string; detail: string; where: string };

/** Scans one string for every copy rule. `allowPrices` is false during beta. */
export function scanCopy(text: string, where: string, allowPrices: boolean): CopyViolation[] {
  const out: CopyViolation[] = [];
  if (!text) return out;

  for (const re of CODE_PATTERNS) {
    const m = text.match(re);
    if (m) out.push({ kind: "taxonomy_code", detail: m[0], where });
  }
  for (const re of COUNT_PATTERNS) {
    const m = text.match(re);
    if (m) out.push({ kind: "curriculum_count", detail: m[0].trim(), where });
  }
  if (!allowPrices) {
    for (const re of PRICE_PATTERNS) {
      const m = text.match(re);
      if (m) out.push({ kind: "price", detail: m[0].trim(), where });
    }
  }
  const lower = text.toLowerCase();
  for (const phrase of BANNED_PHRASES) {
    if (lower.includes(phrase)) out.push({ kind: "banned_phrase", detail: phrase, where });
  }
  return out;
}

// ── source verification ──────────────────────────────────────────────────────

/** Normalizes for comparison: scheme and trailing slash are not identity. */
export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url.trim());
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    const path = u.pathname.replace(/\/+$/, "");
    return `${host}${path}`;
  } catch {
    return url.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "");
  }
}

/**
 * A source survives only if this call's web search actually returned it. A model
 * that recalls a plausible URL from training is the exact failure this prevents.
 *
 * Returns the kept sources plus a remap from old 1-based index to new 1-based
 * index, so citations can be renumbered rather than silently pointing elsewhere.
 */
export function verifySources(
  sources: Source[],
  searchResultUrls: string[],
): { kept: Source[]; remap: Map<number, number>; dropped: Source[] } {
  const allowed = new Set(searchResultUrls.map(normalizeUrl));
  const kept: Source[] = [];
  const dropped: Source[] = [];
  const remap = new Map<number, number>();

  sources.forEach((s, i) => {
    const oneBased = i + 1;
    if (s.url && allowed.has(normalizeUrl(s.url))) {
      kept.push(s);
      remap.set(oneBased, kept.length);
    } else {
      dropped.push(s);
    }
  });

  return { kept, remap, dropped };
}

// ── cite coverage ────────────────────────────────────────────────────────────

const NUMBER_RE = /\b\d/;
const DATE_RE = /\b(?:19|20)\d{2}\b|\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\b/i;
const QUOTE_RE = /["“”]/;
// Organization-ish: a legal suffix, or a government/standards body word, or two
// or more consecutive capitalized words (Duke Energy, Federal Register).
const ORG_RE =
  /\b(?:Inc\.?|Corp\.?|LLC|L\.L\.C\.|plc|GmbH|Ltd\.?|Commission|Department|Agency|Administration|Institute|Authority|Bureau|Council|Association|Consortium|Ministry)\b|\b[A-Z][a-z]+\s+[A-Z][a-z]+\b/;

/** True when a paragraph makes the kind of claim that must carry a citation. */
export function needsCite(text: string): boolean {
  return NUMBER_RE.test(text) || DATE_RE.test(text) || QUOTE_RE.test(text) || ORG_RE.test(text);
}

// ── asset validation ─────────────────────────────────────────────────────────

const MERMAID_HEADS = [
  "graph", "flowchart", "sequenceDiagram", "classDiagram", "stateDiagram",
  "stateDiagram-v2", "erDiagram", "journey", "gantt", "pie", "quadrantChart",
  "mindmap", "timeline", "gitGraph", "block-beta", "sankey-beta", "xychart-beta",
];

/**
 * A structural check, not a full Mermaid parse — there is no Mermaid runtime in
 * the function. It catches the failures that actually occur (missing or unknown
 * diagram header, unbalanced brackets, stray fences). The browser renderer is the
 * final gate and drops the diagram on a render error, keeping the text.
 */
export function mermaidLooksValid(src: string): boolean {
  if (!src || !src.trim()) return false;
  const text = src.trim();
  if (text.includes("```")) return false;

  const firstLine = text.split("\n")[0].trim();
  const head = firstLine.split(/[\s:]/)[0];
  if (!MERMAID_HEADS.includes(head)) return false;
  if (text.split("\n").filter((l) => l.trim().length > 0).length < 2) return false;

  const pairs: Array<[string, string]> = [["(", ")"], ["[", "]"], ["{", "}"]];
  for (const [open, close] of pairs) {
    let depth = 0;
    for (const ch of text) {
      if (ch === open) depth++;
      else if (ch === close) depth--;
      if (depth < 0) return false;
    }
    if (depth !== 0) return false;
  }
  return true;
}

/** Collects the data rows a Vega-Lite spec carries inline. */
export function inlineChartData(spec: Record<string, unknown>): unknown[] | null {
  const data = spec?.["data"] as Record<string, unknown> | undefined;
  if (!data || typeof data !== "object") return null;
  const values = data["values"];
  return Array.isArray(values) ? values : null;
}

// ── the pipeline ─────────────────────────────────────────────────────────────

export function applyGuards(
  raw: ModelAnswer,
  searchResultUrls: string[],
  opts: { allowPrices: boolean },
): GuardResult {
  const notes: GuardNote[] = [];

  if (raw.kind === "refusal") {
    return { answer: { kind: "refusal", refusal_reason: raw.refusal_reason }, notes, needsRewrite: false, refuse: true };
  }

  // 1 · sources must have come from this call's search results.
  const { kept, remap, dropped } = verifySources(raw.sources ?? [], searchResultUrls);
  if (dropped.length > 0) {
    notes.push(
      `${dropped.length} source${dropped.length === 1 ? "" : "s"} could not be verified against this search and were removed with the claims resting on them.`,
    );
  }

  // 2 · renumber cites onto the surviving sources; a paragraph that loses every
  // cite it had goes with them, because its support is gone.
  const paragraphs: Paragraph[] = [];
  let droppedParagraphs = 0;
  for (const p of raw.paragraphs ?? []) {
    const original = Array.isArray(p.cites) ? p.cites : [];
    const mapped = original.map((c) => remap.get(c)).filter((c): c is number => typeof c === "number");
    const hadCites = original.length > 0;

    if (hadCites && mapped.length === 0) {
      droppedParagraphs++;
      continue;
    }
    if (!hadCites && needsCite(p.text)) {
      // An uncited factual claim is exactly what we refuse to print.
      droppedParagraphs++;
      continue;
    }
    paragraphs.push({ text: p.text, cites: mapped });
  }
  if (droppedParagraphs > 0) {
    notes.push(
      `${droppedParagraphs} paragraph${droppedParagraphs === 1 ? "" : "s"} were removed for lacking a usable citation.`,
    );
  }

  // 3 · diagram: Mermaid must look parseable, else drop it and keep the text.
  let diagram = raw.diagram;
  if (diagram) {
    if (!mermaidLooksValid(diagram.mermaid)) {
      notes.push("A diagram was dropped because its Mermaid source did not parse. The text above is unaffected.");
      diagram = undefined;
    } else {
      const mapped = (diagram.cites ?? []).map((c) => remap.get(c)).filter((c): c is number => typeof c === "number");
      diagram = { ...diagram, cites: mapped };
    }
  }

  // 4 · chart: every datum must carry a cite, or the chart goes with a note.
  let chart = raw.chart;
  if (chart) {
    const mapped = (chart.data_cites ?? []).map((c) => remap.get(c)).filter((c): c is number => typeof c === "number");
    const values = inlineChartData(chart.spec ?? {});
    if (mapped.length === 0) {
      notes.push("A chart was dropped because its data carried no verified source.");
      chart = undefined;
    } else if (values !== null && values.length > 0 && mapped.length < 1) {
      notes.push("A chart was dropped because its data carried no verified source.");
      chart = undefined;
    } else {
      chart = { ...chart, data_cites: mapped };
    }
  }

  // 5 · copy guard over everything a reader will see.
  const violations: CopyViolation[] = [];
  paragraphs.forEach((p, i) => violations.push(...scanCopy(p.text, `paragraph ${i + 1}`, opts.allowPrices)));
  if (diagram) {
    violations.push(...scanCopy(diagram.mermaid, "diagram", opts.allowPrices));
    if (diagram.caption) violations.push(...scanCopy(diagram.caption, "diagram caption", opts.allowPrices));
  }
  if (chart) {
    violations.push(...scanCopy(JSON.stringify(chart.spec ?? {}), "chart spec", opts.allowPrices));
    if (chart.caption) violations.push(...scanCopy(chart.caption, "chart caption", opts.allowPrices));
  }
  for (const s of kept) {
    // A source TITLE may legitimately contain a price or a number; only scan it
    // for taxonomy codes, which must never appear anywhere.
    for (const re of CODE_PATTERNS) {
      const m = s.title?.match(re);
      if (m) violations.push({ kind: "taxonomy_code", detail: m[0], where: "source title" });
    }
  }

  const answer: ModelAnswer = { kind: "answer", paragraphs, sources: kept };
  if (diagram) answer.diagram = diagram;
  if (chart) answer.chart = chart;

  // Nothing left to show is a refusal, not an empty panel.
  const empty = paragraphs.length === 0 && !diagram && !chart;

  return {
    answer,
    notes,
    needsRewrite: violations.length > 0,
    refuse: empty,
  };
}

/** Human-readable instruction for the single rewrite attempt. */
export function rewriteInstruction(violations: CopyViolation[]): string {
  const byKind = new Map<string, string[]>();
  for (const v of violations) {
    const arr = byKind.get(v.kind) ?? [];
    arr.push(`${v.detail} (${v.where})`);
    byKind.set(v.kind, arr);
  }
  const lines: string[] = [
    "Your previous answer broke the output rules. Rewrite it, keeping the same facts and the same sources.",
  ];
  for (const [kind, items] of byKind) {
    const unique = [...new Set(items)].slice(0, 8);
    switch (kind) {
      case "taxonomy_code":
        lines.push(`Remove these taxonomy codes and use plain domain names instead: ${unique.join("; ")}.`);
        break;
      case "curriculum_count":
        lines.push(`Remove these statements of how much curriculum exists: ${unique.join("; ")}.`);
        break;
      case "price":
        lines.push(`Remove these price figures. Courses are free during the beta: ${unique.join("; ")}.`);
        break;
      case "banned_phrase":
        lines.push(`Remove this banned wording and say the plain thing instead: ${unique.join("; ")}.`);
        break;
    }
  }
  return lines.join("\n");
}
