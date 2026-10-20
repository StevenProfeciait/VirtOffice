/* TEVA HQ avatar helpers — pure logic, no three.js/DOM. */
(function (root) {
  'use strict';

  var STATES = ['IDLE', 'WORKING', 'MOUSE', 'RESEARCHING', 'THINKING', 'TESTING', 'PLANNING', 'TALKING', 'WAITING', 'STANDING_UP', 'SITTING_DOWN', 'STANDING', 'ERROR', 'COMPLETED', 'WALKING'];
  var MODEL_CACHE = {};
  var MODEL_PENDING = {};

  function normalizeAvatar(agent) {
    agent = agent || {};
    if (root.TevaAssets && root.TevaAssets.enrichAgent) agent = root.TevaAssets.enrichAgent(agent);
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
      mouse: ['mouse', 'using_mouse', 'seated_typing', 'working', 'seated_idle', 'idle'],
      researching: ['reading', 'seated_idle', 'idle'],
      thinking: ['thinking', 'seated_idle', 'idle'],
      testing: ['seated_typing', 'working', 'seated_idle', 'idle'],
      waiting: ['seated_idle', 'idle'],
      planning: ['talking', 'gesturing', 'seated_idle', 'idle'],
      talking: ['talking', 'gesturing', 'seated_idle', 'idle'],
      standing_up: ['standing_up', 'standup', 'standing', 'idle'],
      sitting_down: ['sitting_down', 'sitdown', 'seated_idle', 'idle'],
      standing: ['standing', 'idle'],
      error: ['seated_idle', 'idle'],
      completed: ['celebrate', 'seated_idle', 'idle'],
      idle: ['seated_idle', 'idle'],
      walking: ['walking', 'walk', 'locomotion']
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

  // Keep asset inspection pure so the UI and tests can report whether a model
  // actually contains the clips needed by the state-driven renderer.
  function inspectClips(clips) {
    clips = Array.isArray(clips) ? clips.filter(Boolean) : [];
    var names = clips.map(function (clip) { return String(clip.name || ''); });
    var normalized = names.map(function (name) { return name.toLowerCase().replace(/[ _-]/g, ''); });
    function hasAny(values) {
      return values.some(function (value) {
        value = String(value).toLowerCase().replace(/[ _-]/g, '');
        return normalized.some(function (name) { return name.indexOf(value) !== -1; });
      });
    }
    return {
      count: clips.length,
      names: names,
      hasSeated: hasAny(['seated', 'sitting', 'sitdown']),
      hasWorking: hasAny(['seatedtyping', 'typing', 'working', 'reading']),
      hasLocomotion: hasAny(['walking', 'walk', 'locomotion']),
      hasConversation: hasAny(['talking', 'gesturing', 'presenting']),
      hasIdle: hasAny(['idle', 'neutral', 'waiting'])
    };
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
      mouse: ['mouse', 'usingmouse', 'seatedtyping', 'working', 'seatedidle', 'idle'],
      researching: ['reading', 'seatedidle', 'idle'],
      thinking: ['thinking', 'seatedidle', 'idle'],
      testing: ['seatedtyping', 'working', 'seatedidle', 'idle'],
      waiting: ['seatedidle', 'idle'],
      planning: ['talking', 'gesturing', 'seatedidle', 'idle'],
      talking: ['talking', 'gesturing', 'seatedidle', 'idle'],
      standingup: ['standingup', 'standup', 'standing', 'idle'],
      sittingdown: ['sittingdown', 'sitdown', 'seatedidle', 'idle'],
      standing: ['standing', 'idle'],
      error: ['seatedidle', 'idle'],
      completed: ['celebrate', 'seatedidle', 'idle'],
      idle: ['seatedidle', 'idle']
      ,walking: ['walking', 'walk', 'locomotion']
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

  function buildGeneratedClips(scene, existing) {
    var THREE = root.THREE;
    existing = Array.isArray(existing) ? existing.slice() : [];
    if (!THREE || !THREE.AnimationClip || !THREE.QuaternionKeyframeTrack || !scene || !scene.traverse) return existing;
    var bones = {};
    scene.traverse(function (node) { if (node && (node.isBone || node.type === 'Bone') && node.name) bones[node.name] = node; });
    if (!bones.pelvis || !bones.thigh_l || !bones.thigh_r || !bones.calf_l || !bones.calf_r) return existing;
    var known = {};
    existing.forEach(function (clip) { if (clip && clip.name) known[clip.name.toLowerCase().replace(/[ _-]/g, '')] = true; });
    var base = {};
    Object.keys(bones).forEach(function (name) { base[name] = bones[name].quaternion.clone(); });
    var E = function (x, y, z) { return { x: x || 0, y: y || 0, z: z || 0 }; };
    var seated = {
      // Keep the pelvis over the chair cushion, with a slight forward lean
      // toward the keyboard instead of the stiff, upright source pose.
      pelvis: E(-0.08, 0, 0), thigh_l: E(-1.42, 0, 0), thigh_r: E(-1.42, 0, 0),
      calf_l: E(1.28, 0, 0), calf_r: E(1.28, 0, 0), spine_01: E(-0.14, 0, 0),
      spine_02: E(-0.12, 0, 0), spine_03: E(-0.1, 0, 0), upperarm_l: E(-1.02, 0, 0),
      upperarm_r: E(-1.02, 0, 0), lowerarm_l: E(-0.48, 0, 0), lowerarm_r: E(-0.48, 0, 0),
      neck_01: E(0.05, 0, 0), Head: E(0.05, 0, 0)
    };
    function addDelta(target, name, delta) {
      if (bones[name]) target[name] = delta;
    }
    function makeClip(name, times, poses) {
      var tracks = [];
      Object.keys(base).forEach(function (boneName) {
        var values = [];
        for (var i = 0; i < times.length; i++) {
          var delta = (poses[i] && poses[i][boneName]) || E(0, 0, 0);
          var q = base[boneName].clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(delta.x, delta.y, delta.z)));
          values.push(q.x, q.y, q.z, q.w);
        }
        if (values.some(function (v) { return v !== 0; })) tracks.push(new THREE.QuaternionKeyframeTrack(boneName + '.quaternion', times, values));
      });
      if (bones.pelvis && THREE.VectorKeyframeTrack) {
        var positions = [];
        for (var p = 0; p < times.length; p++) {
          var seatedPose = poses[p] && poses[p].__seated;
          var pos = bones.pelvis.position;
          positions.push(pos.x, pos.y + (seatedPose ? -0.28 : 0), pos.z + (seatedPose ? 0.08 : 0));
        }
        tracks.push(new THREE.VectorKeyframeTrack('pelvis.position', times, positions));
      }
      return new THREE.AnimationClip(name, times[times.length - 1], tracks);
    }
    function seatedPose(armDelta) {
      var pose = {};
      Object.keys(seated).forEach(function (name) { addDelta(pose, name, seated[name]); });
      pose.__seated = true;
      if (armDelta) {
        if (bones.lowerarm_l) pose.lowerarm_l = E(-0.48 + armDelta, 0, 0);
        if (bones.lowerarm_r) pose.lowerarm_r = E(-0.48 - armDelta, 0, 0);
      }
      return pose;
    }
    function talkingPose(armDelta) {
      var pose = seatedPose(0);
      if (bones.upperarm_l) pose.upperarm_l = E(-0.95, 0, armDelta);
      if (bones.upperarm_r) pose.upperarm_r = E(-0.95, 0, -armDelta);
      return pose;
    }
    function walkingPose(legDelta) {
      var pose = {};
      addDelta(pose, 'thigh_l', E(legDelta, 0, 0));
      addDelta(pose, 'thigh_r', E(-legDelta, 0, 0));
      addDelta(pose, 'calf_l', E(-legDelta * 0.45, 0, 0));
      addDelta(pose, 'calf_r', E(legDelta * 0.45, 0, 0));
      addDelta(pose, 'upperarm_l', E(-legDelta * 0.7, 0, 0));
      addDelta(pose, 'upperarm_r', E(legDelta * 0.7, 0, 0));
      return pose;
    }
    function standingPose() { return {}; }
    var generated = [
      makeClip('SeatedIdle', [0, 2], [seatedPose(0), seatedPose(0)]),
      makeClip('SeatedTyping', [0, 0.4, 0.8, 1.2, 1.6], [seatedPose(-0.035), seatedPose(0.035), seatedPose(-0.035), seatedPose(0.035), seatedPose(-0.035)]),
      makeClip('Mouse', [0, 0.6, 1.2], [seatedPose(-0.05), seatedPose(0.05), seatedPose(-0.05)]),
      makeClip('Reading', [0, 2], [seatedPose(0), seatedPose(0)]),
      makeClip('Thinking', [0, 2], [seatedPose(0), seatedPose(0)]),
      makeClip('Talking', [0, 0.9, 1.8], [talkingPose(-0.07), talkingPose(0.07), talkingPose(-0.07)]),
      makeClip('SittingDown', [0, 0.8], [standingPose(), seatedPose(0)]),
      makeClip('StandingUp', [0, 0.8], [seatedPose(0), standingPose()]),
      makeClip('Standing', [0, 2], [standingPose(), standingPose()]),
      makeClip('Walking', [0, 0.5, 1], [walkingPose(-0.45), walkingPose(0.45), walkingPose(-0.45)])
    ];
    generated.forEach(function (clip) {
      var key = clip.name.toLowerCase().replace(/[ _-]/g, '');
      if (!known[key]) existing.push(clip);
    });
    return existing;
  }

  function stateFromActivity(agent) {
    var activity = agent && agent.activity ? agent.activity : {};
    var ps = activity.presentationState || activity.state;
    if (ps === 'ERROR') return 'ERROR';
    if (ps === 'COMPLETED') return 'COMPLETED';
    if (ps === 'WAITING' || ps === 'WAITING_FOR_APPROVAL') return 'WAITING';
    if (ps === 'TESTING') return 'TESTING';
    if (ps === 'MOUSE' || ps === 'USING_MOUSE') return 'MOUSE';
    if (ps === 'RESEARCHING' || ps === 'READING') return 'RESEARCHING';
    if (ps === 'THINKING') return 'THINKING';
    if (ps === 'PLANNING') return 'PLANNING';
    if (ps === 'TALKING' || ps === 'GESTURING') return 'TALKING';
    if (ps === 'STANDING_UP' || ps === 'STAND_UP') return 'STANDING_UP';
    if (ps === 'SITTING_DOWN' || ps === 'SIT_DOWN') return 'SITTING_DOWN';
    if (ps === 'STANDING') return 'STANDING';
    if (ps === 'WORKING' || ps === 'TYPING' || ps === 'RUNNING' || ps === 'DELEGATING') return 'WORKING';
    if (ps === 'AT_DESK') {
      if (agent && (agent.status === 'working' || (activity.boardWorking === true) || agent.typing)) return 'WORKING';
      return 'IDLE';
    }
    if (ps === 'OFFLINE') return 'IDLE';
    if (agent && agent.status === 'meeting') return 'PLANNING';
    if (agent && agent.status === 'walking') return 'WALKING';
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
        var animations = buildGeneratedClips(gltf.scene, gltf.animations || []);
        MODEL_CACHE[avatar.model] = { scene: gltf.scene, animations: animations };
        var callbacks = MODEL_PENDING[avatar.model] || [];
        delete MODEL_PENDING[avatar.model];
        callbacks.forEach(function (item) {
          if (item.cancelled || !item.callback) return;
          var model = gltf.scene && gltf.scene.clone ? gltf.scene.clone(true) : gltf.scene;
          if (model && model.userData) model.userData.tevaSharedAsset = true;
          item.callback({ scene: model, animations: animations }, model, 'loaded');
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
    var app = (avatar && avatar.appearance) || {};
    var color = fb.color || '#8B5CF6';
    var group = new THREE.Group();
    var body = new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: 0.72 });
    var skinTone = app.skin || '#d6a27d';
    var skin = new THREE.MeshStandardMaterial({ color: new THREE.Color(skinTone), roughness: 0.82 });
    var hairTone = app.hair || '#202631';
    var hair = new THREE.MeshStandardMaterial({ color: new THREE.Color(hairTone), roughness: 0.9 });
    var outfit = app.outfit || 'casual';
    var torsoGeo = outfit === 'hoodie' ? new THREE.BoxGeometry(0.52, 0.64, 0.34) : new THREE.BoxGeometry(0.48, 0.62, 0.3);
    var torso = new THREE.Mesh(torsoGeo, body);
    torso.position.y = 1.08;
    group.add(torso);
    if (outfit === 'labcoat') {
      var coat = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.66, 0.32), new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.88 }));
      coat.position.y = 1.06;
      group.add(coat);
    }
    if (outfit === 'blazer') {
      var blazer = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.58, 0.32), new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.75 }));
      blazer.position.y = 1.1;
      group.add(blazer);
    }
    var head = new THREE.Mesh(new THREE.SphereGeometry(0.27, 12, 8), skin);
    head.position.y = 1.62;
    group.add(head);
    var hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.275, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.48), hair);
    hairCap.position.y = 1.69;
    group.add(hairCap);
    if (app.accessory === 'headphones') {
      var band = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.025, 6, 16, Math.PI), hair);
      band.rotation.z = Math.PI;
      band.position.y = 1.72;
      group.add(band);
    }
    if (app.accessory === 'badge') {
      var badge = new THREE.Mesh(new THREE.CircleGeometry(0.05, 8), new THREE.MeshStandardMaterial({ color: 0xfbbf24, emissive: 0xfbbf24, emissiveIntensity: 0.2 }));
      badge.position.set(0.12, 1.15, 0.17);
      group.add(badge);
    }
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
    inspectClips: inspectClips,
    hasModel: hasModel,
    stateFromActivity: stateFromActivity,
    loadAvatar: loadAvatar,
    clearModelCache: clearModelCache,
    makeFallback: makeFallback
    ,buildGeneratedClips: buildGeneratedClips
  };
})(typeof window !== 'undefined' ? window : global);
