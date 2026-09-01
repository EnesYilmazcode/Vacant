// The install hint. One bar, at the bottom, after you have already got an answer
// out of the app at least once on an earlier visit.
//
// Safari has never implemented beforeinstallprompt, in any version including
// 26.6, so on iOS this is copy and a glyph and nothing else. Several current
// blog posts claim iOS 16.4 added it. They are wrong and the claim spreads, so
// there is deliberately no iOS code path waiting for that event.
//
// iOS 26 also defaults the tab layout to Compact, which hides Share behind a
// "..." button, and the setting is not readable from JS. The copy covers both
// layouts rather than guessing which one is on.
//
// The room screen's maps hand-off lives here too. It is the same question this
// file already answers, which phone is this, and the answer was wrong there for
// the same reason it would be wrong here: a silent iOS difference nobody sees.

const BASE = '/Vacant/';

export const HINT_KEY = 'vacant.installHint.v1';

// A user who ignored the bar without dismissing it gets asked again, once, after
// a week. A user who tapped the X is never asked again.
export const NAG_DAYS = 7;

export const EMPTY_STATE = { seenList: false, dismissed: false, lastShown: 0 };

// iPadOS 13 and later send a desktop Safari UA. Touch points is the only tell
// left, and it is why this takes maxTouchPoints instead of reading navigator.
export function isIOS(ua, maxTouchPoints = 0) {
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  return /Macintosh/.test(ua) && maxTouchPoints > 1;
}

// Every browser on iOS is WebKit, but only Safari can add to the home screen the
// way the copy describes. The other engines-in-name-only announce themselves,
// and an in-app webview is the one WebKit that sends no Version/ token at all.
export function isIOSSafari(ua, maxTouchPoints = 0) {
  if (!isIOS(ua, maxTouchPoints)) return false;
  if (/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua)) return false;
  return /Version\/\d/.test(ua);
}

export function needsSafari(ua, maxTouchPoints = 0) {
  return isIOS(ua, maxTouchPoints) && !isIOSSafari(ua, maxTouchPoints);
}

// The room screen's hand-off to something that actually routes, next to isIOS
// because the whole question is which platform is asking. Getting it wrong is
// silent: an unhandled scheme fires no error and no navigation, so the button
// just does nothing. One geo: URI used to serve everyone, and Apple has never
// registered a geo: handler, so on the platform this file exists to serve, it
// was inert.
//
// An anchor carries one href and a dead scheme raises no event to fall through
// on, so the ranked chain is decided here, when the screen renders, rather than
// tried in order when it is tapped. Both branches are https, so neither can
// land nowhere: iOS gets the app an iPhone is guaranteed to have, everything
// else gets the link Android's Google Maps claims and a desktop opens as a web
// route. Checked against the live hosts 2026-09-01: Apple redirects the
// saddr/daddr/dirflg form to /directions?mode=walking, so it still parses them,
// and Google answers api=1 with a 200.
//
// The origin goes in only on a GPS fix. A route drawn from the Oval fallback or
// from a building picked off a list starts where the student is not standing.
export function mapsHref({ lat, lon, origin, ua = '', maxTouchPoints = 0 }) {
  const q = (pairs) => new URLSearchParams(pairs.filter(([, v]) => v != null)).toString();
  const to = `${lat},${lon}`;
  const from = origin?.source === 'gps' ? `${origin.lat},${origin.lon}` : null;
  return isIOS(ua, maxTouchPoints)
    ? `https://maps.apple.com/?${q([['saddr', from], ['daddr', to], ['dirflg', 'w']])}`
    : `https://www.google.com/maps/dir/?${q([
        ['api', '1'],
        ['origin', from],
        ['destination', to],
        ['travelmode', 'walking'],
      ])}`;
}

// navigator.standalone first: it is the only signal iOS gives before the
// display-mode media query is reliable, and it is what an old iPhone has.
export function isStandalone(nav, matchMediaFn) {
  if (nav && nav.standalone === true) return true;
  if (typeof matchMediaFn !== 'function') return false;
  try {
    return (
      matchMediaFn('(display-mode: standalone)').matches ||
      matchMediaFn('(display-mode: fullscreen)').matches
    );
  } catch {
    return false;
  }
}

export function readState(store) {
  try {
    const raw = store.getItem(HINT_KEY);
    if (!raw) return { ...EMPTY_STATE };
    const parsed = JSON.parse(raw);
    return {
      seenList: parsed.seenList === true,
      dismissed: parsed.dismissed === true,
      lastShown: Number(parsed.lastShown) || 0,
    };
  } catch {
    return { ...EMPTY_STATE };
  }
}

export function writeState(store, state) {
  try {
    store.setItem(HINT_KEY, JSON.stringify(state));
  } catch {
    // Private mode, a full quota, or a browser with site data switched off. A
    // hint bar is not worth an exception, and the worst case is asking twice.
  }
}

// `state` is what was on disk when the page loaded, so seenList true means a
// ranked list rendered on an EARLIER visit. That is what "never on the first
// visit" has to mean; a counter bumped this visit would show the bar the moment
// the first answer appeared.
export function shouldShow(state, now) {
  if (state.dismissed) return false;
  if (!state.seenList) return false;
  return now - state.lastShown >= NAG_DAYS * 86400000;
}

function safeStore() {
  try {
    localStorage.getItem(HINT_KEY);
    return localStorage;
  } catch {
    const memory = new Map();
    return {
      getItem: (k) => (memory.has(k) ? memory.get(k) : null),
      setItem: (k, v) => memory.set(k, v),
    };
  }
}

const SHARE_GLYPH = `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">
  <path d="M12 3.5v11M8.6 6.9 12 3.5l3.4 3.4"/>
  <path d="M7.5 10.5H5.5v10h13v-10h-2"/>
</svg>`;

function bar(doc, { glyph, html, action }) {
  const el = doc.createElement('aside');
  el.className = 'bar';
  el.id = 'hint';
  el.setAttribute('role', 'note');
  el.setAttribute('aria-label', 'Install Vacant');
  el.innerHTML = `${glyph}<p>${html}</p>`;

  if (action) {
    const go = doc.createElement('button');
    go.type = 'button';
    go.className = 'bar-go';
    go.textContent = action.label;
    go.onclick = action.run;
    el.append(go);
  }

  const close = doc.createElement('button');
  close.type = 'button';
  close.className = 'bar-x';
  close.setAttribute('aria-label', 'Dismiss the install hint');
  close.innerHTML = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
  el.append(close);
  return { el, close };
}

export const RAIL = 'bars';

// Both bars can be up at once. Showing the hint prefetches the term, that fetch
// goes through the worker's stale-while-revalidate, and a moved file is what
// raises the refresh bar, so it is a normal path rather than a rare one. Each
// one fixed to bottom: 0 meant the newer bar painted over the older one:
// measured on a 393x852 phone, the refresh bar covered all but 12px of the hint
// and elementFromPoint at the centre of the hint's dismiss X returned an element
// inside the refresh bar. They share one rail and stack instead.
export function mountBar(doc, el) {
  rail(doc).append(el);
  measure(doc);
}

export function unmountBar(doc, el) {
  el.remove();
  const holder = doc.getElementById(RAIL);
  if (holder && !holder.children.length) holder.remove();
  measure(doc);
}

function rail(doc) {
  const found = doc.getElementById(RAIL);
  if (found) return found;
  const holder = doc.createElement('div');
  holder.id = RAIL;
  doc.body.append(holder);
  return holder;
}

// A fixed rail sits over the bottom of the sheet, duration chips and all. The
// sheet is raised by that height rather than losing it, measured off the rail
// itself: the copy wraps differently at different text sizes, and two bars are
// twice the debt of one.
function measure(doc) {
  const holder = doc.getElementById(RAIL);
  if (!holder) {
    doc.body.classList.remove('has-bar');
    doc.body.style.removeProperty('--bar-h');
    return;
  }
  doc.body.style.setProperty('--bar-h', `${Math.ceil(holder.getBoundingClientRect().height)}px`);
  doc.body.classList.add('has-bar');
}

// Warms the shared HTTP cache, which is the one thing an installed icon on iOS
// inherits. Every home-screen icon gets its own CacheStorage jar, isolated from
// the Safari tab that cached all of this while the hint was on screen, so the
// first standalone launch would otherwise start from nothing.
async function prefetchTerm() {
  try {
    const pointer = await fetch(`${BASE}data/current.json`);
    if (!pointer.ok) return;
    const current = await pointer.json();
    if (current.rooms) await fetch(BASE + String(current.rooms).replace(/^\//, ''));
  } catch {
    // The prefetch is an optimisation. Failing it changes nothing the user sees.
  }
}

// The bar is gated on a ranked list having rendered, and the list is app.js's.
// Watching the DOM for the first row keeps that gate here instead of reaching
// into another module's boot.
function onFirstRow(doc, run) {
  const list = doc.getElementById('list');
  if (!list) return;
  if (list.querySelector('.row')) {
    run();
    return;
  }
  const observer = new MutationObserver(() => {
    if (!list.querySelector('.row')) return;
    observer.disconnect();
    run();
  });
  observer.observe(list, { childList: true, subtree: true });
}

export function initInstallHint(options = {}) {
  const doc = options.doc || document;
  const win = options.win || window;
  const nav = options.nav || navigator;
  const store = options.store || safeStore();
  const now = options.now || (() => Date.now());

  if (isStandalone(nav, win.matchMedia && ((q) => win.matchMedia(q)))) return;

  const entry = readState(store);
  let deferred = null;
  let shown = false;
  // Android fires beforeinstallprompt during load. The bar still waits for a
  // ranked list, because a bar over the question screen interrupts the one
  // thing the app asks you.
  let answered = false;

  const ua = nav.userAgent || '';
  const touch = nav.maxTouchPoints || 0;
  const ios = isIOSSafari(ua, touch);
  const wrongBrowser = needsSafari(ua, touch);

  win.addEventListener('beforeinstallprompt', (event) => {
    // Without preventDefault Chrome shows its own mini-infobar over the map.
    event.preventDefault();
    deferred = event;
    show();
  });

  win.addEventListener('appinstalled', () => {
    writeState(store, { ...readState(store), dismissed: true });
    const bar = doc.getElementById('hint');
    if (bar) unmountBar(doc, bar);
  });

  function show() {
    if (shown || !answered || !shouldShow(entry, now())) return;
    if (!ios && !wrongBrowser && !deferred) return;
    shown = true;

    const built = wrongBrowser
      ? bar(doc, {
          glyph: SHARE_GLYPH,
          html: 'Open Vacant in Safari to keep it on your home screen.',
        })
      : ios
        ? bar(doc, {
            glyph: SHARE_GLYPH,
            html: 'Keep Vacant on your home screen. Tap Share, or <b>&hellip;</b> then Share, then <b>Add to Home Screen</b>.',
          })
        : bar(doc, {
            glyph: SHARE_GLYPH,
            html: 'Keep Vacant on your home screen.',
            action: {
              label: 'Install',
              run: async () => {
                const prompt = deferred;
                deferred = null;
                unmountBar(doc, built.el);
                try {
                  await prompt.prompt();
                } catch {
                  // The prompt can only be shown once per event. Losing it costs
                  // the tap, not the app.
                }
              },
            },
          });

    built.close.onclick = () => {
      writeState(store, { ...readState(store), dismissed: true });
      unmountBar(doc, built.el);
    };
    mountBar(doc, built.el);
    writeState(store, { ...readState(store), lastShown: now() });
    prefetchTerm();
  }

  onFirstRow(doc, () => {
    answered = true;
    if (!entry.seenList) writeState(store, { ...readState(store), seenList: true });
    show();
  });
}
