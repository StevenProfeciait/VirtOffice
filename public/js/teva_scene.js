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
    disposeObject: disposeObject,
    init: function () { return null; },
    dispose: function () {}
  };
})(typeof window !== 'undefined' ? window : global);
