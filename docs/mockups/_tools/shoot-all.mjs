#!/usr/bin/env node
// Re-render the official screenshots and contact sheets for a mockup folder.
//
// Usage:  node docs/mockups/_tools/shoot-all.mjs [folder]      (default: docs/mockups/play-screen)
//
// Reads the direction slugs from <folder>/directions.js, renders every <slug>.html into
// <folder>/shots, then builds contact sheets from <folder>/contact.html.

import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const folder = path.resolve(process.argv[2] || path.join(here, '..', 'play-screen'));
const shots = path.join(folder, 'shots');
const tool = path.join(here, 'shoot.mjs');

const source = readFileSync(path.join(folder, 'directions.js'), 'utf8');
const slugs = [...source.matchAll(/slug:\s*'([^']+)'/g)].map((m) => m[1]);
const themed = [...source.matchAll(/slug:\s*'([^']+)'[^}]*themes:/g)].map((m) => m[1]);

function run(args) {
  const r = spawnSync(process.execPath, [tool, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) { console.error(r.stderr || r.stdout); return null; }
  try { return JSON.parse(r.stdout); } catch { return null; }
}

const STANDARD = 'phone:continue,phone:continue:1,phone:input,phone:people,desktop:continue,desktop:input,desktop:people';
const summary = [];
for (const slug of slugs) {
  const file = path.join(folder, `${slug}.html`);
  if (!existsSync(file)) { console.log(`skip ${slug} (no file)`); continue; }
  const rep = run([file, shots, '--shots', STANDARD]);
  if (themed.includes(slug)) run([file, shots, '--shots', 'phone:continue,phone:input,phone:people,desktop:input,desktop:people', '--query', 'theme=light', '--tag', 'light']);
  if (!rep) { summary.push({ slug, error: 'render failed' }); continue; }
  for (const s of rep.shots) {
    const a = s.audit || {};
    summary.push({
      slug, shot: s.shot, overflowX: a.horizontalOverflowPx, pageScroll: a.pageScrollPx, logAtEnd: a.logScrolledToEnd,
      smallTargets: a.smallTapTargetCount, tinyText: a.tinyTextCount, minFont: a.minFontPx,
      exceptions: s.exceptions.length, consoleErrors: s.consoleErrors.length, external: s.externalRequests.length,
    });
  }
  console.log(`rendered ${slug}`);
}

const contact = path.join(folder, 'contact.html');
if (existsSync(contact)) {
  for (const state of ['continue', 'input', 'people']) {
    // The viewport height is kept small so that --full captures exactly the content height.
    run([contact, shots, '--prefix', 'sheet', '--shots', `2620x400:${state}`, '--query', 'device=phone&cols=6', '--tag', 'phones-wide', '--full']);
    run([contact, shots, '--prefix', 'sheet', '--shots', `1330x400:${state}`, '--query', 'device=phone&cols=3', '--tag', 'phones', '--full']);
  }
  for (const state of ['continue', 'input', 'people']) {
    run([contact, shots, '--prefix', 'sheet', '--shots', `1920x400:${state}`, '--query', 'device=desktop&cols=2', '--tag', 'pc', '--full']);
  }
  console.log('contact sheets built');
}

writeFileSync(path.join(shots, 'audit-summary.json'), JSON.stringify(summary, null, 2));
const bad = summary.filter((r) => r.error || r.overflowX || r.pageScroll || r.exceptions || r.consoleErrors || r.external || r.logAtEnd === false
  || (/^phone/.test(r.shot || '') && (r.smallTargets || r.tinyText)));
console.log(JSON.stringify({ rendered: slugs.length, rows: summary.length, problems: bad }, null, 2));
