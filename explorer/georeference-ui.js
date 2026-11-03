/* Geographic positions share the model's existing checked XY frame. */
(function(root){
  'use strict';
  const G=root.VistaGeoreference, X=()=>root.__explorer, $=id=>document.getElementById(id);
  let mounted=false, renderKey='', formCrs='EPSG:4326';
  function reference(){
    const x=X();return {...G.describe(),activeModelVertical:x.assets.unified?
      {status:'approximate',source:'Unified SRTM/EGM96 terrain placement; some source feature elevations retained',cityDatumAligned:false}:
      {status:'unknown',source:'Original supplied Rhino model Z',cityDatumAligned:false}};
  }
  function point(){
    const x=X(),s=x.state;
    if(s.mode==='observer'&&s.observer)return {...s.observer,role:'Observer ground / roof position'};
    if(s.selected!==null&&s.selected!==undefined){const c=(s.selectedExt?x.assets.extIndex:x.assets.index)?.columns,b=c?.bbox[s.selected];if(b)return{x:(b[0]+b[3])/2,y:(b[1]+b[4])/2,z:b[2],role:'Selected building extent centre (may lie outside its footprint)'};}
    if(s.addressPin?.label==='Coordinate location')return{...s.addressPin,z:null,role:'Located coordinate (study site unchanged)'};
    return s.site?{...s.site,role:'Study site'}:{x:0,y:0,z:null,role:'Model origin'};
  }
  function getInfo(){const p=point();return{modelPoint:p,geographic:G.modelToLonLat(p.x,p.y),utm:G.fromModel(p.x,p.y,'EPSG:26910'),reference:reference()};}
  function locate(x,y,crs){
    const p=G.toModel(x,y,crs);
    if(!X().focusLocation(p.x,p.y))throw new Error('That coordinate is outside the available context model. Use a Vancouver location within the model extent.');
    X().setAddressPin({...p,label:'Coordinate location'});refresh();return p;
  }
  function ringCoordinates(ring,outer){
    let r=ring.slice();if(r.length>1&&r[0][0]===r.at(-1)[0]&&r[0][1]===r.at(-1)[1])r.pop();
    const a=r[0];let area=0;for(let i=1;i+1<r.length;i++)area+=(r[i][0]-a[0])*(r[i+1][1]-a[1])-(r[i][1]-a[1])*(r[i+1][0]-a[0]);
    if((area>0)!==outer)r.reverse();
    const result=r.map(p=>{const ll=G.modelToLonLat(p[0],p[1]);return[ll.lon,ll.lat];});
    if(result.length)result.push(result[0].slice());return result;
  }
  function exportGeoJSON(){
    const x=X(),features=[],p=point(),ll=G.modelToLonLat(p.x,p.y);
    features.push({type:'Feature',geometry:{type:'Point',coordinates:[ll.lon,ll.lat]},properties:{role:p.role,model_x_m:p.x,model_y_m:p.y,model_z_m:p.z??null,position_accuracy:'Approximate OpenStreetMap-based model alignment; not surveyed',vertical_coordinate_in_geometry:false}});
    if(x.state.site&&p.role!=='Study site'){const s=x.state.site,q=G.modelToLonLat(s.x,s.y);features.push({type:'Feature',geometry:{type:'Point',coordinates:[q.lon,q.lat]},properties:{role:'Study site',model_x_m:s.x,model_y_m:s.y,model_z_m:s.z??null,vertical_coordinate_in_geometry:false}});}
    const loaded=x.getConeStudy().envelopeInputs?.polygons,polygons=loaded?.length?loaded:x.state.boundary.length>=3?[[x.state.boundary]]:null;
    if(polygons)features.push({type:'Feature',geometry:{type:'MultiPolygon',coordinates:polygons.map(poly=>poly.map((r,i)=>ringCoordinates(r,i===0)))},properties:{role:loaded?.length?'Loaded envelope parcel boundary':'Drawn study boundary',legal_boundary_verified:false}});
    return{type:'FeatureCollection',features,vistaGeoreference:reference(),note:'GeoJSON positions are longitude/latitude only. Model Z is a separate property; no ellipsoidal or City height is asserted.'};
  }
  function download(name,data){const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function fillForm(){const p=point(),crs=$('geo-crs').value,q=G.fromModel(p.x,p.y,crs);$('geo-x').value=q.x.toFixed(crs==='EPSG:4326'?7:3);$('geo-y').value=q.y.toFixed(crs==='EPSG:4326'?7:3);formCrs=crs;updateLabels();}
  function updateLabels(){const geographic=$('geo-crs').value==='EPSG:4326';$('geo-x-label').textContent=geographic?'Longitude (°)':'Easting (m)';$('geo-y-label').textContent=geographic?'Latitude (°)':'Northing (m)';}
  function read(){const a=$('geo-x').value.trim(),b=$('geo-y').value.trim();if(!a||!b)throw new Error('Enter both coordinates.');return G.toModel(Number(a),Number(b),$('geo-crs').value);}
  function mount(){
    if(mounted)return;mounted=true;const d=document.createElement('details');d.id='geographic-location';d.className='details';
    d.innerHTML='<summary>Geographic location</summary><p id="geo-role" class="small"></p>'+
      '<dl class="ceiling-values"><div><dt>Latitude / longitude</dt><dd id="geo-latlon"></dd></div><div><dt>Model X / Y</dt><dd id="geo-model"></dd></div><div><dt>UTM 10N, approximate</dt><dd id="geo-utm"></dd></div></dl>'+
      '<p class="small muted">The model origin is 49.2827° N, 123.1207° W. +X points east and +Y north. Positions reproduce the existing OpenStreetMap alignment; they are not survey verified.</p>'+
      '<form id="geo-form"><label class="field">Input coordinates<select id="geo-crs"><option value="EPSG:4326">WGS84 · longitude / latitude</option><option value="EPSG:26910">NAD83 / UTM zone 10N · approximate</option><option value="EPSG:3857">Web Mercator · metres</option></select></label>'+
      '<div class="grid2"><label class="field"><span id="geo-x-label">Longitude (°)</span><input id="geo-x" type="number" step="any" required></label><label class="field"><span id="geo-y-label">Latitude (°)</span><input id="geo-y" type="number" step="any" required></label></div>'+
      '<div class="actions"><button id="geo-locate" class="btn" type="submit">Show on model</button><button id="geo-place" class="btn" type="button">Use as study site</button></div></form>'+
      '<p id="geo-status" class="small" role="status" aria-live="polite">Coordinates move the view first; placing a site asks for confirmation.</p>'+
      '<div class="actions"><button id="geo-current" class="btn" type="button">Use current position</button><button id="geo-export" class="btn" type="button">Download location GeoJSON</button><button id="geo-reference" class="btn" type="button">Download model reference</button></div>'+
      '<p id="geo-vertical" class="small muted"></p>';
    document.querySelector('.study-file').insertAdjacentElement('beforebegin',d);
    $('geo-form').addEventListener('submit',e=>{e.preventDefault();try{const p=read();locate(p.x,p.y,'VISTA:MODEL');$('geo-status').textContent='Coordinate located on the plan. Your study site has not moved.';}catch(error){$('geo-status').textContent=error.message;}});
    $('geo-place').addEventListener('click',()=>{try{const p=read();if(X().landZAt(p.x,p.y)===null)throw new Error('That coordinate is water or has no modelled ground. Choose a point on land.');X().requestSiteConfirmation(p.x,p.y,'coordinates');$('geo-status').textContent='Review the placement confirmation. Cancel keeps your existing site.';}catch(error){$('geo-status').textContent=error.message;}});
    $('geo-crs').addEventListener('change',()=>{try{const p=G.toModel(Number($('geo-x').value),Number($('geo-y').value),formCrs),crs=$('geo-crs').value,q=G.fromModel(p.x,p.y,crs);$('geo-x').value=q.x.toFixed(crs==='EPSG:4326'?7:3);$('geo-y').value=q.y.toFixed(crs==='EPSG:4326'?7:3);formCrs=crs;updateLabels();}catch(_){fillForm();}});
    $('geo-current').addEventListener('click',fillForm);
    $('geo-export').addEventListener('click',()=>download('Vista-location.geojson',exportGeoJSON()));
    $('geo-reference').addEventListener('click',()=>download('Vista-model-geographic-reference.json',reference()));
    fillForm();
  }
  function refresh(){
    mount();const info=getInfo(),p=info.modelPoint,ll=info.geographic,u=info.utm,key=JSON.stringify([p,ll,u,!!X().assets.unified]);if(key===renderKey)return;renderKey=key;
    $('geo-role').textContent=p.role+' · approximate geographic position';
    $('geo-latlon').textContent=ll.lat.toFixed(6)+'°, '+ll.lon.toFixed(6)+'°';
    $('geo-model').textContent=p.x.toFixed(2)+', '+p.y.toFixed(2)+' m';
    $('geo-utm').textContent=u.x.toFixed(2)+' E, '+u.y.toFixed(2)+' N';
    $('geo-vertical').textContent=(p.z!==null&&Number.isFinite(p.z)?'Model Z '+p.z.toFixed(2)+' m. ':'')+(X().assets.unified?'Terrain uses approximate SRTM/EGM96 placement; some original feature elevations remain. ':'Original model vertical datum is unknown. ')+'No City datum or geoid conversion is applied.';
  }
  root.VistaLocation={refresh,locate,getInfo,exportGeoJSON,reference};
  Promise.resolve(X().ready).then(()=>{refresh();if(new URLSearchParams(location.search).get('geography')==='1')$('geographic-location').open=true;});
})(window);
