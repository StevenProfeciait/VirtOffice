// Run: node tests/test_meeting_spaces.js
const path = require('path');
const fs = require('fs');
const vm = require('vm');

const sandbox = { window: {}, global: {} };
sandbox.window = sandbox;
sandbox.global = sandbox;
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'office_layout.js'), 'utf8'), vm.createContext(sandbox));
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'teva_meeting_spaces.js'), 'utf8'), vm.createContext(sandbox));

const TMS = sandbox.TevaMeetingSpaces;
if (!TMS || !TMS.resolveMeetingSpace) {
  console.error('TevaMeetingSpaces not loaded');
  process.exit(1);
}

let fail = 0;
function check(label, cond) {
  if (!cond) { console.error('FAIL:', label); fail++; }
}

const cases = [
  ['supervisor', 'leadership'],
  ['pm', 'leadership'],
  ['ba', 'leadership'],
  ['le', 'engineering'],
  ['debugger', 'engineering'],
  ['research-mgr', 'research'],
  ['product', 'business'],
  ['grok', 'main'],
  ['needs-steve', 'main']
];
cases.forEach(([id, expectedId]) => {
  const space = TMS.resolveMeetingSpace({ id });
  check(id + ' -> ' + expectedId, space.id === expectedId);
});

const explicit = TMS.resolveMeetingSpace({ id: 'le', meetingSpace: 'main' });
check('explicit meetingSpace override', explicit.id === 'main');

const meetingAgents = [
  { id: 'le' }, { id: 'sa' }, { id: 'pm' }
];
const slotLe = TMS.meetingSlotForAgent({ id: 'le' }, meetingAgents.filter(a => a.id !== 'needs-steve'));
check('le slot in engineering space', slotLe.space.id === 'engineering');

console.log(fail ? `FAIL ${fail}` : 'ok', 'meeting space resolver');
process.exit(fail ? 1 : 0);
