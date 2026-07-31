import { notFound } from "next/navigation";

// CC-DC-SHARE-1.0 Phase 2 — the design-review sheet: all 7 games + the generic
// card from the real /api/share/card renderer, both size variants, one screen.
//
// AC 6: excluded from PRODUCTION routing. Local dev and Vercel preview deploys
// render it (that is where design review happens); the production environment
// 404s. VERCEL_ENV distinguishes preview from production where NODE_ENV can't.
const isProduction = process.env.VERCEL_ENV === "production";

export const metadata = { title: "Share card preview · Faraday Daily Challenge" };
export const dynamic = "force-dynamic";

// Representative sample results — states/counts only, one per game, exercising
// every grid grammar plus the no-grid generic case and all three band labels.
const SAMPLES: Array<{ label: string; qs: string }> = [
  { label: "Rackl", qs: "game=rackl&n=38&date=2026-07-31&score=142&band=Ahead+of+Consensus&grid=s4m1" },
  { label: "Signal Drop", qs: "game=signal-drop&n=38&date=2026-07-31&score=118&band=On+Pace&grid=aapaaa-pcapaa-cccccc" },
  { label: "The Stack", qs: "game=the-stack&n=38&date=2026-07-31&score=96&band=Taking+the+Long+View&grid=oxoxo" },
  { label: "Circuit", qs: "game=circuit&n=38&date=2026-07-31&score=104&band=On+Pace&grid=ooxoo" },
  { label: "The Brief", qs: "game=the-brief&n=38&date=2026-07-31&score=110&band=Ahead+of+Consensus&grid=oooxo" },
  { label: "Dark Fiber", qs: "game=dark-fiber&n=38&date=2026-07-31&score=128&band=On+Pace&grid=p6m2" },
  { label: "Frequency", qs: "game=frequency&n=38&date=2026-07-31&score=88&band=Taking+the+Long+View&grid=ooox" },
  { label: "Generic (Daily Challenge)", qs: "score=742" },
  { label: "Degraded: unknown game, no result fields", qs: "game=mystery" },
];

export default async function SharePreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ size?: string }>;
}) {
  if (isProduction) notFound();
  const { size } = await searchParams;
  const square = size === "square";
  const sizeQs = square ? "&size=square" : "";

  return (
    <div style={{ background: "#0D110E", minHeight: "100vh", padding: "32px 40px", fontFamily: "monospace" }}>
      <h1 style={{ color: "#F8F5F0", fontSize: 20, marginBottom: 4 }}>
        Share card preview — {square ? "1080×1080 (square)" : "1200×630 (OG)"}
      </h1>
      <p style={{ color: "#9A938C", fontSize: 13, marginBottom: 24 }}>
        Rendered live by <code>/api/share/card</code>.{" "}
        <a href="/share/preview" style={{ color: "#29C8F0" }}>OG size</a>
        {" · "}
        <a href="/share/preview?size=square" style={{ color: "#29C8F0" }}>square size</a>
        {" — not routable in production."}
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 28 }}>
        {SAMPLES.map((s) => (
          <figure key={s.label} style={{ margin: 0 }}>
            <figcaption style={{ color: "#C4922A", fontSize: 13, marginBottom: 8 }}>{s.label}</figcaption>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/share/card?${s.qs}${sizeQs}`}
              alt={`${s.label} share card`}
              width={square ? 420 : 560}
              style={{ display: "block", border: "1px solid #2A2520", borderRadius: 8 }}
            />
          </figure>
        ))}
      </div>
    </div>
  );
}
