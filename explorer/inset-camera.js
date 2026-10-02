/* Pure plan-view framing for the observer inset. Coordinates are model metres. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.InsetCamera = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

  function fit({ points, width, height, bounds, paddingPx = 12, minHalf = 120 }) {
    if (!Array.isArray(points) || !points.length || points.some(p =>
      !Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1]))) {
      throw new Error('Inset framing needs at least one finite XY point.');
    }
    if (![width, height, paddingPx, minHalf].every(Number.isFinite) ||
        width <= 0 || height <= 0 || paddingPx < 0 ||
        paddingPx * 2 >= Math.min(width, height) || minHalf <= 0) {
      throw new Error('Inset dimensions and marker padding must be positive and finite.');
    }
    if (!Array.isArray(bounds) || bounds.length !== 4 ||
        !bounds.every(Number.isFinite) || bounds[2] <= bounds[0] || bounds[3] <= bounds[1]) {
      throw new Error('Inset coverage bounds must be [xmin, ymin, xmax, ymax].');
    }

    const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
    const loX = Math.min(...xs), hiX = Math.max(...xs);
    const loY = Math.min(...ys), hiY = Math.max(...ys);
    const aspect = width / height;
    const usableX = 1 - 2 * paddingPx / width;
    const usableY = 1 - 2 * paddingPx / height;
    const half = Math.max(minHalf,
      (hiX - loX) / (2 * aspect * usableX),
      (hiY - loY) / (2 * usableY));
    const halfX = half * aspect;

    function centerFor(lowPoint, highPoint, lowBound, highBound, halfSpan, usable) {
      const pointLow = highPoint - halfSpan * usable;
      const pointHigh = lowPoint + halfSpan * usable;
      const coverLow = lowBound + halfSpan;
      const coverHigh = highBound - halfSpan;
      const midpoint = (lowPoint + highPoint) / 2;
      const jointLow = Math.max(pointLow, coverLow);
      const jointHigh = Math.min(pointHigh, coverHigh);
      if (jointLow <= jointHigh) return clamp(midpoint, jointLow, jointHigh);
      // Coverage cannot hold this frame. Keep the markers padded and minimize
      // the uncovered area instead of silently cropping either point.
      const nearestCoverage = coverLow <= coverHigh
        ? clamp(midpoint, coverLow, coverHigh)
        : (lowBound + highBound) / 2;
      return clamp(nearestCoverage, pointLow, pointHigh);
    }

    const cx = centerFor(loX, hiX, bounds[0], bounds[2], halfX, usableX);
    const cy = centerFor(loY, hiY, bounds[1], bounds[3], half, usableY);
    const rect = [cx - halfX, cy - half, cx + halfX, cy + half];
    const epsilon = 1e-8 * Math.max(1, ...bounds.map(Math.abs));
    const extentExceeded = rect[0] < bounds[0] - epsilon || rect[1] < bounds[1] - epsilon ||
      rect[2] > bounds[2] + epsilon || rect[3] > bounds[3] + epsilon;
    return { center: [cx, cy], half, aspect, rect, extentExceeded };
  }

  return { fit };
});
