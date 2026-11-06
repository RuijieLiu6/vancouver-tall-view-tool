/* Render-only navigation. Public polygon apexes and model ground are approximate. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ImagineCityViewpoints = api;
})(typeof window === 'object' ? window : null, function () {
  'use strict';
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const copy = value => JSON.parse(JSON.stringify(value));
  function list(cones, groundAt, eyeHeight = 1.6) {
    return (cones || []).map(cone => {
      const id = String(cone.view_number), origin = cone.origin_model_xy;
      const valid = Array.isArray(origin) && origin.length === 2 && origin.every(Number.isFinite);
      const ground = valid ? groundAt(...origin) : null;
      const available = valid && Number.isFinite(ground?.z);
      return {id, name:cone.name || 'Protected viewpoint', available,
        origin:valid ? origin.slice() : null,
        observerPosition:available ? [...origin, ground.z + eyeHeight] : null,
        groundPosition:available ? [...origin, ground.z] : null,
        groundSource:ground?.source || null,
        status:available ? 'Approximate modelled observer · unverified' : 'Model ground unavailable',
        certainty:'Study — not a verified City observer elevation'};
    });
  }
  function create(state, inspectTarget) {
    const cams = copy(state.cams);
    cams.inspect.target = (inspectTarget || cams.overview.target).slice();
    return {mode:state.mode === 'observer' ? 'overview' : state.mode, cams,
      fov:state.fov, selectedId:null, observerPosition:null, reference:[0,0,120]};
  }
  // An introductory orbit, distinct from standing at the protected observer.
  // Keep the park centred and look north toward downtown at landscape scale.
  function home(nav, viewpoint, options = {}) {
    const ground=viewpoint?.groundPosition;
    if(!nav?.cams || !viewpoint?.available || !Array.isArray(ground) || ground.length!==3 || !ground.every(Number.isFinite))return false;
    const aspect=Number.isFinite(options.aspect)&&options.aspect>0?clamp(options.aspect,.35,3):1.6;
    const target=[ground[0],ground[1],ground[2]+60],distance=500*(aspect<1?1+.3*(1-aspect):1);
    nav.cams.overview={target,dist:distance,az:Math.atan2(ground[1],ground[0]),el:.16};
    nav.cams.inspect.target=target.slice();nav.cams.inspect.dist=900;
    nav.mode='overview';nav.selectedId=null;nav.observerPosition=null;
    nav.homeViewpointId=String(viewpoint.id);return true;
  }
  function enter(nav, viewpoint, reference = [0,0,120], framing = null) {
    if (!viewpoint?.available || !viewpoint.observerPosition?.every(Number.isFinite)) return false;
    const eye = viewpoint.observerPosition.slice();
    let target = reference.slice();
    if (Math.hypot(target[0]-eye[0], target[1]-eye[1]) < 1) target = [eye[0],eye[1]+1000,target[2]];
    const d = target.map((v,i) => v-eye[i]);
    nav.selectedId = viewpoint.id; nav.observerPosition = eye; nav.reference = target;
    nav.cams.observer = {yaw:Math.atan2(d[1],d[0]), pitch:Math.atan2(d[2],Math.hypot(d[0],d[1]))};
    const half = framing?.horizontalSpanRad / 2 + 5 * Math.PI / 180;
    nav.fov = framing && Number.isFinite(half) && framing.aspect > 0
      ? clamp(Math.max(60,2*Math.atan(Math.tan(half)/framing.aspect)*180/Math.PI),60,110) : 60;
    nav.mode = 'observer';
    return true;
  }
  // A world-anchored cross-section of the mapped angular corridor. Only its
  // horizontal sides come from public geometry. The lower edge samples the
  // active unverified Study plane; the upper edge is display-only headroom.
  // Nothing here infers an official vertical boundary from a plan polygon.
  function protectedViewFrame(cone, eye, surface, options = {}) {
    const polygon=cone?.polygon_model_xy, origin=cone?.origin_model_xy, plane=surface?.plane;
    if (!Array.isArray(polygon) || polygon.length < 3 || !Array.isArray(origin) || origin.length !== 2 ||
      !origin.every(Number.isFinite) || !Array.isArray(eye) || eye.length !== 3 || !eye.every(Number.isFinite) ||
      !plane || ![plane.a,plane.b,plane.c].every(Number.isFinite)) return null;
    if (polygon.some(q=>!Array.isArray(q)||q.length<2||!q.slice(0,2).every(Number.isFinite))) return null;
    const tau=2*Math.PI;
    const bearings=polygon.filter(q=>Math.hypot(q[0]-origin[0],q[1]-origin[1])>0.01)
      .map(q=>(Math.atan2(q[1]-origin[1],q[0]-origin[0])+tau)%tau).sort((a,b)=>a-b);
    if (bearings.length < 2) return null;
    // The smallest circular interval containing all polygon rays works across
    // the ±pi seam and for the five-vertex Clinton polygon as well as triangles.
    let gap=-1,start=0;
    for(let i=0;i<bearings.length;i++){
      const d=(i+1<bearings.length?bearings[i+1]:bearings[0]+tau)-bearings[i];
      if(d>gap){gap=d;start=(i+1)%bearings.length;}
    }
    const low=bearings[start], span=tau-gap, middle=low+span/2;
    if (!(span>1e-6&&span<Math.PI*.95)) return null;
    const distanceM=Number.isFinite(options.distanceM)&&options.distanceM>0?options.distanceM:3000;
    const headroomDeg=Number.isFinite(options.headroomDeg)&&options.headroomDeg>0?options.headroomDeg:15;
    const forward=[Math.cos(middle),Math.sin(middle)], right=[-forward[1],forward[0]];
    const halfWidth=distanceM*Math.tan(span/2);
    const atSide=side=>{
      const x=origin[0]+distanceM*forward[0]+side*halfWidth*right[0];
      const y=origin[1]+distanceM*forward[1]+side*halfWidth*right[1];
      return [x,y,plane.a*x+plane.b*y+plane.c];
    };
    const a=atSide(-1),b=atSide(1),lowerZ=(a[2]+b[2])/2;
    const lowerAngle=Math.atan2(lowerZ-eye[2],distanceM);
    const topAngle=Math.min(Math.PI*.47,lowerAngle+headroomDeg*Math.PI/180);
    const rise=Math.max(1,distanceM*Math.tan(topAngle)-(lowerZ-eye[2]));
    const c=[b[0],b[1],b[2]+rise],d=[a[0],a[1],a[2]+rise],corners=[a,b,c,d];
    if(corners.some(q=>q.some(v=>!Number.isFinite(v))))return null;
    const edges=[];for(let i=0;i<4;i++)edges.push(...corners[i],...corners[(i+1)%4]);
    return {selectedId:String(cone.view_number),corners,edges:new Float32Array(edges),
      center:[origin[0]+distanceM*forward[0],origin[1]+distanceM*forward[1],lowerZ+rise/2],
      distanceM,horizontalSpanRad:span,horizontalSpanDeg:span*180/Math.PI,
      headroomDeg,lowerSource:surface.source||'Active unverified Study surface',
      status:'Study extent — reconstructed; not an official protection boundary',
      horizontalStatus:'Mapped public polygon angular limits',
      lowerStatus:'Active Study surface — unverified',
      upperStatus:'Display-only headroom — no official upper boundary available',
      referenceStatus:'Fixed 3D cross-section; distance is a display assumption',
      officialVerticalBoundary:false};
  }
  function setMode(nav, mode) {
    if (!['overview','plan','inspect','observer'].includes(mode) || mode === 'observer' && !nav.observerPosition) return false;
    nav.mode = mode; return true;
  }
  function look(nav, dx, dy, height = 600) {
    const o = nav.cams.observer, k = 1.25 * nav.fov * Math.PI / 180 / Math.max(1,height);
    o.yaw -= dx*k; o.pitch = clamp(o.pitch-dy*k,-1.48,1.48);
  }
  function drag(nav, dx, dy, pan, height = 600) {
    if (nav.mode === 'observer') {look(nav,dx,dy,height); return;}
    const o = nav.mode === 'inspect' ? nav.cams.inspect : nav.cams.overview;
    if (nav.mode === 'plan') {
      const scale = 2*o.dist*Math.tan(Math.PI/8)/Math.max(1,height);
      o.target[0] -= dx*scale; o.target[1] += dy*scale;
    } else if (pan) {
      const scale=o.dist*.0016;
      o.target[0] += (Math.sin(o.az)*dx-Math.cos(o.az)*dy)*scale;
      o.target[1] += (-Math.cos(o.az)*dx-Math.sin(o.az)*dy)*scale;
    } else {o.az -= dx*.006; o.el=clamp(o.el+dy*.006,.03,1.55);}
  }
  function zoom(nav, factor) {
    if (nav.mode === 'observer') nav.fov=clamp(nav.fov*Math.exp(factor),20,110);
    else {const o=nav.mode === 'inspect' ? nav.cams.inspect : nav.cams.overview; o.dist=clamp(o.dist*Math.exp(factor),nav.mode === 'inspect'?20:30,30000);}
  }
  function key(nav, key, factor = 1) {
    const dx=key==='ArrowLeft'?-1:key==='ArrowRight'?1:0, dy=key==='ArrowUp'?-1:key==='ArrowDown'?1:0;
    if (nav.mode === 'observer') {
      // Protected origins remain fixed: arrows and I/J/K/L turn the camera.
      const o=nav.cams.observer, k=key.toLowerCase();
      if (dx || k==='j' || k==='l') o.yaw += (dx ? -dx : k==='j'?1:-1)*.045*factor;
      else if (dy || k==='i' || k==='k') o.pitch=clamp(o.pitch+(dy ? -dy : k==='i'?1:-1)*.035*factor,-1.48,1.48);
      else return false;
      return true;
    }
    if (!key.startsWith('Arrow')) return false;
    const o=nav.mode==='inspect'?nav.cams.inspect:nav.cams.overview;
    if (nav.mode==='plan') {const d=o.dist*.04*factor; o.target[0]+=dx*d; o.target[1]-=dy*d;}
    else {o.az-=dx*.07*factor; o.el=clamp(o.el-dy*.04*factor,.03,1.55);}
    return true;
  }
  return {list, create, home, enter, protectedViewFrame, setMode, drag, zoom, key};
});
