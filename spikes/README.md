# spikes

Three instruments for three issues that were blocked on holding a phone. Each is
one page. Open it, do the errand, press Report, paste the markdown onto the issue.

Live once merged:

- `https://enesyilmazcode.github.io/Vacant/spikes/geo.html`
- `https://enesyilmazcode.github.io/Vacant/spikes/launch.html`
- `https://enesyilmazcode.github.io/Vacant/spikes/walk.html`

These are instruments, not product. They are plain on purpose. They are light
rather than dark because they get read outdoors.

## geo.html, for [#5](https://github.com/EnesYilmazcode/Vacant/issues/5)

Does geolocation work in an installed PWA on current iOS.

Add the site to the home screen, open it from the icon, open this page, tap
**Get a fix**. It runs two calls: `maximumAge: 0`, the configuration #5 asks
for, then `maximumAge: 60000`, the one `js/app.js` ships. The elapsed times are
wall clock, measured in the page around the call, not read off the API, because
iOS documents its own `timeout` option as unreliable in a standalone window and
that is the whole question.

Sample the Oval, a middle floor indoors, and the campus edge. Save each one.
Then Report, and paste into `docs/DECISIONS.md`.

Two things it will not do: it will not call an already-granted permission proof
that an alert appeared, and it will not stop listening when the watchdog fires,
because a fix that lands forty seconds late is the signature of the iOS bug and
the most useful thing the page can catch.

## launch.html, for [#29](https://github.com/EnesYilmazcode/Vacant/issues/29)

Cold launch, and the packed-binary decision behind it.

Run it on the laptop first and press **Save as desktop baseline**. Then run it
on the phone. The 4x to 8x multiplier in #29 becomes a measured ratio.

Network and parse are timed separately, because they scale differently and the
packed binary only cares about the parse. Each run parses the string seven times
and reports the median, since one sample on a phone is noise, and keeps the
first parse separately because that is the only one paying a cold JIT.

**Record one run per launch.** A second run in the same window has a warm JIT
and the page marks it so. The verdict is computed from the cold ones, and cold
means either state with no warm process behind it: `cold process` and
`cold everything` both count, pooled for the median and printed apart under it.
`cold everything` is the case #29 is actually asking about.

Outside the term the page still times the fetch and the parse, because those
cost the same on any date. It does not print a room count: the app refuses to
rank at all out of term, so the rows `rank()` returns are a timing sample and
the page says so where the count used to be.

## walk.html, for [#26](https://github.com/EnesYilmazcode/Vacant/issues/26)

Twenty rooms the app calls free, and what was actually true.

It loads the real `data/rooms-1268.json`, `data/buildings-1268.json` and
`data/buildings-hours.json`, ranks them with the engine, and picks twenty with
quotas so the walk hits the hard cases rather than twenty easy rooms next door:
three the app has a reason to doubt, six in buildings with no published hours,
three general-assignment-proxy rooms, eight ordinary published-hours rooms, and
never more than two per building.

Only rooms free **on arrival** are eligible. A room you would have to wait for
cannot be checked by opening its door.

Tap a row to start its stopwatch, walk there, then tap one of three: open and
empty, open but occupied, locked. Locked asks which door, because the five error
buckets #26 wants only sum to twenty if building and room stay separate. State
lives in `localStorage`, so an interrupted walk survives.

Three things it refuses to do.

**It will not pick outside the term.** `js/app.js` renders a gate and returns
from `boot()` before `state.ready` outside the window in `data/current.json`, so
on 2026-12-23 the app calls zero rooms free. The page reads the same field and
refuses in the same words, then names the dates. Twenty rooms picked on a day
the app answers nothing would be a ground-truth walk measuring nothing.

**It will not score a refusal as an error.** The report splits every outcome by
what the app actually claimed. A row in a building with no published hours reads
"hours not published, so Vacant cannot say when the door locks", so finding that
door locked confirms the refusal rather than falsifying a claim, and it is
counted apart from the doors the app did claim were open. There is no single
error rate across the two strata, because the quota oversamples one of them on
purpose.

**It will not pretend the sample is what a user sees.** `js/app.js` keeps
`usable.slice(0, 40)` and has no pagination. A room with no published hours sorts
below every published-hours room, so at a Thursday 09:00 clock the first one
ranks 450 of 612 and half the twenty picks are unreachable in the product. Each
such row carries its rank on screen and the report gives the split its own
section.

## The modules beside the pages

The pages may not import from `js/`, so a broken app cannot break the instrument
measuring it. Three files are copies of app code and carry a `.vendor` in the
name:

- `engine.vendor.js`, a byte copy of `js/engine.js`.
- `hours.vendor.js`, a hand copy of the two hours functions from `js/app.js`.
- `term.vendor.js`, a hand copy of the term gate from `js/app.js` `provenance()`
  with the DOM taken out.

Three more are the instruments' own logic, kept out of the HTML so `node --test`
can drive them:

- `score.js`, what an outcome at a door says about what the app claimed, and how
  much of a sample the product would ever have shown.
- `drift.js`, the three-state engine comparison.
- `verdict.js`, the #29 decision from recorded runs.

A copy nobody checks is a second definition of "free", so every one of them has a
test, and the three copies also have a tripwire on the app source they came from:

- `test/engine.vendor.test.mjs` fails if the copy is not byte-identical.
- `test/hours.vendor.test.mjs` fails if `js/app.js` stops resolving hours the way
  the copy does, and checks the copy against the shipped table.
- `test/term.vendor.test.mjs` fails if the app's gate moves, and checks the copy
  against the shipped `current.json`.
- `test/score.test.mjs` fails if `js/app.js` stops slicing its list at 40, or
  grows pagination, and pins which outcomes can falsify which claim.
- `test/drift.test.mjs` pins that a missing `js/engine.js` reads as unchecked and
  never as drift.
- `test/verdict.test.mjs` fails if the launch states the page offers and the
  states the verdict counts drift apart.

`walk.html` also re-fetches `js/engine.js` at load and says on screen whether the
copy still matches. It is a fetch, not an import, and it checks the status before
the body, so a missing app file costs the check and not the page.

Re-copy with `cp js/engine.js spikes/engine.vendor.js` and run `node --test`.
