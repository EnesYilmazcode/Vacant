// The camera, offline. Every function under test is pure arithmetic over plain
// objects, so none of this needs a browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  FIT_PAD,
  MAX_MAGNIFICATION,
  SETTLED_SPAN,
  SPAN_MAX,
  SPAN_MIN,
  clampView,
  drawTarget,
  drawYou,
  fitPair,
  footprintFor,
  makeView,
  metresPerScreenPx,
  panBy,
  project,
  spanLimits,
  unproject,
  zoomBy,
} from '../../js/map.js';

// The shipped basemap, pinned to what buildBasemap actually produces for
// data/campus.json on a dpr-2 phone: a 2693x2229 raster at 0.99 m per pixel.
// Literals rather than a rebuild, because buildBasemap needs a canvas and
// because a fixture that re-derives the implementation's own formula would pass
// for a wrong one.
const BASEMAP = {
  sx: 0.04109250105127766,
  sy: 0.03399711528193119,
  width: 2693,
  height: 2229,
  size: 2229,
  metresPerPx: 0.993897140735481,
};

// A 390x844 phone. `band` is the map above the sheet: 523 px at the peek
// detent, 186 px at full.
const PEEK = { width: 390, height: 844, band: 523, dpr: 2 };
const FULL = { width: 390, height: 844, band: 186, dpr: 2 };
const LEGACY = { width: 390, height: 844, dpr: 2 };
// A wider, denser screen, where the magnification cap binds before SPAN_MIN.
const WIDE = { width: 430, height: 932, band: 560, dpr: 3 };

const CENTRE = makeView({ cx: 33000, cy: 33000, span: SETTLED_SPAN, rotation: 0 });
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) < tol, `${what}: ${a} vs ${b}`);

// --- the band, which is what hid the dot ---

test('the map centres in the band, not in the CSS box', () => {
  // The dot sat 101 px BELOW the top of the sheet on this phone, drawn
  // correctly and then covered, and 0 of 40 you-to-room lines were drawn in
  // full. The view centre must now land above the sheet.
  const at = project([CENTRE.cx, CENTRE.cy], BASEMAP, CENTRE, PEEK);
  assert.deepEqual(at, [195, 261.5]);
  assert.ok(at[1] < PEEK.band, 'the centre of the view is behind the sheet');
});

test('a viewport with no band behaves exactly as it did before', () => {
  const withBand = { ...LEGACY, band: LEGACY.height };
  assert.deepEqual(
    project([40000, 30000], BASEMAP, CENTRE, LEGACY),
    project([40000, 30000], BASEMAP, CENTRE, withBand),
  );
});

test('project and unproject are inverses, rotation included', () => {
  for (const view of [CENTRE, makeView({ ...CENTRE, rotation: 0.37 })]) {
    for (const g of [[33000, 33000], [41234, 28765], [10, 65000]]) {
      const back = unproject(project(g, BASEMAP, view, PEEK), BASEMAP, view, PEEK);
      near(back[0], g[0], 1e-6, 'gx');
      near(back[1], g[1], 1e-6, 'gy');
    }
  }
});

test('metres per screen pixel is the ground the band is showing', () => {
  const m = metresPerScreenPx(BASEMAP, CENTRE, PEEK);
  near(m, 1.5905, 0.001, 'metres per px');
  // 523 px of band at the settled span is about 830 m of campus, which is the
  // measured figure the peek detent was chosen on.
  near(m * PEEK.band, 832, 3, 'ground across the band');
});

// --- limits ---

test('zoom stops before the raster turns to mush', () => {
  const { min, max } = spanLimits(BASEMAP, WIDE);
  assert.equal(max, SPAN_MAX);
  assert.ok(min > SPAN_MIN, `min ${min} should be held above ${SPAN_MIN}`);
  const scale = Math.min(WIDE.width, WIDE.band) / (min * BASEMAP.size);
  near(scale * WIDE.dpr, MAX_MAGNIFICATION, 1e-9, 'magnification at the tightest span');
});

test('on a 390 px phone SPAN_MIN is the binding limit, at both detents', () => {
  // The scale axis is the shorter of the width and the band, so on this phone
  // the 390 px width decides at both detents and 0.12 is reached first. Span
  // 0.12 blits at 2.92x here, inside the cap.
  assert.equal(spanLimits(BASEMAP, PEEK).min, SPAN_MIN);
  assert.equal(spanLimits(BASEMAP, FULL).min, SPAN_MIN);
  const scale = Math.min(PEEK.width, PEEK.band) / (SPAN_MIN * BASEMAP.size);
  near(scale * PEEK.dpr, 2.92, 0.01, 'magnification at SPAN_MIN');
});

test('an impossible viewport collapses to a single span rather than inverting', () => {
  const huge = { width: 4000, height: 4000, band: 4000, dpr: 3 };
  const { min, max } = spanLimits(BASEMAP, huge);
  assert.equal(min, max);
  assert.equal(max, SPAN_MAX);
});

// --- clamping ---

test('clampView holds the span inside the limits and never mutates', () => {
  const tight = makeView({ cx: 33000, cy: 33000, span: 0.01, rotation: 0.2 });
  const out = clampView(tight, BASEMAP, PEEK);
  assert.equal(tight.span, 0.01, 'the input view was mutated');
  assert.equal(out.span, spanLimits(BASEMAP, PEEK).min);
  assert.equal(out.rotation, 0.2, 'rotation passes through');
  assert.equal(clampView(makeView({ ...CENTRE, span: 9 }), BASEMAP, PEEK).span, SPAN_MAX);
});

test('the visible rectangle cannot leave the map', () => {
  const off = clampView(makeView({ cx: 1e6, cy: -1e6, span: 0.2 }), BASEMAP, PEEK);
  const gridW = BASEMAP.width / BASEMAP.sx;
  const gridH = BASEMAP.height / BASEMAP.sy;
  const corner = unproject([0, 0], BASEMAP, off, PEEK);
  const far = unproject([PEEK.width, PEEK.band], BASEMAP, off, PEEK);
  assert.ok(corner[0] >= -1 && far[0] <= gridW + 1, `x ${corner[0]} to ${far[0]}`);
  assert.ok(far[1] >= -1 && corner[1] <= gridH + 1, `y ${far[1]} to ${corner[1]}`);
});

test('an axis wider than the map centres on it instead of pinning to an edge', () => {
  // A wide screen over a thin band: the view holds more east to west than
  // campus has, so x has to centre. Pinning it to an edge instead slides the
  // map to one side and leaves it there.
  const letterbox = { width: 2000, height: 400, band: 100, dpr: 1 };
  const out = clampView(makeView({ cx: 0, cy: 0, span: SPAN_MAX }), BASEMAP, letterbox);
  const gridW = BASEMAP.width / BASEMAP.sx;
  near(out.cx, gridW / 2, 1, 'cx centred');
  assert.ok(out.cy > 0, 'cy clamped rather than left at the corner');
});

// --- pan ---

test('the map goes with the finger', () => {
  const g = [40000, 30000];
  const before = project(g, BASEMAP, CENTRE, PEEK);
  const after = project(g, BASEMAP, panBy(CENTRE, 60, -25, BASEMAP, PEEK), PEEK);
  near(after[0] - before[0], 60, 1e-6, 'the ground followed x');
  near(after[1] - before[1], -25, 1e-6, 'the ground followed y');
});

test('dragging right lowers cx, and panning does not mutate', () => {
  const out = panBy(CENTRE, 80, 0, BASEMAP, PEEK);
  assert.ok(out.cx < CENTRE.cx, `cx went ${CENTRE.cx} to ${out.cx}`);
  assert.equal(CENTRE.cx, 33000);
  assert.equal(out.span, CENTRE.span);
});

test('pan is rotation aware', () => {
  // Turned a quarter turn, a sideways drag has to move the camera along the
  // other grid axis. During the flyover the view is rotated by up to 3 degrees,
  // so a naive pan would drift.
  const turned = makeView({ cx: 33000, cy: 33000, span: SETTLED_SPAN, rotation: Math.PI / 2 });
  const out = panBy(turned, 100, 0, BASEMAP, PEEK);
  near(out.cx, turned.cx, 1e-6, 'cx unchanged by a sideways drag at 90 degrees');
  assert.notEqual(out.cy, turned.cy, 'cy carried the drag instead');
  const g = [40000, 30000];
  const moved =
    project(g, BASEMAP, out, PEEK)[0] - project(g, BASEMAP, turned, PEEK)[0];
  near(moved, 100, 1e-6, 'the ground still followed the finger');
});

test('a fling stops at the edge of campus', () => {
  const out = panBy(CENTRE, 1e6, 1e6, BASEMAP, PEEK);
  const corner = unproject([0, 0], BASEMAP, out, PEEK);
  assert.ok(corner[0] >= -1, `left edge at ${corner[0]}`);
});

// --- zoom ---

test('zooming in divides the span, zooming out multiplies it', () => {
  assert.equal(zoomBy(CENTRE, 2, BASEMAP, PEEK).span, SETTLED_SPAN / 2);
  assert.equal(zoomBy(CENTRE, 0.5, BASEMAP, PEEK).span, SETTLED_SPAN * 2 <= SPAN_MAX ? SETTLED_SPAN * 2 : SPAN_MAX);
  assert.equal(CENTRE.span, SETTLED_SPAN, 'the input view was mutated');
});

test('an anchored zoom keeps the ground under the finger', () => {
  const anchor = [120, 90];
  const ground = unproject(anchor, BASEMAP, CENTRE, PEEK);
  for (const factor of [1.4, 0.7, 2.5]) {
    const out = zoomBy(CENTRE, factor, BASEMAP, PEEK, anchor);
    const back = project(ground, BASEMAP, out, PEEK);
    near(back[0], anchor[0], 1e-6, `x at factor ${factor}`);
    near(back[1], anchor[1], 1e-6, `y at factor ${factor}`);
  }
});

test('an anchored zoom is anchor aware when the view is rotated', () => {
  const turned = makeView({ cx: 33000, cy: 33000, span: SETTLED_SPAN, rotation: 0.5 });
  const anchor = [300, 60];
  const ground = unproject(anchor, BASEMAP, turned, PEEK);
  const back = project(ground, BASEMAP, zoomBy(turned, 1.6, BASEMAP, PEEK, anchor), PEEK);
  near(back[0], anchor[0], 1e-6, 'x');
  near(back[1], anchor[1], 1e-6, 'y');
});

test('zoom respects the same limits as everything else', () => {
  const { min, max } = spanLimits(BASEMAP, PEEK);
  assert.equal(zoomBy(CENTRE, 1000, BASEMAP, PEEK, [10, 10]).span, min);
  assert.equal(zoomBy(CENTRE, 0.001, BASEMAP, PEEK, [10, 10]).span, max);
});

test('a zoom with no anchor holds the centre still', () => {
  const out = zoomBy(CENTRE, 1.5, BASEMAP, PEEK);
  assert.equal(out.cx, CENTRE.cx);
  assert.equal(out.cy, CENTRE.cy);
});

// --- fit, which is issue #51 ---

test('fitPair puts you and the room on screen with padding', () => {
  const you = [40000, 30000];
  const room = [49000, 36000];
  const view = fitPair(you, room, BASEMAP, PEEK);
  near(view.cx, 44500, 1e-9, 'centred between the two');
  near(view.cy, 33000, 1e-9, 'centred between the two');

  const a = project(you, BASEMAP, view, PEEK);
  const b = project(room, BASEMAP, view, PEEK);
  for (const p of [a, b]) {
    assert.ok(p[0] > 0 && p[0] < PEEK.width, `x off screen at ${p[0]}`);
    assert.ok(p[1] > 0 && p[1] < PEEK.band, `y behind the sheet at ${p[1]}`);
  }
  // The binding axis here is x, so the pair should sit just inside the pad.
  const margin = Math.min(a[0], b[0]);
  near(margin, FIT_PAD * PEEK.width, 1, 'padding on the binding axis');
});

test('fitPair frames a pair that a fixed span would put off screen', () => {
  // At the shipped fixed 0.28 the far half of the list drew its target outside
  // the band. The fit has to widen for those.
  const you = [30000, 30000];
  const room = [52000, 48000];
  const view = fitPair(you, room, BASEMAP, PEEK);
  assert.ok(view.span > SETTLED_SPAN, `span ${view.span} did not widen`);
  const b = project(room, BASEMAP, view, PEEK);
  assert.ok(b[0] > 0 && b[0] < PEEK.width && b[1] > 0 && b[1] < PEEK.band, `target at ${b}`);
});

test('fitPair on two points in the same building falls back to the tightest span', () => {
  const p = [44000, 33000];
  assert.equal(fitPair(p, p, BASEMAP, PEEK).span, spanLimits(BASEMAP, PEEK).min);
});

test('fitPair with no separation on one axis lets the other decide', () => {
  const view = fitPair([40000, 33000], [49000, 33000], BASEMAP, PEEK);
  assert.ok(Number.isFinite(view.span), `span was ${view.span}`);
  const b = project([49000, 33000], BASEMAP, view, PEEK);
  near(b[0], (1 - FIT_PAD) * PEEK.width, 1, 'padded on the axis that binds');
});

test('fitPair clamps rather than zooming past the ends of the range', () => {
  const far = fitPair([0, 0], [65000, 65000], BASEMAP, PEEK);
  assert.equal(far.span, SPAN_MAX);
  const same = fitPair([44000, 33000], [44010, 33010], BASEMAP, PEEK);
  assert.ok(same.span >= spanLimits(BASEMAP, PEEK).min);
});

test('fitPair does not mutate its inputs', () => {
  const you = [40000, 30000];
  const room = [49000, 36000];
  fitPair(you, room, BASEMAP, PEEK);
  assert.deepEqual(you, [40000, 30000]);
  assert.deepEqual(room, [49000, 36000]);
});

// --- footprints, the render half of issue #50 ---

// Two unit squares, delta encoded, one at 100,100 and one 40 grid steps east.
const CAMPUS = {
  grid: 1000,
  bbox: [-83.04, 39.98, -83.0, 40.02],
  layers: {
    building: [
      [[100, 100, 10, 0, 0, 10, -10, 0]],
      [[140, 100, 10, 0, 0, 10, -10, 0]],
    ],
  },
};

test('a keyed map lights the building the key names, not the nearest centroid', () => {
  const keyed = { ...CAMPUS, buildingCode: ['003', '210'] };
  // This point is closest to the FIRST square, so a centroid search would pick
  // it. 21 of 86 real buildings are decided by a margin under 30 m against a
  // median footprint about 41 m across, which is what that search gets wrong.
  const rings = footprintFor(keyed, '210', [106, 105]);
  assert.deepEqual(rings[0][0], [140, 100], 'the key lost to the guess');
});

test('an unkeyed map still finds a footprint by centroid', () => {
  const rings = footprintFor({ ...CAMPUS }, '210', [106, 105]);
  assert.deepEqual(rings[0][0], [100, 100]);
});

test('a key that is not on the map falls back rather than giving up', () => {
  const keyed = { ...CAMPUS, buildingCode: ['003', '210'] };
  assert.deepEqual(footprintFor(keyed, '999', [144, 105])[0][0], [140, 100]);
});

test('nothing within range gives nothing to light', () => {
  assert.equal(footprintFor({ ...CAMPUS }, '', [900, 900]), null);
  assert.equal(footprintFor({ ...CAMPUS }, '', null), null);
  assert.equal(footprintFor({ grid: 1000, layers: { building: [] } }, '003', [1, 1]), null);
});

test('the decoded index is memoised out of sight of JSON', () => {
  const keyed = { ...CAMPUS, buildingCode: ['003', '210'] };
  footprintFor(keyed, '003', null);
  assert.deepEqual(Object.keys(keyed), ['grid', 'bbox', 'layers', 'buildingCode']);
  assert.equal(footprintFor(keyed, '003', null)[0][0][0], 100, 'second call still answers');
});

// --- drawing, against a recording context ---

function stubCtx() {
  const calls = [];
  const rec = (name) => (...args) => calls.push([name, ...args]);
  return {
    calls,
    save: rec('save'),
    restore: rec('restore'),
    setTransform: rec('setTransform'),
    translate: rec('translate'),
    rotate: rec('rotate'),
    scale: rec('scale'),
    fillRect: rec('fillRect'),
    drawImage: rec('drawImage'),
    beginPath: rec('beginPath'),
    closePath: rec('closePath'),
    moveTo: rec('moveTo'),
    lineTo: rec('lineTo'),
    arc: rec('arc'),
    fill: rec('fill'),
    stroke: rec('stroke'),
    setLineDash: rec('setLineDash'),
    roundRect: rec('roundRect'),
    fillText: rec('fillText'),
    measureText: (t) => ({ width: t.length * 7 }),
  };
}

const arcs = (ctx) => ctx.calls.filter((c) => c[0] === 'arc');

test('the dot is drawn in the band, at a size that cannot go sub-pixel', () => {
  const ctx = stubCtx();
  drawYou(ctx, { at: [33000, 33000], accuracyM: 0 }, BASEMAP, CENTRE, PEEK);
  const [, x, y, r] = arcs(ctx)[0];
  assert.deepEqual([x, y], [195, 261.5]);
  assert.ok(r >= 6, `dot radius ${r}`);
});

test('accuracy arrives in metres and is converted here', () => {
  // app.js used to rebuild this out of basemap.sy and the view scale by hand,
  // which is the only reason it knew about either.
  const ctx = stubCtx();
  drawYou(ctx, { at: [33000, 33000], accuracyM: 100 }, BASEMAP, CENTRE, PEEK);
  const ring = arcs(ctx)[0];
  near(ring[3], 100 / metresPerScreenPx(BASEMAP, CENTRE, PEEK), 1e-9, 'accuracy ring');
  assert.equal(arcs(ctx).length, 2, 'ring and dot');
});

test('an accuracy ring smaller than the dot is not drawn', () => {
  const ctx = stubCtx();
  drawYou(ctx, { at: [33000, 33000], accuracyM: 5 }, BASEMAP, CENTRE, PEEK);
  assert.equal(arcs(ctx).length, 1, 'only the dot');
});

test('no fix at all draws nothing and does not throw', () => {
  const ctx = stubCtx();
  drawYou(ctx, { at: null, accuracyM: 40 }, BASEMAP, CENTRE, PEEK);
  assert.equal(ctx.calls.length, 0);
});

test('the target takes the footprint it is given', () => {
  const ctx = stubCtx();
  const footprint = [[[33000, 33000], [33100, 33000], [33100, 33100]]];
  drawTarget(ctx, { footprint, from: null, to: null }, BASEMAP, CENTRE, PEEK);
  assert.equal(ctx.calls.filter((c) => c[0] === 'lineTo').length, 2);
  assert.equal(ctx.calls.filter((c) => c[0] === 'fill').length, 1);
});

test('the walk label is dropped when the pill would cover the line', () => {
  const short = stubCtx();
  drawTarget(
    short,
    { footprint: null, from: [33000, 33000], to: [33500, 33000], label: '1 min walk' },
    BASEMAP,
    CENTRE,
    PEEK,
  );
  assert.equal(short.calls.filter((c) => c[0] === 'fillText').length, 0);
  const long = stubCtx();
  drawTarget(
    long,
    { footprint: null, from: [30000, 30000], to: [40000, 40000], label: '1 min walk' },
    BASEMAP,
    CENTRE,
    PEEK,
  );
  assert.equal(long.calls.filter((c) => c[0] === 'fillText').length, 1);
});

test('the dashes stay readable on a line the fit has zoomed right in on', () => {
  const ctx = stubCtx();
  drawTarget(
    ctx,
    { footprint: null, from: [33000, 33000], to: [34560, 33000], label: null },
    BASEMAP,
    CENTRE,
    PEEK,
  );
  const dash = ctx.calls.find((c) => c[0] === 'setLineDash' && c[1].length === 2)[1];
  const a = project([33000, 33000], BASEMAP, CENTRE, PEEK);
  const b = project([34560, 33000], BASEMAP, CENTRE, PEEK);
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  assert.ok(dash[0] * 2 < len, `a ${len.toFixed(1)} px line cannot hold a ${dash[0]} px dash pair`);
});

// ---- sheet-frame

// One 393x852 phone on two screens. `band` is the strip above the sheet: 528 px
// where the ranked list rests at 0.38, 239 px where the room screen opens at
// 0.72. viewport() used to hand both of them the 528.
const ROOM_BAND = { width: 393, height: 852, band: 239, dpr: 3 };
const LIST_BAND = { width: 393, height: 852, band: 528, dpr: 3 };
// The sheet's top edge is where the band ends.
const ROOM_SHEET_TOP = ROOM_BAND.band;

// You and the room you are being sent to, projected the way render() draws
// them: fitted through one viewport and then read back through the same one.
const inkSpan = (viewport) => {
  const you = [33000, 31000];
  const room = [35400, 37000];
  const view = fitPair(you, room, BASEMAP, viewport);
  const a = project(you, BASEMAP, view, viewport)[1];
  const b = project(room, BASEMAP, view, viewport)[1];
  return { top: Math.min(a, b), bottom: Math.max(a, b) };
};

test('the room screen frames the walk line in the strip the room screen leaves', () => {
  // Composed for the list's band and then drawn under a 613 px sheet, 164 of
  // the 206 px of target ink came out under the panel at 393x852, measured off
  // the real canvas.
  const wrong = inkSpan(LIST_BAND);
  const under = (wrong.bottom - Math.max(wrong.top, ROOM_SHEET_TOP)) / (wrong.bottom - wrong.top);
  near(under, 0.62, 0.01, 'the list band hides the line the room screen is about');

  const right = inkSpan(ROOM_BAND);
  assert.ok(
    right.bottom < ROOM_SHEET_TOP,
    `the line ends at ${right.bottom}, under a sheet whose top is ${ROOM_SHEET_TOP}`,
  );
});

test('a room sheet dragged back down leaves the target framed high, not centred', () => {
  // The accepted cost of keying the band to the screen's OPENING height. Pull
  // the room sheet down to peek and 528 px of map is uncovered, but the camera
  // is still composed for the 239 the screen opened with. The alternative is a
  // band that tracks the live drag, which zoomed the map out and slid it upward
  // under the thumb every time the sheet moved.
  const ink = inkSpan(ROOM_BAND);
  const mid = (ink.top + ink.bottom) / 2;
  near(mid, ROOM_BAND.band / 2, 1, 'the pair is centred in the band it was fitted for');
  assert.ok(mid < LIST_BAND.band / 2, `${mid} is not high in the 528 px peek uncovers`);
});
