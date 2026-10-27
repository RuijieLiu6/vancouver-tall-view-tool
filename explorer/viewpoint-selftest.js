/* Main viewport Previous / Next regression. ?viewpointtest=1 */
(async function () {
'use strict';
const X = window.__explorer, $ = id => document.getElementById(id), tests = [];
const check = (name, pass) => tests.push({ name, pass: !!pass });
let original = null, cones = null;
try {
  await X.ready; original = X.serializeHash(); cones = X.assets.cones;
  X.applyHash('#style=context&site=-216.123,338.145&parts=120,30,30,0,0,Tower&mode=inspect&flow=build&fm=point,platform,');
  X.flowGo('view'); X.chooseMethod('view', 'street');
  $('street-nearby').querySelector('button').click();
  let current = X.viewpointNavigationState();
  check('street observer shows the available nearby street choices', current.source === 'street' && current.choices.length > 1 && !$('viewpoint-navigation').classList.contains('hidden') && $('viewpoint-position').textContent.includes('Nearby streets'));
  check('previous and next have explicit accessible names', $('btn-viewpoint-prev').getAttribute('aria-label') === 'Previous viewpoint' && $('btn-viewpoint-next').getAttribute('aria-label') === 'Next viewpoint');
  const parts = JSON.stringify(X.state.parts), style = X.state.sceneStyle, geometry = X.buildingsPositionsChecksum(), streetStart = { ...X.state.observer }, streetCount = current.choices.length;
  $('btn-viewpoint-next').click(); current = X.viewpointNavigationState();
  check('next enters the next offered street and updates its position', current.index === 1 && X.state.mode === 'observer' && Math.hypot(X.state.observer.x - streetStart.x, X.state.observer.y - streetStart.y) > 1 && $('viewpoint-position').textContent.includes('2 / ' + streetCount));
  $('btn-viewpoint-prev').click();
  check('previous returns to the original street choice', Math.hypot(X.state.observer.x - streetStart.x, X.state.observer.y - streetStart.y) < 0.1);
  for (let i = 0; i < streetCount; i++) X.stepViewpoint(1);
  check('street choices wrap around', Math.hypot(X.state.observer.x - streetStart.x, X.state.observer.y - streetStart.y) < 0.1);
  check('cycling preserves proposal, scene style and model geometry', JSON.stringify(X.state.parts) === parts && X.state.sceneStyle === style && X.buildingsPositionsChecksum() === geometry);
  X.chooseMethod('view', 'roof'); $('rooftop-nearby').querySelector('button').click();
  current = X.viewpointNavigationState(); const roofStart = { ...X.state.observer.building };
  check('roof observer offers the same nearby buildings as View', current.source === 'rooftop' && current.choices.length > 1 && $('viewpoint-position').textContent.includes('Nearby roofs'));
  X.stepViewpoint(1);
  check('next rooftop changes buildings and stays in observer mode', X.state.mode === 'observer' && X.state.observerSource === 'rooftop' && (X.state.observer.building.index !== roofStart.index || X.state.observer.building.source !== roofStart.source));
  X.stepViewpoint(-1);
  check('previous rooftop returns to the chosen building', X.state.observer.building.index === roofStart.index && X.state.observer.building.source === roofStart.source);
  const removed = X.state.removed;
  X.state.removed = [...removed, { index: roofStart.index, ext: roofStart.source === 'extension', id: roofStart.id }];
  check('demolished roofs are excluded from navigation', !X.viewpointNavigationState().choices.some(q => q.index === roofStart.index && q.ext === (roofStart.source === 'extension')));
  X.state.removed = removed;
  let farRoof = null;
  for (const ext of [false, true]) {
    const catalogue = ext ? X.assets.extIndex : X.assets.index;
    if (!catalogue) continue;
    for (let index = 0; index < catalogue.columns.bbox.length; index++) {
      const box = catalogue.columns.bbox[index], distance = Math.hypot((box[0] + box[3]) / 2 - X.state.site.x, (box[1] + box[4]) / 2 - X.state.site.y);
      if (distance < 700 || distance > 1300 || X.isRemoved(index, ext)) continue;
      const roof = X.preferredRoofPoint(index, ext);
      if (roof) { farRoof = { index, ext, ...roof }; break; }
    }
    if (farRoof) break;
  }
  check('a modelled roof beyond the nearby list is available for regression', !!farRoof);
  if (farRoof) {
    X.placeRoofObserver(farRoof.index, farRoof.ext, farRoof.x, farRoof.y); X.setMode('observer');
    const count = X.viewpointNavigationState().choices.length;
    X.stepViewpoint(1);
    check('a manually selected far roof stays in the cycle after next', X.viewpointNavigationState().choices.length === count && X.viewpointNavigationState().choices.some(q => q.index === farRoof.index && q.ext === farRoof.ext));
    X.stepViewpoint(-1);
    check('next then previous returns to the same far roof position', X.state.observer.building.index === farRoof.index && (X.state.observer.building.source === 'extension') === farRoof.ext && Math.hypot(X.state.observer.x - farRoof.x, X.state.observer.y - farRoof.y) < 0.1);
  }
  X.chooseMethod('view', 'cone');
  const usable = cones.cones.find(c => c.origin_inside_model_extent && X.groundZAt(...c.origin_model_xy));
  X.viewFromHere(String(usable.view_number)); current = X.viewpointNavigationState();
  const ref = X.state.viewpoint;
  check('protected navigation only offers origins with modelled ground', current.choices.length > 1 && current.choices.every(c => c.origin_inside_model_extent && X.groundZAt(...c.origin_model_xy)) && current.index >= 0);
  X.stepViewpoint(1);
  check('next protected viewpoint updates the actual observer and selected cone together', X.state.mode === 'observer' && X.state.observerSource === 'origin' && X.state.viewpoint !== ref && Math.hypot(X.state.observer.x - X.selectedCone().origin_model_xy[0], X.state.observer.y - X.selectedCone().origin_model_xy[1]) < 0.1);
  X.stepViewpoint(-1); check('protected previous returns to the original view', X.state.viewpoint === ref);
  X.assets.cones = { ...cones, cones: [usable] }; X.refreshViewpointNavigation();
  check('a single available origin disables both controls', $('btn-viewpoint-prev').disabled && $('btn-viewpoint-next').disabled && !X.stepViewpoint(1));
  X.assets.cones = { available: false, cones: [] }; X.refreshViewpointNavigation();
  check('missing cone data cannot navigate', $('btn-viewpoint-prev').disabled && $('btn-viewpoint-next').disabled && !X.stepViewpoint(1));
  X.assets.cones = cones;
  X.state.observer = { ...X.state.observer, x: X.state.observer.x + 5 }; X.refreshViewpointNavigation();
  check('an offset observer is not presented as standing at the selected cone', X.viewpointNavigationState().index === -1 && $('viewpoint-position').textContent.includes('available'));
  X.state.observerSource = 'exploratory'; X.refreshViewpointNavigation();
  check('custom ground viewpoints hide candidate navigation', $('viewpoint-navigation').classList.contains('hidden') && !X.stepViewpoint(1));
  X.setMode('overview'); check('navigation is hidden outside observer mode', $('viewpoint-navigation').classList.contains('hidden'));
} catch (error) {
  tests.push({ name: 'exception', pass: false, error: String(error), stack: error.stack });
} finally {
  if (cones) X.assets.cones = cones;
  if (original) X.applyHash(original);
  const report = document.createElement('pre'); report.id = 'viewpoint-selftest-result'; report.hidden = true;
  report.textContent = JSON.stringify({ tests, all_pass: tests.length > 0 && tests.every(t => t.pass) }); document.body.appendChild(report);
  document.title = tests.every(t => t.pass) ? 'VIEWPOINTTEST DONE' : 'VIEWPOINTTEST FAIL';
}
})();
