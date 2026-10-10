import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { filterLibrary } from '../../tracker/library.mjs';
import { problemKey, safeProblemUrl, doneQuestions, acceptedToday, PLATFORMS, normalizeState } from '../../tracker/core.mjs';

test('AtCoder task identity survives contest rehosting, query parameters and trailing slashes', () => {
  for (const url of [
    'https://atcoder.jp/contests/dp/tasks/dp_a',
    'https://atcoder.jp/contests/dp/tasks/dp_a/?lang=en#task-statement',
    'https://atcoder.jp/contests/another_contest/tasks/dp_a',
  ]) assert.equal(problemKey('atcoder', url), 'atcoder:dp_a');
  assert.equal(PLATFORMS.atcoder.name, 'AtCoder');
});

test('AtCoder links reject foreign hosts, credentials and non-task routes', () => {
  assert.ok(safeProblemUrl('https://atcoder.jp/contests/dp/tasks/dp_a?lang=en', 'atcoder'));
  for (const url of [
    'https://evil.atcoder.jp/contests/dp/tasks/dp_a', 'https://atcoder.jp.evil.test/contests/dp/tasks/dp_a',
    'http://atcoder.jp/contests/dp/tasks/dp_a', 'https://user@atcoder.jp/contests/dp/tasks/dp_a',
    'https://atcoder.jp:8443/contests/dp/tasks/dp_a', 'https://atcoder.jp/contests/dp/tasks',
    'https://atcoder.jp/users/test', 'https://atcoder.jp/contests/dp/tasks/dp_a/submissions',
  ]) assert.equal(safeProblemUrl(url, 'atcoder'), null, url);
});

test('AtCoder lists retain membership while Done requires detected history', () => {
  const problem = { key: 'atcoder:dp_a', platform: 'atcoder', id: 'dp_a', title: 'Frog 1', difficulty: 'Unknown', topics: [], url: 'https://atcoder.jp/contests/dp/tasks/dp_a' };
  const library = [problem, { ...problem, platform: 'leetcode', key: 'leetcode:frog' }];
  assert.deepEqual(filterLibrary(library, { query: 'dp_a' }), []);
  assert.deepEqual(filterLibrary(library, { accounts: { atcoder: {} }, query: 'dp_a' }), [problem]);
  assert.deepEqual(filterLibrary(library, { accounts: { atcoder: {} }, platform: 'atcoder' }), [problem]);
  const workspace = { [problem.key]: { ...problem, done: true, doneAt: Date.parse('2026-10-09T12:00:00Z'), listIds: ['saved'] } };
  assert.deepEqual(filterLibrary(library, { accounts: { atcoder: {} }, workspace, status: 'starred' }), [problem]);
  assert.equal(doneQuestions(normalizeState({ version: 1, accounts: {}, workspace }).accounts).total, 0);
  assert.equal(doneQuestions(normalizeState({ version: 1, accounts: { atcoder: {} }, workspace }).accounts).total, 0, 'Legacy manual marks do not prove a solve');
  const history = { atcoder: { snapshot: { recent: [{ ...problem, timestamp: Date.parse('2026-10-09T12:00:00Z') }] } } };
  const done = doneQuestions(normalizeState({ version: 1, accounts: history, workspace }).accounts, { platform: 'atcoder', from: '2026-10-09', to: '2026-10-09' });
  assert.equal(done.records[0].key, problem.key);
  assert.equal(acceptedToday({}, '2026-10-09', 'UTC'), 0);
  workspace[problem.key].done = false;
  assert.equal(doneQuestions(normalizeState({ version: 1, accounts: history, workspace }).accounts).total, 1, 'Legacy unchecked marks cannot hide solves');
  assert.equal(doneQuestions(normalizeState({ version: 1, accounts: {}, workspace }).accounts).total, 0);
});

test('bundled AtCoder metadata has unique stable IDs, safe URLs and explicit difficulty provenance', async () => {
  const records = JSON.parse(await readFile(new URL('../../data/atcoder-data.json', import.meta.url), 'utf8'));
  assert.ok(records.length > 1000);
  assert.equal(new Set(records.map(p => p.id)).size, records.length);
  for (const p of records) {
    assert.equal(p.source, 'atcoder');
    assert.ok(safeProblemUrl(p.url, 'atcoder'));
    assert.equal(problemKey('atcoder', p.url), `atcoder:${p.id}`);
    assert.equal(p.difficulty, 'Unknown');
    assert.deepEqual(p.topics, []);
    if (Number.isFinite(p.estimatedDifficulty)) assert.match(p.difficultySource, /problem-models.json$/);
  }
});
