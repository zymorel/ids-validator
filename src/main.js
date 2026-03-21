/**
 * main.js — IDS Validator (version Vite, sans serveur Flask)
 * Remplace les appels Flask /valider et /ifc par du traitement local (web-ifc + JS).
 */

import * as THREE from "three";
import Chart from "chart.js/auto";
import { runValidation } from "./validator.js";

// ════════════════════════════════════════
//  ÉTAT GLOBAL
// ════════════════════════════════════════
let fileIfc = null, fileIds = null, lastData = null;
let tableRows = [], sortCol = "id", sortAsc = true, activeFilter = "all";
let chartPie = null, chartBar = null;

// Viewer state
let viewerReady = false, initViewerRunning = false;
let viewFilter = "all", wireMode = false, xrayMode = false;
let selectMode = true, measureMode = false;
let selectedId = null;
let scene, camera, renderer, meshMap = {};
let passedSet = new Set(), failedSet = new Set();

// Mesure
let measurePt1 = null, measureObjects = [];

// Clipping
let clipEnabled = false, clipAxis = "y", clipDir = 1;
const clipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
let modelBox = null;

const hiddenIds = new Set();

const COL_PASS = new THREE.Color(0x00e5a0), COL_FAIL = new THREE.Color(0xff3d5a),
      COL_GREY = new THREE.Color(0x3a4450),  COL_SEL  = new THREE.Color(0xf0b429);

// ── Tabs ──────────────────────────────────
document.querySelectorAll(".tbtn").forEach(b => b.addEventListener("click", () => goTab(b.dataset.tab)));
function goTab(id) {
  document.querySelectorAll(".tbtn").forEach(x => x.classList.toggle("active", x.dataset.tab === id));
  document.querySelectorAll(".panel").forEach(x => x.classList.toggle("active", x.id === "tab-" + id));
  if (id === "dashboard" && lastData) renderDashboard(lastData);
  if (id === "viewer" && lastData && !viewerReady && !initViewerRunning) initViewer();
}

// ── Upload ────────────────────────────────
function setupDrop(zId, iId, nId, cb) {
  const z = document.getElementById(zId), i = document.getElementById(iId), n = document.getElementById(nId);
  i.addEventListener("change", () => { if (i.files[0]) cb(i.files[0], z, n); });
  z.addEventListener("dragover", e => { e.preventDefault(); z.classList.add("drag"); });
  z.addEventListener("dragleave", () => z.classList.remove("drag"));
  z.addEventListener("drop", e => { e.preventDefault(); z.classList.remove("drag"); if (e.dataTransfer.files[0]) cb(e.dataTransfer.files[0], z, n); });
}
setupDrop("zIfc", "iIfc", "nIfc", (f, z, n) => { fileIfc = f; n.textContent = f.name; z.classList.add("loaded"); chkBtn(); });
setupDrop("zIds", "iIds", "nIds", (f, z, n) => { fileIds = f; n.textContent = f.name; z.classList.add("loaded"); chkBtn(); });

const btnRun = document.getElementById("btnRun");
function chkBtn() {
  if (fileIfc && fileIds) { btnRun.disabled = false; btnRun.textContent = "▶ Lancer la validation"; }
}

btnRun.addEventListener("click", async () => {
  if (!fileIfc || !fileIds) return;
  btnRun.disabled = true; btnRun.classList.add("loading");
  btnRun.innerHTML = '<span class="spinner"></span>Validation en cours…';
  document.getElementById("errBox").style.display = "none";
  document.getElementById("bilanRow").style.display = "none";
  document.getElementById("specsWrap").style.display = "none";
  viewerReady = false; meshMap = {}; hiddenIds.clear();

  try {
    const ifcBuffer = await fileIfc.arrayBuffer();
    const idsText   = await fileIds.text();

    lastData = await runValidation(ifcBuffer, idsText, (pct, msg) => {
      document.getElementById("sdot").className = "sdot ok";
      document.getElementById("slbl").textContent = msg;
    });

    document.getElementById("sdot").className = "sdot ok";
    document.getElementById("slbl").textContent = `Validation terminée — ${lastData.bilan.total_passed + lastData.bilan.total_failed} éléments testés, ${lastData.bilan.total_failed} non conf.`;
    showResults(lastData);
  } catch (e) {
    document.getElementById("sdot").className = "sdot err";
    document.getElementById("slbl").textContent = "Erreur";
    const b = document.getElementById("errBox"); b.style.display = "block"; b.textContent = "❌ " + e.message;
    console.error(e);
  } finally {
    btnRun.disabled = false; btnRun.classList.remove("loading"); btnRun.textContent = "▶ Relancer la validation";
  }
});

function showResults(d) {
  const tp = d.bilan.total_passed, tf = d.bilan.total_failed, tot = tp + tf, pct = tot > 0 ? Math.round(tp / tot * 100) : 0;
  ["bEl","bSp","bOk","bKo","bPct"].forEach((id, i) =>
    document.getElementById(id).textContent = [d.modele.elements, d.specifications.length, tp, tf, pct + "%"][i]);
  document.getElementById("bilanRow").style.display = "grid";
  const list = document.getElementById("specsList"); list.innerHTML = "";
  d.specifications.forEach(sp => list.appendChild(buildSpecBlock(sp)));
  document.getElementById("specsWrap").style.display = "block";
  buildTableRows(d); buildFilters(d);
  document.getElementById("btnGo3d").onclick = () => { goTab("viewer"); if (!viewerReady && !initViewerRunning) initViewer(); };
  document.getElementById("btnGoDash").onclick = () => goTab("dashboard");
}

function buildSpecBlock(sp) {
  const isPass = sp.status === "PASS", pct = sp.applicable > 0 ? Math.round(sp.passed / sp.applicable * 100) : 100;
  const bar = !isPass && sp.passed === 0 ? "#ff3d5a" : isPass ? "#00e5a0" : `linear-gradient(90deg,#00e5a0 ${pct}%,#ff3d5a ${pct}%)`;
  const mkI = (els, cls) => els.slice(0, 8).map(el =>
    `<div class="el-item ${cls}" data-eid="${el.id}" style="cursor:pointer">
      <span class="el-id">#${el.id}</span><span class="el-type">${el.type}</span>
      <span class="el-nom">${esc(el.nom)}</span></div>`
  ).join("") + (els.length > 8 ? `<div class="more">…+${els.length - 8}</div>` : "");
  let det = "";
  if (sp.passed_elements.length) det += `<div class="dsec"><div class="dsec-title ok">✓ (${sp.passed})</div><div class="el-list">${mkI(sp.passed_elements, "ok")}</div></div>`;
  if (sp.failed_elements.length) det += `<div class="dsec"><div class="dsec-title ko">✗ (${sp.failed})</div><div class="el-list">${mkI(sp.failed_elements, "ko")}</div></div>`;
  const b = document.createElement("div"); b.className = "spec-block";
  b.innerHTML = `<div class="spec-hdr" onclick="this.closest('.spec-block').classList.toggle('open')">
    <span class="sbadge ${isPass ? "pass" : "fail"}">${sp.status}</span>
    <span class="sname">${esc(sp.name)}</span>
    <span class="scnt"><span class="ok">✓${sp.passed}</span>&nbsp;<span class="ko">✗${sp.failed}</span>&nbsp;/&nbsp;${sp.applicable}</span>
    <span class="schev">›</span></div>
    <div class="pbar"><div class="pbar-fill" style="width:${pct}%;background:${bar}"></div></div>
    <div class="sdetail">${det || '<div class="dsec" style="color:var(--txtd)">Aucun élément</div>'}</div>`;
  // Clic sur éléments de la liste
  b.querySelectorAll && setTimeout(() => {
    b.querySelectorAll(".el-item[data-eid]").forEach(item => {
      const eid = +item.dataset.eid;
      const el = lastData?.tous_elements.find(e => e.id === eid) || lastData?.specifications.flatMap(s => [...s.passed_elements, ...s.failed_elements]).find(e => e.id === eid);
      if (el) item.onclick = () => showProps(el);
    });
  }, 0);
  return b;
}

// ════════════════════════════════════════
//  3D VIEWER
// ════════════════════════════════════════
function log3d(msg) { const el = document.getElementById("vLog"); if (el) { el.innerHTML += msg + "<br/>"; el.scrollTop = el.scrollHeight; } }
function setProgress(pct, msg) { document.getElementById("vProgressFill").style.width = pct + "%"; document.getElementById("vLoadSub").textContent = msg; }

async function initViewer() {
  if (viewerReady || !lastData || initViewerRunning) return;
  initViewerRunning = true;
  const ph = document.getElementById("vph"), loading = document.getElementById("vLoading");
  ph.style.display = "none"; loading.classList.remove("hidden");
  document.getElementById("vLog").innerHTML = "";

  try {
    const { IfcAPI } = await import("web-ifc");
    setProgress(5, "WASM init…");
    const ifcApi = new IfcAPI();
    ifcApi.SetWasmPath("/ids-validator/");
    await ifcApi.Init();
    log3d("WASM OK");
    setProgress(25, "Lecture IFC…");

    const buf = await fileIfc.arrayBuffer();
    const modelID = ifcApi.OpenModel(new Uint8Array(buf), { COORDINATE_TO_ORIGIN: false, USE_FAST_BOOLS: false });
    log3d("Modèle ouvert");
    setProgress(40, "Three.js…");

    initThree();
    passedSet = new Set(lastData.ids_3d.passed);
    failedSet = new Set(lastData.ids_3d.failed);

    setProgress(50, "Géométrie…");
    let nMesh = 0, nEl = 0;

    // StreamAllMeshes — même approche qu'IFCstudio, colorie selon statut IDS
    ifcApi.StreamAllMeshes(modelID, (mesh) => {
      const eid = mesh.expressID;
      const geoms = mesh.geometries;
      const col = getCol(eid);
      const group = new THREE.Group(); group.userData.expressID = eid;
      let hasGeom = false;
      for (let i = 0; i < geoms.size(); i++) {
        const pg = geoms.get(i);
        const gd = ifcApi.GetGeometry(modelID, pg.geometryExpressID);
        if (!gd) continue;
        const vArr = ifcApi.GetVertexArray(gd.GetVertexData(), gd.GetVertexDataSize());
        const iArr = ifcApi.GetIndexArray(gd.GetIndexData(), gd.GetIndexDataSize());
        if (!vArr || vArr.length === 0) continue;
        const geo = new THREE.BufferGeometry();
        const pos = new Float32Array(vArr.length / 2), nrm = new Float32Array(vArr.length / 2);
        for (let j = 0; j < vArr.length; j += 6) {
          const k = j / 2;
          pos[k] = vArr[j]; pos[k+1] = vArr[j+1]; pos[k+2] = vArr[j+2];
          nrm[k] = vArr[j+3]; nrm[k+1] = vArr[j+4]; nrm[k+2] = vArr[j+5];
        }
        geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
        geo.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
        geo.setIndex(new THREE.BufferAttribute(iArr, 1));
        geo.applyMatrix4(new THREE.Matrix4().fromArray(pg.flatTransformation));
        const msh = new THREE.Mesh(geo, new THREE.MeshPhongMaterial({ color: col, transparent: true, opacity: passedSet.has(eid) || failedSet.has(eid) ? 0.92 : 0.35, side: THREE.DoubleSide }));
        msh.userData.expressID = eid;
        group.add(msh); hasGeom = true; nMesh++;
      }
      if (hasGeom) { scene.add(group); meshMap[eid] = group; nEl++; }
    });

    log3d(`${nMesh} mesh, ${nEl} éléments`);
    setProgress(90, "Centrage…");
    fitCam();
    modelBox = new THREE.Box3();
    scene.traverse(o => { if (o.isMesh && !o.userData.isMeasure) modelBox.expandByObject(o); });
    ifcApi.CloseModel(modelID);
    setProgress(100, "Modèle 3D prêt");
    setTimeout(() => {
      loading.classList.add("hidden");
      document.getElementById("vOverlay").style.display = "block";
      viewerReady = true;
    }, 400);
  } catch (err) {
    loading.classList.add("hidden"); ph.style.display = "flex";
    ph.innerHTML = `<div class="vph-big">⚠️</div><div class="vph-msg" style="color:var(--red)">Erreur 3D</div>
      <div class="vph-sub" style="color:var(--red)">${esc(err.message)}</div>`;
    console.error(err);
  } finally { initViewerRunning = false; }
}

function getCol(eid) { return failedSet.has(eid) ? COL_FAIL : passedSet.has(eid) ? COL_PASS : COL_GREY; }

function initThree() {
  const zone = document.getElementById("canvasZone"), canvas = document.getElementById("viewerCanvas");
  const W = zone.clientWidth, H = zone.clientHeight;
  scene = new THREE.Scene(); scene.background = new THREE.Color(0x060810);
  camera = new THREE.PerspectiveCamera(45, W / H, 0.01, 100000);
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(W, H); renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  scene.add(new THREE.AmbientLight(0xffffff, .55));
  const d = new THREE.DirectionalLight(0xffffff, .9); d.position.set(1, 2, 1); scene.add(d);
  const d2 = new THREE.DirectionalLight(0x8899ff, .35); d2.position.set(-1, -1, -1); scene.add(d2);
  setupOrbit(canvas, zone); setupRay(canvas, zone);
  new ResizeObserver(() => {
    const W2 = zone.clientWidth, H2 = zone.clientHeight;
    camera.aspect = W2 / H2; camera.updateProjectionMatrix(); renderer.setSize(W2, H2);
  }).observe(zone);
  (function loop() { requestAnimationFrame(loop); updateMeasureLabels(); renderer.render(scene, camera); })();
}

let oSph = { theta: -.5, phi: 1.2, r: 100 }, oTgt = new THREE.Vector3(), oDn = false, oPX = 0, oPY = 0, oBtn = 0;
function updOrbit() {
  if (!camera) return;
  camera.position.set(oTgt.x + oSph.r * Math.sin(oSph.phi) * Math.sin(oSph.theta), oTgt.y + oSph.r * Math.cos(oSph.phi), oTgt.z + oSph.r * Math.sin(oSph.phi) * Math.cos(oSph.theta));
  camera.lookAt(oTgt);
}
updOrbit();
function setupOrbit(canvas, zone) {
  canvas.addEventListener("mousedown", e => { oDn = true; oPX = e.clientX; oPY = e.clientY; oBtn = e.button; });
  window.addEventListener("mouseup", () => oDn = false);
  canvas.addEventListener("mousemove", e => {
    if (!oDn) return;
    const dx = e.clientX - oPX, dy = e.clientY - oPY; oPX = e.clientX; oPY = e.clientY;
    if (oBtn === 0) { oSph.theta -= dx * .005; oSph.phi = Math.max(.05, Math.min(Math.PI - .05, oSph.phi + dy * .005)); }
    else if (oBtn === 2) { const r = new THREE.Vector3().crossVectors(camera.getWorldDirection(new THREE.Vector3()), new THREE.Vector3(0, 1, 0)).normalize(); const s = oSph.r * .001; oTgt.addScaledVector(r, -dx * s); oTgt.addScaledVector(new THREE.Vector3(0, 1, 0), dy * s); }
    updOrbit();
  });
  canvas.addEventListener("wheel", e => { e.preventDefault(); oSph.r = Math.max(.1, oSph.r * (1 + e.deltaY * .001)); updOrbit(); }, { passive: false });
  canvas.addEventListener("contextmenu", e => e.preventDefault());
}
function fitCam() {
  const box = new THREE.Box3();
  scene.traverse(o => { if (o.isMesh && !o.userData.isMeasure) box.expandByObject(o); });
  if (box.isEmpty()) return;
  const center = new THREE.Vector3(), size = new THREE.Vector3();
  box.getCenter(center); box.getSize(size);
  scene.children.forEach(ch => { if (ch.isGroup && !ch.userData.isMeasure) ch.position.sub(center); });
  oTgt.set(0, 0, 0);
  const maxDim = Math.max(size.x, size.y, size.z);
  oSph.r = maxDim * 2.0; oSph.theta = -0.5; oSph.phi = 1.1;
  updOrbit();
}

function setupRay(canvas, zone) {
  const ray = new THREE.Raycaster(), m = new THREE.Vector2(), tt = document.getElementById("vTooltip");
  let hov = null, ckS = { x: 0, y: 0 };
  function allMesh() { const a = []; scene.traverse(o => { if (o.isMesh && o.visible && !o.userData.isMeasure) a.push(o); }); return a; }
  function getEl(eid) { return lastData?.tous_elements.find(e => e.id === eid) || null; }

  canvas.addEventListener("mousemove", e => {
    const rc = zone.getBoundingClientRect();
    m.x = ((e.clientX - rc.left) / rc.width) * 2 - 1; m.y = -((e.clientY - rc.top) / rc.height) * 2 + 1;
    ray.setFromCamera(m, camera);
    const h = ray.intersectObjects(allMesh());
    if (h.length) {
      const eid = h[0].object.userData.expressID;
      if (eid !== hov) {
        hov = eid; const el = getEl(eid);
        document.getElementById("vttType").textContent = el ? el.type : `#${eid}`;
        document.getElementById("vttNom").textContent  = el ? el.nom  : "";
        const st = passedSet.has(eid) ? "ok" : failedSet.has(eid) ? "ko" : "na";
        const vs = document.getElementById("vttStat"); vs.className = "vtt-stat " + st;
        vs.textContent = st === "ok" ? "✓ Conforme" : st === "ko" ? "✗ Non conforme" : "Hors scope";
      }
      tt.style.display = "block";
      const rc2 = zone.getBoundingClientRect();
      tt.style.left = (e.clientX - rc2.left + 14) + "px"; tt.style.top = (e.clientY - rc2.top + 14) + "px";
    } else { hov = null; tt.style.display = "none"; }
  });

  canvas.addEventListener("mousedown", e => { ckS = { x: e.clientX, y: e.clientY }; });
  canvas.addEventListener("mouseup", e => {
    if (Math.abs(e.clientX - ckS.x) > 5 || Math.abs(e.clientY - ckS.y) > 5) return;
    if (e.button !== 0) return;
    const rc = zone.getBoundingClientRect();
    m.x = ((e.clientX - rc.left) / rc.width) * 2 - 1; m.y = -((e.clientY - rc.top) / rc.height) * 2 + 1;
    ray.setFromCamera(m, camera);
    const h = ray.intersectObjects(allMesh());
    if (measureMode) { if (h.length) handleMeasureClick(h[0].point.clone()); }
    else if (selectMode) { if (h.length) selEl(h[0].object.userData.expressID); else deselect(); }
  });
}

function selEl(eid) {
  if (selectedId !== null && meshMap[selectedId]) {
    meshMap[selectedId].traverse(m => { if (!m.isMesh) return; m.material.color.set(getCol(selectedId)); if (xrayMode) { m.material.opacity = 0.12; m.material.depthWrite = false; } });
  }
  selectedId = eid;
  if (meshMap[eid]) {
    meshMap[eid].traverse(m => { if (!m.isMesh) return; m.material.color.set(COL_SEL); if (xrayMode) { m.material.opacity = 1.0; m.material.depthWrite = true; } });
  }
  const el = lastData?.tous_elements.find(e => e.id === eid);
  if (el) showProps(el);
  else { document.getElementById("ppSub").textContent = `#${eid}`; document.getElementById("ppBody").innerHTML = `<div class="pp-empty">Élément #${eid}<br/>(hors scope IDS)</div>`; }
}
function deselect() {
  if (selectedId !== null && meshMap[selectedId]) {
    meshMap[selectedId].traverse(m => { if (!m.isMesh) return; m.material.color.set(getCol(selectedId)); if (xrayMode) { m.material.opacity = 0.12; m.material.depthWrite = false; } });
  }
  selectedId = null;
  document.getElementById("ppSub").textContent = "Cliquer un élément";
  document.getElementById("ppBody").innerHTML = `<div class="pp-empty">🖱️ Cliquer un élément<br/>dans la vue 3D<br/>pour voir ses propriétés</div>`;
}

// Mesure
function getMeasureR() { if (!modelBox) return 0.1; const s = new THREE.Vector3(); modelBox.getSize(s); return Math.max(s.length() * 0.004, 0.01); }
function handleMeasureClick(pt) {
  if (!measurePt1) {
    measurePt1 = pt;
    const r = getMeasureR();
    const sph = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), new THREE.MeshBasicMaterial({ color: 0xf0b429, depthTest: false }));
    sph.position.copy(pt); sph.userData.isMeasure = true; sph.userData.isProvisional = true; scene.add(sph);
  } else {
    scene.children.filter(o => o.userData.isProvisional).forEach(o => scene.remove(o));
    addMeasurement(measurePt1, pt); measurePt1 = null;
  }
}
function addMeasurement(pt1, pt2) {
  const dist = pt1.distanceTo(pt2), r = getMeasureR();
  const mkSph = pt => { const s = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), new THREE.MeshBasicMaterial({ color: 0xf0b429, depthTest: false })); s.position.copy(pt); s.userData.isMeasure = true; scene.add(s); return s; };
  const sph1 = mkSph(pt1), sph2 = mkSph(pt2);
  const geo = new THREE.BufferGeometry().setFromPoints([pt1, pt2]);
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xf0b429, depthTest: false }));
  line.userData.isMeasure = true; scene.add(line);
  const midPt = new THREE.Vector3().addVectors(pt1, pt2).multiplyScalar(0.5);
  const label = document.createElement("div"); label.className = "mlabel"; label.textContent = dist.toFixed(3) + " u";
  document.getElementById("measureContainer").appendChild(label);
  measureObjects.push({ line, sph1, sph2, label, midPt });
}
function clearMeasurements() {
  measureObjects.forEach(m => { if (m.line) scene.remove(m.line); if (m.sph1) scene.remove(m.sph1); if (m.sph2) scene.remove(m.sph2); if (m.label) m.label.remove(); });
  measureObjects = []; measurePt1 = null;
  scene.children.filter(o => o.userData.isMeasure).forEach(o => scene.remove(o));
}
function updateMeasureLabels() {
  if (!camera || !renderer) return;
  const W = renderer.domElement.clientWidth, H = renderer.domElement.clientHeight;
  measureObjects.forEach(m => {
    if (!m.label || !m.midPt) return;
    const v = m.midPt.clone().project(camera);
    if (v.z > 1) { m.label.style.display = "none"; return; }
    m.label.style.left = ((v.x + 1) / 2 * W) + "px"; m.label.style.top = ((1 - v.y) / 2 * H) + "px"; m.label.style.display = "block";
  });
}

// X-Ray
function toggleXray() {
  xrayMode = !xrayMode;
  Object.entries(meshMap).forEach(([eidStr, g]) => {
    const eid = +eidStr;
    g.traverse(m => { if (!m.isMesh) return; if (xrayMode) { m.material.opacity = eid === selectedId ? 1.0 : 0.12; m.material.transparent = true; m.material.depthWrite = eid === selectedId; } else { m.material.opacity = 0.88; m.material.transparent = true; m.material.depthWrite = true; } });
  });
  return xrayMode;
}

// Clipping
function updateClip(val) {
  if (!renderer || !modelBox) return;
  const ax = clipAxis, min = modelBox.min[ax], max = modelBox.max[ax], pos = min + (val / 100) * (max - min);
  const nv = new THREE.Vector3(); nv[ax] = -clipDir; clipPlane.normal.copy(nv); clipPlane.constant = clipDir * pos;
  document.getElementById("clipVal").textContent = Math.round(val) + "%";
}
function toggleClip() {
  clipEnabled = !clipEnabled;
  if (clipEnabled) { renderer.clippingPlanes = [clipPlane]; updateClip(parseInt(document.getElementById("clipSlider").value) || 50); }
  else renderer.clippingPlanes = [];
  document.getElementById("clipPanel").classList.toggle("show", clipEnabled);
  return clipEnabled;
}

// Masquer / Afficher
function hideSelected() { if (selectedId === null) return; hiddenIds.add(selectedId); if (meshMap[selectedId]) meshMap[selectedId].visible = false; }
function showAllElements() {
  hiddenIds.clear();
  Object.entries(meshMap).forEach(([eid, g]) => { const e = +eid; g.visible = viewFilter === "all" || (viewFilter === "ok" && passedSet.has(e)) || (viewFilter === "ko" && failedSet.has(e)); });
}

// Filtres 3D
document.querySelectorAll(".fpill").forEach(p => p.addEventListener("click", () => {
  document.querySelectorAll(".fpill").forEach(x => x.classList.remove("on")); p.classList.add("on");
  viewFilter = p.dataset.f; applyF3d();
}));
function applyF3d() {
  Object.entries(meshMap).forEach(([eid, g]) => {
    const e = +eid;
    if (hiddenIds.has(e)) { g.visible = false; return; }
    g.visible = viewFilter === "all" || (viewFilter === "ok" && passedSet.has(e)) || (viewFilter === "ko" && failedSet.has(e));
  });
}

// Toolbar
document.getElementById("tb-home").addEventListener("click", () => { if (viewerReady) fitCam(); });
document.getElementById("tb-select").addEventListener("click", function () {
  selectMode = !selectMode; this.classList.toggle("active", selectMode);
  if (selectMode && measureMode) { measureMode = false; measurePt1 = null; document.getElementById("tb-measure").classList.remove("active"); document.getElementById("viewerCanvas").classList.remove("crosshair"); }
});
document.getElementById("tb-measure").addEventListener("click", function () {
  measureMode = !measureMode; this.classList.toggle("active", measureMode);
  const canvas = document.getElementById("viewerCanvas");
  if (measureMode) { selectMode = false; document.getElementById("tb-select").classList.remove("active"); canvas.classList.add("crosshair"); }
  else { measurePt1 = null; selectMode = true; document.getElementById("tb-select").classList.add("active"); canvas.classList.remove("crosshair"); }
});
document.getElementById("tb-clip").addEventListener("click", function () { if (!viewerReady) return; const on = toggleClip(); this.classList.toggle("active", on); });
document.getElementById("tb-wire").addEventListener("click", function () { wireMode = !wireMode; this.classList.toggle("active", wireMode); Object.values(meshMap).forEach(g => g.traverse(m => { if (m.isMesh) m.material.wireframe = wireMode; })); });
document.getElementById("tb-xray").addEventListener("click", function () { if (!viewerReady) return; const on = toggleXray(); this.classList.toggle("active", on); });
document.getElementById("tb-iso").addEventListener("click", () => { if (selectedId === null) return; const anyHid = Object.keys(meshMap).some(k => +k !== selectedId && !meshMap[k].visible); if (anyHid) { Object.values(meshMap).forEach(g => g.visible = true); applyF3d(); } else Object.entries(meshMap).forEach(([k, g]) => g.visible = +k === selectedId); });
document.getElementById("tb-hide").addEventListener("click", () => { if (viewerReady) hideSelected(); });
document.getElementById("tb-showall").addEventListener("click", () => { if (viewerReady) showAllElements(); });

function setFilterActive(id) {
  document.querySelectorAll("#tb-all,#tb-ok,#tb-ko").forEach(x => x.classList.remove("active"));
  document.getElementById(id).classList.add("active");
  viewFilter = { "tb-all": "all", "tb-ok": "ok", "tb-ko": "ko" }[id];
  document.querySelectorAll(".fpill").forEach(x => x.classList.toggle("on", x.dataset.f === viewFilter));
  applyF3d();
}
["tb-all","tb-ok","tb-ko"].forEach(id => document.getElementById(id).addEventListener("click", () => setFilterActive(id)));

document.getElementById("clipSlider").addEventListener("input", function () { if (clipEnabled) updateClip(parseInt(this.value)); else document.getElementById("clipVal").textContent = this.value + "%"; });
document.getElementById("btnClipFlip").addEventListener("click", () => { clipDir *= -1; if (clipEnabled) updateClip(parseInt(document.getElementById("clipSlider").value)); });
document.querySelectorAll(".clip-axis-btn[data-axis]").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".clip-axis-btn[data-axis]").forEach(b => b.classList.remove("active"));
    btn.classList.add("active"); clipAxis = btn.dataset.axis;
    if (clipEnabled) updateClip(parseInt(document.getElementById("clipSlider").value));
  });
});

document.getElementById("tb-kb").addEventListener("click", function () { const h = document.getElementById("kbHint"); h.classList.toggle("show"); this.classList.toggle("active", h.classList.contains("show")); });

let bgLight = false;
document.getElementById("tb-bg").addEventListener("click", function () {
  bgLight = !bgLight;
  this.classList.toggle("active", bgLight);
  if (scene) scene.background = new THREE.Color(bgLight ? 0xf5f5f5 : 0x060810);
  document.getElementById("canvasZone").style.background = bgLight ? "#f5f5f5" : "";
});

document.addEventListener("keydown", e => {
  if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
  if (!document.getElementById("tab-viewer").classList.contains("active")) return;
  switch (e.key.toLowerCase()) {
    case "f": if (viewerReady) fitCam(); break;
    case "s": document.getElementById("tb-select").click(); break;
    case "m": document.getElementById("tb-measure").click(); break;
    case "c": document.getElementById("tb-clip").click(); break;
    case "w": document.getElementById("tb-wire").click(); break;
    case "x": document.getElementById("tb-xray").click(); break;
    case "i": document.getElementById("tb-iso").click(); break;
    case "h": document.getElementById("tb-hide").click(); break;
    case "a": document.getElementById("tb-showall").click(); break;
    case "delete": if (viewerReady) clearMeasurements(); break;
    case "escape": if (measureMode) document.getElementById("tb-measure").click(); else if (viewerReady) deselect(); break;
  }
});

// ════════════════════════════════════════
//  PANNEAU PROPRIÉTÉS
// ════════════════════════════════════════
function showProps(el) {
  document.getElementById("ppSub").textContent = `#${el.id} — ${el.type}`;
  const cTxt = el.conforme === true ? "✓ CONFORME" : el.conforme === false ? "✗ NON CONFORME" : "—";
  const cCls = el.conforme === true ? "ok" : el.conforme === false ? "ko" : "";
  let h = `<div class="pid-block">
    <div class="pid-row"><span class="pid-k">Express ID</span><span class="pid-v">#${el.id}</span></div>
    <div class="pid-row"><span class="pid-k">GUID</span><span class="pid-v guid">${el.guid || "—"}</span></div>
    <div class="pid-row"><span class="pid-k">Type IFC</span><span class="pid-v itype">${el.type}</span></div>
    <div class="pid-row"><span class="pid-k">Nom</span><span class="pid-v">${esc(el.nom)}</span></div>
    ${el.etage ? `<div class="pid-row"><span class="pid-k">Étage</span><span class="pid-v etage">${esc(el.etage.nom)}</span></div>` : ""}
    <div class="pid-row"><span class="pid-k">Statut IDS</span><span class="pid-v ${cCls}">${cTxt}</span></div>
  </div>`;
  if (el.classifications?.length) {
    h += `<div style="margin-bottom:9px"><div style="font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:var(--acc);margin-bottom:5px">Classifications</div>`;
    el.classifications.forEach(c => h += `<div class="cl-item"><div><div class="cl-sys">${esc(c.systeme)}</div><div class="cl-code">${esc(c.code)}</div>${c.description ? `<div class="cl-desc">${esc(c.description)}</div>` : ""}</div></div>`);
    h += `</div>`;
  }
  if (el.materiaux?.length) h += `<div style="margin-bottom:9px"><div style="font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:var(--blu);margin-bottom:5px">Matériaux</div>${el.materiaux.map(m => `<span class="mat-tag">${esc(m)}</span>`).join("")}</div>`;
  if (el.psets && Object.keys(el.psets).length) {
    h += `<div><div style="font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:var(--txtd);margin-bottom:5px">Property Sets</div>`;
    Object.entries(el.psets).forEach(([pn, props]) => {
      const pid = "ps_" + pn.replace(/\W/g, "_");
      h += `<div class="pset-block" id="${pid}"><div class="pset-hdr" onclick="document.getElementById('${pid}').classList.toggle('open')">
        <span>${esc(pn)}</span><span style="color:var(--txtd);font-size:9px">${Object.keys(props).length}&nbsp;<span class="pset-chev">›</span></span>
      </div><div class="pset-props">`;
      Object.entries(props).forEach(([k, v]) => {
        let vc = "pv", vd = v === null ? `<em style="color:var(--txtd)">null</em>` : esc(String(v));
        if (v === true) { vc += " bt"; vd = "true"; } if (v === false) { vc += " bf"; vd = "false"; } if (typeof v === "number") vc += " num";
        h += `<div class="pset-row"><span class="pk">${esc(k)}</span><span class="${vc}">${vd}</span></div>`;
      });
      h += `</div></div>`;
    });
    h += `</div>`;
  }
  document.getElementById("ppBody").innerHTML = h;
  const fp = document.querySelector(".pset-block"); if (fp) fp.classList.add("open");
}

// ════════════════════════════════════════
//  DASHBOARD
// ════════════════════════════════════════
function buildTableRows(d) {
  tableRows = [];
  d.specifications.forEach(sp => {
    sp.passed_elements.forEach(el => tableRows.push({ ...el, conforme: true,  specName: sp.name }));
    sp.failed_elements.forEach(el => tableRows.push({ ...el, conforme: false, specName: sp.name }));
  });
}
function buildFilters(d) {
  const types = [...new Set(tableRows.map(r => r.type))].sort();
  const sel = document.getElementById("tType"); sel.innerHTML = '<option value="">Tous les types</option>';
  types.forEach(t => sel.innerHTML += `<option value="${t}">${t.replace("Ifc", "")}</option>`);
  const sp = document.getElementById("tSpec"); sp.innerHTML = '<option value="">Toutes les exigences</option>';
  d.specifications.forEach(s => sp.innerHTML += `<option value="${esc(s.name)}">${esc(s.name)}</option>`);
}
function renderDashboard(d) {
  const tp = d.bilan.total_passed, tf = d.bilan.total_failed, tot = tp + tf, pct = tot > 0 ? Math.round(tp / tot * 100) : 0;
  document.getElementById("gaugePct").textContent = pct + "%";
  const arc = document.getElementById("gaugeArc"), col = pct >= 80 ? "#00e5a0" : pct >= 50 ? "#f0b429" : "#ff3d5a";
  arc.style.stroke = col; arc.style.strokeDashoffset = 173 - (173 * pct / 100); document.getElementById("gaugePct").style.color = col;
  if (chartPie) chartPie.destroy();
  chartPie = new Chart(document.getElementById("chartPie"), { type: "doughnut", data: { labels: ["Conformes","Non conformes"], datasets: [{ data: [tp, tf], backgroundColor: ["#00e5a030","#ff3d5a30"], borderColor: ["#00e5a0","#ff3d5a"], borderWidth: 2 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom", labels: { color: "#b8c0cc", font: { family: "JetBrains Mono", size: 9 }, boxWidth: 10, padding: 8 } } }, cutout: "60%" } });
  const stats = d.stats_par_type, types = Object.keys(stats);
  if (chartBar) chartBar.destroy();
  chartBar = new Chart(document.getElementById("chartBar"), { type: "bar", data: { labels: types.map(t => t.replace("Ifc", "")), datasets: [{ label: "✓", data: types.map(t => stats[t].passed), backgroundColor: "#00e5a030", borderColor: "#00e5a0", borderWidth: 1 }, { label: "✗", data: types.map(t => stats[t].failed), backgroundColor: "#ff3d5a30", borderColor: "#ff3d5a", borderWidth: 1 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: "#b8c0cc", font: { family: "JetBrains Mono", size: 9 }, boxWidth: 10, padding: 6 } } }, scales: { x: { ticks: { color: "#3d4550", font: { size: 9 }, maxRotation: 30 }, grid: { color: "#1c2128" } }, y: { ticks: { color: "#3d4550", font: { size: 9 } }, grid: { color: "#1c2128" }, beginAtZero: true } } } });
  renderTable();
}
function renderTable() {
  const srch = document.getElementById("tSearch").value.toLowerCase(), tp = document.getElementById("tType").value, sp = document.getElementById("tSpec").value;
  let rows = tableRows.filter(r => {
    if (activeFilter === "ok" && !r.conforme) return false; if (activeFilter === "ko" && r.conforme) return false;
    if (tp && r.type !== tp) return false; if (sp && r.specName !== sp) return false;
    if (srch) { const h = `${r.id} ${r.guid || ""} ${r.nom} ${r.type} ${r.etage?.nom || ""} ${r.specName}`.toLowerCase(); if (!h.includes(srch)) return false; }
    return true;
  });
  rows.sort((a, b) => {
    let va, vb;
    if (sortCol === "id") { va = +a.id; vb = +b.id; } else if (sortCol === "conforme") { va = a.conforme ? 0 : 1; vb = b.conforme ? 0 : 1; }
    else if (sortCol === "etage") { va = a.etage?.nom || ""; vb = b.etage?.nom || ""; }
    else if (sortCol === "classif") { va = a.classifications?.[0]?.code || ""; vb = b.classifications?.[0]?.code || ""; }
    else if (sortCol === "mat") { va = a.materiaux?.[0] || ""; vb = b.materiaux?.[0] || ""; }
    else if (sortCol === "spec") { va = a.specName || ""; vb = b.specName || ""; }
    else { va = String(a[sortCol] || ""); vb = String(b[sortCol] || ""); }
    return sortAsc ? (va > vb ? 1 : va < vb ? -1 : 0) : (va < vb ? 1 : va > vb ? -1 : 0);
  });
  const okN = rows.filter(r => r.conforme).length, koN = rows.filter(r => !r.conforme).length;
  document.getElementById("tblCount").textContent = `${rows.length} lignes`;
  document.getElementById("tblFoot").textContent = `${rows.length} / ${tableRows.length} éléments`;
  document.getElementById("tblOkCount").textContent = `✓ ${okN}`; document.getElementById("tblKoCount").textContent = `✗ ${koN}`;
  const body = document.getElementById("tblBody");
  if (!rows.length) { body.innerHTML = `<tr><td colspan="9" style="text-align:center;color:var(--txtd);padding:30px">Aucun résultat</td></tr>`; return; }
  body.innerHTML = rows.map(r => {
    const cl = r.classifications?.[0], clTxt = cl ? `${esc(cl.code)} <span style="color:var(--txtd);font-size:9px">${esc(cl.systeme)}</span>` : `<span style="color:var(--txtd)">—</span>`;
    const mat = (r.materiaux || []).slice(0, 2).join(", ") || `<span style="color:var(--txtd)">—</span>`;
    const st = r.conforme ? "ok" : "ko";
    return `<tr data-eid="${r.id}" data-idx="${rows.indexOf(r)}">
      <td class="c-id">#${r.id}</td><td class="c-guid" title="${r.guid || ""}">${(r.guid || "—").substring(0, 14)}…</td>
      <td class="c-type">${r.type.replace("Ifc", "")}</td><td title="${esc(r.nom)}">${esc(r.nom)}</td>
      <td class="c-etage">${r.etage?.nom || "—"}</td><td class="c-spec" title="${esc(r.specName)}">${esc(r.specName)}</td>
      <td class="c-cl">${clTxt}</td><td title="${(r.materiaux || []).join(", ")}">${mat}</td>
      <td><span class="stat-badge ${st}">${st === "ok" ? "✓ Conforme" : "✗ Non conforme"}</span></td>
    </tr>`;
  }).join("");
  // Clic sur ligne du tableau
  body.querySelectorAll("tr[data-eid]").forEach(tr => {
    const eid = +tr.dataset.eid;
    tr.addEventListener("click", () => {
      const el = lastData?.tous_elements.find(e => e.id === eid) || tableRows.find(r => r.id === eid);
      if (el) showProps(el);
      if (viewerReady) selEl(eid);
      goTab("viewer");
    });
  });
}
["tSearch","tType","tSpec"].forEach(id => document.getElementById(id).addEventListener("input", renderTable));
document.querySelectorAll(".pill").forEach(p => p.addEventListener("click", () => { document.querySelectorAll(".pill").forEach(x => x.classList.remove("on")); p.classList.add("on"); activeFilter = p.dataset.f; renderTable(); }));
document.querySelectorAll("thead th[data-col]").forEach(th => {
  th.addEventListener("click", () => {
    const col = th.dataset.col; if (sortCol === col) sortAsc = !sortAsc; else { sortCol = col; sortAsc = true; }
    document.querySelectorAll("thead th[data-col]").forEach(h => h.classList.remove("sorted")); th.classList.add("sorted"); th.querySelector(".si").textContent = sortAsc ? "↑" : "↓"; renderTable();
  });
});

// Exports
document.getElementById("btnJson").addEventListener("click", () => { if (lastData) dl(new Blob([JSON.stringify(lastData, null, 2)], { type: "application/json" }), "ids_validation.json"); });
document.getElementById("btnCsv").addEventListener("click", () => { if (!lastData) return; const r = ["Exigence,Statut,Applicables,Conformes,Non-conformes"]; lastData.specifications.forEach(sp => r.push([`"${sp.name}"`, sp.status, sp.applicable, sp.passed, sp.failed].join(","))); dl(new Blob([r.join("\n")], { type: "text/csv" }), "ids_specs.csv"); });
document.getElementById("btnTblCsv").addEventListener("click", () => { if (!tableRows.length) return; const r = ["ID,GUID,Type,Nom,Étage,Exigence IDS,Classification,Matériaux,Statut"]; tableRows.forEach(row => { const cl = row.classifications?.[0]; r.push([row.id, row.guid || "", row.type, `"${(row.nom || "").replace(/"/g, '""')}"`, row.etage?.nom || "", `"${(row.specName || "").replace(/"/g, '""')}"`, cl ? `${cl.code} (${cl.systeme})` : "", (row.materiaux || []).join("|"), row.conforme ? "Conforme" : "Non conforme"].join(",")); }); dl(new Blob([r.join("\n")], { type: "text/csv" }), "tableau_recap.csv"); });

function dl(b, n) { const u = URL.createObjectURL(b); Object.assign(document.createElement("a"), { href: u, download: n }).click(); URL.revokeObjectURL(u); }
function esc(s) { return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
