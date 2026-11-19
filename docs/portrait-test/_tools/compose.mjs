// Cut each inpainted result down to a transparent layer, then rebuild every
// hair x eyes x mouth combination from layers alone (no AI involved).
//   node compose.mjs
import fs from 'node:fs';
import path from 'node:path';
import { read, write, blank, over, scale, encode } from './png.mjs';
import { ROOT, config } from './paths.mjs';

const cfg = config();
const inMask = (rects, x, y) => rects.some(([rx, ry, rw, rh]) => x >= rx && x < rx + rw && y >= ry && y < ry + rh);
const ORDER = ['mouth', 'eyes', 'hair']; // bottom to top, over the head
const report = {};

for (const [name, layout] of Object.entries(cfg.layouts)) {
  const head = read(path.join(ROOT, name, 'head.png'));
  const layers = {};
  const stats = (report[name] = { layers: {}, leaksOutsideMask: 0, erasedHeadPixels: 0 });
  fs.mkdirSync(path.join(ROOT, name, 'layers'), { recursive: true });
  fs.mkdirSync(path.join(ROOT, name, 'combos'), { recursive: true });

  for (const part of ORDER) {
    layers[part] = {};
    for (const id of Object.keys(cfg.sets[part])) {
      const raw = read(path.join(ROOT, name, 'raw', `${part}-${id}.png`));
      const layer = blank(head.w, head.h);
      let kept = 0, soft = 0;
      for (let y = 0; y < head.h; y++) for (let x = 0; x < head.w; x++) {
        const i = (y * head.w + x) * 4;
        const same = [0, 1, 2, 3].every((k) => raw.data[i + k] === head.data[i + k]) ||
          (raw.data[i + 3] === 0 && head.data[i + 3] === 0);
        if (same) continue;
        if (!inMask(layout.masks[part], x, y)) { stats.leaksOutsideMask++; continue; }
        // A layer can only add pixels; it cannot erase the head underneath.
        if (raw.data[i + 3] === 0) { stats.erasedHeadPixels++; continue; }
        if (raw.data[i + 3] < 255) soft++;
        raw.data.copy(layer.data, i, i, i + 4);
        kept++;
      }
      const file = path.join(ROOT, name, 'layers', `${part}-${id}.png`);
      write(file, layer);
      layers[part][id] = layer;
      stats.layers[`${part}-${id}`] = { pixels: kept, semiTransparent: soft, bytes: fs.statSync(file).size };
    }
  }

  // Every combination, plus one sheet per layout.
  const ids = (p) => Object.keys(layers[p]);
  const tiles = [];
  for (const h of ids('hair')) for (const e of ids('eyes')) for (const m of ids('mouth')) {
    const face = { w: head.w, h: head.h, data: Buffer.from(head.data) };
    over(face, layers.mouth[m]); over(face, layers.eyes[e]); over(face, layers.hair[h]);
    write(path.join(ROOT, name, 'combos', `hair-${h}_eyes-${e}_mouth-${m}.png`), face);
    tiles.push(face);
  }
  const n = Math.max(1, Math.round(256 / head.w)), pad = 6, cols = 9;
  const rows = Math.ceil(tiles.length / cols);
  const sheet = blank(pad + cols * (head.w * n + pad), pad + rows * (head.h * n + pad), [58, 62, 74, 255]);
  tiles.forEach((t, i) => {
    const bg = blank(t.w * n, t.h * n, [168, 172, 182, 255]);
    over(bg, scale(t, n));
    over(sheet, bg, pad + (i % cols) * (head.w * n + pad), pad + Math.floor(i / cols) * (head.h * n + pad));
  });
  write(path.join(ROOT, `${name}-combos.png`), sheet);
  stats.combos = tiles.length;
  stats.headBytes = encode(head).length;
}
fs.writeFileSync(path.join(ROOT, 'report.json'), JSON.stringify(report, null, 2));
for (const [name, s] of Object.entries(report)) {
  const bytes = Object.values(s.layers).map((l) => l.bytes);
  console.log(`${name}: ${s.combos} combos, layer bytes ${Math.min(...bytes)}-${Math.max(...bytes)}, head ${s.headBytes}, leaks=${s.leaksOutsideMask}, erased=${s.erasedHeadPixels}`);
}
