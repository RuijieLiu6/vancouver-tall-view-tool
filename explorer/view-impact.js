/* Hypothetical horizontal planes at raw observer elevations; never City ceilings. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.ImagineViewImpact=api;})(typeof globalThis==='undefined'?this:globalThis,function(){
'use strict';
const sourceUrl='https://services3.arcgis.com/qrcTTRTwUoS8N47o/arcgis/rest/services/ViewCone/FeatureServer/0';
const metadata=Object.freeze({sourceUrl,checkedAt:'2026-11-02',sourceField:'VIEWPOINT_ELEVATION_M',sourceCredit:'City of Vancouver',assumption:'horizontal plane at raw observer elevation; no verified slope/datum/eyeheight',referenceAssumption:'All raw observer elevations and entered flat ground are assumed to share one vertical reference.',pitchDeg:0,verifiedCityCeiling:false});
const elevations={'A':4.54,'B1':4.48,'B2':4.48,'D':4.45,'E':17.95,'G1':6,'G2':6,'H':7.2,'J1':6.63,'J2':6.63,'K':5.5,'3.2.1':124.6,'3.2.2':124.6,'3.2.3':124.6,'3.2.4':124.6,'9.1':30.8,'9.2':30.8,'10':5,'20':43.63,'21':34.6,'22':37.1,'27.1':30.4,'27.2':30.4,'28':56};
const references=Object.freeze(Object.fromEntries(Object.entries(elevations).map(([id,elevationM])=>[id,Object.freeze({elevationM,sourceUrl,sourceField:metadata.sourceField,checkedAt:metadata.checkedAt,pitchDeg:0,verifiedCityCeiling:false})])));
function applicable(parcel){
  if(!parcel||!Array.isArray(parcel._views))return {unknown:true,ceiling:null,ids:[]};
  const ids=[...new Set(parcel._views)];
  if(!ids.length)return {unknown:parcel._viewUnknown!==false,ceiling:null,ids:[]};
  let ceiling=Infinity;const limiting=[];
  for(const id of ids){const ref=typeof id==='string'&&Object.prototype.hasOwnProperty.call(references,id)?references[id]:null;if(!ref||!Number.isFinite(ref.elevationM))return {unknown:true,ceiling:null,ids:[]};if(ref.elevationM<ceiling){ceiling=ref.elevationM;limiting.length=0;limiting.push(id);}else if(ref.elevationM===ceiling)limiting.push(id);}
  return {unknown:false,ceiling,ids:limiting};
}
function prepare(parcels){
  if(!Array.isArray(parcels))throw TypeError('Parcels must be an array.');
  return Float32Array.from(parcels,parcel=>{const value=applicable(parcel);return value.unknown?-Infinity:value.ceiling===null?NaN:value.ceiling;});
}
function analysis(parcel,baselineHeightM,groundM,enabled){
  const baseline=Number.isFinite(baselineHeightM)&&baselineHeightM>=0?baselineHeightM:null;
  const out={ceilingElevationM:null,viewHeightM:null,viewMaximumHeightM:null,resultHeightM:baseline,reductionM:baseline===null?null:0,limitingViews:[],status:'disabled'};
  if(enabled!==true)return out;
  const value=applicable(parcel);
  if(value.unknown)return {...out,resultHeightM:null,reductionM:null,status:'unknown'};
  if(value.ceiling===null)return {...out,status:'outside'};
  out.ceilingElevationM=value.ceiling;out.limitingViews=value.ids;
  if(!Number.isFinite(groundM))return {...out,resultHeightM:null,reductionM:null,status:'unknown'};
  out.viewHeightM=value.ceiling-groundM;
  out.viewMaximumHeightM=Number.isFinite(out.viewHeightM)?Math.max(0,out.viewHeightM):null;
  if(!Number.isFinite(out.viewHeightM)||baseline===null)return {...out,resultHeightM:null,reductionM:null,status:'unknown'};
  out.resultHeightM=Math.max(0,Math.min(baseline,out.viewHeightM));out.reductionM=baseline-out.resultHeightM;out.status='assumed';return out;
}
return Object.freeze({references,metadata,prepare,analysis});
});
