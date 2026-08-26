# Legal, policy and privacy ground for Vacant

Researched 2026-08-26. Every number below has the command that produced it.

**The problem in one sentence:** Ohio State publishes no terms, no robots.txt and
no rate limit for the class API, so there is nothing to violate and nothing to
point at either, which means the only real exposure is a discretionary "please
stop" under the Responsible Use policy plus one concrete data leak the blueprint
does not currently guard against.

**The fix in one sentence:** ship a self-identifying polite harvester at roughly
3 requests per second, strip instructor names and osu.edu emails from the emitted
JSON with a refusal guard, put a visible non-affiliation line on the results
screen, split the OSM-derived building file out under ODbL while the code stays
MIT, and never monetize it.

```
  what exists                     what it means for Vacant
  -------------------------------------------------------------------
  no robots.txt (404)             nothing crawled is disallowed
  no API terms, no key            nothing agreed to, nothing breached
  CORS: *                         published at the whole internet on purpose
  OSU's own site calls it         same load pattern as a normal visitor
  Responsible Use policy          the actual lever: "unreasonable" use
  instructors[].email in payload  the one real thing to get right
```

---

## 1. What Ohio State actually publishes

### There is no robots.txt on the API host

```
$ curl -s -o - -w "HTTP %{http_code}\n" https://content.osu.edu/robots.txt
HTTP 404
<h1>Not Found</h1>
<p>The requested URL /robots.txt was not found on this server.</p>
```

404, not an empty file, not a disallow. The main site allows everything except a
single PDF:

```
$ curl -s https://www.osu.edu/robots.txt
User-agent: *
Disallow: /assets/pdf/Investigation-Report.pdf
```

No `Crawl-delay`, no sitemap directive, no bot-specific rules.
`https://classes.osu.edu/robots.txt` returns HTTP 403 with an S3 `AccessDenied`
body, which is an absent file on a static bucket rather than a policy.

### The API identifies itself and is deliberately open

```
$ curl -s https://content.osu.edu/v2/
{"ok":true,"server":"OSU Mobile API v2"}
```

Full response headers on a real search call:

```
$ curl -s -D - -o /dev/null \
  "https://content.osu.edu/v2/classes/search?q=&subject=cse&term=1268&campus=col&p=1&sort=catalogNumber"

HTTP/1.1 200 OK
Server: Apache/2.4.6 (Red Hat Enterprise Linux) OpenSSL/1.0.2k-fips mod_fcgid/2.3.9
X-Target-Hash: ebe8ad8dd97dab734a4555ec35357155
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, OPTIONS, HEAD
Access-Control-Allow-Headers: Origin, X-Requested-With, Content-Type, Accept
X-Served-By: 21f93a381b6c
Content-Type: application/json; charset=utf-8
Content-Length: 498158
Set-Cookie: NSC_NC-dpoufouw2-TTM-WT=...;Max-Age=1800;path=/;secure;httponly
```

Four things worth reading off that:

- `Access-Control-Allow-Origin: *` is a deliberate configuration choice. Someone
  at OSU turned that on so that any web page anywhere can read this endpoint from
  a browser. That is the closest thing to a grant of permission that exists here.
- No `X-RateLimit-*`, no `Retry-After`, no quota headers of any kind.
- No `ETag`, no `Last-Modified`, no `Cache-Control`. Conditional GETs are not
  available, so the only way to be lighter is to send fewer requests, more slowly.
  `X-Target-Hash` looked like a content hash but is not: it is stable across two
  identical requests and differs per URL, so it fingerprints the request target,
  not the body. Useless as a change detector.
- The `NSC_` cookie is a Citrix NetScaler persistence cookie, so there is a load
  balancer with an application firewall in front. That explains the comment in
  Finder's `scripts/fetch-courses.mjs` line 106 that "a 403 is often a WAF being
  twitchy". A burst can get you a 403 rather than a 429.

### OSU's own public class search calls the same endpoint from the browser

This is the strongest single fact in this whole note.

```
$ curl -s https://classes.osu.edu/osu-mobile.js -o osu-mobile.js   # 389,460 bytes
$ grep -o -E ".{120}content\.osu\.edu/v2.{80}" osu-mobile.js
").factory("api",["$rootScope","$http","$window",function(e,i,t){
var o="classes.osu.edu"===t.location.hostname
  ? "https://content.osu.edu/v2"
  : "https://contenttest.osu.edu/v2",
```

`classes.osu.edu` is OSU's own unauthenticated public class search. Its Angular
`api` factory hardcodes `https://content.osu.edu/v2` and calls it from the
visitor's browser with no key. Vacant reading the same endpoint is not reaching
into a back office. It is doing what OSU's own front door does.

### There is no published API policy at all

Searched for an Ohio State developer portal, API terms of use, or acceptable use
statement for `content.osu.edu`. There is none. Note that most search results for
"OSU developer portal" are Oregon State, which does have a real one at
[developer.oregonstate.edu](https://developer.oregonstate.edu/). Ohio State does
not. Say this plainly to anyone who asks: **nothing is published, so nothing was
agreed to.**

The nearest public documentation is
[xanarin/OSU-API-Documentation](https://github.com/xanarin/OSU-API-Documentation),
a third party who reverse engineered the official Ohio State iOS app through an
HTTPS proxy and published endpoint docs for buses, dining, garages and class
search. It states "I am not associated with the developers of the OSU App, and am
not working with the backend services team to provide this API to the public."
That repo is still up. No takedown.

### The four OSU policies that could matter, and which ones apply

| Policy | Applies to | Applies to Vacant? |
| --- | --- | --- |
| [University Websites](https://go.osu.edu/websites-policy), issued 06/29/2008, revised 06/01/2025 | "Staff, faculty, and student employees" and only sites on the `osu.edu`, `ohio-state.edu`, `osumc.edu` domains | **No.** Vacant is on `github.io` and Enes is a student, not a student employee acting for a unit. |
| [Institutional Data](https://go.osu.edu/idp), issued 05/02/2007, revised 07/01/2021, edited 07/28/2026 | "Faculty, staff, **students**, ..." | **Yes, and it helps.** Four levels; the top one is "Public (S1): Institutional data intended for public use that has no access or management restrictions." An unauthenticated, CORS-open endpoint that OSU's own public site reads is S1 by any reading. |
| [Responsible Use of University Computing and Network Resources](https://go.osu.edu/responsible-use), issued 05/10/2000, revised 02/01/2013, edited 01/30/2025 | "Faculty, staff, **students**, agents, ..." | **Yes. This is the one that matters.** |
| [Trademark and Licensing](https://trademarklicensing.osu.edu/page/student-request) | Registered student organizations | **Not directly.** See section 5. |

The two clauses in Responsible Use to actually read, quoted:

> **I.B** "Use only those computing resources they are authorized to use and use
> them only in the manner and to the extent authorized. **Ability to access
> computing resources does not, by itself, imply authorization to do so.** Users
> are responsible for ascertaining what authorizations are necessary and for
> obtaining them before proceeding."

> **I.D** "Respect the finite capacity of the computing resources and limit use so
> as not to consume an unreasonable amount of those resources or to interfere
> unreasonably with the activity of other users. Although there are no set
> bandwidths, disk space, CPU time, or other limitations applicable to all uses of
> university computing resources, the university may require users of those
> computing resources to limit or refrain from specific uses in accordance with
> this principle, using only those resources authorized for use. **The
> reasonableness of any particular use will be judged by the university in the
> context of the relevant circumstances.**"

I.B is the sharpest sentence against this project and it should be understood
honestly rather than argued away. The counterweight is not clever reading, it is
that OSU published this endpoint with `Access-Control-Allow-Origin: *` and calls
it from its own public site, which is an affirmative act of publication to the
public, and the data is S1 Public under OSU's own classification.

I.D is not a ban. It is a discretionary standard where OSU decides what is
reasonable after the fact. That is exactly why the harvester should be visibly
polite and visibly reachable: the outcome under I.D depends on how the request
pattern looks when someone finally goes and reads a log.

### The clause nobody expects: no money, ever

From the same policy's responsibilities table:

> "6. Refrain from using university resources for personal commercial purposes or
> for personal financial or other gain."

That is the most concrete constraint in this entire note. **No ads, no donations
tied to the app, no paid tier, no sponsorships, no affiliate links, no selling
the room dataset.** The moment Vacant makes money off data pulled from OSU's
servers, a discretionary "please throttle" turns into a policy violation with a
named clause.

This lines up with GitHub's own terms, which is convenient. GitHub Pages has a
soft bandwidth limit of 100 GB per month, a 1 GB published site size limit, a soft
limit of 10 builds per hour, and prohibits using Pages "as a free web-hosting
service to run your online business" or for sites "primarily directed at either
facilitating commercial transactions." A free static room finder is squarely
inside both sets of rules. Keep it that way.

### Finder is real precedent, with a caveat

[Finder](https://github.com/EnesYilmazcode/Finder) has been in production against
this same API, same owner, and nothing has happened. Its own `docs/osu-api.md`
closes with a "Courtesy" section:

> "This API is public but undocumented, and it is a university's, not a vendor's.
> Finder issues one request per user search from the user's own browser, which is
> the same load pattern as using OSU's own site. Bulk pulls should stay
> rate-limited and infrequent."

The caveat: Finder's **runtime** load is one request per user search from the
user's own browser, which is genuinely indistinguishable from normal use. Its
**build** load is the nightly bulk pull, which is not. Vacant's runtime load is
zero, because the whole schedule is a static file, and its build load is a weekly
bulk pull. So Vacant is strictly lighter than Finder on the runtime axis and
strictly lighter on cadence (weekly, not nightly). If Finder is fine, Vacant is
fine. That framing is worth having ready.

---

## 2. The polite-client contract for the harvester

### What Finder already does, verbatim

From `C:/Users/galax/Downloads/Projects/Finder/scripts/fetch-courses.mjs`:

```js
const CONCURRENCY = 5;
const DELAY_MS = 120;
const RETRIES = 3;
// 408 and 425 ask for the request again and a 429 clears on its own. The rest
// of 4xx will not fix itself. A 5xx or a timeout might.
const RETRY_STATUS = new Set([408, 425, 429]);
// Retry-After can name an hour, longer than the run will spend on one request.
const MAX_RETRY_AFTER_MS = 30000;
const USER_AGENT =
  'Finder-courses/1.0 (+https://github.com/EnesYilmazcode/Finder) weekly course index';
```

It honors `Retry-After` correctly, handling both the seconds form and the HTTP
date form, and falls back to exponential backoff when the header is absent or
already in the past:

```js
function retryAfterMs(header) {
  if (!header) return 0;
  const seconds = /^\s*\d+\s*$/.test(header) ? Number(header) : NaN;
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - Date.now();
  if (!(ms > 0)) return 0;
  return Math.min(ms, MAX_RETRY_AFTER_MS);
}
// ...
if (attempt > 0) await sleep(wait || 500 * 2 ** (attempt - 1));
```

This is already good. Three things to change for Vacant, and one thing not to
worry about.

### Change 1: slow down, because you can afford to

Measured round trip times, gzipped, three subjects, two seconds apart:

```
$ for s in math english history; do curl -s -H "Accept-Encoding: gzip" \
    -w "$s,%{http_code},%{size_download},%{time_total},%{time_starttransfer}\n" -o /dev/null \
    "https://content.osu.edu/v2/classes/search?q=&subject=$s&term=1268&campus=col&p=1&sort=catalogNumber"
    sleep 2; done

subject,http,bytes,total_s,ttfb_s
math,200,34523,0.195056,0.177681
english,200,44116,0.189412,0.175673
history,200,44081,0.209574,0.185122
```

The API answers in about 200 ms. That is the problem with inheriting Finder's
numbers unchanged. At `CONCURRENCY = 5` and `DELAY_MS = 120`, each worker cycles
every 0.32 s, so the run sustains **5 / 0.32 = about 15.6 requests per second**.
For a job that has no deadline and runs once a week, 15 requests per second is
hotter than it needs to be, and it is exactly the shape that looks bad in a log.

Recommended for Vacant:

```js
const CONCURRENCY = 2;
const DELAY_MS = 500;
```

That gives `2 / (0.20 + 0.50) = about 2.9 requests per second`. On an estimated
800 to 1000 request harvest, the run goes from roughly 1 minute to roughly 6
minutes. Nothing in the product notices. If anyone at OSU ever complains, drop to
`CONCURRENCY = 1, DELAY_MS = 1000` (about 0.8 req/s, roughly 20 minutes) and say
so in the reply.

### Change 2: put a contact in the user agent

Finder's user agent carries a repo URL but no way to reach a human without a
GitHub account. Recommended string:

```js
const USER_AGENT =
  'Vacant-rooms/1.0 (+https://github.com/EnesYilmazcode/Vacant; vacant.osu@gmail.com) ' +
  'weekly OSU classroom occupancy index, ~1000 req/week, contact to throttle';
```

Use a purpose-made alias rather than his personal address, since this string ends
up in server logs that other people read. The phrase "contact to throttle" is
doing real work: it tells whoever reads the log that there is a cooperative human
on the other end, which is the difference between a block and an email.

### Change 3: instrument and cap the request count

Nothing currently counts requests. Add a module-level counter incremented inside
`fetchWith`, print it at the end of the run, and abort hard past a ceiling, in the
same style as `scripts/guards.mjs`:

```js
const MAX_REQUESTS = 3000;   // a full 1268 harvest should land near 1000
let requests = 0;
// inside fetchWith, before each fetch():
if (++requests > MAX_REQUESTS) {
  throw Object.assign(
    new Error(`request ceiling: ${requests} requests, the ceiling is ${MAX_REQUESTS}`),
    { fatal: true },
  );
}
```

A retry loop that goes wrong against a university is the failure mode that
actually generates a phone call. The ceiling makes that impossible rather than
unlikely. Print the final count in the CI log so the number is auditable.

### Not a problem: compression is already on

Worth checking, since it is the single biggest bandwidth lever and it is easy to
assume it is missing.

```
$ curl -s -H "Accept-Encoding:"     -w "%{size_download}\n" -o /dev/null "<math p=1>"
524595
$ curl -s -H "Accept-Encoding: gzip" -w "%{size_download}\n" -o /dev/null "<math p=1>"
34523
```

15.2x smaller, a 93.4% reduction. And Node's built in `fetch` already asks for it:

```
$ node -e "const http=require('http');const s=http.createServer((q,r)=>{
    console.log('accept-encoding:',JSON.stringify(q.headers['accept-encoding']));r.end('{}');s.close();});
    s.listen(0,async()=>{await fetch('http://127.0.0.1:'+s.address().port+'/');});"
accept-encoding: "gzip, deflate"
```

So Finder's harvester is already getting compression for free and Vacant will too.
Do not add an explicit header, it is redundant. A full harvest at gzip sizes is
roughly 1000 requests times about 40 KB, or **about 40 MB per week**. State that
number to anyone who asks. It is nothing.

### Phase 2, Overpass

The [Overpass commons policy](https://dev.overpass-api.de/overpass-doc/en/preface/commons.html)
asks for "a maximum of about 10000 requests per day" and "download volume below
about 1 GB per day", returns 429 when rate limited and 504 when it cannot
allocate resources. Vacant's building pull is **one query, once, committed to the
repo forever**. It is one ten-thousandth of a single day's allowance. Do set the
`[timeout:90]` that the README already has, and do not re-run it on every build.

### The contract, condensed

| Rule | Value | Why |
| --- | --- | --- |
| User agent | names project, repo URL, contact email, purpose, weekly volume | a log reader can find a human |
| Concurrency | 2 | 2.9 req/s measured, not 15.6 |
| Delay between requests per worker | 500 ms | same |
| Retries | 3, exponential from 500 ms | inherited from Finder, correct |
| Retryable statuses | 408, 425, 429, all 5xx, timeouts; 403 once | inherited, and 403-once is right given the NetScaler WAF |
| Retry-After | honored, seconds and HTTP-date, capped at 30 s | inherited, correct |
| Per-request timeout | 60 s (raise from Finder's 30 s) | a slow university box is not a failure |
| Hard request ceiling | 3000, abort | prevents a runaway retry loop |
| Cadence | weekly, one term | the room schedule is static per term |
| Conditional GETs | impossible, no ETag or Last-Modified | do not waste time building it |
| Off-hours | schedule the cron for roughly 04:00 Eastern Sunday | avoids registration-window peaks |

---

## 3. The one real data problem: instructor names and emails

**This is the finding to act on.** It is not in the blueprint and a straight port
of Finder's pipeline walks into it.

Every `meetings[]` object in the API response carries an `instructors[]` array,
and each entry has a real osu.edu address:

```
$ python -X utf8 -c "... json.load(open('search.json')) ..."
meeting keys: ['buildingCode', 'buildingDescription', 'buildingDescriptionShort',
 'endDate', 'endTime', 'facilityCapacity', 'facilityDescription',
 'facilityDescriptionShort', 'facilityGroup', 'facilityId', 'facilityType',
 'friday', 'instructors', 'meetingNumber', 'monday', 'room',
 'standingMeetingPattern', 'startDate', 'startTime', 'sunday', 'thursday',
 'tuesday', 'wednesday']

instructors sample: [{"displayName": "Michelle Mallon", "role": "PI",
                      "email": "mallon.3@osu.edu"}]
```

Measured on **one page** of one subject:

```
page 1 of subject=cse term=1268
  courses            29
  meetings           209
  distinct names     64
  distinct emails    64
  raw osu.edu email occurrences in ONE page: 208
```

64 distinct instructors and 208 email occurrences from a single request. There are
243 subjects. A full harvest streams several thousand osu.edu addresses through
the build.

Now put that next to what Vacant is: an inversion of the schedule keyed by room,
with day and minute ranges, shipped as one static file, cached offline on a phone.
If instructor data survives the projection, `rooms-1268.json` becomes a public,
downloadable, offline-capable index of **which named professor, at which email
address, is standing in which room, on which weekday, between which two minutes,
for the whole term.** That is a stalking tool wearing a study-spot app's clothes,
and it would be the actual story if anyone wrote about this.

Vacant does not need any of it. The README's own schema already has no place for
it:

```json
"DL0357": { "b": "279", "n": "357", "cap": 46, "type": "1B",
            "busy": [[2, 480, 535, 0], [4, 480, 535, 0]] }
```

So make the omission deliberate and tested rather than incidental:

1. **Drop `instructors` at the parse boundary**, the moment a meeting object is
   read, before anything else touches it. Not at serialization time. If it never
   enters the in-memory model it cannot leak into a debug dump, a cache file, or
   an error message.
2. **Add a refusal guard** in the `scripts/guards.mjs` style that scans the
   serialized output before it is written and aborts, not warns, with no
   `FORCE_WRITE` escape:

   ```js
   export function piiRefusal(label, json) {
     const hits = json.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g);
     if (hits) return fatal(`${label}: ${hits.length} email addresses in the output, first is ${hits[0]}`);
     return null;
   }
   ```

   This is `fatal`, not `forceable`. There is no legitimate reason for an email
   address to be in a room occupancy file.
3. **Add a test** that feeds one real captured API page through the projection and
   asserts the output matches neither `/@/` nor any `displayName` from the input.
4. **Do not commit raw API responses** to the repo, not as fixtures, not in
   `.wrangler`, not in a `tmp/` that is not gitignored. If a test needs a fixture,
   redact `instructors` in the committed copy and note it at the top of the file.

Finder is clean on this and is good precedent. Verified:

```
$ for f in data/*.json; do echo "$f  $(grep -o -E '[A-Za-z0-9._+-]+@osu\.edu' "$f" | wc -l)"; done
data/courses.json  0
data/ratings.json  0
data/ratings-courses.json  0
data/seats-1262.json  0
data/seats-1264.json  0
data/seats-1268.json  0
```

Zero across every committed data file. Finder does capture the field in the
browser at `js/format.js:113` (`{ name, email: person.email ?? null, role }`) but
never renders it and never commits it. Vacant should not even capture it.

One related note: `facilityCapacity` and `enrollmentTotal` are fine, they are
counts. `combinedSection`, `consent`, `courseDescription` and the rest of the
section fields are all course metadata, not person data. `instructors[]` is the
only PII in the payload.

---

## 4. Privacy

### Phases 1 to 3: location genuinely never leaves the device, and the wording has to be precise

The architecture makes this easy. The room index is a static file served from
GitHub Pages and cached by a service worker. `navigator.geolocation` returns
coordinates to JavaScript in the page. The distance sort, the walk time
subtraction and the ranking are all integer math in the browser. There is no
request that carries a coordinate, because there is no server to send one to.

Two things stop this from being "we collect nothing", and the statement must not
overclaim on either:

1. **GitHub Pages sees an IP address.** Every fetch of the site, the manifest, the
   icons and `rooms-1268.json` reaches GitHub's edge, which logs request IPs like
   any host. Vacant never sees those logs and cannot correlate them with a
   location, but "we collect nothing" would be false. Say who the host is.
2. **If Finder's analytics beacon gets ported, say so.** Finder ships
   `js/hit.js`, which POSTs `{path, referrer}` to a Cloudflare Worker on page
   load. The worker (`analytics/src/index.js`) is well built for this: it stores
   `ts, day, path, country, ref, visitor` where `visitor` is
   `SHA-256(salt + day + ip + userAgent)` truncated to 8 bytes, with the day in
   the hash input so it rotates at midnight UTC. Its own README says "no IP
   address ever reaches storage" and the schema confirms there is no IP column.
   That design is fine to reuse **for page counts**. It is not fine as-is for room
   reports, see below.

**Recommended privacy statement.** Put this at `/privacy` as a real page, link it
from the app footer, and mirror it in the README. Plain English on purpose.

> ## Privacy
>
> **Where you are stays on your phone.**
>
> Vacant asks your browser for your location so it can sort rooms by how far away
> they are. That calculation happens on your phone, in the page, with the numbers
> your browser hands it. Your coordinates are never sent anywhere. There is no
> Vacant server to send them to.
>
> The whole class schedule is downloaded once as a single file and stored on your
> phone. After that the app works with the network off. When it does have signal
> it checks that file for updates about once a week, and that check does not
> include anything about you.
>
> **What we know anyway.** The site is hosted on GitHub Pages. Like any web host,
> GitHub sees the IP address your phone connects from when it downloads the page.
> We do not have access to those logs and cannot connect them to a location.
>
> **What we count.** [Include only if the analytics beacon ships:] We count page
> views so we know whether anyone is using this. Each view records the page, the
> country, and where you came from. Instead of storing your IP address we store a
> one-way hash of it that is scrambled with a secret and today's date, so you
> count as one person today and are a different, unlinkable number tomorrow. The
> code is in the repo.
>
> **What we never do.** No accounts. No login. No Ohio State credentials, ever.
> No advertising. No trackers from other companies. No selling anything to anyone.
> Nothing is shared with Ohio State.
>
> **Your location permission.** You can say no. The app still works, it just asks
> you to pick a building instead of sorting by distance. You can revoke the
> permission any time in your browser or phone settings and Vacant will forget it
> immediately, because it never stored it.
>
> Questions: [contact address]. Last updated [date].

Design notes that make the statement true rather than aspirational:

- Call `getCurrentPosition`, not `watchPosition`. A watch is a continuous stream
  and there is no reason to hold one open for a one-shot ranking.
- Do not persist the coordinate in `localStorage`, `IndexedDB` or the URL. Keep
  it in a variable that dies with the page.
- Never put a coordinate in a query string or a fragment, which is how location
  accidentally ends up in a `Referer` header or a shared link.
- No third party scripts at all. No CDN fonts, no map tiles, no analytics SDK.
  Every external request from the page is a chance to leak. Roomix, by comparison,
  pulls `code.getmdl.io` for Material Design Lite and runs Firebase App Check and
  a Cloudflare challenge script.
- The service worker must not cache anything derived from a position.

### Is any of this legally required?

Not really, which is the useful thing to know.

- **Ohio has no comprehensive consumer privacy law.** The Ohio Personal Privacy
  Act (HB 376, 134th GA) stalled in committee and was never enacted. A separate
  Ohio Privacy Act introduced 2026-03-27 targets state entities, not private
  developers. So there is no Ohio statute imposing a privacy policy obligation on
  a free student web app.
- **No FERPA exposure.** FERPA covers education records about students. A room
  schedule is not a student record and Vacant never touches one. Instructor
  names, if they were shipped, would be employee data rather than FERPA data, but
  see section 3 for why they should not ship anyway.
- **GDPR** is not engaged in phases 1 to 3, because nothing personal is
  transmitted or stored. Phase 4 changes that if an exchange student in the EU
  submits a report, though the practical exposure for an unmonetized campus tool
  is negligible. The mitigations in the next section handle it anyway.
- **COPPA** is not in scope for a university campus app.

So the privacy page is a **trust artifact, not a compliance artifact**. Write it
for a skeptical sophomore, not for a lawyer. That is also why it beats the
competition: Roomix's App Store listing points at
`https://fatih.bal.soy/privacy-policy?roomix`, and that URL currently returns
**HTTP 404** on a GitHub Pages SPA shell. A privacy page that loads and is
readable is a differentiator here, which is a low bar and worth clearing anyway.

### Phase 4: "was it open?" reports

The blueprint calls this "the only real moat this idea has". It is also the moment
the privacy story stops being trivially true. A report says: **someone was
standing at room DL 357 at 2:47 pm on Tuesday.** Enough of those, tied together,
is a movement trail.

The mistake to avoid is copying the analytics worker's row shape. That table is
`(ts, day, path, country, ref, visitor)` with `ts` at one-second precision and a
per-day `visitor` hash. For page views that is harmless. For rooms it is a
disaster: within a single day, one `visitor` hash joined across rows reconstructs
every room that person walked to, in order, with timestamps. Do not do that.

Design instead:

1. **No accounts, no login, no OSU SSO, ever.** The instant there is an identity
   there is a record about a student, and the whole calm posture in this document
   collapses.
2. **Store counters, not events.** The reports table should be
   `(room, weekday, bucket, open_count, closed_count)` updated in place. If there
   are no per-event rows there is no trail to leak, subpoena, or accidentally dump
   in a public stats endpoint.
3. **Round the time hard.** Bucket to the 30 minute class period, and store the
   weekday, not the date. "DL 357, Tuesday, 14:30 block" is useful for confidence
   scoring. "DL 357, 2026-09-15 14:47:12" is surveillance and is not more useful.
4. **Never send coordinates with a report.** The client already knows which room
   the user tapped. The server has no use for a lat/lon and should reject the
   field if it appears. If proximity verification is ever wanted, do it on the
   client and send a boolean.
5. **Keep abuse control in a separate table with no room column.** Rate limiting
   needs something per-person, so reuse Finder's rotating hash, but scope it
   tighter and keep it apart: `SHA-256(salt + hourBucket + ip + userAgent)` in a
   table of `(hash, count)` rows with a short TTL and no room, no timestamp beyond
   the bucket. Rotating hourly rather than daily shortens the linkable window from
   24 hours to 1. The reports table and the rate-limit table must never be
   joinable.
6. **Suppress until k.** Do not show or expose a room's confidence until it has
   reports from at least 3 distinct rate-limit hashes in that bucket. Below k,
   show the plain "no class is scheduled here, the door may still be locked" line.
   One report should never be visible to anyone, because one report is one person.
7. **Publish aggregates only, and only above k.** If there is ever a public stats
   page, mirror Finder's approach of shipping aggregates rather than rows, and
   apply the same k threshold.
8. **Write down retention and actually delete.** Counters roll up per term and the
   raw rate-limit table drops after 24 hours. Say so on the privacy page.
9. **Do not hand the data to OSU.** As long as it lives on his infrastructure it is
   his. Handed to the university it becomes a university record potentially
   subject to the Ohio Public Records Act, and the IDP's Public Records section
   confirms that university records can be disclosable. Keep the boundary clean.

Text to add to the privacy page when phase 4 ships:

> **When you report a room.** Tapping "it was open" or "it was locked" sends the
> room and the half-hour block, and nothing else. Not your location, not the exact
> time, not who you are. We add one to a counter and there is no record that a
> particular person reported anything. To stop one person spamming the same room
> we keep a scrambled, one-way number derived from your connection for one hour,
> in a separate list that has no room in it and is deleted afterward. A room's
> "usually open" label only appears once at least three different people have
> reported it, so a single report is never visible to anyone.

---

## 5. Naming, trademark, and the disclaimer

### What the rules actually say

OSU's [Trademark and Licensing Services](https://trademarklicensing.osu.edu/)
requires prior written permission for use of "The Ohio State University" or "Ohio
State". The published student rules address **registered student organizations**,
not individual students' personal projects, and the required RSO disclaimer is:

> "We [student organization name] are a registered student organization at The
> Ohio State University. Registration shall not be construed as Ohio State's
> approval, endorsement, or sponsorship of our registered student organization's
> publications, activities, purposes, actions or positions."

The prohibited use is "implying endorsement, approval or underwriting of any
organization, product, activity, service or contract by The Ohio State
University." Contacts are `brandcenter@osu.edu` and `TMlicensing@osu.edu`.

Vacant is not an RSO, so that specific form does not apply. What it is doing is
**nominative use**: naming Ohio State to say truthfully what the app is about.
The three things that keep nominative use safe are: use no more of the mark than
you need, take nothing from the visual identity, and do not suggest sponsorship.

### The name itself is already the right call

"Vacant" is a neutral English word with no OSU reference. That is the safest
possible name and it should stay. Concretely, do not rename to "OSU Vacant",
"BuckeyeRooms", "OhioStateRooms" or anything with "Buckeye" or "Brutus" in it, and
do not register a domain containing "osu" or "ohiostate". A neutral name plus a
descriptive subtitle is the whole trick.

### Do not take the visual identity

- No Block O, no university logo, no unit logo, no "O-H", no Brutus, no
  Ohio State wordmark, no athletics marks.
- Avoid the official scarlet as the primary brand color. OSU's scarlet is
  `#BA0C2F`. Worth noting that Roomix's shipped HTML contains exactly that value,
  commented out:
  ```html
  <!-- <meta name="theme-color" media="(prefers-color-scheme: light)" content="#BA0C2F" />
       <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#5f0b0a" /> -->
  ```
  Scarlet and gray alone is not infringement, but scarlet plus a Block-O-shaped
  mark plus "Ohio State" starts reading as trade dress. Pick a different accent
  and the question never comes up.
- Do not use OSU building photography or the campus map's styling.

### The disclaimer wording

**Short form.** Use this in the app itself, verbatim:

> Vacant is a student project. It is not affiliated with, authorized by, or
> endorsed by The Ohio State University.

**Long form.** Use this in the README, the About sheet, and any store listing:

> Vacant is an independent student project. It is not affiliated with, authorized
> by, maintained by, sponsored by, or endorsed by The Ohio State University or any
> of its offices. Class and room information comes from Ohio State's public class
> search service. Building locations come from OpenStreetMap contributors.
> "The Ohio State University", "Ohio State" and "Buckeyes" are trademarks of The
> Ohio State University and are used here only to describe what this app covers.

### Where it must appear

| Place | Which form | Why |
| --- | --- | --- |
| Bottom of the results screen, always rendered | short | Vacant is a one-screen app. A disclaimer behind a menu is a disclaimer nobody sees. It is one line of small type under the list. |
| About sheet or `/about` | long | the full statement including data sources |
| `README.md`, near the top, not buried at the end | long | this is where a curious OSU staffer lands first |
| `<meta name="description">` and `og:description` | short | it is what a shared link previews as |
| PWA manifest `description` field | short | it is what the install prompt and app listing show |
| `/privacy` page footer | short | the page an anxious reader opens |
| Any future app store listing, first two lines | short | Roomix does exactly this and it is correct |

### How the comparable handles it

Roomix, the incumbent, is a useful and slightly cautionary reference.

- Its shipped `index.html` (3,339 bytes, a Flutter web shell) contains **no
  visible disclaimer**. The only OSU reference in the served markup is
  `<meta name="description" content="Unofficial Room Matrix for Ohio State University.">`.
  Anything else is rendered inside the Flutter canvas and is not in the HTML.
- Its **iOS App Store listing does** carry one: "Please note that Roomix is an
  unofficial app and not affiliated with OSU." Developer is listed as Fatih
  Balsoy, app id 6473177665.
- Its privacy policy link from that listing is a 404.
- Its `robots.txt` is Cloudflare-managed with `Content-Signal: search=yes,
  ai-train=no, use=reference` and blocks GPTBot, ClaudeBot, CCBot, Google-Extended
  and others.

So Roomix has run for close to three years, has an App Store presence, uses the
same data, and its in-page disclaimer is a meta tag. The incumbent's bar is low.
Clearing it visibly is cheap and is worth doing on the merits rather than the
optics.

Finder has the same gap and it is worth fixing there too: `grep -rn -i
"not affiliated" index.html README.md js/ css/` finds the line in `README.md:260`
only. It is not in the shipped page.

---

## 6. Licensing

Code and data want different licenses here, and one of them is not optional.

### Code: MIT

Match Finder, which is already MIT with `Copyright (c) 2026 Enes Yilmaz`. Same
owner, same stack, and code moves between the two repos, so a single license
removes a question that would otherwise come up on every port. Put `LICENSE` at
the repo root. Replace the README's current `## License` / `TBD.`

### `data/buildings.json`: ODbL 1.0, and this one has teeth

The building coordinates come from an Overpass extraction of OpenStreetMap. Under
[OSM's attribution guidelines](https://osmfoundation.org/wiki/Licence/Attribution_Guidelines),
a substantial extraction into your own dataset is a **Derivative Database**, and a
Derivative Database that is publicly used must be made available under ODbL
terms. A hand-corrected table of roughly 130 campus buildings with names and
centroids, committed to a public repo and shipped to every user, is squarely a
Derivative Database. This is not a judgment call.

Requirements to satisfy:

1. **Attribution in the app**, credited to "OpenStreetMap", linked to
   `https://www.openstreetmap.org/copyright`, and making clear the data is under
   ODbL. The guidelines accept a credit "adjacent to the map or on a splash screen
   or pop-up shown when a user starts" the application. Vacant has no map, so the
   About sheet plus the persistent footer line is the right placement. Wording:

   > Building locations © OpenStreetMap contributors, available under the
   > [Open Database License](https://www.openstreetmap.org/copyright).

2. **Ship the license text**: `LICENSE-ODbL.txt` at the repo root, or in `data/`.

3. **A `data/README.md`** recording the source, the exact Overpass query, the date
   pulled, the bounding box, and the fact that about 130 rows were hand corrected.
   That last part matters: the corrections are improvements to an OSM-derived
   database, and documenting them is both the ODbL-honest thing and the thing that
   makes the file maintainable next August.

4. **Consider contributing the fixes back.** If the manual pass finds OSU buildings
   that OSM has wrong or missing, editing OSM is the cheapest possible goodwill and
   it means the next rebuild needs less hand fixing.

### `data/rooms-<term>.json`: no rights asserted

This is derived from OSU's schedule. In the United States facts are not
copyrightable (*Feist v. Rural Telephone*, 499 U.S. 340), and a room-by-time
occupancy table is about as pure a set of facts as exists. The selection and
arrangement are his, and that thin layer is not worth claiming. Do not put MIT on
it, MIT is a software license and does not fit a dataset.

Mark it CC0 or simply state:

> `rooms-<term>.json` is derived from Ohio State's public class schedule. It is
> published as facts, with no additional rights asserted. Ohio State is the source
> and is not affiliated with this project.

### The structural consequence: keep the two datasets in separate files

**This contradicts the README's current schema and should be changed.** The
blueprint puts building coordinates inside `rooms-<term>.json`:

```json
"buildings": {
  "279": { "name": "Dreese Laboratories", "short": "DL",
           "lat": 40.0023, "lon": -83.0155 }
}
```

That folds ODbL-covered OSM data into the same file as the no-rights-asserted OSU
facts, and the license of the combined file becomes an argument. Split them:

```
data/rooms-1268.json     rooms + busy windows + buildingCode.   OSU derived. no rights asserted.
data/buildings.json      buildingCode -> {name, short, lat, lon}. OSM derived. ODbL 1.0.
```

The app fetches both and joins them at runtime by `buildingCode`. Two extra
kilobytes of HTTP and the licensing question disappears. It is also better
engineering: `buildings.json` changes once a decade and `rooms-*.json` changes
every term, so they have no business sharing a cache lifetime or a service worker
revalidation rule.

Under ODbL, the running app that displays a distance computed from those
coordinates is a **Produced Work**, which requires attribution but does not
require the app's own code to be ODbL. So MIT code plus an ODbL data file plus a
credit line is a clean, standard arrangement. Many apps ship exactly this.

### Repo layout

```
LICENSE              MIT, the code
LICENSE-ODbL.txt     ODbL 1.0 full text, for data/buildings.json
data/README.md       per-file source, license, provenance, and the Overpass query
README.md            "## License" section pointing at all three in three lines
```

---

## 7. How this could produce a takedown email, and how to preempt it

Calmly: there is no published record of Ohio State taking down a student app over
API use. Searches for an OSU cease and desist over course data scraping return
nothing on point. The reverse-engineered OSU API documentation repo has been
public on GitHub for years. Finder is in production. Roomix has an App Store
listing. The base rate here is very low.

That said, here are the five plausible triggers, ranked by likelihood, each with
the preemption.

**1. The harvester looks like an attack in a log.** Most likely by a distance. A
retry loop goes wrong, or a CI job fires repeatedly on a bad config, and someone
in OTDI sees a few thousand requests an hour from one address with a generic user
agent. *Preempt:* the request ceiling in section 2, the 2.9 req/s pacing, the
self-identifying user agent with a contact address, weekly cadence, an off-peak
cron, and a printed request count in every CI log so a runaway is visible on the
next run rather than the next month.

**2. It gets popular and someone assumes it is official.** A thousand students
using something that names Ohio State rooms will eventually reach someone in
Marketing and Communications or Trademark and Licensing. *Preempt:* the visible
disclaimer on the results screen, the neutral name, no Block O, no scarlet as the
primary color, no `osu` in the domain. If contacted, the answer is short: it is a
student project, the disclaimer is on every screen, the data is public, happy to
adjust the wording.

**3. Someone notices instructor data.** If instructor names or emails ever reach
the shipped file, this stops being a policy conversation and becomes a story.
*Preempt:* section 3, and treat the PII guard as a release blocker rather than a
nice to have.

**4. A room is wrong and someone gets in trouble for being in it.** A student
walks into a booked room, or a lab, or a locked building after hours, and points
at the app. *Preempt:* the README's existing "No class is scheduled here. The door
may still be locked." line must ship on every result, not just be in the design
doc. Add "Vacant does not grant permission to enter any space. Follow building
access rules and posted signs." to the About sheet. Resolve the `facilityType`
codes before launch so wet labs and studios are excluded rather than merely
disclaimed, which the README already flags as a known unknown and which is a
safety item, not a polish item.

**5. Monetization.** Adding ads or a paid tier converts a discretionary "please
throttle" into a named violation of the Responsible Use clause quoted in section
1, and independently violates GitHub Pages' terms. *Preempt:* do not.

### The two-hour insurance policy

Three cheap things that change the tone of any conversation that does start:

- **A `/contact` route and an email in the footer.** People who cannot find a human
  escalate. People who can, email.
- **A one-page `docs/DATA.md`** stating: what is fetched, from where, how often, at
  what rate, how many requests per week, roughly 40 MB per week gzipped, what is
  deliberately discarded (instructor names and emails), and who to contact to have
  it throttled or stopped. Link it from the README. If an OSU staffer ever opens
  the repo, this is the page that ends the conversation in one read.
- **A kill switch you can reach from a phone.** One commit that empties the cron
  schedule and one that swaps the site for a static notice. Being able to say "it
  is already stopped, tell me what you would like changed" within an hour is worth
  more than any argument in this document.

### If an email does arrive

Do not argue and do not go quiet. Reply the same day, say the harvester is already
paused, restate the numbers (weekly, roughly 1000 requests, about 40 MB, roughly 3
requests per second, no instructor data retained, no money involved), and ask what
rate would be acceptable. Almost every one of these ends with a throttle number
and a thank you. The failure mode is a student who ignores the first email and
gets escalated to Student Conduct, which the Responsible Use policy explicitly
references as an applicable rule.

### Not risks

Worth naming so no cycles get spent on them:

- **Copyright in the schedule data.** Facts are not copyrightable.
- **A terms-of-service breach.** There are no terms. Nothing was clicked, no key
  was issued, no agreement exists. This is the important structural difference
  from the scraping disputes that make the news, which are almost always breach of
  a ToS that the scraper accepted.
- **CFAA exposure.** No authentication was bypassed, no credential was used, no
  technical access control was circumvented. A public unauthenticated endpoint
  with `Access-Control-Allow-Origin: *`, called by the operator's own public
  website, is not an unauthorized access.
- **FERPA.** No student records anywhere in the pipeline.
- **The University Websites policy.** Applies to `osu.edu` domains and student
  employees. Vacant is neither.

---

## 8. Blueprint corrections

Things in `README.md` that this research says should change.

| Where | What it says | What it should say |
| --- | --- | --- |
| `## License`, line 275 | "TBD." | MIT for code, ODbL 1.0 for `data/buildings.json`, no rights asserted on `rooms-<term>.json`. Section 6. |
| The room index schema, lines 153 to 166 | `buildings` with `lat`/`lon` nested inside `rooms-<term>.json` | Split into `data/buildings.json`. Mixing ODbL OSM coordinates with OSU-derived facts in one file muddies the license and couples two files with completely different change rates. |
| Build order phase 1, line 243 | "Port the fetch pipeline from Finder, swap the projection, add a refusal guard on room count" | Also: drop `instructors[]` at the parse boundary, add a `fatal` PII refusal guard on the serialized output, and lower `CONCURRENCY` to 2 with `DELAY_MS` 500. Finder's 5 and 120 sustain about 15.6 req/s against a university. |
| "What Vacant will not pretend to know", lines 214 to 228 | disclaims scheduling only | Also disclaim permission to enter. "No class is scheduled here. The door may still be locked." is right and should be joined by "Vacant does not grant permission to enter any space." |
| Nowhere | no privacy statement, no non-affiliation line, no attribution | All three are required surfaces. Sections 4 and 5 give the wording and the placement table. |
| `facilityType` known unknown, line 232 | framed as a polish item | It is a safety item. Sending someone into a wet lab or a studio is the thing that produces complaint number 4 above. Resolve the codes before launch. |

---

## 9. Everything measured, in one place

| Fact | Value | Command |
| --- | --- | --- |
| `content.osu.edu/robots.txt` | HTTP 404, no file | `curl -s -w "%{http_code}" https://content.osu.edu/robots.txt` |
| `www.osu.edu/robots.txt` | allows all but one PDF, no crawl-delay | `curl -s https://www.osu.edu/robots.txt` |
| `classes.osu.edu/robots.txt` | HTTP 403, S3 AccessDenied | `curl -s -w "%{http_code}" https://classes.osu.edu/robots.txt` |
| API self-description | `{"ok":true,"server":"OSU Mobile API v2"}` | `curl -s https://content.osu.edu/v2/` |
| CORS | `Access-Control-Allow-Origin: *` | `curl -D - -o /dev/null "<search url>"` |
| Rate limit headers | none present | same |
| Cache validators | no ETag, no Last-Modified, no Cache-Control | same |
| `X-Target-Hash` | stable per URL, differs per URL, not a body hash | two identical calls plus one different call |
| Backend | Apache 2.4.6 / RHEL, behind a Citrix NetScaler | `Server:` and `NSC_` cookie |
| OSU's own site uses this API | yes, hardcoded in the browser bundle | `grep content.osu.edu/v2 osu-mobile.js`, 389,460 byte file |
| Response time | 189 to 210 ms, TTFB 176 to 185 ms | 3 sequential curls, `%{time_total}` |
| Page size gzipped | 34.5 to 44.1 KB | `-H "Accept-Encoding: gzip"` |
| Page size raw | 524,595 B (math p1), 498,158 B (cse p1) | `-H "Accept-Encoding:"` |
| Compression saving | 15.2x, 93.4% | the two above |
| Node `fetch` default | already sends `accept-encoding: gzip, deflate` | local http server echo |
| Finder harvester rate | about 15.6 req/s at CONCURRENCY 5 / DELAY 120 | `5 / (0.20 + 0.12)` |
| Recommended rate | about 2.9 req/s at CONCURRENCY 2 / DELAY 500 | `2 / (0.20 + 0.50)` |
| Instructor PII per page | 64 distinct names, 64 distinct emails, 208 email occurrences | python over one cse page |
| Finder committed data | 0 osu.edu emails across all 10 data files | `grep -o -E '[\w.+-]+@osu\.edu' data/*.json \| wc -l` |
| Roomix in-page disclaimer | none in served HTML, meta description only, 3,339 bytes | `curl -s https://roomix.app/` |
| Roomix App Store disclaimer | "Roomix is an unofficial app and not affiliated with OSU" | App Store listing, id 6473177665 |
| Roomix privacy policy | HTTP 404 | `curl -sL "https://fatih.bal.soy/privacy-policy?roomix"` |
| Ohio privacy statute | none enacted, HB 376 stalled | legislative search |
| GitHub Pages limits | 100 GB/mo soft, 1 GB site, 10 builds/hr soft, no commercial use | GitHub Pages docs |
| Overpass allowance | ~10,000 req/day, <1 GB/day | Overpass commons doc |
| Vacant's Overpass usage | 1 query, once, ever | design |

Local artifacts from this session, if anyone wants to re-read the policy text
without downloading it again:

- `%TEMP%\idp.txt`, Institutional Data policy, extracted text
- `%TEMP%\responsible-use.txt`, Responsible Use policy, extracted text
- `%TEMP%\osu-mobile.js`, OSU's own class search bundle
- `%TEMP%\search.json`, one raw API page, **contains instructor emails, do not commit**

Total HTTP requests made to `content.osu.edu` during this research: 9.

---

## 10. Open questions

1. **Does OSU consider a weekly full-catalog pull reasonable under I.D?** Unknowable
   without asking, and asking has an asymmetric downside: a "no" in writing is
   worse than no answer, and it is the position Modal and Stripe ended up in on the
   OSS side. Recommendation is to ship the polite client, publish `docs/DATA.md`,
   and stay reachable, rather than to seek permission.
2. **Is there an internal OSU API policy that is simply not on the public web?**
   Possible. Nothing surfaced. An Ohio Public Records Act request could ask for
   "any policy or acceptable use statement governing content.osu.edu", and he has
   already run one records request successfully (`Finder/docs/public-records-request.md`,
   sent 2026-08-23). Filing one here is cheap but it also creates a paper trail
   that names the project. Neutral on this, leaning wait.
3. **Does the `facilityType` code set distinguish restricted spaces?** Blocking
   item for the safety disclaimer and the room filter, not for legal.
4. **Should Finder's non-affiliation line move from README into the shipped page?**
   Probably yes, but that is a Finder change and out of scope here.
5. **Building access hours.** If a hours dataset does not exist publicly, phase 4
   reports become the only source, which raises the value of getting the report
   privacy design right the first time.
6. **Does OSU's mobile app team monitor user agents at all?** The self-identifying
   string is worth more if someone reads it. No way to know. Ship it anyway, the
   cost is zero.
