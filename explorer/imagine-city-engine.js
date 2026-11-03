(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ImagineCityEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const SCHEMA = 'vista-imagine-city/1';
  const FLAGS = Object.freeze({ZONING_RESOLVED:1, ASSUMED_BASELINE:2, MAPPED_VIEW:4, MISSING_SURFACE:8,
    ASSUMED_SURFACE:16, CHANGED:32, ZERO_HEIGHT:64, INVALID_GEOMETRY:128});
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const compiled = new WeakMap();
  const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
  function floorFloat32(value) {
    if (!(value > 0)) return 0;
    f32[0] = value;
    if (f32[0] > value) u32[0]--;
    return f32[0];
  }
  function prepare(dataset) {
    if (!dataset || dataset.schema !== SCHEMA || !Array.isArray(dataset.coneIds) || dataset.coneIds.length > 32 ||
      new Set(dataset.coneIds).size !== dataset.coneIds.length) throw new Error('Unsupported Imagine City dataset');
    if (compiled.has(dataset)) return compiled.get(dataset);
    const assets = {}, coneIds = dataset.coneIds.map(String), declared = dataset.assemblies || {bases:[], tops:[], sizes:[]};
    if (![declared.bases, declared.tops, declared.sizes].every(Array.isArray) || declared.bases.length > 100000 ||
      declared.tops.length !== declared.bases.length || declared.sizes.length !== declared.bases.length) throw new Error('Invalid assembly table');
    const groups = declared.bases.map((base, i) => {
      const top = declared.tops[i], size = declared.sizes[i];
      if (![base, top].every(finite) || top < base || !Number.isSafeInteger(size) || size < 2) throw new Error('Invalid assembly extent');
      return {base, top, size, members:[]};
    });
    let total = 0, coordinateCount = 0;
    for (const [id, asset] of Object.entries(dataset.assets || {})) {
      const count = asset.count;
      if (!Number.isSafeInteger(count) || count < 0 || count > 100000 || !Array.isArray(asset.bounds) || asset.bounds.length !== count * 6 ||
        !Array.isArray(asset.osmIds) || asset.osmIds.length !== count || !Array.isArray(asset.zoningHeights) || asset.zoningHeights.length !== count ||
        !Array.isArray(asset.zoningStatus) || asset.zoningStatus.length !== count || !Array.isArray(asset.ruleIds) || asset.ruleIds.length !== count ||
        !Array.isArray(asset.cells)) throw new Error('Invalid Imagine City asset rows');
      total += count;
      if (total > 100000) throw new Error('Imagine City building budget exceeded');
      const cellsByRow = Array.from({length:count}, () => []), groupIndices = new Uint32Array(count);
      if (asset.assemblyIds && (!Array.isArray(asset.assemblyIds) || asset.assemblyIds.length !== count)) throw new Error('Invalid assembly row mapping');
      for (let row = 0; row < count; row++) {
        const b = asset.bounds.slice(row * 6, row * 6 + 6);
        if (!b.every(finite) || b[0] > b[3] || b[1] > b[4] || b[2] > b[5] || b[5] - b[2] > 10000 ||
          !(asset.zoningHeights[row] === null || finite(asset.zoningHeights[row]) && asset.zoningHeights[row] >= 0 && asset.zoningHeights[row] <= 10000) ||
          ![0, 1, 2, 3].includes(asset.zoningStatus[row]) || !Array.isArray(asset.ruleIds[row])) throw new Error('Invalid Imagine City building fact');
        const groupId = asset.assemblyIds ? asset.assemblyIds[row] : -1;
        if (!Number.isSafeInteger(groupId) || groupId < -1 || groupId >= declared.bases.length) throw new Error('Invalid building assembly id');
        const index = groupId === -1 ? groups.length : groupId;
        if (groupId === -1) groups.push({base:b[2], top:b[5], size:1, members:[]});
        if (groups[index].base > b[2] || groups[index].top < b[5]) throw new Error('Assembly does not cover member extent');
        groups[index].members.push({id, row}); groupIndices[row] = index;
      }
      const pairs = new Set();
      for (const cell of asset.cells) {
        if (!Array.isArray(cell) || cell.length !== 3 || !Number.isSafeInteger(cell[0]) || cell[0] < 0 || cell[0] >= count ||
          !Number.isSafeInteger(cell[1]) || cell[1] < 0 || cell[1] >= coneIds.length || !Array.isArray(cell[2]) ||
          !cell[2].length || cell[2].length % 2 || !cell[2].every(finite)) throw new Error('Invalid clipped corridor cell');
        coordinateCount += cell[2].length;
        if (coordinateCount > 10000000 || pairs.has(cell[0] + ':' + cell[1])) throw new Error('Imagine City cell budget or duplicate exceeded');
        pairs.add(cell[0] + ':' + cell[1]); cellsByRow[cell[0]].push(cell);
      }
      assets[id] = {source:asset, cellsByRow, groupIndices};
    }
    if (!Object.keys(assets).length) throw new Error('Imagine City dataset has no assets');
    if (groups.some(group => group.members.length !== group.size)) throw new Error('Assembly member count does not match');
    const ready = {assets, coneIds, total, groups}; compiled.set(dataset, ready); return ready;
  }
  function normalizePlanes(planes, coneIds) {
    const map = new Map();
    for (const input of Array.isArray(planes) ? planes : []) {
      const id = String(input && input.id), p = input && input.plane;
      if (!coneIds.includes(id) || !p || ![p.a, p.b, p.c].every(finite) || Math.abs(p.a) > 1e4 || Math.abs(p.b) > 1e4 || Math.abs(p.c) > 1e9) continue;
      if (map.has(id)) throw new Error('Duplicate Imagine City corridor surface');
      map.set(id, {id, plane:{a:p.a, b:p.b, c:p.c}, assumed:input.assumed !== false, source:String(input.source || 'Study surface'), datum:String(input.datum || 'Vista model Z')});
    }
    return map;
  }
  function minimumCell(cell, surface, coordinateError) {
    const {a, b, c} = surface.plane, xy = cell[2]; let z = Infinity, x = 0, y = 0;
    for (let i = 0; i < xy.length; i += 2) {
      const q = a * xy[i] + b * xy[i + 1] + c;
      if (q < z) { z = q; x = xy[i]; y = xy[i + 1]; }
    }
    // Quantisation can move an extremum in either direction; reserve its full
    // affine error before applying the explicit design clearance.
    return {z:z - (Math.abs(a) + Math.abs(b)) * coordinateError, x, y};
  }
  function calculate(dataset, options = {}) {
    const ready = prepare(dataset), scenario = ['existing', 'zoning', 'views'].includes(options.scenario) ? options.scenario : 'views';
    const fallback = finite(options.missingHeightM) && options.missingHeightM >= 0 && options.missingHeightM <= 2000 ? options.missingHeightM : 213.36;
    const useAssumptions = options.useAssumptions === true, surfaces = normalizePlanes(options.planes, ready.coneIds);
    const error = finite(dataset.metadata?.coordinateErrorM) && dataset.metadata.coordinateErrorM >= 0 ? Math.min(.001, dataset.metadata.coordinateErrorM) : .0000005;
    const clearance = .1, assets = {}, missingIds = new Set();
    const stats = {buildingCount:ready.total, mappedViewBuildings:0, changedBuildings:0, reducedBuildings:0, grownBuildings:0,
      zoningReferenceBuildings:0, unresolvedZoningBuildings:0, assumedHeightBuildings:0, missingSurfaceBuildings:0, missingSurfaceIds:[],
      zeroHeightBuildings:0, noPositiveHeightBuildings:0, controllingViewCounts:{}, availableSurfaceCount:surfaces.size,
      assumedSurfaceCount:[...surfaces.values()].filter(s => s.assumed).length};
    for (const [id, {source}] of Object.entries(ready.assets)) {
      const heights = new Float32Array(source.count), baselineHeights = new Float32Array(source.count), controlViews = new Int16Array(source.count), flags = new Uint8Array(source.count);
      const allowances = new Float32Array(source.count), ceilingModelZ = new Float64Array(source.count), controlXY = new Float64Array(source.count * 2);
      const bases = new Float32Array(source.count), scales = new Float32Array(source.count), baselineScales = new Float32Array(source.count), controlRows = new Uint32Array(source.count), controlAssets = [];
      controlViews.fill(-1); allowances.fill(NaN); ceilingModelZ.fill(NaN); controlXY.fill(NaN);
      assets[id] = {heights, baselineHeights, controlViews, flags, allowances, ceilingModelZ, controlXY, bases, scales, baselineScales, controlRows, controlAssets};
    }
    for (const group of ready.groups) {
      const groupHeight = group.top - group.base; let knownMinimum = Infinity, allResolved = true, invalid = false;
      for (const {id, row} of group.members) {
        const source = ready.assets[id].source;
        const resolved = source.zoningStatus[row] === 0 && finite(source.zoningHeights[row]);
        if (resolved) knownMinimum = Math.min(knownMinimum, source.zoningHeights[row]); else allResolved = false;
        invalid ||= source.zoningStatus[row] === 3;
        stats[resolved ? 'zoningReferenceBuildings' : 'unresolvedZoningBuildings']++;
      }
      let baseline = groupHeight, assumedBaseline = false;
      if (scenario !== 'existing' && !invalid) {
        if (allResolved) baseline = knownMinimum;
        else if (useAssumptions) { baseline = Math.min(knownMinimum, fallback); assumedBaseline = true; }
      }
      const baselineScale = groupHeight > 0 ? baseline / groupHeight : 1;
      let viewScale = Infinity, controller = -1, controlPoint = null, controllingMember = null, missing = false, assumedSurface = false;
      for (const member of group.members) {
        const {id, row} = member, {source, cellsByRow} = ready.assets[id], cells = cellsByRow[row];
        if (cells.length) stats.mappedViewBuildings++;
        if (scenario === 'views') for (const cell of cells) {
          const viewId = ready.coneIds[cell[1]], surface = surfaces.get(viewId);
          if (!surface) { missing = true; missingIds.add(viewId); continue; }
          assumedSurface ||= surface.assumed;
          const candidate = minimumCell(cell, surface, error), rise = source.bounds[row * 6 + 5] - group.base;
          // Per-part cumulative height controls the common assembly scale;
          // elevated members never move independently of their supports.
          const permittedScale = rise > 0 ? (candidate.z - group.base - clearance) / rise : candidate.z < group.base + clearance ? -Infinity : Infinity;
          if (permittedScale < viewScale) { viewScale = permittedScale; controller = cell[1]; controlPoint = candidate; controllingMember = member; }
        }
      }
      const scale = scenario === 'existing' ? 1 : floorFloat32(Math.max(0, Math.min(baselineScale, viewScale)));
      for (const {id, row} of group.members) {
        const {source, cellsByRow} = ready.assets[id], out = assets[id];
        const ownBase = source.bounds[row * 6 + 2], ownTop = source.bounds[row * 6 + 5], existing = ownTop - ownBase;
        const resolved = source.zoningStatus[row] === 0 && finite(source.zoningHeights[row]);
        let flag = resolved ? FLAGS.ZONING_RESOLVED : 0;
        if (source.zoningStatus[row] === 3) flag |= FLAGS.INVALID_GEOMETRY;
        if (cellsByRow[row].length) flag |= FLAGS.MAPPED_VIEW;
        if (assumedBaseline) { flag |= FLAGS.ASSUMED_BASELINE; stats.assumedHeightBuildings++; }
        if (assumedSurface) flag |= FLAGS.ASSUMED_SURFACE;
        if (missing) { flag |= FLAGS.MISSING_SURFACE; stats.missingSurfaceBuildings++; }
        if (controller >= 0) {
          out.allowances[row] = floorFloat32(Math.max(0, groupHeight * viewScale)); out.ceilingModelZ[row] = controlPoint.z;
          out.controlViews[row] = controller; out.controlXY[row * 2] = controlPoint.x; out.controlXY[row * 2 + 1] = controlPoint.y;
          out.controlRows[row] = controllingMember.row; out.controlAssets[row] = controllingMember.id;
          if (viewScale <= 0) stats.noPositiveHeightBuildings++;
          const viewId = ready.coneIds[controller]; stats.controllingViewCounts[viewId] = (stats.controllingViewCounts[viewId] || 0) + 1;
        }
        out.heights[row] = existing * scale; out.baselineHeights[row] = existing * baselineScale;
        out.bases[row] = group.base; out.scales[row] = scale; out.baselineScales[row] = baselineScale;
        if (Math.abs(out.heights[row] - existing) > .001 || Math.abs((ownBase - group.base) * (scale - 1)) > .001) {
          flag |= FLAGS.CHANGED; stats.changedBuildings++; stats[scale < 1 ? 'reducedBuildings' : 'grownBuildings']++;
        }
        if (scale === 0 || existing === 0) { flag |= FLAGS.ZERO_HEIGHT; stats.zeroHeightBuildings++; }
        out.flags[row] = flag;
      }
    }
    stats.missingSurfaceIds = [...missingIds].sort();
    return {schema:SCHEMA, scenario, assets, stats, certainty:'Study', clearanceM:clearance,
      assumptions:{useAssumptions, missingHeightM:fallback, planeCount:surfaces.size, verifiedPlaneCount:0,
        note:'Selected-use zoning references and compatible study surfaces are design scenarios, not legal maximums or a verified City assessment.'},
      planes:[...surfaces.values()]};
  }
  function getBuilding(dataset, result, assetId, row) {
    const ready = prepare(dataset), asset = ready.assets[assetId], values = result?.assets?.[assetId];
    if (!asset || !values || !Number.isSafeInteger(row) || row < 0 || row >= asset.source.count) return null;
    const source = asset.source, bounds = source.bounds.slice(row * 6, row * 6 + 6), flags = values.flags[row], index = values.controlViews[row];
    const targetHeightM = values.heights[row], base = bounds[2], ceiling = values.ceilingModelZ[row];
    const group = ready.groups[asset.groupIndices[row]], assemblyBase = group.base, scale = values.scales[row];
    const controllingAsset = index >= 0 ? values.controlAssets[row] : null, controllingRow = values.controlRows[row];
    const controlTop = index >= 0 ? ready.assets[controllingAsset].source.bounds[controllingRow * 6 + 5] : null;
    const ruleIds = source.ruleIds[row].slice(), ruleMap = dataset.rules || {};
    const viewIds = asset.cellsByRow[row].map(cell => ready.coneIds[cell[1]]);
    const assemblyViewIds = [...new Set(group.members.flatMap(member => ready.assets[member.id].cellsByRow[member.row].map(cell => ready.coneIds[cell[1]])))];
    const controllingSurface = index >= 0 ? result.planes.find(p => p.id === ready.coneIds[index]) || null : null;
    return {asset:assetId, row, osmId:source.osmIds[row], bounds, modelBaseZM:base, modelTopZM:bounds[5], targetTopModelZM:assemblyBase + (bounds[5] - assemblyBase) * scale,
      existingHeightM:bounds[5] - base, baselineHeightM:values.baselineHeights[row], targetHeightM,
      assemblyBaseModelZM:assemblyBase, assemblyHeightM:group.top - assemblyBase, targetAssemblyHeightM:(group.top - assemblyBase) * scale,
      targetBaseModelZM:assemblyBase + (base - assemblyBase) * scale, assemblySize:group.size, scale,
      zoningHeightM:source.zoningHeights[row], zoningStatus:source.zoningStatus[row], ruleIds,
      rules:ruleIds.map(id => ({id, ...(ruleMap[id] || {status:'unresolved', note:'No complete numeric source reference for this zone.'})})),
      viewIds, assemblyViewIds, controllingView:index >= 0 ? ready.coneIds[index] : null,
      controllingSurface, surfaceStatus:controllingSurface ? controllingSurface.assumed ? 'Invented study surface' : 'Supplied surface, unverified' : 'No compatible surface',
      viewAllowanceM:finite(values.allowances[row]) ? values.allowances[row] : null, ceilingModelZ:finite(ceiling) ? ceiling : null,
      clearanceM:finite(ceiling) ? ceiling - assemblyBase - (controlTop - assemblyBase) * scale : null,
      controlPoint:index >= 0 ? {x:values.controlXY[row * 2], y:values.controlXY[row * 2 + 1], modelZ:ceiling} : null,
      controllingAsset, controllingRow:index >= 0 ? controllingRow : null,
      flags, assumedBaseline:!!(flags & FLAGS.ASSUMED_BASELINE), assumedSurface:!!(flags & FLAGS.ASSUMED_SURFACE),
      missingSurface:!!(flags & FLAGS.MISSING_SURFACE), certainty:'Study'};
  }
  function matchesManifest(dataset, manifest) {
    try {
      prepare(dataset);
      for (const [id, asset] of Object.entries(dataset.assets)) {
        const source = dataset.metadata?.sources?.[id], spec = manifest?.files?.[id];
        if (!source || !spec || source.count !== asset.count || source.meshFile !== spec.file ||
          source.positionCount !== spec.positions?.count || source.indexCount !== spec.indices?.count ||
          manifest.counts?.[id] !== asset.count) return false;
      }
      return true;
    } catch (_) { return false; }
  }
  return Object.freeze({SCHEMA, FLAGS, calculate, getBuilding, matchesManifest, floorFloat32});
});
