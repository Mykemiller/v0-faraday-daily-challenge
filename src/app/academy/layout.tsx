// Faraday Academy — the player's own chrome.
//
// Scoped theme (light and dark) plus the landmark skeleton every page inherits:
// header, nav, main, aside. The engine's root layout stays chrome-free, so each
// surface brings its own masthead — this is the academy's.
//
// FDY-459 (BRAND-1): the header is the shared Faraday masthead (vendored, never
// edited, at src/lib/faraday-masthead — the same copy FDY-445 put on the DC apps),
// with a single top-level AppBar link under it. It wraps every player view —
// catalog, course home, lesson reader, module review, quiz, glossary, 404 — so the
// course outline and progress stay inside each page, unchanged.
//   · The mark/wordmark go to the catalog's canonical URL (canonicalUrl("/academy"),
//     i.e. www.faraday-player.com/ unless NEXT_PUBLIC_SITE_ORIGIN says otherwise).
//   · The player has no reader sign-in (every lesson is open; progress sync only
//     runs with a Supabase Auth session, which nothing issues today), so there is no
//     email to show and no "Sign in" link — the masthead's default would point at a
//     /sign-in route the player does not have (see AcademyMasthead).
//   · Masthead and AppBar sit OUTSIDE .academy-root so the academy's scoped
//     focus-visible rule does not override the masthead's own gold focus ring.
//   · The masthead's skip link targets #academy-main, which every page's <main>
//     carries, so it replaces the academy's own "Skip to the lesson" link.
//
// Fonts: the three brand faces (Bricolage Grotesque, IBM Plex Serif, IBM Plex
// Mono) are already loaded site-wide with display=swap by the root layout, so
// they are not re-declared here.

import type { Metadata } from "next";
import "./academy.css";
import { AppBar } from "@/lib/faraday-masthead/ui/Masthead.tsx";
import AcademyMasthead from "@/components/academy/AcademyMasthead";
import { canonicalUrl, siteOrigin } from "@/lib/academy/origin";

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
    <>
      <AcademyMasthead homeHref={canonicalUrl("/academy")} />
      <AppBar label="Faraday Academy" links={[{ label: "Courses", href: "/academy" }]} />
      <div className="academy-root min-h-screen">
        {children}
        <footer className="mt-20" style={{ borderTop: "1px solid var(--ac-rule)" }}>
          <div className="mx-auto max-w-6xl px-5 py-8">
            <p className="academy-meta">
              Every course is free to read during the beta.
            </p>
          </div>
        </footer>
      </div>
    </>
  );
}
