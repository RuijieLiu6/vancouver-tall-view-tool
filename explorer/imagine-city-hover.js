/* Read the displayed model without selecting a building or recalculating heights. */
(function (root) {
  'use strict';
  const doc = root.document;
  if (!doc) return;
  let canvas, viewport, tooltip, height, label, policy, note, timer = null, pending = null, identity = '', current = null;
  const scenarioNames = {existing:'Original model',zoning:'Without view limits',views:'With study view limits'};
  function clear() {
    if (timer !== null) root.clearTimeout(timer);
    timer = null; pending = null; identity = ''; current = null;
    if (tooltip) tooltip.hidden = true;
  }
  function mount() {
    if (tooltip) return;
    tooltip = doc.createElement('div'); tooltip.id = 'imagine-city-hover'; tooltip.className = 'imagine-city-hover'; tooltip.hidden = true; tooltip.setAttribute('role','tooltip');
    height = doc.createElement('strong'); label = doc.createElement('span'); policy = doc.createElement('span'); policy.className='imagine-city-hover-policy'; note = doc.createElement('small');
    tooltip.appendChild(height); tooltip.appendChild(label); tooltip.appendChild(policy); tooltip.appendChild(note); viewport.appendChild(tooltip);
  }
  function position(point) {
    const rect = viewport.getBoundingClientRect(), w = tooltip.offsetWidth, h = tooltip.offsetHeight, gap = 16, inset = 8;
    let x = point.x - rect.left + gap, y = point.y - rect.top + gap;
    if (x + w + inset > rect.width) x = point.x - rect.left - w - gap;
    if (y + h + inset > rect.height) y = point.y - rect.top - h - gap;
    tooltip.style.left = Math.max(inset,Math.min(rect.width-w-inset,x)) + 'px';
    tooltip.style.top = Math.max(inset,Math.min(rect.height-h-inset,y)) + 'px';
  }
  function resolve() {
    timer = null;
    const point = pending; pending = null;
    const state = root.VistaImagineCity?.getState();
    if (!point || !state?.open || state.loading || state.calculating) return clear();
    const hit = root.__explorer?.pickImagineBuildingAt?.(point.x,point.y);
    if (!hit) return clear();
    const unit = root.__explorer?.state?.displayUnits || 'm', key = hit.asset + ':' + hit.index + ':' + state.scenario + ':' + unit;
    if (key !== identity) {
      const value = root.VistaImagineCity.getHoverBuilding(hit);
      const total = value?.assemblySize > 1 ? value.targetAssemblyHeightM : value?.targetHeightM;
      if (!Number.isFinite(total) || total <= 0) return clear();
      mount(); identity = key; current = {asset:hit.asset,index:hit.index,heightM:total,scenario:state.scenario};
      height.textContent = root.VistaUnits?.formatLength?.(total,unit) || total.toFixed(1) + ' m';
      label.textContent = value.contextPreserved?'Original context height':'Building height · ' + (scenarioNames[state.scenario] || 'Current scenario');
      policy.textContent = root.VistaImagineCity.describeHeightControl?.(value) || value.heightControl?.label || 'Height source unresolved';
      const conflicts=[value.minimumConflictsView?'view '+(value.viewAllowanceController?.viewId||'surface'):'',value.minimumConflictsZoning?'zoning reference':''].filter(Boolean);
      note.textContent = conflicts.length?'Conflicts with '+conflicts.join(' and ')+' · Study':'Study · Click for details';
      current.heightControl=policy.textContent;current.minimumConflict=conflicts.length>0;
    }
    tooltip.hidden = false; position(point);
  }
  function move(event) {
    const state = root.VistaImagineCity?.getState();
    if (!state?.open || state.loading || state.calculating || event.pointerType === 'touch' || event.buttons || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return clear();
    pending = {x:event.clientX,y:event.clientY};
    // Coalesce rapid movement; never ray-test every browser pointer event.
    if (timer === null) timer = root.setTimeout(resolve,80);
  }
  function bind() {
    canvas = doc.getElementById('gl'); viewport = doc.getElementById('viewport');
    if (!canvas || !viewport) return;
    canvas.addEventListener('pointermove',move);
    for (const name of ['pointerleave','pointercancel','lostpointercapture','wheel']) canvas.addEventListener(name,clear,{passive:true});
    doc.addEventListener('pointerdown',clear,true);
    doc.addEventListener('focusin',clear);
    doc.addEventListener('keydown',clear);
    doc.addEventListener('scroll',clear,true);
    root.addEventListener('resize',clear);
    root.addEventListener('blur',clear);
    doc.addEventListener('vista-imagine-city-closed',clear);
  }
  root.VistaImagineHover = {clear,getState:()=>({visible:!!tooltip&&!tooltip.hidden,pending:timer!==null,...current})};
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded',bind,{once:true}); else bind();
})(typeof window !== 'undefined' ? window : globalThis);
