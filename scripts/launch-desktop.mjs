#!/usr/bin/env node
// The desktop half of the cold-launch spike, github.com/EnesYilmazcode/Vacant/issues/29.
//
//   node scripts/launch-desktop.mjs              1x, 4x, 6x, 5 runs each
//   node scripts/launch-desktop.mjs --runs 3     fewer runs
//   node scripts/launch-desktop.mjs --json       machine-readable, for a diff
//
// spikes/launch.html is the phone instrument and it times fetch, parse and
// answer by hand. This times the SHIPPED app instead, through its own
// performance marks, so the phone sitting only has to confirm a number that
// already exists rather than produce one from nothing.
//
// Three things it does that a stopwatch cannot.
//
// It throttles the CPU. Emulation.setCPUThrottlingRate slows the renderer's
// JavaScript by the given factor and leaves timers and the network alone, which
// is the right shape for #29's question: a phone is not a slow network, it is a
// slow core.
//
// Every run is a fresh browser process. A second navigation in the same process
// reuses V8's code cache and the parse comes back smaller, which is a number
// describing a launch nobody performs.
//
// It counts the app's OWN requestAnimationFrame callbacks, by wrapping the
// function before any page script runs. #29's revision comment asks for a frame
// loop instrument; createFrameLoop in js/map.js already fixed that in #94 and
// this is what proves it, rather than a second instrument on the phone.
//
// Half the clock is pinned and half is not. The date has to be fixed, because
// js/app.js refuses to rank outside scheduled hours and a run started at 9pm
// measures a boot that answers nothing. performance.now() is left running,
// because unlike scripts/shoot.mjs this script is measuring it.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Devtools, launch, serve, sleep } from './lib/browser.mjs';
import { pinnedClockSource } from './lib/pinned-clock.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 8139);

const RATES = [1, 4, 6];
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : Number(process.argv[i + 1]);
};
const RUNS = arg('--runs', 5);
const AS_JSON = process.argv.includes('--json');

// Thompson Library steps, the middle of the Oval, the same fix scripts/shoot.mjs
// pins. The app awaits geolocation inside the same Promise.all as the index, so
// a browser left sitting on the prompt would be timing the prompt.
const WHERE = { latitude: 39.99944, longitude: -83.01502, accuracy: 18 };
const TZ = 'America/New_York';

// Wednesday 2026-09-16, 10:20am Eastern, the instant scripts/shoot.mjs shoots
// at: inside the Autumn 2026 window in data/current.json and inside scheduled
// hours, so the app ranks rather than showing a gate.
const WHEN = new Date('2026-09-16T10:20:00-04:00').getTime();
const SCREEN = { width: 393, height: 852, dpr: 3 };
const UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 ' +
  '(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

// How long the screen has to hold still before the frame count starts, and how
// long the count then runs. 500 ms of silence is thirty frames at 60 Hz even
// after 6x throttling, so it cannot mistake one slow frame for an idle app.
const QUIET_MS = 500;
const COUNT_MS = 3000;
const QUIET_TRIES = 40;

// Installed before any page script, so the app's own module-scope
// `(cb) => requestAnimationFrame(cb)` picks up the wrapper. Timestamps rather
// than a counter, so a burst can be told from a steady drip.
const RAF_PROBE = `(() => {
  const raf = window.requestAnimationFrame.bind(window);
  window.__rafLog = [];
  window.requestAnimationFrame = (cb) => raf((t) => { window.__rafLog.push(performance.now()); return cb(t); });
})();`;

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor((s.length - 1) / 2)] : null;
};
const r1 = (n) => (n == null ? null : Math.round(n * 10) / 10);

async function evaluate(dt, s, expression) {
  const r = await dt.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, s);
  if (r.exceptionDetails) throw new Error('page: ' + r.exceptionDetails.text);
  return r.result.value;
}

async function waitFor(dt, s, expression, label, timeout = 60000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (await evaluate(dt, s, `Boolean(${expression})`)) return;
    await sleep(60);
  }
  throw new Error(`timed out waiting for ${label}`);
}

const READ_MARKS = `(() => {
  const nav = performance.getEntriesByType('navigation')[0] ?? null;
  const named = {};
  for (const e of performance.getEntries()) {
    if (!e.name.startsWith('vacant:')) continue;
    named[e.name] = e.entryType === 'measure' ? e.duration : e.startTime;
  }
  const res = {};
  for (const e of performance.getEntriesByType('resource')) {
    res[e.name.split('/').pop()] = {
      start: e.startTime,
      responseEnd: e.responseEnd,
      encoded: e.encodedBodySize,
      decoded: e.decodedBodySize,
    };
  }
  return { named, res, docResponseEnd: nav ? nav.responseEnd : null };
})()`;

// Wait for the screen to hold still, then count what the app asks for after it.
//
// The ask screen never holds still, and that is not a bug: render() keeps
// returning true while `!state.settled`, which is the flyover. settle() runs
// inside answer(), so the caller has to tap a duration first or this waits
// forever. The cap is there so that if the app ever stops settling this reports
// it instead of hanging the run.
const COUNT_FRAMES = `(async () => {
  const log = window.__rafLog;
  let n = log.length;
  let settled = false;
  for (let i = 0; i < ${QUIET_TRIES}; i++) {
    await new Promise((r) => setTimeout(r, ${QUIET_MS}));
    if (log.length === n) { settled = true; break; }
    n = log.length;
  }
  const before = log.length;
  const t0 = performance.now();
  await new Promise((r) => setTimeout(r, ${COUNT_MS}));
  return { settled, total: log.length, idle: log.length - before, over: performance.now() - t0 };
})()`;

// A tap, the way scripts/shoot.mjs does it. Input.dispatchTouchEvent is the
// obvious call and it never returns while the map's loop is running.
async function tap(dt, s, selector) {
  const box = await evaluate(
    dt,
    s,
    `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`,
  );
  if (!box) throw new Error(`nothing matches ${selector}`);
  const at = { x: box.x, y: box.y, button: 'left', clickCount: 1 };
  await dt.send('Input.dispatchMouseEvent', { ...at, type: 'mouseMoved', buttons: 0 }, s);
  await dt.send('Input.dispatchMouseEvent', { ...at, type: 'mousePressed', buttons: 1 }, s);
  await sleep(40);
  await dt.send('Input.dispatchMouseEvent', { ...at, type: 'mouseReleased', buttons: 0 }, s);
}

// One cold launch, in its own browser, at one throttling rate.
async function once(url, origin, rate) {
  const chrome = await launch();
  try {
    const res = await fetch(`http://127.0.0.1:${chrome.port}/json/version`);
    const { webSocketDebuggerUrl } = await res.json();
    const dt = await Devtools.open(webSocketDebuggerUrl);
    await dt.send('Browser.grantPermissions', { origin, permissions: ['geolocation'] });

    const { targetId } = await dt.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId: s } = await dt.send('Target.attachToTarget', { targetId, flatten: true });
    // Headless Chrome gives a background tab no animation frames, so an
    // unactivated target would report an idle loop for the wrong reason.
    await dt.send('Target.activateTarget', { targetId });

    await dt.send('Page.enable', {}, s);
    await dt.send('Runtime.enable', {}, s);
    await dt.send('Network.enable', {}, s);
    await dt.send('Network.setCacheDisabled', { cacheDisabled: true }, s);
    await dt.send(
      'Emulation.setDeviceMetricsOverride',
      {
        width: SCREEN.width,
        height: SCREEN.height,
        deviceScaleFactor: SCREEN.dpr,
        mobile: true,
        screenWidth: SCREEN.width,
        screenHeight: SCREEN.height,
      },
      s,
    );
    await dt.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }, s);
    await dt.send('Emulation.setUserAgentOverride', { userAgent: UA, platform: 'iPhone' }, s);
    await dt.send('Emulation.setTimezoneOverride', { timezoneId: TZ }, s);
    await dt.send('Emulation.setGeolocationOverride', WHERE, s);
    await dt.send('Page.addScriptToEvaluateOnNewDocument', { source: RAF_PROBE }, s);
    await dt.send(
      'Page.addScriptToEvaluateOnNewDocument',
      { source: pinnedClockSource(WHEN, { animation: false }) },
      s,
    );
    await dt.send('Emulation.setCPUThrottlingRate', { rate }, s);

    await dt.send('Page.navigate', { url }, s);
    // Optional chaining, not a bare getElementById. Page.navigate resolves when
    // the navigation begins, so at 6x the first few polls still land on
    // about:blank and a bare lookup throws instead of answering "not yet".
    await waitFor(dt, s, `document.getElementById('ask')?.classList.contains('ready')`, 'the app to boot');

    const marks = await evaluate(dt, s, READ_MARKS);

    // Read the boot marks first, then ask for an answer. The frame count is
    // about the screen a student is left looking at, which is the list.
    await tap(dt, s, '.opt[data-min="120"]');
    await waitFor(dt, s, `document.getElementById('list')?.children.length > 0`, 'the list to paint');
    const frames = await evaluate(dt, s, COUNT_FRAMES);
    return { rate, marks, frames };
  } finally {
    chrome.child.kill();
  }
}

// The lever neither #29 nor its revision comment names. boot() awaits
// current.json before it can ask for the room index, because current.json is
// the file that names the index. On localhost that wait is a few ms and reads
// like nothing; on cellular it is a whole round trip in front of the biggest
// file the first answer needs.
function pointerCost(res, current) {
  const cur = res['current.json'];
  const idx = res[(current.rooms ?? '').split('/').pop()];
  if (!cur || !idx) return null;
  const campus = res['campus.json'];
  return {
    currentStart: cur.start,
    currentRoundTrip: cur.responseEnd - cur.start,
    indexStart: idx.start,
    // What the index request waited on the pointer for: everything between
    // asking for current.json and asking for the file it names.
    blockedOnPointer: idx.start - cur.start,
    // campus.json is fired and never awaited, so it should start beside
    // current.json rather than after it. This is the check on that claim.
    campusStart: campus ? campus.start : null,
  };
}

function report(out, current) {
  const head = ['rate', 'ready ms', 'parse ms', 'parse/ready', 'pointer ms', 'of it network', 'idle rAF', 'window ms'];
  const table = [head];
  for (const rate of RATES) {
    const rows = out.filter((r) => r.rate === rate);
    if (!rows.length) continue;
    const ready = rows.map((r) => r.marks.named['vacant:ready']);
    const parse = rows.map((r) => r.marks.named['vacant:parse']);
    const ptr = rows.map((r) => pointerCost(r.marks.res, current)?.blockedOnPointer).filter((n) => n != null);
    // The pointer wait splits in two: current.json's own round trip, and the
    // JS between its arrival and the index request. Only the first grows on a
    // phone's link; only the second grows with throttling.
    const ptrNet = rows.map((r) => pointerCost(r.marks.res, current)?.currentRoundTrip).filter((n) => n != null);
    const idle = rows.map((r) => r.frames.idle);
    const win = rows.map((r) => r.frames.over);
    // Median and range on every column. One sample is noise and a mean would
    // hide the run that took twice as long as the others.
    const span = (xs, d = r1) => `${d(median(xs))} (${d(Math.min(...xs))} to ${d(Math.max(...xs))})`;
    table.push([
      `${rate}x`,
      span(ready),
      span(parse),
      `${((median(parse) / median(ready)) * 100).toFixed(1)}%`,
      span(ptr),
      span(ptrNet),
      span(idle, (n) => String(n)),
      span(win),
    ]);
  }
  const width = head.map((_, i) => Math.max(...table.map((row) => row[i].length)) + 2);
  console.log('');
  for (const row of table) console.log(row.map((cell, i) => cell.padEnd(width[i])).join('').trimEnd());

  const first = pointerCost(out[0].marks.res, current);
  if (first) {
    console.log('');
    console.log(
      `campus.json is asked for at ${r1(first.campusStart)} ms and current.json at ${r1(first.currentStart)} ms, ` +
        `so campus.json does not gate the index.`,
    );
    console.log(
      `The index is not asked for until ${r1(first.indexStart)} ms, after current.json's ` +
        `${r1(first.currentRoundTrip)} ms round trip. Those are localhost milliseconds.`,
    );
  }
  const unsettled = out.filter((r) => !r.frames.settled).length;
  console.log('');
  console.log(`${out.length} runs, ${RUNS} per rate, each in its own browser process, HTTP cache disabled.`);
  console.log(
    `idle rAF is what the app asked for over the window, after the list had stopped moving. ` +
      `The window overshoots ${COUNT_MS} ms because throttling delays the timer that closes it.`,
  );
  if (unsettled) console.log(`${unsettled} run(s) never went quiet, so their frame counts are not idle counts.`);
}

async function run() {
  const current = JSON.parse(await readFile(path.join(ROOT, 'data', 'current.json'), 'utf8'));
  const server = await serve(ROOT, PORT);
  const port = server.address().port;
  const origin = `http://localhost:${port}`;
  const url = `${origin}/Vacant/`;

  const out = [];
  try {
    for (const rate of RATES) {
      for (let i = 0; i < RUNS; i++) {
        const r = await once(url, origin, rate);
        out.push(r);
        if (AS_JSON) continue;
        const p = pointerCost(r.marks.res, current);
        console.log(
          `${rate}x run ${i + 1}  ready ${r1(r.marks.named['vacant:ready'])} ms` +
            `  parse ${r1(r.marks.named['vacant:parse'])} ms` +
            `  pointer ${p ? r1(p.blockedOnPointer) : '-'} ms` +
            `  idle frames ${r.frames.idle} in ${r1(r.frames.over)} ms`,
        );
      }
    }
  } finally {
    server.close();
  }

  if (AS_JSON) console.log(JSON.stringify(out, null, 1));
  else report(out, current);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
