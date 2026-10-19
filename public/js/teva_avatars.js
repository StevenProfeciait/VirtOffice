/* TEVA HQ avatar helpers — pure logic, no three.js/DOM. */
(function (root) {
  'use strict';

  var STATES = ['IDLE', 'WORKING', 'RESEARCHING', 'TESTING', 'PLANNING', 'WAITING', 'ERROR', 'COMPLETED'];
  var MODEL_CACHE = {};
  var MODEL_PENDING = {};

  function normalizeAvatar(agent) {
    agent = agent || {};
    var avatar = agent.avatar || {};
    var fallback = avatar.fallback || {};
    return {
      id: agent.id || 'agent',
      model: avatar.model || null,
      fallback: {
        color: fallback.color || agent.color || '#8B5CF6',
        shape: fallback.shape || 'capsule',
        emoji: fallback.emoji || agent.emoji || '🤖'
      },
      workstation: avatar.workstation || agent.workstation || agent.home || 'center',
      zone: avatar.zone || agent.zone || null,
      animations: avatar.animations || {},
      scale: Number.isFinite(Number(avatar.scale)) ? Number(avatar.scale) : 1,
      offset: {
        x: Number(avatar.offset && avatar.offset.x) || 0,
        y: Number(avatar.offset && avatar.offset.y) || 0,
        z: Number(avatar.offset && avatar.offset.z) || 0
      },
      seated: {
        enabled: avatar.seated ? avatar.seated.enabled !== false : true,
        offset: {
          x: Number(avatar.seated && avatar.seated.offset && avatar.seated.offset.x) || 0,
          y: Number(avatar.seated && avatar.seated.offset && avatar.seated.offset.y) || 0,
          z: Number(avatar.seated && avatar.seated.offset && avatar.seated.offset.z) || 0
        },
        rotation: Number(avatar.seated && avatar.seated.rotation) || 0,
        seatHeight: Number(avatar.seated && avatar.seated.seatHeight) || 0.62,
        pose: avatar.seated && avatar.seated.pose ? avatar.seated.pose : 'seated_idle'
      }
    };
  }

  function clipFor(avatar, state) {
    if (!avatar || !avatar.animations) return null;
    var key = String(state || 'IDLE').toLowerCase();
    var aliases = {
      working: ['seated_typing', 'typing', 'working', 'seated_idle', 'idle'],
      researching: ['reading', 'seated_idle', 'idle'],
      testing: ['seated_typing', 'working', 'seated_idle', 'idle'],
      waiting: ['seated_idle', 'idle'],
      planning: ['talking', 'gesturing', 'seated_idle', 'idle'],
      error: ['seated_idle', 'idle'],
      completed: ['celebrate', 'seated_idle', 'idle'],
      idle: ['seated_idle', 'idle']
    };
    var candidates = [key, String(state || '')].concat(aliases[key] || []);
    for (var i = 0; i < candidates.length; i++) {
      if (avatar.animations[candidates[i]]) return avatar.animations[candidates[i]];
    }
    return null;
  }

  function hasModel(avatar) {
    return !!(avatar && typeof avatar.model === 'string' && avatar.model.trim());
  }

  function resolveClip(clips, state, configured) {
    if (!Array.isArray(clips) || !clips.length) return null;
    if (configured) {
      var exact = clips.filter(function (c) { return c && c.name === configured; })[0];
      if (exact) return exact;
    }
    var normalized = String(state || 'IDLE').toLowerCase().replace(/[ _-]/g, '');
    var aliases = {
      working: ['seatedtyping', 'typing', 'working', 'seatedidle', 'idle'],
      researching: ['reading', 'seatedidle', 'idle'],
      testing: ['seatedtyping', 'working', 'seatedidle', 'idle'],
      waiting: ['seatedidle', 'idle'],
      planning: ['talking', 'gesturing', 'seatedidle', 'idle'],
      error: ['seatedidle', 'idle'],
      completed: ['celebrate', 'seatedidle', 'idle'],
      idle: ['seatedidle', 'idle']
    };
    var wanted = [normalized].concat(aliases[normalized] || []);
    for (var i = 0; i < wanted.length; i++) {
      var found = clips.filter(function (c) {
        return c && c.name && c.name.toLowerCase().replace(/[ _-]/g, '').indexOf(wanted[i]) !== -1;
      })[0];
      if (found) return found;
    }
    return null;
  }

  function stateFromActivity(agent) {
    var activity = agent && agent.activity ? agent.activity : {};
    var ps = activity.presentationState || activity.state;
    if (ps === 'ERROR') return 'ERROR';
    if (ps === 'COMPLETED') return 'COMPLETED';
    if (ps === 'WAITING' || ps === 'WAITING_FOR_APPROVAL') return 'WAITING';
    if (ps === 'TESTING') return 'TESTING';
    if (ps === 'RESEARCHING' || ps === 'READING') return 'RESEARCHING';
    if (ps === 'PLANNING') return 'PLANNING';
    if (ps === 'WORKING' || ps === 'TYPING' || ps === 'RUNNING' || ps === 'DELEGATING') return 'WORKING';
    if (agent && agent.status === 'meeting') return 'PLANNING';
    if (agent && agent.status === 'working') return 'WORKING';
    return 'IDLE';
  }

  function loadAvatar(avatar, scene, onLoad) {
    var THREE = root.THREE;
    var GLTFLoader = root.THREE ? root.THREE.GLTFLoader : null;
    if (!THREE || !GLTFLoader || !hasModel(avatar)) {
      var fallback = makeFallback(avatar, THREE);
      if (onLoad) onLoad(null, fallback, 'fallback');
      return null;
    }
    if (MODEL_CACHE[avatar.model]) {
      var cached = MODEL_CACHE[avatar.model];
      var cachedScene = cached.scene && cached.scene.clone ? cached.scene.clone(true) : cached.scene;
      if (cachedScene && cachedScene.userData) cachedScene.userData.tevaSharedAsset = true;
      if (onLoad) onLoad({ scene: cachedScene, animations: cached.animations || [] }, cachedScene, 'cached');
      return { cancelled: false, cached: true };
    }
    if (MODEL_PENDING[avatar.model]) {
      var pending = { cancelled: false, callback: onLoad };
      MODEL_PENDING[avatar.model].push(pending);
      return pending;
    }
    var loader = new GLTFLoader();
    var controller = { cancelled: false };
    MODEL_PENDING[avatar.model] = [{ cancelled: false, callback: onLoad }];
    loader.load(
      avatar.model,
      function (gltf) {
        MODEL_CACHE[avatar.model] = { scene: gltf.scene, animations: gltf.animations || [] };
        var callbacks = MODEL_PENDING[avatar.model] || [];
        delete MODEL_PENDING[avatar.model];
        callbacks.forEach(function (item) {
          if (item.cancelled || !item.callback) return;
          var model = gltf.scene && gltf.scene.clone ? gltf.scene.clone(true) : gltf.scene;
          if (model && model.userData) model.userData.tevaSharedAsset = true;
          item.callback({ scene: model, animations: gltf.animations || [] }, model, 'loaded');
        });
      },
      undefined,
      function (err) {
        var callbacks = MODEL_PENDING[avatar.model] || [];
        delete MODEL_PENDING[avatar.model];
        callbacks.forEach(function (item) {
          if (item.cancelled || !item.callback) return;
          var fallback = makeFallback(avatar, THREE);
          item.callback(null, fallback, 'error:' + (err && err.message));
        });
      }
    );
    return controller;
  }

  function clearModelCache() {
    Object.keys(MODEL_CACHE).forEach(function (key) {
      var cached = MODEL_CACHE[key];
      if (cached && cached.scene && cached.scene.traverse) cached.scene.traverse(function (node) {
        if (node.geometry && node.geometry.dispose) node.geometry.dispose();
        if (node.material) {
          var mats = Array.isArray(node.material) ? node.material : [node.material];
          mats.forEach(function (mat) { if (mat && mat.dispose) mat.dispose(); });
        }
      });
    });
    MODEL_CACHE = {};
  }

  function makeFallback(avatar, THREE) {
    if (!THREE) return null;
    var fb = (avatar && avatar.fallback) || {};
    var color = fb.color || '#8B5CF6';
    var group = new THREE.Group();
    var body = new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: 0.72 });
    var skin = new THREE.MeshStandardMaterial({ color: 0xd6a27d, roughness: 0.82 });
    var hair = new THREE.MeshStandardMaterial({ color: 0x202631, roughness: 0.9 });
    var torso = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.62, 0.3), body);
    torso.position.y = 1.08;
    group.add(torso);
    var head = new THREE.Mesh(new THREE.SphereGeometry(0.27, 12, 8), skin);
    head.position.y = 1.62;
    group.add(head);
    var hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.275, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.48), hair);
    hairCap.position.y = 1.69;
    group.add(hairCap);
    var parts = { head: head, leftArm: null, rightArm: null, leftThigh: null, rightThigh: null, leftShin: null, rightShin: null };
    [-1, 1].forEach(function (side) {
      var arm = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.085, 0.55, 8), body);
      arm.position.set(side * 0.31, 1.08, 0);
      arm.rotation.z = side * -0.18;
      group.add(arm);
      if (side < 0) parts.leftArm = arm; else parts.rightArm = arm;
      var legMat = new THREE.MeshStandardMaterial({ color: 0x293140, roughness: 0.86 });
      var thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.09, 0.52, 8), legMat);
      thigh.position.set(side * 0.13, 0.76, -0.16);
      thigh.rotation.x = Math.PI / 2;
      group.add(thigh);
      var shin = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.08, 0.52, 8), legMat);
      shin.position.set(side * 0.13, 0.43, 0.08);
      group.add(shin);
      if (side < 0) { parts.leftThigh = thigh; parts.leftShin = shin; }
      else { parts.rightThigh = thigh; parts.rightShin = shin; }
    });
    group.userData = { fallback: true, emoji: fb.emoji || '🤖', parts: parts, baseScale: 1 };
    return group;
  }

  root.TevaAvatars = {
    STATES: STATES,
    normalizeAvatar: normalizeAvatar,
    clipFor: clipFor,
    resolveClip: resolveClip,
    hasModel: hasModel,
    stateFromActivity: stateFromActivity,
    loadAvatar: loadAvatar,
    clearModelCache: clearModelCache,
    makeFallback: makeFallback
  };
})(typeof window !== 'undefined' ? window : global);
