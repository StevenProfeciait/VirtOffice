/* TEVA HQ avatar manager — binds agent state to scene objects. */
(function (root) {
  'use strict';

  var Avatars = root.TevaAvatars || {};
  var THREE = root.THREE;

  // Procedural animation offsets for agents without model clips.
  function proceduralPose(mesh, state, t) {
    if (!mesh || !mesh.userData.fallback) return;
    var parts = mesh.userData.parts || {};
    var base = mesh.userData.baseScale || 1;
    var walking = state === 'WALKING';
    var standing = walking || state === 'STANDING' || state === 'STANDING_UP';
    // Only idle standers drift; a seated agent keeps the chair rotation that
    // applyToScene applied, otherwise it slowly turns away from its desk.
    if (standing) mesh.rotation.y = (mesh.userData.phase || 0) + t * 0.2;
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
      } else if (standing) {
        parts.leftThigh.position.set(-0.13, 0.76, 0);
        parts.rightThigh.position.set(0.13, 0.76, 0);
        parts.leftThigh.rotation.x = 0;
        parts.rightThigh.rotation.x = 0;
        parts.leftShin.position.set(-0.13, 0.43, 0);
        parts.rightShin.position.set(0.13, 0.43, 0);
        parts.leftShin.rotation.x = 0;
        parts.rightShin.rotation.x = 0;
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
      var working = state === 'WORKING' || state === 'MOUSE' || state === 'RESEARCHING' || state === 'THINKING' || state === 'TESTING';
      parts.leftArm.rotation.x = walking ? Math.sin(t * 5) * 0.35 : (working ? -0.62 + Math.sin(t * 5) * 0.08 : -0.45);
      parts.rightArm.rotation.x = walking ? Math.sin(t * 5 + Math.PI) * 0.35 : (working ? -0.62 + Math.cos(t * 5) * 0.08 : -0.45);
      if (parts.head) parts.head.rotation.x = state === 'WAITING' || state === 'THINKING' ? -0.12 : 0;
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
    var standing = walking || entry.state === 'STANDING' || entry.state === 'STANDING_UP';
    var seatedConfig = entry.avatar && entry.avatar.seated;
    var seated = !standing && seatedConfig && seatedConfig.enabled ? seatedConfig : null;
    var baseY = seated ? ((seated.offset.y || 0) + (seated.seatHeight - 0.62)) : 0;
    group.position.set(position.x || 0, baseY, position.z || 0);
    if (seated) {
      group.position.x += seated.offset.x || 0;
      group.position.z += seated.offset.z || 0;
      group.rotation.y = Number.isFinite(Number(position.rotation)) ? position.rotation : (seated.rotation || 0);
    } else if (Number.isFinite(Number(position.rotation))) {
      group.rotation.y = position.rotation;
    }
    // Model-specific offsets apply in both seated and walking modes. Keeping
    // them here prevents a movement tick from snapping a calibrated model
    // back to its uncorrected root transform.
    group.position.x += entry.avatar.offset.x || 0;
    group.position.y += entry.avatar.offset.y || 0;
    group.position.z += entry.avatar.offset.z || 0;
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
    this._frame = 0;
    this.quality = 'full';
  };

  Manager.prototype.setQuality = function (quality) {
    quality = String(quality || 'full').toLowerCase();
    this.quality = ['full', 'reduced', 'off'].indexOf(quality) !== -1 ? quality : 'full';
    return this.quality;
  };

  Manager.prototype.getQuality = function () {
    return this.quality;
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
      group.visible = true;
      self.scene.add(group);
      // Start the initial state clip as soon as a model is attached. Without
      // this, an agent that begins in IDLE never crosses a state boundary and
      // a rigged character remains in its source/reference pose.
      var initialClip = Avatars.clipFor(avatar, entry.state);
      setState(entry, entry.state, initialClip);
    });
    return entry;
  };

  Manager.prototype.update = function (dt, now) {
    this._t += dt;
    this._frame += 1;
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
          // A chair is a seated anchor, not a walkable destination. Finish
          // the approach in front of it, then transition into the seat.
          if (move.seatedTarget) {
            entry.position.x = move.seatedTarget.x;
            entry.position.z = move.seatedTarget.z;
            entry.motionState = 'SITTING_DOWN';
            entry.settleUntil = this._t + 0.8;
          } else {
            entry.position.x = to.x;
            entry.position.z = to.z;
            entry.motionState = null;
          }
          if (entry.group) applyToScene(entry, entry.group, entry.position);
          entry.lastMovementKey = move.key;
          entry.movement = null;
        }
      }
      if (entry.motionState === 'SITTING_DOWN' && this._t >= (entry.settleUntil || 0)) {
        entry.motionState = null;
        entry.settleUntil = 0;
      }
      if (entry.motionState) next = entry.motionState;
      if (next !== entry.state) {
        var clip = Avatars.clipFor(entry.avatar, next);
        setState(entry, next, clip);
      }
      entry._t = this._t;
      var animate = this.quality !== 'off' && (this.quality === 'full' || this._frame % 2 === 0);
      if (animate && entry.group && entry.group.userData && entry.group.userData.fallback) {
        var poseState = entry.motionState || entry.state;
        proceduralPose(entry.group, poseState, this._t);
      }
      if (animate && entry._mixer) entry._mixer.update(this.quality === 'reduced' ? dt * 0.5 : dt);
    }
  };

  Manager.prototype.moveAgent = function (agentId, destination, options) {
    var entry = this.entries[agentId];
    if (!entry || !destination) return false;
    options = options || {};
    var resolvePoint = function (point) {
      if (typeof point === 'string' && root.TevaAssets && root.TevaAssets.resolveNavPoint) {
        var named = root.TevaAssets.resolveNavPoint(point);
        if (!named) {
          var layout = root.LAYOUT || root.OFFICE_LAYOUT;
          if (layout && layout.seats && layout.seats[point] && root.TevaAssets.resolveAgentPosition) {
            named = root.TevaAssets.resolveAgentPosition({ id: point });
          }
        }
        point = named;
      }
      if (!point || !Number.isFinite(Number(point.x)) || !Number.isFinite(Number(point.z))) return null;
      return { x: Number(point.x), z: Number(point.z) };
    };
    destination = resolvePoint(destination);
    if (!destination) return false;
    var seatedTarget = null;
    var seatResolver = root.TevaAssets && root.TevaAssets.resolveAgentPosition;
    if (seatResolver) {
      var seat = seatResolver(entry.agent);
      if (seat && Number.isFinite(Number(seat.x)) && Number.isFinite(Number(seat.z))) {
        var seatDistance = Math.hypot(destination.x - Number(seat.x), destination.z - Number(seat.z));
        if (seatDistance < 0.2) {
          seatedTarget = { x: Number(seat.x), z: Number(seat.z) };
          var rotation = Number(seat.rotation) || 0;
          var approachDistance = Number(options.approachDistance) || 0.82;
          destination = {
            x: seatedTarget.x - Math.sin(rotation) * approachDistance,
            z: seatedTarget.z - Math.cos(rotation) * approachDistance
          };
        }
      }
    }
    var points = [{ x: Number(entry.position.x) || 0, z: Number(entry.position.z) || 0 }];
    (options.path || []).forEach(function (point) {
      var resolved = resolvePoint(point);
      if (resolved) points.push(resolved);
    });
    points.push(destination);
    // The origin is intentionally excluded: polling while a walk is in
    // progress observes a different current position but the same command.
    var movementKey = JSON.stringify(points.slice(1));
    var finalPosition = seatedTarget || destination;
    var atDestination = Math.abs((Number(entry.position.x) || 0) - Number(finalPosition.x)) < 0.001 &&
      Math.abs((Number(entry.position.z) || 0) - Number(finalPosition.z)) < 0.001;
    // Poll reconciliation is intentionally idempotent: the same explicit
    // route must not restart a walk every time the backend is reconciled.
    if ((entry.movement && entry.movement.key === movementKey) ||
        (!entry.movement && entry.lastMovementKey === movementKey && atDestination)) return true;
    entry.movement = {
      points: points,
      elapsed: 0,
      duration: Math.max(0.25, Number(options.duration) || 1.2),
      key: movementKey,
      seatedTarget: seatedTarget
    };
    return true;
  };

  Manager.prototype.updateAgent = function (agent) {
    var entry = this.entries[agent.id];
    if (!entry) return;
    var prev = entry.state;
    entry.agent = agent;
    var previousAvatar = entry.avatar;
    entry.avatar = Avatars.normalizeAvatar(agent);
    if (entry.group && previousAvatar && entry.avatar.scale !== previousAvatar.scale) {
      var scaleRatio = previousAvatar.scale ? entry.avatar.scale / previousAvatar.scale : entry.avatar.scale;
      entry.group.scale.multiplyScalar(scaleRatio || 1);
      if (entry.group.userData) entry.group.userData.baseScale = entry.avatar.scale || 1;
    }
    if (entry.group) applyToScene(entry, entry.group, entry.position);
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

  Manager.prototype.getDiagnostics = function (agentId) {
    var entry = this.entries[agentId];
    if (!entry) return null;
    var clipReport = Avatars.inspectClips && Avatars.inspectClips(entry._clips);
    return {
      agentId: agentId,
      mode: entry.mode || 'pending',
      state: entry.state,
      motionState: entry.motionState || null,
      clip: entry._action && entry._action.getClip ? (entry._action.getClip().name || null) : null,
      seated: !!(entry.avatar && entry.avatar.seated && entry.avatar.seated.enabled && entry.state !== 'WALKING' && entry.motionState !== 'WALKING'),
      position: { x: Number(entry.position.x) || 0, z: Number(entry.position.z) || 0 },
      movement: entry.movement ? {
        elapsed: entry.movement.elapsed,
        duration: entry.movement.duration,
        points: entry.movement.points.length
      } : null,
      clips: clipReport || { count: 0, names: [] }
    };
  };

  root.TevaAvatarManager = {
    proceduralPose: proceduralPose,
    setState: setState,
    Manager: Manager
  };
})(typeof window !== 'undefined' ? window : (global || {}));
