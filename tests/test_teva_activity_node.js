const fs = require('fs');
const path = require('path');
const vm = require('vm');

const file = path.join(__dirname, '..', 'public', 'js', 'teva_activity.js');
const sandbox = { window: {}, global: {} };
sandbox.window = sandbox;
sandbox.global = sandbox;
vm.runInContext(fs.readFileSync(file, 'utf8'), vm.createContext(sandbox));
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

console.log(fail ? `FAIL ${fail}` : 'ok');
process.exit(fail ? 1 : 0);
