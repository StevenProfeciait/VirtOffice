// Unit tests for public/js/teva_messages_ui.js. Run: node tests/test_teva_messages_ui.js
'use strict';
const assert = require('assert');
const path = require('path');
const M = require(path.join(__dirname, '..', 'public', 'js', 'teva_messages_ui.js'));

let n = 0;
function t(name, fn) { fn(); n++; console.log('ok', n, name); }

t('observedLabel success / fail / empty', () => {
  assert.strictEqual(M.observedLabel(null), 'Observed: —');
  assert.strictEqual(M.observedLabel({}), 'Observed: —');
  assert.strictEqual(M.observedLabel({ endStatus: 'success' }), 'Observed: success');
  assert.strictEqual(M.observedLabel({ endStatus: 'error' }), 'Observed: fail (error)');
  assert.ok(M.observedOk({ endStatus: 'success' }));
  assert.ok(!M.observedOk({ endStatus: 'error' }));
});

t('actionFlags for lifecycle states', () => {
  assert.deepStrictEqual(M.actionFlags({ status: 'DELIVERING', handoff: { url: 'cursor://x' } }), {
    handoff: true, acknowledge: false, respond: false, retry: false, cancel: true
  });
  assert.deepStrictEqual(M.actionFlags({ status: 'DELIVERED' }), {
    handoff: false, acknowledge: true, respond: true, retry: false, cancel: true
  });
  assert.deepStrictEqual(M.actionFlags({ status: 'FAILED' }), {
    handoff: false, acknowledge: false, respond: false, retry: true, cancel: true
  });
  assert.deepStrictEqual(M.actionFlags({ status: 'RESPONDED' }), {
    handoff: false, acknowledge: false, respond: false, retry: false, cancel: false
  });
});

t('mergeFailedAttention order: blocked then failed then your-turn', () => {
  const base = [
    { seat: 'needs-steve', why: 'needs-steve', count: 1 },
    { seat: 'debugger', why: 'blocked', count: 1 },
    { seat: 'le2', why: 'your-turn', count: 1 },
  ];
  const merged = M.mergeFailedAttention(base, ['sa', 'debugger', 'needs-steve']);
  assert.deepStrictEqual(merged.map((x) => x.seat + ':' + x.why), [
    'needs-steve:needs-steve',
    'debugger:blocked',
    'sa:failed-instruction',
    'le2:your-turn',
  ]);
  // debugger already blocked — must not also appear as failed-instruction (no double-count)
  assert.strictEqual(merged.filter((x) => x.seat === 'debugger').length, 1);
});

t('DELIVERED with observed_outcome still offers Record response', () => {
  const flags = M.actionFlags({
    status: 'DELIVERED',
    observed_outcome: { chatId: 'c', endStatus: 'success', source: 'cursor' },
  });
  assert.ok(flags.respond, 'Observed ≠ Responded — Steve still records response');
  assert.ok(!flags.retry);
  assert.ok(M.HONESTY.indexOf('Observed') >= 0 && M.HONESTY.indexOf('Responded') >= 0);
});

t('failedSeatsFrom agents + SEAT_MESSAGES', () => {
  const agents = [{ id: 'le2', messaging: { failedOpen: true } }, { id: 'sa' }];
  const seatMessages = { sa: [{ status: 'FAILED' }], grok: [{ status: 'DELIVERED' }] };
  const ids = M.failedSeatsFrom(agents, seatMessages).sort();
  assert.deepStrictEqual(ids, ['le2', 'sa']);
});

t('honesty copy present', () => {
  assert.ok(M.HONESTY.indexOf('Observed') >= 0);
  assert.ok(M.HONESTY.indexOf('Executed') >= 0);
  assert.strictEqual(M.whyToast('failed-instruction'), 'instruction FAILED');
});

t('office.html loads teva_messages_ui.js', () => {
  const fs = require('fs');
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'office.html'), 'utf8');
  assert.ok(html.indexOf('js/teva_messages_ui.js') >= 0);
  assert.ok(html.indexOf('TevaMessagesUi') >= 0);
  assert.ok(html.indexOf('mergeFailedAttention') >= 0 || html.indexOf('observedLabel') >= 0);
});

console.log(`ALL ${n} TESTS PASSED`);
