/* TEVA HQ avatar manager — binds agent state to scene objects. */
(function (root) {
  'use strict';

  var Avatars = root.TevaAvatars || {};
  var THREE = root.THREE;

  // Procedural animation offsets for agents without model clips.
  function proceduralPose(mesh, state, t) {
    if (!mesh || !mesh.userData.fallback) return;
    mesh.rotation.y = (mesh.userData.phase || 0) + t * 0.2;
    switch (state) {
      case 'WORKING': mesh.scale.y = 1 + Math.sin(t * 4) * 0.02; break;
      case 'ERROR': mesh.scale.set(1, 1.1, 1); break;
      case 'COMPLETED': mesh.scale.set(1 + Math.sin(t * 6) * 0.15, 1, 1); break;
      default: mesh.scale.set(1, 1, 1);
    }
  }

  function dispose(obj) {
    if (!obj) return;
    if (obj._mixer) { obj._mixer.stopAllAction(); obj._mixer = null; }
    if (obj._clips) { for (var i = 0; i < obj._clips.length; i++) { if (obj._clips[i]) obj._clips[i].reset(); } obj._clips = null; }
    if (obj.traverse) obj.traverse(function (c) {
      if (c.geometry) c.geometry.dispose();
      if (c.material) {
        if (Array.isArray(c.material)) for (var k = 0; k < c.material.length; k++) c.material[k].dispose();
        else c.material.dispose();
      }
    });
  }

  function setState(entry, state, clipName) {
    entry.state = state;
    if (entry._mixer && THREE) {
      var mixer = entry._mixer;
      mixer.stopAllAction();
      if (clipName && entry._clipsMap && entry._clipsMap[clipName]) {
        var clip = entry._clipsMap[clipName];
        var action = mixer.clipAction(clip);
        action.reset();
        action.play();
      }
    }
  }

  function applyToScene(entry, group, position) {
    if (!group) return;
    group.position.set(position.x || 0, 0, position.z || 0);
    if (entry.state === 'ERROR') {
      var mat = group.material || (group.userData.colorMat);
      // no-op: error handled by procedural pose for capsules
    }
    proceduralPose(group, entry.state, entry._t || 0);
  }

  var Manager = function (scene) {
    this.scene = scene;
    this.entries = {};
    this._t = 0;
  };

  Manager.prototype.addAgent = function (agent, position) {
    position = position || { x: 0, z: 0 };
    var avatar = Avatars.normalizeAvatar(agent);
    var entry = { agent: agent, avatar: avatar, state: Avatars.stateFromActivity(agent), position: position, group: null };
    this.entries[agent.id] = entry;
    if (!THREE) return entry;
    var self = this;
    Avatars.loadAvatar(avatar, this.scene, function (gltf, sceneObj, mode) {
      if (!entry || entry.disposed) return;
      if (entry.group && entry.group.parent) entry.group.parent.remove(entry.group);
      var group = sceneObj ? sceneObj : gltf;
      if (!group) return;
      if (mode === 'fallback' || mode.indexOf('error') === 0) {
        group.userData = group.userData || {};
        group.userData.fallback = true;
        group.userData.emoji = avatar.fallback.emoji;
      }
      group.userData.agentId = agent.id;
      group.userData.avatarId = avatar.id;
      entry.group = group;
      entry.mode = mode;
      if (gltf && gltf.animations && THREE.AnimationMixer) {
        entry._mixer = new THREE.AnimationMixer(group);
        entry._clipsMap = {};
        gltf.animations.forEach(function (a) { entry._clipsMap[a.name] = a; });
      }
      applyToScene(entry, group, position);
      self.scene.add(group);
    });
    return entry;
  };

  Manager.prototype.update = function (dt, now) {
    this._t += dt;
    var ids = Object.keys(this.entries);
    for (var i = 0; i < ids.length; i++) {
      var entry = this.entries[ids[i]];
      if (!entry) continue;
      var next = Avatars.stateFromActivity(entry.agent);
      if (next !== entry.state) {
        var clip = Avatars.clipFor(entry.avatar, next);
        setState(entry, next, clip);
      }
      entry._t = this._t;
      if (entry.group && entry.group.userData && entry.group.userData.fallback) {
        proceduralPose(entry.group, entry.state, this._t);
      }
      if (entry._mixer) entry._mixer.update(dt);
    }
  };

  Manager.prototype.updateAgent = function (agent) {
    var entry = this.entries[agent.id];
    if (!entry) return;
    var prev = entry.state;
    entry.agent = agent;
    var next = Avatars.stateFromActivity(agent);
    if (next !== prev) {
      var clip = Avatars.clipFor(entry.avatar, next);
      setState(entry, next, clip);
    }
  };

  Manager.prototype.dispose = function () {
    var ids = Object.keys(this.entries);
    for (var i = 0; i < ids.length; i++) {
      var entry = this.entries[ids[i]];
      if (!entry) continue;
      entry.disposed = true;
      if (entry.group && entry.group.parent) entry.group.parent.remove(entry.group);
      dispose(entry.group);
    }
    this.entries = {};
  };

  root.TevaAvatarManager = {
    proceduralPose: proceduralPose,
    Manager: Manager
  };
})(typeof window !== 'undefined' ? window : (global || {}));
