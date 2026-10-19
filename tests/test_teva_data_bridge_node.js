const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sandbox = { window: {}, global: {} };
sandbox.window = sandbox;
sandbox.global = sandbox;
sandbox.fetch = function () { return Promise.resolve({ ok: true, json: function () { return Promise.resolve({}); } }); };
sandbox.EventSource = function () { this.close = function () {}; this.addEventListener = function () {}; };
const ctx = vm.createContext(sandbox);

vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'teva_avatars.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'teva_avatar_manager.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'teva_activity.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'teva_data_bridge.js'), 'utf8'), ctx);

let fail = 0;
function check(cond, msg) { if (!cond) { console.error('FAIL:', msg); fail++; } }

check(typeof sandbox.TevaDataBridge === 'object', 'bridge exists');
check(typeof sandbox.TevaDataBridge.DataBridge === 'function', 'bridge class');
let observed = 0;
const bridge = new sandbox.TevaDataBridge.DataBridge(null, { positionResolver: function (a) { return { x: a.id.length, z: 2 }; }, onAgent: function () { observed++; } });
check(bridge.setQuality('off') === 'off', 'bridge quality control');
bridge.reconcile([{ id: 'alpha', status: 'working' }, { id: 'beta' }]);
check(Object.keys(bridge.manager.entries).length === 2, 'reconcile adds agents');
check(bridge.manager.entries.alpha.position.x === 5, 'position resolver');
check(observed === 2, 'agent callback');
bridge.reconcile([{ id: 'alpha', status: 'idle' }]);
check(Object.keys(bridge.manager.entries).length === 1, 'reconcile removes missing agents');
console.log(fail ? `FAIL ${fail}` : 'ok');
process.exit(fail ? 1 : 0);
