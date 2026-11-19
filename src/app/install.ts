// The app as something installed: opening without a network, a place on the home screen, and new
// versions. All of it is the browser's own machinery; nothing here talks to anyone.
//
// A service worker (written at build time, see vite.config.ts) keeps the app's own files on the
// device, so the page opens with no connection. It never touches a request to the Claude API. It
// exists only in the built site: the development server has none.

/** What the interface needs to know. Changes are announced through the function given to `startInstall`. */
export const install = {
  /** The browser has offered to install the app, and has not been answered yet. */
  can: false,
  /** The app is running as an installed app, in a window of its own. */
  standalone: false,
  /** An iPhone or iPad, where installing is done by hand from the Share menu. */
  ios: false,
  /** The app's files are kept on this device: it opens without a network connection. */
  offline: false,
  /** A newer version has been fetched and waits for a reload. */
  update: false,
};

type InstallPrompt = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };
let offer: InstallPrompt | null = null;
let waiting: ServiceWorker | null = null;

/** Begin listening. Safe to call anywhere: without the browser features it needs, it does nothing. */
export function startInstall(changed: () => void): void {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return;
  const standalone = () => window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
  install.standalone = standalone();
  install.ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    offer = e as InstallPrompt;
    install.can = true;
    changed();
  });
  window.addEventListener('appinstalled', () => {
    offer = null;
    install.can = false;
    install.standalone = standalone();
    changed();
  });
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  const found = (reg: ServiceWorkerRegistration) => {
    // A worker that is installed while another already runs the page is a new version, waiting.
    if (reg.waiting && navigator.serviceWorker.controller) { waiting = reg.waiting; install.update = true; changed(); }
  };
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    found(reg);
    reg.addEventListener('updatefound', () => {
      const next = reg.installing;
      next?.addEventListener('statechange', () => { if (next.state === 'installed') found(reg); });
    });
  }).catch(() => { /* no offline copy; the app works all the same */ });
  void navigator.serviceWorker.ready.then(() => { install.offline = true; changed(); });
  // A new version has taken over: start again with its files.
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded || !install.update) return;
    reloaded = true;
    window.location.reload();
  });
}

/** Show the browser's own install dialog. True when the player accepted. */
export async function promptInstall(changed: () => void): Promise<boolean> {
  if (!offer) return false;
  const asked = offer;
  offer = null;
  install.can = false;
  changed();
  try {
    await asked.prompt();
    return (await asked.userChoice).outcome === 'accepted';
  } catch {
    return false;
  }
}

/** Switch to the version that is waiting. The page reloads when it has taken over. */
export function applyUpdate(): void {
  if (waiting) waiting.postMessage('update');
  else window.location.reload();
}
