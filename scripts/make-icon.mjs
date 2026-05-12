// Generate src/assets/icon.{png,ico} from src/assets/icon.svg using sharp.
// Run: node scripts/make-icon.mjs
// Requires: npm install --save-dev sharp  (one-time)
import sharp from 'sharp';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const __dir = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dir, '..');
const svgPath = resolve(root, 'src', 'assets', 'icon.svg');
const outPng  = resolve(root, 'src', 'assets', 'icon.png');
const outIco  = resolve(root, 'src', 'assets', 'icon.ico');

mkdirSync(resolve(root, 'src', 'assets'), { recursive: true });

const svgBuf = readFileSync(svgPath);
const sizes = [16, 32, 48, 256];

console.log('Rendering PNG sizes from SVG...');
const pngBuffers = await Promise.all(sizes.map(async (size) => {
  // Render SVG at the correct DPI so we get a sharp vector render at each size.
  // The SVG has width/height="64" so density = 72 * (size/64).
  const density = Math.round(72 * size / 64);
  const buf = await sharp(svgBuf, { density })
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  console.log(`  ${size}x${size}  (${(buf.length / 1024).toFixed(1)} KB)`);
  return buf;
}));

// Save the 256px PNG as icon.png for reference
writeFileSync(outPng, pngBuffers[sizes.indexOf(256)]);
console.log(`PNG  -> ${outPng}`);

// Pack a multi-resolution ICO (PNG-embedded entries, Vista+ compatible).
// ICO binary layout:
//   6 bytes  header: reserved(2)=0, type(2)=1, count(2)=N
//   N x 16 bytes directory entries
//   PNG data for each entry (concatenated)
function packIco(entries) {
  const N = entries.length;
  const ENTRY = 16;
  const headerSize = 6 + N * ENTRY;

  let dataOffset = headerSize;
  const dirs = entries.map(({ size, png }) => {
    const dir = Buffer.alloc(ENTRY);
    dir.writeUInt8(size === 256 ? 0 : size, 0);  // width  (0 = 256)
    dir.writeUInt8(size === 256 ? 0 : size, 1);  // height (0 = 256)
    dir.writeUInt8(0, 2);                         // color count (0 = no palette)
    dir.writeUInt8(0, 3);                         // reserved
    dir.writeUInt16LE(1, 4);                      // planes
    dir.writeUInt16LE(32, 6);                     // bits per pixel
    dir.writeUInt32LE(png.length, 8);             // size of image data
    dir.writeUInt32LE(dataOffset, 12);            // offset to image data
    dataOffset += png.length;
    return dir;
  });

  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);  // reserved
  header.writeUInt16LE(1, 2);  // type: 1 = icon
  header.writeUInt16LE(N, 4);  // image count

  return Buffer.concat([header, ...dirs, ...entries.map(e => e.png)]);
}

const ico = packIco(sizes.map((size, i) => ({ size, png: pngBuffers[i] })));
writeFileSync(outIco, ico);
console.log(`ICO  -> ${outIco}  (${(ico.length / 1024).toFixed(1)} KB, ${sizes.length} sizes: ${sizes.join('/')}px)`);