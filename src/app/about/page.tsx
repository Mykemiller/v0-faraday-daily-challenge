import Link from "next/link";
import DcStubPage from "@/components/DcStubPage";

export const metadata = { title: "About Faraday Intelligence" };

// More Faraday → About Faraday Intelligence. Copy seeded from the Faraday Brand
// Bible 4.0 (Brand Foundation + Positioning): Faraday Intelligence is an
// **intelligence service** — a new category. Per the Bible, never describe it
// as a chatbot, assistant, advisor, platform, tool, or consulting firm.
// Distinct from /who-is-faraday (the Gilbert Faraday analyst persona).

export default function AboutPage() {
  return (
    <DcStubPage
      title="About Faraday Intelligence"
      blurb="Faraday Intelligence is an intelligence service for the AI data center economy — always on, always ahead. It thinks so you can decide."
    >
      <p>
        Every day the market generates a torrent of signals — interconnection filings,
        regulatory proceedings, earnings calls, capital deployments. Faraday processes all
        of it and tells you clearly where things stand and where they&rsquo;re going. Beyond a
        tool. Beyond a firm. Your unfair advantage, in your pocket.
      </p>
      <p>
        The Daily Challenge is the free front door to that work. The full story is being
        written; until then, the{" "}
        <Link href="/" className="underline hover:text-forest">Faraday Intelligence homepage</Link>{" "}
        shows everything Faraday builds.
      </p>
    </DcStubPage>
  );
}
