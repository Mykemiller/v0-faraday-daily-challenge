// Applies keyword + sentiment pattern matching to extracted document text,
// producing agenda_watch_signals rows keyed to IDF 4.0 JPS dimensions.
// Each signal is a 500-char passage that matched at least one dimension pattern.

import type { AgendaWatchDb, Row } from './db-client';

// Regex patterns keyed to JPS dimension
const SIGNAL_PATTERNS: Record<string, RegExp[]> = {
  dim_regulatory: [
    /data\s+center/i,
    /moratorium/i,
    /zoning.{0,30}(?:amend|change|varianc)/i,
    /(?:permit|license).{0,30}(?:approv|deni|grant)/i,
    /land\s+use\s+(?:plan|code)/i,
    /(?:ordinance|resolution).{0,30}(?:data|AI|digital|tech)/i,
  ],
  dim_permitting: [
    /building\s+permit/i,
    /site\s+plan/i,
    /conditional\s+use/i,
    /special\s+use\s+permit/i,
    /variance/i,
    /environmental\s+review/i,
    /grading\s+permit/i,
    /utility\s+permit/i,
  ],
  dim_power: [
    /(?:power|electric|energy|utility).{0,30}(?:capacity|demand|load|constraint)/i,
    /interconnect/i,
    /substation/i,
    /transmission/i,
    /megawatt|MW\b/i,
    /\bgrid\b/i,
    /renewable/i,
    /rate\s+case/i,
  ],
  dim_opposition: [
    /(?:oppose|opposition|object|protest|concern)/i,
    /(?:community|resident|neighbor).{0,40}(?:concern|worry|fear|fight)/i,
    /\bpetition\b/i,
    /public\s+comment/i,
    /negative\s+impact/i,
    /(?:noise|traffic|water\s+(?:use|consumption))/i,
  ],
  dim_incentives: [
    /tax\s+(?:abatement|exemption|credit|incentive)/i,
    /economic\s+development/i,
    /enterprise\s+zone/i,
    /\bTIF\b|tax\s+increment/i,
    /\bgrant\b/i,
    /incentive\s+(?:package|agreement)/i,
    /\bMOU\b|memorandum\s+of\s+understanding/i,
  ],
};

const OPPOSITION_SIGNALS = [
  /oppose/i, /against/i, /reject/i, /deni/i, /prohibit/i,
  /concern/i, /worry/i, /risk/i, /harm/i, /impact/i,
];
const SUPPORT_SIGNALS = [
  /approv/i, /support/i, /favor/i, /welcom/i, /enabl/i,
  /grant/i,  /incentiv/i, /promot/i, /attract/i, /partner/i,
];

function sentimentScore(window: string): number {
  const opp = OPPOSITION_SIGNALS.filter(p => p.test(window)).length;
  const sup = SUPPORT_SIGNALS.filter(p => p.test(window)).length;
  const total = opp + sup;
  if (total === 0) return 0;
  return parseFloat(((sup - opp) / total).toFixed(3));
}

function signalType(
  window: string,
  sentiment: number,
): string {
  if (/moratorium|prohibit/i.test(window))          return 'moratorium';
  if (/vote|approv|deni/i.test(window))             return 'data_center_vote';
  if (/zoning|zone/i.test(window))                  return 'zoning_change';
  if (/public\s+comment|testif/i.test(window))
    return sentiment < 0 ? 'opposition_testimony' : 'support_testimony';
  if (/tax|incentiv|abat/i.test(window))
    return sentiment < 0 ? 'incentive_denial' : 'incentive_approval';
  if (/power|electric|grid|\bMW\b/i.test(window))  return 'utility_discussion';
  if (/permit/i.test(window))                       return 'permit_discussion';
  return 'general_sentiment';
}

export async function extractSignals(
  document: Row & { id: string; jurisdiction_id: string },
  text: string,
  db: AgendaWatchDb,
): Promise<number> {
  if (!text || text.length < 100) return 0;

  // 500-char overlapping windows (step 400)
  const windows: string[] = [];
  for (let i = 0; i < text.length; i += 400) {
    windows.push(text.slice(i, i + 500));
  }

  const signals: Row[] = [];

  for (const window of windows) {
    for (const [dimension, patterns] of Object.entries(SIGNAL_PATTERNS)) {
      for (const pattern of patterns) {
        if (!pattern.test(window)) continue;

        const score = sentimentScore(window);
        const type  = signalType(window, score);

        signals.push({
          document_id:     document.id,
          jurisdiction_id: document.jurisdiction_id,
          signal_type:     type,
          signal_text:     window.slice(0, 500),
          sentiment_score: score,
          confidence:      Math.min(0.95, 0.5 + patterns.length * 0.05),
          jps_dimension:   dimension,
          idf_ingested:    false,
        });
        break; // one signal per dimension per window
      }
    }
  }

  if (signals.length > 0) {
    const { error } = await db.from('agenda_watch_signals').insert(signals).run();
    if (error) console.error('extractSignals insert error:', error);
  }

  return signals.length;
}
