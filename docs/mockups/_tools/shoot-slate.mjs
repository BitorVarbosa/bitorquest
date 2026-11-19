#!/usr/bin/env node
// Render every Slate screen in every state at phone and PC size, check the layout, and build contact sheets.
//
// Usage:  node docs/mockups/_tools/shoot-slate.mjs [--only play,people] [--tall] [--no-sheets]
//   --only       render just these screens (file names without .html)
//   --tall       also render each state in a very tall window (shots/tall), so whole pages are seen and checked
//   --no-sheets  skip the contact sheets
//
// Reads docs/mockups/slate/screens.js. Writes PNGs and audit-summary.json to docs/mockups/slate/shots.

import { execFile } from 'node:child_process';
import { readFileSync, existsSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = path.dirname(fileURLToPath(import.meta.url));
const folder = path.resolve(here, '..', 'slate');
const shots = path.join(folder, 'shots');
const tool = path.join(here, 'shoot.mjs');
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const value = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };

const sandbox = { window: {} };
vm.runInNewContext(readFileSync(path.join(folder, 'screens.js'), 'utf8'), sandbox);
let screens = sandbox.window.SCREENS || [];
const only = value('--only');
if (only) { const want = only.split(','); screens = screens.filter((s) => want.includes(s.file)); }
mkdirSync(shots, { recursive: true });

function run(args) {
  return new Promise((resolve) => {
    execFile(process.execPath, [tool, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) { console.error(String(stderr || err.message).trim()); resolve(null); return; }
      try { resolve(JSON.parse(stdout)); } catch { resolve(null); }
    });
  });
}
async function pool(jobs, size) {
  let next = 0;
  await Promise.all(Array.from({ length: size }, async () => {
    while (next < jobs.length) { const i = next++; await jobs[i](); }
  }));
}

const summary = [];
function collect(file, report, tall) {
  if (!report) { summary.push({ file, tall, error: 'render failed' }); return; }
  for (const s of report.shots) {
    const a = s.audit || {};
    summary.push({
      file, shot: s.shot, tall, overflowX: a.horizontalOverflowPx, pageScroll: a.pageScrollPx,
      smallTargets: a.smallTapTargetCount, smallTargetList: a.smallTapTargets, tinyText: a.tinyTextCount, tinyTextList: a.tinyText,
      minFont: a.minFontPx, pastRightEdge: a.elementsPastRightEdge,
      exceptions: s.exceptions, consoleErrors: s.consoleErrors, external: s.externalRequests,
    });
  }
}

const jobs = [];
for (const s of screens) {
  const file = path.join(folder, `${s.file}.html`);
  if (!existsSync(file)) { console.log(`skip ${s.file} (no file yet)`); continue; }
  const states = s.states.map((st) => st[0]);
  jobs.push(async () => {
    collect(s.file, await run([file, shots, '--shots', states.flatMap((st) => [`phone:${st}`, `desktop:${st}`]).join(',')]), false);
    if (flag('--tall')) {
      collect(s.file, await run([file, path.join(shots, 'tall'), '--shots', states.flatMap((st) => [`390x2600:${st}`, `1440x2000:${st}`]).join(',')]), true);
    }
    console.log(`rendered ${s.file}`);
  });
}
await pool(jobs, 4);

if (!flag('--no-sheets') && !only) {
  const contact = path.join(folder, 'contact.html');
  const groups = [...new Set(screens.map((s) => s.group))];
  const sheetJobs = [];
  for (const g of groups) {
    const slug = g.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const q = `group=${encodeURIComponent(g)}`;
    // The window is kept short so that --full captures exactly the height of the sheet.
    sheetJobs.push(() => run([contact, shots, '--prefix', 'sheet', '--shots', '1680x300:default', '--query', `${q}&device=phone`, '--tag', `${slug}-phone`, '--full']));
    sheetJobs.push(() => run([contact, shots, '--prefix', 'sheet', '--shots', '1680x300:default', '--query', `${q}&device=desktop`, '--tag', `${slug}-pc`, '--full']));
  }
  await pool(sheetJobs, 4);
  // shoot.mjs names a file after the window it used; give the sheets plain names: sheet-<group>-<phone|pc>.png
  for (const g of groups) {
    const slug = g.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    for (const d of ['phone', 'pc']) {
      const from = path.join(shots, `sheet-1680x300-default-${slug}-${d}.png`);
      if (existsSync(from)) renameSync(from, path.join(shots, `sheet-${slug}-${d}.png`));
    }
  }
  console.log('contact sheets built');
}

writeFileSync(path.join(shots, 'audit-summary.json'), JSON.stringify(summary, null, 2));
const isPhone = (r) => /^(phone|390x)/.test(r.shot || '');
const problems = summary.filter((r) => r.error || r.overflowX || r.pageScroll || r.exceptions?.length || r.consoleErrors?.length || r.external?.length
  || r.tinyText || (isPhone(r) && r.smallTargets))
  .map((r) => ({
    file: r.file, shot: r.shot, error: r.error, overflowX: r.overflowX || undefined, pageScroll: r.pageScroll || undefined,
    smallTargets: isPhone(r) && r.smallTargets ? r.smallTargetList : undefined, tinyText: r.tinyText ? r.tinyTextList : undefined,
    pastRightEdge: r.overflowX ? r.pastRightEdge : undefined,
    exceptions: r.exceptions?.length ? r.exceptions : undefined, consoleErrors: r.consoleErrors?.length ? r.consoleErrors : undefined,
    external: r.external?.length ? r.external : undefined,
  }));
console.log(JSON.stringify({ screens: screens.length, shots: summary.length, problems }, null, 2));
