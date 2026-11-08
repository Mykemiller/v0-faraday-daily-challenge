"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import BrandMark from "@/components/BrandMark";
import SiteFooter from "@/components/SiteFooter";
import { DISCLAIMER } from "@/lib/predicts-v3";
import type { PredictsRecord } from "@/lib/predicts";
import PredictsMark from "./components/PredictsMark";
import RecordPill from "./components/RecordPill";
import { useWatchlist } from "./hooks/useWatchlist";

// The /predicts app shell: forest masthead (kept), sticky app bar, segmented
// tabs ≥768px, fixed bottom tab bar on phones, and the disclaimer footer.

type Props = { children: React.ReactNode; record: PredictsRecord | null; releaseTag: string | null; showMovers: boolean };

type Tab = { href: string; label: string; icon: React.ReactNode; match: (p: string) => boolean };

const ICON = { width: 22, height: 22, viewBox: "0 0 22 22", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };

export default function PredictsShell({ children, record, releaseTag, showMovers }: Props) {
  const pathname = usePathname() ?? "/predicts";
  const { list } = useWatchlist();
  const tabs: Tab[] = [
    {
      href: "/predicts",
      label: "Open",
      match: (p: string) => p === "/predicts" || /^\/predicts\/(?!movers|record|receipts)[^/]+/.test(p),
      icon: (
        <svg {...ICON}>
          <rect x="3" y="3" width="7" height="7" rx="1.5" />
          <rect x="12" y="3" width="7" height="7" rx="1.5" />
          <rect x="3" y="12" width="7" height="7" rx="1.5" />
          <rect x="12" y="12" width="7" height="7" rx="1.5" />
        </svg>
      ),
    },
    {
      href: "/predicts/movers",
      label: "Movers",
      match: (p: string) => p.startsWith("/predicts/movers"),
      icon: (
        <svg {...ICON}>
          <path d="M3 15l5-5 4 4 7-7" />
          <path d="M14 7h5v5" />
        </svg>
      ),
    },
    {
      href: "/predicts/record",
      label: "Record",
      match: (p: string) => p.startsWith("/predicts/record"),
      icon: (
        <svg {...ICON}>
          <path d="M4 18V9M9 18V4M14 18v-6M19 18v-9" />
        </svg>
      ),
    },
    {
      href: "/predicts/receipts",
      label: "Receipts",
      match: (p: string) => p.startsWith("/predicts/receipts"),
      icon: (
        <svg {...ICON}>
          <path d="M5 3h12v16l-3-2-3 2-3-2-3 2z" />
          <path d="M8 8h6M8 12h4" />
        </svg>
      ),
    },
  ].filter((t) => showMovers || t.href !== "/predicts/movers");

  return (
    <div className="min-h-screen bg-warm-white font-sans text-near-black">
      <div className="h-0.5 bg-gold" />
      <div className="bg-forest">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2">
          <Link href="/" className="flex min-h-[36px] items-center gap-2" aria-label="Faraday home">
            <BrandMark size={18} framed />
            <span className="font-serif text-[14px] font-bold tracking-wide text-warm-white">Faraday</span>
          </Link>
          <Link href="/" className="ml-auto font-mono text-[11px] text-warm-cream hover:text-gold-light">
            ← All storefronts
          </Link>
        </div>
      </div>
      <div className="h-0.5 bg-gold" />

      <header className="sticky top-0 z-20 border-b border-cream-border bg-warm-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2">
          <Link href="/predicts" className="flex min-h-[44px] items-center gap-2.5">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-forest">
              <PredictsMark size={28} onDark />
            </span>
            <span className="font-serif text-[18px] font-bold text-near-black">Faraday Predicts</span>
          </Link>
          <div className="ml-auto">
            <RecordPill record={record} />
          </div>
        </div>
        <nav className="mx-auto hidden max-w-6xl px-4 md:block" aria-label="Predicts sections">
          <div role="tablist" className="flex gap-6">
            {tabs.map((t) => {
              const sel = t.match(pathname);
              return (
                <Link
                  key={t.href}
                  href={t.href}
                  role="tab"
                  aria-selected={sel}
                  className={`border-b-2 pb-2 pt-1 font-sans text-[15px] font-medium ${
                    sel ? "border-gold text-near-black" : "border-transparent text-near-black/65 hover:text-near-black"
                  }`}
                >
                  {t.label}
                </Link>
              );
            })}
          </div>
        </nav>
      </header>

      <div className="pb-24 md:pb-0">
        {children}
        <SiteFooter />
        <div className="mx-auto max-w-5xl px-5 pb-8">
          <p className="max-w-3xl font-sans text-[14px] leading-relaxed text-near-black/75">{DISCLAIMER}</p>
          <p className="mt-2 font-mono text-[12px] text-sage-dark">Faraday Predicts · Release {releaseTag ?? "unreleased"}</p>
        </div>
      </div>

      <nav
        aria-label="Predicts sections"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-gold bg-forest md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div role="tablist" className="mx-auto flex max-w-md">
          {tabs.map((t) => {
            const sel = t.match(pathname);
            return (
              <Link
                key={t.href}
                href={t.href}
                role="tab"
                aria-selected={sel}
                className={`relative flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5 font-sans text-[11px] ${
                  sel ? "text-gold" : "text-warm-cream"
                }`}
              >
                {t.icon}
                <span>{t.label}</span>
                {t.href === "/predicts" && list.length > 0 && (
                  <span className="absolute right-[30%] top-2 h-2 w-2 rounded-full bg-gold" aria-label="You are watching forecasts" />
                )}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
