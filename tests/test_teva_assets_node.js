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
check(A.roleKey({ id: 'ba', role: 'Leadership' }) === 'supervision', 'leadership seat ids use supervision preset');
const enriched = A.enrichAgent({ id: 'coder', role: 'Dev', avatar: { fallback: { emoji: '💻' } } });
check(enriched.avatar.appearance && enriched.avatar.appearance.outfit === 'hoodie', 'dev preset appearance');
const assetEnriched = A.enrichAgent({ id: 'coder', role: 'Dev', avatar: { assetId: 'office-worker-glb' } });
check(assetEnriched.avatar.assetId === 'office-worker-glb', 'asset id preserved');
check(assetEnriched.avatar.model === '/assets/avatars/office-worker/model.glb', 'asset model resolved');
check(assetEnriched.avatar.animations && assetEnriched.avatar.animations.working === 'Typing', 'asset animations resolved');
check(A.findAssetsByType('workstation').some(a => a.id === 'cyberpunk-workstation-procedural'), 'workstation asset registry');
check(A.assetForWorkstation({}).id === 'cyberpunk-workstation-procedural', 'default workstation asset');
check(A.assetForRoom('innovation-lab-procedural').fallback === 'procedural-cyber-pod', 'room asset registry');
check(A.assetForRoom('innovation-lab-procedural').source.indexOf('quaternius.com') !== -1, 'room asset source');
let optionalModel = 'unset';
A.loadModelAsset('innovation-lab-procedural', function (model) { optionalModel = model; });
check(optionalModel === null, 'room asset falls back when model is not installed');
const pos = A.resolveAgentPosition({ id: 'le' });
check(Number.isFinite(pos.x) && Number.isFinite(pos.z), 'agent position');
check(pos.seatHeight === 0.62, 'seat height default');
check(Math.abs(pos.z - (-3.52)) < 0.001, 'agent sits forward of chair center');
check(A.resolveWorkstationOrigin({ id: 'le' }).style === 'gaming', 'le workstation style');
check(A.resolveNavPoint('meeting') && A.resolveNavPoint('meeting').x === 0, 'nav meeting');
const modelPath = path.join(__dirname, '..', 'public', 'assets', 'avatars', 'office-worker', 'model.glb');
const modelBytes = fs.readFileSync(modelPath);
check(modelBytes.slice(0, 4).toString() === 'glTF', 'bundled GLB header');
check(modelBytes.length > 700000, 'bundled GLB size');
check(fs.existsSync(path.join(__dirname, '..', 'public', 'assets', 'avatars', 'office-worker', 'QUATERNIUS-LICENSE.txt')), 'bundled asset license');

console.log(fail ? `FAIL ${fail}` : 'ok');
process.exit(fail ? 1 : 0);
