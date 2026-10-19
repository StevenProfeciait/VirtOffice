/* Engine-neutral scene contract client shared by future renderers. */
(function (root) {
  'use strict';
  var cache = null;
  function normalize(scene) {
    scene = scene || {};
    return {
      version: Number(scene.version) || 1,
      coordinateSystem: scene.coordinateSystem || { up: 'y', groundPlane: 'xz', units: 'world-meters' },
      room: scene.room || { width: 0, depth: 0, wallHeight: 0 },
      seats: scene.seats || {},
      anchors: scene.anchors || {},
      zones: Array.isArray(scene.zones) ? scene.zones : [],
      navigation: scene.navigation || {},
      assets: scene.assets || '/assets/asset-manifest.json',
      agentState: scene.agentState || '/api/agents',
      agentEvents: scene.agentEvents || '/events'
    };
  }
  function set(scene) { cache = normalize(scene); return cache; }
  function get() { return cache; }
  function load(url, callback) {
    callback = typeof callback === 'function' ? callback : function () {};
    if (typeof fetch === 'undefined') { callback(null); return; }
    fetch(url || '/api/scene', { cache: 'no-cache' })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (scene) { callback(scene ? set(scene) : null); })
      .catch(function () { callback(null); });
  }
  root.TevaRendererContract = { normalize: normalize, set: set, get: get, load: load };
})(typeof window !== 'undefined' ? window : global);
