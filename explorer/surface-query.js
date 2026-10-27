/* Spatial queries in model metres; meshes may overlap and contain gaps. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.SurfaceQuery=api;})(typeof globalThis==='undefined'?this:globalThis,function(){
'use strict';
const EDGE_EPSILON=1e-8;
const MAX_CELLS_PER_ITEM=1024;
const MAX_BUCKET_REFERENCES=1000000;

function cellSize(options,fallback){
  const value=options&&options.cellSize;
  return Number.isFinite(value)&&value>0?value:fallback;
}

/* Very broad items stay in an overflow list rather than filling the grid. */
function spatialIndex(items,size){
  const buckets=new Map(),overflow=[];
  let references=0;
  for(let id=0;id<items.length;id++){
    const item=items[id],x0=Math.floor(item.minX/size),x1=Math.floor(item.maxX/size),y0=Math.floor(item.minY/size),y1=Math.floor(item.maxY/size);
    const count=(x1-x0+1)*(y1-y0+1);
    if(![x0,x1,y0,y1].every(Number.isSafeInteger)||count>MAX_CELLS_PER_ITEM||references+count>MAX_BUCKET_REFERENCES){overflow.push(id);continue;}
    for(let x=x0;x<=x1;x++)for(let y=y0;y<=y1;y++){
      const key=x+','+y;
      let bucket=buckets.get(key);
      if(!bucket){bucket=[];buckets.set(key,bucket);}
      bucket.push(id);
    }
    references+=count;
  }
  return function(x,y,visit){
    const bucket=buckets.get(Math.floor(x/size)+','+Math.floor(y/size));
    if(bucket)for(const id of bucket)visit(items[id]);
    for(const id of overflow)visit(items[id]);
  };
}

function createMeshSampler(rawMeshes,options){
  const triangles=[];
  for(const mesh of Array.isArray(rawMeshes)?rawMeshes:[]){
    if(!mesh||!mesh.pos||!mesh.idx)continue;
    const pos=mesh.pos,idx=mesh.idx,vertexCount=Math.floor(pos.length/3);
    for(let i=0;i+2<idx.length;i+=3){
      const a=idx[i],b=idx[i+1],c=idx[i+2];
      if(![a,b,c].every(n=>Number.isInteger(n)&&n>=0&&n<vertexCount))continue;
      const ax=pos[a*3],ay=pos[a*3+1],az=pos[a*3+2],bx=pos[b*3],by=pos[b*3+1],bz=pos[b*3+2],cx=pos[c*3],cy=pos[c*3+1],cz=pos[c*3+2];
      if(![ax,ay,az,bx,by,bz,cx,cy,cz].every(Number.isFinite))continue;
      const abx=bx-ax,aby=by-ay,acx=cx-ax,acy=cy-ay,den=abx*acy-aby*acx;
      const scale=Math.max(Math.abs(abx),Math.abs(aby),Math.abs(acx),Math.abs(acy));
      if(!Number.isFinite(den)||Math.abs(den)<=Number.EPSILON*scale*scale*16)continue;
      const epsilon=EDGE_EPSILON*Math.max(1,scale);
      const minX=Math.min(ax,bx,cx)-epsilon,maxX=Math.max(ax,bx,cx)+epsilon,minY=Math.min(ay,by,cy)-epsilon,maxY=Math.max(ay,by,cy)+epsilon;
      triangles.push({ax,ay,az,abx,aby,abz:bz-az,acx,acy,acz:cz-az,invDen:1/den,minX,maxX,minY,maxY});
    }
  }
  const visitCandidates=spatialIndex(triangles,cellSize(options,100));
  return function(x,y){
    if(!Number.isFinite(x)||!Number.isFinite(y))return null;
    let top=null;
    visitCandidates(x,y,t=>{
      if(x<t.minX||x>t.maxX||y<t.minY||y>t.maxY)return;
      const dx=x-t.ax,dy=y-t.ay,u=(dx*t.acy-dy*t.acx)*t.invDen,v=(t.abx*dy-t.aby*dx)*t.invDen;
      if(u<-EDGE_EPSILON||v<-EDGE_EPSILON||u+v>1+EDGE_EPSILON)return;
      const z=t.az+u*t.abz+v*t.acz;
      if(Number.isFinite(z)&&(top===null||z>top))top=z;
    });
    return top;
  };
}

/* Returns original records; callers can refine bbox hits against a roof mesh. */
function createBoxIndex(records,options){
  const boxes=[];
  for(const record of Array.isArray(records)?records:[]){
    const box=record&&record.box;
    if(!box||box.length<6||![box[0],box[1],box[2],box[3],box[4],box[5]].every(Number.isFinite)||box[0]>box[3]||box[1]>box[4]||box[2]>box[5])continue;
    boxes.push({record,order:boxes.length,minX:box[0],minY:box[1],maxX:box[3],maxY:box[4]});
  }
  const visitCandidates=spatialIndex(boxes,cellSize(options,60));
  return function(x,y){
    if(!Number.isFinite(x)||!Number.isFinite(y))return [];
    const hits=[];
    visitCandidates(x,y,b=>{if(x>=b.minX&&x<=b.maxX&&y>=b.minY&&y<=b.maxY)hits.push(b);});
    hits.sort((a,b)=>a.order-b.order);
    return hits.map(b=>b.record);
  };
}

return {createMeshSampler,createBoxIndex};
});
