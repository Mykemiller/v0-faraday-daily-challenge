#!/usr/bin/env node
// Faraday Academy — automated accessibility gate (axe-core, WCAG 2.1 A/AA).
//
// Drives the real deployment in headless Chrome at a phone and a desktop width,
// in BOTH colour schemes, and runs axe on each. The contrast gate
// (scripts/academy-contrast.mjs) proves the tokens; this proves the rendered DOM.
//
//   node scripts/academy-a11y.mjs <base-url> [--slug=<course-slug>]
//
// Exits non-zero on any violation.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import puppeteer from "puppeteer-core";

const require = createRequire(import.meta.url);
const AXE_SOURCE = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const base = (process.argv[2] ?? "").replace(/\/$/, "");
const slugArg = process.argv.find((a) => a.startsWith("--slug="));
const slug = slugArg ? slugArg.slice("--slug=".length) : null;
if (!base || !slug) {
  console.error("usage: node scripts/academy-a11y.mjs <base-url> --slug=<course-slug>");
  process.exit(2);
}

const PAGES = [
  ["catalog", "/academy"],
  ["course home", `/academy/${slug}`],
  ["reader", `/academy/${slug}/1/1`],
  ["module review", `/academy/${slug}/1/review`],
  ["quiz", `/academy/${slug}/quiz`],
  ["glossary", `/academy/${slug}/glossary`],
];
const VIEWPORTS = [["phone", 390, 844], ["desktop", 1440, 900]];
const SCHEMES = ["light", "dark"];

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

let total = 0;
const seen = new Map();

for (const [vpName, width, height] of VIEWPORTS) {
  for (const scheme of SCHEMES) {
    const page = await browser.newPage();
    await page.setViewport({ width, height });
    await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: scheme }]);

    for (const [label, path] of PAGES) {
      try {
        await page.goto(`${base}${path}`, { waitUntil: "networkidle2", timeout: 60000 });
        await page.evaluate(AXE_SOURCE);
        const results = await page.evaluate(async () =>
          await window.axe.run(document, {
            runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
          })
        );
        const v = results.violations;
        const tag = `${vpName}/${scheme}`;
        if (v.length === 0) {
          console.log(`✔ ${tag.padEnd(15)} ${label}`);
        } else {
          total += v.length;
          console.error(`✖ ${tag.padEnd(15)} ${label}`);
          for (const issue of v) {
            console.error(`    [${issue.impact}] ${issue.id}: ${issue.help} (${issue.nodes.length} node(s))`);
            const key = `${issue.id}`;
            seen.set(key, (seen.get(key) ?? 0) + issue.nodes.length);
            for (const n of issue.nodes.slice(0, 2)) {
              console.error(`        ${n.target.join(" ")}`);
            }
          }
        }
      } catch (err) {
        total++;
        console.error(`✖ ${vpName}/${scheme} ${label} — ${err.message}`);
      }
    }
    await page.close();
  }
}

await browser.close();
if (seen.size > 0) {
  console.error("\nviolation rules seen:");
  for (const [id, n] of [...seen.entries()].sort((a, b) => b[1] - a[1])) {
    console.error(`  ${id}: ${n} node(s)`);
  }
}
console.log(`\n${PAGES.length * VIEWPORTS.length * SCHEMES.length} page-renders checked, ${total} violations.`);
process.exit(total > 0 ? 1 : 0);
