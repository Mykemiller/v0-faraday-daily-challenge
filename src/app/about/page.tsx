import Link from "next/link";
import DcStubPage from "@/components/DcStubPage";

export const metadata = { title: "About Faraday Intelligence" };

// More Faraday → About Faraday Intelligence stub. The storefront homepage (/)
// shows the product surfaces; this page will carry the company story.

export default function AboutPage() {
  return (
    <DcStubPage
      title="About Faraday Intelligence"
      blurb="Faraday Intelligence reads the AI data center economy every day — the Daily Challenge is the free front door to that work."
    >
      <p>
        The full company story is being written. Until then, the{" "}
        <Link href="/" className="underline hover:text-forest">Faraday Intelligence homepage</Link>{" "}
        shows everything Faraday builds.
      </p>
    </DcStubPage>
  );
}
