// Unit tests for public/js/teva_motion.js + the natural-pace path in teva_avatar_manager.js (2026-10-22).
// Run: node tests/test_teva_motion.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const M = require(path.join(__dirname, '..', 'public', 'js', 'teva_motion.js'));

let n = 0;
function t(name, fn) { fn(); n++; console.log('ok', n, name); }
const near = (a, b, eps) => Math.abs(a - b) <= (eps || 1e-6);

t('natural pace: real walks 1.35 m/s, ambient strolls 1.0 m/s, hard cap 1.6 m/s', () => {
  assert.ok(M.WALK_SPEED >= 1.1 && M.WALK_SPEED <= 1.5);
  assert.ok(M.STROLL_SPEED < M.WALK_SPEED);
  assert.strictEqual(M.profile(40, 99).vPeak, M.MAX_SPEED);
});

t('a 40 m trip to the Fun Wing takes ~30 s, not the old fixed 2.5 s (16 m/s)', () => {
  const d = M.routeDuration([{ x: 0, z: 0 }, { x: 40, z: 0 }]);
  assert.ok(d > 28 && d < 33, d);
  assert.ok(40 / d <= M.WALK_SPEED + 1e-9);
  // a caller asking for 2.5 s does not make it faster
  assert.strictEqual(M.routeDuration([{ x: 0, z: 0 }, { x: 40, z: 0 }], { duration: 2.5 }), d);
});

t('trapezoid profile: starts and ends at rest, distance is monotonic and reaches the end exactly', () => {
  [0.3, 2, 12, 55].forEach(len => {
    const pr = M.profile(len, M.WALK_SPEED);
    assert.strictEqual(M.speedAt(pr, 0), 0); assert.strictEqual(M.speedAt(pr, pr.duration), 0);
    assert.ok(near(M.distanceAt(pr, pr.duration), len, 1e-9), len);
    let prev = -1, maxV = 0;
    for (let i = 0; i <= 200; i++) { const tt = pr.duration * i / 200, s = M.distanceAt(pr, tt); assert.ok(s >= prev - 1e-12); prev = s; maxV = Math.max(maxV, M.speedAt(pr, tt)); }
    assert.ok(maxV <= M.WALK_SPEED + 1e-9);
    assert.ok(M.speedAt(pr, pr.duration * 0.05) < M.speedAt(pr, pr.duration * 0.5) + 1e-9, 'eases in');
  });
});

t('pointAt follows the polyline by arc length with the segment heading', () => {
  const pts = [{ x: 0, z: 0 }, { x: 0, z: 4 }, { x: 3, z: 4 }];
  assert.deepStrictEqual(M.pointAt(pts, 2), { x: 0, z: 2, heading: 0 });
  const p = M.pointAt(pts, 5.5);
  assert.ok(near(p.x, 1.5) && near(p.z, 4) && near(p.heading, Math.PI / 2));
  assert.ok(near(M.pointAt(pts, 99).x, 3));
});

t('stride matching: the walk cycle advances with ground covered, not with time', () => {
  assert.ok(near(M.cycleAdvance(M.STRIDE), Math.PI * 2));
  assert.strictEqual(M.cycleAdvance(0), 0);
  assert.ok(near(M.clipTimeScale(M.STRIDE, M.STRIDE, 1), 1));
  assert.strictEqual(M.clipTimeScale(0), 0.35);
  assert.strictEqual(M.clipTimeScale(9), 1.6);
});

t('legacy speed controller accelerates, cruises and brakes to stop at the target', () => {
  let v = 0, rem = 10, steps = 0;
  while (rem > 0.03 && steps < 5000) { v = M.nextSpeed(v, M.WALK_SPEED, rem, 1 / 30); rem -= v / 30; steps++; assert.ok(v <= M.WALK_SPEED + 1e-9); }
  assert.ok(steps < 5000 && rem > -0.1, 'arrives without overshooting much');
  assert.ok(M.nextSpeed(0, M.WALK_SPEED, 10, 1 / 30) < 0.1, 'eases in from rest');
  assert.ok(M.nextSpeed(1.35, M.WALK_SPEED, 0.05, 1 / 30) < 1.35, 'brakes near the end');
});

t('turn to face: big heading changes turn in place first; turning converges', () => {
  assert.ok(M.turnFirst(0, Math.PI)); assert.ok(!M.turnFirst(0, 0.5));
  let y = 0; for (let i = 0; i < 60; i++) y = M.turnToward(y, 3, 1 / 30);
  assert.ok(near(y, 3, 0.01));
  assert.ok(near(M.wrap(3 * Math.PI), Math.PI) || near(M.wrap(3 * Math.PI), -Math.PI));
});

t('overlay poses for Cyberpunk: turn-done celebrate raises both arms, zero at the ends', () => {
  const c = M.overlayPose('celebrate', 0.5);
  assert.ok(c.lArm > 2 && c.rArm > 2);
  ['celebrate', 'headScratch', 'raiseHand', 'wave', 'stretch', 'leanBack', 'startle'].forEach(nm => {
    M.OVERLAY_KEYS.forEach(k => { assert.strictEqual(M.overlayPose(nm, 0)[k], 0); assert.strictEqual(M.overlayPose(nm, 1)[k], 0); });
  });
});

// ---- manager integration (vm sandbox, no THREE)
function sandboxWith(motion) {
  const sb = { window: {}, global: {} }; sb.window = sb; sb.global = sb;
  const ctx = vm.createContext(sb);
  if (motion) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'teva_motion.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'teva_avatars.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'teva_avatar_manager.js'), 'utf8'), ctx);
  return sb;
}

t('manager: long trips are timed by length (natural pace), never a fixed 2.5 s', () => {
  const sb = sandboxWith(true), mgr = new sb.TevaAvatarManager.Manager(null);
  const e = mgr.addAgent({ id: 'w' }, { x: 0, z: 0 });
  e.holdYaw = true; // standing start (no stand-up delay) to measure pure walking
  mgr.moveAgent('w', { x: 40, z: 0 }, { duration: 2.5 });
  let tt = 0, maxV = 0, last = 0;
  while (e.movement && tt < 120) { mgr.update(0.05, 0); tt += 0.05; maxV = Math.max(maxV, (e.position.x - last) / 0.05); last = e.position.x; }
  assert.ok(tt > 28 && tt < 35, 'took ' + tt.toFixed(1) + ' s');
  assert.ok(maxV <= sb.TevaMotion.WALK_SPEED + 0.01, 'max ' + maxV);
  assert.ok(Math.abs(e.position.x - 40) < 1e-6);
});

t('manager: leaving a chair stands up and turns first, legs advance with distance, then sits at the next chair', () => {
  const sb = sandboxWith(true), mgr = new sb.TevaAvatarManager.Manager(null);
  sb.TevaAssets = { resolveAgentPosition: () => ({ x: 0, z: 10, rotation: 0 }) };
  const e = mgr.addAgent({ id: 's', avatar: { seated: { enabled: true } } }, { x: 0, z: 0 });
  e.avatar.seated = { enabled: true, offset: {}, seatHeight: 0.62 };
  mgr.moveAgent('s', { x: 0, z: 10 }, {});
  mgr.update(0.05, 0);
  assert.strictEqual(e.motionState, 'STANDING_UP');
  assert.ok(e.movement.delay >= 0.7);
  let tt = 0, phase0 = null, sawWalk = false;
  while (e.movement && tt < 60) { mgr.update(0.05, 0); tt += 0.05; if (e.motionState === 'WALKING') { sawWalk = true; if (phase0 === null) phase0 = e.walkPhase || 0; } }
  assert.ok(sawWalk);
  const walked = 10 - 0.82; // approach point stops 0.82 m before the chair
  assert.ok(Math.abs((e.walkPhase - phase0) - sb.TevaMotion.cycleAdvance(walked)) < 0.6, 'phase follows distance');
  assert.strictEqual(e.motionState, 'SITTING_DOWN');
  assert.ok(e.position.z === 10);
});

t('manager: standing destinations hold a standing pose facing the requested way; re-planned routes do not restart', () => {
  const sb = sandboxWith(true), mgr = new sb.TevaAvatarManager.Manager(null);
  const e = mgr.addAgent({ id: 'b' }, { x: 0, z: 0 }); e.holdYaw = true;
  mgr.moveAgent('b', { x: 6, z: 0 }, { pose: 'stand', faceYaw: 1.0, path: [{ x: 3, z: 0 }] });
  for (let i = 0; i < 20; i++) mgr.update(0.05, 0);
  const el = e.movement.elapsed;
  mgr.moveAgent('b', { x: 6, z: 0 }, { pose: 'stand', faceYaw: 1.0 }); // same final spot, different route
  assert.strictEqual(e.movement.elapsed, el, 'still the same walk');
  while (e.movement) mgr.update(0.05, 0);
  assert.strictEqual(e.motionState, 'STANDING'); assert.strictEqual(e.yaw, 1.0); assert.ok(e.holdYaw);
  mgr.update(0.05, 0); assert.strictEqual(e.motionState, 'STANDING');
  assert.strictEqual(mgr.moveAgent('b', { x: 6, z: 0 }, {}), true); assert.strictEqual(e.movement, null, 'already there');
});

t('manager without TevaMotion keeps the old fixed-duration behaviour (back-compat)', () => {
  const sb = sandboxWith(false), mgr = new sb.TevaAvatarManager.Manager(null);
  const e = mgr.addAgent({ id: 'o' }, { x: 0, z: 0 });
  mgr.moveAgent('o', { x: 2, z: 0 }, { duration: 1 });
  mgr.update(1.1, 0);
  assert.strictEqual(e.movement, null);
});

t('office.html + manager wiring: motion script loaded before the manager, legacy walk uses TevaMotion, modular follows seat targets', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'office.html'), 'utf8');
  assert.ok(html.indexOf('<script src="js/teva_motion.js"></script>') >= 0 && html.indexOf('js/teva_motion.js') < html.indexOf('js/teva_avatar_manager.js'));
  assert.ok(/TM\.nextSpeed\(a\.walkSpeed \|\| 0, ambMove \? TM\.STROLL_SPEED : TM\.WALK_SPEED, dist, delta\)/.test(html));
  assert.ok(/a\.walkCycle \+= TM\.cycleAdvance\(step\)/.test(html));
  assert.ok(html.includes('function syncModularDestinations()') && /syncModularDestinations\(\);\n\}/.test(html));
  assert.ok(!/duration: 2\.5 \}\);/.test(html), 'no fixed 2.5 s walks left');
  const mgr = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'teva_avatar_manager.js'), 'utf8');
  assert.ok(mgr.includes('M.clipTimeScale(entry.speed || 0, M.STRIDE, 1)'), 'rigged walk clip plays at ground speed');
});

console.log(`TESTS PASSED (${n})`);
