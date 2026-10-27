/* Dependencies between separately modelled elevated building parts, in metres. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.BuildingAssembly=api;})(typeof globalThis==='undefined'?this:globalThis,function(){
'use strict';
const EPS=1e-6;
const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
function validBox(b){return Array.isArray(b)&&b.length===6&&b.every(Number.isFinite)&&b[0]<=b[3]&&b[1]<=b[4]&&b[2]<=b[5];}
function clearance(record){return Number.isFinite(record.height)?Math.max(0,record.height-(record.box[5]-record.box[2])):0;}

function projectedTriangles(record){
  if(Array.isArray(record.triangles))return record.triangles.filter(t=>Array.isArray(t)&&t.length===3&&t.every(p=>Array.isArray(p)&&p.length>=2&&p.slice(0,2).every(Number.isFinite))&&Math.abs(cross(...t))>EPS);
  const mesh=record.mesh;if(!mesh?.pos||!mesh?.idx)return [];
  const triangles=[],seen=new Set(),start=record.start||0,end=Math.min(mesh.idx.length,start+(record.count||0));
  for(let i=start;i+2<end;i+=3){
    const t=[mesh.idx[i],mesh.idx[i+1],mesh.idx[i+2]].map(v=>[mesh.pos[v*3],mesh.pos[v*3+1]]);
    if(!t.every(p=>p.every(Number.isFinite))||Math.abs(cross(...t))<=EPS)continue;
    const key=t.map(p=>p.join(',')).sort().join(';');if(seen.has(key))continue;seen.add(key);triangles.push(t);
  }
  return triangles;
}

/* Convex clipping checks occupied plan geometry; bbox intersections alone are insufficient. */
function intersectionArea(a,b){
  let out=a;const sign=cross(...b)>0?1:-1;
  for(let i=0;i<3&&out.length;i++){
    const p=b[i],q=b[(i+1)%3],input=out;out=[];
    for(let j=0;j<input.length;j++){
      const s=input[j],e=input[(j+1)%input.length],ds=sign*cross(p,q,s),de=sign*cross(p,q,e);
      if(ds>=-EPS)out.push(s);
      if((ds>=-EPS)!==(de>=-EPS)){
        const k=ds/(ds-de);out.push([s[0]+k*(e[0]-s[0]),s[1]+k*(e[1]-s[1])]);
      }
    }
  }
  let area=0;for(let i=0;i<out.length;i++){const p=out[i],q=out[(i+1)%out.length];area+=p[0]*q[1]-q[0]*p[1];}return Math.abs(area)/2;
}
function sharedEdgeLength(a,b,c,d){
  const dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy);if(length<EPS)return 0;
  if(Math.abs(cross(a,b,c))/length>0.01||Math.abs(cross(a,b,d))/length>0.01)return 0;
  const project=p=>((p[0]-a[0])*dx+(p[1]-a[1])*dy)/length;
  const u=project(c),v=project(d);return Math.max(0,Math.min(length,Math.max(u,v))-Math.max(0,Math.min(u,v)));
}
function planContact(a,b,triangles){
  const ta=triangles(a),tb=triangles(b);
  for(const x of ta)for(const y of tb){
    if(intersectionArea(x,y)>0.05)return true;
    for(let i=0;i<3;i++)for(let j=0;j<3;j++)if(sharedEdgeLength(x[i],x[(i+1)%3],y[j],y[(j+1)%3])>=0.5)return true;
  }
  return false;
}

function createGraph(input){
  const records=(Array.isArray(input)?input:[]).filter(r=>r&&typeof r.key==='string'&&validBox(r.box));
  const byKey=new Map(records.map(r=>[r.key,r])),supports=new Map(),cache=new Map(),buckets=new Map(),overflow=[];
  const cells=b=>[Math.floor(b[0]/100),Math.floor(b[1]/100),Math.floor(b[3]/100),Math.floor(b[4]/100)];
  for(const r of records){
    const [x0,y0,x1,y1]=cells(r.box);if((x1-x0+1)*(y1-y0+1)>1024){overflow.push(r);continue;}
    for(let x=x0;x<=x1;x++)for(let y=y0;y<=y1;y++){const key=x+','+y;if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(r);}
  }
  const triangles=r=>{if(!cache.has(r.key))cache.set(r.key,projectedTriangles(r));return cache.get(r.key);};
  for(const part of records){
    if(clearance(part)<=2)continue;
    const b=part.box,[x0,y0,x1,y1]=cells([b[0]-.01,b[1]-.01,b[2],b[3]+.01,b[4]+.01,b[5]]),candidates=new Set(overflow);
    if((x1-x0+1)*(y1-y0+1)>1024)for(const r of records)candidates.add(r);
    else for(let x=x0;x<=x1;x++)for(let y=y0;y<=y1;y++)for(const r of buckets.get(x+','+y)||[])candidates.add(r);
    const parents=new Set();
    for(const parent of candidates){
      const p=parent.box;
      if(parent.key===part.key||p[2]>=b[2]-2||p[5]<b[2]-1||p[3]<b[0]-.01||p[0]>b[3]+.01||p[4]<b[1]-.01||p[1]>b[4]+.01)continue;
      // Separate rebasing at footprint centres can move related parts by a few metres.
      // A common estimated ground avoids linking stacked but unrelated context objects.
      if(!Number.isFinite(parent.height)||Math.abs((b[5]-part.height)-(p[5]-parent.height))>5)continue;
      if(planContact(part,parent,triangles))parents.add(parent.key);
    }
    if(parents.size)supports.set(part.key,parents);
  }
  return {records:byKey,supports};
}

/* A bridge stays while any modelled support survives. Unresolved parts stay visible. */
function expandRemoved(graph,initial){
  const removed=new Set(initial||[]);let changed=true;
  while(changed){changed=false;for(const [key,parents] of graph.supports){if(removed.has(key)||!parents.size)continue;if([...parents].every(parent=>removed.has(parent))){removed.add(key);changed=true;}}}
  return removed;
}

/* Display cleanup for thin source fragments with no modelled support. A missing
   support is not enough to discard a tall volume or a part of uncertain height.
   The source meshes remain unchanged; callers can omit these index ranges. */
function unsupportedParts(graph){
  const roots=[];
  for(const [key,record] of graph.records){
    const span=record.box[5]-record.box[2],raised=clearance(record);
    const measured=record.heightSource===0||record.heightSource==='measured';
    if(!measured||raised<=2||span>20+EPS||span>raised+EPS||graph.supports.has(key))continue;
    if(projectedTriangles(record).length)roots.push(key);
  }
  return expandRemoved(graph,roots);
}

/* Derived render indices only: source mesh and catalogue arrays stay intact. */
function compactIndex(indices,offsets,counts,omittedRows){
  if(!indices||!offsets||!counts||offsets.length!==counts.length)throw new TypeError('Matching index offsets and counts are required');
  const omitted=new Set(omittedRows||[]),index_offset=[],index_count=[];let total=0;
  for(let row=0;row<offsets.length;row++){
    const start=offsets[row],count=counts[row];
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(count)||start<0||count<0||start+count>indices.length)throw new RangeError('Invalid mesh index range for record '+row);
    index_offset.push(total);index_count.push(omitted.has(row)?0:count);total+=index_count[row];
  }
  const idx=new Uint32Array(total);
  for(let row=0;row<offsets.length;row++){
    const count=index_count[row];if(!count)continue;
    const source=indices.subarray?indices.subarray(offsets[row],offsets[row]+count):indices.slice(offsets[row],offsets[row]+count);
    idx.set(source,index_offset[row]);
  }
  return {idx,index_offset,index_count};
}
return {createGraph,expandRemoved,unsupportedParts,compactIndex,clearance};
});
