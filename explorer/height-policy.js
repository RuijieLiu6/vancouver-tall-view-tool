(function (root, factory) {
  const api = factory(typeof module === "object" && module.exports ? require("./cone-ceiling.js") : root && root.ConeCeiling);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.HeightPolicy = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (coneCeiling) {
  "use strict";

  // Sourced basic schedule references only. These are not complete permissions
  // to build: use, grade definitions, exceptions and discretionary rules remain.
  const finite = n => typeof n === "number" && Number.isFinite(n);
  // The exact sweep below compares edge crossings and then checks every open
  // slab. A large study footprint can meet thousands of zoning polygons, so
  // reject an unprovable coverage calculation before quadratic/cubic work.
  const MAX_COVERAGE_WORK = 3_000_000;
  const xy = p => Array.isArray(p) && finite(p[0]) && finite(p[1]);
  const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const area = p => p.slice(1, -1).reduce((s, q, i) => s + cross(p[0], q, p[i + 2]), 0) / 2;
  const same = (a, b) => a[0] === b[0] && a[1] === b[1];
  function ring(raw) {
    if (!Array.isArray(raw) || !raw.length || !raw.every(xy)) return null;
    const p = raw.map(q => q.slice(0, 2)).filter((q, i, a) => !i || !same(q, a[i - 1]));
    if (p.length > 1 && same(p[0], p[p.length - 1])) p.pop();
    return p;
  }
  function box(points) {
    const b = [Infinity, Infinity, -Infinity, -Infinity];
    for (const p of points) { b[0] = Math.min(b[0], p[0]); b[1] = Math.min(b[1], p[1]); b[2] = Math.max(b[2], p[0]); b[3] = Math.max(b[3], p[1]); }
    return b;
  }
  const boxesMeet = (a, b) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
  function onSegment(a, b, p) {
    const error = Number.EPSILON * 16 * (Math.abs((b[0] - a[0]) * (p[1] - a[1])) + Math.abs((b[1] - a[1]) * (p[0] - a[0])) + 1);
    return Math.abs(cross(a, b, p)) <= error && p[0] >= Math.min(a[0], b[0]) && p[0] <= Math.max(a[0], b[0]) && p[1] >= Math.min(a[1], b[1]) && p[1] <= Math.max(a[1], b[1]);
  }
  // 0 outside, 1 interior, 2 boundary; hole boundaries are conservative contacts.
  function inRing(p, r) {
    let inside = false;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const a = r[j], b = r[i];
      if (onSegment(a, b, p)) return 2;
      if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < a[0] + (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1])) inside = !inside;
    }
    return inside ? 1 : 0;
  }
  function inPolygon(p, rings) {
    const outer = inRing(p, rings[0]);
    if (!outer) return false;
    if (outer === 2) return true;
    for (const h of rings.slice(1)) { const state = inRing(p, h); if (state === 2) return true; if (state === 1) return false; }
    return true;
  }
  const edges = p => p.length === 1 ? [[p[0], p[0]]] : p.map((q, i) => [q, p[(i + 1) % p.length]]);
  function crossing(a, b, c, d) {
    const dx = b[0] - a[0], dy = b[1] - a[1], ex = d[0] - c[0], ey = d[1] - c[1];
    const den = dx * ey - dy * ex;
    if (!den) return null;
    const t = ((c[0] - a[0]) * ey - (c[1] - a[1]) * ex) / den;
    const u = ((c[0] - a[0]) * dy - (c[1] - a[1]) * dx) / den;
    return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? [a[0] + t * dx, a[1] + t * dy] : null;
  }
  function segmentsMeet(a, b, c, d) {
    return !!crossing(a, b, c, d) || onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b);
  }
  function intersectsFootprint(f, polygon) {
    if (f.length === 1) return inPolygon(f[0], polygon);
    if (f.some(p => inPolygon(p, polygon))) return true;
    if (f.length >= 3 && polygon[0].some(p => inRing(p, f))) return true;
    const fe = edges(f);
    return polygon.some(r => edges(r).some(([c, d]) => fe.some(([a, b]) => segmentsMeet(a, b, c, d))));
  }
  function normalizeFootprint(raw) {
    const p = ring(Array.isArray(raw) ? raw : raw && (raw.points || raw.polygon_model_xy));
    if (!p || !p.length || !finite(area(p))) return null;
    if (p.length < 3 || area(p) === 0) {
      let a = p[0], b = a, distance = 0;
      for (const q of p) for (const r of p) { const d = Math.hypot(q[0] - r[0], q[1] - r[1]); if (d > distance) { distance = d; a = q; b = r; } }
      if (p.some(q => !onSegment(a, b, q))) return null;
      return distance ? [a, b] : [a];
    }
    const es = edges(p);
    for (let i = 0; i < es.length; i++) for (let j = i + 1; j < es.length; j++) {
      if (j === i + 1 || (i === 0 && j === es.length - 1)) continue;
      if (segmentsMeet(...es[i], ...es[j])) return null;
    }
    return area(p) < 0 ? p.reverse() : p;
  }
  function mergeIntervals(intervals) {
    const out = [];
    for (const v of intervals.sort((a, b) => a[0] - b[0])) {
      const last = out[out.length - 1];
      if (last && v[0] <= last[1]) last[1] = Math.max(last[1], v[1]); else out.push(v.slice());
    }
    return out;
  }
  function vertical(r, x) {
    const y = [];
    for (const [a, b] of edges(r)) if ((a[0] > x) !== (b[0] > x)) y.push(a[1] + (x - a[0]) * (b[1] - a[1]) / (b[0] - a[0]));
    y.sort((a, b) => a - b);
    const out = [];
    for (let i = 0; i + 1 < y.length; i += 2) out.push([y[i], y[i + 1]]);
    return out;
  }
  function polygonIntervals(polygon, x) {
    let out = vertical(polygon[0], x);
    for (const h of polygon.slice(1)) for (const [lo, hi] of vertical(h, x)) {
      out = out.flatMap(([a, b]) => hi <= a || lo >= b ? [[a, b]] : [[a, Math.min(b, lo)], [Math.max(a, hi), b]].filter(([c, d]) => d > c));
    }
    return out;
  }
  function coveredLine(f, polygons) {
    const a = f[0], b = f[f.length - 1], ts = [0, 1], dx = b[0] - a[0], dy = b[1] - a[1];
    const tAt = p => Math.abs(dx) >= Math.abs(dy) ? (p[0] - a[0]) / dx : (p[1] - a[1]) / dy;
    for (const poly of polygons) for (const r of poly) for (const [c, d] of edges(r)) {
      const p = crossing(a, b, c, d); if (p) ts.push(tAt(p));
      if (onSegment(a, b, c)) ts.push(tAt(c)); if (onSegment(a, b, d)) ts.push(tAt(d));
    }
    const at = t => [a[0] + t * dx, a[1] + t * dy];
    ts.sort((a, b) => a - b);
    return ts.every(t => polygons.some(p => inPolygon(at(t), p))) && ts.slice(1).every((t, i) => polygons.some(p => inPolygon(at((ts[i] + t) / 2), p)));
  }
  function fullyCovered(f, polygons, budget) {
    if (!polygons.length) return false;
    if (f.length === 1) return polygons.some(p => inPolygon(f[0], p));
    const bounds = box(f), all = [f].concat(polygons.flat());
    const totalVertices = all.reduce((sum, ring) => sum + ring.length, 0);
    const es = all.flatMap(edges).filter(e => boxesMeet(box(e), bounds));
    const xs = [bounds[0], bounds[2]];
    for (const r of all) for (const p of r) if (p[0] > bounds[0] && p[0] < bounds[2]) xs.push(p[0]);
    // Only edges meeting this footprint can create sweep cuts. Slab checks
    // still traverse the entire nearby polygon rings, so include those in the
    // bound without treating distant ring vertices as crossing candidates.
    const localPairs = es.length ** 2;
    const holeCount = polygons.reduce((sum, polygon) => sum + Math.max(0, polygon.length - 1), 0);
    const estimatedWork = totalVertices + localPairs + (2 + holeCount) * (xs.length + localPairs) * totalVertices;
    if (!Number.isSafeInteger(estimatedWork) || estimatedWork > budget.remaining) return null;
    budget.remaining -= estimatedWork;
    if (f.length === 2) return coveredLine(f, polygons);
    for (let i = 0; i < es.length; i++) for (let j = i + 1; j < es.length; j++) {
      if (!boxesMeet(box(es[i]), box(es[j]))) continue;
      const p = crossing(...es[i], ...es[j]);
      if (p && p[0] > bounds[0] && p[0] < bounds[2]) xs.push(p[0]);
    }
    const cuts = [...new Set(xs)].sort((a, b) => a - b);
    // Every edge-order change is a cut. A midpoint in each open slab therefore
    // proves union coverage over the whole area, including concavities and holes.
    for (let i = 1; i < cuts.length; i++) {
      const x = cuts[i - 1] + (cuts[i] - cuts[i - 1]) / 2;
      // Adjacent floating-point coordinates have no representable open slab.
      if (x === cuts[i - 1] || x === cuts[i]) continue;
      const covered = mergeIntervals(polygons.flatMap(p => polygonIntervals(p, x)));
      for (const [lo, hi] of vertical(f, x)) if (!covered.some(([a, b]) => a <= lo && b >= hi)) return false;
    }
    return true;
  }
  function triangles(p) {
    if (p.length < 3) return [p.length === 1 ? [p[0], p[0], p[0]] : [p[0], p[1], p[1]]];
    const work = p.slice(), out = [];
    // Remove redundant collinear vertices before ear clipping.
    let changed = true;
    while (changed && work.length > 3) {
      changed = false;
      for (let i = 0; i < work.length; i++) if (onSegment(work[(i + work.length - 1) % work.length], work[(i + 1) % work.length], work[i])) { work.splice(i, 1); changed = true; break; }
    }
    while (work.length > 3) {
      let found = false;
      for (let i = 0; i < work.length; i++) {
        const a = work[(i + work.length - 1) % work.length], b = work[i], c = work[(i + 1) % work.length];
        if (cross(a, b, c) <= 0) continue;
        if (work.some(q => q !== a && q !== b && q !== c && cross(a, b, q) >= 0 && cross(b, c, q) >= 0 && cross(c, a, q) >= 0)) continue;
        out.push([a, b, c]); work.splice(i, 1); found = true; break;
      }
      if (!found) return null;
    }
    out.push(work); return out;
  }
  function create(dataset) {
    const data = dataset || {}, rules = data.rules || {}, grid = new Map(), large = [], cell = 250;
    const zones = (Array.isArray(data.zones) ? data.zones : []).map(source => {
      const polygons = (Array.isArray(source.polygons) ? source.polygons : []).map(poly => Array.isArray(poly) ? poly.map(ring) : []);
      const valid = polygons.length && polygons.every(poly => poly.length && poly.every(r => r && r.length >= 3 && finite(area(r)) && area(r) !== 0));
      const points = polygons.flat(2).filter(xy);
      const bounds = points.length ? box(points) : Array.isArray(source.bbox) && source.bbox.length === 4 && source.bbox.every(finite) ? source.bbox.slice() : null;
      return {source, polygons, valid, bounds};
    });
    zones.forEach((z, index) => {
      if (!z.bounds) { large.push(index); return; }
      const b = z.bounds.map(v => Math.floor(v / cell));
      if (!b.every(Number.isSafeInteger) || (b[2] - b[0] + 1) * (b[3] - b[1] + 1) > 4096) { large.push(index); return; }
      for (let x = b[0]; x <= b[2]; x++) for (let y = b[1]; y <= b[3]; y++) { const key = x + "," + y; if (!grid.has(key)) grid.set(key, []); grid.get(key).push(index); }
    });
    function candidates(bounds) {
      const b = bounds.map(v => Math.floor(v / cell)), ids = new Set(large);
      if (!b.every(Number.isSafeInteger) || (b[2] - b[0] + 1) * (b[3] - b[1] + 1) > 10000) return zones.filter(z => !z.bounds || boxesMeet(z.bounds, bounds));
      for (let x = b[0]; x <= b[2]; x++) for (let y = b[1]; y <= b[3]; y++) for (const i of grid.get(x + "," + y) || []) ids.add(i);
      return [...ids].map(i => zones[i]).filter(z => !z.bounds || boxesMeet(z.bounds, bounds));
    }
    function zoning(footprints) {
      const out = {status: "no_site", zoningStatus: "no_site", zoningHeightM: null, zones: [], ruleIds: [], sources: [], notes: [], requiresReview: true};
      if (!footprints.length || footprints.some(f => !f)) { if (footprints.length) out.notes.push("Invalid footprint geometry; a point cannot replace the full footprint."); return out; }
      const touched = new Set(), cover = [], known = [], notes = new Set(); let unknown = false;
      for (const f of footprints) for (const z of candidates(box(f))) {
        if (!z.valid || z.polygons.some(p => intersectsFootprint(f, p))) touched.add(z);
      }
      for (const z of touched) {
        const rule = rules[z.source.ruleId];
        const height = rule && rule.basicHeightM;
        const sourced = rule && typeof rule.sourceUrl === "string" && /^https?:\/\//.test(rule.sourceUrl);
        if (z.valid) cover.push(...z.polygons);
        if (z.valid && finite(height) && height >= 0 && sourced) known.push(height); else unknown = true;
        if (!z.valid) notes.add("Invalid zoning geometry prevents complete coverage assessment.");
        if (rule && rule.note) notes.add(String(rule.note));
        if (rule && rule.conditions) notes.add(typeof rule.conditions === "string" ? rule.conditions : JSON.stringify(rule.conditions));
      }
      const coveragePolygons = cover.map(polygon => ({polygon, bounds: box(polygon.flat())}));
      const budget = {remaining: MAX_COVERAGE_WORK}; let complexityLimited = false;
      const coverage = footprints.every(f => {
        const bounds = box(f), nearby = coveragePolygons.filter(record => boxesMeet(record.bounds, bounds)).map(record => record.polygon);
        const proved = fullyCovered(f, nearby, budget);
        if (proved === null) complexityLimited = true;
        return proved === true;
      });
      if (!coverage) { unknown = true; if (!complexityLimited) notes.add("Part of the footprint has no mapped zoning coverage."); }
      if (complexityLimited) notes.add("Whole-footprint zoning coverage exceeds the bounded geometry budget; no zoning height is inferred.");
      out.zones = [...touched].map(z => z.source);
      out.ruleIds = [...new Set(out.zones.map(z => z.ruleId).filter(Boolean))];
      out.sources = [...new Set(out.ruleIds.map(id => rules[id] && rules[id].sourceUrl).filter(Boolean))];
      out.status = out.zoningStatus = !unknown && known.length ? "ready" : known.length ? "partial" : "unknown";
      out.zoningHeightM = out.status === "ready" ? Math.min(...known) : null;
      out.coverageComplexityLimited = complexityLimited;
      if (known.length) notes.add("Basic zoning height reference only; applicable use, grade, conditions, exceptions and other controls require review.");
      if (unknown && touched.size) notes.add("Every intersecting zone needs an explicit sourced basic height reference.");
      out.notes = [...notes]; return out;
    }
    function atPoint(point) { return zoning(xy(point) ? [[point.slice(0, 2)]] : []); }
    function evaluate(options) {
      const o = options || {}, supplied = Array.isArray(o.footprints) ? o.footprints : [];
      const footprints = supplied.length ? supplied.map(normalizeFootprint) : xy(o.point) ? [[o.point.slice(0, 2)]] : [];
      const out = zoning(footprints);
      Object.assign(out, {viewStatus: "unknown", viewCeilingElevationM: null, viewHeightM: null, combinedHeightM: null, limitingView: null, missingViews: []});
      if (!footprints.length || footprints.some(f => !f)) return out;
      const convex = footprints.flatMap(f => triangles(f) || [null]);
      const engine = o.coneCeiling || coneCeiling;
      if (!engine || !Array.isArray(o.cones) || !o.cones.length || convex.some(p => !p)) { out.notes.push("Protected-view coverage or calculation inputs are unavailable."); if (out.status === "ready") out.status = "partial"; return out; }
      const view = engine.evaluate({...o, footprints: convex});
      out.viewResult = view;
      out.viewStatus = view.status;
      out.viewCeilingElevationM = view.ceilingElevationM;
      out.viewHeightM = view.maxHeightM;
      out.limitingView = view.limitingView;
      out.missingViews = view.missingViews;
      if (out.zoningHeightM !== null && view.status === "outside") out.combinedHeightM = out.zoningHeightM;
      if (out.zoningHeightM !== null && view.status === "ready" && finite(view.maxHeightM)) out.combinedHeightM = Math.min(out.zoningHeightM, view.maxHeightM);
      if (view.status !== "outside" && !finite(view.maxHeightM)) out.notes.push("A matched vertical datum and ground reference are required for a combined above-ground height.");
      if (out.status === "ready" && out.combinedHeightM === null) out.status = "partial";
      return out;
    }
    return {atPoint, evaluate};
  }
  return {create};
});
