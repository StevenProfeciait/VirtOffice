/* TEVA HQ avatar manager — binds agent state to scene objects. */
(function (root) {
  'use strict';

  var Avatars = root.TevaAvatars || {};
  var THREE = root.THREE;

  // Procedural animation offsets for agents without model clips.
  function proceduralPose(mesh, state, t) {
    if (!mesh || !mesh.userData.fallback) return;
    mesh.rotation.y = (mesh.userData.phase || 0) + t * 0.2;
    var parts = mesh.userData.parts || {};
    var base = mesh.userData.baseScale || 1;
    var walking = state === 'WALKING';
    if (parts.leftThigh && parts.rightThigh && parts.leftShin && parts.rightShin) {
      if (walking) {
        parts.leftThigh.position.set(-0.13, 0.63, 0);
        parts.rightThigh.position.set(0.13, 0.63, 0);
        parts.leftThigh.rotation.x = Math.sin(t * 5) * 0.35;
        parts.rightThigh.rotation.x = Math.sin(t * 5 + Math.PI) * 0.35;
        parts.leftShin.position.set(-0.13, 0.28, 0);
        parts.rightShin.position.set(0.13, 0.28, 0);
        parts.leftShin.rotation.x = Math.max(0, -Math.sin(t * 5) * 0.35);
        parts.rightShin.rotation.x = Math.max(0, -Math.sin(t * 5 + Math.PI) * 0.35);
      } else {
        parts.leftThigh.position.set(-0.13, 0.76, -0.16);
        parts.rightThigh.position.set(0.13, 0.76, -0.16);
        parts.leftThigh.rotation.x = Math.PI / 2;
        parts.rightThigh.rotation.x = Math.PI / 2;
        parts.leftShin.position.set(-0.13, 0.43, 0.08);
        parts.rightShin.position.set(0.13, 0.43, 0.08);
        parts.leftShin.rotation.x = 0;
        parts.rightShin.rotation.x = 0;
      }
    }
    if (parts.leftArm && parts.rightArm) {
      var working = state === 'WORKING' || state === 'RESEARCHING' || state === 'TESTING';
      parts.leftArm.rotation.x = walking ? Math.sin(t * 5) * 0.35 : (working ? -0.62 + Math.sin(t * 5) * 0.08 : -0.45);
      parts.rightArm.rotation.x = walking ? Math.sin(t * 5 + Math.PI) * 0.35 : (working ? -0.62 + Math.cos(t * 5) * 0.08 : -0.45);
      if (parts.head) parts.head.rotation.x = state === 'WAITING' ? -0.12 : 0;
    }
    switch (state) {
      case 'WORKING': mesh.scale.set(base, base * (1 + Math.sin(t * 4) * 0.02), base); break;
      case 'ERROR': mesh.scale.set(base, base * 1.1, base); break;
      case 'COMPLETED': mesh.scale.set(base * (1 + Math.sin(t * 6) * 0.15), base, base); break;
      default: mesh.scale.set(base, base, base);
    }
  }

  function dispose(obj) {
    if (!obj) return;
    if (obj._mixer) { obj._mixer.stopAllAction(); obj._mixer = null; }
    if (obj._clips) { for (var i = 0; i < obj._clips.length; i++) { if (obj._clips[i]) obj._clips[i].reset(); } obj._clips = null; }
    if (obj.userData && obj.userData.tevaSharedAsset) return;
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
      var clip = clipName;
      if (typeof clipName === 'string' && entry._clipsMap) clip = entry._clipsMap[clipName];
      if (!clip && entry._clips && Avatars.resolveClip) clip = Avatars.resolveClip(entry._clips, state);
      if (clip && entry._action && entry._action.getClip && entry._action.getClip() === clip) return;
      if (!clip && entry._action) {
        if (entry._action.fadeOut) entry._action.fadeOut(0.2);
        entry._action = null;
      }
      if (clip) {
        var action = mixer.clipAction(clip);
        if (entry._action && entry._action !== action && entry._action.fadeOut) entry._action.fadeOut(0.2);
        action.reset();
        if (action.fadeIn) action.fadeIn(0.2);
        action.play();
        entry._action = action;
      }
    }
  }

  function applyToScene(entry, group, position) {
    if (!group) return;
    position = position || entry.position || { x: 0, z: 0 };
    var walking = entry.state === 'WALKING' || entry.motionState === 'WALKING';
    var seated = !walking && entry.avatar && entry.avatar.seated && entry.avatar.seated.enabled;
    var baseY = seated ? ((seated.offset.y || 0) + (seated.seatHeight - 0.62)) : 0;
    group.position.set(position.x || 0, baseY, position.z || 0);
    if (seated) {
      group.position.x += seated.offset.x || 0;
      group.position.z += seated.offset.z || 0;
      group.rotation.y = Number.isFinite(Number(position.rotation)) ? position.rotation : (seated.rotation || 0);
    } else if (Number.isFinite(Number(position.rotation))) {
      group.rotation.y = position.rotation;
    }
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
        entry._clips = gltf.animations;
        entry._clipsMap = {};
        gltf.animations.forEach(function (a) { entry._clipsMap[a.name] = a; });
      }
      applyToScene(entry, group, position);
      group.scale.multiplyScalar(avatar.scale || 1);
      if (group.userData) group.userData.baseScale = avatar.scale || 1;
      group.position.y += avatar.offset.y || 0;
      group.position.x += avatar.offset.x || 0;
      group.position.z += avatar.offset.z || 0;
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
      if (entry.movement) {
        var move = entry.movement;
        move.elapsed += dt;
        var segmentDuration = move.duration / Math.max(1, move.points.length - 1);
        var segment = Math.min(move.points.length - 2, Math.floor(move.elapsed / segmentDuration));
        var localElapsed = move.elapsed - segment * segmentDuration;
        var k = Math.min(1, localElapsed / segmentDuration);
        var eased = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        var from = move.points[segment], to = move.points[segment + 1];
        entry.position.x = from.x + (to.x - from.x) * eased;
        entry.position.z = from.z + (to.z - from.z) * eased;
        if (entry.group) {
          applyToScene(entry, entry.group, entry.position);
        }
        entry.motionState = move.elapsed < move.duration ? 'WALKING' : null;
        if (move.elapsed >= move.duration) {
          entry.position.x = to.x;
          entry.position.z = to.z;
          if (entry.group) applyToScene(entry, entry.group, entry.position);
          entry.movement = null;
        }
      }
      if (entry.motionState) next = entry.motionState;
      if (next !== entry.state) {
        var clip = Avatars.clipFor(entry.avatar, next);
        setState(entry, next, clip);
      }
      entry._t = this._t;
      if (entry.group && entry.group.userData && entry.group.userData.fallback) {
        var poseState = entry.motionState || entry.state;
        proceduralPose(entry.group, poseState, this._t);
      }
      if (entry._mixer) entry._mixer.update(dt);
    }
  };

  Manager.prototype.moveAgent = function (agentId, destination, options) {
    var entry = this.entries[agentId];
    if (!entry || !destination || !Number.isFinite(Number(destination.x)) || !Number.isFinite(Number(destination.z))) return false;
    options = options || {};
    var points = [{ x: Number(entry.position.x) || 0, z: Number(entry.position.z) || 0 }];
    (options.path || []).forEach(function (point) {
      if (point && Number.isFinite(Number(point.x)) && Number.isFinite(Number(point.z))) points.push({ x: Number(point.x), z: Number(point.z) });
    });
    points.push({ x: Number(destination.x), z: Number(destination.z) });
    entry.movement = {
      points: points,
      elapsed: 0,
      duration: Math.max(0.25, Number(options.duration) || 1.2)
    };
    return true;
  };

  Manager.prototype.updateAgent = function (agent) {
    var entry = this.entries[agent.id];
    if (!entry) return;
    var prev = entry.state;
    entry.agent = agent;
    entry.avatar = Avatars.normalizeAvatar(agent);
    var next = Avatars.stateFromActivity(agent);
    if (next !== prev) {
      var clip = Avatars.clipFor(entry.avatar, next);
      setState(entry, next, clip);
    }
  };

  Manager.prototype.removeAgent = function (agentId) {
    var entry = this.entries[agentId];
    if (!entry) return false;
    entry.disposed = true;
    if (entry.group && entry.group.parent) entry.group.parent.remove(entry.group);
    dispose(entry.group);
    delete this.entries[agentId];
    return true;
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
    if (Avatars.clearModelCache) Avatars.clearModelCache();
  };

  root.TevaAvatarManager = {
    proceduralPose: proceduralPose,
    setState: setState,
    Manager: Manager
  };
})(typeof window !== 'undefined' ? window : (global || {}));
