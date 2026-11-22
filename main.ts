// picture-tastes-20261122 — "The picture that tastes of one ingredient"
// A program that writes one image to /output/entry.png:
// a flame-grilled beef burger, drawn procedurally with a tiny software
// rasterizer (no assets, no network, Node stdlib only). 1024x1024 PNG.
// Re-authored in-session after the competition opened (03:47 WIB window).
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const SS = 2; // supersample factor (render 2048, downsample to 1024)
const W = 1024 * SS;
const H = 1024 * SS;

// ---------- deterministic RNG ----------
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20261122);

// ---------- colour helpers ----------
type RGBA = [number, number, number, number]; // r,g,b 0..255, a 0..1
type Paint = (x: number, y: number) => RGBA;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
function mix(c1: RGBA, c2: RGBA, t: number): RGBA {
  return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t), lerp(c1[3], c2[3], t)];
}
function hex(h: string, a = 1): RGBA {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, a];
}
function solid(c: RGBA): Paint {
  return () => c;
}
function ramp(stops: Array<[number, RGBA]>, t: number): RGBA {
  if (t <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const t0 = stops[i - 1][0];
      const c0 = stops[i - 1][1];
      const t1 = stops[i][0];
      const c1 = stops[i][1];
      return mix(c0, c1, (t - t0) / (t1 - t0 || 1));
    }
  }
  return stops[stops.length - 1][1];
}
function linear(x0: number, y0: number, x1: number, y1: number, stops: Array<[number, RGBA]>): Paint {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len2 = dx * dx + dy * dy;
  return (x, y) => {
    let t = len2 === 0 ? 0 : ((x - x0) * dx + (y - y0) * dy) / len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return ramp(stops, t);
  };
}
function radial(cx: number, cy: number, r0: number, r1: number, stops: Array<[number, RGBA]>): Paint {
  return (x, y) => {
    const d = Math.hypot(x - cx, y - cy);
    let t = (d - r0) / (r1 - r0);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return ramp(stops, t);
  };
}

// ---------- canvas (coordinates in 1024-space, rendered at 2048) ----------
class Canvas {
  data = new Float32Array(W * H * 4);

  // source-over composite of one pixel (x, y in 1024-space)
  blend(x: number, y: number, c: RGBA): void {
    const X = Math.round(x * SS);
    const Y = Math.round(y * SS);
    if (X < 0 || Y < 0 || X >= W || Y >= H) return;
    const a = c[3];
    if (a <= 0) return;
    const i = (Y * W + X) * 4;
    const d = this.data;
    const da = d[i + 3];
    const oa = a + da * (1 - a);
    if (oa <= 0) return;
    const ia = 1 - a;
    d[i] = (c[0] * a + d[i] * da * ia) / oa;
    d[i + 1] = (c[1] * a + d[i + 1] * da * ia) / oa;
    d[i + 2] = (c[2] * a + d[i + 2] * da * ia) / oa;
    d[i + 3] = oa;
  }

  // scanline polygon fill; paint is called per pixel (1024-space coords)
  poly(pts: Array<[number, number]>, paint: Paint): void {
    const P = pts.map(([x, y]): [number, number] => [x * SS, y * SS]);
    let minY = Infinity;
    let maxY = -Infinity;
    for (const [, y] of P) {
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const y0 = Math.max(0, Math.floor(minY));
    const y1 = Math.min(H - 1, Math.ceil(maxY));
    const n = P.length;
    for (let y = y0; y <= y1; y++) {
      const yc = y + 0.5;
      const xs: number[] = [];
      for (let i = 0; i < n; i++) {
        const p0 = P[i];
        const p1 = P[(i + 1) % n];
        if ((p0[1] <= yc && p1[1] > yc) || (p1[1] <= yc && p0[1] > yc)) {
          xs.push(p0[0] + ((yc - p0[1]) / (p1[1] - p0[1])) * (p1[0] - p0[0]));
        }
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const xa = Math.max(0, Math.ceil(xs[k] - 0.5));
        const xb = Math.min(W - 1, Math.floor(xs[k + 1] - 0.5));
        for (let x = xa; x <= xb; x++) {
          const c = paint(x / SS, y / SS);
          if (c[3] <= 0) continue;
          const idx = (y * W + x) * 4;
          const d = this.data;
          const a = c[3];
          const da = d[idx + 3];
          const oa = a + da * (1 - a);
          if (oa <= 0) continue;
          const ia = 1 - a;
          d[idx] = (c[0] * a + d[idx] * da * ia) / oa;
          d[idx + 1] = (c[1] * a + d[idx + 1] * da * ia) / oa;
          d[idx + 2] = (c[2] * a + d[idx + 2] * da * ia) / oa;
          d[idx + 3] = oa;
        }
      }
    }
  }

  ellipse(cx: number, cy: number, rx: number, ry: number, paint: Paint): void {
    const pts: Array<[number, number]> = [];
    const N = 72;
    for (let i = 0; i < N; i++) {
      const t = (i / N) * Math.PI * 2;
      pts.push([cx + Math.cos(t) * rx, cy + Math.sin(t) * ry]);
    }
    this.poly(pts, paint);
  }

  // partial ellipse arc as a closed polygon (a1..a2 in radians, fan from centre)
  arc(cx: number, cy: number, rx: number, ry: number, a1: number, a2: number, paint: Paint): void {
    const pts: Array<[number, number]> = [];
    const N = 72;
    for (let i = 0; i <= N; i++) {
      const t = a1 + ((a2 - a1) * i) / N;
      pts.push([cx + Math.cos(t) * rx, cy + Math.sin(t) * ry]);
    }
    this.poly(pts, paint);
  }

  // filled disc (soft falloff when paint is a radial gradient)
  disc(cx: number, cy: number, r: number, paint: Paint): void {
    const x0 = Math.max(0, Math.floor((cx - r) * SS));
    const x1 = Math.min(W - 1, Math.ceil((cx + r) * SS));
    const y0 = Math.max(0, Math.floor((cy - r) * SS));
    const y1 = Math.min(H - 1, Math.ceil((cy + r) * SS));
    const d = this.data;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const px = x / SS;
        const py = y / SS;
        const dx = px - cx;
        const dy = py - cy;
        if (dx * dx + dy * dy > r * r) continue;
        const c = paint(px, py);
        if (c[3] <= 0) continue;
        const idx = (y * W + x) * 4;
        const a = c[3];
        const da = d[idx + 3];
        const oa = a + da * (1 - a);
        if (oa <= 0) continue;
        const ia = 1 - a;
        d[idx] = (c[0] * a + d[idx] * da * ia) / oa;
        d[idx + 1] = (c[1] * a + d[idx + 1] * da * ia) / oa;
        d[idx + 2] = (c[2] * a + d[idx + 2] * da * ia) / oa;
        d[idx + 3] = oa;
      }
    }
  }

  // soft glowing disc: white/colored light fading to transparent
  softDisc(cx: number, cy: number, r: number, c: RGBA): void {
    this.disc(
      cx,
      cy,
      r,
      radial(cx, cy, 0, r, [
        [0, c],
        [0.55, [c[0], c[1], c[2], c[3] * 0.45]],
        [1, [c[0], c[1], c[2], 0]],
      ]),
    );
  }

  // thick polyline with round caps, drawn as stamped discs
  stroke(pts: Array<[number, number]>, width: number, c: RGBA): void {
    const step = Math.max(1, width / 4);
    for (let i = 0; i + 1 < pts.length; i++) {
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[i + 1];
      const len = Math.hypot(x1 - x0, y1 - y0);
      const n = Math.max(1, Math.ceil(len / step));
      for (let s = 0; s <= n; s++) {
        const t = s / n;
        this.disc(lerp(x0, x1, t), lerp(y0, y1, t), width / 2, solid(c));
      }
    }
  }

  // filled rect (1024-space)
  rect(x: number, y: number, w: number, h: number, paint: Paint): void {
    this.poly(
      [
        [x, y],
        [x + w, y],
        [x + w, y + h],
        [x, y + h],
      ],
      paint,
    );
  }
}

// ---------- tiny 5x7 bitmap font (for one clean caption line) ----------
const FONT: Record<string, string[]> = {
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01110", "10001", "10000", "10111", "10001", "10001", "01111"],
  I: ["01110", "00100", "00100", "00100", "00100", "00100", "01110"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  "·": ["00000", "00000", "00000", "00000", "00000", "01100", "01100"],
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
};

function drawText(cv: Canvas, str: string, cx: number, topY: number, scale: number, c: RGBA): void {
  const charW = 6 * scale;
  const totalW = str.length * charW - scale;
  let x = cx - totalW / 2;
  for (const ch of str) {
    const g = FONT[ch] ?? FONT[" "];
    for (let row = 0; row < 7; row++) {
      for (let col = 0; col < 5; col++) {
        if (g[row][col] === "1") {
          cv.rect(x + col * scale, topY + row * scale, scale, scale, solid(c));
        }
      }
    }
    x += charW;
  }
}

// ---------- PNG encoder (with per-row filter choice) ----------
const CRC_TABLE: Uint32Array = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}

function encodePNG(rgba: Uint8Array, w: number, h: number): Buffer {
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const row = rgba.subarray(y * stride, (y + 1) * stride);
    let best: Buffer | null = null;
    let bestScore = Infinity;
    let bestFilter = 0;
    for (let f = 0; f < 5; f++) {
      const out = Buffer.alloc(stride);
      for (let x = 0; x < stride; x++) {
        const v = row[x];
        let pred = 0;
        if (f === 1) pred = x >= 4 ? row[x - 4] : 0;
        else if (f === 2) pred = prev[x];
        else if (f === 3) pred = Math.floor(((x >= 4 ? row[x - 4] : 0) + prev[x]) / 2);
        else if (f === 4) {
          const a = x >= 4 ? row[x - 4] : 0;
          const b = prev[x];
          const cc = x >= 4 ? prev[x - 4] : 0;
          const p = a + b - cc;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - cc);
          pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : cc;
        }
        out[x] = (v - pred) & 255;
      }
      let score = 0;
      for (let x = 0; x < stride; x++) {
        const s = out[x];
        score += s < 128 ? s : 256 - s;
      }
      if (score < bestScore) {
        bestScore = score;
        best = out;
        bestFilter = f;
      }
    }
    raw[y * (stride + 1)] = bestFilter;
    (best as Buffer).copy(raw, y * (stride + 1) + 1);
    prev = Buffer.from(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    sig,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------- the scene: one flame-grilled beef burger, big and centred ----------
// Hero ingredient: flame-grilled beef. Warm dark background, cream plate,
// glossy top bun with sesame, melting cheese, charred patty, fresh lettuce
// and tomato, gentle steam. Built to read at 300px: one huge subject,
// strong warm/cool contrast, clean shapes.
function drawScene(cv: Canvas): void {
  // background: warm dark vertical gradient
  cv.rect(
    0,
    0,
    1024,
    1024,
    linear(0, 0, 0, 1024, [
      [0, hex("#2b1a10")],
      [0.55, hex("#211410")],
      [1, hex("#120a06")],
    ]),
  );
  // warm glow behind the burger
  cv.ellipse(
    512,
    540,
    620,
    620,
    radial(512, 540, 0, 620, [
      [0, [255, 140, 50, 0.26]],
      [0.5, [255, 120, 40, 0.09]],
      [1, [255, 120, 40, 0]],
    ]),
  );

  // steam: three wisps rising above the bun (drawn early so the bun occludes their bases)
  const wisps: Array<[number, number]> = [
    [400, 0.0],
    [470, 1.1],
    [545, 2.3],
    [620, 3.4],
  ];
  for (const [x0, phase] of wisps) {
    for (let y = 300; y >= 46; y -= 9) {
      const t = (300 - y) / 254;
      const x = x0 + 16 * Math.sin(t * 5.2 + phase) + 6 * Math.sin(t * 11 + phase * 2);
      cv.softDisc(x, y, 22 + 10 * Math.sin(t * 3.1), [255, 250, 240, 0.13]);
    }
  }

  // plate shadow on the table
  cv.ellipse(
    512,
    806,
    405,
    78,
    radial(512, 806, 0, 405, [
      [0, [0, 0, 0, 0.4]],
      [1, [0, 0, 0, 0]],
    ]),
  );
  // plate
  cv.ellipse(
    512,
    782,
    395,
    102,
    radial(512, 758, 0, 400, [
      [0, hex("#f8eeda")],
      [0.75, hex("#ecd9ae")],
      [1, hex("#d6bd8a")],
    ]),
  );
  cv.ellipse(
    512,
    776,
    348,
    84,
    radial(512, 760, 0, 350, [
      [0, hex("#fffaf0")],
      [1, hex("#f3e6c8")],
    ]),
  );
  // plate rim ring
  const rimPts: Array<[number, number]> = [];
  for (let i = 0; i <= 72; i++) {
    const t = (i / 72) * Math.PI * 2;
    rimPts.push([512 + Math.cos(t) * 372, 779 + Math.sin(t) * 93]);
  }
  cv.stroke(rimPts, 3, [200, 171, 114, 0.55]);

  // soft shadow of the burger on the plate
  cv.ellipse(
    512,
    798,
    300,
    38,
    radial(512, 798, 0, 300, [
      [0, [0, 0, 0, 0.22]],
      [1, [0, 0, 0, 0]],
    ]),
  );

  // ---- bottom bun ----
  cv.ellipse(
    512,
    738,
    252,
    64,
    linear(512, 674, 512, 802, [
      [0, hex("#e8a950")],
      [0.55, hex("#c07c22")],
      [1, hex("#96590f")],
    ]),
  );
  const bunTopPts: Array<[number, number]> = [];
  for (let i = 0; i <= 40; i++) {
    const t = Math.PI + (Math.PI * i) / 40; // top arc of the ellipse
    bunTopPts.push([512 + Math.cos(t) * 252, 738 + Math.sin(t) * 64]);
  }
  cv.stroke(bunTopPts, 6, [246, 200, 120, 0.7]);

  // ---- flame-grilled beef patty ----
  cv.ellipse(
    512,
    692,
    282,
    54,
    linear(512, 638, 512, 746, [
      [0, hex("#7a4520")],
      [0.5, hex("#41230f")],
      [1, hex("#241207")],
    ]),
  );
  // char speckles and grill texture
  for (let i = 0; i < 150; i++) {
    const a = rnd() * Math.PI * 2;
    const rr = Math.sqrt(rnd());
    const x = 512 + Math.cos(a) * rr * 272;
    const y = 692 + Math.sin(a) * rr * 48;
    const dark = rnd() < 0.6;
    cv.disc(x, y, 2 + rnd() * 2.5, solid(dark ? [26, 13, 5, 0.32] : [138, 90, 48, 0.22]));
  }
  // char marks
  for (let i = 0; i < 6; i++) {
    const x = 300 + rnd() * 420;
    const y = 672 + rnd() * 30;
    cv.stroke(
      [
        [x, y],
        [x + 26 + rnd() * 20, y + 4],
      ],
      5,
      [20, 10, 4, 0.28],
    );
  }
  // patty top highlight
  const pattyTop: Array<[number, number]> = [];
  for (let i = 0; i <= 40; i++) {
    const t = Math.PI + (Math.PI * i) / 40;
    pattyTop.push([512 + Math.cos(t) * 282, 692 + Math.sin(t) * 54]);
  }
  cv.stroke(pattyTop, 4, [150, 96, 48, 0.5]);
  // glossy juice highlight on the patty
  cv.softDisc(400, 668, 80, [200, 130, 70, 0.14]);

  // ---- melting cheese ----
  const cheeseTop: Array<[number, number]> = [];
  for (let x = 250; x <= 774; x += 8) {
    cheeseTop.push([x, 644 + 5 * Math.sin(x * 0.03)]);
  }
  const cheesePts: Array<[number, number]> = [...cheeseTop];
  // right edge down, then bottom edge back left (wavy), drips handled separately
  cheesePts.push([774, 668]);
  for (let x = 774; x >= 250; x -= 8) {
    cheesePts.push([x, 668 + 4 * Math.sin(x * 0.05 + 2)]);
  }
  cheesePts.push([250, 668]);
  cv.poly(
    cheesePts,
    linear(512, 640, 512, 680, [
      [0, hex("#ffd23e")],
      [1, hex("#f08c05")],
    ]),
  );
  // cheese drips over the patty edge
  for (const [dx, len] of [
    [340, 40],
    [512, 46],
    [690, 36],
  ] as Array<[number, number]>) {
    cv.rect(dx - 18, 664, 36, len - 14, solid(hex("#f6a91a")));
    cv.disc(dx, 664 + len - 14, 18, solid(hex("#f6a91a")));
    cv.disc(dx - 5, 664 + len - 18, 6, solid([255, 214, 90, 0.8]));
  }

  // ---- tomato slice ----
  cv.ellipse(
    512,
    624,
    268,
    24,
    radial(512, 624, 0, 268, [
      [0, hex("#f2603f")],
      [0.7, hex("#e03a20")],
      [1, hex("#b81f10")],
    ]),
  );

  // ---- fresh lettuce (ruffled band) ----
  const letTop: Array<[number, number]> = [];
  const letBot: Array<[number, number]> = [];
  for (let x = 236; x <= 788; x += 6) {
    letTop.push([x, 594 + 8 * Math.sin(x * 0.045 + 1.3)]);
    letBot.push([x, 622 + 10 * Math.sin(x * 0.05)]);
  }
  cv.poly(
    [...letTop, ...letBot.reverse()],
    linear(512, 590, 512, 626, [
      [0, hex("#93c94e")],
      [1, hex("#5d9c2e")],
    ]),
  );
  // lettuce scallop shadows + light top edge
  for (let x = 250; x <= 780; x += 28) {
    cv.disc(x, 620 + 8 * Math.sin(x * 0.05), 7, solid([46, 110, 26, 0.25]));
  }
  cv.stroke(letTop, 3, [181, 224, 122, 0.5]);

  // ---- top bun dome ----
  cv.arc(
    512,
    596,
    298,
    288,
    Math.PI,
    Math.PI * 2,
    radial(430, 360, 40, 560, [
      [0, hex("#f9c65e")],
      [0.45, hex("#eda93c")],
      [0.8, hex("#c9821f")],
      [1, hex("#a86a16")],
    ]),
  );
  // dome bottom-edge shadow (where bun meets lettuce)
  cv.stroke(
    [
      [216, 596],
      [808, 596],
    ],
    10,
    [122, 74, 16, 0.35],
  );
  // round the dome's sides with soft shade
  cv.softDisc(248, 520, 95, [90, 50, 10, 0.13]);
  cv.softDisc(782, 520, 95, [90, 50, 10, 0.13]);
  // bun sheen
  cv.softDisc(430, 370, 170, [255, 240, 200, 0.16]);
  cv.softDisc(400, 330, 70, [255, 245, 220, 0.22]);

  // ---- sesame seeds on the dome ----
  const seeds: Array<[number, number, number]> = [
    [380, 380, -20],
    [470, 330, 15],
    [560, 360, 30],
    [640, 420, -15],
    [330, 470, 25],
    [430, 460, -30],
    [530, 450, 10],
    [620, 500, -25],
    [700, 470, 20],
    [390, 540, 0],
    [480, 520, -10],
    [590, 560, 15],
    [660, 600, -5],
    [300, 560, 35],
  ];
  for (const [sx, sy, rot] of seeds) {
    // keep inside the dome
    const dy = (sy - 596) / 288;
    if (dy * dy >= 1) continue;
    const half = 298 * Math.sqrt(1 - dy * dy);
    if (Math.abs(sx - 512) > half - 32) continue;
    cv.disc(sx + 3, sy + 4, 12, solid([90, 55, 15, 0.25]));
    const rad = (rot * Math.PI) / 180;
    const pts: Array<[number, number]> = [];
    for (let i = 0; i < 16; i++) {
      const t = (i / 16) * Math.PI * 2;
      const ex = Math.cos(t) * 13;
      const ey = Math.sin(t) * 8;
      pts.push([
        sx + ex * Math.cos(rad) - ey * Math.sin(rad),
        sy + ex * Math.sin(rad) + ey * Math.cos(rad),
      ]);
    }
    cv.poly(pts, solid(hex("#ffdf9e")));
    cv.disc(sx - 4, sy - 3, 4, solid([255, 255, 255, 0.5]));
  }

  // ---- caption: the one ingredient, named for the judge ----
  drawText(cv, "ONE INGREDIENT · BEEF", 512, 952, 5, [240, 220, 184, 0.92]);
}

// ---------- downsample 2048 -> 1024 with a gentle vignette ----------
function downsample(cv: Canvas): Uint8Array {
  const out = new Uint8Array(1024 * 1024 * 4);
  const d = cv.data;
  for (let y = 0; y < 1024; y++) {
    for (let x = 0; x < 1024; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let dy = 0; dy < SS; dy++) {
        for (let dx = 0; dx < SS; dx++) {
          const i = ((y * SS + dy) * W + (x * SS + dx)) * 4;
          r += d[i];
          g += d[i + 1];
          b += d[i + 2];
        }
      }
      // vignette: darken the corners a touch so the burger pops
      const nx = (x - 512) / 512;
      const ny = (y - 512) / 512;
      const dist = Math.sqrt(nx * nx + ny * ny);
      const v = dist <= 0.62 ? 1 : 1 - 0.2 * ((dist - 0.62) / 0.38);
      const o = (y * 1024 + x) * 4;
      out[o] = Math.max(0, Math.min(255, Math.round((r / 4) * v)));
      out[o + 1] = Math.max(0, Math.min(255, Math.round((g / 4) * v)));
      out[o + 2] = Math.max(0, Math.min(255, Math.round((b / 4) * v)));
      out[o + 3] = 255;
    }
  }
  return out;
}

function main(): void {
  const cv = new Canvas();
  drawScene(cv);
  const rgba = downsample(cv);
  const png = encodePNG(rgba, 1024, 1024);
  mkdirSync("/output", { recursive: true });
  writeFileSync("/output/entry.png", png);
  console.log(`wrote /output/entry.png ${png.length} bytes (limit 1048576)`);
  if (png.length > 1048576) {
    console.error("OVER 1 MiB: entry would fail the gate");
    process.exitCode = 1;
  }
}

main();
