// Run a batch of Pixel Lab calls described in a JSON job file.
//   node gen.mjs jobs/<name>.json
// Job file: [{ "out": "front/base.png", "route": "/create-image-pixflux", "body": {...} }, ...]
// Any string value in a body that starts with "@" is replaced by that PNG (relative to out/).
// Jobs whose output already exists are skipped, so re-running never pays twice.
import fs from 'node:fs';
import path from 'node:path';
import { api, b64, bytes, spend, track } from './pixellab.mjs';
import { ROOT } from './paths.mjs';

const jobs = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const force = process.argv.includes('--force');

const inflate = (v) => {
  if (typeof v === 'string' && v.startsWith('@')) return b64(fs.readFileSync(path.join(ROOT, v.slice(1))));
  if (Array.isArray(v)) return v.map(inflate);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, inflate(x)]));
  return v;
};

async function poll(id) {
  for (;;) {
    await new Promise((r) => setTimeout(r, 6000));
    const j = await api('GET', `/background-jobs/${id}`);
    if (j.status === 'completed') return j;
    if (j.status === 'failed') throw new Error(`job ${id} failed: ${JSON.stringify(j.last_response).slice(0, 300)}`);
  }
}

async function run(job) {
  const file = path.join(ROOT, job.out);
  if (fs.existsSync(file) && !force) return console.log(`skip  ${job.out}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let res = await api('POST', job.route, inflate(job.body));
  let usage = res.usage;
  if (res.background_job_id) {
    const done = await poll(res.background_job_id);
    usage = done.usage ?? usage;
    res = done.last_response;
  }
  track(usage);
  const images = res.images ?? (res.image ? [res.image] : []);
  if (!images.length) throw new Error(`no image in response for ${job.out}: ${JSON.stringify(res).slice(0, 300)}`);
  images.forEach((img, i) => fs.writeFileSync(i ? file.replace(/\.png$/, `-${i}.png`) : file, bytes(img)));
  console.log(`done  ${job.out}  usage=${JSON.stringify(usage)}`);
}

// Small pool: sync endpoints answer in seconds, and the API rejects bursts.
const queue = [...jobs];
let failed = 0;
await Promise.all(Array.from({ length: 3 }, async () => {
  for (let job; (job = queue.shift()); ) {
    try { await run(job); } catch (e) { failed++; console.error(`FAIL  ${job.out}: ${e.message}`); }
  }
}));
const generations = spend.other.reduce((sum, u) => sum + (u.generations ?? 0), 0);
console.log(`calls=${spend.calls} generations=${generations} usd=${spend.usd.toFixed(3)} failed=${failed}`);
process.exit(failed ? 1 : 0);
