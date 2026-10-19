const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sandbox = { window: {}, global: {} };
sandbox.window = sandbox;
sandbox.global = sandbox;
sandbox.fetch = function () { return Promise.resolve({ ok: true, json: function () { return Promise.resolve({}); } }); };
sandbox.EventSource = function () { this.close = function () {}; };
const ctx = vm.createContext(sandbox);
for (const file of ['teva_avatars.js', 'teva_activity.js', 'teva_ui_helpers.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', file), 'utf8'), ctx);
}
const U = sandbox.TevaUIH;
let fail = 0;
function check(condition, message) { if (!condition) { console.error('FAIL:', message); fail++; } }
check(U.computeMode({ mode: 'demo' }, []) === 'demo', 'demo mode');
check(U.computeMode({ mode: 'json_file' }, [{ signal: true, source: 'cursor' }]) === 'real', 'real mode');
check(U.displayFor({ activity: { state: 'WORKING' }, source: 'cursor' }).state === 'WORKING', 'display state');
check(U.provenanceFor({ signal: false }) === 'Simulated', 'simulated provenance');
check(U.provenanceFor({ source: 'cursor' }) === 'Observed', 'observed provenance');
console.log(fail ? `FAIL ${fail}` : 'ok');
process.exit(fail ? 1 : 0);
