# README corrections, for whoever is rewriting it

Written 2026-08-27 from the `lane/docs` worktree, which does not touch
`README.md`. Fold these in.

**The line numbers in [#25](https://github.com/EnesYilmazcode/Vacant/issues/25)
are already stale**, so every item below is keyed on the text to search for
instead. Each one was checked against the shipped code or the shipped data today,
and the command that checked it is included so you can re-run it rather than
trust me.

Six of these are corrections to wrong claims. The last section is five places a
disclaimer has to appear, only one of which is the README.

---

## 1. `generated` does not live in the room index, and neither do the buildings

**Find:** the `### 4. The room index` JSON example, the one containing
`"generated": "2026-08-26"`.

That example is wrong in two ways. It has a `generated` key that the real file
does not carry, and it nests a `buildings` object with `lat`/`lon` inside
`rooms-<term>.json`, which was split into a separate file so the coordinate data
and the schedule data do not share a cache lifetime.

**Real shape**, read off the shipped files today:

```json
// data/current.json          the build stamp lives HERE
{
  "term": "1268",
  "termName": "Autumn 2026",
  "generated": "2026-08-27T03:37:03Z",
  "rooms": "data/rooms-1268.json",
  "buildings": "data/buildings-1268.json",
  "instruction": ["2026-08-10", "2026-12-11"]
}

// data/rooms-1268.json       871 rooms, 234 KB raw, 26.8 KB gzipped
{
  "term": "1268",
  "schema": "busy=[day,start,end,session] day 0=Sun cap 0=unknown 998=online",
  "sessions": [["2026-08-10", "2026-12-11"], ["2026-08-24", "2026-10-09"]],
  "rooms": {
    "AA0005": { "b": "003", "n": "005", "cap": 40, "type": "2P", "group": false,
                "busy": [[1, 605, 715, 5], [3, 605, 715, 5]] }
  }
}

// data/buildings-1268.json   96 buildings, name/lat/lon only, 7.4 KB
{
  "buildings": {
    "102": { "name": "Oxley Hall", "lat": 39.99654916, "lon": -83.01439966 }
  }
}
```

Two details the README should keep, because they are load-bearing and easy to
lose in a rewrite: `cap: 0` means **seats unknown**, not a room with no seats, and
44 of the 871 rooms carry it. `sessions` is a list because a room's busy block
points at the session it belongs to, which is how partial-term classes stay
correct.

```sh
node -e "const r=require('./data/rooms-1268.json');console.log(Object.keys(r))"
# [ 'term', 'schema', 'sessions', 'rooms' ]      no "generated", no "buildings"
```

## 2. The usable formula is wrong, and it is the formula the whole app is for

**Find:** `usable = gapEnd - now - walkTime(room)`.

**Replace with:**

```
usable = (gapEnd - PACKUP) - max(now + walk, gapStart)
```

The README's version is wrong in two directions at once. It never subtracts the
packup buffer, and it measures from `now` rather than from whichever is later out
of your arrival and the moment the room actually frees up. For a room that is
still busy when you set off, the README's formula credits you with time the room
is not yours.

The constants, from `js/engine.js` lines 7 to 15:

```js
export const WALK_MPM = 78;   // metres per minute, not 80
export const DETOUR   = 1.3;  // straight line x this is roughly the real path
export const PACKUP   = 10;   // minutes left at the end
```

**So "about 80 metres per minute" becomes 78 m/min with an explicit 1.30 detour
factor.** The detour matters more than the 80-to-78 change and the README does
not mention it at all. Understating the walk overstates the room, which is the
one direction this app must not be wrong in.

Also worth fixing in the ASCII diagram, which currently reads
`usable = gap end - arrival time - buffer`. That is closer than the prose but it
still misses the `max(..., gapStart)`.

## 3. The ranking is five honesty tiers, not a distance sort, and not the scored surplus either

**Find:** `Sort by distance. Break ties by how long the room stays free, then by
seats.`

The issue asks for this to become "the scored surplus with `facilityType` ranked
ahead of capacity". **Do not write that either.** It describes a design that was
superseded before it shipped. What actually landed is better and the README should
describe it:

```js
// js/engine.js:171
export function tierOf(row) {
  if (row.hoursKnown) {
    if (row.wait === 0) return row.meetsNeed ? 0 : 1;
    return 2;
  }
  return row.wait === 0 ? 3 : 4;
}

out.sort((a, b) => a.tier - b.tier || a.walk - b.walk || (b.usable ?? 0) - (a.usable ?? 0));
```

In prose: **rooms sort by how much we actually know about them, then by walk time,
then by how long they stay yours.**

```
tier 0   hours published, free now, free long enough
tier 1   hours published, free now, not for as long as you asked
tier 2   hours published, free later
tier 3   no published hours, free now
tier 4   no published hours, free later
```

Every room in a building with published hours outranks every room in a building
without, however close the second one is. That is the honesty rule expressed as a
sort key, and it is the most quotable thing in the engine.

Seats are not in the sort at all. They are display only.

## 4. It is equirectangular, not haversine, and the error is smaller than anybody claimed

**Find:** `Haversine distance to the building centroid is plenty at campus
scale.`

`js/engine.js:23` uses an equirectangular approximation, because it runs over
every room on every keystroke and a haversine per room is arithmetic nobody
needs.

**The issue says "max error 0.1285 m over 298 campus buildings". I could not
reproduce that figure against any set in the repository**, and the real numbers
are one to two orders of magnitude smaller. Measured today against a haversine
reference, on the shipped coordinates:

```
from the Oval, 96 class-hosting buildings     max error  0.0007 m
from the Oval, all 612 buildings to 20 km     max error  0.0073 m
all 4,560 pairs among the 96                  max error  0.0029 m
all 186,966 pairs among the 612               max error  0.0414 m
```

The first row is the one the app actually computes, since the origin is a person
standing on campus. **Under a millimetre.** Write whichever of those the README
has room for, but write a measured one, and say what it was measured against.

## 5. `## License` still says TBD, and the ODbL half of its plan is wrong

**Find:** the `## License` section, which reads `TBD.` and then recommends "a
three way split: MIT for the code, ODbL 1.0 for the OSM derived building data,
and no rights asserted over the OSU derived schedule."

**There is no OSM derived building data.** Every shipped coordinate comes from
Ohio State's own GIS server. OpenStreetMap produced one audit column,
`osm_check_m`, on 73 rows of `buildings.draft.json`, which the app never fetches.
So ODbL is not engaged, there is no `LICENSE-ODbL.txt`, and there is no
OpenStreetMap credit anywhere.

```sh
grep -c osm_check_m data/buildings.json          # 0
grep -c osm_check_m data/buildings-1268.json     # 0
grep -c osm_check_m data/campus.json             # 0
grep -c osm_check_m data/buildings.draft.json    # 73
```

**Replacement text:**

> ## License
>
> MIT for the code. See [LICENSE](LICENSE).
>
> `data/rooms-<term>.json` is derived from Ohio State's public class schedule and
> is published as facts, with no additional rights asserted. Facts are not
> copyrightable and a software licence does not fit a dataset.
>
> Building coordinates and the campus map come from Ohio State's own GIS service:
> **Building locations (c) 2025 The Ohio State University, Facilities Information
> and Technology Services.**
>
> Per-file provenance is in [`data/README.md`](data/README.md). The reasoning
> behind the ODbL answer is in
> [`docs/DECISIONS.md`](docs/DECISIONS.md), under `2026-08-27`.

Note that `docs/research/legal-privacy.md` section 6 says the opposite, in strong
language ("this is not a judgment call"). It was written when the plan was still
an Overpass extraction. The decision entry explains this so nobody re-derives the
old answer off the research note.

## 6. The money rule has to be in the README, not only in the issue

**Find:** anywhere the README discusses the project's future, or add a short
section next to the licence.

> Vacant carries no ads, no donations, no sponsorships, no affiliate links and no
> paid tier, and it never will. Ohio State's Responsible Use policy asks users to
> "refrain from using university resources for personal commercial purposes or
> for personal financial or other gain", and its operative limit is a
> discretionary reasonableness standard with no numeric safe harbour. The moment
> money is involved, "please throttle" becomes a named violation. GitHub Pages
> independently forbids running a business off it. Both point the same way.

This is the hardest constraint in the project and the easiest to forget in a
year, which is why it needs to be in the README rather than only in an issue.

---

## The disclaimer, and the four places that are not yours

The short form, used verbatim:

> Vacant is a student project. It is not affiliated with, authorized by, or
> endorsed by The Ohio State University.

It has to appear in five places. **Only the first is a README change.** The other
four belong to whoever owns `index.html` and the manifest, and as of today none
of them exist. Checked:

```sh
grep -rn "not affiliated" index.html README.md privacy.html
# privacy.html:7    (meta description)
# privacy.html:176  (footer)
```

| Place | Form | Owner today | Status |
| --- | --- | --- | --- |
| `README.md`, near the top, not buried at the end | long | **you** | missing |
| Results screen footer, always rendered, never behind a menu | short | `index.html` lane | missing |
| `<meta name="description">` and `og:description` | short | `index.html` lane | missing |
| Manifest `description` | short | manifest lane, file does not exist yet | missing |
| `privacy.html` footer | short | done | **done** |

### The privacy page has no way in

`privacy.html` ships in this lane, and nothing links to it. `grep -n privacy
index.html` returns nothing: there is no footer, no About panel and no nav for a
link to live in, so today a student cannot reach the page from inside the app.
The page links back out with `<a href="./">Back to Vacant</a>`, which makes it a
one-way door.

**This blocks the launch**, and it is gated in `LAUNCH.md`. The link has to say
`privacy.html` with the extension, because `.nojekyll` means Pages does no
extensionless routing: `/Vacant/privacy.html` is 200 and `/Vacant/privacy` is a
404, verified against the mirroring server. Nothing in this lane's tests can
catch its absence, because the file that needs the link is not this lane's to
edit.

The long form for the README:

> Vacant is an independent student project. It is not affiliated with, authorized
> by, maintained by, sponsored by, or endorsed by The Ohio State University or any
> of its offices. Class and room information comes from Ohio State's public class
> search. Building locations come from Ohio State's Facilities Information and
> Technology Services GIS service. "The Ohio State University" and "Ohio State"
> are trademarks of The Ohio State University and are used here only to describe
> what this app covers.

Note this differs from the version in `research/legal-privacy.md`, which credits
OpenStreetMap. See correction 5.

**The footer wording** the results screen should carry, for whoever builds it:

```
Vacant is a student project. It is not affiliated with,
authorized by, or endorsed by The Ohio State University.

Room data from Ohio State's public class search. Building
locations (c) 2025 The Ohio State University, Facilities
Information and Technology Services.

About  ·  Privacy  ·  Data
```

The Privacy link is **`privacy.html`**, with the extension. `.nojekyll` means
Pages does no extensionless routing: verified locally that `/Vacant/privacy.html`
is 200 and `/Vacant/privacy` is 404.

## The brand grep passes, but the issue's pattern is wrong

The issue asks for `grep -ri 'BA0C2F\|block o\|brutus' index.html css/ manifest.webmanifest`
to return nothing. Two problems: `css/` and `manifest.webmanifest` do not exist
yet, and `block o` matches case-insensitively inside "block of", so it fires on
`for (const block of blocks)` in `js/engine.js:102`.

The pattern that tests what was meant:

```sh
grep -rniE 'BA0C2F|block-o|Block O[^f]|brutus|scarlet' index.html js/ privacy.html README.md
```

That returns nothing today. The accent colour is `#ff4d3d`, which is not OSU
scarlet `#BA0C2F`. Keep it that way, and if the grep is turned into a test, use
the second pattern and add `css/` and `manifest.webmanifest` to it once they
exist.

---

## Numbers you can quote, all measured today

Handy for a rewrite, and all re-runnable:

```
room index              871 rooms, 96 buildings, 234 KB raw, 26.8 KB gzipped
buildings with hours    46 of 96, covering 626 of 871 rooms (71.9%)
first launch            481,460 bytes raw, 104,830 gzipped (102.4 KB)
published site          7,030,232 bytes over 311 files
harvest                 545 requests a run, ~19.5 MB, run by hand about weekly
                        (no scheduled workflow exists, see DATA.md)
one API page            37,460 bytes gzipped on the wire (measured 2026-08-27)
instructor records
  removed at parse      45,483 across the two archived terms, 0 survived
open on Saturday        5 of the Registrar's 47 pool buildings
roomless timed
  in-person meetings    881 of 9,541 across both archived terms (9.2%)
```

One trap: `current.json`'s `instruction` field is `["2026-08-10","2026-12-11"]`,
which is the min and max of every harvested meeting date, not the semester. The
Autumn 2026 semester is **25 August to 9 December**, with finals 11 to 17
December. Three sources agree on that. Do not quote the `instruction` pair as the
term.
