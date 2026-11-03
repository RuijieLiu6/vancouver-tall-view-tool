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
    const originalSelection=JSON.stringify(U.getState().selected),before=X.imagineCityRenderState();let p=spot(),s=await hover(p);
    check('Hover identifies a rendered building',s.visible&&s.asset===p.hit.asset&&s.index===p.hit.index);
    check('Displayed height matches scenario geometry',Math.abs(s.heightM-expected(p.hit))<1e-5);
    check('Hover preserves clicked selection',JSON.stringify(U.getState().selected)===originalSelection);
    check('Hover does not reupload or calculate city',X.imagineCityRenderState().uploads===before.uploads);
    const picks=[];for(let i=0;i<10;i++){X.pickImagineBuildingAt(p.x,p.y);picks.push(X.imagineCityRenderState().lastPickMs);}
    event('pointerleave');check('Pointer leave dismisses label',!H.getState().visible);
    event('pointermove',{clientX:p.x,clientY:p.y,pointerType:'touch'});await sleep(120);check('Touch does not show a hover label',!H.getState().visible);
    await hover(p);event('pointerdown',{clientX:p.x,clientY:p.y,buttons:1});check('Pointer contact hides hover before a drag',!H.getState().visible);event('pointercancel');
    for(const scenario of ['existing','zoning','views']){U.setScenario(scenario);check('Scenario change clears stale height: '+scenario,!H.getState().visible);await settled();p=spot();s=await hover(p);check('Correct height in '+scenario,s.visible&&Math.abs(s.heightM-expected(p.hit))<1e-5,{hover:s,expected:expected(p.hit),point:p,pick:X.imagineCityRenderState()});}
    for(const style of ['collage','night','context']){X.setSceneStyle(style);await sleep(80);p=spot();s=await hover(p);check('Hover works in '+style,s.visible);}
    canvas.focus();document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));check('Escape dismisses hover',!H.getState().visible&&U.getState().open);
    p=spot();await hover(p);const cam=X.state.cams.overview;cam.az+=.01;X.renderOnce();await sleep(80);check('Camera change clears stale hover',!H.getState().visible);
    U.close();check('Exit releases the pick index',X.imagineCityRenderState().pickRows===0);U.open();await settled();p=spot();await hover(p);
    const report={pass:true,checks,pick:X.imagineCityRenderState(),pickSamplesMs:picks,hover:H.getState(),point:p};
    output.textContent=JSON.stringify(report);console.info('Imagine hover selftest',report);
  }catch(error){const report={pass:false,error:error.message,checks};output.hidden=false;output.textContent=JSON.stringify(report);console.error('Imagine hover selftest',report);}
})();
