// Generates PWA icons (no dependencies, uses node:zlib). Run: node scripts/make-icons.mjs
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { deflateSync, inflateSync } from 'node:zlib';

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.from(type);
  const cb = Buffer.alloc(4); cb.writeUInt32BE(crc(Buffer.concat([td, data])));
  return Buffer.concat([len, td, data, cb]);
}
function toPNG(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

function drawIcon(S, maskable) {
  const buf = Buffer.alloc(S * S * 4);
  const rng = mulberry32(7);
  const set = (x, y, r, g, b, a = 1) => {
    x |= 0; y |= 0;
    if (x < 0 || y < 0 || x >= S || y >= S) return;
    const i = (y * S + x) * 4;
    const sa = Math.max(0, Math.min(1, a));
    buf[i] = buf[i] + (r - buf[i]) * sa;
    buf[i + 1] = buf[i + 1] + (g - buf[i + 1]) * sa;
    buf[i + 2] = buf[i + 2] + (b - buf[i + 2]) * sa;
    buf[i + 3] = 255;
  };
  const circle = (cx, cy, r, c, a = 1) => {
    for (let y = Math.floor(cy - r); y <= cy + r; y++)
      for (let x = Math.floor(cx - r); x <= cx + r; x++)
        if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) set(x, y, c[0], c[1], c[2], a);
  };
  const rect = (x0, y0, x1, y1, c, a = 1) => {
    for (let y = Math.floor(y0); y < y1; y++)
      for (let x = Math.floor(x0); x < x1; x++) set(x, y, c[0], c[1], c[2], a);
  };
  const k = maskable ? 0.8 : 1; // keep content inside the safe zone
  const ox = S * (1 - k) / 2, oy = S * (1 - k) / 2;
  const X = (v) => ox + v * k, Y = (v) => oy + v * k;
  // bg
  rect(0, 0, S, S, [6, 10, 13]);
  // sky gradient
  const wl = Y(S * 0.62);
  for (let y = 0; y < S; y++) {
    const f = Math.max(0, Math.min(1, y / wl));
    const c = [5 + f * 17, 8 + f * 40, 14 + f * 40];
    for (let x = 0; x < S; x++) set(x, y, c[0], c[1], c[2]);
  }
  // stars
  for (let i = 0; i < 130; i++) {
    const x = rng() * S, y = rng() * wl * 0.9, b = 120 + rng() * 135;
    set(x, y, b, b, b + 20, 0.35 + rng() * 0.6);
  }
  // moon + glow
  const mx = X(S * 0.68), my = Y(S * 0.28), mr = S * 0.105;
  for (let r = mr * 3; r > 0; r -= 1) {
    const a = Math.max(0, 0.35 * (1 - r / (mr * 3))) ** 1.5;
    circle(mx, my, r, [220, 225, 200], Math.min(0.5, a));
  }
  circle(mx, my, mr, [253, 243, 218]);
  // tree silhouettes
  for (const side of [0, 1]) {
    for (let i = 0; i < 7; i++) {
      const bx = side ? S - rng() * S * 0.24 : rng() * S * 0.24;
      const tw = 6 + rng() * 16, th = S * (0.25 + rng() * 0.3);
      rect(bx - tw / 2, wl - th, bx + tw / 2, wl + 4, [8, 12, 10]);
      circle(bx, wl - th, tw * (1.2 + rng()), [10, 15, 11]);
    }
  }
  // water
  for (let y = Math.floor(wl); y < S; y++) {
    const f = (y - wl) / (S - wl);
    for (let x = 0; x < S; x++) set(x, y, 4 + f * 4, 14 - f * 6, 18 - f * 8);
  }
  // moon streak
  for (let y = Math.floor(wl); y < S; y++) {
    const wob = Math.sin(y * 0.15) * S * 0.008;
    const hw = S * 0.028 * (1 + (y - wl) / S);
    for (let x = Math.floor(mx - hw + wob); x < mx + hw + wob; x++)
      set(x, y, 205, 225, 215, 0.30);
  }
  // fireflies
  for (let i = 0; i < 26; i++) {
    const x = rng() * S, y = wl * (0.45 + rng() * 0.5);
    circle(x, y, 1.6, [255, 200, 120], 0.9);
  }
  // vignette
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = x / S - 0.5, dy = y / S - 0.5;
    const v = 1 - Math.min(0.45, (dx * dx + dy * dy) * 1.1);
    const i = (y * S + x) * 4;
    buf[i] *= v; buf[i + 1] *= v; buf[i + 2] *= v;
  }
  return buf;
}

mkdirSync(new URL('../public/icons/', import.meta.url), { recursive: true });
const jobs = [
  ['public/icons/icon-192.png', 192, false],
  ['public/icons/icon-512.png', 512, false],
  ['public/icons/maskable-512.png', 512, true],
  ['public/icons/apple-touch-icon.png', 180, false],
];
for (const [rel, size, mask] of jobs) {
  const url = new URL('../' + rel, import.meta.url);
  writeFileSync(url, toPNG(size, size, drawIcon(size, mask)));
  // self-check: parse IHDR + inflate IDAT
  const raw = readFileSync(url);
  const w = raw.readUInt32BE(16), h = raw.readUInt32BE(20);
  if (w !== size || h !== size) throw new Error('bad dims ' + rel);
  console.log('ok', rel, w + 'x' + h, raw.length + ' bytes');
}
