// DC Registry Ingestion Pipeline (JDS L1 + L2)
// Ingests data center facility data from licensed vendors (DC Byte, Datacenter Hawk)
// and free sources (Data Center Map) to populate JDS Layer 1 (operational)
// and Layer 2 (announced/under construction).
//
// Call ingestDcRegistry() with a Supabase service-role client.
// Schedule: Saturday 00:00 UTC (before Sunday JDS normalization).

export interface DcFacility {
  name:                 string;
  jurisdiction_geo_key: string;   // FIPS-5 for counties, FIPS-2 for states
  status:               'operational' | 'announced' | 'under_construction' | 'permitted';
  mw_capacity:          number | null;
  developer:            string | null;
  source:               string;
  source_url:           string | null;
  as_of_date:           string;   // ISO-8601 date
}

function statusToLayer(status: DcFacility['status']): 'l1' | 'l2' | 'l3' {
  if (status === 'operational')                              return 'l1';
  if (status === 'announced' || status === 'under_construction') return 'l2';
  return 'l3';  // permitted / not yet built
}

const MW_CAP              = 500;
const MW_FALLBACK_PER_FAC = 10;   // conservative fallback when MW unknown

function sumMw(facs: DcFacility[]): number | null {
  const known = facs.filter(f => f.mw_capacity !== null);
  if (known.length === 0) return null;
  return facs.reduce((acc, f) => acc + (f.mw_capacity ?? 0), 0);
}

function layerScore(mw: number | null, count: number): number {
  const effective = mw ?? count * MW_FALLBACK_PER_FAC;
  return Math.min((effective / MW_CAP) * 10, 10);
}

export async function ingestDcRegistry(
  facilities: DcFacility[],
  supabase: {
    from: (table: string) => {
      select: (...args: unknown[]) => Promise<{ data: unknown[] | null; error: unknown }>;
      upsert: (rows: unknown[], opts: unknown) => Promise<{ error: unknown }>;
    };
  }
): Promise<{ ingested: number; skipped: number }> {
  // Group facilities by jurisdiction geo_key
  const byJurisdiction = new Map<string, DcFacility[]>();
  for (const f of facilities) {
    const key = f.jurisdiction_geo_key;
    if (!byJurisdiction.has(key)) byJurisdiction.set(key, []);
    byJurisdiction.get(key)!.push(f);
  }

  // Look up jurisdiction IDs by geo_key (uses the geo_key column from migration 000004)
  const geoKeys = [...byJurisdiction.keys()];
  const { data: jurisdictions } = await supabase
    .from('jurisdictions')
    .select('id, geo_key, level') as { data: Array<{ id: string; geo_key: string; level: string }> | null; error: unknown };

  const jIdByGeoKey: Record<string, { id: string; level: string }> = {};
  for (const j of (jurisdictions ?? [])) {
    if (j.geo_key) jIdByGeoKey[j.geo_key] = { id: j.id, level: j.level };
  }

  const scoredAt = new Date().toISOString();
  const records: Record<string, unknown>[] = [];
  let skipped = 0;

  for (const [geoKey, facs] of byJurisdiction.entries()) {
    const jInfo = jIdByGeoKey[geoKey];
    if (!jInfo) { skipped++; continue; }

    const l1 = facs.filter(f => statusToLayer(f.status) === 'l1');
    const l2 = facs.filter(f => statusToLayer(f.status) === 'l2');
    const l3 = facs.filter(f => statusToLayer(f.status) === 'l3');

    const jdsRaw = parseFloat((
      layerScore(sumMw(l1), l1.length) * 0.40 +
      layerScore(sumMw(l2), l2.length) * 0.30 +
      layerScore(sumMw(l3), l3.length) * 0.20
      // L4 (land acquisitions) comes from deed crawl, not this pipeline — 0.10 weight omitted
    ).toFixed(2));

    records.push({
      jurisdiction_id:   jInfo.id,
      scored_at:         scoredAt,
      peer_group:        jInfo.level as 'county' | 'metro' | 'state' | 'country',
      l1_facility_count: l1.length,
      l1_mw_total:       sumMw(l1),
      l2_facility_count: l2.length,
      l2_mw_total:       sumMw(l2),
      l3_facility_count: l3.length,
      l3_mw_total:       sumMw(l3),
      l4_parcel_count:   0,
      jds_raw:           jdsRaw,
      jds_normalized:    null,   // set by weekly normalization job
      jds_tier:          null,   // set by weekly normalization job
      source_breakdown:  {
        l1: [...new Set(l1.map(f => f.source))],
        l2: [...new Set(l2.map(f => f.source))],
        l3: [...new Set(l3.map(f => f.source))],
        l4: [],
      },
    });
  }

  if (records.length === 0) return { ingested: 0, skipped };

  // Upsert — one record per (jurisdiction_id, scored_at)
  const { error } = await supabase
    .from('jds_scores')
    .upsert(records, { onConflict: 'jurisdiction_id,scored_at' });

  if (error) throw new Error(`jds_scores upsert failed: ${JSON.stringify(error)}`);

  console.log(`[dc-registry-pipeline] Ingested JDS data for ${records.length} jurisdictions (${skipped} skipped — no geo_key match)`);
  return { ingested: records.length, skipped };
}

// Geo-key lookup helpers for data sources that provide state names or FIPS codes
export function normalizeFipsCounty(fips5: string): string {
  return fips5.padStart(5, '0');
}

export function normalizeFipsState(fips2: string): string {
  return fips2.padStart(2, '0');
}
