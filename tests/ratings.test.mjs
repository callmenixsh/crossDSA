import test from 'node:test';
import assert from 'node:assert/strict';
import { ratingSeries } from '../tracker/ratings.mjs';

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

test('coding score is separate from ratings and zero scores are retained', () => {
  const timestamp = Date.parse('2026-06-01');
  const accounts = { geeksforgeeks: { syncedAt: timestamp, snapshot: { score: 0, scoreHistory: [{ timestamp, rating: 0 }] } }, codechef: { syncedAt: timestamp, snapshot: { rating: 1200, ratings: [] } } };
  assert.deepEqual(ratingSeries(accounts, 2026, 'UTC').map(s => s.id), ['codechef']);
  const score = ratingSeries(accounts, 2026, 'UTC', 'geeksforgeeks')[0];
  assert.equal(score.score, true); assert.equal(score.points[0].rating, 0);
  assert.equal(ratingSeries(accounts, 2026, 'UTC', 'codechef')[0].points.length, 1, 'Only a real synced observation is used');
});
