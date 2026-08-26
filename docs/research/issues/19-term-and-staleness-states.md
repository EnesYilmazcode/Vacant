---
title: Ship the term, calendar and staleness states, including an explicit exam-week refusal
labels: ux, bug, enhancement
milestone: Phase 3: App
estimate: M
order: 19
depends_on: result-screen, calendar-closed-days-and-exams
---

`Emit closed days and the exam window into the room index` writes `closed`, `exams` and `lowConfidence`; `Invert sections into data/rooms-<term>.json` writes `generated`, `instruction` and `next`. Nothing reads any of it yet, so the ranked list is the only screen the app has and it is wrong on 12 of the 83 weekdays between the first class and the last final. Finals is the worst case: meeting `endDate` maxes out at 2026-12-09 against a Dec 11-17 exam window, so every busy list is empty and each row reads "no further class scheduled" for a room holding a 200-person exam.

### What to do

One pure function, `resolveState({ now, current, index })`, returning a tagged state that the result screen switches on. Order matters more than the individual cases.

```
if floorCheck(index) fails            -> INDEX_REFUSED
if exams.start <= today <= exams.end  -> EXAM_REFUSAL
if today outside every session range:
     current.next present             -> BETWEEN_TERMS
     else                             -> TERM_ENDED
if closed[today].state == offices-closed -> CAMPUS_CLOSED
if closed[today].state == no-classes     -> RANKED + quiet-campus line
if today inside a lowConfidence range    -> RANKED + both failure modes named
else                                     -> RANKED
```

The active term is whichever harvested term's `current.instruction` window contains today. No month arithmetic, no term-digit arithmetic, no `searchableTermsV2` dates (they are eleven-month search visibility windows: Autumn 2026 "starts" 2026-02-09 by that field).

Staleness is a separate layer computed from `current.generated`, never from anything inside `rooms-<term>.json`: silent under 14 days, one grey line at 14, a bordered banner at 35, and past `instruction[1]` the list goes behind a second tap. Offline with a cached grid renders as an age, never as an error.

```
+--------------------------------------+
|  Finals week                         |
|                                      |
|  Ohio State reassigns rooms for      |
|  exams and does not publish the      |
|  assignments. Vacant cannot tell     |
|  you what is free until December 18. |
|                                      |
|  [ Show nearest buildings anyway ]   |
+--------------------------------------+
```

### Done when

- [ ] `resolveState` is pure, takes an explicit clock and an explicit index, and is exercised with no network in every test below
- [ ] Term selection reads `current.instruction` only; `grep -rn "getMonth\|1268\|searchableTerms" app/` returns nothing outside fixtures
- [ ] `2026-12-15` renders the exam refusal with no ranked rows in the DOM, and names `2026-12-18` as the date it can answer again
- [ ] `2026-09-07` renders `CAMPUS_CLOSED` as one message with zero ranked rows; `2026-10-15` ranks normally and says campus is quiet because classes are out
- [ ] `2026-10-13` and `2026-10-14` render the low-confidence window naming both failure modes: Session 1 finals running in the 7-week rooms, and full-term classes meeting normally
- [ ] `2026-12-20` with `next` present renders `BETWEEN_TERMS` naming 2026-12-09, 2027-01-11 and the day count, with a "show nearest buildings anyway" action, and its copy shares no sentence with the stale copy
- [ ] `2026-12-20` with `next` absent renders `TERM_ENDED` and prints the `generated` instant it last checked
- [ ] An index below its term-digit floor renders `INDEX_REFUSED` with zero ranked rows and prints observed against expected, for example `rooms 198 < 400`
- [ ] Staleness tests at 13, 14, 34, 35 days and past `instruction[1]` produce silent, line, line, banner, gated
- [ ] `navigator.onLine === false` with a cached grid shows the age line, never an error state
- [ ] Each state's message heading carries `tabindex="-1"` and receives focus on entry, asserted in a test

### Notes

The exam check has to run before the between-terms check. Finals week is outside every session range (sessions end 2026-12-09, exams start 2026-12-11), so a naive order sends Dec 11-17 to `BETWEEN_TERMS`, which says every room is free. That is the exact wrong answer this issue exists to prevent.

Oct 15 and 16 sit in both `closed` and `lowConfidence`. The ranges overlap deliberately. Pick the `closed` message and drop the low-confidence one on those two days rather than stacking banners.

Between-terms is not stale. The data is fresh and campus really is empty for 83 of 365 days (2026-04-28 to 05-10, 2026-07-31 to 08-24, 2026-12-10 to 2027-01-10, 2027-04-27 to 05-09), so reusing stale wording there is a lie in the other direction. Staleness itself is not decoration either: 81% of campus reads free on a healthy day, so a broken Vacant looks like a Vacant that found lots of rooms, and the banner is the only channel that reports a dead weekly build to the person who can fix it.
