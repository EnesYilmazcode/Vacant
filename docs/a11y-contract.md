# The accessibility contract

Written before the row existed, and the row is built against it. This is not a
checklist of good intentions. It is the shape every screen in the app has to
keep, because the app is read outdoors, one handed, at a walking pace, by
someone who is late.

## The row

Five fields, two lines, one focusable node. Never a grid of nested buttons and
never a link inside a button.

Name order is identity, distance, window, size, caveat:

> "Hagerty Hall 050, 2 minute walk, free till 1:55 pm, 40 seats. Class schedule
> only, the door may be locked."

Visually the same row says `2 min`, `free till 1:55p`, `40 seats`. Glyphs on
screen, words in the accessible name. `7:50p` reads as "7:50 pm" and `2h05`
reads as "2 hours 5 minutes", because a screen reader saying "two aitch oh five"
is a row nobody can act on.

The caveat is the last thing in every row's name and it is never a separate
node. It is printed once in the visual list, at the foot, because a warning
repeated on 98 rows stops being read by row four.

### What the window is allowed to say

Four phrases and no fifth. Each one is a different promise:

| phrase | what it means |
| --- | --- |
| `free till 1:45p` | a class walks in at 1:55, minus the packing buffer |
| `no class rest of today` | nothing else is booked, so the door decides |
| `from 1:10p` | not free yet, and this is when it opens up |
| `hours not published` | nobody publishes this building's doors |

`no class rest of today` drops the lock time from the glyphs to keep the row to
two lines, so the accessible name carries it instead: "no class in it for the
rest of today, and the building locks at 9:30 pm".

There is no branch that prints a duration for a building with no published
hours. That path once printed `9h44` by capping an unknown window at midnight
and calling the remainder free.

`facilityCapacity === 0` is the index's sentinel for unknown and 44 of 871 rooms
carry it. It renders `seats unknown` and reads as "seat count not published".
Never `0 seats`.

## Live regions

Exactly one. `aria-live="polite"` sits on the result count and nothing else.
`grep -rn 'aria-live' index.html` returns one hit and that is a rule, not an
observation. A live region on the list itself reads 40 rows aloud every time a
chip is tapped.

## Focus

Entering any state that is not the ranked list moves focus to that screen's
message heading, and every such heading carries `tabindex="-1"`. That covers the
term refusals, the exam refusal, the closed campus, the empty list, the
buildings screen, the picker and the diagnostics panel.

Focus moves only when the state is entered, never on a repaint. A refresh that
lands in the same state leaves the reading position alone.

## Tap targets and reflow

Every control is at least 44 CSS px on its shortest side, including the chips,
the picker rows and the icon-only clear button. Icon-only controls carry a real
`aria-label` that reads as a sentence, not as a noun.

The room name is the one field a user carries while walking, so it never
truncates. At large text the row reflows: the name wraps freely, the walk time
drops below it, and the window and seat count stack. That reflow is a container
query in `em`, not a media query, because `rem` inside a media query resolves
against 16px forever and the reflow would never fire.

A column layout with four fields on one line was tried and rejected. At 390px it
forces every field to about 11 characters, which truncates
`Baker Systems Engineering`.

## Colour

Colour reinforces, it never carries. The tier is in the phrase: a reader with
colour off still gets `free till 1:45p` against `hours not published`.

Measured on the shipped palette, contrast against the page background:

| token | on `--bg` | on `--card` |
| --- | --- | --- |
| `--fg` primary line | 17.17:1 | 15.73:1 |
| `--dim` secondary line | 8.20:1 | 7.51:1 |
| `--warn` degraded states | 10.66:1 | 9.76:1 |
| `--accent` | 5.91:1 | 5.42:1 |

Near black on `--accent` measures 6.38:1, which is why the primary button is not
white on red. White on that red is 3.29:1 and fails the 4.5 floor on the one
control every session goes through.

`prefers-reduced-motion` removes the flyover drift, the sheet snap and the
compass needle's easing. `:focus-visible` draws a 3px ring in every state, and a
`forced-colors` block restores borders to everything that was carrying meaning
in a background colour.

## Sizes

No `px` on a font size, a line height or vertical rhythm. The body font is
`1rem`, not `16px`, because a px base silently overrides the browser font size
the reader chose, and that is the one setting most large-text users actually
change. Minimum tap heights stay in px on purpose: 44 is a physical finger, not
a multiple of the text size.

## What the screen must never do

Say a room is free when we do not know. "Hours not published" is a fact.
"Usually open" is a guess wearing the clothes of a fact. When the choice is
between hedging and refusing, the screen refuses and says why.
