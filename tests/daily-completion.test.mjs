import test from 'node:test';
import assert from 'node:assert/strict';
import { dailyDay, dailyDoneKey, dailyProblem, dailySolved } from '../tracker/daily.mjs';

const now = Date.parse('2026-10-10T20:00:00Z');
test('POTD completion matches the exact problem and provider day, not total increases', () => {
  const target = { day: '2026-10-10', url: 'https://leetcode.com/problems/two-sum/' };
  const state = { accounts: { leetcode: { snapshot: { totalSolved: 100, recent: [] } } }, workspace: {} };
  assert.equal(dailySolved('leetcode', state, target, now), false);
  const recent = state.accounts.leetcode.snapshot.recent;
  recent.push({ key: 'leetcode:other', timestamp: now });
  assert.equal(dailySolved('leetcode', state, target, now), false);
  recent.push({ key: 'leetcode:two-sum', timestamp: now - 86400000 });
  assert.equal(dailySolved('leetcode', state, target, now), false);
  recent.push({ key: 'leetcode:two-sum' });
  assert.equal(dailySolved('leetcode', state, target, now), false, 'Missing timestamps cannot imply a solve today');
  recent.push({ key: 'leetcode:two-sum', timestamp: now });
  assert.equal(dailySolved('leetcode', state, target, now), true);
  assert.equal(dailySolved('leetcode', state, target, now + 86400000), false);
  assert.equal(dailySolved('leetcode', { accounts: {}, workspace: {} }, target, now), false);
  state.accounts.leetcode.snapshot.recent = [];
  state.workspace['leetcode:two-sum'] = { done: true, doneAt: now - 86400000, updatedAt: now };
  assert.equal(dailySolved('leetcode', state, target, now), false, 'Editing an older done question does not complete today\'s POTD');
  state.workspace['leetcode:two-sum'].doneAt = now;
  assert.equal(dailySolved('leetcode', state, target, now), true);
});

test('provider reset times and completion keys separate days, platforms and accounts', () => {
  assert.equal(dailyDay('leetcode', now), '2026-10-10');
  for (const id of ['geeksforgeeks', 'tuf', 'code360']) assert.equal(dailyDay(id, now), '2026-10-11');
  assert.notEqual(dailyDoneKey('tuf', 'alice'), dailyDoneKey('tuf', 'bob'));
  assert.notEqual(dailyDoneKey('tuf', 'alice'), dailyDoneKey('code360', 'alice'));
  const target = { day: '2026-10-11', url: 'https://www.geeksforgeeks.org/problems/sample/1' };
  const state = { accounts: { geeksforgeeks: { snapshot: { recent: [{ key: 'geeksforgeeks:sample', day: '2026-10-11' }] } } } };
  assert.equal(dailySolved('geeksforgeeks', state, target, now), true);
});

test('GFG daily metadata validates the date and official problem URL', async () => {
  const payload = { date: '2026-10-11 00:00:00', problem_url: 'https://www.geeksforgeeks.org/problems/sample/1' };
  const fetcher = async () => ({ ok: true, json: async () => payload });
  assert.deepEqual(await dailyProblem('geeksforgeeks', fetcher, now), { day: '2026-10-11', url: payload.problem_url });
  payload.date = '2026-10-10 00:00:00';
  await assert.rejects(dailyProblem('geeksforgeeks', fetcher, now));
  payload.date = '2026-10-11 00:00:00'; payload.problem_url = 'https://example.com/problems/sample/1';
  await assert.rejects(dailyProblem('geeksforgeeks', fetcher, now));
});
