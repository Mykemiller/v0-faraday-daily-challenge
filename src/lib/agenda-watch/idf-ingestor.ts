// Write un-ingested agenda_watch_signals to the idf_signals table for
// classifier training / continuous learning. Marks rows idf_ingested=true
// after a successful batch write so reruns are safe.

import type { AgendaWatchDb, Row } from './db-client';

// PostgREST embedded-resource select — pulls through the FK chain:
//   agenda_watch_signals → agenda_watch_documents → agenda_watch_entities
const SIGNAL_SELECT = [
  'id',
  'signal_text',
  'signal_type',
  'sentiment_score',
  'jps_dimension',
  'confidence',
  'agenda_watch_documents!inner(',
  '  meeting_date,',
  '  meeting_body,',
  '  entity_id,',
  '  agenda_watch_entities!inner(entity_name,state_fips,county_fips5)',
  ')',
].join('');

export async function ingestSignalsToIdf(
  db: AgendaWatchDb,
  batchSize = 500,
): Promise<void> {
  const { data: signals, error } = await db
    .from('agenda_watch_signals')
    .select(SIGNAL_SELECT)
    .eq('idf_ingested', false)
    .limit(batchSize)
    .run();

  if (error || !signals || signals.length === 0) {
    if (error) console.error('ingestSignalsToIdf: fetch failed:', error);
    return;
  }

  const idfRecords = signals.map(raw => {
    const sig = raw as Row & {
      id:              string;
      signal_text:     string;
      signal_type:     string | null;
      sentiment_score: number | null;
      jps_dimension:   string | null;
      confidence:      number | null;
      agenda_watch_documents?: Row & {
        meeting_date:  string | null;
        meeting_body:  string | null;
        agenda_watch_entities?: Row & {
          entity_name: string | null;
          state_fips:  string | null;
          county_fips5: string | null;
        };
      };
    };

    const doc    = sig.agenda_watch_documents;
    const entity = doc?.agenda_watch_entities;

    return {
      source_type:            'agenda_watch_replication',
      source_id:              sig.id,
      raw_text:               sig.signal_text,
      signal_type:            sig.signal_type     ?? null,
      jps_dimension:          sig.jps_dimension   ?? null,
      sentiment_score:        sig.sentiment_score ?? null,
      classifier_confidence:  sig.confidence      ?? null,
      state_fips:             entity?.state_fips  ?? null,
      county_fips5:           entity?.county_fips5 ?? null,
      meeting_date:           doc?.meeting_date    ?? null,
      entity_name:            entity?.entity_name  ?? null,
      ingested_at:            new Date().toISOString(),
    };
  });

  const { error: insertErr } = await db.from('idf_signals').insert(idfRecords).run();
  if (insertErr) {
    console.error('ingestSignalsToIdf: idf_signals insert failed:', insertErr);
    return;
  }

  const { error: markErr } = await db
    .from('agenda_watch_signals')
    .update({ idf_ingested: true, idf_ingested_at: new Date().toISOString() })
    .in('id', signals.map(s => (s as Row & { id: string }).id))
    .run();

  if (markErr) console.error('ingestSignalsToIdf: mark-ingested failed:', markErr);
  else console.log(`IDF ingestion: ${idfRecords.length} signals written`);
}
