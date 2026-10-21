// Fun Station idle-spot hash routing (mirrors idleSpotForAgent in office.html).
// Run: node tests/test_fun_idle_routing_node.js
const path = require('path');
const fs = require('fs');
const vm = require('vm');

const layoutPath = path.join(__dirname, '..', 'public', 'office_layout.js');
const sandbox = { window: {}, global: {} };
sandbox.window = sandbox;
sandbox.global = sandbox;
vm.runInContext(fs.readFileSync(layoutPath, 'utf8'), vm.createContext(sandbox));
const layout = sandbox.OFFICE_LAYOUT || sandbox.LAYOUT;
if (!layout || !layout.funWing || !layout.funWing.idleSpots) {
  console.error('funWing.idleSpots missing');
  process.exit(1);
}

const fw = layout.funWing;
let fail = 0;

function idleSpotForAgent(agentId) {
  if (agentId === 'needs-steve') return null;
  let h = 0;
  const id = String(agentId || '');
  for (let i = 0; i < id.length; i++) h = ((h << 5) - h + id.charCodeAt(i)) | 0;
  const spot = fw.idleSpots[Math.abs(h) % fw.idleSpots.length];
  return { x: fw.centerX + spot.x, z: fw.centerZ + spot.z, spotId: spot.id };
}

const halfW = fw.width / 2;
const halfD = fw.depth / 2;
fw.idleSpots.forEach(spot => {
  const wx = fw.centerX + spot.x;
  const wz = fw.centerZ + spot.z;
  if (Math.abs(wx - fw.centerX) > halfW || Math.abs(wz - fw.centerZ) > halfD) {
    console.error('idle spot outside funWing AABB:', spot.id, wx, wz);
    fail++;
  }
});

const a = idleSpotForAgent('le');
const b = idleSpotForAgent('product');
if (!a || !b) {
  console.error('idleSpotForAgent returned null for roster agents');
  fail++;
} else {
  if (a.x === b.x && a.z === b.z && a.spotId === b.spotId) {
    // Different ids may collide; only warn if every pair collides — check a third.
    const c = idleSpotForAgent('grok');
    const allSame = c && a.spotId === c.spotId && b.spotId === c.spotId;
    if (allSame) {
      console.error('idle spot hash collapsed all sample agents to one pad');
      fail++;
    }
  }
  [a, b].forEach(p => {
    if (Math.abs(p.x - fw.centerX) > halfW || Math.abs(p.z - fw.centerZ) > halfD) {
      console.error('resolved idle world pos outside funWing:', p);
      fail++;
    }
  });
}

if (idleSpotForAgent('needs-steve') !== null) {
  console.error('needs-steve must not get a Fun Station idle spot');
  fail++;
}

// Stable: same id always same spot
const again = idleSpotForAgent('le');
if (!a || !again || a.x !== again.x || a.z !== again.z) {
  console.error('idle spot assignment not stable for le');
  fail++;
}

// Smoke: moveAgent idle pad (no chair snap) then back to desk (chair settle).
const avatarSandbox = { window: {}, global: {}, THREE: null };
avatarSandbox.window = avatarSandbox;
avatarSandbox.global = avatarSandbox;
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'teva_avatars.js'), 'utf8'), vm.createContext(avatarSandbox));
avatarSandbox.TevaAssets = {
  resolveNavPoint: function () { return null; },
  resolveAgentPosition: function () { return { x: 12, z: -3, rotation: 0 }; }
};
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'teva_avatar_manager.js'), 'utf8'), avatarSandbox);
const mgr = new avatarSandbox.TevaAvatarManager.Manager(null);
mgr.addAgent({ id: 'le', status: 'idle' }, { x: 12, z: -3 });
const funDest = idleSpotForAgent('le');
if (!funDest || !mgr.moveAgent('le', { x: funDest.x, z: funDest.z }, { duration: 0.5 })) {
  console.error('moveAgent to Fun Station idle spot failed');
  fail++;
} else if (mgr.entries.le.movement && mgr.entries.le.movement.seatedTarget) {
  console.error('Fun Station dest should not trigger seatedTarget chair snap');
  fail++;
} else {
  mgr.update(0.6, Date.now());
  const atFun = Math.abs(mgr.entries.le.position.x - funDest.x) < 0.05
    && Math.abs(mgr.entries.le.position.z - funDest.z) < 0.05;
  if (!atFun) {
    console.error('agent did not arrive at Fun Station idle spot', mgr.entries.le.position, funDest);
    fail++;
  }
}
if (!mgr.moveAgent('le', { x: 12, z: -3 }, { duration: 0.25 })) {
  console.error('moveAgent back to desk failed');
  fail++;
} else if (!mgr.entries.le.movement || !mgr.entries.le.movement.seatedTarget) {
  console.error('desk return should use seatedTarget approach');
  fail++;
} else {
  mgr.update(0.3, Date.now());
  if (mgr.entries.le.position.z !== -3 || mgr.entries.le.motionState !== 'SITTING_DOWN') {
    console.error('desk return did not settle into chair', mgr.entries.le.position, mgr.entries.le.motionState);
    fail++;
  }
}

console.log(fail ? `FAIL ${fail}` : 'ok', 'fun idle spots', fw.idleSpots.length);
process.exit(fail ? 1 : 0);
