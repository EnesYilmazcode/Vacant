// Draw campus on a canvas, dark, from data/campus.json.
//
// The basemap is rendered ONCE into an offscreen canvas and then blitted with a
// transform every frame. There are about 1,500 paths on screen; re-stroking
// them at 60 fps would pin a phone's main thread, and the flyover in particular
// only ever changes the transform, never the geometry.

import { decodeShape } from './campus.js';

// Dark, because the app is used at night and in stairwells, and because the map
// is the surface of the app rather than a panel inside it.
export const PALETTE = {
  bg: '#0b0d10',
  landscape: '#111a15',
  water: '#0c1f2b',
  street: '#1a2028',
  building: '#222932',
  buildingEdge: '#2f3945',
  target: '#ff4d3d',
  targetGlow: 'rgba(255, 77, 61, 0.22)',
  you: '#4cc2ff',
  youHalo: 'rgba(76, 194, 255, 0.16)',
  line: '#ff6a5a',
};

// How much of the bbox the settled view shows. Below 1 it zooms in, so the
// user's surroundings fill the screen rather than the whole 2.7 km.
const SETTLED_SPAN = 0.42;

// One offscreen render of everything that never moves.
export function buildBasemap(campus, pixelsPerGrid) {
  const w = Math.ceil(campus.grid * pixelsPerGrid);
  const h = Math.ceil(campus.grid * pixelsPerGrid);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');

  g.fillStyle = PALETTE.bg;
  g.fillRect(0, 0, w, h);

  // Grid y runs north-up; canvas y runs down.
  const px = (x) => x * pixelsPerGrid;
  const py = (y) => h - y * pixelsPerGrid;

  const path = (feature) => {
    g.beginPath();
    for (const ring of feature) {
      const pts = decodeShape(ring);
      g.moveTo(px(pts[0][0]), py(pts[0][1]));
      for (let i = 1; i < pts.length; i++) g.lineTo(px(pts[i][0]), py(pts[i][1]));
      g.closePath();
    }
  };

  for (const f of campus.layers.landscape ?? []) {
    path(f);
    g.fillStyle = PALETTE.landscape;
    // Even-odd, so a feature's inner rings are holes rather than overpaint.
    g.fill('evenodd');
  }

  for (const f of campus.layers.water ?? []) {
    path(f);
    g.fillStyle = PALETTE.water;
    g.fill('evenodd');
  }

  g.strokeStyle = PALETTE.street;
  g.lineWidth = Math.max(1, 3 * pixelsPerGrid * 400);
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

  g.lineWidth = Math.max(0.5, 1.2 * pixelsPerGrid * 400);
  for (const f of campus.layers.building ?? []) {
    path(f);
    g.fillStyle = PALETTE.building;
    g.fill('evenodd');
    g.strokeStyle = PALETTE.buildingEdge;
    g.stroke();
  }

  return { canvas: c, pixelsPerGrid, size: w };
}

// The view: where on the basemap we are looking, and how hard we are zoomed.
// `span` is the fraction of the grid visible across the shorter screen axis.
export function makeView({ cx, cy, span, rotation = 0 }) {
  return { cx, cy, span, rotation };
}

// Draw one frame. Everything that moves is a transform on a single drawImage.
export function drawFrame(ctx, basemap, view, { width, height, dpr = 1 }) {
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = PALETTE.bg;
  ctx.fillRect(0, 0, width, height);

  const shorter = Math.min(width, height);
  const scale = shorter / (view.span * basemap.size);

  ctx.translate(width / 2, height / 2);
  ctx.rotate(view.rotation);
  ctx.scale(scale, scale);
  // Grid y is north-up and the basemap already flipped it, so cy maps through
  // the same flip here.
  ctx.translate(-view.cx * basemap.pixelsPerGrid, -(basemap.size - view.cy * basemap.pixelsPerGrid));

  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(basemap.canvas, 0, 0);
  ctx.restore();
  return { scale, shorter };
}

// Grid coordinates to screen pixels, for anything drawn on top of the basemap.
export function project([gx, gy], basemap, view, { width, height }) {
  const shorter = Math.min(width, height);
  const scale = shorter / (view.span * basemap.size);
  const bx = gx * basemap.pixelsPerGrid;
  const by = basemap.size - gy * basemap.pixelsPerGrid;
  const dx = (bx - view.cx * basemap.pixelsPerGrid) * scale;
  const dy = (by - (basemap.size - view.cy * basemap.pixelsPerGrid)) * scale;
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

// You. The accuracy radius is drawn honestly rather than as a confident point,
// because a 100 m fix can swap the top two results.
export function drawYou(ctx, { at, accuracyPx = 0, dpr = 1, width, height }, basemap, view) {
  if (!at) return;
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const [x, y] = project(at, basemap, view, { width, height });

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

export { SETTLED_SPAN };
