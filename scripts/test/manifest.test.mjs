// The manifest, the icons and the head. Every assertion here exists because the
// thing it checks is invisible until after install and unfixable afterwards:
// iOS gives no way to change an installed app's start URL, so a lowercase
// /vacant/ ships an icon that opens a 404 forever.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { iconSet } from '../make-icons.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p));
const text = (p) => read(p).toString('utf8');

const SCOPE = '/Vacant/';
const manifest = JSON.parse(text('manifest.webmanifest'));
const html = text('index.html');
// Comments carry prose that names the tags they explain, so a substring search
// over the raw file finds tags that are not there.
const markup = html.replace(/<!--[^]*?-->/g, '');

// GitHub Pages paths are case sensitive: /Vacant/ answers 200 and /vacant/
// answers 404. Both fields, not just start_url, because a scope outside the
// start URL silently disables standalone mode.
function pathProblems(m) {
  const bad = [];
  if (m.start_url !== SCOPE) bad.push(`start_url ${m.start_url}`);
  if (m.scope !== SCOPE) bad.push(`scope ${m.scope}`);
  for (const i of m.icons ?? []) if (!i.src.startsWith(SCOPE)) bad.push(`icon ${i.src}`);
  return bad;
}

function png(bytes) {
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'PNG signature');
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    depth: bytes[24],
    colorType: bytes[25],
  };
}

test('start_url and scope are exactly /Vacant/, trailing slash and capital V', () => {
  assert.deepEqual(pathProblems(manifest), []);
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.id, SCOPE);
});

test('the same check rejects a lowercased start_url', () => {
  const mutant = { ...manifest, start_url: '/vacant/' };
  assert.deepEqual(pathProblems(mutant), ['start_url /vacant/']);
});

test('every manifest icon is on disk at the size it claims', () => {
  assert.ok(manifest.icons.length >= 4);
  for (const icon of manifest.icons) {
    const bytes = read(icon.src.slice(SCOPE.length));
    const head = png(bytes);
    assert.equal(`${head.width}x${head.height}`, icon.sizes, icon.src);
    assert.equal(icon.type, 'image/png');
  }
  const maskable = manifest.icons.filter((i) => i.purpose === 'maskable');
  assert.equal(maskable.length, 2, 'a 192 and a 512 maskable');
});

test('apple-touch-icon is 180x180 with no alpha channel', () => {
  const head = png(read('apple-touch-icon.png'));
  assert.equal(head.width, 180);
  assert.equal(head.height, 180);
  // Colour type 2 is truecolour without alpha. iOS composites any alpha onto
  // black and masks the square itself, so a channel here is downloaded and
  // thrown away.
  assert.equal(head.colorType, 2);
  assert.equal(head.depth, 8);
});

test('favicon.ico is a real ICO with 16, 32 and 48 pixel entries', () => {
  const ico = read('favicon.ico');
  assert.equal(ico.readUInt16LE(0), 0, 'reserved');
  assert.equal(ico.readUInt16LE(2), 1, 'type 1 is icon');
  const count = ico.readUInt16LE(4);
  const sizes = [];
  for (let i = 0; i < count; i++) sizes.push(ico[6 + 16 * i] || 256);
  assert.deepEqual(sizes, [16, 32, 48]);
});

test('the committed icons still match the generator', () => {
  for (const [rel, bytes] of Object.entries(iconSet())) {
    assert.ok(read(rel).equals(bytes), `${rel} drifted from scripts/make-icons.mjs`);
  }
});

test('every asset path in index.html is absolute under /Vacant/', () => {
  const refs = [...markup.matchAll(/\b(?:href|src)\s*=\s*"([^"]+)"/g)].map((m) => m[1]);
  assert.ok(refs.length > 4, 'found some references to check');
  for (const ref of refs) {
    if (/^(?:https?:|data:|mailto:|#)/.test(ref)) continue;
    assert.ok(ref.startsWith(SCOPE), `${ref} is not under ${SCOPE}`);
  }
});

test('the head carries the seven install tags', () => {
  for (const tag of [
    'name="viewport"',
    'name="theme-color"',
    'rel="manifest" href="/Vacant/manifest.webmanifest"',
    'rel="apple-touch-icon" href="/Vacant/apple-touch-icon.png"',
    'name="apple-mobile-web-app-capable" content="yes"',
    'name="apple-mobile-web-app-title" content="Vacant"',
    'name="apple-mobile-web-app-status-bar-style" content="black-translucent"',
  ]) {
    assert.ok(html.includes(tag), `missing ${tag}`);
  }
  assert.match(html, /viewport-fit=cover/);
});

test('no apple-touch-startup-image tags, and the reason is written down', () => {
  assert.equal(/apple-touch-startup-image/.test(markup), false);
  assert.match(html, /<!--[^]*apple-touch-startup-image[^]*-->/);
});

test('theme_color matches the page background the app actually paints', () => {
  // A manifest colour that disagrees with the meta tag shows up as a flash of
  // the wrong shade behind the standalone status bar on launch.
  assert.equal(manifest.theme_color, '#0b0d10');
  assert.equal(manifest.background_color, '#0b0d10');
  assert.ok(html.includes('<meta name="theme-color" content="#0b0d10">'));
});
