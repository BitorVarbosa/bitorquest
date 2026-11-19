# Hosting Bitor Quest

Bitor Quest is static files. There is no server of ours: the page talks to the Claude API from the
player's browser, with the player's key. Anything that serves files over HTTPS can host it.

## Building

```bash
npm install
```

```bash
npm run build
```

The site is written to `dist/`. It is built with relative addresses (`base: './'`), so it works at
the root of a domain or under any path.

Before publishing a build:

```bash
npm test
```

```bash
node docs/mockups/_tools/offline.mjs
```

The second serves `dist/`, opens it in a headless browser, stops the server and loads the page again:
it fails if the installed app would not open without a network.

```bash
python docs/mockups/_tools/notices.py
```

rewrites `THIRD-PARTY-NOTICES.md` from what the build really contains. Run it when a dependency changes.

## What a host must do

- **Serve over HTTPS.** Installing the app, keeping it for offline use and the browser's storage
  promises all need a secure address. (`localhost` counts as one, for development.)
- **Serve `sw.js` without long caching.** It is the one file whose name does not change between
  versions. Every other file under `assets/` carries a hash of its contents in its name and can be
  cached for ever. Most static hosts already treat an unhashed file this way.
- **Nothing else.** No rewrites (the app's screens live after the `#` in the address), no headers
  (the content policy is in the page itself), no environment.

## What the page is allowed to do

The built page carries a content security policy that allows it to load its own files and to talk to
`https://api.anthropic.com`, and nothing else: no third-party scripts, fonts, images or analytics. If
you host a changed build that needs another address, the policy is in `vite.config.ts`.

## GitHub Pages

`.github/workflows/pages.yml` builds the site, runs the tests and publishes `dist/` to GitHub Pages
on every push to `main`. It does nothing until the repository exists on GitHub with Pages set to
"GitHub Actions" as its source (Settings, Pages). The address will be
`https://<owner>.github.io/<repository>/`, or `https://<custom domain>/<repository>/` when the
owner's `<owner>.github.io` site has a custom domain.

The page asks search engines not to list it (`<meta name="robots" content="noindex">` in
`index.html`), so that a test site is found only by those given its address. Take that line out when
the site should be found.

## A new version reaching players

A player who has the app open or installed keeps the version they have until the browser has fetched
the new one in the background. Then Settings, "About", shows **A new version is ready** with a button
to reload. Stories, worlds, settings and the key are in the browser's storage and are not touched by
an update.

Stories and worlds belong to the address they were made at. A player who moves from one address to
another (from a test site to the final one, say) carries them over by exporting and importing.
