// Supabase REST helper for Data365 server-side modules.
// Mirrors the svc() pattern used in /api/live-agent/route.ts —
// no @supabase/supabase-js dependency, raw PostgREST fetch.

export const SUPABASE_URL =
  process.env.SUPABASE_URL || 'https://ycadmmngkdhvpcsrcuaq.supabase.co';

export interface Svc {
  base: string;
  headers: Record<string, string>;
}

export function svc(): Svc {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');
  return {
    base: `${SUPABASE_URL}/rest/v1`,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
  };
}

export async function dbSelect<T = Record<string, unknown>>(
  s: Svc,
  table: string,
  params: string,
): Promise<T[]> {
  const r = await fetch(`${s.base}/${table}?${params}`, {
    headers: { ...s.headers, Prefer: 'return=representation' },
    cache: 'no-store',
  });
  if (!r.ok) throw new Error(`SELECT ${table} ${r.status}: ${await r.text().catch(() => '')}`);
  return r.json();
}

export async function dbInsert(
  s: Svc,
  table: string,
  data: Record<string, unknown> | Record<string, unknown>[],
  prefer = 'return=minimal',
): Promise<void> {
  const r = await fetch(`${s.base}/${table}`, {
    method: 'POST',
    headers: { ...s.headers, Prefer: prefer },
    body: JSON.stringify(data),
    cache: 'no-store',
  });
  if (!r.ok) throw new Error(`INSERT ${table} ${r.status}: ${await r.text().catch(() => '')}`);
}

export async function dbUpsert(
  s: Svc,
  table: string,
  data: Record<string, unknown> | Record<string, unknown>[],
): Promise<void> {
  const r = await fetch(`${s.base}/${table}`, {
    method: 'POST',
    headers: { ...s.headers, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(data),
    cache: 'no-store',
  });
  if (!r.ok) throw new Error(`UPSERT ${table} ${r.status}: ${await r.text().catch(() => '')}`);
}

export async function dbPatch(
  s: Svc,
  table: string,
  filter: string,
  data: Record<string, unknown>,
): Promise<void> {
  const r = await fetch(`${s.base}/${table}?${filter}`, {
    method: 'PATCH',
    headers: { ...s.headers, Prefer: 'return=minimal' },
    body: JSON.stringify(data),
    cache: 'no-store',
  });
  if (!r.ok) throw new Error(`PATCH ${table} ${r.status}: ${await r.text().catch(() => '')}`);
}
