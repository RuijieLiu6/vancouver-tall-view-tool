/* Imagine operates on the live model. Its controls and derived results stay in page memory. */
(function (root) {
  'use strict';
  const doc = root.document;
  if (!doc) return;
  const $ = id => doc.getElementById(id), X = () => root.__explorer;
  const S = {open:false, loading:false, calculating:false, exporting:false, data:null, result:null, error:'', scenario:'views', showCones:true, useAssumptions:true, missingHeightM:213.36, minimumHeightM:5, studyHeightM:120, selected:null, generation:0, cacheHits:0};
  let panel = null, original = null, controller = null, timeout = null, version = 0;
  let viewpointMarkers = null, viewpointNavigation = null;
  const markerButtons = new Map();
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
  function viewpointName(parent, view) {
    parent.replaceChildren();
    element('strong', '', view.name || 'Protected viewpoint', parent, 'imagine-view-location');
    element('small', '', 'View ' + view.id, parent, 'imagine-view-number');
  }
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
    paragraph(header, 'How do protected views change a possible Vancouver skyline? Compare the same height references with and without study view limits.');
    button(header, 'imagine-city-close', 'Return to Vista', close);
    const scenarios = element('fieldset', '', '', panel, 'imagine-city-scenarios'); element('legend', '', 'Compare view protection', scenarios);
    const options = element('div', '', '', scenarios, 'imagine-city-options');
    for (const [id, label] of [['zoning','Without view limits'],['views','With study view limits']]) button(options, 'imagine-city-' + id, label, () => setScenario(id));
    button(scenarios,'imagine-city-existing','View Original',()=>setScenario('existing'));
    paragraph(scenarios, '', 'imagine-city-scenario-note');
    paragraph(scenarios, 'Only suitable Vancouver building assemblies touching mapped view corridors change. North Shore buildings, small or narrow main footprints, and other surroundings keep their original heights.', 'imagine-city-scope');
    const viewpoints = element('section', '', '', panel, 'imagine-city-viewpoints');
    element('h3','','View from a protected viewpoint',viewpoints);
    const pointLabel=element('label','','Choose a viewpoint',viewpoints,'imagine-city-field');pointLabel.htmlFor='imagine-city-viewpoint';
    element('select','imagine-city-viewpoint','',pointLabel).addEventListener('change',()=>enterViewpoint($('imagine-city-viewpoint').value,false));
    const pointActions=element('div','','',viewpoints,'imagine-city-viewpoint-actions');
    button(pointActions,'imagine-city-return-city','Return to City',()=>X()?.leaveImagineViewpoint?.());
    const pointStatus=paragraph(viewpoints,'Choose a viewpoint to look from it immediately.','imagine-city-viewpoint-status');pointStatus.setAttribute('role','status');pointStatus.setAttribute('aria-live','polite');
    const certainty = paragraph(panel, 'Study surfaces — unverified', 'imagine-city-certainty'); certainty.className = 'imagine-city-certainty';
    paragraph(panel, 'Blue surfaces use mapped public view corridors and an explicit height assumption. They are not City-issued height limits.', 'imagine-city-limit');
    const loading = element('div', 'imagine-city-loading', '', panel, 'imagine-city-loading'); loading.hidden = true; loading.setAttribute('role', 'status'); loading.setAttribute('aria-live', 'polite');
    element('span', '', '', loading, 'imagine-city-loading-mark'); paragraph(loading, '', 'imagine-city-progress');
    const error = paragraph(panel, '', 'imagine-city-error'); error.hidden = true; error.setAttribute('role', 'alert');
    const retry = button(panel, 'imagine-city-retry', 'Retry loading', () => load()); retry.hidden = true;
    const summary = element('section', '', '', panel, 'imagine-city-summary'); summary.setAttribute('aria-label', 'Scenario results');
    paragraph(summary, '', 'imagine-city-results');
    const conflicts=paragraph(summary,'','imagine-city-minimum-conflicts');conflicts.hidden=true;
    const methods=details(panel, 'Assumptions & methods', 'imagine-city-methods');
    paragraph(methods, 'This is a controlled massing study, not a forecast or a buildable envelope. Both comparisons use the same footprints, height references and design minimum. Only the study view limits differ.');
    paragraph(methods, 'Buildings with small or narrow main footprints stay unchanged: the design screen uses at least 300 m² of occupied footprint and a 12 m minimum width. It is not a zoning rule. The City boundary separates Vancouver from its surrounding context.', 'imagine-city-footprint-screen');
    const view = details(methods, 'View protection', 'imagine-city-view-details');
    const coneToggle=check(view, 'imagine-city-cones', 'Show all view cones in blue', S.showCones, () => toggleCones($('imagine-city-cones').checked));
    coneToggle.parentElement.children[1].id='imagine-city-cones-label';
    paragraph(view, 'In Observer, the selected corridor becomes an outline. Its sides follow the mapped corridor; the lower edge follows the study surface. The upper edge is a display guide, not an official height limit.', 'imagine-city-frame-method');
    const form = element('form', 'imagine-city-surface-form', '', view, 'imagine-city-form');
    numeric(form, 'imagine-city-study-height', 'Study ceiling at downtown reference (m model Z)', S.studyHeightM, 1, 2000);
    button(form, 'imagine-city-surface-apply', 'Update study surfaces', () => {}); $('imagine-city-surface-apply').type = 'submit';
    form.addEventListener('submit', e => { e.preventDefault(); const value = Number($('imagine-city-study-height').value); if (!validHeight(value, 1)) return inputError('Enter a study ceiling from 1 to 2,000 m.'); S.studyHeightM = value; calculate(); });
    paragraph(view, 'Each surface slopes from its modelled observer toward one fixed downtown reference at model (0, 0). The reference stays fixed when your proposal moves.');
    paragraph(view, 'Every intersecting corridor is tested across the building footprint. The lowest surface determines the view allowance, reserving 0.1 m clearance. A design minimum can exceed that allowance; those conflicts are identified. Connected building parts scale together. Geometry, heights and terrain remain approximate.');
    const list = details(view, 'Corridors and surface sources'); element('ul', 'imagine-city-cone-list', '', list);
    link(view, 'City public view protection', 'https://vancouver.ca/home-property-development/protecting-vancouvers-views.aspx');
    paragraph(view, 'Current policy and measurement rules:');
    link(view, 'Public Views Guidelines', 'https://guidelines.vancouver.ca/guidelines-public-views.pdf'); element('span', '', ' · ', view);
    link(view, 'Building Height Technical Design Supplement', 'https://guidelines.vancouver.ca/bulletins/bulletin-building-height.pdf');
    const zoning = details(methods, 'Zoning & density', 'imagine-city-zoning-details');
    paragraph(zoning, 'Height references use the most restrictive sourced basic schedule height touching the mapped building footprint. Unknown or site-specific rules are kept visible. Floor area and permitted use can constrain a proposal before height does.');
    check(zoning, 'imagine-city-assumptions', 'Use an assumption where a height reference is missing', S.useAssumptions, () => {S.useAssumptions = $('imagine-city-assumptions').checked; calculate();});
    const missingForm = element('form', 'imagine-city-baseline-form', '', zoning, 'imagine-city-form');
    numeric(missingForm, 'imagine-city-missing-height', 'Assumed building height (m above model ground)', S.missingHeightM, 0, 2000);
    button(missingForm, 'imagine-city-baseline-apply', 'Update height assumption', () => {}); $('imagine-city-baseline-apply').type = 'submit';
    missingForm.addEventListener('submit', e => {e.preventDefault(); const raw = $('imagine-city-missing-height').value.trim(), value = Number(raw); if (!raw || !validHeight(value, 0)) return inputError('Enter an assumed height from 0 to 2,000 m.'); S.missingHeightM = value; calculate();});
    paragraph(zoning, 'The initial 213.36 m assumption comes from a 700 ft skyline benchmark in the Higher Buildings Policy. It does not make that height available on every lot. Turn the assumption off to retain existing heights where no basic reference is resolved, subject to the design minimum.');
    link(zoning, 'Higher Buildings Policy', 'https://guidelines.vancouver.ca/policy-higher-buildings-for-rezonings.pdf');
    paragraph(zoning, 'Height references do not include a full floor-area or permitted-use test.');
    link(zoning, 'Zoning and land-use document library', 'https://vancouver.ca/home-property-development/zoning-and-land-use-policies-document-library.aspx');
    const massing = details(methods, 'Massing & setbacks', 'imagine-city-massing-details');
    const minimumForm=element('form','imagine-city-minimum-form','',massing,'imagine-city-form');
    numeric(minimumForm,'imagine-city-minimum-height','Minimum imagined building height (m)',S.minimumHeightM,4,6);
    button(minimumForm,'imagine-city-minimum-apply','Update minimum height',()=>{});$('imagine-city-minimum-apply').type='submit';
    minimumForm.addEventListener('submit',event=>{event.preventDefault();const value=Number($('imagine-city-minimum-height').value);if(!Number.isFinite(value)||value<4||value>6)return inputError('Choose a minimum height from 4 to 6 m.');S.minimumHeightM=value;calculate();});
    paragraph(massing,'The default 5 m minimum keeps imagined buildings visible. It is a design assumption, not a regulation. Where a view surface or zoning reference allows less, the building keeps this minimum and the conflict is reported. Existing retains the original model.');
    paragraph(massing, 'Height alone does not establish a buildable scheme. Setbacks, tower separation, floor plate, solar access, heritage and site-specific design requirements also shape a high-rise.');
    paragraph(massing, 'This comparison changes building height on the existing footprint. It does not solve those additional requirements or remove legally existing buildings.');
    link(massing, 'Downtown solar access guidelines', 'https://guidelines.vancouver.ca/guidelines-solar-access-downtown.pdf');
    paragraph(massing, 'Review the applicable use and area before choosing a separation or floor-plate target.');
    link(massing, 'City-wide Design and Development Guidelines', 'https://guidelines.vancouver.ca/guidelines-city-wide-design-development.pdf');
    const code = details(methods, 'Building code', 'imagine-city-code-details');
    paragraph(code, 'The Vancouver Building By-law regulates construction, fire safety, access and other technical requirements. A zoning height is not a building-code approval. These technical checks are not simulated.');
    link(code, 'Vancouver Building By-law', 'https://vancouver.ca/your-government/vancouver-building-bylaw.aspx');
    const selected = element('section', '', '', panel, 'imagine-city-selection'); element('h3', '', 'Inspect a building', selected);
    paragraph(selected, 'Hover over a building to see its height. Click for the controlling corridor and zoning references.', 'imagine-city-selection-help'); element('div', 'imagine-city-selection', '', selected);
    const actions = element('div', '', '', panel, 'imagine-city-footer'); button(actions, 'imagine-city-sources', 'Read methods & sources', () => root.VistaSources?.open?.());
    button(methods, 'imagine-city-export', 'Export building results (CSV)', exportCSV).disabled = true;
    const exportStatus = paragraph(methods, '', 'imagine-city-export-status'); exportStatus.setAttribute('role','status'); exportStatus.setAttribute('aria-live','polite');
    paragraph(panel, 'Project data loads once while this page is open. Results stay in temporary memory; export CSV to keep them.', 'imagine-city-memory');
    const launch = $('btn-imagine'); if (launch) {launch.removeAttribute('aria-haspopup'); launch.setAttribute('aria-controls', 'imagine-city-panel'); launch.setAttribute('aria-expanded', 'false');}
    return true;
  }
  function validHeight(value, min) { return Number.isFinite(value) && value >= min && value <= 2000; }
  function inputError(message) {S.error = message; update();}
  function format(value) { return Number.isFinite(value) ? root.VistaUnits?.formatLength?.(value, X()?.state?.displayUnits) || value.toFixed(1) + ' m' : 'Unresolved'; }
  function enterViewpoint(id,focusCanvas=true){
    if(!S.open||S.loading||S.calculating||!(X()?.listImagineViewpoints?.()||[]).some(view=>view.id===id&&view.available))return false;
    root.VistaImagineHover?.clear();
    if(!X()?.enterImagineViewpoint?.(id))return false;
    if($('imagine-city-viewpoint'))$('imagine-city-viewpoint').value=id;
    updateViewpoints();if(focusCanvas)$('gl')?.focus?.({preventScroll:true});return true;
  }
  function stepViewpoint(delta){
    const views=(X()?.listImagineViewpoints?.()||[]).filter(view=>view.available),camera=X()?.getImagineCameraState?.();
    if(!S.open||S.loading||S.calculating||camera?.mode!=='observer'||views.length<2)return false;
    const index=views.findIndex(view=>view.id===camera.selectedId);if(index<0)return false;
    return enterViewpoint(views[(index+(delta<0?-1:1)+views.length)%views.length].id,false);
  }
  function updateViewpointNavigation(views,camera){
    const host=$('viewport');if(!host)return;
    if(!viewpointNavigation){
      viewpointNavigation=element('nav','imagine-city-view-navigation','',$('viewport-hud-main')||host,'imagine-city-view-navigation');viewpointNavigation.setAttribute('aria-label','Protected viewpoints');
      for(const [id,label,delta] of [['previous','View Previous',-1],['next','View Next',1]]){
        const control=button(viewpointNavigation,'imagine-city-view-'+id,'',()=>stepViewpoint(delta));
        const icon=()=>{const span=element('span','','',control,'imagine-view-arrow');span.setAttribute('aria-hidden','true');span.innerHTML='<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="'+(delta<0?'M16 10H4m5-5-5 5 5 5':'M4 10h12m-5-5 5 5-5 5')+'"/></svg>';};
        if(delta<0)icon();element('span','',label,control);if(delta>0)icon();
      }
    }
    viewpointNavigation.hidden=!S.open||camera?.mode!=='observer';
    const available=views.filter(view=>view.available),index=available.findIndex(view=>view.id===camera?.selectedId),busy=camera?.mode!=='observer'||S.loading||S.calculating||available.length<2||index<0;
    for(const [id,delta] of [['previous',-1],['next',1]]){const control=$('imagine-city-view-'+id);control.disabled=busy;const next=!busy?available[(index+delta+available.length)%available.length]:null;control.title=next?next.name+' · View '+next.id:'';}
  }
  function updateViewpoints(){
    if(!panel)return;
    const views=X()?.listImagineViewpoints?.()||[],select=$('imagine-city-viewpoint'),key=JSON.stringify(views.map(v=>[v.id,v.name,v.available]));
    if(select.dataset.viewsKey!==key){
      const previous=select.value;select.replaceChildren();
      const placeholder=element('option','','Choose a viewpoint…',select);placeholder.value='';placeholder.disabled=true;
      for(const view of views){const option=element('option','',view.name+' · '+view.id+(view.available?'':' · ground unavailable'),select);option.value=view.id;option.disabled=!view.available;}
      select.dataset.viewsKey=key;select.value=views.find(v=>v.id===previous&&v.available)?.id||'';
    }
    const camera=X()?.getImagineCameraState?.(),atOrigin=camera?.mode==='observer';
    select.value=atOrigin&&camera.selectedId?camera.selectedId:'';
    select.disabled=!S.open||!views.some(v=>v.available)||S.loading||S.calculating;
    $('imagine-city-return-city').disabled=!atOrigin;
    const status=$('imagine-city-viewpoint-status'),chosen=views.find(v=>v.id===camera?.selectedId);
    if(atOrigin&&chosen){viewpointName(status,chosen);element('span','','Approximate modelled eye. Drag or use arrows to look; scroll to change the field of view.',status,'imagine-view-instructions');}
    else status.textContent='Choose a viewpoint to look from it immediately, or click a marker in City or Plan. Observer locations and model ground are approximate.';
    $('imagine-city-cones-label').textContent=atOrigin?'Show protected-view frame':'Show all view cones in blue';
    $('imagine-city-frame-method').hidden=!atOrigin;
    updateViewpointNavigation(views,camera);
    renderViewpointMarkers();
  }
  function renderViewpointMarkers(){
    const host=$('viewport');if(!host)return;
    if(!viewpointMarkers){viewpointMarkers=element('div','imagine-city-viewpoint-markers','',host,'imagine-city-viewpoint-markers');viewpointMarkers.setAttribute('aria-label','Protected viewpoint locations');}
    const camera=X()?.getImagineCameraState?.();
    viewpointMarkers.hidden=!S.open||S.loading||S.calculating||camera?.mode==='observer';
    for(const marker of markerButtons.values())marker.hidden=true;
    if(viewpointMarkers.hidden)return;
    const groups=new Map();
    for(const view of X()?.imagineViewpointScreenPositions?.()||[]){if(!view.available||!view.visible)continue;const key=view.groupKey||view.id;if(!groups.has(key)||view.selected)groups.set(key,view);}
    const placed=[],viewportWidth=host.clientWidth||Infinity;
    const reserved=root.ViewportLabelLayout?.reservedRects(host,host.getBoundingClientRect())||[];
    for(const [key,view] of groups){
      let marker=markerButtons.get(key);if(!marker){marker=button(viewpointMarkers,'','',()=>enterViewpoint(marker.dataset.viewId));marker.className='imagine-city-origin';markerButtons.set(key,marker);}
      const labelKey=view.id+'|'+view.name;
      if(marker.dataset.labelKey!==labelKey){viewpointName(marker,view);marker.dataset.labelKey=labelKey;}
      marker.hidden=false;
      const width=marker.offsetWidth||Math.min(210,Math.max(100,(view.name||'').length*6.7+18)),height=marker.offsetHeight||54;
      if(view.y<height+6){marker.hidden=true;continue;}
      const x=Math.max(width/2+6,Math.min(view.x,viewportWidth-width/2-6));
      const box={left:x-width/2,right:x+width/2,top:view.y-height,bottom:view.y+6};
      if(reserved.some(r=>box.left<r.right&&box.right>r.left&&box.top<r.bottom&&box.bottom>r.top)){marker.hidden=true;continue;}
      if(placed.some(p=>Math.abs(p.x-x)<(p.width+width)/2+8&&Math.abs(p.y-view.y)<Math.max(p.height,height)+8)){marker.hidden=true;continue;}
      placed.push({x,y:view.y,width,height});
      marker.dataset.viewId=view.id;marker.setAttribute('aria-label','View from '+view.name+' · '+view.id);marker.title=view.name+' · '+view.status;marker.style.left=x+'px';marker.style.top=view.y+'px';marker.style.setProperty?.('--origin-offset',(view.x-x)+'px');
    }
  }
  function update() {
    if (!panel) return;
    panel.hidden = !S.open; panel.setAttribute('aria-busy', String(S.loading || S.calculating));
    for (const id of ['existing','zoning','views']) $('imagine-city-' + id).setAttribute('aria-pressed', String(S.scenario === id));
    $('imagine-city-loading').hidden = !S.loading && !S.calculating;
    $('imagine-city-error').hidden = !S.error; $('imagine-city-error').textContent = S.error;
    $('imagine-city-retry').hidden = !S.error;
    $('imagine-city-retry').textContent = S.data ? 'Retry calculation' : 'Retry loading';
    $('imagine-city-export').disabled = !S.result || S.loading || S.calculating || S.exporting;
    $('imagine-city-scenario-note').textContent = S.scenario === 'existing' ? 'Original model heights. Choose either comparison above to resume the study.' : S.scenario === 'zoning' ? 'Before view protection: basic height references and explicit assumptions, on the eligible footprints only.' : 'After view protection: the same skyline reduced by study view surfaces. The '+format(S.minimumHeightM)+' design minimum can leave conflicts, which remain identified.';
    for (const id of ['imagine-city-existing','imagine-city-zoning','imagine-city-views','imagine-city-surface-apply','imagine-city-baseline-apply','imagine-city-minimum-apply']) $(id).disabled = S.loading || S.calculating;
    const stats=S.result?.stats||{},conflicts=$('imagine-city-minimum-conflicts');
    conflicts.hidden=!stats.minimumRaisedBuildings;
    conflicts.textContent=stats.minimumRaisedBuildings?stats.minimumRaisedBuildings.toLocaleString()+' building parts retain the design minimum. '+(stats.minimumViewConflictBuildings||0).toLocaleString()+' conflict with a study view surface; '+(stats.minimumZoningConflictBuildings||0).toLocaleString()+' exceed a basic zoning reference.':'';
    if (!S.result) $('imagine-city-results').textContent = '';
    else {const stats = S.result.stats || {},eligible=stats.eligibleBuildings;
      $('imagine-city-results').textContent=S.scenario==='existing'?'Original model skyline. All source building heights are retained.':(Number.isFinite(eligible)?eligible.toLocaleString()+' building parts in the comparison. ':'')+(S.scenario==='views'&&Number.isFinite(stats.viewReducedBuildings)?stats.viewReducedBuildings.toLocaleString()+' reduced by study view limits. ':'')+(Number.isFinite(stats.preservedContextBuildings)?stats.preservedContextBuildings.toLocaleString()+' context parts unchanged. ':'')+'Click a building to compare its heights.';
    }
    selection();
    updateViewpoints();
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
    const options = {planes,scenario:S.scenario,missingHeightM:S.missingHeightM,useAssumptions:S.useAssumptions,minimumHeightM:S.minimumHeightM,focusMappedCorridors:true};
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
      const views=X()?.listImagineViewpoints?.()||[];
      for (const plane of provider.planes) {const item = element('li', '', '', list),record=views.find(v=>v.id===String(plane.id));viewpointName(item,{id:plane.id,name:record?.name||'Protected corridor'});element('span','',plane.assumed ? 'Study surface' : 'Supplied surface, unverified',item); if (typeof plane.source === 'string' && /^https:\/\//.test(plane.source)) {element('span', '', ' · ', item); link(item, 'source', plane.source);}}
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
    $('btn-imagine')?.setAttribute('aria-expanded', 'true');$('btn-imagine')?.setAttribute('aria-pressed','true');$('btn-vista')?.setAttribute('aria-pressed','false'); $('btn-panel-toggle')?.setAttribute('aria-expanded', 'true');
    update(); $('imagine-city-title').focus({preventScroll:true});
    // Scene changes never alter the proposal, address, display style or camera.
    load(); doc.dispatchEvent?.(new root.Event('vista-imagine-city-opened'));
  }
  function close() {
    if (!S.open) return;
    root.VistaImagineHover?.clear();
    S.open = false; ++S.generation; ++exportVersion; controller?.abort(); controller = null; root.clearTimeout?.(timeout); timeout = null; S.loading = false; S.calculating = false; S.exporting = false; $('imagine-city-export-status').textContent='';
    doc.body.classList.remove('imagine-city-open'); X()?.setImagineCityScene?.(null); panel.hidden = true;if(viewpointMarkers)viewpointMarkers.hidden=true;if(viewpointNavigation)viewpointNavigation.hidden=true;
    const host = $('panel'); if (host && original) {host.classList.toggle('collapsed', original.collapsed); host.scrollTop = original.scrollTop; $('btn-panel-toggle')?.setAttribute('aria-expanded', String(!original.collapsed));}
    $('btn-imagine')?.setAttribute('aria-expanded', 'false');$('btn-imagine')?.setAttribute('aria-pressed','false');$('btn-vista')?.setAttribute('aria-pressed','true');
    const focus = $('btn-vista') || (original?.focus?.isConnected ? original.focus : $('btn-imagine')); focus?.focus?.({preventScroll:true});
    doc.dispatchEvent?.(new root.Event('vista-imagine-city-closed'));
  }
  function selectBuilding(value) {if (!S.open || !S.data || !S.result) return false; S.selected = value && typeof value.asset === 'string' && Number.isInteger(value.index ?? value.row) ? {asset:value.asset,row:value.index ?? value.row} : null; selection(); return true;}
  function getHoverBuilding(value) {
    if (!S.open || S.loading || S.calculating || !S.data || !S.result || !value || typeof value.asset !== 'string' || !Number.isSafeInteger(value.index)) return null;
    return root.ImagineCityEngine?.getBuilding?.(S.data,S.result,value.asset,value.index) || null;
  }
  function describeHeightControl(value){
    if(!value)return 'Height source unresolved';
    const control=value.heightControl,kind=control?.kind;
    if(kind==='context-preserved')return 'Original height · '+({ 'outside-vancouver':'surrounding municipality','boundary-context':'boundary context','unknown-geography':'location unresolved','outside-mapped-corridors':'outside view corridors','small-footprint':'small or narrow footprint'}[value.preservationReason]||'comparison context');
    if(kind==='design-minimum')return format(value.minimumHeightM||S.minimumHeightM)+' design minimum · not a regulation';
    if(kind==='view'||!control&&value.controllingView)return 'View protection · '+(control?.viewId||value.controllingView)+(value.controllingSurface?.assumed?' · study surface':' · unverified surface');
    if(kind==='zoning'){
      const rules=control.rules||[],numeric=rules.filter(r=>Number.isFinite(r.basicHeightM)),lowest=Math.min(...numeric.map(r=>r.basicHeightM));
      const names=(numeric.length?numeric.filter(r=>r.basicHeightM===lowest):rules).map(r=>[r.id,r.section?'§ '+r.section:''].filter(Boolean).join(' '));
      return 'Zoning · '+(names.join('; ')||control.ruleIds?.join(', ')||'basic height reference');
    }
    if(kind==='fallback-assumption'||!control&&value.assumedBaseline)return 'Missing-height assumption · not a zoning limit';
    return kind==='existing'?'Existing model height':'Height source unresolved';
  }
  function selection() {
    const host = $('imagine-city-selection'); if (!host) return;
    host.replaceChildren(); $('imagine-city-selection-help').hidden = !!S.selected;
    if (!S.selected || !S.result) return;
    const value = root.ImagineCityEngine?.getBuilding?.(S.data,S.result,S.selected.asset,S.selected.row);
    if (!value) {S.selected = null; $('imagine-city-selection-help').hidden = false; return;}
    element('h4','', 'Building ' + (value.osmId || (value.row + 1)),host);
    const dl = element('dl','','',host);
    const compare=value.assemblySize>1?value.comparisonAssemblyHeightM:value.comparisonHeightM,reduction=value.assemblySize>1?value.viewAssemblyReductionM:value.viewReductionM,total=value.assemblySize>1?value.targetAssemblyHeightM:value.targetHeightM;
    const rows=value.contextPreserved?[['Original height',format(value.assemblySize>1?value.assemblyHeightM:value.existingHeightM)],['Displayed height',format(total)],['Why unchanged',describeHeightControl(value)]]:[['Existing height',format(value.assemblySize>1?value.assemblyHeightM:value.existingHeightM)],['Without view limits',format(compare)],['Displayed height',format(total)],['View reduction',format(reduction)],['Height set by',describeHeightControl(value)],['Lowest view corridor',value.viewAllowanceController?.viewId||value.controllingView||'None'],['Ceiling (model Z)',format(value.ceilingModelZ)],['Vertical clearance',format(value.clearanceM)]];
    for (const [label,text] of rows) {element('dt','',label,dl);element('dd','',text,dl);}
    if(value.contextPreserved){paragraph(host,'Kept at its original model height in both comparisons. No height reference or design minimum is applied.');return;}
    paragraph(host,'Mapped corridors: '+((value.assemblyViewIds||value.viewIds||[]).join(', ')||'None')+'.');
    if (value.assemblySize > 1) paragraph(host, value.assemblySize + ' connected parts scale together. Combined building height: ' + format(value.assemblyHeightM) + ' → ' + format(value.targetAssemblyHeightM) + '.');
    if(value.minimumApplied)paragraph(host,'The '+format(value.minimumHeightM||S.minimumHeightM)+' design minimum applies to the whole connected building.');
    if(value.minimumConflictsView||value.minimumConflictsZoning){const warning=paragraph(host,'Minimum-height conflict: '+[value.minimumConflictsView?'the design minimum conflicts with the allowance for study view '+value.viewAllowanceController?.viewId:'',value.minimumConflictsZoning?'the design minimum exceeds a basic zoning reference':''].filter(Boolean).join('; ')+'. This scenario does not satisfy those limits.');warning.className='imagine-city-conflict';}
    if (value.assumedBaseline) paragraph(host,'The baseline height is assumed because no complete basic zoning reference is resolved.');
    if (value.missingSurface) paragraph(host,'At least one mapped corridor has no usable surface. The result is incomplete.');
    if (value.surfaceStatus) paragraph(host,value.surfaceStatus + '.');
    if (typeof value.controllingSurface?.source === 'string' && /^https:\/\//.test(value.controllingSurface.source)) link(host,'Lowest view surface source',value.controllingSurface.source);
    if(value.heightControl?.kind==='zoning')for(const rule of value.heightControl.rules||[]){const url=rule.sourceUrl||rule.url;if(typeof url==='string'&&/^https:\/\//.test(url))link(host,'Height reference source · '+rule.id,url);}
    paragraph(host, 'Study result. Footprint and model ground are approximate; this is not a property-specific height assessment.');
    if (value.rules?.length) {const sources = details(host,'Zoning references for this footprint');for (let i = 0; i < value.rules.length; i++) {const rule = value.rules[i], text = [value.ruleIds?.[i],rule.section,rule.basicHeightM != null ? format(rule.basicHeightM) : ''].filter(Boolean).join(' · '); paragraph(sources,text || 'Basic zoning source'); if (rule.note) paragraph(sources,String(rule.note)); const url = rule.url || rule.sourceUrl; if (typeof url === 'string' && /^https:\/\//.test(url)) link(sources,'Official schedule',url);}}
  }
  async function exportCSV() {
    if (!S.open || !S.data || !S.result || S.exporting) return;
    const data=S.data, result=S.result, scenario=S.scenario, generation=S.generation, token=++exportVersion;
    S.exporting=true; update(); $('imagine-city-export-status').textContent='Preparing building results…';
    const escape = value => '"' + String(value ?? '').replace(/"/g,'""') + '"';
    const rows = [['asset','row','osm_id','existing_height_m','zoning_reference_m','scenario_height_m','controlling_view','mapped_views','assumed_baseline','assumed_surface','missing_surface','certainty','height_control','height_control_kind','lowest_view_corridor','minimum_height_m','minimum_applied','minimum_conflicts_view','minimum_conflicts_zoning','without_view_limits_height_m','view_reduction_m','geographic_scope','context_preserved','preservation_reason','footprint_area_m2','footprint_min_width_m']];
    let processed=0;
    const cancelled=()=>{const stale=!S.open||generation!==S.generation||token!==exportVersion;if(stale&&S.open&&token===exportVersion)$('imagine-city-export-status').textContent='Export cancelled because the scenario changed. Export again to use the current result.';return stale;};
    try {
      for (const [asset,source] of Object.entries(data.assets)) for (let row=0;row<source.count;row++) {
        if (cancelled()) return;
        const b=root.ImagineCityEngine.getBuilding(data,result,asset,row);
        if (b) rows.push([asset,row,b.osmId,b.existingHeightM,b.zoningHeightM,b.targetHeightM,b.controllingView,(b.assemblyViewIds || b.viewIds || []).join(';'),b.assumedBaseline,b.assumedSurface,b.missingSurface,'Study',describeHeightControl(b),b.heightControl?.kind,b.viewAllowanceController?.viewId,b.minimumHeightM,b.minimumApplied,b.minimumConflictsView,b.minimumConflictsZoning,b.comparisonHeightM,b.viewReductionM,b.geographicScope,b.contextPreserved,b.preservationReason,b.footprintAreaM2,b.footprintMinWidthM]);
        if (++processed%2000===0) {$('imagine-city-export-status').textContent='Preparing results · '+processed.toLocaleString()+' buildings';await new Promise(resolve=>root.setTimeout(resolve,0));}
      }
      if (cancelled()) return;
      const blob = new root.Blob([rows.map(row=>row.map(escape).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}), url = root.URL.createObjectURL(blob), a = element('a'); a.href = url; a.download = 'vista-imagine-' + scenario + '.csv'; a.click(); root.setTimeout(() => root.URL.revokeObjectURL(url),1000);
      $('imagine-city-export-status').textContent='Exported '+(rows.length-1).toLocaleString()+' building results.';
    } catch(error) {if(token===exportVersion)$('imagine-city-export-status').textContent='The CSV could not be prepared. Try exporting again.';}
    finally {if(token===exportVersion){S.exporting=false;if(S.open)update();}}
  }
  function refresh() {root.VistaImagineHover?.clear();if (S.open) update();}
  function bind() {const b = $('btn-imagine'); if (!b || b.dataset.imagineCityBound) return; b.dataset.imagineCityBound = 'true';b.setAttribute('aria-pressed','false');$('btn-vista')?.setAttribute('aria-pressed','true');b.addEventListener('click',open);$('btn-vista')?.addEventListener('click',()=>{close();X()?.homeVista?.();});if (new root.URLSearchParams(root.location?.search || '').get('imagine') === '1') open();}
  doc.addEventListener('vista-imagine-viewpoint-changed',updateViewpoints);
  doc.addEventListener('vista-imagine-camera-rendered',renderViewpointMarkers);
  doc.addEventListener('keydown',e=>{if (e.key !== 'Escape' || !S.open || !panel.contains(doc.activeElement) || e.defaultPrevented) return; e.preventDefault();e.stopPropagation();close();},true);
  root.VistaImagineCity = {open,close,refresh,selectBuilding,getHoverBuilding,describeHeightControl,enterViewpoint,stepViewpoint,setScenario,toggleCones,getState:()=>({open:S.open,loading:S.loading,calculating:S.calculating,exporting:S.exporting,loaded:!!S.data,error:S.error,scenario:S.scenario,showCones:S.showCones,studyHeightM:S.studyHeightM,missingHeightM:S.missingHeightM,minimumHeightM:S.minimumHeightM,useAssumptions:S.useAssumptions,selected:S.selected,stats:S.result?.stats || null,cacheEntries:results.size,cacheHits:S.cacheHits})};
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded',bind,{once:true}); else bind();
})(typeof window !== 'undefined' ? window : globalThis);
