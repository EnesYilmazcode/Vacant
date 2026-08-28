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
