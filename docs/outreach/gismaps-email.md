# The note to gismaps@osu.edu

Not sent yet. **Send it before the URL is shared publicly.** A silence is not
permission, and that is written into `DECISIONS.md` so nobody reads a
non-response as a yes.

Why it goes out at all: the FITS grant on the OSU GIS Hub is a real grant, but it
is a Hub sentence with an asserted copyright beside it and a Terms of Service link
that is `href="#"` and goes nowhere. And `FacilitiesStreets_RO`, the layer Vacant
actually reads, is not one of the 13 items the OSU GIS account publishes to
ArcGIS Online. It lives on `gissvc.osu.edu` directly. So the Hub statement is the
closest applicable statement rather than a statement about this exact layer. The
email converts an inference into a fact and costs nothing if it is ignored.

What it is not: a permission request. Vacant does not need one and asking for one
invites a no. It is a courtesy note with a named credit line and one small
question.

---

**To:** gismaps@osu.edu
**Subject:** Crediting the FacilitiesStreets_RO building layer in a student project

Hello,

I am an Ohio State undergraduate. I built a small free web app called Vacant that
helps students find an empty classroom near them, and it draws campus from your
`Data/FacilitiesStreets_RO` map service.

Two things I wanted to tell you rather than assume:

I read the building layer once at build time and commit the result to a static
file, so the app never calls your service at runtime. Right now that is one
request for the building table and a handful for the map geometry, run by hand
when something moves, not on a schedule. Total load on your server since I
started is under twenty requests.

I credit it as: **Building locations (c) 2025 The Ohio State University,
Facilities Information and Technology Services.** That line renders at the bottom
of the app's results screen, in its About panel, and in the repository. If you
would like it worded differently, or linked somewhere specific, tell me and I
will change it the same day.

The one question: the licence text on the GIS Hub says "For use by anyone
interested in OSU data," but `FacilitiesStreets_RO` is not one of the items
published to ArcGIS Online, so I am not certain that statement was written about
this layer. Does it cover it?

The project is at <https://github.com/EnesYilmazcode/Vacant>. It is a student
project, it is not affiliated with or endorsed by the university, there is no
money in it and there never will be. If you would rather I did not use the layer,
say so and I will pull it.

Thanks for publishing this. It is the reason the map looks like Ohio State
instead of like everyone else's map.

Enes Yilmaz

---

## When a reply arrives

Record the date and the answer in `DECISIONS.md`, and change the credit line the
same day if they ask for anything. If they say no, the map layer comes out and
the app falls back to a list with no footprints, which is a real loss and still
the right call.

## If no reply arrives

Wait two weeks, then note the silence in `DECISIONS.md` and carry on. Silence is
not permission and the entry has to say that in those words, so a reader in March
does not find "sent, no objection" and mistake it for a grant.
