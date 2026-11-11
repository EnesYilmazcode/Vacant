# Deploying Vacant

GitHub Pages serves Vacant from the root of `main` at
<https://enesyilmazcode.github.io/Vacant/>. Push to `main` to publish.
`.nojekyll` tells Pages to serve the static files directly. The browser loads
the HTML, JavaScript modules and data files from that same origin.

Use the capital **V** in `/Vacant/` and the full filename for static pages such
as [privacy.html](../privacy.html). In the app, the privacy page is linked from
**What Vacant knows**.

## Before publishing

- Run `npm test` from the repository root with Node.js 22 or newer.
- For shell changes, run `npm run stamp` from the commit containing the shell
  change. Include the updated `sw.js` when publishing.
- For a term rollover, follow the prepare and flip steps in the
  [operations guide](../.github/OPS.md). Every file named by `data/current.json`
  should be present before the pointer is published.

## Cache behavior

The service worker caches the app shell and term data separately. After the
first successful online load and cache warm-up, room search can use the saved
schedule offline. Room photos are fetched on demand and cached when available.
Online, the app can pick up refreshed term data without a shell release.

## Troubleshooting

1. Check **Settings → Pages** and the Pages deployment run. The source should
   be `main` at `/ (root)`, with HTTPS enforced.
2. Check that `/Vacant/data/current.json` and the files it names load from the
   deployed site. Compare its `generated` date to the repository copy.
3. If the repository copy is stale, check the **Room index** workflow and
   the open `ops` issues. A failed refresh leaves the previous data in place.
4. If the deployed files are current but one browser shows an older app, try
   a private window to isolate its service worker and cache.

## Roll back

Revert the faulty commit and push the revert to `main`.

```sh
git revert <sha>
git push origin main
```

For a data rollback, keep `data/current.json` and its term assets consistent.
See the [data guide](DATA.md) for refresh cadence and how to stop the harvest.
