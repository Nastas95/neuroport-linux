// Neuroport OS strings (home screen, apps, settings, web and camera).
'use strict';
Object.assign(I18N.en, {
  appMessages: 'Comms', appPhone: 'Phone', tabMessages: 'MESSAGES', tabContacts: 'CONTACTS', needsReply: 'REPLY', waitingCall: 'CALL', lastMsgShort: 'Last:', openChat: 'MESSAGES', appMap: 'Map', appGigs: 'Quick Gig', appJournal: 'Journal',
  appVehicles: 'Garage', appRadio: 'Radio', appInternet: 'Autofixer', appCamera: 'Camera', appSettings: 'Settings',
  day: 'DAY', today: 'TODAY', balance: 'BALANCE', details: 'Details', loading: 'Syncing…', recLevel: 'Rec. level', optional: 'optional',
  // Messages
  noMessages: 'No messages.', image: '[ image ]', sending: 'sending…', replies: 'REPLY',
  commsEmptyTitle: 'SELECT A CONVERSATION', commsEmptyDesc: 'Choose a contact from the list to read the thread and available replies.',
  cantReply: 'This contact cannot be replied to', noReplies: 'No reply available right now',
  // Settings
  setGame: 'IN GAME', setImmersive: 'Immersive mode',
  setImmersiveDesc: 'Hides the game minimap/GPS markers and blocks the game keys for radio, autodrive and calling vehicles — everything goes through Neuroport.',
  setPhone: 'PHONE', setFullscreen: 'Full screen', setFullscreenDesc: 'Hide the browser bars. Also on the button at the top right.',
  setAutoCar: 'Car mode', setAutoCarDesc: 'Switch to the car interface automatically when you get in a vehicle.',
  setRing: 'Ringtone', setRingDesc: 'Play the game ringtone on incoming calls.',
  setVibrate: 'Vibration', setVibrateDesc: 'Haptic feedback on touches and calls.',
  setNav: 'NAVIGATION', setNavMode: 'Navigation', navButtons: 'BUTTONS', navGestures: 'GESTURES',
  setNavButtonsDesc: 'Back, home and recent apps buttons at the bottom.',
  setNavGesturesDesc: 'Swipe from the side edge to go back, swipe up from the bottom for home, swipe up and hold for recents.',
  setNavSide: 'Button order', setNavSideDesc: 'Which side the back button sits on.', noRecents: 'No recent apps', newMessage: 'NEW MESSAGE', appStatus: 'Status', stLevel: 'LEVEL', stLevelXp: 'Next level', stCred: 'Street Cred',
  stAttrPts: 'attribute pts', stPerkPts: 'perk pts', stRelicPts: 'Relic pts', stAttributes: 'ATTRIBUTES', stStats: 'STATS',
  attrBody: 'Body', attrReflexes: 'Reflexes', attrTech: 'Technical Ability', attrInt: 'Intelligence', attrCool: 'Cool',
  stHealth: 'Health', stArmor: 'Armor', stCritChance: 'Crit chance', stCritDamage: 'Crit damage', stCapacity: 'Cyberware capacity', stCarry: 'Carry capacity', appShards: 'Shards', shardsSearch: 'Search shards…', shardsNew: 'new',
  shardsSelectTitle: 'SELECT A SHARD', shardsSelectDesc: 'Choose a shard from the list to read its contents.', shardsOther: 'Other', shardsSave: 'SAVE ON PHONE', shardsDownload: 'DOWNLOAD .TXT', shardsSaved: '{n} shards saved on this phone.', shardsSaveFail: 'Could not save on this phone.', shardsSavedAt: 'Saved copy: {d}', shardsOffline: 'Reading the saved copy (offline)', shardsReadSaved: 'READ SAVED SHARDS', shcat_articles: 'Articles', shcat_notes: 'Notes', shcat_world: 'World', shcat_technology: 'Technology', shcat_literature_fiction: 'Literature', shcat_others: 'Other', shcat_leaflets: 'Leaflets', shcat_cyberpsycho: 'Cyberpsychos (Regina)', shcat_night_city_people: 'Night City people', shcat_poetry: 'Poetry', shardsNone: 'No shard matches the search.', shardsEmpty: 'No shards yet. Read shards in the game and they show up here.', bootTitle: 'ESTABLISHING DATA LINK', bootReady: 'DATA LINK ESTABLISHED', bootSkip: 'SKIP',
  boot_link: 'Handshake with the game', boot_contacts: 'Syncing contacts', boot_icons: 'Loading map icons',
  boot_garage: 'Garage & Autofixer', boot_map: 'Holo map of Night City', setImmHud: 'IMMERSIVE MODE: HUD ELEMENTS',
  setImmHudDesc: 'Everything stays on screen. Turn off what should disappear; it only hides while immersive mode is on.',
  immExtra: 'Neuroport (applies after loading a save)',
  imm_minimap: 'Minimap', imm_hud_markers: 'World markers', imm_hk_phone: 'Phone button (T)', imm_hk_car: 'Vehicle button (V)',
  imm_hk_radio: 'Radio button (Z)', imm_qt_up: 'Job objective where the minimap was',
  imm_hk_move: 'Healing (X) and quick item to the left corner',
  imm_healthbar: 'Health bar', imm_stamina_oxygen: 'Stamina / oxygen', imm_npc_healthbar: 'Enemy health bars',
  imm_ammo_counter: 'Ammo counter', imm_input_hints: 'Button hints', imm_action_buttons: 'ALL quick slots (T, V, Z, X and quick item)',
  imm_activity_log: 'Activity log', imm_crosshairs: 'Crosshair', imm_quest_tracker: 'Job objective',
  imm_object_markers: 'Object markers', imm_npc_names: 'NPC names', imm_wanted_level: 'Wanted level (NCPD)',
  imm_npc_nameplates: 'NPC nameplates', imm_crouch_indicator: 'Crouch indicator', imm_vehicle_hud: 'Vehicle HUD', appGallery: 'Gallery', photoModeOpening: 'Opening photo mode in the game…', msgUnread: 'UNREAD / AWAITING REPLY', msgRead: 'READ',
  setMap: 'MAP', setMapMode: 'Map markers', mapActive: 'IN-GAME', mapAll: 'INTERACTIVE',
  mapModeActiveDesc: 'In-game map: only the icons the game shows now (shops and fast travel only nearby)', mapModeAllDesc: 'Interactive map: every known location',
  setQuality: '3D buildings', setQualityDesc: 'Lite draws only rooftops (recommended for phones).', qLite: 'LITE', qFull: 'FULL',
  setAbout: 'ABOUT', setLang: 'Game language', setLink: 'Server', setForget: 'Forget pairing', setForgetDesc: 'Disconnect this phone and ask for the pairing code again.',
  immersiveOn: 'Immersive mode on', immersiveOff: 'Immersive mode off',
  // Web
  netWelcome: 'Welcome to the Net', netShopDesc: 'Buy vehicles delivered to your garage', netForSale: 'for sale',
  netHomesDesc: 'Apartments in Night City', netListings: 'listings', netSites: 'SITES', netNoSites: 'No sites unlocked yet.',
  netNoOffers: 'Nothing listed right now.', owned: 'OWNED', buy: 'BUY', price: 'PRICE', balanceAfter: 'BALANCE AFTER', confirmBuy: 'CONFIRM PURCHASE',
  netHomesNote: 'Apartments are bought at the EZEstate terminal inside each building; here you can browse the listings.',
  netTerminalOnly: 'This page only opens on a terminal in the game.', netTerminalOnlyDesc: 'Neuroport lists the site but its pages are drawn by the game itself.',
  purchased: 'Purchase complete — check your garage',
  // Camera
  camHint: 'TAP TO OPEN PHOTO MODE IN GAME', gallery: 'GALLERY', noPhotos: 'No photos yet. Photos taken in photo mode show up here.',
  photoModeOpened: 'Photo mode opened in game',
  // erros novos
  err_already_owned: 'You already own this', err_not_available: 'Not for sale right now', err_no_money: 'Not enough eddies',
  err_no_reply: 'That reply is no longer available', err_no_entry: 'Conversation not found',
});
Object.assign(I18N.en, {
  setWall: 'WALLPAPER', setWallDesc: 'Use a photo from the gallery (game photo mode) behind the home screen.',
  wallDefault: 'DEFAULT', wallUse: 'SET AS WALLPAPER', wallSet: 'Wallpaper changed', wallSetFail: 'Could not apply this photo as wallpaper',
  immAll: 'Hide everything', immAllDesc: 'Turns every HUD element below off at once (on = all hidden).',
  wallAdjust: 'ADJUST FRAMING', wallAdjustHint: 'Drag to move · pinch or use the slider to zoom', wallReset: 'CENTER', wallDone: 'DONE',
});
applyI18n();
