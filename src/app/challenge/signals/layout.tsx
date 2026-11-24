import type { Metadata } from "next";
import { dcPageMetadata } from "@/lib/dc-metadata";

// CC-DC-CANONICAL-DOMAIN-1.0: /challenge/signals is a client component and so cannot
// export metadata itself. This pass-through layout exists only to declare the
// page's canonical URL on the Daily Challenge domain.
export const metadata: Metadata = dcPageMetadata("/challenge/signals", {
  title: "Faraday's Take · Today's Top Signals",
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
