(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SiteGeometry = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // Tolerances scale with the polygon extent, so the same checks work for
  // architectural dimensions and city-model coordinates.
  function extent(points) {
    let xmin = Infinity, ymin = Infinity, xmax = -Infinity, ymax = -Infinity;
    for (const p of points) {
      xmin = Math.min(xmin, p[0]); xmax = Math.max(xmax, p[0]);
      ymin = Math.min(ymin, p[1]); ymax = Math.max(ymax, p[1]);
    }
    return Math.max(1, Math.hypot(xmax - xmin, ymax - ymin));
  }

  function cross(a, b, c) {
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  }

  function onSegment(a, b, p, linearTol, crossTol) {
    return Math.abs(cross(a, b, p)) <= crossTol &&
      p[0] >= Math.min(a[0], b[0]) - linearTol &&
      p[0] <= Math.max(a[0], b[0]) + linearTol &&
      p[1] >= Math.min(a[1], b[1]) - linearTol &&
      p[1] <= Math.max(a[1], b[1]) + linearTol;
  }

  function segmentsIntersect(a, b, c, d, linearTol, crossTol) {
    const abC = cross(a, b, c), abD = cross(a, b, d);
    const cdA = cross(c, d, a), cdB = cross(c, d, b);
    const sign = (v) => v > crossTol ? 1 : (v < -crossTol ? -1 : 0);
    const s1 = sign(abC), s2 = sign(abD), s3 = sign(cdA), s4 = sign(cdB);
    if (s1 * s2 < 0 && s3 * s4 < 0) return true;
    return (s1 === 0 && onSegment(a, b, c, linearTol, crossTol)) ||
      (s2 === 0 && onSegment(a, b, d, linearTol, crossTol)) ||
      (s3 === 0 && onSegment(c, d, a, linearTol, crossTol)) ||
      (s4 === 0 && onSegment(c, d, b, linearTol, crossTol));
  }

  function validate(points) {
    if (!Array.isArray(points)) return "Polygon points must be an array.";
    if (points.length < 3) return "A polygon needs at least 3 points.";
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      if (!Array.isArray(p) || p.length !== 2) return `Point ${i + 1} must contain exactly two coordinates.`;
      if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) return `Point ${i + 1} coordinates must be finite numbers.`;
    }

    const scale = extent(points);
    const linearTol = scale * 1e-9;
    const crossTol = scale * scale * 1e-12;
    const n = points.length;

    for (let i = 0; i < n; i++) {
      const a = points[i], b = points[(i + 1) % n];
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) <= linearTol) {
        return `Polygon edge ${i + 1} is duplicated or too short.`;
      }
    }

    // Adjacent edges may meet at their shared vertex, but may not double back
    // over one another along the same line.
    for (let i = 0; i < n; i++) {
      const prev = points[(i + n - 1) % n], here = points[i], next = points[(i + 1) % n];
      if (Math.abs(cross(prev, here, next)) <= crossTol) {
        const ux = here[0] - prev[0], uy = here[1] - prev[1];
        const vx = next[0] - here[0], vy = next[1] - here[1];
        if (ux * vx + uy * vy < -linearTol * linearTol) {
          return "Adjacent polygon edges overlap or double back.";
        }
      }
    }

    for (let i = 0; i < n; i++) {
      const a = points[i], b = points[(i + 1) % n];
      for (let j = i + 1; j < n; j++) {
        // Consecutive edges are allowed their single shared endpoint.
        if (j === i || j === i + 1 || (i === 0 && j === n - 1)) continue;
        const c = points[j], d = points[(j + 1) % n];
        if (segmentsIntersect(a, b, c, d, linearTol, crossTol)) {
          return "Polygon edges cross or touch.";
        }
      }
    }

    let twiceArea = 0;
    for (let i = 0; i < n; i++) {
      const a = points[i], b = points[(i + 1) % n];
      twiceArea += a[0] * b[1] - b[0] * a[1];
    }
    if (Math.abs(twiceArea) <= crossTol) return "Polygon is degenerate or collinear.";
    return null;
  }

  function metrics(points) {
    const error = validate(points);
    if (error) throw new Error(error);

    const n = points.length;
    let twiceArea = 0, cxNumerator = 0, cyNumerator = 0;
    let perimeter = 0;
    const lengths = [];
    let xmin = Infinity, ymin = Infinity, xmax = -Infinity, ymax = -Infinity;
    for (let i = 0; i < n; i++) {
      const a = points[i], b = points[(i + 1) % n];
      const term = a[0] * b[1] - b[0] * a[1];
      twiceArea += term;
      cxNumerator += (a[0] + b[0]) * term;
      cyNumerator += (a[1] + b[1]) * term;
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      lengths.push(length);
      perimeter += length;
      xmin = Math.min(xmin, a[0]); xmax = Math.max(xmax, a[0]);
      ymin = Math.min(ymin, a[1]); ymax = Math.max(ymax, a[1]);
    }
    const signedArea = twiceArea / 2;
    const area = Math.abs(signedArea);
    const centroidFactor = 1 / (3 * twiceArea);
    return {
      area,
      perimeter,
      centre: [cxNumerator * centroidFactor, cyNumerator * centroidFactor],
      bounds: [xmin, ymin, xmax, ymax],
      lengths,
    };
  }

  function rectangle(x, y, w, d) {
    if (![x, y, w, d].every(Number.isFinite)) throw new Error("Rectangle values must be finite numbers.");
    if (w <= 0 || d <= 0) throw new Error("Rectangle width and depth must be positive.");
    return [[x, y], [x + w, y], [x + w, y + d], [x, y + d]];
  }

  function pointInPolygon(point, polygon) {
    if (!Array.isArray(point) || point.length !== 2 || !point.every(Number.isFinite)) return false;
    if (validate(polygon)) return false;
    const scale = extent(polygon);
    const linearTol = scale * 1e-9;
    const crossTol = scale * scale * 1e-12;
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const a = polygon[j], b = polygon[i];
      if (onSegment(a, b, point, linearTol, crossTol)) return true;
      const crossesRay = (a[1] > point[1]) !== (b[1] > point[1]);
      if (crossesRay) {
        const xAtY = a[0] + (point[1] - a[1]) * (b[0] - a[0]) / (b[1] - a[1]);
        if (point[0] < xAtY) inside = !inside;
      }
    }
    return inside;
  }

  return { metrics, validate, rectangle, pointInPolygon };
});
