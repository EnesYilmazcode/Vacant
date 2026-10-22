// Draw a landscape room photograph into the portrait card without stretching
// the floor and furniture the reader is looking at.

// How much of the source width survives, and how much taller than natural the
// bottom edge may be. Picked against Orton Hall 110 in dev/warp.html.
export const WARP_WIDTH = 0.55;
export const WARP_BOTTOM = 1.10;

// Piecewise approximation of the warp curve. At 240 bands the seams are under
// a device pixel at 393x852 and the complete draw stays under 3ms.
export const WARP_BANDS = 240;

export function warpPower(w, h, sw, sh) {
  return Math.max(1, (h * sw) / (sh * WARP_BOTTOM * w));
}

export function drawWarp(canvas, img) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h || !img.naturalWidth) return false;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const sw = img.naturalWidth * WARP_WIDTH;
  const sx = (img.naturalWidth - sw) / 2;
  const sh = img.naturalHeight;
  const at = (t) => sh * t ** warpPower(w, h, sw, sh);

  for (let i = 0; i < WARP_BANDS; i++) {
    const t0 = i / WARP_BANDS;
    const t1 = (i + 1) / WARP_BANDS;
    const sy = at(t0);
    const sy1 = at(t1);
    // Paint one pixel past the fractional edge so adjacent bands never leave a
    // hairline of background between them.
    ctx.drawImage(img, sx, sy, sw, Math.max(sy1 - sy, 0.5), 0, h * t0, w, h * (t1 - t0) + 1);
  }
  return true;
}

export function drawContained(canvas, img) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h || !img.naturalWidth) return false;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  const scale = Math.min(w / img.naturalWidth, h / img.naturalHeight);
  const dw = img.naturalWidth * scale;
  const dh = img.naturalHeight * scale;
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
  return true;
}

export const desktopCardMode = () => globalThis.matchMedia?.('(min-width: 900px) and (hover: hover) and (pointer: fine)').matches === true;

export const drawCardPhoto = (canvas, img) =>
  desktopCardMode() ? drawContained(canvas, img) : drawWarp(canvas, img);
