# Club occupancy: source investigation and offline prototype (#110)

Checked 2026-09-03 against local `main` at `7bf4c72`.

**Status: prototype, not a shipped fix.** No production meeting feed was verified.
The application still uses its class schedule and existing club-booking caveat.
Do not close [#110](https://github.com/EnesYilmazcode/Vacant/issues/110) on the
strength of this prototype. No booking or contact message was submitted.

## Sources checked

| Candidate | Observed access and scope | Decision |
| --- | --- | --- |
| [Student Life calendar](https://studentlife.osu.edu/events.aspx), also displayed on [Student Activities](https://activities.osu.edu/events.aspx) | Public event listings, with event IDs in the `e` URL parameter and free-text locations. Both hosts' `robots.txt` disallow `/events.aspx` for `User-agent: *`. | No automated calendar harvester. It does not cover the main use case even if access were approved. |
| [Student organization calendar guidelines](https://activities.osu.edu/involvement/student-organizations/find-a-student-org/student-org-calendar) | Regular organization meetings are explicitly excluded. Public on-campus events can be published immediately. Cancellations remove events, and edits return a published event to draft until resubmission. | Absence from this calendar cannot be used to infer that a classroom has no club booking. |
| [Student Life space request system](https://emsweb.studentaffairs.ohio-state.edu/emswebapp/Default.aspx) | The guest landing page offered Browse → Locations but returned no buildings. An authenticated account showed the KBK Center for Student Leadership and Service, North District, Ohio Union, Outdoor Space, and Recreation and Physical Activity Center. It offered matching request templates for four of those non-classroom areas. No classroom building, classroom request template, or classroom booking appeared. | Best candidate to re-check after classroom requests open. Current authenticated access proves that the system can show spaces; it does not yet expose the classroom records #110 needs. |
| [Registrar room matrix](https://courses.osu.edu/psp/csosuct/EMPLOYEE/PUB/c/OSR_CUSTOM_MENU.OSR_ROOM_MATRIX.GBL) | The public link from the Registrar returned HTTP 403 to the research fetch. Older repository notes described it as public; this run could not verify its current data. | No bypass, no verified event coverage. |
| [Library student-organization reservations](https://library.osu.edu/room-reservation/student-organizations) | Public page describes a separate reservation process and displays a room-search shell. No classroom booking records or feed were verified. | Narrower candidate; do not equate library spaces with the classroom index. |

The [Registrar](https://registrar.osu.edu/staff-resources/class-catalog-and-space/event-space-request/)
routes student-organization reservations to Student Life. The
[Events and Conferences guide](https://slec.osu.edu/plan-your-event/host-a-student-event)
explicitly describes recurring classroom meetings and real-time availability
through the space request tool. This is stronger evidence of relevant coverage
than a calendar designed for public events. It is not evidence that a reusable
public feed exists.

The authenticated home page publishes a nominal Autumn classroom request date
of August 5. On September 3, the classroom area and template were still absent.
The account holder reports that classroom requests remain closed until the
University finishes scheduling midterms and exams. The UI observation supports
that report but does not establish a new opening date. A missing classroom area
means "not published yet", never an empty reservation calendar.

## Coverage estimate and access limits

- The current Vacant index contains **425 rooms**. No reservation source was
  successfully mapped to one of those rooms in this investigation: **0/425
  verified**, with actual booking coverage **unknown**, not zero.
- No estimate of the share of clubs or recurring meetings covered is defensible
  yet. The public-event calendar excludes regular meetings by policy.
- No public or authenticated source's complete update/cancellation contract, event-to-room mapping,
  booking IDs, or numeric rate limit was verified. Calendar event IDs alone do
  not establish stable reservation or organization IDs.
- The EMS host returned 404 for `/robots.txt`; that is not a licence to reuse its
  data. Its guest and authenticated UIs were inspected without submitting or
  changing a reservation and without probing hidden endpoints. Account names,
  existing events, contact details, and credentials were not recorded.
- Calendar publishing guidelines describe posting, not third-party data reuse.
  The library page carries a CC BY 4.0 notice with exceptions; that does not
  establish the terms for a separate reservation service.
- Calendar pages were inspected during discovery before their robots directives
  were checked. No recurring fetch or crawler was created.

## Proposed source order and refresh policy

1. An operator-approved public export of confirmed Student Life classroom
   bookings, if available. Obtain a documented schema and terms before writing
   an adapter. Ask for room ID, occurrence ID, date, start/end, cancellation state,
   organization ID, and source update time. Personal contacts are unnecessary.
2. Other approved university booking exports with an exact room join, including
   library spaces only if they occur in Vacant's index.
3. Organization-maintained public feeds only for gaps, with documented access
   and stable IDs. Deduplication across sources needs a shared organization and
   occurrence identity; names alone are not a reliable join.

An individual member's authenticated EMS account is suitable for a one-time,
minimal research sample after classroom access opens. It is not a production
credential, a public feed, or permission to redistribute EMS data. Do not put
credentials, cookies, or authenticated URLs into this repository, GitHub Actions,
or a client-side fetch. Production still requires operator-approved access.

Proposed initial refresh: hourly over a rolling seven-day window, with a **24-hour
hard expiry**, subject to the operator's permitted frequency. These numbers are
engineering starting points, not measured freshness guarantees. Measure change
and cancellation latency before enabling recommendations. Replace complete
snapshots atomically; never append forever. A failed refresh must not renew the
old fetch timestamp. Disappearance semantics must be agreed with the source
before interpreting absence as cancellation.

## Offline prototype

`scripts/lib/club-occupancy.mjs` accepts a proposed normalized record contract.
It is not an EMS adapter. All positive booking examples in the tests are
explicitly synthetic, using `TEST101` and `example.org`; no real organization
is represented as occupying a room.

- `normalizeMeetings`: checks dated occurrences, known room IDs, explicit
  confirmation, exact minute boundaries, source URLs, and fetch age. It rejects
  unexpanded recurrence rules and conflicting versions. Extra personal fields
  are not copied into output. Identical occurrences from sources using the same
  canonical organization ID are deduplicated while retaining provenance.
- `overlayForDate`: returns a new index with meetings appended as busy tuples
  in a one-date session. Existing class tuples are preserved. Always start from
  the original class index, never from a previous overlay. Pass its sessions and
  date to the engine's query; old active-session masks cannot be reused.
- `clubDisclosure`: returns wording and provenance for a future UI. Empty
  results explicitly mean unknown coverage. Positive results remain partial.
  The function is not wired into the production app.

Run the focused tests:

```sh
node --test scripts/test/club-occupancy.test.mjs
```

The tests exercise the real engine's gap calculation, original-index
immutability, a one-time event not repeating next week, expanded recurring
occurrences and a cancelled occurrence, duplicate provenance, staleness,
unknown rooms, invalid times, and disclosure.

## What is required before rollout

1. After classroom access opens, use the authenticated UI to establish whether
   a confirmed classroom booking exposes a stable booking ID, exact room ID,
   start/end, series/occurrence identity, status/cancellation, and last update.
   Record the schema and anonymous values first; do not commit an organization's
   booking until publication and reuse are permitted.
2. Obtain an approved source and capture a minimal **real** fixture sample.
   Include a mapped classroom, a recurring occurrence and exception, a
   cancellation, an ambiguous room, and a source update. No contacts/attendees.
3. Implement the source adapter and canonical room/organization joins. Resolve
   timezone conversion in America/New_York, DST, overnight spans, recurrence
   exceptions, conflicting cross-source cancellations, and moved meetings.
4. Measure source completeness on a documented set of rooms/dates and verify
   several bookings against the operator's published view. Review reuse terms
   and the request budget. Keep unverified rooms marked as unknown.
5. Integrate the overlay consistently in ranking, room timelines, future dates,
   and holiday/no-class handling. An event must not be labelled as a class, and
   a no-class day must not discard event intervals. Preserve class coverage
   guards using the original class data.
6. Add source/freshness disclosure and offline-expiry behavior to the app,
   update service-worker assets, and test browser behavior with a pinned clock.
7. Release a limited set of verified rooms with an explicit coverage statement.
   Expand only after the cancellation and refresh behavior has been measured.

## Acceptance checklist for #110

- [x] Source inventory and defensible coverage statement.
- [x] Proposed source order and refresh policy, with unverified assumptions named.
- [ ] Representative public booking fixtures. **Blocked: no usable feed verified.**
- [x] Offline prototype converts already-expanded, verified occurrences to busy intervals.
- [x] Prototype merges with classes without modifying the original index.
- [x] Tests cover recurrence occurrences, cancellations, duplicates, stale data, unknown rooms.
- [ ] App integration and source/freshness UI. Only a presentation helper exists.
- [x] Staged rollout plan, with measured coverage still required.

The next data check is after classroom requests open. The next external step is
to ask Student Life Events and Conferences whether they provide an approved
classroom-occupancy export or API and permit its reuse. This investigation does
not authorize contacting them and no message has been sent.
