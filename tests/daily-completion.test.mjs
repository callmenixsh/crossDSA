import test from 'node:test';
import assert from 'node:assert/strict';
import { dailyDay, dailyDoneKey, dailyProblem, dailySolved, savedDailyStatus, recordDailyStatus } from '../tracker/daily.mjs';
import { tufActivityToday, solvedToday } from '../tracker/count-ui.mjs';
import { emptyState, practiceToday, practiceOverview } from '../tracker/core.mjs';
import { prepareBackup } from '../tracker/data-backup.mjs';

const now = Date.parse('2026-10-10T20:00:00Z');
test('verified daily history survives serialization and restore, is sticky, and separates accounts and days', () => {
  for (const platform of ['code360', 'tuf']) {
    let account = { handle: 'Alice', generation: 'first' };
    assert.equal(savedDailyStatus(platform, account, now), null);
    recordDailyStatus(platform, account, { day: dailyDay(platform, now), done: true }, now);
    account = JSON.parse(JSON.stringify(account));
    assert.equal(savedDailyStatus(platform, account, now).done, true);
    recordDailyStatus(platform, account, { day: dailyDay(platform, now), done: false }, now + 1000);
    assert.equal(savedDailyStatus(platform, account, now).done, true);
    assert.equal(Object.keys(account.dailyHistory).length, 1);
    assert.equal(savedDailyStatus(platform, account, now + 86400000), null);
    assert.equal(savedDailyStatus(platform, { ...account, handle: 'bob' }, now), null);
    const backup = emptyState(); backup.accounts[platform] = account;
    const restored = prepareBackup(backup).accounts[platform];
    assert.notEqual(restored.generation, account.generation);
    assert.equal(savedDailyStatus(platform, restored, now).done, true);
    recordDailyStatus(platform, account, { day: dailyDay(platform, now + 86400000), done: false }, now + 86400000);
    assert.equal(savedDailyStatus(platform, account, now + 86400000).done, false);
    assert.equal(Object.keys(account.dailyHistory).length, 2);
  }
});

test('TUF activity uses the provider day and never creates unique solve counts', () => {
  const account = { snapshot: { calendar: { '2026-10-10': 8, '2026-10-11': 3 }, recent: [] } };
  assert.equal(tufActivityToday(account, now), 3);
  assert.equal(solvedToday({ tuf: account }, 'Asia/Kolkata', now), 0);
  assert.equal(tufActivityToday(account, now + 86400000), 0);
  assert.equal(tufActivityToday({ snapshot: { calendar: { '2026-10-11': -1 } } }, now), 0);
});

test('combined daily progress adds TUF once, retains cached solves and resets each provider day', () => {
  const state = emptyState(); state.settings.timeZone = 'UTC';
  state.accounts = {
    leetcode: { snapshot: { totalSolved: 10, activityStatus: 'cached', recent: [{ key: 'leetcode:one', timestamp: now }, { key: 'leetcode:one', timestamp: now }] } },
    tuf: { dailyHistory: { '2026-10-11': { done: true } }, snapshot: { totalSolved: 12, calendar: { '2026-10-11': 4 }, recent: [{ key: 'tuf:potd', timestamp: now }] } },
  };
  assert.equal(practiceToday(state.accounts, 'UTC', now), 5);
  assert.equal(practiceOverview(state, now).today, 5);
  assert.equal(practiceOverview(state, now).total, 22, 'Daily increases do not get added again to lifetime totals');
  assert.equal(practiceToday(state.accounts, 'UTC', Date.parse('2026-10-11T18:30:00Z')), 0);
  assert.equal(practiceToday({ leetcode: state.accounts.leetcode }, 'UTC', now), 1);
  assert.equal(practiceToday({ tuf: state.accounts.tuf }, 'UTC', now), 4);
});
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
