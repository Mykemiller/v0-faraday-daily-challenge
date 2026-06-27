// JW Inference Engine — three scoring methods for US county JPS coverage.
//
//   Method A  Geographic Inheritance  — every county inherits from its parent state
//   Method B  Demographic Correlate   — OLS on Census features refines inherited scores
//   Method C  Event-triggered upgrade — DB trigger (migration 20260627000005)
//
// Uses raw PostgREST fetch (no @supabase/supabase-js) matching the codebase pattern.

import { getPgSvc, pgSelect, pgUpsert } from './supabase-client';

// ── shared types ────────────────────────────────────────────────────────────

interface StateRow {
  geo_key: string;
  score:   number | null;
  tier:    string | null;
}

interface CountyRow {
  id:                   string;
  name:                 string;
  geo_key:              string;
  score:                number | null;
  confidence_score:     number | null;
  confidence_tier:      string | null;
  confidence_breakdown: Record<string, unknown> | null;
}

interface PowerRow {
  fips5:                string;
  grid_access_score:    number;
  power_tier:           string;
  queue_wait_months:    number | null;
  available_capacity_mw: number | null;
}

interface DemogRow {
  fips5:            string;
  population:       number | null;
  median_hh_income: number | null;
  rural_urban_code: number | null;
  partisan_lean:    number | null;
}

// ── Method A — Geographic Inheritance ───────────────────────────────────────

function inheritedTier(score: number): string {
  // Counties never receive 'Leading' from inheritance alone — direct evidence required.
  if (score >= 3.5) return 'Favorable';
  if (score >= 2.5) return 'Mixed';
  if (score >= 1.5) return 'Cautious';
  return 'Restricted';
}

export async function runGeographicInheritance(): Promise<number> {
  const svc = getPgSvc();

  const states = await pgSelect<StateRow>(
    svc, 'jurisdictions',
    '?level=eq.state&score=not.is.null&select=geo_key,score,tier',
  );
  const stateByFips2: Record<string, { score: number; tier: string | null }> = {};
  for (const s of states) {
    if (s.geo_key && s.score !== null) {
      stateByFips2[s.geo_key] = { score: s.score, tier: s.tier };
    }
  }

  const counties = await pgSelect<CountyRow>(
    svc, 'jurisdictions',
    '?level=eq.county&score=is.null&is_active=eq.true&select=id,name,geo_key',
  );

  if (counties.length === 0) {
    console.log('Method A: no unscored counties found');
    return 0;
  }

  const BATCH = 100;
  let updated = 0;

  for (let i = 0; i < counties.length; i += BATCH) {
    const batch  = counties.slice(i, i + BATCH);
    const updates: Record<string, unknown>[] = [];

    for (const county of batch) {
      const stateFips2 = county.geo_key?.slice(0, 2);
      if (!stateFips2) continue;
      const stateData = stateByFips2[stateFips2];
      if (!stateData?.score) continue;

      // Weighted pull toward neutral: 70% state, 30% neutral (2.5)
      const inferredScore = parseFloat(
        ((stateData.score * 0.70) + (2.5 * 0.30)).toFixed(2)
      );

      updates.push({
        id:               county.id,
        score:            inferredScore,
        tier:             inheritedTier(inferredScore),
        confidence_score: 15.0,
        confidence_tier:  'inferred',
        confidence_breakdown: {
          coverage:     0,
          recency:      10,
          diversity:    20,
          grid_access:  20,   // placeholder — overwritten in applyUtilityQueueScores
          composite:    15,
          tier:         'inferred',
          method:       'geographic_inheritance',
          parent_fips:  stateFips2,
          parent_score: stateData.score,
        },
        confidence_updated_at: new Date().toISOString(),
      });
    }

    if (updates.length > 0) {
      try {
        await pgUpsert(svc, 'jurisdictions', updates, 'id');
        updated += updates.length;
      } catch (e) {
        console.error(`Method A batch ${i}–${i + BATCH} error:`, e);
      }
    }
  }

  console.log(`Method A (Geographic Inheritance): seeded ${updated} counties`);
  return updated;
}

// ── Step 5 — Wire utility queue scores into county rows ──────────────────────

export async function applyUtilityQueueScores(): Promise<number> {
  const svc = getPgSvc();

  const powerData = await pgSelect<PowerRow>(
    svc, 'county_power_availability',
    '?select=fips5,grid_access_score,power_tier,queue_wait_months,available_capacity_mw',
  );

  if (powerData.length === 0) {
    console.log('No power availability data — run seedCountyPowerAvailability() first');
    return 0;
  }

  const BATCH = 200;
  let updated = 0;

  for (let i = 0; i < powerData.length; i += BATCH) {
    const batch  = powerData.slice(i, i + BATCH);
    const fips5s = batch.map(p => p.fips5);

    let counties: CountyRow[] = [];
    try {
      counties = await pgSelect<CountyRow>(
        svc, 'jurisdictions',
        `?level=eq.county&geo_key=in.(${fips5s.join(',')})` +
        `&select=id,geo_key,confidence_score,confidence_breakdown`,
      );
    } catch (e) {
      console.error(`Power update fetch batch ${i}:`, e);
      continue;
    }

    const countyByFips: Record<string, CountyRow> = {};
    for (const c of counties) countyByFips[c.geo_key] = c;

    const updates: Record<string, unknown>[] = [];
    for (const power of batch) {
      const county = countyByFips[power.fips5];
      if (!county) continue;

      const existing  = county.confidence_breakdown ?? {};
      const baseConf  = county.confidence_score ?? 15;
      // Real utility data adds ~5 points, capped at 39 to stay within 'inferred' tier
      const newConf   = Math.min(baseConf + 5, 39);

      updates.push({
        id:               county.id,
        grid_access_score: power.grid_access_score,
        confidence_score:  newConf,
        confidence_breakdown: {
          ...existing,
          grid_access:      power.grid_access_score,
          composite:        newConf,
          power_tier:       power.power_tier,
          queue_wait_months: power.queue_wait_months,
        },
        confidence_updated_at: new Date().toISOString(),
      });
    }

    if (updates.length > 0) {
      try {
        await pgUpsert(svc, 'jurisdictions', updates, 'id');
        updated += updates.length;
      } catch (e) {
        console.error(`Power update upsert batch ${i}:`, e);
      }
    }
  }

  console.log(`Applied utility queue scores to ${updated} counties`);
  return updated;
}

// ── helpers ──────────────────────────────────────────────────────────────────

// Fetches census demographics in batches to avoid URL length limits (~3,000 FIPS codes).
async function fetchDemogBatched(svc: ReturnType<typeof getPgSvc>, fips5s: string[]): Promise<DemogRow[]> {
  const BATCH = 200;
  const all: DemogRow[] = [];
  for (let i = 0; i < fips5s.length; i += BATCH) {
    const chunk = fips5s.slice(i, i + BATCH);
    const rows = await pgSelect<DemogRow>(
      svc, 'census_county_demographics',
      `?fips5=in.(${chunk.join(',')})` +
      `&select=fips5,population,median_hh_income,rural_urban_code,partisan_lean`,
    );
    all.push(...rows);
  }
  return all;
}

// ── Method B — Demographic Correlate Model ───────────────────────────────────

function refinedTier(score: number): string {
  if (score >= 3.5) return 'Favorable';
  if (score >= 2.5) return 'Mixed';
  if (score >= 1.5) return 'Cautious';
  return 'Restricted';
}

// Ordinary least squares via Gaussian elimination — minimal implementation
// (avoids ML library dependency for a 4-feature model).
function gaussianElimination(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    let maxRow = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(M[row][col]) > Math.abs(M[maxRow][col])) maxRow = row;
    }
    [M[col], M[maxRow]] = [M[maxRow], M[col]];

    const pivot = M[col][col];
    if (Math.abs(pivot) < 1e-12) continue; // singular — skip

    for (let row = col + 1; row < n; row++) {
      const factor = M[row][col] / pivot;
      for (let j = col; j <= n; j++) M[row][j] -= factor * M[col][j];
    }
  }

  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    if (Math.abs(M[i][i]) < 1e-12) continue;
    x[i] = M[i][n] / M[i][i];
    for (let j = i - 1; j >= 0; j--) M[j][n] -= M[j][i] * x[i];
  }
  return x;
}

function fitOLS(data: { y: number; x: number[] }[]): number[] {
  const n = data.length;
  const k = data[0].x.length + 1; // +1 for intercept

  const X = data.map(d => [1, ...d.x]);
  const y = data.map(d => d.y);

  // Build X'X
  const XtX = Array.from({ length: k }, (_, i) =>
    Array.from({ length: k }, (_, j) =>
      X.reduce((sum, row) => sum + row[i] * row[j], 0)
    )
  );
  // Build X'y
  const Xty = Array.from({ length: k }, (_, i) =>
    X.reduce((sum, row, ri) => sum + row[i] * y[ri], 0)
  );

  return gaussianElimination(XtX, Xty);
}

function predictOLS(features: number[], coef: number[]): number {
  const x = [1, ...features];
  const raw = x.reduce((sum, xi, i) => sum + xi * (coef[i] ?? 0), 0);
  return Math.max(0, Math.min(5, raw));
}

export async function runDemographicCorrelateModel(): Promise<number> {
  const svc = getPgSvc();

  // --- Training set: directly-scored counties (not inferred/unscored) ---
  const trainSet = await pgSelect<CountyRow>(
    svc, 'jurisdictions',
    '?level=eq.county&score=not.is.null' +
    '&confidence_tier=not.in.(inferred,unscored)' +
    '&select=id,geo_key,score',
  );

  if (trainSet.length < 20) {
    console.log(`Method B: only ${trainSet.length} direct training samples (<20). Skipping.`);
    return 0;
  }

  const trainFips = trainSet.map(c => c.geo_key).filter(Boolean);
  // Fetch in batches to stay within URL length limits
  const trainDemog = await fetchDemogBatched(svc, trainFips);
  const demogByFips: Record<string, DemogRow> = {};
  for (const d of trainDemog) demogByFips[d.fips5] = d;

  // Build training data
  // Features:
  //   0  log(population)       — regulatory sophistication
  //   1  median_hh_income/1000 — organised opposition capacity
  //   2  rural_urban_code      — regulatory environment
  //   3  partisan_lean         — historical dev posture
  type Sample = { y: number; x: number[] };
  const trainingData: Sample[] = trainSet
    .map(county => {
      const d = demogByFips[county.geo_key];
      if (!d || county.score === null) return null;
      return {
        y: county.score,
        x: [
          Math.log(Math.max(d.population ?? 1, 1)),
          (d.median_hh_income ?? 50000) / 1000,
          d.rural_urban_code ?? 5,
          d.partisan_lean    ?? 0,
        ],
      } as Sample;
    })
    .filter((v): v is Sample => v !== null);

  if (trainingData.length < 15) {
    console.log(`Method B: only ${trainingData.length} samples with demographics (<15). Skipping.`);
    return 0;
  }

  const coef = fitOLS(trainingData);
  console.log('Method B OLS coefficients:', coef);

  // --- Apply to inferred counties ---
  const inferredCounties = await pgSelect<CountyRow>(
    svc, 'jurisdictions',
    '?level=eq.county&confidence_tier=eq.inferred&is_active=eq.true' +
    '&select=id,geo_key,score,confidence_score,confidence_breakdown',
  );

  if (inferredCounties.length === 0) {
    console.log('Method B: no inferred counties to refine');
    return 0;
  }

  const inferredFips = inferredCounties.map(c => c.geo_key).filter(Boolean);
  const inferredDemog = await fetchDemogBatched(svc, inferredFips);
  const inferredDemogByFips: Record<string, DemogRow> = {};
  for (const d of inferredDemog) inferredDemogByFips[d.fips5] = d;

  const updates: Record<string, unknown>[] = [];

  for (const county of inferredCounties) {
    const d = inferredDemogByFips[county.geo_key];
    if (!d) continue;

    const features = [
      Math.log(Math.max(d.population ?? 1, 1)),
      (d.median_hh_income ?? 50000) / 1000,
      d.rural_urban_code ?? 5,
      d.partisan_lean    ?? 0,
    ];

    const modelScore = predictOLS(features, coef);

    // 50% geographic inheritance + 50% demographic model
    const blended = ((county.score ?? 2.5) * 0.50) + (modelScore * 0.50);
    const clamped = parseFloat(Math.max(0.5, Math.min(4.5, blended)).toFixed(2));

    const existingConf = (county.confidence_breakdown as Record<string, unknown>)?.composite;
    const baseConf     = typeof existingConf === 'number' ? existingConf : (county.confidence_score ?? 15);
    const newConf      = Math.min(baseConf + 10, 39);

    updates.push({
      id:    county.id,
      score: clamped,
      tier:  refinedTier(clamped),
      confidence_score: newConf,
      confidence_breakdown: {
        ...(county.confidence_breakdown ?? {}),
        composite:   newConf,
        method:      'demographic_correlate_model',
        model_score: modelScore,
        blend_ratio: '50/50 geo-inherit + demographic',
        training_n:  trainingData.length,
      },
      confidence_updated_at: new Date().toISOString(),
    });
  }

  let updated = 0;
  const BATCH = 200;
  for (let i = 0; i < updates.length; i += BATCH) {
    try {
      await pgUpsert(svc, 'jurisdictions', updates.slice(i, i + BATCH), 'id');
      updated += Math.min(BATCH, updates.length - i);
    } catch (e) {
      console.error(`Method B upsert batch ${i}:`, e);
    }
  }

  console.log(`Method B (Demographic Correlate): refined ${updated} county scores`);
  return updated;
}
