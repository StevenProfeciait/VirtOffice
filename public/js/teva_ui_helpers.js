/* TEVA HQ demo/real UI helpers. */
(function (root) {
  'use strict';
  var Act = root.TevaActivity || {};
  function computeMode(config, agents) {
    return (config && config.mode === 'demo') ? 'demo' : 'real';
  }
  function rowOf(id, val) { return '<div class="vp-row"><div class="vp-key">' + id + '</div><div class="vp-val">' + (val||'') + '</div></div>'; }
  root.TevaUIH = { computeMode: computeMode, rowOf: rowOf };
})(typeof window !== 'undefined' ? window : global);
