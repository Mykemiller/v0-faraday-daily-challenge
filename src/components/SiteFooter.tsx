import Link from "next/link";

// Shared legal footer for the light (warm-white) subscriber surfaces — every
// page that wears SiteHeaderNav, plus the DcStubPage / StubPage shells.
// The dark in-app shell (DailyChallenge.jsx) renders its own token-matched twin
// because it styles from the JS `C` object, not the Tailwind @theme.
//
// Entity attribution is deliberate: Faraday Intelligence LLC is the operating
// entity named in /terms and /privacy, so the notice must match those documents.

export default function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-warm-gray/50">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-3 gap-y-2 px-5 py-6 font-mono text-[11px] leading-relaxed text-near-black/65">
        <span>&copy; 2026 Faraday Intelligence LLC. All rights reserved.</span>
        <span aria-hidden className="text-near-black/30">
          &middot;
        </span>
        <Link href="/terms" className="underline underline-offset-2 hover:text-forest">
          Terms
        </Link>
        <span aria-hidden className="text-near-black/30">
          &middot;
        </span>
        <Link href="/privacy" className="underline underline-offset-2 hover:text-forest">
          Privacy
        </Link>
      </div>
    </footer>
  );
}
