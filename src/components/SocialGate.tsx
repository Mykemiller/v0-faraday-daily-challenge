'use client';

import { useState } from 'react';
import { EDGE_FUNCTIONS_BASE } from '@/lib/supabase';

interface SocialGateProps {
  /** Where this gate is rendering — becomes the `source` field on the subscriber row. */
  trigger?: string;
  /** Called on successful registration — useful for closing modal variants. */
  onRegister?: (email: string) => void;
  /** Optional heading override; defaults to the lobby "Stay Sharp" copy. */
  heading?: string;
  /** Optional supporting copy shown under the heading. */
  subhead?: string;
}

export default function SocialGate({
  trigger = 'lobby-inline',
  onRegister,
  heading = 'Stay Sharp',
  subhead = 'Get daily challenges and intelligence insights delivered to your inbox.',
}: SocialGateProps) {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'sent' | 'error'>('idle');
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const normalized = email.trim().toLowerCase();
    if (!normalized || !normalized.includes('@')) {
      setError('Enter a valid email address');
      setStatus('error');
      return;
    }

    setStatus('loading');
    setError('');

    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const res = await fetch(`${EDGE_FUNCTIONS_BASE}/register-with-magic-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: normalized,
          source: `socialgate-${trigger}`,
          timezone,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || 'Registration failed');
      }
      setStatus('sent');
      onRegister?.(normalized);
    } catch (err) {
      console.error('SocialGate submit failed:', err);
      setError(err instanceof Error ? err.message : 'Something went wrong — please try again');
      setStatus('error');
    }
  }

  // Success state: user has been sent a magic link.
  if (status === 'sent') {
    return (
      <div className="max-w-2xl mx-auto text-center">
        <h3 className="font-serif text-3xl font-bold text-forest mb-4">Check your inbox</h3>
        <p className="text-near-black/80 leading-relaxed mb-2">
          We sent a magic link to <strong>{email}</strong>.
        </p>
        <p className="text-sm text-near-black/60">
          The link activates your profile and expires in 15 minutes. If you don&apos;t see it, check your spam folder.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      <h3 className="font-serif text-3xl font-bold text-forest text-center mb-4">{heading}</h3>
      <p className="text-center text-near-black/70 mb-8">{subhead}</p>

      <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-3">
        <input
          type="email"
          placeholder="your@email.com"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (status === 'error') setStatus('idle');
          }}
          disabled={status === 'loading'}
          required
          className="flex-grow px-4 py-3 bg-warm-white border border-sage/30 rounded text-near-black placeholder-near-black/40 focus:outline-none focus:ring-2 focus:ring-gold focus:border-transparent transition-colors disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={status === 'loading'}
          className="px-6 py-3 bg-gold hover:bg-gold-light text-forest font-semibold rounded transition-smooth whitespace-nowrap disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {status === 'loading' ? 'Sending…' : 'Join'}
        </button>
      </form>

      {status === 'error' && error && (
        <p className="text-center text-red-600 mt-4 text-sm">{error}</p>
      )}
    </div>
  );
}
