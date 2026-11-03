/* Lazy source-derived existing-building analysis. Every numerical view result is hypothetical. */
(function(root,factory){const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.VistaBuildingViewHeights=api;})(typeof globalThis==='undefined'?this:globalThis,function(root){
'use strict';
let metadata=null,metadataPending=null,dataPending=null,index=null;
function fetchJson(file){const fetcher=root.ProjectAPI&&root.ProjectAPI.fetch?root.ProjectAPI.fetch.bind(root.ProjectAPI):root.fetch.bind(root);return fetcher('/generated/'+file).then(response=>{if(response.ok===false)throw Error('Building view data unavailable ('+response.status+').');return response.json();});}
function freeze(value){if(value&&typeof value==='object'&&!Object.isFrozen(value)){for(const item of Object.values(value))freeze(item);Object.freeze(value);}return value;}
function loadMetadata(){if(metadata)return Promise.resolve(metadata);if(!metadataPending)metadataPending=fetchJson('building_view_heights_metadata.json').then(value=>{if(value.schema!=='vista-building-view-heights/1'||value.officialMaximumAvailable!==false||value.officialPlaneCount!==0)throw Error('Unsupported building view metadata.');metadata=freeze(value);return metadata;}).catch(error=>{metadataPending=null;throw error;});return metadataPending;}
function ingest(payload){
 if(!payload||payload.metadata.schema!=='vista-building-view-heights/1'||!Array.isArray(payload.columns)||!Array.isArray(payload.rows))throw Error('Unsupported building view data.');
 const next=new Map(),columns=payload.columns;
 for(const row of payload.rows){const entry=Object.fromEntries(columns.map((column,i)=>[column,row[i]]));if(!['buildings','ext_buildings'].includes(entry.asset)||typeof entry.osmId!=='string'||entry.officialMaximumHeightM!==null)throw Error('Invalid building view record.');const key=entry.asset+':'+entry.osmId;if(next.has(key))throw Error('Duplicate building view record.');entry.buildingId=key;entry.studyReductionM=Math.max(0,entry.existingHeightM-entry.studyHeightM);
  entry.studyGroundM=Number.isFinite(payload.metadata.study?.groundM)?payload.metadata.study.groundM:null;
  entry.studyViewAllowanceM=entry.viewIds.length&&Number.isFinite(entry.studyCeilingElevationM)&&entry.studyGroundM!==null?entry.studyCeilingElevationM-entry.studyGroundM:null;
  // The view-only allowance is independent of the chosen existing-height baseline.
  entry.studyViewMaximumHeightM=entry.studyViewAllowanceM===null?null:Math.max(0,entry.studyViewAllowanceM);
  entry.provenance=payload.metadata.provenance;entry.hypothetical=true;next.set(key,freeze(entry));}
 if(next.size!==payload.metadata.count)throw Error('Incomplete building view data.');metadata=freeze(payload.metadata);index=next;return metadata;
}
function load(){if(index)return Promise.resolve(metadata);if(!dataPending)dataPending=fetchJson('building_view_heights.json').then(ingest).catch(error=>{dataPending=null;throw error;});return dataPending;}
function get(asset,osmId){if(!index)return null;const normalized=asset===true?'ext_buildings':asset===false?'buildings':asset;return index.get(normalized+':'+String(osmId))||null;}
function getMetadata(){return metadata;}
function isLoaded(){return index!==null;}
return Object.freeze({load,loadMetadata,get,getMetadata,isLoaded});
});
