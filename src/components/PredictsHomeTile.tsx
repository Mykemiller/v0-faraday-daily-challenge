"use client";
// Faraday Predicts home tile (FDY-120, 26-43-v01) — upgrades the FDY-147 tile in
// place: one featured dated call, a Receipts link, "Request access", and the
// release tag from the API. Copy is verbatim from the issue (predicts-tile.ts).
//
// Failure behaviour: if predicts-public errors or takes > 3s, the tile renders
// the FDY-147 copy as one link with CTA "Open →" — no featured block, no release
// line, no error banner. The featured block's height is reserved while loading.
import Link from "next/link";
import { useEffect, useId, useState } from "react";
import {
  FALLBACK_COPY, FEATURED_TIMEOUT_MS, featuredUrl, metaLine, parseTileResponse, RECEIPTS_HREF, requestAccessUrl,
  TILE_COPY, type TileData,
} from "@/lib/predicts-tile";

type Load = { state: "loading" } | { state: "failed" } | { state: "ready"; data: TileData };
type Form = "closed" | "open" | "sending" | "success" | "error";

const CARD = "flex h-full flex-col rounded-xl border border-warm-gray bg-warm-white p-5 transition-colors hover:border-gold";
const LINK = "font-mono text-[11px] uppercase tracking-[0.1em] text-amber-dark hover:text-gold focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold";

export function PredictsHomeTile({ apiUrl }: { apiUrl: string }) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [form, setForm] = useState<Form>("closed");
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState(""); // honeypot, must stay empty
  const inputId = useId();
  const statusId = useId();

  useEffect(() => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), FEATURED_TIMEOUT_MS);
    fetch(featuredUrl(apiUrl), { signal: ctl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        const data = parseTileResponse(j);
        setLoad(data ? { state: "ready", data } : { state: "failed" });
      })
      .catch(() => setLoad({ state: "failed" }))
      .finally(() => clearTimeout(timer));
    return () => {
      clearTimeout(timer);
      ctl.abort();
    };
  }, [apiUrl]);

  // ── FDY-147 fallback: the previous tile, byte-for-byte in structure ──────
  if (load.state === "failed") {
    return (
      <Link
        href="/predicts"
        className="group flex h-full flex-col rounded-xl border border-warm-gray bg-warm-white p-5 transition-colors hover:border-gold focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold"
      >
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-serif font-semibold text-near-black text-[17px]">{TILE_COPY.title}</span>
          <span className="shrink-0 font-mono text-[11px] uppercase tracking-[0.1em] text-amber-dark">{TILE_COPY.badge}</span>
        </div>
        <p className="mt-2 font-sans leading-relaxed text-near-black/70 text-[13px]">{FALLBACK_COPY.blurb}</p>
        <span className="mt-3 font-mono text-[11px] uppercase tracking-[0.1em] text-amber-dark group-hover:text-gold">
          {FALLBACK_COPY.cta}
        </span>
      </Link>
    );
  }

  const data = load.state === "ready" ? load.data : null;
  const featured = data?.featured ?? null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (form === "sending") return;
    setForm("sending");
    try {
      const res = await fetch(requestAccessUrl(apiUrl), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, website }),
      });
      setForm(res.ok ? "success" : "error");
    } catch {
      setForm("error");
    }
  }

  return (
    <div className={CARD}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-serif font-semibold text-near-black text-[17px]">{TILE_COPY.title}</span>
        <span className="shrink-0 font-mono text-[11px] uppercase tracking-[0.1em] text-amber-dark">{TILE_COPY.badge}</span>
      </div>
      <p className="mt-2 font-sans leading-relaxed text-near-black/70 text-[13px]">{TILE_COPY.line}</p>

      {/* Featured block: height reserved while loading (no layout shift). Hidden
          entirely when the API returns no call. */}
      {(load.state === "loading" || featured) && (
        <div className="mt-3 min-h-[116px] border-l-2 border-gold pl-3" aria-busy={load.state === "loading"}>
          {featured && (
            <>
              <p className="font-serif text-[14px] leading-snug text-near-black">{featured.text}</p>
              <p className="mt-2 font-mono text-[12px] text-near-black/80">{metaLine(featured)}</p>
              {featured.sector && (
                <span className="mt-2 inline-block rounded-full border border-warm-gray px-2 py-0.5 font-sans text-[11px] text-forest">
                  {featured.sector}
                </span>
              )}
            </>
          )}
        </div>
      )}

      <div className="mt-3 flex flex-col items-start gap-2">
        <Link href={RECEIPTS_HREF} className={LINK}>{TILE_COPY.receiptsLink}</Link>

        {form === "closed" ? (
          <button
            type="button"
            onClick={() => setForm("open")}
            className="rounded-md bg-forest px-3 py-1.5 font-sans text-[13px] font-medium text-warm-white hover:bg-forest/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold"
          >
            {TILE_COPY.requestCta}
          </button>
        ) : (
          <form onSubmit={submit} className="w-full" noValidate>
            <label htmlFor={inputId} className="sr-only">Email address</label>
            <div className="flex gap-2">
              <input
                id={inputId}
                type="email"
                inputMode="email"
                autoComplete="email"
                required
                maxLength={254}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={form === "success" || form === "sending"}
                aria-describedby={statusId}
                placeholder="you@company.com"
                className="min-w-0 flex-1 rounded-md border border-near-black/50 bg-warm-white px-2 py-1.5 font-sans text-[13px] text-near-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold"
              />
              <button
                type="submit"
                disabled={form === "success" || form === "sending"}
                className="rounded-md bg-forest px-3 py-1.5 font-sans text-[13px] font-medium text-warm-white disabled:opacity-70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold"
              >
                {TILE_COPY.requestCta}
              </button>
            </div>
            {/* Honeypot: off-screen, not focusable, ignored by assistive tech. */}
            <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
              <input type="text" name="website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
            </div>
          </form>
        )}
        {/* Always rendered so the live region exists before it speaks. */}
        <p id={statusId} aria-live="polite" className="min-h-[1em] font-sans text-[12px] leading-snug text-near-black/80">
          {form === "success" ? TILE_COPY.success : form === "error" ? TILE_COPY.error : ""}
        </p>
        {form !== "success" && (
          <p className="font-sans text-[12px] leading-snug text-near-black/70">{TILE_COPY.requestNote}</p>
        )}

        <Link href="/predicts" className={LINK}>{TILE_COPY.forecastsLink}</Link>
      </div>

      {data?.releaseTag && (
        <p className="mt-auto pt-3 font-mono text-[11px] text-near-black/60">Release {data.releaseTag}</p>
      )}
    </div>
  );
}
