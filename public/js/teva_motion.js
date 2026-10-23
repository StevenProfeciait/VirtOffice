/* TEVA HQ walking & pose helpers (2026-10-22, Steve: "they move too fast ... and slide instead of walking").
 *
 * Pure: no THREE, no DOM, so tests/test_teva_motion.js can drive it. Used by office.html (Classic, legacy
 * instanced avatars) and public/js/teva_avatar_manager.js (Cyberpunk, modular avatars).
 *  - natural pace: real walks cap at WALK_SPEED (1.35 m/s, a relaxed indoor walk), ambient strolls at
 *    STROLL_SPEED (1.0 m/s); every route is timed from its length, never squeezed into a fixed duration;
 *  - ease in / out: trapezoid speed profile (accelerate, cruise, brake to a stop) instead of a linear slide;
 *  - stride matching: the walk cycle advances with distance covered (one full cycle per STRIDE metres), so
 *    feet keep pace with the ground at any speed (the classic "distance matching" fix for foot sliding);
 *  - turn to face: turn in place first when the new heading is far off, then walk facing the way you go.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TevaMotion = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var WALK_SPEED = 1.35;   // m/s, real walks (meetings, hand-offs, reviews, back to the desk)
  var STROLL_SPEED = 1.0;  // m/s, decorative ambient strolls
  var MAX_SPEED = 1.6;     // m/s, hard cap for any route (even a caller asking for a short duration)
  var ACCEL = 1.8;         // m/s^2, start and stop
  var STRIDE = 1.25;       // m of ground per full walk cycle (left + right step)
  var TURN_FIRST = 1.2;    // rad; a bigger heading change turns in place before stepping off
  var TURN_RATE = 7;       // 1/s, exponential turn smoothing

  function finite(p) { return !!p && isFinite(Number(p.x)) && isFinite(Number(p.z)); }
  function wrap(a) { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; }
  function heading(dx, dz) { return Math.atan2(dx, dz); } // +z forward, same convention as office.html
  function pathLength(points) {
    var d = 0;
    for (var i = 1; i < (points || []).length; i++) d += Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
    return d;
  }
  /** Trapezoid profile for `len` metres at cruise speed `v`: { duration, vPeak, tAcc }. */
  function profile(len, v, accel) {
    len = Math.max(0, Number(len) || 0); v = Math.min(MAX_SPEED, Math.max(0.2, Number(v) || WALK_SPEED)); accel = accel || ACCEL;
    var tAcc = v / accel, dAcc = 0.5 * accel * tAcc * tAcc;
    if (2 * dAcc >= len) { var vp = Math.sqrt(len * accel); var ta = vp / accel; return { duration: 2 * ta, vPeak: vp, tAcc: ta, len: len, accel: accel }; }
    return { duration: 2 * tAcc + (len - 2 * dAcc) / v, vPeak: v, tAcc: tAcc, len: len, accel: accel };
  }
  /** Distance covered after t seconds on a profile (0..len). */
  function distanceAt(pr, t) {
    if (!pr || pr.len <= 0) return 0;
    t = Math.max(0, Math.min(pr.duration, t));
    var a = pr.accel, ta = pr.tAcc, v = pr.vPeak;
    if (t <= ta) return 0.5 * a * t * t;
    var cruise = pr.duration - 2 * ta;
    if (t <= ta + cruise) return 0.5 * a * ta * ta + v * (t - ta);
    var td = pr.duration - t;
    return Math.min(pr.len, pr.len - 0.5 * a * td * td);
  }
  /** Speed at time t on a profile. */
  function speedAt(pr, t) {
    if (!pr || pr.len <= 0) return 0;
    if (t <= 0 || t >= pr.duration) return 0;
    if (t < pr.tAcc) return pr.accel * t;
    if (t > pr.duration - pr.tAcc) return pr.accel * (pr.duration - t);
    return pr.vPeak;
  }
  /** Point at arc length s along a polyline: { x, z, heading }. */
  function pointAt(points, s) {
    if (!points || !points.length) return { x: 0, z: 0, heading: 0 };
    if (points.length === 1) return { x: points[0].x, z: points[0].z, heading: 0 };
    var left = Math.max(0, s), h = 0;
    for (var i = 1; i < points.length; i++) {
      var a = points[i - 1], b = points[i], seg = Math.hypot(b.x - a.x, b.z - a.z);
      if (seg > 1e-6) h = heading(b.x - a.x, b.z - a.z);
      if (left <= seg || i === points.length - 1) {
        var k = seg > 1e-6 ? Math.min(1, left / seg) : 1;
        return { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k, heading: h };
      }
      left -= seg;
    }
    var last = points[points.length - 1];
    return { x: last.x, z: last.z, heading: h };
  }
  /** Duration for a route: never faster than MAX_SPEED, timed from length at `speed` (default WALK_SPEED).
   *  A caller-supplied duration is respected only when it is slower than that. */
  function routeDuration(points, opts) {
    opts = opts || {};
    var len = pathLength(points), pr = profile(len, opts.speed || WALK_SPEED);
    var asked = Number(opts.duration) || 0;
    return Math.max(pr.duration, asked && opts.respectDuration ? asked : 0, len > 0 ? 0.25 : 0);
  }
  /** Walk-cycle phase advance (radians) for `dist` metres of ground. */
  function cycleAdvance(dist) { return (Math.max(0, dist) / STRIDE) * Math.PI * 2; }
  /** Clip time scale so a 1 s, one-stride walk clip matches the ground speed (clamped 0.35..1.6). */
  function clipTimeScale(speed, clipStride, clipDuration) {
    var natural = (clipStride || STRIDE) / (clipDuration || 1);
    return Math.max(0.35, Math.min(1.6, (Number(speed) || 0) / natural));
  }
  /** Legacy (per-frame) speed controller: accelerate toward `cruise`, brake so we stop at the target. */
  function nextSpeed(cur, cruise, remaining, dt) {
    cruise = Math.min(MAX_SPEED, cruise || WALK_SPEED);
    var brake = Math.sqrt(2 * ACCEL * Math.max(0, remaining)); // v such that we can still stop in time
    var want = Math.min(cruise, Math.max(0.25, brake));
    if (cur < want) return Math.min(want, cur + ACCEL * dt);
    return Math.max(want, cur - ACCEL * 1.5 * dt);
  }
  /** Should we turn in place before stepping off? */
  function turnFirst(currentYaw, targetYaw) { return Math.abs(wrap(targetYaw - currentYaw)) > TURN_FIRST; }
  /** Smoothly turn `yaw` toward `target` over dt. */
  function turnToward(yaw, target, dt, rate) { var d = wrap(target - yaw); return yaw + d * (1 - Math.exp(-(rate || TURN_RATE) * dt)); }

  /** Pose deltas for real one-shot overlays on modular avatars (same keys as TevaAmbient.modularPose).
   *  u = progress 0..1. Used so Cyberpunk shows the same "turn done" / "blocked" / reactions as Classic. */
  var OVERLAY_KEYS = ['bodyRx', 'headRx', 'headRy', 'lArm', 'rArm', 'rLow', 'y'];
  function overlayPose(name, u, out) {
    out = out || {};
    for (var k = 0; k < OVERLAY_KEYS.length; k++) out[OVERLAY_KEYS[k]] = 0;
    if (!(u > 0 && u < 1)) return out;
    var e = Math.min(1, Math.sin(Math.PI * u) * 1.8);
    switch (name) {
      case 'celebrate': case 'party': case 'confetti':
        out.lArm = 2.6 * e; out.rArm = 2.6 * e; out.headRx = -0.2 * e; out.y = Math.abs(Math.sin(u * Math.PI * 4)) * 0.18 * e; break;
      case 'headScratch': out.rArm = 2.3 * e; out.rLow = 1.4 * e; out.headRx = 0.15 * e; out.headRy = -0.2 * e; break;
      case 'raiseHand': out.rArm = 2.9 * e; break;
      case 'wave': out.rArm = 2.6 * e; out.rLow = 0.4 + Math.sin(u * Math.PI * 8) * 0.4 * e; break;
      case 'nod': out.headRx = Math.sin(u * Math.PI * 3) * 0.3; break;
      case 'stretch': out.lArm = 1.5 * e; out.rArm = 1.5 * e; out.y = 0.03 * e; break;
      case 'leanBack': out.bodyRx = -0.15 * e; out.headRx = -0.12 * e; break;
      case 'glance': case 'envelope': case 'docPop': case 'bubble': out.headRx = -0.3 * e; break;
      case 'startle': out.y = 0.12 * e; out.lArm = 0.5 * e; out.rArm = 0.5 * e; break;
    }
    return out;
  }

  return { WALK_SPEED: WALK_SPEED, STROLL_SPEED: STROLL_SPEED, MAX_SPEED: MAX_SPEED, ACCEL: ACCEL, STRIDE: STRIDE, TURN_FIRST: TURN_FIRST,
    finite: finite, wrap: wrap, heading: heading, pathLength: pathLength, profile: profile, distanceAt: distanceAt, speedAt: speedAt,
    pointAt: pointAt, routeDuration: routeDuration, cycleAdvance: cycleAdvance, clipTimeScale: clipTimeScale, nextSpeed: nextSpeed,
    turnFirst: turnFirst, turnToward: turnToward, overlayPose: overlayPose, OVERLAY_KEYS: OVERLAY_KEYS };
});
