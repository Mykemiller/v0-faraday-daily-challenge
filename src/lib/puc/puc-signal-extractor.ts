// PUC → IDF signal ingestor.
// Reads puc_filings that haven't been ingested into idf_signals yet
// and upserts them with source_type='puc'.

import { Svc } from '@/lib/pipeline-utils';

const BATCH_SIZE = 200;

export async function ingestPucSignalsToIdf(
  svc: Svc
): Promise<{ ingested: number; errors: number }> {
  let ingested = 0;
  let errors   = 0;
  let offset   = 0;

  while (true) {
    const r = await fetch(
      `${svc.base}/puc_filings?idf_ingested=eq.false` +
      `&select=id,state_code,docket_number,title,filing_date,filing_url,keywords_found` +
      `&limit=${BATCH_SIZE}&offset=${offset}`,
      { headers: svc.headers, cache: 'no-store' }
    );
    if (!r.ok) break;

    const filings: PucFilingRow[] = await r.json().catch(() => []);
    if (filings.length === 0) break;

    const idfRows = filings.map(f => ({
      source_type:  'puc' as const,
      signal_key:   `puc:${f.id}`,
      signal_type:  'regulatory_filing',
      title:        f.title ?? `PUC Docket ${f.docket_number}`,
      content:      `State: ${f.state_code} | Docket: ${f.docket_number} | Keywords: ${(f.keywords_found ?? []).join(', ')}`,
      metadata:     {
        state_code:    f.state_code,
        docket_number: f.docket_number,
        filing_url:    f.filing_url,
        filing_date:   f.filing_date,
      },
      ingested_at: new Date().toISOString(),
    }));

    const ins = await fetch(`${svc.base}/idf_signals`, {
      method:  'POST',
      headers: { ...svc.headers, Prefer: 'resolution=merge-duplicates,return=minimal' },
      body:    JSON.stringify(idfRows),
    });

    if (ins.ok) {
      const ids = filings.map(f => f.id);
      await fetch(
        `${svc.base}/puc_filings?id=in.(${ids.map(encodeURIComponent).join(',')})`,
        { method: 'PATCH', headers: svc.headers, body: JSON.stringify({ idf_ingested: true }) }
      );
      ingested += filings.length;
    } else {
      errors += filings.length;
    }

    if (filings.length < BATCH_SIZE) break;
    offset += BATCH_SIZE;
  }

  return { ingested, errors };
}

interface PucFilingRow {
  id:            string;
  state_code:    string;
  docket_number: string;
  title:         string | null;
  filing_date:   string | null;
  filing_url:    string | null;
  keywords_found: string[] | null;
}
