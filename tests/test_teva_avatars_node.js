const fs = require('fs');
const path = require('path');
const vm = require('vm');

const file = path.join(__dirname, '..', 'public', 'js', 'teva_avatars.js');
const sandbox = { window: {}, global: {} };
sandbox.window = sandbox;
sandbox.global = sandbox;
vm.runInContext(fs.readFileSync(file, 'utf8'), vm.createContext(sandbox));
const A = sandbox.TevaAvatars;

let fail = 0;
function check(cond, msg) { if (!cond) { console.error('FAIL:', msg); fail++; } }

check(A.STATES.length === 8, 'eight states');
const agent = { id: 'le', color: '#EF4444', emoji: '🛠️', avatar: { model: '/assets/avatars/le/model.glb', animations: { working: 'Typing' } } };
const avatar = A.normalizeAvatar(agent);
check(avatar.model === '/assets/avatars/le/model.glb', 'model path');
check(A.hasModel(avatar), 'has model');
check(A.clipFor(avatar, 'WORKING') === 'Typing', 'clip');
check(A.normalizeAvatar({ avatar: { seated: { enabled: true, seatHeight: 0.7 } } }).seated.seatHeight === 0.7, 'seated config');
check(A.resolveClip([{ name: 'SeatedTyping' }], 'WORKING').name === 'SeatedTyping', 'automatic seated clip');
check(A.clipFor(avatar, 'IDLE') === null, 'idle clip fallback');
check(A.stateFromActivity({ activity: { state: 'READING' } }) === 'RESEARCHING', 'activity mapping');
check(A.stateFromActivity({ status: 'working' }) === 'WORKING', 'status mapping');
check(A.stateFromActivity({}) === 'IDLE', 'idle default');

const fallback = A.normalizeAvatar({ id: 'x', color: '#fff' });
check(fallback.model === null, 'null model');
check(!A.hasModel(fallback), 'no model');
check(fallback.fallback.shape === 'capsule', 'fallback shape');

console.log(fail ? `FAIL ${fail}` : 'ok');
process.exit(fail ? 1 : 0);
