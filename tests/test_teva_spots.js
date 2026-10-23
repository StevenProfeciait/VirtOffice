// Unit tests for public/js/teva_spots.js (seat / spot reservations, 2026-10-22 seat fix) and its use by
// teva_ambient.js, teva_zones.js and office.html. Run: node tests/test_teva_spots.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
require(path.join(__dirname, '..', 'public', 'office_layout.js'));
const S = require(path.join(__dirname, '..', 'public', 'js', 'teva_spots.js'));
const Z = require(path.join(__dirname, '..', 'public', 'js', 'teva_zones.js'));
const A = require(path.join(__dirname, '..', 'public', 'js', 'teva_ambient.js'));
const L = global.OFFICE_LAYOUT;
const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'office.html'), 'utf8');

let n = 0;
function t(name, fn) { fn(); n++; console.log('ok', n, name); }
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const IDS = ['supervisor', 'pm', 'ba', 'le', 'le2', 'sa', 'debugger', 'research-mgr', 'ai-research', 'erp-research', 'product', 'competitor', 'ui-docs', 'grok'];
const desks = Object.values(L.seats);
function registry() {
  return new S.Registry(S.catalog(L, { boardroom: Z.boardroomSlots(L), research: Z.researchSlots(L), blocked: desks }), { blocked: desks });
}
function noOverlap(R, label) {
  const c = R.conflicts();
  assert.deepStrictEqual(c, [], (label || '') + ' ' + c.join('; '));
  const pos = R.positions();
  for (let i = 0; i < pos.length; i++) for (let j = i + 1; j < pos.length; j++) {
    if (pos[i].holder === pos[j].holder) continue;
    assert.ok(S.dist(pos[i], pos[j]) >= S.MIN_GAP - 1e-6, `${label}: ${pos[i].holder} and ${pos[j].holder} at ${S.dist(pos[i], pos[j]).toFixed(2)} m`);
  }
}

t('the old hash really collided: 14 seats into 6 Fun Wing pads put several seats on one pad', () => {
  const pads = L.funWing.idleSpots.length, use = {};
  IDS.forEach(id => { let h = 0; for (let i = 0; i < id.length; i++) h = ((h << 5) - h + id.charCodeAt(i)) | 0; const k = Math.abs(h) % pads; use[k] = (use[k] || 0) + 1; });
  assert.ok(Object.values(use).some(v => v >= 3), 'at least one pad had 3 seats');
});

t('catalog: real places from the floor plan, every spot at least MIN_GAP from every other spot and from desk chairs', () => {
  const c = S.catalog(L, { boardroom: Z.boardroomSlots(L), research: Z.researchSlots(L), blocked: desks });
  const places = new Set(c.map(s => s.place));
  ['fun-chillPit', 'fun-arcadeRow', 'fun-pingPong', 'fun-foosball', 'fun-snackStrip', 'coffee', 'lounge', 'cyber', 'wing-lounge', 'wing-huddle', 'wing-coffee', 'boardroom', 'research'].forEach(p => assert.ok(places.has(p), p));
  for (let i = 0; i < c.length; i++) {
    for (let j = i + 1; j < c.length; j++) assert.ok(S.dist(c[i], c[j]) >= S.MIN_GAP, c[i].id + ' vs ' + c[j].id);
    desks.forEach(d => assert.ok(S.dist(c[i], d) >= S.MIN_GAP, c[i].id + ' on a desk'));
  }
  assert.ok(c.filter(s => s.groups.includes('idle')).length >= IDS.length, 'enough idle places for every seat');
  assert.ok(c.filter(s => s.place === 'boardroom').every(s => s.sit && s.activity === 'meet'));
  assert.ok(c.filter(s => s.place === 'research').every(s => s.activity === 'read'));
});

t('one holder per spot; a taken target gives the nearest free spot; release frees it', () => {
  const R = registry(), pad = S.preferredPad(R, 'le');
  const a = R.claim('le', 'home', { groups: ['idle'], prefer: pad.id, near: pad });
  assert.strictEqual(a.id, pad.id);
  const b = R.claim('product', 'home', { groups: ['idle'], prefer: pad.id, near: pad });
  assert.notStrictEqual(b.id, pad.id, 'product does not sit on le');
  assert.ok(S.dist(a, b) >= S.MIN_GAP);
  const nearest = R.spots.filter(s => s.groups.includes('idle') && s.id !== pad.id && s.rank === 0).sort((x, y) => S.dist(x, pad) - S.dist(y, pad))[0];
  assert.strictEqual(b.id, nearest.id, 'nearest free pad');
  assert.strictEqual(R.holder(pad.id), 'le');
  R.release('le', 'home');
  assert.strictEqual(R.holder(pad.id), null);
  assert.strictEqual(R.claim('pm', 'home', { groups: ['idle'], prefer: pad.id }).id, pad.id, 'freed spot can be used again');
  noOverlap(R, 'basic');
});

t('all 14 seats idle at once: 14 different places, Fun Wing pads first, then the play stations and the rest', () => {
  const R = registry(), got = {};
  IDS.forEach(id => { const p = S.preferredPad(R, id); got[id] = R.claim(id, 'home', { groups: ['idle'], prefer: p.id, near: p }); });
  const ids = Object.values(got).map(s => s.id);
  assert.strictEqual(new Set(ids).size, IDS.length);
  const pads = R.spots.filter(s => s.rank === 0 && s.groups.includes('idle'));
  pads.forEach(p => assert.ok(ids.includes(p.id), 'every pad used: ' + p.id));
  noOverlap(R, 'all idle');
});

t('claiming a slot again is stable; keeping the current spot when nothing better is asked for', () => {
  const R = registry();
  const a = R.claim('le', 'home', { groups: ['idle'] });
  for (let i = 0; i < 5; i++) assert.strictEqual(R.claim('le', 'home', { groups: ['idle'] }).id, a.id);
});

t('ad-hoc points (hand-off, meeting, chat) are nudged off anyone already there', () => {
  const R = registry();
  const p1 = R.claimPoint('ba', 'point', { x: 5, z: 5 }), p2 = R.claimPoint('le', 'point', { x: 5, z: 5 }), p3 = R.claimPoint('sa', 'point', { x: 5.2, z: 5 });
  assert.ok(p1 && p2 && p3);
  assert.deepStrictEqual([p1.x, p1.z], [5, 5]);
  noOverlap(R, 'points');
  const sp = R.claim('grok', 'home', { groups: ['idle'] });
  const q = R.claimPoint('debugger', 'point', sp);
  assert.ok(S.dist(q, sp) >= S.MIN_GAP, 'a point never lands on a held spot');
  noOverlap(R, 'point vs spot');
});

t('spread: ambient visitors fan out over the least-used places', () => {
  const R = registry(), r = rng(7), places = R.places('ambient'), used = new Set();
  for (let i = 0; i < 8; i++) used.add(R.claim('v' + i, 'away', { places, spread: true, rand: r }).place);
  assert.ok(used.size >= 6, 'eight visitors used ' + used.size + ' places');
  noOverlap(R, 'spread');
});

t('zones reserve boardroom / lab chairs in the shared registry: sessions never share a chair, release on leave', () => {
  const R = registry(), z = new Z.Zones({ layout: L, spots: R });
  const bases = {}; IDS.forEach(id => { bases[id] = 'IDLE'; });
  const s1 = z.open(Z.sessionForEvent({ type: 'handoff', seat: 'ba', detail: { from: 'ba', to: 'le' } }), 0, bases);
  const s2 = z.open(Z.sessionForEvent({ type: 'handoff', seat: 'pm', detail: { from: 'pm', to: 'sa' } }), 0, bases);
  const chairs = [...Object.values(s1.slotOf), ...Object.values(s2.slotOf)];
  assert.strictEqual(new Set(chairs).size, 4);
  assert.strictEqual(z.target('le').sit, true);
  assert.ok(Math.abs(z.target('le').face - Math.atan2(z.target('ba').x - z.target('le').x, z.target('ba').z - z.target('le').z)) < 1e-9, 'listener faces the speaker');
  assert.strictEqual(z.target('ba').talking, true);
  ['research-mgr', 'ai-research', 'erp-research'].forEach(id => { bases[id] = 'READING'; });
  z.tick(1, bases);
  const lab = ['research-mgr', 'ai-research', 'erp-research'].map(id => z.target(id));
  assert.strictEqual(new Set(lab.map(p => p.x + ',' + p.z)).size, 3, 'three readers, three chairs');
  noOverlap(R, 'zones');
  bases.le = 'TYPING'; z.tick(2, bases);
  assert.strictEqual(R.of('le', 'zone'), null, 'real work released the chair');
});

t('stress: 14 seats, idle / ambient / zone / hand-off moves all at once for 3000 steps, never two on one spot', () => {
  const R = registry(), r = rng(42), z = new Z.Zones({ layout: L, spots: R });
  const amb = new A.Scheduler({ layout: L, spots: R, rand: r, maxWalkers: 6, walkGapMin: 0, walkGapMax: 400, firstWalkMin: 0, firstWalkMax: 10, pauseMin: 300, pauseMax: 900, chatPauseMin: 300, chatPauseMax: 900 });
  const STATES = ['IDLE', 'IDLE', 'IDLE', 'IDLE', 'TYPING', 'READING', 'THINKING', 'OFFLINE', 'BLOCKED', 'MEETING', 'YOUR_TURN', 'AT_DESK'];
  const bases = {}, pos = {};
  IDS.forEach(id => { bases[id] = 'IDLE'; pos[id] = { x: 0, z: 0 }; });
  let now = 0, trips = 0, sessions = 0;
  for (let step = 0; step < 3000; step++) {
    now += 100;
    if (r() < 0.05) { const id = IDS[Math.floor(r() * IDS.length)]; bases[id] = STATES[Math.floor(r() * STATES.length)]; }
    if (r() < 0.01) { const a = IDS[Math.floor(r() * IDS.length)], b = IDS[Math.floor(r() * IDS.length)]; if (a !== b && z.open(Z.sessionForEvent({ type: 'handoff', seat: a, detail: { from: a, to: b } }), now, bases)) sessions++; }
    z.tick(now, bases);
    // office.html spotsSync + idleSpotForAgent, in miniature
    IDS.forEach(id => {
      const idle = bases[id] === 'IDLE', zt = z.target(id);
      if (!idle || zt) R.release(id, 'home');
      if (!idle && amb.active(id)) amb.cancel(id, now);
      if (idle && !zt) { const p = R.of(id, 'home') ? null : S.preferredPad(R, id); R.claim(id, 'home', { groups: ['idle'], prefer: p ? p.id : null, near: p }); }
    });
    const list = IDS.map(id => { const h = R.of(id, 'home') || pos[id]; return { id, base: bases[id], busy: false, x: pos[id].x, z: pos[id].z, restX: h.x, restZ: h.z }; });
    const out = amb.tick(now, list);
    trips += out.started.length;
    IDS.forEach(id => { if (amb.moving(id) && r() < 0.3) amb.arrived(id, now); });
    // never moved: working / blocked / offline / meeting / your-turn seats hold no idle or ambient place
    IDS.forEach(id => { if (['TYPING', 'OFFLINE', 'BLOCKED', 'MEETING', 'YOUR_TURN'].includes(bases[id])) { assert.strictEqual(R.of(id, 'home'), null); assert.strictEqual(R.of(id, 'away'), null); assert.strictEqual(R.of(id, 'zone'), null, id + ' ' + bases[id]); } });
    noOverlap(R, 'step ' + step);
  }
  assert.ok(trips > 50, 'ambient trips ran: ' + trips);
  assert.ok(sessions > 5, 'zone sessions ran: ' + sessions);
});

t('office.html wiring: spots loaded before ambient / zones, idle places, points and zones all go through the registry', () => {
  assert.ok(html.indexOf('js/teva_spots.js') > 0 && html.indexOf('js/teva_spots.js') < html.indexOf('js/teva_ambient.js'));
  assert.ok(/function idleSpotForAgent[\s\S]{0,600}SPOTS\.claim\(agent\.id, 'home'/.test(html), 'idle place reserved');
  assert.ok(/new TevaAmbient\.Scheduler\(\{ layout: LAYOUT, spots: spotsInit\(\)/.test(html), 'ambient uses the registry');
  assert.ok(/new TevaZones\.Zones\(\{ layout: LAYOUT, spots: spotsInit\(\)/.test(html), 'zones use the registry');
  assert.ok(/spotPoint\(agent\.id, meetingSlot\(agent\.id\)\)/.test(html) && /spotPoint\(agent\.id, \{ x: p\.x \+ 0\.85/.test(html), 'meeting + hand-off points');
  assert.ok(/function updateBehavior\(\)[\s\S]{0,500}spotsSync\(\)/.test(html), 'releases run before targets');
  assert.ok(/function idleSpotForAgent[\s\S]{0,200}if \(spotsInit\(\)\) \{[\s\S]{0,900}fw\.idleSpots\[Math\.abs\(h\)/.test(html), 'the old hash pad is only the no-registry fallback');
});

console.log('TESTS PASSED (' + n + ')');
