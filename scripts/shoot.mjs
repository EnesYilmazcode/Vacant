#!/usr/bin/env node
// Capture the screenshots in docs/media/, reproducibly.
//
//   node scripts/shoot.mjs            write docs/media/*.webp
//   node scripts/shoot.mjs --check    capture and verify, write nothing
//
// Needs Chrome or Chromium on the machine and nothing else. It finds the
// browser itself, serves the repo over a local port, drives the real app and
// refuses to write if a frame came out blank, a screen came out empty, or the
// page logged a console error or threw. Point CHROME at the binary if the
// search misses:
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

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
};

// ------------------------------------------------------------------ browser

function chromePaths() {
  const env = process.env.CHROME || process.env.CHROME_PATH;
  if (env) return [env];
  const pf = process.env['ProgramFiles'] || 'C:/Program Files';
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:/Program Files (x86)';
  const local = process.env.LOCALAPPDATA || '';
  if (process.platform === 'win32') {
    return [
      `${pf}/Google/Chrome/Application/chrome.exe`,
      `${pf86}/Google/Chrome/Application/chrome.exe`,
      `${local}/Google/Chrome/Application/chrome.exe`,
      `${pf}/Chromium/Application/chrome.exe`,
    ];
  }
  if (process.platform === 'darwin') {
    return [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ];
  }
  return [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
  ];
}

function findChrome() {
  for (const p of chromePaths()) {
    if (p && fs.existsSync(p)) return p;
  }
  throw new Error(
    'no Chrome found. Set CHROME to the binary, for example\n' +
      '  CHROME="C:/Program Files/Google/Chrome/Application/chrome.exe" node scripts/shoot.mjs',
  );
}

// Chrome writes the port it actually took into DevToolsActivePort, which is
// the only reliable way to read it back when you ask for port 0.
async function launch() {
  const bin = findChrome();
  const profile = await fsp.mkdtemp(path.join(os.tmpdir(), 'vacant-shoot-'));
  const child = spawn(
    bin,
    [
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-dev-shm-usage',
      '--hide-scrollbars',
      '--force-color-profile=srgb',
      '--font-render-hinting=none',
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  child.stderr.resume();

  const portFile = path.join(profile, 'DevToolsActivePort');
  const until = Date.now() + 30000;
  while (Date.now() < until) {
    if (child.exitCode !== null) throw new Error(`chrome exited with ${child.exitCode}`);
    try {
      const [port] = (await fsp.readFile(portFile, 'utf8')).split('\n');
      if (port) return { child, profile, port: Number(port) };
    } catch {
      /* not written yet */
    }
    await sleep(60);
  }
  throw new Error('chrome never published a debugging port');
}

// A DevTools client small enough to read. Node 22 ships the WebSocket, so this
// costs the project nothing, which is the rule the rest of the repo follows.
class Devtools {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.waiting = new Map();
    this.listeners = [];
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id != null) {
        const pending = this.waiting.get(msg.id);
        if (!pending) return;
        this.waiting.delete(msg.id);
        if (msg.error) pending.reject(new Error(`${pending.method}: ${msg.error.message}`));
        else pending.resolve(msg.result);
        return;
      }
      for (const fn of this.listeners) fn(msg);
    });
  }

  static async open(url) {
    const ws = new WebSocket(url);
    await once(ws, 'open');
    return new Devtools(ws);
  }

  on(fn) {
    this.listeners.push(fn);
  }

  send(method, params = {}, sessionId) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject, method });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
}

// ------------------------------------------------------------------- server

async function serve(root) {
  const server = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.startsWith('/Vacant/')) p = p.slice(7);
    else if (p === '/Vacant') p = '/';
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(root, p);
    if (!file.startsWith(root)) {
      res.writeHead(403).end();
      return;
    }
    fs.readFile(file, (err, body) => {
      if (err) {
        res.writeHead(404).end('404 ' + p);
        return;
      }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      res.end(body);
    });
  });
  for (const port of [PORT, 0]) {
    try {
      server.listen(port);
      await once(server, 'listening');
      return server;
    } catch (err) {
      if (err.code !== 'EADDRINUSE') throw err;
    }
  }
  throw new Error('could not bind a port');
}

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
    await this.call('Page.navigate', { url });
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
      const busy = document.querySelectorAll('#room .tl li.busy').length;
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
  const server = await serve(ROOT);
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
      if (data !== again) problems.push(`${name}: the screen was still moving when it was photographed`);
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

    // 1. the question, over the flyover
    const askCopy = await page.evaluate(`document.querySelector('#prov').textContent.trim()`);
    if (!askCopy) problems.push('ask: the provenance line is empty');
    await shoot('ask', askCopy);

    // 2. the ranked list at peek height
    await page.tapSelector('.opt[data-min="120"]');
    await page.waitFor(`document.querySelectorAll('#list .row').length > 3`, 'the list to fill');
    await sleep(1500);
    const rows = await page.evaluate(
      `[...document.querySelectorAll('#list .row')].map(r => r.textContent.replace(/\\s+/g, ' ').trim())`,
    );
    console.log('rows   ' + rows.slice(0, 5).join('\n       '));
    await shoot('list', `${rows.length} rows shown`);

    // 3. the same list dragged to full height
    const peek = await page.evaluate(`document.getElementById('sheet').getBoundingClientRect().height`);
    await page.dragSheet(-0.34 * SCREEN.height);
    await page.settled();
    const full = await page.evaluate(`document.getElementById('sheet').getBoundingClientRect().height`);
    if (!(full > peek + 100)) problems.push(`list-full: the sheet did not open (${peek} -> ${full})`);
    await shoot('list-full', `sheet ${Math.round(peek)}px -> ${Math.round(full)}px`);

    // 4. one room selected: footprint lit, walk line drawn. The first tap on a
    //    row selects, so this is one tap and the sheet drops back to peek.
    await page.dragSheet(0.34 * SCREEN.height);
    await page.settled();
    // The chosen room is not always among the four the sheet shows at peek, so
    // the list is scrolled to it first, which is the scroll a thumb does. It
    // stops with the row above it flush against the top of the list rather than
    // centred, because centring cuts the first row in half and a sliced heading
    // photographs as a bug.
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
    await sleep(1400);
    await shoot('room', `${target.name} selected`, target.name);

    // 5. tap the same row again and the room screen opens
    await page.tapSelector(`#list .row[data-i="${target.i}"]`);
    await page.waitFor(`!document.getElementById('room').hidden`, 'the room screen');
    await page.waitFor(`document.querySelectorAll('#room .tl li').length > 2`, "today's timeline");
    // Opened at peek the timeline runs off the bottom of the phone, and the row
    // that gets cut is the one saying when the building locks, which is the
    // half of the answer nobody else has. So the sheet goes up.
    await page.dragSheet(-0.34 * SCREEN.height);
    await page.settled();
    await sleep(900);
    const room = await page.evaluate(`(() => {
      const facts = document.querySelector('#room .facts');
      return {
        title: document.querySelector('#room h2').textContent.replace(/\\s+/g, ' ').trim(),
        claim: document.querySelector('#room .claim').textContent.replace(/\\s+/g, ' ').trim(),
        facts: facts.textContent.replace(/\\s+/g, ' ').trim(),
        loose: [...facts.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()),
        tl: [...document.querySelectorAll('#room .tl li')]
          .map((l) => l.textContent.replace(/\\s+/g, ' ').trim())
          .filter(Boolean),
      };
    })()`);
    console.log(`claim  ${room.title}: ${room.claim}`);
    console.log('timeline ' + room.tl.join('\n         '));
    await shoot('timeline', `${room.tl.length} timeline rows`, target.name);

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
