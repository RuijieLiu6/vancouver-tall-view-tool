/* Manual BC Address Geocoder search. An address point is a reference for finding
   an area; only model geometry can establish an available roof pick. */
(function (root) {
  'use strict';
  const DOWNTOWN = { west: -123.15, south: 49.268, east: -123.095, north: 49.301 };
  const ENDPOINT = 'https://geocoder.api.gov.bc.ca/addresses.geojson';
  const CIVIC_PRECISIONS = new Set(['CIVIC_NUMBER', 'UNIT', 'SITE', 'OCCUPANT']);
  function withinDowntown(lon, lat) {
    return Number.isFinite(lon) && Number.isFinite(lat) && lon >= DOWNTOWN.west && lon <= DOWNTOWN.east && lat >= DOWNTOWN.south && lat <= DOWNTOWN.north;
  }
  function withinModel(x, y, extent) {
    return Array.isArray(extent) && extent.length >= 5 && Number.isFinite(x) && Number.isFinite(y)
      && x >= extent[0] && x <= extent[3] && y >= extent[1] && y <= extent[4];
  }
  function searchUrl(raw) {
    const address = raw.trim();
    const q = /\bvancouver\b/i.test(address) ? address : `${address}, Vancouver, BC`;
    const url = new URL(ENDPOINT);
    url.searchParams.set('addressString', q);
    url.searchParams.set('maxResults', '8');
    url.searchParams.set('minScore', '80');
    url.searchParams.set('outputSRS', '4326');
    url.searchParams.set('locationDescriptor', 'parcelPoint');
    url.searchParams.set('localities', 'Vancouver');
    url.searchParams.set('bbox', `${DOWNTOWN.west},${DOWNTOWN.south},${DOWNTOWN.east},${DOWNTOWN.north}`);
    return url.href;
  }
  function candidates(data, modelFromLonLat, extent) {
    if (!data || data.type !== 'FeatureCollection' || !Array.isArray(data.features)) return [];
    const seen = new Set(), out = [];
    for (const feature of data.features) {
      const p = feature?.properties, coords = feature?.geometry?.coordinates;
      if (!p || feature?.geometry?.type !== 'Point' || !Array.isArray(coords)) continue;
      const lon = Number(coords[0]), lat = Number(coords[1]);
      const score = Number(p.score);
      if (!withinDowntown(lon, lat) || String(p.localityName || '').toLowerCase() !== 'vancouver'
        || !Number.isFinite(score) || score < 80 || !CIVIC_PRECISIONS.has(String(p.matchPrecision || ''))) continue;
      const xy = modelFromLonLat(lon, lat);
      if (!xy || !withinModel(xy.x, xy.y, extent)) continue;
      const label = String(p.fullAddress || '').trim();
      if (!label || seen.has(label.toLowerCase())) continue;
      seen.add(label.toLowerCase());
      out.push({ label, x: xy.x, y: xy.y, lon, lat, score, precision: String(p.matchPrecision),
        descriptor: String(p.locationDescriptor || ''), accuracy: String(p.locationPositionalAccuracy || '') });
    }
    return out.slice(0, 5);
  }
  function roofAvailableAt(x, y, assets, roofAt, isRemoved, showExisting) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || typeof roofAt !== 'function') return false;
    for (const ext of [false, true]) {
      const cols = (ext ? assets.extIndex : assets.index)?.columns;
      if (!cols) continue;
      for (let i = 0; i < cols.bbox.length; i++) {
        if (isRemoved(i, ext) && !showExisting) continue;
        const b = cols.bbox[i];
        if (x < b[0] || x > b[3] || y < b[1] || y > b[4]) continue;
        if (roofAt(i, ext, x, y)) return true;
      }
    }
    return false;
  }
  // ---- suggestions as you type (pure helpers; tested in tests/test_address_search.cjs)
  const CITY_EXPORT = 'https://opendata.vancouver.ca/api/explore/v2.1/catalog/datasets/property-addresses/exports/json';
  // City data abbreviates ST and AV but spells out ROAD, BOULEVARD, DRIVE, PLACE and CRESCENT.
  const WORDS = { STREET: 'ST', STR: 'ST', AVENUE: 'AV', AVE: 'AV', DR: 'DRIVE', CRES: 'CRESCENT', PL: 'PLACE', BLVD: 'BOULEVARD', RD: 'ROAD', WEST: 'W', EAST: 'E', NORTH: 'N', SOUTH: 'S' };
  function cityUrl() { const u = new URL(CITY_EXPORT); u.searchParams.set('select', 'civic_number,std_street,geo_point_2d');
    u.searchParams.set('where', `in_bbox(geo_point_2d, ${DOWNTOWN.south}, ${DOWNTOWN.west}, ${DOWNTOWN.north}, ${DOWNTOWN.east})`); return u.href; }
  function normalizeStreet(text) { return String(text || '').toUpperCase().replace(/[.,]/g, ' ').replace(/\bVANCOUVER\b.*$/, '').split(/\s+/).filter(Boolean).map((w) => WORDS[w] || w).join(' '); }
  function parseQuery(raw) { const t = String(raw || '').split(',')[0].trim().replace(/^(\d+)([NSEW])\b/i, '$1 $2').replace(/^(\d+)\s*-\s*(\d+)/, '$2'); const m = /^(\d+)\s*(.*)$/.exec(t);
    return m ? { number: m[1], street: normalizeStreet(m[2]) } : { number: '', street: normalizeStreet(t) }; }
  function titleStreet(street) { return street.split(' ').map((w) => /^[NSEW]$|^\d+(ST|ND|RD|TH)$/.test(w) ? w.replace(/(ST|ND|RD|TH)$/, (x) => x.toLowerCase()) : w[0] + w.slice(1).toLowerCase()).join(' '); }
  function addressLabel(rec) { return `${rec.number} ${titleStreet(rec.street)}`; }
  function cityRecords(rows) { const out = [], seen = new Set(); for (const r of Array.isArray(rows) ? rows : []) { const number = String(r?.civic_number || '').trim(), street = String(r?.std_street || '').trim().toUpperCase();
    const lon = Number(r?.geo_point_2d?.lon), lat = Number(r?.geo_point_2d?.lat); if (!/^\d+$/.test(number) || !street || !withinDowntown(lon, lat)) continue;
    const key = number + ' ' + street; if (seen.has(key)) continue; seen.add(key); out.push({ number, street, lon, lat }); } return out; }
  function editDistance(a, b) { // Damerau (optimal string alignment): insertions, deletions, substitutions and adjacent swaps
    const m = a.length, n = b.length, d = Array.from({ length: m + 1 }, (_, i) => { const row = new Array(n + 1).fill(0); row[0] = i; return row; }); for (let j = 0; j <= n; j++) d[0][j] = j;
    for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) { d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1); }
    return d[m][n]; }
  const sharedPrefix = (a, b) => { let k = 0; while (k < a.length && k < b.length && a[k] === b[k]) k++; return k; };
  // Matches that exist, best first. kind: 'match' (typed text is a prefix) or 'guess' (closest real addresses: "Did you mean").
  function suggest(records, raw, limit = 8) {
    const q = parseQuery(raw); if (!records.length || (!q.number && q.street.length < 2)) return { kind: 'none', items: [] };
    const streets = [...new Set(records.map((r) => r.street))];
    if (!q.number) { const hits = streets.filter((s) => s.startsWith(q.street) || s.split(' ').some((w) => w.startsWith(q.street))).sort(); return { kind: 'streets', items: hits.slice(0, limit).map((s) => ({ street: s, label: titleStreet(s) })) }; }
    const match = records.filter((r) => r.number.startsWith(q.number) && (!q.street || r.street.startsWith(q.street) || r.street.split(' ').some((w) => w.startsWith(q.street.split(' ')[0]) && r.street.includes(q.street))))
      .sort((a, b) => (a.number === q.number ? 0 : 1) - (b.number === q.number ? 0 : 1) || a.number.length - b.number.length || +a.number - +b.number || a.street.localeCompare(b.street));
    if (match.length) return { kind: 'match', items: match.slice(0, limit) };
    // Nothing matches: find the street(s) the user meant (a typed prefix such as "W", else the closest name), then the closest real civic numbers there.
    let targets = streets; if (q.street) { const prefixed = streets.filter((s) => s.startsWith(q.street));
      if (prefixed.length) targets = prefixed; else { const scored = streets.map((s) => ({ s, d: Math.min(editDistance(q.street, s), editDistance(q.street, s.replace(/ (ST|AV|DRIVE|PLACE|CRESCENT|MEWS|WAY|RD|BLVD)$/, ''))) })).sort((a, b) => a.d - b.d);
        const best = scored[0]?.d ?? 99; if (best > Math.max(2, Math.floor(q.street.length / 3))) return { kind: 'none', items: [] }; targets = scored.filter((x) => x.d === best).map((x) => x.s); } }
    const n = +q.number; const guesses = records.filter((r) => targets.includes(r.street)).map((r) => ({ r, d: editDistance(q.number, r.number), p: sharedPrefix(q.number, r.number), gap: Math.abs(+r.number - n) }))
      .sort((a, b) => a.d - b.d || b.p - a.p || a.gap - b.gap).slice(0, Math.min(limit, 4)).map((x) => x.r);
    return { kind: 'guess', items: guesses };
  }
  const API = { DOWNTOWN, withinDowntown, withinModel, searchUrl, candidates, roofAvailableAt, cityUrl, cityRecords, parseQuery, normalizeStreet, suggest, addressLabel, editDistance };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  if (!root.document) return;
  root.AddressSearch = API;

  const $ = id => root.document.getElementById(id);
  const form = $('address-search-form'), input = $('address-query'), status = $('address-status'), results = $('address-results');
  if (!form || !input || !status || !results || !root.__explorer || !root.AerialContextGeo) return;
  const X = root.__explorer, Geo = root.AerialContextGeo;
  let requestId = 0, controller = null;
  function setStatus(message, kind = 'info') { status.textContent = message; status.dataset.kind = kind; }
  function cancelPending() { requestId++; if (controller) { controller.abort(); controller = null; } }
  function locate(candidate) {
    if (!X.focusLocation(candidate.x, candidate.y)) {
      setStatus('This address point is outside the available model area.', 'warning'); return;
    }
    X.applyFlowTool?.();
    root.__aerialContext?.setCenterModel(candidate.x, candidate.y);
    X.setAddressPin?.(candidate);
    setStatus(X.state?.site ? `${candidate.label} is marked on the plan. Your site has not moved: click the plan to move it, or choose “Place site here”.` : `${candidate.label} is marked on the plan. Click open ground near it to place your site, or choose “Place site here”.`, 'success');
  }
  function renderResults(items) {
    results.replaceChildren();
    for (const item of items) {
      const li = root.document.createElement('li');
      li.className = 'address-result';
      const heading = root.document.createElement('strong'); heading.textContent = item.label; li.appendChild(heading);
      const note = root.document.createElement('span'); note.className = 'address-result-note';
      note.textContent = item.descriptor === 'cityAddress' ? 'City of Vancouver civic address point' : item.descriptor === 'parcelPoint' ? 'Parcel reference point (BC Address Geocoder)' : 'Address reference point (BC Address Geocoder)';
      li.appendChild(note);
      const actions = root.document.createElement('div'); actions.className = 'address-result-actions';
      const locateButton = root.document.createElement('button'); locateButton.type = 'button'; locateButton.className = 'btn'; locateButton.textContent = 'Zoom to address';
      locateButton.addEventListener('click', () => locate(item)); actions.appendChild(locateButton);
      // The search lives in the Site step: it can place the site point explicitly, never a roof observer.
      if (X.assets.ready && X.landZAt(item.x, item.y) !== null) {
        const siteButton = root.document.createElement('button'); siteButton.type = 'button'; siteButton.className = 'btn primary'; siteButton.textContent = 'Place site here';
        siteButton.addEventListener('click', () => {
          if (X.placeSite(item.x, item.y)) { X.state.flow.alt.place = 'spot'; X.focusSite(); X.refreshPanels(); setStatus(`Site point placed at the geocoder point for ${item.label}. It is an address reference, not a parcel boundary.`, 'success'); X.setHint?.(`Site placed at ${item.label}. Choose Proceed to Build when ready.`); }
          else setStatus('No modelled land at this address point. Click open ground nearby instead.', 'warning');
        });
        actions.appendChild(siteButton);
      }
      li.appendChild(actions); results.appendChild(li);
    }
  }
  // ---- suggestions while typing: City civic addresses (loaded once), topped up by the geocoder for addresses the list lacks
  const list = $('address-suggest'); let records = null, loading = null, options = [], active = -1, suggestTimer = null, geoTimer = null, geoId = 0;
  function loadRecords() { if (records || loading) return loading; setStatus('Loading downtown addresses…', 'loading');
    loading = root.fetch(cityUrl()).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).then((rows) => { records = cityRecords(rows); setStatus('Start typing a street number, for example 801 W Georgia.', 'info'); return records; })
      .catch(() => { records = null; loading = null; setStatus('Suggestions are unavailable right now; type a full address and choose Search.', 'warning'); return []; }); return loading; } // a failed load is retried on the next focus
  function toCandidate(rec, source) { const xy = Geo.lonLatToModel(rec.lon, rec.lat), extent = X.assets.manifest?.extent_m?.scene_bbox; if (!xy || !withinModel(xy.x, xy.y, extent)) return null;
    return { label: rec.label || addressLabel(rec), x: xy.x, y: xy.y, lon: rec.lon, lat: rec.lat, descriptor: source === 'geocoder' ? (rec.descriptor || 'parcelPoint') : 'cityAddress', source }; }
  let dismissed = false;
  function closeList() { list.classList.add('hidden'); list.replaceChildren(); options = []; active = -1; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); }
  function highlight(i) { active = i; options.forEach((o, k) => o.el.setAttribute('aria-selected', String(k === i))); if (i >= 0) { input.setAttribute('aria-activedescendant', options[i].el.id); options[i].el.scrollIntoView({ block: 'nearest' }); } else input.removeAttribute('aria-activedescendant'); }
  function stopSuggestions() { clearTimeout(suggestTimer); clearTimeout(geoTimer); geoId++; closeList(); }
  async function choose(o) { stopSuggestions(); if (o.street) { input.value = titleStreet(o.street) + ' '; input.focus(); setStatus('Now add the street number in front, for example 801 ' + titleStreet(o.street) + '.', 'info'); return; }
    const c = o.candidate; if (!c) return; input.value = c.label; if (!X.assets.ready) { setStatus('Waiting for the model to finish loading…', 'loading'); await X.ready; } renderResults([c]); locate(c); }
  function showList(title, items, kind) { list.replaceChildren(); options = [];
    if (title) { const h = root.document.createElement('li'); h.className = 'address-suggest-title' + (kind === 'guess' ? ' guess' : ''); h.setAttribute('role', 'presentation'); h.textContent = title; list.appendChild(h); }
    items.forEach((o, i) => { const li = root.document.createElement('li'); li.id = 'address-opt-' + i; li.setAttribute('role', 'option'); li.className = 'address-suggest-item';
      li.innerHTML = `<span></span>${o.note ? '<small></small>' : ''}`; li.firstChild.textContent = o.label; if (o.note) li.lastChild.textContent = o.note;
      li.addEventListener('mousedown', (e) => { e.preventDefault(); choose(o); }); list.appendChild(li); options.push(Object.assign({ el: li }, o)); });
    const open = items.length > 0 || !!title; list.classList.toggle('hidden', !open); input.setAttribute('aria-expanded', String(open)); highlight(items.length && kind !== 'guess' ? 0 : -1); } // guesses are never pre-selected, so Enter still searches
  function refreshSuggestions() { const raw = input.value; if (!records) { loadRecords().then((r) => { if (r && r.length && root.document.activeElement === input) refreshSuggestions(); }); return; }
    const r = suggest(records, raw); const q = parseQuery(raw);
    if (r.kind === 'streets') showList('Streets', r.items.map((x) => ({ label: x.label, street: x.street, note: 'add a number' })), 'match');
    else if (r.kind === 'match') showList(null, r.items.map((x) => ({ label: addressLabel(x), candidate: toCandidate(x, 'city') })).filter((o) => o.candidate), 'match');
    else if (r.kind === 'guess') showList(`No downtown address “${raw.trim()}”. Did you mean:`, r.items.map((x) => ({ label: addressLabel(x), candidate: toCandidate(x, 'city') })).filter((o) => o.candidate), 'guess');
    else closeList();
    // The City list has one main address per parcel; the geocoder also knows the others (e.g. 701 W Georgia) and street misspellings.
    if (q.number && q.street.length >= 3 && r.kind !== 'match') { clearTimeout(geoTimer); const mine = ++geoId; geoTimer = setTimeout(async () => {
      try { const resp = await root.fetch(searchUrl(raw)); if (!resp.ok || mine !== geoId) return; const found = candidates(await resp.json(), Geo.lonLatToModel, X.assets.manifest?.extent_m?.scene_bbox);
        if (mine !== geoId || !found.length || input.value !== raw || root.document.activeElement !== input || dismissed) return; const extra = found.map((c) => ({ label: c.label.replace(/, Vancouver, BC$/i, ''), candidate: Object.assign(c, { source: 'geocoder' }), note: 'BC Address Geocoder' }));
        const seen = new Set(options.map((o) => o.label.toUpperCase())); const fresh = extra.filter((o) => !seen.has(o.label.toUpperCase())); if (!fresh.length) return;
        const exact = fresh.some((o) => o.label.toUpperCase().startsWith(q.number + ' ') && normalizeStreet(o.label.replace(/^\d+\s*/, '')).startsWith(q.street));
        showList(exact ? null : `No downtown address “${raw.trim()}”. Did you mean:`, [...fresh, ...options.map(({ el, ...o }) => o)].slice(0, 8), exact ? 'match' : 'guess'); } catch (_) { /* suggestions stay local */ } }, 380); }
  }
  input.setAttribute('role', 'combobox'); input.setAttribute('aria-autocomplete', 'list'); input.setAttribute('aria-controls', 'address-suggest'); input.setAttribute('aria-expanded', 'false');
  input.addEventListener('focus', () => { loadRecords(); if (input.value.trim()) refreshSuggestions(); });
  input.addEventListener('input', () => {
    dismissed = false; cancelPending(); results.replaceChildren(); $('address-submit').disabled = false;
    clearTimeout(suggestTimer); if (!input.value.trim()) { closeList(); setStatus('Start typing a street number, for example 801 W Georgia.', 'info'); return; }
    suggestTimer = setTimeout(refreshSuggestions, 90);
  });
  input.addEventListener('keydown', (e) => { if (list.classList.contains('hidden') || !options.length) { if (e.key === 'Escape') closeList(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); highlight((active + 1) % options.length); } else if (e.key === 'ArrowUp') { e.preventDefault(); highlight((active - 1 + options.length) % options.length); }
    else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); choose(options[active]); } else if (e.key === 'Escape') { e.preventDefault(); dismissed = true; clearTimeout(geoTimer); geoId++; closeList(); } });
  input.addEventListener('blur', () => setTimeout(closeList, 120));
  form.addEventListener('submit', async event => {
    event.preventDefault();
    stopSuggestions(); cancelPending(); results.replaceChildren();
    const query = input.value.trim();
    if (query.length < 5) { setStatus('Enter a street address, for example 701 W Georgia St.', 'warning'); return; }
    if (query.length > 180) { setStatus('Please use a shorter street address.', 'warning'); return; }
    const mine = requestId;
    $('address-submit').disabled = true;
    setStatus('Searching downtown Vancouver addresses…', 'loading');
    try {
      await X.ready;
      if (mine !== requestId) return;
      const activeController = new AbortController();
      controller = activeController;
      const timer = setTimeout(() => activeController.abort(), 12000);
      let data;
      try {
        const response = await root.fetch(searchUrl(query), { signal: activeController.signal });
        if (!response.ok) throw new Error(`Address service returned HTTP ${response.status}.`);
        data = await response.json();
      } finally { clearTimeout(timer); }
      if (mine !== requestId) return;
      const extent = X.assets.manifest?.extent_m?.scene_bbox;
      const found = candidates(data, Geo.lonLatToModel, extent);
      renderResults(found);
      if (!found.length && records?.length) { const r = suggest(records, query); if (r.kind === 'guess' || r.kind === 'match') { input.focus(); refreshSuggestions(); setStatus('That address was not found. Did you mean one of the suggestions?', 'warning'); return; } }
      setStatus(found.length ? `${found.length} downtown address match${found.length === 1 ? '' : 'es'}. Select one to locate the model area.`
        : 'No matching civic address was found inside the downtown model. Check the street number and name.', found.length ? 'ready' : 'warning');
    } catch (error) {
      if (mine !== requestId) return;
      setStatus(error?.name === 'AbortError' ? 'Address search timed out. Try again.' : 'Address lookup is unavailable. Check your connection and try again.', 'error');
    } finally {
      if (mine === requestId) { controller = null; $('address-submit').disabled = false; }
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
