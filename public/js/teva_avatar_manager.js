/* TEVA HQ avatar manager — binds agent state to scene objects. */
(function (root) {
  'use strict';

  var Avatars = root.TevaAvatars || {};
  var THREE = root.THREE;
  // Walking (2026-10-22): natural pace, ease in/out, stride-matched legs, turn to face. Pure maths lives in
  // public/js/teva_motion.js (TevaMotion); without it the old fixed-duration interpolation is used.
  function Motion() { return root.TevaMotion || null; }

  // Procedural animation offsets for agents without model clips.
  // walkPhase (optional): stride-matched walk-cycle phase in radians (advances with distance walked, see
  // TevaMotion.cycleAdvance); falls back to time for callers that do not track it.
  // extra (optional, 2026-10-22 part 2): { speed (m/s), activity ('type' | 'read' | 'meet' | 'talk' | 'play' |
  // 'pingpong' | 'foosball' | 'lounge' | 'coffee' | 'watch'), sip (0..1 while sipping) }.
  // Limbs are cylinders centred on their middle, so every rotation is applied about the shoulder / hip / knee
  // (pivot maths below) instead of the middle of the limb: the old walk swung arms and legs about their centres.
  var ARM_LEN = 0.55, ARM_TOP = 1.08 + 0.275, THIGH = 0.52, KNEE_DROP = 0.33, SHIN = 0.52, HIP_Y = 1.02; // capsule legs overlap: knee 0.33 below the hip
  function limbAt(part, px, py, pz, ang, len, roll) {
    // place a centred cylinder of length len hanging from pivot (px,py,pz), swung by ang about x (+ = forward)
    part.rotation.x = -ang;
    part.position.set(px, py - Math.cos(ang) * len / 2, pz + Math.sin(ang) * len / 2);
    if (roll != null) part.rotation.z = roll;
  }
  function legAt(thigh, shin, x, hipY, hipAng, knee) {
    // hipAng: thigh swing (+ forward); knee: bend (>= 0, shin folds back)
    limbAt(thigh, x, hipY, 0, hipAng, THIGH);
    var kx = hipY - Math.cos(hipAng) * KNEE_DROP, kz = Math.sin(hipAng) * KNEE_DROP, sa = hipAng - knee;
    shin.rotation.x = -sa;
    shin.position.set(x, kx - Math.cos(sa) * SHIN / 2, kz + Math.sin(sa) * SHIN / 2);
  }
  function proceduralPose(mesh, state, t, walkPhase, extra) {
    if (!mesh || !mesh.userData.fallback) return;
    extra = extra || mesh.userData.poseExtra || {};
    var parts = mesh.userData.parts || {};
    var base = mesh.userData.baseScale || 1;
    var walking = state === 'WALKING';
    var act = walking ? null : (extra.activity || null);
    var standing = walking || state === 'STANDING' || state === 'STANDING_UP' || act === 'play' || act === 'pingpong' || act === 'foosball' || (act === 'coffee' && !extra.sit) || (act === 'talk' && !extra.sit);
    var celebrating = state === 'COMPLETED' || (!walking && !!extra.celebrate); // task done: jump, arms up
    if (celebrating) standing = true;
    // Only idle standers drift; a seated agent keeps the chair rotation that
    // applyToScene applied, otherwise it slowly turns away from its desk.
    // Walkers never spin: the manager turns them to face where they walk.
    if (standing && !walking && !act && !celebrating && state !== 'STANDING_UP' && !mesh.userData.holdFacing) mesh.rotation.y = (mesh.userData.phase || 0) + t * 0.2;
    var ph = typeof walkPhase === 'number' && isFinite(walkPhase) ? walkPhase : t * 5;
    var spd = Math.max(0, Math.min(1.6, Number(extra.speed) || (walking ? 1.2 : 0)));
    var amp = walking ? Math.max(0.35, Math.min(1, spd / 1.2)) : 0;
    var lift = 0, leanX = 0, rollZ = 0;
    if (parts.leftThigh && parts.rightThigh && parts.leftShin && parts.rightShin) {
      if (walking) {
        // walk cycle: legs opposite each other, the trailing knee bends as it swings through
        var sl = Math.sin(ph) * 0.46 * amp, sr = -sl;
        legAt(parts.leftThigh, parts.leftShin, -0.13, HIP_Y, sl, Math.max(0, -Math.cos(ph)) * 0.75 * amp);
        legAt(parts.rightThigh, parts.rightShin, 0.13, HIP_Y, sr, Math.max(0, Math.cos(ph)) * 0.75 * amp);
        lift = Math.abs(Math.cos(ph)) * 0.035 * amp;                 // body bob: highest as a leg passes under
        leanX = 0.06 + 0.05 * amp;                                     // lean into the walk
        rollZ = Math.sin(ph) * 0.03 * amp;                             // small side-to-side weight shift
      } else if (standing) {
        var shift = act === 'pingpong' ? Math.sin(t * 3) * 0.12 : 0;
        legAt(parts.leftThigh, parts.leftShin, -0.13 + shift, HIP_Y, 0, 0);
        legAt(parts.rightThigh, parts.rightShin, 0.13 + shift, HIP_Y, 0, 0);
        if (celebrating) lift = Math.max(0, Math.sin(t * 7)) * 0.28;   // jump for joy
      } else {
        // seated: thighs forward, shins down
        parts.leftThigh.position.set(-0.13, 0.76, -0.16);
        parts.rightThigh.position.set(0.13, 0.76, -0.16);
        parts.leftThigh.rotation.x = Math.PI / 2;
        parts.rightThigh.rotation.x = Math.PI / 2;
        parts.leftShin.position.set(-0.13, 0.43, 0.08);
        parts.rightShin.position.set(0.13, 0.43, 0.08);
        parts.leftShin.rotation.x = 0;
        parts.rightShin.rotation.x = 0;
        if (act === 'lounge') leanX = -0.18;                           // sink back into the sofa
      }
    }
    if (parts.leftArm && parts.rightArm) {
      var working = state === 'WORKING' || state === 'MOUSE' || state === 'THINKING' || state === 'TESTING';
      var reading = state === 'RESEARCHING' || act === 'read';
      var la = 0.08, ra = 0.08, lr = 0.18, rr = -0.18, head = 0, headY = 0;
      if (walking) { la = -Math.sin(ph) * 0.55 * amp; ra = Math.sin(ph) * 0.55 * amp; }  // arms opposite the legs
      else if (celebrating) { la = ra = 2.9; lr = 0.35 + Math.sin(t * 14) * 0.25; rr = -0.35 - Math.sin(t * 14) * 0.25; head = -0.2; }
      else if (reading) { la = 0.95; ra = 0.95; lr = -0.25; rr = 0.25; head = 0.32; }    // tablet held in both hands
      else if (working) { la = 0.95 + Math.sin(t * 13) * 0.12; ra = 0.95 + Math.sin(t * 13 + 1.7) * 0.12; lr = -0.12; rr = 0.12; head = 0.14; } // typing, eyes on the screen
      else if (act === 'play') { la = 1.1 + Math.sin(t * 16) * 0.1; ra = 1.1 + Math.sin(t * 11 + 1) * 0.12; lr = -0.1; rr = 0.1; head = 0.05; headY = Math.sin(t * 2) * 0.05; }
      else if (act === 'foosball') { la = 1.2 + Math.sin(t * 9) * 0.15; ra = 1.2 + Math.sin(t * 9 + 2) * 0.15; lr = -0.2; rr = 0.2; head = 0.25; }
      else if (act === 'pingpong') { la = 0.2; ra = 0.8 + Math.sin(t * 3) * 0.7; rr = -0.3 - Math.sin(t * 3) * 0.3; headY = Math.sin(t * 3) * 0.3; }
      else if (act === 'coffee' || extra.sip > 0) { var sip = Math.max(Number(extra.sip) || 0, act === 'coffee' ? Math.max(0, Math.sin(t * 0.9)) : 0); ra = 0.75 + sip * 1.15; rr = 0.25; head = -0.15 * sip; }
      else if (act === 'meet' || act === 'talk') {
        if (extra.talking) { ra = 0.7 + Math.sin(t * 2.4) * 0.35; rr = -0.2 + Math.sin(t * 1.7) * 0.2; la = 0.45 + Math.sin(t * 2.1 + 1) * 0.2; headY = Math.sin(t * 0.7) * 0.25; }
        else { la = ra = 0.55; lr = -0.2; rr = 0.2; head = Math.sin(t * 0.6) * 0.06; }  // listening, hands on the table
      }
      else if (act === 'watch') { headY = Math.sin(t * 0.8) * 0.35; }
      else if (state === 'WAITING' || state === 'THINKING') head = -0.12;
      else if (!standing) { la = ra = 0.45; }
      limbAt(parts.leftArm, -0.31, ARM_TOP, 0, la, ARM_LEN, lr);
      limbAt(parts.rightArm, 0.31, ARM_TOP, 0, ra, ARM_LEN, rr);
      if (parts.head) { parts.head.rotation.x = head; parts.head.rotation.y = headY; }
    }
    // whole-body bob / lean / weight shift on top of the position applyToScene just set
    if (mesh.position) { mesh.position.y += lift - (mesh.userData._lift || 0); mesh.userData._lift = lift; } // idempotent per frame
    if (mesh.rotation) { mesh.rotation.x = leanX; mesh.rotation.z = rollZ; }
    switch (state) {
      case 'WORKING': mesh.scale.set(base, base * (1 + Math.sin(t * 4) * 0.01), base); break;
      case 'ERROR': mesh.scale.set(base, base * 1.1, base); break;
      default: mesh.scale.set(base, base, base);
    }
    if (mesh.userData.props) updateProps(mesh, act, extra, reading_(state, act), t, standing);
  }
  function reading_(state, act) { return state === 'RESEARCHING' || act === 'read'; }

  // Props (part 2): a coffee mug for sips / coffee spots and a tablet for reading, parented to the avatar and
  // placed in front of the hands in its local space (works for capsules and rigged models alike).
  function ensureProps(group) {
    if (!THREE || !group || (group.userData && group.userData.props)) return group && group.userData && group.userData.props;
    var mug = new THREE.Group();
    var cup = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.047, 0.11, 14), new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.5 }));
    var coffee = new THREE.Mesh(new THREE.CircleGeometry(0.048, 14), new THREE.MeshStandardMaterial({ color: 0x4a2c1a, roughness: 0.8 }));
    coffee.rotation.x = -Math.PI / 2; coffee.position.y = 0.05;
    var handle = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.009, 6, 10), cup.material);
    handle.position.set(0.06, 0, 0); handle.rotation.y = Math.PI / 2;
    mug.add(cup); mug.add(coffee); mug.add(handle);
    var tab = new THREE.Group();
    var slab = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.012, 0.22), new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.4, metalness: 0.5 }));
    var screen = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.18), new THREE.MeshStandardMaterial({ color: 0x0b1220, emissive: 0x38bdf8, emissiveIntensity: 0.6 }));
    screen.rotation.x = -Math.PI / 2; screen.position.y = 0.007;
    tab.add(slab); tab.add(screen);
    mug.visible = tab.visible = false;
    mug.userData.tevaProp = 'mug'; tab.userData.tevaProp = 'tablet';
    group.add(mug); group.add(tab);
    var s = 1 / (group.scale && group.scale.x ? group.scale.x : 1);
    mug.scale.setScalar(s); tab.scale.setScalar(s);
    group.userData.props = { mug: mug, tablet: tab };
    return group.userData.props;
  }
  function updateProps(group, act, extra, reading, t, standing) {
    var P = group.userData.props;
    if (!P) return;
    var s = 1 / (group.scale && group.scale.x ? group.scale.x : 1);
    var seatedDrop = standing ? 0 : -0.18;
    var sip = Math.max(Number(extra.sip) || 0, act === 'coffee' ? Math.max(0, Math.sin(t * 0.9)) : 0);
    P.mug.visible = act === 'coffee' || (extra.sip || 0) > 0;
    if (P.mug.visible) P.mug.position.set(0.28 * s, (1.02 + seatedDrop + sip * 0.42) * s, (0.3 - sip * 0.12) * s);
    P.tablet.visible = !!reading;
    if (P.tablet.visible) { P.tablet.position.set(0, (1.0 + seatedDrop) * s, 0.36 * s); P.tablet.rotation.x = -0.75; }
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
    if (Number.isFinite(entry.yaw) && (walking || entry.movement || entry.holdYaw)) {
      // walking / standing after a walk: the manager turns the avatar to face its heading (smoothed in update)
      group.rotation.y = entry.yaw;
    } else if (seated) {
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
    if (group.userData) { group.userData.holdFacing = !!entry.holdYaw; group.userData._lift = 0; }
    proceduralPose(group, entry.motionState || entry.state, entry._t || 0, entry.walkPhase, poseExtra(entry));
  }

  function poseExtra(entry) {
    var x = entry._extra || (entry._extra = {});
    x.speed = entry.speed || 0;
    x.activity = entry.movement ? null : (entry.activity || null);
    x.sit = !!entry.activitySit;
    x.talking = !!entry.talking;
    x.sip = entry.sip || 0;
    x.celebrate = !!entry.celebrate;
    return x;
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
      var M = Motion();
      if (entry.movement && M && entry.movement.profile) {
        this._stepMotion(entry, dt, M);
      } else if (entry.movement) {
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
      if (!entry.movement && entry.arrivalActivity !== undefined) { entry.activity = entry.arrivalActivity; entry.activitySit = !!entry.arrivalSit; entry.arrivalActivity = undefined; }
      if (entry.motionState) next = entry.motionState;
      if (next !== entry.state) {
        var clip = Avatars.clipFor(entry.avatar, next);
        setState(entry, next, clip);
      }
      entry._t = this._t;
      var animate = this.quality !== 'off' && (this.quality === 'full' || this._frame % 2 === 0);
      if (animate && entry.group && entry.group.userData && entry.group.userData.fallback) {
        var poseState = entry.motionState || entry.state;
        if (!entry.group.userData.props) ensureProps(entry.group);
        proceduralPose(entry.group, poseState, this._t, entry.walkPhase, poseExtra(entry));
      } else if (animate && entry.group && entry.group.userData) {
        // rigged models: props still show (mug / tablet), the clip does the body
        if (!entry.group.userData.props) ensureProps(entry.group);
        var ps2 = entry.motionState || entry.state, ex = poseExtra(entry);
        updateProps(entry.group, ex.activity, ex, reading_(ps2, ex.activity), this._t, ps2 === 'WALKING' || ps2 === 'STANDING' || !ex.sit);
      }
      // stride matching for rigged walk clips: play the walk at the speed the avatar actually moves
      if (entry._action && M && entry.motionState === 'WALKING' && entry._action.setEffectiveTimeScale) {
        entry._action.setEffectiveTimeScale(M.clipTimeScale(entry.speed || 0, M.STRIDE, 1));
      } else if (entry._action && entry._action.setEffectiveTimeScale && entry._action.getEffectiveTimeScale && entry._action.getEffectiveTimeScale() !== 1 && entry.motionState !== 'WALKING') {
        entry._action.setEffectiveTimeScale(1);
      }
      if (animate && entry._mixer) entry._mixer.update(this.quality === 'reduced' ? dt * 0.5 : dt);
    }
  };

  // One movement tick on the natural-pace path: turn first (and stand up from a chair), then walk along the
  // polyline by arc length with a trapezoid speed profile, legs advancing with distance, facing the heading;
  // arrive into a chair (SITTING_DOWN) or stand (options.pose === 'stand').
  Manager.prototype._stepMotion = function (entry, dt, M) {
    var move = entry.movement;
    move.elapsed += dt;
    var startH = M.pointAt(move.points, 0.05).heading;
    if (!Number.isFinite(entry.yaw)) entry.yaw = entry.group ? entry.group.rotation.y : startH;
    if (move.elapsed < move.delay) {
      // stand up / turn in place before stepping off
      entry.motionState = move.fromSeat && move.elapsed < Math.min(move.delay, 0.6) ? 'STANDING_UP' : 'STANDING';
      entry.yaw = M.turnToward(entry.yaw, startH, dt);
      entry.speed = 0;
      if (entry.group) applyToScene(entry, entry.group, entry.position);
      return;
    }
    var t = move.elapsed - move.delay, pr = move.profile;
    var s = M.distanceAt(pr, t), prevS = move.s || 0;
    var p = M.pointAt(move.points, s);
    entry.position.x = p.x; entry.position.z = p.z;
    entry.speed = M.speedAt(pr, t);
    entry.walkPhase = (entry.walkPhase || 0) + M.cycleAdvance(s - prevS);
    move.s = s;
    if (s < pr.len - 1e-3) entry.yaw = M.turnToward(entry.yaw, p.heading, dt);
    entry.motionState = 'WALKING';
    if (t >= pr.duration) {
      entry.speed = 0;
      if (move.seatedTarget) {
        entry.position.x = move.seatedTarget.x;
        entry.position.z = move.seatedTarget.z;
        entry.motionState = 'SITTING_DOWN';
        entry.settleUntil = this._t + 0.8;
        entry.holdYaw = false;
        entry.yaw = NaN; // the chair's rotation takes over
      } else {
        var last = move.points[move.points.length - 1];
        entry.position.x = last.x; entry.position.z = last.z;
        // part 2: a sofa / boardroom chair / lab chair / stool is sat on (sit down, facing faceYaw)
        entry.motionState = move.pose === 'sit' ? 'SITTING_DOWN' : (move.pose === 'stand' ? 'STANDING' : null);
        if (move.pose === 'sit') entry.settleUntil = this._t + 0.8;
        entry.holdYaw = move.pose === 'stand' || move.pose === 'sit' || Number.isFinite(move.faceYaw);
        if (Number.isFinite(move.faceYaw)) entry.yaw = move.faceYaw;
      }
      entry.lastMovementKey = move.key;
      entry.movement = null;
    }
    if (entry.group) applyToScene(entry, entry.group, entry.position);
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
    // Natural-pace path: already standing / sitting at the final spot (any route) -> nothing to do; and a walk
    // already heading to the same final spot keeps going (a re-planned route must not restart it from rest).
    if (Motion() && !options.force) {
      if (!entry.movement && atDestination) return true;
      if (entry.movement && entry.movement.profile) {
        var mp = entry.movement.points, mf = entry.movement.seatedTarget || mp[mp.length - 1];
        if (Math.hypot(mf.x - finalPosition.x, mf.z - finalPosition.z) < 0.05) return true;
      }
    }
    var M = Motion();
    entry.movement = {
      points: points,
      elapsed: 0,
      duration: Math.max(0.25, Number(options.duration) || 1.2),
      key: movementKey,
      seatedTarget: seatedTarget
    };
    if (M) {
      // Natural pace: the route is timed from its length (WALK_SPEED, or options.speed such as the ambient
      // stroll), never squeezed into options.duration (the old 2.5 s fixed time made long trips to the Fun
      // Wing a 15 m/s slide). Big heading changes, or leaving a chair, turn / stand up first.
      var len = M.pathLength(points);
      if (len < 0.02 && !seatedTarget) { entry.movement = null; return true; }
      var pr = M.profile(len, options.speed || M.WALK_SPEED);
      var h0 = M.pointAt(points, 0.05).heading;
      var yaw0 = Number.isFinite(entry.yaw) ? entry.yaw : (entry.group ? entry.group.rotation.y : h0);
      var wasSeated = !entry.holdYaw && !entry.motionState && entry.state !== 'WALKING' && !!(entry.avatar && entry.avatar.seated && entry.avatar.seated.enabled);
      entry.movement.profile = pr;
      entry.movement.delay = (wasSeated ? 0.7 : 0) + (M.turnFirst(yaw0, h0) ? 0.35 : 0);
      entry.movement.fromSeat = wasSeated;
      entry.movement.duration = entry.movement.delay + pr.duration;
      entry.movement.pose = options.pose || null;
      // part 2: what the avatar does once there (office.html: the reserved spot's activity), cleared while walking
      entry.activity = null;
      entry.arrivalActivity = options.activity || null;
      entry.arrivalSit = options.pose === 'sit';
      entry.movement.faceYaw = Number.isFinite(Number(options.faceYaw)) && options.faceYaw !== null ? Number(options.faceYaw) : NaN;
      entry.movement.s = 0;
      entry.yaw = yaw0;
      entry.holdYaw = false;
    }
    return true;
  };

  /** Part 2: per-seat interaction details driven by office.html (real events / ambient, never data):
   *  { talking: bool (boardroom speaker), sip: 0..1 (ambient sip fidget -> mug) }. */
  Manager.prototype.setInteraction = function (agentId, info) {
    var entry = this.entries[agentId];
    if (!entry || !info) return false;
    if ('talking' in info) entry.talking = !!info.talking;
    if ('celebrate' in info) entry.celebrate = !!info.celebrate;
    if ('sip' in info) entry.sip = Math.max(0, Math.min(1, Number(info.sip) || 0));
    if ('activity' in info && !entry.movement) { entry.activity = info.activity || null; entry.activitySit = !!info.sit; }
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
      activity: entry.activity || null,
      props: entry.group && entry.group.userData && entry.group.userData.props ? { mug: entry.group.userData.props.mug.visible, tablet: entry.group.userData.props.tablet.visible } : null,
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
    ensureProps: ensureProps,
    setState: setState,
    Manager: Manager
  };
})(typeof window !== 'undefined' ? window : (global || {}));
