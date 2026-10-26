// Nav recovery (2026-10-23): route-failure handling, visual-to-nav alignment and Steve's regression cases.
// Pure node (TevaNav, TevaSpots, TevaZones, TevaAssets with the bundled three.js); office.html wiring by source.
// Run: node tests/test_teva_nav_recovery.js            (JSON helper for the Python test: --zone-json)
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..', 'public');
const sb = {}; sb.window = sb; sb.self = sb; sb.global = sb; sb.console = console; vm.createContext(sb);
const run = f => vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), sb, { filename: f });
['vendor/three.min.js', 'office_layout.js', 'js/teva_assets.js', 'js/teva_nav.js', 'js/teva_spots.js', 'js/teva_zones.js'].forEach(run);
const L = sb.LAYOUT || sb.OFFICE_LAYOUT, A = sb.TevaAssets, T = sb.TevaNav, S = sb.TevaSpots, Z = sb.TevaZones;
A.setManifest(JSON.parse(fs.readFileSync(path.join(root, 'assets', 'asset-manifest.json'), 'utf8')));
const html = fs.readFileSync(path.join(root, 'office.html'), 'utf8');
const ids = Object.keys(L.seats);
const fw = L.funWing, hw = L.room.width / 2, hd = L.room.depth / 2;

// the desks each look draws (same as office.html navDesks)
const classicDesks = Object.entries(L.seats).filter(([id]) => !['supervisor', 'pm', 'ba'].includes(id)).map(([id, p]) => ({ x: p.x, z: p.z - 0.9, w: 2.5, d: 1.15, rot: 0, tag: 'desk ' + id }));
const cyberDesks = ids.map(id => { const ws = A.resolveWorkstationOrigin({ id }), c = ws.config || {}, cmd = ws.style === 'command'; return { x: ws.x, z: ws.z, w: Number(c.deskW) || (ws.style === 'collab' ? 3.4 : cmd ? 4.4 : 2.85), d: Number(c.deskD) || (cmd ? 1.7 : 1.28), rot: ws.rotation, tag: 'desk ' + id }; })
  .concat((L.expansionStations || []).map((st, i) => ({ x: st.x, z: st.z, w: 2.85, d: 1.28, rot: st.rotation || 0, tag: 'expansion desk ' + i })));
const LOOKS = {
  classic: { nav: new T.Nav(L, { desks: classicDesks, look: 'classic' }), seat: id => ({ x: L.seats[id].x, z: L.seats[id].z }) },
  cyber: { nav: new T.Nav(L, { desks: cyberDesks, look: 'cyber' }), seat: id => { const p = A.resolveAgentPosition({ id }); return { x: p.x, z: p.z }; } }
};
const spotsCat = S.catalog(L, { boardroom: Z.boardroomSlots(L), research: Z.researchSlots(L) });

// every sample of a route: never inside a hard rect / outside the floor; inside soft furniture only on the last
// (or first) SEAT_LEG metres, and then no deeper than SEAT_DEPTH (sitting down on a sofa / desk chair)
function violations(nav, from, pts) {
  const out = new Set(), all = [from].concat(pts), total = T.length(from, pts);
  let run = 0;
  for (let i = 0; i < all.length - 1; i++) {
    const a = all[i], b = all[i + 1], len = Math.hypot(b.x - a.x, b.z - a.z), k = Math.max(1, Math.ceil(len / 0.1));
    for (let j = 0; j <= k; j++) {
      const p = { x: a.x + (b.x - a.x) * j / k, z: a.z + (b.z - a.z) * j / k }, d = run + len * j / k, s = nav.solidAt(p);
      if (s.hard) out.add('hard:' + (s.tags.join('/') || 'outside floor') + '@' + p.x.toFixed(1) + ',' + p.z.toFixed(1));
      else if (s.soft > 0.02 && ((d > 1.65 && d < total - 1.65) || s.soft > T.SEAT_DEPTH + 1e-6)) out.add('soft:' + s.tags.join('/') + '@' + p.x.toFixed(1) + ',' + p.z.toFixed(1));
    }
    run += len;
  }
  return [...out];
}
let n = 0;
function t(name, fn) { fn(); n++; console.log('ok', n, name); }

if (process.argv.includes('--zone-json')) {
  // helper for tests/test_nav_zone_correlation.py: a boardroom session for a hand-off, then a new assignment
  const out = {};
  for (const look of Object.keys(LOOKS)) {
    const { nav, seat } = LOOKS[look];
    const reg = new S.Registry(spotsCat), zones = new Z.Zones({ layout: L, spots: reg });
    const now = 1000, bases = {}; ids.forEach(id => { bases[id] = 'IDLE'; });
    const s = zones.open({ kind: 'handoff-review', seats: ['ba', 'pm'], label: 'Hand-off review · R-1', source: 'TEVA_COMPANY_BACKLOG.md:1' }, now, bases);
    const legs = {};
    ['ba', 'pm'].forEach(id => { const tg = zones.target(id), r = nav.plan(seat(id), tg); legs[id] = { to: 'boardroom', ok: r.ok && !r.snapped, bad: r.ok ? violations(nav, seat(id), r.pts).length : -1 }; });
    bases.pm = 'TYPING'; // new assignment: pm starts real work -> back to its desk
    const changed = zones.tick(now + 5000, bases), back = zones.target('pm');
    const from = zones.target('ba'), r2 = nav.plan(Z.boardroomSlots(L)[0], seat('pm'));
    legs.pmBack = { changed: changed.includes('pm'), zoneAfter: back ? back.zone : null, ok: r2.ok && !r2.snapped, bad: r2.ok ? violations(nav, Z.boardroomSlots(L)[0], r2.pts).length : -1 };
    out[look] = { session: !!s, seats: s ? s.seats : [], legs, baStill: !!from };
  }
  console.log(JSON.stringify(out));
  process.exit(0);
}

t('alignment audit fixes: rendered props are solid (planters, terrace glass, corridor glass, pods, lounge sets, Steve bay); Classic has no cyber pods', () => {
  const c = LOOKS.classic.nav, y = LOOKS.cyber.nav;
  [[-25.6, 36], [25.6, 36], [8, 28.9], [-8, 28.9], [-34.8, -25.8], [12, -6], [-18, 29], [0, 44], [26, -1.5], [22.6, -3.4], [-15, -10.15],
   [-18.6, -20.2], [-22.4, -17.3], [-26, -21.6], [-33.5, -17], [-33, -16], [-14, 41.0], [14, 40], [41, 20], [42.8, 20.8], [9.6, 12.2], [40.4, 10]].forEach(p => {
    assert.ok(c.blockedAt({ x: p[0], z: p[1] }), 'classic solid at ' + p);
    assert.ok(y.blockedAt({ x: p[0], z: p[1] }), 'cyber solid at ' + p);
  });
  // Cyberpunk-only props
  [[-18, 24.5], [0, 20], [20, 19.8], [16.8, 24.8], [26, 11], [-26, 11], [24, 17], [12, -3]].forEach(p => assert.ok(y.blockedAt({ x: p[0], z: p[1] }), 'cyber solid at ' + p));
  assert.ok(!c.blockedAt({ x: 26, z: 13.5 }) && !c.blockedAt({ x: -26, z: 13.5 }), 'Classic: no 14x9 / 12x8 pod phantom (only the collab table)');
  assert.ok(c.blockedAt({ x: 26, z: 11 }) && c.blockedAt({ x: -26, z: 11 }), 'Classic: the innovation / simulation collab tables are solid');
  assert.ok(!c.blockedAt({ x: 0, z: 20 }), 'Classic: no command deck core');
  // the round meeting tables are their real size (main table radius 2.45: an avatar cannot stand 2.5 m from the centre on a diagonal... axis)
  const m = L.meetingSpaces.main; assert.ok(c.blockedAt({ x: m.x, z: m.z + 2.5 }), 'main table edge');
});

t('openings: the Fun Wing corridor and the terrace doorway are traversable in both looks; walls next to them are not', () => {
  for (const look of Object.keys(LOOKS)) {
    const nav = LOOKS[look].nav;
    for (let z = fw.centerZ - 2.5; z <= fw.centerZ + 2.5 + 1e-9; z += 0.5) assert.ok(!nav.blockedAt({ x: hw, z }), look + ' Fun Wing opening z=' + z);
    for (let x = hw - 1; x <= hw + 3; x += 0.5) assert.ok(!nav.blockedAt({ x, z: fw.centerZ }), look + ' Fun Wing corridor x=' + x);
    assert.ok(nav.blockedAt({ x: hw, z: fw.centerZ + 3.5 }) && nav.blockedAt({ x: hw, z: fw.centerZ - 3.5 }), look + ' wall beside the opening');
    assert.ok(!nav.blockedAt({ x: -2.5, z: hd }) && !nav.blockedAt({ x: 2.5, z: hd }), look + ' terrace doorway (both sides of the coffee cart)');
    assert.ok(nav.blockedAt({ x: -10, z: hd }), look + ' terrace wall');
    assert.strictEqual(nav.componentAt({ x: 0, z: 0 }), nav.componentAt({ x: fw.centerX, z: fw.centerZ }), look + ' Fun Wing connected');
    assert.strictEqual(nav.componentAt({ x: 0, z: 0 }), nav.componentAt({ x: 0, z: L.wing.centerZ }), look + ' terrace connected');
  }
});

t('reachability matrix: every seat, reservable spot (pads, play stations, lounges, coffee, boardroom + lab chairs) and desk chair is reachable from every desk, without crossing anything, in both looks', () => {
  for (const look of Object.keys(LOOKS)) {
    const { nav, seat } = LOOKS[look], fails = [];
    const targets = spotsCat.map(s => ({ name: s.id, x: s.x, z: s.z })).concat(ids.map(id => ({ name: 'seat ' + id, ...seat(id) })));
    ids.forEach(id => {
      const from = seat(id);
      targets.forEach(tg => {
        const r = nav.plan(from, tg);
        if (!r.ok || r.snapped) { fails.push(id + ' -> ' + tg.name + ': ' + (r.reason || 'snapped')); return; }
        const v = violations(nav, from, r.pts);
        if (v.length) fails.push(id + ' -> ' + tg.name + ': ' + v.slice(0, 2).join(' '));
      });
    });
    assert.deepStrictEqual(fails.slice(0, 8), [], look + ' (' + fails.length + ' failures of ' + ids.length * targets.length + ')');
  }
});

t("Steve 1: desk -> Fun Station routes around obstacles (every desk, every Fun Wing pad / play station, both looks)", () => {
  const fun = spotsCat.filter(s => s.x > hw);
  assert.ok(fun.length >= 6, 'Fun Wing spots');
  for (const look of Object.keys(LOOKS)) {
    const { nav, seat } = LOOKS[look];
    ids.forEach(id => fun.forEach(sp => {
      const r = nav.plan(seat(id), sp);
      assert.ok(r.ok && !r.snapped, look + ' ' + id + ' -> ' + sp.id);
      assert.deepStrictEqual(violations(nav, seat(id), r.pts), [], look + ' ' + id + ' -> ' + sp.id);
      const straight = nav.clear(seat(id), sp);
      if (!straight) assert.ok(r.pts.length >= 2, 'goes around');
    }));
  }
});

t('Steve 2: through the Fun Wing opening without clipping the glass (avatar centre stays >= its radius from the corridor glass, the wall ends and the Fun Wing glass)', () => {
  const corrLen = Math.max(2.5, (fw.centerX - fw.width / 2) - hw + 0.5), fz = fw.centerZ;
  // glass segments as rendered (buildFunWing corridor walls at cz +- 3.2, 0.06 thick) + the east-wall ends at the opening
  const segs = [[hw, fz - 3.2, hw + corrLen, fz - 3.2], [hw, fz + 3.2, hw + corrLen, fz + 3.2], [hw, fz - 3.2 - 6, hw, fz - 3.0], [hw, fz + 3.0, hw, fz + 3.2 + 6]];
  const dseg = (p, q) => { const vx = q[2] - q[0], vz = q[3] - q[1], u = Math.max(0, Math.min(1, ((p.x - q[0]) * vx + (p.z - q[1]) * vz) / (vx * vx + vz * vz))); return Math.hypot(p.x - q[0] - u * vx, p.z - q[1] - u * vz); };
  let worst = Infinity;
  for (const look of Object.keys(LOOKS)) {
    const { nav, seat } = LOOKS[look];
    ids.forEach(id => fw.idleSpots.forEach(sp => {
      const to = { x: fw.centerX + sp.x, z: fw.centerZ + sp.z }, r = nav.plan(seat(id), to), all = [seat(id)].concat(r.pts);
      let crossed = false;
      for (let i = 0; i < all.length - 1; i++) {
        const a = all[i], b = all[i + 1];
        if ((a.x - hw) * (b.x - hw) <= 0 && a.x !== b.x) { crossed = true; const z = a.z + (b.z - a.z) * (hw - a.x) / (b.x - a.x); assert.ok(Math.abs(z - fz) <= T.FUN_OPEN - T.RADIUS + 0.05, look + ' ' + id + ' crosses the wall at z=' + z.toFixed(2)); }
        const len = Math.hypot(b.x - a.x, b.z - a.z), k = Math.max(1, Math.ceil(len / 0.05));
        for (let j = 0; j <= k; j++) {
          const p = { x: a.x + (b.x - a.x) * j / k, z: a.z + (b.z - a.z) * j / k };
          segs.forEach(q => { const d = dseg(p, q) - 0.03; worst = Math.min(worst, d); assert.ok(d >= T.RADIUS - 0.08, look + ' ' + id + ' clips glass at ' + p.x.toFixed(2) + ',' + p.z.toFixed(2) + ' (' + d.toFixed(2) + ' m)'); });
        }
      }
      assert.ok(crossed, look + ' ' + id + ' goes through the opening');
    }));
  }
  assert.ok(worst >= T.RADIUS - 0.08, 'closest approach ' + worst.toFixed(2));
});

t('Steve 3: a destination behind / under a blocked canopy is never reached through it (Cyberpunk pods)', () => {
  const { nav, seat } = LOOKS.cyber, inn = L.anchors.innovationLab, sim = L.anchors.simulationBay;
  const inPod = (p, c, w, d) => Math.abs(p.x - c.x) < w / 2 - 0.05 && Math.abs(p.z - c.z) < d / 2 - 0.05;
  // deep under the canopy: refused, no route at all (the avatar keeps its place)
  [inn, sim].forEach(c => { const r = nav.plan(seat('grok'), c); assert.ok(!r.ok && r.reason === 'goal-blocked', 'pod centre refused: ' + r.reason); assert.strictEqual(nav.path(seat('grok'), c), null); });
  // 1 m under the front edge: snapped to the nearest reachable free point OUTSIDE the canopy
  const edge = { x: inn.x, z: inn.z - 4 + 1 }, r1 = nav.plan(seat('grok'), edge);
  assert.ok(r1.ok && r1.snapped, 'near-edge goal snaps');
  assert.ok(!inPod(r1.goal, inn, 12, 8), 'snapped goal outside the pod');
  // right behind the back glass: reached by walking around, never under the canopy
  const behind = { x: inn.x + 2, z: inn.z + 4 + 0.9 }, from = seat('le');
  const r2 = nav.plan(from, behind);
  assert.ok(r2.ok, 'behind the pod is reachable: ' + r2.reason);
  const all = [from].concat(r2.pts);
  for (let i = 0; i < all.length - 1; i++) for (let j = 0; j <= 40; j++) {
    const p = { x: all[i].x + (all[i + 1].x - all[i].x) * j / 40, z: all[i].z + (all[i + 1].z - all[i].z) * j / 40 };
    assert.ok(!inPod(p, inn, 12, 8) && !inPod(p, sim, 14, 9), 'walks under a canopy at ' + p.x.toFixed(1) + ',' + p.z.toFixed(1));
  }
  assert.deepStrictEqual(violations(nav, from, r2.pts), []);
});

t('Steve 4: temporarily unreachable -> held in a safe place, flagged, bounded backoff, gives up (no loop), recovers when reachable again', () => {
  const nav = new T.Nav(L, { desks: classicDesks, look: 'classic' });
  const g = new T.RouteGuard(() => nav), from = { x: L.seats.grok.x, z: L.seats.grok.z }, pad = { x: fw.centerX + fw.idleSpots[2].x, z: fw.centerZ + fw.idleSpots[2].z };
  assert.strictEqual(g.request('grok', from, pad, 0).status, 'ok');
  nav.addObstacle({ x: hw + 1.5, z: fw.centerZ, w: 1.2, d: 8, hard: true }, 'closed corridor');
  assert.ok(nav.blockedAt({ x: hw + 1.5, z: fw.centerZ }));
  const seen = [];
  let now = 0, pos = { ...from };
  for (let k = 0; k < 60; k++, now += 250) {
    const r = g.request('grok', pos, pad, now);
    seen.push(r.status);
    if (r.pts) pos = r.pts[r.pts.length - 1];           // a route would move the avatar...
    assert.ok(r.status === 'wait' || r.status === 'blocked', 'never a route through the closed corridor: ' + r.status);
  }
  assert.deepStrictEqual(pos, from, 'held at its valid start');
  assert.ok(!nav.blockedAt(pos), 'the held spot is walkable');
  const snap = g.snapshot();
  assert.strictEqual(snap.stats.failures, 4, 'exactly maxTries plans failed (backoff 1 s, 2 s, 4 s)');
  assert.strictEqual(snap.stats.gaveUp, 1);
  assert.strictEqual(g.status('grok'), 'blocked');
  assert.strictEqual(snap.agents.grok.reason, 'no-path', 'unreachable is its own state with a reason');
  const plans = snap.stats.plans;
  for (let k = 0; k < 20; k++) g.request('grok', pos, pad, now + k * 1000);
  assert.strictEqual(g.snapshot().stats.plans, plans, 'gave up: no more planning for the same target (no endless loop)');
  assert.ok(g.snapshot().stats.held > 40, 'held requests counted');
  // reachable again: the grid version changes -> a fresh budget, a valid route, recovered++
  nav.removeObstacle('closed corridor');
  const r = g.request('grok', pos, pad, now + 30000);
  assert.strictEqual(r.status, 'ok');
  assert.deepStrictEqual(violations(nav, pos, r.pts), []);
  assert.strictEqual(g.snapshot().stats.recovered, 1);
  // ambient legs: give up at once
  const g2 = new T.RouteGuard(() => nav), deep = L.anchors.kitchen;
  assert.strictEqual(g2.request('x', from, { x: -hw - 5, z: 0 }, 0, { maxTries: 1 }).status, 'blocked');
  assert.ok(deep);
});

t('Steve 4b: a blocked spot falls through to the nearest reachable free spot via the reservation registry (and zones reseat)', () => {
  const reg = new S.Registry(spotsCat), pad = reg.claim('le', 'home', { groups: ['idle'], prefer: 'fun-pad#0' }) || reg.claim('le', 'home', { groups: ['idle'] });
  assert.ok(pad, 'claimed a pad');
  reg.setUnreachable(pad.id, true);
  const next = reg.claim('le', 'home', { groups: ['idle'], near: pad });
  assert.ok(next && next.id !== pad.id, 'moved off the unreachable spot');
  assert.ok(!reg.free(pad, 'other'), 'nobody else gets it either');
  assert.strictEqual(reg.clearUnreachable(), 1);
  // zones: an unreachable boardroom chair -> the nearest reachable free chair; none left -> back to the desk
  const reg2 = new S.Registry(spotsCat), zones = new Z.Zones({ layout: L, spots: reg2 }), bases = {}; ids.forEach(id => { bases[id] = 'IDLE'; });
  zones.open({ kind: 'handoff-review', seats: ['ba', 'pm'], label: 'x', source: 'y' }, 0, bases);
  const c0 = zones.target('pm'), sp0 = reg2.of('pm', 'zone');
  reg2.setUnreachable(sp0.id, true);
  assert.strictEqual(zones.reseat('pm'), 'moved');
  const c1 = zones.target('pm');
  assert.ok(c1 && Math.hypot(c1.x - c0.x, c1.z - c0.z) > 0.3, 'another chair');
  assert.ok(LOOKS.classic.nav.plan(LOOKS.classic.seat('pm'), c1).ok, 'the new chair is reachable');
  reg2.spots.filter(s => s.place === 'boardroom').forEach(s => reg2.setUnreachable(s.id, true));
  assert.strictEqual(zones.reseat('pm'), 'dropped');
  assert.strictEqual(zones.target('pm'), null, 'no chair left: pm stays at its desk');
  assert.strictEqual(reg2.conflicts().length, 0, 'no shared chairs');
  // ad-hoc points: pointOk filters unstandable ring points
  const nav = LOOKS.classic.nav, reg3 = new S.Registry(spotsCat, { pointOk: p => nav.standable(p) && nav.componentAt(p) === nav.mainComponent() });
  const bt = L.meetingSpaces.boardroom, pt = reg3.claimPoint('le', 'point', { x: bt.x, z: bt.z });
  assert.ok(pt && nav.standable(pt), 'a hand-off point on the boardroom table moves to a standable ring point');
});

t('Steve 5: a roster change / new target keeps existing avatars valid and navigating (grid rebuilt, start escapes, budgets reset)', () => {
  const navA = new T.Nav(L, { desks: cyberDesks.slice(0, 10), look: 'cyber' });
  let cur = navA;
  const g = new T.RouteGuard(() => cur), pad = { x: fw.centerX + fw.idleSpots[4].x, z: fw.centerZ + fw.idleSpots[4].z };
  // an avatar standing in the open where the new roster puts a desk
  const stand = { x: 4, z: -10 };
  assert.strictEqual(g.request('a1', stand, pad, 0).status, 'ok');
  const navB = new T.Nav(L, { desks: cyberDesks.concat([{ x: 4, z: -10, w: 2.85, d: 1.28, rot: 0, tag: 'desk newcomer' }]), look: 'cyber' });
  cur = navB;
  assert.ok(navB.blockedAt(stand), 'the newcomer desk covers the avatar');
  const r = navB.plan(stand, pad);
  assert.ok(r.ok, 'still routes: ' + r.reason);
  assert.ok(Math.hypot(r.pts[0].x - stand.x, r.pts[0].z - stand.z) <= 3, 'short first step off the new desk');
  // after that first step the rest of the route is clean
  assert.deepStrictEqual(violations(navB, r.pts[0], r.pts.slice(1)), []);
  // every other seat keeps a valid route on the new grid; a new target gets a fresh budget
  ids.forEach(id => { const p = LOOKS.cyber.seat(id), q = navB.plan(p, pad); assert.ok(q.ok && !violations(navB, p, q.pts).length, id); });
  cur = navA; navA.addObstacle({ x: hw + 1.5, z: fw.centerZ, w: 1.2, d: 8 }, 'shut');
  for (let k = 0; k < 8; k++) g.request('a2', LOOKS.cyber.seat('le'), pad, k * 5000);
  assert.strictEqual(g.status('a2'), 'blocked');
  const desk = LOOKS.cyber.seat('le2');
  assert.strictEqual(g.request('a2', LOOKS.cyber.seat('le'), desk, 99000).status, 'ok', 'a new reachable target is planned at once');
  // office.html rebuilds the grid when the drawn desks change (was: first call only, i.e. the demo roster)
  assert.ok(/if \(WALKNAV && WALKNAV_KEY === key\) return WALKNAV;/.test(html), 'grid keyed by the desks the look draws');
  assert.ok(/ROUTES = TevaNav\.RouteGuard \? new TevaNav\.RouteGuard\(\(\) => WALKNAV\)/.test(html), 'route guard reset with the grid');
  assert.ok(/Object\.keys\(modularWorkstations \|\| \{\}\)/.test(html) && /LAYOUT\.expansionStations \|\| \[\]\)\.forEach/.test(html), 'Cyberpunk: built workstations + expansion stations');
});

t('Steve 6: a zone transition with a new assignment still moves validly (boardroom and back, both looks)', () => {
  const { execFileSync } = require('child_process');
  const out = JSON.parse(execFileSync(process.execPath, [__filename, '--zone-json'], { encoding: 'utf8' }));
  for (const look of Object.keys(LOOKS)) {
    const o = out[look];
    assert.ok(o.session && o.seats.includes('ba') && o.seats.includes('pm'), look + ' session');
    assert.ok(o.legs.ba.ok && o.legs.ba.bad === 0 && o.legs.pm.ok && o.legs.pm.bad === 0, look + ' desk -> boardroom chair');
    assert.ok(o.legs.pmBack.changed && o.legs.pmBack.zoneAfter === null && o.legs.pmBack.ok && o.legs.pmBack.bad === 0, look + ' new assignment -> back to the desk');
  }
});

t('plan() never crosses anything, even for random / blocked endpoints; failures return no points', () => {
  let s = 7; const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  for (const look of Object.keys(LOOKS)) {
    const nav = LOOKS[look].nav; let ok = 0, fail = 0;
    for (let i = 0; i < 120; i++) {
      const a = { x: -35 + rnd() * 90, z: -26 + rnd() * 72 }, b = { x: -35 + rnd() * 90, z: -26 + rnd() * 72 };
      if (nav.blockedAt(a) && !nav.standable(a)) continue;
      const r = nav.plan(a, b);
      if (!r.ok) { fail++; assert.strictEqual(r.pts, null); assert.ok(['goal-blocked', 'no-path', 'start-blocked'].includes(r.reason), r.reason); continue; }
      ok++;
      const start = r.escaped ? r.pts[0] : a, rest = r.escaped ? r.pts.slice(1) : r.pts;
      assert.deepStrictEqual(violations(nav, start, rest), [], look + ' route ' + i);
      if (!r.snapped) assert.ok(Math.hypot(r.pts[r.pts.length - 1].x - b.x, r.pts[r.pts.length - 1].z - b.z) < 1e-6);
      else assert.ok(Math.hypot(r.goal.x - b.x, r.goal.z - b.z) <= T.SNAP_MAX + 1e-6 && !nav.blockedAt(r.goal));
    }
    assert.ok(ok > 30 && fail > 5, look + ' ok ' + ok + ' fail ' + fail);
  }
});

t('office.html wiring: no obstacle-crossing fallback, guarded moves in both looks, visible + diagnostic failure state, never the feed', () => {
  const body = name => { const i = html.indexOf('function ' + name + '('); assert.ok(i > 0, name); let d = 0, j = html.indexOf('{', i); for (let k = j; k < html.length; k++) { if (html[k] === '{') d++; else if (html[k] === '}' && --d === 0) return html.slice(i, k + 1); } return ''; };
  const nr = body('navRoute');
  assert.ok(!/TevaAmbient\.route|_nearestFree/.test(nr), 'navRoute: no door / nearest-cell fallback');
  assert.ok(/return r\.ok \? r\.pts : \[\];/.test(nr), 'navRoute: [] when no route');
  assert.ok(/if \(!leg\.length\) return null;/.test(body('navChain')), 'navChain: one failed leg fails the chain');
  assert.ok(/a\.route\.hold\) \{ held = true; dist = 0;/.test(html), 'Classic: hold position');
  assert.ok(/state\.routeStatus = held \? a\.route\.hold : null;/.test(html), 'Classic: unreachable kept apart from idle');
  assert.ok(/ZONES\.arrived\(a\.agent\.id, now\); \}/.test(html) && /state\.targetKind === 'zone' && !held\)/.test(html), 'a held seat never counts as arrived');
  assert.ok(/if \(g\.status === 'wait' \|\| g\.status === 'blocked'\) \{ if \(g\.status === 'blocked'\) routeRecover\(agent\.id, dest, t\.kind\); return; \}/.test(html), 'Cyberpunk: no moveAgent without a route');
  assert.ok(/if \(!full \|\| !full\.length\) \{/.test(html), 'ambient legs cancel when unreachable');
  assert.ok(/updateRouteMarks\(\);/.test(html) && /'route blocked'/.test(html), 'visible marker');
  assert.ok(/VO\.routes = \(\) =>/.test(html) && /console\.debug\('\[nav\] route blocked for'/.test(html), 'diagnostics: VO.routes() + console');
  assert.ok(/setInterval\(routeRetryTick, 500\)/.test(html), 'Cyberpunk retries after backoff');
  ['navPlan', 'routeRecover', 'routeRetryTick', 'updateRouteMarks', 'classicRoute', 'navInit'].forEach(f => assert.ok(!/addFeed|renderFeedList|feedRow|VO\.events\.push/.test(body(f)), f + ' never writes the feed'));
});

console.log('TESTS PASSED (' + n + ')');
