/* Opt-in browser regression: ?geotest=1. Synthetic references below establish
 * coordinate behavior only; they are not survey evidence or City permission. */
(async function () {
  'use strict';
  const tests=[],X=window.__explorer,G=window.VistaGeoreference;
  const check=(name,pass,details)=>tests.push({name,pass:!!pass,...(details===undefined?{}:{details})});
  const clone=value=>JSON.parse(JSON.stringify(value));
  const near=(a,b,t=1e-7)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=t;
  const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const parse=value=>typeof value==='string'?JSON.parse(value):value;
  const geometryState=()=>JSON.stringify({site:X.state.site,boundary:X.state.boundary,parts:X.state.parts,pmode:X.state.pmode,imported:X.state.imported?.placement});
  let original=null,originalImport=null,originalStudy=null,originalURL=null,originalExact=null,originalImagineOpen=false;
  try {
    if(!X||!G)throw new Error('Explorer and shared georeference must load before this regression.');
    await X.ready;
    const deadline=performance.now()+10000;
    while((!window.VistaLocation||!window.VistaEnvelope)&&performance.now()<deadline)await pause(25);
    const L=window.VistaLocation,V=window.VistaEnvelope;
    if(!L||!V)throw new Error('Geographic location and envelope interfaces did not become available.');
    original=X.serializeHash();originalImport=X.state.imported;originalStudy=clone(X.getConeStudy());originalURL=location.href;
    originalExact=clone({site:X.state.site,boundary:X.state.boundary,parts:X.state.parts,addressPin:X.state.addressPin});
    originalImagineOpen=document.getElementById('vista-imagine')?.open===true;
    const origin=G.modelToLonLat(0,0),reference=L.reference();
    check('model origin and machine reference retain the exact checked geographic anchor',near(origin.lat,49.2827,1e-12)&&near(origin.lon,-123.1207,1e-12)&&
      reference?.schema==='vista-georeference/1'&&reference.verticalTransformed===false&&reference.anchor?.north==='+Y',reference);

    const recorded=[[-516.5,-148.4,49.2813582,-123.1278124],[-587.8,606.9,49.2881886,-123.1287953],
      [-526.6,-781.6,49.2756313,-123.1279516],[1027.6,165.4,49.2841956,-123.1065497],
      [855.7,-885.4,49.2746925,-123.1089168],[-959.4,-20.2,49.2825174,-123.1339128],
      [-869.8,816.7,49.2900861,-123.1326789],[-1333,-2174.2,49.2630373,-123.1390565]];
    const residuals=recorded.map(([x,y,lat,lon])=>{
      const p=G.lonLatToModel(lon,lat),a=window.AerialContextGeo?.lonLatToModel(lon,lat);
      return{distance:Math.hypot(p.x-x,p.y-y),aerialEqual:!!a&&p.x===a.x&&p.y===a.y};
    });
    check('all eight geographic checks share the aerial mapping and remain within 0.1 m of recorded model points',residuals.every(r=>r.distance<.1&&r.aerialEqual),residuals);
    check('coordinate controls are present and usable', ['geo-crs','geo-x','geo-y','geo-locate','geo-place','geo-status'].every(id=>!!document.getElementById(id)));

    const probes=[[0,780],[-216,338],[0,0],[-500,500],[500,500]],site=probes.find(([x,y])=>Number.isFinite(X.landZAt(x,y)));
    if(!site)throw new Error('No terrain-backed fixture site is available.');
    X.applyHash(`#style=context&site=${site.join(',')}&parts=120,24,34,0,0,Geographic%20regression&rot=17&pm=boxes&mode=overview&flow=build&fm=point,platform,&clear=0`);
    const fixed=geometryState(),dims=clone(X.proposalBox()?.box),ll=G.modelToLonLat(site[0]+20,site[1]+10);
    const located=await L.locate(ll.lon,ll.lat,'EPSG:4326');L.refresh();
    const info=L.getInfo(),siteLL=G.modelToLonLat(...site),expectedUtm=G.fromModel(site[0]+20,site[1]+10,'EPSG:26910'),target=X.state.cams.overview.target;
    check('geographic locate and readout return the corresponding model and UTM position',near(located?.x,site[0]+20)&&near(located?.y,site[1]+10)&&
      near(target[0],located.x)&&near(target[1],located.y)&&near(X.state.addressPin?.x,located.x)&&near(X.state.addressPin?.y,located.y)&&
      near(info?.modelPoint?.x,located.x)&&near(info?.modelPoint?.y,located.y)&&near(info?.geographic?.lon,ll.lon)&&near(info?.geographic?.lat,ll.lat)&&
      near(info?.utm?.x,expectedUtm.x,1e-5)&&near(info?.utm?.y,expectedUtm.y,1e-5),info);
    check('locating coordinates preserves site, boundary, imported placement and actual proposal dimensions',geometryState()===fixed&&JSON.stringify(X.proposalBox()?.box)===JSON.stringify(dims));
    let rejected=false;
    const beforeBad=geometryState(),beforePoint=clone(L.getInfo()?.modelPoint);
    try{await L.locate(500000,5450000,'EPSG:3005');}catch(_){rejected=true;}
    const afterPoint=L.getInfo()?.modelPoint;
    check('unsupported CRS is rejected without changing the study or active coordinate point',rejected&&geometryState()===beforeBad&&JSON.stringify(beforePoint)===JSON.stringify(afterPoint));

    document.getElementById('geo-crs').value='EPSG:4326';
    document.getElementById('geo-crs').dispatchEvent(new Event('change',{bubbles:true}));
    document.getElementById('geo-x').value=String(G.ORIGIN_LON);
    document.getElementById('geo-y').value=String(G.ORIGIN_LAT);
    document.getElementById('geo-locate').click();await pause(30);
    const formTarget=X.state.cams.overview.target;
    check('the visible longitude/latitude form locates the origin without moving the proposal',near(formTarget[0],0)&&near(formTarget[1],0)&&
      near(X.state.addressPin?.x,0)&&near(X.state.addressPin?.y,0)&&geometryState()===fixed,{target:formTarget,info:L.getInfo()});

    // Choosing a valid land point may open the existing placement confirmation;
    // cancelling that confirmation must retain all study geometry.
    await L.locate(...site,'VISTA:MODEL');
    document.getElementById('geo-x').value=String(siteLL.lon);
    document.getElementById('geo-y').value=String(siteLL.lat);
    document.getElementById('geo-place').click();await pause(20);
    const dialog=document.getElementById('site-placement-dialog'),opened=dialog?.open===true;
    if(opened)document.getElementById('btn-cancel-site-placement').click();
    check('coordinate placement uses the existing confirmation and cancellation preserves geometry',opened&&dialog.open===false&&geometryState()===fixed);

    const exported=parse(await L.exportGeoJSON()),positions=[];
    function visitCoordinates(c){if(!Array.isArray(c))return;if(c.length&&typeof c[0]==='number')positions.push(c);else c.forEach(visitCoordinates);}
    function visitGeo(item){if(!item||typeof item!=='object')return;if(item.geometry)visitGeo(item.geometry);if(item.coordinates)visitCoordinates(item.coordinates);if(item.features)item.features.forEach(visitGeo);if(item.geometries)item.geometries.forEach(visitGeo);}
    visitGeo(exported);
    check('geographic export contains valid longitude/latitude pairs with no false ellipsoidal Z',positions.length>0&&positions.every(p=>p.length===2&&p.every(Number.isFinite)&&Math.abs(p[0])<=180&&Math.abs(p[1])<=90),{type:exported?.type,positions:positions.length,first:positions[0]});

    const source='SYNTHETIC geographic browser regression; not City-issued evidence',datum='Synthetic supplied vertical reference';
    const ring=[[site[0]-20,site[1]-20],[site[0]+20,site[1]-20],[site[0]+20,site[1]+20],[site[0]-20,site[1]+20]];
    const cones=X.assets.cones?.available?X.assets.cones.cones:[];
    if(!cones.length)throw new Error('Loaded corridor IDs are needed for the envelope restoration fixture.');
    const refs=[[site[0],site[1],250],[site[0]+100,site[1],250],[site[0],site[1]+100,250]];
    const planes=Object.fromEntries(cones.map(c=>[c.view_number,{inputCrs:'VISTA:MODEL',origin:site.slice(),observerElevationM:250,bearingDeg:0,pitchDeg:0,
      referencePoints:clone(refs),source,basis:'reconstructed',reference:'SYNTHETIC three-point plane fixture',date:'2026-11-02'}]));
    const geographicRing=ring.map(p=>{const ll=G.modelToLonLat(...p);return[ll.lon,ll.lat];});
    const rawGeoJSON={type:'Feature',properties:{name:'SYNTHETIC boundary only; no survey evidence'},geometry:{type:'Polygon',coordinates:[[...geographicRing,geographicRing[0].slice()]]}};
    const boundaryOnlyResult=await V.importInputs(rawGeoJSON),boundaryOnlyStudy=X.getConeStudy(),boundaryOnlyEvidence=boundaryOnlyStudy.envelopeInputs;
    check('RFC 7946 boundary import converts longitude/latitude to the model without inventing survey evidence',
      boundaryOnlyResult.certainty?.stage==='study'&&near(boundaryOnlyEvidence?.polygons?.[0]?.[0]?.[0]?.[0],ring[0][0])&&
      near(boundaryOnlyEvidence?.polygons?.[0]?.[0]?.[0]?.[1],ring[0][1])&&
      boundaryOnlyEvidence?.sourceCoordinateSystem?.inputCrs==='EPSG:4326'&&!boundaryOnlyEvidence?.surveySource?.source,
      {certainty:boundaryOnlyResult.certainty,sourceCoordinateSystem:boundaryOnlyEvidence?.sourceCoordinateSystem});
    const input={schema:'vista-view-envelope-input/1',polygons:[[geographicRing]],planes,datumOffsetM:0,datumName:datum,
      coordinateSystem:{inputCrs:'EPSG:4326',horizontal:'WGS84 longitude/latitude',units:'degrees',verticalDatum:datum,compatible:true},
      boundarySource:{source,reference:'SYNTHETIC 40 m square',date:'2026-11-02'},surveySource:{source,reference:'SYNTHETIC grade fixture',date:'2026-11-02'}};
    let result=await V.importInputs(input);
    let study=X.getConeStudy(),evidence=study.envelopeInputs,first=String(cones[0].view_number),p=study.planes[first];
    check('geographic envelope boundary converts once while explicit model plane references retain their position',
      evidence?.coordinateSystem?.inputCrs==='VISTA:MODEL'&&evidence.sourceCoordinateSystem?.inputCrs==='EPSG:4326'&&
      near(evidence.polygons[0][0][0][0],ring[0][0])&&near(evidence.polygons[0][0][0][1],ring[0][1])&&
      near(p?.origin?.[0],site[0])&&near(p?.origin?.[1],site[1])&&p?.observerElevationM===250&&study.datumOffsetM===0,
      {coordinateSystem:evidence?.coordinateSystem,sourceCoordinateSystem:evidence?.sourceCoordinateSystem,plane:p});
    const saved=clone(study);X.restoreConeStudy(saved);await V.refresh();
    study=X.getConeStudy();evidence=study.envelopeInputs;
    check('study restoration preserves geographic provenance and the three plane reference points',
      evidence?.sourceCoordinateSystem?.inputCrs==='EPSG:4326'&&evidence.georeference?.sourceCrs==='EPSG:4326'&&
      evidence.georeference?.verticalTransformed===false&&JSON.stringify(study.planes[first]?.referencePoints)===JSON.stringify(refs),
      {georeference:evidence?.georeference,referencePoints:study.planes[first]?.referencePoints});

    const utmInput=clone(input);
    utmInput.polygons=[[ring.map(xy=>{const q=G.fromModel(...xy,'EPSG:26910');return[q.x,q.y];})]];
    utmInput.coordinateSystem={...input.coordinateSystem,inputCrs:'EPSG:26910',horizontal:'NAD83 / UTM zone 10N',units:'m'};
    result=await V.importInputs(utmInput);
    const firstStage=result.certainty?.stage;
    X.restoreConeStudy(clone(X.getConeStudy()));await V.refresh();
    const payload=parse(await V.exportPayload()),normalizedInputs=payload.inputs;
    result=await V.importInputs(normalizedInputs);
    const finalEvidence=X.getConeStudy().envelopeInputs;
    check('approximate NAD83 alignment remains Study after restoration, calculation export and reimport',firstStage==='study'&&result.certainty?.stage==='study'&&
      result.certainty?.verified===false&&finalEvidence?.georeference?.approximateDatumShift===true&&
      finalEvidence.coordinateSystem?.surveyCompatible===false&&finalEvidence.coordinateSystem?.inputCrs==='VISTA:MODEL'&&
      finalEvidence.sourceCoordinateSystem?.inputCrs==='EPSG:26910',
      {firstStage,finalCertainty:result.certainty,sourceCoordinateSystem:finalEvidence?.sourceCoordinateSystem});

    const I=window.VistaImagine;
    if(!I?.showParcelInModel)throw new Error('Imagine geographic parcel navigation is unavailable.');
    let imagineTimer;
    try{await Promise.race([I.open(),new Promise((_,reject)=>{imagineTimer=setTimeout(()=>reject(new Error('Imagine geographic fixture load timed out.')),60000);})]);}
    finally{clearTimeout(imagineTimer);}
    const parcel=I.getParcelAt(-216,338),beforeParcelFocus=geometryState();
    const focused=parcel&&await I.showParcelInModel(parcel.id),box=parcel?.bbox;
    const centre=box&&[(box[0]+box[2])/2,(box[1]+box[3])/2],parcelTarget=X.state.cams.overview.target;
    check('an Imagine parcel links to its model extent centre and preserves the active proposal and study site',
      focused===true&&!!centre&&near(parcelTarget[0],centre[0])&&near(parcelTarget[1],centre[1])&&
      near(X.state.addressPin?.x,centre[0])&&near(X.state.addressPin?.y,centre[1])&&geometryState()===beforeParcelFocus,
      {parcel:parcel?.id,expectedCentre:centre,target:parcelTarget,pin:X.state.addressPin});
  }catch(error){check('unexpected exception',false,{error:String(error),stack:error.stack});}
  finally{
    if(original){
      try{
        if(document.getElementById('site-placement-dialog')?.open)document.getElementById('btn-cancel-site-placement').click();
        X.state.imported=originalImport;X.applyHash(original);
        X.state.site=originalExact.site;X.state.boundary=originalExact.boundary;X.state.parts=originalExact.parts;
        X.setAddressPin(originalExact.addressPin||null);
        X.restoreConeStudy(originalStudy);X.refreshPanels();X.renderOnce();await window.VistaEnvelope?.refresh();window.VistaLocation?.refresh();
        if(originalImagineOpen)await window.VistaImagine?.open();else window.VistaImagine?.close();
        if(originalURL)history.replaceState(null,'',originalURL);
      }catch(error){check('original study restoration',false,{error:String(error)});}
    }
    const report={passed:tests.filter(t=>t.pass).length,failed:tests.filter(t=>!t.pass).length,tests,all_pass:tests.length>0&&tests.every(t=>t.pass)};
    window.__georeferenceSelfTest=report;
    let pre=document.getElementById('georeference-selftest-result');
    if(!pre){pre=document.createElement('pre');pre.id='georeference-selftest-result';pre.hidden=true;document.body.appendChild(pre);}
    pre.textContent=JSON.stringify(report);document.title=report.all_pass?'GEOTEST DONE':'GEOTEST FAIL';
  }
})();
