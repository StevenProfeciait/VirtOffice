/* TEVA HQ camera helpers — easing and preset modes. */
(function (root) {
  'use strict';

  var L = root.LAYOUT || root.OFFICE_LAYOUT;

  function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function overviewPreset() {
    var cam = L && L.camera && L.camera.main;
    return {
      mode: 'overview',
      target: cam ? cam.target.slice() : [0, 0, 0],
      zoom: cam ? cam.zoom : 1.18,
      rotation: cam ? cam.rotation : -Math.PI / 4,
      eyeHeight: 0.75
    };
  }

  function departmentPreset(zoneName) {
    var dep = L && L.departments && L.departments[zoneName];
    if (!dep) return overviewPreset();
    return {
      mode: 'department',
      target: dep.target ? dep.target.slice() : [0, 0, 0],
      zoom: dep.zoom || 1.25,
      rotation: dep.rotation != null ? dep.rotation : -Math.PI / 4,
      eyeHeight: 0.8
    };
  }

  function workstationPreset(position) {
    position = position || { x: 0, z: 0 };
    return {
      mode: 'workstation',
      target: [Number(position.x) || 0, 0, Number(position.z) || 0],
      // The legacy camera treats smaller zoom values as closer. Keep the
      // workstation preset inside the normal zoom range so desk/seat details
      // are actually inspectable rather than leaving the overview distance.
      zoom: 0.24,
      // Approach from the chair side of the desk so the seated body, hands,
      // keyboard, and monitor relationship remain visible in the close-up.
      rotation: Number.isFinite(Number(position.rotation)) ? position.rotation + Math.PI - Math.PI / 6 : Math.PI - Math.PI / 5,
      eyeHeight: 0.72,
      distance: 2.4
    };
  }

  function zoneForAgent(agent) {
    agent = agent || {};
    return (agent.avatar && agent.avatar.zone) || agent.zone || null;
  }

  root.TevaCam = {
    easeInOutCubic: easeInOutCubic,
    lerp: lerp,
    overviewPreset: overviewPreset,
    departmentPreset: departmentPreset,
    workstationPreset: workstationPreset,
    zoneForAgent: zoneForAgent
  };
})(typeof window !== 'undefined' ? window : global);
