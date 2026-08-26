---
title: Add a diagnostics panel and a report-a-problem path
labels: ux, ops, good first issue
milestone: Phase 3: App
estimate: S
order: 24
depends_on: result-screen, service-worker-and-cache
---

If a student says "it told me DL0357 was free at 2pm and there was a class in it", there is nothing to work with. The app shows no build id, no term, no index date, no origin, and no trace of which gap it picked, so the complaint cannot become a bug. The only documented maintenance failure in this whole category arrived exactly this way: illiniSpots [issue 10](https://github.com/plon/illinispots/issues/10), "during summer CIF is closed but still shows as available", answered with "Sorry, forgot to update building hours and class schedules for summer." A user caught a stale side table. That is the failure Vacant is most exposed to, because a broken Vacant looks like a Vacant that found a lot of rooms.

### What to do

Add a Diagnostics section to the About sheet, collapsed by default. It reads only what is already in memory or already in `caches`, so it makes zero network requests. Content, one labelled line each, as selectable monospace text:

```
build      a3f9c21          shell cache vacant-shell-a3f9c21 (controlling)
term       1268  Autumn 2026
index      generated 2026-08-30T07:41:12Z  (5 days old)
counts     1067 rooms / 116 buildings / 3 sessions
origin     gps  +/-32 m  age 14 s   [location withheld]
clock      2026-09-04 14:02  America/New_York
room       DL0357  type 1B  cap 46  bldg 279
walk       412 m -> 7 min   (WALK_MPM 78, DETOUR 1.30)
gap        13:55-16:10 sess 0  ->  usable 2h03, leaveBy 14:02
busy Thu   08:00-08:55 s0 | 09:10-10:05 s0 | 13:00-13:55 s0 | 16:10-17:05 s0
caches     vacant-shell-a3f9c21, vacant-data-1268
```

Read the SHA from the cache name via `caches.keys()`, not from a constant in the page, and mark whether that cache is the controlling one. A newer cache name sitting beside an older controller is the "you are running last week's code" state, which is worth seeing.

The room block comes from the last tapped result. Persist it to `localStorage` under `vacant.lastPick` (Finder shares this origin, so the prefix is not optional), because the complaint happens after the walk, after the app was backgrounded and possibly killed.

Two actions. **Copy** writes the block via `navigator.clipboard.writeText`. **This was wrong** opens

```
https://github.com/EnesYilmazcode/Vacant/issues/new
  ?template=wrong-answer.yml&labels=wrong-answer&diagnostics=<encodeURIComponent(block)>
```

against `.github/ISSUE_TEMPLATE/wrong-answer.yml` with fields `what_happened`, `expected`, `diagnostics`.

No coordinate goes in the block or the URL unless the user ticks "include my location", and if ticked it is rounded to 4 decimals. A URL is not private: it lands in the address bar, in history, and in GitHub's logs.

### Done when

- [ ] The panel opens from About in one tap and the Network tab records 0 requests between the tap and the render
- [ ] It prints all of: build SHA from `caches.keys()`, term and term name, `generated` plus age in days, room count, building count, session count, origin tier with accuracy in metres and age in seconds, device clock with IANA zone, and the cache names
- [ ] After tapping a result it prints that room's `facilityId`, `type`, `cap`, metres, rounded walk minutes, the chosen gap as `start-end sess N`, `usable`, `leaveBy`, and the room's full merged busy list for the current weekday
- [ ] Tap a row, force-quit the installed app, reopen: the panel still shows that room
- [ ] Every `localStorage` key written here starts with `vacant.`
- [ ] The block has `user-select: text` and long-press selection works in standalone mode on a real iPhone
- [ ] Copy falls back to a visible "select this text" state when `writeText` rejects
- [ ] `.github/ISSUE_TEMPLATE/wrong-answer.yml` exists, and the link lands with `diagnostics` already filled
- [ ] With the location box unticked, `grep -E '[0-9]{2}\.[0-9]' ` over the generated block finds no coordinate; with it ticked, no value has more than 4 decimal places
- [ ] The block is capped at 4000 characters, truncating the busy list first with a `... N more` marker, checked against a room carrying 57 weekly intervals

### Notes

YAML issue forms ignore `&body=`. Prefill only works by matching an input's `id`, which is why the URL carries `diagnostics=` and why the template cannot be a plain markdown file if the field ids are going to be relied on. Getting this wrong produces an empty form and a user who gives up.

Most students do not have a GitHub account, so Copy is the real path and the issue link is the convenience. Whether GitHub preserves the query string through its sign-in redirect, and how an installed iOS PWA handles the jump to an out-of-scope origin, are both unverified. Test both on hardware during `ground-truth-walk` rather than assuming.

Reading `caches.keys()` is not a network fetch, so it does not violate the no-runtime-fetch rule. Neither does `navigator.permissions.query`.
