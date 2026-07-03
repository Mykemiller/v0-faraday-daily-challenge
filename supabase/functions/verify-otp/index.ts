import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SESSION_TTL_DAYS = 30;

function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const { email, code } = await req.json();
    if (!email || !code) {
      return new Response(JSON.stringify({ error: 'missing_fields' }), {
        status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Find a valid, unused, unexpired OTP for this email
    const { data: otpRows } = await supabase
      .from('otp_sessions')
      .select('id, code, expires_at')
      .eq('email', normalizedEmail)
      .eq('used', false)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1);

    const otp = otpRows?.[0];

    // Constant-time compare: don't short-circuit on mismatch
    const codeMatch = otp && timingSafeEqual(otp.code, String(code).trim());

    if (!otp || !codeMatch) {
      return new Response(JSON.stringify({ error: 'invalid_code' }), {
        status: 401,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    // Mark OTP used
    await supabase.from('otp_sessions').update({ used: true }).eq('id', otp.id);

    // Check if subscriber exists
    const { data: subscriberRows } = await supabase
      .from('dc_subscribers')
      .select('id, handle, email, play_streak, full_set_streak, active')
      .eq('email', normalizedEmail)
      .limit(1);

    const subscriber = subscriberRows?.[0];

    if (!subscriber) {
      // New player — client will prompt for handle + team selection
      return new Response(JSON.stringify({ status: 'new_subscriber', email: normalizedEmail }), {
        status: 200,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    // Existing subscriber — issue session token
    const sessionToken = randomHex(32);
    const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();

    await supabase.from('dc_sessions').insert({
      token: sessionToken,
      subscriber_id: subscriber.id,
      expires_at: expiresAt,
    });

    // Update last_seen_at
    await supabase
      .from('dc_subscribers')
      .update({ last_seen_at: new Date().toISOString() })
      .eq('id', subscriber.id);

    return new Response(
      JSON.stringify({
        status: 'authenticated',
        session_token: sessionToken,
        subscriber: {
          id: subscriber.id,
          email: normalizedEmail,
          handle: subscriber.handle,
          play_streak: subscriber.play_streak,
          full_set_streak: subscriber.full_set_streak,
          active: subscriber.active,
        },
      }),
      {
        status: 200,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      },
    );
  } catch (err) {
    console.error('verify-otp error', err);
    return new Response(JSON.stringify({ error: 'internal_error' }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // Still iterate to avoid timing leak on length
    let acc = 1;
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      acc |= (a.charCodeAt(i % a.length) ^ b.charCodeAt(i % b.length));
    }
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
