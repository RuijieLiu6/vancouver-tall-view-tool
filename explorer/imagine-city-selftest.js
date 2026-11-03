/* App-owned, reversible same-model verification. ?imaginetest=1 */
(function (root) {
  'use strict';
  if (root.__imagineCitySelftestRunning) return;
  root.__imagineCitySelftestRunning = true;
  const doc = root.document, tests = [], timings = {}, started = performance.now();
  const check = (name, pass, details) => tests.push({name, pass:!!pass, ...(details === undefined ? {} : {details})});
  const pause = ms => new Promise(resolve => root.setTimeout(resolve, ms));
  const frame = () => new Promise(resolve => root.requestAnimationFrame(resolve));
  const $ = id => doc.getElementById(id);
  let X, UI, originalStyle, originalModel, originalCamera, originalPositions, positionRefs, originalCanvas;
  let heartbeat, lastTick = performance.now(), maxGap = 0, ticks = 0;
  function modelSnapshot() {
    const s = X.state;
    return JSON.stringify({site:s.site, parts:s.parts, removed:s.removed, cleared:s.cleared, boundary:s.boundary, pmode:s.pmode,
      imported:s.imported?.name, viewpoint:s.viewpoint, observer:s.observer, observerSource:s.observerSource});
  }
  function cameraSnapshot() {
    const s = X.state;
    return JSON.stringify({mode:s.mode, cams:s.cams, fov:s.fov, eyeH:s.eyeH, look:s.look});
  }
  function positionChecksum() {
    const sums = {}; let words = 0;
    for (const key of ['buildings','ext_buildings']) {
      const pos = X.assets.raw?.[key]?.pos;
      if (!pos || !ArrayBuffer.isView(pos) || pos.byteLength % 4) throw new Error('Source building vertices are unavailable');
      const view = new Uint32Array(pos.buffer, pos.byteOffset, pos.byteLength / 4);
      words += view.length; if (words > 12000000) throw new Error('Source checksum work budget exceeded');
      let hash = 2166136261;
      for (let i = 0; i < view.length; i++) hash = Math.imul(hash ^ view[i], 16777619) >>> 0;
      sums[key] = {words:view.length, hash};
    }
    return JSON.stringify(sums);
  }
  function sourceUnchanged() {
    return positionChecksum() === originalPositions && positionRefs.every((pos, i) => pos === X.assets.raw[['buildings','ext_buildings'][i]].pos);
  }
  async function until(predicate, timeout, label) {
    const deadline = performance.now() + timeout;
    while (!predicate()) {
      if (performance.now() >= deadline) throw new Error(label + ' timed out');
      await pause(40);
    }
  }
  async function settled(scenario) {
    await until(() => {
      const s = UI.getState();
      return s.error || s.open && s.loaded && !s.loading && !s.calculating && s.stats && (!scenario || s.scenario === scenario);
    }, 30000, 'Imagine calculation');
    if (UI.getState().error) throw new Error(UI.getState().error);
    await frame();
  }
  function invariant(name) {
    check(name + ': proposal, location and removals stay intact', modelSnapshot() === originalModel);
    check(name + ': original source vertex buffers stay intact', sourceUnchanged());
    check(name + ': camera and view mode stay intact', cameraSnapshot() === originalCamera);
    check(name + ': the same single canvas remains in use', X.canvas === originalCanvas && doc.querySelectorAll('canvas').length === 1);
  }
  function glStatus(name) {
    X.renderOnce();
    const error = X.gl.getError();
    check(name + ': WebGL reports no error', error === X.gl.NO_ERROR, {error});
  }
  (async () => {
    doc.title = 'IMAGINE CITY CHECKING';
    heartbeat = root.setInterval(() => {const now = performance.now(); maxGap = Math.max(maxGap, now - lastTick); lastTick = now; ticks++;}, 20);
    try {
      await until(() => root.__explorer && root.VistaImagineCity, 10000, 'Imagine module');
      X = root.__explorer; UI = root.VistaImagineCity;
      let readyTimer;
      try {
        await Promise.race([X.ready, new Promise((_, reject) => {readyTimer = root.setTimeout(() => reject(new Error('Main model startup timed out')), 120000);})]);
      } finally {root.clearTimeout(readyTimer);}
      check('the main model has loaded before Imagine is assessed', X.assets.ready === true);
      if (UI.getState().open) await settled();
      UI.close(); await frame();
      const normalCollapsed = $('panel').classList.contains('collapsed');
      const normalRailDisplay = root.getComputedStyle($('flow-rail')).display;
      originalStyle = X.state.sceneStyle; originalModel = modelSnapshot(); originalCamera = cameraSnapshot();
      originalPositions = positionChecksum(); positionRefs = ['buildings','ext_buildings'].map(key => X.assets.raw[key].pos); originalCanvas = X.canvas;
      const openStarted = performance.now(); UI.open(); await settled(); timings.firstOpenMs = performance.now() - openStarted;
      check('Imagine replaces the sidebar without opening the legacy model', UI.getState().open && !$('vista-imagine') && !$('imagine-canvas'));
      check('Imagine uses the existing canvas and loaded model objects', X.canvas === originalCanvas && doc.querySelectorAll('canvas').length === 1);
      const provider = root.VistaViewcone.getCitySurfaces({heightM:UI.getState().studyHeightM, reference:[0,0]});
      check('all 24 mapped corridor surfaces have finite compatible coefficients', provider.planes.length === 24 && new Set(provider.planes.map(p => p.id)).size === 24 &&
        provider.planes.every(p => [p.plane?.a, p.plane?.b, p.plane?.c].every(Number.isFinite)), {count:provider.planes.length});
      const geometry = ['surface','walls','edges'].map(key => provider.scene?.[key]);
      const geometryValues = geometry.reduce((sum, array) => sum + (array?.length || 0), 0);
      check('all view-cone overlay vertices are finite within a bounded display', geometryValues > 0 && geometryValues <= 1000000 &&
        geometry.every(array => array && array.length % 3 === 0 && Array.from(array).every(Number.isFinite)), {values:geometryValues});
      const active = X.imagineCityRenderState();
      check('the live renderer has active height attributes', active.active && active.bytes > 0 && active.uploads > 0, active);
      invariant('Initial Imagine');
      for (const scenario of ['existing','zoning','views']) {
        const scenarioStarted = performance.now(); UI.setScenario(scenario); await settled(scenario); timings[scenario + 'Ms'] = performance.now() - scenarioStarted;
        const s = UI.getState();
        check(scenario + ': all source building records are present', s.stats?.buildingCount === 61407 && !s.error && s.loaded, {buildings:s.stats?.buildingCount,changed:s.stats?.changedBuildings});
        if (scenario === 'existing') check('Existing preserves every original building height', s.stats.changedBuildings === 0);
        invariant(scenario); glStatus(scenario);
      }
      for (const style of ['collage','night','context']) {
        X.setSceneStyle(style, false); await frame();
        check('rendering style remains selectable: ' + X.SCENE_STYLES[style].name, X.state.sceneStyle === style && UI.getState().open);
        glStatus(style); invariant(style);
      }
      X.setSceneStyle(originalStyle, false); await frame();
      const beforeClose = UI.getState();
      UI.close(); await frame();
      const closed = X.imagineCityRenderState();
      check('returning to the study releases Imagine height buffers', !closed.active && closed.bytes === 0, closed);
      check('returning restores the normal sidebar state', !doc.body.classList.contains('imagine-city-open') && $('imagine-city-panel').hidden &&
        $('panel').classList.contains('collapsed') === normalCollapsed && root.getComputedStyle($('flow-rail')).display === normalRailDisplay);
      invariant('Returned study'); glStatus('Returned study');
      const reopenStarted = performance.now(); UI.open(); await settled('views'); timings.reopenMs = performance.now() - reopenStarted;
      const reopened = UI.getState();
      check('reopening reuses the prepared data and cached result arrays', reopened.loaded && reopened.cacheHits > beforeClose.cacheHits && reopened.cacheEntries <= 6,
        {cacheHitsBefore:beforeClose.cacheHits,cacheHitsAfter:reopened.cacheHits,cacheEntries:reopened.cacheEntries});
      check('reopening activates the shared renderer again', X.imagineCityRenderState().active && X.imagineCityRenderState().bytes > 0);
      invariant('Reopened Imagine'); glStatus('Reopened Imagine');
      check('the original style is restored for the user', X.state.sceneStyle === originalStyle);
    } catch (error) {
      check('Self-test completes without exception', false, {error:String(error.message || error), stack:String(error.stack || '')});
    } finally {
      root.clearInterval(heartbeat);
      if (X && originalStyle) {
        try {X.setSceneStyle(originalStyle, false); X.renderOnce();} catch (_) {}
      }
      if (UI && !UI.getState().open) {
        try {UI.open();} catch (_) {}
      }
      const report = {tests, all_pass:tests.length > 0 && tests.every(t => t.pass), timings, elapsedMs:performance.now() - started,
        heartbeat:{ticks,maxGapMs:Math.round(maxGap)}, renderer:X?.imagineCityRenderState?.(), state:UI?.getState?.(),
        storage:'Self-test uses temporary JavaScript values only; no localStorage, IndexedDB or cache writes.'};
      let host = $('imagine-city-panel') || $('technical') || doc.body;
      const details = doc.createElement('details'); details.id = 'imagine-city-selftest-details';
      const summary = doc.createElement('summary'); summary.textContent = 'Imagine verification · ' + (report.all_pass ? 'passed' : 'needs review'); details.appendChild(summary);
      const pre = doc.createElement('pre'); pre.id = 'imagine-city-selftest-report'; pre.style.cssText = 'max-width:100%;max-height:32rem;overflow:auto;white-space:pre-wrap;font-size:11px';
      pre.textContent = JSON.stringify(report, null, 2); details.appendChild(pre); host.appendChild(details);
      if (new root.URLSearchParams(root.location.search).get('imagineperf') === '1') {
        const legacy = doc.createElement('pre'); legacy.id = 'imagine-performance-result'; legacy.hidden = true; legacy.textContent = JSON.stringify(report); doc.body.appendChild(legacy);
      }
      root.__imagineCitySelftestReport = report;
      doc.title = report.all_pass ? 'IMAGINE CITY DONE' : 'IMAGINE CITY FAIL';
      doc.dispatchEvent(new root.CustomEvent('vista-imagine-city-selftest-done', {detail:{all_pass:report.all_pass,tests:tests.length}}));
    }
  })();
})(typeof window !== 'undefined' ? window : globalThis);
