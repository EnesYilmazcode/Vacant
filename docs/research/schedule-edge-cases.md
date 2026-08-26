# Schedule edge cases: where "empty is the complement of busy" gives a wrong answer

Research note, 2026-08-26. Every number here came from a live probe. The commands
are inline so you can re-run any of them.

The model in the README is right. It is just incomplete in twelve specific ways,
and two of them are big enough to make the app wrong for whole weeks at a time.

**One sentence on the problem:** the class schedule tells you when a room is booked
for *regularly scheduled instruction*, which is a strict subset of when the room is
occupied and a strict superset of when instruction actually happens.

**One sentence on the fix:** the room index needs three things it does not have in
the README's shape, a campus closure date list, an exam-week block, and a room
whitelist, and all three are published by the registrar as parseable HTML.

```
   WHAT THE API GIVES YOU              WHAT THE STUDENT ASKS
   +--------------------------+        +---------------------------+
   | regularly scheduled      |        | is anyone in this room    |
   | instruction, Aug25-Dec9, |  --->  | at 2pm on this exact date |
   | minus holidays it does   |        +---------------------------+
   | not know about           |
   +--------------------------+
        |            |                     the gap, by day:
        |            +--> 7 no-class weekdays it calls BUSY   (hides rooms)
        +-----------------> 5 exam days it calls FREE          (sends you into a final)
```

Twelve of the 83 weekdays between the first day of class and the last final, 14.5%,
Vacant answers wrong for calendar reasons alone, before any room-level problem.

---

## Headline numbers

Campus-wide facet counts, Autumn 2026, Columbus, from one request:

```
curl 'https://content.osu.edu/v2/classes/search?q=&campus=col&term=1268&p=1&sort=catalogNumber'
```

| Facet | Value | Sections |
|---|---|---|
| total | | **26,298** |
| class-session | Regular Academic Term (`1`) | 23,769 (90.4%) |
| | Session 2 (`7w2`) | 1,808 (6.9%) |
| | Session 1 (`7w1`) | 721 (2.7%) |
| instruction-mode | In Person (`p`) | 22,710 (86.4%) |
| | Distance Learning (`dl`) | 2,632 (10.0%) |
| | Hybrid Delivery (`hy`) | 911 (3.5%) |
| | Distance Enhanced (`dh`) | 45 (0.2%) |
| component | Independent Study (`ind`) | **13,391 (50.9%)** |
| | Lecture | 7,236 |
| | Laboratory | 2,307 |
| | Seminar | 1,393 |
| | Recitation | 1,196 |
| | Field Experience | 439 |
| | Clinical | 211 |
| | Workshop | 125 |

Every facet above sums exactly to 26,298, so those lists are complete. The
`academic-program` facet shows 10 items and sums to 25,167, so that one *is*
truncated. Assume a 10-item cap on any facet whose items do not sum to the total.

Half the catalog is Independent Study and Independent Study never has a room. That
matters for the harvest budget, not for correctness.

### The working sample

4,931 unique sections: all of CSE (6 pages), page 1 of 18 diverse subjects, all four
pages of `class-session=7w1`, three pages of `class-session=7w2`. Plus 1,000 more
sections from Summer 2026 and Spring 2026 for the cancellation hunt.

```
sections                          4,931
meetings                          5,239
  meetings with no facilityId     1,973  (37.7%)
  meetings with facilityId ONLINE   785  (15.0%)
  meetings on a real room         2,481  (47.4%)
distinct real rooms                 486
distinct buildings                   74
day-level busy rows (raw)         4,263
day-level busy rows (deduped)     3,798   -> 10.9% of raw rows are duplicates
sections that produce any busy    2,269  (46.0%)
```

Room yield by component:

| Component | with a real room | none | % |
|---|---|---|---|
| Workshop | 21 | 3 | 87.5% |
| Recitation | 375 | 54 | 87.4% |
| Laboratory | 689 | 159 | 81.2% |
| Lecture | 1,120 | 608 | 64.8% |
| Seminar | 56 | 233 | 19.4% |
| Field Experience | 6 | 89 | 6.3% |
| Independent Study | 2 | 1,442 | 0.1% |
| Clinical | 0 | 74 | 0.0% |

Two Independent Study sections do carry a real room, so you cannot filter on
component. Filter on `facilityId`.

---

## Ranked defects

Ranked by how badly they mislead a student standing outside a building.

---

### 1. Finals week. Every room on campus reads free, for seven days.

**Defect.** Vacant tells a student that Mendenhall 100 is theirs for eight hours on
Tuesday December 15 while 200 people sit a final in it.

The API's meeting `endDate` is the **last day of instruction**, never the last day
of the term. Measured across three terms:

| Term | Max meeting `endDate` in sample | Registrar's exam window |
|---|---|---|
| Autumn 2026 (1268) | **2026-12-09** | Dec 11 - Dec 17 |
| Spring 2026 (1262) | 2026-04-27 | Apr 29 - May 5 |
| Summer 2026 (1264) | 2026-07-30 | Aug 3 - Aug 5 |

The exam windows in that table are not inferred, they are read off the registrar's
5-year calendar, and each one lines up exactly with the "last day of regularly
scheduled classes" row that matches the API's max `endDate`. Three independent terms,
three exact matches. The rule is real, not a one-term coincidence.

```
python -X utf8 -c "import json;S=json.load(open('pool.json'));print(max(m.get('endDate') or '' for s in S for m in (s.get('meetings') or [])))"
# 2026-12-09
```

So from Dec 10 through Dec 17 the busy list is empty for every room and Vacant
reports 100% of campus as free, all day, for a week. This is the worst failure
because it is total, it is campus-wide, and it lands in the exact week when finding
somewhere to sit matters most.

**Does the API expose an exam schedule? No.** Confirmed two ways.
`classes.osu.edu/osu-mobile.js` (389 KB) references exactly three paths under `/v2`:
`/classes/search`, `/classes/searchableTermsV2`, `/classes/availability` (the last is
dead, 503). And eight guessed paths all returned 404:

```
/classes/exams  /classes/examSchedule  /classes/finalExams  /classes/academicCalendar
/classes/holidaySchedule  /classes/holidays  /classes/sessions  /classes/terms
```

**The registrar does.**
`registrar.osu.edu/staff-resources/class-catalog-and-space/final-exams-schedule/autumn-2026-finals-schedule/`
is plain HTML with four `<table>` elements and no JavaScript rendering. It states the
window, **December 11 2026 to December 17 2026, Columbus Campus**, and gives a
deterministic map from (first meeting day of the first whole week, class start time)
to (exam date, exam time). Excerpt, Monday-first classes:

| Class starts between | Final on | Final at |
|---|---|---|
| 8:00am - 8:49am | Monday Dec 14 | 8:00am-9:45am |
| 8:50am - 9:39am | Monday Dec 14 | 10:00am-11:45am |
| 9:40am - 10:29am | Tuesday Dec 15 | 10:00am-11:45am |
| 2:40pm - 3:29pm | Friday Dec 11 | 12:00pm-1:45pm |
| 6:00pm and after | Monday Dec 14 | 8:00pm-9:45pm |

Three such tables exist (Monday-first 13 rows, Tuesday-first 13 rows, Wednesday-first
9 rows) plus a transposed matrix. All parse with:

```python
tabs = re.findall(r'(?is)<table.*?</table>', page)   # -> 4 tables
```

**The catch.** The registrar publishes the exam *room* separately, in the "Autumn
2026 Final Assignment List", and for Autumn 2026 it is marked "coming soon". The
Summer version is a Tableau view at
`dataviz.rae.osu.edu/t/public/views/EARI-FinalExamAssignments-SummerTerm/Dashboard`.
So the exam room is not derivable from the class schedule, only the exam time is. The
exception rules on that page repeatedly say "in the regularly scheduled classroom",
so the regular room is the right default, but do not present it as certain.

**Fix.** Add an `exams` block to the room index:

```json
"exams": { "start": "2026-12-11", "end": "2026-12-17",
           "map": [{"firstDay":"mon","from":"8:00 am","to":"8:49 am",
                    "date":"2026-12-14","start":480,"end":585}] }
```

Then during that window either project each full-term section's regular room into its
exam slot and treat everything else as unknown rather than free, or, simplest and
honest, put the app into exam mode: "Finals week. Ohio State reassigns rooms for
exams and does not publish the assignments in the class API. Vacant cannot tell you
what is free until December 18." That costs one week of usefulness and buys you never
being confidently wrong. Do that for v1.

---

### 2. Partial-term sessions. 9.6% of sections, and `sessionCode` alone gets them wrong.

**Defect.** Two of them. Ignore date ranges entirely and a Session 2 class blocks its
room for the seven weeks before it starts, and a Session 1 class blocks it for the
seven weeks after it ends. Key the busy intervals on `sessionCode` instead of on the
actual dates and you mis-date 11 sections in a 4,931-section sample.

Campus-wide, 2,529 of 26,298 sections (9.6%) are partial-term. Measured date ranges:

```
SECTION startDate..endDate            sections
  2026-08-25 .. 2026-12-09              3,534   sessionCode 1     full term
  2026-08-25 .. 2026-10-12                710   sessionCode 7W1
  2026-10-19 .. 2026-12-09                676   sessionCode 7W2
  2026-08-24 .. 2026-10-09                  9   sessionCode 7W1   all LAW
  2026-08-25 .. 2026-10-13                  2   sessionCode 7W1   all PHR
```

Five ranges, not one. The Moritz College of Law runs its own calendar: LAW 8950 and
friends start a day early (Aug 24) and end three days early (Oct 9). Two Pharmacy
sections end a day late. **So `sessionCode` is a label, not a date range. Build the
session table by deduping the observed `(startDate, endDate)` pairs.**

Meeting dates matched section dates in all 2,481 real-room meetings, zero mismatches,
so you can read either. Read the meeting's, it is closer to the truth.

Summer is worse. Summer 2026 (`term=1264`) has **eight** session codes, not three:

```
1S   2026-05-11..2026-07-30    8W1  2026-05-11..2026-07-02
8W2  2026-06-05..2026-07-30    6W1  2026-05-11..2026-06-18
6W2  2026-06-22..2026-07-30    4WS  2026-05-11..2026-06-04
4W2  2026-06-05..2026-07-02    4W3  2026-07-06..2026-07-30
```

Nothing may hardcode "three sessions".

**Fix.** The README's `sessions` array and `busy: [[weekday, start, end, sessionIndex]]`
shape is exactly right. Just build the array from observed dates and assert its length
is between 1 and 12 in the harvest guard.

---

### 3. Half the rooms in the schedule are not rooms you can sit in.

**Defect.** Vacant offers "Timashev 583, 3 seats, free for 4 hours". That is a music
practice room and it is locked. It offers "PAES 60, 0 seats", which is a gym floor,
and "Waterman Multispecies Animal Learning Center 100, 480 seats", which is a
livestock barn on West Campus.

Of the 486 real rooms in the sample, **258 (53%) are general-assignment classrooms and
228 (47%) are not**. 20 rooms (4.1%) report `facilityCapacity: 0`.

The registrar publishes the whitelist and it joins on `facilityId` with no fuzzy
matching at all:

```
registrar.osu.edu/staff-resources/class-catalog-and-space/general-assignment-rooms/autumn-2026-general-assignment-rooms/
```

Plain HTML, **327 unique Facility IDs across 43 buildings**, each with capacity and
room characteristics (whiteboards, windows, moveable seating, computer lab):

```
Building: Agricultural Administration   Building Number: 003
Facility ID: AA0246   Capacity: 49
Room Characteristics: 30 - Moveable Tablet Arm Chairs, 39 - Windows,
                      41 - Black Out Shade, 44 - Whiteboards
```

Parse with `re.findall(r'Facility ID:\s*([A-Z0-9]+)', text)`. 327 hits, 327 unique.

`facilityType` turns out to be an almost perfect proxy, which closes one of the
README's two known unknowns:

| facilityType | rooms in sample | on the GA list | % |
|---|---|---|---|
| `1C` | 53 | 50 | **94%** |
| `1B` | 283 | 206 | **73%** |
| `1A` | 10 | 2 | 20% |
| `2A` `2M` `2K` `2H` `2P` `2Q` | 99 | 0 | **0%** |
| `5A` `5G` `5J` `5K` `5L` | 14 | 0 | **0%** |
| `6C` `6F` `6L` | 15 | 0 | **0%** |
| `PERF` `LAB` `SMNR` | 12 | 0 | **0%** |

Every type outside the `1x` family is 0% general assignment. What they actually are,
read off the room names:

- `5A` capacity 3 to 12, all Timashev Music Building. Practice rooms.
- `5K` capacity 5 to 9, Fisher Hall and Gerlaugh Hall. Team breakout rooms.
- `2H` capacity 0, all PAES building. Gyms, pools, dance floors.
- `PERF` capacity 100 to 200, Weigel Hall, Sullivant 320, Timashev. Concert halls.
- `6C` Ohio Stadium 161 capacity 300, Timashev 120 capacity 200.
- `6F` the ONLINE pseudo-room plus the Waterman animal barn, capacity 480.
- `2A` `2M` `2K` departmental teaching labs and studios. Real rooms, but somebody
  else's, and often keycarded.

Note that `facilityType` also takes non-numeric values (`PERF`, `LAB`, `SMNR`), so do
not parse it as a code with a leading digit and a letter.

**Fix.** Ship the GA list as `ga-rooms.json` and use it as a hard tier. Tier 1, on the
GA list, offer freely. Tier 2, `facilityType` starts with `1` but not on the GA list
(77 rooms), offer with "departmental room, may be locked". Tier 3, everything else, do
not offer at all. Drop `facilityCapacity <= 8` regardless of tier.

Also note the **69 GA rooms that appear on the registrar list but never showed up in
my 4,931-section sample**. Some are genuinely unscheduled, some are just in subjects I
did not pull. A full harvest should recover most of them, and any GA room with zero
busy intervals is the single best result Vacant can return.

---

### 4. `facilityId: "ONLINE"` is a fake room with 998 seats and no address.

**Defect.** A naive harvest creates one room called ONLINE, gives it 998 seats, the
largest capacity on campus, and gives it 371 real busy intervals. If the ranking ever
breaks a tie on seats, ONLINE wins. Its `buildingCode` is the string `"ONLINE"`, so
the coordinate join misses, distance is NaN, and NaN in a JavaScript comparator sorts
unpredictably rather than sorting last.

```json
{ "facilityId": "ONLINE", "facilityType": "6F", "facilityDescription": "ONLINE",
  "facilityCapacity": 998, "buildingCode": "ONLINE", "room": null,
  "startTime": "12:00 pm", "endTime": "12:00 pm",
  "monday": false, "sunday": false }
```

785 ONLINE meetings in the sample. 373 have real day flags. 371 have real,
non-degenerate times. All 785 have capacity 998 and buildingCode ONLINE.

**Do not filter on `instructionMode`.** That is the intuitive fix and it is wrong in
both directions:

| instructionMode | real room | ONLINE | no room |
|---|---|---|---|
| In Person | 2,386 | 0 | 1,945 |
| Distance Learning | **0** | 753 | 2 |
| Hybrid Delivery | **81** | 15 | 24 |
| Distance Enhanced | **14** | 17 | 2 |

Distance Learning never touches a real room, so dropping it is harmless. But Hybrid
Delivery and Distance Enhanced hold 95 real-room meetings between them, and dropping
those would mark occupied rooms free. Meanwhile 1,945 In Person meetings have no room
at all, so In Person is not a signal either.

**Fix.** One rule, applied at the meeting level, not the section level: `facilityId`
must be present, must not equal `"ONLINE"`, and `buildingCode` must parse as a real
building. Add a harvest guard that refuses to write if `"ONLINE"` survives into
`rooms`.

---

### 5. Holidays and breaks. Seven weekdays where Vacant hides almost everything.

**Defect.** On Wednesday November 11, Veterans Day, Ohio State holds no classes. My
sample has 863 Wednesday busy rows and **788 of them (91.3%) are active on that
date**, so Vacant reports 91% of its busy grid as occupied on a day when the entire
grid is free. The app looks broken on exactly the days a student has time to kill.

`holidaySchedule` is the field that should answer this and it does not.

```
python -X utf8 -c "import json,collections;S=json.load(open('pool.json'));print(collections.Counter(s['holidaySchedule'] for s in S))"
# Counter({'OSUSIS': 4931})
```

**One value, `"OSUSIS"`, on all 4,931 sections across every subject, session, and
career.** It is the name of a PeopleSoft holiday-schedule record, not its contents.
The API exposes no dates, and `/classes/holidaySchedule` 404s.

**The registrar publishes it, in an HTML `<table>`, five years at a time**, at
`registrar.osu.edu/academic-calendar/academic-calendar-5-year-view-2023-2028/`. The
page text is JavaScript-rendered but **the tables are in the raw HTML** and parse with
a two-line regex. Autumn 2026, complete:

| Event | Date |
|---|---|
| Semester and first-session classes begin | Tue Aug 25, 2026 |
| **Labor Day, no classes, offices closed** | **Mon Sep 7, 2026** |
| Last day of first-session classes | Mon Oct 12, 2026 |
| First-session final exams | Tue Oct 13, 2026 |
| First-session final exams | Wed Oct 14, 2026 |
| **Autumn Break, no classes, offices open** | **Thu Oct 15, 2026** |
| **Autumn Break, no classes, offices open** | **Fri Oct 16, 2026** |
| Second-session classes begin | Mon Oct 19, 2026 |
| **Veterans Day, no classes, offices closed** | **Wed Nov 11, 2026** |
| **Thanksgiving Break begins, no classes, offices open** | **Wed Nov 25, 2026** |
| **Thanksgiving Day, no classes, offices closed** | **Thu Nov 26, 2026** |
| **Indigenous Peoples' Day observed, no classes** | **Fri Nov 27, 2026** |
| Last day of semester and second-session classes | Wed Dec 9, 2026 |
| Final examinations | Fri Dec 11 to Thu Dec 17, 2026 |
| Autumn Commencement | Sun Dec 20, 2026 |

Seven no-class weekdays out of 77 instruction weekdays, **9.1% of the term**. Rows in
my sample that would be falsely reported busy on each:

```
2026-09-07 Mon   689
2026-10-15 Thu   717
2026-10-16 Fri   473
2026-11-11 Wed   788
2026-11-25 Wed   788
2026-11-26 Thu   757
2026-11-27 Fri   507
```

Parse it:

```python
s = urlopen('https://registrar.osu.edu/academic-calendar/academic-calendar-5-year-view-2023-2028/').read().decode()
for tb in re.findall(r'(?is)<table.*?</table>', s):
    for r in re.findall(r'(?is)<tr.*?</tr>', tb):
        cells = [strip_tags(c) for c in re.findall(r'(?is)<t[dh][^>]*>(.*?)</t[dh]>', r)]
        # cells[0] = event label, cells[1..5] = the five academic years
```

Column 4 is Autumn 2026. The same page also carries Spring 2027 and Summer 2027, so
the harvest can stay ahead of itself, and a sibling page covers 2028 to 2031.

**Fix.** Add a `closed` array of ISO dates to the room index and subtract them before
any complement. It is seven strings per term.

```json
"closed": ["2026-09-07","2026-10-15","2026-10-16","2026-11-11",
           "2026-11-25","2026-11-26","2026-11-27"]
```

Two subtleties worth a line of UI each. "No classes, offices closed" (Labor Day,
Veterans Day, Thanksgiving Day) means buildings are also **locked**, so the rooms are
free and unreachable, which is a different message from "free". "No classes, offices
open" (Autumn Break Oct 15-16, Thanksgiving Break Nov 25) means buildings are open and
everything really is available, which is Vacant's best day of the term and it should
say so.

---

### 6. The Oct 13-16 gap week has three different truths in four days.

**Defect.** Session 1 classes end Oct 12 and Session 2 classes start Oct 19, so every
7-week room has an empty busy list from Oct 13 to Oct 18. But Oct 13 and 14 are
**Session 1 final exams**, held in those same rooms. From
`registrar.osu.edu/staff-resources/class-catalog-and-space/final-exams-schedule/autumn-session-1-finals-schedule/`:

```
Event               MTWRF(110)  TWRF(110)  MWF(110)  TR(160)
Last Day of Instr.      M           F          M        R
Reading Day             T           M          T        M
Final Exam Day          W           T          W        T
```

So Oct 13-14 are false-free for 7-week rooms, Oct 15-16 are false-busy for full-term
rooms, and full-term classes meet normally on Oct 13-14. Four consecutive days, three
different wrongness modes.

**Fix.** The `closed` list handles Oct 15-16. For Oct 13-14, the honest v1 answer is
to mark those two days low-confidence and say "first-session finals are running
today". Anyone who wants to be exact can project the 7W1 rooms into their exam slots
using the same table as defect 1.

---

### 7. Off-campus buildings, and the README's Overpass bounding box drops them.

**Defect.** `campus=col` does not mean "on the Columbus campus". It means "belongs to
the Columbus campus's catalog". Two of the 74 buildings in my sample are nowhere near
the Oval:

| facilityId | Building | buildingCode | Distance from the Oval | Inside README bbox? |
|---|---|---|---|---|
| `KT0255` | Knowlton Airport Terminal | 1019 | **10,436 m** | **no** |
| `MALC0100`, `MALC0115` | Waterman Multispecies Animal Learning Ctr | | **2,906 m** | **no** |

Measured via Nominatim, haversine against (39.9995, -83.0130). OSU Airport resolves to
(40.0811, -83.0735), Waterman to (40.0129, -83.0423).

The README's Overpass query is

```
way[building][name](39.990,-83.040,40.008,-83.008);
```

which is roughly 2.0 km by 2.7 km. Both buildings fall outside it. So those rooms get
no coordinate and either vanish silently or, worse, get a null that sorts to the top
of a distance ranking. A 10 km walk to the airport is not a near miss, it is the kind
of result that makes someone delete the app.

Section-level `location` also carries non-Columbus values, though none of them held a
real room in my sample:

```
CS-COLMBUS  4,925    CS-INTRNTL  3    CS-OFFCAMP  2    CS-WOOSTER  1
```

`PLNTPTH 6010` section `101W` has `campus: "Columbus"`, `secCampus: "COL"`, and
`location: "CS-WOOSTER"`. Wooster is 90 miles away. It has no room today, but the
field exists and a future term may fill it.

**Fix.** Three parts. Widen the Overpass bbox to roughly
`(39.975, -83.055, 40.095, -83.000)` so West Campus, the airport, and the medical
campus are all inside. Hard-cap the result list at a walkable radius, 2 km is
generous, and drop anything beyond it rather than showing a 130 minute walk. And treat
`location != "CS-COLMBUS"` as a drop.

---

### 8. Cross-listed sections double-book their own room. 10.9% of busy rows.

**Defect.** Not a correctness bug for "is it busy", since the union of two identical
intervals is the same interval. It is a payload bug and a display bug: the file is 11%
bigger than it needs to be, and any "next class here" or "how booked is this room"
label counts the same class two or three times.

Measured on the 4,263 day-level busy rows in the sample:

```
room/day/time/date slots claimed by more than one distinct section:  426
redundant busy intervals produced by that:                           445
raw rows 4,263 -> unique rows 3,798                                  10.9% duplication
```

A real example, three sections, one room, one slot:

```
room AA0246  Wednesday  9:00-10:10  2026-08-25..2026-10-12
   cls 11093   HUMNNTR 7789-0010    combinedSection='Closed'
   cls 30992   ANIMSCI 7789-1010    combinedSection='Closed'
   cls 32817   ANIMSCI 7789-101W    combinedSection='Closed'
```

**`combinedSection` is not what the name suggests.** It is not a pointer to the
partner section and it carries no ID. Observed values:

```
None       4,331
'Closed'     592
'S'            8
```

It reads as the enrollment state of the combined pool. Among the 426 colliding slots,
839 participating sections had `combinedSection='Closed'`, 30 had `None`, and 2 had
`'S'`. So it is a decent hint that a section is combined with something, and a useless
key for finding what.

Genuine partial overlaps, as opposed to identical duplicates, are rare: **2 in the
whole sample**, both LAW 8950 sections in Drinko Hall 251 whose windows overlap by 165
minutes without matching. Those are real data errors in the source and interval
merging absorbs them harmlessly.

**Fix.** Do not try to resolve combined sections. Dedupe structurally: build the busy
list as a set of `(room, weekday, start, end, sessionIndex)` tuples and merge
overlapping intervals per room per weekday per session. That collapses combined
sections, duplicated meetings, and genuine back-to-back classes in one pass.

---

### 9. A section can list the same meeting ten times, and one copy can disagree.

**Defect.** Same as above but within one section, and with a nasty wrinkle.

```
CSE 2112 section 0031, class 8823, Laboratory, In Person, 10 meetings:
   #1  BE0120  2:20 pm - 3:40 pm  Tue   #2  BE0470  2:20 pm - 3:40 pm  Tue
   #3  BE0120  2:20 pm - 3:40 pm  Tue   #4  BE0470  2:20 pm - 3:40 pm  Tue
   #5  BE0120  2:20 pm - 3:40 pm  Tue   #6  BE0470  2:20 pm - 3:40 pm  Tue
   #7  BE0120  2:20 pm - 3:40 pm  Tue   #8  BE0470  2:20 pm - 3:40 pm  Tue
   #9  BE0120  2:20 pm - 3:40 pm  Tue   #10 BE0470  2:20 pm - 3:20 pm  Tue
```

Meeting #10 ends at 3:20 pm, twenty minutes earlier than its nine identical siblings.
Deduping on the whole tuple keeps both and produces a spurious extra interval. Merging
overlapping intervals absorbs it correctly.

Meetings-per-section distribution:

```
1 meeting  4,692    2: 210    3: 15    4: 5    5: 2    6: 2    7: 2    8: 2    10: 1
```

239 sections (4.8%) have more than one meeting. Most are genuine (a lecture room plus
a recitation room, a Monday room plus a Wednesday room). PHR 8130 lists `PK0200
5:10-6:30 Monday` twice. 20 exact duplicate day-rows within a single section exist
across 9 distinct keys.

**Fix.** Merge intervals. Covered by the fix in defect 8.

---

### 10. Meetings with no room, no days, or no times. They self-filter cleanly.

Good news, this one is tidy. Counts over 5,239 meetings:

```
no facilityId          1,973  (37.7%)
facilityId == ONLINE     785  (15.0%)
no day flags set       2,191  (41.8%)
no startTime/endTime   2,166  (41.3%)
startTime == endTime      33   (0.6%)
```

The important measurement: **after dropping `facilityId` absent and `facilityId ==
"ONLINE"`, exactly zero of the remaining 2,481 meetings had a missing day flag, a
missing time, or a zero-length window.** A real room always comes with real days and
real times.

One case worth knowing: a meeting can have a time and no room. `CSE 5889` section
`0010` is In Person, Lecture, meets Tuesday 2:00-3:00 pm, and has no `facilityId`.
Room to be assigned. Nine more CSE lecture sections have neither time nor room.

Two fields that look useful and are not:

- **`meetingDays` is the empty string on all 4,931 sections.** Never populated. The
  seven booleans on the meeting are the only day source.
- **`standingMeetingPattern` is null on 4,669 of 5,239 meetings (89.1%).** When set it
  is `'TR'`, `'MWF'`, `'WF'`, `'R'`, `'MW'`, `'F'`, `'W'`. Do not depend on it.

**Fix.** Drop by `facilityId`, then assert. If any surviving meeting lacks a day or a
time, that is a schema change and the harvest should refuse to write.

---

### 11. Cancelled sections. Never observed, guard anyway.

**Defect if it happens.** A cancelled section that still carries its meetings would
block its room for the whole term, permanently, and no student report would ever clear
it because there is no class to observe.

Measured. `status` and `cancelDate` over **5,931 sections across three terms**,
including two terms that have already finished and so had a full semester to
accumulate cancellations:

```
Autumn 2026 (1268), 4,931 sections:  status='A' 4,931   cancelDate=null 4,931
Summer 2026 (1264),   600 sections:  status='A'   600   cancelDate=null   600
Spring 2026 (1262),   400 sections:  status='A'   400   cancelDate=null   400
```

Zero non-`A` statuses. Zero non-null `cancelDate`. There is no `status` facet on the
search endpoint, so there is no way to ask for them either.

**Conclusion.** The search API almost certainly filters to active sections
server-side. `cancelDate` is a schema passthrough that is always null. This is good
news and it is the one edge case in this document that costs nothing.

**Fix.** One line, and a guard: skip any section where `status != 'A'` or `cancelDate`
is non-null, and log loudly if that count is ever above zero, because it means the
API's behavior changed.

---

### 12. Term rollover. A date-driven weekly build will ship an empty grid.

**Defect.** Vacant rebuilds weekly. If the build script computes the term code from
the date, it will switch to Spring 2027 before Spring 2027 exists.

```
GET /classes/search?q=&campus=col&term=1272&p=1&sort=catalogNumber
-> totalItems: 0
```

Probed today, 2026-08-26. Finder saw the same on 2026-08-18. `1272` is a valid,
well-formed code and it is empty.

`searchableTermsV2` will not save you either, because its `startDate` and `endDate`
are **search visibility windows, not academic dates**:

```json
{"strm":"1268","descr":"Autumn 2026","startDate":"2026-02-09","endDate":"2027-01-31"}
```

Autumn 2026 "starts" on February 9 2026 by that field. Classes start August 25. Do not
use those dates for anything.

**Fix.** Read the term list from `searchableTermsV2`, pick the term whose *instruction*
window (from the harvested meeting dates, or from the registrar calendar table)
contains today, and refuse to write a `rooms-*.json` whose room count or
busy-interval count is below a floor.

---

## Field notes, in case they save you an hour

**`facilityDescription` is the building. `buildingDescription` is the room.** The names
are backwards from what you would guess:

```json
"facilityId": "DL0357",  "facilityDescription": "Dreese Laboratories",
"buildingCode": "279",   "buildingDescription": "Dreese Lab 357",
"room": "357",           "buildingDescriptionShort": "DL 357"
```

`facilityId` is the join key everywhere, including on the registrar's General
Assignment Rooms page. It is a 2 to 4 letter building abbreviation plus a room, and
sometimes a trailing letter (`RF0112A`, `WG0100A`, `TMVN0583`). Do not try to split it
into parts, treat it as opaque.

**`facilityGroup`** is true on exactly 2 of 486 rooms (`MALC0100`, `RF0112A`). Unclear
meaning, too rare to matter.

**`type`** is `'E'` (4,001) or the JSON boolean `false` (930), not a string in the
second case. It maps to enrollment versus non-enrollment section: 86% of `type=false`
sections have a real room versus 37% of `type='E'`, because recitations and labs are
non-enrollment. Not usable as a filter, but do not assume it is a string.

**`campus`** is `"Columbus"` and `secCampus` is `"COL"` on all 4,931. Only `location`
varies.

**Weekend classes exist but barely.** 4 Saturday busy rows and 2 Sunday rows out of
3,798. Do not special-case weekends in the data model, but do remember buildings are
mostly locked.

**Busy rows by weekday**, useful for sanity-checking a build:

```
mon 735   tue 840   wed 863   thu 799   fri 555   sat 4   sun 2
```

Friday is 36% lighter than Wednesday. That is real, not a harvest bug.

---

## Two data sources this project should adopt

Both are plain HTML on registrar.osu.edu, both parse with a regex, both key on the
same `facilityId` the API uses, and neither is behind a login.

1. **Academic calendar, 5-year view.** Holidays, breaks, session boundaries, exam
   windows, 2023 through 2028 in one page.
   `registrar.osu.edu/academic-calendar/academic-calendar-5-year-view-2023-2028/`
   The `<table>` elements are in the raw HTML even though the rendered text needs
   JavaScript. Three tables, one per term, roughly 26 rows each. A sibling page covers
   2028 to 2031.

2. **General Assignment Rooms, per term.** 327 rooms for Autumn 2026, with capacity and
   room characteristics.
   `registrar.osu.edu/staff-resources/class-catalog-and-space/general-assignment-rooms/autumn-2026-general-assignment-rooms/`

Two more worth a look but not investigated here:

3. **Classroom Pool Building Schedule**, per term, at
   `registrar.osu.edu/staff-resources/class-catalog-and-space/classroom-pool-building-schedule/autumn-2026-classroom-pool-building-schedule/`.
   The title strongly suggests this is the building open-hours dataset the README lists
   as a known unknown. It is a subpage of the same accordion CMS as the GA rooms page,
   so it should parse the same way.

4. **PeopleSoft Room Matrix**, public, no login:
   `courses.osu.edu/psp/csosuct/EMPLOYEE/PUB/c/OSR_CUSTOM_MENU.OSR_ROOM_MATRIX.GBL`.
   This is almost certainly what Roomix reads. Useful as an independent check that your
   inverted index matches Ohio State's own, not as a source, since it is the Oracle
   ICAction interface Finder already rejected.

---

## What the harvest guard should assert

The README asks for one guard on room count. Here is the full list this research
supports:

```
250 <= rooms <= 2000
busy intervals >= 3000
"ONLINE" not in rooms
no room has buildingCode "ONLINE"
1 <= len(sessions) <= 12
every session range is 14 to 120 days long
closed[] has 4 to 12 dates and all fall inside the term
every surviving meeting has >=1 day flag and startTime < endTime
every room's facilityId matches ^[A-Z]{2,4}[0-9A-Z]{3,6}$
count(status != 'A') == 0        # warn loudly if this ever fires
```

---

## Reproducing this

39 requests to content.osu.edu, sequential, 1.2 s apart, 90 s timeout, 3 retries. All
responses cached on disk so re-analysis costs nothing.

```
1     /classes/searchableTermsV2
2     /classes/search?q=&campus=col&term=1268&p=1&sort=catalogNumber     (facets)
3-8   subject=cse, pages 1-6
9-26  page 1 of: dance art music theatre nursing hthrhsc busmhr busfin edutl
                 aviatn animsci physics chem math english psych vetclin knsfhp
27-30 class-session=7w1, pages 1-4        (complete census, 721 sections)
31-33 class-session=7w2, pages 1-3        (600 of 1,808)
34-36 term=1264, pages 1-3                (cancellation hunt)
37-38 term=1262, pages 1-2                (cancellation hunt)
39    term=1272, page 1                   (rollover check, 0 items)
```

Plus 8 endpoint guesses that all returned 404, and 9 requests to registrar.osu.edu,
classes.osu.edu and nominatim.openstreetmap.org.

Every `/classes/search` request carried `sort=catalogNumber`, because Finder measured
that relevance order reshuffles ties between pulls and silently drops about 6% of
sections per page walk. See `Finder/docs/osu-api.md`.

Cached responses and the analysis scripts are in the session scratchpad at
`C:/Users/galax/AppData/Local/Temp/claude/C--Users-galax-Downloads-Projects/ff09d3ae-8ad6-40bb-942d-f7cf03ac4117/scratchpad/vacant/`.
`pool.json` is the 4,931-section sample, `ga_rooms.json` is the 327 general assignment
facility IDs, `finals_tables.json` is the parsed exam matrix, `cal5.html` is the
academic calendar.

---

## Sample bias, stated honestly

The pool is 4,931 of 26,298 Columbus sections, 18.8%. It is not a random sample. Full
CSE plus page 1 of 18 subjects biases toward low catalog numbers, which
over-represents big introductory lectures and under-represents graduate seminars. The
`7w1` slice is a complete census so the partial-term numbers there are exact. The facet
counts (26,298 sections, 2,529 partial-term, 2,632 distance learning) are exact
campus-wide figures from the API's own counters, not extrapolations. The room counts
(486 rooms, 74 buildings) are floors. The percentages of meetings that are ONLINE or
roomless are sample figures and could move a few points on a full harvest.

The one number I would most want re-measured on a full 243-subject harvest is the total
room count. The README estimates 1,200 to 1,800 rooms. My 18.8% sample found 486, and
the registrar's general assignment pool is only 327 rooms in 43 buildings. A full
harvest landing near 800 to 1,000 total rooms, of which roughly 330 are actually
sittable, would not surprise me. That is still a small file, but it changes what
"roughly fifteen hundred classrooms within a ten minute walk" means in the README's
opening paragraph.
