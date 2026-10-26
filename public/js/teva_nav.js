/* TEVA HQ walking routes around furniture (2026-10-22 part 2, Steve: "nobody walks straight through objects").
 *
 * Pure (no THREE / DOM): a 0.5 m occupancy grid over the main floor, the Fun Wing and the collab terrace, built from
 * the real floor plan (public/office_layout.js) plus the desks the active look draws (office.html passes them in:
 * legacy desks in Classic, modular workstations in Cyberpunk). Walls between the areas are solid except the real
 * openings (the Fun Wing glass corridor and the terrace doorway, the same ones TevaAmbient.route uses). A* (8-way)
 * then string-pulling gives a few corner waypoints. Furniture is inflated by the avatar radius. Start / goal cells
 * that sit inside furniture (a chair tucked under a desk) are allowed: the last step goes straight to the chair.
 *
 * Nav recovery (2026-10-23, Steve: route failures must never cross obstacles or loop):
 *  - plan(from, to) -> {ok, pts, reason, snapped, escaped}. Never adds an unchecked final leg: the last / first
 *    step into a seat may only enter soft furniture (sofa, desk chair side) by SEAT_DEPTH and never a wall, glass,
 *    pod or rack ("hard" rects). A blocked goal snaps to the nearest reachable free cell within SNAP_MAX, else
 *    reason 'goal-blocked'; different connected areas -> 'no-path'. path() = plan().pts or null (no fallback).
 *  - RouteGuard: per-seat bounded retry with backoff (1, 2, 4 s, then give up) and diagnostics counters; a gave-up
 *    target is only re-planned when the target, the start area or the grid version changes (recovery).
 *  - addObstacle / removeObstacle (version counter) for temporary blocking; reachable(a, b) / componentAt(p).
 *  - furniture(L, {look}) adds the props the audit (tests/nav_audit_browser.py) found rendered but not solid;
 *    look 'classic' | 'cyber' keeps look-only props (cyber pods, command deck, cyber lounge) out of the other look.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TevaNav = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var CELL = 0.5, RADIUS = 0.3, SMALL_PAD = 0.2;
  /** Thin glass (visual ~0.05–0.12 m) gets this min axis so the 0.5 m grid never skips it. */
  var MIN_GLASS = 0.35;
  /** Fun Wing east-wall opening half-width — matches buildFunWing corridor glass at cz ± 3.2. */
  var FUN_OPEN = 3.0;

  function finite(p) { return !!p && isFinite(Number(p.x)) && isFinite(Number(p.z)); }
  function thick(w, d) {
    return { w: Math.max(Number(w) || 0, MIN_GLASS), d: Math.max(Number(d) || 0, MIN_GLASS) };
  }

  /** Furniture rectangles {x, z, w (along local x), d (along local z), rot} from the floor plan. */
  function furniture(L, opts) {
    opts = opts || {};
    var out = [], look = opts.look || 'all';
    function rect(x, z, w, d, rot, tag) { if (isFinite(x) && isFinite(z)) out.push({ x: Number(x), z: Number(z), w: Number(w), d: Number(d), rot: Number(rot) || 0, tag: tag || '' }); }
    // small props an avatar may brush past (plants, stools, posts): inflated by SMALL_PAD instead of the full radius
    function small(x, z, radius, tag) { round(x, z, radius, tag); out[out.length - 1].pad = SMALL_PAD; out[out.length - 2].pad = SMALL_PAD; }
    // round props (createCollabTable cylinders, ottomans, plant pots): square + 45-degree square = octagon around the disc
    function round(x, z, radius, tag) { rect(x, z, 2 * radius, 2 * radius, 0, tag); rect(x, z, 2 * radius, 2 * radius, Math.PI / 4, tag); }
    var ms = (L && L.meetingSpaces) || {};
    Object.keys(ms).forEach(function (k) {
      var s = ms[k];
      if (!s || s.type === 'fun') return;
      // Innovation / Simulation: full cyber-pod footprints below (not the small collab-table rect) - Cyberpunk only;
      // Classic draws no pod there, just the collab table (nav recovery audit: 14x9 / 12x8 phantom solids in Classic)
      if ((s.id === 'innovation' || s.id === 'simulation') && look !== 'classic') return;
      if (s.type === 'boardroom') rect(s.x, s.z, Number(s.tableD) || 2, Number(s.tableW) || 7.2, 0, 'boardroom table');
      else { var r = s.id === 'main' ? 2.45 : Math.max(1.15, (Number(s.radius) || 2) * 0.55); round(s.x, s.z, r, 'table ' + k); }
    });
    ((L && L.dividers) || []).forEach(function (d) {
      var t = thick(d.w, d.d);
      // glass dividers: inflate the thin axis only so long walls stay long
      var gw = d.type === 'glass' ? (Number(d.w) < Number(d.d) ? Math.max(Number(d.w), MIN_GLASS) : Number(d.w)) : Number(d.w);
      var gd = d.type === 'glass' ? (Number(d.d) < Number(d.w) ? Math.max(Number(d.d), MIN_GLASS) : Number(d.d)) : Number(d.d);
      if (d.type !== 'glass') { gw = t.w; gd = t.d; }
      rect(d.x, d.z, gw, gd, d.rot, 'divider');
    });
    var a = (L && L.anchors) || {};
    if (finite(a.kitchen)) { rect(a.kitchen.x, a.kitchen.z, 4.1, 1.2, 0, 'kitchen counter'); rect(Number(a.kitchen.x) + 2.2, Number(a.kitchen.z) - 1.2, 1.05, 0.85, 0, 'fridge'); }
    if (finite(a.lounge)) { var lx = Number(a.lounge.x), lz = Number(a.lounge.z); rect(lx, lz - 0.1, 3.2, 0.6, 0, 'sofa'); rect(lx + 1.55, lz + 0.9, 0.6, 1.8, 0, 'sofa'); rect(lx - 0.7, lz + 1.1, 1.1, 1.1, 0, 'coffee table'); }
    // Cyberpunk pods (createCyberPod sizes) — full footprint so paths do not walk under the canopy
    if (finite(a.simulationBay) && look !== 'classic') rect(a.simulationBay.x, a.simulationBay.z, 14, 9, 0, 'simulation bay');
    if (finite(a.innovationLab) && look !== 'classic') rect(a.innovationLab.x, a.innovationLab.z, 12, 8, 0, 'innovation lab');
    // Server room glass enclosure (createServerRoom)
    if (finite(a.server)) {
      var sx = Number(a.server.x), sz = Number(a.server.z);
      rect(sx + 2.6, sz, MIN_GLASS, 6, 0, 'server glass');
      rect(sx, sz + 2.8, 4.8, MIN_GLASS, 0, 'server glass');
      rect(sx - 0.2, sz + 1.0, 3.6, 2.4, 0, 'server racks');
    }
    // Phone booths (createPhoneBooths positions: east wall)
    var roomW = (L && L.room && L.room.width) || 72, roomD = (L && L.room && L.room.depth) || 54;
    [[roomW / 2 - 4, -roomD / 2 + 12], [roomW / 2 - 4, -roomD / 2 + 16]].forEach(function (p, i) {
      rect(p[0], p[1], 1.55, 1.55, 0, 'phone booth ' + (i + 1));
    });
    var fw = L && L.funWing;
    if (fw && finite({ x: fw.centerX, z: fw.centerZ })) {
      var cx = Number(fw.centerX), cz = Number(fw.centerZ);
      var halfW = Number(fw.width) / 2, halfD = Number(fw.depth) / 2;
      var ar = fw.arcadeRow || { x: 0, z: -6 }, pp = fw.pingPong || { x: -2.5, z: 0 }, fb = fw.foosball || { x: 3.2, z: 0 }, sn = fw.snackStrip || { x: 0, z: -11 }, ch = fw.chillPit || { x: -5, z: 8 };
      for (var i = 0; i < 5; i++) rect(cx + Number(ar.x) - 6 + i * 3, cz + Number(ar.z) + 0.2, 1.15, 1.25, 0, 'arcade cabinet');
      rect(cx + Number(pp.x), cz + Number(pp.z), 2.8, 1.5, 0, 'ping pong table');
      rect(cx + Number(fb.x), cz + Number(fb.z), 2.2, 1.4, 0, 'foosball table');
      [-1.4, 1.4].forEach(function (dx) { rect(cx + Number(sn.x) + dx, cz + Number(sn.z), 1.1, 0.7, 0, 'vending machine'); });
      rect(cx + Number(sn.x), cz + Number(sn.z) + 2.2, 1.15, 0.5, 0, 'snack cart');
      rect(cx + Number(ch.x), cz + Number(ch.z) - 0.25, 3.0, 0.5, 0, 'chill pit sofa back');
      // Fun Wing perimeter glass (buildFunWing N/S walls + east rail)
      var wallLen = Math.max(2, Number(fw.width) - 1.5);
      [-1, 1].forEach(function (side) {
        rect(cx, cz + side * (halfD - 0.4), wallLen, MIN_GLASS, 0, 'fun wing glass');
      });
      rect(cx + halfW - 0.15, cz, MIN_GLASS, Math.max(2, Number(fw.depth) - 2.2), 0, 'fun wing rail');
      // Corridor side glass outside the east-wall opening (visual at cz ± 3.2)
      var hw = roomW / 2;
      var corrLen = Math.max(2.5, (cx - halfW) - hw + 0.5);
      var corrMidX = hw + corrLen / 2;
      [-1, 1].forEach(function (side) {
        rect(corrMidX, cz + side * 3.2, corrLen, MIN_GLASS, 0, 'fun corridor glass');
      });
    }
    var w = L && L.wing;
    if (w && finite({ x: w.centerX, z: w.centerZ })) {
      var wx = Number(w.centerX), wz = Number(w.centerZ), wl = w.lounge || { x: -14, z: 5 }, hd = w.huddle || { x: 0, z: 4 }, cc = w.coffeeCart || { x: 0, z: -8.5 };
      rect(wx + Number(wl.x), wz + Number(wl.z) - 0.2, 3.4, 0.6, 0, 'terrace sofa');
      rect(wx + Number(hd.x), wz + Number(hd.z), 2.0, 2.0, 0, 'huddle table');
      rect(wx + Number(cc.x), wz + Number(cc.z), 1.2, 0.55, 0, 'coffee cart');
      (w.hotDesks || []).forEach(function (h) { rect(wx + Number(h.x), wz + Number(h.z), 1.85, 1.05, 0, 'hot desk'); });
    }
    (opts.desks || []).forEach(function (d) { rect(d.x, d.z, d.w || 2.5, d.d || 1.15, d.rot, d.tag || 'desk'); });
    props(L, look, rect, round, small);
    return out;
  }

  /** Nav recovery audit (2026-10-23): props office.html renders in the avatar body band (0.15-1.6 m) that were not
   *  solid, with their real sizes / positions (createX functions named per block). look: 'classic' | 'cyber' | 'all'. */
  function props(L, look, rect, round, small) {
    var a = (L && L.anchors) || {}, hw = (L && L.room ? L.room.width : 72) / 2, hd = (L && L.room ? L.room.depth : 54) / 2, cyber = look !== 'classic';
    function pod(o, w, d, tag) { // createCyberPod: 4 corner posts + back glass at +z (front open, canopy at 2.8 m)
      if (!finite(o)) return;
      var x = Number(o.x), z = Number(o.z);
      rect(x, z + d / 2, w, MIN_GLASS, 0, tag + ' back glass');
      [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (c) { small(x + c[0] * w / 2, z + c[1] * d / 2, 0.1, tag + ' post'); });
    }
    // plants (createPlants pots + bay plants + terrace planters), pot radius 0.28
    var pots = ((a.plantRing || []).concat([[-8, -8], [12, -6], [5, -9], [-12, 7], [18, 5]]));
    pots.forEach(function (p) { small(p[0], p[1], 0.3, 'plant'); });
    if (finite(a.bookshelf)) rect(a.bookshelf.x, a.bookshelf.z, 1.0, 0.4, 0, 'bookshelf');
    if (finite(a.waterCooler)) small(a.waterCooler.x, a.waterCooler.z, 0.36, 'water cooler');
    // createLounge (main-floor lounge): sofa 3.2 x 0.85 (+ back), side sofa 0.85 x 2.2, coffee table r 0.58, TV
    if (finite(a.lounge)) {
      var lx = Number(a.lounge.x), lz = Number(a.lounge.z);
      rect(lx, lz - 0.03, 3.2, 0.97, 0, 'sofa'); rect(lx + 1.55, lz + 0.7, 0.85, 2.2, 0, 'sofa');
      round(lx - 0.7, lz + 1.1, 0.58, 'coffee table'); rect(lx - 2.8, lz + 2.22, 2.0, MIN_GLASS, 0, 'lounge tv');
    }
    // createLeadershipBay (both looks): pod 12 x 9, credenzas, holo screen
    var lb = a.leadershipBay;
    if (finite(lb)) {
      pod(lb, 12, 9, 'leadership pod');
      [-3.4, 3.4].forEach(function (dx) { rect(Number(lb.x) + dx, Number(lb.z) + 2.6, 2.62, 0.58, 0, 'leadership credenza'); });
      rect(lb.x, Number(lb.z) - 3.85, 3.4, MIN_GLASS, 0, 'leadership holo screen');
    }
    // createResearchMgrOffice (both looks): pod 8 x 5.5, board, side table + stools, shelf, ottoman, plants
    var ro = a.researchMgrOffice;
    if (finite(ro)) {
      var ox = Number(ro.x), oz = Number(ro.z);
      pod(ro, 8, 5.5, 'research office pod');
      rect(ox, oz - 2.55, 3.75, MIN_GLASS, 0, 'research office board');
      round(ox + 2.2, oz + 0.4, 0.58, 'research office table');
      [[2.2, 1.15], [2.85, 0.15]].forEach(function (p) { small(ox + p[0], oz + p[1], 0.24, 'research office stool'); });
      rect(ox - 3.2, oz + 0.2, 0.4, 2.4, 0, 'research office shelf');
      round(ox - 1.8, oz + 1.6, 0.5, 'research office ottoman');
      small(ox + 3.1, oz - 1.6, 0.3, 'plant'); small(ox - 2.6, oz - 1.8, 0.3, 'plant');
    }
    // createSteveCommandBay (both looks): screen wall, stand-up table + 3 seats, sofa, coffee table, racks, bar, posts, plants
    var sc = a.steveCommand;
    if (finite(sc)) {
      var sx = Number(sc.x), sz = Number(sc.z), mx = sx + 3.4, mz = sz + 0.3;
      rect(sx, sz - 3.6, 5.6, MIN_GLASS, 0, 'steve bay screen wall');
      rect(mx, mz, 1.65, 1.1, 0, 'steve bay table');
      [[-0.7, 0.85], [0.7, 0.85], [0, -0.95]].forEach(function (p) { rect(mx + p[0], mz + p[1], 0.5, 0.5, 0, 'steve bay seat'); });
      rect(sx - 0.4, sz + 3.3, 2.8, 1.1, 0, 'steve bay sofa'); round(sx - 0.4, sz + 2.35, 0.58, 'steve bay coffee table');
      [-1.1, 1.1].forEach(function (dz) { rect(sx - 4.0, sz + dz, 0.58, 0.72, 0, 'steve bay rack'); });
      rect(sx - 3.2, sz + 2.8, 1.15, 0.5, 0, 'steve bay bar');
      [-3.8, 3.8].forEach(function (dx) { small(sx + dx, sz - 2.8, 0.1, 'steve bay post'); });
      [[4.2, -2.8], [-3.6, -3.2], [2.2, 3.3]].forEach(function (p) { small(sx + p[0], sz + p[1], 0.3, 'plant'); });
    }
    // createExterior: glass corridor walls inside the terrace, linking the HQ doorway (x = +-corridorW/2, 4 m long)
    var ex = (L && L.exterior) || {}, corrW = Math.min((Number(ex.plazaWidth) || 28) * 0.72, 16);
    [-1, 1].forEach(function (side) { rect(side * corrW / 2, hd + 1.9, MIN_GLASS, 4.0, 0, 'terrace corridor glass'); });
    // buildWing (Collab Terrace): side glass, lounge (sofas, ottomans, low table), whiteboard + digital wall,
    // huddle stools, planters
    var w = L && L.wing;
    if (w && finite({ x: w.centerX, z: w.centerZ })) {
      var wx = Number(w.centerX), wz = Number(w.centerZ), whw = Number(w.width) / 2, wl = w.lounge || { x: -14, z: 6 };
      [-1, 1].forEach(function (side) { rect(wx + side * (whw - 0.4), wz, MIN_GLASS, Number(w.depth) - 1.5, 0, 'terrace side glass'); });
      var tlx = wx + Number(wl.x), tlz = wz + Number(wl.z);
      rect(tlx, tlz - 0.03, 3.4, 1.0, 0, 'terrace sofa'); rect(tlx + 1.95, tlz + 0.9, 1.05, 2.4, 0, 'terrace sofa');
      [[-0.9, 1.1], [0.6, 1.3]].forEach(function (p) { round(tlx + p[0], tlz + p[1], 0.4, 'terrace ottoman'); });
      round(tlx + 0.3, tlz + 1.0, 0.58, 'terrace low table');
      if (w.whiteboard) rect(wx + Number(w.whiteboard.x), wz + Number(w.whiteboard.z), 2.9, MIN_GLASS, 0, 'terrace whiteboard');
      if (w.digitalWall) rect(wx + Number(w.digitalWall.x), wz + Number(w.digitalWall.z), 2.55, MIN_GLASS, 0, 'terrace digital wall');
      var hu = w.huddle || { x: 0, z: 4 };
      round(wx + Number(hu.x), wz + Number(hu.z), 1.1, 'huddle table');
      for (var i = 0; i < 4; i++) { var ang = (i / 4) * Math.PI * 2 + 0.4; small(wx + Number(hu.x) + Math.cos(ang) * 1.55, wz + Number(hu.z) + Math.sin(ang) * 1.55, 0.24, 'huddle stool'); }
      (w.planters || []).forEach(function (p) { small(wx + p[0], wz + p[1], 0.3, 'planter'); });
    }
    // buildFunWing: chill pit (sofas, ottomans, table, media wall), game-arena stools
    var fw = L && L.funWing;
    if (fw && finite({ x: fw.centerX, z: fw.centerZ })) {
      var cx = Number(fw.centerX), cz = Number(fw.centerZ), cp = fw.chillPit || { x: -5, z: 8 }, ga = fw.gameArena || { x: 0, z: 0 };
      var cpx = cx + Number(cp.x), cpz = cz + Number(cp.z);
      rect(cpx, cpz - 0.03, 3.2, 0.97, 0, 'chill pit sofa'); rect(cpx + 1.8, cpz + 0.8, 0.9, 2.2, 0, 'chill pit sofa');
      [-1.2, 1.5].forEach(function (dx) { round(cpx + dx, cpz + 1.4, 0.42, 'chill pit ottoman'); });
      round(cpx + 0.4, cpz + 1.1, 0.52, 'chill pit table');
      rect(cpx + 1.2, cpz - 2.4, 3.6, MIN_GLASS, 0, 'chill pit media wall');
      [[-1.4, -0.4], [1.4, -0.4], [-1.4, 0.4], [1.4, 0.4]].forEach(function (q) { small(cx + Number(ga.x) + q[0] * 4, cz + Number(ga.z) + q[1] * 5, 0.22, 'arena stool'); });
    }
    if (!cyber) return;
    // createFuturisticSpaces (Cyberpunk only): briefing pod (open front), command deck core, cyber lounge
    pod(a.briefingRoom, 12, 7, 'briefing pod');
    if (finite(a.commandDeck)) round(a.commandDeck.x, a.commandDeck.z, 1.05, 'command deck core');
    var cl = a.cyberLounge;
    if (finite(cl)) {
      var gx = Number(cl.x), gz = Number(cl.z), barZ = gz - 3.2;
      rect(gx - 3.2, gz + 1.8, 3.4, 0.9, 0, 'cyber lounge sofa'); rect(gx + 1.2, gz + 2.4, 0.9, 2.6, 0, 'cyber lounge sofa');
      [-2.2, 2.2].forEach(function (dx) { round(gx + dx, gz - 0.4, 0.45, 'cyber lounge ottoman'); });
      round(gx, gz + 1.2, 0.58, 'cyber lounge table');
      rect(gx, barZ, 6.08, 0.6, 0, 'cyber lounge bar');
      rect(gx, gz - 3.85, 4.2, MIN_GLASS, 0, 'cyber lounge screen');
      [-5.5, 5.5].forEach(function (dx) { small(gx + dx, gz, 0.1, 'cyber lounge post'); });
      pod(cl, 16, 8, 'cyber lounge'); // createCyberLounge -> createCyberPod(a, 16, 8): front corner posts at gz - 4 (back glass sits on the rear wall)
    }
  }
  /** Walls, glass, pods, racks, booths and screens: never entered, not even by the last step onto a seat. */
  var HARD = /glass|divider|rail|wall|\bpod\b|simulation bay|innovation lab|booth|rack|screen|\bboard\b|\bpost\b|shelf|cooler|\btv\b|vending|cabinet|counter|fridge/;
  function isHard(o) { return HARD.test(o.tag || ''); }

  var SEAT_DEPTH = 0.75;  // how far the last / first step may enter soft furniture (sit on a sofa, a chair at a desk)
  var SEAT_LEG = 1.6;     // ... and only within this distance of the seat
  var SNAP_MAX = 1.5;     // a blocked goal may snap to a reachable free cell this close, otherwise it fails

  function Nav(L, opts) {
    opts = opts || {};
    this.L = L;
    this.opts = opts;
    this.cell = opts.cell || CELL;
    this.radius = opts.radius == null ? RADIUS : opts.radius;
    var hw = (L && L.room ? L.room.width : 72) / 2, hd = (L && L.room ? L.room.depth : 54) / 2;
    this.hw = hw; this.hd = hd;
    var areas = [{ x0: -hw, x1: hw, z0: -hd, z1: hd }];
    var fw = L && L.funWing, w = L && L.wing;
    if (fw) areas.push({ x0: fw.centerX - fw.width / 2, x1: fw.centerX + fw.width / 2, z0: fw.centerZ - fw.depth / 2, z1: fw.centerZ + fw.depth / 2 });
    if (w) areas.push({ x0: w.centerX - w.width / 2, x1: w.centerX + w.width / 2, z0: w.centerZ - w.depth / 2, z1: w.centerZ + w.depth / 2 });
    this.areas = areas;
    var minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    areas.forEach(function (a) { minX = Math.min(minX, a.x0); maxX = Math.max(maxX, a.x1); minZ = Math.min(minZ, a.z0); maxZ = Math.max(maxZ, a.z1); });
    this.x0 = minX; this.z0 = minZ;
    this.nx = Math.ceil((maxX - minX) / this.cell) + 1; this.nz = Math.ceil((maxZ - minZ) / this.cell) + 1;
    this.block = new Uint8Array(this.nx * this.nz);
    this.furniture = furniture(L, opts);
    this.dynamic = [];   // temporary obstacles (addObstacle), tagged
    this.version = 0;
    this.fz = fw && isFinite(fw.centerZ) ? Number(fw.centerZ) : 12;
    this.dx = (L && L.anchors && L.anchors.doorway && isFinite(L.anchors.doorway.x)) ? Number(L.anchors.doorway.x) : 0;
    this.dhalf = (L && L.anchors && L.anchors.doorway && isFinite(L.anchors.doorway.width)) ? Math.max(1.5, Number(L.anchors.doorway.width) / 2 - 0.2) : 1.5;
    this.doors = [{ x: hw, z: this.fz }, { x: this.dx, z: hd }];
    this._build();
  }
  var N = Nav.prototype;
  /** Is a world point inside the walkable floor (areas minus the walls between them, except the openings)? */
  N._floor = function (x, z, r) {
    var inside = false, A;
    for (var k = 0; k < this.areas.length; k++) { A = this.areas[k]; if (x >= A.x0 + r && x <= A.x1 - r && z >= A.z0 + r && z <= A.z1 - r) { inside = true; break; } }
    // the walls between the main floor and the wings, solid except the two openings
    if (inside && Math.abs(x - this.hw) < 0.35 + r && z > -this.hd && Math.abs(z - this.fz) > FUN_OPEN) inside = false;
    if (inside && Math.abs(z - this.hd) < 0.35 + r && x < this.hw && Math.abs(x - this.dx) > this.dhalf) inside = false; // terrace doorway (7 m wide, coffee cart in it)
    return inside;
  };
  N._rects = function () { return this.dynamic.length ? this.furniture.concat(this.dynamic) : this.furniture; };
  /** Rasterise floor + every rect (inflated by the avatar radius) onto the grid; bumps version. */
  N._build = function () {
    var r = this.radius, nz = this.nz;
    for (var ix = 0; ix < this.nx; ix++) for (var iz = 0; iz < nz; iz++) {
      var x = this.x0 + ix * this.cell, z = this.z0 + iz * this.cell;
      this.block[ix * nz + iz] = this._floor(x, z, r) ? 0 : 1;
    }
    var rects = this._rects();
    for (var f = 0; f < rects.length; f++) {
      var o = rects[f], pr = o.pad != null ? Math.min(o.pad, r) : r;
      var ext = (Math.abs(o.w * Math.cos(o.rot)) + Math.abs(o.d * Math.sin(o.rot))) / 2 + pr, extz = (Math.abs(o.w * Math.sin(o.rot)) + Math.abs(o.d * Math.cos(o.rot))) / 2 + pr;
      var i0 = Math.max(0, Math.floor((o.x - ext - this.x0) / this.cell)), i1 = Math.min(this.nx - 1, Math.ceil((o.x + ext - this.x0) / this.cell));
      var j0 = Math.max(0, Math.floor((o.z - extz - this.z0) / this.cell)), j1 = Math.min(nz - 1, Math.ceil((o.z + extz - this.z0) / this.cell));
      for (var a = i0; a <= i1; a++) for (var b = j0; b <= j1; b++) {
        if (this.block[a * nz + b]) continue;
        if (this._inRect(o, this.x0 + a * this.cell, this.z0 + b * this.cell, pr)) this.block[a * nz + b] = 1;
      }
    }
    // 2 m buckets of the real (uninflated) rects for solidAt / legOk
    var B = {}, BS = 2;
    for (var q = 0; q < rects.length; q++) {
      var R = rects[q], hx = (Math.abs(R.w * Math.cos(R.rot)) + Math.abs(R.d * Math.sin(R.rot))) / 2, hz = (Math.abs(R.w * Math.sin(R.rot)) + Math.abs(R.d * Math.cos(R.rot))) / 2;
      for (var bx = Math.floor((R.x - hx) / BS); bx <= Math.floor((R.x + hx) / BS); bx++) for (var bz = Math.floor((R.z - hz) / BS); bz <= Math.floor((R.z + hz) / BS); bz++) (B[bx + ',' + bz] = B[bx + ',' + bz] || []).push(R);
    }
    this._bucket = B;
    this._comp = null;
    this.version++;
  };
  N._inRect = function (o, x, z, pad) {
    var c = Math.cos(-o.rot), s = Math.sin(-o.rot), lx = (x - o.x) * c - (z - o.z) * s, lz = (x - o.x) * s + (z - o.z) * c;
    return Math.abs(lx) <= o.w / 2 + pad && Math.abs(lz) <= o.d / 2 + pad;
  };
  /** How deep a point is inside a rect (metres to the nearest edge), or -1 if outside. */
  N._depth = function (o, x, z) {
    var c = Math.cos(-o.rot), s = Math.sin(-o.rot), lx = (x - o.x) * c - (z - o.z) * s, lz = (x - o.x) * s + (z - o.z) * c;
    var d = Math.min(o.w / 2 - Math.abs(lx), o.d / 2 - Math.abs(lz));
    return d >= 0 ? d : -1;
  };
  N.idx = function (p) { return { ix: Math.round((p.x - this.x0) / this.cell), iz: Math.round((p.z - this.z0) / this.cell) }; };
  N.pos = function (ix, iz) { return { x: this.x0 + ix * this.cell, z: this.z0 + iz * this.cell }; };
  N.free = function (ix, iz) { return ix >= 0 && iz >= 0 && ix < this.nx && iz < this.nz && !this.block[ix * this.nz + iz]; };
  /** Is a world point blocked by furniture / walls (for tests and diagnostics)? */
  N.blockedAt = function (p) { var c = this.idx(p); return !this.free(c.ix, c.iz); };
  /** What a point physically is: {hard: wall / glass / pod / outside, soft: deepest soft-furniture depth, tags}. */
  N.solidAt = function (p) {
    var x = Number(p.x), z = Number(p.z), out = { hard: !this._floor(x, z, 0.02), soft: 0, tags: [] }, rects = this._bucket[Math.floor(x / 2) + ',' + Math.floor(z / 2)] || [];
    for (var i = 0; i < rects.length; i++) {
      var d = this._depth(rects[i], x, z);
      if (d < 0) continue;
      out.tags.push(rects[i].tag);
      if (isHard(rects[i]) || rects[i].hard) { if (d > 0.02) out.hard = true; } else if (d > out.soft) out.soft = d;
    }
    return out;
  };
  /** May an avatar stand / sit at p (not in a wall, glass, pod; at most SEAT_DEPTH into a sofa / desk side)? */
  N.standable = function (p) { if (!finite(p)) return false; var s = this.solidAt(p); return !s.hard && s.soft <= SEAT_DEPTH; };
  /** A short leg a -> b that may enter soft furniture only near b (by SEAT_DEPTH) and never anything hard. */
  N.legOk = function (a, b) {
    var dx = b.x - a.x, dz = b.z - a.z, len = Math.sqrt(dx * dx + dz * dz), n = Math.max(1, Math.ceil(len / 0.1));
    for (var i = 0; i <= n; i++) {
      var p = { x: a.x + dx * i / n, z: a.z + dz * i / n }, s = this.solidAt(p);
      if (s.hard) return false;
      if (s.soft > 0 && (s.soft > SEAT_DEPTH || len * (1 - i / n) > SEAT_LEG)) return false;
    }
    return true;
  };
  N._nearestFree = function (c) {
    if (this.free(c.ix, c.iz)) return c;
    for (var r = 1; r < 12; r++) {
      var best = null, bd = Infinity;
      for (var dx = -r; dx <= r; dx++) for (var dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r || !this.free(c.ix + dx, c.iz + dz)) continue;
        var d = dx * dx + dz * dz; if (d < bd) { bd = d; best = { ix: c.ix + dx, iz: c.iz + dz }; }
      }
      if (best) return best;
    }
    return null;
  };
  /** Connected-area labels of the free cells (lazy, per grid version). */
  N._labels = function () {
    if (this._comp) return this._comp;
    var nz = this.nz, total = this.nx * nz, lab = new Int32Array(total), next = 0, stack = [];
    for (var i = 0; i < total; i++) {
      if (lab[i] || this.block[i]) continue;
      next++; lab[i] = next; stack.push(i);
      while (stack.length) {
        var c = stack.pop(), cx = (c / nz) | 0, cz = c % nz;
        for (var d = 0; d < 4; d++) {
          var ix = cx + (d === 0 ? 1 : d === 1 ? -1 : 0), iz = cz + (d === 2 ? 1 : d === 3 ? -1 : 0);
          if (!this.free(ix, iz)) continue;
          var nb = ix * nz + iz; if (!lab[nb]) { lab[nb] = next; stack.push(nb); }
        }
      }
    }
    this._comp = lab;
    return lab;
  };
  /** Connected area id of the free cell at / nearest p (0 = none). */
  N.componentAt = function (p) { if (!finite(p)) return 0; var c = this._nearestFree(this.idx(p)); return c ? this._labels()[c.ix * this.nz + c.iz] : 0; };
  /** The largest connected area (the office floor + wings through the openings). */
  N.mainComponent = function () {
    if (this._main && this._mainV === this.version) return this._main;
    var lab = this._labels(), cnt = {}, best = 0, bn = -1;
    for (var i = 0; i < lab.length; i++) if (lab[i]) cnt[lab[i]] = (cnt[lab[i]] || 0) + 1;
    Object.keys(cnt).forEach(function (k) { if (cnt[k] > bn) { bn = cnt[k]; best = Number(k); } });
    this._main = best; this._mainV = this.version;
    return best;
  };
  N._comp1 = function (c) { return this._labels()[c.ix * this.nz + c.iz]; };
  /** Free cells within rings around p (nearest first) that pass test(cellPos). */
  N._around = function (p, rings, test, max) {
    var c = this.idx(p), all = [], out = [];
    for (var dx = -rings; dx <= rings; dx++) for (var dz = -rings; dz <= rings; dz++) {
      var ix = c.ix + dx, iz = c.iz + dz;
      if (!this.free(ix, iz)) continue;
      var q = this.pos(ix, iz);
      all.push({ ix: ix, iz: iz, p: q, d: Math.hypot(q.x - p.x, q.z - p.z) });
    }
    all.sort(function (u, v) { return u.d - v.d; });
    for (var i = 0; i < all.length && (!max || out.length < max); i++) if (!test || test(all[i].p, all[i])) out.push(all[i]);
    return out;
  };
  /** Straight segment clear of furniture and walls? (samples every quarter cell) */
  N.clear = function (a, b) {
    var dx = b.x - a.x, dz = b.z - a.z, len = Math.sqrt(dx * dx + dz * dz), n = Math.max(1, Math.ceil(len / (this.cell * 0.25)));
    for (var i = 0; i <= n; i++) {
      var c = this.idx({ x: a.x + dx * i / n, z: a.z + dz * i / n });
      if (!this.free(c.ix, c.iz)) return false;
    }
    return true;
  };
  /** Route from -> to. Returns {ok, pts (excluding from), reason, snapped, escaped, goal}. reason when !ok:
   *  'bad-input' | 'start-blocked' (inside something with no free cell near) | 'goal-blocked' (inside a wall / pod
   *  / deep in furniture with no reachable free cell within SNAP_MAX) | 'no-path' (a different connected area).
   *  Never crosses an obstacle: every leg is a clear grid segment, or a checked seat leg (legOk). */
  N.plan = function (from, to, opt) {
    opt = opt || {};
    if (!finite(from) || !finite(to)) return { ok: false, pts: null, reason: 'bad-input' };
    from = { x: Number(from.x), z: Number(from.z) }; to = { x: Number(to.x), z: Number(to.z) };
    var self = this, nz = this.nz, snapMax = opt.snapMax == null ? SNAP_MAX : opt.snapMax;
    // start: the from cell, else the nearest free cell reachable by a checked leg (getting up from a chair / sofa),
    // else (standing inside something after a grid change) the nearest free cell within 3 m: an escape hop
    var fc = this.idx(from), s = null, escaped = false;
    if (this.free(fc.ix, fc.iz)) s = fc;
    else {
      var near = this._around(from, 4, function (q) { return self.legOk(q, from); }, 1);
      if (near.length) s = near[0];
      else { near = this._around(from, 6); if (near.length && near[0].d <= 3) { s = near[0]; escaped = true; } }
    }
    if (!s) return { ok: false, pts: null, reason: 'start-blocked' };
    var comp = this._comp1(s);
    // goal: standable -> a free cell of the same area that reaches it by a checked leg; else snap / fail
    var g = null, snapped = false, end = to, tc = this.idx(to);
    if (this.standable(to)) {
      if (this.free(tc.ix, tc.iz) && this._comp1(tc) === comp) g = tc;
      else {
        var cand = this._around(to, 4, function (q, cc) { return self._comp1(cc) === comp && self.legOk(q, to); }, 1);
        if (cand.length) g = cand[0];
        else if (this._around(to, 4, function (q) { return self.legOk(q, to); }, 1).length) return { ok: false, pts: null, reason: 'no-path' };
        if (!g && this.free(tc.ix, tc.iz)) return { ok: false, pts: null, reason: 'no-path' };
      }
    }
    if (!g) {
      var rings = Math.ceil(snapMax / this.cell), sn = this._around(to, rings, function (q, c) { return self._comp1(c) === comp; }, 1);
      if (!sn.length || sn[0].d > snapMax) {
        var other = this._around(to, rings, null, 1);
        return { ok: false, pts: null, reason: other.length && other[0].d <= snapMax && this.standable(to) ? 'no-path' : 'goal-blocked' };
      }
      g = sn[0]; snapped = true; end = this.pos(g.ix, g.iz);
    }
    // A* over free cells (8-way, no corner cutting); same area, so it always finds a route
    var total = this.nx * nz, G = new Float32Array(total), came = new Int32Array(total), closed = new Uint8Array(total);
    for (var i = 0; i < total; i++) { G[i] = Infinity; came[i] = -1; }
    var start = s.ix * nz + s.iz, goal = g.ix * nz + g.iz;
    var heap = [], hf = [];
    function push(n, f) { heap.push(n); hf.push(f); var k = heap.length - 1; while (k > 0) { var p = (k - 1) >> 1; if (hf[p] <= hf[k]) break; var t = heap[p]; heap[p] = heap[k]; heap[k] = t; t = hf[p]; hf[p] = hf[k]; hf[k] = t; k = p; } }
    function pop() {
      var top = heap[0], ln = heap.pop(), lf = hf.pop();
      if (heap.length) { heap[0] = ln; hf[0] = lf; var k = 0; for (;;) { var l = 2 * k + 1, r = l + 1, m = k; if (l < heap.length && hf[l] < hf[m]) m = l; if (r < heap.length && hf[r] < hf[m]) m = r; if (m === k) break; var t = heap[m]; heap[m] = heap[k]; heap[k] = t; t = hf[m]; hf[m] = hf[k]; hf[k] = t; k = m; } }
      return top;
    }
    function h(n) { var ax = Math.abs(((n / nz) | 0) - g.ix), az = Math.abs((n % nz) - g.iz); return (ax + az) + (Math.SQRT2 - 2) * Math.min(ax, az); }
    G[start] = 0; push(start, h(start));
    var found = false, D = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    while (heap.length) {
      var cur = pop();
      if (closed[cur]) continue;
      if (cur === goal) { found = true; break; }
      closed[cur] = 1;
      var cx = (cur / nz) | 0, cz = cur % nz;
      for (var d = 0; d < 8; d++) {
        var ix = cx + D[d][0], iz = cz + D[d][1];
        if (!this.free(ix, iz)) continue;
        if (d >= 4 && (!this.free(cx + D[d][0], cz) || !this.free(cx, cz + D[d][1]))) continue; // no corner cutting
        var nb = ix * nz + iz, ng = G[cur] + (d >= 4 ? Math.SQRT2 : 1);
        if (ng < G[nb]) { G[nb] = ng; came[nb] = cur; push(nb, ng + h(nb)); }
      }
    }
    if (!found) return { ok: false, pts: null, reason: 'no-path' };
    var cells = [];
    for (var c = goal; c !== -1; c = came[c]) cells.push(this.pos((c / nz) | 0, c % nz));
    cells.reverse();
    // the real endpoints join the chain when the grid sees them as free and clear; otherwise they are separate,
    // checked legs (seat legs / escape hop) and the cell centre stays as a waypoint
    var fromFree = this.free(fc.ix, fc.iz), headLeg = !fromFree || !this.clear(from, cells[0]);
    var chain = headLeg ? cells.slice() : [from].concat(cells.slice(1));
    var endFree = !snapped && this.free(tc.ix, tc.iz) && this.clear(chain[chain.length - 1], end);
    if (!snapped && endFree) { if (Math.hypot(chain[chain.length - 1].x - end.x, chain[chain.length - 1].z - end.z) > 1e-6) chain.push(end); }
    // string-pull: keep only the corners needed for clear straight segments
    var pts = [], k2 = 0;
    while (k2 < chain.length - 1) {
      var far = k2 + 1;
      for (var j = chain.length - 1; j > k2 + 1; j--) if (this.clear(chain[k2], chain[j])) { far = j; break; }
      pts.push(chain[far]); k2 = far;
    }
    if (headLeg && Math.hypot(chain[0].x - from.x, chain[0].z - from.z) > 0.05) pts.unshift(chain[0]);
    if (!snapped && !endFree) {
      var last = pts.length ? pts[pts.length - 1] : chain[chain.length - 1];
      if (!pts.length && Math.hypot(last.x - from.x, last.z - from.z) > 0.05) pts.push(last);
      if (Math.hypot(last.x - end.x, last.z - end.z) > 0.05) pts.push(end); else if (pts.length) pts[pts.length - 1] = end;
    }
    if (!pts.length) pts.push(end);
    pts[pts.length - 1] = { x: end.x, z: end.z };
    return { ok: true, pts: pts, reason: null, snapped: snapped, escaped: escaped, goal: { x: end.x, z: end.z } };
  };
  /** Waypoints from -> to (excluding from, ending at to, or at the nearest reachable free cell when to is
   *  blocked). null when there is no route: callers hold position (no straight or door fallback). */
  N.path = function (from, to, opt) { var r = this.plan(from, to, opt); return r.ok ? r.pts : null; };
  /** Can an avatar at a get to b (same connected area and b standable)? */
  N.reachable = function (a, b) { var r = this.plan(a, b, { snapMax: 0 }); return !!r.ok; };
  /** Temporary obstacle (e.g. a closed area, a test): rect {x, z, w, d, rot?}; returns the new grid version. */
  N.addObstacle = function (o, tag) {
    if (!o || !finite(o)) return this.version;
    this.dynamic.push({ x: Number(o.x), z: Number(o.z), w: Number(o.w) || 1, d: Number(o.d) || 1, rot: Number(o.rot) || 0, tag: String(tag || o.tag || 'obstacle'), hard: o.hard !== false });
    this._build();
    return this.version;
  };
  N.removeObstacle = function (tag) {
    var n = this.dynamic.length;
    this.dynamic = this.dynamic.filter(function (o) { return o.tag !== String(tag); });
    if (this.dynamic.length !== n) this._build();
    return this.version;
  };

  /**
   * Per-seat route guard (pure). request(id, from, to, now, opt) -> {status, pts, reason, snapped, attempt, nextAt}
   *   status 'ok' | 'snapped' (walk to the nearest reachable free point) | 'wait' (failed, retry after backoff;
   *   hold position) | 'blocked' (gave up after maxTries; hold position, flag it). A gave-up target is not
   *   re-planned until the target, the start's connected area or the grid version changes - no endless loop.
   * opt: { maxTries } (ambient legs use 1: cancel at once). Stats are diagnostics only (VO.routes()).
   */
  function RouteGuard(getNav, opts) {
    opts = opts || {};
    this.getNav = typeof getNav === 'function' ? getNav : function () { return getNav; };
    this.delays = opts.delays || [1000, 2000, 4000];
    this.maxTries = opts.maxTries || 4;
    this.agents = {};
    this.stats = { plans: 0, failures: 0, gaveUp: 0, recovered: 0, snapped: 0, held: 0 };
    this.log = [];
    this.onGiveUp = opts.onGiveUp || null;
  }
  var RG = RouteGuard.prototype;
  RG._key = function (nav, from, to) { return Number(to.x).toFixed(2) + ',' + Number(to.z).toFixed(2) + '|' + nav.componentAt(from) + '|v' + nav.version; };
  RG.request = function (id, from, to, now, opt) {
    opt = opt || {};
    var nav = this.getNav();
    if (!nav) return { status: 'ok', pts: [{ x: Number(to.x), z: Number(to.z) }], reason: 'no-nav' };
    if (!finite(from) || !finite(to)) return { status: 'blocked', pts: null, reason: 'bad-input' };
    id = String(id); now = Number(now) || 0;
    var key = this._key(nav, from, to), st = this.agents[id], maxTries = opt.maxTries || this.maxTries;
    if (st && st.key !== key) {
      // new target / area / grid: a failed seat gets a fresh budget (recovery path)
      if (st.status !== 'ok') st.prev = st.status;
      st = null;
    }
    if (st && st.status === 'blocked') { this.stats.held++; return { status: 'blocked', pts: null, reason: st.reason, attempt: st.attempts }; }
    if (st && st.status === 'retrying' && now < st.nextAt) { this.stats.held++; return { status: 'wait', pts: null, reason: st.reason, attempt: st.attempts, nextAt: st.nextAt }; }
    var prevFailed = !!(this.agents[id] && this.agents[id].status !== 'ok');
    this.stats.plans++;
    var r = nav.plan(from, to);
    if (r.ok) {
      if (prevFailed) { this.stats.recovered++; this._note(id, 'recovered', to, null); }
      if (r.snapped && !(st && st.snapped)) this.stats.snapped++;
      this.agents[id] = { key: key, status: 'ok', attempts: 0, target: { x: Number(to.x), z: Number(to.z) }, snapped: !!r.snapped, at: now };
      return { status: r.snapped ? 'snapped' : 'ok', pts: r.pts, reason: null, snapped: !!r.snapped, escaped: !!r.escaped, goal: r.goal };
    }
    st = st || { key: key, status: 'retrying', attempts: 0, target: { x: Number(to.x), z: Number(to.z) } };
    st.attempts++; st.reason = r.reason; st.at = now;
    this.stats.failures++;
    if (st.attempts >= maxTries) {
      st.status = 'blocked'; st.nextAt = Infinity; this.stats.gaveUp++;
      this.agents[id] = st;
      this._note(id, 'gave-up', to, r.reason);
      if (this.onGiveUp) { try { this.onGiveUp(id, st); } catch (e) { /* diagnostics only */ } }
      return { status: 'blocked', pts: null, reason: r.reason, attempt: st.attempts };
    }
    st.status = 'retrying'; st.nextAt = now + this.delays[Math.min(st.attempts - 1, this.delays.length - 1)];
    this.agents[id] = st;
    this._note(id, 'retry', to, r.reason);
    return { status: 'wait', pts: null, reason: r.reason, attempt: st.attempts, nextAt: st.nextAt };
  };
  RG._note = function (id, what, to, reason) { this.log.push({ id: id, what: what, to: { x: +Number(to.x).toFixed(2), z: +Number(to.z).toFixed(2) }, reason: reason }); if (this.log.length > 40) this.log.shift(); };
  RG.status = function (id) { var st = this.agents[String(id)]; return st ? st.status : 'ok'; };
  /** Seats whose retry time has come (callers re-run their sync for them). */
  RG.due = function (now) { var out = [], self = this; Object.keys(this.agents).forEach(function (id) { var st = self.agents[id]; if (st.status === 'retrying' && now >= st.nextAt) out.push(id); }); return out; };
  RG.forget = function (id) { delete this.agents[String(id)]; };
  RG.snapshot = function () {
    var self = this, agents = {};
    Object.keys(this.agents).forEach(function (id) { var st = self.agents[id]; if (st.status !== 'ok' || st.snapped) agents[id] = { status: st.status, attempts: st.attempts, reason: st.reason || null, target: st.target, snapped: !!st.snapped }; });
    var nav = this.getNav();
    return { stats: Object.assign({}, this.stats), agents: agents, log: this.log.slice(-10), navVersion: nav ? nav.version : null };
  };

  /** Total length of a route starting at from. */
  function length(from, pts) { var d = 0, p = from; (pts || []).forEach(function (q) { d += Math.hypot(q.x - p.x, q.z - p.z); p = q; }); return d; }

  return { Nav: Nav, RouteGuard: RouteGuard, furniture: furniture, isHard: isHard, length: length, CELL: CELL, RADIUS: RADIUS, FUN_OPEN: FUN_OPEN, MIN_GLASS: MIN_GLASS, SEAT_DEPTH: SEAT_DEPTH, SNAP_MAX: SNAP_MAX };
});
