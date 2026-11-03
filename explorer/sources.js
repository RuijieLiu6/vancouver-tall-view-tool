/* Independent, lazy source reader. It never reads or changes study/model state. */
(function (root) {
  'use strict';
  const doc = root.document;
  if (!doc) return;
  const button = doc.getElementById('btn-sources');
  if (!button) return;
  const catalogueUrl = new URL('source-catalogue.json', doc.currentScript.src).href;
  let panel, reader, content, status, retry, title, returnFocus;
  let catalogue = null, pending = null, loadState = 'idle', errorMessage = '';
  let coveredLayout = null, priorLayoutInert = false;

  const text = value => typeof value === 'string' ? value.slice(0, 20000) : '';
  const list = value => Array.isArray(value) ? value.slice(0, 40) : [];
  function element(tag, className, value) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (value) node.textContent = value;
    return node;
  }
  function paragraph(parent, value, className) {
    if (text(value)) parent.appendChild(element('p', className || '', text(value)));
  }
  function links(parent, values) {
    const ul = element('ul', 'sources-links');
    for (const source of list(values)) {
      let url;
      try { url = new URL(source?.url); } catch (_) { continue; }
      if (url.protocol !== 'https:' || url.username || url.password) continue;
      const li = element('li');
      const a = element('a', '', text(source.title) || url.hostname);
      a.href = url.href; a.target = '_blank'; a.rel = 'noopener noreferrer';
      li.appendChild(a);
      li.appendChild(element('span', 'sources-link-domain', url.hostname));
      ul.appendChild(li);
    }
    if (ul.childElementCount) parent.appendChild(ul);
  }
  function updateCoveredLayout() {
    const covering = !!panel && !panel.hidden && !!root.matchMedia?.('(max-width: 650px)')?.matches;
    const layout = covering ? doc.querySelector('main.layout') : null;
    if (coveredLayout && coveredLayout !== layout) {
      coveredLayout.inert = priorLayoutInert;
      coveredLayout = null;
    }
    if (layout && !coveredLayout) {
      coveredLayout = layout;
      priorLayoutInert = layout.inert;
      layout.inert = true;
    }
  }
  function measureHeader() {
    updateCoveredLayout();
    if (!panel || panel.hidden) return;
    const bottom = doc.querySelector('.app-header')?.getBoundingClientRect().bottom || 0;
    panel.style.setProperty('--sources-header-bottom', Math.max(0, Math.round(bottom)) + 'px');
  }
  function ensure() {
    if (panel) return;
    panel = element('section', 'vista-sources'); panel.id = 'vista-sources'; panel.hidden = true;
    panel.setAttribute('role', 'region'); panel.setAttribute('aria-labelledby', 'sources-title');
    // Keep viewport walking and boundary completion out of the reading surface.
    // Native scrolling, disclosure activation, copying and Tab remain available.
    panel.addEventListener('keydown', event => {
      if (/^Arrow(Up|Down|Left|Right)$/.test(event.key) || /^[ijkl]$/i.test(event.key) || event.key === 'Enter' || event.key === 'Escape') event.stopPropagation();
    });
    const header = element('header', 'sources-header');
    title = element('h2', '', 'Sources'); title.id = 'sources-title'; title.tabIndex = -1;
    const closeButton = element('button', 'sources-close');
    closeButton.id = 'sources-close'; closeButton.type = 'button'; closeButton.setAttribute('aria-label', 'Close sources');
    const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', '22'); svg.setAttribute('height', '22');
    svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '1.6');
    svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('aria-hidden', 'true');
    const path = doc.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('d', 'M6 6l12 12M18 6L6 18');
    svg.appendChild(path); closeButton.appendChild(svg); closeButton.addEventListener('click', close);
    header.append(title, closeButton);
    reader = element('div', 'sources-reader'); reader.id = 'sources-reader';
    status = element('p', 'sources-status'); status.id = 'sources-status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    retry = element('button', 'sources-retry', 'Retry loading sources'); retry.id = 'sources-retry'; retry.type = 'button'; retry.hidden = true;
    retry.addEventListener('click', () => { load(); });
    content = element('article', 'sources-content'); content.id = 'sources-content';
    reader.append(status, retry, content); panel.append(header, reader); doc.body.appendChild(panel);
    if (root.ResizeObserver) new root.ResizeObserver(measureHeader).observe(doc.querySelector('.app-header') || button);
    root.addEventListener('resize', measureHeader);
  }
  function render(data) {
    const fragment = doc.createDocumentFragment();
    paragraph(fragment, data.intro, 'sources-intro');
    paragraph(fragment, text(data.updated) ? 'Research updated ' + text(data.updated) + '.' : '', 'sources-updated');
    const certainty = element('details', 'sources-certainty'); certainty.id = 'sources-certainty';
    certainty.appendChild(element('summary', '', 'Sourced, Study and Verified: what the labels mean'));
    const dl = element('dl');
    for (const [label, body] of [
      ['Sourced information', 'A public record or policy provides the cited value, boundary or condition. Its date and site-specific scope still apply.'],
      ['Preliminary calculation', 'A reconstructed envelope can support early design when the relevant geometry, survey and coordinate references are documented. It does not establish an approved maximum.'],
      ['Hypothetical scenario', 'Entered assumptions fill gaps for comparison. Vista labels these Study; an assumed ceiling or skyline benchmark is not a permitted building height.'],
      ['Verified result', 'An independently checked, property-specific assessment would be needed. This release does not label its calculated height envelopes Verified.']
    ]) { dl.append(element('dt', '', label), element('dd', '', body)); }
    certainty.appendChild(dl); fragment.appendChild(certainty);
    const methods = element('section'); methods.id = 'sources-methods';
    methods.appendChild(element('h3', '', 'Ways to reconstruct the height controls'));
    for (const [index, method] of list(data.methods).entries()) {
      if (!text(method?.title)) continue;
      const details = element('details', 'sources-method');
      details.id = 'sources-method-' + (text(method.id).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 70) || index);
      details.appendChild(element('summary', '', text(method.title)));
      const body = element('div', 'sources-method-body');
      paragraph(body, method.summary);
      const steps = element('ol');
      for (const step of list(method.steps)) if (text(step)) steps.appendChild(element('li', '', text(step)));
      if (steps.childElementCount) body.appendChild(steps);
      if (text(method.yields)) { body.appendChild(element('h4', '', 'What it provides')); paragraph(body, method.yields); }
      if (text(method.limits)) { body.appendChild(element('h4', '', 'Where it stops')); paragraph(body, method.limits); }
      links(body, method.sources); details.appendChild(body); methods.appendChild(details);
    }
    fragment.appendChild(methods);
    const workflow = element('section'); workflow.id = 'sources-workflow';
    workflow.appendChild(element('h3', '', 'From public records to a site envelope'));
    const ol = element('ol', 'sources-workflow');
    for (const item of list(data.workflow)) {
      if (!text(item?.title) && !text(item?.body)) continue;
      const li = element('li'); li.appendChild(element('strong', '', text(item.title))); paragraph(li, item.body); ol.appendChild(li);
    }
    workflow.appendChild(ol); fragment.appendChild(workflow);
    const example = data.workedExample;
    if (example && text(example.title)) {
      const section = element('section', 'sources-worked-example'); section.id = 'sources-worked-example';
      section.appendChild(element('h3', '', text(example.title))); paragraph(section, example.body);
      if (text(example.formula)) section.appendChild(element('pre', 'sources-formula', text(example.formula)));
      const inputs = element('dl', 'sources-example-inputs');
      for (const item of list(example.inputs)) {
        const row = element('div'); row.append(element('dt', '', text(item?.label)), element('dd', '', text(item?.value))); inputs.appendChild(row);
      }
      if (inputs.childElementCount) section.appendChild(inputs);
      paragraph(section, example.result); paragraph(section, example.limits); links(section, example.sources); fragment.appendChild(section);
    }
    content.replaceChildren(fragment);
  }
  function load() {
    ensure();
    if (catalogue) return Promise.resolve(catalogue);
    if (pending) return pending;
    loadState = 'loading'; errorMessage = ''; retry.hidden = true; status.hidden = false;
    status.textContent = 'Loading the public sources and research methods…'; content.setAttribute('aria-busy', 'true');
    const controller = new root.AbortController();
    const timer = root.setTimeout(() => controller.abort(), 12000);
    pending = (async () => {
      try {
        const response = await root.fetch(catalogueUrl, { signal: controller.signal, credentials: 'same-origin' });
        if (!response.ok) throw new Error('Source catalogue could not be retrieved.');
        if (Number(response.headers.get('content-length')) > 1000000) throw new Error('Source catalogue is unexpectedly large.');
        const raw = await response.text();
        if (raw.length > 1000000) throw new Error('Source catalogue is unexpectedly large.');
        const data = JSON.parse(raw);
        if (!data || !Array.isArray(data.methods) || !data.methods.length || !Array.isArray(data.workflow)) throw new Error('Source catalogue is incomplete.');
        render(data); catalogue = data; loadState = 'ready';
        status.textContent = 'Sources and methods loaded.'; status.hidden = true;
        return data;
      } catch (error) {
        loadState = 'error'; errorMessage = error?.name === 'AbortError' ? 'Loading the sources took too long.' : 'The sources could not be loaded.';
        status.textContent = errorMessage + ' Check your connection, then retry.'; retry.hidden = false;
        return null;
      } finally {
        root.clearTimeout(timer); content.setAttribute('aria-busy', 'false'); pending = null;
      }
    })();
    return pending;
  }
  function open() {
    ensure();
    if (panel.hidden) returnFocus = doc.activeElement;
    panel.hidden = false; button.setAttribute('aria-expanded', 'true'); measureHeader();
    title.focus({ preventScroll: true });
    return load();
  }
  function close() {
    if (!panel || panel.hidden) return;
    panel.hidden = true; button.setAttribute('aria-expanded', 'false');
    updateCoveredLayout();
    const focus = returnFocus?.isConnected && returnFocus !== doc.body ? returnFocus : button;
    focus.focus({ preventScroll: true });
  }
  button.addEventListener('click', () => { if (panel && !panel.hidden) close(); else open(); });
  doc.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !panel || panel.hidden || event.defaultPrevented || doc.querySelector('dialog[open]')) return;
    if (!panel.contains(doc.activeElement) && doc.activeElement !== button) return;
    event.preventDefault(); event.stopPropagation(); close();
  }, true);
  root.VistaSources = {
    open, close,
    getInfo: () => ({ open: !!panel && !panel.hidden, state: loadState, error: errorMessage, updated: catalogue?.updated || null, methodCount: catalogue?.methods?.length || 0, url: catalogueUrl })
  };
  if (new URLSearchParams(root.location.search).get('sources') === '1') open();
})(typeof window !== 'undefined' ? window : globalThis);
