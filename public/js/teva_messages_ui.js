/* TEVA HQ Phase 1 ops: pure helpers for instruction lifecycle UI + attention merge.
 * No THREE, no DOM. Loaded by office.html; tested by tests/test_teva_messages_ui.js.
 *
 * Honesty: Observed (Cursor turn end) ≠ Responded (Steve record) ≠ work applied.
 * Delivery statuses never include EXECUTED.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TevaMessagesUi = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var LC_STEPS = ['QUEUED', 'DELIVERING', 'DELIVERED', 'ACKNOWLEDGED', 'RESPONDED'];
  var OPEN_CANCEL = ['QUEUED', 'DELIVERING', 'DELIVERED', 'FAILED', 'ACKNOWLEDGED'];
  var HONESTY = 'Observed ≠ Responded ≠ work applied. Executed is never a message status.';

  function lcOrder(status) {
    if (status === 'FAILED' || status === 'CANCELLED' || status === 'EXPIRED') return -1;
    var i = LC_STEPS.indexOf(status);
    return i < 0 ? 0 : i;
  }

  /** Label for observed_outcome chip: success | fail | — */
  function observedLabel(outcome) {
    if (!outcome || !outcome.endStatus) return 'Observed: —';
    var s = String(outcome.endStatus);
    if (s === 'success') return 'Observed: success';
    return 'Observed: fail (' + s + ')';
  }

  function observedOk(outcome) {
    return !!(outcome && outcome.endStatus === 'success');
  }

  /** Which action buttons the lifecycle panel should offer. */
  function actionFlags(msg) {
    var st = (msg && msg.status) || '';
    return {
      handoff: st === 'DELIVERING' && !!(msg.handoff && msg.handoff.url),
      acknowledge: st === 'DELIVERED',
      respond: st === 'DELIVERED' || st === 'ACKNOWLEDGED',
      retry: st === 'FAILED',
      cancel: OPEN_CANCEL.indexOf(st) >= 0
    };
  }

  /**
   * Merge FAILED-instruction seats into a VOE.attention list.
   * Order: needs-steve → blocked → failed-instruction → your-turn.
   * Skips seats already present.
   */
  function mergeFailedAttention(attnList, failedSeatIds) {
    var out = (attnList || []).slice();
    var seen = {};
    out.forEach(function (x) { if (x && x.seat) seen[x.seat] = true; });
    var failed = [];
    (failedSeatIds || []).forEach(function (id) {
      if (!id || seen[id] || id === 'needs-steve') return;
      seen[id] = true;
      failed.push({ seat: id, why: 'failed-instruction', count: 1 });
    });
    if (!failed.length) return out;
    var head = [], tail = [];
    out.forEach(function (x) {
      if (x.why === 'your-turn') tail.push(x);
      else head.push(x);
    });
    return head.concat(failed, tail);
  }

  /** Collect seat ids with FAILED messages from SEAT_MESSAGES map and agent.messaging.failedOpen. */
  function failedSeatsFrom(agents, seatMessages) {
    var ids = {}, list = [];
    (agents || []).forEach(function (a) {
      if (a && a.id && a.messaging && a.messaging.failedOpen) ids[a.id] = true;
    });
    Object.keys(seatMessages || {}).forEach(function (aid) {
      var rows = seatMessages[aid] || [];
      for (var i = 0; i < rows.length; i++) {
        if (rows[i] && rows[i].status === 'FAILED') { ids[aid] = true; break; }
      }
    });
    Object.keys(ids).forEach(function (id) { list.push(id); });
    return list;
  }

  function whyToast(why) {
    if (why === 'needs-steve') return 'waiting on you';
    if (why === 'blocked') return 'blocked';
    if (why === 'failed-instruction') return 'instruction FAILED';
    if (why === 'your-turn') return 'your turn';
    return why || 'needs you';
  }

  return {
    LC_STEPS: LC_STEPS,
    HONESTY: HONESTY,
    lcOrder: lcOrder,
    observedLabel: observedLabel,
    observedOk: observedOk,
    actionFlags: actionFlags,
    mergeFailedAttention: mergeFailedAttention,
    failedSeatsFrom: failedSeatsFrom,
    whyToast: whyToast
  };
});
