# Vacant: installable PWA architecture, designed to iOS Safari

Research note, written 2026-08-26. Every number below is either from a command I
ran (shown inline) or from a source I link. Version-dependent claims are tagged
`[v]` and collected in a table at the bottom.

**Baseline versions at time of writing:** iOS/iPadOS **26.6**, released
2026-07-27, with 26.6.1 in beta as of 2026-08-10. iOS 27 ships around
September 2026, so Vacant will launch into 26.x and cross into 27.x mid-semester.
Design for 26, sanity-check on 27 betas in September.
([MacRumors](https://www.macrumors.com/2026/08/10/apple-releases-ios-26-6-1/))

---

## The seven decisions, up front

1. **Manifest:** ship `manifest.webmanifest` with `display: "standalone"`, an
   absolute-path `start_url` and `scope` of `/Vacant/`, and PNG icons. Keep the
   `apple-touch-icon` link tag anyway, because it still overrides manifest icons
   on iOS and it is still the only way to get a splash screen.
2. **Install:** iOS cannot prompt. There is no `beforeinstallprompt` in Safari,
   in any version, including 26.6. You must draw your own hint, and on iOS 26 the
   default Safari layout **hides the Share button behind a `...` button**, so the
   classic "tap Share" copy is now wrong for most users.
3. **Service worker:** cache-first for the shell, stale-while-revalidate for
   `rooms-<term>.json`. Term rollout is handled by the filename, not by cache
   invalidation, which is the whole point of putting the term in the name.
4. **Storage eviction:** effectively a non-issue for an *installed* Vacant, and a
   real issue for an uninstalled one. The 7-day ITP counter is "7 days of use of
   that web app", and every use resets it to zero. A once-a-week student never
   trips it. Plan for eviction anyway, because disk pressure and "Clear History"
   still exist.
5. **Geolocation:** never call it on page load. Call it from a tap, wrap it in
   your own wall-clock watchdog because the iOS `timeout` option is not reliable
   in standalone mode, and keep a last-known-location fallback.
6. **GitHub Pages:** paths are case-sensitive and `/Vacant/` is capital-V. Pages
   sets `Cache-Control: max-age=600` on everything, including `sw.js`, which you
   cannot change. Both of those are load-bearing.
7. **Custom domain:** yes, but **buy and wire it before the first user installs**.
   Adding it later orphans every install, every cache, and every service worker
   registration, silently.

---

## 0. What already exists (measured)

Finder, the sibling project, has **no manifest and no service worker**. Vacant is
greenfield on the PWA side, and there is nothing to port.

```
$ find . -iname "*manifest*" -not -path "./.git/*"   # in Projects/Finder
(no output)
$ find . -iname "*sw*.js" -not -path "./.git/*"
(no output)
```

Finder does ship a correct `apple-touch-icon.png`:

```
$ python -X utf8 -c "import struct; d=open('apple-touch-icon.png','rb').read(); print(len(d),'bytes'); print(struct.unpack('>II', d[16:24]))"
495 bytes
(180, 180)
```

180x180 is the right size. Copy the pipeline, not the art.

Vacant's Pages site is **not enabled yet**:

```
$ curl -sS -o /dev/null -w "%{http_code}\n" https://enesyilmazcode.github.io/Vacant/
404
```

---

## 1. The manifest

### What iOS actually reads

Per [firt.dev's iOS PWA compatibility table](https://firt.dev/notes/pwa-ios/),
which is the reference everyone else copies from:

| Member | iOS status |
| --- | --- |
| `name` | honored, since iOS 11.3 |
| `short_name` | honored, since iOS 11.3 |
| `start_url` | honored, since iOS 11.3 |
| `scope` | honored, since iOS 11.3 |
| `display` | honored, since iOS 11.3, but only `browser` and `standalone` |
| `theme_color` | honored, since iOS 15.0 |
| `icons` | honored, since iOS 15.4, **but `apple-touch-icon` overrides it** |
| `background_color` | **ignored** |
| `orientation` | **ignored** |
| `shortcuts` | **ignored** |
| `dir`, `lang`, `related_applications`, `prefer_related_applications` | **ignored** |

That `background_color` is ignored is the one that catches people. It does not
paint the splash screen on iOS, and it does not paint the standalone window
background. Set it anyway for Android, and get the iOS equivalent from CSS on
`html`/`body` plus a real startup image if you want one.

`orientation` being ignored means Vacant cannot lock to portrait on iPhone. The
layout has to survive landscape. For a single ranked list that is easy, but it is
a CSS requirement, not an optional nicety.

`display: "fullscreen"` and `"minimal-ui"` are not supported. Use `standalone`.

### iOS 26 changed installability

As of Safari 26 there are, in Apple's words, "**zero requirements for
'installability'**". Every site added to the Home Screen opens as a web app by
default, manifest or not, and the user gets an **"Open as Web App"** toggle in the
Add sheet to opt out.
([WebKit Features in Safari 26.0](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/))

This does not make the manifest pointless. Apple is explicit: "If you include a
Web Application Manifest with your site, the benefits it provides will be part of
the user's experience. If you define your icons in the manifest, they're used."
The manifest is what gives you the right name under the icon, the right start URL,
and a scope. Without it, iOS 26 will still open a web app, but with the page title
as the name and the current URL as the start URL, which for Vacant would mean the
app launches into whatever screen the user happened to be on. `[v: iOS 26+]`

### The file

Name it `manifest.webmanifest`. **Measured:** GitHub Pages serves that extension
with the spec-correct MIME type, and serves `manifest.json` as plain
`application/json`. Both work in every browser, but `.webmanifest` is free
correctness.

```
$ curl -sSI https://tjukanovt.github.io/30DayMapChallenge/manifest.webmanifest
HTTP/1.1 200 OK
Content-Type: application/manifest+json; charset=utf-8

$ curl -sSI https://googlechrome.github.io/samples/web-application-manifest/manifest.json
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8
```

`/Vacant/manifest.webmanifest`:

```json
{
  "id": "/Vacant/",
  "name": "Vacant",
  "short_name": "Vacant",
  "description": "Find an empty classroom near you, free for as long as you need it.",
  "start_url": "/Vacant/",
  "scope": "/Vacant/",
  "display": "standalone",
  "display_override": ["standalone", "minimal-ui", "browser"],
  "orientation": "any",
  "theme_color": "#1a1a1a",
  "background_color": "#1a1a1a",
  "categories": ["education", "utilities", "navigation"],
  "lang": "en-US",
  "dir": "ltr",
  "icons": [
    { "src": "/Vacant/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/Vacant/icons/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/Vacant/icons/icon-192-maskable.png", "sizes": "192x192", "type": "image/png", "purpose": "maskable" },
    { "src": "/Vacant/icons/icon-512-maskable.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

Notes on specific fields:

- `id` is not read by iOS but it pins the app identity on Android across
  `start_url` changes. Cheap insurance. Set it to the same value as `scope`.
- `orientation: "any"` is honest. iOS ignores it; writing `"portrait"` would be a
  lie that Android obeys and iPhone does not, which produces exactly the kind of
  inconsistency that is hard to debug on a device you do not have.
- `theme_color` and `background_color` are the same value on purpose. Vacant opens
  in one paint, and a mismatched background flashes.
- `display_override` costs nothing and is ignored by iOS.
- **Do not** use SVG icons, and **do not** rely on `maskable` on iOS. iOS supports
  neither. The maskable entries above are for Android only.

### Icon sizes iOS actually uses

iOS reads exactly **one** raster size for the home screen icon in practice:
**180x180 PNG** via `<link rel="apple-touch-icon">`. It will downscale that to
whatever the device needs. Since iOS 15.4 it will also read manifest `icons`, but
if the `apple-touch-icon` link is present it wins. So ship both and make them the
same artwork.

Rules for the `apple-touch-icon.png`:

- **Opaque.** No alpha. iOS composites transparency onto black and it looks broken.
- **Square, full-bleed, no rounded corners.** iOS applies its own mask. If you
  pre-round it you get a rounded square inside a rounded square.
- **No safe-zone padding.** That is a maskable-icon concept and iOS does not
  implement maskable, so padding just makes your icon look small next to native
  apps.

Minimum icon set to ship:

```
/Vacant/apple-touch-icon.png        180x180  opaque PNG   (iOS home screen)
/Vacant/icons/icon-192.png          192x192  PNG          (Android)
/Vacant/icons/icon-512.png          512x512  PNG          (Android splash, listings)
/Vacant/icons/icon-192-maskable.png 192x192  PNG, padded  (Android adaptive)
/Vacant/icons/icon-512-maskable.png 512x512  PNG, padded  (Android adaptive)
/Vacant/favicon.svg                 vector                (desktop tabs)
```

### The head tags

```html
<meta name="viewport"
      content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#1a1a1a">

<link rel="manifest" href="/Vacant/manifest.webmanifest">
<link rel="apple-touch-icon" href="/Vacant/apple-touch-icon.png">
<link rel="icon" href="/Vacant/favicon.svg" type="image/svg+xml">

<!-- Legacy, still not dead. See below. -->
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Vacant">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
```

**Why keep `apple-mobile-web-app-capable` in 2026 when everyone says it is
deprecated.** Two reasons, and only two:

1. **Splash screens.** `apple-touch-startup-image` only works when
   `apple-mobile-web-app-capable` is present. There is no manifest replacement on
   iOS, because `background_color` is ignored. If you ever want a startup image,
   the meta tag has to be there.
2. **Old iOS.** Anyone still on iOS 15 or earlier needs it to get standalone mode
   at all.

If Vacant ships no startup images and targets iOS 16+, the tag is genuinely
optional. It is three bytes of risk to keep and it costs a Lighthouse warning.
My call: **keep it**, because a college campus has a long tail of old hand-me-down
iPhones and the warning is cosmetic.

`apple-mobile-web-app-title` is worth keeping regardless. It controls the label
under the icon on older iOS where `short_name` is not read.

`viewport-fit=cover` plus `black-translucent` gets you a full-bleed standalone
window on notched iPhones. It also means you must use `env(safe-area-inset-*)` in
CSS or your top row hides under the clock. Budget for that.

### Splash screens: skip them

iOS needs roughly **15 separate `apple-touch-startup-image` PNGs** to cover every
current iPhone resolution and orientation, and the set breaks every time Apple
ships a new screen size. Without them iOS generates a splash from the icon on a
plain background, which is fine for an app whose whole promise is opening
instantly. If Vacant genuinely paints in under 200 ms from cache, nobody sees the
splash long enough to judge it. Revisit only if real users complain about a white
flash.

---

## 2. Install: iOS cannot prompt, so you draw the hint

### There is no install prompt on iOS. Period.

Safari does not implement `beforeinstallprompt`, on any iOS version, including
26.6. There is an [open Apple developer forums
request](https://developer.apple.com/forums/thread/807603) for it. Ignore any
blog post claiming iOS 16.4 added it, that is wrong and it propagates a lot.
Every iOS install is a manual Share > Add to Home Screen.

### The iOS 26 wrinkle that breaks every existing tutorial

In iOS 26, Safari's default tab layout is **Compact**, and in Compact the Share
button is **not visible**. The user must tap the `...` button next to the URL bar
first, then Share, then Add to Home Screen. Users can change this in
**Settings > Safari > Tabs**, where **Bottom** and **Top** both keep Share
visible. `[v: iOS 26+]`
([9to5Mac](https://9to5mac.com/2025/09/15/iphone-ios-26-safari-new-compact-design/),
[MacRumors how-to](https://www.macrumors.com/how-to/save-safari-bookmark-web-app-iphone-home-screen/))

You cannot detect which layout the user picked. So the hint copy has to cover
both without being a wall of text:

> **Keep Vacant on your home screen.**
> Tap **Share** (or **`...`** then **Share**), then **Add to Home Screen**.

Then, on iOS 26, the Add sheet shows an **"Open as Web App"** toggle. It defaults
on. Do not mention it. Mentioning it makes people look for it, find it, and
wonder if they should turn it off.

### Detecting iOS Safari

```js
function isIOS() {
  // iPadOS 13+ reports as Macintosh. The touch-point check separates them.
  return /iPad|iPhone|iPod/.test(navigator.platform)
      || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
      || /iPad|iPhone|iPod/.test(navigator.userAgent);
}

function isIOSSafari() {
  if (!isIOS()) return false;
  const ua = navigator.userAgent;
  // Every iOS browser is WebKit, but only Safari can Add to Home Screen.
  // Chrome=CriOS, Firefox=FxiOS, Edge=EdgiOS, and in-app webviews
  // (Instagram, Discord, Snapchat) show no Version/ token.
  const isOtherBrowser = /CriOS|FxiOS|EdgiOS|OPiOS|mercury/i.test(ua);
  const looksLikeSafari = /Safari/.test(ua) && /Version\//.test(ua);
  return looksLikeSafari && !isOtherBrowser;
}
```

The in-app-webview case matters more than the alternate-browser case. A student
who taps a Vacant link inside Instagram or a Discord server gets a webview that
**cannot** Add to Home Screen. Showing them the hint is pure frustration. Detect
it and show "Open in Safari to install" instead.

### Detecting that it is already installed

```js
function isStandalone() {
  return window.navigator.standalone === true                       // iOS, non-standard
      || window.matchMedia('(display-mode: standalone)').matches    // everyone else
      || window.matchMedia('(display-mode: fullscreen)').matches
      || document.referrer.startsWith('android-app://');            // TWA
}
```

`navigator.standalone` is Safari-only and non-standard, and it is still the iOS
answer in 26.6. Check it first. Note the iOS 26 nuance: since every home-screen
add opens as a web app by default, `navigator.standalone` will be `true` even for
a site the user thought they were bookmarking. That is fine for Vacant.

### The thing that makes anti-nagging hard, and the design that survives it

**On iOS, each installed home-screen icon gets its own storage jar, isolated from
Safari and from every other icon of the same site.** Confirmed by
[web.dev's detection guide](https://web.dev/learn/pwa/detection) and by the
[WebKit storage policy](https://webkit.org/blog/14403/updates-to-storage-policy/)
language about home-screen web apps having "their own counter of days of use".

Three consequences, all of which shape the code:

1. **A Safari tab can never learn that the user installed.** There is no API.
   `getInstalledRelatedApps()` is Chrome-only and only reports *native* apps
   anyway. So the anti-nag state has to live in the Safari jar and be driven by
   the user, not by ground truth.
2. **The installed app starts empty.** All the caching the user's Safari tab did
   while they read the install hint is in the wrong jar. First standalone launch
   is a cold launch and needs the network. See section 4 for the design.
3. **You cannot hand off state at install time.** No "you were logged in", no
   "here is the location you already granted". Vacant has no login and that is
   part of why this architecture works, but it does mean the geolocation
   permission has to be granted a second time inside the installed app.

Given all that, the anti-nag rules:

```js
const HINT_KEY = 'vacant.installHint.v1';

function shouldShowInstallHint() {
  if (isStandalone()) return false;         // already in the app, obviously not
  if (!isIOSSafari()) return false;         // Android gets the real prompt
  let s;
  try { s = JSON.parse(localStorage.getItem(HINT_KEY) || '{}'); } catch { s = {}; }
  if (s.dismissed) return false;            // they said no. never ask again.
  if ((s.sessions || 0) < 2) return false;  // earn it: not on first visit
  if (s.lastShown && Date.now() - s.lastShown < 7 * 864e5) return false;
  return true;
}
```

The rules that matter, in order of how much they protect the user:

- **Never on the first visit.** Someone who just landed has no idea what Vacant
  is. Wait until they have gotten one useful answer out of it. Gate on
  `sessions >= 2`, or better, gate on "has successfully seen a ranked room list
  at least once". Earning the ask is the whole trick.
- **Never on page load.** Show it after a result renders, as a dismissible bar at
  the bottom, not a modal. A modal on cold start costs you the one tap that is the
  entire product thesis.
- **`dismissed` is permanent.** One X tap, never again on that device. Do not do
  the "ask again in 30 days" thing. A student who dismissed it and then installed
  anyway has no way to tell you, and re-nagging an installed user through their
  Safari tab is the single most annoying failure mode available here.
- **Rate-limit the non-dismissals to 7 days.** Someone who ignores it rather than
  dismissing it gets it again next week, at most.
- **Version the key.** `v1` in the name means a future redesign can reset the
  population deliberately rather than by accident.

`try/catch` around `localStorage` is not paranoia. It throws outright in Private
Browsing on some WebKit builds, and Vacant must not white-screen because of an
install hint.

### Android, for free

Android Chrome fires `beforeinstallprompt`. Capture it, suppress the mini-infobar,
and wire it to the same bar the iOS users see:

```js
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  showInstallBar({ mode: 'prompt' });
});
window.addEventListener('appinstalled', () => {
  deferredPrompt = null;
  hideInstallBar();
  markDismissedForever();
});
```

`appinstalled` fires on Android and gives you the ground truth iOS refuses to.

---

## 3. Service worker

### The shape of the problem

Vacant caches two very different things:

- **The shell.** `index.html`, one CSS file, one JS file, icons, and
  `buildings.json`. All of it changes only when Enes deploys. Total maybe 60 KB.
- **The data.** `rooms-1268.json`. Changes weekly during a term. Changes
  identity entirely at term rollover.

**Measured size expectation.** Finder's largest data file gzips to 24.6% of raw:

```
$ curl -sS -o /dev/null -H "Accept-Encoding: gzip" -w "%{size_download}\n" \
    https://enesyilmazcode.github.io/Finder/data/seats-1268.json
83023
$ ls -la data/seats-1268.json   ->  336984 bytes
$ python -X utf8 -c "print(round(83023/336984*100,1))"
24.6
```

So the README's "~100 KB gzipped" for `rooms-1268.json` is a reasonable estimate
for a file of a few hundred KB raw. This comfortably fits Cache API. Storage
quota is not a constraint here at all: Safari 17+ gives a browser origin up to
**60% of disk** for one origin and 80% overall, and a home-screen web app gets the
same quota as the browser.
([WebKit](https://webkit.org/blog/14403/updates-to-storage-policy/))

### Recommended strategy

**Shell: cache-first, with a background update.** Correct, because the shell is
versioned by the cache name and a stale shell is still a working shell.

**`rooms-<term>.json`: stale-while-revalidate.** Correct, and here is the
argument for it over the alternatives:

- *Network-first* would be wrong. It costs a network round trip on every cold
  start, which on a campus wifi handoff outside a building is exactly where the
  latency spike lives. Vacant's promise is that it opens instantly.
- *Cache-only* would be wrong. The file does change weekly, courses get cancelled
  and rooms get reassigned in the first two weeks of a term, and a student running
  a three-week-old grid gets sent to a room that now has a class in it.
- *Stale-while-revalidate* serves the cached copy immediately and updates in the
  background. The user gets an answer in one paint and next launch is fresh. The
  only cost is that a schedule correction takes two launches to reach them, which
  for a weekly-rebuild dataset is nothing.

One refinement worth building: when the background revalidate lands a **different**
file, do not silently swap it under a rendered list. Post a message to the page
and let it show a small "schedule updated, tap to refresh" affordance, or just
re-run the query silently if the user has not interacted yet. Rewriting a ranked
list under someone's thumb while they are reading it is how you send them to the
wrong building.

### Cache versioning scheme

Two caches, versioned independently, because they change on completely different
schedules:

```js
const SHELL_CACHE = 'vacant-shell-v7';     // bump on every deploy
const DATA_CACHE  = 'vacant-data-v1';      // bump ~never
const SCOPE = '/Vacant/';

const SHELL_ASSETS = [
  SCOPE,                       // note: the directory, which is index.html
  SCOPE + 'index.html',
  SCOPE + 'app.css',
  SCOPE + 'app.js',
  SCOPE + 'manifest.webmanifest',
  SCOPE + 'apple-touch-icon.png',
  SCOPE + 'data/buildings.json',
];
```

Bump `SHELL_CACHE` on every deploy. The build step should stamp it from the git
short SHA so it is impossible to forget:

```js
const SHELL_CACHE = 'vacant-shell-__BUILD_ID__';   // replaced at build time
```

Activate deletes anything that is not one of the two current names:

```js
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = new Set([SHELL_CACHE, DATA_CACHE]);
    const names = await caches.keys();
    await Promise.all(names.filter(n => !keep.has(n)).map(n => caches.delete(n)));
    if (self.registration.navigationPreload) {
      await self.registration.navigationPreload.enable();
    }
    await self.clients.claim();
  })());
});
```

### Term rollout: the filename does the work

This is the part worth getting right, and it is easier than it looks because of
one decision already made in the README: **the term is in the filename.**

`rooms-1268.json` (Autumn 2026) and `rooms-1272.json` (Spring 2027) are different
URLs. So a term rollover is not a cache invalidation problem at all, it is a
cache-miss problem, which service workers already handle.

The rollout sequence:

1. Harvester emits `rooms-1272.json` alongside the existing `rooms-1268.json`.
   **Both stay on the server.** Never delete the old one on rollover day.
2. The shell's `app.js` learns the new term. Since `app.js` is part of the shell
   and the shell cache name is bumped every deploy, the new `app.js` reaches
   everyone on their next launch with signal.
3. New `app.js` requests `rooms-1272.json`. Cache miss, fetches it, caches it,
   done. The stale-while-revalidate handler needs no special case.
4. In the `activate` handler, evict data entries whose term is not the current
   one, so `rooms-1268.json` does not sit on the phone forever.

Do not hardcode the term in `app.js` as a literal. Put it in a tiny
`data/current.json` that the shell fetches network-first with a cached fallback:

```json
{ "term": "1268", "generated": "2026-08-26", "rooms": "data/rooms-1268.json" }
```

This is a few hundred bytes and it decouples "which term is live" from "which
shell version you have". A student on a two-month-old shell who opens Vacant on
the first day of spring semester still gets pointed at the right data file,
because `current.json` is checked over the network when there is network. When
there is not, they fall back to the cached term, which is the correct degradation.

The one thing `current.json` must never do is block first paint. Fetch it after
the app has already rendered from cache.

### Registration, and the GitHub Pages caching trap

```js
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/Vacant/sw.js', {
      scope: '/Vacant/',
      updateViaCache: 'none'     // this line is not optional. see below.
    });
  });
}
```

**Measured:** GitHub Pages puts `Cache-Control: max-age=600` on everything and
gives you no way to change it.

```
$ curl -sSI https://enesyilmazcode.github.io/Finder/js/api.js | grep -i cache-control
Cache-Control: max-age=600
$ curl -sSI https://enesyilmazcode.github.io/Finder/data/seats-1268.json | grep -i cache-control
Cache-Control: max-age=600
$ curl -sSI https://enesyilmazcode.github.io/Finder/ | grep -i -E "cache-control|expires"
expires: Wed, 26 Aug 2026 19:19:27 GMT
Cache-Control: max-age=600
```

Without `updateViaCache: 'none'`, the browser fetches `sw.js` through the HTTP
cache. On Pages that means a 10 minute window where the update check reads a
cached copy, and each check that hits the cache can extend it. A user who reloads
often can stay on an old worker indefinitely. Chrome 68+ ignores the HTTP cache
for the worker script by default, but Safari's behavior is less documented and
`updateViaCache: 'none'` makes it explicit everywhere. The 24-hour hard cap that
browsers apply to `max-age` on worker scripts is a backstop, not a plan.
([Chrome for Developers](https://developer.chrome.com/blog/fresher-sw))

### Do not use `skipWaiting()` blindly

`self.skipWaiting()` in `install` swaps the worker under a running page. For an
app whose JS and cached shell must agree on the data format, that is how you get a
new worker serving a new `rooms-*.json` shape to old page JS. Vacant's data format
is simple enough that it will probably survive, but the failure is silent and
happens on someone's phone outside a building.

Safer:

```js
// sw.js
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL_CACHE).then(c => c.addAll(SHELL_ASSETS)));
  // no skipWaiting
});
self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});
```

The page detects a waiting worker, shows a quiet "update ready" affordance, and
posts `SKIP_WAITING` when the user taps. Or, since Vacant is a one-screen app with
no in-progress state to lose, it can just skip-waiting on the *next cold start*
rather than mid-session. Either is fine. Skipping mid-session is the one to avoid.

### Navigation fallback

Pages returns a real 404 for unknown paths, not an SPA fallback:

```
$ curl -sS -o /dev/null -w "%{http_code}\n" https://enesyilmazcode.github.io/Finder/does-not-exist-xyz
404
```

So the service worker should catch navigation requests and serve the cached shell:

```js
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const preload = await event.preloadResponse;
        if (preload) return preload;
        return await fetch(request);
      } catch {
        const cache = await caches.open(SHELL_CACHE);
        return (await cache.match(SCOPE + 'index.html'))
            || (await cache.match(SCOPE))
            || Response.error();
      }
    })());
    return;
  }
  // ... shell cache-first, data stale-while-revalidate
});
```

This is what makes the app answer with the network off.

---

## 4. iOS storage eviction

### The rule, stated precisely

WebKit's Intelligent Tracking Prevention removes all script-writable storage for
an origin after **7 days of browser use without a user interaction with that
site**. "7 days of browser use" is not 7 calendar days. It counts days the user
actually used the browser, so a user who does not open Safari for two weeks has
not burned any of the 7.

Affected: `localStorage`, `sessionStorage`, IndexedDB, **Cache API**, **service
worker registrations**, and File System. Not affected: cookies, HTTP cache.
([WebKit storage policy](https://webkit.org/blog/14403/updates-to-storage-policy/))

### Why this is nearly a non-issue for an installed Vacant

**A home-screen web app is not part of Safari and keeps its own counter of days of
use, and that counter only advances on days the app is actually used.** Any
meaningful interaction resets it to zero.

Work through the actual scenario: a student opens Vacant once a week, taps a
duration chip, reads the list. That tap is a first-party user interaction, so the
counter resets to 0 on every single use. To trip the 7-day rule the student would
have to *open the app on 7 separate days and never touch it*, which is not a thing
that happens. **The once-a-week student is safe.** `[v: current WebKit ITP policy]`

What *does* still evict an installed Vacant:

1. **Device storage pressure.** WebKit evicts by origin when the disk fills.
   Nothing you can do, and a full iPhone is common on a student device.
2. **Settings > Safari > Clear History and Website Data.** Nukes everything,
   including home-screen app storage on the same origin.
3. **Deleting and re-adding the icon.** New jar, empty cache.
4. **A shared-origin neighbor filling the quota.** See section 6. Every one of
   Enes's GitHub Pages projects lives on `enesyilmazcode.github.io` and shares one
   origin quota.

And the uninstalled case is genuinely exposed: a student who visits Vacant in a
Safari tab and does not install **is** subject to the normal 7-days-of-browser-use
rule, and their cache will vanish. That is one more reason the install hint is
worth building well.

### Request persistent storage anyway

WebKit grants `StorageManager.persist()` "based on heuristics like whether the
website is opened as a Home Screen Web App", and persistent-mode origins are
excluded from eviction. It costs three lines:

```js
async function requestPersistence() {
  if (!navigator.storage?.persist) return null;
  try {
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch { return null; }
}
```

Call it **after** the first successful result render, not on load, and never
branch UI on the answer. It is a hint, not a contract.

### The graceful path when the cache is gone and there is no signal

This is the scenario that decides whether Vacant feels reliable, and it is also
the **first launch after install**, because of the separate-storage-jar rule in
section 2. First standalone launch is always a cold launch. Treat "cold and
offline" as a first-class state, not an error page.

Three-tier degradation, from best to worst:

**Tier 1: data cached, any network state.** Normal operation. Render from cache
immediately, revalidate in the background.

**Tier 2: no cached data, network available.** Show the shell with a real skeleton
and a one-line status, "getting this term's schedule". Do not show a spinner with
no text. The download is ~100 KB gzipped; on campus wifi that is well under a
second, on bad LTE it might be three. Kick off the geolocation request in parallel
with the fetch so the two latencies overlap instead of stacking.

**Tier 3: no cached data, no network.** This is the honest-failure case and it
deserves real copy, not a broken icon:

> **Vacant needs to download this term's schedule once.**
> It is about 100 KB and then it works offline forever.
> Connect to wifi or step outside and pull down to retry.

Plus three things that make it not a dead end:

- **A retry button.** Not just pull-to-refresh, which is not discoverable in a
  standalone window with no browser chrome.
- **An automatic retry on `online`.** `window.addEventListener('online', ...)`.
  A student walking out of a basement gets their answer without touching anything.
- **A `visibilitychange` retry.** iOS aggressively freezes backgrounded web apps,
  and `online` may not fire while frozen. Re-check on resume.

```js
window.addEventListener('online', tryLoadData);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !haveData) tryLoadData();
});
```

**The mitigation worth building:** prefetch the data file during the install hint,
in the Safari tab, *before* the user installs. It will not survive into the
installed app's jar, but it warms the **HTTP cache**, which on iOS is shared and
is *not* subject to ITP eviction. The installed app's first fetch then likely hits
a 304 or a local HTTP cache entry instead of a full download. This is a real,
cheap win and it is not obvious.

---

## 5. Geolocation in a standalone iOS PWA

This is the riskiest section for Vacant, because geolocation *is* the product, and
iOS standalone mode has the worst-documented geolocation behavior of any target.

### Does the permission persist across launches?

**Not reliably.** The widely reported iOS behavior is that geolocation permission
must be granted per session in a PWA, and there are long-standing reports of the
prompt reappearing after a reload even after granting.
([Apple forums 729516](https://developer.apple.com/forums/thread/729516),
[751189](https://developer.apple.com/forums/thread/751189))

Practical read: **assume you will be asked again**, design so that being asked
again is cheap, and never build a flow that depends on a remembered grant.

### Two open iOS bugs you must design around

**Bug 1: the permission alert can fail to appear in standalone mode, and the call
never times out.** Reported on
[Apple forums thread 694999](https://developer.apple.com/forums/thread/694999),
originally on iOS 15.1.1, re-reported in Mar 2022, Nov 2022, and Jun 2023 with no
fix and no Apple reply. The reporter's words:

> "when added to the Home Screen and running with a display mode of 'standalone',
> the location alert does not open on my phone... **And the call never times out.**
> Then if I switch from the PWA to Safari the location alert / prompt is suddenly
> showing in Safari. So it seems that the alert is targeting the wrong 'tab'."

The behavior table from that thread: `standalone` fails, `browser` works,
`minimal-ui` works.

**Bug 2, and this one is fresh: iOS 26 may return PERMISSION_DENIED in installed
PWAs.** [Apple forums thread 804381](https://developer.apple.com/forums/thread/804381),
filed against **iOS 26.0.1** on an iPhone 17 Pro by the developer of the FindMeSAR
PWA:

> "When this PWA is *not* installed on my iPhone then I can use Safari to open
> this webpage and give permission for it to use my location... But if I install
> FindMeSAR for use offline as a PWA then I get an error message saying location
> is denied."

Zero replies. No workaround. **Unresolved.** `[v: iOS 26.0.1, possibly fixed in
26.x, must be retested]`

**This is the single highest-priority thing to verify on a real iPhone before
building anything else.** If installed-PWA geolocation is broken on current iOS,
Vacant's entire premise is at risk and the fallback chain below stops being a
nicety and becomes the main path. Test on 26.6, and test again on 27 in September.
Spend thirty minutes on this before spending a week on the harvester.

### Permission state without prompting

Contrary to a lot of blog posts, **Safari does support the Permissions API for
geolocation**, since Safari and Safari on iOS **16.0**, with 95.68% global support.
([caniuse](https://caniuse.com/mdn-api_permissions_permission_geolocation))

```js
async function locationPermissionState() {
  try {
    if (!navigator.permissions?.query) return 'unknown';
    const s = await navigator.permissions.query({ name: 'geolocation' });
    return s.state;            // 'granted' | 'prompt' | 'denied'
  } catch { return 'unknown'; }
}
```

Use it **only as a positive signal**: if it returns `'granted'`, fire
`getCurrentPosition` immediately on load without waiting for a tap, because there
is no prompt to trigger. Treat `'prompt'` and `'denied'` with suspicion, since
there are documented cases of Safari's reported permission state disagreeing with
the actual Safari setting
([thread 731412](https://developer.apple.com/forums/thread/731412)). Never show a
"location denied" screen based on `'denied'` alone. Make the actual call and let
the real error decide.

### Accuracy, and what to expect on campus

- `enableHighAccuracy: false` uses wifi and cell positioning. On a dense campus
  like OSU Columbus, with wifi APs in every building, that is typically **20 to 100
  metres**. Fast, often sub-second when warm.
- `enableHighAccuracy: true` engages GPS. Better outdoors, **5 to 20 metres**, but
  the first cold fix can take **10 to 30 seconds**, and there are reports on iOS of
  high-accuracy calls returning only when the timeout fires rather than when a fix
  lands.
- **Indoors**, GPS is often unavailable entirely and you fall back to wifi
  positioning, which on a wifi-dense campus is actually *good*, frequently better
  than 50 m.

**What accuracy does Vacant actually need?** It ranks buildings by haversine
distance to a building centroid and converts to walk time at 80 m/min. A 100 m
error is 1.25 minutes of walk time. Adjacent buildings on the Oval are 50 to 150 m
apart, so a 100 m error can swap the order of the top two results. It cannot send
you across campus. **`enableHighAccuracy: false` is the right default**: the
ranking survives the error it produces, and speed matters more than metres
when the whole promise is one tap to an answer.

Offer high accuracy as a "refine" only if a user complains the top result is wrong,
and never as the first call.

### The call, with a watchdog

Because of Bug 1, **do not trust the `timeout` option to be your only timer.**
Wrap it:

```js
function getPosition({ highAccuracy = false, ms = 8000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      return reject({ code: 'NO_API' });
    }
    let settled = false;
    // Our own wall clock. The iOS `timeout` option is documented as
    // not firing in standalone mode when the permission alert fails to appear.
    const watchdog = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject({ code: 'WATCHDOG' });
    }, ms);

    navigator.geolocation.getCurrentPosition(
      (pos) => { if (settled) return; settled = true; clearTimeout(watchdog); resolve(pos); },
      (err) => { if (settled) return; settled = true; clearTimeout(watchdog); reject(err); },
      { enableHighAccuracy: highAccuracy, timeout: ms, maximumAge: 60000 }
    );
  });
}
```

`maximumAge: 60000` is deliberate. A one-minute-old fix is fine for picking a
building and it makes repeat taps instant. Do not set it to `Infinity`, because a
student who walked from the Oval to the RPAC would get routed from where they
were.

### Permission request timing

**Never on page load.** Three independent reasons and they all point the same way:

1. **UX.** A permission sheet before the user knows what the app is has the worst
   grant rate of any pattern. A denial is close to permanent because ungranting on
   iOS means digging through Settings.
2. **Bug 1.** The standalone alert failing to appear is reported specifically
   around automatic calls. A user-gesture-initiated call is more likely to surface
   the alert on the right window.
3. **You need the frame anyway.** The first paint should show the duration chips
   and a shell. Asking for location while the app is still blank looks like a
   phishing page.

The sequence:

```
cold start
  |
  +-- render shell from cache (target: under 200 ms)
  +-- render duration chips: 30m / 1h / 2h / 3h
  +-- if permission state is already 'granted', silently start getPosition()
  |
  user taps a duration chip           <-- this tap is the gesture
  |
  +-- if not already granted, call getPosition() now.
  |   iOS shows the alert, attached to a real user action.
  +-- render skeleton rows immediately; do not wait to show structure
  |
  +-- fix arrives -> rank -> render
```

Tapping the duration chip is the natural gesture. The user has already committed
to wanting an answer, and the ask reads as "of course it needs my location".

Consider one line of pre-permission priming above the chips, shown only when the
state is not `granted`: "Vacant uses your location to find the closest room. It
never leaves your phone." That is true, it is a static site with no backend, and
saying so measurably improves grant rates.

### The full fallback chain

```
  1. Fresh fix from getCurrentPosition
        |  fail: WATCHDOG / TIMEOUT / POSITION_UNAVAILABLE
        v
  2. Last known position from localStorage, if under ~30 minutes old
        show it, and label it: "using your last location, tap to update"
        |  fail: none stored or too old
        v
  3. Manual building picker
        "Where are you?"  -> a searchable list of the ~130 buildings
        This is the honest answer and it is still better than Roomix,
        because it still applies the clock and the duration.
        |  user declines to pick
        v
  4. Campus-wide list, sorted by how long each room is free
        no distance, no walk-time subtraction, an explicit banner:
        "Showing all of campus. Turn on location for the closest rooms."
```

Handle each error code distinctly, because they need different copy:

| Code | Meaning | What to show |
| --- | --- | --- |
| `1` PERMISSION_DENIED | user said no, or Settings blocks it | Tier 3. Plus: "Settings > Privacy & Security > Location Services > Safari Websites". Do not loop the prompt, iOS will not show it again. |
| `2` POSITION_UNAVAILABLE | no fix available, often indoors | Tier 2, then Tier 3. Retry once with `highAccuracy: false` if the first was true. |
| `3` TIMEOUT | fix took too long | Tier 2 immediately, keep the request running, upgrade the list if it lands. |
| `WATCHDOG` | our timer fired, iOS never answered | Tier 2, and this is the Bug 1 signature. Worth counting if analytics ever land. |
| `NO_API` | no geolocation object, rare | Tier 3 directly. |

The `WATCHDOG` case deserves one extra behavior: **do not cancel the underlying
`getCurrentPosition`.** Let it keep running. If the fix eventually lands after
the user has already picked a building manually, quietly offer "found you, show
nearest rooms" rather than hijacking their screen.

**Store every successful fix**, so Tier 2 is populated:

```js
try {
  localStorage.setItem('vacant.lastFix.v1', JSON.stringify({
    lat: pos.coords.latitude,
    lon: pos.coords.longitude,
    acc: pos.coords.accuracy,
    t: Date.now()
  }));
} catch {}
```

One privacy note that is also a product note: this is a coordinate pair in
`localStorage` on the user's own phone, never transmitted, on a site with no
backend. Say that in the UI. On a campus app asking for location, being visibly
serverless is a feature.

---

## 6. GitHub Pages specifics

### HTTPS is handled

Pages serves HTTPS with HSTS, which satisfies both the secure-context requirement
for service workers and the one for geolocation.

```
$ curl -sSI https://enesyilmazcode.github.io/Finder/ | grep -i strict
Strict-Transport-Security: max-age=31556952
```

Enable "Enforce HTTPS" in repo settings. It is on by default for `*.github.io`.

### The subpath problem, precisely

Vacant will be served from `https://enesyilmazcode.github.io/Vacant/`. That
subpath breaks four things if you write paths carelessly.

**Trap 1: the service worker's scope is capped by its own location.** A worker at
`/Vacant/sw.js` can only control `/Vacant/*`. It **cannot** be given `scope: '/'`
unless the server sends a `Service-Worker-Allowed` header, and **GitHub Pages
cannot send custom headers**. So:

- Put `sw.js` at `/Vacant/sw.js`, the repo root. Not in `/Vacant/js/sw.js`, which
  would cap the scope at `/Vacant/js/` and control nothing useful.
- Register with `scope: '/Vacant/'` explicitly.

**Trap 2: the path is case-sensitive.** Measured:

```
$ for p in Finder/ finder/ FINDER/; do curl -sS -o /dev/null -w "$p %{http_code}\n" https://enesyilmazcode.github.io/$p; done
Finder/ 200
finder/ 404
FINDER/ 404
```

The repo is `Vacant`, so the path is `/Vacant/` with a **capital V**, everywhere:
`start_url`, `scope`, the `sw.js` registration path, and every asset URL. A
lowercase `/vacant/` in `start_url` produces an installed icon that launches
straight to a 404 with no service worker and no way for the user to understand
why. This is the single easiest way to ship a broken install.

Guard it in the test harness:

```js
// tests: fail the build if any path in the manifest is not /Vacant/-prefixed
const m = JSON.parse(fs.readFileSync('manifest.webmanifest', 'utf8'));
assert(m.start_url === '/Vacant/');
assert(m.scope === '/Vacant/');
for (const i of m.icons) assert(i.src.startsWith('/Vacant/'), i.src);
```

**Trap 3: the trailing slash.** Pages 301-redirects the bare path to the slashed
one:

```
$ curl -sSI https://enesyilmazcode.github.io/Finder | grep -i -E "HTTP/|location"
HTTP/1.1 301 Moved Permanently
Location: https://enesyilmazcode.github.io/Finder/
```

Write `start_url` as `/Vacant/` **with** the slash. Without it every cold launch
eats a redirect, and worse, the pre-redirect URL is outside the declared scope,
which means the service worker does not control the navigation that starts the
app. Also make sure `SHELL_ASSETS` caches both `'/Vacant/'` and
`'/Vacant/index.html'`, since they are the same bytes at two cache keys and a
navigation can arrive as either.

**Trap 4: relative vs absolute.** Root-absolute paths (`/Vacant/...`) are the
right call here, not relative ones. Relative paths in the manifest resolve against
the manifest's own URL and mostly work, but they silently break the moment
anything is served from a nested route, and they make the case-sensitivity bug
harder to spot in review. Absolute paths make the `/Vacant/` prefix appear
literally in every file, which is exactly what you want a reviewer to see.

The cost of absolute paths is that a custom domain migration requires a
find-and-replace. Which brings us to section 7.

**Trap 5, and this one is not about paths: the origin is shared.**
`enesyilmazcode.github.io` hosts every one of Enes's Pages projects. Finder,
Vacant, and anything else all live on **one origin**, which means:

- **One storage quota**, shared. Finder currently ships 3.4 MB of JSON. If Finder
  ever gets a service worker that precaches it, both apps draw from the same
  origin budget. Not a problem at these sizes, but worth knowing.
- **One `localStorage` namespace.** Prefix every key. `vacant.` on everything, as
  used throughout this doc. A bare `lastFix` key would collide with Finder.
- **One ITP counter for the Safari-tab case.** Visiting Finder resets Vacant's
  Safari-tab timer, and vice versa. Mildly helpful, entirely accidental.
- **A root-scoped service worker would claim `/Vacant/`.** Currently there is
  none, verified:

```
$ for f in sw.js service-worker.js manifest.json; do curl -sS -o /dev/null -w "$f %{http_code}\n" https://enesyilmazcode.github.io/$f; done
sw.js 404
service-worker.js 404
manifest.json 404
```

The user page at `enesyilmazcode.github.io/` is currently just a meta-refresh
redirect to `enes-y.vercel.app`. If a future version of that portfolio registers a
service worker at `/`, it would control `/Vacant/` too. Vacant's own worker at
`/Vacant/sw.js` wins for its subpath because the most specific registration wins,
so this is survivable, but it is a real coupling between two unrelated projects.

### Deployment mechanics

- No Jekyll. Add an empty `.nojekyll` at the repo root. Without it, Pages runs
  Jekyll, which ignores files and directories starting with `_` and adds build
  latency for nothing.
- Deploy from a GitHub Action, not from the branch, so the build step can stamp
  `__BUILD_ID__` into `sw.js` and run the manifest path assertions before
  publishing. Finder already uses Actions
  (`.github/workflows/{courses,seats,ratings,test,gen-categories}.yml`), so the
  pattern is in hand.
- The weekly harvest and the site deploy are separate workflows. The harvest
  commits a new `rooms-<term>.json`; the deploy publishes. Do not couple them, or
  a failed harvest blocks a shell fix.

---

## 7. Custom domain

### Recommendation: yes, and do it before the first install

Three reasons, in order of weight:

1. **Scope becomes `/`.** Every trap in section 6 evaporates. No case-sensitive
   subpath, no `/Vacant/` prefix on forty asset URLs, no shared origin with
   Finder, no shared quota, no shared `localStorage`, no risk of a portfolio
   service worker claiming the app's scope. The manifest becomes three lines
   shorter and impossible to get wrong.
2. **It is its own origin.** Separate quota, separate ITP counter, separate
   storage jar. For an app whose entire value proposition is "it works with no
   signal", owning your own storage budget is not cosmetic.
3. **A student will type it.** Something like `vacant.app` is a thing you can say
   out loud to a friend in a stairwell.
   `enesyilmazcode.github.io/Vacant` is not, and the capital V makes it worse,
   because the lowercase version 404s.

### What breaks if he adds one later

**Everything, silently, for every existing user.** A custom domain changes the
**origin**, and on the web the origin is the identity. Concretely, on the day the
CNAME lands:

| What | What happens |
| --- | --- |
| Installed home-screen icons | Still point at `enesyilmazcode.github.io/Vacant/`. Keep working via the redirect, but stay on the old origin forever. |
| Service worker registration | Old origin's worker keeps serving the old origin. New origin has no worker until first visit. |
| Cache API contents | Not migrated. New origin starts empty. |
| `localStorage` | Not migrated. Install-hint state, last known fix, all gone. |
| Geolocation permission | Not migrated. Every user re-prompted. |
| The install itself | **Not migrated.** iOS gives no way to update an installed web app's URL. Users must delete the icon and re-add. |

And GitHub Pages makes it worse than a normal migration: once a custom domain is
set, Pages **301-redirects** `enesyilmazcode.github.io/Vacant/` to the custom
domain. A 301 from a service worker's own origin is exactly the situation where
the old worker's cached shell and the new origin's fresh shell fight. Existing
installs land in a state where the app opens, redirects, and runs from a
completely cold origin with no cache, offline-broken, on a phone in a basement.

If it has to happen after launch, the migration plan is:

1. Ship a version to the **old** origin whose only job is to unregister the
   service worker, delete all caches, and hard-redirect to the new origin. Ship
   this **at least a week before** the DNS change, so installed users pick it up.
2. Keep both origins live during the overlap.
3. Show a one-time interstitial on the new origin: "Vacant moved. Delete the old
   icon and add this one." Give the exact steps.
4. Accept that some percentage never re-installs. On a campus app with a
   semester-shaped usage curve, that percentage is high.

None of that is fun. The whole thing costs about $12/year to avoid.

### Practical setup

- Register the domain, add a `CNAME` file at the repo root with the bare hostname.
- Apex domain needs four A records to GitHub's IPs, or use `www` with a CNAME to
  `enesyilmazcode.github.io`. `www` is less trouble.
- Wait for "Enforce HTTPS" to become checkable in repo settings. Pages provisions
  a Let's Encrypt cert automatically, usually within an hour, occasionally 24.
  **Do not announce the app before that box is checked**, because a cert error on
  first visit means no service worker, no geolocation, and no install.
- Once the domain is live, change `start_url` and `scope` to `/`, and change every
  `/Vacant/` asset path to `/`.

**If a custom domain is not happening**, the fallback that captures most of the
benefit is to rename the repo to lowercase `vacant`, so the URL is
`enesyilmazcode.github.io/vacant/`. It is typeable and it removes the
capital-letter trap. But **do this before the first install too**, because a repo
rename is also a URL change and breaks installs exactly the same way. GitHub
redirects the old path, but the origin-plus-path identity the browser uses for
scope does not care about redirects.

---

## Things that surprised me

1. **`background_color` is ignored on iOS.** Every PWA tutorial tells you to set
   it for the splash screen. On iOS it does nothing at all, and the splash comes
   from `apple-touch-startup-image` or from Apple's icon-on-a-guess default.
2. **The Share button is hidden by default in iOS 26.** The default Compact tab
   layout puts it behind a `...`. Every "tap the Share icon" install tutorial
   written before September 2025 is now wrong for the default configuration, and
   there is no way to detect which layout a given user has.
3. **Each installed icon gets its own storage jar, isolated from Safari and from
   other icons of the same site.** This means the Safari tab literally cannot know
   the user installed, and the installed app starts with an empty cache no matter
   how much the tab cached first. It reframes the whole first-run design.
4. **The 7-day eviction rule is 7 days of *use*, and use resets it.** The scary
   headline does not apply to Vacant's actual usage pattern at all. Almost every
   article about it gets this wrong.
5. **There is an open, unanswered iOS 26 bug where installed PWAs get location
   denied while the same site works in a Safari tab.** Filed against 26.0.1 on an
   iPhone 17 Pro, zero replies. For a location-first app this is a
   verify-before-you-build item, not a footnote.
6. **Safari *does* support `navigator.permissions.query({name:'geolocation'})`,
   since 16.0.** A lot of current writing says it does not. caniuse says 95.68%
   global support with Safari and Safari iOS both at 16.0+.
7. **GitHub Pages serves `.webmanifest` with the spec-correct
   `application/manifest+json`.** I expected to have to use `manifest.json` to
   dodge a MIME problem. Measured on a live Pages site, it is correct.
8. **GitHub Pages paths are case-sensitive**, so `/Vacant/` works and `/vacant/`
   is a hard 404. On a repo named with a capital letter that is a live trap for
   `start_url`.
9. **`Cache-Control: max-age=600` on `sw.js` and you cannot change it.** Pages
   sends no custom headers, which is also why `Service-Worker-Allowed` is
   unavailable and why root scope is impossible from a subpath.
10. **Finder has no manifest and no service worker.** I assumed there would be
    something to port. There is not. The PWA layer is entirely new work.

---

## Version-dependent claims

| Claim | Depends on | Retest when |
| --- | --- | --- |
| Every home-screen add opens as a web app; "Open as Web App" toggle exists | iOS/iPadOS 26+ | iOS 27 ships, ~Sept 2026 |
| Share button hidden behind `...` in default Safari layout | iOS 26+, Compact layout | iOS 27 ships |
| Installed PWA gets PERMISSION_DENIED for geolocation | reported on iOS 26.0.1, unconfirmed on 26.6 | **immediately, on a real device** |
| Standalone location alert fails to appear and never times out | reported iOS 15.1.1 through 17 | on every iOS major |
| `background_color`, `orientation`, `shortcuts` ignored | all iOS through 26.x | iOS 27 |
| manifest `icons` honored but `apple-touch-icon` wins | iOS 15.4+ | stable, low risk |
| 7-days-of-use ITP eviction, home-screen apps have own counter | current WebKit ITP policy | annually |
| Origin quota 60% of disk, overall 80% | Safari 17.0+ | on WebKit storage posts |
| Permissions API geolocation supported | Safari / Safari iOS 16.0+ | stable |
| GitHub Pages `max-age=600`, no custom headers, case-sensitive paths | GitHub Pages, measured 2026-08-26 | if Pages announces changes |

---

## Device test checklist

Nothing in this document is worth anything until it runs on a real iPhone. In
priority order:

1. **Geolocation in an installed PWA on current iOS.** Grant, get a fix, render.
   This is the go/no-go for the whole project. Do it first, with a throwaway page,
   before any harvester work.
2. Install flow end to end on iOS 26 Compact layout. Confirm the hint copy matches
   what the user actually sees.
3. Airplane mode, second launch. Must render a ranked list from cache.
4. Airplane mode, **first** launch after install. Must show the Tier 3 copy, not a
   white screen or a broken icon.
5. Deny location, confirm the manual building picker is reachable and useful.
6. Deploy a shell change, confirm the new version reaches an installed app within
   two launches.
7. Rotate to landscape. `orientation` is ignored, so this has to not break.
8. Notched device with `viewport-fit=cover`, confirm the top row clears the clock.
9. Leave it a month, open it, confirm the cache survived.
10. Chrome on Android, confirm `beforeinstallprompt` fires and the same bar works.

---

## Commands run for this note

```bash
# Pages headers and caching
curl -sSI https://enesyilmazcode.github.io/Finder/
curl -sSI https://enesyilmazcode.github.io/Finder/js/api.js
curl -sSI https://enesyilmazcode.github.io/Finder/data/seats-1268.json

# gzip ratio on a real data file of similar shape
curl -sS -o /dev/null -H "Accept-Encoding: gzip" -w "%{size_download}\n" \
  https://enesyilmazcode.github.io/Finder/data/seats-1268.json     # 83023
# raw was 336984 bytes -> 24.6%

# case sensitivity
for p in Finder/ finder/ FINDER/; do
  curl -sS -o /dev/null -w "$p %{http_code}\n" https://enesyilmazcode.github.io/$p
done                                       # 200 / 404 / 404

# trailing-slash redirect
curl -sSI https://enesyilmazcode.github.io/Finder      # 301 -> /Finder/

# 404 behavior (no SPA fallback)
curl -sS -o /dev/null -w "%{http_code}\n" \
  https://enesyilmazcode.github.io/Finder/does-not-exist-xyz       # 404

# manifest MIME types on GitHub Pages
curl -sSI https://tjukanovt.github.io/30DayMapChallenge/manifest.webmanifest
#   -> application/manifest+json; charset=utf-8
curl -sSI https://googlechrome.github.io/samples/web-application-manifest/manifest.json
#   -> application/json; charset=utf-8

# origin-root service worker check (shared-origin risk)
for f in sw.js service-worker.js serviceworker.js manifest.json; do
  curl -sS -o /dev/null -w "$f %{http_code}\n" https://enesyilmazcode.github.io/$f
done                                       # all 404

# Vacant Pages not enabled yet
curl -sS -o /dev/null -w "%{http_code}\n" https://enesyilmazcode.github.io/Vacant/   # 404

# Finder has no PWA layer to port
find . -iname "*manifest*" -not -path "./.git/*"   # nothing
find . -iname "*sw*.js"    -not -path "./.git/*"   # nothing

# icon dimensions
python -X utf8 -c "import struct; d=open('apple-touch-icon.png','rb').read(); print(len(d),'bytes',struct.unpack('>II',d[16:24]))"
# 495 bytes (180, 180)
```

## Sources

- [WebKit Features in Safari 26.0](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/) - zero installability requirements, Open as Web App toggle
- [Updates to Storage Policy, WebKit](https://webkit.org/blog/14403/updates-to-storage-policy/) - quota numbers, eviction triggers, persist() heuristics
- [iOS PWA Compatibility, firt.dev](https://firt.dev/notes/pwa-ios/) - the manifest support matrix with iOS version numbers
- [Apple forums 694999](https://developer.apple.com/forums/thread/694999) - standalone location alert never appears, never times out
- [Apple forums 804381](https://developer.apple.com/forums/thread/804381) - iOS 26.0.1 installed-PWA location denied, unresolved
- [Apple forums 807603](https://developer.apple.com/forums/thread/807603) - open request for beforeinstallprompt in Safari
- [Apple forums 731412](https://developer.apple.com/forums/thread/731412) - Permissions API state inconsistency on iOS
- [caniuse: Permissions API geolocation](https://caniuse.com/mdn-api_permissions_permission_geolocation) - Safari 16.0+, 95.68% global
- [web.dev: Detection](https://web.dev/learn/pwa/detection) - per-icon storage isolation, no install detection from a tab
- [9to5Mac: iOS 26 Safari compact design](https://9to5mac.com/2025/09/15/iphone-ios-26-safari-new-compact-design/) - the hidden Share button
- [MacRumors: add web app to home screen in iOS 26](https://www.macrumors.com/how-to/save-safari-bookmark-web-app-iphone-home-screen/) - the ... then Share then Add flow
- [MacRumors: iOS 26.6.1 betas](https://www.macrumors.com/2026/08/10/apple-releases-ios-26-6-1/) - current version baseline
- [Chrome for Developers: Fresher service workers](https://developer.chrome.com/blog/fresher-sw) - updateViaCache and the 24-hour cap
