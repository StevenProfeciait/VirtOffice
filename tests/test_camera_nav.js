// Pure helpers for camera nav math (mirrors office.html clamp / pan axes).
// Run: node tests/test_camera_nav.js
function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
function applyZoom(zoom, deltaY) {
  return clamp(zoom * Math.exp(deltaY * 0.0015), 0.45, 2.4);
}
function panDelta(dx, dy, rotation, zoom) {
  const scale = 0.028 * zoom;
  const cos = Math.cos(rotation), sin = Math.sin(rotation);
  return {
    x: (-dx * cos - dy * sin) * scale,
    z: (dx * sin - dy * cos) * scale
  };
}

let fails = 0;
function check(name, cond) {
  if (!cond) { console.error('FAIL', name); fails++; }
  else console.log('ok', name);
}

check('zoom in on negative wheel', applyZoom(1, -200) < 1);
check('zoom out on positive wheel', applyZoom(1, 200) > 1);
check('zoom clamp min', applyZoom(0.45, -5000) === 0.45);
check('zoom clamp max', applyZoom(2.4, 5000) === 2.4);
const p = panDelta(10, 0, 0, 1);
check('pan right moves -x at rot0', Math.abs(p.x + 0.28) < 1e-6 && Math.abs(p.z) < 1e-9);
check('pitch clamp range', clamp(0.1, 0.15, 0.55) === 0.15 && clamp(0.9, 0.15, 0.55) === 0.55);

console.log(fails ? `FAIL ${fails}` : 'TESTS PASSED');
process.exit(fails ? 1 : 0);
