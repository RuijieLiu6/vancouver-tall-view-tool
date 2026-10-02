/* Browser test: load with ?flowtest=1 after explorer.js. Drives the guided Site → Build → View → Output flow
 * through its real buttons and method cards, including multi-building replacement and press-drag-release aiming. */
(async function () {
  const tests = [], record = (name, pass, detail) => tests.push({ name, pass: !!pass, detail });
  const $ = (id) => document.getElementById(id), X = window.__explorer;
  const visible = (sel) => [...document.querySelectorAll(sel)].filter(e => !e.classList.contains('hidden'));
  const card = (stage, method) => document.querySelector(`.method-card[data-stage="${stage}"][data-method="${method}"]`);
  const swap = (stage, method) => document.querySelector(`.method-switch[data-switch-for="${stage}"] .ms-btn[data-method="${method}"]`);
  let originalHash = null;
  try {
    if (!X) throw new Error('Explorer is unavailable');
    await X.ready; originalHash = X.serializeHash();
    X.applyHash('#style=collage'); X.state.flow.methods = { site: null, build: null, view: null }; X.state.flow.guided = false; X.flowGo('site', { force: true });

    record('flow opens on the site chooser with later stages locked', X.state.flow.stage === 'site' && visible('.method-chooser').length === 1 &&
      $('btn-flow-next').classList.contains('hidden') && document.querySelector('.flow-step[data-stage="build"]').classList.contains('locked'));
    record('locked rail stages cannot be entered', !X.flowGo('view') && X.state.flow.stage === 'site');

    card('site', 'point').click();
    record('choosing a method hides the chooser and offers the other methods as direct switches', visible('.method-chooser').length === 0 &&
      visible('.method-body').map(e => e.dataset.method).join() === 'point' && !!swap('site', 'replace') && !!swap('site', 'multi') && !swap('site', 'point') &&
      $('btn-flow-next').disabled && X.state.tool === 'site' && X.state.mode === 'plan');
    let land = null; for (const [x, y] of [[700, -300], [200, -150], [0, 0], [-100, 300], [400, -600]]) { const h = X.pickRay([x, y, 5000], [0, 0, -1]); if (h.type === 'terrain') { land = h; break; } }
    X.applyPick(land);
    record('placing a site enables Proceed to Build; the proposal is not drawn yet', !!X.state.site && !$('btn-flow-next').disabled &&
      /Build/.test($('btn-flow-next').textContent) && X.state.flow.guided && !X.state.flow.methods.build);

    $('btn-flow-next').click();
    record('Build opens on its chooser with Return to Site', X.state.flow.stage === 'build' && visible('.method-chooser')[0]?.dataset.chooser === 'build' &&
      $('btn-flow-back').textContent.includes('Return to Site'));
    card('build', 'import').click();
    record('import method needs a model before proceeding', X.state.pmode === 'import' && $('btn-flow-next').disabled && /model file/.test($('flow-need').textContent));
    swap('build', 'platform').click();
    record('platform method is complete with the default block', X.state.pmode === 'boxes' && !$('btn-flow-next').disabled);

    $('btn-flow-next').click(); card('view', 'drag').click();
    record('drag-and-view uses the aim tool in plan', X.state.flow.stage === 'view' && X.state.tool === 'aim' && X.state.mode === 'plan');
    X.state.cams.overview.target = [X.state.site.x, X.state.site.y, X.state.site.z]; X.state.cams.overview.dist = 600; X.setMode('plan'); X.renderOnce();
    const c = X.canvas, r = c.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2; // plan is centred on the open-land site
    const fire = (type, x, y) => c.dispatchEvent(new PointerEvent(type, { pointerId: 41, clientX: x, clientY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1, bubbles: true }));
    fire('pointerdown', cx, cy); for (let i = 1; i <= 5; i++) fire('pointermove', cx + i * 24, cy); const yaw = X.state.cams.observer.yaw; fire('pointerup', cx + 120, cy);
    record('press, drag east and release stands there looking east', !!X.state.observer && Math.abs(yaw) < 0.05 && X.state.mode === 'observer' && !$('btn-flow-next').disabled,
      { yaw_deg: +(yaw * 180 / Math.PI).toFixed(2), mode: X.state.mode });

    swap('view', 'cone').click();
    record('switching view method clears the previous viewpoint', X.state.observer === null && X.state.flow.methods.view === 'cone' && $('btn-flow-next').disabled);
    X.renderOnce();
    record('free inspection retains the location map before a cone is selected', !$('inset-frame').classList.contains('hidden') &&
      /Free inspection/.test($('view-caption').textContent) && $('im-eye').classList.contains('hidden') && $('inset-beam').classList.contains('hidden'));
    const beforeCamera = JSON.stringify(X.state.cams.overview);
    X.selectView('3.2.1'); X.renderOnce();
    record('choosing a cone previews its origin without moving the inspection camera', !X.state.observer && X.state.mode !== 'observer' &&
      beforeCamera === JSON.stringify(X.state.cams.overview) && !$('inset-frame').classList.contains('hidden') &&
      $('inset-eye-label').textContent === 'selected view' && $('inset-beam').classList.contains('hidden') && /free inspection/i.test($('obs-info').textContent));
    $('btn-observer-at-origin').click(); X.renderOnce();
    record('View from here activates the observer and its map beam', X.state.mode === 'observer' && X.state.observerSource === 'origin' &&
      !$('inset-frame').classList.contains('hidden') && !$('inset-beam').classList.contains('hidden') && $('inset-eye-label').textContent === 'you' &&
      /Protected viewpoint 3.2.1/.test($('view-caption').textContent));
    X.setMode('inspect'); X.renderOnce();
    record('returning to free inspection keeps the map and removes the eye-level beam', !$('inset-frame').classList.contains('hidden') &&
      $('inset-beam').classList.contains('hidden') && /Free inspection/.test($('view-caption').textContent));
    X.setMode('observer'); X.selectView('3.2.3'); X.renderOnce();
    record('changing the protected view returns to a clearly labelled preview', !X.state.observer && X.state.mode !== 'observer' &&
      $('mode-overview').classList.contains('active') && !$('mode-observer').classList.contains('active') &&
      !$('inset-frame').classList.contains('hidden') && $('inset-eye-label').textContent === 'selected view' &&
      $('inset-beam').classList.contains('hidden') && /Free inspection/.test($('view-caption').textContent));
    const previewHash = X.serializeHash(); X.applyHash(previewHash); X.renderOnce();
    record('saved cone selection reopens with a map in free inspection', !X.state.observer &&
      !$('inset-frame').classList.contains('hidden') && $('inset-eye-label').textContent === 'selected view' && /Free inspection/.test($('view-caption').textContent));
    $('btn-observer-at-origin').click(); $('btn-flow-next').click();
    record('Output shows results and downloads with Return to View', X.state.flow.stage === 'output' && X.state.step === 3 && $('btn-flow-next').classList.contains('hidden') &&
      $('btn-flow-back').textContent.includes('Return to View') && $('report').textContent.length > 500);

    X.flowGo('site'); swap('site', 'multi').click();
    const cols = X.assets.index.columns, near = [];
    for (let i = 0; i < cols.bbox.length; i++) { const b = cols.bbox[i], d = Math.hypot((b[0] + b[3]) / 2 - 300, (b[1] + b[4]) / 2 - 200); if (d < 150 && b[3] - b[0] > 10) near.push({ i, d, b }); }
    near.sort((a, b) => a.d - b.d); const picks = near.slice(0, 3);
    for (const p of picks) X.applyPick({ type: 'building', index: p.i, ext: false, point: [(p.b[0] + p.b[3]) / 2, (p.b[1] + p.b[4]) / 2, p.b[5]] });
    X.applyPick({ type: 'building', index: picks[0].i, ext: false, point: [0, 0, 0] });
    const toggled = X.state.multiSel.length === 2;
    X.applyPick({ type: 'building', index: picks[0].i, ext: false, point: [0, 0, 0] }); $('btn-multi-apply').click();
    record('multi-building selection toggles and becomes one hull site', toggled && X.state.removed.length === 3 && X.state.boundary.length >= 3 && !!X.state.site &&
      X.state.multiSel.every(q => X.isRemoved(q.index, q.ext)) && !$('btn-flow-next').disabled, { removed: X.state.removed.length, hull: X.state.boundary.length });

    swap('site', 'replace').click();
    X.applyPick({ type: 'building', index: picks[1].i, ext: false, point: [0, 0, 0] }); $('btn-replace-building').click();
    X.applyPick({ type: 'building', index: picks[2].i, ext: false, point: [0, 0, 0] }); $('btn-replace-building').click();
    record('single replace swaps rather than accumulates', X.state.removed.length === 1 && X.state.removed[0].index === picks[2].i);

    // auto-demolition: a podium dropped on a dense block hides the buildings it overlaps; the toggle brings them back
    X.flowGo('build', { force: true }); if (X.state.flow.methods.build !== 'platform') card('build', 'platform').click();
    const savedParts = JSON.parse(JSON.stringify(X.state.parts)); X.placeSite(300, 200, true); X.state.parts = [{ name: 'Podium', h: 30, w: 70, d: 70, dx: 0, dy: 0, rotation: 0 }]; X.refreshPanels();
    const cleared = X.state.cleared.slice(), first = cleared[0], fb = first ? X.assets.index.columns.bbox[first.index] : null;
    const hitHidden = fb ? X.pickRay([(fb[0] + fb[3]) / 2, (fb[1] + fb[4]) / 2, fb[5] + 300], [0, 0, -1]) : null;
    $('chk-clear-overlaps').click(); const offCount = X.state.cleared.length; $('chk-clear-overlaps').click();
    record('buildings under the proposal are demolished in the proposed scene and restored by the toggle', cleared.length > 0 && !!hitHidden && !(hitHidden.type === 'building' && hitHidden.index === first.index) && offCount === 0 && X.state.cleared.length === cleared.length,
      { cleared: cleared.length, off: offCount });
    X.state.parts = savedParts; X.refreshPanels();
    const hash = X.serializeHash(); X.applyHash('#style=collage'); X.applyHash(hash);
    record('flow stage and methods survive the URL round trip', X.state.flow.stage === 'build' && X.state.flow.methods.site === 'replace' &&
      X.state.flow.methods.build === 'platform' && X.state.flow.methods.view === 'cone');
  } catch (error) { record('exception', false, { message: String(error?.message || error), stack: String(error?.stack || '').slice(0, 700) }); }
  finally {
    if (originalHash && X) try { X.applyHash(originalHash); } catch (error) { record('restore original study', false, String(error)); }
    const result = { tests, all_pass: tests.length > 0 && tests.every(t => t.pass) };
    const pre = document.createElement('pre'); pre.id = 'flow-selftest-result'; pre.style.display = 'none'; pre.textContent = JSON.stringify(result); document.body.appendChild(pre);
    document.title = result.all_pass ? 'FLOWTEST DONE' : 'FLOWTEST FAIL';
  }
})();
