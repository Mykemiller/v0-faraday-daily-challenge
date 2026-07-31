#!/usr/bin/env node
// ============================================================================
// idf4-propagate-poller-domains.mjs
//
// CC-IDF4-SUBDOMAIN-COVERAGE-1.0 Phase 1, step 1 (history backfill).
//
// DRY-RUN BY DEFAULT. Nothing is written unless --write is passed.
//
// PROBLEM (Phase 0): `source-poller` writes each source's curated domain tags
// into artifacts.signal_envelope->'idf_domains' but never into the
// artifacts.ifs_domains column that every coverage query reads. 250,067 of
// 250,067 poller rows carry the tags in the same row yet report as untagged.
//
// This script copies the tags into the column for EXISTING rows. New rows are
// handled by trg_artifacts_fill_ifs_domains (migration 20260731000001), which
// must be applied first — otherwise the poller keeps producing untagged rows
// faster than this script can drain them.
//
// ZERO MODEL SPEND. This is a mechanical copy within each row; no inference,
// no external calls, no classification decisions.
//
// SAFETY:
//   * Only touches rows where ifs_domains is NULL or empty. Never overwrites.
//   * Only writes well-formed parent-domain codes (^D\d+$). Sub-domain codes
//     (D#.#) and free-text legacy tags are skipped — sub-domain routing is
//     splitIfsTags()' job (Phase 1 step 2).
//   * Never touches ifs_subdomains, so it cannot trip
//     trg_artifacts_validate_ifs_subdomains.
//   * Self-terminating and resumable: each pass re-queries the still-untagged
//     set, so an interrupted run simply resumes where it stopped.
//
// Usage:
//   node scripts/idf4-propagate-poller-domains.mjs              # dry run
//   node scripts/idf4-propagate-poller-domains.mjs --write
//   node scripts/idf4-propagate-poller-domains.mjs --write --max=50000
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  (both required)
// ============================================================================

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const hit = args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return dflt;
  return hit.includes("=") ? hit.split("=")[1] : true;
};
const WRITE = flag("write", false) === true;
const MAX = Number(flag("max", 0)) || 0; // 0 = no cap
const PAGE = 1000; // rows fetched per pass
const PATCH_CHUNK = 400; // artifact_ids per PATCH request

const DOMAIN_RE = /^D\d+$/;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  process.exit(1);
}

const rest = async (path, init = {}) => {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      authorization: `Bearer ${SERVICE_KEY}`,
      "content-type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    throw new Error(`${init.method || "GET"} ${path} → ${res.status} ${await res.text()}`);
  }
  return res;
};

/** Rows still missing a domain tag. `ifs_domains` is nullable, so match both
 *  NULL and the empty array. */
const UNTAGGED =
  "or=(ifs_domains.is.null,ifs_domains.eq.{})" +
  "&crawler_id=like.source-poller*";

/** Extract the well-formed parent-domain codes from an artifact's envelope. */
function codesFrom(envelope) {
  const raw = envelope?.idf_domains;
  if (!Array.isArray(raw)) return null;
  const codes = [...new Set(raw.map((c) => String(c).trim()).filter((c) => DOMAIN_RE.test(c)))].sort();
  return codes.length ? codes : null;
}

async function countUntagged() {
  const res = await rest(`artifacts?${UNTAGGED}&select=artifact_id`, {
    method: "HEAD",
    headers: { prefer: "count=exact", range: "0-0" },
  });
  const cr = res.headers.get("content-range") || "";
  return Number(cr.split("/")[1] || 0);
}

async function fetchPage() {
  const res = await rest(
    `artifacts?${UNTAGGED}&select=artifact_id,signal_envelope&order=artifact_id.asc&limit=${PAGE}`,
  );
  return res.json();
}

/** Group artifact_ids by identical code-set so each PATCH carries one value. */
function groupByCodeSet(rows) {
  const groups = new Map();
  let skipped = 0;
  for (const row of rows) {
    const codes = codesFrom(row.signal_envelope);
    if (!codes) {
      skipped++;
      continue;
    }
    const key = codes.join(",");
    if (!groups.has(key)) groups.set(key, { codes, ids: [] });
    groups.get(key).ids.push(row.artifact_id);
  }
  return { groups, skipped };
}

async function writeGroup(codes, ids) {
  let written = 0;
  for (let i = 0; i < ids.length; i += PATCH_CHUNK) {
    const chunk = ids.slice(i, i + PATCH_CHUNK);
    const list = chunk.map((id) => `"${id}"`).join(",");
    await rest(`artifacts?artifact_id=in.(${list})`, {
      method: "PATCH",
      headers: { prefer: "return=minimal" },
      body: JSON.stringify({ ifs_domains: codes }),
    });
    written += chunk.length;
  }
  return written;
}

async function main() {
  const total = await countUntagged();
  console.log(`untagged source-poller artifacts: ${total.toLocaleString()}`);
  console.log(WRITE ? "MODE: WRITE" : "MODE: DRY RUN (pass --write to apply)");

  if (total === 0) {
    console.log("nothing to do.");
    return;
  }

  const sample = await fetchPage();
  const { groups, skipped } = groupByCodeSet(sample);

  console.log(`\nsample of ${sample.length} rows → ${groups.size} distinct code-sets:`);
  for (const [key, g] of [...groups.entries()].sort((a, b) => b[1].ids.length - a[1].ids.length).slice(0, 15)) {
    console.log(`  {${key}}  ×${g.ids.length}`);
  }
  if (skipped) console.log(`  (${skipped} rows carried no usable D# code — left untouched)`);

  if (!WRITE) {
    console.log(
      `\nDRY RUN — no writes issued. Re-run with --write to tag ${total.toLocaleString()} rows.`,
    );
    return;
  }

  let done = 0;
  let pass = 0;
  for (;;) {
    const rows = pass === 0 ? sample : await fetchPage();
    if (!rows.length) break;

    const { groups: g, skipped: sk } = groupByCodeSet(rows);
    if (g.size === 0) {
      console.log(`pass ${pass}: ${sk} unusable rows and nothing writable — stopping.`);
      break;
    }

    for (const { codes, ids } of g.values()) {
      done += await writeGroup(codes, ids);
    }
    pass++;
    console.log(`pass ${pass}: ${done.toLocaleString()} / ${total.toLocaleString()} tagged`);

    if (MAX && done >= MAX) {
      console.log(`--max=${MAX} reached; stopping early (resumable).`);
      break;
    }
  }

  const remaining = await countUntagged();
  console.log(`\ndone. tagged ${done.toLocaleString()}; ${remaining.toLocaleString()} still untagged.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
