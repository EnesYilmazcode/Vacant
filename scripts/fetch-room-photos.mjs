#!/usr/bin/env node
// One photograph per classroom, small enough to put on a card.
//
//   node scripts/fetch-room-photos.mjs            fetch what is missing
//   node scripts/fetch-room-photos.mjs --force    refetch everything
//   node scripts/fetch-room-photos.mjs --dry-run  say what it would do
//   node scripts/fetch-room-photos.mjs --limit 5  stop after five, for a look
//
// WHERE THEY COME FROM. OSU publishes room photographs in two places and only
// one of them is addressable. The Registrar's per-room pages (for example
// /general-assignment-rooms/cz0160/) serve them from /media/<opaque-hash>/, so
// the URL cannot be constructed from a room id and every one of the 327 pages
// would have to be scraped to learn it -- and those copies carry a
// "REGISTRAR - 2022" watermark burnt into the middle of the frame. OTDI's
// Learning Spaces directory serves the same rooms from rooms.app.it.osu.edu at
// <buildingNumber>-<floor>-<room>-<view>.jpg, unwatermarked, with
// `access-control-allow-origin: *`. data/room-features.json already carries
// those URLs from scripts/fetch-room-features.mjs, so this script does not
// crawl anything to find them: it reads that file and fetches the images.
//
// WHY THEY ARE RESIZED AND COMMITTED. The originals are 1620x1080 JPEGs of
// 218 KB to 1.34 MB, and the whole app is 108 KB over the wire. Hotlinking them
// would put a megabyte on the one screen a student opens in a stairwell on one
// bar, would stop working the moment OSU moves a file, and would tell OSU's
// server which room each reader is looking at -- which the privacy page
// promises the app does not do with anything else. Resized to CARD_W and
// re-encoded they are about 40 KB each, they are first-party, and the service
// worker can keep the ones you have actually seen.
//
// WHY CHROME DOES THE RESIZING. This repo has no dependencies and is not going
// to have any, so there is no image library here. Chrome is already required by
// scripts/shoot.mjs, and it can decode a JPEG, draw it smaller and encode WebP
// without one. It also does the fetching, wearing the same User-Agent
// scripts/lib/fetch.mjs promises, because the politeness is about the server
// and not about which client made the request.
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Devtools, launch, sleep } from './lib/browser.mjs';
import { config } from './lib/fetch.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data', 'photos');

// The card is 22rem wide, so 352 CSS px, and a dpr-3 phone wants 1056 device
// px of it. 900 is 0.85 of that, which is invisible on a photograph sitting
// behind a scrim and two lines of text, and it is 25% smaller than 1080.
// Measured over three rooms at q0.62: 1080 wide costs 58 to 89 KB, 900 costs
// 48 to 72, 720 costs 35 to 53. 900 is the last width that still looks like a
// photograph of a room rather than a thumbnail of one.
const CARD_W = 900;
const QUALITY = 0.62;

// A photograph that comes back this small is not a photograph. The smallest
// real one measured is 21 KB at 560 wide; anything under 4 KB at 900 wide is a
// placeholder, an error page rendered as an image, or a blank frame.
const MIN_BYTES = 4000;

const args = new Set(process.argv.slice(2));
const DRY = args.has('--dry-run');
const FORCE = args.has('--force');
const LIMIT = Number(
  (process.argv.find((a) => a.startsWith('--limit=')) ?? '').split('=')[1] ??
    (process.argv[process.argv.indexOf('--limit') + 1] || 0),
) || Infinity;

const read = async (rel) => JSON.parse(await fsp.readFile(path.join(ROOT, rel), 'utf8'));

// What the browser could not find out. Node is not bound by CORS, so it can
// read the status off an error page the page itself is not allowed to see.
async function statusOf(url) {
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      headers: { 'user-agent': config.USER_AGENT },
      signal: AbortSignal.timeout(15000),
    });
    return res.status;
  } catch {
    return null;
  }
}

// Temp then rename, because a truncate-in-place that runs out of disk leaves a
// half-written file where a whole one used to be.
async function writeAtomic(file, bytes) {
  const tmp = `${file}.tmp`;
  await fsp.writeFile(tmp, bytes);
  await fsp.rename(tmp, file);
}

async function run() {
  const features = (await read('data/room-features.json')).rooms;
  const current = await read('data/current.json');
  const index = (await read(current.rooms)).rooms;

  // Only rooms the app can actually rank, and only the front view: the rear
  // shot is the same room from the other end and doubles the bytes to say so.
  const wanted = [];
  const noPhoto = [];
  for (const id of Object.keys(index).sort()) {
    const url = features[id]?.learningSpaces?.photos?.front;
    if (typeof url === 'string') wanted.push({ id, url });
    else noPhoto.push(id);
  }

  console.log(`index      ${Object.keys(index).length} rooms in ${current.rooms}`);
  console.log(`addressable ${wanted.length} have a Learning Spaces front photo`);
  console.log(`no photo    ${noPhoto.length} do not, and get the plain card`);

  await fsp.mkdir(OUT, { recursive: true });
  const have = new Set(
    (await fsp.readdir(OUT).catch(() => [])).filter((f) => f.endsWith('.webp')).map((f) => f.slice(0, -5)),
  );
  const todo = (FORCE ? wanted : wanted.filter((w) => !have.has(w.id))).slice(0, LIMIT);
  console.log(`on disk    ${have.size}, to fetch ${todo.length}${DRY ? ' (dry run)' : ''}\n`);
  if (!todo.length) {
    await writeManifest(wanted, noPhoto, current);
    return [];
  }
  if (DRY) {
    for (const w of todo.slice(0, 10)) console.log(`  would fetch ${w.id}  ${w.url}`);
    if (todo.length > 10) console.log(`  ... and ${todo.length - 10} more`);
    return [];
  }

  const chrome = await launch();
  const problems = [];
  try {
    const { webSocketDebuggerUrl } = await (
      await fetch(`http://127.0.0.1:${chrome.port}/json/version`)
    ).json();
    const dt = await Devtools.open(webSocketDebuggerUrl);
    const { targetId } = await dt.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await dt.send('Target.attachToTarget', { targetId, flatten: true });
    await dt.send('Runtime.enable', {}, sessionId);
    // The same string scripts/lib/fetch.mjs sends. The promise on it is about
    // the volume this project puts on OSU's servers, and an image is a request.
    await dt.send('Emulation.setUserAgentOverride', { userAgent: config.USER_AGENT }, sessionId);

    const evaluate = async (expression) => {
      const r = await dt.send(
        'Runtime.evaluate',
        { expression, returnByValue: true, awaitPromise: true },
        sessionId,
      );
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
      return r.result.value;
    };

    let done = 0;
    let bytes = 0;
    const gone = [];
    for (const { id, url } of todo) {
      const got = await evaluate(`(async () => {
        try {
          const res = await fetch(${JSON.stringify(url)}, { mode: 'cors', cache: 'no-store' });
          if (!res.ok) return { error: 'HTTP ' + res.status };
          const blob = await res.blob();
          const bmp = await createImageBitmap(blob);
          const w = Math.min(${CARD_W}, bmp.width);
          const h = Math.round((bmp.height / bmp.width) * w);
          const c = new OffscreenCanvas(w, h);
          c.getContext('2d').drawImage(bmp, 0, 0, w, h);
          const out = await c.convertToBlob({ type: 'image/webp', quality: ${QUALITY} });
          const buf = new Uint8Array(await out.arrayBuffer());
          let s = '';
          for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
          return { w, h, source: blob.size, b64: btoa(s) };
        } catch (e) {
          return { error: String(e && e.message ? e.message : e) };
        }
      })()`);

      if (got.error) {
        // A browser fetch that fails cannot say why: a 404 from this host comes
        // back as an HTML error page with no CORS header on it, so the page
        // sees "Failed to fetch" and cannot tell a dead link from a dead
        // network. Node has no such rule, so it asks again and reports the
        // truth. UH0037 is the known one: Learning Spaces links a file that
        // 404s, which is OSU's gap and not this script's failure.
        const why = await statusOf(url);
        const dead = why === 404;
        (dead ? gone : problems).push(`${id}: ${why === null ? got.error : `HTTP ${why}`} ${url}`);
        console.log(`${dead ? 'gone' : 'BAD '} ${id}  ${why === null ? got.error : `HTTP ${why}`}`);
        continue;
      }
      const buf = Buffer.from(got.b64, 'base64');
      if (buf.length < MIN_BYTES) {
        problems.push(`${id}: ${buf.length} bytes is not a photograph`);
        console.log(`BAD  ${id}  ${buf.length} bytes`);
        continue;
      }
      await writeAtomic(path.join(OUT, `${id}.webp`), buf);
      done += 1;
      bytes += buf.length;
      if (done % 25 === 0 || done === todo.length) {
        console.log(
          `ok   ${done}/${todo.length}  ${(bytes / 1024 / 1024).toFixed(1)} MB so far  ` +
            `${(bytes / done / 1024).toFixed(0)} KB each`,
        );
      }
      // The originals are up to 1.3 MB and this is somebody else's server.
      await sleep(120);
    }
    console.log(`\nwrote ${done} photos, ${(bytes / 1024 / 1024).toFixed(1)} MB`);
    if (gone.length) {
      console.log(`\n${gone.length} upstream link(s) 404, which is OSU's gap and not an error here:`);
      for (const g of gone) console.log(`  ${g}`);
    }
  } finally {
    await sleep(50);
  }

  await writeManifest(wanted, noPhoto, current);
  if (problems.length) {
    console.log(`\n${problems.length} problem(s):`);
    for (const p of problems.slice(0, 20)) console.log(`  ${p}`);
  }
  return problems;
}

// What the APP reads, and it is only a list of ids. The card needs to know
// whether a photograph exists before it renders, and a 404 per photoless room
// is both a wasted request and a flash of empty frame. Written from what is on
// disk rather than from what was wanted, so a failed fetch cannot leave the app
// pointing at a file that is not there.
async function writeManifest(wanted, noPhoto, current) {
  const onDisk = (await fsp.readdir(OUT).catch(() => []))
    .filter((f) => f.endsWith('.webp'))
    .map((f) => f.slice(0, -5))
    .sort();
  const sizes = await Promise.all(
    onDisk.map((id) => fsp.stat(path.join(OUT, `${id}.webp`)).then((s) => s.size)),
  );
  const total = sizes.reduce((a, b) => a + b, 0);
  const manifest = {
    _meta: {
      note:
        'Room photographs, resized from OTDI Classroom Services (rooms.app.it.osu.edu) ' +
        'by scripts/fetch-room-photos.mjs. The app reads `rooms` to decide whether a ' +
        'card has a photograph; the files are at data/photos/<id>.webp.',
      source: 'https://learningspaces.osu.edu/classrooms',
      credit: 'Photographs (c) The Ohio State University, OTDI Classroom Services.',
      generated: new Date().toISOString().slice(0, 10),
      term: current.term,
      width: CARD_W,
      quality: QUALITY,
      count: onDisk.length,
      bytes: total,
      addressable: wanted.length,
      withoutPhoto: noPhoto.length,
    },
    rooms: onDisk,
  };
  const file = path.join(ROOT, 'data', 'photos.json');
  if (!DRY) await writeAtomic(file, `${JSON.stringify(manifest, null, 1)}\n`);
  console.log(
    `\nmanifest   ${onDisk.length} rooms, ${(total / 1024 / 1024).toFixed(1)} MB, ` +
      `${onDisk.length ? (total / onDisk.length / 1024).toFixed(0) : 0} KB each`,
  );
}

const problems = await run();
process.exit(problems.length ? 1 : 0);
