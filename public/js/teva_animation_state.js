/* TEVA HQ animation state mapper — connects VOE/Avatars/Activity to pose. */
(function (root) {
  'use strict';
  var Anim = root.TevaAnim || (root.TevaAnim = {});
  var Av = root.TevaAvatars || {};
  var VOE = root.VOE || {};

  Anim.mapBase = function (agent, now) {
    if (VOE && VOE.baseState) {
      var seen = (root.TEVA_SEEN || {})[agent.id];
      return VOE.baseState(agent, now, seen);
    }
    return Av.stateFromActivity ? Av.stateFromActivity(agent) : 'IDLE';
  };

  Anim.updateEntry = function (entry, agent, dt, now) {
    if (!entry) return;
    entry._t = (entry._t || 0) + (dt || 0);
    var state = Anim.mapBase(agent, now);
    var Manager = root.TevaAvatarManager || {};
    if (state !== entry.state && Av.clipFor && Manager.setState) {
      var clip = Av.clipFor(entry.avatar, state);
      Manager.setState(entry, state, clip);
    }
    return state;
  };
})(typeof window !== 'undefined' ? window : global);
