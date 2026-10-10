import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildCompanyIndex, companyCounts, filterCompanyQuestions } from '../../tracker/companies/companies.mjs';
import { splitCode360Tags } from '../../tracker/companies/code360-companies.mjs';

const library = [
  { key: 'lc:1', platform: 'leetcode', id: '1', title: 'Two Sum', url: 'https://leetcode.com/problems/two-sum/', difficulty: 'Easy', topics: ['Array'], isPremium: false },
  { key: 'lc:2', platform: 'leetcode', id: '2', title: 'Add Two Numbers', url: 'https://leetcode.com/problems/add-two-numbers', difficulty: 'Medium', topics: ['Linked List'], isPremium: true },
  { key: 'cf:1', platform: 'codeforces', title: 'Other', url: 'https://codeforces.com/problemset/problem/1/A', difficulty: 'Hard', topics: [] },
];
const source = { companies: [{ id: 'amazon', name: 'Amazon', windows: { all: { 'two-sum': 25, 'add-two-numbers': 80, 'missing-problem': 99 }, '30d': { 'two-sum': 50 } } }] };
const [company] = buildCompanyIndex(source, library);

test('legacy Code360 tags separate topics, discard placeholders and preserve explicit new fields', () => {
  assert.deepEqual(splitCode360Tags({ topics: ['Arrays', 'Google inc', 'Microsoft', 'unknown', 'Arrays', 'Amazon Microsoft'] }), { topics: ['Arrays'], companies: ['Google inc', 'Microsoft', 'Amazon'] });
  assert.deepEqual(splitCode360Tags({ topics: ['A future topic'], companies: ['Google inc'] }), { topics: ['A future topic'], companies: ['Google inc'] });
});

test('Code360 aliases merge into LeetCode companies without losing platform identity or inventing frequency', () => {
  const records = [
    { key: 'c360:1', platform: 'code360', id: '1', title: 'Two Sum', url: 'https://www.naukri.com/code360/problems/two-sum_1', difficulty: 'Easy', topics: ['Arrays', 'Amazon', 'AmazonWOW'] },
    { key: 'c360:2', platform: 'code360', id: '2', title: 'Other', url: 'https://www.naukri.com/code360/problems/other_2', difficulty: 'Hard', topics: ['Trees', 'Google inc'] },
  ];
  const index = buildCompanyIndex(source, [...library, ...records]);
  const amazon = index.find(c => c.id === 'amazon');
  assert.equal(companyCounts(amazon).total, 3);
  assert.equal(companyCounts(amazon, 'all', 'code360').total, 1);
  assert.equal(companyCounts(amazon, '30d', 'code360').total, 0);
  assert.deepEqual(filterCompanyQuestions(amazon).map(p => p.key), ['lc:2', 'lc:1', 'c360:1']);
  const [row] = filterCompanyQuestions(amazon, { platform: 'code360' });
  assert.equal(row.frequency, null);
  assert.deepEqual(row.topics, ['Arrays']);
  assert.equal(index.find(c => c.id === 'google').windows.all.length, 1);
  assert.deepEqual(records[0].topics, ['Arrays', 'Amazon', 'AmazonWOW']);
});

test('bundled Code360 mappings retain known counts and normalize aliases', async () => {
  const raw = JSON.parse(await readFile(new URL('../../data/code360-data.json', import.meta.url)));
  const records = raw.map(p => ({ ...p, platform: 'code360', key: p.url }));
  const index = buildCompanyIndex({ companies: [] }, records);
  assert.equal(new Set(index.map(c => c.id)).size, index.length);
  assert.ok(companyCounts(index.find(c => c.id === 'amazon')).total >= 965);
  assert.ok(companyCounts(index.find(c => c.id === 'google')).total >= 465);
  assert.ok(companyCounts(index.find(c => c.id === 'tcs')).total >= 393);
  assert.ok(index.every(c => !['arrays', 'strings', 'unknown', 'not-available', 'faang'].includes(c.id)));
  for (const company of index) {
    assert.equal(new Set(company.windows.all.map(p => p.key)).size, company.windows.all.length);
    assert.ok(company.windows.all.every(p => p.frequency === null));
    const counts = companyCounts(company);
    assert.equal(counts.total, counts.Easy + counts.Medium + counts.Hard);
  }
});

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
  const data = JSON.parse(await readFile(new URL('../../data/leetcode-companies.json', import.meta.url)));
  const local = JSON.parse(await readFile(new URL('../../data/leetcode-data.json', import.meta.url))).map(p => ({ ...p, platform: 'leetcode', key: p.url }));
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
