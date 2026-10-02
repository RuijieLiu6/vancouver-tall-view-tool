/* Landing intro: an abstract, looping isometric storyboard of the four-step flow
 * (site pin → stacked blocks → rooftop eye and view wedge → report), shown once per browser.
 * "How it works" reopens it. Skipped for self-test URLs and with ?intro=0; forced with ?intro=1.
 */
(function () {
  'use strict';
  const dialog = document.getElementById('intro'), stage = document.getElementById('intro-stage');
  if (!dialog || !stage) return;
  const KEY = 'vancouver-view-lab-intro-seen/1';
  const query = new URLSearchParams(location.search);

  // Isometric projection: plan x → down-right, plan y → down-left, z → up. Units are SVG pixels.
  const O = [250, 168], C30 = Math.cos(Math.PI / 6), S30 = 0.5;
  const iso = (x, y, z = 0) => [O[0] + (x - y) * C30, O[1] + (x + y) * S30 - z];
  const pts = (list) => list.map(p => iso(...p).map(v => v.toFixed(1)).join(',')).join(' ');
  const poly = (list, cls) => `<polygon class="${cls}" points="${pts(list)}"/>`;
  function box(x, y, w, d, h, z0, cls) {
    const t = z0 + h;
    return `<g class="${cls}">` +
      poly([[x + w, y, z0], [x + w, y + d, z0], [x + w, y + d, t], [x + w, y, t]], 'face-r') +
      poly([[x, y + d, z0], [x + w, y + d, z0], [x + w, y + d, t], [x, y + d, t]], 'face-l') +
      poly([[x, y, t], [x + w, y, t], [x + w, y + d, t], [x, y + d, t]], 'face-t') + '</g>';
  }
  const context = [
    [-118, -112, 40, 44, 34], [-62, -118, 34, 52, 58], [6, -120, 44, 30, 26], [64, -112, 42, 46, 42],
    [-120, -42, 36, 48, 46], [-118, 36, 44, 44, 22], [-52, 70, 46, 38, 30], [18, 76, 40, 36, 18],
    [64, 40, 40, 36, 22],
  ];
  const roof = [70, -44, 44, 40, 70];                      // building the observer stands on
  const site = [-34, -40, 60, 62];                         // study boundary (plan rectangle)
  const sc = [site[0] + site[2] / 2, site[1] + site[3] / 2]; // site centre
  const eye = iso(roof[0] + 20, roof[1] + 20, roof[4] + 9);
  const target = iso(sc[0], sc[1], 74);

  const plate = poly([[-140, -140, 0], [140, -140, 0], [140, 140, 0], [-140, 140, 0]], 'plate');
  let streets = '';
  for (const v of [-74, 50]) streets += `<path class="street" d="M${iso(v, -140).join(' ')} L${iso(v, 140).join(' ')}"/>`;
  for (const v of [-64, 24]) streets += `<path class="street" d="M${iso(-140, v).join(' ')} L${iso(140, v).join(' ')}"/>`;
  const water = poly([[-140, 112, 0], [140, 112, 0], [140, 140, 0], [-140, 140, 0]], 'water');

  // Draw context back-to-front (smaller x + y first); the site and roof building slot into the order.
  const items = context.map(b => ({ k: b[0] + b[2] / 2 + b[1] + b[3] / 2, svg: box(b[0], b[1], b[2], b[3], b[4], 0, 'ctx') }));
  items.push({ k: roof[0] + roof[2] / 2 + roof[1] + roof[3] / 2, svg: box(roof[0], roof[1], roof[2], roof[3], roof[4], 0, 'ctx roofbldg') });
  items.push({ k: sc[0] + sc[1], svg:
    `<g class="a a-site">${poly([[site[0], site[1], 0], [site[0] + site[2], site[1], 0], [site[0] + site[2], site[1] + site[3], 0], [site[0], site[1] + site[3], 0]], 'site')}</g>` +
    `<g class="a a-block1">${box(-26, -30, 44, 44, 48, 0, 'prop')}</g>` +
    `<g class="a a-block2">${box(-16, -20, 28, 28, 34, 48, 'prop')}</g>` +
    `<g class="a a-block3">${box(-8, -12, 14, 14, 20, 82, 'prop')}</g>` });
  items.sort((a, b) => a.k - b.k);

  const [px, py] = iso(sc[0], sc[1], 0);
  const pin = `<g class="a a-pin"><g transform="translate(${px.toFixed(1)} ${(py - 2).toFixed(1)})"><ellipse class="pin-shadow" cx="0" cy="2" rx="7" ry="3"/><path class="pin" d="M0 0 C-4 -9 -11 -14 -11 -22 A11 11 0 0 1 11 -22 C11 -14 4 -9 0 0Z"/><circle class="pin-dot" cx="0" cy="-22" r="4"/></g></g>`;
  const cursor = `<g class="a a-cursor"><g transform="translate(${(px + 8).toFixed(1)} ${(py - 30).toFixed(1)})"><path class="cursor" d="M0 0 L0 16 L4.5 12 L8 19 L11 17.5 L7.5 10.8 L13 10.8 Z"/></g></g>`;
  const ang = Math.atan2(target[1] - eye[1], target[0] - eye[0]), L = Math.hypot(target[0] - eye[0], target[1] - eye[1]) * 1.18, spread = 0.36;
  const w1 = [eye[0] + Math.cos(ang - spread) * L, eye[1] + Math.sin(ang - spread) * L], w2 = [eye[0] + Math.cos(ang + spread) * L, eye[1] + Math.sin(ang + spread) * L];
  const view = `<g class="a a-cone" style="transform-origin:${eye[0].toFixed(1)}px ${eye[1].toFixed(1)}px"><path class="wedge" d="M${eye.map(v => v.toFixed(1)).join(' ')} L${w1.map(v => v.toFixed(1)).join(' ')} L${w2.map(v => v.toFixed(1)).join(' ')} Z"/></g>` +
    `<g class="a a-sight"><path class="sight" d="M${eye.map(v => v.toFixed(1)).join(' ')} L${target.map(v => v.toFixed(1)).join(' ')}"/></g>` +
    `<g class="a a-eye"><g transform="translate(${eye[0].toFixed(1)} ${eye[1].toFixed(1)})"><path class="eye-pole" d="M0 0 V9"/><path class="eye-lid" d="M-10 0 Q0 -8 10 0 Q0 8 -10 0Z"/><circle class="eye-iris" r="3.4"/></g></g>`;
  const report = `<g class="a a-report"><g transform="translate(386 22)"><rect class="sheet" width="96" height="124" rx="5"/><rect class="sheet-img" x="10" y="12" width="76" height="40" rx="2"/>` +
    `<path class="sheet-mini" d="M18 44 l12 -10 l10 6 l14 -16 l18 20"/>` +
    [64, 76, 88].map((y, i) => `<path class="sheet-line l${i + 1}" d="M10 ${y} H${i === 2 ? 56 : 86}"/>`).join('') +
    `<g class="sheet-tick"><circle cx="76" cy="106" r="9"/><path d="M71.5 106 l3.2 3.4 l6 -6.4"/></g></g></g>`;
  stage.innerHTML = `<svg viewBox="0 0 500 300" class="intro-svg" aria-hidden="true" focusable="false">${plate}${water}${streets}${items.map(i => i.svg).join('')}${view}${pin}${cursor}${report}</svg>`;

  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (reduce) dialog.classList.add('still');
  const frame = parseFloat(query.get('introframe')); // freeze at a given second, for documentation screenshots
  if (Number.isFinite(frame)) { dialog.classList.add('frozen'); dialog.style.setProperty('--intro-delay', `-${Math.min(Math.max(frame, 0), 11.9)}s`); }

  function open() { if (dialog.open) return; try { dialog.showModal(); } catch (_) { dialog.setAttribute('open', ''); } dialog.classList.add('playing'); const t = document.getElementById('intro-title'); t?.focus({ preventScroll: true }); dialog.scrollTop = 0; }
  function close() { dialog.classList.remove('playing'); try { localStorage.setItem(KEY, '1'); } catch (_) { /* storage blocked */ } if (dialog.open) dialog.close(); else dialog.removeAttribute('open'); }
  document.getElementById('intro-start')?.addEventListener('click', close);
  dialog.addEventListener('cancel', () => { try { localStorage.setItem(KEY, '1'); } catch (_) { /* storage blocked */ } dialog.classList.remove('playing'); });
  dialog.addEventListener('click', (e) => { if (e.target === dialog) close(); });
  document.getElementById('btn-intro')?.addEventListener('click', open);

  const testing = ['selftest', 'workflowtest', 'studytest', 'surfacetest', 'rooftest', 'flowtest'].some(k => query.get(k) === '1');
  let seen = false; try { seen = localStorage.getItem(KEY) === '1'; } catch (_) { /* storage blocked */ }
  // Open only once the app stylesheet has loaded, so the intro never flashes unstyled over the loading map.
  function whenStyled(fn) { const link = [...document.querySelectorAll('link[rel="stylesheet"]')].find(l => /explorer\.css/.test(l.href));
    if (!link || link.sheet) { fn(); return; } link.addEventListener('load', fn, { once: true }); link.addEventListener('error', fn, { once: true }); }
  if (location.protocol !== 'file:' && !testing && query.get('intro') !== '0' && (query.get('intro') === '1' || !seen)) whenStyled(open);
  window.__intro = { open, close };
})();
