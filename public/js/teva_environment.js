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
    if (options.includeFunWing !== false) {
      var funWing = buildFunWing(options);
      if (funWing) group.add(funWing);
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
    var isCommand = style === 'command';
    var cyberpunk = options.cyberpunk !== false;
    var trim = new THREE.MeshStandardMaterial({ color: accent, roughness: 0.32, metalness: 0.42, emissive: accent, emissiveIntensity: cyberpunk || isCommand ? 0.38 : 0.12 });
    var deskMat = cyberpunk || isCommand ? new THREE.MeshStandardMaterial({ color: 0x121827, roughness: 0.34, metalness: 0.68 }) : (style === 'gaming' ? shared.darkMetal : shared.wood);
    var deskW = Number(options.deskW) || (style === 'collab' ? 3.4 : isCommand ? 4.4 : 2.85);
    var deskD = Number(options.deskD) || (isCommand ? 1.7 : 1.28);
    var halfD = deskD / 2;

    if (isCommand) {
      var platform = new THREE.Mesh(
        new THREE.BoxGeometry(deskW + 0.5, 0.04, deskD + 1.25),
        new THREE.MeshStandardMaterial({ color: 0x0b1020, roughness: 0.55, metalness: 0.45 })
      );
      platform.position.set(0, 0.02, -0.2);
      platform.receiveShadow = true;
      group.add(platform);
      var rim = new THREE.Mesh(new THREE.BoxGeometry(deskW + 0.55, 0.02, 0.04), new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.75 }));
      rim.position.set(0, 0.045, -halfD - 0.55);
      rim.userData.neon = true;
      group.add(rim);
    }

    var desk = new THREE.Mesh(new THREE.BoxGeometry(deskW, 0.12, deskD), deskMat);
    desk.position.y = 1.08;
    desk.userData.deskTop = true;
    desk.castShadow = desk.receiveShadow = true;
    group.add(desk);
    if (cyberpunk || isCommand) {
      var frontGlow = new THREE.Mesh(new THREE.BoxGeometry(deskW * 0.9, 0.02, 0.028), new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.95 }));
      frontGlow.position.set(0, 1.025, -halfD);
      frontGlow.userData.neon = true;
      group.add(frontGlow);
      [-1, 1].forEach(function (side) {
        var sideGlow = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.02, deskD * 0.88), new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.78 }));
        sideGlow.position.set(side * (deskW / 2 - 0.06), 1.025, 0);
        sideGlow.userData.neon = true;
        group.add(sideGlow);
      });
    }
    var legPts = isCommand
      ? [[-deskW / 2 + 0.18, -halfD + 0.22], [deskW / 2 - 0.18, -halfD + 0.22], [-deskW / 2 + 0.18, halfD - 0.22], [deskW / 2 - 0.18, halfD - 0.22]]
      : [[-deskW / 2 + 0.15, -halfD + 0.22], [deskW / 2 - 0.15, -halfD + 0.22]];
    legPts.forEach(function (leg) {
      var support = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.05, 0.1), trim);
      support.position.set(leg[0], 0.54, leg[1]);
      group.add(support);
    });
    var cable = new THREE.Mesh(new THREE.BoxGeometry(deskW * 0.85, 0.025, 0.04), new THREE.MeshStandardMaterial({ color: 0x11151c, roughness: 0.9 }));
    cable.position.set(0, 1.02, halfD - 0.1);
    group.add(cable);
    var rear = new THREE.Mesh(new THREE.BoxGeometry(deskW * 0.88, 0.035, 0.035), trim);
    rear.position.set(0, 1.14, halfD - 0.12);
    group.add(rear);

    var screenMatBase = function () {
      return new THREE.MeshStandardMaterial({
        color: 0x07111f, roughness: 0.3, metalness: 0.35, emissive: accent, emissiveIntensity: 0.2
      });
    };
    if (isCommand) {
      var centerArm = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.38, 0.06), shared.darkMetal);
      centerArm.position.set(0, 1.38, 0.28);
      group.add(centerArm);
      var centerScreen = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.58, 0.05), screenMatBase());
      centerScreen.position.set(0, 1.68, 0.28);
      centerScreen.userData.monitorScreen = true;
      group.add(centerScreen);
      [-1.35, 1.35].forEach(function (x) {
        var arm = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.34, 0.05), shared.darkMetal);
        arm.position.set(x, 1.36, 0.22);
        group.add(arm);
        var screen = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.52, 0.045), screenMatBase());
        screen.position.set(x, 1.62, 0.22);
        screen.rotation.y = x < 0 ? 0.28 : -0.28;
        screen.userData.monitorScreen = true;
        group.add(screen);
      });
    } else {
      var monitorSpread = style === 'collab' ? 0.55 : 0.68;
      [-monitorSpread, monitorSpread].forEach(function (x) {
        var arm = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.32, 0.05), shared.darkMetal);
        arm.position.set(x, 1.34, 0.26);
        group.add(arm);
        var screen = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.55, 0.045), screenMatBase());
        screen.position.set(x, 1.6, 0.26);
        screen.userData.monitorScreen = true;
        group.add(screen);
      });
    }
    if (cyberpunk || isCommand) {
      var holoW = isCommand ? 2.2 : 1.45;
      var holoMat = new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 0.72, transparent: true, opacity: 0.16, metalness: 0.25, roughness: 0.18, side: THREE.DoubleSide });
      var holo = new THREE.Mesh(new THREE.BoxGeometry(holoW, isCommand ? 0.62 : 0.5, 0.018), holoMat);
      holo.position.set(0, isCommand ? 2.15 : 1.92, 0.4);
      holo.userData.holoPanel = true;
      group.add(holo);
      var holoRing = new THREE.Mesh(new THREE.TorusGeometry(isCommand ? 0.28 : 0.2, 0.012, 8, 32), new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.72 }));
      holoRing.position.set(0, isCommand ? 2.15 : 1.92, 0.385);
      holoRing.userData.neon = true;
      group.add(holoRing);
      if (isCommand) {
        var holoRing2 = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.01, 8, 40), new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.45 }));
        holoRing2.position.set(0, 2.15, 0.38);
        holoRing2.userData.neon = true;
        group.add(holoRing2);
      }
      var towerPositions = isCommand ? [deskW / 2 - 0.32, -deskW / 2 + 0.32] : [deskW / 2 - 0.28];
      towerPositions.forEach(function (tx) {
        var tower = new THREE.Mesh(new THREE.BoxGeometry(0.3, isCommand ? 0.72 : 0.62, 0.55), new THREE.MeshStandardMaterial({ color: 0x0b1020, roughness: 0.28, metalness: 0.72 }));
        tower.position.set(tx, isCommand ? 0.78 : 0.72, 0.15);
        tower.castShadow = true;
        group.add(tower);
        var towerWindow = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.28, 0.012), new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.55 }));
        towerWindow.position.set(tx, isCommand ? 0.82 : 0.75, -0.12);
        towerWindow.userData.neon = true;
        group.add(towerWindow);
      });
    }
    if (isCommand) {
      var credenza = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.85, 1.4), new THREE.MeshStandardMaterial({ color: 0x151b28, metalness: 0.55, roughness: 0.4 }));
      credenza.position.set(deskW / 2 + 0.45, 0.42, 0);
      credenza.castShadow = true;
      group.add(credenza);
      var credTop = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.04, 1.42), trim);
      credTop.position.set(deskW / 2 + 0.45, 0.86, 0);
      group.add(credTop);
    }
    var keyboard = new THREE.Mesh(new THREE.BoxGeometry(isCommand ? 0.85 : 0.62, 0.035, 0.24), cyberpunk || isCommand ? new THREE.MeshStandardMaterial({ color: 0x101827, roughness: 0.42, metalness: 0.45, emissive: accent, emissiveIntensity: 0.18 }) : new THREE.MeshStandardMaterial({ color: 0x303744, roughness: 0.7 }));
    keyboard.position.set(-0.12, 1.17, -halfD + 0.3);
    keyboard.userData.keyboard = true; // typing fix: at the front edge, within reach of the seated avatar
    group.add(keyboard);
    var mouse = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 6), trim);
    mouse.scale.y = 0.35;
    mouse.position.set(isCommand ? 0.62 : 0.48, 1.18, -halfD + 0.3);
    group.add(mouse);
    if (style === 'gaming' || style === 'command' || options.headphones) {
      var phones = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.035, 8, 16), shared.rubber);
      phones.rotation.x = Math.PI / 2;
      phones.position.set(deskW / 2 - 0.55, 1.22, -0.1);
      group.add(phones);
    }
    var chairScale = isCommand ? 1.18 : 1;
    var chair = new THREE.Group();
    var seat = new THREE.Mesh(new THREE.BoxGeometry(0.72 * chairScale, 0.1, 0.68 * chairScale), shared.rubber);
    seat.position.y = 0.62;
    chair.add(seat);
    var back = new THREE.Mesh(new THREE.BoxGeometry(0.72 * chairScale, isCommand ? 1.15 : 0.95, 0.1), shared.rubber);
    back.position.set(0, isCommand ? 1.15 : 1.05, 0.27 * chairScale);
    chair.add(back);
    var armL = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.42 * chairScale), shared.darkMetal);
    armL.position.set(-0.38 * chairScale, 0.78, 0);
    chair.add(armL);
    var armR = armL.clone();
    armR.position.x = 0.38 * chairScale;
    chair.add(armR);
    var stem = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.55, 8), shared.darkMetal);
    stem.position.y = 0.3;
    chair.add(stem);
    var base = new THREE.Mesh(new THREE.CylinderGeometry(0.32 * chairScale, 0.32 * chairScale, 0.04, 12), shared.darkMetal);
    base.position.y = 0.04;
    chair.add(base);
    chair.position.z = isCommand ? -1.05 : -0.9;
    // The chair model is authored with its backrest on +z, but the desk sits on
    // the +z side of the seat, so an unrotated chair puts the backrest between the
    // sitter and the monitors. Face the chair into the desk instead.
    chair.rotation.y = Math.PI;
    chair.userData.chair = true;
    if (cyberpunk || isCommand) {
      var chairTrim = new THREE.Mesh(new THREE.BoxGeometry(0.55 * chairScale, 0.025, 0.026), new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.85 }));
      chairTrim.position.set(0, isCommand ? 1.5 : 1.34, 0.215 * chairScale);
      chairTrim.userData.neon = true;
      chair.add(chairTrim);
      var chairGlow = new THREE.Mesh(new THREE.BoxGeometry(0.5 * chairScale, 0.018, 0.35), new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.2 }));
      chairGlow.position.set(0, 0.55, -0.02);
      chairGlow.userData.neon = true;
      chair.add(chairGlow);
    }
    group.add(chair);
    var led = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.08), trim.clone());
    led.position.set(deskW / 2 - 0.25, 1.2, halfD - 0.15);
    group.add(led);
    if (style !== 'collab') {
      var mug = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.12, 10), new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.55 }));
      mug.position.set(-deskW / 2 + 0.4, 1.2, -0.1);
      group.add(mug);
    }
    group.position.set(options.x || 0, options.y || 0, options.z || 0);
    group.rotation.y = options.rotation || 0;
    group.userData = {
      tevaWorkstation: true,
      agentId: options.agentId || null,
      assetId: options.assetId || 'cyberpunk-workstation-procedural',
      statusLed: led,
      accent: accent,
      _pulse: 0,
      _state: 'IDLE',
      cyberpunk: cyberpunk
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
        if (node.userData && node.userData.neon && node.material && node.material.color && node.material.color.setHex) node.material.color.setHex(value);
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
      if (group.userData.cyberpunk) {
        group.traverse(function (node) {
          if (node.userData && node.userData.holoPanel && node.material) node.material.opacity = 0.12 + (Math.sin(group.userData._pulse * 2.4) + 1) * 0.035;
          if (node.userData && node.userData.neon && node.material && node.material.opacity != null) node.material.opacity = 0.58 + (Math.sin(group.userData._pulse * 3.2) + 1) * 0.12;
        });
      }
    };
    return group;
  }

  function buildWing(options) {
    if (!THREE || !L || !L.wing) return null;
    options = options || {};
    var wing = L.wing;
    var cx = wing.centerX;
    var cz = wing.centerZ;
    var ww = options.width || wing.width;
    var wd = options.depth || wing.depth;
    var group = new THREE.Group();
    var floor = new THREE.Mesh(new THREE.BoxGeometry(ww, 0.1, wd), new THREE.MeshStandardMaterial({ color: 0x111b31, roughness: 0.5, metalness: 0.32 }));
    floor.position.set(cx, wing.floorY || 0, cz);
    floor.receiveShadow = true;
    group.add(floor);

    var cyan = new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.7 });
    var sideGlass = new THREE.MeshStandardMaterial({ color: 0xb8e0f5, transparent: true, opacity: 0.16, roughness: 0.08, metalness: 0.1, side: THREE.DoubleSide });
    [-1, 1].forEach(function (side) {
      var wall = new THREE.Mesh(new THREE.BoxGeometry(0.05, 2.4, wd - 1.5), sideGlass);
      wall.position.set(cx + side * (ww / 2 - 0.4), 1.2, cz);
      group.add(wall);
    });

    var rail = new THREE.Mesh(new THREE.BoxGeometry(ww - 2, 1.1, 0.05), new THREE.MeshStandardMaterial({ color: 0x7dd3fc, transparent: true, opacity: 0.2, roughness: 0.18, metalness: 0.35 }));
    rail.position.set(cx, 0.58, cz + wd / 2 - 0.12);
    group.add(rail);
    var railGlow = new THREE.Mesh(new THREE.BoxGeometry(ww - 2.2, 0.04, 0.06), cyan);
    railGlow.position.set(cx, 1.12, cz + wd / 2 - 0.12);
    group.add(railGlow);
    var seam = new THREE.Mesh(new THREE.BoxGeometry(Math.min(ww * 0.5, 20), 0.04, 2.8), new THREE.MeshStandardMaterial({ color: 0x131d33, emissive: 0x38bdf8, emissiveIntensity: 0.1, metalness: 0.25, roughness: 0.5 }));
    seam.position.set(cx, 0.06, cz - wd / 2 + 1.2);
    group.add(seam);

    var lounge = wing.lounge || { x: -14, z: 6 };
    var sofa = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.4, 0.9), new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.85 }));
    sofa.position.set(cx + lounge.x, 0.28, cz + lounge.z);
    group.add(sofa);
    var wb = wing.whiteboard || { x: 14, z: 5 };
    var board = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.3, 0.05), new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.85 }));
    board.position.set(cx + wb.x, 1.1, cz + wb.z);
    group.add(board);

    (wing.hotDesks || []).forEach(function (desk) {
      var ws = buildWorkstation({ x: cx + desk.x, z: cz + desk.z, color: 0x38bdf8, style: 'standard' });
      if (ws) group.add(ws);
    });
    group.userData.tevaWing = true;
    return group;
  }

  function buildFunWing(options) {
    if (!THREE || !L || !L.funWing) return null;
    options = options || {};
    var fw = L.funWing;
    var cx = fw.centerX;
    var cz = fw.centerZ;
    var ww = options.width || fw.width;
    var wd = options.depth || fw.depth;
    var group = new THREE.Group();
    var floor = new THREE.Mesh(
      new THREE.BoxGeometry(ww, 0.1, wd),
      new THREE.MeshStandardMaterial({ color: 0x111b31, roughness: 0.5, metalness: 0.32 })
    );
    floor.position.set(cx, fw.floorY || 0, cz);
    floor.receiveShadow = true;
    group.add(floor);

    var pink = new THREE.MeshBasicMaterial({ color: 0xf472b6, transparent: true, opacity: 0.75 });
    var softSeat = new THREE.MeshStandardMaterial({ color: 0x2a1530, roughness: 0.88 });
    var seam = new THREE.Mesh(
      new THREE.BoxGeometry(3.0, 0.04, Math.min(wd * 0.4, 10)),
      new THREE.MeshStandardMaterial({ color: 0x1a1220, emissive: 0xf472b6, emissiveIntensity: 0.12, metalness: 0.25, roughness: 0.5 })
    );
    seam.position.set(cx - ww / 2 + 1.4, 0.06, cz);
    group.add(seam);

    var ar = fw.arcadeRow || { x: 0, z: -6 };
    var cab = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.6, 0.8), new THREE.MeshStandardMaterial({ color: 0x161b24, metalness: 0.65, roughness: 0.3 }));
    cab.position.set(cx + ar.x, 0.8, cz + ar.z);
    group.add(cab);
    var screen = new THREE.Mesh(
      new THREE.PlaneGeometry(0.85, 0.65),
      new THREE.MeshStandardMaterial({ color: 0x0a0a12, emissive: 0xf472b6, emissiveIntensity: 0.5 })
    );
    screen.position.set(cx + ar.x, 1.1, cz + ar.z + 0.42);
    group.add(screen);

    var chill = fw.chillPit || { x: -5, z: 8 };
    var sofa = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.38, 0.85), softSeat);
    sofa.position.set(cx + chill.x, 0.28, cz + chill.z);
    group.add(sofa);

    (fw.idleSpots || []).forEach(function (spot) {
      var pad = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.04, 12), pink);
      pad.position.set(cx + spot.x, 0.04, cz + spot.z);
      group.add(pad);
    });

    group.userData.tevaFunWing = true;
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
    buildFunWing: buildFunWing,
    buildExterior: buildExterior,
    dispose: function (object) { if (Scene && Scene.disposeObject) Scene.disposeObject(object); }
  };
})(typeof window !== 'undefined' ? window : global);
