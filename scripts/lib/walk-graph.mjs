// Turn OSU's sidewalk centrelines into the graph the app ships.
//
// Pure. No node:fs, no fetch. scripts/fetch-sidewalks.mjs supplies the features
// and writes the file; scripts/test/walk-graph.test.mjs drives this directly.
//
// Four passes, each of which throws data away on a stated measurement:
//
//   nodeGraph         38,077 drawn vertices -> 19,197 nodes, snapped at 0.5 m
//   largestComponent  15 components -> 1, keeping 96.9% of the nodes
//   contract          18,593 nodes -> 6,069 junctions, chains folded into weights
//   pruneToReach      6,069 -> 5,242, dropping what no door can reach
//
// What survives is 5,242 nodes and 7,977 edges: every junction on campus, and
// how many metres of pavement joins each pair. Not a map. The shape of the path
// between two junctions is gone, because the app quotes a walk and never draws
// one -- #44 settled that the line on the map is a DIRECTION, not a route.

const R = 6371008.8;
const rad = (deg) => (deg * Math.PI) / 180;

// Endpoints that touch are rarely bit-identical in a GIS export, so nodes are
// snapped to a grid. 0.5 m is chosen from both sides: coarser than the ~11 mm
// the fetched geometryPrecision carries, and far finer than the narrowest real
// gap between two distinct sidewalks. Measured on the committed envelope it
// merges 38,077 drawn vertices into 19,197 nodes, which is the shared-endpoint
// ratio a noded network should have.
const SNAP = 0.5;

export function nodeGraph(features, origin) {
  const ids = new Map();
  const xs = [];
  const ys = [];
  const at = (x, y) => {
    const k = `${Math.round(x / SNAP)},${Math.round(y / SNAP)}`;
    let i = ids.get(k);
    if (i === undefined) {
      i = xs.length;
      ids.set(k, i);
      xs.push(x);
      ys.push(y);
    }
    return i;
  };

  const adj = [];
  const join = (a, b, w) => {
    (adj[a] ??= new Map());
    (adj[b] ??= new Map());
    // A pair can be drawn twice, by two features that share both endpoints.
    // Keep the shorter: the longer one is a parallel path nobody would take.
    if (!(adj[a].get(b) <= w)) {
      adj[a].set(b, w);
      adj[b].set(a, w);
    }
  };

  let vertices = 0;
  let segments = 0;
  for (const feature of features) {
    for (const path of feature.geometry?.paths ?? []) {
      let prev = null;
      for (const [lon, lat] of path) {
        // The same equirectangular plane js/engine.js measures in, so a door
        // offset in data/buildings-<term>.json adds straight onto a node here.
        const x = rad(lon - origin.lon) * Math.cos(rad((origin.lat + lat) / 2)) * R;
        const y = rad(lat - origin.lat) * R;
        const id = at(x, y);
        vertices++;
        if (prev !== null && prev !== id) {
          join(prev, id, Math.hypot(x - xs[prev], y - ys[prev]));
          segments++;
        }
        prev = id;
      }
    }
  }

  // Component count is reported rather than computed twice; largestComponent
  // fills it in.
  return { xs, ys, adj, count: xs.length, vertices, segments, components: 0 };
}

export function largestComponent(nodes) {
  const { adj, count } = nodes;
  const seen = new Int32Array(count).fill(-1);
  let best = [];
  let found = 0;
  for (let start = 0; start < count; start++) {
    if (seen[start] !== -1 || !adj[start]) continue;
    const queue = [start];
    seen[start] = found;
    for (let i = 0; i < queue.length; i++) {
      for (const next of adj[queue[i]].keys()) {
        if (seen[next] === -1) {
          seen[next] = found;
          queue.push(next);
        }
      }
    }
    if (queue.length > best.length) best = queue;
    found++;
  }
  nodes.components = found;
  return best;
}

// Fold every degree-2 run into one weighted edge.
//
// A sidewalk centreline is drawn as a chain of short segments -- 23.5 m on
// average -- and every interior vertex of that chain has exactly two
// neighbours. Nothing routes THROUGH such a vertex differently than past it, so
// the whole run collapses to its two ends and the sum of its lengths. 18,593
// nodes become 6,069, and no shortest path changes by a millimetre.
//
// The run is NOT split to keep contracted edges short, which was the obvious
// worry: a standing point snaps onto the graph at a NODE, so a long contracted
// edge with nothing in the middle of it leaves somebody beside the path snapping
// to a junction some way off. It was tried, over the 220 control routes in
// docs/research/walking-routes-115.md, and it buys nothing at all:
//
//     maxEdge        nodes   median err   mean err   inverted   gzipped
//     none            5,242      28.8 m     43.6 m   90 / 990    20.9 KB
//     40 m            7,647      29.7 m     45.7 m   99 / 990    28.0 KB
//     25 m            9,021      28.9 m     44.2 m   92 / 990    31.8 KB
//     15 m           10,764      29.8 m     44.5 m   94 / 990    36.3 KB
//
// Every cap is worse on accuracy and between 34% and 74% larger. The snap leg
// is walked either way, and paying bytes to shorten it does not make the route
// past it any more right.
export function contract(nodes, component, maxEdge = Infinity) {
  const { adj, xs, ys } = nodes;
  const junction = new Uint8Array(nodes.count);
  for (const n of component) if (adj[n].size !== 2) junction[n] = 1;

  // maxEdge exists so the paragraph above can be re-run rather than believed.
  // The shipped build does not pass it. Pinning an extra node whenever a run
  // reaches maxEdge metres keeps a standing point nearer to something it can
  // snap to, at the cost of every node it pins.
  if (Number.isFinite(maxEdge)) {
    for (const start of component) {
      if (!junction[start]) continue;
      for (const first of adj[start].keys()) {
        let prev = start;
        let cur = first;
        let run = adj[start].get(first);
        let guard = 0;
        while (!junction[cur] && guard++ < 100000) {
          const [a, b] = [...adj[cur].keys()];
          const next = a === prev ? b : a;
          const step = adj[cur].get(next);
          if (run + step > maxEdge) {
            junction[cur] = 1;
            run = 0;
          }
          run += step;
          prev = cur;
          cur = next;
        }
      }
    }
  }

  // A closed loop of degree-2 nodes -- a path around a lawn that meets nothing
  // -- has no junction to start from, so the walk below would never enter it.
  // Pin one node on each such ring. Without this the ring silently vanishes.
  const seen = new Uint8Array(nodes.count);
  for (const n of component) {
    if (junction[n] || seen[n]) continue;
    const ring = [n];
    seen[n] = 1;
    let closed = true;
    for (let i = 0; i < ring.length && closed; i++) {
      for (const m of adj[ring[i]].keys()) {
        if (junction[m]) {
          closed = false;
          break;
        }
        if (!seen[m]) {
          seen[m] = 1;
          ring.push(m);
        }
      }
    }
    if (closed) junction[n] = 1;
  }

  const kept = component.filter((n) => junction[n]);
  const index = new Map(kept.map((n, i) => [n, i]));
  const edges = new Map();
  for (const start of kept) {
    for (const first of adj[start].keys()) {
      let prev = start;
      let cur = first;
      let metres = adj[start].get(first);
      // The guard is a loop breaker, not a length limit: a malformed ring that
      // slipped past the pin above would otherwise spin forever.
      let guard = 0;
      while (!junction[cur] && guard++ < 100000) {
        const [a, b] = [...adj[cur].keys()];
        const next = a === prev ? b : a;
        metres += adj[cur].get(next);
        prev = cur;
        cur = next;
      }
      // A chain that returns to where it started is a lollipop stem's loop. It
      // carries no shortest path anything can use, so it is dropped.
      if (cur === start) continue;
      const a = index.get(start);
      const b = index.get(cur);
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      if (!(edges.get(key) <= metres)) edges.set(key, metres);
    }
  }

  const graph = {
    xs: kept.map((n) => xs[n]),
    ys: kept.map((n) => ys[n]),
    adj: kept.map(() => []),
    count: kept.length,
  };
  for (const [key, metres] of edges) {
    const [a, b] = key.split(',').map(Number);
    graph.adj[a].push([b, metres]);
    graph.adj[b].push([a, metres]);
  }
  return graph;
}

// Dijkstra with a ceiling, over the builder's array-of-pairs adjacency. The
// browser runs its own against a typed-array CSR in js/route.js; the test
// asserts the two agree over the encoded graph, which is the only thing that
// makes keeping both honest.
export function reachable(graph, sources, ceiling) {
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

  for (const [node, start] of sources) {
    if (start < dist[node]) {
      dist[node] = start;
      push(start, node);
    }
  }
  while (heapDist.length) {
    const [d, v] = pop();
    if (d > dist[v]) continue;
    if (d > ceiling) break;
    for (const [u, w] of graph.adj[v]) {
      const next = d + w;
      if (next < dist[u]) {
        dist[u] = next;
        push(next, u);
      }
    }
  }
  return dist;
}

const nearestNode = (graph, x, y) => {
  let best = -1;
  let bestSq = Infinity;
  for (let i = 0; i < graph.count; i++) {
    const dx = graph.xs[i] - x;
    const dy = graph.ys[i] - y;
    const sq = dx * dx + dy * dy;
    if (sq < bestSq) {
      bestSq = sq;
      best = i;
    }
  }
  return best;
};

// Drop what no door can reach inside REACH metres of pavement. The envelope is
// square and campus is not: the corners hold sidewalk nobody walking to a
// classroom can use. 827 of 6,069 nodes, 13.6%.
export function pruneToReach(graph, doors, reach) {
  const sources = new Set();
  for (const [x, y] of doors) {
    const node = nearestNode(graph, x, y);
    if (node !== -1) sources.add(node);
  }
  const dist = reachable(graph, [...sources].map((n) => [n, 0]), reach);
  const kept = [];
  for (let i = 0; i < graph.count; i++) if (dist[i] <= reach) kept.push(i);

  const index = new Map(kept.map((n, i) => [n, i]));
  const out = {
    xs: kept.map((n) => graph.xs[n]),
    ys: kept.map((n) => graph.ys[n]),
    adj: kept.map(() => []),
    count: kept.length,
  };
  for (const n of kept) {
    for (const [m, w] of graph.adj[n]) {
      if (!index.has(m)) continue;
      out.adj[index.get(n)].push([index.get(m), w]);
    }
  }
  return out;
}

// A Hilbert curve index, used only to ORDER the nodes before they are written.
// Neighbours in the graph end up neighbours in the file, which is what makes
// both delta-encoded columns small. Measured against the alternatives on the
// committed graph, as the bare binary: row-major bands come out between 18.4
// and 21.0 KB gzipped depending on band height, and this lands at 18.4 KB.
const hilbert = (x, y, side) => {
  let d = 0;
  for (let s = side >> 1; s > 0; s >>= 1) {
    const rx = (x & s) > 0 ? 1 : 0;
    const ry = (y & s) > 0 ? 1 : 0;
    d += s * s * ((3 * rx) ^ ry);
    if (ry === 0) {
      if (rx === 1) {
        x = s - 1 - x;
        y = s - 1 - y;
      }
      [x, y] = [y, x];
    }
  }
  return d;
};

const putVarint = (out, value) => {
  let v = value;
  while (v > 127) {
    out.push((v & 127) | 128);
    v >>>= 7;
  }
  out.push(v);
};
const zigzag = (n) => (n < 0 ? -2 * n - 1 : 2 * n);

// The wire format, which js/route.js decodes in one pass:
//
//   varint            node count
//   node count x      zigzag varint dx, zigzag varint dy   (whole metres)
//   node count x      varint degree, then for each forward neighbour:
//                       varint index delta, varint metres OVER the chord
//
// Two decisions carry the size. Coordinates are stored as deltas along the
// Hilbert order, so a node costs about two bytes instead of the four a 13-bit
// pair would take. And an edge stores its EXCESS over the straight line between
// its two endpoints, which the decoder can compute, rather than its length: a
// contracted sidewalk run is nearly straight, so 5,583 of 7,977 edges -- 70.0%
// -- store a zero. That one change takes the binary from 23.3 KB gzipped to
// 18.4 KB while barely moving its raw size, because what it removes is entropy
// the encoder was paying for rather than bytes.
//
// Whole metres throughout. Rounding an edge costs at most 0.5 m, the errors are
// signed at random, and a 500 m route crosses about twenty of them -- against a
// 78 m walking minute that is noise, and against the 52 m the whole model
// disagrees with OSU's router by it is nothing.
export function encodeGraph(graph) {
  const minX = Math.min(...graph.xs);
  const minY = Math.min(...graph.ys);
  const order = [...graph.xs.keys()].sort(
    (a, b) =>
      hilbert(Math.round((graph.xs[a] - minX) / 4), Math.round((graph.ys[a] - minY) / 4), 1024) -
      hilbert(Math.round((graph.xs[b] - minX) / 4), Math.round((graph.ys[b] - minY) / 4), 1024),
  );
  const at = new Map(order.map((n, i) => [n, i]));
  const qx = order.map((n) => Math.round(graph.xs[n]));
  const qy = order.map((n) => Math.round(graph.ys[n]));

  const out = [];
  putVarint(out, order.length);
  let px = 0;
  let py = 0;
  for (let i = 0; i < order.length; i++) {
    putVarint(out, zigzag(qx[i] - px));
    putVarint(out, zigzag(qy[i] - py));
    px = qx[i];
    py = qy[i];
  }

  let edges = 0;
  for (let i = 0; i < order.length; i++) {
    const forward = graph.adj[order[i]]
      .map(([m, w]) => [at.get(m), w])
      .filter(([j]) => j > i)
      .sort((a, b) => a[0] - b[0]);
    putVarint(out, forward.length);
    let last = i;
    for (const [j, metres] of forward) {
      const chord = Math.hypot(qx[j] - qx[i], qy[j] - qy[i]);
      putVarint(out, j - last);
      putVarint(out, Math.max(0, Math.round(metres - chord)));
      last = j;
      edges++;
    }
  }

  return {
    base64: Buffer.from(out).toString('base64'),
    bytes: out.length,
    edges,
  };
}
