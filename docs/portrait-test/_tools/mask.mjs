// Write the inpainting masks (white = regenerate, black = keep) for every layout,
// plus a preview of each mask tinted over its head.
//   node mask.mjs
import path from 'node:path';
import { read, write, blank } from './png.mjs';
import { ROOT, config } from './paths.mjs';

const cfg = config();
const TINT = { hair: [255, 60, 60], eyes: [60, 160, 255], mouth: [60, 220, 90] };

export const inMask = (rects, x, y) => rects.some(([rx, ry, rw, rh]) => x >= rx && x < rx + rw && y >= ry && y < ry + rh);

for (const [name, layout] of Object.entries(cfg.layouts)) {
  const head = read(path.join(ROOT, name, 'head.png'));
  const preview = { w: head.w, h: head.h, data: Buffer.from(head.data) };
  for (const [part, rects] of Object.entries(layout.masks)) {
    const mask = blank(head.w, head.h, [0, 0, 0, 255]);
    for (let y = 0; y < head.h; y++) for (let x = 0; x < head.w; x++) {
      if (!inMask(rects, x, y)) continue;
      const i = (y * head.w + x) * 4;
      mask.data.set([255, 255, 255, 255], i);
      for (let k = 0; k < 3; k++) preview.data[i + k] = Math.round(preview.data[i + k] * 0.55 + TINT[part][k] * 0.45);
      preview.data[i + 3] = Math.max(preview.data[i + 3], 110);
    }
    write(path.join(ROOT, name, `mask-${part}.png`), mask);
  }
  write(path.join(ROOT, name, 'mask-preview.png'), preview);
}
console.log('masks written');
