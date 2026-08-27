// Vacant. One question, then an answer.
//
// Cold start:
//   the question paints immediately, before any data
//   campus drifts underneath while the index parses and geolocation resolves
//   you tap a duration (or it is remembered) and the map settles on you
//
// The flyover is the LOADING STATE, not a gate. It must never add a second to
// the time from tap to answer.

import { decodeFeature, toGrid } from './campus.js';
import { rank } from './engine.js';
import { SETTLED_SPAN, buildBasemap, drawFrame, drawTarget, drawYou, makeView } from './map.js';

const BASE = new URL('.', import.meta.url).pathname.replace(/js\/$/, '');
const KEY = 'vacant:duration';

// Off-campus is a real state, not an error. Beyond this from the map centre the
// app cannot honestly rank anything by walk time.
const OFF_CAMPUS_KM = 8;

// iOS documents its own geolocation timeout as unreliable in a standalone
// window, so a wall-clock watchdog runs beside it. Without this a bare await
// can hang forever with the user staring at a drifting map.
const FIX_TIMEOUT_MS = 8000;

// A room that frees up soon is a real fallback, which is what the README's
// ladder asks for. A room that frees up in seven hours is not an answer, it is
// a timetable. Past this wait the app says nothing is open rather than filling
// the list with tomorrow morning.
const MAX_WAIT_MIN = 90;

const $ = (id) => document.getElementById(id);

const state = {
  campus: null,
  basemap: null,
  view: null,
  rooms: null,
  buildings: null,
  hoursTerm: null,
  current: null,
  origin: null,
  accuracy: null,
  originIsGuess: true,
  needed: Number(safeGet(KEY)) || 30,
  results: [],
  soonest: null,
  selected: null,
  settled: false,
  ready: false,
};

function safeGet(k) {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function safeSet(k, v) {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* private mode; a remembered duration is not worth an error */
  }
}

const clock = (m) => {
  const h24 = Math.floor(m / 60) % 24;
  const mm = String(Math.floor(m) % 60).padStart(2, '0');
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h}:${mm}${h24 < 12 ? 'am' : 'pm'}`;
};
const dur = (m) => (m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}` : `${m} min`);
const isoDate = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// ---------------------------------------------------------------- rendering

let raf = 0;
let flyoverStart = 0;
let lastSize = { w: 0, h: 0, dpr: 0 };
const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// Assigning canvas.width or .height reallocates the backing store and resets
// every context property, even when the value is unchanged. Doing that per
// frame on a DPR-2 phone reallocates a full viewport bitmap sixty times a
// second, which is the cost the offscreen basemap exists to avoid.
function surface() {
  const c = $('map');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = c.clientWidth;
  const h = c.clientHeight;
  if (w !== lastSize.w || h !== lastSize.h || dpr !== lastSize.dpr) {
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    lastSize = { w, h, dpr };
  }
  return { ctx: c.getContext('2d'), width: w, height: h, dpr };
}

function render(now) {
  raf = requestAnimationFrame(render);
  if (!state.basemap) return;
  const { ctx, width, height, dpr } = surface();

  if (!state.settled) {
    // Slow drift over campus. Nothing here is on the critical path: it is what
    // the unavoidable wait looks like.
    const t = reduceMotion ? 0 : (now - flyoverStart) / 1000;
    const g = state.campus.grid;
    state.view = makeView({
      cx: g * (0.5 + Math.sin(t * 0.08) * 0.1),
      cy: g * (0.5 + Math.cos(t * 0.06) * 0.08),
      span: 1.05 + Math.sin(t * 0.05) * 0.05,
      rotation: reduceMotion ? 0 : Math.sin(t * 0.03) * 0.08,
    });
  }

  drawFrame(ctx, state.basemap, state.view, { width, height, dpr });
  if (!state.settled || !state.selected) return;

  const b = state.buildings[state.selected.building];
  const target = b ? toGrid([b.lon, b.lat], state.campus) : null;
  const you = state.origin ? toGrid([state.origin.lon, state.origin.lat], state.campus) : null;

  drawTarget(
    ctx,
    {
      footprint: footprintNear(target),
      from: you,
      to: target,
      label: `${state.selected.walk} min walk`,
      dpr,
      width,
      height,
    },
    state.basemap,
    state.view,
  );

  if (!you) return;
  const scale = Math.min(width, height) / (state.view.span * state.basemap.size);
  const gridPerMetre = state.campus.grid / ((state.campus.bbox[3] - state.campus.bbox[1]) * 111000);
  drawYou(
    ctx,
    {
      at: you,
      accuracyPx: (state.accuracy ?? 0) * gridPerMetre * state.basemap.sy * scale,
      guess: state.originIsGuess,
      dpr,
      width,
      height,
    },
    state.basemap,
    state.view,
  );
}

// The map layers carry no attributes, so the footprint for a building is found
// by proximity to its known centroid.
let footprintIndex = null;
function footprintNear(gridPt) {
  if (!gridPt || !state.campus) return null;
  if (!footprintIndex) {
    footprintIndex = state.campus.layers.building.map((f) => {
      const rings = decodeFeature(f);
      let x = 0;
      let y = 0;
      for (const p of rings[0]) {
        x += p[0];
        y += p[1];
      }
      return { rings, c: [x / rings[0].length, y / rings[0].length] };
    });
  }
  let best = null;
  let bestD = Infinity;
  for (const f of footprintIndex) {
    const d = Math.hypot(f.c[0] - gridPt[0], f.c[1] - gridPt[1]);
    if (d < bestD) {
      bestD = d;
      best = f;
    }
  }
  // Roughly 120 m in grid steps. Beyond that it is a different building.
  return bestD < state.campus.grid * 0.045 ? best.rings : null;
}

function settle() {
  if (!state.origin || !state.campus) return;
  const [cx, cy] = toGrid([state.origin.lon, state.origin.lat], state.campus);
  state.view = makeView({ cx, cy, span: SETTLED_SPAN, rotation: 0 });
  state.settled = true;
  $('map').classList.add('settled');
}

// ---------------------------------------------------------------- answering

// The term the app is SERVING, not whichever table happens to be biggest.
// Picking the fullest one worked only because Autumn has 47 buildings against
// Summer's 46; during Summer term it would have ranked every room against
// Autumn's hours, and Sullivant would have read open until 19:30 when Summer
// publishes 17:00. That is the assumed-window failure the engine forbids.
function pickHoursTerm(hours, current) {
  const want = (current?.termName ?? '').toLowerCase().replace(/\s+/g, '-');
  const terms = Object.entries(hours?.terms ?? {});
  const exact = terms.find(([slug]) => slug.startsWith(want));
  if (exact) return exact[1];
  // No table for the live term. Every building then reports unknown hours,
  // which is honest, rather than borrowing another term's doors.
  console.warn(`Vacant: no published hours for ${current?.termName}; all buildings will read unknown.`);
  return null;
}

function hoursFor(code, day) {
  const rec = state.hoursTerm?.buildings?.[code];
  if (!rec) return undefined; // no published hours: shown, tiered below, never assumed
  return rec.hours[day]; // an [open, close] pair, or null for published-closed
}

function answer() {
  if (!state.ready) return;
  const now = new Date();
  const minutes = now.getHours() * 60 + now.getMinutes();
  const results = rank(
    Object.entries(state.rooms.rooms).map(([id, r]) => ({ id, ...r })),
    {
      origin: state.origin,
      now: minutes,
      day: now.getDay(),
      needed: state.needed,
      buildings: state.buildings,
      hoursFor,
      sessions: state.rooms.sessions,
      date: isoDate(now),
    },
  );

  const usable = results.filter((r) => r.wait <= MAX_WAIT_MIN);
  // rank() orders by tier, then walk. The FIRST building to open is not the
  // nearest one that opens: at 6am the nearest might open at 9:00 while one a
  // minute further opens at 7:00, and naming the wrong one is a wrong answer.
  state.soonest = results
    .filter((r) => r.wait > MAX_WAIT_MIN)
    .reduce((a, b) => (a && a.availableAt <= b.availableAt ? a : b), null);
  state.results = usable.slice(0, 40);
  state.selected = state.results[0] ?? null;
  paintList();
  settle();
}

function paintList() {
  const list = $('list');
  const head = $('head');

  if (!state.results.length) {
    head.textContent = 'Nothing open right now';
    const next = state.soonest;
    list.innerHTML = next
      ? `<p class="empty">Every classroom building near you is closed.
         The first one open is <b>${next.name ?? next.id}</b> at <b>${clock(next.availableAt)}</b>.</p>`
      : `<p class="empty">No room is free for ${dur(state.needed)} today. Try a shorter time.</p>`;
    return;
  }

  // Four states, because "open and long enough", "open but shorter than you
  // asked", "we do not know" and "nothing" are different answers, and only the
  // first one is a promise.
  let caveat = '';
  const meets = state.results.filter((r) => r.hoursKnown && r.wait === 0 && r.meetsNeed).length;
  const shorter = state.results.filter((r) => r.hoursKnown && r.wait === 0).length;
  const waiting = state.results.filter((r) => r.hoursKnown && r.wait > 0).length;

  if (meets) {
    head.innerHTML = `Free for <b>${dur(state.needed)}</b>, nearest first`;
  } else if (shorter) {
    // The headline must not promise a duration the rows do not deliver.
    head.innerHTML = `Nothing free for <b>${dur(state.needed)}</b> &middot; closest anyway`;
  } else if (waiting) {
    head.innerHTML = `Nothing free this second &middot; <b>${dur(state.needed)}</b>`;
  } else {
    // Every building whose hours we actually have is closed. What is left is
    // rooms nobody publishes hours for, and saying "free" about those would be
    // the exact dishonesty this app exists to avoid.
    head.textContent = 'Every building we have hours for is closed';
    caveat = `<p class="empty">These have <b>no published hours</b>, so Vacant cannot tell
       you whether the door is open. They are not a promise.</p>`;
  }

  list.innerHTML =
    caveat +
    state.results
      .map((r, i) => {
        const seats = r.seats ? `${r.seats} seats` : 'seats unknown';
        const when =
          r.wait > 0
            ? `<span class="warn">from ${clock(r.availableAt)}</span>`
            : r.hoursKnown
              ? `yours for ${dur(r.usable)}`
              : '<span class="warn">hours not published</span>';
        return `<button class="row${i === 0 ? ' on' : ''}" data-i="${i}">
        <span class="name">${r.id}<em>${r.name ?? ''}</em></span>
        <span class="meta"><b>${r.walk} min</b> walk &middot; ${when} &middot; ${seats}</span>
      </button>`;
      })
      .join('');

  for (const el of list.querySelectorAll('.row')) {
    el.onclick = () => {
      state.selected = state.results[Number(el.dataset.i)];
      for (const o of list.querySelectorAll('.row')) o.classList.remove('on');
      el.classList.add('on');
    };
  }
}

// ---------------------------------------------------------------- geolocation

function locate() {
  const oval = { lon: -83.013, lat: 39.9995 };
  return new Promise((resolve) => {
    let done = false;
    const finish = (origin, accuracy, guess, note) => {
      if (done) return;
      done = true;
      resolve({ origin, accuracy, guess, note });
    };
    // The wall-clock watchdog. iOS documents its own timeout option as
    // unreliable in a standalone window.
    const watchdog = setTimeout(
      () => finish(oval, null, true, 'Location timed out, showing from the Oval'),
      FIX_TIMEOUT_MS,
    );
    if (!navigator.geolocation) {
      clearTimeout(watchdog);
      return finish(oval, null, true, 'No location on this device, showing from the Oval');
    }
    navigator.geolocation.getCurrentPosition(
      (p) => {
        clearTimeout(watchdog);
        const here = { lon: p.coords.longitude, lat: p.coords.latitude };
        const far = Math.hypot((here.lon - oval.lon) * 85, (here.lat - oval.lat) * 111) > OFF_CAMPUS_KM;
        if (far) return finish(oval, null, true, 'You are off campus, showing from the Oval');
        finish(here, p.coords.accuracy, false, null);
      },
      (err) => {
        clearTimeout(watchdog);
        const why =
          err.code === 1
            ? 'Location is off'
            : err.code === 2
              ? 'Location unavailable'
              : 'Location timed out';
        finish(oval, null, true, `${why}, showing from the Oval`);
      },
      { enableHighAccuracy: false, timeout: FIX_TIMEOUT_MS, maximumAge: 60000 },
    );
  });
}

// ---------------------------------------------------------------- boot

async function boot() {
  const json = (f) => fetch(`${BASE}data/${f}`).then((r) => r.json());

  flyoverStart = performance.now();
  raf = requestAnimationFrame(render);

  // Geolocation starts immediately and runs beside the fetches, so the two
  // waits overlap instead of queueing.
  const fix = locate();

  const [campus, current] = await Promise.all([json('campus.json'), json('current.json')]);
  state.campus = campus;
  state.current = current;
  state.basemap = buildBasemap(campus, 0.014);
  $('term').textContent = current.termName;

  const [rooms, buildings, hours, located] = await Promise.all([
    fetch(`${BASE}${current.rooms}`).then((r) => r.json()),
    json('buildings.json').then((d) => d.buildings),
    json('buildings-hours.json'),
    fix,
  ]);
  state.rooms = rooms;
  state.buildings = buildings;
  state.hoursTerm = pickHoursTerm(hours, current);
  state.origin = located.origin;
  state.accuracy = located.accuracy;
  state.originIsGuess = located.guess;
  if (located.note) {
    $('note').textContent = located.note;
    $('note').hidden = false;
  }

  state.ready = true;
  for (const el of document.querySelectorAll('#ask [disabled]')) el.disabled = false;
  $('ask').classList.add('ready');
  performance.mark('vacant:ready');
}

function choose(minutes) {
  // Belt and braces. The controls carry `disabled` until boot() finishes, but a
  // caller reaching here early would read state.rooms as null and throw.
  if (!state.ready) return;
  state.needed = minutes;
  safeSet(KEY, String(minutes));
  $('ask').hidden = true;
  $('sheet').hidden = false;
  answer();
}

window.addEventListener('DOMContentLoaded', () => {
  for (const b of document.querySelectorAll('[data-min]')) {
    b.onclick = () => choose(Number(b.dataset.min));
  }
  $('until').onchange = (e) => {
    const [h, m] = e.target.value.split(':').map(Number);
    const now = new Date();
    const mins = h * 60 + m - (now.getHours() * 60 + now.getMinutes());
    if (mins > 0) choose(mins);
  };
  $('again').onclick = () => {
    $('sheet').hidden = true;
    $('ask').hidden = false;
    state.settled = false;
    $('map').classList.remove('settled');
    flyoverStart = performance.now();
  };
  boot().catch(() => {
    $('note').textContent = 'Could not load the schedule. Check your connection and reload.';
    $('note').hidden = false;
  });
});
