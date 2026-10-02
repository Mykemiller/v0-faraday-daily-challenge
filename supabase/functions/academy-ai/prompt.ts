// Faraday Academy — the academy-ai system prompt.
//
// The block below is held VERBATIM from the build spec. Do not reword it: the
// voice rules, the sourcing bar, the code prohibitions and the banned-phrase list
// are the contract, and the server-side guards in guards.ts check the model's
// output against these same rules. If you change one, change both.

export const SYSTEM_PROMPT = `You write supplementary material for a Faraday Academy lesson. It sits beside
the course text and is labeled as AI material. It is never course text.
VOICE: match the course author.
- Gil: empiricist. Warm, measured. Start from a named data point and reason outward.
- Mach: theorist. Precise, fast, structural, declarative.
Adapt depth to the reader's persona. Never gate or withhold on persona.
SOURCES: use web search. Every factual claim carries a numbered citation to a
named, linkable source: a filing, standard, statute, government program,
company release or dated report. If sources cannot support a claim, say so
plainly and leave it out. Never invent statistics, quotes, or "experts
predict". If nothing reliable supports an answer, return kind "refusal".
DIAGRAMS: Mermaid text only, citing what the structure rests on.
CHARTS: a Vega-Lite spec whose every data point cites a source. No sourced
data, no chart.
NEVER WRITE: domain, sub-domain or tower codes (D1, D2.1, T-001); use plain
domain names. Never state how many domains, sub-domains, towers, schools or
courses exist. Never promise specific future courses.
Banned: empowering, leveraging, unlocking potential, cutting-edge,
best-in-class, revolutionary, "in today's fast-paced world", "Great
question!", "I hope that helps!", "We're excited to announce", "Faraday's
methodology", "our approach", "the Faraday framework", and near-synonym hype.
COMMERCIAL FACTS, only if asked: {{commercial_facts}}
PROPOSE MODE (editors): output a proposal, never an edit. Text proposed into
lesson bodies or takes must be narration-ready: full sentences, no tables,
URLs, slashes or bullet fragments. References, diagrams and charts go in
sources and asset_spec, beside the text.`;

export type CommercialRules = {
  beta_mode: boolean;
  free_layer_enabled: boolean;
  price_101_usd: number | null;
  price_advanced_usd: number | null;
  certification_price_usd: number | null;
  certification_token_grant: number | null;
  tiers_enabled: boolean;
};

/**
 * Filled at request time from academy_commercial_rules. During beta the model is
 * told there are no prices to quote at all, which is what keeps a price out of
 * the answer even when a reader asks directly.
 */
export function commercialFacts(rules: CommercialRules): string {
  if (rules.beta_mode) {
    return "Faraday Academy is in beta. Courses and certification are free during the beta. Do not quote any price.";
  }
  const parts = [
    `Introductory courses are $${rules.price_101_usd ?? "unset"}.`,
    `Advanced courses are $${rules.price_advanced_usd ?? "unset"}.`,
    `Certification is $${rules.certification_price_usd ?? "unset"} and includes a grant of ${rules.certification_token_grant ?? "unset"} tokens.`,
    "There are no tiers.",
    `The free layer is ${rules.free_layer_enabled ? "enabled" : "disabled"}.`,
  ];
  return parts.join(" ");
}

export function buildSystemPrompt(rules: CommercialRules): string {
  return SYSTEM_PROMPT.replace("{{commercial_facts}}", commercialFacts(rules));
}

/** The five chips the panel offers, plus a free-text question. */
export const CHIPS = [
  "Explain this simply",
  "Show me a diagram",
  "Chart the numbers",
  "What's the latest?",
  "Find primary sources",
] as const;

export const MAX_SELECTION_CHARS = 1200;
export const MAX_QUESTION_CHARS = 500;

/** The structured shape the model must return. Enforced by output_config.format. */
export const RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["kind"],
  properties: {
    kind: {
      type: "string",
      enum: ["answer", "refusal"],
      description: "Use refusal when no reliable source supports an answer.",
    },
    refusal_reason: {
      type: "string",
      description: "Present only when kind is refusal. One plain sentence.",
    },
    paragraphs: {
      type: "array",
      description: "The answer in narration-ready prose. Each paragraph lists the source numbers it rests on.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "cites"],
        properties: {
          text: { type: "string" },
          cites: {
            type: "array",
            description: "1-based indexes into sources. Required for any paragraph carrying a number, date, quote or named organization.",
            items: { type: "integer" },
          },
        },
      },
    },
    sources: {
      type: "array",
      description: "Named, linkable sources actually consulted via web search.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "url"],
        properties: {
          title: { type: "string" },
          url: { type: "string" },
          publisher: { type: "string" },
          published_on: { type: "string", description: "ISO date when the source states one." },
        },
      },
    },
    diagram: {
      type: "object",
      additionalProperties: false,
      required: ["mermaid", "cites"],
      description: "Mermaid source only. Omit entirely when there is nothing to draw.",
      properties: {
        mermaid: { type: "string" },
        caption: { type: "string" },
        cites: { type: "array", items: { type: "integer" } },
      },
    },
    chart: {
      type: "object",
      additionalProperties: false,
      required: ["spec", "data_cites"],
      description: "A Vega-Lite spec. Every datum carries a source, or omit the chart.",
      properties: {
        // A JSON STRING, not an object. Structured outputs reject
        // `additionalProperties: true`, and a Vega-Lite spec is arbitrary JSON
        // that cannot be described with `false`. The server parses it; an
        // unparseable spec drops the chart, exactly as unparseable Mermaid drops
        // the diagram.
        spec: {
          type: "string",
          description: "A complete Vega-Lite specification, serialised as JSON text.",
        },
        caption: { type: "string" },
        data_cites: { type: "array", items: { type: "integer" } },
      },
    },
  },
} as const;
