import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, practiceOverview, normalizeState, cleanHandle, problemKey, safeProblemUrl, dateKey, dailyActivity, streaks, acceptedToday, mergeSnapshot } from '../tracker/core.mjs';
import { collectors, parseCodeChefFeed } from '../tracker/platforms.mjs';

const accepted = (id, key, timestamp, extra = {}) => ({ id, key, timestamp, ...extra });

test('Saved becomes the Starred default list without losing memberships or custom lists', () => {
  const state = normalizeState({ version: 1, lists: { saved: { id: 'saved', name: 'Saved' }, custom: { id: 'custom', name: 'Review' } }, workspace: { a: { listIds: ['saved', 'custom'], notes: 'Keep' } } });
  assert.equal(state.lists.saved.name, 'Starred');
  assert.deepEqual(state.workspace.a.listIds, ['saved', 'custom']);
  assert.equal(state.lists.custom.name, 'Review'); assert.equal(state.workspace.a.notes, 'Keep');
});

test('pending browser accepts update daily goals and overlay a calendar until refreshed', () => {
  const timestamp = Date.parse('2026-10-09T12:00:00Z');
  const accounts = { leetcode: { syncedAt: timestamp - 1000, snapshot: { calendar: { '2026-10-09': 3 }, recent: [
    accepted('1', 'leetcode:two-sum', timestamp, { pending: true }),
    accepted('2', 'leetcode:two-sum', timestamp, { pending: true }),
  ] } } };
  assert.equal(acceptedToday(accounts, '2026-10-09', 'UTC'), 1);
  assert.equal(dailyActivity(accounts, 'UTC')['2026-10-09'], 5);
  accounts.leetcode.syncedAt = timestamp + 1000;
  accounts.leetcode.snapshot.calendar['2026-10-09'] = 5;
  assert.equal(dailyActivity(accounts, 'UTC')['2026-10-09'], 5);
});

test('handles accept only the correct profile host/path and reject URL injection', () => {
  assert.equal(cleanHandle('leetcode', 'https://leetcode.com/u/lee215/?tab=stats'), 'lee215');
  assert.equal(cleanHandle('tuf', '@sample_user'), 'sample_user');
  assert.throws(() => cleanHandle('leetcode', 'https://evil.example/u/name/'));
  assert.throws(() => cleanHandle('leetcode', 'https://leetcode.com/problems/two-sum/'));
  assert.throws(() => cleanHandle('leetcode', 'a") { injected }'));
});

test('problem identity stays platform-specific and canonicalizes contest paths', () => {
  assert.equal(problemKey('codeforces', 'https://codeforces.com/contest/123/problem/A'), problemKey('codeforces', 'https://codeforces.com/problemset/problem/123/A'));
  assert.equal(problemKey('codechef', 'https://www.codechef.com/START1/problems/ABC'), 'codechef:ABC');
  assert.equal(problemKey('geeksforgeeks', 'https://www.geeksforgeeks.org/problems/two-sum/1'), 'geeksforgeeks:two-sum');
  assert.notEqual(problemKey('leetcode', 'https://leetcode.com/problems/two-sum'), problemKey('geeksforgeeks', 'https://www.geeksforgeeks.org/problems/two-sum'));
  assert.equal(safeProblemUrl('javascript:alert(1)', 'leetcode'), null);
  assert.equal(safeProblemUrl('https://leetcode.com.evil.example/problems/x', 'leetcode'), null);
});

test('day boundaries use the selected timezone', () => {
  assert.equal(dateKey('2026-10-08T19:00:00Z', 'Asia/Kolkata'), '2026-10-09');
  assert.equal(dateKey('2026-10-08T19:00:00Z', 'UTC'), '2026-10-08');
  assert.equal(dateKey('invalid'), null);
});

test('streaks allow an unfinished today, ignore future entries, and handle leap days', () => {
  assert.deepEqual(streaks({ '2024-02-28': 1, '2024-02-29': 2, '2024-03-01': 1, '2024-03-04': 1 }, '2024-03-02'), { current: 3, longest: 3 });
  assert.deepEqual(streaks({ '2026-10-07': 1 }, '2026-10-09'), { current: 0, longest: 1 });
});

test('calendars are not added to recent records a second time', () => {
  const accounts = { leetcode: { snapshot: { calendar: { '2026-10-09': 5 }, recent: [accepted('lc:1', 'leetcode:x', Date.parse('2026-10-09T12:00Z'))] } }, codeforces: { snapshot: { recent: [accepted('cf:1', 'codeforces:y', Date.parse('2026-10-09T12:00Z'))] } } };
  assert.deepEqual(dailyActivity(accounts, 'UTC'), { '2026-10-09': 6 });
  assert.deepEqual(dailyActivity(accounts, 'UTC', 'leetcode'), { '2026-10-09': 5 });
});

test('daily goals deduplicate repeat accepts and exclude calendar-only activity', () => {
  const time = Date.parse('2026-10-09T12:00Z');
  const accounts = { lc: { snapshot: { recent: [accepted('1', 'leetcode:x', time), accepted('2', 'leetcode:x', time)] } }, tuf: { snapshot: { calendar: { '2026-10-09': 50 }, recent: [] } }, gfg: { snapshot: { recent: [accepted('3', 'geeksforgeeks:x', time, { day: '2026-10-09' })] } } };
  assert.equal(acceptedToday(accounts, '2026-10-09', 'UTC'), 2);
});

test('rolling recent feeds preserve old records without counting resyncs twice', () => {
  const result = mergeSnapshot({ recent: [accepted('1', 'x', 1), accepted('2', 'y', 2)] }, { totalSolved: 3, recent: [accepted('2', 'y', 2), accepted('3', 'z', 3)] });
  assert.deepEqual(result.recent.map(r => r.id), ['3', '2', '1']);
  assert.equal(result.totalSolved, 3);
});

test('CodeChef feed imports only accepted rows and preserves dates', () => {
  const html = `<tr><td title='07:47 AM 04/07/22'></td><td><a href='/START1/problems/ABC'>ABC</a></td><td><span title='accepted'></span></td><td><a href='/viewsolution/12345'>View</a></td></tr><tr><td title='08:47 AM 04/07/22'></td><td><a href='/problems/FAIL'>FAIL</a></td><td><span title='wrong answer'></span></td></tr>`;
  const rows = parseCodeChefFeed(html);
  assert.equal(rows.length, 1); assert.equal(rows[0].id, 'codechef:12345');
  assert.equal(rows[0].timestamp, Date.parse('2022-07-04T07:47:00+05:30'));
  assert.equal(rows[0].key, 'codechef:ABC');
});

test('LeetCode handles reject missing profiles instead of returning fake zero stats', async () => {
  await assert.rejects(collectors.leetcode('missing', { json: async () => ({ data: { matchedUser: null } }) }), /not found/);
});

test('LeetCode statistics, calendar, contest history and recent IDs normalize', async () => {
  const snapshot = await collectors.leetcode('sample', { json: async () => ({ data: {
    matchedUser: { profile: { ranking: 42 }, submitStatsGlobal: { acSubmissionNum: [{ difficulty: 'All', count: 10 }, { difficulty: 'Easy', count: 8 }] }, badges: [{ name: 'Badge' }], userCalendar: { activeYears: [], submissionCalendar: '{"1791504000":3}' } },
    recentAcSubmissionList: [{ id: '100', title: '<unsafe title>', titleSlug: 'two-sum', timestamp: '1791504001' }],
    userContestRanking: { rating: 1600 }, userContestRankingHistory: [{ attended: true, rating: 1550, contest: { title: 'Weekly', startTime: 1 } }],
  } }) });
  assert.equal(snapshot.totalSolved, 10); assert.equal(snapshot.rating, 1600); assert.equal(snapshot.partial, true);
  assert.equal(snapshot.recent[0].key, 'leetcode:two-sum'); assert.equal(snapshot.recent[0].title, '<unsafe title>');
  assert.equal(snapshot.calendar['2026-10-09'], 3);
});

test('Codeforces deduplicates solved problems, excludes failed verdicts, and imports rating history', async () => {
  const submissions = [
    { id: 3, verdict: 'OK', creationTimeSeconds: 100, problem: { contestId: 1, index: 'A', name: 'A', tags: [] } },
    { id: 2, verdict: 'OK', creationTimeSeconds: 90, problem: { contestId: 1, index: 'A', name: 'A', tags: [] } },
    { id: 1, verdict: 'WRONG_ANSWER', creationTimeSeconds: 80, problem: { contestId: 1, index: 'B', name: 'B' } },
  ];
  const s = await collectors.codeforces('sample', { wait: async () => {}, json: async url => url.includes('user.status') ? { status: 'OK', result: submissions } : { status: 'OK', result: [{ ratingUpdateTimeSeconds: 120, newRating: 1400, contestName: 'Round' }] } });
  assert.equal(s.totalSolved, 1); assert.equal(s.recent.length, 2); assert.equal(s.rating, 1400); assert.equal(s.partial, false);
});

test('Codeforces failed requests are errors, not empty successful history', async () => {
  await assert.rejects(collectors.codeforces('sample', { json: async () => ({ status: 'FAILED', comment: 'Invalid handle' }) }), /Invalid handle/);
});

test('GFG imports solved records and flags missing dated history', async () => {
  const s = await collectors.geeksforgeeks('sample', { json: async url => url.includes('authapi') ? { data: { total_problems_solved: 2, score: 4, institute_rank: 651 } } : { status: 'success', result: { Easy: { 1: { pname: 'One', slug: 'one', user_subtime: '2026-10-09 10:00:00' }, 2: { pname: 'No date', slug: 'two' } } } } });
  assert.equal(s.totalSolved, 2); assert.equal(s.recent.length, 1); assert.equal(s.partial, true);
  assert.equal(s.recent[0].day, '2026-10-09');
  assert.equal(s.score, 4); assert.equal(s.rank, 651); assert.equal(s.rating, null);
});

test('GFG score history keeps daily observations across syncs without inventing past points', () => {
  const first = Date.parse('2026-10-08T10:00:00Z'), second = Date.parse('2026-10-09T10:00:00Z');
  let snapshot = mergeSnapshot(null, { score: 0, recent: [] }, first);
  assert.deepEqual(snapshot.scoreHistory, [{ timestamp: first, rating: 0 }]);
  snapshot = mergeSnapshot(snapshot, { score: 4, recent: [] }, second);
  snapshot = mergeSnapshot(snapshot, { score: 8, recent: [] }, second + 1000);
  assert.deepEqual(snapshot.scoreHistory.map(p => p.rating), [0, 8]);
  snapshot = mergeSnapshot(snapshot, { score: null, recent: [] }, second + 2000);
  assert.equal(snapshot.scoreHistory.length, 2, 'Missing scores do not become zero observations');
  for (let i = 1; i <= 200; i++) snapshot = mergeSnapshot(snapshot, { score: i, recent: [] }, second + i * 86400000);
  assert.equal(snapshot.scoreHistory.length, 180);
  assert.equal(snapshot.scoreHistory.at(-1).rating, 200);
});

test('GFG missing institute rank remains unavailable', async () => {
  const s = await collectors.geeksforgeeks('sample', { json: async url => url.includes('authapi') ? { data: { total_problems_solved: 0 } } : { status: 'success', result: {} } });
  assert.equal(s.rank, null); assert.equal(s.score, null);
});

test('TUF excludes aggregated external-platform calendars to avoid double-counting', async () => {
  const ctx = { siteJson: async url => url.endsWith('/heatmap') ? { success: true, data: { availableFilters: ['All', 'TUF', 'LeetCode'], heatmapData: [{ date: '2026-10-09', count: 8 }] } } : { success: true, data: { learningProgress: [{ platform: 'TUF', totalSolved: 10, difficultyBreakdown: [] }] } } };
  const s = await collectors.tuf('sample', ctx);
  assert.deepEqual(s.calendar, {}); assert.equal(s.totalSolved, 10); assert.match(s.coverage, /double-counting/);
});

test('TUF-only dated activity imports while keeping daily accepted goals empty', async () => {
  const s = await collectors.tuf('sample', { siteJson: async url => url.endsWith('/heatmap') ? { success: true, data: { availableFilters: ['All', 'TUF'], heatmapData: [{ date: '2026-10-09', count: 8 }] } } : { success: true, data: { learningProgress: [{ platform: 'TUF', totalSolved: 10 }] } } });
  assert.equal(s.calendar['2026-10-09'], 8); assert.equal(s.recent.length, 0);
});

test('Code360 can import totals while leaving dated activity explicitly unavailable', async () => {
  const s = await collectors.code360('uuid', { json: async url => url.includes('user_details') ? { data: { dsa_domain_data: { problem_count_data: { total_count: 12, difficulty_data: [{ level: 'Easy', count: 12 }] } } } } : { data: null, message: 'You need to login' } });
  assert.equal(s.totalSolved, 12); assert.equal(s.recent.length, 0); assert.equal(s.partial, true); assert.equal(s.providerStreak, null);
});


test('legacy bookmarks migrate to Saved while old notes remain stored', () => {
  const state = normalizeState({ version: 1, workspace: { a: { bookmarked: true, notes: 'old note' }, b: { bookmarked: false } } });
  assert.deepEqual(state.workspace.a.listIds, ['saved']);
  assert.deepEqual(state.workspace.b.listIds, []);
  assert.equal(state.workspace.a.notes, 'old note');
  assert.deepEqual(normalizeState(state), state);
});


test('LeetCode imports private accepts through the verified session fallback', async () => {
  const snapshot = await collectors.leetcode('sample', {
    json: async () => ({ data: { matchedUser: { profile: {}, submitStatsGlobal: { acSubmissionNum: [{ difficulty: 'All', count: 299 }] }, userCalendar: { submissionCalendar: '{}' } }, recentAcSubmissionList: [] } }),
    ownRecent: async handle => { assert.equal(handle, 'sample'); return [{ id: 42, title: 'Two Sum', titleSlug: 'two-sum', timestamp: 1791504001 }]; },
  });
  assert.equal(snapshot.recent[0].key, 'leetcode:two-sum');
  assert.equal(snapshot.recentSource, 'signed-in'); assert.equal(snapshot.activityWarning, '');
  const state = emptyState(); state.settings.timeZone = 'Asia/Kolkata'; state.accounts.leetcode = { snapshot };
  assert.equal(practiceOverview(state, Date.parse('2026-10-09T12:00:00Z')).today, 1);
});

test('unavailable signed-in history retains totals and reports missing accepted access', async () => {
  const snapshot = await collectors.leetcode('sample', {
    json: async () => ({ data: { matchedUser: { profile: {}, submitStatsGlobal: { acSubmissionNum: [{ difficulty: 'All', count: 299 }] }, userCalendar: { submissionCalendar: '{"1791504000":4}' } }, recentAcSubmissionList: [] } }),
    ownRecent: async () => { throw new Error('Open LeetCode signed in as @sample.'); },
  });
  assert.equal(snapshot.totalSolved, 299); assert.equal(snapshot.recent.length, 0);
  assert.match(snapshot.activityWarning, /Open LeetCode/);
  const state = emptyState(); state.accounts.leetcode = { snapshot };
  assert.equal(practiceOverview(state, Date.parse('2026-10-09T12:00:00Z')).today, 0, 'Calendar attempts do not become accepted questions');
});

test('popup overview combines solves and uses the LeetCode current streak', () => {
  const state = emptyState(); state.settings.timeZone = 'Asia/Kolkata';
  state.accounts.leetcode = { snapshot: { totalSolved: 299, calendar: { '2026-10-08': 1, '2026-10-09': 4 }, recent: [{ key: 'leetcode:two-sum', timestamp: Date.parse('2026-10-09T01:00:00Z') }] } };
  state.accounts.codeforces = { snapshot: { totalSolved: 9, recent: [] } };
  const summary = practiceOverview(state, Date.parse('2026-10-09T12:00:00Z'));
  assert.equal(summary.total, 308); assert.equal(summary.today, 1); assert.equal(summary.streak, 2); assert.equal(summary.streakLabel, 'Streak - LeetCode');
});
