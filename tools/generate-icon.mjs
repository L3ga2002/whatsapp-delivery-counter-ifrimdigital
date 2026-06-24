import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const size = 256;
const outputPath = path.resolve('build/icon.ico');

function pixel(x, y) {
  const radius = 42;
  const inRoundedRect =
    (x >= radius && x < size - radius) ||
    (y >= radius && y < size - radius) ||
    distanceToCorner(x, y, radius, radius) <= radius ||
    distanceToCorner(x, y, size - radius - 1, radius) <= radius ||
    distanceToCorner(x, y, radius, size - radius - 1) <= radius ||
    distanceToCorner(x, y, size - radius - 1, size - radius - 1) <= radius;

  if (!inRoundedRect) {
    return [0, 0, 0, 0];
  }

  const stripe = Math.floor((x + y) / 22) % 2 === 0;
  const base = stripe ? [12, 123, 99] : [18, 52, 73];
  const mark = isInLetterI(x, y) || isInLetterD(x, y);
  return mark ? [255, 255, 255, 255] : [base[2], base[1], base[0], 255];
}

function distanceToCorner(x, y, cx, cy) {
  return Math.hypot(x - cx, y - cy);
}

function isInLetterI(x, y) {
  return (
    (x >= 64 && x <= 118 && y >= 68 && y <= 88) ||
    (x >= 80 && x <= 102 && y >= 68 && y <= 188) ||
    (x >= 64 && x <= 118 && y >= 168 && y <= 188)
  );
}

function isInLetterD(x, y) {
  const stem = x >= 138 && x <= 160 && y >= 68 && y <= 188;
  const top = x >= 138 && x <= 190 && y >= 68 && y <= 88;
  const bottom = x >= 138 && x <= 190 && y >= 168 && y <= 188;
  const curve = x >= 180 && x <= 202 && y >= 86 && y <= 170;
  return stem || top || bottom || curve;
}

function createBmpDib() {
  const headerSize = 40;
  const xorBytes = size * size * 4;
  const andStride = Math.ceil(size / 32) * 4;
  const andBytes = andStride * size;
  const dib = Buffer.alloc(headerSize + xorBytes + andBytes);

  dib.writeUInt32LE(headerSize, 0);
  dib.writeInt32LE(size, 4);
  dib.writeInt32LE(size * 2, 8);
  dib.writeUInt16LE(1, 12);
  dib.writeUInt16LE(32, 14);
  dib.writeUInt32LE(0, 16);
  dib.writeUInt32LE(xorBytes + andBytes, 20);

  let offset = headerSize;
  for (let y = size - 1; y >= 0; y -= 1) {
    for (let x = 0; x < size; x += 1) {
      const [b, g, r, a] = pixel(x, y);
      dib[offset++] = b;
      dib[offset++] = g;
      dib[offset++] = r;
      dib[offset++] = a;
    }
  }

  return dib;
}

async function main() {
  const dib = createBmpDib();
  const ico = Buffer.alloc(6 + 16 + dib.length);
  ico.writeUInt16LE(0, 0);
  ico.writeUInt16LE(1, 2);
  ico.writeUInt16LE(1, 4);
  ico[6] = 0;
  ico[7] = 0;
  ico[8] = 0;
  ico[9] = 0;
  ico.writeUInt16LE(1, 10);
  ico.writeUInt16LE(32, 12);
  ico.writeUInt32LE(dib.length, 14);
  ico.writeUInt32LE(22, 18);
  dib.copy(ico, 22);

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, ico);
  console.log(`Generated ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
