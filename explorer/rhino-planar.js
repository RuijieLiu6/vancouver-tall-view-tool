/* Exact polygonal planar-face fallback for Rhino's saved BRep topology.
 * Curved faces/edges are deliberately not sampled or replaced by bounding boxes.
 * Earcut 2.2.4, unmodified UMD distribution from
 * https://unpkg.com/earcut@2.2.4/dist/earcut.min.js
 * ISC License
 *
 * Copyright (c) 2016, Mapbox
 *
 * Permission to use, copy, modify, and/or distribute this software for any purpose
 * with or without fee is hereby granted, provided that the above copyright notice
 * and this permission notice appear in all copies.
 *
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
 * REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND
 * FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
 * INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS
 * OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER
 * TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF
 * THIS SOFTWARE.
 */
(function (scope) {
  'use strict';
  // Keep the vendored UMD export private in browsers and CommonJS alike.
  const earcut = (() => { const module = { exports: {} }, exports = module.exports;
!function(e){"object"==typeof exports&&"undefined"!=typeof module?module.exports=e():"function"==typeof define&&define.amd?define([],e):("undefined"!=typeof window?window:"undefined"!=typeof global?global:"undefined"!=typeof self?self:this).earcut=e()}(function(){return function r(x,i,u){function f(n,e){if(!i[n]){if(!x[n]){var t="function"==typeof require&&require;if(!e&&t)return t(n,!0);if(o)return o(n,!0);throw(e=new Error("Cannot find module '"+n+"'")).code="MODULE_NOT_FOUND",e}t=i[n]={exports:{}},x[n][0].call(t.exports,function(e){return f(x[n][1][e]||e)},t,t.exports,r,x,i,u)}return i[n].exports}for(var o="function"==typeof require&&require,e=0;e<u.length;e++)f(u[e]);return f}({1:[function(e,n,t){"use strict";function r(e,n,t){t=t||2;var r,x,i,u,f,o=n&&n.length,v=o?n[0]*t:e.length,p=s(e,0,v,t,!0),y=[];if(p&&p.next!==p.prev){if(o&&(p=function(e,n,t,r){var x,i,u,f,o=[];for(x=0,i=n.length;x<i;x++)f=n[x]*r,u=x<i-1?n[x+1]*r:e.length,(f=s(e,f,u,r,!1))===f.next&&(f.steiner=!0),o.push(function(e){var n=e,t=e;for(;(n.x<t.x||n.x===t.x&&n.y<t.y)&&(t=n),n=n.next,n!==e;);return t}(f));for(o.sort(c),x=0;x<o.length;x++)t=function(e,n){var t=function(e,n){var t,r=n,x=e.x,i=e.y,u=-1/0;do{if(i<=r.y&&i>=r.next.y&&r.next.y!==r.y){var f=r.x+(i-r.y)*(r.next.x-r.x)/(r.next.y-r.y);if(f<=x&&u<f&&(u=f,t=r.x<r.next.x?r:r.next,f===x))return t}}while(r=r.next,r!==n);if(!t)return null;var o,v=t,p=t.x,y=t.y,a=1/0;r=t;for(;x>=r.x&&r.x>=p&&x!==r.x&&D(i<y?x:u,i,p,y,i<y?u:x,i,r.x,r.y)&&(o=Math.abs(i-r.y)/(x-r.x),_(r,e)&&(o<a||o===a&&(r.x>t.x||r.x===t.x&&function(e,n){return E(e.prev,e,n.prev)<0&&E(n.next,e,e.next)<0}(t,r)))&&(t=r,a=o)),r=r.next,r!==v;);return t}(e,n);if(!t)return n;n=j(t,e);return q(n,n.next),q(t,t.next)}(o[x],t);return t}(e,n,p,t)),e.length>80*t){for(var a=r=e[0],l=x=e[1],h=t;h<v;h+=t)(i=e[h])<a&&(a=i),(u=e[h+1])<l&&(l=u),r<i&&(r=i),x<u&&(x=u);f=0!==(f=Math.max(r-a,x-l))?32767/f:0}O(p,y,t,a,l,f,0)}return y}function s(e,n,t,r,x){var i,u;if(x===0<d(e,n,t,r))for(i=n;i<t;i+=r)u=f(i,e[i],e[i+1],u);else for(i=t-r;n<=i;i-=r)u=f(i,e[i],e[i+1],u);return u&&N(u,u.next)&&(C(u),u=u.next),u}function q(e,n){if(!e)return e;n=n||e;var t,r=e;do{if(t=!1,r.steiner||!N(r,r.next)&&0!==E(r.prev,r,r.next))r=r.next;else{if(C(r),(r=n=r.prev)===r.next)break;t=!0}}while(t||r!==n);return n}function O(e,n,t,r,x,i,u){if(e){if(!u&&i){for(var f=e,o=r,v=x,p=i,y=f;0===y.z&&(y.z=k(y.x,y.y,o,v,p)),y.prevZ=y.prev,y.nextZ=y.next,(y=y.next)!==f;);y.prevZ.nextZ=null,y.prevZ=null;var a,l,h,s,c,d,Z,g,w=y,M=1;do{for(l=w,c=w=null,d=0;l;){for(d++,h=l,a=Z=0;a<M&&(Z++,h=h.nextZ);a++);for(g=M;0<Z||0<g&&h;)0!==Z&&(0===g||!h||l.z<=h.z)?(l=(s=l).nextZ,Z--):(h=(s=h).nextZ,g--),c?c.nextZ=s:w=s,s.prevZ=c,c=s;l=h}}while(c.nextZ=null,M*=2,1<d)}for(var b,m,z=e;e.prev!==e.next;)if(b=e.prev,m=e.next,i?function(e,n,t,r){var x=e.prev,i=e,u=e.next;if(0<=E(x,i,u))return;var f=x.x,o=i.x,v=u.x,p=x.y,y=i.y,a=u.y,l=f<o?f<v?f:v:o<v?o:v,h=p<y?p<a?p:a:y<a?y:a,s=o<f?v<f?f:v:v<o?o:v,c=y<p?a<p?p:a:a<y?y:a,d=k(l,h,n,t,r),Z=k(s,c,n,t,r),g=e.prevZ,w=e.nextZ;for(;g&&g.z>=d&&w&&w.z<=Z;){if(g.x>=l&&g.x<=s&&g.y>=h&&g.y<=c&&g!==x&&g!==u&&D(f,p,o,y,v,a,g.x,g.y)&&0<=E(g.prev,g,g.next))return;if(g=g.prevZ,w.x>=l&&w.x<=s&&w.y>=h&&w.y<=c&&w!==x&&w!==u&&D(f,p,o,y,v,a,w.x,w.y)&&0<=E(w.prev,w,w.next))return;w=w.nextZ}for(;g&&g.z>=d;){if(g.x>=l&&g.x<=s&&g.y>=h&&g.y<=c&&g!==x&&g!==u&&D(f,p,o,y,v,a,g.x,g.y)&&0<=E(g.prev,g,g.next))return;g=g.prevZ}for(;w&&w.z<=Z;){if(w.x>=l&&w.x<=s&&w.y>=h&&w.y<=c&&w!==x&&w!==u&&D(f,p,o,y,v,a,w.x,w.y)&&0<=E(w.prev,w,w.next))return;w=w.nextZ}return 1}(e,r,x,i):function(e){var n=e.prev,t=e,e=e.next;if(0<=E(n,t,e))return;var r=n.x,x=t.x,i=e.x,u=n.y,f=t.y,o=e.y,v=r<x?r<i?r:i:x<i?x:i,p=u<f?u<o?u:o:f<o?f:o,y=x<r?i<r?r:i:i<x?x:i,a=f<u?o<u?u:o:o<f?f:o,l=e.next;for(;l!==n;){if(l.x>=v&&l.x<=y&&l.y>=p&&l.y<=a&&D(r,u,x,f,i,o,l.x,l.y)&&0<=E(l.prev,l,l.next))return;l=l.next}return 1}(e))n.push(b.i/t|0),n.push(e.i/t|0),n.push(m.i/t|0),C(e),e=m.next,z=m.next;else if((e=m)===z){u?1===u?O(e=function(e,n,t){var r=e;do{var x=r.prev,i=r.next.next}while(!N(x,i)&&U(x,r,r.next,i)&&_(x,i)&&_(i,x)&&(n.push(x.i/t|0),n.push(r.i/t|0),n.push(i.i/t|0),C(r),C(r.next),r=e=i),r=r.next,r!==e);return q(r)}(q(e),n,t),n,t,r,x,i,2):2===u&&function(e,n,t,r,x,i){var u=e;do{for(var f,o=u.next.next;o!==u.prev;){if(u.i!==o.i&&function(e,n){return e.next.i!==n.i&&e.prev.i!==n.i&&!function(e,n){var t=e;do{if(t.i!==e.i&&t.next.i!==e.i&&t.i!==n.i&&t.next.i!==n.i&&U(t,t.next,e,n))return 1}while(t=t.next,t!==e);return}(e,n)&&(_(e,n)&&_(n,e)&&function(e,n){var t=e,r=!1,x=(e.x+n.x)/2,i=(e.y+n.y)/2;for(;t.y>i!=t.next.y>i&&t.next.y!==t.y&&x<(t.next.x-t.x)*(i-t.y)/(t.next.y-t.y)+t.x&&(r=!r),t=t.next,t!==e;);return r}(e,n)&&(E(e.prev,e,n.prev)||E(e,n.prev,n))||N(e,n)&&0<E(e.prev,e,e.next)&&0<E(n.prev,n,n.next))}(u,o))return f=j(u,o),u=q(u,u.next),f=q(f,f.next),O(u,n,t,r,x,i,0),O(f,n,t,r,x,i,0);o=o.next}}while(u=u.next,u!==e)}(e,n,t,r,x,i):O(q(e),n,t,r,x,i,1);break}}}function c(e,n){return e.x-n.x}function k(e,n,t,r,x){return(e=1431655765&((e=858993459&((e=252645135&((e=16711935&((e=(e-t)*x|0)|e<<8))|e<<4))|e<<2))|e<<1))|(n=1431655765&((n=858993459&((n=252645135&((n=16711935&((n=(n-r)*x|0)|n<<8))|n<<4))|n<<2))|n<<1))<<1}function D(e,n,t,r,x,i,u,f){return(e-u)*(i-f)<=(x-u)*(n-f)&&(t-u)*(n-f)<=(e-u)*(r-f)&&(x-u)*(r-f)<=(t-u)*(i-f)}function E(e,n,t){return(n.y-e.y)*(t.x-n.x)-(n.x-e.x)*(t.y-n.y)}function N(e,n){return e.x===n.x&&e.y===n.y}function U(e,n,t,r){var x=v(E(e,n,t)),i=v(E(e,n,r)),u=v(E(t,r,e)),f=v(E(t,r,n));return x!==i&&u!==f||(0===x&&o(e,t,n)||(0===i&&o(e,r,n)||(0===u&&o(t,e,r)||!(0!==f||!o(t,n,r)))))}function o(e,n,t){return n.x<=Math.max(e.x,t.x)&&n.x>=Math.min(e.x,t.x)&&n.y<=Math.max(e.y,t.y)&&n.y>=Math.min(e.y,t.y)}function v(e){return 0<e?1:e<0?-1:0}function _(e,n){return E(e.prev,e,e.next)<0?0<=E(e,n,e.next)&&0<=E(e,e.prev,n):E(e,n,e.prev)<0||E(e,e.next,n)<0}function j(e,n){var t=new u(e.i,e.x,e.y),r=new u(n.i,n.x,n.y),x=e.next,i=n.prev;return(e.next=n).prev=e,(t.next=x).prev=t,(r.next=t).prev=r,(i.next=r).prev=i,r}function f(e,n,t,r){e=new u(e,n,t);return r?(e.next=r.next,(e.prev=r).next.prev=e,r.next=e):(e.prev=e).next=e,e}function C(e){e.next.prev=e.prev,e.prev.next=e.next,e.prevZ&&(e.prevZ.nextZ=e.nextZ),e.nextZ&&(e.nextZ.prevZ=e.prevZ)}function u(e,n,t){this.i=e,this.x=n,this.y=t,this.prev=null,this.next=null,this.z=0,this.prevZ=null,this.nextZ=null,this.steiner=!1}function d(e,n,t,r){for(var x=0,i=n,u=t-r;i<t;i+=r)x+=(e[u]-e[i])*(e[i+1]+e[u+1]),u=i;return x}n.exports=r,(n.exports.default=r).deviation=function(e,n,t,r){var x=n&&n.length,i=x?n[0]*t:e.length,u=Math.abs(d(e,0,i,t));if(x)for(var f=0,o=n.length;f<o;f++){var v=n[f]*t,p=f<o-1?n[f+1]*t:e.length;u-=Math.abs(d(e,v,p,t))}for(var y=0,f=0;f<r.length;f+=3){var a=r[f]*t,l=r[f+1]*t,h=r[f+2]*t;y+=Math.abs((e[a]-e[h])*(e[1+l]-e[1+a])-(e[a]-e[l])*(e[1+h]-e[1+a]))}return 0===u&&0===y?0:Math.abs((y-u)/u)},r.flatten=function(e){for(var n=e[0][0].length,t={vertices:[],holes:[],dimensions:n},r=0,x=0;x<e.length;x++){for(var i=0;i<e[x].length;i++)for(var u=0;u<n;u++)t.vertices.push(e[x][i][u]);0<x&&(r+=e[x-1].length,t.holes.push(r))}return t}},{}]},{},[1])(1)});

    return module.exports;
  })();
  const sub = (a, b) => a.map((x, i) => x - b[i]);
  const dot = (a, b) => a.reduce((sum, x, i) => sum + x * b[i], 0);
  const cross3 = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
  const cross2 = (a, b, c) => (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  const finite3 = p => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite);
  const distance = (a, b) => Math.hypot(...sub(a, b));
  const area = p => p.reduce((sum, q, i) => sum + cross2(p[0], q, p[(i+1)%p.length]), 0) / 2;
  function fail(message) { throw new Error(message); }
  function onSegment(a, b, p, eps, areaEps) {
    return Math.abs(cross2(a,b,p)) <= areaEps && p[0] >= Math.min(a[0],b[0])-eps &&
      p[0] <= Math.max(a[0],b[0])+eps && p[1] >= Math.min(a[1],b[1])-eps && p[1] <= Math.max(a[1],b[1])+eps;
  }
  function intersects(a,b,c,d,eps,areaEps) {
    const x=cross2(a,b,c), y=cross2(a,b,d), z=cross2(c,d,a), w=cross2(c,d,b);
    return ((x>areaEps && y< -areaEps || x< -areaEps && y>areaEps) &&
      (z>areaEps && w< -areaEps || z< -areaEps && w>areaEps)) ||
      onSegment(a,b,c,eps,areaEps) || onSegment(a,b,d,eps,areaEps) ||
      onSegment(c,d,a,eps,areaEps) || onSegment(c,d,b,eps,areaEps);
  }
  function contains(ring,p) {
    let inside=false;
    for(let i=0,j=ring.length-1;i<ring.length;j=i++) {
      const a=ring[i],b=ring[j];
      if((a[1]>p[1])!==(b[1]>p[1]) && p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0]) inside=!inside;
    }
    return inside;
  }
  function meshFace(brep, face, r) {
    const loops=face.loops, edges=brep.edges(), rings=[];
    let vertexCount=0;
    if(!loops || loops.count<1 || loops.count>128) fail('invalid or excessive planar boundary loops');
    for(let li=0;li<loops.count;li++) {
      const loop=loops.get(li), kind=loop.loopType.value;
      if(kind!==r.BrepLoopType.Outer.value && kind!==r.BrepLoopType.Inner.value) fail('unsupported planar trim loop');
      const trims=loop.trims, segments=[];
      if(!trims || trims.count<1 || trims.count>2048) fail('invalid or excessive planar trims');
      for(let ti=0;ti<trims.count;ti++) {
        const trim=trims.get(ti);
        if(!Number.isInteger(trim.edgeIndex) || trim.edgeIndex<0 || trim.edgeIndex>=edges.count) fail('planar trim has no valid boundary edge');
        const edge=edges.get(trim.edgeIndex), poly=edge.tryGetPolyline();
        // tryGetPolyline extracts the actual polygonal curve; no curve sampling.
        if(!poly || poly.count<2) fail('curved boundary has no saved render mesh');
        if(vertexCount+poly.count-1>2048) fail('planar fallback exceeds 2048 boundary vertices; save render meshes in Rhino');
        const points=[];
        for(let pi=0;pi<poly.count;pi++) {
          const p=poly.get(pi);
          if(!finite3(p)) fail('non-finite planar boundary');
          points.push(p);
        }
        if(trim.isReversed) points.reverse();
        segments.push(points); vertexCount+=points.length-1;
      }
      rings.push({kind,segments});
    }
    const all=rings.flatMap(ring=>ring.segments.flat());
    const span=Math.max(...[0,1,2].map(k=>Math.max(...all.map(p=>p[k]))-Math.min(...all.map(p=>p[k]))));
    const magnitude=Math.max(1,...all.flat().map(Math.abs));
    const eps=Math.max(span*1e-10,magnitude*Number.EPSILON*32,1e-12), areaEps=eps*Math.max(span,eps);
    if(!(span>eps) || !face.isPlanar(eps)) fail('non-planar surface has no saved render mesh');
    for(const ring of rings) {
      const points=[];
      for(const segment of ring.segments) {
        if(points.length && distance(points[points.length-1],segment[0])>eps) fail('disconnected planar trims');
        points.push(...(points.length?segment.slice(1):segment));
      }
      if(distance(points[0],points[points.length-1])>eps) fail('open planar trim boundary');
      points.pop();
      ring.points=points.filter((p,i)=>!i || distance(p,points[i-1])>eps);
      if(ring.points.length<3) fail('degenerate planar boundary');
    }
    const outers=rings.filter(ring=>ring.kind===r.BrepLoopType.Outer.value);
    if(outers.length!==1) fail('planar face requires exactly one outer boundary');
    const ordered=[outers[0],...rings.filter(ring=>ring!==outers[0])];
    const origin=ordered[0].points[0], surface=face.underlyingSurface();
    const du=surface.domain(0),dv=surface.domain(1);
    let n=surface.normalAt(du[0]+(du[1]-du[0])/2,dv[0]+(dv[1]-dv[0])/2);
    if(!finite3(n) || Math.hypot(...n)<0.5) fail('invalid planar surface normal');
    n=n.map(x=>x/Math.hypot(...n)*(face.orientationIsReversed?-1:1));
    let u=ordered[0].points.map(p=>sub(p,origin)).reduce((a,b)=>dot(a,a)>dot(b,b)?a:b);
    u=sub(u,n.map(x=>x*dot(u,n)));
    const length=Math.hypot(...u);
    if(length<=eps) fail('degenerate planar basis');
    u=u.map(x=>x/length); const v=cross3(n,u);
    for(const ring of ordered) ring.projected=ring.points.map(p=>{
      const d=sub(p,origin);
      if(Math.abs(dot(d,n))>eps*4) fail('boundary is not on its planar surface');
      return [dot(d,u),dot(d,v)];
    });
    for(let ri=0;ri<ordered.length;ri++) {
      const ring=ordered[ri].projected;
      if(Math.abs(area(ring))<=areaEps) fail('zero-area planar boundary');
      for(let i=0;i<ring.length;i++) for(let rj=ri;rj<ordered.length;rj++) {
        const other=ordered[rj].projected;
        for(let j=rj===ri?i+1:0;j<other.length;j++) {
          if(ri===rj && (j===i+1 || i===0 && j===ring.length-1)) continue;
          if(intersects(ring[i],ring[(i+1)%ring.length],other[j],other[(j+1)%other.length],eps,areaEps)) fail('crossing or touching planar boundaries');
        }
      }
      if(ri && !contains(ordered[0].projected,ring[0])) fail('planar hole is outside the boundary');
      if(ri) for(let rj=1;rj<ri;rj++) if(contains(ordered[rj].projected,ring[0]) || contains(ring,ordered[rj].projected[0])) fail('nested planar holes');
    }
    const positions=[],flat=[],holes=[];
    for(let ri=0;ri<ordered.length;ri++) {
      if(ri) holes.push(positions.length/3);
      ordered[ri].points.forEach(p=>positions.push(...p)); ordered[ri].projected.forEach(p=>flat.push(...p));
    }
    const indices=earcut(flat,holes,2), target=Math.abs(area(ordered[0].projected))-ordered.slice(1).reduce((s,r)=>s+Math.abs(area(r.projected)),0);
    let covered=0;
    if(!indices.length || indices.length%3 || !(target>areaEps)) fail('planar boundary could not be triangulated');
    for(let i=0;i<indices.length;i+=3) {
      const pts=indices.slice(i,i+3).map(k=>[flat[k*2],flat[k*2+1]]);
      const twice=cross2(...pts);
      if(Math.abs(twice)<=areaEps) fail('degenerate planar triangle');
      const centroid=[0,1].map(k=>pts.reduce((sum,p)=>sum+p[k],0)/3);
      if(!contains(ordered[0].projected,centroid) || ordered.slice(1).some(r=>contains(r.projected,centroid))) fail('triangle lies outside the planar boundary');
      covered+=Math.abs(twice)/2;
      if(twice<0) [indices[i+1],indices[i+2]]=[indices[i+2],indices[i+1]];
    }
    if(Math.abs(covered-target)>Math.max(target*1e-9,areaEps*indices.length)) fail('triangulation does not cover the planar boundary');
    // Match the cached Mesh API consumed by browser-rhino, without Wasm allocations.
    return {vertices:()=>({count:positions.length/3,get:i=>positions.slice(i*3,i*3+3)}),
      faces:()=>({count:indices.length/3,get:i=>[indices[i*3],indices[i*3+1],indices[i*3+2],indices[i*3+2]]})};
  }
  const api={meshFace};
  if(typeof module==='object' && module.exports) module.exports=api;
  else scope.RhinoPlanar=api;
})(typeof self!=='undefined'?self:globalThis);
