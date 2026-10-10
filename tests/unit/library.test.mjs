import test from 'node:test';
import assert from 'node:assert/strict';
import { filterLibrary } from '../../tracker/library.mjs';
import { orderedPlatformIds } from '../../tracker/core.mjs';
import { readFile } from 'node:fs/promises';

const library = [
  { key: 'lc:1', platform: 'leetcode', id: '1', title: 'Two Sum', difficulty: 'Easy', topics: ['Array', 'Hash Table'], description: 'Return indices of two numbers', isPremium: false },
  { key: 'lc:2', platform: 'leetcode', id: '2', title: 'Pair Paths', difficulty: 'Hard', topics: ['Array', 'Graph'], description: 'Find a path', isPremium: true },
  { key: 'cf:1', platform: 'codeforces', id: '100A', title: 'Pairs', difficulty: 'Medium', topics: ['Graph'], description: '', isPremium: false },
];
const accounts = { leetcode: {}, codeforces: {} };
const keys = options => filterLibrary(library, { accounts, ...options }).map(p => p.key);

test('platform order removes invalid duplicates, fills missing entries and orders default results', () => {
  const order = orderedPlatformIds({ platformOrder: ['codeforces', 'invalid', 'codeforces', 'leetcode'] });
  assert.deepEqual(order.slice(0, 2), ['codeforces', 'leetcode']);
  assert.equal(new Set(order).size, 7);
  assert.deepEqual(orderedPlatformIds({ platformOrder: null }, ['leetcode', 'codeforces']), ['leetcode', 'codeforces']);
  assert.deepEqual(keys({ platformOrder: order }), ['cf:1', 'lc:1', 'lc:2']);
  assert.equal(keys({ platformOrder: order, query: 'Two Sum' })[0], 'lc:1', 'Search relevance remains meaningful');
});

test('library scope respects connected platforms and platform filter', () => {
  assert.deepEqual(keys({ accounts: {} }), []);
  assert.deepEqual(keys({ accounts: { leetcode: {} } }), ['lc:1', 'lc:2']);
  assert.deepEqual(keys({ platform: 'codeforces' }), ['cf:1']);
});
test('search finds titles, IDs and topics without matching statement text', () => {
  assert.deepEqual(keys({ query: 'hash table' }), ['lc:1']);
  assert.deepEqual(keys({ query: 'indices' }), []);
  assert.deepEqual(keys({ query: '100a' }), ['cf:1']);
  assert.deepEqual(keys({ query: 'indices graph' }), []);
});
test('two sum searches the real index without unrelated statement matches', async () => {
  const data = JSON.parse(await readFile(new URL('../../data/leetcode-data.json', import.meta.url), 'utf8'));
  const records = data.map(p => ({ ...p, topics: p.topics || [], platform: 'leetcode' }));
  for (const query of ['two sum', ' TWO   SUM ', 'two-sum']) {
    const result = filterLibrary(records, { accounts, query });
    assert.equal(result[0].title, 'Two Sum');
    assert.ok(result.length < 30, `Expected focused results, received ${result.length}`);
    assert.ok(!result.some(p => ['Add Two Numbers', '3Sum', '3Sum Closest', '4Sum'].includes(p.title)));
  }
});
test('exact titles precede variants and topic matches even if indexed later', () => {
  const records = [
    { ...library[0], title: 'Two Sum II' },
    { ...library[0], title: 'Other', topics: ['Two', 'Sum'] },
    library[0],
  ];
  assert.deepEqual(filterLibrary(records, { accounts, query: 'two sum' }).map(p => p.title), ['Two Sum', 'Two Sum II', 'Other']);
});
test('multiple topics include either selection while respecting other filters', () => {
  assert.deepEqual(keys({ topics: ['Array', 'Hash Table'] }), ['lc:1', 'lc:2']);
  assert.deepEqual(keys({ topics: ['Hash Table', 'Graph'] }), ['lc:1', 'lc:2', 'cf:1']);
  assert.deepEqual(keys({ topics: ['Missing', 'Graph'] }), ['lc:2', 'cf:1']);
  assert.deepEqual(keys({ topics: ['Missing'] }), []);
  assert.deepEqual(keys({ topics: ['Array'], difficulty: 'Hard', access: 'premium' }), ['lc:2']);
  assert.deepEqual(keys({ topics: ['Array'], access: 'free' }), ['lc:1']);
  const solved = new Set(['lc:1']);
  assert.deepEqual(keys({ solved, status: 'unsolved' }), ['lc:2', 'cf:1']);
  assert.deepEqual(keys({ solved, status: 'solved' }), ['lc:1']);
  assert.deepEqual(keys({ status: 'starred', workspace: { 'lc:2': { listIds: ['saved'] } } }), ['lc:2']);
});
test('difficulty sorting works in both directions without mutating the library', () => {
  assert.deepEqual(keys({ sort: 'easy' }), ['lc:1', 'cf:1', 'lc:2']);
  assert.deepEqual(keys({ sort: 'hard' }), ['lc:2', 'cf:1', 'lc:1']);
  assert.deepEqual(library.map(p => p.key), ['lc:1', 'lc:2', 'cf:1']);
});
