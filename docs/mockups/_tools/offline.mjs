#!/usr/bin/env node
// Checks that the built site opens with no network.
//
//   npm run build
//   node docs/mockups/_tools/offline.mjs
//
// It serves dist/ on a local port, opens it in a headless Chromium-based browser, waits for the
// service worker to keep the app's files, stops the server, and loads the page again. With the
// server gone, the page can only have come from what was kept on the device.
// Prints a JSON report and exits with 1 if the page did not come back.

import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const PORT = Number(process.env.PORT) || 4174;
const BASE = `http://127.0.0.1:${PORT}/`;
const BROWSERS = [
  process.env.BROWSER_BIN,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const up = async () => { try { return (await fetch(BASE, { signal: AbortSignal.timeout(1500) })).ok; } catch { return false; } };

class Cdp {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.listeners = new Set();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString('utf8'));
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id); this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`${msg.error.message} (${msg.error.code})`)); else resolve(msg.result);
      } else if (msg.method) for (const l of this.listeners) l(msg);
    });
  }
  static connect(url) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.addEventListener('open', () => resolve(new Cdp(ws)));
      ws.addEventListener('error', () => reject(new Error('Could not connect to the browser.')));
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); });
  }
  waitFor(method, sessionId, timeoutMs = 20000) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { this.listeners.delete(l); reject(new Error(`timeout waiting for ${method}`)); }, timeoutMs);
      const l = (msg) => { if (msg.method === method && (!sessionId || msg.sessionId === sessionId)) { clearTimeout(t); this.listeners.delete(l); resolve(msg.params); } };
      this.listeners.add(l);
    });
  }
}

const report = { served: false, kept: null, offline: null, ok: false };
let server; let browser; let profile;
try {
  if (!existsSync('dist/index.html')) throw new Error('There is no built site. Run "npm run build" first.');
  server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
  for (let i = 0; i < 60 && !(await up()); i++) await sleep(250);
  report.served = await up();
  if (!report.served) throw new Error(`The built site did not come up on port ${PORT}.`);

  const bin = BROWSERS.find((b) => existsSync(b));
  if (!bin) throw new Error('No Edge or Chrome found. Set BROWSER_BIN to a Chromium-based browser.');
  profile = mkdtempSync(path.join(tmpdir(), 'bq-offline-'));
  browser = spawn(bin, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--mute-audio', `--user-data-dir=${profile}`, '--remote-debugging-port=0', 'about:blank'], { stdio: 'ignore' });
  const portFile = path.join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 150 && !existsSync(portFile); i++) await sleep(100);
  let lines = [];
  for (let i = 0; i < 30 && lines.length < 2; i++) { lines = readFileSync(portFile, 'utf8').split(/\r?\n/).filter(Boolean); await sleep(100); }
  const cdp = await Cdp.connect(`ws://127.0.0.1:${lines[0]}${lines[1]}`);
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const s = (m, p) => cdp.send(m, p, sessionId);
  await s('Page.enable'); await s('Runtime.enable'); await s('Log.enable');
  // Whatever goes wrong in the page is part of the report.
  report.problems = [];
  cdp.listeners.add((msg) => {
    if (msg.sessionId !== sessionId) return;
    if (msg.method === 'Runtime.exceptionThrown') report.problems.push(String(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text).slice(0, 300));
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') report.problems.push(`${msg.params.entry.text} ${msg.params.entry.url || ''}`.slice(0, 300));
  });
  const run = async (expression) => {
    const r = await s('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result?.value;
  };
  const look = `({ title: document.title, drawn: document.querySelectorAll('#root *').length, heading: (document.querySelector('h1, h2') || {}).textContent || null, worker: !!navigator.serviceWorker.controller })`;

  // With the server up: the worker installs and keeps the files.
  let loaded = cdp.waitFor('Page.loadEventFired', sessionId);
  await s('Page.navigate', { url: `${BASE}?demo=1&play=0#/settings` });
  await loaded;
  report.kept = await run(`(async () => {
    await Promise.race([navigator.serviceWorker.ready, new Promise((_, no) => setTimeout(() => no(new Error('the service worker did not become ready')), 15000))]);
    const names = await caches.keys();
    const files = names.length ? (await (await caches.open(names[0])).keys()).map((r) => new URL(r.url).pathname) : [];
    return { caches: names, files, manifest: !!document.querySelector('link[rel=manifest]') };
  })()`);
  report.online = await run(look);

  // With the server gone: the page must come from what was kept.
  server.kill();
  for (let i = 0; i < 40 && (await up()); i++) await sleep(250);
  if (await up()) throw new Error('The server would not stop.');
  loaded = cdp.waitFor('Page.loadEventFired', sessionId);
  await s('Page.reload', { ignoreCache: false });
  await loaded;
  await sleep(1500);
  report.offline = await run(look);
  // Another screen, reached without a network.
  await run(`(location.hash = '#/worlds', 0)`);
  await sleep(600);
  report.offlineOtherScreen = await run(look);
  report.ok = report.offline.drawn > 20 && report.offline.worker === true && report.kept.files.includes('/index.html');
} catch (err) {
  report.error = err instanceof Error ? err.message : String(err);
} finally {
  try { server?.kill(); } catch { /* already gone */ }
  try { browser?.kill(); } catch { /* already gone */ }
  await sleep(400);
  try { if (profile) rmSync(profile, { recursive: true, force: true }); } catch { /* the browser may still hold it */ }
}
console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
