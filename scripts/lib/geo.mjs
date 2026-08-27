// Distance on the ground, for the build scripts.
//
// The browser engine uses an equirectangular approximation instead, because it
// runs the calculation over every room on every query and the error at campus
// scale is under a metre. This is the slower, correct reference the fast one is
// tested against.

const R = 6371008.8; // IUGG mean Earth radius, metres
const rad = (deg) => (deg * Math.PI) / 180;

// The Oval, the geographic centre of the Columbus campus and the origin every
// distance in the shipped dataset is measured from.
export const OVAL = { lat: 39.9995, lon: -83.013 };

export function haversineMetres(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export const kmFromOval = (p) => haversineMetres(OVAL, p) / 1000;
