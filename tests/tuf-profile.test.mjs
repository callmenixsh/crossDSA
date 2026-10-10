import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTufProfile } from '../tracker/tuf-profile.mjs';
import { collectors } from '../tracker/platforms.mjs';

function profileHtml(filters = ['All', 'TUF', 'LeetCode'], solved = 122) {
  const frame = 'a:' + JSON.stringify({ username: 'sample', initialHeatmap: { availableFilters: filters, heatmapData: [{ date: '2026-10-10', count: 4 }] },
    dsaProgress: { byPlatform: { TUF: { platform: 'TUF', solved, categories: [{ label: 'Basic', solved: 53 }], topics: [{ label: 'Arrays', solved: 66 }] }, LeetCode: { solved: 300 } } } }) + '\n';
  // Flight text can be split across scripts in the middle of a JSON value.
  return '<link rel="canonical" href="https://takeuforward.org/profile/sample"/>' + [frame.slice(0, 100), frame.slice(100)].map(part => `<script>self.__next_f.push(${JSON.stringify([1, part])})</script>`).join('');
}
test('TUF public profiles import without browser tabs and exclude other platforms', async () => {
  const html = profileHtml();
  assert.equal(parseTufProfile(html, 'sample').progress.totalSolved, 122);
  const snapshot = await collectors.tuf('sample', { text: async url => {
    assert.equal(url, 'https://takeuforward.org/profile/sample'); return html;
  }, siteJson: async () => { assert.fail('Public profile sync must not require a tab'); } });
  assert.equal(snapshot.totalSolved, 122);
  assert.deepEqual(snapshot.breakdown, { Basic: 53 });
  assert.deepEqual(snapshot.topics, [{ topic: 'Arrays', count: 66 }]);
  assert.deepEqual(snapshot.calendar, {});
  const tufOnly = await collectors.tuf('sample', { text: async () => profileHtml(['All', 'TUF']) });
  assert.equal(tufOnly.calendar['2026-10-10'], 4);
});
test('TUF rejects mismatched handles and unavailable public totals without running scripts', () => {
  assert.throws(() => parseTufProfile(profileHtml(), 'other'), /handle/);
  assert.throws(() => parseTufProfile(profileHtml(undefined, null), 'sample'));
  assert.throws(() => parseTufProfile('<script>throw Error("Do not run")</script>', 'sample'));
});
test('Code360 reads only the public profile and never calls the broken streak endpoint', async () => {
  const snapshot = await collectors.code360('sample', { json: async url => {
    assert.equal(url.includes('streaks'), false);
    return { data: { dsa_domain_data: { problem_count_data: { total_count: 7, difficulty_data: [] } } } };
  } });
  assert.equal(snapshot.totalSolved, 7);
  assert.equal(snapshot.providerStreak, null);
  await assert.rejects(collectors.code360('missing', { json: async () => { throw new Error('Profile not found'); } }), /Profile not found/);
});


test('TUF fetches filtered calendar years in the background and retains unavailable years', async () => {
  const requests = [];
  const snapshot = await collectors.tuf('sample', { now: () => Date.parse('2026-10-10'), text: async () => profileHtml(), previous: { calendar: { '2024-03-01': 7 } }, json: async url => {
    requests.push(url); if (url.includes('year=2024')) throw new Error('Offline');
    const year = new URL(url).searchParams.get('year');
    assert.equal(new URL(url).searchParams.get('platform'), 'TUF');
    return { success: true, data: { selectedPlatform: 'TUF', availableFilters: ['All', 'TUF', 'LeetCode'], heatmapData: [{ date: `${year}-03-01`, count: 2 }, { date: '2020-01-01', count: 100 }] } };
  } });
  assert.equal(requests.length, 3);
  assert.deepEqual(snapshot.calendar, { '2024-03-01': 7, '2025-03-01': 2, '2026-03-01': 2 });
  assert.match(snapshot.calendarWarning, /cached/);
  assert.equal(snapshot.calendar['2026-10-10'], undefined, 'Mixed public calendar must not leak into filtered data');
});

test('TUF API profile fallback works without a website tab', async () => {
  const snapshot = await collectors.tuf('sample', { now: () => Date.parse('2026-10-10'), text: async () => { throw new Error('Unavailable'); }, json: async url => url.includes('/heatmap?') ? { success: true, data: { heatmapData: [{ date: '2026-10-10', count: 3 }] } } : { success: true, data: { learningProgress: [{ platform: 'TUF', totalSolved: 12 }] } }, siteJson: async () => { assert.fail('No tab required'); } });
  assert.equal(snapshot.totalSolved, 12);
  assert.equal(snapshot.calendar['2026-10-10'], 3);
});


test('TUF requests all calendar years together and never falls back to an open tab', async () => {
  const pending = [];
  const sync = collectors.tuf('sample', {
    text: async () => profileHtml(),
    json: url => new Promise((resolve, reject) => pending.push({ url, resolve, reject })),
    siteJson: async () => assert.fail('Background sync must never depend on a website tab'),
  });
  await new Promise(resolve => setImmediate(resolve));
  const count = pending.length;
  for (const request of pending) request.reject(new Error('API unavailable'));
  assert.equal(count, 3, 'All years start before any year finishes');
  const snapshot = await sync;
  assert.equal(snapshot.totalSolved, 122);
  assert.match(snapshot.calendarWarning, /cached/);
});
