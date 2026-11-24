import type { Metadata } from "next";
import "./predicts.css";
import { PREDICTS_MANIFEST_PATH, PWA_COPY } from "@/lib/predicts-pwa";

// FDY-127 (CC-PREDICTS-PWA-1.0 D1): /predicts/* links its OWN manifest, overriding the root Daily
// Challenge manifest for this subtree only, and is "capable" as a Home Screen app on iOS.
export const metadata: Metadata = {
  manifest: PREDICTS_MANIFEST_PATH,
  appleWebApp: { capable: true, title: PWA_COPY.shortName, statusBarStyle: "default" },
};

// /predicts/* root. FDY-433 (ADM-1.7h): the Faraday beta access gate no longer runs here. URLs are
// unchanged; the pages are split into two route groups so that switching Predicts to "invite" later
// does not break the links every digest carries:
//   (gated)/ — the board, forecasts, receipts, record, movers, following, company pages. Its layout
//              runs the gate (FDY-414) and then the shell.
//   (open)/  — /predicts/preferences only. Same shell, never gated: every digest links to it.
// The shell itself lives in ./PredictsFrame.tsx so both groups render it identically.
export default function PredictsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
