/* Route direct HTML openings to the local server; load the app only over HTTP. */
(function () {
  'use strict';
  if (location.protocol === 'file:') {
    const destination = 'http://127.0.0.1:8765/' + location.search + location.hash;
    const status = document.getElementById('local-entry-status');
    document.getElementById('local-app-link').href = destination;
    let attempt = 0;
    function connect() {
      const current = ++attempt;
      status.textContent = 'Connecting to your local project…';
      window.__vancouverLocalServer = null;
      // Classic script loading works from local files without a CORS fetch.
      // Require our project-specific marker, not just an arbitrary HTTP response.
      const probe = document.createElement('script');
      let settled = false;
      const fail = () => {
        if (settled || current !== attempt) return;
        settled = true;
        status.textContent = 'The local app is not reachable yet. Start it using the steps below, then retry.';
        probe.remove();
      };
      const timer = setTimeout(fail, 4000);
      probe.onload = () => {
        if (settled || current !== attempt) return;
        clearTimeout(timer);
        if (window.__vancouverLocalServer !== 'vancouver-tall-view-tool/1') { fail(); return; }
        settled = true;
        location.replace(destination);
      };
      probe.onerror = () => { clearTimeout(timer); fail(); };
      probe.src = 'http://127.0.0.1:8765/explorer/server-ready.js?attempt=' + current;
      document.body.appendChild(probe);
    }
    document.getElementById('retry-local-entry').addEventListener('click', connect);
    connect();
    return;
  }

  const scriptBase = new URL('.', document.currentScript.src);
  const fileUrl = file => new URL(file, scriptBase).href;
  const stylesheet = document.createElement('link');
  stylesheet.rel = 'stylesheet'; stylesheet.href = fileUrl('explorer.css');
  stylesheet.onload = () => document.documentElement.classList.add('app-styled'); // reveals the page (see index.html)
  stylesheet.onerror = () => { document.documentElement.classList.add('app-styled'); const strip = document.getElementById('error-strip'); if (strip) { strip.textContent = 'The page styles could not be loaded. Reload the page to try again.'; strip.classList.remove('hidden'); } };
  document.head.appendChild(stylesheet);
  const load = (src) => new Promise((resolve, reject) => {
    const script = document.createElement('script'); script.src = src;
    script.onload = resolve; script.onerror = () => reject(new Error('Could not load ' + src));
    document.body.appendChild(script);
  });
  (async () => {
    const files = ['intro.js', 'browser-api.js'];
    if (window.VANCOUVER_STATIC) files.push('browser-check.js', 'browser-rhino.js');
    files.push('site-geometry.js', 'proposal-geometry.js', 'inset-camera.js', 'pdf.js', 'explorer.js', 'aerial-context.js', 'address-search.js', 'report.js');
    for (const file of files) await load(fileUrl(file));
    const query = new URLSearchParams(location.search);
    if (query.get('studytest') === '1') await load(fileUrl('study-selftest.js'));
    if (query.get('surfacetest') === '1') await load(fileUrl('surface-selftest.js'));
    if (query.get('workflowtest') === '1') await load(fileUrl('workflow-selftest.js'));
    if (query.get('rooftest') === '1') await load(fileUrl('rooftop-selftest.js'));
    if (query.get('flowtest') === '1') await load(fileUrl('flow-selftest.js'));
    if (query.get('selftest') === '1') await load(fileUrl('selftest.js'));
  })().catch(error => {
    const strip = document.getElementById('error-strip');
    strip.textContent = error.message + (window.VANCOUVER_STATIC ? '. Reload this page to try again.' : '. Keep the local server running and reload this page.');
    strip.classList.remove('hidden');
    document.getElementById('loading').classList.add('hidden');
  });
})();
