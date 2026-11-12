// Neuroport OS — the phone interface: status bar, home screen, apps,
// Android-style navigation, fullscreen mode, settings, messages, web,
// camera and call subtitles. Uses the global functions from app.js and car.js.
'use strict';

const OS = {
  apps: [
    { id: 'messages', icon: 'i-chat', label: 'appMessages', color: '#5ef6ff' },
    { id: 'map', icon: 'i-pin', label: 'appMap', color: '#ff9f43' },
    { id: 'gigs', icon: 'i-gig', label: 'appGigs', color: '#f7e05a' },
    { id: 'journal', icon: 'i-journal', label: 'appJournal', color: '#b6f25a' },
    { id: 'vehicles', icon: 'i-car', label: 'appVehicles', color: '#ff5a5a' },
    { id: 'radio', icon: 'i-radio', label: 'appRadio', color: '#b77dff' },
    { id: 'internet', img: 'icons/autofixer.png', label: 'appInternet', color: '#ff5a9a' },
    { id: 'photo', icon: 'i-camera', label: 'appCamera', color: '#4dff8a', action: 'photo_mode' },
    { id: 'camera', icon: 'i-image', label: 'appGallery', color: '#5aa8ff' },
    { id: 'shards', icon: 'i-shard', label: 'appShards', color: '#2bf0c0' },
    { id: 'status', icon: 'i-user', label: 'appStatus', color: '#ff6ee6' },
    { id: 'settings', icon: 'i-gear', label: 'appSettings', color: '#7a7dff' },
  ],
  dock: ['messages', 'vehicles', 'map', 'photo'],
};

// ---------- Phone preferences ----------
const PREF_KEY = 'neuroport.prefs';
const prefs = Object.assign({ autoCar: true, ring: true, vibrate: true, mapMode: 'active', nav: 'buttons', navSide: 'left' },
  (() => { try { return JSON.parse(localStorage.getItem(PREF_KEY) || '{}'); } catch { return {}; } })());
function savePrefs() { try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch { /* ok */ } }

// Markers: only those currently active in the game, or the interactive map (all).
// Strict mode ignores the interactive map (Quick Gig and navigation use only active in-game markers).
function poiActive(p, strict) {
  if (prefs.mapMode === 'all' && !strict) return true;
  if (p.f === 'quest_obj' || p.f === 'quest_other') return true;
  // Undiscovered gigs remain on the in-game map (the box with an exclamation mark); only completed gigs disappear.
  if (p.ph === 'c' || (p.ph === 'u' && p.cat !== 'gig')) return false;
  if (p.vis === false || p.act === false) return false;
  // Mission marker that does not match an active journal objective.
  if (p.ql === false) return false;
  // NCPD activities (assault, organized crime, etc.) that the game no longer displays except at close range.
  if (/^(GangWatch|Outpost)$/.test(p.v) || (p.v === 'HiddenStash' && !p.q)) {
    const me = (typeof game === 'function' && game().pos) || null;
    if (!me || me.x == null || Math.hypot(p.x - me.x, p.y - me.y) > 200) return false;
  }
  return true;
}

// ---------- Fullscreen ----------
function canFullscreen() { return !!(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen); }
function isFullscreen() { return !!(document.fullscreenElement || document.webkitFullscreenElement); }
function enterFullscreen() {
  const el = document.documentElement;
  const fn = el.requestFullscreen || el.webkitRequestFullscreen;
  if (!fn || isFullscreen()) return;
  try { const p = fn.call(el, { navigationUI: 'hide' }); if (p && p.catch) p.catch(() => {}); } catch { /* ok */ }
}
function exitFullscreen() {
  const fn = document.exitFullscreen || document.webkitExitFullscreen;
  if (fn && isFullscreen()) try { fn.call(document); } catch { /* ok */ }
}
// Enter fullscreen only when requested (status-bar button or Settings).
function toggleFullscreen() { isFullscreen() ? exitFullscreen() : enterFullscreen(); }
function renderFsButton() {
  const b = $('sb-fs');
  if (!b) return;
  b.hidden = !canFullscreen();
  b.querySelector('use').setAttribute('href', isFullscreen() ? '#i-fs-exit' : '#i-fs');
}
document.addEventListener('fullscreenchange', () => { renderFsButton(); renderSettings(); });
document.addEventListener('webkitfullscreenchange', () => { renderFsButton(); renderSettings(); });
$('sb-fs').addEventListener('click', (e) => { e.stopPropagation(); buzz(10); toggleFullscreen(); });
renderFsButton();

// ---------- Navigation ----------
let currentApp = 'home';

// Desktop mode requires a wide viewport and at least one precise pointer.
// any-pointer includes a mouse or touchpad on touchscreen laptops without treating
// a phone in landscape orientation as a desktop.
// Update the layout when the window is resized.
const desktopMedia = window.matchMedia('(min-width: 900px) and (any-pointer: fine)');
let desktopMode = false;
let deviceModeReady = false;
function isDesktopMode() { return desktopMode; }

const desktopNavOrder = [
  ['messages', 'map', 'gigs', 'journal', 'vehicles', 'radio'],
  ['internet', 'camera', 'shards', 'status', 'photo', 'settings'],
];
function renderDesktopNav() {
  const host = $('desktop-nav-links');
  if (!host) return;
  // Rebuild navigation only when the language changes; frequent state updates
  // update badges without replacing the buttons.
  if (host.dataset.lang !== LANG) {
    host.innerHTML = desktopNavOrder.map((group, groupIndex) => `
      <div class="desktop-nav-group${groupIndex ? ' secondary' : ''}">
        ${group.map((id) => {
          const app = OS.apps.find((x) => x.id === id);
          if (!app) return '';
          const icon = app.img
            ? `<img src="${esc(app.img)}" alt="">`
            : `<svg viewBox="0 0 24 24" aria-hidden="true"><use href="#${app.icon}"></use></svg>`;
          return `<button class="desktop-link" type="button" data-desktop-app="${app.id}" style="--app-color:${app.color}" title="${esc(t(app.label))}">
            <span class="desktop-link-icon">${icon}</span><span class="desktop-link-name">${esc(t(app.label))}</span>
            ${id === 'messages' ? '<b class="desktop-link-badge" data-desktop-unread hidden></b>' : ''}
          </button>`;
        }).join('')}
      </div>`).join('');
    host.dataset.lang = LANG;
  }
  const unread = (game().contacts || []).reduce((n, c) => n + (c.unread || 0), 0);
  const badge = host.querySelector('[data-desktop-unread]');
  if (badge) {
    badge.hidden = !unread;
    badge.textContent = unread > 99 ? '99+' : String(unread || '');
  }
  updateDesktopNavActive();
}
function updateDesktopNavActive() {
  const home = $('desktop-home');
  if (home) home.classList.toggle('is-active', currentApp === 'home');
  for (const b of document.querySelectorAll('[data-desktop-app]')) {
    const active = b.dataset.desktopApp === currentApp;
    b.classList.toggle('is-active', active);
    if (active) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  }
}
function applyDeviceMode() {
  const next = desktopMedia.matches;
  if (deviceModeReady && next === desktopMode) return;
  desktopMode = next;
  deviceModeReady = true;
  document.body.classList.toggle('is-desktop', desktopMode);
  document.body.classList.toggle('is-mobile', !desktopMode);
  $('desktop-sidebar').hidden = !desktopMode;
  $('statusbar').hidden = desktopMode;
  $('navbar').hidden = desktopMode;
  $('homebar').hidden = desktopMode;
  $('appbar').hidden = desktopMode ? false : currentApp === 'home';
  $('appbar-back').hidden = desktopMode && !((currentApp === 'messages' && chatOpen) || (currentApp === 'shards' && shardOpen));
  if (desktopMode && currentApp === 'home') $('appbar-title').textContent = 'NEUROPORT';
  else if (desktopMode && !chatOpen) {
    const app = OS.apps.find((x) => x.id === currentApp);
    $('appbar-title').textContent = app ? t(app.label) : 'NEUROPORT';
  }
  renderDesktopNav();
  if (typeof updateShardPane === 'function') updateShardPane();
  if (typeof renderCommTabs === 'function' && currentApp === 'messages') {
    renderCommTabs();
    if (chatOpen && desktopMode) renderChat(true);
  }
  // If the layout changes while Holo Auto is open, also reapply the camera distance
  // for desktop or mobile (the canvas resizes itself).
  if (typeof carVisible !== 'undefined' && carVisible && typeof mountMap === 'function') mountMap('car');
  if (typeof renderHome === 'function') renderHome(true);
}
$('desktop-home').addEventListener('click', () => goHome());
$('desktop-nav-links').addEventListener('click', (e) => {
  const b = e.target.closest('[data-desktop-app]');
  if (b) launchApp(b.dataset.desktopApp);
});
desktopMedia.addEventListener ? desktopMedia.addEventListener('change', applyDeviceMode) : desktopMedia.addListener(applyDeviceMode);
window.addEventListener('resize', applyDeviceMode);

function openApp(id, opts = {}) {
  if (id === 'home') return goHome();
  if (id === 'contacts') { commTab = 'contacts'; id = 'messages'; }
  const app = OS.apps.find((a) => a.id === id);
  document.body.classList.add('app-open');
  $('panel-home').hidden = true;
  $('appbar').hidden = false;
  $('appbar-back').hidden = isDesktopMode() && !((id === 'messages' && chatOpen) || (id === 'shards' && shardOpen));
  if (id === 'messages' && chatOpen) {
    const contact = contactById(chatOpen) || {};
    $('appbar-title').innerHTML = `<span class="chat-head"><span class="avatar avatar-sm">${avatarHtml(contact)}</span><span>${esc(contact.name || t('appMessages'))}</span></span>`;
  } else $('appbar-title').textContent = app ? t(app.label) : '';
  $('appbar-action').innerHTML = '';
  currentApp = id;
  if (id === 'shards' && typeof updateShardPane === 'function') updateShardPane();
  updateDesktopNavActive();
  recentApps = [id, ...recentApps.filter((x) => x !== id)].slice(0, 6);
  closeRecents();
  switchTab(id);
  const panel = $('panel-' + id);
  if (panel && !opts.noAnim) { panel.classList.remove('app-enter'); void panel.offsetWidth; panel.classList.add('app-enter'); }
  if (!opts.fromHistory) history.pushState({ app: id }, '', '#' + id);
  onAppOpen(id);
}
let recentApps = [];
function goHome(fromHistory) {
  closeRecents();
  if (currentApp === 'messages' && chatOpen) closeChat(true);
  currentApp = 'home';
  document.body.classList.remove('app-open');
  for (const p of document.querySelectorAll('#app > .panel')) p.hidden = true;
  $('panel-home').hidden = false;
  $('appbar').hidden = !isDesktopMode();
  $('appbar-back').hidden = isDesktopMode();
  $('appbar-title').textContent = 'NEUROPORT';
  $('appbar-action').innerHTML = '';
  updateDesktopNavActive();
  tab = 'home';
  HoloMap.setVisible(false);
  if (window.Map3D && Map3D.ready && typeof mapHost !== 'undefined' && mapHost === 'phone') Map3D.setVisible(false);
  if (!fromHistory && location.hash) history.pushState({ app: 'home' }, '', location.pathname + location.search);
  renderHome(true);
  requestAnimationFrame(() => applyWallpaper());
}
window.addEventListener('popstate', (e) => {
  // Android Back button: close the conversation first, then the app.
  if (chatOpen) { closeChat(true); history.pushState({ app: 'messages' }, '', '#messages'); return; }
  if (shardOpen) { closeShard(true); return; }
  const id = (e.state && e.state.app) || 'home';
  if (id === 'home') goHome(true); else openApp(id, { fromHistory: true });
});
function navBack() {
  if (!$('recents').hidden) { closeRecents(); return; }
  if (chatOpen) { closeChat(); return; }
  if (shardOpen) { closeShard(); return; }
  if (currentApp === 'home') return;
  if (history.state && history.state.app && history.state.app !== 'home') history.back(); else goHome();
}
$('appbar-back').addEventListener('click', () => { buzz(6); navBack(); });

// ---------- Navigation: buttons or gestures (Settings) ----------
function applyNav() {
  document.body.classList.toggle('nav-buttons', prefs.nav !== 'gestures');
  document.body.classList.toggle('nav-gestures', prefs.nav === 'gestures');
  document.body.classList.toggle('nav-right', prefs.navSide === 'right');
}
$('navbar').addEventListener('click', (e) => {
  const b = e.target.closest('[data-nav]');
  if (!b) return;
  buzz(8);
  const a = b.dataset.nav;
  if (a === 'back') navBack();
  else if (a === 'home') goHome();
  else toggleRecents();
});
// Recent apps: the last three apps (excluding the current app when others are available).
function toggleRecents() { if ($('recents').hidden) openRecents(); else closeRecents(); }
function openRecents() {
  const list = recentApps.filter((id) => id !== currentApp).slice(0, 3);
  if (!list.length && currentApp !== 'home') list.push(currentApp);
  $('recents-row').innerHTML = list.map((id) => {
    const a = OS.apps.find((x) => x.id === id);
    if (!a) return '';
    return `<button class="recent-card" data-app="${a.id}" style="--c:${a.color}">
      <span class="ico-tile">${a.img ? `<img class="ico-img" src="${a.img}" alt="">` : `<svg viewBox="0 0 24 24"><use href="#${a.icon}"/></svg>`}</span>
      <b>${esc(t(a.label))}</b></button>`;
  }).join('') || `<p class="dim">${t('noRecents')}</p>`;
  $('recents').hidden = false;
}
function closeRecents() { if ($('recents')) $('recents').hidden = true; }
$('recents').addEventListener('click', (e) => {
  const b = e.target.closest('[data-app]');
  if (b) { buzz(8); openApp(b.dataset.app); return; }
  closeRecents();
});
// Gestures: swipe inward from either side edge to go back; swipe up from the bottom edge to go
// home; swipe up and hold to open recent apps.
(() => {
  let g = null;
  const EDGE = 22;
  document.addEventListener('touchstart', (e) => {
    if (prefs.nav !== 'gestures' || e.touches.length !== 1) { g = null; return; }
    const p = e.touches[0];
    const w = window.innerWidth, h = window.innerHeight;
    const kind = p.clientX < EDGE ? 'left' : p.clientX > w - EDGE ? 'right' : p.clientY > h - 34 ? 'bottom' : null;
    g = kind ? { kind, x: p.clientX, y: p.clientY, t: performance.now() } : null;
  }, { passive: true, capture: true });
  document.addEventListener('touchend', (e) => {
    if (!g) return;
    const p = e.changedTouches[0];
    const dx = p.clientX - g.x, dy = p.clientY - g.y, dt = performance.now() - g.t;
    if ((g.kind === 'left' && dx > 60) || (g.kind === 'right' && dx < -60)) { if (Math.abs(dy) < 80) { buzz(8); navBack(); } }
    else if (g.kind === 'bottom' && dy < -40) { buzz(8); if (dt > 450 && Math.abs(dy) < 220) openRecents(); else goHome(); }
    g = null;
  }, { capture: true });
})();
applyNav();

// Gesture: swipe up from the bottom bar to return to the home screen.
(() => {
  const bar = $('homebar');
  let y0 = null;
  bar.addEventListener('pointerdown', (e) => { y0 = e.clientY; bar.setPointerCapture(e.pointerId); });
  bar.addEventListener('pointerup', (e) => { if (y0 != null && (y0 - e.clientY > 25 || Math.abs(y0 - e.clientY) < 6)) { buzz(8); goHome(); } y0 = null; });
})();

function onAppOpen(id) {
  if (id === 'camera') loadPhotos();
  if (id === 'internet') renderInternet(true);
  if (id === 'settings') renderSettings();
  if (id === 'shards') loadShards();
  if (id === 'status') renderStatusApp(true);
  if (id === 'messages') renderMessages(true);
}

// ---------- Status bar ----------
function renderStatus() {
  const g = game();
  const p = g.player || {};
  $('sb-time').textContent = p.timeH != null ? `${pad(p.timeH)}:${pad(p.timeM)}` : '--:--';
  const live = state && state.online && g.inGame;
  $('sb-link').className = 'sb-link' + (live ? ' on' : '');
  $('sb-imm').hidden = !g.immersive;
  $('sb-car').hidden = !(g.vehicle && g.vehicle.inside);
  const hp = Math.max(0, Math.min(100, Math.round(p.health ?? 100)));
  $('sb-bat-fill').style.width = hp + '%';
  $('sb-bat').classList.toggle('low', hp < 30);
  $('sb-bat-val').textContent = hp;
}

// ---------- Home screen ----------
let lastHomeKey = '';
function renderHome(force) {
  const g = game();
  const p = g.player || {};
  applyWallpaper();
  $('home-time').textContent = p.timeH != null ? `${pad(p.timeH)}:${pad(p.timeM)}` : '--:--';
  $('home-date').textContent = [p.day != null ? `${t('day')} ${p.day}` : null, g.district].filter(Boolean).join(' · ');
  $('home-money').textContent = p.money != null ? fmtMoney(p.money) : '—';
  const unread = (g.contacts || []).reduce((n, c) => n + (c.unread || 0), 0);
  const j = g.journal || {};
  const tq = (j.quests || []).find((q) => q.id === j.tracked);
  const r = g.radio || {};
  const key = JSON.stringify([unread, tq, r.on, r.station, r.track, r.vol, LANG, OS.apps.length]);
  if (!force && key === lastHomeKey) return;
  lastHomeKey = key;
  const badges = { messages: unread };
  const icon = (a) => `
    <button class="ico" data-app="${a.id}" style="--c:${a.color}">
      <span class="ico-tile">${a.img ? `<img class="ico-img" src="${a.img}" alt="">` : `<svg viewBox="0 0 24 24"><use href="#${a.icon}"/></svg>`}${badges[a.id] ? `<b class="ico-badge">${badges[a.id]}</b>` : ''}</span>
      <span class="ico-label">${esc(t(a.label))}</span>
    </button>`;
  // Alphabetical app grid (using the current language); the dock stays fixed.
  // Settings is always last.
  const homeApps = isDesktopMode() ? [...OS.apps] : OS.apps.filter((a) => !OS.dock.includes(a.id));
  $('home-grid').innerHTML = homeApps
    .sort((x, y) => (x.id === 'settings') - (y.id === 'settings') || t(x.label).localeCompare(t(y.label), LANG)).map(icon).join('');
  $('home-dock').hidden = isDesktopMode();
  $('home-dock').innerHTML = isDesktopMode() ? '' : OS.dock.map((id) => icon(OS.apps.find((a) => a.id === id))).join('');
  $('w-quest').hidden = !tq;
  if (tq) {
    $('w-quest-title').textContent = tq.title;
    $('w-quest-obj').textContent = [tq.objective, tq.dist != null ? fmtDist(tq.dist) : ''].filter(Boolean).join(' · ');
  }
  $('w-radio-station').textContent = r.station || t('radioOff');
  $('w-radio-track').textContent = r.on ? (r.track || '') : t('radioOff');
  $('w-radio').classList.toggle('on', !!r.on);
  $('w-radio-pp').setAttribute('href', r.on ? '#i-pause' : '#i-play');
  $('w-radio-vol').textContent = r.vol != null ? r.vol + '%' : '';
}
// Apps that trigger an in-game action without opening a screen (Camera opens photo mode).
function launchApp(id) {
  const a = OS.apps.find((x) => x.id === id);
  if (a && a.action) {
    buzz([10, 30, 10]);
    cmd(a.action);
    toast(t('photoModeOpening'), true, t(a.label));
    return;
  }
  buzz(8);
  openApp(id);
}
$('home-grid').addEventListener('click', (e) => { const b = e.target.closest('[data-app]'); if (b) launchApp(b.dataset.app); });
$('home-dock').addEventListener('click', (e) => { const b = e.target.closest('[data-app]'); if (b) launchApp(b.dataset.app); });
$('w-quest').addEventListener('click', (e) => {
  if (e.target.closest('#w-quest-x')) { buzz(12); cmd('untrack'); return; }
  buzz(8); openApp('journal');
});
$('w-radio').addEventListener('click', (e) => {
  if (e.target.closest('[data-wr]')) {
    buzz(10);
    const a = e.target.closest('[data-wr]').dataset.wr;
    const r = game().radio || {};
    if (a === 'vup' || a === 'vdown') { cmd('radio_vol', a === 'vup' ? 1 : -1); return; }
    cmd(a === 'power' ? (r.on ? 'radio_off' : 'radio_on') : a === 'next' ? 'radio_next' : 'radio_prev');
    return;
  }
  buzz(8); openApp('radio');
});

// ---------- ajustes ----------
// Wallpaper: a photo from the in-game photo-mode gallery behind the home screen.
function setWallpaper(name) {
  prefs.wallpaper = name || null;
  savePrefs();
  applyWallpaper();
}
const wallUrl = (name) => (name && key ? `photo/${encodeURIComponent(name)}?k=${encodeURIComponent(key)}` : null);
// Actual photo dimensions (for zoom and framing); loaded once per photo.
const wallNat = new Map();
function wallSize(url, cb) {
  const n = wallNat.get(url);
  if (n && n.w) return cb(n);
  if (n) { n.cbs.push(cb); return; }
  const rec = { w: 0, h: 0, cbs: [cb] };
  wallNat.set(url, rec);
  const img = new Image();
  img.onload = () => { rec.w = img.naturalWidth; rec.h = img.naturalHeight; for (const f of rec.cbs.splice(0)) f(rec); };
  img.src = url;
}
// Framing: center point (x/y in %) and zoom relative to cover-to-fill sizing.
const wallFrame = () => Object.assign({ x: 50, y: 50, z: 1 }, (prefs.wallFrame || {})[prefs.wallpaper] || {});
function layoutWall(el, url, fr, withShade) {
  wallSize(url, (n) => {
    const W = el.clientWidth || innerWidth, H = el.clientHeight || innerHeight;
    const s = Math.max(W / n.w, H / n.h) * fr.z;
    const size = `${Math.round(n.w * s)}px ${Math.round(n.h * s)}px`;
    el.style.backgroundSize = withShade ? `auto, ${size}` : size;
    el.style.backgroundPosition = withShade ? `0 0, ${fr.x}% ${fr.y}%` : `${fr.x}% ${fr.y}%`;
  });
}
function applyWallpaper() {
  const home = $('panel-home');
  if (!home) return;
  const url = wallUrl(prefs.wallpaper);
  home.classList.toggle('has-wall', !!url);
  home.style.setProperty('--wall', url ? `url("${url}")` : 'none');
  if (url) layoutWall(home, url, wallFrame(), true);
}
addEventListener('resize', () => applyWallpaper());

// Framing editor: drag to move the photo; use the slider or pinch to zoom.
let weFrame = null, weDrag = null;
function openWallEdit() {
  const url = wallUrl(prefs.wallpaper);
  if (!url) return;
  weFrame = wallFrame();
  const img = $('we-img');
  img.style.backgroundImage = `url("${url}")`;
  $('we-zoom').value = weFrame.z;
  $('wall-edit').hidden = false;
  requestAnimationFrame(() => layoutWall(img, url, weFrame, false));
}
function weApply() { layoutWall($('we-img'), wallUrl(prefs.wallpaper), weFrame, false); }
function closeWallEdit(save) {
  if (save && weFrame) {
    prefs.wallFrame = { ...(prefs.wallFrame || {}), [prefs.wallpaper]: weFrame };
    savePrefs();
    applyWallpaper();
  }
  $('wall-edit').hidden = true;
  weFrame = null;
}
(() => {
  const el = $('we-img');
  const pts = new Map();
  const move = (dx, dy) => {
    const url = wallUrl(prefs.wallpaper);
    const n = wallNat.get(url);
    if (!n || !n.w) return;
    const W = el.clientWidth, H = el.clientHeight;
    const s = Math.max(W / n.w, H / n.h) * weFrame.z;
    const ox = W - n.w * s, oy = H - n.h * s;   // Remaining space (negative when the photo is larger).
    if (ox < -1) weFrame.x = Math.min(100, Math.max(0, weFrame.x + (dx / ox) * 100));
    if (oy < -1) weFrame.y = Math.min(100, Math.max(0, weFrame.y + (dy / oy) * 100));
    weApply();
  };
  el.addEventListener('pointerdown', (e) => { el.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); weDrag = null; });
  el.addEventListener('pointermove', (e) => {
    const p = pts.get(e.pointerId);
    if (!p || !weFrame) return;
    if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      const d0 = Math.hypot(a.x - b.x, a.y - b.y);
      p.x = e.clientX; p.y = e.clientY;
      const [c, d] = [...pts.values()];
      const d1 = Math.hypot(c.x - d.x, c.y - d.y);
      if (d0 > 0) { weFrame.z = Math.min(3, Math.max(1, weFrame.z * (d1 / d0))); $('we-zoom').value = weFrame.z; weApply(); }
      return;
    }
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    move(dx, dy);
  });
  const up = (e) => pts.delete(e.pointerId);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  $('we-zoom').addEventListener('input', () => { if (!weFrame) return; weFrame.z = Number($('we-zoom').value); weApply(); });
  $('we-reset').addEventListener('click', () => { buzz(8); weFrame = { x: 50, y: 50, z: 1 }; $('we-zoom').value = 1; weApply(); });
  $('we-cancel').addEventListener('click', () => { buzz(8); closeWallEdit(false); });
  $('we-done').addEventListener('click', () => { buzz(12); closeWallEdit(true); });
})();
setTimeout(applyWallpaper, 0);
// Photo list available in Settings.
let settingsPhotosAt = 0;
function settingsPhotos() {
  if (Date.now() - settingsPhotosAt < 15000) return;
  settingsPhotosAt = Date.now();
  loadPhotos().then(() => renderSettings());
}
function renderSettings() {
  if (!$('panel-settings') || $('panel-settings').hidden) return;
  settingsPhotos();
  const g = game();
  const row = (id, title, desc, on, extra = '') => `
    <button class="set-row" data-set="${id}">
      <span class="set-main"><b>${esc(title)}</b><small>${esc(desc)}</small></span>
      ${extra || `<span class="switch${on ? ' on' : ''}"><i></i></span>`}
    </button>`;
  $('settings-list').innerHTML = `
    <div class="set-group"><div class="tag">${t('setGame')}</div>
      ${row('immersive', t('setImmersive'), t('setImmersiveDesc'), !!g.immersive)}
    </div>
    ${(g.immHud || []).length && g.immersive ? `<div class="set-group"><button class="set-fold${immOpen ? ' open' : ''}" data-fold="imm"><span class="tag">${t('setImmHud')}</span><span class="fold-chev">›</span></button>
      ${immOpen ? `<p class="set-note dim">${esc(t('setImmHudDesc'))}</p>
      <button class="set-row imm-all" data-immall="1">
        <span class="set-main"><b>${esc(t('immAll'))}</b><small>${esc(t('immAllDesc'))}</small></span>
        <span class="switch${(g.immHud || []).every((e) => e.h) ? ' on' : ''}"><i></i></span>
      </button>
      ${(g.immHud || []).map((e) => `
        <button class="set-row" data-imm="${esc(e.n)}">
          <span class="set-main"><b>${esc(immLabel(e))}</b>${e.x ? `<small>${esc(t('immExtra'))}</small>` : ''}</span>
          <span class="switch${e.h ? '' : ' on'}"><i></i></span>
        </button>`).join('')}` : ''}
    </div>` : ''}
    <div class="set-group"><div class="tag">${t('setPhone')}</div>
      ${canFullscreen() ? row('fullscreen', t('setFullscreen'), t('setFullscreenDesc'), isFullscreen()) : ''}
      ${row('autoCar', t('setAutoCar'), t('setAutoCarDesc'), prefs.autoCar)}
      ${row('ring', t('setRing'), t('setRingDesc'), prefs.ring)}
      ${row('vibrate', t('setVibrate'), t('setVibrateDesc'), prefs.vibrate)}
    </div>
    <div class="set-group"><div class="tag">${t('setNav')}</div>
      ${row('nav', t('setNavMode'), t(prefs.nav === 'gestures' ? 'setNavGesturesDesc' : 'setNavButtonsDesc'), false,
        `<span class="seg"><span class="seg-b${prefs.nav !== 'gestures' ? ' is-active' : ''}">${t('navButtons')}</span><span class="seg-b${prefs.nav === 'gestures' ? ' is-active' : ''}">${t('navGestures')}</span></span>`)}
      ${prefs.nav !== 'gestures' ? row('navSide', t('setNavSide'), t('setNavSideDesc'), false,
        `<span class="seg"><span class="seg-b${prefs.navSide !== 'right' ? ' is-active' : ''}">◁ ○ |||</span><span class="seg-b${prefs.navSide === 'right' ? ' is-active' : ''}">||| ○ ◁</span></span>`) : ''}
    </div>
    <div class="set-group"><div class="tag">${t('setWall')}</div>
      <p class="set-note dim">${esc(t('setWallDesc'))}</p>
      <div class="wp-strip">
        <button class="wp-tile wp-none${prefs.wallpaper ? '' : ' on'}" data-wp=""><span>${t('wallDefault')}</span></button>
        ${photos.slice(0, 30).map((p) => `<button class="wp-tile${prefs.wallpaper === p.name ? ' on' : ''}" data-wp="${esc(p.name)}"><img src="photo/${encodeURIComponent(p.name)}?k=${encodeURIComponent(key)}" loading="lazy" alt=""></button>`).join('')}
      </div>
      ${photos.length ? '' : `<p class="set-note dim">${esc(t('noPhotos'))}</p>`}
      ${prefs.wallpaper ? `<button class="btn wp-adjust" data-wpadj="1"><svg viewBox="0 0 24 24"><use href="#i-target"/></svg><span>${t('wallAdjust')}</span></button>` : ''}
    </div>
    <div class="set-group"><div class="tag">${t('setMap')}</div>
      ${row('mapMode', t('setMapMode'), t(prefs.mapMode === 'all' ? 'mapModeAllDesc' : 'mapModeActiveDesc'), false,
        `<span class="seg"><span class="seg-b${prefs.mapMode !== 'all' ? ' is-active' : ''}">${t('mapActive')}</span><span class="seg-b${prefs.mapMode === 'all' ? ' is-active' : ''}">${t('mapAll')}</span></span>`)}
    </div>
    <div class="set-group"><div class="tag">${t('setAbout')}</div>
      <div class="set-info"><span>Neuroport</span><b>${g.mod ? 'mod v' + esc(g.mod) : '—'}</b></div>
      <div class="set-info"><span>${t('setLang')}</span><b>${esc(g.lang || '—')}</b></div>
      <div class="set-info"><span>${t('setLink')}</span><b>${esc(location.host)}</b></div>
      ${row('forget', t('setForget'), t('setForgetDesc'), false, '<span class="chev-r">›</span>')}
    </div>`;
}
// Immersive-mode list: shown when enabled; the › button collapses or expands it.
let immOpen = true;
let immWasOn = null;
function immLabel(e) {
  const k = 'imm_' + e.n;
  const v = t(k);
  if (v !== k) return v;
  const l = e.l && !/ToCName|hash_/i.test(e.l) ? e.l : '';
  return l || e.n.replace(/_/g, ' ');
}
$('settings-list').addEventListener('click', (e) => {
  if (e.target.closest('[data-fold]')) { buzz(6); immOpen = !immOpen; renderSettings(); return; }
  if (e.target.closest('[data-wpadj]')) { buzz(8); openWallEdit(); return; }
  const wp = e.target.closest('[data-wp]');
  if (wp) { buzz(8); setWallpaper(wp.dataset.wp || null); renderSettings(); return; }
  if (e.target.closest('[data-immall]')) {
    buzz(10);
    const g = game();
    const hideAll = !(g.immHud || []).every((x) => x.h);
    cmd('imm_all', hideAll ? '1' : '0');
    for (const x of g.immHud || []) x.h = hideAll || undefined;   // Immediate response.
    renderSettings();
    return;
  }
  const im = e.target.closest('[data-imm]');
  if (im) {
    buzz(8);
    cmd('imm_toggle', im.dataset.imm);
    const g = game();
    const it = (g.immHud || []).find((x) => x.n === im.dataset.imm);
    if (it) it.h = !it.h;      // Immediate response; the game confirms it in the next state update.
    renderSettings();
    return;
  }
  const b = e.target.closest('[data-set]');
  if (!b) return;
  buzz(10);
  const id = b.dataset.set;
  if (id === 'immersive') cmd(game().immersive ? 'immersive_off' : 'immersive_on');
  else if (id === 'fullscreen') toggleFullscreen();
  else if (id === 'nav') { prefs.nav = prefs.nav === 'gestures' ? 'buttons' : 'gestures'; savePrefs(); applyNav(); }
  else if (id === 'navSide') { prefs.navSide = prefs.navSide === 'right' ? 'left' : 'right'; savePrefs(); applyNav(); }
  else if (id === 'mapMode') { prefs.mapMode = prefs.mapMode === 'all' ? 'active' : 'all'; savePrefs(); lastGigsKey = ''; renderMap(); }
  else if (id === 'forget') { if (confirm(t('setForgetDesc'))) { store(KEY_STORE, null); store('holophone.key', null); location.reload(); } return; }
  else if (id in prefs) { prefs[id] = !prefs[id]; savePrefs(); }
  renderSettings();
});

// ---------- Map: Active / All toggle ----------
function renderMapMode() {
  const lbl = t(prefs.mapMode === 'all' ? 'mapAll' : 'mapActive');
  if ($('map-modeset')) { $('map-modeset-label').textContent = lbl; $('map-modeset').classList.toggle('on', prefs.mapMode === 'all'); }
  if ($('car-modeset')) { $('car-modeset').textContent = lbl; $('car-modeset').classList.toggle('on', prefs.mapMode === 'all'); }
}
function toggleMapMode() {
  buzz(8);
  prefs.mapMode = prefs.mapMode === 'all' ? 'active' : 'all';
  savePrefs();
  toast(t(prefs.mapMode === 'all' ? 'mapModeAllDesc' : 'mapModeActiveDesc'), true, t('appMap'));
  lastGigsKey = '';
  renderMap();
  renderMapMode();
  if (window.renderCar) renderCar(true);
}
if ($('map-modeset')) $('map-modeset').addEventListener('click', toggleMapMode);
$('car-modeset').addEventListener('click', toggleMapMode);

// ---------- Messages ----------
let chatOpen = null;      // Contact ID.
let lastMsgListKey = '';
let lastChatKey = '';
let pendingReply = null;  // { text, at }

function timeLabel(tm, today) {
  if (!tm) return '';
  if (today != null && tm.d != null && tm.d !== today) return `${t('day')} ${tm.d}`;
  return `${pad(tm.h)}:${pad(tm.m)}`;
}
function contactSortKey(c) { return c.t ? c.t.d * 1440 + c.t.h * 60 + c.t.m : -1; }

function renderMessages(force) {
  if (currentApp !== 'messages') return;
  if (chatOpen && !isDesktopMode()) { renderChat(force); return; }
  const g = game();
  renderCommTabs();
  if (commTab !== 'messages') { if (chatOpen) renderChat(force); return; }
  // As in the game, conversations awaiting a reply or with new messages appear first; read ones are dimmed.
  const waiting = (c) => !!(c.unread || (c.reply && !c.last));
  const list = (g.contacts || []).filter((c) => c.messages || c.preview)
    .sort((a, b) => (waiting(b) - waiting(a)) || (contactSortKey(b) - contactSortKey(a)));
  const today = (g.player || {}).day;
  const key = JSON.stringify([list, LANG]);
  if (!force && key === lastMsgListKey) { if (chatOpen) renderChat(force); return; }
  lastMsgListKey = key;
  const item = (c) => `
    <li class="conv${c.unread ? ' unread' : ''}${waiting(c) ? '' : ' read'}${c.id === chatOpen ? ' is-active' : ''}" data-id="${esc(c.id)}"${c.id === chatOpen ? ' aria-current="true"' : ''}${c._o ? ` style="opacity:${c._o}"` : ''}>
      <div class="avatar">${avatarHtml(c)}</div>
      <div class="conv-main">
        <div class="conv-top"><span class="conv-name">${esc(c.name)}</span><span class="conv-time">${esc(timeLabel(c.t, today))}</span></div>
        <div class="conv-prev">${c.reply && !c.last && !c.unread ? `<span class="conv-tag">${t('needsReply')}</span>` : ''}${esc(oneLine(c.preview))}</div>
      </div>
      ${c.unread ? `<span class="conv-badge"><svg viewBox="0 0 24 24"><use href="#i-chat"/></svg></span>` : ''}
    </li>`;
  // Divider: unread or awaiting-reply conversations above, read conversations below.
  const fresh = list.filter(waiting), old = list.filter((c) => !waiting(c));
  old.forEach((c, i) => { c._o = Math.max(0.38, 1 - i * 0.07).toFixed(2); });
  const head = (k, n) => `<li class="conv-div"><span>${t(k)}</span><b>${n}</b></li>`;
  $('msg-list').innerHTML = list.length
    ? (fresh.length ? head('msgUnread', fresh.length) + fresh.map(item).join('') : '') +
      (old.length ? head('msgRead', old.length) + old.map(item).join('') : '')
    : `<p class="empty dim">${t('noMessages')}</p>`;
  if (chatOpen) renderChat(force);
}
$('msg-list').addEventListener('click', (e) => { const li = e.target.closest('.conv'); if (li) { buzz(8); openChat(li.dataset.id); } });

// Notification for a new contact message (in-app alert and vibration), except in the open conversation.
const msgSeen = new Map();   // ID -> signature (timestamp + preview).
let msgSeenReady = false;
function checkNewMessages() {
  const list = game().contacts || [];
  if (!list.length) return;
  const fresh = [];
  for (const c of list) {
    const sig = JSON.stringify([c.t, c.preview, c.unread]);
    const prev = msgSeen.get(c.id);
    if (msgSeenReady && prev !== undefined && prev !== sig && c.unread > 0 && !(currentApp === 'messages' && chatOpen === c.id)) fresh.push(c);
    msgSeen.set(c.id, sig);
  }
  msgSeenReady = true;
  for (const c of fresh.slice(0, 3)) {
    buzz([30, 60, 30]);
    msgToast(c);
  }
}
// Heads-up notification: slides over the current screen without blocking it.
// Tap to open the conversation, swipe up to dismiss, or wait six seconds for it to disappear.
function msgToast(c) {
  const box = $('headsup');
  const old = box.querySelector(`[data-c="${CSS.escape(c.id)}"]`);
  if (old) old.remove();
  while (box.children.length >= 2) box.firstElementChild.remove();
  const el = document.createElement('div');
  el.className = 'hu';
  el.dataset.c = c.id;
  const p = (game().player || {});
  const time = p.timeH != null ? `${pad(p.timeH)}:${pad(p.timeM)}` : '';
  el.innerHTML = `<div class="hu-top"><svg viewBox="0 0 24 24"><use href="#i-chat"/></svg><span>${esc(t('appMessages'))}</span><i>${esc(time)}</i></div>
    <div class="hu-body"><div class="tm-av avatar avatar-sm">${avatarHtml(c)}</div>
    <div class="hu-main"><b>${esc(c.name)}</b><p>${esc(oneLine(c.preview).slice(0, 160))}</p></div></div>`;
  const close = () => { el.classList.add('out'); setTimeout(() => el.remove(), 300); };
  let y0 = null, dy = 0;
  el.addEventListener('pointerdown', (e) => { y0 = e.clientY; dy = 0; el.setPointerCapture(e.pointerId); });
  el.addEventListener('pointermove', (e) => { if (y0 == null) return; dy = Math.min(0, e.clientY - y0); el.style.transform = `translateY(${dy}px)`; });
  el.addEventListener('pointerup', () => {
    if (y0 == null) return;
    y0 = null;
    if (dy < -30) { close(); return; }
    el.style.transform = '';
    if (Math.abs(dy) < 6) { el.remove(); openApp('messages'); openChat(c.id); }
  });
  box.appendChild(el);
  setTimeout(close, 6000);
}

// Comms app tabs: messages | contacts.
let commTab = 'messages';
function renderCommTabs() {
  const unread = (game().contacts || []).reduce((n, c) => n + (c.unread || 0), 0);
  const splitView = isDesktopMode();
  $('comm-tabs').hidden = !!chatOpen && !splitView;
  $('comms-empty').hidden = !splitView || !!chatOpen;
  for (const b of document.querySelectorAll('#comm-tabs .seg-b')) b.classList.toggle('is-active', b.dataset.ct === commTab);
  $('comm-unread').textContent = unread || '';
  $('msg-list').hidden = (!splitView && !!chatOpen) || commTab !== 'messages';
  $('comm-contacts').hidden = (!splitView && !!chatOpen) || commTab !== 'contacts';
}
$('comm-tabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-ct]');
  if (!b) return;
  buzz(6);
  commTab = b.dataset.ct;
  lastMsgListKey = '';
  renderMessages(true);
});

function openChat(id) {
  chatOpen = id;
  lastChatKey = '';
  pendingReply = null;
  lastGoodThread = null;
  for (const row of $('msg-list').querySelectorAll('.conv')) {
    const active = row.dataset.id === id;
    row.classList.toggle('is-active', active);
    if (active) row.setAttribute('aria-current', 'true');
    else row.removeAttribute('aria-current');
  }
  $('chat').hidden = false;
  $('comms-empty').hidden = true;
  $('appbar-back').hidden = false;
  const splitView = isDesktopMode();
  $('msg-list').hidden = !splitView || commTab !== 'messages';
  $('comm-tabs').hidden = !splitView;
  $('comm-contacts').hidden = !splitView || commTab !== 'contacts';
  const c = contactById(id) || { name: '' };
  $('appbar-title').innerHTML = `<span class="chat-head"><span class="avatar avatar-sm">${avatarHtml(c)}</span><span>${esc(c.name)}</span></span>`;
  $('appbar-action').innerHTML = c.callable ? `<button class="appbar-btn" id="chat-call"><svg viewBox="0 0 24 24"><use href="#i-phone"/></svg></button>` : '';
  const callBtn = $('chat-call');
  if (callBtn) callBtn.onclick = () => { buzz(20); sheetContact = id; $('sheet-call').click(); };
  $('chat-body').innerHTML = `<div class="chat-loading dim">${t('loading')}</div>`;
  $('chat-replies').innerHTML = '';
  cmd('thread', id);
  history.pushState({ app: 'messages', chat: id }, '', '#messages/' + encodeURIComponent(id));
}
function closeChat(fromHistory) {
  if (!chatOpen) return;
  chatOpen = null;
  $('chat').hidden = true;
  $('comms-empty').hidden = !isDesktopMode();
  $('appbar-title').textContent = t('appMessages');
  $('appbar-back').hidden = isDesktopMode();
  $('appbar-action').innerHTML = '';
  cmd('thread_close');
  renderMessages(true);
  if (!fromHistory && history.state && history.state.chat) history.back();
}

let lastGoodThread = null;
function renderChat(force) {
  const g = game();
  let th = g.thread && g.thread.contact === chatOpen ? g.thread : null;
  // Never delete a conversation because of a temporary empty read.
  if (th && (th.messages || []).length) lastGoodThread = th;
  else if (th && lastGoodThread && lastGoodThread.contact === chatOpen) th = { ...lastGoodThread, choices: th.choices && th.choices.length ? th.choices : lastGoodThread.choices };
  // If no reply arrives within 10 seconds, stop showing the sending state.
  if (pendingReply && Date.now() - pendingReply.at > 10000) pendingReply = null;
  const today = (g.player || {}).day;
  const key = JSON.stringify([th, pendingReply, LANG]);
  if (!force && key === lastChatKey) return;
  lastChatKey = key;
  if (!th) return;
  const c = contactById(chatOpen) || {};
  let lastDay = null;
  const html = [];
  for (const m of th.messages || []) {
    if (m.t && m.t.d !== lastDay) { lastDay = m.t.d; html.push(`<div class="chat-day"><span>${t('day')} ${m.t.d}${m.t.d === today ? ' · ' + t('today') : ''}</span></div>`); }
    html.push(`
      <div class="bubble ${m.me ? 'me' : 'them'}">
        ${m.img ? `<button class="bubble-pic" data-pic="${esc(m.img.part)}" data-atlas="${esc(m.img.atlas || '')}"><img src="avatar/${encodeURIComponent(m.img.part)}.png${m.img.atlas ? `?a=${encodeURIComponent(m.img.atlas)}` : ''}" alt="" loading="lazy" onerror="this.parentNode.classList.add('broken')"><span>${t('image')}</span></button>`
          : m.image && !m.text ? `<div class="bubble-img">${t('image')}</div>` : ''}
        ${m.text ? `<div class="bubble-text">${esc(fixNl(m.text)).replace(/\n/g, '<br>')}</div>` : ''}
        <div class="bubble-meta">${m.t ? `${pad(m.t.h)}:${pad(m.t.m)}` : ''}${m.me ? '<span class="ticks">✓✓</span>' : ''}</div>
      </div>`);
  }
  // Reply that has been sent but has not yet returned from the game.
  if (pendingReply && !(th.messages || []).some((m) => m.me && m.text === pendingReply.text)) {
    html.push(`<div class="bubble me sending"><div class="bubble-text">${esc(pendingReply.text)}</div><div class="bubble-meta">${t('sending')}</div></div>`);
  } else if (pendingReply) pendingReply = null;
  if (!th.messages || !th.messages.length) html.push(`<p class="empty dim">${t('noMessages')}</p>`);
  const body = $('chat-body');
  const atEnd = body.scrollTop + body.clientHeight >= body.scrollHeight - 40;
  body.innerHTML = html.join('');
  if (atEnd || force) body.scrollTop = body.scrollHeight;
  const choices = pendingReply ? [] : (th.choices || []);
  $('chat-replies').innerHTML = choices.length
    ? `<div class="tag">${t('replies')}</div>` + choices.map((ch) => `<button class="reply${ch.important ? ' important' : ''}" data-id="${esc(ch.id)}"><span>${esc(ch.text || '…')}</span><svg viewBox="0 0 24 24"><use href="#i-send"/></svg></button>`).join('')
    : `<div class="chat-input"><span>${t(c.callable === false ? 'cantReply' : 'noReplies')}</span><svg viewBox="0 0 24 24"><use href="#i-send"/></svg></div>`;
}
$('chat-replies').addEventListener('click', (e) => {
  const b = e.target.closest('.reply');
  if (!b) return;
  buzz(15);
  pendingReply = { text: b.querySelector('span').textContent, at: Date.now() };
  $('chat-replies').innerHTML = '';
  cmd('reply', b.dataset.id);
  renderChat(true);
});

// ---------- internet ----------
let netPage = 'home';
let netBrand = null;
let lastNetKey = '';
const SHOP_SITE = { id: 'autofixer', name: 'Autofixer', addr: 'autofixer.nc' };

function offerImg(o) {
  if (!o.img || !o.img.part) return '';
  const q = o.img.atlas ? `?a=${encodeURIComponent(o.img.atlas)}` : '';
  return `<img src="avatar/${encodeURIComponent(o.img.part)}.png${q}" alt="" loading="lazy" onerror="this.remove()">`;
}
// Autofixer only: the other in-game websites are read-only pages that open at terminals.
function renderInternet(force) {
  if (currentApp !== 'internet') return;
  const g = game();
  const key = JSON.stringify([netBrand, g.offers, (g.player || {}).money, LANG]);
  if (!force && key === lastNetKey) return;
  lastNetKey = key;
  const money = (g.player || {}).money || 0;
  const offers = (g.offers || []).filter((o) => o.available || o.owned);
  const brands = [...new Set(offers.map((o) => o.brandName || o.brand).filter(Boolean))].sort();
  const shown = offers.filter((o) => !netBrand || (o.brandName || o.brand) === netBrand)
    .sort((a, b) => (a.owned - b.owned) || (a.price || 0) - (b.price || 0));
  $('net-addr').textContent = SHOP_SITE.addr + (netBrand ? '/' + netBrand.toLowerCase() : '');
  $('net-back').disabled = !netBrand;
  $('net-page').innerHTML = `
      <div class="shop-head"><img class="shop-logo" src="icons/autofixer_wide.png" alt="AUTOFIXER"><span>€$ ${fmtMoney(money)}</span></div>
      <div class="shop-brands"><button class="chip${!netBrand ? ' on' : ''}" data-brand="">${t('all')}</button>${brands.map((b) => `<button class="chip${b === netBrand ? ' on' : ''}" data-brand="${esc(b)}">${esc(b)}</button>`).join('')}</div>
      <div class="shop-grid">${shown.map((o) => `
        <div class="offer${o.owned ? ' owned' : ''}">
          <div class="offer-img">${offerImg(o)}</div>
          <div class="offer-brand">${esc(o.brandName || o.brand || '')}</div>
          <div class="offer-name">${esc(o.name || o.id)}</div>
          <div class="offer-row"><span class="offer-price">${o.price ? '€$ ' + fmtMoney(o.price) : '€$ —'}</span>
            ${o.owned ? `<span class="chip-active">${t('owned')}</span>` : `<button class="btn btn-primary btn-sm" data-buy="${esc(o.id)}"${!o.price || money < o.price ? ' disabled' : ''}>${t('buy')}</button>`}</div>
        </div>`).join('') || `<p class="dim">${t('netNoOffers')}</p>`}</div>`;
}
$('net-page').addEventListener('click', (e) => {
  const br = e.target.closest('[data-brand]');
  if (br) { buzz(6); netBrand = br.dataset.brand || null; renderInternet(true); $('net-page').scrollTop = 0; return; }
  const buy = e.target.closest('[data-buy]');
  if (buy) { buzz(10); askBuy(buy.dataset.buy); }
});
$('net-back').addEventListener('click', () => { buzz(6); netBrand = null; renderInternet(true); });
$('net-reload').addEventListener('click', () => { buzz(6); cmd('shop_refresh'); });

let buyId = null;
function askBuy(id) {
  const o = (game().offers || []).find((x) => x.id === id);
  if (!o) return;
  buyId = id;
  const money = (game().player || {}).money || 0;
  $('buy-img').innerHTML = offerImg(o);
  $('buy-name').textContent = o.name || id;
  $('buy-brand').textContent = o.brandName || o.brand || '';
  $('buy-price').textContent = '€$ ' + fmtMoney(o.price || 0);
  $('buy-after').textContent = '€$ ' + fmtMoney(money - (o.price || 0));
  $('buy-desc').textContent = o.desc || '';
  $('buy-desc').hidden = !o.desc;
  $('buy-sheet').hidden = false;
}
$('buy-cancel').addEventListener('click', () => { $('buy-sheet').hidden = true; buyId = null; });
$('buy-confirm').addEventListener('click', () => { if (!buyId) return; buzz([20, 40, 20]); cmd('buy', buyId); $('buy-sheet').hidden = true; buyId = null; });

// ---------- Camera ----------
let photos = [];
async function loadPhotos() {
  try { photos = await (await fetch(`/api/photos?k=${encodeURIComponent(key)}`)).json(); } catch { photos = []; }
  $('cam-gallery').innerHTML = photos.map((p, i) => `<button class="shot" data-i="${i}"><img src="photo/${encodeURIComponent(p.name)}?k=${encodeURIComponent(key)}" loading="lazy" alt=""></button>`).join('')
    || `<p class="empty dim">${t('noPhotos')}</p>`;
}
$('cam-shutter').addEventListener('click', () => {
  buzz([10, 30, 10]);
  $('cam-flash').classList.remove('go'); void $('cam-flash').offsetWidth; $('cam-flash').classList.add('go');
  cmd('photo_mode');
});
$('cam-refresh').addEventListener('click', () => { buzz(6); loadPhotos(); });
$('cam-gallery').addEventListener('click', (e) => {
  const b = e.target.closest('.shot');
  if (!b) return;
  const p = photos[Number(b.dataset.i)];
  $('viewer-img').src = `photo/${encodeURIComponent(p.name)}?k=${encodeURIComponent(key)}`;
  viewerPhoto = p.name;
  $('viewer-wall').hidden = false;
  $('viewer').hidden = false;
});
let viewerPhoto = null;
$('viewer-wall').addEventListener('click', (e) => {
  e.stopPropagation();
  if (!viewerPhoto) { toast(t('wallSetFail'), false, t('setWall')); return; }
  buzz(12);
  setWallpaper(viewerPhoto);
  $('viewer').hidden = true;
  viewerPhoto = null;
  goHome();
  requestAnimationFrame(() => applyWallpaper());
  toast(t('wallSet'), true, t('setWall'));
});
$('viewer').addEventListener('click', (e) => {
  if (e.target.closest('#viewer-wall')) return;
  $('viewer').hidden = true;
  viewerPhoto = null;
});
// An image attached to a message opens fullscreen.
$('chat-body').addEventListener('click', (e) => {
  const b = e.target.closest('.bubble-pic');
  if (!b || b.classList.contains('broken')) return;
  buzz(6);
  $('viewer-img').src = b.querySelector('img').src;
  $('viewer-wall').hidden = true;
  $('viewer').hidden = false;
});

// ---------- status do V ----------
let lastStatusKey = '';
function renderStatusApp(force) {
  if (currentApp !== 'status') return;
  const g = game();
  const p = g.player || {};
  const s = g.status || {};
  const key = JSON.stringify([p.level, p.streetCred, p.money, p.health, s, LANG]);
  if (!force && key === lastStatusKey) return;
  lastStatusKey = key;
  const n = (v) => (v == null ? '—' : String(v));
  const pctBar = (cur, next) => (cur != null && next != null && cur + next > 0 ? Math.round((cur / (cur + next)) * 100) : null);
  const lv = pctBar(s.xp, s.xpNext), sc = pctBar(s.credXp, s.credNext);
  const A = s.attr || {};
  const attrs = [['body', 'attrBody'], ['reflexes', 'attrReflexes'], ['tech', 'attrTech'], ['int', 'attrInt'], ['cool', 'attrCool']];
  const hp = s.healthNow != null && s.maxHealth ? `${s.healthNow} / ${s.maxHealth}` : (p.health != null ? p.health + '%' : '—');
  const cap = s.capacity != null ? (s.capacityUsed != null ? `${s.capacity - s.capacityUsed} / ${s.capacity}` : n(s.capacity)) : '—';
  $('status-body').innerHTML = `
    <div class="st-head">
      <div class="st-lvl"><small>${t('stLevel')}</small><b>${n(p.level)}</b></div>
      <div class="st-prog">
        <div class="st-row"><span>${t('stLevelXp')}</span><span>${lv != null ? lv + '%' : ''}</span></div>
        <div class="st-bar"><i style="width:${lv || 0}%"></i></div>
        <div class="st-row"><span>${t('stCred')} <b>${n(p.streetCred)}</b></span><span>${sc != null ? sc + '%' : ''}</span></div>
        <div class="st-bar cred"><i style="width:${sc || 0}%"></i></div>
      </div>
    </div>
    ${s.attrPoints || s.perkPoints || s.relicPoints ? `<div class="st-points">
      ${s.attrPoints ? `<span><b>${s.attrPoints}</b> ${t('stAttrPts')}</span>` : ''}
      ${s.perkPoints ? `<span><b>${s.perkPoints}</b> ${t('stPerkPts')}</span>` : ''}
      ${s.relicPoints ? `<span><b>${s.relicPoints}</b> ${t('stRelicPts')}</span>` : ''}
    </div>` : ''}
    <div class="tag st-tag">${t('stAttributes')}</div>
    <div class="st-attrs">${attrs.map(([k, l]) => `
      <div class="st-attr"><span>${t(l)}</span><div class="st-pips">${Array.from({ length: 20 }, (_, i) => `<i class="${i < (A[k] || 0) ? 'on' : ''}"></i>`).join('')}</div><b>${n(A[k])}</b></div>`).join('')}
    </div>
    <div class="tag st-tag">${t('stStats')}</div>
    <div class="st-grid">
      <div><small>${t('stHealth')}</small><b>${hp}</b></div>
      <div><small>${t('stArmor')}</small><b>${n(s.armor)}</b></div>
      <div><small>${t('stCritChance')}</small><b>${s.critChance != null ? s.critChance + '%' : '—'}</b></div>
      <div><small>${t('stCritDamage')}</small><b>${s.critDamage != null ? s.critDamage + '%' : '—'}</b></div>
      <div><small>${t('stCapacity')}</small><b>${cap}</b></div>
      <div><small>${t('stCarry')}</small><b>${n(s.carry)}</b></div>
      <div class="wide"><small>${t('balance')}</small><b>€$ ${p.money != null ? fmtMoney(p.money) : '—'}</b></div>
    </div>`;
}

// ---------- shards: leitor de textos do Codex ----------
let shards = [];
let shardOpen = null;
let shardQuery = '';
let shardFont = 17;
try { shardFont = Number(localStorage.getItem('neuroport.shardFont')) || 17; } catch { /* ok */ }
function updateShardPane() {
  const desktop = isDesktopMode();
  const opened = !!shardOpen;
  $('shard-sidebar').hidden = opened && !desktop;
  $('shard-content').hidden = !desktop && !opened;
  $('shard-search').hidden = opened && !desktop;
  $('shard-savebar').hidden = opened && !desktop;
  $('shard-list').hidden = opened && !desktop;
  $('shard-reader').hidden = !opened;
  $('shard-empty').hidden = !desktop || opened;
  if (desktop && currentApp === 'shards') $('appbar-back').hidden = !opened;
  for (const row of $('shard-list').querySelectorAll('.shard-row')) {
    const selected = row.dataset.id === shardOpen;
    row.classList.toggle('is-selected', selected);
    if (selected) row.setAttribute('aria-current', 'true'); else row.removeAttribute('aria-current');
  }
}
// Copy saved on this device for later reading, even when the game or PC is offline.
const SHARD_SAVE = 'neuroport.shards.saved';
function savedShards() {
  try { const d = JSON.parse(localStorage.getItem(SHARD_SAVE) || 'null'); return d && Array.isArray(d.shards) ? d : null; } catch { return null; }
}
let shardsFromSave = false;
let hasSavedCache = null;
function hasSavedShards() { if (hasSavedCache === null) { try { hasSavedCache = localStorage.getItem(SHARD_SAVE) !== null; } catch { hasSavedCache = false; } } return hasSavedCache; }
async function loadShards() {
  $('shard-q').placeholder = t('shardsSearch');
  if (!shards.length) $('shard-list').innerHTML = `<p class="empty dim">${t('loading')}</p>`;
  let live = null;
  try { live = (await (await fetch(`/api/shards?k=${encodeURIComponent(key)}`)).json()).shards; } catch { /* PC is unavailable */ }
  if (live && live.length) { shards = live; shardsFromSave = false; }
  else { const sv = savedShards(); if (sv) { shards = sv.shards; shardsFromSave = true; } }
  renderShards();
}
function saveShardsLocal() {
  if (!shards.length) return;
  try {
    localStorage.setItem(SHARD_SAVE, JSON.stringify({ at: Date.now(), shards }));
    hasSavedCache = true;
    toast(t('shardsSaved').replace('{n}', shards.length), true, t('appShards'));
  } catch { toast(t('shardsSaveFail'), false); }
  renderShards();
}
// Also available as a text file to save or open on another device.
const NL = String.fromCharCode(10);
function downloadShards() {
  if (!shards.length) return;
  const groups = new Map();
  for (const s of shards) { const k = shardCat(s.cat); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(s); }
  let txt = 'NEUROPORT - SHARDS' + NL + NL;
  for (const [cat, items] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    txt += '=== ' + cat.toUpperCase() + ' ===' + NL + NL;
    for (const s of items) txt += '# ' + (s.title || '') + NL + NL + shardText(s.text) + NL + NL;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([txt], { type: 'text/plain;charset=utf-8' }));
  a.download = 'neuroport-shards.txt';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
// Categories start collapsed; the player can expand them individually (search expands matching categories).
const shardCatsOpen = new Set();
// In-game group names may arrive as IDs (e.g. "lore_corpo") when no translation is available.
function shardCat(c) {
  if (!c) return t('shardsOther');
  const k = 'shcat_' + c;
  if (t(k) !== k) return t(k);
  return String(c).split('/').pop().replace(/[_-]+/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
}
// The game may encode line breaks as literal backslash-n sequences.
function shardText(x) { return fixNl(x); }
function renderShards() {
  if (shardOpen && !isDesktopMode()) return;
  const q = shardQuery.trim().toLowerCase();
  const list = shards.filter((s) => !q || (s.title || '').toLowerCase().includes(q) || (s.text || '').toLowerCase().includes(q));
  const groups = new Map();
  for (const s of list) { const k = shardCat(s.cat); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(s); }
  const unread = shards.filter((s) => s.read === false).length;
  $('shard-meta').textContent = `${shards.length} · ${unread} ${t('shardsNew')}`;
  const sv = savedShards();
  $('shard-save-info').textContent = shardsFromSave ? t('shardsOffline') : sv ? t('shardsSavedAt').replace('{d}', new Date(sv.at).toLocaleDateString()) : '';
  $('shard-save').disabled = !shards.length || shardsFromSave;
  $('shard-dl').disabled = !shards.length;
  $('shard-list').innerHTML = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([cat, items]) => {
    const open = q || shardCatsOpen.has(cat);
    const news = items.filter((s) => s.read === false).length;
    return `
    <li class="shard-cat${open ? ' open' : ''}" data-cat="${esc(cat)}"><span class="fold-chev">›</span><span class="sc-name">${esc(cat)}</span>${news ? `<i class="sc-new">${news}</i>` : ''}<b>${items.length}</b></li>
    ${open ? items.map((s) => `<li class="shard-row${s.read === false ? ' new' : ''}${shardOpen === s.id ? ' is-selected' : ''}" data-id="${esc(s.id)}"${shardOpen === s.id ? ' aria-current="true"' : ''}>
      <svg viewBox="0 0 24 24"><use href="#i-shard"/></svg>
      <div class="shard-main"><b>${esc(s.title || '—')}</b><small>${esc(shardText(s.text).replace(/\s+/g, ' ').slice(0, 90))}</small></div>
    </li>`).join('') : ''}`;
  }).join('') || `<p class="empty dim">${t(shards.length ? 'shardsNone' : 'shardsEmpty')}</p>`;
}
function openShard(id) {
  const s = shards.find((x) => x.id === id);
  if (!s) return;
  shardOpen = id;
  renderShards();
  updateShardPane();
  $('shard-cat').textContent = shardCat(s.cat);
  $('shard-title').textContent = s.title || '';
  // Paragraphs: the game uses single line breaks in its text.
  $('shard-text').innerHTML = esc(shardText(s.text)).split(/\n{1,}/).map((p) => `<p>${p}</p>`).join('');
  $('shard-text').style.fontSize = shardFont + 'px';
  $('shard-reader').scrollTop = 0;
  if (s.read === false) { s.read = true; if (!shardsFromSave) cmd('shard_read', id); }
  history.pushState({ app: 'shards', shard: id }, '', '#shards/' + encodeURIComponent(id));
}
function closeShard(fromHistory) {
  if (!shardOpen) return;
  shardOpen = null;
  renderShards();
  updateShardPane();
  if (!fromHistory && history.state && history.state.shard) history.back();
}
$('shard-list').addEventListener('click', (e) => {
  const c = e.target.closest('.shard-cat');
  if (c) { buzz(6); const k = c.dataset.cat; shardCatsOpen.has(k) ? shardCatsOpen.delete(k) : shardCatsOpen.add(k); renderShards(); return; }
  const r = e.target.closest('.shard-row');
  if (r) { buzz(8); openShard(r.dataset.id); }
});
$('shard-save').addEventListener('click', () => { buzz(10); saveShardsLocal(); });
$('shard-dl').addEventListener('click', () => { buzz(10); downloadShards(); });
// Offline: the no-signal screen offers saved shards.
$('offline-shards').addEventListener('click', () => { buzz(8); offlineReading = true; $('offline').hidden = true; openApp('shards'); });
$('shard-q').addEventListener('input', (e) => { shardQuery = e.target.value; renderShards(); });
$('shard-reader').addEventListener('click', (e) => {
  const b = e.target.closest('[data-font]');
  if (!b) return;
  buzz(5);
  shardFont = Math.max(13, Math.min(26, shardFont + Number(b.dataset.font)));
  try { localStorage.setItem('neuroport.shardFont', String(shardFont)); } catch { /* ok */ }
  $('shard-text').style.fontSize = shardFont + 'px';
});

// ---------- Call subtitles ----------
let lastSubKey = '';
function renderSubs() {
  const g = game();
  const box = $('holo-subs');
  if ($('holo').hidden) { box.hidden = true; return; }
  const subs = g.subs;
  const log = (subs && subs.log) || [];
  const key = JSON.stringify(log.map((l) => l.seq));
  if (key === lastSubKey) return;
  lastSubKey = key;
  box.hidden = !log.length;
  box.innerHTML = log.slice(-4).map((l, i, arr) => `
    <div class="sub-line${i === arr.length - 1 ? ' now' : ''}">
      ${l.speaker ? `<b>${esc(l.speaker)}</b>` : ''}<span>${esc(l.text)}</span>
    </div>`).join('');
  box.scrollTop = box.scrollHeight;
}

// ---------- Main renderer integration ----------
let offlineReading = false;
function renderOS() {
  if ($('offline-shards')) $('offline-shards').hidden = !hasSavedShards();
  if (isDesktopMode()) renderDesktopNav();
  renderStatus();
  if (currentApp === 'home') renderHome();
  checkNewMessages();
  renderMessages();
  renderStatusApp();
  renderInternet();
  renderSubs();
  renderMapMode();
  if (currentApp === 'settings') renderSettingsLight();
}
// Settings: only the immersive-mode switch follows the game state.
let lastImm = null;
function renderSettingsLight() {
  const g = game();
  if (!!g.immersive !== immWasOn) { if (g.immersive && immWasOn === false) immOpen = true; immWasOn = !!g.immersive; }
  const imm = JSON.stringify([!!g.immersive, g.immHud || null]);
  if (imm !== lastImm) { lastImm = imm; renderSettings(); }
}

// Game responses for the new commands.
const _onAckExtra = window.onAckExtra;
window.onAckExtra = function (a, action) {
  if (_onAckExtra && _onAckExtra(a, action)) return true;
  const mine = ['buy', 'immersive_on', 'immersive_off', 'photo_mode', 'reply', 'thread', 'thread_close', 'quest_details', 'quest_details_close', 'shop_refresh'];
  if (!mine.includes(action)) return false;
  if (!a.ok) { buzz([40, 60, 40]); toast(errText(a.msg), false); if (action === 'reply') { pendingReply = null; renderChat(true); } return true; }
  if (action === 'buy') toast(t('purchased'), true, 'AUTOFIXER');
  if (action === 'immersive_on') toast(t('immersiveOn'), true, t('appSettings'));
  if (action === 'immersive_off') toast(t('immersiveOff'), true, t('appSettings'));
  if (action === 'photo_mode') toast(t('photoModeOpened'), true, t('appCamera'));
  return true;
};

// Apply the device-specific layout before opening the home screen.
applyDeviceMode();

// Startup: open the home screen (or the app specified by the URL).
(function bootOS() {
  const want = location.hash.replace('#', '').split('/')[0];
  history.replaceState({ app: 'home' }, '', location.pathname + location.search);
  if (want && OS.apps.some((a) => a.id === want)) setTimeout(() => openApp(want, { noAnim: true }), 0);
  else setTimeout(() => goHome(true), 0);
})();
