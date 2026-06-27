// ── JPS ────────────────────────────────────────────────────────────────────
export type JpsTier =
  | 'Leading' | 'Favorable' | 'Mixed' | 'Cautious' | 'Restricted';

export type JpsTrend = 'rising' | 'falling' | 'stable';

// ── CONFIDENCE ─────────────────────────────────────────────────────────────
export type ConfidenceTier = 'verified' | 'estimated' | 'inferred' | 'unscored';

export interface ConfidenceBreakdown {
  coverage:    number;   // 0–100
  recency:     number;   // 0–100
  diversity:   number;   // 0–100
  grid_access: number;   // 0–100
  composite:   number;   // 0–100
  tier:        ConfidenceTier;
}

// ── JDS ────────────────────────────────────────────────────────────────────
export type JdsTier =
  | 'Greenfield' | 'Emerging' | 'Active' | 'Dense' | 'Saturated';

export type JdsPeerGroup = 'county' | 'metro' | 'state' | 'country';

export interface JdsLayerBreakdown {
  l1_facility_count: number;
  l1_mw_total:       number | null;
  l2_facility_count: number;
  l2_mw_total:       number | null;
  l3_facility_count: number;
  l3_mw_total:       number | null;
  l4_parcel_count:   number;
  l4_acreage_total:  number | null;
  source_breakdown:  Record<string, string[]> | null;
}

// ── JURISDICTION ────────────────────────────────────────────────────────────
export type JurisdictionLevel = 'country' | 'state' | 'metro' | 'county';

export interface JurisdictionPosture {
  id:    string;
  name:  string;
  level: JurisdictionLevel;
  geoKey: string;           // FIPS-5 for counties, FIPS-2 for states, CBSA for metros, ISO-3 for countries
  slug:  string;

  // JPS
  tier:          JpsTier | null;
  score:         number | null;
  adjustedScore: number | null;   // confidence-dampened: (score × c) + (2.5 × (1-c))
  delta:         number | null;
  trend:         JpsTrend | null;
  lastScored:    string | null;

  // Confidence
  confidenceScore:     number | null;
  confidenceTier:      ConfidenceTier;
  confidenceBreakdown: ConfidenceBreakdown | null;

  // JDS
  jdsRaw:        number | null;
  jdsNormalized: number | null;
  jdsTier:       JdsTier | null;
  jdsDelta:      number | null;
  jdsLayers:     JdsLayerBreakdown | null;   // populated on detail page only
}

// ── JoI ────────────────────────────────────────────────────────────────────
export interface JoISet {
  id:           string;
  subscriberId: string;
  name:         string;
  description:  string | null;
  color:        string;
  isActive:     boolean;
  createdAt:    string;
  memberCount?: number;
}

export interface JoIMember {
  setId:          string;
  jurisdictionId: string;
  addedAt:        string;
  jurisdiction?:  JurisdictionPosture;
}

export type JoIAlertType =
  | 'tier_change' | 'score_delta' | 'new_opposition'
  | 'confidence_change' | 'density_change';

export interface JoIAlert {
  id:             string;
  setId:          string;
  jurisdictionId: string;
  alertType:      JoIAlertType;
  priorValue:     string | null;
  newValue:       string | null;
  delta:          number | null;
  triggeredAt:    string;
  isRead:         boolean;
}

// ── SCORE MODE (used by choropleth + leaderboard toggle) ───────────────────
export type ScoreMode = 'posture' | 'density' | 'confidence';
