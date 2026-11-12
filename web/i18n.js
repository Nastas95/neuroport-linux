// Interface strings. The game language is used where available; this release is English-only.
// The language is fixed to English, regardless of the in-game or browser language.
'use strict';

const I18N = {
  en: {
    pairTag: '// NEURAL LINK',
    pairText: 'Enter the pairing code shown in the server window on your PC.',
    connect: 'CONNECT',
    badCode: 'Invalid code',
    location: 'LOCATION',
    lvl: 'LVL',
    linkOn: 'LINK ACTIVE', linkIdle: 'NO GAME', linkWait: 'CONNECTING',
    tabContacts: 'CONTACTS', tabVehicles: 'VEHICLES', tabMap: 'MAP',
    contactsTitle: 'CONTACTS',
    noContacts: 'No contacts available.',
    callVehicle: 'CALL VEHICLE',
    cars: 'CARS', bikes: 'BIKES',
    elCap: 'CAPITAN', elCapFull: 'EL CAPITAN', capFind: 'SHOW ALL POSSIBLE LOCATIONS', capExit: 'EXIT',
    capFindNote: 'Contracts spawn at fixed spots (mostly in Dogtown) at random times. The map shows the ones marked now (cyan), every spot where one appeared in your game (purple) and the areas from player guides (orange).',
    capLive: '{n} contract(s) on the map now', capSpotsN: '{n} known spot(s)', capSpotsOnly: 'No contract now · {n} known spot(s)',
    capNoSpots: 'No contract now and none seen yet: look around Dogtown', capGuideSpot: 'GUIDE AREA · EL CAPITAN CONTRACT', capSpotSeen: 'POSSIBLE SPOT · SEEN {n}×', capLiveNow: 'EL CAPITAN · AVAILABLE NOW',
    capTitle: 'EL CAPITAN // VEHICLE CONTRACTS', capIntroDone: 'Push It to the Limit complete', capIntroTodo: 'Not started: finish Push It to the Limit (Dogtown, after Lucretia My Reflection)',
    capDone: 'CONTRACTS DONE', capFailed: 'FAILED', capActive: 'ACTIVE CONTRACT', capNone: 'none', capRewards: 'AUTOFIXER CARS UNLOCKED BY HIS CONTRACTS',
    capOwned: 'IN GARAGE', capAvail: 'AT AUTOFIXER', capLocked: 'LOCKED', capCount: '{a}/{b} in garage',
    capNote: 'Contract cars are random; finishing them unlocks these cars at the Autofixer.',
    vHp: 'HORSEPOWER', vMass: 'MASS', vDrive: 'DRIVETRAIN', vYear: 'YEAR', vTop: 'TOP SPEED', vAccel: 'ACCELERATION', vSeats: 'SEATS', vWeapons: 'WEAPONS',
    vMg: 'Machine guns', vRl: 'Missiles', vPrice: 'PRICE', vMaker: 'MAKER', vType: 'TYPE', untrackShort: 'Stop tracking',
    car: 'Car', bike: 'Motorcycle',
    noVehicles: 'No vehicles in this category.',
    active: 'ACTIVE',
    available: 'Available', unavailable: 'Unavailable',
    contact: 'CONTACT', contactQuest: 'CONTACT · JOB',
    lastMsg: 'LAST MESSAGE',
    back: 'BACK', call: 'CALL',
    holocall: 'HOLOCALL',
    calling: 'CALLING…', incoming: 'INCOMING CALL', onCall: 'ON CALL',
    hangup: 'END CALL', callEnded: 'Call ended',
    vehicleOnWay: '// VEHICLE INBOUND',
    summonFallback: 'Active vehicle inbound (could not switch model)',
    noSignal: 'NO SIGNAL',
    offlineGame: 'The game is not responding. Launch Cyberpunk 2077 with the Neuroport mod installed.',
    offlineSave: 'Game connected. Load a save to use the phone.',
    noPc: 'No connection to the PC',
    system: 'SYSTEM', error: 'ERROR', vehicle: 'VEHICLE', gps: 'GPS',
    err_not_found: 'Not found', err_game_refused: 'The game refused the request',
    err_load_save: 'Load a save first', err_unknown_action: 'Unknown action',
    err_mod_error: 'Mod error (see the CET overlay)', err_bad_args: 'Invalid position',
    err_timeout: 'No response from the game',
    // Quick Gig
    cat_ncpd: 'NCPD', cat_gig: 'GIG', cat_tarot: 'TAROT', cat_side: 'SIDE JOB',
    catLong_quest: 'Job Objective', catLong_ncpd: 'NCPD Scanner', catLong_gig: 'Fixer Gig', catLong_tarot: 'Tarot Graffiti', catLong_side: 'Side Job',
    nearestAny: 'NEAREST OF ALL',
    markGps: 'MARK ON GPS',
    nearby: 'NEARBY',
    gpsActive: 'GPS ROUTE',
    clear: 'CLEAR',
    waypointSet: 'Route set on GPS', waypointCleared: 'GPS route cleared',
    noneFound: 'Nothing found',
    inRange: (n) => `${n} within 1.5 km`,
    noCodeware: 'Reading map markers requires the Codeware mod. Install it and restart the game.',
    poisWaiting: 'Scanning the map…',
    customPoint: 'Custom point',
    // Map
    mapHint: 'Tap a marker or any point to set GPS',
    north: 'NORTH', heading: 'HEADING',
    you: 'You',
    tabJournal: 'JOURNAL', journalTitle: 'JOURNAL',
    filters: 'FILTERS', all: 'ALL', none: 'NONE', done: 'DONE',
    distance: 'DISTANCE', height: 'HEIGHT', coords: 'COORDINATES',
    trackedJob: 'TRACKED JOB', objective: 'OBJECTIVE', trackedTag: 'TRACKED',
    track: 'TRACK JOB', untrack: 'UNTRACK',
    jg_main: 'MAIN JOBS', jg_side: 'SIDE JOBS', jg_gig: 'GIGS', jg_other: 'OTHER',
    noQuests: 'No active jobs.', journalWaiting: 'Reading the journal…',
    questTracked: 'Job tracked', questUntracked: 'Job untracked',
    err_no_objective: 'This job has no active objective right now',
    notAvailable: 'Not readable from the game:',
    extra: 'GAME',
    fmode_dynamic: 'DYNAMIC', fmode_jobs: 'JOBS', fmode_services: 'SERVICES', fmode_custom: 'CUSTOM',
    fmodeDesc_dynamic: 'Like the game: more detail as you zoom in',
    fmodeDesc_jobs: 'Only active jobs, gigs and activities',
    fmodeDesc_services: 'Shops, drop points, food, travel',
    fmodeDesc_custom: 'Pick each category yourself',
    ftier0: 'ALWAYS', ftier1: 'MID ZOOM', ftier2: 'CLOSE',
    noObjective: 'No active objective',
    tabRadio: 'RADIO', radioTitle: 'RADIO', radioOff: 'RADIO OFF', pocketRadio: 'POCKET RADIO', carRadio: 'CAR RADIO',
    stations: 'STATIONS', nowPlaying: 'NOW PLAYING',
    carModeWidget: 'CAR MODE', carModeIn: 'Open navigation', carModeOut: 'Open (on foot)',
    carMode: 'CAR', exitCar: 'PHONE', carNav: 'NAV', carCar: 'CAR',
    adStart: 'AUTODRIVE', adStop: 'STOP AUTODRIVE', adQuest: 'DRIVE TO ACTIVE JOB', noTracked: 'No tracked job', questRoute: 'Autodrive to the active job', quickDest: 'QUICK DESTINATIONS',
    noDest: 'No destination. Pick one below or tap the map.', eta: 'ETA',
    paint: 'PAINT', primary: 'PRIMARY', secondary: 'SECONDARY', lights: 'LIGHTS',
    apply: 'APPLY', restore: 'RESTORE', horn: 'HORN',
    crystalNote: 'Only for vehicles with CrystalCoat',
    colorSet: 'Paint applied', colorReset: 'Paint restored',
    err_no_destination: 'Set a destination first', err_no_autodrive: 'Autodrive unavailable',
    err_not_in_vehicle: 'You are not in a vehicle',
    err_summon_cooldown: 'Vehicle on cooldown, try again shortly', err_summon_blocked: 'The game blocked the call here',
    mapLoading: 'LOADING NIGHT CITY…', mapLost: 'The phone dropped the 3D map (video memory); recovering…', mapFailed: 'Could not load the 3D map (radar mode)',
    remaining: 'to destination',
    recenter: 'RECENTER',
    answer: 'ANSWER', reject: 'DECLINE', silence: 'SILENCE RINGTONE',
    missedCall: (n) => `Missed call from ${n}`, callRejected: 'Call declined',
    err_no_incoming: 'The call is no longer ringing',
  },
};

let LANG = 'en';

function langFromGame(code) {
  return code ? 'en' : null;
}

function t(key, ...args) {
  const v = (I18N[LANG] && I18N[LANG][key]) ?? I18N.en[key] ?? key;
  return typeof v === 'function' ? v(...args) : v;
}

function applyI18n() {
  document.documentElement.lang = 'en';
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
}

function setLang(l) {
  if (!l || l === LANG) return false;
  LANG = l;
  applyI18n();
  return true;
}

function fmtDist(m) {
  if (m == null || !isFinite(m)) return '—';
  if (m < 1000) return `${Math.round(m / 10) * 10} m`;
  const km = (m / 1000).toFixed(1);
  return `${km} km`;
}

function fmtHeight(dz) {
  if (dz == null || !isFinite(dz)) return '—';
  const r = Math.round(dz);
  return `${r > 0 ? '+' : r < 0 ? '−' : ''}${Math.abs(r)} m`;
}

function fmtMoney(n) {
  return Number(n).toLocaleString('en-US');
}

applyI18n();
