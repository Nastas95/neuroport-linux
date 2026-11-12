// Neuroport — radio, Car Mode ("Holo Auto") and 3D map integration.
// Uses global functions from app.js: $, game, cmd, t, toast, buzz, esc, fmtDist, ...
'use strict';

// ---------- 3D map ----------
const M3 = () => (window.Map3D && Map3D.ready ? Map3D : null);
let phoneView = { headingUp: false, elev: 89.5, dist: 900 };
let mapHost = 'phone';   // 'phone' | 'car'

function mountMap(where) {
  const m = M3();
  if (!m) return;
  mapHost = where;
  if (where === 'car') {
    m.mount($('car-map'));
    // Like the in-game minimap: top-down, no buildings, rotating with the car.
    m.setFlat(true);
    m.setMode({ headingUp: true, elev: 89.5, dist: isDesktopMode() ? 520 : 380, follow: true });
    m.setVisible(true);
  } else {
    m.mount($('map3d-host'));
    m.setFlat(false);
    m.setMode({ ...phoneView, follow: true });
    m.setVisible(tab === 'map');
  }
}

// Tracked job objective: the job marker whose distance matches the distance
// reported for it by the in-game journal.
function questTarget() {
  const j = game().journal || {};
  const q = (j.quests || []).find((x) => x.id === j.tracked);
  if (!q) return null;
  let best = null, bd = Infinity;
  // Marker linked to the tracked job (the mod links each marker to an active journal objective).
  for (const p of allPois(true)) {
    if (p.q !== q.id) continue;
    const d = distTo(p);
    if (d < bd) { bd = d; best = p; }
  }
  if (!best && q.dist != null) {
    for (const p of allPois()) {
      if (p.f !== 'quest_obj' && p.f !== 'quest_other') continue;
      const d = Math.abs(distTo(p) - q.dist);
      if (d < bd) { bd = d; best = p; }
    }
    if (best && bd > Math.max(40, q.dist * 0.15)) best = null;
  }
  return { quest: q, target: best ? { x: best.x, y: best.y, z: best.z, cat: 'quest_obj', label: q.title } : null };
}

function destination() {
  const g = game();
  if (g.waypoint) return g.waypoint;
  const qt = questTarget();
  return qt && qt.target;
}

function map3dUpdate() {
  const m = M3();
  if (!m) return;
  const g = game();
  m.boost = mapHost !== 'car' && (filterMode === 'services' || filterMode === 'custom');
  m.update(g.pos, mapPois(), destination());
}
function map3dZoom(f) {
  const m = M3();
  if (!m) return;
  m.zoom(f);
}
function map3dMode(headingUp) {
  const m = M3();
  if (!m) return;
  phoneView.headingUp = headingUp;
  m.setMode({ headingUp, follow: true });
}
function map3dHud() {
  const m = M3();
  if (!m) return;
  $('map-scale').textContent = fmtDist(m.dist);
  const info = m.routeInfo();
  $('map-route').hidden = !info;
  if (info) $('map-route-label').textContent = `${fmtDist(info.remaining)} ${t('remaining')}`;
}

window.addEventListener('map3d-ready', () => {
  $('map-loading').hidden = true;
  $('map').style.display = 'none';           // The 2D radar is now only a fallback.
  const m = Map3D;
  m.on('pick', (res) => {
    if (mapHost === 'car') return carPick(res);
    // When details are open, tapping outside an icon closes only the details.
    if (!$('map-pop').hidden && !res.poi) { closePop(); m.select(null); return; }
    m.select(res.poi || null);
    onMapPick(res);
  });
  m.on('zoom', (d) => { if (mapHost === 'phone') { phoneView.dist = d; $('map-scale').textContent = fmtDist(d); } });
  m.on('follow', (f) => { $('map-center').hidden = f; $('car-center').hidden = f; });
  m.on('lost', () => {
    $('map').style.display = '';          // radar 2D enquanto o 3D se recupera
    toast(t('mapLost'), false);
  });
  // Reload the page to rebuild the map from scratch (state is restored by the server).
  m.on('restored', () => setTimeout(() => location.reload(), 300));
  mountMap(carVisible ? 'car' : 'phone');
  map3dUpdate();
});
window.addEventListener('map3d-error', () => {
  $('map-loading').hidden = true;
  toast(t('mapFailed'), false);
});
$('map-center').addEventListener('click', () => { const m = M3(); if (m) { m.recenter(); buzz(5); } });

// Closing the details also clears the 3D selection.
$('pop-cancel').addEventListener('click', () => { const m = M3(); if (m) m.select(null); });

function onTabChange(name) {
  const m = M3();
  if (m && mapHost === 'phone') m.setVisible(name === 'map');
  if (name === 'radio') renderRadio($('radio-phone'), true);
}

// ---------- Radio ----------
let lastRadioKey = {};
function renderRadio(root, force) {
  const g = game();
  const r = g.radio || {};
  const st = g.stations || [];
  const key = JSON.stringify([r, st.length, LANG]);
  if (!force && lastRadioKey[root.id] === key) return;
  lastRadioKey[root.id] = key;
  const src = t(r.src === 'vehicle' ? 'carRadio' : 'pocketRadio');
  if (root.id === 'radio-phone') $('radio-src').textContent = src;
  root.innerHTML = `
    <div class="np${r.on ? ' is-on' : ''}">
      <div class="np-viz" aria-hidden="true">${'<i></i>'.repeat(16)}</div>
      <div class="tag">${esc(r.on ? t('nowPlaying') : t('radioOff'))} · ${esc(src)}</div>
      <div class="np-station">${esc(r.station || '—')}</div>
      <div class="np-track">${esc(r.on ? (r.track || '') : '')}</div>
      <div class="np-ctrl">
        <button class="np-btn" data-r="prev"><svg viewBox="0 0 24 24"><use href="#i-prev"/></svg></button>
        <button class="np-btn np-power${r.on ? ' is-on' : ''}" data-r="power"><svg viewBox="0 0 24 24"><use href="#${r.on ? 'i-pause' : 'i-play'}"/></svg></button>
        <button class="np-btn" data-r="next"><svg viewBox="0 0 24 24"><use href="#i-next"/></svg></button>
      </div>
      <div class="np-vol">
        <button class="np-btn" data-r="vdown"><svg viewBox="0 0 24 24"><use href="#i-vol-down"/></svg></button>
        <div class="np-vol-bar"><i style="width:${r.vol != null ? r.vol : 0}%"></i></div>
        <span class="np-vol-n">${r.vol != null ? r.vol + '%' : '—'}</span>
        <button class="np-btn" data-r="vup"><svg viewBox="0 0 24 24"><use href="#i-vol-up"/></svg></button>
      </div>
    </div>
    <div class="tag st-tag">${t('stations')}</div>
    <div class="st-grid">
      ${st.map((x) => `<button class="st${r.on && x.name === r.station ? ' is-cur' : ''}" data-st="${x.station}"><span>${esc(x.name)}</span></button>`).join('')}
    </div>`;
}
function radioClick(e) {
  const b = e.target.closest('[data-r],[data-st]');
  if (!b) return;
  buzz(10);
  const r = game().radio || {};
  if (b.dataset.st != null) cmd('radio_set', b.dataset.st);
  else if (b.dataset.r === 'power') cmd(r.on ? 'radio_off' : 'radio_on');
  else if (b.dataset.r === 'vup' || b.dataset.r === 'vdown') cmd('radio_vol', b.dataset.r === 'vup' ? 1 : -1);
  else cmd(b.dataset.r === 'next' ? 'radio_next' : 'radio_prev');
}
$('radio-phone').addEventListener('click', radioClick);
$('radio-car').addEventListener('click', radioClick);

// ---------- Car Mode ----------
let carVisible = false;
let carDismissed = false;
let carManual = false;     // Opened manually (automatic Car Mode is disabled).
let wasInside = false;
let carTab = 'nav';

function setCarVisible(v) {
  if (v === carVisible) return;
  carVisible = v;
  $('car').hidden = !v;
  document.body.classList.toggle('in-car', v);
  mountMap(v ? 'car' : 'phone');
  if (v) { buzz([20, 40, 20]); renderCar(true); }
}

function renderExtras() {
  const g = game();
  const veh = g.vehicle || {};
  const inside = !!veh.inside;
  if (inside && !wasInside) { carDismissed = false; carManual = false; }   // Entered a vehicle: enable Car Mode.
  wasInside = inside;
  const auto = typeof prefs === 'undefined' || prefs.autoCar;
  // Manually opened mode (widget/chip) stays open outside the car; automatic mode runs only in a vehicle.
  const want = !carDismissed && (carManual || (inside && auto));
  $('car-chip').hidden = !(inside && !want);
  $('w-car').classList.toggle('on', inside);
  $('w-car-title').textContent = t(inside ? 'carModeIn' : 'carModeOut');
  setCarVisible(want);
  if (tab === 'radio') renderRadio($('radio-phone'));
  if (carVisible) renderCar();
}

function renderQuestDrive() {
  const qt = questTarget();
  const veh = game().vehicle || {};
  $('ad-quest').disabled = !qt;
  $('ad-quest').hidden = !!veh.autodrive;
  $('ad-quest-title').textContent = qt ? qt.quest.title : t('noTracked');
  $('ad-quest-sub').textContent = qt ? [qt.quest.objective, qt.quest.dist != null ? fmtDist(qt.quest.dist) : ''].filter(Boolean).join(' · ') : '';
}

function renderCar(force) {
  const g = game();
  const veh = g.vehicle || {};
  const p = g.player || {};
  $('car-speed').textContent = veh.speed ?? 0;
  $('car-name').textContent = veh.name || '';
  $('car-clock').textContent = p.timeH != null ? `${pad(p.timeH)}:${pad(p.timeM)}` : '--:--';
  $('car-ad').hidden = !veh.autodrive;
  $('ad-stop').hidden = !veh.autodrive;
  $('ad-start').hidden = !!veh.autodrive || !g.waypoint;
  renderQuestDrive();

  // Navigation bar over the map.
  const wp = destination();
  const m = M3();
  const info = m && m.routeInfo();
  const remain = veh.adDist ?? (info ? info.remaining : wp ? distTo(wp) : null);
  const eta = veh.adEta ?? (remain != null ? remain / 13 : null);
  $('car-nav').hidden = !wp;
  if (wp) {
    $('car-nav-dot').style.setProperty('--c', wpColor(wp));
    $('car-nav-label').textContent = wpLabel(wp);
    $('car-nav-sub').textContent = `${fmtDist(remain)} · ${t('eta')} ${fmtEta(eta)}`;
  }
  $('car-dest').innerHTML = wp
    ? `<span class="cat-dot" style="--c:${wpColor(wp)}"></span><div><div class="car-dest-label">${esc(wpLabel(wp))}</div><div class="dim">${fmtDist(remain)} · ${t('eta')} ${fmtEta(eta)}</div></div>${g.waypoint ? `<button class="btn btn-ghost btn-sm" id="car-clear">${t('clear')}</button>` : ''}`
    : `<p class="dim">${esc(t('noDest'))}</p>`;
  if (carTab === 'nav') renderQuick(force);
  if (carTab === 'radio') renderRadio($('radio-car'), force);
}

function fmtEta(sec) {
  if (sec == null || !isFinite(sec)) return '—';
  const m = Math.max(1, Math.round(sec / 60));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

// Quick destinations: the nearest location for each useful driving category.
const QUICK = ['gig', 'ncpd', 'side', 'tarot', 'ripperdoc', 'fast_travel', 'weapon_shop', 'vehicle_sale'];
let lastQuickKey = '';
function renderQuick(force) {
  const all = allPois(true).map((p) => ({ ...p, dist: distTo(p) })).sort((a, b) => a.dist - b.dist);
  const items = [];
  for (const q of QUICK) {
    const n = all.find((p) => p.cat === q || p.f === q);
    if (n) items.push(n);
  }
  const key = JSON.stringify(items.map((p) => [p.f, Math.round(p.dist / 50)]).concat([LANG]));
  if (!force && key === lastQuickKey) return;
  lastQuickKey = key;
  $('car-quick').innerHTML = items.map((p, i) => `
    <button class="qd" data-i="${i}" style="--c:${p.color}">
      <span class="cat-dot"></span><span class="qd-name">${esc(poiLabel(p))}</span><span class="qd-dist">${fmtDist(p.dist)}</span>
    </button>`).join('');
  $('car-quick').dataset.items = JSON.stringify(items.map((p) => [p.x, p.y, p.z, p.f]));
}
$('car-quick').addEventListener('click', (e) => {
  const b = e.target.closest('.qd');
  if (!b) return;
  const it = JSON.parse($('car-quick').dataset.items || '[]')[Number(b.dataset.i)];
  if (it) markPoi({ x: it[0], y: it[1], z: it[2], f: it[3] });
});
$('car-dest').addEventListener('click', (e) => { if (e.target.closest('#car-clear')) { buzz(10); cmd('clearwp'); } });

function carPick(res) {
  buzz(10);
  if (res.poi) markPoi(res.poi);
  else markPoi({ x: res.point.x, y: res.point.y, z: (playerPos() || {}).z || 0, f: '' });
}

document.querySelector('.car-tabs').addEventListener('click', (e) => {
  const b = e.target.closest('.car-tab');
  if (!b) return;
  buzz(6);
  carTab = b.dataset.ct;
  for (const x of document.querySelectorAll('.car-tab')) x.classList.toggle('is-active', x === b);
  for (const k of ['nav', 'radio', 'car']) $('ct-' + k).hidden = k !== carTab;
  renderCar(true);
});
$('car-exit').addEventListener('click', () => { buzz(10); carDismissed = true; carManual = false; renderExtras(); });
function openCarMode() {
  buzz(10);
  carDismissed = false;
  carManual = true;
  renderExtras();
}
$('car-chip').addEventListener('click', openCarMode);
$('w-car').addEventListener('click', openCarMode);
$('car-zoom-in').addEventListener('click', () => { const m = M3(); if (m) m.zoom(1 / 1.4); buzz(5); });
$('car-zoom-out').addEventListener('click', () => { const m = M3(); if (m) m.zoom(1.4); buzz(5); });
$('car-center').addEventListener('click', () => { const m = M3(); if (m) m.recenter(); buzz(5); });
$('ad-start').addEventListener('click', () => { buzz(20); cmd('ad_start'); });
$('ad-quest').addEventListener('click', () => {
  if ($('ad-quest').disabled) return;
  buzz(20);
  cmd('ad_quest');
});
$('ad-stop').addEventListener('click', () => { buzz(20); cmd('ad_stop'); });
$('horn').addEventListener('click', () => { buzz(40); cmd('horn'); });

// ---------- Paint ----------
const SWATCHES = [
  '#f2f3f5', '#15161b', '#8a8f9c', '#ff2e3c', '#ff6158', '#ff9f43', '#f7e05a', '#b6ff3b',
  '#2bfdb1', '#5ef6ff', '#2f6bff', '#7a3cff', '#ff4fd8', '#6b3a1f', '#c9a227', '#2b4d3a',
];
const paint = { primary: '#ff2e3c', secondary: '#15161b', hue: 0.52, target: 'primary' };
try { Object.assign(paint, JSON.parse(localStorage.getItem('neuroport.paint') || '{}')); } catch { /* ok */ }
$('swatches').innerHTML = SWATCHES.map((c) => `<button class="sw" data-c="${c}" style="--c:${c}"></button>`).join('') +
  '<label class="sw sw-custom"><input type="color" id="sw-custom"><span>+</span></label>';
function paintPreview() {
  $('pv-primary').style.background = paint.primary;
  $('pv-secondary').style.background = paint.secondary;
  $('lights-hue').value = paint.hue;
  $('lights-swatch').style.background = `hsl(${Math.round(paint.hue * 360)}, 100%, 60%)`;
  for (const b of document.querySelectorAll('#paint-target .seg-b')) b.classList.toggle('is-active', b.dataset.pt === paint.target);
  for (const b of document.querySelectorAll('.sw[data-c]')) b.classList.toggle('is-sel', b.dataset.c === paint[paint.target]);
  try { localStorage.setItem('neuroport.paint', JSON.stringify(paint)); } catch { /* ok */ }
}
$('swatches').addEventListener('click', (e) => {
  const b = e.target.closest('.sw[data-c]');
  if (!b) return;
  buzz(5);
  paint[paint.target] = b.dataset.c;
  paintPreview();
});
$('sw-custom').addEventListener('input', (e) => { paint[paint.target] = e.target.value; paintPreview(); });
$('paint-target').addEventListener('click', (e) => {
  const b = e.target.closest('.seg-b');
  if (b) { paint.target = b.dataset.pt; paintPreview(); }
});
$('lights-hue').addEventListener('input', (e) => { paint.hue = Number(e.target.value); paintPreview(); });
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(',');
$('paint-apply').addEventListener('click', () => {
  buzz(20);
  cmd('color', `${rgb(paint.primary)};${rgb(paint.secondary)};${paint.hue.toFixed(2)}`);
});
$('paint-reset').addEventListener('click', () => { buzz(10); cmd('color_reset'); });
paintPreview();

// ---------- Game responses ----------
function onAckExtra(a, action) {
  if (!['radio_on', 'radio_off', 'radio_set', 'radio_next', 'radio_prev', 'radio_vol', 'ad_start', 'ad_quest', 'ad_stop', 'color', 'color_reset', 'horn'].includes(action)) return false;
  if (!a.ok) { buzz([40, 60, 40]); toast(errText(a.msg), false); return true; }
  if (action === 'ad_quest') toast(t('questRoute'), true, t('carNav'));
  if (action === 'color') toast(t('colorSet'), true, t('paint'));
  if (action === 'color_reset') toast(t('colorReset'), true, t('paint'));
  return true;
}

