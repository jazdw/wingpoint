/**
 * Generates the PWA PNG icons from code — no external image libraries needed.
 * Run with: npm run icons
 *
 * The artwork is a teal gradient rounded square with a white "W", matching
 * public/favicon.svg.
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname, '../public/icons');

/* ---------------------------------------------------------------- PNG ---- */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ------------------------------------------------------------- drawing --- */

const BG_START = [47, 107, 69];
const BG_END = [217, 164, 65];
const FG = [255, 255, 255];

// Normalised "W" polyline with round caps.
const STROKE = [
  [0.2, 0.22],
  [0.38, 0.78],
  [0.5, 0.42],
  [0.62, 0.78],
  [0.8, 0.22],
];
const HALF_WIDTH = 0.052;

function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  let t = lengthSquared === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lengthSquared;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

function inRoundedRect(x, y, radius) {
  if (x < 0 || y < 0) return false;
  const clampedX = Math.min(Math.max(x, radius), 1 - radius);
  const clampedY = Math.min(Math.max(y, radius), 1 - radius);
  return Math.hypot(x - clampedX, y - clampedY) <= radius;
}

function render(size, { padding, rounded }) {
  const scale = 4;
  const big = size * scale;
  const radius = rounded ? 0.22 : 0.5;
  // W is scaled into the safe area controlled by `padding`.
  const wScale = 1 - padding * 2;
  const acc = new Float64Array(size * size * 4);

  for (let by = 0; by < big; by += 1) {
    for (let bx = 0; bx < big; bx += 1) {
      const x = (bx + 0.5) / big;
      const y = (by + 0.5) / big;
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;

      if (rounded ? inRoundedRect(x, y, radius) : true) {
        const t = Math.min(1, Math.max(0, (x + y) / 2));
        r = BG_START[0] + (BG_END[0] - BG_START[0]) * t;
        g = BG_START[1] + (BG_END[1] - BG_START[1]) * t;
        b = BG_START[2] + (BG_END[2] - BG_START[2]) * t;
        a = 255;

        const wx = (x - padding) / wScale;
        const wy = (y - padding) / wScale;
        let filled = false;
        for (let i = 0; i < STROKE.length - 1; i += 1) {
          const [ax, ay] = STROKE[i];
          const [bx2, by2] = STROKE[i + 1];
          if (distanceToSegment(wx, wy, ax, ay, bx2, by2) <= HALF_WIDTH) {
            filled = true;
            break;
          }
        }
        if (filled) {
          r = FG[0];
          g = FG[1];
          b = FG[2];
        }
      }

      const px = Math.floor(bx / scale);
      const py = Math.floor(by / scale);
      const index = (py * size + px) * 4;
      acc[index] += r;
      acc[index + 1] += g;
      acc[index + 2] += b;
      acc[index + 3] += a;
    }
  }

  const samples = scale * scale;
  const rgba = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i += 1) {
    rgba[i * 4] = Math.round(acc[i * 4] / samples);
    rgba[i * 4 + 1] = Math.round(acc[i * 4 + 1] / samples);
    rgba[i * 4 + 2] = Math.round(acc[i * 4 + 2] / samples);
    rgba[i * 4 + 3] = Math.round(acc[i * 4 + 3] / samples);
  }
  return encodePng(size, size, rgba);
}

/* --------------------------------------------------------------- output -- */

mkdirSync(outDir, { recursive: true });

const targets = [
  { file: 'icon-192.png', size: 192, padding: 0.16, rounded: true },
  { file: 'icon-512.png', size: 512, padding: 0.16, rounded: true },
  { file: 'icon-maskable-512.png', size: 512, padding: 0.26, rounded: false },
  { file: 'apple-touch-icon.png', size: 180, padding: 0.16, rounded: false },
];

for (const target of targets) {
  const png = render(target.size, { padding: target.padding, rounded: target.rounded });
  writeFileSync(resolve(outDir, target.file), png);
  console.log(`wrote public/icons/${target.file} (${target.size}px)`);
}
