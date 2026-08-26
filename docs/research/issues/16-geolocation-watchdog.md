---
title: Wrap geolocation in a wall-clock watchdog, with distinct error paths and an off-campus gate
labels: ux, pwa, enhancement
milestone: Phase 3: App
estimate: M
order: 16
depends_on: spike-ios-geolocation, buildings-json-from-osu-gis
---

`getCurrentPosition` on iOS can accept the call, never show the permission alert, and never call either callback. The `timeout` option does not save you, because it is the thing that is broken ([thread 694999](https://developer.apple.com/forums/thread/694999): "the location alert does not open on my phone. And the call never times out."). Anything awaiting that promise hangs forever on a phone outside a building, with a spinner and no error. This issue builds the position layer so it always terminates, always says which failure happened, and refuses to rank anything when the user is nowhere near campus.

### What to do

New file `js/position.js`. It exports a factory so the ranking path never touches `navigator` directly and stays testable under `node --test`.

```js
// makePositionSource({ geo, now, storage }) -> { get({ ms = 8000 }) }
// Resolves { lat, lon, acc, source: 'fresh' | 'cached', ageMs }
// Rejects  { code: 1 | 2 | 3 | 'WATCHDOG' | 'NO_API' }
```

The watchdog is an independent `setTimeout(ms)` that settles the promise on its own. Guard both callbacks with a `settled` flag and `clearTimeout`. Do **not** cancel the underlying call when the watchdog fires: if the fix lands later, offer "found you, show nearest rooms" instead of hijacking the screen.

Call it only from the duration-chip tap, with one exception: if `navigator.permissions.query({name:'geolocation'})` already reports `'granted'` (Safari 16.0+), fire on load, because there is no alert to attach a gesture to. Never render a denied screen off `'denied'` alone; make the call and let the real error decide.

Error routing:

| Code | Route |
| --- | --- |
| `1` PERMISSION_DENIED | building picker, no re-prompt ever |
| `2` POSITION_UNAVAILABLE | cached fix, then picker |
| `3` TIMEOUT | cached fix, keep the request alive |
| `WATCHDOG` | cached fix. This is the bug-694999 signature |
| `NO_API` | picker directly |

Cache under `vacant.lastpos.v1` (prefixed, the origin is shared with Finder): one point, `{lat, lon, acc, t}`, expiring at 6 hours. Never a track, never in a query string or fragment.

Off-campus gate, checked after the fix and before ranking. Nearest classroom building over **1500 m** renders F1 instead of a list. Measured origins: campus centre 56 m, north dorms 325 m, south campus 369 m, Grandview 3615 m, home 8193 m. There is no ambiguous middle to tune.

```
+----------------------------------------------+
| VACANT                             12:15 Thu |
|----------------------------------------------|
| You are about 5 miles from campus.           |
| Walk times from here would all be an         |
| hour or more, so ranking tells you nothing.  |
|----------------------------------------------|
| PREVIEW FROM THE OVAL                        |
| at 12:15 today, 98 rooms are free for        |
| an hour or more.                             |
|----------------------------------------------|
| [   Show them from the Oval   ]              |
| [   Take me back to my location   ]          |
+----------------------------------------------+
```

Above 75 m accuracy, show the coarse-fix banner with the real metre figure and prefix every walk time with `~`.

### Done when

- [ ] Every `getCurrentPosition` call sits inside its own `setTimeout` watchdog; a fake `geo` whose callbacks never fire still settles the flow
- [ ] Nothing requests position on load unless `permissions.query` returned `'granted'`; the prompt path is reached only from a chip tap
- [ ] Code `1` routes to the picker with zero re-prompts; codes `2`, `3` and `WATCHDOG` fall through to the cached fix and the copy names its age and where it was
- [ ] `vacant.lastpos.v1` holds one point, is ignored past 6 hours, and `grep -rn "coords\|lastpos" js/` shows no coordinate reaching a URL, fetch body or beacon
- [ ] `acc > 75` renders the banner with the metre figure and every walk time carries a `~`
- [ ] `js/position.js` takes `geo`, `now` and `storage` as arguments; the whole suite runs under `node --test` with no headless browser
- [ ] Tests assert the gate fires for Grandview (3615 m) and home (8193 m) and does not fire for centre (56 m), north dorms (325 m) or south campus (369 m)
- [ ] The off-campus preview labels every number a preview and the return action neither reloads the page nor re-prompts
- [ ] Entering the off-campus or denied state moves focus to the message heading
- [ ] `localStorage` reads and writes are inside `try/catch`; Private Browsing throws on WebKit

### Notes

Scope this against what `SPIKE: does geolocation work in an installed PWA on current iOS?` wrote into `docs/DECISIONS.md`. If it came back FAIL, `Build the manual building picker as a first-class origin screen` is the front door and this layer is an upgrade path, not the primary one. [Thread 804381](https://developer.apple.com/forums/thread/804381), against iOS 26.0.1, is an installed PWA getting a flat denial while the same page works in a Safari tab. Zero replies, unresolved.

Permission does not reliably persist across launches in an iOS PWA, so re-prompting every session is normal, not a bug to chase. Build so being asked again is cheap.

Walk times run optimistic regardless of accuracy: the coordinate in `data/buildings.json` is a polygon centroid, up to half a building's longest dimension from any door. About 38 s for a typical classroom building, 55 s for Knowlton, 1 min 45 s for Ohio Stadium. Round up and let `Harden the query engine: edge cases, the corrected usable formula, ranking and the fallback ladder` own the constant.
