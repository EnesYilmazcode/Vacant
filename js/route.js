// Walking distance over Ohio State's sidewalks, offline.
//
// data/walk-graph.json is 5,242 junctions and 7,977 edges of OSU's own sidewalk
// centreline layer, 21 KB gzipped, decoded here into typed arrays and searched
// with one Dijkstra per question. It replaces the straight line times DETOUR
// that js/engine.js used to quote, for every origin that lands near a path.
//
// It is a distance graph and not a map. The shape of the pavement between two
// junctions is not in the file -- only how many metres of it there are -- so
// nothing here can draw a route, and js/map.js still draws the direction #44
// decided on.
//
// WHAT IT IS NOT. This is not ground truth. It is OSU's published network, and
// the best that can be said for it is that it agrees with OSU's own routing
// service better than the constant it replaced: over 230 control walks, a
// median 33 m against 43 m, and 112 of 1,125 building pairs put in a different
// order against 142. Nobody has walked a route and timed it; #26 is still the
// measurement that would settle the pace, and this changes only the geometry.

// How far from a standing point the app will look for a path to start on.
//
// A student inside a building is 20-40 m from the nearest centreline and a
// student on the Oval is on one. 150 m is the radius past which "the nearest
// sidewalk" stops describing where somebody is standing -- in the middle of the
// river, in the stadium bowl, four blocks off the envelope this graph covers --
// and the honest answer there is the straight-line fallback, not a route that
// begins with an imaginary 200 m across whatever is in the way.
const SNAP_RADIUS = 150;

// Bucket side for the nearest-node lookup, in metres. Big enough that most
// queries finish within a ring or two, small enough that a ring is a handful of
// nodes: the committed graph fills 1,048 cells of this size, 5.0 nodes in each
// on average and 26 in the busiest.
const CELL = 60;

const R = 6371008.8;
const rad = (deg) => (deg * Math.PI) / 180;

// The same equirectangular plane js/engine.js measures in, anchored on the
// origin the file names. A door offset out of data/buildings-<term>.json adds
// straight onto the result.
export function toPlane(origin, lat, lon) {
  return {
    x: rad(lon - origin.lon) * Math.cos(rad((origin.lat + lat) / 2)) * R,
    y: rad(lat - origin.lat) * R,
  };
}

function readVarints(bytes) {
  let at = 0;
  return () => {
    let shift = 0;
    let value = 0;
    for (;;) {
      const byte = bytes[at++];
      value |= (byte & 127) << shift;
      if ((byte & 128) === 0) return value >>> 0;
      shift += 7;
    }
  };
}

const unzigzag = (n) => (n & 1 ? -(n + 1) / 2 : n / 2);

// Decode the committed file into a CSR graph: `first[i]` to `first[i + 1]` is
// the slice of `target`/`metres` belonging to node i. One flat pass, no objects
// per node and no per-edge allocation, because this runs on the boot path of a
// page whose whole argument is that it answers in a stairwell.
export function decodeWalkGraph(file) {
  if (!file?.graph || !file?.origin) return null;

  const binary = atob(file.graph);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const next = readVarints(bytes);

  const count = next();
  const xs = new Float64Array(count);
  const ys = new Float64Array(count);
  let x = 0;
  let y = 0;
  for (let i = 0; i < count; i++) {
    x += unzigzag(next());
    y += unzigzag(next());
    xs[i] = x;
    ys[i] = y;
  }

  // Two passes over the edge block. The first counts the degree of both ends so
  // the CSR offsets can be built exactly; the file stores each edge once, from
  // its lower-numbered end, and the search needs it from both.
  const degree = new Int32Array(count);
  const forward = [];
  for (let i = 0; i < count; i++) {
    const out = next();
    let last = i;
    for (let k = 0; k < out; k++) {
      const j = last + next();
      const excess = next();
      const metres = Math.hypot(xs[j] - xs[i], ys[j] - ys[i]) + excess;
      forward.push(i, j, metres);
      degree[i]++;
      degree[j]++;
      last = j;
    }
  }

  const first = new Int32Array(count + 1);
  for (let i = 0; i < count; i++) first[i + 1] = first[i] + degree[i];
  const total = first[count];
  const target = new Int32Array(total);
  const metres = new Float64Array(total);
  const cursor = first.slice(0, count);
  for (let k = 0; k < forward.length; k += 3) {
    const a = forward[k];
    const b = forward[k + 1];
    const w = forward[k + 2];
    target[cursor[a]] = b;
    metres[cursor[a]++] = w;
    target[cursor[b]] = a;
    metres[cursor[b]++] = w;
  }

  const buckets = new Map();
  for (let i = 0; i < count; i++) {
    const key = `${Math.floor(xs[i] / CELL)},${Math.floor(ys[i] / CELL)}`;
    const cell = buckets.get(key);
    if (cell) cell.push(i);
    else buckets.set(key, [i]);
  }

  return { origin: file.origin, count, xs, ys, first, target, metres, buckets, edges: total / 2 };
}

// Nearest node to a point, and how far off-graph that point is. Rings outward a
// cell at a time and only stops once the ring it is about to search cannot hold
// anything closer than what it already has -- stopping at the first hit finds a
// node in the corner of the home cell and misses a nearer one just over the
// edge of it.
export function snap(graph, x, y, radius = SNAP_RADIUS) {
  const cx = Math.floor(x / CELL);
  const cy = Math.floor(y / CELL);
  let best = -1;
  let bestMetres = Infinity;
  for (let ring = 0; ring * CELL <= radius + CELL; ring++) {
    if (best !== -1 && bestMetres <= ring * CELL) break;
    for (let dx = -ring; dx <= ring; dx++) {
      for (let dy = -ring; dy <= ring; dy++) {
        if (ring > 0 && Math.abs(dx) !== ring && Math.abs(dy) !== ring) continue;
        for (const i of graph.buckets.get(`${cx + dx},${cy + dy}`) ?? []) {
          const d = Math.hypot(graph.xs[i] - x, graph.ys[i] - y);
          if (d < bestMetres) {
            bestMetres = d;
            best = i;
          }
        }
      }
    }
  }
  return best !== -1 && bestMetres <= radius ? { node: best, metres: bestMetres } : null;
}

// Dijkstra from one node, abandoned past `ceiling` metres.
//
// A pair of parallel arrays is the heap: a priority queue of objects allocates
// once per push and this pushes a few thousand times. The ceiling is there for
// a caller that wants one, and js/app.js passes Infinity, because the file is
// already pruned to what a door can reach and a second bound would leave the
// far rows of the buildings picker on a different walk model from the near
// ones. Settling all 5,242 nodes is the whole graph and costs about a
// millisecond.
function field(graph, from, ceiling) {
  const dist = new Float64Array(graph.count).fill(Infinity);
  const heapDist = [];
  const heapNode = [];

  const push = (d, v) => {
    heapDist.push(d);
    heapNode.push(v);
    let i = heapDist.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heapDist[p] <= heapDist[i]) break;
      [heapDist[p], heapDist[i]] = [heapDist[i], heapDist[p]];
      [heapNode[p], heapNode[i]] = [heapNode[i], heapNode[p]];
      i = p;
    }
  };

  const pop = () => {
    const d = heapDist[0];
    const v = heapNode[0];
    const lastD = heapDist.pop();
    const lastV = heapNode.pop();
    if (heapDist.length) {
      heapDist[0] = lastD;
      heapNode[0] = lastV;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < heapDist.length && heapDist[l] < heapDist[m]) m = l;
        if (r < heapDist.length && heapDist[r] < heapDist[m]) m = r;
        if (m === i) break;
        [heapDist[m], heapDist[i]] = [heapDist[i], heapDist[m]];
        [heapNode[m], heapNode[i]] = [heapNode[i], heapNode[m]];
        i = m;
      }
    }
    return [d, v];
  };

  dist[from.node] = from.metres;
  push(from.metres, from.node);
  while (heapDist.length) {
    const [d, v] = pop();
    if (d > dist[v]) continue;
    if (d > ceiling) break;
    for (let k = graph.first[v]; k < graph.first[v + 1]; k++) {
      const u = graph.target[k];
      const step = d + graph.metres[k];
      if (step < dist[u]) {
        dist[u] = step;
        push(step, u);
      }
    }
  }
  return dist;
}

// Where every door in the term's building table sits on the graph, worked out
// once when the file lands rather than on every question. A building whose
// doors are all further than SNAP_RADIUS from a path -- none are, on the
// committed data -- simply has no routed distance and takes the fallback.
export function createRouter(graph, buildings) {
  if (!graph) return null;

  const landings = new Map();
  for (const [code, building] of Object.entries(buildings ?? {})) {
    const base = toPlane(graph.origin, building.lat, building.lon);
    const doors = building.d ?? [];
    const points = doors.length
      ? Array.from({ length: doors.length / 2 }, (_, i) => ({
          x: base.x + doors[i * 2],
          y: base.y + doors[i * 2 + 1],
        }))
      : [base];
    const onGraph = [];
    for (const point of points) {
      const hit = snap(graph, point.x, point.y);
      if (hit) onGraph.push(hit);
    }
    if (onGraph.length) landings.set(code, onGraph);
  }

  return {
    graph,
    covers: landings.size,

    // The walk from one standing point, as a thing you ask about buildings.
    // Returns null when the point is not near a path at all, which is the
    // caller's signal to use the straight-line estimate for EVERY building
    // rather than mixing two models inside one ranking.
    from(lat, lon, ceiling) {
      const here = toPlane(graph.origin, lat, lon);
      const start = snap(graph, here.x, here.y);
      if (!start) return null;
      const dist = field(graph, start, ceiling);
      // Routed metres to somewhere on the graph, plus the last few metres off
      // it. Null is not zero and is not "close": it means the graph could not
      // get there inside the ceiling, and the caller falls back.
      const reach = (onGraph) => {
        let best = Infinity;
        for (const { node, metres } of onGraph) {
          const total = dist[node] + metres;
          if (total < best) best = total;
        }
        return Number.isFinite(best) ? best : null;
      };

      return {
        offGraphMetres: start.metres,
        // What the app asks: the nearest door of a building.
        metresTo(code) {
          const onGraph = landings.get(code);
          return onGraph ? reach(onGraph) : null;
        },
        // The same question about a bare point in the plane. The app has no use
        // for it -- every walk it quotes ends at a door -- and
        // docs/research/walking-graph-sample.mjs does, because OSU's own router
        // can only be given a building's published point to compare against.
        metresToPoint(point) {
          const hit = snap(graph, point.x, point.y);
          return hit ? reach([hit]) : null;
        },
      };
    },
  };
}
