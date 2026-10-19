/* TEVA HQ camera helpers. */
(function (root) {
  'use strict';

  function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  root.TevaCam = {
    easeInOutCubic: easeInOutCubic,
    lerp: lerp
  };
})(typeof window !== 'undefined' ? window : global);
