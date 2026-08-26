---
title: Scaffold the repo, turn on Pages at /Vacant/, and land the MIT licence
labels: ops, documentation
milestone: Phase 0: Setup
estimate: M
order: 1
depends_on: 
---

The repo is a README, a docs folder and one draft JSON file. There is nowhere for code to land, nothing that turns red when it breaks, no URL to open on a phone, and no licence on a repo that is about to receive whole files copied from Finder.

### What to do

Copy four files unchanged from `C:/Users/galax/Downloads/Projects/Finder/`: `package.json` (private, `"type": "module"`, one `"test": "node --test"` script, no dependencies block), `.github/workflows/test.yml` (push and pull_request, checkout@v4, setup-node@v4 node 22, concurrency with `cancel-in-progress`, one bare `node --test` step, no install step), `.gitignore`, and `LICENSE`. Keep the MIT line as `Copyright (c) 2026 Enes Yilmaz`, same owner.

Commit `scripts/`, `tests/`, `js/`, `css/`, `data/` with a real file or `.gitkeep`, plus one genuine assertion so an empty suite cannot pass. Networked tests skip unless `VACANT_LIVE=1`, matching Finder's `FINDER_LIVE=1`.

Create labels `data`, `geo`, `pwa`, `ux`, `ops`, `spike`, `accessibility` and milestones `Phase 0: Setup` through `Phase 4: Reports` plus `Backlog`. Enable Pages as source branch `main`, folder root, not the Actions deployment. Add `.nojekyll` and a placeholder `index.html`.

Start `docs/DECISIONS.md` with a fixed entry shape, seeded with the settled calls and an `## Open` section below:

```
## 2026-08-26 - Pages stays branch-source, not Actions
A GITHUB_TOKEN push does not trigger on:push workflows, but branch-source Pages
deploys on those same pushes: 7 'pages build and deployment' runs against 0 Tests
runs for the same three bot pushes on Finder.
Note: docs/research/ops-freshness.md section 7.1
```

### Done when

- [ ] `package.json` has no dependencies or devDependencies block; `node --test` passes locally
- [ ] `test.yml` is green on a push with no install step in the log
- [ ] At least one real assertion in `tests/`; no networked test runs without `VACANT_LIVE=1`
- [ ] `LICENSE` is MIT, `Copyright (c) 2026 Enes Yilmaz`, and `README.md:328` no longer reads `TBD.`
- [ ] `gh label list` shows all seven; `ops` exists before any workflow using `gh issue create --label ops` merges
- [ ] `gh api repos/EnesYilmazcode/Vacant/milestones --jq '.[].title'` returns all six
- [ ] `gh api repos/EnesYilmazcode/Vacant/pages --jq .build_type` returns `legacy`
- [ ] `curl -o /dev/null -w '%{http_code}' https://enesyilmazcode.github.io/Vacant/` returns 200, and `.nojekyll` is at the root
- [ ] `docs/DECISIONS.md` answers the custom-domain question: a registered domain, or an explicit no with the reason
- [ ] `grep -rn '/vacant/' .` returns nothing; every path uses a capital V
- [ ] `docs/DECISIONS.md` records the Pages `Cache-Control: max-age=600` (with ETag and Last-Modified), the shared `enesyilmazcode.github.io` origin, and the `vacant.` localStorage key prefix

### Notes

Pages paths are case-sensitive, measured: `/Finder/` returns 200, `/finder/` and `/FINDER/` both 404. A lowercase `start_url` later ships an installed icon that opens nothing and passes every desktop review.

Settle the domain now even though nothing depends on it. Adding one after the first install changes the origin, orphaning every installed icon, cache, service worker registration and geolocation grant, and iOS cannot update an installed app's URL. An explicit no is a fine answer.

Leave `main` unprotected. A required-PR or required-check rule rejects the weekly build's own push, because `GITHUB_TOKEN` is not exempt unless it is on the bypass list, and that reads like an auth bug rather than a settings change.
