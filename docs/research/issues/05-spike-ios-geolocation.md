---
title: SPIKE: does geolocation work in an installed PWA on current iOS?
labels: spike, pwa
milestone: Phase 0: Setup
estimate: S
order: 5
depends_on: walking-skeleton
---

Every screen in this project assumes an installed home-screen web app can get a GPS fix. Two open Apple reports say it might not, and nobody has run it on a phone. Thirty minutes with a real iPhone decides whether geolocation is the front door or an enhancement bolted onto a manual picker.

### What to do

Deploy `Walking skeleton: one catalog-number bucket to a ranked list of real rooms on a phone`, add a debug panel behind `/Vacant/?debug=1`, add the site to the home screen from Safari, then open the icon and work through the panel. It does three things:

1. Prints `navigator.permissions.query({name:'geolocation'}).state` on load, before any prompt. Safari has supported this since 16.0, contrary to a lot of current writing.
2. On a button tap, calls `getCurrentPosition` with `{ enableHighAccuracy: false, timeout: 8000, maximumAge: 0 }`, wrapped in the wall-clock `setTimeout` watchdog from `docs/research/pwa-ios.md` section 5. The iOS `timeout` option is documented as not firing in standalone mode, so a bare await can hang forever.
3. Prints `coords.latitude`, `coords.longitude`, `coords.accuracy`, elapsed ms, and on failure the numeric `code` (1/2/3) or `WATCHDOG`.

Sample accuracy outdoors on the Oval, indoors on a middle floor of a classroom building, and at the campus edge. Adjacent Oval buildings sit 50 to 150 m apart, so anything above roughly 100 m can swap the top two results.

Write the answer into `docs/DECISIONS.md`:

```
## 2026-XX-XX  iOS installed-PWA geolocation
iOS version / device:
Permission alert shown:      yes / no
Coordinates arrived:         yes / no
Elapsed to first fix:        ____ ms
Accuracy Oval / indoors / edge:  ____ / ____ / ____ m
permissions.query before / after grant:  ____ / ____
Grant survived close and reopen:  yes / no
VERDICT: PASS | FAIL
```

PASS means geolocation-first with the picker at fallback tier three. FAIL promotes `Build the manual building picker as a first-class origin screen` to the primary origin screen and re-scopes `Wrap geolocation in a wall-clock watchdog, with distinct error paths and an off-campus gate` to an enhancement. Do that re-scope in the same sitting.

### Done when

- [ ] The panel prints `window.navigator.standalone === true`, proving the test ran in the installed window and not a Safari tab
- [ ] Every field above is filled in in `docs/DECISIONS.md`, no blanks
- [ ] Accuracy recorded in metres at three named campus points
- [ ] Close-and-reopen grant test run at least twice
- [ ] A one-word PASS or FAIL is written down, and any issue assuming the other branch has its description updated the same day
- [ ] Time spent is 30 minutes or less

### Notes

If the watchdog fires with no alert, switch to Safari before concluding anything. In [thread 694999](https://developer.apple.com/forums/thread/694999) the alert appeared in the Safari tab instead of the standalone window, which is that bug's signature rather than a denial. The fresher [thread 804381](https://developer.apple.com/forums/thread/804381), against iOS 26.0.1, is a flat `PERMISSION_DENIED` in the installed app while the same page works in a tab. Neither is confirmed on 26.6.

Safari still has no `beforeinstallprompt` in 26.6, and the iOS 26 default Compact layout hides Share behind the `...` button, so the install path is `...` then Share then Add to Home Screen.

An ambiguous result counts as FAIL. Half-working geolocation is worse to build on than none. iOS 27 ships around September 2026, mid-semester, so put a calendar note to re-run this spike then.
