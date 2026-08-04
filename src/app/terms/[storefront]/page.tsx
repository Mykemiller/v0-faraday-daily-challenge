// Storefront Schedules (CC-TOS-PRICING-1.0).
//
// Renders a Schedule that this repository owns, above a standing
// incorporation-by-reference block pointing at the master Terms. The master body
// is never re-rendered here — that is the whole point of the arrangement.
//
// A Schedule owned by another repository (Jurisdiction Watch) is NOT vendored:
// the route permanently redirects to the storefront that publishes it, so the
// document has exactly one URL.

import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import LegalDocument from "@/components/LegalDocument";
import MarkdownBody from "@/components/legal/MarkdownBody";
import {
  findSchedule,
  loadSchedule,
  isDraft,
  effectiveLabel,
  SCHEDULES,
} from "@/lib/legal/documents";

export function generateStaticParams() {
  return SCHEDULES.filter((s) => s.kind === "local").map((s) => ({ storefront: s.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ storefront: string }>;
}) {
  const { storefront } = await params;
  const entry = findSchedule(storefront);
  if (!entry) return { title: "Terms of Service · Faraday Intelligence" };
  return {
    title: `${entry.designation} — ${entry.storefront} · Faraday Intelligence`,
    description: `${entry.blurb} Incorporates the Faraday Intelligence Master Terms of Service by reference.`,
  };
}

export default async function SchedulePage({
  params,
}: {
  params: Promise<{ storefront: string }>;
}) {
  const { storefront } = await params;
  const entry = findSchedule(storefront);
  if (!entry) notFound();
  if (entry.kind === "remote") permanentRedirect(entry.url);

  const doc = loadSchedule(entry);

  return (
    <LegalDocument
      title={doc.meta.title ?? `${entry.designation} — ${entry.storefront}`}
      effectiveDate={effectiveLabel(doc)}
      draft={isDraft(doc)}
      sibling={{ label: "Privacy Policy", href: "/privacy" }}
      related={
        <p className="mt-2 font-mono text-[12px] text-near-black/70">
          This Schedule incorporates the{" "}
          <Link href="/terms" className="underline underline-offset-2 hover:text-forest">
            Faraday Intelligence Master Terms of Service
          </Link>{" "}
          by reference.
        </p>
      }
    >
      <MarkdownBody blocks={doc.blocks} />

      <h2>Incorporation by reference</h2>
      <p>
        The <Link href="/terms">Faraday Intelligence Master Terms of Service</Link> are
        incorporated into this Schedule and apply in full to your use of {entry.storefront}.
        Read them together with this document. Where this Schedule conflicts with the Master
        Terms, this Schedule controls for {entry.storefront} only, and only to the extent of
        the conflict.
      </p>
      <p>
        Other storefront schedules:{" "}
        {SCHEDULES.filter((s) => s.slug !== entry.slug).map((s, i) => (
          <span key={s.slug}>
            {i > 0 ? " · " : ""}
            {s.kind === "local" ? (
              <Link href={`/terms/${s.slug}`}>{s.storefront}</Link>
            ) : (
              <a href={s.url} target="_blank" rel="noreferrer noopener">
                {s.storefront}
              </a>
            )}
          </span>
        ))}
      </p>
    </LegalDocument>
  );
}
