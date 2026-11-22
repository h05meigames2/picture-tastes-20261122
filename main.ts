// Burger flame-grilled: one ingredient, one picture.
// Draws a single beef burger as a 1024x1024 PNG using only Node stdlib.
// Run: node main.ts  ->  writes /output/entry.png
import * as fs from "node:fs";
import * as zlib from "node:zlib";

const W = 1024;
const H = 1024;
const buf = Buffer.alloc(W * H * 4);

// ---- tiny raster helpers ----
function px(x, y, r, g, b) {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 4;
  buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = 255;
}
function fillRect(x0, y0, x1, y1, c) {
  for (let y = Math.max(0, y0); y < Math.min(H, y1); y++)
    for (let x = Math.max(0, x0); x < Math.min(W, x1); x++) px(x, y, c[0], c[1], c[2]);
}
function fillEllipse(cx, cy, rx, ry, c) {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const dx = (x - cx) / rx, dy = (y - cy) / ry;
      if (dx * dx + dy * dy <= 1) px(x, y, c[0], c[1], c[2]);
    }
  }
}
function fillCircle(cx, cy, r, c) { fillEllipse(cx, cy, r, r, c); }
function thickLine(x0, y0, x1, y1, w, c) {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2 + 1;
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const x = Math.round(x0 + (x1 - x0) * t);
    const y = Math.round(y0 + (y1 - y0) * t);
    fillCircle(x, y, w, c);
  }
}
// wavy band: a row of overlapping circles along a baseline
function wavyBand(yBase, x0, x1, amp, r, c) {
  for (let x = x0; x <= x1; x += 14) {
    const y = yBase + Math.sin((x - x0) / 46) * amp;
    fillCircle(x, Math.round(y), r, c);
  }
  fillRect(x0, yBase - r + 6, x1, yBase + 6, c);
}

// ---- palette (my own choices) ----
const CREAM = [250, 238, 214];
const PLATE = [232, 214, 182];
const BUN = [232, 168, 76];
const BUN_DARK = [198, 128, 48];
const BUN_LIGHT = [246, 198, 110];
const PATTY = [94, 48, 24];
const GRILL = [52, 24, 10];
const CHEESE = [245, 178, 32];
const LETTUCE = [86, 158, 66];
const LETTUCE_D = [58, 122, 44];
const TOMATO = [214, 60, 47];
const SEED = [255, 240, 190];

// ---- background + plate ----
fillRect(0, 0, W, H, CREAM);
fillEllipse(512, 880, 400, 72, PLATE);
fillEllipse(512, 872, 400, 72, [238, 222, 192]);

// ---- bottom bun ----
fillEllipse(512, 800, 330, 78, BUN_DARK);
fillEllipse(512, 792, 330, 76, BUN);
fillRect(182, 780, 842, 800, BUN);

// ---- patty with grill marks ----
fillEllipse(512, 716, 348, 62, PATTY);
fillRect(164, 700, 860, 724, PATTY);
for (let i = 0; i < 7; i++) {
  const x = 220 + i * 100;
  thickLine(x, 676, x + 52, 748, 7, GRILL);
}
// charred edge dots
for (let i = 0; i < 26; i++) {
  const x = 200 + ((i * 137) % 620);
  const y = 690 + ((i * 53) % 52);
  fillCircle(x, y, 4, GRILL);
}

// ---- melting cheese ----
fillRect(196, 636, 828, 676, CHEESE);
for (let i = 0; i < 6; i++) {
  const x = 230 + i * 108;
  // drip triangles (stacked circles tapering down)
  fillCircle(x, 682, 26, CHEESE);
  fillCircle(x, 700, 18, CHEESE);
  fillCircle(x, 714, 10, CHEESE);
}

// ---- lettuce (wavy green layer) ----
wavyBand(636, 170, 854, 10, 30, LETTUCE);
wavyBand(640, 190, 834, 8, 22, LETTUCE_D);

// ---- tomato ----
fillEllipse(512, 596, 300, 42, TOMATO);
fillEllipse(512, 590, 300, 40, [228, 78, 60]);

// ---- top bun dome ----
fillEllipse(512, 560, 330, 74, BUN_DARK);
fillEllipse(512, 552, 330, 72, BUN);
fillEllipse(512, 520, 330, 110, BUN);
fillEllipse(512, 500, 330, 108, BUN);
// bun highlight
fillEllipse(430, 452, 150, 52, BUN_LIGHT);
// sesame seeds
const seeds = [
  [380, 452], [470, 420], [560, 408], [650, 440], [610, 486],
  [420, 500], [520, 470], [690, 500], [340, 510], [580, 520],
  [450, 545], [640, 540],
];
for (const [sx, sy] of seeds) {
  fillEllipse(sx, sy, 16, 9, SEED);
  fillEllipse(sx, sy - 2, 12, 6, [255, 248, 214]);
}
// soft sheen on the dome
fillEllipse(600, 430, 90, 26, BUN_LIGHT);

// ---- PNG encoder (stdlib only) ----
function crc32(b) {
  let table = (crc32 as any).t;
  if (!table) {
    table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    (crc32 as any).t = table;
  }
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = table[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}
const raw = Buffer.alloc(H * (1 + W * 3));
for (let y = 0; y < H; y++) {
  raw[y * (1 + W * 3)] = 0; // filter none
  for (let x = 0; x < W; x++) {
    const si = (y * W + x) * 4;
    const di = y * (1 + W * 3) + 1 + x * 3;
    raw[di] = buf[si]; raw[di + 1] = buf[si + 1]; raw[di + 2] = buf[si + 2];
  }
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);
fs.mkdirSync("/output", { recursive: true });
fs.writeFileSync("/output/entry.png", png);
console.log("wrote /output/entry.png", png.length, "bytes");
