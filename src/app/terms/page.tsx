// Master Terms of Service — the single canonical legal body for every Faraday
// storefront (CC-TOS-PRICING-1.0).
//
// The body is NOT inline here any more. It is read from
// `content/legal/terms-of-service.md`, which is the one place the master text
// exists in any Faraday repository. Every storefront incorporates this document
// by reference and links to this URL; none of them copy it. Storefront-specific
// terms live in the Schedules linked below.
//
// (This replaces the Daily-Challenge-only Terms that lived inline here under
// CC-DC-LEGAL-1.0. Those terms are now Schedule DC. The effective-date
// convention moves with the text: it is the `effective` key in the markdown
// front matter, not a literal in this component.)

import Link from "next/link";
import LegalDocument from "@/components/LegalDocument";
import MarkdownBody from "@/components/legal/MarkdownBody";
import { loadMaster, isDraft, effectiveLabel, SCHEDULES } from "@/lib/legal/documents";

export const metadata = {
  title: "Terms of Service · Faraday Intelligence",
  description:
    "The master terms governing every Faraday Intelligence storefront, operated by Faraday Intelligence LLC.",
};

export default function TermsPage() {
  const doc = loadMaster();

  return (
    <LegalDocument
      title={doc.meta.title ?? "Faraday Intelligence — Master Terms of Service"}
      effectiveDate={effectiveLabel(doc)}
      draft={isDraft(doc)}
      sibling={{ label: "Privacy Policy", href: "/privacy" }}
      related={
        <p className="mt-2 font-mono text-[12px] text-near-black/70">
          Storefront schedules:{" "}
          {SCHEDULES.map((s, i) => (
            <span key={s.slug}>
              {i > 0 ? " · " : ""}
              {s.kind === "local" ? (
                <Link
                  href={`/terms/${s.slug}`}
                  className="underline underline-offset-2 hover:text-forest"
                >
                  {s.storefront}
                </Link>
              ) : (
                <a
                  href={s.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="underline underline-offset-2 hover:text-forest"
                >
                  {s.storefront}
                </a>
              )}
            </span>
          ))}
        </p>
      }
    >
      <MarkdownBody blocks={doc.blocks} />

      <h2>Schedules — where each one is published</h2>
      <p>
        Each Schedule below incorporates these Master Terms by reference. A Schedule is
        published on the storefront it governs, so there is exactly one copy of it anywhere.
      </p>
      <ul>
        {SCHEDULES.map((s) => (
          <li key={s.slug}>
            <strong>{s.designation} — {s.storefront}.</strong> {s.blurb}{" "}
            {s.kind === "local" ? (
              <Link href={`/terms/${s.slug}`}>Read {s.designation}</Link>
            ) : (
              <a href={s.url} target="_blank" rel="noreferrer noopener">
                Read {s.designation} at {new URL(s.url).host}
              </a>
            )}
          </li>
        ))}
      </ul>
    </LegalDocument>
  );
}
