import test from 'node:test';
import assert from 'node:assert/strict';
import { monthDays } from '../tracker/contest-calendar.mjs';
import { dateKey } from '../tracker/core.mjs';

test('calendar includes complete Sunday-first weeks across month and year boundaries', () => {
  for (const value of ['2026-10-01', '2026-02-01', '2028-02-01', '2026-12-01', '2027-01-01']) {
    const month = new Date(`${value}T00:00:00Z`), days = monthDays(month);
    assert.equal(days[0].getUTCDay(), 0);
    assert.equal(days.at(-1).getUTCDay(), 6);
    assert.equal(days.length % 7, 0);
    assert.equal(days.filter(day => day.getUTCMonth() === month.getUTCMonth()).length,
      new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0)).getUTCDate());
    days.slice(1).forEach((day, i) => assert.equal(day - days[i], 86400000));
  }
});

test('contests near midnight land on the configured timezone date', () => {
  const timestamp = Date.parse('2026-10-10T20:30:00Z');
  assert.equal(dateKey(timestamp, 'Asia/Kolkata'), '2026-10-11');
  assert.equal(dateKey(timestamp, 'America/Los_Angeles'), '2026-10-10');
});
