// The other half of "free", adapted from the application's pure building-data
// module so the standalone spike cannot drift from the shipped door rules.
//
// engine.vendor.js is a byte copy of js/engine.js and holds the schedule rules.
// rank() only knows about doors through the hoursFor callback the app hands it.
// js/buildings.js has no DOM dependency, so this page can now share that logic.
import { hoursFor, pickHoursTerm as selectHoursTerm } from '../js/buildings.js';

// The term the app is SERVING, not whichever table happens to be biggest.
// Picking the fullest one worked only because Autumn has 47 buildings against
// Summer's 46; during Summer term it would have ranked every room against
// Autumn's hours.
export function pickHoursTerm(hours, current) {
  return selectHoursTerm(hours, current, () => {})[1];
}

// An [open, close] pair, null for published-closed, undefined for a building
// nobody publishes at all. The three are not interchangeable, and undefined is
// the majority case.
export function makeHoursFor(hoursTerm) {
  return (code, day) => hoursFor(hoursTerm, code, day);
}
