# Launch: the date, the posts, and what not to say

The parked decision was to hold the URL until building hours shipped. They have
shipped, so this is live. `buildings-hours.json` carries 47 buildings a term from
the Registrar's classroom pool schedule, and the app labels a building with no
published hours as unknown rather than guessing.

## The date: Tuesday 15 September 2026

Autumn 2026 instruction runs 25 August to 9 December, confirmed by three
independent sources that agree: the Registrar page header, the academic ICS feed,
and the `startDate` / `endDate` fields on live meeting objects.

Excluded weekdays, all confirmed against that calendar: Sep 7 (Labor Day), Oct 15
and 16 (Autumn Break), Nov 11 (Veterans Day), Nov 25 to 27 (Thanksgiving), and
the whole of Dec 11 to 17 (finals).

15 September is a Tuesday. It is week 4, which is the first week the problem
actually bites: in weeks 1 and 2 people are still fixing their schedules and
nobody is hunting for a room, and by week 4 the first midterms are close enough
that study space is scarce. It is nineteen days out from 27 August, which is
enough time to finish the things below. It is not a football weekend and not
adjacent to a break.

**It is not a hard date.** If the blockers below are not done, move it to
Tuesday 22 September or Tuesday 29 September. Posting a room finder that sends
somebody to a locked door is worse than posting it two weeks late.

### What has to be true before it goes out

- [ ] **The ground-truth walk is done.** Twenty rooms the app calls free, walked,
      with what was actually true written down. This has not happened and it is
      the real blocker. The post below has a limitations section, and that section
      is currently written from measurements of the data rather than from standing
      in front of twenty doors. It has to be updated with what the walk found
      before anybody reads it.
- [ ] The install path works: manifest, icons, service worker, install hint.
      The post drives installs and the origin is baked in at install time.
- [ ] **The privacy page is reachable from the app.** `privacy.html` ships, but
      nothing in `index.html` links to it, so today a student cannot get there
      from inside the app. Posting a link that promises a privacy page nobody can
      open is worse than not mentioning one. See `README-CORRECTIONS.md`.
- [ ] **Nothing in the post says "offline" until `sw.js` exists.** There is no
      service worker today: `getRegistrations()` is empty, `caches.keys()` is
      empty, and an offline reload is the browser's error page. The posts below
      have had the offline line removed. If the service worker lands before the
      post goes out, put it back and say "after the first load". If it does not,
      leave it out. Do not soften it to "works almost offline".
- [ ] `og.png` exists at 1200x630 and the preview has been tested by pasting the
      link into iMessage **and** into a Reddit comment box. Both cache previews,
      so a corrected image will not refresh one somebody already generated.
- [ ] The gismaps@osu.edu note has gone out. See `outreach/gismaps-email.md`.
- [ ] Roomix's author has had his heads-up. See `DECISIONS.md`.

---

## The r/OSU post

Title: **I built a thing that finds you an empty classroom, and tells you when it
does not know if the door is unlocked**

> I am an OSU student. I made [Vacant](https://enesyilmazcode.github.io/Vacant/).
> It is free, unofficial, and it is not affiliated with the university.
>
> **What it does not know, first, because that is what matters.**
>
> It cannot see club bookings or one-off events. Those are not in the class
> schedule at all, so a room can be booked and Vacant will still call it free.
>
> It cannot see a locked door. It knows the Registrar's published building hours,
> which cover 46 of the 96 buildings it lists and 626 of the 871 rooms. For the
> other 245 rooms it says "hours not published" rather than guessing.
>
> And about 9% of scheduled in-person meetings carry no room in the data at all.
> I measured it: 881 of 9,541 across two whole terms. Those classes are sitting
> in a room somewhere and Vacant thinks it is empty.
>
> **What it does.** You open it, it asks how long you need, and it lists rooms
> that are free for that long, sorted by walk time, with the walk already
> subtracted. If you need 90 minutes and a room frees up in 6 minutes of walking
> but has a class in 80, it does not offer it.
>
> The whole thing is 102 KB on first load. No account, no ads, no tracking, and
> your location never leaves your phone.
>
> [Source and data notes.](https://github.com/EnesYilmazcode/Vacant)
>
> If it sends you to a locked door, tell me which building. That is what I most
> need help with.

**Do not put the Roomix comparison in the post.** Reasons in the next section.

---

## The comparison, if a comment asks for it

Keep it in a reply, not the post. A reply that answers "how is this different
from Roomix" reads as an answer. The same words in the post read as an attack on
a maintained three-year-old product with an App Store listing, and that invites a
correction in the thread.

Every claim here traces to a measured line in `research/prior-art.md`. Nothing
else goes in.

> Roomix is good and it has been live since 2023 across web, iOS and Android. It
> does the building browser job better than I do.
>
> Three differences, all measured from its own published files:
>
> Its vacancy search only looks inside 200 metres of one building you pick first.
> That is the literal `if (d.b > 200) break` in its bundle, walking a precomputed
> building-distance graph. About a two and a half minute walk. Vacant ranks the
> whole campus.
>
> It has no walk time. `walk` appears zero times in its 4,069,039-byte bundle.
> Subtracting the walk from the usable window is the thing Vacant is actually for.
>
> It has no building hours. `hours.json` returns 404 and there is no equivalent
> under another name. So on a Saturday it will offer you rooms in buildings that
> are locked. Only 5 of the Registrar's 47 pool buildings are open on Saturday. Of
> the 871 rooms I list, 550 are in a building the table says is closed that day,
> and I drop every one of them. Another 245 are in buildings that publish no hours
> at all: I still list those, labelled "hours not published", with no free-until
> time on them, because I do not know the door is open and I am not going to
> pretend otherwise.
>
> First load is about 3.3 MB for Roomix against 470 KB for Vacant, or 102 KB
> gzipped.

**Claims that must never be made**, because the research disproved them and the
README carried them for a while: Roomix does not lack GPS, and it does not ignore
time. It has a nearest-building button and a start/end time pair. What it lacks is
campus-wide ranking, walk time, and hours.

---

## The short version, for the CSE Discord or a GroupMe

> Made this: [Vacant](https://enesyilmazcode.github.io/Vacant/). Tell it how long
> you need, it finds an empty classroom near you with the walk there already
> subtracted. Free, no account, no tracking. It says so when it does not know if
> the door is unlocked.

## Handing someone your phone

Do not explain it. Open it, hand it over, say "how long do you need?" and stop
talking. If they get to a room without asking a question, it works. If they ask
what a number means, that is a bug in the screen, not in them.

The one thing worth saying out loud afterwards is the honest bit: "it will not
lie to you about a locked door, it just says it does not know."

---

## Two things this post deliberately does not do

**It does not promise maintenance.** This category dies of author departure, not
of lack of demand. The highest-starred dedicated project in it was archived after
about two years. Saying "I will keep it updated" is a promise nobody in this
category has kept and it is not needed to get anyone to try it.

**It does not ask for anything except locked-door reports.** No stars, no
upvotes, no feedback form. One ask, and it is the ask that makes the product
better at the only thing that makes it different.
