/* Optional raw-RGBA surface texture loader, shared by water normals and grass.
 * create(gl, {url, onReady, ImageClass, timeoutMs, unit=4,
 *             neutralRGBA=[128,128,255,255], label='Water normal'})
 * WaterSurface remains the public API; a complete neutral texel is usable immediately.
 */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.WaterSurface=api;
})(typeof globalThis==='undefined'?this:globalThis,function(){
'use strict';
const DEFAULT_URL='explorer/textures/ocean-normal-map-1k.png';

function create(gl,options){
  options=options||{};
  const state={texture:null,ready:null,loaded:false,width:1,height:1,error:null};
  let resolveReady,finished=false,timer=null,image=null;
  state.ready=new Promise(resolve=>{resolveReady=resolve;});
  const unitIndex=Number.isInteger(options.unit)&&options.unit>=0?options.unit:4;
  const unit=gl ? gl.TEXTURE0+unitIndex : null;
  const neutralRGBA=options.neutralRGBA||[128,128,255,255];
  const label=options.label||'Water normal';
  const textureLabel=/texture$/i.test(label)?label:label+' texture';
  // Uploads can occur between draws, so leave both the selected unit and all
  // unpack state exactly as the renderer had them.
  function upload(action){
    const active=gl.getParameter(gl.ACTIVE_TEXTURE);
    const unpack=[gl.UNPACK_FLIP_Y_WEBGL,gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,gl.UNPACK_COLORSPACE_CONVERSION_WEBGL]
      .filter(value=>value!==undefined).map(key=>[key,gl.getParameter(key)]);
    let binding,selected=false;
    try{
      gl.activeTexture(unit);selected=true;
      binding=gl.getParameter(gl.TEXTURE_BINDING_2D);
      gl.bindTexture(gl.TEXTURE_2D,state.texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);
      if(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL!==undefined)gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false);
      if(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL!==undefined)gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL,gl.NONE);
      action();
    }finally{
      for(const [key,value] of unpack)gl.pixelStorei(key,value);
      if(selected)gl.bindTexture(gl.TEXTURE_2D,binding);
      gl.activeTexture(active);
    }
  }
  function neutral(){
    upload(()=>{
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8||gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array(neutralRGBA));
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    });
  }
  function finish(ok,error){
    if(finished)return;
    finished=true;
    if(timer!==null)clearTimeout(timer);
    if(image){image.onload=null;image.onerror=null;}
    state.loaded=ok;
    state.error=error||null;
    resolveReady(ok);
    if(typeof options.onReady==='function'){
      try{options.onReady(ok,state);}catch(_){/* Optional redraw callback cannot break the model. */}
    }
  }
  try{
    if(!gl)throw new Error(textureLabel+' requires WebGL');
    state.texture=gl.createTexture();
    if(!state.texture)throw new Error(textureLabel+' allocation failed');
    neutral();
    const ImageClass=options.ImageClass===undefined?globalThis.Image:options.ImageClass;
    if(typeof ImageClass!=='function')throw new Error(textureLabel+' image loading is unavailable');
    image=new ImageClass();
    image.onload=function(){
      if(finished)return;
      try{
        const width=image.naturalWidth||image.width,height=image.naturalHeight||image.height;
        if(!(width>0&&height>0))throw new Error(textureLabel+' has no pixels');
        upload(()=>{
          // Preserve raw channels for normal data and display-space albedo shaders.
          gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8||gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);
          gl.generateMipmap(gl.TEXTURE_2D);
          gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);
          const ext=gl.getExtension('EXT_texture_filter_anisotropic')||gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic');
          if(ext){
            const maximum=gl.getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT);
            if(Number.isFinite(maximum)&&maximum>=1)gl.texParameterf(gl.TEXTURE_2D,ext.TEXTURE_MAX_ANISOTROPY_EXT,Math.min(8,maximum));
          }
        });
        state.width=width;state.height=height;
        finish(true);
      }catch(error){
        try{neutral();}catch(_){/* Keep the failure isolated from rendering. */}
        finish(false,error);
      }
    };
    image.onerror=function(){finish(false,new Error(textureLabel+' could not be loaded'));};
    const timeout=Number.isFinite(options.timeoutMs)&&options.timeoutMs>=0?options.timeoutMs:10000;
    timer=setTimeout(()=>finish(false,new Error(textureLabel+' load timed out')),timeout);
    image.src=options.url||DEFAULT_URL;
  }catch(error){finish(false,error);}
  return state;
}
return {create};
});
