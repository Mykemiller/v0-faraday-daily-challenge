import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const FROM_EMAIL = 'challenge@faraday-intelligence.ai';
const OTP_TTL_MINUTES = 10;

function generateCode(): string {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return String(arr[0] % 1_000_000).padStart(6, '0');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const { email } = await req.json();
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return new Response(JSON.stringify({ error: 'invalid_email' }), {
        status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const code = generateCode();
    const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000).toISOString();

    // Mark any prior unused codes for this email as used (one active code at a time)
    await supabase
      .from('otp_sessions')
      .update({ used: true })
      .eq('email', normalizedEmail)
      .eq('used', false);

    const { error: insertErr } = await supabase
      .from('otp_sessions')
      .insert({ email: normalizedEmail, code, expires_at: expiresAt });

    if (insertErr) throw insertErr;

    // Send via Resend
    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('RESEND_API_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: normalizedEmail,
        subject: 'Your Faraday Challenge code',
        text: `Your access code is ${code}. It expires in ${OTP_TTL_MINUTES} minutes.\n\nIf you didn't request this, you can ignore this email.`,
      }),
    });

    if (!resendRes.ok) {
      const resendBody = await resendRes.text();
      console.error('Resend error', resendRes.status, resendBody);
      throw new Error(`email_send_failed: ${resendRes.status}`);
    }

    // Always return 200 — never reveal whether the email is registered
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('send-otp error', err);
    return new Response(JSON.stringify({ error: 'internal_error' }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
