// Faraday Academy — the lesson column.
//
// Server component. IBM Plex Serif at about 66 characters a line, plain
// paragraphs: the live content carries no bullets, no headings and no markdown,
// so there is no renderer here to be exploited — just text nodes and links.
//
// This text IS the narration transcript, which is why it is always present even
// when audio exists.

import Link from "next/link";
import { linkLesson } from "@/lib/academy/glossary";
import type { GlossaryEntry } from "@/lib/academy/types";

export default function LessonBody({
  paragraphs,
  glossary,
  slug,
}: {
  paragraphs: string[];
  glossary: GlossaryEntry[];
  slug: string;
}) {
  const linked = linkLesson(paragraphs, glossary);

  return (
    <div className="academy-prose" style={{ color: "var(--ac-text)" }}>
      {linked.map((segments, i) => (
        <p key={i}>
          {segments.map((s, j) =>
            s.kind === "text" ? (
              s.text
            ) : (
              <Link
                key={j}
                href={`/academy/${slug}/glossary#${s.anchor}`}
                className="academy-term"
                title={`${s.term} — see the glossary`}
              >
                {s.text}
              </Link>
            ),
          )}
        </p>
      ))}
    </div>
  );
}
