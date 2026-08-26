---
title: Build the result screen: shell, confidence-tiered rows, duration chips and the detail sheet
labels: ux, accessibility, enhancement
milestone: Phase 3: App
estimate: L
order: 18
depends_on: engine-and-ranking, room-safety-filter
---

The skeleton renders throwaway markup from a hardcoded origin. This is the real screen, and the hard part is not layout. At the weekly peak (Thu 12:15) 75 of 142 free rooms have a later class and 67 do not, so a single row format either invents an end time for 47% of results or hides the difference. A naive midnight cap on the open-ended ones printed `9h44` in a real ranked query. The row has to say only what the schedule knows.

### What to do

Replace the skeleton with `index.html`, `css/app.css` and `js/app.js`, and put the boot order in a comment at the top of `app.js` so nothing later quietly adds a network wait to first paint.

```
1  shell + chips paint from Cache Storage      ~40ms   no network, no fix
2  read data/current.json -> term code
3  parse rooms-<term>.json out of Cache Storage
4  getCurrentPosition, fired by a tap on first run
5  fix arrives -> render list                  0.5-3s
```

Write `docs/a11y-contract.md` before the row exists. The row is the hard case: five fields, two lines, read outdoors at AX5, one-handed. Name order is identity, distance, window, size, caveat:

`"Hagerty Hall 050, 2 minute walk, free until 1:55 pm, 40 seats. Class schedule only, the door may be locked."`

Visually `2 min`, in the label `2 minute walk`. One button per row, never nested nodes. `aria-live="polite"` on the result count only, never the list.

```
+----------------------------------------------+
| VACANT                             12:15 Thu |
|----------------------------------------------|
| Hagerty Hall 050                       2 min |
| free till 1:55p        40 seats              |
|----------------------------------------------|
| Derby Hall 049                         2 min |
| no class rest of today 28 seats              |
|----------------------------------------------|
| 94 more                                      |
|                                              |
| Class schedule only. Doors may be locked,    |
| and about 10% of scheduled class time has    |
| no room recorded, so some of these are in    |
| use anyway.                                  |
|----------------------------------------------|
| [ 30m ] [*1h*] [ 2h ] [ rest of day ]        |
+----------------------------------------------+
```

The mixed tiers are deliberate. That is what 12:15 on a Thursday actually looks like.

```js
function phrase(room, now) {
  const next = nextBusyAfter(room, now);   // same weekday, same session range
  if (!next) return { tier: 'medium', text: 'no class rest of today' };
  return { tier: 'strong', text: `free till ${clock(next.start)}` };
}
// There is no third branch. DAY_END bounds the engine and never reaches a string.
```

Duration is four chips in a bottom bar, `role="radiogroup"` with `aria-checked`, persisted as `vacant.duration`. Tapping a row opens the detail sheet: walk time and metres, the usable duration (the only place a duration is printed), seats, today's timeline for that room, a `deviceorientation` bearing arrow and an `Open in Maps` hand-off to a `geo:` URI. No tiles.

### Done when

- [ ] `index.html`, `css/app.css`, `js/app.js` exist and the boot order above is a comment in `app.js`; first paint depends on no fix, no network and no room-index parse
- [ ] `docs/a11y-contract.md` is committed and the row is built against it: one focusable button per result, documented name order, caveat last
- [ ] `aria-live="polite"` is on the count element only; `grep aria-live` returns exactly one hit
- [ ] Entering any non-list state moves focus to that screen's message heading
- [ ] A room with no later class renders `no class rest of today`; a test asserts no rendered string ever contains a window past `DAY_END`, and a fixture reproducing the `9h44` case is in the suite
- [ ] Bounded rooms render a clock time; the duration string appears only inside the detail sheet
- [ ] `facilityCapacity === 0` renders `seats unknown`, never `0 seats`
- [ ] The locked-door caveat plus the no-room-recorded disclosure appear exactly once in the visual list, and the caveat is in every row's accessible name
- [ ] The list caps rendered rows and ends with an `N more` row; with 98 qualifying rooms the DOM holds the cap, not 98
- [ ] Nothing re-sorts on a timer: recompute fires on `visibilitychange` to foreground, explicit pull, and duration change only
- [ ] Four chips, `role="radiogroup"`, `aria-checked`, `min-height` 44px, `env(safe-area-inset-bottom)` honoured, last choice restored on launch. No slider, no free entry, no "until my next class"
- [ ] The detail sheet ships walk time and metres, usable duration, seats, today's timeline, a bearing arrow and Open in Maps; no tile request appears in the network log
- [ ] `grep -E '[0-9]+px' css/app.css` returns no `font-size`, `line-height` or spacing hit; the screen renders at 320px, at 200% zoom, at AX5 with the room name never truncated, and in landscape
- [ ] Primary line measures 7:1 contrast in both themes; a `prefers-color-scheme: dark` palette, a `prefers-reduced-motion` branch removing the shimmer, `:focus-visible` and `forced-colors` blocks are all present
- [ ] Tier is readable with colour off: the phrases carry it, colour only reinforces

### Notes

The design problem is too many results, not too few. Peak occupancy across the whole week is 39%, and duration barely filters: from the Ohio Union at Thu 12:15, 30m gives 98 rooms and 180m gives 71, with an identical top result. Do not let the chip bar grow into a filter panel. illiniSpots deleted a duplicate time control on 2026-08-26 (-100 core LOC) because users could not tell `Start Time` from `Free Until` when both computed the same thing.

The AX5 reflow needs specifying now, not discovering later: the name wraps freely, walk time drops below the name rather than truncating, window and seats stack. The room name is the one field the user carries while walking.

Column layout with four fields on one line was tried and rejected in `ux-states.md`: at 390px it forces every field to about 11 characters, which truncates `Baker Systems Engineering`. A per-row `may be locked` line was also rejected, since a warning on 98 rows stops being read by row four.

Rows in the D1 near-miss groups render a second shape (`free at 1:10p, then 2h05`). The 20-minute floor under those belongs to `engine-and-ranking`, but this screen has to render the shape.
