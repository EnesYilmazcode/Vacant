#!/usr/bin/env node
// The icon set, drawn from the wordmark. The mark is the period in "Vacant." so
// the icon is that period: one accent dot on the app's own ground. Nothing else
// survives at 60 px on a home screen next to native apps.
//
// PNG bytes are written by hand through node:zlib. This repo has no runtime and
// no dev dependencies and an icon pipeline is not the thing to break that for.
//
// Run: node scripts/make-icons.mjs
// The output is committed. scripts/test/manifest.test.mjs regenerates every file
// in memory and fails if the bytes on disk drift from the generator.

import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export const GROUND = [0x0b, 0x0d, 0x10];
export const ACCENT = [0xff, 0x4d, 0x3d];

// Android's maskable spec guarantees only the middle 80% by width, and it may
// crop that to a circle. A 0.34 dot clears it with room to spare; the 0.44 dot
// of the plain icon would survive the circle but not a squircle's corners.
const PLAIN_DOT = 0.44;
const MASKABLE_DOT = 0.34;

// A 16 px favicon is 256 pixels total. The dot has to be fat or it reads as a
// smudge in a tab strip.
const FAVICON_DOT = 0.5;

// The spike pages get a ring, not the app's filled dot.
//
// #5 is run by adding spikes/geo.html ITSELF to the home screen, because the
// app icon opens /Vacant/ in a window with no address bar and nothing in the
// app links to a spike page. So the phone ends up carrying two Vacant icons
// side by side, and two identical ones would be a coin toss on every launch of
// a spike whose whole point is that the launch is the measurement. Without any
// icon at all iOS uses a screenshot of the page, which at 60 px is a grey
// smear. Same ground, same accent, hollow centre: the same family, told apart
// at a glance.
const SPIKE_OUTER = 0.62;
const SPIKE_INNER = 0.36;

const SAMPLES = 4;

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

// Coverage of one pixel by a centred disc, by supersampling. An analytic edge
// would be sharper but this is drawn once and committed.
function coverage(x, y, size, radius) {
  const c = size / 2;
  let hit = 0;
  for (let sy = 0; sy < SAMPLES; sy++) {
    for (let sx = 0; sx < SAMPLES; sx++) {
      const px = x + (sx + 0.5) / SAMPLES - c;
      const py = y + (sy + 0.5) / SAMPLES - c;
      if (px * px + py * py <= radius * radius) hit++;
    }
  }
  return hit / (SAMPLES * SAMPLES);
}

// `alpha` false writes colour type 2. iOS composites any alpha onto black and
// applies its own mask, so an apple-touch-icon with a channel it never uses is
// bytes the phone downloads to throw away.
//
// `holeFraction` above zero punches the middle back out, which is the spike
// ring. It is the same disc coverage twice and a subtraction rather than a
// second drawing routine, so the antialiased edge is identical on both sides.
export function dotPng(size, dotFraction, alpha = false, holeFraction = 0) {
  const radius = (size * dotFraction) / 2;
  const hole = (size * holeFraction) / 2;
  const bpp = alpha ? 4 : 3;
  const stride = size * bpp + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) {
    const row = y * stride;
    raw[row] = 0;
    for (let x = 0; x < size; x++) {
      const a = hole > 0
        ? Math.max(0, coverage(x, y, size, radius) - coverage(x, y, size, hole))
        : coverage(x, y, size, radius);
      const o = row + 1 + x * bpp;
      for (let ch = 0; ch < 3; ch++) {
        raw[o + ch] = Math.round(GROUND[ch] + (ACCENT[ch] - GROUND[ch]) * a);
      }
      if (alpha) raw[o + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = alpha ? 6 : 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// PNG payloads inside an ICO have to be 32 bpp, so the favicon carries an alpha
// channel it never varies.
export function ico(sizes) {
  const pngs = sizes.map((s) => dotPng(s, FAVICON_DOT, true));
  const head = Buffer.alloc(6 + 16 * sizes.length);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(sizes.length, 4);
  let offset = head.length;
  sizes.forEach((s, i) => {
    const e = 6 + 16 * i;
    head[e] = s === 256 ? 0 : s;
    head[e + 1] = s === 256 ? 0 : s;
    head.writeUInt16LE(1, e + 4);
    head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(pngs[i].length, e + 8);
    head.writeUInt32LE(offset, e + 12);
    offset += pngs[i].length;
  });
  return Buffer.concat([head, ...pngs]);
}

export function iconSet() {
  return {
    'icons/icon-192.png': dotPng(192, PLAIN_DOT),
    'icons/icon-512.png': dotPng(512, PLAIN_DOT),
    'icons/icon-192-maskable.png': dotPng(192, MASKABLE_DOT),
    'icons/icon-512-maskable.png': dotPng(512, MASKABLE_DOT),
    'apple-touch-icon.png': dotPng(180, PLAIN_DOT),
    'spikes/apple-touch-icon.png': dotPng(180, SPIKE_OUTER, false, SPIKE_INNER),
    'favicon.ico': ico([16, 32, 48]),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  for (const [rel, bytes] of Object.entries(iconSet())) {
    const file = join(ROOT, rel);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, bytes);
    console.log(`${rel}  ${bytes.length} bytes  sha256 ${createHash('sha256').update(bytes).digest('hex').slice(0, 12)}`);
  }
}
