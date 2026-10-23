// Unit tests for public/js/teva_zones.js (real-event zone use) + office.html wiring (2026-10-22).
// Run: node tests/test_teva_zones.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
require(path.join(__dirname, '..', 'public', 'office_layout.js'));
const Z = require(path.join(__dirname, '..', 'public', 'js', 'teva_zones.js'));
const L = global.OFFICE_LAYOUT;

let n = 0;
function t(name, fn) { fn(); n++; console.log('ok', n, name); }
const ev = (type, seat, detail) => ({ type, seat, source: 'TEVA_COMPANY_BACKLOG.md:7', at: 0, detail: detail || {} });

t('boardroom slots match the boardroom table (15 chairs, long axis along z) and face the table', () => {
  const s = Z.boardroomSlots(L), b = L.meetingSpaces.boardroom;
  assert.strictEqual(s.length, b.chairs);
  s.forEach(p => { assert.ok(Math.abs(p.x - b.x) <= b.tableD / 2 + 1.1); assert.ok(Math.abs(p.z - b.z) <= b.tableW / 2 + 1.1); });
  assert.ok(s.slice(0, 7).every(p => p.x > b.x && Math.abs(p.face + Math.PI / 2) < 1e-9), 'east side faces west');
  assert.strictEqual(Z.researchSlots(L).length, 3);
});

t('only real events open a session: hand-off, BA board round, SA review; nothing else', () => {
  assert.strictEqual(Z.sessionForEvent(ev('handoff', 'ba', { from: 'ba', to: 'le', id: 'R-1' })).kind, 'handoff-review');
  assert.deepStrictEqual(Z.sessionForEvent(ev('handoff', 'ba', { from: 'ba', to: 'le' })).seats, ['ba', 'le']);
  assert.strictEqual(Z.sessionForEvent(ev('handoff', 'ba', { from: 'ba', to: 'needs-steve' })), null);
  assert.strictEqual(Z.sessionForEvent(ev('docWritten', 'ba', { name: 'TEVA_COMPANY_BACKLOG.md' })).kind, 'board-round');
  assert.strictEqual(Z.sessionForEvent(ev('docWritten', 'ba', { name: 'notes.md' })), null);
  assert.strictEqual(Z.sessionForEvent(ev('docWritten', 'sa', { name: 'SA_BTS_403_REVIEW.md' })).kind, 'sa-review');
  assert.strictEqual(Z.sessionForEvent(ev('taskChange', 'sa', { task: 'Review HR-4 PASS gate' })).kind, 'sa-review');
  assert.strictEqual(Z.sessionForEvent(ev('taskChange', 'sa', { task: 'Write migration' })), null);
  ['toolStart', 'turnEnded', 'statusChange', 'inboxSaved'].forEach(tp => assert.strictEqual(Z.sessionForEvent(ev(tp, 'ba')), null, tp));
  assert.strictEqual(Z.sessionForEvent(null), null);
});

t('working, blocked, offline and meeting seats never leave for the boardroom', () => {
  const z = new Z.Zones({ layout: L });
  const sess = Z.sessionForEvent(ev('handoff', 'ba', { from: 'ba', to: 'le' }));
  assert.strictEqual(z.open(sess, 0, { ba: 'TYPING', le: 'OFFLINE' }), null);
  const s = z.open(sess, 0, { ba: 'IDLE', le: 'RUNNING' });
  assert.deepStrictEqual(s.seats, ['ba']);
  assert.strictEqual(z.target('le'), null);
  assert.strictEqual(z.target('ba').zone, 'boardroom');
});

t('session timing: travel allowance, then SESSION_MS from when everyone has arrived', () => {
  const z = new Z.Zones({ layout: L });
  z.open(Z.sessionForEvent(ev('handoff', 'ba', { from: 'ba', to: 'le' })), 0, { ba: 'IDLE', le: 'AT_DESK' });
  const bases = { ba: 'IDLE', le: 'AT_DESK' };
  assert.deepStrictEqual(z.tick(60000, bases), [], 'still walking there after a minute');
  z.arrived('ba', 61000); assert.ok(z.session('ba').until > 61000 + Z.SESSION_MS, 'waits for the other seat');
  z.arrived('le', 70000); assert.strictEqual(z.session('le').until, 70000 + Z.SESSION_MS);
  assert.deepStrictEqual(z.tick(70000 + Z.SESSION_MS - 1, bases), []);
  assert.deepStrictEqual(z.tick(70000 + Z.SESSION_MS, bases).sort(), ['ba', 'le']);
  assert.strictEqual(z.target('ba'), null);
});

t('real work ends a session at once (active work happens at the desk)', () => {
  const z = new Z.Zones({ layout: L });
  z.open(Z.sessionForEvent(ev('docWritten', 'sa', { name: 'SA_REVIEW.md' })), 0, { sa: 'AT_DESK' });
  assert.ok(z.target('sa'));
  assert.deepStrictEqual(z.tick(1000, { sa: 'TYPING' }), ['sa']);
  assert.strictEqual(z.target('sa'), null);
});

t('two sessions use different boardroom spots; a seat in a new session moves to it', () => {
  const z = new Z.Zones({ layout: L });
  const b = { ba: 'IDLE', le: 'IDLE', sa: 'IDLE' };
  z.open(Z.sessionForEvent(ev('handoff', 'ba', { from: 'ba', to: 'le' })), 0, b);
  z.open(Z.sessionForEvent(ev('docWritten', 'sa', { name: 'SA_GATE.md' })), 0, b);
  const spots = ['ba', 'le', 'sa'].map(id => z.target(id).x + ',' + z.target(id).z);
  assert.strictEqual(new Set(spots).size, 3);
  z.open(Z.sessionForEvent(ev('handoff', 'sa', { from: 'sa', to: 'ba' })), 0, b);
  assert.strictEqual(z.session('ba').kind, 'handoff-review'); assert.deepStrictEqual(z.session('ba').seats.sort(), ['ba', 'sa']);
  assert.strictEqual(z.snapshot().sessions.length, 2);
});

t('research seats read in the Research Lab while READING, linger, and leave for real work or idle', () => {
  const z = new Z.Zones({ layout: L, dwellMs: 45000 });
  assert.ok(Z.isResearchSeat(L, 'ai-research') && !Z.isResearchSeat(L, 'le'));
  assert.deepStrictEqual(z.tick(0, { 'ai-research': 'READING', le: 'READING' }), ['ai-research']);
  assert.strictEqual(z.target('ai-research').zone, 'research'); assert.strictEqual(z.target('le'), null);
  assert.deepStrictEqual(z.tick(10000, { 'ai-research': 'THINKING' }), [], 'short pause between reads: stays');
  assert.deepStrictEqual(z.tick(50000, { 'ai-research': 'THINKING' }), ['ai-research'], 'dwell over');
  z.tick(60000, { 'ai-research': 'READING' });
  assert.deepStrictEqual(z.tick(61000, { 'ai-research': 'TYPING' }), ['ai-research'], 'writing up happens at the desk');
});

t('office.html wiring: zones loaded, seatTarget asks zones first, events open sessions, the feed names the move', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'office.html'), 'utf8');
  assert.ok(html.includes('<script src="js/teva_zones.js"></script>'));
  assert.ok(/const zt = ZONES \? ZONES\.target\(agent\.id\) : null;/.test(html));
  assert.ok(html.includes('zonesOnEvent(e, now, anims);') && html.includes("anims.push('→ boardroom ("));
  assert.ok(html.includes('zonesTick(now);'));
  assert.ok(html.includes("if (e.type === 'turnEnded' && e.detail.ok === true) completionMoment(e.seat, now);"));
  assert.ok(html.includes('TevaMotion.overlayPose(rov.name'), 'Cyberpunk mirrors real overlays (turn done ✓ etc.)');
  // the Fun Wing stays idle / ambient only: zones never target it
  const fw = L.funWing;
  Z.boardroomSlots(L).concat(Z.researchSlots(L)).forEach(p => assert.ok(p.x < L.room.width / 2, 'not in the Fun Wing'));
  assert.ok(fw);
});

console.log(`TESTS PASSED (${n})`);
