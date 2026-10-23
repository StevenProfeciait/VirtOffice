// Unit tests for public/js/teva_mapping_ui.js. Run: node tests/test_teva_mapping_ui.js
'use strict';
const assert = require('assert');
const path = require('path');
const M = require(path.join(__dirname, '..', 'public', 'js', 'teva_mapping_ui.js'));

let n = 0;
function t(name, fn) { fn(); n++; console.log('ok', n, name); }

t('unassignedQueue filters and sorts by lastActivity', () => {
  const q = M.unassignedQueue([
    { id: 'a', seat: 'le2', lastActivity: 9 },
    { id: 'b', seat: null, lastActivity: 1 },
    { id: 'c', lastActivity: 5 },
  ]);
  assert.deepStrictEqual(q.map((c) => c.id), ['c', 'b']);
});

t('candidatesOf and conflict', () => {
  assert.deepStrictEqual(M.candidatesOf({ candidates: ['sa', 'le'] }), ['sa', 'le']);
  assert.ok(M.isConflict({ conflict: true }));
  assert.ok(M.isConflict({ seat: null, candidates: ['a', 'b'] }));
  assert.ok(!M.isConflict({ seat: 'le2', candidates: ['le2'] }));
  assert.ok(!M.isConflict({ seat: null, candidates: [] }));
});

t('rowModel shape', () => {
  const r = M.rowModel({
    id: 'x', title: 'T', evidence: 'ambiguous', candidates: ['le', 'debugger'],
    conflict: true, state: 'stale', lastActivity: 3, step: '…',
  });
  assert.strictEqual(r.id, 'x');
  assert.strictEqual(r.conflict, true);
  assert.deepStrictEqual(r.candidates, ['le', 'debugger']);
});

t('office.html wires mapping queue + teva_mapping_ui', () => {
  const fs = require('fs');
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'office.html'), 'utf8');
  assert.ok(html.indexOf('js/teva_mapping_ui.js') >= 0);
  assert.ok(html.indexOf('mappingQueueHtml') >= 0);
  assert.ok(html.indexOf('VO.snapPlacement') >= 0);
  assert.ok(html.indexOf('instant: true') >= 0 || html.indexOf('opts.instant') >= 0);
});

console.log(`ALL ${n} TESTS PASSED`);
