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

check(A.STATES.length >= 8, 'states list');
check(A.stateFromActivity({ status: 'walking' }) === 'WALKING', 'walking status');
const agent = { id: 'le', color: '#EF4444', emoji: '🛠️', avatar: { model: '/assets/avatars/le/model.glb', animations: { working: 'Typing' } } };
const avatar = A.normalizeAvatar(agent);
check(avatar.model === '/assets/avatars/le/model.glb', 'model path');
check(A.hasModel(avatar), 'has model');
check(A.clipFor(avatar, 'WORKING') === 'Typing', 'clip');
check(A.normalizeAvatar({ avatar: { seated: { enabled: true, seatHeight: 0.7 } } }).seated.seatHeight === 0.7, 'seated config');
check(A.resolveClip([{ name: 'SeatedTyping' }], 'WORKING').name === 'SeatedTyping', 'automatic seated clip');
check(A.clipFor({ animations: { walking: 'Walking' } }, 'WALKING') === 'Walking', 'walking clip');
check(typeof A.buildGeneratedClips === 'function', 'generated rig clips');
const clipReport = A.inspectClips([{ name: 'SeatedTyping' }, { name: 'Walking' }, { name: 'Talking' }]);
check(clipReport.hasSeated && clipReport.hasWorking, 'clip report seated working');
check(clipReport.hasLocomotion && clipReport.hasConversation, 'clip report locomotion conversation');
check(A.clipFor(avatar, 'IDLE') === null, 'idle clip fallback');
check(A.stateFromActivity({ activity: { state: 'READING' } }) === 'RESEARCHING', 'activity mapping');
check(A.stateFromActivity({ activity: { state: 'MOUSE' } }) === 'MOUSE', 'mouse mapping');
check(A.stateFromActivity({ activity: { state: 'THINKING' } }) === 'THINKING', 'thinking mapping');
check(A.stateFromActivity({ activity: { state: 'STANDING_UP' } }) === 'STANDING_UP', 'standing transition mapping');
check(A.stateFromActivity({ status: 'working' }) === 'WORKING', 'status mapping');
check(A.stateFromActivity({}) === 'IDLE', 'idle default');

const fallback = A.normalizeAvatar({ id: 'x', color: '#fff' });
check(fallback.model === null, 'null model');
check(!A.hasModel(fallback), 'no model');
check(fallback.fallback.shape === 'capsule', 'fallback shape');

function FakeQuaternion(x, y, z, w) { this.x = x || 0; this.y = y || 0; this.z = z || 0; this.w = w == null ? 1 : w; }
FakeQuaternion.prototype.clone = function () { return new FakeQuaternion(this.x, this.y, this.z, this.w); };
FakeQuaternion.prototype.multiply = function () { return this; };
FakeQuaternion.prototype.setFromEuler = function () { return this; };
function FakeEuler(x, y, z) { this.x = x; this.y = y; this.z = z; }
function Track(name, times, values) { this.name = name; this.times = times; this.values = values; }
function Clip(name, duration, tracks) { this.name = name; this.duration = duration; this.tracks = tracks; }
sandbox.THREE = { Quaternion: FakeQuaternion, Euler: FakeEuler, QuaternionKeyframeTrack: Track, VectorKeyframeTrack: Track, AnimationClip: Clip };
const boneNames = ['pelvis', 'thigh_l', 'thigh_r', 'calf_l', 'calf_r', 'spine_01', 'spine_02', 'spine_03', 'upperarm_l', 'upperarm_r', 'lowerarm_l', 'lowerarm_r', 'neck_01', 'Head'];
const fakeBones = boneNames.map(name => ({ name, isBone: true, quaternion: new FakeQuaternion(), position: { x: 0, y: 1, z: 0 } }));
const fakeScene = { traverse(fn) { fakeBones.forEach(fn); } };
const generated = A.buildGeneratedClips(fakeScene, []);
check(generated.some(c => c.name === 'SeatedIdle'), 'generated seated idle clip');
check(generated.some(c => c.name === 'SeatedTyping'), 'generated seated typing clip');
check(generated.some(c => c.name === 'StandingUp'), 'generated standing transition clip');
check(generated.some(c => c.name === 'Walking'), 'generated walking clip');
check(generated.some(c => c.name === 'Talking'), 'generated talking clip');

console.log(fail ? `FAIL ${fail}` : 'ok');
process.exit(fail ? 1 : 0);
