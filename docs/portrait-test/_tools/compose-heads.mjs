// Like compose.mjs, for the extra heads (config.heads): cut each head's own
// parts into layers and build every combination. One sheet per layout, one row
// per head: the bare head first, then its combinations.
//   node compose-heads.mjs
import fs from 'node:fs';
import path from 'node:path';
import { read, write, blank, over, scale } from './png.mjs';
import { ROOT, config } from './paths.mjs';

const cfg = config();
const inMask = (rects, x, y) => rects.some(([rx, ry, rw, rh]) => x >= rx && x < rx + rw && y >= ry && y < ry + rh);
const report = {};

for (const [name, layout] of Object.entries(cfg.layouts)) {
  const rows = [];
  for (const [who, spec] of Object.entries(cfg.heads)) {
    const head = read(path.join(ROOT, name, `head-${who}.png`));
    const dir = path.join(ROOT, name, who);
    fs.mkdirSync(path.join(dir, 'layers'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'combos'), { recursive: true });
    const stats = (report[`${name}/${who}`] = { leaksOutsideMask: 0, erasedHeadPixels: 0, bytes: [] });
    const layers = {};
    for (const part of ['mouth', 'eyes', 'hair']) {
      layers[part] = {};
      for (const id of Object.keys(spec[part])) {
        const raw = read(path.join(dir, 'raw', `${part}-${id}.png`));
        const layer = blank(head.w, head.h);
        for (let y = 0; y < head.h; y++) for (let x = 0; x < head.w; x++) {
          const i = (y * head.w + x) * 4;
          const same = [0, 1, 2, 3].every((k) => raw.data[i + k] === head.data[i + k]) ||
            (raw.data[i + 3] === 0 && head.data[i + 3] === 0);
          if (same) continue;
          if (!inMask(layout.masks[part], x, y)) { stats.leaksOutsideMask++; continue; }
          if (raw.data[i + 3] === 0) { stats.erasedHeadPixels++; continue; }
          raw.data.copy(layer.data, i, i, i + 4);
        }
        const file = path.join(dir, 'layers', `${part}-${id}.png`);
        write(file, layer);
        stats.bytes.push(fs.statSync(file).size);
        layers[part][id] = layer;
      }
    }
    const tiles = [head];
    for (const h of Object.keys(layers.hair)) for (const e of Object.keys(layers.eyes)) for (const m of Object.keys(layers.mouth)) {
      const face = { w: head.w, h: head.h, data: Buffer.from(head.data) };
      over(face, layers.mouth[m]); over(face, layers.eyes[e]); over(face, layers.hair[h]);
      write(path.join(dir, 'combos', `hair-${h}_eyes-${e}_mouth-${m}.png`), face);
      tiles.push(face);
    }
    rows.push(tiles);
  }
  const size = rows[0][0].w, n = Math.max(1, Math.round(256 / size)), pad = 6;
  const cols = Math.max(...rows.map((r) => r.length));
  const sheet = blank(pad + cols * (size * n + pad), pad + rows.length * (size * n + pad), [58, 62, 74, 255]);
  rows.forEach((tiles, r) => tiles.forEach((t, i) => {
    const bg = blank(size * n, size * n, [168, 172, 182, 255]);
    over(bg, scale(t, n));
    over(sheet, bg, pad + i * (size * n + pad), pad + r * (size * n + pad));
  }));
  write(path.join(ROOT, `${name}-heads-combos.png`), sheet);
}
fs.writeFileSync(path.join(ROOT, 'report-heads.json'), JSON.stringify(report, null, 2));
for (const [k, s] of Object.entries(report)) {
  console.log(`${k}: layer bytes ${Math.min(...s.bytes)}-${Math.max(...s.bytes)}, leaks=${s.leaksOutsideMask}, erased=${s.erasedHeadPixels}`);
}
