---
title: Write sw.js with two caches, a navigation fallback, build stamping and term eviction
labels: pwa, ops, enhancement
milestone: Phase 3: App
estimate: M
order: 22
depends_on: pwa-manifest-and-icons, result-screen, room-index-and-current-json
---

The shell is about 60 KB that changes when Enes deploys. `rooms-<term>.json` is 27 to 33 KB gzipped that changes weekly and changes identity at term rollover. One cache and one strategy cannot serve both: a shell bumped on every deploy would re-download the room index for nothing, and a rarely bumped data cache would pin an installed icon to an old `app.js` forever.

### What to do

`sw.js` goes at the repo root so it serves from `/Vacant/sw.js`. A worker's scope is capped by its own location and Pages cannot send `Service-Worker-Allowed`, so root scope is impossible and `/Vacant/js/sw.js` would control nothing. Register it from `app.js`:

```js
navigator.serviceWorker.register('/Vacant/sw.js',
  { scope: '/Vacant/', updateViaCache: 'none' });
```

`updateViaCache: 'none'` is load-bearing. Pages sets `Cache-Control: max-age=600` on every asset including `sw.js` and gives no way to change it, so without it a frequently reloading user can read a cached worker script indefinitely.

```js
const SHELL_CACHE = 'vacant-shell-__BUILD_ID__';   // stamped at commit time
const DATA_CACHE  = 'vacant-data-v1';              // bump ~never
const SCOPE = '/Vacant/';
const SHELL_ASSETS = [SCOPE, SCOPE + 'index.html', SCOPE + 'app.css',
  SCOPE + 'app.js', SCOPE + 'manifest.webmanifest',
  SCOPE + 'apple-touch-icon.png', SCOPE + 'data/buildings.json'];
```

`/Vacant/` and `/Vacant/index.html` are the same bytes at two cache keys and a navigation can arrive as either, so precache both.

Three fetch paths:

- `request.mode === 'navigate'`: try `event.preloadResponse`, then network, and on any failure or 404 serve `index.html` from `SHELL_CACHE`. Pages returns a real 404 with no SPA fallback.
- Shell assets: cache-first, update in the background.
- `data/rooms-*.json`: stale-while-revalidate. Pages sends `ETag` and `Last-Modified`, so compare the revalidated response's `ETag` against the cached one. If it moved, `postMessage` to the page rather than swapping under a rendered list.

`install` precaches and does not call `skipWaiting()`. Add a `message` handler that calls it only on `SKIP_WAITING`, so a new worker never serves a new data shape to old page JS.

`activate` deletes every cache whose name is neither current, then deletes `DATA_CACHE` entries matching `rooms-*.json` whose term is not the one in `data/current.json`. Old term files stay on the server on rollover day; only the phone copy is evicted.

`app.js` never hardcodes a term. After first paint it reads `data/current.json` network-first with a cached fallback, so a student on a two-month-old shell still gets pointed at the right file.

### Done when

- [ ] `sw.js` is at the repo root, resolves at `https://enesyilmazcode.github.io/Vacant/sw.js` with HTTP 200, and is registered from `app.js` with `{ scope: '/Vacant/', updateViaCache: 'none' }`
- [ ] `SHELL_ASSETS` contains exactly `/Vacant/`, `/Vacant/index.html`, `app.css`, `app.js`, `manifest.webmanifest`, `apple-touch-icon.png` and `data/buildings.json`, each as a `/Vacant/`-prefixed absolute path
- [ ] Shell requests are served cache-first with a background update; `data/rooms-*.json` is stale-while-revalidate
- [ ] A navigation request to `/Vacant/does-not-exist` and a navigation with the network offline both render the cached shell, not a Pages 404 and not the browser offline page
- [ ] `install` contains no `skipWaiting()` call; a `message` listener calls it only when `event.data === 'SKIP_WAITING'`
- [ ] `sw.js` as authored contains `const SHELL_CACHE = 'vacant-shell-__BUILD_ID__'`, `scripts/stamp-sw.mjs` replaces the placeholder with `git rev-parse --short HEAD`, and the workflow that commits runs it before `git add`
- [ ] `tests/sw.test.js` fails if the committed `sw.js` contains the string `__BUILD_ID__`, and fails unless `SHELL_CACHE` matches `/^vacant-shell-[0-9a-f]{7,}$/`
- [ ] `tests/sw.test.js` asserts every `SHELL_ASSETS` entry starts with `/Vacant/` and that each named file exists on disk
- [ ] `DATA_CACHE` is a distinct constant; `activate` deletes every cache name that is neither `SHELL_CACHE` nor `DATA_CACHE`, and deletes `DATA_CACHE` entries for `rooms-*.json` whose term differs from `current.json`
- [ ] Grep for a term literal (`1268`) in `app.js` returns nothing; `current.json` is fetched network-first with a cached fallback and only after first paint
- [ ] When the revalidated `rooms-*.json` has a different `ETag`, the worker posts a message and the page shows a "schedule updated, tap to refresh" affordance; it re-runs the query silently only if the user has not interacted yet
- [ ] After one successful load, DevTools offline plus a reload renders a ranked list with zero network requests
- [ ] Verified by hand on a real iPhone: deploy twice and confirm the new `app.js` reaches an installed icon within two launches

### Notes

The stamp has a hole worth closing deliberately. A `GITHUB_TOKEN` push does not trigger `on: push` workflows, but branch-source Pages deploys on those same pushes, which is why the stamp lives in the harvest job rather than a deploy Action that would never run. The other half is that a human-pushed shell-only fix does not go through the harvest job at all, so `stamp-sw.mjs` has to run there too or the cache name keeps the previous SHA and installed icons keep the old `app.js`. The test is the backstop, not the mechanism.

A deploy is invisible for up to 10 minutes because of `max-age=600`, so the two-launch check needs a wait between deploys or it measures the wrong thing.

Storage quota is not worth designing around: Safari 17+ gives one origin up to 60% of disk. The shared `enesyilmazcode.github.io` origin is worth designing around. A future root-scoped worker on the portfolio would overlap `/Vacant/`; the most specific registration wins so Vacant's survives, but every `localStorage` key still needs the `vacant.` prefix to avoid colliding with Finder.
