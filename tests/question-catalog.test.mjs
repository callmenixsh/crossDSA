import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { attachQuestionCatalog, collapseQuestions, sourceDigest } from '../tracker/question-catalog.mjs';
import { filterLibrary } from '../tracker/library.mjs';
import { buildCompanyIndex, companyQuestions, companyCounts, filterCompanyQuestions } from '../tracker/companies.mjs';

const digest = 'a'.repeat(64), canonicalId = 'q_example';
const lc = { platform: 'leetcode', id: '53', key: 'leetcode:maximum-subarray', title: 'Maximum Subarray', url: 'https://leetcode.com/problems/maximum-subarray/', topics: ['Array'], difficulty: 'Medium', isPremium: false };
const gfg = { platform: 'geeksforgeeks', id: '7', key: 'geeksforgeeks:kadane', title: "Kadane's Algorithm", url: 'https://www.geeksforgeeks.org/problems/kadane/1', topics: ['Dynamic Programming'], difficulty: 'Easy', isPremium: false };
const cc = { platform: 'code360', id: '8', key: 'code360:max', title: 'Maximum Sum', url: 'https://www.naukri.com/code360/problems/max_8', topics: ['Array'], companies: ['Amazon'], difficulty: 'Medium', isPremium: true };
const records = [lc, gfg, cc];
const catalog = { schemaVersion: 1, inputs: records.map(p => ({ platform: p.platform, sha256: digest })), questions: [{ id: canonicalId, title: lc.title, titleAliases: records.map(p => p.title), versions: records.map(p => ({ id: `${p.platform}:${p.id}`, title: p.title })) }] };
const hashes = Object.fromEntries(records.map(p => [p.platform, digest]));
const joined = () => attachQuestionCatalog(records, catalog, hashes);
const accounts = { leetcode: {}, geeksforgeeks: {}, code360: {} };

test('confirmed copies appear once with native solve destinations and searchable aliases', () => {
  const rows = filterLibrary(joined(), { accounts, query: "Kadane's Algorithm" });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, lc.title);
  assert.equal(rows[0].canonicalId, canonicalId);
  assert.deepEqual(rows[0].versions.map(p => p.url), records.map(p => p.url));
  assert.deepEqual(rows[0].versions.map(p => p.key), records.map(p => p.key));
  assert.deepEqual(records.map(p => p.title), [lc.title, gfg.title, cc.title], 'source records are not mutated');
});

test('platform, difficulty and access filters select matching versions while retaining all solve links', () => {
  const library = joined();
  const rows = filterLibrary(library, { accounts: { leetcode: {} }, query: "Kadane's Algorithm" });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].versions.length, 3, 'opening a public solve link requires no account connection');
  assert.equal(filterLibrary(library, { accounts, platform: 'geeksforgeeks' })[0].key, gfg.key);
  assert.equal(filterLibrary(library, { accounts, difficulty: 'Easy' })[0].difficulty, 'Easy');
  assert.equal(filterLibrary(library, { accounts, access: 'premium' })[0].key, cc.key);
  assert.equal(filterLibrary(library, { accounts: {}, query: 'maximum' }).length, 0);
});

test('existing native solved and starred keys survive the shared row and progress filters', () => {
  const library = joined(), solved = new Set([gfg.key]), workspace = { [cc.key]: { listIds: ['saved', 'custom'], notes: 'Keep me' } };
  assert.equal(filterLibrary(library, { accounts: { leetcode: {} }, solved, status: 'solved' }).length, 1);
  assert.equal(filterLibrary(library, { accounts, solved, status: 'unsolved' }).length, 0);
  assert.equal(filterLibrary(library, { accounts, workspace, status: 'starred' }).length, 1);
  assert.deepEqual(workspace[cc.key], { listIds: ['saved', 'custom'], notes: 'Keep me' });
});

test('company lists count one shared question and retain only source-backed frequency', () => {
  const data = { companies: [{ id: 'amazon', name: 'Amazon', windows: { all: { 'maximum-subarray': 72 }, '30d': { 'maximum-subarray': 28 } } }] };
  const company = buildCompanyIndex(data, joined())[0];
  assert.equal(companyCounts(company).total, 1);
  assert.equal(companyQuestions(company)[0].versions.length, 3);
  assert.equal(companyQuestions(company)[0].frequency, 72);
  assert.deepEqual(companyQuestions(company)[0].frequencySources, [{ platform: 'leetcode', frequency: 72 }]);
  assert.equal(companyQuestions(company, 'all', 'code360')[0].frequency, null);
  assert.equal(companyQuestions(company, '30d')[0].frequency, 28);
  assert.equal(filterCompanyQuestions(company, { query: "Kadane's Algorithm" }).length, 1);
});

test('unverified similarities, missing members and stale snapshots remain separate source questions', () => {
  assert.equal(collapseQuestions(records).length, 3);
  assert.equal(collapseQuestions(attachQuestionCatalog(records, catalog, { ...hashes, geeksforgeeks: 'b'.repeat(64) })).length, 3);
  assert.equal(attachQuestionCatalog(records.slice(0, 2), catalog, hashes).some(p => p.canonicalId), false);
  const renamed = [lc, { ...gfg, title: 'A new task' }, cc];
  assert.equal(attachQuestionCatalog(renamed, catalog, hashes).some(p => p.canonicalId), false);
  assert.throws(() => attachQuestionCatalog(records, { ...catalog, questions: [...catalog.questions, ...catalog.questions] }, hashes), /Conflicting/);
  assert.throws(() => attachQuestionCatalog(records, { ...catalog, schemaVersion: 99 }, hashes), /Unsupported/);
});

test('compact generated catalog matches current source snapshots and joins real cross-platform aliases', async () => {
  const runtime = JSON.parse(await readFile(new URL('../data/normalized/runtime.json', import.meta.url), 'utf8'));
  const library = [], sourceHashes = {};
  for (const input of runtime.inputs) {
    const raw = await readFile(new URL(`../${input.path}`, import.meta.url), 'utf8');
    sourceHashes[input.platform] = await sourceDigest(raw);
    assert.equal(sourceHashes[input.platform], input.sha256);
    for (const row of JSON.parse(raw)) library.push({ ...row, platform: input.platform, key: `${input.platform}:${row.id}`, topics: row.topics || [] });
  }
  const attached = attachQuestionCatalog(library, runtime, sourceHashes);
  const result = filterLibrary(attached, { accounts: { leetcode: {}, geeksforgeeks: {}, code360: {} }, query: "Kadane's Algorithm" });
  assert.equal(result.length, 1);
  assert.equal(result[0].title, 'Maximum Subarray');
  assert.deepEqual(new Set(result[0].versions.map(p => p.platform)), new Set(['leetcode', 'geeksforgeeks']));
  const compact = await readFile(new URL('../data/normalized/runtime.json', import.meta.url));
  assert.ok(compact.byteLength < 500000, 'the browser loads compact metadata rather than the offline statement corpus');
});
