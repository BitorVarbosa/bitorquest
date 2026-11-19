#!/usr/bin/env node
// Render a mockup HTML file to PNG screenshots with real phone / desktop viewports,
// and run a few automatic layout audits. No dependencies: drives an installed
// Edge or Chrome through the DevTools protocol (Node 22+ for the built-in WebSocket).
//
// Why the DevTools protocol and not `--screenshot --window-size`: a headless window cannot be
// narrower than about 500px, so a 390px phone layout would be laid out too wide and cropped.
//
// Usage:
//   node docs/mockups/_tools/shoot.mjs <file.html> <outDir> [--prefix name] [--shots a,b,c] [--json report.json]
//                                      [--query "theme=light"] [--tag light]
//   --query adds extra URL parameters to every shot; --tag is appended to the PNG names.
//   --full captures the whole page height instead of the viewport (for contact sheets).
//   --wait <ms> waits this long after the page loads before looking (default 350).
//   --click "<css selector>" presses the first match after the page has loaded (and after any Continue clicks).
//   --hover "<css selector>" then moves the mouse onto the first match, so hover states can be photographed
//   (use a desktop shot: a phone shot emulates touch, which has no hover).
//   --eval "<js>" then runs that expression in the page. A short pause follows each of the three.
//   --eval-file <path> is the same with the script read from a file. What the script returns (it may be
//   a promise) is put in the report as "evalResult", so a script can measure the page as well as drive it.
//   The first argument may also be an http(s) address, opened as given (the state is then only a label).
//
// A shot is "<device>:<state>[:<clicks>]" where
//   device  = phone (390x844 @2x, touch) | desktop (1440x900 @1x) | tablet (820x1180 @2x) | WxH (e.g. 360x740)
//   state   = value passed to the page as ?state=<state>   (use "default" for no parameter)
//   clicks  = optional number of clicks on the [data-continue] control after load
// Default shots: phone:continue, phone:input, phone:people, desktop:input, desktop:people
//
// Output: <outDir>/<prefix>-<device>-<state>[-cN].png and a JSON report on stdout.

import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const DEVICES = {
  phone: { width: 390, height: 844, dpr: 2, mobile: true },
  tablet: { width: 820, height: 1180, dpr: 2, mobile: true },
  desktop: { width: 1440, height: 900, dpr: 1, mobile: false },
};
const DEFAULT_SHOTS = ['phone:continue', 'phone:input', 'phone:people', 'desktop:input', 'desktop:people'];

const BROWSERS = [
  process.env.BROWSER_BIN,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

function parseArgs(argv) {
  const pos = [];
  const opt = { prefix: null, shots: DEFAULT_SHOTS, json: null, query: '', tag: '', full: false, wait: 350, click: null, hover: null, eval: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--prefix') opt.prefix = argv[++i];
    else if (a === '--shots') opt.shots = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--json') opt.json = argv[++i];
    else if (a === '--query') opt.query = argv[++i].replace(/^[?&]/, '');
    else if (a === '--tag') opt.tag = argv[++i];
    else if (a === '--full') opt.full = true;
    else if (a === '--wait') opt.wait = Number(argv[++i]) || 350;
    else if (a === '--click') opt.click = argv[++i];
    else if (a === '--hover') opt.hover = argv[++i];
    else if (a === '--eval') opt.eval = argv[++i];
    else if (a === '--eval-file') opt.eval = readFileSync(argv[++i], 'utf8');
    else pos.push(a);
  }
  if (pos.length < 2) {
    console.error('usage: node shoot.mjs <file.html> <outDir> [--prefix name] [--shots a,b] [--json report.json] [--query "k=v"] [--tag name]');
    process.exit(2);
  }
  // The target is a file, or an http(s) address (a running dev server), which is opened exactly as given.
  const isUrl = /^https?:/i.test(pos[0]);
  return { file: isUrl ? pos[0] : path.resolve(pos[0]), isUrl, outDir: path.resolve(pos[1]), ...opt };
}

function parseShot(spec) {
  const [dev, state = 'default', clicks = '0'] = spec.split(':');
  let device = DEVICES[dev];
  if (!device) {
    const m = /^(\d+)x(\d+)$/.exec(dev);
    if (!m) throw new Error(`unknown device "${dev}" in shot "${spec}"`);
    const width = Number(m[1]);
    device = { width, height: Number(m[2]), dpr: width < 700 ? 2 : 1, mobile: width < 900 };
  }
  return { spec, dev, state, clicks: Number(clicks) || 0, ...device };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launch() {
  const bin = BROWSERS.find((b) => existsSync(b));
  if (!bin) throw new Error('No Edge/Chrome found. Set BROWSER_BIN to a Chromium-based browser executable.');
  const profile = mkdtempSync(path.join(tmpdir(), 'bq-shoot-'));
  const proc = spawn(bin, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-background-networking', '--mute-audio',
    `--user-data-dir=${profile}`, '--remote-debugging-port=0', 'about:blank',
  ], { stdio: 'ignore' });
  const portFile = path.join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 150 && !existsSync(portFile); i++) await sleep(100);
  if (!existsSync(portFile)) { proc.kill(); throw new Error('Browser did not expose a DevTools port.'); }
  let lines = [];
  for (let i = 0; i < 30; i++) {
    lines = readFileSync(portFile, 'utf8').split(/\r?\n/).filter(Boolean);
    if (lines.length >= 2) break;
    await sleep(100);
  }
  return { proc, profile, wsUrl: `ws://127.0.0.1:${lines[0]}${lines[1]}` };
}

class Cdp {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.listeners = new Set();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString('utf8'));
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id); this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`${msg.error.message} (${msg.error.code})`)); else resolve(msg.result);
      } else if (msg.method) {
        for (const l of this.listeners) l(msg);
      }
    });
  }
  static connect(url) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.addEventListener('open', () => resolve(new Cdp(ws)));
      ws.addEventListener('error', () => reject(new Error('Could not connect to the browser DevTools endpoint.')));
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    const payload = { id, method, params }; if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(payload));
    });
  }
  waitFor(method, sessionId, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { this.listeners.delete(l); reject(new Error(`timeout waiting for ${method}`)); }, timeoutMs);
      const l = (msg) => {
        if (msg.method === method && (!sessionId || msg.sessionId === sessionId)) {
          clearTimeout(t); this.listeners.delete(l); resolve(msg.params);
        }
      };
      this.listeners.add(l);
    });
  }
}

// Runs inside the page. Returns objective layout facts; judgement is left to the reader.
const AUDIT = `(() => {
  const vw = window.innerWidth, vh = window.innerHeight;
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) return false;
    if (r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) return false;
    return true;
  };
  const label = (el) => (el.getAttribute('aria-label') || el.innerText || el.getAttribute('title') || el.tagName).trim().replace(/\\s+/g, ' ').slice(0, 40);
  const all = Array.from(document.querySelectorAll('body *'));
  const interactive = all.filter((el) => el.matches('button, a[href], input, textarea, select, [role="button"], [role="tab"], [data-continue], [data-people-toggle], [tabindex]:not([tabindex="-1"])') && visible(el));
  const smallTargets = interactive.map((el) => { const r = el.getBoundingClientRect(); return { label: label(el), w: Math.round(r.width), h: Math.round(r.height) }; })
    .filter((t) => t.w < 40 || t.h < 40);
  const textEls = all.filter((el) => visible(el) && Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim().length > 1));
  const sizes = textEls.map((el) => ({ size: parseFloat(getComputedStyle(el).fontSize), text: el.textContent.trim().replace(/\\s+/g, ' ').slice(0, 30) }));
  const tiny = sizes.filter((s) => s.size < 11.5);
  const offRight = all.filter((el) => visible(el)).map((el) => ({ el, r: el.getBoundingClientRect() })).filter((x) => x.r.right > vw + 1 && x.r.left < vw)
    .slice(0, 8).map((x) => ({ label: label(x.el), right: Math.round(x.r.right) }));
  const log = document.querySelector('[data-log]');
  return {
    viewport: vw + 'x' + vh,
    mode: document.body.dataset.mode || null,
    people: document.body.dataset.people || null,
    horizontalOverflowPx: Math.max(0, document.documentElement.scrollWidth - vw),
    pageScrollPx: Math.max(0, document.documentElement.scrollHeight - vh),
    logFound: !!log,
    logScrolledToEnd: log ? (log.scrollHeight - log.scrollTop - log.clientHeight) < 4 : null,
    continueVisible: !!Array.from(document.querySelectorAll('[data-continue]')).find(visible),
    pendingHidden: Array.from(document.querySelectorAll('[data-pending]')).filter((el) => !visible(el)).length,
    interactiveCount: interactive.length,
    smallTapTargets: smallTargets.slice(0, 12),
    smallTapTargetCount: smallTargets.length,
    tinyText: tiny.slice(0, 8),
    tinyTextCount: tiny.length,
    minFontPx: sizes.length ? Math.min(...sizes.map((s) => s.size)) : null,
    elementsPastRightEdge: offRight,
  };
})()`;

async function main() {
  const opt = parseArgs(process.argv.slice(2));
  if (!opt.isUrl && !existsSync(opt.file)) { console.error(`file not found: ${opt.file}`); process.exit(2); }
  mkdirSync(opt.outDir, { recursive: true });
  const prefix = opt.prefix || (opt.isUrl ? 'page' : path.basename(opt.file).replace(/\.html?$/i, ''));
  const shots = opt.shots.map(parseShot);
  const base = opt.isUrl ? opt.file : pathToFileURL(opt.file).href;

  const { proc, profile, wsUrl } = await launch();
  const report = { file: opt.file, shots: [] };
  try {
    const cdp = await Cdp.connect(wsUrl);
    for (const shot of shots) {
      const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
      const s = (m, p) => cdp.send(m, p, sessionId);
      const problems = { consoleErrors: [], exceptions: [], externalRequests: [] };
      const listener = (msg) => {
        if (msg.sessionId !== sessionId) return;
        if (msg.method === 'Runtime.exceptionThrown') problems.exceptions.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
        if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') problems.consoleErrors.push(msg.params.entry.text);
        if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') problems.consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description).join(' '));
        if (msg.method === 'Network.requestWillBeSent') {
          const u = msg.params.request.url;
          if (!/^(file:|data:|about:|blob:)/.test(u)) problems.externalRequests.push(u);
        }
      };
      cdp.listeners.add(listener);
      await s('Page.enable'); await s('Runtime.enable'); await s('Log.enable'); await s('Network.enable');
      await s('Emulation.setDeviceMetricsOverride', { width: shot.width, height: shot.height, deviceScaleFactor: shot.dpr, mobile: shot.mobile });
      if (shot.mobile) await s('Emulation.setTouchEmulationEnabled', { enabled: true });
      const params = [];
      if (shot.state !== 'default') params.push(`state=${encodeURIComponent(shot.state)}`);
      if (opt.query) params.push(opt.query);
      // For an address, the state is only a label for the file name.
      const url = opt.isUrl ? base : params.length ? `${base}?${params.join('&')}` : base;
      const loaded = cdp.waitFor('Page.loadEventFired', sessionId);
      await s('Page.navigate', { url });
      await loaded;
      await sleep(opt.wait);
      for (let i = 0; i < shot.clicks; i++) {
        await s('Runtime.evaluate', { expression: `(() => { const b = Array.from(document.querySelectorAll('[data-continue]')).find((e) => e.getBoundingClientRect().width > 0); if (b) b.click(); })()` });
        await sleep(250);
      }
      if (opt.click) {
        await s('Runtime.evaluate', { expression: `(() => { const e = document.querySelector(${JSON.stringify(opt.click)}); if (e) e.click(); })()` });
        await sleep(350);
      }
      if (opt.hover) {
        const at = await s('Runtime.evaluate', {
          returnByValue: true,
          expression: `(() => { const e = document.querySelector(${JSON.stringify(opt.hover)}); if (!e) return null; e.scrollIntoView({ block: 'nearest' }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`,
        });
        const p = at.result?.value;
        if (p) {
          await s('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(p.x) - 3, y: Math.round(p.y) - 3 });
          await s('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(p.x), y: Math.round(p.y) });
        }
        await sleep(350);
      }
      let evalResult;
      if (opt.eval) {
        const r = await s('Runtime.evaluate', { expression: opt.eval, awaitPromise: true, returnByValue: true });
        evalResult = r.exceptionDetails ? { error: r.exceptionDetails.exception?.description || r.exceptionDetails.text } : r.result?.value;
        await sleep(350);
      }
      const audit = await s('Runtime.evaluate', { expression: AUDIT, returnByValue: true });
      let png;
      if (opt.full) {
        const m = await s('Page.getLayoutMetrics');
        const size = m.cssContentSize || m.contentSize;
        png = await s('Page.captureScreenshot', {
          format: 'png', captureBeyondViewport: true,
          clip: { x: 0, y: 0, width: Math.ceil(size.width), height: Math.ceil(size.height), scale: 1 },
        });
      } else {
        png = await s('Page.captureScreenshot', { format: 'png' });
      }
      const name = `${prefix}-${shot.dev}-${shot.state}${shot.clicks ? `-c${shot.clicks}` : ''}${opt.tag ? `-${opt.tag}` : ''}.png`;
      const out = path.join(opt.outDir, name);
      writeFileSync(out, Buffer.from(png.data, 'base64'));
      cdp.listeners.delete(listener);
      await cdp.send('Target.closeTarget', { targetId });
      report.shots.push({ shot: shot.spec, png: out, audit: audit.result?.value ?? null, ...(evalResult !== undefined ? { evalResult } : {}), ...problems });
    }
    await cdp.send('Browser.close').catch(() => {});
  } finally {
    await sleep(300);
    try { proc.kill(); } catch {}
    await sleep(200);
    try { rmSync(profile, { recursive: true, force: true }); } catch {}
  }
  const text = JSON.stringify(report, null, 2);
  if (opt.json) writeFileSync(path.resolve(opt.json), text);
  console.log(text);
}

main().catch((err) => { console.error(String(err?.stack || err)); process.exit(1); });
