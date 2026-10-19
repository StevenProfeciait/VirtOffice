/* TEVA HQ avatar helpers — pure logic, no three.js/DOM. */
(function (root) {
  'use strict';

  var STATES = ['IDLE', 'WORKING', 'RESEARCHING', 'TESTING', 'PLANNING', 'WAITING', 'ERROR', 'COMPLETED'];

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
      animations: avatar.animations || {}
    };
  }

  function clipFor(avatar, state) {
    if (!avatar || !avatar.animations) return null;
    var key = String(state || 'IDLE').toLowerCase();
    return avatar.animations[key] || avatar.animations[state] || null;
  }

  function hasModel(avatar) {
    return !!(avatar && typeof avatar.model === 'string' && avatar.model.trim());
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
    var loader = new GLTFLoader();
    var controller = { cancelled: false };
    loader.load(
      avatar.model,
      function (gltf) {
        if (controller.cancelled) return;
        if (onLoad) onLoad(gltf, gltf.scene, 'loaded');
      },
      undefined,
      function (err) {
        if (controller.cancelled) return;
        var fallback = makeFallback(avatar, THREE);
        if (onLoad) onLoad(null, fallback, 'error:' + (err && err.message));
      }
    );
    return controller;
  }

  function makeFallback(avatar, THREE) {
    if (!THREE) return null;
    var fb = (avatar && avatar.fallback) || {};
    var color = fb.color || '#8B5CF6';
    var geo = new THREE.CapsuleGeometry(0.35, 1.2, 4, 8);
    var mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(color) });
    var mesh = new THREE.Mesh(geo, mat);
    mesh.userData = { fallback: true, emoji: fb.emoji || '🤖' };
    return mesh;
  }

  root.TevaAvatars = {
    STATES: STATES,
    normalizeAvatar: normalizeAvatar,
    clipFor: clipFor,
    hasModel: hasModel,
    stateFromActivity: stateFromActivity,
    loadAvatar: loadAvatar,
    makeFallback: makeFallback
  };
})(typeof window !== 'undefined' ? window : global);
