// The spike pages are not allowed to import from js/, so a broken app cannot
// break the instrument measuring it. engine.vendor.js is therefore a byte copy
// of js/engine.js, and a copy that nobody checks is a second definition of
// "free" waiting to happen. This is the check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const at = (p) => fileURLToPath(new URL(p, import.meta.url));

test('spikes/engine.vendor.js is byte-identical to js/engine.js', () => {
  const real = readFileSync(at('../../js/engine.js'));
  const vendored = readFileSync(at('../engine.vendor.js'));
  assert.equal(
    vendored.equals(real),
    true,
    'spikes/engine.vendor.js has drifted. Re-copy js/engine.js over it, then re-read walk.html: the rooms it calls free came from this file.',
  );
});
