// The app's term gate, copied out of js/app.js provenance() with the DOM
// removed.
//
// js/app.js renders this gate and then returns from boot() BEFORE it sets
// state.ready, so outside the published instruction window the app cannot rank
// a room at all. An instrument that ranks anyway is not measuring the app. On
// 2026-12-23, twelve days after Autumn 2026 ended, the app called zero rooms
// free and walk.html called 871 free, which would have sent somebody to twenty
// doors to produce a number about nothing.
//
// Copied by hand means it can drift. spikes/test/term.vendor.test.mjs holds a
// tripwire on the app source.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function fmtDay(iso) {
  const [, m, d] = String(iso).split('-').map(Number);
  return Number.isFinite(m) ? `${MONTHS[m - 1]} ${d}` : String(iso);
}

export const isoDate = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// `today` is a local ISO date. Returns whether the app would answer at all, and
// the app's own words for why not.
export function termGate(current, today) {
  const [from, to] = current?.instruction ?? [];
  const term = current?.termName ?? 'this term';
  // No published window is not the same as a window that has closed. js/app.js
  // answers in that case, so the instrument does too rather than inventing a
  // refusal the product would not make.
  if (!from || !to) return { open: true, term, from: null, to: null };
  if (today >= from && today <= to) return { open: true, term, from, to };

  const early = today < from;
  return {
    open: false,
    early,
    term,
    from,
    to,
    headline: early ? `${term} has not started yet` : `${term} ended on ${fmtDay(to)}`,
    detail: early
      ? `Classes run ${fmtDay(from)} to ${fmtDay(to)}. Until then the schedule says nothing about which rooms are empty, so Vacant is not answering.`
      : 'Ohio State has not published a newer schedule yet. Vacant will not rank rooms against a term that is over.',
  };
}

// What the instrument adds on top of the app's refusal: the app just stops, but
// a page somebody opened in order to walk somewhere has to say why the walk is
// off.
export function refusalNote(gate) {
  return `The app refuses to rank rooms today, so this page will not pick any. ` +
    `${gate.term} runs ${fmtDay(gate.from)} to ${fmtDay(gate.to)}, and today is ${gate.early ? 'before it starts' : 'after it ended'}. ` +
    `Twenty rooms picked now would be twenty rooms the app never called free, and walking them would measure nothing.`;
}
