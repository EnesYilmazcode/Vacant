# The ask: is there a published key for facilityType?

Draft. Not sent. Send it or delete it, but do not leave it sitting here for a
term.

## Why this is worth an email

`facilityType` decides which rooms Vacant will send a student to. Nine of the 28
codes in the Autumn 2026 harvest are decoded from one or two rooms, which is to
say guessed. The allow list handles that by hiding anything it does not
recognise, so the cost of not knowing is rooms that never appear rather than a
student sent somewhere wrong. A confirmed key turns most of the guesses into
facts and probably adds real classrooms back.

There is one concrete disagreement worth naming in the mail. `CM0100`, Campbell
Hall 100, is on the Registrar's own Autumn 2026 general assignment list and
reports `facilityType: 5L`, which our table hides. It is the only room in the
term where the two Registrar-derived sources point opposite ways.

## Who

The Room and Class Scheduling Office, at
<https://registrar.osu.edu/staff-resources/class-catalog-and-space/room-and-class-scheduling-office/>.
Use the contact address on that page rather than a person's name.

## Draft

> Subject: Is there a published key for the facilityType codes in the class API?
>
> Hi,
>
> I am an Ohio State undergraduate building a small free tool that tells students
> which classrooms are empty right now. It reads the public class search API at
> content.osu.edu, and every meeting record carries a `facilityType` on the room.
>
> I use that field to decide which rooms the tool is willing to suggest, because
> a general classroom and a dissection lab should not be offered the same way. I
> worked out the common codes from the data (`1B` is clearly the ordinary shared
> classroom, `2A` is a teaching laboratory), but nine of the 28 codes I have seen
> appear on only one or two rooms and I am guessing at them. When I am not sure,
> I leave the room out.
>
> Is there a published key for these codes, or a room-type list I could read?
>
> One specific case, in case it is quick: Campbell Hall 100 is on the Autumn 2026
> general assignment room list, and the API reports its type as `5L`, which I do
> not recognise. If `5L` is an ordinary classroom type I am hiding rooms I should
> be showing.
>
> Happy to share what I have worked out so far if that is useful.
>
> Thank you,
> Enes Yilmaz
> [cell]
> [link]

## If the answer is no, or there is no answer

Nothing changes. The allow list already defaults to hidden and the build prints
every code it does not recognise, so the list grows on purpose. Ask once, wait,
and do not chase it.

## What NOT to ask in the same email

Whether the weekly harvest is acceptable use. That question has no numeric safe
harbor to ask for, only a discretionary reasonableness standard, and a written
no is much worse than no answer. Recorded in BACKLOG.md under the decisions
parked on Enes, and it is a different office anyway.
