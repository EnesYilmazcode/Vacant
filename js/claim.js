// The one line at the top of the room screen that makes a claim.
//
// It is split out of the screen because it is the sentence most likely to be
// wrong in the expensive direction, and because it has to be checkable without
// a browser. This file decides WHAT is true. js/app.js decides the words.
//
// The rule it exists to hold: `open` and `close` mean two different things.
// For a building in the Registrar's hours table they are door times. For the
// 565 buildings that publish nothing they are the first and last class in the
// room, which is all the app knows, and a claim built from them can talk about
// classes and never about doors. Saying "Thompson Library opens at 12:45pm"
// because a class starts then is exactly the guess this project refuses.
//
// The second rule: a window is not the same as YOUR window. `yours` is the
// minutes left after the walk, through the engine's formula, and it is null
// rather than optimistic when the walk is unknown. The version that shipped
// first used `gapEnd - packup - now`, which is the exact expression engine.js
// documents as the bug it exists to fix, because it counts the walk as study
// time. Measured on a Thursday at 12:15 it was wrong on all 23 rooms in the
// top 40 that carried a claim, by 5 minutes each.
//
// Pure. Wall-clock minutes in, a verdict out, no Date and no DOM.

import { usableMinutes } from './engine.js';

export function roomClaim({ known, rows = [], blocks = [], open, close, now, metres }) {
  // Null, not zero and not the whole gap. A caller with no distance behind it,
  // a shared link or the buildings screen, gets no duration at all.
  const yours = (gapStart, gapEnd) =>
    Number.isFinite(metres) && Number.isFinite(gapStart) && Number.isFinite(gapEnd)
      ? usableMinutes({ now, gapStart, gapEnd, metres })
      : null;

  if (open == null || close == null) return { kind: 'no-class-today' };

  if (now < open) {
    const first = rows.find((r) => r.kind === 'free');
    return known
      ? { kind: 'opens', at: open, next: first?.t ?? null, yours: first ? yours(first.t, first.end) : null }
      : { kind: 'before-first-class', at: open };
  }

  if (now >= close) {
    return known ? { kind: 'closed-for-day', at: close } : { kind: 'after-last-class', at: close };
  }

  // A class meeting in the room is a fact either way. The schedule is the
  // evidence for it, and nobody needs the door table to know the room is taken.
  const inClass = blocks.find(([s, e]) => now >= s && now < e);
  if (inClass) {
    const next = rows.find((r) => r.kind === 'free' && r.t >= inClass[1]);
    return {
      kind: 'in-class',
      until: inClass[1],
      next: next?.t ?? null,
      yours: next ? yours(next.t, next.end) : null,
    };
  }

  if (!blocks.length) return { kind: 'no-class-today' };

  const here = rows.find((r) => r.kind === 'free' && r.now);
  if (!here) return { kind: 'nothing-free' };

  const later = blocks.find(([s]) => s >= now);
  return {
    kind: 'free',
    until: later ? later[0] : null,
    known: !!known,
    yours: yours(here.t, here.end ?? close),
  };
}
