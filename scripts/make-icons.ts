/**
 * Writes the placeholder app icons (three ascending bars on the accent colour) as PNGs using only
 * Node built-ins. Run with `npx tsx scripts/make-icons.ts`; the final artwork replaces these.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const BACKGROUND = [0x2f, 0x6f, 0xed];
const FOREGROUND = [0xff, 0xff, 0xff];
/** Bars as [x, height] in a 0–1 box, bottom aligned. */
const BARS: [number, number][] = [
  [0.22, 0.3],
  [0.42, 0.5],
  [0.62, 0.72],
];
const BAR_WIDTH = 0.16;

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** `scale` shrinks the glyph toward the centre (maskable icons keep it inside the safe zone). */
function png(size: number, scale: number): Buffer {
  const rows: Buffer[] = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 3);
    for (let x = 0; x < size; x++) {
      const u = (x / size - 0.5) / scale + 0.5;
      const v = (y / size - 0.5) / scale + 0.5;
      const onBar = BARS.some(([left, height]) => u >= left && u < left + BAR_WIDTH && v <= 0.8 && v > 0.8 - height);
      const colour = onBar ? FOREGROUND : BACKGROUND;
      row.set(colour, 1 + x * 3);
    }
    rows.push(row);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync('public/icons', { recursive: true });
writeFileSync('public/icons/icon-192.png', png(192, 1));
writeFileSync('public/icons/icon-512.png', png(512, 1));
writeFileSync('public/icons/icon-maskable-512.png', png(512, 0.7));
writeFileSync('public/icons/apple-touch-icon.png', png(180, 1));
console.log('icons written to public/icons');
