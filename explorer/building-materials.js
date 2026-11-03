/* Illustrative Context facades. These profiles describe rendering, not surveyed materials or age. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.BuildingMaterials=api;})(typeof globalThis==='undefined'?this:globalThis,function(){
'use strict';
const FAMILIES=Object.freeze(['office-grid','residential-ribbon','buff-stone','brick','white-brick','concrete']);
const UNKNOWN=new Set(['','yes','building','roof','construction','no']);
const HOMES=new Set(['apartments','residential','house','detached','terrace','semidetached_house','dormitory']);
const UTILITARIAN=new Set(['industrial','warehouse','garage','garages','shed','service','parking','hangar','greenhouse']);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const text=v=>typeof v==='string'?v.trim().toLowerCase():'';
const QUARTER_TURN=Math.PI/2;
function canonicalAngle(value){return Number.isFinite(value)?((value%QUARTER_TURN)+QUARTER_TURN)%QUARTER_TURN:0;}
function validBox(b){return Array.isArray(b)&&b.length===6&&b.every(Number.isFinite)&&b[0]<=b[3]&&b[1]<=b[4]&&b[2]<=b[5]&&b.every(n=>Math.abs(n)<=1e7);}
function hash(value){let n=2166136261;for(let i=0;i<value.length;i++)n=Math.imul(n^value.charCodeAt(i),16777619);return(n>>>0)/4294967296;}
/* A rectangle's perpendicular wall normals describe the same upright facade
   frame. The fourth-angle moment preserves that symmetry without a PCA sign
   ambiguity. At most 256 source triangles are read, including skipped roofs. */
function frameAngle(record){
  const mesh=record?.mesh,explicit=record?.triangles;
  const start=Number.isSafeInteger(record?.start)&&record.start>=0?record.start:0;
  const count=Number.isSafeInteger(record?.count)&&record.count>=0?record.count:Math.max(0,(mesh?.idx?.length||0)-start);
  const triangles=mesh?.pos&&mesh?.idx?Math.floor(Math.min(count,Math.max(0,mesh.idx.length-start))/3):Array.isArray(explicit)?explicit.length:0;
  const stride=Math.max(1,Math.ceil(triangles/256));let cosine=0,sine=0,weight=0;
  for(let triangle=0;triangle<triangles;triangle+=stride){
    let a,b,c;
    if(mesh?.pos&&mesh?.idx){
      const at=start+triangle*3,positions=mesh.pos,indices=mesh.idx;
      const ia=indices[at]*3,ib=indices[at+1]*3,ic=indices[at+2]*3;
      a=[positions[ia],positions[ia+1],positions[ia+2]];b=[positions[ib],positions[ib+1],positions[ib+2]];c=[positions[ic],positions[ic+1],positions[ic+2]];
    }else [a,b,c]=explicit[triangle]||[];
    if(![a,b,c].every(p=>p&&p.length>=3&&Number.isFinite(p[0])&&Number.isFinite(p[1])&&Number.isFinite(p[2])))continue;
    const ux=b[0]-a[0],uy=b[1]-a[1],uz=b[2]-a[2],vx=c[0]-a[0],vy=c[1]-a[1],vz=c[2]-a[2];
    const nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx,length=Math.hypot(nx,ny,nz);
    if(!Number.isFinite(length)||length<1e-8||Math.abs(nz)>length*.35)continue;
    const theta=4*Math.atan2(ny,nx);cosine+=Math.cos(theta)*length;sine+=Math.sin(theta)*length;weight+=length;
  }
  if(weight===0||Math.hypot(cosine,sine)<=weight*.001)return 0;
  return canonicalAngle(Math.atan2(sine,cosine)/4);
}
/* Exact Float32 integer payload: 3 family bits, 4 floor-spacing bits and 8
   angle bits. Shader decoding uses divisions by 4096 and 256. */
function pack(profile){
  const family=Number.isFinite(profile?.family)?clamp(Math.round(profile.family),0,FAMILIES.length-1):5;
  const floorH=Number.isFinite(profile?.floorHeightM)?profile.floorHeightM:3.4;
  const floorStep=clamp(Math.round((floorH-2.5)*10),0,15);
  const angle=Math.round(canonicalAngle(profile?.wallAngle)/QUARTER_TURN*256)%256;
  return family*4096+floorStep*256+angle;
}
function identity(r){return String(r.id??r.key);}
function volume(r){const b=r.box;return Math.max(.01,b[3]-b[0])*Math.max(.01,b[4]-b[1])*Math.max(.01,b[5]-b[2]);}
function representative(a,b){
  const difference=volume(b)-volume(a);if(difference!==0)return difference;
  return identity(a).localeCompare(identity(b))||a.key.localeCompare(b.key);
}
function choose(type,b,seed){
  const height=b[5]-b[2],width=Math.max(b[3]-b[0],b[4]-b[1]);
  if(type==='office')return {family:0,floorHeightM:3.8,basis:'osm_type'};
  if(HOMES.has(type))return {family:height>=24?1:(seed<.68?4:2),floorHeightM:3.1,basis:'osm_type'};
  if(type==='hotel')return {family:height>=30?1:2,floorHeightM:3.2,basis:'osm_type'};
  if(type==='commercial')return {family:height>=30?0:(seed<.38?3:2),floorHeightM:3.7,basis:'osm_type'};
  if(type==='retail')return {family:height<=24&&seed<.55?3:2,floorHeightM:3.8,basis:'osm_type'};
  if(UTILITARIAN.has(type))return {family:5,floorHeightM:4,basis:'osm_type'};
  if(['school','university','college','hospital','church','civic','public'].includes(type))return {family:seed<.26&&height<=24?3:2,floorHeightM:3.6,basis:'osm_type'};
  /* Missing usage stays neutral at ordinary heights. Tall proportions only choose
     an illustrative glazing rhythm; they never become a claimed building use. */
  if(height>=40&&width>=45)return {family:0,floorHeightM:3.6,basis:'morphology'};
  if(height>=30&&width<45)return {family:1,floorHeightM:3.2,basis:'morphology'};
  return {family:seed<.45?5:(seed<.75?2:4),floorHeightM:3.4,basis:'neutral-fallback'};
}
function build(catalogue,options={}){
  const c=catalogue?.columns||{},boxes=Array.isArray(c.bbox)?c.bbox:[],prefix=String(options.prefix??'');
  const rows=boxes.length,graph=options.assembly,records=new Map(),parents=new Map();
  /* Include the complete support graph before selecting this catalogue. A bridge,
     roof or facade therefore receives the same profile in separate build calls. */
  if(graph?.records instanceof Map)for(const [key,r]of graph.records)if(r&&validBox(r.box))records.set(key,{...r,key});
  const rowKeys=[];
  for(let row=0;row<rows;row++){
    const key=prefix+row;rowKeys.push(key);
    if(!validBox(boxes[row]))continue;
    const existing=records.get(key);
    records.set(key,{...existing,key,id:existing?.id??c.osm_id?.[row]??key,box:boxes[row],osmType:existing?.osmType??c.osm_type?.[row]});
  }
  for(const key of records.keys())parents.set(key,key);
  function find(key){let r=key;while(parents.get(r)!==r)r=parents.get(r);while(key!==r){const next=parents.get(key);parents.set(key,r);key=next;}return r;}
  function join(a,b){const x=find(a),y=find(b);if(x!==y)parents.set(x<y?y:x,x<y?x:y);}
  if(graph?.supports instanceof Map)for(const [key,supports]of graph.supports)if(records.has(key))for(const support of supports||[])if(records.has(support))join(key,support);
  const groups=new Map();
  for(const [key,record]of records){const root=find(key);if(!groups.has(root))groups.set(root,[]);groups.get(root).push(record);}
  const groupProfiles=new Map();
  for(const [key,members]of groups){
    members.sort(representative);const main=members[0],b=main.box.slice();
    for(const r of members){for(let axis=0;axis<3;axis++){b[axis]=Math.min(b[axis],r.box[axis]);b[axis+3]=Math.max(b[axis+3],r.box[axis+3]);}}
    const groupKey=members.map(identity).sort()[0],seed=hash(groupKey),type=text(main.osmType),chosen=choose(type,b,seed);
    groupProfiles.set(key,{family:chosen.family,baseZ:b[2],height:clamp(b[5]-b[2],2,2000),seed,anchor:[(b[0]+b[3])/2,(b[1]+b[4])/2],floorHeightM:chosen.floorHeightM,wallAngle:canonicalAngle(main.wallAngle),groupKey,classificationBasis:chosen.basis,illustrative:true});
  }
  const stats={illustrative:true,rows,groups:0,connectedRows:0,invalidRows:0,typeTaggedRows:0,unknownTypeRows:0,familyCounts:Array(FAMILIES.length).fill(0),basisCounts:{osm_type:0,morphology:0,'neutral-fallback':0,'invalid-bounds':0},evidenceFields:['osm_type','bbox'],materialTagsAvailable:false,yearTagsAvailable:false};
  const seenGroups=new Set(),profiles=rowKeys.map((key,row)=>{
    const root=records.has(key)?find(key):null,source=root===null?null:groupProfiles.get(root);
    const p=source?{...source,anchor:source.anchor.slice()}:{family:5,baseZ:0,height:2,seed:hash(String(c.osm_id?.[row]??key)),anchor:[0,0],floorHeightM:3.4,wallAngle:0,groupKey:String(c.osm_id?.[row]??key),classificationBasis:'invalid-bounds',illustrative:true};
    if(source){seenGroups.add(root);if(groups.get(root).length>1)stats.connectedRows++;}else stats.invalidRows++;
    if(UNKNOWN.has(text(c.osm_type?.[row])))stats.unknownTypeRows++;else stats.typeTaggedRows++;
    stats.familyCounts[p.family]++;stats.basisCounts[p.classificationBasis]++;return p;
  });
  stats.groups=seenGroups.size;return {profiles,stats};
}
return {build,FAMILIES,frameAngle,pack};
});
