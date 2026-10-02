// Faraday Academy — every state on the design's States board.
// There is no locked-lesson state and no paywall state: lessons are fully open,
// so the only ways a read fails are "not found" and "offline".

import Link from "next/link";

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="mx-auto max-w-xl px-6 py-16 text-center"
      style={{ color: "var(--ac-text)" }}
    >
      {children}
    </div>
  );
}

function Heading({ children }: { children: React.ReactNode }) {
  return <h1 className="font-serif text-2xl font-bold">{children}</h1>;
}

function Body({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-3 text-base" style={{ color: "var(--ac-muted)" }}>
      {children}
    </p>
  );
}

function Action({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="mt-6 inline-block px-5 py-2.5 font-medium"
      style={{ backgroundColor: "var(--ac-forest)", color: "var(--ac-bg)" }}
    >
      {children}
    </Link>
  );
}

/** The course slug did not resolve: unknown, not yet approved, or held back. */
export function CourseNotFound() {
  return (
    <Frame>
      <Heading>We couldn&rsquo;t find that course</Heading>
      <Body>
        The link may be out of date, or the course may not be open for reading yet.
        Everything that is open is in the catalog.
      </Body>
      <Action href="/academy">Browse the catalog</Action>
    </Frame>
  );
}

/** The read path is unreachable. Distinct from not-found: this one is our fault. */
export function Offline({ retryHref }: { retryHref?: string }) {
  return (
    <Frame>
      <Heading>We can&rsquo;t reach the library right now</Heading>
      <Body>
        This is on our side, not yours. The lesson text is still there — try again in
        a moment.
      </Body>
      <Action href={retryHref ?? "/academy"}>Try again</Action>
    </Frame>
  );
}

/** Search or filters eliminated every course. */
export function EmptySearch({ onReset }: { onReset?: () => void }) {
  return (
    <div className="px-2 py-16 text-center">
      <p className="font-serif text-xl font-bold" style={{ color: "var(--ac-text)" }}>
        Nothing matches that
      </p>
      <p className="mt-2 text-sm" style={{ color: "var(--ac-muted)" }}>
        Try fewer filters, or a broader search.
      </p>
      {onReset ? (
        <button
          type="button"
          onClick={onReset}
          className="mt-5 px-4 py-2 text-sm font-medium"
          style={{ border: "1px solid var(--ac-rule-strong)", color: "var(--ac-text)" }}
        >
          Clear filters
        </button>
      ) : null}
    </div>
  );
}

/**
 * Narration exists for some lessons of this course but not this one. Stated
 * plainly and without apology — the lesson text is the transcript.
 */
export function NarrationUnavailable() {
  return (
    <p
      className="academy-meta flex items-center gap-2 px-3 py-2"
      style={{ border: "1px dashed var(--ac-rule-strong)" }}
    >
      <span aria-hidden="true">◍</span>
      Narration for this lesson isn&rsquo;t recorded yet. The text below is the full lesson.
    </p>
  );
}

/** Catalog and reader skeletons. Shimmer stops under prefers-reduced-motion. */
export function CatalogSkeleton() {
  return (
    <div className="space-y-10" aria-hidden="true">
      {[0, 1].map((g) => (
        <div key={g}>
          <div className="academy-shimmer h-5 w-48" />
          <div className="mt-4 space-y-3">
            {[0, 1, 2].map((r) => (
              <div key={r} className="academy-shimmer h-20 w-full" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function ReaderSkeleton() {
  return (
    <div className="space-y-4" aria-hidden="true">
      <div className="academy-shimmer h-8 w-2/3" />
      <div className="academy-shimmer h-4 w-32" />
      <div className="mt-8 space-y-3">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="academy-shimmer h-4 w-full" />
        ))}
      </div>
    </div>
  );
}

/** Screen-reader announcement used while a route segment streams in. */
export function LoadingAnnouncer({ label }: { label: string }) {
  return (
    <p role="status" className="sr-only">
      {label}
    </p>
  );
}
