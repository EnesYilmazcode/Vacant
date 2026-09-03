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

**Add THIS PAGE to the home screen, not the app.** In Safari, open
`/Vacant/spikes/geo.html`, then `...`, Share, Add to Home Screen. Open the icon
it makes and tap **Get a fix**.

The obvious version of that instruction, add the site and then open this page
from it, cannot be carried out. The app icon opens `/Vacant/` in a standalone
window with no address bar, and nothing in `index.html` or `js/` links to a
spike page, so from inside the installed app this page is unreachable. That is
also why the page carries its own home screen icon, a ring rather than the app's
filled dot: two Vacant icons will be sitting side by side and an identical pair
would be a coin toss every time.

The page runs two calls: `maximumAge: 0`, the configuration #5 asks
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

The laptop half is already done and it is not done with this page. Run
`node scripts/launch-desktop.mjs`, which drives the shipped app in headless
Chrome at 1x, 4x and 6x CPU throttling and reads the app's own
`performance.mark` calls. The numbers, and what they already settle, are in the
`2026-09-02` entry in `docs/DECISIONS.md`. This page is the phone half: run it on
the phone, and it confirms or refutes a desk number rather than producing one
from nothing. Press **Save as desktop baseline** on the laptop as well if you
want the page's own fetch-to-answer ratio beside the app's.

Network and parse are timed separately, because they scale differently and the
packed binary only cares about the parse.

`data/current.json` is fetched first, alone, because `js/app.js` `boot()` cannot
ask for the index until it arrives: the pointer is the file that names the
index. That wait gets its own column, `ptr`. On a desk it is single-digit
milliseconds. On a phone link it is a whole round trip in front of the biggest
file the first answer needs, and it is the only number on the page that no
desktop run can stand in for. Each run parses the string seven times
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

**The map panel is the one place in `spikes/` that loads app code.** It answers
the four questions the revision comment on #29 adds: whether the canvas
allocation succeeds, whether it is GPU backed, what the first blit costs against
every later one, and how big the raster is, plus `buildBasemap`'s wall clock.
The vendoring rule below exists so a broken app cannot break the instrument, and
it is the wrong rule here, because `buildBasemap`'s own wall clock is the
measurement and a copy that had drifted would report a confident number for code
the app does not run. So it is a dynamic `import()` inside a `try`, taken last,
after every timing number is already recorded: a missing or broken `js/map.js`
costs that panel and nothing else on the page.

**There is no frame counter, and there will not be one.** The revision comment
asks for one. The loop it wanted counted was replaced by the wake-driven
`createFrameLoop` in `js/map.js` in
[#94](https://github.com/EnesYilmazcode/Vacant/issues/94), and a settled list
asks for **0** frames in three seconds at 1x, 4x and 6x CPU throttling, five
runs at each, measured with `node scripts/launch-desktop.mjs`. An instrument
that can only ever print zero teaches its reader that the panel is decoration.

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
- `raster.js`, what the map panel's three verdicts say: whether the raster was
  really allocated, whether the first blit paid for an upload, and whether the
  canvas is on the GPU.

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
- `test/raster.test.mjs` pins which readings mean allocated, uploaded and GPU
  backed, and fails if `launch.html` stops asking `raster.js` at all.

`walk.html` also re-fetches `js/engine.js` at load and says on screen whether the
copy still matches. It is a fetch, not an import, and it checks the status before
the body, so a missing app file costs the check and not the page.

Re-copy with `cp js/engine.js spikes/engine.vendor.js` and run `node --test`.
