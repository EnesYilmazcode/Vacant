// Vacant. One question, then an answer.
//
// Boot order. Nothing may be inserted above step 5 that waits on a network or
// on a position, because the first paint is what the app is judged on and a
// cold phone on outdoor LTE has neither:
//
//   1  shell and question paint out of index.html    no network, no fix
//   2  read data/current.json -> term code
//   3  parse rooms-<term>.json and the term's building slice
//   4  getCurrentPosition, started at step 2 so the two waits overlap
//   5  fix arrives -> rank -> render the list
//
// The flyover is the LOADING STATE, not a gate. It must never add a second to
// the time from tap to answer.
//
// Screens, all of them one sheet over one map: the question, the ranked list,
// one room, the buildings screen for the hours no class covers, the building
// picker, and what the app believes. The sheet routes between them so the map,
// the highlight and the line stay on screen while you read.

import { toGrid } from './campus.js';
import { roomClaim } from './claim.js';
import { blocksOn, classesOn, dayClaim } from './day.js';
import { MAX_WALK, activeSessions, calendarOn, distanceMetres, mark, measure, rank, shape, walkMinutes } from './engine.js';
// The deadline every request on the path to a first answer shares. It lives in
// js/firstrun.js because that is the module holding the rule it comes from.
import { NETWORK_TIMEOUT_MS } from './firstrun.js';
import { mapsHref } from './install.js';
import {
  busyDayOf,
  clock,
  clockIsPinned,
  closedDayFor,
  diagnosticsBlock,
  dur,
  inScheduledHours,
  inTermOn,
  isoDate,
  nextOpening,
  now as clockNow,
  openDoorCount,
  openingPhrase,
  pinClock,
  rankBuildings,
  resolveState,
  roomsPerBuilding,
  spokenClock,
  staleness,
  unscheduledGate,
  windowPhrase,
} from './state.js';
import {
  FLYOVER_SPAN,
  SETTLED_SPAN,
  attachGestures,
  buildBasemap,
  clampView,
  createFrameLoop,
  drawFrame,
  drawTarget,
  drawYou,
  fitPair,
  footprintFor,
  makeView,
  panBy,
  pixelsPerGridFor,
  zoomBy,
} from './map.js';
import { FULL, PEEK, bandFor, floorFor, openAt, restFor, sheetAfterDrag } from './sheet.js';

const BASE = new URL('.', import.meta.url).pathname.replace(/js\/$/, '');

// Finder shares this origin, so the prefix is not optional.
const KEY_DURATION = 'vacant.duration';
const KEY_ORIGIN = 'vacant.origin';
const KEY_PICK = 'vacant.lastPick';

// Off-campus is a real state, not an error. Beyond this from the map centre the
// app cannot honestly rank by walk time. A first cut only: answer() asks the
// question this circle stands in for and falls back on that instead.
//
// MEASURED, and it is a line about walking, not about where campus ends. The
// farthest building holding a ranked classroom is Animal Science at 1.410 km
// from the Oval, MAX_WALK reaches 0.720 km of straight line, so nothing is
// walkable past 2.130 km, and a 360 bearing sweep in 10 m steps agrees to
// within one step. The 8 that shipped was nearly four times it, never go below.
//
// The comparison is a flat lat/lon conversion, not the engine's equirectangular
// distanceMetres: 0.2% here, 4.42 km against 4.43 at the issue #60 origin.
//
// It must never be read as "you are not on campus". Seven of the 96 buildings
// in data/buildings-1268.json sit outside it, all seven are OSU property, and
// the farthest is Aerospace Research Center at 10.01 km. That is why the note
// it prints is about the walk.
const OFF_CAMPUS_KM = 2.2;

// The fallback origin, and the sentence both screens that reach for it print:
// the gate below when the fix lands too far out, answer() when the ranking
// comes back with nothing walkable.
const OVAL = { lat: 39.9995, lon: -83.013 };
const ovalOrigin = () => ({ ...OVAL, accuracy: null, source: 'oval', label: 'the Oval', at: Date.now() });
const NO_WALK = 'No classroom close enough to walk to';
const NO_WALK_OVAL = `${NO_WALK}, showing from the Oval`;

// iOS documents its own geolocation timeout as unreliable in a standalone
// window, so a wall-clock watchdog runs beside it. Without this a bare await
// can hang forever with the user staring at a drifting map.
const FIX_TIMEOUT_MS = 8000;

// A room that frees up soon is a real fallback, which is what the README's
// ladder asks for. A room that frees up in seven hours is not an answer, it is
// a timetable. Past this wait the app says nothing is open rather than filling
// the list with tomorrow morning.
const MAX_WAIT_MIN = 90;

// A picked building is a point in the middle of a footprint, and the door is
// somewhere on its edge. Half a footprint is about this, and it sits under the
// 75 m coarse-fix line so the accuracy banner stays off for a choice the user
// made deliberately.
const PICKED_ACCURACY_M = 50;

// Places students stand rather than places classes meet, so this list is
// codes and not names: the label is read out of the shipped building table, and
// a code that leaves the table renders nothing instead of a dead button.
const SHORTCUTS = ['161', '050', '246', '005', '279', '274'];

// Where campus actually is, as a fraction of the map's bounding box. Measured
// from the shipped data: the room-weighted centroid of buildings holding ranked
// classrooms is x 0.661, and the Oval, the geolocation fallback, is x 0.723.
const CORE_X = 0.661;
const CORE_Y = 0.5;

// PEEK, FULL, ROOM_SHEET, REST and the dismiss travel live in js/sheet.js, where
// the suite can check them as numbers rather than as source.

// A fix this coarse turns every walk time into an estimate, so the row says
// "~4 min" and the accessible name says "about 4 minutes".
const COARSE_M = 75;

// Passing periods are 15 minutes and 40% of a day's free blocks are under 20,
// so a row each fills the room screen with corridor traffic. Anything shorter
// than this is drawn as a rule between two classes instead.
const SEAM_MIN = 20;

const COMPASS = ['north', 'north east', 'east', 'south east', 'south', 'south west', 'west', 'north west'];

const $ = (id) => document.getElementById(id);

const state = {
  campus: null,
  basemap: null,
  view: null,
  band: null,
  userMoved: false,
  rooms: null,
  buildings: null,
  counts: null,
  shorts: null,
  hours: null,
  hoursTerm: null,
  hoursSlug: null,
  current: null,
  origin: null,
  // Dev mode. Off for everyone who did not ask for it, and the only thing in
  // the app that reads it is which location controls exist.
  dev: false,
  accuracy: null,
  originIsGuess: true,
  duration: safeGet(KEY_DURATION) ?? '30',
  needed: 30,
  results: [],
  total: 0,
  // What shape() removed to get from the ranked rows to the shown ones, which
  // neither the footer nor the empty screen can work out from state.results.
  bounds: null,
  day: clockNow().getDay(),
  soonest: null,
  selected: null,
  settled: false,
  ready: false,
  rankable: false,
  scheduled: true,
  situation: null,
  groups: null,
  query: '',
  includeLocation: false,
  screen: 'ask',
  listScroll: 0,
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
function safeDel(k) {
  try {
    localStorage.removeItem(k);
  } catch {
    /* same */
  }
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => `&${{ '&': 'amp', '<': 'lt', '>': 'gt', '"': 'quot' }[c]};`);

const say = (text) => {
  $('say').textContent = text;
};

// The only announcement that is not the result count. A screen that refuses has
// nothing to count, and a message nobody's focus lands on is a message nobody
// reads. focusVisible keeps the ring meant for controls off it; index.html says
// why, and carries the fallback for an engine that drops the option.
function focusHeading(el) {
  if (!el) return;
  el.setAttribute('tabindex', '-1');
  el.focus({ preventScroll: true, focusVisible: false });
}

// ---------------------------------------------------------------- rendering

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
  return c.getContext('2d');
}

// The install rail stands the sheet on top of it, so the map has that much less
// again. Read off the custom property js/install.js writes rather than off a
// rect, for the same reason viewport() is cached.
const railHeight = () => parseFloat(document.body.style.getPropertyValue('--bar-h')) || 0;

// The map's viewport is not the canvas box. `band` is the strip of canvas the
// sheet is not covering, and the map centres on the middle of THAT, which is
// what puts the you-dot back on screen.
//
// It is the strip at the screen's RESTING height, not at the sheet's current
// one, and REST is where that height is written down.
// `band` feeds both the vertical centring and the zoom, through
// `Math.min(width, band)` in js/map.js, so tracking the live drag meant the map
// zoomed out and slid upward under the thumb every time the sheet was pulled
// up. That is a map redrawing itself in response to a gesture that was not
// about the map. Freezing it at the resting layout makes the sheet slide OVER a
// map that stays where it was, which is what every map app does and what the
// gesture already looks like it is doing.
//
// Cached rather than measured, because reading the sheet's rect inside the
// frame loop forces layout sixty times a second.
function viewport() {
  const width = lastSize.w || window.innerWidth;
  const height = lastSize.h || window.innerHeight;
  return {
    width,
    height,
    band: bandFor(state.screen, height, railHeight()),
    dpr: lastSize.dpr || Math.min(window.devicePixelRatio || 1, 2),
  };
}

// One frame, and the answer to whether there needs to be another one.
//
// It used to re-request a frame on its first line whatever was on screen, which
// is what issue #75 caught: 290 callbacks in 2 seconds on a settled list with
// nothing selected, all painting the same pixels. Now the flyover is the only
// thing that asks for the next frame on its own, and everything else that
// changes what the map shows calls frames.wake() for a single one. Every one of
// those call sites is marked; miss one and the map silently keeps the old
// picture.
function render(now) {
  if (!state.basemap) return false;
  const ctx = surface();
  const vp = viewport();

  if (!state.settled && state.campus) {
    // Slow drift over campus. Nothing here is on the critical path: it is what
    // the unavoidable wait looks like.
    //
    // Centred on CORE_X, the room-weighted centroid of the buildings that
    // actually hold the ranked classrooms, measured at 0.661 with a median of
    // 0.663. The first attempt used 0.56 and put 51% of the ranked room stock
    // off screen, along with the Oval at 0.723, which is also the fallback
    // origin the map settles on.
    const t = reduceMotion ? 0 : (now - flyoverStart) / 1000;
    const g = state.campus.grid;
    state.view = makeView({
      cx: g * (CORE_X + Math.sin(t * 0.055) * 0.035),
      cy: g * (CORE_Y + Math.cos(t * 0.043) * 0.035),
      span: FLYOVER_SPAN + Math.sin(t * 0.05) * 0.02,
      rotation: reduceMotion ? 0 : Math.sin(t * 0.028) * 0.05,
    });
  }
  if (!state.view) return false;

  drawFrame(ctx, state.basemap, state.view, vp);

  const you = state.origin && state.campus ? toGrid([state.origin.lon, state.origin.lat], state.campus) : null;

  if (state.selected && state.campus) {
    const b = state.buildings?.[state.selected.building];
    const target = b ? toGrid([b.lon, b.lat], state.campus) : null;
    drawTarget(
      ctx,
      {
        footprint: footprintFor(state.campus, state.selected.building, target),
        from: you,
        to: target,
      },
      state.basemap,
      state.view,
      vp,
    );
  }

  // Your own position is not conditional on having picked a room. It draws in
  // every state, including the flyover and the empty list, and drawYou returns
  // on its own when there is no fix yet.
  drawYou(
    ctx,
    { at: you, accuracyM: state.accuracy ?? 0, guess: state.originIsGuess },
    state.basemap,
    state.view,
    vp,
  );

  // The drift over campus is the one thing on this canvas that moves by itself.
  // Under prefers-reduced-motion t is pinned to 0 above, so the flyover computes
  // the same view every frame and one paint is the whole of it.
  return !state.settled && Boolean(state.campus) && !reduceMotion;
}

// The loop, stopped whenever render() says nothing is moving.
const frames = createFrameLoop((cb) => requestAnimationFrame(cb), render);

function settle() {
  state.settled = true;
  $('map').classList.add('settled');
  frames.wake();
  if (!state.origin || !state.campus || !state.basemap || state.userMoved) return;
  const [cx, cy] = toGrid([state.origin.lon, state.origin.lat], state.campus);
  state.view = makeView({ cx, cy, span: SETTLED_SPAN, rotation: 0 });
}

// Put you and the building on screen together. Once a finger has moved the
// camera this stops firing, otherwise every row tap would undo the gesture.
function frame(r) {
  // Before the guards: a tap that does not move the camera still changes which
  // footprint is lit and where the line ends, and after a hand pan or on a
  // screen with no fix yet this function returns without touching the view.
  frames.wake();
  if (!state.basemap || !state.campus || state.userMoved || !state.origin) return;
  const b = state.buildings?.[r.building];
  if (!b || !Number.isFinite(b.lat) || !Number.isFinite(b.lon)) return;
  const you = toGrid([state.origin.lon, state.origin.lat], state.campus);
  const target = toGrid([b.lon, b.lat], state.campus);
  state.view = fitPair(you, target, state.basemap, viewport());
}

// ---------------------------------------------------------------- the sheet

const PANES = ['list', 'room', 'near', 'pick', 'about'];
let sheetH = 0;
// Which screen sheetH was measured on. A height dragged on the room screen is
// not the list's height, and viewport() reads the list's.
let sheetScreen = null;
// Assigned by attachSheet. Replacing a pane's markup resets its scrollTop
// without firing a scroll event, so the paint has to re-sync touch-action.
let syncPaneTouch = () => {};

function setSheet(px, snap) {
  const H = window.innerHeight;
  const h = Math.max(floorFor('grip', H), Math.min(FULL * H, px));
  sheetH = h;
  sheetScreen = state.screen;
  const sheet = $('sheet');
  sheet.classList.toggle('snap', Boolean(snap));
  sheet.style.height = `${Math.round(h)}px`;
}

function attachSheet() {
  const sheet = $('sheet');
  const handle = $('handle');
  const panes = PANES.map($);
  const pane = () => panes.find((el) => !el.hidden) ?? panes[0];
  let drag = null;
  let swallow = false;

  // A pane scrolled to its top has no downward scroll left, so the browser must
  // not claim the gesture. touch-action has to say that before the finger
  // lands, which means it tracks scrollTop rather than sitting in the sheet.
  const syncTouch = () => {
    for (const el of panes) el.style.touchAction = el.scrollTop > 0 ? 'pan-y' : 'none';
  };
  for (const el of panes) el.addEventListener('scroll', syncTouch, { passive: true });
  syncPaneTouch = syncTouch;
  syncTouch();

  const begin = (e, mode) => {
    swallow = false;
    drag = {
      id: e.pointerId,
      y0: e.clientY,
      h0: sheetH || sheet.getBoundingClientRect().height,
      lastY: e.clientY,
      lastT: e.timeStamp,
      v: 0,
      mode,
      // Fixed at the start: a pending drag becomes a sheet drag on the first
      // 8px and must not pick up the grip's reach on the way.
      from: mode === 'sheet' ? 'grip' : 'pane',
      dismiss: false,
      pane: pane(),
    };
  };

  const capture = (el, id) => {
    try {
      el.setPointerCapture(id);
    } catch {
      /* the pane may already own the capture; the move events still arrive */
    }
  };

  handle.addEventListener('pointerdown', (e) => {
    begin(e, 'sheet');
    capture(handle, e.pointerId);
    e.preventDefault();
  });

  sheet.addEventListener('pointerdown', (e) => {
    if (e.target.closest('#handle')) return;
    // The search field and the chips are controls, not surfaces to drag from.
    if (e.target.closest('#find, #chips')) return;
    begin(e, 'pending');
  });

  sheet.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dy = e.clientY - drag.y0;
    if (drag.mode === 'pending') {
      if (Math.abs(dy) < 8) return;
      // Already scrolled: the pane keeps the gesture, momentum and all.
      if (drag.pane.scrollTop > 0) {
        drag = null;
        return;
      }
      // At full height a pull upward is the list, not the sheet. touch-action
      // is none at the top, so that one scroll is driven by hand; the next is
      // native again because scrollTop is no longer zero.
      drag.mode = dy < 0 && drag.h0 >= FULL * window.innerHeight - 2 ? 'scroll' : 'sheet';
      capture(sheet, e.pointerId);
    }
    const dt = e.timeStamp - drag.lastT;
    if (dt > 0) drag.v = (e.clientY - drag.lastY) / dt;
    drag.lastY = e.clientY;
    drag.lastT = e.timeStamp;
    // A finger that dragged is not a finger that tapped a row.
    swallow = true;
    if (drag.mode === 'scroll') drag.pane.scrollTop = Math.max(0, -dy);
    else {
      const pulled = sheetAfterDrag(drag.h0, dy, drag.from, window.innerHeight);
      drag.dismiss = pulled.dismiss;
      setSheet(pulled.h, false);
    }
    e.preventDefault();
  });

  const end = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const mode = drag.mode;
    const v = drag.v;
    const dismiss = drag.dismiss;
    drag = null;
    syncTouch();
    if (mode !== 'sheet') return;
    const H = window.innerHeight;
    const peek = PEEK * H;
    const full = FULL * H;
    // The grip, pulled through the whole travel below peek. A drag that started
    // on a pane bottoms out AT peek, so it never gets here.
    if (dismiss) {
      setSheet(peek, true);
      toAsk();
      return;
    }
    // Velocity wins over position, which is what makes a short flick work.
    let target;
    if (v > 0.5) target = peek;
    else if (v < -0.5) target = full;
    else target = sheetH - peek < full - sheetH ? peek : full;
    setSheet(target, true);
  };

  sheet.addEventListener('pointerup', end);
  sheet.addEventListener('pointercancel', end);
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);

  // Pointer capture redirects pointer events but not the click a mouse still
  // synthesises, so without this a drag begun on a row would open that room.
  sheet.addEventListener(
    'click',
    (e) => {
      if (!swallow) return;
      swallow = false;
      e.stopPropagation();
      e.preventDefault();
    },
    true,
  );
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
  if (exact) return exact;
  // No table for the live term. Every building then reports unknown hours,
  // which is honest, rather than borrowing another term's doors.
  console.warn(`Vacant: no published hours for ${current?.termName}; all buildings will read unknown.`);
  return [null, null];
}

function hoursFor(code, day) {
  const rec = state.hoursTerm?.buildings?.[code];
  if (!rec) return undefined; // no published hours: shown, tiered below, never assumed
  return rec.hours[day]; // an [open, close] pair, or null for published-closed
}

const nowMinutes = (d) => d.getHours() * 60 + d.getMinutes();

// "rest of day" is not a constant. It is the minutes between now and the last
// minute the class schedule covers, read off the index, so a term whose
// evenings end at 20:15 does not get asked for a window running to 22:30.
function neededMinutes(now) {
  if (state.duration !== 'day') return Number(state.duration) || 30;
  const busyDay = busyDayOf(state.current, state.rooms);
  const left = busyDay ? busyDay.latestEnd - nowMinutes(now) : 0;
  return Math.max(30, left);
}

function answer() {
  // Whether the app may answer at all was settled before this ran, by
  // refusalFor() inside resolveState(). state.rankable is that verdict, and
  // deciding it again here is how one screen ends up offering 450 rooms while
  // the one behind it says nobody knows.
  if (!state.ready || !state.rankable) return;
  const now = clockNow();
  const minutes = nowMinutes(now);
  state.day = now.getDay();
  state.needed = neededMinutes(now);
  const rooms = Object.entries(state.rooms.rooms).map(([id, r]) => ({ id, ...r }));
  const date = isoDate(now);
  const results = rank(
    rooms,
    {
      origin: state.origin,
      now: minutes,
      day: state.day,
      needed: state.needed,
      buildings: state.buildings,
      hoursFor,
      sessions: state.rooms.sessions,
      date,
      // A day with no classes is a day the busy grid describes nobody. 2,048
      // of the 2,106 Wednesday blocks are still active on Veterans Day.
      classesSuspended: !!state.situation?.classesSuspended,
    },
  );

  const usable = results.filter((r) => r.wait <= MAX_WAIT_MIN);
  // rank() orders by tier, then walk. The FIRST building to open is not the
  // nearest one that opens: at 6am the nearest might open at 9:00 while one a
  // minute further opens at 7:00, and naming the wrong one is a wrong answer.
  // Off the unfiltered rows, not the shaped ones: after shape() this would say
  // "nothing is open" over the 180 rooms free further out at 2.18 km.
  state.soonest = results
    .filter((r) => r.wait > MAX_WAIT_MIN)
    .reduce((a, b) => (a && a.availableAt <= b.availableAt ? a : b), null);
  // The walk bound and the fold. rank() stays radius-free on purpose: the rows
  // shape() sets aside are the ones the footer and the empty screen name.
  state.bounds = shape(usable);
  state.total = usable.length;
  state.results = state.bounds.rows;

  // Nothing walkable from here, and rooms out there that are. OFF_CAMPUS_KM
  // draws a circle around this question and gets it wrong on both sides: Wed
  // 2026-09-02 14:10, a 30 minute ask, an origin 2.190 km out got no rows and
  // no control that leads anywhere, and one 20 m further out fell back to the
  // Oval and got 40 tappable rows.
  const stranded = !state.results.length && state.bounds.beyond.count > 0;
  if (stranded && state.origin?.source === 'gps') {
    useOrigin(ovalOrigin(), NO_WALK_OVAL);
    return answer();
  }
  // A picked building stands: moving off it answers a question nobody asked.
  // The note is that screen's way out, because it carries #note-pick.
  if (state.origin?.source === 'picked') useOrigin(state.origin, stranded ? NO_WALK : null);
  // Nothing is selected until a finger picks one. Asserting row one here is
  // what made the highlight fire on load and never move again.
  state.selected = null;
  state.listScroll = 0;
  paintList();
  settle();
  // Free is wait === 0, the word the rows and settle() spend. state.total holds
  // everything that cleared the 90 minute wait, so this line read "297 rooms
  // free, 0 shown" over a heading saying nothing was close enough.
  const free = usable.reduce((n, r) => n + (r.wait === 0 ? 1 : 0), 0);
  say(
    state.results.length
      ? `${free} room${free === 1 ? '' : 's'} free, ${state.results.length} shown.`
      : `${$('list-h')?.textContent ?? ''} ${$('list').querySelector('.empty')?.textContent.replace(/\s+/g, ' ').trim() ?? ''}`.trim(),
  );
}

// A name over 24 characters with a dash in it is the Registrar's
// "department - building" form, and the half after the dash is the half
// written on the door.
function shortName(name) {
  const s = String(name ?? '');
  const cut = s.indexOf(' - ');
  return s.length > 24 && cut > 0 ? s.slice(cut + 3) : s;
}

function roomLabel(r) {
  const n = state.rooms?.rooms?.[r.id]?.n;
  const name = shortName(r.name);
  if (!name) return r.id;
  return n ? `${name} ${n}` : name;
}

// When the building locks today, or null when nobody publishes it.
function closeOf(code) {
  const h = hoursFor(code, state.day);
  return Array.isArray(h) ? h[1] : null;
}

function windowOf(r) {
  const p = windowPhrase(r, closeOf(r.building));
  const warn = p.tier === 'wait' || p.tier === 'unknown';
  return { html: warn ? `<span class="warn">${p.text}</span>` : p.text, say: p.say };
}

function seatsOf(r) {
  return r.seats
    ? { html: `${r.seats} seats`, say: `${r.seats} seats` }
    : { html: 'seats unknown', say: 'seat count not published' };
}

// The one word docs/BACKLOG.md's parked decision asked for, and the reason the
// row is where it is: the room is not on the Registrar's general-assignment
// list, so a department holds the key. 98 of the 425 shipped rooms, and the
// ranking now puts every one of them below a general-assignment room. Written
// out for a screen reader, because "departmental" alone next to a seat count is
// a word with no sentence around it.
//
// A room the index says nothing about is not labelled: `ga` is absent from
// every room of an index built before the general-assignment pull, and a label
// on all 425 rows would say nothing at all.
//
// Plain text in the window line, not a `<b>`. `.r-win b` is `--fg` at weight
// 650 on a line that is otherwise `--dim`, and it exists for the free-window --
// the promise the row is making. windowOf and seatsOf emit plain text, so a
// bolded caveat would have been the ONLY emphasised token on the row: the
// reason the room ranks low, shouting over the reason it is on screen at all. A
// word among numbers, after the same middot the seat count uses, is already
// distinct enough. No class either: the one it carried was never styled
// anywhere in index.html, and a hook nothing reaches for is a hook that
// misleads the next person who greps for it.
function deptOf(r) {
  return r.ga === false
    ? { html: ' &middot; departmental', say: ', departmental, not a general-assignment room' }
    : { html: '', say: '' };
}

const WALK_ICON = '<svg class="ico" aria-hidden="true"><use href="#i-walk"/></svg>';
const CHEV = '<svg class="ico" aria-hidden="true"><use href="#i-chev"/></svg>';

const FOOT_ACTS = `<p class="foot-acts">
  <button type="button" class="bar-btn" data-act="recheck">Check again</button>
  <button type="button" class="bar-btn" data-act="about">What Vacant knows</button>
</p>`;

// One sentence, said once, at the bottom where a reader lands after the rows.
// A per-row version of this was tried and rejected: a warning repeated on 98
// rows stops being read by row four.
const CAVEAT = `<p class="foot">Class schedule only. Doors get locked and clubs book rooms, and a
  class scheduled with no room recorded does not appear here at all, so a room can be in use
  with nothing on its timeline.</p>`;

function paintList() {
  const list = $('list');
  const note = state.situation?.note
    ? `<p class="strip">${esc(state.situation.note)}</p>`
    : '';

  if (!state.results.length) {
    const next = state.soonest;
    // Rooms are free, they are just too far to walk to, which is a different
    // answer from "nothing is open" and one a shorter ask cannot fix. This is
    // the one screen that spends the word free on a count, so free here is
    // wait === 0 and the rooms that open later get their own sentence: at
    // 2026-09-15 09:00 from 40.0175, -83.013 it called Schoenbaum Hall the
    // nearest free room 115 minutes before the room opened.
    const far = state.bounds?.beyond;
    const later = far?.waiting;
    list.innerHTML =
      note +
      `<h2 class="msg" id="list-h" tabindex="-1">${far?.count || later?.count ? 'Nothing close enough.' : 'Nothing open right now.'}</h2>` +
      (far?.count
        ? `<p class="empty">Nothing within a ${MAX_WALK} minute walk is free.
           <b>${far.count} room${far.count === 1 ? '' : 's'}</b> ${far.count === 1 ? 'is' : 'are'} free further out, the nearest a
           <b>${far.nearest.walk} minute walk</b> to ${esc(shortName(far.nearest.name))}.</p>`
        : later?.count
          ? `<p class="empty">Nothing within a ${MAX_WALK} minute walk is free.
             <b>${later.count} room${later.count === 1 ? '' : 's'}</b> further out open${later.count === 1 ? 's' : ''} later, the nearest a
             <b>${later.nearest.walk} minute walk</b> to ${esc(shortName(later.nearest.name))}, from <b>${clock(later.nearest.availableAt)}</b>.</p>`
          : next
            ? `<p class="empty">Every classroom building near you is closed.
               The first one open is <b>${esc(next.name ?? next.id)}</b> at <b>${clock(next.availableAt)}</b>.</p>`
            : `<p class="empty">No room is free for ${dur(state.needed)} today. Try a shorter time.</p>`) +
      FOOT_ACTS;
    wireFootActs(list);
    focusHeading($('list-h'));
    syncPaneTouch();
    return;
  }

  // Four states, because "open and long enough", "open but shorter than you
  // asked", "we do not know" and "nothing" are different answers, and only the
  // first one is a promise. The first is 94.1% of measured hours and prints
  // nothing at all, so the strip is absent unless the answer is degraded.
  let strip = '';
  let caveat = '';
  const meets = state.results.filter((r) => r.hoursKnown && r.wait === 0 && r.meetsNeed).length;
  const shorter = state.results.filter((r) => r.hoursKnown && r.wait === 0).length;
  const waiting = state.results.filter((r) => r.hoursKnown && r.wait > 0).length;

  if (meets) {
    strip = '';
  } else if (shorter) {
    strip = `<p class="strip">Nothing near you is free for ${dur(state.needed)}. Closest anyway:</p>`;
  } else if (waiting) {
    strip = `<p class="strip">Nothing is free this second.</p>`;
  } else {
    // Every building whose hours we actually have is closed. What is left is
    // rooms nobody publishes hours for, and saying "free" about those would be
    // the exact dishonesty this app exists to avoid.
    strip = '<p class="strip">Every building we have hours for is closed.</p>';
    caveat = `<p class="empty">These have <b>no published hours</b>, so Vacant cannot tell
       you whether the door is open. They are not a promise.</p>`;
  }

  const coarse = Number.isFinite(state.accuracy) && state.accuracy > COARSE_M;
  // "N more further away" was wrong about most of them: 69.5% of the 40 the old
  // slice showed repeated a building already on screen, over 525 samples from
  // the Oval, every half hour 08:00 to 20:00 on the 22 September 2026 weekdays
  // at a 30 minute ask. Neither count below says free, so both count the rooms
  // that open later too.
  const rest = state.bounds?.cap.rest ?? 0;
  const past = state.bounds ? state.bounds.beyond.count + state.bounds.beyond.waiting.count : 0;
  const inside = rest ? `<b>${rest} more</b> within a ${MAX_WALK} minute walk` : '';
  const outside = past
    ? `<b>${past} more</b> ${rest ? 'past it' : `past a ${MAX_WALK} minute walk`}`
    : '';
  const foot = inside || outside
    ? `<p class="foot">${[inside, outside].filter(Boolean).join(', and ')}.</p>`
    : '';

  list.innerHTML =
    note +
    strip +
    caveat +
    state.results
      .map((r, i) => {
        const label = roomLabel(r);
        const win = windowOf(r);
        const seats = seatsOf(r);
        const dept = deptOf(r);
        const walkSay = coarse ? `about ${r.walk} minutes walk` : `${r.walk} minute walk`;
        // The visible row is glyphs and an icon. The name a screen reader gets
        // is written out, because the computed name would be "Page Hall 110B 4
        // min": no unit, no window, no caveat.
        const name = `${label}, ${walkSay}, ${win.say}, ${seats.say}${dept.say}. Class schedule only, the door may be locked.`;
        return `<button type="button" class="row" data-i="${i}" aria-label="${esc(name)}">
        <span class="r-name">${esc(label)}</span>
        <span class="r-walk">${WALK_ICON}${coarse ? '~' : ''}${r.walk} min</span>
        <span class="r-win">${win.html} &middot; ${seats.html}${dept.html}</span>
        <span class="r-chev"></span>
      </button>`;
      })
      .join('') +
    foot +
    CAVEAT +
    FOOT_ACTS;

  for (const el of list.querySelectorAll('.row')) {
    el.onclick = () => select(Number(el.dataset.i));
  }
  wireFootActs(list);
  markRows();
  syncPaneTouch();
}

function wireFootActs(root) {
  for (const el of root.querySelectorAll('[data-act]')) {
    el.onclick = () => {
      if (el.dataset.act === 'about') openAbout();
      else refresh();
    };
  }
}

function markRows() {
  for (const el of $('list').querySelectorAll('.row')) {
    const on = state.results[Number(el.dataset.i)] === state.selected;
    el.classList.toggle('on', on);
    // A class alone is invisible to a screen reader, and the selected row is
    // the row driving the map.
    if (on) el.setAttribute('aria-current', 'true');
    else el.removeAttribute('aria-current');
    el.querySelector('.r-chev').innerHTML = on ? CHEV : '';
  }
}

// Tap an unselected row to light its building and reframe. Tap the selected
// row again to open the room. Both asks land on one gesture that way, and the
// chevron on the selected row is the promise that the second tap goes deeper.
function select(i) {
  const r = state.results[i];
  if (!r) return;
  if (state.selected === r) {
    openRoom(r.id);
    return;
  }
  state.selected = r;
  markRows();
  setSheet(restFor(state.screen) * window.innerHeight, true);
  frame(r);
  say(`${roomLabel(r)}, ${r.walk} minute walk, shown on the map.`);
}

// ---------------------------------------------------------------- the chips

function paintChips() {
  for (const el of $('chips').querySelectorAll('.chip')) {
    const on = el.dataset.min === state.duration;
    el.setAttribute('aria-checked', String(on));
    // Roving tabindex: one stop for the whole group, arrows move inside it.
    el.tabIndex = on ? 0 : -1;
  }
  for (const el of document.querySelectorAll('#ask .opt[data-min]')) {
    el.classList.toggle('primary', el.dataset.min === state.duration);
  }
}

function attachChips() {
  const chips = [...$('chips').querySelectorAll('.chip')];
  chips.forEach((el, i) => {
    el.onclick = () => choose(el.dataset.min);
    el.onkeydown = (e) => {
      const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
      if (!step) return;
      e.preventDefault();
      const next = chips[(i + step + chips.length) % chips.length];
      choose(next.dataset.min);
      next.focus();
    };
  });
}

// ------------------------------------------------------- the buildings screen

// The first door, with the building named the way the rows name it. The
// question screen and the buildings screen both ask, so it is worked out in
// one place and they cannot answer it differently at the same minute.
//
// data/buildings-hours.json is purely weekly and hoursFor indexes it by weekday,
// so nothing in it knows about a holiday. The calendar lives here, at the call
// site: on Thanksgiving the buildings screen said "PAES opens at 5:00am" under
// its own heading saying campus is locked, and on the Sunday before Labor Day it
// said the same about the Monday. Both go back to the bare sentence.
function firstDoor(now) {
  const opening = nextOpening({
    buildings: state.buildings,
    counts: state.counts,
    hoursFor,
    day: now.getDay(),
    nowMin: nowMinutes(now),
  });
  if (!opening) return null;
  const ahead = (opening.day - now.getDay() + 7) % 7;
  const on = new Date(now.getFullYear(), now.getMonth(), now.getDate() + ahead);
  if (closedDayFor(isoDate(on), state.current, state.rooms)?.state === 'offices-closed') return null;
  return { ...opening, name: shortName(opening.name) };
}

// The answer for 9:40pm on a Thursday and for every hour of every weekend. The
// schedule constrains roughly 943 of the 8,760 hours in a year, and outside it
// a ranked room list is a distance sort wearing the clothes of a schedule
// answer. The unit here is the building, because the real question is which
// door is even unlocked.
function paintNear(reason) {
  const now = clockNow();
  state.day = now.getDay();
  const groups = rankBuildings({
    origin: state.origin,
    buildings: state.buildings,
    counts: state.counts,
    hoursFor,
    day: state.day,
    nowMin: nowMinutes(now),
  });
  state.groups = groups;


  // Five doors, five sentences. A building the Registrar publishes as shut
  // today is a fact and reads as one; only a building nobody publishes anything
  // about gets "unknown" and the warning colour. The one line every row used to
  // share said "open till 6:00pm" at 9:40pm, three hours forty after the door
  // had already locked.
  const DOOR = {
    open: (b) => [`open till ${clock(b.closesAt)}`, `open until ${spokenClock(b.closesAt)}`],
    before: (b) => [`opens ${clock(b.opensAt)}`, `shut now, opens at ${spokenClock(b.opensAt)}`],
    after: (b) => [`locked ${clock(b.closesAt)}`, `locked since ${spokenClock(b.closesAt)}`],
    'closed-today': () => ['closed today', 'published as closed all day today'],
    unknown: () => ['hours unknown', 'opening hours not published'],
  };

  // An open row is a name and a walk. It used to carry a room count, an "open
  // every day" tag and a closing time as well, and none of the three changed
  // what anybody did next: the count is not a promise that any of them is free,
  // and the closing time is a fact about a door you have not walked to yet.
  //
  // The closed rows keep their door phrase, because inside a group already
  // labelled closed that phrase IS the payload: "opens 7:00am" and "closed
  // today" are different answers and the second one is not worth walking for.
  //
  // The spoken name keeps everything the visible row drops.
  const row = (b) => {
    const [hoursText, hoursSay] = DOOR[b.when](b);
    const rooms = `${b.rooms} classroom${b.rooms === 1 ? '' : 's'}`;
    const name = `${shortName(b.name)}, ${b.walk} minute walk, ${rooms}, ${hoursSay}`;
    const shut = b.when !== 'open';
    return `<button type="button" class="b-row" data-code="${esc(b.code)}" aria-label="${esc(name)}">
      <span class="r-name">${esc(shortName(b.name))}</span>
      <span class="r-walk">${WALK_ICON}${b.walk} min</span>
      ${shut ? `<span class="b-hours">${hoursText}</span>` : ''}
    </button>`;
  };

  // No header over the open rows. "Open now" was a label on the only group that
  // is not behind a disclosure, so it named the default, and the read date next
  // to it was provenance nobody acts on; it lives in Sources, which is one tap
  // away from every screen.
  const openGroup = groups.open.map(row).join('');
  // The unknown-hours group is gone with the rooms that fed it. A building the
  // Registrar publishes no hours for no longer reaches the index at all, so
  // this stays empty unless the hours table moves under a built index, and in
  // that case not showing a door we cannot describe is still the right answer.
  const closedGroup = groups.closed.length
    ? `<p class="grp"><button type="button" class="bar-btn" data-more="closed" aria-expanded="false"
         aria-label="${groups.closed.length} building${groups.closed.length === 1 ? ' is' : 's are'} closed now">
         ${groups.closed.length} closed</button></p>
       <div id="closed-list" hidden>${groups.closed.map(row).join('')}</div>`
    : '';

  // firstDoor is location-free and has to be, because nothing in js/state.js
  // knows where the reader is standing. This screen does, and the closed list
  // under the sentence is already sorted by walk. Three doors share 7:00am at
  // the weekend, and the sentence named Hitchcock Hall at 460 m while
  // Independence Hall opened the same minute 120 m away, 28 rows above it.
  const opening = firstDoor(now);
  const nearest =
    opening?.day === state.day
      ? groups.closed.find((b) => b.when === 'before' && b.opensAt === opening.opensAt)
      : null;
  const door = openingPhrase(nearest ? { ...opening, name: shortName(nearest.name) } : opening, state.day);
  const closedNow = door ? `Everything is closed. ${door}.` : 'Everything is closed right now.';

  $('near').innerHTML =
    `<h2 class="msg" id="near-h" tabindex="-1">${esc(reason.head)}</h2>
     <p class="why">${esc(reason.body)}</p>` +
    openGroup +
    // The one state this screen can reach with nothing at the top: every door
    // we have hours for is shut, which is most of the night. The old sentence
    // here blamed a missing coordinate, and no shipped building has ever been
    // missing one. It then said only that everything was closed, on a screen
    // already holding all 46 opening times, so it names the first one now and
    // keeps the bare sentence for a table with no doors in it.
    (groups.open.length ? '' : `<p class="empty">${esc(closedNow)}</p>`) +
    closedGroup +
    FOOT_ACTS;

  for (const el of $('near').querySelectorAll('.b-row')) {
    el.onclick = () => selectBuilding(el.dataset.code);
  }
  const more = $('near').querySelector('[data-more]');
  if (more) {
    more.onclick = () => {
      const box = $('closed-list');
      box.hidden = !box.hidden;
      more.setAttribute('aria-expanded', String(!box.hidden));
    };
  }
  wireFootActs($('near'));
  syncPaneTouch();
}

// The buildings screen lights a footprint like the ranked list does, but there
// is no room to open behind it, so a second tap is not a promise of anything.
function selectBuilding(code) {
  const b = state.buildings?.[code];
  if (!b) return;
  const found = [...state.groups.open, ...state.groups.unknown, ...state.groups.closed].find((x) => x.code === code);
  state.selected = { id: code, building: code, walk: found?.walk ?? null };
  setSheet(restFor(state.screen) * window.innerHeight, true);
  frame(state.selected);
  say(`${shortName(b.name)}, shown on the map.`);
}

// Why the schedule cannot answer THIS MINUTE, which is the evening and the
// weekend. The other reason, a whole day with almost no classes in it, is a
// refusal rather than a routing decision: resolveState dresses it as
// SCHEDULE_DARK and it arrives here through state.situation, because saying
// "right now" on a day where nothing runs at any hour would point at the clock
// for a problem that is not about the clock.
const UNSCHEDULED = {
  head: 'Nearest buildings',
  // The heading used to be "Nothing is scheduled right now" over a paragraph
  // explaining that no class was meeting. Both said the same thing, and neither
  // was what the reader wanted: they are looking at a list of buildings, so the
  // heading may as well name it. showNear focuses this h2, so the element has
  // to stay whatever it says.
  body: '',
};

// Why this screen and not a room list. The locked-door caveat lives in this
// sentence rather than in a footer, because on this screen it is the answer
// rather than a disclaimer under it.
function nearReason() {
  const s = state.situation;
  const base = s && !s.ranked ? { head: s.heading, body: s.body } : UNSCHEDULED;
  // The one sentence this screen cannot drop. It is the only place on it that
  // says an open building is not an unlocked room, because paintNear renders no
  // caveat and #ask, which carries the other one, is hidden behind it.
  return {
    head: base.head,
    body: base.body
      ? `${base.body} An open building is not an unlocked room.`
      : 'An open building is not an unlocked room.',
  };
}

// ------------------------------------------------------------- the picker

// Not a consolation screen. On iOS a denied permission is terminal, there is no
// in-app way back to the prompt, and someone at home planning tomorrow never
// wanted a fix in the first place. What this emits is indistinguishable from a
// GPS fix everywhere downstream.
function paintPick() {
  const q = state.query.trim().toLowerCase();
  const codes = Object.keys(state.counts ?? {}).filter((c) => state.buildings?.[c]);

  const entry = (code) => {
    const b = state.buildings[code];
    const name = shortName(b.name);
    return { code, name, short: state.shorts?.[code] ?? null, rooms: state.counts[code] };
  };
  let rows = codes.map(entry);
  if (q) {
    // Prefix matches first, then anything containing it. No fuzzy scoring: a
    // list of 96 does not need one, and a wrong first hit costs a tap.
    const hit = (e) => `${e.name} ${e.short ?? ''}`.toLowerCase();
    const starts = rows.filter((e) => e.name.toLowerCase().startsWith(q) || (e.short ?? '').toLowerCase().startsWith(q));
    const contains = rows.filter((e) => !starts.includes(e) && hit(e).includes(q));
    rows = [...starts, ...contains];
  }
  rows.sort((a, b) => (q ? 0 : a.name.localeCompare(b.name)));

  const pickRow = (e) => {
    const rooms = `${e.rooms} room${e.rooms === 1 ? '' : 's'}`;
    const name = [e.name, e.short, rooms].filter(Boolean).join(', ');
    return `<button type="button" class="pick-row" data-code="${esc(e.code)}" aria-label="${esc(name)}">
      <span class="pn">${esc(e.name)}</span>
      ${e.short ? `<span class="ps">${esc(e.short)}</span>` : ''}
      <span class="pc">${rooms}</span>
    </button>`;
  };

  const shortcuts = SHORTCUTS.filter((c) => state.buildings?.[c])
    .map(
      (c) =>
        `<button type="button" class="bar-btn" data-code="${esc(c)}">${esc(shortName(state.buildings[c].name))}</button>`,
    )
    .join('');

  $('pick').innerHTML =
    '<h2 class="msg" id="pick-h" tabindex="-1">Where are you?</h2>' +
    (q ? '' : `<div class="shortcuts">${shortcuts}</div>`) +
    (rows.length
      ? rows.map(pickRow).join('')
      : `<p class="empty">No building matches ${esc(state.query)}.</p>`);

  for (const el of $('pick').querySelectorAll('[data-code]')) {
    el.onclick = () => pickBuilding(el.dataset.code);
  }
  // The abbreviations arrive after the first paint and repaint the whole list,
  // which drops focus on the floor unless it is put back.
  if (document.activeElement === document.body) focusHeading($('pick-h'));
  syncPaneTouch();
}

function pickBuilding(code) {
  const b = state.buildings?.[code];
  if (!b) return;
  const origin = {
    lat: b.lat,
    lon: b.lon,
    accuracy: PICKED_ACCURACY_M,
    source: 'picked',
    label: shortName(b.name),
    at: Date.now(),
  };
  safeSet(KEY_ORIGIN, JSON.stringify(origin));
  useOrigin(origin, null);
  state.query = '';
  $('find-q').value = '';
  // The picker replaces itself in history rather than stacking, so back still
  // goes wherever the picker was opened from.
  const view = state.scheduled && state.rankable ? 'list' : 'near';
  history.replaceState({ v: view }, '', cleanUrl());
  if (view === 'list') {
    showList();
    answer();
  } else {
    showNear();
  }
  say(`Showing rooms from ${origin.label}.`);
}

function clearPickedOrigin() {
  safeDel(KEY_ORIGIN);
  locate().then((got) => {
    useOrigin(got.origin, got.note);
    refresh();
    // The X always goes; on the Oval fallback the row it sits in stays. Focus
    // moves to whichever survives, or it lands on the body and is lost.
    ($('origin').hidden ? $('back') : $('origin-where')).focus({ preventScroll: true });
  });
}

function useOrigin(origin, note) {
  state.origin = origin;
  state.accuracy = origin.accuracy;
  // The dot, its accuracy ring and the end of the walk line all hang off this.
  frames.wake();
  // The one place the app branches on where the origin came from. Nothing in
  // ranking, the off-campus gate or the buildings screen reads it.
  state.originIsGuess = origin.source === 'oval';
  // The same sentence in two places, because it belongs to two screens.
  // #note floats over the map and answers "why is the walk measured from
  // there". #ask-where sits in the question column, because a fixed pill on
  // top of the wordmark, the question and the "1 hour" button was the bug.
  $('note-text').textContent = note ?? '';
  $('note').hidden = !note;
  $('note-pick').hidden = !note;
  $('ask-where').textContent = note ?? '';
  $('ask-where').hidden = !note;
  $('ask-pick').hidden = !note;
  paintOriginBar();
}

// Whether the "from <building>" row belongs on screen. It is a location CONTROL
// costing a full row at the top of the most-used screen, which is why
// docs/DECISIONS.md cut it to dev mode, and a phone with a real position has
// nothing to correct. It comes back for the two origins the app chose FOR them:
// a picked building is otherwise permanent, with no visible undo.
const originBarOn = (screen) =>
  (screen === 'list' || screen === 'near') &&
  (state.dev || state.origin?.source === 'picked' || state.originIsGuess);

function paintOriginBar() {
  const picked = state.origin?.source === 'picked';
  const label = picked ? state.origin.label : state.originIsGuess ? 'the Oval' : 'your location';
  const where = $('origin-where');
  where.querySelector('span').innerHTML = `from <b>${esc(label)}</b>`;
  where.setAttribute('aria-label', `Measuring from ${label}. Pick a different building.`);
  $('origin-clear').hidden = !picked;
  // Clearing a picked origin changes who the bar is for without changing screen,
  // so the row is hidden here as well as in showPane.
  $('origin').hidden = !originBarOn(state.screen);
}

// -------------------------------------------------------------- the room

// Which day the room screen is drawing. An offset in days from the app's own
// clock, not a date, so it survives the clock moving under it in dev mode.
let roomDayOffset = 0;

const dayShown = () => {
  const d = clockNow();
  d.setDate(d.getDate() + roomDayOffset);
  return d;
};

// One hour of the grid, in CSS pixels. 46 is the smallest that fits a course
// code and a time range on two lines inside a 55 minute class, which is the
// most common length on campus.
const HOUR_PX = 46;

const SHORT_DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const SHORT_MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// The day as a calendar column, which is the shape a student already reads a
// timetable in.
//
// It replaced a list of rows that said "7:00am free 7h00 / 2:00pm in use". That
// list was accurate and nobody could see the shape of the day in it: the whole
// point of an empty-room app is that the empty parts are the answer, and on a
// grid the empty parts are simply the gaps. Every word the list spent saying
// "free" is now white space.
//
// Hours are always published for a shipped room, because a building with no
// published hours no longer ships at all, so there is exactly one unknown left
// to draw: a day the building is published as closed.
function dayGridHtml(room, bname) {
  const date = dayShown();
  const hours = hoursFor(room.b, date.getDay());
  const label = `${SHORT_DAY[date.getDay()]}, ${SHORT_MONTH[date.getMonth()]} ${date.getDate()}`;
  const head = `<div class="dnav">
      <button type="button" class="dstep" data-day="-1" aria-label="Previous day">
        <svg class="ico flip" aria-hidden="true"><use href="#i-chev"/></svg></button>
      <span>${esc(label)}</span>
      <button type="button" class="dstep" data-day="1" aria-label="Next day">
        <svg class="ico" aria-hidden="true"><use href="#i-chev"/></svg></button>
    </div>`;

  if (hours === null) return `${head}<p class="unknown">${esc(bname)} is closed.</p>`;

  const classes = classesOn(room, date, state.rooms.sessions, state.rooms.courses);
  // A shipped room's building always publishes hours, because one that does not
  // no longer reaches the index. `undefined` still has to be survivable: the
  // hours table is refetched on its own schedule and can drop a building while
  // a built index still names it. The grid then runs the classes it can see and
  // says so, rather than reading undefined[0] and rendering NaN.
  const doors = Array.isArray(hours);
  if (!doors && !classes.length) {
    return `${head}<p class="unknown">No class today, and no published hours.</p>`;
  }
  // The grid runs the building's own hours, snapped out to whole hours so the
  // labels land on the lines. A class that starts before the door officially
  // opens widens the window rather than being clipped: it happened, and hiding
  // it would draw the room as free during a class.
  const first = Math.min(...(doors ? [hours[0]] : []), ...classes.map((c) => c.from));
  const last = Math.max(...(doors ? [hours[1]] : []), ...classes.map((c) => c.to));
  const top = Math.floor(first / 60) * 60;
  const end = Math.ceil(last / 60) * 60;
  const span = Math.max(60, end - top);
  const pc = (m) => ((m - top) / span) * 100;

  const marks = [];
  for (let m = top; m <= end; m += 60) {
    marks.push(`<li style="top:${pc(m).toFixed(3)}%"><span>${esc(hourLabel(m))}</span></li>`);
  }

  const blocks = classes.map((c) => {
    const h = pc(c.to) - pc(c.from);
    const name = c.course ?? 'In use';
    const when = `${clock(c.from)} - ${clock(c.to)}`;
    return `<div class="blk${h < 4.5 ? ' tight' : ''}" style="top:${pc(c.from).toFixed(3)}%;height:${h.toFixed(3)}%"
      aria-label="${esc(`${name}, ${when}`)}"><b>${esc(name)}</b><span>${esc(when)}</span></div>`;
  });

  // The now line only means anything on the day it is on.
  const nowMin = nowMinutes(clockNow());
  const isToday = roomDayOffset === 0;
  const nowLine =
    isToday && nowMin >= top && nowMin <= end
      ? `<div class="nowline" style="top:${pc(nowMin).toFixed(3)}%" aria-hidden="true"></div>`
      : '';

  // A fixed height per hour, not a percentage of the sheet. A calendar whose
  // hour is 6px on a short screen and 30px on a tall one is two different
  // pictures of the same day; the pane scrolls instead.
  const px = Math.round((span / 60) * HOUR_PX);
  return `${head}<div class="day" style="height:${px}px;--hours:${span / 60}">
      <ul class="hrs">${marks.join('')}</ul>
      <div class="cols">${blocks.join('')}${nowLine}</div>
    </div>`;
}

// 7 AM, noon, 8 PM. No minutes, because every mark is on the hour.
function hourLabel(m) {
  const h = Math.floor(m / 60) % 24;
  if (h === 0) return '12 AM';
  if (h === 12) return 'noon';
  return h < 12 ? `${h} AM` : `${h - 12} PM`;
}

// The timeline, as rows. Free blocks are the content and classes are the
// frame, so a free block carries a start, the word and a length, and a class
// carries a start and nothing else.
function timelineRows(room, bname, nowMin, date) {
  const hours = hoursFor(room.b, date.getDay());
  const blocks = blocksOn(room, date, state.rooms.sessions);
  const known = Array.isArray(hours);
  if (hours === null) return { closed: true, rows: [] };

  // With no published hours the timeline is bounded by the room's own first
  // and last class. The app knows the door was open when a class met in it. It
  // knows nothing about the hour before.
  const open = known ? hours[0] : blocks.length ? blocks[0][0] : null;
  const close = known ? hours[1] : blocks.length ? blocks[blocks.length - 1][1] : null;
  if (open == null) return { known, rows: [], nothing: true };

  // Clipped to the window, because a block that runs past the close is not
  // evidence about a locked building.
  const inside = [];
  for (const [s, e] of blocks) {
    const c = [Math.max(s, open), Math.min(e, close)];
    if (c[1] > c[0]) inside.push(c);
  }

  const rows = [];
  if (known) rows.push({ kind: 'edge', t: open, text: `${bname} opens` });
  else rows.push({ kind: 'edge', text: `before ${clock(open)}, not known` });

  const gap = (from, to) => {
    const len = to - from;
    if (len <= 0) return;
    if (len < SEAM_MIN) {
      rows.push({ kind: 'seam' });
      return;
    }
    rows.push({ kind: 'free', t: from, end: to, len, now: nowMin != null && nowMin >= from && nowMin < to });
  };

  let cursor = open;
  for (const [s, e] of inside) {
    gap(cursor, s);
    rows.push({ kind: 'busy', t: s });
    cursor = Math.max(cursor, e);
  }
  gap(cursor, close);

  if (known) rows.push({ kind: 'edge', t: close, text: `${bname} closes` });
  else rows.push({ kind: 'edge', text: `after ${clock(close)}, not known` });

  return { known, rows, blocks: inside, open, close };
}

// The one line at the top that makes a claim, and the only place on the room
// screen that talks about now. js/claim.js decides what is true; this turns the
// verdict into a sentence.
//
// A building nobody publishes hours for gets sentences about CLASSES. The
// screen used to print "Thompson Library opens at 12:45pm" off the start of the
// first class, two lines above its own paragraph saying nobody knows when that
// door unlocks.
//
// Every duration on this screen is `c.yours`, which is the engine's formula
// with the walk in it, and it is absent rather than guessed when the walk is
// unknown. The room screen is the one place that can say how long you get, so
// it is the one place where an overstated figure sends somebody across campus.
function claimFor(tl, nowMin, bname, metres) {
  const c = roomClaim({ ...tl, now: nowMin, metres });
  // Kept short and kept at all: this only fires if the hours table drops a
  // building a built index still ships, which the room screen must survive.
  const noDoors = () => 'Door hours not published';

  switch (c.kind) {
    case 'opens':
      return {
        head: `Opens ${clock(c.at)}`,
        sub: c.next != null && c.yours > 0 ? `Free ${clock(c.next)} \u00b7 ${dur(c.yours)}` : '',
      };
    case 'before-first-class':
      return { head: `First class ${clock(c.at)}`, sub: '' };
    case 'closed-for-day':
      return { head: 'Closed for the day', sub: '' };
    case 'after-last-class':
      return { head: `Last class ended ${clock(c.at)}`, sub: '' };
    case 'in-class':
      return {
        head: `In use till ${clock(c.until)}`,
        sub:
          c.next == null
            ? 'Nothing free after it today'
            : c.yours > 0
              ? `Next free ${clock(c.next)}, for ${dur(c.yours)}`
              : `Next free ${clock(c.next)}`,
      };
    case 'no-class-today':
      return { head: 'No class today', sub: '' };
    case 'free':
      // With no published hours the sentence about the door outranks the
      // sentence about the window. "Yours for 45 min" under a headline that
      // already admits nobody knows when the building locks reads as a promise
      // the line above it just refused to make.
      if (!c.known) {
        return {
          head: c.until == null ? 'No class in here for the rest of today' : `No class in here till ${clock(c.until)}`,
          sub: noDoors(),
        };
      }
      return {
        head: c.until == null ? 'No class in here for the rest of today' : `Free till ${clock(c.until)}`,
        sub:
          c.yours == null
            ? ''
            : c.yours > 0
              ? `Yours for ${dur(c.yours)} once you get there`
              : 'It closes before you could walk there',
      };
    default:
      return { head: 'Nothing free now', sub: '' };
  }
}

// The same line for a date the user is not standing in. js/day.js decides what
// is true and this fetches what it needs, the calendar included: an empty busy
// list is not evidence of a free room on a day the app refuses to answer for.
function shapeFor(tl, date) {
  const iso = isoDate(date);
  return dayClaim({
    closed: tl.closed,
    blocks: tl.blocks,
    calendar: calendarOn(iso, state.rooms, state.current),
    inTerm: inTermOn(iso, state.current, state.rooms),
    term: state.current?.termName,
  });
}

const rad = (deg) => (deg * Math.PI) / 180;

// Great-circle initial bearing, degrees clockwise from true north.
function bearingTo(from, to) {
  const dLon = rad(to.lon - from.lon);
  const y = Math.sin(dLon) * Math.cos(rad(to.lat));
  const x = Math.cos(rad(from.lat)) * Math.sin(rad(to.lat)) - Math.sin(rad(from.lat)) * Math.cos(rad(to.lat)) * Math.cos(dLon);
  return (((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360;
}

function roomHtml(id) {
  const room = state.rooms.rooms[id];
  const b = state.buildings?.[room.b];
  const bname = shortName(b?.name ?? room.b);
  const now = clockNow();
  const nowMin = nowMinutes(now);
  const r = state.results.find((x) => x.id === id);
  // The walk belongs in the claim, so it has to be here whether or not the room
  // came off a ranked row: a shared link and the buildings screen both land on
  // this screen with state.results empty.
  const metres = Number.isFinite(r?.metres)
    ? r.metres
    : state.origin && b && Number.isFinite(b.lat) && Number.isFinite(b.lon)
      ? Math.round(distanceMetres(state.origin, b))
      : null;

  // The day the screen is drawing, which is the day it has to describe.
  const date = dayShown();
  const today = roomDayOffset === 0;
  const tl = timelineRows(room, bname, today ? nowMin : null, date);
  const claim = !today
    ? shapeFor(tl, date)
    : tl.closed
      ? { head: 'Closed today', sub: '' }
      : tl.nothing
        ? { head: 'No class in here all day', sub: '' }
        : claimFor(tl, nowMin, bname, metres);

  // rank() rounds the metres it reports but keeps the walk it computed off the
  // unrounded distance, so re-deriving one from the other can disagree by a
  // minute with the row the user just tapped.
  const walk = r?.walk ?? (Number.isFinite(metres) ? walkMinutes(metres) : null);

  // The vocabulary ships in the room index. A second copy here is how five of
  // the eleven visible codes went missing from it, and 95 rooms, a conference
  // room and two dozen computer labs among them, rendered as bare untyped rows.
  const type = state.rooms?.types?.[room.type];
  // Every fact is its own element. Bare strings next to each other in a flex
  // row become one anonymous flex item, not three, so no gap landed between
  // them and the row rendered as "113 m28 seatsclassroom".
  // The metres used to sit beside the minutes. The minutes are computed FROM
  // the metres, so it was one number rendered twice.
  const facts = [
    walk == null ? '' : `<span class="w">${WALK_ICON}${walk} min walk</span>`,
    room.cap ? `<span>${room.cap} seats</span>` : '<span>seats unknown</span>',
    type ? `<span>${esc(type)}</span>` : '',
    // The same word the row carries, on the screen a student lands on after
    // tapping it. A row that is ranked down for a reason has to be able to say
    // the reason once the reader asks for the room.
    //
    // It carries the sentence too. deptOf writes the word out for the list's
    // spoken name because "departmental" alone next to a seat count is a word
    // with no sentence around it; that argument does not stop being true one tap
    // later, and this line read as the bare word while the row it came from read
    // as the sentence.
    room.ga === false
      ? '<span>departmental<span class="sr">, not a general-assignment room</span></span>'
      : '',
  ].filter(Boolean);

  // The day, drawn. Every paragraph that used to sit here explained an absence
  // the grid now shows: a closed day is a grid that says closed, an empty day is
  // an empty grid, and there is no unpublished-hours case left to explain
  // because those rooms no longer ship.
  const body = dayGridHtml(room, bname);

  // The one control on this screen that leaves the app, and the reason #44's
  // straight line is allowed to stay a direction rather than a route: it is a
  // refusal to route only while there is a visible way out to something that
  // does. It says "Directions" because that is what it opens; "Maps" named a
  // place. js/install.js picks the URL, which is a question about the phone.
  const acts =
    b && Number.isFinite(b.lat)
      ? `<p class="acts">
          <button type="button" id="bearing" class="bar-btn" aria-label="Point the arrow at it">
            <svg class="ico" aria-hidden="true" hidden><use href="#i-arrow"/></svg>
            <span>Point me</span>
          </button>
          <a class="bar-btn" aria-label="Walking directions to ${esc(bname)}, in your maps app"
             href="${esc(mapsHref({ lat: b.lat, lon: b.lon, origin: state.origin, ua: navigator.userAgent, maxTouchPoints: navigator.maxTouchPoints }))}">Directions</a>
          <button type="button" class="bar-btn" data-act="about" aria-label="What Vacant knows">Sources</button>
        </p>`
      : '';

  return `<h2 id="room-h" tabindex="-1">${esc(bname)} ${esc(room.n ?? '')}</h2>
    <p class="claim">${esc(claim.head)}${claim.sub ? `<span class="sub">${esc(claim.sub)}</span>` : ''}</p>
    <p class="facts">${facts.join('')}</p>
    ${acts}
    ${body}
    ${CAVEAT}`;
}

// The compass needle. It stays off until it is asked for, because iOS only
// grants orientation from inside a tap and a permission prompt nobody asked
// for is a prompt everybody denies.
let orientationOff = null;

function attachBearing(id) {
  const btn = $('bearing');
  if (!btn) return;
  const room = state.rooms.rooms[id];
  const b = state.buildings?.[room.b];
  const arrow = btn.querySelector('.ico');
  const label = btn.querySelector('span');
  const bearing = bearingTo(state.origin, b);
  const word = COMPASS[Math.round(bearing / 45) % 8];
  btn.setAttribute('aria-label', `${shortName(b.name)} is ${word} of you. Point the arrow live.`);

  btn.onclick = async () => {
    const ask = window.DeviceOrientationEvent?.requestPermission;
    if (typeof ask === 'function') {
      try {
        if ((await ask.call(window.DeviceOrientationEvent)) !== 'granted') {
          label.textContent = `${word}, no compass`;
          return;
        }
      } catch {
        label.textContent = `${word}, no compass`;
        return;
      }
    }
    if (!('DeviceOrientationEvent' in window)) {
      label.textContent = `${word}, no compass`;
      return;
    }
    const onTurn = (e) => {
      // webkitCompassHeading is already degrees clockwise from true north.
      // alpha counts the other way, so it has to be flipped before it means
      // the same thing.
      const heading = Number.isFinite(e.webkitCompassHeading)
        ? e.webkitCompassHeading
        : Number.isFinite(e.alpha)
          ? 360 - e.alpha
          : null;
      if (heading == null) return;
      // `hidden` is an HTMLElement property and this is an SVG element, so the
      // assignment sets a JS property nobody reads and leaves the attribute in
      // place. The needle would never have appeared.
      arrow.removeAttribute('hidden');
      arrow.style.transform = `rotate(${(bearing - heading + 360) % 360}deg)`;
      label.textContent = word;
    };
    window.addEventListener('deviceorientationabsolute', onTurn);
    window.addEventListener('deviceorientation', onTurn);
    orientationOff = () => {
      window.removeEventListener('deviceorientationabsolute', onTurn);
      window.removeEventListener('deviceorientation', onTurn);
      orientationOff = null;
    };
    label.textContent = word;
  };
}

// The complaint arrives after the walk, after the app was backgrounded and
// possibly killed, so the room the user tapped has to outlive the process.
function rememberPick(id) {
  const room = state.rooms?.rooms?.[id];
  if (!room) return;
  const r = state.results.find((x) => x.id === id);
  // The day the row was ranked on, not the day it was tapped on. A row still on
  // screen at 00:02 was answered yesterday, so the block list, the mask and the
  // label all take their weekday from state.day.
  const shown = clockNow();
  shown.setDate(shown.getDate() - ((shown.getDay() - state.day + 7) % 7));
  const busy = blocksOn(room, shown, state.rooms.sessions);
  const active = activeSessions(state.rooms.sessions, isoDate(shown));
  // Which session's class closes the gap. That is the number a maintainer needs
  // to tell a stale session mask from a wrong gap.
  const closer = (room.busy ?? []).find(
    (b) => Number(b[0]) === state.day && Number(b[1]) === r?.nextClassAt && (!active || active[b[3]] !== false),
  );
  // 83.4% of gaps end at the door rather than at a class, and "sess ?" reads as
  // a lookup that failed rather than as the answer.
  const session = closer ? closer[3] : r && r.nextClassAt === closeOf(room.b) ? 'door' : null;
  safeSet(
    KEY_PICK,
    JSON.stringify({
      id,
      type: room.type ?? null,
      cap: room.cap ?? null,
      building: room.b,
      metres: r?.metres ?? null,
      walk: r?.walk ?? null,
      gapStart: r?.availableAt ?? null,
      gapEnd: r?.nextClassAt ?? null,
      session,
      usable: r?.usable ?? null,
      // The minute the row was tapped, so the block can print the departure
      // deadline behind the usable figure. Reading the clock when the panel
      // opens instead would date-stamp a walk that already happened.
      nowMin: nowMinutes(clockNow()),
      busy,
      dayName: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][state.day],
      at: Date.now(),
    }),
  );
}

// ------------------------------------------------------------- diagnostics

async function cacheNames() {
  try {
    return await caches.keys();
  } catch {
    return [];
  }
}

async function paintAbout() {
  const names = await cacheNames();
  const shells = names.filter((n) => n.startsWith('vacant-shell-'));
  // A newer cache sitting beside an older controller is the "you are running
  // last week's code" state, and it is worth seeing.
  const build = shells.length === 1 ? shells[0].replace('vacant-shell-', '') : shells.length ? 'more than one' : 'unknown';
  const controlling = shells.length === 1 && Boolean(navigator.serviceWorker?.controller);

  let pick = null;
  try {
    pick = JSON.parse(safeGet(KEY_PICK) ?? 'null');
  } catch {
    pick = null;
  }

  const now = clockNow();
  const stale = staleness({ now, current: state.current });
  const block = diagnosticsBlock({
    build,
    controlling,
    term: state.current?.term,
    termName: state.current?.termName,
    generated: state.current?.generated,
    ageDays: stale.days,
    stateKind: state.situation?.kind ?? '?',
    rooms: Object.keys(state.rooms?.rooms ?? {}).length,
    buildings: Object.keys(state.buildings ?? {}).length,
    sessions: (state.rooms?.sessions ?? []).length,
    originSource: state.origin?.source,
    accuracy: state.accuracy,
    originAgeS: state.origin?.at ? Math.round((Date.now() - state.origin.at) / 1000) : null,
    lat: state.origin?.lat,
    lon: state.origin?.lon,
    includeLocation: state.includeLocation,
    hoursSource: state.hoursSlug,
    hoursGenerated: state.hours?.generated,
    clock: `${isoDate(now)} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
    zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    caches: names,
    room: pick,
    busy: pick?.busy,
    dayName: pick?.dayName,
  });

  const issue =
    'https://github.com/EnesYilmazcode/Vacant/issues/new?template=wrong-answer.yml&labels=wrong-answer&diagnostics=' +
    encodeURIComponent(block);

  $('about').innerHTML = `
    <h2 class="msg" id="about-h" tabindex="-1">What Vacant knows</h2>
    <p class="why">Everything on this screen came out of memory and the cache. Nothing left the
      phone to build it, and nothing leaves it now unless you tap one of the buttons.</p>
    <pre class="diag" id="diag">${esc(block)}</pre>
    <label class="optin"><input type="checkbox" id="loc-optin" ${state.includeLocation ? 'checked' : ''}>
      Include my coordinates, rounded to four decimals</label>
    <p class="acts">
      <button type="button" class="bar-btn" id="copy">Copy</button>
      <a class="bar-btn" id="report" href="${esc(issue)}" target="_blank" rel="noopener">This was wrong</a>
    </p>
    <p class="foot">A URL is not private. It lands in your address bar, your history and GitHub's
      logs, so your coordinates stay out of it until you tick the box.</p>
    <p class="foot">Class times come from Ohio State's public class search. Building open and close
      times come from the Registrar's classroom pool schedule. Building locations &copy; 2025 The
      Ohio State University, Facilities Information and Technology Services, GIS.
      <a href="${BASE}privacy.html">What this app does with your location</a></p>`;

  $('loc-optin').onchange = (e) => {
    state.includeLocation = e.target.checked;
    paintAbout();
  };
  $('copy').onclick = async () => {
    try {
      await navigator.clipboard.writeText(block);
      $('copy').textContent = 'Copied';
    } catch {
      // Clipboard access is denied outright in a few standalone iOS builds, so
      // the fallback is to select the block and say so rather than fail quietly.
      const pre = $('diag');
      pre.classList.add('picked');
      const range = document.createRange();
      range.selectNodeContents(pre);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      $('copy').textContent = 'Select this text and copy';
    }
  };
  syncPaneTouch();
  focusHeading($('about-h'));
}

// ---------------------------------------------------------------- screens

function showPane(name) {
  if (state.screen === 'room' && name !== 'room' && orientationOff) orientationOff();
  for (const id of PANES) $(id).hidden = id !== name;
  // The chips belong to the ranked list. Leaving them on the room screen means
  // a chip tap has to unwind a history entry to get back to the list it edits.
  $('chips').hidden = name !== 'list';
  $('find').hidden = name !== 'pick';
  $('origin').hidden = !originBarOn(name);
  $('ask').hidden = true;
  $('sheet').hidden = false;
  $('back').hidden = false;
  document.body.classList.remove('asking');
  const arrived = state.screen !== name;
  state.screen = name;
  syncPaneTouch();
  // Arriving re-composes the camera for the strip THIS screen leaves. Without
  // it the view stays fitted for the screen behind: leaving a room slid the walk
  // line 115px and stretched it 1.69x at 393x852, with state.view untouched.
  if (arrived) reframe();
}

function reframe() {
  frames.wake();
  if (!state.basemap || !state.view) return;
  if (state.selected) frame(state.selected);
  // frame() stands down once the camera has been moved by hand, and a cy
  // clamped for the room's 239px band is not inside the list's 528px one.
  state.view = clampView(state.view, state.basemap, viewport());
}

function showAsk() {
  state.screen = 'ask';
  $('ask').hidden = false;
  document.body.classList.add('asking');
  $('sheet').hidden = true;
  $('back').hidden = true;
  for (const id of PANES) $(id).hidden = id !== 'list';
  state.settled = false;
  state.selected = null;
  state.listScroll = 0;
  state.userMoved = false;
  // The next answer opens at peek, whatever height the last one was dragged to.
  sheetH = 0;
  $('map').classList.remove('settled');
  flyoverStart = performance.now();
  // Back to the question restarts the drift, which is the loop's own reason to
  // keep running.
  frames.wake();
  if (orientationOff) orientationOff();
}

function sheetHeight() {
  const h = openAt(state.screen, { screen: sheetScreen, h: sheetH }, window.innerHeight);
  setSheet(h, sheetScreen !== state.screen);
}

function showList() {
  showPane('list');
  $('back').setAttribute('aria-label', 'Back to the question');
  $('list').scrollTop = state.listScroll;
  sheetHeight();
}

function showNear() {
  state.listScroll = 0;
  showPane('near');
  $('back').setAttribute('aria-label', 'Back to the question');
  paintNear(nearReason());
  $('near').scrollTop = 0;
  sheetHeight();
  focusHeading($('near-h'));
  settle();
}

function showPick() {
  loadShorts();
  showPane('pick');
  $('back').setAttribute('aria-label', 'Back without picking a building');
  paintPick();
  $('pick').scrollTop = 0;
  setSheet(restFor(state.screen) * window.innerHeight, true);
  focusHeading($('pick-h'));
}

function showAbout() {
  showPane('about');
  $('back').setAttribute('aria-label', 'Back');
  setSheet(restFor(state.screen) * window.innerHeight, true);
  paintAbout();
}

function showRoom(id, { keepDay = false } = {}) {
  const room = state.rooms?.rooms?.[id];
  if (!room) return showList();
  // A room always opens on today. Stepping to Thursday and then tapping a
  // different room should not answer a question about Thursday.
  if (!keepDay) roomDayOffset = 0;
  if (!$('list').hidden) state.listScroll = $('list').scrollTop;
  $('room').innerHTML = roomHtml(id);
  // Both panes stay in the DOM. That is the whole scroll-restoration
  // mechanism: #list keeps its scrollTop because it was never destroyed.
  showPane('room');
  $('room').scrollTop = 0;
  // Back pops to the entry underneath this one, and openRoom wrote down which
  // screen that is. Outside scheduled hours the room screen opens over the
  // buildings screen, and the label promised a room list that is not there.
  $('back').setAttribute(
    'aria-label',
    history.state?.from === 'near' ? 'Back to the nearest buildings' : 'Back to the room list',
  );

  const r = state.results.find((x) => x.id === id);
  state.selected = r ?? { id, building: room.b, walk: null };
  // frame() below runs only when the room is one of the ranked rows. Opened
  // from a link or out of hours it is not, and the footprint still has to light.
  frames.wake();
  attachBearing(id);
  // A week either way, and no clamp. Past the term's own bounds the grid comes
  // back empty and the sentence over it says the schedule does not reach there.
  for (const el of $('room').querySelectorAll('[data-day]')) {
    el.onclick = () => {
      roomDayOffset += Number(el.dataset.day);
      const at = $('room').scrollTop;
      showRoom(id, { keepDay: true });
      $('room').scrollTop = at;
    };
  }
  for (const el of $('room').querySelectorAll('[data-act]')) el.onclick = () => openAbout();
  focusHeading($('room-h'));
  // The sheet DOES grow for this screen now. It used to hold four or five text
  // rows and peek was enough; it holds a day as a calendar, and a calendar
  // whose first two hours are the only ones above the fold is a calendar
  // nobody scrolls. REST carries that height to viewport() as well, so the map
  // composes for the 239px this screen leaves rather than the list's 528.
  setSheet(restFor(state.screen) * window.innerHeight, true);
  if (r) {
    markRows();
    frame(r);
  }
}

function toAsk() {
  if (state.screen === 'ask') return;
  history.back();
}

const cleanUrl = () => location.pathname + location.hash;

function choose(min) {
  // Belt and braces. The controls carry `disabled` until boot() finishes, but a
  // caller reaching here early would read state.rooms as null and throw.
  if (!state.ready) return;
  state.duration = String(min);
  safeSet(KEY_DURATION, state.duration);
  paintChips();
  if (!state.rankable) return;
  if (!state.scheduled) {
    if (state.screen !== 'near') {
      history.pushState({ v: 'near' }, '', cleanUrl());
      showNear();
    }
    return;
  }
  if (state.screen === 'ask') history.pushState({ v: 'list' }, '', cleanUrl());
  showList();
  answer();
}

function openRoom(id) {
  rememberPick(id);
  // The screen underneath, kept in the entry rather than in a variable, so a
  // reopen from popstate names the same pane a press of back will reach.
  history.pushState({ v: 'room', room: id, from: state.screen }, '', `?room=${encodeURIComponent(id)}`);
  showRoom(id);
}

function openPick() {
  history.pushState({ v: 'pick' }, '', cleanUrl());
  showPick();
}

function openAbout() {
  history.pushState({ v: 'about' }, '', cleanUrl());
  showAbout();
}

function openNear() {
  history.pushState({ v: 'near' }, '', cleanUrl());
  showNear();
}

// Recompute. Never on a timer: a list that re-sorts under a thumb loses the row
// somebody was reaching for. This fires when the app comes back to the
// foreground, when the duration changes, and when the user asks.
function refresh() {
  if (!state.rooms) return;
  const now = clockNow();
  state.situation = resolveState({ now, current: state.current, index: state.rooms });
  state.rankable = state.situation.ranked;
  state.scheduled = inScheduledHours({ now, current: state.current, index: state.rooms });
  paintGate();
  if (!state.rankable) {
    if (state.screen !== 'near' && state.screen !== 'about') showAsk();
    return;
  }
  if (!state.scheduled) {
    if (state.screen === 'list' || state.screen === 'room') showNear();
    else if (state.screen === 'near') paintNear(nearReason());
    return;
  }
  if (state.screen === 'near') showList();
  answer();
}

// The question screen has three shapes, and which one it wears is decided
// before any room is ranked.
function paintGate() {
  const s = state.situation;
  const now = clockNow();
  const stale = staleness({ now, current: state.current });
  $('stale').hidden = stale.level === 'silent' || stale.level === 'gated';
  $('stale').textContent = stale.text;
  $('stale').classList.toggle('banner', stale.level === 'banner');

  // Cleared before the branch, so a gate hidden by a ranked minute cannot keep
  // the orange either. index.html says what the colour means.
  $('gate').classList.remove('refusal');

  if (!s || s.ranked) {
    $('gate').hidden = true;
    $('ask-q').hidden = false;
    if (!state.scheduled && state.ready) {
      $('ask-q').hidden = true;
      // Not UNSCHEDULED. That pair belongs to the buildings screen, and
      // borrowing it here printed "Nearest buildings" over an empty paragraph,
      // above a button reading "Show nearest buildings".
      const said = unscheduledGate({
        now,
        current: state.current,
        index: state.rooms,
        busyDay: busyDayOf(state.current, state.rooms),
        opening: firstDoor(now),
        openNow: openDoorCount({
          counts: state.counts,
          hoursFor,
          day: now.getDay(),
          nowMin: nowMinutes(now),
        }),
      });
      $('gate-h').textContent = said.heading;
      $('gate-p').textContent = said.body;
      $('gate-d').hidden = true;
      $('gate-go').hidden = false;
      $('gate-go').textContent = 'Show nearest buildings';
      const fresh = $('gate').hidden;
      $('gate').hidden = false;
      if (fresh) focusHeading($('gate-h'));
    }
    return;
  }

  $('ask-q').hidden = true;
  $('gate').classList.add('refusal');
  $('gate-h').textContent = s.heading;
  $('gate-p').textContent = s.body;
  $('gate-d').textContent = s.detail ?? '';
  $('gate-d').hidden = !s.detail;
  $('gate-go').hidden = !s.action;
  if (s.action) $('gate-go').textContent = s.action.label;
  const fresh = $('gate').hidden;
  $('gate').hidden = false;
  if (fresh) focusHeading($('gate-h'));
}

// ---------------------------------------------------------------- geolocation

// A deliberate choice does not expire the way a sensor reading does, so a
// picked building is read back before geolocation is ever asked.
function pickedOrigin() {
  try {
    const raw = JSON.parse(safeGet(KEY_ORIGIN) ?? 'null');
    if (raw && Number.isFinite(raw.lat) && Number.isFinite(raw.lon)) {
      return { accuracy: PICKED_ACCURACY_M, source: 'picked', ...raw };
    }
  } catch {
    /* a corrupt key is the same as no key */
  }
  return null;
}

function locate() {
  const picked = pickedOrigin();
  if (picked) return Promise.resolve({ origin: picked, note: null });

  const oval = ovalOrigin();
  return new Promise((resolve) => {
    let done = false;
    const finish = (origin, note) => {
      if (done) return;
      done = true;
      resolve({ origin, note });
    };
    // The wall-clock watchdog. iOS documents its own timeout option as
    // unreliable in a standalone window.
    const watchdog = setTimeout(() => finish(oval, 'Location timed out, showing from the Oval'), FIX_TIMEOUT_MS);
    if (!navigator.geolocation) {
      clearTimeout(watchdog);
      return finish(oval, 'No location on this device, showing from the Oval');
    }
    const fail = (why) => {
      clearTimeout(watchdog);
      finish(oval, `${why}, showing from the Oval`);
    };
    try {
      navigator.geolocation.getCurrentPosition(
        (p) => {
          clearTimeout(watchdog);
          const here = { lon: p.coords.longitude, lat: p.coords.latitude };
          const far = Math.hypot((here.lon - oval.lon) * 85, (here.lat - oval.lat) * 111) > OFF_CAMPUS_KM;
          if (far) return finish(oval, NO_WALK_OVAL);
          finish(
            { ...here, accuracy: p.coords.accuracy, source: 'gps', label: null, at: Date.now() },
            null,
          );
        },
        (err) =>
          fail(err.code === 1 ? 'Location is off' : err.code === 2 ? 'Location unavailable' : 'Location timed out'),
        { enableHighAccuracy: false, timeout: FIX_TIMEOUT_MS, maximumAge: 60000 },
      );
    } catch {
      // A position source that throws on call is not a state the spec allows,
      // and it happens anyway inside locked-down webviews.
      fail('Location is unavailable');
    }
  });
}

// ---------------------------------------------------------------- boot

// The term label used to sit in the corner of the result list. It says more
// here, before any answer exists.
function provenance(current) {
  const term = current?.termName;
  if (!term) return;
  // The term, and nothing else. The read date sat here on every load and only
  // matters when it is OLD, which staleness() already reports on its own at 14
  // days and shouts at 35. scripts/shoot.mjs fails if this line goes empty, so
  // it is trimmed rather than removed.
  $('prov').innerHTML = `<b>${esc(term)}</b>`;
  $('prov').hidden = false;
}

// The abbreviation on the door lives in the full building table, which is 167 KB
// and has nothing else the app wants. It is fetched only when the picker opens,
// so it never sits on the path to a first answer, and the picker works without
// it: the rows are already tappable, the codes just arrive late.
let shortsPending = null;
function loadShorts() {
  if (state.shorts || shortsPending) return shortsPending;
  shortsPending = fetch(`${BASE}data/buildings.json`)
    .then((r) => r.json())
    .then((d) => {
      state.shorts = Object.fromEntries(Object.entries(d.buildings).map(([code, b]) => [code, b.short]));
      if (state.screen === 'pick') paintPick();
    })
    .catch(() => {
      /* the picker keeps working, without the two-letter codes */
    });
  return shortsPending;
}

// The room index is 191 KB of the 241 KB of JSON the first answer waits on, so
// it is the parse worth naming. `r.json()` hides it inside the fetch, and a
// cold phone spends real time in there. The engine marks the answer and the
// session mask with the same two calls.
async function parsedIndex(url, signal) {
  const text = await fetch(url, { signal }).then(answered).then((r) => r.text());
  mark('vacant:parse:start');
  const out = JSON.parse(text);
  mark('vacant:parse:end');
  measure('vacant:parse', 'vacant:parse:start', 'vacant:parse:end');
  return out;
}

// fetch resolves on a 5xx, so an error page reaches JSON.parse as if it were the
// schedule. Measured against a server answering 503 with the body "503": that is
// valid JSON, state.rooms became the number 503, and the app went on to blame
// its own weekly build for reading too few rooms.
function answered(r) {
  if (!r.ok) throw new Error(`${r.status} for ${r.url}`);
  return r;
}

async function boot() {
  // A network that stalls does not fail. Nothing rejects, so every step below
  // sits on it forever. One deadline covers the whole path to a first answer and
  // rejects into the same catch a 503 does. The position carries its own.
  const signal = AbortSignal.timeout(NETWORK_TIMEOUT_MS);
  const json = (f) => fetch(`${BASE}data/${f}`, { signal }).then(answered).then((r) => r.json());

  flyoverStart = performance.now();
  frames.wake();

  // Geolocation starts immediately and runs beside the fetches, so the two
  // waits overlap instead of queueing.
  const fix = locate();

  // The map is a layer, not the app. A missing or broken campus.json costs the
  // map and nothing else, so it is not awaited with the data the list needs.
  json('campus.json')
    .then((campus) => {
      state.campus = campus;
      const shorter = Math.min(window.innerWidth, window.innerHeight) || 390;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      state.basemap = buildBasemap(campus, pixelsPerGridFor(campus, shorter, dpr));
      // The first frame with anything to draw on it. render() paints nothing and
      // asks for nothing while state.basemap is null, so without this the map
      // stays black until the next tap.
      frames.wake();
      if (state.settled) settle();
    })
    .catch(() => {
      $('map').hidden = true;
      console.warn('Vacant: no basemap. The list still answers.');
    });

  const current = await json('current.json');
  state.current = current;
  provenance(current);

  const [rooms, buildings, hours, located] = await Promise.all([
    parsedIndex(`${BASE}${current.rooms}`, signal),
    fetch(`${BASE}${current.buildings}`, { signal }).then(answered).then((r) => r.json()).then((d) => d.buildings),
    json('buildings-hours.json').catch(() => null),
    fix,
  ]);
  state.rooms = rooms;
  state.buildings = buildings;
  state.counts = roomsPerBuilding(rooms);
  state.hours = hours;
  const [slug, table] = pickHoursTerm(hours, current);
  state.hoursSlug = slug;
  state.hoursTerm = table;
  useOrigin(located.origin, located.note);

  const now = clockNow();
  state.situation = resolveState({ now, current, index: rooms });
  state.rankable = state.situation.ranked;
  state.scheduled = inScheduledHours({ now, current, index: rooms });

  state.ready = true;
  for (const el of document.querySelectorAll('#ask [disabled]')) el.disabled = false;
  $('ask').classList.add('ready');
  paintChips();
  paintGate();
  performance.mark('vacant:ready');

  // A shared link opens on the room it names, with one screen behind it. Which
  // screen is not a detail: the ranked list is a claim about the whole campus,
  // and outside scheduled hours that claim is exactly the one this app refuses
  // to make. Opening the list here anyway put 40 rows one back press behind a
  // link tapped at 3am on a Saturday, with the reason sentence nowhere.
  const wanted = new URLSearchParams(location.search).get('room');
  if (wanted && rooms.rooms[wanted] && state.rankable) {
    if (state.scheduled) {
      showList();
      answer();
      history.replaceState({ v: 'list' }, '', cleanUrl());
    } else {
      showNear();
      history.replaceState({ v: 'near' }, '', cleanUrl());
    }
    openRoom(wanted);
  }
}

// Nothing came back, or what came back was not a schedule. The old catch left
// the spinner turning over four dead buttons and one sentence with no button on
// it, so the only exit was knowing to reload. It refuses in the card every other
// refusal uses instead, with the one control that can still change the answer.
function bootFailed() {
  // js/firstrun.js owns the refusal when nothing is cached, and its card is
  // modal and opaque. A second one under it is unreadable and still tabbable.
  if ($('cold')) return;
  $('ask-q').hidden = true;
  $('gate-h').textContent = 'Could not load the schedule.';
  $('gate-p').textContent = 'Vacant needs the network once to read this term.';
  $('gate-d').hidden = true;
  $('gate-go').hidden = false;
  $('gate-go').textContent = 'Try again';
  // A reload, not a second boot(): boot() starts a render loop and a position
  // request, and running it twice on one page is not a state this app has.
  $('gate-go').onclick = () => location.reload();
  $('gate').hidden = false;
  // "finding campus..." is keyed to #ask:not(.ready), which never clears here.
  $('ask').classList.add('failed');
  focusHeading($('gate-h'));
}

window.addEventListener('DOMContentLoaded', () => {
  for (const b of document.querySelectorAll('#ask [data-min]')) {
    b.onclick = () => choose(b.dataset.min);
  }
  attachChips();
  $('back').onclick = () => history.back();
  $('gate-go').onclick = () => openNear();
  $('ask-pick').onclick = () => openPick();
  $('note-pick').onclick = () => openPick();
  $('origin-where').onclick = () => openPick();
  $('origin-clear').onclick = () => clearPickedOrigin();
  $('find').onsubmit = (e) => e.preventDefault();
  $('find-q').oninput = (e) => {
    state.query = e.target.value;
    paintPick();
  };

  window.addEventListener('popstate', (e) => {
    const v = e.state?.v;
    if (v === 'room') showRoom(e.state.room);
    else if (v === 'list') showList();
    else if (v === 'near') showNear();
    else if (v === 'pick') showPick();
    else if (v === 'about') showAbout();
    else showAsk();
  });

  // Coming back to the foreground is the one moment the answer on screen is
  // certainly stale: the walk happened, the class started, and it may not even
  // be the same day.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    // The question screen is in this list because the night gate's heading is a
    // live minute. Left out, a card booted at 11:40pm on a Monday still read
    // "Monday, 11:40pm" at 10:00am on the Tuesday, on a minute the app ranks.
    if (state.screen === 'list' || state.screen === 'near' || state.screen === 'ask') refresh();
  });

  attachSheet();
  window.addEventListener('resize', () => {
    if (state.screen !== 'ask') sheetHeight();
    // surface() reallocates the backing store on the next frame and the band
    // moves with the height, so a resize that does not reach the loop leaves a
    // stretched bitmap composed for the old screen.
    frames.wake();
  });

  // js/install.js writes --bar-h on the body when the install rail mounts or is
  // dismissed, and railHeight() feeds the band the map centres in. That is the
  // one layout change the app makes that no event announces, and --bar-h is the
  // only inline style anything sets on the body.
  new MutationObserver(() => frames.wake()).observe(document.body, {
    attributes: true,
    attributeFilter: ['style'],
  });

  // Drag to pan, wheel or pinch to zoom. Once a finger has moved the camera the
  // app stops reframing on selection, otherwise every row tap would undo it.
  attachGestures($('map'), {
    onPan: (dx, dy) => {
      if (!state.basemap || !state.view) return;
      state.view = panBy(state.view, dx, dy, state.basemap, viewport());
      state.userMoved = true;
      frames.wake();
    },
    onZoom: (factor, anchor) => {
      if (!state.basemap || !state.view) return;
      state.view = zoomBy(state.view, factor, state.basemap, viewport(), anchor);
      state.userMoved = true;
      frames.wake();
    },
  });

  armDev();

  boot().catch(bootFailed);
});

// ------------------------------------------------------------- the dev seam
//
// Three functions, imported by js/dev.js and by nothing else. They exist
// because the interesting states of this app are all somewhere else: exam week,
// Thanksgiving, 9pm on a Saturday, standing in Kottman Hall. Every one of them
// used to need a plane ticket or a December.
//
// Nothing here is a mock. devApply moves the same clock the app reads and the
// same origin the ranking measures from, and then calls the same refresh() the
// duration chips call. What the panel shows is what the app does.

export { state as devState };

// Move the clock, the place, or both, and repaint whatever screen is up.
export function devApply({ at, origin, note } = {}) {
  if (at !== undefined) pinClock(at);
  if (origin !== undefined) useOrigin(origin, note ?? null);
  if (!state.ready) return;
  state.day = clockNow().getDay();
  refresh();
  if (state.screen === 'ask') paintGate();
}

// What the app currently believes, for the panel's readout. A copy, so the
// panel cannot write to it by accident.
export function devReadout() {
  return {
    ready: state.ready,
    screen: state.screen,
    when: clockNow().toString(),
    // Whether the minute on screen is the real one. The panel says so out
    // loud, because a simulated clock that looks live is how you end up
    // reporting a bug against a Tuesday in November.
    simulated: clockIsPinned(),
    day: state.day,
    rankable: state.rankable,
    scheduled: state.scheduled,
    refused: state.situation?.refused ?? null,
    heading: state.situation?.heading ?? null,
    duration: state.duration,
    total: state.total ?? null,
    origin: state.origin ? { ...state.origin } : null,
    top: (state.results ?? []).slice(0, 3).map((r) => ({
      id: r.id,
      name: r.name,
      walk: r.walk,
      usable: r.usable,
      hoursKnown: r.hoursKnown,
    })),
  };
}

// --------------------------------------------------------------- arming dev
//
// js/dev.js is loaded on demand and is not in the service worker's shell list,
// so a student who never asks for it never downloads it: it costs the shipped
// app one import() call and nothing over the wire. Ask for it with ?dev=1 in
// the URL, with #dev, or by pressing D three times.
//
// The choice is remembered in sessionStorage, because the app rewrites its own
// URL on the first history entry it pushes and a query string does not survive
// that.
const DEV_KEY = 'vacant.dev';

function openDev() {
  if (document.getElementById('dev')) return;
  import('./dev.js')
    .then((m) => m.start())
    .catch(() => {
      /* a dev panel that will not load is not worth breaking the app over */
    });
}

function armDev() {
  let armed = false;
  try {
    const url = new URLSearchParams(location.search);
    if (url.get('dev') === '1' || location.hash === '#dev') sessionStorage.setItem(DEV_KEY, '1');
    armed = sessionStorage.getItem(DEV_KEY) === '1';
  } catch {
    /* private mode with storage off is simply not in dev mode */
  }
  if (armed) {
    state.dev = true;
    openDev();
  }

  let hits = [];
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'd' && e.key !== 'D') return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    const t = Date.now();
    hits = hits.filter((h) => t - h < 2000);
    hits.push(t);
    if (hits.length < 3) return;
    hits = [];
    try {
      sessionStorage.setItem(DEV_KEY, '1');
    } catch {
      /* still opens, just does not survive a reload */
    }
    state.dev = true;
    openDev();
  });
}
