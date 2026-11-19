// Write a job file for extra heads (other genders and ages) of a run.
// Each new head is generated FROM the layout's existing head, so the eyes and
// mouth land in the same place and the same masks keep working.
//   node mkheads.mjs [layout ...]      (default: every layout)
import fs from 'node:fs';
import path from 'node:path';
import { HERE, RUN, config } from './paths.mjs';

const cfg = config();
// Generating from text with the head as a starting image did not work: at the
// default strength the result was the same face again, and at a low strength
// the framing drifted. An edit instruction changes the face and keeps the frame.
export const WHO = {
  woman: 'an adult woman with a clearly feminine face, long eyelashes, fuller lips and a soft narrow jaw',
  child: 'a small child about seven years old with round chubby cheeks and very large eyes',
  oldman: 'an elderly old man with deep wrinkles, sunken cheeks and thick grey eyebrows',
  oldwoman: 'an elderly old woman with wrinkles, sagging cheeks, thin lips and a gentle face',
};
const only = process.argv.slice(2);
const jobs = [];
for (const layout of Object.keys(cfg.layouts)) {
  if (only.length && !only.includes(layout)) continue;
  for (const [who, text] of Object.entries(WHO)) {
    jobs.push({
      out: `${layout}/head-${who}.png`,
      route: '/edit-image-pixen',
      body: {
        description: `turn this character into ${text}; keep the character bald; keep the pose, head position, framing, clothes and art style exactly the same`,
        image: `@${layout}/head.png`,
        no_background: true,
        seed: 7,
      },
    });
  }
}
const file = path.join(HERE, 'jobs', `05-heads${RUN ? `-${RUN}` : ''}.json`);
fs.writeFileSync(file, JSON.stringify(jobs, null, 2));
console.log(`${jobs.length} jobs -> ${file}`);
