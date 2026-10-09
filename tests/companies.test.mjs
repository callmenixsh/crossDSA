import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildCompanyIndex, companyCounts, filterCompanyQuestions } from '../tracker/companies.mjs';

const library = [
  { key: 'lc:1', platform: 'leetcode', id: '1', title: 'Two Sum', url: 'https://leetcode.com/problems/two-sum/', difficulty: 'Easy', topics: ['Array'], isPremium: false },
  { key: 'lc:2', platform: 'leetcode', id: '2', title: 'Add Two Numbers', url: 'https://leetcode.com/problems/add-two-numbers', difficulty: 'Medium', topics: ['Linked List'], isPremium: true },
  { key: 'cf:1', platform: 'codeforces', title: 'Other', url: 'https://codeforces.com/problemset/problem/1/A', difficulty: 'Hard', topics: [] },
];
const source = { companies: [{ id: 'amazon', name: 'Amazon', windows: { all: { 'two-sum': 25, 'add-two-numbers': 80, 'missing-problem': 99 }, '30d': { 'two-sum': 50 } } }] };
const [company] = buildCompanyIndex(source, library);

test('company index joins local LeetCode slugs, excludes missing questions and computes exact counts', () => {
  assert.equal(company.category, 'Big Tech');
  assert.deepEqual(companyCounts(company), { total: 2, Easy: 1, Medium: 1, Hard: 0 });
  assert.deepEqual(companyCounts(company, '30d'), { total: 1, Easy: 1, Medium: 0, Hard: 0 });
  assert.equal(companyCounts(company, '6m').total, 0);
  assert.equal(library[0].frequency, undefined);
});

test('frequency sorting, time windows and shared progress filters work without a connected account', () => {
  const keys = options => filterCompanyQuestions(company, options).map(p => p.key);
  assert.deepEqual(keys(), ['lc:2', 'lc:1']);
  assert.deepEqual(keys({ window: '30d' }), ['lc:1']);
  assert.deepEqual(keys({ solved: new Set(['lc:1']), status: 'unsolved' }), ['lc:2']);
  assert.deepEqual(keys({ workspace: { 'lc:2': { listIds: ['saved'] } }, status: 'starred' }), ['lc:2']);
  assert.deepEqual(keys({ access: 'free', topics: ['Array'], query: 'two sum' }), ['lc:1']);
  assert.deepEqual(keys({ sort: 'easy' }), ['lc:1', 'lc:2']);
  assert.deepEqual(keys({ difficulty: 'Hard' }), []);
  assert.deepEqual(company.windows.all.map(p => p.key), ['lc:1', 'lc:2']);
});

test('bundled source mappings resolve to unique local questions with valid scores and source attribution', async () => {
  const data = JSON.parse(await readFile(new URL('../data/leetcode-companies.json', import.meta.url)));
  const local = JSON.parse(await readFile(new URL('../data/leetcode-data.json', import.meta.url))).map(p => ({ ...p, platform: 'leetcode', key: p.url }));
  const index = buildCompanyIndex(data, local);
  assert.equal(new Set(data.companies.map(c => c.id)).size, data.companies.length);
  assert.ok(index.length > 600);
  assert.match(data.source.url, /^https:\/\/github.com\/snehasishroy\//);
  assert.match(data.source.revision, /^[0-9a-f]{40}$/);
  for (const company of index) {
    for (const rows of Object.values(company.windows)) {
      assert.equal(new Set(rows.map(p => p.key)).size, rows.length);
      assert.ok(rows.every(p => Number.isFinite(p.frequency) && p.frequency >= 0 && p.frequency <= 100));
    }
    const counts = companyCounts(company);
    assert.equal(counts.total, counts.Easy + counts.Medium + counts.Hard);
  }
});
