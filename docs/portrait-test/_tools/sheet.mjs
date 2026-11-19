// Build a contact sheet from PNGs under out/.
//   node sheet.mjs <sheet.png> [--scale=3] [--cols=3] [--grid=16] <a.png> <b.png> ...
// --grid=N draws a line every N source pixels (for picking mask coordinates).
import path from 'node:path';
import { read, write, blank, over, scale } from './png.mjs';
import { ROOT } from './paths.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => Number((args.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split('=')[1]);
const files = args.filter((a) => !a.startsWith('--'));
const out = files.shift();
const n = opt('scale', 3), cols = opt('cols', 3), grid = opt('grid', 0), pad = 8;

const tiles = files.map((f) => scale(read(path.join(ROOT, f)), n));
const tw = Math.max(...tiles.map((t) => t.w)), th = Math.max(...tiles.map((t) => t.h));
const rows = Math.ceil(tiles.length / cols);
const sheet = blank(pad + cols * (tw + pad), pad + rows * (th + pad), [58, 62, 74, 255]);

tiles.forEach((t, i) => {
  const ox = pad + (i % cols) * (tw + pad), oy = pad + Math.floor(i / cols) * (th + pad);
  // Checkerboard behind each tile so transparency is visible.
  const bg = blank(t.w, t.h);
  for (let y = 0; y < t.h; y++) for (let x = 0; x < t.w; x++) {
    const v = (Math.floor(x / (4 * n)) + Math.floor(y / (4 * n))) % 2 ? 150 : 175;
    bg.data.set([v, v, v, 255], (y * t.w + x) * 4);
  }
  over(bg, t);
  if (grid) {
    for (let y = 0; y < t.h; y++) for (let x = 0; x < t.w; x++) {
      if (x % (grid * n) === 0 || y % (grid * n) === 0) bg.data.set([255, 0, 255, 255], (y * t.w + x) * 4);
    }
  }
  over(sheet, bg, ox, oy);
});
write(path.join(ROOT, out), sheet);
console.log(`${out}: ${sheet.w}x${sheet.h}, ${tiles.length} tiles`);
