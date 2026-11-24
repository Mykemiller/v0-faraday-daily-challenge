import Link from "next/link";
import { recordPillText } from "@/lib/predicts-v3";
import type { PredictsRecord } from "@/lib/predicts";

// Counts and the Brier only — never a rate. Full line ≥640px, "Record →" below.
export default function RecordPill({ record }: { record: PredictsRecord | null }) {
  const text = recordPillText(record);
  return (
    <Link
      href="/predicts/record"
      className="inline-flex min-h-[44px] items-center rounded-full border border-cream-border bg-warm-white px-3 font-mono text-[12px] text-near-black hover:border-forest"
    >
      <span className="hidden sm:inline">{text ?? "Record"}</span>
      <span className="sm:hidden">Record →</span>
    </Link>
  );
}
