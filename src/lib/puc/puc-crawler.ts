// PUC docket crawler.
// Scrapes state Public Utility Commission dockets for data-center-relevant filings.
// Priority states: TX, VA, GA, NC, FL, AZ, CO, IL, OH, PA.
// Writes new filings to puc_filings.

import { Svc } from '@/lib/pipeline-utils';

const PRIORITY_STATES = ['TX', 'VA', 'GA', 'NC', 'FL', 'AZ', 'CO', 'IL', 'OH', 'PA'];

// Known PUC docket endpoints by state
const PUC_ENDPOINTS: Record<string, { name: string; url: string; type: 'rss' | 'json' | 'html' }> = {
  TX: { name: 'PUCT',  url: 'https://interchange.puc.texas.gov/Documents/search.ashx', type: 'json' },
  VA: { name: 'SCC',   url: 'https://www.scc.virginia.gov/cgi-bin/review.cgi',         type: 'html' },
  GA: { name: 'PSC',   url: 'https://psc.ga.gov/search/results/',                      type: 'html' },
  NC: { name: 'NCUC',  url: 'https://www.dockets.ncruc.gov/ViewCase.aspx',             type: 'html' },
  FL: { name: 'FPSC',  url: 'https://www.floridapsc.com/FilingCenter/Search',          type: 'html' },
  AZ: { name: 'ACC',   url: 'https://edocket.azcc.gov/api/docket/search',              type: 'json' },
  CO: { name: 'COPUC', url: 'https://www.dora.state.co.us/pls/efi/efidocs.results_pkg', type: 'html' },
  IL: { name: 'ICC',   url: 'https://www.icc.illinois.gov/docket',                     type: 'html' },
  OH: { name: 'PUCO',  url: 'https://dis.puc.state.oh.us/TacixSearch.aspx',            type: 'html' },
  PA: { name: 'PaPUC', url: 'https://www.puc.pa.gov/filing-resources/issuing-search',  type: 'html' },
};

// Keywords that indicate data-center relevance in PUC filings
const DC_KEYWORDS = [
  'data center', 'data centre', 'hyperscale', 'co-location', 'colocation',
  'large load', 'transmission', 'interconnection', 'substation expansion',
  'generation interconnection',
];

export interface PucCrawlResult {
  states:   number;
  filings:  number;
  inserted: number;
  errors:   number;
}

export async function crawlAllPucDockets(
  priorityOnly: boolean,
  svc: Svc
): Promise<PucCrawlResult> {
  const states = priorityOnly ? PRIORITY_STATES : Object.keys(PUC_ENDPOINTS);
  const result: PucCrawlResult = { states: states.length, filings: 0, inserted: 0, errors: 0 };

  for (const stateCode of states) {
    const endpoint = PUC_ENDPOINTS[stateCode];
    if (!endpoint) continue;

    try {
      const filings = await fetchStateFilings(stateCode, endpoint);
      result.filings += filings.length;

      for (const filing of filings) {
        const r = await fetch(`${svc.base}/puc_filings`, {
          method:  'POST',
          headers: { ...svc.headers, Prefer: 'resolution=ignore-duplicates,return=minimal' },
          body:    JSON.stringify({
            state_code:    stateCode,
            puc_name:      endpoint.name,
            docket_number: filing.docketNumber,
            title:         filing.title,
            filing_date:   filing.date,
            filing_url:    filing.url,
            keywords_found: filing.keywords,
            crawled_at:    new Date().toISOString(),
          }),
        });
        if (r.ok) result.inserted++;
      }
    } catch (err) {
      console.error(`[puc/crawl] state ${stateCode} error`, err);
      result.errors++;
    }
  }

  return result;
}

interface PucFiling {
  docketNumber: string;
  title:        string;
  date:         string | null;
  url:          string;
  keywords:     string[];
}

async function fetchStateFilings(
  stateCode: string,
  endpoint: { url: string; type: string }
): Promise<PucFiling[]> {
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);

  try {
    const r = await fetch(endpoint.url, {
      headers: { 'User-Agent': 'Faraday-PUCCrawler/1.0' },
      signal:  AbortSignal.timeout(15_000),
    });
    if (!r.ok) return [];

    const text = await r.text();
    return parseFilingsText(stateCode, text, since);
  } catch {
    return [];
  }
}

function parseFilingsText(stateCode: string, text: string, _since: string): PucFiling[] {
  const results: PucFiling[] = [];
  const lines = text.split('\n');

  for (const line of lines) {
    const lc = line.toLowerCase();
    const matched = DC_KEYWORDS.filter(kw => lc.includes(kw));
    if (matched.length === 0) continue;

    // Best-effort docket number extraction (format varies by state)
    const docketMatch = line.match(/\b(?:case|docket|no\.?)\s*[\w-]+\d+/i) ??
                        line.match(/\b\d{2}[-–]\d{4,6}\b/);
    if (!docketMatch) continue;

    results.push({
      docketNumber: docketMatch[0].trim(),
      title:        line.trim().slice(0, 300),
      date:         null,
      url:          '',
      keywords:     matched,
    });
  }

  return results;
}
