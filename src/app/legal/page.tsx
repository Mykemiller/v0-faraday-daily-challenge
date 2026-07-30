import { permanentRedirect } from "next/navigation";

// The combined "Terms / Privacy — coming soon" placeholder is retired. The real
// documents live at /terms and /privacy (CC-DC-LEGAL-1.0). This route is kept as
// a permanent redirect to /terms — which carries a prominent link to /privacy —
// so old bookmarks and any external link to /legal never 404.

export default function LegalPage() {
  permanentRedirect("/terms");
}
