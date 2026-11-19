// Turn a generated base into the working head for a layout: shift it down so
// there is headroom for hair (rows pushed past the bottom are dropped).
//   node prep.mjs <in.png> <out.png> <shiftDown>
import path from 'node:path';
import { read, write, blank } from './png.mjs';
import { ROOT } from './paths.mjs';

const [src, dst, dy = '0'] = process.argv.slice(2);
const img = read(path.join(ROOT, src));
const out = blank(img.w, img.h);
const shift = Number(dy);
for (let y = 0; y + shift < img.h; y++) {
  img.data.copy(out.data, (y + shift) * img.w * 4, y * img.w * 4, (y + 1) * img.w * 4);
}
// Snap near-transparent/near-opaque alpha so layers composite cleanly.
let x0 = out.w, y0 = out.h, x1 = -1, y1 = -1, soft = 0;
for (let i = 0; i < out.w * out.h; i++) {
  const a = out.data[i * 4 + 3];
  if (a > 0 && a < 255) soft++;
  if (a > 0) {
    const x = i % out.w, y = Math.floor(i / out.w);
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
}
write(path.join(ROOT, dst), out);
console.log(`${dst}: ${out.w}x${out.h} bbox x${x0}-${x1} y${y0}-${y1} semi-transparent px=${soft}`);
