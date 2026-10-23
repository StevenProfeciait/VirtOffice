/* TEVA HQ zone use (2026-10-22, Steve: "the boardroom and other spaces go unused").
 *
 * Pure: no THREE, no DOM, no randomness, so tests/test_teva_zones.js can drive it. office.html asks it where a
 * seat should be; every placement comes from a real event or a real base state (vo_events.js), never invented:
 *  - BOARDROOM: a board hand-off (owner change on a backlog line) brings giver and receiver to the boardroom
 *    for a short hand-off review; a BA board round (BA writes a board doc) and an SA review (SA writes a review /
 *    gate doc, or its task line says review / PASS / FAIL) bring that seat there. Sessions last SESSION_MS and
 *    end early the moment the seat starts real work (TYPING / RUNNING / DELEGATING), is BLOCKED or goes OFFLINE:
 *    active work always happens at the desk.
 *  - RESEARCH LAB: research seats that are READING (search / read / fetch tools) sit in the Research Lab;
 *    they stay at least RESEARCH_DWELL_MS after the last READING so short tool bursts do not ping-pong them.
 *  - DESKS for active work (TYPING / RUNNING / DELEGATING / AT_DESK / THINKING): the default; nothing to do here.
 *  - FUN WING / break areas: idle + ambient only (office.html idleSpotForAgent + teva_ambient.js), unchanged.
 * See docs/TEVA_HQ_ZONES_RESEARCH.md for the research behind this.
 */
(function (root, factory) {
  var isNode = typeof module === 'object' && module.exports;
  var api = factory(isNode ? require('./teva_spots.js') : root.TevaSpots);
  if (isNode) module.exports = api;
  else root.TevaZones = api;
})(typeof self !== 'undefined' ? self : this, function (Spots) {
  'use strict';
  var SESSION_MS = 25000;          // a boardroom session (review / hand-off / board round), counted from arrival
  var TRAVEL_MAX_MS = 90000;       // walking there may take this long at a natural pace (Fun Wing -> boardroom)
  var RESEARCH_DWELL_MS = 45000;   // linger in the Research Lab after the last READING
  var WORK_STATES = { TYPING: 1, RUNNING: 1, DELEGATING: 1 };
  var LEAVE_STATES = { BLOCKED: 1, ERROR: 1, OFFLINE: 1, MEETING: 1, YOUR_TURN: 1 }; // never moved (seat fix: + ERROR)
  var BOARD_DOC = /(COMPANY_BACKLOG|WORK_PLAN|TIMELINE_PRIORITIES|HIGHS_PARALLEL|BOARD)/i;
  var SA_DOC = /(^SA_|_SA_|REVIEW|GATE|AUDIT|VERDICT)/i;
  var SA_TASK = /\b(review|reviewing|PASS|FAIL|gate|sign-?off)\b/i;

  function finite(p) { return !!p && isFinite(Number(p.x)) && isFinite(Number(p.z)); }

  /** Standing spots around the boardroom table, matching office.html createCollabTable (long axis along z).
   *  [{x, z, face}] east side first, then west, then the two ends; face = heading toward the table. */
  function boardroomSlots(L) {
    var sp = L && L.meetingSpaces && L.meetingSpaces.boardroom;
    if (!sp) return [];
    var tx = Number(sp.x) || 0, tz = Number(sp.z) || 0, len = Number(sp.tableW) || 7.2, w = Number(sp.tableD) || 2.0;
    var n = Math.max(4, Number(sp.chairs) || 15), side = Math.max(2, n - 2), east = Math.ceil(side / 2), west = Math.floor(side / 2);
    var span = len * 0.85, out = [];
    function place(count, x, face) {
      for (var i = 0; i < count; i++) out.push({ x: x, z: tz + (count === 1 ? 0 : (i / (count - 1) - 0.5) * span), face: face });
    }
    // the real chairs (office.html createCollabTable: 0.75 m off the table edge); seat fix part 2: avatars sit
    place(east, tx + w / 2 + 0.75, -Math.PI / 2);
    place(west, tx - w / 2 - 0.75, Math.PI / 2);
    out.push({ x: tx, z: tz - len / 2 - 0.75, face: 0 });
    out.push({ x: tx, z: tz + len / 2 + 0.75, face: Math.PI });
    return out;
  }
  /** Reading spots in the Research Lab (meetingSpaces.research), one per research seat. */
  function researchSlots(L) {
    var sp = L && L.meetingSpaces && L.meetingSpaces.research;
    if (!sp) return [];
    var ids = sp.agentIds || [], n = Math.max(3, ids.length, Number(sp.chairs) || 3), r = Number(sp.radius) || 2.2, out = []; // the lab's chairs
    for (var i = 0; i < n; i++) {
      var a = (i / n) * Math.PI * 2;
      var x = Number(sp.x) + Math.cos(a) * r, z = Number(sp.z) + Math.sin(a) * r;
      out.push({ x: x, z: z, face: Math.atan2(Number(sp.x) - x, Number(sp.z) - z) });
    }
    return out;
  }
  function isResearchSeat(L, id) {
    var sp = L && L.meetingSpaces && L.meetingSpaces.research;
    return !!(sp && (sp.agentIds || []).indexOf(id) >= 0) || /research/.test(String(id || ''));
  }

  /** Which boardroom session (if any) a real event opens. Returns null or
   *  { kind, seats: [ids], label, source }. Events come from vo_events.js deriveEvents (all sourced). */
  function sessionForEvent(e) {
    if (!e || !e.type) return null;
    var d = e.detail || {};
    if (e.type === 'handoff' && d.from && d.to && d.from !== d.to && d.from !== 'needs-steve' && d.to !== 'needs-steve') {
      return { kind: 'handoff-review', seats: [d.from, d.to], label: 'Hand-off review' + (d.id ? ' · ' + d.id : ''), source: e.source };
    }
    if (e.type === 'docWritten' && e.seat === 'ba' && BOARD_DOC.test(String(d.name || ''))) {
      return { kind: 'board-round', seats: ['ba'], label: 'BA board round · ' + String(d.name || '').replace(/\.md$/, ''), source: e.source };
    }
    if (e.seat === 'sa' && ((e.type === 'docWritten' && SA_DOC.test(String(d.name || ''))) || (e.type === 'taskChange' && SA_TASK.test(String(d.task || ''))))) {
      return { kind: 'sa-review', seats: ['sa'], label: 'SA review' + (d.name ? ' · ' + String(d.name).replace(/\.md$/, '') : ''), source: e.source };
    }
    return null;
  }

  function Zones(opts) {
    opts = opts || {};
    this.layout = opts.layout || null;
    this.sessionMs = opts.sessionMs || SESSION_MS;
    this.dwellMs = opts.dwellMs || RESEARCH_DWELL_MS;
    this.slots = boardroomSlots(this.layout);
    this.rslots = researchSlots(this.layout);
    // Seat fix (2026-10-22): boardroom and lab chairs are reserved in the shared TevaSpots registry (office.html
    // passes the office-wide one), so a chair holds one avatar and nobody else's spot can overlap it.
    this.spots = opts.spots || (Spots ? new Spots.Registry(Spots.catalog(null, { boardroom: this.slots, research: this.rslots })) : null);
    this.sessions = [];        // [{kind, seats, label, source, until, slotOf:{id:spotId}, speaker}]
    this.reading = {};         // id -> last time seen READING
    this.atLab = {};           // id -> true while placed in the Research Lab
  }
  var P = Zones.prototype;
  P._chairs = function (place) { return this.spots ? this.spots.spots.filter(function (s) { return s.place === place; }) : []; };
  P._drop = function (s, id) { delete s.slotOf[id]; if (this.spots && !this.atLab[id]) this.spots.release(id, 'zone'); };
  P.taken = function () { var t = {}; this.sessions.forEach(function (s) { for (var k in s.slotOf) t[s.slotOf[k]] = 1; }); return t; };
  /** Open a session for a real event. bases: {id: baseState}. Seats that are working, blocked, offline or in
   *  a backlog meeting are skipped. Returns the session (with the seats that actually go) or null. */
  P.open = function (sess, now, bases) {
    var chairs = this._chairs('boardroom');
    if (!sess || !chairs.length) return null;
    bases = bases || {};
    var self = this, go = sess.seats.filter(function (id) { var b = bases[id]; return b && !WORK_STATES[b] && !LEAVE_STATES[b]; });
    if (!go.length) return null;
    // a seat already in a session moves to the newest one
    this.sessions.forEach(function (s) { go.forEach(function (id) { if (s.slotOf[id] != null) self._drop(s, id); }); });
    this.sessions = this.sessions.filter(function (s) { return Object.keys(s.slotOf).length; });
    var slotOf = {}, prev = null;
    // seats of one session sit next to each other: each prefers the chair after the previous member's
    go.forEach(function (id) {
      if (self.atLab[id]) { delete self.atLab[id]; }
      var k = prev ? chairs.indexOf(prev) + 1 : 0, prefer = null;
      for (; k < chairs.length && !prefer; k++) if (self.spots.free(chairs[k], id)) prefer = chairs[k];
      var sp = self.spots.claim(id, 'zone', { places: ['boardroom'], prefer: prefer ? prefer.id : null, near: prev || chairs[0] });
      if (sp) { slotOf[id] = sp.id; prev = sp; }
    });
    if (!Object.keys(slotOf).length) return null;
    var s = { kind: sess.kind, seats: Object.keys(slotOf), label: sess.label, source: sess.source, until: now + TRAVEL_MAX_MS + this.sessionMs, slotOf: slotOf, arrived: {}, speaker: Object.keys(slotOf)[0] };
    this.sessions.push(s);
    return s;
  };
  /** Advance: end expired sessions, drop seats that started real work. Returns ids whose placement changed. */
  P.tick = function (now, bases) {
    bases = bases || {};
    var changed = [], self = this;
    this.sessions.forEach(function (s) {
      Object.keys(s.slotOf).forEach(function (id) {
        var b = bases[id];
        if (now >= s.until || !b || WORK_STATES[b] || LEAVE_STATES[b]) { self._drop(s, id); changed.push(id); }
      });
    });
    this.sessions = this.sessions.filter(function (s) { return Object.keys(s.slotOf).length; });
    Object.keys(bases).forEach(function (id) {
      if (!isResearchSeat(self.layout, id)) return;
      var b = bases[id];
      if (b === 'READING') self.reading[id] = now;
      var want = !!self.rslots.length && (b === 'READING' || ((b === 'THINKING' || b === 'AT_DESK') && self.reading[id] != null && now - self.reading[id] < self.dwellMs));
      if (WORK_STATES[b] || LEAVE_STATES[b] || b === 'IDLE' || b === 'WAITING') want = b === 'READING';
      if (want && self.session(id)) want = false; // a boardroom session wins
      if (want && !self.atLab[id]) {
        var chairs = self._chairs('research'), ids = (self.layout.meetingSpaces.research.agentIds || []), k = ids.indexOf(id);
        var pref = chairs[k >= 0 ? k % chairs.length : 0];
        if (self.spots && self.spots.claim(id, 'zone', { places: ['research'], prefer: pref ? pref.id : null, near: pref })) { self.atLab[id] = true; changed.push(id); }
      } else if (!want && self.atLab[id]) {
        delete self.atLab[id]; if (self.spots) self.spots.release(id, 'zone'); changed.push(id);
      }
    });
    return changed;
  };
  /** A seat reached its boardroom spot. When every seat of the session is there, it lasts sessionMs more. */
  P.arrived = function (id, now) {
    var s = this.session(id);
    if (!s || s.arrived[id]) return false;
    s.arrived[id] = now;
    var all = Object.keys(s.slotOf).every(function (k) { return s.arrived[k]; });
    if (all) s.until = Math.min(s.until, now + this.sessionMs);
    return true;
  };
  P.session = function (id) { for (var i = 0; i < this.sessions.length; i++) if (this.sessions[i].slotOf[id] != null) return this.sessions[i]; return null; };
  /** Where a seat should be because of a zone, or null (desk / idle spot as usual):
   *  {x, z, face, zone, kind, label, sit, activity, speaker, talking}. In the boardroom everyone faces the speaker
   *  (the seat whose event opened the session, e.g. the hand-off giver); the speaker faces the table. */
  P.target = function (id) {
    var s = this.session(id), sp;
    if (s && this.spots && (sp = this.spots.spot(s.slotOf[id]))) {
      var face = sp.face, spk = s.speaker !== id && this.spots.spot(s.slotOf[s.speaker]);
      if (spk) face = Math.atan2(spk.x - sp.x, spk.z - sp.z);
      return { x: sp.x, z: sp.z, face: face, zone: 'boardroom', kind: s.kind, label: s.label, sit: true, activity: 'meet', speaker: s.speaker, talking: s.speaker === id };
    }
    if (this.atLab[id] && this.spots && (sp = this.spots.of(id, 'zone'))) {
      return { x: sp.x, z: sp.z, face: sp.face, zone: 'research', kind: 'reading', label: 'Reading in the Research Lab', sit: true, activity: 'read' };
    }
    return null;
  };
  P.snapshot = function () {
    return { sessions: this.sessions.map(function (s) { return { kind: s.kind, label: s.label, seats: Object.keys(s.slotOf), until: s.until, source: s.source }; }),
      lab: Object.keys(this.atLab), conflicts: this.spots ? this.spots.conflicts() : [] };
  };

  return { Zones: Zones, sessionForEvent: sessionForEvent, boardroomSlots: boardroomSlots, researchSlots: researchSlots, isResearchSeat: isResearchSeat,
    SESSION_MS: SESSION_MS, TRAVEL_MAX_MS: TRAVEL_MAX_MS, RESEARCH_DWELL_MS: RESEARCH_DWELL_MS, WORK_STATES: WORK_STATES, finite: finite };
});
