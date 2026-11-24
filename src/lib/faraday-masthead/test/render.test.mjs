// faraday-masthead React parity test (FDY-444): renderToStaticMarkup(<Masthead/>) must equal core.renderMastheadHtml for the
// same options, byte for byte, so the React and static versions can never diverge. Needs react, react-dom and esbuild on the
// module path (every Next.js app has them); skips cleanly without them (the Workbench itself has no React).
// Run: NODE_PATH=<node_modules> node --experimental-strip-types --test packages/faraday-masthead/test/render.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(process.env.NODE_PATH || process.cwd(), "noop.js"));
let esbuild, React, server;
try { esbuild = require("esbuild"); React = require("react"); server = require("react-dom/server"); } catch { /* skip below */ }

async function bundle(entry, out) {
  await esbuild.build({
    entryPoints: [entry], bundle: true, platform: "node", format: "cjs", outfile: out,
    external: ["react", "react/jsx-runtime"], jsx: "automatic", logLevel: "silent",
    nodePaths: [process.env.NODE_PATH || path.join(process.cwd(), "node_modules")],
  });
  return createRequire(out)(out);
}

test("React Masthead and AppBar match the static renderer byte for byte", { skip: !esbuild && "esbuild/react not installed" }, async () => {
  const out = path.join(ROOT, "test", ".masthead.bundle.cjs");
  const mod = await bundle(path.join(ROOT, "ui", "Masthead.tsx"), out);
  const core = await import(pathToFileURL(path.join(ROOT, "core.ts")).href);
  const cases = [
    { appName: "Jurisdiction Watch", homeHref: "/jurisdiction-watch" },
    { appName: "Signal Room", email: "someone@example.com" },
    { appName: "Faraday's \"Daily\" <Challenge>", homeHref: "/challenge?x=1&y=2", skipTo: "dc-main", signInHref: "/account" },
  ];
  for (const c of cases) {
    const html = server.renderToStaticMarkup(React.createElement(mod.Masthead, { ...c, includeStyles: false }));
    assert.equal(html, core.renderMastheadHtml(c), JSON.stringify(c));
  }
  const withCtx = server.renderToStaticMarkup(React.createElement(mod.Masthead, { appName: "Daily Challenge", includeStyles: false, context: React.createElement("span", { className: "chip" }, "@myke") }));
  assert.equal(withCtx, core.renderMastheadHtml({ appName: "Daily Challenge", contextHtml: `<span class="chip">@myke</span>` }));
  const btn = server.renderToStaticMarkup(React.createElement(mod.Masthead, { appName: "Gate", includeStyles: false, onSignIn: () => {} }));
  assert.match(btn, /<button type="button" class="fm-signin">Sign in<\/button>/);
  const styled = server.renderToStaticMarkup(React.createElement(mod.Masthead, { appName: "X" }));
  assert.ok(styled.startsWith(`<style data-fm-css="${core.MASTHEAD_VERSION}">`) && styled.includes(core.MASTHEAD_CSS));
  const links = [{ label: "Lobby", href: "/academy", current: true }, { label: "Courses & more", href: "/academy/c" }];
  assert.equal(server.renderToStaticMarkup(React.createElement(mod.AppBar, { label: "Academy", links })), core.renderAppBarHtml({ label: "Academy", links }));
  // 1.1.0: AppBar overflow="visible" (fm-appbar--menus) renders identically in React and static, and "scroll" is the default.
  for (const overflow of ["visible", "scroll", undefined]) {
    const r = server.renderToStaticMarkup(React.createElement(mod.AppBar, { label: "Daily Challenge", links, overflow }, React.createElement("div", { className: "dc-appbar-row" }, "x")));
    assert.equal(r, core.renderAppBarHtml({ label: "Daily Challenge", links, overflow, extraHtml: `<div class="dc-appbar-row">x</div>` }), String(overflow));
  }
  assert.match(server.renderToStaticMarkup(React.createElement(mod.AppBar, { label: "A", overflow: "visible" })), /^<nav class="fm-appbar fm-appbar--menus"/);
  // 1.1.0: signIn as a render function gets the menu's close callback and renders the same markup as a plain node.
  let got = null;
  const fnSignIn = server.renderToStaticMarkup(React.createElement(mod.Masthead, { appName: "Live Agent", includeStyles: false,
    signIn: (close) => { got = close; return React.createElement("button", { type: "button", className: "fm-signin" }, "Signed in"); } }));
  assert.equal(typeof got, "function", "signIn render function receives close()");
  assert.equal(fnSignIn, core.renderMastheadHtml({ appName: "Live Agent", signInHtml: `<button type="button" class="fm-signin">Signed in</button>` }));
  assert.equal(fnSignIn.includes("data-fm-js"), false, "server markup has no data-fm-js (set after mount)");
  fs.rmSync(out, { force: true });
});

test("the gate page renders the shared masthead in every view", { skip: !esbuild && "esbuild/react not installed" }, async () => {
  const gate = path.join(ROOT, "..", "faraday-gate", "ui", "GatePage.tsx");
  if (!fs.existsSync(gate)) return;
  const out = path.join(ROOT, "test", ".gate.bundle.cjs");
  const mod = await bundle(gate, out);
  for (const view of ["request", "expired", "waitlist", "unavailable"]) {
    for (const email of [null, "a@b.co"]) {
      const html = server.renderToStaticMarkup(React.createElement(mod.default, { app: "jw", appName: "Jurisdiction Watch", view, email }));
      assert.match(html, /<header class="fm" role="banner"/);
      assert.equal((html.match(/<header/g) || []).length, 1);
      assert.match(html, /<main id="fg-main"/);
      assert.ok(email ? html.includes(`class="fm-user" title="${email}"`) : html.includes(`class="fm-signin">Sign in</button>`));
      assert.equal((html.match(/href="\/"/g) || []).length, 2, "mark + wordmark default to /");
    }
  }
  // faraday-gate 1.2.0: homeHref passes through to the masthead's mark and wordmark.
  const homed = server.renderToStaticMarkup(React.createElement(mod.default, { app: "jw", appName: "Jurisdiction Watch", view: "request", homeHref: "/jurisdiction-watch" }));
  assert.equal((homed.match(/href="\/jurisdiction-watch"/g) || []).length, 2, "homeHref reaches mark + wordmark");
  fs.rmSync(out, { force: true });
});
