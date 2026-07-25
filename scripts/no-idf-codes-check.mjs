// FAR-387 D5 — build guard: no raw IDF D-code or T-code may appear in a
// subscriber-facing string constant or JSX text node.
//
// Run: `npm run test:no-codes` (node --test). Fails the build when the pattern
// \b[DT]\d+(\.\d+)?\b is found in any scanned src file that is NOT on the
// internal-only allowlist below.
//
// Scanning strategy: we read each source file and STRIP the two constructs that
// legitimately contain the pattern without being subscriber copy —
//   1. comments (// … and /* … */), where code references like "D3/D4" live, and
//   2. data: URIs (base64 blobs), whose random payloads incidentally match —
// then test what remains (string constants + JSX text). This keeps the check
// honest: reintroduce `Domain D2` in real copy and it fails; a code comment or an
// icon data-URI does not.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SCAN_ROOT = fileURLToPath(new URL("../src", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

// The locked pattern from FAR-387 D5 — do not narrow it.
const CODE_RE = /\b[DT]\d+(\.\d+)?\b/;
const CODE_RE_G = /\b[DT]\d+(\.\d+)?\b/g;

const SCANNED_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs"]);

// Internal-only allowlist. Each entry is a repo-relative path prefix (file or
// directory) that is exempt, with the reason it is NOT subscriber-facing. Keep
// this list tight — a subscriber surface must never be added here.
const ALLOWLIST = [
  {
    path: "src/lib/idf-labels.ts",
    why: "The canonical code→name mapping module itself — the D-codes ARE its data, not display copy.",
  },
  {
    path: "src/lib/day-content.ts",
    why: "Server-only day-content sync. IDF codes are backend data, stripped before any subscriber read (see /api/challenge/day-content).",
  },
  {
    path: "src/lib/live-agent.ts",
    why: "Internal RAG retrieval lib. ifs_domain codes are backend corpus tags, never rendered to a subscriber.",
  },
  {
    path: "src/app/league-office",
    why: "Internal staff/admin console (League Office) — not a subscriber surface. Also carries ISO datetime literals like \"T12:00:00Z\".",
  },
  {
    path: "src/lib/league-office",
    why: "Internal League Office data layer. ISO datetime literals (\"T12:00:00Z\").",
  },
  {
    path: "src/lib/agenda-watch",
    why: "Internal ingestion pipeline. OData datetime filter strings (\"…T00:00:00\").",
  },
  {
    path: "src/lib/data365",
    why: "Internal ingestion pipeline — no subscriber output.",
  },
  {
    path: "src/lib/puc",
    why: "Internal ingestion pipeline — no subscriber output.",
  },
  {
    path: "src/lib/pipelines",
    why: "Internal ingestion pipeline — no subscriber output.",
  },
  {
    path: "src/lib/eia",
    why: "Internal ingestion pipeline — no subscriber output.",
  },
];

function isAllowlisted(relPath) {
  const norm = relPath.split(sep).join("/");
  // Test/spec files hold codes as fixtures, never as shipped copy.
  if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(norm)) {
    return { why: "Test/spec file — codes appear only as fixtures, never rendered." };
  }
  for (const entry of ALLOWLIST) {
    if (norm === entry.path || norm.startsWith(entry.path + "/")) return entry;
  }
  return null;
}

// Replace block comments with equal-length whitespace (preserving newlines so
// line numbers stay accurate), then blank out line comments (leaving `://` in
// URLs intact) and data: URIs.
function stripNonCopy(src) {
  const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  return noBlock
    .split("\n")
    .map((line) =>
      line
        .replace(/(^|[^:])\/\/.*$/, (_m, p1) => p1) // line comment, but keep https://
        .replace(/data:[^\s"'`)]+/g, "") // strip data: URIs (base64 blobs)
    )
    .join("\n");
}

function collectFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (name === "node_modules") continue;
      collectFiles(full, out);
    } else if (SCANNED_EXT.has(name.slice(name.lastIndexOf(".")))) {
      out.push(full);
    }
  }
  return out;
}

test("no raw IDF D-code / T-code in subscriber-facing src", () => {
  const violations = [];
  for (const full of collectFiles(SCAN_ROOT)) {
    const rel = relative(REPO_ROOT, full);
    if (isAllowlisted(rel)) continue;
    const cleaned = stripNonCopy(readFileSync(full, "utf8"));
    cleaned.split("\n").forEach((line, i) => {
      if (CODE_RE.test(line)) {
        const hits = line.match(CODE_RE_G).join(", ");
        violations.push(`${rel}:${i + 1}  →  ${hits}   ${line.trim().slice(0, 100)}`);
      }
    });
  }
  assert.equal(
    violations.length,
    0,
    `Raw IDF code(s) found in subscriber-facing source. Map them through ` +
      `resolveDomainName/resolveThemeName (src/lib/idf-labels.ts), or add the file ` +
      `to the internal-only allowlist with a reason.\n\n` +
      violations.map((v) => "  " + v).join("\n") +
      "\n"
  );
});

// Sanity: the allowlist must actually catch what it claims, and the detector must
// still fire on a genuine reintroduced code — so the guard can never silently pass.
test("guard detects a reintroduced code", () => {
  assert.ok(CODE_RE.test("Domain D2"), "detector must flag 'Domain D2'");
  assert.ok(CODE_RE.test("Theme T7 today"), "detector must flag a bare T-code");
  assert.ok(!CODE_RE.test("Domain: Power Architecture"), "must not flag plain names");
});
