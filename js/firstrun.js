// The first thing an installed user sees.
//
// On iOS every home-screen icon gets its own storage jar, isolated from Safari
// and from every other icon of the same site. Everything the Safari tab cached
// while the install hint was on screen is in the wrong jar, so the first
// standalone launch is always cold and always needs the network. That is not an
// edge case, it is what every installed user gets once, and undesigned it is a
// white screen for a student in a basement.
//
// Three tiers, picked from CacheStorage alone. A network call in the decision
// path would put the thing being decided about in front of the decision.

export const CACHED = 'cached';
export const FETCHING = 'fetching';
export const OFFLINE = 'offline';

const BASE = '/Vacant/';

// When a request has waited long enough that it is not coming. A stalled network
// never rejects, so without this both this card's probe and the app's boot wait
// on it for the length of the visit.
//
// MEASURED, because the direction of the error is the point: too short and a
// slow load that IS working gets called dead, which is the lie this app exists
// not to tell. The 379,144 bytes boot() reads, uncompressed off a local server
// with the worker out of the way, took 9.59 s over CDP at Chrome's Slow 3G
// preset (51,200 B/s down, 2,000 ms latency) and 2.69 s at Fast 3G, worst of
// five runs each. Pages gzips those five to 85,151, so a deployed load has more
// room than that. 20 s is twice the measurement, and still refuses a link a
// tenth of Slow 3G, where the same fetch needs 77.1 s.
export const NETWORK_TIMEOUT_MS = 20000;

async function cachedJson(store, url) {
  try {
    const hit = await store.match(url);
    return hit ? await hit.json() : null;
  } catch {
    return null;
  }
}

// The two files app.js needs that the pointer does not name. campus.json is not
// one of them: it is the map, boot() catches it on its own, and losing it costs
// the drawing and not the answer.
const NEEDED = ['data/buildings-hours.json'];

// Tier 1 means the app can answer with the network off, so the test is every
// file the answer is built from. Measured with the rooms file cached and
// buildings-hours.json missing: the old one-file test said CACHED, this card
// stayed away, and boot() rejected. Three disabled buttons and no way out. That
// state is what a term rollover leaves, and what one 503 during the worker's
// warm leaves.
export async function pickTier({ store, online, base = BASE }) {
  const miss = online ? FETCHING : OFFLINE;
  if (!store) return miss;
  const current = await cachedJson(store, `${base}data/current.json`);
  if (!current) return miss;
  const files = [current.rooms, current.buildings, ...NEEDED];
  if (!files.every(Boolean)) return miss;
  try {
    for (const file of files) {
      if (!(await store.match(base + String(file).replace(/^\//, '')))) return miss;
    }
  } catch {
    // CacheStorage can throw where site data is blocked. Treat it as a miss.
    return miss;
  }
  return CACHED;
}

// No number in this copy, on purpose. The honest figure is the gzipped size of
// the committed rooms file, which changes every week, so it would have to be
// stamped at build time. The stamp lives in the shell, and on the one path this
// card actually renders on, a cold standalone launch with a dead network, the
// shell is not in this jar either. A stamp that is never present is worse than
// no number, and an estimate would be a guess printed as a fact.
function card(doc, retry) {
  const el = doc.createElement('div');
  el.id = 'cold';
  el.setAttribute('role', 'alertdialog');
  // Nothing behind this card is usable or focusable while it is up: app.js
  // leaves the duration buttons disabled until it can answer, and the map is a
  // canvas. aria-modal keeps a screen reader inside the card anyway.
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-labelledby', 'cold-h');
  el.setAttribute('aria-describedby', 'cold-p');

  const head = doc.createElement('h2');
  head.id = 'cold-h';
  head.textContent = "Vacant needs this term's schedule once.";

  const body = doc.createElement('p');
  body.id = 'cold-p';
  body.textContent =
    'This is the only thing Vacant needs the network for. Once it is on the phone, the app answers with no signal at all.';

  const button = doc.createElement('button');
  button.type = 'button';
  button.className = 'opt primary';
  button.textContent = 'Try again';

  const status = doc.createElement('p');
  status.id = 'cold-say';
  status.setAttribute('role', 'status');
  status.className = 'cold-say';

  button.onclick = () => retry(status);
  el.append(head, body, button, status);
  return el;
}

export function initFirstRun(options = {}) {
  const doc = options.doc || document;
  const win = options.win || window;
  const nav = options.nav || navigator;
  const store = options.store || (typeof caches === 'undefined' ? null : caches);

  let showing = null;
  let ready = false;
  let busy = false;

  // navigator.onLine is a lower bound and nothing more. It reports true on a
  // captive portal, on a cell with no backhaul, and measured on this box, under
  // Chrome's own offline emulation, where it stayed true with every request
  // refused. So it decides which tier to START in and never decides that the
  // network works. Only a request that came back decides that.
  async function reachable() {
    try {
      const response = await fetch(`${BASE}data/current.json`, {
        cache: 'no-store',
        signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async function retry(status) {
    if (busy) return;
    busy = true;
    if (status) status.textContent = 'Checking.';
    const up = await reachable();
    busy = false;
    if (up) {
      win.location.reload();
      return;
    }
    // Refusing beats pretending. The button did try, there is still no network,
    // and saying so is the whole point of this app.
    if (status) status.textContent = 'Still no connection.';
  }

  function open() {
    if (showing || ready) return;
    // app.js races the same dead network and can arm its own refusal first. This
    // card covers it, and card() says nothing behind it is focusable.
    const gate = doc.getElementById('gate');
    if (gate) gate.hidden = true;
    showing = card(doc, retry);
    doc.body.append(showing);
    showing.querySelector('button').focus({ preventScroll: true });
  }

  function close() {
    showing?.remove();
    showing = null;
  }

  async function reconsider() {
    if (ready) return;
    const tier = await pickTier({ store, online: nav.onLine !== false });
    if (tier === OFFLINE) {
      open();
      return;
    }
    if (tier === CACHED) {
      if (showing) win.location.reload();
      return;
    }
    // Tier 2. Nothing is cached, so there is no answer to give and no way to
    // know whether one is coming except by asking. This is 226 bytes, it runs
    // beside app.js's own fetch of the same file, and it only ever runs on the
    // one visit where the app has nothing.
    const up = await reachable();
    if (ready) return;
    if (up) {
      if (showing) win.location.reload();
    } else {
      open();
    }
  }

  // iOS freezes a backgrounded web app, so the online event can be missed
  // entirely. Coming back to the foreground is the retry that actually fires.
  win.addEventListener('online', reconsider);
  doc.addEventListener('visibilitychange', () => {
    if (doc.visibilityState === 'visible') reconsider();
  });
  win.addEventListener('offline', reconsider);

  onReady(doc, () => {
    ready = true;
    close();
    persist(nav);
  });

  return reconsider();
}

// The app is ready when it says it is. app.js puts `ready` on the question
// screen at the moment it can answer, so that class is the signal rather than a
// timer, which would race a cold phone on LTE.
function onReady(doc, run) {
  const ask = doc.getElementById('ask');
  if (!ask) return;
  if (ask.classList.contains('ready')) {
    run();
    return;
  }
  const observer = new MutationObserver(() => {
    if (!ask.classList.contains('ready')) return;
    observer.disconnect();
    run();
  });
  observer.observe(ask, { attributes: true, attributeFilter: ['class'] });
}

// Asked once, and nothing branches on the answer. Safari grants it silently for
// an installed app and refuses it in a tab, and neither outcome changes what the
// app should do next.
function persist(nav) {
  try {
    nav.storage?.persist?.();
  } catch {
    // Not implemented everywhere, and it is allowed to throw.
  }
}
