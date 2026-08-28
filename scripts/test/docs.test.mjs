// Offline. Reads the shipped tree, no network.
//
// These tests exist because every one of them caught a real sentence that had
// already shipped. The docs lane wrote four claims about an app that did not
// exist yet: a building picker on the no-location path, a weekly cron with no
// workflow behind it, an offline mode with no service worker, and a promise not
// to list rooms the app does list. Prose drifts from the build silently, so the
// claims that matter are asserted here against the build.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const has = (p) => existsSync(join(ROOT, p));

// Everything a reader can reach: the served pages, the top-level docs, and the
// docs directory one level down. `docs/research/` is deliberately excluded, it
// is an archive of options that were considered and rejected, and it is allowed
// to discuss things the app does not do.
function proseFiles() {
  const out = ['index.html', 'privacy.html', 'README.md'].filter(has);
  const walk = (rel) => {
    for (const name of readdirSync(join(ROOT, rel))) {
      const r = join(rel, name);
      if (statSync(join(ROOT, r)).isDirectory()) {
        if (name !== 'research') walk(r);
      } else if (name.endsWith('.md')) {
        out.push(r);
      }
    }
  };
  walk('docs');
  if (has('data/README.md')) out.push(join('data', 'README.md'));
  return out.map((p) => p.split(sep).join('/'));
}

const FILES = proseFiles();

test('the docs sweep is actually looking at the shipped pages', () => {
  // A walker that silently matched nothing would make every test below pass.
  assert.ok(FILES.length >= 8, `only found ${FILES.length} prose files`);
  for (const must of ['privacy.html', 'docs/DATA.md', 'docs/DEPLOY.md', 'docs/LAUNCH.md']) {
    assert.ok(FILES.includes(must), `${must} missing from the sweep`);
  }
});

// ---------------------------------------------------------------- case trap

test('no lowercase /vacant/ URL anywhere a reader can click', () => {
  // enesyilmazcode.github.io/Vacant/ is case sensitive and /vacant/ is a hard
  // 404. Survivable in a link, fatal in a start_url, because it fails only
  // after somebody installed the app and cannot see the address bar.
  const bad = [];
  for (const f of FILES) {
    read(f).split('\n').forEach((line, i) => {
      if (/github\.io\/vacant\//.test(line)) bad.push(`${f}:${i + 1}`);
    });
  }
  assert.deepEqual(bad, [], `lowercase github.io/vacant/ at ${bad.join(', ')}`);
});

// ---------------------------------------------------------------- offline

test('nothing claims the app works offline while there is no service worker', () => {
  const registers = has('sw.js')
    && ['index.html', 'privacy.html'].filter(has).some((f) => /serviceWorker/.test(read(f)));
  if (registers) return; // the claim is allowed once the worker actually ships

  // Only the affirmative forms. A sentence saying the app does NOT work offline
  // is the sentence these tests want to see survive, so match the claim shape,
  // not the word.
  const claims = [
    /works\s+(with\s+the\s+network\s+off|offline)/i,
    /works?\s+in\s+a\s+(basement|stairwell)/i,
    /(opens|answers)[^.\n]{0,40}\bwith\s+no\s+signal/i,
  ];
  const bad = [];
  for (const f of FILES) {
    read(f).split('\n').forEach((line, i) => {
      // Writing about the claim is the point of half these files, and every
      // such line either quotes it or negates it. Drop the quoted spans first,
      // then skip anything carrying a negation, so only a bare assertion trips.
      const bare = line.replace(/"[^"]*"|`[^`]*`/g, ' ');
      if (/(not|never|no)/i.test(bare)) return;
      if (claims.some((re) => re.test(bare))) bad.push(`${f}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(bad, [], `offline claim with no sw.js:\n${bad.join('\n')}`);
});

// ---------------------------------------------------------------- cadence

test('the harvest cadence is not described as a live cron while no workflow exists', () => {
  if (has('.github/workflows')) return;

  // DATA.md is read by Ohio State staff asking how much load arrives on what
  // schedule. Quoting the planned cron is fine. Stating a timer runs is not.
  const data = read('docs/DATA.md');
  assert.match(
    data,
    /no scheduled workflow in this\s+repository/i,
    'DATA.md must say there is no scheduled workflow while .github/ does not exist',
  );

  const opening = data.slice(0, data.indexOf('## What is fetched'));
  assert.ok(
    /run by hand|started by hand/i.test(opening),
    'the by-hand cadence has to appear before the fetch tables, not 200 lines later',
  );
  assert.doesNotMatch(
    opening,
    /----+>\s*GitHub Actions/,
    'the opening diagram must not draw a GitHub Actions box that does not exist',
  );
});

// ---------------------------------------------------------------- location

test('privacy.html describes the real no-location behaviour', () => {
  const app = read('js/app.js');
  const privacy = read('privacy.html');

  // What the code actually does with a denied fix. If this stops being the
  // Oval fallback, the privacy page has to be rewritten with it.
  assert.match(app, /err\.code === 1\s*\n\s*\? 'Location is off'/, 'app.js denied-fix branch moved');
  assert.match(app, /finish\(oval, null, true, `\$\{why\}, showing from the Oval`\)/);

  assert.match(privacy, /Location is off, showing\s+from the Oval/i);
  assert.doesNotMatch(
    privacy,
    /asks you to pick a building/i,
    'there is no building picker in the app',
  );
  // The claim that hurt: it told a student who denied location they would not be
  // shown walk times, and the app shows them, measured from the Oval.
  assert.doesNotMatch(privacy, /costs you the walk time/i);
  assert.match(
    privacy,
    /measured from the Oval, not from you/i,
    'the page has to say whose walk the minutes are',
  );
});

// ---------------------------------------------------------------- overclaims

test('no shipped prose promises the app hides unknown-hours rooms', () => {
  // The engine drops published-CLOSED buildings and KEEPS unknown-hours ones,
  // tiered below and labelled. Any sentence promising otherwise is a promise
  // the app breaks on every Saturday and every 3am.
  const bad = [];
  for (const f of FILES) {
    read(f).split('\n').forEach((line, i) => {
      if (/will not call any of those free/i.test(line)) bad.push(`${f}:${i + 1}`);
    });
  }
  assert.deepEqual(bad, [], `promise the engine does not keep at ${bad.join(', ')}`);
});
