"use client";
// Faraday Academy — the daily course allowance notice (FDY-353 D12, FDY-392).
//
// Friendly and plain: no numbers (the limit will be tuned), no upsell, and the
// reset shown in the reader's own local time. Rendered only on the client, after
// the start check has answered, so the local time never mismatches hydration.

import Link from "next/link";
import { courseLimitNotice } from "@/lib/academy/course-start";

export default function UsageNotice({ resetAt }: { resetAt: string | null }) {
  return (
    <div
      role="status"
      className="mx-auto max-w-xl px-6 py-16 text-center"
      style={{ color: "var(--ac-text)" }}
    >
      <p className="font-serif text-xl font-bold">{courseLimitNotice(resetAt, new Date())}</p>
      <p className="mt-3 text-base" style={{ color: "var(--ac-muted)" }}>
        Anything you&rsquo;ve already started today stays open.
      </p>
      <Link
        href="/academy"
        className="mt-6 inline-block px-5 py-2.5 font-medium"
        style={{ backgroundColor: "var(--ac-forest)", color: "var(--ac-bg)" }}
      >
        Back to the catalog
      </Link>
    </div>
  );
}
