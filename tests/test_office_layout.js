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
if (!layout.meetingSpaces || !layout.meetingSpaces.main) {
  console.error('meetingSpaces missing');
  fail++;
}
if (layout.meetingSpaces.main.z !== layout.anchors.meeting.z) {
  console.error('meetingSpaces.main.z must match anchors.meeting.z');
  fail++;
}
if (!layout.anchors.funZone) {
  console.error('anchors.funZone missing');
  fail++;
}

// Desks are 2.85 x 1.28 (public/js/teva_environment.js buildWorkstation) and sit
// 0.9 behind their seat. Neighbouring workstations must keep clear floor, both
// inside a team and across team boundaries.
const DESK_W = 2.85, DESK_D = 1.28, DESK_Z_OFFSET = 0.9, MIN_CLEARANCE = 1.2;
// Leadership shares the meeting table instead of owning desks.
const TABLE_ONLY = ['supervisor', 'pm', 'ba'];
const deskIds = required.filter(id => !TABLE_ONLY.includes(id));
deskIds.forEach((id, i) => {
  deskIds.slice(i + 1).forEach(other => {
    const a = layout.seats[id], b = layout.seats[other];
    const gapX = Math.max(0, Math.abs(a.x - b.x) - DESK_W);
    // The desk offset is the same for every seat, so it cancels out here.
    const gapZ = Math.max(0, Math.abs((a.z - DESK_Z_OFFSET) - (b.z - DESK_Z_OFFSET)) - DESK_D);
    const gap = Math.hypot(gapX, gapZ);
    if (gap < MIN_CLEARANCE) {
      console.error(`workstation clearance ${gap.toFixed(2)} between ${id} and ${other}`);
      fail++;
    }
  });
});
// Zone rectangles are drawn as coloured floor outlines, so two overlapping
// rectangles read as lines crossing through a team's area. Keep them apart and
// keep each team's desks inside its own rectangle.
const MIN_ZONE_GAP = 0.8;
const zones = layout.zones || [];
zones.forEach((a, i) => {
  zones.slice(i + 1).forEach(b => {
    const gapX = Math.max(0, Math.abs(a.x - b.x) - (a.w + b.w) / 2);
    const gapZ = Math.max(0, Math.abs(a.z - b.z) - (a.d + b.d) / 2);
    const gap = Math.hypot(gapX, gapZ);
    if (gap < MIN_ZONE_GAP - 1e-9) {
      console.error(`zone outlines too close (${gap.toFixed(2)}): ${a.name} / ${b.name}`);
      fail++;
    }
  });
});
const teamSeats = {
  Engineering: ['le', 'le2', 'sa', 'debugger'],
  Research: ['research-mgr', 'ai-research', 'erp-research'],
  Business: ['product', 'competitor', 'ui-docs'],
  Ingest: ['grok'],
  'Needs Steve': ['needs-steve']
};
Object.keys(teamSeats).forEach(name => {
  const zone = zones.find(z => z.name === name);
  if (!zone) { console.error('missing zone for team:', name); fail++; return; }
  teamSeats[name].forEach(id => {
    const seat = layout.seats[id];
    const halfW = DESK_W / 2, halfD = DESK_D / 2, z0 = seat.z - DESK_Z_OFFSET;
    const inside = seat.x - halfW >= zone.x - zone.w / 2 && seat.x + halfW <= zone.x + zone.w / 2
      && z0 - halfD >= zone.z - zone.d / 2 && z0 + halfD <= zone.z + zone.d / 2;
    if (!inside) {
      console.error(`desk ${id} sticks out of zone ${name}`);
      fail++;
    }
  });
});

// public/assets/teva-scene-contract.json mirrors seats/zones for the Babylon
// pilot, so it has to move with the layout instead of drifting out of sync.
const contract = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'assets', 'teva-scene-contract.json'), 'utf8'));
Object.keys(contract.seats || {}).forEach(id => {
  const a = contract.seats[id], b = layout.seats[id];
  if (!b || a.x !== b.x || a.z !== b.z) {
    console.error('scene contract seat out of sync:', id, a, b);
    fail++;
  }
});
(contract.zones || []).forEach(cz => {
  const lz = (layout.zones || []).find(z => z.name === cz.name);
  if (!lz || lz.x !== cz.x || lz.z !== cz.z || lz.w !== cz.width || lz.d !== cz.depth) {
    console.error('scene contract zone out of sync:', cz.name, cz, lz);
    fail++;
  }
});
if (contract.meetingSpaces && layout.meetingSpaces) {
  Object.keys(contract.meetingSpaces).forEach(key => {
    const a = contract.meetingSpaces[key];
    const b = layout.meetingSpaces[key];
    if (!b || a.x !== b.x || a.z !== b.z || a.radius !== b.radius) {
      console.error('scene contract meetingSpace out of sync:', key, a, b);
      fail++;
    }
  });
}
if (contract.anchors && contract.anchors.meeting) {
  const am = contract.anchors.meeting;
  const bm = layout.anchors.meeting;
  if (am.x !== bm.x || am.z !== bm.z) {
    console.error('scene contract meeting anchor out of sync', am, bm);
    fail++;
  }
}

console.log(fail ? `FAIL ${fail}` : 'ok', 'seats', Object.keys(layout.seats).length, 'room', layout.room.width + 'x' + layout.room.depth);
process.exit(fail ? 1 : 0);
