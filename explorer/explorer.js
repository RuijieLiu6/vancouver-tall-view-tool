/* Vancouver View-Protection Lab — Site Explorer (staged).
 * Renders the supplied Vancouver context model (derived assets in /generated/), a user proposal (stacked
 * boxes or an imported model), the City's open-data view-cone plan polygons, an exploratory or origin-
 * placed observer, and a HYPOTHETICAL guideline check computed locally by Python or
 * its browser equivalent in the static release. Visual exploration and teaching only: no compliance or height-limit conclusion is produced.
 * Coordinates are model metres, Z up, untransformed. Custom WebGL2 renderer, no dependencies.
 */
(function () {
'use strict';
const $ = (id) => document.getElementById(id);
const facadeWorkerURL = new URL('facade-worker.js', document.currentScript?.src || location.href).href;
const startupPerformance = {facades: []};
function buildFacadesInWorker(raw, catalogue, profiles) {
  return new Promise((resolve, reject) => {
    if (typeof Worker !== 'function') { reject(new Error('Context window preparation requires browser Worker support.')); return; }
    let worker, timer;
    const finish = (error, value) => { clearTimeout(timer); worker?.terminate(); error ? reject(error) : resolve(value); };
    try {
      worker = new Worker(facadeWorkerURL);
      timer = setTimeout(() => finish(new Error('Context window preparation timed out. Reload to retry.')), 120000);
      worker.onmessage = event => event.data?.error ? finish(new Error(event.data.error)) : finish(null, event.data);
      worker.onerror = event => { event.preventDefault(); finish(new Error(event.message || 'Context window worker failed.')); };
      worker.onmessageerror = () => finish(new Error('Context window worker returned unreadable geometry.'));
      // Clone raw buffers: picking and checksums must retain their original arrays.
      worker.postMessage({raw, catalogue, profiles});
    } catch (error) { finish(error); }
  });
}
const syntheticLink = document.querySelector('.chip-link'); if (syntheticLink) syntheticLink.href = window.ProjectAPI.assetUrl('synthetic/');
const IMPORT_EMPTY = 'No model loaded. .3dm and .obj files are read in your browser and stay on your device.';
$('import-info').textContent = IMPORT_EMPTY;

// ------------------------------------------------------------------ math
const V = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s], dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: (a) => Math.hypot(a[0], a[1], a[2]), norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
};
function perspective(fovy, aspect, near, far) { const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
  return new Float64Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]); }
function ortho(l, r, b, t, n, f) { return new Float64Array([2 / (r - l), 0, 0, 0, 0, 2 / (t - b), 0, 0, 0, 0, -2 / (f - n), 0, -(r + l) / (r - l), -(t + b) / (t - b), -(f + n) / (f - n), 1]); }
function lookAt(eye, target, up) { const z = V.norm(V.sub(eye, target)); let x = V.cross(up, z); if (V.len(x) < 1e-9) x = V.cross([0, 1, 0], z); x = V.norm(x); const y = V.cross(z, x);
  return new Float64Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -V.dot(x, eye), -V.dot(y, eye), -V.dot(z, eye), 1]); }
function mul(a, b) { const o = new Float64Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; }
function invert(m) {
  const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3], a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7], a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11], a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12,
    b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06; if (!det) return null; det = 1 / det; const o = new Float64Array(16);
  o[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det; o[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det; o[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det; o[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
  o[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det; o[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det; o[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det; o[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
  o[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det; o[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det; o[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det; o[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
  o[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det; o[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det; o[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det; o[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det; return o;
}
function project(m, p) { const x = p[0], y = p[1], z = p[2]; const w = m[3] * x + m[7] * y + m[11] * z + m[15];
  return [(m[0] * x + m[4] * y + m[8] * z + m[12]) / w, (m[1] * x + m[5] * y + m[9] * z + m[13]) / w, (m[2] * x + m[6] * y + m[10] * z + m[14]) / w, w]; }
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const fmt = (v, d = 1) => (v === null || v === undefined || Number.isNaN(v)) ? '—' : Number(v).toFixed(d);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ------------------------------------------------------------------ colours
let BG = [0.93, 0.94, 0.95];
const C = {
  terrain: [0.77, 0.82, 0.77, 1], parks: [0.61, 0.74, 0.61, 1], water: [0.56, 0.72, 0.79, 1], buildings: [0.96, 0.95, 0.92, 1], buildingSel: [0.50, 0.60, 0.74, 1],
  roads: [0.53, 0.60, 0.56, 1], shoreline: [0.52, 0.60, 0.70, 1], extent: [0.40, 0.40, 0.42, 1],
  proposal: [0.90, 0.42, 0.15, 1], proposalEdge: [0.40, 0.16, 0.04, 1], siteEdge: [0.80, 0.30, 0.08, 1], studyBoundary: [0.08, 0.40, 0.30, 1],
  observer: [0.12, 0.45, 0.85, 1], ray: [0.08, 0.38, 0.85, 1], wedge: [0.20, 0.50, 0.90, 0.16], wedgeEdge: [0.20, 0.50, 0.90, 0.85],
  cone: [0.47, 0.24, 0.71, 0.05], coneSel: [0.47, 0.24, 0.71, 0.11], coneEdge: [0.47, 0.24, 0.71, 0.35], coneEdgeSel: [0.40, 0.15, 0.65, 1], origin: [0.35, 0.15, 0.6, 1],
  plane: [0.63, 0.24, 0.78, 0.22], planeEdge: [0.55, 0.15, 0.7, 1], backdrop: [0.58, 0.64, 0.72, 1], extBuildings: [0.83, 0.83, 0.86, 1], extTerrain: [0.85, 0.85, 0.81, 1], extWater: [0.78, 0.83, 0.88, 1], extParks: [0.80, 0.85, 0.77, 1], extRoads: [0.72, 0.72, 0.70, 1], extExtent: [0.55, 0.55, 0.60, 1],
};

const rgba = (hex, alpha=1) => [parseInt(hex.slice(1,3),16)/255,parseInt(hex.slice(3,5),16)/255,parseInt(hex.slice(5,7),16)/255,alpha];
const COLLAGE_COLORS = {
  terrain:rgba('#dedbce'), parks:rgba('#8c9c83'), water:rgba('#b7c9c9'), buildings:rgba('#fafbf8'), buildingSel:rgba('#b4c4bb'),
  roads:rgba('#aaa899'), shoreline:rgba('#8a9f9d'), extent:rgba('#94978d'),
  proposal:rgba('#ce9581'), proposalEdge:rgba('#995d4d'), siteEdge:rgba('#a76553'), studyBoundary:rgba('#526e5b'),
  observer:rgba('#476f83'), ray:rgba('#476f83'), wedge:rgba('#91b0bc',.09), wedgeEdge:rgba('#476f83',.65),
  cone:rgba('#807d97',.035), coneSel:rgba('#807d97',.045), coneEdge:rgba('#807d97',.35), coneEdgeSel:rgba('#726a87'), origin:rgba('#726a87'),
  plane:rgba('#b68c9a',.18), planeEdge:rgba('#926574'), backdrop:rgba('#b8bcb0'),
  extBuildings:rgba('#e1e8e3'), extTerrain:rgba('#e1decd'), extWater:rgba('#c6d2d0'), extParks:rgba('#a4b19a'), extRoads:rgba('#b5b9ad'), extExtent:rgba('#9ba99b'),
};
// Night: dark ground and sky, lit windows (shader), glowing streets, a warm-lit proposal and neon study lines.
const NIGHT_COLORS = {
  terrain:rgba('#10141c'), parks:rgba('#0f1d17'), water:rgba('#07121f'), buildings:rgba('#141a26'), buildingSel:rgba('#3b4a6b'),
  roads:rgba('#ffb04a',.75), shoreline:rgba('#3f7fa8',.8), extent:rgba('#3a4458'),
  proposal:rgba('#ff8a4c'), proposalEdge:rgba('#ffd2b0'), siteEdge:rgba('#ff9a5c'), studyBoundary:rgba('#7cf2c8'),
  observer:rgba('#4cc9f0'), ray:rgba('#4cc9f0'), wedge:rgba('#4cc9f0',.12), wedgeEdge:rgba('#4cc9f0',.8),
  cone:rgba('#9b8cff',.05), coneSel:rgba('#9b8cff',.08), coneEdge:rgba('#9b8cff',.55), coneEdgeSel:rgba('#c3b8ff'), origin:rgba('#c3b8ff'),
  plane:rgba('#ff4f8b',.18), planeEdge:rgba('#ff4f8b'), backdrop:rgba('#121a2c'),
  extBuildings:rgba('#121825'), extTerrain:rgba('#0e1219'), extWater:rgba('#07121f'), extParks:rgba('#0e1b15'), extRoads:rgba('#e9a24a',.6), extExtent:rgba('#36405a'),
};
// Context keeps the mapped geometry and adds simulated materials and daylight. Facade detail is illustrative, not survey data.
const CONTEXT_COLORS = {
  terrain:rgba('#b5b3a4'), parks:rgba('#8f9e6f'), water:rgba('#4e9b9c'), buildings:rgba('#dde1db'), buildingSel:rgba('#72a8ad'),
  roads:rgba('#737975'), shoreline:rgba('#6f9696',.65), extent:rgba('#7b8984'),
  proposal:rgba('#c27651'), proposalEdge:rgba('#783c29'), siteEdge:rgba('#ae573a'), studyBoundary:rgba('#246c57'),
  observer:rgba('#1e6d9c'), ray:rgba('#1e6d9c'), wedge:rgba('#5b9fae',.10), wedgeEdge:rgba('#256b84',.75),
  cone:rgba('#77749c',.035), coneSel:rgba('#77749c',.06), coneEdge:rgba('#77749c',.4), coneEdgeSel:rgba('#625b86'), origin:rgba('#625b86'),
  plane:rgba('#ae748a',.18), planeEdge:rgba('#8c4f6c'), backdrop:rgba('#6e8587'),
  extBuildings:rgba('#d0dcda'), extTerrain:rgba('#b6b9a5'), extWater:rgba('#4e9b9c'), extParks:rgba('#8f9e6f'), extRoads:rgba('#84918b'), extExtent:rgba('#788f84'),
};
// Plain keeps the 'collage' key so saved studies continue to open with their original palette.
// Retired style keys and legacy Day / White Model aliases open as Plain.
const SCENE_STYLES = {
  collage:{name:'Plain',colors:COLLAGE_COLORS,bg:rgba('#f3f2ec').slice(0,3),shader:2},
  night:{name:'Night',colors:NIGHT_COLORS,bg:rgba('#070b14').slice(0,3),shader:3},
  context:{name:'Context',colors:CONTEXT_COLORS,bg:rgba('#dbe8eb').slice(0,3),shader:4},
};
const STYLE_ALIASES = { plain: 'collage', day: 'collage', white: 'collage', 'white-model': 'collage', classic: 'collage', studio: 'collage', illustrated: 'collage', garden: 'collage', realistic: 'context' };
function setSceneStyle(style, save=true) {
  style = STYLE_ALIASES[String(style || '').toLowerCase()] || style;
  state.sceneStyle=Object.hasOwn(SCENE_STYLES,style)?style:'collage';
  const palette=SCENE_STYLES[state.sceneStyle]; BG=[...palette.bg]; Object.assign(C,palette.colors);
  document.body.dataset.sceneStyle=state.sceneStyle; $('scene-style').value=state.sceneStyle;
  $('context-style-note')?.classList.toggle('hidden',state.sceneStyle!=='context');
  const swatches={city:'buildings',terrain:'terrain',water:'water',proposal:'proposal',observer:'observer',wedge:'wedge',cone:'coneEdgeSel',plane:'planeEdge',site:'studyBoundary'};
  for(const [key,color] of Object.entries(swatches)) { const c=C[color], css=`rgb(${c.slice(0,3).map(v=>Math.round(v*255)).join(' ')})`; document.body.style.setProperty('--scene-'+color,css); const sw=document.querySelector('.sw-'+key); if(sw) sw.style.backgroundColor=css; }
  requestRender(); if(save) {writeHash(); refreshPanels();}
}

// ------------------------------------------------------------------ WebGL
const canvas = $('gl');
const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, depth: true, preserveDrawingBuffer: true });
const errorStrip = $('error-strip');
function showError(msg) { errorStrip.textContent = msg; errorStrip.classList.remove('hidden'); }
if (!gl) { showError('WebGL2 is not available in this browser, so the context model cannot be drawn. Try a current Chrome, Firefox, Safari or Edge with hardware acceleration enabled.'); $('loading').classList.add('hidden'); }
const VS = `#version 300 es
precision highp float; layout(location=0) in vec3 aPos; layout(location=1) in vec4 aContext;
layout(location=2) in vec4 aFacadeLimits; layout(location=3) in float aFacadeAngle; layout(location=4) in vec2 aImagine;
uniform mat4 uVP; uniform vec3 uOffset; uniform float uImagineCity; out vec3 vWorld; flat out vec4 vContext;
flat out vec4 vFacadeLimits; flat out float vFacadeAngle;
void main(){ vWorld = aPos + uOffset; vContext=aContext; vFacadeLimits=aFacadeLimits;vFacadeAngle=aFacadeAngle;
  if(uImagineCity>0.5){
    vWorld.z=aImagine.x+(aPos.z-aImagine.x)*aImagine.y+uOffset.z;
    vContext.x=aImagine.x+(aContext.x-aImagine.x)*aImagine.y;
    vContext.y=aImagine.x+(aContext.y-aImagine.x)*aImagine.y;
    vFacadeLimits.z=aImagine.x+(aFacadeLimits.z-aImagine.x)*aImagine.y;
    vFacadeLimits.w=aImagine.x+(aFacadeLimits.w-aImagine.x)*aImagine.y;
  }
  gl_Position = uVP * vec4(vWorld, 1.0); }`;
const FS_MESH = `#version 300 es
precision highp float;
in vec3 vWorld; flat in vec4 vContext; flat in vec4 vFacadeLimits; flat in float vFacadeAngle;
uniform vec4 uColor; uniform vec3 uCamPos; uniform vec3 uFog;
uniform float uFogFar; uniform float uLightMix; uniform float uStudyActive; uniform float uStudyCeiling; uniform vec4 uStudyArea;
uniform float uSceneStyle; uniform float uSurface; uniform sampler2D uAerialTex; uniform float uAerialOn; uniform vec4 uAerialMap; out vec4 outColor;
uniform sampler2D uTrafficTex; uniform sampler2D uTrafficDetailTex; uniform vec4 uTrafficMap; uniform vec4 uTrafficDetailMap; uniform float uTrafficOn;
uniform sampler2D uWaterNormal; uniform float uWaterTextureOn;
uniform sampler2D uGrassTex; uniform float uGrassTextureOn;
uniform sampler2D uFacadeMineral; uniform sampler2D uFacadeBrick; uniform sampler2D uFacadeWhiteBrick; uniform vec3 uFacadeTextureOn;
uniform sampler2D uAsphaltTex; uniform sampler2D uPavingTex; uniform vec2 uPavingTextureOn;
uniform sampler2D uShadowTex; uniform mat4 uShadowVP; uniform float uShadowOn; uniform float uShadowTexel;
float hash21(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float hatch(float q){ float aa=max(fwidth(q),0.001); float line=1.0-smoothstep(0.045,0.045+aa,abs(fract(q+0.5)-0.5)); return line*(1.0-smoothstep(0.22,0.7,aa)); }
float stipple(vec2 q){ vec2 cell=floor(q); vec2 centre=vec2(hash21(cell),hash21(cell+vec2(83.0,19.0)))*0.5+0.25;
  float aa=max(length(fwidth(q)),0.001); return (1.0-smoothstep(0.085,0.085+aa,length(fract(q)-centre)))*(1.0-smoothstep(0.28,0.8,aa)); }
float paperNoise(vec2 p){
  vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(hash21(i),hash21(i+vec2(1,0)),f.x),mix(hash21(i+vec2(0,1)),hash21(i+vec2(1,1)),f.x),f.y);
}
vec3 pavingAlbedo(bool asphalt){
  // Continuous world coordinates preserve grain size across terrain tiles and bridge decks.
  vec2 scale=asphalt?vec2(4.0,8.0):vec2(5.0,10.0),q=vWorld.xy/scale;
  vec2 dx=dFdx(q),dy=dFdy(q),tile=1.0-abs(mod(q,2.0)-1.0);
  vec2 mirrorSign=1.0-2.0*step(vec2(1.0),mod(q,2.0));
  dx*=mirrorSign;dy*=mirrorSign;
  if(asphalt){
    if(uPavingTextureOn.x>0.5) return clamp(textureGrad(uAsphaltTex,tile,dx,dy).rgb,vec3(0.12),vec3(0.42));
    return vec3(0.24,0.25,0.26)*(0.97+0.06*paperNoise(vWorld.xy/0.3));
  }
  // Keep the supplied photograph unchanged; sample only inside its grey presentation border.
  if(uPavingTextureOn.y>0.5){
    vec3 grain=textureGrad(uPavingTex,vec2(0.055,0.025)+tile*vec2(0.89,0.95),dx*vec2(0.89,0.95),dy*vec2(0.89,0.95)).rgb;
    // Fine grain resolves close to the ground; distant tiles soften into one pale surface.
    float detail=1.0-smoothstep(0.015,0.06,max(length(dx),length(dy)));
    return mix(vec3(0.86,0.86,0.85),grain,detail*0.78);
  }
  return vec3(0.86,0.86,0.84)*(0.98+0.04*paperNoise(vWorld.xy/1.3));
}
float daylightShadow(vec3 n){
  if(uShadowOn<0.5) return 1.0;
  vec4 q=uShadowVP*vec4(vWorld+n*0.18,1.0); vec3 p=q.xyz/q.w*0.5+0.5;
  if(any(lessThan(p,vec3(0.001))) || any(greaterThan(p,vec3(0.999)))) return 1.0;
  float lit=0.0;
  for(int x=-1;x<=1;x+=2) for(int y=-1;y<=1;y+=2){
    float depth=texture(uShadowTex,p.xy+vec2(float(x),float(y))*uShadowTexel*0.65).r;
    lit+=step(p.z-0.000035,depth);
  }
  float edge=max(abs(p.x-0.5),abs(p.y-0.5))*2.0;
  return mix(lit*0.25,1.0,smoothstep(0.85,0.99,edge));
}
float facadePane(vec2 grid,vec2 margin){
  vec2 aa=max(fwidth(grid),vec2(0.002)), f=fract(grid);
  vec2 edge=smoothstep(margin-aa,margin+aa,f)*(1.0-smoothstep(1.0-margin-aa,1.0-margin+aa,f));
  float coverage=(1.0-2.0*margin.x)*(1.0-2.0*margin.y);
  return mix(edge.x*edge.y,coverage,smoothstep(0.25,0.8,max(aa.x,aa.y)));
}
// Sample cladding at material-capture scale with derivatives computed before family branches.
// Albedo is confined to walls. Glazing, frames and roofs have separate masks/materials.
vec3 facadeCladding(vec2 uv,vec2 dx,vec2 dy,float family){
  if(family>2.5 && family<3.5 && uFacadeTextureOn.y>0.5)
    return textureGrad(uFacadeBrick,uv/4.0,dx/4.0,dy/4.0).rgb;
  if(family>3.5 && family<4.5 && uFacadeTextureOn.z>0.5)
    return textureGrad(uFacadeWhiteBrick,uv/2.0,dx/2.0,dy/2.0).rgb;
  if(uFacadeTextureOn.x>0.5)
    return textureGrad(uFacadeMineral,uv/1.5,dx/1.5,dy/1.5).rgb;
  return vec3(0.84+0.10*paperNoise(uv/1.8));
}
float facadeOpening(vec2 grid,vec2 margin,float arched){
  float pane=facadePane(grid,margin);
  vec2 aa=max(fwidth(grid),vec2(0.002)),f=fract(grid);
  float halfWidth=max(0.05,0.5-margin.x),rise=halfWidth*0.65;
  float spring=1.0-margin.y-rise,xx=(f.x-0.5)/halfWidth;
  float top=spring+rise*sqrt(max(0.0,1.0-xx*xx));
  float archEdge=1.0-smoothstep(top-aa.y,top+aa.y,f.y);
  float nearPane=pane*archEdge;
  float fade=smoothstep(0.20,0.65,max(aa.x,aa.y));
  return mix(pane,mix(nearPane,pane*0.95,fade),arched);
}
vec3 contextFacade(vec2 uv,float family,float floorH,float seed,vec3 glass,float baseZ){
  vec2 dx=dFdx(uv),dy=dFdy(uv);
  vec3 material=facadeCladding(uv,dx,dy,family);
  float value=dot(material,vec3(0.2126,0.7152,0.0722));
  vec3 wall=vec3(0.87,0.87,0.83)*(0.90+0.12*value);
  float bay=2.5,arched=0.0;
  vec2 margin=vec2(0.22,0.20);
  if(family<0.5){
    wall=vec3(0.88,0.90,0.88)*(0.92+0.10*value);bay=1.75;margin=vec2(0.09,0.17);
  } else if(family<1.5){
    wall=vec3(0.91,0.89,0.83)*(0.91+0.10*value);bay=2.8;margin=vec2(0.055,0.24);
  } else if(family<2.5){
    wall=vec3(0.90,0.86,0.76)*(0.91+0.11*value);bay=2.45;margin=vec2(0.24,0.17);
  } else if(family<3.5){
    // Warm pale masonry, rather than the former dark red/brown whole-building tint.
    wall=mix(material*0.72+vec3(0.26,0.17,0.14),vec3(0.82,0.67,0.57),0.28);
    bay=2.6;margin=vec2(0.23,0.15);arched=step(0.5,seed);
  } else if(family<4.5){
    wall=mix(material*0.83+vec3(0.15,0.16,0.15),vec3(0.90,0.89,0.82),0.22);
    bay=2.3;margin=vec2(0.23,0.19);
  } else {
    wall=vec3(0.83,0.86,0.84)*(0.92+0.10*value);bay=3.6;margin=vec2(0.24,0.28);
  }
  vec2 grid=vec2((uv.x+seed*19.0)/bay,(uv.y-0.25)/floorH);
  vec2 aa=max(fwidth(grid),vec2(0.002)),fr=fract(grid);
  float detail=1.0-smoothstep(0.20,0.70,max(aa.x,aa.y));
  float panes=facadeOpening(grid,margin,arched);
  vec2 outerMargin=max(vec2(0.015),margin-vec2(0.035,0.025));
  float surround=facadeOpening(grid,outerMargin,arched);
  // Accept the entire opening and frame, not a fragment-level crop at a roof or corner.
  vec2 cellLo=(floor(grid)+outerMargin)*vec2(bay,floorH)+vec2(-seed*19.0,0.25+baseZ);
  vec2 cellHi=(floor(grid)+1.0-outerMargin)*vec2(bay,floorH)+vec2(-seed*19.0,0.25+baseZ);
  float complete=step(vFacadeLimits.x+0.5,cellLo.x)*step(cellHi.x,vFacadeLimits.y-0.5)
    *step(vFacadeLimits.z+0.2,cellLo.y)*step(cellHi.y,vFacadeLimits.w-0.8);
  panes*=complete;surround*=complete;
  vec3 frame=mix(vec3(0.91,0.91,0.86),vec3(0.69,0.75,0.75),step(4.5,family));
  vec3 cladding=mix(wall,frame,surround);
  float cell=hash21(floor(grid)+seed*79.3);
  vec3 glazing=glass*(0.95+0.05*cell);
  // Occasional pale blinds are shallow tonal variation, not assumed occupancy.
  glazing=mix(glazing,vec3(0.78,0.82,0.78),step(0.83,cell)*0.42*detail);
  float vertical=hatch(grid.x*2.0),horizontal=hatch(grid.y*2.0);
  float mullion=vertical*0.32;
  if(family>1.5 && family<4.5)mullion=max(vertical*0.5,horizontal*0.55);
  glazing=mix(glazing,vec3(0.35,0.44,0.47),mullion*detail);
  vec3 result=mix(cladding,glazing,panes);
  // Floor bands stay horizontal, with a quiet edge rather than dark stacked stripes.
  float band=hatch(grid.y)*detail;
  result=mix(result,wall*0.92,band*(family<1.5?0.30:0.10));
  if(family>1.5 && family<3.5){
    float sill=(1.0-smoothstep(0.008,0.028+aa.y,abs(fr.y-margin.y+0.015)))*surround*detail;
    result=mix(result,vec3(0.94,0.91,0.84),sill*0.55);
  }
  return result;
}
void main(){
  vec3 n=normalize(cross(dFdx(vWorld),dFdy(vWorld))); vec3 L=normalize(vec3(-0.45,-0.35,0.82)); float light=max(dot(n,L),0.0);
  bool excess=uStudyActive>0.5 && vWorld.z>uStudyCeiling+0.001 && vWorld.x>=uStudyArea.x && vWorld.y>=uStudyArea.y && vWorld.x<=uStudyArea.z && vWorld.y<=uStudyArea.w;
  vec3 base=excess ? (uSceneStyle>0.5?vec3(0.71,0.075,0.19):vec3(0.85,0.16,0.12)) : uColor.rgb;
  vec3 c=base*mix(1.0,0.50+0.50*light,uLightMix);
  // Retired Illustrated garden branch (style 1), kept inert for historical shader compatibility.
  if(uSceneStyle>0.5 && uSceneStyle<1.5 && uLightMix>0.5){
    vec3 ink=vec3(0.12,0.17,0.20); vec2 uv=abs(n.z)>0.65?vWorld.xy:(abs(n.x)>abs(n.y)?vWorld.yz:vWorld.xz);
    float shade=smoothstep(0.1,0.75,light); c=mix(base*0.72+vec3(0.01,0.035,0.055),base,shade);
    if(uSurface==1.0 || uSurface==5.0){
      c=mix(base, mix(base*0.52,vec3(0.18,0.25,0.34),0.22), (1.0-shade)*0.66);
      float marks=abs(n.z)>0.65 ? stipple(uv/2.4)*0.18 : hatch(uv.x/2.8)*0.27;
      c=mix(c,ink,marks);
    } else if(uSurface==3.0){
      float leafTone=0.5+0.5*sin(vWorld.x*0.006)*sin(vWorld.y*0.008);
      c=mix(base*0.78,vec3(0.70,0.74,0.29),leafTone*0.48);
      c=mix(c,ink,stipple(vWorld.xy/3.8)*0.28);
    } else if(uSurface==4.0){
      c=base; c=mix(c,vec3(0.70,0.87,0.80),hatch((vWorld.y+sin(vWorld.x*0.015)*1.2)/12.0)*0.22);
    } else if(uSurface==2.0 || uSurface==6.0){
      c=mix(base*0.89,base,shade); c=mix(c,ink,hatch((uv.x+uv.y*0.3)/4.0)*0.08+stipple(uv/3.2)*0.07);
    }
    // Fine screen-space grain gives the solid fills a printed-paper finish.
    c*=0.987+0.026*hash21(floor(gl_FragCoord.xy));
  }
  if(uSceneStyle>1.5 && uSceneStyle<2.5 && uLightMix>0.5){
    // Pale, unhatched context masses; the proposal receives only a faint material grain.
    float shade=smoothstep(0.0,0.85,light);
    c=base*(0.81+0.19*shade);
    if(uSurface==1.0 || uSurface==5.0){
      float roof=smoothstep(0.6,0.9,abs(n.z));
      c=mix(base*(0.79+0.15*shade),base,roof);
      if(uSurface==5.0){
        vec2 uv=roof>0.5?vWorld.xy:(abs(n.x)>abs(n.y)?vWorld.yz:vWorld.xz);
        c=mix(c,base*0.72,hatch(uv.x/2.8)*0.035);
      }
    } else if(uSurface==3.0){
      float wash=paperNoise(vWorld.xy/65.0)*0.65+paperNoise(vWorld.xy/16.0)*0.35;
      c=mix(base*0.84,base*1.07,wash);
      c=mix(c,vec3(0.94,0.94,0.85),stipple(vWorld.xy/4.5)*0.12);
      // Faint contours follow the existing terrain mesh, never invented topography.
      c=mix(c,vec3(0.92,0.93,0.85),hatch(vWorld.z/10.0)*0.17);
    } else if(uSurface==4.0){
      c=base*(0.985+0.025*paperNoise(vWorld.xy/95.0));
      c=mix(c,vec3(0.88,0.92,0.91),hatch((vWorld.y+sin(vWorld.x*0.012)*2.0)/18.0)*0.06);
    } else if(uSurface==2.0 || uSurface==6.0){
      c=base*(0.94+0.06*shade);
      c*=0.975+0.035*paperNoise(vWorld.xy/30.0);
    }
    c*=0.994+0.012*hash21(floor(gl_FragCoord.xy));
  }
  if(uSceneStyle>2.5 && uSceneStyle<3.5 && uLightMix>0.5){
    // Night: dark masses with lit windows on a 3.2 m bay by 3.6 m floor grid; far away the panes blend into an even glow.
    float shade=smoothstep(0.0,0.9,light), vertical=1.0-smoothstep(0.35,0.6,abs(n.z));
    if(uSurface==1.0 || uSurface==5.0){
      bool prop=uSurface==5.0;
      vec3 wall=prop?vec3(0.40,0.17,0.10):vec3(0.07,0.085,0.125), roof=prop?vec3(0.85,0.42,0.24):vec3(0.10,0.12,0.17);
      c=mix(roof,wall*(0.75+0.4*shade),vertical);
      float u=abs(n.x)>abs(n.y)?vWorld.y:vWorld.x; vec2 g=vec2(u/3.2,vWorld.z/3.6), cell=floor(g), fr=fract(g);
      float pane=step(0.18,fr.x)*step(fr.x,0.82)*step(0.28,fr.y)*step(fr.y,0.76);
      float on=prop?1.0:step(0.6,hash21(cell+floor(vWorld.xy/45.0)*7.31));
      vec3 lamp=mix(vec3(1.0,0.76,0.42),vec3(0.70,0.86,1.0),step(0.85,hash21(cell+3.7)));
      float fade=smoothstep(0.22,0.75,max(fwidth(g.x),fwidth(g.y)));
      float lit=mix(pane*on,prop?0.42:0.16,fade);
      c=mix(c,lamp*(prop?1.2:0.7+0.4*hash21(cell+9.1)),lit*vertical);
    } else if(uSurface==3.0){ c=vec3(0.04,0.07,0.055)*(0.8+0.4*paperNoise(vWorld.xy/40.0)); }
    else if(uSurface==4.0){ c=vec3(0.02,0.045,0.085)+vec3(1.0,0.7,0.38)*hatch((vWorld.y+sin(vWorld.x*0.02)*3.0)/7.0)*0.07*paperNoise(vWorld.xy/25.0); }
    else if(uSurface==6.0){ c=vec3(0.06,0.08,0.14)*(0.75+0.35*shade); }
    else if(uSurface==0.0){ c=base*(0.8+0.3*shade); }
    else if(uSurface==7.0){ c=vec3(0.45,0.85,1.0)*(0.75+0.3*shade); }
    else { c=vec3(0.05,0.06,0.08)*(0.85+0.25*shade); }
    if(excess) c=vec3(1.0,0.18,0.32);
  }
  if(uSceneStyle>3.5 && uLightMix>0.5){
    // Material families and facade rhythms are deterministic illustrations, not observed facade or floor data.
    vec3 V=normalize(uCamPos-vWorld), sun=vec3(1.0,0.94,0.83), sky=vec3(0.70,0.82,0.92);
    float sunVisibility=daylightShadow(n), daylight=0.57+0.43*light*sunVisibility;
    float roof=smoothstep(0.48,0.83,abs(n.z));
    if(uSurface==5.0){
      // The proposal remains an unarticulated study mass: no assumed storeys, glazing or facade finish.
      vec3 mass=mix(base,vec3(0.82,0.78,0.70),0.72);
      c=mass*(0.67+0.33*light*sunVisibility);
      c=mix(c,mass*(0.89+0.11*sunVisibility),roof);
    } else if(uSurface==1.0){
      // One profile for connected source parts keeps floors/materials coherent.
      float seed=vContext.z,code=floor(vContext.w+0.5),family=floor(code/4096.0);
      float remainder=code-family*4096.0,floorH=2.5+floor(remainder/256.0)*0.1;
      float localZ=vWorld.z-vContext.x;
      vec2 tangent=vec2(cos(vFacadeAngle),sin(vFacadeAngle));
      vec3 reflection=reflect(-V,n);
      float fresnel=pow(1.0-max(dot(n,V),0.0),3.0);
      vec3 glass=mix(vec3(0.48,0.64,0.70),vec3(0.71,0.82,0.86),clamp(reflection.z*0.5+0.5,0.0,1.0));
      glass=mix(glass,vec3(0.79,0.87,0.89),fresnel*0.35);
      // Actual connected wall patches share one tangent and a proven interior rectangle.
      vec3 facade=contextFacade(vec2(dot(vWorld.xy,tangent),localZ),family,floorH,seed,glass,vContext.x);
      facade*=0.76+0.24*light*sunVisibility;
      facade*=mix(0.90,1.0,smoothstep(0.0,3.5,max(localZ,0.0)));
      // Sloped roofs and top faces never receive repeated facade windows.
      float wallMask=1.0-smoothstep(0.25,0.55,abs(n.z));
      vec3 roofMat=family>2.5 && family<3.5?vec3(0.84,0.78,0.72):vec3(0.84,0.86,0.83);
      roofMat*=0.97+0.035*paperNoise(vWorld.xy/2.0);
      c=mix(roofMat*(0.82+0.18*light*sunVisibility),facade,wallMask);
      c*=mix(vec3(1.0),uColor.rgb/vec3(0.867,0.882,0.859),0.20);
      c+=sun*pow(max(dot(reflect(-L,n),V),0.0),80.0)*0.07*wallMask;
    } else if(uSurface==4.0){
      // Opaque turquoise wash, with a CC0 ripple normal. Colour is illustrative, not depth.
      // World-space sampling gives the source and extension one continuous surface.
      vec2 q=vWorld.xy;
      vec2 ripple=vec2(sin(q.x*0.17+q.y*0.11),sin(q.x*0.053-q.y*0.14))*0.055;
      if(uWaterTextureOn>0.5){
        vec2 fine=texture(uWaterNormal,q/32.0).rg*2.0-1.0;
        mat2 turn=mat2(0.8,-0.6,0.6,0.8);
        vec2 broad=texture(uWaterNormal,turn*q/93.0+vec2(0.31,0.17)).rg*2.0-1.0;
        ripple=fine*0.15+transpose(turn)*broad*0.08;
      }
      vec3 wn=normalize(vec3(ripple,1.0));
      float fresnel=pow(1.0-max(dot(wn,V),0.0),3.5);
      float wash=paperNoise(q/170.0+ripple*0.7)*0.65+paperNoise(q/57.0)*0.35;
      vec3 water=mix(base*0.83,base*0.75+vec3(0.17,0.21,0.18),wash);
      vec3 reflectedSky=mix(vec3(0.66,0.83,0.84),vec3(0.82,0.91,0.90),fresnel);
      c=mix(water,reflectedSky,0.10+fresnel*0.69);
      float sheen=pow(max(dot(reflect(-L,wn),V),0.0),64.0);
      c+=sun*sheen*0.22;
      c+=vec3(0.10,0.15,0.14)*smoothstep(0.04,0.22,length(ripple))*0.13;
    } else if(uSurface==3.0){
      // A quiet sage/olive watercolour wash replaces the dense canopy-like noise.
      // World-space albedo spans park meshes continuously; scale is illustrative.
      vec2 q=vWorld.xy;
      float clouds=paperNoise(q/140.0)*0.68+paperNoise(q/43.0)*0.32;
      vec3 grass=mix(base*0.88,base*1.10,clouds);
      if(uGrassTextureOn>0.5){
        mat2 turn=mat2(0.8,-0.6,0.6,0.8);
        vec3 pigment=texture(uGrassTex,q/480.0).rgb;
        vec3 detail=texture(uGrassTex,turn*q/145.0+vec2(0.31,0.17)).rgb;
        // Two restrained scales soften obvious repeats without adding blades or relief.
        grass=mix(grass,mix(pigment,detail,0.16),0.86);
      }
      c=grass*(0.78+0.22*light*sunVisibility);
    } else if(uSurface==2.0){
      c=pavingAlbedo(false)*(0.78+0.22*light*sunVisibility);
    } else if(uSurface==8.0 || uSurface==9.0){
      c=pavingAlbedo(uSurface==8.0)*(0.78+0.22*light*sunVisibility);
    } else if(uSurface==6.0){
      float upland=smoothstep(200.0,1500.0,vWorld.z);
      c=mix(vec3(0.28,0.39,0.36),vec3(0.51,0.58,0.56),upland)*(0.77+0.23*light);
    } else { c=base*daylight; }
    if(excess) c=vec3(0.85,0.10,0.22);
  }
  if(uAerialOn>0.5 && uSurface!=5.0 && uSurface!=0.0 && uSurface!=7.0 && uLightMix>0.5 && !(uSceneStyle>3.5 && (uSurface==4.0 || uSurface==3.0 || uSurface==2.0 || uSurface==8.0 || uSurface==9.0))){
    // Experimental: City 2022 orthophoto draped from above on ground, water, parks and roofs; walls take a darker smear of the same pixels.
    vec2 auv=vec2(uAerialMap.x*vWorld.x+uAerialMap.y, uAerialMap.z*vWorld.y+uAerialMap.w);
    if(auv.x>0.0 && auv.x<1.0 && auv.y>0.0 && auv.y<1.0){
      vec3 photo=texture(uAerialTex,auv).rgb; float shade=smoothstep(0.0,0.9,light), up=smoothstep(0.55,0.8,abs(n.z));
      vec3 wall=mix(photo*0.62,vec3(0.55,0.56,0.58),0.45)*(0.6+0.4*shade);
      vec3 pc=uSurface==1.0 ? mix(wall,photo*(0.88+0.12*shade),up) : photo*(0.92+0.08*shade);
      bool night=uSceneStyle>2.5 && uSceneStyle<3.5;
      if(night) pc*=0.32;
      if(uSceneStyle>3.5){
        // The orthophoto supplies horizontal context only; it is never stretched down Context facades.
        float blend=uSurface==1.0?up*0.8:(uSurface==4.0?0.35:0.84);
        c=mix(c,pc*(0.65+0.35*daylightShadow(n)),blend);
      } else c=night && uSurface==1.0 ? max(c,pc) : pc;
      if(excess) c=vec3(1.0,0.18,0.32);
    }
  }
  if(uTrafficOn>0.5 && uSceneStyle>3.5 && (uSurface==2.0 || uSurface==3.0) && uLightMix>0.5){
    // The mapped road material shares the terrain/park surface: no floating or buried pavement mesh.
    vec2 guv=vec2(uTrafficMap.x*vWorld.x+uTrafficMap.y,uTrafficMap.z*vWorld.y+uTrafficMap.w);
    vec3 road=vec3(0.0);
    if(all(greaterThanEqual(guv,vec2(0.0)))&&all(lessThanEqual(guv,vec2(1.0))))road=texture(uTrafficTex,guv).rgb;
    vec2 duv=vec2(uTrafficDetailMap.x*vWorld.x+uTrafficDetailMap.y,uTrafficDetailMap.z*vWorld.y+uTrafficDetailMap.w);
    if(all(greaterThanEqual(duv,vec2(0.0)))&&all(lessThanEqual(duv,vec2(1.0)))){
      float edge=min(min(duv.x,1.0-duv.x),min(duv.y,1.0-duv.y));
      road=mix(road,texture(uTrafficDetailTex,duv).rgb,smoothstep(0.0,0.08,edge));
    }
    float shade=0.78+0.22*light*daylightShadow(n);
    c=mix(c,pavingAlbedo(false)*shade,clamp(road.b,0.0,1.0));
    c=mix(c,pavingAlbedo(true)*shade,clamp(road.r,0.0,1.0));
  }
  bool context=uSceneStyle>3.5, night=uSceneStyle>2.5 && uSceneStyle<3.5;
  float f=clamp(distance(vWorld,uCamPos)/uFogFar,0.0,1.0); f=f*f*(context?0.5:(night?0.75:(uSceneStyle>1.5?0.38:(uSceneStyle>0.5?0.22:0.55))));
  vec3 fog=context?vec3(0.80,0.87,0.89):(night?vec3(0.09,0.12,0.22):(uSceneStyle>1.5?vec3(0.96,0.96,0.93):(uSceneStyle>0.5?vec3(0.91,0.92,0.77):uFog)));
  outColor=vec4(mix(c,fog,f),uColor.a);
}`;
const FS_LINE = `#version 300 es
precision highp float; in vec3 vWorld; uniform vec4 uColor; uniform vec3 uCamPos; uniform vec3 uFog; uniform float uFogFar; out vec4 outColor;
void main(){ float f = clamp(distance(vWorld, uCamPos) / uFogFar, 0.0, 1.0); f = f * f * 0.5; outColor = vec4(mix(uColor.rgb, uFog, f), uColor.a); }`;
// Unlit view surface: a quiet transparent centre with a luminous grazing edge.
// Uses the actual clipped geometry, independent of the Context facade shader.
const FS_VIEWCONE = `#version 300 es
precision highp float; in vec3 vWorld; uniform vec4 uColor; uniform vec3 uCamPos; out vec4 outColor;
void main(){ vec3 n=normalize(cross(dFdx(vWorld),dFdy(vWorld))); vec3 v=normalize(uCamPos-vWorld);
  float rim=pow(1.0-abs(dot(n,v)),2.0); outColor=vec4(mix(uColor.rgb,vec3(0.3,0.86,1.0),rim*0.55),uColor.a*(0.65+rim*1.25)); }`;
function compile(type, src) { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('shader: ' + gl.getShaderInfoLog(s)); return s; }
function program(fs) { const p = gl.createProgram(); gl.attachShader(p, compile(gl.VERTEX_SHADER, VS)); gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(p)); const u = {}; for (const n of ['uVP', 'uOffset', 'uImagineCity', 'uColor', 'uCamPos', 'uFog', 'uFogFar', 'uLightMix', 'uStudyActive', 'uStudyCeiling', 'uStudyArea', 'uSceneStyle', 'uSurface', 'uAerialTex', 'uAerialOn', 'uAerialMap', 'uTrafficTex', 'uTrafficDetailTex', 'uTrafficMap', 'uTrafficDetailMap', 'uTrafficOn', 'uWaterNormal', 'uWaterTextureOn', 'uGrassTex', 'uGrassTextureOn', 'uFacadeMineral', 'uFacadeBrick', 'uFacadeWhiteBrick', 'uFacadeTextureOn', 'uAsphaltTex', 'uPavingTex', 'uPavingTextureOn', 'uShadowTex', 'uShadowVP', 'uShadowOn', 'uShadowTexel']) u[n] = gl.getUniformLocation(p, n); return { p, u }; }
let PM = null, PL = null, PV = null; if (gl) { try { PM = program(FS_MESH); PL = program(FS_LINE); PV = program(FS_VIEWCONE); } catch (e) { showError(String(e)); } }
function makeMesh(pos, idx) { const vao = gl.createVertexArray(); let vb=null, ib=null;
  try { gl.bindVertexArray(vao); vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, pos, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0); if (idx) { ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW); }
    gl.bindVertexArray(null); return { vao, vb, ib, count: idx ? idx.length : pos.length / 3, indexed: !!idx };
  } catch (error) { gl.bindVertexArray(null); if (ib) gl.deleteBuffer(ib); if (vb) gl.deleteBuffer(vb); if (vao) gl.deleteVertexArray(vao); throw error; } }
async function prepareBuildingMaterials(key, catalogue) {
  let mesh=assets.meshes[key];const raw=assets.raw[key];if(!mesh || !raw?.idx || !catalogue)return;
  const classified=BuildingMaterials.build(catalogue,{assembly:getBuildingAssemblyGraph(),prefix:key==='ext_buildings'?'e':'s'});
  const began=performance.now();
  const bounded=await buildFacadesInWorker(raw,catalogue,classified.profiles);
  startupPerformance.facades.push({key,elapsedMs:performance.now()-began,workerMs:bounded.workerMs});
  gl.deleteVertexArray(mesh.vao);if(mesh.vb)gl.deleteBuffer(mesh.vb);if(mesh.ib)gl.deleteBuffer(mesh.ib);
  mesh=makeMesh(bounded.pos,bounded.idx);assets.meshes[key]=mesh;
  mesh.renderIndex=bounded.idx;mesh.vertexCount=bounded.pos.length/3;mesh.facadeStats=bounded.stats;
  assets.materials ||= {};assets.materials[key]=classified;
  const data=bounded.contextData;
  gl.bindVertexArray(mesh.vao);
  for(const [location,size,values,name] of [[2,4,bounded.limits,'facadeLimitsBuffer'],[3,1,bounded.angles,'facadeAngleBuffer']]){
    const buffer=gl.createBuffer();mesh[name]=buffer;gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,values,gl.STATIC_DRAW);gl.enableVertexAttribArray(location);gl.vertexAttribPointer(location,size,gl.FLOAT,false,0,0);
  }
  mesh.contextBuffer=gl.createBuffer();gl.bindVertexArray(mesh.vao);gl.bindBuffer(gl.ARRAY_BUFFER,mesh.contextBuffer);
  gl.bufferData(gl.ARRAY_BUFFER,data,gl.STATIC_DRAW);gl.enableVertexAttribArray(1);gl.vertexAttribPointer(1,4,gl.FLOAT,false,0,0);gl.bindVertexArray(null);
}
// A sun-depth pass provides actual cast shadows from the retained mesh, including hypothetical removals and the proposal.
// The material pass still works if this optional framebuffer is unavailable on a device.
const contextShadow={program:null,framebuffer:null,tex:null,vp:null,key:null,size:0,failed:false};
function initContextShadow(){
  if(contextShadow.framebuffer || contextShadow.failed) return;
  try {
    const size=Math.min(2048,gl.getParameter(gl.MAX_TEXTURE_SIZE)); contextShadow.size=size;
    contextShadow.program=program(`#version 300 es\nprecision highp float; out vec4 outColor; void main(){outColor=vec4(1.0);}`);
    const tex=gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D,tex);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.DEPTH_COMPONENT24,size,size,0,gl.DEPTH_COMPONENT,gl.UNSIGNED_INT,null);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    const framebuffer=gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.TEXTURE_2D,tex,0); gl.drawBuffers([gl.NONE]); gl.readBuffer(gl.NONE);
    if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE) throw new Error('depth framebuffer unavailable');
    contextShadow.framebuffer=framebuffer; contextShadow.tex=tex;
  } catch(e){ contextShadow.failed=true; }
  finally { gl.bindFramebuffer(gl.FRAMEBUFFER,null); }
}
function prepareContextShadow(cam){
  if(state.sceneStyle!=='context' || cam.half) return;
  initContextShadow(); if(!contextShadow.framebuffer) return;
  const distance=V.len(V.sub(cam.eye,cam.target)), span=Math.round(clamp(distance*0.8,650,6000)/50)*50;
  const centre=[Math.round(cam.target[0]/25)*25,Math.round(cam.target[1]/25)*25,0];
  const P=!imagineCityOpen()&&proposalShown()?proposalBox():null;
  const key=JSON.stringify([imagineCityScene?.versionId||0,imagineCityOpen(),centre,span,state.removed,state.cleared,state.showExisting,P?.box,state.parts,state.imported?.name]);
  if(contextShadow.key===key && contextShadow.imported===state.imported) return;
  const sun=V.norm([-0.45,-0.35,0.82]), lightEye=V.add(centre,V.scale(sun,11000));
  const vp=mul(ortho(-span,span,-span,span,1,23000),lookAt(lightEye,centre,[0,0,1]));
  contextShadow.vp=vp;
  const viewport=gl.getParameter(gl.VIEWPORT), scissor=gl.isEnabled(gl.SCISSOR_TEST), ps=contextShadow.program;
  gl.bindFramebuffer(gl.FRAMEBUFFER,contextShadow.framebuffer); gl.disable(gl.SCISSOR_TEST); gl.viewport(0,0,contextShadow.size,contextShadow.size);
  gl.enable(gl.DEPTH_TEST); gl.depthMask(true); gl.clear(gl.DEPTH_BUFFER_BIT); gl.disable(gl.BLEND);
  gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(1.5,2); gl.useProgram(ps.p);
  gl.uniformMatrix4fv(ps.u.uVP,false,new Float32Array(vp)); gl.uniform3fv(ps.u.uOffset,[0,0,0]);
  for(const name of ['terrain','ext_terrain','buildings','ext_buildings']) drawStatic(ps,name,C.buildings);
  if(P){
    if(state.pmode==='import' && state.imported){
      gl.uniform3fv(ps.u.uOffset,importOffset());
      for(const mesh of state.imported.drawMeshes){gl.bindVertexArray(mesh.vao);gl.drawElements(gl.TRIANGLES,mesh.count,gl.UNSIGNED_INT,0);}
      gl.bindVertexArray(null);
    } else for(const part of P.parts) dynDraw(ps,gl.TRIANGLES,part.pos,part.idx,C.proposal);
  }
  gl.disable(gl.POLYGON_OFFSET_FILL); gl.bindFramebuffer(gl.FRAMEBUFFER,null); gl.viewport(...viewport);
  if(scissor) gl.enable(gl.SCISSOR_TEST); contextShadow.key=key; contextShadow.imported=state.imported;
}
let contextSky=null;
function drawContextSky(cam){
  if(state.sceneStyle!=='context' || cam.half) return;
  if(!contextSky){
    const vs=`#version 300 es\nprecision highp float; out vec2 uv; void main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));uv=p;gl_Position=vec4(p*2.0-1.0,1.0,1.0);}`;
    const fs=`#version 300 es\nprecision highp float; in vec2 uv; uniform mat4 invVP; uniform vec3 eye; out vec4 outColor;
      float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
      void main(){vec4 p=invVP*vec4(uv*2.0-1.0,1.0,1.0);vec3 ray=normalize(p.xyz/p.w-eye);
        float up=max(ray.z,0.0);vec3 c=mix(vec3(0.80,0.87,0.89),vec3(0.39,0.62,0.78),pow(up,0.48));
        vec2 q=ray.xy/max(ray.z+0.18,0.06)*1.4;float cloud=noise(q)*0.56+noise(q*2.13)*0.28+noise(q*4.27)*0.16;
        float veil=smoothstep(0.58,0.79,cloud)*smoothstep(0.02,0.24,ray.z)*0.42;c=mix(c,vec3(0.94,0.95,0.94),veil);
        float sun=max(dot(ray,normalize(vec3(-0.45,-0.35,0.82))),0.0);c+=vec3(1.0,0.83,0.57)*(pow(sun,28.0)*0.12+pow(sun,1400.0)*0.5);
        outColor=vec4(c,1.0);}`;
    const p=gl.createProgram(); gl.attachShader(p,compile(gl.VERTEX_SHADER,vs));gl.attachShader(p,compile(gl.FRAGMENT_SHADER,fs));gl.linkProgram(p);
    if(!gl.getProgramParameter(p,gl.LINK_STATUS)) throw new Error('Context sky: '+gl.getProgramInfoLog(p));
    contextSky={p,invVP:gl.getUniformLocation(p,'invVP'),eye:gl.getUniformLocation(p,'eye')};
  }
  gl.disable(gl.DEPTH_TEST);gl.depthMask(false);gl.disable(gl.BLEND);gl.useProgram(contextSky.p);
  gl.uniformMatrix4fv(contextSky.invVP,false,new Float32Array(invert(cam.vp)));gl.uniform3fv(contextSky.eye,cam.eye);gl.bindVertexArray(null);gl.drawArrays(gl.TRIANGLES,0,3);
}
let dyn = null;
function dynDraw(prog, mode, pos, idx, color, offset) {
  if(prog.u.uSurface) gl.uniform1f(prog.u.uSurface,color===C.proposal?5:0);
  if (!dyn) { dyn = { vao: gl.createVertexArray(), vb: gl.createBuffer(), ib: gl.createBuffer() }; gl.bindVertexArray(dyn.vao); gl.bindBuffer(gl.ARRAY_BUFFER, dyn.vb); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, dyn.ib); gl.bindVertexArray(null); }
  gl.bindVertexArray(dyn.vao); gl.bindBuffer(gl.ARRAY_BUFFER, dyn.vb); gl.bufferData(gl.ARRAY_BUFFER, pos, gl.DYNAMIC_DRAW); gl.uniform4fv(prog.u.uColor, color); gl.uniform3fv(prog.u.uOffset, offset || [0, 0, 0]);
  if (idx) { gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, dyn.ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.DYNAMIC_DRAW); gl.drawElements(mode, idx.length, gl.UNSIGNED_INT, 0); } else gl.drawArrays(mode, 0, pos.length / 3); gl.bindVertexArray(null);
}
function boxMesh(b) { const [x0, y0, z0, x1, y1, z1] = b; return { pos: new Float32Array([x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0, x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1]),
  idx: new Uint32Array([0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7]) }; }
function boxEdges(b) { const [x0, y0, z0, x1, y1, z1] = b; const p = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
  const e = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]]; const out = []; for (const [a, b2] of e) out.push(...p[a], ...p[b2]); return new Float32Array(out); }

function proposalEdgePositions(parts) {
  const lines = parts.map(part => part.edges || boxEdges(part.box));
  const result = new Float32Array(lines.reduce((sum, line) => sum + line.length, 0));
  let offset = 0;
  for (const line of lines) { result.set(line, offset); offset += line.length; }
  return result;
}
function drawProposalEdges(parts) {
  const positions = proposalEdgePositions(parts);
  if (positions.length) dynDraw(PL, gl.LINES, positions, null, C.proposalEdge);
}

// ------------------------------------------------------------------ state
const state = {
  step: 1, mode: 'overview', tool: 'site', sceneStyle:'collage',
  site: null, pmode: 'boxes', displayUnits: 'm',
  parts: [{ name: 'Tower', h: 120, w: 30, d: 30, dx: 0, dy: 0, rotation: 0 }],
  imported: null,             // {name, units_status, parts:[{name,bbox,gl}], bbox, placement}
  observer: null, observerSource: 'exploratory', eyeH: 1.6, fov: 60, wedge: true,
  viewpoint: null, showAllCones: false, showBackdrop: true,
  check: { bz: 120, unknown: true, reference: 'height', height: 120, area: 'footprint', custom: null, result: null, requestId: 0 },
  studyName: 'Untitled study', selected: null, boundary: [], drawing: null, removed: [], showExisting: false, multiSel: [], cleared: [], clearOverlaps: true,
  flow: { stage: 'site', methods: { site: null, build: null, view: null }, choosing: null, guided: false, alt: { find: null, place: null } },
  layers: { labels: true, roads: true, sources: false, extent: false, aerial: false },
  cams: { overview: { target: [0, 0, 20], dist: 6500, az: -1.15, el: 0.85 }, inspect: { dist: 400, az: -0.9, el: 0.35 }, observer: { yaw: 0, pitch: 0 } },
};
const assets = { ready: false, manifest: null, index: null, labels: [], meshes: {}, raw: {}, guideline: null, cones: null, geo: null, backdrop: null, extension: null, unified: null };
let needsRender = true; const requestRender = () => { needsRender = true; };
const waterSurface = WaterSurface.create(gl, {
  url: window.ProjectAPI.assetUrl('explorer/textures/ocean-normal-map-1k.png'),
  onReady: requestRender,
});
const grassSurface = WaterSurface.create(gl, {
  url: window.ProjectAPI.assetUrl('explorer/textures/grass-watercolour-v01.png'),
  unit: 5, neutralRGBA: [143,158,111,255], label: 'Grass texture',
  onReady: requestRender,
});
const facadeSurfaces = {
  mineral: WaterSurface.create(gl,{url:window.ProjectAPI.assetUrl('explorer/textures/concrete_wall_001_diff_1k.jpg'),unit:6,neutralRGBA:[224,225,219,255],label:'Facade concrete',onReady:requestRender}),
  brick: WaterSurface.create(gl,{url:window.ProjectAPI.assetUrl('explorer/textures/brick_wall_003_diffuse_1k.jpg'),unit:7,neutralRGBA:[198,175,154,255],label:'Facade masonry',onReady:requestRender}),
  whiteBrick: WaterSurface.create(gl,{url:window.ProjectAPI.assetUrl('explorer/textures/whitewashed_brick_diff_1k.jpg'),unit:8,neutralRGBA:[225,223,210,255],label:'Facade white brick',onReady:requestRender}),
};
const pavingSurfaces = {
  asphalt: WaterSurface.create(gl,{url:window.ProjectAPI.assetUrl('explorer/textures/asphalt-user-v01.png'),unit:9,neutralRGBA:[61,64,66,255],label:'Road asphalt',onReady:requestRender}),
  concrete: WaterSurface.create(gl,{url:window.ProjectAPI.assetUrl('explorer/textures/paving-concrete-user-v01.png'),unit:10,neutralRGBA:[219,219,214,255],label:'Ground paving',onReady:requestRender}),
};

// ------------------------------------------------------------------ loading
function fetchProgress(url, onProgress, attempt) { attempt = attempt || 1;
  return new Promise((resolve, reject) => { const xhr = new XMLHttpRequest(); xhr.open('GET', window.ProjectAPI.assetUrl(url), true); xhr.responseType = 'arraybuffer';
    xhr.onprogress = (ev) => { if (onProgress) onProgress(ev.loaded, ev.lengthComputable ? ev.total : 0); };
    xhr.onerror = () => { if (attempt < 3) resolve(fetchProgress(url, onProgress, attempt + 1)); else reject(new Error(url + ' -> network error after ' + attempt + ' attempts')); };
    xhr.onload = () => { if (xhr.status >= 200 && xhr.status < 300) resolve(new Uint8Array(xhr.response)); else reject(new Error(url + ' -> HTTP ' + xhr.status)); }; xhr.send(); });
}
function sliceMesh(bytes, spec) { const pos = new Float32Array(bytes.buffer, bytes.byteOffset + spec.positions.byte_offset, spec.positions.count * 3);
  const idx = spec.indices ? new Uint32Array(bytes.buffer, bytes.byteOffset + spec.indices.byte_offset, spec.indices.count) : null; return { pos, idx }; }
async function loadAssets() {
  const loading = $('loading'), text = $('loading-text'), bar = $('progress'); const step = (msg, frac) => { text.textContent = msg; bar.style.width = Math.round(frac * 100) + '%'; };
  step('Loading manifest…', 0.02); const ctx = await (await window.ProjectAPI.fetch('/api/context')).json();
  if (!ctx.available) throw new Error('Derived context assets are missing. Run: python3 tools/export_context_assets.py');
  const m = ctx.manifest; assets.manifest = m;
  const um = await window.ProjectAPI.fetch('/generated/unified_manifest.json');
  if (um.ok) assets.unified = await um.json();
  else if (um.status !== 404) throw new Error('Rebuilt context manifest could not be loaded (HTTP ' + um.status + ').');
  const active = assets.unified || m;
  step('Loading building index…', 0.05); assets.index = await (await window.ProjectAPI.fetch('/generated/' + active.buildings_index)).json(); assets.labels = await (await window.ProjectAPI.fetch('/generated/' + m.labels)).json();
  const order = ['terrain', 'water', 'parks', 'roads', 'shoreline', 'buildings'].filter(k => active.files[k]); const totalBytes = order.reduce((s, k) => s + active.files[k].byte_length, 0); let doneBytes = 0;
  for (const k of order) { const spec = active.files[k];
    const bytes = await fetchProgress('/generated/' + spec.file, (got) => step(`Loading ${spec.file}  ${((doneBytes + got) / 1048576).toFixed(1)} / ${(totalBytes / 1048576).toFixed(1)} MB`, 0.08 + 0.85 * (doneBytes + got) / totalBytes));
    doneBytes += spec.byte_length; if (bytes.length !== spec.byte_length) throw new Error(`${spec.file}: expected ${spec.byte_length} bytes, received ${bytes.length}`);
    const { pos, idx } = sliceMesh(bytes, spec); assets.raw[k] = { pos, idx }; if (k !== 'buildings') assets.meshes[k] = makeMesh(pos, idx); }
  const bb = assets.index.columns.bbox; const flat = new Float64Array(bb.length * 6); for (let i = 0; i < bb.length; i++) for (let k = 0; k < 6; k++) flat[i * 6 + k] = bb[i][k]; assets.bboxes = flat;
  step('Loading guideline text and view cones…', 0.95);
  try { assets.guideline = await (await window.ProjectAPI.fetch('/api/guideline')).json(); } catch (e) { assets.guideline = null; }
  try { assets.cones = await (await window.ProjectAPI.fetch('/api/viewcones')).json(); } catch (e) { assets.cones = { available: false, cones: [] }; }
  try { assets.geo = await (await window.ProjectAPI.fetch('/api/geo')).json(); } catch (e) { assets.geo = null; }
  try { const bm = await window.ProjectAPI.fetch('/generated/backdrop_manifest.json'); if (bm.ok) { const man = await bm.json(); const spec = assets.unified?.files.backdrop || man.files.backdrop; const bytes = await fetchProgress('/generated/' + spec.file); const { pos, idx } = sliceMesh(bytes, spec); assets.raw.backdrop = { pos, idx }; assets.meshes.backdrop = makeMesh(pos, idx); assets.backdrop = man; $('chip-backdrop').classList.remove('hidden'); } } catch (e) { assets.backdrop = null; }
  try { const em = await window.ProjectAPI.fetch('/generated/extension_manifest.json'); if (em.ok) { const man = await em.json(); step('Loading context extension (OSM + SRTM)…', 0.97);
      for (const k of (assets.unified ? ['buildings'] : ['terrain', 'water', 'parks', 'buildings'])) { const spec = assets.unified ? assets.unified.files.ext_buildings : man.files[k]; if (!spec || !spec.positions.count) continue; const bytes = await fetchProgress('/generated/' + spec.file, (got) => step(`Loading ${spec.file}  ${(got / 1048576).toFixed(1)} MB`, 0.97)); if (bytes.length !== spec.byte_length) throw new Error(spec.file + ': incomplete asset'); const { pos, idx } = sliceMesh(bytes, spec); assets.raw['ext_' + k] = { pos, idx }; if (k !== 'buildings') assets.meshes['ext_' + k] = makeMesh(pos, idx); }
      const rs = assets.unified ? null : man.files.roads; if (rs && rs.positions.count) { const bytes = await fetchProgress('/generated/' + rs.file); assets.meshes.ext_roads = makeMesh(new Float32Array(bytes.buffer, bytes.byteOffset, rs.positions.count * 3), null); }
      assets.extIndex = await (await window.ProjectAPI.fetch('/generated/' + (assets.unified ? assets.unified.ext_buildings_index : man.buildings_index))).json(); assets.extLabels = await (await window.ProjectAPI.fetch('/generated/' + man.labels)).json();
      const eb = assets.extIndex.columns.bbox; const ef = new Float64Array(eb.length * 6); for (let i = 0; i < eb.length; i++) for (let k = 0; k < 6; k++) ef[i * 6 + k] = eb[i][k]; assets.extBboxes = ef;
      const te = man.target_extent_model_m; assets.extExtentLines = new Float32Array([te[0], te[1], 1, te[2], te[1], 1, te[2], te[1], 1, te[2], te[3], 1, te[2], te[3], 1, te[0], te[3], 1, te[0], te[3], 1, te[0], te[1], 1]);
      assets.extension = man; $('chip-extension').classList.remove('hidden'); } else if (assets.unified) throw new Error('Building provenance manifest missing'); } catch (e) { if (assets.unified) throw e; assets.extension = null; showError('Context extension could not be loaded: ' + (e && e.message || e)); }
  prepareBuildingDisplay();
  step('Fitting windows to downtown wall boundaries…',0.98);await new Promise(resolve=>setTimeout(resolve,0));
  await prepareBuildingMaterials('buildings',assets.index);
  step('Fitting windows to surrounding wall boundaries…',0.99);await new Promise(resolve=>setTimeout(resolve,0));
  await prepareBuildingMaterials('ext_buildings',assets.extIndex);
  try {const response=await window.ProjectAPI.fetch('/generated/streetscape_roads.json');assets.streetHints=response.ok?await response.json():null;}catch(_){assets.streetHints=null;}
  try{
    const response=await window.ProjectAPI.fetch('/generated/street_network.json'),network=response.ok?await response.json():null;
    if(network?.schema==='vista-street-network/1'&&Array.isArray(network.positions)&&network.positions.length===network.segment_flags?.length*6&&network.positions.every(Number.isFinite)){
      const positions=[],rows=[];
      for(const way of network.ways||[]){
        const tags=way.tags||{},lanes=parseFloat(tags.lanes),fallback=/primary|secondary|tertiary/.test(way.highway)?2:way.highway==='service'||way.highway==='pedestrian'?1:2;
        const width=clamp((Number.isFinite(lanes)?lanes:fallback)*3.1+1,4,20),walkable=way.highway==='pedestrian'||way.highway==='service';
        const general=tags['sidewalk:both']||tags.sidewalk,left=tags['sidewalk:left']||general,right=tags['sidewalk:right']||general;
        const side=(value,direction)=>value?!['no','none'].includes(value)&&value!==(direction==='left'?'right':'left'):!walkable;
        for(let i=way.start;i<way.start+way.count;i++){
          if(network.segment_flags[i]!==0||/^(motorway|trunk)(_link)?$/.test(way.highway))continue;const p=network.positions.slice(i*6,i*6+6);positions.push(...p);
          rows.push([p[0],p[1],p[3],p[4],width,side(left,'left'),side(right,'right'),false,false,way.name,String(way.id)]);
        }
      }
      if(positions.length){assets.streetRoads=new Float32Array(positions);assets.streetNetwork=network;assets.streetHints={...assets.streetHints,segments:rows};}
    }
  }catch(_){assets.streetNetwork=null;}
  assets.ready = true; prepareStreetQueries(); loading.classList.add('hidden');
  if (assets.unified) {
    for (const label of [...assets.labels, ...(assets.extLabels || [])]) { const g = groundZAt(label.x, label.y); if (g) label.z = g.z; }
    $('chip-terrain').textContent = 'Terrain: rebuilt · approximate';
    $('chip-terrain').title = 'One SRTM surface across the study area, clipped to mapped OSM coastlines and inland water. Approximate elevations; not survey-verified.';
    $('chip-extension').textContent = 'Unified ground + water';
    $('chip-extension').title = 'Original and extension buildings keep their footprints and heights; placement follows changes in ground elevation, preserving elevated building parts. Original source files are preserved.';
  }
  assets.places = [...assets.labels, ...(assets.extLabels || [])].sort((a,b)=>a.text.localeCompare(b.text));
  // Water bodies are listed separately: a label over water whose name is a water feature (inlet, bay, creek, lagoon…).
  const groups = [['Neighbourhoods and places', true], ['Water bodies', false]].map(([label, onLand]) => { const g = document.createElement('optgroup'); g.label = label; g.dataset.land = onLand; return g; });
  for (const [i,place] of assets.places.entries()) { const option=document.createElement('option'); option.value=i; option.textContent=place.text; groups[landZAt(place.x, place.y) === null && /\b(Inlet|Bay|Creek|Lagoon|Lake|River|Sound|Arm|Narrows)\b/.test(place.text) ? 1 : 0].appendChild(option); }
  for (const g of groups) if (g.children.length) $('place-select').appendChild(g);
  const c = m.counts, e = m.extent_m.scene_bbox;
  $('status-coverage').textContent = `Coverage: full supplied model — ${c.buildings.toLocaleString()} buildings (${c.building_triangles.toLocaleString()} triangles), ${c.terrain_meshes} terrain meshes, water, parks, ${c.road_segments.toLocaleString()} road segments, ${c.labels} place labels; extent x ${Math.round(e[0]).toLocaleString()}…${Math.round(e[3]).toLocaleString()} m, y ${Math.round(e[1]).toLocaleString()}…${Math.round(e[4]).toLocaleString()} m (model metres, no transform). Source ${m.source.filename}, sha256 ${m.source.sha256.slice(0, 12)}…, ${m.source.model_units}. View cones: ${assets.cones && assets.cones.available ? assets.cones.cones.length + ' City open-data polygons (' + assets.cones.cones.filter((k) => k.origin_inside_model_extent).length + ' origins inside the model)' : 'not loaded'}.`;
  assets.extentLines = new Float32Array([e[0], e[1], 1, e[3], e[1], 1, e[3], e[1], 1, e[3], e[4], 1, e[3], e[4], 1, e[0], e[4], 1, e[0], e[4], 1, e[0], e[1], 1]);
  if (assets.extension) { const x = assets.extension.counts; $('status-coverage').textContent += ` Extension outside the supplied model: ${x.buildings.toLocaleString()} OSM buildings (current data, © OpenStreetMap contributors, ODbL) on SRTM terrain, ${x.water_polygons} water and ${x.park_polygons} park polygons, ${x.road_segments.toLocaleString()} road segments; covers all 24 view origins; source tint available in Layers; heights and elevations unverified.`; }
  if (assets.unified) { $('status-coverage').textContent = `Rebuilt context: one continuous SRTM terrain across the study area, mapped OSM coastline and inland water (© OpenStreetMap contributors, ODbL). ${(assets.index.count + (assets.extIndex?.count || 0)).toLocaleString()} source building shapes; supported elevated parts retained and placement adjusted to the new ground. Original Rhino file preserved. Terrain resolution approximately 60 m; elevations and building heights unverified. View cones: ${assets.cones?.cones?.length || 0} plan polygons, height limits unknown.`; }
  if (assets.modelCleanup?.count) $('status-coverage').textContent += ` Display cleanup: ${assets.modelCleanup.count} small unsupported source fragments hidden; original model files preserved.`;
  if (!(assets.cones && assets.cones.available)) $('chip-cones').textContent = 'View cones: dataset not loaded';
  if (!assets.backdrop) $('chk-backdrop').disabled = true;
}

// ------------------------------------------------------------------ picking
function rayTri(o, d, P, a, b, c) { const ax = P[a], ay = P[a + 1], az = P[a + 2]; const e1x = P[b] - ax, e1y = P[b + 1] - ay, e1z = P[b + 2] - az, e2x = P[c] - ax, e2y = P[c + 1] - ay, e2z = P[c + 2] - az;
  const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x; const det = e1x * px + e1y * py + e1z * pz; if (Math.abs(det) < 1e-14) return -1;
  const inv = 1 / det, tx = o[0] - ax, ty = o[1] - ay, tz = o[2] - az; const u = (tx * px + ty * py + tz * pz) * inv; if (u < 0 || u > 1) return -1;
  const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x; const v = (d[0] * qx + d[1] * qy + d[2] * qz) * inv; if (v < 0 || u + v > 1) return -1;
  const t = (e2x * qx + e2y * qy + e2z * qz) * inv; return t > 1e-6 ? t : -1; }
function rayMesh(o, d, raw, start, count) { const P = raw.pos, I = raw.idx; let best = Infinity; const end = start + count; for (let i = start; i < end; i += 3) { const t = rayTri(o, d, P, I[i] * 3, I[i + 1] * 3, I[i + 2] * 3); if (t > 0 && t < best) best = t; } return best; }
// Roof locations come from the actual indexed triangles, never a building's bounding box.
// Both winding directions occur in source geometry, so use the absolute normal's Z share.
function roofZAt(index, ext, x, y) {
  const catalogue = ext ? assets.extIndex : assets.index, raw = assets.raw[ext ? 'ext_buildings' : 'buildings'];
  if (!assets.ready || !catalogue || !raw || !Number.isInteger(index) || index < 0 || index >= catalogue.columns.index_offset.length || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  const b = catalogue.columns.bbox[index]; if (x < b[0] - 1e-4 || x > b[3] + 1e-4 || y < b[1] - 1e-4 || y > b[4] + 1e-4) return null;
  const P = raw.pos, I = raw.idx, start = catalogue.columns.index_offset[index], end = start + catalogue.columns.index_count[index];
  const origin = [x, y, Math.max(10000, b[5] + 100)], down = [0, 0, -1]; let best = Infinity, triangle = -1;
  for (let i = start; i < end; i += 3) {
    const a = I[i] * 3, bb = I[i + 1] * 3, c = I[i + 2] * 3;
    const ux = P[bb] - P[a], uy = P[bb + 1] - P[a], uz = P[bb + 2] - P[a];
    const vx = P[c] - P[a], vy = P[c + 1] - P[a], vz = P[c + 2] - P[a];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (Math.abs(nz) < 0.35 * Math.hypot(nx, ny, nz)) continue;
    const t = rayTri(origin, down, P, a, bb, c); if (t > 0 && t < best) { best = t; triangle = i; }
  }
  return triangle < 0 ? null : { z: origin[2] - best, triangle };
}
function highestRoofAtXY(x, y) {
  if (!assets.ready || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  let best = null;
  for (const ext of [false, true]) {
    const c = (ext ? assets.extIndex : assets.index)?.columns; if (!c) continue;
    for (let i = 0; i < c.index_offset.length; i++) {
      if (isRemoved(i, ext) && !state.showExisting) continue;
      const b = c.bbox[i]; if (x < b[0] || x > b[3] || y < b[1] || y > b[4] || (best && b[5] < best.z - 0.2)) continue;
      const roof = roofZAt(i, ext, x, y); if (roof && (!best || roof.z > best.z)) best = { index: i, ext, z: roof.z };
    }
  }
  return best;
}
function preferredRoofPoint(index, ext) {
  const catalogue = ext ? assets.extIndex : assets.index, raw = assets.raw[ext ? 'ext_buildings' : 'buildings']; if (!assets.ready || !catalogue || !raw || index < 0 || index >= catalogue.columns.index_offset.length) return null;
  const P = raw.pos, I = raw.idx, c = catalogue.columns, b = c.bbox[index], cx = (b[0] + b[3]) / 2, cy = (b[1] + b[4]) / 2;
  // Prefer a high, broad surface near the centre. Centroids also work on concave footprints.
  const candidates = [];
  for (let i = c.index_offset[index], end = i + c.index_count[index]; i < end; i += 3) {
    const a = I[i] * 3, bb = I[i + 1] * 3, d = I[i + 2] * 3;
    const ux = P[bb] - P[a], uy = P[bb + 1] - P[a], uz = P[bb + 2] - P[a], vx = P[d] - P[a], vy = P[d + 1] - P[a], vz = P[d + 2] - P[a];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, area = Math.abs(nz) / 2;
    if (area < 0.1 || Math.abs(nz) < 0.35 * Math.hypot(nx, ny, nz)) continue;
    const x = (P[a] + P[bb] + P[d]) / 3, y = (P[a + 1] + P[bb + 1] + P[d + 1]) / 3, z = (P[a + 2] + P[bb + 2] + P[d + 2]) / 3;
    const visible = roofZAt(index, ext, x, y); if (!visible || Math.abs(visible.z - z) > 0.2) continue;
    const s = z + Math.min(area, 250) * 0.02 - Math.hypot(x - cx, y - cy) * 0.005;
    candidates.push({ x, y, z: visible.z, score: s });
  }
  candidates.sort((a, b) => b.score - a.score);
  for (const q of candidates.slice(0, 12)) { const highest = highestRoofAtXY(q.x, q.y); if (highest && highest.index === index && highest.ext === ext && Math.abs(highest.z - q.z) < 0.2) return { x: q.x, y: q.y, z: q.z }; }
  return null;
}
function rayAABB(o, d, B, off) { let tmin = -Infinity, tmax = Infinity; for (let k = 0; k < 3; k++) { const inv = 1 / (d[k] || 1e-12); let t0 = (B[off + k] - o[k]) * inv, t1 = (B[off + 3 + k] - o[k]) * inv; if (t0 > t1) { const s = t0; t0 = t1; t1 = s; } tmin = Math.max(tmin, t0); tmax = Math.min(tmax, t1); if (tmax < tmin) return -1; } return tmax < 0 ? -1 : Math.max(tmin, 0); }
function pickRay(o, d) {
  if (!assets.ready) return { type: 'none' };
  let tT = rayMesh(o, d, assets.raw.terrain, 0, assets.raw.terrain.idx.length), tW = rayMesh(o, d, assets.raw.water, 0, assets.raw.water.idx.length);
  if (assets.raw.ext_terrain) tT = Math.min(tT, rayMesh(o, d, assets.raw.ext_terrain, 0, assets.raw.ext_terrain.idx.length)); if (assets.raw.ext_water) tW = Math.min(tW, rayMesh(o, d, assets.raw.ext_water, 0, assets.raw.ext_water.idx.length));
  let tB = Infinity, hitB = -1, ext = false; const B = assets.bboxes, cols = assets.index.columns;
  for (let i = 0; i < cols.index_offset.length; i++) { if (!imagineCityOpen() && isRemoved(i, false) && !state.showExisting) continue; const city=imagineCityScene?.assets.buildings,base=city?.bases[i],scale=city?.scales[i],bounds=city?ImagineCityRender.transformedBounds(cols.bbox[i],base,scale):null; if(city&&scale<=0)continue;const tb = rayAABB(o, d, bounds||B, bounds?0:i*6); if (tb < 0 || tb > tB) continue; const inverse=city?ImagineCityRender.inverseRay(o,d,base,scale):null;const t = rayMesh(inverse?.o||o, inverse?.d||d, assets.raw.buildings, cols.index_offset[i], cols.index_count[i]); if (t < tB) { tB = t; hitB = i; } }
  if (assets.extIndex) { const EB = assets.extBboxes, ec = assets.extIndex.columns; for (let i = 0; i < ec.index_offset.length; i++) { if (!imagineCityOpen() && isRemoved(i, true) && !state.showExisting) continue;const city=imagineCityScene?.assets.ext_buildings,base=city?.bases[i],scale=city?.scales[i],bounds=city?ImagineCityRender.transformedBounds(ec.bbox[i],base,scale):null;if(city&&scale<=0)continue; const tb = rayAABB(o, d, bounds||EB, bounds?0:i*6); if (tb < 0 || tb > tB) continue; const inverse=city?ImagineCityRender.inverseRay(o,d,base,scale):null;const t = rayMesh(inverse?.o||o, inverse?.d||d, assets.raw.ext_buildings, ec.index_offset[i], ec.index_count[i]); if (t < tB) { tB = t; hitB = i; ext = true; } } }
  const best = Math.min(tT, tW, tB); if (!isFinite(best)) return { type: 'none' }; const p = V.add(o, V.scale(d, best));
  if (best === tB) return { type: 'building', index: hitB, ext, point: p, t: best }; if (best === tW || waterZAt(p[0],p[1]) !== null) return { type: 'water', point: p, t: best }; return { type: 'terrain', point: p, t: best };
}
function terrainZAt(x, y) { if (!assets.ready) return null; let t = rayMesh([x, y, 10000], [0, 0, -1], assets.raw.terrain, 0, assets.raw.terrain.idx.length);
  if (!isFinite(t) && assets.raw.ext_terrain) t = rayMesh([x, y, 10000], [0, 0, -1], assets.raw.ext_terrain, 0, assets.raw.ext_terrain.idx.length); return isFinite(t) ? 10000 - t : null; }
function waterZAt(x,y) { if (!assets.ready) return null; for (const key of ['water','ext_water']) { const raw=assets.raw[key]; if (!raw) continue; const t=rayMesh([x,y,10000],[0,0,-1],raw,0,raw.idx.length); if (isFinite(t)) return 10000-t; } return null; }
function landZAt(x,y) { return waterZAt(x,y) === null ? terrainZAt(x,y) : null; }
function groundZAt(x, y) { // where an observer can stand: terrain first, else the water surface (piers and decks are not modelled)
  const zt = terrainZAt(x, y); if (zt !== null) return { z: zt, source: 'terrain' }; if (!assets.ready) return null;
  for (const key of ['water', 'ext_water']) { const raw = assets.raw[key]; if (!raw) continue; const t = rayMesh([x, y, 10000], [0, 0, -1], raw, 0, raw.idx.length); if (isFinite(t)) return { z: 10000 - t, source: 'water' }; }
  return null; }
function rayFromClient(cx, cy, cam) { const r = canvas.getBoundingClientRect(); const nx = ((cx - r.left) / r.width) * 2 - 1, ny = 1 - ((cy - r.top) / r.height) * 2; const inv = invert(cam.vp); if (!inv) return null;
  const a = project(inv, [nx, ny, -1]), b = project(inv, [nx, ny, 1]); const o = [a[0], a[1], a[2]]; return { o, d: V.norm(V.sub([b[0], b[1], b[2]], o)) }; }

// ------------------------------------------------------------------ proposal geometry (boxes or import)
function importOffset() { const im = state.imported; if (!im) return null; if (im.placement === 'file' || !state.site) return im.placement === 'file' ? [0, 0, 0] : null;
  const b = im.bbox; const cx = (b[0] + b[3]) / 2, cy = (b[1] + b[4]) / 2; const gz = baseZAt(state.site.x, state.site.y); if (gz === null) return null; return [state.site.x - cx, state.site.y - cy, gz - b[2]]; }
// Imported and block proposals share the same ground query. Readiness and source
// identities invalidate cached nulls as well as heights after context replacement.
const baseMemo = { x: NaN, y: NaN, z: null, ready: null, terrain: null, extension: null };
function baseZAt(x, y) {
  const ready = !!assets.ready, terrain = assets.raw?.terrain, extension = assets.raw?.ext_terrain;
  if (x !== baseMemo.x || y !== baseMemo.y || ready !== baseMemo.ready || terrain !== baseMemo.terrain || extension !== baseMemo.extension) {
    baseMemo.x = x; baseMemo.y = y; baseMemo.ready = ready; baseMemo.terrain = terrain; baseMemo.extension = extension;
    baseMemo.z = terrainZAt(x, y);
  }
  return baseMemo.z;
}
function proposalParts() { // [{name, box:[xmin,ymin,zmin,xmax,ymax,zmax]}] in model coordinates, or []
  if (state.pmode === 'import') { const im = state.imported; const off = importOffset(); if (!im || !off) return [];
    return im.parts.map((p) => ({ name: p.name, box: [p.bbox[0] + off[0], p.bbox[1] + off[1], p.bbox[2] + off[2], p.bbox[3] + off[0], p.bbox[4] + off[1], p.bbox[5] + off[2]] })); }
  if (!state.site || !state.parts.length) return []; const out = []; let base = null;
  for (const p of state.parts) { const cx = state.site.x + p.dx, cy = state.site.y + p.dy; if (base === null) { base = baseZAt(cx, cy); if (base === null) return []; }
    out.push(ProposalGeometry.makePart({ name: p.name, cx, cy, zMin: base, zMax: base+p.h, w: p.w, d: p.d, rotation: p.rotation || 0 })); base += p.h; }
  return out;
}
function proposalBox() { const parts = proposalParts(); if (!parts.length) return null; const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (const p of parts) for (let k = 0; k < 3; k++) { b[k] = Math.min(b[k], p.box[k]); b[k + 3] = Math.max(b[k + 3], p.box[k + 3]); }
  return { cx: (b[0] + b[3]) / 2, cy: (b[1] + b[4]) / 2, base: b[2], top: b[5], box: b, parts }; }
// The proposal is hidden in the existing comparison, and in the guided flow until a build method is chosen. Captures may override.
function proposalShown() { if (state.hideProposal != null) return !state.hideProposal; return !((state.showExisting && state.removed.length) || (state.flow.guided && !state.flow.methods.build)); }
function proposalCentre() { const p = proposalBox(); return p ? [p.cx, p.cy, (p.base + p.top) / 2] : null; }
function observerEye() { return state.observer ? [state.observer.x, state.observer.y, state.observer.z + state.eyeH] : null; }
function evaluationArea() { const P = proposalBox(); if (state.check.area === 'custom' && state.check.custom) return state.check.custom; if (!P) return null; return { x_min: P.box[0], x_max: P.box[3], y_min: P.box[1], y_max: P.box[4] }; }

// ------------------------------------------------------------------ cameras
function orbitEye(target, o) { return V.add(target, V.scale([Math.cos(o.el) * Math.cos(o.az), Math.cos(o.el) * Math.sin(o.az), Math.sin(o.el)], o.dist)); }
function observerForward() { const o = state.cams.observer; return [Math.cos(o.pitch) * Math.cos(o.yaw), Math.cos(o.pitch) * Math.sin(o.yaw), Math.sin(o.pitch)]; }
function computeCamera(mode, aspect) { let eye, target, fovy, near, far;
  if (mode === 'plan') { const o = state.cams.overview, half = o.dist * Math.tan(Math.PI / 8); target = o.target; eye = [target[0], target[1], 12000]; const view = lookAt(eye, [target[0], target[1], 0], [0, 1, 0]); const proj = ortho(-half * aspect, half * aspect, -half, half, 1, 40000); return { eye, target, view, proj, vp: mul(proj, view), aspect, half, fogFar: 1e9 }; }
  if (mode === 'observer' && state.observer) { eye = observerEye(); target = V.add(eye, observerForward()); fovy = state.fov * Math.PI / 180; near = 0.5; far = 45000; }
  else if (mode === 'inspect' && proposalBox()) { const o = state.cams.inspect; target = proposalCentre(); eye = orbitEye(target, o); fovy = 45 * Math.PI / 180; near = Math.max(0.5, o.dist * 0.01); far = 20000; }
  else { const o = state.cams.overview; target = o.target; eye = orbitEye(target, o); fovy = 45 * Math.PI / 180; near = Math.max(1, o.dist * 0.005); far = 40000; }
  const view = lookAt(eye, target, [0, 0, 1]); const proj = perspective(fovy, aspect, near, far);
  return { eye, target, fovy, near, far, view, proj, vp: mul(proj, view), aspect, fogFar: mode === 'observer' ? 9000 : Math.max(4000, V.len(V.sub(eye, target)) * 3) }; }
let lastCam = null;

// ------------------------------------------------------------------ rendering
function setCommon(prog, cam) { gl.useProgram(prog.p);
  if(prog.u.uPavingTextureOn){
    const entries=[['asphalt','uAsphaltTex',9],['concrete','uPavingTex',10]];
    for(const [key,uniform,unit] of entries){gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,pavingSurfaces[key].texture);gl.uniform1i(prog.u[uniform],unit);}
    gl.uniform2fv(prog.u.uPavingTextureOn,entries.map(([key])=>pavingSurfaces[key].loaded?1:0));gl.activeTexture(gl.TEXTURE0);
  }
  if(prog.u.uWaterNormal){
    gl.activeTexture(gl.TEXTURE4);gl.bindTexture(gl.TEXTURE_2D,waterSurface.texture);
    gl.uniform1i(prog.u.uWaterNormal,4);gl.uniform1f(prog.u.uWaterTextureOn,waterSurface.loaded?1:0);
    gl.activeTexture(gl.TEXTURE0);
  }
  if(prog.u.uGrassTex){
    gl.activeTexture(gl.TEXTURE5);gl.bindTexture(gl.TEXTURE_2D,grassSurface.texture);
    gl.uniform1i(prog.u.uGrassTex,5);gl.uniform1f(prog.u.uGrassTextureOn,grassSurface.loaded?1:0);
    gl.activeTexture(gl.TEXTURE0);
  }
  if(prog.u.uFacadeTextureOn){
    const entries=[['mineral','uFacadeMineral',6],['brick','uFacadeBrick',7],['whiteBrick','uFacadeWhiteBrick',8]];
    for(const [key,uniform,unit] of entries){gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,facadeSurfaces[key].texture);gl.uniform1i(prog.u[uniform],unit);}
    gl.uniform3fv(prog.u.uFacadeTextureOn,entries.map(([key])=>facadeSurfaces[key].loaded?1:0));gl.activeTexture(gl.TEXTURE0);
  } if(prog.u.uTrafficOn){const on=state.sceneStyle==='context'&&state.layers.roads&&trafficTextures.global&&trafficTextures.local;gl.uniform1f(prog.u.uTrafficOn,on?1:0);if(on){for(const [unit,tex,name,mapName] of [[2,trafficTextures.global,'uTrafficTex','uTrafficMap'],[3,trafficTextures.local,'uTrafficDetailTex','uTrafficDetailMap']]){gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,tex.texture);gl.uniform1i(prog.u[name],unit);gl.uniform4fv(prog.u[mapName],tex.map);}gl.activeTexture(gl.TEXTURE0);}} if (prog.u.uAerialOn) { const on = state.layers.aerial && aerial.tex; gl.uniform1f(prog.u.uAerialOn, on ? 1 : 0); if (on) { gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, aerial.tex); gl.uniform1i(prog.u.uAerialTex, 0); gl.uniform4fv(prog.u.uAerialMap, aerial.map); } } if(prog.u.uSceneStyle) gl.uniform1f(prog.u.uSceneStyle,SCENE_STYLES[state.sceneStyle].shader); if(prog.u.uImagineCity) gl.uniform1f(prog.u.uImagineCity,0); if(prog.u.uSurface) gl.uniform1f(prog.u.uSurface,0); if (prog.u.uStudyActive) gl.uniform1f(prog.u.uStudyActive, 0); gl.uniformMatrix4fv(prog.u.uVP, false, new Float32Array(cam.vp)); gl.uniform3fv(prog.u.uCamPos, cam.eye); gl.uniform3fv(prog.u.uFog, BG); gl.uniform1f(prog.u.uFogFar, cam.fogFar); if (prog.u.uLightMix) gl.uniform1f(prog.u.uLightMix, 1.0); gl.uniform3fv(prog.u.uOffset, [0, 0, 0]);
  if(prog.u.uShadowOn){const on=state.sceneStyle==='context' && contextShadow.tex && contextShadow.vp;gl.uniform1f(prog.u.uShadowOn,on?1:0);if(on){gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,contextShadow.tex);gl.uniform1i(prog.u.uShadowTex,1);gl.uniformMatrix4fv(prog.u.uShadowVP,false,new Float32Array(contextShadow.vp));gl.uniform1f(prog.u.uShadowTexel,1/contextShadow.size);gl.activeTexture(gl.TEXTURE0);}}
}
let imagineCityScene=null,imagineCityUploads=0,imagineCityBytes=0,imaginePickIndex=null,imagineOcclusionIndex=null;
const imaginePickMetrics={buildMs:0,occlusionBuildMs:0,lastPickMs:0};
function imagineCityOpen(){return document.body.classList.contains('imagine-city-open');}
function setImagineCityScene(scene){
  if(scene?.assets!==imagineCityScene?.assets){imaginePickIndex=null;window.VistaImagineHover?.clear();}
  if(!scene)imagineOcclusionIndex=null;
  if(scene){
    if(imagineCityScene?.assets===scene.assets&&imagineCityScene?.dataset===scene.dataset){imagineCityScene=scene;window.VistaViewcone?.refresh();requestRender();return true;}
    if(!window.ImagineCityEngine.matchesManifest(scene.dataset,assets.unified))throw new Error('Imagine references belong to another city model. Rebuild the prepared data.');
    for(const key of ['buildings','ext_buildings']){
      const data=scene.dataset?.assets?.[key],result=scene.assets?.[key],catalogue=(key==='buildings'?assets.index:assets.extIndex),mesh=assets.meshes[key];
      if(!catalogue)continue;
      if(!data||!result||!mesh?.renderIndex||data.count!==catalogue.count||data.osmIds.length!==catalogue.columns.osm_id.length||data.osmIds.some((v,i)=>v!==catalogue.columns.osm_id[i]))throw new Error('Imagine data does not match the active city model.');
    }
    const pending=[];
    for(const key of ['buildings','ext_buildings']){
      const mesh=assets.meshes[key],catalogue=key==='buildings'?assets.index:assets.extIndex;if(!mesh||!catalogue)continue;
      const values=window.ImagineCityRender.buildAttributes(catalogue,mesh.renderIndex,mesh.vertexCount,scene.assets[key]);
      pending.push({mesh,values});
    }
    // Reuse a single small attribute buffer per asset for every scenario. The
    // original position/material buffers are shared with the normal city view.
    imagineCityBytes=0;
    try{for(const {mesh,values} of pending){
      mesh.imagineBuffer ||= gl.createBuffer();if(!mesh.imagineBuffer)throw new Error('Imagine display memory is unavailable.');
      gl.bindVertexArray(mesh.vao);gl.bindBuffer(gl.ARRAY_BUFFER,mesh.imagineBuffer);gl.bufferData(gl.ARRAY_BUFFER,values,gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(4);gl.vertexAttribPointer(4,2,gl.FLOAT,false,0,0);imagineCityBytes+=values.byteLength;
    }}finally{gl.bindVertexArray(null);}
    imagineCityUploads++;imagineCityScene=scene;
  }else{
    imagineCityScene=null;imagineCityBytes=0;
    for(const key of ['buildings','ext_buildings']){const mesh=assets.meshes[key];if(!mesh?.imagineBuffer)continue;gl.bindVertexArray(mesh.vao);gl.disableVertexAttribArray(4);gl.deleteBuffer(mesh.imagineBuffer);mesh.imagineBuffer=null;}gl.bindVertexArray(null);
  }
  contextShadow.key=null;panelToggleLabel();window.VistaViewcone?.refresh();requestRender();return true;
}
function pickImagineBuildingAt(cx,cy){
  if(!imagineCityOpen()||!imagineCityScene||!assets.ready||!lastCam||needsRender)return null;
  const rect=canvas.getBoundingClientRect();if(cx<rect.left||cy<rect.top||cx>rect.right||cy>rect.bottom)return null;
  const ray=rayFromClient(cx,cy,lastCam);if(!ray)return null;
  if(!imaginePickIndex){
    const started=performance.now();
    imaginePickIndex=ImagineCityRender.createPickIndex([{asset:'buildings',columns:assets.index?.columns},{asset:'ext_buildings',columns:assets.extIndex?.columns}],imagineCityScene.assets);
    imaginePickMetrics.buildMs=performance.now()-started;
  }
  if(!imagineOcclusionIndex){
    const started=performance.now();
    imagineOcclusionIndex=ImagineCityRender.createOcclusionIndex(['terrain','ext_terrain','water','ext_water'].map(asset=>({asset,...assets.raw[asset]})));
    imaginePickMetrics.occlusionBuildMs=performance.now()-started;
  }
  const started=performance.now();
  const hit=imaginePickIndex.pick(ray.o,ray.d,(row)=>{
    const columns=(row.asset==='buildings'?assets.index:assets.extIndex).columns;
    const inverse=ImagineCityRender.inverseRay(ray.o,ray.d,row.base,row.scale);
    return rayMesh(inverse.o,inverse.d,assets.raw[row.asset],columns.index_offset[row.index],columns.index_count[row.index]);
  });
  // Terrain and water can obscure a distant building. Translucent view surfaces
  // deliberately do not block inspection of the city underneath them.
  const occluder=hit&&imagineOcclusionIndex.pick(ray.o,ray.d,row=>rayMesh(ray.o,ray.d,assets.raw[row.asset],row.start,row.count));
  const visible=hit&&(!occluder||occluder.t>=hit.t-1e-4);
  imaginePickMetrics.lastPickMs=performance.now()-started;
  return visible?{asset:hit.asset,index:hit.index}:null;
}
function drawStatic(prog, key, color, offset) { if(prog.u.uSurface) gl.uniform1f(prog.u.uSurface,({buildings:1,ext_buildings:1,terrain:2,ext_terrain:2,parks:3,ext_parks:3,water:4,ext_water:4,backdrop:6})[key] || 0); const m = assets.meshes[key]; if (!m) return;const cityBuilding=!!imagineCityScene&&/^(ext_)?buildings$/.test(key);if(prog.u.uImagineCity)gl.uniform1f(prog.u.uImagineCity,cityBuilding?1:0); gl.uniform4fv(prog.u.uColor, color); gl.uniform3fv(prog.u.uOffset, offset || [0, 0, 0]); gl.bindVertexArray(m.vao); if (m.indexed && /^(ext_)?buildings$/.test(key) && !imagineCityOpen() && (state.removed.length || state.cleared.length) && !state.showExisting) {
    const ext = key === 'ext_buildings', cols = (ext ? assets.extIndex : assets.index).columns;
    const hidden = [...new Set([...state.removed, ...state.cleared].filter(r => r.ext === ext).map(r => r.index))].sort((a,b) => cols.index_offset[a] - cols.index_offset[b]); let start = 0;
    for (const i of hidden) { const end = cols.index_offset[i]; if (end > start) gl.drawElements(gl.TRIANGLES, end - start, gl.UNSIGNED_INT, start * 4); start = end + cols.index_count[i]; }
    if (start < m.count) gl.drawElements(gl.TRIANGLES, m.count - start, gl.UNSIGNED_INT, start * 4);
  } else if (m.indexed) gl.drawElements(gl.TRIANGLES, m.count, gl.UNSIGNED_INT, 0); else gl.drawArrays(gl.LINES, 0, m.count); gl.bindVertexArray(null);if(prog.u.uImagineCity)gl.uniform1f(prog.u.uImagineCity,0); }
const CONE_TOP = 260;
function coneGeometry(c) { // vertical boundary walls from the apex to the far vertices + outline at the ground and the top
  const pts = c.polygon_model_xy; const n = pts.length; const ax = c.origin_model_xy[0], ay = c.origin_model_xy[1]; let ai = 0; for (let i = 0; i < n; i++) if (Math.abs(pts[i][0] - ax) < 0.01 && Math.abs(pts[i][1] - ay) < 0.01) ai = i;
  const prev = pts[(ai - 1 + n) % n], next = pts[(ai + 1) % n];
  const wall = new Float32Array([ax, ay, 0, prev[0], prev[1], 0, prev[0], prev[1], CONE_TOP, ax, ay, CONE_TOP, ax, ay, 0, next[0], next[1], 0, next[0], next[1], CONE_TOP, ax, ay, CONE_TOP]);
  const wallIdx = new Uint32Array([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
  const ground = [], top = []; for (let i = 0; i < n; i++) { const a = pts[i], b = pts[(i + 1) % n]; ground.push(a[0], a[1], 1, b[0], b[1], 1); top.push(a[0], a[1], CONE_TOP, b[0], b[1], CONE_TOP); } top.push(ax, ay, 0, ax, ay, CONE_TOP);
  return { wall, wallIdx, ground: new Float32Array(ground), top: new Float32Array(top) };
}
const trafficTextures={global:null,local:null};
let streetSurfaces=null,streetSurfaceKey='',globalTrafficSurfaces=null,globalTrafficKey='',streetSamplers=null,streetBoxQuery=null,streetHintMap=null,streetHintQuery=null;
function streetSegmentKey(ax,ay,bx,by){return [ax,ay,bx,by].map(v=>Math.round(v*5)).join(',');}
function prepareStreetQueries(){
  if(streetSamplers)return;
  const terrain=SurfaceQuery.createMeshSampler([assets.raw.terrain,assets.raw.ext_terrain].filter(Boolean),{cellSize:100});
  const water=SurfaceQuery.createMeshSampler([assets.raw.water,assets.raw.ext_water].filter(Boolean),{cellSize:150});
  const parks=SurfaceQuery.createMeshSampler([assets.raw.parks,assets.raw.ext_parks].filter(Boolean),{cellSize:100});
  const land=(x,y)=>water(x,y)===null?terrain(x,y):null;
  streetSamplers={terrain,land,surface:(x,y)=>{const z=land(x,y);if(z===null)return null;const p=parks(x,y);return p===null?z:Math.max(z,p);}};
  const boxes=[];for(const ext of [false,true]){const c=(ext?assets.extIndex:assets.index)?.columns;if(c)for(let index=0;index<c.bbox.length;index++)boxes.push({box:c.bbox[index],index,ext});}
  streetBoxQuery=SurfaceQuery.createBoxIndex(boxes,{cellSize:60});
  if(assets.streetRoads&&!assets.meshes.street_network){
    const lines=[];for(let i=0;i<assets.streetRoads.length;i+=6){const p=assets.streetRoads,az=streetSamplers.land(p[i],p[i+1]),bz=streetSamplers.land(p[i+3],p[i+4]);if(az!==null&&bz!==null)lines.push(p[i],p[i+1],az+0.18,p[i+3],p[i+4],bz+0.18);}
    assets.meshes.street_network=makeMesh(new Float32Array(lines),null);
  }
  streetHintMap=new Map();
  for(const row of assets.streetHints?.segments||[]){const [ax,ay,bx,by,width,leftSidewalk,rightSidewalk,,skip,name]=row;
    streetHintMap.set(streetSegmentKey(ax,ay,bx,by),{roadWidth:width,leftSidewalk,rightSidewalk,skip,name});
    streetHintMap.set(streetSegmentKey(bx,by,ax,ay),{roadWidth:width,leftSidewalk:rightSidewalk,rightSidewalk:leftSidewalk,skip,name});
  }
  streetHintQuery=SurfaceQuery.createBoxIndex((assets.streetHints?.segments||[]).map(row=>({row,box:[Math.min(row[0],row[2])-1,Math.min(row[1],row[3])-1,0,Math.max(row[0],row[2])+1,Math.max(row[1],row[3])+1,1]})),{cellSize:80});
}
function streetHintFor(ax,ay,bx,by){
  const key=streetSegmentKey(ax,ay,bx,by),exact=streetHintMap.get(key);if(exact)return exact;
  const mx=(ax+bx)/2,my=(ay+by)/2,dx=bx-ax,dy=by-ay,length=Math.hypot(dx,dy);
  for(const candidate of streetHintQuery(mx,my)){const [x0,y0,x1,y1,width,left,right,,skip,name]=candidate.row,vx=x1-x0,vy=y1-y0,len=Math.hypot(vx,vy);if(!len||!length)continue;
    const dot=(dx*vx+dy*vy)/(length*len);if(Math.abs(dot)<0.98)continue;
    const t=((mx-x0)*vx+(my-y0)*vy)/(len*len);if(t<0||t>1||Math.hypot(mx-x0-t*vx,my-y0-t*vy)>0.75)continue;
    const meta={roadWidth:width,leftSidewalk:dot>=0?left:right,rightSidewalk:dot>=0?right:left,skip,name};streetHintMap.set(key,meta);return meta;
  }
  return {};
}
function clearStreetSurfaces(){if(!streetSurfaces)return;for(const mesh of Object.values(streetSurfaces.meshes)){gl.deleteVertexArray(mesh.vao);gl.deleteBuffer(mesh.vb);gl.deleteBuffer(mesh.ib);}streetSurfaces=null;}
function uploadStreetMesh(data){const vao=gl.createVertexArray(),vb=gl.createBuffer(),ib=gl.createBuffer();gl.bindVertexArray(vao);gl.bindBuffer(gl.ARRAY_BUFFER,vb);gl.bufferData(gl.ARRAY_BUFFER,data.pos,gl.STATIC_DRAW);gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,3,gl.FLOAT,false,0,0);gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,ib);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,data.idx,gl.STATIC_DRAW);gl.bindVertexArray(null);return {vao,vb,ib,count:data.idx.length};}
function uploadTrafficTexture(traffic,bounds,detail,previous){
  const size=Math.min(4096,gl.getParameter(gl.MAX_TEXTURE_SIZE)),raster=document.createElement('canvas');raster.width=size;raster.height=size;
  const result=TrafficRaster.draw(raster.getContext('2d',{alpha:false}),traffic,{bounds,width:size,height:size,detail,sidewalkWidth:2.4,markings:false});
  const texture=previous?.texture||gl.createTexture();gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,texture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,raster);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.generateMipmap(gl.TEXTURE_2D);gl.activeTexture(gl.TEXTURE0);
  const [x0,y0,x1,y1]=bounds,map=[1/(x1-x0),-x0/(x1-x0),-1/(y1-y0),y1/(y1-y0)];
  raster.width=1;raster.height=1;
  return {texture,map,bounds,stats:result.stats,size};
}
function prepareStreetSurfaces(cam){
  if(state.sceneStyle!=='context'||!state.layers.roads)return;
  prepareStreetQueries();
  if(!assets.traffic&&assets.streetNetwork)assets.traffic=TrafficNetwork.create(assets.streetNetwork,{groundAt:streetSamplers.surface,terrainAt:streetSamplers.terrain});
  const traffic=assets.traffic;if(!traffic)return;
  const bounds=assets.streetNetwork.bounds_model_m,P=proposalShown()?proposalParts():[],sceneKey=JSON.stringify([state.removed,state.cleared,state.showExisting,proposalShown(),P.map(p=>[partFootprint(p),p.box])]);
  const groundAt=streetSamplers.surface;
  if(!trafficTextures.global)trafficTextures.global=uploadTrafficTexture(traffic,bounds,false,null);
  const deckRoads=traffic.deckRoads||new Float32Array();
  const occupied=(x,y,z,proposed)=>{
    if(proposed&&P.some(p=>p.box[2]<z+1&&p.box[5]>z+0.2&&SiteGeometry.pointInPolygon([x,y],partFootprint(p))))return true;
    for(const b of streetBoxQuery(x,y)){if((proposed&&isRemoved(b.index,b.ext)&&!state.showExisting)||b.box[2]>z+1)continue;const roof=roofZAt(b.index,b.ext,x,y);if(roof&&roof.z>z+0.4)return true;}return false;
  };
  if(!globalTrafficSurfaces){
    const geometry=Streetscape.generate({roads:[deckRoads],center:[0,0],bounds,groundAt,isOccupied:(x,y,z)=>occupied(x,y,z,false),maxSegments:8000,detailRadius:0,sidewalkWidth:0,markings:false,terrainTolerance:0.02,segmentOptions:traffic.segmentOptions});
    globalTrafficSurfaces={mesh:uploadStreetMesh(geometry.asphalt),stats:{...geometry.stats,groundMode:'terrain-material',groundSegments:trafficTextures.global.stats.roadSegments,bounds,coverageComplete:true}};globalTrafficKey='static';
  }
  const anchor=state.mode==='observer'&&state.observer?[state.observer.x,state.observer.y]:cam.target||state.cams.overview.target,center=anchor.slice(0,2).map(v=>Math.round(v/200)*200),detailBounds=[center[0]-600,center[1]-600,center[0]+600,center[1]+600],key=JSON.stringify([center,sceneKey]);
  if(key===streetSurfaceKey&&streetSurfaces)return;
  if(!trafficTextures.local||trafficTextures.local.bounds.some((v,i)=>v!==detailBounds[i]))trafficTextures.local=uploadTrafficTexture(traffic,detailBounds,true,trafficTextures.local);
  clearStreetSurfaces();
  const geometry=Streetscape.generate({roads:[deckRoads],center,radius:650,detailCenter:center,detailRadius:600,groundAt,isOccupied:(x,y,z)=>occupied(x,y,z,true),maxSegments:8000,roadWidth:8,sidewalkWidth:2.4,markings:false,terrainTolerance:0.02,segmentOptions:traffic.segmentOptions});
  const meshes={};for(const key of ['asphalt','sidewalks'])meshes[key]=uploadStreetMesh(geometry[key]);
  const names=new Map();for(const row of assets.streetHints?.segments||[]){const [ax,ay,bx,by,,,,,skip,name]=row;if(!name||skip||Math.hypot(bx-ax,by-ay)<25)continue;const x=(ax+bx)/2,y=(ay+by)/2,d=Math.hypot(x-center[0],y-center[1]);if(d>500||(names.has(name)&&names.get(name).d<d))continue;const z=groundAt(x,y);if(z!==null)names.set(name,{name,d,p:[x,y,z+0.4]});}
  streetSurfaces={meshes,stats:{...geometry.stats,segments:trafficTextures.local.stats.roadSegments,sidewalkPatches:trafficTextures.local.stats.sidewalkSegments,markingPatches:trafficTextures.local.stats.markingSegments,groundMode:'terrain-material'},center,labels:[...names.values()].sort((a,b)=>a.d-b.d).slice(0,5)};streetSurfaceKey=key;
}
function drawStreetSurfaces(cam,o){
  if(state.sceneStyle!=='context'||!state.layers.roads)return;
  if(!globalTrafficSurfaces)return;setCommon(PM,cam);gl.uniform1f(PM.u.uSurface,0);gl.uniform1f(PM.u.uStudyActive,0);
  gl.enable(gl.POLYGON_OFFSET_FILL);gl.polygonOffset(-2,-2);
  const colors={asphalt:[0.23,0.25,0.26,1],sidewalks:[0.86,0.86,0.84,1]},draw=(mesh,color,surface)=>{if(!mesh?.count)return;gl.uniform1f(PM.u.uSurface,surface);gl.uniform4fv(PM.u.uColor,color);gl.bindVertexArray(mesh.vao);gl.drawElements(gl.TRIANGLES,mesh.count,gl.UNSIGNED_INT,0);};
  draw(globalTrafficSurfaces.mesh,colors.asphalt,8);
  if(!o.plan)for(const key of ['asphalt','sidewalks'])draw(streetSurfaces?.meshes[key],colors[key],key==='asphalt'?8:9);
  gl.bindVertexArray(null);gl.disable(gl.POLYGON_OFFSET_FILL);
}

let viewconeGpu = null;
function viewconeMeshes(scene) {
  if (viewconeGpu?.scene === scene) return viewconeGpu.meshes;
  if (viewconeGpu) for (const mesh of Object.values(viewconeGpu.meshes)) {
    gl.deleteVertexArray(mesh.vao); gl.deleteBuffer(mesh.vb); if (mesh.ib) gl.deleteBuffer(mesh.ib);
  }
  const meshes = {};
  for (const key of ['surface','walls','edges','intrusion','footprints','baseFootprints','footprintConnectors']) {
    const pos = scene[key]; if (pos?.length) meshes[key] = makeMesh(pos instanceof Float32Array ? pos : new Float32Array(pos),null);
  }
  viewconeGpu = {scene,meshes}; return meshes;
}
function drawViewconeOverlay(cam, scene) {
  if (!scene?.enabled || !PV) return;
  const meshes = viewconeMeshes(scene);
  const draw = (program, key, mode, color) => { const mesh=meshes[key]; if(!mesh)return;
    gl.uniform4fv(program.u.uColor,color);gl.bindVertexArray(mesh.vao);gl.drawArrays(mode,0,mesh.count);gl.bindVertexArray(null); };
  // Actual proposal skin and clipping caps are opaque and depth tested. Terrain
  // and neighbouring buildings still occlude them; there is no red bounding box.
  gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);gl.depthMask(true);gl.disable(gl.BLEND);
  setCommon(PM,cam);gl.uniform1f(PM.u.uLightMix,0.25);gl.uniform1f(PM.u.uFogFar,1000000);
  gl.enable(gl.POLYGON_OFFSET_FILL);gl.polygonOffset(-3,-3);
  draw(PM,'intrusion',gl.TRIANGLES,[0.96,0.08,0.11,1]);gl.disable(gl.POLYGON_OFFSET_FILL);
  gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);gl.depthMask(false);
  const city=scene.kind==='imagine-city';
  setCommon(PV,cam);draw(PV,'surface',gl.TRIANGLES,[0.02,0.46,0.94,city?0.075:0.22]);draw(PV,'walls',gl.TRIANGLES,[0.02,0.53,1,city?0.018:0.065]);
  // Camera-facing edge ribbons give a soft glow at any zoom. WebGL line widths
  // are commonly restricted to one pixel, so the halo is ordinary triangles.
  setCommon(PL,cam);gl.uniform1f(PL.u.uFogFar,1000000);
  const edges=scene.edges || [], forward=V.norm(V.sub(cam.target,cam.eye));
  gl.blendFunc(gl.SRC_ALPHA,gl.ONE);
  for (const [pixels,alpha] of (city?[[4,0.025],[1.5,0.10]]:[[9,0.035],[5,0.07],[2,0.22]])) {
    const ribbons=[];
    for(let i=0;i<edges.length;i+=6){const a=Array.from(edges.slice(i,i+3)),b=Array.from(edges.slice(i+3,i+6)),axis=V.sub(b,a);let side=V.cross(axis,forward);if(V.len(side)<1e-9)continue;
      const mid=V.scale(V.add(a,b),0.5),scale=cam.half ? cam.half*2/canvas.height : 2*Math.max(1,V.len(V.sub(cam.eye,mid)))*Math.tan((cam.fovy||Math.PI/4)/2)/canvas.height;
      side=V.scale(V.norm(side),pixels*scale);const p=V.add(a,side),q=V.sub(a,side),r=V.add(b,side),s=V.sub(b,side);ribbons.push(...p,...q,...r,...r,...q,...s);
    }
    if(ribbons.length)dynDraw(PL,gl.TRIANGLES,new Float32Array(ribbons),null,[0.03,0.53,1,alpha]);
  }
  gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
  draw(PL,'edges',gl.LINES,[0.12,0.69,1,city?0.38:0.95]);
  draw(PL,'baseFootprints',gl.LINES,[0.08,0.44,0.93,0.65]);draw(PL,'footprintConnectors',gl.LINES,[0.08,0.44,0.93,0.18]);
  // A faint projected trace remains readable through roofs in Plan as well as
  // City views. Only this labelled footprint aid ignores depth, never red skin.
  gl.disable(gl.DEPTH_TEST);draw(PL,'footprints',gl.LINES,[0.03,0.39,0.86,0.32]);gl.enable(gl.DEPTH_TEST);
  gl.depthMask(true);gl.disable(gl.BLEND);
}
function drawScene(cam, opts) {
  const o = Object.assign({ lines: true, markers: true, wedge: true, cones: true, backdrop: false, viewcone: true }, opts || {});
  const city=imagineCityOpen();if(city){o.markers=false;o.wedge=false;o.cones=false;}
  const viewconeActive = city || o.viewcone && !!window.VistaViewcone?.enabled;
  const viewcone = !city && viewconeActive && o.cones && !o.plan ? window.VistaViewcone?.getScene() : null;
  const observerView = state.mode === 'observer' && !o.plan;
  if(!o.plan){ prepareStreetSurfaces(cam); prepareContextShadow(cam); drawContextSky(cam); }
  gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.disable(gl.BLEND); gl.depthMask(true); setCommon(PM, cam);
  if (o.backdrop && state.showBackdrop && assets.meshes.backdrop) { gl.uniform1f(PM.u.uFogFar, 42000); drawStatic(PM, 'backdrop', C.backdrop); gl.uniform1f(PM.u.uFogFar, cam.fogFar); }
  if (assets.meshes.ext_terrain) { drawStatic(PM, 'ext_terrain', state.layers.sources ? C.extTerrain : C.terrain); drawStatic(PM, 'ext_water', state.layers.sources ? C.extWater : C.water); drawStatic(PM, 'ext_parks', state.layers.sources ? C.extParks : C.parks); }
  drawStatic(PM, 'ext_buildings', state.layers.sources ? C.extBuildings : C.buildings);
  drawStatic(PM, 'terrain', C.terrain); drawStatic(PM, 'water', C.water, [0, 0, 0.05]); drawStatic(PM, 'parks', C.parks, assets.unified ? null : [0, 0, 0.15]); drawStatic(PM, 'buildings', C.buildings);
  drawStreetSurfaces(cam,o);
  if (!city && state.selected !== null && assets.ready && (!isRemoved(state.selected, !!state.selectedExt) || state.showExisting)) { const cols = (state.selectedExt ? assets.extIndex : assets.index).columns; gl.uniform1f(PM.u.uSurface, 7); gl.uniform4fv(PM.u.uColor, C.buildingSel); gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(-2, -2);
    gl.bindVertexArray(assets.meshes[state.selectedExt ? 'ext_buildings' : 'buildings'].vao); gl.drawElements(gl.TRIANGLES, cols.index_count[state.selected], gl.UNSIGNED_INT, cols.index_offset[state.selected] * 4); gl.bindVertexArray(null); gl.disable(gl.POLYGON_OFFSET_FILL); }
  if (!city && state.multiSel.length && assets.ready) { gl.uniform1f(PM.u.uSurface, 7); gl.uniform4fv(PM.u.uColor, C.buildingSel); gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(-2, -2);
    for (const q of state.multiSel) { if (isRemoved(q.index, q.ext) && !state.showExisting) continue; const cols = (q.ext ? assets.extIndex : assets.index).columns; gl.bindVertexArray(assets.meshes[q.ext ? 'ext_buildings' : 'buildings'].vao); gl.drawElements(gl.TRIANGLES, cols.index_count[q.index], gl.UNSIGNED_INT, cols.index_offset[q.index] * 4); }
    gl.bindVertexArray(null); gl.disable(gl.POLYGON_OFFSET_FILL); }
  const P = !city && proposalShown() ? proposalBox() : null;
  if (P) { gl.uniform1f(PM.u.uSurface,5); const a = evaluationArea(); if (!viewconeActive && !state.check.unknown && a) { gl.uniform1f(PM.u.uStudyActive, 1); gl.uniform1f(PM.u.uStudyCeiling, state.check.bz); gl.uniform4fv(PM.u.uStudyArea, [a.x_min,a.y_min,a.x_max,a.y_max]); } if (state.pmode === 'import' && state.imported) { const off = importOffset(); gl.uniform4fv(PM.u.uColor, C.proposal); gl.uniform3fv(PM.u.uOffset, off); for (const mesh of state.imported.drawMeshes) { gl.bindVertexArray(mesh.vao); gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_INT, 0); } gl.bindVertexArray(null); gl.uniform3fv(PM.u.uOffset, [0, 0, 0]); }
    else for (const part of P.parts) { dynDraw(PM, gl.TRIANGLES, part.pos, part.idx, C.proposal); } gl.uniform1f(PM.u.uStudyActive, 0); }
  const eye = observerEye();
  if (eye && o.markers) { const s = o.markerScale || 1; const ob = state.observer;
    dynDraw(PM, gl.TRIANGLES, ...Object.values(boxMesh([ob.x - 0.3 * s, ob.y - 0.3 * s, ob.z, ob.x + 0.3 * s, ob.y + 0.3 * s, eye[2]])), C.observer);
    dynDraw(PM, gl.TRIANGLES, ...Object.values(boxMesh([eye[0] - 0.5 * s, eye[1] - 0.5 * s, eye[2] - 0.2 * s, eye[0] + 0.5 * s, eye[1] + 0.5 * s, eye[2] + 0.5 * s])), C.observer); }
  const selCone = viewcone?.cone || selectedCone();
  if (selCone && selCone.origin_inside_model_extent && o.markers) { const [ox, oy] = selCone.origin_model_xy; const gz = terrainZAt(ox, oy); if (gz !== null) dynDraw(PM, gl.TRIANGLES, ...Object.values(boxMesh([ox - 1.2, oy - 1.2, gz, ox + 1.2, oy + 1.2, gz + 3])), C.origin); }
  // Context carriageways already carry their material mask; omit duplicate road centre polylines.
  setCommon(PL, cam);
  if (o.lines && !observerView) { if (state.layers.roads && state.sceneStyle!=='context') drawStatic(PL, assets.meshes.street_network ? 'street_network' : 'roads', C.roads, assets.unified ? null : [0, 0, 0.5]); drawStatic(PL, 'shoreline', C.shoreline, [0, 0, 0.3]); if (state.layers.roads && state.sceneStyle!=='context' && !assets.meshes.street_network && assets.meshes.ext_roads) drawStatic(PL, 'ext_roads', C.extRoads); if (state.layers.extent && assets.extentLines) dynDraw(PL, gl.LINES, assets.extentLines, null, C.extent); if (state.layers.extent && assets.extExtentLines) dynDraw(PL, gl.LINES, assets.extExtentLines, null, C.extExtent); }
  if (!observerView && !city) { drawStudyBoundary(cam); drawImportedParcels(); }
  if (P) { drawProposalEdges(P.parts); if (state.site && !observerView) { const sx = state.site.x, sy = state.site.y, sz = state.site.z + 0.5, k = 4; dynDraw(PL, gl.LINES, new Float32Array([sx - k, sy, sz, sx + k, sy, sz, sx, sy - k, sz, sx, sy + k, sz]), null, C.siteEdge); } }
  else if (state.site && !observerView) { const sx = state.site.x, sy = state.site.y, sz = state.site.z + 0.5, k = 6; dynDraw(PL, gl.LINES, new Float32Array([sx - k, sy, sz, sx + k, sy, sz, sx, sy - k, sz, sx, sy + k, sz]), null, C.siteEdge); }
  if (!observerView && eye && o.markers) { const tgt = proposalCentre(); const far = tgt ? tgt : V.add(eye, V.scale(observerForward(), 60)); dynDraw(PL, gl.LINES, new Float32Array([...eye, ...far]), null, C.ray);
    if (state.mode !== 'observer') dynDraw(PL, gl.LINES, new Float32Array([eye[0], eye[1], eye[2], eye[0], eye[1], eye[2] + 40]), null, C.observer); }
  if (!viewcone?.enabled && !observerView && o.cones && assets.cones && assets.cones.available) for (const c of assets.cones.cones) { if (c === selCone) { const g = coneGeometry(c); dynDraw(PL, gl.LINES, g.ground, null, C.coneEdgeSel); if (state.mode !== 'observer') dynDraw(PL, gl.LINES, g.top, null, C.coneEdgeSel); } else if (state.showAllCones) dynDraw(PL, gl.LINES, coneGeometry(c).ground, null, C.coneEdge); }
  if (!observerView && selCone && selCone.origin_inside_model_extent && o.markers) { const [ox, oy] = selCone.origin_model_xy; const gz = terrainZAt(ox, oy) || 0; dynDraw(PL, gl.LINES, new Float32Array([ox, oy, gz, ox, oy, gz + 70]), null, C.origin); }
  // transparent geometry last
  gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false); gl.useProgram(PM.p); gl.uniform1f(PM.u.uLightMix, 0.0);
  // Filled plan-corridor walls obscure silhouettes in close and eye-level views.
  if (!viewcone?.enabled && o.cones && selCone && state.mode === 'overview' && !o.plan) { const g = coneGeometry(selCone); dynDraw(PM, gl.TRIANGLES, g.wall, g.wallIdx, C.coneSel); }
  const area = evaluationArea();
  if (!viewconeActive && !observerView && area && !state.check.unknown && Number.isFinite(state.check.bz)) { const z = state.check.bz; const m = 4;
    dynDraw(PM, gl.TRIANGLES, new Float32Array([area.x_min - m, area.y_min - m, z, area.x_max + m, area.y_min - m, z, area.x_max + m, area.y_max + m, z, area.x_min - m, area.y_max + m, z]), new Uint32Array([0, 1, 2, 0, 2, 3]), C.plane);
    setCommon(PL, cam); dynDraw(PL, gl.LINES, new Float32Array([area.x_min - m, area.y_min - m, z, area.x_max + m, area.y_min - m, z, area.x_max + m, area.y_min - m, z, area.x_max + m, area.y_max + m, z, area.x_max + m, area.y_max + m, z, area.x_min - m, area.y_max + m, z, area.x_min - m, area.y_max + m, z, area.x_min - m, area.y_min - m, z]), null, C.planeEdge); gl.useProgram(PM.p); }
  if (!viewcone?.enabled && eye && o.wedge && state.wedge && state.mode !== 'observer') { const w = wedgeGeometry(cam.aspect); if (w) { gl.useProgram(PM.p); dynDraw(PM, gl.TRIANGLES, w.pos, w.idx, C.wedge); setCommon(PL, cam); dynDraw(PL, gl.LINES, w.edges, null, C.wedgeEdge); } }
  if (!viewcone?.enabled && !observerView && o.cones) drawConeCeiling(cam);
  gl.depthMask(true); gl.disable(gl.BLEND);
  if (viewcone?.enabled) drawViewconeOverlay(cam,viewcone);
  if (city && imagineCityScene?.showCones && imagineCityScene.overlay) drawViewconeOverlay(cam,imagineCityScene.overlay);
}
function wedgeGeometry(aspect) { const eye = observerEye(); if (!eye) return null; const f = observerForward(); const tgt = proposalCentre(); const L = tgt ? V.len(V.sub(tgt, eye)) * 1.1 : 120;
  let r = V.cross(f, [0, 0, 1]); if (V.len(r) < 1e-6) r = [1, 0, 0]; r = V.norm(r); const u = V.norm(V.cross(r, f)); const vf = state.fov * Math.PI / 180; const hh = L * Math.tan(vf / 2), hw = hh * (aspect || 1.6);
  const c = V.add(eye, V.scale(f, L)); const q = [V.add(V.add(c, V.scale(r, -hw)), V.scale(u, -hh)), V.add(V.add(c, V.scale(r, hw)), V.scale(u, -hh)), V.add(V.add(c, V.scale(r, hw)), V.scale(u, hh)), V.add(V.add(c, V.scale(r, -hw)), V.scale(u, hh))];
  return { pos: new Float32Array([...eye, ...q[0], ...q[1], ...q[2], ...q[3]]), idx: new Uint32Array([0, 1, 2, 0, 2, 3, 0, 3, 4, 0, 4, 1]),
    edges: new Float32Array([...eye, ...q[0], ...eye, ...q[1], ...eye, ...q[2], ...eye, ...q[3], ...q[0], ...q[1], ...q[1], ...q[2], ...q[2], ...q[3], ...q[3], ...q[0]]) }; }
function resize() { const dpr = Math.min(window.devicePixelRatio || 1, 2); const r = canvas.getBoundingClientRect(); const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr)); if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; requestRender(); } }
function render() { if (!gl || !PM) return; resize(); const W = canvas.width, H = canvas.height; gl.viewport(0, 0, W, H); gl.disable(gl.SCISSOR_TEST); gl.clearColor(BG[0], BG[1], BG[2], 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); if (!assets.ready) return;
  const cam = computeCamera(state.mode, W / H); if(lastCam&&cam.vp.some((value,i)=>Math.abs(value-lastCam.vp[i])>1e-7))window.VistaImagineHover?.clear(); lastCam = cam; drawScene(cam, { markers: state.mode !== 'observer', backdrop: state.mode === 'observer' });
  const inset = insetContext(); $('inset-frame').classList.toggle('hidden', !inset.visible); if (inset.visible) drawInset(W, H, inset);
  updatePlanMarkers(cam); updateLabels(cam); updateMapCues(cam); aerialFollow(); }
// Screen-size markers in Plan and City views: an eye where the observer stands, with a fan for the view direction, and a
// proposal badge when the building is too small on screen to find. Both keep their size at any zoom.
const planMarkers = { observer: false, proposal: false }; // which markers replace the older text tags this frame
function updatePlanMarkers(cam) {
  const rect = canvas.getBoundingClientRect(), show = state.mode === 'plan' || state.mode === 'overview', m = 26;
  const toScreen = (p) => { const q = project(cam.vp, p); if (q[3] <= 0) return null; return [(q[0] + 1) / 2 * rect.width, (1 - q[1]) / 2 * rect.height]; };
  const place = (el, s) => { const x = clamp(s[0], m, rect.width - m), y = clamp(s[1], m, rect.height - m); el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`; el.classList.toggle('offscreen', x !== s[0] || y !== s[1]); return [x, y]; };
  const obsEl = $('pm-observer'), propEl = $('pm-proposal'), line = $('pm-link-line'); let a = null, b = null;
  const eye = observerEye(), so = show && eye ? toScreen([eye[0], eye[1], state.observer.z]) : null;
  obsEl.classList.toggle('hidden', !so);
  if (so) { a = place(obsEl, so);
    const f = observerForward(), ahead = toScreen([eye[0] + f[0] * 50, eye[1] + f[1] * 50, state.observer.z]), deg = ahead ? Math.atan2(ahead[1] - so[1], ahead[0] - so[0]) * 180 / Math.PI : 0;
    const hf = 2 * Math.atan(Math.tan(state.fov * Math.PI / 360) * (rect.width / Math.max(1, rect.height))), half = Math.min(hf / 2, 1.4), R = 62;
    $('pm-fan-path').setAttribute('d', `M0 0 L${(R * Math.cos(half)).toFixed(1)} ${(-R * Math.sin(half)).toFixed(1)} A${R} ${R} 0 0 1 ${(R * Math.cos(half)).toFixed(1)} ${(R * Math.sin(half)).toFixed(1)} Z`);
    obsEl.querySelector('.pm-fan').style.transform = `rotate(${deg.toFixed(1)}deg)`;
    $('pm-observer-label').textContent = (state.observerSource === 'origin' ? `You · view ${state.viewpoint}` : state.observerSource === 'rooftop' ? 'You · on a roof' : 'You'); }
  const P = show && proposalShown() ? proposalBox() : null; let sp = null;
  if (P) { const c = toScreen([P.cx, P.cy, P.base]); const corners = [[P.box[0], P.box[1]], [P.box[3], P.box[4]]].map(q => toScreen([q[0], q[1], P.base])).filter(Boolean);
    const size = corners.length === 2 ? Math.hypot(corners[0][0] - corners[1][0], corners[0][1] - corners[1][1]) : 0;
    if (c && (size < 36 || so)) sp = c; }
  propEl.classList.toggle('hidden', !sp); if (sp) { b = place(propEl, sp); propEl.querySelector('.pm-label').textContent = `Proposal · ${fmt(P.top - P.base, 0)} m`; }
  // before the building exists (Site, or Build before a method), a pin shows where it will stand; the proposal marker takes over once it is drawn
  // a searched address stays marked (until a new search or a new study), so "marked on the plan" is always true
  const adEl = $('pm-address'); if (adEl) { const ad = show && state.addressPin && !(state.site && Math.hypot(state.site.x - state.addressPin.x, state.site.y - state.addressPin.y) < 25) ? toScreen([state.addressPin.x, state.addressPin.y, terrainZAt(state.addressPin.x, state.addressPin.y) ?? 0]) : null; adEl.classList.toggle('hidden', !ad); if (ad) { place(adEl, ad); $('pm-address-label').textContent = state.addressPin.label; } }
  const siteEl = $('pm-site'); let ss = null;
  if (siteEl) { if (show && state.site && !proposalShown()) { const c = state.boundary.length >= 3 && !state.drawing ? SiteGeometry.metrics(state.boundary).centre : [state.site.x, state.site.y]; ss = toScreen([c[0], c[1], state.site.z]); }
    siteEl.classList.toggle('hidden', !ss); if (ss) b = b || place(siteEl, ss); }
  planMarkers.observer = !!so; planMarkers.proposal = !!sp;
  // keep the two tags apart when the markers are close: the left marker's tag flips to its left side
  const near = a && b && Math.abs(a[1] - b[1]) < 26 && Math.abs(a[0] - b[0]) < 190, leftIsObs = near && a[0] <= b[0];
  obsEl.querySelector('.pm-label').classList.toggle('flip', !!leftIsObs); for (const el of [propEl, $('pm-site')]) el?.querySelector('.pm-label').classList.toggle('flip', !!near && !leftIsObs);
  const link = $('pm-link'); link.classList.toggle('hidden', !(a && b));
  if (a && b) { link.setAttribute('width', rect.width); link.setAttribute('height', rect.height); line.setAttribute('x1', a[0]); line.setAttribute('y1', a[1]); line.setAttribute('x2', b[0]); line.setAttribute('y2', b[1]); }
}
// Choosing a cone previews its origin; it does not move the eye-level camera.
function insetContext() {
  const cone = selectedCone(), observing = state.mode === 'observer' && !!state.observer;
  const candidate = !observing && state.flow.methods.view === 'cone' && cone ? cone.origin_model_xy : null;
  const anchor = candidate || observerEye(), target = proposalShown() ? proposalCentre() : state.site ? [state.site.x, state.site.y, state.site.z] : null;
  const visible = !!(anchor || target) && !!(state.observer || cone || state.flow.stage === 'view');
  return { anchor, target, observing, preview: !!candidate, visible };
}
function drawInset(W, H, context) { const dpr = canvas.width / canvas.getBoundingClientRect().width; const fr = $('inset-frame').getBoundingClientRect(), cr = canvas.getBoundingClientRect();
  if (fr.width <= 24 || fr.height <= 24) return;
  const iw = Math.round(fr.width * dpr), ih = Math.round(fr.height * dpr), ix = Math.round((fr.left - cr.left) * dpr), iy = Math.round((cr.bottom - fr.bottom) * dpr);
  gl.enable(gl.SCISSOR_TEST); gl.scissor(ix, iy, iw, ih); gl.viewport(ix, iy, iw, ih); gl.clearColor(...(state.sceneStyle!=='collage'?[...BG,1]:[0.96,0.95,0.92,1])); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  const { anchor, target, observing, preview } = context;
  const bbox = assets.manifest.extent_m.scene_bbox;
  const bounds = assets.unified?.target_extent_model_m || assets.extension?.target_extent_model_m || [bbox[0], bbox[1], bbox[3], bbox[4]];
  const frame = InsetCamera.fit({ points: [anchor, target].filter(Boolean), width: fr.width, height: fr.height, bounds, paddingPx: fr.width < 200 ? 10 : 16 });
  const centre = frame.center, half = frame.half, aspect = frame.aspect;
  const view = lookAt([centre[0], centre[1], 3000], [centre[0], centre[1], 0], [0, 1, 0]); const proj = ortho(-half * aspect, half * aspect, -half, half, 1, 6000); const cam = { eye: [centre[0], centre[1], 3000], vp: mul(proj, view), fogFar: 1e9, aspect };
  drawScene(cam, { lines: false, wedge: false, cones: true, markers: false, plan: true });
  if (frame.extentExceeded) { setCommon(PL, cam); gl.disable(gl.DEPTH_TEST); const [x0, y0, x1, y1] = bounds;
    dynDraw(PL, gl.LINES, new Float32Array([x0,y0,0,x1,y0,0,x1,y0,0,x1,y1,0,x1,y1,0,x0,y1,0,x0,y1,0,x0,y0,0]), null, C.extent); gl.enable(gl.DEPTH_TEST); }
  gl.disable(gl.SCISSOR_TEST); gl.viewport(0, 0, W, H);
  $('inset-coverage').classList.toggle('hidden', !frame.extentExceeded);
  $('inset-frame').classList.toggle('preview', preview);
  // Fixed location markers remain visible during free inspection; only an active observer has a viewing beam.
  const at = (p) => { const q = project(cam.vp, p); return [(q[0] + 1) / 2 * fr.width, (1 - q[1]) / 2 * fr.height]; }, put = (el, s) => { el.style.transform = `translate(${s[0].toFixed(1)}px, ${s[1].toFixed(1)}px)`; };
  const se = anchor ? at([anchor[0], anchor[1], 0]) : null;
  $('im-eye').classList.toggle('hidden', !anchor); $('inset-eye-key').classList.toggle('hidden', !anchor);
  if (se) put($('im-eye'), se);
  const eyeLabel = observing ? 'you' : preview ? 'selected view' : 'viewpoint';
  $('inset-eye-label').textContent = eyeLabel;
  // view beam (as in web maps): points where you look, as wide as your horizontal field of view; turns live while you drag the view
  $('inset-beam').classList.toggle('hidden', !observing);
  if (observing) { const fw = observerForward(), ahead = at([anchor[0] + fw[0] * half * 0.2, anchor[1] + fw[1] * half * 0.2, 0]), heading = Math.atan2(ahead[1] - se[1], ahead[0] - se[0]);
  const hHalf = Math.min(1.45, Math.atan(Math.tan(state.fov * Math.PI / 360) * (W / Math.max(1, H)))), R = 80;
  $('inset-beam-path').setAttribute('d', `M0 0 L${(R * Math.cos(-hHalf)).toFixed(1)} ${(R * Math.sin(-hHalf)).toFixed(1)} A${R} ${R} 0 0 1 ${(R * Math.cos(hHalf)).toFixed(1)} ${(R * Math.sin(hHalf)).toFixed(1)} Z`);
  $('inset-beam').setAttribute('transform', `translate(${se[0].toFixed(1)} ${se[1].toFixed(1)}) rotate(${(heading * 180 / Math.PI).toFixed(1)})`); }
  $('im-prop').classList.toggle('hidden', !target); $('inset-prop-key').classList.toggle('hidden', !target);
  $('inset-prop-label').textContent = proposalShown() ? 'proposal' : 'site';
  if (target) { const sp = at([target[0], target[1], 0]); put($('im-prop'), sp); if (se) { const l = $('inset-link-line'); l.setAttribute('x1', se[0]); l.setAttribute('y1', se[1]); l.setAttribute('x2', sp[0]); l.setAttribute('y2', sp[1]); } }
  $('inset-link-line').style.display = target && se ? '' : 'none';
  $('inset-frame').setAttribute('aria-label', `Location map, north up. ${anchor ? eyeLabel + (preview ? ' ' + state.viewpoint : '') + '. ' : ''}${target ? (proposalShown() ? 'Proposal.' : 'Site.') : ''}${frame.extentExceeded ? ' Model coverage ends at the outlined edge.' : ''}`);
}
const labelsEl = $('labels'); const labelNodes = new Map();
function labelNode(key, cls) { let n = labelNodes.get(key); if (!n) { n = document.createElement('div'); n.className = 'label ' + (cls || ''); labelsEl.appendChild(n); labelNodes.set(key, n); } n.className = 'label ' + (cls || ''); return n; }
function updateLabels(cam) { const rect = canvas.getBoundingClientRect(); const items = [],city=imagineCityOpen();
  const boundary = state.drawing || state.boundary;
  if (!city && boundary.length > 1 && state.mode !== 'observer') {
    for (let i = 0; i < boundary.length - (state.drawing ? 1 : 0); i++) { const a = boundary[i], b = boundary[(i+1)%boundary.length], mid = [(a[0]+b[0])/2, (a[1]+b[1])/2]; items.push({ key: 'edge'+i, text: fmt(Math.hypot(b[0]-a[0], b[1]-a[1]),1)+' m', p: [...mid, (terrainZAt(...mid) || 0)+2], cls: 'site-edge' }); }
    if (boundary.length >= 3 && !SiteGeometry.validate(boundary)) { const m = SiteGeometry.metrics(boundary); items.push({key: 'site-area', text: formatArea(m.area)+' · study area', p: [...m.centre, (terrainZAt(...m.centre)||0)+2], cls:'site'}); }
  }
  if (state.layers.labels && state.mode !== 'observer') { for (const l of assets.labels) items.push({ key: 'L' + l.text, text: l.text, p: [l.x, l.y, l.z + 40], cls: '' }); if (assets.extLabels) for (const l of assets.extLabels) items.push({ key: 'X' + l.text, text: l.text, p: [l.x, l.y, l.z + 40], cls: 'ext' }); }
  const P = !city && proposalShown() ? proposalBox() : null; if (P) { // height tag beside the silhouette, not on it: upper-right of the projected bounding box, with a leader
    const b = P.box; let sx = -Infinity, sy = Infinity, ok = false;
    for (const x of [b[0], b[3]]) for (const y of [b[1], b[4]]) for (const z of [b[2], b[5]]) { const q = project(cam.vp, [x, y, z]); if (q[3] > 0) { ok = true; sx = Math.max(sx, q[0]); if (z === b[5]) sy = Math.min(sy, q[1]); } }
    if (ok && !planMarkers.proposal) items.push({ key: 'proposal', text: `${fmt(P.top-P.base)} m tall`, screen: [sx, sy], cls: 'proposal dim' }); }
  const eye = city ? null : observerEye(); if (eye && state.mode !== 'observer' && !planMarkers.observer) items.push({ key: 'observer', text: (state.observerSource === 'origin' ? `Observer at ${state.viewpoint} origin (open data) · eye z ${fmt(eye[2])} m` : state.observerSource === 'rooftop' ? `Rooftop observer (height unverified) · eye z ${fmt(eye[2])} m` : `Exploratory observer · eye z ${fmt(eye[2])} m`), p: [eye[0], eye[1], eye[2] + 45], cls: 'observer' });
  const vc = city ? null : window.VistaViewcone?.getScene(), sc = city ? null : vc?.cone || selectedCone(); if (sc && state.mode !== 'observer') { const pts = sc.polygon_model_xy; const mid = pts.reduce((a, q) => [a[0] + q[0] / pts.length, a[1] + q[1] / pts.length], [0, 0]);
    items.push({ key: 'cone', text: vc?.enabled ? `View ${sc.view_number} — ${sc.name} · ${vc.certainty}` : `View ${sc.view_number} — ${sc.name}: plan cone (City open data; heights unknown)`, p: [mid[0], mid[1], vc?.plane ? vc.plane.a*mid[0]+vc.plane.b*mid[1]+vc.plane.c+5 : CONE_TOP + 5], cls: 'cone' });
    if (sc.origin_inside_model_extent && state.observerSource !== 'origin') items.push({ key: 'origin', text: `Origin ${sc.view_number} (open-data apex; by-law authoritative)`, p: [sc.origin_model_xy[0], sc.origin_model_xy[1], (terrainZAt(sc.origin_model_xy[0], sc.origin_model_xy[1]) || 0) + 75], cls: 'origin' }); }
  // zoomed out, the proposal marker carries the label; the ceiling tag would sit on top of it
  const area = evaluationArea(); if (!city && !vc?.enabled && area && !state.check.unknown && Number.isFinite(state.check.bz) && state.mode !== 'observer' && !planMarkers.proposal) items.push({ key: 'plane', text: `Study ceiling · ${fmt(state.check.bz-(P?.base || 0))} m above base`, p: [area.x_max, area.y_min, state.check.bz + 2], cls: 'plane' });
  const cr=window.VistaEnvelope?.getResult(); if(!city && !vc?.enabled && coneStudy.show && cr?.coordinateCompatible && cr.limitingPoint && state.mode !== 'observer') items.push({key:'cone-ceiling',text:`${cr.certainty.label} envelope · view ${cr.limitingView} · ${fmt(cr.ceilingElevationM)} m (${coneStudy.datumName})${cr.mathematicalStatus==='partial'?' · incomplete':''}`,p:[...cr.limitingPoint.xy,cr.ceilingElevationM-coneStudy.datumOffsetM+2],cls:'plane'});
  if(state.sceneStyle==='context' && state.layers.roads && state.mode!=='observer') for(const label of streetSurfaces?.labels||[]) items.push({key:'street-name-'+label.name,text:label.name,p:label.p,cls:'street'});
  const seen = new Set(), placed = []; items.sort((a,b)=>Number(!a.cls || a.cls==='ext')-Number(!b.cls || b.cls==='ext'));
  for (const it of items) { const q = it.screen ? [it.screen[0], it.screen[1], 0, 1] : project(cam.vp, it.p); const n = labelNode(it.key, it.cls); seen.add(it.key); if (q[3] <= 0 || q[0] < -1.05 || q[0] > 1.05 || q[1] < -1.05 || q[1] > 1.05) { n.style.display = 'none'; continue; }
    const px=(q[0]+1)/2*rect.width, py=(1-q[1])/2*rect.height, half=it.text.length*2.9+8;
    if ((!it.cls || it.cls==='ext') && placed.some(b=>px+half>b[0] && px-half<b[2] && py>b[1] && py-22<b[3])) { n.style.display='none'; continue; } placed.push([px-half,py-22,px+half,py+3]);
    n.style.display = ''; n.textContent = it.text; n.style.left = (clamp((q[0] + 1) / 2, 0, 1) * rect.width + (it.screen ? 14 : 0)) + 'px'; n.style.top = (clamp((1 - q[1]) / 2, 0, 1) * rect.height) + 'px'; }
  for (const [k, n] of labelNodes) if (!seen.has(k)) n.style.display = 'none';
}

// ------------------------------------------------------------------ interaction
let drag = null; const pointers = new Map();
canvas.addEventListener('pointerdown', (e) => { try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* synthetic pointer */ } pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 1 && e.button === 0 && !imagineCityOpen() && state.tool === 'aim' && state.mode !== 'observer' && assets.ready && beginAim(e.clientX, e.clientY)) { drag = { x0: e.clientX, y0: e.clientY, button: 0, aim: true, moved: false }; requestRender(); return; }
  if (pointers.size === 1) drag = { x0: e.clientX, y0: e.clientY, button: e.button, shift: e.shiftKey, moved: false }; else drag = null; });
canvas.addEventListener('pointermove', (e) => { if (!pointers.has(e.pointerId)) return; const prev = pointers.get(e.pointerId); pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (drag && drag.aim) { if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > 6) drag.moved = true; if (drag.moved) aimDragTo(e.clientX, e.clientY); return; }
  if (pointers.size === 2) { const [a, b] = [...pointers.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y); if (drag && drag.pinch) zoomBy(Math.log(drag.pinch / d) * 1.2); drag = { pinch: d }; requestRender(); return; }
  if (!drag || drag.pinch !== undefined) return; const dx = e.clientX - prev.x, dy = e.clientY - prev.y; if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > 4) drag.moved = true; if (!drag.moved) return;
  const pan = drag.button === 2 || drag.shift || state.mode === 'plan';
  // eye-level drag follows the cursor (about one pixel of view per pixel of drag) instead of spinning: scaled by the field of view
  if (state.mode === 'observer' && state.observer) { const o = state.cams.observer, k = 1.25 * (state.fov * Math.PI / 180) / Math.max(1, canvas.clientHeight); o.yaw -= dx * k; o.pitch = clamp(o.pitch - dy * k, -1.48, 1.48); }
  else if (state.mode === 'plan') { const o = state.cams.overview, scale = 2 * o.dist * Math.tan(Math.PI / 8) / canvas.clientHeight; o.target[0] -= dx * scale; o.target[1] += dy * scale; }
  else if (pan && state.mode === 'overview') { const o = state.cams.overview; const s = o.dist * 0.0016; const az = o.az; const rx = [-Math.sin(az), Math.cos(az), 0], fy = [-Math.cos(az), -Math.sin(az), 0]; o.target = V.add(o.target, V.add(V.scale(rx, -dx * s), V.scale(fy, dy * s))); }
  else { const o = state.mode === 'inspect' ? state.cams.inspect : state.cams.overview; o.az -= dx * 0.006; o.el = clamp(o.el + dy * 0.006, 0.03, 1.55); }
  requestRender(); writeHash(); });
function endPointer(e) { pointers.delete(e.pointerId); if (drag && drag.aim) { const moved = drag.moved; drag = null; if (e.type === 'pointerup') endAim(moved); return; } if (drag && !drag.pinch && !drag.moved && pointers.size === 0 && e.type === 'pointerup') handleClick(e.clientX, e.clientY, e.button); if (pointers.size === 0) drag = null; }
canvas.addEventListener('pointerup', endPointer); canvas.addEventListener('pointercancel', endPointer); canvas.addEventListener('contextmenu', (e) => e.preventDefault());
function zoomBy(f) { if (state.mode === 'observer') { state.fov = clamp(state.fov * Math.exp(f), 20, 110); $('fov').value = Math.round(state.fov); } else { const o = state.mode === 'inspect' ? state.cams.inspect : state.cams.overview; o.dist = clamp(o.dist * Math.exp(f), state.mode === 'inspect' ? 20 : 30, 30000); } requestRender(); writeHash(); }
canvas.addEventListener('wheel', (e) => { e.preventDefault(); zoomBy(clamp(e.deltaY, -120, 120) * 0.0012); }, { passive: false });
function handleClick(cx, cy, button) { if (!assets.ready || !lastCam || button !== 0) return;
  if (state.mode === 'observer') { setHint('In the observer view, drag to look around and use the wheel to change the field of view. Switch to the city overview to move the site or the observer.'); return; }
  const ray = rayFromClient(cx, cy, lastCam); if (!ray) return; applyPick(pickRay(ray.o, ray.d)); }
function applyPick(hit) {
  if(imagineCityOpen()){if(hit.type==='building')window.VistaImagineCity?.selectBuilding({asset:hit.ext?'ext_buildings':'buildings',index:hit.index});return;}
  if (state.tool === 'street') { if (hit.type === 'terrain' || hit.type === 'building') placeStreetObserver(hit.point[0],hit.point[1]); else setHint('Choose a mapped street over land. Water and missing model terrain cannot anchor a street viewpoint.'); return; }
  if (state.tool === 'boundary') { if (hit.type === 'terrain' || hit.type === 'building') addBoundaryPoint(hit.point[0], hit.point[1]); else setHint('Choose a point over modelled land. Water and missing terrain cannot anchor a study boundary.'); return; }
  if (hit.type === 'none') { setHint(state.tool === 'rooftop' ? 'No modelled roof under the cursor. Zoom in and choose a visible building roof.' : 'Nothing under the cursor. The placement surface is the active terrain; the outline on the ground marks the model coverage.'); return; }
  if (hit.type === 'water') { setHint(state.tool === 'rooftop' ? 'That is water, not a modelled roof.' : 'That is the water surface. Sites and observers are placed on the active terrain, not on water.'); return; }
  if (hit.type === 'building' && state.tool === 'rooftop') {
    const roof = roofZAt(hit.index, !!hit.ext, hit.point[0], hit.point[1]);
    const clickedRoof = roof && Math.abs(roof.z - hit.point[2]) <= 0.25;
    const point = clickedRoof ? { x: hit.point[0], y: hit.point[1] } : preferredRoofPoint(hit.index, !!hit.ext);
    if (!point) { setHint('No visible modelled roof was found on that building. Try another building.'); return; }
    if (placeRoofObserver(hit.index, !!hit.ext, point.x, point.y)) { setMode('observer'); setHint(clickedRoof ? 'You’re viewing from a roof. Drag to look around, or choose another roof.' : 'You clicked a wall, so you now stand on that building’s roof. Drag to look around, or choose another roof.'); }
    return;
  }
  if (hit.type === 'building' && state.tool === 'multi') { toggleMultiBuilding(hit.index, !!hit.ext); return; }
  if (hit.type === 'building' && state.tool === 'aim') { setHint('That is a building. Drag and view stands on the ground; to stand on a roof, return and choose “From a building”.'); return; }
  if (hit.type === 'building') { state.selected = hit.index; state.selectedExt = !!hit.ext; refreshPanels(); if (state.tool === 'site' || state.tool === 'replace') { $('panel').classList.remove('collapsed'); $('btn-panel-toggle').setAttribute('aria-expanded','true'); $('btn-replace-building').scrollIntoView({block:'nearest'}); } requestRender();
    setHint(state.tool === 'replace' ? 'Building selected. Check its details in the panel, then choose “Replace this building”.' : state.tool === 'site' && state.flow.methods.site === 'point' ? 'That is an existing building. Click open ground, or return and choose “Replace a building”.' : state.tool === 'site' ? 'Building selected. Use its area as a hypothetical replacement site, or click open ground.' : state.tool === 'observer' ? 'That is an existing building. The ground observer stands on terrain; use Rooftop observer to stand on a roof.' : 'Building selected (information only). To use a building, go to Site › Replace a building, or View › From a building.'); return; }
  const p = hit.point;
  if (state.tool === 'replace' || state.tool === 'multi') { state.selected = null; refreshPanels(); requestRender(); setHint(state.tool === 'multi' ? 'That is open ground. Click existing buildings to add them to the group.' : 'That is open ground. Click an existing building to replace it.'); return; }
  if (state.tool === 'aim') { if (placeObserver(p[0], p[1], 'exploratory')) endAim(false); return; }
  if (state.tool === 'site') {
    if (landZAt(p[0],p[1]) === null) { setHint('That point is water or outside modelled land. Choose another location.'); return; }
    requestSiteConfirmation(p[0],p[1]);
  }
  else if (state.tool === 'observer') { if (placeObserver(p[0], p[1], 'exploratory')) setHint(`Exploratory observer placed at x ${fmt(p[0])}, y ${fmt(p[1])} m (terrain z ${fmt(p[2])} m). Use “Look toward proposal”.`); }
  else if (state.tool === 'rooftop') setHint('Choose a modelled roof surface. Use the ground Observer tool for terrain locations.');
  else { state.selected = null; refreshPanels(); requestRender(); setHint(`Terrain at x ${fmt(p[0])}, y ${fmt(p[1])}, z ${fmt(p[2])} m (model-relative, unverified).`); }
}
let pendingSite = null;
function requestSiteConfirmation(x,y,source='plan') {
  pendingSite={x,y,source};
  $('site-confirm-title').textContent=state.site ? 'Move your building here?' : 'Place your building here?';
  $('site-confirm-description').textContent=state.site ? 'Confirm to move your study site to the location you clicked. Cancel keeps your current site.' : 'Confirm to set the location you clicked as your study site, or cancel to choose another spot.';
  if(source==='coordinates'){const ll=window.VistaGeoreference.modelToLonLat(x,y);$('site-confirm-description').textContent=`Approximate location ${ll.lat.toFixed(6)}°, ${ll.lon.toFixed(6)}°; model X ${fmt(x,2)}, Y ${fmt(y,2)} m. Confirm to use this point as your study site and clear its drawn boundary. Cancel keeps the current site.`;}
  $('site-placement-dialog').showModal(); $('btn-confirm-site').focus();
}
function confirmSitePlacement() {
  const point=pendingSite; if(!point) return false;
  pendingSite=null; $('site-placement-dialog').close();
  if(!placeSite(point.x,point.y)) return false;
  if(point.source==='coordinates'){state.flow.methods.site='point';state.flow.stage='site';}
  state.flow.alt.place='spot'; refreshFlowUI();
  setHint('Site confirmed. Click elsewhere to review a new location, or proceed to Build.'); return true;
}
function cancelSitePlacement() {
  pendingSite=null; $('site-placement-dialog').close();
  setHint('Placement cancelled. Click another location on the plan when you are ready.'); $('gl').focus();
}
$('btn-confirm-site').addEventListener('click',confirmSitePlacement);
$('btn-cancel-site-placement').addEventListener('click',cancelSitePlacement);
$('site-placement-dialog').addEventListener('cancel',e=>{e.preventDefault();cancelSitePlacement();});

function placeSite(x, y, keepRemovals = false) { const z = landZAt(x, y); if (z === null) { setHint('That point is water or outside modelled land. The site was not placed.'); return false; } if (!keepRemovals) { state.removed=[]; state.showExisting=false; } state.site = { x, y, z }; state.boundary = []; state.selected = null; state.check.result = null; refreshPanels(); requestRender(); writeHash(); return true; }
function placeObserver(x, y, source) { const g = groundZAt(x, y); if (!g) { setHint('That point has neither terrain nor water in the model; the observer was not placed.'); return false; } state.observer = { x, y, z: g.z, ground: g.source }; state.observerSource = source || 'exploratory'; if (source !== 'origin') state.viewpointObserver = null; if (proposalBox()) aimAtProposal(); refreshPanels(); requestRender(); writeHash(); return true; }
let observerMoveMessage='';
function moveObserver(key,distance=1){
  if(!assets.ready||state.mode!=='observer'||!state.observer)return false;
  prepareStreetQueries();const roof=state.observerSource==='rooftop'?state.observer.building:null;
  const surfaceAt=(x,y)=>roof?roofZAt(roof.index,roof.source==='extension',x,y)?.z??null:streetSamplers.land(x,y);
  const parts=proposalShown()?proposalParts():[];
  const canOccupy=(x,y,z)=>{
    for(const [dx,dy] of [[0,0],[0.3,0],[-0.3,0],[0,0.3],[0,-0.3]]){
      const px=x+dx,py=y+dy,edge=surfaceAt(px,py);if(edge===null||Math.abs(edge-z)>0.8)return false;
      if(parts.some(p=>p.box[2]<z+state.eyeH+0.2&&p.box[5]>z+0.2&&SiteGeometry.pointInPolygon([px,py],partFootprint(p))))return false;
      for(const b of streetBoxQuery(px,py)){
        if((isRemoved(b.index,b.ext)&&!state.showExisting)||(roof&&b.index===roof.index&&b.ext===(roof.source==='extension'))||b.box[2]>z+state.eyeH+0.2)continue;
        const top=roofZAt(b.index,b.ext,px,py);if(top&&top.z>z+0.4)return false;
      }
    }return true;
  };
  const result=ObserverNavigation.move({position:state.observer,yaw:state.cams.observer.yaw,key,distance,surfaceAt,canOccupy});
  if(result.moved){
    state.observer=result.position;state.viewpointObserver=null;
    if(state.observerSource==='origin'){state.observerSource='exploratory';state.flow.methods.view='drag';}
    else if(state.observerSource==='street'&&!StreetGeometry.nearest(state.observer.x,state.observer.y,streetRoadArrays(),20)){state.observerSource='exploratory';state.flow.methods.view='drag';}
    refreshPanels();requestRender();writeHash();
  }
  const message=result.blocked?(roof?'Roof edge or obstruction reached. Choose another rooftop to move farther.':'Path blocked. Try sidestepping or choose another viewpoint.'):'Viewpoint moved. Use Face my building to centre the proposal again.';
  if(message!==observerMoveMessage){observerMoveMessage=message;setHint(message);}
  return result.moved;
}
function lookObserver(key,factor=1){
  if(state.mode!=='observer'||!state.observer)return false;
  const k=key.toLowerCase(),o=state.cams.observer;
  if(k==='j')o.yaw+=0.045*factor;else if(k==='l')o.yaw-=0.045*factor;
  else if(k==='i')o.pitch=clamp(o.pitch+0.035*factor,-1.48,1.48);else if(k==='k')o.pitch=clamp(o.pitch-0.035*factor,-1.48,1.48);else return false;
  requestRender();writeHash();return true;
}
function streetRoadArrays() { return assets.streetRoads?[assets.streetRoads]:[assets.raw.roads?.pos,assets.raw.ext_roads?.pos].filter(Boolean); }
function usableStreetPoint(point) {
  prepareStreetQueries();const z=streetSamplers.land(point.x,point.y);if(z===null)return false;
  for(const b of streetBoxQuery(point.x,point.y)){if((isRemoved(b.index,b.ext)&&!state.showExisting)||b.box[2]>z+2)continue;const roof=roofZAt(b.index,b.ext,point.x,point.y);if(roof&&roof.z>z+0.8)return false;}
  return !proposalShown()||!proposalParts().some(p=>p.box[2]<z+2&&SiteGeometry.pointInPolygon([point.x,point.y],partFootprint(p)));
}
function placeStreetObserver(x,y) {
  const point=StreetGeometry.nearest(x,y,streetRoadArrays(),40,usableStreetPoint);
  if(!point){$('street-status').textContent='No usable mapped street within 40 m. Zoom in and click a road; this location may be water, covered by a building, or outside the street data.';setHint($('street-status').textContent);return false;}
  const z=landZAt(point.x,point.y); if(z===null)return false;
  state.observer={x:point.x,y:point.y,z,ground:'terrain'};state.observerSource='street';state.viewpointObserver=null;state.eyeH=1.6;$('eye-h').value=state.eyeH;
  const P=proposalBox(); if(P){aimAtProposal();const eye=observerEye(),distances=proposalParts().flatMap(p=>partFootprint(p).map(q=>Math.hypot(q[0]-point.x,q[1]-point.y))),near=Math.max(0.5,Math.min(...distances)),bottom=Math.atan2(P.base-eye[2],near),top=Math.atan2(P.top-eye[2],near);state.cams.observer.pitch=(bottom+top)/2;state.fov=clamp(Math.max(60,(top-bottom)*180/Math.PI*1.45),20,105);$('fov').value=Math.round(state.fov);}
  setMode('observer');revealMap();refreshPanels();requestRender();writeHash();
  $('street-status').textContent=`Street viewpoint set${point.distance>0.5?' · snapped '+fmt(point.distance)+' m to the mapped road':''}. Eye ${fmt(state.eyeH)} m above approximate ground.`;
  setHint('Viewing your proposal from the street. Drag to look around, scroll to adjust the field of view, or pick another street.');return true;
}
let streetChoicesKey='',streetViewChoices=[];
function refreshStreetChoices(){
  if(!assets.ready || state.flow.methods.view!=='street')return;
  const P=proposalBox(),list=$('street-nearby'); if(!P){list.replaceChildren();streetViewChoices=[];return;}
  const key=JSON.stringify([P.box,state.removed,state.cleared,state.showExisting]);if(key===streetChoicesKey)return;streetChoicesKey=key;list.replaceChildren();
  const seen=StreetGeometry.nearestCandidates(P.cx,P.cy,streetRoadArrays(),400,usableStreetPoint,{limit:6,minSeparation:50,minDistance:40});streetViewChoices=seen;
  for(const point of seen){
    const dx=point.x-P.cx,dy=point.y-P.cy,dir=['N','NE','E','SE','S','SW','W','NW'][(Math.round(Math.atan2(dx,dy)/(Math.PI/4))+8)%8];
    const button=document.createElement('button');button.type='button';button.className='btn';button.textContent=`${Math.round(Math.hypot(dx,dy))} m ${dir}`;button.addEventListener('click',()=>placeStreetObserver(point.x,point.y));list.appendChild(button);
  }
  if(!seen.length)list.textContent='No nearby street positions found. Choose a mapped road on the plan.';
}
function placeRoofObserver(index, ext, x, y) {
  const c = (ext ? assets.extIndex : assets.index)?.columns;
  if (!c || !Number.isInteger(index) || index < 0 || index >= c.index_offset.length || (isRemoved(index, ext) && !state.showExisting)) { setHint('That building is unavailable in the proposed scene. Restore it or compare existing buildings first.'); return false; }
  const roof = roofZAt(index, ext, x, y); if (!roof) { setHint('No modelled roof surface covers that point.'); return false; }
  const highest = highestRoofAtXY(x, y); if (!highest || highest.z > roof.z + 0.2) { setHint('A higher modelled roof covers that position. Choose the visible roof surface.'); return false; }
  state.observer = { x, y, z: roof.z, ground: 'roof', building: { id: String(c.osm_id[index]), source: ext ? 'extension' : 'supplied', index, height_m: c.height_m[index], height_source: HS[c.height_source[index]] || HS[3] } };
  state.observerSource = 'rooftop'; state.viewpointObserver = null;
  if (proposalBox()) aimAtProposal(); refreshPanels(); requestRender(); writeHash(); return true;
}
function placeRooftopAtXY(x, y) {
  const best = highestRoofAtXY(x, y);
  if (!best) { setHint('No modelled rooftop covers that location. Choose a roof footprint in the aerial view.'); return false; }
  if (!placeRoofObserver(best.index, best.ext, x, y)) return false;
  setMode('observer'); revealMap(); setHint('Rooftop observer placed on the modelled roof. Height and visibility are exploratory and unverified.'); return true;
}
function viewFromSelectedRoof() {
  if (state.selected === null) return false;
  const roof = preferredRoofPoint(state.selected, !!state.selectedExt);
  if (!roof) { setHint('No usable modelled roof surface was found on this building.'); return false; }
  if (!placeRoofObserver(state.selected, !!state.selectedExt, roof.x, roof.y)) return false;
  setMode('observer'); revealMap(); setHint('You’re viewing from a roof. Drag to look around, or choose another roof.'); return true;
}
let nearbyRoofChoices = [];
function refreshNearbyRooftops() {
  const list = $('rooftop-nearby'); if (!list || !assets.ready) return;
  const centre = state.site || (state.observerSource === 'rooftop' ? state.observer : null);
  if (!centre) { nearbyRoofChoices = []; delete list.dataset.key; list.replaceChildren(); return; }
  const key = `${centre.x.toFixed(1)},${centre.y.toFixed(1)},${[...state.removed, ...state.cleared].map(q => (q.ext ? 'e' : 's') + q.id).join(';')},${state.showExisting},${state.observer?.building ? state.observer.building.source + state.observer.building.index : ''}`; // 6: auto-demolished roofs are not offered
  if (list.dataset.key === key) return; list.dataset.key = key; nearbyRoofChoices = [];
  const nearby = [];
  for (const ext of [false, true]) { const c = (ext ? assets.extIndex : assets.index)?.columns; if (!c) continue;
    for (let i = 0; i < c.bbox.length; i++) { if (isRemoved(i, ext) && !state.showExisting) continue;
      const b = c.bbox[i], x = clamp(centre.x, b[0], b[3]), y = clamp(centre.y, b[1], b[4]), distance = Math.hypot(centre.x - x, centre.y - y);
      if (distance <= 600) nearby.push({ i, ext, distance, id: String(c.osm_id[i]), top: b[5] });
    }
  }
  nearby.sort((a, b) => a.distance - b.distance || b.top - a.top);
  const fragment = document.createDocumentFragment(); let count = 0, shownChosen = false;
  for (const q of nearby) { const roof = preferredRoofPoint(q.i, q.ext); if (!roof) continue;
    nearbyRoofChoices.push({ index: q.i, ext: q.ext, x: roof.x, y: roof.y });
    const button = document.createElement('button'); button.type = 'button'; button.className = 'btn';
    const dx = roof.x - centre.x, dy = roof.y - centre.y, compass = ['E','NE','N','NW','W','SW','S','SE'][Math.round(((Math.atan2(dy, dx) + 2 * Math.PI) % (2 * Math.PI)) / (Math.PI / 4)) % 8];
    const ground = terrainZAt(roof.x, roof.y), height = ground === null ? null : Math.max(0, roof.z - ground);
    const chosen = state.observerSource === 'rooftop' && state.observer?.building?.index === q.i && (state.observer.building.source === 'extension') === !!q.ext; button.setAttribute('aria-pressed', String(chosen)); button.classList.toggle('roof-chosen', chosen); if (chosen) shownChosen = true;
    button.textContent = `${chosen ? 'Selected · ' : ''}${Math.round(Math.hypot(dx, dy))} m ${compass} · roof${height === null ? '' : ' about ' + Math.round(height) + ' m high'}`;
    button.title = `${q.ext ? 'Extension' : 'Supplied'} building ${q.id}; model height unverified`; button.addEventListener('click', () => { if (placeRoofObserver(q.i, q.ext, roof.x, roof.y)) { setMode('observer'); revealMap(); } });
    fragment.appendChild(button); if (++count >= 6) break;
  }
  // a roof chosen farther away than the nearest six still heads the list, so the current choice is always visible
  if (!shownChosen && state.observerSource === 'rooftop' && state.observer && centre !== state.observer) { const o = state.observer, dx = o.x - centre.x, dy = o.y - centre.y, compass = ['E','NE','N','NW','W','SW','S','SE'][Math.round(((Math.atan2(dy, dx) + 2 * Math.PI) % (2 * Math.PI)) / (Math.PI / 4)) % 8], g = terrainZAt(o.x, o.y);
    nearbyRoofChoices.unshift({ index: o.building.index, ext: o.building.source === 'extension', x: o.x, y: o.y });
    const b = document.createElement('button'); b.type = 'button'; b.className = 'btn roof-chosen'; b.setAttribute('aria-pressed', 'true'); b.textContent = `Selected · ${Math.round(Math.hypot(dx, dy))} m ${compass} · roof${g === null ? '' : ' about ' + Math.round(Math.max(0, o.z - g)) + ' m high'}`; b.addEventListener('click', () => setMode('observer')); fragment.insertBefore(b, fragment.firstChild); count++; }
  if (!count) { const help = document.createElement('p'); help.className = 'small muted'; help.textContent = 'No modelled roofs within 600 m of this site point.'; fragment.appendChild(help); }
  const hadFocus = list.contains(document.activeElement); list.replaceChildren(fragment); if (hadFocus) list.querySelector('[aria-pressed="true"]')?.focus();
}
function invalidateRoofObserver() {
  const b = state.observer?.building; if (state.observerSource !== 'rooftop' || !b) return false;
  if (!(isRemoved(b.index, b.source === 'extension') && !state.showExisting)) return false;
  state.observer = null; state.observerSource = 'exploratory'; if (state.mode === 'observer') setMode('overview');
  setHint('The rooftop viewpoint was cleared because its building is hidden in the proposed scene (replaced or demolished). Choose another roof.'); return true;
}
function aimAtProposal() { const eye = observerEye(), tgt = proposalCentre(); if (!eye || !tgt) return false; const d = V.sub(tgt, eye); state.cams.observer.yaw = Math.atan2(d[1], d[0]); state.cams.observer.pitch = Math.atan2(d[2], Math.hypot(d[0], d[1])); return true; }
function lookTowardProposal() { if (!state.observer) { setHint('Place an observer first (Step 3).'); return false; } if (!proposalBox()) { setHint('Define a proposal first (Steps 1–2).'); return false; } aimAtProposal(); setMode('observer'); return true; }
function setMode(mode, quiet=false) {
  if (mode === 'observer' && !state.observer) { setHint('Choose a viewpoint first (3 · View).'); return false; }
  if (mode === 'inspect' && !proposalBox()) { setHint('Build a proposal first (2 · Build).'); return false; }
  state.mode = mode; floatBtn.classList.toggle('hidden', mode === 'overview');
  for (const m of ['overview', 'observer', 'inspect']) $('mode-' + m).classList.toggle('active', m === mode); $('btn-plan').classList.toggle('active', mode === 'plan'); $('tools').classList.toggle('hidden', mode === 'observer'); $('inspect-shortcuts').classList.toggle('hidden', mode !== 'inspect');
  if (mode === 'observer') { setHint(state.observerSource === 'rooftop' ? 'You’re viewing from a roof. Drag to look around, or choose another roof.' : 'Eye-level view: drag to look around; “Face my building” turns you back to it.'); }
  else if (mode === 'inspect') setHint('Orbit around the proposal. The camera moves; the building does not.');
  if (state.flow.stage === 'view' && state.flow.methods.view === 'cone') setHint(protectedViewHint());
  refreshCaption();
  if (!quiet) { refreshPanels(); requestRender(); writeHash(); } return true;
}
function setTool(t) { if (t !== 'boundary' && state.drawing) { state.drawing = null; refreshStudyUI(); } state.tool = t; for (const k of ['site', 'observer', 'rooftop', 'identify', 'boundary']) $('tool-' + k)?.classList.toggle('active', k === t); if (t === 'rooftop') planView(); else if (state.mode === 'observer') setMode('overview');
  setHint(t === 'boundary' ? 'Click the corners of your study area. Finish boundary or press Enter; Esc cancels.' : t === 'site' ? 'Click open ground for a site point, or select a building for a replacement study.' : t === 'observer' ? 'Ground observer: click open terrain (Plan helps). Or pick a view and stand at its origin.' : t === 'rooftop' ? 'Rooftop observer: click a visible roof from above. The modelled height is unverified.' : 'Identify: click a building or the ground.'); }
// the caption under the view always says what a click or drag does right now (mode × active tool)
function refreshCaption() { const cap = $('view-caption'); if (!cap) return; const m = state.mode, t = state.tool, red = !window.VistaViewcone?.enabled && !state.check.unknown && state.check.result?.overall_result === 'INTERSECTS' && proposalShown() ? ' Red marks the part above your study ceiling, not a City limit.' : '';
  const free = state.flow.stage === 'view' || !!selectedCone() || !!state.observer || m === 'inspect';
  const enter = state.flow.methods.view === 'cone' ? ' Choose “View from here” to enter the selected viewpoint.' : '';
  if (m === 'observer') { cap.textContent = `${state.observerSource === 'origin' ? 'Protected viewpoint ' + state.viewpoint + ' · ' + (selectedCone()?.name || '') : state.observerSource === 'rooftop' ? 'From a rooftop (height approximate)' : state.observerSource === 'street' ? 'From the street (modelled)' : 'From the ground'}, eye ${fmt(state.eyeH)} m up · ↑/↓ forward/back · ←/→ sidestep · Shift faster · drag to look.${red}`; return; }
  if(t==='street'){cap.textContent='Street view · click a mapped road to face your proposal · viewpoint snaps within 40 m · drag to pan · scroll to zoom.';return;}
  if (m === 'inspect') { cap.textContent = 'Free inspection · orbit your building · scroll to zoom.' + enter + red; return; }
  const act = { site: state.site ? 'click open ground to move your site' : 'click open ground to place your site', boundary: 'click each corner of your site; Enter finishes, Esc cancels', rooftop: 'click a roof to stand on it', replace: 'click a building to select it', multi: 'click buildings to add or remove them', aim: 'press a spot to stand there, drag toward what you want to see, release' }[t];
  const nav = t === 'aim' ? 'right-drag to pan' : m === 'plan' ? 'drag to pan' : 'drag to orbit · right-drag to pan';
  cap.textContent = `${free ? 'Free inspection · ' : ''}${m === 'plan' ? 'Plan · north up' : 'City'} · ${act ? act + ' · ' : ''}${nav} · scroll to zoom.${free ? enter : ''}${red}`;
}
function setHint(msg) { $('hint').textContent = msg; }
function resetToContext() { let e = assets.manifest ? assets.manifest.extent_m.scene_bbox : [-3000, -2300, 0, 2600, 3900, 0]; if (assets.extension) { const t = assets.extension.target_extent_model_m; e = [t[0], t[1], 0, t[2], t[3], 0]; }
  state.cams.overview = { target: [(e[0] + e[3]) / 2, (e[1] + e[4]) / 2, 20], dist: Math.max(e[3]-e[0],e[4]-e[1])*1.8, az: -1.15, el: 0.85 }; setMode('overview'); }
function planView() { if (state.mode === 'inspect' && state.site) { state.cams.overview.target = [state.site.x, state.site.y, state.site.z]; state.cams.overview.dist = Math.max(220, state.cams.inspect.dist); } setMode('plan'); }
function focusLocation(x, y) {
  if (!assets.ready || !Number.isFinite(x) || !Number.isFinite(y)) return false;
  const e = assets.extension?.target_extent_model_m || assets.manifest?.extent_m.scene_bbox;
  if (!e || x < e[0] || x > e[e.length === 4 ? 2 : 3] || y < e[1] || y > e[e.length === 4 ? 3 : 4]) return false;
  const z = terrainZAt(x, y) ?? groundZAt(x, y)?.z ?? 0;
  state.cams.overview.target = [x, y, z]; state.cams.overview.dist = 500; state.selected = null; state.selectedExt = false;
  setMode('plan'); return true; // the address panel writes its own status
}
function inspectFrom(az, el) { if (!setMode('inspect')) return; const o = state.cams.inspect; if (az !== null) o.az = az; if (el !== null) o.el = el; requestRender(); writeHash(); }

// ------------------------------------------------------------------ measured site studies (visual hypotheses)
function formatArea(area) { return Math.round(area).toLocaleString() + ' m²'; }
// Hidden in the proposed scene: buildings replaced as the site, plus buildings the proposal overlaps (treated as demolished).
function isRemoved(index, ext) { return state.removed.some(r => r.index === index && r.ext === ext) || state.cleared.some(r => r.index === index && r.ext === ext); }
function isReplaced(index, ext) { return state.removed.some(r => r.index === index && r.ext === ext); }
// Existing buildings whose modelled roof lies under the proposal footprint (shrunk 0.5 m, so shared walls do not count), or whose corners fall inside it.
let clearedKey = '';
let buildingAssemblyGraph = null;
function getBuildingAssemblyGraph() {
  if (!buildingAssemblyGraph) {
    const records = [];
    for (const ext of [false, true]) {
      const c = (ext ? assets.extIndex : assets.index)?.columns, mesh = assets.raw[ext ? 'ext_buildings' : 'buildings'];
      if (!c || !mesh) continue;
      for (let index = 0; index < c.bbox.length; index++) {
        const record={key:(ext?'e':'s')+index,index,ext,id:c.osm_id[index],box:c.bbox[index],height:c.height_m[index],heightSource:c.height_source?.[index],osmType:c.osm_type?.[index],mesh,start:c.index_offset[index],count:c.index_count[index]};
        // Extract orientation before display cleanup compacts the source index ranges.
        record.wallAngle=BuildingMaterials.frameAngle(record);records.push(record);
      }
    }
    buildingAssemblyGraph = BuildingAssembly.createGraph(records);
  }
  return buildingAssemblyGraph;
}
function prepareBuildingDisplay() {
  const graph = getBuildingAssemblyGraph(), omitted = BuildingAssembly.unsupportedParts(graph);
  assets.modelCleanup = { count: omitted.size, fragments: [...omitted].map(key => ({ key, osm_id: graph.records.get(key).id })), sourceFilesPreserved: true, reason: 'Small elevated source fragments without modelled supports; derived display indices only.' };
  for (const ext of [false, true]) {
    const key = ext ? 'ext_buildings' : 'buildings', catalogue = ext ? assets.extIndex : assets.index, raw = assets.raw[key];
    if (!catalogue || !raw) continue;
    const rows = [...omitted].filter(id => graph.records.get(id).ext === ext).map(id => graph.records.get(id).index);
    if (rows.length) {
      const c = catalogue.columns, compact = BuildingAssembly.compactIndex(raw.idx, c.index_offset, c.index_count, rows);
      assets.raw[key] = { ...raw, idx: compact.idx };
      catalogue.columns = { ...c, index_offset: compact.index_offset, index_count: compact.index_count };
    }
    assets.meshes[key] = makeMesh(assets.raw[key].pos, assets.raw[key].idx);
  }
}
function assemblyRemovalKeys() {
  if (!assets.ready) return new Set();
  getBuildingAssemblyGraph();
  return BuildingAssembly.expandRemoved(buildingAssemblyGraph, [...state.removed, ...state.cleared].map(r => (r.ext ? 'e' : 's') + r.index));
}
// Convex footprints (rotated blocks and imported part boxes) can be compared
// directly with projected source triangles. This stays bounded by the mesh
// size even when an imported object's bounding box spans kilometres.
function planBoxesOverlap(a, b) { return a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3]; }
function footprintRecord(points) {
  const box = [Infinity, Infinity, -Infinity, -Infinity], axes = []; let signedDoubleArea = 0;
  for (let i = 0; i < points.length; i++) {
    const [x, y] = points[i], [nx, ny] = points[(i + 1) % points.length];
    signedDoubleArea += x * ny - nx * y;
    box[0] = Math.min(box[0], x); box[1] = Math.min(box[1], y);
    box[2] = Math.max(box[2], x); box[3] = Math.max(box[3], y);
    if (x !== nx || y !== ny) axes.push([y - ny, nx - x]);
  }
  return { points, box, axes, area: Math.abs(signedDoubleArea) / 2 };
}
function footprintIndex(records) {
  const cells = new Map(), broad = [], cellSize = 64, cellLimit = 64;
  for (const record of records) {
    const [x0, y0, x1, y1] = record.box, ix0 = Math.floor(x0 / cellSize), iy0 = Math.floor(y0 / cellSize), ix1 = Math.floor(x1 / cellSize), iy1 = Math.floor(y1 / cellSize);
    if ((ix1 - ix0 + 1) * (iy1 - iy0 + 1) > cellLimit) { broad.push(record); continue; }
    for (let ix = ix0; ix <= ix1; ix++) for (let iy = iy0; iy <= iy1; iy++) {
      const key = `${ix},${iy}`; if (!cells.has(key)) cells.set(key, []); cells.get(key).push(record);
    }
  }
  return (box) => {
    const [x0, y0, x1, y1] = box, ix0 = Math.floor(x0 / cellSize), iy0 = Math.floor(y0 / cellSize), ix1 = Math.floor(x1 / cellSize), iy1 = Math.floor(y1 / cellSize);
    const result = [], seen = new Set(), add = record => { if (!seen.has(record) && planBoxesOverlap(record.box, box)) { seen.add(record); result.push(record); } };
    broad.forEach(add);
    if ((ix1 - ix0 + 1) * (iy1 - iy0 + 1) > cellLimit) records.forEach(add);
    else for (let ix = ix0; ix <= ix1; ix++) for (let iy = iy0; iy <= iy1; iy++) for (const record of cells.get(`${ix},${iy}`) || []) add(record);
    return result;
  };
}
function projectedTriangleMeetsFootprint(fp, ax, ay, bx, by, cx, cy) {
  const tri = [[ax, ay], [bx, by], [cx, cy]];
  const triangleArea = Math.abs((bx - ax) * (cy - ay) - (by - ay) * (cx - ax)) / 2;
  const strict = fp.area > 1e-10 && triangleArea > 1e-10;
  const axes = [...fp.axes, [ay - by, bx - ax], [by - cy, cx - bx], [cy - ay, ax - cx]];
  for (const [nx, ny] of axes) {
    if (nx === 0 && ny === 0) continue;
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const [x, y] of fp.points) { const q = nx * x + ny * y; a0 = Math.min(a0, q); a1 = Math.max(a1, q); }
    for (const [x, y] of tri) { const q = nx * x + ny * y; b0 = Math.min(b0, q); b1 = Math.max(b1, q); }
    const tolerance = 1e-7 * Math.hypot(nx, ny);
    if (strict ? (a1 <= b0 + tolerance || b1 <= a0 + tolerance) : (a1 < b0 - tolerance || b1 < a0 - tolerance)) return false;
  }
  return true;
}
function indexedBuildingMeetsFootprints(raw, start, count, footprints) {
  const P = raw.pos, I = raw.idx, end = start + count;
  for (let i = start; i < end; i += 3) {
    const a = I[i] * 3, b = I[i + 1] * 3, c = I[i + 2] * 3;
    const ax = P[a], ay = P[a + 1], bx = P[b], by = P[b + 1], cx = P[c], cy = P[c + 1];
    const box = [Math.min(ax, bx, cx), Math.min(ay, by, cy), Math.max(ax, bx, cx), Math.max(ay, by, cy)];
    for (const fp of footprints) if (planBoxesOverlap(box, fp.box) && projectedTriangleMeetsFootprint(fp, ax, ay, bx, by, cx, cy)) return true;
  }
  return false;
}
function updateCleared() {
  const P = state.clearOverlaps && state.flow.guided && state.flow.methods.build && assets.ready ? proposalBox() : null; // guided studies, once a build method is chosen
  const fps = P ? proposalParts().map(partFootprint) : []; const key = JSON.stringify([fps, state.removed.map(r => (r.ext ? 'e' : 's') + r.index)]); if (key === clearedKey) return false; clearedKey = key;
  const before = state.cleared.map(r => (r.ext ? 'e' : 's') + r.index).join(); state.cleared = []; state.clearanceWarning = null;
  if (fps.length) {
    const shrunk = fps.map(fp => { const cx = fp.reduce((a, q) => a + q[0], 0) / fp.length, cy = fp.reduce((a, q) => a + q[1], 0) / fp.length;
      let inr = Infinity; for (let i = 0; i < fp.length; i++) { const a = fp[i], b = fp[(i + 1) % fp.length], ex = b[0] - a[0], ey = b[1] - a[1], L = Math.hypot(ex, ey) || 1; inr = Math.min(inr, Math.abs((cx - a[0]) * ey - (cy - a[1]) * ex) / L); }
      const k = Math.max(0, 1 - 0.5 / Math.max(inr, 0.6)); return footprintRecord(fp.map(q => [cx + (q[0] - cx) * k, cy + (q[1] - cy) * k])); });
    const findFootprints = footprintIndex(shrunk), bb = [Infinity, Infinity, -Infinity, -Infinity];
    for (const fp of shrunk) { bb[0] = Math.min(bb[0], fp.box[0]); bb[1] = Math.min(bb[1], fp.box[1]); bb[2] = Math.max(bb[2], fp.box[2]); bb[3] = Math.max(bb[3], fp.box[3]); }
    let tooMany = false;
    for (const ext of [false, true]) { const cat = ext ? assets.extIndex : assets.index, raw = assets.raw[ext ? 'ext_buildings' : 'buildings']; const c = cat?.columns; if (!c || !raw) continue;
      for (let i = 0; i < c.bbox.length; i++) { const b = c.bbox[i], buildingBox = [b[0], b[1], b[3], b[4]];
        if (!planBoxesOverlap(buildingBox, bb) || isReplaced(i, ext)) continue;
        const candidates = findFootprints(buildingBox); if (!candidates.length) continue;
        if (indexedBuildingMeetsFootprints(raw, c.index_offset[i], c.index_count[i], candidates)) {
          if (state.cleared.length >= 2000) { tooMany = true; break; }
          state.cleared.push({ index: i, ext, id: c.osm_id[i] });
        }
      }
      if (tooMany) break;
    }
    if (tooMany) { state.cleared = []; state.clearanceWarning = 'Automatic demolition was skipped because the imported footprint meets more than 2,000 existing buildings. Export only the proposed building geometry to use this study assumption.'; }
  }
  const hidden = new Set([...state.removed, ...state.cleared].map(r => (r.ext ? 'e' : 's') + r.index));
  for (const key of assemblyRemovalKeys()) if (!hidden.has(key)) {
    const r = buildingAssemblyGraph.records.get(key); state.cleared.push({ index: r.index, ext: r.ext, id: r.id });
  }
  const changed = before !== state.cleared.map(r => (r.ext ? 'e' : 's') + r.index).join(); if (changed) { invalidateRoofObserver(); requestRender(); } return changed;
}
function refreshStudyUI() {
  const pts=state.drawing || state.boundary; const valid = pts.length >= 3 && !SiteGeometry.validate(pts), m = valid ? SiteGeometry.metrics(pts) : null;
  $('site-metrics').innerHTML = m ? `<b>${formatArea(m.area)}</b><b class="metric-sub">${fmt(m.area / 10000, 3)} ha</b><span>${fmt(m.perimeter, 1)} m perimeter · horizontal plan area</span><span>${state.drawing ? "Draft boundary" : "User-defined study boundary"} · not a parcel; may enclose water</span>` : state.site ? '<span>Point site: no area is measured. Draw a boundary (B) if you want one.</span>' : ({ replace: '<b>Pick a building</b><span>Select a building, then choose “Replace this building”.</span>', multi: '<b>Pick buildings</b><span>Select buildings, then choose “Use as site”.</span>' }[state.flow.methods.site] || '<b>Place your site</b><span>Find the area if you need to, then pick a spot or draw a boundary.</span>');
  if (m && !state.drawing && proposalBox()) { const outside = proposalParts().some(p => { const fp=partFootprint(p); return ProposalGeometry.planOverlap(state.boundary,fp).area < Math.abs(SiteGeometry.metrics(fp).area)-0.01; }); if (outside) $('site-metrics').innerHTML += '<span class="site-warning">Proposal extends outside the study boundary.</span>'; }
  $('btn-fit-site').disabled = !state.site; $('btn-focus').disabled = !state.site;
  $('btn-replace-building').classList.toggle('hidden', state.selected === null);
  $('replacement-controls').classList.toggle('hidden', !state.removed.length);
  $('replacement-info').textContent = `${state.removed.length} existing building(s) proposed for removal in this study. ${state.showExisting ? 'Existing comparison visible.' : 'Hidden in the proposed scene.'} Source geometry is retained.`;
  $('chk-existing').checked = state.showExisting; $('scene-status').textContent=state.removed.length ? (state.showExisting ? 'Existing comparison · proposal hidden' : 'Proposed scene · '+state.removed.length+' hypothetical removal(s)') : 'Study scene';
  $('draw-floating-actions').classList.toggle('hidden', !state.drawing); $('btn-finish-map').disabled=!state.drawing || state.drawing.length<3; $('draw-actions').classList.toggle('hidden', !state.drawing); $('draw-prompt').classList.toggle('hidden', !state.drawing);
  $('btn-finish-boundary').disabled = !state.drawing || state.drawing.length < 3; $('btn-undo-vertex').disabled = !state.drawing || !state.drawing.length;
  if (state.drawing) $('draw-prompt').textContent = `${state.drawing.length} corners · click to add · Enter to finish · Esc to cancel`;
  for (const key of Object.keys(state.layers)) $('layer-' + key).checked = state.layers[key];
}
function revealMap() { if (matchMedia('(max-width: 860px)').matches) { $('panel').classList.add('collapsed'); $('btn-panel-toggle').setAttribute('aria-expanded','false'); } }
function beginBoundary() { if (state.flow.stage !== 'site') flowGo('site', { force: true }); state.flow.alt.place = 'boundary'; state.drawing = []; planView(); setTool('boundary'); revealMap(); refreshPanels(); requestRender(); }
function addBoundaryPoint(x,y) {
  if (!state.drawing) state.drawing = [];
  const z = landZAt(x,y); if (z === null) { setHint('No terrain at this corner. Choose modelled land.'); return false; }
  const last = state.drawing[state.drawing.length-1]; if (last && Math.hypot(last[0]-x,last[1]-y) < 0.05) return false;
  if (state.drawing.length >= 100) { setHint('Use at most 100 corners for one study boundary.'); return false; }
  state.drawing.push([x,y]); refreshStudyUI(); requestRender(); return true;
}
function finishBoundary() {
  if (!state.drawing) return false; const err = SiteGeometry.validate(state.drawing);
  if (err) { setHint(err + ' Use Undo vertex to adjust the boundary.'); return false; }
  const pts = state.drawing.map(q => [...q]), m = SiteGeometry.metrics(pts);
  // A concave polygon can have its centroid outside. Use an interior edge midpoint fallback.
  let centre = m.centre; if (!SiteGeometry.pointInPolygon(centre,pts) || landZAt(...centre) === null) centre = pts[0];
  if (!placeSite(...centre, true)) return false;
  state.boundary = pts; state.drawing = null; setTool('site'); refreshPanels(); requestRender(); writeHash();
  setHint(`${formatArea(m.area)} study area measured. Boundary and dimensions are approximate model measurements; parcel ownership, vacancy and eligibility are unknown.`); return true;
}
function cancelBoundary() { state.drawing = null; setTool('site'); refreshPanels(); requestRender(); }
function rectangleSite() {
  if (!state.site) { const t = state.cams.overview.target; if (!placeSite(t[0], t[1], true)) { setHint('The middle of the plan is not over land. Move the plan over land first, then apply the rectangle.'); return false; } }
  const w = Number($('site-width').value), d = Number($('site-depth').value);
  if (!Number.isFinite(w) || !Number.isFinite(d) || w < 2 || d < 2 || w > 2000 || d > 2000) { setHint('Enter widths and depths between 2 and 2,000 metres.'); return false; }
  const pts = SiteGeometry.rectangle(state.site.x-w/2,state.site.y-d/2,w,d);
  if (pts.some(q => landZAt(...q) === null)) { setHint('Some corners fall outside modelled terrain. Reduce the size or draw a boundary over land.'); return false; }
  state.boundary = pts; state.check.result = null; state.flow.alt.place = 'boundary'; refreshPanels(); requestRender(); writeHash(); return true;
}
function replaceSelectedBuilding() {
  if (state.selected === null) return false;
  const index = state.selected, ext = !!state.selectedExt, c = (ext ? assets.extIndex : assets.index).columns, b = c.bbox[index];
  const x = (b[0]+b[3])/2, y = (b[1]+b[4])/2;
  if (!placeSite(x,y,true)) return false;
  if (!isReplaced(index,ext)) state.removed.push({index,ext,id:c.osm_id[index]});
  state.showExisting = false; invalidateRoofObserver(); state.boundary = SiteGeometry.rectangle(b[0],b[1],b[3]-b[0],b[4]-b[1]);
  state.selected = null; refreshPanels(); revealMap(); focusSite(); writeHash();
  setHint('Replacement study created. The boundary is the model building’s bounding rectangle, not its legal lot. Use Draw boundary to refine it. Restore buildings reverses this hypothesis.'); return true;
}
function restoreBuildings() { const replacing = state.flow.methods.site === 'replace' || state.flow.methods.site === 'multi';
  if (replacing) { resetStage('site'); applyFlowTool(); } else { state.removed = []; state.multiSel = []; state.showExisting = false; }
  state.clearOverlaps = false; refreshPanels(); requestRender(); writeHash();
  setHint(replacing ? 'Buildings restored and automatic demolition is off. Choose a building or a group again to set the site.' : 'All context buildings restored, and automatic demolition is off (Build step). Your study boundary and proposal remain.'); }
// in Build, once the height stops changing, the city view refits if the tower's top has left the frame
let refitTimer = null, refitTop = null;
function scheduleRefit() { const P = proposalBox(); if (!P || state.flow.stage !== 'build' || state.mode !== 'overview' || !proposalShown()) return; if (refitTop !== null && Math.abs(P.top - refitTop) < 0.01) return; refitTop = P.top; clearTimeout(refitTimer);
  refitTimer = setTimeout(() => { const Q = proposalBox(); if (!Q || !lastCam || state.mode !== 'overview' || state.flow.stage !== 'build') return; const q = project(lastCam.vp, [Q.cx, Q.cy, Q.top]); if (q[3] <= 0 || q[1] > 0.9 || Math.abs(q[0]) > 1) focusSite(); }, 700); }
function focusSite() {
  if (!state.site) return false; const m = state.boundary.length >= 3 ? SiteGeometry.metrics(state.boundary) : null;
  const span = m ? Math.max(m.bounds[2]-m.bounds[0], m.bounds[3]-m.bounds[1]) : 120;
  const height=proposalBox() ? proposalBox().top-proposalBox().base : 0; state.cams.overview.target = [state.site.x,state.site.y,state.site.z+(state.mode==='plan' ? 0 : height*0.35)]; state.cams.overview.dist = Math.max(240, span * 2.3, state.mode==='plan' ? 0 : height*3);
  setMode(state.mode === 'plan' ? 'plan' : 'overview'); return true;
}
function drawStudyBoundary(cam) {
  const points = state.drawing || state.boundary; if (points.length < 1) return;
  const lines = [], count = points.length - (state.drawing ? 1 : 0);
  // Drape line segments on terrain so the boundary follows hills in orbit view.
  for (let i=0;i<count;i++) { const a=points[i], b=points[(i+1)%points.length], n=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/15));
    for(let j=0;j<n;j++) for(const t of [j/n,(j+1)/n]) { const x=a[0]+(b[0]-a[0])*t, y=a[1]+(b[1]-a[1])*t; lines.push(x,y,(terrainZAt(x,y) ?? state.site?.z ?? 0)+0.8); } }
  gl.disable(gl.DEPTH_TEST); dynDraw(PL,gl.LINES,new Float32Array(lines),null,C.studyBoundary);
  const k=Math.max(0.7,(cam.half || state.cams.overview.dist*0.4)/180);
  for(const [x,y] of points) { const z=(terrainZAt(x,y)||0)+1; dynDraw(PL,gl.LINES,new Float32Array([x-k,y,z,x+k,y,z,x,y-k,z,x,y+k,z]),null,C.studyBoundary); }
  gl.enable(gl.DEPTH_TEST);
}
function drawImportedParcels() {
  const model=state.pmode==='import' && proposalShown() ? state.imported : null, match=model?.parcelMatch;
  if (!match?.polygons?.length || JSON.stringify(match.offset)!==JSON.stringify(importOffset())) return;
  if (!match.displayLines) {
    const lines=[]; let segments=0;
    for(const polygon of match.polygons) for(const ring of polygon) for(let i=0;i<ring.length;i++) {
      const a=ring[i],b=ring[(i+1)%ring.length],n=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/15));
      if(segments+n>15000) { match.displayOmitted=true; continue; }
      segments+=n;
      for(let j=0;j<n;j++) for(const t of [j/n,(j+1)/n]) {
        const x=a[0]+(b[0]-a[0])*t,y=a[1]+(b[1]-a[1])*t;
        lines.push(x,y,(terrainZAt(x,y) ?? state.site?.z ?? 0)+0.9);
      }
    }
    match.displayLines=new Float32Array(lines);
  }
  gl.disable(gl.DEPTH_TEST); dynDraw(PL,gl.LINES,match.displayLines,null,C.studyBoundary); gl.enable(gl.DEPTH_TEST);
}
function refreshImportedParcels() {
  const el=$('import-parcel-info'); if(!el)return;
  const model=state.imported;
  if(!model) { el.textContent=''; return; }
  scheduleImportedParcels(model);
  const match=model.parcelMatch;
  el.textContent=match ? (match.ids?.length ? `${match.ids.length} property parcel${match.ids.length===1?'':'s'} · ` : '')+match.reason+(match.status==='matched-review'?' Separate parcel boundaries are retained; do not use them as a verified merged lot.':'')+(state.boundary.length?' Your drawn study boundary is preserved.':'')+(match.displayOmitted?' Some outline segments exceed the display limit.':'') : '';
}
function updateMapCues(cam) {
  $('map-scale').classList.toggle('hidden', state.mode !== 'plan');
  if (state.mode === 'plan') { const mpp=2*cam.half/canvas.clientHeight, raw=mpp*100, order=10**Math.floor(Math.log10(raw)), nice=[1,2,5,10].map(n=>n*order).filter(n=>n<=raw).pop() || order;
    $('scale-line').style.width=(nice/mpp)+'px'; $('scale-label').textContent=nice>=1000 ? fmt(nice/1000,1)+' km' : nice+' m'; }
  $('north-cue').classList.toggle('hidden',state.mode==='observer');
  const centre=state.mode==='inspect' && proposalCentre() ? proposalCentre() : state.cams.overview.target, a=project(cam.vp,centre), b=project(cam.vp,[centre[0],centre[1]+100,centre[2]]);
  const angle=Math.atan2((b[0]-a[0])*canvas.clientWidth,(b[1]-a[1])*canvas.clientHeight)*180/Math.PI; $('north-cue').querySelector('span').style.transform=`rotate(${angle}deg)`;
}

// ------------------------------------------------------------------ viewpoints (Table 1 + open-data cones)
function selectedCone() { if (!state.viewpoint || !assets.cones || !assets.cones.available) return null; return assets.cones.cones.find((c) => String(c.view_number) === String(state.viewpoint)) || null; }
function populateViews() { const sel = $('view-select'); const rows = assets.guideline ? assets.guideline.table_1 : []; sel.innerHTML = '<option value="">Choose a viewpoint…</option>';
  for (const r of rows) { const o = document.createElement('option'); o.value = r.reference; o.textContent = `${r.reference} — ${r.name}`; sel.appendChild(o); } sel.value = state.viewpoint || ''; }
function selectView(ref) { const changedOrigin = state.observerSource === 'origin' && state.observer && (ref || null) !== state.viewpoint, leaveObserver = changedOrigin && state.mode === 'observer';
  if (changedOrigin) { state.observer = null; state.observerSource = 'exploratory'; } state.viewpoint = ref || null; $('view-select').value = state.viewpoint || ''; const c = selectedCone(); const row = assets.guideline?.table_1.find(r => r.reference === ref); const info = $('view-info'), btn = $('btn-observer-at-origin');
  if (!ref || !row) { info.textContent = 'Choose a place to look from.'; btn.disabled = true; }
  else { let text = `${row.origin_point} · Looking toward ${row.subject}.`; const ground = c?.origin_inside_model_extent ? groundZAt(...c.origin_model_xy) : null; btn.disabled = !ground;
    if (!c) text += ' View polygon unavailable.'; else if (!ground) text += ' Ground unavailable at this viewpoint.'; else if (ground.source === 'water') text += ' Pier deck is not modelled; eye height is measured from the water.';
    info.textContent = text; }
  if (state.flow.stage === 'view' && state.flow.methods.view === 'cone') setHint(protectedViewHint());
  if (leaveObserver) setMode('overview'); else { refreshPanels(); requestRender(); writeHash(); } }
function placeObserverAtOrigin() { const c = selectedCone(); if (!c || !c.origin_inside_model_extent) return false; const ok = placeObserver(...c.origin_model_xy, 'origin'); if (ok) setHint(`Viewing from ${c.name}. Origin follows the mapped polygon; eye elevation is approximate.`); return ok; }
function protectedViewHint() {
  if (state.mode === 'observer' && state.observerSource === 'origin') return `Viewing from ${selectedCone()?.name || 'protected view ' + state.viewpoint}. Drag to look around.`;
  return selectedCone() ? `Free inspection. ${selectedCone().name} is selected on the map. Choose “View from here” to stand there.` : 'Free inspection. Choose a protected viewpoint, then “View from here” to stand there. The corner map stays visible.';
}
function viewFromHere(ref) { if (state.flow.guided) state.flow.methods.view = 'cone'; if (ref) selectView(ref); if (placeObserverAtOrigin()) { if (proposalBox()) lookTowardProposal(); else setMode('observer'); revealMap(); } }

// Reuse the choices offered in View, so stepping never changes the chosen method.
let protectedChoiceAssets = null, protectedViewChoices = [];
let roofNavigationKey = '', roofNavigationChoices = [];
function viewpointNavigationState() {
  const source = state.observerSource, observer = state.observer;
  if (!assets.ready || state.mode !== 'observer' || !observer || !['origin', 'rooftop', 'street'].includes(source)) return { source, choices: [], index: -1, visible: false };
  let choices = [], index = -1, label = '';
  if (source === 'origin') {
    if (assets.cones?.available) {
      if (protectedChoiceAssets !== assets.cones) {
        protectedChoiceAssets = assets.cones;
        protectedViewChoices = assets.cones.cones.filter(c => c.origin_inside_model_extent && c.origin_model_xy?.length === 2 && c.origin_model_xy.every(Number.isFinite) && groundZAt(...c.origin_model_xy));
      }
      choices = protectedViewChoices.filter(c => c.origin_inside_model_extent);
    }
    index = choices.findIndex(c => String(c.view_number) === String(state.viewpoint) && Math.hypot(c.origin_model_xy[0] - observer.x, c.origin_model_xy[1] - observer.y) < 1);
    label = 'Protected views';
  } else if (source === 'rooftop') {
    const context = JSON.stringify([state.site, proposalParts().map(p => p.box), state.removed, state.cleared, state.showExisting, state.sceneStyle]);
    if (context !== roofNavigationKey) { roofNavigationKey = context; roofNavigationChoices = nearbyRoofChoices.map(q => ({ ...q })); }
    const building = observer.building, ext = building?.source === 'extension';
    if (building && !roofNavigationChoices.some(q => q.index === building.index && q.ext === ext)) roofNavigationChoices.unshift({ index: building.index, ext, x: observer.x, y: observer.y });
    choices = roofNavigationChoices.filter(q => !(isRemoved(q.index, q.ext) && !state.showExisting) && roofZAt(q.index, q.ext, q.x, q.y));
    index = choices.findIndex(q => observer.building?.index === q.index && (observer.building.source === 'extension') === q.ext);
    label = 'Nearby roofs';
  } else {
    choices = streetViewChoices.filter(usableStreetPoint);
    index = choices.findIndex(q => Math.hypot(q.x - observer.x, q.y - observer.y) < 1);
    label = 'Nearby streets';
  }
  return { source, choices, index, label, visible: true };
}
function refreshViewpointNavigation() {
  const nav = $('viewpoint-navigation'); if (!nav) return;
  $('observer-controls')?.classList.toggle('hidden',state.mode!=='observer'||!state.observer);
  const current = viewpointNavigationState(); nav.classList.toggle('hidden', !current.visible);
  const label = current.label || 'Viewpoints', count = current.choices.length;
  $('viewpoint-position').textContent = `${label} · ${current.index < 0 ? count + ' available' : (current.index + 1) + ' / ' + count}`;
  for (const id of ['btn-viewpoint-prev', 'btn-viewpoint-next']) $(id).disabled = !current.visible || count < 2;
  nav.title = current.index >= 0 && current.source === 'origin' ? current.choices[current.index].name : `${label} available in the current model`;
}
function stepViewpoint(direction) {
  const current = viewpointNavigationState(), count = current.choices.length;
  if (!current.visible || count < 2) return false;
  const offset = direction < 0 ? -1 : 1, next = current.index < 0 ? (offset > 0 ? 0 : count - 1) : (current.index + offset + count) % count, choice = current.choices[next];
  if (current.source === 'origin') { viewFromHere(String(choice.view_number)); return state.observerSource === 'origin' && state.mode === 'observer'; }
  if (current.source === 'street') return placeStreetObserver(choice.x, choice.y);
  if (!placeRoofObserver(choice.index, choice.ext, choice.x, choice.y)) return false;
  setMode('observer'); revealMap(); return true;
}

// ------------------------------------------------------------------ proposal UI (parts / import)
function setDisplayUnits(unit) { state.displayUnits = VistaUnits.normalizeUnit(unit); renderPartsList(); refreshImportInfo(); refreshPanels(); writeHash(); }
const rotationDisclosure = new WeakMap();
function renderPartsList() { const list = $('parts-list'), unit = VistaUnits.normalizeUnit(state.displayUnits); list.querySelectorAll('.part-rotation').forEach(details => rotationDisclosure.set(details.rotationPart,details.open)); list.innerHTML = '';
  const selector = $('proposal-units'); if (selector) { selector.value = unit; selector.onchange = () => setDisplayUnits(selector.value); }
  state.parts.forEach((p,i) => { const row = document.createElement('div'); row.className = 'part-row';
    const field = (k,label) => { const spec = VistaUnits.inputSpec(k,unit), fullLabel = `${label} (${unit})`, readout = `part-${i}-${k}-conversion`; return `<label>${fullLabel}<input aria-label="${fullLabel}, block ${i+1}" aria-describedby="${readout}" data-k="${k}" data-i="${i}" type="number" min="${spec.min}" max="${spec.max}" step="any" value="${VistaUnits.inputValue(p[k] || 0,unit)}"><small class="part-conversion" id="${readout}" data-convert="${k}" data-i="${i}">≈ ${VistaUnits.formatLength(p[k] || 0,VistaUnits.alternateUnit(unit))}</small></label>`; };
    const height = VistaUnits.inputSpec('h',unit);
    row.innerHTML = `<label class="part-name">Block name<input data-k="name" data-i="${i}" type="text" value="${esc(p.name)}"></label><button class="x" data-del="${i}" type="button" aria-label="Remove block ${i+1}">×</button>` + field('h','Height') + field('w','Width') + field('d','Depth') + `<label>Rotation (°)<input aria-label="Rotation (°), block ${i+1}" data-k="rotation" data-i="${i}" type="number" min="-180" max="180" step="any" value="${p.rotation || 0}"></label>` + field('dx','East offset') + field('dy','North offset') + `<details class="part-rotation" data-i="${i}"${(rotationDisclosure.get(p) ?? !!p.rotation) ? ' open' : ''}><summary>Rotate block <output class="part-rotation-value" data-rotation-value="${i}">${p.rotation || 0}°</output></summary><div class="part-rotation-controls"><label>Adjust rotation (°)<input aria-label="Rotation slider (°), block ${i+1}" aria-valuetext="${p.rotation || 0} degrees" data-k="rotation" data-i="${i}" type="range" min="-180" max="180" step="any" value="${p.rotation || 0}"></label><button class="btn" data-reset-rotation="${i}" type="button" aria-label="Reset rotation, block ${i+1}"${p.rotation ? '' : ' disabled'}>Reset angle</button></div><p class="small muted">Turn this block around its centre. Positive angles turn clockwise in plan.</p></details><label class="height-scrubber">Adjust height (${unit})<input aria-label="Height slider (${unit}), block ${i+1}" data-k="h" data-i="${i}" type="range" min="${height.min}" max="${height.max}" step="${height.step}" value="${VistaUnits.inputValue(p.h,unit)}"></label>`;
    list.appendChild(row); });
  list.querySelectorAll('input').forEach(el => { const update = (event) => { const i=+el.dataset.i, k=el.dataset.k; if (k === 'name') state.parts[i].name=el.value; else { const v = k === 'rotation' ? (el.value.trim() && Number.isFinite(Number(el.value)) ? clamp(el.type === 'range' ? Math.round(Number(el.value)*10)/10 : Number(el.value),-180,180) : null) : VistaUnits.readDimension(el.value,unit,k); if (v === null) { if (event.type === 'change') el.value = k === 'rotation' ? state.parts[i][k] : VistaUnits.inputValue(state.parts[i][k],unit); return; } state.parts[i][k]=v; list.querySelectorAll(`input[data-i="${i}"][data-k="${k}"]`).forEach(peer => { if(peer!==el || event.type === 'change') peer.value = k === 'rotation' ? v : VistaUnits.inputValue(v,unit); }); if (k === 'rotation') { list.querySelector(`[data-rotation-value="${i}"]`).value = `${v}°`; list.querySelector(`input[type="range"][data-i="${i}"][data-k="rotation"]`).setAttribute('aria-valuetext', `${v} degrees`); list.querySelector(`[data-reset-rotation="${i}"]`).disabled = v === 0; } list.querySelectorAll(`[data-convert="${k}"][data-i="${i}"]`).forEach(readout => { readout.textContent = '≈ ' + VistaUnits.formatLength(v,VistaUnits.alternateUnit(unit)); }); state.check.result = null; } refreshPanels(); requestRender(); writeHash(); }; el.addEventListener('input',update); el.addEventListener('change',update); });
  list.querySelectorAll('.part-rotation').forEach(details => { const part = state.parts[+details.dataset.i]; details.rotationPart = part; details.addEventListener('toggle', () => rotationDisclosure.set(part,details.open)); });
  list.querySelectorAll('[data-reset-rotation]').forEach(button => button.addEventListener('click', () => { const input = list.querySelector(`input[type="number"][data-i="${button.dataset.resetRotation}"][data-k="rotation"]`); input.value = 0; input.dispatchEvent(new Event('input', { bubbles: true })); }));
  list.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click',() => { if(state.parts.length<=1) { setHint('Keep at least one block, or import a model.'); return; } state.parts.splice(+b.dataset.del,1); renderPartsList(); refreshPanels(); requestRender(); writeHash(); })); }
function addPart(p) { const last = state.parts[state.parts.length - 1]; state.parts.push(Object.assign({ name: 'Block ' + (state.parts.length + 1), h: 20, w: Math.max(5, (last ? last.w : 30) * 0.7), d: Math.max(5, (last ? last.d : 30) * 0.7), dx: last ? last.dx : 0, dy: last ? last.dy : 0, rotation: last?.rotation || 0 }, p || {})); state.check.result = null; renderPartsList(); refreshPanels(); requestRender(); writeHash(); }
function setProposalMode(m, quiet=false) { state.pmode = m; $('pmode-boxes').classList.toggle('active', m === 'boxes'); $('pmode-import').classList.toggle('active', m === 'import'); $('boxes-ui').classList.toggle('hidden', m !== 'boxes'); $('import-ui').classList.toggle('hidden', m !== 'import'); state.check.result = null; if (!quiet) { refreshPanels(); requestRender(); writeHash(); } }
function parseObj(text, unitScale) { // v / f lines, groups by o/g; fan triangulation; 1-based and negative indices
  const verts = []; const groups = []; let cur = null; const ensure = (name) => { cur = { name: name || ('group ' + (groups.length + 1)), idx: [] }; groups.push(cur); };
  for (const raw of text.split(/\r?\n/)) { const line = raw.trim(); if (!line || line[0] === '#') continue; const t = line.split(/\s+/);
    if (t[0] === 'v') verts.push(parseFloat(t[1]) * unitScale, parseFloat(t[2]) * unitScale, parseFloat(t[3]) * unitScale);
    else if (t[0] === 'o' || t[0] === 'g') ensure(t.slice(1).join(' '));
    else if (t[0] === 'f') { if (!cur) ensure('object'); const ids = t.slice(1).map((s) => { let i = parseInt(s.split('/')[0], 10); if (i < 0) i = verts.length / 3 + i + 1; return i - 1; }); for (let k = 1; k + 1 < ids.length; k++) cur.idx.push(ids[0], ids[k], ids[k + 1]); } }
  const parts = []; for (const g of groups) { if (!g.idx.length) continue; const used = [...new Set(g.idx)]; const remap = new Map(used.map((v, i) => [v, i])); const pos = new Float32Array(used.length * 3); used.forEach((v, i) => { pos[i * 3] = verts[v * 3]; pos[i * 3 + 1] = verts[v * 3 + 1]; pos[i * 3 + 2] = verts[v * 3 + 2]; });
    const idx = new Uint32Array(g.idx.map((v) => remap.get(v))); const bb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]; for (let i = 0; i < pos.length; i += 3) { bb[0] = Math.min(bb[0], pos[i]); bb[1] = Math.min(bb[1], pos[i + 1]); bb[2] = Math.min(bb[2], pos[i + 2]); bb[3] = Math.max(bb[3], pos[i]); bb[4] = Math.max(bb[4], pos[i + 1]); bb[5] = Math.max(bb[5], pos[i + 2]); }
    parts.push({ name: g.name, bbox: bb, positions: pos, indices: idx, triangles: idx.length / 3 }); }
  return parts; }
function refreshImportInfo() { const imported = state.imported; if (!imported) return; const bb = imported.bbox, size = [bb[3]-bb[0],bb[4]-bb[1],bb[5]-bb[2]], unit = state.displayUnits;
  $('import-info').textContent = `${imported.name}: ${imported.parts.length} part(s), ${imported.triangles.toLocaleString()} triangles · size (width × depth × height): ${size.map(v => VistaUnits.formatLength(v,unit)).join(' × ')} (≈ ${size.map(v => VistaUnits.formatLength(v,VistaUnits.alternateUnit(unit))).join(' × ')}) · model bbox (m): ${bb.map(v => fmt(v,1)).join(', ')} · ${imported.units_status}\nEach part is checked by its bounding box. Not stored in the URL: re-upload after a reload.${imported.importNote ? "\n"+imported.importNote : ""}`; $('import-info').classList.remove('muted'); }
function importFailure(message) {
  const text='Import failed: '+message;
  $('import-info').textContent=text+(state.imported ? ' Your previous model is still loaded.' : '');
  $('import-info').classList.remove('muted');setHint(text);showError(text);return false;
}
function disposeImported(model) { if (model) { model.parcelJob?.cancel(); model.parcelJob = null; model.parcelFootprint = null; } for (const mesh of model?.drawMeshes || []) { if (mesh.vao) gl.deleteVertexArray(mesh.vao); if (mesh.vb) gl.deleteBuffer(mesh.vb); if (mesh.ib) gl.deleteBuffer(mesh.ib); } }
function importBatchPlans(parts) {
  const plans = []; let current = { parts: [], vertices: 0, indices: 0 };
  const append = (part, vertices, indices) => {
    if (current.parts.length && (current.vertices + vertices > 100000 || current.indices + indices > 300000)) { plans.push(current); current = { parts: [], vertices: 0, indices: 0 }; }
    current.parts.push(part); current.vertices += vertices; current.indices += indices;
  };
  for (const part of parts) {
    if (!part.positions || !part.indices || part.positions.length % 3 || part.indices.length % 3) throw new Error('Imported mesh has invalid geometry arrays.');
    const vertices = part.positions.length / 3;
    if (vertices <= 100000 && part.indices.length <= 300000) { append(part, vertices, part.indices.length); continue; }
    // Plan ranges without scanning the whole mesh on the UI thread. A range can
    // reference at most one vertex per index; triangle boundaries stay intact.
    for (let start = 0; start < part.indices.length; start += 99999) {
      const end = Math.min(part.indices.length, start + 99999), indices = end - start;
      append({ sourcePart: part, start, end }, Math.min(vertices, indices), indices);
    }
  }
  if (current.parts.length) plans.push(current);
  return plans;
}
function uploadImportBatch(plan) {
  const pos = new Float32Array(plan.vertices * 3), idx = new Uint32Array(plan.indices);
  let vertexOffset = 0, indexOffset = 0;
  for (const entry of plan.parts) {
    const part = entry.sourcePart || entry, vertexCount = part.positions.length / 3;
    if (entry.sourcePart) {
      const remap = new Map();
      for (let i = entry.start; i < entry.end; i++) {
        const local = part.indices[i];
        if (!Number.isInteger(local) || local < 0 || local >= vertexCount) throw new Error('Imported mesh contains an invalid face index.');
        let mapped = remap.get(local);
        if (mapped === undefined) {
          mapped = vertexOffset++; remap.set(local, mapped);
          pos[mapped * 3] = part.positions[local * 3]; pos[mapped * 3 + 1] = part.positions[local * 3 + 1]; pos[mapped * 3 + 2] = part.positions[local * 3 + 2];
        }
        idx[indexOffset++] = mapped;
      }
      continue;
    }
    pos.set(part.positions, vertexOffset * 3);
    for (let i = 0; i < part.indices.length; i++) {
      const local = part.indices[i];
      if (!Number.isInteger(local) || local < 0 || local >= vertexCount) throw new Error('Imported mesh contains an invalid face index.');
      idx[indexOffset + i] = vertexOffset + local;
    }
    vertexOffset += vertexCount; indexOffset += part.indices.length;
  }
  return makeMesh(pos.subarray(0, vertexOffset * 3), idx);
}
let activeImport = null;
function cancelImport() { if (!activeImport) return; activeImport.cancelled = true; activeImport.controller.abort(); }
function importCancelled() { $('import-info').textContent = state.imported ? 'Import cancelled. Your previous model is still loaded.' : 'Import cancelled. No model loaded.'; setHint('Import cancelled.'); return false; }
function scheduleImportedParcels(model = state.imported) {
  if (!model || state.imported !== model || !window.ImportParcels || !model.parcelFootprint) return;
  const offset = importOffset(), placement = model.placement, key = JSON.stringify([placement, offset]);
  if (model.parcelMatchKey === key) return;
  model.parcelJob?.cancel(); model.parcelJob = null; model.parcelMatchKey = key;
  const captured = model.parcelFootprint;
  if (!offset || !(captured.triangles || captured.parts || captured.projected)) {
    model.parcelMatch = { status: offset ? 'review' : 'unlocated', polygons: [], ids: [], offset,
      reason: offset ? captured.reason : 'Place the model on the site before matching property lines.' };
    requestRender(); return;
  }
  model.parcelMatch = { status: 'loading', polygons: [], ids: [], offset, reason: 'Looking up source property lines…' };
  const stale = () => state.imported !== model || model.parcelMatchKey !== key || model.placement !== placement || JSON.stringify(importOffset()) !== JSON.stringify(offset);
  const job = ImportParcels.matchAsync(captured, offset, window.ProjectAPI.assetUrl('generated/imagine_parcels.json'));
  model.parcelJob = job;
  job.promise.then(result => { if (result && !stale()) { model.parcelMatch = { ...result, offset }; refreshPanels(); requestRender(); } })
    .catch(error => { if (!stale()) { model.parcelMatch = { status: 'unavailable', polygons: [], ids: [], offset, reason: error.message }; refreshPanels(); requestRender(); } })
    .finally(() => { if (model.parcelJob === job) model.parcelJob = null; });
}
function installImport(name, parts, unitsStatus, importNote='', ticket=activeImport) {
  if (!parts.length) return importFailure('No mesh faces found. Export a mesh as .3dm or .obj and try again.');
  const previous = state.imported, previousMode = state.pmode, previousView = state.mode, previousCamera = { ...state.cams.inspect }, previousCheck = state.check.result;
  const bb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (const p of parts) for (let k = 0; k < 3; k++) { bb[k] = Math.min(bb[k], p.bbox[k]); bb[k + 3] = Math.max(bb[k + 3], p.bbox[k + 3]); }
  let plans; try { plans = importBatchPlans(parts); } catch (error) { return importFailure(error.message); }
  const parcelFootprint = window.ImportParcels?.capture(parts);
  const drawMeshes = [], metadata = parts.map(p => ({ name: p.name, layer: p.layer ?? null, bbox: p.bbox, triangles: p.indices.length / 3 }));
  const remainingUploads = new Map();
  for (const plan of plans) for (const entry of plan.parts) { const part = entry.sourcePart || entry; remainingUploads.set(part, (remainingUploads.get(part) || 0) + 1); }
  const fail = error => { disposeImported({ drawMeshes }); return ticket?.cancelled ? importCancelled() : importFailure(error.message || error); };
  const commit = () => {
    if (ticket?.cancelled) return fail(new Error('Import cancelled'));
    const model = { name, parts: metadata, drawMeshes, bbox: bb, units_status: unitsStatus, importNote,
      parcelFootprint, placement: $('import-placement').value, triangles: metadata.reduce((sum, p) => sum + p.triangles, 0) };
    try {
      state.imported = model; state.check.result = null; setProposalMode('import', true);
      const P = proposalBox(); if (P) { state.cams.inspect.dist = Math.max(20, Math.hypot(bb[3]-bb[0],bb[4]-bb[1],bb[5]-bb[2]) * 1.6); state.cams.inspect.el = Math.max(0.35, state.cams.inspect.el); setMode('inspect', true); }
      refreshPanels(); requestRender(); writeHash(); errorStrip.classList.add('hidden'); refreshImportInfo();
      setHint(`Model loaded: ${parts.length} part(s). Placement “${$('import-placement').selectedOptions[0].textContent}”.`);
      $('import-info').focus({ preventScroll: true }); disposeImported(previous);
      // Private geometry is retained only on this model; source parsing and joins run off the UI thread.
      scheduleImportedParcels(model);
      return true;
    } catch (error) {
      state.imported = previous; state.cams.inspect = previousCamera; clearedKey = '';
      state.mode = previousView; setProposalMode(previousMode, true); setMode(previousView, true);
      state.check.result = previousCheck;
      try { refreshPanels(); requestRender(); } catch (_) {}
      return fail(error);
    }
  };
  const upload = plan => { if (ticket?.cancelled) throw new Error('Import cancelled'); drawMeshes.push(uploadImportBatch(plan));
    for (const entry of plan.parts) { const part = entry.sourcePart || entry, remaining = remainingUploads.get(part) - 1; remainingUploads.set(part, remaining);
      if (!remaining) { delete part.positions; delete part.indices; } } };
  if (plans.length === 1 && parts.length <= 32 && plans[0].vertices <= 10000 && plans[0].indices <= 30000) { try { upload(plans[0]); return commit(); } catch (error) { return fail(error); } }
  return (async () => { for (let i = 0; i < plans.length; i++) { $('import-info').textContent = `Preparing ${name}: display batch ${i+1} of ${plans.length}…`; await new Promise(resolve => requestAnimationFrame(resolve)); upload(plans[i]); }
    return commit(); })().catch(fail);
}
async function importFile(file) { const name = file.name; setHint('Reading ' + name + '…');
  try { if (/\.obj$/i.test(name)) { const text = await file.text(); const scale = parseFloat($('obj-units').value) || 1; return installImport(name, parseObj(text, scale), `units declared: ${$('obj-units').selectedOptions[0].textContent} (x ${scale})`); }
    if (/\.3dm$/i.test(name)) {
      const d = await window.BrowserRhino.importFile(file, name, { signal: activeImport?.controller.signal });
      if (activeImport?.cancelled) return importCancelled();
      const uncached=d.skipped?.some(p=>p.reason.includes('render mesh'));
      if (!d.ok) return importFailure(d.error+(uncached ? '. In Rhino, use Mesh on your solids and export the selected meshes as .3dm or .obj, then retry.' : ''));
      const note=[d.hidden_count ? `${d.hidden_count} hidden objects omitted.` : '',d.skipped?.length ? `Partial import: ${d.skipped.length} unsupported faces or objects omitted.${uncached ? ' Some surfaces have no saved render mesh. Use Mesh in Rhino, then export the meshes to include them.' : ''}` : ''].filter(Boolean).join(' ');
      return installImport(name, d.parts, `file units ${d.file_units}; ${d.units_status}`,note);
    }
    return importFailure('Use a .3dm or .obj file.'); }
  catch (e) { return importFailure(e && e.message || e); } }

// ------------------------------------------------------------------ guideline check
function renderClauseCards() { const g = assets.guideline; const box = $('clause-cards'); if (!g) { box.innerHTML = '<p class="small muted">Guideline text not loaded.</p>'; return; }
  let h = `<div class="card"><div class="ref">${esc(g.source.title)} — ${esc(g.definition.ref)}, p.${g.definition.page}</div><div class="quote source-quote">“${esc(g.definition.quote)}”</div><div class="kind"><b>Teaching note:</b> ${esc(g.definition.teaching_note)}</div></div>`;
  for (const c of g.clauses) h += `<div class="card"><div class="ref">Clause ${esc(c.ref)} (p.${c.page}, under “${esc(c.heading)}”)</div><div class="quote source-quote">“${esc(c.quote)}”${c.quote_continued ? ' “' + esc(c.quote_continued) + '”' : ''}</div><div class="kind"><b>What the tool computes:</b> ${esc(c.what_the_tool_computes)}</div><div class="kind"><b>Left to people or the City:</b> ${esc(c.human_or_city_interpretation)}</div></div>`;
  h += `<div class="card"><div class="ref">Not evaluated</div><div class="kind">${g.out_of_scope.map((s) => esc(s.ref + ' (p.' + s.page + '): ' + s.note)).join(' · ')}</div><div class="kind"><b>Source:</b> ${esc(g.source.publisher)}, ${esc(g.source.title)}, approved ${esc(g.source.approved)}, amended ${esc(g.source.amended)}; local copy ${esc(g.source.local_copy)}, accessed ${esc(g.source.accessed)}. ${esc(g.source.status)}.</div></div>`;
  box.innerHTML = h; }
function partFootprint(p) { const b=p.box; return p.footprint || [[b[0],b[1]],[b[3],b[1]],[b[3],b[4]],[b[0],b[4]]]; }
let planCacheKey='', planCache=[];
// Cone ceilings are explicit study planes; the City polygons supply no vertical data.
let coneStudy = { planes: {}, datumOffsetM: null, datumName: '', show: true };
let coneCeilingCacheKey = '', coneCeilingCache = null;
function coneCeilingResult() {
  const P = (!state.flow.guided || state.flow.methods.build) ? proposalBox() : null, footprints = P ? proposalParts().map(partFootprint) : state.boundary.length >= 3 ? [state.boundary] : [];
  const ground = P ? P.base : state.site ? terrainZAt(state.site.x, state.site.y) : null;
  const input = { cones: assets.cones?.available ? assets.cones.cones : [], footprints,
    point: state.site ? [state.site.x, state.site.y] : null, groundModelZ: ground,
    proposalTopModelZ: P ? P.top : null, planes: coneStudy.planes, datumOffsetM: coneStudy.datumOffsetM };
  const key = JSON.stringify(input);
  if (key !== coneCeilingCacheKey) { coneCeilingCacheKey = key; coneCeilingCache = ConeCeiling.evaluate(input); }
  return coneCeilingCache;
}
function loadConePlaneEditor() {
  const id = $('cone-ceiling-view').value, c = assets.cones?.cones?.find(c => String(c.view_number) === id), p = coneStudy.planes[id];
  const vals = { 'cone-origin-x': p?.origin[0] ?? c?.origin_model_xy?.[0] ?? '', 'cone-origin-y': p?.origin[1] ?? c?.origin_model_xy?.[1] ?? '',
    'cone-observer-elevation': p?.observerElevationM ?? '', 'cone-bearing': p?.bearingDeg ?? '', 'cone-pitch': p?.pitchDeg ?? '', 'cone-source': p?.source ?? '' };
  for (const [id, value] of Object.entries(vals)) $(id).value = value;
  $('cone-plane-error').textContent = '';
}
function refreshConeCeiling() {
  const cones = assets.cones?.cones || [], select = $('cone-ceiling-view');
  if (select.dataset.loaded !== String(cones.length)) { const previous = select.value; select.innerHTML = cones.map(c => `<option value="${esc(c.view_number)}">${esc(c.view_number)} · ${esc(c.name)}</option>`).join(''); select.dataset.loaded = String(cones.length); if (cones.some(c => String(c.view_number) === previous)) select.value = previous; else if (state.viewpoint) select.value = state.viewpoint; loadConePlaneEditor(); }
  const envelope = window.VistaEnvelope?.getResult();
  const r = envelope?.coverage.parcelAreaM2 > 0 ? {...envelope,status:envelope.mathematicalStatus==='unresolved'?'unknown':envelope.mathematicalStatus} : coneCeilingResult(), aligned = Number.isFinite(coneStudy.datumOffsetM), partial = r.status === 'partial';
  const available = r.ceilingElevationM != null;
  $('m-cone-height').textContent = r.maxHeightM != null ? `${fmt(r.maxHeightM,0)} m${partial ? ' · partial' : ' · study'}` : r.status === 'outside' ? 'Outside cones' : 'Unavailable';
  $('cone-ceiling-elevation').textContent = available ? `${fmt(r.ceilingElevationM)} m${partial ? ' (known planes only)' : ''}` : 'Unavailable';
  $('cone-ceiling-height').textContent = r.maxHeightM != null ? `${fmt(r.maxHeightM)} m${partial ? ' (provisional)' : ''}` : 'Unavailable';
  $('cone-ceiling-clearance').textContent = r.clearanceM != null ? r.clearanceM < 0 ? `${fmt(-r.clearanceM)} m above ceiling` : `${fmt(r.clearanceM)} m remaining` : 'Unavailable';
  const messages = { no_site: 'Click a study location or select a building first.', outside: 'Outside the loaded view corridors. This does not establish a zoning height allowance.', unknown: 'Height unavailable: the overlapping mapped corridors have no vertical geometry.', partial: 'Incomplete: some overlapping corridors have no plane. The known ceiling may be too high.', ready: 'Most restrictive entered plane across the study geometry, updated automatically.' };
  $('cone-ceiling-status').textContent = !assets.cones?.available ? 'View corridor data is unavailable.' : messages[r.status] || 'Height unavailable.';
  const P = (!state.flow.guided || state.flow.methods.build) ? proposalBox() : null;
  const groundZ = P ? P.base : state.site ? terrainZAt(state.site.x,state.site.y) : null;
  $('cone-ceiling-scope').textContent = [available ? `Summary of supplied surfaces · limiting view ${r.limitingView}.` : '', aligned ? groundZ !== null ? `Proposal-base study reference ${fmt(groundZ + coneStudy.datumOffsetM)} m in ${coneStudy.datumName}.` : `Ground unavailable; datum ${coneStudy.datumName}.` : 'Ground datum unaligned: enter an offset before using above-ground heights.', r.missingViews?.length ? `Missing planes: ${r.missingViews.join(', ')}.` : '', envelope?.coverage.parcelAreaM2 > 0 ? envelope.scope+'.' : 'Point study at the selected site.', P ? 'Above-ground summary uses the proposal base. Run Check proposal geometry for pointwise clearance; the scalar ceiling is not a geometry intersection.' : '', 'This is a view-plane study, not an overall buildable height or policy assessment.'].filter(Boolean).join(' ');
  $('cone-ceiling-show').checked = coneStudy.show;
}
function drawConeCeiling(cam) {
  if (!coneStudy.show || !Number.isFinite(coneStudy.datumOffsetM)) return;
  const r = window.VistaEnvelope?.getResult();
  if (!r?.coordinateCompatible) return;
  for (const patch of [...(r.patches || []),...(r.contactPatches || [])]) {
    const points = patch.points; if (!points || points.length < 2) continue;
    if (points.length >= 3) { const idx = []; for (let i=1;i<points.length-1;i++) idx.push(0,i,i+1); setCommon(PM,cam); dynDraw(PM,gl.TRIANGLES,new Float32Array(points.flat()),new Uint32Array(idx),C.plane); }
    const lines=[]; for(let i=0;i<points.length;i++) lines.push(...points[i],...points[(i+1)%points.length]); setCommon(PL,cam); dynDraw(PL,gl.LINES,new Float32Array(lines),null,C.planeEdge);
  }
  if (r.limitingPoint && r.ceilingElevationM != null && state.site) { const [x,y]=r.limitingPoint.xy, z=r.ceilingElevationM-coneStudy.datumOffsetM, ground=Number.isFinite(r.maxHeightM)?z-r.maxHeightM:null; if(ground !== null) { setCommon(PL,cam); dynDraw(PL,gl.LINES,new Float32Array([x,y,ground,x,y,z]),null,C.planeEdge); } }
  setCommon(PM,cam);
}
$('cone-ceiling-view').addEventListener('change',loadConePlaneEditor);
$('cone-plane-save').addEventListener('click',()=>{
  const read=id=>$(id).value.trim() === '' ? NaN : Number($(id).value), origin=[read('cone-origin-x'),read('cone-origin-y')], elev=read('cone-observer-elevation'), bearing=read('cone-bearing'), pitch=read('cone-pitch'), source=$('cone-source').value.trim(), id=$('cone-ceiling-view').value;
  if(!id || ![...origin,elev,bearing,pitch].every(Number.isFinite) || bearing<0 || bearing>360 || Math.abs(pitch)>=89 || !source) { $('cone-plane-error').textContent='Enter finite origin coordinates, observer elevation, bearing 0–360°, slope between −89° and 89°, and a source or assumption.'; return; }
  coneStudy.planes[id]={origin,observerElevationM:elev,bearingDeg:bearing,pitchDeg:pitch,source}; refreshPanels(); requestRender(); writeHash(); $('cone-plane-error').textContent='Study plane applied. It is not verified City geometry.';
});
$('cone-plane-remove').addEventListener('click',()=>{ delete coneStudy.planes[$('cone-ceiling-view').value]; loadConePlaneEditor(); refreshPanels(); requestRender(); writeHash(); });
$('cone-datum-save').addEventListener('click',()=>{ const raw=$('cone-datum-offset').value.trim(), name=$('cone-datum-name').value.trim(); if(raw && (!Number.isFinite(Number(raw)) || !name)) { $('cone-plane-error').textContent='Give the datum a name and enter a finite offset, or clear the offset to mark it unknown.'; return; } coneStudy.datumOffsetM=raw ? Number(raw) : null; coneStudy.datumName=name; refreshPanels(); requestRender(); writeHash(); });
$('cone-ceiling-show').addEventListener('change',e=>{coneStudy.show=e.target.checked;requestRender();writeHash();});
function restoreConeStudy(raw) {
  coneStudy={planes:{},datumOffsetM:null,datumName:'',show:true};
  if (!raw || typeof raw !== 'object') raw={};
  for(const [id,p] of Object.entries(raw.planes || {}).slice(0,100)) if(assets.cones?.cones?.some(c=>String(c.view_number)===id) && p && Array.isArray(p.origin) && p.origin.length===2 && [...p.origin,p.observerElevationM,p.bearingDeg,p.pitchDeg].every(v=>typeof v==='number' && Number.isFinite(v)) && p.bearingDeg>=0 && p.bearingDeg<=360 && Math.abs(p.pitchDeg)<89 && typeof p.source==='string' && p.source.trim()) coneStudy.planes[id]={origin:p.origin.slice(),observerElevationM:p.observerElevationM,bearingDeg:p.bearingDeg,pitchDeg:p.pitchDeg,source:p.source.slice(0,200),basis:p.basis==='reconstructed'?'reconstructed':'assumption',reference:typeof p.reference==='string'?p.reference.slice(0,200):'',date:typeof p.date==='string'?p.date.slice(0,10):''};
  for(const [id,p]of Object.entries(coneStudy.planes)){
    const source=raw.planes[id],refs=v=>Array.isArray(v)&&v.length===3&&v.every(q=>Array.isArray(q)&&q.length===3&&q.every(n=>typeof n==='number'&&Number.isFinite(n)));
    for(const key of ['referencePoints','sourceReferencePoints'])if(refs(source[key]))p[key]=source[key].map(q=>q.slice());
    if(source.horizontalTransformation&&typeof source.horizontalTransformation==='object')p.horizontalTransformation={sourceCrs:String(source.horizontalTransformation.sourceCrs||'').slice(0,80),method:String(source.horizontalTransformation.method||'').slice(0,400),localReconstruction:source.horizontalTransformation.localReconstruction===true,verticalUnchanged:source.horizontalTransformation.verticalUnchanged===true};
  }
  if(typeof raw.datumOffsetM==='number' && Number.isFinite(raw.datumOffsetM) && typeof raw.datumName==='string' && raw.datumName.trim()) {coneStudy.datumOffsetM=raw.datumOffsetM;coneStudy.datumName=raw.datumName.slice(0,80);}
  // Only local JSON inputs retain survey evidence/full boundaries. They are
  // deliberately excluded from share URLs and must be reloaded after reload.
  const e=raw.envelopeInputs;
  if(e && typeof e==='object' && JSON.stringify(e).length<=1000000) {
    const text=v=>typeof v==='string'?v.slice(0,400):'';
    const record=v=>v&&typeof v==='object'?Object.fromEntries(['source','reference','date','horizontal','verticalDatum'].map(k=>[k,text(v[k])])):null;
    let valid=Array.isArray(e.polygons)&&e.polygons.length>0, count=0;
    if(valid)for(const p of e.polygons){if(!Array.isArray(p)||!p.length){valid=false;break;}for(const r of p){if(!Array.isArray(r)||r.length<3){valid=false;break;}for(const q of r){count++;if(!Array.isArray(q)||q.length!==2||!q.every(n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=50000))valid=false;}}}
    if(valid&&count<=1024){
      const crs=v=>v&&typeof v==='object'?{...(typeof v.inputCrs==='string'&&v.inputCrs.trim()?{inputCrs:text(v.inputCrs)}:{}),horizontal:text(v.horizontal),units:text(v.units),verticalDatum:text(v.verticalDatum),compatible:v.compatible===true,...(v.surveyCompatible===false?{surveyCompatible:false}:{}),transformation:text(v.transformation)}:null;
      coneStudy.envelopeInputs={polygons:JSON.parse(JSON.stringify(e.polygons)),coordinateSystem:crs(e.coordinateSystem),boundarySource:record(e.boundarySource),surveySource:record(e.surveySource),assessment:record(e.assessment)};
      if(e.sourceCoordinateSystem)coneStudy.envelopeInputs.sourceCoordinateSystem=crs(e.sourceCoordinateSystem);
      if(e.georeference&&typeof e.georeference==='object'){
        const g=e.georeference;coneStudy.envelopeInputs.georeference={sourceCrs:text(g.sourceCrs),targetCrs:text(g.targetCrs),axisOrder:text(g.axisOrder),method:text(g.method),accuracyWarning:text(g.accuracyWarning),datumOperation:text(g.datumOperation),approximateDatumShift:g.approximateDatumShift===true,surveyVerified:false,verticalTransformed:false,vertical:text(g.vertical)};
      }
    }
  }
  coneStudy.show=raw.show!==false; $('cone-datum-offset').value=coneStudy.datumOffsetM ?? ''; $('cone-datum-name').value=coneStudy.datumName; loadConePlaneEditor();
}

function planAnalysis() { if (!assets.cones?.available) return []; const fps=proposalParts().map(partFootprint), key=JSON.stringify(fps); if(key===planCacheKey) return planCache;
  planCacheKey=key; planCache=assets.cones.cones.map(cone=> { const hits=fps.map(fp=>ProposalGeometry.planOverlap(cone.polygon_model_xy,fp)); return {cone,relation:hits.some(h=>h.relation==='overlap')?'overlap':hits.some(h=>h.relation==='touch')?'touch':'none',area:hits.reduce((n,h)=>n+h.area,0)}; }).filter(m=>m.relation!=='none'); return planCache; }
function resultLabel(r) { if (!r) return ''; const prefix=checkBody().surface_parts_omitted.length ? 'Solid parts · ' : ''; switch(r.overall_result) {
  case 'INTERSECTS': return `${prefix}${fmt(r.max_penetration_m)} m above your study ceiling`;
  case 'BELOW_BOUNDARY': return `${prefix}${fmt(r.min_signed_margin_m)} m below your study ceiling`;
  case 'BOUNDARY_CONTACT': return prefix+'Touches your study ceiling';
  case 'CANNOT_DETERMINE': return 'No ceiling set';
  case 'NO_PLAN_OVERLAP': return 'Outside the test area';
  case 'PLAN_EDGE_CONTACT': return 'Touches the test area edge';
  default: return 'Input could not be evaluated'; } }
function explainCheck(r) { if (!r) return ''; const omitted=checkBody().surface_parts_omitted.length; const scope=state.check.area==='custom' ? 'within your test rectangle' : omitted ? 'across the parts with width, depth and height' : 'over the whole proposal';
  const approx=state.pmode==='import' ? ' Imported parts use bounding boxes, so the numeric comparison can overestimate the actual shape.'+(omitted ? ` ${omitted} zero-thickness surface ${omitted===1?'part is':'parts are'} excluded from this volumetric comparison; they remain visible and included in view-corridor and view-plane studies.` : '') : '';
  return `${resultLabel(r)} ${scope}. ${r.overall_result==='INTERSECTS' ? 'Red marks proposal geometry above the ceiling in the test area. ' : ''}This ceiling is your design assumption; City view height limits are not loaded.${approx}`; }
let liveSignature='', liveTimer=null, matchMarkup='';
function syncCeiling() { const P=proposalBox(); if(P && state.check.reference==='height') state.check.bz=P.base+state.check.height; return P; }
function checkBody() {
  const allParts=proposalParts(),parts=allParts.filter(p=>[0,1,2].every(k=>p.box[k+3]>p.box[k]));
  const omitted=allParts.filter(p=>!parts.includes(p)).map(p=>p.name);
  return {surface_parts_omitted:omitted,parts:parts.map(p=>({name:p.name,x_min:p.box[0],x_max:p.box[3],y_min:p.box[1],y_max:p.box[4],z_min:p.box[2],z_max:p.box[5],...(p.footprint?{footprint:p.footprint}: {})})), test_area:evaluationArea(),
  boundary_z:state.check.unknown?null:state.check.bz, hypothesis:{boundary_z_model_m:state.check.unknown?null:state.check.bz,declared_by:'user',reference:state.check.reference,height_above_proposal_base_m:proposalBox()?state.check.bz-proposalBox().base:null,note:'User study ceiling; not a City view height. Model vertical datum unverified.'+(omitted.length ? ' Zero-thickness surfaces are excluded from this volumetric comparison only.' : ''),surface_parts_omitted:omitted,evaluation_area:state.check.area,viewpoint_context:state.viewpoint}}; }
// the whole study in one plain sentence at the top of Output (a Spotless-style narrative of the scenario)
function studySentence(P, matches) { if (!P || !state.site) return '';
  const n = P.parts.length, site = state.boundary.length >= 3 ? `on a study boundary of ${formatArea(SiteGeometry.metrics(state.boundary).area)}` : state.removed.length ? `replacing ${state.removed.length} existing building${state.removed.length === 1 ? '' : 's'}` : 'on a point site';
  const eye = observerEye(), d = eye ? Math.hypot(P.cx - eye[0], P.cy - eye[1]) : null;
  const from = !state.observer ? 'with no viewpoint chosen yet' : state.observerSource === 'origin' ? `seen from the origin of protected view ${state.viewpoint}` : `seen from ${state.observerSource === 'rooftop' ? 'a rooftop' : 'the ground'} about ${fmt(d, 0)} m away`;
  const o = matches.filter((m) => m.relation === 'overlap').length, t = matches.length - o;
  const views = !assets.cones?.available ? 'View corridor data is unavailable.' : `${o || 'No'} mapped view corridor${o === 1 ? '' : 's'} overlap${o === 1 ? 's' : ''} it in plan${t ? ` and ${t} touch${t === 1 ? 'es' : ''} its edge` : ''}.`;
  const topSubject=checkBody().surface_parts_omitted.length ? ' The compared solid parts are' : ' Its top is';
  const r = state.check.result, ceil = state.check.unknown || !r ? '' : r.overall_result === 'INTERSECTS' ? `${topSubject} ${fmt(r.max_penetration_m, 0)} m above the ${fmt(state.check.bz - P.base, 0)} m study ceiling set in Your height experiment.` : r.overall_result === 'BELOW_BOUNDARY' ? `${topSubject} ${fmt(r.min_signed_margin_m, 0)} m below the ${fmt(state.check.bz - P.base, 0)} m study ceiling set in Your height experiment.` : '';
  // 'an 80 m', 'an 18 m', 'a 120 m'
  const hs = String(Math.round(P.top - P.base)), an = hs[0] === '8' || (hs.length % 3 === 2 && /^1[18]/.test(hs));
  return `${an ? 'An' : 'A'} ${fmt(P.top - P.base, 0)} m ${n === 1 ? 'building' : 'building of ' + n + ' blocks'} ${site}, ${from}. ${views}${ceil}`; }
function refreshLiveStudy() { const P=syncCeiling(), matches=planAnalysis(); if ($('study-sentence')) $('study-sentence').textContent = studySentence(P, matches);
  $('btn-study-site').classList.toggle('hidden',!!P);
  $('view-study-summary').classList.toggle('hidden', !!P && !!assets.cones?.available);
  $('view-study-summary').textContent = !P ? 'Build your proposal to find the mapped view corridors it overlaps in plan.' : !assets.cones?.available ? 'View corridor data unavailable.' : matches.length ? (()=>{ const t=matches.filter(m=>m.relation==='touch').length, o=matches.length-t; return o&&t ? `${o} mapped view corridor${o===1?' overlaps':'s overlap'} your building in plan, and ${t} touch${t===1?'es':''} its edge.` : o ? `${o} mapped view corridor${o===1?' overlaps':'s overlap'} your building in plan.` : `${t} mapped view corridor${t===1?' touches':'s touch'} the edge of your building in plan.`; })() : 'No mapped view corridor overlaps your building in plan.';
  const html=matches.map(m=>`<article class="view-match"><div><b>${esc(m.cone.view_number)} — ${esc(m.cone.name)}</b><span>${m.relation==='touch'?'Touches your footprint edge in plan':'Overlaps your footprint in plan'}${state.pmode==='import'?' · bounding-box estimate':''}</span></div><button class="btn" data-view="${esc(m.cone.view_number)}">View from here</button></article>`).join('');
  // corridors that pass close by without overlapping, so a site next to a famous view is not mistaken for "unaffected"
  const nearEl=$('view-near'); if(nearEl) { const hit=new Set(matches.map(m=>String(m.cone.view_number))), parts=P?proposalParts():[], feet=parts.map(q=>partFootprint(q)), pts=feet.flat();
    const segD=(p,a,b)=>{ const vx=b[0]-a[0], vy=b[1]-a[1], L=vx*vx+vy*vy, t=L?clamp(((p[0]-a[0])*vx+(p[1]-a[1])*vy)/L,0,1):0; return Math.hypot(a[0]+t*vx-p[0], a[1]+t*vy-p[1]); };
    const near=!P||!assets.cones?.available?[]:assets.cones.cones.filter(c=>!hit.has(String(c.view_number))).map(c=>{ const poly=c.polygon_model_xy; let d=Infinity; for(const p of pts) for(let i=0;i<poly.length;i++) d=Math.min(d,segD(p,poly[i],poly[(i+1)%poly.length])); for(const p of poly) for(const f of feet) { for(let i=0;i<f.length;i++) d=Math.min(d,segD(p,f[i],f[(i+1)%f.length])); } return {c,d}; }).filter(q=>q.d<400).sort((a,b)=>a.d-b.d).slice(0,3);
    nearEl.classList.toggle('hidden',!near.length); nearEl.textContent=near.length?`Close by but not overlapping in plan: ${near.map(q=>`${q.c.view_number} ${q.c.name} (${fmt(q.d,0)} m away)`).join(' · ')}.`:''; }
  if(html!==matchMarkup) { $('view-matches').innerHTML=html; matchMarkup=html; $('view-matches').querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>viewFromHere(b.dataset.view))); }
  $('enable-height-study').checked=!state.check.unknown; $('chk-bz-unknown').checked=state.check.unknown; $('height-controls').classList.toggle('hidden',state.check.unknown);
  const h=state.check.reference==='height'?state.check.height:P?state.check.bz-P.base:state.check.height;
  if(document.activeElement!==$('ceiling-height')) $('ceiling-height').value=Number(h.toFixed(2));
  if(document.activeElement!==$('ceiling-slider')) $('ceiling-slider').value=h;
  if(document.activeElement!==$('check-bz')) $('check-bz').value=state.check.bz;
  $('check-bz').disabled=state.check.unknown;
  $('ceiling-reference').textContent=P ? `Your building is ${fmt(P.top-P.base, 0)} m tall; your ceiling is ${fmt(state.check.bz-P.base, 0)} m above its base${state.check.reference==='height'?'':' (fixed elevation, kept if the site moves)'}. Your assumption, not a City height limit.` : 'Choose a site to establish the proposal base.';
  const scale=Math.max(P?P.top-P.base:120,h,1)*1.12;
  $('height-meter-fill').style.width=(P?clamp((P.top-P.base)/scale*100,0,100):0)+'%'; $('height-meter-line').style.left=clamp(h/scale*100,0,100)+'%';
  $('height-meter').setAttribute('aria-label',P?`Proposal ${fmt(P.top-P.base)} metres, study ceiling ${fmt(h)} metres above base`:'No proposal');
  const body=checkBody(),signature=JSON.stringify(body);
  if(signature!==liveSignature) { liveSignature=signature; state.check.requestId++; state.check.result=null; state.check.input=null; state.check.busy=false; state.check.error=null; if(liveTimer) clearTimeout(liveTimer); liveTimer=null; }
  if(P && !state.check.unknown && !body.parts.length) state.check.error='This volumetric height experiment needs a part with width, depth and height. Surface parts remain visible and included in the view-plane study.';
  if(P && !state.check.unknown && !state.check.result && !state.check.busy && !state.check.error && !liveTimer) liveTimer=setTimeout(()=> {liveTimer=null; runCheck();},180);
  renderCheck();
}
async function runCheck() { syncCeiling(); if(liveTimer) clearTimeout(liveTimer); liveTimer=null;
  const body=checkBody(); if(!body.parts.length || !body.test_area) {state.check.error='This volumetric comparison needs a part with width, depth and height.';renderCheck();return null;}
  const signature=JSON.stringify(body); liveSignature=signature; const id=++state.check.requestId;
  state.check.result=null; state.check.input=null; state.check.busy=true; state.check.error=null; renderCheck();
  try { const response=await window.ProjectAPI.fetch('/api/check',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,request_id:id})}); if(!response.ok) throw new Error('HTTP '+response.status); const data=await response.json();
    if(id!==state.check.requestId || signature!==JSON.stringify(checkBody())) return null;
    if(!data.check) throw new Error(data.error || 'No calculation returned');
    state.check.result=data.check; state.check.input=data.input; state.check.busy=false; refreshPanels(); requestRender(); writeHash(); return data.check;
  } catch(error) { if(id!==state.check.requestId) return null; state.check.busy=false; state.check.error='Could not update the height comparison. '+error.message; renderCheck(); if(state.step===3) renderReport(); return null; }
}
function renderCheck() { const r=state.check.result, P=proposalBox(); $('check-result').classList.toggle('hidden',!r);
  $('check-error').classList.toggle('hidden',!state.check.error); $('check-error-text').textContent=state.check.error || '';
  $('check-live-status').textContent=!P?'Place a proposal to explore a study ceiling.':state.check.error?'Calculation unavailable.':state.check.unknown?'No study ceiling set. Corridor overlap updates automatically.':r?'Updates automatically as you edit.':'Updating height comparison…';
  if(r) { $('check-badge').textContent=resultLabel(r); $('check-badge').className='badge '+r.overall_result; $('check-numbers').textContent=`Ceiling ${fmt(state.check.bz-(P?.base || 0))} m above proposal base · ${r.part_count} part(s)`;
    $('check-parts').innerHTML='<table class="parts"><tr><th>Part</th><th>Margin to study ceiling (m)</th><th>Above study ceiling (m)</th></tr>'+r.parts.map(p=>`<tr><td>${esc(p.part)}</td><td>${fmt(p.result.signed_margin_m,2)}</td><td>${fmt(p.result.penetration_m,2)}</td></tr>`).join('')+'</table><p class="small muted">Negative clearance means above the ceiling. Contact tolerance: '+r.tolerance_m+' m (calculation setting).</p>';
    $('check-explain').textContent=explainCheck(r); }
  const live=$('live-feedback'); live.classList.toggle('hidden',!P); const matches=planAnalysis();
  live.textContent=P?`${assets.cones?.available ? matches.length+' mapped view corridor'+(matches.length===1?'':'s') : 'View data unavailable'}${state.check.unknown?' · plan only':r?' · '+resultLabel(r)+' (your assumption)':state.check.error?' · height comparison unavailable':' · updating height study…'}${state.showExisting && state.removed.length?' · proposal hidden':''}`:'';
  live.classList.toggle('above-ceiling',r?.overall_result==='INTERSECTS');
  updateMetrics();
}
// Live metrics strip (after the Spotless New York dashboard): the study at a glance, updated as you work.
function updateMetrics() {
  const el = $('metrics'); if (!el) return; const P = proposalShown() ? proposalBox() : null, show = !!state.site && state.flow.guided;
  if (!show) $('metrics-help')?.classList.add('hidden');
  el.classList.toggle('hidden', !show); const wide = matchMedia('(min-width: 861px)').matches; $('live-feedback').classList.toggle('hidden', (show && wide) || !P); $('scene-status').classList.toggle('hidden', show && wide); if (!show) return; // the strip replaces the small scene badge
  const r = state.check.result, an = P && assets.cones?.available ? planAnalysis() : null, met = an ? an.length : null, touch = an ? an.filter((m) => m.relation === 'touch').length : 0;
  $('m-height').textContent = P ? VistaUnits.formatLength(P.top-P.base,state.displayUnits) : '–';
  $('m-site').textContent = state.boundary.length >= 3 ? formatArea(SiteGeometry.metrics(state.boundary).area) : 'Point';
  // a plan overlap count, never a pass/fail
  $('m-views').textContent = !P ? '–' : met === null ? 'Unavailable' : touch ? `${met - touch} overlap · ${touch} touch${touch === 1 ? 'es' : ''}` : `${met} of ${assets.cones.cones.length} views`; $('m-views').classList.remove('alert');
  $('m-demolished').textContent = String(state.removed.length + state.cleared.length);
  $('m-view').textContent = !state.observer ? '–' : state.observerSource === 'origin' ? `View ${state.viewpoint}` : state.observerSource === 'rooftop' ? 'Rooftop' : state.observerSource === 'street' ? 'Street' : 'Ground';
  const off = state.check.unknown || !P, kind = off || !r ? null : r.overall_result; $('m-ceiling-dt').textContent = kind === 'INTERSECTS' ? 'Above study ceiling' : kind === 'BELOW_BOUNDARY' ? 'Below study ceiling' : 'Study ceiling';
  $('m-ceiling').textContent = off ? 'Not set' : r ? (kind === 'INTERSECTS' ? `${fmt(r.max_penetration_m, 0)} m` : kind === 'BELOW_BOUNDARY' ? `${fmt(r.min_signed_margin_m, 0)} m` : kind === 'BOUNDARY_CONTACT' ? 'touching' : resultLabel(r)) : '…';
  $('m-ceiling').classList.remove('alert');
}

// ------------------------------------------------------------------ steps / panels
// ------------------------------------------------------------------ guided flow: Site → Build → View → Output
// Each stage asks for one method. Once chosen, the other methods are hidden until the user returns to the chooser;
// choosing a different method clears that stage's result. Stages unlock in order.
const FLOW = ['site', 'build', 'view', 'output'];
const FLOW_METHODS = { site: ['point', 'replace', 'multi'], build: ['platform', 'import'], view: ['cone', 'roof', 'street', 'drag'] };
const FLOW_NAMES = { site: 'Site', build: 'Build', view: 'View', output: 'Output' };
const METHOD_NAMES = { point: 'Open spot on the plan', replace: 'Replace a building', multi: 'Replace several buildings', platform: 'Build on the platform', import: 'Upload model', cone: 'Protected view cone', roof: 'From a building', street: 'From the street', drag: 'Drag and view' };
const FLOW_HINTS = {
  site: 'Step 1 · Choose how you want to pick your site.', build: 'Step 2 · Choose how you will make your building.', view: 'Step 3 · Choose where you want to look from.',
  output: 'Output · Check the results, choose what goes in the PDF, then Export PDF.',
  point: 'Click open ground to place your site, or find another area below. Draw a boundary if you need an area measurement.',
  replace: 'Click an existing building in the plan to select it for replacement.',
  multi: 'Click buildings in the plan to add them to your group, then choose “Use as site”.',
  platform: 'Edit the blocks. Height, size, rotation and offsets update the model live.',
  import: 'Choose a .3dm or .obj file. It is read on your device.',
  cone: 'Free inspection. Choose a protected viewpoint, then “View from here” to stand there. The corner map stays visible.',
  roof: 'Click a roof in the plan, or pick a nearby building in the panel.',
  street: 'Click a mapped street on the plan, or choose a nearby street position. The view faces your proposal at eye level.',
  drag: 'Press a spot on the plan, drag toward what you want to see, and release.',
};
const SWITCH_LABELS = { point: 'Open spot on the plan', replace: 'Replace a building', multi: 'Replace several buildings', platform: 'Build on the platform', import: 'Upload model', cone: 'View from a protected cone', roof: 'View from a building', street: 'View from the street', drag: 'Drag and view' };
const METHOD_ICONS = { point: 'pin', replace: 'replace', multi: 'multi', platform: 'blocks', import: 'upload', cone: 'cone', roof: 'roof', street: 'eye', drag: 'drag' };
const FLOW_TOOLS = { point: 'site', replace: 'replace', multi: 'multi', cone: 'identify', roof: 'rooftop', street: 'street', drag: 'aim' };
function flowMethod(stage) { return state.flow.methods[stage] || null; }
function flowChoosing(stage) { return stage !== 'output' && (!flowMethod(stage) || state.flow.choosing === stage); }
function stageComplete(stage) {
  const m = flowMethod(stage);
  if (stage === 'site') return !!m && !!state.site && !state.drawing && (m === 'point' || state.removed.length > 0);
  if (stage === 'build') return !!m && !!proposalBox() && (m !== 'import' || !!state.imported);
  if (stage === 'view') return !!m && !!state.observer;
  return false;
}
function stageReachable(stage) { const i = FLOW.indexOf(stage); return FLOW.slice(0, i).every(stageComplete); }
function stageNeed(stage) {
  const m = flowMethod(stage); if (!m || stageComplete(stage)) return '';
  if (stage === 'site' && state.drawing) return 'Finish or cancel the boundary to continue.';
  if (stage === 'site') return m === 'point' ? 'Place a site on open ground to continue.' : m === 'replace' ? 'Select a building and replace it to continue.' : 'Select buildings and choose “Use as site” to continue.';
  if (stage === 'build') return m === 'import' ? 'Load a model file to continue.' : 'Add at least one block to continue.';
  if (stage === 'view') return 'Place a viewpoint to continue.';
  return '';
}
function applyFlowTool() {
  const stage = state.flow.stage, m = flowChoosing(stage) ? null : flowMethod(stage);
  const tool = (stage === 'site' || stage === 'view') && m ? FLOW_TOOLS[m] : 'identify';
  if (tool !== 'boundary' && state.drawing && !(stage === 'site' && m === 'point')) state.drawing = null;
  if (!state.drawing) state.tool = tool;
  for (const k of ['site', 'observer', 'rooftop', 'identify', 'boundary']) $('tool-' + k)?.classList.toggle('active', k === state.tool);
  refreshCaption();
}
function resetStage(stage) {
  if (stage === 'site') { state.flow.alt = { find: null, place: null }; state.site = null; state.boundary = []; state.drawing = null; state.removed = []; state.showExisting = false; state.selected = null; state.multiSel = []; state.check.result = null; }
  if (stage === 'view') { state.observer = null; state.observerSource = 'exploratory'; state.viewpointObserver = null; selectView(null); if (state.mode === 'observer') setMode('overview'); }
}
function flowGo(stage, opts = {}) {
  if (!FLOW.includes(stage)) return false;
  if (!opts.force && !stageReachable(stage)) { const missing = FLOW.find(s => !stageComplete(s)); setHint(`Finish ${FLOW_NAMES[missing]} first: ${stageNeed(missing) || 'choose a method.'}`); return false; }
  // the existing comparison belongs to the Site step; a building picked in another step does not linger
  const from = state.flow.stage; state.flow.stage = stage; if (stage !== 'site') state.showExisting = false; if (from !== stage) state.selected = null; state.flow.choosing = null; state.step = stage === 'output' ? Math.max(2, opts.step || 3) : 1;
  if (!opts.quiet) { // restores and compatibility calls keep the saved camera
    if (stage === 'build' && from !== 'build' && proposalBox() && state.mode !== 'observer') { if (state.mode === 'plan') setMode('overview'); focusSite(); }
    if (stage !== 'view' && stage !== 'output' && state.mode === 'observer') setMode('overview');
    // arriving at Output from a far-out city view, frame the proposal so the result has something to look at
    if (stage === 'output' && from !== 'output' && state.mode === 'overview' && state.cams.overview.dist > 3000 && proposalBox()) focusSite(); }
  applyFlowTool(); if (stage === 'output') { renderCheck(); window.__report?.renderBuilder(); }
  setHint(stage === 'view' && !flowChoosing(stage) && flowMethod(stage) === 'cone' ? protectedViewHint() : stage === 'view' && state.mode === 'observer' && !flowChoosing(stage) && state.observerSource === 'rooftop' && flowMethod(stage) === 'roof' ? 'You’re viewing from a roof. Drag to look around, or choose another roof.' : stage === 'view' && state.mode === 'observer' && !flowChoosing(stage) && state.observerSource === 'exploratory' && state.observer && flowMethod(stage) === 'drag' ? 'You’re standing here. Drag to look around, or pick another spot on the plan.' : FLOW_HINTS[flowChoosing(stage) ? stage : flowMethod(stage) || stage]);
  if (!opts.quiet) $('panel').scrollTop = 0;
  refreshPanels(); requestRender(); writeHash(); if (!opts.quiet) focusStageHeading(); return true;
}
// keyboard and screen-reader users land on the new step's heading instead of losing focus to the page body
function focusStageHeading() { const a = document.activeElement; if (a && a !== document.body && !$('panel').contains(a)) return; const h = document.querySelector('.flow-stage:not(.hidden) .stage-head h2'); if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); } }
function chooseMethod(stage, method) {
  if (!FLOW_METHODS[stage]?.includes(method)) return false;
  if (state.flow.stage !== stage && !flowGo(stage)) return false;
  const prev = flowMethod(stage); if (prev && prev !== method) resetStage(stage);
  state.flow.methods[stage] = method; state.flow.choosing = null; state.flow.guided = true;
  if (stage === 'build') setProposalMode(method === 'import' ? 'import' : 'boxes');
  applyFlowTool();
  if (stage === 'site' || method === 'roof' || method === 'drag' || method === 'street') { if (method==='street') {state.layers.roads=true;$('layer-roads').checked=true;} if (state.mode !== 'plan') planView(); revealMap(); }
  if (stage === 'build' && proposalBox()) { if (state.mode === 'plan') setMode('overview'); focusSite(); }
  setHint(FLOW_HINTS[method]); refreshPanels(); requestRender(); writeHash(); focusStageHeading(); return true;
}
function changeMethod(stage) { state.flow.choosing = stage; applyFlowTool(); setHint(FLOW_HINTS[stage] + (flowMethod(stage) ? ' Choosing a different method clears this step’s current result.' : '')); refreshPanels(); }
function flowBack() { const i = FLOW.indexOf(state.flow.stage); if (i > 0) flowGo(FLOW[i - 1]); }
function flowNext() { const stage = state.flow.stage, i = FLOW.indexOf(stage); if (!stageComplete(stage)) { setHint(stageNeed(stage)); return false; } return flowGo(FLOW[i + 1]); }
// Multi-building selection: a working list, applied as one combined site.
function toggleMultiBuilding(index, ext) {
  const c = (ext ? assets.extIndex : assets.index)?.columns; if (!c) return false;
  const at = state.multiSel.findIndex(q => q.index === index && q.ext === ext);
  if (at >= 0) state.multiSel.splice(at, 1); else { if (state.multiSel.length >= 40) { setHint('Select at most 40 buildings for one study.'); return false; } state.multiSel.push({ index, ext, id: c.osm_id[index] }); }
  setHint(`${state.multiSel.length} building${state.multiSel.length === 1 ? '' : 's'} selected. Click more buildings, or choose “Use as site”.`);
  refreshPanels(); requestRender(); return true;
}
function convexHull(points) {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]); if (p.length < 3) return p;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); const lo = [], hi = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (const q of p.reverse()) { while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], q) <= 0) hi.pop(); hi.push(q); }
  return lo.slice(0, -1).concat(hi.slice(0, -1));
}
function applyMultiSelection() {
  if (!state.multiSel.length) { setHint('Click at least one building first.'); return false; }
  const corners = []; for (const q of state.multiSel) { const b = (q.ext ? assets.extIndex : assets.index).columns.bbox[q.index]; corners.push([b[0], b[1]], [b[3], b[1]], [b[3], b[4]], [b[0], b[4]]); }
  const hull = convexHull(corners); if (hull.length < 3 || SiteGeometry.validate(hull)) { setHint('Those buildings do not form a usable study area. Add or remove a building.'); return false; }
  const m = SiteGeometry.metrics(hull); const tries = [m.centre, ...state.multiSel.map(q => { const b = (q.ext ? assets.extIndex : assets.index).columns.bbox[q.index]; return [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2]; })];
  const centre = tries.find(t => landZAt(t[0], t[1]) !== null); if (!centre) { setHint('No modelled land under these buildings. Choose buildings over land.'); return false; }
  if (!placeSite(centre[0], centre[1], true)) return false;
  state.removed = state.multiSel.map(q => ({ ...q })); state.showExisting = false; invalidateRoofObserver(); state.boundary = hull; state.selected = null;
  refreshPanels(); revealMap(); focusSite(); writeHash();
  setHint(`${state.removed.length} buildings replaced by one study site of ${formatArea(m.area)}. The outline wraps their model footprints; it is not a legal lot.`); return true;
}
function replaceSingleBuilding() { if (state.selected === null) return false; const before = { removed: state.removed, site: state.site, boundary: state.boundary }; state.removed = []; state.multiSel = [];
  if (replaceSelectedBuilding()) return true; Object.assign(state, before); refreshPanels(); requestRender(); return false; }
// Drag-and-view: press on the plan to stand, drag to aim, release to look.
function groundUnderPointer(cx, cy, z) { const ray = lastCam && rayFromClient(cx, cy, lastCam); if (!ray || Math.abs(ray.d[2]) < 1e-6) return null; const t = (z - ray.o[2]) / ray.d[2]; return t > 0 ? [ray.o[0] + ray.d[0] * t, ray.o[1] + ray.d[1] * t] : null; }
function beginAim(cx, cy) {
  const ray = lastCam && rayFromClient(cx, cy, lastCam); if (!ray) return false; const hit = pickRay(ray.o, ray.d);
  if (hit.type === 'building') { setHint('That is a building. Drag and view stands on the ground; to stand on a roof, return and choose “From a building”.'); return false; }
  if (hit.type !== 'terrain') { setHint('Press on modelled ground to stand there.'); return false; }
  if (!placeObserver(hit.point[0], hit.point[1], 'exploratory')) return false;
  setHint('Drag toward what you want to see, then release.'); return true;
}
function aimDragTo(cx, cy) {
  const o = state.observer; if (!o) return; const q = groundUnderPointer(cx, cy, o.z); if (!q) return;
  const dx = q[0] - o.x, dy = q[1] - o.y; if (Math.hypot(dx, dy) < 2) return;
  state.cams.observer.yaw = Math.atan2(dy, dx); state.cams.observer.pitch = 0.02; requestRender();
}
function endAim(moved) {
  if (!state.observer) return; if (!moved && proposalBox()) aimAtProposal();
  setMode('observer'); refreshPanels(); writeHash();
  setHint(moved ? 'Standing where you pressed, looking the way you dragged. Drag the view to look around; use “Pick a spot on the plan” to move.' : 'Standing where you clicked, facing your proposal. Drag to look around.');
}
// Old links and studies have no flow; infer the furthest sensible stage from their content.
function inferMethods() {
  const m = { site: state.removed.length > 1 ? 'multi' : state.removed.length === 1 ? 'replace' : state.site ? 'point' : null, build: null, view: null };
  if (m.site) m.build = state.pmode === 'import' ? 'import' : 'platform';
  if (state.observer) m.view = state.observerSource === 'origin' ? 'cone' : state.observerSource === 'rooftop' ? 'roof' : state.observerSource === 'street' ? 'street' : 'drag';
  return m;
}
function inferFlow(step) {
  const m = inferMethods(); state.flow.methods = m; state.flow.guided = !!m.site;
  state.flow.stage = step >= 2 && m.view ? 'output' : m.view ? 'view' : m.site ? 'build' : 'site';
}
function refreshFlowUI() {
  const stage = state.flow.stage, choosing = flowChoosing(stage), method = flowMethod(stage), idx = FLOW.indexOf(stage);
  document.querySelectorAll('.flow-step').forEach(el => { const s = el.dataset.stage, i = FLOW.indexOf(s), done = stageComplete(s), reach = stageReachable(s);
    el.classList.toggle('current', s === stage); el.classList.toggle('done', done && s !== stage); el.classList.toggle('locked', !reach);
    if (s === stage) el.setAttribute('aria-current', 'step'); else el.removeAttribute('aria-current');
    el.setAttribute('aria-disabled', String(!reach)); el.title = reach ? (i < idx ? `Return to ${FLOW_NAMES[s]}` : FLOW_NAMES[s]) : `Finish ${FLOW_NAMES[FLOW[i - 1]]} first`; });
  const po = $('pill-output'); if (po) { const ready = stageReachable('output'); po.textContent = ready ? 'Ready' : 'Not yet'; po.classList.toggle('ok', ready); }
  document.querySelectorAll('.flow-stage').forEach(el => el.classList.toggle('hidden', el.dataset.stage !== stage));
  document.querySelectorAll('.method-chooser').forEach(el => el.classList.toggle('hidden', el.dataset.chooser !== stage || !choosing));
  document.querySelectorAll('.method-body').forEach(el => el.classList.toggle('hidden', el.dataset.stage !== stage || choosing || el.dataset.method !== method));
  document.querySelectorAll('.stage-common').forEach(el => el.classList.toggle('hidden', el.dataset.stage !== stage || choosing));
  document.querySelectorAll('.method-card').forEach(el => { const on = flowMethod(el.dataset.stage) === el.dataset.method; el.classList.toggle('chosen', on); el.setAttribute('aria-pressed', String(on)); });
  document.querySelectorAll('.method-keep').forEach(el => { const m = flowMethod(el.dataset.keep); el.classList.toggle('hidden', !m || state.flow.choosing !== el.dataset.keep); if (m) el.textContent = `Keep “${METHOD_NAMES[m]}”`; });
  document.querySelectorAll('.stage-active').forEach(el => { const s = el.dataset.activeFor; if (!s) return; const m = flowMethod(s); el.innerHTML = m && !flowChoosing(s) ? `<svg class="ico" aria-hidden="true"><use href="#i-${{ point: 'pin', replace: 'replace', multi: 'multi', platform: 'blocks', import: 'upload', cone: 'cone', roof: 'roof', street: 'eye', drag: 'drag' }[m]}"/></svg>${esc(METHOD_NAMES[m])}` : ''; });
  document.querySelectorAll('.method-switch').forEach(el => { const s = el.dataset.switchFor, m = flowMethod(s), show = s === stage && !choosing && !!m; el.classList.toggle('hidden', !show); if (!show) return;
    const key = s + ':' + m + ':' + stageComplete(s); if (el.dataset.key === key) return; el.dataset.key = key; el.replaceChildren();
    const lab = document.createElement('span'); lab.className = 'ms-label'; lab.textContent = 'Other ways'; el.appendChild(lab);
    for (const other of FLOW_METHODS[s].filter(k => k !== m)) { const b = document.createElement('button'); b.type = 'button'; b.className = 'ms-btn'; b.dataset.stage = s; b.dataset.method = other;
      b.innerHTML = `<svg class="ico" aria-hidden="true"><use href="#i-${METHOD_ICONS[other]}"/></svg><span>${esc(SWITCH_LABELS[other])}</span>`;
      if (stageComplete(s) && s !== 'build') b.title = 'Switching clears this step’s current result';
      b.addEventListener('click', () => chooseMethod(s, other)); el.appendChild(b); } });
  const back = $('btn-flow-back'), next = $('btn-flow-next');
  if (idx > 0) { back.textContent = `‹ Return to ${FLOW_NAMES[FLOW[idx - 1]]}`; back.classList.remove('hidden'); }
  else back.classList.add('hidden');
  const showNext = stage !== 'output' && !choosing; next.classList.toggle('hidden', !showNext);
  if (showNext) { next.textContent = `Proceed to ${FLOW_NAMES[FLOW[idx + 1]]} ›`; next.disabled = !stageComplete(stage); }
  $('flow-need').textContent = showNext ? stageNeed(stage) : '';
  panelToggleLabel();
  const fb = $('btn-focus'); if (fb) fb.textContent = stage === 'output' || stage === 'view' ? 'Focus proposal' : 'Focus site';
  $('btn-open-ground')?.classList.toggle('hidden', state.mode === 'plan'); $('btn-face')?.classList.toggle('hidden', !(state.mode === 'observer' && proposalBox() && proposalShown()));
  // drag and view: once you stand somewhere, the how-to turns into what you can do next
  const dh = document.querySelector('.method-body[data-stage="view"][data-method="drag"] .method-howto'); if (dh) { dh.dataset.base ??= dh.innerHTML; const placed = state.observerSource === 'exploratory' && !!state.observer;
    const html = placed ? '<b>You’re standing here.</b> Drag the view to look around, or use <b>Pick a spot on the plan</b> to stand somewhere else.' : dh.dataset.base; if (dh.innerHTML !== html) dh.innerHTML = html; }
  const navPdf = $('btn-nav-pdf'); if (navPdf) navPdf.classList.toggle('hidden', stage !== 'output' || !!choosing); // the report is Output's main action, so it stays in view
  // once a site is placed, step 1 (find the area) folds away so the next action is in view; the user can reopen it
  const find = $('site-find'), placed = !!state.site && !state.drawing; if (find) { if (placed && !find.dataset.placed) find.classList.add('collapsed'); if (!placed) find.classList.remove('collapsed'); find.dataset.placed = placed ? '1' : ''; $('btn-site-find-open').setAttribute('aria-expanded', String(!find.classList.contains('collapsed'))); }
  // multi-building working list
  const list = $('multi-list');
  if (list && stage === 'site' && method === 'multi' && assets.ready) {
    const key = state.multiSel.map(q => (q.ext ? 'e' : 's') + q.index).join(',') + '|' + state.removed.length; if (list.dataset.key !== key) { list.dataset.key = key; list.replaceChildren();
      state.multiSel.forEach((q, n) => { const c = (q.ext ? assets.extIndex : assets.index).columns, b = c.bbox[q.index], li = document.createElement('li');
        const type = c.osm_type[q.index]; li.innerHTML = `<span><b>${n + 1}</b> ${esc(!type || type === 'yes' ? 'Building' : type[0].toUpperCase() + type.slice(1).replaceAll('_', ' '))} · ≈ ${fmt(b[3] - b[0], 0)} × ${fmt(b[4] - b[1], 0)} m · top z ${fmt(b[5], 0)} m</span>`;
        const x = document.createElement('button'); x.type = 'button'; x.className = 'x'; x.textContent = '×'; x.setAttribute('aria-label', `Remove building ${n + 1} from the group`); x.addEventListener('click', () => toggleMultiBuilding(q.index, q.ext)); li.appendChild(x); list.appendChild(li); });
      if (!state.multiSel.length) { const li = document.createElement('li'); li.className = 'muted'; li.textContent = 'No buildings selected yet.'; list.appendChild(li); } }
    const applied = state.removed.length === state.multiSel.length && state.multiSel.every(q => isReplaced(q.index, q.ext));
    $('btn-multi-apply').disabled = !state.multiSel.length || applied; $('btn-multi-clear').disabled = !state.multiSel.length;
    $('btn-multi-apply').textContent = applied ? `Site uses ${state.multiSel.length} building${state.multiSel.length === 1 ? '' : 's'}` : state.removed.length ? `Update site (${state.multiSel.length})` : `Use ${state.multiSel.length || ''} as site`.replace('  ', ' ');
  }
  const alt = state.flow.alt; if (state.drawing) alt.place = 'boundary';
  const siteDone = stage === 'site' && stageComplete('site'), area = state.boundary.length >= 3 ? SiteGeometry.metrics(state.boundary).area : null;
  document.querySelectorAll('.inline-proceed').forEach(el => { const k = el.dataset.proceedFor;
    const show = siteDone && !choosing && (k === 'spot' ? method === 'point' && alt.place === 'spot' : k === 'boundary' ? method === 'point' && alt.place === 'boundary' && !state.drawing && !!area : k === method);
    el.classList.toggle('hidden', !show); if (!show) return;
    el.querySelector('.ip-text').textContent = k === 'spot' ? 'Site point placed' : k === 'boundary' ? `Boundary measured · ${formatArea(area)}` : k === 'replace' ? 'Building replaced' : `Site set from ${state.removed.length} building${state.removed.length === 1 ? '' : 's'}${area ? ' · ' + formatArea(area) : ''}`; });
  document.querySelectorAll('.site-alt[data-alt-step]').forEach(el => { const chosen = alt[el.dataset.altStep];
    el.classList.toggle('alt-active', chosen === el.dataset.alt); el.classList.toggle('alt-dimmed', !!chosen && chosen !== el.dataset.alt); });
  $('tools').classList.add('flow-managed');
}
// Compatibility for older links, self-tests and studies: step 1 = before output, 2–3 = output.
function setStep(n) { n = clamp(Math.round(n), 1, 3); if (n >= 2) flowGo('output', { force: true, step: n, quiet: true }); else { if (state.flow.stage === 'output') flowGo('view', { force: true, quiet: true }); state.step = 1; refreshPanels(); requestRender(); writeHash(); } }
function stepStatus() { const n = state.step; const P = proposalBox(); switch (n) { case 1: return [state.site ? 'site set' : 'no site', P ? `${fmt(P.top-P.base, 0)} m tall` : 'no proposal', state.observer ? (state.observerSource === 'origin' ? `observer at origin ${state.viewpoint}` : state.observerSource === 'rooftop' ? 'rooftop observer' : 'exploratory observer') : 'no observer'].join(' · '); case 2: return proposalBox() ? `${planAnalysis().length} mapped corridor(s) meet this proposal` : 'place a proposal'; default: return ''; } }
const HS = { 0: 'measured (OSM height tag)', 1: 'floor count', 2: 'type estimate', 3: 'unknown' };
function refreshTechReadout(P, eye) { // coordinates and source IDs live in Technical details, not in the step panels
  const el = $('tech-readout'); if (!el) return; const roof = state.observerSource === 'rooftop' ? state.observer?.building : null;
  el.textContent = [state.site ? `Site: x ${fmt(state.site.x)}, y ${fmt(state.site.y)} m, terrain z ${fmt(state.site.z)} m (model-relative).` : 'Site: not set.',
    P ? `Building: ${P.parts.length} part(s), base z ${fmt(P.base)} m, top z ${fmt(P.top)} m, bounding extent ${fmt(P.box[3] - P.box[0], 0)} × ${fmt(P.box[4] - P.box[1], 0)} m.` : 'Building: none.',
    eye ? `Viewpoint: x ${fmt(eye[0])}, y ${fmt(eye[1])} m, eye z ${fmt(eye[2])} m${roof ? `; roof z ${fmt(state.observer.z)} m on ${roof.source} building ${roof.id}, height ${roof.height_source}, unverified` : ''}.` : 'Viewpoint: none.'].join(' ');
}
let buildingViewPending=null,buildingViewError='';
function refreshBuildingViewInfo() {
  const details=$('building-view-details'),text=$('building-view-info'); if(!details || !text)return;
  const selected=state.selected!==null && assets.ready;
  details.classList.toggle('hidden',!selected); if(!selected)return;
  const catalogue=state.selectedExt?assets.extIndex:assets.index, id=catalogue.columns.osm_id[state.selected], api=window.VistaBuildingViewHeights;
  const record=api?.get(!!state.selectedExt,id);
  if(record) {
    const allowance=record.studyViewMaximumHeightM===null ? 'View-only maximum: unresolved.' : `Assumed view-only maximum above ground ${fmt(record.studyViewMaximumHeightM)} m${record.studyViewAllowanceM<0 ? ` (the assumed ceiling is ${fmt(-record.studyViewAllowanceM)} m below ground)` : ''}.`;
    text.textContent=record.viewIds.length ? `Mapped views: ${record.viewIds.join(', ')}. Official maximum: unresolved; the City source does not provide complete lower-boundary planes or an aligned vertical datum. Hypothetical level-plane study: ceiling ${fmt(record.studyCeilingElevationM)} m; flat ground assumption ${fmt(record.studyGroundM)} m. ${allowance} This allowance can exceed the existing building height. Existing model height ${fmt(record.existingHeightM)} m → study height ${fmt(record.studyHeightM)} m; reduction ${fmt(record.studyReductionM)} m. Limiting view: ${record.limitingViewIds.join(', ')}. The lowest overlapping plane controls the full footprint. This assumes a level plane at each raw observer elevation; it is not a verified City limit.` : 'No overlap with the 24 loaded view corridors. This view layer adds no calculated restriction. Zoning, grades and other development controls still apply; an overall permitted height is not established.';
    return;
  }
  text.textContent=buildingViewError || (api?.isLoaded()?'No matching source building record.':'Loading prepared building heights…');
  if(api && !api.isLoaded() && !buildingViewPending && !buildingViewError) {
    buildingViewPending=api.load().then(()=>refreshBuildingViewInfo()).catch(error=>{buildingViewError='Building view data could not be loaded. Reload to retry.';refreshBuildingViewInfo();}).finally(()=>{buildingViewPending=null;});
  }
}
function refreshPanels() { window.VistaHeights?.refresh(); refreshConeCeiling(); window.VistaEnvelope?.refresh(); window.VistaLocation?.refresh(); updateCleared(); refreshStudyUI(); const P = proposalBox(); const eye = observerEye();
  refreshNearbyRooftops(); refreshStreetChoices(); refreshViewpointNavigation();
  $('site-info').textContent = state.site ? (state.boundary.length >= 3 ? 'Site set: your drawn boundary.' : state.removed.length ? `Site set: replacing ${state.removed.length} existing building${state.removed.length === 1 ? '' : 's'}.` : 'Site set: a point on open ground.') : 'No site yet.'; $('site-info').classList.toggle('muted', !state.site);
  $('proposal-info').textContent = P ? `${P.parts.length} ${state.pmode==='import'?'imported part':'block'}${P.parts.length === 1 ? '' : 's'} · ${fmt(P.top - P.base, 0)} m tall · about ${fmt(P.box[3] - P.box[0], 0)} × ${fmt(P.box[4] - P.box[1], 0)} m overall` : (state.site ? 'No building yet.' : 'Set the site first; your building stands on it.');
  refreshTechReadout(P, eye);
  const pill = (id, txt, ok) => { const el = $(id); el.textContent = txt; el.classList.toggle('ok', !!ok); };
  pill('pill-site', state.site ? 'Set' : 'Not set', !!state.site); const built = !!P && (!state.flow.guided || !!state.flow.methods.build); pill('pill-proposal', built ? `${VistaUnits.formatLength(P.top-P.base,state.displayUnits)}` : 'None', built); pill('pill-view', state.observer ? (state.observerSource === 'origin' ? `${state.viewpoint}` : state.observerSource === 'rooftop' ? 'Roof' : state.observerSource === 'street' ? 'Street' : 'Ground') : 'None', !!state.observer);
  if (eye) { let extra = ''; const tgt = proposalCentre(); if (tgt && P) { const dh = Math.hypot(tgt[0] - eye[0], tgt[1] - eye[1]); const ang = Math.atan2(P.top - eye[2], dh) * 180 / Math.PI; extra = ` · ${fmt(dh, 0)} m to your building, its top ${fmt(Math.abs(ang), 0)}° ${ang < 0 ? 'below' : 'above'} eye level${Math.abs(ang-state.cams.observer.pitch*180/Math.PI) > state.fov / 2 ? ' (out of view at this field: scroll to widen it, or stand farther away)' : ''}`; }
    const roof = state.observerSource === 'rooftop' ? state.observer.building : null;
    $('obs-info').textContent = `${state.observerSource === 'origin' ? (state.mode === 'observer' ? 'Standing at' : 'Saved viewpoint at') + ' the origin of protected view ' + state.viewpoint + ' · eye ' + fmt(state.eyeH) + ' m above ground' : roof ? 'Rooftop viewpoint · eye ' + fmt(state.eyeH) + ' m above the roof' + (terrainZAt(state.observer.x, state.observer.y) !== null ? ', roof about ' + fmt(Math.max(0, state.observer.z - terrainZAt(state.observer.x, state.observer.y)), 0) + ' m high' : '') : (state.observerSource==='street' ? 'Street viewpoint · eye ' : 'Ground viewpoint · eye ') + fmt(state.eyeH) + ' m above ' + (state.observer.ground === 'water' ? 'the water (no deck modelled)' : 'ground')}${extra}.${roof ? ' Roof height is approximate; access is unknown.' : ''}`; $('obs-info').classList.remove('muted'); }
  else { $('obs-info').textContent = { cone: selectedCone() ? 'Selected on the map. You’re still in free inspection; “View from here” moves you to this viewpoint.' : 'Free inspection. Choose a protected view, then “View from here”.', roof: 'No viewpoint yet. Click a roof in the plan or pick a nearby building.', drag: 'No viewpoint yet. Press a spot on the plan and drag to aim.' }[state.flow.methods.view] || 'No viewpoint yet.'; $('obs-info').classList.add('muted'); }
  $('mode-observer').disabled = !state.observer; $('mode-inspect').disabled = !P; $('btn-look').disabled = !(state.observer && P); $('btn-run-check').disabled = !P; for (const id of ['cam-n', 'cam-e', 'cam-s', 'cam-w', 'cam-opposite', 'cam-top']) $(id).disabled = !P;
  const selectedRoofButton = $('btn-observer-on-building'); if (selectedRoofButton) { selectedRoofButton.classList.toggle('hidden', state.selected === null); selectedRoofButton.disabled = state.selected === null || (isRemoved(state.selected, !!state.selectedExt) && !state.showExisting); }
  const eyeLabel = $('eye-h')?.closest('label'); if (eyeLabel) eyeLabel.firstChild.textContent = state.observerSource === 'rooftop' ? 'Eye above roof (m)' : 'Eye height (m)';
  const nc = state.cleared.length; if (state.flow.stage === 'build' && nc > (refreshPanels.lastCleared || 0)) setHint(`${nc} existing building${nc === 1 ? ' is' : 's are'} under your footprint, so ${nc === 1 ? 'it is' : 'they are'} shown as demolished. To keep ${nc === 1 ? 'it' : 'them'}, untick “Demolish buildings the proposal overlaps” below.`); refreshPanels.lastCleared = nc;
  const ci = $('cleared-info'); if (ci) { const show = state.flow.stage === 'build' && !!P && (state.cleared.length > 0 || !state.clearOverlaps || !!state.clearanceWarning); ci.classList.toggle('hidden', !show); $('chk-clear-overlaps').checked = state.clearOverlaps;
    $('cleared-text').textContent = state.clearanceWarning || (!state.clearOverlaps ? 'Buildings your proposal overlaps are kept. Tick the box to treat them as demolished.' : `${state.cleared.length} existing building${state.cleared.length === 1 ? '' : 's'} under your proposal ${state.cleared.length === 1 ? 'is' : 'are'} shown as demolished to make room. This is a study assumption, not an approval.`); }
  const bi = $('building-info'); if (state.selected !== null && assets.ready) { const c = (state.selectedExt ? assets.extIndex : assets.index).columns, i = state.selected, b = c.bbox[i]; bi.textContent = `${state.selectedExt ? 'Extension building (current OSM, © OpenStreetMap contributors)' : 'Existing building (supplied model)'} osm_id ${c.osm_id[i]} · ${c.osm_type[i] || '—'} · height_m ${c.height_m[i] === null ? '—' : c.height_m[i]} (${HS[c.height_source[i]]}) · ≈ ${fmt(b[3] - b[0], 0)} × ${fmt(b[4] - b[1], 0)} m · top z ${fmt(b[5])} m. Model bounding dimensions; not a parcel survey.`; bi.classList.remove('hidden'); }
  else bi.classList.add('hidden');
  refreshBuildingViewInfo(); refreshImportedParcels(); refreshLiveStudy(); $('step-status').textContent = stepStatus(); refreshFlowUI(); refreshCaption(); window.VistaViewcone?.refresh(); window.VistaHeightSuggestion?.refresh(); scheduleRefit();
  $('tech-json').textContent = JSON.stringify(technicalState(), null, 1); if (state.flow.stage === 'output') { renderReport(); window.__report?.renderBuilder(); } }
function technicalState() { const m = assets.manifest; const P = proposalBox(); const c = selectedCone();
  return { schema: 'vancouver-site-study/1', name: state.studyName, resume_hash: serializeHash(), saved_at: new Date().toISOString(), imported_geometry_included: false, label: 'VISUAL EXPLORATION AND TEACHING ONLY — NOT A PROTECTED-VIEW ASSESSMENT', regulatory_applicability: 'NOT ASSESSED', coordinates: assets.unified ? 'model XY metres, Z up; rebuilt SRTM ground, building bases shifted vertically (see context_rebuild)' : 'model metres, Z up, untransformed (see source.display_transform)',
    step: state.step, flow: { stage: state.flow.stage, methods: state.flow.methods }, site: state.site, study_area: state.boundary.length >= 3 ? { boundary_model_xy: state.boundary, ...SiteGeometry.metrics(state.boundary), units: 'metres; horizontal area in square metres', status: 'user-defined study boundary, not a legal parcel; total horizontal study area may include water; vacancy, ownership and redevelopment eligibility unknown' } : null, hypothetical_removals: state.removed.map(r => ({ osm_id: r.id, source: r.ext ? 'extension' : 'supplied' })), cleared_for_proposal: { enabled: state.clearOverlaps && !state.clearanceWarning, buildings: state.cleared.map(r => ({ osm_id: r.id, source: r.ext ? 'extension' : 'supplied' })), method: 'indexed source triangles intersect the proposal footprint in plan after a 0.5 m inward shrink', warning: state.clearanceWarning || null }, existing_comparison_visible: state.showExisting, display_layers: state.layers, visual_style: state.sceneStyle, proposal_mode: state.pmode, blocks: state.pmode === 'boxes' ? state.parts : null, imported: state.imported ? { name: state.imported.name, parts: state.imported.parts.map((p) => ({ name: p.name, bbox: p.bbox, triangles: p.triangles })), units_status: state.imported.units_status, placement: state.imported.placement } : null,
    display_units: state.displayUnits, geometry_units: 'm', geographic_reference:window.VistaLocation?.reference() || window.VistaGeoreference?.describe(), geographic_location:window.VistaLocation?.exportGeoJSON() || null,
    proposal: P ? { footprint_bbox: P.box, base_z_model_relative: P.base, top_z_model_relative: P.top, parts: P.parts.map(p => ({name:p.name,box:p.box,rotation:state.pmode==='boxes' ? p.rotation || 0 : null,footprint:p.footprint || null})) } : null,
    observer: state.observer ? { source: state.observerSource, ground: state.observer, eye_height_m: state.eyeH, eye_height_reference: state.observerSource === 'rooftop' ? 'above modelled roof surface' : 'above modelled ground or water', roof_model_height_unverified: state.observerSource === 'rooftop', visibility_status: 'exploratory visualisation, not a verified sightline or regulatory assessment', eye: observerEye(), yaw_rad: state.cams.observer.yaw, pitch_rad: state.cams.observer.pitch, fov_deg: state.fov } : null,
    viewpoint: c ? { view_number: c.view_number, name: c.name, description: c.description, origin_model_xy: c.origin_model_xy, origin_latlon: c.origin_latlon, origin_derivation: c.origin_derivation, origin_inside_model_extent: c.origin_inside_model_extent, height_boundary: c.height_boundary, height_boundary_status: c.height_boundary_status, city_page: c.url } : (state.viewpoint || null),
    plan_overlap: {status: assets.cones?.available ? (P ? 'evaluated in plan only' : 'no proposal') : 'data unavailable', approximation: state.pmode === 'import' ? 'part bounding boxes' : 'rotated block footprints', corridors: planAnalysis().map(m=>({view_number:m.cone.view_number,name:m.cone.name,relation:m.relation})), regulatory_applicability:'NOT ASSESSED'},
    cone_ceiling: {geometry:coneStudy,result:coneCeilingResult(),classification:'USER STUDY PLANES; NOT VERIFIED CITY HEIGHT LIMITS'},
    view_envelope: window.VistaEnvelope ? (()=>{const r=window.VistaEnvelope.getResult();return {certainty:r.certainty,scope:r.scope,coverage:r.coverage,limitingPoint:r.limitingPoint,proposalCheck:window.VistaEnvelope.proposalCheck,geometryExport:'Use Download 3D surface and Download calculation in Output for the complete clipped upper envelope.'};})() : null,
    study_ceiling: {enabled:!state.check.unknown,reference:state.check.reference,height_above_base_m: P ? state.check.bz-P.base : null,elevation_model_m:state.check.unknown?null:state.check.bz},
    view_cones_source: assets.cones && assets.cones.available ? assets.cones.provenance : null, transformation: assets.geo,
    context_rebuild: assets.unified, context_display_cleanup: assets.modelCleanup,
    context_extension: assets.extension ? { purpose: assets.extension.purpose, target_extent_model_m: assets.extension.target_extent_model_m, counts: assets.extension.counts, height_rules: { measured: assets.extension.height_rules.measured, levels: assets.extension.height_rules.levels, estimated: assets.extension.height_rules.estimated }, sources: assets.extension.sources, caveats: assets.extension.caveats } : null,
    check: state.check.result ? { hypothesis: state.check.result.hypothesis, overall_result: state.check.result.overall_result, max_penetration_m: state.check.result.max_penetration_m, min_signed_margin_m: state.check.result.min_signed_margin_m, parts: state.check.result.parts.map((p) => ({ part: p.part, geometric_result: p.result.geometric_result, signed_margin_m: p.result.signed_margin_m, penetration_m: p.result.penetration_m })), evaluation_area: state.check.input ? state.check.input.test_area : null, statement_kinds: state.check.result.statement_kinds } : null,
    guideline_source: assets.guideline ? assets.guideline.source : null, mode: state.mode, cameras: state.cams,
    source: m ? m.source : null, display_transform: m ? m.display_transform : null, counts: m ? m.counts : null, unverified: m ? m.observed_metadata_unverified : null }; }
function renderReport() { const t = technicalState(); const g = assets.guideline; const r = state.check.result; const box = $('report');
  const row = (k, v) => `<tr><th>${esc(k)}</th><td>${v}</td></tr>`;
  const corridorMatches = planAnalysis();
  const noResultText = !proposalBox() ? 'Add a proposal to see the view study.' : state.check.busy ? 'Updating the view study…' : state.check.error ? state.check.error : state.check.unknown ? 'No ceiling set. Set an assumed ceiling to explore the proposal against a hypothetical height.' : 'Updating the view study…';
  let h = `<p><b>${esc(t.label)}</b>. Regulatory applicability: <b>${esc(t.regulatory_applicability)}</b>.</p>`;
  h += `<h3>1 · Context</h3><table>${row('Source model', esc(t.source ? t.source.filename + ' · sha256 ' + t.source.sha256.slice(0, 16) + '… · ' + t.source.model_units + ' · ' + t.source.object_count + ' objects' : '—'))}${row('Coverage', (t.context_rebuild ? 'Rebuilt terrain and coastline; original building shapes and elevated parts retained, placement adjusted to new ground. ' : 'full supplied model, no transform, ') + (t.counts ? t.counts.buildings.toLocaleString() + ' buildings' : '') + (t.context_extension ? '; plus a context extension outside it (' + t.context_extension.counts.buildings.toLocaleString() + ' OSM buildings on SRTM terrain, © OpenStreetMap contributors) so all 24 view origins have ground' : ''))}${row('Site', t.site ? esc(`x ${fmt(t.site.x)}, y ${fmt(t.site.y)} m · terrain z ${fmt(t.site.z)} m (model-relative)`) : 'not set')}</table>`;
  h += `<p><b>Study area:</b> ${t.study_area ? esc(formatArea(t.study_area.area) + ', perimeter ' + fmt(t.study_area.perimeter) + ' m. User-defined horizontal area, not a legal parcel.') : 'Point only; no boundary measured.'} <b>Hypothetical removals:</b> ${t.hypothetical_removals.length} replaced as the site, ${state.cleared.length} demolished under the proposal; ${state.showExisting ? 'existing comparison shown' : 'proposed scene shown'}. Vacancy and redevelopment eligibility unknown.</p>`;
  h += `<h3>2 · Proposal</h3>` + (t.proposal ? `<table><tr><th>Part</th><th>x range</th><th>y range</th><th>rotation</th><th>base z</th><th>top z</th></tr>${t.proposal.parts.map((p) => `<tr><td>${esc(p.name)}</td><td>${fmt(p.box[0])}…${fmt(p.box[3])}</td><td>${fmt(p.box[1])}…${fmt(p.box[4])}</td><td>${p.rotation == null ? '—' : fmt(p.rotation, 1) + '°'}</td><td>${fmt(p.box[2])}</td><td>${fmt(p.box[5])}</td></tr>`).join('')}</table><p class="muted">${esc(state.pmode === 'import' ? 'Imported model (' + t.imported.name + '; ' + t.imported.units_status + '; placement: ' + t.imported.placement + '); each part is represented by its bounding box.' : 'Stacked rotated blocks; the lowest sits on the active terrain at the site.')}</p>` : '<p class="muted">No proposal.</p>');
  h += `<h3>3 · Viewpoint</h3>` + (t.viewpoint && t.viewpoint.view_number ? `<table>${row('Protected view', esc(t.viewpoint.view_number + ' — ' + t.viewpoint.name))}${row('Cone source', esc('City open data “view-cones” (plan polygons; ' + (t.view_cones_source ? 'accessed ' + t.view_cones_source.accessed + ', ' + t.view_cones_source.license : '') + '); by-laws authoritative'))}${row('Origin', esc(t.viewpoint.origin_inside_model_extent ? `at x ${fmt(t.viewpoint.origin_model_xy[0])}, y ${fmt(t.viewpoint.origin_model_xy[1])} m (${t.viewpoint.origin_derivation}; within supplied terrain coverage)` : 'outside the model coverage; not moved'))}${row('Height boundary', esc(t.viewpoint.height_boundary_status))}${row('Transformation', esc(t.transformation ? t.transformation.method : '—'))}</table>` : '<p class="muted">No protected view selected.</p>') + (t.observer ? `<p>${esc((t.observer.source === 'origin' ? 'Observer at the open-data origin' : t.observer.source === 'rooftop' ? `Exploratory rooftop observer on ${t.observer.ground.building.source} building ${t.observer.ground.building.id}; model roof height unverified; visibility exploratory` : 'Exploratory ground observer') + ` · eye z ${fmt(t.observer.eye[2])} m (model-relative) · field of view ${t.observer.fov_deg}°`)}</p>` : '<p class="muted">No observer.</p>');
  h += `<h3>4 · View study</h3>`;
  if (r) {
    const ceiling = state.check.unknown ? 'No ceiling set' : state.check.reference === 'height'
      ? `${fmt(state.check.height, 2)} m above proposal base`
      : `${fmt(state.check.bz, 2)} m model elevation`;
    h += `<p><b>${esc(resultLabel(r))}</b></p><table>${row('Assumed ceiling', esc(ceiling))}${row('Comparison area', esc(state.check.area === 'custom' ? 'Custom rectangle' : 'Proposal footprint'))}${row('Explanation',esc(explainCheck(r)))}${row('Deterministic computation', esc(`height above ceiling ${fmt(r.max_penetration_m, 2)} m · minimum clearance ${fmt(r.min_signed_margin_m, 2)} m`))}${row('Source statement', g ? esc('“' + g.clauses[0].quote + '” (cl. ' + g.clauses[0].ref + ', p.' + g.clauses[0].page + ')') : '—')}${row('What remains open', esc('The loaded City dataset does not supply cone heights. This is a plan and geometric comparison only; it does not test City height limits, policy exceptions, or regulatory compliance.'))}${row('Human or City interpretation', esc('whether a real cone applies at this site; whether any of 3.1.2–3.1.5 applies; the 2 m provision in 3.1.5; view shadows 3.3; Exceptional Downtown Sites 3.4 — none decided by the tool'))}</table>`;
  } else h += `<p class="muted">${esc(noResultText)}</p>`;
  h += `<h3>5 · Public-view plan overlap</h3>`;
  h += corridorMatches.length
    ? `<ul>${corridorMatches.map((m) => `<li><b>${esc(m.cone.view_number + ' · ' + m.cone.name)}</b>: ${esc(String(m.relation).replaceAll('_', ' ').toLowerCase())}</li>`).join('')}</ul>`
    : `<p class="muted">${!proposalBox() ? 'No proposal to evaluate.' : !assets.cones?.available ? 'City corridor data unavailable.' : 'No mapped corridor overlap.'}</p>`;
  h += '<p class="muted">Plan overlap shows where a proposal meets a published view corridor. City cone heights are absent from the loaded dataset; this is not a City height or policy test.</p>';
  h += `<h3>Unverified and not evaluated</h3><ul>${t.context_rebuild ? '<li>Rebuilt ground and water: one approximate SRTM surface with mapped OSM coastlines and inland water. Building shapes, heights and elevated parts retained; placement shifted by the change in ground elevation. Not survey-verified.</li>' : t.context_extension ? '<li>Context extension: current OpenStreetMap footprints (not the supplied model\'s 2022 extraction) extruded with rules inferred from the supplied model, on ~60 m SRTM terrain; south seam joined for display; east/coastal seams remain uncorrected and elevations are unverified.</li>' : ''}<li>Model placement: projection identified from and checked against 8 OpenStreetMap footprints (max residual 0.1 m); absolute accuracy inherits OpenStreetMap.</li><li>${t.context_rebuild ? 'Active elevations: SRTM-derived EGM96 heights, not survey-verified or reconciled with the City datum. Original Rhino vertical datum remains unknown.' : 'Model vertical datum: unknown; all z values are model-relative.'}</li><li>Building heights: OpenStreetMap-derived (measured tag / floor count / type estimate), 2022 extraction user-reported.</li><li>Cone heights (horizontal lower boundaries): not in the open data; nothing fabricated.</li><li>Plan overlap is evaluated against mapped view polygons; vertical policy boundaries and City height limits are not evaluated.</li></ul>`;
  box.innerHTML = h; }

// ------------------------------------------------------------------ URL hash state
let hashTimer = null;
function serializeHash() { const p = new URLSearchParams(); const r = (v) => Number(v).toFixed(3);
  p.set('u', VistaUnits.normalizeUnit(state.displayUnits));
  p.set('style',state.sceneStyle); p.set('name', state.studyName); p.set('boundary', state.boundary.map(q => q.map(r).join(',')).join(';')); p.set('removed', state.removed.map(q => (q.ext ? 'e:' : 's:') + q.id).join(',')); p.set('existing', state.showExisting ? '1' : '0'); if (!state.clearOverlaps) p.set('clear', '0'); p.set('layers', Object.entries(state.layers).filter(([,v]) => v).map(([k]) => k).join(','));
  p.set('step', state.step); p.set('flow', state.flow.stage); p.set('fm', ['site', 'build', 'view'].map(k => state.flow.methods[k] || '').join(',')); if (state.site) p.set('site', `${r(state.site.x)},${r(state.site.y)}`); p.set('parts', state.parts.map((q) => [q.h, q.w, q.d, q.dx, q.dy].join(',') + ',' + encodeURIComponent(q.name)).join(';')); p.set('pm', state.pmode); p.set('rot',state.parts.map(q=>q.rotation || 0).join(','));
  if (state.observer) { p.set('obs', `${r(state.observer.x)},${r(state.observer.y)}`); p.set('osrc', state.observerSource); if (state.observerSource === 'rooftop' && state.observer.building) p.set('roof', `${state.observer.building.source === 'extension' ? 'e' : 's'}:${state.observer.building.id}`); } p.set('eye', state.eyeH); p.set('fov', state.fov); p.set('mode', state.mode); p.set('wedge', state.wedge ? 1 : 0); p.set('allcones', state.showAllCones ? 1 : 0); p.set('bd', state.showBackdrop ? 1 : 0);
  if (state.viewpoint) p.set('view', state.viewpoint); p.set('bz', state.check.unknown ? 'unknown' : state.check.bz); p.set('cref', state.check.reference); p.set('ch', state.check.height); p.set('area', state.check.area); if (state.check.custom) p.set('carea', [state.check.custom.x_min, state.check.custom.x_max, state.check.custom.y_min, state.check.custom.y_max].join(','));
  const o = state.cams.overview; p.set('cam', [o.az, o.el, o.dist, o.target[0], o.target[1], o.target[2]].map(r).join(',')); const i = state.cams.inspect; p.set('icam', [i.az, i.el, i.dist].map(r).join(',')); const l = state.cams.observer; p.set('look', [l.yaw, l.pitch].map(r).join(','));
  if (Object.keys(coneStudy.planes).length || coneStudy.datumOffsetM !== null || !coneStudy.show) p.set('cp', JSON.stringify({planes:coneStudy.planes,datumOffsetM:coneStudy.datumOffsetM,datumName:coneStudy.datumName,show:coneStudy.show}));
  return '#' + p.toString(); }
function writeHash() { if (hashTimer) return; hashTimer = setTimeout(() => { hashTimer = null; history.replaceState(null, '', serializeHash()); }, 150); }
function applyHash(hash) { const p = new URLSearchParams((hash || location.hash).replace(/^#/, '')); const num = (k, lo, hi, dflt) => { const v = parseFloat(p.get(k)); return Number.isFinite(v) ? clamp(v, lo, hi) : dflt; };
  window.dispatchEvent(new Event('vista:clear-address'));
  state.displayUnits = VistaUnits.normalizeUnit(p.get('u'));
  try { restoreConeStudy(p.has('cp') ? JSON.parse(p.get('cp')) : null); } catch (_) { restoreConeStudy(null); }
  setSceneStyle(p.get('style') || 'collage',false);
  state.studyName = (p.get('name') || 'Untitled study').slice(0,80); $('study-name').value = state.studyName; state.drawing = null; state.selected = null;
  const pair = (k) => { const s = p.get(k); if (!s) return null; const a = s.split(',').map(Number); return a.length === 2 && a.every(Number.isFinite) ? a : null; };
  if (p.get('parts')) { const parts = []; for (const chunk of p.get('parts').split(';')) { const f = chunk.split(','); if (f.length >= 5 && f.slice(0, 5).every((v) => Number.isFinite(parseFloat(v)))) parts.push({ h: clamp(+f[0], 1, 400), w: clamp(+f[1], 1, 300), d: clamp(+f[2], 1, 300), dx: clamp(+f[3], -500, 500), dy: clamp(+f[4], -500, 500), name: decodeURIComponent(f[5] || 'Block') }); } if (parts.length) state.parts = parts; }
  else if (p.get('h')) state.parts = [{ name: 'Tower', h: num('h', 1, 400, 120), w: num('w', 1, 300, 30), d: num('d', 1, 300, 30), dx: num('dx', -500, 500, 0), dy: num('dy', -500, 500, 0) }];
  const rotations=(p.get('rot') || '').split(',').map(Number); state.parts.forEach((q,i)=>q.rotation=Number.isFinite(rotations[i]) ? clamp(rotations[i],-180,180) : 0);
  state.pmode = p.get('pm') === 'import' ? 'import' : 'boxes'; state.eyeH = num('eye', 0.5, 100, 1.6); state.fov = num('fov', 20, 110, 60); state.wedge = p.get('wedge') !== '0'; state.showAllCones = p.get('allcones') === '1'; state.showBackdrop = p.get('bd') !== '0';
  const cam = (p.get('cam') || '').split(',').map(Number); if (cam.length === 6 && cam.every(Number.isFinite)) state.cams.overview = { az: cam[0], el: clamp(cam[1], 0.03, 1.55), dist: clamp(cam[2], 30, 30000), target: [cam[3], cam[4], cam[5]] };
  const ic = (p.get('icam') || '').split(',').map(Number); if (ic.length === 3 && ic.every(Number.isFinite)) state.cams.inspect = { az: ic[0], el: clamp(ic[1], 0.03, 1.55), dist: clamp(ic[2], 20, 30000) };
  const lk = (p.get('look') || '').split(',').map(Number); if (lk.length === 2 && lk.every(Number.isFinite)) state.cams.observer = { yaw: lk[0], pitch: clamp(lk[1], -1.48, 1.48) };
  const s = pair('site'); state.site = null; if (s) { const z = landZAt(s[0], s[1]); state.site = z === null ? null : { x: s[0], y: s[1], z }; }
  state.boundary = []; const boundary = (p.get('boundary') || '').split(';').filter(Boolean).map(q => q.split(',').map(Number)); if (boundary.length && !SiteGeometry.validate(boundary)) state.boundary = boundary;
  state.removed = []; for (const token of (p.get('removed') || '').split(',')) { const ext = token.startsWith('e:'), id = token.slice(2), index = (ext ? assets.extIndex : assets.index)?.columns.osm_id.indexOf(id); if (index >= 0 && !isReplaced(index, ext)) state.removed.push({index, ext, id}); }
  state.showExisting = p.get('existing') === '1'; state.clearOverlaps = p.get('clear') !== '0'; clearedKey = ''; state.cleared = []; if (p.has('layers')) for (const key of Object.keys(state.layers)) state.layers[key] = p.get('layers').split(',').includes(key);
  const o = pair('obs'); state.observer = null; state.observerSource = 'exploratory';
  if (o && p.get('osrc') === 'rooftop') {
    const token = p.get('roof') || '', ext = token.startsWith('e:'), prefixValid = token.startsWith('e:') || token.startsWith('s:'), id = token.slice(2);
    const c = (ext ? assets.extIndex : assets.index)?.columns, index = prefixValid && id ? c?.osm_id.findIndex(v => String(v) === id) : -1;
    if (index >= 0 && !(isRemoved(index, ext) && !state.showExisting)) {
      const roof = roofZAt(index, ext, o[0], o[1]);
      const highest = highestRoofAtXY(o[0], o[1]);
      if (roof && highest && highest.z <= roof.z + 0.2) { state.observer = { x: o[0], y: o[1], z: roof.z, ground: 'roof', building: { id, source: ext ? 'extension' : 'supplied', index, height_m: c.height_m[index], height_source: HS[c.height_source[index]] || HS[3] } }; state.observerSource = 'rooftop'; }
    }
  } else if (o) { const g = groundZAt(o[0], o[1]); state.observer = g ? { x: o[0], y: o[1], z: g.z, ground: g.source } : null; state.observerSource = p.get('osrc') === 'origin' ? 'origin' : p.get('osrc') === 'street' && g?.source === 'terrain' && StreetGeometry.nearest(o[0],o[1],streetRoadArrays(),20) ? 'street' : 'exploratory'; }
  if(liveTimer) clearTimeout(liveTimer); liveTimer=null; liveSignature=''; state.check.busy=false; state.check.error=null;
  state.check.result=null; state.check.input=null; state.check.requestId++; state.check.reference=p.get('cref') === 'height' || !p.has('bz') ? 'height' : 'elevation'; state.check.height=num('ch',0,500,120); state.check.unknown=true;
  state.viewpoint = p.get('view') || null; const bz = p.get('bz'); if (bz === 'unknown') state.check.unknown = true; else if (Number.isFinite(parseFloat(bz))) { state.check.bz = parseFloat(bz); state.check.unknown = false; }
  state.check.area = p.get('area') === 'custom' ? 'custom' : 'footprint'; const ca = (p.get('carea') || '').split(',').map(Number); if (ca.length === 4 && ca.every(Number.isFinite)) state.check.custom = { x_min: ca[0], x_max: ca[1], y_min: ca[2], y_max: ca[3] };
  $('eye-h').value = state.eyeH; $('fov').value = state.fov; $('chk-wedge').checked = state.wedge; $('chk-cones').checked = state.showAllCones; $('chk-backdrop').checked = state.showBackdrop; $('check-bz').value = state.check.bz; $('chk-bz-unknown').checked = state.check.unknown; $('check-area').value = state.check.area; $('custom-area').classList.toggle('hidden', state.check.area !== 'custom');
  if (state.check.custom) { $('ca-xmin').value = state.check.custom.x_min; $('ca-xmax').value = state.check.custom.x_max; $('ca-ymin').value = state.check.custom.y_min; $('ca-ymax').value = state.check.custom.y_max; }
  renderPartsList(); refreshImportInfo(); setProposalMode(state.pmode); populateViews(); selectView(state.viewpoint);
  if (lk.length !== 2 && state.observer && proposalBox()) aimAtProposal();
  const mode = p.get('mode'); if (!setMode(mode === 'observer' || mode === 'inspect' || mode === 'plan' ? mode : 'overview')) setMode('overview'); const st = num('step', 1, 5, 1), step = st >= 4 ? st - 2 : st; // old 5-step links map onto the 3 stages
  state.flow.choosing = null;
  state.flow.alt = { find: null, place: state.boundary.length >= 3 && !state.removed.length ? 'boundary' : state.site && !state.removed.length ? 'spot' : null };
  const fm = (p.get('fm') || '').split(','); if (p.has('flow') && FLOW.includes(p.get('flow'))) { // a missing method before the saved stage is inferred from the study content
    const stage = p.get('flow'), inferred = inferMethods(); state.flow.methods = {};
    ['site', 'build', 'view'].forEach((k, i) => { state.flow.methods[k] = FLOW_METHODS[k].includes(fm[i]) ? fm[i] : FLOW.indexOf(k) < FLOW.indexOf(stage) ? inferred[k] : null; });
    state.flow.guided = true; state.flow.stage = stage; } else inferFlow(step);
  // The selected build method controls which editor is available, even in older/incomplete links.
  const restoredPmode=state.flow.methods.build==='import' ? 'import' : state.flow.methods.build==='platform' ? 'boxes' : state.pmode;
  if(restoredPmode!==state.pmode)setProposalMode(restoredPmode);
  while (state.flow.stage !== 'site' && !stageReachable(state.flow.stage)) state.flow.stage = FLOW[FLOW.indexOf(state.flow.stage) - 1];
  state.multiSel = state.flow.methods.site === 'multi' || state.removed.length > 1 ? state.removed.map(q => ({ ...q })) : []; // a one-building group restores as a group
  flowGo(state.flow.stage, { force: true, step, quiet: true });
  if(state.observerSource==='street' && state.observer && !usableStreetPoint(state.observer)){state.observer=null;state.observerSource='exploratory';setMode('plan');applyFlowTool();setHint('The saved street position is no longer usable with this model. Choose another mapped street.');}
  // refreshPanels schedules a live calculation for a saved ceiling.
}

// ------------------------------------------------------------------ UI wiring
function bindNumber(id, apply) { const el = $(id); const h = () => { const v = parseFloat(el.value); if (!Number.isFinite(v)) return; const lo = parseFloat(el.min), hi = parseFloat(el.max); const c = (Number.isFinite(lo) && Number.isFinite(hi)) ? clamp(v, lo, hi) : v; if (c !== v) el.value = c; apply(c); refreshPanels(); requestRender(); writeHash(); }; el.addEventListener('input', h); el.addEventListener('change', h); }
bindNumber('eye-h', (v) => { state.eyeH = v; }); bindNumber('fov', (v) => { state.fov = v; }); bindNumber('check-bz', (v) => { state.check.bz = v; state.check.reference='elevation'; });
for (const id of ['ca-xmin', 'ca-xmax', 'ca-ymin', 'ca-ymax']) bindNumber(id, () => { const v = ['ca-xmin', 'ca-xmax', 'ca-ymin', 'ca-ymax'].map((k) => parseFloat($(k).value)); if (v.every(Number.isFinite)) state.check.custom = { x_min: Math.min(v[0], v[1]), x_max: Math.max(v[0], v[1]), y_min: Math.min(v[2], v[3]), y_max: Math.max(v[2], v[3]) }; state.check.result = null; renderCheck(); });
$('enable-height-study').addEventListener('change',e=> { state.check.unknown=!e.target.checked; refreshPanels(); requestRender(); writeHash(); });
for (const id of ['ceiling-height','ceiling-slider']) bindNumber(id,v=> {state.check.reference='height'; state.check.height=v;});
$('btn-study-site').addEventListener('click',()=>{ flowGo('site', { force: true }); });
$('chk-bz-unknown').addEventListener('change', (e) => { state.check.unknown = e.target.checked; $('check-bz').disabled = state.check.unknown; state.check.result = null; renderCheck(); refreshPanels(); requestRender(); writeHash(); });
$('check-area').addEventListener('change', (e) => { state.check.area = e.target.value; $('custom-area').classList.toggle('hidden', state.check.area !== 'custom'); if (state.check.area === 'custom' && !state.check.custom) { const a = evaluationArea(); if (a) { state.check.custom = { x_min: Math.floor(a.x_min - 10), x_max: Math.ceil(a.x_max + 10), y_min: Math.floor(a.y_min - 10), y_max: Math.ceil(a.y_max + 10) }; $('ca-xmin').value = state.check.custom.x_min; $('ca-xmax').value = state.check.custom.x_max; $('ca-ymin').value = state.check.custom.y_min; $('ca-ymax').value = state.check.custom.y_max; } } state.check.result = null; refreshPanels(); requestRender(); writeHash(); });
$('btn-run-check').addEventListener('click', () => { runCheck().then((r) => { if (r) setHint(`Check done: ${r.overall_result} (hypothetical). Read the clauses below, then continue to the report.`); }).catch((e) => showError('Check failed: ' + e)); });
$('chk-wedge').addEventListener('change', (e) => { state.wedge = e.target.checked; requestRender(); writeHash(); }); $('chk-cones').addEventListener('change', (e) => { state.showAllCones = e.target.checked; requestRender(); writeHash(); }); $('chk-backdrop').addEventListener('change', (e) => { state.showBackdrop = e.target.checked; requestRender(); writeHash(); });
$('mode-overview').addEventListener('click', () => setMode('overview')); $('mode-observer').addEventListener('click', () => setMode('observer')); $('mode-inspect').addEventListener('click', () => setMode('inspect'));
$('tool-site').addEventListener('click', () => setTool('site')); $('tool-observer').addEventListener('click', () => setTool('observer')); $('tool-identify').addEventListener('click', () => setTool('identify'));
$('tool-rooftop')?.addEventListener('click', () => setTool('rooftop'));
$('btn-observer-on-building')?.addEventListener('click', viewFromSelectedRoof);
$('btn-look').addEventListener('click', lookTowardProposal);
$('btn-clear-site').addEventListener('click', () => { state.flow.alt = { find: null, place: null }; state.site = null; state.boundary = []; state.drawing = null; state.removed = []; state.multiSel = []; state.showExisting = false; state.check.result = null; applyFlowTool(); refreshPanels(); requestRender(); writeHash(); });
$('btn-clear-observer').addEventListener('click', () => { state.observer = null; state.observerSource = 'exploratory'; setMode(state.mode === 'inspect' ? 'inspect' : 'overview'); if (['drag','roof','street'].includes(state.flow.methods.view)) { planView(); applyFlowTool(); } });
$('btn-reset-context').addEventListener('click', resetToContext); $('btn-plan').addEventListener('click', planView);
// Export to PDF is handled by report.js (PDF contents builder).
$('cam-n').addEventListener('click', () => inspectFrom(Math.PI / 2, 0.3)); $('cam-e').addEventListener('click', () => inspectFrom(0, 0.3)); $('cam-s').addEventListener('click', () => inspectFrom(-Math.PI / 2, 0.3)); $('cam-w').addEventListener('click', () => inspectFrom(Math.PI, 0.3));
$('cam-opposite').addEventListener('click', () => { if (!setMode('inspect')) return; state.cams.inspect.az += Math.PI; requestRender(); writeHash(); }); $('cam-top').addEventListener('click', () => inspectFrom(null, 1.55));
$('pmode-boxes').addEventListener('click', () => setProposalMode('boxes')); $('pmode-import').addEventListener('click', () => setProposalMode('import')); $('btn-add-part').addEventListener('click', () => addPart());
$('file-import').addEventListener('change', async (e) => {
  const input=e.target,file=input.files?.[0];if(!file)return;
  const ticket = { cancelled: false, controller: new AbortController() }; activeImport = ticket;
  input.disabled=true;$('import-ui').setAttribute('aria-busy','true');$('cancel-import').classList.remove('hidden');
  $('import-info').textContent='Reading '+file.name+'…';
  try{await importFile(file);}
  finally{if(activeImport===ticket)activeImport=null;input.value='';input.disabled=false;$('import-ui').removeAttribute('aria-busy');$('cancel-import').classList.add('hidden');}
}); $('cancel-import').addEventListener('click', cancelImport); $('import-placement').addEventListener('change', (e) => { if (state.imported) { state.imported.placement = e.target.value; state.check.result = null; refreshPanels(); requestRender(); } });
$('view-select').addEventListener('change', (e) => selectView(e.target.value)); $('btn-observer-at-origin').addEventListener('click', () => viewFromHere());
document.querySelectorAll('.flow-step').forEach((el) => el.addEventListener('click', () => flowGo(el.dataset.stage)));
document.querySelectorAll('.method-card').forEach((el) => el.addEventListener('click', () => chooseMethod(el.dataset.stage, el.dataset.method)));
document.querySelectorAll('.method-keep').forEach((el) => el.addEventListener('click', () => { state.flow.choosing = null; applyFlowTool(); setHint(FLOW_HINTS[flowMethod(el.dataset.keep)]); refreshPanels(); }));
$('btn-site-find-open')?.addEventListener('click', () => { $('site-find').classList.remove('collapsed'); $('btn-site-find-open').setAttribute('aria-expanded', 'true'); $('place-select').focus(); });
// Real Vancouver towers as worked examples (KPF/Spotless-style preset scenarios). Each replaces the modelled tower (its OSM parts, via the
// multi-building site method) with one block of the published height; the footprint is approximate (80% of the parts' hull). Hashes come from a headless run of the app itself.
const EXAMPLES = [
  { key: 'shangri-la', name: 'Shangri-La Vancouver', address: '1128 W Georgia St', facts: '201 m · 62 storeys · completed 2008 · James K.M. Cheng Architects · its wedge-shaped plan was itself shaped by the view cones', hash: "#style=collage&name=Example+-+Shangri-La+Vancouver+%281128+W+Georgia+St%29&boundary=-233.830%2C311.460%3B-199.210%2C311.460%3B-197.870%2C329.950%3B-197.870%2C339.430%3B-199.210%2C364.890%3B-233.830%2C364.890&removed=s%3Aw360939772%2Cs%3Aw360939773%2Cs%3Aw360939774%2Cs%3Aw360939775&existing=0&layers=labels%2Croads&step=1&flow=view&fm=multi%2Cplatform%2Croof&site=-216.123%2C338.145&parts=201%2C29%2C43%2C0%2C0%2CShangri-La%2520Vancouver&pm=boxes&rot=0&obs=-305.253%2C101.423&osrc=rooftop&roof=s%3Aw238647499&eye=1.6&fov=60&mode=overview&wedge=1&allcones=0&bd=1&bz=unknown&cref=height&ch=120&area=footprint&cam=-0.750%2C0.360%2C820.000%2C-216.123%2C338.145%2C120.522&icam=-0.900%2C0.350%2C400.000&look=1.211%2C0.306" },
  { key: 'vancouver-house', name: 'Vancouver House', address: '1480 Howe St', facts: '152 m to roof · 52 storeys · completed 2020 · BIG with DIALOG', hash: "#style=collage&name=Example+-+Vancouver+House+%281480+Howe+St%29&boundary=-775.480%2C-885.060%3B-724.650%2C-885.060%3B-724.650%2C-834.240%3B-775.480%2C-834.240&removed=s%3Aw1092241825&existing=0&layers=labels%2Croads&step=1&flow=view&fm=multi%2Cplatform%2Croof&site=-750.065%2C-859.650&parts=152%2C41%2C41%2C0%2C0%2CVancouver%2520House&pm=boxes&rot=0&obs=-501.343%2C-891.570&osrc=rooftop&roof=s%3Aw684219120&eye=1.6&fov=60&mode=overview&wedge=1&allcones=0&bd=1&bz=unknown&cref=height&ch=120&area=footprint&cam=-0.750%2C0.360%2C820.000%2C-750.065%2C-859.650%2C96.686&icam=-0.900%2C0.350%2C400.000&look=3.014%2C-0.194" },
  { key: 'butterfly', name: 'The Butterfly', address: '969 Burrard St', facts: '170 m to roof (179 m to top) · 57 storeys · completed 2024 · Revery Architecture, Bing Thom’s last design', hash: "#style=collage&name=Example+-+The+Butterfly+%28969+Burrard+St%29&boundary=-443.640%2C-115.150%3B-407.080%2C-115.150%3B-407.080%2C-72.670%3B-443.640%2C-72.670&removed=s%3Aw1524215054%2Cs%3Aw1524215055%2Cs%3Aw1524215056%2Cs%3Aw1524215057%2Cs%3Aw1524215058&existing=0&layers=labels%2Croads&step=1&flow=view&fm=multi%2Cplatform%2Croof&site=-425.360%2C-93.910&parts=170%2C29%2C34%2C0%2C0%2CThe%2520Butterfly&pm=boxes&rot=0&obs=-500.647%2C148.167&osrc=rooftop&roof=s%3Aw310602033&eye=1.6&fov=60&mode=overview&wedge=1&allcones=0&bd=1&bz=unknown&cref=height&ch=120&area=footprint&cam=-0.750%2C0.360%2C820.000%2C-425.360%2C-93.910%2C119.755&icam=-0.900%2C0.350%2C400.000&look=-1.269%2C0.127" },
];
function openExample(key) { const ex = EXAMPLES.find((e) => e.key === key) || EXAMPLES[0];
  if (state.site && !confirm(`Open the ${ex.name} example? It replaces your current study. To keep yours, cancel and use Study file › Save study first.`)) return;
  window.__vistaIntroSeen = true; location.assign(location.pathname + '?intro=0&example=' + ex.key + ex.hash); }
document.querySelectorAll('[data-open-example]').forEach((b) => b.addEventListener('click', () => openExample(b.dataset.openExample)));
{ const ex = EXAMPLES.find((e) => e.key === new URLSearchParams(location.search).get('example'));
  if (ex && $('example-banner')) { $('example-banner-text').innerHTML = `<b>Real tower · ${ex.name}</b> · ${ex.address} · ${ex.facts}. The modelled tower is replaced by one block of its published height; the footprint is approximate. Explore any step, or use <b>Output › Start a new study</b> for your own.`; $('example-banner').classList.remove('hidden'); } }
$('btn-example-close')?.addEventListener('click', () => $('example-banner').classList.add('hidden'));
// Keyboard route: observer arrows translate; other map modes orbit or pan.
canvas.addEventListener('keydown', (e) => { if (!assets.ready || e.ctrlKey || e.metaKey || e.altKey) return; const k = e.key, f = e.shiftKey ? 4 : 1, r = canvas.getBoundingClientRect(); let used = true;
  if (/^[ijkl]$/i.test(k)&&state.mode==='observer'&&state.observer)lookObserver(k,f);
  else if (k.startsWith('Arrow')) { const dx = k === 'ArrowLeft' ? -1 : k === 'ArrowRight' ? 1 : 0, dy = k === 'ArrowUp' ? -1 : k === 'ArrowDown' ? 1 : 0;
    if (state.mode === 'observer' && state.observer) moveObserver(k,(e.repeat?0.2:1)*f);
    else if (state.mode === 'plan') { const o = state.cams.overview, d = o.dist * 0.04 * f; o.target[0] += dx * d; o.target[1] -= dy * d; }
    else { const o = state.mode === 'inspect' ? state.cams.inspect : state.cams.overview; o.az -= dx * 0.07 * f; o.el = clamp(o.el - dy * 0.04 * f, 0.03, 1.55); } }
  else if (k === '+' || k === '=') zoomBy(-0.15); else if (k === '-' || k === '_') zoomBy(0.15);
  else if (k === 'Enter' && state.drawing && !imagineCityOpen()) finishBoundary();
  else if (k === 'Enter' || k === ' ') { const cx = r.left + r.width / 2, cy = r.top + r.height / 2; if (!imagineCityOpen() && state.tool === 'aim' && state.mode !== 'observer') { if (beginAim(cx, cy)) endAim(false); } else handleClick(cx, cy, 0); }
  else used = false;
  if (used) { e.preventDefault(); e.stopPropagation(); requestRender(); } });
// Viewpoint action buttons keep focus after selection; arrows still walk unless a text/form control owns them.
document.addEventListener('keydown',e=>{
  if(imagineCityOpen()||e.target===canvas||e.defaultPrevented||e.ctrlKey||e.metaKey||e.altKey||state.mode!=='observer'||!state.observer||!(/^Arrow(Up|Down|Left|Right)$/.test(e.key)||/^[ijkl]$/i.test(e.key)))return;
  if(e.target.isContentEditable||e.target.closest('input,select,textarea,[role="dialog"],dialog')||document.querySelector('dialog[open]'))return;
  e.preventDefault();if(e.key.startsWith('Arrow'))moveObserver(e.key,(e.repeat?0.2:1)*(e.shiftKey?4:1));else lookObserver(e.key,e.shiftKey?4:1);canvas.focus({preventScroll:true});
});
// pressed state for the camera and tool buttons, which otherwise show it by colour only
document.querySelectorAll('.vp-toolbar .seg-btn, [id^="pmode-"]').forEach((b) => { const sync = () => b.setAttribute('aria-pressed', String(b.classList.contains('active'))); sync(); new MutationObserver(sync).observe(b, { attributes: true, attributeFilter: ['class'] }); });
// the "?" at the end of the strip opens plain definitions of each number
$('btn-metrics-help')?.addEventListener('click', (e) => { const box = $('metrics-help'), open = box.classList.toggle('hidden') === false; e.currentTarget.setAttribute('aria-expanded', String(open)); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('metrics-help')?.classList.contains('hidden')) { $('metrics-help').classList.add('hidden'); $('btn-metrics-help').setAttribute('aria-expanded', 'false'); if (!/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName || '')) $('btn-metrics-help').focus(); } });
$('btn-face')?.addEventListener('click', () => { if (lookTowardProposal()) setHint('Now facing your building. Your viewpoint has not moved.'); });
$('btn-viewpoint-prev')?.addEventListener('click', () => stepViewpoint(-1));
$('btn-viewpoint-next')?.addEventListener('click', () => stepViewpoint(1));
$('btn-flow-back').addEventListener('click', flowBack); $('btn-flow-next').addEventListener('click', flowNext); $('btn-nav-pdf')?.addEventListener('click', async (e) => { const b = e.currentTarget; b.textContent = 'Exporting…'; await window.__report?.exportPdf(); b.textContent = 'Export PDF'; $('flow-need').textContent = $('pdf-status').textContent; });
document.querySelectorAll('[data-proceed]').forEach(b => b.addEventListener('click', flowNext));
$('btn-multi-apply').addEventListener('click', applyMultiSelection); $('btn-multi-clear').addEventListener('click', () => { state.multiSel = []; setHint('Selection cleared. Click buildings to start a new group.'); refreshPanels(); requestRender(); });
$('btn-street-pick').addEventListener('click',()=>{planView();applyFlowTool();revealMap();setHint(FLOW_HINTS.street);});
$('btn-drag-again').addEventListener('click', () => { planView(); applyFlowTool(); revealMap(); setHint(FLOW_HINTS.drag); });
// Start a new study from Output: clears the study and goes straight to the Site chooser (no intro).
function clearAddressUI() { $('address-query').value = ''; $('address-results').replaceChildren(); $('address-status').textContent = 'Start typing a street number, for example 801 W Georgia.'; }
function setAddressPin(pin) { state.addressPin = pin && Number.isFinite(pin.x) && Number.isFinite(pin.y) ? { x: pin.x, y: pin.y, label: String(pin.label || 'Address') } : null; requestRender(); }
function startNewStudy() { state.addressPin = null; $('example-banner')?.classList.add('hidden');
  if (hashTimer) { clearTimeout(hashTimer); hashTimer = null; }
  cancelImport(); disposeImported(state.imported); state.imported = null; state.parts = [{ name: 'Tower', h: 120, w: 30, d: 30, dx: 0, dy: 0, rotation: 0 }]; state.check.custom = null; state.check.bz = 120; state.check.height = 120; state.check.reference = 'height';
  applyHash('#style=' + state.sceneStyle); $('file-import').value = ''; $('import-info').textContent = IMPORT_EMPTY;
  state.flow = { stage: 'site', methods: { site: null, build: null, view: null }, choosing: null, guided: false, alt: { find: null, place: null } }; state.multiSel = [];
  $('new-study-confirm').classList.add('hidden'); window.__report?.reset(); clearAddressUI(); resetToContext(); flowGo('site', { force: true }); history.replaceState(null, '', serializeHash());
  setHint('New study. Choose how you want to pick your site.'); return true;
}
$('btn-new-study').addEventListener('click', () => { $('new-study-confirm').classList.remove('hidden'); $('new-study-confirm').scrollIntoView({ block: 'center', behavior: 'smooth' }); $('btn-new-study-cancel').focus({ preventScroll: true }); });
$('btn-new-study-cancel').addEventListener('click', () => { $('new-study-confirm').classList.add('hidden'); $('btn-new-study').focus(); });
$('btn-new-study-save').addEventListener('click', () => $('btn-save-study').click());
$('btn-new-study-go').addEventListener('click', startNewStudy);
$('btn-download-state').addEventListener('click', () => { const blob = new Blob([JSON.stringify(technicalState(), null, 2)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'site_explorer_report.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); });
$('btn-download-image').addEventListener('click', () => { render(); const a = document.createElement('a'); a.href = canvas.toDataURL('image/png'); a.download = `site_explorer_${state.mode}.png`; a.click(); });
// on phones the step panel folds away; its toggle names the current step so it reads as the way back
function panelToggleLabel() { const t = $('btn-panel-toggle'), open = !$('panel').classList.contains('collapsed'), i = FLOW.indexOf(state.flow.stage);
  if(imagineCityOpen()){t.textContent=open?'Hide Imagine':'Show Imagine';t.classList.toggle('attn',!open);return;}
  t.textContent = open ? 'Hide steps' : `Steps · ${state.flow.stage === 'output' ? 'Output' : (i + 1) + ' ' + FLOW_NAMES[state.flow.stage]}`; t.classList.toggle('attn', !open); }
new MutationObserver(panelToggleLabel).observe($('panel'), { attributes: true, attributeFilter: ['class'] });
$('btn-panel-toggle').addEventListener('click', () => { const p = $('panel'); p.classList.toggle('collapsed'); $('btn-panel-toggle').setAttribute('aria-expanded', String(!p.classList.contains('collapsed'))); setTimeout(() => { resize(); requestRender(); }, 50); });
window.addEventListener('resize', () => { resize(); requestRender(); });
for(const name of ['vista-imagine-city-opened','vista-imagine-city-closed'])document.addEventListener(name,()=>{resize();panelToggleLabel();window.VistaViewcone?.refresh();requestRender();});
const floatBtn = document.createElement('button'); floatBtn.className = 'btn hidden'; floatBtn.id = 'btn-overview-float'; floatBtn.textContent = '‹ City overview'; floatBtn.style.cssText = 'position:absolute;right:10px;top:10px;'; $('viewport').appendChild(floatBtn); floatBtn.addEventListener('click', () => setMode('overview'));


$('tool-boundary').addEventListener('click', beginBoundary);
$('btn-draw-site').addEventListener('click', beginBoundary);
$('btn-open-ground').addEventListener('click', () => { if (state.drawing) cancelBoundary(); state.flow.alt.place = 'spot'; planView(); applyFlowTool(); revealMap(); setHint('Click open ground in the plan to place your site.'); refreshPanels(); });
// Using one alternative (A or B) within a site step marks it active and greys the other; the grey one stays usable.
document.querySelectorAll('.site-alt[data-alt-step]').forEach(el => { const pick = () => { if (state.flow.alt[el.dataset.altStep] === el.dataset.alt) return; state.flow.alt[el.dataset.altStep] = el.dataset.alt; refreshFlowUI(); };
  el.addEventListener('pointerdown', pick); el.addEventListener('input', pick); el.addEventListener('change', pick); el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') pick(); }); });
$('btn-find-building').addEventListener('click', () => { setTool('rooftop'); revealMap(); setHint('Click a modelled building to view toward your proposal from its roof. Plan view shows roof shapes; heights are unverified.'); });
$('btn-finish-boundary').addEventListener('click', finishBoundary); $('btn-finish-map').addEventListener('click', finishBoundary); $('btn-cancel-map').addEventListener('click', cancelBoundary);
$('btn-undo-vertex').addEventListener('click', () => { if (state.drawing) state.drawing.pop(); refreshStudyUI(); requestRender(); });
$('btn-cancel-boundary').addEventListener('click', cancelBoundary);
$('btn-rectangle').addEventListener('click', rectangleSite);
$('btn-replace-building').addEventListener('click', () => state.flow.methods.site === 'replace' ? replaceSingleBuilding() : replaceSelectedBuilding());
$('btn-restore-buildings').addEventListener('click', restoreBuildings);
$('chk-clear-overlaps').addEventListener('change', (e) => { state.clearOverlaps = e.target.checked; refreshPanels(); requestRender(); writeHash(); });
$('chk-existing').addEventListener('change', e => { state.showExisting=e.target.checked; const invalid = invalidateRoofObserver(); if (invalid) setMode('overview'); refreshPanels(); requestRender(); writeHash(); });
$('btn-fit-site').addEventListener('click', focusSite); $('btn-focus').addEventListener('click', focusSite);
$('btn-zoom-in').addEventListener('click', () => zoomBy(-0.35)); $('btn-zoom-out').addEventListener('click', () => zoomBy(0.35));
for (const key of Object.keys(state.layers)) $('layer-'+key).addEventListener('change',e=>{ state.layers[key]=e.target.checked; if (key === 'aerial') { aerial.error = null; aerial.tried = null; refreshAerialStatus(); aerialFollow(); } requestRender(); writeHash(); });
window.addEventListener('keydown', e => { if (imagineCityOpen() || /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return; if (state.drawing && e.key==='Enter' && !/BUTTON|CANVAS/.test(e.target.tagName)) { e.preventDefault(); finishBoundary(); } if (state.drawing && e.key==='Escape') { e.preventDefault(); cancelBoundary(); } });
if (matchMedia('(max-width: 860px)').matches) { $('panel').classList.add('collapsed'); $('btn-panel-toggle').setAttribute('aria-expanded','false'); }


function openStudy(data) {
  if (!data || data.schema !== 'vancouver-site-study/1' || typeof data.resume_hash !== 'string' || data.resume_hash.length > 100000) throw new Error('Choose a study JSON saved by this version of the Site Explorer.');
  if (hashTimer) { clearTimeout(hashTimer); hashTimer=null; } window.__report?.reset(); clearAddressUI();
  cancelImport(); disposeImported(state.imported); state.imported=null; state.check.result=null; state.check.custom=null; state.check.bz=120; state.check.unknown=true; state.check.reference='height'; state.check.height=120; state.check.requestId++;
  applyHash(data.resume_hash); history.replaceState(null,'',serializeHash());
  const missing = state.pmode==='import'; $('import-info').textContent=missing ? 'Reopen the original '+(data.imported?.name || '.3dm or .obj')+' file; imported geometry is not included in study JSON.' : 'No model loaded.';
  setHint('Study reopened: '+state.studyName+(assets.unified && !data.context_rebuild ? '. Site and observer elevations recalculated on the rebuilt terrain.' : '.')+(missing ? ' Reopen the original imported model to restore its geometry.' : '')); requestRender(); return true;
}
$('scene-style').addEventListener('change',e=>setSceneStyle(e.target.value));
$('study-name').addEventListener('input',e=>{ state.studyName=e.target.value.slice(0,80); writeHash(); });
$('btn-save-study').addEventListener('click',()=>{ const blob=new Blob([JSON.stringify(technicalState(),null,2)],{type:'application/json'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=(state.studyName.replace(/[^a-z0-9_-]+/gi,'-') || 'site-study')+'.json'; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),1000); setHint('Study JSON saved. Keep it beside your iteration notes; Open study restores its settings. Imported geometry must be reopened separately.'); });
$('btn-open-study').addEventListener('click',()=>$('file-study').click());
$('file-study').addEventListener('change',async e=>{const f=e.target.files[0]; if (!f) return; try { if(f.size>1024*1024) throw new Error('Study JSON must be smaller than 1 MB.'); openStudy(JSON.parse(await f.text())); } catch(err) {setHint('Could not open study: '+err.message);} finally {e.target.value='';} });
$('place-select').addEventListener('change',e=>{ if(e.target.value==='') return; const place=assets.places[+e.target.value]; if(!place) return; state.cams.overview.target=[place.x,place.y,place.z]; state.cams.overview.dist=1800; planView(); applyFlowTool(); revealMap(); setHint('Viewing '+place.text+'. '+(state.drawing ? 'Keep clicking to add boundary corners.' : 'Now click open ground and confirm the location, or draw a boundary.')); });

// ------------------------------------------------------------------ boot
function frame() { if (needsRender) { needsRender = false; try { render(); } catch (e) { showError('Render error: ' + (e && e.message || e)); } } requestAnimationFrame(frame); }
const readyPromise = (async () => { if (!gl || !PM) throw new Error('WebGL2 unavailable');
  try { await loadAssets(); } catch (e) { $('loading').classList.add('hidden'); showError('Could not load the context model: ' + (e && e.message || e)); throw e; }
  const e = assets.manifest.extent_m.scene_bbox; state.cams.overview.target = [(e[0] + e[3]) / 2, (e[1] + e[4]) / 2, 20]; renderClauseCards(); applyHash(); refreshPanels(); requestRender(); render(); return true; })();
requestAnimationFrame(frame);


// ------------------------------------------------------------------ PDF report (fixed template, several views)
// ------------------------------------------------------------------ experimental aerial photo texture
// Stitches 8 x 8 City of Vancouver 2022 orthophoto tiles (zoom 17, about 1.6 km square) around the view centre into one
// WebGL texture. Model XY maps to the tile mosaic with a per-axis linear fit (Web Mercator is near-linear at this scale).
const aerial = { tex: null, map: [0, 0, 0, 0], centre: null, loading: false, error: null, token: 0 };
async function loadAerial(x, y) {
  const Geo = window.AerialContextGeo; if (!Geo || aerial.loading) return false; const token = ++aerial.token; aerial.loading = true; aerial.error = null; refreshAerialStatus();
  const Z = 17, N = 8, TS = 256, ll = Geo.modelToLonLat(x, y), w = Geo.lonLatToWorld(ll.lon, ll.lat, Z), tx0 = Math.floor(w.x / TS) - N / 2, ty0 = Math.floor(w.y / TS) - N / 2;
  const cv = document.createElement('canvas'); cv.width = cv.height = N * TS; const ctx = cv.getContext('2d'); ctx.fillStyle = '#8a8f86'; ctx.fillRect(0, 0, cv.width, cv.height); let ok = 0;
  const jobs = []; for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) jobs.push(new Promise((res) => { const im = new Image(); im.crossOrigin = 'anonymous';
    im.onload = () => { ctx.drawImage(im, c * TS, r * TS); ok++; res(); }; im.onerror = () => res(); im.src = `https://tiles.arcgis.com/tiles/qrcTTRTwUoS8N47o/arcgis/rest/services/Orthophotos_2022/MapServer/tile/${Z}/${ty0 + r}/${tx0 + c}`; }));
  await Promise.all(jobs); if (token !== aerial.token) return false; aerial.loading = false;
  if (!ok) { aerial.error = 'Aerial photos could not be loaded. Check your connection.'; refreshAerialStatus(); return false; }
  if (!aerial.tex) aerial.tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, aerial.tex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
  gl.generateMipmap(gl.TEXTURE_2D); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const px0 = tx0 * TS, py0 = ty0 * TS, span = N * TS, at = (mx, my) => { const q = Geo.modelToLonLat(mx, my), p = Geo.lonLatToWorld(q.lon, q.lat, Z); return [(p.x - px0) / span, (p.y - py0) / span]; };
  const a = at(x - 500, y - 500), b = at(x + 500, y + 500); const ku = (b[0] - a[0]) / 1000, kv = (b[1] - a[1]) / 1000; aerial.map = [ku, a[0] - ku * (x - 500), kv, a[1] - kv * (y - 500)];
  aerial.centre = [x, y]; refreshAerialStatus(); requestRender(); return true;
}
function refreshAerialStatus() { const el = $('aerial-note'); if (!el) return; el.classList.toggle('hidden', !state.layers.aerial);
  el.textContent = aerial.loading ? 'Loading 2022 aerial photos…' : aerial.error || 'Aerial photos: City of Vancouver 2022 orthophoto (Open Government Licence – Vancouver), about 1.6 km around the view. Experimental: roof photos may not line up with model roofs.'; }
function aerialFollow() { if (!state.layers.aerial || aerial.loading) return; const P = proposalBox(); const t = state.mode === 'observer' && state.observer ? [state.observer.x, state.observer.y] : state.mode === 'inspect' && P ? [P.cx, P.cy] : state.cams.overview.target;
  const ref = aerial.error ? aerial.tried : aerial.centre; if (!ref || Math.hypot(t[0] - ref[0], t[1] - ref[1]) > 650) { aerial.tried = [t[0], t[1]]; loadAerial(t[0], t[1]); } } // after a failure, retry only when the view moves on or the layer is toggled

// ------------------------------------------------------------------ fixed-size captures for the PDF report
// Renders one camera into an exact pixel size and palette without touching the on-screen view, and returns a JPEG plus a
// projector from model coordinates to image fractions (0..1 from the top-left) so the report can draw exact vector overlays.
function captureScene(spec) {
  const s = Object.assign({ width: 1600, height: 900, mode: 'overview', markers: false, cones: false, wedge: false, backdrop: false, quality: 0.86 }, spec || {});
  const saved = { mode: state.mode, cams: JSON.parse(JSON.stringify(state.cams)), fov: state.fov, eyeH: state.eyeH, observer: state.observer, observerSource: state.observerSource,
    showExisting: state.showExisting, hideProposal: state.hideProposal, sceneStyle: state.sceneStyle, viewpoint: state.viewpoint, selected: state.selected, multiSel: state.multiSel, ceilingOff: state.check.unknown, aerialOn: state.layers.aerial, BG, C: { ...C } };
  try {
    if (s.style && SCENE_STYLES[s.style] && s.style !== state.sceneStyle) { state.sceneStyle = s.style; BG = [...SCENE_STYLES[s.style].bg]; Object.assign(C, SCENE_STYLES[s.style].colors); }
    state.mode = s.mode; state.selected = null; state.multiSel = []; if (!s.keepViewpoint) state.viewpoint = null; if (!s.ceiling) state.check.unknown = true; // the study ceiling is drawn as a vector chart, not in renders
    if (s.overview) state.cams.overview = { ...s.overview, target: [...s.overview.target] };
    if (s.inspect) state.cams.inspect = { ...s.inspect };
    if (s.observer) { state.observer = s.observer; state.observerSource = s.observerSource || 'exploratory'; }
    if (s.eyeH != null) state.eyeH = s.eyeH;
    if (s.yaw != null) state.cams.observer = { yaw: s.yaw, pitch: s.pitch || 0 };
    if (s.fov != null) state.fov = s.fov;
    if (s.existing != null) { state.hideProposal = !!s.existing; state.showExisting = !!s.existing; } else { state.hideProposal = false; state.showExisting = false; }
    if (!s.aerial) state.layers.aerial = false; // the licensed photo texture stays an on-screen aid
    canvas.width = s.width; canvas.height = s.height; gl.viewport(0, 0, s.width, s.height); gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(BG[0], BG[1], BG[2], 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const cam = computeCamera(s.mode, s.width / s.height);
    // Report captures keep their own declared evidence and scalar experiment;
    // the independent viewport-only cone must not leak into their screenshots.
    drawScene(cam, { markers: s.markers, wedge: s.wedge, cones: s.cones, backdrop: s.backdrop, viewcone: false });
    const url = canvas.toDataURL('image/jpeg', s.quality), vp = cam.vp;
    const toImage = (p) => { const q = project(vp, [p[0], p[1], p[2] ?? 0]); return q[3] > 0 ? [(q[0] + 1) / 2, (1 - q[1]) / 2] : null; };
    return { url, toImage, half: cam.half || null, aspect: s.width / s.height, eye: cam.eye };
  } finally {
    state.mode = saved.mode; state.cams = saved.cams; state.fov = saved.fov; state.eyeH = saved.eyeH; state.observer = saved.observer; state.observerSource = saved.observerSource;
    state.showExisting = saved.showExisting; state.hideProposal = saved.hideProposal; state.check.unknown = saved.ceilingOff; state.layers.aerial = saved.aerialOn; state.viewpoint = saved.viewpoint; state.selected = saved.selected; state.multiSel = saved.multiSel;
    if (state.sceneStyle !== saved.sceneStyle) { state.sceneStyle = saved.sceneStyle; BG = saved.BG; Object.assign(C, saved.C); }
    resize(); needsRender = false; render();
  }
}
let lastPdfPages = 0;
// The report itself (layout, sections, preview dialog) lives in report.js.
async function buildPdfReport(opts, onProgress) { if (!window.__report) throw new Error('report.js not loaded'); const r = await window.__report.build(opts, onProgress); lastPdfPages = r.pages; return r.blob; }

// ------------------------------------------------------------------ public hook (self-test, debugging)
function applyHeightReference(heightM) {
  if(state.pmode!=='boxes'||!state.site||!Number.isFinite(heightM)||heightM<=0||heightM>2000||!state.parts.length)return false;
  const total=state.parts.reduce((sum,p)=>sum+p.h,0);if(!Number.isFinite(total)||total<=0)return false;
  const heights=state.parts.map(p=>p.h*heightM/total);if(heights.some(h=>!Number.isFinite(h)||h<0.1))return false;
  state.parts.forEach((p,i)=>{p.h=heights[i];});state.check.result=null;
  renderPartsList();refreshPanels();refreshLiveStudy();requestRender();writeHash();return true;
}
function restoreProposalParts(parts) {
  if(state.pmode!=='boxes'||!state.site||!Array.isArray(parts)||!parts.length||parts.length>1000)return false;
  if(parts.some(p=>!p||typeof p.name!=='string'||p.name.length>500||![p.h,p.w,p.d,p.dx,p.dy,p.rotation??0].every(Number.isFinite)||p.h<0.1||p.h>2000||p.w<=0||p.d<=0))return false;
  state.parts=JSON.parse(JSON.stringify(parts));state.check.result=null;
  renderPartsList();refreshPanels();refreshLiveStudy();requestRender();writeHash();return true;
}
window.__explorer = { setImagineCityScene, pickImagineBuildingAt, imagineCityRenderState:()=>({active:!!imagineCityScene,versionId:imagineCityScene?.versionId,uploads:imagineCityUploads,bytes:imagineCityBytes,pickRows:imaginePickIndex?.size||0,occlusionChunks:imagineOcclusionIndex?.size||0,pickBuildMs:imaginePickMetrics.buildMs,occlusionBuildMs:imaginePickMetrics.occlusionBuildMs,lastPickMs:imaginePickMetrics.lastPickMs}), getStartupPerformance:()=>JSON.parse(JSON.stringify(startupPerformance)), applyHeightReference, restoreProposalParts, getConeStudy:()=>({...coneStudy}), importOffset, requestSiteConfirmation, pavingSurfaces, facadeSurfaces, grassSurface, waterSurface, trafficRenderInfo:()=>({enabled:state.sceneStyle==='context'&&state.layers.roads,global:trafficTextures.global?{bounds:trafficTextures.global.bounds,size:trafficTextures.global.size,stats:trafficTextures.global.stats}:null,detail:trafficTextures.local?{bounds:trafficTextures.local.bounds,size:trafficTextures.local.size,stats:trafficTextures.local.stats}:null,deck:globalTrafficSurfaces?.stats}), moveObserver, streetscapeStats:()=>streetSurfaces?{...streetSurfaces.stats,global:globalTrafficSurfaces?.stats,network:assets.traffic?.stats}:null, clearStreetSurfaces, placeStreetObserver, refreshStreetChoices, streetRoadArrays, usableStreetPoint, coneCeilingResult, restoreConeStudy, refreshConeCeiling, studySentence, setHint, setAddressPin, loadAerial, aerial, updateCleared, clearanceGeometry: { footprintRecord, footprintIndex, projectedTriangleMeetsFootprint, indexedBuildingMeetsFootprints }, isReplaced, startNewStudy, captureScene, proposalShown, partFootprint, highestRoofAtXY, formatArea, planAnalysis, renderClauseCards, SCENE_STYLES, HS, applyFlowTool, flowGo, chooseMethod, changeMethod, flowBack, flowNext, stageComplete, toggleMultiBuilding, applyMultiSelection, replaceSingleBuilding, beginAim, aimDragTo, endAim, setSceneStyle, planAnalysis, refreshLiveStudy, resultLabel, serializeHash, openStudy, landZAt, beginBoundary, addBoundaryPoint, finishBoundary, cancelBoundary, rectangleSite, replaceSelectedBuilding, restoreBuildings, focusSite, focusLocation, planView, applyPick, isRemoved, state, assets, ready: readyPromise, placeSite, placeObserver, placeObserverAtOrigin, lookTowardProposal, setMode, setTool, setStep, aimAtProposal, resetToContext, inspectFrom, selectView, selectedCone, addPart, renderPartsList, setProposalMode, parseObj, installImport, cancelImport, runCheck, evaluationArea,
  terrainZAt, groundZAt, roofZAt, preferredRoofPoint, placeRoofObserver, placeRooftopAtXY, viewFromSelectedRoof, proposalBox, proposalParts, proposalCentre, observerEye, observerForward, pickRay, rayFromClient, applyHash, refreshPanels, technicalState, explainCheck, buildPdfReport,
  checkBody, setDisplayUnits, refreshImportInfo, viewFromHere, lookObserver, viewpointNavigationState, refreshViewpointNavigation, stepViewpoint,
  renderOnce: () => { needsRender = false; render(); return lastCam; }, camera: () => lastCam, canvas, gl,
  readPixel: (fx, fy) => { const px = new Uint8Array(4); gl.readPixels(Math.round(fx * (canvas.width - 1)), Math.round(fy * (canvas.height - 1)), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); return Array.from(px); },
  buildingsPositionsChecksum: () => { const p = assets.raw.buildings.pos; let s = 0; for (let i = 0; i < p.length; i += 997) s += p[i]; return s; } };
})();
