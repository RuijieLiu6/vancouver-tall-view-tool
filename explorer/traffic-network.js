/* Mapped vehicular roads and approximate, approach-anchored bridge profiles.
 * Bridge heights are inferred model geometry, never surveyed deck elevations.
 * An explicit illustrative land envelope prevents inferred decks being buried.
 * No connection is added between road endpoints that are not already shared.
 */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.TrafficNetwork=api;})(typeof globalThis==='undefined'?this:globalThis,function(){
'use strict';
const VEHICULAR=new Set(['motorway','motorway_link','trunk','trunk_link','primary','primary_link','secondary','secondary_link','tertiary','tertiary_link','residential','living_street','unclassified','service','road']);
const finite=z=>z!==null&&Number.isFinite(z)&&Math.abs(z)<1e20;
const nodeKey=(x,y)=>Math.round(x*100)+','+Math.round(y*100);
const segmentKey=(ax,ay,bx,by)=>nodeKey(ax,ay)+'>'+nodeKey(bx,by);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

function metadata(way){
  const tags=way.tags||{},lanes=parseFloat(tags.lanes),explicit=parseFloat(tags.width),fallback=way.highway==='service'?1:/motorway|trunk/.test(way.highway)?3:2;
  const roadWidth=clamp(Number.isFinite(explicit)&&explicit>0?explicit:(Number.isFinite(lanes)&&lanes>0?lanes:fallback)*3.1+1,3,30);
  const general=tags['sidewalk:both']||tags.sidewalk,side=(value,direction)=>value?!['no','none','separate'].includes(value)&&value!==(direction==='left'?'right':'left'):!['service','motorway','motorway_link','trunk','trunk_link'].includes(way.highway);
  return {vehicular:true,roadWidth,leftSidewalk:side(tags['sidewalk:left']||general,'left'),rightSidewalk:side(tags['sidewalk:right']||general,'right'),name:way.name||'',highway:way.highway,wayId:way.id};
}

function interpolate(nodes,initial){
  const free=[...nodes].filter(n=>!n.anchor&&!n.floorFixed),index=new Map(free.map((n,i)=>[n,i])),count=free.length;
  if(!count)return {iterations:0,converged:true};
  const diagonal=new Float64Array(count),rhs=new Float64Array(count),x=new Float64Array(count).fill(initial),neighbors=[];
  for(let i=0;i<count;i++){
    const row=[];
    for(const edge of free[i].edges){const other=edge.a===free[i]?edge.b:edge.a,w=1/edge.length;diagonal[i]+=w;if(other.anchor||other.floorFixed)rhs[i]+=w*other.z;else row.push([index.get(other),w]);}
    neighbors.push(row);
  }
  const multiply=v=>{const out=new Float64Array(count);for(let i=0;i<count;i++){let value=diagonal[i]*v[i];for(const [j,w] of neighbors[i])value-=w*v[j];out[i]=value;}return out;};
  const dot=(a,b)=>a.reduce((sum,v,i)=>sum+v*b[i],0),ax=multiply(x),residual=rhs.map((v,i)=>v-ax[i]),scaled=residual.map((v,i)=>v/diagonal[i]);
  let direction=scaled.slice(),rz=dot(residual,scaled),iterations=0,converged=false;
  const tolerance=1e-10*Math.max(1,Math.sqrt(dot(rhs,rhs))),maximum=Math.min(4000,count*4+20);
  for(;iterations<maximum;iterations++){
    if(Math.sqrt(dot(residual,residual))<=tolerance){converged=true;break;}
    const ad=multiply(direction),denominator=dot(direction,ad);if(!Number.isFinite(denominator)||denominator<=0)break;
    const alpha=rz/denominator;
    for(let i=0;i<count;i++){x[i]+=alpha*direction[i];residual[i]-=alpha*ad[i];scaled[i]=residual[i]/diagonal[i];}
    const next=dot(residual,scaled),beta=next/rz;
    for(let i=0;i<count;i++)direction[i]=scaled[i]+beta*direction[i];
    rz=next;
  }
  if(Math.sqrt(dot(residual,residual))<=tolerance)converged=true;
  for(let i=0;i<count;i++)free[i].z=x[i];
  return {iterations,converged};
}

/* The lower-bound active set keeps the length-weighted profile smooth while
   preventing mapped land beneath a viaduct from burying an inferred deck. */
function terrainEnvelope(nodes,initial,floorAt,clearance){
  for(const n of nodes){n.floorFixed=false;const ground=n.anchor?null:floorAt(n.x,n.y);n.floor=finite(ground)?ground+clearance:-Infinity;}
  let iterations=0;
  for(let pass=0;pass<nodes.size*4+20;pass++){
    const solved=interpolate(nodes,initial);iterations+=solved.iterations;
    if(!solved.converged)return {iterations,converged:false};
    let changed=false;
    for(const n of nodes)if(!n.anchor&&!n.floorFixed&&n.z<n.floor-1e-7){n.z=n.floor;n.floorFixed=true;changed=true;}
    if(changed)continue;
    for(const n of nodes){if(!n.floorFixed)continue;let gradient=0;for(const r of n.edges){const other=r.a===n?r.b:r.a;gradient+=(n.z-other.z)/r.length;}if(gradient<-1e-7){n.floorFixed=false;changed=true;}}
    if(!changed)return {iterations,converged:true};
  }
  return {iterations,converged:false};
}

function create(network,options={}){
  options=options||{};
  const stats={inputSegments:0,vehicularSegments:0,groundSegments:0,deckSegments:0,resolvedDeckSegments:0,unresolvedDeckSegments:0,deckComponents:0,resolvedDeckComponents:0,unresolvedDeckComponents:0,boundaryExtrapolatedComponents:0,boundaryExtrapolatedDeckSegments:0,outputSegments:0,deckBelowTerrainSamples:0,terrainEnvelope:true,terrainEnvelopeClearance:0.2,terrainEnvelopeConstrainedNodes:0,approximateDeckHeights:true,classCounts:{},excluded:{pedestrian:0,nonVehicular:0,tunnel:0,access:0,subsurface:0,invalid:0},unresolved:[],components:[],extent:null};
  const output=[],groundOutput=[],deckOutput=[],records=[],lookup=new Map(),nodes=new Map(),ground=[],decks=[];
  const groundAt=typeof options.groundAt==='function'?options.groundAt:()=>null,terrainAt=typeof options.terrainAt==='function'?options.terrainAt:groundAt;
  const floorAt=(x,y)=>{const ground=groundAt(x,y);if(!finite(ground))return null;const terrain=terrainAt(x,y);return finite(terrain)?Math.max(ground,terrain):ground;};
  const result=()=>({roads:new Float32Array(output),groundRoads:new Float32Array(groundOutput),deckRoads:new Float32Array(deckOutput),segmentOptions:(ax,ay,bx,by)=>lookup.get(segmentKey(ax,ay,bx,by))||{vehicular:false,skip:true},stats,records});
  if(!network||network.schema!=='vista-street-network/1'||!Array.isArray(network.positions)||!Array.isArray(network.ways)||network.positions.length!==network.segment_flags?.length*6)return result();
  const positions=network.positions;
  const bounds=options.bounds||network.bounds_model_m,validBounds=Array.isArray(bounds)&&bounds.length===4&&bounds.every(Number.isFinite)&&bounds[0]<bounds[2]&&bounds[1]<bounds[3];
  const onBoundary=n=>validBounds&&n.x>=bounds[0]-0.05&&n.x<=bounds[2]+0.05&&n.y>=bounds[1]-0.05&&n.y<=bounds[3]+0.05&&[Math.abs(n.x-bounds[0]),Math.abs(n.x-bounds[2]),Math.abs(n.y-bounds[1]),Math.abs(n.y-bounds[3])].some(d=>d<=0.05);
  function getNode(x,y){const key=nodeKey(x,y);let n=nodes.get(key);if(!n){n={key,x,y,edges:[],approaches:[],z:null,anchor:false};nodes.set(key,n);}return n;}
  for(const way of network.ways){
    if(!Number.isInteger(way.start)||!Number.isInteger(way.count)||way.start<0||way.count<0||way.start+way.count>network.segment_flags.length)continue;
    const tags=way.tags||{},base=metadata(way),layer=parseFloat(tags.layer);
    for(let i=way.start;i<way.start+way.count;i++){
      stats.inputSegments++;
      let reason=null;
      if(way.highway==='pedestrian')reason='pedestrian';
      else if(!VEHICULAR.has(way.highway))reason='nonVehicular';
      else if((network.segment_flags[i]&2)||!['no','false','0',''].includes(tags.tunnel||'no'))reason='tunnel';
      else if((network.segment_flags[i]&8)||['access','vehicle','motor_vehicle','motorcar'].some(k=>['no','private'].includes(tags[k])))reason='access';
      else if(Number.isFinite(layer)&&layer<0)reason='subsurface';
      if(reason){stats.excluded[reason]++;continue;}
      const ax=positions[i*6],ay=positions[i*6+1],bx=positions[i*6+3],by=positions[i*6+4],length=Math.hypot(bx-ax,by-ay);
      if(![ax,ay,bx,by,length].every(Number.isFinite)||length<0.01){stats.excluded.invalid++;continue;}
      const deck=!!(network.segment_flags[i]&17)||Number.isFinite(layer)&&layer>0;
      const r={ax,ay,bx,by,length,sourceSegment:i,meta:{...base,deck,approximateHeight:deck},za:0,zb:0};
      stats.vehicularSegments++;stats.classCounts[way.highway]=(stats.classCounts[way.highway]||0)+1;
      if(deck){r.a=getNode(ax,ay);r.b=getNode(bx,by);r.a.edges.push(r);r.b.edges.push(r);decks.push(r);stats.deckSegments++;}
      else{ground.push(r);stats.groundSegments++;}
    }
  }
  /* Only matched approach endpoints can establish a deck anchor. Land below an
     interior bridge vertex is not evidence of that bridge's elevation. */
  for(const r of ground)for(const [x,y] of [[r.ax,r.ay],[r.bx,r.by]]){const n=nodes.get(nodeKey(x,y));if(n)n.approaches.push(r);}
  function approachHeight(n){
    if(n.edges.length!==1||!n.approaches.length)return null;
    const z=groundAt(n.x,n.y);if(finite(z))return {z,offset:0};
    for(const distance of [0.5,1,2,4,8,16,32])for(const r of n.approaches){
      const nearA=nodeKey(r.ax,r.ay)===n.key,dx=(nearA?r.bx:r.ax)-n.x,dy=(nearA?r.by:r.ay)-n.y,t=Math.min(1,distance/r.length),height=groundAt(n.x+dx*t,n.y+dy*t);
      if(finite(height))return {z:height,offset:Math.min(distance,r.length)};
    }
    return null;
  }
  const visited=new Set();
  for(const first of decks){
    if(visited.has(first))continue;
    const stack=[first],edges=[],componentNodes=new Set();
    while(stack.length){const r=stack.pop();if(visited.has(r))continue;visited.add(r);edges.push(r);for(const n of [r.a,r.b]){componentNodes.add(n);for(const edge of n.edges)if(!visited.has(edge))stack.push(edge);}}
    stats.deckComponents++;
    const anchors=[];
    for(const n of componentNodes){const a=approachHeight(n);if(a){n.anchor=true;n.z=a.z;anchors.push({x:n.x,y:n.y,z:a.z,sampleOffset:a.offset});}}
    const names=[...new Set(edges.map(r=>r.meta.name).filter(Boolean))],wayIds=[...new Set(edges.map(r=>r.meta.wayId))];
    const info={names,wayIds,segments:edges.length,anchors,extent:[Math.min(...[...componentNodes].map(n=>n.x)),Math.min(...[...componentNodes].map(n=>n.y)),Math.max(...[...componentNodes].map(n=>n.x)),Math.max(...[...componentNodes].map(n=>n.y))]};
    const wet=edges.some(r=>groundAt((r.ax+r.bx)/2,(r.ay+r.by)/2)===null);
    const terminals=[...componentNodes].filter(n=>n.edges.length===1&&!n.anchor),boundaryContinuation=anchors.length===1&&anchors[0].z>0.5&&terminals.length>0&&terminals.every(onBoundary);
    let reason=anchors.length<2&&!boundaryContinuation?'fewer-than-two-approach-anchors':wet&&anchors.every(a=>Math.abs(a.z)<0.5)?'unknown-water-clearance':null;
    if(reason){stats.unresolvedDeckComponents++;stats.unresolvedDeckSegments+=edges.length;stats.unresolved.push({...info,reason});continue;}
    const initial=anchors.reduce((s,a)=>s+a.z,0)/anchors.length;
    info.heightMethod=boundaryContinuation?'illustrative-constant-boundary-continuation':'approach-anchored-harmonic-interpolation';
    /* Shared nodes retain one elevation across all mapped ways. The explicit
       illustrative terrain envelope adds a land floor, never a water causeway. */
    const solved=terrainEnvelope(componentNodes,initial,floorAt,stats.terrainEnvelopeClearance);
    if(!solved.converged||![...componentNodes].every(n=>finite(n.z))){stats.unresolvedDeckComponents++;stats.unresolvedDeckSegments+=edges.length;stats.unresolved.push({...info,reason:'height-interpolation-did-not-converge'});continue;}
    info.iterations=solved.iterations;info.converged=true;info.minZ=Math.min(...[...componentNodes].map(n=>n.z));info.maxZ=Math.max(...[...componentNodes].map(n=>n.z));stats.components.push(info);
    info.terrainEnvelope=true;info.constrainedNodes=[...componentNodes].filter(n=>n.floorFixed).length;stats.terrainEnvelopeConstrainedNodes+=info.constrainedNodes;
    stats.resolvedDeckComponents++;stats.resolvedDeckSegments+=edges.length;
    if(boundaryContinuation){stats.boundaryExtrapolatedComponents++;stats.boundaryExtrapolatedDeckSegments+=edges.length;}
    for(const r of edges){
      r.za=r.a.z;r.zb=r.b.z;
      r.meta.heightMethod=info.heightMethod;r.meta.boundaryContinuation=boundaryContinuation;r.meta.terrainEnvelope=true;
      r.meta.heightAt=(x,y)=>{if(!Number.isFinite(x)||!Number.isFinite(y))return null;const t=clamp(((x-r.ax)*(r.bx-r.ax)+(y-r.ay)*(r.by-r.ay))/(r.length*r.length),0,1),base=r.za+(r.zb-r.za)*t,ground=floorAt(x,y);if(ground===null)return base;const a=r.a.anchor?0:stats.terrainEnvelopeClearance,b=r.b.anchor?0:stats.terrainEnvelopeClearance,clearance=a+(b-a)*t;return Math.max(base,ground+clearance);};
      const mx=(r.ax+r.bx)/2,my=(r.ay+r.by)/2,terrain=floorAt(mx,my),z=r.meta.heightAt(mx,my);if(finite(terrain)&&z<terrain-0.5)stats.deckBelowTerrainSamples++;
      ground.push(r);
    }
  }
  for(const r of ground){
    const values=[r.ax,r.ay,r.za,r.bx,r.by,r.zb];output.push(...values);(r.meta.deck?deckOutput:groundOutput).push(...values);records.push(r);
    lookup.set(segmentKey(r.ax,r.ay,r.bx,r.by),r.meta);
    lookup.set(segmentKey(r.bx,r.by,r.ax,r.ay),{...r.meta,leftSidewalk:r.meta.rightSidewalk,rightSidewalk:r.meta.leftSidewalk});
  }
  stats.outputSegments=records.length;
  if(records.length)stats.extent=records.reduce((b,r)=>[Math.min(b[0],r.ax,r.bx),Math.min(b[1],r.ay,r.by),Math.max(b[2],r.ax,r.bx),Math.max(b[3],r.ay,r.by)],[Infinity,Infinity,-Infinity,-Infinity]);
  return result();
}
return {create,segmentKey};
});
