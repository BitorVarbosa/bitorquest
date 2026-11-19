// Write the parts job file: one masked inpaint per layout x part x style.
import fs from 'node:fs';
import { PARTS_JOBS, config } from './paths.mjs';

const cfg = config();
const jobs = [];
for (const layout of Object.keys(cfg.layouts)) {
  for (const [part, styles] of Object.entries(cfg.sets)) {
    for (const [id, description] of Object.entries(styles)) {
      jobs.push({
        out: `${layout}/raw/${part}-${id}.png`,
        route: '/inpaint',
        body: {
          description,
          image_size: { width: cfg.size, height: cfg.size },
          inpainting_image: `@${layout}/head.png`,
          mask_image: `@${layout}/mask-${part}.png`,
          no_background: true,
          seed: 21,
        },
      });
    }
  }
}
fs.writeFileSync(PARTS_JOBS, JSON.stringify(jobs, null, 2));
console.log(`${jobs.length} jobs -> ${PARTS_JOBS}`);
