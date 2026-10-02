/* City of Vancouver 2022 orthophoto companion. The model remains the authority
   for roof and land picks; image pixels supply only a georeferenced XY. */
(function (root) {
  'use strict';
  const ORIGIN_LAT = 49.2827, ORIGIN_LON = -123.1207;
  const METRES_LON = 111320 * Math.cos(ORIGIN_LAT * Math.PI / 180);
  const METRES_LAT = 110574;
  const TILE_SIZE = 256, MIN_Z = 11, MAX_Z = 21;
  const TILE_URL = 'https://tiles.arcgis.com/tiles/qrcTTRTwUoS8N47o/arcgis/rest/services/Orthophotos_2022/MapServer/tile/';
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  function modelToLonLat(x, y) { return { lon: ORIGIN_LON + x / METRES_LON, lat: ORIGIN_LAT + y / METRES_LAT }; }
  function lonLatToModel(lon, lat) { return { x: (lon - ORIGIN_LON) * METRES_LON, y: (lat - ORIGIN_LAT) * METRES_LAT }; }
  function lonLatToWorld(lon, lat, zoom) {
    const world = TILE_SIZE * 2 ** zoom;
    const sin = Math.sin(clamp(lat, -85.05112878, 85.05112878) * Math.PI / 180);
    return { x: (lon + 180) / 360 * world, y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * world };
  }
  function worldToLonLat(x, y, zoom) {
    const world = TILE_SIZE * 2 ** zoom;
    return { lon: x / world * 360 - 180, lat: Math.atan(Math.sinh(Math.PI * (1 - 2 * y / world))) * 180 / Math.PI };
  }
  function pointAtScreen(px, py, center, zoom, width, height) {
    const ll = worldToLonLat(center.x + px - width / 2, center.y + py - height / 2, zoom);
    return lonLatToModel(ll.lon, ll.lat);
  }
  const Geo = { ORIGIN_LAT, ORIGIN_LON, MIN_Z, MAX_Z, modelToLonLat, lonLatToModel, lonLatToWorld, worldToLonLat, pointAtScreen };
  if (typeof module !== 'undefined' && module.exports) module.exports = Geo;
  if (!root.document) return;
  root.AerialContextGeo = Geo;

  const $ = id => root.document.getElementById(id);
  const dialog = $('aerial-dialog'), map = $('aerial-map');
  if (!dialog || !map || !$('btn-aerial')) return;
  const X = root.__explorer;
  if (!X) return;
  const tiles = $('aerial-tiles'), overlay = $('aerial-overlay'), status = $('aerial-status');
  const scaleLabel = $('aerial-scale-label'), scaleLine = $('aerial-scale-line');
  let zoom = 16;
  let center = lonLatToWorld(ORIGIN_LON, ORIGIN_LAT, zoom);
  let action = 'roof', pointer = null;
  const tileNodes = new Map();
  const SVG_NS = 'http://www.w3.org/2000/svg';

  function setStatus(message, kind) {
    status.textContent = message;
    status.dataset.kind = kind || 'info';
  }
  function dimensions() { const r = map.getBoundingClientRect(); return { width: r.width, height: r.height }; }
  function setCenterModel(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const ll = modelToLonLat(x, y);
    center = lonLatToWorld(ll.lon, ll.lat, zoom);
    render();
  }
  function cameraXY() {
    const cam = X.camera?.();
    const point = X.state.mode === 'observer' ? (X.state.observer ? [X.state.observer.x, X.state.observer.y] : cam?.eye)
      : cam?.target || X.state.cams.overview.target;
    return point && Number.isFinite(point[0]) && Number.isFinite(point[1]) ? point : [0, 0];
  }
  function screenForModel(x, y, width, height) {
    const ll = modelToLonLat(x, y), p = lonLatToWorld(ll.lon, ll.lat, zoom);
    return [width / 2 + p.x - center.x, height / 2 + p.y - center.y];
  }
  function svgElement(name, attributes) {
    const node = root.document.createElementNS(SVG_NS, name);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
    return node;
  }
  function drawPolyline(points, kind, closed, width, height) {
    const screen = points.map(p => screenForModel(p[0], p[1], width, height));
    if (screen.length < (closed ? 3 : 2)) return;
    overlay.appendChild(svgElement(closed ? 'polygon' : 'polyline', {
      points: screen.map(p => p.join(',')).join(' '), class: 'aerial-' + kind
    }));
  }
  function marker(x, y, kind, width, height) {
    const p = screenForModel(x, y, width, height);
    overlay.appendChild(svgElement('circle', { cx: p[0], cy: p[1], r: kind === 'site' ? 8 : 7, class: 'aerial-marker-' + kind }));
  }
  function drawOverlay(width, height) {
    overlay.setAttribute('viewBox', `0 0 ${width} ${height}`);
    overlay.replaceChildren();
    if (!X.assets.ready) return;
    const s = X.state;
    if (s.boundary?.length) drawPolyline(s.boundary, 'boundary', true, width, height);
    if (s.site) marker(s.site.x, s.site.y, 'site', width, height);
    for (const part of X.proposalParts()) {
      const b = part.box;
      drawPolyline(part.footprint || [[b[0], b[1]], [b[3], b[1]], [b[3], b[4]], [b[0], b[4]]], 'proposal', true, width, height);
    }
    const proposal = X.proposalBox();
    if (s.observer && proposal) drawPolyline([[s.observer.x, s.observer.y], [proposal.cx, proposal.cy]], 'observer-link', false, width, height);
    if (s.observer) marker(s.observer.x, s.observer.y, 'observer', width, height);
  }
  function updateScale(width) {
    const lat = worldToLonLat(center.x, center.y, zoom).lat;
    const metresPerPixel = 156543.03392804097 * Math.cos(lat * Math.PI / 180) / 2 ** zoom;
    const target = Math.min(120, Math.max(60, width / 5)) * metresPerPixel;
    const magnitude = 10 ** Math.floor(Math.log10(target));
    const metres = [1, 2, 5, 10].map(n => n * magnitude).filter(n => n <= target).pop() || magnitude;
    scaleLine.style.width = `${metres / metresPerPixel}px`;
    scaleLabel.textContent = metres >= 1000 ? `${metres / 1000} km` : `${metres} m`;
  }
  function updateTileStatus() {
    const visible = [...tileNodes.values()];
    if (!visible.length) { setStatus('No aerial image tiles are available at this map position.', 'error'); return; }
    const loaded = visible.filter(img => img.dataset.state === 'loaded').length;
    const failed = visible.filter(img => img.dataset.state === 'failed').length;
    const pending = visible.length - loaded - failed;
    if (failed && !loaded && !pending) setStatus(root.navigator?.onLine === false
      ? 'Offline: no 2022 image tiles are cached for this area. Reconnect and retry. Model locations remain available in the main view.'
      : 'The 2022 aerial imagery could not load. Check your connection, then retry. Model locations remain available in the main view.', 'error');
    else if (failed) setStatus(`${failed} aerial image tile${failed === 1 ? '' : 's'} unavailable. Use the visible imagery with care.`, 'warning');
    else if (pending) setStatus(`Loading City of Vancouver 2022 aerial imagery… ${loaded}/${visible.length} tiles`, 'loading');
    else setStatus('2022 aerial photograph · model roof and land picks are checked separately.', 'ready');
  }
  function drawTiles(width, height) {
    const left = center.x - width / 2, top = center.y - height / 2;
    const minX = Math.floor(left / TILE_SIZE), maxX = Math.floor((left + width) / TILE_SIZE);
    const minY = Math.floor(top / TILE_SIZE), maxY = Math.floor((top + height) / TILE_SIZE);
    const count = 2 ** zoom, wanted = new Set();
    for (let ty = minY; ty <= maxY; ty++) for (let tx = minX; tx <= maxX; tx++) {
      if (ty < 0 || ty >= count) continue;
      const wrappedX = ((tx % count) + count) % count;
      const key = `${zoom}/${ty}/${wrappedX}`, positionKey = `${key}@${tx}`;
      wanted.add(positionKey);
      let img = tileNodes.get(positionKey);
      if (!img) {
        img = root.document.createElement('img');
        img.className = 'aerial-tile'; img.alt = ''; img.draggable = false;
        img.dataset.state = 'loading';
        img.addEventListener('load', () => { img.dataset.state = 'loaded'; updateTileStatus(); });
        img.addEventListener('error', () => { img.dataset.state = 'failed'; updateTileStatus(); });
        img.src = `${TILE_URL}${zoom}/${ty}/${wrappedX}`;
        tiles.appendChild(img); tileNodes.set(positionKey, img);
      }
      img.style.left = `${Math.round(tx * TILE_SIZE - left)}px`;
      img.style.top = `${Math.round(ty * TILE_SIZE - top)}px`;
    }
    for (const [key, img] of tileNodes) if (!wanted.has(key)) { img.remove(); tileNodes.delete(key); }
    updateTileStatus();
  }
  function render() {
    if (!dialog.open) return;
    const { width, height } = dimensions();
    if (width <= 0 || height <= 0) return;
    drawTiles(width, height); drawOverlay(width, height); updateScale(width);
  }
  function zoomAt(nextZoom, px, py) {
    nextZoom = clamp(nextZoom, MIN_Z, MAX_Z);
    if (nextZoom === zoom) return;
    const { width, height } = dimensions();
    const ll = worldToLonLat(center.x + px - width / 2, center.y + py - height / 2, zoom);
    zoom = nextZoom;
    const pivot = lonLatToWorld(ll.lon, ll.lat, zoom);
    center = { x: pivot.x - px + width / 2, y: pivot.y - py + height / 2 };
    render();
  }
  function chooseAt(px, py) {
    if (!X.assets.ready) { setStatus('The model is still loading. Wait for it before choosing a location.', 'warning'); return; }
    const { width, height } = dimensions();
    const worldX = center.x + px - width / 2, worldY = center.y + py - height / 2;
    const tx = Math.floor(worldX / TILE_SIZE), ty = Math.floor(worldY / TILE_SIZE), count = 2 ** zoom;
    const image = tileNodes.get(`${zoom}/${ty}/${((tx % count) + count) % count}@${tx}`);
    if (!image || image.dataset.state !== 'loaded') {
      setStatus('The aerial image at that point has not loaded. Retry imagery or choose a visible area.', 'warning');
      return;
    }
    const p = pointAtScreen(px, py, center, zoom, width, height);
    if (action === 'roof') {
      if (typeof X.placeRooftopAtXY !== 'function') { setStatus('Rooftop selection is unavailable in this version of the explorer.', 'error'); return; }
      if (X.placeRooftopAtXY(p.x, p.y)) { dialog.close(); return; }
      else setStatus('No modelled roof surface at that point. Try a different roof in the photograph.', 'warning');
    } else if (X.placeSite(p.x, p.y)) setStatus('Study site placed on modelled land. The photograph does not establish ownership or vacancy.', 'success');
    else setStatus('That point is water or outside modelled land. Choose a land point.', 'warning');
    drawOverlay(width, height);
  }
  function setAction(next) {
    action = next;
    $('aerial-action-roof').setAttribute('aria-pressed', String(next === 'roof'));
    $('aerial-action-site').setAttribute('aria-pressed', String(next === 'site'));
    map.style.cursor = next === 'roof' ? 'crosshair' : 'cell';
    $('aerial-action-hint').textContent = next === 'roof'
      ? 'Click a photographed roof to test the matching model roof. Drag to pan.'
      : 'Click land for a hypothetical site point. Drag to pan.';
  }
  function open() {
    if (dialog.open) return;
    dialog.showModal();
    $('btn-aerial').setAttribute('aria-expanded', 'true');
    const point = X.state.site ? [X.state.site.x, X.state.site.y] : cameraXY();
    setCenterModel(point[0], point[1]);
    X.ready.then(() => render()).catch(() => setStatus('Model data could not load. Reload the explorer to restore model picks.', 'error'));
    map.focus();
  }
  $('btn-aerial').addEventListener('click', () => dialog.open ? dialog.close() : open());
  $('aerial-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { $('btn-aerial').setAttribute('aria-expanded', 'false'); $('btn-aerial').focus(); });
  $('aerial-action-roof').addEventListener('click', () => setAction('roof'));
  $('aerial-action-site').addEventListener('click', () => setAction('site'));
  $('aerial-zoom-in').addEventListener('click', () => { const d = dimensions(); zoomAt(zoom + 1, d.width / 2, d.height / 2); });
  $('aerial-zoom-out').addEventListener('click', () => { const d = dimensions(); zoomAt(zoom - 1, d.width / 2, d.height / 2); });
  $('aerial-center-site').addEventListener('click', () => {
    const site = X.state.site;
    if (site) setCenterModel(site.x, site.y);
    else setStatus('Place a site point first, or use “Current view”.', 'warning');
  });
  $('aerial-center-current').addEventListener('click', () => { const p = cameraXY(); setCenterModel(p[0], p[1]); });
  $('aerial-retry').addEventListener('click', () => {
    for (const img of tileNodes.values()) img.remove();
    tileNodes.clear(); render();
  });
  map.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    pointer = { id: e.pointerId, x: e.clientX, y: e.clientY, lastX: e.clientX, lastY: e.clientY, moved: false };
    map.setPointerCapture(e.pointerId);
  });
  map.addEventListener('pointermove', e => {
    if (!pointer || pointer.id !== e.pointerId) return;
    const dx = e.clientX - pointer.lastX, dy = e.clientY - pointer.lastY;
    if (Math.hypot(e.clientX - pointer.x, e.clientY - pointer.y) > 4) pointer.moved = true;
    if (pointer.moved) { center.x -= dx; center.y -= dy; render(); }
    pointer.lastX = e.clientX; pointer.lastY = e.clientY;
  });
  map.addEventListener('pointerup', e => {
    if (!pointer || pointer.id !== e.pointerId) return;
    const moved = pointer.moved;
    pointer = null;
    if (!moved) {
      const r = map.getBoundingClientRect(); chooseAt(e.clientX - r.left, e.clientY - r.top);
    }
  });
  map.addEventListener('pointercancel', () => { pointer = null; });
  map.addEventListener('wheel', e => {
    e.preventDefault();
    const r = map.getBoundingClientRect(); zoomAt(zoom + (e.deltaY < 0 ? 1 : -1), e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });
  map.addEventListener('keydown', e => {
    const pan = { ArrowLeft: [-80, 0], ArrowRight: [80, 0], ArrowUp: [0, -80], ArrowDown: [0, 80] }[e.key];
    if (pan) { e.preventDefault(); center.x += pan[0]; center.y += pan[1]; render(); }
    else if (e.key === '+' || e.key === '=') { e.preventDefault(); const d = dimensions(); zoomAt(zoom + 1, d.width / 2, d.height / 2); }
    else if (e.key === '-') { e.preventDefault(); const d = dimensions(); zoomAt(zoom - 1, d.width / 2, d.height / 2); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); const d = dimensions(); chooseAt(d.width / 2, d.height / 2); }
  });
  if (root.ResizeObserver) new ResizeObserver(render).observe(map);
  setAction('roof');
  root.__aerialContext = {
    open, render, setCenterModel,
    openAtModel(x, y) { open(); setCenterModel(x, y); },
    get zoom() { return zoom; }, get center() { return { ...center }; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
