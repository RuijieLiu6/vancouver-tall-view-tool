/* Opt-in browser verification: ?hovertest=1. No persisted data or model edits. */
(async function () {
  'use strict';
  const X=window.__explorer,U=window.VistaImagineCity,H=window.VistaImagineHover,canvas=document.getElementById('gl');
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),checks=[];
  const output=document.createElement('output');output.id='imagine-hover-test-result';output.hidden=true;document.body.appendChild(output);
  function check(name,value,details){checks.push({name,pass:!!value,...(!value&&details?{details}:{})});if(!value)throw Error(name);}
  async function settled(){for(let i=0;i<1200;i++){if(U.getState().loaded&&!U.getState().calculating){await sleep(60);return;}await sleep(50);}throw Error('Imagine load timeout');}
  function event(type,p={}){canvas.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:271,pointerType:'mouse',buttons:0,...p}));}
  function spot(){const r=canvas.getBoundingClientRect();for(const fy of [.48,.58,.68,.38,.78])for(const fx of [.52,.42,.62,.32,.72]){const x=r.left+r.width*fx,y=r.top+r.height*fy,hit=X.pickImagineBuildingAt(x,y);if(hit)return{x,y,hit};}throw Error('No visible test building');}
  async function hover(p){event('pointermove',{clientX:p.x,clientY:p.y});await sleep(160);return H.getState();}
  function expected(hit){const b=U.getHoverBuilding(hit);return b.assemblySize>1?b.targetAssemblyHeightM:b.targetHeightM;}
  try{
    await X.ready;if(!U.getState().open)U.open();await settled();
    if(new URLSearchParams(location.search).get('imagine40test')==='1'||new URLSearchParams(location.search).get('imagine41test')==='1'){
      const saved=JSON.stringify({mode:X.state.mode,cams:X.state.cams,observer:X.state.observer,parts:X.state.parts,site:X.state.site}),select=document.getElementById('imagine-city-viewpoint');
      const points=X.listImagineViewpoints();check('All 24 location-first options remain available',points.length===24&&Array.from(select.options).filter(option=>option.value).every(option=>option.textContent.startsWith(points.find(p=>p.id===option.value).name)));
      X.setImagineCameraMode('overview');await sleep(100);
      const marker=Array.from(document.querySelectorAll('.imagine-city-origin')).find(n=>!n.hidden);
      check('Map marker uses a bold location and smaller number',!!marker&&getComputedStyle(marker.querySelector('strong')).fontWeight==='700'&&parseFloat(getComputedStyle(marker.querySelector('small')).fontSize)<parseFloat(getComputedStyle(marker.querySelector('strong')).fontSize));
      for(const id of ['3.2.1','28']){
        select.value=id;select.dispatchEvent(new Event('change',{bubbles:true}));await sleep(120);
        const camera=X.getImagineCameraState(),render=X.imagineCityRenderState();
        check('Selected observer renders one frame: '+id,render.observerFrameRendered&&render.observerFrameSelectedId===id&&camera.selectedId===id);
        check('Observer hides every blue cone volume: '+id,render.allConeOverlayVisible===false);
        check('Frame vertical extent is explicitly reconstructed: '+id,camera.protectedFrame.officialVerticalBoundary===false&&camera.protectedFrame.upperStatus.includes('Display-only'));
        const cap=document.getElementById('view-caption');check('Observer caption gives location priority: '+id,cap.querySelector('strong')?.textContent===points.find(p=>p.id===id).name&&cap.querySelector('small')?.textContent==='View '+id);
        check('Observer retains mountain context: '+id,render.mountainBackdropDrawn);
      }
      if(new URLSearchParams(location.search).get('imagine41test')==='1'){
        check('No extra View from here confirmation',!document.getElementById('imagine-city-view-from'));
        const navigation=document.getElementById('imagine-city-view-navigation'),previous=document.getElementById('imagine-city-view-previous'),next=document.getElementById('imagine-city-view-next'),available=points.filter(p=>p.available),uploads=X.imagineCityRenderState().uploads;
        check('Both arrow controls are visible in Observer',!navigation.hidden&&!previous.disabled&&!next.disabled&&previous.querySelector('svg')&&next.querySelector('svg'));
        select.value=available[0].id;select.dispatchEvent(new Event('change',{bubbles:true}));await sleep(80);
        previous.focus();previous.click();await sleep(80);check('Previous wraps to final viewpoint and keeps button focus',X.getImagineCameraState().selectedId===available.at(-1).id&&document.activeElement===previous);
        next.focus();next.click();await sleep(80);check('Next wraps to first viewpoint',X.getImagineCameraState().selectedId===available[0].id&&document.activeElement===next);
        next.click();await sleep(80);check('Next selects the next available protected view',X.getImagineCameraState().selectedId===available[1].id&&select.value===available[1].id);
        check('Cycling does not recalculate the city',X.imagineCityRenderState().uploads===uploads);
      }
      const eye=X.getImagineCameraState().observerPosition.slice();canvas.focus();canvas.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));await sleep(60);canvas.dispatchEvent(new KeyboardEvent('keyup',{key:'ArrowRight',bubbles:true}));
      check('Looking preserves the protected observer location',X.getImagineCameraState().observerPosition.every((v,i)=>v===eye[i]));
      document.getElementById('imagine-city-cones').click();await sleep(80);check('Frame toggle hides the outline',!X.imagineCityRenderState().observerFrameRendered&&U.getState().showCones===false);
      document.getElementById('imagine-city-return-city').click();await sleep(100);check('City respects hidden-overlay preference',!X.imagineCityRenderState().allConeOverlayVisible);
      if(new URLSearchParams(location.search).get('imagine41test')==='1')check('Observer navigation hides in City and chooser resets',document.getElementById('imagine-city-view-navigation').hidden&&select.value==='');
      document.getElementById('imagine-city-cones').click();await sleep(100);check('City restores all cone volumes when enabled',X.imagineCityRenderState().allConeOverlayVisible);
      const stats=U.getState().stats;check('Scope preserves surrounding context and small footprints',stats.eligibleBuildings>0&&stats.outsideVancouverBuildings>0&&stats.smallFootprintContextBuildings>0&&stats.preservedContextBuildings+stats.eligibleBuildings===stats.buildingCount);
      check('Only two comparison choices are prominent',document.querySelector('.imagine-city-options').children.length===2&&!document.getElementById('imagine-city-methods').open);
      const samples={};for(const asset of ['buildings','ext_buildings']){const count=(asset==='buildings'?X.assets.index:X.assets.extIndex)?.count||0;for(let index=0;index<count;index++){const b=U.getHoverBuilding({asset,index});if(['outside-vancouver','small-footprint','outside-mapped-corridors'].includes(b.preservationReason)&&!samples[b.preservationReason])samples[b.preservationReason]={asset,index,original:b.existingHeightM};if(Object.keys(samples).length===3)break;}if(Object.keys(samples).length===3)break;}
      for(const scenario of ['zoning','views']){U.setScenario(scenario);await settled();for(const [reason,sample] of Object.entries(samples)){const b=U.getHoverBuilding(sample);check('Original height retained in '+scenario+': '+reason,b.contextPreserved&&b.scale===1&&Math.abs(b.targetHeightM-sample.original)<1e-4&&!b.minimumApplied);}}
      check('All three context cases were checked',Object.keys(samples).length===3);
      check('View changes preserve the study',saved===JSON.stringify({mode:X.state.mode,cams:X.state.cams,observer:X.state.observer,parts:X.state.parts,site:X.state.site}));
      select.value='3.2.1';select.dispatchEvent(new Event('change',{bubbles:true}));await sleep(100);
      const report={pass:true,checks,render:X.imagineCityRenderState(),camera:X.getImagineCameraState()};output.textContent=JSON.stringify(report);console.info('Imagine protected-frame selftest',report);return;
    }
    if(new URLSearchParams(location.search).get('imagine39test')==='1'){
      const saved=JSON.stringify({mode:X.state.mode,cams:X.state.cams,observer:X.state.observer,viewpoint:X.state.viewpoint,parts:X.state.parts,site:X.state.site}),points=X.listImagineViewpoints();
      check('All protected viewpoints are listed',points.length===24);
      const chosen=points.find(p=>p.id==='3.2.1'&&p.available)||points.find(p=>p.available);
      const select=document.getElementById('imagine-city-viewpoint');select.value=chosen.id;select.dispatchEvent(new Event('change',{bubbles:true}));await sleep(100);
      const camera=X.getImagineCameraState();check('Choosing a location enters the protected observer directly',camera.mode==='observer'&&camera.selectedId===chosen.id);
      check('Observer eye matches modelled view-surface origin',camera.observerPosition.every((v,i)=>Math.abs(v-chosen.observerPosition[i])<1e-6));
      check('Old study observer controls stay hidden',getComputedStyle(document.getElementById('observer-controls')).display==='none');
      check('Observer has a mountain backdrop',X.imagineCityRenderState().mountainBackdropDrawn===true);
      document.getElementById('imagine-city-return-city').click();await sleep(100);
      check('Return to City keeps Imagine active',X.getImagineCameraState().mode==='overview'&&U.getState().open);
      check('Viewpoint navigation preserves study state',saved===JSON.stringify({mode:X.state.mode,cams:X.state.cams,observer:X.state.observer,viewpoint:X.state.viewpoint,parts:X.state.parts,site:X.state.site}));
      check('Default minimum is an explicit 5m assumption',U.getState().minimumHeightM===5&&U.getState().stats.minimumRaisedBuildings>0);
      let minimum=null;for(const asset of ['buildings','ext_buildings']){const count=(asset==='buildings'?X.assets.index:X.assets.extIndex)?.count||0;for(let index=0;index<count;index++){const b=U.getHoverBuilding({asset,index});if(b?.minimumApplied){minimum={asset,index,value:b};break;}}if(minimum)break;}
      check('An affected building retains at least 5m',minimum&&minimum.value.targetAssemblyHeightM>=5);
      check('Minimum source is not presented as a regulation',U.describeHeightControl(minimum.value).includes('not a regulation'));
      check('A lower view allowance is identified as a conflict',minimum.value.minimumConflictsView&&minimum.value.viewAllowanceM<5&&minimum.value.clearanceM<.10001);
      const input=document.getElementById('imagine-city-minimum-height'),form=document.getElementById('imagine-city-minimum-form');input.value='6';form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await settled();
      check('Minimum can be changed to 6m',U.getState().minimumHeightM===6&&U.getHoverBuilding(minimum).targetAssemblyHeightM>=6);
      input.value='5';form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await settled();
      check('City view includes mountains',X.imagineCityRenderState().mountainBackdropDrawn===true);
    }
    const originalSelection=JSON.stringify(U.getState().selected),before=X.imagineCityRenderState();let p=spot(),s=await hover(p);
    check('Hover identifies a rendered building',s.visible&&s.asset===p.hit.asset&&s.index===p.hit.index);
    check('Displayed height matches scenario geometry',Math.abs(s.heightM-expected(p.hit))<1e-5);
    if(new URLSearchParams(location.search).get('imagine39test')==='1'){
      const tip=document.getElementById('imagine-city-hover'),color=getComputedStyle(tip).backgroundColor;
      check('Hover background is 75 percent transparent',color.includes('0.25')&&getComputedStyle(tip).opacity==='1');
      check('Hover names its actual height control',s.heightControl===U.describeHeightControl(U.getHoverBuilding(p.hit)));
    }
    check('Hover preserves clicked selection',JSON.stringify(U.getState().selected)===originalSelection);
    check('Hover does not reupload or calculate city',X.imagineCityRenderState().uploads===before.uploads);
    const picks=[];for(let i=0;i<10;i++){X.pickImagineBuildingAt(p.x,p.y);picks.push(X.imagineCityRenderState().lastPickMs);}
    event('pointerleave');check('Pointer leave dismisses label',!H.getState().visible);
    event('pointermove',{clientX:p.x,clientY:p.y,pointerType:'touch'});await sleep(120);check('Touch does not show a hover label',!H.getState().visible);
    await hover(p);event('pointerdown',{clientX:p.x,clientY:p.y,buttons:1});check('Pointer contact hides hover before a drag',!H.getState().visible);event('pointercancel');
    for(const scenario of ['existing','zoning','views']){U.setScenario(scenario);check('Scenario change clears stale height: '+scenario,!H.getState().visible);await settled();p=spot();s=await hover(p);check('Correct height in '+scenario,s.visible&&Math.abs(s.heightM-expected(p.hit))<1e-5,{hover:s,expected:expected(p.hit),point:p,pick:X.imagineCityRenderState()});}
    for(const style of ['collage','night','context']){X.setSceneStyle(style);await sleep(80);p=spot();s=await hover(p);check('Hover works in '+style,s.visible);}
    canvas.focus();document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));check('Escape dismisses hover',!H.getState().visible&&U.getState().open);
    p=spot();await hover(p);X.setImagineCameraMode('plan');await sleep(80);check('Camera change clears stale hover',!H.getState().visible);X.setImagineCameraMode('overview');await sleep(80);
    U.close();check('Exit releases the pick index',X.imagineCityRenderState().pickRows===0);U.open();await settled();p=spot();await hover(p);
    const report={pass:true,checks,pick:X.imagineCityRenderState(),pickSamplesMs:picks,hover:H.getState(),point:p};
    output.textContent=JSON.stringify(report);console.info('Imagine hover selftest',report);
  }catch(error){const report={pass:false,error:error.message,checks};output.hidden=false;output.textContent=JSON.stringify(report);console.error('Imagine hover selftest',report);}
})();
