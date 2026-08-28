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
import { activeSessions, distanceMetres, mark, measure, rank, walkMinutes } from './engine.js';
import {
  allWeekCodes,
  busyDayOf,
  clock,
  diagnosticsBlock,
  dur,
  durShort,
  fmtDay,
  inScheduledHours,
  isoDate,
  rankBuildings,
  resolveState,
  roomsPerBuilding,
  spokenClock,
  staleness,
  windowPhrase,
} from './state.js';
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

// Finder shares this origin, so the prefix is not optional.
const KEY_DURATION = 'vacant.duration';
const KEY_ORIGIN = 'vacant.origin';
const KEY_PICK = 'vacant.lastPick';

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
  accuracy: null,
  originIsGuess: true,
  duration: safeGet(KEY_DURATION) ?? '30',
  needed: 30,
  results: [],
  total: 0,
  day: new Date().getDay(),
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
// reads.
function focusHeading(el) {
  if (!el) return;
  el.setAttribute('tabindex', '-1');
  el.focus({ preventScroll: true });
}

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

const PANES = ['list', 'room', 'near', 'pick', 'about'];
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
  const now = new Date();
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
      // A day with no classes is a day the busy grid describes nobody. 788 of
      // 863 sampled Wednesday rows are still active on Veterans Day.
      classesSuspended: !!state.situation?.classesSuspended,
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
    list.innerHTML =
      note +
      '<h2 class="msg" id="list-h" tabindex="-1">Nothing open right now.</h2>' +
      (next
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
  const more = state.total - state.results.length;

  list.innerHTML =
    note +
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
    (more > 0 ? `<p class="foot"><b>${more} more</b> further away.</p>` : '') +
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
  setSheet(PEEK * window.innerHeight, true);
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

// The answer for 9:40pm on a Thursday and for every hour of every weekend. The
// schedule constrains roughly 943 of the 8,760 hours in a year, and outside it
// a ranked room list is a distance sort wearing the clothes of a schedule
// answer. The unit here is the building, because the real question is which
// door is even unlocked.
function paintNear(reason) {
  const now = new Date();
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

  const allWeek = new Set(allWeekCodes(state.hoursTerm));
  const read = state.hours?.generated ? fmtDay(state.hours.generated) : null;

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

  const row = (b) => {
    const [hoursText, hoursSay] = DOOR[b.when](b);
    const rooms = `${b.rooms} classroom${b.rooms === 1 ? '' : 's'}`;
    const name = `${shortName(b.name)}, ${b.walk} minute walk, ${rooms}, ${hoursSay}`;
    return `<button type="button" class="b-row" data-code="${esc(b.code)}" aria-label="${esc(name)}">
      <span class="r-name">${esc(shortName(b.name))}</span>
      <span class="r-walk">${WALK_ICON}${b.walk} min</span>
      <span class="r-win">${rooms}${allWeek.has(b.code) ? ' &middot; open every day' : ''}</span>
      <span class="b-hours${b.when === 'unknown' ? ' unknown-h' : ''}">${hoursText}</span>
    </button>`;
  };

  const openGroup = groups.open.length
    ? `<p class="grp">Open now${read ? `<span class="when">Registrar hours, read ${esc(read)}</span>` : ''}</p>` +
      groups.open.map(row).join('')
    : '';
  const unknownGroup = groups.unknown.length
    ? '<p class="grp">Hours not published</p>' + groups.unknown.map(row).join('')
    : '';
  const closedGroup = groups.closed.length
    ? `<p class="grp"><button type="button" class="bar-btn" data-more="closed" aria-expanded="false">
         ${groups.closed.length} building${groups.closed.length === 1 ? ' is' : 's are'} closed now</button></p>
       <div id="closed-list" hidden>${groups.closed.map(row).join('')}</div>`
    : '';

  $('near').innerHTML =
    `<h2 class="msg" id="near-h" tabindex="-1">${esc(reason.head)}</h2>
     <p class="why">${esc(reason.body)}</p>` +
    openGroup +
    unknownGroup +
    (groups.open.length || groups.unknown.length
      ? ''
      : '<p class="empty">Nothing in the index has a coordinate to walk to.</p>') +
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
  setSheet(PEEK * window.innerHeight, true);
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
  head: 'Nothing is scheduled right now',
  body: 'No class is meeting anywhere on campus at this minute, so the schedule cannot tell you what is empty.',
};

// Why this screen and not a room list. The locked-door caveat lives in this
// sentence rather than in a footer, because on this screen it is the answer
// rather than a disclaimer under it.
function nearReason() {
  const s = state.situation;
  const base = s && !s.ranked ? { head: s.heading, body: s.body } : UNSCHEDULED;
  return {
    head: base.head,
    body:
      `${base.body} These are the nearest buildings that hold classrooms, and a building being ` +
      'open is not a promise that a room inside it is unlocked.',
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
  });
}

function useOrigin(origin, note) {
  state.origin = origin;
  state.accuracy = origin.accuracy;
  // The one place the app branches on where the origin came from. Nothing in
  // ranking, the off-campus gate or the buildings screen reads it.
  state.originIsGuess = origin.source === 'oval';
  $('note-text').textContent = note ?? '';
  $('note').hidden = !note;
  $('note-pick').hidden = !note;
  $('ask-pick').hidden = !note;
  paintOriginBar();
}

function paintOriginBar() {
  const picked = state.origin?.source === 'picked';
  const label = picked ? state.origin.label : state.originIsGuess ? 'the Oval' : 'your location';
  const where = $('origin-where');
  where.querySelector('span').innerHTML = `from <b>${esc(label)}</b>`;
  where.setAttribute('aria-label', `Measuring from ${label}. Pick a different building.`);
  $('origin-clear').hidden = !picked;
}

// -------------------------------------------------------------- the room

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
  const noDoors = (word) => `Nobody publishes when ${bname} ${word}`;

  switch (c.kind) {
    case 'opens':
      return {
        head: `${bname} opens at ${clock(c.at)}`,
        sub: c.next != null && c.yours > 0 ? `Free from ${clock(c.next)} for ${dur(c.yours)}` : '',
      };
    case 'before-first-class':
      return { head: `First class in here is at ${clock(c.at)}`, sub: noDoors('unlocks') };
    case 'closed-for-day':
      return { head: `${bname} is closed for the day`, sub: '' };
    case 'after-last-class':
      return { head: `Last class in here ended at ${clock(c.at)}`, sub: noDoors('locks') };
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
      return { head: 'No class in here all day', sub: '' };
    case 'free':
      // With no published hours the sentence about the door outranks the
      // sentence about the window. "Yours for 45 min" under a headline that
      // already admits nobody knows when the building locks reads as a promise
      // the line above it just refused to make.
      if (!c.known) {
        return {
          head: c.until == null ? 'No class in here for the rest of today' : `No class in here till ${clock(c.until)}`,
          sub: noDoors('locks'),
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
      return { head: 'Nothing free in here right now', sub: '' };
  }
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
  const now = new Date();
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

  const tl = timelineRows(room, bname, nowMin);
  const claim = tl.closed
    ? { head: `${bname} is closed today`, sub: '' }
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
  const facts = [
    walk == null ? '' : `<span class="w">${WALK_ICON}${walk} min walk</span>`,
    Number.isFinite(metres) ? `<span>${metres} m</span>` : '',
    room.cap ? `<span>${room.cap} seats</span>` : '<span>seats unknown</span>',
    type ? `<span>${esc(type)}</span>` : '',
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

  const acts =
    b && Number.isFinite(b.lat)
      ? `<p class="acts">
          <button type="button" id="bearing" class="bar-btn">
            <svg class="ico" aria-hidden="true" hidden><use href="#i-arrow"/></svg>
            <span>Point me at it</span>
          </button>
          <a class="bar-btn" href="geo:${b.lat},${b.lon}?q=${b.lat},${b.lon}(${encodeURIComponent(bname)})">Open in Maps</a>
          <button type="button" class="bar-btn" data-act="about">What Vacant knows</button>
        </p>`
      : '';

  return `<h2 id="room-h" tabindex="-1">${esc(bname)} ${esc(room.n ?? '')}</h2>
    <p class="claim">${esc(claim.head)}${claim.sub ? `<span class="sub">${esc(claim.sub)}</span>` : ''}</p>
    <p class="facts">${facts.join('')}</p>
    ${acts}
    ${body}
    ${CAVEAT}`;
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
  const busy = blocksToday(room);
  const active = activeSessions(state.rooms.sessions, isoDate(new Date()));
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
      nowMin: nowMinutes(new Date()),
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

  const now = new Date();
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
      logs, so your coordinates stay out of it until you tick the box.</p>`;

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
  $('origin').hidden = name !== 'list' && name !== 'near';
  $('ask').hidden = true;
  $('sheet').hidden = false;
  $('back').hidden = false;
  state.screen = name;
  syncPaneTouch();
}

function showAsk() {
  state.screen = 'ask';
  $('ask').hidden = false;
  $('sheet').hidden = true;
  $('back').hidden = true;
  for (const id of PANES) $(id).hidden = id !== 'list';
  state.settled = false;
  state.selected = null;
  state.listScroll = 0;
  state.userMoved = false;
  state.band = null;
  // The next answer opens at peek, whatever height the last one was dragged to.
  sheetH = 0;
  $('map').classList.remove('settled');
  flyoverStart = performance.now();
  if (orientationOff) orientationOff();
}

function sheetHeight(fraction) {
  if (!sheetH) setSheet(fraction * window.innerHeight, false);
  else setSheet(sheetH, false);
}

function showList() {
  showPane('list');
  $('back').setAttribute('aria-label', 'Back to the question');
  $('list').scrollTop = state.listScroll;
  sheetHeight(PEEK);
}

function showNear() {
  state.listScroll = 0;
  showPane('near');
  $('back').setAttribute('aria-label', 'Back to the question');
  paintNear(nearReason());
  $('near').scrollTop = 0;
  sheetHeight(PEEK);
  focusHeading($('near-h'));
  settle();
}

function showPick() {
  loadShorts();
  showPane('pick');
  $('back').setAttribute('aria-label', 'Back without picking a building');
  paintPick();
  $('pick').scrollTop = 0;
  setSheet(FULL * window.innerHeight, true);
  focusHeading($('pick-h'));
}

function showAbout() {
  showPane('about');
  $('back').setAttribute('aria-label', 'Back');
  setSheet(FULL * window.innerHeight, true);
  paintAbout();
}

function showRoom(id) {
  const room = state.rooms?.rooms?.[id];
  if (!room) return showList();
  if (!$('list').hidden) state.listScroll = $('list').scrollTop;
  $('room').innerHTML = roomHtml(id);
  // Both panes stay in the DOM. That is the whole scroll-restoration
  // mechanism: #list keeps its scrollTop because it was never destroyed.
  showPane('room');
  $('room').scrollTop = 0;
  $('back').setAttribute('aria-label', 'Back to the room list');

  const r = state.results.find((x) => x.id === id);
  state.selected = r ?? { id, building: room.b, walk: null };
  attachBearing(id);
  for (const el of $('room').querySelectorAll('[data-act]')) el.onclick = () => openAbout();
  focusHeading($('room-h'));
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
  history.pushState({ v: 'room', room: id }, '', `?room=${encodeURIComponent(id)}`);
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
  const now = new Date();
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
  const stale = staleness({ now: new Date(), current: state.current });
  $('stale').hidden = stale.level === 'silent' || stale.level === 'gated';
  $('stale').textContent = stale.text;
  $('stale').classList.toggle('banner', stale.level === 'banner');

  if (!s || s.ranked) {
    $('gate').hidden = true;
    $('ask-q').hidden = false;
    if (!state.scheduled && state.ready) {
      $('ask-q').hidden = true;
      $('gate-h').textContent = UNSCHEDULED.head;
      $('gate-p').textContent = UNSCHEDULED.body;
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

  const oval = { lat: 39.9995, lon: -83.013, accuracy: null, source: 'oval', label: 'the Oval', at: Date.now() };
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
          if (far) return finish(oval, 'You are off campus, showing from the Oval');
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
  const read = current?.generated ? fmtDay(current.generated.slice(0, 10)) : null;
  if (!term) return;
  $('prov').innerHTML = `<b>${esc(term)}</b>${read ? `, schedule read ${esc(read)}` : ''}`;
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
async function parsedIndex(url) {
  const text = await fetch(url).then((r) => r.text());
  mark('vacant:parse:start');
  const out = JSON.parse(text);
  mark('vacant:parse:end');
  measure('vacant:parse', 'vacant:parse:start', 'vacant:parse:end');
  return out;
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
  provenance(current);

  const [rooms, buildings, hours, located] = await Promise.all([
    parsedIndex(`${BASE}${current.rooms}`),
    fetch(`${BASE}${current.buildings}`).then((r) => r.json()).then((d) => d.buildings),
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

  const now = new Date();
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
    if (state.screen === 'list' || state.screen === 'near') refresh();
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
    $('note-text').textContent = 'Could not load the schedule. Check your connection and reload.';
    $('note').hidden = false;
  });
});
