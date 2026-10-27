(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.VistaUnits = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Proposal geometry, limits and saved block dimensions always use metres.
  const UNITS = Object.freeze({
    m: Object.freeze({ name: 'metres', symbol: 'm', metresPerUnit: 1, decimals: 2 }),
    ft: Object.freeze({ name: 'feet', symbol: 'ft', metresPerUnit: 0.3048, decimals: 2 }),
    mm: Object.freeze({ name: 'millimetres', symbol: 'mm', metresPerUnit: 0.001, decimals: 0 }),
  });
  const LIMITS = Object.freeze({
    h: Object.freeze({ min: 1, max: 400, step: 1 }),
    w: Object.freeze({ min: 1, max: 300, step: 1 }),
    d: Object.freeze({ min: 1, max: 300, step: 1 }),
    dx: Object.freeze({ min: -500, max: 500, step: 1 }),
    dy: Object.freeze({ min: -500, max: 500, step: 1 }),
  });

  function normalizeUnit(unit) { return Object.hasOwn(UNITS, unit) ? unit : 'm'; }
  function toMetres(value, unit) { return Number(value) * UNITS[normalizeUnit(unit)].metresPerUnit; }
  function fromMetres(value, unit) { return Number(value) / UNITS[normalizeUnit(unit)].metresPerUnit; }
  function alternateUnit(unit) { return normalizeUnit(unit) === 'ft' ? 'm' : 'ft'; }
  function inputValue(metres, unit) {
    const value = fromMetres(metres, unit);
    return Number.isFinite(value) ? String(Number(value.toPrecision(12))) : '';
  }
  function inputSpec(key, unit) {
    const limits = LIMITS[key];
    if (!limits) return null;
    // Match the visible endpoint precision so a converted boundary stays valid.
    return { min: Number(inputValue(limits.min, unit)), max: Number(inputValue(limits.max, unit)),
      step: Number(inputValue(limits.step, unit)) };
  }
  function readDimension(value, unit, key) {
    if (typeof value !== 'number' && typeof value !== 'string') return null;
    if (typeof value === 'string' && !value.trim()) return null;
    const displayed = Number(value), limits = LIMITS[key];
    if (!Number.isFinite(displayed) || !limits) return null;
    const metres = toMetres(displayed, unit);
    if (!Number.isFinite(metres)) return null;
    return Math.min(limits.max, Math.max(limits.min, metres));
  }
  function formatLength(metres, unit) {
    const selected = UNITS[normalizeUnit(unit)], value = fromMetres(metres, unit);
    if (!Number.isFinite(value)) return '—';
    return value.toLocaleString('en-CA', { maximumFractionDigits: selected.decimals }) + ' ' + selected.symbol;
  }
  function dualLength(metres, unit) {
    return formatLength(metres, unit) + ' · ≈ ' + formatLength(metres, alternateUnit(unit));
  }

  return Object.freeze({ UNITS, LIMITS, normalizeUnit, toMetres, fromMetres, alternateUnit,
    inputValue, inputSpec, readDimension, formatLength, dualLength });
});
