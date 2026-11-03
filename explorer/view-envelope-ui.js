/* Full-site upper envelopes; public corridor boundaries never supply a ceiling. */
(function (root) {
  'use strict';
  const $ = id => document.getElementById(id), X = () => root.__explorer;
  let cached = null, cacheKey = '', comparison = null, comparisonModel = null, comparisonKey = '', mounted = false;
  const finite = Number.isFinite;
  const length = v => finite(v) ? root.VistaUnits?.formatLength(v, X().state.displayUnits) || v.toFixed(2) + ' m' : 'Unavailable';
  function input() {
    const x = X(), study = x.getConeStudy(), evidence = study.envelopeInputs || {}, p = x.proposalBox();
    let polygons = evidence.polygons, footprints, scope;
    if (polygons?.length) scope = 'Loaded parcel boundary, including holes and islands';
    else if (x.state.boundary.length >= 3) { polygons = [[x.state.boundary]]; scope = 'Whole drawn study boundary; parcel status unverified'; }
    else if (x.state.pmode === 'import' && x.state.imported?.parcelMatch?.polygons?.length) {
      polygons = x.state.imported.parcelMatch.polygons; scope = 'Matched cadastral snapshot; survey alignment unverified';
    } else { footprints = p ? x.proposalParts().map(x.partFootprint) : []; scope = p ? (x.state.pmode === 'import' ? 'Imported part bounding footprints; load a parcel boundary for a site envelope' : 'Union of rotated proposal footprints; no parcel boundary loaded') : 'A full boundary is required; a point cannot define an envelope'; }
    let declared = evidence.coordinateSystem;
    if(declared && study.datumName.trim() !== declared.verticalDatum?.trim()) declared={...declared,compatible:false};
    // Legacy manual values are explicitly model-space study inputs. This
    // permits their illustration, but is never passed as regulatory evidence.
    const coordinateSystem = declared || {horizontal:'Vista model XY', units:'m', verticalDatum:study.datumName, compatible:!!study.datumName && finite(study.datumOffsetM)};
    return {polygons, footprints, cones:x.assets.cones?.available ? x.assets.cones.cones : null, planes:study.planes,
      datumOffsetM:study.datumOffsetM, coordinateSystem, groundModelZ:p?.base ?? null,
      maxWork:400000, maxPatches:3000, scope, evidence, declared, study};
  }
  function getResult() {
    const i = input(), key = JSON.stringify(i);
    if (key !== cacheKey) {
      const points=(i.polygons||[]).flat(2).concat((i.footprints||[]).flat());
      const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);
      const oversized=(i.footprints?.length||0)>128 || points.length>2048 || points.length && (Math.max(...xs)-Math.min(...xs)>1000 || Math.max(...ys)-Math.min(...ys)>1000);
      cached = root.ViewEnvelope.build(oversized?{}:i); cacheKey = key;
      if(oversized)cached.issues=['Interactive envelope limit: use at most 128 footprints within a 1 km span, or load a smaller parcel boundary.'];
      cached.certainty = root.ViewCertainty.classify({envelope:cached, planes:i.planes, coordinateSystem:i.declared,
        boundarySource:i.evidence.boundarySource, surveySource:i.evidence.surveySource, assessment:i.evidence.assessment,georeference:i.evidence.georeference});
      cached.scope = i.scope; cached.inputKey = key;
      comparison = null; comparisonKey = ''; comparisonModel = null;
    }
    return cached;
  }
  function modelKey() { return JSON.stringify([X().state.site, X().state.parts, X().state.pmode, X().state.imported?.placement]); }
  function currentComparison() {
    return comparisonKey === cacheKey && comparisonModel === X().state.imported && comparison?.modelKey === modelKey() ? comparison : null;
  }
  function checkProposal() {
    const r = getResult(), x = X(); let parts;
    if (x.state.pmode === 'import') {
      const off = x.importOffset(), raw = x.state.imported?.parcelFootprint?.parts;
      if (!off || !raw) return {status:'unavailable',completed:false,issues:['Actual imported mesh data is unavailable; no bounding-box substitution was made.']};
      parts = raw.map((p,j) => ({...p, name:x.state.imported.parts[j]?.name || 'Imported part', offset:off}));
    } else parts = x.proposalParts().map(p => ({name:p.name, positions:p.pos, indices:p.idx}));
    comparison = root.ViewEnvelope.intersectProposal(r,{parts,maxTriangles:25000,maxCandidates:100000,maxWork:500000});
    comparison.modelKey = modelKey(); comparisonKey = cacheKey; comparisonModel = x.state.imported;
    refresh(); x.renderOnce(); return comparison;
  }
  function importInputs(raw) {
    if(raw && ['Feature','FeatureCollection','Polygon','MultiPolygon'].includes(raw.type)){
      const geometries=raw.type==='FeatureCollection'?raw.features?.map(f=>f.geometry):[raw.type==='Feature'?raw.geometry:raw];
      if(!Array.isArray(geometries)||!geometries.length||geometries.some(g=>!g||!['Polygon','MultiPolygon'].includes(g.type)))throw new Error('Use polygon-only parcel GeoJSON; point and line features cannot establish the parcel boundary.');
      const name=raw.crs?.properties?.name;
      const inputCrs=name?root.VistaGeoreference.normalizeCrs(name):'EPSG:4326';
      const study=X().getConeStudy();
      raw={schema:'vista-view-envelope-input/1',polygons:geometries.flatMap(g=>g.type==='Polygon'?[g.coordinates]:g.coordinates),
        planes:Object.fromEntries(Object.entries(study.planes).map(([id,p])=>[id,{...p,inputCrs:'VISTA:MODEL'}])),
        datumName:study.datumName,datumOffsetM:study.datumOffsetM,
        coordinateSystem:{inputCrs,horizontal:inputCrs,units:inputCrs==='EPSG:4326'?'degrees':'m',verticalDatum:study.datumName,compatible:!!study.datumName&&finite(study.datumOffsetM),surveyCompatible:false},
        boundarySource:{source:'Locally imported parcel GeoJSON',reference:'Unverified file boundary; no survey status inferred',date:''}};
    }
    if (!raw || raw.schema !== 'vista-view-envelope-input/1') throw new Error('Use a Vista envelope input JSON file; download the template below.');
    raw = root.VistaGeoreference.transformEnvelopeInputs(raw);
    if (!Array.isArray(raw.polygons) || !raw.polygons.length) throw new Error('Provide a full parcel boundary in polygons, already transformed to Vista model XY metres.');
    let vertices = 0;
    for (const polygon of raw.polygons) {
      if (!Array.isArray(polygon) || !polygon.length) throw new Error('Each polygon needs an outer ring and optional hole rings.');
      for (const ring of polygon) {
        if (!Array.isArray(ring) || ring.length < 3) throw new Error('Each ring needs at least three XY coordinates.');
        for (const p of ring) if (!Array.isArray(p) || p.length !== 2 || !p.every(v => typeof v === 'number' && finite(v) && Math.abs(v) <= 50000)) throw new Error('Boundary coordinates must be finite Vista model XY metres.');
        vertices += ring.length;
      }
    }
    if (vertices > 1024) throw new Error('This interactive envelope supports up to 1,024 boundary vertices. Use a smaller survey extract.');
    const pts=raw.polygons.flat(2), xs=pts.map(p=>p[0]), ys=pts.map(p=>p[1]);
    if (Math.max(...xs)-Math.min(...xs)>1000 || Math.max(...ys)-Math.min(...ys)>1000) throw new Error('Use a parcel extract within a 1 km span. Citywide assumptions remain in Imagine.');
    const check = root.ViewEnvelope.build({polygons:raw.polygons, cones:X().assets.cones.cones, planes:raw.planes || {}, datumOffsetM:raw.datumOffsetM, coordinateSystem:raw.coordinateSystem,maxWork:400000,maxPatches:3000});
    if (!finite(check.coverage.parcelAreaM2) || check.issues.includes('invalid_parcel_geometry')) throw new Error('The parcel boundary could not be clipped. Check self-intersections, hole placement and coordinate alignment.');
    X().restoreConeStudy({...raw,envelopeInputs:raw});
    X().refreshPanels(); X().renderOnce();
    return getResult();
  }
  function exportPayload() {
    const i = input(), r = getResult();
    return {schema:'vista-view-envelope/1', createdAt:new Date().toISOString(), scope:r.scope,
      certainty:r.certainty, envelope:r, proposalCheck:currentComparison(),
      inputs:{schema:'vista-view-envelope-input/1',polygons:i.polygons || (i.footprints||[]).map(p=>[p]),...i.evidence,planes:i.planes,datumOffsetM:i.datumOffsetM,datumName:i.study.datumName},
      limitations:['Upper view surface only; no zoning/setback/FSR envelope is implied.','Outside mapped corridors remains unbounded by this layer; missing surfaces remain unresolved.','Above-ground scalar summaries use the proposal base, not an approved grade surface.','No City-issued assessment has been independently checked by Vista.']};
  }
  function exportOBJ() {
    const r=getResult(), p=r.mesh.positions, out=['# Vista supplied view-envelope upper surface','# '+r.certainty.label+'; City assessment not verified','# Coordinates: Vista model metres, Z up; see accompanying JSON for datum and coverage'];
    for(let i=0;i<p.length;i+=3)out.push('v '+p.slice(i,i+3).join(' '));
    for(let i=0;i<p.length/3;i+=3)out.push('f '+[i+1,i+2,i+3].join(' '));
    return out.join('\n')+'\n';
  }
  function download(name,content,type) {
    const url=URL.createObjectURL(new Blob([content],{type})), a=document.createElement('a'); a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function mount() {
    if(mounted)return; mounted=true;
    const target=document.createElement('div');target.id='view-envelope-panel';
    target.innerHTML='<p id="view-envelope-certainty" class="envelope-certainty" role="status"></p><p id="view-envelope-summary" class="small"></p>'+
      '<dl class="ceiling-values"><div><dt>Controlling corridor</dt><dd id="view-envelope-control">Unavailable</dd></div><div><dt>Control point (model X, Y)</dt><dd id="view-envelope-point">Unavailable</dd></div></dl>'+
      '<div class="actions"><button id="view-envelope-check" class="btn" type="button">Check proposal geometry</button><button id="view-envelope-obj" class="btn" type="button">Download 3D surface</button><button id="view-envelope-json" class="btn" type="button">Download calculation</button></div><p id="view-envelope-comparison" class="small" role="status">Run a geometry check to locate the proposal’s least vertical clearance.</p>'+
      '<details class="details"><summary>Sources &amp; certainty</summary><p class="small"><b>Preliminary:</b> a documented reconstruction with a full parcel boundary, survey references and compatible coordinates. <b>Verified:</b> checked against a matching City-issued property assessment. Vista currently records assessments for review; it cannot grant Verified status.</p>'+
      '<p class="small">Assumed flat observer ceilings remain Study. They are separate from both certainty levels.</p><ul id="view-envelope-missing" class="small"></ul>'+
      '<label class="field">Load envelope inputs or a parcel boundary (JSON / GeoJSON)<input id="view-envelope-file" type="file" accept=".json,.geojson,application/json,application/geo+json"></label>'+
      '<p class="small muted">Local file only, up to 1 MB. Declare inputCrs as VISTA:MODEL, EPSG:4326, EPSG:3857 or EPSG:26910 to align XY automatically. Projected/geographic planes need three XYZ reference points. Z and vertical datums are not converted; a survey reference does not establish legal grade.</p>'+
      '<div class="actions"><button id="view-envelope-template" class="btn" type="button">Download input template</button><button id="view-envelope-clear" class="btn" type="button">Clear entered geometry</button></div>'+
      '<p id="view-envelope-input-status" class="small" role="status"></p>'+
      '<p class="small"><a href="https://vancouver.ca/home-property-development/protecting-public-views.aspx" target="_blank" rel="noopener">City public view assessments</a> · <a href="https://guidelines.vancouver.ca/bulletins/bulletin-building-height.pdf" target="_blank" rel="noopener">Building Height Technical Design Supplement</a></p></details>';
    $('cone-ceiling-status').insertAdjacentElement('afterend',target);
    $('view-envelope-check').addEventListener('click',()=>{ $('view-envelope-check').disabled=true;$('view-envelope-comparison').textContent='Clipping proposal triangles against the upper surface…';setTimeout(()=>{try{checkProposal();}catch(e){$('view-envelope-comparison').textContent=e.message;}finally{$('view-envelope-check').disabled=false;}},0);});
    $('view-envelope-obj').addEventListener('click',()=>download('Vista-view-envelope-upper-surface.obj',exportOBJ(),'text/plain'));
    $('view-envelope-json').addEventListener('click',()=>download('Vista-view-envelope-calculation.json',JSON.stringify(exportPayload(),null,2),'application/json'));
    $('view-envelope-clear').addEventListener('click',()=>{X().restoreConeStudy({});X().refreshPanels();X().renderOnce();});
    $('view-envelope-template').addEventListener('click',()=>download('Vista-view-envelope-input-template.json',JSON.stringify({schema:'vista-view-envelope-input/1',polygons:[],planes:{'VIEW_ID':{origin:[null,null],observerElevationM:null,bearingDeg:null,pitchDeg:null,basis:'reconstructed',source:'',reference:'',date:''}},datumOffsetM:null,datumName:'',coordinateSystem:{inputCrs:'VISTA:MODEL',horizontal:'Vista model XY',units:'m',verticalDatum:'',compatible:false,transformation:''},boundarySource:{source:'',reference:'',date:''},surveySource:{source:'',reference:'',date:''},instructions:'Supply documented lower-boundary geometry, not the observer elevation alone. Declare coordinateSystem.inputCrs to convert geographic/projected XY. Supply three XYZ referencePoints for each non-model plane. Z remains unchanged. Dates use YYYY-MM-DD. This empty template contains no regulatory heights.'},null,2),'application/json'));
    $('view-envelope-file').addEventListener('change',async e=>{const file=e.target.files[0];if(!file)return;try{if(file.size>1000000)throw new Error('Use a survey extract smaller than 1 MB.');importInputs(JSON.parse(await file.text()));$('view-envelope-input-status').textContent='Inputs loaded locally. Review coverage, references and certainty above.';}catch(error){$('view-envelope-input-status').textContent=error.message;}finally{e.target.value='';}});
  }
  function refresh() {
    mount();const r=getResult(), c=r.certainty, comp=currentComparison(), p=comp?.controlPoint || r.limitingPoint;
    $('view-envelope-certainty').textContent=c.stage==='preliminary'?'Preliminary reconstructed envelope · City assessment needed':'Study envelope · regulatory geometry unverified';
    const area=r.coverage, displayArea=v=>finite(v)?Math.round(v).toLocaleString()+' m²':'unavailable';
    $('view-envelope-summary').textContent=r.scope+'. '+(finite(area.parcelAreaM2)?`${displayArea(area.ceilingAreaM2)} with supplied ceilings; ${displayArea(area.unresolvedAreaM2)} unresolved; ${displayArea(area.outsideAreaM2)} outside loaded corridors. `:'')+(r.issues.length?'Calculation limits: '+r.issues.join(', ')+'. ':'')+'This is an upper constraint surface; zoning and other controls can further reduce it.';
    $('view-envelope-control').textContent=p?.view || 'Unavailable';
    const xy=p?.xy || (p&&finite(p.x)?[p.x,p.y]:null);
    $('view-envelope-point').textContent=xy?xy.map(v=>v.toFixed(2)).join(', ')+' m':'Unavailable';
    if(xy){const ll=root.VistaGeoreference.modelToLonLat(...xy);$('view-envelope-point').textContent+=` · ${ll.lat.toFixed(6)}°, ${ll.lon.toFixed(6)}° (approx.)`;}
    $('view-envelope-obj').disabled=!r.mesh.positions.length;
    $('view-envelope-check').disabled=!r.coordinateCompatible||!(r.patches.length||r.contactPatches?.length)||!X().proposalBox();
    $('view-envelope-comparison').textContent=comp ? (finite(comp.minClearanceM)?`${comp.completed&&comp.exact?'Triangle geometry check':'Partial check'}: ${comp.minClearanceM<0?length(-comp.minClearanceM)+' above the supplied envelope':length(comp.minClearanceM)+' minimum vertical clearance'}. View ${comp.controllingView}. ${comp.status==='partial'?'Incomplete coverage; this is not a whole-proposal result.':''}`:`Check unavailable (${comp.status}). ${(comp.issues||[]).join(' ')}`) : 'Run a geometry check to locate the proposal’s least vertical clearance. Up to 25,000 triangles are checked; larger models need a smaller analysis mesh.';
    const list=$('view-envelope-missing');list.replaceChildren();
    for(const reason of [...c.missingReasons,...c.verificationMissingReasons]){const li=document.createElement('li');li.textContent=reason;list.appendChild(li);}
    if(p?.source){const li=document.createElement('li');li.textContent='Controlling geometry source: '+p.source;list.appendChild(li);}
  }
  root.VistaEnvelope={getResult,refresh,importInputs,checkProposal,exportPayload,exportOBJ,get proposalCheck(){getResult();return currentComparison();}};
  Promise.resolve(X().ready).then(()=>{
    refresh();
    if(new URLSearchParams(location.search).get('envelopedemo')==='1') {
      // An opt-in, conspicuously hypothetical demonstration. These coefficients
      // are not reconstructed City surfaces and cannot enter Preliminary.
      X().applyHash('#style=context&site=0,780&parts=120,24,34,0,0,Envelope%20example&rot=20&pm=boxes&mode=inspect&flow=output&fm=point,platform,cone&view=3.2.2&step=3&icam=-1.1,0.6,300');
      const p=X().proposalBox(), planes={};
      const domain=[[[-50,730],[50,730],[50,830],[-50,830]]];
      const affected=root.ConeCeiling.evaluate({footprints:domain,cones:X().assets.cones.cones}).overlappingViews;
      X().assets.cones.cones.filter(c=>affected.includes(String(c.view_number))).forEach((c,j)=>{planes[c.view_number]={origin:[0,780],observerElevationM:(p?.base||0)+110,bearingDeg:90,pitchDeg:j%2?20:-20,source:'Illustrative example: invented sloping surfaces, not City height geometry',basis:'assumption'};});
      importInputs({schema:'vista-view-envelope-input/1',polygons:[[[[-50,730],[50,730],[50,830],[-50,830]]]],planes,datumOffsetM:0,datumName:'Assumed common model reference',coordinateSystem:{horizontal:'Vista model XY (assumed)',units:'m',verticalDatum:'Assumed common model reference',compatible:true}});
      checkProposal();
      X().viewFromHere(); X().setMode('inspect'); X().flowGo('output');
      $('view-envelope-input-status').textContent='Illustrative example only: this parcel boundary and its sloping ceilings are invented to demonstrate the calculation.';
      $('cone-ceiling-title').scrollIntoView({block:'start'});
    }
    X().renderOnce();
  }).catch(error=>{if($('view-envelope-input-status'))$('view-envelope-input-status').textContent=error.message;});
})(window);
