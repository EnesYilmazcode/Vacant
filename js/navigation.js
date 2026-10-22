// Screen chrome and Back labels are navigation policy, independent of DOM
// placement. The controller applies these decisions to the current elements.
export const BACK_TO = {
  ask: 'Back to the question',
  card: 'Back to the card',
  list: 'Back to the room list',
  way: 'Back to the way',
  room: 'Back to the room',
  near: 'Back to the nearest buildings',
  browse: 'Back to browse buildings',
  about: 'Back to what Vacant knows',
};

export function chromeFor(screen, desktop = false) {
  if (screen === 'ask') return { corner: null, panel: false };
  if (screen === 'card') return { corner: 'menu', panel: false };
  if (screen === 'way') return { corner: 'menu', panel: true };
  if (desktop) return { corner: 'menu', panel: true };
  return { corner: 'back', panel: false };
}

export function backLabel(entry) {
  if (entry?.v === 'pick') return 'Back without picking a building';
  return BACK_TO[entry?.from] ?? 'Back';
}
