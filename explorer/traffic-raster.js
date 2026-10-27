/* Ground-road masks painted directly onto the model's terrain surface.
 * R = estimated carriageway, B = estimated sidewalk, G = lane marking.
 * All dimensions and dash phases use model metres. Bridge decks stay in 3D.
 */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.TrafficRaster=api;})(typeof globalThis==='undefined'?this:globalThis,function(){
'use strict';
const MARKING_WIDTH=0.16,DASH_LENGTH=3,DASH_PERIOD=18;
const clamp=(v,fallback,lo,hi)=>Number.isFinite(v)?Math.max(lo,Math.min(hi,v)):fallback;
function mapping(bounds,width,height){
  if(!bounds||bounds.length!==4||!Array.from(bounds).every(Number.isFinite)||bounds[2]<=bounds[0]||bounds[3]<=bounds[1]||!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)return null;
  const sx=width/(bounds[2]-bounds[0]),sy=height/(bounds[3]-bounds[1]);
  return {bounds:Array.from(bounds),width,height,scale:[sx,-sy],offset:[-bounds[0]*sx,bounds[3]*sy]};
}
function worldToCanvas(point,bounds,width,height){
  const m=mapping(bounds,width,height);if(!m||!point||!Number.isFinite(point[0])||!Number.isFinite(point[1]))return null;
  return [point[0]*m.scale[0]+m.offset[0],point[1]*m.scale[1]+m.offset[1]];
}
function stroke(ctx,s,width,offset=0){
  const nx=-(s.by-s.ay)/s.length,ny=(s.bx-s.ax)/s.length;
  ctx.lineWidth=width;ctx.beginPath();ctx.moveTo(s.ax+nx*offset,s.ay+ny*offset);ctx.lineTo(s.bx+nx*offset,s.by+ny*offset);ctx.stroke();
}
function draw(ctx,traffic,options){
  const o=options||{},width=o.width??ctx?.canvas?.width,height=o.height??ctx?.canvas?.height,m=mapping(o.bounds,width,height),detail=o.detail===true,sidewalkWidth=clamp(o.sidewalkWidth,2.4,0,12);
  const stats={illustrative:true,inputSegments:0,groundSegments:0,roadSegments:0,sidewalkSegments:0,markingSegments:0,excludedDeck:0,excludedNonvehicular:0,invalidSegments:0,outsideBounds:0,detail,sidewalkWidth};
  if(!ctx||!m)return {stats,mapping:m};
  const roads=traffic?.roads||[],datasets=typeof roads[0]==='number'||ArrayBuffer.isView(roads)?[roads]:roads,segments=[];
  for(const positions of datasets){if(!positions||typeof positions.length!=='number')continue;
    for(let i=0;i+5<positions.length;i+=6){
      stats.inputSegments++;const ax=positions[i],ay=positions[i+1],bx=positions[i+3],by=positions[i+4],length=Math.hypot(bx-ax,by-ay);
      if(![ax,ay,bx,by,length].every(Number.isFinite)||length<0.01){stats.invalidSegments++;continue;}
      const meta=typeof traffic.segmentOptions==='function'?(traffic.segmentOptions(ax,ay,bx,by)||{}):{};
      if(meta.deck===true){stats.excludedDeck++;continue;}
      if(meta.skip===true||meta.vehicular===false){stats.excludedNonvehicular++;continue;}
      const roadWidth=clamp(meta.roadWidth,8,1,40),left=meta.leftSidewalk!==false,right=meta.rightSidewalk!==false,pad=roadWidth/2+(detail&&(left||right)?sidewalkWidth:0);
      if(Math.max(ax,bx)+pad<m.bounds[0]||Math.min(ax,bx)-pad>m.bounds[2]||Math.max(ay,by)+pad<m.bounds[1]||Math.min(ay,by)-pad>m.bounds[3]){stats.outsideBounds++;continue;}
      stats.groundSegments++;segments.push({ax,ay,bx,by,length,roadWidth,left,right,highway:meta.highway});
    }
  }
  ctx.save();
  try{
    /* Reset state inherited from another canvas operation; channel values must
     * stay independent of the caller's opacity, composition mode or dash style.
     */
    ctx.setTransform(1,0,0,1,0,0);ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';ctx.fillStyle='#000';ctx.fillRect(0,0,width,height);
    ctx.setTransform(m.scale[0],0,0,m.scale[1],m.offset[0],m.offset[1]);ctx.lineCap='round';ctx.lineJoin='round';ctx.setLineDash([]);ctx.lineDashOffset=0;
    if(detail&&sidewalkWidth>0){
      ctx.strokeStyle='#00f';
      for(const s of segments){const left=s.left?sidewalkWidth:0,right=s.right?sidewalkWidth:0;if(!left&&!right)continue;
        stroke(ctx,s,s.roadWidth+left+right,(left-right)/2);stats.sidewalkSegments++;
      }
    }
    /* Paint all carriageways after every sidewalk, so intersecting roads always
     * cut through the pavement underlay rather than receiving blue crossbars.
     */
    ctx.strokeStyle='#f00';
    for(const s of segments){stroke(ctx,s,s.roadWidth);stats.roadSegments++;}
    if(detail){
      ctx.strokeStyle='#0f0';ctx.lineCap='butt';ctx.setLineDash([DASH_LENGTH,DASH_PERIOD-DASH_LENGTH]);
      for(const s of segments){if(s.roadWidth<6.2||s.highway==='service')continue;
        const reverse=s.bx<s.ax||(s.bx===s.ax&&s.by<s.ay),line=reverse?{...s,ax:s.bx,ay:s.by,bx:s.ax,by:s.ay}:s,ux=(line.bx-line.ax)/s.length,uy=(line.by-line.ay)/s.length,start=line.ax*ux+line.ay*uy;
        ctx.lineDashOffset=((start%DASH_PERIOD)+DASH_PERIOD)%DASH_PERIOD;stroke(ctx,line,MARKING_WIDTH);stats.markingSegments++;
      }
    }
  }finally{ctx.restore();}
  return {stats,mapping:m};
}
return {draw,mapping,worldToCanvas};
});
