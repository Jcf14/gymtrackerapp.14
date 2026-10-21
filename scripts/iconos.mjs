// Genera app/icons/icon-{180,192,512}.png sin dependencias (encoder PNG propio).
// Diseño: fondo azul (#1F3C56 → #2E6DA4) con una mancuerna; cabe en la zona segura "maskable".
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "app", "icons");
const SS = 4; // supersampling por eje

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePNG(size, rgb) {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) rgb.copy(raw, y * (size * 3 + 1) + 1, y * size * 3, (y + 1) * size * 3);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8 bits, RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0)),
  ]);
}

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const BG_A = hex("#1F3C56"), BG_B = hex("#2E6DA4"), WHITE = hex("#FFFFFF"), SKY = hex("#9CCDEB");

// Rectángulos redondeados en coordenadas 0–1: [x0, y0, x1, y1, radio, color]
const SHAPES = [
  [0.30, 0.475, 0.70, 0.525, 0.012, SKY],     // barra
  [0.30, 0.34, 0.37, 0.66, 0.025, WHITE],     // disco interno izq.
  [0.63, 0.34, 0.70, 0.66, 0.025, WHITE],     // disco interno der.
  [0.235, 0.40, 0.29, 0.60, 0.02, WHITE],     // disco externo izq.
  [0.71, 0.40, 0.765, 0.60, 0.02, WHITE],     // disco externo der.
];
function inRoundRect(px, py, [x0, y0, x1, y1, r]) {
  if (px < x0 || px > x1 || py < y0 || py > y1) return false;
  const dx = Math.max(x0 + r - px, 0, px - (x1 - r));
  const dy = Math.max(y0 + r - py, 0, py - (y1 - r));
  return dx * dx + dy * dy <= r * r;
}
function colorAt(x, y) {
  for (let i = SHAPES.length - 1; i >= 0; i--) if (inRoundRect(x, y, SHAPES[i])) return SHAPES[i][5];
  const t = (x + y) / 2;
  return BG_A.map((a, i) => a + (BG_B[i] - a) * t);
}

function render(size) {
  const px = Buffer.alloc(size * size * 3);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const acc = [0, 0, 0];
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
      const c = colorAt((x + (sx + 0.5) / SS) / size, (y + (sy + 0.5) / SS) / size);
      acc[0] += c[0]; acc[1] += c[1]; acc[2] += c[2];
    }
    const o = (y * size + x) * 3;
    for (let i = 0; i < 3; i++) px[o + i] = Math.round(acc[i] / (SS * SS));
  }
  return encodePNG(size, px);
}

mkdirSync(OUT, { recursive: true });
for (const s of [180, 192, 512]) {
  writeFileSync(path.join(OUT, `icon-${s}.png`), render(s));
  console.log(`✓ icons/icon-${s}.png`);
}
