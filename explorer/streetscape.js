/* Illustrative streetscape meshes on mapped road centrelines; all dimensions are metres.
 * Carriageways and sidewalks are visual estimates, not surveyed geometry.
 * groundAt(x,y) must return a finite land elevation, or null for water/missing ground.
 * segmentOptions receives original directed endpoints, so its left/right follow that direction.
 * bounds selects the whole model; maxSegments is a soft terrain-patch budget.
 * detailCenter/detailRadius localize sidewalks and markings without omitting asphalt.
 * Segment heightAt(x,y) overrides terrain for estimated bridge decks, including water;
 * isOccupied(x,y,z) receives that surface elevation. terrainTolerance optionally
 * refines terrain curvature, independently of the soft source-patch budget.
 */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.Streetscape=api;})(typeof globalThis==='undefined'?this:globalThis,function(){
'use strict';
const OFFSETS={asphalt:0.035,sidewalk:0.10,marking:0.065};
const PATCH_LENGTH=8,DEDUP_DISTANCE=0.35,MAX_ADAPTIVE_DEPTH=7,BOUNDARY_STEP=1,MAX_INTERIOR_PROBES=128;

function bounded(value,fallback,low,high){return Number.isFinite(value)?Math.max(low,Math.min(high,value)):fallback;}
function builder(){return {pos:[],idx:[]};}
function mesh(b){return {pos:new Float32Array(b.pos),idx:new Uint32Array(b.idx)};}
function distance2(x,y,s){const dx=s.bx-s.ax,dy=s.by-s.ay,l2=dx*dx+dy*dy,t=Math.max(0,Math.min(1,((x-s.ax)*dx+(y-s.ay)*dy)/l2));return (x-s.ax-t*dx)**2+(y-s.ay-t*dy)**2;}

/* Clip the centreline to a circle inset by the widest strip. Consequently every
 * ribbon vertex stays in the requested radius, including a long crossing segment.
 */
function clipped(ax,ay,bx,by,cx,cy,r){
  const dx=bx-ax,dy=by-ay,l2=dx*dx+dy*dy;
  if(!Number.isFinite(l2)||l2<0.01||r<=0)return null;
  const p=((cx-ax)*dx+(cy-ay)*dy)/l2,qx=ax+p*dx-cx,qy=ay+p*dy-cy,d2=qx*qx+qy*qy;
  if(!Number.isFinite(d2)||d2>=r*r)return null;
  const span=Math.sqrt(Math.max(0,(r*r-d2)/l2)),t0=Math.max(0,p-span),t1=Math.min(1,p+span);
  if(t1<=t0||(t1-t0)*Math.sqrt(l2)<0.1)return null;
  return {ax:ax+t0*dx,ay:ay+t0*dy,bx:ax+t1*dx,by:ay+t1*dy,clipped:t0>1e-8||t1<1-1e-8};
}

function roadIndex(segments,groundSample){
  const size=24,buckets=new Map();
  for(const s of segments){
    const pad=s.width/2+0.5,x0=Math.floor((Math.min(s.ax,s.bx)-pad)/size),x1=Math.floor((Math.max(s.ax,s.bx)+pad)/size),y0=Math.floor((Math.min(s.ay,s.by)-pad)/size),y1=Math.floor((Math.max(s.ay,s.by)+pad)/size);
    for(let x=x0;x<=x1;x++)for(let y=y0;y<=y1;y++){const key=x+','+y;let bucket=buckets.get(key);if(!bucket){bucket=[];buckets.set(key,bucket);}bucket.push(s);}
  }
  return function(x,y,clearance,z){const bucket=buckets.get(Math.floor(x/size)+','+Math.floor(y/size));if(!bucket)return true;for(const s of bucket)if(distance2(x,y,s)<(s.width/2+(clearance||0)-1e-5)**2){const roadZ=s.heightAt?s.heightAt(x,y):groundSample(x,y);if(roadZ!==null&&Number.isFinite(roadZ)&&Math.abs(roadZ-z)<1.5)return false;}return true;};
}

/* Subdivide only patches meeting an obstruction. A single blocked corner must
 * not erase eight metres of otherwise usable carriageway or a whole junction.
 */
function ribbon(b,s,t0,t1,lo,hi,zOffset,sample,clearRoad,depth=0){
  const points=[],valid=[];
  for(let row=0;row<3;row++){const t=t0+(t1-t0)*row/2;
    for(let col=0;col<3;col++){const lateral=lo+(hi-lo)*col/2,x=s.ax+(s.bx-s.ax)*t+s.nx*lateral,y=s.ay+(s.by-s.ay)*t+s.ny*lateral,z=sample(x,y);
      valid.push(z!==null&&(!clearRoad||clearRoad(x,y,0,z)));points.push(x,y,z===null?0:z+zOffset);
    }
  }
  const complete=valid.every(Boolean),tol=sample.terrainTolerance;
  const bends=triples=>triples.some(([a,m,c])=>Math.abs(points[m*3+2]-(points[a*3+2]+points[c*3+2])/2)>tol);
  const canRefine=complete&&depth<MAX_ADAPTIVE_DEPTH&&Number.isFinite(tol),longCurve=canRefine&&bends([[0,3,6],[1,4,7],[2,5,8]]),sideCurve=canRefine&&bends([[0,1,2],[3,4,5],[6,7,8]]),diagonalCurve=canRefine&&bends([[0,4,8],[2,4,6]]),curved=longCurve||sideCurve||diagonalCurve;
  if(curved&&sample.onRefine)sample.onRefine();
  if(complete&&!curved){
    const base=b.pos.length/3;b.pos.push(...points);
    for(let row=0;row<2;row++)for(let col=0;col<2;col++){const a=base+row*3+col,c=a+3;b.idx.push(a,c,c+1,a,c+1,a+1);}
    return true;
  }
  const physicalLength=(t1-t0)*s.length,physicalWidth=hi-lo;
  if(!valid.some(Boolean)){
    /* A coarse patch may have an unobstructed tail between all nine samples.
     * A bounded one-metre centreline search finds these islands without
     * recursively tessellating a whole water or building region.
     */
    if(physicalLength<=BOUNDARY_STEP||depth>=MAX_ADAPTIVE_DEPTH)return false;
    const probes=Math.min(MAX_INTERIOR_PROBES,Math.ceil(physicalLength/BOUNDARY_STEP));let found=false;
    for(let i=0;i<probes;i++){const t=t0+(t1-t0)*(i+0.5)/probes,lateral=(lo+hi)/2,x=s.ax+(s.bx-s.ax)*t+s.nx*lateral,y=s.ay+(s.by-s.ay)*t+s.ny*lateral,z=sample(x,y);if(sample.onBoundaryProbe)sample.onBoundaryProbe();if(z!==null&&(!clearRoad||clearRoad(x,y,0,z))){found=true;break;}}
    if(!found)return false;
  }
  if(depth>=MAX_ADAPTIVE_DEPTH||(!complete&&Math.max(physicalLength,physicalWidth)<=BOUNDARY_STEP)){
    let emitted=false;
    for(const ids of [[0,3,4],[0,4,1],[1,4,5],[1,5,2],[3,6,7],[3,7,4],[4,7,8],[4,8,5]])if(ids.every(i=>valid[i])){
      const tri=ids.map(i=>points.slice(i*3,i*3+3)),probe=(x,y)=>{const z=sample(x,y);return z!==null&&(!clearRoad||clearRoad(x,y,0,z));};
      if(!tri.every((p,i)=>{const q=tri[(i+1)%3];return probe((p[0]+q[0])/2,(p[1]+q[1])/2);})||!probe(tri.reduce((n,p)=>n+p[0],0)/3,tri.reduce((n,p)=>n+p[1],0)/3))continue;
      const base=b.pos.length/3;for(const p of tri)b.pos.push(...p);b.idx.push(base,base+1,base+2);emitted=true;
    }
    return emitted;
  }
  const tm=(t0+t1)/2,lm=(lo+hi)/2,splitLong=curved?(longCurve||(!sideCurve&&diagonalCurve)):physicalLength>BOUNDARY_STEP,splitSide=curved?sideCurve:physicalWidth>BOUNDARY_STEP;
  const rows=splitLong?[[t0,tm],[tm,t1]]:[[t0,t1]],columns=splitSide?[[lo,lm],[lm,hi]]:[[lo,hi]];
  let emitted=false;
  for(const [a,c] of rows)for(const [d,e] of columns)if(ribbon(b,s,a,c,d,e,zOffset,sample,clearRoad,depth+1))emitted=true;
  return emitted;
}

function clipBounds(ax,ay,bx,by,bounds){
  const dx=bx-ax,dy=by-ay,l2=dx*dx+dy*dy;if(!Number.isFinite(l2)||l2<0.01)return null;let lo=0,hi=1;
  for(const [p,q] of [[-dx,ax-bounds[0]],[dx,bounds[2]-ax],[-dy,ay-bounds[1]],[dy,bounds[3]-ay]]){
    if(Math.abs(p)<1e-12){if(q<0)return null;continue;}
    const t=q/p;if(p<0)lo=Math.max(lo,t);else hi=Math.min(hi,t);if(hi<=lo)return null;
  }
  if((hi-lo)*Math.hypot(dx,dy)<0.1)return null;
  return {ax:ax+lo*dx,ay:ay+lo*dy,bx:ax+hi*dx,by:ay+hi*dy,clipped:lo>1e-8||hi<1-1e-8};
}

function convexHull(points){
  points.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]),half=[];
  for(const p of points){while(half.length>1&&cross(half[half.length-2],half[half.length-1],p)<=1e-8)half.pop();half.push(p);}
  const lower=half.slice();half.length=0;
  for(let i=points.length-1;i>=0;i--){const p=points[i];while(half.length>1&&cross(half[half.length-2],half[half.length-1],p)<=1e-8)half.pop();half.push(p);}
  return lower.slice(0,-1).concat(half.slice(0,-1));
}

function joinTriangle(b,a,c,d,sample,depth=0){
  const pts=[a,c,d],mid=[[(a[0]+c[0])/2,(a[1]+c[1])/2],[(c[0]+d[0])/2,(c[1]+d[1])/2],[(d[0]+a[0])/2,(d[1]+a[1])/2]],all=pts.concat(mid,[[(a[0]+c[0]+d[0])/3,(a[1]+c[1]+d[1])/3]]),zs=all.map(p=>sample(...p));
  const complete=zs.every(z=>z!==null),tol=sample.terrainTolerance,curved=complete&&depth<MAX_ADAPTIVE_DEPTH&&Number.isFinite(tol)&&([0,1,2].some(i=>Math.abs(zs[3+i]-(zs[i]+zs[(i+1)%3])/2)>tol)||Math.abs(zs[6]-(zs[0]+zs[1]+zs[2])/3)>tol);
  if(curved&&sample.onRefine)sample.onRefine();
  if(complete&&!curved){const base=b.pos.length/3;for(let i=0;i<3;i++)b.pos.push(...pts[i],zs[i]+OFFSETS.asphalt);b.idx.push(base,base+1,base+2);return true;}
  if(depth>=MAX_ADAPTIVE_DEPTH||zs.every(z=>z===null))return false;
  let emitted=false;for(const tri of [[a,mid[0],mid[2]],[mid[0],c,mid[1]],[mid[2],mid[1],d],[mid[0],mid[1],mid[2]]])if(joinTriangle(b,...tri,sample,depth+1))emitted=true;return emitted;
}

/* Rectangles meet edge-to-edge on straight source splits; convex endpoint fans
 * fill the outside wedges at bends and shared road junctions. Covered triangles
 * are omitted so long collinear ways do not receive redundant overlapping caps.
 */
function junctions(b,segments){
  const buckets=new Map(),nodes=[];
  for(const s of segments)for(const end of [false,true]){
    const x=end?s.bx:s.ax,y=end?s.by:s.ay,z=s.sample(x,y);if(z===null)continue;
    const key=Math.round(x*100)+','+Math.round(y*100);let candidates=buckets.get(key);
    if(!candidates){candidates=[];buckets.set(key,candidates);}
    let node=candidates.find(n=>Math.abs(n.z-z)<=0.25);
    if(!node){node={x,y,z,arms:[]};candidates.push(node);nodes.push(node);}
    node.arms.push({s,ux:s.ux*(end?-1:1),uy:s.uy*(end?-1:1)});
  }
  let count=0;
  for(const n of nodes){
    if(n.arms.length<2)continue;
    const sample=n.arms[0].s.sample;
    const points=[];for(const {s} of n.arms)for(const sign of [-1,1])points.push([n.x+sign*s.nx*s.width/2,n.y+sign*s.ny*s.width/2]);
    const hull=convexHull(points);if(hull.length<3)continue;
    for(let i=0;i<hull.length;i++){
      const a=hull[i],c=hull[(i+1)%hull.length],cross=(a[0]-n.x)*(c[1]-n.y)-(a[1]-n.y)*(c[0]-n.x);if(Math.abs(cross)<1e-5)continue;
      const covered=n.arms.some(({s,ux,uy})=>[a,c].every(p=>{const x=p[0]-n.x,y=p[1]-n.y;return x*ux+y*uy>=-1e-6&&Math.abs(x*(-uy)+y*ux)<=s.width/2+1e-6;}));
      if(!covered&&joinTriangle(b,[n.x,n.y],a,c,sample))count++;
    }
  }
  return count;
}

function patchPlan(segments,budget){
  let length=PATCH_LENGTH;const required=segments.reduce((n,s)=>n+Math.ceil(s.length/length),0),minimum=segments.length;
  if(required>budget&&budget>=minimum){let lo=length,hi=segments.reduce((n,s)=>Math.max(n,s.length),length);for(let i=0;i<32;i++){const mid=(lo+hi)/2,count=segments.reduce((n,s)=>n+Math.ceil(s.length/mid),0);if(count>budget)lo=mid;else hi=mid;}length=hi;}
  if(budget<minimum)length=Infinity;
  return {length,required,count:segments.reduce((n,s)=>n+(Number.isFinite(length)?Math.ceil(s.length/length):1),0)};
}

function generate(options){
  const o=options||{},cx=o.center&&o.center[0],cy=o.center&&o.center[1],radius=bounded(o.radius,450,0,1000000),roadWidth=bounded(o.roadWidth,8,1,40),sidewalkWidth=bounded(o.sidewalkWidth,2.4,0,12),maxSegments=Math.floor(bounded(o.maxSegments,900,0,2000000));
  const bounds=Array.isArray(o.bounds)&&o.bounds.length===4&&o.bounds.every(Number.isFinite)&&o.bounds[0]<o.bounds[2]&&o.bounds[1]<o.bounds[3]?o.bounds:null;
  const detailCenter=o.detailCenter||[cx,cy],detailRadius=bounded(o.detailRadius,Infinity,0,1000000);
  const asphalt=builder(),sidewalks=builder(),markings=builder();
  const stats={illustrative:true,roadWidth,sidewalkWidth,radius,inputSegments:0,nearbySegments:0,duplicateSegments:0,invalidSegments:0,clippedSegments:0,segments:0,sidewalkPatches:0,markingPatches:0,blockedPatches:0,maxSegments,bounds,skippedSegments:0,junctionPatches:0,requiredPatches:0,plannedPatches:0,patchLength:PATCH_LENGTH,budgetExceeded:false,coverageComplete:false,terrainRefinements:0,boundaryProbes:0,deckSegments:0};
  const result=()=>({asphalt:mesh(asphalt),sidewalks:mesh(sidewalks),markings:mesh(markings),stats});
  if((!bounds&&(!Number.isFinite(cx)||!Number.isFinite(cy)||!radius))||!maxSegments||typeof o.groundAt!=='function')return result();
  const groundCache=new Map(),surfaceSamples=new WeakMap(),occupied=typeof o.isOccupied==='function'?o.isOccupied:()=>false;
  const terrainTolerance=bounded(o.terrainTolerance,Infinity,0.005,5);
  const sampleFactory=(heightAt,cache)=>{
    const fn=(x,y)=>{if(!Number.isFinite(x)||!Number.isFinite(y)||Math.abs(x)>3e37||Math.abs(y)>3e37||(bounds&&(x<bounds[0]||x>bounds[2]||y<bounds[1]||y>bounds[3])))return null;const key=x+','+y;if(cache.has(key))return cache.get(key);const value=heightAt(x,y),z=value!==null&&Number.isFinite(value)&&Math.abs(value)<=3e37&&!occupied(x,y,value)?value:null;cache.set(key,z);return z;};
    fn.terrainTolerance=terrainTolerance;fn.onRefine=()=>stats.terrainRefinements++;fn.onBoundaryProbe=()=>stats.boundaryProbes++;return fn;
  };
  const sample=sampleFactory(o.groundAt,groundCache);
  const sampleFor=heightAt=>{if(!heightAt)return sample;if(!surfaceSamples.has(heightAt))surfaceSamples.set(heightAt,sampleFactory(heightAt,new Map()));return surfaceSamples.get(heightAt);};
  const input=o.roads||[],datasets=typeof input[0]==='number'||ArrayBuffer.isView(input)?[input]:input,segments=[],dedup=new Map();
  for(const positions of datasets){if(!positions||typeof positions.length!=='number')continue;
    for(let i=0;i+5<positions.length;i+=6){
      stats.inputSegments++;
      const ax=positions[i],ay=positions[i+1],bx=positions[i+3],by=positions[i+4];
      if(![ax,ay,bx,by].every(Number.isFinite)){stats.invalidSegments++;continue;}
      const meta=typeof o.segmentOptions==='function'?(o.segmentOptions(ax,ay,bx,by)||{}):{},width=bounded(meta.roadWidth,roadWidth,1,40),left=meta.leftSidewalk!==false,right=meta.rightSidewalk!==false;
      if(meta.skip===true||meta.vehicular===false){stats.skippedSegments++;continue;}
      const strip=bounds?clipBounds(ax,ay,bx,by,bounds):clipped(ax,ay,bx,by,cx,cy,radius-width/2-((left||right)?sidewalkWidth:0));
      if(!strip)continue;
      stats.nearbySegments++;
      const ex=strip.ax,ey=strip.ay,fx=strip.bx,fy=strip.by,gx=Math.floor((ex+fx)/2),gy=Math.floor((ey+fy)/2),heightAt=typeof meta.heightAt==='function'?meta.heightAt:null,grade=heightAt?'d'+Math.round(heightAt((ex+fx)/2,(ey+fy)/2)*2):'g';
      let duplicate=false;
      for(let x=gx-1;x<=gx+1&&!duplicate;x++)for(let y=gy-1;y<=gy+1&&!duplicate;y++){const bucket=dedup.get(x+','+y+','+grade)||[];for(const previous of bucket)if((Math.hypot(ex-previous[0],ey-previous[1])<=DEDUP_DISTANCE&&Math.hypot(fx-previous[2],fy-previous[3])<=DEDUP_DISTANCE)||(Math.hypot(ex-previous[2],ey-previous[3])<=DEDUP_DISTANCE&&Math.hypot(fx-previous[0],fy-previous[1])<=DEDUP_DISTANCE)){duplicate=true;break;}}
      if(duplicate){stats.duplicateSegments++;continue;}
      const key=gx+','+gy+','+grade;if(!dedup.has(key))dedup.set(key,[]);dedup.get(key).push([ex,ey,fx,fy]);
      const length=Math.hypot(strip.bx-strip.ax,strip.by-strip.ay),ux=(strip.bx-strip.ax)/length,uy=(strip.by-strip.ay)/length;
      segments.push({...strip,width,left,right,length,ux,uy,nx:-uy,ny:ux,heightAt,sample:sampleFor(heightAt)});
      if(heightAt)stats.deckSegments++;
      if(strip.clipped)stats.clippedSegments++;
    }
  }
  const clearRoad=roadIndex(segments,sample),plan=patchPlan(segments,maxSegments);
  stats.sourceSegments=segments.length;stats.requiredPatches=plan.required;stats.plannedPatches=plan.count;stats.patchLength=Number.isFinite(plan.length)?plan.length:null;stats.budgetExceeded=plan.count>maxSegments;
  for(const s of segments){const count=Number.isFinite(plan.length)?Math.ceil(s.length/plan.length):1;for(let i=0;i<count;i++){
    const t0=i/count,t1=(i+1)/count,half=s.width/2,sample=s.sample;

    if(!ribbon(asphalt,s,t0,t1,-half,half,OFFSETS.asphalt,sample)){stats.blockedPatches++;continue;}
    stats.segments++;
    const px=s.ax+(s.bx-s.ax)*(t0+t1)/2,py=s.ay+(s.by-s.ay)*(t0+t1)/2;
    if(detailRadius===0||(Number.isFinite(detailRadius)&&Math.hypot(px-detailCenter[0],py-detailCenter[1])>detailRadius+(t1-t0)*s.length/2))continue;
    if(sidewalkWidth>0)for(const side of [-1,1]){
      if((side===1&&!s.left)||(side===-1&&!s.right))continue;
      const a=side*half,b=side*(half+sidewalkWidth);
      if(!ribbon(sidewalks,s,t0,t1,Math.min(a,b),Math.max(a,b),OFFSETS.sidewalk,sample,clearRoad)){stats.blockedPatches++;continue;}
      stats.sidewalkPatches++;
    }
    /* A world-aligned phase keeps consecutive collinear source segments from
     * restarting the dash pattern at every terrain-triangle split.
     */
    const start=s.ax*s.ux+s.ay*s.uy+t0*s.length,end=start+(t1-t0)*s.length;
    for(let k=Math.floor(start/18);k*18<end;k++){const a=Math.max(start,k*18),b=Math.min(end,k*18+3);if(b-a<0.15)continue;
      const ma=t0+(a-start)/s.length,mb=t0+(b-start)/s.length;
      if(ribbon(markings,s,ma,mb,-0.075,0.075,OFFSETS.marking,sample))stats.markingPatches++;
    }
  }}
  stats.junctionPatches=junctions(asphalt,segments);stats.coverageComplete=true;
  return result();
}
return {generate};
});
