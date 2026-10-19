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
console.log(fail ? `FAIL ${fail}` : 'ok');
process.exit(fail ? 1 : 0);
