// How a door is scored against what the app actually said, and how much of the
// sample the app would ever have put on screen.
//
// Two mistakes live here if this is done carelessly, and the first version of
// walk.html made both.
//
// One: `wrong = occupied + lockedBuilding + lockedRoom + missing` punishes the
// refusal. A row in a building with no published hours renders as "hours not
// published, so Vacant cannot say when the door locks". Finding that door
// locked confirms the refusal. Scored the old way, a Saturday walk where all
// twenty rooms were in unpublished buildings printed "wrong 20 / 20 (100% of
// what was visited)" for being honest twenty times.
//
// Two: the quota deliberately oversamples rows the product cannot reach.
// js/app.js keeps `shape(usable).rows` and has no pagination, and a room with
// no published hours sorts below every published-hours room, so at seven of
// nine measured clocks the first such room ranked below 40. A single percentage
// over that sample is a number about the sampling.

// The most rows shape() will ever hand js/app.js, and nothing pages past them.
// It is a ceiling, not the set: shape() also holds a building to one row while
// the screen fills, so which rows reach the screen is a question only shape()
// can answer, and walk.html asks it rather than counting to 40.
export const APP_SHOWN_CAP = 40;

export const OUTCOMES = {
  empty: { word: 'open and empty', outer: 'open', inner: 'open', occupied: 'no' },
  occupied: { word: 'open but occupied', outer: 'open', inner: 'open', occupied: 'yes' },
  'locked-outer': { word: 'building door locked', outer: 'locked', inner: '-', occupied: '-' },
  'locked-inner': { word: 'room door locked', outer: 'open', inner: 'locked', occupied: '-' },
  missing: { word: 'no such room', outer: '-', inner: '-', occupied: '-' },
};

export const OUTCOME_ORDER = ['empty', 'occupied', 'locked-outer', 'locked-inner', 'missing'];

export const STRATA = [
  {
    key: 'published',
    label: 'published hours',
    claim: 'the app named a close time, so it claimed the building was open',
  },
  {
    key: 'unpublished',
    label: 'no published hours',
    claim: 'the app said it cannot say when the door locks',
  },
];

export const stratumOf = (hoursKnown) => (hoursKnown ? 'published' : 'unpublished');

// Three answers, not two.
//
//   confirmed     the app's claim held.
//   contradicted  an outcome the app's own words rule out.
//   unclaimed     an outcome the app never predicted, so it cannot be wrong
//                 about it. Both locked-door cases in a building with no
//                 published hours, and every locked ROOM door: the index holds
//                 no room-lock data for any building, so a locked room door
//                 falsifies nothing. It still counts as a room you could not
//                 use, which is the other number this file returns.
export function verdictFor(hoursKnown, outcome) {
  if (outcome === 'empty') return 'confirmed';
  if (outcome === 'occupied' || outcome === 'missing') return 'contradicted';
  if (outcome === 'locked-outer') return hoursKnown ? 'contradicted' : 'unclaimed';
  if (outcome === 'locked-inner') return 'unclaimed';
  throw new Error(`unknown outcome ${outcome}`);
}

const emptyCounts = () => Object.fromEntries(OUTCOME_ORDER.map((k) => [k, 0]));

// rows: [{ hoursKnown, shownByApp, visit: { outcome } | null }]
export function tally(rows) {
  const strata = STRATA.map((s) => ({
    ...s,
    picked: 0,
    visited: 0,
    shownByApp: 0,
    counts: emptyCounts(),
    confirmed: 0,
    contradicted: 0,
    unclaimed: 0,
    unusable: 0,
  }));
  const by = Object.fromEntries(strata.map((s) => [s.key, s]));

  for (const r of rows) {
    const s = by[stratumOf(r.hoursKnown)];
    s.picked++;
    if (r.shownByApp) s.shownByApp++;
    if (!r.visit) continue;
    s.visited++;
    s.counts[r.visit.outcome]++;
    s[verdictFor(r.hoursKnown, r.visit.outcome)]++;
    if (r.visit.outcome !== 'empty') s.unusable++;
  }
  return strata;
}

// What the app would have put on screen. A pick the app never shows is still
// worth walking, it just cannot be reported as a row a user would have seen.
//
// Read off shownByApp, which walk.html takes from membership in shape(usable)
// .rows. This used to be `appRank <= cap`, and that was exact only while the
// app sliced its list at 40. MEASURED over 406 samples from the Oval, every
// half hour Mon to Fri 2026-09-14 to 18 at a 30 and a 60 minute ask: of the
// 15,078 rows in rank()'s first 40 only 4,768 reach the screen, and of the
// 12,759 rows that do reach it 7,991 rank past 40. The rank is kept because it
// is still what the row is worth reporting, but it no longer decides.
export function visibility(rows, cap = APP_SHOWN_CAP) {
  const ranked = rows.filter((r) => Number.isFinite(r.appRank));
  return {
    cap,
    ranked: ranked.length,
    shown: ranked.filter((r) => r.shownByApp).length,
    below: ranked.filter((r) => !r.shownByApp).length,
    unranked: rows.length - ranked.length,
  };
}
