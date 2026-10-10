import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../content.js', import.meta.url), 'utf8');
function matcher() {
  const context = vm.createContext({
    URL,
    console: { log() {} }, performance: { now: () => 0 },
    requestAnimationFrame: fn => fn(),
    window: { location: { hostname: 'leetcode.com', pathname: '/problems/two-sum/', href: 'https://leetcode.com/problems/two-sum/' } },
    chrome: { runtime: { onMessage: { addListener() {} } } },
    // Website storage must never be used for extension preferences.
    localStorage: { getItem() { throw new Error('Website storage unavailable'); } },
  });
  vm.runInContext(source.replace(/init\(\);\s*$/, ''), context);
  vm.runInContext("connectedAccounts = Object.fromEntries(DEFAULT_PLATFORMS.map(id => [id, {}])); updatePreferredPlatforms();", context);
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

test('confirmed catalog matches use native URLs, distinguish contracts and respect search scope', async () => {
  const context = matcher();
  vm.runInContext(`SIMILARITY_THRESHOLD = 1; problemsData = [
    { title: 'Two Sum', url: 'https://leetcode.com/problems/two-sum/', source: 'leetcode', canonicalId: 'q_test' },
    { title: 'Unrelated wording', url: 'https://www.geeksforgeeks.org/problems/pair/1', source: 'geeksforgeeks', canonicalId: 'q_test' },
    { title: 'Another title', url: 'https://www.codechef.com/problems/PAIR', source: 'codechef', canonicalId: 'q_test', contract: {variant:'one-based'} }
  ]; computeTitleIdf();`, context);
  let matches = await context.findMatchingProblems('', 'Two Sum');
  assert.deepEqual(Array.from(matches, p => [p.source, p.matchType]), [['geeksforgeeks', 'confirmed'], ['codechef', 'platform-variant']]);
  vm.runInContext("preferredPlatforms = ['geeksforgeeks']", context);
  assert.deepEqual(Array.from(await context.findMatchingProblems('', 'Two Sum'), p => p.source), ['geeksforgeeks']);
  context.window.location.href = 'https://leetcode.com/problems/unknown/';
  matches = await context.findMatchingProblems('', 'Two Sum');
  assert.equal(matches.length, 0, 'Similar page titles cannot confirm an unknown native question');
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
    ['atcoder.jp', '/contests/dp/tasks/dp_a', true],
    ['atcoder.jp', '/contests/abc001/tasks/abc001_a/', true],
    ['atcoder.jp', '/contests/dp/tasks', false],
    ['atcoder.jp', '/users/sample', false],
  ]) {
    Object.assign(context.window.location, { hostname, pathname });
    assert.equal(context.isSupportedProblemPage(), expected, `${hostname}${pathname}`);
  }
});

test('AtCoder extracts English sections and uses a task-specific YouTube search', () => {
  const context = matcher();
  Object.assign(context.window.location, { hostname: 'atcoder.jp', pathname: '/contests/dp/tasks/dp_a' });
  const sections = ['Problem Statement', 'Constraints', 'Input', 'Output', 'Sample Input 1'].map(label => ({
    querySelector: () => ({ textContent: label }), textContent: label + ' English text',
  }));
  context.document = { querySelector: selector => selector === '#task-statement .lang-en' ? { querySelectorAll: () => sections } :
    selector === '#main-container .h2' ? { textContent: 'A - Frog 1 Editorial' } : null };
  assert.equal(context.getCurrentPlatform(), 'atcoder');
  assert.match(context.getAtCoderContent(), /Problem Statement English text/);
  assert.doesNotMatch(context.getAtCoderContent(), /Sample Input/);
  assert.match(context.buildYoutubeQuery(), /AtCoder dp dp_a A - Frog 1 solution/);
  context.document.querySelector = () => null;
  assert.equal(context.getAtCoderContent(), '');
});

test('AtCoder participates in matching while excluding the current platform', async () => {
  const context = matcher();
  vm.runInContext(`problemsData = [
    { title: 'Frog Jump', description: 'Minimum cost jumping stones with heights', source: 'atcoder' },
    { title: 'Frog Jump', description: 'Minimum cost jumping stones with heights', source: 'geeksforgeeks' }
  ]; computeTitleIdf();`, context);
  assert.ok((await context.findMatchingProblems('Minimum cost jumping stones with heights', 'Frog Jump')).some(p => p.source === 'atcoder'));
  Object.assign(context.window.location, { hostname: 'atcoder.jp', pathname: '/contests/dp/tasks/dp_a' });
  assert.deepEqual(Array.from(await context.findMatchingProblems('Minimum cost jumping stones with heights', 'Frog Jump'), p => p.source), ['geeksforgeeks']);
});

test('matching result titles preserve AtCoder mathematical markup as text', () => {
  const context = matcher();
  let button;
  context.document = { createElement: () => (button = { classList: { add() {} }, addEventListener() {} }) };
  context.createLeetCodeButton({ title: '<Inversion>', difficulty: 'Unknown', topics: [], combinedScore: 0.8 });
  assert.ok(button.innerHTML.includes('&lt;Inversion&gt;'));
  assert.ok(!button.innerHTML.includes('<Inversion>'));
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
    read({ 'crossdsa-tracker-v1': { accounts: { codeforces: {}, codechef: {} } }, 'dsa-preferred-platforms': ['codeforces'], 'dsa-helper-similarity-threshold': 0.3 });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(vm.runInContext('SIMILARITY_THRESHOLD', context), changed === 'threshold' ? 0.8 : 0.3);
    assert.deepEqual(Array.from(vm.runInContext('preferredPlatforms', context)), [changed === 'platforms' ? 'codechef' : 'codeforces']);
  }
});

test('search scope follows connections, preserves unchecked choices and never falls back to all platforms', async () => {
  const context = matcher();
  let read, change;
  context.chrome.storage = {
    local: { get: () => new Promise(resolve => { read = resolve; }) },
    onChanged: { addListener: fn => { change = fn; } },
  };
  context.loadProblemsData = () => new Promise(() => {});
  context.init();
  change({ 'crossdsa-tracker-v1': { newValue: { accounts: { leetcode: {} } } } }, 'local');
  read({ 'crossdsa-tracker-v1': { accounts: { codeforces: {} } }, 'dsa-preferred-platforms': ['leetcode', 'codeforces'] });
  await new Promise(resolve => setImmediate(resolve));
  const scope = () => Array.from(vm.runInContext('preferredPlatforms', context));
  assert.deepEqual(scope(), ['leetcode'], 'New connection state wins over the startup read');
  change({ 'dsa-preferred-platforms': { newValue: [] } }, 'local');
  assert.deepEqual(scope(), []);
  change({ 'crossdsa-tracker-v1': { newValue: { accounts: { leetcode: {}, codeforces: {} } } } }, 'local');
  assert.deepEqual(scope(), [], 'Connecting an account does not reset search choices');
  change({ 'dsa-preferred-platforms': { newValue: ['leetcode'] } }, 'local');
  assert.deepEqual(scope(), ['leetcode']);
  change({ 'crossdsa-tracker-v1': { newValue: { accounts: {} } } }, 'local');
  assert.deepEqual(scope(), []);
});
