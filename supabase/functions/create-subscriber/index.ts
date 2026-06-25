import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const HANDLE_RE = /^[a-z0-9_]{3,20}$/;
const SESSION_TTL_DAYS = 30;
const MAX_TEAMS = 5;

function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const { email, handle, team_ids = [] } = await req.json();

    if (!email || typeof email !== 'string') {
      return new Response(JSON.stringify({ error: 'missing_email' }), {
        status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }
    if (!handle || !HANDLE_RE.test(handle)) {
      return new Response(JSON.stringify({ error: 'invalid_handle' }), {
        status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }
    if (!Array.isArray(team_ids) || team_ids.length > MAX_TEAMS) {
      return new Response(JSON.stringify({ error: 'too_many_teams' }), {
        status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Verify email recently passed OTP (must have a used otp_session in last 15 min)
    const { data: recentOtp } = await supabase
      .from('otp_sessions')
      .select('id')
      .eq('email', normalizedEmail)
      .eq('used', true)
      .gt('expires_at', new Date(Date.now() - 15 * 60 * 1000).toISOString())
      .limit(1);

    if (!recentOtp?.length) {
      return new Response(JSON.stringify({ error: 'otp_not_verified' }), {
        status: 403, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    // Check subscriber doesn't already exist
    const { data: existing } = await supabase
      .from('dc_subscribers')
      .select('id')
      .eq('email', normalizedEmail)
      .limit(1);

    if (existing?.length) {
      return new Response(JSON.stringify({ error: 'subscriber_exists' }), {
        status: 409, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    // Check handle uniqueness
    const { data: handleCheck } = await supabase
      .from('dc_subscribers')
      .select('id')
      .eq('handle', handle)
      .limit(1);

    if (handleCheck?.length) {
      return new Response(JSON.stringify({ error: 'handle_taken' }), {
        status: 409, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    // Create subscriber
    const { data: newSub, error: subErr } = await supabase
      .from('dc_subscribers')
      .insert({ email: normalizedEmail, handle })
      .select('id, handle, email, play_streak, full_set_streak, mw_balance, active')
      .single();

    if (subErr || !newSub) {
      throw subErr ?? new Error('subscriber_insert_failed');
    }

    // Get active season for team memberships
    const { data: seasonRows } = await supabase
      .from('seasons')
      .select('id')
      .eq('status', 'active')
      .limit(1);

    const activeSeason = seasonRows?.[0];

    // Create team memberships (if teams selected and season active)
    if (activeSeason && team_ids.length > 0) {
      const memberships = team_ids.slice(0, MAX_TEAMS).map((tid: string) => ({
        subscriber_id: newSub.id,
        team_id: tid,
        season_id: activeSeason.id,
        pending: false,
      }));

      await supabase.from('team_memberships').insert(memberships);
    }

    // Issue session token
    const sessionToken = randomHex(32);
    const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();

    await supabase.from('dc_sessions').insert({
      token: sessionToken,
      subscriber_id: newSub.id,
      expires_at: expiresAt,
    });

    return new Response(
      JSON.stringify({
        status: 'created',
        session_token: sessionToken,
        subscriber: {
          id: newSub.id,
          email: normalizedEmail,
          handle: newSub.handle,
          play_streak: 0,
          full_set_streak: 0,
          mw_balance: 0,
          active: true,
        },
      }),
      {
        status: 201,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      },
    );
  } catch (err) {
    console.error('create-subscriber error', err);
    return new Response(JSON.stringify({ error: 'internal_error' }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
