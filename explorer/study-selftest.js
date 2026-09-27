/* Focused browser self-test for measured site studies and removal scenarios.
 * Load only with ?studytest=1 after explorer.js. Uses public test hooks and
 * geometry coordinates directly, so drawing assertions do not depend on the
 * canvas viewport size or a particular camera pixel projection.
 */
(async function () {
  const report = [];
  const record = (name, pass, detail) => report.push({ name, pass: !!pass, detail });
  const close = (a, b, tol = 1e-6) => Number.isFinite(a) && Math.abs(a - b) <= tol;
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const writeResult = () => {
    const result = { tests: report, all_pass: report.length > 0 && report.every((item) => item.pass) };
    const pre = document.createElement('pre');
    pre.id = 'study-selftest-result';
    pre.style.display = 'none';
    pre.textContent = JSON.stringify(result);
    document.body.appendChild(pre);
    document.title = result.all_pass ? 'STUDYTEST DONE' : 'STUDYTEST FAIL';
  };

  try {
    const X = window.__explorer;
    if (!X) throw new Error('window.__explorer was not initialized.');
    await X.ready;
    X.restoreBuildings();

    const cols = X.assets.index.columns;
    const candidate = (() => {
      // Use real building index bounds to find a nearby terrain-covered test
      // area. The picked building also supplies a deterministic replacement
      // target later in the test.
      const stride = Math.max(1, Math.floor(cols.bbox.length / 160));
      for (let i = 0; i < cols.bbox.length; i += stride) {
        const b = cols.bbox[i];
        if (!b || b.length < 6 || b[3] - b[0] < 12 || b[4] - b[1] < 12 || b[5] - b[2] < 15) continue;
        const x = (b[0] + b[3]) / 2, y = (b[1] + b[4]) / 2;
        if (X.landZAt(x, y) === null) continue;
        const w = 40, d = 30;
        const boundary = [[x - w / 2, y - d / 2], [x + w / 2, y - d / 2], [x + w / 2, y + d / 2], [x - w / 2, y + d / 2]];
        if (!boundary.every((p) => X.landZAt(p[0], p[1]) !== null)) continue;
        const hit = X.pickRay([x, y, b[5] + 500], [0, 0, -1]);
        if (hit.type === 'building' && hit.index === i && !hit.ext) return { index: i, bbox: Array.from(b), x, y, boundary, width: w, depth: d };
      }
      return null;
    })();
    if (!candidate) throw new Error('Could not find a building-index bbox with terrain at its centre and test rectangle corners.');

    // A valid measured rectangle, then a bowtie attempt that must leave the
    // completed boundary untouched after cancellation.
    X.state.boundary = [];
    X.placeSite(candidate.x, candidate.y);
    X.beginBoundary();
    const addValid = candidate.boundary.map(([x, y]) => X.addBoundaryPoint(x, y));
    const finished = X.finishBoundary();
    const measured = X.state.boundary.length >= 3 ? X.assets.ready && X.state.boundary : [];
    const measuredMetrics = measured.length ? window.SiteGeometry.metrics(measured) : null;
    const rectanglePass = addValid.every(Boolean) && finished && measuredMetrics &&
      close(measuredMetrics.area, candidate.width * candidate.depth) &&
      close(measuredMetrics.perimeter, 2 * (candidate.width + candidate.depth));
    const savedBoundary = measured.map((p) => [...p]);

    X.beginBoundary();
    const [a, b, c, d] = candidate.boundary;
    const bowtieAdded = [a, c, b, d].map(([x, y]) => X.addBoundaryPoint(x, y));
    const invalidFinished = X.finishBoundary();
    const invalidWasRetained = !!X.state.drawing;
    X.cancelBoundary();
    const cancelRestored = JSON.stringify(X.state.boundary) === JSON.stringify(savedBoundary);
    record('draw rectangle, measure area, reject bowtie, cancel restores prior boundary',
      !!rectanglePass && bowtieAdded.every(Boolean) && invalidFinished === false && invalidWasRetained && cancelRestored,
      { rectangle_area_m2: measuredMetrics && measuredMetrics.area, expected_area_m2: candidate.width * candidate.depth,
        perimeter_m: measuredMetrics && measuredMetrics.perimeter, bowtie_rejected: invalidFinished === false,
        cancel_restored: cancelRestored, boundary_points: X.state.boundary.length });

    // Plan camera is orthographic, with scale derived from world-space half
    // height; compare projection coefficients instead of relying on viewport pixels.
    X.state.cams.overview.dist = 420;
    X.setMode('plan');
    const planCam = X.renderOnce();
    const orthoPass = !!planCam && close(planCam.proj[15], 1) && planCam.half > 0 &&
      close(planCam.half, 420 * Math.tan(Math.PI / 8), 1e-6) &&
      close(planCam.proj[0] * planCam.aspect, planCam.proj[5], 1e-9);
    record('plan camera uses orthographic scale', orthoPass,
      { mode: X.state.mode, half_height_m: planCam && planCam.half,
        projection_w: planCam && planCam.proj[0], projection_h: planCam && planCam.proj[5],
        expected_half_height_m: 420 * Math.tan(Math.PI / 8) });

    // Ray-pick a known indexed building from above, remove it hypothetically,
    // and verify that display state controls whether picking can find it.
    const target = candidate;
    X.setTool('site');
    const rayOrigin = [target.x, target.y, target.bbox[5] + 500];
    const originalHit = X.pickRay(rayOrigin, [0, 0, -1]);
    if (originalHit.type === 'building' && originalHit.index === target.index && !originalHit.ext) {
      X.applyPick(originalHit);
    }
    const selected = X.state.selected === target.index && !X.state.selectedExt;
    const replacementMade = selected && X.replaceSelectedBuilding();
    const replacementBounds = X.state.boundary.length >= 3 ? window.SiteGeometry.metrics(X.state.boundary).bounds : null;
    const expectedBounds = [target.bbox[0], target.bbox[1], target.bbox[3], target.bbox[4]];
    const replacementBoundsCorrect = !!replacementBounds && replacementBounds.every((v, i) => close(v, expectedBounds[i]));
    const removedState = X.state.removed.some((r) => !r.ext && r.index === target.index);
    const hiddenHit = X.pickRay(rayOrigin, [0, 0, -1]);
    const removedNoLongerPickable = !(hiddenHit.type === 'building' && hiddenHit.index === target.index && !hiddenHit.ext);
    X.state.showExisting = true;
    const restoredComparisonHit = X.pickRay(rayOrigin, [0, 0, -1]);
    const existingPickable = restoredComparisonHit.type === 'building' && restoredComparisonHit.index === target.index && !restoredComparisonHit.ext;
    X.restoreBuildings();
    const restoredState = X.state.removed.length === 0 && !X.state.showExisting;
    const restoredSceneHit = X.pickRay(rayOrigin, [0, 0, -1]);
    const restoredPickable = restoredSceneHit.type === 'building' && restoredSceneHit.index === target.index && !restoredSceneHit.ext;
    record('replacement removes building from picking; comparison and restore make it pickable',
      selected && replacementMade && replacementBoundsCorrect && removedState && removedNoLongerPickable && existingPickable && restoredState && restoredPickable,
      { target_index: target.index, osm_id: String(cols.osm_id[target.index]), original_hit: originalHit.type,
        replacement_made: !!replacementMade, replacement_bounds_correct: replacementBoundsCorrect,
        replacement_bounds: replacementBounds, expected_bounds: expectedBounds, removed_state: removedState, hidden_hit: hiddenHit.type,
        no_longer_pickable: removedNoLongerPickable, comparison_hit: restoredComparisonHit.type,
        existing_pickable: existingPickable, restored_state: restoredState, restored_pickable: restoredPickable });

    // Serialize boundary, removal, layer visibility and the plan camera in
    // the URL hash, then restore from that exact captured hash.
    X.state.site = { x: candidate.x, y: candidate.y, z: X.terrainZAt(candidate.x, candidate.y) };
    X.state.boundary = candidate.boundary.map((p) => [...p]);
    X.state.removed = [{ index: target.index, ext: false, id: String(cols.osm_id[target.index]) }];
    X.state.showExisting = true;
    X.state.layers = { labels: false, roads: true, sources: true, extent: false };
    X.state.cams.overview.dist = 420;
    X.setMode('plan'); // schedules the app's normal hash writer
    await wait(250);
    const savedHash = location.hash;
    const hashParams = new URLSearchParams(savedHash.replace(/^#/, ''));
    const expectedBoundary = X.state.boundary.map((p) => [...p]);
    X.state.boundary = [];
    X.state.removed = [];
    X.state.showExisting = false;
    X.state.layers = { labels: true, roads: false, sources: false, extent: true };
    X.state.mode = 'overview';
    X.applyHash(savedHash);
    const boundaryRoundTrip = X.state.boundary.length === expectedBoundary.length &&
      X.state.boundary.every((p, i) => close(p[0], expectedBoundary[i][0], 0.001) && close(p[1], expectedBoundary[i][1], 0.001));
    const removedRoundTrip = X.state.removed.length === 1 && X.state.removed[0].index === target.index && X.state.removed[0].id === String(cols.osm_id[target.index]);
    const layersRoundTrip = JSON.stringify(X.state.layers) === JSON.stringify({ labels: false, roads: true, sources: true, extent: false });
    const planRoundTrip = X.state.mode === 'plan';
    record('URL hash round-trips boundary, removal, layer visibility, and plan mode',
      hashParams.has('boundary') && hashParams.has('removed') && hashParams.has('layers') && hashParams.get('mode') === 'plan' &&
      boundaryRoundTrip && removedRoundTrip && X.state.showExisting && layersRoundTrip && planRoundTrip,
      { boundary: boundaryRoundTrip, removed: removedRoundTrip, existing_comparison: X.state.showExisting,
        layers: X.state.layers, mode: X.state.mode, hash_length: savedHash.length });

    // The exported JSON state should describe a measured area and identify
    // the hypothetical removal by source ID.
    const exported = JSON.parse(JSON.stringify(X.technicalState()));
    const jsonPass = exported.study_area && close(exported.study_area.area, candidate.width * candidate.depth) &&
      Array.isArray(exported.hypothetical_removals) && exported.hypothetical_removals.length === 1 &&
      exported.hypothetical_removals[0].osm_id === String(cols.osm_id[target.index]);
    record('JSON report contains study area and hypothetical removals', !!jsonPass,
      { study_area_m2: exported.study_area && exported.study_area.area,
        removal_count: exported.hypothetical_removals && exported.hypothetical_removals.length,
        removal: exported.hypothetical_removals && exported.hypothetical_removals[0] });

    // Reopen a named study whose saved hash intentionally has no point site
    // or observer. Prior populated values must be cleared while boundary and
    // hypothetical removals are restored.
    X.state.studyName = 'Saved Empty Site Study';
    X.state.site = null;
    X.state.observer = null;
    X.state.boundary = candidate.boundary.map((p) => [...p]);
    X.state.removed = [{ index: target.index, ext: false, id: String(cols.osm_id[target.index]) }];
    X.state.showExisting = false;
    X.state.pmode = 'boxes';
    const namedStudy = X.technicalState();
    X.state.site = { x: candidate.x, y: candidate.y, z: X.landZAt(candidate.x, candidate.y) };
    X.state.observer = { x: candidate.x, y: candidate.y, z: X.landZAt(candidate.x, candidate.y), ground: 'terrain' };
    const opened = X.openStudy(namedStudy);
    const namedBoundaryRestored = X.state.boundary.length === candidate.boundary.length &&
      X.state.boundary.every((p, i) => close(p[0], candidate.boundary[i][0], 0.001) && close(p[1], candidate.boundary[i][1], 0.001));
    const namedRemovalRestored = X.state.removed.length === 1 && X.state.removed[0].index === target.index;
    const emptyLocationsCleared = X.state.site === null && X.state.observer === null;
    const namedStatePass = opened && X.state.studyName === 'Saved Empty Site Study' && emptyLocationsCleared && namedBoundaryRestored && namedRemovalRestored;

    // Save import mode with actual imported metadata, then reopen it after
    // clearing imported geometry. The import panel should prompt for the
    // source file and must not silently fall back to the saved box list.
    const obj = ['o Saved imported mass', 'v 0 0 0', 'v 8 0 0', 'v 8 6 0', 'v 0 6 0', 'v 0 0 20', 'v 8 0 20', 'v 8 6 20', 'v 0 6 20', 'f 1 4 3 2', 'f 5 6 7 8', 'f 1 2 6 5', 'f 2 3 7 6', 'f 3 4 8 7', 'f 4 1 5 8'].join('\n');
    const importedParts = X.parseObj(obj, 1);
    const importInstalled = X.installImport('saved-mass.obj', importedParts, 'units declared: metres (x 1)');
    X.state.studyName = 'Imported Study';
    const importStudy = X.technicalState();
    const importMetadataSaved = importStudy.proposal_mode === 'import' && importStudy.imported && importStudy.imported.name === 'saved-mass.obj' && importStudy.imported_geometry_included === false;
    const importOpened = X.openStudy(importStudy);
    const importPanelOpen = X.state.pmode === 'import' && X.state.imported === null &&
      document.getElementById('import-ui').classList.contains('hidden') === false &&
      document.getElementById('boxes-ui').classList.contains('hidden') === true;
    const noSubstituteBlocks = X.proposalParts().length === 0 && X.proposalBox() === null &&
      /Reopen the original saved-mass\.obj file/.test(document.getElementById('import-info').textContent);
    const badSchemaRejected = (() => {
      try { X.openStudy({ schema: 'wrong/version', resume_hash: '#site=1%2C2' }); return false; }
      catch (e) { return /study JSON saved by this version/.test(String(e && e.message)); }
    })();
    record('named study restores boundary/removal and clears empty site/observer; import stays empty; bad schema rejected',
      namedStatePass && importInstalled && importMetadataSaved && importOpened && importPanelOpen && noSubstituteBlocks && badSchemaRejected,
      { opened: !!opened, name: X.state.studyName, empty_locations_cleared: emptyLocationsCleared,
        boundary_restored: namedBoundaryRestored, removal_restored: namedRemovalRestored,
        import_installed: !!importInstalled, import_metadata_saved: !!importMetadataSaved,
        import_opened: !!importOpened, import_panel_open: importPanelOpen,
        no_substitute_blocks: noSubstituteBlocks, bad_schema_rejected: badSchemaRejected });
  } catch (error) {
    record('exception', false, { message: String(error && error.message || error), stack: String(error && error.stack || '').slice(0, 900) });
  }
  writeResult();
})();
