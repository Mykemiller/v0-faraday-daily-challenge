import type { Taxonomy } from "@/lib/predicts-v3";

// Theater › Sector (names only; never codes, never counts). 11px mono label.
export default function Breadcrumb({ taxonomy, sector }: { taxonomy?: Taxonomy; sector?: string | null }) {
  const parts = [taxonomy?.theater, taxonomy?.sector ?? sector].filter(Boolean) as string[];
  if (!parts.length) return null;
  return <p className="font-mono text-[11px] uppercase tracking-wide text-sage-dark">{parts.join(" › ")}</p>;
}
