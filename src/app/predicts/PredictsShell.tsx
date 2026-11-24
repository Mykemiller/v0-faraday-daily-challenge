"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import SiteFooter from "@/components/SiteFooter";
import { DISCLAIMER } from "@/lib/predicts-v3";
import type { PredictsRecord } from "@/lib/predicts";
import { Masthead, AppBar } from "@/lib/faraday-masthead/ui/Masthead.tsx";
import RecordPill from "./components/RecordPill";
import { useWatchlist } from "./hooks/useWatchlist";

// The /predicts app shell: the shared Faraday masthead (FDY-445, CC-BRAND-MASTHEAD-1.0 — vendored at
// src/lib/faraday-masthead, never edited here), a sticky AppBar carrying the existing Predicts nav
// (section tabs ≥768px, the record pill, "← All storefronts"), the fixed bottom tab bar on phones
// (unchanged — on phones it is the section nav, so the AppBar does not repeat the tabs there), and
// the disclaimer footer.

type Props = {
  children: React.ReactNode; record: PredictsRecord | null; releaseTag: string | null; showMovers: boolean;
  /** The email the access gate verified, when it looked one up (mode "open" does no identity lookup). */
  email?: string | null;
};

type Tab = { href: string; label: string; icon: React.ReactNode; match: (p: string) => boolean };

const ICON = { width: 22, height: 22, viewBox: "0 0 22 22", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };

export default function PredictsShell({ children, record, releaseTag, showMovers, email = null }: Props) {
  const pathname = usePathname() ?? "/predicts";
  const { list } = useWatchlist();
  const tabs: Tab[] = [
    {
      href: "/predicts",
      label: "Open",
      match: (p: string) => p === "/predicts" || /^\/predicts\/(?!movers|record|receipts|preferences)[^/]+/.test(p),
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
      <Masthead appName="Faraday Predicts" homeHref="/predicts" email={email} signInHref="/account" />
      <div className="sticky top-0 z-30">
        <AppBar label="Faraday Predicts">
          <span className="hidden items-center gap-1 md:flex">
            {tabs.map((t) => {
              const sel = t.match(pathname);
              return (
                <Link key={t.href} href={t.href} className="fm-applink" aria-current={sel ? "page" : undefined}>
                  {t.label}
                </Link>
              );
            })}
          </span>
          <span className="ml-auto flex items-center gap-1">
            <RecordPill record={record} />
            <Link href="/" className="fm-applink">
              ← All storefronts
            </Link>
          </span>
        </AppBar>
      </div>

      <div id="main" className="pb-24 md:pb-0">
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
