import Link from "next/link";
import type { ReactNode } from "react";
import SiteHeaderNav from "@/components/SiteHeaderNav";

// Shared layout for stubbed Daily Challenge pages reached from the header
// dropdowns (Help & Feedback, Compete, More Faraday). Wears the DC masthead
// (SiteHeaderNav) rather than the storefront StubPage shell, and is framed as
// "Coming soon" so a stub is never mistaken for a finished page.

export default function DcStubPage({
  title,
  blurb,
  children,
}: {
  title: string;
  /** One-sentence framing of what this page will become. */
  blurb: string;
  children?: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-warm-white font-sans text-near-black">
      <SiteHeaderNav />
      <main className="mx-auto max-w-2xl px-5 pb-16 pt-10">
        <span className="inline-block rounded bg-gold/20 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-amber-dark">
          Coming soon
        </span>
        <h1 className="mt-4 font-serif text-3xl font-bold text-forest">{title}</h1>
        <p className="mt-3 max-w-[52ch] text-[15px] leading-relaxed text-near-black/70">{blurb}</p>
        {children && (
          <div className="mt-6 space-y-3 text-[14px] leading-relaxed text-near-black/70">{children}</div>
        )}
        <p className="mt-10 font-mono text-[11px] text-near-black/50">
          <Link href="/challenge" className="underline hover:text-forest">← Back to the Daily Challenge</Link>
        </p>
      </main>
    </div>
  );
}
