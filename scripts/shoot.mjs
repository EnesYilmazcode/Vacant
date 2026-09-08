#!/usr/bin/env node
// Capture the screenshots in docs/media/, reproducibly.
//
//   node scripts/shoot.mjs            write docs/media/*.webp
//   node scripts/shoot.mjs --check    capture and verify, write nothing
//
// Needs Chrome or Chromium on the machine and nothing else. It finds the
// browser itself -- on Linux a Playwright-downloaded Chromium included, which
// the win32 and darwin branches do not yet search -- serves the repo
// over a local port, drives the real app and refuses to write if a frame came
// out blank, a screen came out empty, or the page logged a console error or
// threw. Point CHROME at the binary if the search misses:
//
//   CHROME="/path/to/chrome" node scripts/shoot.mjs
//
// Three things make the frames the same every run, and all three are
// load-bearing.
//
// The wall clock is pinned, because every row prints "till 3:00pm" off
// Date.now(). The animation clock is pinned with it, because the flyover camera
// runs off performance.now() and the frame timestamp, which Date does not
// reach; scripts/lib/pinned-clock.mjs holds both and says what it cost to learn
// that. The page also gets a forced Eastern timezone.
//
// The location is pinned too, to the Thompson Library steps in the middle of
// the Oval, so the walk times and the ranking are the same on any machine.
//
// If a frame looks wrong, the app is wrong. Nothing here stages anything: the
// data is the committed index and every screen is reached by tapping.

import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Devtools, launch, serve, sleep } from './lib/browser.mjs';
import { pinnedClockSource } from './lib/pinned-clock.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs', 'media');
const PORT = Number(process.env.PORT || 8137);

// Wednesday 2026-09-16, 10:20am Eastern, in the middle of Autumn 2026.
//
// Picked by running the ranking engine over the committed index at nine
// weekday dates and five times of day and reading the answers back. Afternoon
// is duller than it sounds: at 1:10, 2:10 and 3:20 every room in the top six
// ends because the building locks, so every row reads the same way and the app
// looks like it only knows one fact. At 10:20 three of the top six end because
// a class walks in and three because the door locks, which is the distinction
// the whole app is for. 428 rooms clear a two hour ask at this minute.
const WHEN = '2026-09-16T10:20:00-04:00';
const TZ = 'America/New_York';

// Thompson Library steps, the middle of the Oval.
const WHERE = { latitude: 39.99944, longitude: -83.01502, accuracy: 18 };

// iPhone 15 Pro. Headless Chrome ignores --window-size for layout, so the
// viewport has to come from device metrics or the frames are a lie.
const SCREEN = { width: 393, height: 852, dpr: 3 };

// WebP, so that cloning the repo for five screenshots stays cheap. Measured
// on these exact frames at the full 3x capture: PNG 3565 KB, WebP at 100
// 3766 KB, WebP at 95 673 KB, WebP at 92 546 KB. 95 is the last one that is
// indistinguishable from the PNG at 1:1 on the row text, so it is the one.
const QUALITY = 95;

const UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 ' +
  '(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

const CHECK_ONLY = process.argv.includes('--check');

// How far two captures of a still screen may differ, summed over R, G and B out
// of 765. All three numbers behind this are measured at 393x852:
//
//   still, with a photograph on screen      0 to 27
//   the card 60ms into its commit flight    623
//   the sheet 80ms into a snap              743
//
// So 48 sits an order of magnitude above the noise and an order below the
// smallest real movement either of the two animations on this screen produces.
const STILL = 48;

// One defect the frames are allowed to carry out of the door.
//
// It lives in js/app.js, which this script photographs and does not own, and
// refusing to write over it would stop the README being redrawn without moving
// the bug an inch. So it is named here instead, printed on every run, and it
// blocks nothing. Delete the entry with the fix, and the check underneath turns
// back into a gate.
const CARRIED = new Map([
  [
    'facts',
    'the room screen joins its facts with no separator, so they render run ' +
      'together: github.com/EnesYilmazcode/Vacant/issues/59',
  ],
]);


// --------------------------------------------------------------------- page

class Phone {
  constructor(dt, sessionId, origin) {
    this.dt = dt;
    this.s = sessionId;
    this.origin = origin;
    this.errors = [];
  }

  call(method, params) {
    return this.dt.send(method, params, this.s);
  }

  async evaluate(expression) {
    const r = await this.call('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) throw new Error('page: ' + r.exceptionDetails.text);
    return r.result.value;
  }

  async waitFor(expression, label, timeout = 25000) {
    const until = Date.now() + timeout;
    while (Date.now() < until) {
      if (await this.evaluate(`Boolean(${expression})`)) return;
      await sleep(80);
    }
    throw new Error(`timed out waiting for ${label}`);
  }

  // A tap. Touch emulation is on, so the renderer turns these into the same
  // pointer events a finger produces. Input.dispatchTouchEvent is the obvious
  // call and it never returns here: it waits on an ack the headless compositor
  // does not send while the map's animation loop is running.
  async tap(x, y) {
    const at = { x, y, button: 'left', clickCount: 1 };
    await this.call('Input.dispatchMouseEvent', { ...at, type: 'mouseMoved', buttons: 0 });
    await this.call('Input.dispatchMouseEvent', { ...at, type: 'mousePressed', buttons: 1 });
    await sleep(40);
    await this.call('Input.dispatchMouseEvent', { ...at, type: 'mouseReleased', buttons: 0 });
  }

  async tapSelector(selector) {
    const box = await this.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
    if (!box) throw new Error(`nothing matches ${selector}`);
    await this.tap(box.x, box.y);
  }

  // Drag the sheet handle by hand rather than setting its height, because the
  // snap, the velocity rule and the dismiss threshold are the thing being
  // photographed. Slow steps keep the release velocity near zero so the sheet
  // snaps on position, which is the deterministic branch.
  async dragSheet(dy) {
    const box = await this.evaluate(`(() => {
      const r = document.getElementById('handle').getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
    const at = (y, type, buttons) => ({ x: box.x, y, type, buttons, button: 'left', clickCount: 1 });
    await this.call('Input.dispatchMouseEvent', at(box.y, 'mouseMoved', 0));
    await this.call('Input.dispatchMouseEvent', at(box.y, 'mousePressed', 1));
    const steps = 14;
    for (let i = 1; i <= steps; i++) {
      await this.call('Input.dispatchMouseEvent', at(box.y + (dy * i) / steps, 'mouseMoved', 1));
      await sleep(28);
    }
    await sleep(120);
    await this.call('Input.dispatchMouseEvent', at(box.y + dy, 'mouseReleased', 0));
  }

  // The card, dragged and HELD. Every other frame in here is a screen at rest;
  // this one is deliberately mid-gesture, because the stamp that says which
  // verdict a release would fire only exists while a finger is on the card.
  // Left down rather than released, so the frame is stable: nothing is
  // animating, the transform is exactly where the pointer put it, and shoot()
  // photographs it twice and compares.
  async holdCard(dx) {
    const box = await this.evaluate(`(() => {
      const r = document.getElementById('c-top').getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
    const at = (x, type, buttons) => ({ x, y: box.y, type, buttons, button: 'left', clickCount: 1 });
    await this.call('Input.dispatchMouseEvent', at(box.x, 'mouseMoved', 0));
    await this.call('Input.dispatchMouseEvent', at(box.x, 'mousePressed', 1));
    const steps = 10;
    for (let i = 1; i <= steps; i++) {
      await this.call('Input.dispatchMouseEvent', at(box.x + (dx * i) / steps, 'mouseMoved', 1));
      await sleep(24);
    }
    // Long enough for the snap the PREVIOUS drop started to have finished, and
    // for the transform this one wrote to be the last thing that moved.
    await sleep(500);
    this.held = box;
  }

  // Back to the middle, and let go. Under the threshold, so the card returns to
  // rest and the deck is where it was.
  async dropCard() {
    const at = (x, type, buttons) => ({ x, y: this.held.y, type, buttons, button: 'left', clickCount: 1 });
    await this.call('Input.dispatchMouseEvent', at(this.held.x, 'mouseMoved', 1));
    await this.call('Input.dispatchMouseEvent', at(this.held.x, 'mouseReleased', 0));
    await sleep(450);
  }

  // The sheet snaps with a CSS transition, so a frame taken too early
  // photographs a drag in progress, which is not a state the app rests in.
  async settled() {
    await this.waitFor(
      `(() => { const s = document.getElementById('sheet');
        return getComputedStyle(s).height === s.style.height; })()`,
      'the sheet to finish snapping',
      5000,
    );
  }

  // The map is a canvas, so whether it has drawn is a question about pixels
  // rather than about the DOM. Asking the canvas answers it before the frame is
  // taken; asking the screenshot only ever answers it afterwards.
  async painted() {
    await this.waitFor(
      `(() => {
        const c = document.getElementById('map');
        if (!c || !c.width) return false;
        const o = new OffscreenCanvas(48, 48);
        const g = o.getContext('2d', { willReadFrequently: true });
        g.drawImage(c, 0, 0, 48, 48);
        const px = g.getImageData(0, 0, 48, 48).data;
        const seen = new Set();
        for (let i = 0; i < px.length; i += 4) seen.add((px[i] << 16) | (px[i + 1] << 8) | px[i + 2]);
        return seen.size > 8;
      })()`,
      'the basemap to paint',
    );
  }

  // A cold start, waited out rather than slept through. After `ready` the only
  // thing left moving on the question screen is the "finding campus" line
  // fading out, which is 300ms of CSS on one element.
  async boot(url) {
    // Page.navigate resolves when the navigation BEGINS, not when the new
    // document commits, so everything below can run against the OUTGOING page.
    // Measured over nine runs, this raced twice. From about:blank it is a loud
    // crash -- no #ask, so .classList throws -- but the second boot() of a shoot
    // reloads the SAME url, and there the stale document is the already-booted
    // app: all three predicates pass against it, boot() returns while the reload
    // is still in flight, and the ask frame can be a photograph of the list.
    // A wrong picture that looks right is the one failure this script must not
    // have, since nothing downstream can tell.
    //
    // Marking the document and waiting for the mark to disappear is the whole
    // fix: only a committed navigation can clear a property set on the old one.
    await this.call('Runtime.evaluate', { expression: 'window.__shootDoc = 1' });
    await this.call('Page.navigate', { url });
    await this.waitFor('window.__shootDoc === undefined', 'the navigation to commit');
    await this.waitFor(`document.getElementById('ask').classList.contains('ready')`, 'the app to boot');
    await this.painted();
    await this.waitFor(
      `getComputedStyle(document.querySelector('#ask .loading')).opacity === '0'`,
      'the loading line to fade out',
    );
  }

  async capture() {
    const r = await this.call('Page.captureScreenshot', {
      format: 'webp',
      quality: QUALITY,
      fromSurface: true,
    });
    return r.data;
  }
}

// ------------------------------------------------------------------- frames

// Blankness is a property of the image, so it is measured on the image: the
// frame is drawn small on a canvas and the spread of its pixels is read back.
// A dark app on a dark map still has hundreds of distinct colours; a frame
// that failed to paint has one or two.
// WHERE two frames differ, in CSS pixels, when one of them moved. "The screen
// was still moving" used to be the whole report, and finding out what had moved
// meant rebuilding this script by hand in a scratch file. It says which corner
// now, and how much.
async function whereMoved(lab, a, b) {
  return lab.evaluate(`(async () => {
    const load = async (b64) => {
      const img = new Image();
      img.src = 'data:image/webp;base64,' + b64;
      await img.decode();
      const c = new OffscreenCanvas(img.width, img.height);
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(img, 0, 0);
      return { px: g.getImageData(0, 0, img.width, img.height).data, w: img.width, h: img.height };
    };
    const A = await load(${JSON.stringify(a)});
    const B = await load(${JSON.stringify(b)});
    let n = 0, worst = 0, minX = 1e9, minY = 1e9, maxX = -1, maxY = -1;
    for (let i = 0; i < A.px.length; i += 4) {
      const d = Math.abs(A.px[i] - B.px[i]) + Math.abs(A.px[i+1] - B.px[i+1]) + Math.abs(A.px[i+2] - B.px[i+2]);
      if (d === 0) continue;
      n++; if (d > worst) worst = d;
      const x = (i / 4) % A.w, y = Math.floor((i / 4) / A.w);
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    const s = 3;
    return n
      ? { pixels: n, pct: +(n / (A.w * A.h) * 100).toFixed(3), worst,
          css: [Math.round(minX/s), Math.round(minY/s), Math.round(maxX/s), Math.round(maxY/s)] }
      : null;
  })()`);
}

async function inspect(lab, base64) {
  return lab.evaluate(`(async () => {
    const img = new Image();
    img.src = 'data:image/webp;base64,' + ${JSON.stringify(base64)};
    await img.decode();
    const w = 160, h = Math.round(img.height * 160 / img.width);
    const c = new OffscreenCanvas(w, h);
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0, w, h);
    const px = g.getImageData(0, 0, w, h).data;
    const seen = new Set();
    let sum = 0, sumsq = 0;
    for (let i = 0; i < px.length; i += 4) {
      seen.add((px[i] >> 3 << 10) | (px[i + 1] >> 3 << 5) | (px[i + 2] >> 3));
      const l = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
      sum += l; sumsq += l * l;
    }
    const n = px.length / 4;
    const mean = sum / n;
    return { w: img.width, h: img.height, colours: seen.size, spread: Math.sqrt(sumsq / n - mean * mean) };
  })()`);
}

// --------------------------------------------------------------------- pick

// The first clock time in a string, which is the only part of "till 2:35pm,
// class" and "Free till 2:45pm" that has to match.
const clockTime = (s) => (String(s).match(/\d{1,2}:\d{2}[ap]m/) || [null])[0];

// How far down the ranked list the search for a room is allowed to go.
const PROBE_ROWS = 20;

// Which room the last two frames are of. Decided by opening rooms and reading
// them back, not by guessing from the list row.
//
// Two things disqualify a room. A room with no class today has a timeline with
// nothing in it but the door times, which is a thin picture of "its whole day".
// And a room whose window ends at a class prints a headline ten minutes later
// than its own list row, because the row has the packup buffer taken off and
// the headline does not: github.com/EnesYilmazcode/Vacant/issues/77. Shooting
// one of those would put two different answers for one room at one minute into
// the README, side by side. Once #77 is fixed the second row of the list
// qualifies again, and the picture goes back to being the nearest room.
async function choose(page) {
  await page.tapSelector('.opt[data-min="120"]');
  await page.waitFor(`document.querySelectorAll('#list .row').length > 3`, 'the list to fill');
  return page.evaluate(`(async () => {
    const rows = [...document.querySelectorAll('#list .row')].slice(0, ${PROBE_ROWS});
    const back = document.getElementById('back');
    const time = (s) => (s.match(/\\d{1,2}:\\d{2}[ap]m/) || [null])[0];
    const tried = [];
    for (const row of rows) {
      const i = Number(row.dataset.i);
      const name = row.querySelector('.r-name').textContent.trim();
      const win = row.querySelector('.r-win').textContent.replace(/\\s+/g, ' ').trim();
      row.scrollIntoView({ block: 'center' });
      row.click();
      row.click();
      await new Promise((r) => setTimeout(r, 250));
      const claim = document.querySelector('#room .claim').textContent.replace(/\\s+/g, ' ').trim();
      const busy = document.querySelectorAll('#room .blk').length;
      back.click();
      await new Promise((r) => setTimeout(r, 200));
      const said = time(claim);
      const agrees = said === null || said === time(win);
      tried.push({ i, name, win, claim, busy, agrees });
      if (busy > 0 && agrees) return { pick: { i, name, win, claim, busy }, tried };
    }
    return { pick: null, tried };
  })()`);
}

// ---------------------------------------------------------------------- run

async function run() {
  const problems = [];
  const server = await serve(ROOT, PORT);
  const port = server.address().port;
  const origin = `http://localhost:${port}`;
  const url = `${origin}/Vacant/`;
  const chrome = await launch();

  let dt;
  try {
    const res = await fetch(`http://127.0.0.1:${chrome.port}/json/version`);
    const { webSocketDebuggerUrl } = await res.json();
    dt = await Devtools.open(webSocketDebuggerUrl);

    await dt.send('Browser.grantPermissions', { origin, permissions: ['geolocation'] });

    // A blank tab used only to measure and rescale the frames. It never loads
    // the app, so it cannot disturb what is being photographed. It is opened
    // FIRST and the app tab is activated after: a background tab in headless
    // Chrome gets no animation frames, and with the order reversed every CSS
    // transition in the app froze part way, so the sheet photographed mid
    // snap and the map never lost its flyover blur.
    const labTarget = await dt.send('Target.createTarget', { url: 'about:blank' });
    const labSession = await dt.send('Target.attachToTarget', {
      targetId: labTarget.targetId,
      flatten: true,
    });
    const lab = new Phone(dt, labSession.sessionId, origin);

    const { targetId } = await dt.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await dt.send('Target.attachToTarget', { targetId, flatten: true });
    const page = new Phone(dt, sessionId, origin);
    await dt.send('Target.activateTarget', { targetId });

    dt.on((msg) => {
      if (msg.sessionId !== sessionId) return;
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        page.errors.push(msg.params.args.map((a) => a.value ?? a.description).join(' '));
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        page.errors.push('threw: ' + msg.params.exceptionDetails.text);
      }
    });

    await page.call('Page.enable');
    await page.call('Runtime.enable');
    await page.call('Emulation.setDeviceMetricsOverride', {
      width: SCREEN.width,
      height: SCREEN.height,
      deviceScaleFactor: SCREEN.dpr,
      mobile: true,
      screenWidth: SCREEN.width,
      screenHeight: SCREEN.height,
    });
    await page.call('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await page.call('Emulation.setUserAgentOverride', { userAgent: UA, platform: 'iPhone' });
    await page.call('Emulation.setTimezoneOverride', { timezoneId: TZ });
    await page.call('Emulation.setGeolocationOverride', WHERE);
    const fixed = new Date(WHEN).getTime();
    await page.call('Page.addScriptToEvaluateOnNewDocument', { source: pinnedClockSource(fixed) });

    await page.boot(url);

    const stamp = await page.evaluate(`new Date().toString()`);
    console.log(`clock  ${stamp}`);
    console.log(`origin ${WHERE.latitude}, ${WHERE.longitude}`);

    const { pick, tried } = await choose(page);
    for (const r of tried) {
      const why = r.busy === 0 ? 'no class today' : r.agrees ? 'taken' : `disagrees with "${r.win}"`;
      console.log(`probe  row ${String(r.i).padStart(2)}  ${r.name.padEnd(28)} ${r.claim.padEnd(38)} ${why}`);
    }
    // Falling back to the top row keeps the run finishing so the other four
    // frames can still be looked at. Nothing is written either way: a problem
    // on the list blocks the write on its own.
    if (!pick) problems.push(`no room in the top ${PROBE_ROWS} both has a class today and agrees with its own row`);
    const target = pick ?? { i: 0, name: 'the top row', win: '' };

    // Start the answer again from the question. Choosing left a room selected,
    // and the fourth frame is the tap that selects one.
    await page.boot(url);

    const frames = [];
    const shoot = async (name, note, of) => {
      // A photograph of a screen that has not stopped moving is a different
      // photograph every run, which is how the flyover got into docs/media in
      // the first place. So every frame is taken twice, a quarter of a second
      // apart, and has to come back the same. This catches the whole class of
      // it, including the parts of the app nobody thought to pin.
      const data = await page.capture();
      await sleep(250);
      const again = await page.capture();
      // Not byte-for-byte any more, and the reason is worth writing down. The
      // capture is `fromSurface`, so it reads the compositor's raster of the
      // page rather than re-rendering it, and once a downscaled PHOTOGRAPH is
      // on screen that raster is not reproducible to the bit: the card frame
      // differed from its own retake by up to 3 levels per channel over the
      // lower half of the screen, identically on every run, at any settle time,
      // with the blur off, with the map hidden, and with the image on its own
      // compositor layer. The same frames captured without `fromSurface` were
      // byte-identical, which is what says it is the raster and not the app.
      //
      // So the check measures what it was always FOR: whether the screen was
      // moving. Anything actually in motion -- a sheet mid-snap, a fade, a card
      // sliding -- moves edges between hundreds and the full 765 apart. Three
      // levels per channel is not motion, it is arithmetic.
      const moved = await whereMoved(lab, data, again);
      if (moved && moved.worst > STILL) {
        problems.push(
          `${name}: the screen was still moving when it was photographed -- ` +
            `${moved.pixels} px (${moved.pct}%) changed, worst ${moved.worst}/765, ` +
            `inside CSS box [${moved.css.join(', ')}]`,
        );
      }
      // What the screen says, kept beside the picture. A screenshot cannot be
      // read by a test and its alt text can drift off it without anyone
      // noticing, which is how the README came to print a time the app does
      // not. scripts/test/readme.test.mjs checks the two against each other.
      const text = await page.evaluate(`document.body.innerText.replace(/\\s+/g, ' ').trim()`);
      frames.push({ name, note, data, text, of });
      const stats = await inspect(lab, data);
      const ok = stats.colours >= 64 && stats.spread >= 4;
      console.log(
        `${ok ? 'ok  ' : 'BAD '} ${name.padEnd(10)} ${stats.w}x${stats.h}  ` +
          `${stats.colours} colours  spread ${stats.spread.toFixed(1)}  ${note}`,
      );
      if (!ok) problems.push(`${name} looks blank: ${stats.colours} colours, spread ${stats.spread.toFixed(1)}`);
    };

    // A defect the frames are allowed to carry prints and does not block. Every
    // other one stops the write.
    const note = (key, detail) => {
      const carried = CARRIED.get(key);
      if (carried) console.log(`carry  ${key.padEnd(10)} ${detail}\n       ${carried}`);
      else problems.push(`${key}: ${detail}`);
    };

    // 1. the question, over the flyover. The four durations ARE the question
    //    now; the label above them and the term line below are both gone, and
    //    the frame is worth nothing if either came back.
    const ask = await page.evaluate(`(() => ({
      opts: [...document.querySelectorAll('#ask .opt[data-min]')].map(b => b.textContent.trim()),
      chosen: (document.querySelector('#ask .opt.primary') || {}).textContent,
      copy: document.getElementById('ask').innerText.replace(/\\s+/g, ' ').trim(),
    }))()`);
    if (ask.opts.length !== 4) problems.push(`ask: ${ask.opts.length} durations on screen`);
    if (!ask.chosen) problems.push('ask: no duration is marked chosen');
    if (/How long/i.test(ask.copy)) problems.push('ask: the question label is back');
    if (/\b(Autumn|Spring|Summer) \d{4}\b/.test(ask.copy)) problems.push('ask: the term line is back');
    // `?? 'none'` rather than ask.chosen.trim(): undefined is exactly what the
    // check two lines up records, and reading through it here killed the run
    // with a TypeError instead of reporting the failure it had just found.
    await shoot('ask', `${ask.opts.join(', ')}; ${(ask.chosen ?? 'none').trim()} chosen`);

    // 2. the card. A duration opens ONE room now, not thirty-five: the
    //    building, the room number, and two ways out of it. Nothing is selected
    //    yet, so there is nothing on the map and the sheet covers it.
    await page.tapSelector('.opt[data-min="120"]');
    await page.waitFor(`document.getElementById('c-top')`, 'the first card');
    // The photograph arrives after the text and fades in over 350ms, and a
    // frame taken during that fade is a different frame every run.
    await page.waitFor(
      `(() => {
        const i = document.getElementById('c-img');
        // Computed opacity is the END of the fade. The class goes on when the
        // warp is drawn and the transition runs for another 350ms after that,
        // and a frame taken inside it is a different frame every run.
        return !i || getComputedStyle(i).opacity === '1';
      })()`,
      'the photograph to finish fading in',
    );
    // Settled AFTER the fade, not before it. The install rail mounts late and
    // js/app.js resizes the sheet when it does, so a settle taken before the
    // photograph had even arrived was a settle on a layout that then moved.
    await page.settled();
    await sleep(1400);
    const card = await page.evaluate(`(() => {
      const pick = (sel) => (document.querySelector(sel) || {}).textContent || '';
      const img = document.getElementById('c-img');
      return {
        pos: pick('.c-pos').trim(),
        title: pick('.c-b').trim(),
        facts: pick('.c-facts').replace(/\\s+/g, ' ').trim(),
        acts: [...document.querySelectorAll('.c-act')].map((b) => b.getAttribute('aria-label')),
        nomap: document.body.classList.contains('nomap'),
        photo: img ? (img.tagName === 'CANVAS' ? 'canvas' : img.getAttribute('src')) : null,
        drawn: img ? img.width + 'x' + img.height : null,
        plain: document.getElementById('c-top').classList.contains('plain'),
      };
    })()`);
    console.log(`card   ${card.pos}  ${card.title}  ${card.facts}`);
    console.log(`photo  ${card.photo ?? '(none)'}  ${card.drawn ?? ''}`);
    // The room and the building are the two things this screen exists to say.
    if (!card.title) problems.push('card: nothing names the room');
    // The window is the answer to the question that was asked, so it leads the
    // facts line. Losing it would leave a card that never says how long.
    if (!/free till|no class|from |till /i.test(card.facts)) {
      problems.push(`card: nothing says how long it is yours: "${card.facts}"`);
    }
    if (card.acts.length !== 2) problems.push(`card: ${card.acts.length} buttons, not two`);
    // A swipe nothing announces is unreachable from a keyboard and invisible to
    // a screen reader, so both verdicts have to exist as named controls.
    if (card.acts.some((a) => !a)) problems.push('card: a verdict button has no accessible name');
    if (!card.nomap) problems.push('card: the map is on screen with nothing on it');
    // The whole point of the frame. A photograph that 404s leaves the plain
    // card, which is correct for the 119 rooms that have none and wrong for
    // this one: Cunz Hall 160 has one, and it is the room the run picks.
    if (!card.photo) problems.push('card: no photograph on a room that has one');
    else if (card.plain) problems.push('card: the photograph failed to load');
    // The warp draws at the device pixel ratio, capped at 2, so a 393x852 phone
    // gets a 786x1704 canvas. A canvas that came out 0 wide is a draw that
    // happened before the pane had a size.
    else if (!/^\d{3,}x\d{3,}$/.test(card.drawn ?? '')) problems.push(`card: the canvas is ${card.drawn}`);
    await shoot('card', `${card.pos}, ${card.title}, ${card.facts}`);

    // 2b and 2c. The same card, held mid-swipe in each direction. This is the
    //   only part of the screen no still frame can show: the stamp that says
    //   what letting go would do exists only while a finger is on the card.
    //   Held short of the 84px commit threshold, so the room is still readable
    //   under the verdict rather than half off the side of the phone.
    const stampOf = () =>
      page.evaluate(`(() => {
        const seen = (sel) => {
          const el = document.querySelector(sel);
          return el ? Number(getComputedStyle(el).opacity) : -1;
        };
        const t = document.getElementById('c-top');
        return { no: seen('.c-stamp.no'), yes: seen('.c-stamp.yes'), moved: t.getBoundingClientRect().left };
      })()`);
    const atRest = await stampOf();

    await page.holdCard(-72);
    const left = await stampOf();
    if (!(left.no > 0.6)) problems.push(`swipe-next: the NEXT stamp is at ${left.no}`);
    if (left.yes > 0.05) problems.push(`swipe-next: the GO stamp is showing too, at ${left.yes}`);
    if (!(left.moved < atRest.moved - 50)) problems.push('swipe-next: the card did not follow the pointer');
    await shoot('swipe-next', `held ${Math.round(atRest.moved - left.moved)}px left, NEXT showing`);
    await page.dropCard();

    await page.holdCard(72);
    const right = await stampOf();
    if (!(right.yes > 0.6)) problems.push(`swipe-go: the GO stamp is at ${right.yes}`);
    if (right.no > 0.05) problems.push(`swipe-go: the NEXT stamp is showing too, at ${right.no}`);
    if (!(right.moved > atRest.moved + 50)) problems.push('swipe-go: the card did not follow the pointer');
    await shoot('swipe-go', `held ${Math.round(right.moved - atRest.moved)}px right, GO showing`);
    await page.dropCard();

    // Letting go under the threshold puts it back, so the deck is where it was.
    const back = await stampOf();
    if (Math.abs(back.moved - atRest.moved) > 1) {
      problems.push(`the card did not return to rest: ${atRest.moved} -> ${back.moved}`);
    }

    // 3. the ranked list, one tap behind the card for anyone who wants to scan.
    await page.tapSelector('.c-more');
    await page.waitFor(`document.querySelectorAll('#list .row').length > 3`, 'the list to fill');
    await page.settled();
    await sleep(1500);
    const rows = await page.evaluate(
      `[...document.querySelectorAll('#list .row')].map(r => r.textContent.replace(/\\s+/g, ' ').trim())`,
    );
    console.log('rows   ' + rows.slice(0, 5).join('\n       '));
    const browsing = await page.evaluate(`(() => ({
      nomap: document.body.classList.contains('nomap'),
      sheet: document.getElementById('sheet').getBoundingClientRect().height,
    }))()`);
    if (!browsing.nomap) problems.push('list: the map is on screen with nothing on it');
    if (browsing.sheet < 0.7 * SCREEN.height) {
      problems.push(`list: the sheet rests at ${Math.round(browsing.sheet)}px, not over the map`);
    }
    await shoot('list', `${rows.length} rows shown, sheet ${Math.round(browsing.sheet)}px, map covered`);

    // And it cannot be uncovered by hand either. The two snap points have
    // collapsed onto each other while nothing is selected, so a pull short of
    // the dismiss travel returns to full rather than opening a band of campus
    // with nothing on it. No frame: it is the same picture as the one above,
    // which is the whole claim.
    await page.dragSheet(60);
    await page.settled();
    const pulled = await page.evaluate(`document.getElementById('sheet').getBoundingClientRect().height`);
    if (Math.abs(pulled - browsing.sheet) > 2) {
      problems.push(`list: a 60px pull moved the sheet ${Math.round(browsing.sheet)} -> ${Math.round(pulled)}`);
    }

    // 4. one room selected: the map comes out from under the list with the
    //    footprint lit and an arrow drawn to it. The first tap on a row
    //    selects, so this is one tap and the sheet drops back to peek.
    // The chosen room is not always above the fold, so the list is scrolled to
    // it first, which is the scroll a thumb does. It stops with the row above it
    // flush against the top of the list rather than centred, because centring
    // cuts the first row in half and a sliced heading photographs as a bug.
    await page.evaluate(`(() => {
      const list = document.getElementById('list');
      const row = document.querySelector('#list .row[data-i="${target.i}"]');
      const first = row.previousElementSibling ?? row;
      list.scrollTop = Math.round(
        list.scrollTop + first.getBoundingClientRect().top - list.getBoundingClientRect().top,
      );
    })()`);
    console.log(`room   row ${target.i}, ${target.name}`);
    await page.tapSelector(`#list .row[data-i="${target.i}"]`);
    await page.waitFor(`document.querySelector('#list .row.on')`, 'the row to light up');
    await page.settled();
    await sleep(1400);
    const picked = await page.evaluate(`(() => ({
      nomap: document.body.classList.contains('nomap'),
      sheet: document.getElementById('sheet').getBoundingClientRect().height,
    }))()`);
    if (picked.nomap) problems.push('room: the map stayed covered over a lit room');
    if (!(picked.sheet < browsing.sheet - 100)) {
      problems.push(`room: the sheet did not drop (${Math.round(browsing.sheet)} -> ${Math.round(picked.sheet)})`);
    }
    await shoot(
      'room',
      `${target.name} selected, sheet ${Math.round(browsing.sheet)}px -> ${Math.round(picked.sheet)}px, map shown`,
      target.name,
    );

    // 5. tap the same row again and the room screen opens
    await page.tapSelector(`#list .row[data-i="${target.i}"]`);
    await page.waitFor(`!document.getElementById('room').hidden`, 'the room screen');
    await page.waitFor(`document.querySelector('#room .day')`, "today's grid");
    // The room screen opens tall on its own now, because it holds a day as a
    // calendar and a calendar whose first two hours are the only ones above the
    // fold is a calendar nobody scrolls. The drag that used to be here fought
    // that, so the frame is taken where the app puts it.
    await page.settled();
    await sleep(900);
    const room = await page.evaluate(`(() => {
      const facts = document.querySelector('#room .facts');
      return {
        title: document.querySelector('#room h2').textContent.replace(/\\s+/g, ' ').trim(),
        claim: document.querySelector('#room .claim').textContent.replace(/\\s+/g, ' ').trim(),
        facts: facts.textContent.replace(/\\s+/g, ' ').trim(),
        loose: [...facts.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()),
        day: (document.querySelector('#room .dnav span') || {}).textContent || '',
        tl: [...document.querySelectorAll('#room .blk')]
          .map((l) => l.textContent.replace(/\\s+/g, ' ').trim())
          .filter(Boolean),
      };
    })()`);
    console.log(`claim  ${room.title}: ${room.claim}`);
    console.log(`day    ${room.day}`);
    console.log('classes ' + (room.tl.join('\n        ') || '(none)'));
    await shoot('timeline', `${room.tl.length} classes on ${room.day}`, target.name);

    // The row and the room screen are two renderings of one answer, so they
    // have to print one minute. They did not, and the README shipped both.
    const said = clockTime(room.claim);
    const shown = clockTime(target.win);
    if (said && said !== shown) {
      problems.push(`timeline: the room screen says "${room.claim}" where the row says "${target.win}"`);
    }

    // Each fact is meant to be its own flex item. A bare text node in there is
    // two facts sharing one box with no gap between them.
    if (room.loose) note('facts', `${room.title} reads "${room.facts}"`);

    if (page.errors.length) problems.push(`the page logged ${page.errors.length} error(s): ${page.errors.join(' | ')}`);

    if (!CHECK_ONLY && !problems.length) {
      await fsp.mkdir(OUT, { recursive: true });
      let total = 0;
      for (const frame of frames) {
        const bytes = Buffer.from(frame.data, 'base64');
        await fsp.writeFile(path.join(OUT, `${frame.name}.webp`), bytes);
        total += bytes.length;
        console.log(`wrote  docs/media/${frame.name}.webp  ${(bytes.length / 1024).toFixed(0)} KB`);
      }
      const manifest = {
        note:
          'What the committed screenshots in this folder say, in words. Written by ' +
          'scripts/shoot.mjs, read by scripts/test/readme.test.mjs, so the README cannot ' +
          'end up describing a picture that says something else.',
        when: WHEN,
        where: WHERE,
        screen: SCREEN,
        room: { name: target.name, row: target.win, claim: room.claim, facts: room.facts },
        frames: Object.fromEntries(
          frames.map((f) => [f.name, { note: f.note, ...(f.of ? { of: f.of } : {}), text: f.text }]),
        ),
      };
      await fsp.writeFile(path.join(OUT, 'frames.json'), JSON.stringify(manifest, null, 2) + '\n');
      console.log('wrote  docs/media/frames.json');
      console.log(`total  ${(total / 1024).toFixed(0)} KB`);
    }
  } finally {
    try {
      await dt?.send('Browser.close');
    } catch {
      /* already gone */
    }
    chrome.child.kill();
    server.close();
    await fsp.rm(chrome.profile, { recursive: true, force: true }).catch(() => {});
  }

  if (problems.length) {
    for (const p of problems) console.error('FAIL ' + p);
    process.exitCode = 1;
  }
}

await run();
