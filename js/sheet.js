// Where the sheet rests, what that leaves the map, and how far a drag has to go
// before letting go throws the answer away. Arithmetic over a viewport height
// and nothing else, so the suite checks these as numbers rather than as source.
// js/app.js owns the element; this owns the geometry, once.

// The two sheet heights, as a fraction of the viewport. Measured on a 390x844
// phone: peek leaves a 523px map band, which is 832 m of ground, puts 32 of 40
// targets on screen and draws all 40 lines in full. Full leaves 186px, which is
// enough to know the map is still there.
export const PEEK = 0.38;
export const FULL = 0.78;

// Where the sheet opens on the room screen. Below FULL so the building stays
// visible on the map behind it, and far enough up that six hours of the day
// grid are on screen before anybody scrolls.
export const ROOM_SHEET = 0.72;

// viewport() used to hold a second copy of this that said peek on every screen,
// so the room screen framed the walk line for a 324px sheet and drew it under a
// 613px one: at 393x852, 164 of the 206px of target ink went under the panel.
export const REST = { ask: 0, list: PEEK, near: PEEK, room: ROOM_SHEET, pick: FULL, about: FULL };

// Where a screen rests once it is covering the map, and the strip it still has
// to leave at the top: 44px of back button on a 0.6rem inset, plus air. In
// pixels, because a button does not scale with the phone.
export const COVER = 0.92;
export const BACK_PX = 76;

// A screen leaves a map band because there is a lit footprint and a walk line in
// it. Before a row is tapped there is nothing on that canvas but your own dot:
// at 393x852 the list left 528px of campus, 62% of the screen, to say where the
// reader already is. So a screen with nothing on the map covers it, and tapping
// a row is what uncovers it.
//
// `ask` is the exception twice over: it has no sheet, and its map is a blurred
// drifting background rather than one anybody reads.
//
// `targeted` is state.selected at every call site. Defaulted true so the screens
// that always have one read unchanged.
export const restFor = (screen, targeted = true) =>
  (!targeted && screen !== 'ask' ? COVER : REST[screen]) ?? PEEK;

// The strip the sheet is NOT covering, which is what the camera centres in.
// Keyed to where the screen RESTS so a drag slides the sheet over a map that
// stays put, and short by the install rail, which the sheet now stands on:
// leaving the rail out put 112 of the room screen's 122px of walk line back
// under the panel at 393x852. The one pixel floor is for a rail taller than the
// strip, where there is nothing left to compose for and still a divisor to find.
export const bandFor = (screen, height, rail = 0, targeted = true) =>
  Math.max(1, Math.round(height * (1 - restFor(screen, targeted))) - rail);

// The tallest the sheet may be, in PIXELS. FULL wherever the map is on screen.
// Where it is covered there is nothing to leave room for but the back button, so
// the sheet takes the rest of the screen -- and the install rail stands the
// sheet on top of it, so the button and the rail come out of one subtraction.
// Never below FULL, which is where every screen stopped before this.
export const capFor = (screen, height, rail = 0, targeted = true) =>
  restFor(screen, targeted) <= FULL
    ? FULL * height
    : Math.max(FULL * height, Math.min(COVER * height, height - rail - BACK_PX));

// Where a screen rests, in pixels: its fraction, or the cap when the fraction
// asks for more room than the button and the rail leave.
export const restPxFor = (screen, height, rail = 0, targeted = true) =>
  Math.min(restFor(screen, targeted) * height, capFor(screen, height, rail, targeted));

// The height a screen opens at, in pixels. A height dragged on ANOTHER screen is
// not this one's: bandFor has already composed the map for where THIS screen
// rests, so carrying the old height over frames a strip the sheet does not
// leave. Nor is a height dragged while a room was lit, once the selection is
// gone: restoring a 324px sheet over a covered map is the empty band again.
export const openAt = (screen, dragged, restPx, targeted = true) =>
  (targeted && dragged && dragged.screen === screen && dragged.h) || restPx;

// The whole of the sheet's travel below where it rests. It was 44px and every
// pointerdown on the sheet could reach it: a 60px pull on a row at the top of
// the list, where the pane has nothing left to scroll so the drag becomes a
// sheet drag, threw the list, the selection and the scroll position away.
export const DISMISS_PX = 88;

// How far down a gesture may push the sheet, decided by where the finger landed.
// Only the grip may go below where the screen rests. A screen covering the map
// rests at its own ceiling, so a pane drag there has nowhere to go and cannot
// uncover an empty canvas, while the grip keeps its whole travel below that.
//
// Pixels in, pixels out. It took a viewport height and assumed PEEK, which is
// the assumption that stopped holding the moment a screen could rest elsewhere.
export const floorFor = (mode, restPx) => restPx - (mode === 'grip' ? DISMISS_PX : 0);

// Where a drag leaves the sheet, and what letting go there means. Dismissing
// needs both halves: the grip's reach, and the sheet pulled to the end of it.
// `<=` because the sheet stops dead at its floor, so a pull that reached the end
// lands ON it rather than past it.
export function sheetAfterDrag(h0, dy, mode, restPx, capPx) {
  const floor = floorFor(mode, restPx);
  const h = Math.max(floor, Math.min(capPx, h0 - dy));
  return { h, dismiss: floor < restPx && h <= floor };
}
