/* Browser regression for rotated proposals and live view/height study.
 * Load through ?workflowtest=1 after explorer.js. The checks use the real DOM,
 * City polygons, terrain, and /api/check; they make no policy assertion.
 */
(async function () {
  'use strict';
  const steps = [];
  const $ = id => document.getElementById(id);
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const near = (a, b, tol = 0.005) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tol;
  const record = (name, pass, detail) => steps.push({ name, pass: !!pass, detail });
  const setInput = (element, value) => {
    if (!element) throw new Error('Missing input control.');
    element.value = String(value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const setChecked = (element, value) => {
    if (!element) throw new Error('Missing checkbox control.');
    element.checked = value;
    element.dispatchEvent(new Event('change', { bubbles: true }));
  };
  async function until(predicate, label, timeout = 6000) {
    const end = performance.now() + timeout;
    while (performance.now() < end) {
      if (predicate()) return;
      await wait(40);
    }
    throw new Error('Timed out waiting for ' + label);
  }
  const finish = () => {
    const result = { all_pass: steps.length > 0 && steps.every(s => s.pass), steps };
    let pre = $('workflow-selftest-result');
    if (!pre) { pre = document.createElement('pre'); pre.id = 'workflow-selftest-result'; pre.hidden = true; document.body.appendChild(pre); }
    pre.textContent = JSON.stringify(result);
    document.title = result.all_pass ? 'WORKFLOWTEST DONE' : 'WORKFLOWTEST FAIL';
  };

  let restoreFetch = null, releaseHeldResponse = null;
  try {
    const X = window.__explorer;
    const G = window.ProposalGeometry;
    if (!X || !G) throw new Error('Explorer and proposal geometry must load before workflow-selftest.js.');
    await X.ready;
    const cones = X.assets.cones && X.assets.cones.cones || [];
    const hasCeiling = $('enable-height-study');
    record('initial study has no invented City ceiling',
      X.state.check.unknown === true && hasCeiling && !hasCeiling.checked &&
      X.state.check.result === null && X.state.check.reference === 'height',
      { unknown: X.state.check.unknown, enabled: hasCeiling && hasCeiling.checked,
        result: X.state.check.result && X.state.check.result.overall_result,
        reference: X.state.check.reference });

    // Find a real terrain-covered point inside a mapped corridor. Checking
    // polygon overlap first avoids many expensive terrain ray casts.
    const sampleCoordinates = [];
    for (let y = -1800; y <= 1800; y += 300) for (let x = -1800; x <= 1800; x += 300) sampleCoordinates.push([x, y]);
    let firstSite = null;
    for (const [x, y] of sampleCoordinates) {
      const footprint = G.makePart({ cx: x, cy: y, zMin: 0, zMax: 1, w: 52, d: 18, rotation: 45 }).footprint;
      const mapped = cones.some(c => G.planOverlap(c.polygon_model_xy, footprint).area > 0.01);
      if (!mapped) continue;
      const z = X.landZAt(x, y);
      if (z !== null) { firstSite = { x, y, z }; break; }
    }
    if (!firstSite) throw new Error('No terrain-covered proposal location intersects the loaded City plan polygons.');
    if (!X.placeSite(firstSite.x, firstSite.y)) throw new Error('Could not place the test proposal on land.');
    X.setStep(2);

    // Exercise the part controls. A rectangular 45-degree part exposes a
    // different true footprint from its axis-aligned bounding rectangle.
    setInput(document.querySelector('#parts-list input[data-k="w"][data-i="0"]'), 52);
    setInput(document.querySelector('#parts-list input[data-k="d"][data-i="0"]'), 18);
    setInput(document.querySelector('#parts-list input[data-k="rotation"][data-i="0"]'), 45);
    let part = X.proposalParts()[0];
    const actualArea = G.planOverlap(part.footprint, part.footprint).area;
    const bboxArea = (part.box[3] - part.box[0]) * (part.box[4] - part.box[1]);
    record('rotation control produces a true rotated rectangular prism',
      X.state.parts[0].rotation === 45 && near(actualArea, 52 * 18) && bboxArea > actualArea * 1.2 &&
      part.pos.length === 24 && part.idx.length === 36 && part.edges.length === 72,
      { rotation: X.state.parts[0].rotation, actual_area_m2: actualArea, bbox_area_m2: bboxArea,
        vertices: part.pos.length / 3, triangles: part.idx.length / 3 });

    const study = JSON.parse(JSON.stringify(X.technicalState()));
    const hashParams = new URLSearchParams(study.resume_hash.slice(1));
    const savedRotation = hashParams.get('rot');
    X.state.parts[0].rotation = 0;
    const reopened = X.openStudy(study);
    part = X.proposalParts()[0];
    record('saved study and URL state restore part rotation',
      reopened && savedRotation === '45' && X.state.parts[0].rotation === 45 &&
      near(G.planOverlap(part.footprint, part.footprint).area, actualArea) &&
      X.state.check.unknown === true,
      { reopened, saved_rotation: savedRotation, rotation: X.state.parts[0].rotation,
        unknown_ceiling: X.state.check.unknown });

    const matches = X.planAnalysis();
    const summary = $('view-study-summary').textContent;
    const matchText = $('view-matches').textContent;
    const selectLabels = Array.from($('view-select').options).map(o => o.textContent);
    record('mapped corridor feedback uses plan overlap and plain view labels',
      matches.some(m => m.relation === 'overlap' && m.area > 0) &&
      matches.every(m => m.cone && (m.relation === 'overlap' ? m.area > 0 : m.relation === 'touch' && m.area === 0)) &&
      matches.some(m => matchText.includes(String(m.cone.view_number))) &&
      summary.length > 10 && !/origin (inside|outside) model/i.test(matchText + selectLabels.join(' ')),
      { match_count: matches.length, first_view: matches[0] && matches[0].cone.view_number,
        first_area_m2: matches[0] && matches[0].area, summary,
        raw_origin_label: /origin (inside|outside) model/i.test(matchText + selectLabels.join(' ')) });

    setChecked(hasCeiling, true);
    await until(() => X.state.check.result && X.state.check.input, 'first automatic height result');
    let proposal = X.proposalBox();
    let result = X.state.check.result;
    const fullPart = result.parts[0].result;
    record('enabling the optional ceiling checks true footprint area at base plus height',
      X.state.check.unknown === false && near(X.state.check.input.boundary_z, proposal.base + 120) &&
      near(fullPart.tower_footprint_area_m2, 52 * 18) && near(fullPart.plan_overlap.area_m2, 52 * 18) &&
      fullPart.regulatory_applicability === 'NOT ASSESSED',
      { base_z: proposal.base, boundary_z: X.state.check.input.boundary_z,
        footprint_area_m2: fullPart.tower_footprint_area_m2,
        evaluated_area_m2: fullPart.plan_overlap.area_m2,
        applicability: fullPart.regulatory_applicability });

    const priorRequest = X.state.check.requestId;
    setInput($('ceiling-height'), 55);
    const invalidatedOnCeilingChange = X.state.check.result === null;
    await until(() => X.state.check.result && X.state.check.input &&
      X.state.check.requestId > priorRequest && near(X.state.check.input.boundary_z, X.proposalBox().base + 55),
    'automatic ceiling-height result');
    record('ceiling input invalidates stale result and recalculates without Retry',
      invalidatedOnCeilingChange && near(X.state.check.height, 55) &&
      near(+($('ceiling-slider').value), 55) && !/no study ceiling/i.test($('check-live-status').textContent),
      { invalidated_immediately: invalidatedOnCeilingChange,
        height_m: X.state.check.height, boundary_z: X.state.check.input.boundary_z,
        live_status: $('check-live-status').textContent });

    const priorHeightRequest = X.state.check.requestId;
    setInput(document.querySelector('#parts-list input[data-k="h"][data-i="0"]'), 70);
    const invalidatedOnPartChange = X.state.check.result === null;
    await until(() => X.state.check.result && X.state.check.input &&
      X.state.check.requestId > priorHeightRequest && near(X.state.check.input.parts[0].z_max, X.proposalBox().base + 70),
    'automatic proposal-height result');
    result = X.state.check.result;
    record('proposal height input recalculates clearance without Retry',
      invalidatedOnPartChange && result.overall_result === 'INTERSECTS' &&
      near(result.max_penetration_m, 15) && near(result.min_signed_margin_m, -15),
      { invalidated_immediately: invalidatedOnPartChange,
        result: result.overall_result, penetration_m: result.max_penetration_m,
        margin_m: result.min_signed_margin_m });

    // Move the same mass to a different ground elevation. In above-base mode
    // the model-Z ceiling must follow the proposal, not remain at old site Z.
    const firstBase = X.proposalBox().base;
    let secondSite = null;
    for (const [x, y] of [[1200, 3800], [4000, -1000], [0, 0], [-1200, 900], [1500, -1500], [-1500, 1500]]) {
      const z = X.landZAt(x, y);
      if (z !== null && Math.abs(z - firstBase) > 5) { secondSite = { x, y, z }; break; }
    }
    if (!secondSite) throw new Error('Could not locate two land sites with different ground elevations.');
    const priorSiteRequest = X.state.check.requestId;
    X.placeSite(secondSite.x, secondSite.y);
    await until(() => X.state.check.result && X.state.check.input &&
      X.state.check.requestId > priorSiteRequest && near(X.state.check.input.boundary_z, X.proposalBox().base + 55),
    'site-relative ceiling result');
    record('height reference follows proposal base across sloped terrain',
      Math.abs(firstBase - X.proposalBox().base) > 5 && X.state.check.reference === 'height' &&
      near(X.state.check.input.boundary_z, X.proposalBox().base + 55),
      { first_base_z: firstBase, second_base_z: X.proposalBox().base,
        second_boundary_z: X.state.check.input.boundary_z, reference: X.state.check.reference });

    // Return to the corridor site for an AABB corner that the rotated mass
    // does not cover. A hypothetical check there must have zero plan area.
    X.placeSite(firstSite.x, firstSite.y);
    const b = X.proposalBox().box;
    const xCorner = b[3] - 0.5, yCorner = b[4] - 0.5;
    const cornerArea = { x_min: xCorner, x_max: b[3] - 0.1, y_min: yCorner, y_max: b[4] - 0.1 };
    const boxCornerInside = xCorner > b[0] && yCorner > b[1];
    $('check-area').value = 'custom';
    $('check-area').dispatchEvent(new Event('change', { bubbles: true }));
    for (const [id, value] of [['ca-xmin', cornerArea.x_min], ['ca-xmax', cornerArea.x_max],
      ['ca-ymin', cornerArea.y_min], ['ca-ymax', cornerArea.y_max]]) setInput($(id), value);
    await until(() => X.state.check.result && X.state.check.input &&
      X.state.check.input.test_area && near(X.state.check.input.test_area.x_min, cornerArea.x_min) &&
      near(X.state.check.input.test_area.y_min, cornerArea.y_min), 'rotated custom-area result');
    const cornerResult = X.state.check.result.parts[0].result;
    record('custom rectangle inside AABB but outside footprint has no vertical evaluation',
      boxCornerInside && cornerResult.plan_overlap.area_m2 === 0 &&
      cornerResult.geometric_result === 'NO_PLAN_OVERLAP' && cornerResult.penetration_m === 0,
      { area_m2: cornerResult.plan_overlap.area_m2,
        result: cornerResult.geometric_result, penetration_m: cornerResult.penetration_m });

    $('check-area').value = 'footprint';
    $('check-area').dispatchEvent(new Event('change', { bubbles: true }));
    await until(() => X.state.check.result && X.state.check.input &&
      X.state.check.input.test_area && near(X.state.check.input.test_area.x_min, X.proposalBox().box[0]),
    'restored full-area result');

    // Delay one real response, change the ceiling again, and let the newer
    // result settle first. Releasing the old response must leave it intact.
    const originalFetch = window.ProjectAPI.fetch;
    restoreFetch = () => { window.ProjectAPI.fetch = originalFetch; };
    let releaseOld = null, delayed = false;
    window.ProjectAPI.fetch = async (...args) => {
      const response = await originalFetch(...args);
      if (!delayed && String(args[0]).includes('/api/check')) {
        delayed = true;
        return new Proxy(response, { get(target, prop) {
          if (prop === 'json') return async () => {
            const payload = await target.json();
            await new Promise(resolve => { releaseOld = resolve; });
            return payload;
          };
          const value = target[prop];
          return typeof value === 'function' ? value.bind(target) : value;
        } });
      }
      return response;
    };
    setInput($('ceiling-height'), 80);
    const staleCleared = X.state.check.result === null;
    await until(() => !!releaseOld, 'delayed old response');
    setInput($('ceiling-height'), 82);
    const newestCleared = X.state.check.result === null;
    await until(() => X.state.check.result && X.state.check.input &&
      near(X.state.check.input.boundary_z, X.proposalBox().base + 82), 'newer height result');
    const winningRequest = X.state.check.requestId;
    releaseOld();
    await wait(100);
    record('late server response cannot restore an obsolete check',
      staleCleared && newestCleared && X.state.check.requestId === winningRequest &&
      X.state.check.result && near(X.state.check.input.boundary_z, X.proposalBox().base + 82),
      { first_invalidated: staleCleared, second_invalidated: newestCleared,
        final_height_m: X.state.check.height, final_boundary_z: X.state.check.input.boundary_z });

    // Reopening the exact same saved state must also start a new calculation.
    // This catches a race where the old request is rejected, but the unchanged
    // signature and busy flag prevent the replacement request from starting.
    restoreFetch();
    restoreFetch = null;
    const identicalStudy = JSON.parse(JSON.stringify(X.technicalState()));
    const expectedBoundary = X.state.check.input.boundary_z;
    let heldOnce = false;
    window.ProjectAPI.fetch = async (...args) => {
      const response = await originalFetch(...args);
      if (!heldOnce && String(args[0]).includes('/api/check')) {
        heldOnce = true;
        return new Proxy(response, { get(target, prop) {
          if (prop === 'json') return async () => {
            const payload = await target.json();
            await new Promise(resolve => { releaseHeldResponse = resolve; });
            return payload;
          };
          const value = target[prop];
          return typeof value === 'function' ? value.bind(target) : value;
        } });
      }
      return response;
    };
    restoreFetch = () => { window.ProjectAPI.fetch = originalFetch; };
    const oldCheck = X.runCheck();
    await until(() => !!releaseHeldResponse, 'old request before identical reopen');
    const oldId = X.state.check.requestId;
    const reopenedIdentical = X.openStudy(identicalStudy);
    const invalidatedOnReopen = X.state.check.result === null && X.state.check.busy === false;
    await until(() => X.state.check.result && X.state.check.input && !X.state.check.busy &&
      X.state.check.requestId > oldId && near(X.state.check.input.boundary_z, expectedBoundary),
    'fresh result after identical study reopen');
    const freshResult = X.state.check.result;
    releaseHeldResponse(); releaseHeldResponse = null;
    const ignoredOldResult = await oldCheck;
    await wait(100);
    record('reopening identical study restarts pending check and rejects its old response',
      reopenedIdentical && invalidatedOnReopen && ignoredOldResult === null &&
      X.state.check.result === freshResult && !X.state.check.busy && !X.state.check.error &&
      near(X.state.check.input.boundary_z, expectedBoundary),
      { reopened: reopenedIdentical, invalidated_immediately: invalidatedOnReopen,
        old_response_ignored: ignoredOldResult === null,
        fresh_result_retained: X.state.check.result === freshResult,
        boundary_z: X.state.check.input.boundary_z });
  } catch (error) {
    record('exception', false, { message: String(error && error.message || error),
      stack: String(error && error.stack || '').slice(0, 1200) });
  } finally {
    if (releaseHeldResponse) releaseHeldResponse();
    if (restoreFetch) restoreFetch();
    finish();
  }
})();
