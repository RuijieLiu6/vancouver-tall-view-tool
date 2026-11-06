(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ProjectRoadMask = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Display-only clipping. Source street geometry and material rasters stay intact.
  const MAX_POINTS = 128;
  function pack(boundary) {
    const empty = error => ({count: 0, points: new Float32Array(MAX_POINTS * 2), bounds: new Float32Array(4), error: error || null});
    if (!boundary || !boundary.length) return empty();
    if (!Array.isArray(boundary) || boundary.length < 3) return empty('A road clearing boundary needs at least three points.');
    let points = boundary;
    if (points.length > 3 && points[0]?.[0] === points.at(-1)?.[0] && points[0]?.[1] === points.at(-1)?.[1]) points = points.slice(0, -1);
    if (points.length > MAX_POINTS) return empty(`A project site can contain at most ${MAX_POINTS} boundary points.`);
    if (points.some(p => !Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite))) return empty('The project site boundary contains invalid coordinates.');
    const area = points.reduce((sum, p, i) => { const q = points[(i + 1) % points.length]; return sum + (p[0] - points[0][0]) * (q[1] - points[0][1]) - (q[0] - points[0][0]) * (p[1] - points[0][1]); }, 0);
    if (!Number.isFinite(area) || Math.abs(area) < 1e-8) return empty('The project site boundary must enclose an area.');
    const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
    const bounds = new Float32Array([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]);
    if (bounds[0] === bounds[2] || bounds[1] === bounds[3]) return empty('The project site boundary must enclose an area.');
    const packed = new Float32Array(MAX_POINTS * 2);
    points.forEach((p, i) => { packed[i * 2] = p[0] - bounds[0]; packed[i * 2 + 1] = p[1] - bounds[1]; });
    return {count: points.length, points: packed, bounds, error: null};
  }

  // CPU counterpart of the fragment predicate, used for label filtering and tests.
  function contains(mask, point) {
    if (!mask || mask.count < 3 || !point) return false;
    const [xmin, ymin, xmax, ymax] = mask.bounds, x = point[0], y = point[1];
    if (x < xmin || y < ymin || x > xmax || y > ymax) return false;
    const qx = x - xmin, qy = y - ymin;
    let inside = false;
    for (let i = 0, j = mask.count - 1; i < mask.count; j = i++) {
      const ax = mask.points[j * 2], ay = mask.points[j * 2 + 1], bx = mask.points[i * 2], by = mask.points[i * 2 + 1];
      const dx = bx - ax, dy = by - ay, cross = dx * (qy - ay) - dy * (qx - ax);
      if (Math.abs(cross) <= 0.0001 * Math.max(1, Math.hypot(dx, dy)) && qx >= Math.min(ax, bx) && qx <= Math.max(ax, bx) && qy >= Math.min(ay, by) && qy <= Math.max(ay, by)) return true;
      if ((ay > qy) !== (by > qy) && qx < ax + (qy - ay) * dx / dy) inside = !inside;
    }
    return inside;
  }

  const GLSL = `
uniform int uProjectRoadCount;
uniform vec2 uProjectRoadPoints[${MAX_POINTS}];
uniform vec4 uProjectRoadBounds;
bool projectRoadCleared(vec2 point) {
  if(uProjectRoadCount<3 || any(lessThan(point,uProjectRoadBounds.xy)) || any(greaterThan(point,uProjectRoadBounds.zw))) return false;
  vec2 q=point-uProjectRoadBounds.xy;
  bool inside=false;
  vec2 a=uProjectRoadPoints[max(0,uProjectRoadCount-1)];
  for(int i=0;i<uProjectRoadCount;i++) {
    vec2 b=uProjectRoadPoints[i],d=b-a;
    float cross=d.x*(q.y-a.y)-d.y*(q.x-a.x);
    if(abs(cross)<=0.0001*max(1.0,length(d)) && all(greaterThanEqual(q,min(a,b))) && all(lessThanEqual(q,max(a,b)))) return true;
    if((a.y>q.y)!=(b.y>q.y) && q.x<a.x+(q.y-a.y)*d.x/d.y) inside=!inside;
    a=b;
  }
  return inside;
}
`;
  return {MAX_POINTS, pack, contains, GLSL};
});
