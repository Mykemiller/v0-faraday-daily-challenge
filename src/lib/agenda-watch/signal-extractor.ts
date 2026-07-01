// AgendaWatch signal extractor.
// Uses keyword pattern matching + optional LLM classification to detect
// data-center-relevant signals in agenda / minutes text.
// Writes extracted signals to agenda_watch_signals.

import { Svc } from '@/lib/pipeline-utils';

const SIGNAL_PATTERNS: { type: string; patterns: RegExp[] }[] = [
  {
    type:     'zoning_approval',
    patterns: [/data\s*cent(?:er|re)/i, /hyperscal/i, /industrial\s+campus/i],
  },
  {
    type:     'utility_capacity',
    patterns: [/electrical\s+capacity/i, /substation/i, /transmission\s+line/i, /grid\s+expansion/i],
  },
  {
    type:     'opposition_motion',
    patterns: [/moratorium/i, /opposition/i, /deny\s+permit/i, /reject\s+application/i],
  },
  {
    type:     'incentive_approval',
    patterns: [/tax\s+abatement/i, /economic\s+incentive/i, /payment\s+in\s+lieu/i, /PILOT\b/],
  },
  {
    type:     'permitting_update',
    patterns: [/special\s+use\s+permit/i, /conditional\s+use/i, /site\s+plan\s+approval/i],
  },
];

interface AgendaWatchDoc {
  id:              string;
  jurisdiction_id: string;
  document_date:   string | null;
  document_type:   string;
  title:           string;
}

export async function extractSignals(
  doc: AgendaWatchDoc,
  text: string,
  svc: Svc
): Promise<number> {
  const signals = detectSignals(text, doc);
  if (signals.length === 0) return 0;

  let inserted = 0;
  for (const signal of signals) {
    const r = await fetch(`${svc.base}/agenda_watch_signals`, {
      method:  'POST',
      headers: { ...svc.headers, Prefer: 'resolution=ignore-duplicates,return=minimal' },
      body:    JSON.stringify({
        document_id:     doc.id,
        jurisdiction_id: doc.jurisdiction_id,
        signal_type:     signal.type,
        signal_text:     signal.excerpt,
        document_date:   doc.document_date,
        extracted_at:    new Date().toISOString(),
        idf_ingested:    false,
      }),
    });
    if (r.ok) inserted++;
  }
  return inserted;
}

interface DetectedSignal {
  type:    string;
  excerpt: string;
}

function detectSignals(text: string, _doc: AgendaWatchDoc): DetectedSignal[] {
  const results: DetectedSignal[] = [];
  const sentences = text.match(/[^.!?\n]{10,500}[.!?\n]/g) ?? [];

  for (const sentence of sentences) {
    for (const { type, patterns } of SIGNAL_PATTERNS) {
      if (patterns.some(p => p.test(sentence))) {
        results.push({ type, excerpt: sentence.trim().slice(0, 500) });
        break; // one type per sentence
      }
    }
  }

  // Deduplicate by type + first 100 chars of excerpt
  const seen = new Set<string>();
  return results.filter(s => {
    const key = `${s.type}:${s.excerpt.slice(0, 100)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
