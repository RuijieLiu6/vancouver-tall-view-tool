/* Immutable parcel meshes; edits update one RGBA32F texel, never city geometry. */
(function(root){
'use strict';
function buildGeometry(a){
  const n=a.parcelOffsets.length-1, vertexCount=a.positions.length/2;
  if(!a.roofIndices)throw Error('Precomputed parcel roof triangles are required');
  const ids=new Float32Array(vertexCount);
  let edges=0;
  for(let r=0;r<a.ringOffsets.length-1;r++)edges+=Math.max(0,a.ringOffsets[r+1]-a.ringOffsets[r]);
  const walls=new Float32Array(edges*6);let k=0;
  for(let p=0;p<n;p++)for(let q=a.parcelOffsets[p];q<a.parcelOffsets[p+1];q++)for(let r=a.polygonOffsets[q];r<a.polygonOffsets[q+1];r++){
    const start=a.ringOffsets[r],end=a.ringOffsets[r+1];
    for(let i=start;i<end;i++){
      ids[i]=p;const j=i+1===end?start:i+1;
      const ax=a.positions[i*2],ay=a.positions[i*2+1],bx=a.positions[j*2],by=a.positions[j*2+1];
      if(ax===bx&&ay===by)continue;
      walls.set([ax,ay,bx,by,p,.73+.15*Math.abs(bx-ax)/(Math.hypot(bx-ax,by-ay)||1)],k);k+=6;
    }
  }
  return {ids,walls:walls.subarray(0,k),edgeCount:k/6,parcelCount:n};
}
function heightRecord(height,viewUnknown){return [Number.isFinite(height)?Math.max(0,height):0,Number.isFinite(height)?1:0,viewUnknown?1:0,-1];}
function assumedHeight(state){return state.scenario==='study'&&state.assumeUnknown===true&&Number.isFinite(state.assumedHeightM)&&state.assumedHeightM>=0&&state.assumedHeightM<=2000?state.assumedHeightM:-1;}
function viewRecord(value){return Number.isFinite(value)?[value,1]:value===-Infinity?[0,-1]:[0,0];}
function viewGround(state){return Number.isFinite(state.viewGroundM)?state.viewGroundM:20;}
function effectiveHeight(data,state,viewPair=[0,0]){let baseline;const assumed=assumedHeight(state);if(state.scenario==='study'&&data[3]>=0)baseline=data[3];else if(data[1]<.5&&assumed>=0)baseline=assumed;else baseline=data[1]>.5&&(state.scenario!=='views'||data[2]<.5)?data[0]:0;if(state.scenario==='study'&&state.applyViewStudy===true){if(viewPair[1]<0)return 0;if(viewPair[1]>0)return Math.max(0,Math.min(baseline,viewPair[0]-viewGround(state)));}return baseline;}
function camera(state={}){const raw=Number.isFinite(state.azimuth)?state.azimuth:Math.PI/4;const azimuth=((raw%(2*Math.PI))+2*Math.PI)%(2*Math.PI);const elevation=Math.min(80*Math.PI/180,Math.max(15*Math.PI/180,Number.isFinite(state.elevation)?state.elevation:Math.asin(1/Math.sqrt(3))));return {azimuth,elevation,cosA:Math.cos(azimuth),sinA:Math.sin(azimuth),sinE:Math.sin(elevation),cosE:Math.cos(elevation)};}
function projectPoint(xy,z,state={}){if(state.mode!=='iso')return [xy[0],xy[1]];const c=camera(state);return [c.cosA*xy[0]-c.sinA*xy[1],c.sinE*(c.sinA*xy[0]+c.cosA*xy[1])+c.cosE*z];}
function unprojectDelta(dx,dy,state={}){if(state.mode!=='iso')return [dx,dy];const c=camera(state),v=dy/c.sinE;return [c.cosA*dx+c.sinA*v,-c.sinA*dx+c.cosA*v];}
function depthOf(xy,z,state={}){if(state.mode!=='iso')return 0;const c=camera(state);return (c.cosE*(c.sinA*xy[0]+c.cosA*xy[1])-c.sinE*z)/100000;}
function heightOffset(h,state={}){if(state.mode!=='iso')return [0,0];const c=camera(state),offset=c.cosE/c.sinE*h;return [-c.sinA*offset,-c.cosA*offset];}
const common=`
precision highp float;
uniform sampler2D uHeights,uViewCeilings;
uniform int uTextureWidth;
uniform vec2 uCenter,uViewport;
uniform vec4 uCamera;
uniform float uScale,uAssumedHeight,uViewGround;
uniform bool uIso,uViews,uStudy,uApplyViewStudy;
uniform int uSelected;
flat out vec4 vData;
flat out float vSelected,vViewReduced;
out float vShade;
vec4 record(float id){int i=int(id);return texelFetch(uHeights,ivec2(i%uTextureWidth,i/uTextureWidth),0);}
float baselineHeight(vec4 d){if(uStudy&&d.w>=0.0)return d.w;if(uStudy&&d.y<.5&&uAssumedHeight>=0.0)return uAssumedHeight;return d.y>0.5&&(!uViews||d.z<0.5)?d.x:0.0;}
vec2 viewRecordOf(float id){int i=int(id);return texelFetch(uViewCeilings,ivec2(i%uTextureWidth,i/uTextureWidth),0).rg;}
float heightOf(vec4 d,float id){float h=baselineHeight(d);if(uStudy&&uApplyViewStudy){vec2 v=viewRecordOf(id);if(v.y<0.0)return 0.0;if(v.y>0.0)return max(0.0,min(h,v.x-uViewGround));}return h;}
void project(vec2 xy,float z,float id,vec4 d,float shade){
 vec2 p=xy-uCenter;
 float u=uCamera.x*p.x-uCamera.y*p.y;
 float v=uCamera.y*p.x+uCamera.x*p.y;
 vec2 screen=uIso?vec2(u,uCamera.z*v+uCamera.w*z):p;
 float depth=uIso?(uCamera.w*v-uCamera.z*z)/100000.0:0.0;
 gl_Position=vec4(screen*uScale*2.0/uViewport,depth,1.0);
 vViewReduced=heightOf(d,id)<baselineHeight(d)?1.0:0.0;
 vData=d;vSelected=int(id)==uSelected?1.0:0.0;vShade=shade;
}`;
const roofVS=`#version 300 es
${common}
layout(location=0) in vec2 aPosition;
layout(location=1) in float aParcel;
void main(){vec4 d=record(aParcel);project(aPosition,uIso?heightOf(d,aParcel):0.0,aParcel,d,1.0);}`;
const wallVS=`#version 300 es
${common}
layout(location=0) in vec4 aEdge;
layout(location=1) in vec2 aInfo;
void main(){int v=gl_VertexID;bool right=v==1||v==2||v==4;bool top=v==2||v==4||v==5;
vec4 d=record(aInfo.x);project(right?aEdge.zw:aEdge.xy,top?heightOf(d,aInfo.x):0.0,aInfo.x,d,aInfo.y);}`;
const fragment=`#version 300 es
precision highp float;
flat in vec4 vData;
flat in float vSelected,vViewReduced;
in float vShade;
uniform bool uViews,uStudy;
uniform float uAssumedHeight;
out vec4 outColor;
void main(){
 vec3 c=vec3(.745,.812,.816);float h=vData.x;
 if(h>12.0)c=vec3(.569,.702,.698);if(h>20.0)c=vec3(.388,.592,.576);
 if(h>35.0)c=vec3(.259,.490,.482);if(h>55.0)c=vec3(.161,.380,.373);if(h>90.0)c=vec3(.090,.286,.278);
 if(vData.y<.5)c=vec3(.80,.79,.76);
 if(uViews&&vData.z>.5)c=vec3(.73,.55,.37);
 if(uStudy&&vData.y<.5&&uAssumedHeight>=0.0)c=vec3(.56,.48,.67);
 if(uStudy&&vData.w>=0.0)c=vec3(.90,.57,.29);
 if(vViewReduced>.5)c=vec3(.71,.36,.30);
 if(vSelected>.5)c=vec3(.91,.38,.18);
 outColor=vec4(c*vShade,1.0);
}`;
function create(canvas,packed,options={}){
 const a=packed.arrays||packed,geometry=buildGeometry(a);
 const gl=canvas.getContext('webgl2',{alpha:false,antialias:true,preserveDrawingBuffer:false});
 if(!gl)throw Error('WebGL2 is unavailable');
 let destroyed=false,lost=false,width=1,height=1,drawMs=0,drawCalls=0,heightUploads=0,textureUploads=2,viewTextureUploads=1,coverageUploads=0;
 const buffers=[],vaos=[],programs=[],shaders=[];
 const max=gl.getParameter(gl.MAX_TEXTURE_SIZE),tw=Math.min(1024,max),th=Math.max(1,Math.ceil(geometry.parcelCount/tw));
 if(th>max)throw Error('Parcel height texture exceeds GPU capacity');
 const texels=new Float32Array(tw*th*4);
 for(let i=0;i<geometry.parcelCount;i++)texels.set(heightRecord(a.zoningHeights[i],a.viewUnknown[i]),i*4);
 const viewTexels=new Float32Array(tw*th*2);
 if(options.viewCeilings&&options.viewCeilings.length!==geometry.parcelCount)throw Error('View ceiling count must match parcels');
 for(let i=0;i<geometry.parcelCount;i++)viewTexels.set(viewRecord(options.viewCeilings?.[i]),i*2);
 const texture=gl.createTexture(),viewTexture=gl.createTexture();
 function alive(){if(destroyed||lost||gl.isContextLost())throw Error('Imagine GPU context unavailable');}
 function shader(type,source){const s=gl.createShader(type);shaders.push(s);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;}
 function program(vs){const p=gl.createProgram();programs.push(p);gl.attachShader(p,shader(gl.VERTEX_SHADER,vs));gl.attachShader(p,shader(gl.FRAGMENT_SHADER,fragment));gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));const uniforms={};for(const name of ['uHeights','uViewCeilings','uApplyViewStudy','uViewGround','uTextureWidth','uCenter','uCamera','uViewport','uScale','uAssumedHeight','uIso','uViews','uStudy','uSelected'])uniforms[name]=gl.getUniformLocation(p,name);return {p,uniforms};}
 function buffer(target,data){const b=gl.createBuffer();buffers.push(b);gl.bindBuffer(target,b);gl.bufferData(target,data,gl.STATIC_DRAW);}
 function vao(){const v=gl.createVertexArray();vaos.push(v);gl.bindVertexArray(v);return v;}
 function dispose(){for(const b of buffers)gl.deleteBuffer(b);for(const v of vaos)gl.deleteVertexArray(v);for(const p of programs)gl.deleteProgram(p);for(const s of shaders)gl.deleteShader(s);gl.deleteTexture(texture);gl.deleteTexture(viewTexture);}
 let roofs,walls,roofArray,wallArray;
 try{
 roofs=program(roofVS);walls=program(wallVS);
 roofArray=vao();buffer(gl.ARRAY_BUFFER,a.positions);gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
 buffer(gl.ARRAY_BUFFER,geometry.ids);gl.enableVertexAttribArray(1);gl.vertexAttribPointer(1,1,gl.FLOAT,false,0,0);buffer(gl.ELEMENT_ARRAY_BUFFER,a.roofIndices);
 wallArray=vao();buffer(gl.ARRAY_BUFFER,geometry.walls);gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,4,gl.FLOAT,false,24,0);gl.vertexAttribDivisor(0,1);gl.enableVertexAttribArray(1);gl.vertexAttribPointer(1,2,gl.FLOAT,false,24,16);gl.vertexAttribDivisor(1,1);
 gl.bindVertexArray(null);gl.bindTexture(gl.TEXTURE_2D,texture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA32F,tw,th,0,gl.RGBA,gl.FLOAT,texels);
 gl.bindTexture(gl.TEXTURE_2D,viewTexture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.texImage2D(gl.TEXTURE_2D,0,gl.RG32F,tw,th,0,gl.RG,gl.FLOAT,viewTexels);
 }catch(e){dispose();throw e;}
 function onLost(event){event.preventDefault();lost=true;}
 canvas.addEventListener('webglcontextlost',onLost);
 function bind(pass,state){gl.useProgram(pass.p);const u=pass.uniforms;const c=camera(state);gl.uniform4f(u.uCamera,c.cosA,c.sinA,c.sinE,c.cosE);gl.uniform1i(u.uHeights,0);gl.uniform1i(u.uViewCeilings,1);gl.uniform1i(u.uApplyViewStudy,state.scenario==='study'&&state.applyViewStudy===true);gl.uniform1f(u.uViewGround,viewGround(state));gl.uniform1i(u.uTextureWidth,tw);gl.uniform2f(u.uCenter,state.center[0],state.center[1]);gl.uniform2f(u.uViewport,width,height);gl.uniform1f(u.uScale,state.scale);gl.uniform1f(u.uAssumedHeight,assumedHeight(state));gl.uniform1i(u.uIso,state.mode==='iso');gl.uniform1i(u.uViews,state.scenario==='views');gl.uniform1i(u.uStudy,state.scenario==='study');gl.uniform1i(u.uSelected,Number.isInteger(state.selected)?state.selected:-1);}
 return {
 resize(w,h,dpr=1){alive();width=Math.max(1,w);height=Math.max(1,h);canvas.width=Math.max(1,Math.round(width*dpr));canvas.height=Math.max(1,Math.round(height*dpr));gl.viewport(0,0,canvas.width,canvas.height);},
 draw(state){alive();const started=performance.now();gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,texture);gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,viewTexture);gl.activeTexture(gl.TEXTURE0);gl.clearColor(.95,.95,.92,1);gl.clearDepth(1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.disable(gl.BLEND);gl.disable(gl.CULL_FACE);gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);drawCalls=0;
 if(state.mode==='iso'){bind(walls,state);gl.bindVertexArray(wallArray);gl.drawArraysInstanced(gl.TRIANGLES,0,6,geometry.edgeCount);drawCalls++;}
 bind(roofs,state);gl.bindVertexArray(roofArray);gl.drawElements(gl.TRIANGLES,a.roofIndices.length,gl.UNSIGNED_INT,0);drawCalls++;gl.bindVertexArray(null);drawMs=performance.now()-started;
 },
 setHeight(index,heightM){alive();if(!Number.isInteger(index)||index<0||index>=geometry.parcelCount)throw RangeError('Invalid parcel index');if(heightM!==null&&(!Number.isFinite(heightM)||heightM<0))throw RangeError('Height must be a nonnegative finite number or null');const offset=index*4;texels[offset+3]=heightM===null?-1:heightM;gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,texture);gl.texSubImage2D(gl.TEXTURE_2D,0,index%tw,Math.floor(index/tw),1,1,gl.RGBA,gl.FLOAT,texels.subarray(offset,offset+4));heightUploads++;},
 setViewCeilings(ceilings,viewUnknown){alive();if(!ceilings||ceilings.length!==geometry.parcelCount)throw RangeError('View ceiling count must match parcels');if(viewUnknown&&viewUnknown.length!==geometry.parcelCount)throw RangeError('View coverage count must match parcels');for(let i=0;i<geometry.parcelCount;i++){viewTexels.set(viewRecord(ceilings[i]),i*2);if(viewUnknown)texels[i*4+2]=viewUnknown[i]?1:0;}gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,viewTexture);gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,tw,th,gl.RG,gl.FLOAT,viewTexels);textureUploads++;viewTextureUploads++;gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,texture);gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,tw,th,gl.RGBA,gl.FLOAT,texels);textureUploads++;coverageUploads++;gl.activeTexture(gl.TEXTURE0);},
 getInfo(){return {backend:'webgl2',parcelCount:geometry.parcelCount,vertices:a.positions.length/2,roofTriangles:a.roofIndices.length/3,wallEdges:geometry.edgeCount,gpuBytes:a.positions.byteLength+geometry.ids.byteLength+a.roofIndices.byteLength+geometry.walls.byteLength+texels.byteLength+viewTexels.byteLength,textureUploads,viewTextureUploads,coverageUploads,geometryUploads:4,heightUploads,drawCalls,drawMs,drawTiming:'CPU submission; GPU execution is asynchronous',contextLost:lost};},
 destroy(){if(destroyed)return;destroyed=true;canvas.removeEventListener('webglcontextlost',onLost);dispose();}
 };
}
const api={create,buildGeometry,heightRecord,viewRecord,viewGround,effectiveHeight,assumedHeight,camera,projectPoint,unprojectDelta,depthOf,heightOffset};if(typeof module==='object'&&module.exports)module.exports=api;root.ImagineRenderer=api;
})(typeof window==='object'?window:globalThis);
