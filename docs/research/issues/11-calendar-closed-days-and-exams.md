---
title: Emit closed days and the exam window into the room index
labels: data, bug
milestone: Phase 1: Data pipeline
estimate: M
order: 11
depends_on: room-index-and-current-json
---

The class API is silent about the calendar in both directions. A meeting's `endDate` is the last day of instruction, so from Dec 10 through Dec 17 the busy list is empty for every room and Vacant would send someone into a 200-person final. And `holidaySchedule` is the literal string `"OSUSIS"` on all 4,931 sections sampled (`/v2/classes/holidaySchedule` and `/v2/classes/holidays` both 404), so on Nov 11 the grid marks 788 of 863 Wednesday busy rows occupied on a day nothing meets. That is 12 wrong weekdays out of the 83 between the first class and the last final.

### What to do

Vendor `https://mcmanning.github.io/ohio-state-ics/academic.ics` (489 events, 2021-2030) to `data/vendor/academic.ics` with a sibling meta file recording the fetch date. Match `SUMMARY` on the literal phrases `offices closed` and `offices open`. `DTEND` is exclusive on `VALUE=DATE` events, so `20261015..20261017` is Oct 15 and 16.

Emit into `rooms-<term>.json`:

```json
"closed": [
  { "date": "2026-09-07", "state": "offices-closed" },
  { "date": "2026-10-15", "state": "no-classes" },
  { "date": "2026-10-16", "state": "no-classes" },
  { "date": "2026-11-11", "state": "offices-closed" },
  { "date": "2026-11-25", "state": "no-classes" },
  { "date": "2026-11-26", "state": "offices-closed" },
  { "date": "2026-11-27", "state": "offices-closed" }
],
"exams": { "start": "2026-12-11", "end": "2026-12-17" },
"lowConfidence": [
  { "start": "2026-10-13", "end": "2026-10-16", "reason": "session-1-finals" }
]
```

The window comes from the Registrar finals page (`.../final-exams-schedule/autumn-2026-finals-schedule/`, four `<table>` elements of 14, 14, 10 and 8 rows). Take the window only; the class-time-to-exam-slot map is useless without the exam room, which lives in a separate Final Assignment List marked coming soon.

Cross-check every date against the Registrar 5-year view (`academic-calendar-5-year-view-2023-2028`), whose `<table>` elements sit in the raw HTML even though the rendered text needs JavaScript. On disagreement, fail the build and print both sides rather than picking a winner.

Closed-day count bounds are per term digit, not global:

```
digit 8 (Autumn):  5 <= n <= 9      # measured 7 on 1268
digit 2, digit 4:  set from the first real parse of that term, then committed
unknown digit:     refuse the build
```

### Done when

- [ ] `rooms-1268.json` carries `closed` (7 entries), `exams` and `lowConfidence` in the shapes above
- [ ] `data/vendor/academic.ics` is committed with its fetch date; nothing fetches it at runtime
- [ ] Every `closed[].date` is asserted inside the instruction window (2026-08-25 to 2026-12-09 for 1268); one outside fails the build
- [ ] `exams.start` is asserted greater than the max meeting `endDate`. Fixtures cover 1268 (2026-12-11 > 2026-12-09), 1262 (Apr 29 > 2026-04-27) and 1264 (Aug 3 > 2026-07-30)
- [ ] The ICS-versus-Registrar diff runs every build and exits non-zero on any date disagreement, printing both rows
- [ ] Closed-day count is bounded by term digit; an unknown digit refuses instead of defaulting
- [ ] A test asserts `2026-09-07` comes out `offices-closed` and `2026-10-15` comes out `no-classes`
- [ ] Each parser (ICS, 5-year table, finals page) fails the build on a zero-row result instead of emitting an empty array

### Notes

The ICS is third-party GitHub Pages, pre-generated rather than live-synced, and it already disagrees with the Registrar on one block: Dec 28-31 offices closed is missing from it. That falls outside the term so it will not trip the in-window assertion, but it is why the diff refuses instead of merging.

Oct 13-16 has three wrongness modes in four days. Oct 13-14 are Session 1 finals in the 7-week rooms (falsely free), Oct 15-16 are Autumn Break with offices open (falsely busy for full-term rooms), and full-term classes meet normally on Oct 13-14. The two ranges overlap on purpose.

`offices-closed` and `no-classes` are not shades of one thing. Oct 15 means free doors and free rooms, the best day of the term for this app. Sep 7 means the same rooms behind locked doors. Nothing in the class API separates them, which is the whole point of the test above.

This issue ships data only. `Ship the term, calendar and staleness states, including an explicit exam-week refusal` is what reads it.
