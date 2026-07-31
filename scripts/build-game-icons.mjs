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
const GAMES = [
  { master: "Rackl.png",       slug: "rackl" },
  { master: "Signal.png",      slug: "signal-drop" },
  { master: "The Stack.png",   slug: "the-stack" },
  { master: "The Circuit.png", slug: "circuit" },
  { master: "The Brief.png",   slug: "the-brief" },
  { master: "Fiber.png",       slug: "dark-fiber" },
  { master: "Frequency.png",   slug: "frequency" },
];

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
