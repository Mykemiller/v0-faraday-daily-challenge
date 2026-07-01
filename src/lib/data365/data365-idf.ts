// Data365 → IDF signal ingestor.
// Reads data365_posts that haven't been ingested into idf_signals
// and upserts them with source_type='data365'.

import { Svc } from '@/lib/pipeline-utils';

const BATCH_SIZE = 200;

export async function ingestData365ToIdf(svc: Svc): Promise<{ ingested: number; errors: number }> {
  let ingested = 0;
  let errors   = 0;
  let offset   = 0;

  while (true) {
    const r = await fetch(
      `${svc.base}/data365_posts?idf_ingested=eq.false` +
      `&select=id,jurisdiction_id,post_id,post_text,post_date,platform,group_id` +
      `&limit=${BATCH_SIZE}&offset=${offset}`,
      { headers: svc.headers, cache: 'no-store' }
    );
    if (!r.ok) break;

    const posts: Data365PostRow[] = await r.json().catch(() => []);
    if (posts.length === 0) break;

    const idfRows = posts.map(p => ({
      source_type:     'data365' as const,
      jurisdiction_id: p.jurisdiction_id ?? null,
      signal_key:      `d365:${p.id}`,
      signal_type:     'community_sentiment',
      title:           `Data365 post — ${p.platform ?? 'social'}`,
      content:         p.post_text?.slice(0, 2000) ?? null,
      metadata:        { post_id: p.post_id, post_date: p.post_date, group_id: p.group_id },
      ingested_at:     new Date().toISOString(),
    }));

    const ins = await fetch(`${svc.base}/idf_signals`, {
      method:  'POST',
      headers: { ...svc.headers, Prefer: 'resolution=merge-duplicates,return=minimal' },
      body:    JSON.stringify(idfRows),
    });

    if (ins.ok) {
      const ids = posts.map(p => p.id);
      await fetch(
        `${svc.base}/data365_posts?id=in.(${ids.map(encodeURIComponent).join(',')})`,
        { method: 'PATCH', headers: svc.headers, body: JSON.stringify({ idf_ingested: true }) }
      );
      ingested += posts.length;
    } else {
      errors += posts.length;
    }

    if (posts.length < BATCH_SIZE) break;
    offset += BATCH_SIZE;
  }

  return { ingested, errors };
}

interface Data365PostRow {
  id:              string;
  jurisdiction_id: string | null;
  post_id:         string;
  post_text:       string | null;
  post_date:       string | null;
  platform:        string | null;
  group_id:        string | null;
}
