/* TEVA HQ Phase 2: pure helpers for the unassigned Cursor-chat mapping queue.
 * Candidates are display-only — never auto-assign. Steve confirms via /api/registry/map.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TevaMappingUi = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** Unassigned chats only, newest first (by lastActivity). */
  function unassignedQueue(chats) {
    return (chats || [])
      .filter(function (c) { return c && !c.seat; })
      .slice()
      .sort(function (a, b) { return (b.lastActivity || 0) - (a.lastActivity || 0); });
  }

  /** Candidate seat ids from a chat (already computed server-side). */
  function candidatesOf(chat) {
    var list = (chat && chat.candidates) || [];
    return list.filter(function (id) { return !!id; });
  }

  function isConflict(chat) {
    if (chat && chat.conflict) return true;
    return !!(chat && !chat.seat && candidatesOf(chat).length > 1);
  }

  /**
   * Build queue row model for UI: { id, title, evidence, conflict, candidates, state, lastActivity }.
   */
  function rowModel(chat) {
    if (!chat) return null;
    return {
      id: chat.id,
      title: chat.title || 'Untitled Cursor chat',
      evidence: chat.evidence || '',
      conflict: isConflict(chat),
      candidates: candidatesOf(chat),
      state: chat.state || '',
      lastActivity: chat.lastActivity || 0,
      step: chat.step || ''
    };
  }

  return {
    unassignedQueue: unassignedQueue,
    candidatesOf: candidatesOf,
    isConflict: isConflict,
    rowModel: rowModel
  };
});
