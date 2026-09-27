/* Same UI transport for the local Python app and a self-contained Pages release.
 * Static mode never sends proposal geometry or imported models to a server.
 */
(function () {
  'use strict';
  const base = new URL('../', document.currentScript.src);
  const isStatic = window.VANCOUVER_STATIC === true;
  const assetUrl = path => new URL(String(path).replace(/^\//, ''), base).href;
  const response = (data, status = 200) => new Response(JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
  const own = (body, key, fallback = null) => Object.hasOwn(body, key) ? body[key] : fallback;
  async function request(path, options = {}) {
    const name = String(path).replace(/^\//, '');
    const method = (options.method || 'GET').toUpperCase();
    if (!isStatic) return window.fetch(assetUrl(path), options);
    if (method === 'GET') {
      if (/^api\/(health|fixtures|context|guideline|geo|viewcones)$/.test(name)) {
        return window.fetch(assetUrl('data/' + name.slice(4) + '.json'), options);
      }
      if (name.startsWith('api/')) return response({ error: 'Unknown data resource' }, 404);
      return window.fetch(assetUrl(path), options);
    }
    if (method !== 'POST' || !['api/check', 'api/compare', 'api/import'].includes(name)) {
      return response({ error: 'Unsupported operation' }, 404);
    }
    if (name === 'api/import') {
      const headers = new Headers(options.headers);
      const filename = decodeURIComponent(headers.get('X-Filename') || 'upload.3dm');
      if (!/\.3dm$/i.test(filename)) return response({ ok: false, error: 'Expected a .3dm file' }, 400);
      if (!window.BrowserRhino) return response({ ok: false, error: 'Rhino reader did not load; reload and try again.' }, 503);
      return response(await window.BrowserRhino.importFile(options.body, filename));
    }
    let body;
    try { body = JSON.parse(options.body || 'null'); }
    catch (_) { return response({ error: 'Invalid JSON body' }, 400); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return response({ error: 'Expected an object' }, 400);
    if (!window.BrowserCheck) return response({ error: 'Browser comparison did not load; reload and try again.' }, 503);
    const tol = own(body, 'tol', 0.001);
    if (name === 'api/check') {
      const input = { parts: own(body, 'parts'), test_area: own(body, 'test_area'), boundary_z: own(body, 'boundary_z') };
      return response({ request_id: own(body, 'request_id'), input,
        check: window.BrowserCheck.checkParts(input.parts, input.test_area, input.boundary_z, tol, own(body, 'hypothesis')) });
    }
    const input = { fixture_id: own(body, 'fixture_id'), tower: own(body, 'tower'),
      test_area: own(body, 'test_area'), boundary_z: own(body, 'boundary_z'), tol };
    return response({ request_id: own(body, 'request_id'), input,
      result: window.BrowserCheck.compare(input.fixture_id, input.tower, input.test_area, input.boundary_z, tol),
      schema_violations: [] });
  }
  window.ProjectAPI = { isStatic, assetUrl, fetch: request };
})();
