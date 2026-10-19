/* TEVA HQ environment module — reusable scene composition for the modular renderer. */
(function (root) {
  'use strict';
  var THREE = root.THREE;
  var Scene = root.TevaScene;
  var L = root.LAYOUT || root.OFFICE_LAYOUT;
  function build(options) {
    if (!THREE || !Scene || !L) return null;
    options = options || {};
    var group = new THREE.Group();
    var ground = options.includeExterior === false ? Scene.buildGround(options.groundSize) : buildExterior(options);
    var room = Scene.buildRoom(options);
    if (ground) group.add(ground);
    if (room) group.add(room);
    if (options.includeWing !== false) {
      var wing = buildWing(options);
      if (wing) group.add(wing);
    }
    group.userData.tevaEnvironment = true;
    return group;
  }
  function buildWorkstation(options) {
    if (!THREE) return null;
    options = options || {};
    var group = new THREE.Group();
    var accent = options.color || 0x64748b;
    var dark = new THREE.MeshStandardMaterial({ color: 0x161b24, roughness: 0.58, metalness: 0.28 });
    var trim = new THREE.MeshStandardMaterial({ color: accent, roughness: 0.42, metalness: 0.22, emissive: accent, emissiveIntensity: 0.12 });
    var desk = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.12, 1.25), dark);
    desk.position.y = 1.08;
    desk.castShadow = desk.receiveShadow = true;
    group.add(desk);
    [[-1.1, -0.42], [1.1, -0.42]].forEach(function (leg) {
      var support = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.05, 0.1), trim);
      support.position.set(leg[0], 0.54, leg[1]);
      group.add(support);
    });
    var rear = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.035, 0.035), trim);
    rear.position.set(0, 1.14, 0.53);
    group.add(rear);
    [-0.68, 0.68].forEach(function (x) {
      var stand = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.28, 0.07), dark);
      stand.position.set(x, 1.32, 0.24);
      group.add(stand);
      var screen = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.55, 0.045), new THREE.MeshStandardMaterial({ color: 0x07111f, roughness: 0.3, metalness: 0.35, emissive: accent, emissiveIntensity: 0.16 }));
      screen.position.set(x, 1.58, 0.24);
      group.add(screen);
    });
    var keyboard = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.035, 0.22), new THREE.MeshStandardMaterial({ color: 0x303744, roughness: 0.7 }));
    keyboard.position.set(-0.12, 1.17, -0.22);
    group.add(keyboard);
    var mouse = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 6), new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 0.3 }));
    mouse.scale.y = 0.35;
    mouse.position.set(0.48, 1.18, -0.22);
    group.add(mouse);
    var chair = new THREE.Group();
    var chairMat = new THREE.MeshStandardMaterial({ color: 0x252c38, roughness: 0.78 });
    var seat = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.12, 0.68), chairMat);
    seat.position.y = 0.62;
    chair.add(seat);
    var back = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.95, 0.1), chairMat);
    back.position.set(0, 1.05, 0.27);
    chair.add(back);
    chair.position.z = -0.9;
    group.add(chair);
    var led = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.08), trim);
    led.position.set(1.2, 1.2, 0.48);
    group.add(led);
    group.position.set(options.x || 0, options.y || 0, options.z || 0);
    group.userData = { tevaWorkstation: true, agentId: options.agentId || null, statusLed: led };
    group.userData.setStatus = function (state) {
      var palette = { ERROR: 0xef4444, BLOCKED: 0xef4444, WORKING: accent, RESEARCHING: accent, TESTING: accent, WAITING: 0xf59e0b, COMPLETED: 0x22c55e, IDLE: 0x64748b, OFFLINE: 0x374151 };
      var value = palette[String(state || 'IDLE').toUpperCase()] || palette.IDLE;
      if (led.material && led.material.color && led.material.color.setHex) led.material.color.setHex(value);
      if (led.material && 'emissive' in led.material && led.material.emissive && led.material.emissive.setHex) led.material.emissive.setHex(value);
    };
    return group;
  }
  function buildWing(options) {
    if (!THREE || !L || !L.wing) return null;
    options = options || {};
    var wing = L.wing;
    var group = new THREE.Group();
    var floor = new THREE.Mesh(new THREE.BoxGeometry(options.width || wing.width, 0.1, options.depth || wing.depth), new THREE.MeshStandardMaterial({ color: 0x202733, roughness: 0.86 }));
    floor.position.set(wing.centerX, wing.floorY || 0, wing.centerZ);
    floor.receiveShadow = true;
    group.add(floor);
    var rail = new THREE.Mesh(new THREE.BoxGeometry(wing.width, 1.2, 0.08), new THREE.MeshStandardMaterial({ color: 0x7dd3fc, transparent: true, opacity: 0.22, roughness: 0.18, metalness: 0.35 }));
    rail.position.set(wing.centerX, 0.6, wing.centerZ + wing.depth / 2);
    group.add(rail);
    (wing.hotDesks || []).forEach(function (desk) {
      var ws = buildWorkstation({ x: wing.centerX + desk.x, z: wing.centerZ + desk.z, color: 0x38bdf8 });
      if (ws) group.add(ws);
    });
    group.userData.tevaWing = true;
    return group;
  }
  function buildExterior(options) {
    if (!THREE || !L) return null;
    options = options || {};
    var group = new THREE.Group();
    var size = options.groundSize || (L.exterior && L.exterior.groundSize) || 220;
    var ground = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshStandardMaterial({ color: 0x0b1018, roughness: 0.98 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    group.add(ground);
    var plaza = new THREE.Mesh(new THREE.BoxGeometry((L.exterior && L.exterior.plazaWidth) || 10, 0.04, 5), new THREE.MeshStandardMaterial({ color: 0x303846, roughness: 0.86 }));
    plaza.position.set(0, 0, (L.room && L.room.depth ? L.room.depth / 2 : 18) + 2.5);
    group.add(plaza);
    var count = (L.exterior && L.exterior.skylineCount) || 10;
    for (var i = 0; i < count; i++) {
      var towerH = 4 + (i % 4) * 1.4;
      var tower = new THREE.Mesh(new THREE.BoxGeometry(2 + (i % 3), towerH, 2), new THREE.MeshStandardMaterial({ color: 0x17202d, roughness: 0.92 }));
      tower.position.set(-38 + i * 8, towerH / 2, -34 - (i % 2) * 8);
      group.add(tower);
    }
    group.userData.tevaExterior = true;
    return group;
  }
  root.TevaEnv = root.TevaEnv || {
    buildRoom: function (options) { return Scene && Scene.buildRoom ? Scene.buildRoom(options) : null; },
    build: build,
    buildWorkstation: buildWorkstation,
    buildWing: buildWing,
    buildExterior: buildExterior,
    dispose: function (object) { if (Scene && Scene.disposeObject) Scene.disposeObject(object); }
  };
})(typeof window !== 'undefined' ? window : global);
