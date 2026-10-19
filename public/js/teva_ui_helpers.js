/* TEVA HQ demo/real UI helpers. */
(function (root) {
  'use strict';
  var Act = root.TevaActivity || {};
  function computeMode(config, agents) {
    if (Act.isDemo) return Act.isDemo(config, agents) ? 'demo' : 'real';
    return (config && config.mode === 'demo') ? 'demo' : 'real';
  }
  function rowOf(id, val) { return '<div class="vp-row"><div class="vp-key">' + id + '</div><div class="vp-val">' + (val||'') + '</div></div>'; }
  function displayFor(agent) { return Act.computeDisplay ? Act.computeDisplay(agent) : { state: Act.safeState(agent), provenance: 'server', demo: false }; }
  function provenanceFor(agent) {
    var d = displayFor(agent);
    return d.demo ? 'Simulated' : (d.observed ? 'Observed' : (d.provenance === 'user' ? 'Manual' : 'Reported'));
  }
  root.TevaUIH = { computeMode: computeMode, rowOf: rowOf, displayFor: displayFor, provenanceFor: provenanceFor };
})(typeof window !== 'undefined' ? window : global);
