/* Browser self-test for the staged Site Explorer. Loaded only with ?selftest=1. Drives the real app through
 * window.__explorer and the DOM, then writes a JSON report into <pre id="selftest-report"> and sets the title
 * to SELFTEST DONE or SELFTEST FAILED. Teaching tool; nothing here asserts compliance. */
(async function () {
  const X = window.__explorer; const report = []; const $ = (id) => document.getElementById(id);
  const record = (step, pass, detail) => report.push({ step, pass: !!pass, detail });
  const finish = () => { const pre = document.createElement('pre'); pre.id = 'selftest-report'; pre.style.display = 'none'; pre.textContent = JSON.stringify({ steps: report, all_pass: report.every((s) => s.pass) }); document.body.appendChild(pre); document.title = report.every((s) => s.pass) ? 'SELFTEST DONE' : 'SELFTEST FAILED'; };
  const near = (a, b, tol) => Math.abs(a - b) <= tol;
  const setNum = (id, v) => { const el = $(id); el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
  const click = (px, py, id) => { const ev = (type) => new PointerEvent(type, { clientX: px, clientY: py, button: 0, pointerId: id, bubbles: true, isPrimary: true, pointerType: 'mouse' }); X.canvas.dispatchEvent(ev('pointerdown')); X.canvas.dispatchEvent(ev('pointerup')); };
  try {
    await X.ready; const m = X.assets.manifest, c = m.counts;
    // 1 assets decoded match the manifest
    record(1, X.assets.raw.buildings.idx.length / 3 === c.building_triangles && X.assets.index.count === c.buildings && c.buildings === 9897 && c.skipped_objects === 0, { buildings: c.buildings, building_triangles: c.building_triangles, source: m.source.filename, sha256_prefix: m.source.sha256.slice(0, 12) });
    // 2 something rendered
    X.resetToContext(); X.renderOnce(); const px = X.readPixel(0.5, 0.5); const bg = [237, 240, 242];
    record(2, !(near(px[0], bg[0], 3) && near(px[1], bg[1], 3) && near(px[2], bg[2], 3)), { centre_pixel: px });
    // 3 step 1: site placed through a REAL canvas click on open terrain
    X.setStep(1); X.setTool('site'); const candidates = [[700, -300], [200, -150], [0, 0], [-100, 300], [400, -600], [600, 200]]; let chosen = null;
    for (const [x, y] of candidates) { const hit = X.pickRay([x, y, 5000], [0, 0, -1]); if (hit.type === 'terrain') { chosen = [x, y, hit.point[2]]; break; } }
    X.state.cams.overview = { target: [chosen[0], chosen[1], chosen[2]], dist: 300, az: -1.2, el: 1.2 }; X.setMode('overview'); X.setTool('site'); X.renderOnce();
    let r = X.canvas.getBoundingClientRect(); click(r.left + r.width / 2, r.top + r.height / 2, 7);
    const s1 = X.state.site; record(3, !!s1 && Math.hypot(s1.x - chosen[0], s1.y - chosen[1]) < 3 && near(s1.z, chosen[2], 0.5) && /site set/.test($('step-status').textContent), { aimed_at: chosen, site: s1, status: $('step-status').textContent });
    // 4 clicking a building in site mode identifies it and leaves the site alone
    const cols = X.assets.index.columns; let bIdx = -1, bestD = Infinity; for (let i = 0; i < cols.bbox.length; i++) { const b = cols.bbox[i]; const d = Math.hypot((b[0] + b[3]) / 2 - s1.x, (b[1] + b[4]) / 2 - s1.y); if (d < bestD && (b[5] - b[2]) > 15 && (b[3] - b[0]) > 12 && (b[4] - b[1]) > 12) { bestD = d; bIdx = i; } }
    const bb = cols.bbox[bIdx]; const before = JSON.stringify(X.state.site); X.state.cams.overview = { target: [(bb[0] + bb[3]) / 2, (bb[1] + bb[4]) / 2, bb[5]], dist: 120, az: -1.2, el: 1.3 }; X.renderOnce(); r = X.canvas.getBoundingClientRect(); click(r.left + r.width / 2, r.top + r.height / 2, 8);
    record(4, X.state.selected !== null && JSON.stringify(X.state.site) === before && $('building-info').textContent.includes('osm_id'), { selected: X.state.selected, osm_id: X.state.selected !== null ? cols.osm_id[X.state.selected] : null, site_unchanged: JSON.stringify(X.state.site) === before });
    // 5 step 2: stacked blocks — podium + tower; bases stack; lowest sits on terrain
    X.setProposalMode('boxes'); X.state.parts = [{ name: 'Podium', h: 20, w: 60, d: 50, dx: 0, dy: 0 }]; X.renderPartsList(); X.addPart({ name: 'Tower', h: 130, w: 30, d: 28, dx: 5, dy: -5 });
    const P = X.proposalBox(); const tz = X.terrainZAt(s1.x, s1.y);
    record(5, !!P && P.parts.length === 2 && near(P.parts[0].box[2], tz, 1e-6) && near(P.parts[1].box[2], tz + 20, 1e-9) && near(P.top, tz + 150, 1e-9) && near(P.parts[1].box[3] - P.parts[1].box[0], 30, 1e-9), { parts: P && P.parts.map((q) => ({ name: q.name, base: +q.box[2].toFixed(2), top: +q.box[5].toFixed(2) })), terrain_z: tz });
    // 6 inspect + opposite side: camera flips, geometry unchanged
    X.setMode('inspect'); const az0 = X.state.cams.inspect.az; const geom0 = JSON.stringify(X.proposalBox().box); const cam0 = X.renderOnce(); $('cam-opposite').click(); const cam1 = X.renderOnce();
    record(6, near(((X.state.cams.inspect.az - az0) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI), Math.PI, 1e-9) && JSON.stringify(X.proposalBox().box) === geom0 && Math.hypot(cam0.eye[0] - cam1.eye[0], cam0.eye[1] - cam1.eye[1]) > 10, { eye_before: cam0.eye.map((v) => +v.toFixed(1)), eye_after: cam1.eye.map((v) => +v.toFixed(1)) });
    // 7 .obj import: a 12 m x 8 m x 40 m box in millimetres, placed on the site; bbox and base follow
    const obj = ['o Massing', 'v 0 0 0', 'v 12000 0 0', 'v 12000 8000 0', 'v 0 8000 0', 'v 0 0 40000', 'v 12000 0 40000', 'v 12000 8000 40000', 'v 0 8000 40000', 'f 1 4 3 2', 'f 5 6 7 8', 'f 1 2 6 5', 'f 2 3 7 6', 'f 3 4 8 7', 'f 4 1 5 8'].join('\n');
    const parts = X.parseObj(obj, 0.001); const okInstall = X.installImport('test.obj', parts, 'units declared: millimetres (x 0.001)'); $('import-placement').value = 'site'; X.state.imported.placement = 'site'; const PI = X.proposalBox();
    record(7, okInstall && parts.length === 1 && PI && near(PI.box[3] - PI.box[0], 12, 1e-6) && near(PI.box[4] - PI.box[1], 8, 1e-6) && near(PI.top - PI.base, 40, 1e-6) && near(PI.base, tz, 1e-6) && near(PI.cx, s1.x, 1e-6) && X.state.pmode === 'import' && X.state.imported.parts[0].triangles === 12, { bbox: PI && PI.box.map((v) => +v.toFixed(2)), triangles: X.state.imported && X.state.imported.parts[0].triangles });
    X.setProposalMode('boxes'); // back to the stacked blocks for the remaining steps
    // 8 step 3: Table 1 list, pilot 3.2.3 outside coverage (not moved), Cambie Bridge (E) origin inside -> observer at origin on terrain
    const opts = [...$('view-select').options].map((o) => o.value).filter(Boolean); X.selectView('3.2.3'); const pilot = X.selectedCone(); const pilotInfo = $('view-info').textContent; const pilotBtn = $('btn-observer-at-origin').disabled;
    const hasExt = !!X.assets.extension; // with the context extension every origin has ground; without it the pilot is outside
    const pilotOk = hasExt ? (pilot && pilot.origin_inside_model_extent === true && pilotBtn === false && X.terrainZAt(...pilot.origin_model_xy) > 60) : (pilot && pilot.origin_inside_model_extent === false && /outside the supplied model/.test(pilotInfo) && pilotBtn === true);
    let qeEye = null; if (hasExt) { X.placeObserverAtOrigin(); qeEye = X.observerEye(); }
    X.selectView('E'); const E = X.selectedCone(); const placed = X.placeObserverAtOrigin(); const eye = X.observerEye();
    record(8, opts.length === 24 && pilotOk && E && E.origin_inside_model_extent === true && placed && near(eye[0], E.origin_model_xy[0], 1e-6) && near(eye[2], X.terrainZAt(eye[0], eye[1]) + X.state.eyeH, 1e-6) && X.state.observerSource === 'origin',
      { table_1: opts.length, extension: hasExt, pilot_origin: pilot && pilot.origin_model_xy, pilot_inside: pilot && pilot.origin_inside_model_extent, pilot_eye_z: qeEye && +qeEye[2].toFixed(1), E_origin: E && E.origin_model_xy, observer_eye: eye && eye.map((v) => +v.toFixed(2)) });
    // 9 look toward proposal from the origin: camera at the eye, forward pointing at the proposal; inset shown
    const looked = X.lookTowardProposal(); const cam = X.renderOnce(); const tgt = X.proposalCentre(); const f = X.observerForward(); const d = [tgt[0] - eye[0], tgt[1] - eye[1], tgt[2] - eye[2]]; const dl = Math.hypot(...d); const dot = (f[0] * d[0] + f[1] * d[1] + f[2] * d[2]) / dl;
    record(9, looked && X.state.mode === 'observer' && near(cam.eye[0], eye[0], 1e-6) && dot > 0.9999 && !$('inset-frame').classList.contains('hidden'), { forward_dot: +dot.toFixed(6), distance_m: +dl.toFixed(1), caption: $('view-caption').textContent.slice(0, 70) });
    // 10 exploratory observer via a real click still works and is labelled exploratory
    X.setMode('overview'); X.setTool('observer'); const ox = s1.x + 260, oy = s1.y - 180; const hit = X.pickRay([ox, oy, 5000], [0, 0, -1]); let expOk = false, expDetail = { pick: hit.type };
    if (hit.type === 'terrain') { X.state.cams.overview = { target: [ox, oy, hit.point[2]], dist: 200, az: -1.2, el: 1.3 }; X.renderOnce(); r = X.canvas.getBoundingClientRect(); click(r.left + r.width / 2, r.top + r.height / 2, 9); expOk = !!X.state.observer && Math.hypot(X.state.observer.x - ox, X.state.observer.y - oy) < 3 && X.state.observerSource === 'exploratory'; expDetail = { observer: X.state.observer, source: X.state.observerSource }; }
    else { X.placeObserver(ox + 100, oy + 100, 'exploratory'); expOk = X.state.observerSource === 'exploratory'; }
    record(10, expOk, expDetail);
    // 11 step 4: hypothetical check equals the API/Python for the stacked boxes; explanation and clause cards present
    X.setStep(2); $('chk-bz-unknown').checked = false; $('chk-bz-unknown').dispatchEvent(new Event('change')); const P2 = X.proposalBox(); const bz = P2.base + 100; setNum('check-bz', bz); const res = await X.runCheck();
    const clauseRefs = [...document.querySelectorAll('#clause-cards .ref')].map((e) => e.textContent); const expectedPen = P2.top - bz;
    record(11, !!res && res.overall_result === 'INTERSECTS' && near(res.max_penetration_m, expectedPen, 1e-6) && res.parts.length === 2 && res.parts[0].result.geometric_result === 'BELOW_BOUNDARY' && res.regulatory_applicability === 'NOT ASSESSED' && /HYPOTHETICAL/.test(res.label) && /above your (study )?ceiling/.test($('check-badge').textContent) && /design assumption/.test($('check-explain').textContent) && clauseRefs.some((t) => /3\.1\.5/.test(t)) && clauseRefs.some((t) => /p\.3/.test(t)),
      { overall: res && res.overall_result, max_penetration: res && res.max_penetration_m, expected: +expectedPen.toFixed(6), per_part: res && res.parts.map((p) => p.result.geometric_result), clause_cards: clauseRefs.length });
    // 12 unknown height -> CANNOT_DETERMINE
    $('chk-bz-unknown').checked = true; $('chk-bz-unknown').dispatchEvent(new Event('change')); const res2 = await X.runCheck();
    record(12, !!res2 && res2.overall_result === 'CANNOT_DETERMINE' && res2.max_penetration_m === null && /City view height limits are not loaded/.test($('check-explain').textContent), { overall: res2 && res2.overall_result });
    $('chk-bz-unknown').checked = false; $('chk-bz-unknown').dispatchEvent(new Event('change')); await X.runCheck();
    // 13 step 5: report carries the four statement kinds and the unverified list; state JSON labelled
    X.setStep(3); const rep = $('report').textContent; const tech = X.technicalState();
    const c13 = { source: /Source statement/.test(rep), determ: /Deterministic computation/.test(rep), ai: /Explanation/.test(rep), human: /Human or City interpretation/.test(rep), unverified: /Unverified/.test(rep), clause: /3\.1\.1/.test(rep), applicability: tech.regulatory_applicability === 'NOT ASSESSED', viewpoint_height_null: !!tech.viewpoint && tech.viewpoint.height_boundary === null, check: !!tech.check && tech.check.overall_result === 'INTERSECTS' };
    record(13, Object.values(c13).every(Boolean), Object.assign({ report_chars: rep.length, viewpoint: tech.viewpoint && tech.viewpoint.view_number }, c13));
    // 14 hash round trip keeps site, blocks, observer, view, boundary and step
    await new Promise((res3) => setTimeout(res3, 250)); const hash = location.hash; const snap = { site: { ...X.state.site }, obs: { ...X.state.observer }, parts: JSON.stringify(X.state.parts), view: X.state.viewpoint, bz: X.state.check.bz, step: X.state.step };
    X.state.site = null; X.state.observer = null; X.state.parts = []; X.state.viewpoint = null; X.applyHash(hash); X.renderOnce();
    const samePt = (a, b) => !!a && !!b && near(a.x, b.x, 1e-3) && near(a.y, b.y, 1e-3);
    const canon = (parts) => JSON.stringify(parts.map((q) => [q.name, q.h, q.w, q.d, q.dx, q.dy]));
    const c14 = { site: samePt(X.state.site, snap.site), observer: samePt(X.state.observer, snap.obs), parts: canon(X.state.parts) === canon(JSON.parse(snap.parts)), view: X.state.viewpoint === snap.view, bz: near(X.state.check.bz, snap.bz, 1e-9), step: X.state.step === snap.step, hash_has_parts: /parts=/.test(hash), hash_has_view: /view=E/.test(hash) };
    record(14, Object.values(c14).every(Boolean), Object.assign({ hash_length: hash.length, step: X.state.step, view: X.state.viewpoint }, c14));
    // 15 wording: the tool's own text never claims compliance; source quotes are marked as quotes
    const own = [...document.body.querySelectorAll('*')].filter((e) => !e.closest('.source-quote') && e.children.length === 0).map((e) => e.textContent).join(' ').toLowerCase();
    record(15, !/\bcompliant\b|permitted height/.test(own) && document.body.innerText.includes('not a protected-view assessment') && document.querySelectorAll('.source-quote').length >= 6, { source_quotes: document.querySelectorAll('.source-quote').length });
    // 16 PDF report: valid header, six pages, at least five embedded views
    await X.runCheck(); const blob = await X.buildPdfReport(); const bytes = new Uint8Array(await blob.arrayBuffer()); const head = String.fromCharCode(...bytes.slice(0, 8)); const txt = new TextDecoder('latin1').decode(bytes);
    const nImg = (txt.match(/\/Subtype \/Image/g) || []).length; const nPages = (txt.match(/\/Type \/Page\b/g) || []).length;
    const expectedPages = window.__report.pagePlan(window.__report.defaults()).length; record(16, head.startsWith('%PDF-1.4') && nPages === expectedPages && nPages >= 6 && nImg >= 5 && bytes.length > 20000 && /%%EOF/.test(txt.slice(-40)), { bytes: bytes.length, pages: nPages, images: nImg });
    if (new URLSearchParams(location.search).get('pdfdump') === '1') { const pre = document.createElement('pre'); pre.id = 'pdf-b64'; pre.style.display = 'none'; let b64 = ''; for (let i = 0; i < bytes.length; i += 0x8000) b64 += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); pre.textContent = btoa(b64); document.body.appendChild(pre); }
    // 17 mountain backdrop: present when the server has it; drawn only in the observer view
    const bmResp = await window.ProjectAPI.fetch('/generated/backdrop_manifest.json'); const hasBd = bmResp.ok; const bd = X.assets.backdrop;
    record(17, hasBd ? (!!bd && bd.files.backdrop.indices.triangles > 1000 && X.state.showBackdrop && !$('chip-backdrop').classList.contains('hidden')) : (bd === null && $('chk-backdrop').disabled),
      { server_has_backdrop: hasBd, loaded: !!bd, triangles: bd && bd.files.backdrop.indices.triangles, max_elevation_m: bd && bd.files.backdrop.max_elevation_m, source: bd && bd.source.source.slice(0, 60) });
    // 18 cone display defaults: only the selected cone is drawn unless "All cone outlines" is on; toolbar reflects the mode
    record(18, X.state.showAllCones === false && $('chk-cones').checked === false && !$('tools').classList.contains('hidden') && $('mode-overview').classList.contains('active') && X.state.step === 3, { showAllCones: X.state.showAllCones, mode: X.state.mode });
    // 19 context extension: when built, all 24 origins report ground; extension buildings never sit inside the supplied extent
    const emr = await window.ProjectAPI.fetch('/generated/extension_manifest.json'); const ext = X.assets.extension;
    if (emr.ok) { const cones = X.assets.cones.cones; const allInside = cones.every((c) => c.origin_inside_model_extent); const allGround = cones.every((c) => X.groundZAt(...c.origin_model_xy) !== null); const onWater = cones.filter((c) => (X.groundZAt(...c.origin_model_xy) || {}).source === 'water').map((c) => c.view_number);
      record(19, !!ext && allInside && allGround && ext.counts.buildings > 10000 && !$('chip-extension').classList.contains('hidden'), { buildings: ext && ext.counts.buildings, all_origins_inside: allInside, all_origins_on_ground: allGround, standing_on_water: onWater }); }
    else record(19, ext === null, { extension: 'not built on this server' });
  } catch (e) { record('exception', false, { message: String(e && e.message || e), stack: String(e && e.stack || '').slice(0, 500) }); }
  finish();
})();
