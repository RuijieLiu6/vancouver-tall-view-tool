/* Eye-level translation in model metres. Surface and occupancy stay with the scene. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.ObserverNavigation=api;})(typeof globalThis==='undefined'?this:globalThis,function(){
'use strict';
function move({position,yaw,key,distance=1,surfaceAt,canOccupy=()=>true,maxStep=0.4,maxRise=0.8}){
  if(!position||![position.x,position.y,position.z,yaw,distance].every(Number.isFinite)||distance<=0||typeof surfaceAt!=='function')return {position,moved:false,blocked:true};
  const directions={ArrowUp:[1,0],ArrowDown:[-1,0],ArrowLeft:[0,-1],ArrowRight:[0,1]},dir=directions[key];
  if(!dir)return {position,moved:false,blocked:false};
  const dx=(Math.cos(yaw)*dir[0]+Math.sin(yaw)*dir[1])*distance,dy=(Math.sin(yaw)*dir[0]-Math.cos(yaw)*dir[1])*distance;
  const steps=Math.ceil(distance/Math.max(0.05,maxStep));let next={...position},blocked=false;
  for(let i=1;i<=steps;i++){
    const x=position.x+dx*i/steps,y=position.y+dy*i/steps,z=surfaceAt(x,y);
    if(!Number.isFinite(z)||Math.abs(z-next.z)>maxRise||!canOccupy(x,y,z)){blocked=true;break;}
    next={...position,x,y,z};
  }
  return {position:next,moved:next.x!==position.x||next.y!==position.y,blocked};
}
return {move};
});
