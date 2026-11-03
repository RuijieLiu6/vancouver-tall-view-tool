/* Cadastral source matching for private imports. Never derives property lines from meshes. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.ImportParcels=api;})(typeof globalThis==='undefined'?this:globalThis,function(){
'use strict';
const workerURL=typeof document!=='undefined'&&document.currentScript?.src?new URL('import-parcels-worker.js',document.currentScript.src).href:null;
const MAX_TRIANGLES=2500000,MAX_SOURCE_TRIANGLES=6000000,MAX_CANDIDATES=256,MAX_TESTS=1500000;
const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
const same=(a,b)=>a[0]===b[0]&&a[1]===b[1];
// Confirm a rounded zero determinant with exact binary arithmetic. This never snaps GIS coordinates.
const floatBits=new DataView(new ArrayBuffer(8));
function dyadic(x){floatBits.setFloat64(0,x);const bits=floatBits.getBigUint64(0),exp=Number((bits>>52n)&2047n),fraction=bits&((1n<<52n)-1n);return [(bits>>63n?-1n:1n)*(exp?fraction+(1n<<52n):fraction),exp?exp-1075:-1074];}
function exactCollinear(a,b,c){if(same(a,b))return true;if(cross(a,b,c)!==0)return false;if(a[0]===b[0])return c[0]===a[0];if(a[1]===b[1])return c[1]===a[1];const values=[...a,...b,...c].map(dyadic),exponent=Math.min(...values.map(v=>v[1])),n=values.map(v=>v[0]<<BigInt(v[1]-exponent));return (n[2]-n[0])*(n[5]-n[1])===(n[3]-n[1])*(n[4]-n[0]);}

const on=(a,b,p)=>Math.abs(cross(a,b,p))<1e-8&&p[0]>=Math.min(a[0],b[0])&&p[0]<=Math.max(a[0],b[0])&&p[1]>=Math.min(a[1],b[1])&&p[1]<=Math.max(a[1],b[1]);
function ringState(p,r){let inside=false;for(let i=0,j=r.length-1;i<r.length;j=i++){const a=r[j],b=r[i];if(on(a,b,p))return 2;if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;}return inside?1:0;}
function inPoly(p,poly){const s=ringState(p,poly[0]);if(s!==1)return s===2;for(const h of poly.slice(1)){const v=ringState(p,h);if(v)return v===2;}return true;}
function meets(a,b,c,d){return on(a,b,c)||on(a,b,d)||on(c,d,a)||on(c,d,b)||(cross(a,b,c)*cross(a,b,d)<0&&cross(c,d,a)*cross(c,d,b)<0);}
const edges=r=>r.map((a,i)=>[a,r[(i+1)%r.length]]).filter(([a,b])=>!same(a,b));
const bounds=r=>r.reduce((b,p)=>[Math.min(b[0],p[0]),Math.min(b[1],p[1]),Math.max(b[2],p[0]),Math.max(b[3],p[1])],[Infinity,Infinity,-Infinity,-Infinity]);
const overlaps=(a,b)=>a[0]<=b[2]&&a[2]>=b[0]&&a[1]<=b[3]&&a[3]>=b[1];
function touches(triangle,poly){return triangle.some(p=>inPoly(p,poly))||poly[0].some(p=>ringState(p,triangle)>0)||poly.some(r=>edges(r).some(([c,d])=>edges(triangle).some(([a,b])=>meets(a,b,c,d))));}
// Capture only references: projection and de-duplication run in the lookup worker.
function capture(parts){if(!Array.isArray(parts)||parts.length>4096)return {status:'review',reason:'The model has too many parts for automatic matching.'};let count=0;for(const p of parts){if(!p.indices||!p.positions||!Number.isSafeInteger(p.indices.length)||p.indices.length%3||!Number.isSafeInteger(p.positions.length)||p.positions.length%3)return {status:'review',reason:'The mesh index data needs review.'};count+=p.indices.length/3;}if(count>MAX_SOURCE_TRIANGLES)return {status:'review',reason:'This model exceeds the automatic parcel processing limit.'};return {parts:parts.map(p=>({positions:p.positions,indices:p.indices}))};}
async function prepareCapture(captured,{yieldFrame=()=>new Promise(r=>setTimeout(r,0)),cancelled=()=>false}={}){
  if(captured?.triangles||captured?.projected)return captured;
  if(!captured?.parts)return captured;
  const checked=capture(captured.parts);if(!checked.parts)return checked;
  const chunks=[],seen=new Set(),chunkSize=49152,box=[Infinity,Infinity,-Infinity,-Infinity];let chunk=new Float64Array(chunkSize),used=0,projectedCount=0,count=0,degenerate=0,duplicates=0,dedup=true;
  for(const p of checked.parts)for(let i=0;i<p.indices.length;i+=3){
    const t=[];for(let k=0;k<3;k++){const index=p.indices[i+k];if(!Number.isSafeInteger(index)||index<0||index*3+2>=p.positions.length)return {status:'review',reason:'The mesh contains an invalid vertex index.'};const j=index*3,x=p.positions[j],y=p.positions[j+1];if(!Number.isFinite(x)||!Number.isFinite(y))return {status:'review',reason:'The model has invalid horizontal coordinates.'};t.push([x,y]);}
    count++;if(exactCollinear(t[0],t[1],t[2]))degenerate++;else {
      // Exact coordinate keys preserve tiny gaps; vertex order and height do not change a footprint.
      const key=dedup?t.map(p=>JSON.stringify(p)).sort().join('|'):null;
      if(dedup&&seen.has(key))duplicates++;else {
        if(dedup){seen.add(key);if(seen.size>=250000){seen.clear();dedup=false;}}
        projectedCount++;if(projectedCount>MAX_TRIANGLES)return {status:'review',reason:'The projected model exceeds the automatic parcel processing limit.'};
        if(used===chunkSize){chunks.push(chunk);chunk=new Float64Array(chunkSize);used=0;}
        for(const [x,y]of t){chunk[used++]=x;chunk[used++]=y;box[0]=Math.min(box[0],x);box[1]=Math.min(box[1],y);box[2]=Math.max(box[2],x);box[3]=Math.max(box[3],y);}
      }
    }
    if(count%4096===0){await yieldFrame();if(cancelled())return null;}
  }
  const projected=new Float64Array(projectedCount*6);let cursor=0;for(const c of chunks){projected.set(c,cursor);cursor+=c.length;}projected.set(chunk.subarray(0,used),cursor);
  return {projected,bbox:box,stats:{sourceTriangles:count,projectedTriangles:projectedCount,degenerateTriangles:degenerate,duplicateTriangles:duplicates,deduplicationComplete:dedup}};
}
const area=r=>r.reduce((sum,p,i)=>{const q=r[(i+1)%r.length];return sum+p[0]*q[1]-q[0]*p[1];},0)/2;
/* Split exactly coincident segments before shared-edge cancellation. Ambiguous topology stays explicit. */
function union(parcels){const original=parcels.flatMap(p=>p.polygons), all=[];for(let pi=0;pi<original.length;pi++)for(let ri=0;ri<original[pi].length;ri++){let r=original[pi][ri].slice();if(same(r[0],r[r.length-1]))r.pop();if(r.length<3||!area(r))return null;if((area(r)>0)!==(ri===0))r.reverse();for(const [a,b]of edges(r))all.push({a,b,pi});}
  if(all.length>600)return null;
  const splits=all.map(e=>[e.a,e.b]);
  // No snapping tolerance: nearly adjacent source boundaries must never become fake bridges.
  const exactOn=(a,b,p)=>exactCollinear(a,b,p)&&p[0]>=Math.min(a[0],b[0])&&p[0]<=Math.max(a[0],b[0])&&p[1]>=Math.min(a[1],b[1])&&p[1]<=Math.max(a[1],b[1]);
  for(let i=0;i<all.length;i++)for(let j=i+1;j<all.length;j++){
    const a=all[i],b=all[j];if(a.pi===b.pi)continue;
    if(exactCollinear(a.a,a.b,b.a)&&exactCollinear(a.a,a.b,b.b)){
      for(const p of [b.a,b.b])if(exactOn(a.a,a.b,p))splits[i].push(p);
      for(const p of [a.a,a.b])if(exactOn(b.a,b.b,p))splits[j].push(p);
    }else if(cross(a.a,a.b,b.a)*cross(a.a,a.b,b.b)<0&&cross(b.a,b.b,a.a)*cross(b.a,b.b,a.b)<0)return null;
  }
  const segmented=[];for(let i=0;i<all.length;i++){
    const e=all[i],axis=e.a[0]!==e.b[0]?0:1,sign=Math.sign(e.b[axis]-e.a[axis]);
    const points=splits[i].sort((a,b)=>(a[axis]-b[axis])*sign).filter((p,j,a)=>!j||!same(p,a[j-1]));
    for(let j=1;j<points.length;j++)segmented.push({a:points[j-1],b:points[j],pi:e.pi});
  }
  // Interior overlap/containment cannot be resolved by shared-edge cancellation.
  for(let i=0;i<original.length;i++)for(let j=i+1;j<original.length;j++)for(const [a,b]of [[original[i],original[j]],[original[j],original[i]]])if(a[0].some(p=>ringState(p,b[0])===1&&!b.slice(1).some(h=>ringState(p,h))))return null;
  const key=p=>JSON.stringify(p),pending=new Map();for(const e of segmented){const k=key(e.a)+'|'+key(e.b),rev=key(e.b)+'|'+key(e.a);if(pending.has(rev))pending.delete(rev);else if(pending.has(k))return null;else pending.set(k,e);}
  const next=new Map();for(const e of pending.values()){const k=key(e.a);if(next.has(k))return null;next.set(k,e);}
  const rings=[];while(next.size){const first=next.values().next().value,r=[],start=key(first.a);let e=first,closed=false;while(e){const k=key(e.a);if(!next.has(k))return null;r.push(e.a);next.delete(k);if(key(e.b)===start){closed=true;break;}e=next.get(key(e.b));}if(!closed||r.length<3)return null;rings.push(r);}
  const out=rings.filter(r=>area(r)>0).map(r=>[r]);for(const h of rings.filter(r=>area(r)<0)){const owners=out.filter(p=>ringState(h[0],p[0])>0).sort((a,b)=>Math.abs(area(a[0]))-Math.abs(area(b[0])));if(!owners.length)return null;owners[0].push(h);}return out.length?out:null;
}
async function match(captured,offset,data,{yieldFrame=()=>new Promise(r=>setTimeout(r,0)),cancelled=()=>false}={}){captured=await prepareCapture(captured,{yieldFrame,cancelled});if(cancelled()||captured===null)return null;if(!captured?.triangles&&!captured?.projected)return {status:'review',reason:captured?.reason||'Model footprint unavailable.',polygons:[],ids:[]};if(!offset?.every(Number.isFinite))return {status:'unlocated',reason:'Place the model on the site before matching property lines.',polygons:[],ids:[]};
  const count=captured.projected?captured.projected.length/6:captured.triangles.length;
  if(!count)return {status:'none',reason:'The model has no nondegenerate horizontal footprint.',polygons:[],ids:[]};
  const triangleAt=i=>captured.projected?[[captured.projected[i*6]+offset[0],captured.projected[i*6+1]+offset[1]],[captured.projected[i*6+2]+offset[0],captured.projected[i*6+3]+offset[1]],[captured.projected[i*6+4]+offset[0],captured.projected[i*6+5]+offset[1]]]:captured.triangles[i].map(p=>[p[0]+offset[0],p[1]+offset[1]]);
  const rawBox=captured.bbox||bounds(captured.triangles.flat()),box=[rawBox[0]+offset[0],rawBox[1]+offset[1],rawBox[2]+offset[0],rawBox[3]+offset[1]],candidates=[];
  for(let i=0;i<data.parcels.length;i++){if(overlaps(data.parcels[i].bbox,box))candidates.push(data.parcels[i]);if(candidates.length>MAX_CANDIDATES)return {status:'review',reason:'The model covers too many parcels for automatic matching.',polygons:[],ids:[]};if(i%3000===0){await yieldFrame();if(cancelled())return null;}}
  const found=[];let tests=0,work=0;for(const p of candidates){const complexity=p.polygons.reduce((n,poly)=>n+poly.reduce((m,r)=>m+r.length,0),0);if(complexity>3000)return {status:'review',reason:'Complex parcel topology needs explicit review.',polygons:[],ids:[]};let hit=false;for(let i=0;i<count&&!hit;i++){tests++;const triangle=triangleAt(i),overlap=overlaps(p.bbox,bounds(triangle));if(overlap)work+=complexity;if(work>MAX_TESTS)return {status:'review',reason:'Automatic matching reached its work limit; select parcels explicitly.',polygons:[],ids:[]};if(overlap)hit=p.polygons.some(poly=>touches(triangle,poly));if(tests%4096===0){await yieldFrame();if(cancelled())return null;}}if(hit)found.push(p);}
  if(cancelled())return null;if(!found.length)return {status:'none',reason:'No source property parcels touch the located mesh.',polygons:[],ids:[]};const merged=union(found);return {status:merged?'matched':'matched-review',reason:merged?'Source property parcels joined; dated approximate cadastral snapshot.':'Matched source parcels shown separately; joining needs review.',polygons:merged||found.flatMap(p=>p.polygons),ids:found.map(p=>p.id),source:data.metadata};
}
function matchAsync(captured,offset,dataURL,{WorkerClass=typeof Worker==='undefined'?null:Worker,url=workerURL,timeoutMs=20000}={}){
  let worker,timer,settled=false,finish;
  const promise=new Promise((resolve,reject)=>{finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);worker?.terminate();error?reject(error):resolve(value);};
    if(!WorkerClass||!url){finish(new Error('Automatic property lookup needs browser worker support.'));return;}
    try{worker=new WorkerClass(url);worker.onmessage=event=>{const m=event.data;if(m?.error)finish(new Error(m.error));else finish(null,m?.result);};worker.onerror=()=>finish(new Error('Property parcel worker could not run.'));timer=setTimeout(()=>finish(new Error('Property parcel lookup timed out.')),timeoutMs);worker.postMessage({captured,offset,dataURL});}catch(error){finish(error);}
  });
  return {promise,cancel:()=>finish(null,null)};
}
return {capture,prepareCapture,match,union,matchAsync,touches};
});
