/* Vancouver View-Protection Lab -- browser front end.
 * SYNTHETIC / NOT A VANCOUVER ASSESSMENT.
 *
 * This file never reimplements any classification, margin, overlap or penetration
 * logic. All /api/compare results are displayed verbatim; the only geometry this
 * file computes itself is pure display geometry (camera projection, and splitting
 * the tower footprint rectangle by the fixed test-area rectangle to shade the part
 * of the footprint outside the test area -- explicitly permitted by the spec as
 * "display, not classification").
 */
(function () {
  "use strict";

  // ---------------------------------------------------------------------
  // Control <-> DOM map
  // ---------------------------------------------------------------------
  const CONTROL_MAP = {
    height: { range: "height-range", number: "height-number" },
    xc: { range: "xc-range", number: "xc-number" },
    yc: { range: "yc-range", number: "yc-number" },
    width: { range: "width-range", number: "width-number" },
    depth: { range: "depth-range", number: "depth-number" },
    base: { number: "base-number" },
    boundary: { range: "boundary-range", number: "boundary-number" },
    missing: { checkbox: "missing-toggle" },
  };

  const DEFAULT_YAW = -Math.PI / 4;
  const DEFAULT_PITCH = 0.5;
  const FOV = (50 * Math.PI) / 180;

  const state = {
    controls: { height: 85, xc: 35, yc: 25, width: 30, depth: 30, base: 10, boundary: 80, missing: false },
    baseFixtureKey: "F1",
    isCustom: false,
    applyingFixture: false,
    fixturesData: null,
    testArea: { x_min: 0, x_max: 100, y_min: 0, y_max: 60 },
    camera: { target: { x: 50, y: 30, z: 40 }, yaw: DEFAULT_YAW, pitch: DEFAULT_PITCH, distance: 150, projection: "perspective" },
    lastResponse: null,
  };

  let requestCounter = 0;
  let latestSentId = 0;
  let pendingCount = 0;
  let debouncePending = false;
  let debounceTimer = null;

  const els = {};

  // ---------------------------------------------------------------------
  // small numeric / geometry helpers
  // ---------------------------------------------------------------------
  function fmt(v, decimals) {
    decimals = decimals === undefined ? 3 : decimals;
    if (v === null || v === undefined) return "—";
    if (typeof v !== "number" || !isFinite(v)) return "—";
    return v.toFixed(decimals);
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function clampToInputRange(el, v) {
    const min = el.min !== "" ? parseFloat(el.min) : -Infinity;
    const max = el.max !== "" ? parseFloat(el.max) : Infinity;
    if (isFinite(min)) v = Math.max(min, v);
    if (isFinite(max)) v = Math.min(max, v);
    return v;
  }

  function dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
  function cross(a, b) { return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x }; }
  function normalize(v) {
    const l = Math.hypot(v.x, v.y, v.z) || 1;
    return { x: v.x / l, y: v.y / l, z: v.z / l };
  }

  function rectCorners(rect, z) {
    return [
      { x: rect.x_min, y: rect.y_min, z: z },
      { x: rect.x_max, y: rect.y_min, z: z },
      { x: rect.x_max, y: rect.y_max, z: z },
      { x: rect.x_min, y: rect.y_max, z: z },
    ];
  }

  function boxCorners(b) {
    return [
      { x: b.x_min, y: b.y_min, z: b.base_z }, { x: b.x_max, y: b.y_min, z: b.base_z },
      { x: b.x_max, y: b.y_max, z: b.base_z }, { x: b.x_min, y: b.y_max, z: b.base_z },
      { x: b.x_min, y: b.y_min, z: b.top_z }, { x: b.x_max, y: b.y_min, z: b.top_z },
      { x: b.x_max, y: b.y_max, z: b.top_z }, { x: b.x_min, y: b.y_max, z: b.top_z },
    ];
  }

  function boxFaces(c) {
    return [
      [c[0], c[1], c[2], c[3]],
      [c[4], c[5], c[6], c[7]],
      [c[0], c[1], c[5], c[4]],
      [c[1], c[2], c[6], c[5]],
      [c[2], c[3], c[7], c[6]],
      [c[3], c[0], c[4], c[7]],
    ];
  }

  // Pure display geometry: the part of the tower footprint rectangle lying
  // outside the (fixed) test-area rectangle, as up to 4 axis-aligned rectangles.
  function rectDifference(tower, area) {
    const t = { x_min: tower.x_min, x_max: tower.x_max, y_min: tower.y_min, y_max: tower.y_max };
    const ixMin = Math.max(t.x_min, area.x_min), ixMax = Math.min(t.x_max, area.x_max);
    const iyMin = Math.max(t.y_min, area.y_min), iyMax = Math.min(t.y_max, area.y_max);
    const hasOverlap = ixMin < ixMax && iyMin < iyMax;
    const rects = [];
    if (!hasOverlap) {
      rects.push({ x_min: t.x_min, x_max: t.x_max, y_min: t.y_min, y_max: t.y_max });
      return rects;
    }
    if (t.x_min < ixMin) rects.push({ x_min: t.x_min, x_max: ixMin, y_min: t.y_min, y_max: t.y_max });
    if (ixMax < t.x_max) rects.push({ x_min: ixMax, x_max: t.x_max, y_min: t.y_min, y_max: t.y_max });
    if (t.y_min < iyMin) rects.push({ x_min: ixMin, x_max: ixMax, y_min: t.y_min, y_max: iyMin });
    if (iyMax < t.y_max) rects.push({ x_min: ixMin, x_max: ixMax, y_min: iyMax, y_max: t.y_max });
    return rects;
  }

  // ---------------------------------------------------------------------
  // control state -> request geometry
  // ---------------------------------------------------------------------
  function currentTower() {
    const c = state.controls;
    return {
      x_min: c.xc - c.width / 2, x_max: c.xc + c.width / 2,
      y_min: c.yc - c.depth / 2, y_max: c.yc + c.depth / 2,
      base_z: c.base, top_z: c.base + c.height,
    };
  }

  function currentFixtureId() {
    if (state.isCustom) return "custom (from " + state.baseFixtureKey + ")";
    const fx = state.fixturesData && state.fixturesData.fixtures.find((f) => f.key === state.baseFixtureKey);
    return fx ? fx.fixture_id : state.baseFixtureKey;
  }

  function buildRequestBody(id) {
    return {
      request_id: id,
      fixture_id: currentFixtureId(),
      tower: currentTower(),
      test_area: state.testArea,
      boundary_z: state.controls.missing ? null : state.controls.boundary,
    };
  }

  function currentDisplayInput() {
    if (state.lastResponse) return state.lastResponse.input;
    return { tower: currentTower(), test_area: state.testArea, boundary_z: state.controls.missing ? null : state.controls.boundary, fixture_id: currentFixtureId() };
  }

  // ---------------------------------------------------------------------
  // networking: debounce, monotonically increasing request_id, staleness
  // ---------------------------------------------------------------------
  function scheduleRequest() {
    debouncePending = true;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(sendRequest, 60);
  }

  function sendRequest() {
    debouncePending = false;
    const id = ++requestCounter;
    latestSentId = id;
    const body = buildRequestBody(id);
    pendingCount++;
    updatePendingBadge();
    window.ProjectAPI.fetch("/api/compare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
      .then(async (r) => {
        let data = null;
        try { data = await r.json(); } catch (e) { /* ignore */ }
        if (id < latestSentId) return; // ignore anything older than the latest sent
        if (r.status === 200 && data) {
          clearError();
          displayResult(data);
        } else {
          const msg = data && data.error ? data.error : ("HTTP " + r.status);
          showError(msg);
          markStale();
        }
      })
      .catch((err) => {
        if (id < latestSentId) return;
        showError(err && err.message ? err.message : String(err));
        markStale();
      })
      .finally(() => {
        pendingCount = Math.max(0, pendingCount - 1);
        updatePendingBadge();
      });
  }

  function whenIdle() {
    return new Promise((resolve) => {
      (function check() {
        if (!debouncePending && pendingCount === 0 && state.lastResponse && state.lastResponse.request_id === latestSentId) {
          resolve();
        } else {
          setTimeout(check, 15);
        }
      })();
    });
  }

  // ---------------------------------------------------------------------
  // control wiring
  // ---------------------------------------------------------------------
  function onControlChange(name, value) {
    state.controls[name] = value;
    if (!state.applyingFixture) state.isCustom = true;
    updateDerivedReadouts();
    scheduleRequest();
  }

  function bindPair(name) {
    const map = CONTROL_MAP[name];
    const rangeEl = map.range ? document.getElementById(map.range) : null;
    const numberEl = map.number ? document.getElementById(map.number) : null;
    function process(sourceEl) {
      let v = parseFloat(sourceEl.value);
      if (!isFinite(v)) return;
      v = clampToInputRange(sourceEl, v);
      if (rangeEl && sourceEl !== rangeEl) rangeEl.value = v;
      if (numberEl && sourceEl !== numberEl) numberEl.value = v;
      onControlChange(name, v);
    }
    if (rangeEl) rangeEl.addEventListener("input", () => process(rangeEl));
    if (numberEl) numberEl.addEventListener("input", () => process(numberEl));
  }

  function bindCheckbox(name) {
    const map = CONTROL_MAP[name];
    const el = document.getElementById(map.checkbox);
    el.addEventListener("input", () => onControlChange(name, el.checked));
  }

  function setupControlBindings() {
    ["height", "xc", "yc", "width", "depth", "base", "boundary"].forEach(bindPair);
    bindCheckbox("missing");
  }

  function setControl(name, value) {
    const map = CONTROL_MAP[name];
    if (!map) return;
    if (map.checkbox) {
      const el = document.getElementById(map.checkbox);
      el.checked = !!value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return;
    }
    if (map.range) {
      const el = document.getElementById(map.range);
      el.value = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    } else if (map.number) {
      const el = document.getElementById(map.number);
      el.value = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }

  function applyFixtureByKey(key) {
    if (!state.fixturesData) return;
    const fx = state.fixturesData.fixtures.find((f) => f.key === key);
    if (!fx) return;
    state.applyingFixture = true;
    const w = fx.tower.x_max - fx.tower.x_min;
    const d = fx.tower.y_max - fx.tower.y_min;
    const xc = (fx.tower.x_min + fx.tower.x_max) / 2;
    const yc = (fx.tower.y_min + fx.tower.y_max) / 2;
    const height = fx.tower.top_z - fx.tower.base_z;
    const missing = fx.boundary_z === null;
    setControl("base", fx.tower.base_z);
    setControl("height", height);
    setControl("xc", xc);
    setControl("yc", yc);
    setControl("width", w);
    setControl("depth", d);
    setControl("missing", missing);
    setControl("boundary", missing ? 80 : fx.boundary_z);
    state.applyingFixture = false;
    state.baseFixtureKey = key;
    state.isCustom = false;
    updateDerivedReadouts();
    scheduleRequest();
  }

  function updateDerivedReadouts() {
    const c = state.controls;
    els.topElevation.textContent = fmt(c.base + c.height);
    document.getElementById("boundary-range").disabled = c.missing;
    document.getElementById("boundary-number").disabled = c.missing;
    els.fixtureLabel.textContent = "Fixture: " + currentFixtureId();
  }

  // ---------------------------------------------------------------------
  // buttons
  // ---------------------------------------------------------------------
  function setViewMode(mode) {
    if (mode === "plan") {
      state.camera.projection = "orthographic";
      state.camera.yaw = 0;
      state.camera.pitch = Math.PI / 2;
    } else {
      state.camera.projection = "perspective";
      state.camera.yaw = DEFAULT_YAW;
      state.camera.pitch = DEFAULT_PITCH;
    }
    scheduleRender();
  }

  function computeDefaultCamera() {
    const ta = state.testArea;
    const tw = currentTower();
    const xmin = Math.min(ta.x_min, tw.x_min), xmax = Math.max(ta.x_max, tw.x_max);
    const ymin = Math.min(ta.y_min, tw.y_min), ymax = Math.max(ta.y_max, tw.y_max);
    const zmax = Math.max(tw.top_z, state.controls.missing ? 0 : state.controls.boundary, 10);
    const cx = (xmin + xmax) / 2, cy = (ymin + ymax) / 2, cz = zmax / 2;
    const extent = Math.max(xmax - xmin, ymax - ymin, zmax, 20);
    return { target: { x: cx, y: cy, z: cz }, yaw: DEFAULT_YAW, pitch: DEFAULT_PITCH, distance: extent * 1.7, projection: "perspective" };
  }

  function resetView() {
    state.camera = computeDefaultCamera();
    scheduleRender();
  }

  function setupButtons() {
    document.getElementById("btn-f1").addEventListener("click", () => applyFixtureByKey("F1"));
    document.getElementById("btn-f2").addEventListener("click", () => applyFixtureByKey("F2"));
    document.getElementById("btn-f3").addEventListener("click", () => applyFixtureByKey("F3"));
    document.getElementById("btn-reset").addEventListener("click", () => { applyFixtureByKey("F1"); resetView(); });
    document.getElementById("btn-view-plan").addEventListener("click", () => setViewMode("plan"));
    document.getElementById("btn-view-3d").addEventListener("click", () => setViewMode("3d"));
    document.getElementById("btn-reset-view").addEventListener("click", resetView);
    document.getElementById("btn-download").addEventListener("click", doDownload);
  }

  // ---------------------------------------------------------------------
  // results panel + technical panel + error/pending UI
  // ---------------------------------------------------------------------
  function marginExplanation(margin) {
    if (margin === null || margin === undefined) return "—";
    return margin >= 0 ? "+ : tower top below the boundary" : "− : tower top above the boundary";
  }

  function buildExplanation(input, result) {
    const gr = result.geometric_result;
    const tol = fmt(result.tolerance_m);
    const margin = fmt(result.signed_margin_m);
    switch (gr) {
      case "INTERSECTS":
        return "The evaluated tower volume extends above the boundary: signed margin " + margin + " m is below −tolerance (" + tol + " m).";
      case "BOUNDARY_CONTACT":
        return "The signed margin |" + margin + "| m is within tolerance (" + tol + " m) of the boundary — a tolerance band, not a claim of exact mathematical contact.";
      case "BELOW_BOUNDARY":
        return "Over the evaluated overlap area, the tower top stays below the boundary by more than the tolerance (" + tol + " m). This says nothing about any not-evaluated area.";
      case "PLAN_EDGE_CONTACT":
        return "The tower footprint and the test area meet within tolerance (" + tol + " m) in plan — a tolerance band, not an assertion of exact edge contact.";
      case "NO_PLAN_OVERLAP":
        return "The tower footprint and the test area do not overlap in plan (beyond tolerance), so no vertical comparison is evaluated.";
      case "CANNOT_DETERMINE": {
        const r = result.reasons.find((x) => x.indexOf("boundary_z missing") !== -1);
        return r || "The comparison could not be determined: boundary_z is missing.";
      }
      case "UNSUPPORTED_INPUT":
        return "Input was not evaluated and not treated as clear. " + result.reasons.slice(1).join("; ");
      default:
        return "";
    }
  }

  function displayResult(data) {
    state.lastResponse = data;
    clearError();
    els.badge.classList.remove("stale");
    renderResultsPanel(data);
    renderTechnical(data);
    scheduleRender();
  }

  function renderResultsPanel(data) {
    const input = data.input, result = data.result;
    els.badge.textContent = result.geometric_result || "—";
    els.badge.className = "result-badge" + (result.geometric_result ? " badge-" + result.geometric_result : "");
    els.applicability.textContent = result.regulatory_applicability;

    els.margin.textContent = fmt(result.signed_margin_m);
    els.marginNote.textContent = marginExplanation(result.signed_margin_m);

    els.penetration.textContent = fmt(result.penetration_m);
    els.penetrationNote.textContent = result.penetration_definition;

    els.evalArea.textContent = result.plan_overlap ? fmt(result.plan_overlap.area_m2) : "—";
    els.unevalArea.textContent = fmt(result.not_evaluated_area_m2);

    els.tolerance.textContent = fmt(result.tolerance_m);
    els.toleranceNote.textContent = result.tolerance_note;

    els.explanation.textContent = buildExplanation(input, result);

    els.reasonsList.innerHTML = "";
    (result.reasons || []).forEach((r) => {
      const li = document.createElement("li");
      li.textContent = r;
      els.reasonsList.appendChild(li);
    });

    els.snapTopZ.textContent = fmt(input.tower.top_z);
    els.snapBoundaryZ.textContent = input.boundary_z === null ? "—" : fmt(input.boundary_z);

    els.footer.textContent = "Result #" + data.request_id + " for the inputs shown";
    els.fixtureLabel.textContent = "Fixture: " + input.fixture_id;
  }

  function renderTechnical(data) {
    els.techInput.textContent = JSON.stringify(data.input, null, 2);
    els.techResult.textContent = JSON.stringify(data.result, null, 2);
  }

  function showError(msg) {
    els.errorStrip.textContent = msg;
    els.errorStrip.classList.remove("hidden");
  }
  function clearError() {
    els.errorStrip.classList.add("hidden");
    els.errorStrip.textContent = "";
  }
  function markStale() {
    els.badge.classList.add("stale");
    if (state.lastResponse) {
      els.footer.textContent = "Result #" + state.lastResponse.request_id + " for the inputs shown (stale — latest update failed)";
    }
  }
  function updatePendingBadge() {
    if (pendingCount > 0) els.pendingBadge.classList.remove("hidden");
    else els.pendingBadge.classList.add("hidden");
  }

  function doDownload() {
    const lr = state.lastResponse;
    if (!lr) return;
    const payload = { label: lr.result.label, input: lr.input, result: lr.result };
    const text = JSON.stringify(payload, null, 2);
    const keyPart = (state.isCustom ? state.baseFixtureKey + "-custom" : state.baseFixtureKey).replace(/[^A-Za-z0-9_-]/g, "-");
    const name = "view_lab_" + keyPart + "_" + lr.request_id + ".json";
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    window.__lab.lastDownload = { name: name, text: text };
  }

  // ---------------------------------------------------------------------
  // 3D-ish canvas renderer (custom, Canvas 2D only)
  // ---------------------------------------------------------------------
  function makeCameraBasis(cam) {
    const yaw = cam.yaw, pitch = cam.pitch;
    const dir = { x: Math.cos(pitch) * Math.sin(yaw), y: -Math.cos(pitch) * Math.cos(yaw), z: Math.sin(pitch) };
    const eye = { x: cam.target.x + cam.distance * dir.x, y: cam.target.y + cam.distance * dir.y, z: cam.target.z + cam.distance * dir.z };
    const forward = normalize({ x: -dir.x, y: -dir.y, z: -dir.z });
    const upRef = Math.abs(dir.z) > 0.999 ? { x: 0, y: 1, z: 0 } : { x: 0, y: 0, z: 1 };
    let right = normalize(cross(forward, upRef));
    if (!isFinite(right.x) || (right.x === 0 && right.y === 0 && right.z === 0)) right = { x: 1, y: 0, z: 0 };
    const up = cross(right, forward);
    return { eye: eye, forward: forward, right: right, up: up };
  }

  function project(basis, cam, pt, viewport) {
    const rel = { x: pt.x - basis.eye.x, y: pt.y - basis.eye.y, z: pt.z - basis.eye.z };
    const cx = dot(rel, basis.right);
    const cy = dot(rel, basis.up);
    const cz = dot(rel, basis.forward);
    let sx, sy, visible;
    if (cam.projection === "perspective") {
      const near = 0.05;
      visible = cz > near;
      const f = viewport.focal;
      sx = viewport.cx + (cx * f) / Math.max(cz, near);
      sy = viewport.cy - (cy * f) / Math.max(cz, near);
    } else {
      visible = true;
      const s = viewport.orthoScale;
      sx = viewport.cx + cx * s;
      sy = viewport.cy - cy * s;
    }
    return { x: sx, y: sy, depth: cz, visible: visible };
  }

  function avgDepth(pts) {
    let s = 0;
    for (let i = 0; i < pts.length; i++) s += pts[i].depth;
    return s / pts.length;
  }

  function buildGrid(drawables) {
    for (let x = -50; x <= 150; x += 10) {
      const heavy = Math.abs(x % 50) < 1e-6;
      drawables.push({ type: "line", pts: [{ x: x, y: -40, z: 0 }, { x: x, y: 100, z: 0 }], stroke: heavy ? "rgba(70,70,64,0.55)" : "rgba(120,120,114,0.28)", lineWidth: heavy ? 1.3 : 0.7 });
    }
    for (let y = -40; y <= 100; y += 10) {
      const heavy = Math.abs(y % 50) < 1e-6;
      drawables.push({ type: "line", pts: [{ x: -50, y: y, z: 0 }, { x: 150, y: y, z: 0 }], stroke: heavy ? "rgba(70,70,64,0.55)" : "rgba(120,120,114,0.28)", lineWidth: heavy ? 1.3 : 0.7 });
    }
    [-50, 0, 50, 100, 150].forEach((x) => drawables.push({ type: "label", pts: [{ x: x, y: -40, z: 0 }], text: x + " m", color: "#6b6b64" }));
    [-40, 0, 50, 100].forEach((y) => drawables.push({ type: "label", pts: [{ x: -50, y: y, z: 0 }], text: y + " m", color: "#6b6b64" }));
    drawables.push({ type: "origin", pts: [{ x: 0, y: 0, z: 0 }] });
  }

  function drawItem(ctx, d) {
    const pts = d.__pts;
    ctx.save();
    if (d.dash) ctx.setLineDash(d.dash); else ctx.setLineDash([]);
    if (d.type === "poly") {
      ctx.beginPath();
      pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.closePath();
      if (d.fill) { ctx.fillStyle = d.fill; ctx.fill(); }
      if (d.stroke) { ctx.strokeStyle = d.stroke; ctx.lineWidth = d.lineWidth || 1; ctx.stroke(); }
    } else if (d.type === "line") {
      ctx.beginPath();
      pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.strokeStyle = d.stroke; ctx.lineWidth = d.lineWidth || 1;
      ctx.stroke();
    } else if (d.type === "label") {
      ctx.setLineDash([]);
      ctx.font = "10.5px " + "ui-monospace, Menlo, Consolas, monospace";
      ctx.fillStyle = d.color || "#666";
      ctx.fillText(d.text, pts[0].x + 3, pts[0].y - 3);
    } else if (d.type === "origin") {
      ctx.setLineDash([]);
      ctx.fillStyle = "#33332e";
      ctx.beginPath(); ctx.arc(pts[0].x, pts[0].y, 3, 0, Math.PI * 2); ctx.fill();
      ctx.font = "10.5px ui-monospace, Menlo, Consolas, monospace";
      ctx.fillStyle = "#33332e";
      ctx.fillText("0,0 m", pts[0].x + 5, pts[0].y + 12);
    } else if (d.type === "hatch") {
      ctx.beginPath();
      pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.closePath();
      ctx.fillStyle = "rgba(120,120,110,0.10)";
      ctx.fill();
      ctx.strokeStyle = "#8a8a86";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.clip();
      const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
      const minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs);
      const minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);
      ctx.strokeStyle = "rgba(90,90,85,0.6)";
      ctx.lineWidth = 1;
      const step = 8;
      for (let x = minX - (maxY - minY); x < maxX + (maxY - minY); x += step) {
        ctx.beginPath();
        ctx.moveTo(x, minY);
        ctx.lineTo(x + (maxY - minY), maxY);
        ctx.stroke();
      }
      if (d.label) {
        ctx.setLineDash([]);
        ctx.font = "11px ui-monospace, Menlo, Consolas, monospace";
        ctx.fillStyle = "#4f4f49";
        ctx.textAlign = "center";
        ctx.fillText("not evaluated", (minX + maxX) / 2, (minY + maxY) / 2);
        ctx.textAlign = "left";
      }
    }
    ctx.restore();
  }

  function buildTowerFaces(drawables, box, style) {
    const c = boxCorners(box);
    boxFaces(c).forEach((f) => drawables.push({ type: "poly", pts: f, fill: style.fill, stroke: style.stroke, lineWidth: style.lineWidth }));
  }

  function buildTowerWireframe(drawables, box, style) {
    const c = boxCorners(box);
    const edges = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
    edges.forEach(([i, j]) => drawables.push({ type: "line", pts: [c[i], c[j]], stroke: style.stroke, lineWidth: style.lineWidth, dash: style.dash }));
  }

  function computeSceneFlags() {
    const lr = state.lastResponse;
    if (!lr) return { boundaryVisible: false, overlapVisible: false, unevaluatedVisible: false };
    const boundaryVisible = lr.input.boundary_z !== null && lr.input.boundary_z !== undefined;
    const res = lr.result;
    const pen = res.penetration_m, po = res.plan_overlap;
    const overlapVisible = !!((pen !== null && pen > 0) || (po && po.area_m2 > 0 && pen === 0));
    const unevaluatedVisible = res.not_evaluated_area_m2 !== null && res.not_evaluated_area_m2 > 0;
    return { boundaryVisible: boundaryVisible, overlapVisible: overlapVisible, unevaluatedVisible: unevaluatedVisible };
  }

  let renderQueued = false;
  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => { renderQueued = false; render(); });
  }

  function resizeCanvas() {
    const canvas = els.canvas;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (w === 0 || h === 0) return;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.__dpr = dpr;
  }

  function render() {
    const canvas = els.canvas;
    const ctx = canvas.getContext("2d");
    const cssW = canvas.clientWidth, cssH = canvas.clientHeight;
    if (cssW === 0 || cssH === 0) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.scale(canvas.__dpr || 1, canvas.__dpr || 1);
    ctx.fillStyle = "#f6f6f2";
    ctx.fillRect(0, 0, cssW, cssH);

    const cam = state.camera;
    const basis = makeCameraBasis(cam);
    const viewport = { cx: cssW / 2, cy: cssH / 2, focal: (cssH / 2) / Math.tan(FOV / 2), orthoScale: cssH / cam.distance };
    const proj = (pt) => project(basis, cam, pt, viewport);

    const input = currentDisplayInput();
    const result = state.lastResponse ? state.lastResponse.result : null;
    const flags = computeSceneFlags();

    const drawables = [];
    buildGrid(drawables);
    drawables.push({ type: "poly", pts: rectCorners(state.testArea, 0), fill: "rgba(120,120,110,0.08)", stroke: "#555550", lineWidth: 1.2 });

    const towerBox = input.tower;
    if (result && result.geometric_result === "UNSUPPORTED_INPUT") {
      buildTowerWireframe(drawables, towerBox, { stroke: "#b8362a", dash: [6, 4], lineWidth: 2 });
    } else {
      buildTowerFaces(drawables, towerBox, { stroke: "#1b2a4a", fill: "rgba(200,200,195,0.35)", lineWidth: 1.4 });
    }

    if (flags.boundaryVisible) {
      drawables.push({ type: "poly", pts: rectCorners(state.testArea, input.boundary_z), fill: "rgba(74,127,165,0.22)", stroke: "#4a7fa5", lineWidth: 1.4 });
    }

    if (result) {
      const pen = result.penetration_m, po = result.plan_overlap;
      if (pen !== null && pen > 0 && po && po.x_min !== null && po.x_min !== undefined) {
        const overlapBox = { x_min: po.x_min, x_max: po.x_max, y_min: po.y_min, y_max: po.y_max, base_z: towerBox.top_z - pen, top_z: towerBox.top_z };
        buildTowerFaces(drawables, overlapBox, { stroke: "#a8481e", fill: "rgba(217,98,43,0.45)", lineWidth: 1.2 });
      } else if (pen === 0 && po && po.area_m2 > 0 && po.x_min !== null && po.x_min !== undefined) {
        drawables.push({ type: "poly", pts: rectCorners(po, input.boundary_z), fill: null, stroke: "#d9622b", lineWidth: 2, dash: [5, 3] });
      }
      if (flags.unevaluatedVisible) {
        const rects = rectDifference(towerBox, state.testArea);
        rects.forEach((rc, i) => drawables.push({ type: "hatch", pts: rectCorners(rc, towerBox.base_z), label: i === 0 }));
      }
    }

    drawables.forEach((d) => { d.__pts = d.pts.map(proj); d.__depth = avgDepth(d.__pts); });
    const visible = drawables.filter((d) => d.__pts.every((p) => p.visible));
    visible.sort((a, b) => b.__depth - a.__depth);
    visible.forEach((d) => drawItem(ctx, d));

    ctx.restore();

    els.legendBoundaryZ.textContent = flags.boundaryVisible ? "(z = " + fmt(input.boundary_z) + " m)" : "(missing)";
    els.readoutBoundaryZ.textContent = flags.boundaryVisible ? fmt(input.boundary_z) : "—";
    els.readoutTopZ.textContent = fmt(towerBox.top_z);
  }

  // ---------------------------------------------------------------------
  // mouse / touch camera controls
  // ---------------------------------------------------------------------
  function setupInteraction() {
    const canvas = els.canvas;
    let drag = null;
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    canvas.addEventListener("mousedown", (e) => {
      drag = { mode: (e.button === 2 || e.shiftKey) ? "pan" : "orbit", x: e.clientX, y: e.clientY };
      e.preventDefault();
    });
    window.addEventListener("mousemove", (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.x = e.clientX; drag.y = e.clientY;
      if (drag.mode === "orbit") {
        state.camera.yaw -= dx * 0.008;
        state.camera.pitch = clamp(state.camera.pitch + dy * 0.008, 0.05, 1.5);
      } else {
        const basis = makeCameraBasis(state.camera);
        const k = state.camera.distance * 0.0016;
        state.camera.target.x -= basis.right.x * dx * k - basis.up.x * dy * k;
        state.camera.target.y -= basis.right.y * dx * k - basis.up.y * dy * k;
        state.camera.target.z -= basis.right.z * dx * k - basis.up.z * dy * k;
      }
      scheduleRender();
    });
    window.addEventListener("mouseup", () => { drag = null; });
    canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      const factor = Math.exp(e.deltaY * 0.001);
      state.camera.distance = clamp(state.camera.distance * factor, 5, 3000);
      scheduleRender();
    }, { passive: false });

    const ro = new ResizeObserver(() => { resizeCanvas(); scheduleRender(); });
    ro.observe(document.getElementById("canvas-wrap"));
  }

  // ---------------------------------------------------------------------
  // test hooks
  // ---------------------------------------------------------------------
  function getState() {
    const c = state.controls;
    return {
      controls: { height: c.height, xc: c.xc, yc: c.yc, width: c.width, depth: c.depth, base: c.base, boundary: c.boundary, missing: c.missing },
      tower: currentTower(),
      testArea: state.testArea,
      fixtureKey: currentFixtureId(),
      camera: { yaw: state.camera.yaw, pitch: state.camera.pitch, distance: state.camera.distance, projection: state.camera.projection },
      scene: computeSceneFlags(),
    };
  }

  function exposeTestHooks() {
    window.__lab = {
      state: getState,
      setControl: setControl,
      clickFixture: (key) => document.getElementById("btn-" + key.toLowerCase()).click(),
      reset: () => document.getElementById("btn-reset").click(),
      setView: (mode) => document.getElementById(mode === "plan" ? "btn-view-plan" : "btn-view-3d").click(),
      resetView: () => document.getElementById("btn-reset-view").click(),
      whenIdle: whenIdle,
      lastResponse: null,
      lastDownload: null,
      download: doDownload,
    };
    Object.defineProperty(window.__lab, "lastResponse", { get: () => state.lastResponse });
  }

  // ---------------------------------------------------------------------
  // init
  // ---------------------------------------------------------------------
  function cacheEls() {
    els.canvas = document.getElementById("scene-canvas");
    els.pendingBadge = document.getElementById("pending-badge");
    els.errorStrip = document.getElementById("error-strip");
    els.fixtureLabel = document.getElementById("fixture-label");
    els.topElevation = document.getElementById("top-elevation");
    els.badge = document.getElementById("result-badge");
    els.applicability = document.getElementById("applicability-value");
    els.margin = document.getElementById("val-margin");
    els.marginNote = document.getElementById("note-margin");
    els.penetration = document.getElementById("val-penetration");
    els.penetrationNote = document.getElementById("note-penetration");
    els.evalArea = document.getElementById("val-eval-area");
    els.unevalArea = document.getElementById("val-uneval-area");
    els.tolerance = document.getElementById("val-tolerance");
    els.toleranceNote = document.getElementById("note-tolerance");
    els.explanation = document.getElementById("explanation-text");
    els.reasonsList = document.getElementById("reasons-list");
    els.snapTopZ = document.getElementById("snap-top-z");
    els.snapBoundaryZ = document.getElementById("snap-boundary-z");
    els.footer = document.getElementById("result-footer");
    els.techInput = document.getElementById("tech-input");
    els.techResult = document.getElementById("tech-result");
    els.legendBoundaryZ = document.getElementById("legend-boundary-z");
    els.readoutBoundaryZ = document.getElementById("readout-boundary-z");
    els.readoutTopZ = document.getElementById("readout-top-z");
  }

  async function init() {
    cacheEls();
    const resp = await window.ProjectAPI.fetch("/api/fixtures");
    const data = await resp.json();
    state.fixturesData = data;
    state.testArea = data.test_area;

    setupControlBindings();
    setupButtons();
    setupInteraction();
    resizeCanvas();

    applyFixtureByKey("F1");
    resetView();
    exposeTestHooks();
  }

  init();
})();
