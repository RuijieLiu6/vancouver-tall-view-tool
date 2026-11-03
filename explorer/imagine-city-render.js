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
  return {buildAttributes,inverseRay,transformedBounds};
});
