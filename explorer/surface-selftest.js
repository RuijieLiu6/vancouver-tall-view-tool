/* Integration checks for the rebuilt context, run with ?surfacetest=1. */
(async () => {
  const results = [];
  const check = (name, pass, detail) => results.push({ name, pass: !!pass, detail });
  const xy = (lat, lon) => [(lon + 123.1207) * 111320 * Math.cos(49.2827 * Math.PI / 180), (lat - 49.2827) * 110574];
  try {
    const X = window.__explorer;
    await X.ready;
    check('Only rebuilt ground and water loaded', X.assets.unified && !X.assets.raw.ext_terrain && !X.assets.raw.ext_water && X.assets.raw.ext_buildings,
      { rebuild: !!X.assets.unified, meshes: Object.keys(X.assets.raw) });
    for (const [name, lat, lon] of [
      ['East Burrard Inlet', 49.304, -123.066], ['West Burrard Inlet', 49.303, -123.112],
      ['English Bay', 49.292, -123.158], ['False Creek', 49.271, -123.117],
      
    ]) {
      const p = xy(lat, lon), hit = X.pickRay([...p, 5000], [0, 0, -1]);
      check(name + ': water cannot become a site', hit.type === 'water' && X.landZAt(...p) === null && X.placeSite(...p) === false,
        { xy: p, hit: hit.type, ground: X.groundZAt(...p) });
    }
    for (const [name, p] of [['Lost Lagoon', [-1455, 1426]], ['Trout Lake', [4249.43, -2968.96]]]) {
      const hit = X.pickRay([...p, 5000], [0, 0, -1]);
      check(name + ': mapped lake is water and cannot become a site', hit.type === 'water' && X.landZAt(...p) === null && X.placeSite(...p) === false, { xy: p, hit: hit.type });
    }
    // Centre a plain orthographic frame on the inlet; read the real WebGL
    // framebuffer to catch green terrain covering water despite correct picks.
    const inlet = xy(49.304, -123.066);
    X.state.site = null; X.state.observer = null; X.state.viewpoint = null; X.state.boundary = [];
    X.state.cams.overview = { target: [...inlet, 0], dist: 700, az: 0, el: 1.5 };
    X.setMode('plan'); X.renderOnce();
    const pixel = X.readPixel(0.5, 0.5);
    // Collage uses a pale blue-grey with equal green and blue channels.
    check('East inlet renders cool water rather than terrain in plan', pixel[2] >= pixel[1] - 2 && pixel[1] > pixel[0] + 15, { pixel, palette: X.state.sceneStyle });
    const land = [[0, 0], [4000, -1000], [1200, 3800]];
    check('Downtown, east Vancouver and North Shore retain land', land.every(p => X.landZAt(...p) !== null),
      land.map(p => ({ xy: p, z: X.landZAt(...p) })));
    check('Every public view origin has a surface', X.assets.cones.cones.every(c => X.groundZAt(...c.origin_model_xy)),
      { origins: X.assets.cones.cones.length });
    X.placeSite(0, 0);
    const tech = X.technicalState();
    check('Saved study records rebuild and active ground elevation', tech.context_rebuild && tech.site.z === X.terrainZAt(0, 0),
      { ground: tech.site.z, coordinates: tech.coordinates });
  } catch (error) { check('exception', false, { message: String(error), stack: error.stack }); }
  const result = { all_pass: results.length > 0 && results.every(r => r.pass), tests: results };
  const pre = document.createElement('pre'); pre.id = 'surface-selftest-result'; pre.hidden = true; pre.textContent = JSON.stringify(result); document.body.appendChild(pre);
  document.title = result.all_pass ? 'SURFACETEST DONE' : 'SURFACETEST FAIL';
})();
