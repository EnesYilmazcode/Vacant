---
title: Build the manual building picker as a first-class origin screen
labels: ux, enhancement
milestone: Phase 3: App
estimate: M
order: 17
depends_on: buildings-json-from-osu-gis
---

On iOS a `PERMISSION_DENIED` is terminal: there is no in-app way back, the toggle is buried in Settings, and re-prompting does nothing. Until `SPIKE: does geolocation work in an installed PWA on current iOS?` comes back this is also the contingency plan for the whole product. So the picker is not a consolation screen. It is a second, equal way to set the one input the app needs, and it has to produce an origin that is indistinguishable downstream from a GPS fix.

### What to do

Build the list from the intersection of the building codes present in `data/rooms-<term>.json` and the keys of `data/buildings.json`. That is roughly 88 entries, not the 1,331 the GIS layer holds. Room counts come from the same harvest, counted after the safety filter, so the number on screen matches what a tap will actually return.

Selection emits the same object a fix does:

```js
// nothing downstream reads .source except one line of header copy
{ lat: 40.002221, lon: -83.01599,
  accuracy: 50,            // centroid to door, about half a footprint
  source: "picked",        // "gps" | "picked" | "lastpos"
  label: "Dreese Laboratories",
  at: 1756240000000 }
```

`accuracy: 50` sits under the 75 m coarse-fix threshold, so the accuracy banner stays off. The off-campus gate needs no branch either: distance to the picked building is 0, so it passes on the normal path.

```
+----------------------------------------------+
| < Back            WHERE ARE YOU?             |
|----------------------------------------------|
| [ Ohio Union   ] [ Thompson Lib ]            |
| [ RPAC         ] [ 18th Ave Lib ]            |
| [ Dreese       ] [ Hitchcock    ]            |
|----------------------------------------------|
| Baker Systems Engineering   BE     12 rooms  |
| Bolz Hall                   BO      4 rooms  |
| Caldwell Laboratory         CL      7 rooms  |
| Campbell Hall               CM      9 rooms  |
| ...                         (88 buildings)   |
|----------------------------------------------|
| [ Search buildings                        ]  |
+----------------------------------------------+
```

Search is case-insensitive substring over `name` and `short`, prefix matches first, no fuzzy scoring. The field sits at the bottom in the thumb zone and the full list is scrollable and tappable with the keyboard dismissed, so the screen works with zero typing.

### Done when

- [ ] The list is the intersection of harvested building codes and `data/buildings.json` keys; a test asserts every listed code appears in both files and that the count is between 60 and 200
- [ ] Each row shows building name, `short`, and a room count taken after the safety filter
- [ ] Selecting a building emits the six-field object above with `source: "picked"` and `accuracy: 50`
- [ ] Ranking, the off-campus gate, and the unscheduled-hours screen contain zero reads of `origin.source`; the only two are the header label and the diagnostics panel
- [ ] From building `279` the top 20 results include rooms from at least 3 distinct buildings, proving no same-building or radius restriction
- [ ] `vacant.origin` is written on selection, restored on next launch, and while it is set `getCurrentPosition` is never called; a test injects a throwing position source and still renders a ranked list
- [ ] A control in the header names the picked building and clears it back to GPS in one tap, removing the key
- [ ] The picker opens from the denied state, the timeout state, and a permanent control on the results screen
- [ ] Search input's top edge is in the bottom 40% of a 390x844 viewport; every row is at least 44 CSS px tall; the full 88-row list renders at 320 px width and 200% zoom with no horizontal scroll
- [ ] Each row is one `<button>` whose accessible name is `"Dreese Laboratories, DL, 18 rooms"`

### Notes

Do not copy Roomix here. Its vacancy search returns nothing until a seed building is chosen, then expands outward with `if(d.b>200)break`, so picking narrows the answer to that building and its neighbours. In Vacant a picked building is only where you are standing. 36 of 38 classroom buildings sit within a 12 minute walk of the campus centroid, so a campus-wide list is already short and there is nothing to gain by cutting it.

The six shortcut buttons are a separate hand-maintained list of `buildingCode` values read from `data/buildings.json`, not from the harvest. Ohio Union, Thompson Library and 18th Avenue Library are places students stand, not places classes meet, so some of them will not be in the harvest at all. Test that every shortcut code resolves to a coordinate, or that row renders dead buttons after a term rollover.

`vacant.origin` is missing from the persistence table in `docs/research/ux-states.md`; add it. Unlike `vacant.lastpos` it does not expire after 6 hours, because it is a deliberate choice rather than a stale sensor reading. That is why the clear control belongs on the results screen and not in a menu.
