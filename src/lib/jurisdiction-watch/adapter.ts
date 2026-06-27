import {
  JurisdictionPosture, JpsTier, JpsTrend, JdsTier, ConfidenceTier, ConfidenceBreakdown
} from './types';

function mapJpsTier(raw: string | null): JpsTier | null {
  const valid: JpsTier[] = ['Leading', 'Favorable', 'Mixed', 'Cautious', 'Restricted'];
  return raw && valid.includes(raw as JpsTier) ? (raw as JpsTier) : null;
}

function mapJdsTier(raw: string | null): JdsTier | null {
  const valid: JdsTier[] = ['Greenfield', 'Emerging', 'Active', 'Dense', 'Saturated'];
  return raw && valid.includes(raw as JdsTier) ? (raw as JdsTier) : null;
}

function mapConfidenceTier(raw: string | null): ConfidenceTier {
  const valid: ConfidenceTier[] = ['verified', 'estimated', 'inferred', 'unscored'];
  return raw && valid.includes(raw as ConfidenceTier) ? (raw as ConfidenceTier) : 'unscored';
}

// DB uses improving/stable/deteriorating; TypeScript type uses rising/falling/stable
function mapJpsTrend(raw: string | null): JpsTrend | null {
  if (!raw) return null;
  if (raw === 'improving') return 'rising';
  if (raw === 'deteriorating') return 'falling';
  if (raw === 'stable') return 'stable';
  return null;
}

function computeAdjustedScore(
  rawScore: number | null,
  confidence: number | null
): number | null {
  if (rawScore === null) return null;
  const c = (confidence ?? 0) / 100;
  return parseFloat(((rawScore * c) + (2.5 * (1 - c))).toFixed(2));
}

export function mapRowToJurisdiction(row: Record<string, unknown>): JurisdictionPosture {
  return {
    id:    row.id as string,
    name:  row.name as string,
    level: (row.level as string) as JurisdictionPosture['level'],
    geoKey: (row.iso_code as string) ?? '',
    slug:  (row.slug as string) ?? '',

    // JPS — actual DB columns are current_score, current_tier, jps_trend, last_scored_date
    tier:          mapJpsTier(row.current_tier as string | null),
    score:         (row.current_score as number) ?? null,
    adjustedScore: computeAdjustedScore(
      (row.current_score as number) ?? null,
      (row.confidence_score as number) ?? null
    ),
    delta:      (row.delta as number) ?? null,
    trend:      mapJpsTrend(row.jps_trend as string | null),
    lastScored: (row.last_scored_date as string) ?? null,

    // Confidence
    confidenceScore:     (row.confidence_score as number) ?? null,
    confidenceTier:      mapConfidenceTier(row.confidence_tier as string | null),
    confidenceBreakdown: (row.confidence_breakdown as ConfidenceBreakdown) ?? null,

    // JDS
    jdsRaw:        (row.jds_raw as number) ?? null,
    jdsNormalized: (row.jds_normalized as number) ?? null,
    jdsTier:       mapJdsTier(row.jds_tier as string | null),
    jdsDelta:      (row.jds_delta as number) ?? null,
    jdsLayers:     null,   // fetched separately on detail page
  };
}
