#!/usr/bin/env node
// Pack the Slate mockups (every screen, the shared stylesheet and script, and the viewer)
// into ONE self-contained HTML file that can be sent to a phone and opened there.
//
// Usage:  node docs/mockups/_tools/build-slate.mjs
// Output: docs/mockups/slate/bitor-quest-screens.html
//
// The viewer (slate/index.html) is reused as the menu. Each screen's source is stored once;
// the shared files are stored once and joined to a screen when it is opened.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = path.dirname(fileURLToPath(import.meta.url));
const folder = path.resolve(here, '..', 'slate');
const read = (name) => readFileSync(path.join(folder, name), 'utf8');

const sandbox = { window: {} };
vm.runInNewContext(read('screens.js'), sandbox);
const screens = sandbox.window.SCREENS || [];

const sources = {};
const missing = [];
for (const s of screens) {
  const file = `${s.file}.html`;
  if (existsSync(path.join(folder, file))) sources[s.file] = read(file);
  else missing.push(file);
}
const assets = { 'slate.css': read('slate.css'), 'play.css': read('play.css'), 'slate.js': read('slate.js') };

// Safe to place inside a <script> element.
const BS = String.fromCharCode(92); // a backslash, written this way so no tool that copies this file can swallow it
const inScript = (text) => text.replace(/<\/(script)/gi, `<${BS}/$1`).replace(/<!--/g, `<${BS}!--`);
const embed = (value) => inScript(JSON.stringify(value))
  .split(String.fromCharCode(0x2028)).join(`${BS}u2028`).split(String.fromCharCode(0x2029)).join(`${BS}u2029`);

let page = read('index.html');
const swap = (from, to) => {
  if (!page.includes(from)) throw new Error(`index.html no longer contains: ${from}`);
  page = page.replace(from, () => to);
};
swap('<link rel="stylesheet" href="slate.css">', `<style>${assets['slate.css']}</style>`);
swap('<script src="screens.js"></script>', `<script>${inScript(read('screens.js'))}</script>`);
swap('<script src="slate.js"></script>',
  `<script>window.BQ_PACK = ${embed({ sources, assets })};</script>\n<script>${inScript(assets['slate.js'])}</script>`);

const out = path.join(folder, 'bitor-quest-screens.html');
writeFileSync(out, page);
console.log(`wrote ${out} (${Math.round(Buffer.byteLength(page) / 1024)} KB, ${Object.keys(sources).length} of ${screens.length} screens)`);
if (missing.length) console.log(`not found, left out: ${missing.join(', ')}`);
