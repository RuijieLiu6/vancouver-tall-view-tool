/* Browser test: load with ?rooftest=1 after explorer.js. */
(async function () {
  const tests = [], record = (name, pass, detail) => tests.push({ name, pass: !!pass, detail });
  const close = (a, b, tolerance = 0.05) => Number.isFinite(a) && Math.abs(a - b) <= tolerance;
  const X = window.__explorer;
  let originalHash = null;
  try {
    if (!X) throw new Error('Explorer is unavailable');
    await X.ready; originalHash = X.serializeHash(); X.restoreBuildings();
    const findRoof = (ext) => {
      const c = (ext ? X.assets.extIndex : X.assets.index)?.columns; if (!c) return null;
      const stride = Math.max(1, Math.floor(c.bbox.length / 350));
      for (let i = 0; i < c.bbox.length; i += stride) {
        const b = c.bbox[i]; if (b[3] - b[0] < 8 || b[4] - b[1] < 8 || b[5] - b[2] < 5) continue;
        const p = X.preferredRoofPoint(i, ext); if (!p) continue;
        const hit = X.pickRay([p.x, p.y, b[5] + 300], [0, 0, -1]);
        if (hit.type === 'building' && hit.index === i && !!hit.ext === ext && close(hit.point[2], p.z)) return { i, ext, p, b };
      }
      return null;
    };
    const supplied = findRoof(false), extension = findRoof(true);
    record('real supplied and extension roofs use indexed surface triangles', !!supplied && !!extension,
      { supplied: supplied?.i, extension: extension?.i });

    if (supplied) {
      const placed = X.placeRooftopAtXY(supplied.p.x, supplied.p.y);
      const ob = JSON.parse(JSON.stringify(X.state.observer)), exported = JSON.parse(JSON.stringify(X.technicalState())), hash = X.serializeHash();
      const metadata = placed && ob?.ground === 'roof' && ob.building?.source === 'supplied' &&
        exported.observer?.roof_model_height_unverified === true && exported.observer?.eye_height_reference === 'above modelled roof surface';
      record('rooftop placement enters observer mode and exports source and uncertainty', metadata && X.state.mode === 'observer',
        { observer: ob, report: exported.observer });
      X.state.observer.z = -999; X.applyHash(hash);
      record('hash restores stable building ID and recomputes roof elevation', X.state.observerSource === 'rooftop' &&
        X.state.observer?.building?.id === ob.building.id && close(X.state.observer?.z, supplied.p.z) && X.state.mode === 'observer',
        { restored: X.state.observer });
      const bad = new URLSearchParams(hash.slice(1)); bad.set('roof', 's:no-such-building'); X.applyHash('#' + bad);
      record('missing building invalidates rooftop observer without falling to terrain', X.state.observer === null && X.state.mode !== 'observer');
      const removed = new URLSearchParams(hash.slice(1)); removed.set('removed', 's:' + ob.building.id); removed.set('existing', '0'); X.applyHash('#' + removed);
      record('hidden removed building invalidates saved rooftop observer', X.state.observer === null && X.state.mode !== 'observer');
      removed.set('existing', '1'); X.applyHash('#' + removed);
      record('existing comparison can restore rooftop observer on retained mesh', X.state.observer?.ground === 'roof' && close(X.state.observer.z, supplied.p.z));
      X.restoreBuildings(); X.state.selected = supplied.i; X.state.selectedExt = false;
      const selectedAction = X.viewFromSelectedRoof();
      record('selected-building action chooses its visible roof and enters observer camera', selectedAction && X.state.mode === 'observer' &&
        X.state.observer?.building?.id === ob.building.id && close(X.state.observer.z, X.roofZAt(supplied.i, false, X.state.observer.x, X.state.observer.y)?.z));
      X.state.site = { x: supplied.p.x + 20, y: supplied.p.y + 20, z: 0 };
      const retainedSite = X.state.site, retainedObserver = X.state.observer;
      const focused = X.focusLocation(supplied.p.x, supplied.p.y), camera = X.state.cams.overview;
      const beforeInvalid = JSON.stringify(camera);
      const rejected = !X.focusLocation(NaN, supplied.p.y) && !X.focusLocation(1e9, 1e9);
      record('address focus centres plan while preserving site, proposal and observer', focused && rejected && X.state.mode === 'plan' &&
        close(camera.target[0], supplied.p.x) && close(camera.target[1], supplied.p.y) && camera.dist === 500 &&
        X.state.site === retainedSite && X.state.observer === retainedObserver && JSON.stringify(camera) === beforeInvalid);
      document.getElementById('btn-find-building').click();
      record('site action opens rooftop selection in plan without moving study geometry', X.state.mode === 'plan' &&
        X.state.tool === 'rooftop' && X.state.site === retainedSite && X.state.observer === retainedObserver);
    }
    if (extension) {
      const ok = X.placeRoofObserver(extension.i, true, extension.p.x, extension.p.y);
      record('extension roof retains extension source and height metadata', ok && X.state.observer?.building?.source === 'extension' &&
        X.state.observer.building.id === String(X.assets.extIndex.columns.osm_id[extension.i]) && close(X.state.observer.z, extension.p.z));
    }

    // Swap in a small concave prism briefly to exercise geometry cases that a
    // particular real building may not contain. Its AABB includes empty air.
    const realIndex = X.assets.index, realRaw = X.assets.raw.buildings, realExt = X.assets.extIndex, realReady = X.assets.ready;
    try {
      const pos = new Float32Array([
        0,0,10, 10,0,10, 10,4,10, 0,4,10,
        0,4,10, 4,4,10, 4,10,10, 0,10,10,
        10,0,0, 10,4,0,
      ]);
      const idx = new Uint32Array([0,1,2, 0,2,3, 4,5,6, 4,6,7, 1,8,9, 1,9,2]);
      X.assets.index = { columns: { bbox: [[0,0,0,10,10,10]], index_offset: [0], index_count: [idx.length], osm_id: ['concave'], height_m: [10], height_source: [0] } };
      X.assets.raw.buildings = { pos, idx }; X.assets.extIndex = null; X.assets.ready = true;
      const onRoof = X.roofZAt(0, false, 2, 2), empty = X.roofZAt(0, false, 7, 7);
      record('concave AABB void is rejected; a roof triangle resolves at exact XY', close(onRoof?.z, 10) && empty === null,
        { roof: onRoof, empty });
      X.state.observer = null; X.state.selected = null; X.setTool('rooftop'); X.applyPick({ type: 'building', index: 0, ext: false, point: [10, 2, 5] });
      record('facade click relocates to a real roof triangle rather than AABB air', X.state.observer?.ground === 'roof' &&
        X.state.observer.building.id === 'concave' && close(X.state.observer.z, 10) && X.roofZAt(0, false, X.state.observer.x, X.state.observer.y) !== null);
    } finally { X.assets.index = realIndex; X.assets.raw.buildings = realRaw; X.assets.extIndex = realExt; X.assets.ready = realReady; }
  } catch (error) { record('exception', false, { message: String(error?.message || error), stack: String(error?.stack || '').slice(0, 700) }); }
  finally {
    if (originalHash && X) try { X.applyHash(originalHash); } catch (error) { record('restore original study', false, String(error)); }
    const result = { tests, all_pass: tests.length > 0 && tests.every(t => t.pass) };
    const pre = document.createElement('pre'); pre.id = 'rooftop-selftest-result'; pre.style.display = 'none'; pre.textContent = JSON.stringify(result); document.body.appendChild(pre);
    document.title = result.all_pass ? 'ROOFTEST DONE' : 'ROOFTEST FAIL';
  }
})();
