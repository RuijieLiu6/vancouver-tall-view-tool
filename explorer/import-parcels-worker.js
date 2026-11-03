/* Private mesh coordinates stay in this worker and are never sent with the public-data request. */
'use strict';
importScripts('import-parcels.js');
self.onmessage=async event=>{
  const {captured,offset,dataURL}=event.data||{};
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),19000);
  try {
    const prepared=await ImportParcels.prepareCapture(captured);
    if(!prepared?.triangles&&!prepared?.projected){self.postMessage({result:{status:'review',reason:prepared?.reason||'Model footprint unavailable.',polygons:[],ids:[]}});return;}
    const url=new URL(dataURL,self.location.href);
    if(url.origin!==self.location.origin)throw Error('Property source must use the application origin.');
    const response=await fetch(url.href,{signal:controller.signal});
    if(!response.ok)throw Error('Property parcel data unavailable.');
    if(Number(response.headers.get('content-length'))>45000000)throw Error('Property parcel data exceeds the lookup limit.');
    // Bound actual decoded bytes as well as the optional HTTP size header.
    const reader=response.body?.getReader();let text='';
    if(!reader)throw Error('This browser cannot stream the property parcel snapshot.');
    const decoder=new TextDecoder();let bytes=0;
    while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>45000000){await reader.cancel();throw Error('Property parcel data exceeds the lookup limit.');}text+=decoder.decode(value,{stream:true});}
    text+=decoder.decode();const data=JSON.parse(text);
    if(!Array.isArray(data.parcels)||data.parcels.length>150000)throw Error('Unsupported property parcel data.');
    const result=await ImportParcels.match(prepared,offset,data);
    self.postMessage({result});
  }catch(error){self.postMessage({error:error.name==='AbortError'?'Property parcel lookup timed out.':error.message});}
  finally{clearTimeout(timer);self.close();}
};
