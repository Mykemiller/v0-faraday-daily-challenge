// Thin PostgREST client for pipeline use.
// Matches the raw-fetch pattern used throughout this codebase (no @supabase/supabase-js).
// All pipeline functions run server-side with SUPABASE_SERVICE_ROLE_KEY.

const SUPABASE_URL =
  process.env.SUPABASE_URL || 'https://ycadmmngkdhvpcsrcuaq.supabase.co';

export interface PgSvc {
  base:    string;
  headers: Record<string, string>;
}

export function getPgSvc(): PgSvc {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');
  return {
    base: `${SUPABASE_URL}/rest/v1`,
    headers: {
      apikey:          key,
      Authorization:   `Bearer ${key}`,
      'Content-Type':  'application/json',
    },
  };
}

export async function pgSelect<T>(
  svc:   PgSvc,
  table: string,
  qs:    string = '',
): Promise<T[]> {
  const r = await fetch(`${svc.base}/${table}${qs}`, {
    headers: { ...svc.headers, Prefer: 'return=representation' },
    cache:   'no-store',
  });
  if (!r.ok) {
    const msg = await r.text().catch(() => r.statusText);
    throw new Error(`pgSelect ${table}: ${r.status} ${msg}`);
  }
  return r.json();
}

// Upsert (POST with merge-duplicates).
// onConflict: comma-separated unique column(s), e.g. 'id' or 'fips5'
export async function pgUpsert<T>(
  svc:        PgSvc,
  table:      string,
  rows:       T[],
  onConflict: string = 'id',
): Promise<void> {
  if (rows.length === 0) return;
  const r = await fetch(
    `${svc.base}/${table}?on_conflict=${encodeURIComponent(onConflict)}`,
    {
      method:  'POST',
      headers: {
        ...svc.headers,
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(rows),
    },
  );
  if (!r.ok) {
    const msg = await r.text().catch(() => r.statusText);
    throw new Error(`pgUpsert ${table}: ${r.status} ${msg}`);
  }
}

export async function pgInsert<T>(
  svc:   PgSvc,
  table: string,
  rows:  T[],
): Promise<void> {
  if (rows.length === 0) return;
  const r = await fetch(`${svc.base}/${table}`, {
    method:  'POST',
    headers: { ...svc.headers, Prefer: 'return=minimal' },
    body:    JSON.stringify(rows),
  });
  if (!r.ok) {
    const msg = await r.text().catch(() => r.statusText);
    throw new Error(`pgInsert ${table}: ${r.status} ${msg}`);
  }
}
