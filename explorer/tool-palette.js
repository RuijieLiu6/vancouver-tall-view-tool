/* A presentation layer over the existing Site workflow and its original controls. */
(function (root) {
  'use strict';
  const doc = root.document, X = root.__explorer;
  if (!doc || !X || root.VistaToolPalette) return;
  const byId = id => doc.getElementById(id);
  const section = doc.querySelector('.flow-stage[data-stage="site"]');
  const selector = byId('site-tool-selector'), disclosure = byId('btn-select-site-tool');
  const palette = byId('site-tool-palette'), current = byId('site-tool-current');
  const labels = { place: 'Place on map', neighbourhood: 'Neighbourhood', address: 'Search address', boundary: 'Draw boundary', replace: 'Replace building', multi: 'Select multiple' };
  const buttons = palette ? Array.from(palette.querySelectorAll('[data-site-tool]')) : [];
  // Do not retire the original chooser unless every replacement control is usable.
  if (!section || !selector || !disclosure || !palette || !current || buttons.length !== 6 ||
      !byId('address-query') || !byId('place-select') || !byId('btn-open-ground') ||
      !byId('btn-draw-site') || typeof X.chooseMethod !== 'function' || typeof X.flowGo !== 'function') return;
  let active = '', lastMethod, lastSite, lastDrawing = false, open = false;
  function expand(value) {
    open = value; palette.hidden = !value;
    disclosure.setAttribute('aria-expanded', String(value));
  }
  function indicate(tool) {
    active = tool; section.dataset.siteTool = tool;
    current.textContent = labels[tool] || '';
    buttons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.siteTool === tool)));
    const more = palette.querySelector('.site-more-tools');
    if (more && ['boundary', 'replace', 'multi'].includes(tool)) more.open = true;
  }
  function inferred() {
    const method = X.state.flow.methods.site;
    return method === 'point' ? (X.state.drawing || X.state.flow.alt?.place === 'boundary' ? 'boundary' : 'place') : method || '';
  }
  function sync() {
    const method = X.state.flow.methods.site, site = X.state.site;
    if (method !== lastMethod || (lastSite && !site && !method)) indicate(inferred());
    else if (X.state.drawing && !lastDrawing) indicate('boundary');
    lastMethod = method; lastSite = site; lastDrawing = !!X.state.drawing;
  }
  function ensureMethod(method) {
    if (X.state.flow.methods.site !== method || X.state.flow.choosing === 'site') return X.chooseMethod('site', method) !== false;
    return true;
  }
  function openTool(tool, options = {}) {
    if (!(tool in labels)) return false;
    if (root.VistaImagineCity?.getState?.().open) root.VistaImagineCity.close();
    if (X.state.flow.stage !== 'site' && X.flowGo('site', { force: true }) === false) return false;
    // Finding an area is navigation: it must not replace a study or cancel a drawing.
    const navigation = tool === 'address' || tool === 'neighbourhood';
    if (!navigation && !ensureMethod(tool === 'replace' || tool === 'multi' ? tool : 'point')) return false;
    if (navigation && !X.state.flow.methods.site && !ensureMethod('point')) return false;
    if (tool === 'place') byId('btn-open-ground').click();
    if (tool === 'boundary' && !X.state.drawing) byId('btn-draw-site').click();
    indicate(tool); lastMethod = X.state.flow.methods.site; lastSite = X.state.site; lastDrawing = !!X.state.drawing;
    expand(true);
    const panel = byId('panel');
    if (panel?.classList.contains('collapsed')) byId('btn-panel-toggle')?.click();
    if (tool === 'address' || tool === 'neighbourhood') {
      // The original flow folds Find after a placement. This tool explicitly reopens it.
      byId('site-find')?.classList.remove('collapsed');
      byId('btn-site-find-open')?.setAttribute('aria-expanded', 'true');
      const input = byId(tool === 'address' ? 'address-query' : 'place-select');
      input.focus({ preventScroll: true });
      input.scrollIntoView?.({ block: 'nearest' });
    } else if (options.focus !== false) {
      buttons.find(button => button.dataset.siteTool === tool)?.focus({ preventScroll: true });
    }
    return true;
  }
  disclosure.addEventListener('click', () => expand(!open));
  buttons.forEach(button => button.addEventListener('click', () => openTool(button.dataset.siteTool)));
  palette.addEventListener('keydown', event => {
    if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); expand(false); disclosure.focus(); }
  });
  // The existing address handler assumes the point method. Change methods only
  // when the person explicitly places the result, before that original handler runs.
  byId('address-results')?.addEventListener('click', event => {
    const button = event.target.closest?.('button');
    if (button && button.textContent.trim() === 'Place site here') {
      if (!ensureMethod('point')) { event.preventDefault(); event.stopPropagation(); return; }
      indicate('address'); lastMethod = X.state.flow.methods.site;
    }
  }, true);
  const header = doc.querySelector('.header-actions');
  let search = byId('btn-address-tool');
  if (header && !search) {
    search = doc.createElement('button'); search.id = 'btn-address-tool'; search.type = 'button';
    search.className = 'btn address-tool-shortcut';
    search.setAttribute('aria-label', 'Search a Vancouver address');
    search.setAttribute('aria-controls', 'address-search-form');
    search.title = 'Search a Vancouver address';
    search.innerHTML = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/></svg>';
    header.insertBefore(search, header.firstChild);
  }
  search?.addEventListener('click', () => openTool('address'));
  // Keep the existing cards' explanations available without making every tool a paragraph.
  doc.querySelectorAll('.method-chooser[data-chooser="build"], .method-chooser[data-chooser="view"]').forEach(chooser => {
    const cards = Array.from(chooser.querySelectorAll('.method-card'));
    if (!cards.length) return;
    const guide = doc.createElement('details'); guide.className = 'tool-method-guide';
    const summary = doc.createElement('summary'); summary.textContent = 'About these tools'; guide.appendChild(summary);
    cards.forEach(card => {
      const title = card.querySelector('b'), description = card.querySelector('span');
      if (!title || !description) return;
      const text = doc.createElement('p'), name = doc.createElement('b'); name.textContent = title.textContent + '. ';
      text.appendChild(name); text.appendChild(doc.createTextNode(description.textContent)); guide.appendChild(text);
    });
    chooser.appendChild(guide); chooser.classList.add('tool-methods-compact');
  });
  // Preserve the original example buttons and the handlers already bound to them.
  const examples = section.querySelector('.example-link');
  if (examples) {
    const details = doc.createElement('details'); details.className = 'site-tool-examples';
    const summary = doc.createElement('summary'); summary.textContent = 'Real tower examples';
    details.appendChild(summary); details.appendChild(examples); palette.appendChild(details);
  }
  sync(); selector.hidden = false;
  byId('btn-open-ground').textContent = 'Pick another point';
  doc.body.classList.add('tool-palette-ready');
  // Refreshes, restored studies and original map tools remain authoritative.
  if (root.MutationObserver) new root.MutationObserver(sync).observe(byId('panel') || section, {
    subtree: true, attributes: true, attributeFilter: ['class']
  });
  root.VistaToolPalette = { open: openTool, refresh: sync, getState: () => ({ active, expanded: open }) };
})(window);
