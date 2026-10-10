import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTEST_KEY, REFRESH_ALARM, normalizeContests, normalizeCodeforcesContests, activeContests, countdown, reminderPlan, reminderName, safeContestUrl } from '../tracker/contests.mjs';
import { STORAGE_KEY, emptyState } from '../tracker/core.mjs';

const start = Date.now() + 2 * 86400000;
const raw = { title: 'Biweekly Contest 193', titleSlug: 'biweekly-contest-193', startTime: start / 1000, duration: 5400 };
const payload = { data: { topTwoContests: [raw] } };
const [contest] = normalizeContests(payload);
const cfRaw = { id: 2276, name: 'Educational Codeforces Round 195 (Rated for Div. 2)', phase: 'BEFORE', startTimeSeconds: start / 1000 - 7200, durationSeconds: 7200 };
function event() { return { listeners: [], addListener(fn) { this.listeners.push(fn); } }; }
async function harness(codeforcesItems = []) {
  const state = emptyState(); state.accounts = { leetcode: {}, codeforces: {} }; state.settings.contestReminders = true;
  const storage = { [STORAGE_KEY]: state }, alarms = new Map(), notifications = [];
  let allowed = true, offline = false, requests = 0;
  const sourceAllowed = {}, sourceOffline = {}, opened = [];
  globalThis.chrome = {
    storage: { local: { get: async key => ({ [key]: structuredClone(storage[key]) }), set: async data => Object.assign(storage, structuredClone(data)) }, onChanged: event() },
    alarms: { getAll: async () => [...alarms].map(([name, value]) => ({ name, ...value })), get: async name => alarms.get(name), create: async (name, value) => alarms.set(name, value), clear: async name => alarms.delete(name), onAlarm: event() },
    permissions: { contains: async options => allowed && (!options.origins || options.origins.every(origin => sourceAllowed[origin.includes('codeforces') ? 'codeforces' : 'leetcode'] !== false)), onRemoved: event(), onAdded: event() },
    notifications: { create: async (id, value) => notifications.push({ id, ...value }), onClicked: event(), clear: async () => {} },
    runtime: { id: 'test', getURL: path => `chrome-extension://test/${path}`, onMessage: event(), onStartup: event(), onInstalled: event() },
    tabs: { create: async options => opened.push(options.url) },
  };
  globalThis.fetch = async url => { const platform = url.includes('codeforces') ? 'codeforces' : 'leetcode'; if (platform === 'leetcode') requests++; if (offline || sourceOffline[platform]) throw new Error('Offline'); return { ok: true, json: async () => platform === 'codeforces' ? { status:'OK', result:codeforcesItems } : payload }; };
  const service = await import(`../tracker/contest-service.mjs?test=${crypto.randomUUID()}`);
  return { service, storage, alarms, notifications, opened, setAllowed: value => { allowed = value; }, setOffline: value => { offline = value; }, requests: () => requests,
    setSourceAllowed: (platform, value) => { sourceAllowed[platform] = value; }, setSourceOffline: (platform, value) => { sourceOffline[platform] = value; } };
}

test('disconnecting platforms stops schedule fetches and blocks cached reminder delivery', async () => {
  const h = await harness();
  await h.service.refreshContests();
  const before = h.requests();
  h.storage[STORAGE_KEY].accounts = {};
  const name = reminderName(contest, 60);
  await h.service.deliverReminder(name, contest.start - 60 * 60000);
  assert.equal(h.notifications.length, 0);
  await h.service.refreshContests();
  assert.equal(h.requests(), before);
  assert.deepEqual(h.storage[CONTEST_KEY].items, []);
  assert.equal([...h.alarms.keys()].some(name => name.startsWith('crossdsa-contest:')), false);
  assert.ok(h.storage[CONTEST_KEY].sources.leetcode.items.length, 'Saved schedules remain cached');
});

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
test('popup visibility leaves schedule and reminders active; disabling reminders clears only reminder alarms', async () => {
  const h = await harness(); await h.service.refreshContests();
  assert.equal(h.storage[CONTEST_KEY].items.length, 1); assert.equal(h.alarms.size, 3);
  await h.service.refreshContests(); assert.equal(h.requests(), 1);
  h.alarms.set('unrelated-alarm', {}); h.storage[STORAGE_KEY].settings.contestsEnabled = false;
  await h.service.refreshContests(); assert.equal(h.alarms.size, 4);
  h.storage[STORAGE_KEY].settings.contestReminders = false;
  await h.service.refreshContests(); assert.deepEqual([...h.alarms.keys()], [REFRESH_ALARM, 'unrelated-alarm']);
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
  h.storage[CONTEST_KEY] = { items: [imminent], sources:{leetcode:{items:[imminent],updatedAt:now,attemptedAt:now}}, updatedAt: now, sent: {} };
  h.alarms.set(name, alarm);
  await h.service.refreshContests();
  assert.equal(h.alarms.get(name), alarm);
});
test('offline refresh retains saved contests, throttles retries, and cancels reminders', async () => {
  const h = await harness(); await h.service.refreshContests();
  for (const source of Object.values(h.storage[CONTEST_KEY].sources)) source.attemptedAt -= 1800001;
  h.setOffline(true);
  await h.service.refreshContests(); assert.equal(h.storage[CONTEST_KEY].items.length, 1);
  assert.ok(h.storage[CONTEST_KEY].error); assert.deepEqual([...h.alarms.keys()], [REFRESH_ALARM]);
  await h.service.refreshContests(); assert.equal(h.requests(), 2);
});
test('delivery persists deduplication across service restarts and rejects late/disabled reminders', async () => {
  const h = await harness(); await h.service.refreshContests();
  const due = contest.start - 3600000, name = reminderName(contest, 60);
  h.storage[CONTEST_KEY].updatedAt = due;
  h.storage[CONTEST_KEY].sources.leetcode.updatedAt = due;
  h.storage[STORAGE_KEY].settings.contestsEnabled = false;
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

test('full LeetCode listing and Codeforces entries normalize without a two-contest limit', () => {
  const items = normalizeContests({ data: { allContests: [raw, { ...raw, titleSlug:'weekly-contest-524' }, { ...raw, titleSlug:'weekly-contest-525' }] } });
  assert.equal(items.length, 3); assert.ok(items.every(item => item.platform === 'leetcode'));
  const cf = normalizeCodeforcesContests({ status:'OK', result:[cfRaw, cfRaw, { ...cfRaw, id: -1 }, { ...cfRaw, id:5, startTimeSeconds:null }] });
  assert.equal(cf.length, 1); assert.equal(cf[0].id, 'codeforces-2276'); assert.equal(cf[0].start, start-7200000);
  assert.equal(cf[0].url, 'https://codeforces.com/contest/2276');
  assert.throws(() => normalizeCodeforcesContests({ status:'FAILED', result:[] }));
  assert.throws(() => normalizeCodeforcesContests({ status:'OK', result:[{ ...cfRaw, startTimeSeconds:1e100 }] }));
  assert.equal(safeContestUrl({ platform:'codeforces', url:'https://codeforces.com.evil.test/contest/2276' }), false);
});

test('sources merge chronologically and a failing Codeforces refresh leaves LeetCode reminders active', async () => {
  const h = await harness([cfRaw]); await h.service.refreshContests();
  const cache = h.storage[CONTEST_KEY];
  assert.deepEqual(cache.items.map(item => item.platform), ['codeforces', 'leetcode']);
  assert.equal(h.alarms.get(REFRESH_ALARM).periodInMinutes, 30); assert.equal(h.alarms.size, 5);
  cache.sources.codeforces.attemptedAt -= 1800001; h.setSourceOffline('codeforces', true);
  await h.service.refreshContests();
  const updated = h.storage[CONTEST_KEY]; assert.equal(updated.items.length, 2);
  assert.ok(updated.sources.codeforces.error); assert.equal(updated.sources.leetcode.error, null);
  assert.equal(h.requests(), 1); assert.equal(h.alarms.size, 3);
  assert.ok(reminderPlan(updated).every(item => item.contest.platform === 'leetcode'));
});

test('permissions and reminder delivery are independent per source; Codeforces clicks open its official contest', async () => {
  const h = await harness([cfRaw]); h.setSourceAllowed('leetcode', false);
  await h.service.refreshContests();
  const cache = h.storage[CONTEST_KEY], cf = cache.items[0];
  assert.equal(h.requests(), 0); assert.equal(cache.needsAccess, false); assert.equal(cache.sources.leetcode.needsAccess, true);
  assert.equal(cache.items.length, 1); assert.equal(h.alarms.size, 3);
  const due = cf.start - 3600000, name = reminderName(cf, 60);
  cache.sources.codeforces.updatedAt = due;
  await h.service.deliverReminder(name, due);
  assert.equal(h.notifications.length, 1); assert.match(h.notifications[0].message, /Codeforces/);
  h.service.registerContests(); await h.service.refreshContests();
  chrome.notifications.onClicked.listeners[0](name);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.opened[0], 'https://codeforces.com/contest/2276');
  h.setSourceAllowed('codeforces', false); await h.service.refreshContests();
  assert.equal(h.alarms.size, 0);
});

test('legacy cache migration preserves reminder deduplication and recent history', async () => {
  const h = await harness();
  const history = { ...contest, id:'weekly-contest-500', start:Date.now()-3*86400000, end:Date.now()-3*86400000+5400000, url:'https://leetcode.com/contest/weekly-contest-500/' };
  const name = reminderName(contest, 60);
  h.storage[CONTEST_KEY] = { items:[contest, history], updatedAt:Date.now(), sent:{ [name]:Date.now() } };
  await h.service.refreshContests();
  const cache = h.storage[CONTEST_KEY]; assert.equal(cache.items.length, 2); assert.ok(cache.sent[name]);
  assert.equal(cache.items.find(item => item.id === contest.id).id, contest.id);
  assert.ok(!h.alarms.has(name));
  cache.sources.leetcode.attemptedAt -= 1800001;
  globalThis.fetch = async url => ({ ok:true, json:async()=>url.includes('codeforces') ? {status:'OK',result:[]} : {data:{allContests:[]}} });
  await h.service.refreshContests();
  assert.deepEqual(h.storage[CONTEST_KEY].items.map(item => item.id), ['weekly-contest-500']);
});

test('LeetCode requests the full listing and falls back only for a removed schema field', async () => {
  const h = await harness(), queries = [];
  globalThis.fetch = async (url, options) => {
    if (url.includes('codeforces')) return {ok:true,json:async()=>({status:'OK',result:[]})};
    const query = JSON.parse(options.body).query; queries.push(query);
    return {ok:true,json:async()=>query.includes('allContests') ? {errors:[{message:'Cannot query field "allContests" on type "Query".'}]} : payload};
  };
  await h.service.refreshContests();
  assert.match(queries[0], /allContests/); assert.match(queries[1], /topTwoContests/);
  assert.equal(h.storage[CONTEST_KEY].sources.leetcode.limited, true);
  h.storage[CONTEST_KEY].sources.leetcode.attemptedAt -= 1800001;
  globalThis.fetch = async () => ({ok:true,json:async()=>({errors:[{message:'Temporary upstream failure'}]})});
  await h.service.refreshContests(); assert.ok(h.storage[CONTEST_KEY].sources.leetcode.error);
});
