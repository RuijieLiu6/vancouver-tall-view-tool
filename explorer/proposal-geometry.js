/* Pure geometry for a rectangular proposal part in model coordinates (metres, Z up).
 * Positive rotation is clockwise when viewed from above (+X turns toward -Y).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ProposalGeometry = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const triangles = new Uint32Array([
    0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7,
    0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5,
    2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7,
  ]);
  const edgePairs = [
    [0, 1], [1, 2], [2, 3], [3, 0],
    [4, 5], [5, 6], [6, 7], [7, 4],
    [0, 4], [1, 5], [2, 6], [3, 7],
  ];

  function makePart({ name, cx, cy, zMin, zMax, w, d, rotation = 0 }) {
    if (![cx, cy, zMin, zMax, w, d, rotation].every(Number.isFinite) ||
        w <= 0 || d <= 0 || zMax <= zMin) {
      throw new Error('Proposal part needs finite coordinates, positive width, depth and height.');
    }
    const angle = rotation * Math.PI / 180;
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const local = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]];
    const footprint = local.map(([x, y]) => [cx + x * cos + y * sin, cy - x * sin + y * cos]);
    // Four plan corners at the base, followed by matching corners at the top.
    const pos = new Float32Array(24);
    for (let i = 0; i < 4; i++) {
      pos.set([footprint[i][0], footprint[i][1], zMin], i * 3);
      pos.set([footprint[i][0], footprint[i][1], zMax], (i + 4) * 3);
    }
    const edges = new Float32Array(edgePairs.length * 6);
    for (let i = 0; i < edgePairs.length; i++) {
      const [a, b] = edgePairs[i];
      edges.set(pos.subarray(a * 3, a * 3 + 3), i * 6);
      edges.set(pos.subarray(b * 3, b * 3 + 3), i * 6 + 3);
    }
    const xs = footprint.map(p => p[0]), ys = footprint.map(p => p[1]);
    const box = [Math.min(...xs), Math.min(...ys), zMin, Math.max(...xs), Math.max(...ys), zMax];
    return { name, rotation, footprint, box, pos, idx: triangles, edges };
  }

  function signedArea(points) {
    if (points.length < 3) return 0;
    const o = points[0];
    let twice = 0;
    for (let i = 1; i < points.length - 1; i++) {
      twice += (points[i][0] - o[0]) * (points[i + 1][1] - o[1]) -
        (points[i][1] - o[1]) * (points[i + 1][0] - o[0]);
    }
    return twice / 2;
  }

  function cross(a, b, p) {
    return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  }

  // Intersect any simple subject polygon (including a concave City polygon)
  // with a convex clip footprint. Vertices may run in either winding direction.
  function planOverlap(subjectPolygon, convexFootprint) {
    for (const polygon of [subjectPolygon, convexFootprint]) {
      if (!Array.isArray(polygon) || polygon.length < 3 ||
          polygon.some(p => !Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite))) {
        throw new Error('Plan overlap needs polygons of finite XY coordinate pairs.');
      }
    }
    const winding = Math.sign(signedArea(convexFootprint));
    if (winding === 0) throw new Error('Clip footprint must have positive area.');
    let clipped = subjectPolygon.slice();
    for (let i = 0; i < convexFootprint.length; i++) {
      const a = convexFootprint[i], b = convexFootprint[(i + 1) % convexFootprint.length];
      const edgeLength = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const crossEpsilon = edgeLength * 1e-9;
      const input = clipped;
      clipped = [];
      if (!input.length) break;
      for (let j = 0; j < input.length; j++) {
        const p = input[j], q = input[(j + 1) % input.length];
        const dp = winding * cross(a, b, p), dq = winding * cross(a, b, q);
        const insideP = dp >= -crossEpsilon, insideQ = dq >= -crossEpsilon;
        if (insideP !== insideQ) {
          const t = Math.max(0, Math.min(1, dp / (dp - dq)));
          clipped.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]);
        }
        if (insideQ) clipped.push(q);
      }
    }
    const area = Math.abs(signedArea(clipped));
    const coordinates = subjectPolygon.concat(convexFootprint);
    const extent = Math.max(1,
      Math.max(...coordinates.map(p => p[0])) - Math.min(...coordinates.map(p => p[0])),
      Math.max(...coordinates.map(p => p[1])) - Math.min(...coordinates.map(p => p[1])));
    const areaEpsilon = Math.max(1e-10, extent * extent * 1e-15);
    return { area: area > areaEpsilon ? area : 0,
      relation: area > areaEpsilon ? 'overlap' : clipped.length ? 'touch' : 'none' };
  }

  return { makePart, planOverlap };
});
