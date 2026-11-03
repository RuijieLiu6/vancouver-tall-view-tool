/* Browser-side counterpart of src/view_context/importer.py. Uploaded bytes stay local. */
(function (scope) {
  'use strict';

  const MAX_BYTES = 80 * 1024 * 1024;
  const MAX_TRIANGLES = 2_000_000;
  // Analysis and UI work still scales with part count even though display
  // geometry is batched into fewer draw calls in the explorer.
  const MAX_PARTS = 2000;
  const UNIT_SCALE = { Millimeters: 0.001, Centimeters: 0.01, Meters: 1,
    Kilometers: 1000, Inches: 0.0254, Feet: 0.3048, Yards: 0.9144 };
  const NOTE = 'read-only with rhino3dm; file coordinates are reported as-is; placement in the city is declared by the user';
  const scriptUrl = scope.document ? scope.document.currentScript?.src : scope.location?.href;
  const baseUrl = scriptUrl ? new URL('.', scriptUrl).href : '';
  const vendorUrl = baseUrl + 'vendor/rhino3dm/rhino3dm.js';
  const wasmUrl = baseUrl + 'vendor/rhino3dm/rhino3dm.wasm';
  const planarUrl = baseUrl + 'rhino-planar.js';
  let rhinoPromise;
  let planar;

  function error(message, skipped) {
    return { ok: false, error: message, ...(skipped ? { skipped } : {}) };
  }

  function loadRhino() {
    if (rhinoPromise) return rhinoPromise;
    rhinoPromise = (async () => {
      if (typeof module === 'object' && module.exports) {
        const path = require('node:path');
        planar = require('./rhino-planar.js');
        const factory = require(path.join(__dirname, 'vendor/rhino3dm/rhino3dm.js'));
        return factory({ locateFile: () => path.join(__dirname, 'vendor/rhino3dm/rhino3dm.wasm') });
      }
      if (typeof scope.importScripts === 'function') {
        scope.importScripts(vendorUrl, planarUrl);
      } else if (typeof scope.rhino3dm !== 'function') {
        await new Promise((resolve, reject) => {
          const script = scope.document.createElement('script');
          script.src = vendorUrl;
          script.onload = resolve;
          script.onerror = () => reject(new Error('Could not load the local rhino3dm library'));
          scope.document.head.appendChild(script);
        });
      }
      if (!scope.RhinoPlanar) await new Promise((resolve, reject) => {
        const script = scope.document.createElement('script'); script.src = planarUrl;
        script.onload = resolve; script.onerror = () => reject(new Error('Could not load the local planar Rhino reader'));
        scope.document.head.appendChild(script);
      });
      planar = scope.RhinoPlanar;
      return scope.rhino3dm({ locateFile: () => wasmUrl });
    })();
    rhinoPromise.catch(() => { rhinoPromise = null; });
    return rhinoPromise;
  }

  function enumName(enumType, value) {
    for (const name of Object.keys(enumType)) {
      if (enumType[name] && enumType[name].value === value?.value) return name;
    }
    return 'Unknown';
  }

  function round4(value) {
    // Match Python's ties-to-even rounding for float32 Rhino vertices.
    const scaled = value * 10000;
    const lower = Math.floor(scaled);
    if (scaled - lower === 0.5) return (lower % 2 === 0 ? lower : lower + 1) / 10000;
    return Math.round(scaled) / 10000;
  }

  function geometryType(g, r) {
    if (g instanceof r.Mesh) return 'Mesh';
    if (g instanceof r.Extrusion) return 'Extrusion';
    if (g instanceof r.Brep) return 'Brep';
    return g?.constructor?.name || 'Unknown';
  }

  async function importBytes(bytes, filename = 'upload.3dm', options = {}) {
    if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes);
    if (bytes.byteLength > MAX_BYTES) return error('model too large for import (> 80 MB); simplify it first');
    if (!/\.3dm$/i.test(filename)) return error('only .3dm files can be imported');
    let r;
    try { r = await loadRhino(); }
    catch (e) { return error('rhino3dm could not load: ' + e.message); }
    let model;
    try { model = r.File3dm.fromByteArray(bytes); }
    catch (_) { return error('rhino3dm could not read this file as a .3dm'); }
    if (!model) return error('rhino3dm could not read this file as a .3dm');

    const units = enumName(r.UnitSystem, model.settings().modelUnitSystem);
    const scale = Object.prototype.hasOwnProperty.call(UNIT_SCALE, units) ? UNIT_SCALE[units] : null;
    const objects = model.objects();
    const layers = model.layers();
    const parts = [], skipped = [];
    // Definition members are stored in the object table too. Only instances place
    // them in model space; importing the members directly creates phantom copies.
    const objectById = new Map();
    for (let oi = 0; oi < objects.count; oi++) {
      const object = objects.get(oi);
      objectById.set(String(object.attributes().id), object);
    }
    const definitions = model.instanceDefinitions();
    const definitionById = new Map();
    for (let di = 0; di < definitions.count; di++) {
      const definition = definitions.get(di);
      definitionById.set(String(definition.id), definition);
    }
    const layerById = new Map();
    for (let li = 0; li < layers.count; li++) {
      const layer = layers.get(li);
      layerById.set(String(layer.id), layer);
    }
    function layerVisible(index) {
      let layer = index >= 0 && index < layers.count ? layers.get(index) : null;
      const seen = new Set();
      while (layer) {
        if (!layer.visible || seen.has(String(layer.id))) return false;
        seen.add(String(layer.id));
        layer = layerById.get(String(layer.parentLayerId));
      }
      return true;
    }
    let total = 0, hiddenCount = 0;
    function visit(object, transforms = [], ancestors = [], instanceName = '') {
      const g = object.geometry();
      const attrs = object.attributes();
      if (!attrs.visible || !layerVisible(attrs.layerIndex)) {
        hiddenCount++;
        return;
      }
      if (g instanceof r.InstanceReference) {
        const id = String(g.parentIdefId);
        const definition = definitionById.get(id);
        if (!definition || ancestors.includes(id) || ancestors.length >= 32) {
          skipped.push({ type: 'InstanceReference', reason: !definition
            ? 'block definition is missing (linked blocks must be embedded before import)'
            : 'cyclic or excessively nested block definition' });
          return;
        }
        const x = g.xform;
        const matrix = [x.m00, x.m01, x.m02, x.m03, x.m10, x.m11, x.m12, x.m13,
          x.m20, x.m21, x.m22, x.m23, x.m30, x.m31, x.m32, x.m33];
        const name = [instanceName, attrs.name || definition.name || 'Block'].filter(Boolean).join(' / ');
        for (const childId of definition.getObjectIds()) {
          const child = objectById.get(String(childId));
          if (child) visit(child, [...transforms, matrix], [...ancestors, id], name);
          else skipped.push({ type: 'InstanceReference', reason: 'block member is missing' });
        }
        return;
      }
      return visitGeometry(g, attrs, transforms, instanceName);
    }
    function visitGeometry(g, attrs, transforms, instanceName) {
      const type = geometryType(g, r);
      let meshes = [];
      if (type === 'Mesh') meshes = [g];
      else if (type === 'Extrusion') {
        const mesh = g.getMesh(r.MeshType.Any);
        if (mesh) meshes = [mesh];
        else {
          const brep = g.toBrep(true);
          if (brep) { try { meshes = faceMeshes(brep, type); } finally { brep.delete(); } }
          else skipped.push({ type, reason: 'no render mesh cached; extrusion topology could not be read. Save in a shaded Rhino viewport to include render meshes' });
        }
      } else if (type === 'Brep') {
        meshes = faceMeshes(g, type);
      } else {
        skipped.push({ type, reason: 'not a mesh, extrusion or brep' });
        return;
      }
      if (!meshes.length) {
        if (type === 'Mesh') skipped.push({ type, reason: 'no render mesh cached in the file' });
        return;
      }
      const positions = [], indices = [];
      const bbox = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
      let base = 0;
      for (const mesh of meshes) {
        const vertices = mesh.vertices(), faces = mesh.faces();
        for (let vi = 0; vi < vertices.count; vi++) {
          let v = vertices.get(vi);
          // Nested instance transforms apply from the innermost block out.
          for (let ti = transforms.length - 1; ti >= 0; ti--) {
            const m = transforms[ti], [x, y, z] = v;
            const w = m[12] * x + m[13] * y + m[14] * z + m[15];
            v = [(m[0] * x + m[1] * y + m[2] * z + m[3]) / w,
              (m[4] * x + m[5] * y + m[6] * z + m[7]) / w,
              (m[8] * x + m[9] * y + m[10] * z + m[11]) / w];
          }
          for (let axis = 0; axis < 3; axis++) {
            const value = scale === null ? v[axis] : v[axis] * scale;
            positions.push(round4(value));
            bbox[axis] = Math.min(bbox[axis], value);
            bbox[axis + 3] = Math.max(bbox[axis + 3], value);
          }
        }
        for (let fi = 0; fi < faces.count; fi++) {
          const [a, b, c, d] = faces.get(fi);
          indices.push(base + a, base + b, base + c);
          if (d !== c) indices.push(base + a, base + c, base + d);
          if (total + indices.length / 3 > MAX_TRIANGLES)
            throw new Error('model too heavy for the browser (> 2000000 triangles); simplify it first');
        }
        base += vertices.count;
      }
      total += indices.length / 3;
      if (!positions.length) {
        skipped.push({ type, reason: 'no vertices in the cached mesh' });
        return;
      }
      // A reflected block reverses triangle winding. Correct it so the same
      // outward-facing surface remains visible with back-face culling.
      const orientation = transforms.reduce((sign, m) => sign * Math.sign(
        m[0] * (m[5] * m[10] - m[6] * m[9]) - m[1] * (m[4] * m[10] - m[6] * m[8])
        + m[2] * (m[4] * m[9] - m[5] * m[8])), 1);
      if (orientation < 0) for (let i = 0; i < indices.length; i += 3)
        [indices[i + 1], indices[i + 2]] = [indices[i + 2], indices[i + 1]];
      const layer = attrs.layerIndex >= 0 && attrs.layerIndex < layers.count ? layers.get(attrs.layerIndex).fullPath : null;
      parts.push({ name: [instanceName, attrs.name || `${type} ${String(attrs.id).slice(0, 8)}`].filter(Boolean).join(' / '), layer,
        bbox, triangles: indices.length / 3,
        positions: options.typed ? new Float32Array(positions) : positions,
        indices: options.typed ? new Uint32Array(indices) : indices });
      if (parts.length > MAX_PARTS)
        throw new Error(`model has more than ${MAX_PARTS} separate display parts; select and export only the proposed building, or combine its meshes, then retry`);
    }
    function faceMeshes(brep, type) {
      const output = [], faces = brep.faces();
      if (!faces.count) skipped.push({ type, reason: 'no render mesh cached and no surface faces found' });
      for (let fi = 0; fi < faces.count; fi++) {
        const face = faces.get(fi), cached = face.getMesh(r.MeshType.Any);
        if (cached && cached.vertices().count && cached.faces().count) { output.push(cached); continue; }
        try { output.push(planar.meshFace(brep, face, r)); }
        catch (e) { skipped.push({ type, face: fi + 1, reason: `face ${fi + 1} has no render mesh cached: ${e.message}. Save in a shaded Rhino viewport to include render meshes` }); }
      }
      return output;
    }
    try {
      for (const object of objectById.values()) {
        if (!object.attributes().isInstanceDefinitionObject) visit(object);
      }
      if (!parts.length) {
        if (hiddenCount) return { ...error(`no visible meshable geometry found (${hiddenCount} hidden objects omitted; ${skipped.length} objects skipped)`, skipped), hidden_count: hiddenCount };
        return error(`no meshable closed geometry found (${skipped.length} objects skipped)`, skipped);
      }
      const bbox = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
      for (const p of parts) for (let axis = 0; axis < 3; axis++) {
        bbox[axis] = Math.min(bbox[axis], p.bbox[axis]);
        bbox[axis + 3] = Math.max(bbox[axis + 3], p.bbox[axis + 3]);
      }
      return { ok: true, filename, file_units: units, scaled_to_metres: scale !== null,
        unit_scale: scale, units_status: scale === null
          ? 'UNKNOWN unit system: geometry returned unscaled; declare units before any check'
          : `converted to metres (x ${scale})`, parts, bbox, triangles: total,
        skipped, ...(hiddenCount ? { hidden_count: hiddenCount } : {}), object_count: objects.count, note: NOTE };
    } catch (e) {
      return error(e.message || 'rhino3dm could not import this geometry');
    } finally {
      if (typeof model.delete === 'function') model.delete();
    }
  }

  async function importFile(file, filename = file?.name || 'upload.3dm', options = {}) {
    if (options.signal?.aborted) return error('Rhino import cancelled');
    if (!file || typeof file.arrayBuffer !== 'function') return error('no .3dm file selected');
    if (file.size > MAX_BYTES) return error('model too large for import (> 80 MB); simplify it first');
    if (!/\.3dm$/i.test(filename)) return error('only .3dm files can be imported');
    const bytes = await file.arrayBuffer();
    if (options.signal?.aborted) return error('Rhino import cancelled');
    if (scope.document) {
      if (typeof scope.Worker !== 'function' || !scriptUrl)
        return error('this browser cannot run the local Rhino importer safely; use a current browser with Web Worker support');
      try {
        return await new Promise((resolve, reject) => {
          const worker = new scope.Worker(scriptUrl);
          const abort = () => { scope.clearTimeout(timeout); worker.terminate(); reject(new Error('Rhino import cancelled')); };
          const timeout = scope.setTimeout(() => {
            options.signal?.removeEventListener('abort', abort);
            worker.terminate(); reject(new Error('Rhino import took too long; simplify or split the model'));
          }, 60000);
          const finish = () => { scope.clearTimeout(timeout); options.signal?.removeEventListener('abort', abort); worker.terminate(); };
          worker.onmessage = event => { finish(); resolve(event.data); };
          worker.onerror = event => { finish(); reject(new Error(event.message || 'Rhino worker failed')); };
          worker.onmessageerror = () => { finish(); reject(new Error('Rhino worker response could not be read')); };
          options.signal?.addEventListener('abort', abort, { once: true });
          if (options.signal?.aborted) { abort(); return; }
          try { worker.postMessage({ bytes, filename }, [bytes]); }
          catch (e) { finish(); reject(e); }
        });
      } catch (e) { return error('rhino3dm could not load: ' + e.message); }
    }
    return importBytes(new Uint8Array(bytes), filename);
  }

  const api = { importFile, importBytes, MAX_BYTES, MAX_TRIANGLES, MAX_PARTS };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else if (scope.document) scope.BrowserRhino = api;
  else scope.onmessage = async event => {
    let result;
    try { result = await importBytes(new Uint8Array(event.data.bytes), event.data.filename, { typed: true }); }
    catch (e) { result = error('rhino3dm import failed: ' + e.message); }
    const transfer = result.ok ? result.parts.flatMap(part => [part.positions.buffer, part.indices.buffer]) : [];
    scope.postMessage(result, transfer);
  };
})(typeof self !== 'undefined' ? self : globalThis);
