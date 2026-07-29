// DC messaging directory — handle search for "New Message" (CC-DC-MESSAGING-1.0).
//
// ⚠️ Open DM reach means this endpoint is effectively a player directory for
// every signed-in user: anyone with a session can enumerate handles by prefix.
// That is the accepted trade-off of the chosen v1 design (block is the only
// reach control; a "who can message me" setting is the named fast-follow).
// If DM reach is ever widened or narrowed, revisit THIS file first — it is
// the surface where that decision becomes visible.
//
// GET /api/messages/directory?token=&q=
//   → [{ subscriber_id, handle }] — handle ONLY. Never email, never streaks,
//     never any other column. Empty/short q returns [], not the full roster.

import {
  SUPABASE_URL,
  svcHeaders,
  resolveSubscriber,
  loadBlocksFor,
  displayHandle,
} from '@/lib/messaging/server';
import { isPairBlocked } from '@/lib/messaging/rules';

export const dynamic = 'force-dynamic';

const MIN_QUERY_CHARS = 2;
const MAX_RESULTS = 20;

export async function GET(request: Request) {
  const h = svcHeaders();
  if (!h) return Response.json({ error: 'not_configured' }, { status: 500 });

  const { searchParams } = new URL(request.url);
  const token = searchParams.get('token') ?? '';
  const q = (searchParams.get('q') ?? '').trim();

  const viewer = token ? await resolveSubscriber(h, token) : null;
  if (!viewer) return Response.json({ error: 'invalid_session' }, { status: 401 });

  if (q.length < MIN_QUERY_CHARS) return Response.json([]);

  // Escape LIKE wildcards so a literal % or _ in the query can't widen the
  // prefix match; handle is citext, so ilike is belt-and-braces.
  const escaped = q.replace(/([%_\\])/g, '\\$1');
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/dc_subscribers?handle=ilike.${encodeURIComponent(`${escaped}%`)}&active=eq.true&id=neq.${encodeURIComponent(viewer.id)}&select=id,handle,email&order=handle.asc&limit=${MAX_RESULTS * 2}`,
    { headers: h, cache: 'no-store' }
  );
  if (!r.ok) return Response.json([]);
  const rows: Array<{ id: string; handle: string | null; email: string | null }> =
    await r.json().catch(() => []);

  const blocks = await loadBlocksFor(h, viewer.id);
  const results = (Array.isArray(rows) ? rows : [])
    .filter(s => !isPairBlocked(blocks, viewer.id, s.id))
    .slice(0, MAX_RESULTS)
    .map(s => ({ subscriber_id: s.id, handle: displayHandle(s) }));

  return Response.json(results);
}
