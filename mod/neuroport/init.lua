-- Neuroport — Cyber Engine Tweaks mod
-- Reads commands from inbox.txt (written by the PC server) and writes game state to
-- state.json. All files stay inside the mod folder (CET sandbox).
--
-- All game calls are wrapped in pcall: if a patch changes something,
-- the affected feature stops working while the rest continues. Errors appear
-- in the CET console and in the small "Neuroport" overlay window.

local VERSION = "1.1.1"
local INBOX = "inbox.txt"
local STATE = "state.json"

local POLL_EVERY = 0.25   -- seconds: poll commands.
local WRITE_EVERY = 0.4   -- seconds: write state (map position).
local LISTS_EVERY = 6.0   -- seconds: reload vehicles, contacts and language.
local POIS_EVERY = 3.0    -- seconds: scan map markers (gigs, NCPD jobs, etc.).

local clock, nextPoll, nextWrite, nextLists, nextPois = 0, 0, 0, 0, 0
local gameLang = nil       -- Game language code reported by Cyberpunk.
local district = nil
local pois = {}            -- Nearby markers, already classified.
local poisStatus = "init"  -- "ok" | "no_codeware" | "error"
local poisDiag = {}        -- Diagnostics: total count, observed variants and first error.
local waypoint = nil       -- { id = NewMappinID, x, y, z, cat, label }
local wasInGame = false
local shopAt, hudApplied = nil, false
local offers, offerIndex, apartments, sites = {}, {}, {}, {}   -- Shop and internet offers (read by the shop block).
local stations = {}       -- Radio stations { station, ui, name }.
local hornOffAt = nil
local lastCmdId = 0
local acks = {}
local errors = {}          -- key -> message (for the overlay).
local warned = {}
local cache = { vehicles = {}, contacts = {} }
local vehicleIndex = {}    -- id -> { recordID, vehicleType, name }
local contactIndex = {}    -- id -> { callId, name }
local probe = {}          -- Diagnostics written to probe.json.
local journal             -- Journal (declared early because the map uses mission markers).
local activeVehicle = nil
local localCall = nil      -- { contact, callId, at } when the call originated here.
local overlayOpen = false
local stats = { cmds = 0, writes = 0 }

---------------------------------------------------------------------------
-- utilidades
---------------------------------------------------------------------------
local function log(msg) print("[Neuroport] " .. msg) end

local function warnOnce(key, msg)
  errors[key] = tostring(msg)
  if not warned[key] then
    warned[key] = true
    log(key .. ": " .. tostring(msg))
  end
end

local function try(key, fn, ...)
  local ok, a, b, c = pcall(fn, ...)
  if not ok then warnOnce(key, a) return nil end
  errors[key] = nil
  return a, b, c
end

local function cnameStr(cn)
  if cn == nil then return nil end
  if type(cn) == "string" then return cn end
  local ok, s = pcall(function() return cn.value end)
  if ok and s and s ~= "" then return s end
  ok, s = pcall(function() return NameToString(cn) end)
  if ok and s then return s end
  return tostring(cn)
end

local function eint(e)
  local v = EnumInt(e)
  local n = tonumber(v)
  if n then return n end
  return tonumber((tostring(v):gsub("U?LL$", "")))
end

local function enumIs(value, enumValue)
  local ok, r = pcall(function() return EnumInt(value) == EnumInt(enumValue) end)
  if ok then return r end
  return tostring(value) == tostring(enumValue)
end

local function round(n)
  if type(n) ~= "number" or n ~= n then return nil end
  return math.floor(n + 0.5)
end

-- "LocKey#123" / localization CName -> text in the game language.
-- Localized game text encodes line breaks as backslash-n (two characters).
local function fixNl(s)
  if type(s) ~= 'string' then return s end
  return (s:gsub('\\r\\n', '\n'):gsub('\\n', '\n'))
end
local L0
local function L(v) return fixNl(L0(v)) end
function L0(v)
  if v == nil then return nil end
  local s = v
  if type(v) ~= "string" then
    local ok, t = pcall(function() return Game.GetLocalizedTextByKey(v) end)
    if ok and t and t ~= "" then return t end
    s = cnameStr(v)
  end
  if type(s) ~= "string" or s == "" or s == "None" then return nil end
  if s:find("^LocKey") then
    local ok, t = pcall(GetLocalizedText, s)
    if ok and t and t ~= "" and t ~= s then return t end
    return nil
  end
  -- Secondary translation key ("Gameplay-Devices-Radio-RadioStationJazz").
  if not s:find("%s") and s:find("%-") then
    local ok, t = pcall(GetLocalizedText, s)
    if ok and t and t ~= "" and t ~= s then return t end
    ok, t = pcall(function() return Game.GetLocalizedTextByKey(CName.new(s)) end)
    if ok and t and t ~= "" and t ~= s then return t end
  end
  return s
end

---------------------------------------------------------------------------
-- JSON (encoder only; commands arrive as plain text).
---------------------------------------------------------------------------
local escapes = { ['"'] = '\\"', ['\\'] = '\\\\', ['\b'] = '\\b', ['\f'] = '\\f', ['\n'] = '\\n', ['\r'] = '\\r', ['\t'] = '\\t' }
local function encStr(s)
  return '"' .. s:gsub('[%c"\\]', function(c)
    return escapes[c] or string.format("\\u%04x", c:byte())
  end) .. '"'
end

local function encode(v)
  local t = type(v)
  if v == nil then return "null"
  elseif t == "boolean" then return v and "true" or "false"
  elseif t == "number" then
    if v ~= v or v == math.huge or v == -math.huge then return "null" end
    if math.floor(v) == v and math.abs(v) < 1e15 then return string.format("%d", v) end
    return string.format("%.4f", v)
  elseif t == "string" then return encStr(v)
  elseif t == "table" then
    if next(v) == nil then return "[]" end
    if #v > 0 then
      local parts = {}
      for i = 1, #v do parts[i] = encode(v[i]) end
      return "[" .. table.concat(parts, ",") .. "]"
    end
    local parts = {}
    for k, val in pairs(v) do
      parts[#parts + 1] = encStr(tostring(k)) .. ":" .. encode(val)
    end
    return "{" .. table.concat(parts, ",") .. "}"
  end
  return encStr(tostring(v))
end

---------------------------------------------------------------------------
-- Game state.
---------------------------------------------------------------------------
local function getPlayer()
  local player = Game.GetPlayer()
  if not player then return nil end
  local ok, pre = pcall(function() return Game.GetSystemRequestsHandler():IsPreGame() end)
  if ok and pre then return nil end
  return player
end

local function readPlayer(player)
  local p = {}
  local id = player:GetEntityID()
  try("dinheiro", function()
    p.money = round(Game.GetTransactionSystem():GetItemQuantity(player, MarketSystem.Money()))
  end)
  try("vida", function()
    p.health = round(Game.GetStatPoolsSystem():GetStatPoolValue(id, gamedataStatPoolType.Health, true))
  end)
  try("nivel", function()
    p.level = round(Game.GetStatsSystem():GetStatValue(id, gamedataStatType.Level))
    p.streetCred = round(Game.GetStatsSystem():GetStatValue(id, gamedataStatType.StreetCred))
  end)
  try("relogio", function()
    local t = Game.GetTimeSystem():GetGameTime()
    p.day, p.timeH, p.timeM = t:Days(), t:Hours(), t:Minutes()
  end)
  pcall(function() p.inVehicle = Game.GetMountedVehicle(player) ~= nil end)
  return p
end

-- ---------- status do V (app Status) ----------
local statusCache, statusAt = nil, -99
local function readStatus(player)
  if statusCache and clock - statusAt < 3 then return statusCache end
  local st = {}
  local id = player:GetEntityID()
  local ss = Game.GetStatsSystem()
  local function stat(name)
    local v = nil
    pcall(function() v = ss:GetStatValue(id, gamedataStatType[name]) end)
    return v
  end
  -- Attributes (Body corresponds to Strength in the game).
  st.attr = { body = stat("Strength"), reflexes = stat("Reflexes"), tech = stat("TechnicalAbility"),
              int = stat("Intelligence"), cool = stat("Cool") }
  for k, v in pairs(st.attr) do st.attr[k] = v and round(v) or nil end
  st.maxHealth = stat("Health")
  st.armor = stat("Armor")
  st.critChance = stat("CritChance")
  st.critDamage = stat("CritDamage")
  st.capacity = stat("Humanity")            -- capacidade de cyberware (2.x)
  st.carry = stat("CarryCapacity")
  for _, k in ipairs({ "maxHealth", "armor", "critChance", "critDamage", "capacity", "carry" }) do
    if st[k] then st[k] = round(st[k]) end
  end
  pcall(function() st.healthNow = round(Game.GetStatPoolsSystem():GetStatPoolValue(id, gamedataStatPoolType.Health, false)) end)
  pcall(function() st.capacityUsed = round(Game.GetStatPoolsSystem():GetStatPoolValue(id, gamedataStatPoolType.Humanity, false)) end)
  -- Available attribute points and level experience.
  pcall(function()
    local dev = Game.GetScriptableSystemsContainer():Get("PlayerDevelopmentSystem")
    local data = dev:GetDevelopmentData(player)
    pcall(function() st.attrPoints = data:GetDevPoints(gamedataDevelopmentPointType.Attribute) end)
    pcall(function() st.perkPoints = data:GetDevPoints(gamedataDevelopmentPointType.Primary) end)
    pcall(function() st.relicPoints = data:GetDevPoints(gamedataDevelopmentPointType.Espionage) end)
    pcall(function()
      st.xp = data:GetCurrentLevelProficiencyExp(gamedataProficiencyType.Level)
      st.xpNext = data:GetRemainingExpForLevelUp(gamedataProficiencyType.Level)
    end)
    pcall(function()
      st.credXp = data:GetCurrentLevelProficiencyExp(gamedataProficiencyType.StreetCred)
      st.credNext = data:GetRemainingExpForLevelUp(gamedataProficiencyType.StreetCred)
    end)
  end)
  statusCache, statusAt = st, clock
  return st
end

-- ---------- Vehicles ----------
local function recordKey(rid, fallback)
  local ok, k = pcall(function() return string.format("%d:%d", rid.hash, rid.length) end)
  if ok and k then return k end
  ok, k = pcall(function() return TDBID.ToStringDEBUG(rid) end)
  if ok and k and k ~= "" then return k end
  return "veh" .. tostring(fallback)
end

-- UIIcon (atlas + part) for a record; the server extracts the game image.
local function uiIcon(ic)
  local img = nil
  pcall(function()
    img = { part = cnameStr(ic:AtlasPartName()) }
    pcall(function()
      local h = ic:AtlasResourcePath().hash
      if h then img.atlas = tostring(h):gsub("ULL$", ""):gsub("LL$", "") end
    end)
  end)
  if img and (not img.part or img.part == "None") then img = nil end
  return img
end

-- Vehicle details (matching the in-game display): VehicleUIData plus the vehicle record. Cached per record.
local VEH_UI_FIELDS = { hp = "horsepower", mass = "mass", drive = "driveLayout", year = "productionYear",
  info = "info", top = "topSpeed", accel = "acceleration" }
local vehInfoCache = {}
local function flatText(v)
  if v == nil then return nil end
  local t = type(v)
  if t == "number" then return v ~= 0 and math.floor(v * 10 + 0.5) / 10 or nil end
  if t == "boolean" then return v end
  local s = nil
  pcall(function() s = L(v) end)
  if not s or s == "" then pcall(function() s = cnameStr(v) end) end
  if not s or s == "" then s = tostring(v) end
  if s == "" or s == "None" or s:find("^userdata") then return nil end
  if s:find("^LocKey#") then pcall(function() s = GetLocalizedText(s) end) end
  return s
end
local function vehInfo(rid, rec)
  local key = tostring(rid.hash) .. ":" .. tostring(rid.length)
  if vehInfoCache[key] ~= nil then return vehInfoCache[key] or nil end
  local out, n = {}, 0
  pcall(function()
    local rname = TDBID.ToStringDEBUG(rid)
    local ui = TweakDB:GetFlat(rname .. ".vehicleUIData")
    local uname = ui and TDBID.ToStringDEBUG(ui)
    if uname and uname ~= "" then
      for k, f in pairs(VEH_UI_FIELDS) do
        pcall(function()
          local v = flatText(TweakDB:GetFlat(uname .. "." .. f))
          if v ~= nil then out[k] = v; n = n + 1 end
        end)
      end
    end
  end)
  pcall(function() if rec:HasMachineGun() then out.mg = true end end)
  pcall(function() if rec:HasRocketLauncher() then out.rl = true end end)
  pcall(function()
    local seats = TweakDB:GetFlat(TDBID.ToStringDEBUG(rid) .. ".vehDataPackage")
    local pn = seats and TDBID.ToStringDEBUG(seats)
    local s = pn and TweakDB:GetFlat(pn .. ".vehSeatSet")
    local sn = s and TDBID.ToStringDEBUG(s)
    local list = sn and TweakDB:GetFlat(sn .. ".vehSeats")
    if type(list) == "table" and #list > 0 then out.seats = #list end
  end)
  vehInfoCache[key] = n > 0 and out or false
  if not probe.vehInfo and n > 0 then probe.vehInfo = out end
  return n > 0 and out or nil
end

local function readVehicles()
  local list = try("veiculos", function() return Game.GetVehicleSystem():GetPlayerUnlockedVehicles() end)
  if not list then return end
  local out, index = {}, {}
  for i, v in ipairs(list) do
    local unlocked = true
    pcall(function() unlocked = v.isUnlocked ~= false end)
    if unlocked then
      local rid = v.recordID
      local id = recordKey(rid, i)
      local name, maker, img, info
      pcall(function()
        local rec = TweakDB:GetRecord(rid)
        pcall(function() img = uiIcon(rec:Icon()) end)
        pcall(function() info = vehInfo(rid, rec) end)
        local n = Game.GetLocalizedTextByKey(rec:DisplayName())
        if n and n ~= "" then name = n end
        pcall(function()
          local m = rec:Manufacturer()
          local mn = m and m:EnumName()
          if mn and mn ~= "" then maker = tostring(mn) end
        end)
      end)
      if not name then
        local ok, s = pcall(function() return TDBID.ToStringDEBUG(rid) end)
        name = (ok and s and s ~= "") and s:gsub("^Vehicle%.", "") or ("Vehicle " .. i)
      end
      local isBike = enumIs(v.vehicleType, gamedataVehicleType.Bike)
      out[#out + 1] = { id = id, name = name, maker = maker, type = isBike and "bike" or "car", img = img, info = info }
      local gname = nil
      pcall(function() gname = v.name end)
      index[id] = { recordID = rid, vehicleType = v.vehicleType, name = name, gname = gname }
    end
  end
  cache.vehicles, vehicleIndex = out, index
end

local function summon(id)
  local v = vehicleIndex[id]
  if not v then readVehicles(); v = vehicleIndex[id] end
  if not v then return false, "not_found" end
  local vs = Game.GetVehicleSystem()

  -- 1) Make the selected vehicle the active vehicle of its type (the one V summons).
  --    GarageVehicleID = { name: CName, recordID: TweakDBID }
  local toggled = false
  local attempts = {
    function()
      local gid = GarageVehicleID.new()
      gid.recordID = v.recordID
      if v.gname then gid.name = v.gname end
      vs:TogglePlayerActiveVehicle(gid, v.vehicleType, true)
    end,
    function()
      local gid = GarageVehicleID.Resolve(TDBID.ToStringDEBUG(v.recordID))
      vs:TogglePlayerActiveVehicle(gid, v.vehicleType, true)
    end,
  }
  for i, fn in ipairs(attempts) do
    local ok, err = pcall(fn)
    if ok then toggled = true break end
    warnOnce("ativar_veiculo_" .. i, err)
  end

  -- 2) Summon THIS vehicle: SpawnPlayerVehicle(type, recordID, validRoadOnly) -> Bool.
  local ok, spawned = pcall(function() return vs:SpawnPlayerVehicle(v.vehicleType, v.recordID, false) end)
  if not ok then
    warnOnce("chamar_veiculo", spawned)
    ok, spawned = pcall(function() return vs:SpawnActivePlayerVehicle(v.vehicleType) end)
  end
  log(string.format("summon %s toggled=%s spawned=%s", tostring(v.name), tostring(toggled), tostring(spawned)))
  if not ok then return false, "game_refused" end
  if spawned == false then
    local cooldown = false
    pcall(function() cooldown = vs:IsPlayerVehicleOnCooldown(v.vehicleType, v.recordID) end)
    if toggled then activeVehicle = id end
    return false, cooldown and "summon_cooldown" or "summon_blocked"
  end
  activeVehicle = id
  return true, toggled and "ok" or "summon_fallback"
end

-- ---------- Contacts ----------
function gtimeC(t)
  local out = nil
  pcall(function() out = { d = t:Days(), h = t:Hours(), m = t:Minutes() } end)
  if not out then pcall(function() out = { d = GameTime.Days(t), h = GameTime.Hours(t), m = GameTime.Minutes(t) } end) end
  return out
end
local function unwrap(item)
  local ok, d = pcall(function() return item.data end)
  if ok and d then return d end
  return item
end

local function field(obj, ...)
  for _, name in ipairs({ ... }) do
    local ok, val = pcall(function() return obj[name] end)
    if ok and val ~= nil then return val end
  end
  return nil
end

local journalContactsCache, journalContactsAt = nil, -99
local function contactsFromJournal(jm)
  if journalContactsCache and clock - journalContactsAt < 15 then return journalContactsCache end
  local ctx = JournalRequestContext.new()
  local f = JournalRequestStateFilter.new()
  f.active, f.inactive, f.succeeded, f.failed = true, false, false, false
  ctx.stateFilter = f
  local entries = {}
  local ok, r = pcall(function() return jm:GetContacts(ctx) end)
  if ok and type(r) == "table" then entries = r
  else pcall(function() jm:GetContacts(ctx, entries) end) end
  local out = {}
  for _, e in ipairs(entries) do
    pcall(function()
      local c = { hash = jm:GetEntryHash(e) }
      pcall(function() c.contactId = e:GetId() end)
      pcall(function() c.localizedName = e:GetLocalizedName(jm) end)
      pcall(function() c.avatarID = e:GetAvatarID(jm) end)
      pcall(function() c.isCallable = e:IsCallable(jm) end)
      -- Conversation: last message, timestamp and unread count.
      local msgs = {}
      local okM, m1 = pcall(function() return jm:GetFlattenedMessagesAndChoices(e) end)
      if okM and type(m1) == "table" then msgs = m1 else pcall(function() jm:GetFlattenedMessagesAndChoices(e, msgs, {}) end) end
      local unread, last = 0, nil
      for _, msg in ipairs(msgs) do
        pcall(function() if jm:IsEntryVisited(msg) == false then unread = unread + 1 end end)
        last = msg
      end
      if last then
        c.hasMessages = true
        pcall(function() c.lastMessagePreview = last:GetText() end)
        pcall(function() c.timeStamp = jm:GetEntryTimestamp(last) end)
      end
      c.unreadMessageCount = unread
      if c.localizedName and c.localizedName ~= "" then out[#out + 1] = c end
    end)
  end
  probe.journalContacts = #out
  journalContactsCache, journalContactsAt = out, clock
  return out
end

local function contactsFromMessenger(jm)
  -- The in-game phone combines several lists (call contacts and all conversations):
  -- combine all sources here without duplicates.
  local sources = {
    function() return MessengerUtils.GetCallableAndNonCallableContacts(jm) end,
    function() return MessengerUtils.GetContactDataArray(jm, true, false, nil) end,
    function() return MessengerUtils.GetContactDataArray(jm, false, false, nil) end,
    function() return MessengerUtils.GetContactDataArray(jm, false, true) end,
    function() return MessengerUtils.GetSimpleContactDataArray(jm, true, false, false) end,
    function() return MessengerUtils.GetSimpleContactDataArray(jm, false, true, false) end,
    function() return contactsFromJournal(jm) end,
  }
  local all, seen = {}, {}
  probe.contactSources = {}
  for i, fn in ipairs(sources) do
    local ok, list = pcall(fn)
    probe.contactSources[i] = ok and (type(list) == "table" and #list or type(list)) or tostring(list)
    if ok and type(list) == "table" then
      for _, raw in ipairs(list) do
        local c = unwrap(raw)
        local k = field(c, "contactId", "id") or L(field(c, "localizedName", "contactName"))
        k = k and tostring(k) or nil
        local nm = L(field(c, "localizedName", "contactName"))
        local nk = nm and nm:lower() or nil
        if k and not seen[k] and not (nk and seen["n:" .. nk]) then
          seen[k] = true
          if nk then seen["n:" .. nk] = true end
          all[#all + 1] = raw
        end
      end
    elseif not ok then warnOnce("contatos_fonte_" .. i, list) end
  end
  probe.contactsTotal = #all
  if #all > 0 then return all end
  return nil
end

local function readContacts()
  local jm = Game.GetJournalManager()
  if not jm then return end
  local list = contactsFromMessenger(jm)
  if not list then warnOnce("contatos", "no contact source worked") return end

  local out, index, seen = {}, {}, {}
  for i, raw in ipairs(list) do
    local c = unwrap(raw)
    local callId = field(c, "contactId", "id")
    callId = callId and tostring(callId) or nil
    local hash = field(c, "hash")
    local id = callId or (hash and tostring(hash)) or ("c" .. i)
    local name = L(field(c, "localizedName", "contactName")) or id
    if name ~= "" and not seen[id] then
      seen[id] = true
      local preview = L(field(c, "lastMesssagePreview", "lastMessagePreview"))
      -- Avatar: avatarID -> UIIcon (atlas and part name); the server extracts the image.
      local avatar, atlas
      pcall(function()
        local rec = TweakDB:GetRecord(field(c, "avatarID"))
        avatar = cnameStr(rec:AtlasPartName())
        pcall(function()
          local res = rec:AtlasResourcePath()
          local h = res.hash
          if h then atlas = tostring(h):gsub("ULL$", ""):gsub("LL$", "") end
        end)
      end)
      if avatar == "None" or avatar == "" then avatar = nil end
      out[#out + 1] = {
        id = id,
        name = name,
        callable = field(c, "isCallable") ~= false,
        unread = round(tonumber(field(c, "unreadMessegeCount", "unreadMessageCount") or 0) or 0) or 0,
        preview = preview,
        avatar = avatar,
        atlas = atlas,
        messages = field(c, "hasMessages") == true or nil,
        t = (function() local ts = field(c, "timeStamp"); return ts and gtimeC(ts) or nil end)(),
        quest = field(c, "questRelated") == true,
        reply = field(c, "playerCanReply") == true or nil,
        last = field(c, "playerIsLastSender") == true or nil,
      }
      index[id] = { callId = callId or id, name = name, hash = hash }
    end
  end
  errors.contatos = nil
  cache.contacts, contactIndex = out, index
end

-- ---------- Calls ----------
local function phoneSystem()
  return Game.GetScriptableSystemsContainer():Get("PhoneSystem")
end

local function callRequest(addressee, phase)
  local req = questTriggerCallRequest.new()
  req.addressee = CName.new(addressee)
  req.caller = CName.new("Player")
  req.callPhase = phase
  req.callMode = questPhoneCallMode.Video
  phoneSystem():QueueRequest(req)
end

local function startCall(id)
  local c = contactIndex[id]
  if not c then readContacts(); c = contactIndex[id] end
  if not c then return false, "not_found" end
  local ok, err = pcall(callRequest, c.callId, questPhoneCallPhase.IncomingCall)
  if not ok then
    warnOnce("ligar", err)
    return false, "game_refused"
  end
  localCall = { contact = id, callId = c.callId, name = c.name, at = clock }
  return true, "ok"
end

local lastBBCall = nil -- Last blackboard read (contact name on the current line).
local lastCallInfo = nil -- PhoneCallInformation for the current call (accept/reject).

local function endCall()
  local target = (localCall and localCall.callId) or lastBBCall
  localCall = nil
  if not target then return true, "ok" end
  local ok, err = pcall(callRequest, target, questPhoneCallPhase.EndCall)
  if not ok then
    warnOnce("desligar", err)
    return false, "game_refused"
  end
  return true, "ok"
end

-- Answer (reject=false) or decline (reject=true) an incoming call, as the
-- in-game button does: PickupPhoneRequest{CallInformation, shouldBeRejected}.
local function pickUp(reject)
  local info = lastCallInfo
  if not info then return false, "no_incoming" end
  local ok, err = pcall(function()
    local req = PickupPhoneRequest.new()
    req.CallInformation = info
    req.shouldBeRejected = reject
    phoneSystem():QueueRequest(req)
  end)
  if not ok then
    warnOnce(reject and "recusar" or "atender", err)
    if reject and lastBBCall then
      ok = pcall(callRequest, lastBBCall, questPhoneCallPhase.EndCall)
      if ok then return true, "rejected" end
    end
    return false, "game_refused"
  end
  return true, reject and "rejected" or "answered"
end

local function readCall()
  local result
  local ok = pcall(function()
    local defs = GetAllBlackboardDefs().UI_ComDevice
    local bb = Game.GetBlackboardSystem():Get(defs)
    local info = bb:GetVariant(defs.PhoneCallInformation)
    pcall(function() info = FromVariant(info) end)
    if not info then return end
    local phase = info.callPhase
    local who = cnameStr(info.contactName)
    if who == "None" or who == "" then who = nil end
    if enumIs(phase, questPhoneCallPhase.StartCall) then
      result = { state = "active", contact = who }
    elseif enumIs(phase, questPhoneCallPhase.IncomingCall) then
      result = { state = info.isPlayerCalling and "calling" or "incoming", contact = who }
      if not info.isPlayerCalling then
        lastCallInfo = info
        pcall(function() result.rejectable = info.isRejectable end)
        pcall(function() result.audio = info.isAudioCall end)
      end
    else
      result = { state = "idle" }
    end
  end)
  if not ok then result = nil end

  if result and result.contact then lastBBCall = result.contact end
  if result and result.state == "idle" then lastBBCall = nil; lastCallInfo = nil end

  -- Without a blackboard (or before the game reflects the call), use the requested state.
  if (not result or result.state == "idle") and localCall then
    if clock - localCall.at < 8 then
      return { state = "calling", contact = localCall.contact, name = localCall.name }
    end
    localCall = nil
  end
  if not result then return { state = "idle" } end

  if result.contact then
    -- Convert the journal ID to the ID used by our list, when possible.
    for id, c in pairs(contactIndex) do
      if c.callId == result.contact or id == result.contact then
        result.contact, result.name = id, c.name
        break
      end
    end
    if localCall and result.state ~= "idle" then localCall.at = clock end
  end
  return result
end

-- ---------- Language ----------
-- Same approach as the Simple Location Manager mod: use the game "/language" setting.
local function readLanguage()
  local ok, code = pcall(function()
    local var = Game.GetSettingsSystem():GetVar("/language", "OnScreen")
    if not var then return nil end
    local v = var:GetValue()
    if type(v) == "string" then return v end
    return cnameStr(v)
  end)
  if ok and type(code) == "string" and code ~= "" then gameLang = string.lower(code) end
end

-- ---------- Position / District ----------
local function readPosition(player)
  local pos = {}
  try("posicao", function()
    local p = player:GetWorldPosition()
    pos.x, pos.y, pos.z = p.x, p.y, p.z
    local rot = player:GetWorldOrientation():ToEulerAngles()
    pos.yaw = rot.yaw
  end)
  pcall(function()
    local defs = GetAllBlackboardDefs()
    local bb = Game.GetBlackboardSystem():Get(defs.UI_Map)
    local s = bb:GetString(defs.UI_Map.currentLocation)
    if s and s ~= "" then
      local loc = GetLocalizedText(s)
      district = (loc and loc ~= "") and loc or s
    end
  end)
  return pos
end

-- ---------- Map markers (Quick Gig + Map) ----------
-- Precisa do Codeware: MappinSystem.GetAllMappins() vem dele.
-- Only these types matter; the app maps each one to a map filter.
-- (Names checked against the game 2.5 scripts.)
local WANTED = {
  -- Active jobs (objectives marked on the map by the game).
  "DefaultQuestVariant", "DynamicEventVariant", "ConversationVariant", "PhoneCallVariant",
  -- trabalhos
  "BountyHuntVariant", "RetrievingVariant", "ThieveryVariant", "SabotageVariant",
  "ClientInDistressVariant", "SOSsignalVariant", "CourierVariant", "Zzz09_CourierSandboxActivityVariant",
  "ConvoyVariant", "QuestGiverVariant", "ExclamationMarkVariant",
  -- Open world.
  "FixerVariant", "Zzz06_NCPDGigVariant", "GangWatchVariant", "OutpostVariant", "HiddenStashVariant",
  "HuntForPsychoVariant", "QuestionMarkVariant", "TarotVariant", "Zzz18_RacingVariant",
  "Zzz12_WorldEncounterVariant", "Zzz11_RoadBlockadeVariant", "Zzz16_RelicDeviceBasicVariant",
  "Zzz16_RelicDeviceSpecialVariant",
  -- Services.
  "ServicePointDropPointVariant", "ServicePointClothesVariant", "ServicePointRipperdocVariant",
  "ServicePointCyberwareVariant", "ServicePointNetTrainerVariant", "ServicePointGunsVariant",
  "ServicePointMeleeTrainerVariant", "ServicePointMedsVariant", "ServicePointFoodVariant",
  "ServicePointBarVariant", "ServicePointProstituteVariant", "ServicePointJunkVariant",
  "ServicePointTechVariant", "Zzz14_ServicePointBlackMarketVariant", "Zzz21_ServicePointGlamdocVariant",
  "WanderingMerchantVariant",
  -- Vehicles.
  "Zzz01_CarForPurchaseVariant", "Zzz02_MotorcycleForPurchaseVariant",
  -- outros
  "FastTravelVariant", "Zzz17_NCARTVariant", "Zzz19_DelamainTaxiVariant", "ApartmentVariant",
  "Zzz05_ApartmentToPurchaseVariant", "Zzz07_PlayerStashVariant", "Zzz08_WardrobeVariant",
}
local variantName = nil -- EnumInt(variant) -> nome curto ("Thievery", "NCPDGig"...)

local function buildVariantTable()
  variantName = {}
  for _, name in ipairs(WANTED) do
    pcall(function()
      local e = gamedataMappinVariant[name]
      if e ~= nil then
        local short = name:gsub("^Zzz%d+_", ""):gsub("Variant$", "")
        variantName[eint(e)] = short
      end
    end)
  end
end

local completedPhase = nil
pcall(function() completedPhase = eint(gamedataMappinPhase.CompletedPhase) end)

local MAP_RADIUS = 20000 -- meters: the entire city (the phone displays the full map).
local PER_TYPE = 4       -- plus the N nearest markers of each type (Quick Gig).
local MAX_POIS = 900

-- ---------- El Capitan: locations where contract vehicles have appeared ----------
-- The game randomly selects a contract from fixed locations (mostly in Dogtown) and marks only the current one.
-- The mod saves every location seen so the app can show where to look.
local CAPSPOTS_FILE = "neuroport_capspots.txt"
local capSpots, capSpotsLoaded = {}, false   -- "x:y" key (25 m grid) -> { x, y, z, n }.
local function loadCapSpots()
  capSpotsLoaded = true
  local f = io.open(CAPSPOTS_FILE, "r")
  if not f then return end
  for line in f:lines() do
    local x, y, z, n = line:match("^(%-?[%d%.]+),(%-?[%d%.]+),(%-?[%d%.]+),(%d+)")
    if x then
      x, y, z, n = tonumber(x), tonumber(y), tonumber(z), tonumber(n)
      capSpots[math.floor(x / 25) .. ":" .. math.floor(y / 25)] = { x = x, y = y, z = z, n = n }
    end
  end
  f:close()
end
local function saveCapSpots()
  local f = io.open(CAPSPOTS_FILE, "w")
  if not f then return end
  for _, s in pairs(capSpots) do f:write(string.format("%.1f,%.1f,%.1f,%d\n", s.x, s.y, s.z or 0, s.n)) end
  f:close()
end
local capSpotsLive = {}   -- Currently marked points (count each appearance only once).
local function noteCapSpots(found)
  if not capSpotsLoaded then loadCapSpots() end
  local live, changed = {}, false
  for _, p in ipairs(found) do
    if p.v == "CourierSandboxActivity" then
      local k = math.floor(p.x / 25) .. ":" .. math.floor(p.y / 25)
      live[k] = true
      if not capSpotsLive[k] then
        local s = capSpots[k]
        if s then s.n = s.n + 1 else capSpots[k] = { x = p.x, y = p.y, z = p.z or 0, n = 1 } end
        changed = true
      end
    end
  end
  capSpotsLive = live
  if changed then saveCapSpots() end
end
local function capSpotList()
  if not capSpotsLoaded then loadCapSpots() end
  local out = {}
  for _, s in pairs(capSpots) do out[#out + 1] = { x = math.floor(s.x), y = math.floor(s.y), z = math.floor(s.z or 0), n = s.n } end
  return out
end

local ftNames = {}   -- Fast-travel marker key -> name (or false if the game has no name).
local function scanPois(player)
  if not variantName then buildVariantTable() end
  local ms = Game.GetMappinSystem()
  local ok, list = pcall(function() return ms:GetAllMappins() end)
  if not ok or type(list) ~= "table" then
    poisStatus = "no_codeware"
    warnOnce("mapa", "GetAllMappins is unavailable (install Codeware)")
    pois = {}
    return
  end
  local pp = player:GetWorldPosition()
  local found, seen = {}, {}
  local diag = { total = #list, err = nil, sample = {}, known = 0 }
  for k, _ in pairs(variantName) do diag.known = diag.known + 1 end
  for _, m in ipairs(list) do
    local okM, errM = pcall(function()
      local vi = eint(m:GetVariant())
      if #diag.sample < 12 then
        local nm = nil
        pcall(function() nm = EnumValueToString("gamedataMappinVariant", vi) end)
        diag.sample[#diag.sample + 1] = tostring(nm or vi)
      end
      local v = variantName[vi]
      if not v then
        -- Variants unknown to the app (used to discover new gig types, etc.).
        local nm = nil
        pcall(function() nm = EnumValueToString("gamedataMappinVariant", vi) end)
        nm = tostring(nm or vi)
        diag.unknown = diag.unknown or {}
        diag.unknown[nm] = (diag.unknown[nm] or 0) + 1
        return
      end
      local phase = "d"
      local okP, ph = pcall(function() return EnumValueToString("gamedataMappinPhase", eint(m:GetPhase())) end)
      if okP and ph then
        if ph:find("Undiscovered") then phase = "u" elseif ph:find("Completed") then phase = "c" end
      end
      local vis, act = nil, nil
      pcall(function() vis = m:IsVisible() end)
      pcall(function() act = m:IsActive() end)
      local p = m:GetWorldPosition()
      if not p or (p.x == 0 and p.y == 0) then return end
      local key = v .. math.floor(p.x) .. ":" .. math.floor(p.y)
      if seen[key] then return end -- The same pin can appear twice.
      seen[key] = true
      local dx, dy = p.x - pp.x, p.y - pp.y
      local nm = nil
      -- Fast-travel location name (used by the app to find El Capitan guide locations).
      if v == "FastTravel" then
        nm = ftNames[key]
        if nm == nil then
          nm = false
          pcall(function()
            local pd = m:GetPointData()
            local s = pd and pd:GetPointDisplayName()
            if s and s ~= "" then
              if s:find("^LocKey#") then s = GetLocalizedText(s) end
              nm = s
            end
          end)
          ftNames[key] = nm
        end
      end
      found[#found + 1] = { v = v, x = p.x, y = p.y, z = p.z, d = math.sqrt(dx * dx + dy * dy), ph = phase, vis = vis, act = act, n = nm or nil }
    end)
    if not okM and not diag.err then diag.err = tostring(errM) end
  end
  diag.matched = #found
  poisDiag = diag
  pcall(noteCapSpots, found)
  table.sort(found, function(a, b) return a.d < b.d end)

  local out, perType = {}, {}
  for _, f in ipairs(found) do
    perType[f.v] = (perType[f.v] or 0) + 1
    if f.d <= MAP_RADIUS or perType[f.v] <= PER_TYPE then
      out[#out + 1] = { v = f.v, x = round(f.x), y = round(f.y), z = round(f.z), ph = f.ph, n = f.n,
                        vis = f.vis == false and false or nil, act = f.act == false and false or nil,
                        _x = f.x, _y = f.y }
    end
    if #out >= MAX_POIS then break end
  end
  -- Job markers are included only when they match an active journal objective.
  local QUESTISH = { DefaultQuest = true, DynamicEvent = true, Conversation = true, PhoneCall = true,
                     ExclamationMark = true, HiddenStash = true, QuestGiver = true }
  local qpins = (journal and journal.pins) or {}
  local used = {}
  -- Gigs first: a gig is active only if the journal has an active objective at the same location.
  local GIGISH = { BountyHunt = true, Retrieving = true, Thievery = true, Sabotage = true, ClientInDistress = true,
                   SOSsignal = true, Courier = true, CourierSandboxActivity = true, Convoy = true }
  for _, o in ipairs(out) do
    if GIGISH[o.v] then
      local best, bd = nil, 60
      for i, p in ipairs(qpins) do
        local d = math.sqrt((p.x - o._x) ^ 2 + (p.y - o._y) ^ 2)
        if d < bd and not used[i] then best, bd = i, d end
      end
      if best then
        used[best] = true
        o.q, o.qt = qpins[best].q, qpins[best].qt
      else
        o.gl = false
      end
    end
  end
  for _, o in ipairs(out) do
    if QUESTISH[o.v] and #qpins > 0 then
      local best, bd = nil, 40
      local near = false
      for i, p in ipairs(qpins) do
        local d = math.sqrt((p.x - o._x) ^ 2 + (p.y - o._y) ^ 2)
        if d < 40 then near = true end
        -- One marker per location; duplicates at the same coordinates are removed.
        if d < bd and not used[i] then best, bd = i, d end
      end
      if not best and near then o.dup = true end
      if best then
        used[best] = true
        o.q, o.qt = qpins[best].q, qpins[best].qt
      else
        o.ql = false
      end
    end
    o._x, o._y = nil, nil
  end
  -- Include active objectives even when no corresponding marker exists in the list.
  for i, p in ipairs(qpins) do
    if not used[i] then
      out[#out + 1] = { v = "DefaultQuest", x = round(p.x), y = round(p.y), z = round(p.z), ph = "d", q = p.q, qt = p.qt }
    end
  end
  pois = out
  poisStatus = "ok"
  errors.mapa = nil
end

-- ---------- Journal ----------
-- Functions with an "out" parameter (GetQuests, GetChildren): CET returns the array
-- as an additional return value. Check both forms to avoid relying on one behavior.
local function firstTable(...)
  for i = 1, select("#", ...) do
    local v = select(i, ...)
    if type(v) == "table" then return v end
  end
  return nil
end

local function outArray(fn)
  local r = { pcall(fn, nil) }
  if r[1] then
    local t = firstTable(unpack(r, 2, table.maxn(r)))
    if t and #t > 0 then return t end
  end
  local out = {}
  local ok = pcall(fn, out)
  if ok and #out > 0 then return out end
  return {}
end

local function stateFilter(active, done)
  local f = JournalRequestStateFilter.new()
  f.active = active
  f.inactive = false
  f.succeeded = done or false
  f.failed = false
  return f
end

local function locText0(s)
  if type(s) ~= "string" or s == "" then return nil end
  if s:find("^LocKey") then
    local ok, t = pcall(GetLocalizedText, s)
    if ok and t and t ~= "" then return t end
  end
  return s
end
local function locText(s) return fixNl(locText0(s)) end

local QUEST_GROUP = {
  MainQuest = "main", SideQuest = "side", MinorQuest = "side", ApartmentQuest = "side", CourierSideQuest = "side",
  VehicleQuest = "side", StreetStory = "gig", Contract = "gig", CyberPsycho = "other",
}

journal = { tracked = nil, quests = {}, pins = {} }
local questIndex = {}   -- id -> entry (JournalQuest)

local function entryHash(jm, e)
  local ok, h = pcall(function() return jm:GetEntryHash(e) end)
  if ok and h then return tostring(h) end
  return nil
end

local function children(jm, e, filter)
  return outArray(function(out)
    if out then return jm:GetChildren(e, filter, out) end
    return jm:GetChildren(e, filter)
  end)
end

-- Marker positions for active objectives (the same positions drawn by the game map).
local function hashU32(h)
  h = tonumber(h)
  if h and h < 0 then h = h + 4294967296 end
  return h
end
local function vecXYZ(v)
  if v == nil then return nil end
  local ok, x, y, z = pcall(function() return v.x, v.y, v.z end)
  if ok and type(x) == "number" and (x ~= 0 or y ~= 0) then return x, y, z end
  return nil
end
local function objectivePins(jm, obj)
  local ms = Game.GetMappinSystem()
  local h = hashU32(jm:GetEntryHash(obj))
  local out = {}
  local function collect(list)
    for _, v in ipairs(list or {}) do
      local x, y, z = vecXYZ(v)
      if x then out[#out + 1] = { x = x, y = y, z = z or 0 } end
    end
  end
  for _, sys in ipairs({ ms, jm }) do
    if #out == 0 then
      collect(outArray(function(o)
        if o then return sys:GetQuestMappinPositionsByObjective(h, o) end
        return sys:GetQuestMappinPositionsByObjective(h)
      end))
      if #out > 0 then probe.pinMethod = (sys == ms) and "ms_byObjective" or "jm_byObjective" end
    end
  end
  if #out == 0 then
    -- One by one: objective children that are markers.
    for _, pin in ipairs(children(jm, obj, stateFilter(true))) do
      pcall(function()
        local ph = hashU32(jm:GetEntryHash(pin))
        local found = false
        local r = { pcall(function() return ms:GetQuestMappinPosition(ph) end) }
        for i = 2, #r do
          local x, y, z = vecXYZ(r[i])
          if x then out[#out + 1] = { x = x, y = y, z = z or 0 }; probe.pinMethod = "ms_position"; found = true; break end
        end
        if not found then
          local v = Vector4.new(0, 0, 0, 0)
          pcall(function() ms:GetQuestMappinPosition(ph, v) end)
          local x, y, z = vecXYZ(v)
          if x then out[#out + 1] = { x = x, y = y, z = z or 0 }; probe.pinMethod = "ms_position_out" end
        end
      end)
    end
  end
  return out
end

local function activeObjectives(jm, quest)
  local f, list = stateFilter(true), {}
  for _, phase in ipairs(children(jm, quest, f)) do
    for _, obj in ipairs(children(jm, phase, f)) do
      local isObjective = true
      pcall(function() isObjective = obj:IsA("gameJournalQuestObjective") end)
      if isObjective then list[#list + 1] = obj end
    end
  end
  return list
end

-- First active job objective (phase -> objective).
local function activeObjective(jm, quest)
  local f = stateFilter(true)
  for _, phase in ipairs(children(jm, quest, f)) do
    for _, obj in ipairs(children(jm, phase, f)) do
      local isObjective = true
      pcall(function() isObjective = obj:IsA("gameJournalQuestObjective") end)
      if isObjective then return obj end
    end
  end
  return nil
end

local allQuestsAt, capStats = nil, nil
local function readJournal()
  local jm = Game.GetJournalManager()
  if not jm then return end
  local ctx = JournalRequestContext.new()
  ctx.stateFilter = stateFilter(true)
  local quests = outArray(function(out)
    if out then return jm:GetQuests(ctx, out) end
    return jm:GetQuests(ctx)
  end)
  if #quests == 0 then warnOnce("diario", "GetQuests returned no jobs") end
  -- All jobs (including completed ones), refreshed every minute to populate El Capitan's checklist.
  if not probe.allQuests or os.clock() - (allQuestsAt or -999) > 60 then
    allQuestsAt = os.clock()
    probe.allQuests = {}
    pcall(function()
      local c2 = JournalRequestContext.new()
      local f = JournalRequestStateFilter.new()
      f.active, f.inactive, f.succeeded, f.failed = true, true, true, true
      c2.stateFilter = f
      for _, q in ipairs(outArray(function(out) if out then return jm:GetQuests(c2, out) end return jm:GetQuests(c2) end)) do
        pcall(function()
          local e = { id = q:GetId() }
          pcall(function() e.title = locText(q:GetTitle(jm)) end)
          pcall(function() e.type = EnumValueToString("gameJournalQuestType", EnumInt(q:GetType())) end)
          pcall(function() e.state = EnumValueToString("gameJournalEntryState", EnumInt(jm:GetEntryState(q))) end)
          probe.allQuests[#probe.allQuests + 1] = e
        end)
      end
    end)
    local cap = { intro = false, done = 0, failed = 0, jobs = {} }
    for _, e in ipairs(probe.allQuests) do
      if e.type == "CourierSideQuest" then
        if e.id == "courier_intro_journal" then cap.intro = e.state == "Succeeded"
        else
          if e.state == "Succeeded" then cap.done = cap.done + 1 elseif e.state == "Failed" then cap.failed = cap.failed + 1 end
          cap.jobs[#cap.jobs + 1] = { t = e.title, s = e.state }
        end
      end
    end
    capStats = cap
  end

  -- Tracked job: objective -> phase -> job.
  local trackedId = nil
  pcall(function()
    local obj = jm:GetTrackedEntry()
    if obj then
      local phase = jm:GetParentEntry(obj)
      local quest = phase and jm:GetParentEntry(phase)
      trackedId = quest and entryHash(jm, quest)
    end
  end)

  local list, index, pins = {}, {}, {}
  for _, q in ipairs(quests) do
    pcall(function()
      local id = entryHash(jm, q)
      if not id then return end
      local title
      pcall(function() title = locText(q:GetTitle(jm)) end)
      if not title then pcall(function() title = locText(q:GetTitle()) end) end
      local qtype, isCap = "other", nil
      pcall(function()
        local tname = EnumValueToString("gameJournalQuestType", EnumInt(q:GetType()))
        qtype = QUEST_GROUP[tname] or "other"
        if tname == "CourierSideQuest" then isCap = true end   -- El Capitan vehicle contracts.
      end)
      local objective
      local obj = activeObjective(jm, q)
      if obj then pcall(function() objective = locText(obj:GetDescription()) end) end
      local dist
      pcall(function()
        local d = jm:GetDistanceToNearestMappin(obj or q)
        if type(d) == "number" and d > 0 and d < 100000 then dist = round(d) end
      end)
      list[#list + 1] = { id = id, title = title or "?", group = qtype, objective = objective, dist = dist, cap = isCap }
      for _, o in ipairs(activeObjectives(jm, q)) do
        local okP, ps = pcall(objectivePins, jm, o)
        if okP then
          for _, p in ipairs(ps) do pins[#pins + 1] = { q = id, qt = title, x = p.x, y = p.y, z = p.z } end
        elseif not probe.pinErr then probe.pinErr = tostring(ps) end
      end
      index[id] = q
    end)
  end
  journal = { tracked = trackedId, quests = list, pins = pins, cap = capStats }
  probe.questPins = #pins
  questIndex = index
  if #list > 0 then errors.diario = nil end
end

local function trackQuest(id)
  local jm = Game.GetJournalManager()
  local q = questIndex[id]
  if not q then readJournal(); q = questIndex[id] end
  if not q then return false, "not_found" end
  local obj = activeObjective(jm, q)
  if not obj then return false, "no_objective" end
  local ok, err = pcall(function() jm:TrackEntry(obj) end)
  if not ok then warnOnce("rastrear", err) return false, "game_refused" end
  journal.tracked = id
  return true, "tracked"
end

local untrackedAt = nil
local hudKick = nil   -- (desativado) "desliga e religa" do objetivo no HUD
-- The HUD job objective (QuestTrackerGameController) keeps showing the last job when
-- nothing is tracked: the base game has no "no job" state. The mod stores the controller (through its
-- callbacks) and hides the widget while no job is tracked.
local trackerCtrl, trackerHidden = nil, false
local function applyTrackerVis()
  if not trackerCtrl then return end
  local tracked = nil
  pcall(function() tracked = Game.GetJournalManager():GetTrackedEntry() end)
  pcall(function()
    local root = trackerCtrl:GetRootWidget()
    if not root then return end
    if tracked == nil then
      if root:IsVisible() then root:SetVisible(false) end
      trackerHidden = true
    elseif trackerHidden then
      root:SetVisible(true)
      trackerHidden = false
    end
  end)
end
-- Leave V with no tracked job (the game allows this; the next job update may track another one).
local function untrackQuest()
  local jm = Game.GetJournalManager()
  local function stillTracked()
    local t = nil
    pcall(function() t = jm:GetTrackedEntry() end)
    return t ~= nil
  end
  -- The journal untracks the job, but the HUD objective does not redraw itself. After untracking,
  -- briefly toggle the HUD job-objective setting (a safe in-game setting) to refresh it.
  -- probe.untrack records what the game accepted.
  local report = { before = stillTracked() }
  local tries = {
    { "UntrackEntry", function() jm:UntrackEntry() end },
    { "UntrackEntry(entry)", function() local e = jm:GetTrackedEntry(); if e then jm:UntrackEntry(e) end end },
  }
  for _, t in ipairs(tries) do
    if not stillTracked() then break end
    local ok, err = pcall(t[2])
    report[#report + 1] = { m = t[1], ok = ok, err = (not ok) and tostring(err):sub(1, 160) or nil, still = stillTracked() }
  end
  probe.untrack = report
  applyTrackerVis()
  if stillTracked() then warnOnce("parar_rastreio", "the game did not release the job") return false, "game_refused" end
  journal.tracked = nil
  untrackedAt = os.clock()
  return true, "untracked"
end

-- world.json: slower-changing data (markers and journal), written only when changed.
local lastWorld = ""

-- ---------- Shards (Codex > Shards): text the player has read or discovered ----------
-- Stored separately in shards.json (they can be large) and written only when changed.
local lastShards = ""
local shardEntries = {}   -- ID -> journal entry (for marking it as read).
local function readShards()
  local jm = Game.GetJournalManager()
  if not jm then return end
  local f = JournalRequestStateFilter.new()
  f.active, f.inactive, f.succeeded, f.failed = true, false, true, false
  local ctx = JournalRequestContext.new()
  ctx.stateFilter = f
  local roots = outArray(function(o) if o then return jm:GetOnscreens(ctx, o) end return jm:GetOnscreens(ctx) end)
  local out, groups = {}, 0
  local function add(e, cat, depth)
    if depth > 4 then return end
    -- Codex categories: JournalOnscreensStructuredGroup (script class) with GetTag/GetEntries.
    local structured = false
    pcall(function() structured = e:IsA("gameJournalOnscreensStructuredGroup") end)
    if not structured then pcall(function() structured = e:IsA("JournalOnscreensStructuredGroup") end) end
    if not structured then pcall(function() structured = e.GetEntries ~= nil and e.GetTag ~= nil and e:GetEntries() ~= nil end) end
    if structured then
      groups = groups + 1
      local tag = nil
      pcall(function() tag = NameToString(e:GetTag()) end)
      if tag == "None" or tag == "" then tag = nil end
      local list = {}
      pcall(function() list = e:GetEntries() or {} end)
      for _, c in ipairs(list) do add(c, tag or cat, depth + 1) end
      return
    end
    local isGroup = false
    pcall(function() isGroup = e:IsA("gameJournalOnscreenGroup") end)
    if isGroup then
      groups = groups + 1
      local gname = nil
      pcall(function() gname = locText(e:GetGroupName()) end)
      if not gname then pcall(function() gname = e:GetId() end) end
      for _, c in ipairs(children(jm, e, f)) do add(c, gname or cat, depth + 1) end
      return
    end
    local s = { cat = cat }
    pcall(function() s.id = tostring(jm:GetEntryHash(e)) end)
    pcall(function() s.title = locText(e:GetTitle()) end)
    pcall(function() s.text = locText(e:GetDescription()) end)
    pcall(function() s.read = jm:IsEntryVisited(e) end)
    if s.id and (s.title or s.text) then
      out[#out + 1] = s
      shardEntries[s.id] = e
    end
  end
  for _, r in ipairs(roots) do add(r, nil, 0) end
  probe.shards = { roots = #roots, groups = groups, count = #out }
  -- Structure diagnostics (first categories): class and children with different filters.
  if #out == 0 then
    probe.shards.dbg = {}
    local all = JournalRequestStateFilter.new()
    all.active, all.inactive, all.succeeded, all.failed = true, true, true, true
    for i = 1, math.min(3, #roots) do
      local r = roots[i]
      local d = {}
      pcall(function() d.cls = r:GetClassName().value end)
      pcall(function() d.cls = d.cls or NameToString(r:GetClassName()) end)
      pcall(function() d.id = r:GetId() end)
      local ca = children(jm, r, f)
      local cb = children(jm, r, all)
      d.nActive, d.nAll = #ca, #cb
      local c1 = cb[1] or ca[1]
      if c1 then
        pcall(function() d.childCls = NameToString(c1:GetClassName()) end)
        pcall(function() d.childId = c1:GetId() end)
        pcall(function() d.childTitle = c1:GetTitle() end)
        pcall(function() d.childState = EnumValueToString("gameJournalEntryState", EnumInt(jm:GetEntryState(c1))) end)
        pcall(function() d.grand = #children(jm, c1, all) end)
      end
      probe.shards.dbg[i] = d
    end
  end
  local txt = encode({ v = 1, shards = out })
  if txt == lastShards then return end
  local fh = io.open("shards.json", "w")
  if not fh then return end
  fh:write(txt)
  fh:close()
  lastShards = txt
end
local function shardRead(id)
  local e = shardEntries[tostring(id or "")]
  if not e then return false, "no_entry" end
  local ok = pcall(function() Game.GetJournalManager():SetEntryVisited(e, true) end)
  return ok, ok and "ok" or "game_refused"
end
local function writeWorld()
  if #stations == 0 then readStations() end
  local txt = encode({ v = 1, pois = pois, poisStatus = poisStatus, poisDiag = poisDiag, journal = journal, stations = stations,
                       offers = offers, apartments = apartments, sites = sites, capSpots = capSpotList() })
  if txt == lastWorld then return end
  local f = io.open("world.json", "w")
  if not f then warnOnce("gravar_mundo", "could not open world.json") return end
  f:write(txt)
  f:close()
  lastWorld = txt
end

-- ---------- waypoint no GPS ----------
-- A "CustomPositionVariant" pin is the player waypoint; the game starts routing to it.
local function clearWaypoint()
  if not waypoint then return true end
  pcall(function()
    local ms = Game.GetMappinSystem()
    local tracked = ms:GetManuallyTrackedMappinID()
    if tracked and tracked.value == waypoint.id.value then ms:UntrackMappin() end
    ms:UnregisterMappin(waypoint.id)
  end)
  waypoint = nil
  return true
end

local function setWaypoint(arg)
  local x, y, z, cat = string.match(arg or "", "^([%-%d%.]+),([%-%d%.]+),([%-%d%.]+),?(%w*)")
  x, y, z = tonumber(x), tonumber(y), tonumber(z)
  if not x then return false, "bad_args" end
  clearWaypoint()
  local data = MappinData.new()
  data.mappinType = TweakDBID.new("Mappins.DefaultStaticMappin")
  data.variant = gamedataMappinVariant.CustomPositionVariant
  data.visibleThroughWalls = true
  pcall(function() data.debugCaption = "Neuroport|" .. (cat or "") end)
  local id = Game.GetMappinSystem():RegisterMappin(data, Vector4.new(x, y, z, 1))
  waypoint = { id = id, x = x, y = y, z = z, cat = cat ~= "" and cat or nil }
  return true, "waypoint_set"
end

-- ---------- Car: radio, autodrive and paint ----------
-- Signatures verified in NativeDB (game version 3.0):
--   VehicleObject: IsRadioReceiverActive, GetRadioReceiverStationName, GetRadioReceiverTrackName,
--     GetCurrentRadioIndex, SetRadioReceiverStation(i), NextRadioReceiverStation, ToggleRadioReceiver(b),
--     IsAutoDriveModeEnabled, ToggleHorn(b)
--   PocketRadio (player:GetPocketRadio()): IsActive, GetStation, GetStationName, GetTrackName,
--     TurnOn(sfx), TurnOff(sfx), HandleVehicleRadioEvent(VehicleRadioEvent{toggle, setStation, station})
--   RadioStationDataProvider: GetStationsCount, GetRadioStationByUIIndex(i), GetStationNameByIndex(i, isUI)
--   AutoDriveSystem (scriptable): GetAutodriveAvailable, GetDistanceToCurrentDestination,
--     GetEstimatedTimeToArrival; requests EnableAutoDriveRequest{isDelamain}, DisableAutoDriveRequest,
--     ToggleFreeRoamRequest
--   NewVehicleVisualCustomizationEvent{reset, template: VehicleVisualCustomizationTemplate{genericData}}

local function mounted(player)
  local ok, v = pcall(function() return Game.GetMountedVehicle(player) end)
  if ok and v then return v end
  return nil
end

local function autoDriveSys()
  local ok, sys = pcall(function() return Game.GetScriptableSystemsContainer():Get("AutoDriveSystem") end)
  if ok then return sys end
  return nil
end

function readStations()
  local list = {}
  pcall(function()
    local n = RadioStationDataProvider.GetStationsCount()
    for i = 0, n - 1 do
      local st, name
      pcall(function() st = eint(RadioStationDataProvider.GetRadioStationByUIIndex(i)) end)
      pcall(function()
        local e = RadioStationDataProvider.GetRadioStationByUIIndex(i)
        name = L(RadioStationDataProvider.GetChannelName(e))
        if not name or name:find("^radio_station") or name:find("^Gameplay%-") then
          local alt = L(RadioStationDataProvider.GetStationName(e))
          if alt and not alt:find("^radio_station") then name = alt end
        end
      end)
      if not name or name:find("^radio_station") then
        pcall(function() name = L(RadioStationDataProvider.GetStationNameByIndex(i, true)) end)
      end
      if name and name:find("^Gameplay%-Devices%-Radio%-RadioStation") then
        -- Last resort: "Gameplay-Devices-Radio-RadioStationDownTempo" -> "Down Tempo".
        name = name:gsub("^Gameplay%-Devices%-Radio%-RadioStation", ""):gsub("(%l)(%u)", "%1 %2")
      end
      if name and name:find("^radio_station") then
        -- Final fallback: "radio_station_09_downtempo" -> "Downtempo".
        name = name:gsub("^radio_station_%d+_", ""):gsub("_", " "):gsub("(%a)([%w]*)", function(a, b) return a:upper() .. b end)
      end
      if st == nil then st = i end
      list[#list + 1] = { station = st, ui = i, name = name or ("Radio " .. (i + 1)) }
    end
  end)
  if #list == 0 then warnOnce("radio_lista", "could not list radio stations") end
  stations = list
end

local function radioVolVar()
  local ss = Game.GetSettingsSystem()
  local names = mounted(Game.GetPlayer()) and { "CarRadioVolume", "RadioportVolume" } or { "RadioportVolume", "CarRadioVolume" }
  for _, n in ipairs(names) do
    local ok, var = pcall(function() return ss:GetVar("/audio/volume", n) end)
    if ok and var then return var, ss end
  end
  return nil
end
local function volPct(var)
  local v, mn, mx = var:GetValue(), 0, 100
  pcall(function() mn = var:GetMinValue(); mx = var:GetMaxValue() end)
  if mx <= mn then return nil end
  return math.floor((v - mn) / (mx - mn) * 100 + 0.5), mn, mx, v
end
function readRadio(player)
  local r = {}
  local veh = mounted(player)
  if veh then
    r.src = "vehicle"
    pcall(function() r.on = veh:IsRadioReceiverActive() end)
    pcall(function() r.station = L(veh:GetRadioReceiverStationName()) end)
    pcall(function() r.track = L(veh:GetRadioReceiverTrackName()) end)
    pcall(function() r.idx = veh:GetCurrentRadioIndex() end)
    pcall(function() local var = radioVolVar(); if var then r.vol = volPct(var) end end)
  else
    r.src = "pocket"
    pcall(function()
      local pr = player:GetPocketRadio()
      r.on = pr:IsActive()
      r.station = L(pr:GetStationName())
      r.track = L(pr:GetTrackName())
      r.idx = pr:GetStation()
    end)
    pcall(function() local var = radioVolVar(); if var then r.vol = volPct(var) end end)
  end
  return r
end

local function radioEvent(toggle, station)
  local evt = VehicleRadioEvent.new()
  evt.toggle = toggle or false
  evt.setStation = station ~= nil
  evt.station = station or -1
  return evt
end

function radioPower(on)
  local player = Game.GetPlayer()
  local veh = mounted(player)
  if veh then
    local ok, err = pcall(function() veh:ToggleRadioReceiver(on) end)
    if not ok then warnOnce("radio_power", err) return false, "game_refused" end
    return true, "ok"
  end
  local ok, err = pcall(function()
    local pr = player:GetPocketRadio()
    if on then pr:TurnOn(true) else pr:TurnOff(true) end
  end)
  if not ok then warnOnce("radio_bolso", err) return false, "game_refused" end
  return true, "ok"
end

function radioSet(station)
  if not station then return false, "bad_args" end
  local player = Game.GetPlayer()
  local veh = mounted(player)
  if veh then
    local ok, err = pcall(function()
      if not veh:IsRadioReceiverActive() then veh:ToggleRadioReceiver(true) end
      veh:SetRadioReceiverStation(station)
    end)
    if not ok then
      ok, err = pcall(function() veh:QueueEvent(radioEvent(false, station)) end)
    end
    if not ok then warnOnce("radio_estacao", err) return false, "game_refused" end
    return true, "ok"
  end
  local ok, err = pcall(function()
    local pr = player:GetPocketRadio()
    pr:HandleVehicleRadioEvent(radioEvent(false, station))
    if not pr:IsActive() then pr:TurnOn(true) end
  end)
  if not ok then warnOnce("radio_bolso_estacao", err) return false, "game_refused" end
  return true, "ok"
end

function radioVolume(dir)
  local var, ss = radioVolVar()
  if not var then return false, "volume_unavailable" end
  local ok, err = pcall(function()
    local _, mn, mx, v = volPct(var)
    local step = (mx - mn) / 10
    local nv = math.max(mn, math.min(mx, v + dir * step))
    if math.type and math.type(v) == "integer" then nv = math.floor(nv + 0.5) end
    var:SetValue(nv)
    pcall(function() ss:ConfirmChanges() end)
  end)
  if not ok then return false, tostring(err) end
  return true, "ok"
end

function radioStep(dir)
  local player = Game.GetPlayer()
  local veh = mounted(player)
  if veh and dir > 0 then
    local ok = pcall(function() veh:NextRadioReceiverStation() end)
    if ok then return true, "ok" end
  end
  if #stations == 0 then readStations() end
  local cur = readRadio(player)
  local pos = 1
  for i, st in ipairs(stations) do
    if st.name == cur.station then pos = i break end
  end
  local nxt = ((pos - 1 + dir) % #stations) + 1
  return radioSet(stations[nxt].station)
end

function readCar(player)
  local veh = mounted(player)
  if not veh then return { inside = false } end
  local c = { inside = true }
  pcall(function()
    local rec = veh:GetRecord()
    c.name = L(rec:DisplayName())
  end)
  pcall(function() c.speed = round(math.abs(veh:GetCurrentSpeed()) * 3.6) end)
  pcall(function() c.autodrive = veh:IsAutoDriveModeEnabled() end)
  local sys = autoDriveSys()
  if sys then
    pcall(function() c.adAvailable = sys:GetAutodriveAvailable() end)
    pcall(function()
      local d = sys:GetDistanceToCurrentDestination()
      if d and d > 0 and d < 100000 then c.adDist = round(d) end
    end)
    pcall(function()
      local t = sys:GetEstimatedTimeToArrival()
      if t and t > 0 and t < 100000 then c.adEta = round(t) end
    end)
  end
  return c
end

local questDriveAt = nil
function autodriveQuest()
  if not mounted(Game.GetPlayer()) then return false, "not_in_vehicle" end
  clearWaypoint()
  pcall(function() Game.GetMappinSystem():UntrackMappin() end)
  questDriveAt = clock + 1.2
  return true, "quest_route"
end

function autodrive(mode)
  local sys = autoDriveSys()
  if not sys then return false, "no_autodrive" end
  local ok, err = pcall(function()
    if mode == "start" then
      local req = EnableAutoDriveRequest.new()
      req.isDelamain = false
      sys:QueueRequest(req)
    elseif mode == "roam" then
      local en = EnableAutoDriveRequest.new()
      en.isDelamain = false
      sys:QueueRequest(en)
      sys:QueueRequest(ToggleFreeRoamRequest.new())
    else
      sys:QueueRequest(DisableAutoDriveRequest.new())
    end
  end)
  if not ok then warnOnce("piloto_" .. mode, err) return false, "game_refused" end
  return true, "ok"
end

-- arg: "r,g,b;r,g,b;hue" (empty parts = leave unchanged).
function carColor(arg, reset)
  local veh = mounted(Game.GetPlayer())
  if not veh then return false, "not_in_vehicle" end
  local ok, err = pcall(function()
    local g = GenericTemplatePersistentData.new()
    if not reset then
      local p, s2, h = string.match(arg or "", "^([^;]*);?([^;]*);?([^;]*)$")
      local r1, g1, b1 = string.match(p or "", "(%d+),(%d+),(%d+)")
      if r1 then
        g.primaryColorDefined = true
        g.primaryColorR, g.primaryColorG, g.primaryColorB = tonumber(r1), tonumber(g1), tonumber(b1)
      end
      local r2, g2, b2 = string.match(s2 or "", "(%d+),(%d+),(%d+)")
      if r2 then
        g.secondaryColorDefined = true
        g.secondaryColorR, g.secondaryColorG, g.secondaryColorB = tonumber(r2), tonumber(g2), tonumber(b2)
      end
      local hue = tonumber(h or "")
      if hue then
        g.lightsColorDefined = true
        g.lightsColorHue = hue
      end
    end
    local tpl = VehicleVisualCustomizationTemplate.new()
    tpl.genericData = g
    local evt = NewVehicleVisualCustomizationEvent.new()
    evt.template = tpl
    evt.reset = reset or false
    veh:QueueEvent(evt)
  end)
  if not ok then warnOnce("pintura", err) return false, "game_refused" end
  return true, reset and "color_reset" or "color_set"
end

function carHorn()
  local veh = mounted(Game.GetPlayer())
  if not veh then return false, "not_in_vehicle" end
  local ok = pcall(function()
    veh:ToggleHorn(true)
    hornOffAt = clock + 0.6
  end)
  return ok, ok and "ok" or "game_refused"
end

-- ---------- Messages (in-game phone style) ----------
-- JournalManager: GetEntry(contact hash) -> GetFlattenedMessagesAndChoices(contact, out messages, out choices).
-- JournalPhoneMessage: GetText, GetSender (NPC/Player), GetImageID; JournalPhoneChoiceEntry: GetText, IsQuestImportant
-- Reply = mark the choice as Succeeded (ChangeEntryStateByHash), matching the in-game messages screen.
local openThread = nil        -- Contact ID for the conversation open on the phone.
local threadCache, threadAt = nil, -99
local choiceIndex = {}        -- id da escolha -> entry

local function u32(h)
  h = tonumber(h)
  if not h then return nil end
  if h < 0 then h = h + 4294967296 end
  return h
end

local function gtime(t)
  local out = nil
  pcall(function() out = { d = t:Days(), h = t:Hours(), m = t:Minutes() } end)
  if not out then pcall(function() out = { d = GameTime.Days(t), h = GameTime.Hours(t), m = GameTime.Minutes(t) } end) end
  return out
end

local function contactEntry(jm, id)
  local c = contactIndex[id]
  if not c or not c.hash then return nil end
  local ok, e = pcall(function() return jm:GetEntry(u32(c.hash)) end)
  return ok and e or nil
end

local function twoOut(fn)
  local ok, a, b = pcall(fn, nil, nil)
  if ok and type(a) == "table" then return a, (type(b) == "table" and b or {}) end
  local m, c = {}, {}
  pcall(fn, m, c)
  return m, c
end

local function buildThread(id)
  local jm = Game.GetJournalManager()
  local entry = contactEntry(jm, id)
  if not entry then return { contact = id, messages = {}, choices = {}, err = "no_entry" } end
  local msgs, choices = twoOut(function(m, c)
    if m then return jm:GetFlattenedMessagesAndChoices(entry, m, c) end
    return jm:GetFlattenedMessagesAndChoices(entry)
  end)
  local out = { contact = id, messages = {}, choices = {} }
  for _, msg in ipairs(msgs) do
    pcall(function()
      local m = { id = tostring(jm:GetEntryHash(msg)) }
      m.text = L(msg:GetText())
      -- Previously selected replies appear as JournalPhoneChoiceEntry items; these are V's lines.
      local isChoice = false
      pcall(function() isChoice = msg:IsA("gameJournalPhoneChoiceEntry") end)
      if not isChoice then
        local okS = pcall(function()
          local snd = EnumValueToString("gameMessageSender", eint(msg:GetSender()))
          m.me = snd == "Player"
        end)
        if not okS then isChoice = true end  -- No GetSender method: this is a choice.
      end
      if isChoice then m.me = true end
      pcall(function()
        local img = msg:GetImageID()
        if img and TDBID.IsValid(img) then
          m.image = true
          -- Attached image (gig target, product, etc.): UIIcon with atlas and part; the server extracts it.
          pcall(function()
            local rec = TweakDB:GetRecord(img)
            m.img = uiIcon(rec)
            if not m.img then pcall(function() m.img = uiIcon(rec:Icon()) end) end
          end)
        end
      end)
      pcall(function() m.t = gtime(jm:GetEntryTimestamp(msg)) end)
      pcall(function() m.read = jm:IsEntryVisited(msg) end)
      out.messages[#out.messages + 1] = m
      -- Opening a conversation marks it as read, as in the game.
      if m.read == false then pcall(function() jm:SetEntryVisited(msg, true) end) end
    end)
  end
  choiceIndex = {}
  for _, ch in ipairs(choices) do
    pcall(function()
      local st = EnumValueToString("gameJournalEntryState", eint(jm:GetEntryState(ch)))
      if st ~= "Active" then return end
      local cid = tostring(jm:GetEntryHash(ch))
      local item = { id = cid, text = L(ch:GetText()) }
      pcall(function() item.important = ch:IsQuestImportant() end)
      out.choices[#out.choices + 1] = item
      choiceIndex[cid] = ch
    end)
  end
  return out
end

local function openConversation(id)
  if not contactIndex[id] then readContacts() end
  if not contactIndex[id] then return false, "not_found" end
  openThread = id
  threadAt = -99
  return true, "ok"
end

local function sendReply(cid)
  local jm = Game.GetJournalManager()
  local ch = choiceIndex[cid]
  if not ch then return false, "no_reply" end
  local ok, err = pcall(function()
    jm:SetEntryVisited(ch, true)
    jm:ChangeEntryStateByHash(u32(cid), gameJournalEntryState.Succeeded, JournalNotifyOption.Notify)
  end)
  if not ok then warnOnce("responder", err) return false, "game_refused" end
  threadAt = -99
  return true, "replied"
end

local function currentThread()
  if not openThread then return nil end
  if clock - threadAt > 1.5 then
    local ok, t = pcall(buildThread, openThread)
    if not ok then t = { contact = openThread, messages = {}, choices = {}, err = tostring(t) } end
    -- If an empty read follows a populated one while the journal changes, keep the last valid conversation.
    if #t.messages == 0 and threadCache and threadCache.contact == openThread and #threadCache.messages > 0 then
      t.messages = threadCache.messages
      if #t.choices == 0 then t.choices = threadCache.choices end
    end
    probe.thread = { contact = openThread, msgs = #t.messages, choices = #t.choices, err = t.err }
    threadCache = t
    threadAt = clock
  end
  return threadCache
end

-- ---------- Job details ("..." button) ----------
local questDetailId, questDetailCache, questDetailAt = nil, nil, -99

local function entryStateName(jm, e)
  local s = nil
  pcall(function() s = EnumValueToString("gameJournalEntryState", eint(jm:GetEntryState(e))) end)
  return s
end

local function buildQuestDetail(id)
  local jm = Game.GetJournalManager()
  local q = questIndex[id]
  if not q then return { id = id, err = "not_found" } end
  local all = JournalRequestStateFilter.new()
  all.active, all.inactive, all.succeeded, all.failed = true, false, true, true
  local d = { id = id, objectives = {} }
  pcall(function() d.level = tonumber(jm:GetRecommendedLevel(q)) end)
  pcall(function()
    local rec = jm:GetDistrict(q)
    d.district = L(rec:LocalizedName())
  end)
  local function walk(e, depth)
    if depth > 3 then return end
    for _, ch in ipairs(children(jm, e, all)) do
      local isDesc, isObj = false, false
      pcall(function() isDesc = ch:IsA("gameJournalQuestDescription") end)
      pcall(function() isObj = ch:IsA("gameJournalQuestObjective") end)
      if isDesc then
        local st = entryStateName(jm, ch)
        local txt = nil
        pcall(function() txt = L(ch:GetDescription()) end)
        if txt and (st == "Active" or not d.description) then d.description = txt end
      elseif isObj then
        local o = { state = entryStateName(jm, ch) }
        pcall(function() o.text = L(ch:GetDescription()) end)
        pcall(function() o.optional = jm:GetIsObjectiveOptional(ch) end)
        pcall(function()
          local total = jm:GetObjectiveTotalCounter(ch)
          if total and total > 0 then o.count, o.total = jm:GetObjectiveCurrentCounter(ch), total end
        end)
        if o.text then d.objectives[#d.objectives + 1] = o end
      else
        walk(ch, depth + 1)
      end
    end
  end
  walk(q, 0)
  return d
end

local function currentQuestDetail()
  if not questDetailId then return nil end
  if clock - questDetailAt > 3 then
    local ok, d = pcall(buildQuestDetail, questDetailId)
    questDetailCache = ok and d or { id = questDetailId, err = tostring(d) }
    questDetailAt = clock
  end
  return questDetailCache
end

-- ---------- Subtitles (conversation text) ----------
-- UIGameData.ShowDialogLine: array<scnDialogLineData{text, speakerName, duration}>
local subtitle, subtitleSeq, lastLineKey = nil, 0, nil
local subtitleLog = {}

local function readSubtitle()
  pcall(function()
    local defs = GetAllBlackboardDefs().UIGameData
    local bb = Game.GetBlackboardSystem():Get(defs)
    local lines = bb:GetVariant(defs.ShowDialogLine)
    pcall(function() lines = FromVariant(lines) end)
    if type(lines) ~= "table" or #lines == 0 then return end
    local line = lines[#lines]
    local text = L(line.text)
    local speaker = L(line.speakerName)
    if not text or text == "" then return end
    local key = text .. "|" .. tostring(speaker)
    if key == lastLineKey then return end
    lastLineKey = key
    subtitleSeq = subtitleSeq + 1
    local dur = tonumber(line.duration) or 3
    subtitle = { text = text, speaker = speaker, seq = subtitleSeq, until_ = clock + math.max(2.5, dur + 1) }
    subtitleLog[#subtitleLog + 1] = { text = text, speaker = speaker, seq = subtitleSeq, at = clock }
    while #subtitleLog > 12 do table.remove(subtitleLog, 1) end
  end)
  if subtitle and clock > subtitle.until_ then subtitle = nil end
  -- Conversation history disappears 20 seconds after the last line.
  if #subtitleLog > 0 and clock - subtitleLog[#subtitleLog].at > 20 then subtitleLog = {} end
  if not subtitle and #subtitleLog == 0 then return nil end
  local log = {}
  for i, l in ipairs(subtitleLog) do log[i] = { text = l.text, speaker = l.speaker, seq = l.seq } end
  return { now = subtitle and { text = subtitle.text, speaker = subtitle.speaker, seq = subtitle.seq } or nil, log = log }
end

-- ---------- Vehicle shop (Autofixer) and offers ----------
-- VehicleOffer_Record: Name, Price (ValueAssignment), PreviewImage (JournalIcon), BrandName,
-- Description, AvailabilityFact (for sale), OwnershipFact (owned). Buying = payment + ownership fact,
-- matching the in-game page; the mod also unlocks the vehicle if its record is known.

local function factGet(name)
  if not name or name == "" or name == "None" then return 0 end
  local ok, v = pcall(function() return Game.GetQuestsSystem():GetFactStr(name) end)
  return ok and (tonumber(v) or 0) or 0
end

local function iconOf(ic)
  local img = nil
  pcall(function()
    img = { part = cnameStr(ic:AtlasPartName()) }
    pcall(function()
      local h = ic:AtlasResourcePath().hash
      if h then img.atlas = tostring(h):gsub("ULL$", ""):gsub("LL$", "") end
    end)
  end)
  if img and (not img.part or img.part == "None") then img = nil end
  return img
end

local function recId(rec)
  local id = nil
  pcall(function() id = TDBID.ToStringDEBUG(rec:GetID()) end)
  if not id or id == "" then pcall(function() local r = rec:GetID(); id = string.format("%d:%d", r.hash, r.length) end) end
  return id
end

-- Price: CET does not expose Value() on the price record; read the ".value" flat through TweakDB.
local PRICE_FIELDS = { "overrideValue", "value", "baseValue", "price" }
local function offerPrice(rec, id)
  local p = nil
  -- The price is an EconomicAssignment; its value is stored in OverrideValue / ".overrideValue".
  pcall(function() p = rec:Price():OverrideValue() end)
  if not p or p == 0 then
    pcall(function()
      local pname = TDBID.ToStringDEBUG(rec:Price():GetID())
      for _, f in ipairs(PRICE_FIELDS) do
        local v = TweakDB:GetFlat(pname .. "." .. f)
        if type(v) == "number" and v > 0 then p = v; probe.priceField = f; break end
      end
    end)
  end
  if not p or p == 0 then pcall(function() p = rec:Price():Value() end) end
  if not p then
    pcall(function()
      local pr = rec:Price()
      p = TweakDB:GetFlat(TDBID.ToStringDEBUG(pr:GetID()) .. ".value")
    end)
  end
  if (not p or p == 0) and id then
    pcall(function()
      local pid = TweakDB:GetFlat(id .. ".price")
      local pname = TDBID.ToStringDEBUG(pid)
      if not probe.priceRec then probe.priceRec = pname end
      for _, f in ipairs(PRICE_FIELDS) do
        local v = TweakDB:GetFlat(pname .. "." .. f)
        if type(v) == "number" and v > 0 then p = v; probe.priceField = f; break end
      end
    end)
  end
  return round(tonumber(p))
end

local function readOffers()
  local list, index, raw = {}, {}, {}
  local recs = nil
  pcall(function() recs = TweakDB:GetRecords("gamedataVehicleOffer_Record") end)
  for _, rec in ipairs(recs or {}) do
    pcall(function()
      local o = { id = recId(rec) }
      pcall(function() o.name = L(rec:Name()) end)
      pcall(function() o.brand = cnameStr(rec:BrandName()) end)
      pcall(function() o.brandName = L(VehicleShopUtils.BrandToLocKey(rec:BrandName())) end)
      pcall(function() o.desc = L(rec:Description()) end)
      o.price = offerPrice(rec, o.id)
      local availF, ownF
      pcall(function() availF = cnameStr(rec:AvailabilityFact()) end)
      pcall(function() ownF = cnameStr(rec:OwnershipFact()) end)
      o.available = (not availF or availF == "" or availF == "None") or factGet(availF) > 0
      o.owned = factGet(ownF) > 0
      -- Cars unlocked by El Capitan contracts ("courier" facts); the app completes the list by name.
      local tag = string.lower(tostring(o.id) .. " " .. tostring(availF) .. " " .. tostring(ownF))
      if tag:find("courier") then o.cap = true end
      if availF and availF ~= "" and availF ~= "None" then o.af = availF end
      o.img = iconOf(rec:PreviewImage())
      pcall(function() o.mg = rec:HasMachineGun() or nil end)
      pcall(function() o.rl = rec:HasRocketLauncher() or nil end)
      list[#list + 1] = o
      index[o.id] = { rec = rec, price = o.price, availF = availF, ownF = ownF, available = o.available, owned = o.owned, name = o.name }
      if #raw < 6 then raw[#raw + 1] = { id = o.id, availF = availF, ownF = ownF, price = o.price } end
    end)
  end
  offers, offerIndex = list, index
  probe.offersRaw = raw
  probe.offersCount = #list

  -- Other offers (apartments, etc.) are read-only.
  local apts = {}
  pcall(function()
    for _, rec in ipairs(TweakDB:GetRecords("gamedataPurchaseOffer_Record") or {}) do
      pcall(function()
        local id = recId(rec)
        if index[id] then return end
        local a = { id = id }
        pcall(function() a.name = L(rec:Name()) end)
        a.price = offerPrice(rec, id)
        a.img = iconOf(rec:PreviewImage())
        if a.name then apts[#apts + 1] = a end
      end)
    end
  end)
  apartments = apts
  probe.apartmentsCount = #apts
end

local function vehicleIdForOffer(o)
  -- Try to find the vehicle record from the offer ID (e.g. "...._offer").
  local cands = {}
  local id = o and o.id or ""
  cands[#cands + 1] = id:gsub("_offer$", ""):gsub("Offer$", "")
  cands[#cands + 1] = id:gsub("^[%w_]+%.", "Vehicle.")
  for _, c in ipairs(cands) do
    local ok, r = pcall(function() return TweakDB:GetRecord(c) end)
    if ok and r then
      local isVeh = false
      pcall(function() isVeh = r:IsA("gamedataVehicle_Record") end)
      if isVeh then return c end
    end
  end
  return nil
end

local function buyOffer(id)
  local o = offerIndex[id]
  if not o then readOffers(); o = offerIndex[id] end
  if not o then return false, "not_found" end
  if o.owned then return false, "already_owned" end
  if not o.available then return false, "not_available" end
  local player = Game.GetPlayer()
  local money = 0
  pcall(function() money = Game.GetTransactionSystem():GetItemQuantity(player, MarketSystem.Money()) end)
  if not o.price or money < o.price then return false, "no_money" end
  local ok, err = pcall(function() Game.GetTransactionSystem():RemoveItem(player, MarketSystem.Money(), o.price) end)
  if not ok then warnOnce("compra_pagar", err) return false, "game_refused" end
  pcall(function() Game.GetQuestsSystem():SetFactStr(o.ownF, 1) end)
  local vid = vehicleIdForOffer({ id = id })
  if vid then pcall(function() Game.GetVehicleSystem():EnablePlayerVehicle(vid, true, false) end) end
  log(string.format("purchased %s for %s (fact %s, vehicle %s)", tostring(o.name), tostring(o.price), tostring(o.ownF), tostring(vid)))
  readOffers()
  readVehicles()
  return true, "purchased"
end

-- ---------- Web (in-game websites) ----------
local function readSites()
  local jm = Game.GetJournalManager()
  local ctx = JournalRequestContext.new()
  ctx.stateFilter = stateFilter(true)
  local list = outArray(function(out)
    if out then return jm:GetInternetSites(ctx, out) end
    return jm:GetInternetSites(ctx)
  end)
  local out = {}
  for _, s in ipairs(list) do
    pcall(function()
      local item = { id = tostring(jm:GetEntryHash(s)) }
      for _, fn in ipairs({ "GetShortName", "GetFullName", "GetTitle", "GetLinkName", "GetName" }) do
        if not item.name then pcall(function() item.name = L(s[fn](s)) end) end
      end
      pcall(function() item.uid = s:GetId() end)
      out[#out + 1] = item
    end)
  end
  sites = out
  probe.sites = out
end

-- ---------- modo imersivo ----------
-- Disable the in-game minimap and HUD markers (restore them on exit), and block the keys used to
-- summon vehicles, use the pocket radio and enable autodrive. The phone interface keeps working,
-- porque o mod usa outros caminhos (VehicleSystem, eventos e pedidos diretos).
local SETTINGS_FILE = "neuroport_settings.txt"
local immersive = false
local hudPrev = {}
-- HUD elements hidden by immersive mode (selected individually on the phone).
local immHide = {}
local immHideLoaded = false
-- Valid HUD setting names (Settings > Interface > HUD). Fixed list verified in-game;
-- any other name can crash the game in GetVar. This must be defined before loadSettings.
local HUD_VARS = { minimap = true, healthbar = true, stamina_oxygen = true, npc_healthbar = true, ammo_counter = true,
  input_hints = true, action_buttons = true, activity_log = true, crosshairs = true, quest_tracker = true,
  object_markers = true, npc_names = true, wanted_level = true, npc_nameplates = true, crouch_indicator = true,
  vehicle_hud = true, hud_markers = true }

local function saveSettings()
  local f = io.open(SETTINGS_FILE, "w")
  if not f then return end
  f:write("immersive=" .. (immersive and "1" or "0") .. "\n")
  for k, v in pairs(hudPrev) do f:write("prev_" .. k .. "=" .. (v and "1" or "0") .. "\n") end
  for k, v in pairs(immHide) do if v then f:write("hide_" .. k .. "=1\n") end end
  f:write("hide__v2=1\n")
  f:close()
end

local function loadSettings()
  local f = io.open(SETTINGS_FILE, "r")
  if not f then return end
  -- Preferences saved by the old logic (before v0.9.5) are discarded; everything starts visible.
  local pending, v2 = {}, false
  for line in f:lines() do
    local k, v = line:match("^([%w_]+)=(%d)")
    if k == "immersive" then immersive = v == "1"
    elseif k == "hide__v2" then v2 = true
    elseif k and k:find("^prev_") then
      local n = k:sub(6)
      if HUD_VARS[n] then hudPrev[n] = v == "1" end
    elseif k and k:find("^hide_") and not k:find("^hide__") then pending[#pending + 1] = k:sub(6)
    end
  end
  f:close()
  if v2 then for _, n in ipairs(pending) do if HUD_VARS[n] then immHide[n] = true end end end
  immHideLoaded = true
end

local function setHud(name, value)
  if not HUD_VARS[name] then return false end
  return pcall(function()
    local var = Game.GetSettingsSystem():GetVar("/interface/hud", name)
    var:SetValue(value)
  end)
end

local function applyHud()
  local want = {}
  if immersive then for name, on in pairs(immHide) do if on then want[name] = true end end end
  -- Restore elements that should no longer be hidden.
  for name, prev in pairs(hudPrev) do
    if not want[name] then setHud(name, prev); hudPrev[name] = nil end
  end
  for name in pairs(want) do
    if HUD_VARS[name] and hudPrev[name] == nil then
      pcall(function() hudPrev[name] = Game.GetSettingsSystem():GetVar("/interface/hud", name):GetValue() end)
    end
    setHud(name, false)
  end
  pcall(function() Game.GetSettingsSystem():ConfirmChanges() end)
end

-- List of HUD elements that the game allows users to show or hide (Settings > Interface > HUD).
local hudVarsCache = nil
local function hudVars()
  if hudVarsCache then return hudVarsCache end
  local out = {}
  pcall(function()
    local grp = Game.GetSettingsSystem():GetGroup("/interface/hud")
    for _, var in ipairs(grp:GetVars(false)) do
      pcall(function()
        local v = var:GetValue()
        if type(v) == "boolean" then
          local n = var:GetName()
          n = type(n) == "string" and n or NameToString(n)
          local label = nil
          pcall(function()
            local dn = var:GetDisplayName()
            local key = type(dn) == "string" and dn or NameToString(dn)
            local txt = GetLocalizedText(key)
            if txt and txt ~= "" and txt ~= key then label = txt end
          end)
          out[#out + 1] = { n = n, label = label }
        end
      end)
    end
  end)
  if #out > 0 then hudVarsCache = out end
  probe.hudVars = out
  return out
end

local function immToggle(name)
  if type(name) ~= "string" or not HUD_VARS[name] then return false, "bad_arg" end
  immHide[name] = not immHide[name] or nil
  immHideLoaded = true
  applyHud()
  saveSettings()
  return true, "ok"
end

-- "Hide all": toggle every element at once ("1" hides everything; "0" shows everything).
local function immAll(arg)
  local hide = tostring(arg) == "1"
  for n in pairs(HUD_VARS) do immHide[n] = hide or nil end
  immHideLoaded = true
  applyHud()
  saveSettings()
  return true, "ok"
end

local function immState()
  local out = {}
  for _, v in ipairs(hudVars()) do out[#out + 1] = { n = v.n, l = v.label, h = immHide[v.n] and true or nil } end
  return out
end

local function setImmersive(on)
  immersive = on and true or false
  applyHud()
  saveSettings()
  return true, immersive and "immersive_on" or "immersive_off"
end

local overrides = {}
local function registerOverrides()
  local function ov(cls, fn, cb)
    local ok, err = pcall(Override, cls, fn, cb)
    overrides[cls .. "." .. fn] = ok
    if not ok then warnOnce("override_" .. fn, err) end
  end
  ov("QuickSlotsManager", "SummonActiveVehicle", function(self, force, wrapped)
    if immersive then return end
    return wrapped(force)
  end)
  ov("QuickSlotsManager", "SummonVehicle", function(self, force, vtype, veh, road, wrapped)
    if immersive then return end
    return wrapped(force, vtype, veh, road)
  end)
  ov("PocketRadio", "HandleInputAction", function(self, action, wrapped)
    if immersive then return end
    return wrapped(action)
  end)
  ov("AutoDriveSystem", "OnAction", function(self, action, consumer, wrapped)
    if immersive then return false end
    return wrapped(action, consumer)
  end)
  -- HUD job objective: retain the controller and hide it when no job is tracked.
  probe.trackerHook = {}
  local OBS = ObserveAfter or Observe
  for _, fn in ipairs({ "OnInitialize", "OnTrackedEntryChanges", "OnStateChanges", "UpdateTrackerData", "OnTrackedMappinUpdated" }) do
    local ok = pcall(OBS, "QuestTrackerGameController", fn, function(self)
      trackerCtrl = self
      if not probe.trackerHook[fn] then probe.trackerHook[fn] = "fired" end
      applyTrackerVis()
    end)
    overrides["QuestTrackerGameController." .. fn] = ok
  end
  probe.overrides = overrides
end

-- ---------- Photo mode ----------
photoCheckAt = nil
-- The game opens photo mode with a PhotoModeEnableEvent sent to the UI system.
-- Each attempt is recorded in probe.photo to identify the working method.
local function photoMode()
  probe.photo = {}
  local function mk()
    local e = PhotoModeEnableEvent.new()
    pcall(function() e.enable = true end)
    pcall(function() e:SetEnable(true) end)
    return e
  end
  -- PhotoModeEnableEvent is not exposed in the game RTTI; the server opens photo mode
  -- by pressing N in the game window. Here we only confirm that it can be opened.
  local tries = {}
  local any = true
  for _, tr in ipairs(tries) do
    local ok, err = pcall(tr[2])
    probe.photo[tr[1]] = ok and "ok" or tostring(err)
    if ok then any = true; break end
  end
  pcall(function() probe.photo.canEnable = Game.GetPhotoModeSystem():CanPhotoModeBeEnabled() end)
  -- Actual types and methods (to find the correct path if the event does not open).
  pcall(function() probe.photo.eventType = DumpType("PhotoModeEnableEvent", true) end)
  pcall(function() probe.photo.systemType = DumpType("gamePhotoModeSystem", true) end)
  photoCheckAt = clock + 2
  return any, any and "photo_mode" or "game_refused"
end

local function writeProbe()
  probe.version = VERSION
  local f = io.open("probe.json", "w")
  if f then f:write(encode(probe)) f:close() end
end

---------------------------------------------------------------------------
-- File bridge.
---------------------------------------------------------------------------
local function pushAck(id, ok, msg, action)
  acks[#acks + 1] = { id = tostring(id), ok = ok, msg = msg, action = action }
  while #acks > 20 do table.remove(acks, 1) end
end

local function readInbox()
  local f = io.open(INBOX, "r")
  if not f then return {} end
  local txt = f:read("*a") or ""
  f:close()
  local cmds = {}
  for line in txt:gmatch("[^\n]+") do
    line = line:gsub("\r$", "")
    local id, action, arg = line:match("^(%d+)\t([^\t]*)\t(.*)$")
    -- idStr is returned unchanged in the acknowledgement (avoids LuaJIT scientific notation).
    if id then cmds[#cmds + 1] = { id = tonumber(id), idStr = id, action = action, arg = arg } end
  end
  return cmds
end

local handlers = {
  summon = function(arg) return summon(arg) end,
  call = function(arg) return startCall(arg) end,
  hangup = function() return endCall() end,
  call_answer = function() return pickUp(false) end,
  thread = function(arg) return openConversation(arg) end,
  buy = function(arg) return buyOffer(arg) end,
  shop_refresh = function() readOffers(); readSites(); writeWorld(); return true, nil end,
  immersive_on = function() return setImmersive(true) end,
  imm_toggle = function(arg) return immToggle(arg) end,
  imm_all = function(arg) return immAll(arg) end,
  shard_read = function(arg) return shardRead(arg) end,
  immersive_off = function() return setImmersive(false) end,
  photo_mode = function() return photoMode() end,
  thread_close = function() openThread = nil; threadCache = nil; return true, "ok" end,
  reply = function(arg) return sendReply(arg) end,
  quest_details = function(arg) questDetailId = arg; questDetailAt = -99; return true, "ok" end,
  quest_details_close = function() questDetailId = nil; questDetailCache = nil; return true, "ok" end,
  call_reject = function() return pickUp(true) end,
  refresh = function() nextLists = 0 nextPois = 0 return true, nil end,
  waypoint = function(arg) return setWaypoint(arg) end,
  track = function(arg) local ok, m = trackQuest(arg) writeWorld() return ok, m end,
  untrack = function() local ok, m = untrackQuest() writeWorld() return ok, m end,
  clearwp = function() return clearWaypoint() end,
  ping = function() return true, "pong" end,
  radio_on = function() return radioPower(true) end,
  radio_off = function() return radioPower(false) end,
  radio_set = function(arg) return radioSet(tonumber(arg)) end,
  radio_next = function() return radioStep(1) end,
  radio_prev = function() return radioStep(-1) end,
  radio_vol = function(arg) return radioVolume(tonumber(arg) or 1) end,
  ad_start = function() return autodrive("start") end,
  ad_quest = function() return autodriveQuest() end,
  ad_stop = function() return autodrive("stop") end,
  color = function(arg) return carColor(arg) end,
  color_reset = function() return carColor(nil, true) end,
  horn = function() return carHorn() end,
}

local function processInbox()
  local player = getPlayer()
  for _, c in ipairs(readInbox()) do
    if c.id > lastCmdId then
      lastCmdId = c.id
      stats.cmds = stats.cmds + 1
      local h = handlers[c.action]
      if not h then
        pushAck(c.idStr, false, "unknown_action", c.action)
      elseif not player and c.action ~= "ping" then
        pushAck(c.idStr, false, "load_save", c.action)
      else
        local ok, okRes, msg = pcall(h, c.arg)
        if not ok then
          warnOnce("cmd_" .. c.action, okRes)
          pushAck(c.idStr, false, "mod_error", c.action)
        else
          pushAck(c.idStr, okRes ~= false, msg, c.action)
        end
      end
      nextWrite = 0 -- Respond immediately.
    end
  end
end

local function writeState()
  local player = getPlayer()
  local s = { v = 1, mod = VERSION, inGame = player ~= nil, acks = acks }
  if player then
    s.player = readPlayer(player)
    local okSt, st = pcall(readStatus, player)
    if okSt then s.status = st end
    s.vehicles = cache.vehicles
    s.contacts = cache.contacts
    s.activeVehicle = activeVehicle
    s.call = readCall()
    s.vehicle = readCar(player)
    s.thread = currentThread()
    s.subs = readSubtitle()
    s.questDetail = currentQuestDetail()
    s.radio = readRadio(player)
    s.pos = readPosition(player)
    s.district = district
    if waypoint then
      s.waypoint = { x = round(waypoint.x), y = round(waypoint.y), z = round(waypoint.z), cat = waypoint.cat }
    end
  end
  s.lang = gameLang
  s.immersive = immersive
  if clock - (immStateAt or -99) > 5 then immStateAt = clock; immStateCache = immState() end
  s.immHud = immStateCache
  local f = io.open(STATE, "w")
  if not f then warnOnce("gravar_estado", "could not open state.json") return end
  f:write(encode(s))
  f:close()
  stats.writes = stats.writes + 1
end

---------------------------------------------------------------------------
-- eventos do CET
---------------------------------------------------------------------------
registerForEvent("onInit", function()
  loadSettings()
  registerOverrides()
  -- Ignore commands left over from a previous session.
  for _, c in ipairs(readInbox()) do
    if c.id > lastCmdId then lastCmdId = c.id end
  end
  log("v" .. VERSION .. " loaded")
end)

-- After untracking: disable the HUD objective and re-enable it about 0.4 seconds later to redraw it
-- without a job. Only do this if it is visible (immersive mode may be hiding it).
local hudKickAt = 0
local trackerVisAt = 0
local function hudKickStep()
  if hudKick == 0 then
    local on = false
    pcall(function() on = Game.GetSettingsSystem():GetVar("/interface/hud", "quest_tracker"):GetValue() == true end)
    if not on then hudKick = nil return end
    setHud("quest_tracker", false)
    pcall(function() Game.GetSettingsSystem():ConfirmChanges() end)
    hudKick, hudKickAt = 1, clock + 0.4
  elseif hudKick == 1 and clock >= hudKickAt then
    setHud("quest_tracker", true)
    pcall(function() Game.GetSettingsSystem():ConfirmChanges() end)
    hudKick = nil
  end
end

registerForEvent("onUpdate", function(dt)
  clock = clock + dt
  if trackerCtrl and clock >= (trackerVisAt or 0) then trackerVisAt = clock + 0.5; applyTrackerVis() end
  if questDriveAt and clock >= questDriveAt then
    questDriveAt = nil
    local ok, msg = autodrive("start")
    if not ok then warnOnce("piloto_missao", msg) end
  end
  if hornOffAt and clock >= hornOffAt then
    hornOffAt = nil
    pcall(function() Game.GetMountedVehicle(Game.GetPlayer()):ToggleHorn(false) end)
  end
  if clock >= nextPoll then
    nextPoll = clock + POLL_EVERY
    processInbox()
  end
  local player = getPlayer()
  if player and not wasInGame then
    -- A newly loaded save invalidates pin IDs from the previous session.
    waypoint, nextLists, nextPois = nil, 0, 0
  end
  wasInGame = player ~= nil
  if photoCheckAt and clock >= photoCheckAt then
    photoCheckAt = nil
    pcall(function() probe.photo.activeLater = Game.GetPhotoModeSystem():IsPhotoModeActive() end)
    pcall(writeProbe)
  end
  if clock >= nextLists then
    nextLists = clock + LISTS_EVERY
    readLanguage()
    if player then
      readVehicles()
      readContacts()
      if clock - (shardsAt or -99) > 45 then
        shardsAt = clock
        local okS, errS = pcall(readShards)
        if not okS then probe.shardsErr = tostring(errS) end
      end
      if clock - (shopAt or -99) > 30 then
        shopAt = clock
        pcall(readOffers)
        pcall(readSites)
        writeProbe()
      end
      if immersive and not hudApplied then hudApplied = true; applyHud() end
    end
  end
  if player and clock >= nextPois then
    nextPois = clock + POIS_EVERY
    scanPois(player)
    readJournal()
    writeWorld()
  end
  if clock >= nextWrite then
    nextWrite = clock + WRITE_EVERY
    writeState()
  end
end)

registerForEvent("onShutdown", function()
  if immersive then
    for name, prev in pairs(hudPrev) do setHud(name, prev) end
    pcall(function() Game.GetSettingsSystem():ConfirmChanges() end)
  end
end)

registerForEvent("onOverlayOpen", function() overlayOpen = true end)
registerForEvent("onOverlayClose", function() overlayOpen = false end)

registerForEvent("onDraw", function()
  if not overlayOpen then return end
  if ImGui.Begin("Neuroport") then
    ImGui.Text("Version " .. VERSION .. (getPlayer() and "  |  in game" or "  |  out of game"))
    ImGui.Text(string.format("Vehicles: %d   Contacts: %d   Markers: %d (%s)", #cache.vehicles, #cache.contacts, #pois, poisStatus))
    ImGui.Text("Game language: " .. tostring(gameLang) .. "   Jobs: " .. #journal.quests)
    ImGui.Text(string.format("Commands: %d   Saves: %d", stats.cmds, stats.writes))
    if ImGui.Button("Reload lists") then nextLists = 0 end
    ImGui.Separator()
    local any = false
    for k, msg in pairs(errors) do
      any = true
      ImGui.TextWrapped(k .. ": " .. msg)
    end
    if not any then ImGui.Text("No errors.") end
  end
  ImGui.End()
end)
