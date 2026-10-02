// Faraday Academy — the player's own chrome.
//
// Scoped theme (light and dark) plus the landmark skeleton every page inherits:
// header, nav, main, aside. The engine's root layout stays chrome-free, so each
// surface brings its own masthead — this is the academy's.
//
// Fonts: the three brand faces (Bricolage Grotesque, IBM Plex Serif, IBM Plex
// Mono) are already loaded site-wide with display=swap by the root layout, so
// they are not re-declared here.

import Link from "next/link";
import type { Metadata } from "next";
import "./academy.css";
import { SkipToLesson } from "@/components/academy/primitives";
import { siteOrigin } from "@/lib/academy/origin";

export const metadata: Metadata = {
  // Without this, `alternates.canonical` and `openGraph.url` on every child page
  // render as relative paths, which are invalid as canonicals and useless to
  // social unfurlers.
  metadataBase: new URL(siteOrigin()),
  title: { default: "Faraday Academy", template: "%s · Faraday Academy" },
  description:
    "Read how the AI data center market actually works — power, cooling, water, land, capital and policy, taught from primary sources.",
};

export default function AcademyLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="academy-root min-h-screen">
      <SkipToLesson />
      <header style={{ borderBottom: "1px solid var(--ac-rule)" }}>
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
          <Link href="/academy" className="font-serif text-lg font-bold" style={{ color: "var(--ac-text)" }}>
            Faraday Academy
          </Link>
          <Link href="/" className="academy-meta">
            Faraday
          </Link>
        </div>
      </header>
      {children}
      <footer className="mt-20" style={{ borderTop: "1px solid var(--ac-rule)" }}>
        <div className="mx-auto max-w-6xl px-5 py-8">
          <p className="academy-meta">
            Every course is free to read during the beta.
          </p>
        </div>
      </footer>
    </div>
  );
}
