/* Height suggestions are opt-in. Only block heights change; cached geometry is never a permission. */
(function (root) {
  'use strict';
  const doc = root.document;
  if (!doc) return;
  const X = () => root.__explorer, $ = id => doc.getElementById(id);
  const finite = Number.isFinite;
  let cache = null, cacheEngine = null, prompt = null, overlay = null, busy = false;
  let lastIdentity = '', lastParts = '', actionMessage = '', undo = null;
  let siteResult = null, selectedResult = null;
  const dismissed = new Set(), projectAttempts = new Map(), projectSavedKeys = new Set();
  const KEY_BUDGET_BYTES = 1024 * 1024, retainedKeys = new Map();
  let retainedKeyBytes = 0, keyClock = 0, currentDismissed = false;
  let projectStore = null, projectGeneration = 0;
  // Remove only the obsolete derived cache. New height records belong to the
  // Vista project data; browser application storage is no longer used.
  try { root.localStorage?.removeItem('vista-view-height-v1'); } catch (_) {}

  function element(tag, id, className, text) {
    const node = doc.createElement(tag);
    if (id) node.id = id;
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }
  function append(parent, tag, id, className, text) { return parent.appendChild(element(tag, id, className, text)); }
  function button(parent, id, className, text, handler) {
    const node = append(parent, 'button', id, className, text);
    node.type = 'button'; node.addEventListener('click', handler); return node;
  }
  function status(parent, id) {
    const node = append(parent, 'p', id, 'small'); node.setAttribute('role', 'status'); node.setAttribute('aria-live', 'polite'); return node;
  }
  function mount() {
    const header = doc.querySelector('[data-stage="build"].flow-stage > .stage-head');
    if (!prompt && header) {
      prompt = element('section', 'view-height-prompt', 'view-height-prompt hidden');
      prompt.setAttribute('aria-labelledby', 'view-height-title'); prompt.hidden = true;
      append(prompt, 'h3', 'view-height-title', '', 'View-height suggestion');
      append(prompt, 'p', 'view-height-value', 'view-height-value');
      append(prompt, 'p', 'view-height-certainty', 'small');
      const actions = append(prompt, 'div', '', 'actions');
      button(actions, 'view-height-adjust', 'btn primary', 'Adjust', () => apply('site'));
      button(actions, 'view-height-dismiss', 'btn', 'Dismiss', dismiss);
      const explanation = append(prompt, 'details', 'view-height-explanation', 'tool-method-guide');
      append(explanation, 'summary', '', '', 'Calculation & sources');
      append(explanation, 'p', 'view-height-warning', 'small');
      append(explanation, 'p', 'view-height-scope', 'small muted');
      append(explanation, 'p', 'view-height-cache', 'small muted');
      status(prompt, 'view-height-status');
      button(prompt, 'view-height-undo', 'btn hidden', 'Undo height adjustment', restore);
      header.insertAdjacentElement('afterend', prompt);
    }
    // The regulation reader also mounts after the heading; keep the decision first.
    if (prompt && header && header.nextElementSibling !== prompt) header.insertAdjacentElement('afterend', prompt);
    const viewStatus = $('viewcone-status');
    if (!overlay && viewStatus) {
      overlay = element('div', 'viewcone-height-action', 'viewcone-height-action');
      button(overlay, 'viewcone-adjust-height', 'btn', 'Adjust height below cone', () => apply('selected'));
      button(overlay, 'viewcone-undo-height', 'btn hidden', 'Undo height adjustment', restore);
      status(overlay, 'viewcone-adjust-status');
      viewStatus.insertAdjacentElement('afterend', overlay);
    }
  }
  function format(value) {
    return finite(value) ? root.VistaUnits?.formatLength(value, X()?.state.displayUnits) || value.toFixed(1) + ' m' : 'Unavailable';
  }
  function context(scope) {
    try { return root.VistaViewcone?.getHeightContext?.({scope}) || null; }
    catch (_) { return null; }
  }
  function calculate(input) {
    const engine = root.ViewHeightSuggestion;
    if (!input || !engine?.buildRecommendation) return null;
    if (cacheEngine !== engine) {
      cacheEngine = engine;
      cache = engine.createCache?.({memoryOnly:true, maxEntries:250}) || null;
      projectGeneration++; clearProjectHistory();
    }
    try {
      let value = null;
      try { value = cache?.get(input); } catch (_) {}
      if (!value) {
        if (loadProjectCalculation(input, engine)) return {status:'loading', missingViews:input.missingViews || [], assumed:!!input.assumed};
        value = engine.buildRecommendation(input); try { cache?.set(input, value); } catch (_) {}
      }
      return value;
    } catch (_) {
      return {status:'unresolved', missingViews:input.missingViews || [], assumed:!!input.assumed, issues:['The height calculation could not finish. Review the site geometry and view surface.']};
    }
  }
  function releaseKey(group, key) {
    const record = retainedKeys.get(key);
    if (!record) return;
    record.groups.delete(group);
    if (!record.groups.size) { retainedKeys.delete(key); retainedKeyBytes -= record.bytes; }
  }
  function dropRetained(record) {
    dismissed.delete(record.key); projectAttempts.delete(record.key); projectSavedKeys.delete(record.key);
    retainedKeys.delete(record.key); retainedKeyBytes -= record.bytes;
  }
  function retainKey(group, key) {
    const present = retainedKeys.get(key);
    if (present) { present.groups.add(group); present.used = ++keyClock; return present.key; }
    const bytes = key.length * 2 + 64;
    if (bytes > KEY_BUDGET_BYTES) return null;
    while (retainedKeyBytes + bytes > KEY_BUDGET_BYTES) {
      let oldest = null;
      for (const record of retainedKeys.values()) {
        if (projectAttempts.get(record.key)?.pending || projectAttempts.get(record.key)?.writing || record.groups.has('dismissed') && record.key === lastIdentity) continue;
        if (!oldest || record.used < oldest.used) oldest = record;
      }
      if (!oldest) return null;
      dropRetained(oldest);
    }
    retainedKeys.set(key, {key, bytes, groups:new Set([group]), used:++keyClock}); retainedKeyBytes += bytes;
    return key;
  }
  function clearProjectHistory() {
    for (const key of projectAttempts.keys()) releaseKey('attempt', key);
    for (const key of projectSavedKeys) releaseKey('saved', key);
    projectAttempts.clear(); projectSavedKeys.clear();
  }
  function savedProjectKey(key) {
    const retained = retainKey('saved', key);
    if (!retained) return;
    projectSavedKeys.add(retained);
    if (projectSavedKeys.size > 250) { const oldest = projectSavedKeys.values().next().value; projectSavedKeys.delete(oldest); releaseKey('saved', oldest); }
  }
  function loadProjectCalculation(input, engine) {
    if (input.persistAllowed !== true || typeof engine.keyFor !== 'function' || typeof engine.readRecord !== 'function') return false;
    const store = root.VistaHeightProjectStore;
    if (!store || typeof store.get !== 'function') return false;
    if (store !== projectStore) { projectStore = store; projectGeneration++; clearProjectHistory(); }
    let key = engine.keyFor(input);
    if (!key) return false;
    const previous = projectAttempts.get(key);
    if (previous) return previous.pending;
    // Bound in-flight requests as well as completed lookup history. Camera and
    // style refreshes reuse this decision instead of issuing another request.
    if ([...projectAttempts.values()].filter(value => value.pending || value.writing).length >= 16) return false;
    while (projectAttempts.size >= 250) {
      const oldest = [...projectAttempts].find(([, value]) => !value.pending && !value.writing);
      if (!oldest) return false;
      projectAttempts.delete(oldest[0]); releaseKey('attempt', oldest[0]);
    }
    key = retainKey('attempt', key);
    if (!key) return false;
    const attempt = {pending:true}, generation = projectGeneration, targetCache = cache;
    projectAttempts.set(key, attempt);
    Promise.resolve().then(() => store.get(input, key)).catch(() => null).then(record => {
      if (generation !== projectGeneration || cacheEngine !== engine || cache !== targetCache) return;
      attempt.pending = false;
      // Contexts retain their original values. Changed source data or a mutated
      // polygon cannot seed a result under the earlier revision's cache key.
      if (engine.keyFor(input) !== key) { refresh(); return; }
      const loaded = engine.readRecord(input, record);
      let value = loaded;
      if (!value) value = engine.buildRecommendation(input);
      try { targetCache?.set(input, value); } catch (_) {}
      if (loaded) savedProjectKey(key);
      else if (typeof store.set === 'function' && typeof engine.createRecord === 'function') {
        const fresh = engine.createRecord(input, value);
        if (fresh) {
          attempt.writing = true;
          Promise.resolve().then(() => store.set(input, fresh)).then(stored => {
            if (stored === true && generation === projectGeneration && engine.keyFor(input) === key) { savedProjectKey(key); refresh(); }
          }).catch(() => {}).finally(() => { attempt.writing = false; });
        }
      }
      refresh();
    }).catch(() => { attempt.pending = false; refresh(); });
    return true;
  }
  // The prompt dismissal excludes heights, cameras, units and render style. A
  // new location, footprint or tested surface is a new design decision.
  function identity(input) {
    if (!input) return '';
    return JSON.stringify([input.location, input.baseModelZ, input.pmode, input.sourceRevision,
      (input.parts || []).map(part => part.footprint),
      (input.planes || []).map(p => [p.id, p.polygon, p.plane, p.source, p.basis, p.datum, p.assumed]),
      input.affectingViews, input.missingViews, input.assumed]);
  }
  function partsSnapshot() { return JSON.stringify(X()?.state.parts || []); }
  function isDismissed(key) { return key === lastIdentity && currentDismissed || dismissed.has(key); }
  function rememberDismissal(key) {
    if (!key) return;
    if (key === lastIdentity) currentDismissed = true;
    const retained = retainKey('dismissed', key);
    if (!retained) return;
    dismissed.add(retained);
    if (dismissed.size > 100) { const oldest = dismissed.values().next().value; dismissed.delete(oldest); releaseKey('dismissed', oldest); }
  }
  function dismiss() {
    rememberDismissal(lastIdentity); actionMessage = ''; refresh();
    const heading = $('stage-build-title');
    if (X()?.state.flow?.stage === 'build' && heading) { heading.tabIndex = -1; heading.focus?.({preventScroll:true}); }
  }
  function platformChosen() { const flow = X()?.state.flow; return !flow?.guided || flow.methods?.build === 'platform'; }
  function canStartPlatform() { const flow = X()?.state.flow; return platformChosen() || flow?.stage === 'build' && !flow.methods?.build && typeof X()?.chooseMethod === 'function'; }
  function validHeight(value) { return finite(value) && value > 0 && value <= 2000; }
  function ready(result) { return result?.status === 'ready' && validHeight(result.maxHeightM); }
  function reason(result) {
    if (!result) return 'Calculating the view-height suggestion…';
    if (result.status === 'loading') return 'Looking up the saved Vista calculation. A local calculation will be used if no matching project record exists.';
    if (result.status === 'unsupported') return 'Imported model: automatic height adjustment is unavailable. Edit the original model to preserve its geometry.';
    if (result.status === 'outside') return 'This footprint is outside the mapped corridor. No view-height adjustment is suggested.';
    if (result.status === 'no-positive-height') return 'This surface leaves no usable block height above the modelled base. Review the surface and site position.';
    if (!ready(result)) {
      const issue = (result.issues || []).join(' ');
      if (/part_limit|extent_limit|vertex_limit|site_extent/i.test(issue)) return 'Use up to 128 blocks within a 1 km site span, or study a smaller footprint.';
      if (/actual_block|rectangular_block|contiguous_stack|footprint_does_not_match/i.test(issue)) return 'Use valid, stacked rectangular platform blocks. Review the block dimensions and offsets.';
      if (/aligned_site|aligned_affine|no_aligned_surface|coordinate|datum/i.test(issue)) return 'The site base and view surface need a compatible vertical reference. Review the surface inputs or use the separate Viewcone study ceiling.';
      if (/work|complex|budget|limit/i.test(issue)) return 'This geometry exceeds the interactive calculation limit. Use fewer blocks or a simpler view boundary.';
      return 'A height could not be calculated from this footprint and the aligned view surfaces. Review the block dimensions and surface inputs.';
    }
    return '';
  }
  function scopeText(result) {
    const missing = result?.missingViews || [];
    const prefix = result?.assumed ? 'Study assumption · unverified. ' : 'Entered surface · unverified. ';
    const covered = (result?.coveredViews || []).join(', ');
    return prefix + (covered ? `Tested corridors: ${covered}. ` : '') +
      (missing.length ? `No aligned surface for ${missing.join(', ')}; this height does not establish protection of every affected view. ` : '') +
      'Zoning, legal grade and other development limits remain separate.';
  }
  function canRestore() {
    return !!undo && X()?.state.pmode === 'boxes' && identity(context(undo.scope)) === undo.identity && partsSnapshot() === undo.appliedParts && typeof X()?.restoreProposalParts === 'function';
  }
  function renderPrompt(input, result) {
    if (!prompt) return;
    const atBuild = X()?.state.flow?.stage === 'build';
    const show = !!input?.ready && atBuild && !!X()?.state.site &&
      (!isDismissed(lastIdentity) || !!actionMessage) &&
      (ready(result) || result?.status === 'unsupported' || result?.status === 'no-positive-height' || result?.status === 'unresolved' || result?.status === 'loading');
    prompt.hidden = !show; prompt.classList.toggle('hidden', !show);
    if (!show) return;
    $('view-height-value').textContent = ready(result) ? `${format(result.maxHeightM)} above the modelled site base` : result?.status === 'loading' ? 'Looking up the saved height…' : 'Height suggestion unavailable';
    const missing = result?.missingViews || [];
    $('view-height-certainty').textContent = `${result?.assumed ? 'Study assumption' : 'Entered surface'} · unverified.${result?.controllingView ? ` View ${result.controllingView}.` : ''}${missing.length ? ` Missing surfaces: ${missing.join(', ')}.` : ''}`;
    $('view-height-warning').textContent = ready(result)
      ? `${result.intrusion ? 'Your mass enters the tested view surface. ' : ''}${result.controllingView ? `Corridor ${result.controllingView} controls this footprint. ` : ''}${platformChosen() ? 'Adjust uses the suggested height and scales the blocks together; Dismiss keeps your dimensions.' : 'Adjust starts platform blocks at this height; Dismiss keeps your choice of building method.'}${finite(result.clearanceM) && result.clearanceM > 0 ? ` Includes ${format(result.clearanceM)} clearance below the surface.` : ''}`
      : reason(result);
    $('view-height-scope').textContent = scopeText(result);
    $('view-height-cache').textContent = ready(result) && result.cacheHit ? input.persistAllowed === true && projectSavedKeys.has(result.cacheKey) ? 'Saved in Vista project data.' : 'Cached for this session.' : '';
    $('view-height-cache').hidden = !$('view-height-cache').textContent;
    $('view-height-adjust').disabled = busy || !canStartPlatform() || !ready(result) || input.pmode !== 'boxes' || Math.abs(result.currentHeightM - result.maxHeightM) < 0.001;
    $('view-height-status').textContent = actionMessage;
    $('view-height-undo').classList.toggle('hidden', !canRestore());
    $('view-height-undo').hidden = !canRestore();
  }
  function renderOverlay(input, result) {
    if (!overlay) return;
    const valid = ready(result) && canStartPlatform() && input?.pmode === 'boxes' && result.intrusion && validHeight(result.adjustHeightM);
    $('viewcone-adjust-height').disabled = busy || !valid;
    $('viewcone-adjust-status').textContent = actionMessage || (ready(result)
      ? result.intrusion ? `Reduce the blocks to ${format(result.adjustHeightM)} for corridor ${result.controllingView || 'selected'}. ${result.assumed ? 'Study ceiling only; unverified.' : 'Entered surface only; unverified.'}`
        : 'The current blocks are below the selected tested surface.'
      : reason(result));
    $('viewcone-undo-height').classList.toggle('hidden', !canRestore());
    $('viewcone-undo-height').hidden = !canRestore();
  }
  function refresh() {
    if (!X()) return;
    mount();
    if (busy) return;
    const input = context('site'), nextIdentity = identity(input), snapshot = partsSnapshot();
    if (nextIdentity !== lastIdentity) { actionMessage = ''; lastIdentity = nextIdentity; currentDismissed = dismissed.has(nextIdentity); lastParts = snapshot; }
    else if (lastParts && snapshot !== lastParts) {
      // Direct dimension edits are the user's answer; do not reopen the warning.
      rememberDismissal(nextIdentity); actionMessage = ''; lastParts = snapshot;
    }
    if (undo && !canRestore()) undo = null;
    siteResult = calculate(input);
    const selectedInput = context('selected'); selectedResult = calculate(selectedInput);
    renderPrompt(input, siteResult); renderOverlay(selectedInput, selectedResult);
  }
  function apply(scope) {
    if (busy || !canStartPlatform() || typeof X()?.applyHeightReference !== 'function') return false;
    let input = context(scope), result = calculate(input);
    let height = scope === 'selected' ? result?.adjustHeightM : result?.maxHeightM;
    if (!ready(result) || input?.pmode !== 'boxes' || !validHeight(height) || (scope === 'selected' && !result.intrusion)) { refresh(); return false; }
    busy = true;
    let applied = false, original, beforeIdentity;
    try {
      // Clicking Adjust explicitly chooses platform blocks when Build has not
      // yet selected a method. Merely reading or dismissing never does so.
      if (!platformChosen() && X().chooseMethod('build', 'platform') !== true) throw new Error('platform_unavailable');
      input = context(scope); result = calculate(input);
      height = scope === 'selected' ? result?.adjustHeightM : result?.maxHeightM;
      if (!ready(result) || input?.pmode !== 'boxes' || !validHeight(height) || (scope === 'selected' && !result.intrusion)) throw new Error('height_changed');
      original = JSON.parse(partsSnapshot()); beforeIdentity = identity(input);
      applied = X().applyHeightReference(height) === true;
    } catch (_) { applied = false; }
    finally { busy = false; }
    if (!applied) { actionMessage = 'These block dimensions cannot use that height. Keep editing, or review the view surface.'; refresh(); return false; }
    const afterInput = context(scope), checked = calculate(afterInput);
    undo = {parts:original, appliedParts:partsSnapshot(), identity:identity(afterInput), scope};
    rememberDismissal(identity(context('site')));
    lastIdentity = identity(context('site')); currentDismissed = true; lastParts = partsSnapshot();
    const changedContext = beforeIdentity !== identity(afterInput);
    actionMessage = checked && ready(checked) && !checked.intrusion && !changedContext
      ? `Adjusted to ${format(height)}. The blocks are below the ${scope === 'selected' ? 'selected' : 'tested'} surface${result.assumed ? ' in this study' : ''}.`
      : 'The block height changed. Review the current view geometry; clearance could not be confirmed.';
    if (checked?.missingViews?.length) actionMessage += ' Other affected corridors still have missing surfaces.';
    refresh(); X()?.renderOnce?.(); return true;
  }
  function restore() {
    if (!canRestore()) { refresh(); return false; }
    const previous = undo.parts;
    busy = true;
    let restored = false;
    try { restored = X().restoreProposalParts(previous) === true; }
    catch (_) { restored = false; }
    finally { busy = false; }
    if (restored) { undo = null; lastParts = partsSnapshot(); rememberDismissal(identity(context('site'))); actionMessage = 'Restored your previous block dimensions.'; }
    refresh(); X()?.renderOnce?.(); return restored;
  }
  root.VistaHeightSuggestion = {refresh, apply, dismiss, restore, getMemoryCache:() => cache,
    getState:() => ({siteResult, selectedResult, dismissed:isDismissed(lastIdentity), canUndo:canRestore(), actionMessage, keyHistory:{bytes:retainedKeyBytes,maxBytes:KEY_BUDGET_BYTES,entries:retainedKeys.size,pending:[...projectAttempts.values()].filter(value=>value.pending || value.writing).length}})};
  Promise.resolve(X()?.ready).then(refresh).catch(() => {});
})(typeof window !== 'undefined' ? window : globalThis);
