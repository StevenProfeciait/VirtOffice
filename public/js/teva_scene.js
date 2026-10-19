/* TEVA HQ scene module — environment builders. */
(function (root) {
  'use strict';
  var THREE = root.THREE;
  var L = root.LAYOUT || root.OFFICE_LAYOUT;

  function buildFog() {
    if (!THREE || !L || !L.fog) return null;
    return new THREE.Fog(L.fog.color, L.fog.near, L.fog.far);
  }

  function buildGround(size) {
    if (!THREE) return null;
    var s = size || (L && L.exterior && L.exterior.groundSize) || 220;
    var geo = new THREE.PlaneGeometry(s, s);
    var mat = new THREE.MeshStandardMaterial({ color: 0x0b1018, roughness: 0.98 });
    var m = new THREE.Mesh(geo, mat);
    m.rotation.x = -Math.PI / 2;
    m.position.y = -0.01;
    return m;
  }

  function mat(color, options) {
    return new THREE.MeshStandardMaterial(Object.assign({ color: color, roughness: 0.8 }, options || {}));
  }

  function buildRoom(options) {
    if (!THREE || !L || !L.room) return null;
    options = options || {};
    var group = new THREE.Group();
    var w = options.width || L.room.width, d = options.depth || L.room.depth;
    var h = options.height || L.room.wallHeight;
    var floor = new THREE.Mesh(new THREE.BoxGeometry(w, 0.12, d), mat(0xd7dbe2, { roughness: 0.92 }));
    floor.position.y = -0.06;
    floor.receiveShadow = true;
    group.add(floor);
    var wallMat = mat(0xf1f3f5, { roughness: 0.88 });
    [[0, -d / 2, w, 0.16], [0, d / 2, w, 0.16], [-w / 2, 0, 0.16, d], [w / 2, 0, 0.16, d]].forEach(function (wall) {
      var mesh = new THREE.Mesh(new THREE.BoxGeometry(wall[2], h, wall[3]), wallMat);
      mesh.position.set(wall[0], h / 2, wall[1]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    });
    return group;
  }

  function buildOfficeAccents(options) {
    if (!THREE || !L) return null;
    options = options || {};
    var group = new THREE.Group();
    (L.zones || []).forEach(function (zone) {
      if (!zone || !zone.color) return;
      var c = parseInt(String(zone.color).replace('#', ''), 16);
      var patch = new THREE.Mesh(
        new THREE.BoxGeometry(zone.w || 8, 0.02, zone.d || 8),
        mat(c, { roughness: 0.94, transparent: true, opacity: 0.12 })
      );
      patch.position.set(zone.x || 0, 0.01, zone.z || 0);
      patch.receiveShadow = true;
      group.add(patch);
    });
    (L.dividers || []).forEach(function (div) {
      var isGlass = div.type === 'glass';
      var dividerMat = isGlass
        ? mat(0x93c5fd, { roughness: 0.12, metalness: 0.4, transparent: true, opacity: 0.28 })
        : mat(0x475569, { roughness: 0.75 });
      var mesh = new THREE.Mesh(new THREE.BoxGeometry(div.w || 0.12, div.h || 1.3, div.d || 4), dividerMat);
      mesh.position.set(div.x || 0, (div.h || 1.3) / 2, div.z || 0);
      mesh.rotation.y = div.rot || 0;
      group.add(mesh);
    });
    if (L.anchors && L.anchors.meeting) {
      var meet = L.anchors.meeting;
      var glass = new THREE.Mesh(
        new THREE.BoxGeometry(8, 2.4, 0.08),
        mat(0x7dd3fc, { roughness: 0.08, metalness: 0.35, transparent: true, opacity: 0.22 })
      );
      glass.position.set(meet.x, 1.2, meet.z - 2.2);
      group.add(glass);
      var table = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.08, 1.4), mat(0x334155, { roughness: 0.7 }));
      table.position.set(meet.x, 0.78, meet.z);
      group.add(table);
    }
    (L.anchors && L.anchors.plantRing || []).forEach(function (p) {
      var pot = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 0.35, 8), mat(0x78350f, { roughness: 0.85 }));
      pot.position.set(p[0], 0.18, p[1]);
      group.add(pot);
      var leaves = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 6), mat(0x15803d, { roughness: 0.9 }));
      leaves.position.set(p[0], 0.55, p[1]);
      leaves.scale.y = 1.2;
      group.add(leaves);
    });
    if (L.anchors && L.anchors.lounge) {
      var lounge = L.anchors.lounge;
      var sofa = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.55, 0.9), mat(0x1e293b, { roughness: 0.82 }));
      sofa.position.set(lounge.x, 0.28, lounge.z);
      group.add(sofa);
    }
    group.userData.tevaAccents = true;
    return group;
  }

  function disposeObject(object) {
    if (!object || !object.traverse) return;
    object.traverse(function (node) {
      if (node.geometry && node.geometry.dispose) node.geometry.dispose();
      if (node.material) {
        var materials = Array.isArray(node.material) ? node.material : [node.material];
        materials.forEach(function (m) { if (m && m.dispose) m.dispose(); });
      }
    });
  }

  root.TevaScene = root.TevaScene || {
    buildFog: buildFog,
    buildGround: buildGround,
    buildRoom: buildRoom,
    buildOfficeAccents: buildOfficeAccents,
    disposeObject: disposeObject,
    init: function () { return null; },
    dispose: function () {}
  };
})(typeof window !== 'undefined' ? window : global);
