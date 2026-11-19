import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// The built site may talk to exactly one place: the Claude API. Everything else must come from the
// site's own files. The policy is added at build time only, because the dev server needs inline
// scripts for hot reloading.
const CSP = [
  "default-src 'self'",
  "connect-src https://api.anthropic.com",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'", // React writes style attributes (meter widths, colours per person)
  "img-src 'self' data:",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

function contentSecurityPolicy(): Plugin {
  return {
    name: 'bq-content-security-policy',
    apply: 'build',
    transformIndexHtml: () => [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' }],
  };
}

// The built site keeps its own files on the device, so that it opens with no network connection.
// The worker that does it is written here, when the site is built, because only then are the names
// of the files known (each carries a hash of its contents, so a kept file never goes stale).
//   - The page and the files it needs at once are kept when the worker is installed.
//   - Anything else of the site's own (the PDF reader, fetched only when a PDF is chosen) is kept the first time it is used.
//   - The page itself is fetched fresh when there is a network, so a new version is noticed; the kept copy is for when there is none.
//   - A request to anywhere else (the Claude API) is never touched.
//   - A kept file is found by its address alone. Some hosts answer with "Vary: Origin", and the page asks for its script with an Origin
//     header the worker's own fetch did not send: matched strictly, the script would never be found again. (Seen with the preview server.)
const SERVICE_WORKER = `const CACHE = 'bq-__VERSION__';
const SHELL = __FILES__;
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL))); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('bq-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('message', (e) => { if (e.data === 'update') self.skipWaiting(); });
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put('index.html', copy)); }
      return res;
    }).catch(() => caches.match('index.html', { cacheName: CACHE, ignoreVary: true }).then((kept) => kept || Response.error())));
    return;
  }
  e.respondWith(caches.match(req, { cacheName: CACHE, ignoreVary: true }).then((kept) => kept || fetch(req).then((res) => {
    if (res.ok && url.pathname.includes('/assets/')) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return res;
  })));
});
`;

/** Files in public/ that the page needs to look right offline. */
const PUBLIC_SHELL = ['manifest.webmanifest', 'icon.svg', 'icon-192.png'];

function serviceWorker(): Plugin {
  return {
    name: 'bq-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      // Kept at once: the page, its script and its styles. Not the source maps, and not the PDF reader (over a megabyte, and most players never open a PDF).
      const files = Object.keys(bundle).filter((f) => !f.endsWith('.map') && !/pdf/i.test(f)).sort();
      const shell = ['index.html', ...files, ...PUBLIC_SHELL];
      // A name for this set of files: any change to the list (the files carry hashes of their contents) or to the worker gives another.
      let h = 0x811c9dc5;
      for (const ch of shell.join('|') + SERVICE_WORKER) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0;
      const version = h.toString(16).padStart(8, '0');
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: SERVICE_WORKER.replace('__VERSION__', version).replace('__FILES__', JSON.stringify(shell)) });
    },
  };
}

// The app is static files: no server of our own. `base: './'` lets the build be hosted under any path.
export default defineConfig({
  base: './',
  plugins: [react(), contentSecurityPolicy(), serviceWorker()],
  build: { target: 'es2022', sourcemap: true },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
