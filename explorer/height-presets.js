/* Opt-in, sourced starting heights. A reference never changes a proposal until clicked. */
(function (root) {
  'use strict';
  let dataset = null, engine = null, pending = null, readyPromise = null, isReady = false;
  let loadError = '', evaluationKey = '', result = null, renderKey = '', card = null;
  let lastInput = null, undo = null, actionMessage = '', coneSource = null, coneVersion = 0, caseEngine = null;
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const X = () => root.__explorer;
  const $ = id => document.getElementById(id);
  const format = metres => finite(metres) ? root.VistaUnits?.formatLength(metres, X()?.state.displayUnits) || metres.toFixed(1) + ' m' : 'Unavailable';

  function mount() {
    if (card) return card;
    const header = document.querySelector('[data-stage="build"].flow-stage > .stage-head');
    if (!header) return null;
    card = document.createElement('section'); card.id = 'height-reference-card'; card.className = 'card height-reference-card';
    card.setAttribute('aria-labelledby', 'height-reference-title');
    card.innerHTML = '<button id="height-use-regulation" class="btn primary height-regulation-action" type="button" disabled>Use height reference</button>' +
      '<p id="height-reference-status" class="small" role="status" aria-live="polite"></p>' +
      '<button id="height-reference-restore" class="btn hidden" type="button">Restore previous height</button>' +
      '<details id="height-reference-details" class="details"><summary id="height-reference-title">Regulations &amp; calculation</summary>' +
      '<p id="height-reference-scope" class="small muted"></p>' +
      '<dl class="ceiling-values"><div><dt>Zoning height reference</dt><dd id="height-reference-zoning">Checking…</dd></div><div><dt>With entered view planes</dt><dd id="height-reference-view">Checking…</dd></div></dl>' +
      '<div id="height-reference-rules" class="small"></div><p id="height-reference-view-note" class="small muted"></p>' +
      '<p class="small">Study calculation: compare the basic zoning-height reference with the entered view-plane elevation minus the proposal base. Take the lowest result across the whole footprint. A view plane is clipped to the footprint; its lowest elevation controls. A legal height requires the prescribed grade/base surface and compatible vertical datums; the proposal base is only the current model study reference.</p>' +
      '<p class="small">City corridor polygons show plan coverage. Their lower vertical surfaces are not included in the open data. Enter sourced study planes and a named datum in Output → How tall could I build here? to test a view-adjusted reference.</p>' +
      '<div class="actions"><button id="height-use-zoning" class="btn" type="button" disabled>Use zoning height only</button><button id="height-use-view" class="btn" type="button" disabled>Use entered view-adjusted height</button></div>' +
      '<p class="small muted">Basic selected-use references only. Density, tower separation, setbacks, floorplates, solar access, heritage, site-specific approvals and safety rules can further constrain the design. Model terrain does not establish the legal building grade.</p></details>' +
      '<button id="height-reference-retry" class="btn hidden" type="button">Retry height references</button>';
    header.insertAdjacentElement('afterend', card);
    card.querySelectorAll('button').forEach(button => { button.style.minHeight = '44px'; });
    $('height-use-regulation').addEventListener('click', () => apply(primaryKind()));
    $('height-use-zoning').addEventListener('click', () => apply('zoning'));
    $('height-use-view').addEventListener('click', () => apply('view'));
    $('height-reference-retry').addEventListener('click', () => { loadError = ''; renderKey = ''; ensure({retry:true}); refresh(); });
    $('height-reference-restore').addEventListener('click', restore);
    return card;
  }

  function waitReady(explorer) {
    if (!readyPromise) readyPromise = Promise.resolve(explorer.ready).then(() => { isReady = true; refresh(); });
    return readyPromise;
  }

  async function ensure(options) {
    const explorer = X();
    if (!explorer) return null;
    await waitReady(explorer);
    if (!explorer.state.site) return null;
    if (engine) { refresh(); return dataset; }
    if (pending) return pending;
    if (loadError && !options?.retry) return null;
    loadError = '';
    pending = (async () => {
      try {
        if (!root.HeightPolicy?.create || !root.ProjectAPI?.fetch) throw new Error('Height reference tools are unavailable.');
        const response = await root.ProjectAPI.fetch('/generated/height_policy.json');
        if (!response.ok) throw new Error('Height reference data returned HTTP ' + response.status + '.');
        const data = await response.json();
        if (!data || !Array.isArray(data.zones) || !data.rules) throw new Error('Height reference data has an unsupported format.');
        dataset = data; engine = root.HeightPolicy.create(data);
        const cases = Object.values(data.rules).flatMap(rule => (rule.heightCases || []).filter(c => c.polygons).map(c => ({...c,sourceUrl:rule.sourceUrl})));
        caseEngine = cases.length ? root.HeightPolicy.create({rules:Object.fromEntries(cases.map(c => [c.id,{basicHeightM:0,sourceUrl:c.sourceUrl}])),zones:cases.map(c => ({id:c.id,zone:c.id,ruleId:c.id,polygons:c.polygons,bbox:c.bbox}))}) : null;
        evaluationKey = ''; return data;
      } catch (error) {
        loadError = error?.message || 'Height reference data could not be loaded.'; return null;
      } finally { pending = null; renderKey = ''; refresh(); }
    })();
    refresh(); return pending;
  }

  function input(explorer) {
    const state = explorer.state, built = !state.flow?.guided || !!state.flow?.methods?.build;
    const proposal = built ? explorer.proposalBox?.() : null;
    const footprints = proposal ? explorer.proposalParts().map(part => explorer.partFootprint(part))
      : state.boundary?.length >= 3 ? [state.boundary] : [];
    const study = explorer.getConeStudy?.() || {};
    const cones = explorer.assets.cones?.available ? explorer.assets.cones.cones : [];
    if (coneSource !== explorer.assets.cones) { coneSource = explorer.assets.cones; coneVersion++; }
    const ground = proposal ? proposal.base : explorer.terrainZAt?.(state.site.x, state.site.y);
    return {proposal, study, scope: proposal ? 'All proposal part footprints' : footprints.length ? 'Your whole study boundary' : 'Your selected site point',
      options:{footprints, point:[state.site.x,state.site.y], cones, planes:study.planes || {}, datumOffsetM:study.datumOffsetM,
        groundModelZ:finite(ground) ? ground : null, proposalTopModelZ:proposal?.top ?? null},
      geometryKey:JSON.stringify([state.site,footprints,state.pmode]),
      key:JSON.stringify([state.site,footprints,ground,proposal?.top,state.pmode,coneVersion,study.planes instanceof Map ? [...study.planes] : study.planes,study.datumOffsetM,study.datumName])};
  }

  function evaluate() {
    const explorer = X();
    if (!isReady || !engine || !explorer?.state.site) { result = null; lastInput = null; return null; }
    const current = input(explorer);
    if (current.key !== evaluationKey) {
      const fps=current.options.footprints;
      let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
      for(const fp of fps) for(const q of fp){minX=Math.min(minX,q[0]);minY=Math.min(minY,q[1]);maxX=Math.max(maxX,q[0]);maxY=Math.max(maxY,q[1]);}
      const overBudget=fps.length>128||maxX-minX>1000||maxY-minY>1000;
      current.limitMessage=overBudget ? 'Full-footprint regulation comparison is paused for this large geometry. Use up to 128 proposal parts within a 1 km span, or study a smaller selected footprint.' : '';
      result = overBudget ? {zoningHeightM:null,combinedHeightM:null,zones:[],ruleIds:[],notes:[current.limitMessage],viewStatus:'unknown',missingViews:[],status:'complexity-limit'} : engine.evaluate(current.options);
      evaluationKey = current.key;
      actionMessage = '';
    }
    if(result?.status==='complexity-limit')current.limitMessage=result.notes[0];
    lastInput = current; return result;
  }

  function canApply(kind) {
    const explorer = X();
    if (!result || !lastInput?.proposal || explorer.state.pmode !== 'boxes' || typeof explorer.applyHeightReference !== 'function') return false;
    if (!kind) return false;
    if (kind === 'zoning') return finite(result.zoningHeightM) && result.zoningHeightM > 0;
    return finite(result.combinedHeightM) && result.combinedHeightM > 0 && result.viewStatus === 'ready'
      && finite(lastInput.study.datumOffsetM) && !!String(lastInput.study.datumName || '').trim();
  }

  function primaryKind() {
    if (result?.viewStatus === 'outside' && canApply('zoning')) return 'zoning';
    return canApply('view') ? 'view' : null;
  }

  function apply(kind) {
    evaluate();
    if (!canApply(kind)) { actionMessage = 'This reference cannot be applied to the current proposal.'; renderKey = ''; refresh(); return; }
    const explorer = X(), height = kind === 'zoning' ? result.zoningHeightM : result.combinedHeightM;
    const previous = lastInput.proposal.top - lastInput.proposal.base, geometryKey = lastInput.geometryKey;
    const applied = explorer.applyHeightReference(height);
    if (applied) { undo = {previous, applied:height, geometryKey}; actionMessage = `Used ${kind === 'zoning' ? 'zoning' : 'view-adjusted'} reference: ${format(height)}. Block heights were scaled together.`; }
    else actionMessage = 'The blocks could not use this height. Keep editing the dimensions or choose another reference.';
    evaluationKey = ''; evaluate();
    // Evaluation invalidation clears earlier announcements; retain this explicit action result.
    actionMessage = applied ? `Used ${kind === 'zoning' ? 'zoning' : 'view-adjusted'} reference: ${format(height)}. Block heights were scaled together.` : 'The blocks could not use this height. Keep editing the dimensions or choose another reference.';
    renderKey = ''; refresh();
  }

  function canRestore() {
    const proposal = lastInput?.proposal;
    return !!undo && X().state.pmode === 'boxes' && proposal && undo.geometryKey === lastInput.geometryKey
      && Math.abs(proposal.top - proposal.base - undo.applied) < 1e-5;
  }

  function restore() {
    evaluate(); if (!canRestore()) return;
    const height = undo.previous;
    if (X().applyHeightReference(height)) {
      undo = null; evaluationKey = ''; evaluate(); actionMessage = `Restored the previous block height: ${format(height)}.`;
      renderKey = ''; refresh();
    }
  }

  function addText(parent, tag, text, className) {
    const el = document.createElement(tag); el.textContent = text; if (className) el.className = className; parent.appendChild(el); return el;
  }

  function renderRules() {
    const target = $('height-reference-rules'); target.replaceChildren();
    if (!result) return;
    if(lastInput?.limitMessage){addText(target,'p',lastInput.limitMessage);return;}
    if (!result.zones.length) addText(target,'p','No mapped zoning covers this study geometry. A numeric reference is unavailable.');
    for (const ruleId of result.ruleIds || []) {
      const rule = dataset.rules[ruleId]; if (!rule) continue;
      const zones = [...new Set(result.zones.filter(zone => zone.ruleId === ruleId).map(zone => zone.zone))];
      addText(target,'p',zones.join(', ') + (rule.section ? ' · '+rule.section : ''));
      if (rule.note) addText(target,'p',rule.note);
      if (rule.heightCases?.length) {
        const matched = caseEngine && lastInput ? caseEngine.evaluate(lastInput.options).ruleIds : [];
        for (const c of rule.heightCases.filter(c => !matched.length || matched.includes(c.id))) {
          addText(target,'p',`${matched.length ? 'Mapped candidate' : 'District rule case'} · ${c.area}: ${format(c.heightAboveReferenceM)} above ${c.referenceSurface}. ${c.section}.`);
          if (finite(c.discretionaryHeightAboveReferenceM)) addText(target,'p',`Discretionary consideration up to ${format(c.discretionaryHeightAboveReferenceM)} above that reference requires approval; it is not a preset.`);
        }
        addText(target,'p','The source-derived sub-area split needs map review. Candidate matching does not resolve the 10 m boundary review zone; sites near the split must review both cases. Canada Harbour Place has separate rules. No case is treated as a verified parcel permission.');
        addText(target,'p','Waterfront calculation: railway-grade elevation + applicable rule height = zoning top elevation. Subtract the proposal-base elevation only after both references are aligned. “Level 101” is not assumed to mean 101 m or sea level.');
      }
      if (Array.isArray(rule.conditions) && rule.conditions.length) {
        const list = document.createElement('ul'); rule.conditions.forEach(text => addText(list,'li',String(text))); target.appendChild(list);
      } else if (typeof rule.conditions === 'string') addText(target,'p',rule.conditions);
      if (typeof rule.sourceUrl === 'string' && /^https?:\/\//.test(rule.sourceUrl)) {
        const link = addText(target,'a',rule.basicHeightM == null ? 'Review official zoning source' : 'Read the official district schedule');
        link.href = rule.sourceUrl; link.target = '_blank'; link.rel = 'noopener noreferrer';
      }
    }
    if (result.zoningHeightM == null && result.zones.length) addText(target,'p', 'Every zone touched by the whole footprint needs a resolved rule and measurement reference. DD height areas and site-specific CD-1 rules require separate review.');
    if (result.notes?.some(note => note.includes('no mapped zoning coverage'))) addText(target,'p','Part of the footprint has no mapped zoning coverage; the known zones cannot supply a whole-footprint reference.');
  }

  function refresh() {
    const explorer = X(); if (!explorer || !mount()) return;
    if (!isReady) { waitReady(explorer).catch(() => {}); return; }
    card.classList.toggle('hidden', !explorer.state.site);
    if (!explorer.state.site) { result = null; lastInput = null; evaluationKey = ''; return; }
    if (!engine && !pending && !loadError) { ensure(); }
    evaluate();
    const key = JSON.stringify([evaluationKey,explorer.state.displayUnits,!!pending,loadError,actionMessage,canRestore(),typeof explorer.applyHeightReference]);
    if (key === renderKey) return; renderKey = key;
    const needsGrade = result?.ruleIds.some(id => dataset.rules[id]?.status === 'reference-surface-required');
    $('height-reference-zoning').textContent = needsGrade ? 'Reference grade required' : result ? format(result.zoningHeightM) : 'Checking…';
    const viewReady = result && result.viewStatus === 'ready' && finite(lastInput?.study.datumOffsetM) && !!String(lastInput?.study.datumName || '').trim();
    $('height-reference-view').textContent = viewReady ? format(result.combinedHeightM) : result?.viewStatus === 'outside' ? 'Outside mapped corridors' : 'Vertical geometry required';
    $('height-reference-scope').textContent = result ? `${lastInput.scope}. ${[...new Set(result.zones.map(zone => zone.zone))].join(', ') || 'Zoning unavailable'}. Selected-use basic references; site, grades and other conditions require review.` : 'Loading sourced zoning references…';
    $('height-use-regulation').disabled = !primaryKind();
    $('height-use-zoning').disabled = !canApply('zoning'); $('height-use-view').disabled = !canApply('view');
    let viewNote = '';
    if (result) {
      if (result.viewStatus === 'outside') viewNote = 'No mapped view corridor overlaps this geometry. No view adjustment is calculated; the zoning reference remains available separately.';
      else if (result.missingViews?.length) viewNote = 'View-adjusted reference unavailable: vertical study planes are missing for views ' + result.missingViews.join(', ') + '.';
      else if (!finite(lastInput.study.datumOffsetM) || !String(lastInput.study.datumName || '').trim()) viewNote = 'View-adjusted reference unavailable: enter a named datum and model-to-datum offset with sourced vertical study planes.';
      else if (!finite(result.combinedHeightM)) viewNote = 'View-adjusted reference unavailable: complete zoning coverage, usable vertical study planes and a ground reference are required.';
      else if (result.combinedHeightM <= 0) viewNote = 'The entered study planes leave no positive height above this ground reference. A block height cannot be applied.';
      else viewNote = 'Uses the lower zoning reference and your entered view-plane study across all footprints. Ground follows the proposal base; zoning grades are not verified.';
    }
    $('height-reference-view-note').textContent = viewNote;
    let message = actionMessage || (loadError ? loadError + ' Retry when the data is available.' : pending ? 'Loading height references…' : needsGrade ? 'Height rules found. Review the required reference grade and view geometry below.' : primaryKind() ? (result.viewStatus === 'outside' ? 'Applies the basic zoning reference; outside mapped view corridors. Review conditions below.' : 'Applies the lower zoning reference and entered view-plane study. Review assumptions below.') : 'Review the missing height inputs below. Zoning-only comparison may still be available.');
    if(lastInput?.limitMessage)message=lastInput.limitMessage;
    else if (explorer.state.pmode === 'import') message = 'Imported model: reference heights are for comparison. Applying them is disabled to preserve the model geometry.';
    else if (result && !lastInput.proposal) message = 'Choose Build on the platform to apply a reference to blocks. The references above describe your study boundary or selected point.';
    $('height-reference-status').textContent = message;
    $('height-reference-retry').classList.toggle('hidden',!loadError);
    $('height-reference-restore').classList.toggle('hidden',!canRestore());
    renderRules();
  }

  root.VistaHeights = {ensure, refresh, get result() { return result; }};
})(typeof window !== 'undefined' ? window : globalThis);
