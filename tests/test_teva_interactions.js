// Unit tests for the 2026-10-22 part 2 walking + interaction work: the capsule walk cycle (teva_avatar_manager.js
// proceduralPose), the rigged walk clip (teva_avatars.js), arrival sit / activity in the manager, and the office.html
// wiring for both looks (activities at reserved spots, props, boardroom speaker, celebration).
// Run: node tests/test_teva_interactions.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
global.window = global;
require(path.join(__dirname, '..', 'public', 'js', 'teva_motion.js'));
global.TevaMotion = global.TevaMotion || require(path.join(__dirname, '..', 'public', 'js', 'teva_motion.js'));
require(path.join(__dirname, '..', 'public', 'js', 'teva_avatars.js'));
require(path.join(__dirname, '..', 'public', 'js', 'teva_avatar_manager.js'));
const M = global.TevaAvatarManager;
const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'office.html'), 'utf8');
const avatarsSrc = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'teva_avatars.js'), 'utf8');
let n = 0;
function t(name, fn) { fn(); n++; console.log('ok', n, name); }
function v3() { return { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } }; }
function part() { return { position: v3(), rotation: { x: 0, y: 0, z: 0 } }; }
function capsule() {
  const parts = { head: part(), leftArm: part(), rightArm: part(), leftThigh: part(), rightThigh: part(), leftShin: part(), rightShin: part() };
  return { userData: { fallback: true, parts, baseScale: 1 }, position: v3(), rotation: { x: 0, y: 0, z: 0 }, scale: { set() {} } };
}
// arm swing forward = negative rotation.x (see limbAt); thigh forward likewise
const fwd = p => -p.rotation.x;

t('walk cycle: each arm swings opposite its own leg, legs opposite each other, all through a full stride', () => {
  const m = capsule(), P = m.userData.parts;
  let checked = 0;
  for (let ph = 0.3; ph < Math.PI * 2; ph += 0.4) {
    M.proceduralPose(m, 'WALKING', 0, ph, { speed: 1.35 });
    if (Math.abs(fwd(P.leftThigh)) < 0.05) continue;
    assert.ok(Math.sign(fwd(P.leftArm)) === -Math.sign(fwd(P.leftThigh)), 'left arm vs left leg at ' + ph.toFixed(1));
    assert.ok(Math.sign(fwd(P.rightArm)) === -Math.sign(fwd(P.rightThigh)), 'right arm vs right leg');
    assert.ok(Math.sign(fwd(P.leftThigh)) === -Math.sign(fwd(P.rightThigh)), 'legs alternate');
    checked++;
  }
  assert.ok(checked >= 10);
});

t('limbs swing about the shoulder / hip, not their middle (the top of the arm stays at the shoulder)', () => {
  const m = capsule(), P = m.userData.parts;
  [0.5, 2.0, 4.0].forEach(ph => {
    M.proceduralPose(m, 'WALKING', 0, ph, { speed: 1.35 });
    const a = fwd(P.leftArm), topY = P.leftArm.position.y + Math.cos(a) * 0.275, topZ = P.leftArm.position.z - Math.sin(a) * 0.275;
    assert.ok(Math.abs(topY - 1.355) < 1e-9 && Math.abs(topZ) < 1e-9, 'shoulder fixed');
    const h = fwd(P.leftThigh), hipY = P.leftThigh.position.y + Math.cos(h) * 0.26, hipZ = P.leftThigh.position.z - Math.sin(h) * 0.26;
    assert.ok(Math.abs(hipY - 1.02) < 1e-9 && Math.abs(hipZ) < 1e-9, 'hip fixed');
  });
});

t('body bob, forward lean and weight shift while walking; none when standing still; bob is idempotent per frame', () => {
  const m = capsule(), ys = [];
  for (let ph = 0; ph < Math.PI * 2; ph += 0.3) { m.position.y = 0; m.userData._lift = 0; M.proceduralPose(m, 'WALKING', 0, ph, { speed: 1.35 }); ys.push(m.position.y); }
  assert.ok(Math.max(...ys) - Math.min(...ys) > 0.02, 'bobs');
  assert.ok(m.rotation.x > 0.05, 'leans into the walk');
  m.position.y = 0; m.userData._lift = 0;
  M.proceduralPose(m, 'WALKING', 0, 0, { speed: 1.35 }); const once = m.position.y;
  M.proceduralPose(m, 'WALKING', 0, 0, { speed: 1.35 });
  assert.ok(Math.abs(m.position.y - once) < 1e-12, 'calling twice in one frame does not double the bob');
  M.proceduralPose(m, 'STANDING', 0, 0, {});
  assert.strictEqual(m.rotation.x, 0); assert.strictEqual(m.rotation.z, 0);
});

t('slower walking = smaller stride swing (eases in and out with the speed profile)', () => {
  const a = capsule(), b = capsule();
  M.proceduralPose(a, 'WALKING', 0, Math.PI / 2, { speed: 1.35 });
  M.proceduralPose(b, 'WALKING', 0, Math.PI / 2, { speed: 0.3 });
  assert.ok(Math.abs(fwd(b.userData.parts.leftThigh)) < Math.abs(fwd(a.userData.parts.leftThigh)));
});

t('interactions: typing hands move and look at the screen; reading holds the tablet up; coffee lifts the mug; celebrate raises both arms and jumps', () => {
  const m = capsule(), P = m.userData.parts;
  M.proceduralPose(m, 'WORKING', 1.0, 0, {}); const a1 = fwd(P.leftArm);
  M.proceduralPose(m, 'WORKING', 1.1, 0, {}); const a2 = fwd(P.leftArm);
  assert.ok(a1 > 0.7 && a2 > 0.7 && Math.abs(a1 - a2) > 0.01, 'typing: forearms forward and moving');
  assert.ok(P.head.rotation.x > 0.1, 'eyes on the screen');
  M.proceduralPose(m, 'IDLE', 1, 0, { activity: 'read', sit: true });
  assert.ok(fwd(P.leftArm) > 0.8 && fwd(P.rightArm) > 0.8 && P.head.rotation.x > 0.25, 'reading');
  M.proceduralPose(m, 'IDLE', Math.PI / 1.8, 0, { activity: 'coffee' });
  assert.ok(fwd(P.rightArm) > 1.2, 'sip');
  let top = 0;
  for (let k = 0; k < 20; k++) { m.position.y = 0; m.userData._lift = 0; M.proceduralPose(m, 'IDLE', k * 0.05, 0, { celebrate: true }); top = Math.max(top, m.position.y); }
  assert.ok(fwd(P.leftArm) > 2.5 && fwd(P.rightArm) > 2.5, 'arms up');
  assert.ok(top > 0.2, 'jumps');
  M.proceduralPose(m, 'IDLE', 2, 0, { activity: 'meet', sit: true, talking: true }); const g1 = fwd(P.rightArm);
  M.proceduralPose(m, 'IDLE', 2.6, 0, { activity: 'meet', sit: true, talking: true });
  assert.ok(Math.abs(g1 - fwd(P.rightArm)) > 0.05, 'the speaker gestures');
  M.proceduralPose(m, 'IDLE', 1, 0, { activity: 'play' });
  assert.ok(fwd(P.leftArm) > 0.9, 'hands on the arcade controls');
});

t('manager: arriving at a sofa / chair sits down facing faceYaw and starts the spot activity; walking clears it', () => {
  const mgr = new M.Manager(null);
  const e = mgr.addAgent({ id: 's1' }, { x: 0, z: 0 });
  mgr.moveAgent('s1', { x: 3, z: 0 }, { pose: 'sit', faceYaw: 1.2, activity: 'lounge' });
  assert.strictEqual(e.activity, null, 'no activity while walking');
  for (let i = 0; i < 200 && e.movement; i++) mgr.update(0.05, Date.now());
  mgr.update(0.05, Date.now());
  assert.strictEqual(e.movement, null);
  assert.ok(Math.abs(e.yaw - 1.2) < 1e-9 && e.holdYaw, 'faces the spot direction');
  for (let i = 0; i < 20; i++) mgr.update(0.05, Date.now());
  assert.strictEqual(e.activity, 'lounge');
  assert.ok(e.activitySit);
  mgr.setInteraction('s1', { talking: true, sip: 0.5, celebrate: true });
  assert.ok(e.talking && e.sip === 0.5 && e.celebrate);
  mgr.moveAgent('s1', { x: 6, z: 0 }, { pose: 'stand' });
  assert.strictEqual(e.activity, null);
});

t('rigged walk clip: contact / passing / contact / passing keys with knee bend and chest counter-rotation', () => {
  assert.ok(/makeClip\('Walking', \[0, 0\.25, 0\.5, 0\.75, 1\]/.test(avatarsSrc));
  assert.ok(/passing === 'l' \? 0\.75/.test(avatarsSrc) && /spine_02/.test(avatarsSrc));
});

t('office.html: activities at reserved spots in both looks, props, boardroom speaker, celebration', () => {
  assert.ok(/function legacyActivityPose\(a, P, act, sit, talking, t\)/.test(html), 'Classic activity poses');
  ['lounge', 'watch', 'meet', 'read', 'play', 'foosball', 'pingpong', 'coffee', 'talk'].forEach(a => assert.ok(html.indexOf("case '" + a + "':") > 0, a));
  assert.ok(/obj\._activity === 'coffee'/.test(html), 'Classic mug while at the coffee spots');
  assert.ok(/obj\._activity === 'read'/.test(html), 'Classic tablet / folder while reading');
  assert.ok(/opts\.pose = t\.sit \? 'sit' : 'stand'/.test(html) && /opts\.activity = t\.activity/.test(html), 'Cyberpunk sits / acts at reserved spots');
  assert.ok(/setInteraction\(agent\.id, \{ talking: !!t\.talking \}\)/.test(html), 'boardroom speaker gestures');
  assert.ok(/setInteraction\(id, \{ celebrate: celeb && !moving, sip:/.test(html), 'Cyberpunk mug + celebration');
  assert.ok(/celebrate: 2\.4,/.test(html) && /confettiBurst\(obj, 14\)/.test(html), 'clearer task-done moment');
  assert.ok(/talking: zt\.talking/.test(html), 'zones pass the speaker');
  // ambient stays decorative: no feed writes from the activity code
  const a = html.indexOf('function legacyActivityPose'), b = html.indexOf('function cameraFacing');
  assert.ok(!/FEED|pushFeed|addFeed/.test(html.slice(a, b)), 'activity poses never touch the feed');
});

console.log('TESTS PASSED (' + n + ')');
