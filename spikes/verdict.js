// The #29 decision, computed from recorded runs.
//
// The state selector offers three launches and only two of them are launches
// with no warm process behind them. The first version counted `cold process`
// alone, so somebody who recorded five runs the page's own way, as
// "cold everything, first launch after install", was told "No cold process runs
// recorded" and got no verdict at all. "cold everything" is the case #29 is
// actually asking about, so it counts, and the split is printed beside the
// median rather than pooled silently.

export const STATES = ['warm', 'cold process', 'cold everything'];
export const COLD_STATES = ['cold process', 'cold everything'];

export const median = (xs) => {
  if (!xs.length) return null;
  const v = [...xs].sort((a, b) => a - b);
  return v[(v.length - 1) >> 1];
};

export function verdict(runs) {
  const all = runs.filter((r) => COLD_STATES.includes(r.state));
  // A warm-JIT run is a smaller number describing a launch nobody performs, so
  // the verdict is taken from the runs that were first in their page context.
  const cold = all.filter((r) => r.firstInContext);
  const use = cold.length ? cold : all;
  const byState = COLD_STATES.map((state) => {
    const rows = use.filter((r) => r.state === state);
    return { state, n: rows.length, median: median(rows.map((r) => r.total)) };
  });
  const m = median(use.map((r) => r.total));

  if (m == null) {
    return {
      line: `No cold runs recorded yet, so #29 has no verdict. Record a run as ${COLD_STATES.join(' or ')}.`,
      median: null, n: 0, total: all.length, warm: false, first: null, byState,
    };
  }

  const call = m < 300
    ? 'Under 300 ms: do nothing. Close both optimizations.'
    : m <= 800
      ? 'Between 300 and 800 ms: defer only the typed index build to requestIdleCallback.'
      : 'Over 800 ms: file the packed binary as its own issue.';

  return {
    line: call,
    median: m,
    n: use.length,
    total: all.length,
    warm: cold.length === 0,
    first: median(use.map((r) => r.totalFirstParse)),
    byState,
  };
}
