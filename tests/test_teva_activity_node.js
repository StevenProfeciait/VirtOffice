const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sandbox = { window: {}, global: {} };
sandbox.window = sandbox;
sandbox.global = sandbox;
sandbox.fetch = function () { return Promise.resolve({ ok: true, json: function () { return Promise.resolve({}); } }); };
sandbox.EventSource = function () { this.close = function () {}; };
const ctx = vm.createContext(sandbox);

const av = path.join(__dirname, '..', 'public', 'js', 'teva_avatars.js');
const act = path.join(__dirname, '..', 'public', 'js', 'teva_activity.js');
vm.runInContext(fs.readFileSync(av, 'utf8'), ctx);
vm.runInContext(fs.readFileSync(act, 'utf8'), ctx);
const A = sandbox.TevaActivity;

let fail = 0;
function check(cond, msg) { if (!cond) { console.error('FAIL:', msg); fail++; } }

check(A.isDemo({ mode: 'demo' }, []) === true, 'demo config');
check(A.isDemo({ mode: 'json_file' }, [{ source: null, signal: false }]) === true, 'demo agents');
check(A.isDemo({ mode: 'json_file' }, [{ source: 'cursor', signal: true }]) === false, 'real agents');
check(A.provenanceLabel({ provenance: 'observed' }) === 'Observed', 'observed');
check(A.provenanceLabel({ provenance: 'user' }) === 'Manual', 'manual');
check(A.provenanceLabel({ source: 'cursor' }) === 'Reported', 'reported');
check(A.provenanceLabel({}) === 'Unknown', 'unknown');
check(A.safeState({ activity: { state: 'WORKING' } }) === 'WORKING', 'state');
check(A.safeState({ status: 'idle' }) === 'idle', 'status');
check(A.safeState({}) === 'awaiting status', 'awaiting');
check(A.computeDisplay({ activity: { state: 'WORKING', task: 'T1' } }).state === 'WORKING', 'compute');

console.log(fail ? `FAIL ${fail}` : 'ok');
process.exit(fail ? 1 : 0);
