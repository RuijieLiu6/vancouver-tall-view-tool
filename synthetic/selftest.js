/* Automated in-browser self-test for the Vancouver View-Protection Lab front end.
 * SYNTHETIC / NOT A VANCOUVER ASSESSMENT. Only loaded when location.search contains
 * selftest=1 (see index.html). Drives the REAL controls via window.__lab and reads
 * the REAL DOM; it never inspects or calls any internal comparison logic.
 */
(function () {
  "use strict";

  const DEFAULT_YAW = -Math.PI / 4;
  const DEFAULT_PITCH = 0.5;
  const NUMERIC_RESULTS = ["INTERSECTS", "BOUNDARY_CONTACT", "BELOW_BOUNDARY", "PLAN_EDGE_CONTACT", "NO_PLAN_OVERLAP"];

  function text(id) {
    const el = document.getElementById(id);
    return el ? el.textContent : "";
  }

  function waitFor(fn, timeoutMs) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      (function loop() {
        let v;
        try { v = fn(); } catch (e) { v = undefined; }
        if (v) return resolve(v);
        if (Date.now() - start > (timeoutMs || 10000)) return reject(new Error("timeout waiting for condition"));
        setTimeout(loop, 20);
      })();
    });
  }

  async function run() {
    const report = [];
    function record(step, pass, detail) { report.push({ step: step, pass: !!pass, detail: detail }); }

    let lab;
    try {
      lab = await waitFor(() => window.__lab, 10000);
      await lab.whenIdle();
    } catch (e) {
      record(0, false, "fatal: __lab never became ready: " + String(e));
      finish(report);
      return;
    }

    // 1: initial F1 load
    try {
      const badge = text("result-badge");
      const margin = text("val-margin");
      const pen = text("val-penetration");
      const pass = badge === "INTERSECTS" && margin === "-15.000" && pen === "15.000";
      record(1, pass, { badge: badge, margin: margin, penetration: pen });
    } catch (e) { record(1, false, "error: " + String(e)); }

    // 2: F2 -> BOUNDARY_CONTACT
    try {
      lab.clickFixture("F2");
      await lab.whenIdle();
      const badge = text("result-badge");
      const pen = text("val-penetration");
      const explanation = text("explanation-text");
      const pass = badge === "BOUNDARY_CONTACT" && pen === "0.000" &&
        explanation.indexOf("tolerance band") !== -1 &&
        explanation.indexOf("exact contact") === -1;
      record(2, pass, { badge: badge, penetration: pen, explanation: explanation });
    } catch (e) { record(2, false, "error: " + String(e)); }

    // 3: F3 -> CANNOT_DETERMINE, boundary/overlap hidden
    try {
      lab.clickFixture("F3");
      await lab.whenIdle();
      const badge = text("result-badge");
      const scene = lab.state().scene;
      const reasons = text("reasons-list");
      const pass = badge === "CANNOT_DETERMINE" && scene.boundaryVisible === false &&
        scene.overlapVisible === false && reasons.indexOf("boundary_z missing") !== -1;
      record(3, pass, { badge: badge, scene: scene, reasonsContainsPhrase: reasons.indexOf("boundary_z missing") !== -1 });
    } catch (e) { record(3, false, "error: " + String(e)); }

    // 4: F1 then height=60 -> BELOW_BOUNDARY, top_z == 70
    try {
      lab.clickFixture("F1");
      await lab.whenIdle();
      lab.setControl("height", 60);
      await lab.whenIdle();
      const badge = text("result-badge");
      const topZ = lab.state().tower.top_z;
      const pass = badge === "BELOW_BOUNDARY" && topZ === 70;
      record(4, pass, { badge: badge, top_z: topZ });
    } catch (e) { record(4, false, "error: " + String(e)); }

    // 5: xc=95 -> unevaluated area present and shown
    try {
      lab.setControl("xc", 95);
      await lab.whenIdle();
      const st = lab.state();
      const notEval = lab.lastResponse.result.not_evaluated_area_m2;
      const pass = notEval !== null && notEval > 0 && st.scene.unevaluatedVisible === true;
      record(5, pass, { not_evaluated_area_m2: notEval, unevaluatedVisible: st.scene.unevaluatedVisible });
    } catch (e) { record(5, false, "error: " + String(e)); }

    // 6: toggle missing on then off
    try {
      lab.setControl("missing", true);
      await lab.whenIdle();
      const badge1 = text("result-badge");
      lab.setControl("missing", false);
      await lab.whenIdle();
      const geo2 = lab.lastResponse.result.geometric_result;
      const pass = badge1 === "CANNOT_DETERMINE" && NUMERIC_RESULTS.indexOf(geo2) !== -1;
      record(6, pass, { badge1: badge1, geometric_result_after: geo2 });
    } catch (e) { record(6, false, "error: " + String(e)); }

    // 7: reset() restores F1 values and default camera
    try {
      lab.reset();
      await lab.whenIdle();
      const st = lab.state();
      const c = st.controls;
      const pass = c.height === 85 && c.xc === 35 && c.yc === 25 && c.width === 30 && c.depth === 30 &&
        c.base === 10 && c.boundary === 80 && st.camera.projection === "perspective" &&
        Math.abs(st.camera.yaw - DEFAULT_YAW) < 1e-9 && Math.abs(st.camera.pitch - DEFAULT_PITCH) < 1e-9;
      record(7, pass, { controls: c, camera: st.camera });
    } catch (e) { record(7, false, "error: " + String(e)); }

    // 8: rapid changes without awaiting between, then whenIdle
    try {
      lab.setControl("height", 20);
      lab.setControl("height", 30);
      lab.setControl("height", 40);
      lab.setControl("height", 50);
      lab.setControl("height", 60);
      await lab.whenIdle();
      const input = lab.lastResponse.input;
      // whenIdle() only resolves once state.lastResponse.request_id === the id of the
      // most recently sent request, so reaching here already proves the displayed
      // result is not a stale intermediate one; top_z==70 confirms it is the LAST
      // debounced request (height=60), not one of the discarded intermediate values.
      const pass = input.tower.top_z === 70;
      record(8, pass, { top_z: input.tower.top_z, displayed_request_id: lab.lastResponse.request_id });
    } catch (e) { record(8, false, "error: " + String(e)); }

    // 9: download()
    try {
      lab.download();
      const dl = lab.lastDownload;
      const pass = !!dl && /^view_lab_/.test(dl.name) &&
        JSON.stringify(JSON.parse(dl.text).result) === JSON.stringify(lab.lastResponse.result);
      record(9, pass, { name: dl && dl.name });
    } catch (e) { record(9, false, "error: " + String(e)); }

    // 10: view mode + orbit drag
    try {
      lab.setView("plan");
      const proj1 = lab.state().camera.projection;
      lab.setView("3d");
      const proj2 = lab.state().camera.projection;
      const yawBefore = lab.state().camera.yaw;
      const towerBefore = JSON.stringify(lab.state().tower);

      const canvas = document.getElementById("scene-canvas");
      const rect = canvas.getBoundingClientRect();
      const x0 = rect.left + rect.width / 2, y0 = rect.top + rect.height / 2;
      canvas.dispatchEvent(new MouseEvent("mousedown", { clientX: x0, clientY: y0, button: 0, bubbles: true, cancelable: true }));
      window.dispatchEvent(new MouseEvent("mousemove", { clientX: x0 + 90, clientY: y0 + 25, bubbles: true, cancelable: true }));
      window.dispatchEvent(new MouseEvent("mouseup", { clientX: x0 + 90, clientY: y0 + 25, bubbles: true, cancelable: true }));

      const yawAfter = lab.state().camera.yaw;
      const towerAfter = JSON.stringify(lab.state().tower);
      const pass = proj1 === "orthographic" && proj2 === "perspective" && yawAfter !== yawBefore && towerAfter === towerBefore;
      record(10, pass, { proj1: proj1, proj2: proj2, yawBefore: yawBefore, yawAfter: yawAfter, towerUnchanged: towerAfter === towerBefore });
    } catch (e) { record(10, false, "error: " + String(e)); }

    finish(report);
  }

  function finish(report) {
    const allPass = report.length > 0 && report.every((r) => r.pass);
    const pre = document.createElement("pre");
    pre.id = "selftest-report";
    pre.textContent = JSON.stringify(report, null, 2);
    document.body.appendChild(pre);
    document.title = allPass ? "SELFTEST DONE" : "SELFTEST FAILED";
  }

  run();
})();
