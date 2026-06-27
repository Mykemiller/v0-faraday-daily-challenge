// Opposition Signal Ingestion Pipeline (JPS dim_opposition)
// Sources: local news RSS, Citizen Portal AI, Facebook public groups (Data365),
//          county meeting minutes.
//
// Aggregates signals into a recency-weighted sentiment score, then maps
// to a JPS dimension value (0–5 scale) and updates jurisdictions.dim_opposition.
//
// Sentiment convention: -1.0 = strong opposition, +1.0 = strong support
// JPS mapping: (sentiment + 1) / 2 × 5
//   Strong opposition (−1.0) → 0.0 (dim_opposition at floor)
//   Neutral (0.0)            → 2.5
//   Strong support (+1.0)   → 5.0

export type OppositionSource =
  | 'local_news'
  | 'citizen_portal'
  | 'facebook_public'
  | 'county_minutes';

export interface OppositionSignal {
  jurisdictionId: string;
  source:         OppositionSource;
  rawText:        string;
  sentimentScore: number;   // −1.0 to +1.0 (set after NLP scoring)
  url:            string;
  publishedAt:    string;   // ISO-8601
}

// Fetches meeting-minutes and public-comment signals from Citizen Portal AI.
// Real implementation: call their API with geo_key filter + DC-related keywords.
async function fetchCitizenPortalSignals(
  geoKeys: string[]
): Promise<Omit<OppositionSignal, 'sentimentScore'>[]> {
  // TODO: replace with Citizen Portal AI 18K municipality feed
  // Keywords: 'data center', 'AI facility', 'power plant',
  //           'moratorium', 'zoning', 'interconnection'
  void geoKeys;
  return [];
}

// Fetches indexed local news RSS signals for a set of jurisdictions.
// Real implementation: look up feed URLs from an rss_feeds table keyed by geo_key.
async function fetchLocalNewsSignals(
  jurisdictions: Array<{ id: string; geo_key: string }>
): Promise<Omit<OppositionSignal, 'sentimentScore'>[]> {
  // TODO: pull from rss_feeds table + filter on DC-related keywords
  void jurisdictions;
  return [];
}

// NLP sentiment scoring via Faraday IDF 4.0 Classifier.
// Returns −1.0 (opposition) to +1.0 (support).
// Real implementation: POST to /api/classify or an internal Anthropic call.
async function scoreSentiment(text: string): Promise<number> {
  // TODO: replace with IDF 4.0 classifier endpoint
  void text;
  return 0.0;
}

// Recency decay weights: signal age → weight multiplier
function ageWeight(publishedAt: string): number {
  const ageDays = (Date.now() - new Date(publishedAt).getTime()) / 86_400_000;
  if (ageDays < 30)  return 1.0;
  if (ageDays < 90)  return 0.6;
  return 0.3;
}

// Aggregates scored signals by jurisdiction → recency-weighted average sentiment
// → mapped dim_opposition score → writes to jurisdictions.dim_opposition
async function updateOppositionDimension(
  signals: OppositionSignal[],
  supabase: {
    from: (table: string) => {
      update: (data: unknown) => { eq: (col: string, val: string) => Promise<{ error: unknown }> };
    };
  }
): Promise<number> {
  const byJurisdiction = new Map<string, OppositionSignal[]>();
  for (const s of signals) {
    if (!byJurisdiction.has(s.jurisdictionId))
      byJurisdiction.set(s.jurisdictionId, []);
    byJurisdiction.get(s.jurisdictionId)!.push(s);
  }

  let updated = 0;
  for (const [jId, sigs] of byJurisdiction.entries()) {
    let weightedSum = 0;
    let totalWeight  = 0;
    for (const sig of sigs) {
      const w = ageWeight(sig.publishedAt);
      weightedSum += sig.sentimentScore * w;
      totalWeight  += w;
    }
    const avgSentiment = totalWeight > 0 ? weightedSum / totalWeight : 0;

    // Map [−1, +1] to [0, 5]: opposition floor at 0, support ceiling at 5
    const dimOpposition = parseFloat(((avgSentiment + 1) / 2 * 5).toFixed(2));

    const { error } = await supabase
      .from('jurisdictions')
      .update({ dim_opposition: dimOpposition })
      .eq('id', jId);

    if (error) {
      console.error(`[opposition-pipeline] dim_opposition update failed for ${jId}:`, error);
    } else {
      updated++;
    }
  }
  return updated;
}

export async function runOppositionPipeline(
  supabase: {
    from: (table: string) => {
      select: (...args: unknown[]) => Promise<{ data: unknown[] | null; error: unknown }>;
      update: (data: unknown) => { eq: (col: string, val: string) => Promise<{ error: unknown }> };
    };
  }
): Promise<{ signalsProcessed: number; jurisdictionsUpdated: number }> {
  const { data: jurisdictions } = await supabase
    .from('jurisdictions')
    .select('id, geo_key') as { data: Array<{ id: string; geo_key: string }> | null; error: unknown };

  const active = (jurisdictions ?? []).filter(j => j.geo_key);
  const geoKeys = active.map(j => j.geo_key);

  const [citizenPortalRaw, newsRaw] = await Promise.all([
    fetchCitizenPortalSignals(geoKeys),
    fetchLocalNewsSignals(active),
  ]);

  const rawSignals = [...citizenPortalRaw, ...newsRaw];

  // Score sentiment for each signal (batch in a real impl)
  const scored: OppositionSignal[] = await Promise.all(
    rawSignals.map(async s => ({
      ...s,
      sentimentScore: await scoreSentiment(s.rawText),
    }))
  );

  const jurisdictionsUpdated = await updateOppositionDimension(scored, supabase);

  console.log(`[opposition-pipeline] ${scored.length} signals processed → ${jurisdictionsUpdated} jurisdictions updated`);
  return { signalsProcessed: scored.length, jurisdictionsUpdated };
}
