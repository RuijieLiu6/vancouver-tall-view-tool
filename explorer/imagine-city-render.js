/* Render-only transforms. Source vertices, study proposals and cameras stay intact. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.ImagineCityRender=api;})(typeof globalThis==='undefined'?this:globalThis,function(){
  'use strict';
  function buildAttributes(catalogue,renderIndex,vertexCount,result){
    const c=catalogue?.columns,count=c?.osm_id?.length;
    if(!c||!Number.isInteger(vertexCount)||vertexCount<0||vertexCount>8000000||!renderIndex||result?.bases?.length!==count||result?.scales?.length!==count)throw new Error('Matching city render records required');
    const values=new Float32Array(vertexCount*2);
    for(let row=0;row<count;row++){
      const base=result.bases[row],scale=result.scales[row],start=c.index_offset[row],length=c.index_count[row];
      if(!Number.isFinite(base)||!Number.isFinite(scale)||scale<0||scale>10000||!Number.isInteger(start)||!Number.isInteger(length)||start<0||length<0||start+length>renderIndex.length)throw new Error('Invalid city height transform');
      for(let j=start;j<start+length;j++){
        const vertex=renderIndex[j];if(!Number.isInteger(vertex)||vertex<0||vertex>=vertexCount)throw new Error('Invalid city render vertex');
        const k=vertex*2;values[k]=base;values[k+1]=scale;
      }
    }
    return values;
  }
  function inverseRay(origin,direction,base,scale){
    if(!Number.isFinite(base)||!Number.isFinite(scale)||scale<=0)return null;
    return {o:[origin[0],origin[1],base+(origin[2]-base)/scale],d:[direction[0],direction[1],direction[2]/scale]};
  }
  function transformedBounds(box,base,scale){return [box[0],box[1],base+(box[2]-base)*scale,box[3],box[4],base+(box[5]-base)*scale];}
  // A CPU-only broad phase for Imagine picking. Leaves retain source-row identity;
  // exact triangle tests remain the caller's responsibility.
  function createPickIndex(sources,resultAssets){
    const rows=[];
    for(const source of sources||[]){
      const asset=source?.asset,c=source?.columns,r=resultAssets?.[asset];
      if(typeof asset!=='string'||!c||!r?.bases||!r?.scales)continue;
      const nestedBounds=Array.isArray(c.bbox?.[0])||ArrayBuffer.isView(c.bbox?.[0]);
      const bboxCount=nestedBounds?(c.bbox?.length||0):((c.bbox?.length||0)/6|0);
      const count=Math.min(bboxCount,c.index_offset?.length||0,c.index_count?.length||0,r.bases.length,r.scales.length);
      for(let index=0;index<count;index++){
        const base=r.bases[index],scale=r.scales[index],offset=c.index_offset[index],length=c.index_count[index],k=index*6;
        if(!Number.isFinite(base)||!Number.isFinite(scale)||scale<=0||!Number.isInteger(offset)||offset<0||!Number.isInteger(length)||length<=0)continue;
        const b=nestedBounds?c.bbox[index]:c.bbox,boff=nestedBounds?0:k,loX=b[boff],loY=b[boff+1],loZ=base+(b[boff+2]-base)*scale,hiX=b[boff+3],hiY=b[boff+4],hiZ=base+(b[boff+5]-base)*scale;
        if(![loX,loY,loZ,hiX,hiY,hiZ].every(Number.isFinite)||loX>hiX||loY>hiY||loZ>hiZ)continue;
        rows.push({asset,index,base,scale,bounds:[loX,loY,loZ,hiX,hiY,hiZ],cx:(loX+hiX)/2,cy:(loY+hiY)/2,cz:(loZ+hiZ)/2});
      }
    }
    const nodes=[],leafSize=8;
    function makeNode(start,end){
      const id=nodes.length,node={bounds:[Infinity,Infinity,Infinity,-Infinity,-Infinity,-Infinity],left:-1,right:-1,start,end};nodes.push(node);
      for(let i=start;i<end;i++){const b=rows[i].bounds;for(let a=0;a<3;a++){node.bounds[a]=Math.min(node.bounds[a],b[a]);node.bounds[a+3]=Math.max(node.bounds[a+3],b[a+3]);}}
      if(end-start<=leafSize)return id;
      let axis=0,spread=-1;
      for(let a=0;a<3;a++){let mn=Infinity,mx=-Infinity;for(let i=start;i<end;i++){const v=rows[i][['cx','cy','cz'][a]];mn=Math.min(mn,v);mx=Math.max(mx,v);}if(mx-mn>spread){spread=mx-mn;axis=a;}}
      const key=['cx','cy','cz'][axis],mid=(start+end)>>1;
      // In-place quickselect keeps construction near O(n log n) without sorting
      // every recursive slice or allocating temporary row arrays.
      let lo=start,hi=end-1;
      while(lo<hi){const pivot=rows[(lo+hi)>>1][key];let i=lo,j=hi;while(i<=j){while(rows[i][key]<pivot)i++;while(rows[j][key]>pivot)j--;if(i<=j){const t=rows[i];rows[i]=rows[j];rows[j]=t;i++;j--;}}if(mid<=j)hi=j;else if(mid>=i)lo=i;else break;}
      node.left=makeNode(start,mid);node.right=makeNode(mid,end);return id;
    }
    if(rows.length)makeNode(0,rows.length);
    function rayBox(o,d,b,best){let near=0,far=best;for(let a=0;a<3;a++){if(d[a]===0){if(o[a]<b[a]||o[a]>b[a+3])return Infinity;continue;}let x=(b[a]-o[a])/d[a],y=(b[a+3]-o[a])/d[a];if(x>y){const t=x;x=y;y=t;}near=Math.max(near,x);far=Math.min(far,y);if(far<near)return Infinity;}return far<0?Infinity:near;}
    function pick(origin,direction,intersect){
      if(!rows.length||typeof intersect!=='function'||!origin||!direction||![...origin,...direction].every(Number.isFinite))return null;
      let best=Infinity,hit=null;const rootNear=rayBox(origin,direction,nodes[0].bounds,Infinity);if(!Number.isFinite(rootNear))return null;const stack=[{id:0,near:rootNear}];
      while(stack.length){const item=stack.pop();if(item.near>best)continue;const n=nodes[item.id];
        if(n.left<0){const candidates=[];for(let i=n.start;i<n.end;i++){const row=rows[i],near=rayBox(origin,direction,row.bounds,best);if(Number.isFinite(near)&&near<=best)candidates.push({row,near});}candidates.sort((a,b)=>a.near-b.near);for(const candidate of candidates){if(candidate.near>best)break;const row=candidate.row,t=intersect({asset:row.asset,index:row.index,base:row.base,scale:row.scale},origin,direction);if(Number.isFinite(t)&&t>0&&t<best){best=t;hit={asset:row.asset,index:row.index,base:row.base,scale:row.scale,t};}}}
        else {const l=nodes[n.left],r=nodes[n.right],tl=rayBox(origin,direction,l.bounds,best),tr=rayBox(origin,direction,r.bounds,best);if(tl<tr){if(Number.isFinite(tr))stack.push({id:n.right,near:tr});if(Number.isFinite(tl))stack.push({id:n.left,near:tl});}else{if(Number.isFinite(tl))stack.push({id:n.left,near:tl});if(Number.isFinite(tr))stack.push({id:n.right,near:tr});}}
      }
      return hit;
    }
    return {pick,size:rows.length};
  }
  function createOcclusionIndex(meshes,trianglesPerChunk=64){
    if(!Number.isSafeInteger(trianglesPerChunk)||trianglesPerChunk<1)throw new Error('A positive triangle chunk size is required');
    const sources=[],transforms={},chunksByAsset={};let size=0;
    for(const mesh of meshes||[]){
      const asset=mesh?.asset,pos=mesh?.pos,idx=mesh?.idx;if(typeof asset!=='string'||!pos||!idx)continue;
      const chunks=[];
      for(let start=0;start+2<idx.length;start+=trianglesPerChunk*3){
        const end=Math.min(idx.length,start+trianglesPerChunk*3),bounds=[Infinity,Infinity,Infinity,-Infinity,-Infinity,-Infinity];let valid=false;
        for(let i=start;i+2<end;i+=3){const vi=[idx[i],idx[i+1],idx[i+2]];if(vi.some(v=>!Number.isInteger(v)||v<0||v*3+2>=pos.length||!Number.isFinite(pos[v*3])||!Number.isFinite(pos[v*3+1])||!Number.isFinite(pos[v*3+2])))continue;
          valid=true;for(const v of vi){const k=v*3;for(let a=0;a<3;a++){bounds[a]=Math.min(bounds[a],pos[k+a]);bounds[a+3]=Math.max(bounds[a+3],pos[k+a]);}}
        }
        if(valid){chunks.push({start,count:end-start,bounds});size++;}
      }
      if(chunks.length){chunksByAsset[asset]=chunks;sources.push({asset,columns:{bbox:chunks.map(c=>c.bounds),index_offset:chunks.map((_,i)=>i),index_count:chunks.map(()=>1)}});transforms[asset]={bases:chunks.map(()=>0),scales:chunks.map(()=>1)};}
    }
    const index=createPickIndex(sources,transforms);
    return {size,pick(origin,direction,intersect){if(typeof intersect!=='function')return null;const hit=index.pick(origin,direction,(row,o,d)=>{const chunk=chunksByAsset[row.asset]?.[row.index];return chunk?intersect({asset:row.asset,start:chunk.start,count:chunk.count},o,d):Infinity;});return hit?{asset:hit.asset,start:chunksByAsset[hit.asset][hit.index].start,count:chunksByAsset[hit.asset][hit.index].count,t:hit.t}:null;}};
  }
  return {buildAttributes,inverseRay,transformedBounds,createPickIndex,createOcclusionIndex};
});
