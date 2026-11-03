/* Uniform stacked-block height suggestions from supplied, aligned study surfaces.
 * Geometry is exact over each clipped footprint; this is not a legal height.
 */
(function (root, factory) {
  const geometry = typeof module === 'object' && module.exports ? require('./viewcone-geometry.js') : root.ViewconeGeometry;
  const api = factory(geometry);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ViewHeightSuggestion = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (G) {
  'use strict';
  const VERSION = 'view-height-1';
  const CLEARANCE_M = 0.1;
  const MIN_PART_HEIGHT_M = 1;
  const MAX_WORK = 3000000;
  const finite = v => typeof v === 'number' && Number.isFinite(v);
  const roundRatio = v => Math.round(v * 1e9) / 1e9;
  const clone = v => JSON.parse(JSON.stringify(v));
  const stable = v => v === null || typeof v !== 'object' ? JSON.stringify(v) : Array.isArray(v) ? '[' + v.map(stable).join(',') + ']' : '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
  const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const text = v => { const s = v === undefined || v === null ? '' : String(v); if (s.length > 4096) throw new Error('metadata_limit'); return s; };
  const metadata = v => { if (v === undefined || v === null) return ''; const raw = JSON.stringify(v); if (typeof raw !== 'string' || raw.length > 16000) throw new Error('metadata_limit'); return JSON.parse(raw); };
  const ids = value => { if (Array.isArray(value) && value.length > 512) throw new Error('corridor_id_limit'); return [...new Set((Array.isArray(value) ? value : []).map(text).filter(Boolean))].sort(); };
  const point = p => Array.isArray(p) && p.length >= 2 && p.slice(0, 2).every(finite);
  function failure(status, issue) {
    return {status, maxHeightM: null, currentHeightM: null, targetScale: null, adjustHeightM: null, intrusion: false, controllingView: null, controlPoint: null, clearanceM: CLEARANCE_M, coveredViews: [], missingViews: [], scope: 'site', assumed: true, issues: [issue], cacheKey: null, cacheHit: false};
  }
  function normalise(input) {
    const o = input || {};
    if (o.pmode && o.pmode !== 'boxes') throw new Error('imported_models_cannot_be_height_scaled');
    if (o.ready === false || o.coordinateCompatible === false || !finite(o.baseModelZ)) throw new Error('aligned_site_geometry_required');
    if (!point(o.location && [o.location.x, o.location.y])) throw new Error('selected_location_required');
    if (!Array.isArray(o.parts) || !o.parts.length || o.parts.length > 128) throw new Error('block_part_limit');
    const parts = o.parts.map((p, index) => {
      const fp = p && p.footprint, box = p && p.box, pos = p && (p.pos || p.positions);
      if (!Array.isArray(fp) || fp.length !== 4 || !fp.every(point) || !Array.isArray(box) || box.length !== 6 || !box.every(finite) || box[5] <= box[2]) throw new Error('rectangular_block_geometry_required');
      if (!pos || pos.length !== 24 || !Array.from(pos).every(finite)) throw new Error('actual_block_geometry_required');
      const edges = fp.map((v, i) => [fp[(i + 1) % 4][0] - v[0], fp[(i + 1) % 4][1] - v[1]]);
      const length = edges.map(v => Math.hypot(...v));
      if (length.some(v => v <= 1e-6 || v > 1000)) throw new Error('block_extent_limit');
      const eps = Math.max(...length) * 1e-7;
      if (edges.some((v, i) => Math.abs(v[0] * edges[(i + 1) % 4][0] + v[1] * edges[(i + 1) % 4][1]) > length[i] * length[(i + 1) % 4] * 1e-7) || Math.hypot(edges[0][0] + edges[2][0], edges[0][1] + edges[2][1]) > eps || Math.hypot(edges[1][0] + edges[3][0], edges[1][1] + edges[3][1]) > eps) throw new Error('rectangular_block_geometry_required');
      for (let k = 0; k < 8; k++) {
        const j = k % 4, z = k < 4 ? box[2] : box[5], tolerance = Math.max(0.0001, Math.abs(fp[j][0]) * 1e-7, Math.abs(fp[j][1]) * 1e-7, Math.abs(z) * 1e-7);
        if (Math.hypot(pos[k * 3] - fp[j][0], pos[k * 3 + 1] - fp[j][1], pos[k * 3 + 2] - z) > tolerance * 2) throw new Error('block_footprint_does_not_match_geometry');
      }
      const footprint = fp.map(v => v.slice(0, 2));
      if (cross(footprint[0], footprint[1], footprint[2]) < 0) footprint.reverse();
      return {index, footprint, bottom: box[2], top: box[5]};
    }).sort((a, b) => a.bottom - b.bottom);
    let top = o.baseModelZ;
    for (const p of parts) {
      if (Math.abs(p.bottom - top) > 0.0001 || p.top <= o.baseModelZ) throw new Error('contiguous_stack_required');
      top = p.top;
    }
    const total = top - o.baseModelZ;
    if (!finite(total) || total <= 0 || total > 10000) throw new Error('block_height_limit');
    const all = parts.flatMap(p => p.footprint), xs = all.map(p => p[0]), ys = all.map(p => p[1]);
    if (Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) > 1000) throw new Error('site_extent_limit');
    if (!Array.isArray(o.planes) || o.planes.length > 64) throw new Error('plane_limit');
    let vertices = 0;
    const seen = new Set(), planes = o.planes.map(raw => {
      const id = text(raw && raw.id), p = raw && raw.plane, polygon = raw && raw.polygon;
      if (!id || seen.has(id)) throw new Error('unique_corridor_ids_required');
      seen.add(id);
      if (!p || ![p.a, p.b, p.c].every(finite) || raw.coordinateCompatible === false) throw new Error('aligned_affine_planes_required');
      if (!Array.isArray(polygon) || polygon.length < 3 || polygon.length > 512 || !polygon.every(point)) throw new Error('corridor_polygon_required');
      vertices += polygon.length;
      if (vertices > 8192) throw new Error('corridor_vertex_limit');
      return {id, polygon: polygon.map(v => v.slice(0, 2)), plane: {a: p.a, b: p.b, c: p.c}, source: metadata(raw.source), basis: text(raw.basis), datum: metadata(raw.datum), assumed: raw.assumed === true, revision: metadata({revision: raw.revision, sourceRevision: raw.sourceRevision, polygonRevision: raw.polygonRevision}), coordinateCompatible: raw.coordinateCompatible !== false};
    }).sort((a, b) => a.id.localeCompare(b.id));
    const clearance = o.clearanceM === undefined ? CLEARANCE_M : o.clearanceM;
    if (!finite(clearance) || clearance < 0.01 || clearance > 1) throw new Error('valid_clearance_required');
    const missing = ids(o.missingViews).concat(ids(o.affectingViews).filter(v => !seen.has(v)));
    const shape = parts.map(p => ({footprint: p.footprint, bottomRatio: roundRatio((p.bottom - o.baseModelZ) / total), topRatio: roundRatio((p.top - o.baseModelZ) / total)}));
    const key = stable({version: VERSION, sourceRevision: metadata(o.sourceRevision), location: {x: o.location.x, y: o.location.y}, baseModelZ: o.baseModelZ, minPartHeightM: MIN_PART_HEIGHT_M, shape, planes, missingViews: ids(missing), affectingViews: ids(o.affectingViews), scope: o.scope === 'selected' ? 'selected' : 'site', assumed: o.assumed === true, clearance});
    if (key.length > 500000) throw new Error('cache_key_limit');
    return {parts, planes, base: o.baseModelZ, total, clearance, missing: ids(missing), scope: o.scope === 'selected' ? 'selected' : 'site', assumed: o.assumed === true || planes.some(p => p.assumed || p.basis === 'assumption'), key, persistAllowed: o.persistAllowed === true};
  }
  function clipToRectangle(polygon, rectangle, tick) {
    let output = polygon;
    const scale = Math.max(1, ...rectangle.map((p, i) => Math.hypot(p[0] - rectangle[(i + 1) % 4][0], p[1] - rectangle[(i + 1) % 4][1]))), epsilon = scale * scale * 1e-12;
    for (let i = 0; i < 4 && output.length; i++) {
      const a = rectangle[i], b = rectangle[(i + 1) % 4], next = [];
      tick(output.length);
      for (let j = 0; j < output.length; j++) {
        const s = output[j], e = output[(j + 1) % output.length], ds = cross(a, b, s), de = cross(a, b, e), si = ds >= -epsilon, ei = de >= -epsilon;
        if (si !== ei) {
          const t = Math.max(0, Math.min(1, ds / (ds - de)));
          next.push(s.map((v, k) => v + t * (e[k] - v)));
        }
        if (ei) next.push(e);
      }
      output = next;
    }
    return output;
  }
  function decorate(result, n, cacheHit) {
    const r = clone(result);
    r.currentHeightM = n.total;
    r.targetScale = r.status === 'ready' ? r.maxHeightM / n.total : null;
    r.adjustHeightM = r.status === 'ready' ? Math.min(n.total, r.maxHeightM) : null;
    r.intrusion = r.status === 'ready' && n.total > r.maxHeightM + 1e-6;
    r.cacheKey = n.key;
    r.cacheHit = cacheHit;
    return r;
  }
  function buildRecommendation(input) {
    let n;
    try { n = normalise(input); } catch (error) { return failure(/imported/.test(error.message) ? 'unsupported' : 'unresolved', error.message); }
    const result = {...failure('unresolved', 'no_aligned_surface'), issues: [], scope: n.scope, assumed: n.assumed, missingViews: n.missing, clearanceM: n.clearance};
    if (!G || typeof G.prepareSurface !== 'function') return {...result, issues: ['viewcone_geometry_unavailable']};
    let work = 0, bound = Infinity, controlling = null;
    const covered = new Set();
    const tick = (count = 1) => { work += count; if (work > MAX_WORK) throw new Error('geometry_work_limit'); };
    try {
      for (const plane of n.planes) {
        const surface = G.prepareSurface({polygon: plane.polygon, plane: plane.plane, coordinateCompatible: true, maxWork: MAX_WORK - work});
        tick(surface.work || 0);
        if (!surface.completed) throw new Error(surface.issues[0] || 'invalid_corridor_geometry');
        for (const part of n.parts) {
          let minimum = Infinity, point = null;
          for (const patch of surface.patches) {
            const clipped = clipToRectangle(patch, part.footprint, tick);
            for (const p of clipped) if (p[2] < minimum) { minimum = p[2]; point = p; }
          }
          if (!point) continue;
          covered.add(plane.id);
          const ratio = (part.top - n.base) / n.total, candidateHeight = (minimum - n.base - n.clearance) / ratio;
          if (!finite(candidateHeight)) throw new Error('nonfinite_height_result');
          if (candidateHeight < bound) { bound = candidateHeight; controlling = {view: plane.id, point: point.slice(), partIndex: part.index, ceilingModelZ: minimum}; }
        }
      }
      result.coveredViews = [...covered].sort();
      if (!covered.size) {
        result.status = n.missing.length ? 'unresolved' : 'outside';
        result.issues = n.missing.length ? ['affected_corridor_surfaces_missing'] : [];
      } else if (bound <= 0 || n.parts.some(p => (p.top - p.bottom) / n.total * bound < MIN_PART_HEIGHT_M - 1e-9)) {
        result.status = 'no-positive-height';
        result.issues = ['ceiling_leaves_no_positive_block_stack'];
      } else {
        result.status = 'ready';
        result.maxHeightM = bound;
      }
      if (controlling) {
        result.controllingView = controlling.view;
        result.controlPoint = controlling.point;
        result.controllingPartIndex = controlling.partIndex;
        result.ceilingModelZ = controlling.ceilingModelZ;
      }
      if (n.missing.length && result.status === 'ready') result.issues.push('known_surfaces_only');
      result.work = work;
      return decorate(result, n, false);
    } catch (error) { return decorate({...result, status: 'unresolved', maxHeightM: null, coveredViews: [], issues: [error.message], work}, n, false); }
  }
  // A checksum detects damaged or manually changed stored values. It is a cache
  // integrity check, not a security boundary or evidence of regulatory certainty.
  function checksum(value) { let h = 2166136261; for (let i = 0; i < value.length; i++) { h ^= value.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16); }
  function validStored(value) {
    if (!value || !['ready', 'outside', 'no-positive-height', 'unresolved'].includes(value.status) || !Array.isArray(value.coveredViews) || !Array.isArray(value.missingViews) || !Array.isArray(value.issues)) return false;
    if (value.status === 'ready' && (!finite(value.maxHeightM) || value.maxHeightM <= 0 || value.maxHeightM > 1e9 || !point(value.controlPoint) || value.controlPoint.length !== 3 || !value.controlPoint.every(finite) || !finite(value.ceilingModelZ) || !Number.isInteger(value.controllingPartIndex))) return false;
    if (value.status !== 'ready' && value.maxHeightM !== null) return false;
    return stable(value).length < 10000;
  }
  function matchesContext(value, n) {
    if (!validStored(value) || value.scope !== n.scope || value.assumed !== n.assumed || stable(value.missingViews) !== stable(n.missing) || value.clearanceM !== n.clearance || value.coveredViews.some(id => !n.planes.some(p => p.id === id))) return false;
    if (value.status !== 'ready') return true;
    const plane = n.planes.find(p => p.id === value.controllingView), part = n.parts.find(p => p.index === value.controllingPartIndex), p = value.controlPoint;
    if (!plane || !part) return false;
    function contains(ring) {
      let inside = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const a = ring[j], b = ring[i], length = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (Math.abs(cross(a, b, p)) <= Math.max(1, length) * 1e-7 && p[0] >= Math.min(a[0], b[0]) - 1e-7 && p[0] <= Math.max(a[0], b[0]) + 1e-7 && p[1] >= Math.min(a[1], b[1]) - 1e-7 && p[1] <= Math.max(a[1], b[1]) + 1e-7) return true;
        if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
      }
      return inside;
    }
    const z = plane.plane.a * p[0] + plane.plane.b * p[1] + plane.plane.c;
    const height = (z - n.base - n.clearance) / ((part.top - n.base) / n.total);
    return contains(part.footprint) && contains(plane.polygon) && Math.abs(z - p[2]) < 1e-5 && Math.abs(z - value.ceilingModelZ) < 1e-5 && Math.abs(height - value.maxHeightM) < 1e-5 && n.parts.every(part => (part.top - part.bottom) / n.total * value.maxHeightM >= MIN_PART_HEIGHT_M - 1e-9);
  }
  function cachePayload(value) {
    const r = clone(value);
    for (const field of ['cacheKey', 'cacheHit', 'cacheSource', 'currentHeightM', 'targetScale', 'adjustHeightM', 'intrusion']) delete r[field];
    return r;
  }
  // Records can be kept in the project folder or supplied as a read-only site
  // data file. These helpers perform no browser storage or network operations.
  function createRecord(context, recommendation) {
    try {
      const n = normalise(context);
      if (!n.persistAllowed || !recommendation || recommendation.cacheKey !== n.key) return null;
      const value = cachePayload(recommendation);
      if (!matchesContext(value, n)) return null;
      const record = {version: VERSION, key: n.key, value, checksum: checksum(n.key + stable(value))};
      return JSON.stringify(record).length * 2 <= 1000000 ? record : null;
    } catch (_) { return null; }
  }
  function keyFor(context) { try { return normalise(context).key; } catch (_) { return null; } }
  function readRecord(context, record) {
    try {
      const n = normalise(context);
      if (!n.persistAllowed || !record || record.version !== VERSION || record.key !== n.key || !validStored(record.value) || record.checksum !== checksum(record.key + stable(record.value)) || JSON.stringify(record).length * 2 > 1000000 || !matchesContext(record.value, n)) return null;
      return {...decorate(record.value, n, true), cacheSource: 'project'};
    } catch (_) { return null; }
  }
  function createCache(options) {
    const o = options || {}, maxEntries = Math.max(1, Math.min(250, Number.isInteger(o.maxEntries) ? o.maxEntries : 200)), maxBytes = Math.max(1000, Math.min(1000000, Number.isInteger(o.maxSerializedBytes) ? o.maxSerializedBytes : 1000000));
    const storage = o.storage, storageKey = text(o.storageKey) || 'vista-view-height-v1', entries = new Map();
    let storageEnabled = !!storage && o.memoryOnly !== true, loaded = false, hits = 0, misses = 0;
    const trim = () => {
      let size = [...entries].reduce((n, [key, e]) => n + (key.length + stable(e.value).length) * 2, 0);
      while (entries.size > maxEntries || size > maxBytes) {
        const key = entries.keys().next().value, e = entries.get(key);
        if (!e) break;
        size -= (key.length + stable(e.value).length) * 2;
        entries.delete(key);
      }
    };
    function load() {
      if (loaded) return;
      loaded = true;
      if (!storageEnabled) return;
      try {
        const raw = storage.getItem(storageKey);
        if (!raw) return;
        if (typeof raw !== 'string' || raw.length * 2 > maxBytes) { storage.removeItem(storageKey); return; }
        let parsed;
        try { parsed = JSON.parse(raw); } catch (_) { storage.removeItem(storageKey); return; }
        if (!parsed || parsed.version !== VERSION || !Array.isArray(parsed.entries) || parsed.entries.length > maxEntries) return;
        for (const e of parsed.entries) if (e && typeof e.key === 'string' && e.key.length < 500000 && validStored(e.value) && e.checksum === checksum(e.key + stable(e.value))) entries.set(e.key, {value: e.value, persist: true});
        trim();
      } catch (_) { storageEnabled = false; }
    }
    function save() {
      if (!storageEnabled) return;
      try {
        let stored = [...entries].filter(([, e]) => e.persist).map(([key, e]) => ({key, value: e.value, checksum: checksum(key + stable(e.value))}));
        let json = JSON.stringify({version: VERSION, entries: stored});
        while (json.length * 2 > maxBytes && stored.length) { stored.shift(); json = JSON.stringify({version: VERSION, entries: stored}); }
        storage.setItem(storageKey, json);
      } catch (_) { storageEnabled = false; }
    }
    return {
      get(context) {
        let n;
        try { n = normalise(context); } catch (_) { misses++; return null; }
        load();
        const e = entries.get(n.key);
        if (!e || !matchesContext(e.value, n)) { misses++; return null; }
        // A private context must not revive a persisted result, even when its
        // public geometry happens to coincide with an earlier public study.
        if (!n.persistAllowed && e.persist) { misses++; return null; }
        entries.delete(n.key); entries.set(n.key, e); hits++;
        return decorate(e.value, n, true);
      },
      set(context, recommendation) {
        let n;
        try { n = normalise(context); } catch (_) { return false; }
        if (!recommendation || recommendation.cacheKey !== n.key) return false;
        const value = cachePayload(recommendation);
        if (!matchesContext(value, n)) return false;
        load(); entries.delete(n.key); entries.set(n.key, {value, persist: n.persistAllowed && o.memoryOnly !== true}); trim(); save();
        return true;
      },
      clear() { entries.clear(); loaded = true; if (storageEnabled) try { storage.removeItem(storageKey); } catch (_) { storageEnabled = false; } },
      stats() { return {entries: entries.size, hits, misses, storageEnabled, maxEntries, maxSerializedBytes: maxBytes}; },
    };
  }
  return {VERSION, CLEARANCE_M, MIN_PART_HEIGHT_M, buildRecommendation, createCache, keyFor, createRecord, readRecord};
});
