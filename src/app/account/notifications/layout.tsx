import type { Metadata } from "next";
import { dcPageMetadata } from "@/lib/dc-metadata";

// CC-DC-CANONICAL-DOMAIN-1.0: /account/notifications is a client component and so cannot
// export metadata itself. This pass-through layout exists only to declare the
// page's canonical URL on the Daily Challenge domain.
export const metadata: Metadata = dcPageMetadata("/account/notifications", {
  title: "Daily Challenge Alerts · Faraday Daily Challenge",
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
