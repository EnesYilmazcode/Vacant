// What the launch spike concludes about the map raster, kept out of the HTML so
// node --test can drive it.
//
// The revision comment on #29 asks four things the timing panel cannot answer:
// does the canvas allocation succeed, is it GPU backed, what does the first blit
// cost against every later one, and how big is the raster. Three of those are
// verdicts rather than numbers, and an untested verdict is a sentence somebody
// wrote once and nobody checked again.
//
// Nothing here touches a canvas. The page does the drawing and hands the
// numbers over, which is the only reason any of this can be tested at all.

import { median } from './verdict.js';

// A first blit within this much of the later ones is not paying for anything.
// Under a millisecond is inside the noise of performance.now() on a phone, so a
// smaller threshold would report an upload that is not there.
const BLIT_NOISE_MS = 1;

// getImageData on a GPU-backed 2D canvas has to pull the pixels back across the
// bus; on a willReadFrequently canvas they were in main memory already. Twice
// as slow is the call, and anything between 1.25x and 2x is refused rather than
// guessed, because the two ends mean opposite things for the packed binary.
const BACKED_RATIO = 2;
const SOFTWARE_RATIO = 1.25;

const ms = (n) => Math.round(n * 100) / 100;

// The first draw of a raster uploads it. Every later draw of the same raster
// does not. That gap, not the absolute number, is what #29 is asking for.
export function blit(samples) {
  if (!samples || samples.length === 0) {
    return { first: null, later: null, extra: null, ratio: null, n: 0, line: 'No blit was recorded.' };
  }
  const [first, ...rest] = samples;
  if (rest.length === 0) {
    return {
      first, later: null, extra: null, ratio: null, n: 1,
      line: `One blit only, ${ms(first)} ms. A first blit needs something to be first against.`,
    };
  }
  const later = median(rest);
  const extra = first - later;
  const ratio = later > 0 ? first / later : null;
  const tail = `first ${ms(first)} ms against a median ${ms(later)} ms over the ${rest.length} after it`;
  const line =
    extra <= BLIT_NOISE_MS
      ? `The first blit costs what the rest do, ${tail}. Nothing is being uploaded on it.`
      : `The first blit costs ${ms(extra)} ms more than the rest, ${tail}` +
        (ratio ? `, ${ratio.toFixed(1)}x` : '') + '.';
  return { first, later, extra, ratio, n: samples.length, line };
}

// Whether the offscreen raster js/map.js asks for actually exists.
//
// Two ways it does not, and they look nothing alike. A browser that refuses the
// size hands back a smaller canvas, which is visible in the dimensions. iOS
// running out of canvas memory does the other one: the canvas keeps the size it
// was given and every draw into it is dropped, so it reads back blank. Counting
// distinct colours is the only way to catch the second, and a basemap that drew
// has hundreds.
export function allocation({ wantedWidth, wantedHeight, gotWidth, gotHeight, colours }) {
  const px = gotWidth * gotHeight;
  const facts = {
    megapixels: px / 1e6,
    // 4 bytes a pixel is what a browser reserves for an RGBA backing store, so
    // this is the memory the raster costs, not the size of any file.
    bytes: px * 4,
    colours,
  };
  if (gotWidth !== wantedWidth || gotHeight !== wantedHeight) {
    return {
      ...facts, ok: false,
      line: `The canvas came back ${gotWidth}x${gotHeight}, not the ${wantedWidth}x${wantedHeight} asked for. This device capped it.`,
    };
  }
  if (!(colours > 1)) {
    return {
      ...facts, ok: false,
      line: `${gotWidth}x${gotHeight} allocated and ${colours} colour in it. The size was accepted and the drawing was dropped, which is how a phone reports running out of canvas memory.`,
    };
  }
  return {
    ...facts, ok: true,
    line: `${gotWidth}x${gotHeight}, ${(px / 1e6).toFixed(2)} MP, ${(px * 4 / 1048576).toFixed(1)} MB of backing store, ${colours} distinct colours in it.`,
  };
}

// Is the 2D canvas on the GPU. There is no API that says so, so this is a
// readback race and it is labelled as one on screen: the same patch pulled off
// the real raster and off a willReadFrequently copy, which is CPU backed by
// definition. The WebGL renderer string is reported beside it and answers a
// different question, what the device has, not what this canvas got.
export function backing({ plainMs, cpuMs, renderer }) {
  const named = renderer ? ` Renderer reports "${renderer}".` : ' The renderer string is not readable here.';
  if (!(plainMs > 0) || !(cpuMs > 0)) {
    return { verdict: 'unmeasured', ratio: null, line: 'The readback race did not run.' + named };
  }
  const ratio = plainMs / cpuMs;
  const race = `${ms(plainMs)} ms against ${ms(cpuMs)} ms, ${ratio.toFixed(1)}x`;
  if (ratio >= BACKED_RATIO) {
    return { verdict: 'gpu', ratio, line: `Reading the raster back costs ${race}, so it is on the GPU.` + named };
  }
  if (ratio <= SOFTWARE_RATIO) {
    return {
      verdict: 'software', ratio,
      line: `Reading the raster back costs ${race}, the same as a CPU canvas, so this one is not accelerated.` + named,
    };
  }
  return {
    verdict: 'unclear', ratio,
    line: `Reading the raster back costs ${race}, which is between the two answers. This says nothing either way.` + named,
  };
}
