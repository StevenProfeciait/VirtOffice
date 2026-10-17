/* TEVA HQ Phase 3a (R-VO-002): event layer + per-seat state machine. Pure functions, no DOM, no three.js.
 * Loaded by office.html before the main script, and by tests/test_vo_events.js under node.
 *
 * deriveEvents(prevAgents, nextAgents, now) diffs two /api/agents payloads into sourced events.
 *   - prevAgents null/undefined (first payload after a page load) => [] : nothing fires on load.
 *   - every event carries {seat, type, source, at, detail}; `source` is path:line or a chat id.
 * baseState(agent, now, seenAt) picks the continuous animation from real fields only
 *   (brief §3.3 priority table). No randomness anywhere in this file.
 */
(function (root) {
  'use strict';

  var KIND_STATE = { write: 'TYPING', edit: 'TYPING', reply: 'TYPING', read: 'READING', search: 'READING', fetch: 'READING', shell: 'RUNNING', task: 'DELEGATING' };
  var YOUR_TURN_MS = 30 * 60 * 1000;   // a successful turn end asks for Steve for 30 min
  var FAILED_MS = 15 * 60 * 1000;      // a failed turn keeps the seat BLOCKED for 15 min
  var THINK_DIM_MS = 10 * 60 * 1000;   // stale > 10 min: thinking glyph dims
  var THINK_MAX_MS = 60 * 60 * 1000;   // stale > 60 min: no longer animated as thinking (too old to be honest)
  var OVERLAY_GAP_MS = 4000;           // max one overlay per seat per 4 s; extra events go to the feed only
  var BASE_STATES = ['OFFLINE', 'BLOCKED', 'MEETING', 'TYPING', 'READING', 'RUNNING', 'DELEGATING', 'THINKING', 'YOUR_TURN', 'AT_DESK', 'IDLE'];
  var REACTIONS = {
    '1': { key: 'wave', emoji: '\uD83D\uDC4B', stored: false, overlay: 'wave', label: 'Wave' },
    '2': { key: 'thumbs', emoji: '\uD83D\uDC4D', stored: true, overlay: 'nod', label: 'Thumbs-up' },
    '3': { key: 'party', emoji: '\uD83C\uDF89', stored: true, overlay: 'party', label: 'Celebrate' },
    '4': { key: 'seen', emoji: '\uD83D\uDC40', stored: true, overlay: 'glance', label: 'Seen it' },
    '5': { key: 'poke', emoji: '\uD83D\uDC49', stored: false, overlay: 'startle', label: 'Poke' },
    '6': { key: 'hand', emoji: '\u270B', stored: true, overlay: 'raiseHand', label: 'Needs you' }
  };
  // Order in which one payload's events for the same seat compete for the single overlay slot
  var EVENT_PRIORITY = ['turnEnded', 'blocked', 'handoff', 'researchDone', 'needsSteveAdded', 'docWritten', 'inboxSaved', 'statusChange', 'unblocked', 'toolStart', 'stalled', 'taskChange', 'inboxRead'];

  function latest(a) { return (a && a.cursor && a.cursor.latest) || null; }
  function short(id) { return String(id || '').slice(0, 8); }
  function chatSource(c) { return c ? 'chat ' + short(c.id) + ' \u201c' + String(c.title || 'Untitled').slice(0, 48) + '\u201d' : 'Cursor'; }
  function lineSource(s) { if (!s) return 'board'; return (s.file || 'board') + (s.line ? ':' + s.line : ''); }
  function fileOf(p) { return String(p || '').split('/').pop() || 'TEVA_COMPANY_BACKLOG.md'; }
  function byId(list) { var o = {}; (list || []).forEach(function (a) { if (a && a.id != null) o[a.id] = a; }); return o; }
  function endOk(c) { return !!c && c.endStatus === 'success'; }
  function endFailed(c) { return !!c && !!c.endStatus && c.endStatus !== 'success'; }

  /** Continuous base state for a seat (brief §3.3). seenAt = local 👀 time for this seat's last turn end. */
  function baseState(a, now, seenAt) {
    if (!a) return 'IDLE';
    if (a.id === 'needs-steve') return 'IDLE';
    var c = latest(a);
    var hasChat = !!(a.cursor && a.cursor.count);
    if (a.signal === false && !hasChat) return 'OFFLINE';
    var endedAt = (c && c.endedAt) || 0;
    if (a.blocked) return 'BLOCKED';
    if (c && c.state === 'ended' && endFailed(c) && endedAt && now - endedAt < FAILED_MS) return 'BLOCKED';
    if (a.status === 'meeting') return 'MEETING';
    if (c && c.state === 'active') {
      var k = KIND_STATE[c.toolKind];
      if (k && k !== 'DELEGATING') return k;
      if (k === 'DELEGATING' || (c.subagents || 0) > 0) return 'DELEGATING';
      return 'AT_DESK'; // active with a tool we do not classify: slow typing, nothing invented
    }
    // YOUR_TURN still beats board WIP (Steve attention). Board working beats stale THINKING.
    if (c && c.state === 'ended' && endOk(c) && endedAt && now - endedAt < YOUR_TURN_MS && !(seenAt && seenAt >= endedAt)) return 'YOUR_TURN';
    if (a.status === 'working') return 'AT_DESK';
    if (c && c.state === 'stale' && c.lastActivity && now - c.lastActivity < THINK_MAX_MS) return 'THINKING';
    return 'IDLE';
  }

  function thinkingDim(a, now) { var c = latest(a); return !!(c && c.state === 'stale' && now - (c.lastActivity || 0) > THINK_DIM_MS); }
  function helperCount(a) { var c = latest(a); return c && c.state === 'active' ? Math.max(1, Math.min(3, c.subagents || 0)) : 0; }

  /** Diff two /api/agents payloads into typed, sourced events. */
  function deriveEvents(prev, next, now) {
    if (!Array.isArray(prev) || !Array.isArray(next)) return [];
    var P = byId(prev), out = [];
    function ev(seat, type, source, detail) { out.push({ seat: seat, type: type, source: source, at: now, detail: detail || {} }); }

    next.forEach(function (n) {
      var p = P[n.id];
      if (!p || n.id === 'needs-steve') return; // a seat that just appeared is seeded silently
      // ---- Cursor transcript signals
      var pc = latest(p), nc = latest(n);
      if (nc) {
        var same = pc && pc.id === nc.id;
        var src = chatSource(nc) + (nc.step ? ' \u00b7 ' + String(nc.step).slice(0, 80) : '');
        if (nc.state === 'active') {
          if (!same || pc.state !== 'active' || (pc.toolKind || null) !== (nc.toolKind || null)) {
            ev(n.id, 'toolStart', src, { chatId: nc.id, kind: nc.toolKind || null, step: nc.step || '' });
          }
        } else if (nc.state === 'ended') {
          var wasRunning = same && (pc.state === 'active' || pc.state === 'stale');
          var newEnd = same && pc.state === 'ended' && (nc.endedAt || 0) > (pc.endedAt || 0);
          var freshChat = !same && (nc.endedAt || 0) > ((pc && pc.lastActivity) || 0);
          if (wasRunning || newEnd || freshChat) {
            ev(n.id, 'turnEnded', chatSource(nc) + ' \u00b7 Turn ended (' + (nc.endStatus || 'status unknown') + ')',
              { chatId: nc.id, ok: nc.endStatus ? nc.endStatus === 'success' : null, endStatus: nc.endStatus || '' });
          }
        } else if (nc.state === 'stale' && same && pc.state === 'active') {
          ev(n.id, 'stalled', chatSource(nc) + ' \u00b7 no transcript write for 2 min', { chatId: nc.id });
        }
      }
      // ---- backlog status / blocked / task
      var ps = p.status || 'idle', ns = n.status || 'idle';
      if (ps !== ns) ev(n.id, 'statusChange', lineSource(n.source), { from: ps, to: ns });
      if (!!p.blocked !== !!n.blocked) {
        ev(n.id, n.blocked ? 'blocked' : 'unblocked', lineSource(n.blockedSource || p.blockedSource || n.source),
          { text: ((n.blockedSource || p.blockedSource || {}).text) || '' });
      }
      if ((p.task || '') !== (n.task || '') && ps === ns) ev(n.id, 'taskChange', lineSource(n.source), { task: n.task || '' });
      // ---- docs this seat owns (board fallback docs are never "this seat wrote a doc")
      if (n.docsOwned && p.docsOwned) {
        var pm = {}, pmax = 0;
        (p.docs || []).forEach(function (d) { pm[d.name] = d.mtime || 0; pmax = Math.max(pmax, d.mtime || 0); });
        var k = 0;
        (n.docs || []).forEach(function (d) {
          var was = pm[d.name];
          if (k < 3 && (was != null ? (d.mtime || 0) > was : (d.mtime || 0) > pmax)) {
            k++;
            ev(n.id, 'docWritten', 'docs/' + d.name + ' (mtime ' + (d.mtime || 0) + ')', { name: d.name, path: d.path, mtime: d.mtime });
          }
        });
      }
    });

    // ---- board-level signals live on the needs-steve entry
    var pn = P['needs-steve'], nn = byId(next)['needs-steve'];
    if (pn && nn) {
      var had = {};
      (pn.needsSteveItems || []).forEach(function (i) { had[i.text] = 1; });
      (nn.needsSteveItems || []).forEach(function (i) {
        if (!had[i.text]) ev('needs-steve', 'needsSteveAdded', fileOf(i.path) + ':' + i.line, { text: i.text, owner: i.owner || null, line: i.line });
      });
      var pb = pn.board || {}, nb = nn.board || {};
      var nowWip = {};
      (nb.researchWip || []).forEach(function (r) { nowWip[r.id] = 1; });
      var pDone = (pb.researchCounts || {}).Done || 0, nDone = (nb.researchCounts || {}).Done || 0;
      if (nDone > pDone) {
        (pb.researchWip || []).forEach(function (r) {
          if (!nowWip[r.id]) ev(r.owner || 'research-mgr', 'researchDone', fileOf(nb.researchPath || 'TEVA_RESEARCH_BACKLOG.md') + ':' + r.line, { id: r.id, item: r.item, owner: r.owner || null });
        });
      }
      var key = function (i) { return (i.doc || '') + '|' + i.id; };
      var pi = {};
      (pb.items || []).forEach(function (i) { pi[key(i)] = i; });
      (nb.items || []).forEach(function (i) {
        var o = pi[key(i)];
        if (o && o.owner && i.owner && o.owner !== i.owner) {
          var f = i.doc === 'research' ? fileOf(nb.researchPath || 'TEVA_RESEARCH_BACKLOG.md') : fileOf(nb.backlogPath || 'TEVA_COMPANY_BACKLOG.md');
          ev(o.owner, 'handoff', f + ':' + i.line, { from: o.owner, to: i.owner, id: i.id, title: i.title || '' });
        }
      });
    }
    out.sort(function (a, b) { return EVENT_PRIORITY.indexOf(a.type) - EVENT_PRIORITY.indexOf(b.type); });
    return out;
  }

  /** Inbox count diffs (GET /api/inbox counts). First call (prev null) is silent. */
  function deriveInboxEvents(prev, next, now) {
    if (!prev || !next) return [];
    var out = [];
    Object.keys(next).forEach(function (seat) {
      var p = prev[seat] || { sent: 0, unread: 0 }, n = next[seat] || { sent: 0, unread: 0 };
      if ((n.sent || 0) > (p.sent || 0)) out.push({ seat: seat, type: 'inboxSaved', source: 'inbox/' + seat + '.jsonl', at: now, detail: { kind: 'note', added: n.sent - p.sent } });
      if ((n.unread || 0) < (p.unread || 0)) out.push({ seat: seat, type: 'inboxRead', source: 'inbox/' + seat + '.read', at: now, detail: { read: p.unread - n.unread } });
    });
    return out;
  }

  /** Which overlay an event plays, and on which seat. null overlay = feed line only. */
  function overlayFor(e) {
    var d = e.detail || {};
    switch (e.type) {
      case 'turnEnded': return { seat: e.seat, overlay: d.ok === true ? 'celebrate' : (d.ok === false ? 'headScratch' : null) };
      case 'blocked': return { seat: e.seat, overlay: 'headScratch' };
      case 'docWritten': return { seat: e.seat, overlay: 'docPop' };
      case 'researchDone': return { seat: e.seat, overlay: 'confetti' };
      case 'needsSteveAdded': return { seat: d.owner || null, overlay: d.owner ? 'raiseHand' : null, beacon: true };
      case 'handoff': return { seat: d.from, overlay: 'handoff', to: d.to };
      case 'statusChange': return { seat: e.seat, overlay: d.to === 'working' ? 'stretch' : (d.from === 'working' && d.to === 'idle' ? 'leanBack' : null) };
      case 'inboxSaved': return { seat: e.seat, overlay: 'envelope' };
      case 'taskChange': return { seat: e.seat, overlay: 'bubble' };
      default: return { seat: e.seat, overlay: null };
    }
  }

  /** Per-seat overlay throttle: max one overlay per `gap` ms. */
  function Throttle(gap) { this.gap = gap == null ? OVERLAY_GAP_MS : gap; this.last = {}; }
  Throttle.prototype.allow = function (seat, now) {
    if (seat == null) return false;
    if (this.last[seat] != null && now - this.last[seat] < this.gap) return false;
    this.last[seat] = now; return true;
  };

  /** Seats that need Steve, in N-key order: Needs Steve desk -> blocked -> your-turn. */
  function attention(agents, now, seen) {
    seen = seen || {};
    var out = [], blocked = [], turn = [];
    (agents || []).forEach(function (a) {
      if (a.id === 'needs-steve') { if ((a.needsSteveItems || []).length) out.push({ seat: a.id, why: 'needs-steve', count: a.needsSteveItems.length }); return; }
      var b = baseState(a, now, seen[a.id]);
      if (b === 'BLOCKED') blocked.push({ seat: a.id, why: 'blocked', count: 1 });
      else if (b === 'YOUR_TURN') turn.push({ seat: a.id, why: 'your-turn', count: 1 });
    });
    return out.concat(blocked, turn);
  }
  function attentionCount(list) { return (list || []).reduce(function (s, x) { return s + (x.count || 1); }, 0); }

  var api = {
    baseState: baseState, deriveEvents: deriveEvents, deriveInboxEvents: deriveInboxEvents, overlayFor: overlayFor,
    Throttle: Throttle, attention: attention, attentionCount: attentionCount, thinkingDim: thinkingDim, helperCount: helperCount,
    chatSource: chatSource, lineSource: lineSource, REACTIONS: REACTIONS, BASE_STATES: BASE_STATES,
    YOUR_TURN_MS: YOUR_TURN_MS, FAILED_MS: FAILED_MS, OVERLAY_GAP_MS: OVERLAY_GAP_MS, THINK_DIM_MS: THINK_DIM_MS
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.VOE = api;
})(typeof window !== 'undefined' ? window : this);
