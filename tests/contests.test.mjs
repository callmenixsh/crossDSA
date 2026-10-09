import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTEST_KEY, REFRESH_ALARM, normalizeContests, activeContests, countdown, reminderPlan, reminderName } from '../tracker/contests.mjs';
import { STORAGE_KEY, emptyState } from '../tracker/core.mjs';

const start = Date.now() + 2 * 86400000;
const raw = { title: 'Biweekly Contest 193', titleSlug: 'biweekly-contest-193', startTime: start / 1000, duration: 5400 };
const payload = { data: { topTwoContests: [raw] } };
const [contest] = normalizeContests(payload);
function event() { return { listeners: [], addListener(fn) { this.listeners.push(fn); } }; }
async function harness() {
  const state = emptyState(); state.settings.contestReminders = true;
  const storage = { [STORAGE_KEY]: state }, alarms = new Map(), notifications = [];
  let allowed = true, offline = false, requests = 0;
  globalThis.chrome = {
    storage: { local: { get: async key => ({ [key]: structuredClone(storage[key]) }), set: async data => Object.assign(storage, structuredClone(data)) }, onChanged: event() },
    alarms: { getAll: async () => [...alarms].map(([name, value]) => ({ name, ...value })), get: async name => alarms.get(name), create: async (name, value) => alarms.set(name, value), clear: async name => alarms.delete(name), onAlarm: event() },
    permissions: { contains: async () => allowed, onRemoved: event(), onAdded: event() },
    notifications: { create: async (id, value) => notifications.push({ id, ...value }), onClicked: event(), clear: async () => {} },
    runtime: { id: 'test', getURL: path => `chrome-extension://test/${path}`, onMessage: event(), onStartup: event(), onInstalled: event() },
    tabs: { create: async () => {} },
  };
  globalThis.fetch = async () => { requests++; if (offline) throw new Error('Offline'); return { ok: true, json: async () => payload }; };
  const service = await import(`../tracker/contest-service.mjs?test=${crypto.randomUUID()}`);
  return { service, storage, alarms, notifications, setAllowed: value => { allowed = value; }, setOffline: value => { offline = value; }, requests: () => requests };
}

test('normalizes official times, deduplicates and rejects unsafe slugs and malformed responses', () => {
  assert.equal(contest.start, start); assert.equal(contest.end, start + 5400000);
  assert.equal(contest.url, 'https://leetcode.com/contest/biweekly-contest-193/');
  assert.equal(normalizeContests({ data: { topTwoContests: [raw, raw, { ...raw, titleSlug: '//evil.example' }] } }).length, 1);
  assert.throws(() => normalizeContests({ errors: [{}] }));
  assert.throws(() => normalizeContests({ data: { topTwoContests: [{ ...raw, duration: -1 }] } }));
});
test('countdown handles day, hour, minute, live and end boundaries', () => {
  assert.equal(countdown(contest, start - 27 * 3600000), 'in 1d 3h');
  assert.equal(countdown(contest, start - 61 * 60000), 'in 1h 1m');
  assert.equal(countdown(contest, start - 1), 'in 1m');
  assert.equal(countdown(contest, start), 'Live');
  assert.equal(countdown(contest, contest.end), 'Ended');
  assert.equal(activeContests([contest], contest.end).length, 0);
});
test('reminder plans exclude past, delivered and stale entries', () => {
  const cache = { items: [contest], updatedAt: start - 2 * 3600000 };
  assert.equal(reminderPlan(cache, cache.updatedAt).length, 2);
  assert.equal(reminderPlan({ ...cache, sent: { [reminderName(contest, 60)]: true } }, cache.updatedAt).length, 1);
  assert.equal(reminderPlan(cache, start - 5 * 60000).length, 0);
  assert.equal(reminderPlan({ ...cache, error: 'Offline' }, cache.updatedAt).length, 0);
  assert.equal(reminderPlan({ ...cache, updatedAt: cache.updatedAt - 7 * 3600000 }, cache.updatedAt).length, 0);
});
test('refresh caches live schedule and disabling clears only contest alarms', async () => {
  const h = await harness(); await h.service.refreshContests();
  assert.equal(h.storage[CONTEST_KEY].items.length, 1); assert.equal(h.alarms.size, 3);
  await h.service.refreshContests(); assert.equal(h.requests(), 1);
  h.alarms.set('unrelated-alarm', {}); h.storage[STORAGE_KEY].settings.contestsEnabled = false;
  await h.service.refreshContests(); assert.deepEqual([...h.alarms.keys()], ['unrelated-alarm']);
});
test('denied access makes no request, and revoked access cancels reminders', async () => {
  const h = await harness(); h.setAllowed(false); await h.service.refreshContests();
  assert.equal(h.requests(), 0); assert.equal(h.storage[CONTEST_KEY].needsAccess, true);
  h.setAllowed(true); await h.service.refreshContests(); assert.equal(h.alarms.size, 3);
  h.setAllowed(false); await h.service.refreshContests(); assert.equal(h.alarms.size, 0);
});

test('refresh preserves a due reminder instead of cancelling it before dispatch', async () => {
  const h = await harness(), now = Date.now();
  const imminent = { ...contest, start: now + 3600000, end: now + 9000000 };
  const name = reminderName(imminent, 60), alarm = { when: now };
  h.storage[CONTEST_KEY] = { items: [imminent], updatedAt: now, attemptedAt: now, sent: {} };
  h.alarms.set(name, alarm);
  await h.service.refreshContests();
  assert.equal(h.alarms.get(name), alarm);
});
test('offline refresh retains saved contests, throttles retries, and cancels reminders', async () => {
  const h = await harness(); await h.service.refreshContests();
  h.storage[CONTEST_KEY].attemptedAt -= 3600001; h.setOffline(true);
  await h.service.refreshContests(); assert.equal(h.storage[CONTEST_KEY].items.length, 1);
  assert.ok(h.storage[CONTEST_KEY].error); assert.deepEqual([...h.alarms.keys()], [REFRESH_ALARM]);
  await h.service.refreshContests(); assert.equal(h.requests(), 2);
});
test('delivery persists deduplication across service restarts and rejects late/disabled reminders', async () => {
  const h = await harness(); await h.service.refreshContests();
  const due = contest.start - 3600000, name = reminderName(contest, 60);
  h.storage[CONTEST_KEY].updatedAt = due;
  await h.service.deliverReminder(name, due); assert.equal(h.notifications.length, 1);
  const restarted = await import(`../tracker/contest-service.mjs?test=${crypto.randomUUID()}`);
  await restarted.deliverReminder(name, due); assert.equal(h.notifications.length, 1);
  const ten = reminderName(contest, 10);
  await h.service.deliverReminder(ten, contest.start - 3 * 60000); assert.equal(h.notifications.length, 1);
  h.storage[STORAGE_KEY].settings.contestReminders = false;
  await h.service.deliverReminder(ten, contest.start - 10 * 60000); assert.equal(h.notifications.length, 1);
});

test('worker starts without optional notifications API and attaches clicks after permission grant', async () => {
  const h = await harness(); h.setAllowed(false);
  const notifications = chrome.notifications; delete chrome.notifications;
  assert.doesNotThrow(() => h.service.registerContests());
  await h.service.refreshContests();
  assert.equal(chrome.runtime.onMessage.listeners.length, 1);
  let response;
  chrome.runtime.onMessage.listeners[0]({ action: 'contests:refresh' }, { id: 'test', url: 'https://leetcode.com/' }, value => { response = value; });
  assert.equal(response.ok, false);
  chrome.notifications = notifications;
  chrome.permissions.onAdded.listeners[0]();
  await h.service.refreshContests();
  assert.equal(notifications.onClicked.listeners.length, 1);
});
