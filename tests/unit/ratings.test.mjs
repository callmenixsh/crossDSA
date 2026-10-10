import test from 'node:test';
import assert from 'node:assert/strict';
import { ratingSeries } from '../../tracker/ratings.mjs';

test('rating series uses dated contests in the selected local year, sorted by time', () => {
  const accounts = { leetcode: { syncedAt: Date.parse('2026-06-01'), snapshot: { rating: 1800, ratings: [
    { timestamp: Date.parse('2026-03-01'), rating: 1700 },
    { timestamp: Date.parse('2025-12-31T20:00Z'), rating: 1600 },
    { timestamp: Date.parse('2025-01-01'), rating: 1500 },
    { timestamp: 0, rating: 1400 }, { timestamp: Date.parse('2026-02-01'), rating: null },
  ] } } };
  assert.deepEqual(ratingSeries(accounts, 2026, 'Asia/Kolkata')[0].points.map(p => p.rating), [1600, 1700]);
  assert.equal(ratingSeries(accounts, 2024, 'UTC').length, 0, 'No current-rating fallback into years without contests');
});

test('all platforms include coding scores alongside ratings and zero scores are retained', () => {
  const timestamp = Date.parse('2026-06-01');
  const accounts = { geeksforgeeks: { syncedAt: timestamp, snapshot: { score: 0, scoreHistory: [{ timestamp, rating: 0 }] } }, codechef: { syncedAt: timestamp, snapshot: { rating: 1200, ratings: [] } } };
  assert.deepEqual(ratingSeries(accounts, 2026, 'UTC').map(s => s.id), ['geeksforgeeks', 'codechef']);
  const score = ratingSeries(accounts, 2026, 'UTC', 'geeksforgeeks')[0];
  assert.equal(score.score, true); assert.equal(score.points[0].rating, 0);
  assert.equal(ratingSeries(accounts, 2026, 'UTC', 'codechef')[0].points.length, 1, 'Only a real synced observation is used');
});

test('all platforms keep GFG scores when other connected platforms have no ratings', () => {
  const timestamp = Date.parse('2026-10-09');
  const accounts = {
    leetcode: { syncedAt: timestamp, snapshot: { ratings: [] } },
    geeksforgeeks: { syncedAt: timestamp, snapshot: { score: 9, scoreHistory: [{ timestamp, rating: 9 }] } },
  };
  assert.deepEqual(ratingSeries(accounts, 2026, 'UTC'), ratingSeries(accounts, 2026, 'UTC', 'geeksforgeeks'));
  assert.equal(ratingSeries(accounts, 2026, 'UTC')[0].points[0].rating, 9);
  assert.deepEqual(ratingSeries(accounts, 2025, 'UTC'), []);
  assert.deepEqual(ratingSeries(accounts, 2026, 'UTC', 'leetcode'), []);
});

test('all platforms retain a synced GFG score without a score history', () => {
  const timestamp = Date.parse('2026-10-09');
  const accounts = { geeksforgeeks: { syncedAt: timestamp, snapshot: { score: 0 } } };
  assert.deepEqual(ratingSeries(accounts, 2026, 'UTC'), [{ id: 'geeksforgeeks', score: true, points: [{ timestamp, rating: 0, title: 'Synced score' }] }]);
  assert.deepEqual(ratingSeries({}, 2026, 'UTC'), []);
});
