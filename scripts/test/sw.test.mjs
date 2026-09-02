// The service worker, read as text. None of this runs the worker; it checks the
// things that are invisible in a browser and permanent on a phone: a cache name
// that never changes, a precache entry naming a file that does not exist, a
// skipWaiting in install.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { stamp } from '../stamp-sw.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const source = readFileSync(join(ROOT, 'sw.js'), 'utf8');

// The comments in this repo explain the traps by name, so a token search over
// the raw file finds "skipWaiting" and "__BUILD_ID__" in the prose that says
// they are not there. Every comment in sw.js is a whole line.
const sw = source
  .split(/\r?\n/)
  .filter((line) => !line.trim().startsWith('//'))
  .join('\n');

const SCOPE = '/Vacant/';

function constant(name) {
  const found = sw.match(new RegExp(`const ${name} = '([^']*)'`));
  assert.ok(found, `no ${name} constant in sw.js`);
  return found[1];
}

function shellAssets() {
  const block = sw.match(/const SHELL_ASSETS = \[([^\]]*)\]/);
  assert.ok(block, 'no SHELL_ASSETS array');
  return block[1]
    .split(',')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((entry) =>
      entry === 'SCOPE'
        ? SCOPE
        : entry === 'SHELL_DOC'
          ? `${SCOPE}index.html`
          : entry.replace(/^SCOPE \+ '/, SCOPE).replace(/'$/, ''),
    );
}

test('the build stamp actually ran before the commit', () => {
  // A committed __BUILD_ID__ means scripts/stamp-sw.mjs was skipped, which means
  // every installed icon keeps serving the shell it already has. Nothing in a
  // browser shows this; the app just stops matching the deploy.
  assert.equal(sw.includes('__BUILD_ID__'), false, 'sw.js is unstamped');
  assert.match(constant('SHELL_CACHE'), /^vacant-shell-[0-9a-f]{7,}$/);
});

test('the stamper is idempotent and rewrites a previous stamp', () => {
  assert.match(stamp(sw, 'abc1234'), /const SHELL_CACHE = 'vacant-shell-abc1234';/);
  assert.match(
    stamp(stamp(sw, 'abc1234'), 'def5678'),
    /const SHELL_CACHE = 'vacant-shell-def5678';/,
  );
  assert.match(
    stamp("const SHELL_CACHE = 'vacant-shell-__BUILD_ID__';", 'abc1234'),
    /vacant-shell-abc1234/,
  );
});

test('the two caches are distinct and the data cache is not stamped', () => {
  const shell = constant('SHELL_CACHE');
  const data = constant('DATA_CACHE');
  assert.notEqual(shell, data);
  // The data cache exists so a shell bumped on every deploy does not drag 27 KB
  // of room index down with it. A stamped name here would defeat the split.
  assert.equal(data, 'vacant-data-v1');
});

test('every precached shell asset is absolute under /Vacant/ and on disk', () => {
  const assets = shellAssets();
  assert.ok(assets.length >= 8, `only found ${assets.length} shell assets`);
  for (const asset of assets) {
    assert.ok(asset.startsWith(SCOPE), `${asset} is not under ${SCOPE}`);
    // `/Vacant/` and `/Vacant/index.html` are the same bytes at two cache keys,
    // and a navigation can arrive as either, so both are expected here.
    const file = asset === SCOPE ? 'index.html' : asset.slice(SCOPE.length);
    assert.ok(existsSync(join(ROOT, file)), `${asset} names a file that is not in the repo`);
  }
  assert.ok(assets.includes(SCOPE));
  assert.ok(assets.includes(`${SCOPE}index.html`));
});

// The modules the page loads, plus everything those modules import, followed
// transitively. Derived rather than restated: SHELL_ASSETS is a second copy of
// this set, and the copy drifted -- js/claim.js, js/day.js, js/sheet.js and
// js/state.js were imported by js/app.js and named in no version of that list:
// `git log -S'js/state.js' -- sw.js` is empty. That is 23,296 gzipped bytes at
// this commit, so install cached a js/app.js it could not evaluate. A test that
// listed the four by name would have caught it once and then drifted the same
// way on the next module.
//
// Static imports only. A dynamic `import('./dev.js')` is deliberately invisible
// here: an on-demand module is fetched when it is asked for and cacheFirst
// caches it then. Every STATIC form has to be visible, though, and the first
// draft of this walk saw four of nine. The one that mattered was side-effect
// `import './x.js'`, which has no `from`: a developer who added such a module
// AND correctly precached it was told "js/x.js is precached and nothing on the
// boot path imports it", i.e. instructed to delete a file the page needs, which
// is the bug this whole test exists to stop. Double quotes, extra whitespace and
// a newline before the specifier were missed the same way.
//
// Comments are stripped first, and that is not cosmetic. This walk READS the
// path it then opens, so prose is executable here: a comment reading
// "toGrid used to come from './grid.js'" made the suite die with ENOENT on a
// file that does not exist, and one mentioning `from './dev.js'` made it demand
// the dev panel be precached, against dev.test.mjs which forbids exactly that.
// stripComments is the same routine the term-asset scan below uses, for the
// same reason.
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

function pageModules() {
  const html = stripComments(readFileSync(join(ROOT, 'index.html'), 'utf8').replace(/<!--[\s\S]*?-->/g, ''));
  const entries = [...html.matchAll(/<script[^>]*\ssrc="\/Vacant\/(js\/[\w.-]+\.js)"/g)].map((m) => m[1]);
  assert.ok(entries.length >= 2, `index.html loads ${entries.length} modules, the match is wrong`);
  const seen = new Set();
  const queue = [...entries];
  while (queue.length) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    const src = stripComments(readFileSync(join(ROOT, file), 'utf8'));
    // `from './x.js'` covers named, default, namespace and re-export forms.
    for (const found of src.matchAll(/\bfrom\s*['"]\.\/([\w.-]+\.js)['"]/g)) queue.push(`js/${found[1]}`);
    // And bare `import './x.js'`, which has no `from` at all. The negative
    // lookahead keeps `import(` — the dynamic form — out of it.
    for (const found of src.matchAll(/\bimport\s*['"]\.\/([\w.-]+\.js)['"]/g)) queue.push(`js/${found[1]}`);
  }
  return [...seen].sort();
}

test('every module the page loads, and everything it imports, is precached', () => {
  const wanted = pageModules();
  // A guard on the walk itself: if the entry match or the import match silently
  // stopped finding anything, the comparison below would pass on two empty sets.
  assert.ok(wanted.includes('js/app.js'), 'the walk did not reach js/app.js');
  assert.ok(wanted.includes('js/state.js'), 'the walk did not follow app.js into state.js');
  assert.ok(wanted.length >= 9, `only ${wanted.length} modules reached, the walk is broken`);

  const precached = shellAssets()
    .filter((asset) => asset.startsWith(`${SCOPE}js/`))
    .map((asset) => asset.slice(SCOPE.length))
    .sort();
  const missing = wanted.filter((file) => !precached.includes(file));
  const extra = precached.filter((file) => !wanted.includes(file));
  assert.deepEqual(
    missing,
    [],
    `the boot path imports ${missing.join(', ')}, and install does not cache ${missing.length > 1 ? 'them' : 'it'}`,
  );
  // The other direction is waste rather than breakage, but a module that left
  // the graph and stayed in the list is bytes on a phone for nothing.
  assert.deepEqual(extra, [], `${extra.join(', ')} is precached and nothing on the boot path imports it`);
});

test('js/dev.js is reached through import(), which is what keeps it out of the graph', () => {
  // The walk above follows `from` and so cannot see js/dev.js, and that is only
  // correct while js/app.js asks for it with import(). A static import would put
  // it on the boot path, where 5,024 gzipped bytes would then have to be
  // precached for a panel almost nobody opens. scripts/test/dev.test.mjs holds
  // the other half: that it is not in the shell list.
  const app = readFileSync(join(ROOT, 'js', 'app.js'), 'utf8');
  assert.match(app, /import\('\.\/dev\.js'\)/);
  assert.equal(/\bfrom '\.\/dev\.js'/.test(app), false, 'js/dev.js is imported statically now, so the walk misses a boot module');
});

test('install precaches and does not skip waiting', () => {
  const install = sw.slice(sw.indexOf("addEventListener('install'"), sw.indexOf("addEventListener('activate'"));
  assert.ok(install.includes('addAll(SHELL_ASSETS)'));
  // A worker that takes over a live page can hand a new data shape to page JS
  // loaded to read the old one, so the page has to ask for it.
  assert.equal(install.includes('skipWaiting'), false);
  assert.match(sw, /addEventListener\('message'[^]*?event\.data === 'SKIP_WAITING'[^]*?skipWaiting\(\)/);
});

test('activate drops the stale Vacant caches and evicts last term', () => {
  const activate = sw.slice(sw.indexOf("addEventListener('activate'"), sw.indexOf("addEventListener('message'"));
  assert.match(activate, /ours\(n\) && n !== SHELL_CACHE && n !== DATA_CACHE/);
  assert.match(activate, /caches\.delete/);
  assert.match(activate, /evictOldTerms\(\)/);
  const evict = sw.slice(sw.indexOf('async function evictOldTerms'));
  assert.match(evict, /rooms\|buildings/);
  assert.match(evict, /data\.delete\(request\)/);
});

test('a deploy never touches a neighbour project cache', () => {
  // CacheStorage is per origin, not per path, and enesyilmazcode.github.io also
  // hosts Finder and the portfolio. Measured before this test existed: one
  // Vacant deploy deleted finder-shell-v3 and portfolio-v1, and
  // caches.match('/Finder/index.html') came back empty afterwards.
  const prefix = sw.match(/const CACHE_PREFIX = '([^']*)';/);
  assert.ok(prefix, 'no CACHE_PREFIX in sw.js');
  assert.equal(prefix[1], 'vacant-');
  // The shipped predicate, run rather than read.
  const from = sw.indexOf('function ours(name)');
  const body = sw.slice(from, sw.indexOf('\n}', from) + 2);
  const ours = new Function('CACHE_PREFIX', `${body}\nreturn ours;`)(prefix[1]);

  const shell = constant('SHELL_CACHE');
  const data = constant('DATA_CACHE');
  const sweep = (names) => names.filter((n) => ours(n) && n !== shell && n !== data);
  assert.deepEqual(
    sweep([shell, data, 'vacant-shell-0000000', 'finder-shell-v3', 'portfolio-v1', 'workbox-precache-v2']),
    ['vacant-shell-0000000'],
  );
});

test('a network probe is never answered out of the cache', () => {
  // js/firstrun.js decides whether there is a network by asking for the term
  // pointer with cache: 'no-store'. Falling that back to the cached pointer
  // turns "is there a network" into "is there a cache": measured with the server
  // killed, the probe came back 200 and the offline card never rendered.
  const first = sw.slice(sw.indexOf('async function networkFirst'), sw.indexOf('async function staleWhileRevalidate'));
  const guard = first.indexOf("request.cache === 'no-store'");
  assert.ok(guard > 0, 'networkFirst answers a no-store request from the cache');
  assert.ok(guard < first.indexOf('await data.match(request)'), 'the cache fallback runs first anyway');
  const firstrun = readFileSync(join(ROOT, 'js', 'firstrun.js'), 'utf8');
  assert.match(firstrun, /cache: 'no-store'/);
});

test('a navigation falls back to the cached shell', () => {
  const navigate = sw.slice(sw.indexOf('async function navigate'), sw.indexOf('async function cacheFirst'));
  assert.match(navigate, /event\.preloadResponse/);
  assert.match(navigate, /shell\.match\(SHELL_DOC\)/);
  // Pages returns a real 404 page for a wrong path and there is no SPA
  // fallback, so a not-ok response has to fall through the same way a thrown
  // fetch does.
  assert.match(navigate, /response\.ok/);
});

test('term data is stale-while-revalidate and the pointer is network first', () => {
  assert.match(sw, /url\.pathname === CURRENT \? networkFirst\(request\) : staleWhileRevalidate\(/);
  const swr = sw.slice(sw.indexOf('async function staleWhileRevalidate'), sw.indexOf('function changed'));
  assert.match(swr, /event\.waitUntil\(update\)/);
  assert.match(swr, /announce\(request\.url\)/);
});

test('a changed file is only claimed when both sides carry the same header', () => {
  const changed = sw.slice(sw.indexOf('function changed('), sw.indexOf('async function announce'));
  assert.match(changed, /ETag/);
  assert.match(changed, /Last-Modified/);
  assert.match(changed, /if \(a && b\) return a !== b;/);
  assert.match(changed, /return false;/);
});

test('the page registers with the options that make an update land', () => {
  const pwa = readFileSync(join(ROOT, 'js', 'pwa.js'), 'utf8');
  assert.match(pwa, /register\(`\$\{SCOPE\}sw\.js`, \{/);
  assert.match(pwa, /scope: SCOPE/);
  // Pages sends max-age=600 on sw.js itself and offers no way to change it.
  assert.match(pwa, /updateViaCache: 'none'/);
  assert.match(pwa, /postMessage\('SKIP_WAITING'\)/);
});

test('nothing in js/ hardcodes a term', () => {
  // Comments are exempt, and deliberately. Half the constants in js/engine.js
  // and js/state.js cite the file they were measured on, which is the term
  // index by name, and that provenance is the reason those numbers can be
  // rechecked at all. What must never carry a term is code: a term in a path,
  // a cache key or a comparison survives the rollover and breaks quietly on a
  // date nobody is watching.
  const term = JSON.parse(readFileSync(join(ROOT, 'data', 'current.json'), 'utf8')).term;
  const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const modules = readdirSync(join(ROOT, 'js')).filter((f) => f.endsWith('.js'));
  assert.ok(modules.length >= 8, `only ${modules.length} modules found, the glob is wrong`);
  for (const file of modules) {
    const src = code(readFileSync(join(ROOT, 'js', file), 'utf8'));
    assert.equal(src.includes(term), false, `js/${file} names term ${term} in code`);
  }
});

test('no KB estimate is written into the first-run copy', () => {
  // The gzipped rooms file changes size every week, so any figure here would
  // have to be stamped at build time, and the stamp is not in the jar the cold
  // standalone launch reads from.
  const firstrun = readFileSync(join(ROOT, 'js', 'firstrun.js'), 'utf8');
  assert.equal(/[0-9]+ ?KB/.test(firstrun), false);
});

test('term eviction only touches files that are actually term keyed', () => {
  const found = sw.match(/pathname\.match\((\/[^\n]*?\/)\);/);
  assert.ok(found, 'no eviction pattern in evictOldTerms');
  const pattern = new RegExp(found[1].slice(1, -1));
  const keeps = (name) => {
    const hit = `/Vacant/data/${name}`.match(pattern);
    return !hit || hit[1] === '1268';
  };
  // buildings-hours.json is the Registrar's opening times and is not keyed by
  // term. A \w capture matched it, read the term as "hours", and evicted the one
  // file that makes "the door is unlocked" answerable. Measured before the fix:
  // the app booted from cache with no hours file and never reached ready.
  assert.ok(keeps('buildings-hours.json'), 'evicted the building hours');
  assert.ok(keeps('current.json'));
  assert.ok(keeps('campus.json'));
  assert.ok(keeps('buildings.json'));
  assert.ok(keeps('rooms-1268.json'));
  assert.ok(keeps('buildings-1268.json'));
  assert.equal(keeps('rooms-1264.json'), false, 'kept last term');
  assert.equal(keeps('buildings-1262.json'), false, 'kept last term');
});

// gzip -9 over the bytes Pages serves. Text files are checked out with CRLF on
// Windows and served with LF, so the CR has to come back out before compressing
// or the answer is a local artefact rather than the transfer size.
function gzipped(file) {
  const raw = readFileSync(join(ROOT, file));
  const text = /[.](html|js|mjs|json|webmanifest|css)$/.test(file);
  return gzipSync(text ? Buffer.from(raw.toString('utf8').replace(/\r\n/g, '\n'), 'utf8') : raw, { level: 9 }).length;
}

test('the gzip figures in the header are the sizes of the files it caches', () => {
  // This is the comment that corrected an earlier pair of guessed numbers, and
  // it then went stale by 758 bytes across three edits to the shell. GNU gzip
  // and node's zlib disagree by about a tenth of a percent at the same level, so
  // the check is one percent wide: tight enough to catch a figure that stopped
  // describing the files, loose enough to survive the two tools.
  // `sw` has the comments stripped, so the claim is read from the raw file.
  const claimed = source.match(/Shell ([0-9,]+) bytes,[^0-9]*([0-9,]+)/);
  assert.ok(claimed, 'no measured shell and data figures in the sw.js header');
  const near = (label, said, real) => {
    const off = Math.abs(said - real) / real;
    assert.ok(off < 0.01, `${label} says ${said} and the files are ${real}, ${(off * 100).toFixed(1)}% out`);
  };

  const shell = shellAssets()
    .filter((asset) => asset !== SCOPE)
    .reduce((total, asset) => total + gzipped(asset.slice(SCOPE.length)), 0);
  near('shell', Number(claimed[1].replace(/,/g, '')), shell);

  const current = JSON.parse(readFileSync(join(ROOT, 'data', 'current.json'), 'utf8'));
  const at = sw.indexOf('const WARM_ALWAYS = [');
  assert.ok(at > 0, 'no WARM_ALWAYS array');
  const warm = sw
    .slice(at + 'const WARM_ALWAYS = ['.length, sw.indexOf(']', at))
    .split(',')
    .map((entry) => entry.trim().replace(/^'|'$/g, ''))
    .filter(Boolean);
  const data = ['data/current.json', current.rooms, current.buildings, ...warm].reduce(
    (total, file) => total + gzipped(file),
    0,
  );
  near('data', Number(claimed[2].replace(/,/g, '')), data);
});
