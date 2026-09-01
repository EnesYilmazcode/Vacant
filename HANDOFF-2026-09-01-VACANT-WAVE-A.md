# HANDOFF — Vacant UX wave, 2026-09-01

Written because the laptop was about to die. Everything below is recoverable from GitHub alone.

## State right now

**Five PRs open, CI green, mergeable, and NONE of them should be merged yet.**

| PR | branch | what it does |
|----|--------|--------------|
| [#79](https://github.com/EnesYilmazcode/Vacant/pull/79) | lane/room-day | room screen answers the day it is drawing |
| [#80](https://github.com/EnesYilmazcode/Vacant/pull/80) | lane/list-bounds | walk bound + per-building cap. Closes #60, #62 |
| [#81](https://github.com/EnesYilmazcode/Vacant/pull/81) | lane/sheet-frame | install rail stops burying the four chips |
| [#82](https://github.com/EnesYilmazcode/Vacant/pull/82) | lane/night-gate | the night screen names the first door |
| [#83](https://github.com/EnesYilmazcode/Vacant/pull/83) | lane/startup-deadends | picked origin escapable, failed load retries |

All five branches are pushed and in sync with origin. Zero uncommitted files in any worktree. main is clean at ccd4db5.

## Why nothing merged

A 20-agent review (4 lenses per PR: correctness, honesty contract, house style, test quality) ran
against the branches. 17 of 26 agents finished before the machine had to stop; the raw results are in
`HANDOFF-review-partial.json` on this branch. The 5 judge agents and the integration agent did NOT run.

**98 findings: 8 blocker, 32 major, 34 minor, 24 nit.**

Two themes dominate and both are serious for this repo:

1. **Honesty violations.** Several new sentences promise something the data cannot back. The gate says
   "Vacant ranks rooms again on Monday at 8:00am" on 3,780 night minutes where that is false, because
   `nextScheduled` reads a weekly Mon-Fri mask with no calendar in it. The room screen names a class on
   days the app itself refuses to answer.
2. **Decorative tests.** Several new tests pass with the fix reverted. The back-label test passes with
   the two labels swapped. Four room-day tests pass with the session mask deleted. The `soonest`
   invariant that the PR body calls a MUST has no test at all.

Neither was caught by CI, which is the whole reason the review lens existed.

## BLOCKERS (must fix before any merge)

- **The room screen names a class on days the app itself refuses to answer because campus is closed**
  - js/app.js:1300 `shapeClaim` builds the headline for a stepped day from the weekly schedule alone. It never asks `calendarOn`, which js/state.js:222 already calls with exactly the arguments needed (`calendarOn(today, index, current)`), so the one line on the screen that makes a claim states a class as fact on the published closures in data/rooms-1268.json. The closures are one to three taps of Next
  - fix: Have roomHtml resolve the shown day's calendar before it picks a claim, the same way js/state.js:214 resolves today's: `const cal = calendarOn(isoDate(date), state.rooms, state.current)`. When `cal.buildingsClosed`, shapeClaim should say the campus is closed and name the day ("Labor Day. Ohio State 
- **The byDoor tiebreak comment carries three numbers that the sweep it describes does not produce, and the example case never happens**
  - js/state.js:563-570. The comment says: "over a 144 point grid on the campus box at every quarter hour of every day, 4,066 of 96,768 closed lists (4.20%) come out in a different order, and no row moves more than two places. The case it catches is Cockins Hall and Agricultural Engineering, both 1,003 m from the south of campus, one opening at 12:30pm on a Sunday and the other shut all day." Running 
  - fix: Re-run the sweep and write down what it says: 4,032 of 96,768 (4.17%), no row moves more than one place. Replace the example with one that actually occurs, for instance Hayes Hall opening 6:00am sorting above Derby Hall opening 7:00am at 2,492 m, which is the case the sweep hits most. Make the same 
- **The "target ink under the panel" number does not reproduce, and it is now a source comment and an append-only DECISIONS entry**
  - js/app.js:110 states "measured at 393x852, 164 of the 206px of target ink came out under the panel." docs/DECISIONS.md:1984-1985 repeats it and adds "77.8% at 375x667 and 80.7% at 430x932", and the same table is in the commit message and the PR body. Driving the real app on a clean export of main at all three sizes, the figure is 101/191 (52.9%), 110/200 (55.0%) and 115/205 (56.1%). The PR oversta
  - fix: Re-run the ink measurement against main and replace the before column everywhere it appears: js/app.js:110, docs/DECISIONS.md:1984-1985, scripts/test/map.test.mjs:456-458, the commit message and the PR body. If the original probe measured against a FULL-height (0.78) sheet rather than the 0.72 the r
- **"Vacant ranks rooms again on Monday at 8:00am" is false on 3,780 night minutes of Autumn 2026, because nextScheduled reads a weekday mask and never looks at the calendar the app refuses on**
  - js/state.js:642. nextScheduled walks `busyDay.weekdays[on]`, which is a week-shaped mask built from block counts in busyDayOf (js/state.js:419). Every other place that decides whether the app may answer consults more than that: inScheduledHours (js/state.js:480) also checks inTermOn, closedDayFor(...)?.state === 'offices-closed' and scheduleDarkOn, and resolveState refuses on top of that for exams
  - fix: Make nextScheduled walk DATES rather than weekday indices, and skip any date the app would refuse on: !inTermOn(date, ...), closedDayFor(date, ...)?.state === 'offices-closed', inside the exams window, and scheduleDarkOn. That means unscheduledGate has to be handed the Date (or the iso date plus cur
- **The refusal screen calls a room free that is busy for another 90 minutes**
  - js/app.js:648 prints "<b>N rooms</b> are free further out, the nearest a <b>W minute walk</b> to X" from state.bounds.beyond. Both halves are computed over rows that only cleared `usable = results.filter((r) => r.wait <= MAX_WAIT_MIN)`, and MAX_WAIT_MIN is 90, so a row in that set can be a room that does not open for another hour and a half. js/engine.js:464 makes it worse by picking the named roo
  - fix: Split free from opening-soon before either number is spent. In js/engine.js shape(), build `beyond` from `far.filter((r) => r.wait === 0)` for both `count` and `nearest`, and keep the wait > 0 rows in a separate field if the screen wants them. Or keep the count as is and make the copy say what the r
- **Inside the gate, "nothing walkable" is a dead end; outside it, the same situation falls back to the Oval and shows 40 rooms**
  - js/app.js:1899 still decides the Oval fallback on `distance from the Oval > OFF_CAMPUS_KM`, but the condition that now matters is "nothing is walkable from here", which `shape()` computes exactly, one line earlier, as `bounds.rows.length === 0 && bounds.beyond.count > 0` (js/app.js:569). Inside the 2.2 km circle that state paints a terminal screen. The only controls on it are Check again, What Vac
  - fix: Trigger the fallback on the predicate the code already has, not on the circle: in `answer()`, when `state.bounds.rows.length === 0 && state.bounds.beyond.count > 0`, either re-answer from the Oval with the same "Nothing on campus is walkable from here, showing from the Oval" note, or at minimum set 
- **The rail's height comes out of the ranked list, and on a 375x667 phone with both bars up the list shows zero rooms**
  - index.html:575 moves the rail's compensation from the panes to `body.has-bar #sheet { padding-bottom: calc(var(--safe-b) + var(--bar-h, 0px)); }`. The sheet's height is still set in px by setSheet (js/app.js:351) as a fraction of the viewport, and `* { box-sizing: border-box }` means the new padding is taken out of that fixed height rather than added to it. Everything the sheet holds gets shorter 
  - fix: Give the sheet the height as well as the padding. Keep the padding rule so the chips clear the rail, and have setSheet (js/app.js:351) add the rail back to the target: read `parseFloat(getComputedStyle(document.body).getPropertyValue('--bar-h')) || 0` and use `fraction * innerHeight + barH`, clamped
- **The gate promises a ranked list on days the app refuses to answer**
  - js/state.js:642 nextScheduled() picks the next day the app will rank by reading busyDay.weekdays alone. That is a weekly Mon-Fri pattern with no calendar in it, so it happily names a date the app is already committed to refusing on. data/rooms-1268.json ships the real closed table (Labor Day, Veterans Day, Thanksgiving) and exams 2026-12-11..17, and current.json ends instruction on 2026-12-09, so 
  - fix: Give nextScheduled the date, not just the weekday index, and step forward with real dates, skipping any day where closedDayFor(iso, current, index)?.state === 'offices-closed', inTermOn(iso, ...) is false, or the exam window covers it. inScheduledHours at js/state.js:480 already does exactly these d

## MAJOR

- **Three campus buildings inside the gate now get a dead-end screen all day**
  - OFF_CAMPUS_KM=2.2 keeps an origin inside 2.2 km on its own coordinates instead of snapping it to the Oval, but shape() then drops everything past a 12 minute walk, so an origin that is inside the gate and more than 12 minutes from every free room gets zero rows and no way to reach any of them. The empty screen at js/app.js:637-652 offers only FOOT_ACTS ("Check again", "What Vacant knows"), so the 
  - fix: When shape() returns zero rows and beyond.count > 0, render the beyond rows rather than a dead end, labelled as past the bound, so the student can still tap the 13 minute walk. Failing that, make far.nearest itself a real row button instead of a name in a sentence. Whichever way, the empty screen sh
- **The soonest invariant the PR calls a MUST has no test at all**
  - js/app.js:563 reads state.soonest off the unfiltered rank() output, and both the code comment and DECISIONS.md say why that matters. Nothing pins it. Changing `state.soonest = results` to `state.soonest = usable` makes soonest permanently null, because the filter is `wait > MAX_WAIT_MIN` applied to a set already filtered to `wait <= MAX_WAIT_MIN`, so the "The first one open is X at Y" message woul
  - fix: Add the repo's own source-grep idiom next to the off-campus gate test in scripts/test/screens.test.mjs: assert js/app.js contains `state.soonest = results` and that the line sits above `state.bounds = shape(usable)`. Two lines, and it holds the one invariant the PR body, the commit message and DECIS
- **"shape never reorders the ranking" does not catch a sort by walk, the one sort it names**
  - The fixture at scripts/test/engine.test.mjs:1454-1457 gives building b a walk of `3 + b`, so ranking order and walk order are identical by construction and the test cannot tell them apart. Its own comment says "A cap that sorted, even stably, would let a screen disagree with the engine about which room is best", and a sort by walk is the most likely accidental sort to appear in a function whose jo
  - fix: Give twelve() a walk order that disagrees with the ranking order, for instance walk `12 - b` while the buildings stay in B00..B11 ranking order, so ranking order and walk order can only both be satisfied by not sorting. Keeping one building's rooms consecutive is what the fixture needs; monotone wal
- **The walk spike still reports the app's old visibility rule and is now wrong two times in three**
  - spikes/walk.html:287 computes `shownByApp: i + 1 <= APP_SHOWN_CAP`, which was exact when the app did `usable.slice(0, 40)` and is not exact any more: the per-building cap drops rows inside the first 40 and promotes rows ranked past 40 onto the screen. spikes/walk.html:483 prints a per-row chip "rank N, below the 40 the app shows" and :580 prints "M of them inside the 40 rows the app puts on screen
  - fix: Have walk.html build its pool from shape() (it already loads the vendored engine, which now exports it) and set shownByApp from membership in shape().rows rather than from appRank. Update the two comments at spikes/score.js:15 and :20 to describe shape() instead of the slice.
- **The two day tests are source greps, and the bug they name survives them**
  - scripts/test/screens.test.mjs:895 and :913 assert only on the text of js/app.js through bodyOf(). Nothing calls blocksToday, timelineRows, shapeClaim or roomHtml. Any change that keeps the greps satisfied passes, including the exact defect the PR exists to fix. Two mutations that keep the shape and restore the bug: js/app.js:1157, `if (Number(b[0]) !== day)` -> `if (Number(b[0]) !== clockNow().get
  - fix: Test the behaviour, not the text. shapeClaim and blocksToday are pure once the date is a parameter, so move them (or a small pair of wrappers) into a DOM-free module the way js/claim.js already is, and assert on the shipped index: pick one of the 18 rooms whose Monday changes across 2026-10-19, call
- **The back-label test passes with the two labels swapped**
  - scripts/test/screens.test.mjs:929 asserts that showRoom's source contains /history\.state\?\.from === 'near'/, /Back to the nearest buildings/ and /Back to the room list/. All three still hold when the ternary's arms are exchanged, so the test cannot tell the fix from its inverse. The arms are at js/app.js:1696.
  - fix: Assert the pairing rather than the presence. In the same grep style, capture the ternary and check which arm goes with 'near', for example assert.match(show, /from === 'near'\s*\?\s*'Back to the nearest buildings'/). Better still, cover it for real: showRoom's label depends only on history.state.fro
- **The one behavioural test in the lane exercises none of the changed code**
  - scripts/test/screens.test.mjs:941, "a stepped day and its grid consume the same classes", is the only new test that runs anything. It defines gridOn() at :958 and claimOn() at :966 as hand-written copies of the filters in js/app.js, over a two-session, two-block fixture written into the test, and then asserts those two copies agree with each other. Neither the app's blocksToday nor its classesOn i
  - fix: Point it at the real functions and the real index. Export blocksToday and classesOn from a DOM-free module, then assert on one of the 18 rooms that actually change: for a room whose Monday differs across the 2026-10-19 boundary, blocksToday(room, at('2026-10-12')) and blocksToday(room, at('2026-10-1
- **Off today the claim names a class on days the app refuses to answer**
  - shapeClaim at js/app.js:1300 reads only the session mask and the weekday. It never consults closedDayFor(), so the stepped day prints a confident first-class time on campus closures that resolveState refuses to answer about when they are today. data/rooms-1268.json carries those dates. The grid drew the blocks on those days before this PR too, so the underlying gap is in classesOn, but this change
  - fix: Give shapeClaim the closure. It already has the date, so `const shut = closedDayFor(isoDate(date), state.current, state.rooms)` and, when it fires, return the name of the closure instead of a class time, for example head `${shut.name}` or `No class ${when}, ${shut.name}`. closedDayFor is already exp
- **"No class <date>" turns an index with no rows for that date into a statement of fact**
  - js/app.js:1304 falls through to `No class ${when}` whenever `tl.blocks` is empty. Empty means two different things and the sentence collapses them: the room really has nothing that weekday, or the schedule does not cover that date at all. Past 2026-12-09 every session mask is off, so every room on every date returns an empty list and every room says "No class". That includes finals week, where the
  - fix: Separate "nothing scheduled" from "nothing known". Before falling through to "No class", check the exam window and the term bounds the app already computes (`inTermOn`, exported from js/state.js:167, and the `exams` branch of `calendarOn`), and say so instead: outside the term, something like "Autum
- **The four new tests pass with the session mask deleted from blocksToday**
  - scripts/test/screens.test.mjs:891-925 asserts against the TEXT of js/app.js with regexes, and the one test that runs code, "a stepped day and its grid consume the same classes" at :941, defines its own `gridOn` and `claimOn` inside the test body rather than calling the app's. So it compares one hand copy to another hand copy and passes whatever blocksToday and classesOn actually do. Source-grep te
  - fix: Add one test that runs the app's own functions on real data instead of a copy. blocksToday and classesOn are pure apart from `state.rooms.sessions`, so either export them for tests or lift the pair into a small module both js/app.js and the test import, then assert against data/rooms-1268.json that 
- **The gate now prints a live minute, and nothing in the app ever repaints it**
  - js/app.js:1826 puts the current minute in the gate heading and js/state.js:667 builds it out of `nowMin`, but the gate lives on the `ask` screen and the app's only staleness hook, js/app.js:2068, refreshes on return to the foreground for `list` and `near` only. There is no timer anywhere in js/app.js. Main's gate heading was the constant string `Nearest buildings`, so it could go stale harmlessly;
  - fix: Extend the handler at js/app.js:2068 to cover the screen the gate is on, for example `if (state.screen === 'list' || state.screen === 'near' || state.screen === 'ask') refresh();`. js/pwa.js:99 already records why this idiom exists ("iOS freezes a backgrounded web app... Coming back to the foregroun
- **The gate names the next door to open even when doors are open right now**
  - js/state.js:673 adds the door clause unconditionally. The buildings screen guards the same sentence on `groups.open.length` (js/app.js:848-849, printed only in the `groups.open.length ? '' : ...` branch), so on that screen "the first door" only appears when everything really is shut. The gate has no such guard, so for a large part of the week it answers a question nobody asked and implies campus i
  - fix: Give `unscheduledGate` the same fact `paintNear` already has and drop the door clause when anything is open: pass `openNow` (or `groups.open.length`) from js/app.js:1820 and only build `door` when it is zero. The `back` clause stands on its own, as it already does when `opening` is null.
- **The "117 room-days" figure is not the number the data gives**
  - js/app.js:1153 (and the same sentence in the PR body's Mechanism section) says "18 of 425 rooms have a different Monday either side of the 2026-10-19 boundary, 117 of the 2,975 room-days in a week." The 18 is right. The 117 is not: the same comparison that produces 18 produces 107. I ran the shipped blocksToday logic over data/rooms-1268.json for all 425 rooms x 7 weekdays under the two boundary m
  - fix: Change 117 to 107 in js/app.js:1153 and in the PR body's Mechanism paragraph. If 117 came from a different comparison, say which one in the comment, because none of the five obvious ones produces it.
- **The nextOpening comment says Saturday night points at Monday; the function it sits on top of never returns Monday from a Saturday**
  - js/state.js:589-591: "only 5 of the 46 buildings publish Saturday hours, so on a Saturday night the next door is 46 of them opening Monday." The first half is right, the second half is not. 11 buildings publish Sunday hours, three of them at 7:00am, so from any Saturday minute the answer is either later that Saturday or Sunday morning. Monday cannot be reached. "46 of them" would not be right for 
  - fix: Say what the sweep says. Something like: only 5 of the 46 buildings publish Saturday hours and 11 publish Sunday, so on a Saturday night the next door is three of them opening 7:00am Sunday, and the walk has to cross a day boundary to find it.
- **Two one-line decisions get explained three times each, at up to nine comment lines per line of code**
  - The added comments run at 92 comment lines per 100 code lines in js/state.js and 79 per 100 in js/app.js, against the files' own 40 and 28. Two cases carry most of it. (1) The focus change is a single added option, `el.focus({ preventScroll: true, focusVisible: false })` at js/app.js:209, and it gets nine new comment lines at js/app.js:197-205, seven more at index.html:65-71, and a paragraph in do
  - fix: Pick one home per decision. The CSS guard belongs at index.html:65-71 and can keep its four best lines; js/app.js:197-205 then needs only the sentence that is not in the CSS, roughly "a script focus is scored with the modality of the last real input, so a heading reached by Tab wore the ring meant f
- **The rail fix holds only at the three sizes measured: 0 of 4 chips at 320px width, and at the first larger-text notch on three of four phones**
  - index.html:575. `body.has-bar #sheet { padding-bottom: calc(var(--safe-b) + var(--bar-h, 0px)) }` puts the rail's debt on a border-box element whose `height` is assigned by setSheet (js/app.js:357). Padding is not shrinkable, so once `--bar-h` exceeds `height - handle - chips` the flex-none children overflow the content box and the box itself grows past its assigned height, and the chips land back
  - fix: Give the sheet the rail's height as an offset rather than as internal padding, so the box cannot outgrow its assigned height: `body.has-bar #sheet { bottom: var(--bar-h, 0px) }` (the sheet is already position:fixed; bottom:0), keeping the existing `padding-bottom: var(--safe-b)`. Then re-measure at 
- **The room screen's fix is undone by the back arrow: the list frame after leaving a room is byte-identical to main's buggy room frame**
  - js/app.js:1637 `showList()` calls `sheetHeight()`, which is `setSheet(sheetH || restFraction() * innerHeight)`, so it keeps whatever height the previous screen left. Come out of a room and the sheet is still 613px while `viewport()` now reports the list's 528px band, so `project()` re-centres at 264 instead of 119.5 and the walk line slides under the panel. REST is therefore not where the sheet re
  - fix: Have showList/showNear put the sheet back at its own resting height when arriving from a screen that rests elsewhere, e.g. `setSheet(restFraction() * window.innerHeight, true)` when `sheetH` came from a different REST entry, so the sheet and the band agree. If keeping the user's dragged height is de
- **Nothing tests the dismiss fix: all three code sites revert to main and the suite stays green**
  - Fix 2 is the whole reason DISMISS_PX moved to 88 (js/app.js:123), the per-gesture floor was added (js/app.js:392) and the release comparison became `<=` (js/app.js:457). No test in the PR touches any of it, and no existing test covers it either. A reviewer reading a green suite gets no signal that the 60px row pull is fixed or that it stays fixed.
  - fix: Add a test that drives the gesture rather than the source. attachSheet is DOM-bound, so either export the floor rule as a pure function (`floorFor(mode, innerHeight)`) and assert that a pane drag floors at PEEK*H while a grip drag floors at PEEK*H - DISMISS_PX, or add a headless case to the shoot.mj
- **Nothing tests the band fix either: restFraction() can return PEEK on every screen and the suite stays green**
  - screens.test.mjs:876 greps js/app.js for `const REST = {...}` and checks only that the six screen NAMES appear, never their values, plus that viewport()'s body contains the literal text `band: Math.round(height * (1 - restFraction()))`. The two new map.test.mjs tests never import js/app.js at all and hardcode `band: 239` and `band: 528` as literals, so they cannot see REST, restFraction, PEEK or R
  - fix: Export the band decision as a pure function of the screen name and the viewport (`bandFor(screen, height)`) and assert the values: bandFor('room', 852) === 239, bandFor('list', 852) === 528, and that it is derived from ROOM_SHEET/PEEK so moving a constant moves the assertion. Then have map.test.mjs 
- **The buildings screen names a door opening in two hours directly under its own heading saying the buildings are locked**
  - js/app.js:849. The new `closedNow` line names the first door from nextOpening, which reads data/buildings-hours.json. That table is purely weekly: each building carries `hours` as seven [open, close] pairs indexed by weekday, and hoursFor (js/app.js:497) indexes it by `day` with no date at all. Nothing in it knows about a holiday. The old sentence, "Everything is closed right now.", made no forwar
  - fix: In paintNear, fall back to the bare sentence when the situation is a campus-closed refusal. The fact is already in hand: `state.situation.kind === 'CAMPUS_CLOSED'`, or read closedDayFor(isoDate(now), state.current, state.rooms)?.state === 'offices-closed'. Something like `const door = closedToday ? 
- **The tiebreak measurement does not reproduce and its worked example never happens**
  - js/state.js:564-570, repeated in docs/DECISIONS.md:2018-2024 and scripts/test/screens.test.mjs:1014-1016. The comment claims "4,066 of 96,768 closed lists (4.20%) come out in a different order, and no row moves more than two places. The case it catches is Cockins Hall and Agricultural Engineering, both 1,003 m from the south of campus, one opening at 12:30pm on a Sunday and the other shut all day.
  - fix: Replace the three copies of the figure with the measured one (4,032 of 96,768, 4.17%) and tighten the bound to "no row moves more than one place", or state the reading that gives 4,066 and show it. Replace the worked example with a pair that actually swaps: Derby Hall and Hayes Hall are 110.5 m apar
- **The gate heading asserts the current minute, and the app never repaints it while it is the screen you are looking at**
  - js/app.js:1830 sets the heading to a live clock reading, "Monday, 11:40pm". js/app.js:2066-2069 refreshes on return to the foreground only when `state.screen === 'list' || state.screen === 'near'`, and the gate lives inside <section id="ask"> (index.html:640). So on the one screen whose whole content is now a function of the minute, coming back to the app does not recompute it.

There is no way ou
  - fix: One word at js/app.js:2068: `if (state.screen === 'list' || state.screen === 'near' || state.screen === 'ask') refresh();`. paintGate is already idempotent and already re-reads clockNow() at line 1798, and the `fresh` guard at line 1832 means focus is not stolen on a repaint of an already-visible ga
- **"Classes have not started yet." on the three days the registrar publishes as having no classes**
  - js/state.js:668-673. The campus clause branches only on `busyDay.weekdays[day]`, which is a weekly pattern, so a weekday that the registrar has published as a no-classes day still reads as an ordinary teaching day whose classes are pending. The app holds the contradicting fact at that moment: closedDayFor returns {state:'no-classes'} for those dates from data/rooms-1268.json, and resolveState (js/
  - fix: Pass the fact into unscheduledGate and let it take the clause it already has. paintGate can hand it `noClasses: !!state.situation?.classesSuspended`, which is on state.situation at that moment, and the campus line becomes `!busyDay?.weekdays?.[day] || noClasses ? 'No classes are scheduled today.' : 
- **The rail's height now comes out of the answer: with both bars up the ranked list is 18px tall at 375x667**
  - index.html:575 moves the rail compensation from the panes to `#sheet`. `#sheet` has `box-sizing: border-box` and an inline pixel height, so padding-bottom does not make the sheet taller, it makes everything inside it shorter. The chips are `flex: none` and the pane is `flex: 1 1 auto`, so the pane absorbs the whole loss. The chips become tappable, which is the fix, but the list pays for them and n
  - fix: Give the sheet back what the rail takes instead of only reserving it. `setSheet` already computes from `window.innerHeight`; add the measured rail to the resting height, e.g. `const rail = parseFloat(getComputedStyle(document.body).getPropertyValue('--bar-h')) || 0;` and rest at `fraction * H + rail
- **A per-screen band with no re-frame moves the camera on every screen change, including Back from a room**
  - js/app.js:111-112 and js/app.js:260 make `band` a function of `state.screen`, but only `frame()` recomposes and nothing calls it on a screen change. `js/map.js` reads `bandOf(viewport)` live in both `viewScale` and `project`, so the moment `state.screen` flips the map redraws at a different scale and a different vertical centre with the same `state.view`. The comment this PR edited at js/app.js:23
  - fix: Re-frame when the screen changes, not only when a row is picked: call `frame(state.selected)` at the end of `showList`, `showNear` and `showRoom` when `state.selected` is set and `state.userMoved` is false, so the composition follows the band it is being drawn into. If the camera move is instead int
- **The per-building cap keys off building count, so the list gets longer as campus empties**
  - js/engine.js:436 picks the cap from `buildings`, not from the number of rows the cap will leave. Crossing a threshold downward *adds* rows, so the shown list is not monotone in how much is actually free. In the shipped hours this is not a corner case: from the Oval it holds for a solid hour of Friday evening, and the footer during that hour advertises rooms the user has no way to reach (the spike 
  - fix: Choose the cap by the list it produces rather than by the building count: start at 1 and raise it while the resulting `out.length` is under a target (about ten), which is monotone by construction and needs no thresholds. It also removes the two magic numbers the comment has to defend.
- **On a closed-campus day the refusal explanation is cut mid-sentence, and the caveat the code calls the one sentence this screen cannot drop falls below the fold**
  - Same root cause as above, on the screen where it costs the most. #near is the screen the app shows when it refuses to rank rooms, and js/app.js:905 says of its caveat: "The one sentence this screen cannot drop. It is the only place on it that says an open building is not an unlocked room, because paintNear renders no caveat and #ask, which carries the other one, is hidden behind it." On a 375x667 
  - fix: Fixed by the same change as the list-collapse finding: raise the sheet by --bar-h instead of taking it out of the panes. Worth an assertion too, since this is the one string the app cannot afford to clip: a test that the #near reason block fits inside the pane at 375x667 with --bar-h at its two-bar 
- **sw.js was not re-stamped although two shell assets changed, so the cache name points at the wrong commit**
  - sw.js:25 still reads `const SHELL_CACHE = 'vacant-shell-b082e53';`, the same value its parent ccd4db5 carries, while this commit changes index.html and js/app.js — both members of SHELL_ASSETS. scripts/stamp-sw.mjs's own docstring says "The cache name is the only thing that makes a deploy land... Run this in whatever job commits, before `git add`. That means the harvest workflow, and it means any 
  - fix: Run `npm run stamp` and amend, so SHELL_CACHE reads 'vacant-shell-ccd4db5'. If this keeps happening, tighten scripts/test/sw.test.mjs to fail when any file in SHELL_ASSETS has changed since the commit named in SHELL_CACHE.
- **shapeClaim makes a date-stamped claim on days the app itself refuses to answer for**
  - js/app.js:1300-1305. shapeClaim names a specific date and then asserts a fact about it, but it reads only the session mask (via timelineRows -> blocksToday). It never consults the calendar the index ships in state.rooms.closed / state.rooms.exams, which js/engine.js:649 calendarOn already reads and which resolveState already uses to refuse. Stepping the day picker into one of those dates now print
  - fix: Add calendarOn to the js/engine.js import at js/app.js:23, and in roomHtml (js/app.js:1336-1345) work out cal = calendarOn(isoDate(date), state.rooms, state.current) and hand it to shapeClaim. In shapeClaim, before naming a class, let the calendar answer: cal.exams -> say the rooms are reassigned fo
- **Not one of the seven app.js and index.html changes is pinned by a test, including the headline fix**
  - The nine new tests all exercise pure functions in js/state.js. Nothing asserts that paintGate calls unscheduledGate at all, so the exact bug in the PR title, paintGate borrowing the buildings screen's UNSCHEDULED pair and printing an empty paragraph under a heading that repeats its own button, can be put straight back with the suite green. Same for the orange border, the .refusal class, the buildi
  - fix: Add source-shape assertions in the existing style, appended at the end of screens.test.mjs: that js/app.js's paintGate body contains unscheduledGate( and no longer contains UNSCHEDULED.head/UNSCHEDULED.body; that it calls classList.add('refusal') and classList.remove('refusal'); that index.html's #g
- **The buildings screen names the furthest of the tied doors while holding the reader's position**
  - js/app.js:848 builds the closed-screen sentence from firstDoor(now), which is deliberately location-free, but paintNear computed groups from state.origin four statements earlier and renders the distance-ranked closed list immediately under that sentence. So on the one screen where the app does know where the reader is standing, it names whichever tied building the index happens to reach first. Fro
  - fix: Keep nextOpening location-free (that is right for the pure module and the question screen), and break the tie at the call site in js/app.js:767 firstDoor, which is app-side and already has state.origin. Return the tied set from nextOpening, or have firstDoor pick from groups.closed, which is already
- **A boot failure with no network paints the gate card underneath the first-run card, and focus lands on a heading nobody can see**
  - js/app.js:2022 bootFailed() unconditionally shows #gate and calls focusHeading($('gate-h')) at :2035. When there is genuinely no network, js/firstrun.js has already opened its own #cold card, which index.html:577 gives z-index 5 while #gate has z-index auto. So the gate card is painted completely underneath it. Two things follow. focusHeading moves focus onto #gate-h, which is covered by #cold-p, 
  - fix: Have bootFailed() stand down when the first-run card is up: an early `if (document.getElementById('cold')) return;` before it touches #gate. js/firstrun.js already owns that refusal, keeps its aria-modal, and its Try again re-probes rather than reloading, which is the better of the two buttons. If t

## Next steps, in order

1. **Wave A fix round.** Feed the blockers and majors back to one agent per lane, in the existing
   worktrees at `Projects/_vacant-lanes/<lane>`. Same rules: run it, do not read it.
2. **Re-review** the fixed PRs (same 4-lens shape), then run the **integration agent**, which never
   ran. It merges all five into a scratch branch and drives the merged app at 7 pinned moments. This
   project has already been bitten by branches that merged clean and were broken anyway, so do not
   skip it.
3. **Merge** in this order: room-day, night-gate, list-bounds, startup-deadends, sheet-frame.
4. **After each merge to main**, re-stamp the sw.js gzip figure. Every lane touched it, main was
   already 0.71% into a 1% tolerance, and the merged shell is bigger than any single branch. Helper:
   `scratchpad/lead/restamp-gzip.mjs <repo> [--check]` (recreate it, it is not committed).
5. **Wave B**: `night-rooms-reachable` — building rows open the rooms behind them. Must follow #79 and #82.
6. **Wave C**: `frame-loop-idle` — closes #75. Runs LAST and ALONE; every earlier lane adds repaint
   paths it has to cover.

## Decisions already made (do not relitigate)

- Gate says state + first door, ONE line, no classroom count.
- Per-building cap is ADAPTIVE: 1 while 10+ buildings clear the bound, 2 below, uncapped under 5.
- OFF_CAMPUS_KM 8 -> 2.2, and the sentence is about walkability, not geography.
- No clock pin for real users. Day-stepping on the room screen is the answer to "where at 10am tomorrow".

## Still needs Enes

**Issue [#78](https://github.com/EnesYilmazcode/Vacant/issues/78), keep or cut the Maps button.** Not
in any lane. Closed issue #52 forbade it and it shipped anyway. Recommendation was keep + write the
reversing DECISIONS.md entry, because the app refuses turn-by-turn on principle and that only reads as
honesty if there is a visible exit to a tool that does route.

## Caveat if this moves to a cloud session

This repo verifies everything through headless Chrome (`scripts/shoot.mjs`: "needs Chrome or Chromium
on the machine and nothing else"). Every probe used here drives it. **Test that Chrome exists in the
cloud sandbox first.** Without it this project loses its empirical gate and falls back to reading
diffs, which is how the decorative tests above got written in the first place.
