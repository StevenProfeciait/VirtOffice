/* TEVA HQ ambient mode (2026-10-21): opt-in, decorative idle life for IDLE/WAITING seats.
 *
 * Pure scheduler: no THREE, no DOM, injectable rand, so tests/test_teva_ambient.js can drive it.
 * office.html owns rendering. Honesty contract (see docs/TEVA_HQ_NOTES.md "Ambient mode"):
 *  - ambient motion never writes to the Activity feed and never changes status, stats or counters;
 *  - only IDLE / WAITING seats take part (never OFFLINE, working, meeting, blocked or needs-steve);
 *  - any real event for a seat cancels its ambient action at once (office.html calls cancel()).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TevaAmbient = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  var FIDGETS = ['stretch', 'leanBack', 'lookAround', 'sip'];
  var FIDGET_DUR = { stretch: 2.2, leanBack: 3.0, lookAround: 2.8, sip: 2.6 }; // seconds
  var ELIGIBLE = { IDLE: true, WAITING: true };
  var DEFAULTS = {
    walkGapMin: 20000, walkGapMax: 40000,   // one new walk every 20-40 s
    firstWalkMin: 3000, firstWalkMax: 8000, // first walk soon after the mode turns on
    maxWalkers: 2,                          // at most two seats away from their spot at once
    fidgetMin: 7000, fidgetMax: 19000,      // per-seat fidget gap, then per-seat jitter on top
    pauseMin: 5000, pauseMax: 10000,        // linger at a place
    chatPauseMin: 6000, chatPauseMax: 11000,
    chatChance: 0.35,
    maxTripDist: 48                         // prefer places within this many metres of the seat
  };

  function eligible(id, base) { return !!id && id !== 'needs-steve' && !!ELIGIBLE[base]; }

  function hash01(id) {
    var h = 2166136261, s = String(id || '');
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return ((h >>> 0) % 10007) / 10007;
  }

  function finite(p) { return !!p && isFinite(Number(p.x)) && isFinite(Number(p.z)); }

  /** Places an idle seat may stroll to, from the real floor plan (public/office_layout.js). */
  function destinations(L) {
    var out = [], a = (L && L.anchors) || {}, fw = L && L.funWing;
    function add(name, label, p, spread) { if (finite(p)) out.push({ name: name, label: label, x: Number(p.x), z: Number(p.z), spread: spread }); }
    add('coffee', 'coffee corner', a.kitchen, 1.2);
    add('lounge', 'lounge', a.lounge, 1.4);
    add('cyber', 'Cyber Lounge', a.cyberLounge, 2.2);
    if (fw && finite({ x: fw.centerX, z: fw.centerZ })) {
      [['snackStrip', 'Fun Wing snacks', 1.6], ['arcadeRow', 'Fun Wing arcade', 2.0], ['chillPit', 'Fun Wing chill pit', 1.4]].forEach(function (d) {
        var p = fw[d[0]];
        if (finite(p)) add('fun-' + d[0], d[1], { x: fw.centerX + Number(p.x), z: fw.centerZ + Number(p.z) }, d[2]);
      });
    }
    return out;
  }

  /** Which walled area a point is in: main floor, Fun Wing (east) or collab terrace (south). */
  function region(L, p) {
    var hw = (L && L.room ? L.room.width : 72) / 2, hd = (L && L.room ? L.room.depth : 54) / 2;
    if (p.x > hw) return 'fun';
    if (p.z > hd) return 'wing';
    return 'main';
  }
  function doorPoints(L, r, inward) {
    var hw = (L && L.room ? L.room.width : 72) / 2, hd = (L && L.room ? L.room.depth : 54) / 2;
    var fz = L && L.funWing && isFinite(L.funWing.centerZ) ? Number(L.funWing.centerZ) : 12; // glass corridor centre
    var dx = (L && L.anchors && L.anchors.doorway && isFinite(L.anchors.doorway.x)) ? Number(L.anchors.doorway.x) : 0;
    if (r === 'fun') return inward ? [{ x: hw + 1.4, z: fz }, { x: hw - 1.4, z: fz }] : [{ x: hw - 1.4, z: fz }, { x: hw + 1.4, z: fz }];
    if (r === 'wing') return inward ? [{ x: dx, z: hd + 1.4 }, { x: dx, z: hd - 1.4 }] : [{ x: dx, z: hd - 1.4 }, { x: dx, z: hd + 1.4 }];
    return [];
  }
  /** Waypoints from -> to (excluding from) that go through the real openings instead of walls. */
  function route(L, from, to) {
    var r1 = region(L, from), r2 = region(L, to), pts = [];
    if (r1 !== r2) {
      if (r1 !== 'main') pts = pts.concat(doorPoints(L, r1, true));
      if (r2 !== 'main') pts = pts.concat(doorPoints(L, r2, false));
    }
    pts.push({ x: Number(to.x), z: Number(to.z) });
    return pts;
  }

  function dist(a, b) { var dx = a.x - b.x, dz = a.z - b.z; return Math.sqrt(dx * dx + dz * dz); }

  function Scheduler(opts) {
    this.o = Object.assign({}, DEFAULTS, opts || {});
    this.rand = this.o.rand || Math.random;
    this.layout = this.o.layout || null;
    this.dests = this.o.destinations || destinations(this.layout);
    // Seat fix (2026-10-22): with a TevaSpots registry every ambient leg reserves a real spot (slot 'away') and
    // releases it the moment the seat walks off; destinations are then the registry's ambient places, spread out.
    this.spots = this.o.spots || null;
    this.seats = {};
    this.nextWalkAt = 0;
  }
  var P = Scheduler.prototype;
  P.span = function (a, b) { return a + (b - a) * this.rand(); };
  P.pick = function (list) { return list[Math.min(list.length - 1, Math.floor(this.rand() * list.length))]; };
  P.state = function (id, now) {
    var s = this.seats[id];
    if (!s) {
      // per-seat jitter so seats never fidget in sync: offset by a stable hash of the id
      s = this.seats[id] = { act: null, nextFidget: now + 1500 + hash01(id) * 9000 + this.span(0, 2500), fidgetScale: 0.75 + hash01(id + ':f') * 0.6 };
    }
    return s;
  };
  P.active = function (id) { var s = this.seats[id]; return !!(s && s.act); };
  P.moving = function (id) { var s = this.seats[id]; return !!(s && s.act && (s.act.phase === 'out' || s.act.phase === 'back')); };
  P.walkers = function () {
    var n = 0;
    for (var id in this.seats) { var a = this.seats[id].act; if (a && a.kind !== 'host') n++; }
    return n;
  };
  /** Current walk target {x,z} for a seat with an ambient action, or null (stay at its spot). */
  P.target = function (id) {
    var s = this.seats[id], a = s && s.act;
    if (!a || a.kind === 'host') return null;
    if (a.phase === 'pause') return a.dest;
    return a.path[Math.min(a.i, a.path.length - 1)] || null;
  };
  /** What a seat should face while lingering: {seat: id} for a chat partner, {x,z} for a place, or null. */
  P.facing = function (id) {
    var s = this.seats[id], a = s && s.act;
    if (!a) return null;
    if (a.kind === 'host') return a.phase === 'chat' ? a.faceSeat : null;
    if (a.phase !== 'pause') return null;
    return a.kind === 'visit' ? a.faceSeat : a.look;
  };
  P.talking = function (id) {
    var s = this.seats[id], a = s && s.act;
    return !!(a && ((a.kind === 'visit' && a.phase === 'pause') || (a.kind === 'host' && a.phase === 'chat')));
  };

  P.sendBack = function (id, now) {
    var s = this.seats[id], a = s && s.act;
    if (!a || a.kind === 'host') { if (s) s.act = null; return; }
    var here = a.phase === 'pause' ? a.dest : (a.path[Math.min(a.i, a.path.length - 1)] || a.rest);
    if (this.spots) this.spots.release(id, 'away'); // leaving the spot frees it
    a.phase = 'back'; a.path = route(this.layout, here, a.rest); a.i = 0;
    if (a.partner) { var ps = this.seats[a.partner]; if (ps && ps.act && ps.act.kind === 'host') ps.act = null; a.partner = null; a.faceSeat = null; }
  };

  /** A real event (or a state change) for this seat: drop its ambient action now. Returns true if one ran. */
  P.cancel = function (id, now) {
    var s = this.seats[id];
    if (!s || !s.act) return false;
    var a = s.act;
    s.act = null;
    if (this.spots) this.spots.release(id, 'away');
    if (a.partner) {
      var ps = this.seats[a.partner];
      if (ps && ps.act) {
        if (ps.act.kind === 'host') ps.act = null;
        else { ps.act.partner = null; this.sendBack(a.partner, now); } // the visitor walks home
      }
    }
    return true;
  };
  P.reset = function () { for (var id in this.seats) { this.seats[id].act = null; if (this.spots) this.spots.release(id, 'away'); } this.nextWalkAt = 0; };

  /** A walking seat reached its current waypoint. Returns 'next' | 'paused' | 'home' | null. */
  P.arrived = function (id, now) {
    var s = this.seats[id], a = s && s.act;
    if (!a || a.kind === 'host' || a.phase === 'pause') return null;
    if (a.i < a.path.length - 1) { a.i++; return 'next'; }
    if (a.phase === 'out') {
      a.phase = 'pause';
      a.until = now + (a.kind === 'visit' ? this.span(this.o.chatPauseMin, this.o.chatPauseMax) : this.span(this.o.pauseMin, this.o.pauseMax));
      if (a.kind === 'visit' && a.partner) {
        var ps = this.seats[a.partner];
        if (ps && ps.act && ps.act.kind === 'host') ps.act.phase = 'chat';
      }
      return 'paused';
    }
    s.act = null;
    if (this.spots) this.spots.release(id, 'away');
    s.nextFidget = Math.max(s.nextFidget, now + 2500);
    return 'home';
  };

  /**
   * One scheduler step (office.html calls it once a second).
   * list: [{id, base, busy, x, z, restX, restZ}]  (busy = a real overlay is running on the seat)
   * Returns { fidgets: [{id, name, dur}], started: [{id, kind, to, label}], cancelled: [id], changed }
   */
  P.tick = function (now, list) {
    var out = { fidgets: [], started: [], cancelled: [], changed: false }, self = this, byId = {};
    (list || []).forEach(function (s) { byId[s.id] = s; });
    Object.keys(this.seats).forEach(function (id) {
      var s = byId[id];
      if ((!s || !eligible(s.id, s.base) || s.busy) && self.seats[id].act) { self.cancel(id, now); out.cancelled.push(id); out.changed = true; }
      if (!s) delete self.seats[id];
    });
    var free = [];
    (list || []).forEach(function (s) {
      if (!eligible(s.id, s.base) || s.busy) return;
      var st = self.state(s.id, now), a = st.act;
      if (a && a.phase === 'pause' && a.kind !== 'host' && now >= a.until) { self.sendBack(s.id, now); out.changed = true; }
      a = st.act;
      var lingering = a && (a.phase === 'pause' || (a.kind === 'host' && a.phase === 'chat'));
      if ((!a || lingering) && now >= st.nextFidget) {
        var name = a && a.kind === 'trip' && (a.activity === 'coffee' || /coffee|snack/.test(a.label || '')) ? 'sip' : self.pick(lingering ? ['lookAround', 'sip', 'leanBack'] : FIDGETS);
        out.fidgets.push({ id: s.id, name: name, dur: FIDGET_DUR[name] });
        st.nextFidget = now + self.span(self.o.fidgetMin, self.o.fidgetMax) * st.fidgetScale;
      }
      if (!st.act) free.push(s);
    });
    if (!this.nextWalkAt) this.nextWalkAt = now + this.span(this.o.firstWalkMin, this.o.firstWalkMax);
    if (now >= this.nextWalkAt) {
      this.nextWalkAt = now + this.span(this.o.walkGapMin, this.o.walkGapMax);
      if (this.walkers() < this.o.maxWalkers && free.length) {
        var who = this.pick(free), rest = { x: Number(who.restX), z: Number(who.restZ) }, from = { x: Number(who.x), z: Number(who.z) };
        if (!finite(rest)) rest = from;
        var partners = free.filter(function (p) { return p.id !== who.id && dist(rest, { x: Number(p.restX), z: Number(p.restZ) }) <= self.o.maxTripDist; });
        var st = this.seats[who.id];
        var chat = partners.length && this.rand() < this.o.chatChance, pal = null, spot = null;
        if (chat) {
          pal = this.pick(partners);
          var pr = { x: Number(pal.restX), z: Number(pal.restZ) };
          var dx = rest.x - pr.x, dz = rest.z - pr.z, d = Math.sqrt(dx * dx + dz * dz) || 1;
          spot = { x: pr.x + dx / d * 1.1, z: pr.z + dz / d * 1.1 };
          if (this.spots) { spot = this.spots.claimPoint(who.id, 'away', spot, { rings: [0, 0.9] }); if (!spot) chat = false; else spot = { x: spot.x, z: spot.z }; }
        }
        if (chat) {
          st.act = { kind: 'visit', phase: 'out', rest: rest, dest: spot, path: route(this.layout, from, spot), i: 0, partner: pal.id, faceSeat: { seat: pal.id }, label: 'chat' };
          this.seats[pal.id].act = { kind: 'host', phase: 'wait', partner: who.id, faceSeat: { seat: who.id } };
          out.started.push({ id: who.id, kind: 'visit', to: pal.id, label: 'chat' });
        } else {
          if (this.spots) {
            // spread: least-used ambient place within reach (not the one the seat rests in), then its nearest free spot
            var R = this.spots, places = R.places('ambient').filter(function (pl) { var c = R.center(pl); return c && dist(rest, c) <= self.o.maxTripDist && dist(rest, c) > 2.5; });
            var sp = places.length ? R.claim(who.id, 'away', { places: places, spread: true, near: rest, rand: this.rand }) : null;
            if (sp) {
              var lookAt = Number.isFinite(sp.face) ? { x: sp.x + Math.sin(sp.face), z: sp.z + Math.cos(sp.face) } : R.center(sp.place);
              var dst = { x: sp.x, z: sp.z };
              st.act = { kind: 'trip', phase: 'out', rest: rest, dest: dst, look: lookAt, path: route(this.layout, from, dst), i: 0, partner: null, label: sp.label, spot: sp.id, activity: sp.activity, sit: sp.sit };
              out.started.push({ id: who.id, kind: 'trip', to: sp.place, label: sp.label, spot: sp.id });
            }
          }
          var near = this.spots ? [] : this.dests.filter(function (d) { return dist(rest, d) <= self.o.maxTripDist && dist(rest, d) > 2.5; });
          if (!this.spots && !near.length && this.dests.length) near = this.dests.slice().sort(function (a, b) { return dist(rest, a) - dist(rest, b); }).slice(0, 2);
          if (near.length) {
            var d0 = this.pick(near), ang = this.rand() * Math.PI * 2, r = this.rand() * d0.spread;
            var dest = { x: d0.x + Math.cos(ang) * r, z: d0.z + Math.sin(ang) * r };
            st.act = { kind: 'trip', phase: 'out', rest: rest, dest: dest, look: { x: d0.x, z: d0.z }, path: route(this.layout, from, dest), i: 0, partner: null, label: d0.label };
            out.started.push({ id: who.id, kind: 'trip', to: d0.name, label: d0.label });
          }
        }
        if (out.started.length) out.changed = true;
      }
    }
    return out;
  };

  // ---- Cyberpunk / modular avatars (2026-10-22) ------------------------------------------------
  // The scheduler stays the single source of truth (it keeps driving office.html's hidden legacy seat
  // objects); these two pure helpers let office.html mirror it onto the modular (GLB) avatars.

  /** Route the modular avatar should walk for a seat's current ambient leg, or null (stay put).
   *  { key, dest:{x,z}, path:[{x,z}...] (waypoints before dest) }. key is stable for one leg ('out' and its
   *  'pause' share it) so office.html calls TevaAvatarManager.moveAgent once per leg, not every tick. */
  function modularRoute(sched, id) {
    var s = sched && sched.seats && sched.seats[id], a = s && s.act;
    if (!a || a.kind === 'host' || !a.path || !a.path.length) return null;
    var pts = [];
    for (var i = 0; i < a.path.length; i++) { if (!finite(a.path[i])) return null; pts.push({ x: Number(a.path[i].x), z: Number(a.path[i].z) }); }
    var dest = pts[pts.length - 1];
    return { key: (a.phase === 'back' ? 'back:' : 'out:') + pts.map(function (p) { return p.x.toFixed(2) + ',' + p.z.toFixed(2); }).join(';'),
      dest: dest, path: pts.slice(0, -1) };
  }

  /** Pose deltas (radians / metres) for a fidget at progress u (0..1), eased in and out, for the modular
   *  avatar's bones: body lean, head nod/turn, upper-arm raise (both sides), right forearm bend, hip lift.
   *  Zero outside 0 < u < 1 and for unknown names. Writes into `out` when given (no allocation). */
  var POSE_KEYS = ['bodyRx', 'headRx', 'headRy', 'lArm', 'rArm', 'rLow', 'y'];
  function modularPose(name, u, out) {
    out = out || {};
    for (var k = 0; k < POSE_KEYS.length; k++) out[POSE_KEYS[k]] = 0;
    if (!(u > 0 && u < 1)) return out;
    var e = Math.min(1, Math.sin(Math.PI * u) * 1.6);
    switch (name) {
      case 'stretch': out.lArm = 2.2 * e; out.rArm = 2.2 * e; out.bodyRx = -0.12 * e; out.headRx = -0.25 * e; out.y = 0.04 * e; break;
      case 'leanBack': out.bodyRx = -0.22 * e; out.headRx = -0.18 * e; out.lArm = 0.35 * e; out.rArm = 0.35 * e; break;
      case 'lookAround': out.headRy = Math.sin(u * Math.PI * 3) * 0.6 * e; out.headRx = -0.05 * e; break;
      case 'sip': out.rArm = 0.5 * e; out.rLow = 1.3 * e; out.headRx = -0.15 * e; break;
    }
    return out;
  }

  return { Scheduler: Scheduler, eligible: eligible, destinations: destinations, route: route, region: region, hash01: hash01, FIDGETS: FIDGETS, FIDGET_DUR: FIDGET_DUR, DEFAULTS: DEFAULTS,
    modularRoute: modularRoute, modularPose: modularPose, POSE_KEYS: POSE_KEYS };
});
