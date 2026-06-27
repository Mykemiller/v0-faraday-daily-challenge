import { JdsTier } from './types';

interface JdsInput {
  l1_facility_count: number;
  l1_mw_total:       number | null;
  l2_facility_count: number;
  l2_mw_total:       number | null;
  l3_facility_count: number;
  l3_mw_total:       number | null;
  l4_parcel_count:   number;
}

// Compute raw JDS (0–10) from layer inputs before peer normalization.
// MW is the primary unit; falls back to facility count × size multiplier
// when MW is unavailable.
export function computeRawJds(input: JdsInput): number {
  const MW_FALLBACK_PER_FACILITY = 10; // conservative 10 MW default per unknown facility
  const MW_CAP = 500;                  // hyperscaler campus scale

  const l1Mw = input.l1_mw_total ?? input.l1_facility_count * MW_FALLBACK_PER_FACILITY;
  const l2Mw = input.l2_mw_total ?? input.l2_facility_count * MW_FALLBACK_PER_FACILITY;
  const l3Mw = input.l3_mw_total ?? input.l3_facility_count * MW_FALLBACK_PER_FACILITY;
  const l4Score = Math.min(input.l4_parcel_count * 2, 10);

  const l1Score = Math.min((l1Mw / MW_CAP) * 10, 10);
  const l2Score = Math.min((l2Mw / MW_CAP) * 10, 10);
  const l3Score = Math.min((l3Mw / MW_CAP) * 10, 10);

  return parseFloat(
    ((l1Score * 0.40) + (l2Score * 0.30) + (l3Score * 0.20) + (l4Score * 0.10)).toFixed(2)
  );
}

// Normalize a raw JDS against a peer group distribution.
export function normalizeJds(rawScore: number, peerScores: number[]): number {
  if (peerScores.length === 0) return 0;
  const max = Math.max(...peerScores);
  if (max === 0) return 0;
  return parseFloat(((rawScore / max) * 10).toFixed(2));
}

// Map normalized JDS (0–10) to a tier label.
export function getJdsTier(normalized: number): JdsTier {
  if (normalized >= 8.0) return 'Saturated';
  if (normalized >= 6.0) return 'Dense';
  if (normalized >= 4.0) return 'Active';
  if (normalized >= 2.0) return 'Emerging';
  return 'Greenfield';
}
