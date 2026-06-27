// Post fetcher — pulls recent posts from registered Facebook groups,
// classifies data center relevance, and computes keyword-based sentiment.
// Intended as a weekly batch job (groups are re-fetched after 7 days).
//
// Rate limit: Data365 standard plan allows ~1 req/sec; we pace at 1.1s/req.

import { fetchGroupPosts, type Data365GroupPost } from './client';
import { svc, dbSelect, dbUpsert, dbPatch } from './svc';

interface GroupRow {
  group_id:       string;
  group_name:     string;
  jurisdiction_id: string | null;
}

const DC_KEYWORDS: RegExp[] = [
  /data\s+center/i,
  /hyperscale/i,
  /AI\s+(?:facility|campus|infrastructure)/i,
  /server\s+farm/i,
  /colocation|co-location/i,
  /(?:Google|Microsoft|Amazon|Meta|Oracle|Apple).{0,30}(?:build|campus|facility)/i,
  /megawatt|MW\b/i,
  /power\s+(?:plant|grid|demand)/i,
  /moratorium/i,
  /zoning.{0,30}(?:change|amend)/i,
  /tax\s+(?:abatement|exemption|incentive)/i,
];

const OPPOSITION_SIGNALS: RegExp[] = [
  /oppose/i, /against/i, /stop/i, /fight/i, /no\s+(?:more|new)/i,
  /concern/i, /worry/i, /threat/i, /danger/i, /harm/i,
  /noise/i, /water/i, /traffic/i, /ugly/i, /ruin/i,
];

const SUPPORT_SIGNALS: RegExp[] = [
  /support/i, /favor/i, /welcome/i, /good\s+for/i, /jobs/i,
  /economic/i, /tax\s+revenue/i, /growth/i, /progress/i, /benefit/i,
];

export function isDcRelevant(text: string): boolean {
  return DC_KEYWORDS.some(kw => kw.test(text));
}

export function computeSentiment(text: string): number {
  const opp     = OPPOSITION_SIGNALS.filter(p => p.test(text)).length;
  const support = SUPPORT_SIGNALS.filter(p => p.test(text)).length;
  const total   = opp + support;
  if (total === 0) return 0;
  return parseFloat(((support - opp) / total).toFixed(3));
}

export function computeEngagement(post: Data365GroupPost): number {
  return (post.likes_count ?? 0) +
         (post.comments_count ?? 0) * 2 +
         (post.shares_count ?? 0) * 3;
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

// Fetch posts for up to `batchSize` groups that haven't been fetched in 7 days.
export async function fetchGroupPostsBatch(batchSize = 100): Promise<void> {
  const s   = svc();
  const ago = new Date(Date.now() - 7 * 86_400_000).toISOString();

  const groups = await dbSelect<GroupRow>(
    s,
    'data365_group_registry',
    `is_active=eq.true` +
    `&or=(last_fetched_at.is.null,last_fetched_at.lt.${ago})` +
    `&order=last_fetched_at.asc.nullsfirst` +
    `&limit=${batchSize}` +
    `&select=group_id,group_name,jurisdiction_id`,
  );

  for (const group of groups) {
    try {
      const posts = await fetchGroupPosts(group.group_id, 30);

      if (posts.length > 0) {
        const postRows = posts.map(post => ({
          group_id:        group.group_id,
          jurisdiction_id: group.jurisdiction_id ?? null,
          fb_post_id:      post.id,
          post_text:       post.text?.slice(0, 5000) ?? null,
          post_url:        post.url ?? null,
          posted_at:       post.created_time ?? null,
          likes_count:     post.likes_count ?? 0,
          comments_count:  post.comments_count ?? 0,
          shares_count:    post.shares_count ?? 0,
          engagement_score: computeEngagement(post),
          is_dc_relevant:  isDcRelevant(post.text ?? ''),
          sentiment_score: computeSentiment(post.text ?? ''),
        }));

        await dbUpsert(s, 'data365_posts', postRows);
      }

      await dbPatch(
        s,
        'data365_group_registry',
        `group_id=eq.${encodeURIComponent(group.group_id)}`,
        { last_fetched_at: new Date().toISOString() },
      );

      await sleep(1100);
    } catch (e) {
      console.error(`Post fetch failed for group ${group.group_name}:`, e);
    }
  }
}
