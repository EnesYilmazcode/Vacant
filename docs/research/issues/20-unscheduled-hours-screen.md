---
title: Build the unscheduled-hours screen that ranks buildings, not rooms
labels: ux, enhancement
milestone: Phase 3: App
estimate: M
order: 20
depends_on: result-screen, building-hours-scrape
---

The class schedule constrains about 943 of the 8,760 hours in a year. Outside that window every room in the index reads free, and the ranked list quietly becomes a distance sort wearing the clothes of a schedule answer. It happens every evening after the last class ends, every weekend (0 of 4,679 intervals in one sample, 1 Saturday and 1 Sunday in another), and on all 70-plus between-term days. A room list is the wrong answer there. The nearest buildings that hold classrooms, with their published hours, is the right one.

### What to do

Trigger off the index, not a constant. Four research passes measured the last class end at 20:15, 21:30, 22:15 and 22:30, so `Invert sections into data/rooms-<term>.json` derives the bounds at build time and `data/current.json` carries them:

```json
"busyDay": { "earliestStart": 480, "latestEnd": 1290,
             "weekdays": [false, true, true, true, true, true, false] }
```

```
inTerm = sessions.some(s => today in [s.start, s.end]) && !closedDays.has(today)
inDay  = busyDay.weekdays[dow]
      && nowMin >= busyDay.earliestStart && nowMin < busyDay.latestEnd
if (!inTerm || !inDay) -> unscheduled-hours screen
```

The unit becomes the building with a classroom count. Hide the duration chips. Read `hours[dow]` out of `data/buildings-hours.json` and bucket into three groups, never interleaved:

```
+----------------------------------------------+
| VACANT                             9:40p Thu |
|----------------------------------------------|
| Nothing is scheduled anywhere on campus      |
| right now, so the schedule cannot tell you   |
| what is empty. These are the nearest         |
| buildings that hold classrooms.              |
|----------------------------------------------|
| OPEN NOW   Registrar hours, updated Aug 26   |
|----------------------------------------------|
| Hitchcock Hall                         4 min |
| 11 classrooms            open till 11p       |
|----------------------------------------------|
| HOURS NOT PUBLISHED                          |
|----------------------------------------------|
| Timashev Music Building                2 min |
| 6 classrooms             hours unknown       |
|----------------------------------------------|
| 14 buildings are closed now             [ v ]|
+----------------------------------------------+
```

The all-week fallback comes from the hours file at build time as an `allWeek` array (buildings whose `hours[d]` is non-null for all seven days: measured EC, HI, IH, SU) plus the 24-hour 18th Avenue Library from LibCal. No building name is typed into app copy.

### Done when

- [ ] The screen triggers from `current.json.busyDay` and the session ranges. No time constant appears in the app source; a test asserts the trigger flips when `latestEnd` is changed in a fixture
- [ ] The reason sentence is the first text in the DOM, above the list, and the locked-door caveat is in it rather than in the footer
- [ ] The rendered unit is a building with a classroom count and a walk time. No room name and no duration chip is present in this state
- [ ] Buildings with `hoursSource: "registrar"` and a non-null `hours[dow]` render a close time and sort above every unknown-hours building
- [ ] Buildings with `hoursSource: "unknown"` render the literal string `hours unknown` and are sorted below the open group
- [ ] `grep -ri "usually" src/` returns nothing, and no code path substitutes a default open window when `hours` is null
- [ ] Buildings whose `hours[dow]` says closed at the current minute collapse behind one line stating the count, expandable
- [ ] The `generated` date from `buildings-hours.json` is rendered next to the open group
- [ ] With `buildings-hours.json` absent or every entry `unknown`, the screen renders the `allWeek` list plus the 24-hour library and nothing else, and a test covers that fixture
- [ ] `allWeek` and the library entry are read from data at runtime; a test asserts the strings `Enarson`, `Hitchcock`, `Independence`, `Sullivant` and `18th Avenue` appear in no source file
- [ ] Entering the state moves focus to the message heading and the heading is reachable by a screen reader before the list
- [ ] Renders at 320px CSS width and 200% zoom with no horizontal scroll

### Notes

The unknown path is the majority path. Only 47 of the roughly 116 buildings holding classrooms are in the Registrar pool, so around 60% of what this screen lists has no published hours at all. That is the reason the "never assume open" rule is a hard acceptance criterion and not a preference: a blanket assumed window overstates weekend open time by 837%, and only 5 of 47 pool buildings open Saturday, 11 on Sunday.

The A4 mockup in `ux-states.md` writes `usually open till 10p` with `hoursSource: "assumed"`. That predates the Registrar find and is superseded. Real hours or the word unknown, nothing in between.

All three of the README's hero rooms (Dreese 357, Baker Systems 120, Caldwell 177) sit in buildings closed both weekend days, and Dreese is a keycard building. That is the demo to run before calling this done.

Between-terms and next-term-unpublished belong to `Ship the term, calendar and staleness states, including an explicit exam-week refusal`. Their "show nearest buildings anyway" button lands here, so this screen has to work with no session in range at all.
