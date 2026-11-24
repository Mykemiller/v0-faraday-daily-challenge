// faraday-masthead unit tests (FDY-444). No network, no React.
// Run: node --experimental-strip-types --no-warnings --test packages/faraday-masthead/test/masthead.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  APPBAR_HEIGHT, BAR_HEIGHT, BAR_HEIGHT_NARROW, CONTRAST_PAIRS, FORBIDDEN_IN_BAR, MASTHEAD_CLOSE_EVENT, MASTHEAD_CSS,
  MASTHEAD_SCRIPT, MASTHEAD_VERSION, RULE, TOKENS, appBarClass, contrastRatio, esc, initialOf, renderAppBarHtml,
  renderMastheadHtml,
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

test("AppBar overflow: default keeps the scroller; overflow=visible opts into fm-appbar--menus (no clipping, wraps)", () => {
  const links = [{ label: "Map", href: "/map" }];
  const def = renderAppBarHtml({ label: "JW", links });
  assert.equal(def, renderAppBarHtml({ label: "JW", links, overflow: "scroll" }), "scroll is the default");
  assert.match(def, /^<nav class="fm-appbar" aria-label="JW"><div class="fm-appbar-in">/);
  const vis = renderAppBarHtml({ label: "JW", links, overflow: "visible" });
  assert.match(vis, /^<nav class="fm-appbar fm-appbar--menus" aria-label="JW"><div class="fm-appbar-in">/);
  assert.equal(vis.replace(" fm-appbar--menus", ""), def, "only the class differs");
  assert.equal(appBarClass(), "fm-appbar"); assert.equal(appBarClass("visible"), "fm-appbar fm-appbar--menus");
  assert.match(MASTHEAD_CSS, /\.fm-appbar-in\{[^}]*overflow-x:auto/, "default row still scrolls");
  assert.match(MASTHEAD_CSS, /\.fm-appbar--menus \.fm-appbar-in\{overflow:visible;flex-wrap:wrap\}/);
});

test("narrow menu: data-open drives it; :focus-within is only the no-script fallback", () => {
  assert.match(MASTHEAD_CSS, /\.fm-ctx\[data-open="true"\] \.fm-panel,\.fm-ctx:not\(\[data-fm-js\]\):focus-within \.fm-panel\{display:flex\}/);
  assert.equal(/\.fm-ctx:focus-within/.test(MASTHEAD_CSS), false, "a focused button cannot hold the menu open once the script runs");
  assert.equal(renderMastheadHtml({ appName: "X" }).includes("data-fm-js"), false, "server markup never carries data-fm-js");
});

// A minimal DOM (tree, attributes, closest/contains, capture + bubble dispatch) to run MASTHEAD_SCRIPT in plain Node.
class FakeEl {
  tag: string; attrs: Record<string, string> = {}; children: FakeEl[] = []; parent: FakeEl | null = null;
  listeners: Record<string, { fn: (e: any) => void; cap: boolean }[]> = {}; doc: FakeDoc | null = null;
  constructor(tag: string, attrs: Record<string, string> = {}) { this.tag = tag; Object.assign(this.attrs, attrs); }
  append(...kids: FakeEl[]) { for (const k of kids) { k.parent = this; this.children.push(k); } return this; }
  setAttribute(k: string, v: string) { this.attrs[k] = String(v); }
  getAttribute(k: string) { return k in this.attrs ? this.attrs[k] : null; }
  hasAttribute(k: string) { return k in this.attrs; }
  contains(n: FakeEl | null) { for (let x = n; x; x = x.parent) if (x === this) return true; return false; }
  matches(sel: string) {
    return sel.split(",").some((one) => { const s = one.trim(); return s.startsWith(".") ? (this.attrs.class || "").split(" ").includes(s.slice(1)) : this.tag === s; });
  }
  closest(sel: string) { for (let x: FakeEl | null = this; x && x.tag !== "#document"; x = x.parent) if (x.matches(sel)) return x; return null; }
  querySelector(sel: string): FakeEl | null { for (const c of this.children) { if (c.matches(sel)) return c; const r = c.querySelector(sel); if (r) return r; } return null; }
  addEventListener(type: string, fn: (e: any) => void, cap?: boolean) { (this.listeners[type] ||= []).push({ fn, cap: !!cap }); }
  focus() { root(this).activeElement = this; }
}
class FakeDoc extends FakeEl { activeElement: FakeEl | null = null; constructor() { super("#document"); } }
function root(n: FakeEl): FakeDoc { let x = n; while (x.parent) x = x.parent; return x as FakeDoc; }
function fire(target: FakeEl, type: string, extra: Record<string, unknown> = {}) {
  const path: FakeEl[] = []; for (let x: FakeEl | null = target; x; x = x.parent) path.push(x);
  const e = { type, target, ...extra };
  for (const n of [...path].reverse()) for (const l of n.listeners[type] || []) if (l.cap) l.fn(e);
  for (const n of path) for (const l of n.listeners[type] || []) if (!l.cap) l.fn(e);
}

test("static MASTHEAD_SCRIPT closes the narrow menu when a link or button inside the panel is activated", () => {
  const doc = new FakeDoc();
  const avatar = new FakeEl("button", { class: "fm-avatar", "aria-expanded": "false" });
  const app = new FakeEl("span", { class: "fm-app" });
  const signIn = new FakeEl("button", { class: "fm-signin" });
  const inner = new FakeEl("span");
  const link = new FakeEl("a", { class: "chip" }).append(inner);
  const panel = new FakeEl("div", { class: "fm-panel" }).append(link, app, signIn);
  const ctx = new FakeEl("div", { class: "fm-ctx", "data-open": "false" }).append(avatar, panel);
  const outside = new FakeEl("button", { class: "elsewhere" });
  doc.append(new FakeEl("header", { class: "fm" }).append(ctx), outside);
  new Function("document", MASTHEAD_SCRIPT)(doc);
  const isOpen = () => ctx.getAttribute("data-open") === "true";
  const open = () => { if (!isOpen()) fire(avatar, "click"); assert.ok(isOpen()); assert.equal(avatar.getAttribute("aria-expanded"), "true"); };

  assert.ok(ctx.hasAttribute("data-fm-js"), "the script marks the context so CSS stops using :focus-within");
  open(); fire(app, "click"); assert.ok(isOpen(), "plain text in the panel does not close it");
  fire(signIn, "click"); assert.equal(isOpen(), false, "a button inside the panel closes it");
  assert.equal(avatar.getAttribute("aria-expanded"), "false");
  open(); fire(inner, "click"); assert.equal(isOpen(), false, "a click inside a link inside the panel closes it");
  open(); fire(avatar, "click"); assert.equal(isOpen(), false, "the initial button toggles it shut");
  open(); fire(doc, MASTHEAD_CLOSE_EVENT); assert.equal(isOpen(), false, "the fm:close event closes it");
  open(); fire(doc, "keydown", { key: "Escape" }); assert.equal(isOpen(), false); assert.equal(doc.activeElement, avatar, "Escape returns focus");
  open(); fire(signIn, "focusout", { relatedTarget: link }); assert.ok(isOpen(), "focus moving within the menu keeps it");
  fire(signIn, "focusout", { relatedTarget: outside }); assert.equal(isOpen(), false, "focus leaving the menu closes it");
  open(); fire(outside, "click"); assert.equal(isOpen(), false, "a click outside closes it");
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
