const fs = require('fs');
const path = require('path');
const vm = require('vm');

const layoutPath = path.join(__dirname, '..', 'public', 'office_layout.js');
const file = path.join(__dirname, '..', 'public', 'js', 'teva_camera.js');
const sandbox = { window: {}, global: {} };
sandbox.window = sandbox;
sandbox.global = sandbox;
vm.runInContext(fs.readFileSync(layoutPath, 'utf8'), vm.createContext(sandbox));
vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox);
const C = sandbox.TevaCam;

let fail = 0;
function check(cond, msg) { if (!cond) { console.error('FAIL:', msg); fail++; } }

check(typeof C.lerp === 'function', 'lerp');
check(typeof C.easeInOutCubic === 'function', 'ease');
check(Math.abs(C.lerp(0, 10, 0.5) - 5) < 1e-6, 'lerp mid');
check(C.easeInOutCubic(0) === 0, 'ease 0');
check(Math.abs(C.easeInOutCubic(1) - 1) < 1e-6, 'ease 1');
check(C.overviewPreset().mode === 'overview', 'overview preset');
check(C.departmentPreset('Engineering').mode === 'department', 'department preset');
check(C.workstationPreset({ x: 1, z: 2 }).mode === 'workstation', 'workstation preset');
check(C.workstationPreset({ x: 1, z: 2 }).zoom <= 0.3, 'workstation close zoom');

console.log(fail ? `FAIL ${fail}` : 'ok');
process.exit(fail ? 1 : 0);
