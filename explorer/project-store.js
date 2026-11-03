/* Public derived height records live in project files, never browser storage.
 * The published bundle is read-only. New public-site calculations stay in RAM.
 */
(function(root,factory){
  'use strict';
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root?.document)root.VistaHeightProjectStore=api.createStore({api:root.ProjectAPI});
})(typeof window==='object'?window:null,function(){
  'use strict';
  const SCHEMA='vista-height-catalogue-1', MAX_BYTES=1024*1024;
  function createStore({api,timeoutMs=1500}={}){
    let loading=null,legacy=null,bytes=0;const records=new Map(),sizes=new Map();
    async function request(path,options={},maxBytes=MAX_BYTES){
      if(!api?.fetch)return null;
      const controller=new AbortController();let timer;
      const expired=new Promise(resolve=>{timer=setTimeout(()=>{controller.abort();resolve(null);},timeoutMs);});
      try{return await Promise.race([(async()=>{
        const response=await api.fetch(path,{...options,cache:'no-store',signal:controller.signal});
        if(!response.ok)return null;
        const declared=Number(response.headers?.get('content-length'));
        if(declared>maxBytes)return null;
        const text=await response.text();
        if(new TextEncoder().encode(text).byteLength>maxBytes)return null;
        return JSON.parse(text);
      })().catch(()=>null),expired]);}finally{clearTimeout(timer);}
    }
    function remember(record){
      if(!record||typeof record.key!=='string'||record.key.length>250000||record.version!=='view-height-1')return;
      const size=JSON.stringify(record).length*2;if(size>MAX_BYTES)return;
      bytes-=sizes.get(record.key)||0;records.delete(record.key);records.set(record.key,record);sizes.set(record.key,size);bytes+=size;
      while(records.size>250||bytes>MAX_BYTES){const first=records.keys().next().value;bytes-=sizes.get(first)||0;sizes.delete(first);records.delete(first);}
    }
    async function catalogue(){
      if(!loading)loading=request(api?.isStatic?'/generated/view_height_suggestions.json':'/api/view-height-cache',{headers:{'X-Vista-Project':'1'}}).then(data=>{
        if(data?.schema===SCHEMA&&Array.isArray(data.entries)&&data.entries.length<=250)data.entries.forEach(remember);
      });
      await loading;
    }
    return {
      async get(context,key){if(context?.persistAllowed!==true)return null;await catalogue();return records.get(key)||null;},
      async set(context,record){
        if(context?.persistAllowed!==true||api?.isStatic||!record)return false;
        const result=await request('/api/view-height-cache',{method:'POST',headers:{'Content-Type':'application/json','X-Vista-Project':'1'},body:JSON.stringify({record})});
        if(result?.ok===true&&result.stored===true){remember(record);return true;}return false;
      },
      async backupLegacy(entries){
        if(api?.isStatic||!Array.isArray(entries)||!entries.length||entries.length>250)return false;
        if(entries.some(e=>typeof e?.key!=='string'||!(e.key.startsWith('vista-imagine-edits/')||e.key==='vista-imagine-upper-assumption/1')||typeof e.value!=='string'))return false;
        const body=JSON.stringify({keys:Object.fromEntries(entries.map(e=>[e.key,e.value]))});
        if(body.length*2>2*MAX_BYTES)return false;
        const result=await request('/api/browser-study-backup',{method:'POST',headers:{'Content-Type':'application/json','X-Vista-Project':'1'},body});
        const saved=result?.ok===true&&result.backedUp===true&&result.keys===entries.length;
        if(saved)legacy=null;return saved;
      },
      async getLegacy(key){
        if(api?.isStatic||typeof key!=='string'||!(key.startsWith('vista-imagine-edits/')||key==='vista-imagine-upper-assumption/1'))return null;
        if(!legacy)legacy=request('/api/browser-study-backup',{headers:{'X-Vista-Project':'1'}},2*MAX_BYTES);
        const result=await legacy;if(result?.ok!==true)return null;
        const value=result.keys?.[key];return typeof value==='string'?value:value?JSON.stringify(value):null;
      },
      getState(){return {location:api?.isStatic?'published-project':'local-project',records:records.size,bytes,persistentBrowserStorage:false};}
    };
  }
  return {createStore,SCHEMA};
});
