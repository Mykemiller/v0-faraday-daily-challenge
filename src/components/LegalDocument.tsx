import Link from "next/link";
import type { ReactNode } from "react";
import SiteHeaderNav from "@/components/SiteHeaderNav";
import SiteFooter from "@/components/SiteFooter";

// Shared shell for the two legal documents (/terms and /privacy). Static site
// content — the copy lives inline in each page component (no CMS, no Airtable,
// no Supabase, no new dependency for rendering it).
//
// Effective-date convention: a single `effectiveDate` string per document,
// rendered under the title. Material changes are signalled by bumping it (see
// ToS §7 / Privacy §10), so it must stay a literal in the page component.

export default function LegalDocument({
  title,
  effectiveDate,
  /** The sibling document, linked prominently at the top and again at the foot. */
  sibling,
  /**
   * Set while a document is awaiting counsel clearance. Renders a
   * non-dismissible banner and suppresses the effective-date line, so a draft
   * carrying TODO placeholders can never read as terms that are in force.
   */
  draft = false,
  /** Extra cross-links rendered under the effective date (master ↔ schedules). */
  related,
  children,
}: {
  title: string;
  effectiveDate: string;
  sibling?: { label: string; href: string };
  draft?: boolean;
  related?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-warm-white font-sans text-near-black">
      <SiteHeaderNav />
      <main className="mx-auto max-w-3xl px-5 pb-16 pt-10">
        <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-amber-dark">Legal</div>
        <h1 className="mt-3 font-serif text-[clamp(28px,5vw,38px)] font-bold leading-tight text-forest">
          {title}
        </h1>

        {draft ? (
          <div
            role="note"
            className="mt-5 rounded-md border-2 border-amber-dark bg-warm-cream px-4 py-3"
          >
            <p className="font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-amber-dark">
              Draft — not yet in force
            </p>
            <p className="mt-2 text-[14px] leading-relaxed text-near-black/85">
              This document is pending legal review. It has no effective date, it does not
              govern anyone&rsquo;s use of the Services, and it contains placeholders marked{" "}
              <code className="font-mono text-[13px]">TODO</code> that counsel must resolve
              before publication.
            </p>
          </div>
        ) : (
          <p className="mt-3 font-mono text-[12px] text-near-black/70">
            Effective date: {effectiveDate}
          </p>
        )}

        {sibling ? (
          <p className="mt-4 font-mono text-[12px] text-near-black/70">
            See also:{" "}
            <Link href={sibling.href} className="underline underline-offset-2 hover:text-forest">
              {sibling.label}
            </Link>
          </p>
        ) : null}
        {related}

        <div className="my-7 h-px bg-warm-gray/60" />

        {/* Document body. Section headings, paragraphs and lists are styled here
            once so each document stays plain, readable copy. */}
        <div
          className="
            space-y-4 text-[15px] leading-relaxed text-near-black/85
            [&_h2]:mt-9 [&_h2]:font-serif [&_h2]:text-[20px] [&_h2]:font-bold [&_h2]:leading-snug [&_h2]:text-forest
            [&_h3]:mt-7 [&_h3]:font-serif [&_h3]:text-[17px] [&_h3]:font-bold [&_h3]:leading-snug [&_h3]:text-forest
            [&_p]:max-w-[68ch]
            [&_ul]:max-w-[68ch] [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-6
            [&_ol]:max-w-[68ch] [&_ol]:list-decimal [&_ol]:space-y-2 [&_ol]:pl-6
            [&_strong]:font-semibold [&_strong]:text-near-black
            [&_a]:underline [&_a]:underline-offset-2 hover:[&_a]:text-forest
          "
        >
          {children}
        </div>

        <div className="mt-12 h-px bg-warm-gray/60" />
        <p className="mt-6 font-mono text-[11px] text-near-black/60">
          {sibling ? (
            <>
              <Link href={sibling.href} className="underline underline-offset-2 hover:text-forest">
                {sibling.label}
              </Link>
              {"  ·  "}
            </>
          ) : null}
          <Link href="/help/feedback" className="underline underline-offset-2 hover:text-forest">
            Feedback page
          </Link>
          {"  ·  "}
          <Link href="/challenge" className="underline underline-offset-2 hover:text-forest">
            Back to the Daily Challenge
          </Link>
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}
