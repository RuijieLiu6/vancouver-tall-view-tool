/* Real browser journeys for optional height references and citywide Imagine. ?imaginetest=1 */
(async function () {
  'use strict';
  const X=window.__explorer, $=id=>document.getElementById(id), tests=[];
  const check=(name,pass,details)=>tests.push({name,pass:!!pass,...(details===undefined?{}:{details})});
  const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const bounded=(promise,ms,label)=>{let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(label+' timed out')),ms);})]).finally(()=>clearTimeout(timer));};
  let original=null, originalImport=null, originalChecksum=null, originalCreate=null, originalAnchorClick=null, capturedBlob=null;
  try {
    if(new URLSearchParams(location.search).get('cacheonly')==='1') {
      await bounded(VistaImagine.open(),90000,'Imagine data load');
      const info=VistaImagine.getInfo();
      check('versioned public map finishes loading with all parcels',info.loaded&&info.classified&&info.parcelCount===99354&&info.loadStage==='ready',info);
      check('saved datasets are reused without downloading parcel or policy payloads',info.cacheStatus==='hit'&&info.networkBytes===0,info);
      const before=performance.now();VistaImagine.close();await VistaImagine.open();
      check('same-page reopening reuses loaded intersections',performance.now()-before<1000&&VistaImagine.getInfo().classified,{reopenMs:performance.now()-before});
      return;
    }
    await X.ready; original=X.serializeHash(); originalImport=X.state.imported; originalChecksum=X.buildingsPositionsChecksum();
    const response=await ProjectAPI.fetch('/generated/height_policy.json');
    if(!response.ok)throw new Error('Height policy HTTP '+response.status);
    const policy=await response.json(), engine=HeightPolicy.create(policy);
    check('citywide policy contains mapped zones, source dates and reviewed rules',policy.zones.length>1500&&Object.keys(policy.rules).length>20&&policy.metadata.sources.length>=2);
    const extent=X.assets.manifest.extent_m.terrain_bbox;
    const square=(x,y,r=23)=>[[x-r,y-r],[x+r,y-r],[x+r,y+r],[x-r,y+r]];
    // These are search probes, not assumed district centres. The full footprint
    // must be validated by the real engine before any proposal is placed.
    function findSite(predicate,known) {
      for(const zone of policy.zones.filter(predicate)) {
        const b=zone.bbox, loX=Math.max(b[0]+24,extent[0]+24),hiX=Math.min(b[2]-24,extent[3]-24),loY=Math.max(b[1]+24,extent[1]+24),hiY=Math.min(b[3]-24,extent[4]-24);
        if(loX>hiX||loY>hiY)continue;
        const probes=[[(loX+hiX)/2,(loY+hiY)/2]];
        for(let x=loX;x<=hiX;x+=200)for(let y=loY;y<=hiY;y+=200)probes.push([x,y]);
        for(const [x,y]of probes) {
          const r=engine.evaluate({footprints:[square(x,y)],cones:[]});
          if(!r.zones.some(z=>z.id===zone.id)||(known?r.zoningHeightM!==11.5:r.zoningHeightM!==null))continue;
          const ground=X.landZAt(x,y); if(!Number.isFinite(ground))continue;
          return {x,y,zone:zone.zone,id:zone.id};
        }
      }
      return null;
    }
    const known=findSite(z=>z.zone==='R1-1',true);
    check('finds an R1-1 site with a fully sourced 46 m square inside model terrain bounds',!!known,known);
    if(!known)throw new Error('No usable known reference fixture found');
    const loadStudy=p=>X.applyHash(`#style=context&site=${p.x},${p.y}&parts=120,30,30,0,0,Height%20reference%20test&rot=17&pm=boxes&mode=plan&flow=build&fm=point,platform,`);
    loadStudy(known);const baseline=JSON.stringify(X.state.parts),siteCamera=JSON.stringify([X.state.site,X.state.cams]);
    await VistaHeights.ensure();VistaHeights.refresh();
    check('loading height references never changes the proposal automatically',JSON.stringify(X.state.parts)===baseline&&VistaHeights.result.zoningHeightM===11.5);
    check('sourced conditions and official schedule link are visible before applying',!!$('height-reference-rules').textContent.match(/rear buildings|8.5/i)&&!!$('height-reference-rules').querySelector('a[href^="https://bylaws.vancouver.ca/"]'));
    const dimensions=JSON.stringify(X.state.parts.map(({h,...part})=>part));
    check('zoning reference button is available for the block proposal',!$('height-use-zoning').disabled);
    $('height-use-zoning').click();
    check('native zoning button applies 11.5 m and preserves width, depth and rotation',Math.abs(X.proposalBox().top-X.proposalBox().base-11.5)<1e-6&&JSON.stringify(X.state.parts.map(({h,...part})=>part))===dimensions);
    check('using a reference preserves site, camera and existing context',JSON.stringify([X.state.site,X.state.cams])===siteCamera&&X.buildingsPositionsChecksum()===originalChecksum);
    check('restore previous height is offered after an explicit reference choice',!$('height-reference-restore').classList.contains('hidden'));
    $('height-reference-restore').click();
    check('restore returns the original 120 m block without changing its plan',JSON.stringify(X.state.parts)===baseline);
    X.setDisplayUnits('ft');VistaHeights.refresh();
    check('height references follow display units without changing metre geometry',$('height-reference-zoning').textContent.includes('ft')&&JSON.stringify(X.state.parts)===baseline);
    X.setDisplayUnits('m');
    // Import mode must never reinterpret a height-reference click as mesh scaling.
    X.setProposalMode('import');VistaHeights.refresh();
    check('import mode disables both height actions and explains geometry preservation',$('height-use-zoning').disabled&&$('height-use-view').disabled&&/preserve.*geometry/i.test($('height-reference-status').textContent));
    loadStudy(known);
    for(const [name,predicate]of [['DD',z=>z.zone==='DD'],['CD-1',z=>z.zone.startsWith('CD-1')]]) {
      const p=findSite(predicate,false);check(name+' has an unresolved official-source fixture',!!p,p);
      if(!p)continue;
      loadStudy(p);const before=JSON.stringify(X.state.parts);VistaHeights.refresh();
      check(name+' never supplies a numeric fallback or changes block height',VistaHeights.result.zoningHeightM===null&&$('height-use-zoning').disabled&&JSON.stringify(X.state.parts)===before);
      const expected=name==='DD'?'odp-downtown.pdf':'cd1-bylaws.vancouver.ca';
      check(name+' offers the relevant official source',Array.from($('height-reference-rules').querySelectorAll('a')).some(a=>a.href.includes(expected)));
    }
    loadStudy({x:760,y:300});VistaHeights.refresh();
    check('CWD exposes sourced railway-reference rules instead of claiming no regulation',VistaHeights.result.zoningHeightM===null&&/railway-track grade/.test($('height-reference-rules').textContent)&&/18.29/.test($('height-reference-rules').textContent));
    check('CWD never substitutes railway height for height above model terrain',$('height-use-regulation').disabled&&$('height-use-zoning').disabled&&$('height-reference-zoning').textContent==='Reference grade required');
    check('primary regulation control has a compact native disclosure',$('height-use-regulation').textContent==='Use height reference'&&$('height-reference-details').tagName==='DETAILS'&&!$('height-reference-details').open);
    loadStudy(known);VistaHeights.refresh();
    const beforeImagine=X.serializeHash(),beforeScene=JSON.stringify([X.state.site,X.state.parts,X.state.cams]),button=$('btn-imagine');
    button.focus();button.click();
    await bounded((async()=>{while(!window.VistaImagine.getInfo().classified){if($('imagine-retry')&&!$('imagine-retry').hidden)throw new Error($('imagine-progress').textContent);await pause(100);}})(),60000,'Citywide Imagine classification');
    const info=VistaImagine.getInfo();
    check('Imagine opens a modal and classifies more than 90,000 citywide parcels',$('vista-imagine').open&&info.loaded&&info.classified&&info.parcelCount>90000,info);
    $('imagine-iso').click();await pause(50);
    check('3D study toggle updates mode and explains flat-ground height field',VistaImagine.getInfo().mode==='iso'&&/flat base|terrain/i.test($('imagine-model-note').textContent));
    $('imagine-combined').click();await pause(50);
    check('combined scenario shows unresolved view-height limits explicitly',VistaImagine.getInfo().scenario==='combined'&&/unknown|unresolved|no verified/i.test($('imagine-scenario-note').textContent));
    $('imagine-plan').click();$('imagine-zoning').click();
    check('plan and zoning toggles restore their selected state',VistaImagine.getInfo().mode==='plan'&&VistaImagine.getInfo().scenario==='zoning'&&$('imagine-plan').getAttribute('aria-pressed')==='true');
    const parcelResponse=await ProjectAPI.fetch('/generated/imagine_parcels.json');
    if(!parcelResponse.ok)throw new Error('Parcel fixture HTTP '+parcelResponse.status);
    let parcelData=await parcelResponse.json();const firstParcel=parcelData.parcels[0],unknownParcel=parcelData.parcels.find(p=>p.zoningHeightM===null);parcelData=null;
    $('imagine-search').value=firstParcel.id;$('imagine-search-form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
    check('real parcel ID search selects the requested parcel and shows its reference',VistaImagine.getInfo().selectedParcel===firstParcel.id&&$('imagine-parcel-title').textContent.includes(firstParcel.id)&&$('imagine-parcel').querySelectorAll('dt').length>=3);
    $('imagine-search').value='missing-selftest-parcel';$('imagine-search-form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
    check('unknown parcel ID gives an actionable search message',/not found/i.test($('imagine-search-message').textContent));
    originalCreate=URL.createObjectURL;originalAnchorClick=HTMLAnchorElement.prototype.click;
    URL.createObjectURL=function(blob){capturedBlob=blob;return originalCreate.call(this,blob);};
    HTMLAnchorElement.prototype.click=function(){if(this.download?.startsWith('Vista-Imagine-'))return;return originalAnchorClick.call(this);};
    $('imagine-export').click();
    await bounded((async()=>{while(!capturedBlob)await pause(50);})(),20000,'Imagine CSV export');
    const csv=await capturedBlob.text(),lines=csv.replace(/^\uFEFF/,'').split(/\r?\n/),header=lines[0];
    check('CSV exports one row per anonymous parcel with reference columns',header.includes('"parcel_id","rule_id","zoning_reference_m","zoning_plus_views_reference_m"')&&lines.length===info.parcelCount+1,{rows:lines.length-1,bytes:capturedBlob.size});
    const unknownLine=unknownParcel&&lines.find(line=>line.startsWith('"'+unknownParcel.id+'",'));
    check('unresolved zoning references export as blank fields, never invented zeroes',!!unknownLine&&/^"[^"]*","[^"]*","",""/.test(unknownLine));
    URL.createObjectURL=originalCreate;HTMLAnchorElement.prototype.click=originalAnchorClick;originalCreate=null;originalAnchorClick=null;
    $('imagine-close').click();await pause(30);
    check('closing Imagine restores focus to its entry button',!$('vista-imagine').open&&document.activeElement===button);
    check('Imagine navigation, parcel search and CSV leave the original study unchanged',X.serializeHash()===beforeImagine&&JSON.stringify([X.state.site,X.state.parts,X.state.cams])===beforeScene&&X.buildingsPositionsChecksum()===originalChecksum);
    X.renderOnce();check('main study still renders without WebGL errors',X.gl.getError()===X.gl.NO_ERROR);
  } catch(error) {tests.push({name:'exception',pass:false,error:String(error),stack:error.stack});}
  finally {
    if(originalCreate)URL.createObjectURL=originalCreate;
    if(originalAnchorClick)HTMLAnchorElement.prototype.click=originalAnchorClick;
    window.VistaImagine?.close();
    if(original){X.state.imported=originalImport;X.applyHash(original);}
    const report=document.createElement('pre');report.id='imagine-selftest-result';report.hidden=true;
    report.textContent=JSON.stringify({tests,all_pass:tests.length>0&&tests.every(test=>test.pass)});document.body.appendChild(report);
    document.title=tests.length>0&&tests.every(test=>test.pass)?'IMAGINETEST DONE':'IMAGINETEST FAIL';
  }
})();
