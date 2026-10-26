/* TEVA HQ seat / spot reservations (2026-10-22, Steve: "avatars sit in the same seat on top of each other while
 * other spaces are free").
 *
 * Root cause it fixes: every idle seat picked its Fun Wing pad with hash(id) % 6, so 13 idle seats shared 6 pads
 * (e.g. le + pm + product all on idle-6's neighbour, le2 + debugger + erp-research on another); ambient trips
 * picked a random point near a destination with no check; the Research Lab used (index % 3). Nothing knew who
 * was already standing or sitting where.
 *
 * Pure (no THREE / DOM) so tests/test_teva_spots.js can drive it. One Registry holds every reservable spot in the
 * office (Fun Wing pads + play stations, lounges, coffee points, boardroom chairs, Research Lab chairs) and every
 * ad-hoc point (hand-off / meeting standing points, ambient chat spots). Rules:
 *  - a spot holds one avatar at a time; ad-hoc points keep MIN_GAP from every other held position and desk chair;
 *  - a holder has named slots ('home' idle place, 'away' ambient leg, 'zone' boardroom / lab, 'point' ad-hoc) and
 *    claiming a slot again moves that slot (the old spot is released);
 *  - taken target -> the nearest free spot (lowest rank first: Fun Wing pads, then play stations, then the rest);
 *  - spread: pick among the least-used places first so ambient / zone visitors fan out over the office;
 *  - release(holder[, slot]) when the avatar leaves. office.html never claims for working / blocked / offline /
 *    meeting / your-turn seats (they stay at their desk).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TevaSpots = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var MIN_GAP = 0.9; // metres between two avatars' places (an avatar is ~0.6 m wide)

  function finite(p) { return !!p && isFinite(Number(p.x)) && isFinite(Number(p.z)); }
  function dist(a, b) { var dx = a.x - b.x, dz = a.z - b.z; return Math.sqrt(dx * dx + dz * dz); }
  function faceTo(x, z, tx, tz) { return Math.atan2(tx - x, tz - z); }

  /**
   * Every reservable spot, from the real floor plan (public/office_layout.js) and the props office.html /
   * teva_environment.js actually build there. opts: { boardroom:[{x,z,face}], research:[{x,z,face}],
   * blocked:[{x,z}] (desk chairs: no spot may sit on one) }.
   * Spot: { id, place, label, groups:['idle','ambient'|'boardroom'|'research'], rank, x, z, face, sit, activity }
   *   activity: 'lounge' (sofa / beanbag), 'play' (arcade), 'pingpong', 'foosball', 'coffee', 'talk', 'watch',
   *             'meet' (boardroom chair), 'read' (Research Lab).
   */
  function catalog(L, opts) {
    opts = opts || {};
    var out = [], blocked = (opts.blocked || []).filter(finite);
    function add(place, label, groups, rank, x, z, face, sit, activity) {
      var p = { x: Number(x), z: Number(z) };
      if (!finite(p)) return;
      for (var i = 0; i < out.length; i++) if (dist(out[i], p) < MIN_GAP) return;   // never two spots on top of each other
      for (var j = 0; j < blocked.length; j++) if (dist(blocked[j], p) < MIN_GAP) return;
      out.push({ id: place + '#' + out.filter(function (s) { return s.place === place; }).length, place: place, label: label, groups: groups,
        rank: rank, x: p.x, z: p.z, face: Number.isFinite(face) ? face : null, sit: !!sit, activity: activity || 'stand' });
    }
    var IA = ['idle', 'ambient'];
    var fw = L && L.funWing;
    if (fw && finite({ x: fw.centerX, z: fw.centerZ })) {
      var cx = Number(fw.centerX), cz = Number(fw.centerZ);
      var ar = fw.arcadeRow || { x: 0, z: -6 }, pp = fw.pingPong || { x: -2.5, z: 0 }, fb = fw.foosball || { x: 3.2, z: 0 };
      var sn = fw.snackStrip || { x: 0, z: -11 }, ch = fw.chillPit || { x: -5, z: 8 };
      // 1) the Fun Wing pads (sofas, beanbag, arcade stools, stool) - the preferred idle places (rank 0)
      (fw.idleSpots || []).forEach(function (s) {
        var pose = s.pose || 'stool', x = cx + Number(s.x), z = cz + Number(s.z);
        var place = pose === 'arcade' ? 'fun-arcadeRow' : (pose === 'stool' ? 'fun-gameArena' : 'fun-chillPit');
        var face = pose === 'arcade' ? Math.PI : (pose === 'stool' ? faceTo(x, z, cx + Number(fb.x), cz + Number(fb.z)) : faceTo(x, z, cx + Number(ch.x), cz + Number(ch.z) - 3));
        add(place, 'Fun Wing ' + pose, IA, 0, x, z, face, true, pose === 'arcade' ? 'play' : (pose === 'stool' ? 'watch' : 'lounge'));
      });
      // 2) play stations next to the real props (rank 1)
      for (var i = 0; i < 5; i++) add('fun-arcadeRow', 'Fun Wing arcade', IA, 1, cx + Number(ar.x) - 6 + i * 3, cz + Number(ar.z) + 1.25, Math.PI, false, 'play');
      add('fun-pingPong', 'Fun Wing ping pong', IA, 1, cx + Number(pp.x) - 1.95, cz + Number(pp.z), Math.PI / 2, false, 'pingpong');
      add('fun-pingPong', 'Fun Wing ping pong', IA, 1, cx + Number(pp.x) + 1.95, cz + Number(pp.z), -Math.PI / 2, false, 'pingpong');
      add('fun-foosball', 'Fun Wing foosball', IA, 1, cx + Number(fb.x), cz + Number(fb.z) - 1.0, 0, false, 'foosball');
      add('fun-foosball', 'Fun Wing foosball', IA, 1, cx + Number(fb.x), cz + Number(fb.z) + 1.0, Math.PI, false, 'foosball');
      [-1.4, 1.4].forEach(function (dx) { add('fun-snackStrip', 'Fun Wing snacks', IA, 1, cx + Number(sn.x) + dx, cz + Number(sn.z) + 0.95, Math.PI, false, 'coffee'); });
      [-1.2, 0, 1.2].forEach(function (dx) { add('fun-snackStrip', 'Fun Wing snack bar', IA, 1, cx + Number(sn.x) + dx, cz + Number(sn.z) + 3.1, Math.PI, true, 'coffee'); });
    }
    var a = (L && L.anchors) || {};
    // 3) main-floor break places (rank 2)
    if (finite(a.kitchen)) [-1.3, -0.1].forEach(function (dx) { add('coffee', 'coffee corner', IA, 2, Number(a.kitchen.x) + dx, Number(a.kitchen.z) - 1.05, 0, false, 'coffee'); });
    if (finite(a.lounge)) {
      var lx = Number(a.lounge.x), lz = Number(a.lounge.z);
      [-1.0, 0, 1.0].forEach(function (dx) { add('lounge', 'lounge sofa', IA, 2, lx + dx, lz + 0.05, 0, true, 'lounge'); });
      add('lounge', 'lounge sofa', IA, 2, lx + 1.55, lz + 1.25, -Math.PI / 2, true, 'lounge');
    }
    if (finite(a.cyberLounge)) {
      var ox = Number(a.cyberLounge.x), oz = Number(a.cyberLounge.z);
      [-4.2, -3.2, -2.2].forEach(function (dx) { add('cyber', 'Cyber Lounge sofa', IA, 2, ox + dx, oz + 1.6, Math.PI, true, 'lounge'); });
      add('cyber', 'Cyber Lounge', IA, 2, ox - 1.0, oz + 0.3, faceTo(ox - 1.0, oz + 0.3, ox, oz + 1.2), false, 'coffee');
      add('cyber', 'Cyber Lounge', IA, 2, ox + 0.9, oz + 0.4, faceTo(ox + 0.9, oz + 0.4, ox, oz + 1.2), false, 'coffee');
    }
    var w = L && L.wing;
    if (w && finite({ x: w.centerX, z: w.centerZ })) {
      var wx = Number(w.centerX), wz = Number(w.centerZ);
      var wl = w.lounge || { x: -14, z: 5 }, hd = w.huddle || { x: 0, z: 4 }, cc = w.coffeeCart || { x: 0, z: -8.5 };
      [-1.1, 0, 1.1].forEach(function (dx) { add('wing-lounge', 'terrace lounge', IA, 2, wx + Number(wl.x) + dx, wz + Number(wl.z) + 0.1, 0, true, 'lounge'); });
      for (var k = 0; k < 4; k++) {
        var ang = Math.PI / 4 + k * Math.PI / 2, hx = wx + Number(hd.x) + Math.cos(ang) * 1.75, hz = wz + Number(hd.z) + Math.sin(ang) * 1.75;
        add('wing-huddle', 'terrace huddle', IA, 2, hx, hz, faceTo(hx, hz, wx + Number(hd.x), wz + Number(hd.z)), false, 'talk');
      }
      [-0.6, 0.6].forEach(function (dx) { add('wing-coffee', 'terrace coffee cart', IA, 2, wx + Number(cc.x) + dx, wz + Number(cc.z) + 0.8, Math.PI, false, 'coffee'); });
    }
    // 4) real-event zones (teva_zones.js): boardroom chairs and Research Lab chairs - never idle / ambient
    (opts.boardroom || []).forEach(function (s) { add('boardroom', 'Boardroom', ['boardroom'], 0, s.x, s.z, s.face, true, 'meet'); });
    (opts.research || []).forEach(function (s) { add('research', 'Research Lab', ['research'], 0, s.x, s.z, s.face, true, 'read'); });
    return out;
  }

  function Registry(spots, opts) {
    opts = opts || {};
    this.minGap = opts.minGap || MIN_GAP;
    this.blocked = (opts.blocked || []).filter(finite).map(function (p) { return { x: Number(p.x), z: Number(p.z) }; });
    this.spots = (spots || []).slice();
    this.byId = {};
    var self = this;
    this.spots.forEach(function (s) { self.byId[s.id] = s; });
    this.holderOf = {};  // spotId -> holder
    this.held = {};      // holder -> { slot: spotId | {x,z,point:true} }
    // nav recovery (2026-10-23): spots the walking grid cannot reach are skipped by claim (and ad-hoc points that
    // fail pointOk by claimPoint), so a blocked destination falls through to the nearest reachable free spot
    this.unreachable = {}; // spotId -> true
    this.pointOk = opts.pointOk || null; // fn({x,z}) -> bool
  }
  var R = Registry.prototype;
  R.spot = function (id) { return this.byId[id] || null; };
  R.places = function (group) {
    var seen = {}, out = [];
    this.spots.forEach(function (s) { if ((!group || s.groups.indexOf(group) >= 0) && !seen[s.place]) { seen[s.place] = 1; out.push(s.place); } });
    return out;
  };
  /** Centre of a place (mean of its spots), for distance checks. */
  R.center = function (place) {
    var n = 0, x = 0, z = 0;
    this.spots.forEach(function (s) { if (s.place === place) { n++; x += s.x; z += s.z; } });
    return n ? { x: x / n, z: z / n } : null;
  };
  R.load = function (place) {
    var n = 0, used = 0, self = this;
    this.spots.forEach(function (s) { if (s.place === place) { n++; if (self.holderOf[s.id] != null) used++; } });
    return n ? used / n : 1;
  };
  R.of = function (holder, slot) {
    var h = this.held[holder], v = h && h[slot];
    if (!v) return null;
    return v.point ? v : this.byId[v];
  };
  R.holder = function (spotId) { return this.holderOf[spotId] != null ? this.holderOf[spotId] : null; };
  /** Every held position: [{holder, slot, x, z, id?}] */
  R.positions = function () {
    var out = [], self = this;
    Object.keys(this.held).forEach(function (h) {
      var slots = self.held[h];
      Object.keys(slots).forEach(function (slot) {
        var v = slots[slot], p = v.point ? v : self.byId[v];
        if (p) out.push({ holder: h, slot: slot, x: p.x, z: p.z, id: v.point ? null : v });
      });
    });
    return out;
  };
  /** True if a point keeps minGap from every position held by someone else (and from desk chairs). */
  R.clear = function (p, holder, gap) {
    gap = gap || this.minGap;
    var pos = this.positions();
    for (var i = 0; i < pos.length; i++) if (pos[i].holder !== String(holder) && dist(pos[i], p) < gap - 1e-9) return false;
    for (var j = 0; j < this.blocked.length; j++) if (dist(this.blocked[j], p) < gap - 1e-9) return false;
    return true;
  };
  /** Mark a spot (un)reachable for the current walking grid; clearUnreachable() when the grid changes. */
  R.setUnreachable = function (spotId, on) { if (!this.byId[spotId]) return false; if (on) this.unreachable[spotId] = true; else delete this.unreachable[spotId]; return true; };
  R.clearUnreachable = function () { var n = Object.keys(this.unreachable).length; this.unreachable = {}; return n; };
  R.free = function (spot, holder) {
    if (this.unreachable[spot.id]) return false;
    var h = this.holderOf[spot.id];
    if (h != null && h !== String(holder)) return false;
    return this.clear(spot, holder);
  };
  R._set = function (holder, slot, value) {
    holder = String(holder);
    this.release(holder, slot);
    if (!this.held[holder]) this.held[holder] = {};
    this.held[holder][slot] = value;
    if (!value.point) this.holderOf[value] = holder;
  };
  /**
   * Reserve a spot for holder in slot. req: { places:[..] | groups:[..], prefer: spotId, near:{x,z},
   * spread: bool (least-used place first), rand: fn (tie-break), exclude:[place], excludeIds:[spotId] }.
   * Unreachable spots (setUnreachable) never match, so a held one is dropped for the nearest reachable free spot.
   * Keeps the slot's current spot if it still matches (stable placement). Returns the spot or null (all taken).
   */
  R.claim = function (holder, slot, req) {
    req = req || {};
    holder = String(holder);
    var self = this, places = req.places || null, groups = req.groups || null, exclude = req.exclude || [];
    function match(s) {
      if (places && places.indexOf(s.place) < 0) return false;
      if (groups && !groups.some(function (g) { return s.groups.indexOf(g) >= 0; })) return false;
      return exclude.indexOf(s.place) < 0 && !self.unreachable[s.id] && (!req.excludeIds || req.excludeIds.indexOf(s.id) < 0);
    }
    var cur = this.of(holder, slot);
    if (cur && !cur.point && match(cur) && (!req.prefer || req.prefer === cur.id || !this.byId[req.prefer] || !this.free(this.byId[req.prefer], holder))) return cur;
    var pref = req.prefer && this.byId[req.prefer];
    if (pref && match(pref) && this.free(pref, holder)) { this._set(holder, slot, pref.id); return pref; }
    var cands = this.spots.filter(function (s) { return match(s) && self.free(s, holder); });
    if (!cands.length) return null;
    var near = finite(req.near) ? req.near : (pref || null);
    if (req.spread) {
      var loads = {}, minLoad = 2;
      cands.forEach(function (s) { if (loads[s.place] == null) { loads[s.place] = self.load(s.place); if (loads[s.place] < minLoad) minLoad = loads[s.place]; } });
      var low = Object.keys(loads).filter(function (p) { return loads[p] <= minLoad + 1e-9; });
      var pick = low.length > 1 && req.rand ? low[Math.min(low.length - 1, Math.floor(req.rand() * low.length))] : low.sort()[0];
      cands = cands.filter(function (s) { return s.place === pick; });
    }
    cands.sort(function (a, b) {
      if (!req.spread && a.rank !== b.rank) return a.rank - b.rank;
      return near ? dist(a, near) - dist(b, near) : (a.id < b.id ? -1 : 1);
    });
    this._set(holder, slot, cands[0].id);
    return cands[0];
  };
  /**
   * Reserve an ad-hoc standing point (hand-off / meeting / chat). Tries p, then rings around p (0.9 m, 1.4 m,
   * 8 angles each). Keeps the current point if it is within 0.3 m of p. Returns {x,z} or null.
   */
  R.claimPoint = function (holder, slot, p, opts) {
    if (!finite(p)) return null;
    holder = String(holder);
    opts = opts || {};
    p = { x: Number(p.x), z: Number(p.z) };
    var cur = this.of(holder, slot);
    if (cur && cur.point && dist(cur, p) <= 0.3 && this.clear(cur, holder) && (!this.pointOk || this.pointOk(cur))) return cur;
    var rings = opts.rings || [0, 0.9, 1.4], tries = [];
    rings.forEach(function (r) {
      if (!r) { tries.push(p); return; }
      for (var k = 0; k < 8; k++) { var a = k / 8 * Math.PI * 2; tries.push({ x: p.x + Math.cos(a) * r, z: p.z + Math.sin(a) * r }); }
    });
    for (var i = 0; i < tries.length; i++) {
      var t = tries[i];
      if (!this.clear(t, holder)) continue;
      if (this.pointOk && !this.pointOk(t)) continue; // nav recovery: not standable / not reachable
      var onSpot = false;
      for (var j = 0; j < this.spots.length; j++) {
        var s = this.spots[j], h = this.holderOf[s.id];
        if (h != null && h !== holder && dist(s, t) < this.minGap) { onSpot = true; break; }
      }
      if (onSpot) continue;
      var v = { x: t.x, z: t.z, point: true };
      this._set(holder, slot, v);
      return v;
    }
    return null;
  };
  R.release = function (holder, slot) {
    holder = String(holder);
    var h = this.held[holder];
    if (!h) return false;
    var self = this, had = false;
    (slot ? [slot] : Object.keys(h)).forEach(function (sl) {
      var v = h[sl];
      if (!v) return;
      if (!v.point && self.holderOf[v] === holder) delete self.holderOf[v];
      delete h[sl]; had = true;
    });
    if (!Object.keys(h).length) delete this.held[holder];
    return had;
  };
  /** Invariant check for tests / diagnostics: [] when nobody shares a spot or stands within minGap of another. */
  R.conflicts = function () {
    var out = [], pos = this.positions(), seen = {}, self = this;
    pos.forEach(function (p) {
      if (p.id) { if (seen[p.id] && seen[p.id] !== p.holder) out.push('spot ' + p.id + ' held by ' + seen[p.id] + ' and ' + p.holder); seen[p.id] = p.holder; }
    });
    for (var i = 0; i < pos.length; i++) for (var j = i + 1; j < pos.length; j++) {
      if (pos[i].holder !== pos[j].holder && dist(pos[i], pos[j]) < self.minGap - 1e-6) out.push(pos[i].holder + ' and ' + pos[j].holder + ' within ' + dist(pos[i], pos[j]).toFixed(2) + ' m');
    }
    return out;
  };
  R.snapshot = function () {
    var self = this, out = {};
    Object.keys(this.held).forEach(function (h) {
      out[h] = {};
      Object.keys(self.held[h]).forEach(function (sl) { var v = self.held[h][sl]; out[h][sl] = v.point ? 'point ' + v.x.toFixed(1) + ',' + v.z.toFixed(1) : v; });
    });
    return { spots: this.spots.length, held: out, conflicts: this.conflicts(), unreachable: Object.keys(this.unreachable) };
  };

  /** Stable preferred Fun Wing pad for a seat (what idleSpotForAgent used to return, now only a preference). */
  function preferredPad(reg, id) {
    var pads = reg.spots.filter(function (s) { return s.rank === 0 && s.groups.indexOf('idle') >= 0; });
    if (!pads.length) return null;
    var h = 0, sid = String(id || '');
    for (var i = 0; i < sid.length; i++) h = ((h << 5) - h + sid.charCodeAt(i)) | 0;
    return pads[Math.abs(h) % pads.length];
  }

  return { MIN_GAP: MIN_GAP, catalog: catalog, Registry: Registry, preferredPad: preferredPad, dist: dist, faceTo: faceTo };
});
