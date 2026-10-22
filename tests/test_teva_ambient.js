// Unit tests for public/js/teva_ambient.js (ambient mode scheduler). Run: node tests/test_teva_ambient.js
'use strict';
const assert = require('assert');
const path = require('path');
require(path.join(__dirname, '..', 'public', 'office_layout.js'));
const A = require(path.join(__dirname, '..', 'public', 'js', 'teva_ambient.js'));
const L = global.OFFICE_LAYOUT;

let n = 0;
function t(name, fn) { fn(); n++; console.log('ok', n, name); }
function lcg(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
function seat(id, base, x, z, over) { return Object.assign({ id, base, busy: false, x, z, restX: x, restZ: z }, over || {}); }
const T0 = 1792263000000;
function roster() {
  return [seat('le', 'IDLE', 39, 20), seat('ai-research', 'IDLE', 42, 21), seat('erp-research', 'IDLE', 51, 7), seat('product', 'IDLE', 53, 7),
    seat('grok', 'WAITING', 50, 15), seat('pm', 'OFFLINE', 26, -7), seat('sa', 'AT_DESK', 16.2, -3), seat('debugger', 'TYPING', 12, 0.5),
    seat('needs-steve', 'IDLE', -22, -20.5), seat('x-meet', 'MEETING', 0, -15.5)];
}
// Simulate: each walking seat "arrives" at every target instantly when asked.
function run(sched, list, seconds, onStep) {
  for (let s = 0; s <= seconds; s++) {
    const now = T0 + s * 1000;
    const out = sched.tick(now, list);
    if (onStep) onStep(now, out);
    list.forEach(x => { if (sched.moving(x.id) && (s % 3 === 0)) sched.arrived(x.id, now); });
  }
}

t('only IDLE / WAITING seats are eligible; never needs-steve, offline, working or meeting', () => {
  assert.ok(A.eligible('le', 'IDLE')); assert.ok(A.eligible('le', 'WAITING'));
  ['OFFLINE', 'AT_DESK', 'TYPING', 'READING', 'RUNNING', 'DELEGATING', 'THINKING', 'BLOCKED', 'MEETING', 'YOUR_TURN'].forEach(b => assert.ok(!A.eligible('le', b), b));
  assert.ok(!A.eligible('needs-steve', 'IDLE'));
});

t('destinations come from the real layout (coffee, lounge, Cyber Lounge, Fun Wing)', () => {
  const names = A.destinations(L).map(d => d.name);
  ['coffee', 'lounge', 'cyber', 'fun-snackStrip', 'fun-arcadeRow', 'fun-chillPit'].forEach(k => assert.ok(names.includes(k), k));
  const k = A.destinations(L).find(d => d.name === 'coffee');
  assert.deepStrictEqual([k.x, k.z], [L.anchors.kitchen.x, L.anchors.kitchen.z]);
});

t('route goes through the Fun Wing corridor, not the east wall', () => {
  const r = A.route(L, { x: 45, z: 20 }, { x: 8, z: 11.5 });
  assert.strictEqual(r.length, 3);
  assert.ok(Math.abs(r[0].z - L.funWing.centerZ) < 1e-9 && r[0].x > L.room.width / 2 && r[1].x < L.room.width / 2);
  assert.deepStrictEqual(r[2], { x: 8, z: 11.5 });
  assert.strictEqual(A.route(L, { x: 0, z: 0 }, { x: 8, z: 11.5 }).length, 1);
});

t('ineligible seats never get fidgets or walks over 10 minutes', () => {
  const s = new A.Scheduler({ layout: L, rand: lcg(7) });
  const bad = new Set(['pm', 'sa', 'debugger', 'needs-steve', 'x-meet']);
  run(s, roster(), 600, (now, out) => {
    out.fidgets.forEach(f => assert.ok(!bad.has(f.id), 'fidget on ' + f.id));
    out.started.forEach(w => { assert.ok(!bad.has(w.id), 'walk by ' + w.id); if (w.to) assert.ok(!bad.has(w.to), 'chat with ' + w.to); });
  });
});

t('walk cadence: one start per 20-40 s gap, never more than two walkers at once', () => {
  const s = new A.Scheduler({ layout: L, rand: lcg(42) });
  const starts = [];
  run(s, roster(), 900, (now, out) => {
    out.started.forEach(() => starts.push(now));
    assert.ok(s.walkers() <= 2, 'walkers ' + s.walkers());
  });
  assert.ok(starts.length >= 15, 'starts ' + starts.length);
  for (let i = 1; i < starts.length; i++) assert.ok(starts[i] - starts[i - 1] >= 20000, 'gap ' + (starts[i] - starts[i - 1]));
});

t('walkers cap holds even when nobody comes home', () => {
  const s = new A.Scheduler({ layout: L, rand: lcg(3) });
  const list = roster();
  for (let k = 0; k < 600; k++) s.tick(T0 + k * 1000, list); // never call arrived(): everyone stays out
  assert.strictEqual(s.walkers(), 2);
});

t('fidgets are jittered per seat (not in sync) and vary', () => {
  const s = new A.Scheduler({ layout: L, rand: lcg(11), walkGapMin: 1e9, walkGapMax: 1e9, firstWalkMin: 1e9, firstWalkMax: 1e9 });
  const firsts = {}, names = new Set();
  run(s, roster(), 120, (now, out) => out.fidgets.forEach(f => { names.add(f.name); if (!firsts[f.id]) firsts[f.id] = now; assert.ok(f.dur > 0); }));
  assert.ok(new Set(Object.values(firsts)).size >= Object.keys(firsts).length - 1, JSON.stringify(firsts)); // 1 s ticks may coincide once
  const due = Object.values(s.seats).map(x => x.nextFidget);
  assert.strictEqual(new Set(due).size, due.length, 'per-seat schedules differ');
  const scales = Object.values(s.seats).map(x => x.fidgetScale);
  assert.ok(Math.max(...scales) - Math.min(...scales) > 0.05, 'per-seat tempo differs');
  assert.ok(names.size >= 3, [...names].join(','));
});

t('trip lifecycle: out -> pause at the place -> back home', () => {
  const s = new A.Scheduler({ layout: L, rand: lcg(5), chatChance: 0, firstWalkMin: 0, firstWalkMax: 0 });
  const list = [seat('le', 'IDLE', 39, 20)];
  const out = s.tick(T0, list);
  assert.strictEqual(out.started.length, 1);
  assert.ok(s.moving('le'));
  let guard = 0;
  while (s.arrived('le', T0) === 'next' && guard++ < 10);
  assert.ok(!s.moving('le') && s.active('le'), 'lingering');
  assert.ok(s.facing('le') && 'x' in s.facing('le'));
  s.tick(T0 + 11000, list);
  assert.ok(s.moving('le'), 'heading back');
  const home = s.seats.le.act.path[s.seats.le.act.path.length - 1];
  assert.deepStrictEqual(home, { x: 39, z: 20 });
  guard = 0;
  let r; while ((r = s.arrived('le', T0 + 12000)) === 'next' && guard++ < 10);
  assert.strictEqual(r, 'home');
  assert.ok(!s.active('le'));
});

t('chat: visitor walks over, both face each other, host stays put', () => {
  const s = new A.Scheduler({ layout: L, rand: lcg(9), chatChance: 1, firstWalkMin: 0, firstWalkMax: 0 });
  const list = [seat('le', 'IDLE', 39, 20), seat('grok', 'IDLE', 42, 21)];
  const out = s.tick(T0, list);
  assert.strictEqual(out.started[0].kind, 'visit');
  const v = out.started[0].id, h = out.started[0].to;
  assert.strictEqual(s.target(h), null, 'host does not walk');
  assert.strictEqual(s.walkers(), 1);
  while (s.arrived(v, T0) === 'next');
  assert.ok(s.talking(v) && s.talking(h));
  assert.deepStrictEqual(s.facing(v), { seat: h });
  assert.deepStrictEqual(s.facing(h), { seat: v });
  const spot = s.target(v), hr = list.find(x => x.id === h);
  assert.ok(Math.abs(Math.hypot(spot.x - hr.restX, spot.z - hr.restZ) - 1.1) < 1e-6);
});

t('a real event cancels at once; a cancelled host sends the visitor home', () => {
  const s = new A.Scheduler({ layout: L, rand: lcg(9), chatChance: 1, firstWalkMin: 0, firstWalkMax: 0 });
  const list = [seat('le', 'IDLE', 39, 20), seat('grok', 'IDLE', 42, 21)];
  const o = s.tick(T0, list).started[0];
  assert.ok(s.cancel(o.to, T0 + 10));
  assert.ok(!s.active(o.to));
  assert.ok(s.moving(o.id) && s.seats[o.id].act.phase === 'back');
  assert.ok(s.cancel(o.id, T0 + 20));
  assert.ok(!s.active(o.id));
  assert.strictEqual(s.cancel(o.id, T0 + 30), false);
});

t('a seat that leaves IDLE (or gets a real overlay) is cancelled on the next tick', () => {
  const s = new A.Scheduler({ layout: L, rand: lcg(5), chatChance: 0, firstWalkMin: 0, firstWalkMax: 0 });
  const list = [seat('le', 'IDLE', 39, 20)];
  s.tick(T0, list);
  assert.ok(s.active('le'));
  list[0].base = 'TYPING';
  const out = s.tick(T0 + 1000, list);
  assert.deepStrictEqual(out.cancelled, ['le']);
  assert.ok(!s.active('le'));
  list[0].base = 'IDLE'; list[0].busy = true;
  assert.strictEqual(s.tick(T0 + 2000, list).fidgets.length, 0);
});

t('reset clears every action', () => {
  const s = new A.Scheduler({ layout: L, rand: lcg(5), firstWalkMin: 0, firstWalkMax: 0 });
  s.tick(T0, roster());
  assert.ok(s.walkers() >= 1);
  s.reset();
  assert.strictEqual(s.walkers(), 0);
});

console.log(`TESTS PASSED (${n})`);
