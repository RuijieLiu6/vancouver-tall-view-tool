/* Optional, read-only same-origin storage audit for development previews. */
(async function(){
  'use strict';
  const cleanup=await window.VistaStoragePolicy?.ready;
  const known=new Set(['vancouver-view-lab-intro-seen/1','vista-imagine-upper-assumption/1','vista-view-height-v1']);
  let legacyKeys=0,databases=null,estimate=null;
  try{for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(known.has(key)||key?.startsWith('vista-imagine-edits/'))legacyKeys++;}}catch(_){}
  try{databases=(await indexedDB.databases()).filter(d=>['vista-imagine-public','vista-imagine-packed'].includes(d.name)).map(d=>d.name);}catch(_){}
  try{const value=await navigator.storage.estimate();estimate={usageBytes:value.usage,usageDetails:value.usageDetails||null};}catch(_){}
  const report={cleanup,legacyVistaKeysRemaining:legacyKeys,vistaDatabasesRemaining:databases,originStorage:estimate,
    projectStore:window.VistaHeightProjectStore?.getState(),persistentBrowserWrites:false};
  const details=document.createElement('details'),summary=document.createElement('summary'),pre=document.createElement('pre');
  summary.textContent='Storage audit';pre.id='storage-selftest-report';pre.textContent=JSON.stringify(report,null,2);details.append(summary,pre);
  document.getElementById('panel')?.append(details);
})();
