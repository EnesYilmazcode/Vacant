// Offline. Every fixture at the bottom of this file is real markup lifted out of
// the committed page cache, trimmed to the panels the parsers read and with the
// whitespace squeezed. No network, and no fixture files: the repo has no
// scripts/test/fixtures/ and hours.test.mjs keeps its HTML inline.
//
// The traps are named in fetch-room-features.mjs's own header. The two that cost
// real accuracy are the legend panel, which lists all 13 characteristic codes
// once each before the first room, and the word "moveable", which the Registrar
// uses to mean NOT BOLTED and Learning Spaces uses to mean ON CASTERS.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  derive,
  findTermLink,
  normRoom,
  parseLearningSpacesIndex,
  parseLearningSpacesPage,
  parseRegistrar,
} from '../fetch-room-features.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const PANEL = '<div class="panel panel-default">';
const registrarPage = (...panels) => panels.map((p) => PANEL + p).join('\n');

// ------------------------------------------------------------- the Registrar

test('the legend panel contributes no rooms, and its 13 codes land in no room', () => {
  // THE trap. The page opens with a panel listing every characteristic code
  // once. A whole-page or whole-panel scrape puts all 13 into the first room and
  // leaves every per-room total one high. Splitting on the "Facility ID:" marker
  // leaves the legend in the head of a segment nobody keeps.
  const { rooms, buildings } = parseRegistrar(registrarPage(LEGEND, ENARSON, AG_ADMIN));
  assert.deepEqual([...rooms.keys()], ['EC0014', 'EC0015', 'AA0246', 'AA0247']);
  assert.equal(buildings.length, 2, 'the legend panel is not a building');
  for (const room of rooms.values()) {
    assert.ok(room.codes.length <= 5, room.facilityId + ' took the legend: ' + room.codes);
  }
  assert.deepEqual(rooms.get('EC0014').codes, [32, 40, 42, 44, 54]);
});

test('a room that also prints its codes inline is not counted twice', () => {
  // AA0247 is the one room on the Autumn 2026 page that repeats its codes as
  // prose, "Room Characteristics: 32, 39, 41, 44", ahead of the list. A regex
  // over the segment rather than over the list doubles every one of them.
  const { rooms } = parseRegistrar(registrarPage(LEGEND, AG_ADMIN));
  assert.deepEqual(rooms.get('AA0247').codes, [32, 39, 41, 44]);
  assert.equal(rooms.get('AA0247').characteristics.length, 4);
  assert.deepEqual(rooms.get('AA0246').codes, [30, 39, 41, 44]);
});

test('the map link decides the building number and the disagreement is reported', () => {
  // Enarson's panel prints 027 and links building 072. 072 is the number the
  // ArcGIS layer and the photo stems use, so it wins, and swallowing the split
  // would hide a source that has gone wrong somewhere else too.
  const { rooms, numberDisagreements } = parseRegistrar(registrarPage(LEGEND, ENARSON, AG_ADMIN));
  assert.equal(rooms.get('EC0014').buildingNumber, '072');
  assert.deepEqual(numberDisagreements, [
    {
      building: 'Enarson Classroom Building',
      mapLink: '072',
      panelText: '027',
      used: '072',
    },
  ]);
  assert.equal(rooms.get('AA0246').buildingNumber, '003', 'Ag. Admin. agrees with itself');
});

test('a facility id survives the non-breaking space the page puts inside the anchor', () => {
  // EC0014's link reads "Facility ID: EC0014 ". An id carrying that
  // character joins to nothing in the room index.
  const { rooms } = parseRegistrar(registrarPage(LEGEND, ENARSON));
  assert.ok(ENARSON.includes('EC0014 '), 'the fixture still carries the real trailing nbsp');
  assert.ok(rooms.has('EC0014'));
  assert.equal(rooms.get('EC0014').capacity, 30);
  assert.equal(rooms.get('EC0015').capacity, 26);
});

test('an unrecognised characteristic code is kept with the page own label, never dropped', () => {
  // The code table is an allow list with a safe default. A new code has to reach
  // the report, and it must not cost the room its other characteristics.
  const extended = AG_ADMIN.replace(
    '<li>32 - Moveable Tables/Chairs</li>',
    '<li>32 - Moveable Tables/Chairs</li>\n<li>61 - Hearing Loop</li>',
  );
  const { rooms, unknownCodes } = parseRegistrar(registrarPage(LEGEND, extended));
  assert.deepEqual([...unknownCodes], [[61, 'Hearing Loop']]);
  assert.deepEqual(rooms.get('AA0247').codes, [32, 61, 39, 41, 44]);
  assert.equal(rooms.get('AA0247').characteristics[1].label, 'Hearing Loop');
  assert.equal(rooms.get('AA0247').characteristics[0].label, 'Moveable Tables/Chairs');
});

test('the term page is found by matching a published link, never by building a slug', () => {
  const index = [
    '<a href="/staff-resources/class-catalog-and-space/general-assignment-rooms/">index</a>',
    '<a href="/staff-resources/class-catalog-and-space/general-assignment-rooms/autumn-2026-general-assignment-rooms/">Autumn</a>',
    '<a href="/staff-resources/class-catalog-and-space/general-assignment-rooms/spring-2027-general-assignment-rooms/">Spring</a>',
  ].join('\n');
  const hit = findTermLink(index, 'Autumn 2026');
  assert.equal(hit.slug, 'autumn-2026-general-assignment-rooms');
  assert.ok(hit.url.startsWith('https://registrar.osu.edu/staff-resources/'));
  assert.ok(hit.url.endsWith('/autumn-2026-general-assignment-rooms/'));
  // A term the Registrar has not published yet returns nothing AND says what it
  // does publish, so the failure names the fix instead of 404ing upstream.
  const miss = findTermLink(index, 'Summer 2027');
  assert.equal(miss.url, null);
  assert.deepEqual(miss.all, [
    'autumn-2026-general-assignment-rooms',
    'spring-2027-general-assignment-rooms',
  ]);
});

// -------------------------------------------------------- the Learning Spaces

test('the index yields every card, including the ones with no photograph', () => {
  const cards = parseLearningSpacesIndex(LS_INDEX);
  assert.deepEqual(
    cards.map((c) => c.slug),
    [
      'enarson-classroom-building-322',
      'campbell-hall-100',
      'campbell-hall-100-0',
      'campbell-hall-193',
    ],
  );
  assert.equal(cards[0].photo, 'https://rooms.app.it.osu.edu/072-03-0322-front.jpg');
  assert.equal(cards[0].building, 'Enarson Classroom Building', 'the result count is not part of the name');
  // 5 of the 320 live cards carry no image. Dropping them loses the rooms
  // entirely, so they fall through to the accordion title instead.
  assert.equal(cards[3].photo, null);
  assert.equal(cards[3].title, 'Campbell Hall 193');
});

test('two cards for one room both survive the index, so the merge can pick', () => {
  // campbell-hall-100 and campbell-hall-100-0 are the same room published twice.
  // Deduping here would choose silently; the merge records which page it kept
  // and which it dropped.
  const hundred = parseLearningSpacesIndex(LS_INDEX).filter((c) => c.title === 'Campbell Hall 100');
  assert.equal(hundred.length, 2);
  assert.notEqual(hundred[0].slug, hundred[1].slug);
});

test('a classroom page reads every field the merge needs', () => {
  const room = parseLearningSpacesPage(CLASSROOM, {
    url: 'https://learningspaces.osu.edu/classroom/enarson-classroom-building-322',
    slug: 'enarson-classroom-building-322',
  });
  assert.equal(room.title, 'Enarson Classroom Building 322');
  assert.equal(room.campus, 'Columbus');
  assert.equal(room.seats, 34);
  assert.equal(room.furnitureType, 'Fixed Tablet Arms');
  assert.equal(room.darkeningQuality, 'High');
  assert.equal(room.airConditioning, true);
  assert.equal(room.carpeted, false, 'No is false, not null');
  assert.equal(room.heightAdjustableLectern, false);
  assert.equal(room.bestAffordance, 'In-Person Lecture');
  assert.deepEqual(room.supportGroup, ['OTDI Classroom Services']);
  assert.deepEqual(room.additionalAV, ['Classroom Computer', 'Document Camera', 'Projector']);
});

test('a field stops at the next field, and an absent field is empty rather than its neighbour', () => {
  // Drupal renders the fields as a flat run of divs. A multi-value read that
  // does not stop at the next field--name-field-classroom- marker collects the
  // NEXT field's items, and a field the page omits collects everything after
  // where it would have been.
  const room = parseLearningSpacesPage(CLASSROOM, { url: 'u', slug: 's' });
  assert.deepEqual(room.displayInputs, ['HDMI input', 'VGA input']);
  assert.deepEqual(room.microphoneType, ['Wired Mic Input']);
  assert.deepEqual(room.inRoomCamera, ['Webcam (Controllable)']);
  assert.ok(!CLASSROOM.includes('field--name-field-classroom-board-type'));
  assert.deepEqual(room.boardType, [], 'this page publishes no board type at all');
});

test('the 360 tour link is relative on the page and is made absolute', () => {
  const room = parseLearningSpacesPage(CLASSROOM, { url: 'u', slug: 's' });
  assert.ok(CLASSROOM.includes('href="/360viewer/'), 'the page still publishes it relative');
  assert.equal(
    room.tour360,
    'https://learningspaces.osu.edu/360viewer/node/127/25cc4f10-42f5-4630-baa1-07d703af95b3',
  );
  assert.equal(parseLearningSpacesPage('<article></article>', { url: 'u', slug: 's' }).tour360, null);
});

test('the front photograph is picked by name and the list is deduped', () => {
  // Every image appears twice on the page, once in the img and once in its link.
  // The front shot is the one the merge joins on, so it is chosen by suffix
  // rather than by position.
  const room = parseLearningSpacesPage(CLASSROOM, { url: 'u', slug: 's' });
  assert.equal(room.photos.front, 'https://rooms.app.it.osu.edu/072-03-0322-front.jpg');
  assert.deepEqual(room.photos.all, [
    'https://rooms.app.it.osu.edu/072-03-0322-front.jpg',
    'https://rooms.app.it.osu.edu/072-03-0322-rear.jpg',
  ]);
});

// ---------- the merge, and the mobility scale neither source publishes alone

test('the Registrar alone decides bolted, whatever Learning Spaces calls the furniture', () => {
  const bolted = derive({ codes: [33, 39] }, { furnitureType: 'Movable Tables and Chairs' });
  assert.equal(bolted.mobility, 'bolted');
  assert.equal(bolted.mobilityBasis, 'registrar');
  // The two cannot both be right, and the room says so rather than reading as a
  // consensus. 18 rooms in the shipped file are like this.
  assert.equal(bolted.mobilityContested, true);
});

test('casters need both sources, because only Learning Spaces knows about wheels', () => {
  const casters = derive({ codes: [30, 39] }, { furnitureType: 'Moveable Tablet Arms' });
  assert.equal(casters.mobility, 'casters');
  assert.equal(casters.mobilityBasis, 'registrar+learningSpaces');

  const dragged = derive({ codes: [30, 39] }, { furnitureType: 'Fixed Tablet Arms' });
  assert.equal(dragged.mobility, 'freestanding', 'not bolted, and Fixed says no wheels');
  assert.equal(dragged.mobilityBasis, 'registrar+learningSpaces');
});

test('a Learning Spaces value that says nothing about wheels does not become a second source', () => {
  // The bug this guards. "Movable Tables and Chairs", "Fixed Table and Chairs"
  // and "Group Seating" describe furniture, not how it moves. Treating any
  // non-caster value as proof of no wheels claimed two-source support on 68
  // rooms only one source had an opinion about.
  for (const furniture of ['Movable Tables and Chairs', 'Fixed Table and Chairs', 'Group Seating']) {
    const room = derive({ codes: [32, 39] }, { furnitureType: furniture });
    assert.equal(room.mobility, 'freestanding', furniture);
    assert.equal(room.mobilityBasis, 'registrar', furniture);
  }
  assert.equal(derive({ codes: [32] }, null).mobilityBasis, 'registrar');
});

test('Learning Spaces alone can assert casters and nothing else', () => {
  // Its "Fixed" means no casters, which is true of a bolted chair and of one you
  // can drag. So it can never decide bolted on its own.
  const casters = derive(null, { furnitureType: 'Moveable Tablet Arms' });
  assert.equal(casters.mobility, 'casters');
  assert.equal(casters.mobilityBasis, 'learningSpaces');

  const fixed = derive(null, { furnitureType: 'Fixed Tablet Arms' });
  assert.equal(fixed.mobility, null, 'no casters is not the same as bolted');
  assert.equal(fixed.mobilityBasis, null);
  assert.equal(fixed.seatingFamily, 'tablet-arm', 'the family is still known');
});

test('windows are only claimed when the two codes agree', () => {
  assert.equal(derive({ codes: [39] }, null).windows, true);
  assert.equal(derive({ codes: [40] }, null).windows, false);
  assert.equal(derive({ codes: [39, 40] }, null).windows, null, 'both codes is not an answer');
  assert.equal(derive({ codes: [43] }, null).windows, null, 'neither code is not "no windows"');
  assert.equal(derive(null, { furnitureType: null }).windows, null);
});

test('boards come from the Registrar where it has a row and from Learning Spaces otherwise', () => {
  assert.deepEqual(derive({ codes: [43] }, { boardType: ['Dry Erase'] }).boards, {
    chalk: true,
    white: false,
  });
  assert.deepEqual(derive(null, { boardType: ['Chalk', 'Dry Erase'] }).boards, {
    chalk: true,
    white: true,
  });
  assert.equal(derive(null, { boardType: [] }).boards, null, 'no source is null, not "no boards"');
});

test('a room number and its photo stem collapse to one key without touching a wing letter', () => {
  // EC0322 carries room "322" and its photograph is 072-03-0322-front.jpg.
  // SOE0004 carries "E004" against a stem of "E0004".
  assert.equal(normRoom('322'), normRoom('0322'));
  assert.equal(normRoom('E004'), normRoom('E0004'));
  assert.equal(normRoom('E004'), 'E4', 'the wing letter survives');
  assert.notEqual(normRoom('E004'), normRoom('004'));
  assert.equal(normRoom('346D'), '346D');
  assert.equal(normRoom('2125/35'), '212535', 'FL2125/35 is one room with a slash in its name');
});

// ----------------------------------------------- the file that actually ships

const shipped = JSON.parse(read(join('data', 'room-features.json')));

test('the shipped file still covers the rooms it was built to cover', () => {
  // Measured 2026-09-03 against term 1268. A regeneration that quietly loses a
  // source shows up here as a coverage number, not as an empty screen.
  const cov = shipped._meta.coverage;
  assert.equal(Object.keys(shipped.rooms).length, 328);
  assert.equal(cov.vacantRooms, 425);
  assert.equal(cov.registrar, 327);
  assert.equal(cov.learningSpaces, 311);
  assert.equal(cov.both, 310);
  assert.equal(cov.union, 328);
  assert.equal(cov.noFeatureData, 97);
  assert.equal(cov.noFeatureDataRooms.length, 97);
  // Every uncovered room is one a department owns rather than one the Registrar
  // schedules, which is why neither source publishes it. If that stops being
  // true the gap is a parser failure and not the shape of the sources.
  assert.equal(cov.noFeatureDataDepartmental, 97);
  assert.deepEqual(cov.noFeatureDataByType, {
    '1A': 15, '1B': 40, '2J': 1, '2P': 19, '2Q': 7, '5C': 2, '5K': 12, '6L': 1,
  });
});

test('every shipped key is a room the app actually indexes', () => {
  const index = JSON.parse(read(join('data', 'rooms-1268.json')));
  for (const [key, room] of Object.entries(shipped.rooms)) {
    assert.ok(index.rooms[key], key + ' is not in rooms-1268.json');
    assert.ok(room.sources.length > 0, key);
    for (const s of room.sources) {
      assert.ok(['registrar', 'learningSpaces'].includes(s), key + ' ' + s);
    }
    assert.ok(room.derived, key);
    assert.ok(room.capacity, key);
  }
  for (const key of shipped._meta.coverage.noFeatureDataRooms) {
    assert.ok(index.rooms[key], key);
    assert.equal(shipped.rooms[key], undefined, key + ' is listed as uncovered and shipped');
  }
});

test('the characteristic histogram is the one the Registrar published', () => {
  // 13 codes and the count of each. A markup change that turns a list item into
  // a paragraph shows up as a code going to zero rather than as a quieter room.
  const counts = {};
  for (const room of Object.values(shipped.rooms)) {
    for (const code of room.registrar?.codes ?? []) counts[code] = (counts[code] ?? 0) + 1;
  }
  assert.deepEqual(counts, {
    30: 181, 31: 32, 32: 84, 33: 30, 37: 60, 39: 214, 40: 112,
    41: 142, 42: 59, 43: 239, 44: 85, 53: 1, 54: 7,
  });
  assert.deepEqual(shipped._meta.sources.registrar.unknownCharacteristicCodes, []);
});

test('the mobility scale is still three levels and still says who decided', () => {
  assert.deepEqual(shipped._meta.mobilityScale.counts, {
    bolted: { 'table-chair': 30, 'tablet-arm': 32 },
    casters: { 'table-chair': 4, 'tablet-arm': 76 },
    freestanding: { 'table-chair': 80, 'tablet-arm': 105 },
    unknown: { unknown: 1 },
  });

  const basis = {};
  let contested = 0;
  for (const room of Object.values(shipped.rooms)) {
    const b = String(room.derived.mobilityBasis);
    basis[b] = (basis[b] ?? 0) + 1;
    if (room.derived.mobilityContested) contested++;
  }
  // 175 rooms need both sources to place them. That number collapsing is what
  // "the merge stopped merging" looks like from the outside.
  assert.deepEqual(basis, { registrar: 152, 'registrar+learningSpaces': 175, null: 1 });
  assert.equal(contested, 18);
});

test('the sources disagree in writing rather than one of them quietly winning', () => {
  assert.equal(shipped._meta.seatingFamilyDisagreements.length, 15);
  assert.deepEqual(shipped._meta.capacityDisagreements.map((d) => d.key), ['MP2017', 'UH0066']);
  for (const d of shipped._meta.capacityDisagreements) assert.equal(d.agree, false);
  assert.deepEqual(shipped._meta.sources.learningSpaces.duplicatePages, [
    { key: 'CM0100', kept: 'campbell-hall-100', dropped: 'campbell-hall-100-0' },
  ]);
  assert.deepEqual(shipped._meta.sources.registrar.buildingNumberDisagreements, [
    { building: 'Enarson Classroom Building', mapLink: '072', panelText: '027', used: '072' },
  ]);
  assert.match(shipped._meta.attribution, /Registrar/);
  assert.match(shipped._meta.attribution, /Learning Spaces Directory/);
  assert.match(shipped._meta.attribution, /linked, not copied/);
});

test('the shipped file describes rooms and never a person', () => {
  const json = read(join('data', 'room-features.json'));
  assert.equal(json.match(/[A-Za-z0-9._+-]+@[A-Za-z0-9.-]+/), null, 'email address');
  assert.equal(json.match(/\b\d{3}[-.]\d{3}[-.]\d{4}\b/), null, 'phone number');
  assert.equal(json.match(/\b[a-z]+\.\d{1,4}\b/i), null, 'OSU name.n identifier');
  assert.equal(json.match(/instructor/i), null);
});

// ------------------------------------------------------------------- fixtures
//
// Trimmed out of data/cache/registrar/autumn-2026-general-assignment-rooms.html
// and data/cache/learningspaces/, whitespace squeezed, nothing else edited. The
// non-breaking spaces are the page's own and several tests above depend on them.

const LEGEND = `<div class="panel-heading">
<h3 class="panel-title">
<a data-toggle="collapse" role="button" href="#collapse-639240661273106842" class="collapsed" aria-expanded="false" aria-controls="collapse-639240661273106842">
Room Characteristics List </a>
</h3>
</div>
<div id="collapse-639240661273106842" class="panel-collapse collapse">
<div class="panel-body">
<ul>
<li>30 - Moveable Tablet Arm Chairs</li>
<li>31 - Stationary Tablet Arm Chairs</li>
<li>32 - Moveable Tables/Chairs</li>
<li>33 - Stationary Tables/Chairs</li>
<li>37 - Sloped/Tiered Floors</li>
<li>39 - Windows</li>
<li>40 - No Windows</li>
<li>41 - Black Out Shade</li>
<li>42 - Variable Intensity Lighting</li>
<li>43 - Chalkboards</li>
<li>44 - Whiteboards</li>
<li>53 - Computer Lab</li>
<li>54 - Innovative Space</li>
</ul>
</div>
</div>`;

const ENARSON = `<div class="panel-heading">
<h3 class="panel-title">
<a data-toggle="collapse" role="button" href="#collapse-639240661273125886" class="collapsed" aria-expanded="false" aria-controls="collapse-639240661273125886">
Enarson Classroom Building </a>
</h3>
</div>
<div id="collapse-639240661273125886" class="panel-collapse collapse">
<div class="panel-body">
<p><strong>Building: <a rel="noopener" href="https://www.osu.edu/map/building/072" target="_blank" title="opens new browser tab">Enarson Classroom Building</a></strong> </p>
<p>Building Number: 027</p>
<p> </p>
<p><a href="/staff-resources/class-catalog-and-space/general-assignment-rooms/ec0014/" title="EC0014" class="btn btn-primary">Facility ID: EC0014 </a></p>
<p>Capacity: 30</p>
<p>Room Characteristics: </p>
<ul>
<li>32 - Moveable Tables/Chairs</li>
<li>40 - No Windows</li>
<li>42 - Variable Intensity Lighting</li>
<li>44 - Whiteboards</li>
<li>54 - Innovative Space</li>
</ul>
<p> </p>
<p><a href="/staff-resources/class-catalog-and-space/general-assignment-rooms/ec0015/" title="EC0015" class="btn btn-primary">Facility ID: EC0015</a></p>
<p>Capacity: 26</p>
<p>Room Characteristics:</p>
<ul>
<li>30 - Moveable Tablet Arm Chairs</li>
<li>40 - No Windows</li>
<li>42 - Variable Intensity Lighting</li>
<li>44 - Whiteboards</li>
</ul>
</div>
</div>`;

const AG_ADMIN = `<div class="panel-heading">
<h3 class="panel-title">
<a data-toggle="collapse" role="button" href="#collapse-639240661273108088" class="collapsed" aria-expanded="false" aria-controls="collapse-639240661273108088">
Agricultural Administration </a>
</h3>
</div>
<div id="collapse-639240661273108088" class="panel-collapse collapse">
<div class="panel-body">
<p><strong>Building: <a rel="noopener" href="https://www.osu.edu/map/building/003" target="_blank" title="opens new browser tab">Agricultural Administration</a></strong></p>
<p>Building Number: 003</p>
<p> </p>
<p><a href="/staff-resources/class-catalog-and-space/general-assignment-rooms/aa0246/" title="AA0246" class="btn btn-primary">Facility ID: AA0246</a></p>
<p>Capacity: 49</p>
<p>Room Characteristics:</p>
<ul>
<li>30 - Moveable Tablet Arm Chairs</li>
<li>39 - Windows</li>
<li>41 - Black Out Shade</li>
<li>44 - Whiteboards</li>
</ul>
<p> </p>
<p><a href="/staff-resources/class-catalog-and-space/general-assignment-rooms/aa0247/" title="AA0247" class="btn btn-primary">Facility ID: AA0247</a></p>
<p>Capacity: 30</p>
<p>Room Characteristics:  32, 39, 41, 44</p>
<ul>
<li>32 - Moveable Tables/Chairs</li>
<li>39 - Windows</li>
<li>41 - Black Out Shade</li>
<li>44 - Whiteboards</li>
</ul>
</div>
</div>`;

const LS_INDEX = `<div class="bux-accordion" data-allow-multiple>
bux-accordion__heading">
<button id="bux-accordion__trigger--80750235" type="button" class="bux-accordion__trigger" aria-controls="bux-accordion__panel--80750235" aria-expanded="false">
<span class="bux-accordion__icon" aria-hidden="true"></span>
<span class="bux-accordion__title">
Enarson Classroom Building (38<span class="visually-hidden"> results</span>)
</span>
</button>
</h2>
<div id="bux-accordion__panel--80750235" class="bux-accordion__panel" role="region" aria-labelledby="bux-accordion__trigger--80750235" hidden>
<div class="bux-grid bux-mar-tb-sp-24">
<div class="bux-grid__cell bux-grid__cell--12 bux-grid__cell--4@lg bux-mar-bottom-sp-32 classroom">
<div class="bux-card bux-card--linked-headline"
role="group"
aria-roledescription="Card"
aria-label="Enarson Classroom Building 322"
>
<img
class="bux-image"
src="https://rooms.app.it.osu.edu/072-03-0322-front.jpg"
alt="A front-view image of Enarson Classroom Building 322"
height=""
width=""
/>
<div class="bux-card__content">
<h3 class="bux-heading bux-card__heading">
<a class="bux-card__link bux-card__heading--link"
href="https://learningspaces.osu.edu/classroom/enarson-classroom-building-322"
rel="noopener"
>
<span>Enarson Classroom Building 322</span>
<span class="bux-card__heading-icon" aria-hidden="true"></span>
</a>
</h3>
</div>
</div>
</div>
</div>
</div>
bux-accordion__heading">
<button id="bux-accordion__trigger--1786151556" type="button" class="bux-accordion__trigger" aria-controls="bux-accordion__panel--1786151556" aria-expanded="false">
<span class="bux-accordion__icon" aria-hidden="true"></span>
<span class="bux-accordion__title">
Campbell Hall (8<span class="visually-hidden"> results</span>)
</span>
</button>
</h2>
<div id="bux-accordion__panel--1786151556" class="bux-accordion__panel" role="region" aria-labelledby="bux-accordion__trigger--1786151556" hidden>
<div class="bux-grid bux-mar-tb-sp-24">
<div class="bux-grid__cell bux-grid__cell--12 bux-grid__cell--4@lg bux-mar-bottom-sp-32 classroom">
<div class="bux-card bux-card--linked-headline"
role="group"
aria-roledescription="Card"
aria-label="Campbell Hall 100"
>
<img
class="bux-image"
src="https://rooms.app.it.osu.edu/018-01-0100-front.jpg"
alt="A front-view image of Campbell Hall 100"
height=""
width=""
/>
<div class="bux-card__content">
<h3 class="bux-heading bux-card__heading">
<a class="bux-card__link bux-card__heading--link"
href="https://learningspaces.osu.edu/classroom/campbell-hall-100"
rel="noopener"
>
<span>Campbell Hall 100</span>
<span class="bux-card__heading-icon" aria-hidden="true"></span>
</a>
</h3>
</div>
</div>
</div>
<div class="bux-grid__cell bux-grid__cell--12 bux-grid__cell--4@lg bux-mar-bottom-sp-32 classroom">
<div class="bux-card bux-card--linked-headline"
role="group"
aria-roledescription="Card"
aria-label="Campbell Hall 100"
>
<div class="bux-card__content">
<h3 class="bux-heading bux-card__heading">
<a class="bux-card__link bux-card__heading--link"
href="https://learningspaces.osu.edu/classroom/campbell-hall-100-0"
rel="noopener"
>
<span>Campbell Hall 100</span>
<span class="bux-card__heading-icon" aria-hidden="true"></span>
</a>
</h3>
</div>
</div>
</div>
<div class="bux-grid__cell bux-grid__cell--12 bux-grid__cell--4@lg bux-mar-bottom-sp-32 classroom">
<div class="bux-card bux-card--linked-headline"
role="group"
aria-roledescription="Card"
aria-label="Campbell Hall 193"
>
<div class="bux-card__content">
<h3 class="bux-heading bux-card__heading">
<a class="bux-card__link bux-card__heading--link"
href="https://learningspaces.osu.edu/classroom/campbell-hall-193"
rel="noopener"
>
<span>Campbell Hall 193</span>
<span class="bux-card__heading-icon" aria-hidden="true"></span>
</a>
</h3>
</div>
</div>
</div>
</div>
</div>`;

const CLASSROOM = `<h1 class="page-title"><span>Enarson Classroom Building 322</span>
</h1>
</div>
<div id="block-wcm-bux-content">
<article class="node node--type--classroom node--view-mode--full">
<div class="node__content">
<p class="tagline">Classroom</p>
<div>
<div class="field field--name-field-classroom-campus field--type-entity-reference field--label-inline">
<div class="field__label field__label--inline">Campus:
</div>
<div class="field__item">Columbus</div>
</div>
<div class="field field--name-field-classroom-location field--type-string field--label-inline">
<div class="field__label field__label--inline">Location:
</div>
<div class="field__item"> <p class="simple-gmap-link"><a href="https://www.google.com/maps?q=2009+Millikin+Rd%2C+Columbus%2C+OH+43210-1243&amp;hl=en&amp;t=m&amp;z=14" target="_blank">2009 Millikin Rd, Columbus, OH 43210-1243</a></p>
</div>
</div>
<div class="field field--name-field-classroom-support-group field--type-entity-reference field--label-inline">
<div class="field__label field__label--inline">Support Group:
</div>
<div class='field__items'>
<div class="field__item"><a href="/otdi-classroom-services" hreflang="en">OTDI Classroom Services</a></div>
</div>
</div>
</div>
<div class="bux-mar-tb-sp-32">
<h2>View the Space</h2>
<div class="bux-grid">
<div class="bux-grid__cell bux-grid__cell--12 bux-grid__cell--6@lg space-image">
<a href="https://rooms.app.it.osu.edu/072-03-0322-front.jpg" target="_blank">
<img class="bux-image" src="https://rooms.app.it.osu.edu/072-03-0322-front.jpg" alt="A front-view image of Enarson Classroom Building 322" />
</a>
</div>
<div class="bux-grid__cell bux-grid__cell--12 bux-grid__cell--6@lg space-image">
<a href="https://rooms.app.it.osu.edu/072-03-0322-rear.jpg" target="_blank">
<img class="bux-image" src="https://rooms.app.it.osu.edu/072-03-0322-rear.jpg" alt="A rear-view image of Enarson Classroom Building 322" />
</a>
</div>
</div>
<div class="field field--name-field-classroom-360-tour field--type-link field--label-above">
<div class="field__label">360 Tour </div>
<div class="field__item"><a href="/360viewer/node/127/25cc4f10-42f5-4630-baa1-07d703af95b3" target="_blank">360 Tour</a>
</div>
</div>
</div>
<div class="bux-grid bux-mar-tb-sp-32">
<div class="bux-grid__cell bux-grid__cell--12 bux-grid__cell--8@lg bux-mar-bottom-sp-24">
<h2>Affordances</h2>
<h3>Best Affordance: In-Person Lecture </h3>
<p>Ideal for lecture format classes held in person. <span>Room features technology for interactive lecture content.</span></p>
</div>
<div class="bux-grid__cell bux-grid__cell--12 bux-grid__cell--4@lg">
<div class="bux-panel">
<h2>Space Attributes</h2>
<div class="field field--name-field-classroom-number-of-seats field--type-integer field--label-inline">
<div class="field__label field__label--inline">Number of Seats:
</div>
<div class="field__item">34</div>
</div>
<div class="field field--name-field-classroom-furniture-type field--type-string field--label-inline">
<div class="field__label field__label--inline">Furniture Type:
</div>
<div class="field__item">Fixed Tablet Arms</div>
</div>
<div class="field field--name-field-classroom-darkening-qual field--type-string field--label-inline">
<div class="field__label field__label--inline">Darkening Quality:
</div>
<div class="field__item">High</div>
</div>
<div class="field field--name-field-classroom-air-conditioning field--type-boolean field--label-inline">
<div class="field__label field__label--inline">Air Conditioning:
</div>
<div class="field__item">Yes</div>
</div>
<div class="field field--name-field-classroom-carpeted field--type-boolean field--label-inline">
<div class="field__label field__label--inline">Carpeted:
</div>
<div class="field__item">No</div>
</div>
<div class="field field--name-field-classroom-ht-adj-lectern field--type-boolean field--label-inline">
<div class="field__label field__label--inline">Height Adjustable Lectern:
</div>
<div class="field__item">No</div>
</div>
</div>
</div>
</div>
<h2>Classroom Features</h2>
<p>The following classroom features and the space attributes above enable the affordances above.</p>
<h3>Standard Audio and Video</h3>
<div class="bux-grid bux-mar-bottom-sp-32 bux-mar-top-sp-24">
<div class="bux-grid__cell bux-grid__cell--12 bux-grid__cell--4@lg icon-flex"> <span class="icon-feature" aria-hidden="true"><img src="/themes/wcm-osu/wcm_bux/images/site-specific/spaces/icon-mic-2.svg" alt="" /></span>
<div class="field field--name-field-classroom-microphone-type field--type-entity-reference field--label-above">
<div class="field__label">Microphone Type </div>
<div class='field__items'>
<div class="field__item"><a href="/wired-mic-input" hreflang="en">Wired Mic Input</a></div>
</div>
</div>
</div>
<div class="bux-grid__cell bux-grid__cell--12 bux-grid__cell--4@lg icon-flex"> <span class="icon-feature" aria-hidden="true"><img src="/themes/wcm-osu/wcm_bux/images/site-specific/spaces/icon-webcam-2.svg" alt="" /></span>
<div class="field field--name-field-classroom-in-room-camera field--type-entity-reference field--label-above">
<div class="field__label">In-Room Camera </div>
<div class='field__items'>
<div class="field__item"><a href="/webcam-controllable" hreflang="en">Webcam (Controllable)</a></div>
</div>
</div>
</div>
<div class="bux-grid__cell bux-grid__cell--12 bux-grid__cell--4@lg icon-flex"> <span class="icon-feature" aria-hidden="true"><img src="/themes/wcm-osu/wcm_bux/images/site-specific/spaces/icon-input-2.svg" alt="" /></span>
<div class="field field--name-field-classroom-display-inputs field--type-entity-reference field--label-above">
<div class="field__label">Display Inputs </div>
<div class='field__items'>
<div class="field__item"><a href="/hdmi-input" hreflang="en">HDMI input</a><span class='comma'>,</span></div>
<div class="field__item"><a href="/vga-input" hreflang="en">VGA input</a></div>
</div>
</div>
</div>
</div>
<h3>Additional Audio Video</h3>
<div class="bux-grid bux-mar-tb-sp-24">
<div class="bux-grid__cell bux-grid__cell--12 bux-grid__cell--4@lg bux-mar-bottom-sp-32 additional-av">
<div class="bux-card bux-card--linked-headline"
role="group"
aria-roledescription="Card"
aria-label="Classroom Computer"
>
<img
class="bux-image"
src="/sites/default/files/images/pc.jpeg"
alt=""
height=""
width=""
/>
<div class="bux-card__content">
<h4 class="bux-heading bux-card__heading">
<a class="bux-card__link bux-card__heading--link"
href="https://learningspaces.osu.edu/classroom-computer"
rel="noopener"
>
<span>Classroom Computer</span>
<span class="bux-card__heading-icon" aria-hidden="true"></span>
</a>
</h4>
</div>
</div>
</div>
<div class="bux-grid__cell bux-grid__cell--12 bux-grid__cell--4@lg bux-mar-bottom-sp-32 additional-av">
<div class="bux-card bux-card--linked-headline"
role="group"
aria-roledescription="Card"
aria-label="Document Camera"
>
<img
class="bux-image"
src="/sites/default/files/images/doc_cam.jpg"
alt=""
height=""
width=""
/>
<div class="bux-card__content">
<h4 class="bux-heading bux-card__heading">
<a class="bux-card__link bux-card__heading--link"
href="https://learningspaces.osu.edu/document-camera"
rel="noopener"
>
<span>Document Camera</span>
<span class="bux-card__heading-icon" aria-hidden="true"></span>
</a>
</h4>
</div>
</div>
</div>
<div class="bux-grid__cell bux-grid__cell--12 bux-grid__cell--4@lg bux-mar-bottom-sp-32 additional-av">
<div class="bux-card bux-card--linked-headline"
role="group"
aria-roledescription="Card"
aria-label="Projector"
>
<img
class="bux-image"
src="/sites/default/files/images/projector.jpg"
alt=""
height=""
width=""
/>
<div class="bux-card__content">
<h4 class="bux-heading bux-card__heading">
<a class="bux-card__link bux-card__heading--link"
href="https://learningspaces.osu.edu/projector"
rel="noopener"
>
<span>Projector</span>
<span class="bux-card__heading-icon" aria-hidden="true"></span>
</a>
</h4>
</div>
</div>
</div>
</div>
</div>
</article>`;
