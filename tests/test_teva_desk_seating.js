// Typing fix (2026-10-23): every seated worker sits ON its own chair, in front of its own desk, facing its
// monitors, hands over the keyboard, nothing inside the desk -- in both looks, for every desk.
// Cyberpunk: the real TevaEnv.buildWorkstation meshes + TevaAssets.resolveAgentPosition + the real capsule
// (TevaAvatars.makeFallback) posed by TevaAvatarManager.proceduralPose, all with the bundled three.js.
// Classic: createDesk / createChair / registerMonitor / DESK_FACE taken from office.html and run the same way.
// Run: node tests/test_teva_desk_seating.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..', 'public');
const sb = {}; sb.window = sb; sb.self = sb; sb.global = sb; sb.console = console; vm.createContext(sb);
const run = f => vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), sb, { filename: f });
run('vendor/three.min.js'); run('office_layout.js'); run('js/teva_assets.js'); run('js/teva_environment.js');
run('js/teva_avatars.js'); run('js/teva_avatar_manager.js');
const T = sb.THREE, L = sb.LAYOUT || sb.OFFICE_LAYOUT, A = sb.TevaAssets;
A.setManifest(JSON.parse(fs.readFileSync(path.join(root, 'assets', 'asset-manifest.json'), 'utf8')));
let n = 0;
function t(name, fn) { fn(); n++; console.log('ok', n, name); }
const W = o => { o.updateMatrixWorld(true); return o.getWorldPosition(new T.Vector3()); };
const box = o => { o.updateMatrixWorld(true); return new T.Box3().setFromObject(o); };
const find = (g, pred) => { let r = null; g.traverse(c => { if (!r && pred(c)) r = c; }); return r; };
const findAll = (g, pred) => { const r = []; g.traverse(c => { if (pred(c)) r.push(c); }); return r; };
const seats = Object.keys(L.seats || {});
assert.ok(seats.length >= 10, 'layout seats');

t('Cyberpunk, every desk: seat on the chair side, on the chair, facing the monitors; torso clear of the desk; hands over the keyboard', () => {
  seats.forEach(id => {
    const agent = { id };
    const ws = A.resolveWorkstationOrigin(agent), pos = A.resolveAgentPosition(agent), c = ws.config || {};
    const g = sb.TevaEnv.buildWorkstation({ x: ws.x, z: ws.z, rotation: ws.rotation || 0, style: ws.style || 'standard', deskW: c.deskW, deskD: c.deskD, agentId: id });
    g.updateMatrixWorld(true);
    const desk = find(g, o => o.userData && o.userData.deskTop), kb = find(g, o => o.userData && o.userData.keyboard), chair = find(g, o => o.userData && o.userData.chair);
    const screens = findAll(g, o => o.userData && o.userData.monitorScreen);
    assert.ok(desk && kb && chair && screens.length, id + ': workstation parts');
    const seat = new T.Vector3(pos.x, 0, pos.z), deskC = W(desk), chairP = W(chair), kbP = W(kb);
    const mon = screens.reduce((s, o) => s.add(W(o)), new T.Vector3()).multiplyScalar(1 / screens.length);
    const face = new T.Vector3(Math.sin(pos.rotation), 0, Math.cos(pos.rotation)); // avatars face +z in their own space
    const toMon = new T.Vector3(mon.x - seat.x, 0, mon.z - seat.z).normalize();
    assert.ok(face.dot(toMon) > 0.95, id + ': seated yaw faces the monitors (' + face.dot(toMon).toFixed(2) + ')');
    const toDesk = new T.Vector3(deskC.x - seat.x, 0, deskC.z - seat.z), toChair = new T.Vector3(chairP.x - seat.x, 0, chairP.z - seat.z);
    assert.ok(toChair.length() < 0.25, id + ': sits on the chair (' + toChair.length().toFixed(2) + ' m from its centre)');
    assert.ok(toDesk.dot(face) > 0, id + ': the desk is in front of the seat');
    // chair side: the seat and the chair are on the same side of the desk as the keyboard, the monitors beyond it
    const along = p => new T.Vector3(p.x - deskC.x, 0, p.z - deskC.z).dot(face);
    assert.ok(along(seat) < 0 && along(chairP) < 0 && along(kbP) < 0 && along(mon) > along(kbP), id + ': seat / chair / keyboard on the chair side, monitors behind the keyboard');
    // the real capsule, posed typing, placed like applyToScene places it
    const av = sb.TevaAvatars.makeFallback({ fallback: { color: '#10b981' } }, T);
    av.position.set(pos.x, 0, pos.z); av.rotation.y = pos.rotation;
    sb.TevaAvatarManager.proceduralPose(av, 'WORKING', 1.3, 0, {});
    av.updateMatrixWorld(true);
    const P = av.userData.parts, deskBox = box(desk);
    const torso = av.children.find(o => o.geometry && o.geometry.type === 'BoxGeometry');
    assert.ok(!box(torso).intersectsBox(deskBox), id + ': torso clear of the desk');
    [P.leftThigh, P.rightThigh].forEach(th => assert.ok(box(th).max.y < deskBox.min.y, id + ': knees under the desk top, not through it'));
    [P.leftFore, P.rightFore].forEach(f => {
      const hand = W(f.children.find(o => o.geometry && o.geometry.type === 'SphereGeometry'));
      assert.ok(hand.y > deskBox.max.y - 0.02 && hand.y < deskBox.max.y + 0.2, id + ': hand at keyboard height (' + hand.y.toFixed(2) + ')');
      assert.ok(Math.abs(along(hand) - along(kbP)) < 0.2, id + ': hand over the keyboard (' + (along(hand) - along(kbP)).toFixed(2) + ')');
    });
  });
});

t('Classic, every desk: chair at the seat, desk / keyboard / screen in front, seat faces the screen, screen faces the seat, hands over the keyboard', () => {
  const html = fs.readFileSync(path.join(root, 'office.html'), 'utf8');
  const fnSrc = name => { const i = html.indexOf('function ' + name + '('); assert.ok(i > 0, name); let d = 0, j = html.indexOf('{', i); for (let k = j; k < html.length; k++) { if (html[k] === '{') d++; else if (html[k] === '}' && --d === 0) return html.slice(i, k + 1); } };
  const angle = Number(eval((/createDesk\(p\.x, p\.z - 0\.9, ([^,]+), id\)/.exec(html) || [])[1].replace('Math.PI', String(Math.PI))));
  const DESK_FACE = eval((/const DESK_FACE = ([^;]+);/.exec(html) || [])[1].replace('Math.PI', String(Math.PI)));
  const added = [], quads = [];
  const ctx = { THREE: T, rAdd: o => added.push(o), registerMonitor: null, AGENTS: [], clickableObjects: [], MON: { cells: {}, quads, cols: 4, rows: 5 } };
  vm.createContext(ctx);
  vm.runInContext(fnSrc('createChair') + '\n' + fnSrc('createDesk') + '\n' + fnSrc('registerMonitor') + '\nthis.createDesk = createDesk;', ctx);
  seats.filter(id => !['supervisor', 'pm', 'ba'].includes(id)).forEach(id => {
    const p = L.seats[id]; added.length = 0;
    ctx.createDesk(p.x, p.z - 0.9, angle, id);
    const desk = added.find(o => o.userData.deskOf === id) || added[0], chair = added.find(o => o.userData.tevaMeetingChair);
    assert.ok(desk && chair, id + ': desk + chair');
    desk.updateMatrixWorld(true);
    const seat = new T.Vector3(p.x, 0, p.z), face = new T.Vector3(Math.sin(DESK_FACE), 0, Math.cos(DESK_FACE));
    const kb = desk.children.find(o => o.geometry && o.geometry.parameters && o.geometry.parameters.width === 0.5 && o.geometry.parameters.depth === 0.16);
    const top = desk.children.find(o => o.geometry && o.geometry.parameters && o.geometry.parameters.width === 2.5);
    const chairP = W(chair), kbP = W(kb), deskC = W(desk), topBox = box(top);
    assert.ok(new T.Vector3(chairP.x - seat.x, 0, chairP.z - seat.z).length() < 0.15, id + ': the chair is where the seat sits');
    // chair backrest behind the sitter (away from the desk)
    const back = chair.children.find(o => o.geometry && o.geometry.parameters && o.geometry.parameters.height === 0.62);
    assert.ok(new T.Vector3().subVectors(W(back), chairP).dot(face) < 0, id + ': backrest behind the sitter');
    const ahead = q => new T.Vector3(q.x - seat.x, 0, q.z - seat.z).dot(face);
    const q = quads.find(x => x.seat === id); assert.ok(q, id + ': monitor quad');
    const qp = new T.Vector3().setFromMatrixPosition(q.matrix), qn = new T.Vector3(0, 0, 1).transformDirection(q.matrix);
    assert.ok(ahead(deskC) > 0.5 && ahead(kbP) > 0.3 && ahead(kbP) < 0.6 && ahead(qp) > ahead(kbP), id + ': desk, keyboard, then the screen, in front of the seat');
    assert.ok(qn.dot(face) < -0.95, id + ': the screen faces the seat');
    // Classic typing pose (from the typing() helper) through the rig's arm chain: hands land on the keyboard
    const m = /lArmRx: (-?[\d.]+) \+ Math\.sin\(t \* speed\)[^]*?lLow: ([\d.]+) \+ Math\.sin/.exec(fnSrc('animateAgents'));
    const rx = Number(m[1]), low = Number(m[2]);
    const g = new T.Group(); g.position.set(p.x, -0.03, p.z); g.rotation.y = DESK_FACE;
    const arm = new T.Object3D(); arm.position.set(-0.26, 1.1, 0); arm.rotation.x = rx; g.add(arm);
    const flip = new T.Object3D(); flip.position.y = -0.26; flip.rotation.y = Math.PI; arm.add(flip);
    const lower = new T.Object3D(); lower.rotation.x = low; flip.add(lower);
    const hand = new T.Object3D(); hand.position.y = -0.26; lower.add(hand);
    const h = W(hand), elbow = W(flip);
    assert.ok(Math.abs(ahead(h) - ahead(kbP)) < 0.12, id + ': Classic hand over the keyboard (' + (ahead(h) - ahead(kbP)).toFixed(2) + ')');
    assert.ok(h.y > topBox.max.y - 0.01 && h.y < topBox.max.y + 0.12, id + ': Classic hand at keyboard height (' + h.y.toFixed(2) + ')');
    assert.ok(h.y > elbow.y - 0.02 && ahead(h) > ahead(elbow), id + ': forearm reaches forward from a bent elbow, not back');
  });
  assert.ok(/const atDesk = !walking && classicHasDesk/.test(html) && /let face = atDesk \? DESK_FACE : 0;/.test(html), 'Classic seats at their desk use DESK_FACE');
  assert.ok(/if \(atDesk\) Object\.assign\(P, \{ lLeg: -1\.5/.test(html), 'Classic seats sit on the chair at their desk');
});

console.log('TESTS PASSED (' + n + ')');
