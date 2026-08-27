# Deploying Vacant

There is nothing to deploy. That is the design, and this page exists so nobody
adds one.

Vacant is already live at <https://enesyilmazcode.github.io/Vacant/>, served by
GitHub Pages from the repository root of `main`. Pushing to `main` publishes.
There is no hosting account, no Firebase project, no Vercel project, no build
step, no bundler and no framework. If you are reading this because you are about
to create one of those, read `DECISIONS.md` under
`2026-08-27  GitHub Pages is the deployment target and no backend is to be added`
first.

## How it publishes

```
   git push origin main
          |
          |  Pages picks it up, usually under a minute
          v
   https://enesyilmazcode.github.io/Vacant/
```

Pages serves the repository root. `.nojekyll` is committed, so Pages skips the
Jekyll build and copies files through untouched. That is why there is no build
log to read and no build to break: the thing on disk is the thing on the web.

Two consequences worth knowing before you are surprised by them.

**The capital V is load bearing.** `enesyilmazcode.github.io/Vacant/` is case
sensitive. `/vacant/` is a hard 404. Survivable in a link, fatal in a
`start_url`, because it fails only after somebody has installed the app to their
home screen, on a device where they cannot see the address bar to work out why.
Every absolute path in the repository uses the capital V and a test greps for
`/vacant/`.

**Extensionless URLs do not work.** With `.nojekyll` there is no Jekyll to map
`/privacy` onto `privacy.html`. The privacy page's real URL is
`https://enesyilmazcode.github.io/Vacant/privacy.html` and every link to it has
to say `privacy.html`. Verified locally against the Pages-mirroring server:
`/Vacant/privacy.html` is 200 and `/Vacant/privacy` is 404.

## Rolling back

The deploy is a git commit, so the rollback is a git revert. From a laptop:

```sh
git revert <sha>          # do NOT use reset --hard, main is the published site
git push origin main
```

From a phone, in GitHub's web editor, open the file and undo the edit by hand,
or open the commit and use "Revert" on the pull request that carried it.

Reverting a data commit takes the app back to the previous week's index, which is
a real and safe state: `data/current.json` carries the build date, so the app can
say how stale it is instead of pretending to be fresh. A week-old room grid is
wrong at the edges. A missing one is wrong everywhere.

## If the site breaks, check these in order

1. **Is Pages green?** Repository, Settings, Pages. It should say the site is
   live and serving `main` from `/ (root)`, with HTTPS enforced. A red build here
   is almost always a Jekyll build that should not be running, which means
   `.nojekyll` got deleted.
2. **Does the data still fetch?**
   `curl -sI https://enesyilmazcode.github.io/Vacant/data/current.json`. A 404
   here with a 200 on `/Vacant/` means a data commit went wrong, not a deploy.
3. **Is it the case trap?** A 404 on everything, from one person's link, is
   usually `/vacant/` with a small v.
4. **Is it a stale service worker?** Once `sw.js` ships, a phone that installed
   the app can be serving an old cached index while the live site is fine.
   Hard-reload on desktop, or delete and re-add the home screen icon on iOS. Test
   in a private window before believing the site is down.
5. **Is it the harvester rather than the site?** A build that failed leaves last
   week's files in place and the site keeps serving. Check the Actions tab, not
   the site.

## Why there is no backend

The app opens and answers with no signal, in a stairwell or a basement. That is
the one thing Vacant does that nothing else in this category does, and it is only
possible because every byte it needs is a static file a service worker can hold.

Measured, on the shipped files:

```
first launch, gzipped        104,830 bytes   102.4 KB
first launch, uncompressed   481,460 bytes   470.2 KB
Roomix's first launch          ~3.3 MB       measured endpoint by endpoint
```

One backend call on the critical path costs a cold start, a DNS lookup, a TLS
handshake and a dependency that can be down, in exchange for nothing the app
needs. The room grid does not change while a student is walking to a room.

The only moving part is a cron that rewrites a JSON file: a GitHub Actions
workflow on a Sunday schedule that reruns the harvest and commits the result.
Free on a public repository, no account anywhere, and if it fails the app keeps
serving last week's data instead of going down. See `DATA.md` for its cadence and
its off switch.

## The one case that would ever need a backend

The crowdsourced was-it-open reports. That is the only feature in the plan that
cannot be a static file, and it is gated on a usage counter showing real use. Its
design is settled on paper in `design/reports.md`, and even that design keeps the
read path static: writes go to a worker, an hourly job rebuilds a small JSON
file, and the app reads the file. An outage degrades to yesterday's confidence
instead of a spinner.

If that ever gets built, that is the moment to pick a host. Not before.
