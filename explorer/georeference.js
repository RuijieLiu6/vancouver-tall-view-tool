/* Geographic inputs -> the existing Vista model frame. Never reprojects meshes.
 * Model constants match src/view_context/geo.py and its eight recorded checks.
 * Projection definitions/formula references (checked 2026-11-02):
 * https://proj.org/en/stable/operations/projections/tmerc.html
 * https://proj.org/en/stable/operations/projections/utm.html
 * https://proj.org/en/stable/operations/projections/webmerc.html
 * https://github.com/OSGeo/PROJ/blob/master/data/sql/projected_crs.sql
 * UTM: sixth-order Krüger series on GRS80, zone 10N. This is a projection,
 * not a survey-grade NAD83 -> WGS84 datum operation. No vertical conversion.
 */
(function (root) {
  'use strict';
  const MODEL_CRS = 'VISTA:MODEL', ORIGIN_LAT = 49.2827, ORIGIN_LON = -123.1207;
  const RAD = Math.PI / 180, METRES_LAT = 110574, METRES_LON = 111320 * Math.cos(ORIGIN_LAT * RAD);
  const R = 6378137, WEB_LIMIT = Math.PI * R, WEB_LAT_LIMIT = 85.0511287798066;
  const finite = v => typeof v === 'number' && Number.isFinite(v);
  function pair(x, y) { if (!finite(x) || !finite(y)) throw new Error('Coordinates must be finite numbers.'); }
  function normalizeCrs(value) {
    const id = typeof value === 'string' ? value.trim().toUpperCase() : '';
    if (['VISTA:MODEL', 'VISTA MODEL XY', 'VISTA MODEL XY (ASSUMED)'].includes(id)) return MODEL_CRS;
    if (['EPSG:4326', 'EPSG:3857', 'EPSG:26910'].includes(id)) return id;
    throw new Error('Unsupported or missing horizontal CRS. Specify VISTA:MODEL, EPSG:4326, EPSG:3857 or EPSG:26910; coordinates are never guessed.');
  }
  function geographic(lon, lat) {
    pair(lon, lat);
    if (lon < -180 || lon > 180 || lat < -90 || lat > 90) throw new Error('Geographic input requires longitude, latitude in degrees.');
    return {lon, lat};
  }
  function modelToLonLat(x, y) { pair(x, y); return geographic(ORIGIN_LON + x / METRES_LON, ORIGIN_LAT + y / METRES_LAT); }
  function lonLatToModel(lon, lat) { geographic(lon, lat); return {x:(lon - ORIGIN_LON) * METRES_LON, y:(lat - ORIGIN_LAT) * METRES_LAT}; }

  // Series coefficients are the rows of PROJ's C_mu,chi and C_chi,mu
  // matrices multiplied by [n,n²,...,n⁶]. Forward conformal latitude uses
  // the analytical expression; its inverse is solved by Newton iteration.
  const flattening = 1 / 298.257222101, eccentricity = Math.sqrt(flattening * (2 - flattening));
  const n = flattening / (2 - flattening);
  const scaleA = R / (1 + n) * (1 + n*n/4 + n**4/64 + n**6/256) * 0.9996;
  function coefficients(rows) { return rows.map((row,i) => row.reduce((v,c,j) => v + c * n**(i+j+1), 0)); }
  const alpha = coefficients([
    [1/2,-2/3,5/16,41/180,-127/288,7891/37800], [13/48,-3/5,557/1440,281/630,-1983433/1935360],
    [61/240,-103/140,15061/26880,167603/181440], [49561/161280,-179/168,6601661/7257600],
    [34729/80640,-3418889/1995840], [212378941/319334400]
  ]);
  const beta = coefficients([
    [-1/2,2/3,-37/96,1/360,81/512,-96199/604800], [-1/48,-1/15,437/1440,-46/105,1118711/3870720],
    [-17/480,37/840,209/4480,-5569/90720], [-4397/161280,11/504,830251/7257600],
    [-4583/161280,108847/3991680], [-20648693/638668800]
  ]);
  function utmDomain(lon, lat) {
    if (lon < -126 - 1e-8 || lon > -120 + 1e-8 || lat < -1e-8 || lat > 84 + 1e-8) throw new Error('EPSG:26910 input lies outside UTM zone 10 north (126°W–120°W, 0°–84°N).');
  }
  function geographicToUtm(lon, lat) {
    geographic(lon, lat); utmDomain(lon, lat);
    const phi = lat * RAD, lambda = (lon + 123) * RAD;
    const chi = Math.atan(Math.sinh(Math.asinh(Math.tan(phi)) - eccentricity * Math.atanh(eccentricity * Math.sin(phi))));
    const xi0 = Math.atan2(Math.tan(chi), Math.cos(lambda));
    const eta0 = Math.asinh(Math.sin(lambda) / Math.hypot(Math.tan(chi), Math.cos(lambda)));
    let xi = xi0, eta = eta0;
    alpha.forEach((c,i) => {const k=2*(i+1); xi += c*Math.sin(k*xi0)*Math.cosh(k*eta0); eta += c*Math.cos(k*xi0)*Math.sinh(k*eta0);});
    return {x:500000 + scaleA * eta, y:scaleA * xi};
  }
  function utmToGeographic(x, y) {
    pair(x, y);
    if (x < 100000 || x > 900000 || y < 0 || y > 9400000) throw new Error('Invalid EPSG:26910 easting/northing in metres.');
    const xi = y / scaleA, eta = (x - 500000) / scaleA;
    let xi0 = xi, eta0 = eta;
    beta.forEach((c,i) => {const k=2*(i+1); xi0 += c*Math.sin(k*xi)*Math.cosh(k*eta); eta0 += c*Math.cos(k*xi)*Math.sinh(k*eta);});
    const chi = Math.atan2(Math.sin(xi0), Math.hypot(Math.sinh(eta0),Math.cos(xi0)));
    const psi = Math.asinh(Math.tan(chi));
    let phi = chi;
    for (let i=0;i<8;i++) {
      const sin = Math.sin(phi), e2 = eccentricity*eccentricity;
      const residual = Math.asinh(Math.tan(phi)) - eccentricity*Math.atanh(eccentricity*sin) - psi;
      const step = residual * Math.cos(phi) * (1-e2*sin*sin) / (1-e2);
      phi -= step; if (Math.abs(step) < 1e-14) break;
    }
    const lon = Math.atan2(Math.sinh(eta0), Math.cos(xi0)) / RAD - 123, lat = phi / RAD;
    utmDomain(lon, lat); return geographic(lon, lat);
  }
  function checkDatum(crs, options) {
    if (crs === 'EPSG:26910' && options && options.surveyVerified === true) throw new Error('EPSG:26910 requires a documented datum operation before survey verification; this viewer uses only an approximate NAD83/WGS84 alignment.');
  }
  function toModel(x, y, crs, options) {
    pair(x, y); crs = normalizeCrs(crs); checkDatum(crs, options);
    if (crs === MODEL_CRS) return {x, y};
    let ll;
    if (crs === 'EPSG:4326') ll = geographic(x, y);
    else if (crs === 'EPSG:3857') {
      if (Math.abs(x) > WEB_LIMIT + 1e-6 || Math.abs(y) > WEB_LIMIT + 1e-6) throw new Error('EPSG:3857 coordinates exceed Web Mercator bounds.');
      ll = {lon:x / R / RAD, lat:Math.atan(Math.sinh(y / R)) / RAD};
    } else ll = utmToGeographic(x, y);
    return lonLatToModel(ll.lon, ll.lat);
  }
  function fromModel(x, y, crs, options) {
    pair(x, y); crs = normalizeCrs(crs); checkDatum(crs, options);
    if (crs === MODEL_CRS) return {x, y};
    const ll = modelToLonLat(x, y);
    if (crs === 'EPSG:4326') return {x:ll.lon, y:ll.lat};
    if (crs === 'EPSG:26910') return geographicToUtm(ll.lon, ll.lat);
    if (Math.abs(ll.lat) > WEB_LAT_LIMIT) throw new Error('Latitude exceeds Web Mercator bounds.');
    return {x:ll.lon * RAD * R, y:Math.asinh(Math.tan(ll.lat * RAD)) * R};
  }
  function provenance(crs) {
    crs = normalizeCrs(crs);
    return {sourceCrs:crs, targetCrs:MODEL_CRS, axisOrder:crs==='EPSG:4326'?'longitude,latitude':crs===MODEL_CRS?'x,y':'easting,northing',
      anchor:{longitude:ORIGIN_LON,latitude:ORIGIN_LAT,modelXY:[0,0],north:'+Y',units:'m'},
      method:'Existing checked model frame: x=(lon+123.1207)*111320*cos(49.2827°); y=(lat-49.2827)*110574',
      approximateDatumShift:crs==='EPSG:26910', surveyVerified:false,
      datumOperation:crs==='EPSG:26910'?'Approximate identity of NAD83 and WGS84 geographic coordinates; no grid, realization or epoch operation applied.':null,
      verticalTransformed:false,
      accuracyWarning:crs==='EPSG:26910'?'NAD83/WGS84 datum alignment is approximate; unsuitable for survey or regulatory verification.':
        'Model placement was checked against OpenStreetMap; absolute survey accuracy is not established.',
      vertical:'Unchanged; no geoid or vertical datum conversion. Model Z datum remains unknown.'};
  }
  function describe() {
    return {schema:'vista-georeference/1',...provenance(MODEL_CRS),
      modelFrame:{crs:MODEL_CRS,units:'m',x:'east',y:'north',z:'up',longitudeMetresPerDegree:METRES_LON,latitudeMetresPerDegree:METRES_LAT,
        formula:{x:'(longitude - anchor.longitude) * longitudeMetresPerDegree',y:'(latitude - anchor.latitude) * latitudeMetresPerDegree'}},
      projection:'Existing equirectangular model mapping; not EPSG:26910',
      supportedInputs:[MODEL_CRS,'EPSG:4326','EPSG:3857','EPSG:26910'],
      checks:{count:8,maxResidualM:0.1,source:'Recorded OpenStreetMap footprint/model comparison, 2026-09-23; src/view_context/geo.py'},
      projectedInput:{crs:'EPSG:26910',ellipsoid:'GRS80',zone:10,hemisphere:'N',centralMeridianDeg:-123,scale:0.9996,falseEastingM:500000,falseNorthingM:0,
        method:'Sixth-order Krüger transverse Mercator; approximate NAD83/WGS84 geographic identity, not a datum grid operation'}};
  }
  function transformBoundary(polygons, crs, options) {
    crs = normalizeCrs(crs); checkDatum(crs,options);
    if (!Array.isArray(polygons) || !polygons.length) throw new Error('Provide Polygon/MultiPolygon rings in polygons.');
    let count=0;
    return polygons.map(polygon => {
      if (!Array.isArray(polygon) || !polygon.length) throw new Error('Each polygon requires an outer ring.');
      return polygon.map(ring => {
        if (!Array.isArray(ring) || ring.length<3) throw new Error('A boundary ring needs at least three coordinates.');
        return ring.map(p => {
          if (++count>1024) throw new Error('Use at most 1,024 boundary vertices.');
          if (!Array.isArray(p) || p.length!==2) throw new Error('Boundary coordinates must be XY pairs; vertical values are not inferred.');
          const q=toModel(p[0],p[1],crs,options);return [q.x,q.y];
        });
      });
    });
  }
  function transformPlane(plane, crs, options) {
    crs=normalizeCrs(crs);checkDatum(crs,options);
    if (!plane || typeof plane!=='object') throw new Error('A plane must be an object.');
    if (crs===MODEL_CRS && !plane.referencePoints) return {...plane,origin:Array.isArray(plane.origin)?plane.origin.slice():plane.origin};
    // Carrying a source-grid bearing unchanged into model XY would be wrong:
    // meridian convergence and scale differ. Require explicit XYZ references.
    const refs=plane.referencePoints;
    if (!Array.isArray(refs) || refs.length!==3) throw new Error('A plane outside model XY requires exactly three noncollinear referencePoints [x,y,elevationM]; an origin and bearing alone cannot be transformed.');
    for(const p of refs)if(!Array.isArray(p)||p.length!==3||!p.every(finite))throw new Error('Plane references need finite [x,y,elevationM] coordinates.');
    const su=refs[1][0]-refs[0][0],sv=refs[1][1]-refs[0][1],tu=refs[2][0]-refs[0][0],tv=refs[2][1]-refs[0][1];
    if(Math.abs(su*tv-sv*tu)<=1e-10*Math.hypot(su,sv)*Math.hypot(tu,tv)+1e-30)throw new Error('Plane reference points must not be collinear in their source CRS.');
    const points=refs.map(p=>{
      if(!Array.isArray(p)||p.length!==3||!finite(p[2]))throw new Error('Plane references need finite [x,y,elevationM] coordinates.');
      const q=toModel(p[0],p[1],crs,options);return[q.x,q.y,p[2]];
    });
    const [p,q,r]=points, ux=q[0]-p[0],uy=q[1]-p[1],vx=r[0]-p[0],vy=r[1]-p[1];
    const determinant=ux*vy-uy*vx;
    if (Math.abs(determinant)<=1e-10*Math.max(1,Math.hypot(ux,uy)*Math.hypot(vx,vy))) throw new Error('Plane reference points must not be collinear.');
    const a=((q[2]-p[2])*vy-(r[2]-p[2])*uy)/determinant;
    const b=(ux*(r[2]-p[2])-vx*(q[2]-p[2]))/determinant;
    const result={...plane,origin:p.slice(0,2),observerElevationM:p[2],bearingDeg:(Math.atan2(a,b)/RAD+360)%360,pitchDeg:Math.atan(Math.hypot(a,b))/RAD,
      sourceReferencePoints:crs===MODEL_CRS && plane.sourceReferencePoints?plane.sourceReferencePoints:refs.map(p=>p.slice()),referencePoints:points,
      horizontalTransformation:crs===MODEL_CRS && plane.horizontalTransformation?plane.horizontalTransformation:
        {sourceCrs:crs,method:'Fit affine plane in model XY through three transformed source references',localReconstruction:crs!==MODEL_CRS,verticalUnchanged:true}};
    return result;
  }
  // Envelope input contract: polygons[polygon][ring][XY], planes keyed by
  // view ID. coordinateSystem.inputCrs explicitly declares all input XY.
  // Per-plane inputCrs may override that declaration. No model meshes mutate.
  function transformEnvelopeInputs(raw) {
    if (!raw || typeof raw!=='object') throw new Error('Provide envelope input JSON.');
    const coordinateSystem=raw.coordinateSystem || {};
    // v30 horizontal was a descriptive source label and all XY was already
    // model coordinates. A label alone must never trigger another conversion.
    if (!Object.prototype.hasOwnProperty.call(coordinateSystem,'inputCrs')) return raw;
    const crs=normalizeCrs(coordinateSystem.inputCrs);
    const options={surveyVerified:raw.surveySource?.verified===true || raw.surveyVerified===true};
    checkDatum(crs,options);
    const polygons=transformBoundary(raw.polygons,crs,options),planes={};
    for(const [id,plane] of Object.entries(raw.planes || {})) {
      const planeCrs=normalizeCrs(plane.inputCrs || crs);
      planes[id]=transformPlane(plane,planeCrs,options);
      delete planes[id].inputCrs;
    }
    const previous=crs===MODEL_CRS && raw.georeference?.targetCrs===MODEL_CRS?raw.georeference:null;
    const approximateDatumShift=previous?.approximateDatumShift===true || crs==='EPSG:26910' || Object.values(raw.planes||{}).some(p=>p.inputCrs && normalizeCrs(p.inputCrs)==='EPSG:26910');
    if(approximateDatumShift && options.surveyVerified)checkDatum('EPSG:26910',options);
    const metadata={...(previous || provenance(crs)),approximateDatumShift};
    if(approximateDatumShift){
      metadata.accuracyWarning='NAD83/WGS84 datum alignment is approximate; unsuitable for survey or regulatory verification.';
      metadata.datumOperation='Approximate identity of NAD83 and WGS84 geographic coordinates; no grid, realization or epoch operation applied.';
    }
    return {...raw,polygons,planes,sourceCoordinateSystem:previous && raw.sourceCoordinateSystem?raw.sourceCoordinateSystem:{...coordinateSystem},georeference:metadata,
      coordinateSystem:{...coordinateSystem,inputCrs:MODEL_CRS,horizontal:'Vista model XY',units:'m',compatible:coordinateSystem.compatible===true,
        ...(approximateDatumShift?{surveyCompatible:false}:{}),transformation:metadata.method}};
  }
  const api={MODEL_CRS,ORIGIN_LAT,ORIGIN_LON,METRES_LAT,METRES_LON,normalizeCrs,modelToLonLat,lonLatToModel,toModel,fromModel,provenance,describe,transformBoundary,transformPlane,transformEnvelopeInputs};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  root.VistaGeoreference=api;
})(typeof window!=='undefined'?window:globalThis);
