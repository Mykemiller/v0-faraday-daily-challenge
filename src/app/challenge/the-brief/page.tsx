'use client';

import { useState } from 'react';
import Link from 'next/link';

export default function TheBriefPage() {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const handleNotifyMe = (e: React.FormEvent) => {
    e.preventDefault();
    if (email.trim()) {
      setSubmitted(true);
      setEmail('');
      setTimeout(() => setSubmitted(false), 3000);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ backgroundColor: '#F8F5F0' }}>
      {/* Back Link */}
      <div className="absolute top-6 left-6">
        <Link
          href="/"
          className="text-sm font-medium transition-colors"
          style={{ color: '#244228' }}
        >
          ← Back to Challenge Lobby
        </Link>
      </div>

      {/* Card */}
      <div className="w-full max-w-md p-8 rounded-lg shadow-lg" style={{ backgroundColor: '#FFFFFF' }}>
        {/* Badge */}
        <div className="flex justify-center mb-8">
          <span
            className="px-3 py-1 text-xs font-bold rounded-full uppercase tracking-wide"
            style={{ backgroundColor: '#DAB050', color: '#141210' }}
          >
            Coming Soon
          </span>
        </div>

        {/* Emoji and Title */}
        <div className="text-center mb-8">
          <div className="text-5xl mb-4">📰</div>
          <h1 className="text-3xl font-bold" style={{ color: '#1C3424' }}>
            The Brief
          </h1>
        </div>

        {/* Descriptions */}
        <div className="text-center mb-8 space-y-4">
          <p className="font-semibold" style={{ color: '#244228' }}>
            Read a short intelligence passage. Answer questions to prove you understood.
          </p>
          <p className="text-sm italic" style={{ color: '#8CA68A' }}>
            Reading comprehension meets market intelligence.
          </p>
        </div>

        {/* Email Input */}
        <form onSubmit={handleNotifyMe} className="space-y-3">
          <input
            type="email"
            placeholder="your@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-4 py-3 border-2 rounded-md text-sm focus:outline-none transition-colors"
            style={{
              borderColor: '#325638',
              color: '#141210',
              backgroundColor: '#F8F5F0',
            }}
            onFocus={(e) => (e.target.style.borderColor = '#C4922A')}
            onBlur={(e) => (e.target.style.borderColor = '#325638')}
            required
          />
          <button
            type="submit"
            className="w-full py-3 px-4 font-semibold rounded-md transition-all duration-200 text-sm uppercase tracking-wide"
            style={{
              backgroundColor: '#C4922A',
              color: '#FFFFFF',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#B8821F')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#C4922A')}
          >
            Notify Me
          </button>
        </form>

        {/* Success Message */}
        {submitted && (
          <div className="mt-4 p-3 rounded-md text-center text-sm font-medium" style={{ backgroundColor: '#EEE6DA', color: '#1C3424' }}>
            You'll be notified!
          </div>
        )}
      </div>
    </div>
  );
}
