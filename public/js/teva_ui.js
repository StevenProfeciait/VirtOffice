/* TEVA HQ UI helpers — small DOM-safe hooks used by the modular renderer. */
(function (root) {
  'use strict';
  function modeBadge(element, mode) {
    if (!element) return;
    var demo = mode === 'demo';
    element.textContent = demo ? 'DEMO DATA' : 'LIVE DATA';
    if (element.classList) element.classList.toggle('demo', demo);
  }
  function statusText(agent) {
    var activity = (agent && agent.activity) || {};
    return String(activity.presentationState || activity.state || (agent && agent.status) || 'idle');
  }
  root.TevaUI = root.TevaUI || {
    modeBadge: modeBadge,
    statusText: statusText,
    init: function (options) { return options || {}; },
    update: function (element, agent) { if (element) element.textContent = statusText(agent); },
    dispose: function () {}
  };
})(typeof window !== 'undefined' ? window : global);
