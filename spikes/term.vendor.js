// The app's term gate, with the DOM removed.
//
// The gate has moved. It used to sit in js/app.js provenance(), which returned
// from boot() before setting state.ready; it now lives in js/state.js
// resolveState(), and js/app.js refuses to rank whenever that verdict says so.
// Either way, outside the published instruction window the app cannot rank a
// room, and an instrument that ranks anyway is not measuring the app. On
// 2026-12-23, twelve days after Autumn 2026 ended, the app called zero rooms
// free and walk.html called 871 free, which would have sent somebody to twenty
// doors to produce a number about nothing.
//
// This is the instruction-window half of that verdict and nothing else. The app
// also refuses on exam weeks, closed days and days its own schedule has gone
// dark, so a shut gate here always means the app refuses, while an open one
// only means the app is not refusing FOR THIS REASON. Wrong in the safe
// direction for a page that walks people to rooms.
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
    // The app's own sentences, which is the point of vendoring rather than
    // writing new ones. It names the end date in the headline where the app
    // says only "is over", because the person reading an instrument is reading
    // it to find out which dates it covers.
    headline: early ? `${term} has not started yet` : `${term} ended on ${fmtDay(to)}`,
    detail: early
      ? `Classes run ${fmtDay(from)} to ${fmtDay(to)}. Until then the schedule says nothing about which rooms are empty, so Vacant is not answering.`
      : 'Ohio State has not published the next term yet. Vacant will not rank rooms against a term that has finished.',
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
