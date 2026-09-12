# Google Routes and walking-rank accuracy

Research for [#115](https://github.com/EnesYilmazcode/Vacant/issues/115), checked
2026-09-11. Prices are global USD prices and can change. This is engineering
research, not legal advice.

## Decision in one paragraph

Google's Routes API can return a walking duration from one origin to every
candidate building, and the request fits comfortably inside its technical limits.
It is not a drop-in fix for Vacant. Walking routes are beta, Google requires a
warning that paths may be missing, a live request sends the student's location to
Google, and Google's current service terms prohibit Routes API content being used
"in conjunction with a non-Google map." Vacant is built around its own campus map.
Do not ship Google-derived ranks in the current UI until that map/terms conflict is
removed or Google gives written clarification. Google is still worth evaluating as
one measurement input, without user locations, before choosing the implementation
for #115.

## The proposed call

Use **Compute Route Matrix**, not one Compute Routes call per room:

- one latitude/longitude origin;
- one destination per distinct candidate building;
- `travelMode: WALK`;
- only `originIndex`, `destinationIndex`, `duration`, `distanceMeters`, `status`,
  and `condition` in the field mask;
- no traffic, alternatives, polylines, steps, Places lookup, or geocoding.

The current Autumn index has 425 rooms in 46 buildings. Routing rooms separately
would pay repeatedly for identical building destinations. Reproduce those counts:

```sh
node -e "const r=require('./data/rooms-1268.json'); const rooms=Object.values(r.rooms); console.log(rooms.length, new Set(rooms.map(x => x.b)).size)"
```

One origin by 46 destinations is 46 billable matrix elements. Google permits up to
625 non-transit elements in one request and 3,000 elements per minute. The complete
campus request therefore fits, although the rate limit allows only about 65 such
searches per minute before throttling. A ten-building request allows about 300.

Google requires a response field mask. Asking only for the fields above reduces
latency and avoids accidentally selecting a more expensive feature later. In
particular, do not use `*` in production.

## Cost

As of 2026-09-10, **Compute Route Matrix Essentials** includes 10,000 elements per
month. Progressive prices per 1,000 elements are $5 from 10,001 through 100,000,
$4 from 100,001 through 500,000, $3 from 500,001 through 1,000,000, $1.50 from
1,000,001 through 5,000,000, and $0.38 after that.

The table assumes one routed ranking per search and applies each progressive tier,
including the first 10,000 free elements:

| routed searches/month | 5 buildings | 10 buildings | all 46 buildings |
| ---: | ---: | ---: | ---: |
| 1,000 | $0 | $0 | $180 |
| 5,000 | $75 | $200 | $970 |
| 10,000 | $200 | $450 | $1,890 |
| 50,000 | $1,050 | $2,050 | $5,500 |

The formula is `searches * routed buildings`. Every automatic reroute is another
set of elements: three origin updates per search roughly triples usage. Failed
authentication is not billed, but successful responses and server errors count
against quota.

Rendering a Google map would be a separate SKU. Dynamic Maps also has a 10,000-load
monthly free cap, followed by $7 per 1,000 through 100,000 loads. A route-only
estimate must not quietly assume the map replacement is free.

Budgets only send alerts; they do not stop spending. A launch must also set a hard
daily API quota. For example, a 10,000-element monthly ceiling is roughly 330
elements per day: 33 ten-building searches or seven full-campus searches. That is
appropriate for a private experiment, not for a public launch.

## What Google would and would not fix

It should improve the fixed 1.3 detour assumption where the pedestrian graph knows
about crossings, connected paths, and barriers. It also gives one duration that can
be used consistently by both ranking and the room's “yours for” calculation.

It does not establish ground truth:

- `WALK` is beta. Google says pedestrian paths can be missing and requires a
  user-visible warning for every walking route displayed.
- A building centroid is still not necessarily its usable entrance. Google cannot
  infer which classroom door a student can enter.
- Locked doors, construction, indoor passages, and campus-only shortcuts may be
  absent or stale.
- Routing only the current straight-line top five can miss the exact rank inversion
  #115 is about. The evaluation must route all 46 buildings first; a production
  candidate cap can be chosen from measured results afterward.

The claim #115 needs is therefore “measured route estimates reduce rank inversions
by X under these samples,” not “Google is accurate.”

## Product and legal fit

### Map use is the blocking issue

The current Google Maps Platform Service Specific Terms say that Routes API content
may be used without a map, but may not be used in conjunction with a non-Google map.
Vacant displays its own campus polygons, position dot, direction line, and selected
building directly behind the ranked list. Adding Google durations to that screen is
not a safe reading of the terms.

Before production, choose one:

1. replace the relevant Vacant map with a Google map and account for the additional
   map-load cost and online dependency;
2. put Google-derived results on a genuinely mapless screen with the required
   Google attribution and walking warning;
3. obtain written confirmation from Google that the proposed UI is permitted; or
4. use routing data whose licence permits Vacant's existing map and reproducible
   fixtures.

The fourth option is the best fit unless the benchmark shows a material advantage
that justifies changing the product.

Google also restricts caching and bulk extraction. Do not commit raw route-matrix
responses or build a permanent table of Google durations. A committed reproducible
benchmark, as requested by #115, should use a source with suitable redistribution
terms, or publish only a methodology and aggregates after the use is confirmed to
be permitted.

### Privacy changes

Vacant currently keeps precise position work on the device. A live route call sends
the origin coordinates to Google. Production use therefore needs:

- an explicit opt-in before the first request, separate from browser geolocation
  permission;
- updated `privacy.html` and About-screen wording naming Google and the purpose;
- no request during boot, offline use, browsing from a picked public building, or
  before the student asks for an answer;
- no coordinates in logs, analytics, URLs, issue reports, or persistent caches;
- a clear local-estimate fallback when consent is declined.

Do not silently round and transmit the current position. Rounding can damage short
campus routes and does not remove the need to disclose the transfer.

## Client and key architecture

Vacant has no server. The least disruptive technical spike is the Maps JavaScript
API Routes library and its `RouteMatrix` class, loaded only after opt-in. A browser
key is visible by design, so it must have both:

- a website restriction for `https://enesyilmazcode.github.io/*`; and
- an API restriction limited to the Maps JavaScript API/required Routes service.

Use a separate Google Cloud project and key for the experiment. Set a low quota
before publishing the key. Evaluate Firebase App Check only if the experiment moves
to production; a domain restriction is not a spending cap.

A REST proxy hides a web-service key but is a larger architectural change. A safe
public proxy needs authentication, input validation that permits only campus-sized
matrices, rate limiting, timeouts, abuse controls, monitoring, and its own hosting.
It would remove Vacant's “no server” property without resolving the map licence or
privacy questions. It is not the first spike.

## Runtime contract if production is approved

Routing must be an enhancement to a completed local answer, never a boot dependency:

1. rank locally with the existing estimator;
2. deduplicate candidate rooms by building;
3. start one route matrix request with an answer-generation token and timeout;
4. discard the response if the origin, date, duration, or generation changed;
5. convert durations with one documented rounding rule, then rerank rooms and
   recompute “yours for” from the same value;
6. retain local results on timeout, quota, offline, partial-element error, no route,
   API load failure, or revoked consent;
7. never retry in a tight loop or route on every geolocation watch update.

The UI must distinguish “route estimate” from the current straight-line estimate
and expose the required Google attribution and pedestrian-route warning. A late
response must not reorder an answer the student has already accepted.

## Next-steps plan

### Phase 0 — decision gates

- [ ] Ask Google Maps Platform support for a written answer on route-derived list
      ranking displayed over Vacant's custom map.
- [ ] Decide whether sending precise position to Google is acceptable for Vacant.
- [ ] Choose a maximum experimental spend. Create a separate project, billing
      budget alerts, and a hard route-matrix quota.
- [ ] Do not start production integration if either the map or privacy decision is
      “no.” Continue #115 with an open pedestrian graph instead.

### Phase 1 — fixed-origin evaluation, no user data

- [ ] Select at least 20 public campus origins covering crossings, barriers, large
      buildings, and similar-distance candidate pairs.
- [ ] For each origin, route all 46 building destinations in walking mode. This is
      at most 920 elements and is inside the 10,000-element free allowance.
- [ ] Compare Google duration with Vacant's estimate; record absolute error,
      over/under-estimation, and building-order inversions.
- [ ] Complete several stopwatch walks and record entrance error separately from
      route-model error.
- [ ] Do not commit raw Google responses. Confirm what aggregate findings may be
      published, and use a redistributable source for the reproducible fixture.

Exit criterion: a written result says how often routing changes the top building
and whether the change agrees with walked evidence.

### Phase 2 — provider decision

- [ ] Compare Google with an appropriately licensed offline/open pedestrian graph
      using the same origins and destinations.
- [ ] Choose among recalibrating the existing estimator, entrance-aware points,
      precomputed open routes, offline routing, or an online provider.
- [ ] Document download size, latency, licence, attribution, update method, privacy,
      expected monthly cost, and offline behaviour as #115 requires.

Exit criterion: merge a decision record. No production code before this point.

### Phase 3 — bounded production spike, only if Google wins

- [ ] Add a provider-neutral `routeTimes(origin, buildings, signal)` boundary.
- [ ] Add the local estimator as the always-available provider and Google as a
      lazy, consented provider.
- [ ] Start with ten distinct candidate buildings per explicit search. Measure how
      often the all-46 evaluation says that cap would miss a top result.
- [ ] Add generation-token, timeout, partial-result, offline, and quota tests.
- [ ] Update privacy, attribution, warning, and accessibility copy.
- [ ] Verify that both ranking and “yours for” consume the same routed duration.

Exit criterion: the app remains fully usable offline and after every simulated
provider failure, and no stale response can reorder a newer answer.

### Phase 4 — controlled launch

- [ ] Ship behind an off-by-default flag to maintainers first.
- [ ] Watch matrix elements per completed search, latency, fallback rate, and rank
      changes without recording precise origins.
- [ ] Raise quota only from observed demand; keep a kill switch that restores the
      local provider without a deploy.
- [ ] Revisit the provider if the cost per useful rank correction is not justified.

## Primary sources

- [Google Maps Platform pricing](https://developers.google.com/maps/billing-and-pricing/pricing)
- [Routes API usage, billing, and limits](https://developers.google.com/maps/documentation/routes/usage-and-billing)
- [Compute Route Matrix](https://developers.google.com/maps/documentation/routes/compute_route_matrix)
- [Maps JavaScript Route Matrix](https://developers.google.com/maps/documentation/javascript/routes/get-a-route-matrix)
- [Choose response fields](https://developers.google.com/maps/documentation/routes/choose_fields)
- [Walking mode and required warning](https://developers.google.com/maps/documentation/routes/reference/rest/v2/RouteTravelMode)
- [Routes attribution and policy](https://developers.google.com/maps/documentation/routes/policies)
- [Google Maps Platform Service Specific Terms](https://cloud.google.com/maps-platform/terms/maps-service-terms)
- [API-key security guidance](https://developers.google.com/maps/api-security-best-practices)
- [Cost controls and the difference between budgets and quotas](https://developers.google.com/maps/billing-and-pricing/manage-costs)

