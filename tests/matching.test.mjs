import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../content.js', import.meta.url), 'utf8');
function matcher() {
  const context = vm.createContext({
    console: { log() {} }, performance: { now: () => 0 },
    requestAnimationFrame: fn => fn(),
    window: { location: { hostname: 'leetcode.com', pathname: '/problems/two-sum/', href: 'https://leetcode.com/problems/two-sum/' } },
    chrome: { runtime: { onMessage: { addListener() {} } } },
    // Website storage must never be used for extension preferences.
    localStorage: { getItem() { throw new Error('Website storage unavailable'); } },
  });
  vm.runInContext(source.replace(/init\(\);\s*$/, ''), context);
  return context;
}

test('matching retains the same title on different platforms and deduplicates within a platform', async () => {
  const context = matcher();
  vm.runInContext(`problemsData = [
    { title: 'Two Sum', description: 'Pair of integers target sum', source: 'codeforces' },
    { title: 'Two Sum', description: 'Pair of integers target sum', source: 'geeksforgeeks' },
    { title: 'Two Sum', description: 'Pair of integers target sum', source: 'codeforces' },
    { title: 'Two Sum', description: 'Pair of integers target sum', source: 'leetcode' }
  ]; computeTitleIdf();`, context);
  const matches = await context.findMatchingProblems('Pair of integers target sum', 'Two Sum');
  assert.deepEqual(Array.from(matches, p => p.source), ['codeforces', 'geeksforgeeks']);
});

test('thresholds accept the slider range and reject corrupt values without reading website storage', () => {
  const context = matcher();
  for (const value of [undefined, null, '', 'bad', '0.5bad', false, Infinity, NaN, -1, 0, 1.1]) {
    assert.equal(context.normalizeThreshold(value), 0.4);
  }
  for (const value of [0.1, 0.2, 0.9, 1]) assert.equal(context.normalizeThreshold(String(value)), value);
});

test('navigation invalidates results and updates button visibility immediately', () => {
  const context = matcher();
  context.setTimeout = () => {};
  let injections = 0;
  context.injectTitleButton = () => { injections++; };
  vm.runInContext(`isSearching = true; buttonContainer = { style: { display: 'block' }, innerHTML: 'Old results' };`, context);
  context.window.location.href = 'https://leetcode.com/problemset/';
  context.handleUrlChange();
  assert.equal(injections, 1);
  assert.equal(vm.runInContext('isSearching', context), false);
  assert.equal(vm.runInContext('buttonContainer.style.display', context), 'none');
  assert.equal(vm.runInContext('buttonContainer.innerHTML', context), '');
});

test('problem route checks hide controls on non-problem pages and support Codeforces contests', () => {
  const context = matcher();
  for (const [hostname, pathname, expected] of [
    ['leetcode.com', '/problems/two-sum/description/', true],
    ['leetcode.com', '/problemset/', false],
    ['codeforces.com', '/contest/123/problem/A', true],
    ['codeforces.com', '/gym/123/problem/A1', true],
    ['codeforces.com', '/problemset/problem/123/A', true],
    ['codeforces.com', '/contests', false],
    ['takeuforward.org', '/practice/dsa/two-sum', true],
    ['takeuforward.org', '/practice/dsa', false],
  ]) {
    Object.assign(context.window.location, { hostname, pathname });
    assert.equal(context.isSupportedProblemPage(), expected, `${hostname}${pathname}`);
  }
});

test('cancelled matching stops at its next frame instead of scanning the remaining index', async () => {
  const context = matcher();
  vm.runInContext(`problemsData = [{ get title() { throw new Error('Cancelled scan continued'); }, source: 'codeforces' }];`, context);
  let now = 0;
  context.performance.now = () => now += 20;
  context.requestAnimationFrame = fn => { context.closeSearchResults(); fn(); };
  assert.equal((await context.findMatchingProblems('Pair sum', 'Two Sum')).length, 0);
});

test('SPA DOM renders detect page-world navigation; keyboard activation keeps results open', async () => {
  const context = matcher();
  const events = new Map();
  let observe;
  context.document = { readyState: 'complete', body: {}, addEventListener: (name, fn) => events.set(name, fn) };
  context.history = { pushState() {}, replaceState() {} };
  context.window.addEventListener = () => {};
  context.setTimeout = () => 1;
  context.clearTimeout = () => {};
  context.MutationObserver = class { constructor(fn) { observe = fn; } observe() {} };
  context.chrome.runtime.id = 'test';
  context.chrome.storage = { local: { get: async () => ({}) }, onChanged: { addListener() {} } };
  for (const name of ['loadProblemsData', 'computeTitleIdf', 'createButtonContainer', 'injectTitleButton']) context[name] = () => {};
  await context.init();
  vm.runInContext(`buttonContainer = { style: { display: 'block' }, innerHTML: 'Results' };`, context);
  for (const key of ['Tab', 'Enter', ' ', 'ArrowDown']) {
    events.get('keydown')({ key });
    assert.equal(vm.runInContext('buttonContainer.style.display', context), 'block');
  }
  // Change the page location without invoking the isolated history wrappers.
  context.window.location.href = 'https://leetcode.com/problems/three-sum/';
  observe([]);
  assert.equal(vm.runInContext('buttonContainer.innerHTML', context), '');
  vm.runInContext(`buttonContainer.style.display = 'block';`, context);
  events.get('keydown')({ key: 'Escape' });
  assert.equal(vm.runInContext('buttonContainer.style.display', context), 'none');
});

test('settings changes during startup preserve newer values and initialize unchanged preferences', async () => {
  for (const changed of ['platforms', 'threshold']) {
    const context = matcher();
    let read, change;
    context.chrome.storage = {
      local: { get: () => new Promise(resolve => { read = resolve; }) },
      onChanged: { addListener: fn => { change = fn; } },
    };
    context.loadProblemsData = () => new Promise(() => {});
    context.init();
    change(changed === 'platforms' ? { 'dsa-preferred-platforms': { newValue: ['codechef'] } } :
      { 'dsa-helper-similarity-threshold': { newValue: 0.8 } }, 'local');
    read({ 'dsa-preferred-platforms': ['codeforces'], 'dsa-helper-similarity-threshold': 0.3 });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(vm.runInContext('SIMILARITY_THRESHOLD', context), changed === 'threshold' ? 0.8 : 0.3);
    assert.deepEqual(Array.from(vm.runInContext('preferredPlatforms', context)), [changed === 'platforms' ? 'codechef' : 'codeforces']);
  }
});
