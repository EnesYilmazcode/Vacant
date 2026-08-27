// Offline. Runs the real .github/alert.sh against a stand-in gh, so every
// branch is exercised without touching GitHub. The stand-in can hold a freshly
// created issue back from the list for a few calls, which is the behaviour that
// let two alerts file duplicates against the real API.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ALERT = fileURLToPath(new URL('../../.github/alert.sh', import.meta.url));

// bash on Windows does not resolve a Windows-form path out of PATH, so the stub
// directory and the state directory are both handed over in POSIX form.
const posix = (p) =>
  process.platform === 'win32'
    ? `/${p.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_, d) => d.toLowerCase())}`
    : p;

const STUB = `#!/usr/bin/env bash
set -uo pipefail
d="$STUB_DIR"
echo "$1 $2 \${3:-}" >> "$d/log"
body=""
prev=""
for a in "$@"; do
  if [ "$prev" = "--body" ]; then body="$a"; fi
  prev="$a"
done
case "\${2:-}" in
  list)
    n=$(( $(cat "$d/lists" 2>/dev/null || echo 0) + 1 ))
    echo "$n" > "$d/lists"
    lag=$(cat "$d/lag" 2>/dev/null || echo 0)
    if [ -s "$d/pending" ] && [ "$n" -gt "$lag" ]; then
      cat "$d/pending" >> "$d/visible"
      : > "$d/pending"
    fi
    sort -n "$d/visible"
    ;;
  create)
    num=$(cat "$d/next")
    echo $(( num + 1 )) > "$d/next"
    printf '%s' "$body" > "$d/created-body"
    lag=$(cat "$d/lag" 2>/dev/null || echo 0)
    if [ "$lag" -gt 0 ]; then echo "$num" >> "$d/pending"; else echo "$num" >> "$d/visible"; fi
    echo "https://github.com/x/y/issues/$num"
    ;;
  comment)
    printf '%s' "$body" > "$d/last-comment"
    ;;
  close)
    grep -v "^\${3}$" "$d/visible" > "$d/visible.tmp" || true
    mv "$d/visible.tmp" "$d/visible"
    ;;
  view)
    cat "$d/last"
    ;;
esac
exit 0
`;

function stub({ visible = [], pending = [], lag = 0, next = 100, last = null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'vacant-alert-'));
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'gh'), STUB);
  chmodSync(join(bin, 'gh'), 0o755);
  writeFileSync(join(dir, 'visible'), visible.map((n) => `${n}\n`).join(''));
  writeFileSync(join(dir, 'pending'), pending.map((n) => `${n}\n`).join(''));
  writeFileSync(join(dir, 'lag'), String(lag));
  writeFileSync(join(dir, 'next'), String(next));
  writeFileSync(join(dir, 'log'), '');
  writeFileSync(join(dir, 'last'), last ?? new Date().toISOString());
  return dir;
}

function alert(dir, args, env = {}) {
  const r = spawnSync(
    'bash',
    [
      '-c',
      'PATH="$1:$PATH"; export PATH; shift; exec bash "$@"',
      'alert-test',
      posix(join(dir, 'bin')),
      ALERT,
      ...args,
    ],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        STUB_DIR: posix(dir),
        GITHUB_REPOSITORY: 'EnesYilmazcode/Vacant',
        GITHUB_RUN_ID: '9999',
        // No waiting between polls. The wait is real, only its length is a knob.
        ALERT_POLL_SECONDS: '0',
        ...env,
      },
    },
  );
  const read = (f) => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), 'utf8') : '');
  const lines = (f) => read(f).trim().split('\n').filter(Boolean);
  return {
    status: r.status,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
    log: lines('log'),
    open: lines('visible'),
    createdBody: read('created-body'),
    lastComment: read('last-comment'),
  };
}

const kind = (r, verb) => r.log.filter((l) => l.startsWith(`issue ${verb}`));

test('nothing open files exactly one issue, carrying the marker', () => {
  const dir = stub();
  const r = alert(dir, ['Room index build failed']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(kind(r, 'create').length, 1);
  assert.equal(kind(r, 'comment').length, 0);
  assert.match(r.createdBody, /<!-- vacant-ops:room-index-build-failed -->/);
  assert.deepEqual(r.open, ['100']);
});

test('an open issue with the same marker gets a comment, not a second issue', () => {
  const dir = stub({ visible: [63] });
  const r = alert(dir, ['Room index build failed']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(kind(r, 'create').length, 0);
  assert.deepEqual(kind(r, 'comment'), ['issue comment 63']);
  assert.deepEqual(r.open, ['63']);
});

test('a twin filed inside the list lag is closed once the list catches up', () => {
  // The real failure. Two runs read an empty list, both file, and the second
  // only learns about the first when the list catches up seconds later.
  // Measured against the real API on 2026-08-27: three alerts fired 2 and 4
  // seconds apart produced three issues.
  const dir = stub({ pending: [63], lag: 2, next: 64 });
  const r = alert(dir, ['Room index build failed']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(kind(r, 'create').length, 1);
  assert.deepEqual(r.open, ['63'], 'the lower number is the one that survives');
  assert.deepEqual(kind(r, 'close'), ['issue close 64']);
  assert.match(r.lastComment, /Duplicate of #63/);
});

test('a duplicate that only shows up later is collapsed by the next alert', () => {
  const dir = stub({ visible: [63, 64] });
  const r = alert(dir, ['Room index build failed']);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.open, ['63']);
  assert.deepEqual(kind(r, 'close'), ['issue close 64']);
  // And the survivor still gets the alert, so the streak is visible on #63.
  assert.match(r.lastComment, /<!-- vacant-ops:room-index-build-failed -->/);
});

test('a list that never catches up leaves the new issue alone', () => {
  // Six polls, nothing appears. Closing something we cannot see would be worse
  // than letting the next run tidy up.
  const dir = stub({ pending: [63], lag: 99, next: 64 });
  const r = alert(dir, ['Room index build failed']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(kind(r, 'close').length, 0);
  assert.equal(kind(r, 'comment').length, 0);
});

test('the quiet window suppresses a repeat comment', () => {
  const dir = stub({ visible: [63], last: new Date(Date.now() - 3600 * 1000).toISOString() });
  const r = alert(dir, ['Searchable term list changed', '144']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(kind(r, 'comment').length, 0);
  assert.match(r.stdout, /inside the 144h quiet window/);
});

test('a quiet window that has expired comments again', () => {
  const dir = stub({ visible: [63], last: new Date(Date.now() - 200 * 3600 * 1000).toISOString() });
  const r = alert(dir, ['Searchable term list changed', '144']);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(kind(r, 'comment'), ['issue comment 63']);
});

test('a missing title or repository is a usage error, not a wrong issue', () => {
  const dir = stub();
  assert.equal(alert(dir, []).status, 2);
  assert.equal(alert(dir, ['Room index build failed'], { GITHUB_REPOSITORY: '' }).status, 2);
});

test('outside a workflow run the body says the run link is not available', () => {
  const dir = stub();
  const r = alert(dir, ['Room index build failed'], { GITHUB_RUN_ID: '' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.createdBody, /Run: not available/);
});
