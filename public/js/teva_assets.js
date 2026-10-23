/* TEVA HQ asset manifest — role presets, workstation alignment, optional GLB paths. */
(function (root) {
  'use strict';

  var L = root.LAYOUT || root.OFFICE_LAYOUT;
  var DEFAULT_MANIFEST = {
    version: 2,
    workstation: {
      assetId: 'cyberpunk-workstation-procedural',
      seatHeight: 0.62,
      // Typing fix (2026-10-23): the avatar sits ON the chair (chair at chairLocalZ, desk front edge at
      // -deskD/2 = -0.64), just forward of the chair centre, and faces +z (the monitors). Avatars (capsules and
      // the GLB) face +z in their own space, so no extra rotation. Was z -0.52 (inside the desk) and rotation PI
      // (back to the monitors).
      agentLocal: { x: 0, z: -0.85 },
      agentRotation: 0,
      chairLocalZ: -0.9
    },
    rolePresets: {}
  };

  var manifest = null;
  var manifestUrl = '/assets/asset-manifest.json';
  var modelCache = {};
  var modelLoads = {};

  function deepMerge(base, extra) {
    if (!extra || typeof extra !== 'object') return base;
    Object.keys(extra).forEach(function (key) {
      if (extra[key] && typeof extra[key] === 'object' && !Array.isArray(extra[key])) {
        base[key] = deepMerge(base[key] && typeof base[key] === 'object' ? Object.assign({}, base[key]) : {}, extra[key]);
      } else {
        base[key] = extra[key];
      }
    });
    return base;
  }

  function normalizeManifest(raw) {
    raw = raw || {};
    var out = deepMerge(Object.assign({}, DEFAULT_MANIFEST), raw);
    out.rolePresets = out.rolePresets || {};
    out.assets = Array.isArray(raw.assets) ? raw.assets.slice() : [];
    return out;
  }

  function setManifest(raw) {
    manifest = normalizeManifest(raw);
    return manifest;
  }

  function getManifest() {
    return manifest || normalizeManifest(null);
  }

  function loadManifest(url, callback) {
    url = url || manifestUrl;
    if (typeof fetch === 'undefined') {
      setManifest(null);
      if (callback) callback(getManifest());
      return;
    }
    fetch(url, { cache: 'no-cache' })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (json) {
        setManifest(json);
        if (callback) callback(getManifest());
      })
      .catch(function () {
        setManifest(null);
        if (callback) callback(getManifest());
      });
  }

  function roleKey(agent) {
    agent = agent || {};
    var id = String(agent.id || '');
    if (id === 'supervisor' || id === 'pm' || id === 'ba') return 'supervision';
    var role = String(agent.role || agent.avatar && agent.avatar.rolePreset || '').toLowerCase();
    var zone = String((agent.avatar && agent.avatar.zone) || agent.zone || '').toLowerCase();
    if (role.indexOf('dev') !== -1 || role.indexOf('engineer') !== -1 || zone.indexOf('engineer') !== -1) return 'development';
    if (role.indexOf('qa') !== -1 || role.indexOf('test') !== -1) return 'qa';
    if (role.indexOf('research') !== -1 || role.indexOf('analyst') !== -1 || zone.indexOf('research') !== -1) return 'research';
    if (role.indexOf('super') !== -1 || role.indexOf('lead') !== -1 || role.indexOf('orchestr') !== -1) return 'supervision';
    if (role.indexOf('data') !== -1 || role.indexOf('content') !== -1 || role.indexOf('writer') !== -1) return 'data';
    if (role.indexOf('growth') !== -1 || role.indexOf('market') !== -1) return 'business';
    return 'default';
  }

  function getRolePreset(agent) {
    var m = getManifest();
    var key = roleKey(agent);
    return m.rolePresets[key] || m.rolePresets.default || null;
  }

  function findAssetEntry(id) {
    var m = getManifest();
    return (m.assets || []).filter(function (a) { return a && a.id === id; })[0] || null;
  }

  function findAssetsByType(type) {
    var wanted = String(type || '').toLowerCase();
    return getManifest().assets.filter(function (asset) {
      return asset && String(asset.type || '').toLowerCase() === wanted;
    });
  }

  function assetForWorkstation(config) {
    config = config || {};
    return findAssetEntry(config.assetId || 'cyberpunk-workstation-procedural');
  }

  function assetForRoom(id) {
    return findAssetEntry(id) || null;
  }

  // Load optional environment/workstation models without making them a hard
  // dependency of the office. A missing loader, model, or texture falls back
  // to the procedural builder through the null callback result.
  function loadModelAsset(id, callback) {
    callback = typeof callback === 'function' ? callback : function () {};
    var asset = findAssetEntry(id);
    if (!asset || !asset.model || !root.THREE || !root.THREE.GLTFLoader) {
      callback(null, asset);
      return;
    }
    if (modelCache[id]) {
      callback(modelCache[id], asset);
      return;
    }
    if (modelLoads[id]) {
      modelLoads[id].push(callback);
      return;
    }
    modelLoads[id] = [callback];
    var finish = function (model) {
      if (model) modelCache[id] = model;
      var callbacks = modelLoads[id] || [];
      delete modelLoads[id];
      callbacks.forEach(function (done) { done(model || null, asset); });
    };
    try {
      new root.THREE.GLTFLoader().load(asset.model, function (gltf) {
        finish(gltf && gltf.scene ? gltf.scene : null);
      }, undefined, function () { finish(null); });
    } catch (err) {
      finish(null);
    }
  }

  function clearModelCache() {
    modelCache = {};
    modelLoads = {};
  }

  function assetForAgent(agent, preset) {
    agent = agent || {};
    preset = preset || getRolePreset(agent);
    var avatar = agent.avatar || {};
    var id = avatar.assetId || agent.assetId || (preset && preset.assetId);
    return id ? findAssetEntry(id) : null;
  }

  function enrichAgent(agent) {
    agent = agent || {};
    var preset = getRolePreset(agent);
    if (!preset) return agent;
    var avatar = Object.assign({}, agent.avatar || {});
    var asset = assetForAgent(agent, preset);
    if (asset) {
      avatar.assetId = asset.id;
      if (asset.model && !avatar.model) avatar.model = asset.model;
      if (asset.scale != null && avatar.scale == null) avatar.scale = asset.scale;
      if (asset.animations && typeof asset.animations === 'object' && !Array.isArray(asset.animations)) {
        avatar.animations = Object.assign({}, asset.animations, avatar.animations || {});
      }
      if (asset.seated) avatar.seated = deepMerge(Object.assign({}, avatar.seated || {}), asset.seated);
    }
    if (preset.model && !avatar.model) avatar.model = preset.model;
    if (preset.scale != null && avatar.scale == null) avatar.scale = preset.scale;
    if (preset.animations) avatar.animations = Object.assign({}, preset.animations, avatar.animations || {});
    if (preset.fallback) avatar.fallback = Object.assign({}, preset.fallback, avatar.fallback || {});
    if (preset.seated) avatar.seated = deepMerge(Object.assign({}, avatar.seated || {}), preset.seated);
    if (preset.appearance) avatar.appearance = Object.assign({}, preset.appearance, avatar.appearance || {});
    return Object.assign({}, agent, { avatar: avatar });
  }

  function seatKeyForAgent(agent) {
    agent = agent || {};
    if (agent.id && L && L.seats && L.seats[agent.id]) return agent.id;
    var ws = agent.avatar && agent.avatar.workstation;
    if (ws && L && L.seats && L.seats[ws]) return ws;
    if (agent.home && L && L.demoHomes && L.demoHomes[agent.home]) return agent.home;
    return agent.id || 'center';
  }

  function workstationConfig(seatKey) {
    var m = getManifest();
    var base = m.workstation || DEFAULT_MANIFEST.workstation;
    if (L && L.workstations && L.workstations[seatKey]) {
      return deepMerge(Object.assign({}, base), L.workstations[seatKey]);
    }
    return base;
  }

  function resolveWorkstationOrigin(agent) {
    agent = agent || {};
    var key = seatKeyForAgent(agent);
    var seat = (L && L.seats && L.seats[key]) || (L && L.demoHomes && L.demoHomes[key]) || { x: 0, z: 0 };
    var cfg = workstationConfig(key);
    return {
      key: key,
      x: Number(seat.x) || 0,
      z: Number(seat.z) || 0,
      rotation: Number(cfg.rotation) || 0,
      accent: cfg.accent || null,
      style: cfg.style || 'standard',
      config: cfg
    };
  }

  function resolveAgentPosition(agent) {
    var ws = resolveWorkstationOrigin(agent);
    var cfg = ws.config || DEFAULT_MANIFEST.workstation;
    var local = cfg.agentLocal || DEFAULT_MANIFEST.workstation.agentLocal;
    var rot = Number(cfg.agentRotation) || 0;
    // a manifest written before the typing fix still says PI (back to the monitors): the avatars face +z
    if (Math.abs(Math.abs(rot) - Math.PI) < 1e-6) rot = 0;
    var cos = Math.cos(ws.rotation);
    var sin = Math.sin(ws.rotation);
    var lx = Number(local.x) || 0;
    var lz = Number(local.z) || 0;
    return {
      // three.js rotation.y: local (x, z) -> world (x cos + z sin, -x sin + z cos). The old formula rotated the
      // other way, which only mattered for the 90-degree desk (needs-steve), whose seat landed beside the desk.
      x: ws.x + lx * cos + lz * sin,
      z: ws.z - lx * sin + lz * cos,
      rotation: ws.rotation + rot,
      seatHeight: Number(cfg.seatHeight) || 0.62,
      workstation: ws
    };
  }

  function resolveNavPoint(name) {
    if (!L || !L.navPoints || !L.navPoints[name]) return null;
    var p = L.navPoints[name];
    return { x: Number(p.x) || 0, z: Number(p.z) || 0 };
  }

  root.TevaAssets = {
    loadManifest: loadManifest,
    setManifest: setManifest,
    getManifest: getManifest,
    normalizeManifest: normalizeManifest,
    roleKey: roleKey,
    getRolePreset: getRolePreset,
    findAssetEntry: findAssetEntry,
    findAssetsByType: findAssetsByType,
    assetForWorkstation: assetForWorkstation,
    assetForRoom: assetForRoom,
    loadModelAsset: loadModelAsset,
    clearModelCache: clearModelCache,
    assetForAgent: assetForAgent,
    enrichAgent: enrichAgent,
    seatKeyForAgent: seatKeyForAgent,
    workstationConfig: workstationConfig,
    resolveWorkstationOrigin: resolveWorkstationOrigin,
    resolveAgentPosition: resolveAgentPosition,
    resolveNavPoint: resolveNavPoint
  };
})(typeof window !== 'undefined' ? window : global);
