#!/usr/bin/env node
// Pack every direction of a mockup folder into ONE self-contained HTML file that can be
// sent to another device and opened there (no server, no sibling files).
//
// Usage:  node docs/mockups/_tools/build-standalone.mjs [folder]   (default: docs/mockups/play-screen)
// Output: <folder>/all-directions.html
//
// On a phone, each direction opens full screen, so you see the real phone layout on the
// real device. On a wide screen you can switch between a phone-sized frame and full width.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = path.dirname(fileURLToPath(import.meta.url));
const folder = path.resolve(process.argv[2] || path.join(here, '..', 'play-screen'));

const sandbox = { window: {} };
vm.runInNewContext(readFileSync(path.join(folder, 'directions.js'), 'utf8'), sandbox);
const directions = (sandbox.window.DIRECTIONS || []).filter((d) => existsSync(path.join(folder, `${d.slug}.html`)));

const sources = {};
for (const d of directions) sources[d.slug] = readFileSync(path.join(folder, `${d.slug}.html`), 'utf8');

// Safe to place inside a <script> element.
const embed = (value) => JSON.stringify(value)
  .replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--')
  .split(String.fromCharCode(0x2028)).join('\\u2028').split(String.fromCharCode(0x2029)).join('\\u2029');

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Bitor Quest - play screen directions</title>
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; background: #15171b; color: #e9ebef;
    font: 16px/1.5 "Segoe UI Variable Text", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; }
  #menu { max-width: 760px; margin: 0 auto; padding: 28px 18px 40px; }
  h1 { font-size: 22px; margin: 0 0 4px; font-weight: 600; }
  p.lead { margin: 0 0 22px; color: #a3aab6; }
  .item { display: block; width: 100%; text-align: left; font: inherit; color: inherit; cursor: pointer;
    background: #1d2026; border: 1px solid #2c313a; border-radius: 14px; padding: 16px 18px; margin: 0 0 12px; }
  .item:active, .item:hover { border-color: #8fb4ff; }
  .item b { display: block; font-size: 18px; font-weight: 600; }
  .item .tag { display: block; color: #8fb4ff; font-size: 14px; margin: 1px 0 6px; }
  .item .sum { display: block; color: #c9ced8; font-size: 15px; }
  .item .meta { display: block; color: #a3aab6; font-size: 14px; margin-top: 6px; }
  #stage { position: fixed; inset: 0; display: none; background: #0b0c0e; }
  #stage.on { display: block; }
  #stage iframe { position: absolute; border: 0; background: #fff; }
  #stage.full iframe { inset: 0; width: 100%; height: 100%; }
  #stage.framed iframe { width: 390px; height: 844px; left: 50%; top: 50%; transform: translate(-50%, -50%);
    border-radius: 22px; box-shadow: 0 0 0 7px #000, 0 0 0 8px #3a404b; }
  #dock { position: absolute; left: 50%; bottom: 10px; transform: translateX(-50%); display: flex; gap: 6px; z-index: 2;
    background: rgba(21, 23, 27, .9); border: 1px solid #3a404b; border-radius: 999px; padding: 5px; }
  #dock.min { opacity: .0; pointer-events: none; }
  #dock button, #peek { font: inherit; font-size: 14px; color: #e9ebef; background: transparent; border: 0; border-radius: 999px;
    padding: 8px 14px; min-height: 40px; cursor: pointer; }
  #dock button:hover { background: #2a3140; }
  #dock .name { padding: 8px 6px 8px 12px; color: #a3aab6; font-size: 14px; align-self: center; white-space: nowrap; }
  #peek { position: absolute; right: 0; top: 50%; transform: translateY(-50%); z-index: 3; background: rgba(21, 23, 27, .72);
    border: 1px solid #3a404b; border-right: 0; border-radius: 10px 0 0 10px; padding: 12px 3px; min-height: 56px;
    font-size: 12px; writing-mode: vertical-rl; letter-spacing: .06em; opacity: .75; }
  @media (max-width: 760px) { #frameBtn { display: none; } }
</style>
</head>
<body>
<div id="menu">
  <h1>Bitor Quest: play screen</h1>
  <p class="lead">Six design directions for the same screen, same scene and same data. Open one, press Continue, open People. Use the "Menu" tab on the right edge to come back here.</p>
  <div id="list"></div>
</div>
<div id="stage" class="full">
  <iframe id="view" title="mockup"></iframe>
  <button id="peek" aria-label="Show the menu bar">Menu</button>
  <div id="dock" class="min">
    <span class="name" id="name"></span>
    <button id="prev">Previous</button>
    <button id="next">Next</button>
    <button id="frameBtn">Phone size</button>
    <button id="back">All directions</button>
    <button id="hide">Hide</button>
  </div>
</div>
<script>
var DIRECTIONS = ${embed(directions)};
var SOURCES = ${embed(sources)};
(function () {
  var list = document.getElementById('list'), stage = document.getElementById('stage'), view = document.getElementById('view');
  var dock = document.getElementById('dock'), nameEl = document.getElementById('name'), frameBtn = document.getElementById('frameBtn');
  var current = 0;
  function open(i) {
    current = (i + DIRECTIONS.length) % DIRECTIONS.length;
    var d = DIRECTIONS[current];
    nameEl.textContent = (current + 1) + '. ' + d.name;
    view.srcdoc = SOURCES[d.slug];
    stage.classList.add('on');
    dock.classList.add('min');
    document.body.style.overflow = 'hidden';
  }
  function close() { stage.classList.remove('on'); view.srcdoc = ''; document.body.style.overflow = ''; }
  DIRECTIONS.forEach(function (d, i) {
    var b = document.createElement('button'); b.className = 'item';
    var add = function (cls, text) { if (!text) return; var s = document.createElement(cls === 'b' ? 'b' : 'span'); if (cls !== 'b') s.className = cls; s.textContent = text; b.appendChild(s); };
    add('b', (i + 1) + '. ' + d.name); add('tag', d.tagline); add('sum', d.summary);
    add('meta', d.bestFor ? 'Best for: ' + d.bestFor : ''); add('meta', d.weakness ? 'Watch out: ' + d.weakness : '');
    b.addEventListener('click', function () { open(i); });
    list.appendChild(b);
  });
  document.getElementById('peek').addEventListener('click', function () { dock.classList.toggle('min'); });
  document.getElementById('hide').addEventListener('click', function () { dock.classList.add('min'); });
  document.getElementById('back').addEventListener('click', close);
  document.getElementById('prev').addEventListener('click', function () { open(current - 1); });
  document.getElementById('next').addEventListener('click', function () { open(current + 1); });
  frameBtn.addEventListener('click', function () {
    var framed = stage.classList.toggle('framed'); stage.classList.toggle('full', !framed);
    frameBtn.textContent = framed ? 'Full width' : 'Phone size';
  });
})();
</script>
</body>
</html>
`;

const out = path.join(folder, 'all-directions.html');
writeFileSync(out, page);
console.log(`wrote ${out} (${Math.round(page.length / 1024)} KB, ${directions.length} directions)`);
