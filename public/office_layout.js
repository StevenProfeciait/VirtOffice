/**
 * TEVA HQ floor plan — keep seat ids in sync with scripts/teva_sync.py ROSTER (+ needs-steve).
 * Loaded before office.html main script; exposed as OFFICE_LAYOUT / LAYOUT.
 */
(function (root) {
  'use strict';
  var W = 72;
  var D = 54;
  var H = 4.2;
  var halfW = W / 2;
  var halfD = D / 2;
  var meetZ = -15.5;

  var layout = {
    room: { width: W, depth: D, wallHeight: H },
    fog: { color: 0x0a0d14, near: 40, far: 120 },
    exterior: { groundSize: 280, plazaWidth: 28, skylineCount: 16 },
    seats: {
      supervisor: { x: 22, z: -7.4 },
      pm: { x: 26, z: -7.0 },
      ba: { x: 30, z: -7.4 },
      le: { x: 7.8, z: -3.0 },
      le2: { x: 12, z: -3.0 },
      sa: { x: 16.2, z: -3.0 },
      debugger: { x: 12, z: 0.5 },
      'research-mgr': { x: -15, z: -7.6 },
      'ai-research': { x: -17.5, z: -2.8 },
      'erp-research': { x: -12.5, z: -2.8 },
      product: { x: -5.6, z: 6.6 },
      competitor: { x: -1, z: 6.6 },
      'ui-docs': { x: 3.6, z: 6.6 },
      grok: { x: 15.5, z: 8 },
      'needs-steve': { x: -22, z: -20.5 }
    },
    meetingSpaces: {
      main: { id: 'main', x: 0, z: meetZ, radius: 3, chairs: 6, label: 'ALL-HANDS', labelColor: '#8B5CF6', roles: ['default'] },
      leadership: { id: 'leadership', x: 26, z: -4.8, radius: 2.2, chairs: 4, label: 'LEADERSHIP', labelColor: '#8B5CF6', agentIds: ['supervisor', 'pm', 'ba'] },
      engineering: { id: 'engineering', x: 11, z: meetZ, radius: 2.2, chairs: 4, label: 'ENG STANDUP', labelColor: '#EF4444', agentIds: ['le', 'le2', 'sa', 'debugger'] },
      research: { id: 'research', x: -33, z: 0.5, radius: 2.2, chairs: 3, label: 'RESEARCH LAB', labelColor: '#3B82F6', agentIds: ['research-mgr', 'ai-research', 'erp-research'] },
      business: { id: 'business', x: 30, z: 2.5, radius: 2.2, chairs: 3, label: 'BUSINESS SUITE', labelColor: '#10B981', agentIds: ['product', 'competitor', 'ui-docs'] },
      briefing: { id: 'briefing', x: -18, z: 21, radius: 2, chairs: 4, label: 'BRIEFING', labelColor: '#A78BFA', agentIds: [] },
      innovation: { id: 'innovation', x: 26, z: 11, radius: 2, chairs: 4, label: 'INNOVATION', labelColor: '#22D3EE', agentIds: [] },
      simulation: { id: 'simulation', x: -26, z: 11, radius: 2, chairs: 4, label: 'SIMULATION', labelColor: '#A78BFA', agentIds: [] },
      boardroom: {
        id: 'boardroom', x: 0, z: -4, radius: 4.2, chairs: 15, label: 'BOARDROOM',
        labelColor: '#6366F1', agentIds: [], type: 'boardroom', tableW: 10.8, tableD: 2.2
      },
      fun: { id: 'fun', x: halfW + 10, z: 12, radius: 0, chairs: 0, label: 'FUN STATION', labelColor: '#F472B6', agentIds: [], type: 'fun' }
    },
    zones: [
      { name: 'Leadership', color: '#8B5CF6', x: 26, z: -6, w: 12, d: 9 },
      { name: 'Boardroom', color: '#6366F1', x: 0, z: -4, w: 5.2, d: 13.5 },
      { name: 'Engineering', color: '#EF4444', x: 12.2, z: -1.8, w: 13.2, d: 6.5 },
      { name: 'Research', color: '#3B82F6', x: -15, z: -4.8, w: 14.8, d: 9.2 },
      { name: 'Business', color: '#10B981', x: -1, z: 5.5, w: 14.4, d: 3.8, signZ: 4.4 },
      { name: 'Ingest', color: '#F59E0B', x: 15.5, z: 6.4, w: 4.6, d: 4, signZ: 5.8 },
      { name: 'Needs Steve', color: '#FF3B30', x: -22, z: -20.5, w: 11, d: 9.5 },
      { name: 'Fun Station', color: '#F472B6', x: halfW + 10, z: 12, w: 20, d: 26 },
      { name: 'Innovation Lab', color: '#22D3EE', x: 26, z: 11, w: 11.5, d: 11.5 },
      { name: 'Simulation Bay', color: '#A78BFA', x: -26, z: 11, w: 16, d: 11.5 },
      { name: 'Cyber Lounge', color: '#C026D3', x: 20, z: 23, w: 18, d: 9 },
      { name: 'Collab Terrace', color: '#38BDF8', x: 0, z: halfD + 12, w: 48, d: 18 },
      { name: 'Research Collab', color: '#60A5FA', x: -33, z: 0.5, w: 5.5, d: 3.8 },
      { name: 'Business Collab', color: '#34D399', x: 30, z: 2.5, w: 5.5, d: 3.8 }
    ],
    dividers: [
      { x: -8, z: -4.2, w: 0.12, d: 10, rot: 0, type: 'glass', h: 1.4 },
      { x: 5.5, z: -0.5, w: 0.12, d: 12, rot: 0, type: 'glass', h: 1.35 },
      { x: -15, z: -5.2, w: 12, d: 0.35, rot: 0, type: 'shelf', h: 1.1 }
    ],
    anchors: {
      meeting: { x: 0, z: meetZ },
      server: { x: -halfW + 6, z: -halfD + 4.5 },
      kitchen: { x: -halfW + 4, z: halfD - 4 },
      lounge: { x: 8, z: 11.5 },
      funZone: { x: halfW + 10, z: 12 },
      pingPong: { x: halfW + 10, z: 10 },
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
      ],
      innovationLab: { x: 26, z: 11 },
      simulationBay: { x: -26, z: 11 },
      leadershipBay: { x: 26, z: -6 },
      briefingRoom: { x: -18, z: 21 },
      commandDeck: { x: 0, z: 20 },
      cyberLounge: { x: 20, z: 23 },
      researchCollab: { x: -33, z: 0.5 },
      businessCollab: { x: 30, z: 2.5 },
      engStandup: { x: 11, z: meetZ },
      leadershipStandup: { x: 26, z: -4.8 },
      boardroom: { x: 0, z: -4 },
      researchMgrOffice: { x: -15, z: -7.6 },
      steveCommand: { x: -22, z: -20.5 }
    },
    wing: {
      centerX: 0,
      centerZ: halfD + 9,
      width: 52,
      depth: 20,
      floorY: 0,
      hotDesks: [
        { x: -13.5, z: 0 }, { x: -6.75, z: 0 }, { x: 0, z: 0 }, { x: 6.75, z: 0 }, { x: 13.5, z: 0 }
      ],
      lounge: { x: -14, z: 5 },
      whiteboard: { x: 14, z: 4 },
      digitalWall: { x: 14, z: 4.5 },
      huddle: { x: 0, z: 4 },
      coffeeCart: { x: 0, z: -8.5 },
      planters: [[-18, -7], [18, -7], [-18, 7], [18, 7], [0, 8]]
    },
    funWing: {
      centerX: halfW + 10,
      centerZ: 12,
      width: 22,
      depth: 28,
      floorY: 0,
      arcadeRow: { x: 0, z: -6 },
      gameArena: { x: 0, z: 0 },
      chillPit: { x: -5, z: 8 },
      snackStrip: { x: 0, z: -11 },
      corridor: { x: -11, z: 0 },
      pingPong: { x: -2.5, z: 0 },
      foosball: { x: 3.2, z: 0 },
      idleSpots: [
        { id: 'idle-1', x: -7, z: 8, pose: 'sofa' },
        { id: 'idle-2', x: -4, z: 9, pose: 'sofa' },
        { id: 'idle-3', x: 5, z: -5, pose: 'arcade' },
        { id: 'idle-4', x: 7, z: -5, pose: 'arcade' },
        { id: 'idle-5', x: 4, z: 3, pose: 'stool' },
        { id: 'idle-6', x: -1, z: 8, pose: 'beanbag' }
      ]
    },
    camera: {
      main: { target: [0, 0, 2], zoom: 1.02, rotation: -Math.PI / 4 },
      wing: { target: [0, 0, halfD + 9], zoom: 1.02, rotation: -Math.PI / 5 },
      fun: { target: [halfW + 10, 0, 12], zoom: 1.05, rotation: -Math.PI / 3 }
    },
    demoHomes: {
      meeting: { x: 0, z: meetZ },
      left: { x: -14, z: -2.5 },
      center: { x: 0, z: 0 },
      right: { x: 16.2, z: 0.5 },
      right2: { x: 20, z: 8 }
    },
    workstations: {
      supervisor: { accent: '#8B5CF6', style: 'executive', rotation: Math.PI },
      pm: { accent: '#8B5CF6', style: 'executive', rotation: Math.PI },
      ba: { accent: '#8B5CF6', style: 'standard', rotation: Math.PI },
      le: { accent: '#10B981', style: 'gaming', rotation: 0 },
      le2: { accent: '#10B981', style: 'gaming', rotation: 0 },
      sa: { accent: '#EF4444', style: 'gaming', rotation: 0 },
      debugger: { accent: '#EF4444', style: 'standard', rotation: Math.PI },
      'research-mgr': { accent: '#3B82F6', style: 'standard', rotation: Math.PI },
      'ai-research': { accent: '#3B82F6', style: 'standard', rotation: 0 },
      'erp-research': { accent: '#3B82F6', style: 'standard', rotation: 0 },
      product: { accent: '#10B981', style: 'standard', rotation: Math.PI },
      competitor: { accent: '#10B981', style: 'standard', rotation: Math.PI },
      'ui-docs': { accent: '#6366F1', style: 'standard', rotation: Math.PI },
      grok: { accent: '#F59E0B', style: 'gaming', rotation: Math.PI },
      'needs-steve': {
        accent: '#FF3B30',
        style: 'command',
        rotation: Math.PI / 2,
        deskW: 4.4,
        deskD: 1.7,
        // typing fix (2026-10-23): on the command chair (local z -1.05) in front of the 1.7 m desk; was z 0.15,
        // the middle of the desk
        agentLocal: { x: 0, z: -1.05 },
        seatHeight: 0.55
      },
      meeting: { accent: '#8B5CF6', style: 'collab', rotation: 0, seatHeight: 0.55 }, // typing fix: default seat (was z 0.2, inside the desk)
      left: { accent: '#3B82F6', style: 'standard', rotation: 0 },
      center: { accent: '#EC4899', style: 'standard', rotation: 0 },
      right: { accent: '#F59E0B', style: 'standard', rotation: Math.PI },
      right2: { accent: '#10B981', style: 'gaming', rotation: Math.PI }
    },
    navPoints: {
      meeting: { x: 0, z: meetZ },
      leadershipStandup: { x: 26, z: -4.8 },
      leadershipBay: { x: 26, z: -6 },
      engHuddle: { x: 11, z: meetZ },
      researchHuddle: { x: -33, z: 0.5 },
      businessHuddle: { x: 30, z: 2.5 },
      fun: { x: halfW + 10, z: 12 },
      lounge: { x: 8, z: 11.5 },
      kitchen: { x: -halfW + 4, z: halfD - 4 },
      collab: { x: 0, z: halfD + 9 },
      innovation: { x: 26, z: 11 },
      simulation: { x: -26, z: 11 },
      briefing: { x: -18, z: 21 },
      command: { x: 0, z: 20 },
      boardroom: { x: 0, z: -4 }
    },
    expansionStations: [
      { x: 24, z: 7, rotation: 0, color: '#22D3EE', style: 'gaming' },
      { x: 28, z: 7, rotation: 0, color: '#22D3EE', style: 'standard' },
      { x: -24, z: 7, rotation: Math.PI, color: '#A78BFA', style: 'standard' },
      { x: -28, z: 7, rotation: Math.PI, color: '#A78BFA', style: 'gaming' },
      { x: 24, z: 17, rotation: Math.PI, color: '#C026D3', style: 'standard' },
      { x: 28, z: 17, rotation: Math.PI, color: '#C026D3', style: 'standard' }
    ],
    departments: {
      Leadership: { target: [26, 0, -6], zoom: 1.28 },
      Engineering: { target: [12, 0, -2.5], zoom: 1.28 },
      Research: { target: [-15, 0, -4.8], zoom: 1.22 },
      Business: { target: [-1, 0, 6.6], zoom: 1.3 },
      Ingest: { target: [15.5, 0, 8], zoom: 1.32 },
      'Needs Steve': { target: [-22, 0, -20.5], zoom: 1.15 },
      'Fun Station': { target: [halfW + 10, 0, 12], zoom: 1.08 },
      'Collab Terrace': { target: [0, 0, halfD + 9], zoom: 1.05 },
      'Innovation Lab': { target: [26, 0, 11], zoom: 1.25 },
      'Simulation Bay': { target: [-26, 0, 11], zoom: 1.25 },
      'Research Collab': { target: [-33, 0, 0.5], zoom: 1.28 },
      'Business Collab': { target: [30, 0, 2.5], zoom: 1.28 },
      Boardroom: { target: [0, 0, -4], zoom: 1.22 }
    },
    collabPresets: {
      main: { target: [0, 0, meetZ], zoom: 1.22 },
      leadership: { target: [26, 0, -4.8], zoom: 1.3 },
      engineering: { target: [11, 0, meetZ], zoom: 1.28 },
      research: { target: [-33, 0, 0.5], zoom: 1.28 },
      business: { target: [30, 0, 2.5], zoom: 1.28 },
      fun: { target: [halfW + 10, 0, 12], zoom: 1.1 },
      briefing: { target: [-18, 0, 21], zoom: 1.22 },
      innovation: { target: [26, 0, 11], zoom: 1.22 },
      simulation: { target: [-26, 0, 11], zoom: 1.22 },
      boardroom: { target: [0, 0, -4], zoom: 1.2 }
    }
  };

  layout.meetingZ = meetZ;
  layout.halfW = halfW;
  layout.halfD = halfD;

  root.OFFICE_LAYOUT = layout;
  root.LAYOUT = layout;
})(typeof window !== 'undefined' ? window : global);
