// Regenerates public/icons/games/* from the 1280×1280 neon-on-forest master PNGs.
//
// The masters are a dark #1a1a1a field holding a 1024×1024 rounded forest tile at
// (128,50), with the game name baked in cyan below it. Two products come out:
//   <slug>-tile-{128,256}.png — tile only (label cropped off). Every in-app surface
//     already renders the game name as HTML text next to the icon, so the baked
//     label would double up. 256 covers 4× DPR at the largest render (64px).
//   <slug>-share.png — the full labeled frame at 640, for the share-card canvas
//     where the baked label is the point.
//
// sharp is NOT a project dependency (this is a one-off asset build, not part of
// next build). Run it with a throwaway install:
//   mkdir -p /tmp/icons && cd /tmp/icons && npm i sharp
//   NODE_PATH=/tmp/icons/node_modules node scripts/build-game-icons.mjs <masters-dir>
import sharp from "sharp";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const MASTERS = process.argv[2];
if (!MASTERS) { console.error("usage: build-game-icons.mjs <masters-dir>"); process.exit(1); }
const OUT = path.join(process.cwd(), "public/icons/games");

// Master filename → route slug. Three masters are labeled with a shorter name
// than the game key ("SIGNAL"/"FIBER"/"THE CIRCUIT" for Signal Drop / Dark Fiber
// / Circuit); the slug follows the app's route, not the label.
// Source art filename per slug. The MASTERS are named by the designer and do
// not derive from the slug, so this mapping is real art-pipeline data and stays
// in code (CC-DC-GAME-REGISTRY-1.0 Q5). What is NOT hardcoded any more is the
// ROSTER: the slugs to build come from game_catalog, so a new game shows up
// here as a loud "no master art" warning rather than being silently skipped.
const MASTER_BY_SLUG = {
  "rackl": "Rackl.png",
  "signal-drop": "Signal.png",
  "the-stack": "The Stack.png",
  "circuit": "The Circuit.png",
  "the-brief": "The Brief.png",
  "dark-fiber": "Fiber.png",
  "frequency": "Frequency.png",
};

const SUPABASE_URL = process.env.SUPABASE_URL || "https://ycadmmngkdhvpcsrcuaq.supabase.co";

async function liveSlugs() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("build-game-icons: SUPABASE_SERVICE_ROLE_KEY is required to read game_catalog");
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/game_catalog?lifecycle_state=eq.live&select=route_slug,display_name&order=lobby_sort_order.asc`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } }
  );
  if (!res.ok) throw new Error(`build-game-icons: game_catalog read failed (${res.status})`);
  return await res.json();
}

const GAMES = (await liveSlugs())
  .map((r) => {
    const slug = r.route_slug;
    const master = slug ? MASTER_BY_SLUG[slug] : null;
    if (!master) {
      console.warn(`  ! no master art for "${r.display_name}" (slug ${slug || "none"}) — skipping`);
      return null;
    }
    return { master, slug };
  })
  .filter(Boolean);

// Tile bounds, verified identical across all masters.
const TILE = { left: 128, top: 50, width: 1024, height: 1024 };
const TILE_SIZES = [128, 256];
const SHARE_SIZE = 640;

await mkdir(OUT, { recursive: true });
for (const { master, slug } of GAMES) {
  const src = path.join(MASTERS, master);
  for (const size of TILE_SIZES) {
    const out = path.join(OUT, `${slug}-tile-${size}.png`);
    await sharp(src).extract(TILE)
      .resize(size, size, { kernel: "lanczos3" })
      .png({ compressionLevel: 9, effort: 10, palette: true, quality: 90 })
      .toFile(out);
    console.log("wrote", path.relative(process.cwd(), out));
  }
  const shareOut = path.join(OUT, `${slug}-share.png`);
  await sharp(src)
    .resize(SHARE_SIZE, SHARE_SIZE, { kernel: "lanczos3" })
    .png({ compressionLevel: 9, effort: 10, palette: true, quality: 90 })
    .toFile(shareOut);
  console.log("wrote", path.relative(process.cwd(), shareOut));
}
