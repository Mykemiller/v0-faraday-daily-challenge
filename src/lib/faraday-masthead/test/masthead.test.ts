// faraday-masthead unit tests (FDY-444). No network, no React.
// Run: node --experimental-strip-types --no-warnings --test packages/faraday-masthead/test/masthead.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  APPBAR_HEIGHT, BAR_HEIGHT, BAR_HEIGHT_NARROW, CONTRAST_PAIRS, FORBIDDEN_IN_BAR, MASTHEAD_CSS, MASTHEAD_VERSION, RULE,
  TOKENS, contrastRatio, esc, initialOf, renderAppBarHtml, renderMastheadHtml,
} from "../core.ts";

const PKG = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

test("VERSION file matches core.MASTHEAD_VERSION", () => {
  assert.equal(fs.readFileSync(path.join(PKG, "VERSION"), "utf8").trim(), MASTHEAD_VERSION);
});

test("landmark, skip link, mark + wordmark link home, context slot", () => {
  const h = renderMastheadHtml({ appName: "Jurisdiction Watch", homeHref: "/jurisdiction-watch" });
  assert.match(h, /^<header class="fm" role="banner"/);
  assert.match(h, /<a class="fm-skip" href="#main">Skip to content<\/a>/);
  assert.equal((h.match(/href="\/jurisdiction-watch"/g) || []).length, 2, "mark and wordmark both link to the app home");
  assert.match(h, />Faraday<\/a>/);
  assert.match(h, /<span class="fm-app">Jurisdiction Watch<\/span>/);
  assert.match(h, /<a class="fm-signin" href="\/sign-in">Sign in<\/a>/);
  assert.equal(h.includes("fm-user"), false);
});

test("signed in: email shown (truncated by CSS), no Sign in", () => {
  const h = renderMastheadHtml({ appName: "Signal Room", email: "someone.with.a.long.address@example.com" });
  assert.match(h, /<span class="fm-user" title="someone.with.a.long.address@example.com">/);
  assert.equal(h.includes("Sign in"), false);
  assert.match(MASTHEAD_CSS, /\.fm-user\{[^}]*text-overflow:ellipsis/);
});

test("context slot takes extra compact items before the app name", () => {
  const h = renderMastheadHtml({ appName: "Daily Challenge", contextHtml: `<span class="chip">@myke</span>` });
  assert.ok(h.indexOf("@myke") < h.indexOf("fm-app"));
  const s = renderMastheadHtml({ appName: "Workbench", signInHtml: `<button id="wb-auth">Sign in</button>` });
  assert.ok(s.includes(`<button id="wb-auth">Sign in</button>`) && !s.includes("fm-signin"));
});

test("values are escaped exactly like React", () => {
  assert.equal(esc(`<a href="x">'&`), "&lt;a href=&quot;x&quot;&gt;&#x27;&amp;");
  const h = renderMastheadHtml({ appName: `<script>alert(1)</script>`, homeHref: `"/><img src=x>`, email: `"><b>x` });
  assert.equal(/<script>|<img|<b>/.test(h), false);
});

test("narrow-screen avatar initial", () => {
  assert.equal(initialOf("myke@example.com", "Live Agent"), "M");
  assert.equal(initialOf(null, "Live Agent"), "L");
  assert.equal(initialOf("  ", "  "), "F");
  assert.equal(initialOf("_x@y", "A"), "X");
});

test("spec: heights, gold 2 px rules, tokens only, no navy", () => {
  assert.equal(BAR_HEIGHT, 64); assert.equal(BAR_HEIGHT_NARROW, 56); assert.equal(RULE, 2); assert.equal(APPBAR_HEIGHT, 48);
  assert.match(MASTHEAD_CSS, /\.fm\{[^}]*background:#1C3424;[^}]*border-top:2px solid #C4922A;[^}]*border-bottom:2px solid #C4922A/);
  assert.match(MASTHEAD_CSS, /\.fm-bar\{[^}]*height:64px/);
  assert.match(MASTHEAD_CSS, /@media \(max-width:639px\)\{\.fm-bar\{height:56px/);
  assert.match(MASTHEAD_CSS, /\.fm-appbar-in\{[^}]*min-height:48px/);
  assert.match(MASTHEAD_CSS, /\.fm-appbar\{[^}]*background:#EEE6DA;color:#141210/);
  const allowed = new Set(Object.values(TOKENS).map((c) => c.toUpperCase()));
  const used = (MASTHEAD_CSS.match(/#[0-9A-Fa-f]{6}\b/g) || []).map((c) => c.toUpperCase());
  for (const c of used) assert.ok(allowed.has(c), `non-token colour ${c}`);
  assert.equal(/#(0{2}0{2}80|1F3A5F|0B1F3A|000080)/i.test(MASTHEAD_CSS), false, "no navy");
});

test("44 px tap targets on every interactive element", () => {
  for (const sel of ["fm-markl", "fm-word", "fm-signin", "fm-applink", "fm-skip"]) {
    const rule = new RegExp(`\\.${sel}\\{[^}]*min-height:44px`);
    assert.match(MASTHEAD_CSS, rule, `${sel} has a 44 px tap target`);
  }
  assert.match(MASTHEAD_CSS, /\.fm-avatar\{display:inline-flex;[^}]*width:44px;height:44px/);
});

test("visible focus: gold-light outline", () => {
  assert.match(MASTHEAD_CSS, /:focus-visible[^{]*\{outline:3px solid #DAB050/);
});

test("contrast is AA for every pair the bar draws", () => {
  for (const p of CONTRAST_PAIRS) {
    const r = contrastRatio(p.fg, p.bg);
    assert.ok(r >= p.min, `${p.name}: ${r.toFixed(2)} < ${p.min}`);
  }
  assert.ok(Math.abs(contrastRatio("#FFFFFF", "#000000") - 21) < 1e-9);
});

test("Brand Bible G1: no prices, counts or marketing copy in the bar", () => {
  const html = renderMastheadHtml({ appName: "Briefing Library", email: "a@b.co" }) + renderAppBarHtml({ label: "Briefing Library", links: [{ label: "Shelf", href: "/library" }] });
  for (const re of FORBIDDEN_IN_BAR) assert.equal(re.test(html.replace(/<[^>]+>/g, " ")), false, String(re));
});

test("SSR-safe source: no window/document access at module or render scope", () => {
  const core = fs.readFileSync(path.join(PKG, "core.ts"), "utf8");
  assert.equal(/\bwindow\.|\bdocument\./.test(core.replace(/MASTHEAD_SCRIPT =[\s\S]*?;\n\n/, "")), false);
  const tsx = fs.readFileSync(path.join(PKG, "ui", "Masthead.tsx"), "utf8");
  const outsideEffects = tsx.replace(/useEffect\(\(\) => \{[\s\S]*?\}, \[open\]\);/, "");
  assert.equal(/\bwindow\.|\bdocument\./.test(outsideEffects), false);
  assert.equal(/from "(?!react"|\.\.\/core\.ts")/.test(tsx), false, "no runtime import beyond React and core");
});

test("AppBar renders the app's links with aria-current", () => {
  const h = renderAppBarHtml({ label: "Academy", links: [{ label: "Lobby", href: "/academy", current: true }, { label: "Courses", href: "/academy/courses" }] });
  assert.match(h, /^<nav class="fm-appbar" aria-label="Academy">/);
  assert.match(h, /<a class="fm-applink" href="\/academy" aria-current="page">Lobby<\/a>/);
  assert.match(h, /<a class="fm-applink" href="\/academy\/courses">Courses<\/a>/);
});

test("generated files are up to date (static css/html, gate.html header, MANIFEST)", () => {
  const r = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", path.join(PKG, "scripts", "build.mjs"), "--check"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr || r.stdout);
});

test("check-drift passes on the canonical copy and fails on an edited copy", () => {
  const ok = spawnSync(process.execPath, [path.join(PKG, "check-drift.mjs"), "--canonical", PKG], { encoding: "utf8" });
  assert.equal(ok.status, 0, ok.stderr);
  const tmp = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TMPDIR || "/tmp"), "fm-drift-"));
  fs.cpSync(PKG, tmp, { recursive: true });
  fs.appendFileSync(path.join(tmp, "core.ts"), "\n// local edit\n");
  const bad = spawnSync(process.execPath, [path.join(tmp, "check-drift.mjs")], { encoding: "utf8" });
  assert.equal(bad.status, 1); assert.match(bad.stderr, /core\.ts differs/);
  fs.writeFileSync(path.join(tmp, "VERSION"), "0.9.0\n");
  const ver = spawnSync(process.execPath, [path.join(tmp, "check-drift.mjs"), "--canonical", PKG], { encoding: "utf8" });
  assert.equal(ver.status, 1); assert.match(ver.stderr, /VERSION is 0\.9\.0/);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("the gate's static page carries the shared masthead (no second copy)", () => {
  const gate = path.join(PKG, "..", "faraday-gate", "ui", "gate.html");
  if (!fs.existsSync(gate)) return; // vendored layout without the gate
  const g = fs.readFileSync(gate, "utf8");
  assert.match(g, /<!-- faraday-masthead:start --><style data-fm-css="[^"]+">[\s\S]*<header class="fm" role="banner"[\s\S]*<!-- faraday-masthead:end -->/);
  assert.equal(/class="mast"|class="rule"/.test(g), false, "the old hand-written masthead is gone");
  const tsx = fs.readFileSync(path.join(PKG, "..", "faraday-gate", "ui", "GatePage.tsx"), "utf8");
  assert.match(tsx, /import \{ Masthead \} from "\.\.\/\.\.\/faraday-masthead\/ui\/Masthead\.tsx"/);
  assert.equal(/<header/.test(tsx), false, "GatePage has no header markup of its own");
});
