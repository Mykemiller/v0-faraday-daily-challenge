// GET /api/lexicon?term=BUSBAR — Faraday Lexicon lookup (Airtable). Ported from
// the brand site's api/lexicon.js. Requires env: AIRTABLE_API_KEY (+ optional
// AIRTABLE_BASE_ID, defaults to the Faraday base).
//
// GET /api/lexicon?list=1 — browsable list mode (FAR-408 glossary page): returns
// every defined term, alphabetized. Pages through Airtable's 100-row windows.

const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID || "appxfti7VuoHYUeu6";
const AIRTABLE_TABLE_ID = "tblibfOpAa5wh0dA5"; // Lexicon

// Airtable read cache — the glossary is slow-moving; revalidate hourly.
export const revalidate = 3600;

interface LexiconRow { term: string; definition: string; domain: string | null }

async function fetchAllTerms(apiKey: string): Promise<LexiconRow[]> {
  const out: LexiconRow[] = [];
  let offset: string | undefined;
  // Hard page cap (Airtable is 100/page) so a runaway never loops forever.
  for (let page = 0; page < 20; page++) {
    const params = new URLSearchParams({ pageSize: "100" });
    params.append("sort[0][field]", "Term");
    params.append("sort[0][direction]", "asc");
    if (offset) params.set("offset", offset);
    const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_ID}?${params.toString()}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!res.ok) throw new Error(`Airtable list failed: ${res.status}`);
    const data = await res.json();
    for (const rec of data?.records ?? []) {
      const term = (rec.fields?.Term || "").trim();
      const definition = (rec.fields?.Definition || "").trim();
      if (term && definition) out.push({ term, definition, domain: rec.fields?.Domain || null });
    }
    offset = data?.offset;
    if (!offset) break;
  }
  return out;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const apiKey = process.env.AIRTABLE_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "Server not configured: AIRTABLE_API_KEY missing" }, { status: 500 });
  }

  // ── List mode — the browsable glossary ────────────────────────────────────
  if (searchParams.get("list")) {
    try {
      const terms = await fetchAllTerms(apiKey);
      return Response.json({ terms, count: terms.length, source: "Faraday Lexicon" });
    } catch (err) {
      return Response.json({ error: "Lexicon list failed", detail: (err as Error).message }, { status: 502 });
    }
  }

  // ── Single-term lookup (original contract) ────────────────────────────────
  const term = (searchParams.get("term") || "").trim().toUpperCase();
  if (!term) return Response.json({ error: "Missing required query param: term" }, { status: 400 });

  try {
    const formula = encodeURIComponent(`UPPER({Term}) = "${term.replace(/"/g, '\\"')}"`);
    const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_ID}?filterByFormula=${formula}&maxRecords=1`;
    const response = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });

    if (!response.ok) {
      return Response.json({ error: "Airtable lookup failed", status: response.status }, { status: 502 });
    }

    const data = await response.json();
    const record = data?.records?.[0];
    if (!record) {
      return Response.json({
        term,
        definition: null,
        found: false,
        message: "Term not yet in Lexicon. Faraday is adding new terms daily.",
      });
    }

    return Response.json({
      term: record.fields.Term,
      definition: record.fields.Definition || "No definition available.",
      domain: record.fields.Domain || null,
      source: "Faraday Lexicon",
      found: true,
    });
  } catch (err) {
    return Response.json({ error: "Internal error", detail: (err as Error).message }, { status: 500 });
  }
}
