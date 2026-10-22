// The first location fix and its honest fallbacks. The continuing watch lives
// in the application controller because accepted fixes can repaint several
// screens, but both paths share the boundary and origin helpers here.
import { safeGet } from './storage.js';

export const KEY_ORIGIN = 'vacant.origin';
export const OFF_CAMPUS_KM = 2.2;
export const OVAL = { lat: 39.9995, lon: -83.013 };
export const FIX_TIMEOUT_MS = 8000;
export const NO_WALK = 'No classroom close enough to walk to';
export const NO_WALK_OVAL = `${NO_WALK}, showing from the Oval`;

export const ovalOrigin = (now = Date.now) => ({
  ...OVAL,
  accuracy: null,
  source: 'oval',
  label: 'the Oval',
  at: now(),
});

// The documented 2.2 km walking boundary in the same flat conversion it was
// measured with. It describes what Vacant can rank, not where OSU property ends.
export const offCampus = (here) =>
  Math.hypot((here.lon - OVAL.lon) * 85, (here.lat - OVAL.lat) * 111) > OFF_CAMPUS_KM;

// A deliberate choice does not expire the way a sensor reading does.
export function pickedOrigin() {
  try {
    const raw = JSON.parse(safeGet(KEY_ORIGIN) ?? 'null');
    if (raw && Number.isFinite(raw.lat) && Number.isFinite(raw.lon)) {
      return { accuracy: 50, source: 'picked', ...raw };
    }
  } catch {
    // A corrupt key is the same as no key.
  }
  return null;
}

export function locate({
  geolocation = globalThis.navigator?.geolocation,
  picked = pickedOrigin(),
  setTimer = globalThis.setTimeout,
  clearTimer = globalThis.clearTimeout,
  now = Date.now,
} = {}) {
  if (picked) return Promise.resolve({ origin: picked, note: null });

  const oval = ovalOrigin(now);
  return new Promise((resolve) => {
    let done = false;
    const finish = (origin, note) => {
      if (done) return;
      done = true;
      resolve({ origin, note });
    };
    const watchdog = setTimer(() => finish(oval, 'Location timed out, showing from the Oval'), FIX_TIMEOUT_MS);
    if (!geolocation) {
      clearTimer(watchdog);
      return finish(oval, 'No location on this device, showing from the Oval');
    }
    const fail = (why) => {
      clearTimer(watchdog);
      finish(oval, `${why}, showing from the Oval`);
    };
    try {
      geolocation.getCurrentPosition(
        (position) => {
          clearTimer(watchdog);
          const here = { lon: position.coords.longitude, lat: position.coords.latitude };
          if (offCampus(here)) return finish(oval, NO_WALK_OVAL);
          finish(
            { ...here, accuracy: position.coords.accuracy, source: 'gps', label: null, at: now() },
            null,
          );
        },
        (error) => fail(
          error.code === 1 ? 'Location is off'
          : error.code === 2 ? 'Location unavailable'
          : 'Location timed out',
        ),
        { enableHighAccuracy: false, timeout: FIX_TIMEOUT_MS, maximumAge: 60000 },
      );
    } catch {
      fail('Location is unavailable');
    }
  });
}
