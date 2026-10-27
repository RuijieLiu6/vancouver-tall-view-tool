/* Nearest point on bundled mapped-road line segments, in model metres. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.StreetGeometry=api;})(typeof globalThis==='undefined'?this:globalThis,function(){
'use strict';
function compare(a,b){return a.distance-b.distance||a.set-b.set||a.segment-b.segment||a.t-b.t;}
function nearest(x,y,roadArrays,maxDistance=40,usable=()=>true,options={}){
  if(![x,y,maxDistance].every(Number.isFinite)||maxDistance<0||!Array.isArray(roadArrays)||typeof usable!=='function')return null;
  const candidates=[];
  for(let set=0;set<roadArrays.length;set++){const pos=roadArrays[set];if(!pos)continue;
    for(let i=0;i+5<pos.length;i+=6){const ax=pos[i],ay=pos[i+1],bx=pos[i+3],by=pos[i+4];if(![ax,ay,bx,by].every(Number.isFinite))continue;
      const dx=bx-ax,dy=by-ay,l2=dx*dx+dy*dy;if(!Number.isFinite(l2)||l2<1e-12)continue;
      const t=Math.max(0,Math.min(1,((x-ax)*dx+(y-ay)*dy)/l2)),px=ax+t*dx,py=ay+t*dy,distance=Math.hypot(x-px,y-py);
      if(distance<=maxDistance)candidates.push({x:px,y:py,distance,segment:i/6,set,t,ax,ay,dx,dy,length:Math.sqrt(l2)});
    }
  }
  candidates.sort(compare);
  const requestedSpacing=options&&options.sampleSpacing;
  const spacing=Number.isFinite(requestedSpacing)&&requestedSpacing>0?Math.max(0.1,requestedSpacing):1;
  let best=null;
  const pointAt=(c,t)=>{const px=c.ax+t*c.dx,py=c.ay+t*c.dy;return {x:px,y:py,distance:Math.hypot(x-px,y-py),segment:c.segment,set:c.set,t};};
  for(const c of candidates){
    if(c.distance>(best?best.distance:maxDistance))break;
    const projected=pointAt(c,c.t);
    if(usable(projected)){if(!best||compare(projected,best)<0)best=projected;continue;}
    /* A rejected projection does not invalidate the rest of a long road segment.
       Search both directions, at most one metre apart by default, then refine
       the first valid boundary. Every returned point passes the caller's test. */
    for(const direction of [-1,1]){
      const end=direction<0?0:1,available=Math.abs(end-c.t)*c.length;
      const limit=Math.min(available,2*(best?best.distance:maxDistance));
      const step=Math.max(spacing,limit/10000);
      let previous=c.t;
      for(let travel=Math.min(step,limit);travel>0&&travel<=limit;travel=Math.min(travel+step,limit)){
        const t=c.t+direction*travel/c.length,p=pointAt(c,t);
        if(p.distance>(best?best.distance:maxDistance)+1e-9)break;
        if(usable(p)){
          let rejected=previous,accepted=t;
          for(let k=0;k<12;k++){const mid=(rejected+accepted)/2,q=pointAt(c,mid);if(usable(q))accepted=mid;else rejected=mid;}
          const refined=pointAt(c,accepted);if(!best||compare(refined,best)<0)best=refined;
          break;
        }
        previous=t;
        if(travel===limit)break;
      }
    }
  }
  return best;
}
/* Distinct nearby choices use the same whole-network validity search. This also
   finds alternatives along a single long segment rather than requiring four
   cardinal rays to happen to intersect the network. */
function nearestCandidates(x,y,roadArrays,maxDistance=400,usable=()=>true,options={}){
  options=options||{};
  const limit=options.limit===undefined?4:options.limit,separation=options.minSeparation===undefined?40:options.minSeparation,minDistance=options.minDistance===undefined?0:options.minDistance;
  if(typeof usable!=='function'||!Number.isInteger(limit)||limit<1||limit>16||![separation,minDistance].every(Number.isFinite)||separation<0||minDistance<0)return [];
  const points=[];
  for(let i=0;i<limit;i++){
    const point=nearest(x,y,roadArrays,maxDistance,p=>p.distance>=minDistance&&points.every(q=>Math.hypot(p.x-q.x,p.y-q.y)>=Math.max(0.01,separation))&&usable(p),options);
    if(!point)break;points.push(point);
  }
  return points;
}
return {nearest,nearestCandidates,nearby:nearestCandidates};
});
