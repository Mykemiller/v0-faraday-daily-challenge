// Opposition signal aggregation — rolls up DC-relevant Facebook posts into
// per-jurisdiction daily signals and updates jurisdictions.dim_opposition.
//
// dim_opposition mapping: weighted_sentiment (-1→+1) → JPS scale (0→5)
//   strong support  (+1.0) → 0.0   (no opposition)
//   neutral          (0.0) → 2.5
//   strong opposition(-1.0) → 5.0  (maximum opposition)

import { svc, dbSelect, dbUpsert, dbPatch } from './svc';

interface PostRow {
  jurisdiction_id:  string;
  sentiment_score:  number | null;
  engagement_score: number | null;
  post_url:         string | null;
  posted_at:        string | null;
}

export async function aggregateOppositionSignals(lookbackDays = 90): Promise<void> {
  const s     = svc();
  const since = new Date(Date.now() - lookbackDays * 86_400_000).toISOString();

  const posts = await dbSelect<PostRow>(
    s,
    'data365_posts',
    `is_dc_relevant=eq.true` +
    `&posted_at=gte.${since}` +
    `&select=jurisdiction_id,sentiment_score,engagement_score,post_url,posted_at`,
  );

  if (posts.length === 0) {
    console.log('Opposition aggregation: no DC-relevant posts in lookback window');
    return;
  }

  // Group by jurisdiction
  const byJurisdiction = new Map<string, PostRow[]>();
  for (const post of posts) {
    if (!post.jurisdiction_id) continue;
    const existing = byJurisdiction.get(post.jurisdiction_id) ?? [];
    existing.push(post);
    byJurisdiction.set(post.jurisdiction_id, existing);
  }

  const today = new Date().toISOString().split('T')[0];

  for (const [jurisdictionId, jPosts] of byJurisdiction) {
    const totalEngagement = jPosts.reduce(
      (s, p) => s + (p.engagement_score ?? 0), 0,
    );

    const weightedSentiment = totalEngagement > 0
      ? jPosts.reduce(
          (s, p) => s + (p.sentiment_score ?? 0) * (p.engagement_score ?? 1), 0,
        ) / totalEngagement
      : jPosts.reduce((s, p) => s + (p.sentiment_score ?? 0), 0) / jPosts.length;

    const avgSentiment =
      jPosts.reduce((s, p) => s + (p.sentiment_score ?? 0), 0) / jPosts.length;

    const topPost = [...jPosts].sort(
      (a, b) => (b.engagement_score ?? 0) - (a.engagement_score ?? 0),
    )[0];

    await dbUpsert(s, 'data365_opposition_signals', {
      jurisdiction_id:    jurisdictionId,
      signal_date:        today,
      post_count:         jPosts.length,
      avg_sentiment:      parseFloat(avgSentiment.toFixed(3)),
      weighted_sentiment: parseFloat(weightedSentiment.toFixed(3)),
      opposition_posts:   jPosts.filter(p => (p.sentiment_score ?? 0) < -0.2).length,
      support_posts:      jPosts.filter(p => (p.sentiment_score ?? 0) > 0.2).length,
      neutral_posts:      jPosts.filter(
        p => Math.abs(p.sentiment_score ?? 0) <= 0.2,
      ).length,
      top_post_url:         topPost?.post_url ?? null,
      top_post_engagement:  topPost ? Math.round(topPost.engagement_score ?? 0) : null,
      idf_ingested:         false,
      computed_at:          new Date().toISOString(),
    });

    // Map weighted_sentiment (-1→+1) to JPS dim_opposition scale (0→5).
    // High opposition (sentiment = -1) → score 5; strong support (+1) → score 0.
    const dimOpposition = parseFloat(
      (((weightedSentiment * -1) + 1) / 2 * 5).toFixed(2),
    );

    await dbPatch(
      s,
      'jurisdictions',
      `id=eq.${jurisdictionId}`,
      { dim_opposition: dimOpposition },
    );
  }

  console.log(
    `Opposition aggregation complete: ${byJurisdiction.size} jurisdictions updated`,
  );
}
