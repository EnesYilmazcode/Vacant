# The Google key, and the restriction that makes it safe to ship

`js/directions.js` asks Google for the written steps of a walk. That needs a key,
and this app has no backend to hide one behind: it is static files on GitHub
Pages, so anything the page uses is in a bundle any reader can open. A key here
is public by construction.

That is survivable, but only for one kind of key. This page is the difference
between a key anyone can read and a key anyone can **bill**.

## Why the JavaScript API and not the REST endpoints

Google exposes walking directions two ways.

| | Restrictable by HTTP referrer | Safe in a static bundle |
|---|---|---|
| Routes / Directions REST endpoints | No | No |
| Maps JavaScript API services | Yes | Yes, once restricted |

A referrer restriction tells Google to refuse the key unless the request comes
from a page on your own domain. The REST endpoints are server-to-server and
cannot check a referrer, so a key scraped from this repository would work from
anywhere, against your card. The JavaScript API services run inside the page and
can, which is why `js/directions.js` uses `DirectionsService` and
`DistanceMatrixService` rather than `fetch` against `routes.googleapis.com`.

If you ever move Vacant behind a backend, the REST endpoints become the better
choice and this constraint disappears.

## Setup

These steps are yours to do; they need an account and a card, and nothing in this
repository can or should do them for you.

1. **Create a project.** In the Google Cloud console, make a new project rather
   than reusing one that has anything else in it. Billing is per key and per
   project, and you want this one's spend to be legible.

2. **Enable two APIs: Maps JavaScript API and Directions API.**

   The second is not obvious and the first version of this page got it wrong.
   `DirectionsService` is part of the JavaScript library, so it looks as though
   Maps JavaScript API alone should cover it. It does not: those requests are
   metered and billed as **Directions API**, and without it enabled every call
   comes back denied. The proof is the quota page. Maps JavaScript API has nine
   quotas and every one is about map loads or a grounding widget, because that is
   what the library itself meters. There is no directions quota on it at all.

   Do not enable the Routes REST API. Nothing here calls it, and an enabled API
   is an API a leaked key can spend against. Wiring `matrix()` up would also need
   **Distance Matrix API**, on the same reasoning.

3. **Create an API key**, then restrict it before it is used anywhere:
   - **Application restriction:** HTTP referrers. Add your Pages origin, for
     example `https://enesyilmazcode.github.io/Vacant/*`. Add
     `http://localhost:*/*` only while developing, and take it off afterwards.
   - **API restriction:** Maps JavaScript API and Directions API. Nothing else.

   An unrestricted key is the failure mode this whole page exists to prevent. Do
   not paste one in "just to test it" -- a key is scraped within hours of being
   public, and restriction after the fact does not refund anything.

4. **Cap the spend, on the right API.** Under Quotas, pick **Directions API**
   and edit the row named "Requests per day". It ships as *Unlimited*.

   Capping Maps JavaScript API instead does nothing, which is worth naming twice:
   its only per-day quota is "Map loads per day", and this app draws its campus
   map itself out of `data/campus.json` and never loads a Google map. That number
   reads zero forever while directions requests run uncapped.

5. **Set a budget as well.** In Cloud Billing, create a budget with alerts at
   50%, 90% and 100%. A budget and a quota are not the same thing and you want
   both: the alert emails you after the money is gone, the quota stops the
   requests. Google's own documentation is explicit that budget alerts do not cap
   spending.

   A budget scoped to the billing account covers the same ground as one scoped to
   the project while `vacant` is the only project on it. Scope it to the project
   explicitly the day you add a second.

6. **Put the key in `index.html`, and commit it.**

   ```html
   <meta name="google-maps-key" content="">
   ```

   The first draft of this page said to fill that in "at deploy" and to question
   any pull request that committed it. That advice cannot be followed here and is
   withdrawn. There is no deploy step to fill anything in at: Pages serves this
   repository, so the file a reader's browser downloads is the file in `main`. An
   uncommitted key works on nobody's phone.

   So the key is committed and it is public, and that is the arrangement rather
   than an accident. Google's own documentation treats a browser key as public
   information; the referrer restriction in step 3 is the whole of its security,
   which is why that step comes before this one and why removing it would be the
   one change here that actually costs money.

   An empty value builds no provider, which renders no **Step by step** button at
   all -- the app exactly as it behaved before this feature existed. That is the
   correct state for a fork, and the reason the failure of a missing key is a
   missing button rather than a broken screen.

## What the reader is told

The first tap on **Step by step** does not send anything. It explains that the
request carries where they are standing and waits for them to agree. `privacy.html`
says the same thing in the same words. If you change what is sent, change both.

## What it costs

One Directions request per tap, for one building the reader has already chosen.
Swiping past a card costs nothing, which is deliberate: steps fetched on sight
would be 425 rooms over 50 buildings, and a bill for answers nobody read.

`js/directions.js` also ships a `matrix()` for ranking by Google's own walking
durations. Nothing calls it. `docs/research/walking-routes-115.md` is why: measured
against OSU's routing service, Google was not closer than the bundled sidewalk
graph, and the graph is free, offline, and sends nothing. If you ever do call it,
it is capped at 25 destinations and returns all-or-nothing, because a half-filled
matrix would sort one list on two different models.

## Checking it works

There is nothing to run. `scripts/test/directions.test.mjs` covers the module
against a fake Google and needs no key, which is the point: every failure path
returns `null`, and `null` means the screen keeps the walk it measured over OSU's
sidewalks. A missing or broken key is not a broken app.
