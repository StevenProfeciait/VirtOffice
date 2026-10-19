const fs = require('fs');
const path = require('path');
const vm = require('vm');

const layoutPath = path.join(__dirname, '..', 'public', 'office_layout.js');
const assetsPath = path.join(__dirname, '..', 'public', 'js', 'teva_assets.js');
const sandbox = { window: {}, global: {} };
sandbox.window = sandbox;
sandbox.global = sandbox;
vm.runInContext(fs.readFileSync(layoutPath, 'utf8'), vm.createContext(sandbox));
vm.runInContext(fs.readFileSync(assetsPath, 'utf8'), sandbox);
const A = sandbox.TevaAssets;

let fail = 0;
function check(cond, msg) { if (!cond) { console.error('FAIL:', msg); fail++; } }

A.setManifest(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'assets', 'asset-manifest.json'), 'utf8')));
check(A.getManifest().version === 2, 'manifest version');
check(A.roleKey({ role: 'Dev' }) === 'development', 'dev role');
const enriched = A.enrichAgent({ id: 'coder', role: 'Dev', avatar: { fallback: { emoji: '💻' } } });
check(enriched.avatar.appearance && enriched.avatar.appearance.outfit === 'hoodie', 'dev preset appearance');
const pos = A.resolveAgentPosition({ id: 'le' });
check(Number.isFinite(pos.x) && Number.isFinite(pos.z), 'agent position');
check(pos.seatHeight === 0.62, 'seat height default');
check(A.resolveWorkstationOrigin({ id: 'le' }).style === 'gaming', 'le workstation style');
check(A.resolveNavPoint('meeting') && A.resolveNavPoint('meeting').x === 0, 'nav meeting');

console.log(fail ? `FAIL ${fail}` : 'ok');
process.exit(fail ? 1 : 0);
