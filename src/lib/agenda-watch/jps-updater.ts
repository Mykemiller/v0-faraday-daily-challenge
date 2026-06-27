// Aggregate agenda_watch_signals for a jurisdiction and write recency-weighted
// JPS dimension scores back to the jurisdictions row.
//
// Sentiment range: -1.0 → +1.0 (opposition → support)
// JPS dimension scale: 0 → 5 (hostile → permissive)
// Mapping: dim = (avgSentiment + 1) / 2 * 5

import type { AgendaWatchDb, Row } from './db-client';

const LOOKBACK_DAYS = 180;

export async function updateJpsDimensionsFromSignals(
  jurisdictionId: string,
  db: AgendaWatchDb,
): Promise<void> {
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString();

  const { data: signals, error } = await db
    .from('agenda_watch_signals')
    .select('jps_dimension, sentiment_score, extracted_at, signal_type')
    .eq('jurisdiction_id', jurisdictionId)
    .gte('extracted_at', since)
    .run();

  if (error || !signals || signals.length === 0) return;

  const dimScores: Record<string, number> = {};
  const dimWeights: Record<string, number> = {};

  for (const raw of signals) {
    const sig = raw as Row & {
      jps_dimension:   string | null;
      sentiment_score: number | null;
      extracted_at:    string;
    };

    if (!sig.jps_dimension || sig.sentiment_score === null) continue;

    const ageDays = (Date.now() - new Date(sig.extracted_at).getTime()) / 86_400_000;
    const weight  = ageDays < 30 ? 1.0 : ageDays < 90 ? 0.7 : 0.4;

    dimScores[sig.jps_dimension]  = (dimScores[sig.jps_dimension]  ?? 0) + sig.sentiment_score * weight;
    dimWeights[sig.jps_dimension] = (dimWeights[sig.jps_dimension] ?? 0) + weight;
  }

  const updates: Record<string, number> = {};
  for (const [dim, scoreSum] of Object.entries(dimScores)) {
    const avg = scoreSum / (dimWeights[dim] ?? 1);
    updates[dim] = parseFloat(((avg + 1) / 2 * 5).toFixed(2));
  }

  if (Object.keys(updates).length === 0) return;

  const { error: updateErr } = await db
    .from('jurisdictions')
    .update({ ...updates, last_scored_at: new Date().toISOString() })
    .eq('id', jurisdictionId)
    .run();

  if (updateErr) console.error(`jps-updater: jurisdiction ${jurisdictionId} update failed:`, updateErr);
}
