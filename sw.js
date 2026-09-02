// Vacant's service worker. It exists for one student: the one standing outside a
// locked building on one bar of LTE who needs an answer now.
//
// Two caches, because the shell and the schedule change on different clocks. The
// shell is code and it changes when Enes deploys. The schedule is 39.1 KB
// gzipped, it changes weekly, and it changes its own filename at term rollover.
// One cache would either re-download the room index on every deploy or pin an
// installed icon to last month's app.js forever.
//
// Measured over the committed blobs, which is the copy Pages serves:
// `git show HEAD:<file> | gzip -9 -c | wc -c`. Shell 86,052 bytes, data 85,157.
// The shell figure was re-measured on gzip 1.12 when the fallback ladder's
// disclosure landed in js/app.js and js/engine.js; the data figure is the
// earlier one, on gzip 1.14. The data side more than doubled when the index started carrying
// which class is in the room: 2,024 course labels and one integer per block, so
// the room screen can draw a day instead of listing it. Running the same command over a Windows working tree gives a
// different answer, because git checks the text files out with CRLF. The first
// commit of this file guessed 32 and 30 KB without running anything, both were
// wrong; the correction then went stale by 758 bytes, and integrating the
// screens lane put it 34.3% out in one merge. scripts/test/sw.test.mjs
// recomputes both now.

// Stamped by scripts/stamp-sw.mjs before the commit lands. The authored
// placeholder is __BUILD_ID__, and a committed sw.js still carrying it means the
// stamp did not run. scripts/test/sw.test.mjs fails on exactly that. Spelled out
// rather than built from CACHE_PREFIX, because the stamper rewrites this line.
const SHELL_CACHE = 'vacant-shell-74f888c';
const DATA_CACHE = 'vacant-data-v1';

// CacheStorage is per origin, not per path, and enesyilmazcode.github.io also
// hosts Finder and the portfolio. Without this test the activate below deleted
// every cache on the origin that was not one of Vacant's two: measured, one
// deploy took finder-shell-v3 and portfolio-v1 with it and
// caches.match('/Finder/index.html') came back empty. The localStorage keys were
// namespaced for the same reason; the cache names were not.
const CACHE_PREFIX = 'vacant-';
function ours(name) {
  return name.startsWith(CACHE_PREFIX);
}

// A worker's scope cannot climb above its own URL, and GitHub Pages will not
// send Service-Worker-Allowed, so this file has to sit at the repo root and the
// scope is fixed at the project subpath. Capital V: Pages is case sensitive.
const SCOPE = '/Vacant/';
const DATA_PREFIX = SCOPE + 'data/';
const CURRENT = DATA_PREFIX + 'current.json';
const SHELL_DOC = SCOPE + 'index.html';

// `/Vacant/` and `/Vacant/index.html` are the same bytes at two cache keys and a
// navigation can arrive as either, so both are precached.
const SHELL_ASSETS = [
  SCOPE,
  SHELL_DOC,
  SCOPE + 'js/app.js',
  SCOPE + 'js/campus.js',
  SCOPE + 'js/engine.js',
  SCOPE + 'js/map.js',
  SCOPE + 'js/pwa.js',
  SCOPE + 'js/install.js',
  SCOPE + 'js/firstrun.js',
  SCOPE + 'manifest.webmanifest',
  SCOPE + 'apple-touch-icon.png',
  SCOPE + 'favicon.ico',
  SCOPE + 'icons/icon-192.png',
];

// Everything the first answer needs that is not code. These live in the data
// cache rather than the shell because campus.json alone is 37.9 KB gzipped and
// re-downloading it on every deploy is the waste this split exists to avoid.
const WARM_ALWAYS = ['data/campus.json', 'data/buildings-hours.json'];

self.addEventListener('install', (event) => {
  // No skipWaiting here, deliberately. A worker that takes over a live page can
  // hand a new data shape to page JS that was loaded to read the old one.
  event.waitUntil(
    (async () => {
      const shell = await caches.open(SHELL_CACHE);
      await shell.addAll(SHELL_ASSETS);
      // Best effort. The page has already fetched all of this, so it is a
      // conditional hit, and a first visit that loses the network before the
      // second one still has an answer.
      await warmTerm().catch(() => {});
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      if (self.registration.navigationPreload) {
        await self.registration.navigationPreload.enable().catch(() => {});
      }
      const names = await caches.keys();
      await Promise.all(
        names.filter((n) => ours(n) && n !== SHELL_CACHE && n !== DATA_CACHE).map((n) => caches.delete(n)),
      );
      await evictOldTerms();
      // Without this the first visit's own fetches never reach the worker, so
      // the term data lands in no cache until the second visit, and an install
      // followed by a dead network answers nothing.
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(SCOPE)) return;

  if (request.mode === 'navigate') {
    event.respondWith(navigate(event));
    return;
  }
  if (url.pathname.startsWith(DATA_PREFIX)) {
    // The term pointer is the one file that must never be stale: a two month old
    // shell reading a cached pointer would ask for last term's rooms by name. It
    // is 226 bytes.
    event.respondWith(
      url.pathname === CURRENT ? networkFirst(request) : staleWhileRevalidate(event, request),
    );
    return;
  }
  event.respondWith(cacheFirst(event, request));
});

// Pages has no SPA fallback, so a wrong path under /Vacant/ returns a real 404
// page. Offline, the browser returns its own. Both become the shell instead.
async function navigate(event) {
  const shell = await caches.open(SHELL_CACHE);
  try {
    const preload = await event.preloadResponse;
    const response = preload || (await fetch(event.request));
    if (response && response.ok) {
      const path = new URL(event.request.url).pathname;
      if (path === SCOPE || path === SHELL_DOC) await shell.put(SHELL_DOC, response.clone());
      return response;
    }
  } catch {
    // No network. Fall through to the cached shell.
  }
  return (await shell.match(SHELL_DOC)) || (await shell.match(SCOPE)) || Response.error();
}

async function cacheFirst(event, request) {
  const shell = await caches.open(SHELL_CACHE);
  const cached = await shell.match(request);
  const update = fetch(request)
    .then(async (response) => {
      if (response && response.ok) await shell.put(request, response.clone());
      return response;
    })
    .catch(() => null);
  if (cached) {
    event.waitUntil(update);
    return cached;
  }
  return (await update) || Response.error();
}

async function networkFirst(request) {
  const data = await caches.open(DATA_CACHE);
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      await data.put(request, response.clone());
      return response;
    }
  } catch {
    // No network. Fall through to the cached pointer.
  }
  // Except for a no-store request, which is the page asking whether the network
  // is there at all. js/firstrun.js sends exactly one of those, and answering it
  // from the cache turns the question into "is there a cache": measured with the
  // server killed, the probe came back 200 from here and the offline card never
  // rendered.
  if (request.cache === 'no-store') return Response.error();
  return (await data.match(request)) || Response.error();
}

async function staleWhileRevalidate(event, request) {
  const data = await caches.open(DATA_CACHE);
  const cached = await data.match(request);
  const update = fetch(request)
    .then(async (response) => {
      if (!response || !response.ok) return null;
      const moved = cached ? changed(cached, response) : false;
      await data.put(request, response.clone());
      if (moved) await announce(request.url);
      return response;
    })
    .catch(() => null);
  if (cached) {
    event.waitUntil(update);
    return cached;
  }
  return (await update) || Response.error();
}

// Only ever used to claim the file MOVED. A false alarm shows the user a refresh
// bar for nothing, so a header missing on either side means "say nothing" rather
// than "assume it changed", and a same-length rewrite is a miss rather than a
// lie. Pages sends ETag and Last-Modified. The local dev server answers chunked
// with none of the three, measured, so against it this correctly stays quiet and
// the refresh bar had to be verified against a server that sends them.
function changed(before, after) {
  for (const header of ['ETag', 'Last-Modified', 'Content-Length']) {
    const a = before.headers.get(header);
    const b = after.headers.get(header);
    if (a && b) return a !== b;
  }
  return false;
}

async function announce(url) {
  const windows = await self.clients.matchAll({ type: 'window' });
  for (const client of windows) client.postMessage({ type: 'vacant:data-updated', url });
}

async function warmTerm() {
  const data = await caches.open(DATA_CACHE);
  const response = await fetch(CURRENT, { cache: 'no-cache' });
  if (!response.ok) return;
  await data.put(CURRENT, response.clone());
  const current = await response.json();
  const files = [current.rooms, current.buildings, ...WARM_ALWAYS].filter(Boolean);
  await Promise.all(
    files.map(async (file) => {
      const url = SCOPE + String(file).replace(/^\//, '');
      const hit = await fetch(url);
      if (hit.ok) await data.put(url, hit);
    }),
  );
}

// Rollover day leaves last term's files on the server, which is right: a shared
// link to a room in a term that just ended should still resolve. What must not
// survive is the copy on the phone, taking space and sitting one bad code path
// away from being ranked as if it were current.
async function evictOldTerms() {
  const data = await caches.open(DATA_CACHE);
  const pointer = await data.match(CURRENT);
  if (!pointer) return;
  let term;
  try {
    term = (await pointer.json()).term;
  } catch {
    return;
  }
  if (!term) return;
  // Digits, not \w. A term is a four digit code, and `buildings-hours.json` is
  // not term keyed: \w matched it, captured "hours", compared that to "1268" and
  // evicted the Registrar's building hours on the first activate. Measured, the
  // app then booted from cache with no hours file and never reached ready.
  for (const request of await data.keys()) {
    const match = new URL(request.url).pathname.match(/\/data\/(?:rooms|buildings)-(\d+)\.json$/);
    if (match && match[1] !== String(term)) await data.delete(request);
  }
}
