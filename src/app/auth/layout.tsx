import type { Metadata } from "next";
import { DC_CANONICAL_ORIGIN } from "@/lib/hosts";

// CC-DC-CANONICAL-DOMAIN-1.0: /auth consumes a single-use magic-link token
// (MAGIC_LINK_BASE in supabase/functions/register-with-magic-link points here),
// so the URL must never be indexed and carries no canonical. The origin is
// pinned because the session is written to localStorage on whichever origin
// serves this page — it has to be the canonical one.
export const metadata: Metadata = {
  metadataBase: new URL(DC_CANONICAL_ORIGIN),
  title: "Activating your profile · Faraday Daily Challenge",
  robots: { index: false, follow: false },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
