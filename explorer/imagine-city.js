/* Imagine operates on the live model. Its controls and derived results stay in page memory. */
(function (root) {
  'use strict';
  const doc = root.document;
  if (!doc) return;
  const $ = id => doc.getElementById(id), X = () => root.__explorer;
  const S = {open:false, loading:false, calculating:false, exporting:false, data:null, result:null, error:'', scenario:'views', showCones:true, useAssumptions:true, missingHeightM:213.36, studyHeightM:120, selected:null, generation:0, cacheHits:0};
  let panel = null, original = null, controller = null, timeout = null, version = 0;
  const results = new Map();
  let cacheDataset = null, cacheEngine = null, exportVersion = 0;
  const LIMIT_BYTES = 20 * 1024 * 1024;
  function element(tag, id, text, parent, className) {
    const n = doc.createElement(tag); if (id) n.id = id; if (text) n.textContent = text; if (className) n.className = className; if (parent) parent.appendChild(n); return n;
  }
  function button(parent, id, text, handler, primary) {
    const n = element('button', id, text, parent, 'btn' + (primary ? ' primary' : '')); n.type = 'button'; n.addEventListener('click', handler); return n;
  }
  function link(parent, text, url) { const n = element('a', '', text, parent); n.href = url; n.target = '_blank'; n.rel = 'noopener'; return n; }
  function paragraph(parent, text, id) { return element('p', id || '', text, parent); }
  function details(parent, title, id) { const n = element('details', id || '', '', parent, 'imagine-city-disclosure'); element('summary', '', title, n); return n; }
  function check(parent, id, label, checked, handler) {
    const n = element('label', '', '', parent, 'imagine-city-check'), input = element('input', id, '', n); input.type = 'checkbox'; input.checked = checked;
    element('span', '', label, n); input.addEventListener('change', handler); return input;
  }
  function numeric(parent, id, label, value, min, max) {
    const n = element('label', '', label, parent, 'imagine-city-field'); n.htmlFor = id;
    const input = element('input', id, '', n); input.type = 'number'; input.min = String(min); input.max = String(max); input.step = '0.1'; input.value = String(value); input.required = true; return input;
  }
  function mount() {
    if (panel) return true;
    const host = $('panel'); if (!host) return false;
    panel = element('section', 'imagine-city-panel', '', host, 'imagine-city-panel'); panel.hidden = true; panel.setAttribute('aria-labelledby', 'imagine-city-title');
    const header = element('header', '', '', panel, 'imagine-city-head');
    const heading = element('h2', 'imagine-city-title', 'Imagine Vancouver', header); heading.tabIndex = -1;
    paragraph(header, 'Explore height changes on this model. Keep rotating the city or switch Plain, Night and Context above.');
    button(header, 'imagine-city-close', 'Return to my study', close);
    const certainty = paragraph(panel, 'Study surfaces — unverified', 'imagine-city-certainty'); certainty.className = 'imagine-city-certainty';
    paragraph(panel, 'Blue surfaces use mapped public view corridors and an explicit height assumption. They are not City-issued height limits.', 'imagine-city-limit');
    const scenarios = element('fieldset', '', '', panel, 'imagine-city-scenarios'); element('legend', '', 'Compare the skyline', scenarios);
    const options = element('div', '', '', scenarios, 'imagine-city-options');
    for (const [id, label] of [['existing','Existing'],['zoning','Height references'],['views','With view cones']]) button(options, 'imagine-city-' + id, label, () => setScenario(id));
    paragraph(scenarios, '', 'imagine-city-scenario-note');
    const loading = element('div', 'imagine-city-loading', '', panel, 'imagine-city-loading'); loading.hidden = true; loading.setAttribute('role', 'status'); loading.setAttribute('aria-live', 'polite');
    element('span', '', '', loading, 'imagine-city-loading-mark'); paragraph(loading, '', 'imagine-city-progress');
    const error = paragraph(panel, '', 'imagine-city-error'); error.hidden = true; error.setAttribute('role', 'alert');
    const retry = button(panel, 'imagine-city-retry', 'Retry loading', () => load()); retry.hidden = true;
    const summary = element('section', '', '', panel, 'imagine-city-summary'); summary.setAttribute('aria-label', 'Scenario results');
    paragraph(summary, '', 'imagine-city-results');
    const view = details(panel, 'View protection', 'imagine-city-view-details'); view.open = true;
    check(view, 'imagine-city-cones', 'Show all view cones in blue', S.showCones, () => toggleCones($('imagine-city-cones').checked));
    const form = element('form', 'imagine-city-surface-form', '', view, 'imagine-city-form');
    numeric(form, 'imagine-city-study-height', 'Study ceiling at downtown reference (m model Z)', S.studyHeightM, 1, 2000);
    button(form, 'imagine-city-surface-apply', 'Update study surfaces', () => {}); $('imagine-city-surface-apply').type = 'submit';
    form.addEventListener('submit', e => { e.preventDefault(); const value = Number($('imagine-city-study-height').value); if (!validHeight(value, 1)) return inputError('Enter a study ceiling from 1 to 2,000 m.'); S.studyHeightM = value; calculate(); });
    paragraph(view, 'Each surface slopes from its modelled observer toward one fixed downtown reference at model (0, 0). The reference stays fixed when your proposal moves.');
    paragraph(view, 'Every intersecting corridor is tested across the building footprint. The lowest surface controls height, with 0.1 m clearance. Connected building parts scale together. Geometry, heights and terrain remain approximate.');
    const list = details(view, 'Corridors and surface sources'); element('ul', 'imagine-city-cone-list', '', list);
    link(view, 'City public view protection', 'https://vancouver.ca/home-property-development/protecting-vancouvers-views.aspx');
    paragraph(view, 'Current policy and measurement rules:');
    link(view, 'Public Views Guidelines', 'https://guidelines.vancouver.ca/guidelines-public-views.pdf'); element('span', '', ' · ', view);
    link(view, 'Building Height Technical Design Supplement', 'https://guidelines.vancouver.ca/bulletins/bulletin-building-height.pdf');
    const zoning = details(panel, 'Zoning & density', 'imagine-city-zoning-details');
    paragraph(zoning, 'Height references use the most restrictive sourced basic schedule height touching the mapped building footprint. Unknown or site-specific rules are kept visible. Floor area and permitted use can constrain a proposal before height does.');
    check(zoning, 'imagine-city-assumptions', 'Use an assumption where a height reference is missing', S.useAssumptions, () => {S.useAssumptions = $('imagine-city-assumptions').checked; calculate();});
    const missingForm = element('form', 'imagine-city-baseline-form', '', zoning, 'imagine-city-form');
    numeric(missingForm, 'imagine-city-missing-height', 'Assumed building height (m above model ground)', S.missingHeightM, 0, 2000);
    button(missingForm, 'imagine-city-baseline-apply', 'Update height assumption', () => {}); $('imagine-city-baseline-apply').type = 'submit';
    missingForm.addEventListener('submit', e => {e.preventDefault(); const raw = $('imagine-city-missing-height').value.trim(), value = Number(raw); if (!raw || !validHeight(value, 0)) return inputError('Enter an assumed height from 0 to 2,000 m.'); S.missingHeightM = value; calculate();});
    paragraph(zoning, 'The initial 213.36 m assumption comes from a 700 ft skyline benchmark in the Higher Buildings Policy. It does not make that height available on every lot. Turn the assumption off to retain existing heights where no basic reference is resolved.');
    link(zoning, 'Higher Buildings Policy', 'https://guidelines.vancouver.ca/policy-higher-buildings-for-rezonings.pdf');
    paragraph(zoning, 'Height references do not include a full floor-area or permitted-use test.');
    link(zoning, 'Zoning and land-use document library', 'https://vancouver.ca/home-property-development/zoning-and-land-use-policies-document-library.aspx');
    const massing = details(panel, 'Massing & setbacks', 'imagine-city-massing-details');
    paragraph(massing, 'Height alone does not establish a buildable scheme. Setbacks, tower separation, floor plate, solar access, heritage and site-specific design requirements also shape a high-rise.');
    paragraph(massing, 'This comparison changes building height on the existing footprint. It does not solve those additional requirements or remove legally existing buildings.');
    link(massing, 'Downtown solar access guidelines', 'https://guidelines.vancouver.ca/guidelines-solar-access-downtown.pdf');
    paragraph(massing, 'Review the applicable use and area before choosing a separation or floor-plate target.');
    link(massing, 'City-wide Design and Development Guidelines', 'https://guidelines.vancouver.ca/guidelines-city-wide-design-development.pdf');
    const code = details(panel, 'Building code', 'imagine-city-code-details');
    paragraph(code, 'The Vancouver Building By-law regulates construction, fire safety, access and other technical requirements. A zoning height is not a building-code approval. These technical checks are not simulated.');
    link(code, 'Vancouver Building By-law', 'https://vancouver.ca/your-government/vancouver-building-bylaw.aspx');
    const selected = element('section', '', '', panel, 'imagine-city-selection'); element('h3', '', 'Inspect a building', selected);
    paragraph(selected, 'Hover over a building to see its height. Click for the controlling corridor and zoning references.', 'imagine-city-selection-help'); element('div', 'imagine-city-selection', '', selected);
    const actions = element('div', '', '', panel, 'imagine-city-footer'); button(actions, 'imagine-city-sources', 'Read methods & sources', () => root.VistaSources?.open?.());
    button(actions, 'imagine-city-export', 'Export building results (CSV)', exportCSV).disabled = true;
    const exportStatus = paragraph(actions, '', 'imagine-city-export-status'); exportStatus.setAttribute('role','status'); exportStatus.setAttribute('aria-live','polite');
    paragraph(panel, 'Project data loads once while this page is open. Results stay in temporary memory; export CSV to keep them.', 'imagine-city-memory');
    const launch = $('btn-imagine'); if (launch) {launch.removeAttribute('aria-haspopup'); launch.setAttribute('aria-controls', 'imagine-city-panel'); launch.setAttribute('aria-expanded', 'false');}
    return true;
  }
  function validHeight(value, min) { return Number.isFinite(value) && value >= min && value <= 2000; }
  function inputError(message) {S.error = message; update();}
  function format(value) { return Number.isFinite(value) ? root.VistaUnits?.formatLength?.(value, X()?.state?.displayUnits) || value.toFixed(1) + ' m' : 'Unresolved'; }
  function update() {
    if (!panel) return;
    panel.hidden = !S.open; panel.setAttribute('aria-busy', String(S.loading || S.calculating));
    for (const id of ['existing','zoning','views']) $('imagine-city-' + id).setAttribute('aria-pressed', String(S.scenario === id));
    $('imagine-city-loading').hidden = !S.loading && !S.calculating;
    $('imagine-city-error').hidden = !S.error; $('imagine-city-error').textContent = S.error;
    $('imagine-city-retry').hidden = !S.error;
    $('imagine-city-retry').textContent = S.data ? 'Retry calculation' : 'Retry loading';
    $('imagine-city-export').disabled = !S.result || S.loading || S.calculating || S.exporting;
    $('imagine-city-scenario-note').textContent = S.scenario === 'existing' ? 'Original model heights; view surfaces remain available for comparison.' : S.scenario === 'zoning' ? 'Sourced basic heights, with clearly labelled assumptions for unresolved records.' : 'Height references clipped below all available study view surfaces.';
    for (const id of ['imagine-city-existing','imagine-city-zoning','imagine-city-views','imagine-city-surface-apply','imagine-city-baseline-apply']) $(id).disabled = S.loading || S.calculating;
    if (!S.result) $('imagine-city-results').textContent = '';
    else {const stats = S.result.stats || {}; const count = Number(stats.buildingCount ?? Object.values(S.data.assets).reduce((n,a) => n + a.count,0)); const changed = stats.changedBuildings; $('imagine-city-results').textContent = count.toLocaleString() + ' buildings on this model' + (Number.isFinite(changed) ? ' · ' + changed.toLocaleString() + ' height changes' : '') + (stats.assumedHeightBuildings ? ' · ' + stats.assumedHeightBuildings.toLocaleString() + ' assumed baselines' : '') + (stats.missingSurfaceBuildings ? ' · ' + stats.missingSurfaceBuildings.toLocaleString() + ' incomplete view checks' : '') + '. Click a building for its calculation.';}
    selection();
  }
  function progress(message) { if ($('imagine-city-progress')) $('imagine-city-progress').textContent = message; }
  function stable(value) {
    if (typeof value === 'number' && !Number.isFinite(value)) return String(value);
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]));
    return value;
  }
  function cachedCalculation(engine, planes) {
    if (cacheDataset !== S.data || cacheEngine !== engine) {results.clear();cacheDataset=S.data;cacheEngine=engine;}
    const options = {planes,scenario:S.scenario,missingHeightM:S.missingHeightM,useAssumptions:S.useAssumptions};
    const key = JSON.stringify(stable(options));
    if (results.has(key)) {const result=results.get(key);results.delete(key);results.set(key,result);S.cacheHits++;return result;}
    const result=engine.calculate(S.data,options);
    if (result?.assets) {results.set(key,result);while(results.size>6)results.delete(results.keys().next().value);}
    return result;
  }
  async function load() {
    if (!S.open || S.loading) return;
    if (S.data) return calculate();
    const generation = ++S.generation; S.loading = true; S.error = ''; update(); progress('Loading the model’s prepared height references…');
    controller = root.AbortController ? new root.AbortController() : null;
    timeout = root.setTimeout?.(() => controller?.abort(), 30000);
    try {
      if (!root.ProjectAPI?.fetch) throw new Error('The project data loader is not ready.');
      const response = await root.ProjectAPI.fetch('/generated/imagine_city.json', {cache:'no-store', signal:controller?.signal});
      if (!response.ok) throw new Error('Height references could not load (HTTP ' + response.status + ').');
      const length = Number(response.headers?.get?.('content-length')) || null; if (length > LIMIT_BYTES) throw new Error('The prepared height dataset exceeds the display budget.');
      let data;
      if (response.body?.getReader) {
        const reader = response.body.getReader(), chunks = []; let received = 0;
        while (true) { const step = await reader.read(); if (step.done) break; received += step.value.byteLength; if (received > LIMIT_BYTES) {await reader.cancel(); throw new Error('The prepared height dataset exceeds the display budget.');} chunks.push(step.value); if (!S.open || generation !== S.generation) {await reader.cancel(); return;} progress('Loading height references · ' + (received / 1048576).toFixed(1) + (length ? ' / ' + (length / 1048576).toFixed(1) : '') + ' MB'); }
        const bytes = new Uint8Array(received); let offset = 0; for (const chunk of chunks) {bytes.set(chunk, offset); offset += chunk.byteLength;} data = JSON.parse(new TextDecoder().decode(bytes));
      } else data = await response.json();
      if (!S.open || generation !== S.generation) return;
      if (data?.schema !== 'vista-imagine-city/1' || !data.assets || !Array.isArray(data.coneIds)) throw new Error('The prepared height references use an unsupported format.');
      S.data = data; S.loading = false; root.clearTimeout?.(timeout); timeout = null; controller = null; return calculate();
    } catch (error) {
      if (!S.open || generation !== S.generation) return;
      S.loading = false; S.error = error?.name === 'AbortError' ? 'Loading took too long. Retry when the connection is ready.' : error.message || 'Height references could not load. Retry loading.';
      update();
    } finally {if (generation === S.generation) {root.clearTimeout?.(timeout); timeout = null; controller = null;}}
  }
  async function calculate() {
    if (!S.open || !S.data) return;
    root.VistaImagineHover?.clear();
    const generation = ++S.generation; S.loading = false; S.calculating = true; S.error = ''; update(); progress('Calculating building heights beneath every study view surface…');
    await new Promise(resolve => root.setTimeout ? root.setTimeout(resolve, 0) : resolve());
    if (!S.open || generation !== S.generation) return;
    try {
      if (X()?.ready) {progress('Waiting for the main site model…'); await X().ready; if (!S.open || generation !== S.generation) return;}
      const provider = root.VistaViewcone?.getCitySurfaces?.({heightM:S.studyHeightM, reference:[0,0]}) || X()?.getImagineCitySurfaceInputs?.({heightM:S.studyHeightM, reference:[0,0]});
      if (!provider?.planes?.length) throw new Error('The model’s view surfaces are not ready. Return to your study and try Imagine again.');
      if (!root.ImagineCityEngine?.calculate) throw new Error('The building-height engine is not ready. Reload the page and try again.');
      const result = cachedCalculation(root.ImagineCityEngine,provider.planes);
      if (!result?.assets) throw new Error('The building-height calculation did not return a valid scene.');
      S.result = result; S.provider = provider;
      const list = $('imagine-city-cone-list'); list.replaceChildren();
      for (const plane of provider.planes) {const item = element('li', '', String(plane.id) + ' · ' + (plane.assumed ? 'Study surface' : 'Supplied surface, unverified'), list); if (typeof plane.source === 'string' && /^https:\/\//.test(plane.source)) {element('span', '', ' · ', item); link(item, 'source', plane.source);}}
      publish();
    } catch (error) {S.result = null; X()?.setImagineCityScene?.(null); S.error = error.message || 'This height comparison could not finish.';}
    finally {if (generation === S.generation) {S.calculating = false; update();}}
  }
  function publish() {
    if (!S.open || !S.result) return false;
    const success = X()?.setImagineCityScene?.({...S.result, dataset:S.data, overlay:S.provider?.scene, showCones:S.showCones, versionId:++version});
    if (success === false) {S.error = 'The city could not be drawn. Return to your study and try again.'; update(); return false;}
    return true;
  }
  function toggleCones(value) {
    S.showCones=typeof value==='boolean'?value:!S.showCones;
    const input=$('imagine-city-cones');if(input)input.checked=S.showCones;
    if(S.open){publish();update();}
    return S.showCones;
  }
  function setScenario(value) { if (!['existing','zoning','views'].includes(value)) return false; S.scenario = value; calculate(); return true; }
  function open() {
    if (S.open || !mount()) return;
    const host = $('panel'); original = {collapsed:host.classList.contains('collapsed'), scrollTop:host.scrollTop, focus:doc.activeElement};
    S.open = true; doc.body.classList.add('imagine-city-open'); host.classList.remove('collapsed'); host.scrollTop = 0;
    $('btn-imagine')?.setAttribute('aria-expanded', 'true'); $('btn-panel-toggle')?.setAttribute('aria-expanded', 'true');
    update(); $('imagine-city-title').focus({preventScroll:true});
    // Scene changes never alter the proposal, address, display style or camera.
    load(); doc.dispatchEvent?.(new root.Event('vista-imagine-city-opened'));
  }
  function close() {
    if (!S.open) return;
    root.VistaImagineHover?.clear();
    S.open = false; ++S.generation; ++exportVersion; controller?.abort(); controller = null; root.clearTimeout?.(timeout); timeout = null; S.loading = false; S.calculating = false; S.exporting = false; $('imagine-city-export-status').textContent='';
    doc.body.classList.remove('imagine-city-open'); X()?.setImagineCityScene?.(null); panel.hidden = true;
    const host = $('panel'); if (host && original) {host.classList.toggle('collapsed', original.collapsed); host.scrollTop = original.scrollTop; $('btn-panel-toggle')?.setAttribute('aria-expanded', String(!original.collapsed));}
    $('btn-imagine')?.setAttribute('aria-expanded', 'false');
    const focus = original?.focus?.isConnected ? original.focus : $('btn-imagine'); focus?.focus?.({preventScroll:true});
    doc.dispatchEvent?.(new root.Event('vista-imagine-city-closed'));
  }
  function selectBuilding(value) {if (!S.open || !S.data || !S.result) return false; S.selected = value && typeof value.asset === 'string' && Number.isInteger(value.index ?? value.row) ? {asset:value.asset,row:value.index ?? value.row} : null; selection(); return true;}
  function getHoverBuilding(value) {
    if (!S.open || S.loading || S.calculating || !S.data || !S.result || !value || typeof value.asset !== 'string' || !Number.isSafeInteger(value.index)) return null;
    return root.ImagineCityEngine?.getBuilding?.(S.data,S.result,value.asset,value.index) || null;
  }
  function selection() {
    const host = $('imagine-city-selection'); if (!host) return;
    host.replaceChildren(); $('imagine-city-selection-help').hidden = !!S.selected;
    if (!S.selected || !S.result) return;
    const value = root.ImagineCityEngine?.getBuilding?.(S.data,S.result,S.selected.asset,S.selected.row);
    if (!value) {S.selected = null; $('imagine-city-selection-help').hidden = false; return;}
    element('h4','', 'Building ' + (value.osmId || (value.row + 1)),host);
    const dl = element('dl','','',host);
    for (const [label,text] of [['Existing height',format(value.existingHeightM)],['Basic height reference',format(value.zoningHeightM)],['Scenario height',format(value.targetHeightM)],['Controlling view',value.controllingView || 'No controlling surface'],['Mapped corridors',(value.assemblyViewIds || value.viewIds || []).join(', ') || 'None'],['Ceiling (model Z)',format(value.ceilingModelZ)],['Vertical clearance',format(value.clearanceM)]]) {element('dt','',label,dl);element('dd','',text,dl);}
    if (value.assemblySize > 1) paragraph(host, value.assemblySize + ' connected parts scale together. Combined building height: ' + format(value.assemblyHeightM) + ' → ' + format(value.targetAssemblyHeightM) + '.');
    if (value.assumedBaseline) paragraph(host,'The baseline height is assumed because no complete basic zoning reference is resolved.');
    if (value.missingSurface) paragraph(host,'At least one mapped corridor has no usable surface. The result is incomplete.');
    if (value.surfaceStatus) paragraph(host,value.surfaceStatus + '.');
    if (typeof value.controllingSurface?.source === 'string' && /^https:\/\//.test(value.controllingSurface.source)) link(host,'Controlling surface source',value.controllingSurface.source);
    paragraph(host, 'Study result. Footprint and model ground are approximate; this is not a property-specific height assessment.');
    if (value.rules?.length) {const sources = details(host,'Zoning references for this footprint');for (let i = 0; i < value.rules.length; i++) {const rule = value.rules[i], text = [value.ruleIds?.[i],rule.section,rule.basicHeightM != null ? format(rule.basicHeightM) : ''].filter(Boolean).join(' · '); paragraph(sources,text || 'Basic zoning source'); if (rule.note) paragraph(sources,String(rule.note)); const url = rule.url || rule.sourceUrl; if (typeof url === 'string' && /^https:\/\//.test(url)) link(sources,'Official schedule',url);}}
  }
  async function exportCSV() {
    if (!S.open || !S.data || !S.result || S.exporting) return;
    const data=S.data, result=S.result, scenario=S.scenario, generation=S.generation, token=++exportVersion;
    S.exporting=true; update(); $('imagine-city-export-status').textContent='Preparing building results…';
    const escape = value => '"' + String(value ?? '').replace(/"/g,'""') + '"';
    const rows = [['asset','row','osm_id','existing_height_m','zoning_reference_m','scenario_height_m','controlling_view','mapped_views','assumed_baseline','assumed_surface','missing_surface','certainty']];
    let processed=0;
    const cancelled=()=>{const stale=!S.open||generation!==S.generation||token!==exportVersion;if(stale&&S.open&&token===exportVersion)$('imagine-city-export-status').textContent='Export cancelled because the scenario changed. Export again to use the current result.';return stale;};
    try {
      for (const [asset,source] of Object.entries(data.assets)) for (let row=0;row<source.count;row++) {
        if (cancelled()) return;
        const b=root.ImagineCityEngine.getBuilding(data,result,asset,row);
        if (b) rows.push([asset,row,b.osmId,b.existingHeightM,b.zoningHeightM,b.targetHeightM,b.controllingView,(b.assemblyViewIds || b.viewIds || []).join(';'),b.assumedBaseline,b.assumedSurface,b.missingSurface,'Study']);
        if (++processed%2000===0) {$('imagine-city-export-status').textContent='Preparing results · '+processed.toLocaleString()+' buildings';await new Promise(resolve=>root.setTimeout(resolve,0));}
      }
      if (cancelled()) return;
      const blob = new root.Blob([rows.map(row=>row.map(escape).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}), url = root.URL.createObjectURL(blob), a = element('a'); a.href = url; a.download = 'vista-imagine-' + scenario + '.csv'; a.click(); root.setTimeout(() => root.URL.revokeObjectURL(url),1000);
      $('imagine-city-export-status').textContent='Exported '+(rows.length-1).toLocaleString()+' building results.';
    } catch(error) {if(token===exportVersion)$('imagine-city-export-status').textContent='The CSV could not be prepared. Try exporting again.';}
    finally {if(token===exportVersion){S.exporting=false;if(S.open)update();}}
  }
  function refresh() {root.VistaImagineHover?.clear();if (S.open) update();}
  function bind() {const b = $('btn-imagine'); if (!b || b.dataset.imagineCityBound) return; b.dataset.imagineCityBound = 'true'; b.addEventListener('click',() => S.open ? close() : open()); if (new root.URLSearchParams(root.location?.search || '').get('imagine') === '1') open();}
  doc.addEventListener('keydown',e=>{if (e.key !== 'Escape' || !S.open || !panel.contains(doc.activeElement) || e.defaultPrevented) return; e.preventDefault();e.stopPropagation();close();},true);
  root.VistaImagineCity = {open,close,refresh,selectBuilding,getHoverBuilding,setScenario,toggleCones,getState:()=>({open:S.open,loading:S.loading,calculating:S.calculating,exporting:S.exporting,loaded:!!S.data,error:S.error,scenario:S.scenario,showCones:S.showCones,studyHeightM:S.studyHeightM,missingHeightM:S.missingHeightM,useAssumptions:S.useAssumptions,selected:S.selected,stats:S.result?.stats || null,cacheEntries:results.size,cacheHits:S.cacheHits})};
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded',bind,{once:true}); else bind();
})(typeof window !== 'undefined' ? window : globalThis);
