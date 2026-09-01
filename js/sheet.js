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

export const restFor = (screen) => REST[screen] ?? PEEK;

// The strip the sheet is NOT covering, which is what the camera centres in.
// Keyed to where the screen RESTS so a drag slides the sheet over a map that
// stays put, and short by the install rail, which the sheet now stands on:
// leaving the rail out put 112 of the room screen's 122px of walk line back
// under the panel at 393x852. The one pixel floor is for a rail taller than the
// strip, where there is nothing left to compose for and still a divisor to find.
export const bandFor = (screen, height, rail = 0) =>
  Math.max(1, Math.round(height * (1 - restFor(screen))) - rail);

// The height a screen opens at. A height dragged on ANOTHER screen is not this
// one's: bandFor has already composed the map for where THIS screen rests, so
// carrying the old height over frames a strip the sheet does not leave.
export const openAt = (screen, dragged, height) =>
  (dragged && dragged.screen === screen && dragged.h) || restFor(screen) * height;

// The whole of the sheet's travel below peek. It was 44px and every pointerdown
// on the sheet could reach it: a 60px pull on a row at the top of the list,
// where the pane has nothing left to scroll so the drag becomes a sheet drag,
// threw the list, the selection and the scroll position away.
export const DISMISS_PX = 88;

// How far down a gesture may push the sheet, decided by where the finger landed.
// Only the grip may go below peek.
export const floorFor = (mode, height) => PEEK * height - (mode === 'grip' ? DISMISS_PX : 0);

// Where a drag leaves the sheet, and what letting go there means. Dismissing
// needs both halves: the grip's reach, and the sheet pulled to the end of it.
// `<=` because the sheet stops dead at its floor, so a pull that reached the end
// lands ON it rather than past it.
export function sheetAfterDrag(h0, dy, mode, height) {
  const floor = floorFor(mode, height);
  const h = Math.max(floor, Math.min(FULL * height, h0 - dy));
  return { h, dismiss: floor < PEEK * height && h <= floor };
}
