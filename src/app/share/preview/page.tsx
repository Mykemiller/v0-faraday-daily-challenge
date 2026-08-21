import { notFound } from "next/navigation";
import { loadLiveGames } from "@/lib/game-registry-server";
import { keyOf } from "@/lib/game-registry";

// CC-DC-SHARE-1.0 Phase 2 — the design-review sheet: every live game + the
// generic card from the real /api/share/card renderer, both size variants, one
// screen. The roster comes from game_catalog (CC-DC-GAME-REGISTRY-1.0).
//
// AC 6: excluded from PRODUCTION routing. Local dev and Vercel preview deploys
// render it (that is where design review happens); the production environment
// 404s. VERCEL_ENV distinguishes preview from production where NODE_ENV can't.
const isProduction = process.env.VERCEL_ENV === "production";

export const metadata = { title: "Share card preview · Faraday Daily Challenge" };
export const dynamic = "force-dynamic";

// Representative sample results — states/counts only. The grid grammar is
// genuinely per-game (a Wordle row and a ranked list encode differently), so
// these stay in code as a registry keyed on ROUTE SLUG; a game with no sample
// still gets a card, just without a grid.
const SAMPLE_BY_SLUG: Record<string, string> = {
  rackl: "score=142&band=Ahead+of+Consensus&grid=s4m1",
  "signal-drop": "score=118&band=On+Pace&grid=aapaaa-pcapaa-cccccc",
  "the-stack": "score=96&band=Taking+the+Long+View&grid=oxoxo",
  circuit: "score=104&band=On+Pace&grid=ooxoo",
  "the-brief": "score=110&band=Ahead+of+Consensus&grid=oooxo",
  "dark-fiber": "score=128&band=On+Pace&grid=p6m2",
  frequency: "score=88&band=Taking+the+Long+View&grid=ooox",
};

const FIXED_SAMPLES: Array<{ label: string; qs: string }> = [
  { label: "Generic (Daily Challenge)", qs: "score=742" },
  { label: "Degraded: unknown game, no result fields", qs: "game=mystery" },
];

export default async function SharePreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ size?: string }>;
}) {
  if (isProduction) notFound();

  // One card per live game, in locked lobby order, straight from the catalog.
  const gameSamples = (await loadLiveGames()).map((g) => {
    const slug = g.route_slug || "";
    const extra = SAMPLE_BY_SLUG[slug] || "";
    return {
      label: keyOf(g),
      qs: `game=${encodeURIComponent(slug)}&n=38&date=2026-07-31${extra ? `&${extra}` : ""}`,
    };
  });
  const SAMPLES = [...gameSamples, ...FIXED_SAMPLES];

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
