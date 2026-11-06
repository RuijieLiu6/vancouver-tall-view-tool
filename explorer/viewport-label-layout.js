/* Screen-space collision layout for labels drawn over the explorer viewport. */
(function (root) {
  'use strict';

  const RESERVED = [
    '.vp-toolbar > *', '#metrics', '.view-utilities', '#north-cue', '#view-caption',
    '#legend', '#observer-controls', '#viewpoint-navigation', '.imagine-city-view-navigation',
    '#inset-frame', '#inset-frame > .inset-legend', '#inset-frame > .inset-coverage', '#metrics-help',
    '#viewcone-panel', '#draw-prompt', '#map-scale', '#live-feedback', '#scene-status',
    '.viewport-bottom > *', '#site-placement-actions', '.observer-keyboard > div',
    '#plan-markers .pm-label', '#plan-markers .nm-dot', '#plan-markers .pm-eye',
    '#plan-markers .pm-addr-dot'
  ];

  function intersects(a, b) {
    return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  }

  function priority(item) {
    const cls = item.cls || '';
    if (item.priority != null) return item.priority;
    if (cls.includes('site-edge')) return 3;
    if (cls.includes('proposal') || cls === 'site' || cls.includes('plane') || cls.includes('cone') || cls.includes('origin') || cls.includes('observer')) return 4;
    if (cls.includes('street')) return 2;
    return 1;
  }

  function candidates(item, width, height) {
    const x = item.x, y = item.y;
    const gap = item.gap == null ? 7 : item.gap;
    // Candidate coordinates are label top-lefts relative to the viewport.
    const standard = [
      [x - width / 2, y - height - gap], [x + gap, y - height / 2],
      [x - width - gap, y - height / 2], [x - width / 2, y + gap],
      [x + gap, y - height - gap], [x - width - gap, y - height - gap],
      [x + gap, y + gap], [x - width - gap, y + gap]
    ];
    if (item.cls && item.cls.includes('dim')) return [[x + 5, y - height / 2], ...standard.filter((p, i) => i !== 1)];
    if (item.cls && item.cls.includes('site-edge')) {
      return [[x - width / 2, y - height - 3], [x + 5, y - height / 2], [x - width - 5, y - height / 2], [x - width / 2, y + 3]];
    }
    return standard;
  }

  function layout(items, width, height, reservedRects = []) {
    const accepted = [], hidden = [], positioned = [];
    const obstacles = reservedRects.filter(r => r && r.right > r.left && r.bottom > r.top);
    const ordered = items.map((item, index) => ({ item, index, rank: priority(item) }))
      .sort((a, b) => b.rank - a.rank || a.index - b.index);
    for (const { item, index } of ordered) {
      let placed = null;
      for (const [left, top] of candidates(item, item.width, item.height)) {
        // The proposal-height pill has a CSS leader pseudo-element extending 12 px to its left.
        const collisionBox = { left: left - (item.leaderLeft || 0), top, right: left + item.width, bottom: top + item.height };
        if (collisionBox.left < 0 || top < 0 || collisionBox.right > width || collisionBox.bottom > height) continue;
        if (obstacles.some(r => intersects(collisionBox, r)) || accepted.some(r => intersects(collisionBox, r))) continue;
        const box = collisionBox;
        placed = { ...item, left, top, box, index };
        break;
      }
      if (placed) { accepted.push(placed.box); positioned.push(placed); }
      else hidden.push(item.key);
    }
    positioned.sort((a, b) => a.index - b.index);
    return { positioned, hidden };
  }

  function reservedRects(container, viewportRect, options = {}) {
    if (!container || !container.ownerDocument) return [];
    const doc = container.ownerDocument;
    const rects = [];
    for (const selector of RESERVED) {
      if (options.excludeMarkers && selector.startsWith('#plan-markers')) continue;
      for (const el of doc.querySelectorAll(selector)) {
        if (!container.contains(el) || el.classList.contains('hidden') || el.hidden) continue;
        const style = root.getComputedStyle ? root.getComputedStyle(el) : null;
        if (style && (style.display === 'none' || style.visibility === 'hidden')) continue;
        const r = el.getBoundingClientRect();
        const left = Math.max(viewportRect.left, r.left), top = Math.max(viewportRect.top, r.top);
        const right = Math.min(viewportRect.right, r.right), bottom = Math.min(viewportRect.bottom, r.bottom);
        if (right > left && bottom > top) rects.push({ left: left - viewportRect.left, top: top - viewportRect.top, right: right - viewportRect.left, bottom: bottom - viewportRect.top });
      }
    }
    // The sidebar normally sits beside the viewport. Include it only when it actually covers the map.
    const panel = doc.querySelector('#panel');
    if (panel && !panel.classList.contains('collapsed')) {
      const r = panel.getBoundingClientRect();
      const left = Math.max(viewportRect.left, r.left), top = Math.max(viewportRect.top, r.top);
      const right = Math.min(viewportRect.right, r.right), bottom = Math.min(viewportRect.bottom, r.bottom);
      if (right > left && bottom > top) rects.push({ left: left - viewportRect.left, top: top - viewportRect.top, right: right - viewportRect.left, bottom: bottom - viewportRect.top });
    }
    return rects;
  }

  const api = { layout, reservedRects, priority };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ViewportLabelLayout = api;
})(typeof window !== 'undefined' ? window : globalThis);
