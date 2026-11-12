// Map filters: the same groups and categories as the community interactive map
// (cyberpunk2077-map.com), plus a few types found only in game version 2.x.
// Each filter lists game marker types (gamedataMappinVariant, without the
// entries with the "Variant" suffix and without the "Zzz##_" prefix are grouped here.
'use strict';

const FILTER_GROUPS = [
  {
    id: 'quest', color: '#f7e05a', shape: 'diamond', label: { en: 'ACTIVE JOBS' },
    filters: [
      { id: 'quest_obj', v: ['DefaultQuest'], extra: true, label: { en: 'Job Objective' } },
      { id: 'quest_other', v: ['DynamicEvent', 'Conversation', 'PhoneCall'], extra: true, color: '#ffd27a', label: { en: 'Job Point' } },
    ],
  },
  {
    id: 'job', color: '#f7e05a', shape: 'diamond', label: { en: 'JOB' },
    filters: [
      { id: 'gun_for_hire', v: ['BountyHunt'], quick: 'gig', label: { en: 'Gun for Hire' } },
      { id: 'search_recover', v: ['Retrieving'], quick: 'gig', label: { en: 'Search and Recover' } },
      { id: 'thievery', v: ['Thievery'], quick: 'gig', label: { en: 'Thievery' } },
      { id: 'saboteur', v: ['Sabotage'], quick: 'gig', label: { en: 'Agent Saboteur' } },
      { id: 'sos', v: ['ClientInDistress', 'SOSsignal'], quick: 'gig', label: { en: 'SOS: Merc Needed' } },
      { id: 'delivery', v: ['Courier'], quick: 'gig', extra: true, label: { en: 'Special Delivery' } },
      { id: 'capitan', v: ['CourierSandboxActivity'], quick: 'gig', label: { en: 'Vehicle contract (El Capitan)' } },
      { id: 'convoy', v: ['Convoy'], quick: 'gig', label: { en: 'Convoy' } },
      { id: 'side_job', v: ['QuestGiver', 'ExclamationMark'], quick: 'side', color: '#ffb347', label: { en: 'Side Job' } },
    ],
  },
  {
    id: 'open', color: '#4f8bff', shape: 'diamond', label: { en: 'OPEN WORLD' },
    filters: [
      { id: 'ncpd_hustles', v: ['NCPDGig'], quick: 'ncpd', label: { en: 'NCPD Scanner Hustles' } },
      { id: 'assault', v: ['GangWatch'], quick: 'ncpd', label: { en: 'Assault in Progress' } },
      { id: 'organized_crime', v: ['Outpost'], quick: 'ncpd', label: { en: 'Organized Crime Activity' } },
      { id: 'reported_crime', v: ['HiddenStash'], quick: 'ncpd', label: { en: 'Reported Crime' } },
      { id: 'cyberpsycho', v: ['HuntForPsycho'], quick: 'ncpd', color: '#ff4d6d', label: { en: 'Cyberpsycho Sighting' } },
      { id: 'undiscovered', v: ['QuestionMark'], quick: 'ncpd', extra: true, label: { en: 'Undiscovered Activity' } },
      { id: 'tarot', v: ['Tarot'], quick: 'tarot', color: '#c77dff', label: { en: 'Tarot Card' } },
      { id: 'racing', v: ['Racing'], extra: true, label: { en: 'Street Race' } },
      { id: 'encounter', v: ['WorldEncounter', 'RoadBlockade'], extra: true, label: { en: 'World Encounter' } },
      { id: 'relic', v: ['RelicDeviceBasic', 'RelicDeviceSpecial'], extra: true, label: { en: 'Relic Point' } },
    ],
  },
  {
    id: 'service', color: '#2bfdb1', shape: 'square', label: { en: 'SERVICE POINT' },
    filters: [
      { id: 'drop_point', v: ['ServicePointDropPoint'], color: '#d8dde6', label: { en: 'Drop Point' } },
      { id: 'clothing', v: ['ServicePointClothes'], label: { en: 'Clothing' } },
      { id: 'ripperdoc', v: ['ServicePointRipperdoc', 'ServicePointCyberware'], label: { en: 'Ripperdoc' } },
      { id: 'netrunner', v: ['ServicePointNetTrainer'], label: { en: 'Netrunner' } },
      { id: 'weapon_shop', v: ['ServicePointGuns'], label: { en: 'Weapon Shop' } },
      { id: 'melee', v: ['ServicePointMeleeTrainer'], label: { en: 'Melee Weapon Vendor' } },
      { id: 'medpoint', v: ['ServicePointMeds'], label: { en: 'Medpoint' } },
      { id: 'food', v: ['ServicePointFood'], label: { en: 'Food' } },
      { id: 'bar', v: ['ServicePointBar'], label: { en: 'Bar' } },
      { id: 'joytoy', v: ['ServicePointProstitute'], label: { en: 'Joytoy' } },
      { id: 'junk', v: ['ServicePointJunk'], label: { en: 'Junk Shop' } },
      { id: 'tech', v: ['ServicePointTech'], extra: true, label: { en: 'Tech Vendor' } },
      { id: 'black_market', v: ['ServicePointBlackMarket'], extra: true, label: { en: 'Black Market' } },
      { id: 'glamdoc', v: ['ServicePointGlamdoc'], extra: true, label: { en: 'Glamdoc' } },
      { id: 'merchant', v: ['WanderingMerchant'], extra: true, label: { en: 'Wandering Merchant' } },
    ],
  },
  {
    id: 'vehicle', color: '#ff8a5c', shape: 'circle', label: { en: 'VEHICLE' },
    filters: [
      { id: 'vehicle_sale', v: ['CarForPurchase', 'MotorcycleForPurchase'], label: { en: 'Vehicle for Sale' } },
    ],
  },
  {
    id: 'other', color: '#c9d1e0', shape: 'circle', label: { en: 'OTHER' },
    filters: [
      { id: 'fast_travel', v: ['FastTravel'], color: '#3f8cff', label: { en: 'Fast Travel' } },
      { id: 'ncart', v: ['NCART'], color: '#9a6bff', extra: true, label: { en: 'NCART Station' } },
      { id: 'taxi', v: ['DelamainTaxi'], extra: true, label: { en: 'Delamain Cab' } },
      { id: 'apartment', v: ['Apartment', 'ApartmentToPurchase'], extra: true, label: { en: 'Apartment' } },
      { id: 'stash', v: ['PlayerStash', 'Wardrobe'], extra: true, label: { en: 'Stash / Wardrobe' } },
    ],
  },
];

// Website categories that are not in-game markers and cannot be read by the mod.
const FILTERS_UNAVAILABLE = {
  en: ['Landmark', 'Legendary / Iconic items'],
};

// Dynamic filter (like the in-game map): tier 0 appears at every zoom level (jobs and gigs);
// tier 1 at medium zoom (fast travel, metro, NCPD); tier 2 only at close range (shops and services).
const TIER_GROUP = { quest: 0, job: 0, open: 1, service: 2, vehicle: 2, other: 2 };
const TIER_FILTER = { fast_travel: 1, ncart: 1, cyberpsycho: 0, ncpd_hustles: 1, drop_point: 1, apartment: 1 };
// Filter modes: dynamic (everything, by zoom), jobs, services or a custom list.
const FILTER_MODES = ['dynamic', 'jobs', 'services', 'custom'];
const MODE_GROUPS = { jobs: ['quest', 'job', 'open'], services: ['service', 'vehicle', 'other'] };
const MODE_STORE = 'neuroport.filters.mode';
let filterMode = 'dynamic';
try { const m = localStorage.getItem(MODE_STORE); if (FILTER_MODES.includes(m)) filterMode = m; } catch { /* ok */ }
function setFilterMode(m) {
  filterMode = m;
  try { localStorage.setItem(MODE_STORE, m); } catch { /* ok */ }
}
// Should this marker appear in the current mode? (dynamic zoom is applied by the map.)
function filterShows(p) {
  const f = FILTER_BY_ID[p.f];
  if (!f) return false;
  if (filterMode === 'custom') return filterOn(p.f);
  if (filterMode === 'dynamic') return true;
  if (filterMode === 'jobs' && f.id === 'tarot') return false;
  return MODE_GROUPS[filterMode].includes(f.group.id);
}

const GIG_AVAILABLE = '#3ee0c8';
const FILTER_BY_ID = {};
const FILTER_BY_VARIANT = {};
for (const g of FILTER_GROUPS) {
  for (const f of g.filters) {
    f.group = g;
    f.color = f.color || g.color;
    f.shape = g.shape;
    f.tier = TIER_FILTER[f.id] ?? TIER_GROUP[g.id] ?? 1;
    FILTER_BY_ID[f.id] = f;
    for (const v of f.v) FILTER_BY_VARIANT[v] = f;
  }
}

// Add filter, Quick Gig category, color and shape to each marker.
function enrichPoi(p) {
  const f = FILTER_BY_VARIANT[p.v];
  if (!f) return null;
  const color = f.quick === 'gig' ? (p.q ? '#f7e05a' : GIG_AVAILABLE) : f.color;
  return { ...p, f: f.id, cat: f.quick || null, color, shape: f.shape, tier: f.tier };
}

// Enabled filters (saved locally). All filters are enabled by default.
const FILTER_STORE = 'neuroport.filters.off';
let filtersOff = new Set();
try { filtersOff = new Set(JSON.parse(localStorage.getItem(FILTER_STORE) || '[]')); } catch { /* Storage is unavailable */ }
function saveFilters() {
  try { localStorage.setItem(FILTER_STORE, JSON.stringify([...filtersOff])); } catch { /* ok */ }
}
const filterOn = (id) => !filtersOff.has(id);

// In-game marker icons (extracted from the mappin atlas: web/mapicons/<Variant>.png).
// These are white glyphs; here they become colored glyphs on a dark disc, like the in-game map.
const MAP_ICON_IMG = new Map();      // Variant -> Image (null when unavailable).
const MAP_ICON_CANVAS = new Map();   // Variant|color|size -> cached canvas.
function mapIconImage(v, onReady) {
  let img = MAP_ICON_IMG.get(v);
  if (img === undefined) {
    img = new Image();
    img.waiting = [];
    img.onload = () => { img.ok = true; for (const cb of img.waiting.splice(0)) cb(); };
    img.onerror = () => { MAP_ICON_IMG.set(v, null); };
    img.src = 'mapicons/' + v + '.png';
    MAP_ICON_IMG.set(v, img);
  }
  if (!img) return null;
  if (img.ok) return img;
  if (onReady) img.waiting.push(onReady);
  return null;
}
// As on the in-game map, these appear as colored glyphs only (without a disc).
const GLYPH_ONLY = /^(FastTravel|NCART|ServicePointDropPoint|Apartment|ApartmentToPurchase)$/;
// Draw the marker in 2D: dark disc, ring and glyph in the filter color.
function drawMapIcon(g, img, color, cx, cy, size, selected, v) {
  const r = size / 2;
  g.save();
  if (v && GLYPH_ONLY.test(v)) {
    g.shadowColor = 'rgba(0,0,0,.9)'; g.shadowBlur = size * 0.12;
    g.drawImage(tintedIcon(img, color), cx - r, cy - r, size, size);
    if (selected) { g.shadowColor = color; g.shadowBlur = size * 0.3; g.drawImage(tintedIcon(img, color), cx - r, cy - r, size, size); }
    g.restore();
    return;
  }
  g.shadowColor = color; g.shadowBlur = size * (selected ? 0.4 : 0.15);
  g.fillStyle = 'rgba(8,10,16,.88)';
  g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
  g.shadowBlur = 0;
  g.strokeStyle = color; g.lineWidth = Math.max(1, size * (selected ? 0.1 : 0.06));
  g.stroke();
  g.drawImage(tintedIcon(img, color), cx - r * 0.74, cy - r * 0.74, r * 1.48, r * 1.48);
  g.restore();
}
function tintedIcon(img, color) {
  const k = img.src + color;
  let c = MAP_ICON_CANVAS.get(k);
  if (c) return c;
  c = document.createElement('canvas');
  const s = 128;
  c.width = c.height = s;
  const g = c.getContext('2d');
  const sc = Math.min(s / img.width, s / img.height);
  const w = img.width * sc, h = img.height * sc;
  g.drawImage(img, (s - w) / 2, (s - h) / 2, w, h);
  g.globalCompositeOperation = 'multiply';
  g.fillStyle = color;
  g.fillRect(0, 0, s, s);
  g.globalCompositeOperation = 'destination-in';
  g.drawImage(img, (s - w) / 2, (s - h) / 2, w, h);
  MAP_ICON_CANVAS.set(k, c);
  return c;
}
