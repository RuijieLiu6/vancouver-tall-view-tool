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
document.querySelector('.chip-link').href = window.ProjectAPI.assetUrl('synthetic/');
if (window.ProjectAPI.isStatic) $('import-info').textContent = 'No model loaded. .3dm and .obj files are read in your browser and stay on your device.';

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

const STUDIO_COLORS = Object.fromEntries(Object.entries(C).map(([key,value])=>[key,[...value]]));
const rgba = (hex, alpha=1) => [parseInt(hex.slice(1,3),16)/255,parseInt(hex.slice(3,5),16)/255,parseInt(hex.slice(5,7),16)/255,alpha];
const ILLUSTRATED_COLORS = {
  terrain:rgba('#d4d1ad'), parks:rgba('#929e4d'), water:rgba('#279faf'), buildings:rgba('#fff5d8'), buildingSel:rgba('#e9c94b'),
  roads:rgba('#696852'), shoreline:rgba('#193c50'), extent:rgba('#526854'),
  proposal:rgba('#ed884b'), proposalEdge:rgba('#3b302a'), siteEdge:rgba('#bf573b'), studyBoundary:rgba('#647f32'),
  observer:rgba('#2449a3'), ray:rgba('#2449a3'), wedge:rgba('#6589b6',.10), wedgeEdge:rgba('#2449a3',.7),
  cone:rgba('#4754a3',.04), coneSel:rgba('#4754a3',.055), coneEdge:rgba('#4754a3',.45), coneEdgeSel:rgba('#34498f'), origin:rgba('#34498f'),
  plane:rgba('#b784a7',.25), planeEdge:rgba('#8b527a'), backdrop:rgba('#84948a'),
  extBuildings:rgba('#c2d5cd'), extTerrain:rgba('#dbe1bf'), extWater:rgba('#73bcca'), extParks:rgba('#b0bd71'), extRoads:rgba('#6d8075'), extExtent:rgba('#678779'),
};
// Soft architectural collage: quiet context, with a clay proposal as the focal point.
const COLLAGE_COLORS = {
  terrain:rgba('#dedbce'), parks:rgba('#8c9c83'), water:rgba('#b7c9c9'), buildings:rgba('#fafbf8'), buildingSel:rgba('#b4c4bb'),
  roads:rgba('#aaa899'), shoreline:rgba('#8a9f9d'), extent:rgba('#94978d'),
  proposal:rgba('#ce9581'), proposalEdge:rgba('#995d4d'), siteEdge:rgba('#a76553'), studyBoundary:rgba('#526e5b'),
  observer:rgba('#476f83'), ray:rgba('#476f83'), wedge:rgba('#91b0bc',.09), wedgeEdge:rgba('#476f83',.65),
  cone:rgba('#807d97',.035), coneSel:rgba('#807d97',.045), coneEdge:rgba('#807d97',.35), coneEdgeSel:rgba('#726a87'), origin:rgba('#726a87'),
  plane:rgba('#b68c9a',.18), planeEdge:rgba('#926574'), backdrop:rgba('#b8bcb0'),
  extBuildings:rgba('#e1e8e3'), extTerrain:rgba('#e1decd'), extWater:rgba('#c6d2d0'), extParks:rgba('#a4b19a'), extRoads:rgba('#b5b9ad'), extExtent:rgba('#9ba99b'),
};
const SCENE_STYLES = {
  classic:{name:'Studio',colors:STUDIO_COLORS,bg:[.93,.94,.95],shader:0},
  illustrated:{name:'Illustrated garden',colors:ILLUSTRATED_COLORS,bg:rgba('#0fbad0').slice(0,3),shader:1},
  collage:{name:'Landscape collage',colors:COLLAGE_COLORS,bg:rgba('#f3f2ec').slice(0,3),shader:2},
};
function setSceneStyle(style, save=true) {
  state.sceneStyle=Object.hasOwn(SCENE_STYLES,style)?style:'classic';
  const palette=SCENE_STYLES[state.sceneStyle]; BG=[...palette.bg]; Object.assign(C,palette.colors);
  document.body.dataset.sceneStyle=state.sceneStyle; $('scene-style').value=state.sceneStyle;
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
precision highp float; layout(location=0) in vec3 aPos; uniform mat4 uVP; uniform vec3 uOffset; out vec3 vWorld;
void main(){ vWorld = aPos + uOffset; gl_Position = uVP * vec4(aPos + uOffset, 1.0); }`;
const FS_MESH = `#version 300 es
precision highp float;
in vec3 vWorld; uniform vec4 uColor; uniform vec3 uCamPos; uniform vec3 uFog;
uniform float uFogFar; uniform float uLightMix; uniform float uStudyActive; uniform float uStudyCeiling; uniform vec4 uStudyArea;
uniform float uSceneStyle; uniform float uSurface; out vec4 outColor;
float hash21(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float hatch(float q){ float aa=max(fwidth(q),0.001); float line=1.0-smoothstep(0.045,0.045+aa,abs(fract(q+0.5)-0.5)); return line*(1.0-smoothstep(0.22,0.7,aa)); }
float stipple(vec2 q){ vec2 cell=floor(q); vec2 centre=vec2(hash21(cell),hash21(cell+vec2(83.0,19.0)))*0.5+0.25;
  float aa=max(length(fwidth(q)),0.001); return (1.0-smoothstep(0.085,0.085+aa,length(fract(q)-centre)))*(1.0-smoothstep(0.28,0.8,aa)); }
float paperNoise(vec2 p){
  vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(hash21(i),hash21(i+vec2(1,0)),f.x),mix(hash21(i+vec2(0,1)),hash21(i+vec2(1,1)),f.x),f.y);
}
void main(){
  vec3 n=normalize(cross(dFdx(vWorld),dFdy(vWorld))); vec3 L=normalize(vec3(-0.45,-0.35,0.82)); float light=max(dot(n,L),0.0);
  bool excess=uStudyActive>0.5 && vWorld.z>uStudyCeiling+0.001 && vWorld.x>=uStudyArea.x && vWorld.y>=uStudyArea.y && vWorld.x<=uStudyArea.z && vWorld.y<=uStudyArea.w;
  vec3 base=excess ? (uSceneStyle>0.5?vec3(0.71,0.075,0.19):vec3(0.85,0.16,0.12)) : uColor.rgb;
  vec3 c=base*mix(1.0,0.50+0.50*light,uLightMix);
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
  if(uSceneStyle>1.5 && uLightMix>0.5){
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
  float f=clamp(distance(vWorld,uCamPos)/uFogFar,0.0,1.0); f=f*f*(uSceneStyle>1.5?0.38:(uSceneStyle>0.5?0.22:0.55));
  vec3 fog=uSceneStyle>1.5?vec3(0.96,0.96,0.93):(uSceneStyle>0.5?vec3(0.91,0.92,0.77):uFog);
  outColor=vec4(mix(c,fog,f),uColor.a);
}`;
const FS_LINE = `#version 300 es
precision highp float; in vec3 vWorld; uniform vec4 uColor; uniform vec3 uCamPos; uniform vec3 uFog; uniform float uFogFar; out vec4 outColor;
void main(){ float f = clamp(distance(vWorld, uCamPos) / uFogFar, 0.0, 1.0); f = f * f * 0.5; outColor = vec4(mix(uColor.rgb, uFog, f), uColor.a); }`;
function compile(type, src) { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('shader: ' + gl.getShaderInfoLog(s)); return s; }
function program(fs) { const p = gl.createProgram(); gl.attachShader(p, compile(gl.VERTEX_SHADER, VS)); gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(p)); const u = {}; for (const n of ['uVP', 'uOffset', 'uColor', 'uCamPos', 'uFog', 'uFogFar', 'uLightMix', 'uStudyActive', 'uStudyCeiling', 'uStudyArea', 'uSceneStyle', 'uSurface']) u[n] = gl.getUniformLocation(p, n); return { p, u }; }
let PM = null, PL = null; if (gl) { try { PM = program(FS_MESH); PL = program(FS_LINE); } catch (e) { showError(String(e)); } }
function makeMesh(pos, idx) { const vao = gl.createVertexArray(); gl.bindVertexArray(vao); const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, pos, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0); if (idx) { const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW); }
  gl.bindVertexArray(null); return { vao, count: idx ? idx.length : pos.length / 3, indexed: !!idx }; }
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

// ------------------------------------------------------------------ state
const state = {
  step: 1, mode: 'overview', tool: 'site', sceneStyle:'classic',
  site: null, pmode: 'boxes',
  parts: [{ name: 'Tower', h: 120, w: 30, d: 30, dx: 0, dy: 0, rotation: 0 }],
  imported: null,             // {name, units_status, parts:[{name,bbox,gl}], bbox, placement}
  observer: null, observerSource: 'exploratory', eyeH: 1.6, fov: 60, wedge: true,
  viewpoint: null, showAllCones: false, showBackdrop: true,
  check: { bz: 120, unknown: true, reference: 'height', height: 120, area: 'footprint', custom: null, result: null, requestId: 0 },
  studyName: 'Untitled study', selected: null, boundary: [], drawing: null, removed: [], showExisting: false,
  layers: { labels: true, roads: true, sources: false, extent: false },
  cams: { overview: { target: [0, 0, 20], dist: 6500, az: -1.15, el: 0.85 }, inspect: { dist: 400, az: -0.9, el: 0.35 }, observer: { yaw: 0, pitch: 0 } },
};
const assets = { ready: false, manifest: null, index: null, labels: [], meshes: {}, raw: {}, guideline: null, cones: null, geo: null, backdrop: null, extension: null, unified: null };
let needsRender = true; const requestRender = () => { needsRender = true; };

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
    const { pos, idx } = sliceMesh(bytes, spec); assets.raw[k] = { pos, idx }; assets.meshes[k] = makeMesh(pos, idx); }
  const bb = assets.index.columns.bbox; const flat = new Float64Array(bb.length * 6); for (let i = 0; i < bb.length; i++) for (let k = 0; k < 6; k++) flat[i * 6 + k] = bb[i][k]; assets.bboxes = flat;
  step('Loading guideline text and view cones…', 0.95);
  try { assets.guideline = await (await window.ProjectAPI.fetch('/api/guideline')).json(); } catch (e) { assets.guideline = null; }
  try { assets.cones = await (await window.ProjectAPI.fetch('/api/viewcones')).json(); } catch (e) { assets.cones = { available: false, cones: [] }; }
  try { assets.geo = await (await window.ProjectAPI.fetch('/api/geo')).json(); } catch (e) { assets.geo = null; }
  try { const bm = await window.ProjectAPI.fetch('/generated/backdrop_manifest.json'); if (bm.ok) { const man = await bm.json(); const spec = assets.unified?.files.backdrop || man.files.backdrop; const bytes = await fetchProgress('/generated/' + spec.file); const { pos, idx } = sliceMesh(bytes, spec); assets.raw.backdrop = { pos, idx }; assets.meshes.backdrop = makeMesh(pos, idx); assets.backdrop = man; $('chip-backdrop').classList.remove('hidden'); } } catch (e) { assets.backdrop = null; }
  try { const em = await window.ProjectAPI.fetch('/generated/extension_manifest.json'); if (em.ok) { const man = await em.json(); step('Loading context extension (OSM + SRTM)…', 0.97);
      for (const k of (assets.unified ? ['buildings'] : ['terrain', 'water', 'parks', 'buildings'])) { const spec = assets.unified ? assets.unified.files.ext_buildings : man.files[k]; if (!spec || !spec.positions.count) continue; const bytes = await fetchProgress('/generated/' + spec.file, (got) => step(`Loading ${spec.file}  ${(got / 1048576).toFixed(1)} MB`, 0.97)); if (bytes.length !== spec.byte_length) throw new Error(spec.file + ': incomplete asset'); const { pos, idx } = sliceMesh(bytes, spec); assets.raw['ext_' + k] = { pos, idx }; assets.meshes['ext_' + k] = makeMesh(pos, idx); }
      const rs = assets.unified ? null : man.files.roads; if (rs && rs.positions.count) { const bytes = await fetchProgress('/generated/' + rs.file); assets.meshes.ext_roads = makeMesh(new Float32Array(bytes.buffer, bytes.byteOffset, rs.positions.count * 3), null); }
      assets.extIndex = await (await window.ProjectAPI.fetch('/generated/' + (assets.unified ? assets.unified.ext_buildings_index : man.buildings_index))).json(); assets.extLabels = await (await window.ProjectAPI.fetch('/generated/' + man.labels)).json();
      const eb = assets.extIndex.columns.bbox; const ef = new Float64Array(eb.length * 6); for (let i = 0; i < eb.length; i++) for (let k = 0; k < 6; k++) ef[i * 6 + k] = eb[i][k]; assets.extBboxes = ef;
      const te = man.target_extent_model_m; assets.extExtentLines = new Float32Array([te[0], te[1], 1, te[2], te[1], 1, te[2], te[1], 1, te[2], te[3], 1, te[2], te[3], 1, te[0], te[3], 1, te[0], te[3], 1, te[0], te[1], 1]);
      assets.extension = man; $('chip-extension').classList.remove('hidden'); } else if (assets.unified) throw new Error('Building provenance manifest missing'); } catch (e) { if (assets.unified) throw e; assets.extension = null; showError('Context extension could not be loaded: ' + (e && e.message || e)); }
  assets.ready = true; loading.classList.add('hidden');
  if (assets.unified) {
    for (const label of [...assets.labels, ...(assets.extLabels || [])]) { const g = groundZAt(label.x, label.y); if (g) label.z = g.z; }
    $('chip-terrain').textContent = 'Terrain: rebuilt · approximate';
    $('chip-terrain').title = 'One SRTM surface across the study area, clipped to mapped OSM coastlines and inland water. Approximate elevations; not survey-verified.';
    $('chip-extension').textContent = 'Unified ground + water';
    $('chip-extension').title = 'Original and extension buildings keep their footprints and heights; placement follows changes in ground elevation, preserving elevated building parts. Original source files are preserved.';
  }
  assets.places = [...assets.labels, ...(assets.extLabels || [])].sort((a,b)=>a.text.localeCompare(b.text));
  for (const [i,place] of assets.places.entries()) { const option=document.createElement('option'); option.value=i; option.textContent=place.text; $('place-select').appendChild(option); }
  const c = m.counts, e = m.extent_m.scene_bbox;
  $('status-coverage').textContent = `Coverage: full supplied model — ${c.buildings.toLocaleString()} buildings (${c.building_triangles.toLocaleString()} triangles), ${c.terrain_meshes} terrain meshes, water, parks, ${c.road_segments.toLocaleString()} road segments, ${c.labels} place labels; extent x ${Math.round(e[0]).toLocaleString()}…${Math.round(e[3]).toLocaleString()} m, y ${Math.round(e[1]).toLocaleString()}…${Math.round(e[4]).toLocaleString()} m (model metres, no transform). Source ${m.source.filename}, sha256 ${m.source.sha256.slice(0, 12)}…, ${m.source.model_units}. View cones: ${assets.cones && assets.cones.available ? assets.cones.cones.length + ' City open-data polygons (' + assets.cones.cones.filter((k) => k.origin_inside_model_extent).length + ' origins inside the model)' : 'not loaded'}.`;
  assets.extentLines = new Float32Array([e[0], e[1], 1, e[3], e[1], 1, e[3], e[1], 1, e[3], e[4], 1, e[3], e[4], 1, e[0], e[4], 1, e[0], e[4], 1, e[0], e[1], 1]);
  if (assets.extension) { const x = assets.extension.counts; $('status-coverage').textContent += ` Extension outside the supplied model: ${x.buildings.toLocaleString()} OSM buildings (current data, © OpenStreetMap contributors, ODbL) on SRTM terrain, ${x.water_polygons} water and ${x.park_polygons} park polygons, ${x.road_segments.toLocaleString()} road segments; covers all 24 view origins; source tint available in Layers; heights and elevations unverified.`; }
  if (assets.unified) { $('status-coverage').textContent = `Rebuilt context: one continuous SRTM terrain across the study area, mapped OSM coastline and inland water (© OpenStreetMap contributors, ODbL). ${(assets.index.count + (assets.extIndex?.count || 0)).toLocaleString()} existing building shapes retained; elevated parts retained and placement adjusted to the new ground. Original Rhino file preserved. Terrain resolution approximately 60 m; elevations and building heights unverified. View cones: ${assets.cones?.cones?.length || 0} plan polygons, height limits unknown.`; }
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
function rayAABB(o, d, B, off) { let tmin = -Infinity, tmax = Infinity; for (let k = 0; k < 3; k++) { const inv = 1 / (d[k] || 1e-12); let t0 = (B[off + k] - o[k]) * inv, t1 = (B[off + 3 + k] - o[k]) * inv; if (t0 > t1) { const s = t0; t0 = t1; t1 = s; } tmin = Math.max(tmin, t0); tmax = Math.min(tmax, t1); if (tmax < tmin) return -1; } return tmax < 0 ? -1 : Math.max(tmin, 0); }
function pickRay(o, d) {
  if (!assets.ready) return { type: 'none' };
  let tT = rayMesh(o, d, assets.raw.terrain, 0, assets.raw.terrain.idx.length), tW = rayMesh(o, d, assets.raw.water, 0, assets.raw.water.idx.length);
  if (assets.raw.ext_terrain) tT = Math.min(tT, rayMesh(o, d, assets.raw.ext_terrain, 0, assets.raw.ext_terrain.idx.length)); if (assets.raw.ext_water) tW = Math.min(tW, rayMesh(o, d, assets.raw.ext_water, 0, assets.raw.ext_water.idx.length));
  let tB = Infinity, hitB = -1, ext = false; const B = assets.bboxes, cols = assets.index.columns;
  for (let i = 0; i < cols.index_offset.length; i++) { if (isRemoved(i, false) && !state.showExisting) continue; const tb = rayAABB(o, d, B, i * 6); if (tb < 0 || tb > tB) continue; const t = rayMesh(o, d, assets.raw.buildings, cols.index_offset[i], cols.index_count[i]); if (t < tB) { tB = t; hitB = i; } }
  if (assets.extIndex) { const EB = assets.extBboxes, ec = assets.extIndex.columns; for (let i = 0; i < ec.index_offset.length; i++) { if (isRemoved(i, true) && !state.showExisting) continue; const tb = rayAABB(o, d, EB, i * 6); if (tb < 0 || tb > tB) continue; const t = rayMesh(o, d, assets.raw.ext_buildings, ec.index_offset[i], ec.index_count[i]); if (t < tB) { tB = t; hitB = i; ext = true; } } }
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
  const b = im.bbox; const cx = (b[0] + b[3]) / 2, cy = (b[1] + b[4]) / 2; const gz = terrainZAt(state.site.x, state.site.y); if (gz === null) return null; return [state.site.x - cx, state.site.y - cy, gz - b[2]]; }
function proposalParts() { // [{name, box:[xmin,ymin,zmin,xmax,ymax,zmax]}] in model coordinates, or []
  if (state.pmode === 'import') { const im = state.imported; const off = importOffset(); if (!im || !off) return [];
    return im.parts.map((p) => ({ name: p.name, box: [p.bbox[0] + off[0], p.bbox[1] + off[1], p.bbox[2] + off[2], p.bbox[3] + off[0], p.bbox[4] + off[1], p.bbox[5] + off[2]] })); }
  if (!state.site || !state.parts.length) return []; const out = []; let base = null;
  for (const p of state.parts) { const cx = state.site.x + p.dx, cy = state.site.y + p.dy; if (base === null) { base = terrainZAt(cx, cy); if (base === null) return []; }
    out.push(ProposalGeometry.makePart({ name: p.name, cx, cy, zMin: base, zMax: base+p.h, w: p.w, d: p.d, rotation: p.rotation || 0 })); base += p.h; }
  return out;
}
function proposalBox() { const parts = proposalParts(); if (!parts.length) return null; const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (const p of parts) for (let k = 0; k < 3; k++) { b[k] = Math.min(b[k], p.box[k]); b[k + 3] = Math.max(b[k + 3], p.box[k + 3]); }
  return { cx: (b[0] + b[3]) / 2, cy: (b[1] + b[4]) / 2, base: b[2], top: b[5], box: b, parts }; }
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
function setCommon(prog, cam) { gl.useProgram(prog.p); if(prog.u.uSceneStyle) gl.uniform1f(prog.u.uSceneStyle,SCENE_STYLES[state.sceneStyle].shader); if(prog.u.uSurface) gl.uniform1f(prog.u.uSurface,0); if (prog.u.uStudyActive) gl.uniform1f(prog.u.uStudyActive, 0); gl.uniformMatrix4fv(prog.u.uVP, false, new Float32Array(cam.vp)); gl.uniform3fv(prog.u.uCamPos, cam.eye); gl.uniform3fv(prog.u.uFog, BG); gl.uniform1f(prog.u.uFogFar, cam.fogFar); if (prog.u.uLightMix) gl.uniform1f(prog.u.uLightMix, 1.0); gl.uniform3fv(prog.u.uOffset, [0, 0, 0]); }
function drawStatic(prog, key, color, offset) { if(prog.u.uSurface) gl.uniform1f(prog.u.uSurface,({buildings:1,ext_buildings:1,terrain:2,ext_terrain:2,parks:3,ext_parks:3,water:4,ext_water:4,backdrop:6})[key] || 0); const m = assets.meshes[key]; if (!m) return; gl.uniform4fv(prog.u.uColor, color); gl.uniform3fv(prog.u.uOffset, offset || [0, 0, 0]); gl.bindVertexArray(m.vao); if (m.indexed && /^(ext_)?buildings$/.test(key) && state.removed.length && !state.showExisting) {
    const ext = key === 'ext_buildings', cols = (ext ? assets.extIndex : assets.index).columns;
    const hidden = state.removed.filter(r => r.ext === ext).map(r => r.index).sort((a,b) => cols.index_offset[a] - cols.index_offset[b]); let start = 0;
    for (const i of hidden) { const end = cols.index_offset[i]; if (end > start) gl.drawElements(gl.TRIANGLES, end - start, gl.UNSIGNED_INT, start * 4); start = end + cols.index_count[i]; }
    if (start < m.count) gl.drawElements(gl.TRIANGLES, m.count - start, gl.UNSIGNED_INT, start * 4);
  } else if (m.indexed) gl.drawElements(gl.TRIANGLES, m.count, gl.UNSIGNED_INT, 0); else gl.drawArrays(gl.LINES, 0, m.count); gl.bindVertexArray(null); }
const CONE_TOP = 260;
function coneGeometry(c) { // vertical boundary walls from the apex to the far vertices + outline at the ground and the top
  const pts = c.polygon_model_xy; const n = pts.length; const ax = c.origin_model_xy[0], ay = c.origin_model_xy[1]; let ai = 0; for (let i = 0; i < n; i++) if (Math.abs(pts[i][0] - ax) < 0.01 && Math.abs(pts[i][1] - ay) < 0.01) ai = i;
  const prev = pts[(ai - 1 + n) % n], next = pts[(ai + 1) % n];
  const wall = new Float32Array([ax, ay, 0, prev[0], prev[1], 0, prev[0], prev[1], CONE_TOP, ax, ay, CONE_TOP, ax, ay, 0, next[0], next[1], 0, next[0], next[1], CONE_TOP, ax, ay, CONE_TOP]);
  const wallIdx = new Uint32Array([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
  const ground = [], top = []; for (let i = 0; i < n; i++) { const a = pts[i], b = pts[(i + 1) % n]; ground.push(a[0], a[1], 1, b[0], b[1], 1); top.push(a[0], a[1], CONE_TOP, b[0], b[1], CONE_TOP); } top.push(ax, ay, 0, ax, ay, CONE_TOP);
  return { wall, wallIdx, ground: new Float32Array(ground), top: new Float32Array(top) };
}
function drawScene(cam, opts) {
  const o = Object.assign({ lines: true, markers: true, wedge: true, cones: true, backdrop: false }, opts || {});
  gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.disable(gl.BLEND); gl.depthMask(true); setCommon(PM, cam);
  if (o.backdrop && state.showBackdrop && assets.meshes.backdrop) { gl.uniform1f(PM.u.uFogFar, 42000); drawStatic(PM, 'backdrop', C.backdrop); gl.uniform1f(PM.u.uFogFar, cam.fogFar); }
  if (assets.meshes.ext_terrain) { drawStatic(PM, 'ext_terrain', state.layers.sources ? C.extTerrain : C.terrain); drawStatic(PM, 'ext_water', state.layers.sources ? C.extWater : C.water); drawStatic(PM, 'ext_parks', state.layers.sources ? C.extParks : C.parks); }
  drawStatic(PM, 'ext_buildings', state.layers.sources ? C.extBuildings : C.buildings);
  drawStatic(PM, 'terrain', C.terrain); drawStatic(PM, 'water', C.water, [0, 0, 0.05]); drawStatic(PM, 'parks', C.parks, assets.unified ? null : [0, 0, 0.15]); drawStatic(PM, 'buildings', C.buildings);
  if (state.selected !== null && assets.ready && (!isRemoved(state.selected, !!state.selectedExt) || state.showExisting)) { const cols = (state.selectedExt ? assets.extIndex : assets.index).columns; gl.uniform4fv(PM.u.uColor, C.buildingSel); gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(-2, -2);
    gl.bindVertexArray(assets.meshes[state.selectedExt ? 'ext_buildings' : 'buildings'].vao); gl.drawElements(gl.TRIANGLES, cols.index_count[state.selected], gl.UNSIGNED_INT, cols.index_offset[state.selected] * 4); gl.bindVertexArray(null); gl.disable(gl.POLYGON_OFFSET_FILL); }
  const P = state.showExisting && state.removed.length ? null : proposalBox();
  if (P) { gl.uniform1f(PM.u.uSurface,5); const a = evaluationArea(); if (!state.check.unknown && a) { gl.uniform1f(PM.u.uStudyActive, 1); gl.uniform1f(PM.u.uStudyCeiling, state.check.bz); gl.uniform4fv(PM.u.uStudyArea, [a.x_min,a.y_min,a.x_max,a.y_max]); } if (state.pmode === 'import' && state.imported) { const off = importOffset(); gl.uniform4fv(PM.u.uColor, C.proposal); gl.uniform3fv(PM.u.uOffset, off); for (const p of state.imported.parts) { gl.bindVertexArray(p.gl.vao); gl.drawElements(gl.TRIANGLES, p.gl.count, gl.UNSIGNED_INT, 0); } gl.bindVertexArray(null); gl.uniform3fv(PM.u.uOffset, [0, 0, 0]); }
    else for (const part of P.parts) { dynDraw(PM, gl.TRIANGLES, part.pos, part.idx, C.proposal); } gl.uniform1f(PM.u.uStudyActive, 0); }
  const eye = observerEye();
  if (eye && o.markers) { const s = o.markerScale || 1; const ob = state.observer;
    dynDraw(PM, gl.TRIANGLES, ...Object.values(boxMesh([ob.x - 0.3 * s, ob.y - 0.3 * s, ob.z, ob.x + 0.3 * s, ob.y + 0.3 * s, eye[2]])), C.observer);
    dynDraw(PM, gl.TRIANGLES, ...Object.values(boxMesh([eye[0] - 0.5 * s, eye[1] - 0.5 * s, eye[2] - 0.2 * s, eye[0] + 0.5 * s, eye[1] + 0.5 * s, eye[2] + 0.5 * s])), C.observer); }
  const selCone = selectedCone();
  if (selCone && selCone.origin_inside_model_extent && o.markers) { const [ox, oy] = selCone.origin_model_xy; const gz = terrainZAt(ox, oy); if (gz !== null) dynDraw(PM, gl.TRIANGLES, ...Object.values(boxMesh([ox - 1.2, oy - 1.2, gz, ox + 1.2, oy + 1.2, gz + 3])), C.origin); }
  // lines
  setCommon(PL, cam);
  if (o.lines) { if (state.layers.roads) drawStatic(PL, 'roads', C.roads, assets.unified ? null : [0, 0, 0.5]); drawStatic(PL, 'shoreline', C.shoreline, [0, 0, 0.3]); if (state.layers.roads && assets.meshes.ext_roads) drawStatic(PL, 'ext_roads', C.extRoads); if (state.layers.extent && assets.extentLines) dynDraw(PL, gl.LINES, assets.extentLines, null, C.extent); if (state.layers.extent && assets.extExtentLines) dynDraw(PL, gl.LINES, assets.extExtentLines, null, C.extExtent); }
  drawStudyBoundary(cam);
  if (P) { for (const part of P.parts) dynDraw(PL, gl.LINES, part.edges || boxEdges(part.box), null, C.proposalEdge); if (state.site) { const sx = state.site.x, sy = state.site.y, sz = state.site.z + 0.5, k = 4; dynDraw(PL, gl.LINES, new Float32Array([sx - k, sy, sz, sx + k, sy, sz, sx, sy - k, sz, sx, sy + k, sz]), null, C.siteEdge); } }
  else if (state.site) { const sx = state.site.x, sy = state.site.y, sz = state.site.z + 0.5, k = 6; dynDraw(PL, gl.LINES, new Float32Array([sx - k, sy, sz, sx + k, sy, sz, sx, sy - k, sz, sx, sy + k, sz]), null, C.siteEdge); }
  if (eye && o.markers) { const tgt = proposalCentre(); const far = tgt ? tgt : V.add(eye, V.scale(observerForward(), 60)); dynDraw(PL, gl.LINES, new Float32Array([...eye, ...far]), null, C.ray);
    if (state.mode !== 'observer') dynDraw(PL, gl.LINES, new Float32Array([eye[0], eye[1], eye[2], eye[0], eye[1], eye[2] + 40]), null, C.observer); }
  if (o.cones && assets.cones && assets.cones.available) for (const c of assets.cones.cones) { if (c === selCone) { const g = coneGeometry(c); dynDraw(PL, gl.LINES, g.ground, null, C.coneEdgeSel); if (state.mode !== 'observer') dynDraw(PL, gl.LINES, g.top, null, C.coneEdgeSel); } else if (state.showAllCones) dynDraw(PL, gl.LINES, coneGeometry(c).ground, null, C.coneEdge); }
  if (selCone && selCone.origin_inside_model_extent && o.markers) { const [ox, oy] = selCone.origin_model_xy; const gz = terrainZAt(ox, oy) || 0; dynDraw(PL, gl.LINES, new Float32Array([ox, oy, gz, ox, oy, gz + 70]), null, C.origin); }
  // transparent geometry last
  gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false); gl.useProgram(PM.p); gl.uniform1f(PM.u.uLightMix, 0.0);
  // Filled plan-corridor walls obscure silhouettes in close and eye-level views.
  if (o.cones && selCone && state.mode === 'overview') { const g = coneGeometry(selCone); dynDraw(PM, gl.TRIANGLES, g.wall, g.wallIdx, C.coneSel); }
  const area = evaluationArea();
  if (area && !state.check.unknown && Number.isFinite(state.check.bz)) { const z = state.check.bz; const m = 4;
    dynDraw(PM, gl.TRIANGLES, new Float32Array([area.x_min - m, area.y_min - m, z, area.x_max + m, area.y_min - m, z, area.x_max + m, area.y_max + m, z, area.x_min - m, area.y_max + m, z]), new Uint32Array([0, 1, 2, 0, 2, 3]), C.plane);
    setCommon(PL, cam); dynDraw(PL, gl.LINES, new Float32Array([area.x_min - m, area.y_min - m, z, area.x_max + m, area.y_min - m, z, area.x_max + m, area.y_min - m, z, area.x_max + m, area.y_max + m, z, area.x_max + m, area.y_max + m, z, area.x_min - m, area.y_max + m, z, area.x_min - m, area.y_max + m, z, area.x_min - m, area.y_min - m, z]), null, C.planeEdge); gl.useProgram(PM.p); }
  if (eye && o.wedge && state.wedge && state.mode !== 'observer') { const w = wedgeGeometry(cam.aspect); if (w) { gl.useProgram(PM.p); dynDraw(PM, gl.TRIANGLES, w.pos, w.idx, C.wedge); setCommon(PL, cam); dynDraw(PL, gl.LINES, w.edges, null, C.wedgeEdge); } }
  gl.depthMask(true); gl.disable(gl.BLEND);
}
function wedgeGeometry(aspect) { const eye = observerEye(); if (!eye) return null; const f = observerForward(); const tgt = proposalCentre(); const L = tgt ? V.len(V.sub(tgt, eye)) * 1.1 : 120;
  let r = V.cross(f, [0, 0, 1]); if (V.len(r) < 1e-6) r = [1, 0, 0]; r = V.norm(r); const u = V.norm(V.cross(r, f)); const vf = state.fov * Math.PI / 180; const hh = L * Math.tan(vf / 2), hw = hh * (aspect || 1.6);
  const c = V.add(eye, V.scale(f, L)); const q = [V.add(V.add(c, V.scale(r, -hw)), V.scale(u, -hh)), V.add(V.add(c, V.scale(r, hw)), V.scale(u, -hh)), V.add(V.add(c, V.scale(r, hw)), V.scale(u, hh)), V.add(V.add(c, V.scale(r, -hw)), V.scale(u, hh))];
  return { pos: new Float32Array([...eye, ...q[0], ...q[1], ...q[2], ...q[3]]), idx: new Uint32Array([0, 1, 2, 0, 2, 3, 0, 3, 4, 0, 4, 1]),
    edges: new Float32Array([...eye, ...q[0], ...eye, ...q[1], ...eye, ...q[2], ...eye, ...q[3], ...q[0], ...q[1], ...q[1], ...q[2], ...q[2], ...q[3], ...q[3], ...q[0]]) }; }
function resize() { const dpr = Math.min(window.devicePixelRatio || 1, 2); const r = canvas.getBoundingClientRect(); const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr)); if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; requestRender(); } }
function render() { if (!gl || !PM) return; resize(); const W = canvas.width, H = canvas.height; gl.viewport(0, 0, W, H); gl.disable(gl.SCISSOR_TEST); gl.clearColor(BG[0], BG[1], BG[2], 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); if (!assets.ready) return;
  const cam = computeCamera(state.mode, W / H); lastCam = cam; drawScene(cam, { markers: state.mode !== 'observer', backdrop: state.mode === 'observer' }); if (state.mode === 'observer' && state.observer) drawInset(W, H); updateLabels(cam); updateMapCues(cam); }
function drawInset(W, H) { const dpr = canvas.width / canvas.getBoundingClientRect().width; const fr = $('inset-frame').getBoundingClientRect(), cr = canvas.getBoundingClientRect();
  const iw = Math.round(fr.width * dpr), ih = Math.round(fr.height * dpr), ix = Math.round((fr.left - cr.left) * dpr), iy = Math.round((cr.bottom - fr.bottom) * dpr);
  gl.enable(gl.SCISSOR_TEST); gl.scissor(ix, iy, iw, ih); gl.viewport(ix, iy, iw, ih); gl.clearColor(...(state.sceneStyle==='illustrated'?[0.97,0.94,0.84,1]:(state.sceneStyle==='collage'?[0.96,0.95,0.92,1]:[0.97,0.97,0.98,1]))); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  const eye = observerEye(), tgt = proposalCentre(); const centre = tgt ? V.scale(V.add(eye, tgt), 0.5) : eye; const half = Math.max(120, (tgt ? V.len(V.sub(tgt, eye)) : 0) * 0.75); const aspect = iw / ih;
  const view = lookAt([centre[0], centre[1], 3000], [centre[0], centre[1], 0], [0, 1, 0]); const proj = ortho(-half * aspect, half * aspect, -half, half, 1, 6000); const cam = { eye: [centre[0], centre[1], 3000], vp: mul(proj, view), fogFar: 1e9, aspect };
  drawScene(cam, { lines: false, wedge: true, cones: true, markerScale: Math.max(1, half / 40) }); setCommon(PL, cam); const f = observerForward(); const e2 = V.add(eye, V.scale([f[0], f[1], 0], half * 0.6));
  dynDraw(PL, gl.LINES, new Float32Array([eye[0], eye[1], eye[2] + 50, e2[0], e2[1], eye[2] + 50]), null, C.ray); gl.disable(gl.SCISSOR_TEST); gl.viewport(0, 0, W, H); }
const labelsEl = $('labels'); const labelNodes = new Map();
function labelNode(key, cls) { let n = labelNodes.get(key); if (!n) { n = document.createElement('div'); n.className = 'label ' + (cls || ''); labelsEl.appendChild(n); labelNodes.set(key, n); } n.className = 'label ' + (cls || ''); return n; }
function updateLabels(cam) { const rect = canvas.getBoundingClientRect(); const items = [];
  const boundary = state.drawing || state.boundary;
  if (boundary.length > 1 && state.mode !== 'observer') {
    for (let i = 0; i < boundary.length - (state.drawing ? 1 : 0); i++) { const a = boundary[i], b = boundary[(i+1)%boundary.length], mid = [(a[0]+b[0])/2, (a[1]+b[1])/2]; items.push({ key: 'edge'+i, text: fmt(Math.hypot(b[0]-a[0], b[1]-a[1]),1)+' m', p: [...mid, (terrainZAt(...mid) || 0)+2], cls: 'site-edge' }); }
    if (boundary.length >= 3 && !SiteGeometry.validate(boundary)) { const m = SiteGeometry.metrics(boundary); items.push({key: 'site-area', text: formatArea(m.area)+' · study area', p: [...m.centre, (terrainZAt(...m.centre)||0)+2], cls:'site'}); }
  }
  if (state.layers.labels && state.mode !== 'observer') { for (const l of assets.labels) items.push({ key: 'L' + l.text, text: l.text, p: [l.x, l.y, l.z + 40], cls: '' }); if (assets.extLabels) for (const l of assets.extLabels) items.push({ key: 'X' + l.text, text: l.text, p: [l.x, l.y, l.z + 40], cls: 'ext' }); }
  const P = state.showExisting && state.removed.length ? null : proposalBox(); if (P) { // height tag beside the silhouette, not on it: upper-right of the projected bounding box, with a leader
    const b = P.box; let sx = -Infinity, sy = Infinity, ok = false;
    for (const x of [b[0], b[3]]) for (const y of [b[1], b[4]]) for (const z of [b[2], b[5]]) { const q = project(cam.vp, [x, y, z]); if (q[3] > 0) { ok = true; sx = Math.max(sx, q[0]); if (z === b[5]) sy = Math.min(sy, q[1]); } }
    if (ok) items.push({ key: 'proposal', text: `${fmt(P.top-P.base)} m tall`, screen: [sx, sy], cls: 'proposal dim' }); }
  const eye = observerEye(); if (eye && state.mode !== 'observer') items.push({ key: 'observer', text: (state.observerSource === 'origin' ? `Observer at ${state.viewpoint} origin (open data) · eye z ${fmt(eye[2])} m` : `Exploratory observer · eye z ${fmt(eye[2])} m`), p: [eye[0], eye[1], eye[2] + 45], cls: 'observer' });
  const sc = selectedCone(); if (sc && state.mode !== 'observer') { const pts = sc.polygon_model_xy; const far = pts.reduce((a, q) => a[0] + q[0] > 0 ? a : a, pts[0]); const mid = pts.reduce((a, q) => [a[0] + q[0] / pts.length, a[1] + q[1] / pts.length], [0, 0]);
    items.push({ key: 'cone', text: `View ${sc.view_number} — ${sc.name}: plan cone (City open data; heights unknown)`, p: [mid[0], mid[1], CONE_TOP + 5], cls: 'cone' });
    if (sc.origin_inside_model_extent && state.observerSource !== 'origin') items.push({ key: 'origin', text: `Origin ${sc.view_number} (open-data apex; by-law authoritative)`, p: [sc.origin_model_xy[0], sc.origin_model_xy[1], (terrainZAt(sc.origin_model_xy[0], sc.origin_model_xy[1]) || 0) + 75], cls: 'origin' }); }
  const area = evaluationArea(); if (area && !state.check.unknown && Number.isFinite(state.check.bz) && state.mode !== 'observer') items.push({ key: 'plane', text: `Study ceiling · ${fmt(state.check.bz-(P?.base || 0))} m above base`, p: [area.x_max, area.y_min, state.check.bz + 2], cls: 'plane' });
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
  if (pointers.size === 1) drag = { x0: e.clientX, y0: e.clientY, button: e.button, shift: e.shiftKey, moved: false }; else drag = null; });
canvas.addEventListener('pointermove', (e) => { if (!pointers.has(e.pointerId)) return; const prev = pointers.get(e.pointerId); pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2) { const [a, b] = [...pointers.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y); if (drag && drag.pinch) zoomBy(Math.log(drag.pinch / d) * 1.2); drag = { pinch: d }; requestRender(); return; }
  if (!drag || drag.pinch !== undefined) return; const dx = e.clientX - prev.x, dy = e.clientY - prev.y; if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > 4) drag.moved = true; if (!drag.moved) return;
  const pan = drag.button === 2 || drag.shift || state.mode === 'plan';
  if (state.mode === 'observer' && state.observer) { const o = state.cams.observer; o.yaw -= dx * 0.0035; o.pitch = clamp(o.pitch - dy * 0.0035, -1.48, 1.48); }
  else if (state.mode === 'plan') { const o = state.cams.overview, scale = 2 * o.dist * Math.tan(Math.PI / 8) / canvas.clientHeight; o.target[0] -= dx * scale; o.target[1] += dy * scale; }
  else if (pan && state.mode === 'overview') { const o = state.cams.overview; const s = o.dist * 0.0016; const az = o.az; const rx = [-Math.sin(az), Math.cos(az), 0], fy = [-Math.cos(az), -Math.sin(az), 0]; o.target = V.add(o.target, V.add(V.scale(rx, -dx * s), V.scale(fy, dy * s))); }
  else { const o = state.mode === 'inspect' ? state.cams.inspect : state.cams.overview; o.az -= dx * 0.006; o.el = clamp(o.el + dy * 0.006, 0.03, 1.55); }
  requestRender(); writeHash(); });
function endPointer(e) { pointers.delete(e.pointerId); if (drag && !drag.pinch && !drag.moved && pointers.size === 0 && e.type === 'pointerup') handleClick(e.clientX, e.clientY, e.button); if (pointers.size === 0) drag = null; }
canvas.addEventListener('pointerup', endPointer); canvas.addEventListener('pointercancel', endPointer); canvas.addEventListener('contextmenu', (e) => e.preventDefault());
function zoomBy(f) { if (state.mode === 'observer') { state.fov = clamp(state.fov * Math.exp(f), 20, 110); $('fov').value = Math.round(state.fov); } else { const o = state.mode === 'inspect' ? state.cams.inspect : state.cams.overview; o.dist = clamp(o.dist * Math.exp(f), state.mode === 'inspect' ? 20 : 30, 30000); } requestRender(); writeHash(); }
canvas.addEventListener('wheel', (e) => { e.preventDefault(); zoomBy(clamp(e.deltaY, -120, 120) * 0.0012); }, { passive: false });
function handleClick(cx, cy, button) { if (!assets.ready || !lastCam || button !== 0) return;
  if (state.mode === 'observer') { setHint('In the observer view, drag to look around and use the wheel to change the field of view. Switch to the city overview to move the site or the observer.'); return; }
  const ray = rayFromClient(cx, cy, lastCam); if (!ray) return; applyPick(pickRay(ray.o, ray.d)); }
function applyPick(hit) {
  if (state.tool === 'boundary') { if (hit.type === 'terrain' || hit.type === 'building') addBoundaryPoint(hit.point[0], hit.point[1]); else setHint('Choose a point over modelled land. Water and missing terrain cannot anchor a study boundary.'); return; }
  if (hit.type === 'none') { setHint('Nothing under the cursor. The placement surface is the active terrain; the outline on the ground marks the model coverage.'); return; }
  if (hit.type === 'water') { setHint('That is the water surface. Sites and observers are placed on the active terrain, not on water.'); return; }
  if (hit.type === 'building') { state.selected = hit.index; state.selectedExt = !!hit.ext; refreshPanels(); if (state.tool !== 'observer') { $('panel').classList.remove('collapsed'); $('btn-panel-toggle').setAttribute('aria-expanded','true'); $('sec-site').open=true; $('btn-replace-building').scrollIntoView({block:'nearest'}); } requestRender();
    setHint(state.tool === 'site' ? 'Building selected. Use its area as a hypothetical replacement site, or click open ground.' : state.tool === 'observer' ? 'That is an existing building. The observer stands on the terrain; click open ground instead.' : 'Building selected. Open the Site panel to use its bounding area as a hypothetical replacement site.'); return; }
  const p = hit.point;
  if (state.tool === 'site') { if (placeSite(p[0], p[1])) setHint(`Site placed at x ${fmt(p[0])}, y ${fmt(p[1])} m (terrain z ${fmt(p[2])} m, model-relative). The proposal is in the Proposal section. Draw a boundary or size a rectangle to measure the land.`); }
  else if (state.tool === 'observer') { if (placeObserver(p[0], p[1], 'exploratory')) setHint(`Exploratory observer placed at x ${fmt(p[0])}, y ${fmt(p[1])} m (terrain z ${fmt(p[2])} m). Use “Look toward proposal”.`); }
  else { state.selected = null; refreshPanels(); requestRender(); setHint(`Terrain at x ${fmt(p[0])}, y ${fmt(p[1])}, z ${fmt(p[2])} m (model-relative, unverified).`); }
}
function placeSite(x, y, keepRemovals = false) { const z = landZAt(x, y); if (z === null) { setHint('That point is water or outside modelled land. The site was not placed.'); return false; } if (!keepRemovals) { state.removed=[]; state.showExisting=false; } state.site = { x, y, z }; state.boundary = []; state.selected = null; state.check.result = null; refreshPanels(); requestRender(); writeHash(); return true; }
function placeObserver(x, y, source) { const g = groundZAt(x, y); if (!g) { setHint('That point has neither terrain nor water in the model; the observer was not placed.'); return false; } state.observer = { x, y, z: g.z, ground: g.source }; state.observerSource = source || 'exploratory'; if (source !== 'origin') state.viewpointObserver = null; if (proposalBox()) aimAtProposal(); refreshPanels(); requestRender(); writeHash(); return true; }
function aimAtProposal() { const eye = observerEye(), tgt = proposalCentre(); if (!eye || !tgt) return false; const d = V.sub(tgt, eye); state.cams.observer.yaw = Math.atan2(d[1], d[0]); state.cams.observer.pitch = Math.atan2(d[2], Math.hypot(d[0], d[1])); return true; }
function lookTowardProposal() { if (!state.observer) { setHint('Place an observer first (Step 3).'); return false; } if (!proposalBox()) { setHint('Define a proposal first (Steps 1–2).'); return false; } aimAtProposal(); setMode('observer'); return true; }
function setMode(mode) {
  if (mode === 'observer' && !state.observer) { setHint('Place an observer first (Step 3: pick a view origin or click the terrain).'); return false; }
  if (mode === 'inspect' && !proposalBox()) { setHint('Define a proposal first (Steps 1–2).'); return false; }
  state.mode = mode; $('inset-frame').classList.toggle('hidden', mode !== 'observer'); floatBtn.classList.toggle('hidden', mode === 'overview');
  for (const m of ['overview', 'observer', 'inspect']) $('mode-' + m).classList.toggle('active', m === mode); $('btn-plan').classList.toggle('active', mode === 'plan'); $('tools').classList.toggle('hidden', mode === 'observer'); $('inspect-shortcuts').classList.toggle('hidden', mode !== 'inspect');
  const cap = $('view-caption');
  if (mode === 'observer') { const e = observerEye(); cap.textContent = `Observer at x ${fmt(e[0])}, y ${fmt(e[1])}, eye z ${fmt(e[2])} m${state.observerSource === 'origin' ? ' · open-data origin of view ' + state.viewpoint : ' · exploratory'}. Drag to look, wheel for field of view. Not an assessment.`; setHint('Observer view: drag to look around; “Look toward proposal” re-aims.'); }
  else if (mode === 'inspect') { cap.textContent = 'Inspect: drag to orbit the proposal, wheel to zoom. Camera only.'; setHint('Orbit around the proposal. The camera moves; the building does not.'); }
  else if (mode === 'plan') { cap.textContent = 'Plan · north up · drag to pan · scroll to zoom · dimensions in model metres.'; }
  else { cap.textContent = 'City: drag to orbit · right-drag or shift-drag to pan · wheel to zoom.'; }
  refreshPanels(); requestRender(); writeHash(); return true;
}
function setTool(t) { if (t !== 'boundary' && state.drawing) { state.drawing = null; refreshStudyUI(); } state.tool = t; for (const k of ['site', 'observer', 'identify', 'boundary']) $('tool-' + k).classList.toggle('active', k === t); if (state.mode === 'observer') setMode('overview');
  setHint(t === 'boundary' ? 'Click the corners of your study area. Finish boundary or press Enter; Esc cancels.' : t === 'site' ? 'Click open ground for a site point, or select a building for a replacement study.' : t === 'observer' ? 'Observer tool: click open terrain (Plan helps). Or pick a view and stand at its origin.' : 'Identify: click a building or the ground.'); }
function setHint(msg) { $('hint').textContent = msg; }
function resetToContext() { let e = assets.manifest ? assets.manifest.extent_m.scene_bbox : [-3000, -2300, 0, 2600, 3900, 0]; if (assets.extension) { const t = assets.extension.target_extent_model_m; e = [t[0], t[1], 0, t[2], t[3], 0]; }
  state.cams.overview = { target: [(e[0] + e[3]) / 2, (e[1] + e[4]) / 2, 20], dist: Math.max(e[3]-e[0],e[4]-e[1])*1.8, az: -1.15, el: 0.85 }; setMode('overview'); }
function planView() { if (state.mode === 'inspect' && state.site) { state.cams.overview.target = [state.site.x, state.site.y, state.site.z]; state.cams.overview.dist = Math.max(220, state.cams.inspect.dist); } setMode('plan'); }
function inspectFrom(az, el) { if (!setMode('inspect')) return; const o = state.cams.inspect; if (az !== null) o.az = az; if (el !== null) o.el = el; requestRender(); writeHash(); }

// ------------------------------------------------------------------ measured site studies (visual hypotheses)
function formatArea(area) { return Math.round(area).toLocaleString() + ' m²'; }
function isRemoved(index, ext) { return state.removed.some(r => r.index === index && r.ext === ext); }
function refreshStudyUI() {
  const pts=state.drawing || state.boundary; const valid = pts.length >= 3 && !SiteGeometry.validate(pts), m = valid ? SiteGeometry.metrics(pts) : null;
  $('site-metrics').innerHTML = m ? `<b>${formatArea(m.area)}</b><b class="metric-sub">${fmt(m.area / 10000, 3)} ha</b><span>${fmt(m.perimeter, 1)} m perimeter · horizontal plan area</span><span>${state.drawing ? "Draft boundary" : "User-defined study boundary"} · not a parcel; may enclose water</span>` : '<b>Start with a place</b><span>Choose ground or a building, then draw or size a study boundary.</span>';
  if (m && !state.drawing && proposalBox()) { const outside = proposalParts().some(p => { const fp=partFootprint(p); return ProposalGeometry.planOverlap(state.boundary,fp).area < Math.abs(SiteGeometry.metrics(fp).area)-0.01; }); if (outside) $('site-metrics').innerHTML += '<span class="site-warning">Proposal extends outside the study boundary.</span>'; }
  $('btn-fit-site').disabled = !state.site; $('btn-focus').disabled = !state.site; $('btn-rectangle').disabled = !state.site;
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
function beginBoundary() { state.drawing = []; setStep(1); $('sec-site').open = true; planView(); setTool('boundary'); revealMap(); refreshPanels(); requestRender(); }
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
  if (!state.site) return false; const w = Number($('site-width').value), d = Number($('site-depth').value);
  if (!Number.isFinite(w) || !Number.isFinite(d) || w < 2 || d < 2 || w > 2000 || d > 2000) { setHint('Enter widths and depths between 2 and 2,000 metres.'); return false; }
  const pts = SiteGeometry.rectangle(state.site.x-w/2,state.site.y-d/2,w,d);
  if (pts.some(q => landZAt(...q) === null)) { setHint('Some corners fall outside modelled terrain. Reduce the size or draw a boundary over land.'); return false; }
  state.boundary = pts; state.check.result = null; refreshPanels(); requestRender(); writeHash(); return true;
}
function replaceSelectedBuilding() {
  if (state.selected === null) return false;
  const index = state.selected, ext = !!state.selectedExt, c = (ext ? assets.extIndex : assets.index).columns, b = c.bbox[index];
  const x = (b[0]+b[3])/2, y = (b[1]+b[4])/2;
  if (!placeSite(x,y,true)) return false;
  if (!isRemoved(index,ext)) state.removed.push({index,ext,id:c.osm_id[index]});
  state.showExisting = false; state.boundary = SiteGeometry.rectangle(b[0],b[1],b[3]-b[0],b[4]-b[1]);
  state.selected = null; setStep(1); $('sec-site').open = true; refreshPanels(); revealMap(); focusSite(); writeHash();
  setHint('Replacement study created. The boundary is the model building’s bounding rectangle, not its legal lot. Use Draw boundary to refine it. Restore buildings reverses this hypothesis.'); return true;
}
function restoreBuildings() { state.removed = []; state.showExisting = false; refreshPanels(); requestRender(); writeHash(); setHint('All context buildings restored. Your study boundary and proposal remain.'); }
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
function selectView(ref) { state.viewpoint = ref || null; $('view-select').value = state.viewpoint || ''; const c = selectedCone(); const row = assets.guideline?.table_1.find(r => r.reference === ref); const info = $('view-info'), btn = $('btn-observer-at-origin');
  if (!ref || !row) { info.textContent = 'Choose a place to look from.'; btn.disabled = true; }
  else { let text = `${row.origin_point} · Looking toward ${row.subject}.`; const ground = c?.origin_inside_model_extent ? groundZAt(...c.origin_model_xy) : null; btn.disabled = !ground;
    if (!c) text += ' View polygon unavailable.'; else if (!ground) text += ' Ground unavailable at this viewpoint.'; else if (ground.source === 'water') text += ' Pier deck is not modelled; eye height is measured from the water.';
    info.textContent = text; }
  refreshPanels(); requestRender(); writeHash(); }
function placeObserverAtOrigin() { const c = selectedCone(); if (!c || !c.origin_inside_model_extent) return false; const ok = placeObserver(...c.origin_model_xy, 'origin'); if (ok) setHint(`Viewing from ${c.name}. Origin follows the mapped polygon; eye elevation is approximate.`); return ok; }
function viewFromHere(ref) { if (ref) selectView(ref); if (placeObserverAtOrigin()) { if (proposalBox()) lookTowardProposal(); else setMode('observer'); revealMap(); } }

// ------------------------------------------------------------------ proposal UI (parts / import)
function renderPartsList() { const list = $('parts-list'); list.innerHTML = '';
  state.parts.forEach((p,i) => { const row = document.createElement('div'); row.className = 'part-row';
    const field = (k,label,min,max,step=1) => `<label>${label}<input aria-label="${label}, block ${i+1}" data-k="${k}" data-i="${i}" type="number" min="${min}" max="${max}" step="${step}" value="${p[k] || 0}"></label>`;
    row.innerHTML = `<label class="part-name">Block name<input data-k="name" data-i="${i}" type="text" value="${esc(p.name)}"></label><button class="x" data-del="${i}" type="button" aria-label="Remove block ${i+1}">×</button>` + field('h','Height (m)',1,400) + field('w','Width (m)',1,300) + field('d','Depth (m)',1,300) + field('rotation','Rotation (°)',-180,180) + field('dx','East offset (m)',-500,500) + field('dy','North offset (m)',-500,500) + `<label class="height-scrubber">Adjust height<input aria-label="Height slider, block ${i+1}" data-k="h" data-i="${i}" type="range" min="1" max="400" step="1" value="${p.h}"></label>`;
    list.appendChild(row); });
  list.querySelectorAll('input').forEach(el => { const update = () => { const i=+el.dataset.i, k=el.dataset.k; if (k === 'name') state.parts[i].name=el.value; else { const v=parseFloat(el.value); if (!Number.isFinite(v)) return; state.parts[i][k]=clamp(v,+el.min,+el.max); list.querySelectorAll(`input[data-i="${i}"][data-k="${k}"]`).forEach(peer => { if(peer!==el) peer.value=state.parts[i][k]; }); } refreshPanels(); requestRender(); writeHash(); }; el.addEventListener('input',update); el.addEventListener('change',update); });
  list.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click',() => { if(state.parts.length<=1) { setHint('Keep at least one block, or import a model.'); return; } state.parts.splice(+b.dataset.del,1); renderPartsList(); refreshPanels(); requestRender(); writeHash(); })); }
function addPart(p) { const last = state.parts[state.parts.length - 1]; state.parts.push(Object.assign({ name: 'Block ' + (state.parts.length + 1), h: 20, w: Math.max(5, (last ? last.w : 30) * 0.7), d: Math.max(5, (last ? last.d : 30) * 0.7), dx: last ? last.dx : 0, dy: last ? last.dy : 0, rotation: last?.rotation || 0 }, p || {})); state.check.result = null; renderPartsList(); refreshPanels(); requestRender(); writeHash(); }
function setProposalMode(m) { state.pmode = m; $('pmode-boxes').classList.toggle('active', m === 'boxes'); $('pmode-import').classList.toggle('active', m === 'import'); $('boxes-ui').classList.toggle('hidden', m !== 'boxes'); $('import-ui').classList.toggle('hidden', m !== 'import'); state.check.result = null; refreshPanels(); requestRender(); writeHash(); }
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
function installImport(name, parts, unitsStatus) { if (!parts.length) { setHint('No faces found in that file.'); return false; }
  const bb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]; for (const p of parts) for (let k = 0; k < 3; k++) { bb[k] = Math.min(bb[k], p.bbox[k]); bb[k + 3] = Math.max(bb[k + 3], p.bbox[k + 3]); }
  for (const p of parts) { const pos = p.positions instanceof Float32Array ? p.positions : new Float32Array(p.positions); const idx = p.indices instanceof Uint32Array ? p.indices : new Uint32Array(p.indices); p.gl = makeMesh(pos, idx); p.triangles = idx.length / 3; delete p.positions; delete p.indices; }
  state.imported = { name, parts, bbox: bb, units_status: unitsStatus, placement: $('import-placement').value, triangles: parts.reduce((s, p) => s + p.triangles, 0) }; state.check.result = null; setProposalMode('import');
  $('import-info').textContent = `${name}: ${parts.length} part(s), ${state.imported.triangles.toLocaleString()} triangles · file bbox ${bb.map((v) => fmt(v, 1)).join(', ')} · ${unitsStatus}\nEach part is checked by its bounding box. Not stored in the URL: re-upload after a reload.`; $('import-info').classList.remove('muted');
  setHint(`Model loaded: ${parts.length} part(s). Placement “${$('import-placement').selectedOptions[0].textContent}”.`); refreshPanels(); requestRender(); return true; }
async function importFile(file) { const name = file.name; setHint('Reading ' + name + '…');
  try { if (/\.obj$/i.test(name)) { const text = await file.text(); const scale = parseFloat($('obj-units').value) || 1; return installImport(name, parseObj(text, scale), `units declared: ${$('obj-units').selectedOptions[0].textContent} (x ${scale})`); }
    if (/\.3dm$/i.test(name)) { const r = await window.ProjectAPI.fetch('/api/import', { method: 'POST', headers: { 'X-Filename': encodeURIComponent(name), 'Content-Type': 'application/octet-stream' }, body: file }); const d = await r.json(); if (!d.ok) { setHint('Import failed: ' + d.error); showError('Import failed: ' + d.error + (d.skipped ? ' — skipped: ' + JSON.stringify(d.skipped).slice(0, 300) : '')); return false; } errorStrip.classList.add('hidden');
      return installImport(name, d.parts, `file units ${d.file_units}; ${d.units_status}`); }
    setHint('Unsupported file type: use .3dm or .obj.'); return false; }
  catch (e) { setHint('Import failed: ' + (e && e.message || e)); return false; } }

// ------------------------------------------------------------------ guideline check
function renderClauseCards() { const g = assets.guideline; const box = $('clause-cards'); if (!g) { box.innerHTML = '<p class="small muted">Guideline text not loaded.</p>'; return; }
  let h = `<div class="card"><div class="ref">${esc(g.source.title)} — ${esc(g.definition.ref)}, p.${g.definition.page}</div><div class="quote source-quote">“${esc(g.definition.quote)}”</div><div class="kind"><b>Teaching note:</b> ${esc(g.definition.teaching_note)}</div></div>`;
  for (const c of g.clauses) h += `<div class="card"><div class="ref">Clause ${esc(c.ref)} (p.${c.page}, under “${esc(c.heading)}”)</div><div class="quote source-quote">“${esc(c.quote)}”${c.quote_continued ? ' “' + esc(c.quote_continued) + '”' : ''}</div><div class="kind"><b>What the tool computes:</b> ${esc(c.what_the_tool_computes)}</div><div class="kind"><b>Left to people or the City:</b> ${esc(c.human_or_city_interpretation)}</div></div>`;
  h += `<div class="card"><div class="ref">Not evaluated</div><div class="kind">${g.out_of_scope.map((s) => esc(s.ref + ' (p.' + s.page + '): ' + s.note)).join(' · ')}</div><div class="kind"><b>Source:</b> ${esc(g.source.publisher)}, ${esc(g.source.title)}, approved ${esc(g.source.approved)}, amended ${esc(g.source.amended)}; local copy ${esc(g.source.local_copy)}, accessed ${esc(g.source.accessed)}. ${esc(g.source.status)}.</div></div>`;
  box.innerHTML = h; }
function partFootprint(p) { const b=p.box; return p.footprint || [[b[0],b[1]],[b[3],b[1]],[b[3],b[4]],[b[0],b[4]]]; }
let planCacheKey='', planCache=[];
function planAnalysis() { if (!assets.cones?.available) return []; const fps=proposalParts().map(partFootprint), key=JSON.stringify(fps); if(key===planCacheKey) return planCache;
  planCacheKey=key; planCache=assets.cones.cones.map(cone=> { const hits=fps.map(fp=>ProposalGeometry.planOverlap(cone.polygon_model_xy,fp)); return {cone,relation:hits.some(h=>h.relation==='overlap')?'overlap':hits.some(h=>h.relation==='touch')?'touch':'none',area:hits.reduce((n,h)=>n+h.area,0)}; }).filter(m=>m.relation!=='none'); return planCache; }
function resultLabel(r) { if (!r) return ''; switch(r.overall_result) {
  case 'INTERSECTS': return `${fmt(r.max_penetration_m)} m above your ceiling`;
  case 'BELOW_BOUNDARY': return `${fmt(r.min_signed_margin_m)} m clearance`;
  case 'BOUNDARY_CONTACT': return 'Touches your ceiling';
  case 'CANNOT_DETERMINE': return 'No ceiling set';
  case 'NO_PLAN_OVERLAP': return 'Outside the test area';
  case 'PLAN_EDGE_CONTACT': return 'Touches the test area edge';
  default: return 'Input could not be evaluated'; } }
function explainCheck(r) { if (!r) return ''; const scope=state.check.area==='custom' ? 'within your test rectangle' : 'over the whole proposal';
  const approx=state.pmode==='import' ? ' Imported parts use bounding boxes, so the numeric comparison can overestimate the actual shape.' : '';
  return `${resultLabel(r)} ${scope}. ${r.overall_result==='INTERSECTS' ? 'Red marks proposal geometry above the ceiling in the test area. ' : ''}This ceiling is your design assumption; City view height limits are not loaded.${approx}`; }
let liveSignature='', liveTimer=null, matchMarkup='';
function syncCeiling() { const P=proposalBox(); if(P && state.check.reference==='height') state.check.bz=P.base+state.check.height; return P; }
function checkBody() { const parts=proposalParts(); return {parts:parts.map(p=>({name:p.name,x_min:p.box[0],x_max:p.box[3],y_min:p.box[1],y_max:p.box[4],z_min:p.box[2],z_max:p.box[5],...(p.footprint?{footprint:p.footprint}: {})})), test_area:evaluationArea(),
  boundary_z:state.check.unknown?null:state.check.bz, hypothesis:{boundary_z_model_m:state.check.unknown?null:state.check.bz,declared_by:'user',reference:state.check.reference,height_above_proposal_base_m:proposalBox()?state.check.bz-proposalBox().base:null,note:'User study ceiling; not a City view height. Model vertical datum unverified.',evaluation_area:state.check.area,viewpoint_context:state.viewpoint}}; }
function refreshLiveStudy() { const P=syncCeiling(), matches=planAnalysis();
  $('btn-study-site').classList.toggle('hidden',!!P);
  $('view-study-summary').textContent = !P ? 'Place a proposal to find the mapped view corridors that meet it.' : !assets.cones?.available ? 'View corridor data unavailable.' : matches.length ? `${matches.length} mapped view corridor${matches.length===1?'':'s'} ${matches.length===1?'meets':'meet'} this proposal in plan.` : 'No mapped view corridor overlaps this proposal in plan.';
  const html=matches.map(m=>`<article class="view-match"><div><b>${esc(m.cone.view_number)} — ${esc(m.cone.name)}</b><span>${m.relation==='touch'?'Touches footprint edge':'Footprint overlap'}${state.pmode==='import'?' · bounding-box estimate':''}</span></div><button class="btn" data-view="${esc(m.cone.view_number)}">View from here</button></article>`).join('');
  if(html!==matchMarkup) { $('view-matches').innerHTML=html; matchMarkup=html; $('view-matches').querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>viewFromHere(b.dataset.view))); }
  $('enable-height-study').checked=!state.check.unknown; $('chk-bz-unknown').checked=state.check.unknown; $('height-controls').classList.toggle('hidden',state.check.unknown);
  const h=state.check.reference==='height'?state.check.height:P?state.check.bz-P.base:state.check.height;
  if(document.activeElement!==$('ceiling-height')) $('ceiling-height').value=Number(h.toFixed(2));
  if(document.activeElement!==$('ceiling-slider')) $('ceiling-slider').value=h;
  if(document.activeElement!==$('check-bz')) $('check-bz').value=state.check.bz;
  $('check-bz').disabled=state.check.unknown;
  $('ceiling-reference').textContent=P ? `Proposal: ${fmt(P.top-P.base)} m tall. ${state.check.reference==='height'?'Ceiling follows the proposal base':'Fixed model elevation — preserved when the site moves'}: z ${fmt(state.check.bz)} m; base z ${fmt(P.base)} m.` : 'Choose a site to establish the proposal base.';
  const scale=Math.max(P?P.top-P.base:120,h,1)*1.12;
  $('height-meter-fill').style.width=(P?clamp((P.top-P.base)/scale*100,0,100):0)+'%'; $('height-meter-line').style.left=clamp(h/scale*100,0,100)+'%';
  $('height-meter').setAttribute('aria-label',P?`Proposal ${fmt(P.top-P.base)} metres, study ceiling ${fmt(h)} metres above base`:'No proposal');
  const signature=JSON.stringify(checkBody());
  if(signature!==liveSignature) { liveSignature=signature; state.check.requestId++; state.check.result=null; state.check.input=null; state.check.busy=false; state.check.error=null; if(liveTimer) clearTimeout(liveTimer); liveTimer=null; }
  if(P && !state.check.unknown && !state.check.result && !state.check.busy && !state.check.error && !liveTimer) liveTimer=setTimeout(()=> {liveTimer=null; runCheck();},180);
  renderCheck();
}
async function runCheck() { syncCeiling(); if(liveTimer) clearTimeout(liveTimer); liveTimer=null;
  const body=checkBody(); if(!body.parts.length || !body.test_area) return null;
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
    $('check-parts').innerHTML='<table class="parts"><tr><th>Part</th><th>Clearance (m)</th><th>Above ceiling (m)</th></tr>'+r.parts.map(p=>`<tr><td>${esc(p.part)}</td><td>${fmt(p.result.signed_margin_m,2)}</td><td>${fmt(p.result.penetration_m,2)}</td></tr>`).join('')+'</table><p class="small muted">Negative clearance means above the ceiling. Contact tolerance: '+r.tolerance_m+' m (calculation setting).</p>';
    $('check-explain').textContent=explainCheck(r); }
  const live=$('live-feedback'); live.classList.toggle('hidden',!P); const matches=planAnalysis();
  live.textContent=P?`${assets.cones?.available ? matches.length+' mapped view corridor'+(matches.length===1?'':'s') : 'View data unavailable'}${state.check.unknown?' · plan only':r?' · '+resultLabel(r)+' · study assumption':state.check.error?' · height comparison unavailable':' · updating height study…'}${state.showExisting && state.removed.length?' · proposal hidden':''}`:'';
  live.classList.toggle('above-ceiling',r?.overall_result==='INTERSECTS');
}

// ------------------------------------------------------------------ steps / panels
const STEP_HINTS = { 1: 'Explore: set the site, shape the proposal and pick a viewpoint in any order. The toolbar above the view switches tools and cameras.', 2: 'View study: corridor overlaps update automatically. Visit a viewpoint, or explore a height assumption with the study ceiling.', 3: 'Report: download the PDF (several views, one template), the JSON, or the current view.' };
function setStep(n) { n = clamp(Math.round(n), 1, 3); state.step = n; if(n===2) $('study-proposal-slot').appendChild($('sec-proposal')); else document.querySelector('.step-body[data-step="1"]').insertBefore($('sec-proposal'),$('sec-view')); document.querySelectorAll('.step-body').forEach((el) => el.classList.toggle('hidden', +el.dataset.step !== n)); document.querySelectorAll('.step-tab').forEach((el) => { el.classList.toggle('active', +el.dataset.step === n); el.classList.toggle('done', stepDone(+el.dataset.step)); });

  if (n === 2) renderCheck(); if (n === 3) renderReport(); setHint(STEP_HINTS[n]); $('btn-back').disabled = n === 1; $('btn-next').disabled = n === 3; refreshPanels(); requestRender(); writeHash(); }
function stepDone(n) { switch (n) { case 1: return !!state.site && !!proposalBox(); case 2: return !!proposalBox() && !!assets.cones?.available; default: return false; } }
function stepStatus() { const n = state.step; const P = proposalBox(); switch (n) { case 1: return [state.site ? 'site set' : 'no site', P ? `${fmt(P.top-P.base, 0)} m tall` : 'no proposal', state.observer ? (state.observerSource === 'origin' ? `observer at origin ${state.viewpoint}` : 'exploratory observer') : 'no observer'].join(' · '); case 2: return proposalBox() ? `${planAnalysis().length} mapped corridor(s) meet this proposal` : 'place a proposal'; default: return 'report'; } }
const HS = { 0: 'measured (OSM height tag)', 1: 'floor count', 2: 'type estimate', 3: 'unknown' };
function refreshPanels() { refreshStudyUI(); const P = proposalBox(); const eye = observerEye();
  $('site-info').textContent = state.site ? `x ${fmt(state.site.x)}, y ${fmt(state.site.y)} m · terrain z ${fmt(state.site.z)} m (model-relative)` : 'No site yet.'; $('site-info').classList.toggle('muted', !state.site);
  $('proposal-info').textContent = P ? `${P.parts.length} part(s) · bounding extent ${fmt(P.box[3] - P.box[0], 0)} × ${fmt(P.box[4] - P.box[1], 0)} m · base z ${fmt(P.base)} · top z ${fmt(P.top)} m (${fmt(P.top - P.base, 0)} m above the terrain at the site)` : (state.site ? 'No proposal geometry yet.' : 'Set the site first; the proposal stands on it.');
  const pill = (id, txt, ok) => { const el = $(id); el.textContent = txt; el.classList.toggle('ok', !!ok); };
  pill('pill-site', state.site ? 'set' : 'not set', !!state.site); pill('pill-proposal', P ? `${P.parts.length} part(s) · ${fmt(P.top-P.base, 0)} m tall` : 'none', !!P); pill('pill-view', state.observer ? (state.observerSource === 'origin' ? `at origin ${state.viewpoint}` : 'exploratory observer') : (state.viewpoint ? `view ${state.viewpoint}` : 'none'), !!state.observer);
  if (eye) { let extra = ''; const tgt = proposalCentre(); if (tgt && P) { const dh = Math.hypot(tgt[0] - eye[0], tgt[1] - eye[1]); const ang = Math.atan2(P.top - eye[2], dh) * 180 / Math.PI; extra = ` · ${fmt(dh, 0)} m to the proposal, its top ${fmt(ang)}° above eye level (exploratory)`; }
    $('obs-info').textContent = `${state.observerSource === 'origin' ? 'Observer at the origin of view ' + state.viewpoint : 'Exploratory observer'}: x ${fmt(eye[0])}, y ${fmt(eye[1])} m · eye z ${fmt(eye[2])} m${state.observer.ground === 'water' ? ' · standing at the water surface (deck not modelled)' : ''}${extra}`; $('obs-info').classList.remove('muted'); }
  else { $('obs-info').textContent = 'No observer. Use the Observer tool to stand anywhere on the terrain.'; $('obs-info').classList.add('muted'); }
  $('mode-observer').disabled = !state.observer; $('mode-inspect').disabled = !P; $('btn-look').disabled = !(state.observer && P); $('btn-run-check').disabled = !P; for (const id of ['cam-n', 'cam-e', 'cam-s', 'cam-w', 'cam-opposite', 'cam-top']) $(id).disabled = !P;
  const bi = $('building-info'); if (state.selected !== null && assets.ready) { const c = (state.selectedExt ? assets.extIndex : assets.index).columns, i = state.selected, b = c.bbox[i]; bi.textContent = `${state.selectedExt ? 'Extension building (current OSM, © OpenStreetMap contributors)' : 'Existing building (supplied model)'} osm_id ${c.osm_id[i]} · ${c.osm_type[i] || '—'} · height_m ${c.height_m[i] === null ? '—' : c.height_m[i]} (${HS[c.height_source[i]]}) · ≈ ${fmt(b[3] - b[0], 0)} × ${fmt(b[4] - b[1], 0)} m · top z ${fmt(b[5])} m. Model bounding dimensions; not a parcel survey.`; bi.classList.remove('hidden'); }
  else bi.classList.add('hidden');
  refreshLiveStudy(); $('step-status').textContent = stepStatus(); document.querySelectorAll('.step-tab').forEach((el) => el.classList.toggle('done', stepDone(+el.dataset.step)));
  $('tech-json').textContent = JSON.stringify(technicalState(), null, 1); if (state.step === 3) renderReport(); }
function technicalState() { const m = assets.manifest; const P = proposalBox(); const c = selectedCone();
  return { schema: 'vancouver-site-study/1', name: state.studyName, resume_hash: serializeHash(), saved_at: new Date().toISOString(), imported_geometry_included: false, label: 'VISUAL EXPLORATION AND TEACHING ONLY — NOT A PROTECTED-VIEW ASSESSMENT', regulatory_applicability: 'NOT ASSESSED', coordinates: assets.unified ? 'model XY metres, Z up; rebuilt SRTM ground, building bases shifted vertically (see context_rebuild)' : 'model metres, Z up, untransformed (see source.display_transform)',
    step: state.step, site: state.site, study_area: state.boundary.length >= 3 ? { boundary_model_xy: state.boundary, ...SiteGeometry.metrics(state.boundary), units: 'metres; horizontal area in square metres', status: 'user-defined study boundary, not a legal parcel; total horizontal study area may include water; vacancy, ownership and redevelopment eligibility unknown' } : null, hypothetical_removals: state.removed.map(r => ({ osm_id: r.id, source: r.ext ? 'extension' : 'supplied' })), existing_comparison_visible: state.showExisting, display_layers: state.layers, visual_style:state.sceneStyle, proposal_mode: state.pmode, blocks: state.pmode === 'boxes' ? state.parts : null, imported: state.imported ? { name: state.imported.name, parts: state.imported.parts.map((p) => ({ name: p.name, bbox: p.bbox, triangles: p.triangles })), units_status: state.imported.units_status, placement: state.imported.placement } : null,
    proposal: P ? { footprint_bbox: P.box, base_z_model_relative: P.base, top_z_model_relative: P.top, parts: P.parts.map(p => ({name:p.name,box:p.box,rotation:state.pmode==='boxes' ? p.rotation || 0 : null,footprint:p.footprint || null})) } : null,
    observer: state.observer ? { source: state.observerSource, ground: state.observer, eye_height_m: state.eyeH, eye: observerEye(), yaw_rad: state.cams.observer.yaw, pitch_rad: state.cams.observer.pitch, fov_deg: state.fov } : null,
    viewpoint: c ? { view_number: c.view_number, name: c.name, description: c.description, origin_model_xy: c.origin_model_xy, origin_latlon: c.origin_latlon, origin_derivation: c.origin_derivation, origin_inside_model_extent: c.origin_inside_model_extent, height_boundary: c.height_boundary, height_boundary_status: c.height_boundary_status, city_page: c.url } : (state.viewpoint || null),
    plan_overlap: {status: assets.cones?.available ? (P ? 'evaluated in plan only' : 'no proposal') : 'data unavailable', approximation: state.pmode === 'import' ? 'part bounding boxes' : 'rotated block footprints', corridors: planAnalysis().map(m=>({view_number:m.cone.view_number,name:m.cone.name,relation:m.relation})), regulatory_applicability:'NOT ASSESSED'},
    study_ceiling: {enabled:!state.check.unknown,reference:state.check.reference,height_above_base_m: P ? state.check.bz-P.base : null,elevation_model_m:state.check.unknown?null:state.check.bz},
    view_cones_source: assets.cones && assets.cones.available ? assets.cones.provenance : null, transformation: assets.geo,
    context_rebuild: assets.unified,
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
  h += `<p><b>Study area:</b> ${t.study_area ? esc(formatArea(t.study_area.area) + ', perimeter ' + fmt(t.study_area.perimeter) + ' m. User-defined horizontal area, not a legal parcel.') : 'Point only; no boundary measured.'} <b>Hypothetical removals:</b> ${t.hypothetical_removals.length} building(s); ${state.showExisting ? 'existing comparison shown' : 'proposed scene shown'}. Vacancy and redevelopment eligibility unknown.</p>`;
  h += `<h3>2 · Proposal</h3>` + (t.proposal ? `<table><tr><th>Part</th><th>x range</th><th>y range</th><th>rotation</th><th>base z</th><th>top z</th></tr>${t.proposal.parts.map((p) => `<tr><td>${esc(p.name)}</td><td>${fmt(p.box[0])}…${fmt(p.box[3])}</td><td>${fmt(p.box[1])}…${fmt(p.box[4])}</td><td>${p.rotation == null ? '—' : fmt(p.rotation, 1) + '°'}</td><td>${fmt(p.box[2])}</td><td>${fmt(p.box[5])}</td></tr>`).join('')}</table><p class="muted">${esc(state.pmode === 'import' ? 'Imported model (' + t.imported.name + '; ' + t.imported.units_status + '; placement: ' + t.imported.placement + '); each part is represented by its bounding box.' : 'Stacked rotated blocks; the lowest sits on the active terrain at the site.')}</p>` : '<p class="muted">No proposal.</p>');
  h += `<h3>3 · Viewpoint</h3>` + (t.viewpoint && t.viewpoint.view_number ? `<table>${row('Protected view', esc(t.viewpoint.view_number + ' — ' + t.viewpoint.name))}${row('Cone source', esc('City open data “view-cones” (plan polygons; ' + (t.view_cones_source ? 'accessed ' + t.view_cones_source.accessed + ', ' + t.view_cones_source.license : '') + '); by-laws authoritative'))}${row('Origin', esc(t.viewpoint.origin_inside_model_extent ? `at x ${fmt(t.viewpoint.origin_model_xy[0])}, y ${fmt(t.viewpoint.origin_model_xy[1])} m (${t.viewpoint.origin_derivation}; within supplied terrain coverage)` : 'outside the model coverage; not moved'))}${row('Height boundary', esc(t.viewpoint.height_boundary_status))}${row('Transformation', esc(t.transformation ? t.transformation.method : '—'))}</table>` : '<p class="muted">No protected view selected.</p>') + (t.observer ? `<p>${esc((t.observer.source === 'origin' ? 'Observer at the open-data origin' : 'Exploratory observer') + ` · eye z ${fmt(t.observer.eye[2])} m (model-relative) · field of view ${t.observer.fov_deg}°`)}</p>` : '<p class="muted">No observer.</p>');
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
  p.set('style',state.sceneStyle); p.set('name', state.studyName); p.set('boundary', state.boundary.map(q => q.map(r).join(',')).join(';')); p.set('removed', state.removed.map(q => (q.ext ? 'e:' : 's:') + q.id).join(',')); p.set('existing', state.showExisting ? '1' : '0'); p.set('layers', Object.entries(state.layers).filter(([,v]) => v).map(([k]) => k).join(','));
  p.set('step', state.step); if (state.site) p.set('site', `${r(state.site.x)},${r(state.site.y)}`); p.set('parts', state.parts.map((q) => [q.h, q.w, q.d, q.dx, q.dy].join(',') + ',' + encodeURIComponent(q.name)).join(';')); p.set('pm', state.pmode); p.set('rot',state.parts.map(q=>q.rotation || 0).join(','));
  if (state.observer) { p.set('obs', `${r(state.observer.x)},${r(state.observer.y)}`); p.set('osrc', state.observerSource); } p.set('eye', state.eyeH); p.set('fov', state.fov); p.set('mode', state.mode); p.set('wedge', state.wedge ? 1 : 0); p.set('allcones', state.showAllCones ? 1 : 0); p.set('bd', state.showBackdrop ? 1 : 0);
  if (state.viewpoint) p.set('view', state.viewpoint); p.set('bz', state.check.unknown ? 'unknown' : state.check.bz); p.set('cref', state.check.reference); p.set('ch', state.check.height); p.set('area', state.check.area); if (state.check.custom) p.set('carea', [state.check.custom.x_min, state.check.custom.x_max, state.check.custom.y_min, state.check.custom.y_max].join(','));
  const o = state.cams.overview; p.set('cam', [o.az, o.el, o.dist, o.target[0], o.target[1], o.target[2]].map(r).join(',')); const i = state.cams.inspect; p.set('icam', [i.az, i.el, i.dist].map(r).join(',')); const l = state.cams.observer; p.set('look', [l.yaw, l.pitch].map(r).join(','));
  return '#' + p.toString(); }
function writeHash() { if (hashTimer) return; hashTimer = setTimeout(() => { hashTimer = null; history.replaceState(null, '', serializeHash()); }, 150); }
function applyHash(hash) { const p = new URLSearchParams((hash || location.hash).replace(/^#/, '')); const num = (k, lo, hi, dflt) => { const v = parseFloat(p.get(k)); return Number.isFinite(v) ? clamp(v, lo, hi) : dflt; };
  setSceneStyle(p.get('style') || (window.ProjectAPI.isStatic ? 'collage' : 'classic'),false);
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
  state.removed = []; for (const token of (p.get('removed') || '').split(',')) { const ext = token.startsWith('e:'), id = token.slice(2), index = (ext ? assets.extIndex : assets.index)?.columns.osm_id.indexOf(id); if (index >= 0 && !isRemoved(index, ext)) state.removed.push({index, ext, id}); }
  state.showExisting = p.get('existing') === '1'; if (p.has('layers')) for (const key of Object.keys(state.layers)) state.layers[key] = p.get('layers').split(',').includes(key);
  const o = pair('obs'); state.observer = null; if (o) { const g = groundZAt(o[0], o[1]); state.observer = g ? { x: o[0], y: o[1], z: g.z, ground: g.source } : null; state.observerSource = p.get('osrc') === 'origin' ? 'origin' : 'exploratory'; }
  if(liveTimer) clearTimeout(liveTimer); liveTimer=null; liveSignature=''; state.check.busy=false; state.check.error=null;
  state.check.result=null; state.check.input=null; state.check.requestId++; state.check.reference=p.get('cref') === 'height' || !p.has('bz') ? 'height' : 'elevation'; state.check.height=num('ch',0,500,120); state.check.unknown=true;
  state.viewpoint = p.get('view') || null; const bz = p.get('bz'); if (bz === 'unknown') state.check.unknown = true; else if (Number.isFinite(parseFloat(bz))) { state.check.bz = parseFloat(bz); state.check.unknown = false; }
  state.check.area = p.get('area') === 'custom' ? 'custom' : 'footprint'; const ca = (p.get('carea') || '').split(',').map(Number); if (ca.length === 4 && ca.every(Number.isFinite)) state.check.custom = { x_min: ca[0], x_max: ca[1], y_min: ca[2], y_max: ca[3] };
  $('eye-h').value = state.eyeH; $('fov').value = state.fov; $('chk-wedge').checked = state.wedge; $('chk-cones').checked = state.showAllCones; $('chk-backdrop').checked = state.showBackdrop; $('check-bz').value = state.check.bz; $('chk-bz-unknown').checked = state.check.unknown; $('check-area').value = state.check.area; $('custom-area').classList.toggle('hidden', state.check.area !== 'custom');
  if (state.check.custom) { $('ca-xmin').value = state.check.custom.x_min; $('ca-xmax').value = state.check.custom.x_max; $('ca-ymin').value = state.check.custom.y_min; $('ca-ymax').value = state.check.custom.y_max; }
  renderPartsList(); setProposalMode(state.pmode); populateViews(); selectView(state.viewpoint);
  if (lk.length !== 2 && state.observer && proposalBox()) aimAtProposal();
  const mode = p.get('mode'); if (!setMode(mode === 'observer' || mode === 'inspect' || mode === 'plan' ? mode : 'overview')) setMode('overview'); const st = num('step', 1, 5, 1); setStep(st >= 4 ? st - 2 : st); // old 5-step links map onto the 3 stages
  // refreshPanels schedules a live calculation for a saved ceiling.
}

// ------------------------------------------------------------------ UI wiring
function bindNumber(id, apply) { const el = $(id); const h = () => { const v = parseFloat(el.value); if (!Number.isFinite(v)) return; const lo = parseFloat(el.min), hi = parseFloat(el.max); const c = (Number.isFinite(lo) && Number.isFinite(hi)) ? clamp(v, lo, hi) : v; if (c !== v) el.value = c; apply(c); refreshPanels(); requestRender(); writeHash(); }; el.addEventListener('input', h); el.addEventListener('change', h); }
bindNumber('eye-h', (v) => { state.eyeH = v; }); bindNumber('fov', (v) => { state.fov = v; }); bindNumber('check-bz', (v) => { state.check.bz = v; state.check.reference='elevation'; });
for (const id of ['ca-xmin', 'ca-xmax', 'ca-ymin', 'ca-ymax']) bindNumber(id, () => { const v = ['ca-xmin', 'ca-xmax', 'ca-ymin', 'ca-ymax'].map((k) => parseFloat($(k).value)); if (v.every(Number.isFinite)) state.check.custom = { x_min: Math.min(v[0], v[1]), x_max: Math.max(v[0], v[1]), y_min: Math.min(v[2], v[3]), y_max: Math.max(v[2], v[3]) }; state.check.result = null; renderCheck(); });
$('enable-height-study').addEventListener('change',e=> { state.check.unknown=!e.target.checked; refreshPanels(); requestRender(); writeHash(); });
for (const id of ['ceiling-height','ceiling-slider']) bindNumber(id,v=> {state.check.reference='height'; state.check.height=v;});
$('btn-study-site').addEventListener('click',()=>{setStep(1); planView(); setTool('site'); revealMap();});
$('chk-bz-unknown').addEventListener('change', (e) => { state.check.unknown = e.target.checked; $('check-bz').disabled = state.check.unknown; state.check.result = null; renderCheck(); refreshPanels(); requestRender(); writeHash(); });
$('check-area').addEventListener('change', (e) => { state.check.area = e.target.value; $('custom-area').classList.toggle('hidden', state.check.area !== 'custom'); if (state.check.area === 'custom' && !state.check.custom) { const a = evaluationArea(); if (a) { state.check.custom = { x_min: Math.floor(a.x_min - 10), x_max: Math.ceil(a.x_max + 10), y_min: Math.floor(a.y_min - 10), y_max: Math.ceil(a.y_max + 10) }; $('ca-xmin').value = state.check.custom.x_min; $('ca-xmax').value = state.check.custom.x_max; $('ca-ymin').value = state.check.custom.y_min; $('ca-ymax').value = state.check.custom.y_max; } } state.check.result = null; refreshPanels(); requestRender(); writeHash(); });
$('btn-run-check').addEventListener('click', () => { runCheck().then((r) => { if (r) setHint(`Check done: ${r.overall_result} (hypothetical). Read the clauses below, then continue to the report.`); }).catch((e) => showError('Check failed: ' + e)); });
$('chk-wedge').addEventListener('change', (e) => { state.wedge = e.target.checked; requestRender(); writeHash(); }); $('chk-cones').addEventListener('change', (e) => { state.showAllCones = e.target.checked; requestRender(); writeHash(); }); $('chk-backdrop').addEventListener('change', (e) => { state.showBackdrop = e.target.checked; requestRender(); writeHash(); });
$('mode-overview').addEventListener('click', () => setMode('overview')); $('mode-observer').addEventListener('click', () => setMode('observer')); $('mode-inspect').addEventListener('click', () => setMode('inspect'));
$('tool-site').addEventListener('click', () => setTool('site')); $('tool-observer').addEventListener('click', () => setTool('observer')); $('tool-identify').addEventListener('click', () => setTool('identify'));
$('btn-look').addEventListener('click', lookTowardProposal);
$('btn-clear-site').addEventListener('click', () => { state.site = null; state.boundary = []; state.drawing = null; state.removed = []; state.showExisting = false; state.check.result = null; setTool('site'); setMode('overview'); });
$('btn-clear-observer').addEventListener('click', () => { state.observer = null; state.observerSource = 'exploratory'; setMode(state.mode === 'inspect' ? 'inspect' : 'overview'); });
$('btn-reset-context').addEventListener('click', resetToContext); $('btn-plan').addEventListener('click', planView);
$('btn-download-pdf').addEventListener('click', () => { $('pdf-status').textContent = 'Rendering views…'; buildPdfReport().then((blob) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'site_explorer_report.pdf'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); $('pdf-status').textContent = `PDF generated: ${lastPdfPages} pages, ${(blob.size / 1024).toFixed(0)} kB. Template: summary · city overview and plan · observer view · two inspection views · hypothetical check with clause excerpts · sources and unverified items.`; }).catch((e) => showError('PDF failed: ' + (e && e.message || e))); });
$('cam-n').addEventListener('click', () => inspectFrom(Math.PI / 2, 0.3)); $('cam-e').addEventListener('click', () => inspectFrom(0, 0.3)); $('cam-s').addEventListener('click', () => inspectFrom(-Math.PI / 2, 0.3)); $('cam-w').addEventListener('click', () => inspectFrom(Math.PI, 0.3));
$('cam-opposite').addEventListener('click', () => { if (!setMode('inspect')) return; state.cams.inspect.az += Math.PI; requestRender(); writeHash(); }); $('cam-top').addEventListener('click', () => inspectFrom(null, 1.55));
$('pmode-boxes').addEventListener('click', () => setProposalMode('boxes')); $('pmode-import').addEventListener('click', () => setProposalMode('import')); $('btn-add-part').addEventListener('click', () => addPart());
$('file-import').addEventListener('change', (e) => { const f = e.target.files && e.target.files[0]; if (f) importFile(f); }); $('import-placement').addEventListener('change', (e) => { if (state.imported) { state.imported.placement = e.target.value; state.check.result = null; refreshPanels(); requestRender(); } });
$('view-select').addEventListener('change', (e) => selectView(e.target.value)); $('btn-observer-at-origin').addEventListener('click', () => viewFromHere());
document.querySelectorAll('.step-tab').forEach((el) => el.addEventListener('click', () => setStep(+el.dataset.step))); $('btn-next').addEventListener('click', () => setStep(state.step + 1)); $('btn-back').addEventListener('click', () => setStep(state.step - 1));
$('btn-download-state').addEventListener('click', () => { const blob = new Blob([JSON.stringify(technicalState(), null, 2)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'site_explorer_report.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); });
$('btn-download-image').addEventListener('click', () => { render(); const a = document.createElement('a'); a.href = canvas.toDataURL('image/png'); a.download = `site_explorer_${state.mode}.png`; a.click(); });
$('btn-panel-toggle').addEventListener('click', () => { const p = $('panel'); p.classList.toggle('collapsed'); $('btn-panel-toggle').setAttribute('aria-expanded', String(!p.classList.contains('collapsed'))); setTimeout(() => { resize(); requestRender(); }, 50); });
window.addEventListener('resize', () => { resize(); requestRender(); });
const floatBtn = document.createElement('button'); floatBtn.className = 'btn hidden'; floatBtn.id = 'btn-overview-float'; floatBtn.textContent = '‹ City overview'; floatBtn.style.cssText = 'position:absolute;right:10px;top:10px;'; $('viewport').appendChild(floatBtn); floatBtn.addEventListener('click', () => setMode('overview'));


$('tool-boundary').addEventListener('click', beginBoundary);
$('btn-draw-site').addEventListener('click', beginBoundary);
$('btn-open-ground').addEventListener('click', () => { planView(); setTool('site'); revealMap(); });
$('btn-find-building').addEventListener('click', () => { planView(); setTool('identify'); revealMap(); setHint('Click an existing building, then choose “Use building area as study site”.'); });
$('btn-finish-boundary').addEventListener('click', finishBoundary); $('btn-finish-map').addEventListener('click', finishBoundary); $('btn-cancel-map').addEventListener('click', cancelBoundary);
$('btn-undo-vertex').addEventListener('click', () => { if (state.drawing) state.drawing.pop(); refreshStudyUI(); requestRender(); });
$('btn-cancel-boundary').addEventListener('click', cancelBoundary);
$('btn-rectangle').addEventListener('click', rectangleSite);
$('btn-replace-building').addEventListener('click', replaceSelectedBuilding);
$('btn-restore-buildings').addEventListener('click', restoreBuildings);
$('chk-existing').addEventListener('change', e => { state.showExisting=e.target.checked; refreshPanels(); requestRender(); writeHash(); });
$('btn-fit-site').addEventListener('click', focusSite); $('btn-focus').addEventListener('click', focusSite);
$('btn-zoom-in').addEventListener('click', () => zoomBy(-0.35)); $('btn-zoom-out').addEventListener('click', () => zoomBy(0.35));
for (const key of Object.keys(state.layers)) $('layer-'+key).addEventListener('change',e=>{ state.layers[key]=e.target.checked; requestRender(); writeHash(); });
window.addEventListener('keydown', e => { if (/INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return; if (state.drawing && e.key==='Enter') { e.preventDefault(); finishBoundary(); } if (state.drawing && e.key==='Escape') { e.preventDefault(); cancelBoundary(); } });
if (matchMedia('(max-width: 860px)').matches) { $('panel').classList.add('collapsed'); $('btn-panel-toggle').setAttribute('aria-expanded','false'); }


function openStudy(data) {
  if (!data || data.schema !== 'vancouver-site-study/1' || typeof data.resume_hash !== 'string' || data.resume_hash.length > 100000) throw new Error('Choose a study JSON saved by this version of the Site Explorer.');
  if (hashTimer) { clearTimeout(hashTimer); hashTimer=null; }
  state.imported=null; state.check.result=null; state.check.custom=null; state.check.bz=120; state.check.unknown=true; state.check.reference='height'; state.check.height=120; state.check.requestId++;
  applyHash(data.resume_hash); history.replaceState(null,'',serializeHash());
  const missing = state.pmode==='import'; $('import-info').textContent=missing ? 'Reopen the original '+(data.imported?.name || '.3dm or .obj')+' file; imported geometry is not included in study JSON.' : 'No model loaded.';
  setHint('Study reopened: '+state.studyName+(assets.unified && !data.context_rebuild ? '. Site and observer elevations recalculated on the rebuilt terrain.' : '.')+(missing ? ' Reopen the original imported model to restore its geometry.' : '')); requestRender(); return true;
}
$('scene-style').addEventListener('change',e=>setSceneStyle(e.target.value));
$('study-name').addEventListener('input',e=>{ state.studyName=e.target.value.slice(0,80); writeHash(); });
$('btn-save-study').addEventListener('click',()=>{ const blob=new Blob([JSON.stringify(technicalState(),null,2)],{type:'application/json'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=(state.studyName.replace(/[^a-z0-9_-]+/gi,'-') || 'site-study')+'.json'; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),1000); setHint('Study JSON saved. Keep it beside your iteration notes; Open study restores its settings. Imported geometry must be reopened separately.'); });
$('btn-open-study').addEventListener('click',()=>$('file-study').click());
$('file-study').addEventListener('change',async e=>{const f=e.target.files[0]; if (!f) return; try { if(f.size>1024*1024) throw new Error('Study JSON must be smaller than 1 MB.'); openStudy(JSON.parse(await f.text())); } catch(err) {setHint('Could not open study: '+err.message);} finally {e.target.value='';} });
$('place-select').addEventListener('change',e=>{ if(e.target.value==='') return; const place=assets.places[+e.target.value]; if(!place) return; state.cams.overview.target=[place.x,place.y,place.z]; state.cams.overview.dist=1800; planView(); setHint('Viewing '+place.text+'. Zoom in, then choose ground, a building, or draw a study boundary.'); });

// ------------------------------------------------------------------ boot
function frame() { if (needsRender) { needsRender = false; try { render(); } catch (e) { showError('Render error: ' + (e && e.message || e)); } } requestAnimationFrame(frame); }
const readyPromise = (async () => { if (!gl || !PM) throw new Error('WebGL2 unavailable');
  try { await loadAssets(); } catch (e) { $('loading').classList.add('hidden'); showError('Could not load the context model: ' + (e && e.message || e)); throw e; }
  const e = assets.manifest.extent_m.scene_bbox; state.cams.overview.target = [(e[0] + e[3]) / 2, (e[1] + e[4]) / 2, 20]; renderClauseCards(); applyHash(); refreshPanels(); requestRender(); render(); return true; })();
requestAnimationFrame(frame);


// ------------------------------------------------------------------ PDF report (fixed template, several views)
let lastPdfPages = 0;
function captureView(setup) { const saved = { mode: state.mode, cams: JSON.parse(JSON.stringify(state.cams)), fov: state.fov }; setup(); needsRender = false; render(); const url = canvas.toDataURL('image/jpeg', 0.86);
  state.mode = saved.mode; state.cams = saved.cams; state.fov = saved.fov; needsRender = false; render(); return url; }
async function buildPdfReport() {
  if (!window.MiniPdf) throw new Error('pdf.js not loaded'); if (!assets.ready) throw new Error('assets not loaded');
  if (!state.check.unknown && proposalBox() && !state.check.result) await runCheck();
  const D = new MiniPdf.Doc(); const t = technicalState(); const P = proposalBox(); const g = assets.guideline; const r = state.check.result; const eye = observerEye(); const sc = selectedCone();
  const W = MiniPdf.PT.w, H = MiniPdf.PT.h, M = 36; const aspect = canvas.width / canvas.height; const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const focus = P ? [P.cx, P.cy, P.base] : state.site ? [state.site.x, state.site.y, state.site.z] : state.cams.overview.target;
  let pageNo = 0; const total = 6;
  const page = (title) => { const p = D.page(); pageNo++; D.rect(p, 0, 0, W, 30, '0.12 0.13 0.15'); D.text(p, M, 20, 'Vancouver View-Protection Lab  |  Site Explorer', 10, true, '1 1 1'); D.text(p, W - M - MiniPdf.textWidth(title, 10), 20, title, 10, true, '1 1 1');
    D.line(p, M, H - 26, W - M, H - 26, '0.85 0.85 0.85', 0.5); D.text(p, M, H - 14, 'Teaching tool - not a protected-view assessment - ' + (state.sceneStyle!=='classic'?SCENE_STYLES[state.sceneStyle].name+' palette - ':'') + 'NOT ASSESSED - ' + stamp, 7.5, false, '0.45 0.45 0.45'); D.text(p, W - M - 40, H - 14, `page ${pageNo} / ${total}`, 7.5, false, '0.45 0.45 0.45'); return p; };
  const img = (p, url, x, y, w, caption) => { const h = w / aspect; D.image(p, url, x, y, w, h); D.rect(p, x, y, w, h, null, '0.75 0.75 0.75'); if (caption) D.paragraph(p, x, y + h + 11, caption, 8, w, { color: '0.3 0.3 0.3' }); return y + h + 24; };
  // 1 summary
  let p = page('1  Summary'); let y = 54; D.text(p, M, y, 'Site explorer report', 18, true); y += 22;
  D.paragraph(p, M, y, `${t.label}. Coordinates are model metres, Z up, from the supplied Rhino model (${t.source ? t.source.filename : '?'}). Building heights are OpenStreetMap-derived and unverified; ${assets.unified ? 'ground elevations are SRTM-derived, not reconciled with the City datum' : 'terrain z is model-relative, not geodetic'}.`, 9, W - 2 * M, { color: '0.25 0.25 0.25' }); y += 34;
  const rows = [['Study area / scenario', (t.study_area ? formatArea(t.study_area.area) + ', perimeter ' + fmt(t.study_area.perimeter) + ' m; user-defined, not a legal parcel.' : 'No measured boundary.') + ' Hypothetical removals: ' + state.removed.length + '; ' + (state.showExisting ? 'existing buildings comparison' : 'proposed scene') + '. Vacancy/eligibility unknown.'], ['Site', state.site ? `x ${fmt(state.site.x)}, y ${fmt(state.site.y)} m - terrain z ${fmt(state.site.z)} m` : 'not set'],
    ['Proposal', P ? `${P.parts.length} part(s) - bounding extent ${fmt(P.box[3] - P.box[0], 0)} x ${fmt(P.box[4] - P.box[1], 0)} m - base z ${fmt(P.base)} - top z ${fmt(P.top)} m (${fmt(P.top - P.base, 0)} m above the terrain at the site)${state.pmode === 'import' && state.imported ? ' - imported ' + state.imported.name : ' - stacked boxes'}` : 'none'],
    ['Protected view', sc ? `${sc.view_number} ${sc.name} - ${sc.description} - cone height unknown` : 'none selected'],
    ['Observer', eye ? `${state.observerSource === 'origin' ? 'at the open-data origin of view ' + state.viewpoint : 'exploratory'} - x ${fmt(eye[0])}, y ${fmt(eye[1])} m - eye z ${fmt(eye[2])} m - field of view ${state.fov} deg` : 'none'],
    ['View study', r ? `${resultLabel(r)} - ${state.check.unknown ? 'no ceiling set' : state.check.reference === 'height' ? fmt(state.check.height, 2) + ' m above proposal base' : fmt(state.check.bz, 2) + ' m model elevation'}` : (state.check.error ? state.check.error : state.check.unknown ? 'no ceiling set' : 'updating') ]];
  y = D.table(p, M, y, ['Item', 'Value'], rows, 9, [110, W - 2 * M - 110]); y += 8;
  D.paragraph(p, M, y, 'Reading order: 2 city overview and plan - 3 observer view - 4 inspection views - 5 live view study and assumptions - 6 sources and unverified items.', 8.5, W - 2 * M, { color: '0.35 0.35 0.35' });
  // 2 overview + plan
  p = page('2  City overview and plan'); const ov = captureView(() => { state.mode = 'overview'; state.cams.overview = { target: focus, dist: 900, az: -0.95, el: 0.45 }; });
  const pl = captureView(() => { state.mode = 'plan'; state.cams.overview = { target: focus, dist: 700, az: -Math.PI / 2, el: 1.55 }; });
  const wOv = Math.min(500, (H-130)*aspect), wPl = Math.min(W-2*M-wOv-14, (H-130)*aspect); img(p, ov, M, 44, wOv, 'City overview around the site: existing buildings muted, proposal orange, observer blue with sight ray, selected view cone purple (plan walls; height unknown).');
  img(p, pl, M + wOv + 14, 44, wPl, 'Plan: north is +Y (up).');
  // 3 observer
  p = page('3  Observer view'); if (eye) { const obs = captureView(() => { state.mode = 'observer'; if (P) aimAtProposal(); }); const wObs = Math.min(W - 2 * M, (H - 120) * aspect);
    img(p, obs, M + (W - 2 * M - wObs) / 2, 44, wObs, `Seen from the ${state.observerSource === 'origin' ? 'open-data origin of view ' + state.viewpoint + ' (polygon apex; by-law authoritative)' : 'exploratory observer'} at eye z ${fmt(eye[2])} m, field of view ${state.fov} deg, aimed at the proposal.${assets.backdrop && state.showBackdrop ? ' Mountains: NASA SRTM via Open Topo Data, approximate backdrop.' : ''} Visibility here is not an assessment.`); }
  else D.paragraph(p, M, 60, 'No observer placed. Pick a protected view and stand at its origin, or place an exploratory observer on the terrain.', 10, W - 2 * M);
  // 4 inspection
  p = page('4  Inspection views'); if (P) { const n = captureView(() => { state.mode = 'inspect'; state.cams.inspect = { az: Math.PI / 2, el: 0.3, dist: Math.max(150, (P.top - P.base) * 2.6) }; }); const s2 = captureView(() => { state.mode = 'inspect'; state.cams.inspect = { az: -Math.PI / 2, el: 0.3, dist: Math.max(150, (P.top - P.base) * 2.6) }; });
    const wIn = Math.min((W - 2 * M - 14) / 2, (H-260)*aspect); let yy = img(p, n, M, 44, wIn, 'From the north (camera only; the building does not move).'); img(p, s2, M + wIn + 14, 44, wIn, 'From the south.');
    D.table(p, M, yy + 6, ['Part', 'x range (m)', 'y range (m)', 'rotation', 'base z', 'top z'], P.parts.map((q) => [q.name, `${fmt(q.box[0])} .. ${fmt(q.box[3])}`, `${fmt(q.box[1])} .. ${fmt(q.box[4])}`, q.rotation == null ? '—' : fmt(q.rotation, 1) + '°', fmt(q.box[2]), fmt(q.box[5])]), 8.5, [135, 165, 165, 55, 75, 75]); }
  else D.paragraph(p, M, 60, 'No proposal defined.', 10, W - 2 * M);
  // 5 check
  p = page('5  View study'); y = 52;
  const corridorMatches = planAnalysis();
  if (r) {
    D.text(p, M, y, resultLabel(r), 15, true, '0.18 0.26 0.22'); y += 20;
    const ceiling = state.check.unknown ? 'No ceiling set' : state.check.reference === 'height'
      ? `${fmt(state.check.height, 2)} m above proposal base`
      : `${fmt(state.check.bz, 2)} m model elevation`;
    y = D.paragraph(p, M, y, `Assumed ceiling: ${ceiling}. Height above ceiling ${fmt(r.max_penetration_m, 2)} m; minimum clearance ${fmt(r.min_signed_margin_m, 2)} m. The geometric comparison covers ${state.check.input ? `x ${fmt(state.check.input.test_area.x_min)}..${fmt(state.check.input.test_area.x_max)}, y ${fmt(state.check.input.test_area.y_min)}..${fmt(state.check.input.test_area.y_max)} m` : 'the proposal footprint'}.`, 9, W - 2 * M) + 5;
    y = D.table(p, M, y, ['Part', 'View study', 'Margin (m)', 'Above ceiling (m)'], r.parts.map((q) => [q.part, resultLabel({ overall_result: q.result.geometric_result, max_penetration_m: q.result.penetration_m, min_signed_margin_m: q.result.signed_margin_m }), fmt(q.result.signed_margin_m, 2), fmt(q.result.penetration_m, 2)]), 8.5, [145, 205, 95, 95]) + 6;
  } else {
    const empty = !P ? 'Add a proposal to see the view study.' : state.check.error ? state.check.error : state.check.unknown ? 'No ceiling set. The loaded City dataset has no cone heights.' : 'Updating the view study…';
    y = D.paragraph(p, M, y, empty, 9.5, W - 2 * M) + 8;
  }
  y = D.paragraph(p, M, y, 'Public-view plan overlap', 11, W - 2 * M, { bold: true }) + 4;
  if (corridorMatches.length) {
    const matchesText = corridorMatches.map((m) => `${m.cone.view_number} ${m.cone.name} (${String(m.relation).replaceAll('_', ' ').toLowerCase()})`).join('; ');
    y = D.paragraph(p, M, y, matchesText, 8.5, W - 2 * M) + 5;
  } else y = D.paragraph(p, M, y, (!P ? 'No proposal to evaluate.' : !assets.cones?.available ? 'City corridor data unavailable.' : 'No mapped corridor overlap.'), 8.5, W - 2 * M) + 5;
  y = D.paragraph(p, M, y, 'Plan overlap is a map comparison only. City cone heights are absent from the loaded dataset; this report contains no City height-limit or policy test.', 8.5, W - 2 * M, { color: '0.25 0.25 0.25' }) + 6;
  if (g) { y = D.paragraph(p, M, y, `Source statements (${g.source.title}, ${g.source.publisher}, approved ${g.source.approved}, amended ${g.source.amended}):`, 9, W - 2 * M, { bold: true }) + 2;
    y = D.paragraph(p, M, y, `s.2 (p.${g.definition.page}): "${g.definition.quote}"`, 8, W - 2 * M, { color: '0.25 0.25 0.25' }) + 3;
    for (const c of [g.clauses[0], g.clauses[4]]) y = D.paragraph(p, M, y, `Clause ${c.ref} (p.${c.page}): "${c.quote}"  -  tool: ${c.what_the_tool_computes}  -  people/City: ${c.human_or_city_interpretation}`, 8, W - 2 * M, { color: '0.25 0.25 0.25' }) + 3; }
  // 6 sources
  p = page('6  Sources and unverified items'); y = 52;
  const src = [['Original reference', t.source ? `${t.source.filename} - sha256 ${t.source.sha256} - ${t.source.model_units} - ${t.source.object_count} objects - source file preserved` : '-'],
    ['Active ground', t.context_rebuild ? 'Rebuilt full-extent SRTM terrain with OSM coastline and inland water. Approximate 60 m grid. Retained building shapes are shifted by the change in ground elevation, preserving elevated parts; original assets preserved.' : 'Original supplied terrain plus context extension.'],
    ['View cones', t.view_cones_source ? `City of Vancouver open data "view-cones" (${t.view_cones_source.records} plan polygons) - accessed ${t.view_cones_source.accessed} - ${t.view_cones_source.license} - by-laws authoritative - no heights in the data` : 'not loaded'],
    ['Model placement', t.transformation ? t.transformation.method : '-'],
    ['Building context', assets.unified ? `${assets.index.count} original and ${assets.extIndex.count} extension buildings. Footprints, heights and IDs retained; elevation adjusted with the ground, preserving elevated parts. OSM-derived heights remain unverified.` : assets.extension ? `outside the supplied model, so all 24 origins have ground: ${assets.extension.counts.buildings} OSM buildings (current data, (c) OpenStreetMap contributors, ODbL; heights by the supplied model's rules) on SRTM terrain; ${assets.extension.caveats.join('; ')}` : 'none'],
    ['Mountain backdrop', assets.backdrop ? assets.backdrop.source.source + ' - accessed ' + assets.backdrop.source.accessed + ' - observer view only, approximate, never checked against' : 'none'],
    ['Guideline text', g ? `${g.source.local_copy} (accessed ${g.source.accessed}); quotes verified against the extracted text layer` : '-']];
  y = D.table(p, M, y, ['Source', 'Detail'], src, 8.5, [120, W - 2 * M - 120]) + 8;
  D.paragraph(p, M, y, 'Unverified: model vertical datum; absolute horizontal accuracy (inherits OpenStreetMap); building heights (OSM tag, floor count or type estimate; 2022 extraction user-reported); cone heights (horizontal lower boundaries) - not published in the open data and never invented; mapped plan overlap is evaluated; vertical policy boundaries and City height limits are not evaluated. Not decided by the tool: whether a real cone applies at the site, any exception in 3.1.2-3.1.5, the 2 m provision in 3.1.5, view shadows (3.3), Exceptional Downtown Sites (3.4).', 8.5, W - 2 * M, { color: '0.25 0.25 0.25' });
  lastPdfPages = pageNo; return D.build();
}

// ------------------------------------------------------------------ public hook (self-test, debugging)
window.__explorer = { setSceneStyle, planAnalysis, refreshLiveStudy, resultLabel, serializeHash, openStudy, landZAt, beginBoundary, addBoundaryPoint, finishBoundary, cancelBoundary, rectangleSite, replaceSelectedBuilding, restoreBuildings, focusSite, planView, applyPick, isRemoved, state, assets, ready: readyPromise, placeSite, placeObserver, placeObserverAtOrigin, lookTowardProposal, setMode, setTool, setStep, aimAtProposal, resetToContext, inspectFrom, selectView, selectedCone, addPart, renderPartsList, setProposalMode, parseObj, installImport, runCheck, evaluationArea,
  terrainZAt, groundZAt, proposalBox, proposalParts, proposalCentre, observerEye, observerForward, pickRay, rayFromClient, applyHash, refreshPanels, technicalState, explainCheck, buildPdfReport, captureView,
  renderOnce: () => { needsRender = false; render(); return lastCam; }, camera: () => lastCam, canvas, gl,
  readPixel: (fx, fy) => { const px = new Uint8Array(4); gl.readPixels(Math.round(fx * (canvas.width - 1)), Math.round(fy * (canvas.height - 1)), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); return Array.from(px); },
  buildingsPositionsChecksum: () => { const p = assets.raw.buildings.pos; let s = 0; for (let i = 0; i < p.length; i += 997) s += p[i]; return s; } };
})();
