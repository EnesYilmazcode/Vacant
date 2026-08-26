---
title: Ship manifest.webmanifest and the iOS icon set on absolute /Vacant/ paths
labels: pwa, good first issue
milestone: Phase 3: App
estimate: S
order: 21
depends_on: repo-scaffold-pages-licence
---

Vacant has no manifest, no icons and no PWA layer, and Finder has nothing to port (`find . -iname "*manifest*"` and `find . -iname "*sw*.js"` both return nothing there). This is a small piece of new work with one live trap in it: GitHub Pages paths are case-sensitive. Measured, `/Finder/` returns 200 while `/finder/` and `/FINDER/` both return 404. A lowercase `start_url` reviews fine on a desktop and only breaks after install, as an icon that opens a 404 with no service worker and no way for the user to understand why.

### What to do

Write `manifest.webmanifest` at the repo root. Use that extension: Pages serves it as `application/manifest+json`, so no MIME workaround is needed.

```json
{
  "id": "/Vacant/",
  "name": "Vacant",
  "short_name": "Vacant",
  "start_url": "/Vacant/",
  "scope": "/Vacant/",
  "display": "standalone",
  "orientation": "any",
  "theme_color": "#1a1a1a",
  "background_color": "#1a1a1a",
  "icons": [
    { "src": "/Vacant/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/Vacant/icons/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/Vacant/icons/icon-192-maskable.png", "sizes": "192x192", "type": "image/png", "purpose": "maskable" },
    { "src": "/Vacant/icons/icon-512-maskable.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

`orientation: "any"` is honest, since iOS ignores it and writing `"portrait"` would be a lie Android obeys. The maskable entries are Android only.

Head tags in `index.html`:

```html
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#1a1a1a">
<link rel="manifest" href="/Vacant/manifest.webmanifest">
<link rel="apple-touch-icon" href="/Vacant/apple-touch-icon.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Vacant">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
```

`/Vacant/apple-touch-icon.png` is 180x180, opaque, square, full-bleed, unrounded and unpadded. iOS applies its own mask, composites alpha onto black, and does not implement maskable, so a pre-rounded or padded icon looks wrong next to native apps. Finder's is already a correct 180x180 at 495 bytes, so the convention is right; copy the pipeline, not the art.

`viewport-fit=cover` plus `black-translucent` means the top row hides under the clock unless the CSS uses `env(safe-area-inset-top)` and `env(safe-area-inset-bottom)`.

`tests/manifest.test.js` runs under `node --test` with no dependencies:

```js
const m = JSON.parse(fs.readFileSync('manifest.webmanifest', 'utf8'));
assert.equal(m.start_url, '/Vacant/');
assert.equal(m.scope, '/Vacant/');
for (const i of m.icons) assert.ok(i.src.startsWith('/Vacant/'), i.src);
// plus every href/src in index.html that is not http(s): or data:
```

### Done when

- [ ] `manifest.webmanifest` exists at the repo root with `start_url` and `scope` both exactly `/Vacant/`, including the trailing slash, and `display: "standalone"`
- [ ] `apple-touch-icon.png` is 180x180, has no alpha channel, and is square with no rounded corners and no padding, verified by reading the PNG header and checking the color type
- [ ] `icons/` holds icon-192, icon-512, icon-192-maskable and icon-512-maskable, and every `src` in the manifest starts with `/Vacant/`
- [ ] `index.html` head carries all seven tags listed above
- [ ] CSS applies `env(safe-area-inset-top)` and `env(safe-area-inset-bottom)` to the top and bottom rows, and the layout is checked in landscape on a real device
- [ ] `tests/manifest.test.js` passes under `node --test` with zero dependencies, and fails when `start_url` is changed to `/vacant/`
- [ ] The same test asserts every relative asset path in `index.html` starts with `/Vacant/`
- [ ] No `apple-touch-startup-image` tags anywhere, with a comment in `index.html` recording why
- [ ] `curl -sSI https://enesyilmazcode.github.io/Vacant/manifest.webmanifest` returns 200 with `Content-Type: application/manifest+json`

### Notes

If the custom-domain decision in `Scaffold the repo, turn on Pages at /Vacant/, and land the MIT licence` came out yes, every path here becomes root-relative and the test inverts to assert `/`. Resolve that branch before starting, not during.

Splash screens are deliberately out. iOS ignores manifest `background_color` entirely, so the only way to control the splash is roughly 15 `apple-touch-startup-image` PNGs covering every current iPhone resolution and orientation, and that set breaks whenever Apple ships a new screen size. Without them iOS generates a splash from the icon. If the app paints from cache in under 200 ms nobody sees it long enough to judge it.

iOS honors `name`, `short_name`, `start_url`, `scope`, `display` (11.3), `theme_color` (15.0) and `icons` (15.4), and ignores `orientation`, `background_color`, `dir`, `lang`, `related_applications`, `prefer_related_applications` and `shortcuts`. Where manifest icons and `apple-touch-icon` both exist, the link tag wins on iOS, so ship both and make them the same artwork.

Since Safari 26 there are zero installability requirements and every home-screen add opens as a web app by default. That does not make the manifest optional: without it iOS uses the page title as the name and the current URL as the start URL, so the app would launch into whatever screen the user happened to be on.

Keep `apple-mobile-web-app-capable`. It is called deprecated everywhere and it costs a Lighthouse warning, but it is still what old iOS needs for standalone mode at all, and a campus has a long tail of hand-me-down iPhones.
