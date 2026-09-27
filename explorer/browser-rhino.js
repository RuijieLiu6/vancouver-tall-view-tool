/* Browser-side counterpart of src/view_context/importer.py. Uploaded bytes stay local. */
(function (scope) {
  'use strict';

  const MAX_BYTES = 80 * 1024 * 1024;
  const MAX_TRIANGLES = 2_000_000;
  const UNIT_SCALE = { Millimeters: 0.001, Centimeters: 0.01, Meters: 1,
    Kilometers: 1000, Inches: 0.0254, Feet: 0.3048, Yards: 0.9144 };
  const NOTE = 'read-only with rhino3dm; file coordinates are reported as-is; placement in the city is declared by the user';
  const scriptUrl = scope.document ? scope.document.currentScript?.src : scope.location?.href;
  const baseUrl = scriptUrl ? new URL('.', scriptUrl).href : '';
  const vendorUrl = baseUrl + 'vendor/rhino3dm/rhino3dm.js';
  const wasmUrl = baseUrl + 'vendor/rhino3dm/rhino3dm.wasm';
  let rhinoPromise;

  function error(message, skipped) {
    return { ok: false, error: message, ...(skipped ? { skipped } : {}) };
  }

  function loadRhino() {
    if (rhinoPromise) return rhinoPromise;
    rhinoPromise = (async () => {
      if (typeof module === 'object' && module.exports) {
        const path = require('node:path');
        const factory = require(path.join(__dirname, 'vendor/rhino3dm/rhino3dm.js'));
        return factory({ locateFile: () => path.join(__dirname, 'vendor/rhino3dm/rhino3dm.wasm') });
      }
      if (typeof scope.importScripts === 'function') {
        scope.importScripts(vendorUrl);
      } else if (typeof scope.rhino3dm !== 'function') {
        await new Promise((resolve, reject) => {
          const script = scope.document.createElement('script');
          script.src = vendorUrl;
          script.onload = resolve;
          script.onerror = () => reject(new Error('Could not load the local rhino3dm library'));
          scope.document.head.appendChild(script);
        });
      }
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

  async function importBytes(bytes, filename = 'upload.3dm') {
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
    let total = 0;
    try {
      for (let oi = 0; oi < objects.count; oi++) {
        const object = objects.get(oi);
        const g = object.geometry();
        const type = geometryType(g, r);
        let meshes = [];
        if (type === 'Mesh') meshes = [g];
        else if (type === 'Extrusion') {
          const mesh = g.getMesh(r.MeshType.Any);
          if (mesh) meshes = [mesh];
        } else if (type === 'Brep') {
          const faces = g.faces();
          for (let fi = 0; fi < faces.count; fi++) {
            const mesh = faces.get(fi).getMesh(r.MeshType.Any);
            if (mesh) meshes.push(mesh);
          }
        } else {
          skipped.push({ type, reason: 'not a mesh, extrusion or brep' });
          continue;
        }
        if (!meshes.length) {
          skipped.push({ type, reason: 'no render mesh cached in the file (mesh it in Rhino and save with render meshes)' });
          continue;
        }
        const positions = [], indices = [];
        const bbox = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
        let base = 0;
        for (const mesh of meshes) {
          const vertices = mesh.vertices(), faces = mesh.faces();
          for (let vi = 0; vi < vertices.count; vi++) {
            const v = vertices.get(vi);
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
              return error('model too heavy for the browser (> 2000000 triangles); simplify it first');
          }
          base += vertices.count;
        }
        total += indices.length / 3;
        if (!positions.length) {
          skipped.push({ type, reason: 'no vertices in the cached mesh' });
          continue;
        }
        const attrs = object.attributes();
        const layer = attrs.layerIndex >= 0 && attrs.layerIndex < layers.count ? layers.get(attrs.layerIndex).fullPath : null;
        parts.push({ name: attrs.name || `${type} ${String(attrs.id).slice(0, 8)}`, layer,
          bbox, triangles: indices.length / 3, positions, indices });
      }
      if (!parts.length) return error(`no meshable closed geometry found (${skipped.length} objects skipped)`, skipped);
      const bbox = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
      for (const p of parts) for (let axis = 0; axis < 3; axis++) {
        bbox[axis] = Math.min(bbox[axis], p.bbox[axis]);
        bbox[axis + 3] = Math.max(bbox[axis + 3], p.bbox[axis + 3]);
      }
      return { ok: true, filename, file_units: units, scaled_to_metres: scale !== null,
        unit_scale: scale, units_status: scale === null
          ? 'UNKNOWN unit system: geometry returned unscaled; declare units before any check'
          : `converted to metres (x ${scale})`, parts, bbox, triangles: total,
        skipped, object_count: objects.count, note: NOTE };
    } finally {
      if (typeof model.delete === 'function') model.delete();
    }
  }

  async function importFile(file, filename = file?.name || 'upload.3dm') {
    if (!file || typeof file.arrayBuffer !== 'function') return error('no .3dm file selected');
    if (file.size > MAX_BYTES) return error('model too large for import (> 80 MB); simplify it first');
    if (!/\.3dm$/i.test(filename)) return error('only .3dm files can be imported');
    const bytes = await file.arrayBuffer();
    if (scope.document && typeof scope.Worker === 'function' && scriptUrl) {
      try {
        return await new Promise((resolve, reject) => {
          const worker = new scope.Worker(scriptUrl);
          worker.onmessage = event => { worker.terminate(); resolve(event.data); };
          worker.onerror = event => { worker.terminate(); reject(new Error(event.message || 'Rhino worker failed')); };
          worker.postMessage({ bytes, filename }, [bytes]);
        });
      } catch (e) { return error('rhino3dm could not load: ' + e.message); }
    }
    return importBytes(new Uint8Array(bytes), filename);
  }

  const api = { importFile, importBytes, MAX_BYTES, MAX_TRIANGLES };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else if (scope.document) scope.BrowserRhino = api;
  else scope.onmessage = async event => {
    let result;
    try { result = await importBytes(new Uint8Array(event.data.bytes), event.data.filename); }
    catch (e) { result = error('rhino3dm import failed: ' + e.message); }
    scope.postMessage(result);
  };
})(typeof self !== 'undefined' ? self : globalThis);
