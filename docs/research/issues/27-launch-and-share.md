---
title: Write the launch plan and the words that go with it
labels: documentation, ux
milestone: Phase 3: App
estimate: S
order: 27
depends_on: ground-truth-walk, docs-trust-and-privacy
---

Every other issue builds the thing. None of them gets a single person to the URL. There is no shareable description, no link preview, no post written for anywhere students read, no launch date, and nothing counting whether anyone came. The last one is not vanity: the README's phase 4 gate is "only if it gets real use", so with no counter that gate gets decided on a feeling.

### What to do

Add the preview tags to `index.html`. `og:image` has to be an absolute URL, and the Pages path is case sensitive, so `/vacant/` is a hard 404.

```html
<meta property="og:title"       content="Vacant">
<meta property="og:description" content="The nearest empty classroom at Ohio State, with the walk there already subtracted.">
<meta property="og:image"       content="https://enesyilmazcode.github.io/Vacant/og.png">
<meta property="og:url"         content="https://enesyilmazcode.github.io/Vacant/">
<meta name="twitter:card"       content="summary_large_image">
```

Commit `og.png` at 1200x630. What it should show is a result row, not a logo:

```
+------------------------------------------------------+
|  Vacant                                              |
|                                                      |
|  Dreese 357     4 min walk    free till 1:55p        |
|  Baker 120      6 min walk    free till 2:20p        |
|                                                      |
|  No class is scheduled here. The door may still      |
|  be locked. Dreese closes at 7:30pm.                 |
+------------------------------------------------------+
```

Write `docs/LAUNCH.md` holding the r/OSU post and a two-line GroupMe version. Lead both with what Vacant does not know (locked doors, club bookings, the 384 timed meetings with no room recorded), then what it does. The comparison goes last and states only what `docs/research/prior-art.md` measured:

- Roomix's vacancy search expands only to buildings within 200 m of one seed building (`if(d.b>200)break` over `/v2/graph_sorted_rounded.json`)
- `walk` returns 0 hits in its 4,069,039 byte `main.dart.js`
- 3.3 MB across 11 static JSON endpoints on first launch, against Vacant's low tens of kilobytes
- Nobody at OSU reads the Registrar's building hours page, so 41 of 47 pool buildings read free on a Saturday when they are locked

Record two decisions in `docs/DECISIONS.md`: whether Roomix's author hears about the comparison before it posts, and whether Roomix is credited in the README. Then pick the date. Autumn 2026 instruction runs Aug 25 to Dec 9, so a Tuesday, Wednesday or Thursday, and never Sep 7, Oct 15, Oct 16, Nov 11, Nov 25, Nov 26, Nov 27 or Dec 11 to 17.

Last, the counter: either port Finder's `analytics/src/index.js` beacon for page counts only, storing `visitorHash(salt|day|ip|ua)` with no IP column, or write down that you are not shipping it.

### Done when

- [ ] `og.png` exists at 1200x630 and the link preview renders with an image, a title and a description when pasted into iMessage and into a Reddit comment box
- [ ] Every URL in the meta tags is absolute and starts with `https://enesyilmazcode.github.io/Vacant/` with a capital V
- [ ] `docs/LAUNCH.md` holds a post under 250 words for r/OSU and one under 40 words for a GroupMe
- [ ] The limitations appear before the comparison in both, and the word "unofficial" appears in the r/OSU post
- [ ] Every competitive claim in the post traces to a line in `docs/research/prior-art.md` with a number attached. No claim that Roomix lacks GPS or ignores time
- [ ] `docs/DECISIONS.md` records a yes or no on the heads-up to Roomix's author and a yes or no on crediting Roomix in the README, each with one sentence of reasoning
- [ ] A launch date is written down, is a Tuesday, Wednesday or Thursday, and is not one of the 7 no-class weekdays or inside Dec 11 to 17
- [ ] `Walk to twenty rooms the app calls free and record what was actually true` is complete and its result is reflected in the post's limitations
- [ ] A yes or no on the usage counter is recorded. If yes, `/privacy` says what is stored before the beacon ships

### Notes

Roomix has been live since November 2023 across web, iOS and Android with accounts, bookmarks, calendar export, a KD-tree nearest-building search and a precomputed inter-building distance graph. Vacant wins on one axis. Say so, because overclaiming against a maintained three year old product invites a correction in the thread, and the README's framing was wrong about Roomix until the research fixed it.

Reddit and iMessage both cache link previews. Test the preview before posting, because a corrected `og.png` will not refresh one somebody already generated.

This category dies of author departure, not lack of demand; the highest-starred dedicated project in it was archived after about two years. Do not promise maintenance in the post.

If the counter ships it is for page counts only. Finder's `(ts, day, path, country, ref, visitor)` schema joined across timestamped room rows would reconstruct where a person walked, which is what `Design the was-it-open report schema and its privacy model before any backend exists` exists to avoid.
