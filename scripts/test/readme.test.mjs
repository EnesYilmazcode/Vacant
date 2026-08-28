// The README against its own screenshots.
//
// A picture cannot be read by a test and its alt text can drift off it without
// anyone noticing. That is not hypothetical here: the README shipped a room
// screen whose alt text printed a time the app does not show, and a screen
// reader would have read the wrong number out as fact.
//
// scripts/shoot.mjs writes docs/media/frames.json beside the images: what each
// screen actually said, in words, at the minute it was photographed. These
// checks hold the prose to it. Nothing here needs a browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MEDIA = join(ROOT, 'docs', 'media');

const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
const manifest = JSON.parse(readFileSync(join(MEDIA, 'frames.json'), 'utf8'));

// Every ![alt](path) in the README, in order.
const images = [...readme.matchAll(/!\[([^\]]*)\]\(([^)]+)\)/g)].map((m) => ({
  alt: m[1],
  src: m[2],
}));
const shots = images.filter((i) => i.src.startsWith('docs/media/'));
const frameOf = (src) => src.replace('docs/media/', '').replace('.webp', '');

// Numbers the app puts on a screen. A word in alt text is a description and can
// be phrased any way; a number is a claim and has to be one the screen makes.
const MEASURES = [
  /\b\d{1,2}:\d{2}\s?[ap]m\b/gi, // a clock time
  /\b\d+h\d{2}\b/gi, // a duration, 8h55
  /\b\d+\s?min\b/gi, // a walk
  /\b\d+\s?m\b/gi, // metres
  /\b\d+\s?seats\b/gi, // seats
];
const squash = (s) => s.toLowerCase().replace(/\s+/g, '');
const measures = (s) => MEASURES.flatMap((re) => [...s.matchAll(re)].map((m) => m[0]));

// The first clock time in a string, which is the only part of "till 6:50pm ·
// 42 seats" and "Free till 6:50pm" that has to match.
const clockTime = (s) => (String(s).match(/\d{1,2}:\d{2}[ap]m/) || [null])[0];

test('every screenshot the README shows is committed', () => {
  const onDisk = new Set(readdirSync(MEDIA).filter((f) => f.endsWith('.webp')));
  assert.ok(shots.length >= 5, `the README shows ${shots.length} screenshots`);
  for (const shot of shots) {
    assert.ok(onDisk.has(`${frameOf(shot.src)}.webp`), `${shot.src} is referenced but not committed`);
  }
});

test('every committed screenshot is shown, so none of them rots unseen', () => {
  const shown = new Set(shots.map((s) => frameOf(s.src)));
  for (const file of readdirSync(MEDIA).filter((f) => f.endsWith('.webp'))) {
    const name = file.replace('.webp', '');
    assert.ok(shown.has(name), `docs/media/${file} is committed but nothing shows it`);
  }
});

test('every screenshot has alt text, because the page is the product', () => {
  for (const shot of shots) {
    assert.ok(shot.alt.trim().length > 20, `${shot.src} has no useful alt text`);
  }
});

test('the manifest covers every screenshot', () => {
  for (const shot of shots) {
    const frame = manifest.frames[frameOf(shot.src)];
    assert.ok(frame, `docs/media/frames.json has nothing for ${shot.src}`);
    assert.ok(frame.text.length > 20, `${shot.src} recorded no screen text`);
  }
});

// The one that would have caught it. Every number in an alt text has to be a
// number that screen printed.
test('no alt text invents a number the screen does not show', () => {
  for (const shot of shots) {
    const said = squash(manifest.frames[frameOf(shot.src)].text);
    for (const measure of measures(shot.alt)) {
      assert.ok(
        said.includes(squash(measure)),
        `${shot.src} alt text says "${measure}" and the screen does not`,
      );
    }
  }
});

test('the room screenshots name the room they are of', () => {
  const of = shots.filter((s) => manifest.frames[frameOf(s.src)].of);
  assert.ok(of.length >= 2, 'no screenshot is recorded as being of a room');
  for (const shot of of) {
    const name = manifest.frames[frameOf(shot.src)].of;
    assert.ok(shot.alt.includes(name), `${shot.src} is of ${name} and its alt text does not say so`);
  }
});

// The room screen and the list row are two renderings of one answer. When they
// disagree the README ends up printing both, which is what it did.
test('the photographed room screen agrees with its own list row', () => {
  const claimed = clockTime(manifest.room.claim);
  if (claimed === null) return;
  assert.equal(
    claimed,
    clockTime(manifest.room.row),
    `the room screen says "${manifest.room.claim}" where its row says "${manifest.room.row}"`,
  );
});

// ---------------------------------------------------------------- the counts

// The alt-text checks above hold the README to the pictures. Nothing held it to
// the DATA, and it drifted the moment the room safety filter shipped: the
// Saturday paragraph still said 867 of 871 rooms against an index of 581, and
// the hours paragraph said 245 rooms and 28% against a real 125 and 22%. Every
// figure was measured when it was written and every one of them was wrong by
// the time it was read, which is the failure this repo's own rule exists to
// stop. These recompute from the shipped files, so the next filter change
// breaks the build instead of the sentence.
test('the README counts are the counts in the shipped index', () => {
  const index = JSON.parse(readFileSync(join(ROOT, 'data', 'rooms-1268.json'), 'utf8'));
  const current = JSON.parse(readFileSync(join(ROOT, 'data', 'current.json'), 'utf8'));
  const file = JSON.parse(readFileSync(join(ROOT, 'data', 'buildings-hours.json'), 'utf8'));

  // The app's own selection, not a second copy of the rule.
  const want = current.termName.toLowerCase().replace(/\s+/g, '-');
  const term = Object.entries(file.terms).find(([slug]) => slug.startsWith(want))[1];
  const hoursFor = (code, day) => term.buildings[code]?.hours[day];

  const ids = Object.keys(index.rooms);
  const rooms = ids.length;
  const buildings = new Set(ids.map((id) => index.rooms[id].b)).size;
  const published = Object.keys(term.buildings).length;
  const noHours = ids.filter((id) => hoursFor(index.rooms[id].b, 1) === undefined).length;

  // Saturday is day 6, and it is the case the whole project is an argument about.
  const quiet = ids.filter((id) => !(index.rooms[id].busy ?? []).some((b) => b[0] === 6));
  const sat = (id) => hoursFor(index.rooms[id].b, 6);
  const unknown = quiet.filter((id) => sat(id) === undefined).length;
  const closed = quiet.filter((id) => sat(id) === null).length;
  const open = quiet.length - unknown - closed;

  // Pin the sentences, not the digits. Checking that each number appears
  // somewhere in the file is too weak to bite: swapping "578 of the 581 rooms"
  // back to the pre-filter "867 of the 871 rooms" left both 578 and 581 sitting
  // in neighbouring lines, and the guard passed on a README that had just been
  // made wrong.
  const phrases = [
    `${quiet.length} of the ${rooms} rooms have no Saturday class`,
    `calls all ${quiet.length} of them free on a Saturday`,
    `**${closed}** of those`,
    `**${unknown}** more sit`,
    `**${open}** are in a building that is`,
    `table covers ${published}`,
    `index touches ${buildings}`,
    `${noHours} of the ${rooms} rooms, ${Math.round((noHours / rooms) * 100)}%`,
  ];
  for (const phrase of phrases) {
    assert.ok(
      readme.includes(phrase),
      `the README does not say "${phrase}", which is what the shipped files measure`,
    );
  }
});
