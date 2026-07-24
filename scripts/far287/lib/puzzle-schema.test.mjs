// FAR-287 — pure-logic tests for puzzle-schema.mjs. Run: node --test scripts/far287/lib/puzzle-schema.test.mjs
// Exemplars are the REAL 2026-07-23 live bank records (round-trip proves Phase-0 inference).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateContent, extractAnswer, answerKeyFrom, checkHints, copyViolations,
  contentHash, subjectFingerprint, parseModelJson,
} from "./puzzle-schema.mjs";

const REAL = {
  Rackl: { name: "Grid & Interconnect", domain: "Grid", groups: [
    { label: "ISO/RTOs", color: "#1C3424", textColor: "#EEE6DA", items: ["PJM","ERCOT","MISO","CAISO"] },
    { label: "FERC Actions", color: "#C4922A", textColor: "#141210", items: ["Order 2023","Tariff filing","Rate case","Order 1920"] },
    { label: "Capacity Terms", color: "#2A5A3A", textColor: "#EEE6DA", items: ["Capacity market","Demand","Peak load","Reserve margin"] },
    { label: "Reliability", color: "#5A4010", textColor: "#EEE6DA", items: ["NERC","Contingency","Frequency","Black start"] }] },
  "Signal Drop": { name: "SUBSTATION", domain: "Power Architecture", word: "SUBSTATION",
    clue: "A facility that transforms transmission voltage down to usable distribution levels",
    hint1: "Where high voltage steps down", hint2: "Proximity speeds interconnection" },
  "The Stack": { name: "Rank voltage classes by level", domain: "Power & Electrical",
    items: ["Rack PDU","Busway","Medium-voltage","Transmission"], correctOrder: [0,1,2,3],
    metric: "Nominal voltage, lowest to highest", values: ["208V","415V","13.8kV","138kV"] },
  Circuit: { name: "GPU & Accelerators Sprint", domain: "GPU & Accelerators", timeLimit: 60, questions: [
    { q: "GPUs excel at the parallel matrix math used in AI training.", a: true, explanation: "Massive parallelism suits neural-network computation." },
    { q: "A CPU outperforms a GPU on large-scale AI training throughput.", a: false, explanation: "GPUs vastly outperform CPUs on AI training." }] },
  "The Brief": { name: "Custom Silicon vs NVIDIA's Moat", domain: "Compute", readTime: 90,
    brief: "NVIDIA's dominance rests on more than fast chips.\n\nThe largest cloud providers are responding by designing their own custom silicon.\n\nThe outcome is a two-track market.",
    questions: [{ q: "What is described as NVIDIA's deepest moat?", options: ["Its marketing budget","The CUDA software ecosystem that locks in developers","Its retail stores","Its data center real estate"], correct: 1, explanation: "The brief identifies the CUDA software ecosystem." }] },
  "Dark Fiber": { name: "Site Metrics", domain: "Facility Measurement", pairs: [
    { term: "PUE", def: "Power Usage Effectiveness comparing total energy to IT energy" },
    { term: "WUE", def: "Water Usage Effectiveness tracking water used per unit of IT energy" },
    { term: "CRITICAL LOAD", def: "The protected IT power that must survive any single failure" },
    { term: "TIER III", def: "An Uptime classification for concurrently maintainable facilities" }] },
  Frequency: { name: "GPU Generations & TDP Quiz", domain: "Chips & Density", questions: [
    { q: "Which Nvidia architecture came after Hopper?", options: ["Blackwell","Ampere","Volta","Pascal"], correct: 0, explanation: "Nvidia's Blackwell architecture succeeded Hopper." },
    { q: "What was the predecessor to Hopper (H100)?", options: ["Ampere (A100)","Blackwell","Lovelace","Turing"], correct: 0, explanation: "The Ampere A100 preceded the Hopper H100." }] },
};

test("real exemplars validate + round-trip to a non-null answer", () => {
  for (const [type, content] of Object.entries(REAL)) {
    const { ok, errors } = validateContent(type, content);
    assert.ok(ok, `${type} should validate: ${errors.join("; ")}`);
    assert.ok(extractAnswer(type, content), `${type} round-trip must be non-null`);
    assert.ok(answerKeyFrom(type, content), `${type} answer_key must derive`);
  }
});

test("answer keys are correct", () => {
  assert.equal(answerKeyFrom("Signal Drop", REAL["Signal Drop"]), "SUBSTATION");
  assert.ok(answerKeyFrom("Frequency", REAL.Frequency).startsWith("1. Blackwell"));
  assert.ok(answerKeyFrom("Circuit", REAL.Circuit).startsWith("1. True"));
});

test("structural guards reject malformed content", () => {
  assert.ok(!validateContent("Rackl", { groups: REAL.Rackl.groups.slice(0, 3) }).ok, "Rackl needs 4 groups");
  assert.ok(!validateContent("Signal Drop", { word: "TWO WORDS", clue: "x" }).ok, "word must be single token");
  assert.ok(!validateContent("The Stack", { items: ["a","b"], correctOrder: [0,1,2], metric: "m" }).ok, "correctOrder must match items");
  assert.ok(!validateContent("The Brief", { readTime: 90, brief: "one para only", questions: REAL["The Brief"].questions }).ok, "brief must be multi-paragraph");
  assert.ok(!validateContent("Frequency", { questions: [{ q: "?", options: ["a","b","c"], correct: 5, explanation: "e" }] }).ok, "correct index out of range");
  assert.ok(!validateContent("Circuit", { questions: REAL.Circuit.questions }).ok, "Circuit needs timeLimit");
});

test("hint escalation checks", () => {
  assert.ok(checkHints("a gentle reframe", "narrows it down", "nearly the answer", "SUBSTATION").ok);
  assert.ok(!checkHints("same", "same", "same", "X").ok, "must be distinct");
  assert.ok(!checkHints("", "b", "c", "X").ok, "all required");
  assert.ok(!checkHints("the answer is substation", "b", "c", "SUBSTATION").ok, "hint1 leak rejected");
});

test("copy compliance flags real violations, passes clean copy", () => {
  assert.deepEqual(copyViolations("Today The Power Reckoning turns to the Grid & Regulatory sector."), []);
  assert.ok(copyViolations("one of seven theaters").length, "count phrase");
  assert.ok(copyViolations("this domain covers power").length, "banned word");
  assert.ok(copyViolations("see T-001 / D3.1").length, "raw ID");
  assert.deepEqual(copyViolations("Carbon Accounting & Scope 1-3"), [], "proper name w/ digits is fine");
});

test("content hash stable + order-independent; fingerprint stable", () => {
  const a = contentHash({ x: 1, y: [2, 3] }, "K");
  const b = contentHash({ y: [2, 3], x: 1 }, "K");
  assert.equal(a, b, "key order must not change hash");
  assert.notEqual(a, contentHash({ x: 1, y: [3, 2] }, "K"), "value order matters");
  assert.equal(subjectFingerprint("Signal Drop", REAL["Signal Drop"]), subjectFingerprint("Signal Drop", { word: "substation" }), "fingerprint case-insensitive");
});

test("defensive JSON parse strips fences + salvages", () => {
  assert.deepEqual(parseModelJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseModelJson('{"a":1}  trailing junk {'), { a: 1 }, "salvage first object");
  assert.equal(parseModelJson("not json"), null);
});
