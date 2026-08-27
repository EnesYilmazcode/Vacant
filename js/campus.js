// Decode data/campus.json back into coordinates.
//
// Shapes are stored as delta-encoded steps on a grid across the bounding box:
// the first pair is absolute, every pair after it is a step from the last. Over
// a ~4.5 km span that grid is about 7 cm, far finer than the ~6 m one pixel
// covers at campus zoom, and small integers are what gzip compresses well.
//
// layers[name] is an array of FEATURES, each an array of rings. Rings stay
// grouped because ArcGIS marks a hole only by winding order, and that is gone
// once a ring is delta-encoded: 19 buildings on the shipped map have a
// courtyard, and flattening the rings draws them as solid blocks. Draw one path
// per feature and let even-odd fill do the rest.
//
// Grid values are NOT bounded to 0..grid IN EITHER DIRECTION. The fetch asks
// for shapes that INTERSECT the bounding box, so a road or the river crossing
// the edge comes back whole: measured range on the shipped file is
// x -19205..65000 and y 3313..102550, against a grid of 65535. The maximum
// EXCEEDS the grid, so a renderer packing these into a Uint16Array wraps 102550
// to 37014 and teleports the north edge to the middle of the map. Clip rather
// than clamp: clamping tears shapes apart at the boundary.
//
// Runs in the browser and under node, no imports.

// Every ring of one feature, decoded. This is what a renderer wants: one path,
// all its rings, even-odd fill.
export function decodeFeature(rings) {
  return rings.map(decodeShape);
}

// Grid steps for one ring, as [x, y] pairs. Cheap enough to call per frame,
// but callers that redraw should decode once and keep the result.
export function decodeShape(deltas) {
  const out = new Array(deltas.length / 2);
  let x = 0;
  let y = 0;
  for (let i = 0; i < deltas.length; i += 2) {
    x += deltas[i];
    y += deltas[i + 1];
    out[i / 2] = [x, y];
  }
  return out;
}

// Grid steps back to longitude and latitude. Only needed to check the data or
// to place something given in real coordinates; drawing works in grid space.
export function toLonLat([x, y], { bbox, grid }) {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  return [minLon + (x / grid) * (maxLon - minLon), minLat + (y / grid) * (maxLat - minLat)];
}

// Longitude and latitude to grid steps, for putting the user's dot and a
// building's centroid on the same surface as the shapes.
export function toGrid([lon, lat], { bbox, grid }) {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  return [
    ((lon - minLon) / (maxLon - minLon)) * grid,
    ((lat - minLat) / (maxLat - minLat)) * grid,
  ];
}

// Is this coordinate on the map at all? Rooms outside the map radius still
// belong in the list, they just have nothing to point at.
export function inBounds([lon, lat], { bbox }) {
  return lon >= bbox[0] && lon <= bbox[2] && lat >= bbox[1] && lat <= bbox[3];
}

// Width over height for drawing, so campus is not stretched.
//
// Grid space is NOT square: toGrid normalises a non-square bounding box to
// 0..grid on BOTH axes independently, so the display ratio folds in the bbox
// shape as well as the fact that a degree of longitude is shorter than a degree
// of latitude. Do not hardcode cos(latitude): for the shipped bbox this returns
// 1.2087, while cos(40) alone is 0.766.
export function aspect({ bbox }) {
  const midLat = (bbox[1] + bbox[3]) / 2;
  const lonSpan = (bbox[2] - bbox[0]) * Math.cos((midLat * Math.PI) / 180);
  return lonSpan / (bbox[3] - bbox[1]);
}
