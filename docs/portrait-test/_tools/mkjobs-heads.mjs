// Write the job file for parts drawn on the extra heads (config.heads):
// one masked inpaint per layout x head x part x style.
import fs from 'node:fs';
import path from 'node:path';
import { HERE, RUN, config } from './paths.mjs';

const cfg = config();
const jobs = [];
for (const layout of Object.keys(cfg.layouts)) {
  for (const [who, head] of Object.entries(cfg.heads)) {
    for (const part of ['hair', 'eyes', 'mouth']) {
      for (const [id, description] of Object.entries(head[part])) {
        jobs.push({
          out: `${layout}/${who}/raw/${part}-${id}.png`,
          route: '/inpaint',
          body: {
            description,
            image_size: { width: cfg.size, height: cfg.size },
            inpainting_image: `@${layout}/head-${who}.png`,
            mask_image: `@${layout}/mask-${part}.png`,
            no_background: true,
            seed: 21,
          },
        });
      }
    }
  }
}
const file = path.join(HERE, 'jobs', `07-head-parts${RUN ? `-${RUN}` : ''}.json`);
fs.writeFileSync(file, JSON.stringify(jobs, null, 2));
console.log(`${jobs.length} jobs -> ${file}`);
