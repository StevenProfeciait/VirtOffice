/* TEVA HQ environment module — reusable scene composition for the modular renderer. */
(function (root) {
  'use strict';
  var THREE = root.THREE;
  var Scene = root.TevaScene;
  var L = root.LAYOUT || root.OFFICE_LAYOUT;

  var shared = {
    darkMetal: null,
    wood: null,
    rubber: null
  };

  function ensureMaterials() {
    if (!THREE) return;
    if (!shared.darkMetal) {
      shared.darkMetal = new THREE.MeshStandardMaterial({ color: 0x161b24, roughness: 0.58, metalness: 0.28 });
    }
    if (!shared.wood) {
      shared.wood = new THREE.MeshStandardMaterial({ color: 0x3d3428, roughness: 0.82, metalness: 0.05 });
    }
    if (!shared.rubber) {
      shared.rubber = new THREE.MeshStandardMaterial({ color: 0x252c38, roughness: 0.78, metalness: 0.08 });
    }
  }

  function hexColor(value, fallback) {
    if (typeof value === 'number') return value;
    if (typeof value === 'string' && value.charAt(0) === '#') return parseInt(value.slice(1), 16);
    return fallback || 0x64748b;
  }

  function build(options) {
    if (!THREE || !Scene || !L) return null;
    options = options || {};
    var group = new THREE.Group();
    var ground = options.includeExterior === false ? Scene.buildGround(options.groundSize) : buildExterior(options);
    var room = Scene.buildRoom(options);
    if (ground) group.add(ground);
    if (room) group.add(room);
    if (Scene.buildOfficeAccents) {
      var accents = Scene.buildOfficeAccents(options);
      if (accents) group.add(accents);
    }
    if (options.includeWing !== false) {
      var wing = buildWing(options);
      if (wing) group.add(wing);
    }
    group.userData.tevaEnvironment = true;
    return group;
  }

  function buildWorkstation(options) {
    if (!THREE) return null;
    ensureMaterials();
    options = options || {};
    var group = new THREE.Group();
    var accent = hexColor(options.color, 0x64748b);
    var style = options.style || 'standard';
    var trim = new THREE.MeshStandardMaterial({ color: accent, roughness: 0.42, metalness: 0.22, emissive: accent, emissiveIntensity: 0.12 });
    var deskMat = style === 'gaming' ? shared.darkMetal : shared.wood;
    var deskW = style === 'collab' ? 3.4 : 2.85;
    var desk = new THREE.Mesh(new THREE.BoxGeometry(deskW, 0.12, 1.28), deskMat);
    desk.position.y = 1.08;
    desk.castShadow = desk.receiveShadow = true;
    group.add(desk);
    [[-deskW / 2 + 0.15, -0.42], [deskW / 2 - 0.15, -0.42]].forEach(function (leg) {
      var support = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.05, 0.1), trim);
      support.position.set(leg[0], 0.54, leg[1]);
      group.add(support);
    });
    var cable = new THREE.Mesh(new THREE.BoxGeometry(deskW * 0.85, 0.025, 0.04), new THREE.MeshStandardMaterial({ color: 0x11151c, roughness: 0.9 }));
    cable.position.set(0, 1.02, 0.55);
    group.add(cable);
    var rear = new THREE.Mesh(new THREE.BoxGeometry(deskW * 0.88, 0.035, 0.035), trim);
    rear.position.set(0, 1.14, 0.54);
    group.add(rear);
    var monitorSpread = style === 'collab' ? 0.55 : 0.68;
    [-monitorSpread, monitorSpread].forEach(function (x) {
      var arm = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.32, 0.05), shared.darkMetal);
      arm.position.set(x, 1.34, 0.26);
      group.add(arm);
      var screenMat = new THREE.MeshStandardMaterial({
        color: 0x07111f,
        roughness: 0.3,
        metalness: 0.35,
        emissive: accent,
        emissiveIntensity: 0.18
      });
      var screen = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.55, 0.045), screenMat);
      screen.position.set(x, 1.6, 0.26);
      screen.userData.monitorScreen = true;
      group.add(screen);
    });
    var keyboard = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.035, 0.22), new THREE.MeshStandardMaterial({ color: 0x303744, roughness: 0.7 }));
    keyboard.position.set(-0.12, 1.17, -0.22);
    group.add(keyboard);
    var mouse = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 6), trim);
    mouse.scale.y = 0.35;
    mouse.position.set(0.48, 1.18, -0.22);
    group.add(mouse);
    if (style === 'gaming' || options.headphones) {
      var phones = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.035, 8, 16), shared.rubber);
      phones.rotation.x = Math.PI / 2;
      phones.position.set(0.95, 1.22, -0.05);
      group.add(phones);
    }
    var chair = new THREE.Group();
    var seat = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.1, 0.68), shared.rubber);
    seat.position.y = 0.62;
    chair.add(seat);
    var back = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.95, 0.1), shared.rubber);
    back.position.set(0, 1.05, 0.27);
    chair.add(back);
    var armL = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.42), shared.darkMetal);
    armL.position.set(-0.38, 0.78, 0);
    chair.add(armL);
    var armR = armL.clone();
    armR.position.x = 0.38;
    chair.add(armR);
    var stem = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.55, 8), shared.darkMetal);
    stem.position.y = 0.3;
    chair.add(stem);
    var base = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.04, 12), shared.darkMetal);
    base.position.y = 0.04;
    chair.add(base);
    chair.position.z = -0.9;
    group.add(chair);
    var led = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.08), trim.clone());
    led.position.set(deskW / 2 - 0.2, 1.2, 0.48);
    group.add(led);
    if (style !== 'collab') {
      var mug = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.12, 10), new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.55 }));
      mug.position.set(-deskW / 2 + 0.35, 1.2, -0.05);
      group.add(mug);
    }
    group.position.set(options.x || 0, options.y || 0, options.z || 0);
    group.rotation.y = options.rotation || 0;
    group.userData = {
      tevaWorkstation: true,
      agentId: options.agentId || null,
      statusLed: led,
      accent: accent,
      _pulse: 0,
      _state: 'IDLE'
    };
    group.userData.setStatus = function (state) {
      var palette = {
        ERROR: 0xef4444,
        BLOCKED: 0xef4444,
        WORKING: accent,
        RESEARCHING: accent,
        TESTING: accent,
        WAITING: 0xf59e0b,
        COMPLETED: 0x22c55e,
        IDLE: 0x64748b,
        OFFLINE: 0x374151
      };
      var value = palette[String(state || 'IDLE').toUpperCase()] || palette.IDLE;
      group.userData._state = String(state || 'IDLE').toUpperCase();
      if (led.material && led.material.color && led.material.color.setHex) led.material.color.setHex(value);
      if (led.material && 'emissive' in led.material && led.material.emissive && led.material.emissive.setHex) {
        led.material.emissive.setHex(value);
      }
      group.traverse(function (node) {
        if (node.userData && node.userData.monitorScreen && node.material && 'emissiveIntensity' in node.material) {
          node.material.emissiveIntensity = group.userData._state === 'WORKING' ? 0.28 + Math.sin(group.userData._pulse) * 0.06 : 0.16;
        }
      });
    };
    group.userData.tick = function (dt) {
      group.userData._pulse += dt || 0;
      if (group.userData._state === 'WORKING' || group.userData._state === 'RESEARCHING') {
        group.traverse(function (node) {
          if (node.userData && node.userData.monitorScreen && node.material && 'emissiveIntensity' in node.material) {
            node.material.emissiveIntensity = 0.22 + Math.sin(group.userData._pulse * 3) * 0.08;
          }
        });
      }
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
      var ws = buildWorkstation({ x: wing.centerX + desk.x, z: wing.centerZ + desk.z, color: 0x38bdf8, style: 'standard' });
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
