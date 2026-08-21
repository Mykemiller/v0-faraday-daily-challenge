// GET /api/share/card — the ONE share-card renderer (CC-DC-SHARE-1.0 D3).
//
// Server-rendered PNG via next/og ImageResponse: one template, the game slot
// swaps per slug; the same URL doubles as the og:image target (D9, Phase 4).
// Params (grammar fixed in Phase 1's buildShare): game, n, date, score, band,
// grid, plus renderer-only size=og|square. All validation lives in the pure
// module src/lib/share/card-params.js — invalid pieces degrade, an unknown
// game renders the Daily Challenge card, and the route never 500s a share link.
//
// Fonts are the vendored OFL IBM Plex set and the icons are the Phase-1 PNGs,
// both under public/share/ — fetched same-origin (not fs) so the exact same
// code works in dev, preview, and prod without output-tracing configuration,
// then cached in module scope so each instance pays the cost once.
import { ImageResponse } from "next/og";
import { NextRequest } from "next/server";
import { parseCardParams, finePrint } from "@/lib/share/card-params";
import { GENERIC_SLUG, buildShareRegistry } from "@/lib/share/manifest";
import { loadLiveGames } from "@/lib/game-registry-server";

export const dynamic = "force-dynamic";

// Palette: the card field matches the icon masters' dark frame; the tile keeps
// the forest family. Result pips: correct = per-game accent, partial = brand
// gold, miss = neutral dark (decorative graphics — not text, no AA obligation).
const FIELD = "#1a1a1a";
const CREAM = "#F8F5F0";
const GOLD = "#C4922A";
const MUTED = "#9A938C";
const MISS = "#3A3A3A";
const CYAN = "#29C8F0"; // the masters' baked-label cyan — used for the wordmark

// Per-instance asset cache: same-origin URL → bytes.
const assetCache = new Map<string, Promise<ArrayBuffer>>();
function fetchAsset(req: NextRequest, path: string): Promise<ArrayBuffer> {
  const url = new URL(path, req.nextUrl.origin).toString();
  let hit = assetCache.get(url);
  if (!hit) {
    hit = fetch(url).then((r) => {
      if (!r.ok) throw new Error(`asset ${path} -> ${r.status}`);
      return r.arrayBuffer();
    });
    hit.catch(() => assetCache.delete(url)); // don't cache failures
    assetCache.set(url, hit);
  }
  return hit;
}

function toDataUri(buf: ArrayBuffer): string {
  return `data:image/png;base64,${Buffer.from(buf).toString("base64")}`;
}

// The card's icon zone uses the label-cropped tile art (the card renders the
// game name as real text beside it — the baked label would double up).
function tileIconPath(slug: string): string {
  return slug === GENERIC_SLUG
    ? "/share/icons/daily-challenge-tile.png"
    : `/icons/games/${slug}-tile-256.png`;
}

export async function GET(req: NextRequest) {
  // Slug/accent/display name come from game_catalog (CC-DC-GAME-REGISTRY-1.0);
  // an unresolvable game degrades to the generic Daily Challenge card.
  const share = buildShareRegistry(await loadLiveGames());
  const p = parseCardParams(req.nextUrl.searchParams, share);
  const square = p.size.key === "square";

  const [monoReg, monoBold, serifBold, icon] = await Promise.all([
    fetchAsset(req, "/share/fonts/IBMPlexMono-Regular.ttf"),
    fetchAsset(req, "/share/fonts/IBMPlexMono-Bold.ttf"),
    fetchAsset(req, "/share/fonts/IBMPlexSerif-Bold.ttf"),
    // AC 7: a missing tile degrades to the DC mark, never a broken image.
    fetchAsset(req, tileIconPath(p.slug)).catch(() =>
      fetchAsset(req, tileIconPath(GENERIC_SLUG))
    ),
  ]);

  const iconSize = square ? 380 : 300;
  const pip = (rowLen: number) =>
    Math.max(18, Math.min(square ? 44 : 40, Math.floor((square ? 640 : 540) / rowLen) - 8));

  const grid = p.grid;
  const maxRowLen = grid ? Math.max(...grid.rows.map((r) => r.length)) : 0;
  const pipSize = grid ? pip(maxRowLen) : 0;

  const numberLine = [
    p.n !== null ? `#${p.n}` : null,
    p.date,
  ].filter(Boolean).join(" · ");

  const statLine = [
    p.score !== null ? `${p.score} pts` : null,
    p.band,
  ].filter(Boolean).join(" · ");

  const fine = finePrint(p.entry, p.date);

  const resultBlock = grid ? (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {grid.rows.map((row, ri) => (
        <div key={ri} style={{ display: "flex", gap: 8 }}>
          {row.map((state, ci) => (
            <div
              key={ci}
              style={{
                width: pipSize,
                height: pipSize,
                borderRadius: Math.round(pipSize * 0.22),
                backgroundColor:
                  state === "correct" ? p.entry.accent : state === "partial" ? GOLD : MISS,
              }}
            />
          ))}
        </div>
      ))}
    </div>
  ) : null;

  const infoColumn = (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: square ? "center" : "flex-start",
        gap: square ? 18 : 16,
      }}
    >
      <div style={{ display: "flex", fontFamily: "mono", fontSize: 26, letterSpacing: 6, color: GOLD }}>
        FARADAY DAILY CHALLENGE
      </div>
      <div style={{ display: "flex", fontFamily: "serif", fontSize: square ? 84 : 76, color: CREAM, lineHeight: 1.05 }}>
        {p.entry.displayName}
      </div>
      {numberLine ? (
        <div style={{ display: "flex", fontFamily: "mono", fontSize: 34, color: MUTED }}>{numberLine}</div>
      ) : null}
      {resultBlock}
      {statLine ? (
        <div style={{ display: "flex", fontFamily: "monobold", fontSize: 40, color: GOLD }}>{statLine}</div>
      ) : null}
    </div>
  );

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          backgroundColor: FIELD,
          padding: square ? "56px 64px 40px" : "48px 64px 36px",
        }}
      >
        <div
          style={{
            display: "flex",
            flexGrow: 1,
            flexDirection: square ? "column" : "row",
            alignItems: "center",
            justifyContent: square ? "flex-start" : "flex-start",
            gap: square ? 40 : 64,
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={toDataUri(icon)}
            width={iconSize}
            height={iconSize}
            alt=""
            style={{ borderRadius: Math.round(iconSize * 0.09), flexShrink: 0 }}
          />
          {infoColumn}
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            borderTop: `2px solid ${MISS}`,
            paddingTop: square ? 26 : 22,
          }}
        >
          <div style={{ display: "flex", fontFamily: "monobold", fontSize: 30, color: CYAN }}>
            faradaydailychallenge.com
          </div>
          {fine ? (
            <div style={{ display: "flex", fontFamily: "mono", fontSize: 22, color: MUTED }}>{fine}</div>
          ) : null}
        </div>
      </div>
    ),
    {
      width: p.size.width,
      height: p.size.height,
      fonts: [
        { name: "mono", data: monoReg, weight: 400, style: "normal" },
        { name: "monobold", data: monoBold, weight: 700, style: "normal" },
        { name: "serif", data: serifBold, weight: 700, style: "normal" },
      ],
      headers: {
        // Deterministic by URL params — cacheable at the edge and in clients.
        "Cache-Control": "public, max-age=3600, s-maxage=86400",
      },
    }
  );
}
