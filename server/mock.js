// Mock game used to test the interface without launching Cyberpunk.
// The state format matches the state.json file written by the CET mod.
'use strict';

const TXT = {
  'en-us': {
    previews: ['Got a job for you. Call me.', 'Your implants are in.', 'Payment sent.', '', "Don't look for me again.", 'New car for sale.'],
    districts: ['Little China', 'Kabuki', 'Corpo Plaza', 'Japantown', 'Vista del Rey'],
    garage: 'Sato Garage',
  },
};
let lang = 'en-us';
const T = () => TXT[lang] || TXT['en-us'];

const s = {
  v: 1,
  inGame: true,
  lang,
  player: { money: 248250, level: 27, streetCred: 34, timeH: 21, timeM: 47, day: 62, health: 86, inVehicle: true },
  vehicles: [
    { id: 'Vehicle.mock_coupe', name: 'Vesper GT-9', maker: 'Halcyon', type: 'car', info: { hp: 640, mass: 1450, drive: 'RWD', year: '2069', seats: 2, info: 'A fictional mock coupe used only by the simulator.' } },
    { id: 'Vehicle.mock_muscle', name: 'Ironside 440', maker: 'Rourke Motors', type: 'car' },
    { id: 'Vehicle.mock_van', name: 'Mulekick Cargo', maker: 'Tasaki', type: 'car' },
    { id: 'Vehicle.mock_hyper', name: 'Spectra Zero', maker: 'Arclight', type: 'car' },
    { id: 'Vehicle.mock_bike', name: 'Razorwind', maker: 'Kitsune', type: 'bike' },
    { id: 'Vehicle.mock_bike2', name: 'Dustjack 250', maker: 'Rourke Motors', type: 'bike' },
  ],
  contacts: [],
  activeVehicle: null,
  call: { state: 'idle', contact: null },
  pos: { x: 0, y: 0, z: 20, yaw: 0 },
  district: '',
  pois: [],
  poisStatus: 'ok',
  waypoint: null,
  journal: { tracked: null, quests: [] },
  vehicle: { inside: false, name: 'Vesper GT-9', speed: 0, autodrive: false, adAvailable: false },
  radio: { src: 'vehicle', on: true, station: 'Neon Static FM', track: 'Glass Arcades', idx: 2 },
  stations: [
    'Static Bloom 88.1', 'Riptide Radio', 'Neon Static FM', 'Chrome Hymns', 'Night Shift 99.9',
    'Backalley Bass', 'Vapor Lanes', 'Pacific Drift', 'Iron Choir', 'Lowtide Jazz',
  ].map((name, i) => ({ station: i, ui: i, name })),
  carColor: null,
  immersive: false,
  immHud: ['minimap','healthbar','stamina_oxygen','ammo_counter','quest_tracker','hud_markers','vehicle_hud'].map((n) => ({ n })),
  thread: null,
  questDetail: null,
  subs: null,
  offers: [],
  apartments: [],
  sites: [],
  acks: [],
};
const TRACKS = ['Glass Arcades', 'Rust Halo', 'Afterglow Protocol', 'Sodium Rain', 'Heat Sink', 'Ghosts in the Grid', 'Overpass Lullaby'];

const QUESTS = {
  'en-us': [
    ['q1', 'main', 'Ghost Line', 'Find the contact under the Kabuki overpass', 820],
    ['q2', 'main', 'Dead Code', 'Talk to the netrunner at the Afterlife', 2400],
    ['q3', 'side', 'Chrome and Rust', 'Drive the car to the garage', 640],
    ['q4', 'side', 'Long Night', 'Wait until 10 PM', null],
    ['q5', 'side', 'Broken Bird', 'Investigate the apartment', 1300],
    ['q6', 'gig', 'Gig: Hot Cargo', 'Steal the chip from the safe', 430],
    ['q7', 'gig', 'Gig: No Witnesses', 'Neutralize the target', 1900],
    ['q8', 'other', 'Cyberpsycho Sighting', 'Investigate the area', 760],
  ],
};
function buildJournal() {
  const list = QUESTS[lang] || QUESTS['en-us'];
  s.journal.quests = list.map(([id, group, title, objective, dist]) => ({ id, group, title, objective, dist }));
  if (!s.journal.tracked) s.journal.tracked = 'q1';
  s.journal.quests.push({ id: 'qcap', group: 'side', title: 'Just Another Story', objective: 'Deliver the car to the drop-off', dist: 900, cap: true });
  s.journal.cap = { intro: true, done: 3, failed: 1, jobs: [] };
}

const THREADS = {
  'en-us': {
    mock_rhea: { msgs: [['n', 'Hey. Got a job for you.', 61, 22, 10], ['m', 'What kind of job?', 61, 22, 14], ['n', 'The kind that pays well and asks no questions. Call me.', 62, 3, 41]],
      choices: [['c1', 'Deal. Calling in 5.', true], ['c2', "Can't right now."]], reply: 'Perfect. Waiting.' },
    mock_fixer: { msgs: [['n', 'Payment sent. Nice work at the docks.', 62, 5, 23]], choices: [['c3', 'Thanks, Nine.']], reply: 'Anytime.' },
    mock_doc: { msgs: [['n', 'Your implants arrived. Swing by the clinic.', 60, 11, 55], ['m', 'Tomorrow morning.', 60, 12, 2]], choices: [] },
    mock_taro: { msgs: [['n', 'You see what went down in Japantown?', 59, 23, 18]], choices: [['c4', 'I did. Crazy.'], ['c5', 'No, what happened?']], reply: "I'll tell you in person." },
  },
};
let threadData = {};
let openThread = null;
let pendingNpc = null;
function buildThreads() {
  threadData = {};
  for (const [id, th] of Object.entries(THREADS[lang] || THREADS['en-us'])) {
    threadData[id] = {
      messages: th.msgs.map(([who, text, d, h, m], i) => ({ id: id + i, text, me: who === 'm', t: { d, h, m }, read: true })),
      choices: (th.choices || []).map(([cid, text, important]) => ({ id: cid, text, important: !!important })),
      reply: th.reply,
    };
  }
}
function threadState() {
  if (!openThread || !threadData[openThread]) return openThread ? { contact: openThread, messages: [], choices: [] } : null;
  const d = threadData[openThread];
  return { contact: openThread, messages: d.messages, choices: d.choices };
}

const SUB_LINES = {
  'en-us': ['Finally picked up. Listen carefully.', "There's a shipment leaving the docks tonight.", 'Arasaka wants it back. We want it first.', "I'm sending coordinates. Don't be late."],
};
let subIdx = 0, subAt = 0, subSeq = 0, subLog = [];

function buildShop() {
  s.offers = [
    { id: 'Vehicle.offer_vesper', name: 'Vesper GT-9', brand: 'halcyon', brandName: 'Halcyon', price: 98000, available: true, owned: false, img: { part: 'judy' } },
    { id: 'Vehicle.offer_ironside', name: 'Ironside 440', brand: 'rourke', brandName: 'Rourke Motors', price: 54000, available: true, owned: true, img: { part: 'padre' } },
    { id: 'Vehicle.offer_spectra', name: 'Spectra Zero', brand: 'arclight', brandName: 'Arclight', price: 312000, available: true, owned: false, img: { part: 'regina' } },
    { id: 'Vehicle.offer_mule', name: 'Mulekick Cargo', brand: 'tasaki', brandName: 'Tasaki', price: 41000, available: true, owned: false, img: { part: 'misty' } },
    { id: 'Vehicle.offer_razor', name: 'Razorwind', brand: 'kitsune', brandName: 'Kitsune', price: 27000, available: true, owned: false },
    { id: 'Vehicle.offer_cap1', name: 'Mock Courier One', brand: 'halcyon', brandName: 'Halcyon', price: 87000, available: true, owned: false, cap: true, desc: 'Simulated El Capitan reward.' },
    { id: 'Vehicle.offer_cap2', name: 'Mock Courier Two', brand: 'tasaki', brandName: 'Tasaki', price: 105000, available: false, owned: false, cap: true },
    { id: 'Vehicle.offer_cap3', name: 'Mock Courier Three', brand: 'rourke', brandName: 'Rourke Motors', price: 43000, available: true, owned: true, cap: true },
  ];
  s.apartments = [
    { id: 'apt_1', name: 'Northside Industrial', price: 45000 },
    { id: 'apt_2', name: 'Japantown Loft', price: 220000 },
    { id: 'apt_3', name: 'Corpo Plaza Suite', price: 410000 },
  ];
  s.sites = [{ id: 's1', name: 'Night City Today' }, { id: 's2', name: 'Kang Tao Weapons' }, { id: 's3', name: 'Blue Moon Diner' }];
}

function buildContacts() {
  const p = T().previews;
  s.contacts = [
    { id: 'mock_rhea', name: 'Rhea Kovač', callable: true, unread: 2, preview: p[0], quest: true, avatar: 'regina', messages: true, t: { d: 62, h: 3, m: 41 } },
    { id: 'mock_doc', name: 'Doc Mendel', callable: true, unread: 0, preview: p[1], quest: false, avatar: 'padre', messages: true, t: { d: 60, h: 12, m: 2 } },
    { id: 'mock_fixer', name: 'Ozzie "Nine" Tran', callable: true, unread: 1, preview: p[2], quest: false, avatar: 'judy', messages: true, t: { d: 62, h: 5, m: 23 } },
    { id: 'mock_taro', name: 'Taro', callable: true, unread: 0, preview: p[3] || '...', quest: false, avatar: 'misty', messages: true, t: { d: 59, h: 23, m: 18 } },
    { id: 'mock_vale', name: 'Vale', callable: false, unread: 0, preview: p[4], quest: false },
    { id: 'mock_garage', name: T().garage, callable: true, unread: 0, preview: p[5], quest: false },
  ];
}

// Fixed markers across the city (deterministic generator).
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const ALL_POIS = [];
const START_POI = { x: -610, y: 3210 };
const POI_MIX = {
  DefaultQuest: 4, DynamicEvent: 2,
  BountyHunt: 6, Retrieving: 5, Thievery: 7, Sabotage: 4, ClientInDistress: 5, Courier: 3, Convoy: 1, QuestGiver: 8,
  Fixer: 3, NCPDGig: 12, GangWatch: 30, Outpost: 7, HiddenStash: 10, HuntForPsycho: 6, Tarot: 9, Racing: 2,
  ServicePointDropPoint: 25, ServicePointClothes: 6, ServicePointRipperdoc: 6, ServicePointNetTrainer: 3,
  ServicePointGuns: 6, ServicePointMeleeTrainer: 2, ServicePointMeds: 5, ServicePointFood: 9, ServicePointBar: 6,
  ServicePointProstitute: 1, ServicePointJunk: 4, ServicePointTech: 3, ServicePointBlackMarket: 1,
  CarForPurchase: 6, MotorcycleForPurchase: 3,
  FastTravel: 40, NCART: 8, DelamainTaxi: 5, Apartment: 2, PlayerStash: 2,
};
for (const [v, n] of Object.entries(POI_MIX)) {
  for (let i = 0; i < n; i++) {
    const r = rnd();
    ALL_POIS.push({ v, x: Math.round(START_POI.x + (rnd() - 0.5) * 5200), y: Math.round(START_POI.y + (rnd() - 0.5) * 5200), z: Math.round(rnd() * 60),
      ph: v === 'DefaultQuest' ? 'd' : r < 0.18 ? 'u' : r < 0.3 ? 'c' : 'd' });
  }
}

// Route: follows the game's actual road segments (web/map3d/roads.bin).
const fs = require('fs');
const path = require('path');
const SPEED = 18;
let ROADS = null;
try {
  const dir = path.join(__dirname, '..', 'web', 'map3d');
  const man = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')).roads;
  const buf = fs.readFileSync(path.join(dir, 'roads.bin'));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const T = { '<f4': Float32Array, '<u4': Uint32Array, '<u2': Uint16Array, '|u1': Uint8Array };
  ROADS = {};
  for (const [k, a] of Object.entries(man.arrays)) ROADS[k] = new T[a.type](ab, a.offset, a.length);
} catch { ROADS = null; }

function lanePts(i) {
  const o = ROADS.laneOffset[i], c = ROADS.laneCount[i], P = ROADS.points, out = [];
  for (let k = 0; k < c; k++) out.push([P[(o + k) * 3], P[(o + k) * 3 + 1], P[(o + k) * 3 + 2]]);
  return out;
}
function nearestMainLane(x, y) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < ROADS.laneMain.length; i++) {
    if (!ROADS.laneMain[i]) continue;
    const o = ROADS.laneOffset[i];
    const d = Math.hypot(ROADS.points[o * 3] - x, ROADS.points[o * 3 + 1] - y);
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}
let lane = 0, path_ = [[0, 0, 0], [10, 0, 0]], seg = 0, along = 0;
const START = { x: -610, y: 3210 }; // Northside
if (ROADS) { lane = nearestMainLane(START.x, START.y); path_ = lanePts(lane); }
function nextLane() {
  const a = ROADS.outStart[lane], b = ROADS.outStart[lane + 1];
  const outs = [];
  for (let k = a; k < b; k++) if (ROADS.laneMain[ROADS.outLanes[k]]) outs.push(ROADS.outLanes[k]);
  lane = outs.length ? outs[Math.floor(rnd() * outs.length)] : nearestMainLane(s.pos.x + 50, s.pos.y + 50);
  path_ = lanePts(lane); seg = 0; along = 0;
}

function updatePois() {
  const { x, y } = s.pos;
  const withD = ALL_POIS.map((p) => ({ ...p, d: Math.hypot(p.x - x, p.y - y) })).sort((a, b) => a.d - b.d);
  const per = {};
  s.pois = withD
    .filter((p) => { per[p.v] = (per[p.v] || 0) + 1; return p.d <= 2500 || per[p.v] <= 4; })
    .map(({ d, ...p }) => p);
}

let pendingAnswer = null;
let nextRing = Date.now() + 15000;   // a Rhea liga 15 s depois de abrir, e de novo a cada 90 s
let ringUntil = 0;
let minuteAcc = 0;

function tick(dt) {
  // Clock: one in-game minute per real second.
  minuteAcc += dt;
  while (minuteAcc >= 1) {
    minuteAcc -= 1;
    const p = s.player;
    p.timeM += 1;
    if (p.timeM >= 60) { p.timeM = 0; p.timeH = (p.timeH + 1) % 24; }
  }
  // Movement along the lanes.
  const speed = s.vehicle.inside ? (s.vehicle.autodrive ? 14 : SPEED) : 1.6;
  let step = speed * dt, guard = 0;
  while (step > 0 && guard++ < 200) {
    if (seg >= path_.length - 1) { if (ROADS) nextLane(); else { seg = 0; } continue; }
    const [ax, ay, az] = path_[seg], [bx, by, bz] = path_[seg + 1];
    const len = Math.hypot(bx - ax, by - ay) || 1e-3;
    const take = Math.min(step, len - along);
    along += take; step -= take;
    const t = along / len;
    s.pos.x = ax + (bx - ax) * t;
    s.pos.y = ay + (by - ay) * t;
    s.pos.z = az + (bz - az) * t;
    // Assumed game convention: yaw 0 = north (+Y), positive = counterclockwise.
    if (len > 0.05) s.pos.yaw = (Math.atan2(-(bx - ax), by - ay) * 180) / Math.PI;
    if (along >= len - 1e-6) { seg++; along = 0; }
  }
  s.vehicle.speed = Math.round(speed * 3.6 * (0.9 + rnd() * 0.2));
  if (s.waypoint) {
    const d = Math.hypot(s.waypoint.x - s.pos.x, s.waypoint.y - s.pos.y);
    s.vehicle.adDist = Math.round(d * 1.3);
    s.vehicle.adEta = Math.round((d * 1.3) / 14);
  } else { delete s.vehicle.adDist; delete s.vehicle.adEta; }
  s.vehicle.adAvailable = !!s.waypoint;
  // The tracked job is the first job objective in the list.
  const qObj = ALL_POIS.find((p) => p.v === 'DefaultQuest');
  const tq = s.journal.quests.find((q) => q.id === s.journal.tracked);
  if (qObj && tq) tq.dist = Math.round(Math.hypot(qObj.x - s.pos.x, qObj.y - s.pos.y));
  // Radio: changes tracks occasionally.
  if (s.radio.on && rnd() < dt / 40) s.radio.track = TRACKS[Math.floor(rnd() * TRACKS.length)];
  s.district = T().districts[Math.abs(Math.floor((s.pos.x + 1000) / 450)) % T().districts.length];
  updatePois();
  if (s.call.state === 'idle' && Date.now() > nextRing) {
    s.call = { state: 'incoming', contact: 'mock_rhea', rejectable: true };
    ringUntil = Date.now() + 30000;
    nextRing = Date.now() + 90000;
  }
  if (s.call.state === 'incoming' && Date.now() > ringUntil) s.call = { state: 'idle', contact: null };
  if (s.call.state === 'calling' && pendingAnswer && Date.now() > pendingAnswer) {
    s.call.state = 'active';
    pendingAnswer = null;
  }
  // Subtitles: one line about every three seconds while a call is active.
  const lines = SUB_LINES[lang] || SUB_LINES['en-us'];
  if (s.call.state === 'active' && Date.now() > subAt && subIdx < lines.length) {
    const c = s.contacts.find((x) => x.id === s.call.contact);
    subSeq++;
    subLog.push({ text: lines[subIdx++], speaker: c ? c.name : '', seq: subSeq });
    subAt = Date.now() + 3200;
  }
  if (s.call.state === 'idle') { subIdx = 0; if (subLog.length && Date.now() > subAt + 8000) subLog = []; }
  s.subs = subLog.length ? { now: subLog[subLog.length - 1], log: subLog.slice() } : null;
  if (pendingNpc && Date.now() > pendingNpc.at) {
    const d = threadData[pendingNpc.id];
    if (d && d.reply) d.messages.push({ id: pendingNpc.id + 'r', text: d.reply, me: false, t: { d: s.player.day, h: s.player.timeH, m: s.player.timeM } });
    pendingNpc = null;
  }
  s.thread = threadState();
}

function run(action, arg) {
  if (action === 'summon') {
    const v = s.vehicles.find((x) => x.id === arg);
    if (!v) return { ok: false, msg: 'not_found' };
    s.activeVehicle = v.id;
    return { ok: true, msg: 'ok' };
  }
  if (action === 'call') {
    const c = s.contacts.find((x) => x.id === arg);
    if (!c) return { ok: false, msg: 'not_found' };
    if (!c.callable) return { ok: false, msg: 'game_refused' };
    s.call = { state: 'calling', contact: c.id };
    pendingAnswer = Date.now() + 3500;
    c.unread = 0;
    return { ok: true, msg: 'ok' };
  }
  if (action === 'mock_ring') { nextRing = 0; return { ok: true, msg: 'ok' }; }
  if (action === 'mock_car') { s.vehicle.inside = !s.vehicle.inside; return { ok: true, msg: 'ok' }; }
  if (action === 'call_answer') {
    if (s.call.state !== 'incoming') return { ok: false, msg: 'no_incoming' };
    s.call = { state: 'active', contact: s.call.contact };
    return { ok: true, msg: 'answered' };
  }
  if (action === 'call_reject') {
    if (s.call.state !== 'incoming') return { ok: false, msg: 'no_incoming' };
    s.call = { state: 'idle', contact: null };
    return { ok: true, msg: 'rejected' };
  }
  if (action === 'hangup') {
    s.call = { state: 'idle', contact: null };
    pendingAnswer = null;
    return { ok: true, msg: 'ok' };
  }
  if (action === 'waypoint') {
    const m = String(arg || '').match(/^([-\d.]+),([-\d.]+),([-\d.]+),?(\w*)/);
    if (!m) return { ok: false, msg: 'bad_args' };
    s.waypoint = { x: +m[1], y: +m[2], z: +m[3], cat: m[4] || null };
    return { ok: true, msg: 'waypoint_set' };
  }
  if (action === 'clearwp') { s.waypoint = null; return { ok: true, msg: 'ok' }; }
  if (action === 'track') {
    if (!s.journal.quests.some((q) => q.id === arg)) return { ok: false, msg: 'not_found' };
    if (arg === 'q4') return { ok: false, msg: 'no_objective' };
    s.journal.tracked = arg;
    return { ok: true, msg: 'tracked' };
  }
  if (action === 'untrack') { s.journal.tracked = null; return { ok: true, msg: 'untracked' }; }
  const R = s.radio;
  if (action === 'radio_on') { R.on = true; return { ok: true, msg: 'ok' }; }
  if (action === 'radio_off') { R.on = false; return { ok: true, msg: 'ok' }; }
  if (action === 'radio_set' || action === 'radio_next' || action === 'radio_prev') {
    let i = action === 'radio_set' ? Number(arg) : (R.idx + (action === 'radio_next' ? 1 : -1) + s.stations.length) % s.stations.length;
    const st = s.stations.find((x) => x.station === i);
    if (!st) return { ok: false, msg: 'bad_args' };
    R.idx = i; R.station = st.name; R.on = true; R.track = TRACKS[Math.floor(rnd() * TRACKS.length)];
    return { ok: true, msg: 'ok' };
  }
  if (action === 'ad_start') {
    if (!s.waypoint) return { ok: false, msg: 'no_destination' };
    s.vehicle.autodrive = true; return { ok: true, msg: 'ok' };
  }
  if (action === 'ad_quest') { s.waypoint = null; s.vehicle.autodrive = true; return { ok: true, msg: 'quest_route' }; }
  if (action === 'ad_stop') { s.vehicle.autodrive = false; return { ok: true, msg: 'ok' }; }
  if (action === 'color') { s.carColor = arg; return { ok: true, msg: 'color_set' }; }
  if (action === 'color_reset') { s.carColor = null; return { ok: true, msg: 'color_reset' }; }
  if (action === 'horn') return { ok: true, msg: 'ok' };
  if (action === 'thread') { openThread = arg; const c = s.contacts.find((x) => x.id === arg); if (c) c.unread = 0; s.thread = threadState(); return { ok: true, msg: 'ok' }; }
  if (action === 'thread_close') { openThread = null; s.thread = null; return { ok: true, msg: 'ok' }; }
  if (action === 'reply') {
    const d = threadData[openThread];
    const ch = d && d.choices.find((x) => x.id === arg);
    if (!ch) return { ok: false, msg: 'no_reply' };
    d.messages.push({ id: arg, text: ch.text, me: true, t: { d: s.player.day, h: s.player.timeH, m: s.player.timeM } });
    d.choices = [];
    pendingNpc = { id: openThread, at: Date.now() + 2500 };
    s.thread = threadState();
    return { ok: true, msg: 'replied' };
  }
  if (action === 'quest_details') {
    const q = s.journal.quests.find((x) => x.id === arg);
    if (!q) return { ok: false, msg: 'not_found' };
    s.questDetail = { id: q.id, level: 22 + q.title.length % 12, district: s.district,
      description: 'A trusted source passed on the location. The rest is up to you — and whoever gets there first.',
      objectives: [{ text: q.objective, state: 'Active' }, { text: 'Talk to the informant', state: 'Succeeded' }, { text: 'Recover the data (optional)', state: 'Active', optional: true, count: 1, total: 3 }] };
    return { ok: true, msg: 'ok' };
  }
  if (action === 'quest_details_close') { s.questDetail = null; return { ok: true, msg: 'ok' }; }
  if (action === 'buy') {
    const o = s.offers.find((x) => x.id === arg);
    if (!o) return { ok: false, msg: 'not_found' };
    if (o.owned) return { ok: false, msg: 'already_owned' };
    if (s.player.money < o.price) return { ok: false, msg: 'no_money' };
    s.player.money -= o.price; o.owned = true;
    return { ok: true, msg: 'purchased' };
  }
  if (action === 'immersive_on') { s.immersive = true; return { ok: true, msg: 'immersive_on' }; }
  if (action === 'immersive_off') { s.immersive = false; return { ok: true, msg: 'immersive_off' }; }
  if (action === 'imm_all') { for (const e of s.immHud) e.h = arg === '1' || undefined; return { ok: true, msg: 'ok' }; }
  if (action === 'imm_toggle') { const e = s.immHud.find((x) => x.n === arg); if (!e) return { ok: false, msg: 'bad_arg' }; e.h = !e.h || undefined; return { ok: true, msg: 'ok' }; }
  if (action === 'photo_mode') return { ok: true, msg: 'photo_mode' };
  return { ok: true, msg: 'ok' };
}

function setLang(l) {
  lang = String(l).toLowerCase();
  s.lang = lang;
  buildContacts();
  buildJournal();
  buildThreads();
  buildShop();
  tick(0);
}

buildContacts();
buildJournal();
buildThreads();
buildShop();
tick(0);

module.exports = { tick, run, setLang, state: () => JSON.parse(JSON.stringify(s)) };
