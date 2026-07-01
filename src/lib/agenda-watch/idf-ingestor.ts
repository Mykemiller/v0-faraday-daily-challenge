// AgendaWatch → IDF signal ingestor.
// Reads un-ingested agenda_watch_signals rows and upserts them into idf_signals.
// Marks each signal idf_ingested=true after a successful write.

import { Svc } from '@/lib/pipeline-utils';

const BATCH_SIZE = 200;

export async function ingestSignalsToIdf(svc: Svc): Promise<{ ingested: number; errors: number }> {
  let ingested = 0;
  let errors   = 0;
  let offset   = 0;

  while (true) {
    const r = await fetch(
      `${svc.base}/agenda_watch_signals?idf_ingested=eq.false` +
      `&select=id,jurisdiction_id,signal_type,signal_text,document_date,document_id` +
      `&limit=${BATCH_SIZE}&offset=${offset}`,
      { headers: svc.headers, cache: 'no-store' }
    );
    if (!r.ok) break;

    const signals: AgendaSignalRow[] = await r.json().catch(() => []);
    if (signals.length === 0) break;

    const idfRows = signals.map(s => ({
      source_type:     'agenda_watch' as const,
      jurisdiction_id: s.jurisdiction_id ?? null,
      signal_key:      `aw:${s.id}`,
      signal_type:     s.signal_type,
      title:           `AgendaWatch signal — ${s.signal_type}`,
      content:         s.signal_text ?? null,
      metadata:        { document_id: s.document_id, document_date: s.document_date },
      ingested_at:     new Date().toISOString(),
    }));

    const ins = await fetch(`${svc.base}/idf_signals`, {
      method:  'POST',
      headers: { ...svc.headers, Prefer: 'resolution=merge-duplicates,return=minimal' },
      body:    JSON.stringify(idfRows),
    });

    if (ins.ok) {
      // Mark source rows as ingested
      const ids = signals.map(s => s.id);
      await fetch(
        `${svc.base}/agenda_watch_signals?id=in.(${ids.map(encodeURIComponent).join(',')})`,
        { method: 'PATCH', headers: svc.headers, body: JSON.stringify({ idf_ingested: true }) }
      );
      ingested += signals.length;
    } else {
      errors += signals.length;
    }

    if (signals.length < BATCH_SIZE) break;
    offset += BATCH_SIZE;
  }

  return { ingested, errors };
}

interface AgendaSignalRow {
  id:              string;
  jurisdiction_id: string | null;
  signal_type:     string;
  signal_text:     string | null;
  document_date:   string | null;
  document_id:     string | null;
}
