"use client";
// Faraday Academy — Vega-Lite chart frame.
//
// Dynamically imported like the diagram frame, for the same reason. The server has
// already dropped any chart whose data carried no verified source, so by the time
// a spec reaches here every datum is attributable.

import { useEffect, useRef, useState } from "react";

export default function ChartFrame({
  spec,
  caption,
}: {
  spec: Record<string, unknown>;
  caption?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");

  useEffect(() => {
    let cancelled = false;
    let view: { finalize: () => void } | null = null;

    (async () => {
      try {
        const embed = (await import("vega-embed")).default;
        if (cancelled || !host.current) return;
        const result = await embed(host.current, spec as Record<string, unknown>, {
          actions: false,
          renderer: "svg",
          config: {
            background: "transparent",
            font: "var(--font-sans)",
            axis: { labelFont: "var(--font-mono)", labelFontSize: 11, titleFontSize: 12 },
          },
        });
        if (cancelled) {
          result.view.finalize();
          return;
        }
        view = result.view;
        setState("ready");
      } catch {
        if (!cancelled) setState("failed");
      }
    })();

    return () => {
      cancelled = true;
      view?.finalize();
    };
  }, [spec]);

  if (state === "failed") return null;

  return (
    <figure className="mt-4">
      <div
        ref={host}
        className="overflow-x-auto px-3 py-3"
        style={{ border: "1px solid var(--ac-sage-rule)", backgroundColor: "var(--ac-bg)" }}
      />
      {state === "loading" ? (
        <p className="academy-meta mt-1">Plotting the figures…</p>
      ) : caption ? (
        <figcaption className="academy-meta mt-1">{caption}</figcaption>
      ) : null}
    </figure>
  );
}
