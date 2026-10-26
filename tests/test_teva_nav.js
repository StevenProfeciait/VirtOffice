// Unit tests for public/js/teva_nav.js (walking routes around furniture, 2026-10-22 part 2) + office.html wiring.
// Run: node tests/test_teva_nav.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
require(path.join(__dirname, '..', 'public', 'office_layout.js'));
const T = require(path.join(__dirname, '..', 'public', 'js', 'teva_nav.js'));
const L = global.OFFICE_LAYOUT;
const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'office.html'), 'utf8');
let n = 0;
function t(name, fn) { fn(); n++; console.log('ok', n, name); }
const classicDesks = Object.entries(L.seats).filter(([id]) => !['supervisor', 'pm', 'ba'].includes(id)).map(([id, p]) => ({ x: p.x, z: p.z - 0.9, w: 2.5, d: 1.15, rot: 0, tag: 'desk ' + id }));
const nav = new T.Nav(L, { desks: classicDesks });
const fw = L.funWing;
function inside(o, p, pad) { const c = Math.cos(-o.rot), s = Math.sin(-o.rot), lx = (p.x - o.x) * c - (p.z - o.z) * s, lz = (p.x - o.x) * s + (p.z - o.z) * c; return Math.abs(lx) < o.w / 2 + pad && Math.abs(lz) < o.d / 2 + pad; }
// sample a route; skip the first / last metre (a chair tucked under a desk is allowed as a start / goal)
function crossings(from, pts) {
  const hits = new Set(), all = [from].concat(pts), total = T.length(from, pts);
  let run = 0;
  for (let i = 0; i < all.length - 1; i++) {
    const a = all[i], b = all[i + 1], len = Math.hypot(b.x - a.x, b.z - a.z), k = Math.max(1, Math.ceil(len / 0.1));
    for (let j = 0; j <= k; j++) {
      const d = run + len * j / k; if (d < 1.0 || d > total - 1.0) continue;
      const p = { x: a.x + (b.x - a.x) * j / k, z: a.z + (b.z - a.z) * j / k };
      nav.furniture.forEach(o => { if (inside(o, p, 0.05)) hits.add(o.tag); });
    }
    run += len;
  }
  return [...hits];
}

t('the real furniture is solid: boardroom table, desks, arcade cabinets, ping pong, kitchen counter', () => {
  const b = L.meetingSpaces.boardroom;
  assert.ok(nav.blockedAt({ x: b.x, z: b.z }), 'boardroom table');
  assert.ok(nav.blockedAt({ x: classicDesks[0].x, z: classicDesks[0].z }), 'a desk');
  assert.ok(nav.blockedAt({ x: fw.centerX + fw.pingPong.x, z: fw.centerZ + fw.pingPong.z }), 'ping pong table');
  assert.ok(nav.blockedAt({ x: fw.centerX + fw.arcadeRow.x, z: fw.centerZ + fw.arcadeRow.z }), 'arcade cabinet');
  assert.ok(nav.blockedAt(L.anchors.kitchen), 'kitchen counter');
  assert.ok(!nav.blockedAt({ x: 2, z: 10 }), 'open floor is walkable');
});

t('walls are solid except the real openings (Fun Wing corridor, terrace doorway)', () => {
  const hw = L.room.width / 2, hd = L.room.depth / 2;
  assert.ok(nav.blockedAt({ x: hw, z: fw.centerZ + 6 }), 'Fun Wing wall');
  assert.ok(!nav.blockedAt({ x: hw, z: fw.centerZ }), 'Fun Wing opening');
  assert.ok(!nav.blockedAt({ x: hw, z: fw.centerZ + 2.5 }), 'Fun Wing opening (widened ±3 m)');
  assert.ok(nav.blockedAt({ x: -10, z: hd }), 'terrace wall');
  assert.ok(!nav.blockedAt({ x: 2.5, z: hd }), 'terrace doorway (the coffee cart stands in its middle)');
});

t('cyber pods, Fun Wing glass and glass dividers are solid', () => {
  const sim = L.anchors.simulationBay, inn = L.anchors.innovationLab;
  assert.ok(nav.blockedAt({ x: sim.x, z: sim.z }), 'Simulation Bay pod centre');
  assert.ok(nav.blockedAt({ x: inn.x, z: inn.z }), 'Innovation Lab pod centre');
  assert.ok(nav.blockedAt({ x: fw.centerX, z: fw.centerZ + fw.depth / 2 - 0.4 }), 'Fun Wing N glass');
  assert.ok(nav.blockedAt({ x: L.dividers[0].x, z: L.dividers[0].z }), 'glass divider');
  assert.ok(nav.blockedAt({ x: L.room.width / 2 - 4, z: -L.room.depth / 2 + 12 }), 'phone booth');
});

t('desk -> Fun Wing pad: goes through the opening and never through a desk, table, arcade or cyber pod', () => {
  const pad = { x: fw.centerX + fw.idleSpots[0].x, z: fw.centerZ + fw.idleSpots[0].z };
  const sim = L.anchors.simulationBay, inn = L.anchors.innovationLab;
  function inPod(p, c, w, d) { return Math.abs(p.x - c.x) < w / 2 && Math.abs(p.z - c.z) < d / 2; }
  Object.entries(L.seats).forEach(([id, seat]) => {
    const r = nav.path(seat, pad);
    assert.ok(r && r.length, 'route for ' + id);
    const last = r[r.length - 1]; assert.ok(Math.hypot(last.x - pad.x, last.z - pad.z) < 1e-6, 'ends at the pad');
    assert.deepStrictEqual(crossings(seat, r), [], id + ' walks through furniture');
    const hw = L.room.width / 2;
    const all = [seat].concat(r);
    for (let i = 0; i < all.length - 1; i++) {
      const a = all[i], b = all[i + 1];
      if ((a.x - hw) * (b.x - hw) < 0) {
        const z = a.z + (b.z - a.z) * (hw - a.x) / (b.x - a.x);
        assert.ok(Math.abs(z - fw.centerZ) < T.FUN_OPEN + 0.1, id + ' crosses the wall at z=' + z.toFixed(1));
      }
      const len = Math.hypot(b.x - a.x, b.z - a.z), k = Math.max(1, Math.ceil(len / 0.2));
      for (let j = 1; j < k; j++) {
        const p = { x: a.x + (b.x - a.x) * j / k, z: a.z + (b.z - a.z) * j / k };
        assert.ok(!inPod(p, sim, 14, 9), id + ' walks under Simulation Bay');
        assert.ok(!inPod(p, inn, 12, 8), id + ' walks under Innovation Lab');
      }
    }
  });
});

t('the old straight line would have gone through furniture; the route does not', () => {
  const a = { x: L.meetingSpaces.boardroom.x - 3, z: L.meetingSpaces.boardroom.z }, b = { x: L.meetingSpaces.boardroom.x + 3, z: L.meetingSpaces.boardroom.z };
  assert.ok(crossings(a, [b]).includes('boardroom table'), 'straight line crosses the table');
  const r = nav.path(a, b);
  assert.deepStrictEqual(crossings(a, r), []);
  assert.ok(r.length >= 2, 'goes around the end of the table');
});

t('random routes across the office never pass through furniture and are reasonably short', () => {
  let s = 9; const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  let tested = 0;
  for (let i = 0; i < 60; i++) {
    const a = { x: -34 + rnd() * 68, z: -25 + rnd() * 50 }, b = { x: -34 + rnd() * 68, z: -25 + rnd() * 50 };
    if (nav.blockedAt(a) || nav.blockedAt(b)) continue;
    const r = nav.path(a, b); if (!r) continue;
    tested++;
    assert.deepStrictEqual(crossings(a, r), [], 'route ' + i);
    assert.ok(T.length(a, r) < Math.hypot(b.x - a.x, b.z - a.z) * 2.2 + 4, 'no wild detours');
  }
  assert.ok(tested > 30, 'tested ' + tested);
});

t('office.html wiring: Classic walkers follow navRoute waypoints; Cyberpunk moves and ambient legs use it too', () => {
  assert.ok(html.indexOf('js/teva_nav.js') > 0);
  // nav recovery (2026-10-23): Classic / Cyberpunk moves go through the guarded plan (navPlan -> RouteGuard)
  assert.ok(/a\.route = classicRoute\(a, state, key, dist\)/.test(html), 'Classic route');
  assert.ok(/navPlan\(agent\.id, \{ x: Number\(e\.position\.x\)/.test(html), 'Cyberpunk route');
  assert.ok(/navChain\(\{ x: Number\(entry\.position\.x\)/.test(html), 'ambient legs');
  assert.ok(/WALKNAV = new TevaNav\.Nav\(LAYOUT, \{ desks, look \}\)/.test(html), 'desks of the active look');
});

console.log('TESTS PASSED (' + n + ')');
