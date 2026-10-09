import test from 'node:test';
import assert from 'node:assert/strict';
import { registerBadge, nextBadgeReset } from '../tracker/badge.mjs';
import { STORAGE_KEY, emptyState } from '../tracker/core.mjs';

const event = () => ({ listeners: [], addListener(fn) { this.listeners.push(fn); } });
function harness() {
  let now = Date.parse('2026-10-09T18:29:00Z');
  const state = emptyState();
  state.settings.timeZone = 'Asia/Kolkata';
  state.settings.autoSync = false;
  const badges = [], titles = [], alarms = new Map();
  const api = {
    action: { setBadgeText: async value => badges.push(value.text), setBadgeBackgroundColor: async () => {}, setTitle: async value => titles.push(value.title) },
    storage: { local: { get: async () => ({ [STORAGE_KEY]: structuredClone(state) }) }, onChanged: event() },
    alarms: { create: async (name, options) => alarms.set(name, options), onAlarm: event() },
    runtime: { onInstalled: event(), onStartup: event() },
  };
  const refresh = registerBadge(api, () => now);
  return { state, api, badges, titles, alarms, refresh, setNow: value => { now = Date.parse(value); } };
}

test('icon badge counts distinct accepted questions across platforms and updates with storage', async () => {
  const h = harness();
  await h.refresh();
  assert.equal(h.badges.at(-1), '0');
  const record = { key: 'leetcode:two-sum', timestamp: Date.parse('2026-10-09T18:00:00Z') };
  h.state.accounts.leetcode = { snapshot: { recent: [record, record, { key: 'leetcode:old', timestamp: Date.parse('2026-10-08T18:00:00Z') }] } };
  h.state.accounts.codeforces = { snapshot: { recent: [{ key: 'codeforces:1A', day: '2026-10-09' }] } };
  h.api.storage.onChanged.listeners[0]({ [STORAGE_KEY]: {} }, 'local');
  await h.refresh();
  assert.equal(h.badges.at(-1), '2');
  assert.match(h.titles.at(-1), /2 problems done today/);
  delete h.state.accounts.codeforces;
  await h.refresh();
  assert.equal(h.badges.at(-1), '1');
  assert.match(h.titles.at(-1), /1 problem done today/);
});

test('badge resets at local midnight with auto sync disabled and reschedules on timezone changes', async () => {
  const h = harness();
  h.state.accounts.leetcode = { snapshot: { recent: [{ key: 'leetcode:two-sum', timestamp: Date.parse('2026-10-09T18:00:00Z') }] } };
  await h.refresh();
  assert.equal(h.badges.at(-1), '1');
  assert.equal(h.alarms.get('crossdsa-badge-midnight').when, Date.parse('2026-10-09T18:30:00Z'));
  h.setNow('2026-10-09T18:30:00Z');
  h.api.alarms.onAlarm.listeners[0]({ name: 'crossdsa-badge-midnight' });
  await h.refresh();
  assert.equal(h.badges.at(-1), '0');
  h.state.settings.timeZone = 'UTC';
  await h.refresh();
  assert.equal(h.badges.at(-1), '1');
  assert.equal(h.alarms.get('crossdsa-badge-midnight').when, Date.parse('2026-10-10T00:00:00Z'));
});

test('badge midnight scheduling respects short and long daylight-saving days', () => {
  for (const [now, expected] of [
    ['2026-03-08T05:00:00Z', '2026-03-09T04:00:00Z'],
    ['2026-11-01T04:00:00Z', '2026-11-02T05:00:00Z'],
  ]) assert.equal(nextBadgeReset(Date.parse(now), 'America/New_York'), Date.parse(expected));
});
