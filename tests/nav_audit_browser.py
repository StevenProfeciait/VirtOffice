"""Visual-to-navigation alignment audit (2026-10-23 nav recovery). NOT auto-discovered by unittest (no test_ prefix).

Loads office.html in a real browser for each look, samples every rendered mesh triangle that sits in the avatar body
band (0.15-1.6 m above the floor; chairs, avatars, sprites and floor decals excluded) onto a 0.25 m grid and compares
it with the live TevaNav grid (WALKNAV):
  - "walk-through": rendered geometry where an avatar centre may stand within 0.2 m (nav cell free) -> clipping;
  - "phantom": a nav furniture rectangle with no rendered geometry inside it (over-blocking, look-specific props);
  - "opening": rendered geometry inside a real opening (Fun Wing corridor, terrace doorway) -> visually closed door;
  - "unreachable": a reservable spot / seat whose route from some desk fails (TevaNav.plan).
Usage: BASE=http://127.0.0.1:9615 python3 tests/nav_audit_browser.py [classic] [cyber]   (prints JSON, writes
/workspace/vo_navrecovery/nav_audit_<look>.json when that directory exists). Needs playwright + Chrome.
"""
import json, os, sys
from pathlib import Path

AUDIT_JS = r"""
() => {
  const nav = navInit(); if (!nav) return { error: 'no WALKNAV' };
  scene.updateMatrixWorld(true);
  const skip = new Set();
  const mark = o => o && o.traverse(c => skip.add(c));
  (agents || []).forEach(o => { mark(o.group); Object.values(o.badges || {}).forEach(mark); });
  try { const m = modularBridge && modularBridge.manager; if (m) Object.values(m.entries).forEach(e => mark(e.group)); } catch (e) {}
  const seatPts = [];
  Object.values(TEVA_SEATS || {}).forEach(p => seatPts.push(p));
  try { if (window.TevaAssets && modularAvatarsEnabled()) AGENTS.forEach(a => { const p = TevaAssets.resolveAgentPosition(a); seatPts.push({ x: p.x, z: p.z }); }); } catch (e) {}
  try { (SPOTS ? SPOTS.spots : []).forEach(s => { if (s.sit) seatPts.push(s); }); } catch (e) {}
  const nearSeat = (x, z) => seatPts.some(p => Math.hypot(p.x - x, p.z - z) < 0.55);
  const G = 0.25, occ = new Map(), Y0 = 0.15, Y1 = 1.6;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), p = new THREE.Vector3();
  let tris = 0; const topInfo = new Map();
  scene.traverse(o => {
    if (!o.isMesh || skip.has(o) || !o.visible) return;
    let v = o, hidden = false; while (v) { if (!v.visible || (v.userData && (v.userData.chair || v.userData.tevaMeetingChair))) { hidden = true; break; } v = v.parent; }
    if (hidden) return;
    const mat = Array.isArray(o.material) ? o.material[0] : o.material;
    if (!mat || mat.visible === false || (mat.transparent && mat.opacity < 0.04)) return;
    const pos = o.geometry && o.geometry.attributes && o.geometry.attributes.position; if (!pos) return;
    const idx = o.geometry.index, n = idx ? idx.count : pos.count, inst = o.isInstancedMesh ? o.count : 1, im = new THREE.Matrix4(), mw = new THREE.Matrix4();
    // name the smallest ancestor that is still one prop (< 8 m footprint) so a sample says what it belongs to
    const bbOf = g => { if (!topInfo.has(g)) { const bb = new THREE.Box3().setFromObject(g); topInfo.set(g, bb); } return topInfo.get(g); };
    let top = o; while (top.parent && top.parent !== scene) { const bb = bbOf(top.parent), sz = bb.getSize(new THREE.Vector3()); if (Math.max(sz.x, sz.z) > 8) break; top = top.parent; }
    const tb = bbOf(top), cc = tb.getCenter(new THREE.Vector3()), sz = tb.getSize(new THREE.Vector3());
    const label = (top.name || top.type) + '@' + cc.x.toFixed(1) + ',' + cc.z.toFixed(1) + ' ' + sz.x.toFixed(1) + 'x' + sz.z.toFixed(1) + ' y' + tb.min.y.toFixed(1) + '-' + tb.max.y.toFixed(1) + ' #' + ((mat.color && mat.color.getHexString()) || '');
    const tag = o.userData && o.userData.batched ? 'batched' : label;
    for (let k = 0; k < inst; k++) {
      if (o.isInstancedMesh) { o.getMatrixAt(k, im); mw.multiplyMatrices(o.matrixWorld, im); } else mw.copy(o.matrixWorld);
      for (let i = 0; i + 2 < n; i += 3) {
        const i0 = idx ? idx.getX(i) : i, i1 = idx ? idx.getX(i + 1) : i + 1, i2 = idx ? idx.getX(i + 2) : i + 2;
        a.fromBufferAttribute(pos, i0).applyMatrix4(mw); b.fromBufferAttribute(pos, i1).applyMatrix4(mw); c.fromBufferAttribute(pos, i2).applyMatrix4(mw);
        if (Math.max(a.y, b.y, c.y) < Y0 || Math.min(a.y, b.y, c.y) > Y1) continue;
        tris++;
        const e = Math.max(a.distanceTo(b), b.distanceTo(c), c.distanceTo(a)), s = Math.min(200, Math.max(1, Math.ceil(e / 0.1)));
        for (let u = 0; u <= s; u++) for (let w = 0; w <= s - u; w++) {
          const bu = u / s, bw = w / s, bv = 1 - bu - bw;
          p.set(a.x * bv + b.x * bu + c.x * bw, a.y * bv + b.y * bu + c.y * bw, a.z * bv + b.z * bu + c.z * bw);
          if (p.y < Y0 || p.y > Y1) continue;
          const key = Math.round(p.x / G) + ',' + Math.round(p.z / G);
          if (!occ.has(key)) occ.set(key, tag);
        }
      }
    }
  });
  // walk-through: a free nav cell centre within 0.2 m of rendered geometry
  const bad = [];
  occ.forEach((tag, key) => {
    const [i, j] = key.split(',').map(Number), x = i * G, z = j * G;
    if (nearSeat(x, z)) return;
    const ci = nav.idx({ x, z });
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const q = nav.pos(ci.ix + dx, ci.iz + dz);
      if (Math.hypot(q.x - x, q.z - z) <= 0.2 && nav.free(ci.ix + dx, ci.iz + dz)) { bad.push({ x, z, tag }); return; }
    }
  });
  // cluster walk-through samples (within 0.5 m: nav centres are 0.5 m apart)
  const keyOf = q => Math.round(q.x / G) + ',' + Math.round(q.z / G), byKey = new Map(bad.map(q => [keyOf(q), q])), seen = new Set(), clusters = [];
  bad.forEach(q => {
    const k0 = keyOf(q); if (seen.has(k0)) return;
    const st = [k0], cl = []; seen.add(k0);
    while (st.length) { const k = st.pop(), r = byKey.get(k); cl.push(r); const [i, j] = k.split(',').map(Number);
      for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) { const kk = (i + dx) + ',' + (j + dz); if (byKey.has(kk) && !seen.has(kk)) { seen.add(kk); st.push(kk); } } }
    const xs = cl.map(r => r.x), zs = cl.map(r => r.z), cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2;
    let near = null, nd = Infinity; nav.furniture.forEach(f => { const d = Math.hypot(f.x - cx, f.z - cz); if (d < nd) { nd = d; near = f.tag; } });
    clusters.push({ n: cl.length, x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs), tags: [...new Set(cl.map(r => r.tag))].slice(0, 4), nearestNavRect: near, nearestDist: +nd.toFixed(1) });
  });
  clusters.sort((u, v) => v.n - u.n);
  // phantom: nav rects with no rendered samples inside (shrunk by 0.1 m)
  const phantom = [];
  nav.furniture.forEach(f => {
    let hit = 0, tot = 0;
    for (let u = -0.5; u <= 0.5001; u += 0.1) for (let w = -0.5; w <= 0.5001; w += 0.1) {
      const lx = u * Math.max(0, f.w - 0.2), lz = w * Math.max(0, f.d - 0.2), cs = Math.cos(f.rot), sn = Math.sin(f.rot);
      const x = f.x + lx * cs + lz * sn, z = f.z - lx * sn + lz * cs; tot++;
      if (occ.has(Math.round(x / G) + ',' + Math.round(z / G))) hit++;
    }
    if (hit / tot < 0.05) phantom.push({ tag: f.tag, x: +f.x.toFixed(2), z: +f.z.toFixed(2), w: f.w, d: f.d, cover: +(hit / tot).toFixed(2) });
  });
  // openings: rendered geometry inside the real openings (1 m deep, avatar band)
  const openings = [];
  const L = LAYOUT, hw = L.room.width / 2, hd = L.room.depth / 2, fz = L.funWing ? L.funWing.centerZ : 12, dxo = (L.anchors.doorway && L.anchors.doorway.x) || 0;
  [{ name: 'fun wing opening', x0: hw - 0.5, x1: hw + 0.5, z0: fz - 2.5, z1: fz + 2.5 }, { name: 'terrace doorway', x0: dxo - 1.2, x1: dxo + 1.2, z0: hd - 0.5, z1: hd + 0.5 }].forEach(o => {
    const hits = []; occ.forEach((tag, key) => { const [i, j] = key.split(',').map(Number), x = i * G, z = j * G; if (x >= o.x0 && x <= o.x1 && z >= o.z0 && z <= o.z1) hits.push({ x, z, tag }); });
    const cells = []; for (let x = o.x0; x <= o.x1 + 1e-6; x += 0.5) for (let z = o.z0; z <= o.z1 + 1e-6; z += 0.5) cells.push(!nav.blockedAt({ x, z }));
    openings.push({ name: o.name, renderedSamples: hits.length, sample: hits.slice(0, 5), navFreeShare: +(cells.filter(Boolean).length / cells.length).toFixed(2) });
  });
  return { look: modularAvatarsEnabled() ? 'cyber' : 'classic', tris, occupied: occ.size, walkThrough: clusters, phantom, openings };
}
"""

REACH_JS = r"""
() => {
  const nav = navInit(); if (!nav || !nav.plan) return { error: 'no plan()' };
  const desks = AGENTS.map(a => { const o = seatObj(a.id); return { id: a.id, p: modularAvatarsEnabled() && window.TevaAssets ? TevaAssets.resolveAgentPosition(a) : getHomePosition(a.home) }; });
  const targets = (SPOTS ? SPOTS.spots : []).map(s => ({ name: s.id, x: s.x, z: s.z }));
  const fails = [];
  desks.forEach(d => targets.concat(desks.map(e => ({ name: 'seat ' + e.id, x: e.p.x, z: e.p.z }))).forEach(t => {
    const r = nav.plan({ x: d.p.x, z: d.p.z }, t); if (!r.ok || r.snapped) fails.push({ from: d.id, to: t.name, reason: r.reason || 'snapped' });
  }));
  return { desks: desks.length, targets: targets.length + desks.length, fails: fails.slice(0, 40), failCount: fails.length };
}
"""


def main():
    from playwright.sync_api import sync_playwright
    base = os.environ.get("BASE", "http://127.0.0.1:9502")
    looks = sys.argv[1:] or ["classic", "cyber"]
    out_dir = Path("/workspace/vo_navrecovery")
    res = {}
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path=os.environ.get("CHROME", "/usr/bin/google-chrome"),
                              args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
        for look in looks:
            pg = b.new_page(viewport={"width": 1200, "height": 760})
            if os.environ.get("NOBATCH", "1") == "1":
                # audit only: keep the scene un-merged so each sample names its source object (office.html untouched)
                def _route(route):
                    r = route.fetch(); body = r.text().replace("    batchStatic();", "    /* audit: no batchStatic */", 1)
                    route.fulfill(response=r, body=body)
                pg.route("**/office.html*", _route)
            pg.goto(base + "/office.html" + ("?modular=0&ambient=0" if look == "classic" else "?modular=1&ambient=0"))
            pg.wait_for_timeout(int(os.environ.get("WAIT", "12000")))
            r = pg.evaluate(AUDIT_JS)
            r["reach"] = pg.evaluate(REACH_JS)
            res[look] = r
            if out_dir.is_dir():
                (out_dir / f"nav_audit_{look}.json").write_text(json.dumps(r, indent=1))
            pg.close()
        b.close()
    print(json.dumps(res, indent=1))


if __name__ == "__main__":
    main()
