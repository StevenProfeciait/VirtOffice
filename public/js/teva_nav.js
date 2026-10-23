/* TEVA HQ walking routes around furniture (2026-10-22 part 2, Steve: "nobody walks straight through objects").
 *
 * Pure (no THREE / DOM): a 0.5 m occupancy grid over the main floor, the Fun Wing and the collab terrace, built from
 * the real floor plan (public/office_layout.js) plus the desks the active look draws (office.html passes them in:
 * legacy desks in Classic, modular workstations in Cyberpunk). Walls between the areas are solid except the real
 * openings (the Fun Wing glass corridor and the terrace doorway, the same ones TevaAmbient.route uses). A* (8-way)
 * then string-pulling gives a few corner waypoints. Furniture is inflated by the avatar radius. Start / goal cells
 * that sit inside furniture (a chair tucked under a desk) are allowed: the last step goes straight to the chair.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TevaNav = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var CELL = 0.5, RADIUS = 0.3;

  function finite(p) { return !!p && isFinite(Number(p.x)) && isFinite(Number(p.z)); }

  /** Furniture rectangles {x, z, w (along local x), d (along local z), rot} from the floor plan. */
  function furniture(L, opts) {
    opts = opts || {};
    var out = [];
    function rect(x, z, w, d, rot, tag) { if (isFinite(x) && isFinite(z)) out.push({ x: Number(x), z: Number(z), w: Number(w), d: Number(d), rot: Number(rot) || 0, tag: tag || '' }); }
    var ms = (L && L.meetingSpaces) || {};
    Object.keys(ms).forEach(function (k) {
      var s = ms[k];
      if (!s || s.type === 'fun') return;
      if (s.type === 'boardroom') rect(s.x, s.z, Number(s.tableD) || 2, Number(s.tableW) || 7.2, 0, 'boardroom table');
      else { var r = s.id === 'main' ? 2.45 : Math.max(1.15, (Number(s.radius) || 2) * 0.55); rect(s.x, s.z, r * 1.6, r * 1.6, 0, 'table ' + k); }
    });
    ((L && L.dividers) || []).forEach(function (d) { rect(d.x, d.z, d.w, d.d, d.rot, 'divider'); });
    var a = (L && L.anchors) || {};
    if (finite(a.kitchen)) { rect(a.kitchen.x, a.kitchen.z, 4.1, 1.2, 0, 'kitchen counter'); rect(Number(a.kitchen.x) + 2.2, Number(a.kitchen.z) - 1.2, 1.05, 0.85, 0, 'fridge'); }
    if (finite(a.lounge)) { var lx = Number(a.lounge.x), lz = Number(a.lounge.z); rect(lx, lz - 0.1, 3.2, 0.6, 0, 'sofa'); rect(lx + 1.55, lz + 0.9, 0.6, 1.8, 0, 'sofa'); rect(lx - 0.7, lz + 1.1, 1.1, 1.1, 0, 'coffee table'); }
    var fw = L && L.funWing;
    if (fw && finite({ x: fw.centerX, z: fw.centerZ })) {
      var cx = Number(fw.centerX), cz = Number(fw.centerZ);
      var ar = fw.arcadeRow || { x: 0, z: -6 }, pp = fw.pingPong || { x: -2.5, z: 0 }, fb = fw.foosball || { x: 3.2, z: 0 }, sn = fw.snackStrip || { x: 0, z: -11 }, ch = fw.chillPit || { x: -5, z: 8 };
      for (var i = 0; i < 5; i++) rect(cx + Number(ar.x) - 6 + i * 3, cz + Number(ar.z) + 0.2, 1.15, 1.25, 0, 'arcade cabinet');
      rect(cx + Number(pp.x), cz + Number(pp.z), 2.8, 1.5, 0, 'ping pong table');
      rect(cx + Number(fb.x), cz + Number(fb.z), 2.2, 1.4, 0, 'foosball table');
      [-1.4, 1.4].forEach(function (dx) { rect(cx + Number(sn.x) + dx, cz + Number(sn.z), 1.1, 0.7, 0, 'vending machine'); });
      rect(cx + Number(sn.x), cz + Number(sn.z) + 2.2, 1.15, 0.5, 0, 'snack cart');
      rect(cx + Number(ch.x), cz + Number(ch.z) - 0.25, 3.0, 0.5, 0, 'chill pit sofa back');
    }
    var w = L && L.wing;
    if (w && finite({ x: w.centerX, z: w.centerZ })) {
      var wx = Number(w.centerX), wz = Number(w.centerZ), wl = w.lounge || { x: -14, z: 5 }, hd = w.huddle || { x: 0, z: 4 }, cc = w.coffeeCart || { x: 0, z: -8.5 };
      rect(wx + Number(wl.x), wz + Number(wl.z) - 0.2, 3.4, 0.6, 0, 'terrace sofa');
      rect(wx + Number(hd.x), wz + Number(hd.z), 2.0, 2.0, 0, 'huddle table');
      rect(wx + Number(cc.x), wz + Number(cc.z), 1.2, 0.55, 0, 'coffee cart');
      (w.hotDesks || []).forEach(function (h) { rect(wx + Number(h.x), wz + Number(h.z), 1.85, 1.05, 0, 'hot desk'); });
    }
    (opts.desks || []).forEach(function (d) { rect(d.x, d.z, d.w || 2.5, d.d || 1.15, d.rot, d.tag || 'desk'); });
    return out;
  }

  function Nav(L, opts) {
    opts = opts || {};
    this.L = L;
    this.cell = opts.cell || CELL;
    this.radius = opts.radius == null ? RADIUS : opts.radius;
    var hw = (L && L.room ? L.room.width : 72) / 2, hd = (L && L.room ? L.room.depth : 54) / 2;
    this.hw = hw; this.hd = hd;
    var areas = [{ x0: -hw, x1: hw, z0: -hd, z1: hd }];
    var fw = L && L.funWing, w = L && L.wing;
    if (fw) areas.push({ x0: fw.centerX - fw.width / 2, x1: fw.centerX + fw.width / 2, z0: fw.centerZ - fw.depth / 2, z1: fw.centerZ + fw.depth / 2 });
    if (w) areas.push({ x0: w.centerX - w.width / 2, x1: w.centerX + w.width / 2, z0: w.centerZ - w.depth / 2, z1: w.centerZ + w.depth / 2 });
    this.areas = areas;
    var minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    areas.forEach(function (a) { minX = Math.min(minX, a.x0); maxX = Math.max(maxX, a.x1); minZ = Math.min(minZ, a.z0); maxZ = Math.max(maxZ, a.z1); });
    this.x0 = minX; this.z0 = minZ;
    this.nx = Math.ceil((maxX - minX) / this.cell) + 1; this.nz = Math.ceil((maxZ - minZ) / this.cell) + 1;
    this.block = new Uint8Array(this.nx * this.nz);
    this.furniture = furniture(L, opts);
    var fz = fw && isFinite(fw.centerZ) ? Number(fw.centerZ) : 12;
    var dx = (L && L.anchors && L.anchors.doorway && isFinite(L.anchors.doorway.x)) ? Number(L.anchors.doorway.x) : 0;
    var dhalf = (L && L.anchors && L.anchors.doorway && isFinite(L.anchors.doorway.width)) ? Math.max(1.5, Number(L.anchors.doorway.width) / 2 - 0.2) : 1.5;
    this.doors = [{ x: hw, z: fz }, { x: dx, z: hd }];
    var self = this, r = this.radius;
    for (var ix = 0; ix < this.nx; ix++) for (var iz = 0; iz < this.nz; iz++) {
      var x = this.x0 + ix * this.cell, z = this.z0 + iz * this.cell, inside = false;
      for (var k = 0; k < areas.length; k++) { var A = areas[k]; if (x >= A.x0 + r && x <= A.x1 - r && z >= A.z0 + r && z <= A.z1 - r) { inside = true; break; } }
      // the walls between the main floor and the wings, solid except the two openings
      if (inside && Math.abs(x - hw) < 0.35 + r && z > -hd && Math.abs(z - fz) > 1.5) inside = false;
      if (inside && Math.abs(z - hd) < 0.35 + r && x < hw && Math.abs(x - dx) > dhalf) inside = false; // terrace doorway (7 m wide, coffee cart in it)
      if (inside) for (var f = 0; f < this.furniture.length; f++) if (self._inRect(this.furniture[f], x, z, r)) { inside = false; break; }
      this.block[ix * this.nz + iz] = inside ? 0 : 1;
    }
  }
  var N = Nav.prototype;
  N._inRect = function (o, x, z, pad) {
    var c = Math.cos(-o.rot), s = Math.sin(-o.rot), lx = (x - o.x) * c - (z - o.z) * s, lz = (x - o.x) * s + (z - o.z) * c;
    return Math.abs(lx) <= o.w / 2 + pad && Math.abs(lz) <= o.d / 2 + pad;
  };
  N.idx = function (p) { return { ix: Math.round((p.x - this.x0) / this.cell), iz: Math.round((p.z - this.z0) / this.cell) }; };
  N.pos = function (ix, iz) { return { x: this.x0 + ix * this.cell, z: this.z0 + iz * this.cell }; };
  N.free = function (ix, iz) { return ix >= 0 && iz >= 0 && ix < this.nx && iz < this.nz && !this.block[ix * this.nz + iz]; };
  /** Is a world point blocked by furniture / walls (for tests and diagnostics)? */
  N.blockedAt = function (p) { var c = this.idx(p); return !this.free(c.ix, c.iz); };
  N._nearestFree = function (c) {
    if (this.free(c.ix, c.iz)) return c;
    for (var r = 1; r < 12; r++) {
      var best = null, bd = Infinity;
      for (var dx = -r; dx <= r; dx++) for (var dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r || !this.free(c.ix + dx, c.iz + dz)) continue;
        var d = dx * dx + dz * dz; if (d < bd) { bd = d; best = { ix: c.ix + dx, iz: c.iz + dz }; }
      }
      if (best) return best;
    }
    return null;
  };
  /** Straight segment clear of furniture and walls? (samples every quarter cell) */
  N.clear = function (a, b) {
    var dx = b.x - a.x, dz = b.z - a.z, len = Math.sqrt(dx * dx + dz * dz), n = Math.max(1, Math.ceil(len / (this.cell * 0.25)));
    for (var i = 0; i <= n; i++) {
      var c = this.idx({ x: a.x + dx * i / n, z: a.z + dz * i / n });
      if (!this.free(c.ix, c.iz)) return false;
    }
    return true;
  };
  /** Waypoints from -> to (excluding from, ending exactly at to), around furniture and through the openings.
   *  Returns null when no route exists (callers fall back to TevaAmbient.route). */
  N.path = function (from, to) {
    if (!finite(from) || !finite(to)) return null;
    from = { x: Number(from.x), z: Number(from.z) }; to = { x: Number(to.x), z: Number(to.z) };
    var s = this._nearestFree(this.idx(from)), g = this._nearestFree(this.idx(to));
    if (!s || !g) return null;
    var sp = this.pos(s.ix, s.iz), gp = this.pos(g.ix, g.iz);
    if (this.clear(sp, gp) && (this.free(this.idx(from).ix, this.idx(from).iz) || true)) {
      var direct = [];
      if (Math.hypot(sp.x - from.x, sp.z - from.z) > 0.05 && !this.clear(from, to)) direct.push(sp);
      if (this.clear(from, to)) return [to];
      if (Math.hypot(gp.x - to.x, gp.z - to.z) > 0.05) direct.push(gp);
      direct.push(to);
      return direct;
    }
    var nz = this.nz, total = this.nx * nz, G = new Float32Array(total), came = new Int32Array(total), closed = new Uint8Array(total);
    for (var i = 0; i < total; i++) { G[i] = Infinity; came[i] = -1; }
    var start = s.ix * nz + s.iz, goal = g.ix * nz + g.iz;
    var heap = [], hf = [];
    function push(n, f) { heap.push(n); hf.push(f); var k = heap.length - 1; while (k > 0) { var p = (k - 1) >> 1; if (hf[p] <= hf[k]) break; var t = heap[p]; heap[p] = heap[k]; heap[k] = t; t = hf[p]; hf[p] = hf[k]; hf[k] = t; k = p; } }
    function pop() {
      var top = heap[0], ln = heap.pop(), lf = hf.pop();
      if (heap.length) { heap[0] = ln; hf[0] = lf; var k = 0; for (;;) { var l = 2 * k + 1, r = l + 1, m = k; if (l < heap.length && hf[l] < hf[m]) m = l; if (r < heap.length && hf[r] < hf[m]) m = r; if (m === k) break; var t = heap[m]; heap[m] = heap[k]; heap[k] = t; t = hf[m]; hf[m] = hf[k]; hf[k] = t; k = m; } }
      return top;
    }
    function h(n) { var ax = Math.abs(((n / nz) | 0) - g.ix), az = Math.abs((n % nz) - g.iz); return (ax + az) + (Math.SQRT2 - 2) * Math.min(ax, az); }
    G[start] = 0; push(start, h(start));
    var found = false, D = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    while (heap.length) {
      var cur = pop();
      if (closed[cur]) continue;
      if (cur === goal) { found = true; break; }
      closed[cur] = 1;
      var cx = (cur / nz) | 0, cz = cur % nz;
      for (var d = 0; d < 8; d++) {
        var ix = cx + D[d][0], iz = cz + D[d][1];
        if (!this.free(ix, iz)) continue;
        if (d >= 4 && (!this.free(cx + D[d][0], cz) || !this.free(cx, cz + D[d][1]))) continue; // no corner cutting
        var nb = ix * nz + iz, ng = G[cur] + (d >= 4 ? Math.SQRT2 : 1);
        if (ng < G[nb]) { G[nb] = ng; came[nb] = cur; push(nb, ng + h(nb)); }
      }
    }
    if (!found) return null;
    var cells = [];
    for (var c = goal; c !== -1; c = came[c]) cells.push(this.pos((c / nz) | 0, c % nz));
    cells.reverse();
    // string-pull: keep only the corners needed for clear straight segments
    var pts = [], anchor = from;
    if (!this.clear(from, cells[0])) anchor = cells[0];
    else cells[0] = from;
    var k2 = 0;
    while (k2 < cells.length - 1) {
      var far = k2 + 1;
      for (var j = cells.length - 1; j > k2 + 1; j--) if (this.clear(cells[k2], cells[j])) { far = j; break; }
      pts.push(cells[far]); k2 = far;
    }
    if (anchor !== from) pts.unshift(anchor);
    var last = pts.length ? pts[pts.length - 1] : null;
    if (!last || Math.hypot(last.x - to.x, last.z - to.z) > 0.05) pts.push(to); else pts[pts.length - 1] = to;
    return pts;
  };
  /** Total length of a route starting at from. */
  function length(from, pts) { var d = 0, p = from; (pts || []).forEach(function (q) { d += Math.hypot(q.x - p.x, q.z - p.z); p = q; }); return d; }

  return { Nav: Nav, furniture: furniture, length: length, CELL: CELL, RADIUS: RADIUS };
});
