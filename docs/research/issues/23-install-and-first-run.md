---
title: Build the install hint and the cold-and-offline first-run journey
labels: pwa, ux, documentation
milestone: Phase 3: App
estimate: L
order: 23
depends_on: service-worker-and-cache, spike-ios-geolocation
---

Two journeys land in one change because they are the same failure. On iOS every installed home-screen icon gets its own storage jar, isolated from Safari and from every other icon of the same site, so everything the Safari tab cached while the user read the install hint is in the wrong jar. The first standalone launch is always cold and always needs the network. That is not an edge case, it is the first thing every installed user sees, and undesigned it is a white screen for a student in a basement. On the way in, Safari has never implemented `beforeinstallprompt` in any version including 26.6, and iOS 26 defaults the Safari tab layout to Compact, which hides Share behind a `...` button. The README's current instructions are wrong for the default configuration.

### What to do

`js/firstrun.js` picks a tier before first paint, reading the cache directly so no network call gates the decision:

```
rooms = await caches.match(current.rooms)        // no network
if (rooms)                 -> render, revalidate in background      // tier 1
else if (navigator.onLine) -> skeleton + "getting this term's schedule"
                              getPosition() in the SAME tick        // tier 2
else                       -> offline card, retry button            // tier 3
```

Tier 2 fires geolocation alongside the fetch so the two latencies overlap instead of stacking. Tier 3:

```
+------------------------------------+
|  Vacant needs this term's          |
|  schedule once.                    |
|  About 34 KB, then it works        |
|  offline.                          |
|                                    |
|      [        Retry        ]       |
+------------------------------------+
```

The size is stamped at build time from the gzipped byte count of the committed `data/rooms-<term>.json`, through the same `__BUILD_ID__` substitution step `service-worker-and-cache` already runs. If the stamp is missing, the copy says "a few seconds" and no number. Never a hardcoded estimate.

Retry on `window` `online` and on `document` `visibilitychange` when data is still missing, because iOS freezes backgrounded web apps and `online` may not fire while frozen. After the first successful render, call `navigator.storage.persist()` inside try/catch and branch no UI on the result.

`js/install.js` owns the hint bar. `isIOSSafari()` requires `Version/` and rejects `CriOS|FxiOS|EdgiOS|OPiOS`; in-app webviews get "Open in Safari to install" instead. `isStandalone()` checks `navigator.standalone` first, then `display-mode: standalone` and `fullscreen`. Copy covers both layouts, since the setting is not readable from JS:

```
+------------------------------------------------+
| Keep Vacant on your home screen.               |
| Tap Share (or ... then Share), then            |
| Add to Home Screen.                     [ X ]  |
+------------------------------------------------+
```

Do not mention the "Open as Web App" toggle. Showing the bar prefetches `data/rooms-<term>.json` to warm the shared HTTP cache, which is not subject to ITP eviction, so the installed app's first fetch is a 304 or a local hit. Anti-nag state lives in `vacant.installHint.v1`, every access in try/catch. Android captures `beforeinstallprompt`, preventDefaults the mini-infobar, and drives the same bar; `appinstalled` marks dismissed forever.

### Done when

- [ ] `js/firstrun.js` selects tier 1, 2 or 3 from a cache read alone, with no network request in the decision path
- [ ] Tier 2 calls `getPosition()` in the same tick as the data fetch, and a test asserts both start before either resolves
- [ ] Tier 3 renders a visible `<button>` retry, not only pull-to-refresh
- [ ] Tier 3 copy names a KB figure stamped at build time from the gzipped size of the committed rooms file, or contains no number at all; `grep -E '[0-9]+ ?KB' js/` finds no literal
- [ ] Both `online` and `visibilitychange` retry, and neither fires while data is already present
- [ ] `navigator.storage.persist()` is called once after the first successful render, wrapped in try/catch, and no branch reads its return value
- [ ] `isIOSSafari()` returns false for UA strings containing `CriOS`, `FxiOS`, `EdgiOS`, `OPiOS`, and for an iOS webview UA with no `Version/` token; those get "Open in Safari to install"
- [ ] `isStandalone()` returns true when `navigator.standalone === true`, and the hint never renders when it does
- [ ] Hint copy contains both "Share" and "..." and does not mention "Open as Web App"
- [ ] Hint never shows on first visit (gated on having rendered a ranked list at least once), never on load, renders as a bottom bar and never a modal
- [ ] `dismissed: true` is permanent; a non-dismissal re-shows no sooner than 7 days later
- [ ] Every `localStorage` read and write in `js/install.js` and `js/firstrun.js` is inside try/catch; a test with a throwing `localStorage` stub still renders the app
- [ ] Showing the hint issues one prefetch of `data/rooms-<term>.json`
- [ ] Android: `beforeinstallprompt` is captured and `preventDefault()`ed, the deferred prompt drives the same bar, and `appinstalled` sets `dismissed`
- [ ] README "Save it to your home screen" says tap Share, or `...` then Share, then Add to Home Screen
- [ ] Device check recorded in the issue: airplane mode on the FIRST launch after install shows tier 3 with working copy and a tappable retry, not a white screen

### Notes

The permanent-dismissal guarantee is best effort in a Safari tab. WebKit's 7-days-of-use eviction can wipe `vacant.installHint.v1`, and a Safari tab can never learn the user installed, since there is no API and `getInstalledRelatedApps()` is Chrome-only and native-only. So a re-nag of an installed user is possible and cannot be fully prevented. Once installed, the app keeps its own counter that any first-party interaction resets, so a weekly student is safe there.

Do not add a splash screen to cover the cold launch. iOS ignores manifest `background_color`, so it would take roughly fifteen `apple-touch-startup-image` PNGs that break on every new screen size. Fix the cold state instead.

Multiple current blog posts claim iOS 16.4 added `beforeinstallprompt`. That is false and it propagates widely. Do not write an iOS code path that waits for it.
