// Minimal PostgREST client for Next.js server-side use.
// Mirrors the @supabase/supabase-js query-builder interface but uses
// fetch + PostgREST directly — no SDK dependency required.

export type Row = Record<string, unknown>;
export type DbResult<T = Row[]> = { data: T | null; error: string | null };

class QueryBuilder {
  private _method: 'GET' | 'POST' | 'PATCH' = 'GET';
  private _body: unknown;
  private _select = '*';
  private _params: [string, string][] = [];
  private _prefer: string[] = [];
  private _onConflict?: string;

  constructor(
    private readonly _table: string,
    private readonly _baseUrl: string,
    private readonly _key: string,
  ) {}

  select(cols: string) { this._select = cols; return this; }

  eq(col: string, val: unknown)     { this._params.push([col, `eq.${val}`]);  return this; }
  neq(col: string, val: unknown)    { this._params.push([col, `neq.${val}`]); return this; }
  like(col: string, val: string)    { this._params.push([col, `like.${val}`]); return this; }
  gte(col: string, val: unknown)    { this._params.push([col, `gte.${val}`]); return this; }
  lt(col: string, val: unknown)     { this._params.push([col, `lt.${val}`]);  return this; }
  is(col: string, _val: null)       { this._params.push([col, 'is.null']);    return this; }
  or(filter: string)                { this._params.push(['or', `(${filter})`]); return this; }

  in(col: string, vals: unknown[]) {
    this._params.push([col, `in.(${vals.join(',')})`]);
    return this;
  }

  order(col: string, opts: { ascending?: boolean; nullsFirst?: boolean } = {}) {
    const dir   = opts.ascending === false ? 'desc' : 'asc';
    const nulls = opts.nullsFirst ? '.nullsfirst' : '';
    this._params.push(['order', `${col}.${dir}${nulls}`]);
    return this;
  }

  limit(n: number) { this._params.push(['limit', `${n}`]); return this; }

  insert(rows: Row | Row[]) {
    this._method = 'POST';
    this._body   = Array.isArray(rows) ? rows : [rows];
    return this;
  }

  upsert(rows: Row | Row[], opts?: { onConflict?: string }) {
    this._method = 'POST';
    this._body   = Array.isArray(rows) ? rows : [rows];
    this._prefer.push('resolution=merge-duplicates');
    this._onConflict = opts?.onConflict;
    return this;
  }

  update(data: Row) {
    this._method = 'PATCH';
    this._body   = data;
    return this;
  }

  async single(): Promise<DbResult<Row>> {
    this._params.push(['limit', '1']);
    const res = await this.run();
    if (res.error) return { data: null, error: res.error };
    const arr = Array.isArray(res.data) ? res.data : [];
    return { data: (arr[0] ?? null) as Row, error: null };
  }

  async run(): Promise<DbResult<Row[]>> {
    const params = new URLSearchParams();
    if (this._method === 'GET') params.set('select', this._select);
    if (this._onConflict)       params.set('on_conflict', this._onConflict);
    for (const [k, v] of this._params) params.append(k, v);

    const qs  = params.toString();
    const url = `${this._baseUrl}/rest/v1/${this._table}${qs ? '?' + qs : ''}`;

    const prefer = [...this._prefer, 'return=representation'];

    try {
      const r = await fetch(url, {
        method: this._method,
        headers: {
          apikey:        this._key,
          Authorization: `Bearer ${this._key}`,
          'Content-Type': 'application/json',
          Prefer: prefer.join(','),
        },
        body: this._body !== undefined ? JSON.stringify(this._body) : undefined,
      });

      if (!r.ok) {
        const txt = await r.text().catch(() => r.statusText);
        return { data: null, error: txt };
      }

      const ct = r.headers.get('content-type') ?? '';
      if (!ct.includes('json')) return { data: null, error: null };
      const data = await r.json().catch(() => null);
      return { data, error: null };
    } catch (e) {
      return { data: null, error: String(e) };
    }
  }
}

export type AgendaWatchDb = ReturnType<typeof createClient>;

// Callers (Next.js routes) supply the key and URL from process.env.
// Example: createClient(process.env.SUPABASE_SERVICE_ROLE_KEY!, process.env.SUPABASE_URL)
export function createClient(
  key: string,
  baseUrl = 'https://ycadmmngkdhvpcsrcuaq.supabase.co',
) {
  return {
    from(table: string) {
      return new QueryBuilder(table, baseUrl, key);
    },
  };
}
