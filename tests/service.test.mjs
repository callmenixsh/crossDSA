import test from 'node:test';
import assert from 'node:assert/strict';
import { STORAGE_KEY, emptyState } from '../tracker/core.mjs';

function event() { return { listeners: [], addListener(fn) { this.listeners.push(fn); } }; }
async function harness(fetcher = async () => { throw new Error('Offline'); }) {
  const storage = {};
  let allowed = true;
  const scheduled = new Map();
  globalThis.chrome = {
    storage: { local: { get: async key => ({ [key]: structuredClone(storage[key]) }), set: async data => { Object.assign(storage, structuredClone(data)); } } },
    runtime: { id: 'test-extension', getURL: path => `chrome-extension://test-extension/${path}`, onMessage: event(), onInstalled: event(), onStartup: event() },
    alarms: { clear: async name => scheduled.delete(name), get: async name => scheduled.get(name), create: async (name, options) => { scheduled.set(name, options); }, onAlarm: event() },
    permissions: { contains: async () => allowed },
    tabs: { query: async () => [] },
  };
  globalThis.fetch = fetcher;
  const service = await import(`../tracker/service.mjs?test=${crypto.randomUUID()}`);
  service.registerTracker();
  await new Promise(resolve => setImmediate(resolve));
  const listener = chrome.runtime.onMessage.listeners[0];
  const send = (action, data = {}, sender = { id: 'test-extension', url: 'chrome-extension://test-extension/dashboard.html' }) => new Promise(resolve => {
    const result = listener({ action: `tracker:${action}`, ...data }, sender, resolve);
    if (result !== true && result === undefined) resolve(undefined);
  });
  return { storage, send, service, scheduled, setAllowed(value) { allowed = value; } };
}
const settings = { dailyGoal: 3, timeZone: 'Asia/Kolkata', autoSync: false };
const entry = { key: 'leetcode:two-sum', platform: 'leetcode', title: 'Two Sum', url: 'https://leetcode.com/problems/two-sum/', topics: ['Array'], difficulty: 'Easy', listIds: ['saved'] };
const response = value => ({ ok: true, json: async () => value });
const leetcodeData = total => ({ data: { matchedUser: { profile: {}, submitStatsGlobal: { acSubmissionNum: [{ difficulty: 'All', count: total }] }, badges: [], userCalendar: { activeYears: [], submissionCalendar: '{}' } }, recentAcSubmissionList: [], userContestRanking: null, userContestRankingHistory: [] } });

test('browser accepts update immediately, deduplicate, and become verified on sync', async () => {
  const timestamp = Math.floor(Date.now() / 1000) * 1000;
  const data = leetcodeData(1);
  data.data.recentAcSubmissionList = [{ id: '123', title: 'Two Sum', titleSlug: 'two-sum', timestamp: timestamp / 1000 }];
  const h = await harness(async () => response(data));
  const initial = emptyState(); initial.settings.autoSync = false;
  initial.accounts.leetcode = { handle: 'sample', generation: 'test', syncedAt: timestamp - 10000, snapshot: { totalSolved: 0, calendar: {}, recent: [] } };
  h.storage[STORAGE_KEY] = initial;
  const sender = { id: 'test-extension', tab: { id: 1 }, url: 'https://leetcode.com/problems/two-sum/' };
  const payload = { platform: 'leetcode', handle: 'sample', generation: 'test', submission: { id: '123', title: 'Two Sum', slug: 'two-sum', timestamp } };
  assert.equal((await h.send('accepted', payload, sender)).ok, true);
  assert.equal((await h.send('accepted', payload, sender)).ok, true);
  let records = h.storage[STORAGE_KEY].accounts.leetcode.snapshot.recent;
  assert.equal(records.length, 1); assert.equal(records[0].pending, true);
  assert.ok(h.scheduled.has('crossdsa-verify:leetcode'));
  await h.send('sync', { platform: 'leetcode' });
  records = h.storage[STORAGE_KEY].accounts.leetcode.snapshot.recent;
  assert.equal(records.length, 1); assert.equal(records[0].pending, undefined);
});

test('browser accepts reject foreign senders, account changes, stale times and wrong questions', async () => {
  const h = await harness(); const initial = emptyState();
  initial.accounts.leetcode = { handle: 'sample', generation: 'test', snapshot: { totalSolved: 0, recent: [] } };
  h.storage[STORAGE_KEY] = initial;
  const sender = { id: 'test-extension', tab: { id: 1 }, url: 'https://leetcode.com/problems/two-sum/' };
  const payload = { platform: 'leetcode', handle: 'sample', generation: 'test', submission: { id: '123', title: 'Two Sum', slug: 'two-sum', timestamp: Date.now() } };
  for (const invalid of [{ ...payload, handle: 'other' }, { ...payload, generation: 'old' }, { ...payload, submission: { ...payload.submission, slug: 'three-sum' } }, { ...payload, submission: { ...payload.submission, timestamp: 1 } }]) {
    assert.equal((await h.send('accepted', invalid, sender)).ok, false);
  }
  assert.equal((await h.send('accepted', payload, { ...sender, id: 'foreign' })).ok, false);
  assert.equal(h.storage[STORAGE_KEY].accounts.leetcode.snapshot.recent.length, 0);
});

test('failed verification retains browser-observed accepts', async () => {
  const h = await harness(); const initial = emptyState();
  initial.accounts.leetcode = { handle: 'sample', generation: 'test', snapshot: { totalSolved: 0, recent: [] } };
  h.storage[STORAGE_KEY] = initial;
  await h.send('accepted', { platform: 'leetcode', handle: 'sample', generation: 'test', submission: { id: '123', title: 'Two Sum', slug: 'two-sum', timestamp: Date.now() } }, { id: 'test-extension', tab: { id: 1 }, url: 'https://leetcode.com/problems/two-sum/' });
  await h.send('sync', { platform: 'leetcode' });
  assert.equal(h.storage[STORAGE_KEY].accounts.leetcode.snapshot.recent[0].pending, true);
});

test('service restricts tracker messages to the extension dashboard', async () => {
  const h = await harness();
  const result = await h.send('settings', { settings }, { id: 'test-extension', url: 'https://leetcode.com/problems/two-sum', tab: { id: 1 } });
  assert.equal(result.ok, false); assert.match(result.error, /Dashboard/);
});

test('question star and done patches preserve custom lists, notes and each other', async () => {
  const h = await harness();
  const initial = emptyState();
  initial.lists.custom = { id: 'custom', name: 'Custom' };
  initial.workspace[entry.key] = { ...entry, listIds: ['custom'], notes: 'Keep this note' };
  h.storage[STORAGE_KEY] = initial;
  await Promise.all([
    h.send('question-state', { entry, patch: { starred: true } }),
    h.send('question-state', { entry, patch: { done: true } }),
  ]);
  let saved = h.storage[STORAGE_KEY].workspace[entry.key];
  assert.deepEqual(saved.listIds, ['custom', 'saved']); assert.equal(saved.done, true);
  assert.equal(saved.notes, 'Keep this note'); assert.ok(saved.doneAt);
  const doneAt = saved.doneAt;
  await h.send('workspace', { entry: { ...entry, listIds: ['saved', 'custom'] } });
  assert.equal(h.storage[STORAGE_KEY].workspace[entry.key].doneAt, doneAt);
  await h.send('question-state', { entry, patch: { starred: false } });
  await h.send('question-state', { entry, patch: { done: false } });
  saved = h.storage[STORAGE_KEY].workspace[entry.key];
  assert.deepEqual(saved.listIds, ['custom']); assert.equal(saved.done, false); assert.equal(saved.doneAt, null);
  assert.equal(saved.notes, 'Keep this note');
});

test('question state rejects invalid patches and website or popup mutations', async () => {
  const h = await harness();
  for (const patch of [{ done: 'yes' }, { unknown: true }, { starred: true, done: true }, {}]) {
    assert.equal((await h.send('question-state', { entry, patch })).ok, false);
  }
  assert.equal((await h.send('question-state', { entry: { ...entry, key: 'wrong' }, patch: { done: true } })).ok, false);
  assert.equal((await h.send('question-state', { entry, patch: { done: true } }, { id: 'test-extension', url: 'chrome-extension://test-extension/popup.html' })).ok, false);
  assert.equal((await h.send('question-state', { entry, patch: { done: true } }, { id: 'test-extension', tab: { id: 1 }, url: entry.url })).ok, false);
});

test('custom list saves preserve current Starred status, including concurrent star changes', async () => {
  const h = await harness(); const initial = emptyState();
  initial.lists.custom = { id: 'custom', name: 'Custom' };
  initial.workspace[entry.key] = { ...entry, done: true, listIds: ['saved', 'custom'] };
  h.storage[STORAGE_KEY] = initial;
  const result = await h.send('workspace', { entry: { ...entry, listIds: [] }, customListsOnly: true });
  assert.deepEqual(result.state.workspace[entry.key].listIds, ['saved']);
  assert.equal(result.state.workspace[entry.key].done, true);
  assert.equal((await h.send('workspace', { entry, customListsOnly: true })).ok, false);
  await Promise.all([
    h.send('question-state', { entry, patch: { starred: false } }),
    h.send('workspace', { entry: { ...entry, listIds: ['custom'] }, customListsOnly: true }),
  ]);
  assert.deepEqual(h.storage[STORAGE_KEY].workspace[entry.key].listIds, ['custom']);
});

test('concurrent settings and practice saves preserve both changes', async () => {
  const h = await harness();
  const [a, b] = await Promise.all([h.send('settings', { settings }), h.send('workspace', { entry })]);
  assert.equal(a.ok, true); assert.equal(b.ok, true);
  assert.equal(h.storage[STORAGE_KEY].settings.dailyGoal, 3);
  assert.deepEqual(h.storage[STORAGE_KEY].workspace[entry.key].listIds, ['saved']);
});

test('invalid settings or workspace links do not overwrite stored data', async () => {
  const h = await harness();
  assert.equal((await h.send('settings', { settings: { ...settings, dailyGoal: -1 } })).ok, false);
  assert.equal((await h.send('settings', { settings: { ...settings, timeZone: 'Mars/Test' } })).ok, false);
  assert.equal((await h.send('workspace', { entry: { ...entry, url: 'javascript:alert(1)' } })).ok, false);
});

test('failed sync preserves the previous snapshot and last successful update', async () => {
  const h = await harness();
  const initial = emptyState(); initial.accounts.leetcode = { handle: 'sample', generation: 'original', status: 'ready', syncedAt: 123, snapshot: { totalSolved: 42, recent: [] } };
  h.storage[STORAGE_KEY] = initial;
  const result = await h.send('sync', { platform: 'leetcode' });
  assert.equal(result.ok, true); assert.equal(result.state.accounts.leetcode.status, 'error');
  assert.equal(result.state.accounts.leetcode.snapshot.totalSolved, 42); assert.equal(result.state.accounts.leetcode.syncedAt, 123);
  assert.match(result.state.accounts.leetcode.error, /Offline/);
});

test('missing site permissions preserve cached data without making requests', async () => {
  let requested = false;
  const h = await harness(async () => { requested = true; throw new Error('Unexpected request'); }); h.setAllowed(false);
  const initial = emptyState(); initial.accounts.leetcode = { handle: 'sample', generation: 'test', snapshot: { totalSolved: 7, recent: [] } }; h.storage[STORAGE_KEY] = initial;
  const result = await h.send('sync', { platform: 'leetcode' });
  assert.equal(requested, false); assert.equal(result.state.accounts.leetcode.snapshot.totalSolved, 7);
  assert.match(result.state.accounts.leetcode.error, /access is missing/);
});

test('new handles replace the old account snapshot instead of mixing histories', async () => {
  const h = await harness(async () => response(leetcodeData(8)));
  const initial = emptyState(); initial.accounts.leetcode = { handle: 'old', generation: 'old', snapshot: { totalSolved: 100, recent: [{ id: 'old-record', key: 'old' }] } }; h.storage[STORAGE_KEY] = initial;
  const result = await h.send('connect', { platform: 'leetcode', handle: 'new' });
  assert.equal(result.ok, true); assert.equal(result.state.accounts.leetcode.handle, 'new');
  assert.equal(result.state.accounts.leetcode.snapshot.totalSolved, 8); assert.deepEqual(result.state.accounts.leetcode.snapshot.recent, []);
});

test('an invalid new handle keeps the previous account and its successful snapshot', async () => {
  const h = await harness(async () => response({ data: { matchedUser: null } }));
  const initial = emptyState(); initial.accounts.leetcode = { handle: 'old', generation: 'old', syncedAt: 123, snapshot: { totalSolved: 100, recent: [] } }; h.storage[STORAGE_KEY] = initial;
  const result = await h.send('connect', { platform: 'leetcode', handle: 'missing' });
  assert.equal(result.state.accounts.leetcode.handle, 'old'); assert.equal(result.state.accounts.leetcode.snapshot.totalSolved, 100);
  assert.equal(result.state.accounts.leetcode.syncedAt, 123); assert.match(result.state.accounts.leetcode.error, /Kept the previous/);
});

test('a bookmark saved during a network sync survives the completed sync', async () => {
  let resolveRequest, started;
  const requestStarted = new Promise(resolve => { started = resolve; });
  const h = await harness(async () => { started(); return new Promise(resolve => { resolveRequest = () => resolve(response(leetcodeData(5))); }); });
  const initial = emptyState(); initial.accounts.leetcode = { handle: 'sample', generation: 'test', status: 'ready' }; h.storage[STORAGE_KEY] = initial;
  const sync = h.send('sync', { platform: 'leetcode' });
  await requestStarted;
  assert.equal((await h.send('workspace', { entry })).ok, true);
  resolveRequest(); await sync;
  assert.deepEqual(h.storage[STORAGE_KEY].workspace[entry.key].listIds, ['saved']);
  assert.equal(h.storage[STORAGE_KEY].accounts.leetcode.snapshot.totalSolved, 5);
});


test('named lists support multiple memberships and reject unknown lists', async () => {
  const h = await harness();
  const created = await h.send('list:create', { name: 'Arrays' });
  const id = Object.values(created.state.lists).find(list => list.name === 'Arrays').id;
  assert.equal((await h.send('list:create', { name: ' arrays ' })).ok, false);
  const saved = await h.send('workspace', { entry: { ...entry, listIds: ['saved', id] } });
  assert.deepEqual(saved.state.workspace[entry.key].listIds, ['saved', id]);
  assert.equal((await h.send('workspace', { entry: { ...entry, listIds: ['missing'] } })).ok, false);
  const removed = await h.send('workspace', { entry: { ...entry, listIds: [] } });
  assert.deepEqual(removed.state.workspace[entry.key].listIds, []);
});

test('list changes retain legacy notes and revision data', async () => {
  const h = await harness();
  const initial = emptyState(); initial.workspace[entry.key] = { ...entry, bookmarked: true, notes: 'Keep me', revisionDate: '2026-10-10' };
  h.storage[STORAGE_KEY] = initial;
  const result = await h.send('workspace', { entry: { ...entry, listIds: [] } });
  assert.equal(result.state.workspace[entry.key].notes, 'Keep me');
  assert.equal(result.state.workspace[entry.key].revisionDate, '2026-10-10');
});

test('submission refresh is scoped to the sending platform and obeys auto sync', async () => {
  let requests = 0;
  const h = await harness(async () => { requests++; return response(leetcodeData(9)); });
  const initial = emptyState(); initial.accounts.leetcode = { handle: 'sample', generation: 'test', status: 'ready' };
  h.storage[STORAGE_KEY] = initial;
  const sender = { id: 'test-extension', url: 'https://leetcode.com/problems/two-sum/submissions/123/', tab: { id: 1 } };
  assert.equal((await h.send('submission', { platform: 'codechef' }, sender)).ok, false);
  assert.equal((await h.send('submission', { platform: 'leetcode' }, { ...sender, url: 'https://evil.example/' })).ok, false);
  assert.equal((await h.send('submission', { platform: 'leetcode' }, sender)).ok, true);
  assert.equal(requests, 0, 'Submission event does not invent a solve or immediately fetch');
  assert.deepEqual(h.scheduled.get('crossdsa-submission:leetcode'), { delayInMinutes: 0.5 });
  assert.deepEqual(h.scheduled.get('crossdsa-submission:leetcode:retry'), { delayInMinutes: 2 });
  chrome.alarms.onAlarm.listeners[0]({ name: 'crossdsa-submission:leetcode' });
  for (let i = 0; i < 20 && h.storage[STORAGE_KEY].accounts.leetcode.status !== 'ready'; i++) await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.storage[STORAGE_KEY].accounts.leetcode.snapshot.totalSolved, 9);
  h.storage[STORAGE_KEY].settings.autoSync = false; h.scheduled.clear();
  await h.send('submission', { platform: 'leetcode' }, sender);
  assert.equal(h.scheduled.size, 0);
});


test('popup can read and refresh activity but cannot change settings or lists', async () => {
  const h = await harness();
  const sender = { id: 'test-extension', url: 'chrome-extension://test-extension/popup.html' };
  assert.equal((await h.send('get', {}, sender)).ok, true);
  assert.equal((await h.send('sync', {}, sender)).ok, true);
  assert.equal((await h.send('settings', { settings }, sender)).ok, false);
  assert.equal((await h.send('list:create', { name: 'Unexpected' }, sender)).ok, false);
});


test('background merges verified LeetCode tab accepts when public history is empty', async () => {
  const h = await harness(async () => response(leetcodeData(299)));
  const initial = emptyState(); initial.accounts.leetcode = { handle: 'sample', generation: 'test', status: 'ready' }; h.storage[STORAGE_KEY] = initial;
  chrome.tabs.query = async () => [{ id: 7 }];
  chrome.tabs.sendMessage = async (id, message) => {
    assert.equal(id, 7); assert.equal(message.handle, 'sample');
    return { ok: true, username: 'Sample', submissions: [{ id: 42, title: 'Two Sum', titleSlug: 'two-sum', timestamp: Math.floor(Date.now() / 1000) }] };
  };
  const result = await h.send('sync', { platform: 'leetcode' });
  assert.equal(result.state.accounts.leetcode.snapshot.recent[0].key, 'leetcode:two-sum');
  assert.equal(result.state.accounts.leetcode.snapshot.recentSource, 'signed-in');
  chrome.tabs.sendMessage = async () => ({ ok: true, username: 'other-user', submissions: [{ id: 99, titleSlug: 'other' }] });
  const mismatch = await h.send('sync', { platform: 'leetcode' });
  assert.match(mismatch.state.accounts.leetcode.snapshot.activityWarning, /did not match/);
  assert.equal(mismatch.state.accounts.leetcode.snapshot.recent.length, 1, 'Old verified accepts retained without importing the wrong account');
});


test('disconnect removes active tracking, clears pending refreshes and preserves lists and cached history', async () => {
  const h = await harness(); const initial = emptyState();
  initial.accounts.leetcode = { handle: 'sample', generation: 'old', status: 'ready', snapshot: { totalSolved: 42, recent: [] } };
  initial.workspace[entry.key] = entry; h.storage[STORAGE_KEY] = initial;
  h.scheduled.set('crossdsa-submission:leetcode', {}); h.scheduled.set('crossdsa-submission:leetcode:retry', {});
  const result = await h.send('disconnect', { platform: 'leetcode' });
  assert.equal(result.ok, true); assert.equal(result.state.accounts.leetcode, undefined);
  assert.equal(result.state.disconnectedAccounts.leetcode.snapshot.totalSolved, 42);
  assert.deepEqual(result.state.workspace[entry.key], entry); assert.equal(h.scheduled.size, 0);
  assert.equal((await h.send('disconnect', { platform: 'unknown' })).ok, false);
});

test('an in-flight sync cannot restore a disconnected account', async () => {
  let finish, started; const begun = new Promise(resolve => { started = resolve; });
  const h = await harness(async () => { started(); return new Promise(resolve => { finish = () => resolve(response(leetcodeData(99))); }); });
  const initial = emptyState(); initial.accounts.leetcode = { handle: 'sample', generation: 'old', snapshot: { totalSolved: 42, recent: [] } }; h.storage[STORAGE_KEY] = initial;
  const sync = h.send('sync', { platform: 'leetcode' }); await begun;
  await h.send('disconnect', { platform: 'leetcode' }); finish(); await sync;
  assert.equal(h.storage[STORAGE_KEY].accounts.leetcode, undefined);
  assert.equal(h.storage[STORAGE_KEY].disconnectedAccounts.leetcode.snapshot.totalSolved, 42);
});

test('LeetCode missing receiver is repaired once and still verifies the account', async () => {
  const h = await harness(async () => response(leetcodeData(299)));
  const initial = emptyState(); initial.accounts.leetcode = { handle: 'sample', generation: 'test' }; h.storage[STORAGE_KEY] = initial;
  chrome.tabs.query = async () => [{ id: 7 }];
  let messages = 0, injections = 0;
  chrome.tabs.sendMessage = async () => {
    if (++messages === 1) throw new Error('Could not establish connection. Receiving end does not exist.');
    return { ok: true, username: 'sample', submissions: [{ id: 42, title: 'Two Sum', titleSlug: 'two-sum', timestamp: Math.floor(Date.now() / 1000) }] };
  };
  chrome.scripting = { executeScript: async options => { injections++; assert.deepEqual(options, { target: { tabId: 7 }, files: ['tracker/leetcode-session.js'] }); } };
  const result = await h.send('sync', { platform: 'leetcode' });
  assert.equal(injections, 1); assert.equal(messages, 2);
  assert.equal(result.state.accounts.leetcode.snapshot.recentSource, 'signed-in');
  messages = 0;
  chrome.tabs.sendMessage = async () => {
    if (++messages === 1) throw new Error('Could not establish connection. Receiving end does not exist.');
    return { ok: true, username: 'other', submissions: [{ id: 99, titleSlug: 'wrong-user', timestamp: 1 }] };
  };
  const mismatch = await h.send('sync', { platform: 'leetcode' });
  assert.match(mismatch.state.accounts.leetcode.snapshot.activityWarning, /did not match/);
  assert.equal(mismatch.state.accounts.leetcode.snapshot.recent.length, 1);
});

test('missing LeetCode receiver without scripting permission shows refresh guidance and retains totals', async () => {
  const h = await harness(async () => response(leetcodeData(299)));
  const initial = emptyState(); initial.accounts.leetcode = { handle: 'sample', generation: 'test' }; h.storage[STORAGE_KEY] = initial;
  chrome.permissions.contains = async permissions => !permissions.permissions?.includes('scripting');
  chrome.tabs.query = async () => [{ id: 7 }];
  chrome.tabs.sendMessage = async () => { throw new Error('Could not establish connection. Receiving end does not exist.'); };
  const result = await h.send('sync', { platform: 'leetcode' });
  assert.equal(result.state.accounts.leetcode.snapshot.totalSolved, 299);
  assert.match(result.state.accounts.leetcode.snapshot.activityWarning, /Refresh your LeetCode tab/);
  assert.doesNotMatch(result.state.accounts.leetcode.snapshot.activityWarning, /Receiving end/);
});

test('a missing receiver on another tab does not mask the signed-in account error', async () => {
  const h = await harness(async () => response(leetcodeData(299)));
  const initial = emptyState(); initial.accounts.leetcode = { handle: 'sample', generation: 'test' }; h.storage[STORAGE_KEY] = initial;
  chrome.permissions.contains = async permissions => !permissions.permissions?.includes('scripting');
  chrome.tabs.query = async () => [{ id: 7 }, { id: 8 }];
  chrome.tabs.sendMessage = async id => {
    if (id === 7) return { ok: false, error: 'Sign in to LeetCode as @sample.' };
    throw new Error('Could not establish connection. Receiving end does not exist.');
  };
  const result = await h.send('sync', { platform: 'leetcode' });
  assert.match(result.state.accounts.leetcode.snapshot.activityWarning, /Sign in.*@sample/);
});

test('sync all starts independent platforms together and preserves per-platform status', async () => {
  let requests = 0; const releases = [];
  const h = await harness(async url => {
    requests++;
    if (url.includes('leetcode')) return new Promise(resolve => releases.push(() => resolve(response(leetcodeData(5)))));
    return new Promise(resolve => releases.push(() => resolve(response({ data: null }))));
  });
  const initial = emptyState();
  initial.accounts.leetcode = { handle: 'sample', generation: 'lc' };
  initial.accounts.code360 = { handle: 'sample', generation: '360' }; h.storage[STORAGE_KEY] = initial;
  const syncing = h.send('sync');
  for (let i = 0; i < 30 && requests < 2; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests, 2);
  assert.deepEqual(Object.values(h.storage[STORAGE_KEY].accounts).map(a => a.status), ['syncing', 'syncing']);
  for (const release of releases) release();
  const result = await syncing;
  assert.equal(result.state.accounts.leetcode.status, 'ready');
  assert.equal(result.state.accounts.code360.status, 'error');
});
