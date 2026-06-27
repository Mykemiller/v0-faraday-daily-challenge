// IDF ingestion — writes aggregated opposition signals from data365_opposition_signals
// into idf_signals with source_type='data365_facebook'.
// Only processes records where idf_ingested=false (idempotent; re-runnable).

import { svc, dbSelect, dbInsert, dbPatch } from './svc';

interface OppositionSignalRow {
  id:                 string;
  jurisdiction_id:    string;
  signal_date:        string;
  post_count:         number;
  weighted_sentiment: number | null;
  opposition_posts:   number;
  support_posts:      number;
  jurisdictions:      { name: string; iso_code: string } | null;
}

function signalType(
  weightedSentiment: number | null,
): 'community_opposition' | 'community_support' | 'community_neutral' {
  if (weightedSentiment === null) return 'community_neutral';
  if (weightedSentiment < -0.2) return 'community_opposition';
  if (weightedSentiment > 0.2)  return 'community_support';
  return 'community_neutral';
}

export async function ingestData365ToIdf(batchLimit = 500): Promise<void> {
  const s = svc();

  const signals = await dbSelect<OppositionSignalRow>(
    s,
    'data365_opposition_signals',
    `idf_ingested=eq.false` +
    `&select=id,jurisdiction_id,signal_date,post_count,weighted_sentiment,` +
    `opposition_posts,support_posts,jurisdictions(name,iso_code)` +
    `&limit=${batchLimit}`,
  );

  if (signals.length === 0) {
    console.log('Data365 IDF ingestion: nothing to ingest');
    return;
  }

  const idfRecords = signals.map(sig => ({
    source_type: 'data365_facebook',
    source_id:   sig.id,
    raw_text:
      `Facebook community signal for ${sig.jurisdictions?.name ?? sig.jurisdiction_id}: ` +
      `${sig.post_count} data center posts, ` +
      `weighted sentiment ${(sig.weighted_sentiment ?? 0).toFixed(2)}, ` +
      `${sig.opposition_posts} opposition / ${sig.support_posts} support posts.`,
    signal_type:     signalType(sig.weighted_sentiment),
    jps_dimension:   'dim_opposition',
    sentiment_score: sig.weighted_sentiment ?? null,
    county_fips5:    sig.jurisdictions?.iso_code ?? null,
    signal_date:     sig.signal_date,
    ingested_at:     new Date().toISOString(),
  }));

  await dbInsert(s, 'idf_signals', idfRecords);

  await dbPatch(
    s,
    'data365_opposition_signals',
    `id=in.(${signals.map(s => s.id).join(',')})`,
    { idf_ingested: true },
  );

  console.log(`Data365 IDF: ${idfRecords.length} signals ingested`);
}
