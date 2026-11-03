/* Derived render attributes only. Original mesh/catalogue geometry is never changed. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.FacadeBounds=api;})(typeof globalThis==='undefined'?this:globalThis,function(){
'use strict';
const INVALID=Object.freeze([1,-1,1,-1]);
const WELD=.005,PLANE=.005,NORMAL_DOT=.999999,RECT=.001,INSET=.015;

/* Every accepted patch is a connected, consistently triangulated rectangular
   disk. A bbox or summed triangle area alone cannot prove this: overlapping
   triangles can hide holes. Boundary topology, directed interior edges, the
   complete rectangular perimeter, and area are checked together below.
   Ambiguous/nonrectangular patches intentionally keep cladding without panes. */
function rectangle(triangles,vertices,tangent,stats){
  const edges=new Map(),used=new Set();let area=0;
  const point=id=>{const p=vertices[id];return [p[0]*tangent[0]+p[1]*tangent[1],p[2]];};
  for(const triangle of triangles){
    let ids=triangle.weld.slice(),p=ids.map(point);
    const signed=(p[1][0]-p[0][0])*(p[2][1]-p[0][1])-(p[1][1]-p[0][1])*(p[2][0]-p[0][0]);
    if(!Number.isFinite(signed)||Math.abs(signed)<1e-9)return null;
    area+=Math.abs(signed)/2;if(signed<0)ids=[ids[0],ids[2],ids[1]];
    for(let j=0;j<3;j++){
      const a=ids[j],b=ids[(j+1)%3],key=a<b?a+','+b:b+','+a;used.add(a);used.add(b);
      let e=edges.get(key);if(!e){e=[];edges.set(key,e);}e.push([a,b]);
    }
  }
  const boundary=[],neighbours=new Map();
  for(const e of edges.values()){
    if(e.length>2){stats.nonManifoldPatches++;return null;}
    if(e.length===2){if(e[0][0]!==e[1][1]||e[0][1]!==e[1][0])return null;continue;}
    const [a,b]=e[0];boundary.push([a,b]);
    for(const [x,y]of [[a,b],[b,a]]){if(!neighbours.has(x))neighbours.set(x,[]);neighbours.get(x).push(y);}
  }
  if(boundary.length<4||[...neighbours.values()].some(n=>n.length!==2))return null;
  // A single closed boundary excludes disconnected loops and holes.
  const visited=new Set(),start=boundary[0][0];let previous=-1,current=start;
  do {if(visited.has(current))return null;visited.add(current);const n=neighbours.get(current);const next=n[0]===previous?n[1]:n[0];previous=current;current=next;}while(current!==start);
  if(visited.size!==neighbours.size)return null;
  let loU=Infinity,hiU=-Infinity,loZ=Infinity,hiZ=-Infinity;
  for(const id of used){const [u,z]=point(id);loU=Math.min(loU,u);hiU=Math.max(hiU,u);loZ=Math.min(loZ,z);hiZ=Math.max(hiZ,z);}
  if(hiU-loU<=INSET*2||hiZ-loZ<=INSET*2)return null;
  const sideLength=[0,0,0,0];
  for(const [a,b]of boundary){
    const p=point(a),q=point(b),du=Math.abs(p[0]-q[0]),dz=Math.abs(p[1]-q[1]);
    if(du<=RECT&&Math.abs(p[0]-loU)<=RECT&&Math.abs(q[0]-loU)<=RECT)sideLength[0]+=dz;
    else if(du<=RECT&&Math.abs(p[0]-hiU)<=RECT&&Math.abs(q[0]-hiU)<=RECT)sideLength[1]+=dz;
    else if(dz<=RECT&&Math.abs(p[1]-loZ)<=RECT&&Math.abs(q[1]-loZ)<=RECT)sideLength[2]+=du;
    else if(dz<=RECT&&Math.abs(p[1]-hiZ)<=RECT&&Math.abs(q[1]-hiZ)<=RECT)sideLength[3]+=du;
    else return null;
  }
  const width=hiU-loU,height=hiZ-loZ;
  if(sideLength.some((v,i)=>Math.abs(v-(i<2?height:width))>RECT*4))return null;
  if(Math.abs(area-width*height)>Math.max(1e-6,(width+height)*RECT*2))return null;
  // Small inset covers coordinate welding, Float32 rounding and tiny plane noise.
  return [loU+INSET,hiU-INSET,loZ+INSET,hiZ-INSET];
}

function build(rawMesh,catalogue,options={}){
  const source=rawMesh?.pos,indices=rawMesh?.idx,c=catalogue?.columns;
  if(!source||!indices||source.length%3||indices.length%3||!c||!Array.isArray(c.index_offset)||!Array.isArray(c.index_count)||c.index_offset.length!==c.index_count.length)throw new TypeError('FacadeBounds requires positions, triangle indices and matching catalogue ranges');
  const vertexCount=source.length/3,triangleCount=indices.length/3;
  for(const value of indices)if(!Number.isInteger(value)||value<0||value>=vertexCount)throw new RangeError('FacadeBounds index outside source positions');
  const triPatch=new Uint32Array(triangleCount),owned=new Uint8Array(triangleCount),bounds=[INVALID],patchAngles=[0];
  const stats={rows:c.index_offset.length,triangles:triangleCount,sourceVertices:vertexCount,renderVertices:vertexCount,splitVertices:0,wallTriangles:0,acceptedWallTriangles:0,patches:0,rectangularPatches:0,suppressedPatches:0,nonManifoldPatches:0,degenerateTriangles:0,unassignedTriangles:0,limitsCoordinates:'canonical horizontal wall tangent dot world XY; absolute world Z',weldToleranceM:WELD,limitsInsetM:INSET};
  for(let row=0;row<c.index_offset.length;row++){
    const start=c.index_offset[row],count=c.index_count[row],end=start+count;
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(count)||start<0||count<0||start%3||count%3||end>indices.length)throw new RangeError('Invalid FacadeBounds catalogue range '+row);
    if(!count)continue;
    const vertices=[],buckets=new Map(),welded=new Map(),triangles=[],edgeTriangles=new Map();
    function weld(index){
      if(welded.has(index))return welded.get(index);
      const p=[source[index*3],source[index*3+1],source[index*3+2]];
      if(!p.every(Number.isFinite))return -1;
      const cell=p.map(v=>Math.floor(v/WELD));let found=-1;
      for(let x=-1;x<=1&&found<0;x++)for(let y=-1;y<=1&&found<0;y++)for(let z=-1;z<=1&&found<0;z++)for(const candidate of buckets.get((cell[0]+x)+','+(cell[1]+y)+','+(cell[2]+z))||[]){const q=vertices[candidate];if(Math.hypot(p[0]-q[0],p[1]-q[1],p[2]-q[2])<=WELD){found=candidate;break;}}
      if(found<0){found=vertices.length;vertices.push(p);const key=cell.join(',');if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(found);}
      welded.set(index,found);return found;
    }
    for(let at=start;at<end;at+=3){
      const global=at/3;if(owned[global])throw new RangeError('Overlapping FacadeBounds catalogue ranges');owned[global]=1;
      const ids=[indices[at],indices[at+1],indices[at+2]],p=ids.map(id=>[source[id*3],source[id*3+1],source[id*3+2]]);
      const u=p[1].map((v,i)=>v-p[0][i]),v=p[2].map((v,i)=>v-p[0][i]);
      let normal=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],length=Math.hypot(...normal);
      if(!Number.isFinite(length)||length<1e-9){stats.degenerateTriangles++;continue;}
      if(Math.abs(normal[2])/length>.25)continue;
      normal=normal.map(v=>v/length);if(normal[0]<-1e-9||(Math.abs(normal[0])<=1e-9&&normal[1]<0))normal=normal.map(v=>-v);
      const weldIds=ids.map(weld);if(weldIds.some(id=>id<0)||new Set(weldIds).size<3){stats.degenerateTriangles++;continue;}
      const id=triangles.length,t={global,normal,p,weld:weldIds};triangles.push(t);stats.wallTriangles++;
      for(let j=0;j<3;j++){const a=weldIds[j],b=weldIds[(j+1)%3],key=a<b?a+','+b:b+','+a;if(!edgeTriangles.has(key))edgeTriangles.set(key,[]);edgeTriangles.get(key).push(id);}
    }
    const neighbours=triangles.map(()=>[]);
    for(const list of edgeTriangles.values()){
      if(list.length>2)for(const id of list)triangles[id].nonManifold=true;
      if(list.length===2){neighbours[list[0]].push(list[1]);neighbours[list[1]].push(list[0]);}
    }
    const seen=new Uint8Array(triangles.length);
    for(let seed=0;seed<triangles.length;seed++){
      if(seen[seed])continue;seen[seed]=1;const anchor=triangles[seed],patch=[],queue=[seed];
      for(let q=0;q<queue.length;q++){
        const id=queue[q];patch.push(triangles[id]);
        for(const next of neighbours[id]){
          if(seen[next])continue;const t=triangles[next],dot=t.normal.reduce((s,v,i)=>s+v*anchor.normal[i],0);
          if(dot<NORMAL_DOT||t.p.some(p=>Math.abs(p.reduce((s,v,i)=>s+(v-anchor.p[0][i])*anchor.normal[i],0))>PLANE))continue;
          seen[next]=1;queue.push(next);
        }
      }
      const h=Math.hypot(anchor.normal[0],anchor.normal[1]);let tangent=[anchor.normal[1]/h,-anchor.normal[0]/h];
      if(tangent[0]<-1e-9||(Math.abs(tangent[0])<=1e-9&&tangent[1]<0))tangent=tangent.map(v=>-v);
      // Share the exact Float32 angle with the shader; derivative normals can
      // otherwise shift a world-space grid appreciably at large coordinates.
      const angle=Math.fround(Math.atan2(tangent[1],tangent[0]));tangent=[Math.cos(angle),Math.sin(angle)];
      stats.patches++;let limits=null;
      if(patch.some(t=>t.nonManifold))stats.nonManifoldPatches++;
      else limits=rectangle(patch,vertices,tangent,stats);
      // Suppressed wall patches still need their real tangent for cladding.
      // INVALID limits disable openings without changing material projection.
      const patchId=bounds.length;bounds.push(limits||INVALID);patchAngles.push(angle);
      for(const t of patch)triPatch[t.global]=patchId;
      if(limits){stats.rectangularPatches++;stats.acceptedWallTriangles+=patch.length;}
      else stats.suppressedPatches++;
    }
  }
  for(const value of owned)if(!value)stats.unassignedTriangles++;
  // Split a shared source vertex only when its incident triangles require
  // different flat bounds. Triangle order/count and every row range survive.
  const primary=new Int32Array(vertexCount);primary.fill(-1);
  const extraSources=[],extraPatches=[],duplicates=new Map(),idx=new Uint32Array(indices.length);
  for(let at=0;at<indices.length;at++){
    const original=indices[at],patch=triPatch[Math.floor(at/3)];
    if(primary[original]===-1){primary[original]=patch;idx[at]=original;}
    else if(primary[original]===patch)idx[at]=original;
    else {const key=original+','+patch;let mapped=duplicates.get(key);if(mapped===undefined){mapped=vertexCount+extraSources.length;duplicates.set(key,mapped);extraSources.push(original);extraPatches.push(patch);}idx[at]=mapped;}
  }
  const total=vertexCount+extraSources.length,pos=new Float32Array(total*3),limits=new Float32Array(total*4),angles=new Float32Array(total),sourceVertex=new Uint32Array(total);pos.set(source);
  for(let i=0;i<total;i++){
    const original=i<vertexCount?i:extraSources[i-vertexCount],patch=i<vertexCount?Math.max(0,primary[i]):extraPatches[i-vertexCount];sourceVertex[i]=original;limits.set(bounds[patch],i*4);angles[i]=patchAngles[patch];
    if(i>=vertexCount)for(let axis=0;axis<3;axis++)pos[i*3+axis]=source[original*3+axis];
  }
  stats.renderVertices=total;stats.splitVertices=extraSources.length;
  return {pos,idx,limits,angles,sourceVertex,stats};
}
return {build,INVALID};
});
