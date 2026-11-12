// Tactical map (radar) rendered on a canvas.
// Game coordinates: x = east, y = north (meters). Game yaw is treated as
// 0 = north, positive = counterclockwise; compass heading is -yaw.
'use strict';

const CAT_COLORS = { ncpd: '#4f8bff', gig: '#f7e05a', tarot: '#c77dff', side: '#ff9f43' };
const WP_COLOR = '#5ef6ff';

const HoloMap = (() => {
  const ZOOMS = [100, 200, 400, 800, 1600, 3200, 6400]; // Meters from the center to the shorter edge.
  let canvas, ctx, dpr = 1, W = 0, H = 0;
  let zoomIdx = 2;
  let headingUp = false;
  let visible = false;
  let onPick = null;

  const cur = { x: 0, y: 0, hdg: 0, ok: false };
  const target = { x: 0, y: 0, hdg: 0 };
  let pois = [];
  let waypoint = null;
  const trail = [];
  let lastT = 0;
  let selected = null;

  const rad = (d) => (d * Math.PI) / 180;
  const scale = () => Math.min(W, H) / 2 / ZOOMS[zoomIdx]; // px por metro
  const rot = () => (headingUp ? -rad(cur.hdg) : 0);

  function worldToScreen(x, y) {
    const s = scale();
    let dx = (x - cur.x) * s, dy = -(y - cur.y) * s;
    const r = rot();
    if (r) { const c = Math.cos(r), n = Math.sin(r); [dx, dy] = [dx * c - dy * n, dx * n + dy * c]; }
    return [W / 2 + dx, H / 2 + dy];
  }
  function screenToWorld(sx, sy) {
    let dx = sx - W / 2, dy = sy - H / 2;
    const r = -rot();
    if (r) { const c = Math.cos(r), n = Math.sin(r); [dx, dy] = [dx * c - dy * n, dx * n + dy * c]; }
    const s = scale();
    return [cur.x + dx / s, cur.y - dy / s];
  }

  function resize() {
    const r = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 3);
    W = r.width; H = r.height;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
  }

  function niceStep(px) {
    // Grid spacing in meters, targeting about 40 px on screen.
    const m = 40 / px;
    for (const s of [25, 50, 100, 250, 500, 1000, 2500]) if (s >= m) return s;
    return 5000;
  }

  function diamond(x, y, r) {
    ctx.beginPath();
    ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath();
  }

  function shape(kind, x, y, r) {
    if (kind === 'square') {
      ctx.beginPath(); ctx.rect(x - r * 0.8, y - r * 0.8, r * 1.6, r * 1.6);
    } else if (kind === 'circle') {
      ctx.beginPath(); ctx.arc(x, y, r * 0.85, 0, Math.PI * 2);
    } else {
      diamond(x, y, r);
    }
  }

  function draw(now) {
    const dt = Math.min(0.1, (now - lastT) / 1000 || 0);
    lastT = now;
    // Smooth interpolation between game updates.
    const k = Math.min(1, dt * 5);
    cur.x += (target.x - cur.x) * k;
    cur.y += (target.y - cur.y) * k;
    let dh = ((target.hdg - cur.hdg + 540) % 360) - 180;
    cur.hdg = (cur.hdg + dh * k + 360) % 360;

    if (visible && W > 0) render(now);
    requestAnimationFrame(draw);
  }

  function render(now) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const s = scale();

    // fundo
    const g = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.7);
    g.addColorStop(0, 'rgba(255,97,88,0.07)');
    g.addColorStop(1, 'rgba(7,8,12,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // grade alinhada ao mundo
    const step = niceStep(s);
    const reach = Math.hypot(W, H) / 2 / s;
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.rotate(rot());
    const x0 = Math.floor((cur.x - reach) / step) * step, x1 = cur.x + reach;
    const y0 = Math.floor((cur.y - reach) / step) * step, y1 = cur.y + reach;
    ctx.lineWidth = 1;
    for (let x = x0; x <= x1; x += step) {
      const major = Math.round(x / step) % 5 === 0;
      ctx.strokeStyle = major ? 'rgba(255,97,88,0.16)' : 'rgba(255,97,88,0.06)';
      const sx = (x - cur.x) * s;
      ctx.beginPath(); ctx.moveTo(sx, -reach * s); ctx.lineTo(sx, reach * s); ctx.stroke();
    }
    for (let y = y0; y <= y1; y += step) {
      const major = Math.round(y / step) % 5 === 0;
      ctx.strokeStyle = major ? 'rgba(255,97,88,0.16)' : 'rgba(255,97,88,0.06)';
      const sy = -(y - cur.y) * s;
      ctx.beginPath(); ctx.moveTo(-reach * s, sy); ctx.lineTo(reach * s, sy); ctx.stroke();
    }
    ctx.restore();

    // Distance rings.
    ctx.strokeStyle = 'rgba(255,97,88,0.22)';
    ctx.setLineDash([2, 6]);
    ctx.font = '11px "Share Tech Mono", monospace';
    ctx.fillStyle = 'rgba(255,97,88,0.5)';
    for (const f of [0.33, 0.66, 1]) {
      const m = ZOOMS[zoomIdx] * f;
      ctx.beginPath(); ctx.arc(W / 2, H / 2, m * s, 0, Math.PI * 2); ctx.stroke();
      ctx.fillText(fmtDist(m), W / 2 + 4, H / 2 - m * s - 4);
    }
    ctx.setLineDash([]);

    // rastro
    if (trail.length > 1) {
      ctx.lineWidth = 2;
      for (let i = 1; i < trail.length; i++) {
        const [ax, ay] = worldToScreen(trail[i - 1][0], trail[i - 1][1]);
        const [bx, by] = worldToScreen(trail[i][0], trail[i][1]);
        ctx.strokeStyle = `rgba(94,246,255,${0.05 + 0.35 * (i / trail.length)})`;
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      }
    }

    // Line to the waypoint.
    if (waypoint) {
      const [wx, wy] = worldToScreen(waypoint.x, waypoint.y);
      ctx.strokeStyle = 'rgba(94,246,255,0.55)';
      ctx.setLineDash([6, 6]);
      ctx.lineDashOffset = -now / 60;
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(W / 2, H / 2); ctx.lineTo(wx, wy); ctx.stroke();
      ctx.setLineDash([]);
    }

    // marcadores
    for (const p of pois) {
      const [px, py] = worldToScreen(p.x, p.y);
      if (px < -20 || py < -20 || px > W + 20 || py > H + 20) continue;
      const c = p.color || CAT_COLORS[p.cat] || '#fff';
      const sel = selected && p.x === selected.x && p.y === selected.y && p.v === selected.v;
      const r = sel ? 9 : 6;
      const icon = typeof mapIconImage === 'function' ? mapIconImage(p.v) : null;
      if (icon) {
        ctx.globalAlpha = sel ? 1 : 0.82;
        drawMapIcon(ctx, icon, c, px, py, sel ? 34 : 22, sel, p.v);
        ctx.globalAlpha = 1;
        continue;
      }
      ctx.shadowColor = c; ctx.shadowBlur = sel ? 14 : 8;
      ctx.fillStyle = c;
      shape(p.shape, px, py, r); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(7,8,12,0.9)'; ctx.lineWidth = 1.5;
      shape(p.shape, px, py, r * 0.42); ctx.stroke();
      if (sel) {
        ctx.strokeStyle = c; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(px, py, 15, 0, Math.PI * 2); ctx.stroke();
      }
    }

    // Waypoint (pulsing); show an edge arrow when it is off-screen.
    if (waypoint) {
      let [wx, wy] = worldToScreen(waypoint.x, waypoint.y);
      const pad = 18;
      const off = wx < pad || wy < pad || wx > W - pad || wy > H - pad;
      if (off) {
        const ang = Math.atan2(wy - H / 2, wx - W / 2);
        const tx = Math.abs(Math.cos(ang)) > 1e-6 ? (W / 2 - pad) / Math.abs(Math.cos(ang)) : Infinity;
        const ty = Math.abs(Math.sin(ang)) > 1e-6 ? (H / 2 - pad) / Math.abs(Math.sin(ang)) : Infinity;
        const d = Math.min(tx, ty);
        wx = W / 2 + Math.cos(ang) * d; wy = H / 2 + Math.sin(ang) * d;
        ctx.save(); ctx.translate(wx, wy); ctx.rotate(ang + Math.PI / 2);
        ctx.fillStyle = WP_COLOR; ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(7, 6); ctx.lineTo(-7, 6); ctx.closePath(); ctx.fill();
        ctx.restore();
      } else {
        const pulse = (now / 1200) % 1;
        ctx.strokeStyle = `rgba(94,246,255,${1 - pulse})`; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(wx, wy, 8 + pulse * 18, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = WP_COLOR; ctx.shadowColor = WP_COLOR; ctx.shadowBlur = 12;
        diamond(wx, wy, 8); ctx.fill(); ctx.shadowBlur = 0;
      }
    }

    // Player.
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.rotate(headingUp ? 0 : rad(cur.hdg));
    ctx.fillStyle = 'rgba(94,246,255,0.12)';
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, 46, -Math.PI / 2 - 0.45, -Math.PI / 2 + 0.45); ctx.closePath(); ctx.fill();
    ctx.shadowColor = WP_COLOR; ctx.shadowBlur = 10;
    ctx.fillStyle = '#e8fdff';
    ctx.beginPath(); ctx.moveTo(0, -11); ctx.lineTo(8, 9); ctx.lineTo(0, 4); ctx.lineTo(-8, 9); ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.shadowBlur = 0;

    // North indicator in compass mode.
    if (headingUp) {
      const r = Math.min(W, H) / 2 - 16;
      const a = rot() - Math.PI / 2;
      const nx = W / 2 + Math.cos(a) * r, ny = H / 2 + Math.sin(a) * r;
      ctx.fillStyle = '#ff6158';
      ctx.font = 'bold 14px Rajdhani, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('N', nx, ny);
      ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
    }
  }

  function pick(sx, sy) {
    let best = null, bd = 28;
    for (const p of pois) {
      const [px, py] = worldToScreen(p.x, p.y);
      const d = Math.hypot(px - sx, py - sy);
      if (d < bd) { bd = d; best = p; }
    }
    if (best) return { poi: best };
    const [x, y] = screenToWorld(sx, sy);
    return { point: { x, y } };
  }

  function init(el, opts = {}) {
    canvas = el;
    ctx = canvas.getContext('2d');
    onPick = opts.onPick;
    new ResizeObserver(resize).observe(canvas);
    resize();
    canvas.addEventListener('click', (e) => {
      const r = canvas.getBoundingClientRect();
      const res = pick(e.clientX - r.left, e.clientY - r.top);
      selected = res.poi || null;
      onPick && onPick(res);
    });
    canvas.addEventListener('wheel', (e) => { e.preventDefault(); zoom(e.deltaY > 0 ? 1 : -1); }, { passive: false });
    // Pinch to zoom.
    const pts = new Map();
    let pinch0 = 0;
    canvas.addEventListener('pointerdown', (e) => { pts.set(e.pointerId, [e.clientX, e.clientY]); });
    canvas.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, [e.clientX, e.clientY]);
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        if (!pinch0) pinch0 = d;
        if (d / pinch0 > 1.35) { zoom(-1); pinch0 = d; }
        else if (d / pinch0 < 0.74) { zoom(1); pinch0 = d; }
      }
    });
    const up = (e) => { pts.delete(e.pointerId); if (pts.size < 2) pinch0 = 0; };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    requestAnimationFrame(draw);
  }

  function update(pos, list, wp) {
    if (pos && pos.x != null) {
      const hdg = ((-(pos.yaw || 0)) % 360 + 360) % 360;
      const jump = Math.hypot(pos.x - target.x, pos.y - target.y);
      target.x = pos.x; target.y = pos.y; target.hdg = hdg;
      if (!cur.ok || jump > 250) { // First reading or fast travel: do not animate.
        cur.x = pos.x; cur.y = pos.y; cur.hdg = hdg; cur.ok = true;
        if (jump > 250) trail.length = 0;
      }
      const last = trail[trail.length - 1];
      if (!last || Math.hypot(last[0] - pos.x, last[1] - pos.y) > 6) {
        trail.push([pos.x, pos.y]);
        if (trail.length > 400) trail.shift();
      }
    }
    pois = list || [];
    waypoint = wp || null;
  }

  function zoom(d) {
    zoomIdx = Math.max(0, Math.min(ZOOMS.length - 1, zoomIdx + d));
    return ZOOMS[zoomIdx];
  }

  return {
    init, update, zoom,
    setVisible(v) { visible = v; if (v) resize(); },
    toggleMode() { headingUp = !headingUp; return headingUp; },
    isHeadingUp: () => headingUp,
    radius: () => ZOOMS[zoomIdx],
    clearSelection() { selected = null; },
    select(p) { selected = p || null; },
    heading: () => target.hdg,
  };
})();
