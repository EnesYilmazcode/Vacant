---
title: Refuse a bad build on busy blocks and minutes, not room count, with a fatal PII scan
labels: data, ops
milestone: Phase 1: Data pipeline
estimate: M
order: 10
depends_on: room-index-and-current-json, buildings-json-from-osu-gis
---

Vacant ships the absence of data as a positive claim. A healthy harvest already reads 81.0% free across Mon-Fri 08:00 to 22:00, so a run that loses busy blocks does not look broken, it looks like good news. Only 18 of 290 rooms (6.2%) have a single block all week, which means a run that silently drops a fifth of its blocks moves room count less than Finder's 10% `MAX_DROP` and ships a grid that invents free time. The guards have to count blocks and minutes.

### What to do

Copy `Finder/scripts/guards.mjs` (91 lines, pure functions, every threshold passed in by the caller) to `scripts/guards.mjs` with a provenance comment. Change `MAX_DROP` to `0.05` and change nothing else: the grid is static within a term by construction, so a 10% tolerance on a file that should not move is most of a partial failure.

Build Vacant's own guards on top, in the harvester. Floors vary by term because Summer is a third the size of Autumn:

```js
// Floors only bite on a term's FIRST run; the previous-committed comparison
// does the work from run two. Every number here is PROVISIONAL.
const FLOORS = {
  // Spring / Autumn. From a 13-page Autumn 1268 slice: 467 rooms, 80 buildings,
  // 2487 blocks. A full harvest is several times this.
  '2': { rooms: 400, buildings: 40, blocks: 1200, minutes: 90000 },
  '8': { rooms: 400, buildings: 40, blocks: 1200, minutes: 90000 },
  // Summer. ~60% of a near-complete 1264 census: 198 rooms, 52 buildings, 804 blocks.
  '4': { rooms: 120, buildings: 30, blocks: 450,  minutes: 30000 },
};
const floorsFor = (term) => FLOORS[String(term).slice(-1)];
```

Per term, against `data/rooms-<term>.json` as committed:

```
refusals = [
  countRefusal('busy blocks',  blocks,    floor.blocks,    prev.blocks),
  countRefusal('busy minutes', minutes,   floor.minutes,   prev.minutes),
  countRefusal('rooms',        rooms,     floor.rooms,     prev.rooms),
  countRefusal('buildings',    buildings, floor.buildings, prev.buildings),
  lostRooms.length      ? fatal(named list)     : null,  // had blocks, now none
  gutted.length > 5     ? forceable(named list) : null,  // kept under half its blocks
  weekdayBalance < 0.30 ? forceable(...)        : null,  // Mon-Fri ONLY
  residueRefusal('meeting times', parsed, failed, 0.002),        // fatal
  unresolvedCodes.length ? fatal(named list)    : null,  // vs data/buildings.json
  noCoordRate > 0.10     ? fatal(...)           : null,
  /@/ scan of the serialized JSON ? fatal(...)  : null,  // never yields to FORCE_WRITE
]

if (belowFloor && !committedFileExists) { print reason; skip term; exit 0 }  // NOT READY
if (belowFloor &&  committedFileExists) { refuse; keep old file;  exit 1 }   // COLLAPSE
```

The PII scan runs `/[A-Za-z0-9._+-]+@[A-Za-z0-9.-]+/` over the serialized string and aborts with `fatal()`. `instructors[].email` carries real `osu.edu` addresses (64 distinct instructors, 208 email occurrences in one page of one subject), so a leak here is a public, offline-cached professor-location tracker.

### Done when

- [ ] `scripts/guards.mjs` matches Finder's file byte for byte except `MAX_DROP = 0.1` -> `0.05` and one added provenance comment naming `EnesYilmazcode/Finder` (MIT). The four exported functions are unchanged and the file contains no Vacant-specific string.
- [ ] Each harvested term is checked on busy blocks, busy minutes, rooms and buildings, against both `floorsFor(term)` and the counts read out of the committed `data/rooms-<term>.json`.
- [ ] `FLOORS` is a lookup on the last digit of the term code, with a comment per row recording the sample it came from and the word `PROVISIONAL`. Summer 1264's real 198 / 52 / 804 clears its own floor.
- [ ] `lostRooms` (a room with blocks in the committed file and none now) refuses with the room ids listed and does not clear under `FORCE_WRITE=1`.
- [ ] `roomsGutted` (more than 5 rooms keeping under half their committed block count) refuses with the room ids listed and clears under `FORCE_WRITE=1`.
- [ ] `weekdayBalance` is computed over Monday to Friday only, refuses below 0.30, and clears under `FORCE_WRITE=1`. Autumn 1268 (0.57) and Summer 1264 (0.46) both pass.
- [ ] A term below floor with no committed file prints a named reason and exits 0 without writing. A term below floor with a committed file exits 1 and leaves the committed file untouched.
- [ ] The PII scan runs on the serialized JSON, aborts on any regex match, and `FORCE_WRITE=1` does not clear it.
- [ ] The build fails, naming every offending code, when a harvested `buildingCode` other than `ONLINE` or `OFFCAMPUS` has no entry in `data/buildings.json`; and fails when more than 10% of harvested rooms resolve to a building with no lat/lon.
- [ ] The `FORCE_WRITE` `workflow_dispatch` input description says that a forced write over a collapsed harvest is unrecoverable, because a term deleted from `searchableTermsV2` returns zero sections forever.
- [ ] `docs/DECISIONS.md` records the first full harvest's real rooms, buildings, blocks and minutes per term, resets every floor to about 60% of them, and states which of 422 / 486 / 562 / 625 / 633 / 1,067 the true campus room count actually is.
- [ ] `tests/guards.test.js` covers every refusal firing, every forceable one clearing under `FORCE_WRITE=1`, the PII guard refusing to clear under it, and the not-ready versus collapse split. Runs offline, `node --test`.

### Notes

`FORCE_WRITE=1` over a collapsed harvest destroys a term permanently. Term 1258 already returns `totalItems: 0`, and Spring 2026 (1262) left `searchableTermsV2` on 2026-08-31, so the committed file is the only copy of that term's grid anywhere. The refusal guard is the backup.

The `weekdayBalance` divisor is not zero on weekends any more. Summer 1264 measured `sat=8 sun=2` and Autumn 1268 `sat=1 sun=1`, so a ratio computed over all seven days divides by a near-zero Saturday every week. Mon-Fri only.

`timeResidue` at 0.002 is strict on purpose: the measured rate is 0 of 1,813 meetings that carry a real `facilityId`. If `toMinutes` starts returning null the `"8:00 am"` format changed and nothing about the run should ship.

Every floor above is seeded from samples that disagree by up to 2.5x on room count. They are backstops a first run clears trivially, not targets, and re-baselining them is part of this issue rather than a follow-up.
