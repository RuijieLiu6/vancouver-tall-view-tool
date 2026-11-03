/* Public precomputed parcel records. Scenario edits never alter source references. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.ImagineData=api;})(typeof globalThis==='undefined'?this:globalThis,function(){
'use strict';
const types={Float32:Float32Array,Uint32:Uint32Array,Int32:Int32Array};
function decode(spec,buffer,facts){
  if(spec?.schema!=='imagine-packed/1'||spec.littleEndian!==true||!(buffer instanceof ArrayBuffer)||!Array.isArray(facts?.ids)||facts.ids.length!==spec.parcelCount)throw new Error('Unsupported precomputed parcel data.');
  const arrays={};
  for(const [name,s]of Object.entries(spec.arrays||{})){const T=types[s.type];if(!T||!Number.isSafeInteger(s.offset)||s.offset<0||s.offset%4||!Number.isSafeInteger(s.length)||s.length<0||s.offset+s.length*4>buffer.byteLength)throw new Error('Invalid parcel buffer '+name);arrays[name]=new T(buffer,s.offset,s.length);}
  const a=arrays,n=spec.parcelCount;
  if(a.bboxes?.length!==n*4||a.zoningHeights?.length!==n||a.viewMasks?.length!==n||a.viewUnknown?.length!==n||a.parcelOffsets?.length!==n+1||a.roofOffsets?.length!==n+1||a.positions?.length%2||!a.ringOffsets?.length||!a.polygonOffsets?.length||!a.roofIndices)throw new Error('Incomplete precomputed parcel arrays.');
  function sentinel(v,end){if(v[0]!==0||v[v.length-1]!==end)return false;for(let i=1;i<v.length;i++)if(v[i]<v[i-1])return false;return true;}
  if(!sentinel(a.parcelOffsets,a.polygonOffsets.length-1)||!sentinel(a.polygonOffsets,a.ringOffsets.length-1)||!sentinel(a.ringOffsets,a.positions.length/2)||!sentinel(a.roofOffsets,a.roofIndices.length))throw new Error('Invalid parcel geometry offsets.');
  for(const k of a.roofIndices)if(k>=a.positions.length/2)throw new Error('Invalid parcel roof index.');
  const coneIds=spec.classification?.coneIds||[], idIndex=new Map(),geometry=new Map();
  function polygons(i){if(geometry.has(i))return geometry.get(i);const out=[];for(let p=a.parcelOffsets[i];p<a.parcelOffsets[i+1];p++){const poly=[];for(let r=a.polygonOffsets[p];r<a.polygonOffsets[p+1];r++){const ring=[];for(let v=a.ringOffsets[r];v<a.ringOffsets[r+1];v++)ring.push([a.positions[v*2],a.positions[v*2+1]]);poly.push(ring);}out.push(poly);}geometry.set(i,out);return out;}
  const all=new Uint32Array(n),bounds=[Infinity,Infinity,-Infinity,-Infinity];
  const parcels=Array.from({length:n},(_,i)=>{const bbox=Array.from(a.bboxes.subarray(i*4,i*4+4));if(!bbox.every(Number.isFinite)||bbox[0]>bbox[2]||bbox[1]>bbox[3])throw new Error('Invalid parcel bounds.');all[i]=i;idIndex.set(String(facts.ids[i]),i);bounds[0]=Math.min(bounds[0],bbox[0]);bounds[1]=Math.min(bounds[1],bbox[1]);bounds[2]=Math.max(bounds[2],bbox[2]);bounds[3]=Math.max(bounds[3],bbox[3]);
    return {id:facts.ids[i],bbox,zoneIds:facts.zoneIds[i]||[],ruleId:facts.ruleIds[i],status:facts.statuses[i],zoningHeightM:Number.isFinite(a.zoningHeights[i])?a.zoningHeights[i]:null,_views:coneIds.filter((id,k)=>a.viewMasks[i]&(1<<k)),_viewUnknown:!!a.viewUnknown[i],get polygons(){return polygons(i);}};});
  const cells=new Map(),size=spec.tileIndex?.cellSize;
  if(!Number.isFinite(size)||size<=0||a.tileCells.length%2||a.tileOffsets.length!==a.tileCells.length/2+1||!sentinel(a.tileOffsets,a.tileParcels.length))throw new Error('Invalid parcel spatial index.');
  for(let i=0;i<a.tileCells.length/2;i++)cells.set(a.tileCells[i*2]+','+a.tileCells[i*2+1],i);
  for(const i of a.tileParcels)if(i>=n)throw new Error('Invalid parcel tile reference.');
  const meets=(b,q)=>b[0]<=q[2]&&b[2]>=q[0]&&b[1]<=q[3]&&b[3]>=q[1];
  function query(q){if(!q?.every(Number.isFinite))return [];if(q[0]<=bounds[0]&&q[1]<=bounds[1]&&q[2]>=bounds[2]&&q[3]>=bounds[3])return all;const found=new Set(),x0=Math.floor(q[0]/size),x1=Math.floor(q[2]/size),y0=Math.floor(q[1]/size),y1=Math.floor(q[3]/size);
    const add=t=>{for(let j=a.tileOffsets[t];j<a.tileOffsets[t+1];j++){const i=a.tileParcels[j];if(meets(parcels[i].bbox,q))found.add(i);}};
    if((x1-x0+1)*(y1-y0+1)>cells.size*2){for(const t of cells.values())add(t);}else for(let x=x0;x<=x1;x++)for(let y=y0;y<=y1;y++){const t=cells.get(x+','+y);if(t!==undefined)add(t);}return Array.from(found);
  }
  return {arrays,parcels,bounds,idIndex,query,all,get geometryCount(){return geometry.size;}};
}
function createEdits(ids,onChange,storage,key){
  const allowed=new Map(ids.map((id,i)=>[String(id),i])), values=new Map();let error=null;
  try{const saved=JSON.parse(storage?.getItem(key)||'null');if(saved?.version===1&&Array.isArray(saved.edits))for(const [id,h]of saved.edits)if(allowed.has(String(id))&&Number.isFinite(h)&&h>=0&&h<=2000)values.set(String(id),h);}catch(e){error=e?.name||'Storage error';}
  function save(){try{if(typeof storage?.setItem!=='function')throw new Error('Device storage unavailable');storage.setItem(key,JSON.stringify({version:1,edits:[...values]}));error=null;}catch(e){error=e?.name||'Storage error';}}
  return {values,get error(){return error;},set(id,h){id=String(id);if(!allowed.has(id))throw new Error('Parcel not found.');if(h!==null&&(!Number.isFinite(h)||h<0||h>2000))throw new Error('Enter a study height between 0 and 2,000 metres.');if(h===null)values.delete(id);else values.set(id,h);save();onChange?.(allowed.get(id),h);return {id,heightM:h,saved:!error};},get(id){return values.get(String(id))??null;}};
}
function createCache(storage,timeoutMs=10000){
  function run(mode,key,value){if(!storage)return Promise.resolve({status:'unavailable'});return new Promise(resolve=>{let db,done=false,tx;const finish=v=>{if(done)return;done=true;clearTimeout(timer);try{db?.close();}catch(_){}resolve(v);};const timer=setTimeout(()=>{finish({status:'unavailable'});try{tx?.abort();}catch(_){}},timeoutMs);
    try{const req=storage.open('vista-imagine-packed',1);req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains('public'))req.result.createObjectStore('public');};req.onerror=req.onblocked=()=>finish({status:'unavailable'});req.onsuccess=()=>{db=req.result;if(done){db.close();return;}db.onversionchange=()=>db.close();try{tx=db.transaction('public',mode);const store=tx.objectStore('public');let result={status:'miss'};if(mode==='readwrite')store.put({key,buffer:value.buffer,factsText:value.factsText,policyText:value.policyText},'current');else{const get=store.get('current');get.onsuccess=()=>{if(get.result?.key===key)result={status:'hit',value:get.result};};}tx.oncomplete=()=>finish(mode==='readwrite'?{status:'saved'}:result);tx.onerror=tx.onabort=()=>finish({status:'unavailable'});}catch(_){finish({status:'unavailable'});}};}catch(_){finish({status:'unavailable'});}
  });}
  return {read:key=>run('readonly',key),write:(key,value)=>run('readwrite',key,value)};
}
return {decode,createEdits,createCache};
});
