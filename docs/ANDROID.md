# Bitor Quest on Android

There are two ways to have Bitor Quest on an Android phone. The first needs nothing from this
project beyond a hosted build, and is what most players should use. The second is optional and has
not been built.

## 0. Before it is published: from your own PC

Until the site is hosted somewhere, a phone can get it from the PC that has the project.

```bash
npm run phone
```

builds the site and serves it to the local network on port 4173. Windows may ask whether Node.js may
accept connections: allow it on private networks.

**Just to play (Wi-Fi).** With the phone on the same Wi-Fi, open `http://<the PC's address>:4173/` in
the phone's browser (`ipconfig` on the PC shows the address, something like `192.168.0.123`). The game
plays in full. What does not work at such an address is what browsers allow only on a secure one:
installing, opening offline, and the browser's promise to keep the data. Your stories are saved in the
phone's browser under that address; if the PC's address changes they will seem to be gone (they are
still under the old one), so export what matters. Use this on a network you trust: the page itself
travels unencrypted between the PC and the phone. The key you type on the phone is sent only to
Anthropic, encrypted.

**To install it (USB, Android with Chrome).** To a phone, its own `localhost` counts as a secure
address, and Chrome can make the phone's `localhost` reach the PC through the cable:

1. On the phone: Settings, About phone, tap "Build number" seven times; then Developer options,
   "USB debugging" on. Connect the phone to the PC by USB and accept the prompt on the phone.
2. On the PC, with `npm run phone` running: open `chrome://inspect/#devices` in Chrome (or
   `edge://inspect` in Edge), press "Port forwarding…", add port `4173` to `localhost:4173`, tick
   "Enable port forwarding".
3. On the phone, in Chrome: open `http://localhost:4173/`. Then Settings, "About", **Install** in the
   app, or Chrome's menu, "Add to Home screen".
4. Once it has been opened that way, the app is kept on the phone: unplug the cable and it still
   opens, and talks to Claude over the phone's own connection. To bring a newer build to the phone,
   repeat steps 2 and 3; Settings, "About" will offer the new version.

Stories made this way live under `localhost:4173` on the phone. When the site is published, move
them with export and import. (This route has been checked on a PC, where the app installs and opens
with the server stopped; it has not been tried on a real phone yet.)

## 1. Install the web app (works today)

Open the hosted site in Chrome, then either Settings, "About", **Install** inside the app, or
Chrome's menu, "Add to Home screen" / "Install app". The result:

- an icon on the home screen and in the app drawer;
- a window of its own, with no address bar;
- it opens without a network connection (talking to Claude still needs one);
- stories, worlds, settings and the key stay in the phone's storage for that site.

Other Android browsers (Edge, Samsung Internet, Firefox) offer the same under their own menu names.

What makes this possible is in the repository already: `public/manifest.webmanifest`, the icons in
`public/`, and the service worker written by `vite.config.ts` when the site is built.
`node docs/mockups/_tools/offline.mjs` checks the offline part.

Two things to tell players:

- **The data belongs to the browser.** Clearing Chrome's site data for the site erases the stories.
  Export the ones that matter (Settings, "Your data").
- **A phone that is short of space may clear a site's storage.** The app asks the browser to keep
  its data; Settings, "Your data" says whether the browser agreed.

## 2. A package for the Play Store (optional, not built)

Only worth doing if the project wants a store listing. The app would be the same site, shown in a
Trusted Web Activity: Chrome without its interface, started from a small Android package. Nothing
about the game changes, and the key still never leaves the phone.

What it would take:

1. **A final address for the site.** The package is tied to one HTTPS origin.
2. **Bubblewrap**, Google's tool that turns a web manifest into an Android project
   (`npm i -g @bubblewrap/cli`, then `bubblewrap init --manifest https://<site>/manifest.webmanifest`
   and `bubblewrap build`). It needs a JDK and the Android SDK, which it can fetch itself.
3. **A signing key** for the package, kept by whoever publishes it. Losing it means never being able
   to update the listing.
4. **`assetlinks.json`** served at `https://<site>/.well-known/assetlinks.json`, naming the package
   and the fingerprint of its signing key. Without it Android shows the address bar. On GitHub Pages
   this file must be at the root of the *domain*, which a project page under
   `<owner>.github.io/<repository>/` cannot provide: a custom domain, or a user/organisation page, is
   needed for this route.
5. **A Play Console account** (a one-time fee, and an identity check), a listing, a privacy
   statement, and the store's content questionnaire. The honest answers: no data collected by the
   developer, no accounts, no ads; the app sends what the player writes to Anthropic's API under the
   player's own key.

Things to decide before taking this route:

- **The store's policy on generative AI apps** asks for a way to report offensive output. The app has
  none of its own: the narrator is the player's own Claude account. A report link to the project's
  issue tracker would be the minimum.
- **Payments.** The player pays Anthropic directly, outside the store. The app sells nothing, which
  keeps it clear of the store's billing rules, and the listing should say so plainly.
- **Who publishes.** A store listing has an owner who answers for it. For a non-profit open-source
  project, that is a person.

A wrapper that embeds its own browser engine (Capacitor, Cordova) is not recommended: it would have
a storage of its own, separate from the browser's, would not update with the site, and adds a native
build to maintain for nothing the Trusted Web Activity does not already give.
