// Framework-free THREE scene controller for the "Inside the racks" chip viewer.
// Ported from jcamd/chips/index.html (vanilla JS + THREE), default variants only:
//   CPU = AMD EPYC 9654 "Genoa", GPU = NVIDIA H100 SXM5, DPU = NVIDIA BlueField-3.
// The math, geometry, explode factors, and data-flow paths are unchanged from
// the source; only the DOM wiring was adapted (canvas/label layer injected,
// captions and pin UI delivered through callbacks to the React host).
import { PARTS, FLOW } from "./chipData";

var CPU_SPOTS12 = [
  [-1.78, -1.78], [-0.6, -1.78], [0.6, -1.78], [1.78, -1.78],
  [-1.78, 1.78], [-0.6, 1.78], [0.6, 1.78], [1.78, 1.78],
  [-1.78, -0.58], [1.78, -0.58], [-1.78, 0.58], [1.78, 0.58],
];

var CHIP_DOT = { cpu: "#e08a4c", gpu: "#58b0a6", dpu: "#7aa0d8" };

export function createChipScene(canvas, labelLayer, THREE, opts) {
  opts = opts || {};
  var reducedMotion = !!opts.reducedMotion;
  var level = opts.level || "pro";

  var renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
  } catch {
    return null;
  }
  renderer.setClearColor(0x0e0c09, 1);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.localClippingEnabled = true;

  var scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x0e0c09, 45, 95);
  var camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
  scene.add(new THREE.HemisphereLight(0xf2ede2, 0x14110d, 0.9));
  var dir = new THREE.DirectionalLight(0xffffff, 1.0);
  dir.position.set(6, 14, 8);
  scene.add(dir);
  var dir2 = new THREE.DirectionalLight(0xd08a5a, 0.35);
  dir2.position.set(-8, 6, -6);
  scene.add(dir2);
  var grid = new THREE.GridHelper(60, 60, 0x3a2f22, 0x201a12);
  grid.position.y = -0.65;
  scene.add(grid);

  var layers = [];
  var clickables = [];
  var partMats = {};
  var partMeshes = {};
  var labels = [];
  var allMats = [];
  var chipGroups = {};
  var chip = null;

  function reg(obj, partId, y0, e) {
    obj.position.y = y0;
    obj.userData.baseY = y0;
    obj.userData.explode = e;
    layers.push(obj);
    obj.traverse(function (m) {
      if (m.isMesh) {
        clickables.push(m);
        var pid = m.userData.part || partId;
        if (pid) {
          m.userData.part = pid;
          (partMeshes[pid] = partMeshes[pid] || []).push(m);
          var mt = m.material;
          if (mt && partMats[pid] && partMats[pid].indexOf(mt) < 0) partMats[pid].push(mt);
          else if (mt && !partMats[pid]) partMats[pid] = [mt];
        }
      }
    });
    return obj;
  }
  function mat(color, o) {
    o = o || {};
    var m = new THREE.MeshStandardMaterial({
      color: color,
      roughness: o.rough !== undefined ? o.rough : 0.55,
      metalness: o.metal || 0,
      transparent: true,
      opacity: o.opacity !== undefined ? o.opacity : 1,
      emissive: o.emiss || 0x000000,
      emissiveIntensity: o.ei !== undefined ? o.ei : 0.35,
    });
    m.userData.top = m.opacity;
    m.userData.topei = m.emissiveIntensity;
    allMats.push(m);
    return m;
  }
  function box(w, h, d, material) {
    return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  }
  function addLabel(partId, obj, text, off, ch) {
    var el = document.createElement("div");
    el.className = "chips-label";
    el.innerHTML =
      '<span class="chips-dot" style="background:' + (CHIP_DOT[ch] || "#fff") + '"></span>' + text;
    labelLayer.appendChild(el);
    labels.push({ el: el, obj: obj, off: off || { x: 0, y: 0.9, z: 0 }, part: partId, chip: ch });
  }
  function chipBase(name) {
    var g = new THREE.Group();
    scene.add(g);
    chipGroups[name] = g;
    return g;
  }

  /* ---------------- CPU: AMD EPYC 9654 "Genoa" ---------------- */
  function buildCPU() {
    var g = chipBase("cpu");
    var L = function (pid, obj, off) {
      addLabel(pid, obj, PARTS[pid].name, off || { x: 0, y: 0.6, z: 0 }, "cpu");
    };
    var mPad = mat(0xc9a227, { rough: 0.35, metal: 0.8 });
    var subW = 5.2;
    var padsGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.07, 6);
    var pads = new THREE.InstancedMesh(padsGeo, mPad, 76 * 40);
    var d = new THREE.Object3D(), i = 0;
    for (var r = 0; r < 40; r++)
      for (var c = 0; c < 76; c++) {
        d.position.set(-2.2 + c * 0.059, 0.035, -1.18 + r * 0.06);
        d.updateMatrix();
        pads.setMatrixAt(i++, d.matrix);
      }
    pads.instanceMatrix.needsUpdate = true;
    g.add(reg(pads, "cpu-pads", 0, 0));
    var sub = box(subW, 0.35, subW, mat(0x1e4d2e, { rough: 0.75 }));
    g.add(reg(sub, "cpu-substrate", 0.42, 1.0));
    var dies = new THREE.Group();
    var firstCcd = null, iodMesh = null;
    var ccdM = mat(0xe08a4c, { rough: 0.45, emiss: 0x3a1c08, ei: 0.6 });
    var ccdG = new THREE.BoxGeometry(0.95, 0.24, 0.95);
    CPU_SPOTS12.forEach(function (s) {
      var m = new THREE.Mesh(ccdG, ccdM);
      m.position.set(s[0], 0, s[1]);
      m.userData.part = "cpu-ccd";
      dies.add(m);
      if (!firstCcd) firstCcd = m;
    });
    iodMesh = box(2.0, 0.22, 2.0, mat(0x6b6f75, { rough: 0.5 }));
    iodMesh.userData.part = "cpu-iod";
    dies.add(iodMesh);
    g.add(reg(dies, null, 0.8, 2.3));
    var tim = box(subW, 0.08, subW, mat(0x8a8f96, { rough: 0.4, metal: 0.6, opacity: 0.5 }));
    g.add(reg(tim, "cpu-tim", 1.12, 3.4));
    var ihs = box(subW + 0.3, 0.6, subW + 0.3, mat(0x9aa0a6, { rough: 0.3, metal: 0.9 }));
    g.add(reg(ihs, "cpu-ihs", 1.62, 4.9));
    L("cpu-ihs", ihs, { x: 0, y: 0.75, z: 0 });
    if (firstCcd) L("cpu-ccd", firstCcd);
    if (iodMesh) L("cpu-iod", iodMesh);
    L("cpu-substrate", sub, { x: subW / 2 - 0.6, y: 0.5, z: 0 });
    L("cpu-pads", pads, { x: -(subW / 2 - 0.6), y: 0.35, z: 0 });
  }

  /* ---------------- GPU: NVIDIA H100 SXM5 ---------------- */
  function buildGPU() {
    var g = chipBase("gpu");
    var L = function (pid, obj, off) {
      addLabel(pid, obj, PARTS[pid].name, off || { x: 0, y: 0.6, z: 0 }, "gpu");
    };
    var gpcM = mat(0x1f7a74, { rough: 0.35, emiss: 0x0d3a37, ei: 0.8 });
    var hbmM = mat(0xc8a86a, { rough: 0.5 });
    var hbmG = new THREE.BoxGeometry(1.15, 0.42, 2.1);
    function hbmRow(parent, xs, zs, part) {
      var first = null;
      xs.forEach(function (x) {
        zs.forEach(function (z) {
          var h = new THREE.Mesh(hbmG, hbmM);
          h.position.set(x, 0.03, z);
          h.userData.part = part || "gpu-hbm";
          parent.add(h);
          if (!first) first = h;
        });
      });
      return first;
    }
    function gpcGrid(parent, cx, cz, cols, rows, part) {
      var first = null;
      var gg = new THREE.BoxGeometry(1.55, 0.3, 1.55);
      for (var gr = 0; gr < rows; gr++)
        for (var gc = 0; gc < cols; gc++) {
          var m = new THREE.Mesh(gg, gpcM);
          m.position.set(cx - (cols - 1) * 0.44 + gc * 0.88, 0, cz - (rows - 1) * 0.85 + gr * 1.7);
          m.userData.part = part || "gpu-gpc";
          parent.add(m);
          if (!first) first = m;
        }
      return first;
    }
    var mPad = mat(0xc9a227, { rough: 0.35, metal: 0.7 });
    var pads = new THREE.InstancedMesh(new THREE.BoxGeometry(0.14, 0.06, 0.1), mPad, 60 * 8);
    var d = new THREE.Object3D(), i = 0;
    for (var r = 0; r < 8; r++)
      for (var c = 0; c < 60; c++) {
        d.position.set(-4.2 + c * 0.143, 0.03, -2.9 + r * 0.16);
        d.updateMatrix();
        pads.setMatrixAt(i++, d.matrix);
      }
    pads.instanceMatrix.needsUpdate = true;
    g.add(reg(pads, "gpu-pads", 0, 0));
    var pcbG = new THREE.Group();
    var bw = 9.5;
    var board = box(bw, 0.2, 6.5, mat(0x14261a, { rough: 0.8 }));
    board.userData.part = "gpu-pcb";
    pcbG.add(board);
    var nv = box(bw, 0.12, 0.8, mat(0xc9a227, { rough: 0.35, metal: 0.7 }));
    nv.position.set(0, 0.08, -2.85);
    nv.userData.part = "gpu-nvlink";
    pcbG.add(nv);
    g.add(reg(pcbG, null, 0.25, 0.15));
    var inter = box(7, 0.18, 5, mat(0x2a2f36, { rough: 0.4, metal: 0.3 }));
    g.add(reg(inter, "gpu-interposer", 0.6, 1.25));
    var core = new THREE.Group();
    var firstGpc = gpcGrid(core, 0, -0.4, 4, 2, "gpu-gpc");
    var l2 = box(3.6, 0.28, 0.55, mat(0x3fa39a, { rough: 0.4, emiss: 0x0d3a37, ei: 0.8 }));
    l2.position.set(0, 0, 2.0);
    l2.userData.part = "gpu-l2";
    core.add(l2);
    var firstHbm = hbmRow(core, [-2.62, 2.62], [-1.45, 0, 1.45]);
    g.add(reg(core, null, 0.95, 2.5));
    var lid = box(bw - 2.2, 0.35, 5.3, mat(0xb07b4f, { rough: 0.35, metal: 0.85 }));
    g.add(reg(lid, "gpu-lid", 1.42, 4.3));
    L("gpu-lid", lid);
    L("gpu-gpc", firstGpc);
    L("gpu-l2", l2);
    L("gpu-hbm", firstHbm);
    L("gpu-interposer", inter, { x: bw / 2 - 0.6, y: 0.45, z: 0 });
    L("gpu-nvlink", nv, { x: -bw / 2 + 1.1, y: 0.45, z: 0 });
    L("gpu-pcb", board, { x: bw / 2 - 1.3, y: 0.4, z: 1.6 });
  }

  /* ---------------- DPU: NVIDIA BlueField-3 ---------------- */
  function buildDPU() {
    var g = chipBase("dpu");
    var L = function (pid, obj, off) {
      addLabel(pid, obj, PARTS[pid].name, off || { x: 0, y: 0.55, z: 0 }, "dpu");
    };
    var mBall = mat(0xb9bdc4, { rough: 0.3, metal: 0.9 });
    var bga = new THREE.InstancedMesh(new THREE.SphereGeometry(0.055, 8, 8), mBall, 26 * 18);
    var d = new THREE.Object3D(), i = 0;
    for (var r = 0; r < 18; r++)
      for (var c = 0; c < 26; c++) {
        d.position.set(-2.5 + c * 0.2, 0.03, -1.7 + r * 0.2);
        d.updateMatrix();
        bga.setMatrixAt(i++, d.matrix);
      }
    bga.instanceMatrix.needsUpdate = true;
    g.add(reg(bga, "dpu-bga", 0, 0));
    var cardG = new THREE.Group();
    var card = box(5.5, 0.2, 4.5, mat(0x1a2233, { rough: 0.8 }));
    card.userData.part = "dpu-card";
    cardG.add(card);
    var qsfpM = mat(0x4a5568, { rough: 0.5, metal: 0.6 });
    var firstQ = null;
    [-0.7, 0.7].forEach(function (x) {
      var q = box(1.15, 0.5, 0.9, qsfpM);
      q.position.set(x, 0.32, -2.35);
      q.userData.part = "dpu-qsfp";
      cardG.add(q);
      if (!firstQ) firstQ = q;
    });
    g.add(reg(cardG, null, 0.4, 0.9));
    var soc = new THREE.Group();
    function blk(partId, x, z, w, dd, color) {
      var b = box(w, 0.32, dd, mat(color, { rough: 0.4, emiss: 0x101828, ei: 0.7 }));
      b.position.set(x, 0, z);
      b.userData.part = partId;
      soc.add(b);
      return b;
    }
    var xs = [-1.12, -0.37, 0.37, 1.12], firsts = {};
    function first(partId, mesh) {
      if (!firsts[partId]) firsts[partId] = mesh;
    }
    for (var ci = 0; ci < 4; ci++) first("dpu-cores", blk("dpu-cores", xs[ci], 0.78, 0.68, 0.68, 0x3d5f9e));
    first("dpu-cache", blk("dpu-cache", xs[0], 0, 0.68, 0.68, 0x5b7bc0));
    first("dpu-dpa", blk("dpu-dpa", xs[1], 0, 0.68, 0.68, 0x4663a8));
    first("dpu-crypto", blk("dpu-crypto", xs[2], 0, 0.68, 0.68, 0x7a5fa8));
    first("dpu-regex", blk("dpu-regex", xs[3], 0, 0.68, 0.68, 0x8a6fb0));
    first("dpu-net", blk("dpu-net", -0.745, -0.78, 1.43, 0.68, 0x2f8f83));
    first("dpu-nvme", blk("dpu-nvme", xs[2], -0.78, 0.68, 0.68, 0x9a7a4a));
    first("dpu-pcie", blk("dpu-pcie", xs[3], -0.78, 0.68, 0.68, 0x4a7a9a));
    first("dpu-dram", blk("dpu-dram", 0, -1.32, 3.0, 0.32, 0xc8a86a));
    g.add(reg(soc, null, 0.85, 2.0));
    var hsG = new THREE.Group();
    var base = box(3.4, 0.3, 3.4, mat(0x3a3d42, { rough: 0.6, metal: 0.5 }));
    hsG.add(base);
    var finM = mat(0x4a4d52, { rough: 0.6, metal: 0.5 });
    for (var f = 0; f < 6; f++) {
      var fin = box(3.4, 0.7, 0.16, finM);
      fin.position.set(0, 0.5, -1.25 + f * 0.5);
      hsG.add(fin);
    }
    g.add(reg(hsG, "dpu-hs", 1.45, 3.5));
    L("dpu-hs", base, { x: 0, y: 1.15, z: 0 });
    Object.keys(firsts).forEach(function (pid) {
      L(pid, firsts[pid]);
    });
    L("dpu-card", card, { x: 2.2, y: 0.4, z: 1.2 });
    L("dpu-qsfp", firstQ);
  }

  var BUILDERS = { cpu: buildCPU, gpu: buildGPU, dpu: buildDPU };

  /* ---------------- data-flow packets (from source's flow loop) ---------------- */
  var FLOW_N = 50;
  var flowPts = [];
  var flowGeo = null;
  var flowPoints = null;
  var flowOn = false;
  var flowStep = 0;
  var flowLast = 0;
  var flowPrevT = 0;
  var flowHi = null;
  var tmpV = new THREE.Vector3();

  function flowSprite() {
    var c = document.createElement("canvas");
    c.width = c.height = 64;
    var x = c.getContext("2d");
    var gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, "rgba(255,255,255,1)");
    gr.addColorStop(0.35, "rgba(255,255,255,.85)");
    gr.addColorStop(1, "rgba(255,255,255,0)");
    x.fillStyle = gr;
    x.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  }
  function prepPath(pts) {
    var segs = [],
      total = 0;
    for (var i = 0; i < pts.length - 1; i++) {
      var dx = pts[i + 1][0] - pts[i][0],
        dz = pts[i + 1][3] - pts[i][3];
      var L = Math.sqrt(dx * dx + dz * dz);
      segs.push(L);
      total += L;
    }
    return { pts: pts, segs: segs, total: total };
  }
  function samplePath(path, t, Tcur, out) {
    var dd = ((((t % 1) + 1) % 1) * path.total),
      acc = 0;
    for (var s = 0; s < path.segs.length; s++) {
      var L = path.segs[s];
      if (dd <= acc + L || s === path.segs.length - 1) {
        var f = L ? (dd - acc) / L : 0;
        f = Math.max(0, Math.min(1, f));
        var a = path.pts[s],
          b = path.pts[s + 1];
        out.x = a[0] + (b[0] - a[0]) * f;
        out.z = a[3] + (b[3] - a[3]) * f;
        out.y = a[1] + (b[1] - a[1]) * f + (a[2] + (b[2] - a[2]) * f) * Tcur;
        return out;
      }
      acc += L;
    }
    return out;
  }
  function buildFlow() {
    var c = new THREE.Color();
    c.set(FLOW[chip].color);
    var pos = new Float32Array(FLOW_N * 3),
      col = new Float32Array(FLOW_N * 3);
    for (var k = 0; k < FLOW_N; k++) {
      flowPts.push({ i: k, t: Math.random(), speed: 0.05 + Math.random() * 0.06, path: null });
      var v = 0.75 + Math.random() * 0.45;
      col[k * 3] = Math.min(1, c.r * v);
      col[k * 3 + 1] = Math.min(1, c.g * v);
      col[k * 3 + 2] = Math.min(1, c.b * v);
      pos[k * 3 + 1] = -999;
    }
    flowGeo = new THREE.BufferGeometry();
    flowGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    flowGeo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    var m = new THREE.PointsMaterial({
      size: 0.34,
      map: flowSprite(),
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    flowPoints = new THREE.Points(flowGeo, m);
    flowPoints.frustumCulled = false;
    flowPoints.visible = false;
    scene.add(flowPoints);
    refreshFlowPaths();
  }
  function refreshFlowPaths() {
    var p = prepPath(FLOW[chip].path);
    flowPts.forEach(function (pt) {
      pt.path = p;
    });
  }
  function onFlowStep() {
    var hi = {};
    FLOW[chip].stages[flowStep].parts.forEach(function (pid) {
      hi[pid] = 1;
    });
    flowHi = hi;
    if (opts.onFlowStep) opts.onFlowStep(flowStep);
  }
  function tickFlow() {
    if (!flowOn) return;
    var now = performance.now();
    if (now - flowLast > 4500) {
      flowLast = now;
      flowStep = (flowStep + 1) % 4;
      onFlowStep();
    }
    var dt = Math.min(0.06, Math.max(0.0005, (now - flowPrevT) / 1000));
    flowPrevT = now;
    var pos = flowGeo.attributes.position.array;
    for (var i = 0; i < flowPts.length; i++) {
      var p = flowPts[i];
      p.t = (p.t + p.speed * dt) % 1;
      samplePath(p.path, p.t, T, tmpV);
      pos[p.i * 3] = tmpV.x;
      pos[p.i * 3 + 1] = tmpV.y;
      pos[p.i * 3 + 2] = tmpV.z;
    }
    flowGeo.attributes.position.needsUpdate = true;
  }
  function disposeFlow() {
    if (flowPoints) {
      scene.remove(flowPoints);
      flowGeo.dispose();
      flowPoints.material.map.dispose();
      flowPoints.material.dispose();
      flowPoints = null;
      flowGeo = null;
      flowPts = [];
    }
  }

  /* ---------------- camera + interaction state ---------------- */
  var T = 0.62,
    targetT = 0.62;
  var theta = 0.0,
    phi = 1.02,
    radius = 13,
    baseRadius = 13;
  var cx = 0,
    cy = 2.4;
  var tPhi = null,
    tRadius = null,
    tCx = null,
    tCy = null;
  var tourActive = false;
  var labelsOn = true;
  var spotSet = null;
  var xrayOn = false;
  var clipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 10);
  var clipTarget = 10;

  var paused = false;
  var rafId = 0;
  var disposed = false;

  function setChipInternal(ch) {
    if (chipGroups[chip]) {
      scene.remove(chipGroups[chip]);
      disposeGroup(chipGroups[chip]);
      delete chipGroups[chip];
    }
    disposeFlow();
    labelLayer.innerHTML = "";
    layers = [];
    clickables = [];
    partMats = {};
    partMeshes = {};
    labels = [];
    allMats = [];
    flowHi = null;
    spotSet = null;
    chip = ch;
    BUILDERS[ch]();
    buildFlow();
    // recenter camera for the fresh chip
    theta = 0.0;
    phi = 1.02;
    tPhi = null;
    tourActive = false;
    targetT = 0.62;
    cx = 0;
    cy = 2.4;
    tCx = null;
    tCy = null;
    applyXray();
    resize();
  }
  function disposeGroup(g) {
    g.traverse(function (m) {
      if (m.isMesh) {
        if (m.geometry) m.geometry.dispose();
        var mt = m.material;
        if (mt && mt.dispose && allMats.indexOf(mt) < 0) mt.dispose();
      }
    });
  }

  var dragging = false,
    lx = 0,
    ly = 0,
    moved = 0,
    pinchD = 0;
  function onPointerDown(e) {
    dragging = true;
    lx = e.clientX;
    ly = e.clientY;
    moved = 0;
    tourActive = false;
    tPhi = null;
    tRadius = null;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {}
  }
  function onPointerMove(e) {
    if (dragging) {
      var dx = e.clientX - lx,
        dy = e.clientY - ly;
      moved += Math.abs(dx) + Math.abs(dy);
      theta -= dx * 0.0052;
      phi -= dy * 0.0042;
      phi = Math.max(0.3, Math.min(1.4, phi));
      lx = e.clientX;
      ly = e.clientY;
    }
  }
  function onPointerUp(e) {
    if (dragging && moved < 7) {
      var pid = pick(e.clientX, e.clientY);
      if (pid) {
        pulse(pid);
        if (opts.onPin) opts.onPin(pid);
      } else if (opts.onPin) {
        opts.onPin(null);
      }
    }
    dragging = false;
  }
  function onWheel(e) {
    e.preventDefault();
    baseRadius = Math.max(8, Math.min(40, baseRadius * (1 + e.deltaY * 0.001)));
    tRadius = null;
    tourActive = false;
  }
  function onTouchMove(e) {
    if (e.touches.length === 2) {
      e.preventDefault();
      var dd = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      if (pinchD) baseRadius = Math.max(8, Math.min(40, baseRadius * (pinchD / dd)));
      pinchD = dd;
      tRadius = null;
      tourActive = false;
    }
  }
  function onTouchEnd() {
    pinchD = 0;
  }
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", function () {
    dragging = false;
  });
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("touchmove", onTouchMove, { passive: false });
  canvas.addEventListener("touchend", onTouchEnd);

  var ray = new THREE.Raycaster(),
    ptr = new THREE.Vector2();
  function pick(clientX, clientY) {
    var r = canvas.getBoundingClientRect();
    ptr.x = ((clientX - r.left) / r.width) * 2 - 1;
    ptr.y = -((clientY - r.top) / r.height) * 2 + 1;
    ray.setFromCamera(ptr, camera);
    var hits = ray.intersectObjects(clickables, false);
    for (var i = 0; i < hits.length; i++) {
      var pid = hits[i].object.userData.part;
      if (pid && PARTS[pid]) return pid;
    }
    return null;
  }
  function pulse(pid) {
    if (reducedMotion) return;
    (partMats[pid] || []).forEach(function (mt) {
      mt.userData.topei = 2.4;
      setTimeout(function () {
        mt.userData.topei = 0.35;
      }, 700);
    });
  }

  function applyXray() {
    allMats.forEach(function (m) {
      m.clippingPlanes = xrayOn ? [clipPlane] : null;
      m.needsUpdate = false;
    });
    clipTarget = xrayOn ? 1.1 : 10;
  }

  var v3 = new THREE.Vector3();
  function updateLabels() {
    var w = canvas.clientWidth,
      h = canvas.clientHeight;
    var narrow = w < 700;
    var count = 0;
    labels.forEach(function (L) {
      var show = labelsOn && count < (narrow ? 8 : 99);
      if (!show) {
        L.el.style.display = "none";
        return;
      }
      count++;
      L.obj.getWorldPosition(v3);
      v3.x += L.off.x;
      v3.y += L.off.y;
      v3.z += L.off.z;
      v3.project(camera);
      if (v3.z > 1 || v3.z < -1) {
        L.el.style.display = "none";
        return;
      }
      var sx = (v3.x * 0.5 + 0.5) * w,
        sy = (-v3.y * 0.5 + 0.5) * h;
      L.el.style.display = "block";
      L.el.style.left = sx + "px";
      L.el.style.top = sy + "px";
    });
  }

  function resize() {
    var w = canvas.clientWidth,
      h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    baseRadius = w < 700 ? 20 : 13;
    if (tRadius == null && !tourActive) radius = baseRadius;
  }

  function animate() {
    if (disposed) return;
    if (paused) {
      rafId = 0;
      return;
    }
    rafId = requestAnimationFrame(animate);
    T += (targetT - T) * 0.12;
    tickFlow();
    var i;
    for (i = 0; i < layers.length; i++) {
      var o = layers[i];
      o.position.y = o.userData.baseY + o.userData.explode * T;
    }
    if (tourActive && tPhi != null) phi += (tPhi - phi) * 0.06;
    if (tRadius != null) radius += (tRadius - radius) * 0.08;
    else {
      var wantR = baseRadius;
      radius += (wantR - radius) * 0.08;
    }
    if (tCx != null) cx += (tCx - cx) * 0.08;
    if (tCy != null) cy += (tCy - cy) * 0.08;
    camera.position.set(
      cx + radius * Math.sin(phi) * Math.sin(theta),
      cy + radius * Math.cos(phi),
      radius * Math.sin(phi) * Math.cos(theta)
    );
    camera.lookAt(cx, cy, 0);
    clipPlane.constant += (clipTarget - clipPlane.constant) * 0.12;
    // spotlight / flow-step dimming
    var keys = Object.keys(partMats);
    for (i = 0; i < keys.length; i++) {
      var pid = keys[i];
      var match = !spotSet || spotSet.has(pid);
      var fhi = flowOn && flowHi && flowHi[pid];
      var mats = partMats[pid];
      for (var j = 0; j < mats.length; j++) {
        var mt = mats[j];
        var to = match || fhi ? mt.userData.top : 0.06;
        mt.opacity += (to - mt.opacity) * 0.15;
        var te;
        if (fhi) te = 1.7;
        else if (spotSet) te = match ? 0.9 : 0.05;
        else te = mt.userData.topei;
        mt.emissiveIntensity += (te - mt.emissiveIntensity) * 0.15;
      }
    }
    renderer.render(scene, camera);
    updateLabels();
  }

  function startLoop() {
    if (!rafId && !disposed && !paused) rafId = requestAnimationFrame(animate);
  }

  /* ---------------- public API ---------------- */
  var api = {
    get chip() {
      return chip;
    },
    setChip: function (ch) {
      if (ch === chip) return;
      setChipInternal(ch);
    },
    setExplode: function (t) {
      targetT = Math.max(0, Math.min(1, t));
    },
    setLevel: function (l) {
      level = l;
      if (flowOn) onFlowStep();
    },
    getLevel: function () {
      return level;
    },
    setFlow: function (on) {
      flowOn = on && !reducedMotion;
      if (flowPoints) flowPoints.visible = flowOn;
      if (flowOn) {
        flowStep = 0;
        flowLast = performance.now();
        flowPrevT = flowLast;
        onFlowStep();
      } else {
        flowHi = null;
      }
    },
    setXray: function (on) {
      xrayOn = !!on;
      applyXray();
    },
    setLabels: function (on) {
      labelsOn = !!on;
    },
    pick: pick,
    pin: function (partId) {
      if (partId) {
        api.spotlight([partId]);
        pulse(partId);
      } else {
        api.spotlight(null);
      }
    },
    spotlight: function (partIds) {
      spotSet = partIds && partIds.length ? new Set(partIds) : null;
    },
    tourTo: function (cam, instant) {
      tPhi = cam.phi;
      tRadius = baseRadius * (cam.rScale || 1);
      tCx = 0;
      tCy = cam.cy != null ? cam.cy : 2.4;
      targetT = cam.explode != null ? cam.explode : targetT;
      tourActive = true;
      if (instant || reducedMotion) {
        phi = tPhi;
        radius = tRadius;
        cx = tCx;
        cy = tCy;
        T = targetT;
        tourActive = false;
      }
    },
    stopTour: function () {
      tourActive = false;
      tPhi = null;
      tRadius = null;
      tCx = null;
      tCy = null;
    },
    setPaused: function (p) {
      paused = !!p;
      if (!paused) startLoop();
    },
    resize: resize,
    dispose: function () {
      disposed = true;
      if (rafId) cancelAnimationFrame(rafId);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("touchmove", onTouchMove);
      canvas.removeEventListener("touchend", onTouchEnd);
      disposeFlow();
      if (chipGroups[chip]) disposeGroup(chipGroups[chip]);
      labelLayer.innerHTML = "";
      renderer.dispose();
    },
  };

  setChipInternal(opts.chip || "gpu");
  resize();
  window.addEventListener("resize", resize);
  var _dispose = api.dispose;
  api.dispose = function () {
    window.removeEventListener("resize", resize);
    _dispose();
  };
  startLoop();
  return api;
}
