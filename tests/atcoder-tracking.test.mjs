import test from 'node:test';
import assert from 'node:assert/strict';
import { atcoder, parseAtCoderProfile } from '../tracker/atcoder.mjs';
import { cleanHandle, mergeSnapshot, dailyActivity, acceptedToday, doneQuestions } from '../tracker/core.mjs';
import { ratingSeries } from '../tracker/ratings.mjs';

const now = Date.parse('2026-10-09T12:00:00Z'), seconds = now / 1000;
const profile = '<title>sample - AtCoder</title><table><tr><th>Rank</th><td>1,234th <span>(Top 1%)</span></td></tr><tr><th>Rating</th><td><span class="user-blue">1680</span></td></tr><tr><th>Highest Rating</th><td><b>1900</b></td></tr></table>';
const row = (id, epoch_second = seconds - 10, extra = {}) => ({ id, epoch_second, result: 'AC', user_id: 'sample', contest_id: 'dp', problem_id: 'dp_a', ...extra });
function context(submissions, extra = {}) {
  const requests = [], waits = [];
  return { requests, waits, now: () => now, text: async () => profile, wait: async ms => waits.push(ms),
    json: async url => { requests.push(url); return url.includes('/history/json') ? [{ IsRated: true, NewRating: 1680, ContestName: 'ABC', EndTime: '2026-10-01T22:40:00+09:00' }, { IsRated: false, NewRating: 0, EndTime: '2026-10-02T22:40:00+09:00' }] : submissions(Number(new URL(url).searchParams.get('from_second'))); }, ...extra };
}

test('AtCoder profile parses native rating/rank and validates profile identity', () => {
  assert.deepEqual(parseAtCoderProfile(profile, 'sample'), { rating: 1680, highestRating: 1900, rank: 1234 });
  assert.throws(() => parseAtCoderProfile(profile, 'other'), /not found/);
  assert.deepEqual(parseAtCoderProfile('<title>new_user - AtCoder</title>', 'new_user'), { rating: null, highestRating: null, rank: null });
  assert.equal(cleanHandle('atcoder', 'https://atcoder.jp/users/sample?lang=en'), 'sample');
  for (const handle of ['bad-handle', 'bad.handle', 'a'.repeat(33), 'https://evil.test/users/sample', 'https://atcoder.jp/users/sample/history']) assert.throws(() => cleanHandle('atcoder', handle));
});

test('AtCoder imports only AC, deduplicates submission IDs and counts task identities across rehosts', async () => {
  const ctx = context(() => [row(1), row(2, seconds - 5, { contest_id: 'another' }), row(3, seconds - 3, { result: 'WA' }), row(4, seconds - 2, { problem_id: 'dp_b' })], { problemTitles: new Map([['dp_a', 'Frog 1']]) });
  const snapshot = await atcoder('sample', ctx);
  assert.equal(snapshot.recent.length, 3); assert.equal(snapshot.totalSolved, 2);
  assert.equal(snapshot.recent.find(r => r.id === 'atcoder:1').title, 'Frog 1');
  assert.equal(snapshot.partial, false); assert.equal(snapshot.rating, 1680); assert.equal(snapshot.ratings.length, 1);
  assert.match(snapshot.coverage, /unofficial/);
  assert.ok(ctx.waits.every(ms => ms > 1000));
  const accounts = { atcoder: { snapshot } };
  assert.equal(acceptedToday(accounts, '2026-10-09', 'UTC'), 2);
  assert.equal(dailyActivity(accounts, 'UTC')['2026-10-09'], 3);
  assert.equal(doneQuestions(accounts).total, 2);
  assert.equal(ratingSeries(accounts, 2026, 'UTC')[0].id, 'atcoder');
});

test('AtCoder imports paginate inclusively, retain failed-submission cursors and resume old history', async () => {
  let historical = 0;
  const ctx = context(from => {
    if (from > seconds - 10 * 86400) return [];
    historical++;
    return Array.from({ length: 500 }, (_, i) => row(historical * 1000 + i, from + i + 1, { result: i === 499 ? 'AC' : 'WA' }));
  });
  const first = await atcoder('sample', ctx);
  assert.equal(first.atcoderSync.historyComplete, false); assert.equal(first.totalIsLowerBound, true);
  assert.equal(first.atcoderSync.cursor, 2500);
  const starts = ctx.requests.filter(u => u.includes('submissions')).map(u => Number(new URL(u).searchParams.get('from_second')));
  assert.deepEqual(starts.slice(1), [0, 500, 1000, 1500, 2000]);
  const nextCtx = context(() => [], { previous: first });
  const second = await atcoder('sample', nextCtx);
  assert.ok(nextCtx.requests.some(u => u.endsWith('from_second=2500')));
  assert.equal(second.totalIsLowerBound, false); assert.equal(second.totalSolved, first.totalSolved);
});

test('AtCoder stalls safely instead of skipping more than 500 submissions at one second', async () => {
  const snapshot = await atcoder('sample', context(from => from === 0 ? Array.from({ length: 500 }, (_, i) => row(i + 1, 0, { result: 'WA' })) : []));
  assert.equal(snapshot.atcoderSync.cursor, 0);
  assert.equal(snapshot.totalIsLowerBound, true); assert.match(snapshot.activityWarning, /stalled/);
});

test('AtCoder preserves successful pages on a later failure and keeps previous solves on retry', async () => {
  const previous = await atcoder('sample', context(() => [row(1)]));
  const snapshot = await atcoder('sample', context(() => { throw new Error('Rate limited'); }, { previous }));
  assert.equal(snapshot.totalSolved, 1); assert.equal(snapshot.recent.length, 1);
  assert.match(snapshot.activityWarning, /Rate limited/);
  let calls = 0;
  const partial = await atcoder('sample', context(() => {
    if (++calls > 1) throw new Error('Offline');
    return [row(2)];
  }));
  assert.equal(partial.recent.length, 1); assert.equal(partial.atcoderSync.historyComplete, false);
  await assert.rejects(atcoder('sample', context(() => { throw new Error('Offline'); })), /could not fully refresh/);
});

test('AtCoder rejects malformed, mismatched and unsafe submission data', async () => {
  for (const extra of [{ user_id: 'other' }, { contest_id: '../evil' }, { problem_id: 'a/b' }, { id: '12' }, { epoch_second: seconds + 9999 }]) {
    await assert.rejects(atcoder('sample', context(() => [row(1, seconds, extra)])), /unexpected submission/);
  }
  await assert.rejects(atcoder('sample', context(() => ({ error: 'oops' }))), /invalid submission/);
});

test('AtCoder retains cached rating history when that endpoint is unavailable', async () => {
  const previous = await atcoder('sample', context(() => []));
  const ctx = context(() => [], { previous });
  const json = ctx.json;
  ctx.json = url => url.includes('/history/json') ? Promise.reject(new Error('Offline')) : json(url);
  const snapshot = await atcoder('sample', ctx);
  assert.deepEqual(snapshot.ratings, previous.ratings); assert.match(snapshot.ratingWarning, /could not refresh/);
});

test('AtCoder unique solved IDs survive the local accepted-record storage limit', async () => {
  const snapshot = await atcoder('sample', context(() => []));
  snapshot.atcoderSync.solvedTaskIds = Array.from({ length: 16001 }, (_, i) => `task_${i}`);
  snapshot.recent = Array.from({ length: 16001 }, (_, i) => ({ id: `atcoder:${i + 1}`, key: `atcoder:task_${i}`, platform: 'atcoder', timestamp: now - i }));
  snapshot.totalSolved = 16001;
  const merged = mergeSnapshot(null, snapshot);
  assert.equal(merged.recent.length, 15000);
  const updated = await atcoder('sample', context(() => [], { previous: merged }));
  assert.equal(updated.totalSolved, 16001);
  assert.equal(updated.partial, true); assert.match(updated.coverage, /15,000/);
});
