import Link from "next/link";
import LegalDocument from "@/components/LegalDocument";

export const metadata = {
  title: "Terms of Service · Faraday Daily Challenge",
  description:
    "The terms governing use of the Faraday Daily Challenge, operated by Faraday Intelligence LLC.",
};

// Terms of Service — static content, verbatim per CC-DC-LEGAL-1.0. The old
// combined /legal placeholder now redirects here; /privacy is the sibling.
// Effective date is a literal (see LegalDocument's convention note).

export default function TermsPage() {
  return (
    <LegalDocument
      title="Faraday Daily Challenge — Terms of Service"
      effectiveDate="July 30, 2026"
      sibling={{ label: "Privacy Policy", href: "/privacy" }}
    >
      <p>
        These Terms of Service (&ldquo;Terms&rdquo;) are a binding agreement between you and{" "}
        <strong>Faraday Intelligence LLC</strong>, a Minnesota limited liability company
        (&ldquo;Faraday,&rdquo; &ldquo;we,&rdquo; &ldquo;us&rdquo;), governing your access to and use of the
        Faraday Daily Challenge&trade; at www.faradaydailychallenge.com and
        faraday-intelligence.ai, including all puzzles, scoring, leaderboards, teams, seasons, and
        related features (collectively, the &ldquo;Service&rdquo;).
      </p>
      <p>
        By creating an account, submitting your email address, or otherwise using the Service, you
        agree to these Terms. If you do not agree, do not use the Service.
      </p>

      <h2>1. The Service</h2>
      <p>
        The Faraday Daily Challenge is a daily puzzle platform covering data center, energy, and
        digital-infrastructure topics. Puzzles, hints, explanations, scores, and related editorial
        content are provided for your personal, non-commercial information and entertainment. The
        Service is not investment, legal, engineering, or site-selection advice, and no content on
        the Service should be relied upon as such.
      </p>

      <h2>2. Accounts and eligibility</h2>
      <p>
        You must be at least 16 years old to use the Service. You are responsible for the accuracy
        of the email address you register and for all activity under your account. We authenticate
        by magic link; keep control of your email inbox. We may suspend or terminate accounts that
        violate these Terms, disrupt the Service, or manipulate scoring or leaderboards, at our
        discretion.
      </p>

      <h2>3. Our intellectual property</h2>
      <p>
        The Service and everything in it &mdash; including puzzle content, questions, answers, hints,
        explanations, the Faraday scoring methodologies and any associated formulas, weightings,
        taxonomies, and classification systems, game formats and names (including Rackl, Signal
        Drop, The Stack, Circuit, The Brief, Dark Fiber, and Frequency), editorial content,
        software, and the design and look-and-feel of the site &mdash; is owned by Faraday
        Intelligence LLC or its licensors and is protected by copyright, trademark, and trade-secret
        law. <strong>Faraday Intelligence&trade;</strong>, <strong>Faraday Daily Challenge&trade;</strong>,
        and <strong>Jurisdiction Watch&trade;</strong> are trademarks of Faraday Intelligence LLC.
      </p>
      <p>
        We grant you a limited, revocable, non-exclusive, non-transferable license to access and use
        the Service for personal, non-commercial purposes. No other rights are granted. Nothing in
        these Terms transfers any ownership of the Service or its content to you.
      </p>

      <h2>4. Prohibited uses</h2>
      <p>You may not, and may not permit or assist anyone else to:</p>
      <ol>
        <li>
          Scrape, crawl, harvest, bulk-download, or use automated means to access the Service or
          extract its content, except as permitted by a standard search-engine robots.txt;
        </li>
        <li>
          Copy, reproduce, republish, distribute, sell, or commercially exploit puzzle content,
          answers, scoring output, or any other part of the Service;
        </li>
        <li>
          Use the Service or its content to develop, train, benchmark, or improve any product or
          service that competes with the Service or with Faraday Intelligence LLC&rsquo;s
          market-intelligence offerings, including use as training data for machine-learning models;
        </li>
        <li>
          Reverse engineer, decompile, or attempt to derive the Service&rsquo;s scoring formulas,
          weightings, ranking logic, or other non-public methodology;
        </li>
        <li>
          Circumvent access controls, rate limits, or authentication; share, transfer, or sell
          account access; or interfere with the Service&rsquo;s operation;
        </li>
        <li>
          Manipulate scores, streaks, leaderboards, or team standings through automation, multiple
          accounts, or exploitation of defects;
        </li>
        <li>
          Frame or mirror the Service, or remove or alter any copyright, trademark, or attribution
          notice.
        </li>
      </ol>

      <h2>5. User submissions</h2>
      <p>
        If you submit feedback, suggestions, puzzle ideas, or other content to us (including through
        the <Link href="/help/feedback">Feedback page</Link>), you grant Faraday Intelligence LLC a
        perpetual, irrevocable, worldwide, royalty-free license to use it for any purpose without
        obligation to you. Do not submit anything confidential.
      </p>

      <h2>6. Leaderboards, teams, and display names</h2>
      <p>
        Scores, streaks, display names, team names, and organization tags you choose may be
        displayed publicly within the Service. Choose names you are comfortable displaying; we may
        remove names that are offensive, misleading, or infringe others&rsquo; rights.
      </p>

      <h2>7. Changes to the Service and these Terms</h2>
      <p>
        The Service evolves &mdash; puzzles rotate daily, seasons open and close, and features
        change. We may modify or discontinue any part of the Service at any time. We may update
        these Terms; the current version will always be posted at <Link href="/terms">/terms</Link>{" "}
        with its effective date. Material changes will be indicated by updating the effective date,
        and your continued use after a change constitutes acceptance.
      </p>

      <h2>8. Disclaimers</h2>
      <p>
        THE SERVICE IS PROVIDED &ldquo;AS IS&rdquo; AND &ldquo;AS AVAILABLE,&rdquo; WITHOUT
        WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING WARRANTIES OF MERCHANTABILITY, FITNESS
        FOR A PARTICULAR PURPOSE, ACCURACY, AND NON-INFRINGEMENT. Puzzle content may reference real
        companies, facilities, markets, and events for editorial and educational purposes; we do not
        warrant its completeness or accuracy, and it is not a substitute for professional advice.
      </p>

      <h2>9. Limitation of liability</h2>
      <p>
        TO THE MAXIMUM EXTENT PERMITTED BY LAW, FARADAY INTELLIGENCE LLC WILL NOT BE LIABLE FOR ANY
        INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY LOSS OF PROFITS,
        DATA, OR GOODWILL, ARISING FROM OR RELATING TO THE SERVICE. OUR TOTAL AGGREGATE LIABILITY
        FOR ALL CLAIMS RELATING TO THE SERVICE WILL NOT EXCEED THE GREATER OF (A) THE AMOUNTS YOU
        PAID US FOR THE SERVICE IN THE TWELVE MONTHS BEFORE THE CLAIM AROSE OR (B) FIFTY U.S.
        DOLLARS (US $50).
      </p>
      <p>
        Some jurisdictions do not allow certain limitations; in those jurisdictions our liability is
        limited to the maximum extent permitted by law.
      </p>

      <h2>10. Indemnification</h2>
      <p>
        You will indemnify and hold harmless Faraday Intelligence LLC and its members, managers, and
        agents from claims, damages, and expenses (including reasonable attorneys&rsquo; fees)
        arising from your violation of these Terms or your misuse of the Service.
      </p>

      <h2>11. Governing law and disputes</h2>
      <p>
        These Terms are governed by the laws of the State of Minnesota, without regard to
        conflict-of-laws rules. Any dispute arising out of or relating to these Terms or the Service
        will be resolved exclusively in the state or federal courts located in Minnesota, and you
        consent to their jurisdiction and venue. Either party may seek injunctive relief in any
        court of competent jurisdiction to protect intellectual-property or confidentiality rights.
        To the extent permitted by law, disputes must be brought individually and not as part of a
        class or representative action.
      </p>

      <h2>12. General</h2>
      <p>
        If any provision of these Terms is unenforceable, the remainder stays in effect. Our failure
        to enforce a provision is not a waiver. These Terms, together with the{" "}
        <Link href="/privacy">Privacy Policy</Link>, are the entire agreement between you and
        Faraday Intelligence LLC regarding the Service. You may not assign these Terms; we may
        assign them in connection with a merger, acquisition, or sale of assets.
      </p>

      <h2>13. Contact</h2>
      <p>
        Questions about these Terms can be sent through the{" "}
        <Link href="/help/feedback">Feedback page</Link> on the Service.
      </p>
    </LegalDocument>
  );
}
