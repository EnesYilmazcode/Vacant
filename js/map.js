// Draw campus on a canvas, dark, from data/campus.json.
//
// The basemap is rendered ONCE into an offscreen canvas and then blitted with a
// transform every frame. There are about 1,500 paths on screen; re-stroking
// them at 60 fps would pin a phone's main thread, and the flyover in particular
// only ever changes the transform, never the geometry.
//
// A VIEWPORT is { width, height, band, dpr }, all in CSS pixels except dpr.
// `band` is the distance from the top of the canvas to the top of the sheet,
// and it is what the map centres itself in. The canvas is the whole screen but
// the sheet covers the bottom of it, so centring on height/2 put the user's own
// dot 101 px behind the sheet on a 390x844 phone and drew 0 of 40 you-to-room
// lines in full. `band` defaults to `height`, which is the old behaviour.
//
// The camera functions below are pure: they take a view and return a new one,
// so they test under node with no DOM. Gesture listening is the one piece here
// that touches the document, and it never touches a view.

import { aspect, decodeFeature, decodeShape } from './campus.js';

// Dark, because the app is used at night and in stairwells, and because the map
// is the surface of the app rather than a panel inside it.
export const PALETTE = {
  bg: '#0b0d10',
  landscape: '#131e18',
  water: '#0c1f2b',
  street: '#1d2530',
  building: '#28313d',
  buildingEdge: '#3a4653',
  target: '#ff4d3d',
  targetGlow: 'rgba(255, 77, 61, 0.22)',
  you: '#4cc2ff',
  youHalo: 'rgba(76, 194, 255, 0.16)',
  guess: '#8b94a2',
  line: '#ff6a5a',
};

// The tightest view the app ever shows, and the one the raster has to support.
// It is SMALLER than the flyover span so that choosing a duration zooms IN.
// With settled at 0.42 against a 0.30 flyover, tapping snapped the view 40%
// wider, so the map fell away at the moment it should have closed in.
export const SETTLED_SPAN = 0.28;
export const FLYOVER_SPAN = 0.36;

// How far the camera may be driven. Fitting you and a room with 18% padding
// needs a span from 0.113 at the median to 0.431 at the worst of 160 sampled
// rows, so these are the ends of that measured range, rounded outward.
export const SPAN_MIN = 0.12;
export const SPAN_MAX = 0.45;
export const FIT_PAD = 0.18;

// Device pixels per raster pixel before the blit turns to mush. The raster is
// already at the MAX_RASTER_PX cap, so the only lever left at the tight end is
// refusing to zoom further: span 0.12 on a 390 px wide dpr-2 phone magnifies
// 2.92x, and a wider or denser screen goes past 3. Raising MAX_RASTER_PX
// instead costs a phone's memory for a raster it cannot hold.
export const MAX_MAGNIFICATION = 3;

// Stroke widths in METRES, not in raster pixels.
//
// They were `3 * sy * 400` and `1.2 * sy * 400`, which is resolution
// independent, so raising the raster resolution could never have fixed them:
// streets came out 41 m wide and building outlines 16 m. On screen that is a
// 24 px street on a 390 px phone, and an outline eating 30% of a median
// building in each direction, with neighbouring streets merging into slabs.
const STREET_M = 7;
const EDGE_M = 1.5;

// Cap on the offscreen raster. The ideal for a dpr-3 phone at the tightest span
// is a 43 MB canvas, which is not worth it.
const MAX_RASTER_PX = 6_000_000;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// The sheet covers the bottom of the canvas, so the map's usable height is the
// band above it. Callers that have no sheet pass none and get the old centring.
const bandOf = (viewport) => viewport.band ?? viewport.height;

// How much raster this device actually needs, so the blit is near 1:1 at the
// tightest view rather than magnifying a fixed bitmap. At the old fixed 0.014
// the raster was 1109x918, and span 0.30 blew it up 2.83x in device pixels on a
// dpr-2 phone. The 7 px blur had been hiding that until the blur was cut.
export function pixelsPerGridFor(campus, shorterCssPx, dpr, tightestSpan = SETTLED_SPAN) {
  const ideal = (shorterCssPx * dpr) / (tightestSpan * campus.grid);
  const cap = Math.sqrt(MAX_RASTER_PX / (campus.grid * campus.grid * aspect(campus)));
  return Math.min(ideal, cap);
}

// One offscreen render of everything that never moves.
//
// The canvas is NOT square. Grid space is not square either: toGrid normalises
// a non-square bounding box to 0..grid on both axes independently, so a square
// canvas compressed campus by 17% east to west, made every building 21% too
// tall for its width, and rotated the you-to-room bearing by up to 10 degrees.
// The x axis carries the aspect correction.
export function buildBasemap(campus, pixelsPerGrid) {
  const ar = aspect(campus);
  const sx = pixelsPerGrid * ar;
  const sy = pixelsPerGrid;
  const w = Math.ceil(campus.grid * sx);
  const h = Math.ceil(campus.grid * sy);

  // Metres per raster pixel, so a stroke width can mean something on the ground.
  const metresPerPx = ((campus.bbox[2] - campus.bbox[0]) * 85000) / w;

  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');

  g.fillStyle = PALETTE.bg;
  g.fillRect(0, 0, w, h);

  // Grid y runs north-up; canvas y runs down.
  const px = (x) => x * sx;
  const py = (y) => h - y * sy;

  const trace = (feature) => {
    g.beginPath();
    for (const ring of feature) {
      const pts = decodeShape(ring);
      g.moveTo(px(pts[0][0]), py(pts[0][1]));
      for (let i = 1; i < pts.length; i++) g.lineTo(px(pts[i][0]), py(pts[i][1]));
      g.closePath();
    }
  };

  for (const f of campus.layers.landscape ?? []) {
    trace(f);
    g.fillStyle = PALETTE.landscape;
    // Even-odd, so a feature's inner rings are holes rather than overpaint.
    g.fill('evenodd');
  }

  for (const f of campus.layers.water ?? []) {
    trace(f);
    g.fillStyle = PALETTE.water;
    g.fill('evenodd');
  }

  g.strokeStyle = PALETTE.street;
  g.lineWidth = Math.max(1, STREET_M / metresPerPx);
  g.lineJoin = 'round';
  g.lineCap = 'round';
  for (const f of campus.layers.street ?? []) {
    for (const ring of f) {
      const pts = decodeShape(ring);
      g.beginPath();
      g.moveTo(px(pts[0][0]), py(pts[0][1]));
      for (let i = 1; i < pts.length; i++) g.lineTo(px(pts[i][0]), py(pts[i][1]));
      g.stroke();
    }
  }

  g.lineWidth = Math.max(0.5, EDGE_M / metresPerPx);
  for (const f of campus.layers.building ?? []) {
    trace(f);
    g.fillStyle = PALETTE.building;
    g.fill('evenodd');
    g.strokeStyle = PALETTE.buildingEdge;
    g.stroke();
  }

  return { canvas: c, sx, sy, width: w, height: h, size: h, metresPerPx };
}

// Where we are looking, and how hard we are zoomed. `span` is the fraction of
// the basemap's shorter axis visible across the shorter of the width and band.
export function makeView({ cx, cy, span, rotation = 0 }) {
  return { cx, cy, span, rotation };
}

const viewScale = (basemap, view, viewport) =>
  Math.min(viewport.width, bandOf(viewport)) / (view.span * basemap.size);

// ------------------------------------------------------------------- camera

// How far in the raster lets us go, and how far out is still campus rather
// than a grey rectangle with campus in the middle of it.
export function spanLimits(basemap, viewport, maxMagnification = MAX_MAGNIFICATION) {
  const shorter = Math.min(viewport.width, bandOf(viewport));
  const min = Math.max(SPAN_MIN, (shorter * (viewport.dpr ?? 1)) / (maxMagnification * basemap.size));
  return min > SPAN_MAX ? { min: SPAN_MAX, max: SPAN_MAX } : { min, max: SPAN_MAX };
}

// A view the user cannot get lost in: zoom inside the limits, and the visible
// rectangle inside the map. Pans off the edge are what make a hand-rolled map
// feel broken, because there is nothing out there to tell you which way back.
// Returns a new view; rotation passes through.
export function clampView(view, basemap, viewport) {
  const { min, max } = spanLimits(basemap, viewport);
  const span = clamp(view.span, min, max);
  const scale = Math.min(viewport.width, bandOf(viewport)) / (span * basemap.size);
  const gridW = basemap.width / basemap.sx;
  const gridH = basemap.height / basemap.sy;
  const halfW = viewport.width / (2 * scale * basemap.sx);
  const halfH = bandOf(viewport) / (2 * scale * basemap.sy);
  return makeView({
    // Wider than the map on an axis: centre on that axis rather than pin to an
    // edge, or the map slides to one side and stays there.
    cx: halfW * 2 >= gridW ? gridW / 2 : clamp(view.cx, halfW, gridW - halfW),
    cy: halfH * 2 >= gridH ? gridH / 2 : clamp(view.cy, halfH, gridH - halfH),
    span,
    rotation: view.rotation,
  });
}

// Drag. dxPx and dyPx are the finger's screen delta, and the map goes with the
// finger, so dragging right lowers cx. The delta is un-rotated first, because
// during the flyover the view is turned by up to 3 degrees.
export function panBy(view, dxPx, dyPx, basemap, viewport) {
  const scale = viewScale(basemap, view, viewport);
  const cos = Math.cos(view.rotation);
  const sin = Math.sin(view.rotation);
  const ux = dxPx * cos + dyPx * sin;
  const uy = -dxPx * sin + dyPx * cos;
  return clampView(
    makeView({
      cx: view.cx - ux / (scale * basemap.sx),
      cy: view.cy + uy / (scale * basemap.sy),
      span: view.span,
      rotation: view.rotation,
    }),
    basemap,
    viewport,
  );
}

// Pinch or wheel. factor above 1 zooms in. With an anchor, the ground under it
// stays under it; clamping at the limits can break that, which is what a map
// hitting its stop should feel like.
export function zoomBy(view, factor, basemap, viewport, anchorPx = null) {
  const { min, max } = spanLimits(basemap, viewport);
  const span = clamp(view.span / factor, min, max);
  if (!anchorPx) return clampView(makeView({ ...view, span }), basemap, viewport);
  const [gx, gy] = unproject(anchorPx, basemap, view, viewport);
  const k = span / view.span;
  return clampView(
    makeView({
      cx: gx + (view.cx - gx) * k,
      cy: gy + (view.cy - gy) * k,
      span,
      rotation: view.rotation,
    }),
    basemap,
    viewport,
  );
}

// Frame two points, which in practice is you and the room you are being sent
// to. A fixed span cannot do this: the span needed to hold both runs 0.113 at
// the median to 0.431 at the worst of 160 sampled rows, so at the shipped fixed
// 0.28 the target is off screen for the far half of the list.
export function fitPair(a, b, basemap, viewport, { pad = FIT_PAD, rotation = 0 } = {}) {
  const cx = (a[0] + b[0]) / 2;
  const cy = (a[1] + b[1]) / 2;
  const limits = spanLimits(basemap, viewport);

  // Separation in raster pixels, in the same axes drawFrame uses: x east, y
  // down. Rotation mixes the two, so it is applied before the extents are taken.
  const vx = (b[0] - a[0]) * basemap.sx;
  const vy = (a[1] - b[1]) * basemap.sy;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const ex = Math.abs(vx * cos - vy * sin);
  const ey = Math.abs(vx * sin + vy * cos);

  let span = limits.min;
  if (ex > 0 || ey > 0) {
    // A zero extent contributes Infinity, so the other axis decides.
    const scale = (1 - 2 * pad) * Math.min(viewport.width / ex, bandOf(viewport) / ey);
    span = Math.min(viewport.width, bandOf(viewport)) / (scale * basemap.size);
  }
  return clampView(makeView({ cx, cy, span, rotation }), basemap, viewport);
}

// Grid coordinates to screen pixels, for anything drawn on top of the basemap.
export function project([gx, gy], basemap, view, viewport) {
  const scale = viewScale(basemap, view, viewport);
  const dx = (gx - view.cx) * basemap.sx * scale;
  const dy = (view.cy - gy) * basemap.sy * scale;
  const cos = Math.cos(view.rotation);
  const sin = Math.sin(view.rotation);
  return [
    viewport.width / 2 + dx * cos - dy * sin,
    bandOf(viewport) / 2 + dx * sin + dy * cos,
  ];
}

// Screen pixels back to grid coordinates. Exact inverse of project, which is
// what makes anchored zoom land where the finger is.
export function unproject([x, y], basemap, view, viewport) {
  const scale = viewScale(basemap, view, viewport);
  const ux = x - viewport.width / 2;
  const uy = y - bandOf(viewport) / 2;
  const cos = Math.cos(view.rotation);
  const sin = Math.sin(view.rotation);
  const dx = ux * cos + uy * sin;
  const dy = -ux * sin + uy * cos;
  return [
    view.cx + dx / (scale * basemap.sx),
    view.cy - dy / (scale * basemap.sy),
  ];
}

// Ground metres one screen pixel covers, east to west. Grid space is not
// square, so the axis has to be named.
export function metresPerScreenPx(basemap, view, viewport) {
  return basemap.metresPerPx / viewScale(basemap, view, viewport);
}

// ---------------------------------------------------------------- footprints

const INDEX = Symbol('footprintIndex');

function footprintIndex(campus) {
  if (!campus[INDEX]) {
    const codes = Array.isArray(campus.buildingCode) ? campus.buildingCode : null;
    const byCode = new Map();
    const entries = (campus.layers.building ?? []).map((f, i) => {
      const rings = decodeFeature(f);
      let x = 0;
      let y = 0;
      for (const p of rings[0]) {
        x += p[0];
        y += p[1];
      }
      const entry = { rings, c: [x / rings[0].length, y / rings[0].length] };
      const code = codes?.[i];
      if (code && !byCode.has(code)) byCode.set(code, entry);
      return entry;
    });
    Object.defineProperty(campus, INDEX, {
      value: { entries, byCode },
      enumerable: false,
      configurable: true,
    });
  }
  return campus[INDEX];
}

// The footprint to light for a building. By key when the map carries keys, and
// by nearest centroid when it does not.
//
// The centroid guess is why the wrong building lights up today: 21 of 86
// buildings are decided by a margin under 30 m against a median footprint about
// 41 m across, and Biological Sciences, 14 rooms, is decided by 6.7 m. It stays
// as the fallback so this works against a map built either way.
export function footprintFor(campus, buildingCode, gridPt) {
  if (!campus?.layers?.building?.length) return null;
  const { entries, byCode } = footprintIndex(campus);

  if (typeof buildingCode === 'string' && buildingCode) {
    const hit = byCode.get(buildingCode);
    if (hit) return hit.rings;
  }
  if (!gridPt) return null;

  let best = null;
  let bestD = Infinity;
  for (const e of entries) {
    const d = Math.hypot(e.c[0] - gridPt[0], e.c[1] - gridPt[1]);
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  // Roughly 120 m in grid steps. Beyond that it is a different building.
  return bestD < campus.grid * 0.045 ? best.rings : null;
}

// ------------------------------------------------------------------ drawing

// Draw one frame. Everything that moves is a transform on a single drawImage.
export function drawFrame(ctx, basemap, view, viewport) {
  const { width, height, dpr = 1 } = viewport;
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = PALETTE.bg;
  ctx.fillRect(0, 0, width, height);

  const scale = viewScale(basemap, view, viewport);
  ctx.translate(width / 2, bandOf(viewport) / 2);
  ctx.rotate(view.rotation);
  ctx.scale(scale, scale);
  ctx.translate(-view.cx * basemap.sx, -(basemap.height - view.cy * basemap.sy));

  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(basemap.canvas, 0, 0);
  ctx.restore();
}

// The room you are being sent to: its footprint lit, and a line from you to it.
// The caller passes the footprint, so which building lights up is decided where
// the building code is known rather than guessed here.
//
// Widths and dashes are in screen pixels and so do not change with zoom. The
// dash length is tied to the line, because a fitted view can put you 40 px from
// the door and a fixed 7 px dash draws that as one solid stroke.
//
// NO TEXT. This used to take a `label` and paint "4 min walk" in a pill at the
// midpoint of the line. The walk minutes are computed through DETOUR = 1.3 in
// js/engine.js, so the pill stated the time to walk a path 30% longer than the
// straight line it was pinned to: the drawing and the label disagreed and the
// reader had no way to tell which one to believe. The number still appears on
// the row and on the room screen, where nothing contradicts it. Issue #75.
export function drawTarget(ctx, { footprint, from, to }, basemap, view, viewport) {
  const dpr = viewport.dpr ?? 1;
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  if (footprint?.length) {
    ctx.beginPath();
    for (const ring of footprint) {
      const pts = ring.map((p) => project(p, basemap, view, viewport));
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.closePath();
    }
    ctx.fillStyle = PALETTE.targetGlow;
    ctx.fill('evenodd');
    ctx.strokeStyle = PALETTE.target;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.stroke();
  }

  if (from && to) {
    const a = project(from, basemap, view, viewport);
    const b = project(to, basemap, view, viewport);
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    ctx.strokeStyle = PALETTE.line;
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    // Dashed, so it reads as a direction rather than a route through doors.
    const dash = clamp(len / 9, 3, 7);
    ctx.setLineDash([dash, dash]);
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();
}

// The dot, at a fixed screen size so it never falls under a pixel, and never
// gated on anything: the user's own position is drawn in every state.
const DOT_R = 7;

// Below this the accuracy ring is smaller than the dot, so it says nothing the
// dot does not already say and is left off.
const ACCURACY_MIN_PX = 14;

// You.
//
// `guess` means we never got a fix and this is the Oval standing in. Drawing
// that as a solid dot makes the one point we are least sure of look like the
// most confident thing on the map, so it is drawn hollow and muted instead.
// A real fix draws its accuracy radius, because a 100 m circle can swap the
// top two results and the user deserves to see that. Accuracy arrives in
// METRES and is converted here, so no caller has to know about basemap.sy.
export function drawYou(ctx, { at, accuracyM = 0, guess = false }, basemap, view, viewport) {
  if (!at) return;
  const dpr = viewport.dpr ?? 1;
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const [x, y] = project(at, basemap, view, viewport);

  if (guess) {
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = PALETTE.guess;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, 9, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
    return;
  }

  const accuracyPx = accuracyM > 0 ? accuracyM / metresPerScreenPx(basemap, view, viewport) : 0;
  if (accuracyPx > ACCURACY_MIN_PX) {
    ctx.beginPath();
    ctx.arc(x, y, accuracyPx, 0, Math.PI * 2);
    ctx.fillStyle = PALETTE.youHalo;
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(x, y, DOT_R, 0, Math.PI * 2);
  ctx.fillStyle = PALETTE.you;
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = PALETTE.bg;
  ctx.stroke();
  ctx.restore();
}

// --------------------------------------------------------------- frame loop

// A frame loop that stops.
//
// `draw` is called with the timestamp the frame callback was handed, and it
// returns true to say the picture is still moving and it wants another frame.
// Anything that changes the picture from outside the loop calls wake().
//
// The loop this replaces re-requested a frame on its first line,
// unconditionally, so it never stopped. Issue #75 counted it through a wrapped
// requestAnimationFrame on a settled screen with nothing selected and nothing
// animating: 290 callbacks in 2 seconds, every one of them painting the same
// picture, for as long as the app was open. A phone pays for that in heat.
//
// `request` is injected rather than read off window. It is the only thing in
// here that would need a browser, and passing it in keeps the loop testable
// under node and this file free of one more global.
export function createFrameLoop(request, draw) {
  let pending = false;

  const wake = () => {
    if (pending) return;
    pending = true;
    request(tick);
  };

  function tick(now) {
    // Cleared BEFORE the draw, so a wake() raised from inside it — a fix
    // arriving on the same tick, a caller repainting as it changes state — asks
    // for the next frame instead of being swallowed by a flag still set from
    // this one.
    pending = false;
    if (draw(now)) wake();
  }

  return {
    wake,
    // Only for tests and for anyone asking whether the loop is idle. There is
    // no stop(): the loop stops by not asking for another frame.
    get pending() {
      return pending;
    },
  };
}

// ----------------------------------------------------------------- gestures

const TAP_PX = 10;
const TAP_MS = 300;

// One pointer drags, two pinch, a wheel zooms, a press and release taps.
//
// This is the only part of the file that touches the document, and it deals in
// pixels only: it never sees a view, so the camera stays testable. touch-action
// has to go to none because index.html allows maximum-scale=5, and without it a
// pinch over the map zooms the whole page on iOS and the two fight.
export function attachGestures(canvas, { onPan, onZoom, onTap } = {}) {
  const pointers = new Map();
  const priorTouchAction = canvas.style.touchAction;
  canvas.style.touchAction = 'none';

  let rect = null;
  let start = null;
  let pinch = null;

  // The canvas is fixed and full screen, so its rect only changes on a resize.
  // Reading it per move would force layout on every frame of a drag.
  const invalidate = () => {
    rect = null;
  };
  const at = (e) => {
    if (!rect) rect = canvas.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  };
  const spread = () => {
    const [a, b] = [...pointers.values()];
    return { d: Math.hypot(a[0] - b[0], a[1] - b[1]), mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] };
  };

  const down = (e) => {
    invalidate();
    const p = at(e);
    pointers.set(e.pointerId, p);
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // The pointer went away between the event and here. Nothing to capture.
    }
    start = pointers.size === 1 ? { at: p, t: Date.now() } : null;
    pinch = pointers.size === 2 ? spread() : null;
    e.preventDefault();
  };

  const move = (e) => {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    const now = at(e);
    pointers.set(e.pointerId, now);
    if (pointers.size === 1) {
      onPan?.(now[0] - prev[0], now[1] - prev[1]);
    } else if (pointers.size === 2 && pinch) {
      const next = spread();
      if (pinch.d > 0 && next.d > 0) onZoom?.(next.d / pinch.d, next.mid);
      pinch = next;
    }
    e.preventDefault();
  };

  const up = (e) => {
    if (!pointers.has(e.pointerId)) return;
    const p = at(e);
    pointers.delete(e.pointerId);
    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch {
      // Already released, which happens on pointercancel.
    }
    if (pointers.size < 2) pinch = null;
    if (start && e.type === 'pointerup') {
      const moved = Math.hypot(p[0] - start.at[0], p[1] - start.at[1]);
      if (moved <= TAP_PX && Date.now() - start.t <= TAP_MS) onTap?.(p);
    }
    start = null;
    e.preventDefault();
  };

  const wheel = (e) => {
    if (!onZoom) return;
    e.preventDefault();
    // Lines and pages to pixels, so a mouse and a trackpad zoom at one rate.
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? canvas.clientHeight : 1;
    onZoom(Math.exp((-e.deltaY * unit) / 260), at(e));
  };

  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', wheel, { passive: false });
  window.addEventListener('resize', invalidate);

  return () => {
    canvas.removeEventListener('pointerdown', down);
    canvas.removeEventListener('pointermove', move);
    canvas.removeEventListener('pointerup', up);
    canvas.removeEventListener('pointercancel', up);
    canvas.removeEventListener('wheel', wheel);
    window.removeEventListener('resize', invalidate);
    canvas.style.touchAction = priorTouchAction;
    pointers.clear();
  };
}
