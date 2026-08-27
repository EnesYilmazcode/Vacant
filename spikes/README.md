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
and the page marks it so. The verdict is computed from the cold ones.

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

## engine.vendor.js and hours.vendor.js

The pages may not import from `js/`, so a broken app cannot break the instrument
measuring it. `engine.vendor.js` is therefore a byte copy of `js/engine.js`, and
`hours.vendor.js` is a hand copy of the two hours functions from `js/app.js`,
which is a DOM module a standalone page cannot import.

A copy nobody checks is a second definition of "free", so there are three checks:

- `spikes/test/engine.vendor.test.mjs` fails if the copy is not byte-identical.
- `spikes/test/hours.vendor.test.mjs` fails if `js/app.js` stops resolving hours
  the way the copy does, and checks the copy against the shipped table.
- `walk.html` re-fetches `js/engine.js` at load and says on screen whether the
  copy still matches. It is a fetch, not an import, so a missing app file costs
  the check and not the page.

Re-copy with `cp js/engine.js spikes/engine.vendor.js` and run `node --test`.
