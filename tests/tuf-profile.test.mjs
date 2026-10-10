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
