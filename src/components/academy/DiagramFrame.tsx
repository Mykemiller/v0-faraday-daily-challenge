"use client";
// Faraday Academy — Mermaid diagram frame.
//
// The renderer is imported dynamically on first render, so the ~500KB Mermaid
// bundle is never in the lesson payload — it loads only when a reader opens the
// panel and the model actually returned a diagram.
//
// The server already structurally validated the source. This is the second gate:
// if Mermaid itself refuses to parse it, the frame renders nothing and the
// surrounding text stands on its own.

import { useEffect, useId, useRef, useState } from "react";

export default function DiagramFrame({
  source,
  caption,
}: {
  source: string;
  caption?: string;
}) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          // Neutral theme + brand-ish type; the sage AI ground supplies the tint.
          theme: "neutral",
          fontFamily: "var(--font-sans)",
          securityLevel: "strict",
        });
        const { svg } = await mermaid.render(`academy-diagram-${id}`, source);
        if (cancelled) return;
        if (host.current) host.current.innerHTML = svg;
        setState("ready");
      } catch {
        if (!cancelled) setState("failed");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [id, source]);

  if (state === "failed") return null;

  return (
    <figure className="mt-4">
      <div
        ref={host}
        className="overflow-x-auto px-3 py-3"
        style={{ border: "1px solid var(--ac-sage-rule)", backgroundColor: "var(--ac-bg)" }}
        role="img"
        aria-label={caption ?? "Diagram of the relationships described above"}
      />
      {state === "loading" ? (
        <p className="academy-meta mt-1">Drawing the diagram…</p>
      ) : caption ? (
        <figcaption className="academy-meta mt-1">{caption}</figcaption>
      ) : null}
    </figure>
  );
}
