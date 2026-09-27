/* Hypothetical model-coordinate comparison, ported from the Python checker.
 * This file makes no claim about an applicable City view cone or height limit.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BrowserCheck = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const LABEL = 'SYNTHETIC / NOT A VANCOUVER ASSESSMENT';
  const CHECK_LABEL = 'HYPOTHETICAL TEACHING CHECK — NOT A VANCOUVER ASSESSMENT';
  const APPLICABILITY = 'NOT ASSESSED';
  const TOLERANCE_NOTE = 'prototype setting; not a source uncertainty and not a regulatory allowance; BOUNDARY_CONTACT and PLAN_EDGE_CONTACT are tolerance bands, not exact contact';
  const PENETRATION_DEFINITION = 'vertical overlap thickness over the evaluated plan area: max(0, top_z - max(base_z, boundary_z)); 0 when the evaluated plan-overlap area is 0; null when boundary_z is missing';
  const PRECEDENCE = ['UNSUPPORTED_INPUT', 'CANNOT_DETERMINE', 'INTERSECTS', 'BOUNDARY_CONTACT', 'PLAN_EDGE_CONTACT', 'NO_PLAN_OVERLAP', 'BELOW_BOUNDARY'];
  const TOWER_KEYS = ['x_min', 'x_max', 'y_min', 'y_max', 'base_z', 'top_z'];
  const AREA_KEYS = ['x_min', 'x_max', 'y_min', 'y_max'];
  const PAIRS = [['x_min', 'x_max'], ['y_min', 'y_max'], ['base_z', 'top_z']];
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const isNumber = v => typeof v === 'number' && Number.isFinite(v);
  const isMapping = v => v !== null && typeof v === 'object' && !Array.isArray(v);

  function pythonType(v) {
    if (v === null || v === undefined) return 'NoneType';
    if (Array.isArray(v)) return 'list';
    if (typeof v === 'boolean') return 'bool';
    if (typeof v === 'string') return 'str';
    if (typeof v === 'number') return Number.isInteger(v) ? 'int' : 'float';
    return 'dict';
  }

  function pythonFloat(v) {
    if (Object.is(v, -0)) return '-0.0';
    if (Number.isNaN(v)) return 'nan';
    if (v === Infinity) return 'inf';
    if (v === -Infinity) return '-inf';
    let out = String(v);
    if (!out.includes('.') && !out.includes('e')) out += '.0';
    return out;
  }

  function pythonRepr(v) {
    if (v === null || v === undefined) return 'None';
    if (v === true) return 'True';
    if (v === false) return 'False';
    if (typeof v === 'number') return Number.isInteger(v) && Number.isFinite(v) ? String(v) : pythonFloat(v);
    if (typeof v === 'string') return "'" + v.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
    if (Array.isArray(v)) return '[' + v.map(pythonRepr).join(', ') + ']';
    if (isMapping(v)) return '{' + Object.keys(v).map(k => pythonRepr(k) + ': ' + pythonRepr(v[k])).join(', ') + '}';
    return String(v);
  }

  function pythonStr(v) { return typeof v === 'string' ? v : pythonRepr(v); }

  function validateBox(name, box, keys, reasons) {
    if (!isMapping(box)) {
      reasons.push(`${name}: expected a mapping with keys ${pythonRepr(keys)}, got ${pythonType(box)}`);
      return null;
    }
    const out = {};
    let ok = true;
    for (const k of keys) {
      if (!has(box, k)) {
        reasons.push(`${name}.${k}: missing`);
        ok = false;
      } else if (!isNumber(box[k])) {
        reasons.push(`${name}.${k}: unsupported value ${pythonRepr(box[k])} (finite int/float required; booleans rejected)`);
        ok = false;
      } else {
        out[k] = box[k];
      }
    }
    if (!ok) return null;
    for (const [lo, hi] of PAIRS) {
      if (has(out, lo) && has(out, hi) && !(out[lo] < out[hi])) {
        reasons.push(`${name}: ${lo} (${pythonFloat(out[lo])}) must be < ${hi} (${pythonFloat(out[hi])}); positive dimensions required`);
        ok = false;
      }
    }
    return ok ? out : null;
  }

  function shell(fixtureId, tol) {
    return {
      label: LABEL, fixture_id: typeof fixtureId === 'string' ? fixtureId : pythonRepr(fixtureId),
      geometric_result: null, plan_result: null, vertical_result: null,
      signed_margin_m: null, penetration_m: null, penetration_definition: PENETRATION_DEFINITION,
      plan_overlap: null, tower_footprint_area_m2: null, not_evaluated_area_m2: null,
      tolerance_m: tol, tolerance_note: TOLERANCE_NOTE, units: 'm (local Cartesian, synthetic)',
      reasons: [], regulatory_applicability: APPLICABILITY,
    };
  }

  function compare(fixtureId, tower, testArea, boundaryZ, tol = 0.001) {
    const reasons = [];
    if (typeof fixtureId !== 'string') reasons.push(`fixture_id: expected str, got ${pythonType(fixtureId)}`);
    const tolOk = isNumber(tol) && tol >= 0;
    if (!tolOk) reasons.push(`tol: unsupported value ${pythonRepr(tol)} (finite number >= 0 required)`);
    const t = validateBox('tower', tower, TOWER_KEYS, reasons);
    const a = validateBox('test_area', testArea, AREA_KEYS, reasons);
    let bz = null;
    if (boundaryZ === null || boundaryZ === undefined) {
      // An omitted boundary is the supported unknown-height case.
    } else if (isNumber(boundaryZ)) {
      bz = boundaryZ;
    } else {
      reasons.push(`boundary_z: unsupported value ${pythonRepr(boundaryZ)} (finite number or null required; booleans rejected)`);
    }
    const r = shell(fixtureId, tolOk ? tol : null);
    if (reasons.length) {
      r.geometric_result = 'UNSUPPORTED_INPUT';
      r.reasons = ['UNSUPPORTED_INPUT: not evaluated and not treated as clear', ...reasons];
      return r;
    }

    const oxMin = Math.max(t.x_min, a.x_min), oxMax = Math.min(t.x_max, a.x_max);
    const oyMin = Math.max(t.y_min, a.y_min), oyMax = Math.min(t.y_max, a.y_max);
    const signedW = oxMax - oxMin, signedD = oyMax - oyMin;
    const width = Math.max(0, signedW), depth = Math.max(0, signedD);
    const area = width * depth;
    const footprint = (t.x_max - t.x_min) * (t.y_max - t.y_min);
    const outside = footprint - area;
    const disjoint = signedW < 0 || signedD < 0;
    r.plan_overlap = {
      x_min: disjoint ? null : oxMin, x_max: disjoint ? null : oxMax,
      y_min: disjoint ? null : oyMin, y_max: disjoint ? null : oyMax,
      width_m: width, depth_m: depth, area_m2: area,
      signed_width_m: signedW, signed_depth_m: signedD,
    };
    r.tower_footprint_area_m2 = footprint;
    r.not_evaluated_area_m2 = outside;

    let plan;
    if (signedW < -tol || signedD < -tol) {
      plan = 'NO_PLAN_OVERLAP';
      reasons.push('NO_PLAN_OVERLAP: footprint and test area are disjoint beyond tolerance_m');
    } else if (Math.abs(signedW) <= tol || Math.abs(signedD) <= tol) {
      plan = 'PLAN_EDGE_CONTACT';
      reasons.push('PLAN_EDGE_CONTACT: |signed_width_m| or |signed_depth_m| <= tolerance_m; a tolerance band, not an assertion of exact edge contact');
    } else {
      plan = 'PLAN_OVERLAP';
    }
    r.plan_result = plan;
    if (outside > 0) reasons.push(`PARTIAL_PLAN_COVERAGE: ${pythonFloat(outside)} m2 of the tower footprint lies outside the test area and was not evaluated; results apply only to the evaluated overlap`);
    if (bz === null) {
      r.geometric_result = 'CANNOT_DETERMINE';
      reasons.push('boundary_z missing: no vertical comparison possible; plan information retained');
      r.reasons = reasons;
      return r;
    }
    const margin = bz - t.top_z;
    r.signed_margin_m = margin;
    if (area <= 0) {
      r.penetration_m = 0;
      r.geometric_result = plan;
      reasons.push('NO_VERTICAL_EVALUATION: evaluated plan-overlap area is 0, so no positive-area region was vertically evaluated; penetration_m = 0; signed_margin_m is only the raw elevation difference boundary_z - top_z and is not an intersection claim');
      r.reasons = reasons;
      return r;
    }
    let vertical;
    if (margin < -tol) {
      vertical = 'INTERSECTS';
      reasons.push('INTERSECTS: signed_margin_m < -tolerance_m (top_z above boundary_z) over the evaluated overlap');
    } else if (Math.abs(margin) <= tol) {
      vertical = 'BOUNDARY_CONTACT';
      reasons.push('BOUNDARY_CONTACT: |signed_margin_m| <= tolerance_m; a tolerance band, not an assertion of exact contact');
    } else {
      vertical = 'BELOW_BOUNDARY';
      reasons.push('BELOW_BOUNDARY: signed_margin_m > tolerance_m over the evaluated overlap area only; says nothing about any not-evaluated area');
    }
    r.vertical_result = vertical;
    r.penetration_m = Math.max(0, t.top_z - Math.max(t.base_z, bz));
    r.geometric_result = plan === 'PLAN_OVERLAP' ? vertical : plan;
    r.reasons = reasons;
    return r;
  }

  function cross(a, b, c) { return (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]); }

  function polygonArea(points) {
    const o = points[0];
    let twice = 0;
    for (let i = 1; i < points.length - 1; i++) {
      twice += (points[i][0] - o[0]) * (points[i + 1][1] - o[1]) -
        (points[i][1] - o[1]) * (points[i + 1][0] - o[0]);
    }
    return Math.abs(twice) / 2;
  }

  function validateFootprint(raw, box) {
    if (!Array.isArray(raw) || raw.length < 3) return [null, 'footprint: expected at least three model-XY coordinate pairs'];
    if (raw.some(p => !Array.isArray(p) || p.length !== 2 || !isNumber(p[0]) || !isNumber(p[1]))) {
      return [null, 'footprint: every vertex must have two finite numeric coordinates'];
    }
    const points = raw.map(p => [p[0], p[1]]);
    const turns = points.map((p, i) => cross(p, points[(i + 1) % points.length], points[(i + 2) % points.length]));
    const scale = Math.max(1, ...points.map((p, i) => Math.hypot(points[(i + 1) % points.length][0] - p[0], points[(i + 1) % points.length][1] - p[1])));
    if (Math.min(...turns.map(Math.abs)) <= scale * scale * 1e-12 || !(turns.every(v => v > 0) || turns.every(v => v < 0))) {
      return [null, 'footprint: vertices must form a strictly convex polygon in perimeter order'];
    }
    const boundTol = Math.max(1e-7, scale * 1e-9);
    if (points.some(([x, y]) => !(box.x_min - boundTol <= x && x <= box.x_max + boundTol &&
                                  box.y_min - boundTol <= y && y <= box.y_max + boundTol))) {
      return [null, 'footprint: vertices must lie within the supplied part bounding box'];
    }
    return [points, null];
  }

  function clip(points, axis, bound, keepAbove) {
    const inside = p => keepAbove ? p[axis] >= bound : p[axis] <= bound;
    const out = [];
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length];
      const ina = inside(a), inb = inside(b);
      if (ina !== inb) {
        const fraction = (bound - a[axis]) / (b[axis] - a[axis]);
        out.push([a[0] + fraction * (b[0] - a[0]), a[1] + fraction * (b[1] - a[1])]);
      }
      if (inb) out.push(b);
    }
    return out;
  }

  function orientedPlan(points, area, tol) {
    const rectangle = [[area.x_min, area.y_min], [area.x_max, area.y_min],
      [area.x_max, area.y_max], [area.x_min, area.y_max]];
    let clipped = points.slice();
    for (const [axis, bound, keepAbove] of [[0, area.x_min, true], [0, area.x_max, false],
                                             [1, area.y_min, true], [1, area.y_max, false]]) {
      if (clipped.length) clipped = clip(clipped, axis, bound, keepAbove);
    }
    const footprintArea = polygonArea(points);
    let overlapArea = clipped.length >= 3 ? polygonArea(clipped) : 0;
    if (overlapArea <= Math.max(1e-10, footprintArea * 1e-12)) overlapArea = 0;
    const axes = [[1, 0], [0, 1]];
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length];
      const dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy);
      axes.push([-dy / length, dx / length]);
    }
    const overlaps = axes.map(([ax, ay]) => {
      const part = points.map(p => p[0] * ax + p[1] * ay);
      const rect = rectangle.map(p => p[0] * ax + p[1] * ay);
      return Math.min(Math.max(...part), Math.max(...rect)) - Math.max(Math.min(...part), Math.min(...rect));
    });
    const closest = Math.min(...overlaps);
    const plan = closest < -tol ? 'NO_PLAN_OVERLAP' :
      closest <= tol || overlapArea === 0 ? 'PLAN_EDGE_CONTACT' : 'PLAN_OVERLAP';
    const xs = clipped.map(p => p[0]), ys = clipped.map(p => p[1]);
    const xmin = clipped.length ? Math.min(...xs) : null, xmax = clipped.length ? Math.max(...xs) : null;
    const ymin = clipped.length ? Math.min(...ys) : null, ymax = clipped.length ? Math.max(...ys) : null;
    return [plan, {
      x_min: xmin, x_max: xmax, y_min: ymin, y_max: ymax,
      width_m: clipped.length ? xmax - xmin : 0, depth_m: clipped.length ? ymax - ymin : 0,
      area_m2: overlapArea, signed_width_m: overlaps[0], signed_depth_m: overlaps[1],
    }, footprintArea];
  }

  function compareOriented(fixtureId, box, footprint, testArea, boundaryZ, tol) {
    const result = compare(fixtureId, box, testArea, boundaryZ, tol);
    if (result.geometric_result === 'UNSUPPORTED_INPUT') return result;
    const [points, error] = validateFootprint(footprint, box);
    if (error) {
      Object.assign(result, { geometric_result: 'UNSUPPORTED_INPUT', plan_result: null,
        vertical_result: null, signed_margin_m: null, penetration_m: null, plan_overlap: null,
        tower_footprint_area_m2: null, not_evaluated_area_m2: null,
        reasons: ['UNSUPPORTED_INPUT: not evaluated and not treated as clear', error] });
      return result;
    }
    const [plan, overlap, footprintArea] = orientedPlan(points, testArea, tol);
    const area = overlap.area_m2;
    result.plan_result = plan;
    result.plan_overlap = overlap;
    result.tower_footprint_area_m2 = footprintArea;
    result.not_evaluated_area_m2 = Math.max(0, footprintArea - area);
    const reasons = [];
    if (plan === 'NO_PLAN_OVERLAP') reasons.push('NO_PLAN_OVERLAP: oriented footprint and test area are disjoint beyond tolerance_m');
    else if (plan === 'PLAN_EDGE_CONTACT') reasons.push('PLAN_EDGE_CONTACT: oriented footprint is within the plan tolerance band; this does not assert exact contact');
    if (result.not_evaluated_area_m2 > 0) {
      reasons.push(`PARTIAL_PLAN_COVERAGE: ${pythonFloat(result.not_evaluated_area_m2)} m2 of the oriented footprint lies outside the test area and was not evaluated`);
    }
    if (boundaryZ === null || boundaryZ === undefined) {
      result.geometric_result = 'CANNOT_DETERMINE';
      reasons.push('boundary_z missing: no vertical comparison possible; plan information retained');
    } else if (area === 0) {
      result.geometric_result = plan;
      result.vertical_result = null;
      result.penetration_m = 0;
      reasons.push('NO_VERTICAL_EVALUATION: evaluated plan-overlap area is 0; penetration_m = 0 and signed_margin_m is only the raw elevation difference');
    } else {
      const margin = result.signed_margin_m;
      let vertical;
      if (margin < -tol) {
        vertical = 'INTERSECTS';
        reasons.push('INTERSECTS: signed_margin_m < -tolerance_m over the evaluated oriented footprint overlap');
      } else if (Math.abs(margin) <= tol) {
        vertical = 'BOUNDARY_CONTACT';
        reasons.push('BOUNDARY_CONTACT: |signed_margin_m| <= tolerance_m; a tolerance band, not an assertion of exact contact');
      } else {
        vertical = 'BELOW_BOUNDARY';
        reasons.push('BELOW_BOUNDARY: signed_margin_m > tolerance_m over the evaluated oriented footprint overlap only');
      }
      result.vertical_result = vertical;
      result.penetration_m = Math.max(0, box.top_z - Math.max(box.base_z, boundaryZ));
      result.geometric_result = plan === 'PLAN_OVERLAP' ? vertical : plan;
    }
    result.reasons = reasons;
    return result;
  }

  function checkParts(parts, testArea, boundaryZ, tol = 0.001, hypothesis = null) {
    const results = [];
    for (const [i, p] of (Array.isArray(parts) ? parts : []).entries()) {
      const box = isMapping(p) ? {
        x_min: p.x_min, x_max: p.x_max, y_min: p.y_min, y_max: p.y_max,
        base_z: has(p, 'z_min') ? p.z_min : p.base_z,
        top_z: has(p, 'z_max') ? p.z_max : p.top_z,
      } : p;
      const name = isMapping(p) ? (has(p, 'name') ? p.name : null) : null;
      const fixtureId = `part-${i}:${isMapping(p) ? pythonStr(name) : '?'}`;
      const result = isMapping(p) && has(p, 'footprint') ?
        compareOriented(fixtureId, box, p.footprint, testArea, boundaryZ, tol) :
        compare(fixtureId, box, testArea, boundaryZ, tol);
      results.push({ part: name, result, schema_violations: [] });
    }
    const overall = results.length ? PRECEDENCE.find(c => results.some(x => x.result.geometric_result === c)) : 'UNSUPPORTED_INPUT';
    const pens = results.map(x => x.result.penetration_m).filter(isNumber);
    const margins = results.map(x => x.result.signed_margin_m).filter(isNumber);
    return {
      label: CHECK_LABEL, regulatory_applicability: APPLICABILITY,
      hypothesis: hypothesis && (typeof hypothesis !== 'object' || Object.keys(hypothesis).length) ? hypothesis :
        { boundary_z_model_m: boundaryZ === undefined ? null : boundaryZ,
          note: 'declared by the user for teaching; not a City cone height; model z datum unverified' },
      overall_result: overall, max_penetration_m: pens.length ? Math.max(...pens) : null,
      min_signed_margin_m: margins.length ? Math.min(...margins) : null,
      parts: results, part_count: results.length, tolerance_m: tol,
      reasons: results.length ? [] : ['NO_PARTS: no boxes were supplied'],
      statement_kinds: {
        deterministic_computation: 'per-part box checks use synthetic_prototype.compare.compare_box_to_boundary; supplied oriented footprints use convex polygon clipping for plan overlap with the same vertical comparison and result schema',
        source_statement: 'see the clause cards (guideline.py) for the quoted text with pages',
        human_or_city_interpretation: 'whether a real cone applies at this site, whether any exception in 3.1.2–3.1.5 applies, and the 2 m provision are NOT decided here',
      },
    };
  }

  return { compare, checkParts };
});
