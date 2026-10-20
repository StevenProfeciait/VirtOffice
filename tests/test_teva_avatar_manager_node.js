const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sandbox = { window: {}, global: {} };
sandbox.window = sandbox;
sandbox.global = sandbox;

// stubs for pure-logic test (no THREE)
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'teva_avatars.js'), 'utf8'), vm.createContext(sandbox));
sandbox.TevaAssets = { resolveNavPoint: function (name) { return name === 'meeting' ? { x: 1, z: 1 } : null; } };
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'teva_avatar_manager.js'), 'utf8'), sandbox);
const M = sandbox.TevaAvatarManager;
const A = sandbox.TevaAvatars;

let fail = 0;
function check(cond, msg) { if (!cond) { console.error('FAIL:', msg); fail++; } }

const mgr = new M.Manager(null);
check(mgr.scene === null, 'manager scene');
check(mgr.getQuality() === 'full', 'default quality');
check(mgr.setQuality('reduced') === 'reduced' && mgr.getQuality() === 'reduced', 'reduced quality');
check(mgr.setQuality('invalid') === 'full', 'quality fallback');
const e = mgr.addAgent({ id: 'a1', name: 'A1', avatar: { fallback: { color: '#fff', emoji: 'A' } } });
check(e.state === 'IDLE', 'idle state');
check(e.avatar.fallback.emoji === 'A', 'avatar normalize');
mgr.updateAgent({ id: 'a1', name: 'A1', status: 'working', avatar: { fallback: { color: '#fff' } } });
check(e.state === 'WORKING', 'working state');
mgr.updateAgent({ id: 'a1', activity: { state: 'ERROR' }, avatar: { fallback: {} } });
check(e.state === 'ERROR', 'error state');
mgr.dispose();
check(Object.keys(mgr.entries).length === 0, 'disposed');

check(typeof M.proceduralPose === 'function', 'proceduralPose');
// Seated fallback avatars must keep the seat rotation applied by applyToScene;
// only idle standers drift, otherwise agents slowly turn away from their desks.
function poseStub(rotY) {
  return { userData: { fallback: true, parts: {}, baseScale: 1 }, rotation: { y: rotY }, scale: { set: function () {} } };
}
const seatedPose = poseStub(2.5);
M.proceduralPose(seatedPose, 'IDLE', 10);
check(seatedPose.rotation.y === 2.5, 'seated fallback keeps seat rotation');
M.proceduralPose(seatedPose, 'WORKING', 10);
check(seatedPose.rotation.y === 2.5, 'working fallback keeps seat rotation');
const standingPose = poseStub(0);
M.proceduralPose(standingPose, 'STANDING', 10);
check(standingPose.rotation.y > 0, 'standing fallback still idles in place');
check(A.stateFromActivity({}) === 'IDLE', 'idle');
check(A.normalizeAvatar({ id: 'scale', avatar: { scale: 1.5, offset: { x: 1 } } }).scale === 1.5, 'scale');
check(A.normalizeAvatar({ id: 'offset', avatar: { offset: { x: 1 } } }).offset.x === 1, 'offset');
check(A.resolveClip([{ name: 'WorkingLoop' }], 'WORKING').name === 'WorkingLoop', 'clip discovery');
check(A.resolveClip([{ name: 'SeatedTyping' }], 'WORKING').name === 'SeatedTyping', 'seated clip discovery');
check(A.normalizeAvatar({ id: 'seat', avatar: { seated: { seatHeight: 0.7, pose: 'seated_typing' } } }).seated.seatHeight === 0.7, 'seated config');
const moved = new M.Manager(null);
moved.addAgent({ id: 'move' }, { x: 0, z: 0 });
check(moved.moveAgent('move', { x: 2, z: 0 }, { duration: 1 }) === true, 'movement accepted');
moved.update(0.5, Date.now());
check(moved.entries.move.position.x > 0 && moved.entries.move.position.x < 2, 'movement interpolates');
check(moved.getDiagnostics('move').seated === false, 'walking diagnostics are not seated');
check(moved.moveAgent('move', { x: 2, z: 0 }, { duration: 1 }) === true, 'duplicate movement accepted idempotently');
check(moved.entries.move.movement.elapsed === 0.5, 'duplicate movement does not restart');
moved.update(0.6, Date.now());
check(moved.entries.move.movement === null && moved.entries.move.lastMovementKey, 'movement completes once');
check(moved.moveAgent('move', { x: 2, z: 0 }, { duration: 1 }) === true && moved.entries.move.movement === null, 'completed movement is not replayed');
const routed = new M.Manager(null);
routed.addAgent({ id: 'route' }, { x: 0, z: 0 });
routed.moveAgent('route', { x: 2, z: 2 }, { duration: 1, path: [{ x: 0, z: 2 }] });
routed.update(0.5, Date.now());
check(routed.entries.route.position.z > 0, 'movement follows supplied waypoint');
const named = new M.Manager(null);
named.addAgent({ id: 'named' }, { x: 0, z: 0 });
check(named.moveAgent('named', { x: 2, z: 2 }, { path: ['meeting'] }) === true && named.entries.named.movement.points.length === 3, 'movement accepts named navigation path');
const seatManager = new M.Manager(null);
seatManager.addAgent({ id: 'seat-target' }, { x: 0, z: 0 });
sandbox.TevaAssets.resolveAgentPosition = function () { return { x: 0, z: 2, rotation: 0 }; };
check(seatManager.moveAgent('seat-target', { x: 0, z: 2 }, { duration: 0.25 }) === true, 'seat destination accepted');
check(seatManager.entries['seat-target'].movement.points[1].z < 2, 'seat destination stops before chair');
seatManager.update(0.3, Date.now());
check(seatManager.entries['seat-target'].position.z === 2 && seatManager.entries['seat-target'].motionState === 'SITTING_DOWN', 'seat destination settles into chair');
const diagnostics = moved.getDiagnostics('move');
check(diagnostics && diagnostics.agentId === 'move' && diagnostics.movement === null && diagnostics.position.x === 2, 'manager diagnostics');

console.log(fail ? `FAIL ${fail}` : 'ok');
process.exit(fail ? 1 : 0);
