/**
 * TEVA HQ floor plan — keep seat ids in sync with scripts/teva_sync.py ROSTER (+ needs-steve).
 * Loaded before office.html main script; exposed as OFFICE_LAYOUT / LAYOUT.
 */
(function (root) {
  'use strict';
  var W = 52;
  var D = 36;
  var H = 3.2;
  var halfW = W / 2;
  var halfD = D / 2;
  var meetZ = -halfD + 8.5;

  var layout = {
    room: { width: W, depth: D, wallHeight: H },
    fog: { color: 0x0a0d14, near: 40, far: 120 },
    exterior: { groundSize: 220, plazaWidth: 10, skylineCount: 10 },
    /** Seat id -> standing position (home in agents.json matches id) */
    seats: {
      supervisor: { x: -3.2, z: -6.2 },
      pm: { x: 0, z: -5.6 },
      ba: { x: 3.2, z: -6.2 },
      le: { x: 8.5, z: -3 },
      le2: { x: 12, z: -3 },
      sa: { x: 15.5, z: -3 },
      debugger: { x: 12, z: 2.8 },
      'research-mgr': { x: -16.5, z: -2.2 },
      'ai-research': { x: -12.5, z: -2.2 },
      'erp-research': { x: -8.5, z: -2.2 },
      product: { x: -5.5, z: 5 },
      competitor: { x: -1.5, z: 5 },
      'ui-docs': { x: 2.5, z: 5 },
      grok: { x: 16, z: 4.5 },
      'needs-steve': { x: -7.5, z: 11.5 }
    },
    zones: [
      { name: 'Leadership', color: '#8B5CF6', x: 0, z: -halfD + 3.2, w: 14, d: 8 },
      { name: 'Engineering', color: '#EF4444', x: 12, z: -5.5, w: 16, d: 12 },
      { name: 'Research', color: '#3B82F6', x: -12.5, z: -5, w: 16, d: 11 },
      { name: 'Business', color: '#10B981', x: -1.5, z: 2.5, w: 14, d: 9 },
      { name: 'Ingest', color: '#F59E0B', x: 16, z: 6, w: 8, d: 7 },
      { name: 'Needs Steve', color: '#FF3B30', x: -7.5, z: 13, w: 12, d: 6 }
    ],
    dividers: [
      { x: -6.5, z: -3.5, w: 0.12, d: 10, rot: 0, type: 'glass', h: 1.4 },
      { x: 5.5, z: 0, w: 0.12, d: 12, rot: 0, type: 'glass', h: 1.35 },
      { x: -2, z: 1.5, w: 8, d: 0.35, rot: 0, type: 'shelf', h: 1.1 }
    ],
    anchors: {
      meeting: { x: 0, z: meetZ },
      server: { x: -halfW + 6, z: -halfD + 4.5 },
      kitchen: { x: -halfW + 4, z: halfD - 4 },
      lounge: { x: 12, z: 10 },
      pingPong: [[halfW - 4.5, -halfD + 12], [halfW - 4.5, -halfD + 16]],
      phoneBoothX: -halfW + 2.5,
      bookshelf: { x: -halfW + 2.5, z: -halfD + 10 },
      waterCooler: { x: -halfW + 3, z: -halfD + 11 },
      welcomeMat: { x: 0, z: halfD - 1.2 },
      whiteboard: { x: -5, z: -halfD + 0.35 },
      boardScreen: { x: -5, y: 1.7, z: -halfD + 0.3 },
      doorway: { z: halfD, width: 7 },
      plantRing: [
        [-halfW + 1.2, -halfD + 1.2],
        [halfW - 1.5, -halfD + 1.8],
        [-halfW + 1.5, halfD - 2],
        [halfW - 2.5, halfD - 2],
        [0, halfD - 2.2]
      ]
    },
    wing: {
      centerX: 0,
      centerZ: halfD + 11,
      width: 44,
      depth: 20,
      floorY: 0,
      hotDesks: [
        { x: -12, z: 0 }, { x: -6, z: 0 }, { x: 0, z: 0 }, { x: 6, z: 0 }, { x: 12, z: 0 }
      ],
      lounge: { x: -14, z: 6 },
      whiteboard: { x: 14, z: 5 }
    },
    camera: {
      main: { target: [0, 0, 0], zoom: 1.18, rotation: -Math.PI / 4 },
      wing: { target: [0, 0, halfD + 11], zoom: 1.05, rotation: -Math.PI / 5 }
    },
    demoHomes: {
      meeting: { x: 0, z: meetZ },
      left: { x: -14, z: -2.5 },
      center: { x: -5, z: 0.5 },
      right: { x: 6, z: -1 },
      right2: { x: 11, z: 2.5 }
    },
    /** Per-seat workstation overrides (origin = seat x/z; agentLocal from manifest defaults). */
    workstations: {
      supervisor: { accent: '#8B5CF6', style: 'executive', rotation: 0 },
      pm: { accent: '#8B5CF6', style: 'executive', rotation: 0 },
      ba: { accent: '#8B5CF6', style: 'standard', rotation: 0 },
      le: { accent: '#10B981', style: 'gaming', rotation: 0 },
      le2: { accent: '#10B981', style: 'gaming', rotation: 0 },
      sa: { accent: '#EF4444', style: 'gaming', rotation: 0 },
      debugger: { accent: '#F59E0B', style: 'standard', rotation: Math.PI },
      'research-mgr': { accent: '#3B82F6', style: 'standard', rotation: 0 },
      'ai-research': { accent: '#3B82F6', style: 'standard', rotation: 0 },
      'erp-research': { accent: '#3B82F6', style: 'standard', rotation: 0 },
      product: { accent: '#10B981', style: 'standard', rotation: Math.PI },
      competitor: { accent: '#EC4899', style: 'standard', rotation: Math.PI },
      'ui-docs': { accent: '#6366F1', style: 'standard', rotation: Math.PI },
      grok: { accent: '#F59E0B', style: 'gaming', rotation: Math.PI },
      'needs-steve': { accent: '#FF3B30', style: 'standard', rotation: 0 },
      meeting: { accent: '#8B5CF6', style: 'collab', rotation: 0, agentLocal: { x: 0, z: 0.2 }, seatHeight: 0.55 },
      left: { accent: '#3B82F6', style: 'standard', rotation: 0 },
      center: { accent: '#EC4899', style: 'standard', rotation: 0 },
      right: { accent: '#F59E0B', style: 'standard', rotation: 0 },
      right2: { accent: '#10B981', style: 'gaming', rotation: 0 }
    },
    navPoints: {
      meeting: { x: 0, z: meetZ },
      lounge: { x: 12, z: 10 },
      kitchen: { x: -halfW + 4, z: halfD - 4 },
      collab: { x: 0, z: halfD + 11 }
    },
    departments: {
      Leadership: { target: [0, 0, -8], zoom: 1.35 },
      Engineering: { target: [12, 0, -3], zoom: 1.28 },
      Research: { target: [-12.5, 0, -2], zoom: 1.28 },
      Business: { target: [-1.5, 0, 5], zoom: 1.3 },
      Ingest: { target: [16, 0, 5], zoom: 1.32 },
      'Needs Steve': { target: [-7.5, 0, 11.5], zoom: 1.25 }
    }
  };

  layout.meetingZ = meetZ;
  layout.halfW = halfW;
  layout.halfD = halfD;

  root.OFFICE_LAYOUT = layout;
  root.LAYOUT = layout;
})(typeof window !== 'undefined' ? window : global);
