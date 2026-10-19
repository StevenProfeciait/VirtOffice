const fs = require('fs');
const path = require('path');
const vm = require('vm');

function Obj() { this.children = []; this.position = { set: function () {} }; this.userData = {}; }
Obj.prototype.add = function (x) { this.children.push(x); };
Obj.prototype.traverse = function (fn) { fn(this); this.children.forEach(function (x) { if (x.traverse) x.traverse(fn); }); };
function Geo() {}
Geo.prototype.dispose = function () {};
function Mat() {}
Mat.prototype.dispose = function () {};
const sandbox = {
  window: {}, global: {},
  THREE: {
    Fog: function (c, n, f) { this.color = c; this.near = n; this.far = f; },
    Group: Obj, Mesh: function (g, m) { Obj.call(this); this.geometry = g; this.material = m; this.rotation = {}; },
    BoxGeometry: Geo, PlaneGeometry: Geo, MeshStandardMaterial: Mat
  },
  LAYOUT: { fog: { color: 1, near: 2, far: 3 }, room: { width: 10, depth: 8, wallHeight: 3 }, exterior: { groundSize: 20 } }
};
sandbox.window = sandbox;
sandbox.Mesh = sandbox.THREE.Mesh;
sandbox.window = sandbox;
sandbox.global = sandbox;
const ctx = vm.createContext(sandbox);

vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'teva_avatars.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'teva_scene.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'teva_environment.js'), 'utf8'), ctx);
let fail = 0;
function check(c, m) { if (!c) { console.error('FAIL', m); fail++; } }
check(sandbox.TevaScene.buildFog, 'buildFog');
check(sandbox.TevaScene.buildGround, 'buildGround');
check(sandbox.TevaScene.buildRoom().children.length === 5, 'buildRoom floor and four walls');
check(sandbox.TevaEnv.build().userData.tevaEnvironment === true, 'build environment');
check(typeof sandbox.TevaEnv.buildWorkstation === 'function', 'workstation builder');
console.log(fail ? 'FAIL '+fail : 'ok');
process.exit(fail ? 1 : 0);
