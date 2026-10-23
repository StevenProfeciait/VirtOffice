// Unit tests for public/js/teva_ui_style.js (Classic <-> Cyberpunk UI style toggle). Run: node tests/test_teva_ui_style.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const S = require(path.join(__dirname, '..', 'public', 'js', 'teva_ui_style.js'));

let n = 0;
function t(name, fn) { fn(); n++; console.log('ok', n, name); }

t('default is Cyberpunk when there is no URL param and nothing stored (2026-10-22)', () => {
  assert.deepStrictEqual(S.resolve('', null), { modular: true, style: 'cyberpunk', source: 'default' });
  assert.deepStrictEqual(S.resolve('?ambient=0', undefined), { modular: true, style: 'cyberpunk', source: 'default' });
  assert.deepStrictEqual(S.resolve('', ''), { modular: true, style: 'cyberpunk', source: 'default' });
  assert.strictEqual(S.DEFAULT_MODULAR, true);
});

t("localStorage teva_modular='0' means Classic, '1' means Cyberpunk, anything else falls to the Cyberpunk default", () => {
  assert.deepStrictEqual(S.resolve('', '1'), { modular: true, style: 'cyberpunk', source: 'storage' });
  assert.strictEqual(S.resolve('?ambient=1', '1').modular, true);
  assert.deepStrictEqual(S.resolve('', '0'), { modular: false, style: 'classic', source: 'storage' });
  assert.deepStrictEqual(S.resolve('?ambient=1', '0'), { modular: false, style: 'classic', source: 'storage' });
  assert.deepStrictEqual(S.resolve('', 'true'), { modular: true, style: 'cyberpunk', source: 'default' });
});

t('?modular=1 / ?modular=0 in the URL win over storage for that load', () => {
  assert.deepStrictEqual(S.resolve('?modular=1', null), { modular: true, style: 'cyberpunk', source: 'url' });
  assert.deepStrictEqual(S.resolve('?modular=0', '1'), { modular: false, style: 'classic', source: 'url' });
  assert.deepStrictEqual(S.resolve('?ambient=0&modular=1', '0'), { modular: true, style: 'cyberpunk', source: 'url' });
  assert.deepStrictEqual(S.resolve('modular=0', '1'), { modular: false, style: 'classic', source: 'url' });
});

t('unknown ?modular= values fall through to storage, then default', () => {
  assert.strictEqual(S.resolve('?modular=yes', '1').source, 'storage');
  assert.strictEqual(S.resolve('?modular=', null).source, 'default');
});

t('labels show the current style', () => {
  assert.strictEqual(S.label(true), '🌆 Cyberpunk');
  assert.strictEqual(S.label(false), '⬜ Classic');
});

t('stripParam removes every ?modular= and keeps other params in order', () => {
  assert.strictEqual(S.stripParam('?modular=1'), '');
  assert.strictEqual(S.stripParam('?ambient=0&modular=1'), '?ambient=0');
  assert.strictEqual(S.stripParam('?modular=0&ambient=1&x=a%20b'), '?ambient=1&x=a%20b');
  assert.strictEqual(S.stripParam('?a=1&modular=1&b=2&modular=0'), '?a=1&b=2');
  assert.strictEqual(S.stripParam('?modular'), '');
  assert.strictEqual(S.stripParam('?modularity=1'), '?modularity=1');
  assert.strictEqual(S.stripParam(''), '');
  assert.strictEqual(S.stripParam(null), '');
});

t('plan(): Classic -> Cyberpunk writes 1, strips the param, keeps path, params and hash', () => {
  const p = S.plan(false, '/office.html', '?modular=0&ambient=0', '#x');
  assert.deepStrictEqual(p, { modular: true, style: 'cyberpunk', label: '🌆 Cyberpunk', storage: '1', url: '/office.html?ambient=0#x' });
});

t("plan(): Cyberpunk -> Classic stores '0' (never clears the key, so Classic survives the Cyberpunk default)", () => {
  const p = S.plan(true, '/office.html', '?modular=1', '');
  assert.deepStrictEqual(p, { modular: false, style: 'classic', label: '⬜ Classic', storage: '0', url: '/office.html' });
  assert.strictEqual(S.storageValue(false), '0');
  assert.strictEqual(S.storageValue(true), '1');
  // a stored '0' really does keep Classic on the next plain load, while an empty store would not
  assert.strictEqual(S.resolve('', p.storage).modular, false);
  assert.strictEqual(S.resolve('', null).modular, true);
});

t('the choice sticks: after a switch the next load resolves to the new style', () => {
  [['?modular=1', '1'], ['?modular=0', null], ['', '1'], ['', null], ['', '0'], ['?ambient=0&modular=1', null], ['?modular=0', '0']].forEach(([search, stored]) => {
    const cur = S.resolve(search, stored).modular;
    const p = S.plan(cur, '/office.html', search, '');
    const nextSearch = p.url.slice('/office.html'.length);
    const next = S.resolve(nextSearch, p.storage);
    assert.strictEqual(next.modular, !cur, search + ' ' + stored);
    assert.notStrictEqual(next.source, 'url');
    // and a second switch goes back
    const p2 = S.plan(next.modular, '/office.html', nextSearch, '');
    assert.strictEqual(S.resolve(p2.url.slice('/office.html'.length), p2.storage).modular, cur);
  });
});

t('shortcut is U (either case) and does not clash with existing office keys', () => {
  assert.ok(S.isShortcut('u') && S.isShortcut('U'));
  assert.ok(!S.isShortcut('a') && !S.isShortcut('') && !S.isShortcut(undefined));
  ['1', '2', '3', '4', '5', '6', 'n', 'f', 'p', 'a', '[', ']', '\\'].forEach(k => assert.ok(!S.isShortcut(k), k));
});

t('office.html wires the helper: script tag, top-bar button, Settings switch, U key, ?modular via resolve', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'office.html'), 'utf8');
  assert.ok(html.includes('<script src="js/teva_ui_style.js"></script>'));
  assert.ok(html.includes('id="uiStyleToggle"'));
  assert.ok(html.includes('id="uiStyleSwitch"'));
  assert.ok(/e\.key === 'u' \|\| e\.key === 'U'\) toggleUiStyle\(\)/.test(html));
  assert.ok(html.includes('TevaUiStyle.resolve(location.search, stored)'));
  assert.ok(!html.includes("get('modular') === '1' || localStorage.getItem('teva_modular') === '1'"), 'old one-way check removed');
  assert.ok(!html.includes("localStorage.removeItem('teva_modular')"), 'switching to Classic must store 0, not clear the key');
  assert.ok(html.includes("localStorage.setItem('teva_modular', P.storage === null ? '0' : P.storage)"));
  assert.ok(html.includes("(m !== '0' && stored !== '0')"), 'no-helper fallback also defaults to Cyberpunk');
  assert.ok(html.includes("UI_STYLE = { modular: true, style: 'cyberpunk', source: 'default' }"), 'error fallback is the Cyberpunk default');
  const used = html.match(/e\.key === '([^']+)'/g).filter(m => /'u'/.test(m));
  assert.strictEqual(used.length, 1, 'u bound exactly once');
});

t('third look: the existing Babylon.js pilot is listed and opens its own page without touching the stored look', () => {
  assert.deepStrictEqual(S.LOOKS.map(l => l.id), ['classic', 'cyberpunk', 'babylon']);
  const b = S.LOOKS[2];
  assert.strictEqual(b.url, '/babylon-pilot.html'); assert.strictEqual(b.kind, 'page'); assert.ok(b.experimental);
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'public', 'babylon-pilot.html')), 'pilot page exists');
  assert.deepStrictEqual(S.choose('babylon', true, '/office.html', '', ''), { action: 'open', url: '/babylon-pilot.html', look: 'babylon' });
  assert.strictEqual(S.choose('cyberpunk', true, '/office.html', '', '').action, 'none');
  const c = S.choose('classic', true, '/office.html', '?modular=1', '');
  assert.strictEqual(c.action, 'switch'); assert.strictEqual(c.storage, '0'); assert.strictEqual(c.url, '/office.html');
  assert.strictEqual(S.choose('nope', true).action, 'none');
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'office.html'), 'utf8');
  assert.ok(html.includes('data-ui-look=') && html.includes('function chooseLook(id)'));
  const pilot = fs.readFileSync(path.join(__dirname, '..', 'public', 'babylon-pilot.html'), 'utf8');
  assert.ok(pilot.includes('id="backToOffice" href="/office.html"'), 'pilot links back to the office');
});

console.log(`${n} TESTS PASSED`);
