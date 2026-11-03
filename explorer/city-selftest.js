/* Integration regression for streets, Context and canonical-unit state. ?citytest=1 */
if (new URLSearchParams(location.search).get('importselftest') === '1') {
(async function(){
'use strict';
const X=window.__explorer, tests=[];
const check=(name,pass,details)=>tests.push({name,pass:!!pass,...(details?{details}:{})});
const part=(name,x,y,w=2,h=3)=>({name,bbox:[x,y,0,x+w,y+w,h],
  positions:new Float32Array([x,y,0,x+w,y,0,x,y+w,h]),indices:new Uint32Array([0,1,2])});
let original=null,timer=null,watching=false,frames=0,ticks=0,maxGap=0,last=0,phase='startup';
const phaseStats={},contextEvents=[],diagnosticStart=performance.now();
const beginPhase=name=>{const now=performance.now();if(phaseStats[phase])phaseStats[phase].elapsedMs=Math.round(now-phaseStats[phase].started);phase=name;phaseStats[name]={started:now,maxGapMs:0,ticks:0};};
const contextEvent=event=>contextEvents.push({type:event.type,statusMessage:event.statusMessage||'',phase,elapsedMs:Math.round(performance.now()-diagnosticStart)});
let contextCanvas=null;
const glOriginals=[],glCallTotals={},glSlowCalls=[];
const instrumentGL=()=>{for(const method of ['bufferData','drawElements','deleteBuffer']){
  const originalMethod=X.gl[method],descriptor=Object.getOwnPropertyDescriptor(X.gl,method);
  glOriginals.push({method,originalMethod,descriptor});
  Object.defineProperty(X.gl,method,{configurable:true,writable:true,value:function(...args){
    const callPhase=phase,start=performance.now();
    try{return originalMethod.apply(X.gl,args);}finally{
      const ms=performance.now()-start,key=callPhase+':'+method;
      const total=glCallTotals[key]||(glCallTotals[key]={phase:callPhase,method,calls:0,totalMs:0,maxMs:0,bytes:0,count:0});
      const bytes=method==='bufferData'?(typeof args[1]==='number'?args[1]:args[1]?.byteLength||0):0;
      const count=method==='drawElements'?args[1]:method==='deleteBuffer'?1:0;
      total.calls++;total.totalMs+=ms;total.maxMs=Math.max(total.maxMs,ms);total.bytes+=bytes;total.count+=count;
      if(ms>20&&glSlowCalls.length<100)glSlowCalls.push({phase:callPhase,method,elapsedMs:Math.round(start-diagnosticStart),durationMs:Math.round(ms*100)/100,bytes,count});
    }
  }});
}};
const restoreGL=()=>{for(const {method,descriptor}of glOriginals){if(descriptor)Object.defineProperty(X.gl,method,descriptor);else delete X.gl[method];}glOriginals.length=0;};
try{
  await X.ready; original=X.serializeHash();instrumentGL();
  contextCanvas=X.gl.canvas;contextCanvas.addEventListener('webglcontextlost',contextEvent);contextCanvas.addEventListener('webglcontextrestored',contextEvent);
  X.applyHash('#site=-216.123,338.145&flow=build&fm=point,import,&pm=import&parts=120,30,30,0,0,Tower');
  const first=X.installImport('baseline.3dm',[part('Baseline',0,0)],'fixture metres');
  check('baseline model loads before stress',first===true&&X.state.imported?.name==='baseline.3dm');
  const many=Array.from({length:1000},(_,i)=>part(`Part ${i+1}`,(i%40)*3,Math.floor(i/40)*3));
  watching=true;last=performance.now();timer=setInterval(()=>{const now=performance.now(),gap=now-last;maxGap=Math.max(maxGap,gap);if(phaseStats[phase]){phaseStats[phase].maxGapMs=Math.round(Math.max(phaseStats[phase].maxGapMs,gap));phaseStats[phase].ticks++;}last=now;ticks++;},25);
  const pulse=()=>{if(watching){frames++;requestAnimationFrame(pulse);}};requestAnimationFrame(pulse);
  beginPhase('wideImport');
  const wide=X.installImport('wide.3dm',[part('City-scale plan',-10000,-10000,20000,30)],'fixture metres');
  await new Promise(resolve=>setTimeout(resolve,50));
  check('city-scale footprint finishes with bounded demolition',wide===true&&!!X.state.clearanceWarning,
    {warning:X.state.clearanceWarning,cleared:X.state.cleared.length});
  beginPhase('thousandPartImport');
  const stress=await X.installImport('thousand-parts.3dm',many,'fixture metres');
  await new Promise(resolve=>setTimeout(resolve,50));
  check('one thousand imported parts share one display mesh',stress===true&&X.state.imported?.parts.length===1000&&X.state.imported.drawMeshes.length===1,
    {parts:X.state.imported?.parts.length,drawMeshes:X.state.imported?.drawMeshes.length});
  // Synthetic closed rectangular stress fixture; no external/private model is involved.
  // A 160 x 160 roof and base plus segmented walls stay below 2 MB of input arrays.
  beginPhase('denseGeneration');
  const denseStart=performance.now(),denseTicks=ticks,denseFrames=frames,n=160,stride=n+1,layerVertices=stride*stride;
  const positions=new Float32Array(layerVertices*2*3),indices=new Uint32Array((n*n*4+n*8)*3);
  for(let z=0;z<2;z++)for(let y=0;y<=n;y++)for(let x=0;x<=n;x++){
    const k=(z*layerVertices+y*stride+x)*3;positions[k]=-22+44*x/n;positions[k+1]=-18+36*y/n;positions[k+2]=z*138;
  }
  let cursor=0;const triangle=(a,b,c)=>{indices[cursor++]=a;indices[cursor++]=b;indices[cursor++]=c;};
  for(let y=0;y<n;y++)for(let x=0;x<n;x++){
    const a=y*stride+x,b=a+1,c=a+stride,d=c+1,t=layerVertices;
    triangle(a,d,b);triangle(a,c,d);triangle(a+t,b+t,d+t);triangle(a+t,d+t,c+t);
  }
  const wall=(a,b)=>{triangle(a,b,b+layerVertices);triangle(a,b+layerVertices,a+layerVertices);};
  for(let i=0;i<n;i++){wall(i,i+1);wall(i*stride+n,(i+1)*stride+n);wall(n*stride+i+1,n*stride+i);wall((i+1)*stride,i*stride);}
  const denseTriangles=indices.length/3,denseBytes=positions.byteLength+indices.byteLength;
  // Independently count manifold edge use and signed volume before installation.
  const edgeUses=new Map();let signedVolume=0,invalidIndices=0;
  for(let i=0;i<indices.length;i+=3){
    const a=indices[i],b=indices[i+1],c=indices[i+2];
    for(const v of [a,b,c])if(v>=positions.length/3)invalidIndices++;
    for(const [u,v]of [[a,b],[b,c],[c,a]]){const key=Math.min(u,v)*(positions.length/3)+Math.max(u,v);edgeUses.set(key,(edgeUses.get(key)||0)+1);}
    const A=a*3,B=b*3,C=c*3;
    signedVolume+=(positions[A]*(positions[B+1]*positions[C+2]-positions[B+2]*positions[C+1])+positions[A+1]*(positions[B+2]*positions[C]-positions[B]*positions[C+2])+positions[A+2]*(positions[B]*positions[C+1]-positions[B+1]*positions[C]))/6;
  }
  const fixtureGeometry={vertices:positions.length/3,triangles:denseTriangles,edges:edgeUses.size,nonManifoldEdges:[...edgeUses.values()].filter(count=>count!==2).length,invalidIndices,signedVolumeM3:signedVolume,expectedVolumeM3:44*36*138,bounds:[-22,-18,0,22,18,138]};edgeUses.clear();
  check('synthetic dense fixture is closed with consistent outward winding',fixtureGeometry.nonManifoldEdges===0&&invalidIndices===0&&Math.abs(signedVolume-fixtureGeometry.expectedVolumeM3)<0.01,fixtureGeometry);
  const denseGenerateMs=performance.now()-denseStart;beginPhase('denseImport');const denseImportStart=performance.now();
  const denseLoaded=await X.installImport('synthetic-dense-closed-mesh.3dm',[
    {name:'Synthetic tessellated closed rectangular mesh',bbox:[-22,-18,0,22,18,138],positions,indices}
  ],'synthetic fixture metres','Synthetic stress fixture generated locally; not a Rhino file.');
  const denseImportMs=performance.now()-denseImportStart,denseModel=X.state.imported;
  beginPhase('denseWorkerProjectionFetchAndMatch');const denseLookupStart=performance.now();
  check('synthetic dense closed mesh exceeds the former 30k limit with bounded input arrays',denseLoaded===true&&denseTriangles>30000&&denseBytes<2000000&&cursor===indices.length,
    {fixture:'synthetic closed 44 x 36 x 138 m rectangular mesh',triangles:denseTriangles,inputBytes:denseBytes,drawMeshes:denseModel?.drawMeshes.length});
  let lookupTimer=null,parcelResult=null;
  try{
    if(!denseModel?.parcelJob?.promise)throw new Error('Synthetic dense fixture did not start a property lookup worker.');
    parcelResult=await Promise.race([denseModel.parcelJob.promise,new Promise((_,reject)=>{lookupTimer=setTimeout(()=>reject(new Error('Synthetic dense property lookup exceeded 22 seconds.')),22000);})]);
  }finally{if(lookupTimer!==null)clearTimeout(lookupTimer);}
  check('synthetic dense mesh automatically matches actual source property parcels',X.state.imported===denseModel&&['matched','matched-review'].includes(parcelResult?.status)&&parcelResult.ids.length>0&&parcelResult.polygons.length>0,
    {fixture:'synthetic stress mesh; actual cadastral snapshot',status:parcelResult?.status,parcelIds:parcelResult?.ids,polygons:parcelResult?.polygons.length,elapsedMs:Math.round(performance.now()-denseStart),generationAndValidationMs:Math.round(denseGenerateMs),importMs:Math.round(denseImportMs),workerProjectionFetchAndMatchMs:Math.round(performance.now()-denseLookupStart),workerTimingNote:'Worker exposes one final result; projection/fetch/match cannot be isolated here.'});
  check('heartbeat and animation continue during synthetic dense mesh import and property lookup',ticks>denseTicks&&frames>denseFrames&&maxGap<2000,
    {fixture:'synthetic dense closed mesh',ticks:ticks-denseTicks,frames:frames-denseFrames,maxGapMs:Math.round(maxGap)});
  const denseGLError=X.gl.getError();check('WebGL stays healthy after synthetic dense mesh import',denseGLError===X.gl.NO_ERROR&&!X.gl.isContextLost(),{glError:denseGLError,isContextLost:X.gl.isContextLost(),contextEvents:[...contextEvents]});
  beginPhase('cancellation');
  const preserved=X.state.imported,preservedMeshCount=preserved.drawMeshes.length, ticket={cancelled:false,controller:new AbortController()};
  const pending=X.installImport('cancelled.3dm',Array.from({length:33},(_,i)=>part(`Cancel ${i}`,i*3,0)),'fixture metres','',ticket);
  ticket.cancelled=true;ticket.controller.abort();
  const cancelled=await pending;
  check('cancelled upload preserves the previous model',cancelled===false&&X.state.imported===preserved&&X.state.imported.drawMeshes.length===preservedMeshCount,{preservedFixture:'synthetic dense closed mesh',drawMeshes:preservedMeshCount});
  const finalGLError=X.gl.getError();check('WebGL stays healthy after stress and cancellation',finalGLError===X.gl.NO_ERROR&&!X.gl.isContextLost(),{glError:finalGLError,isContextLost:X.gl.isContextLost(),contextEvents:[...contextEvents]});
  check('main-thread heartbeat continues during import',ticks>0&&frames>0&&maxGap<2000,{ticks,frames,maxGapMs:Math.round(maxGap)});
}catch(error){tests.push({name:'exception',pass:false,error:String(error),stack:error?.stack});}
finally{restoreGL();beginPhase('restore');watching=false;if(timer!==null)clearInterval(timer);contextCanvas?.removeEventListener('webglcontextlost',contextEvent);contextCanvas?.removeEventListener('webglcontextrestored',contextEvent);try{X.startNewStudy();if(original)X.applyHash(original);}catch(_){}
  const report=document.createElement('pre');report.id='import-selftest-result';report.hidden=true;
  report.textContent=JSON.stringify({tests,all_pass:tests.length>0&&tests.every(test=>test.pass),heartbeat:{ticks,frames,maxGapMs:Math.round(maxGap)},diagnostics:{phases:phaseStats,contextEvents,isContextLost:X.gl.isContextLost(),glCallTotals:Object.values(glCallTotals),glSlowCalls}});
  document.body.appendChild(report);document.title=tests.every(test=>test.pass)?'IMPORTTEST DONE':'IMPORTTEST FAIL';
  const badge=document.createElement('div');badge.id='import-selftest-badge';badge.setAttribute('role','status');
  badge.textContent=`Import stress ${tests.filter(test=>test.pass).length}/${tests.length} passed · max event-loop gap ${Math.round(maxGap)} ms`;
  badge.style.cssText=`position:fixed;right:16px;bottom:48px;z-index:10000;padding:10px 14px;border-radius:6px;background:${tests.every(test=>test.pass)?'#123b2a':'#7a201a'};color:white;font:600 13px system-ui;box-shadow:0 4px 16px #0004`;
  document.body.appendChild(badge);}
})();
} else {
(async function(){
'use strict';
const X=window.__explorer,$=id=>document.getElementById(id),tests=[];
const check=(name,pass,details)=>{tests.push({name,pass:!!pass,...(details?{details}:{})});};let original=null;
try{
 await X.ready;original=X.serializeHash();
 await X.waterSurface.ready;
 check('self-hosted water normal loads as a complete 1K texture',X.waterSurface.loaded&&X.waterSurface.width===1024&&X.waterSurface.height===1024);
 check('Context source and extension water share one palette',JSON.stringify(X.SCENE_STYLES.context.colors.water)===JSON.stringify(X.SCENE_STYLES.context.colors.extWater));
 await X.grassSurface.ready;
 check('generated grass albedo loads as a complete self-hosted texture',X.grassSurface.loaded&&X.grassSurface.width===1254&&X.grassSurface.height===1254);
 check('Context source and extension parks share one palette',JSON.stringify(X.SCENE_STYLES.context.colors.parks)===JSON.stringify(X.SCENE_STYLES.context.colors.extParks));
 await Promise.all(Object.values(X.pavingSurfaces).map(surface=>surface.ready));
 check('user asphalt texture loads unchanged at 480 by 960',X.pavingSurfaces.asphalt.loaded&&X.pavingSurfaces.asphalt.width===480&&X.pavingSurfaces.asphalt.height===960);
 check('user concrete paving loads unchanged at 1152 by 2048',X.pavingSurfaces.concrete.loaded&&X.pavingSurfaces.concrete.width===1152&&X.pavingSurfaces.concrete.height===2048);
 await Promise.all(Object.values(X.facadeSurfaces).map(surface=>surface.ready));
 check('all three self-hosted facade albedos load at 1K',Object.values(X.facadeSurfaces).every(surface=>surface.loaded&&surface.width===1024&&surface.height===1024));
 check('all context buildings receive bounded illustrative facade profiles',X.assets.materials.buildings.profiles.length===X.assets.index.count&&X.assets.materials.ext_buildings.profiles.length===X.assets.extIndex.count&&Object.values(X.assets.materials).every(material=>material.stats.illustrative&&material.stats.invalidRows===0&&material.profiles.every(p=>p.family>=0&&p.family<=5)));
 check('core context includes all six facade families',X.assets.materials.buildings.stats.familyCounts.every(count=>count>0));
 X.applyHash('#style=context&site=-216.123,338.145&parts=120,30,30,0,0,Tower&mode=inspect&flow=build&fm=point,platform,');
 const sourceIds=X.assets.index.columns.osm_id,body=sourceIds.indexOf('w360939772'),cap=sourceIds.indexOf('w360939775'),attachment=sourceIds.indexOf('w360939773');
 check('replacing the tower also removes supported elevated cap and facade pieces',body>=0&&cap>=0&&attachment>=0&&X.isRemoved(body,false)&&X.isRemoved(cap,false)&&X.isRemoved(attachment,false));
 const orphan=sourceIds.indexOf('w360942277'),c=X.assets.index.columns;
 check('unsupported floating source slab is absent from drawing and roof picking',orphan>=0&&c.index_count[orphan]===0&&X.roofZAt(orphan,false,-180,290)===null&&X.assets.modelCleanup.fragments.some(r=>r.osm_id==='w360942277'));
 check('supported tower caps retain geometry for the existing comparison',c.index_count[body]>0&&c.index_count[cap]>0&&c.index_count[attachment]>0&&X.assets.modelCleanup.sourceFilesPreserved);
 const buildingProfiles=X.assets.materials.buildings.profiles,bodyMaterial=buildingProfiles[body];
 check('tower body and supported caps share material seed and floor alignment',[cap,attachment].every(row=>['family','baseZ','height','seed','floorHeightM','wallAngle'].every(key=>buildingProfiles[row][key]===bodyMaterial[key])));
 const glBinding=X.gl.getParameter(X.gl.ARRAY_BUFFER_BINDING),gpuProfile=new Float32Array(4);
 try{X.gl.bindBuffer(X.gl.ARRAY_BUFFER,X.assets.meshes.buildings.contextBuffer);X.gl.getBufferSubData(X.gl.ARRAY_BUFFER,X.assets.meshes.buildings.renderIndex[c.index_offset[body]]*16,gpuProfile);}finally{X.gl.bindBuffer(X.gl.ARRAY_BUFFER,glBinding);}
 check('building GPU attributes retain exact family floor and wall orientation packing',gpuProfile[3]===BuildingMaterials.pack(bodyMaterial)&&Math.abs(gpuProfile[0]-bodyMaterial.baseZ)<0.001&&Math.abs(gpuProfile[2]-bodyMaterial.seed)<0.000001);
 check('both building catalogues have complete wall-boundary render attributes', ['buildings','ext_buildings'].every(key=>{const mesh=X.assets.meshes[key],stats=mesh.facadeStats;return stats&&stats.triangles*3===X.assets.raw[key].idx.length&&mesh.renderIndex.length===X.assets.raw[key].idx.length&&stats.acceptedWallTriangles>0&&mesh.facadeLimitsBuffer&&mesh.facadeAngleBuffer;}));
 const facadeBinding=X.gl.getParameter(X.gl.VERTEX_ARRAY_BINDING);
 try{X.gl.bindVertexArray(X.assets.meshes.buildings.vao);check('wall limits and canonical angle are bound as separate vertex attributes',X.gl.getVertexAttrib(2,X.gl.VERTEX_ATTRIB_ARRAY_ENABLED)&&X.gl.getVertexAttrib(3,X.gl.VERTEX_ATTRIB_ARRAY_ENABLED)&&X.gl.getVertexAttrib(2,X.gl.VERTEX_ATTRIB_ARRAY_SIZE)===4&&X.gl.getVertexAttrib(3,X.gl.VERTEX_ATTRIB_ARRAY_SIZE)===1);}finally{X.gl.bindVertexArray(facadeBinding);}
 const parts=JSON.stringify(X.state.parts);X.setDisplayUnits('ft');
 check('unit toggle changes controls but never geometry',JSON.stringify(X.state.parts)===parts&&$('proposal-units').value==='ft'&&$('parts-list').textContent.includes('Height (ft)'));
 X.setDisplayUnits('mm');const metricHash=X.serializeHash();X.applyHash(metricHash);
 check('display units persist beside metre dimensions',X.state.displayUnits==='mm'&&X.state.parts[0].h===120);
 // Exercise real editor events: changing an angle must not move the site, camera or context.
 const rotationStart=X.serializeHash(),rotationContext=JSON.stringify([X.state.site,X.state.cams,X.buildingsPositionsChecksum()]),dimensions=JSON.stringify(X.state.parts.map(({rotation,...p})=>p)),footprint=JSON.stringify(X.proposalParts()[0].footprint);
 const rotationInput=type=>$('parts-list').querySelector(`input[type="${type}"][data-k="rotation"][data-i="0"]`);
 const rotate=(type,value)=>{const el=rotationInput(type);el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));};
 $('parts-list').querySelector('.part-rotation').open=true;rotate('range',45);
 check('rotation slider turns only the proposed block while retaining its dimensions',X.state.parts[0].rotation===45&&rotationInput('number').value==='45'&&JSON.stringify(X.proposalParts()[0].footprint)!==footprint&&JSON.stringify(X.state.parts.map(({rotation,...p})=>p))===dimensions&&JSON.stringify([X.state.site,X.state.cams,X.buildingsPositionsChecksum()])===rotationContext);
 rotate('number',-32.25);
 check('exact rotation synchronizes the live slider without losing precision',X.state.parts[0].rotation===-32.25&&Number(rotationInput('range').value)===-32.25);
 $('parts-list').querySelector('.part-rotation').open=false;X.setDisplayUnits('ft');X.setDisplayUnits('mm');
 check('closing rotation and switching units retains the angle and footprint',!$('parts-list').querySelector('.part-rotation').open&&X.state.parts[0].rotation===-32.25&&JSON.stringify(X.state.parts.map(({rotation,...p})=>p))===dimensions);
 const rotatedFootprint=JSON.stringify(X.proposalParts()[0].footprint);X.applyHash(X.serializeHash());
 check('saved rotated study restores its angle and exposes rotation controls',X.state.parts[0].rotation===-32.25&&JSON.stringify(X.proposalParts()[0].footprint)===rotatedFootprint&&$('parts-list').querySelector('.part-rotation').open);
 const resetContext=JSON.stringify([X.state.site,X.state.cams,X.buildingsPositionsChecksum()]);$('parts-list').querySelector('[data-reset-rotation="0"]').click();
 check('reset restores the original orientation without moving the site or context',X.state.parts[0].rotation===0&&rotationInput('number').value==='0'&&Number(rotationInput('range').value)===0&&JSON.stringify(X.proposalParts()[0].footprint)===footprint&&JSON.stringify([X.state.site,X.state.cams,X.buildingsPositionsChecksum()])===resetContext);
 X.applyHash(rotationStart);
 const importedBefore=X.state.imported,solid=ProposalGeometry.makePart({name:'Solid',cx:0,cy:0,zMin:0,zMax:10,w:10,d:10});
 X.installImport('Solid and glass regression.3dm',[
  {name:'Solid',bbox:solid.box,positions:solid.pos,indices:solid.idx},
  {name:'Tall glass',bbox:[0,-2,0,0,2,30],positions:[0,-2,0,0,2,0,0,2,30,0,-2,30],indices:[0,1,2,0,2,3]}
 ],'fixture metres');
 check('imported vertical surfaces render and participate in corridor geometry without blocking import',X.proposalParts().length===2&&X.state.mode==='inspect'&&X.planAnalysis().length>0&&X.gl.getError()===X.gl.NO_ERROR);
 X.state.check.unknown=false;X.state.check.reference='height';X.state.check.height=20;
 const surfaceCheck=await X.runCheck(),surfaceBody=X.checkBody();
 check('numeric solid study declares surface omissions and never claims the whole model is below',surfaceCheck?.overall_result==='BELOW_BOUNDARY'&&surfaceBody.parts.length===1&&surfaceBody.surface_parts_omitted[0]==='Tall glass'&&X.proposalBox().top-X.proposalBox().base===30&&X.explainCheck(surfaceCheck).includes('1 zero-thickness surface part is excluded')&&X.studySentence(X.proposalBox(),X.planAnalysis()).includes('The compared solid parts are'));
 X.state.imported=importedBefore;
 X.applyHash('#style=context&site=-216.123,338.145&flow=build&fm=point,import,&pm=boxes');
 check('restored import method always exposes the file chooser even when an older link has a mismatched proposal mode',X.state.pmode==='import'&&!$('import-ui').classList.contains('hidden')&&$('file-import').getBoundingClientRect().width>0);
 X.applyHash(rotationStart);
 X.flowGo('view');X.chooseMethod('view','street');
 check('street method opens road plan and offers nearby viewpoints',X.state.tool==='street'&&X.state.mode==='plan'&&$('street-nearby').querySelectorAll('button').length>0);
 $('street-nearby').querySelector('button').click();
 check('street choice creates an observer at ground plus eye height',X.state.observerSource==='street'&&X.state.mode==='observer'&&Math.abs(X.observerEye()[2]-X.landZAt(X.state.observer.x,X.state.observer.y)-1.6)<0.01);
 check('street viewpoint is outside proposal and existing building geometry',X.usableStreetPoint(X.state.observer));
 const start={...X.state.observer},look={...X.state.cams.observer};
 X.canvas.focus();X.canvas.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));
 check('observer arrow keys move the viewpoint rather than turn the camera',Math.hypot(X.state.observer.x-start.x,X.state.observer.y-start.y)>0.5&&JSON.stringify(X.state.cams.observer)===JSON.stringify(look));
 X.moveObserver('ArrowRight',2);const walked={...X.state.observer};X.applyHash(X.serializeHash());
 check('walked street position and source survive a saved-study round trip',Math.hypot(X.state.observer.x-walked.x,X.state.observer.y-walked.y)<0.01&&X.state.observerSource==='street');
 const beforeInput=JSON.stringify(X.state.observer);$('eye-h').focus();$('eye-h').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true,cancelable:true}));
 check('editing a form does not walk the observer',JSON.stringify(X.state.observer)===beforeInput);
 X.canvas.focus();const beforeLook=JSON.stringify(X.state.observer),beforeYaw=X.state.cams.observer.yaw;X.canvas.dispatchEvent(new KeyboardEvent('keydown',{key:'j',bubbles:true,cancelable:true}));
 check('keyboard look changes direction without changing the viewpoint',JSON.stringify(X.state.observer)===beforeLook&&X.state.cams.observer.yaw>beforeYaw);
 const observer=JSON.stringify(X.state.observer);check('unmapped click leaves observer unchanged',!X.placeStreetObserver(1e8,1e8)&&JSON.stringify(X.state.observer)===observer);
 X.setSceneStyle('context',false);X.state.layers.roads=true;X.renderOnce();const streets=X.streetscapeStats();
 check('Context creates terrain-aware roads and sidewalks',streets?.segments>0&&streets.sidewalkPatches>0&&streets.illustrative===true,streets);
 const traffic=X.trafficRenderInfo();check('Context road material covers the full model instead of a local patch limit',traffic.enabled&&traffic.global?.stats.roadSegments===X.assets.traffic.stats.groundSegments&&traffic.global.stats.roadSegments>50000&&JSON.stringify(traffic.global.bounds)===JSON.stringify(X.assets.streetNetwork.bounds_model_m));
 check('Context ground masks and bridge meshes omit all centre markings',traffic.global.stats.markingSegments===0&&traffic.detail.stats.markingSegments===0&&traffic.deck.markingPatches===0&&streets.markingPatches===0);
 const lineMode=X.state.mode;X.setMode('overview');
 const roadVaos=new Set(['street_network','roads','ext_roads'].map(key=>X.assets.meshes[key]?.vao).filter(Boolean)),roadDraws=[],drawArrays=X.gl.drawArrays;
 try{X.gl.drawArrays=function(mode,...args){if(mode===X.gl.LINES&&roadVaos.has(X.gl.getParameter(X.gl.VERTEX_ARRAY_BINDING)))roadDraws.push(X.state.sceneStyle);return drawArrays.call(this,mode,...args);};for(const style of ['context','collage','night']){X.setSceneStyle(style,false);X.renderOnce();}}
 finally{X.gl.drawArrays=drawArrays;X.setSceneStyle('context',false);X.setMode(lineMode);}
 check('Context omits duplicate road polylines while Plain and Night retain mapped lines',!roadDraws.includes('context')&&roadDraws.includes('collage')&&roadDraws.includes('night'),roadDraws);
 const paving=Object.values(X.pavingSurfaces),pavingLoaded=paving.map(surface=>surface.loaded);
 try{paving.forEach(surface=>surface.loaded=false);X.renderOnce();check('paving renders a complete fallback if either supplied image is unavailable',X.gl.getError()===X.gl.NO_ERROR);}
 finally{paving.forEach((surface,i)=>surface.loaded=pavingLoaded[i]);}
 check('all major mapped bridge names have rendered deck components', ['Burrard Street Bridge','Cambie Street Bridge','Granville Bridge','Lions Gate Bridge'].every(name=>X.assets.traffic.stats.components.some(c=>c.names.includes(name))));
 const legacy=new URLSearchParams(X.serializeHash().slice(1));legacy.set('people','1');legacy.set('layers','labels,roads,people');X.applyHash('#'+legacy);X.renderOnce();
 check('legacy studies cannot restore removed scale figures',!('people' in X.state.layers)&&!('people' in X.streetscapeStats())&&!$('layer-people')&&!new URLSearchParams(X.serializeHash().slice(1)).has('people'));
 check('simplified style has a professional Plain name',X.SCENE_STYLES.collage.name==='Plain'&&document.querySelector('#scene-style option[value="collage"]').textContent==='Plain');
 X.applyHash(X.serializeHash());check('street source and flow survive saved-study round trip',X.state.observerSource==='street'&&X.state.flow.methods.view==='street'&&X.state.mode==='observer');
 for(const style of ['collage','night','context']){X.setSceneStyle(style,false);X.renderOnce();check(style+' renders without WebGL errors',X.gl.getError()===X.gl.NO_ERROR);check(style+' has the correct traffic visibility',X.trafficRenderInfo().enabled===(style==='context'));if(style==='context'){const loaded=X.waterSurface.loaded;try{X.waterSurface.loaded=false;X.renderOnce();check('Context renders without WebGL errors while water texture is unavailable',X.gl.getError()===X.gl.NO_ERROR);}finally{X.waterSurface.loaded=loaded;}}if(style==='context'){const loaded=X.grassSurface.loaded;try{X.grassSurface.loaded=false;X.renderOnce();check('Context renders without WebGL errors while grass texture is unavailable',X.gl.getError()===X.gl.NO_ERROR);}finally{X.grassSurface.loaded=loaded;}}if(style==='context'){const surfaces=Object.values(X.facadeSurfaces),loaded=surfaces.map(surface=>surface.loaded);try{surfaces.forEach(surface=>surface.loaded=false);X.renderOnce();check('Context renders complete facades without optional texture images',X.gl.getError()===X.gl.NO_ERROR);}finally{surfaces.forEach((surface,i)=>surface.loaded=loaded[i]);}}}
 X.flowGo('build');X.setSceneStyle('context',false);const capture=await X.captureScene({mode:'inspect',width:320,height:240,style:'context'});check('Context exports an image',typeof capture.url==='string'&&capture.url.startsWith('data:image/'));
}catch(e){tests.push({name:'exception',pass:false,error:String(e),stack:e.stack});}
finally{if(original)X.applyHash(original);const report=document.createElement('pre');report.id='city-selftest-result';report.hidden=true;report.textContent=JSON.stringify({tests,all_pass:tests.length>0&&tests.every(t=>t.pass)});document.body.appendChild(report);document.title=tests.every(t=>t.pass)?'CITYTEST DONE':'CITYTEST FAIL';}
})();
}
