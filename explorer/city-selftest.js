/* Integration regression for streets, Context and canonical-unit state. ?citytest=1 */
(async function(){
'use strict';
const X=window.__explorer,$=id=>document.getElementById(id),tests=[];
const check=(name,pass,details)=>{tests.push({name,pass:!!pass,...(details?{details}:{})});};let original=null;
try{
 await X.ready;original=X.serializeHash();
 X.applyHash('#style=context&site=-216.123,338.145&parts=120,30,30,0,0,Tower&mode=inspect&flow=build&fm=point,platform,');
 const sourceIds=X.assets.index.columns.osm_id,body=sourceIds.indexOf('w360939772'),cap=sourceIds.indexOf('w360939775'),attachment=sourceIds.indexOf('w360939773');
 check('replacing the tower also removes supported elevated cap and facade pieces',body>=0&&cap>=0&&attachment>=0&&X.isRemoved(body,false)&&X.isRemoved(cap,false)&&X.isRemoved(attachment,false));
 const orphan=sourceIds.indexOf('w360942277'),c=X.assets.index.columns;
 check('unsupported floating source slab is absent from drawing and roof picking',orphan>=0&&c.index_count[orphan]===0&&X.roofZAt(orphan,false,-180,290)===null&&X.assets.modelCleanup.fragments.some(r=>r.osm_id==='w360942277'));
 check('supported tower caps retain geometry for the existing comparison',c.index_count[body]>0&&c.index_count[cap]>0&&c.index_count[attachment]>0&&X.assets.modelCleanup.sourceFilesPreserved);
 const parts=JSON.stringify(X.state.parts);X.setDisplayUnits('ft');
 check('unit toggle changes controls but never geometry',JSON.stringify(X.state.parts)===parts&&$('proposal-units').value==='ft'&&$('parts-list').textContent.includes('Height (ft)'));
 X.setDisplayUnits('mm');const metricHash=X.serializeHash();X.applyHash(metricHash);
 check('display units persist beside metre dimensions',X.state.displayUnits==='mm'&&X.state.parts[0].h===120);
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
 check('all major mapped bridge names have rendered deck components', ['Burrard Street Bridge','Cambie Street Bridge','Granville Bridge','Lions Gate Bridge'].every(name=>X.assets.traffic.stats.components.some(c=>c.names.includes(name))));
 const legacy=new URLSearchParams(X.serializeHash().slice(1));legacy.set('people','1');legacy.set('layers','labels,roads,people');X.applyHash('#'+legacy);X.renderOnce();
 check('legacy studies cannot restore removed scale figures',!('people' in X.state.layers)&&!('people' in X.streetscapeStats())&&!$('layer-people')&&!new URLSearchParams(X.serializeHash().slice(1)).has('people'));
 check('simplified style has a professional Plain name',X.SCENE_STYLES.collage.name==='Plain'&&document.querySelector('#scene-style option[value="collage"]').textContent==='Plain');
 X.applyHash(X.serializeHash());check('street source and flow survive saved-study round trip',X.state.observerSource==='street'&&X.state.flow.methods.view==='street'&&X.state.mode==='observer');
 for(const style of ['collage','night','context']){X.setSceneStyle(style,false);X.renderOnce();check(style+' renders without WebGL errors',X.gl.getError()===X.gl.NO_ERROR);check(style+' has the correct traffic visibility',X.trafficRenderInfo().enabled===(style==='context'));}
 X.flowGo('build');X.setSceneStyle('context',false);const capture=await X.captureScene({mode:'inspect',width:320,height:240,style:'context'});check('Context exports an image',typeof capture.url==='string'&&capture.url.startsWith('data:image/'));
}catch(e){tests.push({name:'exception',pass:false,error:String(e),stack:e.stack});}
finally{if(original)X.applyHash(original);const report=document.createElement('pre');report.id='city-selftest-result';report.hidden=true;report.textContent=JSON.stringify({tests,all_pass:tests.length>0&&tests.every(t=>t.pass)});document.body.appendChild(report);document.title=tests.every(t=>t.pass)?'CITYTEST DONE':'CITYTEST FAIL';}
})();
