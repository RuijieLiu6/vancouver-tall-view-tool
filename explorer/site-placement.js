/* Map actions are temporary until the user confirms a project site. */
(function (global) {
  'use strict';
  const document = global.document;
  let host = {}, root = null, ui = {}, serial = 0, retryAction = null;
  let state = empty();
  function empty() { return {phase:'idle',mode:null,point:null,screen:null,parcels:[],polygons:[],actualPolygons:[],outline:null,error:'',heightM:null,pointerValid:true}; }
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const finitePoint = (x,y) => Number.isFinite(x) && Number.isFinite(y);
  const available = () => !host.isAvailable || host.isAvailable();
  function polygons(value) {
    if (!Array.isArray(value) || !value.length) return [];
    if (typeof value[0]?.[0] === 'number') return [[value]];
    if (typeof value[0]?.[0]?.[0] === 'number') return [value];
    if (typeof value[0]?.[0]?.[0]?.[0] === 'number') return value;
    return [];
  }
  function validPolygons(value) {
    const result = polygons(value);
    return result.length > 0 && result.every(p => p.length && p.every(r => r.length >= 3 && r.every(q => finitePoint(q[0],q[1]))));
  }
  function getPreview() {
    if (state.phase === 'idle' || !state.polygons.length) return null;
    return clone({phase:state.phase,mode:state.mode,point:state.point,polygons:state.polygons,polygon:state.polygons[0]?.[0] || [],actualPolygons:state.actualPolygons,parcels:state.parcels,presetHeightM:state.heightM,pointerValid:state.pointerValid,pending:true});
  }
  function changed(focusId) {
    render();
    host.previewChanged?.(getPreview());
    if (focusId) ui[focusId]?.focus();
  }
  function cancel() {
    if (state.phase === 'idle') return false;
    serial++; state = empty(); retryAction = null; changed();
    document.getElementById('gl')?.focus();
    return true;
  }
  function button(id,label,action,primary) {
    const node = document.createElement('button'); node.id = 'site-placement-' + id;
    node.type = 'button'; node.className = 'site-placement-button' + (primary ? ' is-primary' : '');
    node.textContent = label; node.addEventListener('click', action); ui[id] = node; return node;
  }
  function make(tag,text,className) { const node=document.createElement(tag); if(text)node.textContent=text;if(className)node.className=className;return node; }
  function mount() {
    if (root) return true;
    const parent=document.getElementById('viewport') || document.getElementById('gl')?.parentElement;
    if (!parent) return false;
    root=make('section','','site-placement');root.id='site-placement-actions';root.hidden=true;
    root.setAttribute('aria-labelledby','site-placement-title');root.setAttribute('aria-label','Project site actions');
    for(const name of ['pointerdown','click','dblclick'])root.addEventListener(name,e=>e.stopPropagation());
    parent.appendChild(root);return true;
  }
  function position() {
    if (!root) return;
    const parent=root.parentElement, width=parent?.clientWidth || 800, height=parent?.clientHeight || 600;
    const x=state.screen?.x ?? width/2, y=state.screen?.y ?? Math.min(height/2,180);
    root.style.left=Math.max(12,Math.min(x+14,width-352))+'px';
    root.style.top=Math.max(70,Math.min(y+14,height-330))+'px';
  }
  function render() {
    if (!mount()) return;
    root.hidden=state.phase==='idle'; if(root.hidden)return;
    root.setAttribute('data-phase',state.phase);root.setAttribute('aria-busy',String(state.phase==='loading'||state.phase==='committing'));
    ui={};root.replaceChildren();position();
    const header=make('div','','site-placement-head'), title=make('h3','',''); title.id='site-placement-title';
    header.appendChild(title);header.appendChild(button('cancel','Cancel',cancel));root.appendChild(header);
    const description=make('p','','site-placement-description');root.appendChild(description);
    const actions=make('div','','site-placement-buttons');
    const add=(id,label,fn,primary)=>actions.appendChild(button(id,label,fn,primary));
    if(state.phase==='choice') {
      title.textContent='Use this location';description.textContent='Choose how to define your project site.';
      add('replace','Replace',()=>startParcelMode('replace'),false);
      add('place','Place',startPlace,false);
      add('combine','Combine',()=>startParcelMode('combine'),false);
      const detail=make('p','Replace an actual parcel, position a preset massing, or select several parcels for one study.','site-placement-note');root.appendChild(detail);
    } else if(state.phase==='loading') {
      title.textContent=state.mode==='combine'?'Select parcels':'Find the nearest parcel';
      description.textContent='Loading public parcel outlines…';description.setAttribute('role','status');
    } else if(state.phase==='replace') {
      title.textContent='Replace this parcel?';
      description.textContent='The highlighted outline is an actual mapped parcel. Confirm this project boundary before proceeding.';
      parcelSummary();add('confirm','Use this parcel',commit,true);
    } else if(state.phase==='place') {
      title.textContent='Position your massing';description.textContent='Move over the map to position the translucent footprint. Click the map to review its location.';
      add('review','Review this location',reviewPlace,true);
      ui.review.disabled=!state.pointerValid;
    } else if(state.phase==='place-review') {
      title.textContent='Place the massing here?';description.textContent='The highlighted footprint becomes your project site after confirmation.';
      add('confirm','Confirm placement',commit,true);add('reposition','Keep positioning',()=>{state.phase='place';changed();});
    } else if(state.phase==='combine') {
      title.textContent='Select parcels to combine';description.textContent='Click actual parcels to add or remove them. Each selected parcel stays highlighted.';
      parcelSummary();add('review','Review project boundary',reviewCombine,true);ui.review.disabled=state.parcels.length<2;
    } else if(state.phase==='combine-review') {
      title.textContent='Use this project boundary?';description.textContent=state.outline?.label || 'Continuous hypothetical study boundary';
      parcelSummary();add('confirm','Confirm project site',commit,true);
      add('edit','Edit parcel selection',()=>{state.phase='combine';state.polygons=state.actualPolygons;changed();});
      if(host.beginDrawBoundary)add('draw','Draw a partial boundary',drawPartial);
    } else if(state.phase==='committing') {
      title.textContent='Apply project site';description.textContent='Applying your confirmed boundary…';description.setAttribute('role','status');ui.cancel.disabled=true;
    } else if(state.phase==='error') {
      title.textContent='Site selection needs attention';description.textContent=state.error;description.setAttribute('role','alert');
      if(retryAction)add('retry','Try again',()=>retryAction(),true);
      add('choose','Choose another action',()=>{serial++;state.phase='choice';state.mode=null;state.error='';state.polygons=[];state.actualPolygons=[];state.parcels=[];changed();});
    }
    root.appendChild(actions);
    if(['replace','combine','combine-review','place-review'].includes(state.phase))root.appendChild(make('p',state.mode==='combine'?'Project boundary · may include streets; not a legal parcel merger.':'Existing context changes only after confirmation. Clear the site or show existing context to restore the view.','site-placement-note'));
    function parcelSummary(){const count=state.parcels.length;const summary=make('p',count===1?'1 actual parcel selected':count+' actual parcels selected','site-placement-count');summary.setAttribute('aria-live','polite');root.appendChild(summary);}
  }
  function fail(error, retry) {
    state.phase='error';state.error=error?.message || 'Parcel outlines are unavailable. Try again or choose another action.';retryAction=retry;changed('retry');
  }
  async function pickAt(point) {
    if(!host.pickParcel)throw Error('Parcel outlines are unavailable. Try again after the map finishes loading.');
    await host.ensureParcels?.();
    return await host.pickParcel(point[0],point[1]);
  }
  function normalizePick(pick) {
    if(!pick)return null;
    const parcel=pick.parcel || pick, shape=polygons(pick.polygons || parcel.polygons || parcel.polygon);
    if(!validPolygons(shape))return null;
    return {...parcel,id:pick.id ?? parcel.id,polygons:clone(shape)};
  }
  async function startParcelMode(mode) {
    state.mode=mode;state.parcels=[];state.polygons=[];state.actualPolygons=[];state.outline=null;state.heightM=null;
    await selectAt(state.point, true);
  }
  async function selectAt(point,first) {
    const token=++serial, previous=clone(state.parcels), mode=state.mode;
    state.phase='loading';state.error='';changed();
    try {
      const parcel=normalizePick(await pickAt(point));if(token!==serial)return false;if(!available()){cancel();return false;}
      if(!parcel)throw Error('No actual parcel was found near this location. Choose another location, or use Place.');
      state.point=clone(point);
      if(mode==='replace')state.parcels=[parcel];
      else {const index=previous.findIndex(p=>String(p.id)===String(parcel.id));if(index>=0)previous.splice(index,1);else previous.push(parcel);state.parcels=previous;}
      state.actualPolygons=state.parcels.flatMap(p=>p.polygons);state.polygons=clone(state.actualPolygons);state.phase=mode;
      changed(first ? (mode==='replace'?'confirm':null) : null);return true;
    } catch(error) {if(token===serial)fail(error,()=>selectAt(point,first));return false;}
  }
  function fallbackPreset(point) {
    const parts=global.__explorer?.state?.parts || [];
    return {polygons:parts.filter(p=>p.w>0&&p.d>0).map(p=>{
      const angle=(Number(p.rotation)||0)*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle),cx=point[0]+(Number(p.dx)||0),cy=point[1]+(Number(p.dy)||0);
      return [[[-p.w/2,-p.d/2],[p.w/2,-p.d/2],[p.w/2,p.d/2],[-p.w/2,p.d/2]].map(q=>[cx+q[0]*c+q[1]*s,cy-q[0]*s+q[1]*c])];
    }),heightM:parts.reduce((height,p)=>height+(Number(p.h)||0),0)};
  }
  function updatePreset(point) {
    const result=host.getPreset ? host.getPreset(point[0],point[1]) : fallbackPreset(point);
    const shape=polygons(result?.polygons || result?.polygon || result);
    if(!validPolygons(shape))throw Error('Choose a preset massing before placing it on the map.');
    state.point=point;state.polygons=clone(shape);state.heightM=Number.isFinite(result?.heightM)?result.heightM:null;state.pointerValid=true;
  }
  function startPlace() {
    serial++;state.mode='place';state.parcels=[];state.actualPolygons=[];state.outline=null;
    try{updatePreset(state.point);state.phase='place';changed();}catch(error){fail(error,startPlace);}
  }
  function reviewPlace() { if(state.phase!=='place'||!state.pointerValid)return false;state.phase='place-review';changed('confirm');return true; }
  async function reviewCombine() {
    if(state.phase!=='combine'||state.parcels.length<2)return false;
    const token=++serial;state.phase='loading';changed();
    try {
      if(!host.combineParcels)throw Error('The project boundary could not be prepared. Try again.');
      const outline=await host.combineParcels(clone(state.parcels));if(token!==serial)return false;if(!available()){cancel();return false;}
      const shape=polygons(outline?.polygons || outline?.polygon);
      if(!validPolygons(shape)||shape.length!==1)throw Error('These parcels do not form one continuous project boundary. Choose adjoining parcels or draw a boundary.');
      state.outline=clone(outline);state.polygons=clone(shape);state.phase='combine-review';changed('confirm');return true;
    }catch(error){if(token===serial)fail(error,()=>{state.phase='combine';return reviewCombine();});return false;}
  }
  function payload() {
    return clone({mode:state.mode,point:state.point,polygon:state.polygons[0]?.[0]||[],polygons:state.polygons,parcels:state.parcels,sourceLabel:state.outline?.label|| (state.mode==='replace'?'Actual mapped parcel':'Preset massing footprint'),hypothetical:state.mode==='combine',outline:state.outline});
  }
  async function commit() {
    if(!['replace','place-review','combine-review'].includes(state.phase))return false;
    if(!available()){cancel();return false;}
    const data=payload(),previousPhase=state.phase,token=++serial;
    if(!host.commitSite){fail(Error('The map is not ready to apply this site. Try again.'),()=>{state.phase=previousPhase;return commit();});return false;}
    state.phase='committing';changed();
    try {
      const result=await host.commitSite(data);if(token!==serial)return false;
      if(result===false)throw Error('This location could not be applied. Review the boundary and try again.');
      state=empty();retryAction=null;changed();document.getElementById('gl')?.focus();return true;
    }catch(error){if(token===serial)fail(error,()=>{state.phase=previousPhase;return commit();});return false;}
  }
  function drawPartial() {
    if(state.phase!=='combine-review'||!host.beginDrawBoundary)return false;
    if(!available()){cancel();return false;}
    const data=payload();const result=host.beginDrawBoundary(data);if(result===false)return false;
    serial++;state=empty();retryAction=null;changed();return true;
  }
  function requestAt(x,y,screen) {
    if(!available())return false;
    if(!finitePoint(x,y)||host.validatePoint?.(x,y)===false){if(state.phase==='place')invalidatePointer();return false;}
    if(state.phase==='committing')return true;
    if(state.phase==='place'){try{updatePreset([x,y]);reviewPlace();}catch(error){fail(error,startPlace);}return true;}
    if(state.phase==='combine'){selectAt([x,y],false);return true;}
    if(state.phase==='loading')return true;
    serial++;state=empty();state.phase='choice';state.point=[x,y];state.screen=screen&&finitePoint(screen.x,screen.y)?{x:screen.x,y:screen.y}:null;changed('replace');return true;
  }
  function pointerPreview(x,y) {
    if(state.phase!=='place')return false;
    if(!available()){cancel();return false;}
    if(!finitePoint(x,y)||host.validatePoint?.(x,y)===false){invalidatePointer();return false;}
    try{updatePreset([x,y]);if(ui.review)ui.review.disabled=false;host.previewChanged?.(getPreview());return true;}catch(error){fail(error,startPlace);return false;}
  }
  function invalidatePointer(){state.pointerValid=false;if(ui.review)ui.review.disabled=true;host.previewChanged?.(getPreview());}
  function configure(nextHost) {host=nextHost||{};mount();return api;}
  const api={configure,requestAt,pointerPreview,cancel,getPreview,isPending:()=>state.phase!=='idle',getState:()=>clone(state)};
  global.VistaSitePlacement=api;
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&state.phase!=='idle'&&state.phase!=='committing'){event.preventDefault();event.stopPropagation();cancel();}},true);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount);else mount();
})(window);
