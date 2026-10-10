import test from 'node:test';
import assert from 'node:assert/strict';
import { solvedToday } from '../../tracker/ui/daily-count-ui.mjs';
import { leetcodeDailyUrl } from '../../tracker/daily.mjs';

test('today increases deduplicate accepts, separate platforms and reset at local midnight', () => {
  const recent = [
    { key: 'leetcode:one', timestamp: Date.parse('2026-10-09T19:00:00Z') },
    { key: 'leetcode:one', timestamp: Date.parse('2026-10-09T19:01:00Z') },
    { key: 'leetcode:old', timestamp: Date.parse('2026-10-09T18:00:00Z') },
  ];
  const leetcode = { snapshot: { recent } };
  const accounts = { leetcode, atcoder: { snapshot: { recent: [{ key: 'atcoder:one', day: '2026-10-10' }] } } };
  const now = Date.parse('2026-10-10T12:00:00Z');
  assert.equal(solvedToday({ leetcode }, 'Asia/Kolkata', now), 1);
  assert.equal(solvedToday(accounts, 'Asia/Kolkata', now), 2);
  assert.equal(solvedToday(accounts, 'Asia/Kolkata', Date.parse('2026-10-10T18:30:00Z')), 0);
  assert.equal(solvedToday({ code360: { snapshot: { totalSolved: 200 } } }, 'Asia/Kolkata', now), 0);
});

test('POTD resolves the current LeetCode link and rejects unsafe or unavailable responses', async () => {
  let query;
  const result = await leetcodeDailyUrl(async (url, options) => {
    assert.equal(url, 'https://leetcode.com/graphql');
    query = JSON.parse(options.body).query;
    return { ok: true, json: async () => ({ data: { activeDailyCodingChallengeQuestion: { link: '/problems/two-sum/' } } }) };
  });
  assert.match(query, /activeDailyCodingChallengeQuestion/);
  assert.equal(result, 'https://leetcode.com/problems/two-sum/');
  for (const link of ['https://example.com/problems/fake/', '//example.com/problems/fake/', 'javascript:alert(1)', '/discuss/']) {
    await assert.rejects(leetcodeDailyUrl(async () => ({ ok: true, json: async () => ({ data: { activeDailyCodingChallengeQuestion: { link } } }) })), /invalid/);
  }
  await assert.rejects(leetcodeDailyUrl(async () => ({ ok: false })), /Could not load/);
  await assert.rejects(leetcodeDailyUrl(async () => ({ ok: true, json: async () => ({ errors: [{ message: 'Unavailable' }] }) })), /unavailable/);
});
