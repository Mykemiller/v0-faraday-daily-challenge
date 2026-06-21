// GET /api/lexicon?term=BUSBAR — Faraday Lexicon lookup (Airtable). Ported from
// the brand site's api/lexicon.js. Requires env: AIRTABLE_API_KEY (+ optional
// AIRTABLE_BASE_ID, defaults to the Faraday base).

const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID || "appxfti7VuoHYUeu6";
const AIRTABLE_TABLE_ID = "tblibfOpAa5wh0dA5"; // Lexicon

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const term = (searchParams.get("term") || "").trim().toUpperCase();
  if (!term) return Response.json({ error: "Missing required query param: term" }, { status: 400 });

  const apiKey = process.env.AIRTABLE_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "Server not configured: AIRTABLE_API_KEY missing" }, { status: 500 });
  }

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
