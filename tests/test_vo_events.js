// Unit tests for public/vo_events.js (R-VO-002 Phase 3a). Run: node tests/test_vo_events.js
'use strict';
const assert = require('assert');
const path = require('path');
const V = require(path.join(__dirname, '..', 'public', 'vo_events.js'));

const NOW = 1792263000000;
let n = 0;
function t(name, fn) { fn(); n++; console.log('ok', n, name); }
const clone = (x) => JSON.parse(JSON.stringify(x));
function chat(over) { return Object.assign({ id: 'aaaaaaaa-1111', title: 'LE2 cleanup', state: 'active', toolKind: 'write', step: 'Writing Foo.php', lastActivity: NOW - 1000, subagents: 0, endStatus: '', endedAt: null }, over || {}); }
function seat(id, over) { return Object.assign({ id, name: id, status: 'idle', task: 'Idle', signal: true, blocked: false, source: { file: 'TEVA_COMPANY_BACKLOG.md', line: 26 }, docs: [], docsOwned: false, cursor: { count: 0, latest: null } }, over || {}); }
function withChat(id, c, over) { return seat(id, Object.assign({ cursor: { count: 1, latest: chat(c), chats: [] } }, over || {})); }
function ns(over) { return Object.assign({ id: 'needs-steve', needsSteveItems: [], board: { researchCounts: { Done: 5 }, researchWip: [], items: [], backlogPath: '/r/docs/TEVA_COMPANY_BACKLOG.md', researchPath: '/r/docs/TEVA_RESEARCH_BACKLOG.md' } }, over || {}); }
const types = (evs) => evs.map((e) => e.type + ':' + e.seat);

t('first payload is silent', () => {
  assert.deepStrictEqual(V.deriveEvents(null, [withChat('le2', {})], NOW), []);
  assert.deepStrictEqual(V.deriveEvents(undefined, [seat('le')], NOW), []);
});
t('unchanged payload gives no events', () => {
  const p = [withChat('le2', {}), seat('le', { status: 'working' }), ns()];
  assert.deepStrictEqual(V.deriveEvents(p, clone(p), NOW), []);
});
t('active+write -> toolStart and TYPING', () => {
  const a = [withChat('le2', { state: 'stale', toolKind: 'read' })], b = [withChat('le2', { state: 'active', toolKind: 'write' })];
  const ev = V.deriveEvents(a, b, NOW);
  assert.deepStrictEqual(types(ev), ['toolStart:le2']);
  assert.ok(ev[0].source.startsWith('chat aaaaaaaa'));
  assert.strictEqual(V.baseState(b[0], NOW), 'TYPING');
  assert.strictEqual(V.overlayFor(ev[0]).overlay, null);
});
t('toolKind change while active is a toolStart; same kind is not', () => {
  const a = [withChat('le2', { toolKind: 'write' })];
  assert.deepStrictEqual(types(V.deriveEvents(a, [withChat('le2', { toolKind: 'shell' })], NOW)), ['toolStart:le2']);
  assert.deepStrictEqual(V.deriveEvents(a, [withChat('le2', { toolKind: 'write', step: 'Writing Bar.php' })], NOW), []);
});
t('ended/success -> turnEnded ok -> celebrate, then YOUR_TURN', () => {
  const a = [withChat('le2', {})], b = [withChat('le2', { state: 'ended', endStatus: 'success', endedAt: NOW - 500 })];
  const ev = V.deriveEvents(a, b, NOW);
  assert.deepStrictEqual(types(ev), ['turnEnded:le2']);
  assert.strictEqual(ev[0].detail.ok, true);
  assert.strictEqual(V.overlayFor(ev[0]).overlay, 'celebrate');
  assert.strictEqual(V.baseState(b[0], NOW), 'YOUR_TURN');
  assert.strictEqual(V.baseState(b[0], NOW + V.YOUR_TURN_MS + 1), 'IDLE');       // expires after 30 min
  assert.strictEqual(V.baseState(b[0], NOW, NOW - 500), 'IDLE');                  // 👀 seen clears it
});
t('ended/error -> head-scratch + BLOCKED for 15 min', () => {
  const a = [withChat('le2', {})], b = [withChat('le2', { state: 'ended', endStatus: 'error', endedAt: NOW })];
  const ev = V.deriveEvents(a, b, NOW);
  assert.strictEqual(ev[0].detail.ok, false);
  assert.strictEqual(V.overlayFor(ev[0]).overlay, 'headScratch');
  assert.strictEqual(V.baseState(b[0], NOW + 1000), 'BLOCKED');
  assert.strictEqual(V.baseState(b[0], NOW + V.FAILED_MS + 1), 'IDLE');
});
t('unknown end status: feed only, no overlay', () => {
  const ev = V.deriveEvents([withChat('le', {})], [withChat('le', { state: 'ended', endStatus: '', endedAt: NOW })], NOW);
  assert.strictEqual(ev[0].detail.ok, null);
  assert.strictEqual(V.overlayFor(ev[0]).overlay, null);
});
t('active -> stale is stalled, base THINKING; old stale is not animated', () => {
  const ev = V.deriveEvents([withChat('sa', {})], [withChat('sa', { state: 'stale' })], NOW);
  assert.deepStrictEqual(types(ev), ['stalled:sa']);
  assert.strictEqual(V.baseState(withChat('sa', { state: 'stale', lastActivity: NOW - 5 * 60e3 }), NOW), 'THINKING');
  assert.strictEqual(V.baseState(withChat('sa', { state: 'stale', lastActivity: NOW - 3 * 3600e3 }), NOW), 'IDLE');
  assert.ok(V.thinkingDim(withChat('sa', { state: 'stale', lastActivity: NOW - 11 * 60e3 }), NOW));
});
t('read/search/fetch -> READING, shell -> RUNNING, task -> DELEGATING, other -> AT_DESK', () => {
  for (const k of ['read', 'search', 'fetch']) assert.strictEqual(V.baseState(withChat('x', { toolKind: k }), NOW), 'READING');
  assert.strictEqual(V.baseState(withChat('x', { toolKind: 'shell' }), NOW), 'RUNNING');
  assert.strictEqual(V.baseState(withChat('x', { toolKind: 'task' }), NOW), 'DELEGATING');
  assert.strictEqual(V.baseState(withChat('x', { toolKind: 'other', subagents: 2 }), NOW), 'DELEGATING');
  assert.strictEqual(V.baseState(withChat('x', { toolKind: 'other' }), NOW), 'AT_DESK');
  assert.strictEqual(V.helperCount(withChat('x', { toolKind: 'task', subagents: 7 })), 3);
});
t('priority: OFFLINE > BLOCKED > MEETING > activity; working w/o chat = AT_DESK', () => {
  assert.strictEqual(V.baseState(seat('d', { signal: false }), NOW), 'OFFLINE');
  assert.strictEqual(V.baseState(withChat('d', {}, { signal: false }), NOW), 'TYPING');     // a mapped chat is a live signal
  assert.strictEqual(V.baseState(withChat('d', {}, { blocked: true }), NOW), 'BLOCKED');
  assert.strictEqual(V.baseState(withChat('d', {}, { status: 'meeting' }), NOW), 'MEETING');
  assert.strictEqual(V.baseState(seat('d', { status: 'working' }), NOW), 'AT_DESK');
  assert.strictEqual(V.baseState(seat('d'), NOW), 'IDLE');
  assert.strictEqual(V.baseState(ns({ needsSteveItems: [{ text: 'x' }] }), NOW), 'IDLE');
});
t('doc mtime bump -> docWritten -> docPop (owned docs only)', () => {
  const docs = [{ name: 'SA_X.md', path: '/r/docs/SA_X.md', mtime: 100 }];
  const a = [seat('sa', { docsOwned: true, docs })];
  const b = [seat('sa', { docsOwned: true, docs: [{ name: 'SA_X.md', path: '/r/docs/SA_X.md', mtime: 200 }] })];
  const ev = V.deriveEvents(a, b, NOW);
  assert.deepStrictEqual(types(ev), ['docWritten:sa']);
  assert.ok(ev[0].source.startsWith('docs/SA_X.md'));
  assert.strictEqual(V.overlayFor(ev[0]).overlay, 'docPop');
  // a brand-new doc newer than all previous ones also counts
  const c = [seat('sa', { docsOwned: true, docs: [{ name: 'SA_Y.md', mtime: 300 }].concat(docs) })];
  assert.deepStrictEqual(types(V.deriveEvents(a, c, NOW)), ['docWritten:sa']);
  // board fallback docs (docsOwned false) never pop
  const f1 = [seat('le', { docs: [{ name: 'TEVA_COMPANY_BACKLOG.md', mtime: 1 }] })], f2 = [seat('le', { docs: [{ name: 'TEVA_COMPANY_BACKLOG.md', mtime: 2 }] })];
  assert.deepStrictEqual(V.deriveEvents(f1, f2, NOW), []);
});
t('new Needs Steve item -> needsSteveAdded with beacon + owner raises hand', () => {
  const a = [seat('le'), ns()];
  const b = [seat('le'), ns({ needsSteveItems: [{ text: 'Tell Laravel Expert: go', line: 873, path: '/r/docs/TEVA_COMPANY_BACKLOG.md', owner: 'le' }] })];
  const ev = V.deriveEvents(a, b, NOW);
  assert.deepStrictEqual(types(ev), ['needsSteveAdded:needs-steve']);
  assert.strictEqual(ev[0].source, 'TEVA_COMPANY_BACKLOG.md:873');
  const o = V.overlayFor(ev[0]);
  assert.strictEqual(o.beacon, true); assert.strictEqual(o.seat, 'le'); assert.strictEqual(o.overlay, 'raiseHand');
  // removing an item is not an event
  assert.deepStrictEqual(V.deriveEvents(b, a, NOW), []);
});
t('research item leaves WIP and Done rises -> researchDone -> confetti on owner', () => {
  const a = [ns({ board: { researchCounts: { Done: 5, WIP: 1 }, researchWip: [{ id: 'R-VO-002', item: 'x', owner: 'grok', line: 40 }], items: [] } })];
  const b = [ns({ board: { researchCounts: { Done: 6 }, researchWip: [], items: [] } })];
  const ev = V.deriveEvents(a, b, NOW);
  assert.deepStrictEqual(types(ev), ['researchDone:grok']);
  assert.strictEqual(V.overlayFor(ev[0]).overlay, 'confetti');
  // leaving WIP without the Done count rising (e.g. Blocked) is not "done"
  const c = [ns({ board: { researchCounts: { Done: 5, Blocked: 1 }, researchWip: [], items: [] } })];
  assert.deepStrictEqual(V.deriveEvents(a, c, NOW), []);
});
t('owner change -> handoff A->B', () => {
  const mk = (o) => [ns({ board: { researchCounts: {}, researchWip: [], items: [{ doc: 'backlog', id: 'HR-GAP', owner: o, line: 120, title: 'HR gap' }] } })];
  const ev = V.deriveEvents(mk('le2'), mk('le'), NOW);
  assert.deepStrictEqual(types(ev), ['handoff:le2']);
  assert.deepStrictEqual([ev[0].detail.from, ev[0].detail.to], ['le2', 'le']);
  assert.strictEqual(ev[0].source, 'TEVA_COMPANY_BACKLOG.md:120');
  const o = V.overlayFor(ev[0]);
  assert.deepStrictEqual([o.seat, o.overlay, o.to], ['le2', 'handoff', 'le']);
  assert.deepStrictEqual(V.deriveEvents(mk('le2'), mk('le2'), NOW), []);
});
t('blocked flag flips; status change; task change only when status is the same', () => {
  const ev = V.deriveEvents([seat('debugger')], [seat('debugger', { blocked: true, blockedSource: { file: 'TEVA_COMPANY_BACKLOG.md', line: 5, text: 'Debugger BLOCKED' } })], NOW);
  assert.deepStrictEqual(types(ev), ['blocked:debugger']);
  assert.strictEqual(ev[0].source, 'TEVA_COMPANY_BACKLOG.md:5');
  const s = V.deriveEvents([seat('le')], [seat('le', { status: 'working', task: 'P2' })], NOW);
  assert.deepStrictEqual(types(s), ['statusChange:le']);
  assert.strictEqual(V.overlayFor(s[0]).overlay, 'stretch');
  assert.deepStrictEqual(types(V.deriveEvents([seat('le')], [seat('le', { task: 'Other' })], NOW)), ['taskChange:le']);
});
t('events for one seat are ordered by importance', () => {
  const a = [withChat('le2', {}, { status: 'idle' })];
  const b = [withChat('le2', { state: 'ended', endStatus: 'success', endedAt: NOW }, { status: 'working', task: 'x' })];
  assert.deepStrictEqual(types(V.deriveEvents(a, b, NOW)), ['turnEnded:le2', 'statusChange:le2']);
});
t('throttle: one overlay per seat per 4 s', () => {
  const th = new V.Throttle();
  assert.ok(th.allow('le', NOW)); assert.ok(!th.allow('le', NOW + 3999)); assert.ok(th.allow('sa', NOW + 10));
  assert.ok(th.allow('le', NOW + 4000)); assert.ok(!th.allow(null, NOW));
});
t('inbox diffs: first silent, sent up = inboxSaved, unread down = inboxRead', () => {
  assert.deepStrictEqual(V.deriveInboxEvents(null, { le: { sent: 1, unread: 1 } }, NOW), []);
  const ev = V.deriveInboxEvents({ le: { sent: 1, unread: 1 }, sa: { sent: 2, unread: 2 } }, { le: { sent: 2, unread: 2 }, sa: { sent: 2, unread: 0 } }, NOW);
  assert.deepStrictEqual(types(ev), ['inboxSaved:le', 'inboxRead:sa']);
});
t('attention order: Needs Steve -> blocked -> your-turn, and 👀 removes your-turn', () => {
  const agents = [withChat('le2', { state: 'ended', endStatus: 'success', endedAt: NOW - 1000 }), seat('debugger', { blocked: true }), ns({ needsSteveItems: [{ text: 'a' }, { text: 'b' }] })];
  const list = V.attention(agents, NOW, {});
  assert.deepStrictEqual(list.map((x) => x.seat), ['needs-steve', 'debugger', 'le2']);
  assert.strictEqual(V.attentionCount(list), 4);
  assert.deepStrictEqual(V.attention(agents, NOW, { le2: NOW }).map((x) => x.seat), ['needs-steve', 'debugger']);
});
t('reaction table: 1 wave + 5 poke are local; 2,3,4,6 stored', () => {
  const stored = Object.keys(V.REACTIONS).filter((k) => V.REACTIONS[k].stored);
  assert.deepStrictEqual(stored, ['2', '3', '4', '6']);
  assert.deepStrictEqual(stored.map((k) => V.REACTIONS[k].emoji), ['\u{1F44D}', '\u{1F389}', '\u{1F440}', '\u270B']);
});
console.log(`ALL ${n} TESTS PASSED`);
