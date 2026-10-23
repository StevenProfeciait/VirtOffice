/* TEVA HQ UI style toggle (2026-10-22): Classic (plain light office) vs Cyberpunk (the "modular" /
 * futuristic office: dark floor, cyan lighting, neon workstations, modular avatars).
 *
 * Pure helpers: no THREE, no DOM, no globals touched, so tests/test_teva_ui_style.js can drive it.
 * office.html owns the button, the Settings row, the U key, localStorage and the reload.
 * Precedence for one page load:
 *   1. ?modular=1 forces Cyberpunk, ?modular=0 forces Classic (URL wins for that load);
 *   2. otherwise localStorage.teva_modular: '0' means Classic, '1' means Cyberpunk;
 *   3. otherwise the default, Cyberpunk (since 2026-10-22, Steve: "Make Cyberpunk the default").
 * Switching writes localStorage ('1' Cyberpunk / '0' Classic, never removed, so a Classic choice
 * survives the Cyberpunk default) and strips ?modular= so the choice sticks.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TevaUiStyle = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var PARAM = 'modular';
  var STORAGE_KEY = 'teva_modular';
  var KEY = 'u';
  var DEFAULT_MODULAR = true; // Cyberpunk is the default (2026-10-22); Classic needs ?modular=0 or a stored '0'
  var LABELS = { cyberpunk: '🌆 Cyberpunk', classic: '⬜ Classic' };

  function param(search) {
    if (!search) return null;
    try { return new URLSearchParams(String(search)).get(PARAM); } catch (e) { return null; }
  }
  // -> { modular: bool, style: 'cyberpunk'|'classic', source: 'url'|'storage'|'default' }
  function resolve(search, stored) {
    var p = param(search);
    var modular, source;
    if (p === '1') { modular = true; source = 'url'; }
    else if (p === '0') { modular = false; source = 'url'; }
    else if (stored === '1') { modular = true; source = 'storage'; }
    else if (stored === '0') { modular = false; source = 'storage'; }
    else { modular = DEFAULT_MODULAR; source = 'default'; }
    return { modular: modular, style: modular ? 'cyberpunk' : 'classic', source: source };
  }
  function label(modular) { return modular ? LABELS.cyberpunk : LABELS.classic; }
  // Value to write to localStorage for a chosen style. Classic is stored as '0' (not removed): with
  // Cyberpunk as the default, a cleared key would bring Cyberpunk back on the next load.
  function storageValue(modular) { return modular ? '1' : '0'; }
  // Remove ?modular= (any value) and keep every other param in order. Returns '' or '?a=b&...'.
  function stripParam(search) {
    var s = String(search || '');
    if (s.charAt(0) === '?') s = s.slice(1);
    if (!s) return '';
    var kept = s.split('&').filter(function (part) {
      if (!part) return false;
      var k = part.split('=')[0];
      try { k = decodeURIComponent(k.replace(/\+/g, ' ')); } catch (e) {}
      return k !== PARAM;
    });
    return kept.length ? '?' + kept.join('&') : '';
  }
  // URL to reload to after switching: same path and hash, ?modular= stripped.
  function reloadUrl(pathname, search, hash) {
    return String(pathname || '') + stripParam(search) + String(hash || '');
  }
  // Everything office.html needs to perform a switch to the opposite of `current`.
  function plan(current, pathname, search, hash) {
    var next = !current;
    return { modular: next, style: next ? 'cyberpunk' : 'classic', label: label(next),
      storage: storageValue(next), url: reloadUrl(pathname, search, hash) };
  }
  function isShortcut(key) { return typeof key === 'string' && key.toLowerCase() === KEY; }

  // Third look (2026-10-22, Steve: "add the Babylon UI as a third option"): the existing Babylon.js renderer
  // pilot, public/babylon-pilot.html (engine-neutral scene contract, live roster, zones; loads Babylon.js from
  // its CDN). It is a separate page, not a mode of office.html, so choosing it opens that page and leaves
  // localStorage.teva_modular alone (coming back to office.html restores Classic / Cyberpunk). Experimental.
  var BABYLON_URL = '/babylon-pilot.html';
  var LOOKS = [
    { id: 'classic', label: LABELS.classic, kind: 'office', modular: false },
    { id: 'cyberpunk', label: LABELS.cyberpunk, kind: 'office', modular: true },
    { id: 'babylon', label: '🧪 Babylon (pilot)', kind: 'page', url: BABYLON_URL, experimental: true }
  ];
  /** What choosing a look does from the current state: {action:'none'|'switch'|'open', ...}. */
  function choose(lookId, current, pathname, search, hash) {
    var look = LOOKS.filter(function (l) { return l.id === lookId; })[0];
    if (!look) return { action: 'none' };
    if (look.kind === 'page') return { action: 'open', url: look.url, look: look.id };
    if (!!look.modular === !!current) return { action: 'none', look: look.id };
    var p = plan(current, pathname, search, hash);
    p.action = 'switch'; p.look = look.id;
    return p;
  }

  return { PARAM: PARAM, STORAGE_KEY: STORAGE_KEY, KEY: KEY, LABELS: LABELS, DEFAULT_MODULAR: DEFAULT_MODULAR,
    param: param, resolve: resolve, label: label, storageValue: storageValue, stripParam: stripParam,
    reloadUrl: reloadUrl, plan: plan, isShortcut: isShortcut, LOOKS: LOOKS, BABYLON_URL: BABYLON_URL, choose: choose };
});
