const fs = require('fs');
const path = require('path');
const vm = require('vm');
const sandbox = { window: {}, global: {} };
sandbox.window = sandbox;
sandbox.global = sandbox;
const ctx = vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'teva_animation.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'teva_ui.js'), 'utf8'), ctx);
let fail = 0;
function check(condition, message) { if (!condition) { console.error('FAIL:', message); fail++; } }
check(sandbox.TevaAnim.candidates('WORKING')[0] === 'seated_typing', 'working aliases');
check(sandbox.TevaUI.statusText({ activity: { state: 'WAITING' } }) === 'WAITING', 'status text');
console.log(fail ? `FAIL ${fail}` : 'ok');
process.exit(fail ? 1 : 0);
