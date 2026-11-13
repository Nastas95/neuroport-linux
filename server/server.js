// Neuroport — local bridge between the web app and the in-game CET mod.
// No dependencies: Node.js built-ins only. (http + fs).
//
// Fluxo:
//   client --POST /api/cmd--> server --(inbox.txt)--> CET mod (reads every 250 ms)
//   CET mod --(state.json)--> server --SSE /api/stream--> client
//
// Uso:
//   node server.js                 -> use the in-game mod folder (default Steam path)
//   node server.js --mock          -> simulate the game (for UI testing)
//   node server.js --bridge <dir>  -> use a mod folder at another location
//   node server.js --port 7077
//   node server.js --gui           -> opens the server control panel (Edge window) on startup

'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');

// ---------- argumentos ----------
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};

const MOCK = flag('--mock');
const PORT = Number(opt('--port', process.env.NEUROPORT_PORT || 7077));
// In-game mod folder (file bridge). Priority: --bridge / NEUROPORT_BRIDGE; otherwise
// use the server directory inside the mod folder (Nexus package: mods/neuroport/companion/server); Steam
// (todas as bibliotecas), GOG e Epic.
const MOD_SUBPATH = path.join('bin', 'x64', 'plugins', 'cyber_engine_tweaks', 'mods', 'neuroport');
function linuxSteamRoots() {
  const home = os.homedir();
  const roots = [
    path.join(home, '.local', 'share', 'Steam'),
    path.join(home, '.steam', 'steam'),
    path.join(home, '.var', 'app', 'com.valvesoftware.Steam', '.local', 'share', 'Steam'),
    path.join(home, '.var', 'app', 'com.valvesoftware.Steam', '.steam', 'steam'),
    path.join(home, 'Games', 'Steam'),
  ];
  const out = [];
  const seen = new Set();
  for (const candidate of roots) {
    try {
      const root = fs.realpathSync(candidate);
      if (!seen.has(root)) { seen.add(root); out.push(root); }
    } catch { /* Steam is not installed in this location */ }
  }
  // Steam may have additional libraries on other drives.
  for (const root of [...out]) {
    try {
      const vdf = fs.readFileSync(path.join(root, 'steamapps', 'libraryfolders.vdf'), 'utf8');
      for (const m of vdf.matchAll(/\"path\"\s+\"([^\"]+)\"/g)) {
        const candidate = m[1].replace(/\\\\/g, '/');
        try {
          const real = fs.realpathSync(candidate);
          if (!seen.has(real)) { seen.add(real); out.push(real); }
        } catch { /* Library is unavailable */ }
      }
    } catch { /* No libraryfolders.vdf file */ }
  }
  return out;
}
function gameDirs() {
  if (process.platform === 'linux') {
    return linuxSteamRoots().map((root) => path.join(root, 'steamapps', 'common', 'Cyberpunk 2077'));
  }
  const out = [];
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const pf = process.env.ProgramFiles || 'C:\\Program Files';
  const steamRoots = [path.join(pf86, 'Steam'), path.join(pf, 'Steam')];
  for (const root of steamRoots) {
    out.push(path.join(root, 'steamapps', 'common', 'Cyberpunk 2077'));
    // outras bibliotecas da Steam (D:\\SteamLibrary etc.)
    try {
      const vdf = fs.readFileSync(path.join(root, 'steamapps', 'libraryfolders.vdf'), 'utf8');
      for (const m of vdf.matchAll(/\"path\"\s+\"([^\"]+)\"/g)) out.push(path.join(m[1].replace(/\\\\/g, '\\'), 'steamapps', 'common', 'Cyberpunk 2077'));
    } catch { /* Steam is unavailable here */ }
  }
  out.push(path.join(pf86, 'GOG Galaxy', 'Games', 'Cyberpunk 2077'), path.join(pf, 'GOG Galaxy', 'Games', 'Cyberpunk 2077'),
    'C:\\GOG Games\\Cyberpunk 2077', path.join(pf, 'Epic Games', 'Cyberpunk2077'), path.join(pf, 'Epic Games', 'Cyberpunk 2077'));
  return out;
}
function findBridge() {
  const forced = opt('--bridge', process.env.NEUROPORT_BRIDGE || '');
  if (forced) return forced;
  // Server installed inside the mod folder.
  const parts = path.resolve(__dirname).split(path.sep);
  const i = parts.map((p) => p.toLowerCase()).lastIndexOf('neuroport');
  if (i > 0 && parts[i - 1].toLowerCase() === 'mods' && fs.existsSync(path.join(parts.slice(0, i + 1).join(path.sep), 'init.lua'))) {
    return parts.slice(0, i + 1).join(path.sep);
  }
  const candidates = gameDirs();
  for (const g of candidates) {
    const cet = path.join(g, 'bin', 'x64', 'plugins', 'cyber_engine_tweaks');
    if (fs.existsSync(cet)) return path.join(g, MOD_SUBPATH);
  }
  if (candidates.length) return path.join(candidates[0], MOD_SUBPATH);
  // Readable fallback for non-standard Steam locations: the user can
  // Always provide --bridge or NEUROPORT_BRIDGE to avoid a server startup failure.
  if (process.platform === 'linux') return path.join(os.homedir(), '.local', 'share', 'Steam', 'steamapps', 'common', 'Cyberpunk 2077', MOD_SUBPATH);
  return path.join(os.homedir(), MOD_SUBPATH);
}
const BRIDGE = findBridge();
// Game folder (used by the image extractor to read .archive files).
const GAME_DIR = path.resolve(BRIDGE, '..', '..', '..', '..', '..', '..');
const WEB_DIR = path.join(__dirname, '..', 'web');
const INBOX = path.join(BRIDGE, 'inbox.txt');
const STATE = path.join(BRIDGE, 'state.json');
const WORLD = path.join(BRIDGE, 'world.json'); // Markers + journal (updated every ~3 seconds).
const STALE_MS = 4000; // If the mod has not updated for this long, the game is considered offline.

// ---------- Log (also shown in the server control panel) ----------
const LOG = [];
const _log = console.log.bind(console);
console.log = (...a) => {
  const line = a.join(' ');
  _log(line);
  if (line.trim()) { LOG.push({ t: Date.now(), line }); if (LOG.length > 300) LOG.shift(); }
};
const startedAt = Date.now();

// ---------- Pairing code ----------
// Persisted so the phone link remains valid across restarts.
const TOKEN_FILE = path.join(__dirname, '.token');
let TOKEN = opt('--token', null);
if (!TOKEN) {
  try { TOKEN = fs.readFileSync(TOKEN_FILE, 'utf8').trim(); } catch { /* novo */ }
}
// Pairing code: 12 unambiguous Base32 characters (60 bits), displayed as XXXX-XXXX-XXXX.
// Together with the attempt limit below, guessing the code over the network is impractical.
const B32 = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
const normKey = (k) => String(k || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const fmtToken = (t) => (t || '').replace(/(.{4})(?=.)/g, '$1-');
function newToken() {
  const b = crypto.randomBytes(12);
  TOKEN = Array.from(b, (x) => B32[x % B32.length]).join('');
  try { fs.writeFileSync(TOKEN_FILE, TOKEN); } catch { /* ok */ }
}
TOKEN = normKey(TOKEN);
if (!TOKEN || flag('--new-token') || (!opt('--token', null) && TOKEN.length < 12)) newToken();   // Legacy six-character codes are replaced.

// ---------- Shared state ----------
let gameState = null;      // Last valid state.json.
let worldState = null;     // Last valid world.json.
let worldMtime = 0;
let stateMtime = 0;        // File modification time (used to detect when the game closes).
let lastBroadcast = '';
const clients = new Set(); // Open SSE responses.
const clientInfo = new Map(); // response -> { ip, ua, since }

// Pending commands (not yet acknowledged by the mod).
let nextId = Date.now();
const pending = []; // {id, action, arg}

function snapshot() {
  const online = MOCK ? true : Date.now() - stateMtime < STALE_MS && !!gameState;
  const game = gameState ? { ...gameState, ...(worldState || {}) } : null;
  return { online, mock: MOCK, game };
}

function broadcast(force) {
  const snap = snapshot();
  if (snap.game) warmImages(snap.game);
  const payload = JSON.stringify(snap);
  if (!force && payload === lastBroadcast) return;
  lastBroadcast = payload;
  for (const res of clients) res.write(`event: state\ndata: ${payload}\n\n`);
}

function sendEvent(event, data) {
  const s = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(s);
}

// ---------- ponte por arquivos (modo real) ----------
function writeInbox() {
  // One line per command: id \t action \t arg
  const body = pending
    .map((c) => `${c.id}\t${c.action}\t${String(c.arg ?? '').replace(/[\t\r\n]/g, ' ')}`)
    .join('\n');
  const tmp = INBOX + '.tmp';
  try {
    fs.writeFileSync(tmp, body + (body ? '\n' : ''), 'utf8');
    fs.renameSync(tmp, INBOX);
  } catch (e) {
    // The mod may be reading the file right now; try again shortly.
    setTimeout(writeInbox, 60);
  }
}

const seenAcks = new Set();
function pollWorld() {
  let st;
  try { st = fs.statSync(WORLD); } catch { return; }
  if (st.mtimeMs === worldMtime) return;
  try {
    worldState = JSON.parse(fs.readFileSync(WORLD, 'utf8').replace(/^\uFEFF/, ''));
    delete worldState.v;
    worldMtime = st.mtimeMs;
  } catch { /* File is being written */ }
}

function pollState() {
  pollWorld();
  let st;
  try { st = fs.statSync(STATE); } catch { broadcast(); return; }
  if (st.mtimeMs !== stateMtime) {
    try {
      const parsed = JSON.parse(fs.readFileSync(STATE, 'utf8').replace(/^﻿/, ''));
      gameState = parsed;
      stateMtime = st.mtimeMs;
      handleAcks(parsed.acks || []);
    } catch {
      // File is being written; skip it and read it on the next poll.
    }
  }
  broadcast();
}

function handleAcks(acks) {
  for (const a of acks) {
    if (seenAcks.has(a.id)) continue;
    seenAcks.add(a.id);
    const idx = pending.findIndex((c) => String(c.id) === String(a.id));
    if (idx >= 0) pending.splice(idx, 1);
    sendEvent('ack', a);
  }
  if (seenAcks.size > 500) seenAcks.clear();
  writeInboxIfChanged();
}

let lastInbox = null;
function writeInboxIfChanged() {
  const key = pending.map((c) => c.id).join(',');
  if (key === lastInbox) return;
  lastInbox = key;
  writeInbox();
}

// Commands never acknowledged by the mod (e.g. because the game is closed) expire.
setInterval(() => {
  const now = Date.now();
  for (let i = pending.length - 1; i >= 0; i--) {
    if (now - pending[i].at > 15000) {
      sendEvent('ack', { id: pending[i].id, ok: false, msg: 'timeout' });
      pending.splice(i, 1);
    }
  }
  if (!MOCK) writeInboxIfChanged();
}, 1000);

// ---------- Simulation (--mock) ----------
const mock = MOCK ? require('./mock.js') : null;
if (mock) mock.setLang(opt('--lang', 'en-us'));

function enqueue(action, arg) {
  const id = String(++nextId);
  if (MOCK) {
    setTimeout(() => {
      const r = mock.run(action, arg);
      gameState = mock.state();
      sendEvent('ack', { id, ok: r.ok, msg: r.msg, action });
      broadcast();
    }, 350);
  } else {
    pending.push({ id, action, arg, at: Date.now() });
    writeInboxIfChanged();
  }
  return id;
}

// ---------- HTTP ----------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.glb': 'model/gltf-binary',
  '.ogg': 'audio/ogg',
  '.woff2': 'font/woff2',
  '.bin': 'application/octet-stream',
};

const isLocal = (req) => /^(::1|127\.0\.0\.1|::ffff:127\.0\.0\.1)$/.test(req.socket.remoteAddress || '');
// The control panel must originate on this PC and target localhost (DNS rebinding protection).
// and, for write requests, originate from this panel: another browser site cannot send the
// X-Neuroport-Admin header without permission (CORS) or spoof the request origin.
function adminRequestOk(req) {
  const host = String(req.headers.host || '').replace(/:\d+$/, '').toLowerCase();
  if (!['localhost', '127.0.0.1', '[::1]'].includes(host)) return false;
  const origin = req.headers.origin;
  if (origin && !/^http:\/\/(localhost|127\.0\.0\.1|\[::1\]):\d+$/i.test(origin)) return false;
  if (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site'])) return false;
  if (req.method !== 'GET' && req.headers['x-neuroport-admin'] !== '1') return false;
  return true;
}
// Attempt limit: eight incorrect codes in ten minutes block the IP for 15 minutes (the local PC is exempt).
const authFails = new Map(); // ip -> { n, t0, until }
const clientIp = (req) => (req.socket.remoteAddress || '').replace('::ffff:', '');
function authBlocked(req) {
  const f = authFails.get(clientIp(req));
  return !!(f && f.until && Date.now() < f.until);
}
function authed(req, url) {
  if (authBlocked(req)) return false;
  const k = normKey(url.searchParams.get('k') || req.headers['x-neuroport-key']);
  const ok = k.length === TOKEN.length && crypto.timingSafeEqual(Buffer.from(k), Buffer.from(TOKEN));
  if (!ok && !isLocal(req)) {
    const ip = clientIp(req), now = Date.now();
    let f = authFails.get(ip);
    if (!f || now - f.t0 > 600000) f = { n: 0, t0: now, until: 0 };
    if (++f.n >= 8) { f.until = now + 900000; console.log(`  [security] ${ip} blocked for 15 min (incorrect code ${f.n}x)`); }
    authFails.set(ip, f);
  }
  return ok;
}

function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => { b += c; if (b.length > 1e5) req.destroy(); });
    req.on('end', () => resolve(b));
  });
}

const ACTIONS = new Set(['summon', 'call', 'hangup', 'refresh', 'ping', 'waypoint', 'clearwp', 'track', 'untrack', 'call_answer', 'call_reject',
  'radio_on', 'radio_off', 'radio_set', 'radio_next', 'radio_prev', 'radio_vol', 'ad_start', 'ad_quest', 'ad_stop', 'color', 'color_reset', 'horn',
  'thread', 'thread_close', 'reply', 'quest_details', 'quest_details_close', 'buy', 'shop_refresh',
  'immersive_on', 'immersive_off', 'imm_toggle', 'imm_all', 'shard_read', 'photo_mode']);

// Press a scancode in the Cyberpunk 2077 window — used to open photo mode (N).
function pressGameKey(scan) {
  if (process.platform === 'win32') {
    const ps = spawn('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'presskey.ps1'), '-Scan', String(scan)], { windowsHide: true });
    let out = '';
    ps.stdout?.on('data', (d) => { out += d; });
    ps.on('error', (e) => console.log(`  [photo mode] could not send key: ${e.message}`));
    ps.on('exit', () => console.log(`  [photo mode] key sent: ${out.trim() || 'no response'}`));
    return;
  }
  if (process.platform === 'linux') {
    // Proton normally presents the game as an XWayland window, including on KDE
    // Wayland. Run search, activate and key as separate commands so that
    // missing windows and focus errors can be detected.
    const search = spawn('xdotool', ['search', '--onlyvisible', '--name', 'Cyberpunk 2077'], { stdio: ['ignore', 'pipe', 'ignore'] });
    let windows = '';
    search.stdout.on('data', (d) => { windows += String(d); });
    search.on('error', () => tryYdotool());
    search.on('exit', (code) => {
      const ids = windows.trim().split(/\s+/).filter((x) => /^\d+$/.test(x));
      if (code !== 0 || !ids.length) {
        console.log('  [photo mode] Cyberpunk XWayland window not found; trying ydotool.');
        return tryYdotool();
      }
      const id = ids[ids.length - 1];
      const activate = spawn('xdotool', ['windowactivate', '--sync', id], { stdio: 'ignore' });
      activate.on('error', () => tryYdotool());
      activate.on('exit', (activateCode) => {
        if (activateCode !== 0) return tryYdotool();
        const key = spawn('xdotool', ['key', '--clearmodifiers', 'n'], { stdio: 'ignore' });
        key.on('error', () => tryYdotool());
        key.on('exit', (keyCode) => {
          if (keyCode === 0) console.log('  [photo mode] key N sent to Cyberpunk 2077.');
          else tryYdotool();
        });
      });
    });
    function tryYdotool() {
      const yd = spawn('ydotool', ['key', '49:1', '49:0'], { stdio: 'ignore' });
      yd.on('error', () => console.log('  [photo mode] install xdotool (X11/XWayland) or configure ydotool for Wayland.'));
      yd.on('exit', (code) => { if (code === 0) console.log('  [photo mode] key N sent via ydotool.'); else console.log('  [photo mode] could not send N: install xdotool or configure ydotool.'); });
    }
    return;
  }
  console.log('  [photo mode] key sending is not supported on this platform.');
}

// ---------- Photo mode screenshots (game capture folder) ----------
const PHOTO_DIRS = process.platform === 'linux'
  ? [
      path.join(os.homedir(), 'Pictures', 'Cyberpunk 2077'),
      ...linuxSteamRoots().map((root) => path.join(root, 'steamapps', 'compatdata', '1091500', 'pfx', 'drive_c', 'users', 'steamuser', 'Pictures', 'Cyberpunk 2077')),
    ]
  : [path.join(os.homedir(), 'Pictures', 'Cyberpunk 2077'), path.join(os.homedir(), 'OneDrive', 'Pictures', 'Cyberpunk 2077')];
function listPhotos() {
  const out = [];
  for (const dir of PHOTO_DIRS) {
    let names = [];
    try { names = fs.readdirSync(dir); } catch { continue; }
    for (const n of names) {
      // Only in-game photo-mode images (photomode_DDMMYYYY_HHMMSS.png) are listed; other files are ignored.
      if (!/^photomode_[\d_]+\.(png|jpe?g|webp)$/i.test(n)) continue;
      try { out.push({ name: n, dir, t: fs.statSync(path.join(dir, n)).mtimeMs }); } catch { /* ok */ }
    }
  }
  return out.sort((a, b) => b.t - a.t);
}


const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');

  if (url.pathname === '/api/stream') {
    if (!authed(req, url)) { res.writeHead(401); return res.end('invalid code'); }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write(`event: state\ndata: ${JSON.stringify(snapshot())}\n\n`);
    clients.add(res);
    clientInfo.set(res, { ip: (req.socket.remoteAddress || '').replace('::ffff:', ''), ua: req.headers['user-agent'] || '', since: Date.now() });
    console.log(`  [client] connected: ${clientInfo.get(res).ip}`);
    const ka = setInterval(() => res.write(': ka\n\n'), 15000);
    req.on('close', () => {
      const info = clientInfo.get(res);
      clients.delete(res); clientInfo.delete(res); clearInterval(ka);
      if (info) console.log(`  [client] disconnected: ${info.ip}`);
    });
    return;
  }

  if (url.pathname === '/api/cmd' && req.method === 'POST') {
    if (!authed(req, url)) { res.writeHead(401); return res.end('{"error":"invalid code"}'); }
    let body = {};
    try { body = JSON.parse(await readBody(req)); } catch { /* empty */ }
    if (!ACTIONS.has(body.action) && !(MOCK && (body.action === 'mock_ring' || body.action === 'mock_car'))) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end('{"error":"unknown action"}');
    }
    if (!['ping', 'refresh', 'thread', 'quest_details', 'shop_refresh'].includes(body.action)) {
      console.log(`  [command] ${body.action}${body.arg ? ' ' + String(body.arg).slice(0, 40) : ''}`);
    }
    // Photo mode cannot be opened through a script; the server presses N in the game window.
    if (body.action === 'photo_mode' && !MOCK) pressGameKey(0x31);
    const id = enqueue(body.action, body.arg);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ id }));
  }

  if (url.pathname === '/api/check') {
    res.writeHead(authed(req, url) ? 200 : 401, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: authed(req, url) }));
  }

  if (url.pathname === '/api/warm') {
    if (!authed(req, url)) { res.writeHead(401); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
    return res.end(JSON.stringify({ total: warm.total, done: warm.done, failed: warm.failed }));
  }

  // Shards (Codex): the mod writes shards.json separately; the app fetches it when the reader opens.
  if (url.pathname === '/api/shards') {
    if (!authed(req, url)) { res.writeHead(401); return res.end(); }
    let txt = '{"shards":[]}';
    try { txt = fs.readFileSync(path.join(BRIDGE, 'shards.json'), 'utf8').replace(/^\uFEFF/, ''); } catch { /* file does not exist yet */ }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
    return res.end(txt);
  }

  if (url.pathname === '/api/photos') {
    if (!authed(req, url)) { res.writeHead(401); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(listPhotos().slice(0, 60).map((f) => ({ name: f.name, t: f.t }))));
  }
  const pm = url.pathname.match(/^\/photo\/(.+)$/);
  if (pm) {
    if (!authed(req, url)) { res.writeHead(401); return res.end(); }
    const name = decodeURIComponent(pm[1]);
    const f = listPhotos().find((x) => x.name === name);
    if (!f) { res.writeHead(404); return res.end(); }
    const ext = path.extname(name).toLowerCase();
    res.writeHead(200, { 'Content-Type': ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg', 'Cache-Control': 'public, max-age=86400' });
    return fs.createReadStream(path.join(f.dir, f.name)).pipe(res);
  }

  // ---------- Server control panel (local PC only) ----------
  if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) {
    if (!isLocal(req)) { res.writeHead(403); return res.end('the control panel is only available on the PC'); }
    if (!adminRequestOk(req)) { res.writeHead(403); return res.end('request blocked'); }
    if (url.pathname === '/admin/api/status') {
      const snap = snapshot();
      const g = snap.game || {};
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        mock: MOCK, port: PORT, token: TOKEN, ips: lanAddresses(), uptime: Date.now() - startedAt,
        bridge: BRIDGE, bridgeExists: fs.existsSync(BRIDGE),
        online: snap.online, inGame: !!g.inGame, mod: g.mod || null, lang: g.lang || null, immersive: !!g.immersive, immHud: g.immHud || [],
        player: g.player || null, district: g.district || null, vehicle: g.vehicle || null,
        counts: { pois: (g.pois || []).length, contacts: (g.contacts || []).length, quests: ((g.journal || {}).quests || []).length, offers: (g.offers || []).length },
        phones: [...clientInfo.values()],
        pending: pending.length,
        log: LOG.slice(-120),
      }));
    }
    if (url.pathname === '/admin/api/token' && req.method === 'POST') {
      newToken();
      console.log(`  New pairing code: ${fmtToken(TOKEN)}`);
      for (const r of clients) { try { r.end(); } catch { /* ok */ } }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ token: TOKEN }));
    }
    if (url.pathname === '/admin/api/cmd' && req.method === 'POST') {
      let body = {};
      try { body = JSON.parse(await readBody(req)); } catch { /* empty */ }
      if (!ACTIONS.has(body.action)) { res.writeHead(400); return res.end(); }
      console.log(`  [panel] ${body.action}`);
      const id = enqueue(body.action, body.arg);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ id }));
    }
    if (url.pathname === '/admin/api/open' && req.method === 'POST') {
      const which = url.searchParams.get('what');
      // Open the app in the PC default browser, using the existing pairing.
      if (which === 'app') {
        const targetUrl = `http://localhost:${PORT}/?k=${TOKEN}`;
        const opener = process.platform === 'win32' ? spawn('cmd', ['/c', 'start', '', targetUrl], { detached: true, stdio: 'ignore', windowsHide: true })
          : process.platform === 'darwin' ? spawn('open', [targetUrl], { detached: true, stdio: 'ignore' })
          : spawn('xdg-open', [targetUrl], { detached: true, stdio: 'ignore' });
        opener.on('error', (e) => console.log(`  [open app] ${e.message}`)); opener.unref();
        res.writeHead(204); return res.end();
      }
      const target = which === 'photos' ? (PHOTO_DIRS.find((d) => fs.existsSync(d)) || PHOTO_DIRS[0]) : which === 'project' ? path.join(__dirname, '..') : BRIDGE;
      const opener = process.platform === 'win32' ? spawn('explorer', [target], { detached: true, stdio: 'ignore' })
        : process.platform === 'darwin' ? spawn('open', [target], { detached: true, stdio: 'ignore' })
        : spawn('xdg-open', [target], { detached: true, stdio: 'ignore' });
      opener.on('error', (e) => console.log(`  [open folder] ${e.message}`)); opener.unref();
      res.writeHead(204); return res.end();
    }
    if (url.pathname === '/admin/api/restart' && req.method === 'POST') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
      setTimeout(restartServer, 150);
      return;
    }
    if (url.pathname === '/admin/api/clear-cache' && req.method === 'POST') {
      let n = 0;
      try { for (const f of fs.readdirSync(AVATAR_DIR)) { fs.unlinkSync(path.join(AVATAR_DIR, f)); n++; } } catch { /* ok */ }
      console.log(`  [panel] cache de avatares limpo (${n} arquivos)`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ removed: n }));
    }
    const af = url.pathname === '/admin' || url.pathname === '/admin/' ? 'index.html' : url.pathname.slice(7);
    const file = path.normalize(path.join(WEB_DIR, 'admin', af));
    if (!file.startsWith(path.join(WEB_DIR, 'admin'))) { res.writeHead(403); return res.end(); }
    return fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'text/plain', 'Cache-Control': 'no-cache' });
      res.end(data);
    });
  }

  // Contact avatars: extracted on demand from the game UI atlases and cached.
  const am = url.pathname.match(/^\/avatar\/([a-z0-9_]{1,64})\.png$/i);
  if (am) {
    const file = await avatarFile(am[1], url.searchParams.get('a'));
    if (!file) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=604800' });
    return fs.createReadStream(file).pipe(res);
  }

  // Static interface files.
  let p = decodeURIComponent(url.pathname);
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(WEB_DIR, p));
  if (!file.startsWith(WEB_DIR)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) {
      // Extensionless paths (e.g. altered QR-reader URLs) return to the app instead of a missing-page response.
      if (!path.extname(p)) { res.writeHead(302, { Location: '/' + url.search }); return res.end(); }
      res.writeHead(404); return res.end('404');
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      // Map data (about 10 MB) is cached by the client.
      'Cache-Control': file.includes(`${path.sep}map3d${path.sep}`) ? 'public, max-age=604800' : 'no-cache',
    });
    res.end(data);
  });
});

function lanAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family === 'IPv4' && !a.internal && !/vEthernet|VirtualBox|VMware|WSL|Hyper-V/i.test(name)) {
        out.push(a.address);
      }
    }
  }
  // rede de casa primeiro (o QR usa o primeiro): 192.168 > 10 > 172.16-31 > resto (VPN, Tailscale 100.x)
  const rank = (ip) => /^192\.168\./.test(ip) ? 0 : /^10\./.test(ip) ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 2 : 3;
  return out.sort((a, b) => rank(a) - rank(b));
}

// ---------- estrazione immagini nativa ----------
const AVATAR_DIR = path.join(WEB_DIR, 'avatars');
const IMAGE_DATA_HOME = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
const IMAGE_RUNTIME_HOME = path.join(IMAGE_DATA_HOME, 'neuroport');
const NATIVE_OODLE_LIBRARY = process.env.NEUROPORT_OODLE_LIBRARY || path.join(IMAGE_RUNTIME_HOME, 'libneuroport_oodle.so');
const DEFAULT_IMAGE_PYTHON = path.join(IMAGE_RUNTIME_HOME, 'image-venv', 'bin', 'python');
const IMAGE_PYTHON = process.env.NEUROPORT_IMAGE_PYTHON || DEFAULT_IMAGE_PYTHON;
const IMAGE_EXTRACTION_AVAILABLE = process.platform === 'win32' ||
  (process.platform === 'linux' && fs.existsSync(NATIVE_OODLE_LIBRARY) && fs.existsSync(IMAGE_PYTHON));
let assetExtractionNoticeShown = false;
const avatarJobs = new Map();
const ATLAS_INDEX = path.join(__dirname, '..', 'tools', 'gamefiles', 'atlas_index.json');
let atlasIndexReady = null;

// Linux uses native Python/Pillow and the Rust oozextract library for Oodle streams.
// Windows keeps using Python and the official Oodle DLL from the game.
function runGamePython(script, args = [], onOutput = null) {
  return new Promise((resolve) => {
    let command, commandArgs;
    if (process.platform === 'linux') {
      if (!IMAGE_EXTRACTION_AVAILABLE) return resolve(false);
      command = IMAGE_PYTHON;
      commandArgs = ['-I', script, ...args];
    } else {
      command = 'python';
      commandArgs = ['-I', script, ...args];
    }
    const child = spawn(command, commandArgs, {
      windowsHide: true,
      env: {
        ...process.env,
        NEUROPORT_GAME: GAME_DIR,
        ...(process.platform === 'linux' ? { NEUROPORT_OODLE_LIBRARY: NATIVE_OODLE_LIBRARY } : {}),
      },
    });
    child.stdout.on('data', (d) => { if (onOutput) onOutput(String(d)); });
    child.stderr.on('data', (d) => { if (onOutput) onOutput(String(d)); });
    child.on('error', () => resolve(false));
    child.on('exit', (code) => resolve(code === 0));
  });
}

function ensureAtlasIndex() {
  if (atlasIndexReady) return atlasIndexReady;
  if (fs.existsSync(ATLAS_INDEX)) return (atlasIndexReady = Promise.resolve(true));
  if (!IMAGE_EXTRACTION_AVAILABLE) {
    console.log('  [images] atlas index is missing: configure the native Oodle decoder first (setup-native-image-extraction.sh).');
    return (atlasIndexReady = Promise.resolve(false));
  }
  console.log('  [images] generating the atlas index from game files (first run; this may take several minutes)…');
  const script = path.join(__dirname, '..', 'tools', 'gamefiles', 'avatar.py');
  atlasIndexReady = runGamePython(script, ['--build-index'], (line) => console.log('  [images] ' + line.trim()))
    .then((ok) => {
      if (!ok) console.log('  [images] atlas index generation failed; missing images will use fallbacks.');
      return ok;
    });
  return atlasIndexReady;
}

function avatarFile(part, atlas) {
  if (!IMAGE_EXTRACTION_AVAILABLE) {
    if (!assetExtractionNoticeShown) {
      assetExtractionNoticeShown = true;
      console.log('  [images] native runtime is not configured. Run companion/setup-native-image-extraction.sh to enable portraits and vehicle photos.');
    }
    return Promise.resolve(null);
  }
  const file = path.join(AVATAR_DIR, part.toLowerCase() + '.png');
  if (fs.existsSync(file)) return Promise.resolve(file);
  if (avatarJobs.has(file)) return avatarJobs.get(file);
  const waitIndex = /^(v_|apr_)/i.test(part) ? ensureAtlasIndex() : Promise.resolve(true);
  const a = atlas && /^(0x)?[0-9a-f]{1,20}$/i.test(atlas) ? atlas : '';
  const script = path.join(__dirname, '..', 'tools', 'gamefiles', 'avatar.py');
  const job = waitIndex.then((ready) => ready ? runGamePython(script, [part, file, a]) : false).then((ok) => {
    avatarJobs.delete(file);
    return ok && fs.existsSync(file) ? file : null;
  }).catch(() => {
    avatarJobs.delete(file);
    return null;
  });
  avatarJobs.set(file, job);
  return job;
}

// Pre-extraction: when the game connects, avatars and vehicle images are processed
// in the background, two at a time. The client tracks progress through /api/warm.
const warm = { total: 0, done: 0, failed: 0, seen: new Set(), queue: [], running: 0 };
function warmImages(g) {
  const add = (part, atlas) => {
    if (!part || !/^[a-z0-9_]{1,64}$/i.test(part)) return;
    const k = part.toLowerCase();
    if (warm.seen.has(k)) return;
    warm.seen.add(k);
    warm.total++;
    warm.queue.push([part, atlas || '']);
  };
  for (const c of g.contacts || []) if (c.avatar) add(c.avatar, c.atlas);
  for (const v of g.vehicles || []) if (v.img) add(v.img.part, v.img.atlas);
  for (const o of g.offers || []) if (o.img) add(o.img.part, o.img.atlas);
  pumpWarm();
}
function pumpWarm() {
  while (warm.running < 2 && warm.queue.length) {
    const [part, atlas] = warm.queue.shift();
    warm.running++;
    avatarFile(part, atlas).then((f) => { if (!f) warm.failed++; }, () => { warm.failed++; })
      .finally(() => { warm.running--; warm.done++; pumpWarm(); });
  }
}

// ---------- suoneria ----------
const RINGTONE = path.join(WEB_DIR, 'ringtone', 'ringtone.ogg');
function ensureRingtone() {
  if (fs.existsSync(RINGTONE)) return;
  if (!IMAGE_EXTRACTION_AVAILABLE) {
    console.log('  [ringtone] native image runtime is not configured; the fallback ringtone remains active.');
    return;
  }
  const script = path.join(__dirname, '..', 'tools', 'gamefiles', 'extract_ringtone.py');
  runGamePython(script, [RINGTONE], (line) => console.log('  [ringtone] ' + line.trim())).then((ok) => {
    if (!ok) console.log('  [ringtone] extraction failed; the bundled ringtone remains active.');
  });
}
ensureRingtone();
if (!MOCK) ensureAtlasIndex();

// Restart the server: release the port, start a new process in the same console, then exit.
function restartServer() {
  console.log('');
  console.log('  [panel] restarting the server...');
  const args = process.argv.slice(1).filter((a) => a !== '--gui');   // the control panel window is already open
  server.close(() => {
    const child = spawn(process.execPath, args, { cwd: process.cwd(), stdio: 'inherit', env: { ...process.env, NEUROPORT_RESTARTED: '1' } });
    // The Linux launcher tracks the child PID, including restarts triggered from the control panel.
    if (process.env.NEUROPORT_PID_FILE && child.pid) {
      try { fs.writeFileSync(process.env.NEUROPORT_PID_FILE, String(child.pid)); } catch { /* launcher opcional */ }
    }
    // The child inherits the console; this wrapper exits with it.
    child.on('exit', (code) => process.exit(code || 0));
  });
  try { server.closeAllConnections(); } catch { /* node antigo */ }
}
// The port may take a moment to become available after a restart.
let listenTries = 0;
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE' && process.env.NEUROPORT_RESTARTED && listenTries++ < 20) {
    setTimeout(() => server.listen(PORT, '0.0.0.0'), 300);
    return;
  }
  if (e.code === 'EADDRINUSE') {
    console.log('');
    console.log(`  !! Port ${PORT} is already in use. Neuroport may already be running in another window.`);
    console.log('  !! Close the other instance or choose a different port with --port <number>.');
    console.log('');
    process.exit(1);
  }
  throw e;
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('  ╔══════════════════════════════════════════╗');
  console.log('  ║            N E U R O P O R T             ║');
  console.log('  ╚══════════════════════════════════════════╝');
  console.log('');
  if (MOCK) {
    console.log('  Simulation mode (--mock): no game required.');
  } else {
    console.log('  Mod folder: ' + BRIDGE);
    if (!fs.existsSync(BRIDGE)) {
      console.log('  !! Mod folder not found. Run install-linux.sh or use --bridge <path>.');
    }
  }
  console.log('');
  console.log('  Open in a browser on the same Wi-Fi network:');
  for (const ip of lanAddresses()) console.log(`    http://${ip}:${PORT}/?k=${TOKEN}`);
  console.log('');
  console.log(`  Pairing code: ${fmtToken(TOKEN)}`);
  console.log(`  Server control panel: http://localhost:${PORT}/admin`);
  console.log('  (Press Ctrl+C to stop)');
  console.log('');
  if (flag('--gui')) openGui();
});

// Open the panel in an Edge app window, or in the default browser if Edge is unavailable.
function openGui() {
  const url = flag('--desktop') ? `http://localhost:${PORT}/?k=${TOKEN}` : `http://localhost:${PORT}/admin`;
  if (process.platform === 'win32') {
    const edge = spawn('cmd', ['/c', 'start', '', 'msedge', `--app=${url}`, '--window-size=1100,760'], { detached: true, stdio: 'ignore', windowsHide: true });
    edge.on('error', () => spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref());
    edge.on('exit', (c) => { if (c) spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref(); });
    edge.unref();
  } else if (process.platform === 'darwin') {
    const opener = spawn('open', [url], { detached: true, stdio: 'ignore' });
    opener.on('error', (e) => console.log(`  [browser] ${e.message}`)); opener.unref();
  } else {
    const opener = spawn('xdg-open', [url], { detached: true, stdio: 'ignore' });
    opener.on('error', (e) => console.log(`  [browser] ${e.message}`)); opener.unref();
  }
}

if (MOCK) {
  gameState = mock.state();
  setInterval(() => { mock.tick(0.4); gameState = mock.state(); broadcast(); }, 400);
} else {
  try { fs.mkdirSync(BRIDGE, { recursive: true }); } catch { /* permission denied: already reported above */ }
  try { fs.writeFileSync(INBOX, ''); } catch { /* ok */ }
  setInterval(pollState, 250);
}
