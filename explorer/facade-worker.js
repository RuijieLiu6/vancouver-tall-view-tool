/* Derived display buffers only; source geometry stays untouched in the main thread. */
'use strict';
importScripts('facade-bounds.js', 'building-materials.js');
self.onmessage = event => {
  try {
    const began=performance.now(), {raw,catalogue,profiles}=event.data;
    const bounded=FacadeBounds.build(raw,catalogue,{profiles});
    const contextData=new Float32Array(bounded.pos.length/3*4), cols=catalogue.columns;
    for(let row=0;row<cols.index_offset.length;row++) {
      const profile=profiles[row], packed=BuildingMaterials.pack(profile);
      for(let j=cols.index_offset[row],end=j+cols.index_count[row];j<end;j++) {
        const at=bounded.idx[j]*4;
        contextData[at]=profile.baseZ;contextData[at+1]=profile.height;
        contextData[at+2]=profile.seed;contextData[at+3]=packed;
      }
    }
    const result={...bounded,contextData,workerMs:performance.now()-began};
    const transfer=[...new Set(Object.values(result).filter(v=>ArrayBuffer.isView(v)).map(v=>v.buffer))];
    self.postMessage(result,transfer);
  } catch(error) { self.postMessage({error:error?.message || String(error)}); }
};
