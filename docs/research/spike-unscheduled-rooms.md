# SPIKE: does a genuinely never-scheduled room exist in our own data?

**DROP.** Measured 2026-08-27 against the three committed terms.
[Issue #30](https://github.com/EnesYilmazcode/Vacant/issues/30). Reproduce with
`node scripts/spike-carried-rooms.mjs`, which reads only committed files and
makes no requests.

## The answer in one line

**Zero.** Not one carried-forward room is both a type Vacant would show and on
the Registrar's general assignment list, and **all 327 general assignment rooms
appear in all three terms**, so the multi-term union has nothing to find.

## What was asked

Roomix's `room_matrix.json` for term 1268 has 190 of its 1,067 rooms carrying an
empty `courses` array. One reading, borrowed from a different project at a
different school, is that those are the best study rooms on campus. The other is
that they are cross-term residue inside Roomix's own index, in which case
unioning our snapshots manufactures the same artifact and we cite it back to
ourselves as evidence.

The union would have tripled harvest cost and split every guard floor by term, so
it was worth settling first.

## What was measured

Both halves, from `data/raw/1262/`, `data/raw/1264/` and the 1268 harvest.

```
1262  884 rooms through the funnel, 894 named at all
1264  206 rooms through the funnel, 209 named at all
1268  871 rooms through the funnel, 877 named at all

carried forward (in 1262 or 1264, absent from 1268):  95
  strong positives  shown type AND on the GA list       0
  weak positives    shown type, off the GA list        49
  noise             everything else                    46

of the 327 Registrar general assignment rooms:
  never in any of the three terms                       0
  never in 1268 alone                                   0
```

Beside Roomix's figure: 190 of 1,067 is 17.8%. Ours is 95 of 966 distinct rooms,
9.8%, from two extra terms rather than a whole index.

## Why this is a DROP and not a "not yet"

**There is nothing to visit.** The spike's own design says walk to three strong
positives and look. There are none. Zero of 95.

**The GA half answers itself and it is the cheaper, stronger half.** The
Registrar publishes 327 general assignment rooms and every one of them is
scheduled in Autumn 2026. There is no such thing as a general assignment room
with no classes. The research's "69 of them never appeared in any sample" was an
artifact of sampling 40 subjects, and the full harvest puts it at 0.

**The 49 weak positives are not study rooms, and the grouping says so.** 33 of
the 49 are Knowlton Hall studio bays: `KN0310A` through `KN0390C`, the
architecture desk clusters. They are typed `1B` because they are rooms, and they
appear in Spring 2026 and not in Autumn 2026 because studio sections are
scheduled onto them term by term. Walking a stranger into an occupied
architecture studio is not the answer this app exists to give. The remaining 16
are one or two rooms each across thirteen buildings, including Drinko Hall (law,
already restricted), Davis Heart and Lung Research Institute and the Veterinary
Medicine Academic building.

**The cost of being wrong is unbounded and permanent.** A carried room ships with
an empty busy list, so it reads free at every minute of every day forever and
wins every ranking tie-break. It sits at the top of the list until somebody
notices. A room can be missing from 1268 because it was renovated, repurposed or
demolished, and nothing in the data separates that from a quiet classroom.

**The lookback ceiling is three terms and it is shrinking.** `searchableTermsV2`,
fetched 2026-08-27:

```
1262  Spring 2026   endDate 2026-08-31    leaves in four days
1264  Summer 2026   endDate 2027-01-01
1268  Autumn 2026   endDate 2027-01-31
```

Three terms are searchable at once on eleven-month windows, and `term=1258`
already returns `totalItems: 0`. Antscoper's rule of keeping any room with
activity in the last two years does not port, because the API deletes the term.
Widening the lookback means snapshotting before a term expires, not after, so the
union would be permanently capped at whatever the archives already hold. It holds
95 rooms and none of them is a positive.

## What was not done

**The three physical visits.** With zero strong positives there was nothing to
walk to, and the issue's own gate is "walk to three strong positives". If the
question is ever reopened, the visit list starts at Knowlton 310A.

## What this changes elsewhere

The union line is deleted from the backlog rather than left open, per the issue.
`docs/BACKLOG.md` under "Deliberately not filed" now records DROP with this
measurement instead of "gated behind spike-unscheduled-rooms".

One incidental finding worth keeping: the 1262 archive names a `facilityType` the
1268 harvest does not, `5F` on `WG0127` in Weigel Hall. It is hidden by default,
like every code the allow list does not know. Nothing to do; recorded so the
next person does not read it as a new defect.
