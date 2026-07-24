// FAR-287 — per-game-type prompt templates. One template per type, carrying the
// Phase-0 JSON schema, a verbatim exemplar, the day's full theme tuple + Thread
// scope, the assigned subject, difficulty, the hint-escalation spec, and the
// count-agnostic + public-label copy rules. Batches 8-12 items of ONE type per call.

// Compact schema description + one real exemplar per type (from docs/puzzle-schemas.md).
const SPEC = {
  Rackl: {
    schema: `{"name":str,"domain":str,"groups":[EXACTLY 4 groups, each {"label":str,"color":"#hex","textColor":"#hex","items":[EXACTLY 4 short strings]}]}. 16 items total, all distinct, each unambiguously in exactly one group.`,
    ex: `{"name":"Grid & Interconnect","domain":"Grid & Regulatory","groups":[{"label":"ISO/RTOs","color":"#1C3424","textColor":"#EEE6DA","items":["PJM","ERCOT","MISO","CAISO"]},{"label":"FERC Actions","color":"#C4922A","textColor":"#141210","items":["Order 2023","Tariff filing","Rate case","Order 1920"]},{"label":"Capacity Terms","color":"#2A5A3A","textColor":"#EEE6DA","items":["Capacity market","Demand","Peak load","Reserve margin"]},{"label":"Reliability","color":"#5A4010","textColor":"#EEE6DA","items":["NERC","Contingency","Frequency","Black start"]}]}`,
    palette: `Use these 4 colors in order: #1C3424/#EEE6DA, #C4922A/#141210, #2A5A3A/#EEE6DA, #5A4010/#EEE6DA.`,
  },
  "Signal Drop": {
    schema: `{"name":str (=word),"domain":str,"word":UPPERCASE single A-Z token 4-9 letters (THE ANSWER),"clue":str,"hint1":str,"hint2":str}. The word must be a real term from the day's Thread scope.`,
    ex: `{"name":"SUBSTATION","domain":"Power Architecture","word":"SUBSTATION","clue":"A facility that transforms transmission voltage down to usable distribution levels","hint1":"Where high voltage steps down","hint2":"Proximity speeds interconnection"}`,
    palette: "",
  },
  "The Stack": {
    schema: `{"name":str,"domain":str,"items":[4 strings, ALREADY in correct rank order],"correctOrder":[0,1,2,3],"metric":str (what is ranked + direction),"values":[4 strings aligned to items]}. Ranking MUST be a real, verifiable, total order.`,
    ex: `{"name":"Rank voltage classes by level","domain":"Power & Electrical","items":["Rack PDU","Busway","Medium-voltage","Transmission"],"correctOrder":[0,1,2,3],"metric":"Nominal voltage, lowest to highest","values":["208V","415V","13.8kV","138kV"]}`,
    palette: "",
  },
  Circuit: {
    schema: `{"name":str,"domain":str,"timeLimit":60,"questions":[6 items, each {"q":str statement,"a":boolean,"explanation":str}]}. Mix true and false. Each statement verifiable.`,
    ex: `{"name":"GPU & Accelerators Sprint","domain":"GPU & Accelerators","timeLimit":60,"questions":[{"q":"GPUs excel at the parallel matrix math used in AI training.","a":true,"explanation":"Massive parallelism suits neural-network computation."},{"q":"A CPU outperforms a GPU on large-scale AI training throughput.","a":false,"explanation":"GPUs vastly outperform CPUs on AI training."}]}`,
    palette: "",
  },
  "The Brief": {
    schema: `{"name":str,"domain":str,"readTime":90,"brief":str (3 short paragraphs joined by \\n\\n),"questions":[3 items, each {"q":str,"options":[4 strings],"correct":0-based index,"explanation":str}]}. Questions answerable ONLY from the brief.`,
    ex: `{"name":"Custom Silicon vs NVIDIA's Moat","domain":"Compute","readTime":90,"brief":"NVIDIA's dominance rests on more than fast chips...\\n\\nThe largest clouds design their own silicon...\\n\\nThe outcome is a two-track market.","questions":[{"q":"What is NVIDIA's deepest moat?","options":["Marketing","The CUDA software ecosystem","Retail stores","Real estate"],"correct":1,"explanation":"The brief names CUDA."}]}`,
    palette: "",
  },
  "Dark Fiber": {
    schema: `{"name":str,"domain":str,"pairs":[6 items, each {"term":str (short, UPPER ok),"def":str <= 80 chars}]}. Terms distinct; each def uniquely identifies its term.`,
    ex: `{"name":"Site Metrics","domain":"Facility Measurement","pairs":[{"term":"PUE","def":"Power Usage Effectiveness comparing total energy to IT energy"},{"term":"WUE","def":"Water Usage Effectiveness per unit of IT energy"}]}`,
    palette: "",
  },
  Frequency: {
    schema: `{"name":str,"domain":str,"questions":[4 items, each {"q":str,"options":[4 strings],"correct":0-based index,"explanation":str}]}. Exactly one correct option; plausible distractors.`,
    ex: `{"name":"GPU Generations & TDP Quiz","domain":"Chips & Density","questions":[{"q":"Which Nvidia architecture came after Hopper?","options":["Blackwell","Ampere","Volta","Pascal"],"correct":0,"explanation":"Blackwell succeeded Hopper."}]}`,
    palette: "",
  },
};

const COPY_RULES = `COPY RULES (subscriber-facing, HARD):
- Never state a count of theaters/sectors/threads (no "seven theaters", no totals of any kind).
- Never use the words Theme, Domain, or Sub-Domain; never emit a T-### or D#.# id. The "domain" JSON field is a short human topic label (e.g. the Sector name), never a code.
- Keep everything grounded in real, verifiable facts about the AI-infrastructure buildout. No invented companies, numbers, or events.`;

const HINT_RULES = `HINTS: each puzzle object is accompanied by three escalating hints returned as "hints":[h1,h2,h3]:
- h1: a gentle reframe — orient the player, reveal NO new fact and never the answer.
- h2: materially narrows the solution space (a concrete constraint or partial fact).
- h3: near-answer / mechanical (all but gives it away). Three must be distinct and increasingly revealing.`;

export function systemPrompt(type) {
  return `You are the Faraday Daily Challenge puzzle author for the "${type}" game. You produce STRICT JSON only — no prose, no markdown fences. Every puzzle is grounded in real facts about the AI data-center infrastructure buildout and coheres with the given daily theme without all items being about one company.
${COPY_RULES}
${HINT_RULES}
Return a JSON ARRAY with one object per requested item, in order. Each array element is: {"puzzle": <content matching the schema>, "hints":[h1,h2,h3], "answer_explanation": str (1-2 sentences), "difficulty": "easy|medium|hard"}.`;
}

// items: [{ theme: {theater_name, sector_name, thread_names[], tier_name}, subject, difficulty, threadScope }]
export function userPrompt(type, items) {
  const s = SPEC[type];
  const lines = items.map((it, i) => {
    const t = it.theme;
    return `ITEM ${i + 1}:
  Theater: ${t.theater_name}  |  Sector: ${t.sector_name}  |  Thread(s): ${t.thread_names.join(", ")}
  Angle (internal constraint lens, do NOT name it): ${t.tier_name}
  Subject to build this puzzle around: ${it.subject}
  Target difficulty: ${it.difficulty}
  Thread scope notes: ${it.threadScope || "(use the Thread names above)"}`;
  }).join("\n\n");
  return `SCHEMA for one "${type}" puzzle content object:
${s.schema}
${s.palette ? "\n" + s.palette + "\n" : ""}
EXEMPLAR (shape only — do not copy content):
${s.ex}

Author ${items.length} DISTINCT "${type}" puzzles, one per ITEM below. Each must legibly connect to its ITEM's Theater/Sector/Thread(s) and be built around its Subject, at its target difficulty. Vary the angle across items — do not reuse the same companies or facts.

${lines}

Output: a JSON array of exactly ${items.length} elements as specified in the system message. JSON only.`;
}

export { SPEC };
