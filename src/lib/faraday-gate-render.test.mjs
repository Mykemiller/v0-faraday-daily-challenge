// FDY-414 (ADM-1.7) — renders the vendored GatePage under this app's React (19) in every view and
// greps the HTML for a price or "$". Adapted from faraday-workbench/packages/faraday-gate/test/render.test.mjs:
// that one bundles with esbuild, which this repo does not install, so the .tsx is compiled with the
// TypeScript compiler this repo already ships (devDependency) into node_modules/.cache, where `react`
// resolves. Run: npm run test:faraday-gate
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const VENDOR = path.join(HERE, "faraday-gate");
const require = createRequire(path.join(ROOT, "package.json"));
const ts = require("typescript");
const React = require("react");
const server = require("react-dom/server");

function compile(outDir) {
  for (const rel of ["core.ts", "ui/GatePage.tsx"]) {
    const src = fs.readFileSync(path.join(VENDOR, rel), "utf8");
    const out = ts.transpileModule(src, {
      fileName: rel,
      compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true, rewriteRelativeImportExtensions: true,
      },
    }).outputText;
    const dest = path.join(outDir, rel.replace(/\.tsx?$/, ".js"));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, out);
  }
  fs.writeFileSync(path.join(outDir, "package.json"), '{"type":"commonjs"}\n');
  return createRequire(path.join(outDir, "ui", "GatePage.js"))("./GatePage.js").default;
}

test("GatePage renders under React " + React.version + " with no price or $ in any view", () => {
  const outDir = fs.mkdtempSync(path.join(ROOT, "node_modules", ".cache-faraday-gate-"));
  try {
    const GatePage = compile(outDir);
    const approved = { access_key: "predicts", status: "approved", app_name: "Faraday Predicts", story: "A story.", what_you_get: ["a", "b", "c"] };
    for (const view of ["request", "expired", "waitlist", "unavailable"]) {
      for (const email of [null, "someone@example.com"]) {
        const html = server.renderToStaticMarkup(React.createElement(GatePage, { app: "predicts", appName: "Faraday Predicts", version: "3.0", copy: approved, view, email }));
        const visible = html.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<link[^>]*>/g, "");
        assert.equal(visible.includes("$"), false, `$ in ${view}`);
        assert.equal(/USD|€|£|per month|\/mo\b|tokens?\b/i.test(visible), false, `price-like text in ${view}`);
        assert.ok(visible.includes("monthly subscription"), "commercial line present");
        if (view === "expired") assert.ok(visible.includes("Your 14-day demo has ended") && visible.includes("Ask for more time"));
        if (view === "waitlist") assert.equal(visible.includes("Request demo access"), false, "no demo button in waitlist mode");
        if (view !== "unavailable" && view !== "waitlist") assert.ok(visible.includes("Join the waitlist"));
        if (email) assert.ok(visible.includes(email)); else assert.ok(visible.includes("Sign in"));
        assert.ok(visible.includes("v3.0") && visible.includes("Terms") && visible.includes("Privacy"));
      }
    }
    // The real Predicts copy file is still draft: its story must not render; the neutral text must.
    const draft = JSON.parse(fs.readFileSync(path.join(VENDOR, "gate-copy", "predicts.json"), "utf8"));
    const html = server.renderToStaticMarkup(React.createElement(GatePage, { app: "predicts", appName: "Faraday Predicts", copy: draft, view: "request" }));
    if (draft.status === "draft") {
      assert.equal(html.includes(draft.story), false, "draft copy never renders");
      assert.ok(html.includes("Faraday Predicts is in a private beta."));
    }
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});
