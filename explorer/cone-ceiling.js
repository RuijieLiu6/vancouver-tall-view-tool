(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ConeCeiling = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // These are supplied study planes, not verified policy height surfaces.
  const finite = value => typeof value === "number" && Number.isFinite(value);
  const xy = p => Array.isArray(p) && finite(p[0]) && finite(p[1]);
  const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const same = (a, b, eps) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= eps;
  function tolerance(points) {
    const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
    const scale = Math.max(1, Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    return {linear: scale * 1e-10, area: scale * scale * 1e-12};
  }
  function signedArea(p) {
    // Translate before summing to avoid cancellation at large model origins.
    let sum = 0;
    for (let i = 1; i + 1 < p.length; i++) sum += cross(p[0], p[i], p[i + 1]);
    return sum / 2;
  }
  function onSegment(a, b, p, tol) {
    return Math.abs(cross(a, b, p)) <= tol.area &&
      p[0] >= Math.min(a[0], b[0]) - tol.linear && p[0] <= Math.max(a[0], b[0]) + tol.linear &&
      p[1] >= Math.min(a[1], b[1]) - tol.linear && p[1] <= Math.max(a[1], b[1]) + tol.linear;
  }
  function intersects(a, b, c, d, tol) {
    const u = cross(a, b, c), v = cross(a, b, d), w = cross(c, d, a), z = cross(c, d, b);
    if (((u > tol.area && v < -tol.area) || (v > tol.area && u < -tol.area)) &&
        ((w > tol.area && z < -tol.area) || (z > tol.area && w < -tol.area))) return true;
    return onSegment(a, b, c, tol) || onSegment(a, b, d, tol) || onSegment(c, d, a, tol) || onSegment(c, d, b, tol);
  }
  function polygon(value, convex) {
    if (!Array.isArray(value) || value.length < 3 || !value.every(xy)) return null;
    let p = value.map(q => q.slice(0, 2));
    const tol = tolerance(p);
    if (same(p[0], p[p.length - 1], tol.linear)) p.pop();
    p = p.filter((q, i) => !i || !same(q, p[i - 1], tol.linear));
    if (p.length < 3 || Math.abs(signedArea(p)) <= tol.area) return null;
    for (let i = 0; i < p.length; i++) for (let j = i + 1; j < p.length; j++) {
      if (j === i + 1 || (i === 0 && j === p.length - 1)) continue;
      if (intersects(p[i], p[(i + 1) % p.length], p[j], p[(j + 1) % p.length], tol)) return null;
    }
    if (signedArea(p) < 0) p.reverse();
    if (convex && p.some((q, i) => cross(q, p[(i + 1) % p.length], p[(i + 2) % p.length]) < -tol.area)) return null;
    return p;
  }
  function footprint(value) {
    const area = polygon(value, false);
    if (area) return area;
    if (!Array.isArray(value) || value.length < 3 || !value.every(xy)) return null;
    const points = value.map(p => p.slice(0, 2)), tol = tolerance(points);
    let a = points[0], b = a, longest = 0;
    for (const p of points) for (const q of points) {
      const length = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (length > longest) { a = p; b = q; longest = length; }
    }
    // Valid vertical mesh parts collapse to a segment or point in plan. Other
    // invalid polygons must still never fall back to a point-only check.
    if (points.some(p => Math.abs(cross(a, b, p)) > tol.area)) return null;
    return longest <= tol.linear ? [a] : [a, b];
  }
  function clipLine(triangle, line) {
    const a = line[0], b = line[line.length - 1], tol = tolerance(triangle.concat(line));
    let lo = 0, hi = 1;
    for (let i = 0; i < 3; i++) {
      const p = triangle[i], q = triangle[(i + 1) % 3], da = cross(p, q, a), db = cross(p, q, b);
      if (da < -tol.area && db < -tol.area) return [];
      if (da < -tol.area) lo = Math.max(lo, da / (da - db));
      else if (db < -tol.area) hi = Math.min(hi, da / (da - db));
      if (lo > hi) return [];
    }
    const at = t => [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
    return same(at(lo), at(hi), tol.linear) ? [at(lo)] : [at(lo), at(hi)];
  }
  function insideTriangle(p, a, b, c, eps) {
    return cross(a, b, p) >= -eps && cross(b, c, p) >= -eps && cross(c, a, p) >= -eps;
  }
  function triangulate(input) {
    const p = input.slice(), triangles = [], tol = tolerance(p);
    // Remove collinear boundary vertices; the retained edges still include contacts.
    let changed = true;
    while (changed && p.length > 3) {
      changed = false;
      for (let i = 0; i < p.length; i++) {
        if (onSegment(p[(i + p.length - 1) % p.length], p[(i + 1) % p.length], p[i], tol)) {
          p.splice(i, 1); changed = true; break;
        }
      }
    }
    while (p.length > 3) {
      let found = false;
      for (let i = 0; i < p.length; i++) {
        const a = p[(i + p.length - 1) % p.length], b = p[i], c = p[(i + 1) % p.length];
        if (cross(a, b, c) <= tol.area) continue;
        if (p.some(q => q !== a && q !== b && q !== c && insideTriangle(q, a, b, c, tol.area))) continue;
        triangles.push([a, b, c]); p.splice(i, 1); found = true; break;
      }
      if (!found) return null;
    }
    triangles.push(p);
    return triangles;
  }
  function clip(triangle, footprint) {
    let result = triangle;
    const tol = tolerance(triangle.concat(footprint));
    for (let i = 0; i < footprint.length && result.length; i++) {
      const a = footprint[i], b = footprint[(i + 1) % footprint.length], next = [];
      for (let j = 0; j < result.length; j++) {
        const s = result[j], e = result[(j + 1) % result.length];
        const ds = cross(a, b, s), de = cross(a, b, e), si = ds >= -tol.area, ei = de >= -tol.area;
        if (si !== ei) {
          const t = ds / (ds - de);
          next.push([s[0] + t * (e[0] - s[0]), s[1] + t * (e[1] - s[1])]);
        }
        if (ei) next.push(e);
      }
      result = next.filter((p, j) => !j || !same(p, next[j - 1], tol.linear));
      if (result.length > 1 && same(result[0], result[result.length - 1], tol.linear)) result.pop();
    }
    return result;
  }
  // Subtract a convex cutter without sampling. Each outside half-plane is
  // emitted once; the remaining inside region is passed to the next edge.
  // Closed half-planes retain hole boundary contacts in the occupied closure.
  function subtractConvex(subject, cutter) {
    let inside = subject;
    const outside = [], tol = tolerance(subject.concat(cutter));
    function half(points, a, b, sign) {
      const out = [];
      for (let i = 0; i < points.length; i++) {
        const s = points[i], e = points[(i + 1) % points.length];
        const ds = sign * cross(a, b, s), de = sign * cross(a, b, e);
        const si = ds >= -tol.area, ei = de >= -tol.area;
        if (si !== ei) { const t = ds / (ds - de); out.push([s[0] + t * (e[0] - s[0]), s[1] + t * (e[1] - s[1])]); }
        if (ei) out.push(e);
      }
      return out;
    }
    for (let i = 0; i < cutter.length && inside.length; i++) {
      const a = cutter[i], b = cutter[(i + 1) % cutter.length];
      const part = half(inside, a, b, -1);
      if (part.length >= 3 && Math.abs(signedArea(part)) > tol.area) outside.push(part);
      inside = half(inside, a, b, 1);
    }
    return outside;
  }
  function ringsMeet(a, b) {
    const tol = tolerance(a.concat(b));
    return a.some((p, i) => b.some((q, j) => intersects(p, a[(i + 1) % a.length], q, b[(j + 1) % b.length], tol)));
  }
  function polygonPieces(raw) {
    if (!Array.isArray(raw) || !raw.length) return null;
    const rings = raw.map(r => polygon(r, false));
    if (rings.some(r => !r)) return null;
    const [outer, ...holes] = rings;
    for (let i = 0; i < holes.length; i++) {
      const h = holes[i];
      if (ringsMeet(outer, h) || !contains(outer, h[0])) return null;
      for (let j = 0; j < i; j++) if (ringsMeet(h, holes[j]) || contains(h, holes[j][0]) || contains(holes[j], h[0])) return null;
    }
    let pieces = triangulate(outer);
    if (!pieces) return null;
    // A deterministic budget prevents pathological supplied topology from
    // monopolizing the browser; failure stays unresolved, never point-sampled.
    let work = 0;
    for (const hole of holes) {
      const cutters = triangulate(hole);
      if (!cutters) return null;
      for (const cutter of cutters) {
        const next = [];
        for (const piece of pieces) {
          work += piece.length * cutter.length;
          if (work > 1000000) return null;
          next.push(...subtractConvex(piece, cutter));
        }
        pieces = next;
      }
    }
    return pieces;
  }
  function footprintPieces(value) {
    if (value && value.type === 'Polygon') return polygonPieces(value.coordinates);
    if (value && value.type === 'MultiPolygon') {
      if (!Array.isArray(value.coordinates) || !value.coordinates.length) return null;
      const parts = value.coordinates.map(polygonPieces);
      return parts.some(p => !p) ? null : parts.flat();
    }
    const f = footprint(Array.isArray(value) ? value : value && (value.points || value.polygon_model_xy));
    return !f ? null : f.length < 3 ? [f] : triangulate(f);
  }
  function contains(polygon, point) {
    const tol = tolerance(polygon);
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const a = polygon[j], b = polygon[i];
      if (onSegment(a, b, point, tol)) return true;
      if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    return inside;
  }
  function planeFunction(plane) {
    if (!plane || !xy(plane.origin) || !finite(plane.observerElevationM) ||
        !finite(plane.bearingDeg) || !finite(plane.pitchDeg) || Math.abs(plane.pitchDeg) >= 89) return null;
    const rad = Math.PI / 180, slope = Math.tan(plane.pitchDeg * rad);
    const dx = Math.sin(plane.bearingDeg * rad) * slope, dy = Math.cos(plane.bearingDeg * rad) * slope;
    return p => plane.observerElevationM + (p[0] - plane.origin[0]) * dx + (p[1] - plane.origin[1]) * dy;
  }
  function evaluate(options) {
    const o = options || {}, output = {status: "no_site", ceilingElevationM: null, maxHeightM: null,
      clearanceM: null, limitingView: null, limitingPoint: null, patches: [], missingViews: [], overlappingViews: []};
    const supplied = Array.isArray(o.footprints) ? o.footprints : [];
    const prepared = supplied.map(footprintPieces);
    if (o.polygons !== undefined) prepared.push(footprintPieces({type: 'MultiPolygon', coordinates: o.polygons}));
    if (prepared.some(p => !p)) return output;
    const footprints = prepared.flat();
    // An invalid supplied footprint must not silently become a point-only check.
    if (footprints.some(f => !f) || (!footprints.length && !xy(o.point))) return output;
    const point = xy(o.point) ? o.point.slice(0, 2) : null;
    let minimum = null;
    for (const cone of Array.isArray(o.cones) ? o.cones : []) {
      const ring = polygon(cone && cone.polygon_model_xy, false);
      const view = cone && cone.view_number;
      // Malformed geometry cannot establish whether a site is outside a cone.
      if (!ring) { output.missingViews.push(view); continue; }
      const triangles = triangulate(ring);
      if (!triangles) { output.missingViews.push(view); continue; }
      const pieces = footprints.length ? footprints.flatMap(f => triangles.map(t => f.length < 3 ? clipLine(t, f) : clip(t, f)).filter(p => p.length)) : (contains(ring, point) ? [[point]] : []);
      if (!pieces.length) continue;
      output.overlappingViews.push(view);
      const plane = o.planes instanceof Map ? o.planes.get(view) : o.planes && o.planes[view];
      const elevationAt = planeFunction(plane);
      if (!elevationAt) { output.missingViews.push(view); continue; }
      for (const piece of pieces) {
        const elevations = piece.map(elevationAt);
        if (!elevations.every(finite)) { output.missingViews.push(view); continue; }
        for (let i = 0; i < piece.length; i++) if (minimum === null || elevations[i] < minimum) {
          minimum = elevations[i]; output.limitingView = view; output.limitingPoint = piece[i].slice();
        }
        if (finite(o.datumOffsetM) && elevations.every(z => finite(z - o.datumOffsetM))) {
          output.patches.push({view, points: piece.map((p, i) => [p[0], p[1], elevations[i] - o.datumOffsetM])});
        }
      }
    }
    output.missingViews = [...new Set(output.missingViews)];
    output.overlappingViews = [...new Set(output.overlappingViews)];
    output.status = minimum !== null ? (output.missingViews.length ? "partial" : "ready") :
      output.missingViews.length ? "unknown" : "outside";
    output.ceilingElevationM = minimum;
    if (minimum !== null && finite(o.datumOffsetM)) {
      const z = minimum - o.datumOffsetM;
      if (finite(o.groundModelZ) && finite(z - o.groundModelZ)) output.maxHeightM = z - o.groundModelZ;
      if (finite(o.proposalTopModelZ) && finite(z - o.proposalTopModelZ)) output.clearanceM = z - o.proposalTopModelZ;
    }
    return output;
  }
  return {evaluate};
});
