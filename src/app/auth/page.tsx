'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  EDGE_FUNCTIONS_BASE,
  SESSION_STORAGE_KEY,
  EMAIL_STORAGE_KEY,
} from '@/lib/supabase';

type Status = 'verifying' | 'success' | 'error';

function AuthHandler() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<Status>('verifying');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    const token = searchParams.get('token');
    if (!token) {
      setStatus('error');
      setErrorMsg('Missing token — try requesting a new magic link.');
      return;
    }

    let cancelled = false;

    fetch(`${EDGE_FUNCTIONS_BASE}/verify-magic-link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
      .then((r) => r.json().then((data) => ({ ok: r.ok, data })))
      .then(({ ok, data }) => {
        if (cancelled) return;
        if (!ok || !data?.ok) {
          setStatus('error');
          setErrorMsg(data?.error || 'Verification failed.');
          return;
        }

        try {
          localStorage.setItem(SESSION_STORAGE_KEY, data.sessionToken);
          localStorage.setItem(EMAIL_STORAGE_KEY, data.subscriber.email);
        } catch {
          // If storage is disabled (private mode), still count the verify as success;
          // the user will just need to request a new link on their next visit.
        }

        setStatus('success');
        // Small delay so the user sees the confirmation before the redirect.
        setTimeout(() => {
          if (!cancelled) router.replace('/');
        }, 800);
      })
      .catch((e) => {
        if (cancelled) return;
        console.error('verify-magic-link failed:', e);
        setStatus('error');
        setErrorMsg('Network error — please try again.');
      });

    return () => {
      cancelled = true;
    };
  }, [router, searchParams]);

  if (status === 'verifying') {
    return (
      <p className="text-lg text-near-black/70" aria-live="polite">
        Activating your profile…
      </p>
    );
  }

  if (status === 'success') {
    return (
      <div className="text-center">
        <p className="font-serif text-2xl text-forest mb-2">You&apos;re in.</p>
        <p className="text-sm text-near-black/60">Redirecting to the lobby…</p>
      </div>
    );
  }

  return (
    <div className="text-center max-w-md">
      <p className="font-serif text-2xl text-forest mb-2">Link didn&apos;t work</p>
      <p className="text-near-black/70 mb-6">{errorMsg}</p>
      <Link
        href="/"
        className="inline-block px-6 py-3 bg-gold hover:bg-gold-light text-forest font-semibold rounded transition-smooth"
      >
        Back to the lobby
      </Link>
    </div>
  );
}

export default function AuthPage() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4 py-16">
      <Suspense fallback={<p className="text-lg text-near-black/70">Activating your profile…</p>}>
        <AuthHandler />
      </Suspense>
    </div>
  );
}
