const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sandbox = { window: {}, global: {} };
sandbox.window = sandbox;
sandbox.global = sandbox;

// stubs for pure-logic test (no THREE)
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'teva_avatars.js'), 'utf8'), vm.createContext(sandbox));
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'teva_avatar_manager.js'), 'utf8'), sandbox);
const M = sandbox.TevaAvatarManager;
const A = sandbox.TevaAvatars;

let fail = 0;
function check(cond, msg) { if (!cond) { console.error('FAIL:', msg); fail++; } }

const mgr = new M.Manager(null);
check(mgr.scene === null, 'manager scene');
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
check(A.stateFromActivity({}) === 'IDLE', 'idle');

console.log(fail ? `FAIL ${fail}` : 'ok');
process.exit(fail ? 1 : 0);
