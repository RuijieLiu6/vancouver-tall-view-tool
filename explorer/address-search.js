/* Live City address suggestions and BC Address Geocoder search. An address point is a reference for finding
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
  function searchUrl(raw, autoComplete = false) {
    const address = String(raw || '').trim();
    const url = new URL(ENDPOINT);
    // A locality suffix would interrupt the prefix being completed. The geographic
    // filters still constrain autocomplete requests to downtown Vancouver.
    url.searchParams.set('addressString', autoComplete || /\bvancouver\b/i.test(address) ? address : `${address}, Vancouver, BC`);
    url.searchParams.set('maxResults', '8');
    url.searchParams.set('minScore', autoComplete ? '50' : '80');
    url.searchParams.set('outputSRS', '4326');
    url.searchParams.set('locationDescriptor', 'parcelPoint');
    url.searchParams.set('interpolation', 'none');
    url.searchParams.set('echo', 'false');
    url.searchParams.set('localities', 'Vancouver');
    url.searchParams.set('bbox', `${DOWNTOWN.west},${DOWNTOWN.south},${DOWNTOWN.east},${DOWNTOWN.north}`);
    if (autoComplete) {
      url.searchParams.set('autoComplete', 'true');
      url.searchParams.set('fuzzyMatch', 'true');
      url.searchParams.set('exactSpelling', 'false');
      url.searchParams.set('brief', 'true');
      url.searchParams.set('matchPrecision', 'CIVIC_NUMBER,UNIT,SITE,OCCUPANT,STREET,INTERSECTION');
    }
    return url.href;
  }
  function candidates(data, modelFromLonLat, extent, autoComplete = false) {
    if (!data || data.type !== 'FeatureCollection' || !Array.isArray(data.features)) return [];
    const seen = new Set(), out = [];
    for (const feature of data.features) {
      const p = feature?.properties, coords = feature?.geometry?.coordinates;
      if (!p || feature?.geometry?.type !== 'Point' || !Array.isArray(coords)) continue;
      const lon = Number(coords[0]), lat = Number(coords[1]), score = Number(p.score);
      const label = String(p.fullAddress || '').trim(), precision = String(p.matchPrecision || '').toUpperCase();
      // brief=true omits localityName, but its standardized fullAddress includes it.
      const inVancouver = p.localityName ? String(p.localityName).toLowerCase() === 'vancouver' : /, Vancouver, BC$/i.test(label);
      const civic = CIVIC_PRECISIONS.has(precision);
      if (!withinDowntown(lon, lat) || !inVancouver || !Number.isFinite(score) || score < (autoComplete ? 50 : 80)
        || (!civic && !(autoComplete && ['STREET', 'INTERSECTION'].includes(precision)))) continue;
      const xy = modelFromLonLat(lon, lat);
      if (!xy || !withinModel(xy.x, xy.y, extent) || !label || seen.has(label.toLowerCase())) continue;
      seen.add(label.toLowerCase());
      out.push({ label, x: xy.x, y: xy.y, lon, lat, score, precision, kind: civic ? 'address' : 'area',
        descriptor: String(p.locationDescriptor || ''), accuracy: String(p.locationPositionalAccuracy || '') });
    }
    return out.slice(0, 8);
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
  function streetMatch(query, street) {
    if (!query) return { distance: 0 };
    const words = street.split(' '), used = new Set(); let distance = 0;
    for (const token of query.split(' ')) {
      let best = null;
      words.forEach((word, i) => {
        if (used.has(i)) return;
        let d = word.startsWith(token) ? 0 : Infinity;
        // Compare against a prefix too: a typo in an unfinished word should still
        // find GEORGIA from "gerog", without matching unrelated one-letter input.
        const allowance = token.length < 3 ? 0 : token.length < 6 ? 1 : 2;
        if (allowance && d) for (let n = Math.max(1, token.length - allowance); n <= Math.min(word.length, token.length + allowance); n++) d = Math.min(d, editDistance(token, word.slice(0, n)));
        if (d <= allowance && (!best || d < best.d)) best = { i, d };
      });
      if (!best) return null;
      used.add(best.i); distance += best.d;
    }
    return { distance };
  }
  // Every item comes from an actual City record. Approximate matches are labelled
  // as suggestions, never asserted to be the address the user intended.
  function suggest(records, raw, limit = 8) {
    const q = parseQuery(raw);
    if (!Array.isArray(records) || !records.length || (!q.number && !q.street)) return { kind: 'none', items: [] };
    const streets = [...new Set(records.map((r) => r.street))];
    const scored = streets.map((street) => ({ street, match: streetMatch(q.street, street) })).filter((s) => s.match);
    scored.sort((a, b) => a.match.distance - b.match.distance || a.street.localeCompare(b.street));
    if (!q.number) {
      if (!scored.length) return { kind: 'none', items: [] };
      const exact = scored.filter((s) => s.match.distance === 0), selected = exact.length ? exact : scored.filter((s) => s.match.distance === scored[0].match.distance);
      return { kind: 'streets', approximate: !exact.length, items: selected.slice(0, limit).map((s) => ({ street: s.street, label: titleStreet(s.street) })) };
    }
    const streetScores = new Map(scored.map((s) => [s.street, s.match.distance]));
    const match = records.filter((r) => r.number.startsWith(q.number) && streetScores.get(r.street) === 0)
      .sort((a, b) => (a.number === q.number ? 0 : 1) - (b.number === q.number ? 0 : 1) || a.number.length - b.number.length || +a.number - +b.number || a.street.localeCompare(b.street));
    if (match.length) return { kind: 'match', items: match.slice(0, limit) };
    const guesses = records.filter((r) => streetScores.has(r.street)).map((r) => ({ r, s: streetScores.get(r.street), d: r.number.startsWith(q.number) ? 0 : editDistance(q.number, r.number), p: sharedPrefix(q.number, r.number), gap: Math.abs(+r.number - +q.number) }))
      .filter((r) => r.d <= Math.max(1, Math.floor(q.number.length / 2)))
      .sort((a, b) => a.d - b.d || a.s - b.s || b.p - a.p || a.gap - b.gap || a.r.street.localeCompare(b.r.street)).slice(0, Math.min(limit, 4)).map((x) => x.r);
    return { kind: guesses.length ? 'guess' : 'none', items: guesses };
  }
  function suggestionKey(option) {
    return normalizeStreet((option.candidate?.label || option.label || option.street || '').replace(/, Vancouver, BC$/i, ''));
  }
  function exactSuggestion(option, raw) {
    if (option.approximate) return false;
    const q = parseQuery(raw), r = parseQuery(option.street || option.candidate?.label || option.label);
    return (!q.number || r.number.startsWith(q.number)) && streetMatch(q.street, r.street)?.distance === 0;
  }
  function mergeSuggestions(local, remote, raw, limit = 8) {
    const q = parseQuery(raw), seen = new Set();
    return [...local, ...remote].map((option, order) => ({ option, order, exact: exactSuggestion(option, raw), number: parseQuery(option.candidate?.label || option.label).number }))
      .sort((a, b) => Number(b.exact) - Number(a.exact) || (q.number ? Number(b.number === q.number) - Number(a.number === q.number) : 0) || a.order - b.order)
      .filter(({ option }) => { const key = suggestionKey(option); if (seen.has(key)) return false; seen.add(key); return true; }).slice(0, limit).map(({ option }) => option);
  }
  // Debounce, abort and bound the cache independently of the UI. Failed requests
  // are not cached, so revisiting a query can recover after a network interruption.
  function createSuggestionLookup({ fetch: fetcher, schedule = setTimeout, unschedule = clearTimeout, makeController = () => new AbortController(), delay = 320, timeout = 8000, now = Date.now } = {}) {
    let revision = 0, timer = null, deadline = null, controller = null;
    const cache = new Map();
    function cancel() { revision++; unschedule(timer); unschedule(deadline); timer = deadline = null; controller?.abort(); controller = null; }
    function search(raw, update) {
      cancel();
      const query = String(raw || '').trim(), key = query.toLowerCase().replace(/\s+/g, ' '), mine = revision;
      if (query.length < 3 || query.length > 180) { update({ state: 'short' }); return; }
      const hit = cache.get(key);
      if (hit && now() - hit.at < 300000) { update({ state: 'ready', data: hit.data }); return; }
      update({ state: 'loading' });
      timer = schedule(async () => {
        timer = null; controller = makeController(); const current = controller; let settled = false;
        function finish(result) { if (settled || mine !== revision) return; settled = true; unschedule(deadline); deadline = null; controller = null; update(result); }
        deadline = schedule(() => { current.abort(); finish({ state: 'error', reason: 'timeout' }); }, timeout);
        try {
          const response = await fetcher(searchUrl(query, true), { signal: current.signal });
          if (!response.ok) throw new Error('HTTP ' + response.status);
          const data = await response.json();
          if (mine !== revision || settled) return;
          if (!data || data.type !== 'FeatureCollection' || !Array.isArray(data.features)) throw new Error('Invalid geocoder response');
          cache.delete(key); cache.set(key, { data, at: now() });
          if (cache.size > 40) cache.delete(cache.keys().next().value);
          finish({ state: 'ready', data });
        } catch (_) { finish({ state: 'error', reason: 'network' }); }
      }, delay);
    }
    return { search, cancel };
  }
  const API = { DOWNTOWN, withinDowntown, withinModel, searchUrl, candidates, roofAvailableAt, cityUrl, cityRecords, parseQuery, normalizeStreet, suggest, addressLabel, editDistance, streetMatch, suggestionKey, exactSuggestion, mergeSuggestions, createSuggestionLookup };
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
    if (candidate.kind === 'area') { setStatus(`${candidate.label} is marked on the plan as a street or intersection reference. Add a street number for an address, or click the plan to place your site.`, 'success'); return; }
    setStatus(X.state?.site ? `${candidate.label} is marked on the plan. Your site has not moved: click the plan to move it, or choose “Place site here”.` : `${candidate.label} is marked on the plan. Click open ground near it to place your site, or choose “Place site here”.`, 'success');
  }
  function renderResults(items) {
    results.replaceChildren();
    for (const item of items) {
      const li = root.document.createElement('li');
      li.className = 'address-result';
      const heading = root.document.createElement('strong'); heading.textContent = item.label; li.appendChild(heading);
      const note = root.document.createElement('span'); note.className = 'address-result-note';
      note.textContent = item.kind === 'area' ? 'Street or intersection reference (BC Address Geocoder)' : item.descriptor === 'cityAddress' ? 'City of Vancouver civic address point' : item.descriptor === 'parcelPoint' ? 'Parcel reference point (BC Address Geocoder)' : 'Address reference point (BC Address Geocoder)';
      li.appendChild(note);
      const actions = root.document.createElement('div'); actions.className = 'address-result-actions';
      const locateButton = root.document.createElement('button'); locateButton.type = 'button'; locateButton.className = 'btn'; locateButton.textContent = item.kind === 'area' ? 'Zoom to location' : 'Zoom to address';
      locateButton.addEventListener('click', () => locate(item)); actions.appendChild(locateButton);
      // The search lives in the Site step: it can place the site point explicitly, never a roof observer.
      if (item.kind !== 'area' && X.assets.ready && X.landZAt(item.x, item.y) !== null) {
        const siteButton = root.document.createElement('button'); siteButton.type = 'button'; siteButton.className = 'btn primary'; siteButton.textContent = 'Place site here';
        siteButton.addEventListener('click', () => {
          if (X.placeSite(item.x, item.y)) { X.state.flow.alt.place = 'spot'; X.focusSite(); X.refreshPanels(); setStatus(`Site point placed at the address point for ${item.label}. It is an address reference, not a parcel boundary.`, 'success'); X.setHint?.(`Site placed at ${item.label}. Choose Proceed to Build when ready.`); }
          else setStatus('No modelled land at this address point. Click open ground nearby instead.', 'warning');
        });
        actions.appendChild(siteButton);
      }
      li.appendChild(actions); results.appendChild(li);
    }
  }
  // City records make the first response immediate; live lookup also runs for
  // street names, incomplete addresses and names absent from the City parcel list.
  const list = $('address-suggest'), submit = $('address-submit');
  if (!list || !submit) return;
  let records = null, loading = null, cityFailed = false, retryAt = 0;
  let options = [], active = -1, suggestTimer = null, blurTimer = null, dismissed = false, composing = false;
  let currentRaw = '', remoteItems = [], remoteState = 'idle', remoteReason = '';
  const lookup = createSuggestionLookup({ fetch: (...args) => root.fetch(...args) });
  function loadRecords() {
    if (records) return Promise.resolve(records);
    if (loading) return loading;
    if (Date.now() < retryAt) return Promise.resolve([]);
    const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 10000);
    loading = root.fetch(cityUrl(), { signal: abort.signal }).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then((rows) => { if (!Array.isArray(rows)) throw new Error('Invalid City address data'); records = cityRecords(rows); cityFailed = false; return records; })
      .catch(() => { cityFailed = true; retryAt = Date.now() + 30000; return []; })
      .finally(() => { clearTimeout(timer); loading = null; if (input.value.trim() && root.document.activeElement === input && !dismissed) paintSuggestions(); });
    return loading;
  }
  function toCandidate(rec) {
    const xy = Geo.lonLatToModel(rec.lon, rec.lat), extent = X.assets.manifest?.extent_m?.scene_bbox;
    if (!xy || !withinModel(xy.x, xy.y, extent)) return null;
    return { label: addressLabel(rec), x: xy.x, y: xy.y, lon: rec.lon, lat: rec.lat, descriptor: 'cityAddress', source: 'city', kind: 'address' };
  }
  function localOptions(raw) {
    const found = suggest(records || [], raw);
    return found.items.map((item) => found.kind === 'streets' ? { label: item.label, street: item.street, approximate: found.approximate, note: 'Street · add a number' }
      : { label: addressLabel(item), candidate: toCandidate(item), approximate: found.kind === 'guess', note: found.kind === 'guess' ? 'Similar address' : 'City address' }).filter((o) => o.street || o.candidate);
  }
  function closeList() { list.classList.add('hidden'); list.replaceChildren(); options = []; active = -1; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); }
  function highlight(i) {
    active = i; options.forEach((o, k) => o.el.setAttribute('aria-selected', String(k === i)));
    if (i >= 0) { input.setAttribute('aria-activedescendant', options[i].el.id); options[i].el.scrollIntoView({ block: 'nearest' }); }
    else input.removeAttribute('aria-activedescendant');
  }
  function stopSuggestions() { clearTimeout(suggestTimer); lookup.cancel(); closeList(); }
  async function choose(option) {
    dismissed = true; stopSuggestions(); cancelPending(); submit.disabled = false;
    if (option.street) {
      input.value = titleStreet(option.street) + ' '; input.focus();
      setStatus('Add a street number before ' + titleStreet(option.street) + ', or keep typing to refine the search.', 'info'); return;
    }
    const candidate = option.candidate;
    if (!candidate) return;
    input.value = candidate.label;
    const mine = requestId;
    if (!X.assets.ready) { setStatus('Waiting for the model to finish loading…', 'loading'); await X.ready; }
    if (mine !== requestId || input.value !== candidate.label) return;
    renderResults([candidate]); locate(candidate);
  }
  function showList(title, items) {
    const previous = active >= 0 ? suggestionKey(options[active]) : null;
    list.replaceChildren(); options = [];
    if (title) { const heading = root.document.createElement('li'); heading.className = 'address-suggest-title'; heading.setAttribute('role', 'presentation'); heading.textContent = title; list.appendChild(heading); }
    items.forEach((option, i) => {
      const li = root.document.createElement('li'); li.id = 'address-opt-' + i; li.setAttribute('role', 'option'); li.className = 'address-suggest-item';
      const label = root.document.createElement('span'); label.textContent = option.label; li.appendChild(label);
      if (option.note) { const note = root.document.createElement('small'); note.textContent = option.note; li.appendChild(note); }
      li.addEventListener('mousedown', (event) => event.preventDefault());
      li.addEventListener('click', () => choose(option));
      list.appendChild(li); options.push({ ...option, el: li });
    });
    const open = !!(items.length || title); list.classList.toggle('hidden', !open); input.setAttribute('aria-expanded', String(open));
    const kept = previous === null ? -1 : options.findIndex((option) => suggestionKey(option) === previous);
    highlight(kept >= 0 ? kept : items.length && exactSuggestion(items[0], currentRaw) ? 0 : -1);
  }
  function paintSuggestions() {
    if (dismissed || composing || root.document.activeElement !== input || !input.value.trim() || input.value.trim() !== currentRaw) return;
    const items = mergeSuggestions(localOptions(currentRaw), remoteItems, currentRaw);
    if (items.length) {
      showList(items.some((o) => exactSuggestion(o, currentRaw)) ? null : 'Suggested matches', items);
      setStatus(remoteState === 'error' ? 'Showing available suggestions. Live lookup is unavailable; check your connection to search more.'
        : `${items.length} suggestion${items.length === 1 ? '' : 's'}. Use ↑ and ↓, then Enter to choose.`, remoteState === 'error' ? 'warning' : 'ready');
    } else if (!X.assets.ready) { showList('Waiting for the model…', []); setStatus('Waiting for the model to finish loading before showing address locations…', 'loading'); }
    else if (remoteState === 'loading' || loading) { showList('Searching downtown addresses…', []); setStatus('Searching downtown Vancouver addresses…', 'loading'); }
    else if (remoteState === 'error') {
      showList('Live lookup is unavailable', []);
      setStatus(remoteReason === 'timeout' ? 'Live address lookup timed out. Try Search again.' : 'Live address lookup is unavailable. Check your connection and try Search.', 'warning');
    } else if (currentRaw.length < 3) {
      closeList(); setStatus(cityFailed ? 'City suggestions are unavailable. Keep typing; live lookup starts after 3 characters.' : 'Keep typing a street name or number; live lookup starts after 3 characters.', 'info');
    } else {
      showList('No downtown match found', []);
      setStatus('No matching address or street was found in the downtown model. Check the spelling, or choose a point on the plan.', 'warning');
    }
  }
  function refreshSuggestions() {
    if (dismissed || composing) return;
    currentRaw = input.value.trim(); remoteItems = []; remoteState = 'idle'; remoteReason = '';
    if (!currentRaw) { lookup.cancel(); closeList(); return; }
    if (currentRaw.length > 180) { lookup.cancel(); closeList(); setStatus('Please use a shorter street address.', 'warning'); return; }
    loadRecords();
    const raw = currentRaw;
    lookup.search(raw, (update) => {
      if (input.value.trim() !== raw || dismissed || root.document.activeElement !== input) return;
      remoteState = update.state; remoteReason = update.reason || '';
      remoteItems = update.data ? candidates(update.data, Geo.lonLatToModel, X.assets.manifest?.extent_m?.scene_bbox, true).map((candidate) => ({
        label: candidate.label.replace(/, Vancouver, BC$/i, ''), candidate: { ...candidate, source: 'geocoder' },
        note: candidate.kind === 'area' ? 'Street / intersection' : 'BC address'
      })) : [];
      paintSuggestions();
    });
    paintSuggestions();
  }
  function queueSuggestions() {
    dismissed = false; cancelPending(); stopSuggestions(); results.replaceChildren(); submit.disabled = false;
    if (!input.value.trim()) { currentRaw = ''; setStatus('Type a downtown street name or address.', 'info'); return; }
    suggestTimer = setTimeout(refreshSuggestions, 75);
  }
  // Study changes can reset the DOM without producing an input event. Invalidate
  // both request tracks so a response from the previous study cannot restore it.
  root.addEventListener('vista:clear-address', () => {
    dismissed = true; composing = false; cancelPending(); stopSuggestions(); clearTimeout(blurTimer);
    currentRaw = ''; remoteItems = []; remoteState = 'idle'; remoteReason = '';
    input.value = ''; results.replaceChildren(); submit.disabled = false;
    setStatus('Type a downtown street name or address.', 'info');
  });
  input.setAttribute('role', 'combobox'); input.setAttribute('aria-autocomplete', 'list'); input.setAttribute('aria-controls', 'address-suggest'); input.setAttribute('aria-expanded', 'false');
  input.addEventListener('focus', () => { dismissed = false; clearTimeout(blurTimer); loadRecords(); if (input.value.trim()) refreshSuggestions(); });
  input.addEventListener('input', (event) => { if (!composing && !event.isComposing) queueSuggestions(); });
  input.addEventListener('compositionstart', () => { composing = true; cancelPending(); stopSuggestions(); results.replaceChildren(); submit.disabled = false; });
  input.addEventListener('compositionend', () => { if (!composing) return; composing = false; queueSuggestions(); });
  input.addEventListener('keydown', (event) => {
    if (event.isComposing || composing) return;
    if (event.key === 'Escape') { event.preventDefault(); dismissed = true; stopSuggestions(); setStatus('Suggestions closed. Keep typing to search again.', 'info'); return; }
    if (list.classList.contains('hidden') || !options.length) return;
    if (event.key === 'ArrowDown') { event.preventDefault(); highlight(active < 0 ? 0 : (active + 1) % options.length); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); highlight(active < 0 ? options.length - 1 : (active - 1 + options.length) % options.length); }
    else if (event.key === 'Enter' && active >= 0) { event.preventDefault(); choose(options[active]); }
  });
  input.addEventListener('blur', () => { lookup.cancel(); clearTimeout(suggestTimer); blurTimer = setTimeout(closeList, 120); });
  // Local records can arrive before the model. Re-evaluate coordinates once the
  // model is ready, without issuing another geocoder request.
  Promise.resolve(X.ready).then(() => { if (input.value.trim() && !dismissed) refreshSuggestions(); }).catch(() => {});
  form.addEventListener('submit', async event => {
    event.preventDefault();
    dismissed = true; stopSuggestions(); cancelPending(); results.replaceChildren();
    const query = input.value.trim();
    if (!query) { setStatus('Type a downtown street name or address.', 'warning'); return; }
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
      if (!found.length) { dismissed = false; input.focus(); refreshSuggestions(); return; }
      setStatus(found.length ? `${found.length} downtown address match${found.length === 1 ? '' : 'es'}. Select one to locate the model area.`
        : 'No matching civic address was found inside the downtown model. Check the street number and name.', found.length ? 'ready' : 'warning');
    } catch (error) {
      if (mine !== requestId) return;
      const local = localOptions(query).filter((o) => o.candidate && !o.approximate).map((o) => o.candidate);
      if (local.length) { renderResults(local); setStatus('Showing City address matches. Live lookup is unavailable; check your connection to search more.', 'warning'); }
      else setStatus(error?.name === 'AbortError' ? 'Address search timed out. Try again.' : 'Address lookup is unavailable. Check your connection and try again.', 'error');
    } finally {
      if (mine === requestId) { controller = null; $('address-submit').disabled = false; }
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
