// The install hint's decisions, without a browser. Everything here is a pure
// function over a user agent string, a stored object and a clock, which is
// deliberate: the parts that need a DOM are verified headlessly instead.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  EMPTY_STATE,
  HINT_KEY,
  NAG_DAYS,
  RAIL,
  initInstallHint,
  isIOS,
  isIOSSafari,
  isStandalone,
  mapsHref,
  needsSafari,
  mountBar,
  readState,
  shouldShow,
  unmountBar,
  writeState,
} from '../../js/install.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const source = readFileSync(join(ROOT, 'js', 'install.js'), 'utf8');

const SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const CHROME =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.153 Mobile/15E148 Safari/604.1';
const FIREFOX =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/127.0 Mobile/15E148 Safari/605.1.15';
const EDGE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) EdgiOS/126.0 Mobile/15E148 Safari/605.1.15';
const OPERA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) OPiOS/16.0 Mobile/15E148 Safari/9537.53';
// An in-app browser, the one inside Instagram or a mail client. Same WebKit,
// no Version/ token, and no Add to Home Screen anywhere in its chrome.
const WEBVIEW =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 331.0.0.37.90';
const IPADOS =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
const DESKTOP =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
const ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';

test('only real Safari on iOS gets the Share instructions', () => {
  assert.equal(isIOSSafari(SAFARI), true);
  for (const [name, ua] of [
    ['Chrome', CHROME],
    ['Firefox', FIREFOX],
    ['Edge', EDGE],
    ['Opera', OPERA],
    ['a webview', WEBVIEW],
  ]) {
    assert.equal(isIOSSafari(ua), false, `${name} was treated as Safari`);
    assert.equal(needsSafari(ua), true, `${name} was not sent to Safari`);
  }
  assert.equal(needsSafari(SAFARI), false);
  assert.equal(needsSafari(ANDROID), false);
});

test('iPadOS sends a desktop user agent, so touch points decide', () => {
  // Identical strings. The only difference between an iPad and a Mac here is
  // that the iPad reports touch points.
  assert.equal(IPADOS, DESKTOP);
  assert.equal(isIOS(IPADOS, 5), true);
  assert.equal(isIOS(DESKTOP, 0), false);
  assert.equal(isIOSSafari(IPADOS, 5), true);
  assert.equal(isIOSSafari(DESKTOP, 0), false);
});

test('an installed app is never asked to install', () => {
  const no = () => ({ matches: false });
  assert.equal(isStandalone({ standalone: true }, no), true);
  assert.equal(isStandalone({}, (q) => ({ matches: q.includes('standalone') })), true);
  assert.equal(isStandalone({}, (q) => ({ matches: q.includes('fullscreen') })), true);
  assert.equal(isStandalone({}, no), false);
  assert.equal(isStandalone({ standalone: false }, no), false);
  // Some engines throw on an unknown media feature rather than returning false.
  assert.equal(
    isStandalone({}, () => {
      throw new Error('unsupported media feature');
    }),
    false,
  );
  assert.equal(isStandalone(undefined, undefined), false);
});

test('the bar never shows on a first visit, and dismissal is permanent', () => {
  const now = Date.UTC(2026, 7, 27);
  const week = NAG_DAYS * 86400000;
  assert.equal(shouldShow(EMPTY_STATE, now), false, 'shown on a first visit');
  assert.equal(shouldShow({ seenList: true, dismissed: true, lastShown: 0 }, now), false);
  assert.equal(shouldShow({ seenList: true, dismissed: false, lastShown: 0 }, now), true);
  assert.equal(
    shouldShow({ seenList: true, dismissed: false, lastShown: now - week + 1 }, now),
    false,
    're-nagged inside a week',
  );
  assert.equal(shouldShow({ seenList: true, dismissed: false, lastShown: now - week }, now), true);
});

test('a storage that throws costs the hint and nothing else', () => {
  const angry = {
    getItem() {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    },
    setItem() {
      throw new DOMException('quota exceeded', 'QuotaExceededError');
    },
  };
  assert.deepEqual(readState(angry), EMPTY_STATE);
  assert.doesNotThrow(() => writeState(angry, { seenList: true }));

  // The whole init path, with a page that has no list yet and a storage that
  // refuses every call. Nothing here is allowed to reach the app.
  const listeners = [];
  assert.doesNotThrow(() =>
    initInstallHint({
      doc: { getElementById: () => null, body: null },
      win: { addEventListener: (t) => listeners.push(t), matchMedia: undefined },
      nav: { userAgent: SAFARI, maxTouchPoints: 5 },
      store: angry,
      now: () => 0,
    }),
  );
  assert.deepEqual(listeners, ['beforeinstallprompt', 'appinstalled']);
});

test('garbage in storage reads as a fresh state', () => {
  const holds = (value) => ({ getItem: () => value, setItem: () => {} });
  assert.deepEqual(readState(holds('not json')), EMPTY_STATE);
  assert.deepEqual(readState(holds('null')), EMPTY_STATE);
  assert.deepEqual(readState(holds('{"seenList":"yes","lastShown":"soon"}')), EMPTY_STATE);
  const real = { seenList: true, dismissed: false, lastShown: 42 };
  assert.deepEqual(readState(holds(JSON.stringify(real))), real);
});

test('the storage key is namespaced so it cannot collide with Finder', () => {
  // enesyilmazcode.github.io is one origin shared with every other project on
  // it, and localStorage is per origin, not per path.
  assert.equal(HINT_KEY, 'vacant.installHint.v1');
  const keys = [...source.matchAll(/'(vacant\.[^']+)'/g)].map((m) => m[1]);
  assert.ok(keys.length > 0);
  for (const key of keys) assert.match(key, /^vacant\./);
});

test('the copy covers both Safari tab layouts and names no hidden setting', () => {
  // iOS 26 defaults to the Compact layout, which puts Share behind a "..."
  // button, and the setting is not readable from JS.
  assert.match(source, /Tap Share, or <b>&hellip;<\/b> then Share/);
  assert.match(source, /Add to Home Screen/);
  assert.equal(source.includes('Open as Web App'), false);
  assert.match(source, /Open Vacant in Safari/);
});

test('no iOS code path waits for beforeinstallprompt', () => {
  // Safari has never fired it, in any version. Several current posts claim iOS
  // 16.4 added it; they are wrong, and a hint that waits for it never appears.
  const listener = source.slice(source.indexOf("addEventListener('beforeinstallprompt'"));
  const handler = listener.slice(0, listener.indexOf('});'));
  assert.match(handler, /event\.preventDefault\(\)/);
  assert.equal(/ios|isIOSSafari/.test(handler), false, 'the iOS branch is inside the Android event');
});

// Enough of a DOM to mount a bar into. Heights are fixed per element so the
// stacking maths is checkable; the real ones are measured in a browser.
function page() {
  const make = (id = '') => {
    const el = {
      id,
      height: 0,
      children: [],
      parent: null,
      style: {
        props: new Map(),
        setProperty(key, value) { this.props.set(key, value); },
        removeProperty(key) { this.props.delete(key); },
      },
      classes: new Set(),
      append(child) {
        child.parent = el;
        el.children.push(child);
      },
      remove() {
        if (!el.parent) return;
        el.parent.children = el.parent.children.filter((c) => c !== el);
        el.parent = null;
      },
      getBoundingClientRect() {
        return { height: el.children.length ? el.children.reduce((n, c) => n + c.height, 0) : el.height };
      },
    };
    el.classList = { add: (c) => el.classes.add(c), remove: (c) => el.classes.delete(c), contains: (c) => el.classes.has(c) };
    return el;
  };
  const body = make('body');
  const find = (node, id) => {
    for (const child of node.children) {
      if (child.id === id) return child;
      const deeper = find(child, id);
      if (deeper) return deeper;
    }
    return null;
  };
  return { make, doc: { body, createElement: () => make(), getElementById: (id) => find(body, id) } };
}

test('two bars stack instead of covering each other', () => {
  // Showing the hint prefetches the term, and that fetch is what raises the
  // refresh bar, so both up at once is a normal path. Fixed to bottom: 0 each,
  // the refresh bar painted over the hint and the hint's 44px dismiss X stopped
  // answering taps. Heights here are the ones measured at 393x852.
  const { doc, make } = page();
  const hint = make('hint');
  hint.height = 79;
  const refresh = make('refresh');
  refresh.height = 67;

  mountBar(doc, hint);
  assert.equal(doc.body.style.props.get('--bar-h'), '79px');
  mountBar(doc, refresh);
  assert.equal(doc.body.style.props.get('--bar-h'), '146px');

  const rail = doc.getElementById(RAIL);
  assert.deepEqual(rail.children.map((c) => c.id), ['hint', 'refresh']);
  assert.equal(hint.parent, rail);
  assert.equal(refresh.parent, rail);

  // Dismissing the newer one leaves the older one measured, not orphaned.
  unmountBar(doc, refresh);
  assert.equal(doc.body.style.props.get('--bar-h'), '79px');
  assert.equal(doc.body.classes.has('has-bar'), true);
  assert.equal(doc.getElementById('refresh'), null);

  unmountBar(doc, hint);
  assert.equal(doc.body.classes.has('has-bar'), false);
  assert.equal(doc.body.style.props.get('--bar-h'), undefined);
  assert.equal(doc.getElementById(RAIL), null, 'the empty rail is still in the page');
});

test('a bar has no fixed position of its own', () => {
  // The rail owns the position and the safe-area inset. A .bar that goes back to
  // claiming bottom: 0 puts the two on top of each other again.
  const css = readFileSync(join(ROOT, 'index.html'), 'utf8');
  const rule = (selector) => {
    const at = css.indexOf(selector);
    assert.ok(at > 0, `no ${selector} rule`);
    return css.slice(at, css.indexOf('}', at));
  };
  const bars = rule('#bars {');
  assert.match(bars, /position: fixed/);
  assert.match(bars, /bottom: 0/);
  assert.match(bars, /flex-direction: column/);
  assert.match(bars, /padding-bottom: var\(--safe-b\)/);
  const bar = rule('\n  .bar {');
  assert.equal(/position: fixed|bottom: 0|z-index/.test(bar), false, 'a .bar positions itself');
});

// ---- maps-handoff

// The one thing about the room screen's hand-off that cannot be seen by opening
// the app: which scheme each platform gets. It was a geo: URI for everyone, and
// Apple has never registered a geo: handler, so on an iPhone it did nothing at
// all. A link to a scheme nobody claims fires no error and no navigation, which
// is why this is a test rather than something a person would notice.

const WIN_CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const THERE = { lat: 39.99852017, lon: -83.01626613 };
const GPS = { lat: 39.99944, lon: -83.01502, source: 'gps' };
const OVAL = { lat: 39.9995, lon: -83.013, source: 'oval', label: 'the Oval' };
const PICKED = { lat: 40.00052277, lon: -83.01443196, source: 'picked', label: 'University Hall' };

const href = (extra) => mapsHref({ ...THERE, ...extra });

// Every platform the sniff has a branch for, plus the two it has to keep apart:
// iPadOS sends a desktop Safari UA, and only maxTouchPoints separates them.
const PLATFORMS = [
  ['an iPhone', SAFARI, 1, 'maps.apple.com'],
  ['Chrome on iOS', CHROME, 1, 'maps.apple.com'],
  ['an iOS webview', WEBVIEW, 1, 'maps.apple.com'],
  ['iPadOS', IPADOS, 5, 'maps.apple.com'],
  ['a Mac', DESKTOP, 0, 'www.google.com'],
  ['Android', ANDROID, 5, 'www.google.com'],
  ['desktop Chrome', WIN_CHROME, 0, 'www.google.com'],
];

test('iOS gets Apple Maps walking directions, and never a geo: URI', () => {
  for (const [name, ua, touch, host] of PLATFORMS.filter((p) => p[3] === 'maps.apple.com')) {
    const url = new URL(href({ ua, maxTouchPoints: touch, origin: GPS }));
    assert.equal(url.host, host, `${name} got ${url.host}`);
    // dirflg=w is Apple's own walking flag. maps.apple.com answers this exact
    // form with a redirect to /directions?mode=walking, measured 2026-09-01,
    // which is how we know the parameters are still read.
    assert.equal(url.searchParams.get('dirflg'), 'w', `${name} did not ask for walking`);
    assert.equal(url.searchParams.get('daddr'), '39.99852017,-83.01626613');
    assert.equal(url.searchParams.get('saddr'), '39.99944,-83.01502');
  }
});

test('everything that is not iOS gets Google walking directions', () => {
  for (const [name, ua, touch, host] of PLATFORMS.filter((p) => p[3] === 'www.google.com')) {
    const url = new URL(href({ ua, maxTouchPoints: touch, origin: GPS }));
    assert.equal(url.host, host, `${name} got ${url.host}`);
    assert.equal(url.pathname, '/maps/dir/', `${name} got ${url.pathname}`);
    assert.equal(url.searchParams.get('api'), '1', `${name} lost the api=1 that names the format`);
    assert.equal(url.searchParams.get('travelmode'), 'walking', `${name} did not ask for walking`);
    assert.equal(url.searchParams.get('destination'), '39.99852017,-83.01626613');
    assert.equal(url.searchParams.get('origin'), '39.99944,-83.01502');
  }
});

test('no branch of the chain can land nowhere, and none of them drives', () => {
  // The whole defect was a scheme with no handler. https has one everywhere, so
  // the worst case is a web page rather than a tap that does nothing. A driving
  // route across the Oval would be the other way to be wrong out loud.
  for (const [name, ua, touch] of PLATFORMS) {
    for (const origin of [GPS, OVAL, PICKED, null, undefined]) {
      const raw = href({ ua, maxTouchPoints: touch, origin });
      const url = new URL(raw);
      assert.equal(url.protocol, 'https:', `${name} got ${url.protocol}`);
      assert.equal(/walking|dirflg=w/.test(raw), true, `${name} did not ask for walking: ${raw}`);
    }
  }
});

test('the route starts from the user only when the fix is GPS', () => {
  // The Oval fallback and a picked building are both places the student is not
  // standing. Routing from one of them is a wrong first instruction, which is
  // worse than starting the route wherever the maps app thinks you are.
  for (const [name, ua, touch] of PLATFORMS) {
    for (const [what, origin] of [['the Oval', OVAL], ['a picked building', PICKED], ['no fix', null]]) {
      const url = new URL(href({ ua, maxTouchPoints: touch, origin }));
      assert.equal(url.searchParams.has('saddr'), false, `${name} routed from ${what}`);
      assert.equal(url.searchParams.has('origin'), false, `${name} routed from ${what}`);
      // The destination still has to survive, or the button loses its point.
      const to = url.searchParams.get('daddr') ?? url.searchParams.get('destination');
      assert.equal(to, '39.99852017,-83.01626613', `${name} lost the destination with ${what}`);
    }
  }
});

// #52's done-when was `grep -c 'Open in Maps' js/` returns 0. It passed at
// ccd4db5 because the label had been shortened to "Maps" while the button was
// still there, so the check reported the feature gone and the feature was not.
// These two grep the capability instead of the wording.
const code = (src) => src.replace(/^\s*\/\/.*$/gm, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');

test('nothing in js/ hands off a geo: URI', () => {
  const bad = [];
  for (const name of readdirSync(join(ROOT, 'js'))) {
    const hits = code(readFileSync(join(ROOT, 'js', name), 'utf8')).match(/geo:/g);
    if (hits) bad.push(`js/${name} (${hits.length})`);
  }
  assert.deepEqual(bad, [], `geo: is inert on iOS and it is back in ${bad.join(', ')}`);
});

test('the room screen hands off, and says what it hands off to', () => {
  const app = readFileSync(join(ROOT, 'js', 'app.js'), 'utf8');
  assert.match(app, /href="\$\{esc\(mapsHref\(/, 'the room screen builds its own maps URL again');
  assert.match(app, />Directions<\/a>/, '"Maps" is a place, "Directions" is what the button does');
});
