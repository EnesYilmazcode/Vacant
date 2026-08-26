# facilityType: what the codes mean, and which rooms are safe to send a student to

Measured 2026-08-26 against `content.osu.edu/v2`, term 1268 (Autumn 2026), campus `col`.
59 requests to the OSU API plus 1 to Barrett. Every number below is reproducible from the
commands in the last section. Companion data: `facility-types-sample.json` in this folder,
one row per room for all 633 rooms found.

---

## The one thing to build on

**`facilityType` is a property of the room, not of the class, and it never varied.**
Across 633 distinct `facilityId` values and 8284 meeting records, zero rooms reported more
than one `facilityType`, and the same held for `facilityCapacity`, `facilityGroup`,
`buildingCode`, `room`, `facilityDescription`, and both `*Short` fields. So the room index
can store one type per room and trust it.

```
rooms with >1 facilityType: 0
rooms with >1 facilityCapacity: 0
rooms with >1 facilityGroup: 0
rooms with >1 buildingCode / room / facilityDescription / short names: 0
```

Caveat: this is one term. A room re-typed after a renovation would show up as a change
between terms, not inside one. Re-check on the first multi-term harvest.

---

## Sample and how honest it is

| | |
|---|---|
| Subjects sampled directly | 40, one page each |
| Extra sweeps | 6 campus-wide `component` queries, 5 descending-sort pages |
| Course records seen | 2591 courses, 8550 sections, 8284 unique meetings |
| Subjects that appear in the data | 118 of the 243 offered |
| Distinct rooms | 633 (plus the `ONLINE` pseudo-room) |
| Distinct buildings | 84 |
| Distinct `facilityType` codes | 27 |

Subjects were picked deliberately across engineering, sciences, health and medicine, arts,
music, theatre, dance, architecture, humanities, business, education, physical activity,
agriculture, veterinary, dentistry, law and ROTC. Engineering-only sampling would have missed
anatomy labs, dance studios, gyms and performance halls entirely, which was the point.

**This is not a full census and the room count is still climbing.** A rarefaction curve over
400 random subject orderings shows the marginal yield falling slowly, not flattening:

```
subjects sampled    1      10      20      30      40
avg distinct rooms  21    198     353     480     585
new rooms/subject   21.0   18.4    14.7    11.6     9.8
```

At 40 subjects each new subject still adds about 10 rooms. A full 243-subject harvest
plausibly lands near 1000 to 1400 Columbus rooms, which is below the README's 1200 to 1800
estimate but the same order. The type curve is much closer to saturated: 24 codes after 40
subjects, 27 after the extra sweeps, with a marginal rate around 0.2 new codes per subject
and falling. **Expect a full harvest to find roughly 30 to 35 codes, with the tail being
one-room curiosities.** Code the filter as an allow list with a safe default for unknowns,
not as a deny list.

---

## The table

Meeting counts exclude the `ONLINE` pseudo-room. Capacity stats ignore rooms reporting 0,
because 0 means "not recorded", not "no seats" (see below).

| code | meetings | rooms | buildings | cap min / median / max | rooms with cap 0 | reading |
|---|---|---|---|---|---|---|
| `1B` | 1574 | 347 | 64 | 14 / 35 / 271 | 9 | General classroom. **Confident.** |
| `2A` | 698 | 83 | 23 | 10 / 28 / 120 | 1 | Teaching laboratory, mostly wet. **Confident.** |
| `1C` | 414 | 61 | 31 | 48 / 118 / 727 | 0 | Large classroom / lecture hall. **Confident.** |
| `5K` | 58 | 24 | 16 | 5 / 16 / 36 | 3 | Departmental seminar or conference room. Likely. |
| `2M` | 165 | 21 | 4 | 12 / 30 / 60 | 0 | Studio-format instruction room. Likely. |
| `2K` | 72 | 16 | 8 | 5 / 24 / 63 | 2 | Special-equipment teaching lab. Likely. |
| `1A` | 45 | 11 | 10 | 11 / 27 / 49 | 0 | Small classroom / seminar room. Likely. |
| `2P` | 83 | 10 | 8 | 23 / 30 / 97 | 1 | Computer teaching lab. **Confident.** |
| `PERF` | 59 | 10 | 4 | 12 / 60 / 200 | 0 | Performance space. **Confident.** |
| `6F` | 29 (+850 `ONLINE`) | 9 | 6 | 25 / 120 / 480 | 4 | Catch-all "other". **Confident it is a catch-all.** |
| `6L` | 29 | 9 | 5 | 21 / 32 / 80 | 0 | Unit-controlled classroom. Guess. |
| `2H` | 70 | 8 | 2 | none recorded | 8 | Gymnasium / physical activity space. **Confident.** |
| `2Q` | 37 | 4 | 4 | 21 / 37 / 82 | 0 | Specialty instructional space. Guess. |
| `5A` | 3 | 3 | 1 | 3 / 3 / 12 | 0 | Music studio. Likely. |
| `6C` | 12 | 3 | 3 | 200 / 300 / 300 | 1 | Large assembly / auditorium. Likely. |
| `5L` | 3 | 2 | 2 | 9 / 9 / 9 | 1 | Unknown. Guess. |
| `LCTR` | 4 | 2 | 2 | 30 / 42 / 42 | 0 | Lecture room, mnemonic spelling. Likely. |
| `2D` | 1 | 1 | 1 | 16 / 16 / 16 | 0 | Unknown. |
| `2J` | 4 | 1 | 1 | 40 / 40 / 40 | 0 | Unknown. |
| `3A` | 2 | 1 | 1 | 27 / 27 / 27 | 0 | Clinical skills / imaging lab. Guess. |
| `5C` | 1 | 1 | 1 | 28 / 28 / 28 | 0 | Unknown. |
| `5G` | 1 | 1 | 1 | 1 / 1 / 1 | 0 | Individual practice / applied-lesson room. Likely. |
| `5J` | 2 | 1 | 1 | none recorded | 1 | Unknown. |
| `7A` | 2 | 1 | 1 | 60 / 60 / 60 | 0 | Instructional kitchen. **Confident** (one room, named). |
| `AUD` | 1 | 1 | 1 | none recorded | 1 | Auditorium, mnemonic spelling. Likely. |
| `LAB` | 1 | 1 | 1 | 15 / 15 / 15 | 0 | Laboratory, mnemonic spelling. Likely. |
| `SMNR` | 1 | 1 | 1 | 30 / 30 / 30 | 0 | Seminar room, mnemonic spelling. Likely. |

Plus 4063 meetings (49.0% of all meetings) with `facilityType: null` and no room at all.
Those are covered separately below.

---

## Code by code, with evidence

Confidence labels mean: **confident** = the room set is internally consistent and the
building names corroborate it; **likely** = the pattern is clear but rests on a handful of
rooms; **guess** = say so out loud in any PR description.

### `1B` general classroom (confident, and it is the whole product)

347 rooms in 64 buildings, median 35 seats. The building ranking is the tell:

```
33  Enarson Classroom Building     12  Baker Systems Engineering
22  Hamilton Hall                  12  Timashev Family Music Building
14  Denney Hall                    11  Smith Laboratory
13  Journalism Building            11  McPherson Chemical Lab
12  Hagerty Hall                   10  Gerlach / Caldwell / Hayes
```

Enarson Classroom Building, a building whose entire purpose is registrar-pool classrooms,
tops the list. That is strong corroboration that `1B` is the ordinary shared classroom.
Examples: `DL0357` Dreese Lab 357 (46 seats), `SB0210` Schoenbaum Hall 210 (40),
`GE0375` Gerlach Hall 375 (96), `SOE0245` Scott Lab E245 (30), `CM0200` Campbell Hall 200 (271).

### `1C` large classroom (confident)

61 rooms, median 118, and the top of the range is unambiguous: `IH0100` Independence Hall 100
at 727 seats, `HI0131` Hitchcock Hall 131 at 640, `MP1000` McPherson Lab 1000 at 380,
`SU0220` Sullivant Hall 220 at 300, `KH0103` Kottman Hall 103 at 272. Minimum is 48.
`1B` and `1C` overlap in the middle (a 271-seat `1B` exists), so the split is not purely by
size, but `1C` is reliably the lecture-hall end.

### `1A` small classroom (likely)

11 rooms, capacities 11 to 49, median 27. Two of them are Enarson 338 and 348 at 14 seats,
used for peer-led team learning workshops. Others: `SB0209` Schoenbaum 209 (49),
`UH0353` University Hall 353 (40), `DB0047` Derby Hall 047 (11), `SU0225` Sullivant 225 (27).
Behaves like `1B` at the small end. Same treatment.

### `2A` teaching laboratory (confident, and the main hazard)

83 rooms, and the building list is a list of places you should not sit down uninvited:
Jennings Hall (13 rooms), Celeste Laboratory of Chemistry (12), Scott Lab (7),
Mendenhall Laboratory (6), Hayes Hall (5), Sherman Studio Art Center (4).
576 of its 698 meetings are `component: Laboratory`. `CL0237` Caldwell Lab 237 is an
ECE circuits lab at 120 seats, `JE0274` Jennings 274 is a biology bench lab, `KH0334`
Kottman 334 is agronomy. Also picks up art drawing studios in Hayes Hall. Exclude.

### `2H` gymnasium and physical activity space (confident)

8 rooms, exactly 2 buildings, exactly 1 subject. Every room is in the PAES Building or the
RPAC, every meeting is a KNSFHP activity class (Badminton I, Yoga I, Golf I, Karate I,
Tumbling I, ROTC fitness), and **every one of the 8 rooms reports capacity 0**. This is the
cleanest code in the whole space. Exclude, obviously.

### `2K` special-equipment teaching lab (likely, and the scariest one)

16 rooms across 8 buildings. `HM0156` and `HM0260` in Hamilton Hall are the human anatomy
labs, and `HM0260` hosts ANATOMY 4300 "Human Anatomy with Dissection". Also Hopkins Hall
printmaking and painting studios (7 rooms), Plumb Hall animal nutrition labs
(`PL0107` at 36 seats, `PL0109` at 5), `PH0005H` Postle Hall dental, `FS0124` Parker Food
Science 124. 65 of 72 meetings are `Laboratory`. Exclude.

### `2M` studio-format instruction (likely)

21 rooms in only 4 buildings: Sullivant Hall (11, all dance studios: Contemporary, Hip Hop,
Tap, Pilates Reformer), Smith Laboratory (6, `SM2017A/B/C` and `SM2077A/B/C`, the
studio-physics rooms for PHYSICS 1200 and 1201), Theatre Film and Media Arts (3, sound,
costuming, stage directing), Hopkins Hall (1). The common thread is not dance, it is
"open floor, no fixed seating, specific equipment". Exclude.

### `2P` computer teaching lab (confident)

10 rooms and the examples name themselves: `CL0112` Caldwell 112 (CSE 1222 C++ lab, 97 seats),
`DL0280` Dreese 280 (CSE 2124 Python lab, 44), `KH0114` Kottman 114 (ENR GIS lab),
`HC0346D` Hopkins 346D (industrial design media lab), `YN0250` Younkin Success Center 250.
These are genuinely nice places to sit and work, but they are card-access or lab-monitor
controlled in practice. Toggle, do not show by default.

### `2Q` specialty instructional space (guess)

Only 4 rooms and they do not obviously agree: `ED0111` Edison Joining Technology Center 111
(welding lecture, 82), `KN0430` Knowlton 430 (digital design software lab, 37),
`SOE0205` Scott Lab E205 (simulation lab, 21), `PEA0110` PAES A110 (online-learning course, 36).
Best read is "instructional room with dedicated equipment that is not a wet lab". Toggle.

### `2D`, `2J`, `3A` (one room each, do not generalise)

`2D` = `AH0435` Atwell Hall 435, HIMS field experience, 16 seats.
`2J` = `KH0244` Kottman Hall 244, entomology seminar, 40 seats.
`3A` = `AH0147` Atwell Hall 147, RADSCI 3486 Diagnostic Medical Sonography Physics, 27 seats.
`3A` is almost certainly an imaging or clinical skills lab given the course. One room is not
evidence of a code's meaning. Exclude all three by default and revisit after a full harvest.

### The `5x` family: special use, small, departmental (mixed)

`5K` is the biggest at 24 rooms in 16 buildings, median 16 seats. It looks like departmental
seminar and conference rooms: `KN0258` and `KN0259` Knowlton (architecture theory seminars,
16 each), `FI0800` and `FI0700A` Fisher Hall (finance PhD seminars, 35 and 8),
`SH0425V` Stillman Hall 425V (social work practicum seminar, 16), `GH0123` Gerlaugh 123 (8),
`FS0311` Parker Food Science 311 (30).
**But `PH3089A` Postle Hall 3089A, 34 seats, is the Dental Hygiene Clinic**, and `PEA0476` is
a school psychology practicum room, and `DI0455` is a law clinic. So `5K` is not a clean code.
Toggle at most, and never show it as a study spot without a warning.

`5A` (3 rooms, all Timashev, capacities 3 / 3 / 12) and `5G` (1 room, Weigel Hall 211,
capacity **1**) are applied-music studios and practice rooms. A capacity of 1 is a strong
signal all by itself. Exclude.

`5C` (Hagerty 451, 28 seats, dissertation writing workshop), `5J` (Denney 368, capacity 0,
creative writing) and `5L` (Fisher Hall 700 at 9, Campbell Hall 100 at 0) are one or two rooms
each and undecodable from this sample. Exclude by default.

### The `6x` family: general use and the catch-all (mixed)

`6C` is large assembly: `ST0161` Ohio Stadium 161 (300), `TMVN0120` Timashev N120 (200),
`AA0043` Agricultural Administration 043 (capacity 0). Only 3 rooms. Exclude; a student
cannot sit in a stadium meeting room.

`6F` is a genuine catch-all and the most important trap in the whole dataset.
Its 879 meetings are 850 in the `ONLINE` pseudo-room plus 29 in 9 physical rooms, and those
physical rooms are the Adventure Recreation Center climbing wall (`AR0105`, capacity 0),
the ARC gym floor (`AR0112`), a PAES cycling studio (`PEA0275`), the Multispecies Animal
Complex arena (`MALC0100`, capacity 480), a Weigel Hall choral room (`WG0100A`), a golf
facility in Howlett Hall (`HT0124`), and `OFFCAMPUS`. Nothing in that list is a study room.
Exclude the whole code.

`6L` is 9 rooms that read as unit-controlled classrooms: Converse Hall 123, 202 and 228 (Air
Force and Navy ROTC), Drinko Hall 349, 351 and 354 (law clinics and seminars),
`GE0285` Gerlach 285, `HMH0130` Heminger 130 (nursing), `MALC0115` (swine production, 80).
Median 32 seats. Toggle.

### `7A` instructional kitchen (confident, trivially)

One room, `OU0165` in the New Ohio Union, and the API literally names it:
`buildingDescription: "Instructional Kitchen (165)"`. Exclude.

### `PERF` performance space (confident)

10 rooms in 4 buildings: Theatre Film and Media Arts (6), Weigel Hall (2, including
`WG0174` at 100 seats), Sullivant 320 (200), Timashev N160 (130, University Wind Symphony).
Exclude.

### The mnemonic codes `LCTR`, `SMNR`, `LAB`, `AUD`, `PERF` (surprise)

**There are two code spaces in this one field.** Almost everything is `<digit><letter>`, but
five codes are 4-character English mnemonics, and they are not typos: `PERF` alone covers 10
rooms and 59 meetings. The others are 1 to 2 rooms each:

```
LCTR  PK0256A Parks Hall 256A (42)      PR0024 Pressey Hall 24 (30)
SMNR  PL0102  Plumb Hall 102  (30)
LAB   HC0358  Hopkins Hall 358 (15)
AUD   GL0102  Goss Laboratory 102, Wooster (capacity 0)
```

Working hypothesis, stated as a guess: the mnemonics are what newer or recently re-entered
facility records get, since `PERF`'s rooms sit in the Timashev Family Music Building and the
Theatre Film and Media Arts Building, both recent, and `LCTR`'s Parks Hall 256A is a renovated
space. That is a story consistent with the data, not a verified fact. **The practical
consequence is what matters: never parse `facilityType` as `/^(\d)([A-Z])$/` and never sort
or compare on it. Treat it as an opaque string key.**

---

## `facilityGroup`

**True 14 times out of 8284 meetings (0.17%), on exactly 2 rooms, and it means the room is a
divisible space whose halves are separately schedulable.**

```
MALC0100  facilityGroup=true  cap=480  Multispecies Animal Complex 100
  MALC0100N  facilityGroup=false  cap=120
  MALC0100S  facilityGroup=false  cap=120
RF0112A   facilityGroup=true  cap=150  Riffe Building 112A  (12 meetings, PHR 2100)
```

Counts across all meetings: `false` 4207, `null` 4063, `true` 14. `null` occurs on exactly
the rows that have no room at all, so on real rooms the field is only ever `true` or `false`.

**This is a correctness trap for Vacant.** A class scheduled in `MALC0100` occupies
`MALC0100N` and `MALC0100S` too, and the API will not say so. The complement-of-busy
calculation will report the halves as free when they are not. It is 2 rooms out of 633 today
and both are places nobody would study anyway, but a full harvest will surface more, and a
divisible lecture hall is exactly the kind of room Vacant would rank first.

Recommended handling: when building the index, if `facilityGroup === true`, propagate the
parent's busy blocks to every room whose `facilityId` starts with the parent's `facilityId`,
and propagate the children's busy blocks back up to the parent. Do this only for
`facilityGroup === true` parents. A naive prefix test would be wrong: `KH0333` and `KH0333C`
are both `facilityGroup: false` and are genuinely different rooms, as are `HC0346` / `HC0346D`
and `FI0700` / `FI0700A`.

---

## Missing, null and empty fields

Counted over all 8284 unique meetings.

| condition | count | share |
|---|---|---|
| `facilityType` null | 4063 | 49.0% |
| `facilityId` null | 4063 | 49.0% |
| `buildingCode` null | 4063 | 49.0% |
| `facilityDescription` null | 4063 | 49.0% |
| `facilityGroup` null | 4063 | 49.0% |
| `facilityId === "ONLINE"` | 850 | 10.3% |
| `room` null | 4913 | 59.3% |
| `facilityCapacity` null | **0** | 0% |
| `facilityCapacity === 0` | 4095 | 49.4% |
| `facilityCapacity === 998` | 850 | 10.3% |
| `facilityId` empty string | **0** | 0% |

Four things to take from this.

**1. The null-room rows are one block, not several.** `facilityType`, `facilityId`,
`buildingCode`, `facilityDescription` and `facilityGroup` all go null together, on exactly
the same 4063 rows. Testing any one of them is equivalent. Test `facilityId == null`.

**2. `facilityCapacity` is never null; it uses 0 as its missing sentinel and 998 for online.**
`0` does not mean "no seats". 32 real rooms report 0, and 9 of them are ordinary `1B`
classrooms, seven of those in Campbell Hall (`CM0107`, `CM0193`, `CM0207`, `CM0227`, `CM0293`,
`CM0307`, `CM0393`) plus `HC0364` Hopkins 364 and `WI0123` Williams 123. Dropping capacity-0
rooms would silently delete most of Campbell Hall from the app. Render "seats unknown"
instead, and never sort a capacity-0 room to the bottom as if it were tiny.

**3. What the null-room rows actually are.** By component:
`Independent Study` 2623, `Laboratory` 431, `Lecture` 407, `Seminar` 203, `Clinical` 197,
`Field Experience` 141, `Recitation` 33, `Workshop` 28. By instruction mode:
`In Person` 3989, `Hybrid Delivery` 67, `Distance Enhanced` 5, `Distance Learning` 2.
Most are independent study and clinical placements that were never going to have a room.
**But 384 of them carry both a start time and a day flag**, meaning they are real, scheduled,
in-person meetings with the room left unassigned or TBA. Example: several ACCTMIS 2000
sections, Hybrid Delivery, 7:15 pm to 9:00 pm, `location: CS-COLMBUS`, no room.

That is an unfixable hole and it points the wrong way for safety: those classes occupy some
room that Vacant will believe is empty. 384 out of 3753 timed meetings is 10.2%. It belongs
in the same honesty note as "no class scheduled, the door may still be locked".

**4. Online rows are a well-formed pseudo-room, and `facilityType` will not find them.**
The shape is fixed:

```json
{"facilityId":"ONLINE","facilityType":"6F","facilityDescription":"ONLINE",
 "facilityDescriptionShort":"ONLINE","facilityGroup":false,"facilityCapacity":998,
 "buildingCode":"ONLINE","room":null,"buildingDescription":"Online",
 "buildingDescriptionShort":"ONLINE"}
```

`buildingCode === "ONLINE"` catches all 850 and is what Finder already does in
`js/format.js`. Do not use `facilityType === "6F"` for this: 6F also contains 9 physical
rooms. Do not use `instructionMode` either, since the 850 ONLINE rows split across
`Distance Learning` (627), `Distance Enhanced` (17) and `Hybrid Delivery` (16), and 2
`Distance Learning` meetings have a real physical room. 197 ONLINE rows even carry a real
start time and day flags.

---

## Recommended default filter for Vacant

Keyed on the room's `facilityType`, applied once at index-build time.

**Show by default** (`1A`, `1B`, `1C`, `LCTR`, `SMNR`): 422 rooms, 66.7% of the inventory,
71 buildings, median 40 seats, covering 2038 of 3369 schedulable meetings (60.5%). This is
the set where the answer "go sit in it" is defensible.

**Behind a toggle** labelled something like "include labs and departmental rooms"
(`2P`, `2Q`, `5K`, `6L`, `2J`, `5C`): 49 rooms, 7.7%, 28 buildings, median 28 seats. Computer
labs and departmental seminar rooms. Real rooms with chairs and tables, but access-controlled
or socially awkward, and `5K` contains at least one actual dental clinic.

**Exclude outright** (`2A`, `2H`, `2K`, `2M`, `2D`, `3A`, `5A`, `5G`, `5J`, `5L`, `6C`, `6F`,
`7A`, `PERF`, `LAB`, `AUD`): 162 rooms, 25.6% of inventory but 33.2% of scheduled meetings.
Wet labs, dissection labs, gyms, dance and theatre studios, practice rooms, kitchens,
performance halls, the stadium, and the online pseudo-room.

Two rules that go with it:

- **An unrecognised `facilityType` is excluded, not shown.** The code space is not closed
  (27 found, probably 30 to 35 exist) and the failure mode of guessing wrong is routing
  someone into a cadaver lab. Log unknown codes on every weekly rebuild so the list can grow
  deliberately.
- **Never drop a room for `facilityCapacity === 0`.** Show "seats unknown". 9 of the 422
  show-by-default rooms would vanish otherwise, seven of them in Campbell Hall.

### What the type filter does not solve

`facilityType` describes the room, not the building's front door. 32 of the 422
show-by-default rooms sit in buildings a random undergraduate should not wander into:
Drinko Hall (law, 7 rooms), Atwell Hall (health sciences, 9), Postle Hall (dentistry, 3),
Riffe Building (2), Newton Hall (pharmacy, 3), Meiling Hall (medicine, 2), Lincoln Tower (1),
plus the Wooster rooms below. That needs a hand-maintained building allow or deny list, which
is the geo work item's problem, not this one, but it should be filed now.

Also worth knowing: clinical courses do meet in ordinary classrooms. `AH0261`, `AH0141`,
`AH0161`, `AH0343` and `AH0240` are all `1B` and all host RADSCI practicums; `DI0345` and
`DI0347` are `1B` and host law clinics. That is fine, the room really is a classroom.
Only 22 of 220 clinical meetings land in a real room at all; the other 197 happen in a
hospital and have no room record, so they never enter the index.

---

## Surprises worth carrying forward

1. **`campus=col` returns rooms that are not in Columbus, and no field flags them.**
   `WSB300` (Wooster Laboratory Building), `WAB0130` (CFAES Wooster Admin Bldg) and `SY0203`
   (Selby Hall) are all type `1B`, all report `campus: "Columbus"` and all report
   `location: "CS-COLMBUS"`. Selby Hall and the Wooster buildings are on the OARDC campus
   about 60 miles away. The `location` field does catch `GL0102` Goss Laboratory as
   `CS-WOOSTER`, so it is inconsistent rather than useless. Whoever does the geo pass must
   not hand-fix these into Columbus coordinates. Tell them.

2. **Two code spaces in one field.** See the mnemonics section. Do not regex it.

3. **`facilityCapacity` has no null.** It has 0 for unknown and 998 for online. Any
   `capacity ?? 0` or `capacity || fallback` written against this field is already wrong.

4. **The `ONLINE` pseudo-room lives inside `6F` alongside a climbing wall.** Detect online by
   `buildingCode`, never by type.

5. **`component: "Laboratory"` is not a proxy for a lab room.** 296 `Laboratory` meetings
   happen in `1B` general classrooms and 28 in `1C` lecture halls, because OSU labels
   recitations and small-group sessions as Laboratory. Filter on the room, not the class.

6. **Only 40.7% of meetings are usable for an occupancy index.** 3369 of 8284 have a real
   room, a start time and at least one day flag. The rest are online (850), roomless (4063)
   or otherwise incomplete.

7. **Partial-term sessions are real but rare and cheap to model.** Only 8 distinct
   `startDate..endDate` pairs across all real-room meetings, dominated by
   `2026-08-25..2026-12-09` (3097), with 7-week sessions at `2026-10-19..2026-12-09` (130)
   and `2026-08-25..2026-10-12` (119). `sessionCode` is `1`, `7W1` or `7W2`. The README's
   deduped `sessions` table will be tiny, which confirms that design choice.

---

## Open questions

- What do `2D`, `2J`, `5C`, `5J`, `5L`, `2Q` and `6L` actually mean? Each rests on 1 to 9
  rooms. A full harvest will either populate them or confirm they are rare.
- Is the mnemonic code space (`PERF`, `LCTR`, `SMNR`, `LAB`, `AUD`) growing? Compare term 1268
  against 1262 and 1264 for the same room to see whether any room changed code between terms.
- Is there a published OSU room-type key? Nothing was found in the API. The registrar's
  classroom pool pages and the university space inventory are the obvious places to look, and
  a single confirmed key would turn most of the "likely" and "guess" rows above into facts.
  Asking the registrar directly is probably faster than more probing.
- How many more `facilityGroup: true` parents exist campus-wide, and do any sit in the
  show-by-default set? Two were found and neither matters; a divisible lecture hall would.

---

## Commands

Subject list seed, 1 request, not to the OSU API:

```bash
node -e "const r=await fetch('https://www.asc.ohio-state.edu/barrett.3/schedule/');
const h=await r.text();
console.log([...h.matchAll(/<a href=\"([A-Z][A-Z0-9]*)\">/g)].map(m=>m[1]).join(' '))"
```

Pass 1, 40 requests, one page per subject, sequential with a 700 ms pause, 90 s timeout,
3 retries:

```
GET https://content.osu.edu/v2/classes/search
    ?q=&campus=col&term=1268&sort=catalogNumber&subject=<lowercase>&p=1
```

subjects: CSE MECHENG ECE WELDENG CHEM PHYSICS BIOLOGY ASTRON EARTHSC ANATOMY NURSING
PUBHLTH PHR HTHRHSC RADSCI ART DANCE MUSIC THEATRE DESIGN ARCH ENGLISH HISTORY PHILOS
SPANISH BUSMHR BUSFIN ACCTMIS EDUTL KNSFHP ESEPSY ANIMSCI HCS ENR FDSCTE ENTMLGY AIRSCI
NAVALSC VETCLIN DENTHYG

Pass 2, 19 requests. Six campus-wide component sweeps, which is the cheap way to reach room
types no single subject surfaces:

```
?q=&campus=col&term=1268&p=1&component=cln&sort=catalogNumber
?q=&campus=col&term=1268&p=1&component=cln&sort=-catalogNumber
?q=&campus=col&term=1268&p=1&component=fld&sort=catalogNumber
?q=&campus=col&term=1268&p=1&component=wrk&sort=catalogNumber
?q=&campus=col&term=1268&p=1&component=lab&sort=-catalogNumber
?q=&campus=col&term=1268&p=1&component=sem&sort=-catalogNumber
```

Eight unsampled health and clinical subjects (DENT OPTOM PHYSTHER OCCTHER SOCWORK MEDCOLL
ATHTRNG VETPREV; PHYSTHER returned 0 items and is a dead Barrett code), and five descending
sorts to reach graduate-level rooms in subjects too large for one page
(MUSIC CSE ECE CHEM ART).

The `component` facet codes were harvested from the `filters` array of the already-saved
responses rather than by asking for them: `ind lec lab rec sem fld wrk cln`. That facet is
the highest-yield tool here and it cost nothing, since every search response already carries
it. `sort=-catalogNumber` is likewise free and is the cheapest way to see the other end of a
truncated subject.

Raw responses and the analysis scripts were written to the session scratchpad under
`.../scratchpad/facility/`, which is not durable. The durable output is
`facility-types-sample.json` next to this file.

One operational note for the next agent: the session scratchpad is shared with sibling agents,
and this run had its analysis scripts silently overwritten mid-run by another agent writing
`analyze.mjs` and `table.mjs` to the same directory. Work in a uniquely named subdirectory.
