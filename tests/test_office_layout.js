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
if (!layout.funWing || !layout.camera.fun) {
  console.error('funWing / fun camera preset missing');
  fail++;
}
if (!layout.funWing.idleSpots || layout.funWing.idleSpots.length < 4) {
  console.error('funWing.idleSpots needs at least 4 spots');
  fail++;
}
const funZone = (layout.zones || []).find(z => z.name === 'Fun Station');
if (!funZone) {
  console.error('Fun Station zone missing');
  fail++;
}
if (layout.departments && layout.departments['Fun Zone']) {
  console.error('legacy Fun Zone department should be renamed to Fun Station');
  fail++;
}
if (layout.departments && layout.departments['Fun Station']) {
  const t = layout.departments['Fun Station'].target;
  if (t && t[0] === 6 && t[2] === 12) {
    console.error('Fun Station department still aimed at old interior Fun Zone');
    fail++;
  }
}

// Default desks are 2.85 x 1.28; needs-steve command desk can override via workstations.
const DESK_W = 2.85, DESK_D = 1.28, DESK_Z_OFFSET = 0.9, MIN_CLEARANCE = 1.2;
function deskSize(id) {
  const ws = (layout.workstations && layout.workstations[id]) || {};
  return {
    w: Number(ws.deskW) || DESK_W,
    d: Number(ws.deskD) || DESK_D,
    rot: Number(ws.rotation) || 0
  };
}
function deskAabb(id) {
  const seat = layout.seats[id];
  const s = deskSize(id);
  // π/2 and 3π/2 swap local width/depth onto world XZ.
  const rot = ((s.rot % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  const quarter = Math.abs(rot - Math.PI / 2) < 0.2 || Math.abs(rot - 3 * Math.PI / 2) < 0.2;
  const halfX = (quarter ? s.d : s.w) / 2;
  const halfZ = (quarter ? s.w : s.d) / 2;
  let cx = seat.x;
  let cz = seat.z;
  if (quarter) {
    // Desk origin is the seat; local -Z offset maps onto ±X.
    const sign = Math.abs(rot - Math.PI / 2) < 0.2 ? 1 : -1;
    cx = seat.x + sign * DESK_Z_OFFSET * 0; // keep origin at seat for command desks
  } else {
    // Historical clearance model: desk center 0.9m along -world-Z from seat.
    cz = seat.z - DESK_Z_OFFSET;
  }
  return { cx, cz, halfX, halfZ, w: halfX * 2, d: halfZ * 2 };
}
// Fun Wing must not overlap seat desk AABBs.
if (layout.funWing) {
  const fw = layout.funWing;
  const fwHalfW = fw.width / 2, fwHalfD = fw.depth / 2;
  Object.keys(layout.seats).forEach(id => {
    const box = deskAabb(id);
    const gapX = Math.max(0, Math.abs(box.cx - fw.centerX) - (box.w / 2 + fwHalfW));
    const gapZ = Math.max(0, Math.abs(box.cz - fw.centerZ) - (box.d / 2 + fwHalfD));
    if (gapX < 1e-6 && gapZ < 1e-6) {
      console.error(`funWing overlaps desk ${id}`);
      fail++;
    }
  });
}
// Leadership shares the meeting table instead of owning desks.
const TABLE_ONLY = ['supervisor', 'pm', 'ba'];
const deskIds = required.filter(id => !TABLE_ONLY.includes(id));
deskIds.forEach((id, i) => {
  deskIds.slice(i + 1).forEach(other => {
    const a = deskAabb(id), b = deskAabb(other);
    const gapX = Math.max(0, Math.abs(a.cx - b.cx) - (a.w + b.w) / 2);
    const gapZ = Math.max(0, Math.abs(a.cz - b.cz) - (a.d + b.d) / 2);
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
    const box = deskAabb(id);
    const inside = box.cx - box.halfX >= zone.x - zone.w / 2 && box.cx + box.halfX <= zone.x + zone.w / 2
      && box.cz - box.halfZ >= zone.z - zone.d / 2 && box.cz + box.halfZ <= zone.z + zone.d / 2;
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
