(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ViewCertainty = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const text = value => typeof value === 'string' && value.trim().length > 0;
  const list = value => Array.isArray(value) ? value : [];
  const sourceRecord = value => value && typeof value === 'object' && text(value.source) && text(value.reference) && validDate(value.date);
  function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const time = Date.parse(value + 'T00:00:00Z');
    return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
  }
  function classify(options) {
    const o = options || {}, envelope = o.envelope, reasons = [];
    const add = reason => { if (!reasons.includes(reason)) reasons.push(reason); };
    const coverage = envelope && envelope.coverage;
    const mathStatus = envelope && (envelope.mathematicalStatus || envelope.status);
    const areaReady = coverage && finite(coverage.parcelAreaM2) && coverage.parcelAreaM2 > 0 &&
      [coverage.ceilingAreaM2, coverage.unresolvedAreaM2, coverage.outsideAreaM2].every(value => finite(value) && value >= 0);
    const areaTolerance = areaReady ? Math.max(1e-8, coverage.parcelAreaM2 * 1e-7) : 0;
    const complete = areaReady && ['ready', 'outside'].includes(mathStatus) &&
      coverage.unresolvedAreaM2 <= areaTolerance &&
      Math.abs(coverage.ceilingAreaM2 + coverage.outsideAreaM2 - coverage.parcelAreaM2) <= areaTolerance &&
      Array.isArray(envelope.missingViews) && !envelope.missingViews.length &&
      Array.isArray(envelope.overlappingViews) &&
      (!Array.isArray(envelope.unresolvedPatches) || envelope.unresolvedPatches.length === 0);
    if (!complete) add('Whole-footprint surface and corridor coverage is unresolved.');
    if (envelope?.coordinateCompatible !== true || !finite(envelope?.datumOffsetM)) add('Calculated geometry lacks a compatible model-to-source datum alignment.');

    // Include every affecting view, including surfaces that never win the local
    // minimum. A lower-looking valid surface cannot hide an assumption or gap.
    const ids = new Set();
    for (const view of list(envelope?.overlappingViews)) ids.add(String(view));
    for (const patch of list(envelope?.patches)) {
      if (!patch || typeof patch !== 'object') { add('Envelope patch metadata is invalid.'); continue; }
      if (patch.view !== undefined && patch.view !== null) ids.add(String(patch.view));
      for (const view of list(patch.activeViews)) ids.add(String(view));
    }
    const getPlane = id => o.planes instanceof Map ? o.planes.get(id) ?? o.planes.get(Number(id)) : o.planes && o.planes[id];
    for (const id of ids) {
      const plane = getPlane(id);
      if (!plane || plane.basis !== 'reconstructed') add('View ' + id + ' uses an assumption or has no documented reconstruction.');
      if (!plane || !text(plane.source) || !text(plane.reference)) add('View ' + id + ' needs a reconstruction source and reference.');
    }
    const crs = o.coordinateSystem;
    if(crs?.surveyCompatible === false || o.georeference?.approximateDatumShift === true) add('Horizontal datum alignment is approximate; a documented survey transformation is required for Preliminary.');
    if (!crs || !text(crs.horizontal) || crs.units !== 'm' || !text(crs.verticalDatum) || crs.compatible !== true) {
      add('A named horizontal CRS in metres, named vertical datum and explicit coordinate compatibility are required.');
    }
    if (!sourceRecord(o.boundarySource)) add('A boundary source, document reference and date are required.');
    if (!sourceRecord(o.surveySource)) add('A survey/grade source, document reference and date are required.');
    for (const [name, record] of [['Boundary', o.boundarySource], ['Survey/grade', o.surveySource]]) {
      if (text(record?.horizontal) && text(crs?.horizontal) && record.horizontal.trim() !== crs.horizontal.trim()) add(name + ' horizontal CRS does not match the declared coordinate system.');
      if (text(record?.verticalDatum) && text(crs?.verticalDatum) && record.verticalDatum.trim() !== crs.verticalDatum.trim()) add(name + ' vertical datum does not match the declared coordinate system.');
    }
    const preliminaryReady = reasons.length === 0;
    const assessmentPresent = o.assessment !== undefined && o.assessment !== null;
    // No user-entered flag or uploaded metadata can attest its own authority.
    // This app has no independent City-document review workflow. Verification
    // remains locked even if a record claims matching geometry and residuals.
    const verificationMissingReasons = [assessmentPresent
      ? 'The supplied assessment is pending independent review; City verification is not supported by this workflow.'
      : 'No independently reviewed, property-specific City assessment is available.'];
    const stage = preliminaryReady ? 'preliminary' : 'study';
    return {
      stage, label: preliminaryReady ? 'Preliminary' : 'Study', preliminaryReady,
      verified: false, verification: assessmentPresent ? 'pending' : 'not-requested',
      method: preliminaryReady ? (ids.size ? 'reconstructed-whole-footprint-envelope' : 'whole-footprint-corridor-screening') : 'assumption-or-incomplete-study',
      missingReasons: reasons, verificationMissingReasons,
      affectingViews: [...ids],
      note: preliminaryReady
        ? 'Documented reconstruction and supplied boundary/grade metadata support a preliminary comparison; City permission is not established.'
        : 'Assumptions or missing evidence limit this result to a study.'
    };
  }
  return {classify};
});
