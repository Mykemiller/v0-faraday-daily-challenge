import type { Metadata } from "next";
import { dcPageMetadata } from "@/lib/dc-metadata";

// CC-DC-CANONICAL-DOMAIN-1.0: /challenge/about is a client component and so cannot
// export metadata itself. This pass-through layout exists only to declare the
// page's canonical URL on the Daily Challenge domain.
export const metadata: Metadata = dcPageMetadata("/challenge/about", {
  title: "About Today's Challenge · Faraday Daily Challenge",
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
