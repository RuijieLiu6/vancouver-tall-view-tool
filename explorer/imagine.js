/* Independent citywide study. Never writes explorer state, cameras or proposals. */
(function (root) {
  'use strict';
  const CACHE_SCHEMA = 'vista-imagine-public/2-overlap-rings-1';
  const hashPattern = /^[a-f0-9]{64}$/;
  function manifestSpec(value) {
    const asset = a => a && hashPattern.test(a.sha256) && Number.isSafeInteger(a.bytes) && a.bytes > 0;
    if (value?.version !== 1 || !asset(value.policy) || !asset(value.parcels) || !value.cones ||
        !hashPattern.test(value.cones.sha256) || typeof value.cones.canonicalJson !== 'string' ||
        typeof value.cones.available !== 'boolean') return null;
    return {...value,key:[CACHE_SCHEMA,value.policy.sha256,value.parcels.sha256,value.cones.sha256,value.cones.available?'available':'unavailable'].join(':')};
  }
  function publicSnapshot(value) {
    // Persist only these public dataset fields. Never accept explorer state,
    // study planes, camera state, imports, or a selected-site location here.
    return {policy:{metadata:value.policy.metadata,rules:value.policy.rules,zones:value.policy.zones},
      metadata:value.metadata,coneKey:value.coneKey,coneSource:value.coneSource,invalidCones:value.invalidCones,
      parcels:value.parcels.map(p=>({id:p.id,polygons:p.polygons,bbox:p.bbox,zoneIds:p.zoneIds,ruleId:p.ruleId,
        zoningHeightM:p.zoningHeightM,status:p.status,_views:p._views,_viewUnknown:p._viewUnknown}))};
  }
  function createPersistentCache(indexedDB, timeoutMs=20000) {
    async function operation(action) {
      if (!indexedDB) return {status:'unavailable',reason:'not-supported'};
      return new Promise(resolve=>{
        let done=false,db=null,transaction=null;
        const finish=value=>{if(done)return;done=true;clearTimeout(timer);try{db?.close();}catch(_){}resolve(value);};
        const timer=setTimeout(()=>{finish({status:'unavailable',reason:'timeout'});try{transaction?.abort();}catch(_){}},timeoutMs);
        try {
          const request=indexedDB.open('vista-imagine-public',1);
          request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('datasets'))request.result.createObjectStore('datasets');};
          request.onerror=()=>finish({status:'unavailable',reason:'open-'+(request.error?.name||'error')});
          request.onblocked=()=>finish({status:'unavailable',reason:'blocked'});
          request.onsuccess=()=>{
            db=request.result;if(done){db.close();return;}
            db.onversionchange=()=>db.close();
            try { action(db,(tx)=>{transaction=tx;},finish); } catch(error){finish({status:'unavailable',reason:'transaction-'+(error?.name||'error')});}
          };
        } catch(error){finish({status:'unavailable',reason:'open-'+(error?.name||'error')});}
      });
    }
    return {
      read:key=>operation((db,setTransaction,finish)=>{
        const tx=db.transaction('datasets','readonly');setTransaction(tx);const store=tx.objectStore('datasets');let result={status:'miss'};
        const head=store.get('head');head.onsuccess=()=>{
          const h=head.result;if(!h)return;
          if(h.key!==key){result={status:'stale',previousDurationMs:h.durationMs};return;}
          const data=store.get('public');data.onsuccess=()=>{if(data.result?.key===key)result={status:'hit',value:data.result.value,previousDurationMs:h.durationMs};};
        };
        tx.oncomplete=()=>finish(result);tx.onerror=tx.onabort=()=>finish({status:'unavailable',reason:'read-'+(tx.error?.name||'aborted')});
      }),
      write:(key,value,durationMs)=>operation((db,setTransaction,finish)=>{
        const tx=db.transaction('datasets','readwrite');setTransaction(tx);const store=tx.objectStore('datasets');
        store.put({key,value:publicSnapshot(value)},'public');store.put({key,durationMs,storedAt:Date.now()},'head');
        tx.oncomplete=()=>finish({status:'saved'});tx.onerror=tx.onabort=()=>finish({status:'unavailable',reason:'write-'+(tx.error?.name||'aborted')});
      }),
    };
  }
  const finite = Number.isFinite, esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const ASSUMPTION = Object.freeze({heightM:213.36,key:'vista-imagine-upper-assumption/1',sourceUrl:'https://guidelines.vancouver.ca/policy-higher-buildings-for-rezonings.pdf'});
  function assumptionSettings(value){return {enabled:typeof value?.enabled==='boolean'?value.enabled:true,heightM:finite(value?.heightM)&&value.heightM>=0&&value.heightM<=2000?value.heightM:ASSUMPTION.heightM};}
  function assumptionProvenance(settings){const benchmark=settings.heightM===ASSUMPTION.heightM;return {origin:benchmark?'policy-benchmark-scenario':'user-assumption',sourceUrl:benchmark?ASSUMPTION.sourceUrl:''};}
  function studyHeight(parcel,edit,settings){
    if(finite(edit))return {heightM:edit,basis:'parcel-edit'};
    if(finite(parcel.zoningHeightM))return {heightM:parcel.zoningHeightM,basis:'sourced-reference'};
    if(settings.enabled)return {heightM:settings.heightM,basis:'assumed-upper-height'};
    return {heightM:null,basis:'unresolved'};
  }
  const colors = ['#becfd0', '#91b3b2', '#639793', '#427d7b', '#29615f', '#174947'];
  const S = {dialog:null, parcels:[], policy:null, engine:null, selected:-1, data:null, gpu:null, gpuCanvas:null, edits:null, sourceKey:'', maxHeight:0, drawCount:0, drawMs:0, classificationsRun:0, mode:'plan', azimuth:Math.PI/4,elevation:Math.asin(1/Math.sqrt(3)),dragAction:'rotate',scenario:'zoning', center:[0,0], scale:0.06, width:1, height:1, bounds:null, loaded:false, loading:null, busy:false, progress:0, cones:[], invalidCones:false, classified:false, visible:[], frame:0, returnFocus:null, generation:0, study:null, pointers:new Map(),cacheStatus:'unchecked',loadStage:'idle',loadProgress:null,loadStartedAt:0,loadDurationMs:null,cacheSaveDurationMs:null,cacheSavePromise:null,previousDurationMs:null,loadTimer:null,manifest:null,publicCones:null,networkBytes:0,byteCounts:{}};
  let persistentCache=null,packedCache=null;
  S.assumptions=assumptionSettings(null);S.viewStudy={enabled:false,groundM:20};S.viewStats={reduced:0,unknown:0};S.viewParcels=[];
  const cache=()=>{if(persistentCache)return persistentCache;let storage=null;try{storage=root.indexedDB;}catch(error){S.cacheErrorCode='access-'+(error?.name||'error');}return persistentCache=createPersistentCache(storage);};
  const $ = id => S.dialog.querySelector('#imagine-' + id);
  const count = n => Number(n || 0).toLocaleString();
  const metres = n => finite(n) ? (Math.round(n * 10) / 10).toLocaleString() + ' m' : 'Unknown';
  const box = points => points.reduce((b,p) => [Math.min(b[0],p[0]),Math.min(b[1],p[1]),Math.max(b[2],p[0]),Math.max(b[3],p[1])], [Infinity,Infinity,-Infinity,-Infinity]);
  const meet = (a,b) => a[0]<=b[2] && a[2]>=b[0] && a[1]<=b[3] && a[3]>=b[1];
  const cross = (a,b,c) => (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  function on(a,b,p) {const e=Number.EPSILON*32*(Math.abs((b[0]-a[0])*(p[1]-a[1]))+Math.abs((b[1]-a[1])*(p[0]-a[0]))+1);return Math.abs(cross(a,b,p))<=e&&p[0]>=Math.min(a[0],b[0])&&p[0]<=Math.max(a[0],b[0])&&p[1]>=Math.min(a[1],b[1])&&p[1]<=Math.max(a[1],b[1]);}
  function inside(p,r) {let yes=false;for(let i=0,j=r.length-1;i<r.length;j=i++){const a=r[j],b=r[i];if(on(a,b,p))return 2;if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<a[0]+(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1]))yes=!yes;}return yes?1:0;}
  function inPoly(p,poly) {const o=inside(p,poly[0]);if(!o)return false;if(o===2)return true;for(const h of poly.slice(1)){const q=inside(p,h);if(q===2)return true;if(q===1)return false;}return true;}
  // The screen ray traverses XY by `offset` between ground and prism roof.
  // Test walls too, so a foreground wall cannot select a parcel behind it.
  function prismHit(polygons,point,offset,height){
    const top=[point[0]+offset[0],point[1]+offset[1]];
    if(polygons.some(poly=>inPoly(top,poly)))return height;
    if(height<=0)return null;
    let tMax=-1;
    for(const poly of polygons)for(const ring of poly)for(let i=0;i<ring.length;i++){
      const a=ring[i],b=ring[(i+1)%ring.length],ex=b[0]-a[0],ey=b[1]-a[1],ax=a[0]-point[0],ay=a[1]-point[1],den=offset[0]*ey-offset[1]*ex;
      if(Math.abs(den)<1e-12)continue;
      const t=(ax*ey-ay*ex)/den,u=(ax*offset[1]-ay*offset[0])/den;
      if(t>=-1e-9&&t<=1+1e-9&&u>=-1e-9&&u<=1+1e-9)tMax=Math.max(tMax,Math.max(0,Math.min(1,t)));
    }
    return tMax<0?null:tMax*height;
  }
  function segments(a,b,c,d) {const u=cross(a,b,c),v=cross(a,b,d),w=cross(c,d,a),z=cross(c,d,b);return ((u>0&&v<0||u<0&&v>0)&&(w>0&&z<0||w<0&&z>0))||on(a,b,c)||on(a,b,d)||on(c,d,a)||on(c,d,b);}
  function overlaps(poly,r) {
    if(poly[0].some(p=>inside(p,r))||r.some(p=>inPoly(p,poly)))return true;
    for(const ring of poly)for(let i=0;i<ring.length;i++)for(let j=0;j<r.length;j++)if(segments(ring[i],ring[(i+1)%ring.length],r[j],r[(j+1)%r.length]))return true;
    return false;
  }
  function ui() {
    if(S.dialog)return;
    const d=document.createElement('dialog'); d.id='vista-imagine'; d.className='vista-imagine';d.setAttribute('aria-labelledby','imagine-title');
    d.innerHTML=`<div class="imagine-shell"><header class="imagine-header"><div><h1 id="imagine-title"><svg class="imagine-city-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 21h18M5 21V10h5v11M10 21V3h6v18M16 21v-7h4v7M12 7h2M12 11h2M12 15h2M7 14h1M7 17h1"/></svg>Imagine Vancouver</h1><p>Explore parcel heights across Vancouver, compare view constraints, and test your own skyline assumptions.</p></div><button type="button" id="imagine-close">Return to my study</button></header><div class="imagine-body"><aside class="imagine-panel" aria-label="Imagine controls and parcel details"><fieldset><legend>Compare height scenarios</legend><div class="imagine-segment"><button type="button" id="imagine-zoning" aria-pressed="true">Zoning heights</button><button type="button" id="imagine-combined" aria-pressed="false">With views</button><button type="button" id="imagine-study" aria-pressed="false">My scenario</button></div></fieldset><section id="imagine-assumptions" class="imagine-assumptions" hidden><label class="imagine-check" for="imagine-assume"><input id="imagine-assume" type="checkbox" checked>Fill missing heights</label><form id="imagine-assumption-form"><label for="imagine-assumed-height">Assumed upper height (m)</label><div class="imagine-assumption-input"><input id="imagine-assumed-height" type="number" min="0" max="2000" step="0.01" value="213.36" required><button type="submit">Apply</button></div></form><p id="imagine-assumption-status" role="status">Only parcels without a sourced zoning height use this assumption.</p><details><summary>Basis for this assumption</summary><p>Default: 213.36 m (700 ft), an upper skyline benchmark in the City’s <a href="https://guidelines.vancouver.ca/policy-higher-buildings-for-rezonings.pdf" target="_blank" rel="noopener">March 2026 Higher Buildings Policy</a>. That policy applies to specified downtown locations and discretionary review. Applying this benchmark to missing records is a hypothetical scenario, not a parcel’s permitted maximum.</p><p>View ceilings, ground reference, setbacks, floor area, heritage and other site conditions still need verification. Change this value to compare another assumption.</p></details></section><section id="imagine-view-study-controls" class="imagine-view-study-controls" hidden><h2>View-cone effect</h2><p>Test horizontal ceilings at the mapped observer elevations. These are assumed planes, not City ceiling surfaces.</p><form id="imagine-view-study-form"><label for="imagine-study-ground">Flat ground elevation assumption (m)</label><input id="imagine-study-ground" type="number" min="-500" max="2000" step="0.1" value="20" required><button type="submit" id="imagine-view-study-apply">Calculate with assumptions</button><button type="button" id="imagine-view-study-off" hidden>Show baseline heights</button></form><p id="imagine-view-study-status" role="status">Off. Source elevations and this flat ground are assumed to share one vertical reference.</p><details><summary>Calculation &amp; source</summary><p>For every corridor touching a parcel, this preset assumes a level plane (0° slope) at the source observer elevation. The lowest overlapping plane controls the whole parcel. It does not infer the actual protected-view slope.</p><p>View height = lowest assumed ceiling − flat ground. Result = the lower of baseline height and view height, bounded at zero. Reduction = baseline − result.</p><p>The 20 m initial ground value is illustrative. No terrain or official building grade is inferred. Source eye-height convention and vertical datum are unresolved. This is neither a verified legal limit nor a conservative assessment.</p><p><a href="https://services3.arcgis.com/qrcTTRTwUoS8N47o/arcgis/rest/services/ViewCone/FeatureServer/0" target="_blank" rel="noopener">City observer-elevation source</a> · checked 2 November 2026. Complete lower-boundary surfaces are still absent.</p></details></section><fieldset><legend>View</legend><div class="imagine-segment"><button type="button" id="imagine-plan" aria-pressed="true">Plan map</button><button type="button" id="imagine-iso" aria-pressed="false">3D skyline</button></div><div id="imagine-orbit" class="imagine-orbit" hidden><label for="imagine-touch-action">One-finger gesture</label><select id="imagine-touch-action" aria-describedby="imagine-touch-help"><option value="rotate">Rotate skyline</option><option value="pan">Move map</option></select><p id="imagine-touch-help" class="imagine-small">Two fingers always move and pinch to zoom.</p><label for="imagine-tilt">Tilt <output id="imagine-tilt-value" for="imagine-tilt">35°</output></label><input id="imagine-tilt" type="range" min="15" max="80" step="1" value="35"><p id="imagine-bearing" class="imagine-small" role="status">Rotation 45°</p></div></fieldset><p id="imagine-scenario-note" class="imagine-note">Selected basic schedule heights, subject to each rule’s stated use and conditions.</p><div class="imagine-legend" aria-label="Map legend"><span><i class="imagine-key known"></i>Sourced basic height</span><span><i class="imagine-key unknown"></i>Unknown zoning reference</span><span><i class="imagine-key views"></i>View ceiling unresolved</span><span id="imagine-assumed-legend" hidden><i class="imagine-key assumed"></i>Assumed upper height</span><span id="imagine-view-reduced-legend" hidden><i class="imagine-key reduced"></i>Reduced by assumed view ceiling</span><span id="imagine-edited-legend" hidden><i class="imagine-key edited"></i>My parcel edit</span><small>Height colours: ≤12, 20, 35, 55, 90, &gt;90 m, from light to dark.</small></div><p id="imagine-progress" role="status" aria-live="polite">Loading citywide parcels…</p><p id="imagine-cache-note" class="imagine-small" role="status" aria-live="polite">Public map data can be saved on this device for faster repeat visits.</p><button type="button" id="imagine-retry" hidden>Retry loading</button><section class="imagine-selection" aria-labelledby="imagine-parcel-title"><h2 id="imagine-parcel-title">Explore a parcel</h2><div id="imagine-parcel"><p>Click a parcel to inspect its height reference and sources.</p></div><form id="imagine-height-form" class="imagine-height-form" hidden><label for="imagine-height">Study height (m)</label><input id="imagine-height" type="number" min="0" max="2000" step="0.1" inputmode="decimal"><div class="imagine-parcel-nav"><button id="imagine-height-apply" type="submit">Apply height</button><button id="imagine-height-reset" type="button">Reset</button></div><p id="imagine-height-status" role="status">Saved on this device. Study edits keep the sourced references intact.</p></form><div class="imagine-parcel-nav"><button type="button" id="imagine-previous">Previous parcel</button><button type="button" id="imagine-next">Next parcel</button></div><label for="imagine-search">Find a parcel ID</label><form id="imagine-search-form"><input id="imagine-search" type="text" placeholder="Paste a parcel ID" autocomplete="off"><button type="submit">Find</button></form><p id="imagine-search-message" role="status"></p></section><details class="imagine-evidence"><summary>Sources and study limits</summary><div id="imagine-evidence">Source details will appear when the data loads.</div></details><button type="button" id="imagine-refresh">Refresh study planes</button><p id="imagine-study-note" class="imagine-small">No verified City ceiling surfaces are available. User study planes do not establish a legal limit.</p><button type="button" id="imagine-export" disabled>Export parcel references (CSV)</button></aside><main class="imagine-map"><canvas id="imagine-canvas" tabindex="0" role="img" aria-label="Citywide Vancouver parcel map. In 3D drag to rotate, Shift-drag to pan; Q and E rotate, T and G tilt. Arrow keys pan, plus and minus zoom. Use Select centre parcel or parcel navigation buttons for details." aria-describedby="imagine-map-help"></canvas><div class="imagine-map-heading"><strong id="imagine-map-title">Zoning reference</strong><span id="imagine-map-subtitle">Citywide parcel snapshot</span></div><div class="imagine-map-tools" aria-label="Map navigation"><button type="button" id="imagine-zoom-in" aria-label="Zoom in">Zoom in</button><button type="button" id="imagine-zoom-out" aria-label="Zoom out">Zoom out</button><button type="button" id="imagine-reset">Whole city</button><button type="button" id="imagine-my-site" disabled>My study site</button><button type="button" id="imagine-centre">Select centre parcel</button></div><div class="imagine-map-footer"><p id="imagine-map-help">Drag to pan · scroll to zoom · click a parcel</p><details class="imagine-keyboard-help"><summary>Keyboard &amp; touch help</summary><p>Focus the map: arrow keys move · Q / E rotate · T / G tilt · + / − zoom · Home fits the city · Enter selects the centre parcel. Touch: use the one-finger gesture selector in 3D; two fingers move and pinch to zoom.</p></details><p id="imagine-scale"></p><p id="imagine-model-note">Parcel snapshots are approximate. These height fields do not establish development rights.</p></div><div id="imagine-loading" class="imagine-loading" aria-busy="true"><div class="imagine-loading-symbol" aria-hidden="true"></div><strong id="imagine-loading-title">Checking saved data</strong><div id="imagine-loading-track" class="imagine-loading-track is-indeterminate" role="progressbar" aria-label="Preparing the Imagine map" aria-valuemin="0" aria-valuemax="100"><span id="imagine-loading-fill"></span></div><span id="imagine-loading-detail">Checking the current public data version.</span><span id="imagine-loading-time"></span><button type="button" id="imagine-loading-close">Return to my study</button><small>Preparation can continue in the background. Only public map data is saved.</small></div></main></div></div>`;
    document.body.appendChild(d);S.dialog=d;S.canvas=$('canvas');S.ctx=S.canvas.getContext('2d');
    try{S.assumptions=assumptionSettings(JSON.parse(root.localStorage.getItem(ASSUMPTION.key)));}catch(_){}
    $('assume').checked=S.assumptions.enabled;$('assumed-height').value=S.assumptions.heightM;
    $('assume').onchange=()=>setUpperAssumption({enabled:$('assume').checked,heightM:S.assumptions.heightM});
    $('assumption-form').onsubmit=e=>{e.preventDefault();try{const raw=$('assumed-height').value.trim();if(!raw)throw new Error('Enter a height from 0 to 2,000 m.');setUpperAssumption({enabled:$('assume').checked,heightM:Number(raw)});}catch(error){$('assumption-status').textContent=error.message;}};
    $('close').addEventListener('click',close);$('loading-close').addEventListener('click',close); d.addEventListener('cancel',e=>{e.preventDefault();close();});d.addEventListener('close',()=>{document.dispatchEvent(new Event('vista-imagine-closed'));cancelAnimationFrame(S.frame);S.frame=0;if(S.returnFocus?.isConnected)S.returnFocus.focus();});
    $('zoning').onclick=()=>setScenario('zoning');$('combined').onclick=()=>setScenario('combined');$('study').onclick=()=>setScenario('study');$('plan').onclick=()=>setMode('plan');$('iso').onclick=()=>setMode('iso');
    $('touch-action').onchange=()=>setDragAction($('touch-action').value);
    $('tilt').oninput=()=>{S.elevation=Number($('tilt').value)*Math.PI/180;updateCameraUI();schedule();};
    $('zoom-in').onclick=()=>zoom(1.5);$('zoom-out').onclick=()=>zoom(1/1.5);$('reset').onclick=reset;$('my-site').onclick=focusStudySite;$('centre').onclick=()=>selectAt(S.width/2,S.height/2,true);
    $('previous').onclick=()=>cycle(-1);$('next').onclick=()=>cycle(1);$('retry').onclick=()=>load();$('refresh').onclick=()=>{if(!S.loading)refresh();};$('export').onclick=exportCSV;
    $('search-form').onsubmit=e=>{e.preventDefault();const id=$('search').value.trim();const i=(S.data?.idIndex.get(id) ?? S.parcels.findIndex(p=>String(p.id)===id));if(i<0){$('search-message').textContent='Parcel ID not found. Copy an ID from this study’s CSV export.';return;}$('search-message').textContent='';select(i,true);};
    $('height-form').onsubmit=e=>{e.preventDefault();try{const raw=$('height').value.trim();if(!raw)throw new Error('Enter a study height.');setParcelHeight(S.parcels[S.selected].id,Number(raw));}catch(error){$('height-status').textContent=error.message;}};
    $('height-reset').onclick=()=>{if(S.selected>=0)setParcelHeight(S.parcels[S.selected].id,null);};
    $('view-study-form').onsubmit=e=>{e.preventDefault();try{const raw=$('study-ground').value.trim();if(!raw)throw new Error('Enter a ground assumption from −500 to 2,000 m.');setViewStudy({enabled:true,groundM:Number(raw)});}catch(error){$('view-study-status').textContent=error.message;}};
    $('view-study-off').onclick=()=>setViewStudy({...S.viewStudy,enabled:false});
    S.canvas.addEventListener('wheel',e=>{e.preventDefault();const b=S.canvas.getBoundingClientRect();zoom(Math.exp(-Math.max(-100,Math.min(100,e.deltaY))*.004),e.clientX-b.left,e.clientY-b.top);},{passive:false});
    S.canvas.addEventListener('contextmenu',e=>e.preventDefault());
    S.canvas.addEventListener('pointerdown',e=>{
      if(e.button!==0&&e.button!==2||S.pointers.size>=2)return;
      S.canvas.setPointerCapture(e.pointerId);S.pointers.set(e.pointerId,[e.clientX,e.clientY]);
      S.drag={x:e.clientX,y:e.clientY,total:S.pointers.size>1?100:0,action:e.button===2||e.shiftKey?'pan':e.pointerType==='touch'?S.dragAction:'rotate'};S.canvas.classList.add('dragging');
    });
    S.canvas.addEventListener('pointermove',e=>{
      if(!S.pointers.has(e.pointerId)||!S.drag)return;
      const before=[...S.pointers.values()];S.pointers.set(e.pointerId,[e.clientX,e.clientY]);const after=[...S.pointers.values()];
      if(before.length===2&&after.length===2){
        const a=Math.hypot(before[0][0]-before[1][0],before[0][1]-before[1][1]),b=Math.hypot(after[0][0]-after[1][0],after[0][1]-after[1][1]);
        const v=unprojectDelta((after[0][0]+after[1][0]-before[0][0]-before[1][0])/2,(after[0][1]+after[1][1]-before[0][1]-before[1][1])/2);
        S.center[0]-=v[0];S.center[1]-=v[1];if(a>2){const rect=S.canvas.getBoundingClientRect();zoom(b/a,(after[0][0]+after[1][0])/2-rect.left,(after[0][1]+after[1][1])/2-rect.top);}S.drag.total=100;schedule();return;
      }
      const dx=e.clientX-S.drag.x,dy=e.clientY-S.drag.y;S.drag.total+=Math.hypot(dx,dy);S.drag.x=e.clientX;S.drag.y=e.clientY;
      if(S.mode==='iso'&&S.drag.action==='rotate'&&!e.shiftKey)rotate(dx*.007,dy*.005);
      else{const v=unprojectDelta(dx,dy);S.center[0]-=v[0];S.center[1]-=v[1];schedule();}
    });
    const end=e=>{
      if(!S.pointers.has(e.pointerId))return;S.pointers.delete(e.pointerId);
      if(S.pointers.size){const p=[...S.pointers.values()][0];S.drag.x=p[0];S.drag.y=p[1];S.drag.total=100;return;}
      S.canvas.classList.remove('dragging');
      if(S.drag&&S.drag.total<6&&e.type==='pointerup'&&e.button===0){const b=S.canvas.getBoundingClientRect();selectAt(e.clientX-b.left,e.clientY-b.top);}
      S.drag=null;
    };
    S.canvas.addEventListener('pointerup',end);S.canvas.addEventListener('pointercancel',end);S.canvas.addEventListener('lostpointercapture',end);
    S.canvas.addEventListener('keydown',e=>{const key=e.key.length===1?e.key.toLowerCase():e.key;const action={ArrowUp:()=>pan(0,100),ArrowDown:()=>pan(0,-100),ArrowLeft:()=>pan(-100,0),ArrowRight:()=>pan(100,0),q:()=>rotate(-Math.PI/12,0),e:()=>rotate(Math.PI/12,0),t:()=>rotate(0,Math.PI/36),g:()=>rotate(0,-Math.PI/36),'+':()=>zoom(1.3),'=':()=>zoom(1.3),'-':()=>zoom(1/1.3),Home:reset,Enter:()=>selectAt(S.width/2,S.height/2,true)}[key];if(action){e.preventDefault();action();}});
    S.resize=new ResizeObserver(resize);S.resize.observe(S.canvas);
    // The map can open before the 3D model. Read live study assumptions after
    // that independent startup finishes, without delaying Imagine's public data.
    Promise.resolve(root.__explorer?.ready).then(()=>{refreshSiteButton();if(S.loaded&&!S.loading)refresh();}).catch(()=>{});
  }
  function now(){return root.performance?.now?.()??Date.now();}
  function setLoadStage(stage,detail,progress=null){
    S.loadStage=stage;S.loadProgress=finite(progress)?Math.max(0,Math.min(1,progress)):null;
    if(!S.dialog)return;
    $('loading-title').textContent=stage;$('loading-detail').textContent=detail;
    const track=$('loading-track');track.classList.toggle('is-indeterminate',S.loadProgress===null);
    if(S.loadProgress===null){track.removeAttribute('aria-valuenow');$('loading-fill').style.width='';}
    else{track.setAttribute('aria-valuenow',String(Math.round(S.loadProgress*100)));$('loading-fill').style.width=(S.loadProgress*100)+'%';}
    track.setAttribute('aria-valuetext',detail);$('progress').textContent=detail;updateElapsed();
  }
  function updateElapsed(){
    if(!S.loadStartedAt||!S.dialog)return;
    const elapsed=Math.max(0,(now()-S.loadStartedAt)/1000);
    let text=Math.floor(elapsed)+' s elapsed';
    // A previous measured run is an estimate of total preparation, never a countdown.
    if(finite(S.previousDurationMs)&&S.previousDurationMs>1000&&S.cacheStatus!=='hit'){
      const seconds=S.previousDurationMs/1000,lo=Math.max(1,Math.floor(seconds*.7)),hi=Math.ceil(seconds*1.5);
      text+=` · Previous preparation: about ${lo}–${hi} s total; this visit may differ`;
    }
    $('loading-time').textContent=text;
  }
  async function digest(bytes){
    try{if(!root.crypto?.subtle)return null;const raw=await root.crypto.subtle.digest('SHA-256',bytes);return Array.from(new Uint8Array(raw),n=>n.toString(16).padStart(2,'0')).join('');}catch(_){return null;}
  }
  async function currentManifest(){
    try{
      const response=await root.ProjectAPI.fetch('/generated/imagine_manifest.json',{cache:'no-store'});
      if(!response.ok)return null;
      const spec=manifestSpec(await response.json());if(!spec)return null;
      const hash=await digest(new TextEncoder().encode(spec.cones.canonicalJson));
      if(hash!==spec.cones.sha256)return null;
      const raw=JSON.parse(spec.cones.canonicalJson);
      const items=Array.isArray(raw)?raw:raw?.cones;
      if(!Array.isArray(items))return null;
      spec.cones.items=items;return spec;
    }catch(_){return null;}
  }
  async function json(url,kind){
    const response=await root.ProjectAPI.fetch(url,{cache:'no-cache'});
    if(!response.ok)throw new Error('Could not load '+url+' (HTTP '+response.status+').');
    const chunks=[],reader=response.body?.getReader?.();let received=0;
    if(reader){while(true){const {done,value}=await reader.read();if(done)break;chunks.push(value);received+=value.byteLength;S.byteCounts[kind]=received;updateDownload();}}
    else{const value=new Uint8Array(await response.arrayBuffer());chunks.push(value);received=value.byteLength;S.byteCounts[kind]=received;updateDownload();}
    const bytes=new Uint8Array(received);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
    const expected=S.manifest?.[kind];
    if(expected){const hash=await digest(bytes);if(!hash){S.cacheStatus='unavailable';S.cacheWritable=false;}else if(hash!==expected.sha256||received!==expected.bytes)throw new Error('The public data version changed during loading. Retry to load matching files.');}
    const result=JSON.parse(new TextDecoder().decode(bytes));return result;
  }
  function updateDownload(){
    const received=Object.values(S.byteCounts).reduce((a,b)=>a+b,0),expected=S.manifest?S.manifest.policy.bytes+S.manifest.parcels.bytes:null;
    S.networkBytes=received;
    if(S.lastDownloadAt&&now()-S.lastDownloadAt<100&&received!==expected)return;S.lastDownloadAt=now();
    const detail=expected?`Loading parcel layer: ${(received/1048576).toFixed(1)} / ${(expected/1048576).toFixed(1)} MB`:`Loading parcel layer: ${(received/1048576).toFixed(1)} MB received`;
    setLoadStage('Loading parcel layer',detail,expected?received/expected:null);
  }
  function install(policy,parcels,metadata){
    if(!policy?.rules||!Array.isArray(policy.zones)||!Array.isArray(parcels)||!parcels.length)throw new Error('The parcel reference dataset is incomplete.');
    S.policy=policy;S.metadata=metadata||policy.metadata||{};S.zoneById=new Map(policy.zones.map(z=>[z.id,z]));
    S.parcels=parcels;S.viewParcels=parcels.filter(p=>p._viewUnknown||p._views?.length);S.bounds=[Infinity,Infinity,-Infinity,-Infinity];
    if(S.data&&parcels===S.data.parcels)S.bounds=S.data.bounds.slice();
    else for(let i=0;i<parcels.length;i++){const p=parcels[i];if(!Array.isArray(p.bbox)||p.bbox.length!==4||!p.bbox.every(finite)||!Array.isArray(p.polygons))throw new Error('Invalid parcel geometry at record '+i+'.');S.bounds[0]=Math.min(S.bounds[0],p.bbox[0]);S.bounds[1]=Math.min(S.bounds[1],p.bbox[1]);S.bounds[2]=Math.max(S.bounds[2],p.bbox[2]);S.bounds[3]=Math.max(S.bounds[3],p.bbox[3]);}
    S.loaded=true;renderEvidence();reset();refreshSiteButton();
  }
  function cacheRecordValid(value,spec){
    if(!value?.policy?.rules||!Array.isArray(value.policy.zones)||!Array.isArray(value.parcels)||!value.parcels.length||typeof value.invalidCones!=='boolean'||!Array.isArray(value.coneSource))return false;
    if(Number.isSafeInteger(spec.parcelCount)&&value.parcels.length!==spec.parcelCount)return false;
    const ids=new Set(spec.cones.items.map(c=>String(c.view_number)));
    return value.parcels.every(p=>p&&Array.isArray(p._views)&&p._views.every(id=>typeof id==='string'&&ids.has(id))&&p._viewUnknown===(value.invalidCones||p._views.length>0));
  }
  function cacheNote(){
    $('cache-note').textContent=S.cacheStatus==='hit'?'Opened saved public map data. Its version matches the current dataset.':S.cacheStatus==='saved'?'Public map data and view intersections are saved on this device. Reopening this dataset will be faster.':S.cacheStatus==='saving'?'Map ready. Saving public map data in the background for your next visit; you can keep exploring.':S.cacheStatus==='unavailable'?'Device storage is unavailable. Imagine still works; keep this page open to reuse the loaded map.':S.cacheStatus==='unversioned'?'No verified data-version manifest is available. This map is reused while this page stays open; it is not saved for future visits.':'The public map will be saved on this device when preparation finishes.';
  }
  function saveInBackground(){
    const key=S.manifest.key,queued=now(),value={policy:S.policy,parcels:S.parcels,metadata:S.metadata,coneKey:S.coneKey,coneSource:S.cones.map(c=>c.source),invalidCones:S.invalidCones};
    S.cacheStatus='saving';S.cacheSaveDurationMs=null;cacheNote();
    S.cacheSavePromise=(async()=>{
      // Let the usable map paint first. Storage commit is not a prerequisite
      // for navigation, closing, reopening, CSV export, or the open() promise.
      // Avoid competing with the independent 3D facade preparation. A failed
      // initial storage read may recover after that startup pressure passes.
      await Promise.resolve(root.__explorer?.ready).catch(()=>{});
      await new Promise(resolve=>{if(root.requestIdleCallback)root.requestIdleCallback(resolve,{timeout:1000});else setTimeout(resolve,50);});
      const started=now();S.cacheSaveWaitMs=started-queued;
      try{const written=await cache().write(key,value,S.loadDurationMs);S.cacheStatus=written.status;S.cacheErrorCode=written.reason||null;}
      catch(error){S.cacheStatus='unavailable';S.cacheErrorCode='save-'+(error?.name||'error');}
      finally{S.cacheSaveDurationMs=now()-started;S.cacheSavePromise=null;cacheNote();}
    })();
  }
  async function packedBytes(file,expected,kind){
    const response=await root.ProjectAPI.fetch('/generated/'+file,{cache:'no-cache'});if(!response.ok)throw new Error('Could not load stored parcel data (HTTP '+response.status+').');
    const chunks=[],reader=response.body?.getReader?.();let size=0;
    if(reader){while(true){const v=await reader.read();if(v.done)break;chunks.push(v.value);size+=v.value.byteLength;S.byteCounts[kind]=size;S.networkBytes=Object.values(S.byteCounts).reduce((a,b)=>a+b,0);setLoadStage('Opening stored parcel data',`${(S.networkBytes/1048576).toFixed(1)} / ${((S.manifest.precomputed.asset.bytes+S.manifest.precomputed.facts.bytes+S.manifest.policy.bytes)/1048576).toFixed(1)} MB`,S.networkBytes/(S.manifest.precomputed.asset.bytes+S.manifest.precomputed.facts.bytes+S.manifest.policy.bytes));}}
    else{const b=new Uint8Array(await response.arrayBuffer());chunks.push(b);size=b.length;S.byteCounts[kind]=size;S.networkBytes=Object.values(S.byteCounts).reduce((a,b)=>a+b,0);}
    const bytes=new Uint8Array(size);let at=0;for(const b of chunks){bytes.set(b,at);at+=b.length;}
    if(size!==expected.bytes||await digest(bytes)!==expected.sha256)throw new Error('Stored parcel data does not match its version. Retry loading.');return bytes;
  }
  async function loadPacked(){
    const spec=S.manifest.precomputed;
    if(spec.schema!=='imagine-packed/1'||!hashPattern.test(spec.asset?.sha256)||!hashPattern.test(spec.facts?.sha256))return false;
    S.sourceKey=['packed/1',spec.asset.sha256,spec.facts.sha256,S.manifest.policy.sha256,S.manifest.cones.sha256].join(':');
    let storage=null;try{storage=root.indexedDB;}catch(_){}packedCache ||= root.ImagineData.createCache(storage);
    const saved=await packedCache.read(S.sourceKey);let record=saved.value;
    if(saved.status==='hit'){
      if(!(record?.buffer instanceof ArrayBuffer)||record.buffer.byteLength!==spec.asset.bytes||await digest(new Uint8Array(record.buffer))!==spec.asset.sha256||await digest(new TextEncoder().encode(record.factsText))!==spec.facts.sha256||await digest(new TextEncoder().encode(record.policyText))!==S.manifest.policy.sha256)record=null;
    }
    if(!record){
      const [geometry,facts,policy]=await Promise.all([packedBytes(spec.asset.url,spec.asset,'geometry'),packedBytes(spec.facts.url,spec.facts,'facts'),packedBytes('height_policy.json',S.manifest.policy,'policy')]);
      record={buffer:geometry.buffer,factsText:new TextDecoder().decode(facts),policyText:new TextDecoder().decode(policy)};S.cacheStatus='saving';
    }else S.cacheStatus='hit';
    setLoadStage('Preparing stored map','Opening the parcel index and reusable display buffers.');
    const began=now(),facts=JSON.parse(record.factsText),policy=JSON.parse(record.policyText);
    S.data=root.ImagineData.decode(spec,record.buffer,facts);install(policy,S.data.parcels,facts.metadata);S.decodeMs=now()-began;
    S.publicCones=S.manifest.cones.available?S.manifest.cones.items:[];configureCones(S.publicCones);S.coneKey=JSON.stringify(S.publicCones);S.classified=true;
    S.maxHeight=S.parcels.reduce((h,p)=>Math.max(h,p.zoningHeightM||0),S.assumptions.heightM);reset();
    try{
      const canvas=document.createElement('canvas');canvas.className='imagine-gpu-canvas';canvas.setAttribute('aria-hidden','true');S.canvas.before(canvas);
      S.viewCeilings=root.ImagineViewImpact.prepare(S.parcels);S.viewParcels=S.parcels.filter(p=>p._viewUnknown||p._views?.length);
      S.gpu=root.ImagineRenderer.create(canvas,S.data.arrays,{viewCeilings:S.viewCeilings});S.gpuCanvas=canvas;S.gpu.resize(S.width,S.height,Math.min(2,root.devicePixelRatio||1));
    }catch(error){S.gpu=null;S.dialog.querySelector('.imagine-gpu-canvas')?.remove();S.rendererError=error.message;}
    let local=null;try{local=root.localStorage;}catch(_){}
    S.edits=root.ImagineData.createEdits(facts.ids,(index,height)=>{S.gpu?.setHeight(index,height);if(height!==null)S.maxHeight=Math.max(S.maxHeight,height);},local,'vista-imagine-edits/'+S.sourceKey);
    for(const [id,h]of S.edits.values)S.gpu?.setHeight(S.data.idIndex.get(id),h);
    for(const h of S.edits.values.values())S.maxHeight=Math.max(S.maxHeight,h);
    await refresh();
    if(S.cacheStatus!=='hit'){
      S.cacheSavePromise=(async()=>{await new Promise(resolve=>setTimeout(resolve,50));const began=now();const result=await packedCache.write(S.sourceKey,record);S.cacheStatus=result.status;S.cacheSaveDurationMs=now()-began;S.cacheSavePromise=null;cacheNote();})();
    }
    return true;
  }
  function raisedQueryBounds(points){const delta=root.ImagineRenderer.heightOffset(S.maxHeight,S);return box(points.concat(points.map(p=>[p[0]+delta[0],p[1]+delta[1]])));}
  function viewportParcels(){if(!S.data)return S.visible.length?S.visible:S.parcels.map((_,i)=>i);return S.data.query(raisedQueryBounds([[0,0],[S.width,0],[S.width,S.height],[0,S.height]].map(q=>world(...q))));}
  function getParcelAt(x,y){if(!S.data||![x,y].every(Number.isFinite))return null;for(const i of S.data.query([x,y,x,y]))if(S.parcels[i].polygons.some(poly=>inPoly([x,y],poly)))return getParcel(S.parcels[i].id);return null;}
  function viewEffect(p,enabled=S.viewStudy.enabled){return root.ImagineViewImpact.analysis(p,currentStudyHeight(p).heightM,S.viewStudy.groundM,enabled);}
  function viewContribution(p){const e=viewEffect(p,true);return {reduced:Number(e.reductionM>1e-4),unknown:Number(e.status==='unknown')};}
  function updateViewStatus(){if(!S.dialog)return;$('view-study-off').hidden=!S.viewStudy.enabled;$('view-reduced-legend').hidden=S.scenario!=='study'||!S.viewStudy.enabled;$('view-study-status').textContent=S.viewStudy.enabled?`${count(S.viewStats.reduced)} parcels reduced · ${count(S.viewStats.unknown)} unresolved under this preset. Flat ground: ${metres(S.viewStudy.groundM)}; plane slope: 0°. Hypothetical results.`:'Off. Source elevations and this flat ground are assumed to share one vertical reference.';}
  function recalculateViewStats(){S.viewStats={reduced:0,unknown:0};if(S.viewStudy.enabled)for(const p of S.viewParcels){const c=viewContribution(p);S.viewStats.reduced+=c.reduced;S.viewStats.unknown+=c.unknown;}updateViewStatus();}
  function setViewStudy(value){if(typeof value?.enabled!=='boolean'||!finite(value.groundM)||value.groundM< -500||value.groundM>2000)throw new RangeError('Enter a ground assumption from −500 to 2,000 m.');S.viewStudy={enabled:value.enabled,groundM:value.groundM};$('study-ground').value=value.groundM;recalculateViewStats();setScenario('study');renderSelected();schedule();return {...S.viewStudy,...S.viewStats};}
  function currentStudyHeight(p){return studyHeight(p,S.edits?.get(p.id)??null,S.assumptions);}
  function setUpperAssumption(value){if(typeof value?.enabled!=='boolean'||!finite(value.heightM)||value.heightM<0||value.heightM>2000)throw new RangeError('Enter a height from 0 to 2,000 m.');S.assumptions=assumptionSettings(value);let saved=false;try{root.localStorage.setItem(ASSUMPTION.key,JSON.stringify(S.assumptions));saved=true;}catch(_){}$('assume').checked=value.enabled;$('assumed-height').value=value.heightM;S.maxHeight=Math.max(S.maxHeight,value.heightM);recalculateViewStats();setScenario('study');$('assumption-status').textContent=(value.enabled?'Missing zoning heights use '+metres(value.heightM)+'.':'Missing zoning heights remain unresolved.')+(saved?' Saved on this device.':' Device storage is unavailable; applied for this visit.');return {...S.assumptions,saved};}
  function getParcel(id){const i=S.data?.idIndex.get(String(id))??S.parcels.findIndex(p=>String(p.id)===String(id));if(i<0||i===undefined)return null;const p=S.parcels[i];return {id:p.id,bbox:p.bbox.slice(),zoningHeightM:p.zoningHeightM,viewIds:p._views.slice(),viewHeightUnknown:p._viewUnknown,studyHeightM:S.edits?.get(p.id)??null,assumedHeightM:currentStudyHeight(p).basis==='assumed-upper-height'?S.assumptions.heightM:null,effectiveStudyHeightM:currentStudyHeight(p).heightM,studyHeightBasis:currentStudyHeight(p).basis,viewStudy:viewEffect(p),assumptionOrigin:currentStudyHeight(p).basis==='assumed-upper-height'?assumptionProvenance(S.assumptions).origin:null,ruleId:p.ruleId};}
  function setParcelHeight(id,heightM){
    if(!S.edits)throw new Error('Open the stored parcel map before editing.');const index=S.data.idIndex.get(String(id)),p=S.parcels[index],before=p&&S.viewStudy.enabled?viewContribution(p):null;
    const result=S.edits.set(id,heightM);
    if(before){const after=viewContribution(p);S.viewStats.reduced+=after.reduced-before.reduced;S.viewStats.unknown+=after.unknown-before.unknown;updateViewStatus();}
    setScenario('study');renderSelected();$('height-status').textContent=result.saved?'Study height saved on this device. Sourced zoning and view references are unchanged.':'Study height updated for this visit; device storage is unavailable.';schedule();return result;
  }
  async function load(){
    if(S.loading)return S.loading;
    S.loadStartedAt=now();S.loadDurationMs=null;S.classified=false;S.cacheStatus='checking';S.byteCounts={};S.networkBytes=0;S.lastDownloadAt=0;
    $('retry').hidden=true;$('loading').hidden=false;$('loading').setAttribute('aria-busy','true');setLoadStage('Checking saved data','Checking the current public data version.');
    clearInterval(S.loadTimer);S.loadTimer=setInterval(updateElapsed,1000);
    S.loading=(async()=>{try{
      S.manifest=await currentManifest();S.cacheWritable=!!S.manifest;
      if(S.manifest?.precomputed&&root.ImagineData&&await loadPacked())return;
      if(S.manifest){
        S.publicCones=S.manifest.cones.available?S.manifest.cones.items:[];
        const saved=await cache().read(S.manifest.key);S.cacheStatus=saved.status;S.previousDurationMs=saved.previousDurationMs||null;S.cacheReadError=saved.reason||null;S.cacheErrorCode=saved.reason||S.cacheErrorCode||null;
        if(saved.status==='unavailable'&&!['timeout','blocked'].includes(saved.reason))S.cacheWritable=false;
        const usable=saved.status==='hit'&&cacheRecordValid(saved.value,S.manifest);
        if(saved.status==='hit'&&!usable)S.cacheStatus='stale';
        if(usable){
          setLoadStage('Opening saved map','Opening the saved parcel layer and its completed view intersections.');
          try{install(saved.value.policy,saved.value.parcels,saved.value.metadata);S.coneKey=saved.value.coneKey;S.classified=true;configureCones(S.publicCones);if(S.invalidCones!==saved.value.invalidCones)throw new Error('Saved view coverage does not match.');S.cacheStatus='hit';await refresh();return;}
          catch(_){S.loaded=false;S.classified=false;S.cacheStatus='stale';}
        }
      }else{S.cacheStatus='unversioned';S.publicCones=null;}
      cacheNote();setLoadStage('Loading parcel layer','Loading public parcel geometry and zoning sources.');
      const [policy,data]=await Promise.all([json('/generated/height_policy.json','policy'),json('/generated/imagine_parcels.json','parcels')]);
      setLoadStage('Preparing the map','Preparing the parcel index.');install(policy,data.parcels,data.metadata);
      await refresh();
      S.loadDurationMs=now()-S.loadStartedAt;
      if(S.manifest&&S.cacheWritable&&S.classified)saveInBackground();
    }catch(e){S.loaded=false;S.busy=false;$('progress').textContent='Imagine could not load. '+e.message;$('retry').hidden=false;S.loadStage='error';}
    finally{
      S.loadDurationMs=now()-S.loadStartedAt;clearInterval(S.loadTimer);S.loadTimer=null;S.loading=null;
      $('loading').hidden=true;$('loading').setAttribute('aria-busy','false');cacheNote();
      if(S.loaded&&S.classified){S.loadStage='ready';S.loadProgress=1;summary();schedule();}
    }})();return S.loading;
  }
  function configureCones(raw){
    S.cones=[];S.invalidCones=!Array.isArray(raw)||!raw.length;
    for(const c of Array.isArray(raw)?raw:[]){const r=c?.polygon_model_xy;if(c?.view_number==null||!Array.isArray(r)||r.length<3||!r.every(p=>Array.isArray(p)&&finite(p[0])&&finite(p[1]))){S.invalidCones=true;continue;}S.cones.push({id:String(c.view_number),ring:r,bbox:box(r),source:c});}
  }
  function summary(){
    const known=S.parcels.filter(p=>finite(p.zoningHeightM)).length,missing=S.parcels.filter(p=>p._viewUnknown).length;
    $('progress').textContent=`${count(S.parcels.length)} parcels · ${count(known)} basic zoning references · ${count(missing)} unresolved view ceilings`;
  }
  async function refresh(){
    if(!S.loaded||S.busy)return;
    const X=root.__explorer;refreshSiteButton();
    S.study=X?.getConeStudy?.()||{planes:{},datumOffsetM:null,datumName:''};
    let raw=S.publicCones;
    if(raw===null){
      setLoadStage('Checking views','Loading the public view-corridor boundaries.');
      try{const response=await root.ProjectAPI.fetch('/api/viewcones');const supplied=response.ok?await response.json():null;raw=supplied?.available?supplied.cones:[];}catch(_){raw=[];}
    }
    configureCones(raw);
    const n=Object.keys(S.study.planes||{}).length;
    $('study-note').textContent=n?`${count(n)} user study plane${n===1?'':'s'} loaded. Citywide ground and grade alignment are unavailable; parcel view heights remain unknown. Inspect a parcel for any calculable study elevation.`:'No verified City ceiling surfaces are available. No user study planes are loaded. Inside mapped corridors, combined heights remain unknown.';
    if(S.classified&&S.coneKey===JSON.stringify(raw)){$('export').disabled=false;renderSelected();schedule();return;}
    S.classificationsRun++;S.coneKey=JSON.stringify(raw);const generation=++S.generation;S.classified=false;S.busy=true;$('export').disabled=true;
    const began=now();
    for(let start=0;start<S.parcels.length;start+=500){
      if(generation!==S.generation)return;
      const end=Math.min(S.parcels.length,start+500);
      for(let i=start;i<end;i++){const p=S.parcels[i];p._views=[];for(const c of S.cones)if(meet(p.bbox,c.bbox)&&p.polygons.some(poly=>overlaps(poly,c.ring)))p._views.push(c.id);p._viewUnknown=S.invalidCones||p._views.length>0;}
      S.progress=end;const detail=`Checking views: ${count(end)} / ${count(S.parcels.length)} parcels`;
      setLoadStage('Checking views',detail,end/S.parcels.length);
      // Remaining-time estimates are based only on work actually completed.
      const elapsed=now()-began;if(end>2000&&elapsed>1500){const remaining=elapsed*(S.parcels.length-end)/end/1000;if(remaining>2)$('loading-time').textContent+=` · About ${Math.max(1,Math.floor(remaining*.7))}–${Math.ceil(remaining*1.5)} s for this view check`;}
      await new Promise(resolve=>setTimeout(resolve,0));
    }
    S.busy=false;S.classified=true;if(S.gpu){S.viewCeilings=root.ImagineViewImpact.prepare(S.parcels);S.gpu.setViewCeilings(S.viewCeilings,S.parcels.map(p=>p._viewUnknown));}S.viewParcels=S.parcels.filter(p=>p._viewUnknown||p._views?.length);recalculateViewStats();$('export').disabled=false;summary();renderSelected();schedule();
  }
  function renderEvidence() {
    const m=S.metadata,links=(m.sources||[]).map((s,i)=>`<li><a href="${safeURL(s.url)}" target="_blank" rel="noopener">${i===0?'City zoning districts':'City property parcels'}</a><br>Data processed ${esc(String(s.dataProcessed||'not supplied').slice(0,10))}</li>`).join('');
    $('evidence').innerHTML=`<p>Retrieved ${esc(m.retrievedAt||'date unavailable')}. ${esc(m.attribution||'')}</p><ul>${links}<li><a href="https://opendata.vancouver.ca/explore/dataset/view-cones/" target="_blank" rel="noopener">City protected-view plan boundaries</a></li></ul><p>Parcel envelopes are a height field over full parcel areas. They do not apply setbacks, floor-space ratios or legal building footprints. The 3D study uses a flat base at 0 m and a 1:1 vertical scale, without terrain.</p><ul>${(m.limitations||[]).map(t=>'<li>'+esc(t)+'</li>').join('')}</ul><p>${esc(m.intersectionTolerance||'')}</p><p><a href="https://vancouver.ca/home-property-development/city-wide-design-and-development-guidelines.aspx" target="_blank" rel="noopener">City-wide Design and Development Guidelines</a> take effect 27 October 2026. The City page said the final document would be posted soon at capture. This partial reference study does not implement all current guidelines.</p>`;
  }
  function safeURL(value){try{const u=new URL(value);return /^https?:$/.test(u.protocol)?esc(u.href):'#';}catch(_){return '#';}}
  function setScenario(value){
    S.scenario=value;for(const [id,v]of[['zoning','zoning'],['combined','combined'],['study','study']])$(id).setAttribute('aria-pressed',String(value===v));
    $('assumptions').hidden=value!=='study';$('view-study-controls').hidden=value!=='study';updateViewStatus();$('assumed-legend').hidden=value!=='study'||!S.assumptions.enabled;$('edited-legend').hidden=value!=='study';
    $('map-title').textContent=value==='study'?'My scenario heights':value==='zoning'?'Zoning reference':'Zoning + protected views';
    $('scenario-note').textContent=value==='study'?(S.assumptions.enabled?'Missing zoning heights use an assumed '+metres(S.assumptions.heightM)+' in purple. ':'Missing zoning heights remain unresolved. ')+'Orange parcels use your individual edits. '+(S.viewStudy.enabled?'Terracotta parcels are shortened by assumed horizontal view ceilings. ':'')+'Verified view ceilings and other site controls remain unresolved; these masses are hypothetical.':value==='zoning'?'Selected basic schedule heights, subject to each rule’s stated use and conditions.':S.invalidCones?'View-boundary coverage is unavailable. Every combined height remains unknown until the corridor source loads.':'No verified view ceiling data. Parcels touching a mapped corridor remain flat and unresolved; outside corridors retain only a zoning reference.';
    renderSelected();schedule();
  }
  function updateCameraUI(){
    const c=root.ImagineRenderer.camera(S);S.azimuth=c.azimuth;S.elevation=c.elevation;
    $('orbit').hidden=S.mode!=='iso';$('tilt').value=Math.round(c.elevation*180/Math.PI);$('tilt-value').textContent=Math.round(c.elevation*180/Math.PI)+'°';$('bearing').textContent='Rotation '+Math.round(c.azimuth*180/Math.PI)+'°';
    $('touch-action').value=S.dragAction;
    $('map-help').textContent=S.mode==='iso'?'Drag to rotate · Shift / right-drag to move · scroll / pinch to zoom':'Drag to move · scroll / pinch to zoom · click a parcel';
  }
  function setDragAction(value){S.dragAction=value;updateCameraUI();}
  function rotate(yaw,tilt){if(S.mode!=='iso')return;S.azimuth+=yaw;S.elevation+=tilt;updateCameraUI();schedule();}
  function setMode(value){S.mode=value;$('plan').setAttribute('aria-pressed',String(value==='plan'));$('iso').setAttribute('aria-pressed',String(value==='iso'));$('model-note').textContent=value==='iso'?'Full-parcel height field · flat base at 0 m · vertical scale 1:1 · terrain, setbacks and FSR unresolved.':'Parcel snapshots are approximate. These height fields do not establish development rights.';updateCameraUI();schedule();}
  function resize(){if(!S.dialog?.open)return;const b=S.canvas.getBoundingClientRect(),dpr=Math.min(2,root.devicePixelRatio||1);S.width=Math.max(1,b.width);S.height=Math.max(1,b.height);S.canvas.width=Math.round(S.width*dpr);S.canvas.height=Math.round(S.height*dpr);S.ctx.setTransform(dpr,0,0,dpr,0,0);S.gpu?.resize(S.width,S.height,dpr);schedule();}
  function refreshSiteButton(){const site=root.__explorer?.state?.site;$('my-site').disabled=!S.loaded||!finite(site?.x)||!finite(site?.y);}
  function focusStudySite(){const site=root.__explorer?.state?.site;if(!S.loaded||!finite(site?.x)||!finite(site?.y))return;S.center=[site.x,site.y];S.scale=.4;schedule();}
  function parcelCentre(p){const b=p.bbox,x=(b[0]+b[2])/2,y=(b[1]+b[3])/2;return root.VistaGeoreference?.modelToLonLat?.(x,y)||root.AerialContextGeo?.modelToLonLat?.(x,y)||{lon:-123.1207+x/(111320*Math.cos(49.2827*Math.PI/180)),lat:49.2827+y/110574};}
  function reset(){if(!S.bounds)return;const b=S.bounds;S.center=[(b[0]+b[2])/2,(b[1]+b[3])/2];const corners=[[b[0],b[1]],[b[2],b[1]],[b[2],b[3]],[b[0],b[3]]],points=corners.flatMap(p=>[0,S.mode==='iso'?S.maxHeight:0].map(z=>root.ImagineRenderer.projectPoint([p[0]-S.center[0],p[1]-S.center[1]],z,S))),extent=box(points);S.scale=Math.max(.005,Math.min((S.width-80)/Math.max(1,extent[2]-extent[0]),(S.height-130)/Math.max(1,extent[3]-extent[1])));schedule();}
  function project(p,z=0){const q=root.ImagineRenderer.projectPoint([p[0]-S.center[0],p[1]-S.center[1]],z,S);return [S.width/2+q[0]*S.scale,S.height/2-q[1]*S.scale];}
  function unprojectDelta(dx,dy){return root.ImagineRenderer.unprojectDelta(dx/S.scale,-dy/S.scale,S);}
  function world(x,y){const v=unprojectDelta(x-S.width/2,y-S.height/2);return [v[0]+S.center[0],v[1]+S.center[1]];}
  function pan(dx,dy){const v=unprojectDelta(dx,-dy);S.center[0]+=v[0];S.center[1]+=v[1];schedule();}
  function zoom(factor,x=S.width/2,y=S.height/2){const before=world(x,y);S.scale=Math.max(.005,Math.min(8,S.scale*factor));const after=world(x,y);S.center[0]+=before[0]-after[0];S.center[1]+=before[1]-after[1];schedule();}
  function schedule(){if(S.dialog?.open&&!S.frame)S.frame=requestAnimationFrame(()=>{S.frame=0;draw();});}
  function cap(p){if(S.scenario==='study')return S.viewStudy.enabled?viewEffect(p).resultHeightM:currentStudyHeight(p).heightM;return S.scenario==='combined'&&(!S.classified||p._viewUnknown)?null:finite(p.zoningHeightM)?p.zoningHeightM:null;}
  function bucket(p){if(S.scenario==='study'){if(S.viewStudy.enabled&&viewEffect(p).reductionM>1e-4)return 10;const basis=currentStudyHeight(p).basis;if(basis==='assumed-upper-height')return 8;if(basis==='parcel-edit')return 9;}const h=cap(p);if(h===null)return S.scenario==='combined'&&(!S.classified||p._viewUnknown)?7:6;return h<=12?0:h<=20?1:h<=35?2:h<=55?3:h<=90?4:5;}
  function path(poly,z=0){for(const r of poly){if(!r.length)continue;let q=project(r[0],z);S.ctx.moveTo(...q);for(let i=1;i<r.length;i++){q=project(r[i],z);S.ctx.lineTo(...q);}S.ctx.closePath();}}
  function visible(p){const b=p.bbox,h=S.mode==='iso'?cap(p)||0:0,points=[[b[0],b[1]],[b[2],b[1]],[b[2],b[3]],[b[0],b[3]]].flatMap(p=>[project(p),project(p,h)]),e=box(points);return e[2]>=-20&&e[0]<=S.width+20&&e[3]>=-20&&e[1]<=S.height+20;}
  function parcelDepth(p){return root.ImagineRenderer.depthOf([(p.bbox[0]+p.bbox[2])/2-S.center[0],(p.bbox[1]+p.bbox[3])/2-S.center[1]],0,S);}
  function draw(){
    const c=S.ctx;c.clearRect(0,0,S.width,S.height);if(!S.gpu){c.fillStyle='#eef2f2';c.fillRect(0,0,S.width,S.height);}if(!S.loaded)return;
    const began=now();let rows=[];
    if(S.gpu){try{S.gpu.draw({center:S.center,scale:S.scale,mode:S.mode,scenario:S.scenario==='combined'?'views':S.scenario,selected:S.selected,azimuth:S.azimuth,elevation:S.elevation,assumeUnknown:S.assumptions.enabled,assumedHeightM:S.assumptions.heightM,applyViewStudy:S.viewStudy.enabled,viewGroundM:S.viewStudy.groundM});}catch(error){S.gpu.destroy();S.gpu=null;S.gpuCanvas.remove();S.gpuCanvas=null;$('cache-note').textContent='Using the simplified map renderer. Zoom in for parcel detail.';}}
    if(!S.gpu){const candidates=viewportParcels();for(const i of candidates)if(visible(S.parcels[i]))rows.push(i);S.visible=rows;}
    else{S.visible=[];c.clearRect(0,0,S.width,S.height);}
    S.drawCount++;
    const palette=colors.concat(['#d7d8d2','#dbbd8e','#8f7aab','#e6914a','#b55c4d']);
    if(!S.gpu&&rows.length>4000){const step=Math.ceil(rows.length/4000);for(let k=0;k<rows.length;k+=step){const p=S.parcels[rows[k]],q=project([(p.bbox[0]+p.bbox[2])/2,(p.bbox[1]+p.bbox[3])/2],S.mode==='iso'?cap(p)||0:0);c.fillStyle=palette[bucket(p)];c.fillRect(q[0],q[1],3,3);}}else if(!S.gpu&&S.mode==='plan'){
      const groups=Array.from({length:11},()=>[]);for(const i of rows)groups[bucket(S.parcels[i])].push(i);
      for(let b=0;b<11;b++){c.beginPath();for(const i of groups[b])for(const poly of S.parcels[i].polygons)path(poly);c.fillStyle=palette[b];c.fill('evenodd');if(S.scale>.18){c.strokeStyle='rgba(255,255,255,.65)';c.lineWidth=.5;c.stroke();}}
    }else if(!S.gpu){
      rows.sort((a,b)=>parcelDepth(S.parcels[b])-parcelDepth(S.parcels[a]));
      for(const i of rows){const p=S.parcels[i],h=cap(p)||0,b=bucket(p);
        if(h*S.scale>1.3)for(const poly of p.polygons)for(const r of poly)for(let j=0;j<r.length;j++){const a=r[j],q=r[(j+1)%r.length],a0=project(a),b0=project(q),a1=project(a,h),b1=project(q,h);c.beginPath();c.moveTo(...a0);c.lineTo(...b0);c.lineTo(...b1);c.lineTo(...a1);c.closePath();c.fillStyle=(q[0]-a[0])>(q[1]-a[1])?'#638481':'#8ba3a0';c.fill();}
        c.beginPath();for(const poly of p.polygons)path(poly,h);c.fillStyle=palette[b];c.fill('evenodd');if(S.scale>.25){c.strokeStyle='rgba(255,255,255,.45)';c.lineWidth=.4;c.stroke();}
      }
    }
    if(S.scenario==='combined')for(const cone of S.cones){c.beginPath();path([cone.ring]);c.strokeStyle='rgba(130,82,22,.52)';c.lineWidth=1;c.setLineDash([5,5]);c.stroke();c.setLineDash([]);}
    if(S.selected>=0){const p=S.parcels[S.selected],effect=viewEffect(p);if(S.mode==='iso'&&S.scenario==='study'&&S.viewStudy.enabled&&finite(effect.viewHeightM)&&effect.viewHeightM>=0){c.beginPath();for(const poly of p.polygons)path(poly,effect.viewHeightM);c.strokeStyle='#803c31';c.lineWidth=1.5;c.setLineDash([6,4]);c.stroke();c.setLineDash([]);}c.beginPath();for(const poly of p.polygons)path(poly,S.mode==='iso'?cap(p)||0:0);c.strokeStyle='#c75922';c.lineWidth=2.5;c.stroke();}
    c.strokeStyle='rgba(42,69,68,.6)';c.lineWidth=1;c.beginPath();c.moveTo(S.width/2-5,S.height/2);c.lineTo(S.width/2+5,S.height/2);c.moveTo(S.width/2,S.height/2-5);c.lineTo(S.width/2,S.height/2+5);c.stroke();
    const m=Math.pow(10,Math.floor(Math.log10(110/S.scale))),distance=(110/S.scale/m>=5?5:110/S.scale/m>=2?2:1)*m;
    $('scale').textContent=`${metres(distance)} ≈ ${Math.round(distance*S.scale)} screen px · ${S.gpu?'stored parcel map':count(rows.length)+' parcels in view'}${S.mode==='plan'?' · north is up':''}`;
    S.drawMs=now()-began;
    $('map-subtitle').textContent=`${count(S.parcels.length)} snapshot parcels · ${S.mode==='iso'?'rotatable 3D height field':'plan reference'}`;
  }
  function selectAt(x,y,nearest=false){
    if(!S.loaded)return;const point=world(x,y),candidates=S.data?S.data.query(raisedQueryBounds([point])):S.visible;let selected=-1,bestDepth=Infinity;
    for(const i of candidates){const p=S.parcels[i],height=S.mode==='iso'?cap(p)||0:0,offset=root.ImagineRenderer.heightOffset(height,S),hit=prismHit(p.polygons,point,offset,height);if(hit===null)continue;const k=height?hit/height:0,q=[point[0]+offset[0]*k-S.center[0],point[1]+offset[1]*k-S.center[1]],depth=root.ImagineRenderer.depthOf(q,hit,S);if(depth<bestDepth){selected=i;bestDepth=depth;}}
    if(selected<0&&nearest){let best=Infinity;for(const i of viewportParcels()){const b=S.parcels[i].bbox,d=(point[0]-(b[0]+b[2])/2)**2+(point[1]-(b[1]+b[3])/2)**2;if(d<best){best=d;selected=i;}}}if(selected>=0)select(selected);else $('search-message').textContent='No parcel at this location. Zoom in or select the nearest parcel with Select centre parcel.';}
  function cycle(direction){if(!S.loaded)return;const list=Array.from(viewportParcels());if(!list.length)return;const current=list.indexOf(S.selected);select(list[(current+direction+list.length)%list.length]);}
  function select(index,focus=false){S.selected=index;const p=S.parcels[index];if(focus){
    const b=p.bbox,h=S.mode==='iso'?cap(p)||0:0;S.center=[(b[0]+b[2])/2,(b[1]+b[3])/2];
    const corners=[[b[0],b[1]],[b[2],b[1]],[b[2],b[3]],[b[0],b[3]]],extent=box(corners.flatMap(q=>[0,h].map(z=>root.ImagineRenderer.projectPoint([q[0]-S.center[0],q[1]-S.center[1]],z,S))));
    const delta=root.ImagineRenderer.unprojectDelta((extent[0]+extent[2])/2,(extent[1]+extent[3])/2,S);S.center[0]+=delta[0];S.center[1]+=delta[1];
    S.scale=Math.max(.005,Math.min(2,(S.width-100)/Math.max(1,extent[2]-extent[0]),(S.height-170)/Math.max(1,extent[3]-extent[1])));
  }renderSelected();schedule();}
  function renderSelected(){
    if(!S.loaded||S.selected<0)return;const p=S.parcels[S.selected],zones=(p.zoneIds||[]).map(id=>S.zoneById.get(id)).filter(Boolean),ids=[...new Set(zones.map(z=>z.ruleId).concat(p.ruleId||[]))],rules=ids.map(id=>[id,S.policy.rules[id]]).filter(([,r])=>r),views=p._views||[];
    $('height-form').hidden=!S.edits;if(S.edits)$('height').value=S.edits.get(p.id)??'';
    const study=currentStudyHeight(p),effect=viewEffect(p);
    $('parcel-title').textContent='Parcel '+p.id;const centre=parcelCentre(p), modelCentre=[(p.bbox[0]+p.bbox[2])/2,(p.bbox[1]+p.bbox[3])/2];
    let viewText=!S.classified?'Checking corridor intersection…':S.invalidCones?'View-boundary coverage is unavailable; combined height unknown.':views.length?`Touches protected view${views.length===1?'':'s'} ${views.join(', ')}. No verified ceiling or citywide matched ground reference; combined height unknown.`:'Outside the loaded protected-view plan polygons. The basic zoning reference remains subject to all other controls.';
    let elevation='';if(views.length&&Object.keys(S.study?.planes||{}).length&&root.ConeCeiling){const r=root.ConeCeiling.evaluate({cones:S.cones.filter(c=>views.includes(c.id)).map(c=>c.source),polygons:p.polygons,planes:S.study.planes,datumOffsetM:null,groundModelZ:null});if(finite(r.ceilingElevationM))elevation=`<p>User study ceiling elevation: ${metres(r.ceilingElevationM)}${r.status==='partial'?' (incomplete planes)':''}. Above-ground conversion unavailable. The study uses its entered vertical reference.</p>`;}
    $('parcel').innerHTML=`<dl><div><dt>Zoning</dt><dd>${esc([...new Set(zones.map(z=>z.zone))].join(', ')||'Unmapped')}</dd></div><div><dt>Basic height reference</dt><dd>${metres(p.zoningHeightM)}</dd></div><div><dt>Zoning + views</dt><dd>${S.classified&&!p._viewUnknown?metres(p.zoningHeightM):'Unknown'}</dd></div>${S.scenario==='study'?'<div><dt>'+ (study.basis==='assumed-upper-height'?'Assumed upper height':study.basis==='parcel-edit'?'My parcel edit':'Study height')+'</dt><dd>'+metres(study.heightM)+'</dd></div>':''}</dl>${S.scenario==='study'&&study.basis==='assumed-upper-height'?'<p class="imagine-assumption-label">Hypothetical fill for a missing zoning height. The permitted maximum is still unresolved.</p>':''}${S.scenario==='study'&&S.viewStudy.enabled?viewCalculationHTML(p,effect):''}<p>Parcel extent centre (approximate): ${centre.lat.toFixed(5)}° latitude, ${centre.lon.toFixed(5)}° longitude (WGS84). The extent centre may lie outside an irregular parcel.</p><p>Corresponding model position: X ${modelCentre[0].toFixed(2)}, Y ${modelCentre[1].toFixed(2)} m.</p><button id="imagine-show-in-model" class="btn" type="button">Show this parcel in the model</button><p>${esc(viewText)}</p>${elevation}<details><summary>Rule sources and conditions</summary>${rules.map(([id,r])=>`<p><a href="${safeURL(r.sourceUrl)}" target="_blank" rel="noopener">${esc(id)} · ${esc(r.section||'District schedule')}</a></p><p>${esc(r.note||'Reference requires review.')}</p>${r.conditions?'<p>'+esc(typeof r.conditions==='string'?r.conditions:JSON.stringify(r.conditions))+'</p>':''}`).join('')||'<p>No reviewed numeric schedule reference is available.</p>'}<p>Snapshot status: ${esc(p.status)}. Full-footprint precomputation uses the source intersection tolerance described below.</p></details>`;
  }
  function showParcelInModel(id){
    const p=id==null?S.parcels[S.selected]:S.parcels[S.data?.idIndex.get(String(id))];
    if(!p||!root.__explorer?.assets.ready){$('search-message').textContent='The context model is still loading. Try again after it finishes.';return false;}
    try{const x=(p.bbox[0]+p.bbox[2])/2,y=(p.bbox[1]+p.bbox[3])/2;root.VistaLocation.locate(x,y,'VISTA:MODEL');close();return true;}
    catch(error){$('search-message').textContent=error.message;return false;}
  }
  function viewCalculationHTML(p,e){
    if(e.status==='outside')return '<p>Outside mapped view corridors: this study adds no height reduction.</p>';
    return `<section class="imagine-view-result"><h3>Illustrative view-cone calculation</h3><dl><div><dt>Baseline study height</dt><dd>${metres(currentStudyHeight(p).heightM)}</dd></div><div><dt>Assumed ceiling elevation</dt><dd>${metres(e.ceilingElevationM)}</dd></div><div><dt>Flat ground assumption</dt><dd>${metres(S.viewStudy.groundM)}</dd></div><div><dt>View-only height allowance</dt><dd>${metres(e.viewMaximumHeightM)}</dd></div><div><dt>View-adjusted study height</dt><dd>${metres(e.resultHeightM)}</dd></div><div><dt>Height reduction</dt><dd>${metres(e.reductionM)}</dd></div><div><dt>Limiting view</dt><dd>${esc(e.limitingViews.join(', ')||'Unresolved')}</dd></div></dl><p>${e.status==='unknown'?'A required baseline or view input is unresolved. ':''}${e.viewHeightM<0?'The assumed ceiling lies below the assumed ground; this preset leaves no positive building height. ':''}The view-only allowance is ceiling minus assumed ground, clamped to zero; it can exceed the baseline. The adjusted height also respects the baseline. Zero-pitch planes and a common vertical reference are assumed. Verified City ceilings remain unknown.</p></section>`;
  }
  function csv(value){let s=String(value??'');if(typeof value!=='number'&&/^[=+\-@]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';}
  async function exportCSV(){if(!S.classified||S.busy)return;$('export').disabled=true;
    const lines=[['parcel_id','rule_id','zoning_reference_m','zoning_plus_views_reference_m','protected_views','view_status','zoning_status','retrieved_at','source_url','scope','longitude_approx','latitude_approx','study_height_m','assumed_height_m','study_effective_height_m','study_height_basis','assumption_origin','assumption_basis_url','view_study_enabled','view_study_ceiling_m','view_study_ground_assumption_m','view_study_height_m','view_study_reduction_m','view_study_limiting_views','view_study_method','view_study_allowance_m','view_study_maximum_height_m'].map(csv).join(',')];
    for(let start=0;start<S.parcels.length;start+=2500){for(const p of S.parcels.slice(start,start+2500)){
      const study=currentStudyHeight(p),effect=viewEffect(p),enabled=S.viewStudy.enabled;
      lines.push([p.id,p.ruleId,p.zoningHeightM,S.invalidCones||p._viewUnknown?null:p.zoningHeightM,p._views.join('; '),p._viewUnknown?'unknown':'outside loaded corridors',p.status,S.metadata.retrievedAt,S.policy.rules[p.ruleId]?.sourceUrl||'','Basic schedule reference; full-parcel diagnostic height field; other controls unresolved',Number(parcelCentre(p).lon.toFixed(6)),Number(parcelCentre(p).lat.toFixed(6)),S.edits?.get(p.id)??null,study.basis==='assumed-upper-height'?S.assumptions.heightM:null,study.heightM,study.basis,study.basis==='assumed-upper-height'?assumptionProvenance(S.assumptions).origin:'',study.basis==='assumed-upper-height'?assumptionProvenance(S.assumptions).sourceUrl:'',enabled,enabled?effect.ceilingElevationM:null,enabled?S.viewStudy.groundM:null,enabled?effect.resultHeightM:null,enabled?effect.reductionM:null,enabled?effect.limitingViews.join('; '):'',enabled?root.ImagineViewImpact.metadata.assumption+'; '+root.ImagineViewImpact.metadata.referenceAssumption:'',enabled?effect.viewHeightM:null,enabled?effect.viewMaximumHeightM:null].map(csv).join(','));
    }await new Promise(resolve=>setTimeout(resolve,0));}
    const blob=new Blob(['\uFEFF'+lines.join('\r\n')],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='Vista-Imagine-parcel-references-'+(S.metadata.retrievedAt||'study')+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);$('export').disabled=false;
  }
  async function open(){ui();if(S.dialog.open){if(S.loading)await S.loading;return;}S.returnFocus=document.activeElement;S.dialog.showModal();refreshSiteButton();resize();if(S.loading)await S.loading;else if(!S.loaded)await load();else{await refresh();schedule();}}
  function close(){if(S.dialog?.open){S.dialog.close();}S.pointers.clear();S.drag=null;}
  if(typeof module==='object'&&module.exports)module.exports={manifestSpec,createPersistentCache,publicSnapshot,assumptionSettings,assumptionProvenance,studyHeight,prismHit,ASSUMPTION};
  if(!root.document)return;
  root.VistaImagine={open,close,refresh,getParcel,getParcelAt,showParcelInModel, setParcelHeight,setUpperAssumption,setViewStudy,getInfo:()=>({loaded:S.loaded,parcelCount:S.parcels.length,mode:S.mode,azimuth:S.azimuth,elevation:S.elevation,dragAction:S.dragAction,scenario:S.scenario,selectedParcel:S.parcels[S.selected]?.id||null,classified:S.classified,viewCoverageAvailable:!S.invalidCones,busy:S.busy,cacheStatus:S.cacheStatus,cacheErrorCode:S.cacheErrorCode||null,cacheReadError:S.cacheReadError||null,loadStage:S.loadStage,loadProgress:S.loadProgress,elapsedMs:S.loading?now()-S.loadStartedAt:S.loadDurationMs||0,loadDurationMs:S.loadDurationMs,cacheSaving:!!S.cacheSavePromise,cacheSaveDurationMs:S.cacheSaveDurationMs,cacheSaveWaitMs:S.cacheSaveWaitMs??null,networkBytes:S.networkBytes,precomputed:!!S.data,geometryDecoded:S.data?.geometryCount??null,classificationsRun:S.classificationsRun,drawCount:S.drawCount,drawMs:S.drawMs,studyEdits:S.edits?.values.size??0,upperAssumption:{...S.assumptions},viewStudy:{...S.viewStudy,...S.viewStats},decodeMs:S.decodeMs,rendererError:S.rendererError||null,renderer:S.gpu?.getInfo()||{backend:'canvas2d'}})};
  document.addEventListener('click',event=>{if(event.target.closest?.('#imagine-show-in-model'))showParcelInModel();});
  function bind(){const button=document.getElementById('btn-imagine');if(button&&!button.dataset.imagineBound){button.dataset.imagineBound='true';button.addEventListener('click',open);}}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true});else bind();
  if(new URLSearchParams(location.search).get('imagine')==='1')open().catch(()=>{});
})(typeof window!=='undefined'?window:globalThis);
