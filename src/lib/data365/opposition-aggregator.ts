// Data365 opposition aggregator.
// Reads recent data365_posts (last 7 days) and writes aggregated
// sentiment / opposition signals to dim_opposition on jurisdictions.

import { Svc } from '@/lib/pipeline-utils';

const OPPOSITION_KEYWORDS = [
  'oppose', 'opposition', 'against', 'stop', 'halt', 'ban',
  'moratorium', 'reject', 'no data center', 'too much power',
  'noise', 'traffic', 'water usage', 'environmental', 'concerned',
];
const SUPPORT_KEYWORDS = [
  'support', 'jobs', 'economic', 'welcome', 'approve', 'benefit',
  'tax revenue', 'infrastructure', 'growth',
];

export async function aggregateOppositionSignals(svc: Svc): Promise<{ updated: number }> {
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();

  // Fetch recent posts that have a jurisdiction_id set
  const r = await fetch(
    `${svc.base}/data365_posts?fetched_at=gte.${since}&jurisdiction_id=not.is.null` +
    `&select=jurisdiction_id,post_text,reaction_count,comment_count&limit=5000`,
    { headers: svc.headers, cache: 'no-store' }
  );
  if (!r.ok) return { updated: 0 };

  const posts: Post[] = await r.json().catch(() => []);

  // Group by jurisdiction
  const byJurisdiction: Record<string, Post[]> = {};
  for (const post of posts) {
    if (!post.jurisdiction_id) continue;
    byJurisdiction[post.jurisdiction_id] ??= [];
    byJurisdiction[post.jurisdiction_id].push(post);
  }

  let updated = 0;
  for (const [jurisdictionId, jPosts] of Object.entries(byJurisdiction)) {
    const { oppositionScore, sentimentLabel } = computeOppositionScore(jPosts);

    const patch = await fetch(`${svc.base}/jurisdictions?id=eq.${jurisdictionId}`, {
      method:  'PATCH',
      headers: svc.headers,
      body:    JSON.stringify({
        dim_opposition:       oppositionScore,
        last_scored_at:       new Date().toISOString(),
        opposition_sentiment: sentimentLabel,
      }),
    });
    if (patch.ok) updated++;
  }

  return { updated };
}

function computeOppositionScore(posts: Post[]): {
  oppositionScore: number;
  sentimentLabel:  'supportive' | 'neutral' | 'cautious' | 'opposed';
} {
  let oppCount  = 0;
  let supCount  = 0;
  let totalWeight = 0;

  for (const post of posts) {
    const text   = (post.post_text ?? '').toLowerCase();
    const weight = 1 + Math.log1p(post.reaction_count + post.comment_count);

    const opp = OPPOSITION_KEYWORDS.filter(k => text.includes(k)).length;
    const sup = SUPPORT_KEYWORDS.filter(k => text.includes(k)).length;

    oppCount  += opp  * weight;
    supCount  += sup  * weight;
    totalWeight += weight;
  }

  if (totalWeight === 0) return { oppositionScore: 3.0, sentimentLabel: 'neutral' };

  const oppRatio = oppCount / totalWeight;
  const supRatio = supCount / totalWeight;

  // Scale: 1 (strong opposition) → 5 (strong support), neutral = 3
  const raw    = 3 + (supRatio - oppRatio) * 4;
  const clamped = Math.max(1, Math.min(5, raw));
  const score  = parseFloat(clamped.toFixed(2));

  const label: 'supportive' | 'neutral' | 'cautious' | 'opposed' =
    score >= 4.0 ? 'supportive' :
    score >= 3.0 ? 'neutral'    :
    score >= 2.0 ? 'cautious'   : 'opposed';

  return { oppositionScore: score, sentimentLabel: label };
}

interface Post {
  jurisdiction_id: string;
  post_text:       string | null;
  reaction_count:  number;
  comment_count:   number;
}
