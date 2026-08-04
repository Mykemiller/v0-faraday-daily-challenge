// Renders the legal markdown AST (src/lib/legal/markdown.ts) as React.
// Kept separate from the parser so the parser stays testable under `node --test`
// without a JSX loader — same split as the messaging/broadcast libs.
//
// Typography for h2/p/ul/ol/strong/a is applied ONCE by LegalDocument's
// arbitrary-variant block. Only the notice box and inline code are styled here,
// because they are specific to this document set: a `>` blockquote in the legal
// corpus always means "conspicuous notice" (the auto-renewal disclosure, the
// counsel-review blocks), never a decorative pull quote.

import Link from "next/link";
import type { Block, Span } from "@/lib/legal/markdown";

function Inline({ spans }: { spans: Span[] }) {
  return (
    <>
      {spans.map((s, i) => {
        if (s.t === "strong") return <strong key={i}>{s.v}</strong>;
        if (s.t === "code")
          return (
            <code
              key={i}
              className="rounded bg-warm-gray/40 px-1 py-0.5 font-mono text-[13px] text-near-black"
            >
              {s.v}
            </code>
          );
        if (s.t === "link") {
          const external = /^https?:\/\//.test(s.href);
          return external ? (
            <a key={i} href={s.href} target="_blank" rel="noreferrer noopener">
              {s.v}
            </a>
          ) : (
            <Link key={i} href={s.href}>
              {s.v}
            </Link>
          );
        }
        return <span key={i}>{s.v}</span>;
      })}
    </>
  );
}

function Blocks({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {blocks.map((b, i) => {
        switch (b.t) {
          case "h2":
            return (
              <h2 key={i}>
                <Inline spans={b.spans} />
              </h2>
            );
          case "h3":
            return (
              <h3 key={i}>
                <Inline spans={b.spans} />
              </h3>
            );
          case "ul":
            return (
              <ul key={i}>
                {b.items.map((item, j) => (
                  <li key={j}>
                    <Inline spans={item} />
                  </li>
                ))}
              </ul>
            );
          case "ol":
            return (
              <ol key={i}>
                {b.items.map((item, j) => (
                  <li key={j}>
                    <Inline spans={item} />
                  </li>
                ))}
              </ol>
            );
          case "note":
            // Conspicuous notice. Bordered, tinted and full-bleed within the
            // measure so it cannot be mistaken for body copy — this is the
            // "conspicuous" half of the auto-renewal disclosure requirement.
            return (
              <aside
                key={i}
                className="
                  my-7 rounded-md border-2 border-amber-dark/70 bg-warm-cream px-5 py-4
                  [&>*:first-child]:mt-0
                  [&_h2]:mt-5 [&_h2]:text-[17px] [&_h2]:tracking-wide
                  [&_h3]:mt-5 [&_h3]:text-[15px]
                  [&_p]:text-[14px]
                  [&_ul]:text-[14px] [&_ol]:text-[14px]
                "
              >
                <Blocks blocks={b.blocks} />
              </aside>
            );
          default:
            return (
              <p key={i}>
                <Inline spans={b.spans} />
              </p>
            );
        }
      })}
    </>
  );
}

export default function MarkdownBody({ blocks }: { blocks: Block[] }) {
  return <Blocks blocks={blocks} />;
}
