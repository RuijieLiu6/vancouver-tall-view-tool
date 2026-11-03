/* Real app-owned Imagine loading, camera and targeted edit benchmark. ?imagineperf=1 */
(async function(){
'use strict';
const tests=[],check=(name,pass,details)=>tests.push({name,pass:!!pass,...(details===undefined?{}:{details})}),$=id=>document.getElementById(id),pause=ms=>new Promise(r=>setTimeout(r,ms)),frame=()=>new Promise(r=>requestAnimationFrame(r));
let timer,last=performance.now(),maxGap=0,ticks=0,original=null,editedId=null,upperBefore=null,upperParcel=null,viewBefore=null,viewParcel=null;
try{
 timer=setInterval(()=>{const t=performance.now();maxGap=Math.max(maxGap,t-last);last=t;ticks++;},20);
 const start=performance.now();await VistaImagine.open();const info=VistaImagine.getInfo();
 check('cold/open path uses stored parcel facts without classifying the city',info.loaded&&info.classified&&info.precomputed&&info.classificationsRun===0,info);
 check('load keeps every parcel polygon lazy until it is inspected',info.geometryDecoded===0,{geometryDecoded:info.geometryDecoded});
 check('retained WebGL map compiles and renders the actual full-city geometry',info.renderer.backend==='webgl2'&&info.renderer.roofTriangles>400000,info.renderer);
 const times=[];let before=performance.now();for(let i=0;i<24;i++){const canvas=$('imagine-canvas');canvas.dispatchEvent(new KeyboardEvent('keydown',{key:i%2?'ArrowRight':'ArrowLeft',bubbles:true,cancelable:true}));await frame();const t=performance.now();times.push(t-before);before=t;}
 $('imagine-iso').click();await frame();await frame();const after=VistaImagine.getInfo();
 check('camera moves and 3D toggle keep the original GPU geometry buffers',after.renderer.geometryUploads===4&&after.drawCount>10&&after.classificationsRun===0,{renderer:after.renderer,drawCount:after.drawCount,frameIntervalsMs:times.map(n=>Math.round(n)),totalOpenMs:performance.now()-start});
 if(new URLSearchParams(location.search).get('rotationcheck')==='1'){
   const initial=VistaImagine.getInfo(),canvas=$('imagine-canvas');
   const key=value=>canvas.dispatchEvent(new KeyboardEvent('keydown',{key:value,bubbles:true,cancelable:true}));
   key('e');await frame();
   check('keyboard rotation changes the camera yaw',Math.abs(VistaImagine.getInfo().azimuth-initial.azimuth-Math.PI/12)<1e-8,VistaImagine.getInfo());
   $('imagine-tilt').value='60';$('imagine-tilt').dispatchEvent(new Event('input',{bubbles:true}));await frame();
   check('tilt slider updates the camera and its visible value',Math.abs(VistaImagine.getInfo().elevation-Math.PI/3)<1e-8&&$('imagine-tilt-value').textContent==='60°');
   key('q');await frame();
   check('opposite keyboard rotation restores the camera yaw',Math.abs(VistaImagine.getInfo().azimuth-initial.azimuth)<1e-8);
   const touch=$('imagine-touch-action');touch.value='pan';touch.dispatchEvent(new Event('change',{bubbles:true}));
   check('touch users can select one-finger movement',VistaImagine.getInfo().dragAction==='pan'&&touch.value==='pan');
   touch.value='rotate';touch.dispatchEvent(new Event('change',{bubbles:true}));
   check('touch users can restore one-finger skyline rotation',VistaImagine.getInfo().dragAction==='rotate'&&touch.value==='rotate');
   key('t');await frame();
   check('keyboard tilt increases the camera elevation',Math.abs(VistaImagine.getInfo().elevation-Math.PI/3-Math.PI/36)<1e-8);
   key('g');$('imagine-tilt').value=String(initial.elevation*180/Math.PI);$('imagine-tilt').dispatchEvent(new Event('input',{bubbles:true}));await frame();
   $('imagine-plan').click();await frame();const plan=VistaImagine.getInfo();key('e');await frame();
   check('plan view stays north-up and hides orbit controls',$('imagine-orbit').hidden&&VistaImagine.getInfo().mode==='plan'&&VistaImagine.getInfo().azimuth===plan.azimuth);
   $('imagine-iso').click();await frame();const restored=VistaImagine.getInfo();
   check('camera and touch controls preserve geometry and parcel classifications',Math.abs(restored.azimuth-initial.azimuth)<1e-8&&restored.renderer.geometryUploads===initial.renderer.geometryUploads&&restored.renderer.heightUploads===initial.renderer.heightUploads&&restored.classificationsRun===initial.classificationsRun,restored.renderer);
 }
 $('imagine-centre').click();await frame();editedId=VistaImagine.getInfo().selectedParcel;if(!editedId)throw new Error('No centre parcel selected');original=VistaImagine.getParcel(editedId);
 check('parcel retrieval returns stored sourced data by persistent ID',original?.id===editedId&&Array.isArray(original.viewIds),original);
 const geometryUploads=VistaImagine.getInfo().renderer.geometryUploads,textureUploads=VistaImagine.getInfo().renderer.heightUploads;
 $('imagine-height').value='42.5';$('imagine-height-form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await frame();await frame();
 const changed=VistaImagine.getParcel(editedId),edited=VistaImagine.getInfo();
 check('height form changes just its parcel study record and one texture texel',changed.studyHeightM===42.5&&changed.zoningHeightM===original.zoningHeightM&&edited.scenario==='study'&&edited.renderer.geometryUploads===geometryUploads&&edited.renderer.heightUploads===textureUploads+1&&edited.classificationsRun===0,{changed,renderer:edited.renderer});
 $('imagine-zoning').click();await frame();check('source zoning scenario remains available after a hypothetical edit',VistaImagine.getInfo().scenario==='zoning'&&VistaImagine.getParcel(editedId).zoningHeightM===original.zoningHeightM);
 $('imagine-combined').click();await frame();check('view scenario keeps unresolved source uncertainty',VistaImagine.getParcel(editedId).viewHeightUnknown===original.viewHeightUnknown);
 VistaImagine.setParcelHeight(editedId,original.studyHeightM);await frame();
 check('reset restores the prior study record without changing source data',VistaImagine.getParcel(editedId).studyHeightM===original.studyHeightM&&VistaImagine.getParcel(editedId).zoningHeightM===original.zoningHeightM);
 check('loading and interaction keep the event loop alive',ticks>5&&maxGap<1500,{ticks,maxGapMs:Math.round(maxGap)});
 if(new URLSearchParams(location.search).get('uppercheck')==='1'){
   upperBefore=VistaImagine.getInfo().upperAssumption;
   upperParcel=VistaImagine.getParcel('pea40d975e1936598');
   if(!upperParcel||upperParcel.zoningHeightM!==null)throw new Error('Missing-height snapshot fixture changed');
   const uploads=VistaImagine.getInfo().renderer;
   VistaImagine.setUpperAssumption({enabled:true,heightM:213.36});
   $('imagine-search').value=upperParcel.id;$('imagine-search-form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await frame();
   const assumed=VistaImagine.getParcel(upperParcel.id);
   check('missing parcel has a labelled upper assumption while zoning stays null',assumed.assumedHeightM===213.36&&assumed.zoningHeightM===null&&assumed.assumptionOrigin==='policy-benchmark-scenario'&&$('imagine-parcel').textContent.includes('Assumed upper height'),assumed);
   $('imagine-assumed-height').value='180';$('imagine-assumption-form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await frame();
   check('custom upper-height form changes only the study assumption and its provenance',VistaImagine.getParcel(upperParcel.id).assumedHeightM===180&&VistaImagine.getParcel(upperParcel.id).assumptionOrigin==='user-assumption');
   $('imagine-assume').checked=false;$('imagine-assume').dispatchEvent(new Event('change',{bubbles:true}));await frame();
   check('turning fill off restores unresolved study height',VistaImagine.getParcel(upperParcel.id).effectiveStudyHeightM===null&&$('imagine-assumed-legend').hidden);
   VistaImagine.setUpperAssumption({enabled:true,heightM:213.36});VistaImagine.setParcelHeight(upperParcel.id,60);await frame();
   check('individual parcel edit overrides the global assumption',VistaImagine.getParcel(upperParcel.id).effectiveStudyHeightM===60&&VistaImagine.getParcel(upperParcel.id).assumedHeightM===null);
   VistaImagine.setParcelHeight(upperParcel.id,null);$('imagine-combined').click();await frame();
   check('regulatory scenario retains unknown zoning and view facts',VistaImagine.getInfo().scenario==='combined'&&VistaImagine.getParcel(upperParcel.id).zoningHeightM===null&&VistaImagine.getParcel(upperParcel.id).viewHeightUnknown===upperParcel.viewHeightUnknown);
   const end=VistaImagine.getInfo();
   check('global assumption changes use uniforms without city geometry uploads or new classification',end.renderer.geometryUploads===uploads.geometryUploads&&end.renderer.heightUploads===uploads.heightUploads+2&&end.classificationsRun===0,{before:uploads,after:end.renderer});
 }
 if(new URLSearchParams(location.search).get('viewcheck')==='1'){
   viewBefore=VistaImagine.getInfo().viewStudy;upperBefore ||= VistaImagine.getInfo().upperAssumption;
   viewParcel=VistaImagine.getParcel('p30d3017e6ccae17f');if(!viewParcel||viewParcel.viewIds.join(',')!=='3.2.1')throw new Error('QE snapshot fixture changed');
   VistaImagine.setUpperAssumption({enabled:true,heightM:213.36});VistaImagine.setParcelHeight(viewParcel.id,null);
   $('imagine-study-ground').value='20';const prepared=VistaImagine.getInfo().renderer;
   $('imagine-view-study-form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await frame();await frame();
   const result=VistaImagine.getParcel(viewParcel.id),city=VistaImagine.getInfo();
   check('whole-city preset calculates only an explicitly assumed view effect',city.viewStudy.enabled&&city.viewStudy.reduced>0&&city.viewStudy.unknown===0,{viewStudy:city.viewStudy});
   check('QE parcel calculation subtracts the assumed base and reports height reduction',Math.abs(result.viewStudy.resultHeightM-104.6)<1e-6&&Math.abs(result.viewStudy.reductionM-108.76)<1e-6&&result.viewStudy.limitingViews.join(',')==='3.2.1',result);
   check('view-only allowance API stays independent of the baseline clipping',Math.abs(result.viewStudy.viewHeightM-104.6)<1e-6&&Math.abs(result.viewStudy.viewMaximumHeightM-104.6)<1e-6,result.viewStudy);
   $('imagine-search').value=viewParcel.id;$('imagine-search-form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await frame();
   check('selected parcel explains the arithmetic and keeps regulatory results unknown',$('imagine-parcel').textContent.includes('104.6 m')&&$('imagine-parcel').textContent.includes('Verified City ceilings remain unknown')&&result.zoningHeightM===null&&result.viewHeightUnknown);
   const priorCount=city.viewStudy.reduced;VistaImagine.setParcelHeight(viewParcel.id,60);await frame();
   check('one parcel edit updates its reduction and city count without a city rebuild',VistaImagine.getParcel(viewParcel.id).viewStudy.reductionM===0&&VistaImagine.getInfo().viewStudy.reduced===priorCount-1);
   const lowerBaseline=VistaImagine.getParcel(viewParcel.id).viewStudy;check('lower baseline clips the displayed height without reducing the view allowance',lowerBaseline.resultHeightM===60&&Math.abs(lowerBaseline.viewMaximumHeightM-104.6)<1e-6,lowerBaseline);
   VistaImagine.setParcelHeight(viewParcel.id,null);VistaImagine.setViewStudy({enabled:true,groundM:21});await frame();
   check('changing the ground assumption recomputes the difference using uniforms',Math.abs(VistaImagine.getParcel(viewParcel.id).viewStudy.resultHeightM-103.6)<1e-6&&VistaImagine.getInfo().renderer.geometryUploads===prepared.geometryUploads&&VistaImagine.getInfo().renderer.viewTextureUploads===prepared.viewTextureUploads&&VistaImagine.getInfo().classificationsRun===0);
   VistaImagine.setViewStudy({enabled:true,groundM:20});
   let csvBlob=null;const createURL=URL.createObjectURL,anchorClick=HTMLAnchorElement.prototype.click;
   try{
     URL.createObjectURL=function(blob){if(blob.type.startsWith('text/csv'))csvBlob=blob;return createURL.call(this,blob);};
     HTMLAnchorElement.prototype.click=function(){if(this.download.startsWith('Vista-Imagine'))return;return anchorClick.call(this);};
     $('imagine-export').click();const deadline=performance.now()+20000;while($('imagine-export').disabled&&performance.now()<deadline)await pause(20);
     if(!csvBlob)throw new Error('View-study CSV was not generated');const csv=await csvBlob.text(),lines=csv.split('\r\n'),parse=line=>(line.match(/"(?:[^"]|"")*"(?=,|$)/g)||[]).map(s=>s.slice(1,-1).replace(/""/g,'"')),header=parse(lines[0].replace(/^\uFEFF/,'')),row=parse(lines.find(line=>line.startsWith('"'+viewParcel.id+'",'))||''),record=Object.fromEntries(header.map((key,i)=>[key,row[i]]));
     check('CSV preserves blank regulatory limits and exports independent view allowance plus baseline reduction',record.zoning_reference_m===''&&record.zoning_plus_views_reference_m===''&&Math.abs(Number(record.view_study_allowance_m)-104.6)<1e-6&&Math.abs(Number(record.view_study_maximum_height_m)-104.6)<1e-6&&Math.abs(Number(record.view_study_height_m)-104.6)<1e-6&&Math.abs(Number(record.view_study_reduction_m)-108.76)<1e-6&&record.view_study_method.includes('horizontal plane at raw observer elevation'),record);
   }finally{URL.createObjectURL=createURL;HTMLAnchorElement.prototype.click=anchorClick;}
   $('imagine-view-study-off').click();await frame();check('baseline button removes the assumed clipping without changing sourced facts',!VistaImagine.getInfo().viewStudy.enabled&&VistaImagine.getParcel(viewParcel.id).effectiveStudyHeightM===213.36&&VistaImagine.getParcel(viewParcel.id).zoningHeightM===null);
 }
 if(new URLSearchParams(location.search).get('deferredcheck')==='1'){
   check('direct Imagine visit defers the independent city model download',!window.__explorer.assets.manifest&&!window.__explorer.assets.ready);
   VistaImagine.close();let deadline;try{await Promise.race([window.__explorer.ready,new Promise((_,reject)=>{deadline=setTimeout(()=>reject(new Error('Deferred city startup timed out')),60000);})]);}finally{clearTimeout(deadline);}
   check('returning to the main viewer starts and completes the city model',window.__explorer.assets.ready&&window.__explorer.getStartupPerformance().facades.length===2,window.__explorer.getStartupPerformance());
   await VistaImagine.open();
 }

}catch(error){tests.push({name:'exception',pass:false,error:String(error),stack:error.stack});}
finally{
 if(editedId&&original)try{VistaImagine.setParcelHeight(editedId,original.studyHeightM);}catch(_){}
 if(upperParcel)try{VistaImagine.setParcelHeight(upperParcel.id,upperParcel.studyHeightM);}catch(_){}
 if(upperBefore)try{VistaImagine.setUpperAssumption(upperBefore);}catch(_){}
 if(viewParcel)try{VistaImagine.setParcelHeight(viewParcel.id,viewParcel.studyHeightM);}catch(_){}
 if(viewBefore)try{VistaImagine.setViewStudy(viewBefore);}catch(_){}
 clearInterval(timer);const pre=document.createElement('pre');pre.id='imagine-performance-result';pre.hidden=true;pre.textContent=JSON.stringify({tests,all_pass:tests.length>0&&tests.every(t=>t.pass),heartbeat:{ticks,maxGapMs:Math.round(maxGap)}});document.body.append(pre);document.title=tests.length&&tests.every(t=>t.pass)?'IMAGINEPERF DONE':'IMAGINEPERF FAIL';
}
})();
