// Airtable → Supabase jurisdictions sync (FAR-JW-006)
// Reads records modified in the last 7 days from the JW master Airtable base
// and upserts them into jurisdictions via the Supabase REST API.
//
// Uses the Airtable REST API directly (consistent with /api/lexicon) — no npm
// Airtable client required.
//
// Schedule: every Monday at 03:00 UTC (pg_cron jw-airtable-sync).

const AIRTABLE_BASE_ID  = 'appxfti7VuoHYUeu6';
const AIRTABLE_TABLE_ID = 'tblAZB4CjCBGHREKi';   // JW jurisdictions master

interface AirtableRecord {
  id: string;
  fields: Record<string, unknown>;
}

// Fetch all records from the JW table modified in the last 7 days.
async function fetchModifiedRecords(apiKey: string): Promise<AirtableRecord[]> {
  const formula = encodeURIComponent(
    "IS_AFTER({Last Modified}, DATEADD(NOW(), -7, 'days'))"
  );
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_ID}?filterByFormula=${formula}`;

  const records: AirtableRecord[] = [];
  let offset: string | undefined;

  do {
    const pageUrl = offset ? `${url}&offset=${offset}` : url;
    const res = await fetch(pageUrl, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Airtable API error ${res.status}: ${body.slice(0, 300)}`);
    }
    const data: { records: AirtableRecord[]; offset?: string } = await res.json();
    records.push(...(data.records ?? []));
    offset = data.offset;
  } while (offset);

  return records;
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

export interface SyncResult {
  synced: number;
  errors: number;
  total:  number;
}

// Upserts Airtable jurisdiction records into Supabase.
// Uses the actual DB column names from adapter.ts:
//   current_tier, current_score, last_scored_date, geo_key, is_active
export async function syncAirtableToSupabase(
  supabase: {
    from: (table: string) => {
      upsert: (row: unknown, opts: unknown) => Promise<{ error: unknown }>;
    };
  },
  apiKey?: string
): Promise<SyncResult> {
  const key = apiKey ?? process.env.AIRTABLE_API_KEY;
  if (!key) throw new Error('AIRTABLE_API_KEY not set');

  const records = await fetchModifiedRecords(key);

  let synced = 0;
  let errors = 0;

  for (const record of records) {
    const f = record.fields;
    const name = (f['Name'] as string | undefined) ?? '';
    if (!name) { errors++; continue; }

    const slug    = slugify(name);
    const geoKey  = (f['Geo Key'] as string | undefined) ?? (f['ISO Code'] as string | undefined) ?? null;
    const level   = ((f['Level'] as string | undefined) ?? '').toLowerCase() || null;

    const row = {
      slug,
      name,
      level,
      geo_key:          geoKey,
      // JPS columns — DB names from adapter.ts (NOT tier/score)
      current_tier:     (f['JPS Tier']     as string  | undefined) ?? null,
      current_score:    (f['JPS Score']    as number  | undefined) ?? null,
      delta:            (f['Score Delta']  as number  | undefined) ?? null,
      last_scored_date: (f['Last Scored Date'] as string | undefined) ?? null,
      // JPS dimension scores
      dim_regulatory:   (f['Dim Regulatory']  as number | undefined) ?? null,
      dim_permitting:   (f['Dim Permitting']  as number | undefined) ?? null,
      dim_power:        (f['Dim Power']       as number | undefined) ?? null,
      dim_opposition:   (f['Dim Opposition']  as number | undefined) ?? null,
      dim_incentives:   (f['Dim Incentives']  as number | undefined) ?? null,
      is_active:        true,
    };

    const { error } = await supabase
      .from('jurisdictions')
      .upsert(row, { onConflict: 'slug' });

    if (error) {
      errors++;
      console.error(`[airtable-sync] upsert failed for ${slug}:`, error);
    } else {
      synced++;
    }
  }

  console.log(`[airtable-sync] ${synced} synced, ${errors} errors (${records.length} total records)`);
  return { synced, errors, total: records.length };
}
