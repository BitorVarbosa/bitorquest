// Where a test run keeps its files. PT_RUN=<name> selects a separate run:
// images in out-<name>/, settings in layouts-<name>.json. Unset = the first run.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const RUN = process.env.PT_RUN ?? '';
const tag = RUN ? `-${RUN}` : '';
export const ROOT = path.resolve(HERE, '..', `out${tag}`);
export const PARTS_JOBS = path.join(HERE, 'jobs', `03-parts${tag}.json`);
export const config = () => JSON.parse(fs.readFileSync(path.join(HERE, `layouts${tag}.json`), 'utf8'));
