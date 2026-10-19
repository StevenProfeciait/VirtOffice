// Seat ids in public/office_layout.js must cover teva_sync ROSTER + needs-steve.
// Run: node tests/test_office_layout.js
const path = require('path');
const fs = require('fs');
const vm = require('vm');

const layoutPath = path.join(__dirname, '..', 'public', 'office_layout.js');
const sandbox = { window: {}, global: {} };
sandbox.window = sandbox;
sandbox.global = sandbox;
vm.runInContext(fs.readFileSync(layoutPath, 'utf8'), vm.createContext(sandbox));
const layout = sandbox.OFFICE_LAYOUT || sandbox.LAYOUT;
if (!layout || !layout.seats) {
  console.error('OFFICE_LAYOUT not loaded');
  process.exit(1);
}

const required = [
  'supervisor', 'pm', 'ba', 'le', 'le2', 'sa', 'debugger', 'research-mgr', 'ai-research',
  'erp-research', 'product', 'competitor', 'ui-docs', 'grok', 'needs-steve'
];
let fail = 0;
required.forEach(id => {
  if (!layout.seats[id]) {
    console.error('missing seat in layout:', id);
    fail++;
  }
});
if (layout.room.width < 48 || layout.room.depth < 32) {
  console.error('room smaller than planned expansion:', layout.room);
  fail++;
}
if (!layout.wing || !layout.camera.wing) {
  console.error('wing / wing camera preset missing');
  fail++;
}
if (!layout.exterior || !layout.exterior.groundSize) {
  console.error('exterior ground config missing');
  fail++;
}
if (!layout.workstations || !layout.workstations.le) {
  console.error('workstations config missing');
  fail++;
}
if (!layout.navPoints || !layout.navPoints.meeting) {
  console.error('navPoints missing');
  fail++;
}
console.log(fail ? `FAIL ${fail}` : 'ok', 'seats', Object.keys(layout.seats).length, 'room', layout.room.width + 'x' + layout.room.depth);
process.exit(fail ? 1 : 0);
