/* Display-only view-corridor clipping, in Vista metres and Z up.
 * An affine {a,b,c} plane is already aligned model Z: z=a*x+b*y+c.
 * Legacy elevation/bearing/pitch planes require explicit datum alignment.
 * These operations establish geometry, never regulatory certainty or a legal height.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ViewconeGeometry = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const finite = v => typeof v === 'number' && Number.isFinite(v);
  const array = v => Array.isArray(v) || ArrayBuffer.isView(v);
  const empty = () => new Float32Array(0);
  const cross = (a,b,c) => (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  const sub = (a,b) => a.map((v,k)=>v-b[k]);
  const dot = (a,b) => a.reduce((s,v,k)=>s+v*b[k],0);
  const cross3 = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const norm = a => Math.hypot(...a);
  const near3 = (a,b,e=1e-7) => norm(sub(a,b))<=e;
  const overlapBounds=(p,b)=>Math.max(...p.map(q=>q[0]))>=b[0]&&Math.min(...p.map(q=>q[0]))<=b[2]&&Math.max(...p.map(q=>q[1]))>=b[1]&&Math.min(...p.map(q=>q[1]))<=b[3];
  const area = p => {let a=0;for(let i=1;i+1<p.length;i++)a+=cross(p[0],p[i],p[i+1]);return a/2;};
  function budget(options) {
    let work=0;
    const limit=finite(options.maxWork)&&options.maxWork>0?Math.min(options.maxWork,5000000):1000000;
    return {tick(n=1){work+=n;if(work>limit)throw new Error('geometry_work_limit');},get work(){return work;}};
  }
  function clean(p,eps) {
    const out=p.filter((v,i)=>!i||!near3(v,p[i-1],eps));
    if(out.length>1&&near3(out[0],out[out.length-1],eps))out.pop();return out;
  }
  function normalizePolygon(raw,b) {
    if(!Array.isArray(raw)||raw.length<3||raw.length>512||raw.some(p=>!array(p)||p.length<2||!finite(p[0])||!finite(p[1])))throw new Error('invalid_corridor_polygon');
    let p=clean(raw.map(q=>[q[0],q[1]]),1e-8);
    if(p.length<3)throw new Error('invalid_corridor_polygon');
    const xs=p.map(q=>q[0]),ys=p.map(q=>q[1]),scale=Math.max(1,Math.max(...xs)-Math.min(...xs),Math.max(...ys)-Math.min(...ys));
    const eps=scale*1e-10,aeps=scale*scale*1e-12;
    const on=(a,c,v)=>Math.abs(cross(a,c,v))<=aeps&&v[0]>=Math.min(a[0],c[0])-eps&&v[0]<=Math.max(a[0],c[0])+eps&&v[1]>=Math.min(a[1],c[1])-eps&&v[1]<=Math.max(a[1],c[1])+eps;
    for(let i=0;i<p.length;i++)for(let j=i+1;j<p.length;j++){
      if(j===i+1||(i===0&&j===p.length-1))continue;b.tick();
      const a=p[i],c=p[(i+1)%p.length],d=p[j],e=p[(j+1)%p.length],u=cross(a,c,d),v=cross(a,c,e),w=cross(d,e,a),z=cross(d,e,c);
      if(((u>aeps&&v< -aeps||u< -aeps&&v>aeps)&&(w>aeps&&z< -aeps||w< -aeps&&z>aeps))||on(a,c,d)||on(a,c,e)||on(d,e,a)||on(d,e,c))throw new Error('self_intersecting_corridor');
    }
    if(Math.abs(area(p))<=aeps)throw new Error('degenerate_corridor_polygon');
    if(area(p)<0)p.reverse();
    let changed=true;
    while(changed&&p.length>3){changed=false;for(let i=0;i<p.length;i++)if(on(p[(i+p.length-1)%p.length],p[(i+1)%p.length],p[i])){p.splice(i,1);changed=true;break;}}
    return {polygon:p,eps,aeps,bounds:[Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)]};
  }
  function triangulate(p,aeps,b) {
    const rest=p.slice(),triangles=[];
    while(rest.length>3){let found=false;for(let i=0;i<rest.length;i++){
      b.tick(rest.length);
      const a=rest[(i+rest.length-1)%rest.length],c=rest[i],d=rest[(i+1)%rest.length];
      if(cross(a,c,d)<=aeps)continue;
      if(rest.some(q=>q!==a&&q!==c&&q!==d&&cross(a,c,q)>=-aeps&&cross(c,d,q)>=-aeps&&cross(d,a,q)>=-aeps))continue;
      triangles.push([a,c,d]);rest.splice(i,1);found=true;break;
    }if(!found)throw new Error('corridor_triangulation_failed');}
    triangles.push(rest);return triangles;
  }
  function planeCoefficients(o) {
    const p=o.plane;
    if(o.coordinateCompatible===false)throw new Error('coordinate_alignment_required');
    if(p&&[p.a,p.b,p.c].every(finite))return {a:p.a,b:p.b,c:p.c};
    if(!p||!array(p.origin)||p.origin.length<2||!p.origin.slice(0,2).every(finite)||![p.observerElevationM,p.bearingDeg,p.pitchDeg].every(finite)||Math.abs(p.pitchDeg)>=89)throw new Error('valid_plane_required');
    if(o.coordinateCompatible!==true||!finite(o.datumOffsetM))throw new Error('coordinate_alignment_required');
    const rad=Math.PI/180,slope=Math.tan(p.pitchDeg*rad),a=Math.sin(p.bearingDeg*rad)*slope,b=Math.cos(p.bearingDeg*rad)*slope;
    return {a,b,c:p.observerElevationM-o.datumOffsetM-a*p.origin[0]-b*p.origin[1]};
  }
  const at = (plane,p) => plane.a*p[0]+plane.b*p[1]+plane.c;
  function half(points,f,b,eps=1e-8) {
    b.tick(points.length);const out=[];
    for(let i=0;i<points.length;i++){
      const a=points[i],c=points[(i+1)%points.length],da=f(a),dc=f(c),ai=da>=-eps,ci=dc>=-eps;
      if(!finite(da)||!finite(dc))throw new Error('nonfinite_clip_distance');
      if(ai!==ci){const t=Math.max(0,Math.min(1,da/(da-dc)));out.push(a.map((v,k)=>v+t*(c[k]-v)));}
      if(ci)out.push(c);
    }
    return clean(out,eps);
  }
  function trianglesInto(out,p,b) {
    if(p.some(q=>q.some(v=>!finite(v)||Math.abs(v)>3.402823e38)))throw new Error('nonfinite_render_coordinate');
    for(let i=1;i+1<p.length;i++){
      b.tick();
      if(norm(cross3(sub(p[i],p[0]),sub(p[i+1],p[0])))>1e-10)out.push(...p[0],...p[i],...p[i+1]);
    }
  }
  function prepareSurface(options) {
    const o=options||{},result={status:'unresolved',completed:false,surfacePositions:empty(),curtainPositions:empty(),edgePositions:empty(),fitPoints:[],patches:[],plane:null,issues:[]},b=budget(o);
    try{
      const p=normalizePolygon(o.polygon,b),plane=planeCoefficients(o),tris=triangulate(p.polygon,p.aeps,b),surface=[],curtains=[],edges=[];
      const lower=finite(o.renderMinModelZ)?o.renderMinModelZ:null,upper=finite(o.renderMaxModelZ)?o.renderMaxModelZ:finite(o.topZ)?o.topZ:null;
      if(lower!==null&&upper!==null&&lower>=upper)throw new Error('invalid_display_z_range');
      for(const tri of tris){
        let q=tri.map(v=>[...v,at(plane,v)]);
        if(lower!==null)q=half(q,v=>v[2]-lower,b);
        if(upper!==null)q=half(q,v=>upper-v[2],b);
        if(q.length>=3){result.patches.push(q);trianglesInto(surface,q,b);}
      }
      for(let i=0;i<p.polygon.length;i++){
        const a=p.polygon[i],c=p.polygon[(i+1)%p.polygon.length],az=at(plane,a),cz=at(plane,c);
        let edge=[[...a,az],[...c,cz]];
        if(lower!==null)edge=half(edge,v=>v[2]-lower,b);
        if(upper!==null)edge=half(edge,v=>upper-v[2],b);
        if(edge.length===2)edges.push(...edge[0],...edge[1]);
        // Display extrusion only. Its top is a scene cut, never a policy cap.
        if(upper!==null){
          let wall=[[...a,az],[...c,cz],[...c,upper],[...a,upper]];
          wall=half(wall,v=>v[2]-at(plane,v),b);
          if(lower!==null)wall=half(wall,v=>v[2]-lower,b);
          wall=half(wall,v=>upper-v[2],b);trianglesInto(curtains,wall,b);
          if(wall.length>=3){for(let j=0;j<wall.length;j++)edges.push(...wall[j],...wall[(j+1)%wall.length]);}
        }
      }
      result.surfacePositions=new Float32Array(surface);result.curtainPositions=new Float32Array(curtains);result.edgePositions=new Float32Array(edges);
      result.fitPoints=result.patches.flat().map(p=>p.slice());result.plane=plane;result.status='ready';result.completed=true;
    }catch(error){result.issues.push(error.message);result.status=error.message==='geometry_work_limit'?'complexity-limit':'unresolved';result.patches=[];}
    result.work=b.work;return result;
  }
  function partGeometry(part,b,maxTriangles) {
    const p=part&&(part.positions||part.pos),idx=part&&(part.indices||part.idx),offset=part&&part.offset||[0,0,0];
    if(!array(p)||!p.length||p.length%3||idx!==undefined&&(!array(idx)||idx.length%3)||!array(offset)||offset.length!==3||!Array.from(offset).every(finite))throw new Error('invalid_proposal_geometry');
    const n=idx===undefined?p.length/9:idx.length/3;
    if(!Number.isInteger(n)||n>maxTriangles)throw new Error('proposal_triangle_limit');
    for(const v of p){b.tick();if(!finite(v))throw new Error('nonfinite_proposal_coordinate');}
    if(idx!==undefined)for(const v of idx){b.tick();if(!Number.isInteger(v)||v<0||v>=p.length/3)throw new Error('invalid_proposal_index');}
    const triangles=[];
    for(let i=0;i<n;i++)triangles.push([0,1,2].map(k=>{const j=(idx===undefined?i*3+k:idx[i*3+k])*3;return [p[j]+offset[0],p[j+1]+offset[1],p[j+2]+offset[2]];}));
    return triangles;
  }
  function convexClosed(triangles,b) {
    // Caps are safe only for a closed convex part. Arbitrary imported skins keep
    // their real clipped surfaces and never acquire an invented filled volume.
    if(triangles.length>256)return false;
    const vertices=[],ids=[],edges=new Map();
    for(const t of triangles){const row=[];for(const p of t){let id=vertices.findIndex(v=>near3(v,p));if(id<0){id=vertices.length;vertices.push(p);}row.push(id);}ids.push(row);}
    if(vertices.length<4)return false;
    for(const t of ids)for(let i=0;i<3;i++){const a=t[i],c=t[(i+1)%3],key=a<c?a+':'+c:c+':'+a;edges.set(key,(edges.get(key)||0)+1);}
    if([...edges.values()].some(n=>n!==2))return false;
    let dimensional=false;
    for(const t of triangles){
      const n=cross3(sub(t[1],t[0]),sub(t[2],t[0])),len=norm(n);if(len<1e-10)continue;
      let positive=false,negative=false;
      for(const p of vertices){b.tick();const d=dot(n,sub(p,t[0]))/len;positive ||= d>1e-6;negative ||= d< -1e-6;if(positive&&negative)return false;}
      dimensional ||= positive||negative;
    }
    return dimensional;
  }
  function clipSolid(faces,f,normal,b,visible) {
    const next=[],cuts=[];
    for(const face of faces){
      const before=face.points,after=half(before,f,b);
      if(after.length>=3)next.push({...face,points:after});
      if(before.some(p=>f(p)<-1e-8)&&before.some(p=>f(p)>1e-8))for(const p of after)if(Math.abs(f(p))<1e-6&&!cuts.some(q=>near3(p,q)))cuts.push(p);
    }
    if(cuts.length>=3){
      const center=[0,0,0];for(const p of cuts)for(let k=0;k<3;k++)center[k]+=p[k]/cuts.length;
      // The retained positive halfspace has outward normal -normal.
      const n=normal.map(v=>-v/norm(normal)),seed=Math.abs(n[2])<.9?[0,0,1]:[0,1,0],u=cross3(seed,n),ul=norm(u);for(let k=0;k<3;k++)u[k]/=ul;
      const v=cross3(n,u);cuts.sort((a,c)=>Math.atan2(dot(sub(a,center),v),dot(sub(a,center),u))-Math.atan2(dot(sub(c,center),v),dot(sub(c,center),u)));
      next.push({points:cuts,cap:true,visible});
    }
    return next;
  }
  function boundaryEdge(a,c,ring) {return ring.some((p,i)=>{const q=ring[(i+1)%ring.length];return near3(a,p)&&near3(c,q)||near3(a,q)&&near3(c,p);});}
  function clipProposal(options) {
    const o=options||{},result={status:'unresolved',completed:false,intrusionPositions:empty(),capPositions:empty(),maxPenetrationM:null,minClearanceM:null,checkedTriangles:0,intersectingTriangles:0,closedSolidParts:0,surfaceOnlyParts:0,capMode:'surface-only',issues:[]},b=budget(o);
    try{
      const corridor=normalizePolygon(o.polygon,b),plane=planeCoefficients(o),patches=triangulate(corridor.polygon,corridor.aeps,b),red=[],caps=[];
      if(!Array.isArray(o.parts)||!o.parts.length)throw new Error('proposal_triangles_required');
      const max=finite(o.maxTriangles)&&o.maxTriangles>0?Math.min(o.maxTriangles,100000):25000;
      let count=0;
      // Validate every part before returning any coloured geometry.
      const parts=o.parts.map(part=>{const triangles=partGeometry(part,b,max);count+=triangles.length;if(count>max)throw new Error('proposal_triangle_limit');return {part,triangles};});
      for(const {part,triangles} of parts){
        const solid=(part.solid===true||o.solid===true&&part.solid!==false)&&convexClosed(triangles,b);
        if(solid)result.closedSolidParts++;else result.surfaceOnlyParts++;
        for(const tri of triangles){
          result.checkedTriangles++;let hit=false;
          if(!overlapBounds(tri,corridor.bounds))continue;
          for(const mask of patches){let clipped=tri;
            for(let i=0;i<3&&clipped.length;i++){const a=mask[i],c=mask[(i+1)%3];clipped=half(clipped,p=>cross(a,c,p),b,corridor.aeps);}
            if(!clipped.length)continue;hit=true;
            for(const p of clipped){const clearance=at(plane,p)-p[2];if(!finite(clearance))throw new Error('nonfinite_clearance');if(result.minClearanceM===null||clearance<result.minClearanceM)result.minClearanceM=clearance;}
            // Closed blocks are emitted once from the capped polyhedron below.
            if(!solid){const q=half(clipped,p=>p[2]-at(plane,p),b);if(q.some(p=>p[2]-at(plane,p)>1e-7))trianglesInto(red,q,b);}
          }
          if(hit)result.intersectingTriangles++;
        }
        if(solid&&triangles.some(t=>overlapBounds(t,corridor.bounds)))for(const mask of patches){
          let faces=triangles.map(points=>({points,cap:false,visible:true}));
          for(let i=0;i<3&&faces.length;i++){const a=mask[i],c=mask[(i+1)%3],dx=c[0]-a[0],dy=c[1]-a[1];faces=clipSolid(faces,p=>cross(a,c,p),[-dy,dx,0],b,boundaryEdge(a,c,corridor.polygon));}
          if(faces.length)faces=clipSolid(faces,p=>p[2]-at(plane,p),[-plane.a,-plane.b,1],b,true);
          if(!faces.some(f=>f.points.some(p=>p[2]-at(plane,p)>1e-7)))continue;
          for(const f of faces)if(f.visible)trianglesInto(f.cap?caps:red,f.points,b);
        }
      }
      result.intrusionPositions=new Float32Array(red);result.capPositions=new Float32Array(caps);
      result.maxPenetrationM=result.minClearanceM===null?null:Math.max(0,-result.minClearanceM);
      result.status=result.minClearanceM===null?'outside':result.maxPenetrationM>1e-7?'intersects':'below';result.completed=true;
      result.capMode=result.closedSolidParts?(result.surfaceOnlyParts?'mixed':'closed-convex-parts'):'surface-only';
    }catch(error){result.status=/limit/.test(error.message)?'complexity-limit':'unresolved';result.issues.push(error.message);result.minClearanceM=null;result.maxPenetrationM=null;result.intrusionPositions=empty();result.capPositions=empty();}
    result.work=b.work;return result;
  }
  function footprintMesh(options) {
    const o=options||{},result={status:'unresolved',completed:false,positions:empty(),edges:empty(),areaM2:0,issues:[]},b=budget(o);
    try{
      const corridor=normalizePolygon(o.polygon,b),masks=triangulate(corridor.polygon,corridor.aeps,b),out=[],lines=[],z=finite(o.z)?o.z:0;
      if(!Array.isArray(o.footprints)||o.footprints.length>20000)throw new Error('footprint_limit');
      for(const raw of o.footprints){
        if(!Array.isArray(raw)||raw.length<3||raw.length>512||raw.some(q=>!array(q)||q.length<2||!finite(q[0])||!finite(q[1])))throw new Error('invalid_footprint_polygon');
        b.tick(raw.length);if(!overlapBounds(raw,corridor.bounds))continue;
        const p=normalizePolygon(raw,b),triangles=triangulate(p.polygon,p.aeps,b),boundary=new Map();
        const edgeKey=q=>q.map(v=>Math.round(v*1e6)).join(',');
        for(const t of triangles)for(const m of masks){let clipped=t.map(q=>[...q,z]);for(let i=0;i<3&&clipped.length;i++)clipped=half(clipped,p=>cross(m[i],m[(i+1)%3],p),b,corridor.aeps);
          if(clipped.length<3)continue;result.areaM2+=Math.abs(area(clipped));trianglesInto(out,clipped,b);
          for(let i=0;i<clipped.length;i++){const a=clipped[i],c=clipped[(i+1)%clipped.length],ka=edgeKey(a),kc=edgeKey(c),key=ka<kc?ka+'|'+kc:kc+'|'+ka;const prior=boundary.get(key);if(prior)prior.count++;else boundary.set(key,{a,c,count:1});}
        }
        // Triangulation seams are not building footprint edges.
        for(const e of boundary.values())if(e.count===1)lines.push(...e.a,...e.c);
      }
      result.positions=new Float32Array(out);result.edges=new Float32Array(lines);result.status='ready';result.completed=true;
    }catch(error){result.status=/limit/.test(error.message)?'complexity-limit':'unresolved';result.issues.push(error.message);result.areaM2=null;}
    result.work=b.work;return result;
  }
  // Extract real low edges from each indexed context object. Bounds are a
  // broadphase only; they are never drawn as a substitute footprint. Objects
  // without a recoverable flat base are counted as skipped.
  function existingFootprintEdges(options) {
    const o=options||{},result={status:'unresolved',completed:false,positions:empty(),baseEdges:empty(),ceilingPositions:empty(),ceilingEdges:empty(),connectorPositions:empty(),selectedCount:0,candidateCount:0,processedBuildings:0,processedTriangles:0,skippedCount:0,truncated:false,issues:[]},b=budget(o);
    const lines=[],ceilings=[],connectors=[];
    let checkpoint=[0,0,0];
    try {
      const corridor=normalizePolygon(o.polygon,b),masks=triangulate(corridor.polygon,corridor.aeps,b),mesh=o.mesh||{},P=mesh.pos||mesh.positions,I=mesh.idx||mesh.indices,c=(o.catalogue&&o.catalogue.columns)||o.columns;
      if(!array(P)||P.length%3||!array(I)||I.length%3||!c||!Array.isArray(c.bbox)||!array(c.index_offset)||!array(c.index_count)||c.bbox.length!==c.index_offset.length||c.bbox.length!==c.index_count.length)throw new Error('invalid_context_mesh_catalogue');
      const maxTriangles=finite(o.maxTriangles)&&o.maxTriangles>=0?Math.min(o.maxTriangles,1000000):200000,maxBuildings=finite(o.maxBuildings)&&o.maxBuildings>=0?Math.min(o.maxBuildings,10000):2000;
      const tolerance=finite(o.baseToleranceM)&&o.baseToleranceM>0?Math.min(o.baseToleranceM,.5):.05,zOffset=finite(o.zOffset)?o.zOffset:.2;
      const omitted=new Set(o.omitRows||[]),candidates=[];
      const broadMasks=masks.map(t=>({triangle:t,bounds:[Math.min(...t.map(p=>p[0])),Math.min(...t.map(p=>p[1])),Math.max(...t.map(p=>p[0])),Math.max(...t.map(p=>p[1]))]}));
      // Exact triangle/rectangle separating axes make a narrow long corridor's
      // citywide bbox inexpensive without consuming the object budget on rows
      // that cannot reach its actual plan polygon.
      const bboxMeetsCorridor=box=>broadMasks.some(mask=>{
        b.tick();const mb=mask.bounds;if(box[3]<mb[0]||box[0]>mb[2]||box[4]<mb[1]||box[1]>mb[3])return false;
        for(let k=0;k<3;k++){const a=mask.triangle[k],c=mask.triangle[(k+1)%3],dx=c[0]-a[0],dy=c[1]-a[1],x=dy<0?box[3]:box[0],y=dx>0?box[4]:box[1];if(cross(a,c,[x,y])< -corridor.aeps)return false;}return true;
      });
      let plane=null;if(o.plane)plane=planeCoefficients(o);
      for(let row=0;row<c.bbox.length;row++) {
        b.tick();if(omitted.has(row)||c.index_count[row]===0)continue;const box=c.bbox[row];
        if(!array(box)||box.length!==6||!Array.from(box).every(finite)||box[0]>box[3]||box[1]>box[4]||box[2]>box[5])throw new Error('invalid_context_bbox');
        if(box[3]<corridor.bounds[0]||box[0]>corridor.bounds[2]||box[4]<corridor.bounds[1]||box[1]>corridor.bounds[3])continue;
        if(bboxMeetsCorridor(box))candidates.push(row);
      }
      result.candidateCount=candidates.length;
      const vertexKey=p=>p.map(v=>Math.round(v*1e5)).join(',');
      const segmentIntervals=(a,c)=>{
        const intervals=[];
        for(const mask of masks){let lo=0,hi=1;
          for(let i=0;i<3;i++){b.tick();const d=mask[i],e=mask[(i+1)%3],u=cross(d,e,a),v=cross(d,e,c);
            if(u< -corridor.aeps&&v< -corridor.aeps){hi=-1;break;}
            if(u< -corridor.aeps)lo=Math.max(lo,u/(u-v));else if(v< -corridor.aeps)hi=Math.min(hi,u/(u-v));
            if(lo>hi)break;
          }
          if(hi-lo>1e-10)intervals.push([Math.max(0,lo),Math.min(1,hi)]);
        }
        intervals.sort((a,c)=>a[0]-c[0]);const merged=[];
        for(const interval of intervals){const last=merged[merged.length-1];if(last&&interval[0]<=last[1]+1e-9)last[1]=Math.max(last[1],interval[1]);else merged.push(interval);}
        return merged;
      };
      for(let candidate=0;candidate<candidates.length;candidate++) {
        const row=candidates[candidate];
        checkpoint=[lines.length,ceilings.length,connectors.length];
        if(result.processedBuildings>=maxBuildings){result.truncated=true;result.skippedCount+=candidates.length-candidate;result.issues.push('context_building_limit');break;}
        const start=c.index_offset[row],count=c.index_count[row],base=c.bbox[row][2];
        if(!Number.isSafeInteger(start)||!Number.isSafeInteger(count)||start<0||count<0||start%3||count%3||start+count>I.length)throw new Error('invalid_context_index_range');
        if(result.processedTriangles+count/3>maxTriangles){result.truncated=true;result.skippedCount++;if(!result.issues.includes('context_triangle_limit'))result.issues.push('context_triangle_limit');continue;}
        const cap=new Map(),wall=new Map();
        const add=(map,a,c)=>{const ka=vertexKey(a),kc=vertexKey(c);if(ka===kc)return;const key=ka<kc?ka+'|'+kc:kc+'|'+ka,old=map.get(key);if(old)old.count++;else map.set(key,{a,c,count:1});};
        for(let j=start;j<start+count;j+=3){
          b.tick(3);const tri=[];
          for(let k=0;k<3;k++){const n=I[j+k];if(!Number.isInteger(n)||n<0||n>=P.length/3)throw new Error('invalid_context_index');const p=[P[n*3],P[n*3+1],P[n*3+2]];if(!p.every(finite))throw new Error('nonfinite_context_coordinate');tri.push(p);}
          const low=tri.map(p=>Math.abs(p[2]-base)<=tolerance);
          if(low.every(Boolean)&&Math.abs(cross(...tri))>1e-9)for(let k=0;k<3;k++)add(cap,tri[k],tri[(k+1)%3]);
          else for(let k=0;k<3;k++)if(low[k]&&low[(k+1)%3])add(wall,tri[k],tri[(k+1)%3]);
        }
        result.processedTriangles+=count/3;result.processedBuildings++;
        let edges=[...cap.values()].filter(e=>e.count===1);if(!edges.length)edges=[...wall.values()];
        let emitted=false;
        for(const edge of edges)for(const [lo,hi] of segmentIntervals(edge.a,edge.c)){
          const points=[lo,hi].map(t=>edge.a.map((v,k)=>v+t*(edge.c[k]-v))),[a,c]=points;
          if(Math.hypot(c[0]-a[0],c[1]-a[1])<=1e-7)continue;
          lines.push(a[0],a[1],a[2]+zOffset,c[0],c[1],c[2]+zOffset);emitted=true;
          if(plane){const qa=[a[0],a[1],at(plane,a)],qc=[c[0],c[1],at(plane,c)];if(!qa.every(finite)||!qc.every(finite))throw new Error('nonfinite_context_ceiling');ceilings.push(...qa,...qc);if(o.connectors===true)for(const q of [a,c])connectors.push(q[0],q[1],q[2]+zOffset,q[0],q[1],at(plane,q));}
        }
        if(emitted)result.selectedCount++;else result.skippedCount++;
        checkpoint=[lines.length,ceilings.length,connectors.length];
      }
      result.completed=true;result.status=result.truncated?'partial':'ready';
    }catch(error){
      // Retain only previously completed objects; a partial object's lines are
      // rolled back so a work limit never leaves an arbitrary broken outline.
      lines.length=checkpoint[0];ceilings.length=checkpoint[1];connectors.length=checkpoint[2];
      result.truncated=true;result.status=/limit/.test(error.message)?'partial':'unresolved';result.issues.push(error.message);
    }
    if(lines.some(v=>!finite(v)||Math.abs(v)>3.402823e38)||ceilings.some(v=>!finite(v)||Math.abs(v)>3.402823e38)){lines.length=0;ceilings.length=0;connectors.length=0;result.status='unresolved';result.completed=false;result.issues.push('nonfinite_render_coordinate');}
    result.positions=new Float32Array(lines);result.baseEdges=result.positions;result.ceilingPositions=new Float32Array(ceilings);result.ceilingEdges=result.ceilingPositions;result.connectorPositions=new Float32Array(connectors);result.work=b.work;return result;
  }
  return {prepareSurface,mesh:prepareSurface,clipProposal,footprintMesh,existingFootprintEdges,planeCoefficients};
});
