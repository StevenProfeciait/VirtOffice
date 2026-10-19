const fs = require('fs');
const path = require('path');
const vm = require('vm');

const file = path.join(__dirname, '..', 'public', 'js', 'teva_camera.js');
const sandbox = { window: {}, global: {} };
sandbox.window = sandbox;
sandbox.global = sandbox;
vm.runInContext(fs.readFileSync(file, 'utf8'), vm.createContext(sandbox));
const C = sandbox.TevaCam;

let fail = 0;
function check(cond, msg) { if (!cond) { console.error('FAIL:', msg); fail++; } }

check(typeof C.lerp === 'function', 'lerp');
check(typeof C.easeInOutCubic === 'function', 'ease');
check(Math.abs(C.lerp(0, 10, 0.5) - 5) < 1e-6, 'lerp mid');
check(C.easeInOutCubic(0) === 0, 'ease 0');
check(Math.abs(C.easeInOutCubic(1) - 1) < 1e-6, 'ease 1');

console.log(fail ? `FAIL ${fail}` : 'ok');
process.exit(fail ? 1 : 0);
