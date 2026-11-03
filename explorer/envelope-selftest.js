/* App-owned regression: ?envelopetest=1. Every supplied source below is an
 * explicitly synthetic fixture; these checks establish no City permission. */
(async function () {
  'use strict';
  const tests = [], X = window.__explorer;
  const check = (name, pass, details) => tests.push({name, pass:!!pass, ...(details === undefined ? {} : {details})});
  const clone = value => JSON.parse(JSON.stringify(value));
  const near = (a,b,tolerance=1e-6) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a-b) <= tolerance;
  const pause = ms => new Promise(resolve => setTimeout(resolve,ms));
  const square = (x,y,r=50) => [[x-r,y-r],[x+r,y-r],[x+r,y+r],[x-r,y+r]];
  const area = points => Math.abs(points.reduce((s,p,i) => {const q=points[(i+1)%points.length];return s+p[0]*q[1]-p[1]*q[0];},0))/2;
  let original = null, originalImport = null, originalStudy = null;
  try {
    if (!X) throw new Error('Explorer must load before the envelope regression.');
    await X.ready;
    const deadline = performance.now()+10000;
    while (!window.VistaEnvelope && performance.now()<deadline) await pause(25);
    const V = window.VistaEnvelope;
    if (!V) throw new Error('VistaEnvelope did not become available.');
    original = X.serializeHash(); originalImport = X.state.imported; originalStudy=clone(X.getConeStudy());
    const cones = X.assets.cones?.available ? X.assets.cones.cones : [];
    const source = 'SYNTHETIC browser regression fixture; not City-issued geometry';
    const flatPlanes = Object.fromEntries(cones.map(c => [c.view_number,{origin:[0,0],observerElevationM:250,bearingDeg:90,pitchDeg:0,source}]));
    // A real loaded corridor must cover the full fixture, so the independent
    // affine clearance check never extrapolates a surface outside its domain.
    let site = null;
    const probes = [[0,780],[-216,338]];
    for(let y=0;y<=1200;y+=300)for(let x=-600;x<=600;x+=300)probes.push([x,y]);
    for (const [x,y] of probes) {
      const ring=square(x,y);
      const covered=cones.some(cone => {
        const r=ConeCeiling.evaluate({footprints:[ring],cones:[cone],planes:flatPlanes,datumOffsetM:0});
        return r.status==='ready' && near(r.patches.reduce((sum,p)=>sum+area(p.points),0),10000,.01);
      });
      if (!covered || !Number.isFinite(X.landZAt(x,y))) continue;
      site={x,y,ring};break;
    }
    check('fixture uses terrain and complete coverage by an actual loaded City plan corridor',!!site && cones.length>0,site&&{x:site.x,y:site.y,corridors:cones.length});
    if (!site) throw new Error('No terrain-covered full-footprint corridor fixture found.');
    X.applyHash(`#style=context&site=${site.x},${site.y}&parts=120,20,20,-20,0,Lower%20block;80,20,20,20,0,Upper%20block&rot=17,-11&pm=boxes&mode=overview&flow=build&fm=point,platform,&clear=0`);
    const baseline=JSON.stringify(X.state.parts), proposal=X.proposalBox();
    if (!proposal) throw new Error('Fixture blocks could not be placed.');
    const intercept=proposal.top+80;
    const planes=Object.fromEntries(cones.map((c,index) => [c.view_number,{origin:[site.x,site.y],observerElevationM:intercept,
      bearingDeg:90,pitchDeg:index%2 ? -20 : 20,source,basis:'reconstructed',reference:'SYNTHETIC affine control set A; no official authority'}]));
    const input={schema:'vista-view-envelope-input/1',polygons:[[site.ring]],planes,datumOffsetM:0,datumName:'Synthetic regression vertical reference',
      coordinateSystem:{horizontal:'Synthetic aligned model XY',units:'m',verticalDatum:'Synthetic regression vertical reference',compatible:true},
      boundarySource:{source,reference:'SYNTHETIC 100 m square boundary',date:'2026-11-02'},
      surveySource:{source,reference:'SYNTHETIC aligned grade fixture',date:'2026-11-02'}};
    const legacy=clone(input);
    for (const plane of Object.values(legacy.planes)) {plane.pitchDeg=0;delete plane.basis;delete plane.reference;}
    let result=await V.importInputs(legacy);
    check('source text and level observer assumptions remain Study',result.certainty?.stage==='study' && result.certainty?.verified===false,result.certainty);

    result=await V.importInputs(input);
    check('complete reconstruction, CRS and boundary/grade metadata produce Preliminary only',result.certainty?.stage==='preliminary' && result.certainty?.verified===false && result.coverageComplete===true,result.certainty);
    const suppliedAssessment=clone(input);
    suppliedAssessment.assessment={verified:true,checked:true,issuer:'City of Vancouver',source,reference:'SYNTHETIC test record',date:'2026-11-02',reviewer:'Synthetic test',maxResidualM:0,toleranceM:.01};
    result=await V.importInputs(suppliedAssessment);
    check('an asserted City record remains pending and never self-verifies',result.certainty?.verified===false && result.certainty?.verification==='pending' && result.certainty?.stage==='preliminary',result.certainty);

    const missing=clone(input), affecting=result.overlappingViews || [];
    if (!affecting.length) throw new Error('Fixture has no affecting view.');
    delete missing.planes[affecting[0]];
    result=await V.importInputs(missing);
    check('one missing affecting plane downgrades the whole-footprint result',result.certainty?.stage==='study' && result.certainty?.verified===false && result.missingViews?.includes(affecting[0]),{certainty:result.certainty,missingViews:result.missingViews});
    // Use one common positive slope for the independent exact-clearance
    // fixture below; the earlier completeness checks used both slope signs.
    for (const plane of Object.values(input.planes)) plane.pitchDeg=20;
    result=await V.importInputs(input);
    const saved=clone(X.getConeStudy());
    X.restoreConeStudy(saved);await V.refresh();
    const restored=X.getConeStudy(),evidence=restored.envelopeInputs || restored,first=String(affecting[0]);
    check('study restoration retains reconstruction references, CRS and boundary/grade evidence',
      restored.planes?.[first]?.basis==='reconstructed' && restored.planes?.[first]?.reference===planes[first].reference &&
      ['horizontal','units','verticalDatum','compatible'].every(key=>evidence.coordinateSystem?.[key]===input.coordinateSystem[key]) &&
      ['source','reference','date'].every(key=>evidence.boundarySource?.[key]===input.boundarySource[key] && evidence.surveySource?.[key]===input.surveySource[key]));

    result=V.getResult();
    const proposalCheck=await V.checkProposal();
    const current=X.proposalBox();
    const expectedTriangles=current.parts.reduce((sum,part)=>sum+part.idx.length/3,0);
    check('proposal check consumes every actual block triangle and completes exactly',proposalCheck.completed && proposalCheck.exact && proposalCheck.status==='ready' && proposalCheck.processedTriangles===expectedTriangles,proposalCheck);
    let expected=Infinity;
    const slope=Math.tan(20*Math.PI/180);
    for (const part of current.parts) for(let i=0;i<part.pos.length;i+=3) expected=Math.min(expected,intercept+(part.pos[i]-site.x)*slope-part.pos[i+2]);
    const b=current.box, bbox=ProposalGeometry.makePart({name:'Bounding prism comparison only',cx:(b[0]+b[3])/2,cy:(b[1]+b[4])/2,zMin:b[2],zMax:b[5],w:b[3]-b[0],d:b[4]-b[1],rotation:0});
    const boundCheck=ViewEnvelope.intersectProposal(result,{parts:[{name:bbox.name,positions:bbox.pos,indices:bbox.idx}]});
    check('exact block clearance matches affine extrema and differs from a bounding prism',near(proposalCheck.minClearanceM,expected,.0001) && boundCheck.completed && proposalCheck.minClearanceM>boundCheck.minClearanceM+1,
      {actual:proposalCheck.minClearanceM,independentExpected:expected,boundingPrism:boundCheck.minClearanceM});

    const payload=await V.exportPayload();
    check('JSON export preserves the complete 3D envelope, source inputs, scope and assessment stage',
      payload.schema==='vista-view-envelope/1' && payload.envelope?.mesh?.positions?.length>=9 &&
      payload.envelope.coverage?.parcelAreaM2>0 && payload.scope && payload.inputs?.planes?.[first]?.reference===planes[first].reference &&
      payload.certainty?.stage==='preliminary' && payload.certainty?.verified===false,payload&&{schema:payload.schema,scope:payload.scope,coverage:payload.envelope?.coverage});
    const positions=payload.envelope.mesh.positions;
    let zMin=Infinity,zMax=-Infinity;
    for(let i=2;i<positions.length;i+=3){zMin=Math.min(zMin,positions[i]);zMax=Math.max(zMax,positions[i]);}
    check('exported lower surface has finite varying elevations and exact parcel coverage',positions.every(Number.isFinite) && zMax-zMin>1 &&
      near(result.coverage.ceilingAreaM2+result.coverage.outsideAreaM2,result.coverage.parcelAreaM2,.001),{zMin,zMax,coverage:result.coverage});
    const obj=await V.exportOBJ(),objLines=String(obj).split(/\r?\n/),vertices=objLines.filter(line=>/^v\s/.test(line)).map(line=>line.trim().split(/\s+/).slice(1).map(Number)),faces=objLines.filter(line=>/^f\s/.test(line)).map(line=>line.trim().split(/\s+/).slice(1).map(value=>Number(value.split('/')[0])));
    const matches=vertices.some(p=>near(p[0],positions[0],.0001)&&near(p[1],positions[1],.0001)&&near(p[2],positions[2],.0001));
    check('OBJ contains actual XYZ vertices and valid 3D faces matching the JSON roof',vertices.length>=3 && faces.length>0 && matches && vertices.every(p=>p.length===3&&p.every(Number.isFinite)) && faces.every(face=>face.length>=3&&face.every(i=>Number.isInteger(i)&&i>=1&&i<=vertices.length)),{vertices:vertices.length,faces:faces.length});
    check('importing evidence, checking clearances and exporting never change block dimensions',JSON.stringify(X.state.parts)===baseline);
  } catch (error) {
    check('unexpected exception',false,{error:String(error),stack:error.stack});
  } finally {
    if (original) {
      try {X.state.imported=originalImport;X.applyHash(original);X.restoreConeStudy(originalStudy);await window.VistaEnvelope?.refresh();}
      catch(error){check('original study restoration',false,String(error));}
    }
    const report={passed:tests.filter(test=>test.pass).length,failed:tests.filter(test=>!test.pass).length,tests,all_pass:tests.length>0&&tests.every(test=>test.pass)};
    window.__envelopeSelfTest=report;
    let pre=document.getElementById('envelope-selftest-result');
    if(!pre){pre=document.createElement('pre');pre.id='envelope-selftest-result';pre.hidden=true;document.body.appendChild(pre);}
    pre.textContent=JSON.stringify(report);
    document.title=report.all_pass?'ENVELOPETEST DONE':'ENVELOPETEST FAIL';
  }
})();
