(function (root, factory) {
  const dependency = typeof module === 'object' && module.exports ? require('./cone-ceiling.js') : root.ConeCeiling;
  const api = factory(dependency);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ViewEnvelope = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (ConeCeiling) {
  'use strict';

  // A mathematical lower envelope of supplied surfaces. Source authority and
  // coordinate compatibility are separate evidence; calculation never verifies policy.
  const finite = x => typeof x === 'number' && Number.isFinite(x);
  const area = p => {
    let s = 0;
    for (let i = 1; i + 1 < p.length; i++) s += (p[i][0] - p[0][0]) * (p[i + 1][1] - p[0][1]) - (p[i][1] - p[0][1]) * (p[i + 1][0] - p[0][0]);
    return Math.abs(s) / 2;
  };
  const cross = (a, b, p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  function planeAt(plane) {
    if (!plane || !Array.isArray(plane.origin) || !plane.origin.slice(0, 2).every(finite) || plane.origin.length < 2 ||
      !finite(plane.observerElevationM) || !finite(plane.bearingDeg) || !finite(plane.pitchDeg) || Math.abs(plane.pitchDeg) >= 89) return null;
    const rad = Math.PI / 180, slope = Math.tan(plane.pitchDeg * rad);
    const a = Math.sin(plane.bearingDeg * rad) * slope, b = Math.cos(plane.bearingDeg * rad) * slope;
    return {a, b, at: p => plane.observerElevationM + a * (p[0] - plane.origin[0]) + b * (p[1] - plane.origin[1])};
  }
  function build(options) {
    const o = options || {}, issues = [];
    const output = {status: 'unresolved', verified: false, mathematicalStatus: 'unresolved', patches: [], contactPatches: [],
      parcelPatches: [], uncoveredPatches: [], unresolvedPatches: [], coverage: {parcelAreaM2: null, ceilingAreaM2: 0, unresolvedAreaM2: 0, outsideAreaM2: 0, fraction: null},
      limitingPoint: null, limitingView: null, ceilingElevationM: null, maxHeightM: null, clearanceM: null,
      missingViews: [], overlappingViews: [], issues, coordinateSystem: o.coordinateSystem || null, coordinateCompatible: false, datumOffsetM: finite(o.datumOffsetM) ? o.datumOffsetM : null,
      mesh: {positions: [], sidewallPositions: []}, sourceStatus: 'supplied_surfaces_unverified'};
    if (!ConeCeiling || typeof ConeCeiling.evaluate !== 'function') { issues.push('clipping_engine_unavailable'); return output; }
    const raw = {footprints: o.footprints, polygons: o.polygons};
    const coordinates = [];
    function collect(x) {
      if (!x || typeof x !== 'object') return;
      if (Array.isArray(x) && finite(x[0]) && finite(x[1])) { coordinates.push(x); return; }
      for (const value of Object.values(x)) collect(value);
    }
    collect(raw);
    if (!coordinates.length) { issues.push('full_parcel_geometry_required'); return output; }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of coordinates) { minX = Math.min(minX, p[0]); minY = Math.min(minY, p[1]); maxX = Math.max(maxX, p[0]); maxY = Math.max(maxY, p[1]); }
    const span = Math.max(1, maxX - minX, maxY - minY), eps = span * 1e-10, areaEps = span * span * 1e-12;
    const bounds = [[minX - span, minY - span], [maxX + span, minY - span], [maxX + span, maxY + span], [minX - span, maxY + span]];
    if (!bounds.every(p => p.every(finite))) { issues.push('nonfinite_coordinates'); return output; }
    const flat = {origin: [minX, minY], observerElevationM: 0, bearingDeg: 0, pitchDeg: 0};
    const normalized = ConeCeiling.evaluate({...raw, cones: [{view_number: '__parcel__', polygon_model_xy: bounds}], planes: {__parcel__: flat}, datumOffsetM: 0});
    if (normalized.status !== 'ready') { issues.push('invalid_parcel_geometry'); return output; }
    const base = normalized.patches.map(p => p.points.map(q => q.slice(0, 2))).filter(p => p.length >= 3 && area(p) > areaEps);
    if (!base.length) { issues.push('full_parcel_area_required'); return output; }
    let work = 0;
    const maxWork = finite(o.maxWork) && o.maxWork > 0 ? o.maxWork : 2500000;
    const maxPatches = finite(o.maxPatches) && o.maxPatches > 0 ? o.maxPatches : 20000;
    const tick = n => { work += n; if (work > maxWork) throw new Error('geometry_budget_exceeded'); };
    function clean(p) {
      const q = p.filter((v, i) => !i || Math.hypot(v[0] - p[i - 1][0], v[1] - p[i - 1][1]) > eps);
      if (q.length > 1 && Math.hypot(q[0][0] - q[q.length - 1][0], q[0][1] - q[q.length - 1][1]) <= eps) q.pop();
      return q.length >= 3 && area(q) > areaEps ? q : [];
    }
    // Keep f(XY) >= 0. Exact intersections are used; tolerances only remove
    // zero-area debris, never introduce a sampled height or a bounding rectangle.
    function half(p, f) {
      tick(p.length);
      const q = [];
      for (let i = 0; i < p.length; i++) {
        const s = p[i], e = p[(i + 1) % p.length], ds = f(s), de = f(e), si = ds >= 0, ei = de >= 0;
        if (si !== ei) { const t = ds / (ds - de); q.push([s[0] + t * (e[0] - s[0]), s[1] + t * (e[1] - s[1])]); }
        if (ei) q.push(e);
      }
      return clean(q);
    }
    function partition(p, cutter) {
      let inside = p;
      const outside = [];
      for (let i = 0; i < cutter.length && inside.length; i++) {
        const a = cutter[i], b = cutter[(i + 1) % cutter.length], f = q => cross(a, b, q);
        const part = half(inside, q => -f(q));
        if (part.length) outside.push(part);
        inside = half(inside, f);
      }
      return {inside, outside};
    }
    function partitionUnion(p, masks) {
      let outside = [p];
      const inside = [];
      for (const mask of masks) {
        const next = [];
        for (const part of outside) { const split = partition(part, mask); if (split.inside.length) inside.push(split.inside); next.push(...split.outside); }
        outside = next;
      }
      return {inside, outside};
    }
    const getPlane = view => o.planes instanceof Map ? o.planes.get(view) : o.planes && o.planes[view];
    const contacts = [];
    let unknownGeometry = false;
    const cones = Array.isArray(o.cones) ? o.cones : [];
    if (!Array.isArray(o.cones)) issues.push('view_corridor_dataset_required');
    try {
      // Normalize overlapping supplied islands into a union, so area and lower
      // envelope patches never double-count occupied parcel area.
      let parcel = [];
      for (const p of base) { const split = partitionUnion(p, parcel); parcel.push(...split.outside); if (parcel.length > maxPatches) throw new Error('geometry_budget_exceeded'); }
      output.parcelPatches = parcel.map(polygon => ({polygon}));
      output.coverage.parcelAreaM2 = parcel.reduce((s, p) => s + area(p), 0);
      let cells = parcel.map(polygon => ({polygon, active: []}));
      for (let index = 0; index < cones.length; index++) {
        const cone = cones[index], view = cone && cone.view_number;
        const masked = ConeCeiling.evaluate({...raw, cones: [cone], planes: new Map([[view, flat]]), datumOffsetM: 0});
        if (masked.status === 'unknown' || masked.status === 'partial' || masked.status === 'no_site') {
          unknownGeometry = true; output.missingViews.push(view); issues.push('invalid_view_corridor_geometry'); continue;
        }
        if (masked.status === 'outside') continue;
        output.overlappingViews.push(view);
        const supplied = getPlane(view), fn = planeAt(supplied);
        const entry = {view, supplied, fn, index};
        for (const patch of masked.patches) {
          const p = patch.points.map(q => q.slice(0, 2));
          if (p.length && (p.length < 3 || area(p) <= areaEps)) {
            let a=p[0], b=a, longest=0;
            for (const q of p) for (const r of p) { const d=Math.hypot(q[0]-r[0],q[1]-r[1]); if(d>longest){a=q;b=r;longest=d;} }
            contacts.push({polygon:longest>eps?[a,b]:[a],entry});
            if(contacts.length>maxPatches)throw new Error('geometry_budget_exceeded');
          }
        }
        if (!fn) output.missingViews.push(view);
        const masks = masked.patches.map(p => p.points.map(q => q.slice(0, 2))).filter(p => p.length >= 3 && area(p) > areaEps);
        const next = [];
        for (const cell of cells) {
          const split = partitionUnion(cell.polygon, masks);
          for (const p of split.outside) next.push({polygon: p, active: cell.active});
          for (const p of split.inside) next.push({polygon: p, active: cell.active.concat(entry)});
        }
        cells = next;
        if (cells.length > maxPatches) throw new Error('geometry_budget_exceeded');
      }
      const crs = o.coordinateSystem;
      const horizontalReady = Boolean(crs && crs.compatible === true && crs.units === 'm' && typeof crs.horizontal === 'string' && crs.horizontal.trim());
      const datumReady = Boolean(horizontalReady && typeof crs.verticalDatum === 'string' && crs.verticalDatum.trim() && finite(o.datumOffsetM));
      output.coordinateCompatible = datumReady;
      if (!horizontalReady) issues.push('horizontal_crs_compatibility_unresolved');
      if (!datumReady) issues.push('vertical_datum_alignment_unresolved');
      if (unknownGeometry) issues.push('corridor_coverage_unresolved');
      const metadata = entry => ({view: entry.view, source: entry.supplied && entry.supplied.source || null,
        plane: entry.supplied || null, corridorSource: cones[entry.index] && (cones[entry.index].source || cones[entry.index].source_url) || null});
      for (const cell of cells) {
        const unknown = unknownGeometry || !Array.isArray(o.cones) || cell.active.some(v => !v.fn);
        const missing = cell.active.filter(v => !v.fn).map(v => v.view);
        if (!cell.active.length) {
          const target = unknown ? output.unresolvedPatches : output.uncoveredPatches;
          target.push({polygon: cell.polygon, activeViews: [], reason: unknown ? 'corridor_coverage_unresolved' : 'outside_supplied_corridors'});
          continue;
        }
        const valid = cell.active.filter(v => v.fn);
        if (valid.some(v => cell.polygon.some(q => !finite(v.fn.at(q))))) throw new Error('nonfinite_ceiling_elevation');
        if (!valid.length) {
          output.unresolvedPatches.push({polygon: cell.polygon, activeViews: cell.active.map(v => v.view), missingViews: missing, reason: 'missing_ceiling_surface'});
          continue;
        }
        for (let i = 0; i < valid.length; i++) {
          const entry = valid[i];
          let p = cell.polygon;
          for (let j = 0; j < valid.length && p.length; j++) {
            if (i === j) continue;
            const other = valid[j];
            // Exact coincident surfaces use input order to avoid duplicate faces.
            const diffs = p.map(q => other.fn.at(q) - entry.fn.at(q));
            if (!diffs.every(finite)) throw new Error('nonfinite_ceiling_difference');
            if (diffs.every(d => d === 0)) { if (j < i) p = []; continue; }
            p = half(p, q => other.fn.at(q) - entry.fn.at(q));
          }
          if (!p.length) continue;
          const elevationPoints = p.map(q => [q[0], q[1], entry.fn.at(q)]);
          if (!elevationPoints.every(q => q.every(finite))) throw new Error('nonfinite_ceiling_elevation');
          const model = finite(o.datumOffsetM) ? elevationPoints.map(q => [q[0], q[1], q[2] - o.datumOffsetM]) : null;
          const points = model && model.every(q => q.every(finite)) ? model : null;
          if (model && !points) throw new Error('nonfinite_model_elevation');
          const patch = {polygon: p, points, elevationPoints, ...metadata(entry), activeViews: cell.active.map(v => v.view),
            missingViews: missing, status: unknown || !datumReady ? 'unresolved' : 'computed',
            areaM2: area(p), coordinateCompatible: datumReady};
          output.patches.push(patch);
          if (unknown) output.unresolvedPatches.push({polygon: p, activeViews: patch.activeViews, missingViews: missing, reason: 'incomplete_ceiling_surfaces'});
          for (let k = 0; k < elevationPoints.length; k++) {
            const q = elevationPoints[k];
            if (output.ceilingElevationM === null || q[2] < output.ceilingElevationM) {
              output.ceilingElevationM = q[2]; output.limitingView = entry.view;
              output.limitingPoint = {xy: q.slice(0, 2), elevationM: q[2], modelZ: points ? points[k][2] : null, ...metadata(entry)};
            }
          }
          if (points && datumReady) {
            for (let k = 1; k + 1 < points.length; k++) output.mesh.positions.push(...points[0], ...points[k], ...points[k + 1]);
          }
        }
      }
      // A corridor that only touches the parcel edge still constrains an
      // occupied proposal face there. Retain the closed-set contact separately
      // from positive-area coverage, with exact line/point clipping downstream.
      for(const contact of contacts){
        const {polygon:p,entry}=contact;
        if(!entry.fn){output.unresolvedPatches.push({polygon:p,activeViews:[entry.view],missingViews:[entry.view],reason:'missing_boundary_ceiling_surface'});continue;}
        const elevationPoints=p.map(q=>[q[0],q[1],entry.fn.at(q)]);
        if(!elevationPoints.every(q=>q.every(finite)))throw new Error('nonfinite_ceiling_elevation');
        const points=finite(o.datumOffsetM)?elevationPoints.map(q=>[q[0],q[1],q[2]-o.datumOffsetM]):null;
        if(points&&!points.every(q=>q.every(finite)))throw new Error('nonfinite_model_elevation');
        output.contactPatches.push({polygon:p,points,elevationPoints,...metadata(entry),activeViews:[entry.view],missingViews:[],
          status:datumReady?'computed':'unresolved',areaM2:0,coordinateCompatible:datumReady,kind:'boundary-contact'});
        for(let k=0;k<p.length;k++)if(output.ceilingElevationM===null||elevationPoints[k][2]<output.ceilingElevationM){
          output.ceilingElevationM=elevationPoints[k][2];output.limitingView=entry.view;
          output.limitingPoint={xy:p[k].slice(),elevationM:elevationPoints[k][2],modelZ:points?points[k][2]:null,...metadata(entry)};
        }
      }
      const missingContact=output.unresolvedPatches.some(p=>p.reason==='missing_boundary_ceiling_surface');
      const covered = output.patches.reduce((s, p) => s + p.areaM2, 0);
      const unresolved = output.unresolvedPatches.reduce((s, p) => s + area(p.polygon), 0);
      const outside = output.uncoveredPatches.reduce((s, p) => s + area(p.polygon), 0);
      const missingOnly = output.unresolvedPatches.filter(p => p.reason !== 'incomplete_ceiling_surfaces').reduce((s, p) => s + area(p.polygon), 0);
      if (Math.abs(covered + outside + missingOnly - output.coverage.parcelAreaM2) > Math.max(areaEps * 100, output.coverage.parcelAreaM2 * 1e-7)) throw new Error('coverage_conservation_failed');
      output.coverage.ceilingAreaM2 = covered;
      output.coverage.unresolvedAreaM2 = unresolved;
      output.coverage.outsideAreaM2 = outside;
      output.coverage.fraction = output.coverage.parcelAreaM2 > 0 ? covered / output.coverage.parcelAreaM2 : null;
      output.mathematicalStatus = unresolved > areaEps || missingContact ? (covered > areaEps ? 'partial' : 'unresolved') : (output.patches.length || output.contactPatches.length) ? 'ready' : 'outside';
      output.status = !datumReady || !Array.isArray(o.cones) || unknownGeometry ? 'unresolved' : unresolved > areaEps || missingContact ? (covered > areaEps ? 'partial' : 'unresolved') : (output.patches.length || output.contactPatches.length) ? 'computed' : 'outside';
      // Explicit scalar grade/top inputs support simple horizontal proposal studies.
      // They do not imply surveyed terrain or occupied mesh intersection.
      if (output.limitingPoint && datumReady && finite(output.limitingPoint.modelZ)) {
        const z = output.limitingPoint.modelZ;
        if (finite(o.groundModelZ) && finite(z - o.groundModelZ)) output.maxHeightM = z - o.groundModelZ;
        if (finite(o.proposalTopModelZ) && finite(z - o.proposalTopModelZ)) output.clearanceM = z - o.proposalTopModelZ;
      }
      output.missingViews = [...new Set(output.missingViews)];
      output.overlappingViews = [...new Set(output.overlappingViews)];
      output.issues = [...new Set(issues)];
      output.coverageComplete = !unknownGeometry && Array.isArray(o.cones) && unresolved <= areaEps && !missingContact;
      output.work = work;
      return output;
    } catch (error) {
      // Never return a deceptively complete partial roof after a budget/numeric failure.
      output.status = 'unresolved'; output.mathematicalStatus = 'unresolved'; output.patches = [];
      output.contactPatches = []; output.uncoveredPatches = []; output.unresolvedPatches = base.map(polygon => ({polygon, reason: error.message}));
      output.mesh = {positions: [], sidewallPositions: []}; output.ceilingElevationM = null; output.limitingPoint = null; output.limitingView = null;
      output.maxHeightM = null; output.clearanceM = null;
      output.coverage.ceilingAreaM2 = 0; output.coverage.outsideAreaM2 = 0;
      output.coverage.unresolvedAreaM2 = output.coverage.parcelAreaM2; output.coverage.fraction = 0;
      issues.push(error.message); output.work = work; return output;
    }
  }
  // Exact occupied triangle-to-roof intersections. Vertically projected faces
  // retain their distinct Z vertices; no bounding-box top substitutes for a mesh.
  // positions: flat XYZ array/typed array; indices: optional flat triangle indices.
  function intersectProposal(envelope, options) {
    const o = options || {}, result = {status:'unresolved', completed:false, exact:false, processedTriangles:0, outsideParcelTriangles:0, minClearanceM:null,
      maxPenetrationM:null, controllingView:null, controlPoint:null, source:null,
      intrusionPositions:[], checkedTriangles:0, intersectingTriangles:0, issues:[]};
    if (!envelope || !envelope.coordinateCompatible || !finite(envelope.datumOffsetM)) {
      result.issues.push('coordinate_alignment_required'); return result;
    }
    const array = p => Array.isArray(p) || ArrayBuffer.isView(p);
    if (!Array.isArray(o.parts) || !o.parts.length) { result.issues.push('proposal_triangles_required'); return result; }
    const maxTriangles = finite(o.maxTriangles) && o.maxTriangles > 0 ? Math.min(o.maxTriangles,100000) : 100000;
    const maxWork = finite(o.maxWork) && o.maxWork > 0 ? o.maxWork : 5000000;
    let work = 0, candidates = 0, unresolved = false, total = 0;
    const maxCandidates = finite(o.maxCandidates) && o.maxCandidates > 0 ? Math.min(o.maxCandidates,250000) : 250000;
    const tick = n => { work += n; if (work > maxWork) throw new Error('proposal_geometry_budget_exceeded'); };
    const patches = [...(envelope.patches || []),...(envelope.contactPatches || [])].map(p => ({...p, fn:planeAt(p.plane)}));
    if (patches.some(p => !p.fn)) { result.issues.push('invalid_envelope_surface'); return result; }
    function same3(a,b) { return Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]) < 1e-10; }
    function half3(p,f) {
      tick(p.length);
      const out=[];
      for(let i=0;i<p.length;i++){
        const a=p[i],b=p[(i+1)%p.length],da=f(a),db=f(b),ai=da>=0,bi=db>=0;
        if(!finite(da)||!finite(db))throw new Error('nonfinite_proposal_clearance');
        if(ai!==bi){const t=da/(da-db);out.push(a.map((v,k)=>v+t*(b[k]-v)));}
        if(bi)out.push(b);
      }
      const clean=out.filter((v,i)=>!i||!same3(v,out[i-1]));
      if(clean.length>1&&same3(clean[0],clean[clean.length-1]))clean.pop();
      return clean;
    }
    function clip3(triangle, polygon) {
      if(++candidates>maxCandidates)throw new Error('proposal_candidate_limit_exceeded');
      let p=triangle;
      if(polygon.length<3){
        function equal(points,f,tolerance){
          const out=[];tick(points.length);
          for(let i=0;i<points.length;i++){
            const a=points[i],b=points[(i+1)%points.length],da=f(a),db=f(b);
            if(Math.abs(da)<=tolerance)out.push(a);
            if((da < -tolerance && db > tolerance)||(da > tolerance && db < -tolerance)){const t=da/(da-db);out.push(a.map((v,k)=>v+t*(b[k]-v)));}
          }
          return out.filter((v,i)=>!i||!same3(v,out[i-1]));
        }
        const a=polygon[0],b=polygon[polygon.length-1],dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy);
        if(length>0){
          p=equal(p,q=>cross(a,b,q),Math.max(1,length)*1e-9);
          p=half3(p,q=>(q[0]-a[0])*dx+(q[1]-a[1])*dy);
          return half3(p,q=>(b[0]-q[0])*dx+(b[1]-q[1])*dy);
        }
        p=equal(p,q=>q[0]-a[0],1e-9);
        return equal(p,q=>q[1]-a[1],1e-9);
      }
      for(let i=0;i<polygon.length&&p.length;i++)p=half3(p,q=>cross(polygon[i],polygon[(i+1)%polygon.length],q));
      return p;
    }
    function spatialArea(p) {
      let sum=0;
      for(let i=1;i+1<p.length;i++){
        const a=p[i].map((v,k)=>v-p[0][k]),b=p[i+1].map((v,k)=>v-p[0][k]);
        sum+=Math.hypot(a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0])/2;
      }
      return sum;
    }
    function outsideParcel(triangle) {
      let remaining=[triangle];
      for(const mask of envelope.parcelPatches||[]){
        const next=[];
        for(const part of remaining){
          if(++candidates>maxCandidates)throw new Error('proposal_candidate_limit_exceeded');
          let inside=part;
          for(let i=0;i<mask.polygon.length&&inside.length;i++){
            const f=q=>cross(mask.polygon[i],mask.polygon[(i+1)%mask.polygon.length],q);
            // Entirely coincident boundary faces belong to the parcel closure.
            if(inside.some(q=>f(q)<0)){
              const out=half3(inside,q=>-f(q));
              if(out.length)next.push(out);
            }
            inside=half3(inside,f);
          }
        }
        remaining=next;if(!remaining.length)break;
      }
      return remaining.reduce((s,p)=>s+spatialArea(p),0)>Math.max(1e-10,spatialArea(triangle)*1e-8);
    }
    try {
      // Validate the complete proposal before reporting any geometric result.
      for(const part of o.parts){
        const p=part&&part.positions,indices=part&&part.indices;
        if(part&&part.offset!==undefined&&(!array(part.offset)||part.offset.length!==3||!Array.from(part.offset).every(finite)))throw new Error('invalid_proposal_offset');
        if(!array(p)||p.length%3||!p.length||(indices!==undefined&&(!array(indices)||indices.length%3)))throw new Error('invalid_proposal_triangles');
        const count=indices===undefined?p.length/9:indices.length/3;
        if(!Number.isInteger(count))throw new Error('invalid_proposal_triangles');
        total+=count;if(total>maxTriangles)throw new Error('proposal_triangle_limit_exceeded');
        for(const v of p){tick(1);if(!finite(v))throw new Error('nonfinite_proposal_coordinate');}
        if(indices!==undefined)for(const v of indices){tick(1);if(!Number.isInteger(v)||v<0||v>=p.length/3)throw new Error('invalid_proposal_index');}
      }
      for(const part of o.parts){
        const p=part.positions,indices=part.indices,count=indices===undefined?p.length/9:indices.length/3;
        for(let n=0;n<count;n++){
          const triangle=[0,1,2].map(k=>{const i=(indices===undefined?n*3+k:indices[n*3+k])*3;return [0,1,2].map(k=>p[i+k]+(part.offset?part.offset[k]:0));});
          if(!triangle.every(p=>p.every(finite)))throw new Error('nonfinite_proposal_coordinate');
          result.checkedTriangles++;result.processedTriangles++;
          let hit=false;
          for(const patch of patches){
            const clipped=clip3(triangle,patch.polygon);
            if(!clipped.length)continue;
            hit=true;
            for(const q of clipped){
              const ceiling=patch.fn.at(q)-envelope.datumOffsetM,clearance=ceiling-q[2];
              if(!finite(clearance))throw new Error('nonfinite_proposal_clearance');
              if(result.minClearanceM===null||clearance<result.minClearanceM){
                result.minClearanceM=clearance;result.controllingView=patch.view;result.source=patch.source;
                result.controlPoint={x:q[0],y:q[1],z:q[2],ceilingModelZ:ceiling,ceilingElevationM:ceiling+envelope.datumOffsetM,
                  view:patch.view,source:patch.source,part:part.name||null,triangle:n};
              }
            }
            const intrusion=half3(clipped,q=>q[2]-(patch.fn.at(q)-envelope.datumOffsetM));
            if(intrusion.some(q=>q[2]-(patch.fn.at(q)-envelope.datumOffsetM)>1e-10)){
              for(let k=1;k+1<intrusion.length;k++)result.intrusionPositions.push(...intrusion[0],...intrusion[k],...intrusion[k+1]);
            }
          }
          if(hit)result.intersectingTriangles++;
          if(outsideParcel(triangle)){result.outsideParcelTriangles++;unresolved=true;}
          for(const missing of envelope.unresolvedPatches||[])if(clip3(triangle,missing.polygon).length)unresolved=true;
        }
      }
      if(!total)throw new Error('proposal_triangles_required');
      result.maxPenetrationM=result.minClearanceM===null?null:Math.max(0,-result.minClearanceM);
      result.status=unresolved?'partial':result.minClearanceM===null?'outside':'ready';
      result.exact=true;result.completed=true;result.work=work;result.candidates=candidates;
      if(unresolved)result.issues.push('proposal_intersects_unresolved_envelope');
      if(result.outsideParcelTriangles)result.issues.push('proposal_extends_outside_parcel');
      return result;
    }catch(error){
      result.status=/budget_exceeded|triangle_limit_exceeded|candidate_limit_exceeded/.test(error.message)?'complexity-limit':'unresolved';result.completed=false;result.exact=false;result.minClearanceM=null;result.maxPenetrationM=null;
      result.controllingView=null;result.controlPoint=null;result.source=null;result.intrusionPositions=[];
      result.issues.push(error.message);result.work=work;return result;
    }
  }
  return {build, evaluate: build, intersectProposal};
});
