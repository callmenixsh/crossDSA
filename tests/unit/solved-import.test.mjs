import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptedToday, dailyActivity, doneQuestions, mergeSnapshot, questionIsDone, normalizeState } from '../../tracker/core.mjs';
import { importQuestion, previewSolvedImport } from '../../tracker/imports/solved-import.mjs';
import { historyPage } from '../../tracker/imports/history-import.mjs';

const url = 'https://leetcode.com/problems/two-sum/';
const entry = importQuestion({ url, title: 'Two Sum' });
const accounts = { leetcode: { generation: 'one', snapshot: { recent: [] } }, codechef: { generation: 'two' } };

test('TUF is excluded from Done Questions and URL imports while its profile data is retained', () => {
  const tuf = importQuestion('https://takeuforward.org/practice/dsa/two-sum');
  const accounts = { tuf: { snapshot: { totalSolved: 20, solved: { [tuf.key]: tuf }, recent: [{ ...tuf, timestamp: 1000 }] } } };
  assert.equal(doneQuestions(accounts).total, 0);
  assert.equal(doneQuestions(accounts, { platform: 'tuf' }).records.length, 0);
  assert.equal(previewSolvedImport(tuf.url, accounts).records.length, 0);
  assert.match(previewSolvedImport(tuf.url, accounts).unresolved[0].reason, /not supported in Done/);
  assert.equal(accounts.tuf.snapshot.totalSolved, 20);
});

test('undated imports persist Done independently of activity and legacy manual marks', () => {
  const snapshot = mergeSnapshot(null, { totalSolved: 100, recent: [], solved: { [entry.key]: entry } });
  const refreshed = mergeSnapshot(snapshot, { totalSolved: 100, recent: [] });
  const accounts = { leetcode: { snapshot: refreshed } };
  assert.equal(questionIsDone(accounts, entry.key), true);
  assert.equal(questionIsDone(normalizeState({ version: 1, accounts, workspace: { [entry.key]: { done: false } } }).accounts, entry.key), true);
  assert.equal(doneQuestions(accounts).records[0].timestamp, undefined);
  assert.equal(doneQuestions(accounts, { from: '2000-01-01' }).records.length, 0);
  assert.equal(doneQuestions(accounts, { to: '2030-01-01' }).records.length, 0);
  assert.equal(acceptedToday(accounts, '2026-10-10', 'UTC'), 0);
  assert.deepEqual(dailyActivity(accounts, 'UTC'), {});
  assert.equal(refreshed.totalSolved, 100);
});

test('solved identities survive activity truncation and repeated accepts use latest date', () => {
  const recent = Array.from({ length: 15001 }, (_, i) => ({ ...entry, key: `leetcode:q-${i}`, url: `https://leetcode.com/problems/q-${i}/`, id: String(i), timestamp: i + 1 }));
  let snapshot = mergeSnapshot(null, { totalSolved: 15001, recent });
  assert.equal(snapshot.recent.length, 15000);
  assert.equal(Object.keys(snapshot.solved).length, 15001);
  assert.equal(questionIsDone({ leetcode: { snapshot } }, 'leetcode:q-0'), true);
  snapshot = mergeSnapshot(snapshot, { totalSolved: 15001, recent: [{ ...recent[0], id: 'repeat', timestamp: 16000 }] });
  assert.equal(Object.keys(snapshot.solved).length, 15001);
  assert.equal(snapshot.solved['leetcode:q-0'].timestamp, 16000);
});

test('verified acceptance clears the pending flag in the solved store', () => {
  const record = { ...entry, id: 'leetcode:12', timestamp: 1000, pending: true, source: 'browser' };
  const pending = mergeSnapshot(null, { recent: [record] });
  const { pending: _pending, source: _source, ...verified } = record;
  const synced = mergeSnapshot(pending, { recent: [verified] });
  assert.equal(synced.solved[entry.key].pending, undefined);
  assert.equal(synced.solved[entry.key].source, 'provider');
});

test('preview resolves catalog titles, duplicates and unsupported/unconnected rows', () => {
  const result = previewSolvedImport(`${url}\n${url}?env=study-plan\nhttps://leetcode.com/u/sample/\nhttps://atcoder.jp/contests/dp/tasks/dp_a`, accounts, [{ ...entry, title: 'Catalog title' }]);
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].title, 'Catalog title');
  assert.equal(result.duplicates, 1);
  assert.equal(result.unresolved.length, 2);
  assert.equal(previewSolvedImport(url, { leetcode: { snapshot: { solved: { [entry.key]: entry } } } }).duplicates, 1);
});

test('CSV supports quoted commas/newlines and JSON never fabricates solve dates', () => {
  const csv = `"url","title"\r\n"${url}","Two,\nSum"\r\n`;
  assert.equal(previewSolvedImport(csv, accounts).records[0].title, 'Two,\nSum');
  const json = previewSolvedImport(JSON.stringify([{ url, timestamp: Date.now(), title: '<script>unsafe</script>' }]), accounts);
  assert.equal(json.records[0].timestamp, undefined);
  assert.equal(json.records[0].title, '<script>unsafe</script>');
  assert.throws(() => previewSolvedImport('{"url": "bad"}', accounts), /array/);
  assert.throws(() => previewSolvedImport(`url,title\n"${url},unclosed`, accounts), /unclosed/);
});

test('question imports reject credentials, ports, platform mismatch and non-problem links', () => {
  for (const value of ['https://evil.test/problems/two-sum/', 'https://user:secret@leetcode.com/problems/two-sum/', 'https://leetcode.com:444/problems/two-sum/', 'http://leetcode.com/problems/two-sum/', 'https://www.codechef.com/users/sample']) assert.throws(() => importQuestion(value));
  assert.throws(() => importQuestion({ platform: 'codechef', url }));
  assert.equal(importQuestion('https://codechef.com/problems/FLOW001').platform, 'codechef');
  assert.equal(importQuestion('https://www.geeksforgeeks.org/problems/two-sum/1').title, 'two-sum');
});

test('history pages filter rejected submissions and preserve resumable offsets', async () => {
  const page = await historyPage('codeforces', 'sample', { offset: 1000 }, { json: async endpoint => {
    assert.match(endpoint, /from=1001&count=1000$/);
    return { status: 'OK', result: [{ id: 1, verdict: 'OK', creationTimeSeconds: 1, author: { members: [{ handle: 'sample' }] }, problem: { contestId: 1, index: 'A', name: 'A' } }, { verdict: 'WRONG_ANSWER', id: 2 }] };
  } });
  assert.equal(page.recent.length, 1);
  assert.equal(page.cursor.offset, 1002);
  assert.equal(page.complete, true);
  await assert.rejects(historyPage('codeforces', 'sample', {}, { json: async () => ({ status: 'OK', result: [{ verdict: 'OK', author: { members: [{ handle: 'other' }] }, problem: { contestId: 1, index: 'A' } }] }) }), /account/);
  await assert.rejects(historyPage('leetcode', 'sample', {}, { session: async () => ({ submissions: [], count: 0, hasNext: true }) }), /stalled/);
});
