#!/usr/bin/env node
// Faraday Predicts UI 3.0 — rendered-HTML gate (FDY-273…276).
//
//   node scripts/predicts-gate-check.mjs <base-url> <path> [<path> …]
//
// Per page, on the server-rendered HTML:
//   - 0 taxonomy counts      /\b\d+\s+(sectors|theaters|threads)\b/i
//   - 0 market words         /\b(odds|bet|wager|trade|buy|sell|market)\b/i — outside the
//                            verbatim disclaimer and outside forecast claim text
//                            (elements marked data-claim: the claim is Faraday's
//                            published forecast, not page copy)
//   - 0 accuracy percentages /\b\d{1,3}\s?%\s*(accura|correct|hit|right)/i and "accuracy"
//   - 0 internal codes       /\b[DT]\d+(\.\d+)?\b/, /\bL\d+\b/
//   - disclaimer + release tag present (/predicts routes)
//   - every data-row shows a 1–99 probability and a date
// Exit 1 on any failure.

const DISCLAIMER =
  "Faraday Predicts publishes Faraday's own analytical forecasts and grades them in public. Nothing here is a market, a wager, a price or investment advice.";

const decode = (s) =>
  s.replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ").replace(/<!-- -->/g, "");

export function visibleText(html) {
  return decode(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<!-- -->/g, "")
      .replace(/<[^>]+>/g, " "),
  ).replace(/\s+/g, " ");
}

export function checkHtml(html, { predictsRoute = true } = {}) {
  const fails = [];
  const text = visibleText(html);
  const noClaims = visibleText(html.replace(/<(\w+)[^>]*\bdata-claim\b[^>]*>[\s\S]*?<\/\1>/g, " "));
  const copy = noClaims.split(DISCLAIMER).join(" ");
  const tax = text.match(/\b\d+\s+(sectors|theaters|threads)\b/i);
  if (tax) fails.push(`taxonomy count: "${tax[0]}"`);
  const mk = copy.match(/\b(odds|bet|wager|trade|buy|sell|market)\b/i);
  if (mk) fails.push(`market word in copy: "${mk[0]}" …${copy.slice(Math.max(0, copy.indexOf(mk[0]) - 40), copy.indexOf(mk[0]) + 40)}…`);
  const acc = text.match(/\b\d{1,3}\s?%\s*(accura|correct|hit|right)/i) || noClaims.match(/\baccuracy\b/i);
  if (acc) fails.push(`accuracy: "${acc[0]}"`);
  const code = noClaims.match(/\b[DT]\d+(\.\d+)?\b/) || noClaims.match(/\bL\d+\b/);
  if (code) fails.push(`internal code: "${code[0]}"`);
  if (predictsRoute) {
    if (!text.includes(DISCLAIMER)) fails.push("disclaimer missing");
    if (!/Release \d{2}-\d{2}-v\d{2}/.test(text)) fails.push("release tag missing");
  }
  const rows = html.match(/<(\w+)[^>]*\bdata-row\b[^>]*>[\s\S]*?<\/\1>/g) ?? [];
  let bad = 0;
  for (const r of rows) {
    const t = visibleText(r);
    const p = [...t.matchAll(/\b(\d{1,2})\s?%/g)].some((m) => +m[1] >= 1 && +m[1] <= 99);
    const d = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{1,2}\b/.test(t);
    if (!p || !d) bad++;
  }
  if (bad) fails.push(`${bad} of ${rows.length} rows missing a 1–99 probability or a date`);
  return { fails, rows: rows.length };
}

async function main() {
  const [base, ...paths] = process.argv.slice(2);
  let failed = false;
  for (const p of paths) {
    const r = await fetch(new URL(p, base), { redirect: "follow" });
    const html = await r.text();
    const { fails, rows } = checkHtml(html, { predictsRoute: p.startsWith("/predicts") });
    console.log(`${fails.length ? "FAIL" : "PASS"} ${r.status} ${p} (rows=${rows})${fails.length ? "\n  - " + fails.join("\n  - ") : ""}`);
    if (fails.length || r.status >= 400) failed = true;
  }
  process.exit(failed ? 1 : 0);
}
if (import.meta.url === `file://${process.argv[1]}`) main();
