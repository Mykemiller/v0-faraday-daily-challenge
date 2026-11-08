"use client";

import { useState } from "react";

// Native share sheet where available, else copy the link with a polite toast.
export default function ShareButton({ title }: { title: string }) {
  const [toast, setToast] = useState<string | null>(null);
  async function share() {
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setToast("Link copied");
    } catch {
      setToast(null);
      return;
    }
    window.setTimeout(() => setToast(null), 2500);
  }
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onClick={share}
        className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-cream-border px-4 font-sans text-[14px] font-medium text-forest hover:border-forest"
      >
        Share
      </button>
      <span role="status" aria-live="polite" className="pointer-events-none absolute left-1/2 top-full mt-1 -translate-x-1/2 whitespace-nowrap font-sans text-[13px] text-forest">
        {toast ?? ""}
      </span>
    </span>
  );
}
