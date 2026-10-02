/* Site study report: a structured, illustrated A4-landscape PDF of the current study, and a preview dialog where the user
 * chooses what to include. Every protected view whose mapped corridor overlaps the proposal in plan gets its own page rendered from the
 * open-data origin point, whether or not the user ever looked from there: existing and proposed views with the cone's
 * vertical boundaries marked, a key plan and a section along the cone. Teaching tool: the report states what is measured
 * in plan and never claims compliance; the cones' horizontal lower boundaries are not in the open data.
 */
(function () {
'use strict';
const X = window.__explorer, Pdf = window.MiniPdf;
if (!X || !Pdf) return;
const $ = (id) => document.getElementById(id);
const S = () => X.state;
const PW = Pdf.PT.w, PH = Pdf.PT.h, M = 36;
const PAL = { paper: '#f7f5ed', paper2: '#efece0', ink: '#29342e', muted: '#5d6b62', faint: '#8b968e', line: '#cfd3c6', clay: '#b46d58', clayDark: '#8a4c3b', clayLight: '#ecd3c7',
  sage: '#426b61', sageLight: '#dfe5d3', sageMid: '#9db3a5', water: '#b8cacc', amber: '#c99a3b', amberLight: '#f3e3bd', white: '#ffffff', sky: '#eef1ec', building: '#c9ccc2', red: '#a64235' };
const fmt = (v, d = 1) => (v === null || v === undefined || !Number.isFinite(+v)) ? '-' : (+v).toFixed(d);
const deg = (r) => r * 180 / Math.PI;
const upDown = (a) => `${fmt(Math.abs(a), 1)}° ${a < 0 ? 'down' : 'up'}`; // an angle to the proposal top, never "-2° up"
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const tick = () => new Promise((r) => setTimeout(r, 0));

// ------------------------------------------------------------------ study geometry
function guidelineRow(cone) { return X.assets.guideline?.table_1?.find((r) => String(r.reference) === String(cone.view_number)) || null; }
function footprintPoints() { const pts = []; for (const p of X.proposalParts()) for (const q of X.partFootprint(p)) pts.push(q); return pts; }
function coneGeom(cone) {
  const O = cone.origin_model_xy, far = cone.polygon_model_xy.filter((v) => Math.hypot(v[0] - O[0], v[1] - O[1]) > 1);
  let ux = 0, uy = 0; for (const v of far) { const d = Math.hypot(v[0] - O[0], v[1] - O[1]); ux += (v[0] - O[0]) / d; uy += (v[1] - O[1]) / d; }
  const yaw = Math.atan2(uy, ux), u = [Math.cos(yaw), Math.sin(yaw)];
  let lo = 0, hi = 0, vlo = far[0], vhi = far[0]; for (const v of far) { const a = wrapAngle(Math.atan2(v[1] - O[1], v[0] - O[0]) - yaw); if (a < lo) { lo = a; vlo = v; } if (a > hi) { hi = a; vhi = v; } }
  const length = Math.max(...far.map((v) => Math.hypot(v[0] - O[0], v[1] - O[1])));
  const g = X.groundZAt(O[0], O[1]); return { O, far, yaw, u, n: [-u[1], u[0]], half: Math.max(Math.abs(lo), Math.abs(hi)), left: vhi, right: vlo, length, ground: g, eyeZ: g ? g.z + 1.6 : null };
}
function pointPolyDist(p, poly) { let inside = false, best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j];
    if (((a[1] > p[1]) !== (b[1] > p[1])) && (p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0])) inside = !inside;
    const dx = b[0] - a[0], dy = b[1] - a[1], t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy)); }
  return inside ? 0 : best; }
function coneStudy(cone, relation) {
  const G = coneGeom(cone), P = X.proposalBox(), pts = footprintPoints(); const row = guidelineRow(cone);
  let dmin = Infinity, dmax = -Infinity, near = Infinity; for (const q of pts) { const dx = q[0] - G.O[0], dy = q[1] - G.O[1], d = dx * G.u[0] + dy * G.u[1]; dmin = Math.min(dmin, d); dmax = Math.max(dmax, d); near = Math.min(near, Math.hypot(dx, dy)); }
  const gap = pts.length ? Math.min(...pts.map((q) => pointPolyDist(q, cone.polygon_model_xy))) : null;
  // Steepest angle up to any block's own top, measured to that block's nearest footprint corner (not the tallest top over the nearest block).
  const blocks = X.proposalParts().map((p) => { const fp = X.partFootprint(p); let lo = Infinity, hi = -Infinity, nr = Infinity; for (const q of fp) { const dx = q[0] - G.O[0], dy = q[1] - G.O[1], d = dx * G.u[0] + dy * G.u[1]; lo = Math.min(lo, d); hi = Math.max(hi, d); nr = Math.min(nr, Math.hypot(dx, dy)); } return { lo, hi, near: nr, base: p.box[2], top: p.box[5] }; });
  const topAngle = P && G.eyeZ != null && blocks.length ? Math.max(...blocks.map((b) => deg(Math.atan2(b.top - G.eyeZ, Math.max(b.near, 1))))) : null;
  return { cone, row, G, relation, dmin, dmax, near, gap, topAngle, blocks, id: String(cone.view_number) };
}
// All 24 views, most relevant first: corridors that meet the proposal in plan, then the rest by distance.
let candKey = '', candCache = [];
function coneCandidates() {
  if (!X.assets.cones?.available || !X.proposalBox()) return [];
  const key = JSON.stringify([X.proposalParts().map((p) => p.box), X.planAnalysis().map((m) => m.cone.view_number + m.relation)]); if (key === candKey) return candCache; candKey = key; // cached: the Output panel refreshes often
  const met = new Map(X.planAnalysis().map((m) => [String(m.cone.view_number), m.relation]));
  const list = X.assets.cones.cones.filter((c) => c.origin_inside_model_extent).map((c) => coneStudy(c, met.get(String(c.view_number)) || 'none'));
  const rank = { overlap: 0, touch: 1, none: 2 }; list.sort((a, b) => rank[a.relation] - rank[b.relation] || (a.gap ?? 1e9) - (b.gap ?? 1e9));
  const anyMet = list.some((c) => c.relation !== 'none'); list.forEach((c, i) => { c.default = c.relation !== 'none' || (!anyMet && i < 2); c.context = c.relation === 'none'; });
  candCache = list; return list;
}

// ------------------------------------------------------------------ options: an ordered list of pages, each with a layout template
const TEMPLATES = {
  cover: [['hero', 'Title and hero image'], ['simple', 'Title only']], summary: [['plan', 'Key plan and table'], ['table', 'Table only']],
  site: [['both', 'Plan and 3D overview'], ['plan', 'Plan only, large'], ['aerial', '3D overview, large']],
  cone: [['full', 'Both views, section, plan'], ['compare', 'Both views, large'], ['large', 'Proposed view, large']],
  observer: [['plan', 'View with key plan'], ['wide', 'Wide view']], inspect: [['four', 'Four sides'], ['two', 'North and south, large']],
  height: [['chart', 'Chart and table']], clauses: [['all', 'All clauses'], ['key', 'Definition and clause 3.1.1']], sources: [['full', 'Sources and limitations']],
};
const NAMES = { cover: 'Cover', summary: 'Summary and key plan', site: 'Site and proposal', observer: 'Your viewpoint', inspect: 'Context views', height: 'Height experiment', clauses: 'Guideline text', sources: 'Sources and limitations' };
const IMAGES = { cover: { hero: 1 }, summary: { plan: 1 }, site: { both: 2, plan: 1, aerial: 1 }, cone: { full: 3, compare: 3, large: 2 }, observer: { wide: 1, plan: 1 }, inspect: { four: 4, two: 2 } };
function available(key) { const st = S(), P = X.proposalBox();
  switch (key) { case 'site': return st.site ? null : 'No site yet'; case 'cone': return !P ? 'No proposal yet' : !X.assets.cones?.available ? 'View-cone data unavailable' : null;
    case 'observer': return st.observer ? null : 'No viewpoint placed'; case 'inspect': case 'summary': return P ? null : 'No proposal yet';
    case 'height': return !P ? 'No proposal yet' : st.check.unknown ? 'Turn on the study ceiling above to include it' : null; case 'clauses': return X.assets.guideline ? null : 'Guideline text unavailable'; default: return null; } }
function defaults() { const st = S(), cands = coneCandidates(); const item = (key, extra) => Object.assign({ key, on: !available(key), tpl: TEMPLATES[key][0][0] }, extra || {});
  return { title: st.studyName || 'Untitled study', author: '', style: 'collage',
    items: [item('cover'), item('summary'), item('site'), ...cands.filter((c) => c.default).map((c) => ({ key: 'cone', id: c.id, on: true, tpl: 'full' })), item('observer'), item('inspect'), item('height'), item('clauses'), item('sources')] }; }
function pagePlan(opts) { const o = opts || defaults(), cands = coneCandidates(), pages = [];
  for (const it of o.items) { if (!it.on || available(it.key)) continue; if (it.key === 'cone') { const c = cands.find((k) => k.id === it.id); if (c) pages.push({ type: 'cone', study: c, tpl: it.tpl }); } else pages.push({ type: it.key, tpl: it.tpl }); }
  return pages; }
function imageCount(pages) { return pages.reduce((n, p) => n + (IMAGES[p.type]?.[p.tpl] || 0), 0); }

// ------------------------------------------------------------------ drawing helpers
function chip(D, p, x, y, text, kind, opts) { const o = opts || {}; const size = o.size || 7.5, w = Pdf.textWidth(text, size, true) + 12, h = size + 7;
  const fills = { overlap: [PAL.clay, PAL.white], touch: [PAL.amber, PAL.white], none: [PAL.paper2, PAL.muted], context: [PAL.paper2, PAL.muted], sage: [PAL.sage, PAL.white], soft: [PAL.sageLight, PAL.sage] };
  const [bg, fg] = fills[kind] || fills.soft; const x0 = o.align === 'right' ? x - w : x; D.roundRect(p, x0, y - size - 3, w, h, h / 2, { fill: bg }); D.text(p, x0 + 6, y, text, size, true, fg); return w; }
function relationText(r) { return r === 'overlap' ? 'Overlaps the corridor in plan' : r === 'touch' ? 'Touches the corridor edge in plan' : 'Outside the corridor in plan'; }
function relationShort(r) { return r === 'overlap' ? 'Plan overlap' : r === 'touch' ? 'Touches' : 'Context'; }
function northArrow(D, p, x, y, s) { s = s || 14; D.circle(p, x, y, s * 0.95, { fill: PAL.white, stroke: PAL.line, width: 0.6, alpha: 0.92 }); D.poly(p, [[x, y - s * 0.7], [x + s * 0.32, y + s * 0.45], [x, y + s * 0.2], [x - s * 0.32, y + s * 0.45]], { fill: PAL.ink }); D.text(p, x, y - s * 1.15, 'N', 7, true, PAL.ink, { align: 'center' }); }
function scaleBar(D, p, x, y, ptsPerMetre, maxPts) { const raw = maxPts / ptsPerMetre, order = 10 ** Math.floor(Math.log10(raw)); const nice = [5, 2, 1].map((k) => k * order).find((v) => v <= raw) || order; const w = nice * ptsPerMetre;
  D.roundRect(p, x - 6, y - 13, w + 12 + 34, 20, 4, { fill: PAL.white, alpha: 0.9 }); D.rect(p, x, y - 3, w / 2, 3, PAL.ink); D.rect(p, x + w / 2, y - 3, w / 2, 3, PAL.white, PAL.ink);
  D.text(p, x + w + 5, y + 1, nice >= 1000 ? fmt(nice / 1000, nice % 1000 ? 1 : 0) + ' km' : nice + ' m', 7, true, PAL.ink); }
function tag(D, p, x, y, text, opts) { const o = opts || {}; const size = o.size || 7, w = Pdf.textWidth(text, size, o.bold) + 8; const x0 = o.align === 'right' ? x - w : o.align === 'center' ? x - w / 2 : x;
  D.roundRect(p, x0, y - size - 3, w, size + 6, 3, { fill: o.fill || PAL.white, alpha: o.alpha ?? 0.92, stroke: o.stroke, width: 0.6 }); D.text(p, x0 + 4, y, text, size, o.bold, o.color || PAL.ink); }
function frameImage(D, p, cap, x, y, w, h) { D.image(p, cap.url, x, y, w, h); D.rect(p, x, y, w, h, null, PAL.line); return (pt) => { const f = cap.toImage(pt); return f ? [x + f[0] * w, y + f[1] * h] : null; }; }
function caption(D, p, x, y, w, title, text) { D.text(p, x, y, title, 8, true, PAL.ink); if (text) D.paragraph(p, x, y + 10, text, 7.2, w, { color: PAL.muted, leading: 1.3 }); }
function lineThroughFrame(a, b, x, y, w, h) { // extend the line a→b to the frame rectangle
  const dx = b[0] - a[0], dy = b[1] - a[1]; const ts = []; if (Math.abs(dx) > 1e-9) ts.push((x - a[0]) / dx, (x + w - a[0]) / dx); if (Math.abs(dy) > 1e-9) ts.push((y - a[1]) / dy, (y + h - a[1]) / dy);
  const pts = ts.map((t) => [a[0] + dx * t, a[1] + dy * t]).filter((q) => q[0] >= x - 0.5 && q[0] <= x + w + 0.5 && q[1] >= y - 0.5 && q[1] <= y + h + 0.5); return pts.length >= 2 ? [pts[0], pts[pts.length - 1]] : null; }
function planSpec(bounds, aspect, margin) { const cx = (bounds[0] + bounds[2]) / 2, cy = (bounds[1] + bounds[3]) / 2; const half = Math.max((bounds[3] - bounds[1]) / 2, (bounds[2] - bounds[0]) / (2 * aspect)) * (margin || 1.12);
  return { mode: 'plan', overview: { target: [cx, cy, 0], dist: half / Math.tan(Math.PI / 8), az: -Math.PI / 2, el: 1.55 }, half }; }
function boundsOf(pts, pad) { const b = [Infinity, Infinity, -Infinity, -Infinity]; for (const q of pts) { b[0] = Math.min(b[0], q[0]); b[1] = Math.min(b[1], q[1]); b[2] = Math.max(b[2], q[0]); b[3] = Math.max(b[3], q[1]); } const d = pad || 0; return [b[0] - d, b[1] - d, b[2] + d, b[3] + d]; }

// ------------------------------------------------------------------ captures
function cap(spec, opts) { return X.captureScene(Object.assign({ style: opts.style === 'current' ? S().sceneStyle : 'collage', quality: 0.84 }, spec)); }
function coneViewCaptures(st, opts, tpl) {
  const G = st.G, P = X.proposalBox(); if (!G.ground) return null; const aspect = tpl === 'compare' ? 1.6 : tpl === 'large' ? 2.4 : 2.1, w = 1680, h = Math.round(1680 / aspect);
  const hfov = Math.min(100, Math.max(24, deg(G.half) * 2 * 1.5 + 8)), vfov = 2 * deg(Math.atan(Math.tan(hfov * Math.PI / 360) / aspect));
  const topA = st.topAngle ?? 0, pitchDeg = Math.max(-2, Math.min(28, Math.max(vfov * 0.12, topA - vfov * 0.32)));
  const base = { mode: 'observer', width: w, height: h, observer: { x: G.O[0], y: G.O[1], z: G.ground.z, ground: G.ground.source }, observerSource: 'origin', eyeH: 1.6, yaw: G.yaw, pitch: pitchDeg * Math.PI / 180, fov: vfov, backdrop: true };
  return { proposed: cap(Object.assign({}, base, { existing: false }), opts), existing: tpl !== 'large' ? cap(Object.assign({}, base, { existing: true }), opts) : null, hfov, vfov, pitchDeg, P, aspect }; }

// ------------------------------------------------------------------ page chrome
function header(D, p, kicker, title, section) {
  D.text(p, M, 30, kicker.toUpperCase(), 7, true, PAL.sage, { spacing: 0.9 }); D.text(p, M, 50, title, 17, true, PAL.ink);
  if (section) { const w = Pdf.textWidth(section, 8, true); D.roundRect(p, PW - M - w - 16, 22, w + 16, 17, 8.5, { fill: PAL.paper2 }); D.text(p, PW - M - w - 8, 33.5, section, 8, true, PAL.sage); }
  D.line(p, M, 60, PW - M, 60, PAL.line, 0.7); }
function footers(D, opts, stamp) { const n = D.pages.length; D.pages.forEach((p, i) => { if (p.noFooter) return;
  D.line(p, M, PH - 28, PW - M, PH - 28, PAL.line, 0.5); let left = `${opts.title}${opts.author ? '  ·  ' + opts.author : ''}  ·  ${stamp}`; while (Pdf.textWidth(left, 7) > 200 && left.length > 12) left = left.slice(0, -14) + '…' + left.slice(-12); D.text(p, M, PH - 15, left, 7, false, PAL.faint);
  D.text(p, PW / 2, PH - 15, 'Teaching tool  ·  not a City of Vancouver protected-view assessment', 7, false, PAL.faint, { align: 'center' }); D.text(p, PW - M, PH - 15, `${i + 1} / ${n}`, 7, true, PAL.muted, { align: 'right' }); }); }

// ------------------------------------------------------------------ pages
function drawCover(D, p, opts, ctx) {
  p.noFooter = true; const P = X.proposalBox(), st = S(), L = 318;
  D.rect(p, 0, 0, PW, PH, PAL.paper); const heroX = L, heroW = PW - L;
  if (ctx.hero) { D.image(p, ctx.hero.url, heroX, 0, heroW, PH); tag(D, p, PW - 14, PH - 14, 'Proposal in its modelled context', { align: 'right', size: 7 }); }
  else { D.rect(p, heroX, 0, heroW, PH, PAL.paper2); const cx = heroX + heroW / 2; D.text(p, cx, PH / 2 - 10, P ? fmt(P.top - P.base, 0) + ' m' : '-', 64, true, PAL.sage, { align: 'center' }); D.text(p, cx, PH / 2 + 22, 'proposed height above ground', 11, false, PAL.muted, { align: 'center' });
    D.text(p, cx, PH / 2 + 74, `${ctx.met} view corridor${ctx.met === 1 ? '' : 's'} overlap${ctx.met === 1 ? 's' : ''} in plan · heights not assessed`, 14, true, ctx.met ? PAL.clay : PAL.muted, { align: 'center' }); }
  D.rect(p, L - 4, 0, 4, PH, PAL.clay);
  D.text(p, M, 52, 'ARCH 540  ·  VANCOUVER VIEW-PROTECTION LAB', 7, true, PAL.clay, { spacing: 1 });
  let y = D.paragraph(p, M, 92, opts.title, 25, L - M - 24, { bold: true, color: PAL.ink, leading: 1.12 }) + 2;
  y = D.paragraph(p, M, y + 4, 'Site, massing and protected-view study', 11, L - M - 24, { color: PAL.muted }) + 10;
  D.text(p, M, y, opts.author ? 'Prepared by ' + opts.author : 'Prepared with the Site Explorer', 8.5, false, PAL.ink); D.text(p, M, y + 13, ctx.dateLong, 8.5, false, PAL.muted); y += 40;
  const area = st.boundary.length >= 3 ? X.formatArea(SiteGeometry.metrics(st.boundary).area) : st.site ? 'Point site' : '-';
  const stats = [[P ? fmt(P.top - P.base, 0) + ' m' : '-', 'proposal height'], [area, 'study area'], [String(ctx.met), ctx.met === 1 ? 'corridor overlap in plan' : 'corridor overlaps in plan']];
  stats.forEach(([v, l], i) => { const x = M + i * 88; D.text(p, x, y, v, v.length > 9 ? 12 : 16, true, i === 2 && ctx.met ? PAL.clay : PAL.sage); D.paragraph(p, x, y + 12, l, 7, 80, { color: PAL.muted }); }); y += 44;
  const sentence = X.studySentence?.(P, X.planAnalysis()); if (sentence) y = D.paragraph(p, M, y - 6, sentence, 8.5, L - M - 24, { color: PAL.ink, leading: 1.3 }) + 10; // the study in one sentence, as in the Output step
  D.line(p, M, y, L - 24, y, PAL.line, 0.6); y += 18; D.text(p, M, y, 'CONTENTS', 7, true, PAL.sage, { spacing: 1 }); y += 14;
  for (const [ci, [name, page]] of ctx.contents.entries()) { if (y > PH - 120) { D.text(p, M, y, `+ ${ctx.contents.length - ci} more`, 8, false, PAL.muted, { italic: true }); break; } D.text(p, M, y, name, 8.5, false, PAL.ink); D.text(p, L - 24, y, String(page), 8.5, true, PAL.muted, { align: 'right' }); D.line(p, M + Pdf.textWidth(name, 8.5) + 4, y - 2.5, L - 30 - Pdf.textWidth(String(page), 8.5, true), y - 2.5, PAL.line, 0.5, { dash: [1, 2] }); y += 14; }
  D.roundRect(p, M, PH - 92, L - M - 24, 64, 6, { fill: PAL.white, stroke: PAL.line, width: 0.6 });
  D.paragraph(p, M + 10, PH - 77, 'Teaching tool, not a City of Vancouver protected-view assessment. View cones are mapped in plan from City open data; their horizontal lower boundaries (maximum heights) are not in that data, so this study cannot show vertical encroachment. By-laws and City staff are authoritative.', 7, L - M - 44, { color: PAL.muted, leading: 1.3 });
}
function drawSummary(D, p, opts, ctx, tpl) {
  header(D, p, 'Summary', 'Protected views around the proposal', 'Summary'); const P = X.proposalBox(), st = S(), sel = ctx.coneStudies;
  const fx = M, fy = 74, fw = tpl === 'table' ? -22 : 430, fh = PH - fy - 44;
  if (tpl !== 'table') {
  const pts = [...footprintPoints(), ...sel.flatMap((c) => c.cone.polygon_model_xy)]; const b = boundsOf(pts.length ? pts : [[st.site.x, st.site.y]], 120);
  const spec = planSpec(b, fw / fh, 1.06), img = cap(Object.assign({ width: 1100, height: Math.round(1100 * fh / fw) }, spec), opts); const to = frameImage(D, p, img, fx, fy, fw, fh);
  D.clip(p, fx, fy, fw, fh, () => {
    for (const c of X.assets.cones.cones) { const pp = c.polygon_model_xy.map((q) => to([q[0], q[1], 0])); if (pp.every(Boolean)) D.poly(p, pp, { stroke: PAL.sageMid, width: 0.5, strokeAlpha: 0.7 }); }
    sel.forEach((c) => { const pp = c.cone.polygon_model_xy.map((q) => to([q[0], q[1], 0])); if (!pp.every(Boolean)) return; const colr = c.relation === 'overlap' ? PAL.clay : c.relation === 'touch' ? PAL.amber : PAL.sage;
      D.poly(p, pp, { fill: colr, alpha: 0.13, stroke: colr, width: 1.1 }); });
    for (const part of X.proposalParts()) { const pp = X.partFootprint(part).map((q) => to([q[0], q[1], 0])); if (pp.every(Boolean)) D.poly(p, pp, { fill: PAL.clay, stroke: PAL.clayDark, width: 0.8 }); }
    const pc = to([P.cx, P.cy, 0]); if (pc) { D.circle(p, pc[0], pc[1], 6, { stroke: PAL.clayDark, width: 1.4 }); tag(D, p, pc[0] + 9, pc[1] + 3, 'Proposal', { bold: true, color: PAL.clayDark }); }
    sel.forEach((c) => { const o = to([c.G.O[0], c.G.O[1], 0]); if (!o) return; D.circle(p, o[0], o[1], 7.5, { fill: PAL.white, stroke: PAL.sage, width: 1.3 }); D.text(p, o[0], o[1] + 2.4, c.id.length > 3 ? '' : c.id, 6, true, PAL.sage, { align: 'center' }); tag(D, p, o[0] + 10, o[1] + 3, `${c.id} ${c.cone.name}`, { size: 6.5, bold: true, color: PAL.sage }); });
  });
  northArrow(D, p, fx + fw - 20, fy + 24); scaleBar(D, p, fx + 12, fy + fh - 12, fw / (2 * spec.half * (fw / fh)), fw * 0.22); }
  // right column
  const rx = fx + fw + 22, rw = PW - M - rx; let y = fy + 8;
  const area = st.boundary.length >= 3 ? X.formatArea(SiteGeometry.metrics(st.boundary).area) : 'Point site';
  [[fmt(P.top - P.base, 0) + ' m', 'height above ground'], [area, 'study area'], [String(ctx.met), 'corridor overlaps in plan']].forEach(([v, l], i) => { const x = rx + i * (rw / 3); D.text(p, x, y + 10, v, v.length > 9 ? 11 : 15, true, i === 2 && ctx.met ? PAL.clay : PAL.sage); D.text(p, x, y + 22, l, 6.8, false, PAL.muted); });
  y += 42; D.line(p, rx, y, rx + rw, y, PAL.line, 0.6); y += 16;
  D.text(p, rx, y, 'Selected protected views', 9.5, true, PAL.ink); y += 14;
  const k = rw / 334, cols = [rx, rx + 34 * k, rx + 160 * k, rx + 232 * k, rw + rx]; ['View', 'Origin to subject', 'In plan', 'Angle to top'].forEach((h, i) => D.text(p, cols[i], y, h, 6.8, true, PAL.muted)); y += 5; D.line(p, rx, y, rx + rw, y, PAL.line, 0.5); y += 11;
  if (!sel.length) { y = D.paragraph(p, rx, y, 'No protected view is selected. Open the report options to add views.', 8, rw, { color: PAL.muted }); }
  for (const c of sel) { if (y > PH - 120) { D.text(p, rx, y, `+ ${sel.length - sel.indexOf(c)} more on the following pages`, 7.5, false, PAL.muted, { italic: true }); y += 12; break; }
    D.text(p, cols[0], y, c.id, 8, true, PAL.sage); const l = Pdf.wrap(`${c.cone.name} → ${c.row?.subject || 'subject'}`, 7.3, 122 * k); l.slice(0, 2).forEach((ln, k) => D.text(p, cols[1], y + k * 9, ln, 7.3, false, PAL.ink));
    chip(D, p, cols[2], y + 1, relationShort(c.relation), c.relation === 'none' ? 'context' : c.relation, { size: 6.5 }); D.text(p, cols[3], y, c.topAngle == null ? '-' : upDown(c.topAngle), 7.5, true, PAL.ink); D.text(p, cols[3], y + 9, (c.near / 1000).toFixed(2) + ' km away', 6.5, false, PAL.muted);
    y += Math.max(22, l.slice(0, 2).length * 9 + 8); D.line(p, rx, y - 9, rx + rw, y - 9, PAL.paper2, 0.5); }
  y = Math.max(y + 4, PH - 132); D.roundRect(p, rx, y, rw, 84, 6, { fill: PAL.paper });
  D.paragraph(p, rx + 10, y + 15, `“In plan” compares the proposal footprint with the City's mapped view-cone polygons. “Angle to top” is the geometric angle from a 1.6 m eye at each origin point to the top of the proposal; it does not show whether the proposal is visible past other buildings. The City's horizontal lower boundary for each cone is not in the open data, so these pages cannot show whether the building rises into a cone; clause 3.1.1 asks that no part of a building encroach into it.`, 6.9, rw - 20, { color: PAL.muted, leading: 1.32 });
}
function drawSite(D, p, opts, tpl) {
  header(D, p, 'Site and proposal', 'The proposal on its site', 'Site'); const st = S(), P = X.proposalBox(), fp = footprintPoints(); if (!P) tpl = 'plan';
  const fx = M, fy = 74, fw = tpl === 'plan' ? PW - 2 * M : 360, fh = tpl === 'both' ? 300 : 360;
  if (tpl !== 'aerial') { const sitePts = st.boundary.length >= 3 ? st.boundary : fp; const b0 = boundsOf(sitePts.length ? sitePts : [[st.site.x, st.site.y]]);
  const span = Math.max(b0[2] - b0[0], b0[3] - b0[1], 60); const b = [b0[0] - span * 0.9, b0[1] - span * 0.9, b0[2] + span * 0.9, b0[3] + span * 0.9];
  const spec = planSpec(b, fw / fh, 1), img = cap(Object.assign({ width: 1400, height: Math.round(1400 * fh / fw) }, spec), opts); const to = frameImage(D, p, img, fx, fy, fw, fh);
  D.clip(p, fx, fy, fw, fh, () => {
    for (const part of X.proposalParts()) { const pp = X.partFootprint(part).map((q) => to([q[0], q[1], 0])); if (pp.every(Boolean)) D.poly(p, pp, { fill: PAL.clay, alpha: 0.85, stroke: PAL.clayDark, width: 0.9 }); }
    if (st.boundary.length >= 3) { const pp = st.boundary.map((q) => to([q[0], q[1], 0])); D.poly(p, pp, { stroke: PAL.ink, width: 1.2, dash: [5, 3] });
      st.boundary.forEach((a, i) => { const c = st.boundary[(i + 1) % st.boundary.length], m = to([(a[0] + c[0]) / 2, (a[1] + c[1]) / 2, 0]); if (m) tag(D, p, m[0], m[1] + 3, fmt(Math.hypot(c[0] - a[0], c[1] - a[1]), 1) + ' m', { size: 6.2, align: 'center' }); }); }
    const s = to([st.site.x, st.site.y, 0]); if (s) { D.line(p, s[0] - 5, s[1], s[0] + 5, s[1], PAL.ink, 0.8); D.line(p, s[0], s[1] - 5, s[0], s[1] + 5, PAL.ink, 0.8); }
  });
  northArrow(D, p, fx + fw - 20, fy + 24); scaleBar(D, p, fx + 12, fy + fh - 12, fw / (2 * spec.half * (fw / fh)), fw * 0.3);
  caption(D, p, fx, fy + fh + 14, fw, 'Plan', st.boundary.length >= 3 ? 'Dashed: your study boundary with edge lengths (not a legal parcel). Clay: the proposal footprint.' : 'Clay: the proposal footprint. Cross: the site point. No boundary was drawn.'); }
  // aerial perspective
  if (!P) return; const h = P.top - P.base;
  if (tpl !== 'plan') { const ax = tpl === 'aerial' ? M : fx + fw + 18, aw = PW - M - ax, ah = fh;
  const az = cap({ mode: 'overview', width: 1300, height: Math.round(1300 * ah / aw), overview: { target: [P.cx, P.cy, P.base + h * 0.35], dist: Math.max(260, h * 3.4, Math.max(P.box[3] - P.box[0], P.box[4] - P.box[1]) * 5), az: -0.95, el: 0.42 } }, opts);
  frameImage(D, p, az, ax, fy, aw, ah); caption(D, p, ax, fy + fh + 14, aw, '3D overview from the south-east', 'Existing buildings in the model are pale; the proposal is clay. Building heights come from OpenStreetMap and are unverified.'); }
  // data
  let y = fy + fh + 50; const tw = PW - 2 * M; D.text(p, M, y, 'Blocks', 9, true, PAL.ink); y += 6;
  const rows = st.pmode === 'import' && st.imported ? [[st.imported.name, `${fmt(P.box[3] - P.box[0], 0)} × ${fmt(P.box[4] - P.box[1], 0)} m`, '-', fmt(P.top - P.base, 1) + ' m', `${st.imported.parts.length} parts, bounding boxes`]]
    : X.proposalParts().map((q, i) => { const pr = st.parts[i] || {}; return [q.name || pr.name || 'Block ' + (i + 1), `${fmt(pr.w, 0)} × ${fmt(pr.d, 0)} m`, fmt(pr.rotation || 0, 0) + '°', fmt(pr.h, 1) + ' m', `base z ${fmt(q.box[2], 1)} · top z ${fmt(q.box[5], 1)} m`]; });
  y = D.table(p, M, y + 10, ['Block', 'Width × depth', 'Rotation', 'Height', 'Model elevations'], rows.slice(0, 6), 7.5, [150, 110, 70, 70, tw - 400]) + 4;
  const notes = [`Study area: ${st.boundary.length >= 3 ? X.formatArea(SiteGeometry.metrics(st.boundary).area) + ', perimeter ' + fmt(SiteGeometry.metrics(st.boundary).perimeter, 0) + ' m (user-defined, not a parcel)' : 'point only'}.`, `Existing buildings removed: ${st.removed.length} replaced as the site, ${st.cleared.length} demolished under the proposal.`, `Proposal ${fmt(h, 1)} m tall; top at model z ${fmt(P.top, 1)} m.`];
  if (y + 4 < PH - 46) D.paragraph(p, M, y + 4, notes.join('  '), 7.2, tw, { color: PAL.muted });
}
function sectionDiagram(D, p, st, x, y, w, h) {
  const G = st.G, P = X.proposalBox(), Lm = G.length, N = 150; const prof = [], roofs = [];
  for (let i = 0; i <= N; i++) { const t = Lm * i / N, qx = G.O[0] + G.u[0] * t, qy = G.O[1] + G.u[1] * t; const gz = X.terrainZAt(qx, qy) ?? X.groundZAt(qx, qy)?.z ?? null; prof.push([t, gz]); const r = X.highestRoofAtXY(qx, qy); roofs.push(r && gz != null && r.z > gz + 1 ? [t, gz, r.z] : null); }
  const zs = prof.map((q) => q[1]).filter((v) => v != null); const ceilZ = null; // the user's study ceiling stays on the height page: drawn here it could pass for the City's unpublished cone boundary
  const zMin = Math.min(...zs, G.eyeZ) - 8, zMax = Math.max(P.top, G.eyeZ, ...roofs.filter(Boolean).map((r) => r[2]), ceilZ ?? -Infinity) * 1.08 + 10;
  const ix = x + 30, iw = w - 40, iy = y + 14, ih = h - 34; const X_ = (t) => ix + t / Lm * iw, Y_ = (z) => iy + ih - (z - zMin) / (zMax - zMin) * ih;
  D.roundRect(p, x, y, w, h, 5, { fill: PAL.white, stroke: PAL.line, width: 0.6 }); D.rect(p, ix, iy, iw, ih, PAL.sky);
  for (const r of roofs) if (r) D.rect(p, X_(r[0]) - iw / N / 2, Y_(r[2]), Math.max(0.6, iw / N), Y_(r[1]) - Y_(r[2]), PAL.building);
  const ground = prof.filter((q) => q[1] != null).map((q) => [X_(q[0]), Y_(q[1])]); if (ground.length > 1) D.poly(p, [...ground, [ground[ground.length - 1][0], iy + ih], [ground[0][0], iy + ih]], { fill: PAL.sageLight, stroke: PAL.sage, width: 0.8 });
  for (const bk of st.blocks || []) { const a = Math.max(0, bk.lo), b = Math.min(Lm, Math.max(bk.hi, a + Lm / 300)); if (b > 0 && a < Lm) D.rect(p, X_(a), Y_(bk.top), Math.max(1.6, X_(b) - X_(a)), Y_(bk.base) - Y_(bk.top), PAL.clay); } // each block, projected onto the axis
  if (ceilZ != null) { D.line(p, ix, Y_(ceilZ), ix + iw, Y_(ceilZ), PAL.clayDark, 0.8, { dash: [4, 3] }); D.text(p, ix + iw - 2, Y_(ceilZ) - 3, 'your study ceiling (assumption)', 6, false, PAL.clayDark, { align: 'right' }); }
  const ex = X_(0), ey = Y_(G.eyeZ); const steep = (st.blocks || []).filter((bk) => bk.lo > 0).sort((a, b) => (b.top - G.eyeZ) / b.lo - (a.top - G.eyeZ) / a.lo)[0]; if (steep) { const sx = X_(steep.lo), sy = Y_(steep.top), k = (sy - ey) / (sx - ex); D.line(p, ex, ey, sx, Math.max(iy, sy), PAL.sage, 0.9, { dash: [3, 2.5] }); }
  D.circle(p, ex, ey, 3.2, { fill: PAL.sage, stroke: PAL.white, width: 0.8 });
  D.text(p, x + 8, y + 11, 'Section along the cone axis', 7.5, true, PAL.ink); D.text(p, x + w - 8, y + 11, `vertical exaggeration ×${fmt((ih / (zMax - zMin)) / (iw / Lm), 0)}`, 6.3, false, PAL.muted, { align: 'right' });
  for (let k = 0; k <= 4; k++) { const t = Lm * k / 4; D.text(p, X_(t), iy + ih + 9, (t / 1000).toFixed(1) + ' km', 5.8, false, PAL.muted, { align: k === 0 ? 'left' : k === 4 ? 'right' : 'center' }); }
  D.text(p, ix - 3, Y_(zMax - 10) + 2, fmt(zMax - 10, 0) + ' m', 5.6, false, PAL.muted, { align: 'right' }); D.text(p, ix - 3, Y_(zMin + 8) + 2, Math.round(zMin + 8) + 0 + ' m', 5.6, false, PAL.muted, { align: 'right' });
  D.text(p, ex + 5, ey - 4, 'eye 1.6 m', 5.8, true, PAL.sage);
}
function conePlan(D, p, st, x, y, w, h, opts) {
  const P = X.proposalBox(), pts = [...st.cone.polygon_model_xy, ...footprintPoints()]; const spec = planSpec(boundsOf(pts, 60), w / h, 1.05);
  const img = cap(Object.assign({ width: 760, height: Math.round(760 * h / w) }, spec), opts); const to = frameImage(D, p, img, x, y, w, h);
  D.clip(p, x, y, w, h, () => { const pp = st.cone.polygon_model_xy.map((q) => to([q[0], q[1], 0])); const colr = st.relation === 'overlap' ? PAL.clay : st.relation === 'touch' ? PAL.amber : PAL.sage;
    if (pp.every(Boolean)) D.poly(p, pp, { fill: colr, alpha: 0.14, stroke: colr, width: 1 });
    const o = to([st.G.O[0], st.G.O[1], 0]), e = to([st.G.O[0] + st.G.u[0] * st.G.length, st.G.O[1] + st.G.u[1] * st.G.length, 0]); if (o && e) D.line(p, o[0], o[1], e[0], e[1], PAL.sage, 0.6, { dash: [3, 2] });
    for (const part of X.proposalParts()) { const q = X.partFootprint(part).map((v) => to([v[0], v[1], 0])); if (q.every(Boolean)) D.poly(p, q, { fill: PAL.clay, stroke: PAL.clayDark, width: 0.6 }); }
    const pc = to([P.cx, P.cy, 0]); if (pc) D.circle(p, pc[0], pc[1], 5, { stroke: PAL.clayDark, width: 1.2 });
    if (o) { D.circle(p, o[0], o[1], 4, { fill: PAL.sage, stroke: PAL.white, width: 1 }); tag(D, p, o[0] + 6, o[1] + 3, 'origin', { size: 6, color: PAL.sage, bold: true }); } });
  northArrow(D, p, x + w - 15, y + 19, 10); scaleBar(D, p, x + 10, y + h - 10, w / (2 * spec.half * (w / h)), w * 0.3);
}
function coneFrame(D, p, st, caps, label, c, fx, top, iw, ih) { const to = frameImage(D, p, c, fx, top, iw, ih), P = caps.P, row = st.row;
  D.clip(p, fx, top, iw, ih, () => {
    const G = st.G; for (const v of [G.left, G.right]) { const a = to([v[0], v[1], G.eyeZ]), b = to([v[0], v[1], G.eyeZ + 1500]); const seg = a && b ? lineThroughFrame(a, b, fx, top, iw, ih) : null; if (seg) { D.line(p, seg[0][0], seg[0][1], seg[1][0], seg[1][1], PAL.white, 2.2, { alpha: 0.85 }); D.line(p, seg[0][0], seg[0][1], seg[1][0], seg[1][1], PAL.sage, 1, { dash: [5, 3] }); } }
    if (P) { const cs = []; for (const qx of [P.box[0], P.box[3]]) for (const qy of [P.box[1], P.box[4]]) for (const qz of [P.box[2], P.box[5]]) { const q = to([qx, qy, qz]); if (q) cs.push(q); }
      if (cs.length) { const bx = boundsOf(cs, 3); if (bx[2] > fx && bx[0] < fx + iw && bx[3] > top && bx[1] < top + ih) { D.roundRect(p, bx[0], bx[1], bx[2] - bx[0], bx[3] - bx[1], 3, { stroke: PAL.clay, width: 1.3, dash: label === 'Existing' ? [3, 2] : null });
        tag(D, p, Math.min(fx + iw - 4, Math.max(fx + 4, bx[0])), Math.max(top + 12, bx[1] - 4), label === 'Existing' ? 'proposal site (not built)' : `proposal · top ${upDown(st.topAngle)}`, { size: 6.3, bold: true, color: PAL.clayDark }); } } }
  });
  tag(D, p, fx + 6, top + 14, label.toUpperCase(), { size: 7, bold: true, color: PAL.white, fill: label === 'Existing' ? PAL.muted : PAL.sage, alpha: 0.95 });
  tag(D, p, fx + iw / 2, top + 14, `toward ${row?.subject || 'the view subject'}`, { size: 6.5, align: 'center', color: PAL.ink }); }
function coneFacts(D, p, st, fx, y, fw, maxY) { const row = st.row;
  const facts = [['Origin', row?.origin_point || '-'], ['Subject', row?.subject || '-'], ['Approved', row?.date_approved || '-'], ['In plan', relationText(st.relation) + (st.relation === 'none' && st.gap != null ? ` · ${fmt(st.gap, 0)} m away` : '')],
    ['Distance', `${fmt(st.near, 0)} m from origin to proposal`], ['Top of proposal', st.topAngle == null ? '-' : `${fmt(Math.abs(st.topAngle), 1)}° ${st.topAngle < 0 ? 'below' : 'above'} the eye`], ['Cone spread', `${fmt(st.cone.spread_deg ?? deg(st.G.half * 2), 1)}° in plan`], ['Lower boundary', 'Not in open data']];
  for (const [k, v] of facts) { D.text(p, fx, y, k.toUpperCase(), 5.8, true, PAL.faint, { spacing: 0.4 }); y = D.paragraph(p, fx, y + 8.5, v, 7.3, fw, { color: k === 'Lower boundary' ? PAL.clayDark : PAL.ink, bold: k === 'In plan' }) + 4; if (y > maxY) break; } }
function drawConePage(D, p, st, opts, caps, tpl) {
  const row = st.row; header(D, p, `Protected view ${st.id}`, `${st.cone.name}`, st.relation === 'none' ? 'Context view' : 'Protected view');
  D.text(p, M, 74, `${row?.origin_point || 'Origin point'}  →  ${row?.subject || 'view subject'}`, 9, false, PAL.muted); chip(D, p, PW - M, 75, relationShort(st.relation), st.relation === 'none' ? 'context' : st.relation, { align: 'right', size: 7.5 });
  const top = 86, gap = 12, both = !!caps.existing, iw = both ? (PW - 2 * M - gap) / 2 : PW - 2 * M, ih = iw / caps.aspect;
  if (both) { coneFrame(D, p, st, caps, 'Existing', caps.existing, M, top, iw, ih); coneFrame(D, p, st, caps, 'Proposed', caps.proposed, M + iw + gap, top, iw, ih); }
  else coneFrame(D, p, st, caps, 'Proposed', caps.proposed, M, top, iw, ih);
  D.text(p, M, top + ih + 11, `Eye 1.6 m above the modelled ground at the open-data origin point; horizontal field ${fmt(caps.hfov, 0)}°, looking along the cone axis. Dashed lines: the cone's two vertical boundaries. Mountains: approximate SRTM backdrop.`, 6.6, false, PAL.muted);
  const by = top + ih + 22, bh = PH - by - 36;
  if (tpl === 'full') { const sw = 360; sectionDiagram(D, p, st, M, by, sw, bh); const kx = M + sw + 12, kw = 190; conePlan(D, p, st, kx, by, kw, bh, opts); coneFacts(D, p, st, kx + kw + 14, by + 8, PW - M - (kx + kw + 14), PH - 50); }
  else { const kw = Math.min(300, bh * 1.35); conePlan(D, p, st, M, by, kw, bh, opts); const fx = M + kw + 18, colW = (PW - M - fx - 16) / 2;
    coneFacts(D, p, st, fx, by + 8, colW, by + bh + 40); D.roundRect(p, fx + colW + 16, by, colW, Math.min(bh, 120), 6, { fill: PAL.paper });
    D.paragraph(p, fx + colW + 26, by + 15, 'The City defines each protected view by an origin point, two vertical boundaries (the dashed lines) and a horizontal lower boundary. That height is not in the open data, so this page shows the view and the plan relation only. Clause 3.1.1 asks that no part of a building encroach into the cone.', 7, colW - 20, { color: PAL.muted, leading: 1.32 }); }
}
// distance from a point to the nearest edge of a footprint polygon (its nearest facade), not just to a corner
function nearestEdge(poly, e) { let best = Infinity; for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length], vx = b[0] - a[0], vy = b[1] - a[1], L = vx * vx + vy * vy, t = L ? Math.max(0, Math.min(1, ((e[0] - a[0]) * vx + (e[1] - a[1]) * vy) / L)) : 0; best = Math.min(best, Math.hypot(a[0] + t * vx - e[0], a[1] + t * vy - e[1])); } return best; }
function drawObserver(D, p, opts, tpl) {
  const st = S(), eye = X.observerEye(), P = X.proposalBox(); header(D, p, 'Your viewpoint', st.observerSource === 'origin' ? (st.viewpoint ? `From the origin of view ${st.viewpoint}` : 'From a protected view origin') : st.observerSource === 'rooftop' ? 'From a modelled rooftop' : 'From a point you chose', 'Viewpoint');
  const withPlan = tpl === 'plan', iw = withPlan ? 520 : PW - 2 * M, ih = withPlan ? 360 : PH - 74 - 96, w = 1700;
  // nearest distance and the angles to the proposal's top and base (same measure as the protected-view pages)
  let d = null, ang = null, angBase = null; if (P) for (const part of X.proposalParts()) { const nr = nearestEdge(X.partFootprint(part), eye), a = deg(Math.atan2(part.box[5] - eye[2], Math.max(1, nr))); if (ang === null || a > ang) { ang = a; d = nr; angBase = deg(Math.atan2(P.base - eye[2], Math.max(1, nr))); } }
  // when the proposal is in the user's line of sight but cut off at the top or bottom, tilt and widen (up to 90°) so the page shows all of it
  let fov = st.fov, pitch = deg(st.cams.observer.pitch), fitted = false;
  if (P) { const hf = 2 * deg(Math.atan(Math.tan(fov * Math.PI / 360) * iw / ih)), bearing = deg(Math.atan2(P.cy - eye[1], P.cx - eye[0])), dy = Math.abs(((bearing - deg(st.cams.observer.yaw)) % 360 + 540) % 360 - 180);
    if (dy < hf / 2 && (ang > pitch + fov / 2 - 2 || angBase < pitch - fov / 2 + 2)) { fitted = true; fov = Math.min(90, Math.max(fov, ang - angBase + 8)); pitch = ang - angBase + 6 <= fov ? (ang + angBase) / 2 : ang + 4 - fov / 2; } }
  const c = cap({ mode: 'observer', width: w, height: Math.round(w * ih / iw), observer: st.observer, observerSource: st.observerSource, eyeH: st.eyeH, yaw: st.cams.observer.yaw, pitch: pitch * Math.PI / 180, fov, backdrop: true, keepViewpoint: true }, opts);
  const to = frameImage(D, p, c, M, 74, iw, ih);
  if (P) D.clip(p, M, 74, iw, ih, () => { const q = to([P.cx, P.cy, P.top]); if (q) tag(D, p, q[0], q[1] - 6, 'proposal', { align: 'center', bold: true, color: PAL.clayDark, size: 6.5 }); });
  if (withPlan) { // vector key plan: where you stand, which way you look, and the proposal
    const kx = M + iw + 16, kw = PW - M - kx, kh = ih; D.roundRect(p, kx, 74, kw, kh, 6, { fill: PAL.paper, stroke: PAL.line, width: 0.6 });
    const pts = [[eye[0], eye[1]], ...(P ? footprintPoints() : [])]; const bb = boundsOf(pts, 40), sc = Math.min((kw - 30) / (bb[2] - bb[0]), (kh - 50) / (bb[3] - bb[1])), cx = (bb[0] + bb[2]) / 2, cy = (bb[1] + bb[3]) / 2;
    const T = (q) => [kx + kw / 2 + (q[0] - cx) * sc, 74 + kh / 2 + 6 - (q[1] - cy) * sc];
    for (const part of X.proposalParts()) D.poly(p, X.partFootprint(part).map(T), { fill: PAL.clay, stroke: PAL.clayDark, width: 0.8 });
    const e = T(eye); if (P) { const pc = T([P.cx, P.cy]); D.line(p, e[0], e[1], pc[0], pc[1], PAL.clayDark, 0.7, { dash: [3, 2.5] }); tag(D, p, pc[0], pc[1] + 18, `your building · ${fmt(d, 0)} m`, { align: 'center', bold: true, color: PAL.clayDark, size: 6.8 }); }
    const yaw = st.cams.observer.yaw, half = Math.atan(Math.tan(st.fov * Math.PI / 360) * (iw / ih)), R = Math.min(kw, kh) * 0.42;
    D.poly(p, [e, [e[0] + Math.cos(yaw - half) * R, e[1] - Math.sin(yaw - half) * R], [e[0] + Math.cos(yaw + half) * R, e[1] - Math.sin(yaw + half) * R]], { fill: PAL.sage, alpha: 0.18, stroke: PAL.sage, width: 0.8 });
    D.circle(p, e[0], e[1], 7, { fill: PAL.white, stroke: PAL.sage, width: 1.6 }); D.circle(p, e[0], e[1], 2.4, { fill: PAL.sage }); tag(D, p, e[0] + 10, e[1] + 3, 'you', { bold: true, color: PAL.sage, size: 7 });
    northArrow(D, p, kx + kw - 18, 74 + 22, 10); D.text(p, kx + 10, 74 + 16, 'Where you stand', 8, true, PAL.ink); }
  let y = 74 + ih + 18; const kind = st.observerSource === 'origin' ? `the open-data origin of protected view ${st.viewpoint || ''}` : st.observerSource === 'rooftop' ? `a modelled rooftop (building ${st.observer.building?.id || ''}; roof height and access unverified)` : 'a ground point you chose';
  D.paragraph(p, M, y, `Seen from ${kind}, eye ${fmt(st.eyeH, 1)} m ${st.observerSource === 'rooftop' ? 'above the roof' : 'above the ground'}.${P ? ` Its nearest facade is ${fmt(d, 0)} m away; its top is ${fmt(Math.abs(ang), 0)}° ${ang < 0 ? 'below' : 'above'} eye level.` : ''}${fitted ? ` Eye position unchanged; for this page the camera is tilted and widened to a ${fmt(fov, 0)}° vertical field (you looked with ${fmt(st.fov, 0)}°), so more of the building shows.` : ` Vertical field ${fmt(fov, 0)}°.`} Exploratory rendering, not a verified sightline.`, 8.5, PW - 2 * M, { color: PAL.ink });
}
function drawInspect(D, p, opts, tpl) {
  const two = tpl === 'two'; header(D, p, 'Context views', two ? 'The proposal from north and south' : 'The proposal from four sides', 'Context'); const P = X.proposalBox(), h = P.top - P.base, gap = 10, iw = (PW - 2 * M - gap) / 2, ih = two ? PH - 74 - 70 : (PH - 74 - 44 - gap - 22) / 2;
  const views = two ? [['From the north', Math.PI / 2], ['From the south', -Math.PI / 2]] : [['From the north', Math.PI / 2], ['From the east', 0], ['From the south', -Math.PI / 2], ['From the west', Math.PI]];
  views.forEach(([label, az], i) => { const x = M + (i % 2) * (iw + gap), y = 74 + Math.floor(i / 2) * (ih + gap + 11);
    const c = cap({ mode: 'inspect', width: 1100, height: Math.round(1100 * ih / iw), inspect: { az, el: two ? 0.16 : 0.22, dist: Math.max(160, h * (two ? 2.2 : 2.5), Math.max(P.box[3] - P.box[0], P.box[4] - P.box[1]) * 3) } }, opts);
    frameImage(D, p, c, x, y, iw, ih); tag(D, p, x + 6, y + 14, label, { size: 7, bold: true }); });
  D.text(p, M, PH - 40, 'Camera positions orbit the proposal; the building does not move. Context heights are OpenStreetMap-derived and unverified.', 6.8, false, PAL.muted);
}
function drawHeight(D, p) {
  const st = S(), P = X.proposalBox(), r = st.check.result; header(D, p, 'Height experiment', 'Your study ceiling and the proposal', 'Height');
  // a true-scale south elevation of the blocks (their east-west extents), not a bar chart; darker clay marks what rises above the ceiling (no pass/fail red)
  const x = M, y = 80, w = 360, h = PH - y - 60; const ceil = st.check.bz, parts = X.proposalParts(); D.roundRect(p, x, y, w, h, 6, { fill: PAL.white, stroke: PAL.line, width: 0.6 });
  const zMin = P.base, zMax = Math.max(P.top, ceil), xMin = Math.min(...parts.map((q) => q.box[0])), xMax = Math.max(...parts.map((q) => q.box[3]));
  const sc = Math.min((h - 70) / Math.max(1, zMax - zMin), (w - 130) / Math.max(1, xMax - xMin)), gx = x + 64 + ((w - 130) - (xMax - xMin) * sc) / 2, gy = y + h - 34;
  const X_ = (v) => gx + (v - xMin) * sc, Y_ = (z) => gy - (z - zMin) * sc;
  const step = [5, 10, 20, 25, 50, 100].find((v) => (zMax - zMin) / v <= 8) || 200; // height ruler
  for (let v = 0; v <= zMax - zMin + 0.01; v += step) { D.line(p, x + 40, Y_(zMin + v), x + 46, Y_(zMin + v), PAL.muted, 0.5); D.text(p, x + 36, Y_(zMin + v) + 2.5, `${v} m`, 6.3, false, PAL.muted, { align: 'right' }); }
  D.line(p, x + 46, Y_(zMin), x + 46, Y_(zMin + Math.floor((zMax - zMin) / step) * step), PAL.muted, 0.5);
  D.line(p, x + 50, Y_(zMin), x + w - 14, Y_(zMin), PAL.sage, 1.2); D.text(p, x + w - 14, Y_(zMin) + 11, 'ground at the site', 6.5, false, PAL.sage, { align: 'right' });
  const shown = parts.slice(0, 12); if (parts.length > shown.length) D.text(p, x + w - 10, y + 16, `first ${shown.length} of ${parts.length} blocks`, 6.5, false, PAL.muted, { align: 'right' });
  shown.forEach((q) => { const over = q.box[5] > ceil, below = Math.min(q.box[5], ceil), x0 = X_(q.box[0]), bw = Math.max(1, (q.box[3] - q.box[0]) * sc);
    if (below > q.box[2]) D.rect(p, x0, Y_(below), bw, Y_(q.box[2]) - Y_(below), PAL.clay, PAL.clayDark); if (over) { const from = Math.max(q.box[2], ceil); D.rect(p, x0, Y_(q.box[5]), bw, Y_(from) - Y_(q.box[5]), PAL.clayDark, PAL.clayDark); } });
  const top = shown.reduce((m, q) => q.box[5] > m.box[5] ? q : m, shown[0]); D.text(p, X_(top.box[3]) + 6, Y_(top.box[5]) + 3, `${fmt(top.box[5] - P.base, 0)} m`, 8, true, PAL.clayDark);
  D.line(p, x + 50, Y_(ceil), x + w - 14, Y_(ceil), PAL.ink, 1, { dash: [6, 3] }); D.text(p, x + w - 14, Y_(ceil) - 5, `your ceiling · ${fmt(ceil - P.base, 0)} m`, 7.5, true, PAL.ink, { align: 'right' });
  D.text(p, x + 12, y + 18, 'Elevation from the south, true scale', 8, true, PAL.ink); D.text(p, x + 12, y + 29, 'Bounding boxes; the darker part is above your study ceiling.', 6.5, false, PAL.muted);
  // three plain numbers first, then one sentence, then the per-block table
  const rx = x + w + 30, rw = PW - M - rx; let yy = y + 6; const diff = P.top - ceil;
  [[`${fmt(P.top - P.base, 0)} m`, 'Proposal height'], [`${fmt(ceil - P.base, 0)} m`, 'Your study ceiling'], [`${diff > 0.05 ? '+' : ''}${fmt(diff, 0)} m`, Math.abs(diff) <= 0.05 ? 'Level with your ceiling' : diff > 0 ? 'Top above your ceiling' : 'Top below your ceiling']].forEach(([v, l], i) => { const cx = rx + i * rw / 3; D.text(p, cx, yy + 22, v, 22, true, i === 2 ? PAL.clayDark : PAL.ink); D.text(p, cx, yy + 36, l, 7.5, false, PAL.muted); });
  yy += 60; D.line(p, rx, yy, rx + rw, yy, PAL.line, 0.5); yy += 16;
  yy = D.paragraph(p, rx, yy, r ? `The proposal is ${fmt(Math.abs(diff), 0)} m ${diff > 0 ? 'taller than' : diff < 0 ? 'lower than' : 'level with'} your ${fmt(ceil - P.base, 0)} m study ceiling. This compares your design assumption only; City height limits are not assessed.` : st.check.error ? st.check.error : 'Turn the study ceiling on in Output to compute this comparison.', 9, rw, { color: PAL.ink }) + 10;
  if (r) D.table(p, rx, yy + 6, ['Block', 'Margin to study ceiling', 'Above study ceiling'], r.parts.slice(0, 14).map((q) => [q.part, fmt(q.result.signed_margin_m, 1) + ' m', fmt(q.result.penetration_m, 1) + ' m']), 8.5, [rw * 0.4, rw * 0.32, rw * 0.28]);
  D.paragraph(p, rx, PH - 92, 'The ceiling is your own design assumption, entered in the tool. It is not a City view-cone height: those horizontal lower boundaries are not published in the open data.', 8, rw, { color: PAL.muted });
}
function drawClauses(D, firstPage, tpl) {
  const g = X.assets.guideline; let p = firstPage; header(D, p, 'Guideline text', 'Selected guideline excerpts and what this tool cannot assess', 'Guidelines');
  const cards = [{ ref: g.definition.ref, page: g.definition.page, quote: g.definition.quote, a: g.definition.teaching_note, b: null }, ...g.clauses.filter((c, i) => tpl !== 'key' || i === 0).map((c) => ({ ref: 'Clause ' + c.ref, page: c.page, quote: c.quote + (c.quote_continued ? ' ' + c.quote_continued : ''), a: (c.what_the_tool_computes || '').replace(/\(INTERSECTS \/ BOUNDARY_CONTACT \/ BELOW_BOUNDARY with a signed margin\)/, '(above, touching or below the user-entered study ceiling, with a margin in metres)'), b: c.human_or_city_interpretation }))];
  const cols = 3, gap = 12, cw = (PW - 2 * M - gap * (cols - 1)) / cols; let col = 0, y = 74; const colY = [74, 74, 74];
  const measure = (c) => { let hh = 20 + Pdf.wrap('“' + c.quote + '”', 7.4, cw - 26).length * 7.4 * 1.32 + 8; for (const t of [c.a, c.b]) if (t) hh += 12 + Pdf.wrap(t, 6.9, cw - 26).length * 6.9 * 1.3 + 4; return hh + 6; };
  for (const c of cards) { const hh = measure(c); col = colY.indexOf(Math.min(...colY)); if (colY[col] + hh > PH - 40) { p = D.page(); header(D, p, 'Guideline text', 'Public Views Guidelines (continued)', 'Guidelines'); colY.fill(74); col = 0; }
    const x = M + col * (cw + gap); y = colY[col]; D.roundRect(p, x, y, cw, hh - 6, 6, { fill: PAL.paper, stroke: PAL.line, width: 0.5 }); D.rect(p, x, y + 8, 2.5, 14, PAL.clay);
    D.text(p, x + 10, y + 18, `${c.ref}`, 8, true, PAL.ink); D.text(p, x + cw - 10, y + 18, `p.${c.page}`, 6.5, false, PAL.muted, { align: 'right' });
    let yy = D.paragraph(p, x + 10, y + 32, '“' + c.quote + '”', 7.4, cw - 26, { italic: true, color: PAL.ink }) + 4;
    for (const [label, t] of [['What the tool computes', c.a], ['Left to people or the City', c.b]]) if (t) { D.text(p, x + 10, yy + 4, label.toUpperCase(), 5.8, true, PAL.sage, { spacing: 0.3 }); yy = D.paragraph(p, x + 10, yy + 13, t, 6.9, cw - 26, { color: PAL.muted, leading: 1.3 }) + 2; }
    colY[col] = y + hh; }
  const src = g.source; D.text(p, M, PH - 40, `${src.publisher}, ${src.title}, approved ${src.approved}, amended ${src.amended}. Not evaluated: ${g.out_of_scope.map((s) => s.ref).join('; ')}.`, 6.6, false, PAL.muted);
}
function drawSources(D, p) {
  header(D, p, 'Sources and limitations', 'Where the data comes from, and what it cannot tell you', 'Sources'); const t = X.technicalState(), g = X.assets.guideline;
  const rows = [['Context model', t.source ? `${t.source.filename} (sha256 ${t.source.sha256.slice(0, 12)}…), ${t.source.object_count} objects; original file preserved, browser export only.` : '-'],
    ['Ground and water', t.context_rebuild ? 'Rebuilt approximate 60 m NASA SRTM terrain with OpenStreetMap coastline and inland water; building bases shifted to the new ground.' : 'Supplied terrain plus an SRTM extension.'],
    ['Buildings outside the model', t.context_extension ? `${t.context_extension.counts.buildings.toLocaleString()} OpenStreetMap footprints (© OpenStreetMap contributors, ODbL) extruded with height rules inferred from the supplied model.` : '-'],
    ['View cones', t.view_cones_source ? `City of Vancouver open data “view-cones”, ${t.view_cones_source.records} plan polygons, accessed ${t.view_cones_source.accessed}, ${t.view_cones_source.license}. Origins are polygon apexes; by-law origin points are authoritative. No heights in the data.` : 'Not loaded.'],
    ['Model placement', t.transformation ? t.transformation.method : '-'], ['Mountains', 'NASA SRTM via Open Topo Data; approximate backdrop drawn only in eye-level views.'],
    ['Guidelines', g ? `${g.source.publisher}, ${g.source.title} (approved ${g.source.approved}, amended ${g.source.amended}).` : '-']];
  let y = D.table(p, M, 82, ['Source', 'Detail'], rows, 7.6, [130, PW - 2 * M - 130]) + 10;
  D.text(p, M, y, 'Unverified or not evaluated', 9, true, PAL.ink); y += 6;
  const items = ['The model\'s vertical datum and building heights (OpenStreetMap tags, floor counts or estimates) are unverified.', 'View-cone horizontal lower boundaries (maximum geodetic heights) are not in the open data and are never invented; vertical encroachment cannot be shown.',
    'Corridor relations are computed in plan from footprints (imported models use part bounding boxes).', 'Clauses 3.1.2 to 3.1.5 (minor encroachments), 3.3 view shadows and 3.4 Exceptional Downtown Sites need human or City judgement.',
    'Study boundaries are not legal parcels; vacancy, ownership and eligibility are unknown.', 'Rendered views are exploratory visualisations from approximate terrain and simplified buildings, not verified sightlines.',
    'This PDF uses a standard Latin-1 font, so combining marks it cannot show (such as the underlines in some Squamish place names) are dropped from the text.'];
  y += 10; for (const it of items) { D.circle(p, M + 3, y - 2.6, 1.6, { fill: PAL.clay }); y = D.paragraph(p, M + 10, y, it, 7.6, PW - 2 * M - 10, { color: PAL.ink }) + 5; }
}

// ------------------------------------------------------------------ build
async function build(options, onProgress) {
  if (!X.assets.ready) throw new Error('The model is still loading.'); const base = defaults(), opts = Object.assign({}, base, options || {}); if (!Array.isArray(opts.items)) opts.items = base.items;
  const st = S(); const compare = st.showExisting; st.showExisting = false; try { if (!st.check.unknown && X.proposalBox() && !st.check.result) { try { await X.runCheck(); } catch (_) { /* reported on the height page */ } }
  const plan = pagePlan(opts), total = imageCount(plan); let done = 0; const step = async (label) => { done++; onProgress?.(`Rendering ${label} (${Math.min(done, total)} of ${total})`); await tick(); };
  const now = new Date(), stamp = now.toISOString().slice(0, 10), dateLong = now.toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' });
  const D = new Pdf.Doc({ title: opts.title, author: opts.author, subject: 'Site, massing and protected-view study (teaching tool)' });
  const coneStudies = plan.filter((q) => q.type === 'cone').map((q) => q.study); const met = coneCandidates().filter((c) => c.relation !== 'none').length;
  const ctx = { coneStudies, met, dateLong, contents: [] }; let cover = null;
  for (const pg of plan) {
    if (pg.type === 'cover') { cover = D.page(); if (pg.tpl === 'hero' && X.proposalBox()) { const P = X.proposalBox(), h = P.top - P.base; ctx.hero = cap({ mode: 'overview', width: 1040, height: 1210, overview: { target: [P.cx, P.cy, P.base + h * 0.42], dist: Math.max(320, h * 3.6, Math.max(P.box[3] - P.box[0], P.box[4] - P.box[1]) * 6), az: -0.78, el: 0.36 } }, opts); await step('cover'); } continue; }
    const p = D.page(); const pageNo = D.pages.length;
    if (pg.type === 'cone') { if (!ctx.contents.some((c) => c[0] === 'Protected views')) ctx.contents.push(['Protected views', pageNo]); const caps = coneViewCaptures(pg.study, opts, pg.tpl); await step(`view ${pg.study.id}`); if (caps?.existing) await step(`view ${pg.study.id}, existing`);
      if (caps) drawConePage(D, p, pg.study, opts, caps, pg.tpl); else { header(D, p, `Protected view ${pg.study.id}`, pg.study.cone.name); D.text(p, M, 90, 'The origin of this view is outside the modelled ground.', 9, false, PAL.muted); } await step(`key plan ${pg.study.id}`); continue; }
    ctx.contents.push([NAMES[pg.type], pageNo]);
    if (pg.type === 'summary') { drawSummary(D, p, opts, ctx, pg.tpl); if (pg.tpl === 'plan') await step('summary plan'); }
    else if (pg.type === 'site') { drawSite(D, p, opts, pg.tpl); for (let i = 0; i < (IMAGES.site[pg.tpl] || 0); i++) await step('site'); }
    else if (pg.type === 'observer') { drawObserver(D, p, opts, pg.tpl); await step('your viewpoint'); }
    else if (pg.type === 'inspect') { drawInspect(D, p, opts, pg.tpl); for (let i = 0; i < (IMAGES.inspect[pg.tpl] || 0); i++) await step('elevations'); }
    else if (pg.type === 'height') drawHeight(D, p);
    else if (pg.type === 'clauses') drawClauses(D, p, pg.tpl);
    else if (pg.type === 'sources') drawSources(D, p);
  }
  if (cover) drawCover(D, cover, opts, ctx);
  if (!D.pages.length) { const p = D.page(); header(D, p, 'Report', 'Nothing selected'); D.text(p, M, 90, 'Choose at least one page under PDF contents.', 10, false, PAL.muted); }
  footers(D, opts, stamp); onProgress?.('Assembling the PDF…'); await tick();
  return { blob: D.build(), pages: D.pages.length, images: D.images.length, plan: plan.map((q) => q.type === 'cone' ? 'cone:' + q.study.id : q.type) };
  } finally { st.showExisting = compare; }
}

// ------------------------------------------------------------------ PDF contents builder (Output step)
// Starts from the study's default report; any change makes a custom copy, and "Reset to default" discards it.
let custom = null, exporting = false;
const clone = (o) => JSON.parse(JSON.stringify(o));
function current() { const base = defaults(); if (!custom) return base; const ids = new Set(coneCandidates().map((c) => c.id));
  return Object.assign({}, custom, { items: custom.items.filter((it) => it.key !== 'cone' || ids.has(it.id)) }); } // a view missing now (no proposal yet) comes back later
function edit(fn) { custom = custom || clone(defaults()); fn(custom); renderBuilder(); }
function isDefault() { return !custom || JSON.stringify(custom) === JSON.stringify(defaults()); }
function renderBuilder() {
  const list = $('pb-list'); if (!list || !X.assets.ready) return; const focusId = document.activeElement && list.contains(document.activeElement) ? document.activeElement.id : null;
  const o = current(), cands = coneCandidates(); const frag = document.createDocumentFragment(); let viewsHeader = false;
  o.items.forEach((it, idx) => {
    if (it.key === 'cone' && !viewsHeader) { viewsHeader = true; const h = document.createElement('p'); h.className = 'pb-group'; h.textContent = 'Protected views'; frag.appendChild(h); }
    const why = available(it.key), c = it.key === 'cone' ? cands.find((k) => k.id === it.id) : null; const row = document.createElement('div'); row.className = 'pb-row' + (it.on && !why ? '' : ' off');
    const box = document.createElement('input'); box.type = 'checkbox'; box.checked = it.on && !why; box.disabled = !!why; box.id = 'pb-item-' + idx; box.addEventListener('change', () => edit((o2) => { o2.items[idx].on = box.checked; }));
    const name = document.createElement('label'); name.className = 'pb-name'; name.htmlFor = box.id;
    name.innerHTML = c ? `${c.id} · ${c.cone.name}<small><i class="pb-dot ${c.relation === 'none' ? '' : c.relation}"></i>${relationText(c.relation)}${c.relation === 'none' && c.gap != null ? ` · ${(c.gap / 1000).toFixed(2)} km away` : ''}</small>` : `${NAMES[it.key]}${why ? `<small>${why}</small>` : ''}`;
    row.append(box, name);
    const tpls = TEMPLATES[it.key]; if (tpls.length > 1 && !why) { const wrap = document.createElement('label'); wrap.className = 'pb-tpl'; wrap.textContent = 'Layout';
      const sel = document.createElement('select'); sel.id = 'pb-tpl-' + idx; sel.setAttribute('aria-label', `Layout for ${c ? 'view ' + c.id : NAMES[it.key]}`); for (const [v, t] of tpls) sel.add(new Option(t, v, false, v === it.tpl)); sel.disabled = !box.checked;
      sel.addEventListener('change', () => edit((o2) => { o2.items[idx].tpl = sel.value; })); wrap.appendChild(sel); row.appendChild(wrap); }
    if (c && !c.default) { const rm = document.createElement('button'); rm.type = 'button'; rm.className = 'btn link pb-remove'; rm.textContent = 'Remove'; rm.addEventListener('click', () => edit((o2) => { o2.items.splice(idx, 1); })); row.appendChild(rm); }
    frag.appendChild(row); });
  list.replaceChildren(frag); if (focusId) document.getElementById(focusId)?.focus();
  const have = new Set(o.items.filter((it) => it.key === 'cone').map((it) => it.id)), add = $('pb-add-view'); add.replaceChildren(new Option('Choose a protected view…', ''));
  for (const c of cands) if (!have.has(c.id)) add.add(new Option(`${c.id} · ${c.cone.name}${c.relation === 'none' ? ` (${(c.gap / 1000).toFixed(1)} km away)` : ''}`, c.id));
  $('pb-add').disabled = add.options.length <= 1; add.disabled = add.options.length <= 1;
  $('pb-title').value = o.title; $('pb-author').value = o.author; $('pb-style').value = o.style;
  const def = isDefault(); $('pb-state').textContent = def ? 'Default' : 'Customised'; $('pb-state').classList.toggle('custom', !def); $('pb-reset').disabled = def;
  const plan = pagePlan(o); $('pdf-summary').textContent = `${plan.length} page${plan.length === 1 ? '' : 's'} · ${imageCount(plan)} rendered views`;
}
async function exportPdf() { if (exporting) return; exporting = true; const btns = [$('btn-download-pdf'), $('btn-nav-pdf')].filter(Boolean), status = $('pdf-status'); for (const b of btns) { b.disabled = true; b.classList.add('busy'); }
  try { const o = current(); const r = await build(o, (m) => { status.textContent = m; }); const a = document.createElement('a'); a.href = URL.createObjectURL(r.blob);
    a.download = (/^untitled study$/i.test(o.title.trim()) ? 'vancouver-view-study-' + new Date().toISOString().slice(0, 10) : o.title.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-|-$/g, '') || 'site-study') + '-report.pdf'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    status.textContent = `PDF exported as ${a.download} (${r.pages} pages, ${(r.blob.size / 1048576).toFixed(1)} MB). Your browser saves it to its download folder, usually Downloads.`; return r; }
  catch (e) { status.textContent = 'Could not export the PDF: ' + (e?.message || e); return null; }
  finally { exporting = false; for (const b of btns) { b.disabled = false; b.classList.remove('busy'); } } }
if ($('pb-list')) {
  $('btn-download-pdf').addEventListener('click', exportPdf);
  $('pb-reset').addEventListener('click', () => { custom = null; renderBuilder(); $('pdf-status').textContent = 'Back to the default report.'; });
  $('pb-add').addEventListener('click', () => { const id = $('pb-add-view').value; if (!id) return; edit((o) => { const at = o.items.findLastIndex((it) => it.key === 'cone'); const pos = at >= 0 ? at + 1 : o.items.findIndex((it) => it.key === 'site') + 1; o.items.splice(pos, 0, { key: 'cone', id, on: true, tpl: 'full' }); }); });
  $('pb-title').addEventListener('change', (e) => edit((o) => { o.title = e.target.value.trim() || S().studyName || 'Untitled study'; }));
  $('pb-author').addEventListener('change', (e) => edit((o) => { o.author = e.target.value.trim(); }));
  $('pb-style').addEventListener('change', (e) => edit((o) => { o.style = e.target.value; }));
}
X.ready.then(() => { if (S().flow.stage === 'output') renderBuilder(); });
window.__report = { build, defaults, pagePlan, coneCandidates, renderBuilder, exportPdf, current, reset: () => { custom = null; renderBuilder(); }, templates: TEMPLATES };
})();
