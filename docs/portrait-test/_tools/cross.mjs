// Put one layout's existing layers on a DIFFERENT head, to see whether parts
// can be reused across heads or are tied to the head they were drawn on.
//   node cross.mjs <layout> <sheet.png> <headA.png> [<headB.png> ...]
import path from 'node:path';
import { read, write, blank, over, scale } from './png.mjs';
import { ROOT } from './paths.mjs';

const [layout, out, ...heads] = process.argv.slice(2);
const layer = (name) => read(path.join(ROOT, layout, 'layers', `${name}.png`));
const picks = [['a', 'a', 'a'], ['b', 'b', 'b'], ['c', 'c', 'c'], ['a', 'b', 'c'], ['c', 'a', 'b']];

const first = read(path.join(ROOT, heads[0]));
const n = Math.max(1, Math.round(256 / first.w)), pad = 6, cols = picks.length + 1;
const sheet = blank(pad + cols * (first.w * n + pad), pad + heads.length * (first.h * n + pad), [58, 62, 74, 255]);
heads.forEach((file, row) => {
  const head = read(path.join(ROOT, file));
  const tiles = [head, ...picks.map(([h, e, m]) => {
    const face = { w: head.w, h: head.h, data: Buffer.from(head.data) };
    over(face, layer(`mouth-${m}`)); over(face, layer(`eyes-${e}`)); over(face, layer(`hair-${h}`));
    return face;
  })];
  tiles.forEach((t, i) => {
    const bg = blank(t.w * n, t.h * n, [168, 172, 182, 255]);
    over(bg, scale(t, n));
    over(sheet, bg, pad + i * (t.w * n + pad), pad + row * (t.h * n + pad));
  });
});
write(path.join(ROOT, out), sheet);
console.log(`${out}: ${heads.length} heads x ${picks.length} combos`);
