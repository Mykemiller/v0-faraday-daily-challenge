// Data365 group post fetcher.
// Calls the Data365 API to pull recent posts from monitored Facebook / LinkedIn groups.
// Requires env: DATA365_API_KEY
// Writes fetched posts to data365_posts.

import { Svc } from '@/lib/pipeline-utils';

const DATA365_BASE = 'https://api.data365.co/v1.1';

export interface FetchResult {
  groups:   number;
  posts:    number;
  inserted: number;
  errors:   number;
}

export async function fetchGroupPostsBatch(limit: number, svc: Svc): Promise<FetchResult> {
  const apiKey = process.env.DATA365_API_KEY;
  if (!apiKey) {
    console.warn('[data365/fetch] DATA365_API_KEY not set — skipping');
    return { groups: 0, posts: 0, inserted: 0, errors: 0 };
  }

  const result: FetchResult = { groups: 0, posts: 0, inserted: 0, errors: 0 };

  // Load monitored group configs from Supabase
  const r = await fetch(
    `${svc.base}/data365_groups?is_active=eq.true&select=id,group_id,group_name,platform,jurisdiction_id&limit=${limit}`,
    { headers: svc.headers, cache: 'no-store' }
  );
  if (!r.ok) return result;

  const groups: Data365Group[] = await r.json().catch(() => []);
  result.groups = groups.length;

  for (const group of groups) {
    try {
      const posts = await fetchGroupPosts(group, apiKey);
      result.posts += posts.length;

      for (const post of posts) {
        const ins = await fetch(`${svc.base}/data365_posts`, {
          method:  'POST',
          headers: { ...svc.headers, Prefer: 'resolution=ignore-duplicates,return=minimal' },
          body:    JSON.stringify({
            group_id:        group.id,
            jurisdiction_id: group.jurisdiction_id ?? null,
            post_id:         post.id,
            post_text:       post.text,
            post_date:       post.date,
            reaction_count:  post.reactions,
            comment_count:   post.comments,
            platform:        group.platform,
            fetched_at:      new Date().toISOString(),
          }),
        });
        if (ins.ok) result.inserted++;
      }

      await fetch(`${svc.base}/data365_groups?id=eq.${group.id}`, {
        method:  'PATCH',
        headers: svc.headers,
        body:    JSON.stringify({ last_fetched_at: new Date().toISOString() }),
      });
    } catch (err) {
      console.error('[data365/fetch] group error', group.id, err);
      result.errors++;
    }
  }

  return result;
}

async function fetchGroupPosts(
  group: Data365Group,
  apiKey: string
): Promise<{ id: string; text: string; date: string | null; reactions: number; comments: number }[]> {
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const url   = `${DATA365_BASE}/facebook/group/${encodeURIComponent(group.group_id)}/posts` +
                `?access_token=${apiKey}&from_date=${since}&max_results=100`;

  const r = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!r.ok) return [];

  const body = await r.json().catch(() => null);
  const items: any[] = body?.data?.posts?.items ?? body?.items ?? [];

  return items.map(p => ({
    id:        p.post_id ?? p.id ?? String(Math.random()),
    text:      p.text ?? p.message ?? '',
    date:      p.date ?? p.created_time ?? null,
    reactions: p.reactions_count ?? p.likes ?? 0,
    comments:  p.comments_count  ?? p.comments ?? 0,
  }));
}

interface Data365Group {
  id:              string;
  group_id:        string;
  group_name:      string;
  platform:        string;
  jurisdiction_id: string | null;
}
