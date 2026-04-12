'use client';

import Link from 'next/link';
import { useState } from 'react';

interface Puzzle {
  id: string;
  icon: string;
  name: string;
  description: string;
  href: string;
  status: 'live' | 'coming-soon';
}

const puzzles: Puzzle[] = [
  {
    id: 'rackl',
    icon: '🟦',
    name: 'Rackl',
    description: 'Sort 16 terms into 4 hidden groups',
    href: '/challenge/rackl',
    status: 'live',
  },
  {
    id: 'signal-drop',
    icon: '📡',
    name: 'Signal Drop',
    description: 'Guess the hidden industry term in 6 tries',
    href: '/challenge/signal-drop',
    status: 'live',
  },
  {
    id: 'the-stack',
    icon: '📊',
    name: 'The Stack',
    description: 'Rank items in the correct order before time runs out',
    href: '/challenge/the-stack',
    status: 'live',
  },
  {
    id: 'circuit',
    icon: '⚡',
    name: 'Circuit',
    description: '10 true/false statements. 60 seconds. Go.',
    href: '/challenge/circuit',
    status: 'live',
  },
  {
    id: 'the-brief',
    icon: '📰',
    name: 'The Brief',
    description: 'Read. Analyze. Answer.',
    href: '/challenge/the-brief',
    status: 'coming-soon',
  },
  {
    id: 'dark-fiber',
    icon: '🔗',
    name: 'Dark Fiber',
    description: 'Match terms to their definitions',
    href: '/challenge/dark-fiber',
    status: 'coming-soon',
  },
  {
    id: 'frequency',
    icon: '📻',
    name: 'Frequency',
    description: 'Multiple choice mastery',
    href: '/challenge/frequency',
    status: 'coming-soon',
  },
];

export default function Home() {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const handleEmailSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (email) {
      setSubmitted(true);
      setEmail('');
      setTimeout(() => setSubmitted(false), 3000);
    }
  };

  return (
    <div className="w-full">
      {/* Hero Section */}
      <section className="bg-warm-cream px-4 md:px-6 py-12 md:py-20">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="font-serif text-4xl md:text-5xl font-bold text-near-black mb-4">
            The Daily Challenge
          </h1>
          <p className="text-lg md:text-xl text-near-black/70 mb-8">
            Test your data center intelligence.
          </p>
          <div className="double-rule" />
        </div>
      </section>

      {/* Puzzles Grid */}
      <section className="px-4 md:px-6 py-12 md:py-20">
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {puzzles.map((puzzle) => (
              <PuzzleCard key={puzzle.id} puzzle={puzzle} />
            ))}
          </div>
        </div>
      </section>

      {/* Tip of the Day */}
      <section className="bg-warm-cream px-4 md:px-6 py-12 md:py-16">
        <div className="max-w-3xl mx-auto">
          <div className="bg-warm-white border-l-4 border-gold p-6 md:p-8 shadow-sm">
            <h3 className="font-serif text-2xl font-bold text-forest mb-4">
              Tip of the Day
            </h3>
            <p className="text-near-black leading-relaxed">
              Data center efficiency is measured in PUE (Power Usage Effectiveness). A rating of 1.0 means
              100% of power goes to IT equipment; most modern facilities target 1.1–1.3. Every tenth of a
              point counts when you're operating thousands of servers across a global footprint.
            </p>
          </div>
        </div>
      </section>

      {/* Who Is Faraday */}
      <section className="px-4 md:px-6 py-12 md:py-20">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="font-serif text-3xl md:text-4xl font-bold text-forest mb-6">
            Who Is Faraday?
          </h2>
          <p className="text-lg text-near-black/80 leading-relaxed">
            Faraday is intelligence for data center professionals. We speak the language of infrastructure, power
            efficiency, colocation strategy, and network routing. Always on. Always ahead. The Faraday Daily Challenge
            keeps your mind sharp and your expertise current.
          </p>
        </div>
      </section>

      {/* Email Capture */}
      <section className="bg-warm-cream px-4 md:px-6 py-12 md:py-20">
        <div className="max-w-2xl mx-auto">
          <h3 className="font-serif text-3xl font-bold text-forest text-center mb-4">
            Stay Sharp
          </h3>
          <p className="text-center text-near-black/70 mb-8">
            Get daily challenges and intelligence insights delivered to your inbox.
          </p>

          <form onSubmit={handleEmailSubmit} className="flex flex-col sm:flex-row gap-3">
            <input
              type="email"
              placeholder="your@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="flex-grow px-4 py-3 bg-warm-white border border-sage/30 rounded text-near-black placeholder-near-black/40 focus:outline-none focus:ring-2 focus:ring-gold focus:border-transparent transition-colors"
            />
            <button
              type="submit"
              className="px-6 py-3 bg-gold hover:bg-gold-light text-forest font-semibold rounded transition-smooth whitespace-nowrap"
            >
              Join
            </button>
          </form>

          {submitted && (
            <p className="text-center text-sage mt-4">
              Thanks! Check your inbox to confirm.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}

function PuzzleCard({ puzzle }: { puzzle: Puzzle }) {
  const isLive = puzzle.status === 'live';
  const isClickable = isLive;

  const cardContent = (
    <div
      className={`h-full bg-forest hover-lift rounded-lg p-6 flex flex-col gap-4 ${
        isClickable ? 'cursor-pointer' : 'cursor-not-allowed'
      }`}
    >
      <div className="flex items-start justify-between">
        <span className="text-4xl">{puzzle.icon}</span>
        <StatusBadge status={puzzle.status} />
      </div>

      <div className="flex-grow">
        <h3 className="font-serif text-2xl font-bold text-warm-white mb-2">
          {puzzle.name}
        </h3>
        <p className="text-sage text-sm leading-relaxed">
          {puzzle.description}
        </p>
      </div>

      {isLive && (
        <div className="text-gold text-sm font-semibold">
          Play Now →
        </div>
      )}
    </div>
  );

  if (isClickable) {
    return (
      <Link href={puzzle.href}>
        {cardContent}
      </Link>
    );
  }

  return cardContent;
}

function StatusBadge({ status }: { status: 'live' | 'coming-soon' }) {
  if (status === 'live') {
    return (
      <span className="inline-block bg-green-500/90 text-warm-white text-xs font-semibold px-3 py-1 rounded-full">
        LIVE
      </span>
    );
  }

  return (
    <span className="inline-block bg-gold/30 text-gold text-xs font-semibold px-3 py-1 rounded-full">
      COMING SOON
    </span>
  );
}
