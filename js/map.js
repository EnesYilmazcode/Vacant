// Draw campus on a canvas, dark, from data/campus.json.
//
// The basemap is rendered ONCE into an offscreen canvas and then blitted with a
// transform every frame. There are about 1,500 paths on screen; re-stroking
// them at 60 fps would pin a phone's main thread, and the flyover in particular
// only ever changes the transform, never the geometry.

import { aspect, decodeShape } from './campus.js';

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
// the basemap's shorter axis visible across the shorter screen axis.
export function makeView({ cx, cy, span, rotation = 0 }) {
  return { cx, cy, span, rotation };
}

const viewScale = (basemap, view, width, height) =>
  Math.min(width, height) / (view.span * basemap.size);

// Draw one frame. Everything that moves is a transform on a single drawImage.
export function drawFrame(ctx, basemap, view, { width, height, dpr = 1 }) {
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = PALETTE.bg;
  ctx.fillRect(0, 0, width, height);

  const scale = viewScale(basemap, view, width, height);
  ctx.translate(width / 2, height / 2);
  ctx.rotate(view.rotation);
  ctx.scale(scale, scale);
  ctx.translate(-view.cx * basemap.sx, -(basemap.height - view.cy * basemap.sy));

  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(basemap.canvas, 0, 0);
  ctx.restore();
}

// Grid coordinates to screen pixels, for anything drawn on top of the basemap.
export function project([gx, gy], basemap, view, { width, height }) {
  const scale = viewScale(basemap, view, width, height);
  const dx = (gx * basemap.sx - view.cx * basemap.sx) * scale;
  const dy = (basemap.height - gy * basemap.sy - (basemap.height - view.cy * basemap.sy)) * scale;
  const cos = Math.cos(view.rotation);
  const sin = Math.sin(view.rotation);
  return [width / 2 + dx * cos - dy * sin, height / 2 + dx * sin + dy * cos];
}

// The room you are being sent to: its footprint lit, and a line from you to it.
export function drawTarget(ctx, { footprint, from, to, label, dpr = 1, width, height }, basemap, view) {
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  if (footprint?.length) {
    ctx.beginPath();
    for (const ring of footprint) {
      const pts = ring.map((p) => project(p, basemap, view, { width, height }));
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.closePath();
    }
    ctx.fillStyle = PALETTE.targetGlow;
    ctx.fill('evenodd');
    ctx.strokeStyle = PALETTE.target;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  if (from && to) {
    const a = project(from, basemap, view, { width, height });
    const b = project(to, basemap, view, { width, height });
    ctx.strokeStyle = PALETTE.line;
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    // Dashed, so it reads as a direction rather than a route through doors.
    ctx.setLineDash([7, 7]);
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.stroke();
    ctx.setLineDash([]);

    if (label) {
      const mx = (a[0] + b[0]) / 2;
      const my = (a[1] + b[1]) / 2;
      ctx.font = '600 12px ui-sans-serif, system-ui, sans-serif';
      const w = ctx.measureText(label).width + 14;
      ctx.fillStyle = 'rgba(11,13,16,.88)';
      ctx.beginPath();
      ctx.roundRect(mx - w / 2, my - 11, w, 22, 11);
      ctx.fill();
      ctx.fillStyle = PALETTE.target;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, mx, my);
    }
  }
  ctx.restore();
}

// You.
//
// `guess` means we never got a fix and this is the Oval standing in. Drawing
// that as a solid dot makes the one point we are least sure of look like the
// most confident thing on the map, so it is drawn hollow and muted instead.
// A real fix draws its accuracy radius, because a 100 m circle can swap the
// top two results and the user deserves to see that.
export function drawYou(ctx, { at, accuracyPx = 0, guess = false, dpr = 1, width, height }, basemap, view) {
  if (!at) return;
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const [x, y] = project(at, basemap, view, { width, height });

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

  if (accuracyPx > 6) {
    ctx.beginPath();
    ctx.arc(x, y, accuracyPx, 0, Math.PI * 2);
    ctx.fillStyle = PALETTE.youHalo;
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(x, y, 7, 0, Math.PI * 2);
  ctx.fillStyle = PALETTE.you;
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = PALETTE.bg;
  ctx.stroke();
  ctx.restore();
}
