import test from 'node:test';
import assert from 'node:assert/strict';
import { doneQuestions, questionIsDone, acceptedToday, normalizeState } from '../tracker/core.mjs';

const records = [
  { id: '1', key: 'leetcode:two-sum', platform: 'leetcode', title: 'Two Sum', timestamp: Date.parse('2026-10-08T12:00:00Z') },
  { id: '2', key: 'leetcode:two-sum', platform: 'leetcode', title: 'Two Sum', timestamp: Date.parse('2026-10-09T20:00:00Z'), pending: true },
  { id: '3', key: 'codechef:two-sum', platform: 'codechef', title: 'Two Sum', timestamp: Date.parse('2026-10-09T12:00:00Z') },
  { id: '4', key: 'geeksforgeeks:arrays', platform: 'geeksforgeeks', title: 'Array Search', timestamp: Date.parse('2026-10-07T12:00:00Z'), day: '2026-10-07' },
];
const accounts = { sample: { snapshot: { recent: records } }, empty: {} };

test('done questions keep the latest acceptance per platform/question', () => {
  const result = doneQuestions(accounts);
  assert.equal(result.total, 3);
  assert.deepEqual(result.records.map(r => r.id), ['2', '3', '4']);
  assert.equal(result.records[0].pending, true);
  assert.deepEqual(doneQuestions(accounts, { sort: 'oldest' }).records.map(r => r.id), ['4', '3', '2']);
});

test('done question filters combine title, platform and inclusive local dates', () => {
  assert.deepEqual(doneQuestions(accounts, { query: 'SUM two', platform: 'leetcode', from: '2026-10-10', to: '2026-10-10', timeZone: 'Asia/Kolkata' }).records.map(r => r.id), ['2']);
  assert.equal(doneQuestions(accounts, { to: '2026-10-08' }).records.length, 1, 'Dates refer to latest recorded solve');
  assert.equal(doneQuestions(accounts, { from: '2026-10-10', to: '2026-10-01' }).records.length, 0);
  assert.equal(doneQuestions(accounts, { query: 'missing' }).records.length, 0);
  assert.equal(doneQuestions({}).total, 0);
});

test('legacy manual marks cannot create or hide automatically detected solves', () => {
  const connected = { leetcode: { snapshot: { recent: records.slice(0, 2) } } };
  const workspace = {
    'leetcode:two-sum': { done: false },
    'leetcode:manual': { key: 'leetcode:manual', platform: 'leetcode', title: 'Manual Question', done: true, doneAt: Date.parse('2026-10-10T12:00:00Z') },
    'codechef:offline': { key: 'codechef:offline', platform: 'codechef', title: 'Disconnected', done: true, doneAt: Date.now() },
  };
  const state = normalizeState({ version: 1, accounts: connected, workspace });
  assert.equal(questionIsDone(state.accounts, 'leetcode:two-sum'), true);
  assert.equal(questionIsDone(state.accounts, 'leetcode:manual'), false);
  const result = doneQuestions(state.accounts);
  assert.equal(result.total, 1); assert.equal(result.records[0].key, 'leetcode:two-sum');
  assert.equal(acceptedToday(connected, '2026-10-10', 'UTC'), 0, 'Manual done status never creates accepted activity');
});
