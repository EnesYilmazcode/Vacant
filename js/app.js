// Vacant. One question, then an answer.
//
// Cold start:
//   the question paints immediately, before any data
//   campus drifts underneath while the index parses and geolocation resolves
//   you tap a duration (or it is remembered) and the map settles on you
//
// The flyover is the LOADING STATE, not a gate. It must never add a second to
// the time from tap to answer.
//
// Three screens, one sheet: the question, the list, and one room. The sheet
// routes between the last two so the map, the highlight and the line stay on
// screen while you read a schedule.

import { toGrid } from './campus.js';
import { activeSessions, PACKUP, rank } from './engine.js';
import {
  FLYOVER_SPAN,
  SETTLED_SPAN,
  attachGestures,
  buildBasemap,
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

// Where campus actually is, as a fraction of the map's bounding box. Measured
// from the shipped data: the room-weighted centroid of buildings holding ranked
// classrooms is x 0.661, and the Oval, the geolocation fallback, is x 0.723.
const CORE_X = 0.661;
const CORE_Y = 0.5;

// The two sheet heights, as a fraction of the viewport. Measured on a 390x844
// phone: peek leaves a 523px map band, which is 832 m of ground, puts 32 of 40
// targets on screen and draws all 40 lines in full. Full leaves 186px, which is
// enough to know the map is still there.
const PEEK = 0.38;
const FULL = 0.78;

// Drag the sheet this far below peek and it means "take me back to the
// question", which is the same action the back arrow fires.
const DISMISS_PX = 44;

// A fix this coarse turns every walk time into an estimate, so the row says
// "~4 min" and the accessible name says "about 4 minutes".
const COARSE_M = 75;

// Passing periods are 15 minutes and 40% of a day's free blocks are under 20,
// so a row each fills the room screen with corridor traffic. Anything shorter
// than this is drawn as a rule between two classes instead.
const SEAM_MIN = 20;

const TYPE_WORDS = {
  '1A': 'seminar room',
  '1B': 'classroom',
  '1C': 'lecture hall',
  LCTR: 'lecture hall',
  SMNR: 'seminar room',
};

const $ = (id) => document.getElementById(id);

const state = {
  campus: null,
  basemap: null,
  view: null,
  band: null,
  userMoved: false,
  rooms: null,
  buildings: null,
  hoursTerm: null,
  current: null,
  origin: null,
  accuracy: null,
  originIsGuess: true,
  needed: Number(safeGet(KEY)) || 30,
  results: [],
  total: 0,
  day: new Date().getDay(),
  soonest: null,
  selected: null,
  settled: false,
  ready: false,
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

const clock = (m) => {
  const h24 = Math.floor(m / 60) % 24;
  const mm = String(Math.floor(m) % 60).padStart(2, '0');
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h}:${mm}${h24 < 12 ? 'am' : 'pm'}`;
};
const dur = (m) => (m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}` : `${m} min`);
const durShort = (m) => (m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}` : `${m}m`);
const isoDate = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => `&${{ '&': 'amp', '<': 'lt', '>': 'gt', '"': 'quot' }[c]};`);

// Spoken forms. A screen reader gets words where the screen gets glyphs, so
// "7:50p" is read as "7:50 pm" and "2h05" as "2 hours 5 minutes".
const spokenClock = (m) => {
  const h24 = Math.floor(m / 60) % 24;
  const mm = Math.floor(m) % 60;
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h}:${String(mm).padStart(2, '0')} ${h24 < 12 ? 'am' : 'pm'}`;
};
const spokenDur = (m) => {
  const h = Math.floor(m / 60);
  const mm = Math.floor(m) % 60;
  const parts = [];
  if (h) parts.push(`${h} hour${h === 1 ? '' : 's'}`);
  if (mm || !h) parts.push(`${mm} minute${mm === 1 ? '' : 's'}`);
  return parts.join(' ');
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtDay(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  return Number.isFinite(m) ? `${MONTHS[m - 1]} ${d}` : String(iso);
}

const say = (text) => {
  $('say').textContent = text;
};

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
  return c.getContext('2d');
}

// The map's viewport is not the canvas box. `band` is the strip of canvas the
// sheet is not covering, and the map centres on the middle of THAT, which is
// what puts the you-dot back on screen. It is cached rather than measured,
// because reading the sheet's rect inside the frame loop forces layout sixty
// times a second.
function viewport() {
  const width = lastSize.w || window.innerWidth;
  const height = lastSize.h || window.innerHeight;
  return {
    width,
    height,
    band: state.band ?? height,
    dpr: lastSize.dpr || Math.min(window.devicePixelRatio || 1, 2),
  };
}

function render(now) {
  raf = requestAnimationFrame(render);
  if (!state.basemap) return;
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
  if (!state.view) return;

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
        label: Number.isFinite(state.selected.walk) ? `${state.selected.walk} min walk` : '',
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
}

function settle() {
  state.settled = true;
  $('map').classList.add('settled');
  if (!state.origin || !state.campus || !state.basemap || state.userMoved) return;
  const [cx, cy] = toGrid([state.origin.lon, state.origin.lat], state.campus);
  state.view = makeView({ cx, cy, span: SETTLED_SPAN, rotation: 0 });
}

// Put you and the building on screen together. Once a finger has moved the
// camera this stops firing, otherwise every row tap would undo the gesture.
function frame(r) {
  if (!state.basemap || !state.campus || state.userMoved || !state.origin) return;
  const b = state.buildings?.[r.building];
  if (!b || !Number.isFinite(b.lat) || !Number.isFinite(b.lon)) return;
  const you = toGrid([state.origin.lon, state.origin.lat], state.campus);
  const target = toGrid([b.lon, b.lat], state.campus);
  state.view = fitPair(you, target, state.basemap, viewport());
}

// ---------------------------------------------------------------- the sheet

let sheetH = 0;
// Assigned by attachSheet. Replacing a pane's markup resets its scrollTop
// without firing a scroll event, so the paint has to re-sync touch-action.
let syncPaneTouch = () => {};

function setSheet(px, snap) {
  const H = window.innerHeight;
  const h = Math.max(PEEK * H - DISMISS_PX * 2, Math.min(FULL * H, px));
  sheetH = h;
  const sheet = $('sheet');
  sheet.classList.toggle('snap', Boolean(snap));
  sheet.style.height = `${Math.round(h)}px`;
  state.band = Math.max(0, H - h);
}

function attachSheet() {
  const sheet = $('sheet');
  const handle = $('handle');
  const panes = [$('list'), $('room')];
  const pane = () => ($('room').hidden ? $('list') : $('room'));
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
    else setSheet(drag.h0 - dy, false);
    e.preventDefault();
  });

  const end = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const mode = drag.mode;
    const v = drag.v;
    drag = null;
    syncTouch();
    if (mode !== 'sheet') return;
    const H = window.innerHeight;
    const peek = PEEK * H;
    const full = FULL * H;
    if (sheetH < peek - DISMISS_PX) {
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
  state.day = now.getDay();
  const results = rank(
    Object.entries(state.rooms.rooms).map(([id, r]) => ({ id, ...r })),
    {
      origin: state.origin,
      now: minutes,
      day: state.day,
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
  state.total = usable.length;
  state.results = usable.slice(0, 40);
  // Nothing is selected until a finger picks one. Asserting row one here is
  // what made the highlight fire on load and never move again.
  state.selected = null;
  state.listScroll = 0;
  paintList();
  settle();
  say(`${state.total} room${state.total === 1 ? '' : 's'} free, ${state.results.length} shown.`);
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

// The end of the row's window, said twice: once in glyphs and once in words.
function windowOf(r) {
  if (r.wait > 0) {
    return {
      html: `<span class="warn">from ${clock(r.availableAt)}</span>`,
      say: `free at ${spokenClock(r.availableAt)} then ${spokenDur(r.usable ?? 0)}`,
    };
  }
  if (!r.hoursKnown) {
    return {
      html: '<span class="warn">hours not published</span>',
      say: 'opening hours are not published for this building so Vacant cannot say when it locks',
    };
  }
  const close = closeOf(r.building);
  // 83.4% of rows end because the door locks and 16.6% because a class walks
  // in. Those are different promises, so the smaller half is the one marked.
  const byClass = close != null && r.nextClassAt < close;
  return {
    html: `till ${clock(r.usableUntil)}${byClass ? ', class' : ''}`,
    say: `free until ${spokenClock(r.usableUntil)}${byClass ? ' when a class starts' : ''}`,
  };
}

function seatsOf(r) {
  return r.seats
    ? { html: `${r.seats} seats`, say: `${r.seats} seats` }
    : { html: 'seats unknown', say: 'seat count not published' };
}

const WALK_ICON = '<svg class="ico" aria-hidden="true"><use href="#i-walk"/></svg>';

function paintList() {
  const list = $('list');

  if (!state.results.length) {
    const next = state.soonest;
    list.innerHTML =
      '<p class="strip">Nothing open right now.</p>' +
      (next
        ? `<p class="empty">Every classroom building near you is closed.
           The first one open is <b>${esc(next.name ?? next.id)}</b> at <b>${clock(next.availableAt)}</b>.</p>`
        : `<p class="empty">No room is free for ${dur(state.needed)} today. Try a shorter time.</p>`);
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
  const more = state.total - state.results.length;

  list.innerHTML =
    strip +
    caveat +
    state.results
      .map((r, i) => {
        const label = roomLabel(r);
        const win = windowOf(r);
        const seats = seatsOf(r);
        const walkSay = coarse ? `about ${r.walk} minutes walk` : `${r.walk} minute walk`;
        // The visible row is glyphs and an icon. The name a screen reader gets
        // is written out, because the computed name would be "Page Hall 110B 4
        // min": no unit, no window, no caveat.
        const name = `${label}, ${walkSay}, ${win.say}, ${seats.say}. Class schedule only, the door may be locked.`;
        return `<button type="button" class="row" data-i="${i}" aria-label="${esc(name)}">
        <span class="r-name">${esc(label)}</span>
        <span class="r-walk">${WALK_ICON}${coarse ? '~' : ''}${r.walk} min</span>
        <span class="r-win">${win.html} &middot; ${seats.html}</span>
        <span class="r-chev"></span>
      </button>`;
      })
      .join('') +
    `<p class="foot">${more > 0 ? `<b>${more} more</b> further away. ` : ''}Class schedule only.
       Clubs book rooms and doors get locked.</p>`;

  for (const el of list.querySelectorAll('.row')) {
    el.onclick = () => select(Number(el.dataset.i));
  }
  markRows();
  syncPaneTouch();
}

const CHEV = '<svg class="ico" aria-hidden="true"><use href="#i-chev"/></svg>';

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
  setSheet(PEEK * window.innerHeight, true);
  frame(r);
  say(`${roomLabel(r)}, ${r.walk} minute walk, shown on the map.`);
}

// ---------------------------------------------------------------- the room

// Today's blocks for one room, session mask applied, overlaps merged but
// back-to-back classes left as two.
function blocksToday(room) {
  const active = activeSessions(state.rooms.sessions, isoDate(new Date()));
  const raw = [];
  for (const b of room.busy ?? []) {
    if (Number(b[0]) !== state.day) continue;
    if (active && b[3] !== undefined && active[b[3]] === false) continue;
    const [, s, e] = b;
    if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) continue;
    raw.push([s, e]);
  }
  raw.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const b of raw) {
    const last = merged[merged.length - 1];
    if (last && b[0] < last[1]) last[1] = Math.max(last[1], b[1]);
    else merged.push([...b]);
  }
  return merged;
}

// The timeline, as rows. Free blocks are the content and classes are the
// frame, so a free block carries a start, the word and a length, and a class
// carries a start and nothing else.
function timelineRows(room, bname, nowMin) {
  const hours = hoursFor(room.b, state.day);
  const blocks = blocksToday(room);
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
    rows.push({ kind: 'free', t: from, end: to, len, now: nowMin >= from && nowMin < to });
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
// screen that talks about now.
function claimFor({ rows, blocks, open, close }, nowMin, bname) {
  if (nowMin < open) {
    const first = rows.find((r) => r.kind === 'free');
    return {
      head: `${bname} opens at ${clock(open)}`,
      sub: first ? `Free from ${clock(first.t)} for ${dur(first.len - PACKUP)}` : '',
    };
  }
  if (nowMin >= close) return { head: `${bname} is closed for the day`, sub: '' };

  const inClass = blocks.find(([s, e]) => nowMin >= s && nowMin < e);
  if (inClass) {
    const next = rows.find((r) => r.kind === 'free' && r.t >= inClass[1]);
    return {
      head: `In use till ${clock(inClass[1])}`,
      sub: next ? `Next free ${clock(next.t)}, for ${dur(next.len - PACKUP)}` : 'Nothing free after it today',
    };
  }
  const here = rows.find((r) => r.kind === 'free' && r.now);
  if (!blocks.length) return { head: 'No class in here all day', sub: '' };
  if (here) {
    const later = blocks.find(([s]) => s >= nowMin);
    return {
      head: later ? `Free till ${clock(later[0])}` : 'No class in here for the rest of today',
      sub: '',
    };
  }
  return { head: 'Nothing free in here right now', sub: '' };
}

function roomHtml(id) {
  const room = state.rooms.rooms[id];
  const b = state.buildings?.[room.b];
  const bname = shortName(b?.name ?? room.b);
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const r = state.results.find((x) => x.id === id);

  const tl = timelineRows(room, bname, nowMin);
  const claim = tl.closed
    ? { head: `${bname} is closed today`, sub: '' }
    : tl.nothing
      ? { head: 'No class in here all day', sub: '' }
      : claimFor(tl, nowMin, bname);

  const type = TYPE_WORDS[room.type];
  const facts = [
    r ? `<span class="w">${WALK_ICON}${r.walk} min walk</span>` : '',
    r ? `${r.metres} m` : '',
    room.cap ? `${room.cap} seats` : 'seats unknown',
    type ? esc(type) : '',
  ].filter(Boolean);

  const body = tl.closed
    ? `<p class="unknown">${esc(bname)} publishes today as closed, so there is nothing to show.</p>`
    : tl.nothing
      ? `<p class="unknown">No class is scheduled in here today, and nobody publishes hours for
         ${esc(bname)}, so Vacant cannot say when the door is unlocked.</p>`
      : (tl.known
          ? ''
          : `<p class="unknown">${esc(bname)} is not in the Registrar's hours table, so Vacant does
             not know when the doors are unlocked. The timeline stops at the first and last class.</p>`) +
        `<ul class="tl">${tl.rows.map(rowHtml).join('')}</ul>`;

  return `<h2>${esc(bname)} ${esc(room.n ?? '')}</h2>
    <p class="claim">${esc(claim.head)}${claim.sub ? `<span class="sub">${esc(claim.sub)}</span>` : ''}</p>
    <p class="facts">${facts.join('')}</p>
    ${body}
    <p class="foot">Class schedule only. Clubs book rooms and doors get locked.</p>`;
}

function rowHtml(row) {
  if (row.kind === 'seam') return '<li class="seam" aria-hidden="true"></li>';
  if (row.kind === 'free') {
    return `<li class="free${row.now ? ' now' : ''}"><span class="t">${clock(row.t)}</span>
      <span class="what">free</span><span class="len">${durShort(row.len)}</span></li>`;
  }
  if (row.kind === 'busy') {
    return `<li class="busy"><span class="t">${clock(row.t)}</span><span>in use</span></li>`;
  }
  return `<li class="edge">${row.t != null ? `<span class="t">${clock(row.t)}</span>` : ''}<span>${esc(row.text)}</span></li>`;
}

// ---------------------------------------------------------------- screens

function showAsk() {
  state.screen = 'ask';
  $('ask').hidden = false;
  $('sheet').hidden = true;
  $('back').hidden = true;
  $('room').hidden = true;
  $('list').hidden = false;
  state.settled = false;
  state.selected = null;
  state.listScroll = 0;
  state.userMoved = false;
  state.band = null;
  // The next answer opens at peek, whatever height the last one was dragged to.
  sheetH = 0;
  $('map').classList.remove('settled');
  flyoverStart = performance.now();
}

function showList() {
  state.screen = 'list';
  $('ask').hidden = true;
  $('sheet').hidden = false;
  $('room').hidden = true;
  $('list').hidden = false;
  $('back').hidden = false;
  $('back').setAttribute('aria-label', 'Back to the question');
  $('list').scrollTop = state.listScroll;
  syncPaneTouch();
  if (!sheetH) setSheet(PEEK * window.innerHeight, false);
  else setSheet(sheetH, false);
}

function showRoom(id) {
  const room = state.rooms?.rooms?.[id];
  if (!room) return showList();
  $('room').innerHTML = roomHtml(id);
  state.listScroll = $('list').scrollTop;
  $('ask').hidden = true;
  $('sheet').hidden = false;
  // Both panes stay in the DOM. That is the whole scroll-restoration
  // mechanism: #list keeps its scrollTop because it was never destroyed.
  $('list').hidden = true;
  $('room').hidden = false;
  $('room').scrollTop = 0;
  syncPaneTouch();
  $('back').hidden = false;
  $('back').setAttribute('aria-label', 'Back to the room list');
  state.screen = 'room';

  const r = state.results.find((x) => x.id === id);
  state.selected = r ?? { id, building: room.b, walk: null };
  // The sheet does not grow for this screen. Half of all rooms show their whole
  // day inside the peek height, and the three extra rows a taller sheet buys
  // are worth less than the highlight they would hide.
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

function choose(minutes) {
  // Belt and braces. The controls carry `disabled` until boot() finishes, but a
  // caller reaching here early would read state.rooms as null and throw.
  if (!state.ready) return;
  state.needed = minutes;
  safeSet(KEY, String(minutes));
  showList();
  answer();
  history.pushState({ v: 'list' }, '', cleanUrl());
}

function openRoom(id) {
  history.pushState({ v: 'room', room: id }, '', `?room=${encodeURIComponent(id)}`);
  showRoom(id);
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

// The term label used to sit in the corner of the result list. It says more
// here, before any answer exists, and outside the published instruction window
// it stops being a label and becomes a refusal.
function provenance(current) {
  const term = current?.termName;
  const read = current?.generated ? fmtDay(current.generated.slice(0, 10)) : null;
  if (!term) return;
  $('prov').innerHTML = `<b>${esc(term)}</b>${read ? `, schedule read ${esc(read)}` : ''}`;
  $('prov').hidden = false;

  const [from, to] = current.instruction ?? [];
  const today = isoDate(new Date());
  if (!from || !to || (today >= from && today <= to)) return;

  // A label lets a wrong-term answer render. A gate does not.
  const early = today < from;
  $('gate-h').textContent = early
    ? `${term} has not started yet`
    : `${term} ended on ${fmtDay(to)}`;
  $('gate-p').textContent = early
    ? `Classes run ${fmtDay(from)} to ${fmtDay(to)}. Until then the schedule says nothing about which rooms are empty, so Vacant is not answering.`
    : `Ohio State has not published a newer schedule yet. Vacant will not rank rooms against a term that is over.`;
  $('gate').hidden = false;
  for (const el of document.querySelectorAll('#ask .opts, #ask .until')) el.hidden = true;
  return true;
}

async function boot() {
  const json = (f) => fetch(`${BASE}data/${f}`).then((r) => r.json());

  flyoverStart = performance.now();
  raf = requestAnimationFrame(render);

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
      if (state.settled) settle();
    })
    .catch(() => {
      $('map').hidden = true;
      console.warn('Vacant: no basemap. The list still answers.');
    });

  const current = await json('current.json');
  state.current = current;
  const gated = provenance(current);

  const [rooms, buildings, hours, located] = await Promise.all([
    fetch(`${BASE}${current.rooms}`).then((r) => r.json()),
    fetch(`${BASE}${current.buildings}`).then((r) => r.json()).then((d) => d.buildings),
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

  if (gated) return;
  state.ready = true;
  for (const el of document.querySelectorAll('#ask [disabled]')) el.disabled = false;
  $('ask').classList.add('ready');
  performance.mark('vacant:ready');

  // A shared link opens on the room it names, with the list one tap behind it.
  const wanted = new URLSearchParams(location.search).get('room');
  if (wanted && rooms.rooms[wanted]) {
    showList();
    answer();
    history.replaceState({ v: 'list' }, '', cleanUrl());
    openRoom(wanted);
  }
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
  $('back').onclick = () => history.back();

  window.addEventListener('popstate', (e) => {
    const v = e.state?.v;
    if (v === 'room') showRoom(e.state.room);
    else if (v === 'list') showList();
    else showAsk();
  });

  attachSheet();
  window.addEventListener('resize', () => {
    if (state.screen !== 'ask') setSheet(sheetH || PEEK * window.innerHeight, false);
  });

  // Drag to pan, wheel or pinch to zoom. Once a finger has moved the camera the
  // app stops reframing on selection, otherwise every row tap would undo it.
  attachGestures($('map'), {
    onPan: (dx, dy) => {
      if (!state.basemap || !state.view) return;
      state.view = panBy(state.view, dx, dy, state.basemap, viewport());
      state.userMoved = true;
    },
    onZoom: (factor, anchor) => {
      if (!state.basemap || !state.view) return;
      state.view = zoomBy(state.view, factor, state.basemap, viewport(), anchor);
      state.userMoved = true;
    },
  });

  boot().catch(() => {
    $('note').textContent = 'Could not load the schedule. Check your connection and reload.';
    $('note').hidden = false;
  });
});
