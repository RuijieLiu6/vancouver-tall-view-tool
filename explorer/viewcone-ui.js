/* Viewcone is a display overlay. It never changes a proposal or invents policy inputs. */
(function (root) {
  'use strict';
  const doc = root.document, X = () => root.__explorer;
  if (!doc) return;
  const $ = id => doc.getElementById(id), empty = new Float32Array(0);
  let enabled = false, mounted = false, chosenId = '', lastGlobalId, studyHeight = 120;
  let cacheKey = '', cached = null, cachedImport = null, cachedCones = null, cachedRaw = null;
  let cachedContextRefs = [], contextKey = '', contextRefs = [], contextFootprints = null;
  let observerGroundKey = '', observerGroundRefs = [], observerGround = null;
  let uiKey = '', optionCones = null;
  const number = value => Number.isFinite(value) ? value.toFixed(1).replace(/\.0$/, '') : '—';
  const id = cone => String(cone?.view_number ?? '');
  const cones = () => X()?.assets.cones?.available ? X().assets.cones.cones : [];
  const pointIn = (point, polygon) => {
    if (!point || !Array.isArray(polygon)) return false;
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const a = polygon[j], b = polygon[i];
      if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    return inside;
  };
  function chooseCone() {
    const all = cones(), x = X(), globalId = String(x.state.viewpoint || '');
    if (globalId !== lastGlobalId) {
      if (globalId) chosenId = globalId;
      lastGlobalId = globalId;
    }
    let cone = all.find(c => id(c) === chosenId);
    if (cone) return cone;
    const parts = x.proposalParts();
    cone = all.find(c => parts.some(p => {
      try { return root.ProposalGeometry.planOverlap(c.polygon_model_xy, x.partFootprint(p)).relation !== 'none'; }
      catch (_) { return false; }
    })) || all.find(c => pointIn(x.state.site && [x.state.site.x, x.state.site.y], c.polygon_model_xy));
    if (!cone && !x.state.site) {
      const target = x.state.mode === 'inspect' ? x.proposalCentre?.() || x.state.cams.overview.target : x.state.cams.overview.target;
      cone = all.find(c => pointIn(target, c.polygon_model_xy));
    }
    cone ||= all[0];
    if (cone) chosenId = id(cone);
    return cone || null;
  }
  function planeInput(cone, study, options = {}) {
    const height = Number.isFinite(options.heightM) ? options.heightM : studyHeight;
    const p = study.planes?.[id(cone)], declared = study.envelopeInputs?.coordinateSystem;
    const aligned = Number.isFinite(study.datumOffsetM) && !!study.datumName?.trim() &&
      (!declared || declared.compatible === true && declared.verticalDatum?.trim() === study.datumName.trim());
    if (p && aligned && Array.isArray(p.origin) && p.origin.length === 2 &&
      [...p.origin, p.observerElevationM, p.bearingDeg, p.pitchDeg].every(Number.isFinite) && Math.abs(p.pitchDeg) < 89) {
      const slope = Math.tan(p.pitchDeg * Math.PI / 180), a = Math.sin(p.bearingDeg * Math.PI / 180) * slope, b = Math.cos(p.bearingDeg * Math.PI / 180) * slope;
      return {plane:{a, b, c:p.observerElevationM - study.datumOffsetM - a * p.origin[0] - b * p.origin[1]},
        assumed:false, source:p.source || 'Entered study surface', datum:study.datumName, unaligned:false};
    }
    const x = X(), origin = cone.origin_model_xy, polygon = cone.polygon_model_xy;
    if (Array.isArray(origin) && origin.length === 2 && origin.every(Number.isFinite)) {
      // The City's observer_elevation field is deliberately not used: its
      // datum is not aligned to the terrain in this model.
      const refs = ['terrain', 'ext_terrain', 'water', 'ext_water'].map(key => x.assets.raw?.[key]);
      const key = origin.join(',');
      if (key !== observerGroundKey || !sameReferences(observerGroundRefs, refs)) {
        observerGround = typeof x.groundZAt === 'function' ? x.groundZAt(...origin)?.z : null;
        observerGroundKey = key; observerGroundRefs = refs;
      }
      if (Number.isFinite(observerGround)) {
        const eye = observerGround + (Number.isFinite(x.state.eyeH) ? x.state.eyeH : 1.6);
        let reference = options.city ? (options.reference || [0,0]) : x.state.site && pointIn([x.state.site.x, x.state.site.y], polygon) ? [x.state.site.x, x.state.site.y] : null;
        let referenceName = options.city ? 'downtown reference' : 'site';
        if (!reference || Math.hypot(reference[0] - origin[0], reference[1] - origin[1]) < 1) {
          const distances = polygon.map(q => Math.hypot(q[0] - origin[0], q[1] - origin[1]));
          const distant = polygon.filter((q, i) => distances[i] >= Math.max(...distances) * 0.75);
          if (distant.length) reference = [distant.reduce((sum, q) => sum + q[0], 0) / distant.length, distant.reduce((sum, q) => sum + q[1], 0) / distant.length];
          referenceName = 'distant edge';
        }
        if (reference) {
          const dx = reference[0] - origin[0], dy = reference[1] - origin[1], distance2 = dx * dx + dy * dy;
          if (distance2 >= 1) {
            const a = (height - eye) * dx / distance2, b = (height - eye) * dy / distance2;
            return {plane:{a, b, c:eye - a * origin[0] - b * origin[1]}, assumed:true, unaligned:!!p,
              source:`Invented study surface: ${number(height)} m model Z at the ${referenceName}, connected to the modelled observer eye (${number(eye)} m model Z). Terrain and eye elevation are approximate; this is not City height geometry`,
              datum:'Vista model Z', referenceName, referencePoint:reference, observerPoint:[...origin, eye]};
          }
        }
      }
    }
    return {plane:{a:0, b:0, c:height}, assumed:true, source:'Adjustable flat study ceiling: modelled observer elevation is unavailable. Not City height geometry', datum:'Vista model Z', unaligned:!!p, referenceName:'flat surface'};
  }
  let citySurfaceKey='',citySurfaceCache=null;
  function getCitySurfaces(options={}) {
    const x=X();if(!x?.assets.ready)return {planes:[],scene:null};
    const heightM=Number.isFinite(options.heightM)?options.heightM:120,reference=options.reference||[0,0];
    if(heightM < -500 || heightM > 2000 || !Array.isArray(reference)||reference.length!==2||!reference.every(Number.isFinite))throw new Error('Invalid city study reference');
    const study=x.getConeStudy(),key=JSON.stringify([heightM,reference,study.planes,study.datumOffsetM,study.datumName,study.envelopeInputs?.coordinateSystem]);
    if(citySurfaceCache&&key===citySurfaceKey)return citySurfaceCache;
    const planes=[],surface=[],walls=[],edges=[],issues=[];
    for(const cone of cones()) {
      const input=planeInput(cone,study,{heightM,reference,city:true});
      const prepared=root.ViewconeGeometry.prepareSurface({polygon:cone.polygon_model_xy,plane:input.plane,renderMinModelZ:-100,renderMaxModelZ:Math.max(320,heightM+100)});
      if(prepared.status!=='ready'){issues.push(id(cone));continue;}
      planes.push({id:id(cone),name:cone.name,plane:input.plane,polygon:cone.polygon_model_xy,source:input.source,assumed:input.assumed,datum:input.datum});
      for(const [target,array] of [[surface,prepared.surfacePositions],[walls,prepared.curtainPositions],[edges,prepared.edgePositions]])if(array)for(const value of array)target.push(value);
    }
    citySurfaceKey=key;citySurfaceCache={planes,issues,reference,heightM,scene:{enabled:true,kind:'imagine-city',surface:new Float32Array(surface),walls:new Float32Array(walls),edges:new Float32Array(edges),intrusion:empty,footprints:empty,baseFootprints:empty,footprintConnectors:empty}};
    return citySurfaceCache;
  }
  function join(a, b) {
    if (!a?.length) return b || empty;
    if (!b?.length) return a;
    const out = new Float32Array(a.length + b.length); out.set(a); out.set(b, a.length); return out;
  }
  // Lightweight Build inputs: no layer activation or context-mesh extraction.
  function getHeightContext(options = {}) {
    const x=X(), scope=options.scope === 'site' ? 'site' : 'selected';
    const base={ready:!!x?.assets.ready,pmode:x?.state.pmode,scope,sourceRevision:'vista-model-xy:v31;view-height:v1'};
    if(!base.ready || !x.state.site)return {...base,ready:false,parts:[],planes:[],affectingViews:[],missingViews:[]};
    const box=x.proposalBox(), parts=x.state.pmode === 'boxes' ? x.proposalParts() : [];
    const affecting=cones().filter(c=>parts.some(p=>{
      try{return root.ProposalGeometry.planOverlap(c.polygon_model_xy,p.footprint).relation!=='none';}catch(_){return false;}
    }));
    const study=x.getConeStudy(), selected=chooseCone(), chosen=scope==='selected'?selected:
      affecting.find(c=>id(c)===id(selected)) || affecting[0];
    const used=[], supplied=[];
    for(const cone of affecting){
      if(!study.planes?.[id(cone)])continue;
      const value=planeInput(cone,study);
      if(!value.assumed)supplied.push({cone,value});
    }
    const add=(cone,value)=>used.push({id:id(cone),polygon:cone.polygon_model_xy,plane:value.plane,source:value.source,
      basis:value.assumed?'assumption':study.planes?.[id(cone)]?.basis || 'entered-unverified',datum:value.datum,assumed:value.assumed});
    if(scope==='site')for(const record of supplied)add(record.cone,record.value);
    if(chosen && !used.some(p=>p.id===id(chosen)))add(chosen,planeInput(chosen,study));
    const covered=new Set(used.map(p=>p.id));
    return {...base,location:{x:x.state.site.x,y:x.state.site.y},baseModelZ:box?.base,parts,
      planes:used,selectedView:id(chosen),affectingViews:affecting.map(id),
      missingViews:affecting.filter(c=>!covered.has(id(c))).map(id),assumed:used.some(p=>p.assumed),
      // Entered survey/source inputs stay in session memory. Only the public
      // boundary illustration may be saved in local project data files.
      persistAllowed:!study.envelopeInputs && used.every(p=>p.assumed)};
  }
  const sameReferences = (a, b) => a.length === b.length && a.every((value, i) => value === b[i]);
  function existingFootprints(x, cone) {
    const sources = [
      {mesh:x.assets.raw?.buildings, catalogue:x.assets.index, ext:false},
      {mesh:x.assets.raw?.ext_buildings, catalogue:x.assets.extIndex, ext:true},
    ].filter(source => source.mesh && source.catalogue);
    const refs = sources.flatMap(source => [source.mesh, source.mesh.pos, source.mesh.idx, source.catalogue, source.catalogue.columns]);
    const key = JSON.stringify([id(cone), cone.polygon_model_xy, x.state.showExisting, x.state.removed, x.state.cleared]);
    if (contextFootprints && contextKey === key && sameReferences(contextRefs, refs)) return contextFootprints;
    contextKey = key; contextRefs = refs;
    const merged = {positions:empty, selectedCount:0, candidateCount:0, processedBuildings:0, processedTriangles:0, skippedCount:0, truncated:false, issues:[]};
    if (!root.ViewconeGeometry.existingFootprintEdges) return merged;
    for (const source of sources) {
      const remainingTriangles = 200000 - merged.processedTriangles, remainingBuildings = 2000 - merged.processedBuildings;
      if (remainingTriangles <= 0 || remainingBuildings <= 0) {merged.truncated = true; break;}
      const omitRows = x.state.showExisting ? new Set() : new Set([...(x.state.removed || []), ...(x.state.cleared || [])]
        .filter(row => !!row.ext === source.ext).map(row => row.index));
      const result = root.ViewconeGeometry.existingFootprintEdges({mesh:source.mesh, catalogue:source.catalogue,
        polygon:cone.polygon_model_xy, maxTriangles:remainingTriangles, maxBuildings:remainingBuildings, zOffset:0.2, baseToleranceM:0.05, omitRows});
      merged.positions = join(merged.positions, result.positions);
      for (const field of ['selectedCount', 'candidateCount', 'processedBuildings', 'processedTriangles', 'skippedCount']) merged[field] += result[field] || 0;
      merged.truncated ||= !!result.truncated;
      merged.issues.push(...(result.issues || []));
    }
    contextFootprints = merged; return merged;
  }
  function projectFootprints(positions, plane) {
    const projected = new Float32Array(positions.length), connectors = [], seen = new Set();
    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i], y = positions[i + 1], baseZ = positions[i + 2], z = plane.a * x + plane.b * y + plane.c + 0.25;
      projected.set([x, y, z], i);
      // A few vertical links locate the elevated outlines without filling the city with lines.
      const key = Math.round(x * 100) + ',' + Math.round(y * 100);
      if (seen.size < 80 && !seen.has(key)) {seen.add(key); connectors.push(x, y, baseZ, x, y, z);}
    }
    return {positions:projected, connectors:new Float32Array(connectors)};
  }
  function geometryParts(x) {
    if (!x.proposalShown()) return {parts:[], note:'Choose a build method to compare your proposal.'};
    if (x.state.pmode !== 'import') return {parts:x.proposalParts().map(p => ({...p, solid:true})), solid:true};
    const im = x.state.imported, off = x.importOffset(), raw = im?.parcelFootprint?.parts;
    if (!im) return {parts:[], note:'Import a model to compare its geometry.'};
    if (!off || !raw) return {parts:[], note:'The imported analysis mesh is unavailable; no bounding box is coloured.'};
    let count = 0;
    for (const p of raw) {
      count += (p.indices || p.idx)?.length / 3 || (p.positions || p.pos)?.length / 9 || 0;
      if (count > 25000) return {parts:[], note:'Large mesh: red analysis supports up to 25,000 triangles. Import a smaller analysis model.'};
    }
    return {parts:raw.map(p => ({...p, offset:off, solid:false})), solid:false};
  }
  function getScene() {
    if (!enabled || !X()?.assets.ready || !root.ViewconeGeometry) return null;
    const x = X(), cone = chooseCone();
    if (!cone) return {enabled:true, surface:empty, walls:empty, edges:empty, intrusion:empty, footprints:empty, fitPoints:[], status:'Mapped view corridors are unavailable. Reload the site to try again.', certainty:'Study'};
    const study = x.getConeStudy(), input = planeInput(cone, study);
    const key = JSON.stringify([id(cone), input, x.state.site, x.state.parts, x.state.pmode, x.state.imported?.placement,
      x.state.pmode === 'import' ? x.importOffset() : null, x.proposalShown(), x.state.boundary, x.state.removed, x.state.cleared, x.state.showExisting]);
    const importedRaw = x.state.imported?.parcelFootprint;
    const context = [x.assets.raw?.buildings, x.assets.raw?.ext_buildings, x.assets.index, x.assets.extIndex];
    if (cached && key === cacheKey && cachedImport === x.state.imported && cachedCones === x.assets.cones && cachedRaw === importedRaw && sameReferences(cachedContextRefs, context)) return cached;
    cacheKey = key; cachedImport = x.state.imported; cachedCones = x.assets.cones; cachedRaw = importedRaw; cachedContextRefs = context;
    const options = {polygon:cone.polygon_model_xy, plane:input.plane, datumOffsetM:0, coordinateCompatible:true};
    const box = x.proposalBox(), upper = Math.min(600, Math.max(320, (box?.top || 0) + 60, input.assumed ? studyHeight + 100 : 320));
    const shape = root.ViewconeGeometry.prepareSurface({...options, renderMinModelZ:-100, renderMaxModelZ:upper, topZ:upper});
    const proposal = geometryParts(x);
    const result = proposal.parts.length ? root.ViewconeGeometry.clipProposal({...options, parts:proposal.parts, solid:proposal.solid, maxTriangles:25000, maxWork:500000}) : null;
    // Imported part footprints are bounding rectangles in the core API. Keep
    // those out of this display; only their actual triangle faces are checked.
    const footprints = x.proposalShown() && x.state.pmode !== 'import' ? x.proposalParts().map(p => x.partFootprint(p)) : [];
    const footprint = root.ViewconeGeometry.footprintMesh({...options, footprints, z:(box?.base ?? 0) + 0.18, maxWork:100000});
    const existing = existingFootprints(x, cone), projected = projectFootprints(existing.positions, input.plane);
    let status = proposal.note || (!box ? 'Place a site and build a proposal to see its intersection.' : 'The proposal is outside this mapped corridor in plan.');
    if (result && result.completed) {
      if (result.maxPenetrationM > 0.0001) status = `${number(result.maxPenetrationM)} m above this ${input.assumed ? 'study ceiling' : 'supplied surface'}. Red shows the intersecting ${proposal.solid ? 'volume' : 'mesh faces'}.`;
      else if (result.minClearanceM !== null && Number.isFinite(result.minClearanceM)) status = `${number(Math.max(0, result.minClearanceM))} m minimum vertical clearance below this ${input.assumed ? 'study ceiling' : 'supplied surface'}.`;
    } else if (result && !result.completed) status = 'Red analysis is incomplete. Use a smaller proposal or a simpler analysis mesh.';
    if (shape.issues?.length) status = 'The view surface could not be drawn completely. ' + status;
    cached = {enabled:true, cone, surface:shape.surfacePositions || empty, walls:shape.curtainPositions || empty,
      edges:shape.edgePositions || empty, intrusion:join(result?.intrusionPositions, result?.capPositions),
      footprints:join(projected.positions, footprint.edges), footprintFill:footprint.positions || empty,
      baseFootprints:existing.positions, footprintConnectors:projected.connectors, existingFootprintInfo:existing,
      fitPoints:shape.fitPoints || [], plane:input.plane, planeInput:input, proposalResult:result,
      status, certainty:input.assumed ? 'Study' : 'Supplied surface · unverified', assumed:input.assumed};
    return cached;
  }
  function mount() {
    if (mounted || !$('mode-viewcone') || !$('viewcone-panel')) return;
    mounted = true;
    const panel = $('viewcone-panel');
    panel.innerHTML = '<details class="viewcone-controls"><summary id="viewcone-summary">Viewcone · Study</summary><div class="viewcone-body">' +
      '<label class="viewcone-field" for="viewcone-select">Corridor<select id="viewcone-select"></select></label>' +
      '<label class="viewcone-field" id="viewcone-height-field" for="viewcone-height"><span id="viewcone-height-label">Study ceiling (model Z, m)</span><input id="viewcone-height" type="number" min="-50" max="500" step="5" value="120" aria-describedby="viewcone-note"></label>' +
      '<div class="viewcone-legend"><span><i class="viewcone-key-blue" aria-hidden="true"></i>Protected-view study</span><span><i class="viewcone-key-red" aria-hidden="true"></i>Above ceiling</span></div>' +
      '<p class="viewcone-status" id="viewcone-status" role="status"></p><p class="viewcone-note" id="viewcone-note"></p>' +
      '<div class="viewcone-actions"><button id="viewcone-fit" class="btn" type="button">Fit cone</button><button id="viewcone-close" class="btn" type="button">Hide cone</button></div>' +
      '<details class="viewcone-method"><summary>Surface &amp; source</summary><p id="viewcone-source" class="viewcone-note"></p><p id="viewcone-coverage" class="viewcone-note"></p><p class="viewcone-note">Blue sides follow the public corridor boundary. Blue outlines project actual model base edges onto the study surface. The top edge is a display cut-off, not a regulatory upper limit. Red checks only the selected corridor, not all building controls.</p><button id="viewcone-sources" class="btn" type="button">Open Sources</button></details>' +
      '</div></details>';
    panel.querySelector('details').open = !root.matchMedia?.('(max-width: 650px)').matches;
    $('mode-viewcone').setAttribute('aria-controls', 'viewcone-panel');
    $('mode-viewcone').addEventListener('click', () => {
      if(doc.body.classList.contains('imagine-city-open')){root.VistaImagineCity?.toggleCones();return;}
      toggle();
    });
    $('viewcone-select').addEventListener('change', event => {chosenId = event.target.value; invalidate(); refresh(); X().renderOnce();});
    $('viewcone-height').addEventListener('change', event => {
      const value = Number(event.target.value);
      if (event.target.value.trim() === '' || !Number.isFinite(value) || value < -50 || value > 500) { event.target.value = studyHeight; return; }
      studyHeight = value; invalidate(); refresh(); X().renderOnce();
    });
    $('viewcone-fit').addEventListener('click', fit);
    $('viewcone-close').addEventListener('click', () => {toggle(false); $('mode-viewcone').focus();});
    $('viewcone-sources').addEventListener('click', () => {const source = $('btn-sources'); if (source?.getAttribute('aria-expanded') !== 'true') source?.click();});
    panel.addEventListener('keydown', event => {
      if (/^Arrow(Up|Down|Left|Right)$/.test(event.key) || /^[ijkl]$/i.test(event.key) || event.key === 'Enter') event.stopPropagation();
      if (event.key === 'Escape') {event.stopPropagation(); toggle(false); $('mode-viewcone').focus();}
    });
    panel.hidden = true; panel.classList.add('hidden');
    $('mode-viewcone').setAttribute('aria-pressed', 'false');
  }
  function invalidate() { cacheKey = ''; uiKey = ''; }
  function refresh() {
    mount(); if (!mounted) return;
    if(doc.body.classList.contains('imagine-city-open')){
      const on=!!root.VistaImagineCity?.getState().showCones;
      $('viewcone-panel').hidden=true;$('viewcone-panel').classList.add('hidden');
      $('mode-viewcone').classList.toggle('active',on);$('mode-viewcone').setAttribute('aria-pressed',String(on));return;
    }
    const panel = $('viewcone-panel'); panel.hidden = !enabled; panel.classList.toggle('hidden', !enabled);
    $('mode-viewcone').classList.toggle('active', enabled); $('mode-viewcone').setAttribute('aria-pressed', String(enabled));
    if (!enabled) {root.VistaHeightSuggestion?.refresh();return;}
    if (optionCones !== X()?.assets.cones) {
      const select = $('viewcone-select'); select.replaceChildren();
      for (const c of cones()) {const option = doc.createElement('option'); option.value = id(c); option.textContent = `${id(c)} · ${c.name || 'Protected viewpoint'}`; select.appendChild(option);}
      optionCones = X()?.assets.cones;
    }
    const scene = getScene();
    if (!scene) {$('viewcone-status').textContent = 'Loading the mapped corridors…'; return;}
    const nextUiKey = JSON.stringify([cacheKey, scene.status, scene.certainty]); if (nextUiKey === uiKey) {root.VistaHeightSuggestion?.refresh();return;} uiKey = nextUiKey;
    $('viewcone-select').value = id(scene.cone);
    $('viewcone-summary').textContent = `Viewcone · ${scene.certainty}`;
    $('viewcone-status').textContent = scene.status;
    $('viewcone-height-field').hidden = !scene.assumed;
    $('viewcone-height-label').textContent = scene.planeInput?.referenceName && scene.planeInput.referenceName !== 'flat surface' ? `Study ceiling at ${scene.planeInput.referenceName} (model Z, m)` : 'Study ceiling (model Z, m)';
    $('viewcone-note').textContent = scene.assumed ? `Illustration only: ${number(studyHeight)} m${scene.planeInput.referenceName === 'flat surface' ? '' : ' at the ' + scene.planeInput.referenceName} is an adjustable assumption, not a City height limit or sea-level elevation.` : 'Using an entered surface with a named vertical offset. Its regulatory accuracy is unverified.';
    $('viewcone-source').textContent = scene.planeInput ? `${scene.planeInput.source}. Vertical reference: ${scene.planeInput.datum}.${scene.planeInput.unaligned ? ' An entered surface exists but its datum is unaligned, so this view uses the separate study ceiling.' : ''}` : 'No mapped corridor is available.';
    const coverage = scene.existingFootprintInfo;
    $('viewcone-coverage').textContent = coverage ? `${coverage.selectedCount.toLocaleString()} model building base outlines intersect this corridor.${coverage.truncated ? ' Partial display: an interactive footprint limit was reached (up to 2,000 buildings / 200,000 triangles).' : ''}${coverage.skippedCount ? ` ${coverage.skippedCount.toLocaleString()} candidate buildings have no displayed base edges.` : ''}` : '';
    $('viewcone-fit').disabled = !scene.fitPoints?.length;
    root.VistaHeightSuggestion?.refresh();
  }
  function toggle(value) {
    mount(); enabled = typeof value === 'boolean' ? value : !enabled; invalidate(); refresh(); X()?.renderOnce(); return enabled;
  }
  function fit() {
    const scene = getScene();
    if (!scene) return false;
    const points = (scene.fitPoints || []).map(p => p.slice(0, 3));
    // The curtain's upper corners may extend well beyond the lower surface.
    for (let i = 0; i + 2 < scene.edges.length; i += 3) points.push(Array.from(scene.edges.slice(i, i + 3)));
    if (!points.length) return false;
    const xs = points.map(p => p[0]), ys = points.map(p => p[1]), zs = points.map(p => p[2]);
    const xmin = Math.min(...xs), xmax = Math.max(...xs), ymin = Math.min(...ys), ymax = Math.max(...ys), zmin = Math.min(...zs), zmax = Math.max(...zs);
    const target = [(xmin + xmax) / 2, (ymin + ymax) / 2, (zmin + zmax) / 2], az = -1.15, el = 0.65;
    const direction = [Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el)];
    const right = [-Math.sin(az), Math.cos(az), 0], up = [-Math.sin(el) * Math.cos(az), -Math.sin(el) * Math.sin(az), Math.cos(el)];
    const canvas = X().canvas, aspect = canvas?.clientWidth > 0 && canvas?.clientHeight > 0 ? canvas.clientWidth / canvas.clientHeight : 1.5;
    const tanV = Math.tan(Math.PI / 8), tanH = tanV * aspect, dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0);
    let dist = 300;
    for (const point of points) {
      const relative = point.map((value, i) => value - target[i]), along = dot(relative, direction);
      dist = Math.max(dist, along + 1.15 * Math.max(Math.abs(dot(relative, right)) / tanH, Math.abs(dot(relative, up)) / tanV), along + 25);
    }
    X().state.cams.overview = {target, dist, az, el};
    X().setMode('overview'); X().renderOnce(); return true;
  }
  root.VistaViewcone = {getScene, getHeightContext, getCitySurfaces, refresh, toggle, fit, get enabled() {return enabled;}};
  Promise.resolve(X()?.ready).then(() => {mount(); refresh(); if (new URLSearchParams(root.location.search).get('viewcone') === '1') toggle(true);});
})(typeof window !== 'undefined' ? window : globalThis);
