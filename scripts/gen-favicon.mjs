// scripts/gen-favicon.mjs — CC-FDC-FAVICON-1.0
// Generates the Faraday "F" roundel raster assets from the same geometry as
// public/icon.svg / app/icon.svg (viewBox 0 0 1024 1024). Pure Node — no image
// deps (this Next build ships no sharp / next-og / rasterizer). Renders each
// asset analytically, 4x supersampled, and encodes PNG via built-in zlib; the
// .ico wraps the 32/16 PNG payloads.
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "app");

// --- Brand geometry (matches the SVG exactly) --------------------------------
const GREEN = [0x1c, 0x34, 0x24]; // #1C3424 forest green
const GOLD = [0xc4, 0x92, 0x2a]; // #C4922A gold
const VB = 1024;
const CX = 512, CY = 512;
const R_FILL = 500; // circle r
const RING_C = 466, RING_W = 10; // ring stroke centered on r466, width 10
const RING_IN = RING_C - RING_W / 2, RING_OUT = RING_C + RING_W / 2;
// The serif "F", as filled rects [x, y, w, h] — identical to the SVG <g>.
const F_RECTS = [
  [320, 272, 377, 48],
  [630, 272, 67, 123],
  [372, 272, 96, 453],
  [468, 440, 149, 52],
  [570, 440, 47, 140],
  [320, 708, 213, 44],
];

// Sample the artwork at viewBox coords -> [r,g,b,a] (a: 0 or 255).
// opaqueBg=true fills the whole square green (Apple/Android tiles: no transparent
// corners, which iOS renders as black); false keeps transparent corners.
function sample(vx, vy, opaqueBg) {
  const d = Math.hypot(vx - CX, vy - CY);
  const inF = F_RECTS.some(
    ([x, y, w, h]) => vx >= x && vx < x + w && vy >= y && vy < y + h
  );
  if (inF) return [...GOLD, 255];
  if (d >= RING_IN && d <= RING_OUT) return [...GOLD, 255]; // gold ring
  if (d <= R_FILL) return [...GREEN, 255]; // green disc
  return opaqueBg ? [...GREEN, 255] : [0, 0, 0, 0];
}

// Render size x size RGBA, 4x supersampled with premultiplied (fringe-free) box
// downsample so transparent edges don't darken.
function render(size, opaqueBg) {
  const ss = 4;
  const buf = Buffer.alloc(size * size * 4);
  const k = (size * ss) / VB;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let sr = 0, sg = 0, sb = 0, cov = 0, aAcc = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const vx = (px * ss + sx + 0.5) / k;
          const vy = (py * ss + sy + 0.5) / k;
          const [r, g, b, a] = sample(vx, vy, opaqueBg);
          aAcc += a;
          if (a) { sr += r; sg += g; sb += b; cov++; }
        }
      }
      const n = ss * ss;
      const o = (py * size + px) * 4;
      // color averaged only over covered subpixels -> no dark halo
      buf[o] = cov ? Math.round(sr / cov) : 0;
      buf[o + 1] = cov ? Math.round(sg / cov) : 0;
      buf[o + 2] = cov ? Math.round(sb / cov) : 0;
      buf[o + 3] = Math.round(aAcc / n);
    }
  }
  return buf;
}

// --- minimal PNG encoder ------------------------------------------------------
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return (buf) => {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
})();

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(CRC(td), 0);
  return Buffer.concat([len, td, crc]);
}

function encodePNG(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  // rows with filter byte 0
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// --- ICO (embeds PNG payloads) ------------------------------------------------
function encodeICO(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);
  const dir = Buffer.alloc(16 * entries.length);
  let offset = 6 + dir.length;
  entries.forEach((e, i) => {
    const b = i * 16;
    dir[b] = e.size >= 256 ? 0 : e.size;
    dir[b + 1] = e.size >= 256 ? 0 : e.size;
    dir[b + 2] = 0; dir[b + 3] = 0;
    dir.writeUInt16LE(1, b + 4);   // planes
    dir.writeUInt16LE(32, b + 6);  // bpp
    dir.writeUInt32LE(e.png.length, b + 8);
    dir.writeUInt32LE(offset, b + 12);
    offset += e.png.length;
  });
  return Buffer.concat([header, dir, ...entries.map((e) => e.png)]);
}

// --- emit ---------------------------------------------------------------------
const write = (name, buf) => {
  writeFileSync(join(OUT, name), buf);
  console.log(`  ${name}  ${buf.length} bytes`);
};

// favicon.ico — transparent corners, 32 + 16 multi-res
const ico = encodeICO([
  { size: 32, png: encodePNG(32, render(32, false)) },
  { size: 16, png: encodePNG(16, render(16, false)) },
]);
write("favicon.ico", ico);

// apple-icon — opaque tile (iOS masks transparency to black)
write("apple-icon.png", encodePNG(180, render(180, true)));

// PWA / Android manifest icons — opaque tiles
write("icon-192.png", encodePNG(192, render(192, true)));
write("icon-512.png", encodePNG(512, render(512, true)));

console.log("done.");
