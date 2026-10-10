import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const popup = await readFile(new URL('../popup.js', import.meta.url), 'utf8');
const content = await readFile(new URL('../content.js', import.meta.url), 'utf8');
const key = 'dsa-helper-visibility-enabled';

test('popup greys the card and disables settings while leaving its toggle usable', () => {
  const controls = [{ disabled: false }, { disabled: false }];
  const classes = new Set();
  const classList = { toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name) };
  const card = { classList, querySelectorAll: () => controls };
  const state = {};
  const grid = { querySelectorAll: () => controls };
  const toggle = { classList, closest: () => card, querySelector: () => state,
    setAttribute: (name, value) => { toggle[name] = value; } };
  const context = vm.createContext({ document: { getElementById: id => id === 'toggleBtn' ? toggle : grid } });
  vm.runInContext(popup.slice(popup.indexOf('function updateToggleUI'), popup.indexOf('document.addEventListener')), context);
  context.updateToggleUI(false);
  assert.equal(classes.has('search-disabled'), true);
  assert.equal(grid.inert, undefined, 'POTD buttons remain usable');
  assert.ok(controls.every(control => control.disabled));
  assert.equal(toggle['aria-pressed'], 'false');
  assert.equal(state.textContent, 'Off');
  assert.ok(!toggle.disabled);
  context.updateToggleUI(true);
  assert.equal(classes.has('search-disabled'), false);
  assert.equal(grid.inert, undefined);
  assert.ok(controls.every(control => !control.disabled));
});

test('popup toggle persists globally without contacting an active tab', async () => {
  let handler;
  const writes = [];
  const states = [];
  const toggle = { getAttribute: () => 'true', addEventListener: (_event, fn) => { handler = fn; } };
  const context = vm.createContext({ toggleBtn: toggle, SEARCH_ENABLED_KEY: key,
    chrome: { storage: { local: { set: async value => writes.push(value) } } },
    updateToggleUI: value => states.push(value), showStatus: () => {} });
  vm.runInContext(popup.slice(popup.indexOf('  toggleBtn.addEventListener("click"'), popup.indexOf('  // ---- Load persisted state')), context);
  await handler();
  assert.equal(writes[0][key], false);
  assert.deepEqual(states, [false]);
  assert.equal(toggle.disabled, false);
});

function tab(readSettings) {
  let listener;
  const panel = { style: { display: 'block' }, innerHTML: 'Old results' };
  const context = vm.createContext({
    visibilityEnabled: true, buttonContainer: panel, searchRequestId: 7,
    DEFAULT_PLATFORMS: ['leetcode'], preferredPlatforms: ['leetcode'],
    chrome: { storage: { local: { get: readSettings }, onChanged: { addListener: fn => { listener = fn; } } } },
    loadProblemsData: () => new Promise(() => {}), removeTitleButton: () => {}, injectTitleButton: () => {},
  });
  vm.runInContext(content.slice(content.indexOf('function closeSearchResults()'), content.indexOf('function positionContainer')), context);
  vm.runInContext(content.slice(content.indexOf('let platformPreferences'), content.indexOf('let problemsData')), context);
  const start = content.indexOf('async function init()');
  const end = content.indexOf('    // Schedule a public-data refresh', start);
  vm.runInContext(content.slice(start, end) + '\n}', context);
  context.init();
  return { context, panel, change: changes => listener(changes, 'local') };
}

test('global visibility reaches multiple tabs, persists on load, and cancels open searches', async () => {
  const tabs = [tab(async () => ({ [key]: false })), tab(async () => ({ [key]: false }))];
  await new Promise(resolve => setImmediate(resolve));
  for (const { context, panel, change } of tabs) {
    assert.equal(context.visibilityEnabled, false);
    change({ [key]: { newValue: true } });
    assert.equal(context.visibilityEnabled, true);
    change({ [key]: { newValue: false } });
    assert.equal(context.visibilityEnabled, false);
    assert.equal(context.searchRequestId, 8);
    assert.equal(panel.style.display, 'none');
    assert.equal(panel.innerHTML, '');
  }
});

test('a toggle during startup takes precedence over an older storage read', async () => {
  let resolveRead;
  const active = tab(() => new Promise(resolve => { resolveRead = resolve; }));
  active.change({ [key]: { newValue: false } });
  resolveRead({ [key]: true });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(active.context.visibilityEnabled, false);
});
