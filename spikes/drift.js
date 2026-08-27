// Is the vendored engine still the app's engine?
//
// walk.html cannot import js/engine.js, so it holds a byte copy and re-fetches
// the app's file at load to compare them. The first version did
// `fetch(url).then((r) => r.text())` with no status check, and a 404 body is a
// string: a missing js/engine.js compared unequal and printed "DRIFTED from
// js/engine.js, these picks are not the app's picks" over a walk that was
// perfectly good. Not reachable and not the same are different results, and
// only one of them says anything about the picks.
//
// Three states, never two:
//   match      the copy is the app's file
//   DRIFT      the copy is a different file, so the picks are not the app's
//   unchecked  the app's file could not be read, which costs the check only

export const ENGINE_COPY = './engine.vendor.js';
export const ENGINE_APP = '../js/engine.js';

export async function compareEngine(fetchFn, copy = ENGINE_COPY, app = ENGINE_APP) {
  const body = async (url) => {
    const r = await fetchFn(url);
    if (!r || !r.ok) throw new Error(`${url} returned HTTP ${r ? r.status : 'nothing'}`);
    return r.text();
  };
  try {
    const [mine, theirs] = await Promise.all([body(copy), body(app)]);
    return mine === theirs ? 'match' : 'DRIFT';
  } catch {
    return 'unchecked';
  }
}
