// Neuroport — phone interface.
'use strict';

const $ = (id) => document.getElementById(id);
const KEY_STORE = 'neuroport.key';
const TAB_STORE = 'neuroport.tab';
const CATS = ['ncpd', 'gig', 'tarot', 'side'];

let key = null;
let es = null;
let state = null;        // Latest snapshot. {online, mock, game}
let tab = 'contacts';
let vehFilter = 'car';
let selectedVeh = null;
let sheetContact = null;
let lastContactsKey = '';
let lastVehiclesKey = '';
let lastGigsKey = '';
let summonTimer = null;
let mapPick = null;      // {poi} | {point} awaiting confirmation.

// ---------- utilidades ----------
function store(k, v) {
  try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* Storage is unavailable */ }
}
function load(k) { try { return localStorage.getItem(k); } catch { return null; } }
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function initials(name) {
  const parts = String(name || '?').replace(/["'“”]/g, '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}
// Contact avatar (game image), with initials as a fallback if it fails to load.
// Handle line breaks encoded as backslash-n (legacy copies and in-game text).
function fixNl(x) { return String(x == null ? '' : x).replace(/\\r?\\n/g, '\n'); }
function oneLine(x) { return fixNl(x).replace(/\s+/g, ' ').trim(); }
function avatarHtml(c) {
  const ini = esc(initials(c && c.name));
  if (!c || !c.avatar) return ini;
  const q = c.atlas ? `?a=${encodeURIComponent(c.atlas)}` : '';
  return `${ini}<img class="av-img" src="avatar/${encodeURIComponent(c.avatar)}.png${q}" alt="" loading="lazy" onerror="this.remove()">`;
}
function contactById(id) { return ((state && state.game && state.game.contacts) || []).find((x) => x.id === id); }

function buzz(p) {
  if (typeof prefs !== 'undefined' && !prefs.vibrate) return;
  if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
  try { navigator.vibrate && navigator.vibrate(p); } catch { /* ok */ }
}
const pad = (n) => String(n).padStart(2, '0');
const game = () => (state && state.game) || {};

function toast(msg, ok = true, label) {
  const el = document.createElement('div');
  el.className = 'toast' + (ok ? '' : ' is-err');
  el.innerHTML = `<div class="tag">${esc(label || (ok ? t('system') : t('error')))}</div><div class="toast-msg">${esc(msg)}</div>`;
  $('toasts').appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 260); }, 2600);
}

// ---------- Pairing ----------
async function checkKey(k) {
  try { return (await fetch(`/api/check?k=${encodeURIComponent(k)}`)).ok; } catch { return false; }
}

async function boot() {
  const url = new URL(location.href);
  const fromUrl = url.searchParams.get('k');
  if (fromUrl) {
    store(KEY_STORE, fromUrl.toUpperCase());
    url.searchParams.delete('k');
    history.replaceState(null, '', url.pathname + url.search);
  }
  key = load(KEY_STORE) || load('holophone.key');   // Migrate from the old key name.
  if (key && (await checkKey(key))) return start();
  showPair();
}

function showPair(err) {
  $('app').hidden = true;
  $('pair').hidden = false;
  $('pair-err').hidden = !err;
  $('pair-input').value = key || '';
}

$('pair-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const k = $('pair-input').value.trim().toUpperCase();
  if (!k) return;
  if (await checkKey(k)) { key = k; store(KEY_STORE, k); start(); }
  else { $('pair-err').hidden = false; buzz([30, 40, 30]); }
});

// ---------- Connection ----------
function start() {
  $('pair').hidden = true;
  $('app').hidden = false;
  HoloMap.init($('map'), { onPick: onMapPick });
  connect();
}

function connect() {
  if (es) es.close();
  setLink('wait');
  es = new EventSource(`/api/stream?k=${encodeURIComponent(key)}`);
  es.addEventListener('state', (e) => { state = JSON.parse(e.data); render(); });
  es.addEventListener('ack', (e) => onAck(JSON.parse(e.data)));
  es.onerror = () => {
    setLink('wait');
    checkKey(key).then((ok) => { if (!ok && navigator.onLine) { es.close(); showPair(true); } });
  };
}

const pendingCmds = new Map(); // id -> {action, arg}

async function cmd(action, arg) {
  try {
    const r = await fetch(`/api/cmd?k=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, arg }),
    });
    if (!r.ok) throw new Error();
    const id = (await r.json()).id;
    pendingCmds.set(String(id), { action, arg });
    return id;
  } catch {
    toast(t('noPc'), false);
    return null;
  }
}

function errText(code) {
  if (!code) return t('err_game_refused');
  const k = 'err_' + code;
  const v = t(k);
  return v === k ? code : v;
}

function onAck(a) {
  const p = pendingCmds.get(String(a.id));
  pendingCmds.delete(String(a.id));
  const action = a.action || (p && p.action);
  if (!action || action === 'refresh' || action === 'ping') return;
  if (window.onAckExtra && onAckExtra(a, action)) return;
  if (!a.ok) {
    buzz([40, 60, 40]);
    toast(errText(a.msg), false);
    if (action === 'summon') hideSummon();
    if (action === 'call') closeHolo();
    return;
  }
  if (action === 'summon') {
    buzz([20, 40, 80]);
    if (a.msg === 'summon_fallback') toast(t('summonFallback'), true, t('vehicle'));
  } else if (action === 'waypoint') {
    buzz([15, 30, 15]);
    toast(t('waypointSet'), true, t('gps'));
  } else if (action === 'clearwp') {
    toast(t('waypointCleared'), true, t('gps'));
  } else if (action === 'track') {
    buzz([15, 30, 15]);
    toast(t('questTracked'), true, t('journalTitle'));
  } else if (action === 'untrack') {
    toast(t('questUntracked'), true, t('journalTitle'));
  }
}

// ---------- render ----------
function setLink(mode) {
  const el = $('link');
  el.classList.toggle('is-on', mode === 'on');
  el.classList.toggle('is-off', mode !== 'on');
  el.dataset.mode = mode;
  const label = t(mode === 'on' ? 'linkOn' : mode === 'idle' ? 'linkIdle' : 'linkWait');
  $('link-label').textContent = label;
  const desktopLabel = $('desktop-link-label');
  const desktopDot = $('desktop-link-dot');
  if (desktopLabel) desktopLabel.textContent = label;
  if (desktopDot) desktopDot.classList.toggle('is-on', mode === 'on');
}

function render() {
  if (!state) return;
  const g = game();
  // The game language takes priority; redraw the lists when it changes.
  if (setLang(langFromGame(g.lang))) {
    lastContactsKey = lastVehiclesKey = lastGigsKey = lastJournalKey = '';
    if (!$('filters-sheet').hidden) renderFilters();
  }
  const inGame = state.online && g && g.inGame;
  setLink(inGame ? 'on' : state.online ? 'idle' : 'wait');

  $('offline').hidden = !!inGame || (typeof offlineReading !== 'undefined' && offlineReading && currentApp === 'shards');
  if (inGame && typeof offlineReading !== 'undefined') offlineReading = false;
  if (typeof renderOS === 'function' && !inGame && $('offline-shards')) $('offline-shards').hidden = !(typeof hasSavedShards === 'function' && hasSavedShards());
  if (!inGame) {
    $('offline-title').textContent = t('noSignal');
    $('offline-title').dataset.text = t('noSignal');
    $('offline-msg').textContent = t(!state.online ? 'offlineGame' : 'offlineSave');
    closeHolo(true);
    return;
  }

  renderHud(g.player || {}, g.district);
  renderContacts(g.contacts || []);
  renderVehicles(g.vehicles || [], g.activeVehicle);
  renderCall(g.call || {}, g.contacts || []);
  renderGigs();
  renderMap();
  renderJournal();
  if (window.renderExtras) renderExtras();
  if (window.renderOS) renderOS();
}

function renderHud(p, district) {
  $('clock-time').textContent = p.timeH != null ? `${pad(p.timeH)}:${pad(p.timeM)}` : '--:--';
  $('district').textContent = district || '—';
  $('lvl').textContent = p.level ?? '--';
  $('cred').textContent = p.streetCred ?? '--';
  $('money').textContent = p.money != null ? fmtMoney(p.money) : '----';
}

// ---------- Contacts ----------
function renderContacts(list) {
  const k = JSON.stringify(list);
  if (k === lastContactsKey) return;
  lastContactsKey = k;

  const sorted = [...list].sort((a, b) =>
    (b.quest - a.quest) || ((b.unread > 0) - (a.unread > 0)) || (b.callable - a.callable) ||
    String(a.name).localeCompare(String(b.name)));

  const unread = list.reduce((n, c) => n + (c.unread || 0), 0);
  $('tab-unread').hidden = !unread;
  $('tab-unread').textContent = unread;
  $('contacts-count').textContent = String(list.length).padStart(2, '0');
  $('contacts-empty').hidden = list.length > 0;

  $('contacts').innerHTML = sorted.map((c, i) => `
    <li class="row${c.callable ? '' : ' is-off'}" data-id="${esc(c.id)}" style="animation-delay:${Math.min(i, 12) * 22}ms">
      <div class="avatar">${avatarHtml(c)}</div>
      <div class="row-main">
        <div class="row-name">${esc(c.name)}</div>
        <div class="row-sub">${c.preview ? `<span class="dim">${t('lastMsgShort')}</span> ${esc(oneLine(c.preview))}` : esc(t(c.callable ? 'available' : 'unavailable'))}</div>
      </div>
      <div class="row-end">
        ${c.unread ? `<span class="badge">${c.unread}</span>` : ''}
        ${c.quest && c.callable ? `<span class="call-wait"><svg viewBox="0 0 24 24"><use href="#i-phone"/></svg>${t('waitingCall')}</span>` : c.quest ? '<span class="marker-quest"></span>' : ''}
      </div>
    </li>`).join('');

  if (sheetContact) {
    const c = list.find((x) => x.id === sheetContact);
    if (c) fillSheet(c);
  }
}

$('contacts').addEventListener('click', (e) => {
  const row = e.target.closest('.row');
  if (!row) return;
  const c = (game().contacts || []).find((x) => x.id === row.dataset.id);
  if (!c) return;
  buzz(10);
  sheetContact = c.id;
  fillSheet(c);
  $('sheet').hidden = false;
});

function fillSheet(c) {
  $('sheet-avatar').innerHTML = avatarHtml(c);
  $('sheet-name').textContent = c.name;
  $('sheet-tag').textContent = t(c.quest ? 'contactQuest' : 'contact');
  $('sheet-msg').hidden = !c.preview;
  $('sheet-preview').textContent = fixNl(c.preview);
  $('sheet-call').disabled = !c.callable;
  $('sheet-chat').hidden = !(c.messages || c.preview);
}

function closeSheet() { $('sheet').hidden = true; sheetContact = null; }
$('sheet-close').addEventListener('click', closeSheet);
// Load the full conversation, including older messages, from the contact.
$('sheet-chat').addEventListener('click', () => {
  const id = sheetContact;
  if (!id) return;
  buzz(8);
  closeSheet();
  if (typeof openChat === 'function') openChat(id);
});
$('sheet').addEventListener('click', (e) => { if (e.target === $('sheet')) closeSheet(); });

// ---------- chamadas ----------
let localCall = null;
let hungUpAt = 0;
let lastCallState = 'idle';
let lastCallerName = '';
let answeredOrRejected = false;
let ringMuted = false;

$('holo-answer').addEventListener('click', () => {
  Ringtone.stop();
  answeredOrRejected = true;
  buzz(40);
  $('holo-state').textContent = t('onCall');
  cmd('call_answer');
});
$('holo-reject').addEventListener('click', () => {
  Ringtone.stop();
  answeredOrRejected = true;
  buzz([30, 40, 30]);
  hungUpAt = Date.now();
  closeHolo();
  toast(t('callRejected'), true, t('holocall'));
  cmd('call_reject');
});
$('holo-silence').addEventListener('click', () => {
  ringMuted = true;
  Ringtone.stop();
  $('holo-silence').hidden = true;
});
let holoTimer = null;

$('sheet-call').addEventListener('click', async () => {
  const c = (game().contacts || []).find((x) => x.id === sheetContact);
  if (!c) return;
  closeSheet();
  buzz(25);
  localCall = { contact: c.id, name: c.name, at: Date.now() };
  openHolo(c.name, 'calling', c.id);
  if (!(await cmd('call', c.id))) closeHolo();
});

$('holo-hangup').addEventListener('click', async () => {
  buzz(30);
  hungUpAt = Date.now();
  closeHolo();
  await cmd('hangup');
});

function openHolo(name, phase, contactId) {
  const h = $('holo');
  $('holo-name').textContent = name || '—';
  const c = contactById(contactId) || { name };
  const key = `${c.name}|${c.avatar || ''}`;
  if ($('holo-portrait').dataset.key !== key) {
    $('holo-portrait').innerHTML = avatarHtml(c);
    $('holo-portrait').dataset.key = key;
  }
  h.classList.toggle('is-active', phase === 'active');
  if (phase !== 'active') {
    clearInterval(holoTimer); holoTimer = null;
    $('holo-state').textContent = t(phase === 'incoming' ? 'incoming' : 'calling');
  } else if (!holoTimer) {
    const t0 = Date.now();
    const tick = () => {
      const s = Math.floor((Date.now() - t0) / 1000);
      $('holo-state').textContent = `${t('onCall')} · ${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
    };
    tick();
    holoTimer = setInterval(tick, 1000);
  }
  const incoming = phase === 'incoming';
  h.classList.toggle('is-incoming', incoming);
  $('holo-incoming').hidden = !incoming;
  $('holo-silence').hidden = !incoming || !Ringtone.ringing;
  $('holo-hangup').hidden = incoming;
  h.hidden = false;
}

function closeHolo(silent) {
  Ringtone.stop();
  $('holo').hidden = true;
  clearInterval(holoTimer); holoTimer = null;
  localCall = null;
  if (!silent) lastCallState = 'idle';
}

function renderCall(call, contacts) {
  const st = call.state || 'idle';
  const name = call.name || (contacts.find((c) => c.id === call.contact) || {}).name || (localCall && localCall.name);
  if (st !== 'incoming') Ringtone.stop();
  if (st === 'idle') {
    if (localCall && Date.now() - localCall.at < 6000) return;
    if (lastCallState === 'incoming' && !answeredOrRejected) toast(t('missedCall', lastCallerName || '—'), false, t('holocall'));
    else if (lastCallState !== 'idle' && lastCallState !== 'incoming') toast(t('callEnded'), true, t('holocall'));
    answeredOrRejected = false;
    if (!$('holo').hidden) closeHolo(true);
    lastCallState = 'idle';
    return;
  }
  if (Date.now() - hungUpAt < 2500) return;
  if (st === 'incoming') {
    lastCallerName = name;
    if (st !== lastCallState) { answeredOrRejected = false; ringMuted = false; }
    if (!ringMuted && (typeof prefs === 'undefined' || prefs.ring)) Ringtone.start();
  }
  if (st !== lastCallState && st === 'active') buzz(60);
  lastCallState = st;
  openHolo(name, st, call.contact || (localCall && localCall.contact));
}

// ---------- Vehicles ----------
// Autofixer cars unlocked by El Capitan contracts (the mod also marks "courier" facts).
const CAP_MODELS = ['sidewinder', 'chiaroscuro', 'wingate', 'samum', 'barghest', 'warlock', 'locust', 'herman', 'trailbruiser', 'terrier', 'weiler'];
const normName = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
function capOffers() {
  const g = game();
  const own = new Set((g.vehicles || []).map((v) => normName(v.name)));
  return (g.offers || []).filter((o) => o.cap || CAP_MODELS.some((k) => normName(o.name).includes(k)))
    .map((o) => ({ ...o, have: !!o.owned || own.has(normName(o.name)) }))
    .sort((a, b) => (b.have - a.have) || (b.available - a.available) || String(a.name).localeCompare(String(b.name)));
}
// Autofixer offer with the same name (description and price for garage vehicles).
function offerFor(v) {
  const n = normName(v.name);
  return (game().offers || []).find((o) => normName(o.name) === n) || null;
}
const capState = (o) => (o.have ? 'own' : o.available ? 'avail' : 'lock');
const capChip = (st) => `<span class="cap-chip ${st}">${t(st === 'own' ? 'capOwned' : st === 'avail' ? 'capAvail' : 'capLocked')}</span>`;

function renderCapHead() {
  const j = game().journal || {};
  const c = j.cap || {};
  const list = capOffers();
  const have = list.filter((o) => o.have).length;
  const act = (j.quests || []).filter((q) => q.cap);
  $('cap-head').innerHTML = `
    <div class="tag">${t('capTitle')}</div>
    <div class="cap-intro${c.intro ? ' ok' : ''}">${c.intro ? '✓ ' : ''}${esc(t(c.intro ? 'capIntroDone' : 'capIntroTodo'))}</div>
    <dl class="cap-stats">
      <div><dt>${t('capDone')}</dt><dd>${c.done != null ? c.done : '—'}</dd></div>
      <div><dt>${t('capFailed')}</dt><dd>${c.failed != null ? c.failed : '—'}</dd></div>
      <div class="wide"><dt>${t('capActive')}</dt><dd>${act.length ? act.map((q) => esc(q.title + (q.objective ? ' · ' + q.objective : ''))).join('<br>') : t('capNone')}</dd></div>
    </dl>
    <div class="cap-sub"><span>${t('capRewards')}</span><span>${esc(t('capCount').replace('{a}', have).replace('{b}', list.length))}</span></div>
    <p class="cap-note dim">${esc(t('capNote'))}</p>`;
}

function renderVehicles(list, active) {
  const capMode = vehFilter === 'cap';
  const g = game();
  const j = g.journal || {};
  const k = JSON.stringify([list, active, vehFilter, selectedVeh, LANG, capMode ? [g.offers, j.cap, (j.quests || []).filter((q) => q.cap)] : 0]);
  if (k === lastVehiclesKey) return;
  lastVehiclesKey = k;
  $('cap-head').hidden = !capMode;
  $('cap-foot').hidden = !capMode;
  document.querySelector('#panel-vehicles .action-bar').hidden = capMode;

  if (capMode) {
    renderCapHead();
    const items = capOffers();
    $('vehicles-empty').hidden = items.length > 0;
    $('vehicles').innerHTML = items.map((o, i) => {
      const st = capState(o);
      return `
      <li class="row${st === 'lock' ? ' cap-locked' : ''}" data-offer="${esc(o.id)}" style="animation-delay:${Math.min(i, 12) * 22}ms">
        <span class="cap-check${o.have ? ' on' : ''}">${o.have ? '✓' : ''}</span>
        <div class="veh-icon${o.img ? ' has-img' : ''}">${o.img ? vehImg(o) : ''}<svg viewBox="0 0 24 24"><use href="#i-car"/></svg></div>
        <div class="row-main">
          <div class="row-name">${esc(o.name)}</div>
          <div class="row-sub">${esc(o.brandName || o.brand || '')}${o.price ? ' · ' + fmtMoney(o.price) : ''}</div>
        </div>
        <div class="row-end">${capChip(st)}</div>
      </li>`;
    }).join('');
    return;
  }

  const items = list.filter((v) => (v.type === 'bike' ? 'bike' : 'car') === vehFilter)
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  if (selectedVeh && !list.some((v) => v.id === selectedVeh)) selectedVeh = null;

  $('vehicles-empty').hidden = items.length > 0;
  $('summon-btn').disabled = !selectedVeh;
  $('vehicles').innerHTML = items.map((v, i) => `
    <li class="row${v.id === selectedVeh ? ' is-sel' : ''}" data-id="${esc(v.id)}" style="animation-delay:${Math.min(i, 12) * 22}ms">
      <div class="veh-icon${v.img ? ' has-img' : ''}">${v.img ? vehImg(v) : ''}<svg viewBox="0 0 24 24"><use href="#i-${v.type === 'bike' ? 'bike' : 'car'}"/></svg></div>
      <div class="row-main">
        <div class="row-name">${esc(v.name)}</div>
        <div class="row-sub">${esc(v.maker || t(v.type === 'bike' ? 'bike' : 'car'))}</div>
      </div>
      <div class="row-end">${v.id === active ? `<span class="chip-active">${t('active')}</span>` : ''}</div>
    </li>`).join('');
}

$('veh-filter').addEventListener('click', (e) => {
  const b = e.target.closest('.seg-b');
  if (!b) return;
  vehFilter = b.dataset.f;
  selectedVeh = null;
  for (const x of $('veh-filter').querySelectorAll('.seg-b')) x.classList.toggle('is-active', x === b);
  renderVehicles(game().vehicles || [], game().activeVehicle);
});

// Selecting a vehicle opens its details (power, mass, drivetrain, year, etc.).
$('vehicles').addEventListener('click', (e) => {
  const row = e.target.closest('.row');
  if (!row) return;
  buzz(8);
  if (row.dataset.offer) { openVehSheet(null, (game().offers || []).find((o) => o.id === row.dataset.offer)); return; }
  selectedVeh = row.dataset.id;
  renderVehicles(game().vehicles || [], game().activeVehicle);
  openVehSheet((game().vehicles || []).find((x) => x.id === selectedVeh), null);
});

let vsVehId = null;
function openVehSheet(v, offer) {
  const o = offer || (v && offerFor(v));
  const base = v || o;
  if (!base) return;
  vsVehId = v ? v.id : null;
  const info = (v && v.info) || {};
  const img = v && v.img ? v : (o && o.img ? o : null);
  $('vs-img').innerHTML = img ? vehImg(img).replace(' loading="lazy"', '') : '';
  $('vs-img').hidden = !img;
  $('vs-brand').textContent = (o && (o.brandName || o.brand)) || (v && v.maker) || '';
  $('vs-name').textContent = base.name;
  const desc = info.info || (o && o.desc) || '';
  $('vs-desc').textContent = typeof fixNl === 'function' ? fixNl(desc) : desc;
  $('vs-desc').hidden = !desc;
  const chips = [];
  if (v && v.id === game().activeVehicle) chips.push(`<span class="chip-active">${t('active')}</span>`);
  if (offer) {
    const c = capOffers().find((x) => x.id === offer.id);
    if (c) chips.push(capChip(capState(c)));
  }
  $('vs-chips').innerHTML = chips.join('');
  const num = (n, u) => (typeof n === 'number' ? n.toLocaleString('en-US') + (u ? ' ' + u : '') : n);
  const facts = [];
  const add = (key, val) => { if (val != null && val !== '') facts.push(`<div><dt>${t(key)}</dt><dd>${esc(String(val))}</dd></div>`); };
  add('vMaker', (v && v.maker) || (o && (o.brandName || o.brand)));
  add('vType', v ? t(v.type === 'bike' ? 'bike' : 'car') : null);
  add('vHp', num(info.hp, 'hp'));
  add('vMass', num(info.mass, 'kg'));
  add('vTop', num(info.top, 'km/h'));
  add('vAccel', num(info.accel));
  add('vDrive', info.drive);
  add('vYear', info.year);
  add('vSeats', info.seats);
  add('vWeapons', [(info.mg || (o && o.mg)) && t('vMg'), (info.rl || (o && o.rl)) && t('vRl')].filter(Boolean).join(' + '));
  if (o && o.price) add('vPrice', fmtMoney(o.price));
  $('vs-facts').innerHTML = facts.join('');
  $('vs-call').hidden = !vsVehId;
  $('veh-sheet').hidden = false;
}
$('vs-close').addEventListener('click', () => { $('veh-sheet').hidden = true; });
$('veh-sheet').addEventListener('click', (e) => { if (e.target === $('veh-sheet')) $('veh-sheet').hidden = true; });
$('vs-call').addEventListener('click', () => {
  if (!vsVehId) return;
  selectedVeh = vsVehId;
  $('veh-sheet').hidden = true;
  $('summon-btn').disabled = false;
  $('summon-btn').click();
});

$('summon-btn').addEventListener('click', async () => {
  const v = (game().vehicles || []).find((x) => x.id === selectedVeh);
  if (!v) return;
  buzz(25);
  $('summon-name').textContent = v.name;
  $('summon-img').innerHTML = v.img ? vehImg(v) : '';
  $('summon-maker').textContent = v.maker || '';
  $('summon').hidden = false;
  clearTimeout(summonTimer);
  const t0 = Date.now();
  summonTimer = setTimeout(hideSummon, 2600);
  if (!(await cmd('summon', v.id))) { hideSummon(); return; }
  clearTimeout(summonTimer);
  summonTimer = setTimeout(() => { hideSummon(); if (typeof goHome === 'function') goHome(); }, Math.max(0, 2600 - (Date.now() - t0)));
});
function vehImg(v) {
  const q = v.img.atlas ? `?a=${encodeURIComponent(v.img.atlas)}` : '';
  return `<img src="avatar/${encodeURIComponent(v.img.part)}.png${q}" alt="" loading="lazy" onerror="this.remove()">`;
}
function hideSummon() { $('summon').hidden = true; clearTimeout(summonTimer); }
$('summon').addEventListener('click', hideSummon);

// ---------- Quick Gig ----------
function playerPos() { return game().pos || null; }
function distTo(p) {
  const me = playerPos();
  if (!me || me.x == null) return p.d;
  return Math.hypot(p.x - me.x, p.y - me.y);
}
// Player-to-point relative bearing (degrees, clockwise).
function relBearing(p) {
  const me = playerPos();
  if (!me || me.x == null) return 0;
  const b = (Math.atan2(p.x - me.x, p.y - me.y) * 180) / Math.PI;
  return b - (-(me.yaw || 0));
}
function allPois(strict) {
  const out = [];
  for (const p of game().pois || []) { const e = enrichPoi(p); if (e && (typeof poiActive !== 'function' || poiActive(e, strict))) out.push(e); }
  return out;
}
// Quick Gig: only types included in the four categories.
function poisSorted() {
  return allPois(true).filter((p) => p.cat).map((p) => ({ ...p, dist: distTo(p) })).sort((a, b) => a.dist - b.dist);
}
function poiLabel(p) {
  const f = FILTER_BY_ID[p.f];
  return f ? f.label[LANG] || f.label.en : t('catLong_' + p.cat);
}
function wpLabel(wp) {
  if (wp && wp.label) return wp.label;
  if (!wp || !wp.cat) return t('customPoint');
  // Job destination: the name of the job tracked in the journal.
  if (wp.cat === 'quest' || wp.cat === 'quest_obj') {
    const j = game().journal || {};
    const q = (j.quests || []).find((x) => x.id === j.tracked);
    return q ? q.title : t('catLong_quest');
  }
  const f = FILTER_BY_ID[wp.cat];
  if (f) return f.label[LANG] || f.label.en;
  return t('catLong_' + wp.cat);
}
function wpColor(wp) {
  const f = wp && FILTER_BY_ID[wp.cat];
  return f ? f.color : (wp && CAT_COLORS[wp.cat]) || WP_COLOR;
}
function wpKey(p) { return p ? `${Math.round(p.x)},${Math.round(p.y)}` : ''; }

function markPoi(p) {
  buzz(20);
  if (!isFinite(Number(p.x)) || !isFinite(Number(p.y))) return;
  let z = Number(p.z != null ? p.z : (playerPos() || {}).z);
  if (!isFinite(z)) z = 0;
  cmd('waypoint', `${Number(p.x).toFixed(1)},${Number(p.y).toFixed(1)},${Number(z).toFixed(1)},${p.f || p.cat || ''}`);
}

function renderGigs() {
  if (tab !== 'gigs') return;
  const g = game();
  const list = poisSorted();
  const wp = g.waypoint;

  // Active GPS bar (updated continuously as the distance changes).
  $('gps-bar').hidden = !wp;
  if (wp) {
    $('gps-label').innerHTML = `<span class="cat-dot" style="--c:${wpColor(wp)}"></span>${esc(wpLabel(wp))} · ${fmtDist(distTo(wp))}`;
  }

  const status = g.poisStatus;
  const nearest = list[0];
  $('nearest-btn').disabled = !nearest;
  $('nearest-cat').textContent = nearest ? poiLabel(nearest) : (status === 'no_codeware' ? '—' : t('poisWaiting'));
  $('nearest-dist').textContent = nearest ? fmtDist(nearest.dist) : '';
  $('nearest-dot').style.setProperty('--c', nearest ? nearest.color : 'transparent');
  $('gigs-meta').textContent = g.district || '';

  // Cards grouped by category.
  $('cat-grid').innerHTML = CATS.map((c) => {
    const items = list.filter((p) => p.cat === c);
    const n = items[0];
    const near = items.filter((p) => p.dist <= 1500).length;
    const isWp = wp && n && wpKey(wp) === wpKey(n);
    return `
      <button class="cat-card${n ? '' : ' is-empty'}${isWp ? ' is-wp' : ''}" data-cat="${c}" style="--c:${CAT_COLORS[c]}" ${n ? '' : 'disabled'}>
        <div class="cat-top"><span class="cat-dot"></span><span class="cat-name">${esc(t('cat_' + c))}</span></div>
        <div class="cat-dist">${n ? fmtDist(n.dist) : '—'}</div>
        <div class="cat-sub">${n ? esc(t('inRange', near)) : esc(t('noneFound'))}</div>
        ${n ? `<span class="cat-arrow" style="transform:rotate(${relBearing(n).toFixed(0)}deg)"><svg viewBox="0 0 24 24"><use href="#i-arrow"/></svg></span>` : ''}
      </button>`;
  }).join('');

  // List of upcoming items.
  const top = list.slice(0, 12);
  const empty = !top.length;
  $('gigs-empty').hidden = !empty;
  $('gigs-empty').textContent = status === 'no_codeware' ? t('noCodeware') : t('poisWaiting');
  const poiHtml = top.map((p, i) => `
    <li class="row poi-row${wp && wpKey(wp) === wpKey(p) ? ' is-wp' : ''}" data-i="${i}" style="--c:${p.color}">
      <span class="cat-dot"></span>
      <div class="row-main">
        <div class="row-name">${esc(poiLabel(p))}</div>
      </div>
      <span class="poi-dist">${fmtDist(p.dist)}</span>
      <span class="poi-arrow" style="transform:rotate(${relBearing(p).toFixed(0)}deg)"><svg viewBox="0 0 24 24"><use href="#i-arrow"/></svg></span>
    </li>`).join('');
  if ($('poi-list').innerHTML !== poiHtml) $('poi-list').innerHTML = poiHtml;
  $('poi-list').dataset.items = JSON.stringify(top.map((p) => [p.x, p.y, p.z, p.f]));
}

$('nearest-btn').addEventListener('click', () => {
  const n = poisSorted()[0];
  if (n) markPoi(n);
});
$('cat-grid').addEventListener('click', (e) => {
  const b = e.target.closest('.cat-card');
  if (!b || b.disabled) return;
  const n = poisSorted().find((p) => p.cat === b.dataset.cat);
  if (n) markPoi(n);
});
$('poi-list').addEventListener('click', (e) => {
  const row = e.target.closest('.row');
  if (!row) return;
  const items = JSON.parse($('poi-list').dataset.items || '[]');
  const it = items[Number(row.dataset.i)];
  if (it) markPoi({ x: it[0], y: it[1], z: it[2], f: it[3] });
});
$('gps-clear').addEventListener('click', () => { buzz(10); cmd('clearwp'); });

// ---------- Map ----------
// El Capitan: "show possible locations" — the map displays current contracts and locations where
// contracts have appeared before (saved by the mod), until EXIT is tapped on the map banner.
let capHunt = false;
// Known contract locations (GNL Magazine guide), anchored to the nearest fast-travel point.
// The app finds locations by their in-game names; the keywords are proper names and work in any language.
const CAP_GUIDE = [
  { k: /kress/i, en: 'Dogtown: near the Kress St. fast travel' },
  { k: /luxor/i, en: 'Dogtown: near Luxor High Wellness Spa' },
  { k: /batty/i, en: "Pacifica, Coastview: near Batty's Hotel" },
  { k: /college/i, en: 'Heywood, Vista Del Rey: near College St.' },
  { k: /martin/i, en: 'Watson, Northside: at Martin St.' },
  { k: /kennedy/i, en: 'Watson, Kabuki: southeast of Kennedy North' },
  { k: /\bh8\b/i, en: 'Japantown: across from Megabuilding H8' },
  { k: /almu[nñ]ecar|jerez/i, en: 'Rancho Coronado: near Almunecar & Jerez' },
  { k: /kendal/i, en: 'Rancho Coronado: near Kendal Park' },
  { k: /red dirt/i, en: 'Arroyo: down the street from the Red Dirt Bar' },
  { k: /mission waterfront|waterfront/i, en: 'Arroyo: near Mission Waterfront' },
  { k: /halsey/i, en: 'Corpo Plaza: near Halsey & MLK' },
  { k: /^fuel station$|^posto/i, en: 'Badlands: near the Abandoned Fuel Station' },
  { k: /sunshine/i, en: 'Badlands: across from the Sunshine Motel' },
];
function capGuidePois() {
  const fts = (game().pois || []).filter((p) => p.v === 'FastTravel' && p.n);
  const out = [];
  for (const gd of CAP_GUIDE) {
    const ft = fts.find((p) => gd.k.test(p.n));
    if (ft) out.push({ ...enrichPoi({ v: 'CourierSandboxActivity', x: ft.x, y: ft.y, z: ft.z, ph: 'd' }), color: '#f7a23e', guide: gd.en, ftName: ft.n });
  }
  return out;
}
function capHuntPois() {
  const g = game();
  const live = (g.pois || []).filter((p) => p.v === 'CourierSandboxActivity').map((p) => ({ ...enrichPoi(p), live: true }));
  const near = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) < 30;
  const spots = (g.capSpots || []).filter((s) => !live.some((l) => near(l, s)))
    .map((s) => ({ ...enrichPoi({ v: 'CourierSandboxActivity', x: s.x, y: s.y, z: s.z, ph: 'd' }), color: '#8a7cff', spot: s.n }));
  const guide = capGuidePois().filter((gp) => !live.some((l) => Math.hypot(l.x - gp.x, l.y - gp.y) < 150));
  return [...live, ...spots, ...guide];
}
function startCapHunt() {
  capHunt = true;
  openApp('map');
  const list = capHuntPois();
  const me = playerPos() || {};
  const live = list.filter((p) => p.live);
  const pick = (live.length ? live : list).slice().sort((a, b) => Math.hypot(a.x - (me.x || 0), a.y - (me.y || 0)) - Math.hypot(b.x - (me.x || 0), b.y - (me.y || 0)))[0];
  // No known locations yet: Dogtown, where most contracts appear.
  const gate = (game().pois || []).find((p) => p.v === 'DogtownGate');
  const c = pick || gate || { x: -2040, y: -2540, z: 0 };
  setTimeout(() => { if (window.Map3D && Map3D.ready) Map3D.focusOn(c.x, c.y, c.z, pick ? 1400 : 2600); }, 250);
  renderCapBanner();
  renderMap();
}
function stopCapHunt() { capHunt = false; renderCapBanner(); renderMap(); }
function renderCapBanner() {
  const b = $('cap-banner');
  if (!b) return;
  b.hidden = !capHunt;
  if (!capHunt) return;
  const list = capHuntPois();
  const live = list.filter((p) => p.live).length;
  const known = list.length - live;
  $('cap-banner-txt').textContent = live ? t('capLive').replace('{n}', live) + (known ? ' · ' + t('capSpotsN').replace('{n}', known) : '')
    : known ? t('capSpotsOnly').replace('{n}', known) : t('capNoSpots');
}

function mapPois() {
  if (capHunt) return capHuntPois();
  const list = allPois().filter(filterShows);
  // 2D radar fallback: apply the dynamic filter zoom here.
  if (filterMode === 'dynamic' && !(window.Map3D && Map3D.ready)) {
    const r = HoloMap.radius();
    const lim = r <= 700 ? 2 : r <= 1800 ? 1 : 0;
    return list.filter((p) => (p.tier || 0) <= lim);
  }
  return list;
}

function renderMap() {
  const g = game();
  HoloMap.update(g.pos, mapPois(), g.waypoint);
  if (window.map3dUpdate) map3dUpdate();
  if (tab !== 'map') return;
  const total = FILTER_GROUPS.reduce((n, gr) => n + gr.filters.length, 0);
  const on = total - filtersOff.size;
  $('filters-count').textContent = filterMode === 'custom' ? (on === total ? '' : `${on}/${total}`) : t('fmode_' + filterMode);
  if (mapPick && mapPick.poi) fillPop();
  if (capHunt) renderCapBanner();
  $('map-district').textContent = g.district || '—';
  const p = g.pos || {};
  $('map-coords').textContent = p.x != null ? `X ${Math.round(p.x)}  Y ${Math.round(p.y)}` : '';
  $('map-mode-label').textContent = t(HoloMap.isHeadingUp() ? 'heading' : 'north');
  $('map-scale').textContent = fmtDist(HoloMap.radius());
  if (window.map3dHud) map3dHud();
  if (g.poisStatus === 'no_codeware') $('map-hint').textContent = t('noCodeware');
  else $('map-hint').textContent = t('mapHint');
}

function fillPop() {
  const res = mapPick;
  if (!res) return;
  const p = res.poi || res.point;
  const me = playerPos() || {};
  if (res.poi) {
    const f = FILTER_BY_ID[p.f];
    $('pop-dot').style.setProperty('--c', p.color);
    $('pop-group').textContent = f ? (f.group.label[LANG] || f.group.label.en) : '';
    $('pop-title').textContent = p.qt || p.n || poiLabel(p);
    if (p.qt || p.n) $('pop-group').textContent = poiLabel(p);
    if (p.spot) $('pop-group').textContent = t('capSpotSeen').replace('{n}', p.spot);
    else if (p.guide) { $('pop-group').textContent = t('capGuideSpot'); $('pop-title').textContent = p.guide; }
    else if (p.live && p.f === 'capitan') $('pop-group').textContent = t('capLiveNow');
  } else {
    $('pop-dot').style.setProperty('--c', WP_COLOR);
    $('pop-group').textContent = t('gps');
    $('pop-title').textContent = t('customPoint');
  }
  $('pop-dist').textContent = fmtDist(distTo(p));
  $('pop-height').textContent = p.z != null && me.z != null ? fmtHeight(p.z - me.z) : '—';
  $('pop-coords').textContent = `${Math.round(p.x)}, ${Math.round(p.y)}${p.z != null ? ', ' + Math.round(p.z) : ''}`;
  $('pop-arrow').style.transform = `rotate(${relBearing(p).toFixed(0)}deg)`;
  // Mission-linked marker: start tracking directly from here.
  const q = res.poi && res.poi.q;
  const tracked = q && (game().journal || {}).tracked === q;
  $('pop-track').hidden = !q;
  $('pop-track').querySelector('span').textContent = t(tracked ? 'untrack' : 'track');
  $('pop-track').classList.toggle('btn-primary', !tracked);
}

function onMapPick(res) {
  buzz(8);
  mapPick = res;
  fillPop();
  $('map-pop').hidden = false;
}
function closePop() { $('map-pop').hidden = true; mapPick = null; HoloMap.clearSelection(); }
$('pop-cancel').addEventListener('click', closePop);
$('pop-track').addEventListener('click', () => {
  const q = mapPick && mapPick.poi && mapPick.poi.q;
  if (!q) return;
  buzz(15);
  if ((game().journal || {}).tracked === q) cmd('untrack'); else cmd('track', q);
  closePop();
});
$('pop-mark').addEventListener('click', () => {
  if (!mapPick) return;
  if (mapPick.poi) markPoi(mapPick.poi);
  else markPoi({ x: mapPick.point.x, y: mapPick.point.y, z: (playerPos() || {}).z || 0, cat: '' });
  closePop();
});
$('zoom-in').addEventListener('click', () => { HoloMap.zoom(-1); if (window.map3dZoom) map3dZoom(1 / 1.5); buzz(5); renderMap(); });
$('zoom-out').addEventListener('click', () => { HoloMap.zoom(1); if (window.map3dZoom) map3dZoom(1.5); buzz(5); renderMap(); });
$('map-mode').addEventListener('click', () => { HoloMap.toggleMode(); if (window.map3dMode) map3dMode(HoloMap.isHeadingUp()); buzz(5); renderMap(); });

// ---------- Map filters ----------
function renderFilters() {
  const counts = {};
  for (const p of allPois()) counts[p.f] = (counts[p.f] || 0) + 1;
  const modes = `<div class="fmodes">${FILTER_MODES.map((m) => `
      <button class="fmode${filterMode === m ? ' is-active' : ''}" data-mode="${m}">
        <b>${esc(t('fmode_' + m))}</b><small>${esc(t('fmodeDesc_' + m))}</small>
      </button>`).join('')}</div>`;
  if (filterMode !== 'custom') {
    const list = FILTER_GROUPS.filter((g) => filterMode === 'dynamic' || MODE_GROUPS[filterMode].includes(g.id));
    $('filters-body').innerHTML = modes + list.map((g) => `
      <div class="fgroup" style="--c:${g.color}">
        <div class="frow fgroup-head is-on"><span class="fname">${esc(g.label[LANG] || g.label.en)}</span></div>
        ${g.filters.filter((f) => filterShows({ f: f.id })).map((f) => `
          <div class="frow is-on" style="--c:${f.color}">
            <span class="fshape ficon" style="-webkit-mask-image:url(mapicons/${f.v[0]}.png);mask-image:url(mapicons/${f.v[0]}.png)"></span>
            <span class="fname">${esc(f.label[LANG] || f.label.en)}</span>
            ${filterMode === 'dynamic' ? `<span class="fextra">${t('ftier' + f.tier)}</span>` : ''}
            <span class="fcount">${counts[f.id] || 0}</span>
          </div>`).join('')}
      </div>`).join('');
    $('filters-all').parentElement.hidden = true;
    return;
  }
  $('filters-all').parentElement.hidden = false;
  const groups = modes + FILTER_GROUPS.map((g) => {
    const allOn = g.filters.every((f) => filterOn(f.id));
    const groupCount = g.filters.reduce((n, f) => n + (counts[f.id] || 0), 0);
    return `
      <div class="fgroup" style="--c:${g.color}">
        <button class="frow fgroup-head${allOn ? ' is-on' : ''}" data-group="${g.id}">
          <span class="fcheck"></span><span class="fname">${esc(g.label[LANG] || g.label.en)}</span><span class="fcount">${groupCount}</span>
        </button>
        ${g.filters.map((f) => `
          <button class="frow${filterOn(f.id) ? ' is-on' : ''}" data-filter="${f.id}" style="--c:${f.color}">
            <span class="fcheck"></span><span class="fshape ficon" style="-webkit-mask-image:url(mapicons/${f.v[0]}.png);mask-image:url(mapicons/${f.v[0]}.png)"></span>
            <span class="fname">${esc(f.label[LANG] || f.label.en)}</span>
            ${f.extra ? `<span class="fextra">${t('extra')}</span>` : ''}
            <span class="fcount">${counts[f.id] || 0}</span>
          </button>`).join('')}
      </div>`;
  }).join('');
  $('filters-body').innerHTML = groups +
    `<p class="funavail dim">${esc(t('notAvailable'))} ${esc(FILTERS_UNAVAILABLE[LANG].join(', '))}.</p>`;
}

$('map-filters').addEventListener('click', () => { buzz(8); renderFilters(); $('filters-sheet').hidden = false; });
$('filters-close').addEventListener('click', () => { $('filters-sheet').hidden = true; renderMap(); });
$('filters-sheet').addEventListener('click', (e) => {
  if (e.target === $('filters-sheet')) { $('filters-sheet').hidden = true; renderMap(); }
});
$('filters-body').addEventListener('click', (e) => {
  const md = e.target.closest('.fmode');
  if (md) { buzz(8); setFilterMode(md.dataset.mode); renderFilters(); renderMap(); return; }
  const b = e.target.closest('button.frow');
  if (!b) return;
  buzz(5);
  if (b.dataset.filter) {
    const id = b.dataset.filter;
    filtersOff.has(id) ? filtersOff.delete(id) : filtersOff.add(id);
  } else if (b.dataset.group) {
    const g = FILTER_GROUPS.find((x) => x.id === b.dataset.group);
    const allOn = g.filters.every((f) => filterOn(f.id));
    for (const f of g.filters) allOn ? filtersOff.add(f.id) : filtersOff.delete(f.id);
  }
  saveFilters();
  renderFilters();
  renderMap();
});
$('filters-all').addEventListener('click', () => { filtersOff.clear(); saveFilters(); renderFilters(); renderMap(); });
$('filters-none').addEventListener('click', () => {
  for (const g of FILTER_GROUPS) for (const f of g.filters) filtersOff.add(f.id);
  saveFilters(); renderFilters(); renderMap();
});

// ---------- Journal ----------
const JOURNAL_GROUPS = ['main', 'side', 'gig', 'other'];
let lastJournalKey = '';
let questSheet = null;

function renderJournal() {
  if (tab !== 'journal') return;
  const j = game().journal || { quests: [] };
  const key = JSON.stringify([j, LANG]);
  if (key === lastJournalKey) return;
  lastJournalKey = key;
  const quests = j.quests || [];
  const tracked = quests.find((q) => q.id === j.tracked);

  $('journal-count').textContent = String(quests.length).padStart(2, '0');
  $('tracked-card').hidden = !tracked;
  if (tracked) {
    $('tracked-title').textContent = tracked.title;
    $('tracked-obj').textContent = tracked.objective || t('noObjective');
    $('tracked-dist').textContent = tracked.dist != null ? fmtDist(tracked.dist) : '';
    $('tracked-card').dataset.id = tracked.id;
  }
  $('journal-empty').hidden = quests.length > 0;
  $('journal-empty').textContent = game().journal ? t('noQuests') : t('journalWaiting');

  $('journal-groups').innerHTML = JOURNAL_GROUPS.map((g) => {
    const items = quests.filter((q) => (JOURNAL_GROUPS.includes(q.group) ? q.group : 'other') === g);
    if (!items.length) return '';
    return `
      <div class="panel-head sub"><span class="panel-title">${esc(t('jg_' + g))}</span><span class="panel-meta">${items.length}</span></div>
      <ul class="list list-flat">
        ${items.map((q) => `
          <li class="row quest-row${q.id === j.tracked ? ' is-tracked' : ''}" data-id="${esc(q.id)}">
            <span class="quest-mark"></span>
            <div class="row-main">
              <div class="row-name">${esc(q.title)}</div>
              <div class="row-sub">${esc(q.objective || t('noObjective'))}</div>
            </div>
            <div class="row-end">
              ${q.dist != null ? `<span class="poi-dist">${fmtDist(q.dist)}</span>` : ''}
            </div>
            <button class="q-btn q-track${q.id === j.tracked ? ' on' : ''}" data-track="${esc(q.id)}" aria-label="${t(q.id === j.tracked ? 'untrack' : 'track')}"><svg viewBox="0 0 24 24"><use href="#i-track"/></svg></button>
            <button class="q-btn q-more" data-more="${esc(q.id)}" aria-label="${t('details')}"><svg viewBox="0 0 24 24"><use href="#i-dots"/></svg></button>
          </li>`).join('')}
      </ul>`;
  }).join('');
  if (questSheet) fillQuestSheet();
}

function openQuest(id) {
  questSheet = id;
  fillQuestSheet();
  $('quest-sheet').hidden = false;
  cmd('quest_details', id);
}
function fillQuestSheet() {
  const j = game().journal || { quests: [] };
  const q = (j.quests || []).find((x) => x.id === questSheet);
  if (!q) { closeQuest(); return; }
  const isTracked = q.id === j.tracked;
  $('quest-tag').textContent = t('jg_' + (JOURNAL_GROUPS.includes(q.group) ? q.group : 'other')) + (isTracked ? ' · ' + t('trackedTag') : '');
  $('quest-title').textContent = q.title;
  $('quest-obj').textContent = q.objective || t('noObjective');
  $('quest-dist').textContent = q.dist != null ? `${t('distance')}: ${fmtDist(q.dist)}` : '';
  $('quest-track-label').textContent = t(isTracked ? 'untrack' : 'track');
  $('quest-track').classList.toggle('btn-danger', isTracked);
  $('quest-track').classList.toggle('btn-primary', !isTracked);
  const d = game().questDetail && game().questDetail.id === q.id ? game().questDetail : null;
  $('quest-meta').innerHTML = d ? [
    d.level ? `<span>${t('recLevel')} <b>${d.level}</b></span>` : '',
    d.district ? `<span>${esc(d.district)}</span>` : '',
  ].join('') : `<span class="dim">${t('loading')}</span>`;
  $('quest-desc').hidden = !(d && d.description);
  $('quest-desc').textContent = d && d.description ? d.description : '';
  const objs = d ? d.objectives || [] : [];
  $('quest-objs').innerHTML = objs.map((o) => `
    <li class="qo ${String(o.state || '').toLowerCase()}${o.optional ? ' optional' : ''}">
      <i></i><span>${esc(o.text)}${o.optional ? ` <em>${t('optional')}</em>` : ''}</span>${o.total ? `<b>${o.count}/${o.total}</b>` : ''}
    </li>`).join('');
  $('quest-msg').hidden = objs.length > 0;
}
function closeQuest() {
  if (questSheet) cmd('quest_details_close');
  $('quest-sheet').hidden = true; questSheet = null;
}

$('journal-groups').addEventListener('click', (e) => {
  const tr = e.target.closest('[data-track]');
  if (tr) {
    buzz(20);
    const j = game().journal || {};
    if (tr.dataset.track === j.tracked) cmd('untrack'); else cmd('track', tr.dataset.track);
    tr.classList.toggle('on');
    return;
  }
  const row = e.target.closest('.row');
  if (row) { buzz(10); openQuest(row.dataset.id); }
});
$('tracked-card').addEventListener('click', () => { buzz(10); openQuest($('tracked-card').dataset.id); });
$('tracked-untrack').addEventListener('click', (e) => { e.stopPropagation(); buzz(12); cmd('untrack'); });
$('quest-close').addEventListener('click', closeQuest);
$('quest-sheet').addEventListener('click', (e) => { if (e.target === $('quest-sheet')) closeQuest(); });
$('quest-track').addEventListener('click', () => {
  const j = game().journal || {};
  const id = questSheet;
  closeQuest();
  buzz(20);
  if (id === j.tracked) cmd('untrack');
  else cmd('track', id);
});

// ---------- abas ----------
function switchTab(name, initial) {
  if (!['contacts', 'vehicles', 'gigs', 'map', 'journal', 'radio', 'messages', 'internet', 'camera', 'shards', 'status', 'settings'].includes(name)) name = 'contacts';
  if (name === tab && !initial) return;
  tab = name;
  store(TAB_STORE, name);
  if (!initial) buzz(6);
  for (const x of document.querySelectorAll('.tab')) x.classList.toggle('is-active', x.dataset.tab === name);
  for (const p of ['contacts', 'vehicles', 'gigs', 'map', 'journal', 'radio', 'messages', 'internet', 'camera', 'shards', 'status', 'settings']) $('panel-' + p).hidden = p !== name;
  HoloMap.setVisible(name === 'map');
  if (window.onTabChange) onTabChange(name);
  if (name !== 'map') closePop();
  if (name === 'vehicles' && !initial) cmd('refresh');
  if (state) render();
}

document.querySelector('.tabs').addEventListener('click', (e) => {
  const b = e.target.closest('.tab');
  if (b) switchTab(b.dataset.tab);
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && key && es && es.readyState === EventSource.CLOSED) connect();
});

boot();

$('cap-banner-x').addEventListener('click', () => { buzz(8); stopCapHunt(); });
$('cap-find').addEventListener('click', () => { buzz(10); startCapHunt(); });
