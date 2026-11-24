"use client";

import { useState } from "react";
import logos from "@/lib/predicts-logos.json";
import { monogram } from "@/lib/predicts-v3";

// theSVG logo (jsDelivr mirror) when mapped at build time, else a forest
// monogram. The marks belong to their owners and identify the SUBJECT of a
// forecast (nominative use); they are never recoloured. No other logo source.
const CDN = "https://cdn.jsdelivr.net/gh/glincker/thesvg@main/public";
const MAP = logos as Record<string, string>;

type Props = { name: string; slug?: string | null; size?: number };

export default function CompanyMark({ name, slug, size = 40 }: Props) {
  const path = slug ? MAP[slug] : undefined;
  const [failed, setFailed] = useState(false);
  if (path && !failed) {
    return (
      <span
        className="inline-flex shrink-0 items-center justify-center rounded-md border border-cream-border bg-warm-white"
        style={{ width: size, height: size }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- remote SVG, fixed tiny size */}
        <img
          src={`${CDN}${path}`}
          width={Math.round(size * 0.7)}
          height={Math.round(size * 0.7)}
          loading="lazy"
          alt={name}
          onError={() => setFailed(true)}
          style={{ objectFit: "contain", width: Math.round(size * 0.7), height: Math.round(size * 0.7) }}
        />
      </span>
    );
  }
  return <Monogram text={monogram(name)} size={size} label={name} />;
}

export function Monogram({ text, size = 40, label }: { text: string; size?: number; label?: string }) {
  return (
    <span
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className="inline-flex shrink-0 items-center justify-center rounded-md bg-forest font-mono font-semibold text-warm-cream"
      style={{ width: size, height: size, fontSize: Math.max(11, Math.round(size * 0.32)) }}
    >
      {text}
    </span>
  );
}
