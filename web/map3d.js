// Night City 3D map (three.js), built from the game map data.
// (web/map3d: world.glb, buildings.bin, roads.bin and manifest.json, exported
// from the game files by open77_3dmap).
// Coordinates: game (x east, y north, z up) -> scene (x, z, -y).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';

const DATA = 'map3d/';
const THEME = {
  background: 0x07080c,
  terrain: 0x17131b, cliffs: 0x241b24, water: 0x0b1c29,
  roads: 0x3b2226, roadBorders: 0xff6158, metro: 0x7a5418, landmarks: 0xff6158,
  building: 0x1f2230, buildingTop: 0x2c3042,
  route: 0x5ef6ff, player: 0xe8fdff,
};
// Minimap mode (Car Mode navigation): flat like the in-game minimap, with teal roads and a yellow route.
const FLAT_THEME = {
  background: 0x05080b, terrain: 0x0a1014, cliffs: 0x0d1418, water: 0x061620,
  roads: 0x1c4a52, roadBorders: 0x3fc6cf, metro: 0x14343a, landmarks: 0x1c4a52,
  route: 0xf5d442,
};
const DISTRICT_NAMES = {
  city_center: 'City Center', santo_domingo: 'Santo Domingo', heywood: 'Heywood', westbrook: 'Westbrook',
  watson: 'Watson', pacifica: 'Pacifica', ep1_dogtown: 'Dogtown', badlands: 'Badlands', north_badlands: 'Badlands',
  south_badlands: 'Badlands', spaceport: 'NCX Spaceport', morro_rock: 'Morro Rock',
};

// Flat map: everything stays on the ground (y = 0). Icons, route and V marker no longer float above it.
const FLAT_Y = 0.0005;   // Vertical scale of the flattened city.
const LAYER_ORDER = { terrain: 0, cliffs: 0, water: 1, metro: 3, landmarks: 3, roads: 4, roadBorders: 5 };
const toScene = (x, y) => new THREE.Vector3(x, 0, -y);
const IS_MOBILE = matchMedia('(pointer: coarse)').matches || /Android|iPhone|iPad/i.test(navigator.userAgent);
const rad = (d) => (d * Math.PI) / 180;

function spriteTex(draw, size = 64) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  draw(g, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const MAX_DIST = 18000;        // Maximum zoom-out distance: the entire city fits on screen.
const markerTexCache = new Map();
function markerTex(color, shape, v) {
  const icon = v && typeof mapIconImage === 'function';
  if (icon) {
    const k = 'i' + v + color;
    if (markerTexCache.has(k)) return markerTexCache.get(k);
    const c = document.createElement('canvas');
    c.width = c.height = 96;
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    const paint = () => {
      const img = mapIconImage(v);
      const g = c.getContext('2d');
      g.clearRect(0, 0, 96, 96);
      if (img) drawMapIcon(g, img, color, 48, 48, 84, false, v);
      else { g.fillStyle = color; g.beginPath(); g.arc(48, 48, 14, 0, Math.PI * 2); g.fill(); }
      t.needsUpdate = true;
    };
    paint();
    if (!mapIconImage(v, paint)) { /* Redraw when the image finishes loading. */ }
    markerTexCache.set(k, t);
    return t;
  }
  const k = color + shape;
  if (markerTexCache.has(k)) return markerTexCache.get(k);
  const t = spriteTex((g, s) => {
    const m = s / 2, r = s * 0.3;
    g.shadowColor = color; g.shadowBlur = s * 0.15;
    g.fillStyle = color;
    g.beginPath();
    if (shape === 'square') g.rect(m - r * 0.8, m - r * 0.8, r * 1.6, r * 1.6);
    else if (shape === 'circle') g.arc(m, m, r * 0.85, 0, Math.PI * 2);
    else { g.moveTo(m, m - r); g.lineTo(m + r, m); g.lineTo(m, m + r); g.lineTo(m - r, m); g.closePath(); }
    g.fill();
    g.shadowBlur = 0;
    g.strokeStyle = 'rgba(7,8,12,.9)'; g.lineWidth = s * 0.05;
    g.beginPath(); g.arc(m, m, r * 0.32, 0, Math.PI * 2); g.stroke();
  });
  markerTexCache.set(k, t);
  return t;
}

class HoloMap3D {
  constructor() {
    this.ready = false;
    this.visible = false;
    this.container = null;
    this.follow = true;
    this.headingUp = false;
    this.elev = 89.5;           // 89.5 = de cima (2D); ~35 = 3D
    this.dist = 900;            // Camera distance (m).
    this.bearing = 0;           // Camera bearing (degrees, 0 = north).
    this.target = new THREE.Vector3();
    this.player = { x: 0, y: 0, z: 0, hdg: 0, ok: false };
    this.cur = { x: 0, y: 0, z: 0, hdg: 0 };
    this.pois = [];
    this.waypoint = null;
    this.route = null;          // { pts: [[x,y,z]...], dist }
    this.listeners = {};
    this.quality = (() => { try { return localStorage.getItem('neuroport.map3d.q') || (IS_MOBILE ? 'lite' : 'full'); } catch { return IS_MOBILE ? 'lite' : 'full'; } })();
  }

  on(ev, fn) { (this.listeners[ev] ||= []).push(fn); }
  emit(ev, a) { for (const f of this.listeners[ev] || []) f(a); }

  async init() {
    const canvas = document.createElement('canvas');
    canvas.className = 'map3d-canvas';
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !IS_MOBILE, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, IS_MOBILE ? 1.5 : 2));
    // If the phone loses its WebGL context (video-memory pressure), report it and recover.
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.lost = true; this.emit('lost'); });
    canvas.addEventListener('webglcontextrestored', () => { this.lost = false; this.emit('restored'); });
    this.renderer.setClearColor(THEME.background);
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(THEME.background, 2500, 7000);
    this.camera = new THREE.PerspectiveCamera(40, 1, 5, 20000);
    this.scene.add(new THREE.HemisphereLight(0xb8c8ff, 0x2a1015, 1.6));
    const sun = new THREE.DirectionalLight(0xffe0d8, 1.4);
    sun.position.set(-1, 2, 1.2);
    this.scene.add(sun);

    this.labels = document.createElement('div');
    this.labels.className = 'map3d-labels';

    const man = await (await fetch(DATA + 'manifest.json')).json();
    this.manifest = man;
    await Promise.all([this.loadWorld(), this.loadBuildings(man), this.loadRoads(man)]);
    this.buildDistrictLabels(man);
    this.buildDynamic();
    this.bindInput();
    this.ready = true;
    this.lastT = performance.now();
    requestAnimationFrame((t) => this.loop(t));
    this.emit('ready');
  }

  async loadWorld() {
    const gltf = await new GLTFLoader().loadAsync(DATA + 'world.glb');
    const mats = this.mats = {};
    const mat = (layer) => {
      if (mats[layer]) return mats[layer];
      const color = THEME[layer] ?? THEME.terrain;
      let m;
      if (layer === 'roadBorders') m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.45, depthWrite: false });
      else if (layer === 'roads' || layer === 'water') m = new THREE.MeshBasicMaterial({ color });
      else m = new THREE.MeshLambertMaterial({ color, flatShading: true });
      // Flat rendering: draw order determines what appears on top (no depth-buffer conflicts).
      m.depthTest = false; m.depthWrite = false;
      return (mats[layer] = m);
    };
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      let layer = o.name;
      for (let p = o; p; p = p.parent) if (THEME[p.name] !== undefined) { layer = p.name; break; }
      o.material = mat(layer);
      o.renderOrder = LAYER_ORDER[layer] ?? 0;
    });
    gltf.scene.scale.y = FLAT_Y;
    this.scene.add(gltf.scene);
  }

  async loadBuildings(man) {
    const buf = await (await fetch(DATA + man.buildings.file)).arrayBuffer();
    const dv = new DataView(buf);
    const box = new THREE.BoxGeometry(1, 1, 1);
    const roof = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const matBox = new THREE.MeshLambertMaterial({ color: THEME.building, flatShading: true });
    const matRoof = new THREE.MeshBasicMaterial({ color: THEME.buildingTop, depthTest: false, depthWrite: false });
    const m4 = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
    const up = new THREE.Vector3();
    this.buildingMeshes = [];
    this.roofMeshes = [];
    for (const d of man.buildings.districts) {
      const boxes = new THREE.InstancedMesh(box, matBox, d.count);
      const roofs = new THREE.InstancedMesh(roof, matRoof, d.count);
      for (let i = 0; i < d.count; i++) {
        const o = (d.offset + i) * 16;
        p.set(
          d.min[0] + (dv.getUint16(o, true) / 65535) * d.span[0],
          d.min[1] + (dv.getUint16(o + 2, true) / 65535) * d.span[1],
          d.min[2] + (dv.getUint16(o + 4, true) / 65535) * d.span[2],
        );
        q.set(dv.getInt8(o + 6) / 127, dv.getInt8(o + 7) / 127, dv.getInt8(o + 8) / 127, dv.getInt8(o + 9) / 127).normalize();
        sc.set(
          Math.max(0.5, (dv.getUint16(o + 10, true) / 65535) * d.maxSize),
          Math.max(0.5, (dv.getUint16(o + 12, true) / 65535) * d.maxSize),
          Math.max(0.5, (dv.getUint16(o + 14, true) / 65535) * d.maxSize),
        );
        m4.compose(p, q, sc);
        boxes.setMatrixAt(i, m4);
        up.set(0, sc.y / 2, 0).applyQuaternion(q);
        m4.compose(p.add(up), q, sc);
        roofs.setMatrixAt(i, m4);
      }
      boxes.computeBoundingSphere(); roofs.computeBoundingSphere();
      boxes.frustumCulled = roofs.frustumCulled = true;
      this.scene.add(boxes); this.scene.add(roofs);
      this.buildingMeshes.push(boxes); this.roofMeshes.push(roofs);
    }
    this.applyQuality();
  }

  // Buildings: draw only their footprint (a flattened roof), never full 3D geometry.
  applyQuality() {
    for (const m of this.buildingMeshes || []) m.visible = false;
    for (const m of this.roofMeshes || []) { m.visible = !this.flat; m.scale.y = FLAT_Y; m.renderOrder = 2; }
  }
  // Minimap: no buildings; use the in-game minimap colors.
  setFlat(on) {
    on = !!on;
    if (this.flat === on) return;
    this.flat = on;
    const th = on ? { ...THEME, ...FLAT_THEME } : THEME;
    for (const [layer, m] of Object.entries(this.mats || {})) m.color.setHex(th[layer] ?? th.terrain);
    if (this.renderer) this.renderer.setClearColor(th.background);
    if (this.scene && this.scene.fog) this.scene.fog.color.setHex(th.background);
    if (this.routeMat) { this.routeMat.color.setHex(th.route); this.routeMat.dashed = !on; this.routeMat.needsUpdate = true; }
    this.applyQuality();
  }
  // Dynamic filter: show more detail at closer zoom levels (tier 0 always, tier 1 mid-range, tier 2 close-up).
  tierLimit() {
    return this.dist <= 1400 ? 2 : this.dist <= 3600 ? 1 : 0;
  }
  setQuality(q) {
    this.quality = q;
    try { localStorage.setItem('neuroport.map3d.q', q); } catch { /* ok */ }
    this.applyQuality();
  }

  async loadRoads(man) {
    const buf = await (await fetch(DATA + man.roads.file)).arrayBuffer();
    const T = { '<f4': Float32Array, '<u4': Uint32Array, '<u2': Uint16Array, '|u1': Uint8Array };
    const R = {};
    for (const [k, a] of Object.entries(man.roads.arrays)) R[k] = new T[a.type](buf, a.offset, a.length);
    this.roads = R;
    // Spatial grid (100 m cells), containing only main road segments.
    const grid = new Map();
    const n = R.laneOffset.length;
    const add = (x, y, i, k) => {
      const key = `${Math.floor(x / 100)},${Math.floor(y / 100)}`;
      let cell = grid.get(key);
      if (!cell) grid.set(key, (cell = []));
      if (cell[cell.length - 2] !== i || cell[cell.length - 1] !== k) cell.push(i, k);
    };
    for (let i = 0; i < n; i++) {
      if (!R.laneMain[i]) continue;
      const o = R.laneOffset[i], c = R.laneCount[i];
      for (let k = 0; k + 1 < c; k++) {
        const ax = R.points[(o + k) * 3], ay = R.points[(o + k) * 3 + 1];
        const bx = R.points[(o + k + 1) * 3], by = R.points[(o + k + 1) * 3 + 1];
        const len = Math.hypot(bx - ax, by - ay), steps = Math.max(1, Math.ceil(len / 40));
        for (let st = 0; st <= steps; st++) add(ax + ((bx - ax) * st) / steps, ay + ((by - ay) * st) / steps, i, k);
      }
    }
    this.laneGrid = grid;
  }

  // ---------- GPS: A* across traffic lanes ----------
  nearestLane(x, y, hdg, maxCells = 3) {
    const R = this.roads;
    let best = -1, bk = 0, bd = Infinity, proj = null;
    for (let r = 0; r <= maxCells && best < 0; r++) {
      const cx = Math.floor(x / 100), cy = Math.floor(y / 100);
      for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) {
        const cell = this.laneGrid.get(`${cx + dx},${cy + dy}`);
        if (!cell) continue;
        for (let j = 0; j < cell.length; j += 2) {
          const i = cell[j], k = cell[j + 1], o = R.laneOffset[i];
          const ax = R.points[(o + k) * 3], ay = R.points[(o + k) * 3 + 1], az = R.points[(o + k) * 3 + 2];
          const bx = R.points[(o + k + 1) * 3], by = R.points[(o + k + 1) * 3 + 1], bz = R.points[(o + k + 1) * 3 + 2];
          const vx = bx - ax, vy = by - ay, L2 = vx * vx + vy * vy || 1e-6;
          const tt = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / L2));
          const qx = ax + vx * tt, qy = ay + vy * tt;
          let d = Math.hypot(qx - x, qy - y);
          if (hdg != null) {
            // Prefer road segments that follow the car travel direction.
            const lb = (Math.atan2(vx, vy) * 180) / Math.PI;
            const diff = Math.abs(((lb - hdg + 540) % 360) - 180);
            if (diff > 100) d += 25;
          }
          if (d < bd) { bd = d; best = i; bk = k; proj = [qx, qy, az + (bz - az) * tt]; }
        }
      }
    }
    return best < 0 ? null : { lane: best, k: bk, d: bd, proj };
  }

  computeRoute() {
    if (!this.roads || !this.waypoint || !this.player.ok) { this.setRoute(null); return; }
    const R = this.roads;
    const s = this.nearestLane(this.player.x, this.player.y, this.player.hdg);
    // The destination may be inside a building or far from a road; search for the nearest segment within about 4 km.
    const g = this.nearestLane(this.waypoint.x, this.waypoint.y, null, 40);
    if (!s || !g) { this.setRoute(null); return; }
    const endPt = (i) => { const o = R.laneOffset[i] + R.laneCount[i] - 1; return [R.points[o * 3], R.points[o * 3 + 1]]; };
    const [gx, gy] = [this.waypoint.x, this.waypoint.y];
    const n = R.laneOffset.length;
    const gScore = new Float64Array(n).fill(Infinity), came = new Int32Array(n).fill(-1);
    const heap = [];   // [f, lane]
    const push = (f, i) => {
      heap.push([f, i]);
      let c = heap.length - 1;
      while (c > 0) { const p = (c - 1) >> 1; if (heap[p][0] <= heap[c][0]) break; [heap[p], heap[c]] = [heap[c], heap[p]]; c = p; }
    };
    const pop = () => {
      const top = heap[0], last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        let c = 0;
        for (;;) {
          const l = 2 * c + 1, r = l + 1;
          let m = c;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === c) break;
          [heap[m], heap[c]] = [heap[c], heap[m]]; c = m;
        }
      }
      return top;
    };
    const cost = (i) => R.laneLength[i] / Math.max(6, R.laneSpeed[i] || 10);
    gScore[s.lane] = 0;
    push(0, s.lane);
    let found = -1, iter = 0;
    while (heap.length && iter++ < 200000) {
      const [, i] = pop();
      if (i === g.lane) { found = i; break; }
      for (let k = R.outStart[i]; k < R.outStart[i + 1]; k++) {
        const j = R.outLanes[k];
        const t = gScore[i] + cost(j);
        if (t < gScore[j]) {
          gScore[j] = t; came[j] = i;
          const [ex, ey] = endPt(j);
          push(t + Math.hypot(ex - gx, ey - gy) / 30, j);
        }
      }
    }
    if (found < 0) { this.setRoute(null); return; }
    const lanes = [];
    for (let i = found; i >= 0; i = came[i]) { lanes.push(i); if (i === s.lane) break; }
    lanes.reverse();
    const pts = [[this.player.x, this.player.y, this.player.z], s.proj];
    lanes.forEach((i, idx) => {
      const o = R.laneOffset[i], c = R.laneCount[i];
      const last = idx === lanes.length - 1;
      const from = idx === 0 ? s.k + 1 : 0, to = last ? g.k : c - 1;
      if (idx === 0 && last && g.k < s.k) return;  // Target is behind on the same lane.
      for (let k = from; k <= to; k++) pts.push([R.points[(o + k) * 3], R.points[(o + k) * 3 + 1], R.points[(o + k) * 3 + 2]]);
      if (last) pts.push(g.proj);
    });
    pts.push([gx, gy, this.waypoint.z ?? pts[pts.length - 1][2]]);
    let dist = 0;
    for (let i = 1; i < pts.length; i++) dist += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    this.setRoute({ pts, dist, at: performance.now(), wpKey: this.wpKey() });
  }

  wpKey() { return this.waypoint ? `${Math.round(this.waypoint.x)},${Math.round(this.waypoint.y)}` : ''; }

  setRoute(r) {
    this.route = r;
    if (this.routeLine) { this.scene.remove(this.routeLine); this.routeLine.geometry.dispose(); this.routeLine = null; }
    if (r) {
      const pos = [];
      for (const p of r.pts) pos.push(p[0], 0.5, -p[1]);
      const geo = new LineGeometry();
      geo.setPositions(pos);
      this.routeLine = new Line2(geo, this.routeMat);
      this.routeLine.computeLineDistances();
      this.routeLine.renderOrder = 6;
      this.scene.add(this.routeLine);
    }
    this.emit('route', r ? { dist: r.dist } : null);
  }

  // Remaining route distance and player deviation.
  routeProgress() {
    const r = this.route;
    if (!r) return null;
    let best = 0, bd = Infinity;
    for (let i = 0; i < r.pts.length; i++) {
      const d = Math.hypot(r.pts[i][0] - this.player.x, r.pts[i][1] - this.player.y);
      if (d < bd) { bd = d; best = i; }
    }
    let rem = bd;
    for (let i = best + 1; i < r.pts.length; i++) rem += Math.hypot(r.pts[i][0] - r.pts[i - 1][0], r.pts[i][1] - r.pts[i - 1][1]);
    return { remaining: rem, off: bd };
  }

  // ---------- Dynamic objects ----------
  buildDynamic() {
    this.routeMat = new LineMaterial({ color: THEME.route, linewidth: 5, transparent: true, opacity: 0.95, dashed: true, dashSize: 18, gapSize: 6, depthTest: false });
    const arrowTex = spriteTex((g, s) => {
      g.translate(s / 2, s / 2);
      g.fillStyle = 'rgba(94,246,255,.18)';
      g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, s * 0.48, -Math.PI / 2 - 0.5, -Math.PI / 2 + 0.5); g.closePath(); g.fill();
      g.shadowColor = '#5ef6ff'; g.shadowBlur = s * 0.12;
      g.fillStyle = '#e8fdff';
      g.beginPath(); g.moveTo(0, -s * 0.2); g.lineTo(s * 0.15, s * 0.17); g.lineTo(0, s * 0.08); g.lineTo(-s * 0.15, s * 0.17); g.closePath(); g.fill();
    }, 128);
    this.playerSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: arrowTex, sizeAttenuation: false, depthTest: false }));
    this.playerSprite.scale.set(0.09, 0.09, 1);
    this.playerSprite.renderOrder = 10;
    this.scene.add(this.playerSprite);

    const wpTex = spriteTex((g, s) => {
      const m = s / 2, r = s * 0.22;
      g.shadowColor = '#5ef6ff'; g.shadowBlur = s * 0.15; g.fillStyle = '#5ef6ff';
      g.beginPath(); g.moveTo(m, m - r); g.lineTo(m + r, m); g.lineTo(m, m + r); g.lineTo(m - r, m); g.closePath(); g.fill();
      g.shadowBlur = 0; g.strokeStyle = '#5ef6ff'; g.lineWidth = s * 0.03;
      g.beginPath(); g.arc(m, m, s * 0.4, 0, Math.PI * 2); g.stroke();
    }, 128);
    this.wpSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: wpTex, sizeAttenuation: false, depthTest: false }));
    this.wpSprite.scale.set(0.07, 0.07, 1);
    this.wpSprite.renderOrder = 9;
    this.wpSprite.visible = false;
    this.scene.add(this.wpSprite);

    this.poiGroup = new THREE.Group();
    this.scene.add(this.poiGroup);
    this.poiSprites = new Map();
  }

  buildDistrictLabels(man) {
    this.districtLabels = [];
    const seen = new Set();
    for (const [k, d] of Object.entries(man.districts || {})) {
      const name = DISTRICT_NAMES[k] || k.replace(/^ep1_/, '').replace(/_/g, ' ');
      if (seen.has(name)) continue;
      seen.add(name);
      const el = document.createElement('div');
      el.className = 'map3d-district';
      el.textContent = name;
      this.labels.appendChild(el);
      // Center in game coordinates (x, y, z).
      this.districtLabels.push({ el, pos: toScene(d.center[0], d.center[1], d.center[2] + 40) });
    }
  }

  setPois(list) {
    const keep = new Set();
    for (const p of list) {
      const k = `${p.v}:${p.x}:${p.y}`;
      keep.add(k);
      let sp = this.poiSprites.get(k);
      if (!sp) {
        sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: markerTex(p.color || '#ff6158', p.shape, p.v), sizeAttenuation: false, depthTest: false, transparent: true, opacity: 0 }));
        sp.visible = false; sp.userData.want = false; sp.userData.a = 0;
        sp.scale.set(0.065, 0.065, 1);
        sp.renderOrder = 8;
        this.markerScale = -1;
        sp.position.copy(toScene(p.x, p.y, (p.z || 0) + 4));
        this.poiGroup.add(sp);
        this.poiSprites.set(k, sp);
      }
      sp.userData.poi = p;
    }
    this.markerScale = -1; // reaplica tiers
    for (const [k, sp] of this.poiSprites) {
      if (!keep.has(k)) { this.poiGroup.remove(sp); sp.material.dispose(); this.poiSprites.delete(k); }
    }
    this.pois = list;
  }

  select(poi) {
    this.selected = poi || null;
    this.markerScale = -1; // Force rescaling.
  }

  // Icons shrink at wide zoom levels so the whole city does not become a sea of markers.
  scaleMarkers() {
    const f = Math.max(0.75, Math.min(1, 2000 / this.dist));
    const lim = this.tierLimit();
    const now = performance.now();
    if (Math.abs(f - this.markerScale) < 0.01 && lim === this.markerTier && now - (this.declutterAt || 0) < 250) return;
    this.markerScale = f;
    this.markerTier = lim;
    this.declutterAt = now;
    const sel = this.selected;
    const v = new THREE.Vector3();
    const cand = [];
    for (const sp of this.poiSprites.values()) {
      const p = sp.userData.poi;
      const isSel = sel && p.x === sel.x && p.y === sel.y && p.v === sel.v;
      sp.userData.s = isSel ? 0.06 : 0.036 * f;
      sp.userData.want = false;
      const tier = p.tier || 0;
      if (!isSel && tier > lim && !(this.boost && tier === 2 && lim >= 1)) continue;
      v.copy(sp.position).project(this.camera);
      if (v.z > 1 || Math.abs(v.x) > 1.2 || Math.abs(v.y) > 1.2) { sp.userData.want = isSel; continue; }
      cand.push({ sp, isSel, pri: isSel ? -1 : (p.q ? 0 : (p.tier || 0) + 1), x: ((v.x + 1) / 2) * this.w, y: ((1 - v.y) / 2) * this.h });
    }
    // Minimum icon spacing (px): less important markers disappear when they overlap.
    cand.sort((a, b) => a.pri - b.pri);
    const gap = Math.max(16, (this.h || 600) * 0.036 * f * 1.1);
    const kept = [];
    for (const c of cand) {
      if (!c.isSel && kept.some((k) => Math.abs(k.x - c.x) < gap && Math.abs(k.y - c.y) < gap)) continue;
      c.sp.userData.want = true;
      kept.push(c);
    }
  }

  // aparecer/sumir suave: opacidade e tamanho animados a cada quadro
  fadeMarkers(dt) {
    const k = Math.min(1, dt * 7);
    for (const sp of this.poiSprites.values()) {
      const u = sp.userData;
      const target = u.want ? 1 : 0;
      if (u.a === target && sp.visible === (target > 0)) { if (target) sp.scale.setScalar(u.s || 0.044); continue; }
      u.a += (target - u.a) * k;
      if (Math.abs(target - u.a) < 0.02) u.a = target;
      sp.visible = u.a > 0.01;
      sp.material.opacity = 0.82 * u.a;
      sp.scale.setScalar((u.s || 0.044) * (0.6 + 0.4 * u.a));
    }
  }

  update(pos, pois, waypoint) {
    if (pos && pos.x != null) {
      const hdg = ((-(pos.yaw || 0)) % 360 + 360) % 360;
      const jump = Math.hypot(pos.x - this.player.x, pos.y - this.player.y);
      Object.assign(this.player, { x: pos.x, y: pos.y, z: pos.z || 0, hdg });
      if (!this.player.ok || jump > 300) {
        Object.assign(this.cur, { x: pos.x, y: pos.y, z: pos.z || 0, hdg });
        if (!this.player.ok) this.target.copy(toScene(pos.x, pos.y, pos.z || 0));
        this.player.ok = true;
      }
    }
    if (pois) this.setPois(pois);
    this.waypoint = waypoint || null;
    if (!this.ready) return;
    // Recalculate the route when the destination changes, every four seconds, or after leaving the route.
    const now = performance.now();
    const wk = this.wpKey();
    if (!this.waypoint) { if (this.route) this.setRoute(null); return; }
    const prog = this.routeProgress();
    if (!this.route || this.route.wpKey !== wk || (prog && prog.off > 45 && now - this.route.at > 2500) || now - this.route.at > 15000) {
      this.computeRoute();
    }
  }

  routeInfo() {
    const p = this.routeProgress();
    return p ? { remaining: p.remaining } : null;
  }

  // ---------- Camera ----------
  setMode(o) {
    if (o.headingUp !== undefined) this.headingUp = o.headingUp;
    if (o.elev !== undefined) this.elev = o.elev;
    if (o.dist !== undefined) { this.dist = o.dist; this.distTarget = null; }
    if (o.follow !== undefined) this.follow = o.follow;
    if (!this.headingUp && o.headingUp === false) this.bearing = 0;
  }
  zoom(f) { this.distTarget = Math.min(MAX_DIST, Math.max(120, (this.distTarget || this.dist) * f)); }
  recenter() { this.follow = true; this.emit('follow', true); }
  focusOn(x, y, z, dist) {
    this.follow = false; this.emit('follow', false);
    this.target.copy(toScene(x, y, z || 0));
    if (dist) this.distTarget = Math.min(MAX_DIST, Math.max(120, dist));
  }

  updateCamera() {
    const B = rad(this.bearing), E = rad(this.elev);
    const dir = new THREE.Vector3(Math.sin(B), 0, -Math.cos(B));
    const pos = this.target.clone().addScaledVector(dir, -this.dist * Math.cos(E));
    pos.y += this.dist * Math.sin(E);
    this.camera.position.copy(pos);
    this.camera.up.set(0, 1, 0);
    if (this.elev > 89) this.camera.up.copy(dir);
    this.camera.lookAt(this.target);
    this.camera.far = this.dist * 6 + 3000;
    this.scene.fog.near = this.dist * 1.6;
    this.scene.fog.far = this.dist * 5 + 1500;
    if (this.dist > 6000) { this.scene.fog.near = 1e6; this.scene.fog.far = 2e6; }
    this.camera.updateProjectionMatrix();
  }

  // ---------- Setup / render loop ----------
  mount(container) {
    if (this.container === container) return;
    this.container = container;
    container.prepend(this.labels);
    container.prepend(this.canvas);
    this.resize();
  }
  setVisible(v) { this.visible = v; if (v) this.resize(); }
  resize() {
    if (!this.container || !this.renderer) return;
    const r = this.container.getBoundingClientRect();
    if (!r.width || !r.height) return;
    this.w = r.width; this.h = r.height;
    this.renderer.setSize(r.width, r.height, false);
    this.camera.aspect = r.width / r.height;
    this.camera.updateProjectionMatrix();
    this.routeMat && this.routeMat.resolution.set(r.width, r.height);
  }

  loop(t) {
    requestAnimationFrame((tt) => this.loop(tt));
    const dt = Math.min(0.1, (t - this.lastT) / 1000);
    this.lastT = t;
    if (!this.visible || !this.container || this.lost) return;
    if (this.canvas.clientWidth !== this.w || this.canvas.clientHeight !== this.h) this.resize();
    // Player interpolation.
    const k = Math.min(1, dt * 4);
    this.cur.x += (this.player.x - this.cur.x) * k;
    this.cur.y += (this.player.y - this.cur.y) * k;
    this.cur.z += (this.player.z - this.cur.z) * k;
    const dh = ((this.player.hdg - this.cur.hdg + 540) % 360) - 180;
    this.cur.hdg = (this.cur.hdg + dh * k + 360) % 360;
    const pp = toScene(this.cur.x, this.cur.y, this.cur.z + 3);
    this.playerSprite.position.copy(pp);
    if (this.follow) this.target.lerp(toScene(this.cur.x, this.cur.y, this.cur.z), Math.min(1, dt * 5));
    if (this.headingUp && this.follow) {
      const db = ((this.cur.hdg - this.bearing + 540) % 360) - 180;
      this.bearing = (this.bearing + db * Math.min(1, dt * 3) + 360) % 360;
    }
    this.playerSprite.material.rotation = -rad(this.cur.hdg - this.bearing);
    // waypoint pulsando
    if (this.waypoint) {
      this.wpSprite.visible = true;
      this.wpSprite.position.copy(toScene(this.waypoint.x, this.waypoint.y, (this.waypoint.z || this.cur.z) + 4));
      this.wpSprite.scale.setScalar(0.065 + Math.sin(t / 300) * 0.008);
    } else this.wpSprite.visible = false;
    if (this.routeLine) this.routeMat.dashOffset = -t / 25;
    if (this.distTarget) {
      this.dist += (this.distTarget - this.dist) * Math.min(1, dt * 9);
      if (Math.abs(this.distTarget - this.dist) < 1) { this.dist = this.distTarget; this.distTarget = null; }
    }
    if (this.dist !== this.lastDist) { this.lastDist = this.dist; this.emit('zoom', this.dist); }
    this.scaleMarkers();
    this.fadeMarkers(dt);
    this.updateCamera();
    this.renderer.render(this.scene, this.camera);
    this.placeLabels();
  }

  placeLabels() {
    const v = new THREE.Vector3();
    const show = this.dist > 1400;
    for (const L of this.districtLabels) {
      if (!show) { L.el.style.display = 'none'; continue; }
      v.copy(L.pos).project(this.camera);
      const vis = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
      L.el.style.display = vis ? '' : 'none';
      if (vis) L.el.style.transform = `translate(${((v.x + 1) / 2) * this.w}px, ${((1 - v.y) / 2) * this.h}px) translate(-50%, -50%)`;
    }
  }

  // ---------- Touch ----------
  screenToGround(sx, sy) {
    const ndc = new THREE.Vector2((sx / this.w) * 2 - 1, -(sy / this.h) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -this.target.y);
    const hit = new THREE.Vector3();
    return ray.ray.intersectPlane(plane, hit) ? hit : null;
  }

  pick(sx, sy) {
    const v = new THREE.Vector3();
    let best = null, bd = 30;
    for (const sp of this.poiSprites.values()) {
      if (!sp.userData.want) continue;
      v.copy(sp.position).project(this.camera);
      if (v.z > 1) continue;
      const px = ((v.x + 1) / 2) * this.w, py = ((1 - v.y) / 2) * this.h;
      const d = Math.hypot(px - sx, py - sy);
      if (d < bd) { bd = d; best = sp.userData.poi; }
    }
    if (best) return { poi: best };
    const g = this.screenToGround(sx, sy);
    return g ? { point: { x: g.x, y: -g.z, z: g.y } } : null;
  }

  bindInput() {
    const el = this.canvas;
    el.style.touchAction = 'none';
    const pts = new Map();
    let moved = false, start = null, last = null, pinch = null;
    const rel = (e) => { const r = el.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, rel(e));
      moved = false; start = rel(e); last = start;
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), ang: Math.atan2(b[1] - a[1], b[0] - a[0]), dist: this.dist, bearing: this.bearing };
      }
    });
    el.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return;
      const p = rel(e);
      pts.set(e.pointerId, p);
      if (pts.size === 2 && pinch) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        this.distTarget = null;
        this.dist = Math.min(MAX_DIST, Math.max(120, pinch.dist * (pinch.d / d)));
        const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
        if (!this.headingUp) this.bearing = (pinch.bearing - ((ang - pinch.ang) * 180) / Math.PI + 360) % 360;
        moved = true;
        return;
      }
      if (Math.hypot(p[0] - start[0], p[1] - start[1]) > 6) moved = true;
      if (moved && pts.size === 1) {
        const g0 = this.screenToGround(last[0], last[1]), g1 = this.screenToGround(p[0], p[1]);
        if (g0 && g1) {
          this.target.add(g0.sub(g1));
          if (this.follow) { this.follow = false; this.emit('follow', false); }
        }
      }
      last = p;
    });
    const up = (e) => {
      const wasTap = pts.size === 1 && !moved;
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = null;
      if (wasTap) {
        const res = this.pick(...rel(e));
        if (res) this.emit('pick', res);
      }
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', (e) => { pts.delete(e.pointerId); pinch = null; });
    el.addEventListener('wheel', (e) => { e.preventDefault(); this.zoom(e.deltaY > 0 ? 1.2 : 1 / 1.2); }, { passive: false });
  }
}

const map3d = new HoloMap3D();
window.Map3D = map3d;
map3d.init().catch((err) => {
  console.error('[map3d]', err);
  map3d.failed = true;
  map3d.emit('error', err);
  window.dispatchEvent(new CustomEvent('map3d-error', { detail: String(err) }));
});
map3d.on('ready', () => window.dispatchEvent(new CustomEvent('map3d-ready')));
