import {
  PucDirectory,
  PUC_DIRECTORIES,
  PUC_DC_KEYWORDS,
  PRIORITY_STATE_FIPS,
} from './puc-directory';

const SUPABASE_URL =
  process.env.SUPABASE_URL || 'https://ycadmmngkdhvpcsrcuaq.supabase.co';

type Svc = { base: string; headers: Record<string, string> };

function getSvc(): Svc | null {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return null;
  return {
    base: `${SUPABASE_URL}/rest/v1`,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
  };
}

const UA = 'FaradayIntelligence/1.0 (research@faraday-intelligence.ai)';
const FETCH_TIMEOUT_MS = 15_000;

export async function crawlAllPucDockets(priorityOnly = false): Promise<void> {
  const svc = getSvc();
  if (!svc) throw new Error('SUPABASE_SERVICE_ROLE_KEY not set');

  const targets = priorityOnly
    ? PUC_DIRECTORIES.filter(d => PRIORITY_STATE_FIPS.has(d.state_fips))
    : PUC_DIRECTORIES;

  for (const puc of targets) {
    console.log(`PUC crawl: ${puc.state_abbr} — ${puc.agency_name}`);
    try {
      if (puc.api_available) {
        await crawlPucApi(puc, svc);
      } else {
        await crawlPucHtml(puc, svc);
      }
    } catch (e) {
      console.error(`PUC crawl failed for ${puc.state_abbr}:`, e);
    }
    await sleep(PRIORITY_STATE_FIPS.has(puc.state_fips) ? 1000 : 2000);
  }
}

// ── API-based crawl (AZ, TX) ──────────────────────────────────────────────────

async function crawlPucApi(puc: PucDirectory, svc: Svc): Promise<void> {
  const searchUrl = puc.search_url ?? puc.docket_url;
  for (const keyword of PUC_DC_KEYWORDS.slice(0, 5)) {
    const url = `${searchUrl}?keyword=${encodeURIComponent(keyword)}&limit=50`;
    try {
      const res = await fetchWithTimeout(url, { headers: { 'User-Agent': UA } });
      if (!res.ok) continue;
      const data: unknown = await res.json();
      const dockets: unknown[] = (data as Record<string, unknown>)?.items as unknown[] ??
                                 (data as Record<string, unknown>)?.dockets as unknown[] ??
                                 (Array.isArray(data) ? data : []);
      for (const docket of dockets) {
        await upsertDocket(puc, docket as Record<string, unknown>, svc);
      }
      await sleep(500);
    } catch (e) {
      console.error(`PUC API error ${puc.state_abbr} keyword="${keyword}":`, e);
    }
  }
}

// ── HTML / search-form crawl ──────────────────────────────────────────────────

async function crawlPucHtml(puc: PucDirectory, svc: Svc): Promise<void> {
  const searchUrl = puc.search_url ?? puc.docket_url;
  for (const keyword of PUC_DC_KEYWORDS.slice(0, 3)) {
    try {
      let html: string | null = null;

      try {
        const res = await fetchWithTimeout(searchUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': UA,
          },
          body: `keyword=${encodeURIComponent(keyword)}&dateFrom=&dateTo=`,
        });
        if (res.ok) html = await res.text();
      } catch { /* fall through to GET */ }

      if (!html) {
        const res = await fetchWithTimeout(
          `${searchUrl}?q=${encodeURIComponent(keyword)}`,
          { headers: { 'User-Agent': UA } },
        );
        if (res.ok) html = await res.text();
      }

      if (html) await parseHtmlDockets(puc, html, svc);
      await sleep(1500);
    } catch (e) {
      console.error(`PUC HTML error ${puc.state_abbr}:`, e);
    }
  }
}

// ── HTML docket extraction ────────────────────────────────────────────────────

const DOCKET_PATTERNS = [
  /(?:Docket|Case|No\.?)\s+([A-Z]?\d{4,8}[-A-Z0-9]*)/gi,
  /[A-Z]{1,3}-\d{4,6}/g,
];

async function parseHtmlDockets(
  puc: PucDirectory,
  html: string,
  svc: Svc,
): Promise<void> {
  const found = new Set<string>();
  for (const pattern of DOCKET_PATTERNS) {
    for (const m of html.matchAll(pattern)) {
      found.add(m[1]?.trim() ?? m[0].trim());
    }
  }

  const dcRelevantHtml = PUC_DC_KEYWORDS.some(kw =>
    new RegExp(kw, 'i').test(html),
  );

  for (const docketNumber of [...found].slice(0, 20)) {
    const res = await fetch(`${svc.base}/puc_dockets`, {
      method: 'POST',
      headers: {
        ...svc.headers,
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify({
        state_fips:    puc.state_fips,
        docket_number: docketNumber,
        dc_relevant:   dcRelevantHtml,
        source_url:    puc.docket_url,
        status:        'open',
      }),
    });
    if (!res.ok) {
      console.error(`upsert docket ${puc.state_abbr}/${docketNumber}: ${res.status}`);
    }
  }
}

// ── Structured upsert (API path) ──────────────────────────────────────────────

async function upsertDocket(
  puc: PucDirectory,
  docket: Record<string, unknown>,
  svc: Svc,
): Promise<void> {
  const title = String(docket.title ?? docket.name ?? '');
  const desc  = String(docket.description ?? '');
  const dcRelevant = PUC_DC_KEYWORDS.some(kw =>
    new RegExp(kw, 'i').test(title) || new RegExp(kw, 'i').test(desc),
  );

  const docketNumber = String(
    docket.id ?? docket.docketNumber ?? docket.case_number ?? '',
  );
  if (!docketNumber) return;

  const res = await fetch(`${svc.base}/puc_dockets`, {
    method: 'POST',
    headers: {
      ...svc.headers,
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify({
      state_fips:    puc.state_fips,
      docket_number: docketNumber,
      docket_title:  title || null,
      utility_name:  (docket.utility ?? docket.filer) as string | null ?? null,
      filed_date:    (docket.date ?? docket.filed_date) as string | null ?? null,
      status:        docket.status === 'closed' ? 'closed' : 'open',
      dc_relevant:   dcRelevant,
      source_url:    (docket.url as string | null) ?? puc.docket_url,
    }),
  });
  if (!res.ok) {
    console.error(`upsert API docket ${puc.state_abbr}/${docketNumber}: ${res.status}`);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
}
