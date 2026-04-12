'use client';

import Link from 'next/link';

export default function ChallengeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="w-full">
      {/* Challenge Navigation */}
      <nav className="bg-warm-white border-b border-sage/20 px-4 md:px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center">
          <Link
            href="/"
            className="flex items-center gap-2 text-forest hover:text-gold transition-smooth font-medium"
          >
            <span className="text-lg">←</span>
            <span>Back to Lobby</span>
          </Link>
        </div>
      </nav>

      {/* Challenge Content */}
      <main className="flex-grow w-full">
        {children}
      </main>
    </div>
  );
}
